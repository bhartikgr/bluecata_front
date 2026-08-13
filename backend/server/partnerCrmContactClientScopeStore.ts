/**
 * WAVE 30 · ENGINE 1 — `partner_crm_contact_client_scope`, the Layer-1 → Layer-2
 * scoping engine.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Migration 0134 (`0134_wave_c2_partner_crm_contact_client_scope.sql`) created this
 * table, `shared/schema.ts` declared it, `server/db/connection.ts`'s inline baseline
 * creates it, and `server/lib/applyWaveC2ClientScopeSchema.ts` self-heals it — and
 * then NOTHING in the tree ever read or wrote a single row. Verified at source
 * before this wave started: a tree-wide grep for the table name returned only DDL,
 * schema declarations, the self-heal, and a mirror-drift test. **Zero write sites,
 * zero read sites, zero routes, zero UI.** That is the definition of an unshipped
 * engine, and this file is the engine.
 *
 * WHAT IT MODELS (spec §13.2 "D2 — client-scoped sub-CRM", §14.4 "E3")
 * -------------------------------------------------------------------
 * A Consortium Partner keeps a firm-wide CRM (Layer 1 — `partner_crm_contacts`).
 * Separately, the partner is attributed to specific client companies (Layer 2 —
 * `partner_attributions`). A Layer-1 contact becomes *scoped* to a specific client
 * engagement when the firm decides "this person is a contact ON that deal", and the
 * scope row is the record of that decision: who scoped it, when, and to which
 * attribution.
 *
 * The scoping key is `partner_attributions.id` (LOCK 2 — the "clientAttributionId"
 * naming was rejected platform-wide; the column is `partner_attribution_id`).
 * Callers, however, work in `companyId`, because that is what the Clients surface
 * addresses a client by. This store therefore resolves companyId → the partner's
 * own live attribution row internally. That resolution is not a convenience: it is
 * the tenant boundary, because a companyId the partner is not attributed to simply
 * has no attribution to resolve to, and the caller gets a NotFound.
 *
 * DATA-ISOLATION CONTRACT (fail-closed)
 * -------------------------------------
 * `partnerId` is ALWAYS supplied by the route layer from `req.partnerContext`,
 * which `requirePartnerAuth` derives from the SESSION and never from the URL. Every
 * function here re-verifies BOTH sides of the join against that partnerId before
 * touching a row:
 *   - the contact must be a live `partner_crm_contacts` row with that `partner_id`;
 *   - the attribution must be a live (`revoked_at IS NULL`) `partner_attributions`
 *     row with that `partner_id`.
 * A failure of EITHER check raises `ScopeNotFoundError`, which the route layer maps
 * to **404, never 403** (Wave 29 precedent, carried forward): a 403 on another
 * tenant's contact id would confirm that the id exists, turning the error code into
 * an enumeration oracle over other firms' CRM records. 404 says nothing.
 *
 * NO IN-MEMORY CANONICAL STATE. Unlike `partnerClientCrmStore`'s RAM→DB
 * write-through projection, this store reads from the database on every call. The
 * table is small (one row per (contact, client) decision), the reads are
 * index-served, and a cache here would be a second place for the tenant predicate
 * to be wrong. The DB is the only source of truth.
 */
import { randomUUID } from "crypto";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

/** Raised when a contact / attribution / scope row is not visible to this partner.
 *  The route layer maps this to 404 — see the enumeration-oracle note above. */
export class ScopeNotFoundError extends Error {
  constructor(message = "Not found for this partner.") {
    super(message);
    this.name = "ScopeNotFoundError";
  }
}

/** Raised on malformed input (empty ids, wrong types). Mapped to 400. */
export class ScopeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeValidationError";
  }
}

/** One scope row, joined to the human-readable facts each surface needs. */
export interface ClientScopeRow {
  id: string;
  partnerCrmContactId: string;
  partnerAttributionId: string;
  scopedByUserId: string;
  scopedAt: string;
  createdAt: string;
  createdBy: string | null;
  /* Joined from partner_crm_contacts — so the UI never has to render a raw id. */
  contactName: string;
  contactEmail: string;
  contactRole: string;
  contactOrg: string;
  /* Joined from partner_attributions. */
  companyId: string;
  attributionSource: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ScopeValidationError(`${label} is required.`);
  }
  return value.trim();
}

/**
 * Resolve a (partnerId, companyId) pair to the partner's LIVE attribution id.
 *
 * `revoked_at IS NULL` is the live-row grain used by every other reader of
 * `partner_attributions` in this tree (V32-M2), so a revoked attribution is
 * invisible here too — scoping a contact onto a client the firm no longer holds
 * would be creating a relationship that the rest of the platform says is over.
 *
 * Returns null rather than throwing so callers can choose the error shape.
 */
export function resolveLiveAttributionId(partnerId: string, companyId: string): string | null {
  const row = rawDb()
    .prepare(
      `SELECT id FROM partner_attributions
        WHERE partner_id = ? AND company_id = ? AND revoked_at IS NULL
        ORDER BY attributed_at DESC
        LIMIT 1`,
    )
    .get(partnerId, companyId) as { id?: string } | undefined;
  return row?.id ?? null;
}

/** True iff `contactId` is a live CRM contact owned by `partnerId`. */
export function contactBelongsToPartner(partnerId: string, contactId: string): boolean {
  const row = rawDb()
    .prepare(
      `SELECT id FROM partner_crm_contacts
        WHERE id = ? AND partner_id = ? AND deleted_at IS NULL
        LIMIT 1`,
    )
    .get(contactId, partnerId) as { id?: string } | undefined;
  return !!row?.id;
}

/** True iff `attributionId` is a live attribution owned by `partnerId`. */
export function attributionBelongsToPartner(partnerId: string, attributionId: string): boolean {
  const row = rawDb()
    .prepare(
      `SELECT id FROM partner_attributions
        WHERE id = ? AND partner_id = ? AND revoked_at IS NULL
        LIMIT 1`,
    )
    .get(attributionId, partnerId) as { id?: string } | undefined;
  return !!row?.id;
}

/* The joined SELECT every read below shares. The joins are INNER on purpose: a
 * scope row whose contact or attribution no longer resolves for THIS partner must
 * not render at all, so tenant scoping is enforced by the join itself and not only
 * by the WHERE clause. Both predicates appear anyway — belt and braces on the one
 * boundary that matters. */
const SCOPE_SELECT = `
  SELECT s.id                     AS id,
         s.partner_crm_contact_id AS partnerCrmContactId,
         s.partner_attribution_id AS partnerAttributionId,
         s.scoped_by_user_id      AS scopedByUserId,
         s.scoped_at              AS scopedAt,
         s.created_at             AS createdAt,
         s.created_by             AS createdBy,
         c.name                   AS contactName,
         c.email                  AS contactEmail,
         c.role                   AS contactRole,
         c.org                    AS contactOrg,
         a.company_id             AS companyId,
         a.attribution_source     AS attributionSource
    FROM partner_crm_contact_client_scope s
    JOIN partner_crm_contacts  c ON c.id = s.partner_crm_contact_id
                                AND c.partner_id = ? AND c.deleted_at IS NULL
    JOIN partner_attributions  a ON a.id = s.partner_attribution_id
                                AND a.partner_id = ? AND a.revoked_at IS NULL
`;

/**
 * Every CRM contact scoped to one client company, for this partner.
 *
 * Throws `ScopeNotFoundError` when the partner holds no live attribution for that
 * company — which is the same answer a caller gets for a company that does not
 * exist at all. Deliberate: the two cases are indistinguishable from outside.
 */
export function listScopesForCompany(partnerId: string, companyId: string): ClientScopeRow[] {
  const pid = requireId(partnerId, "partnerId");
  const cid = requireId(companyId, "companyId");
  const attributionId = resolveLiveAttributionId(pid, cid);
  if (!attributionId) throw new ScopeNotFoundError("Client not found or not attributed to your firm.");
  return rawDb()
    .prepare(`${SCOPE_SELECT} WHERE s.partner_attribution_id = ? ORDER BY s.scoped_at DESC, s.id ASC`)
    .all(pid, pid, attributionId) as ClientScopeRow[];
}

/** Every client a single CRM contact is scoped to ("which deals is this person on?").
 *  This is the reverse-lookup direction `idx_pccs_attribution` exists to serve. */
export function listScopesForContact(partnerId: string, contactId: string): ClientScopeRow[] {
  const pid = requireId(partnerId, "partnerId");
  const cid = requireId(contactId, "contactId");
  if (!contactBelongsToPartner(pid, cid)) {
    throw new ScopeNotFoundError("Contact not found for this partner.");
  }
  return rawDb()
    .prepare(`${SCOPE_SELECT} WHERE s.partner_crm_contact_id = ? ORDER BY s.scoped_at DESC, s.id ASC`)
    .all(pid, pid, cid) as ClientScopeRow[];
}

/** A single scope row by its own id, tenant-scoped. Throws if not visible. */
export function getScope(partnerId: string, scopeId: string): ClientScopeRow {
  const pid = requireId(partnerId, "partnerId");
  const sid = requireId(scopeId, "scopeId");
  const row = rawDb()
    .prepare(`${SCOPE_SELECT} WHERE s.id = ? LIMIT 1`)
    .get(pid, pid, sid) as ClientScopeRow | undefined;
  if (!row) throw new ScopeNotFoundError("Scope not found for this partner.");
  return row;
}

/**
 * Scope a Layer-1 CRM contact onto a Layer-2 client engagement.
 *
 * IDEMPOTENT by the table's own `UNIQUE (partner_crm_contact_id,
 * partner_attribution_id)`. A repeat call returns the EXISTING row with
 * `created: false` rather than raising — the operation the user performed
 * ("this person is on this deal") is already true, and a 409 for a request whose
 * desired state already holds is a worse answer than the state itself. §14.4's
 * racing-double-transition concern is handled by the same constraint: the loser of
 * the race reads the winner's row back.
 *
 * The insert supplies `scoped_at` explicitly and lets `created_at` take its DDL
 * DEFAULT, matching the 5-column INSERT shape §13.2's promotion-upsert issues.
 */
export function scopeContactToClient(args: {
  partnerId: string;
  contactId: string;
  companyId: string;
  actorUserId: string;
}): { row: ClientScopeRow; created: boolean } {
  const pid = requireId(args.partnerId, "partnerId");
  const contactId = requireId(args.contactId, "contactId");
  const companyId = requireId(args.companyId, "companyId");
  const actor = requireId(args.actorUserId, "actorUserId");

  /* BOTH sides of the join are verified against the session partner BEFORE any
     write. Either failure is a 404 — see the enumeration-oracle note in the file
     header. The contact check comes first only so the message is specific in the
     common typo case; neither leaks across tenants. */
  if (!contactBelongsToPartner(pid, contactId)) {
    throw new ScopeNotFoundError("Contact not found for this partner.");
  }
  const attributionId = resolveLiveAttributionId(pid, companyId);
  if (!attributionId) {
    throw new ScopeNotFoundError("Client not found or not attributed to your firm.");
  }

  const existing = rawDb()
    .prepare(
      `SELECT id FROM partner_crm_contact_client_scope
        WHERE partner_crm_contact_id = ? AND partner_attribution_id = ?
        LIMIT 1`,
    )
    .get(contactId, attributionId) as { id?: string } | undefined;
  if (existing?.id) {
    return { row: getScope(pid, existing.id), created: false };
  }

  const id = `pccs_${randomUUID()}`;
  const scopedAt = nowIso();
  try {
    rawDb()
      .prepare(
        `INSERT INTO partner_crm_contact_client_scope
           (id, partner_crm_contact_id, partner_attribution_id, scoped_by_user_id, scoped_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, contactId, attributionId, actor, scopedAt, actor);
  } catch (err) {
    /* The UNIQUE constraint is the race arbiter: a concurrent caller may have won
       between the SELECT above and this INSERT. Read their row back rather than
       failing an operation whose desired state now holds. Any OTHER error rethrows
       — swallowing them all here would be exactly the "constraint matched
       something else" false green this build has been burned by. */
    const message = String((err as Error)?.message ?? "");
    if (!/UNIQUE constraint failed/i.test(message)) throw err;
    log.warn("[partnerCrmContactClientScopeStore] lost insert race, reading winner back");
    const winner = rawDb()
      .prepare(
        `SELECT id FROM partner_crm_contact_client_scope
          WHERE partner_crm_contact_id = ? AND partner_attribution_id = ? LIMIT 1`,
      )
      .get(contactId, attributionId) as { id?: string } | undefined;
    if (!winner?.id) throw err;
    return { row: getScope(pid, winner.id), created: false };
  }
  return { row: getScope(pid, id), created: true };
}

/**
 * Remove a scope. This IS a hard delete, and that is correct here: the table has no
 * soft-delete column (see the 0134 DDL — id, the two fk columns, scoped_by_user_id,
 * scoped_at, created_at, created_by, and nothing else), and the row asserts a
 * present-tense fact ("this contact is on this deal") rather than recording a
 * historical event. Nothing downstream reads a removed scope. The contact itself
 * and the attribution itself are both untouched — this only removes the link.
 *
 * Tenant-checked through `getScope`, so deleting another firm's scope row is a 404.
 */
export function unscopeContactFromClient(partnerId: string, scopeId: string): ClientScopeRow {
  const pid = requireId(partnerId, "partnerId");
  const sid = requireId(scopeId, "scopeId");
  const row = getScope(pid, sid); // throws ScopeNotFoundError cross-tenant
  rawDb().prepare(`DELETE FROM partner_crm_contact_client_scope WHERE id = ?`).run(sid);
  return row;
}

/**
 * Counts per contact for a partner, for badge rendering on the contacts list
 * ("on 3 clients"). One query for the whole page instead of one per row.
 */
export function scopeCountsByContact(partnerId: string): Record<string, number> {
  const pid = requireId(partnerId, "partnerId");
  const rows = rawDb()
    .prepare(
      `SELECT s.partner_crm_contact_id AS contactId, COUNT(*) AS n
         FROM partner_crm_contact_client_scope s
         JOIN partner_crm_contacts  c ON c.id = s.partner_crm_contact_id
                                     AND c.partner_id = ? AND c.deleted_at IS NULL
         JOIN partner_attributions  a ON a.id = s.partner_attribution_id
                                     AND a.partner_id = ? AND a.revoked_at IS NULL
        GROUP BY s.partner_crm_contact_id`,
    )
    .all(pid, pid) as Array<{ contactId: string; n: number }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.contactId] = Number(r.n);
  return out;
}

/** Contacts of this partner that are NOT yet scoped to `companyId` — the option
 *  list for the "add a contact to this client" picker. DB-driven; the UI never
 *  hardcodes or client-side-filters a roster it was not given. */
export function listScopableContacts(
  partnerId: string,
  companyId: string,
): Array<{ id: string; name: string; email: string; role: string; org: string }> {
  const pid = requireId(partnerId, "partnerId");
  const cid = requireId(companyId, "companyId");
  const attributionId = resolveLiveAttributionId(pid, cid);
  if (!attributionId) throw new ScopeNotFoundError("Client not found or not attributed to your firm.");
  return rawDb()
    .prepare(
      `SELECT c.id AS id, c.name AS name, c.email AS email, c.role AS role, c.org AS org
         FROM partner_crm_contacts c
        WHERE c.partner_id = ? AND c.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM partner_crm_contact_client_scope s
             WHERE s.partner_crm_contact_id = c.id
               AND s.partner_attribution_id = ?
          )
        ORDER BY c.name ASC, c.id ASC`,
    )
    .all(pid, attributionId) as Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    org: string;
  }>;
}
