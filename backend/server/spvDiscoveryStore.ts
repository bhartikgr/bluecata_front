/**
 * WAVE 33 · CP-SPV-53 — SPV DISCOVERY STORE (the DB-driven half).
 *
 * Answers three questions, all from rows:
 *   1. Which vehicles may THIS viewer discover, in a given context?
 *   2. Which vehicles has this viewer been INVITED to?
 *   3. For a GP: what reach does one of my vehicles actually have?
 *
 * ── EVERY IMPORT IS STATIC ─────────────────────────────────────────────────
 * Wave 32B found two `co-members` handlers that loaded their store with a lazy
 * `require(...)` that THREW under both TS runtimes and was swallowed into `[]`
 * — dead in dev, invisible to tests, live in the bundled production build. No
 * lazy `require` appears in this file, and nothing here swallows a failure into
 * an empty list: a read that cannot be performed throws, and the route turns it
 * into a 500. An empty discovery feed must mean "no vehicles", never "the query
 * failed".
 *
 * ── NO IN-MEMORY STATE ─────────────────────────────────────────────────────
 * There is no cache and no module-level collection. `spvEngineStore` keeps a
 * hydrated map; this module deliberately does not read it, because the map is
 * partner-scoped by construction and the discovery question is cross-partner.
 * Every function below hits `spv` / `spv_lp_invite` / `spv_discovery_event`.
 *
 * ── FAIL-CLOSED ────────────────────────────────────────────────────────────
 * Scope evaluation is delegated to `server/lib/spvDiscoverability.ts`, which
 * denies on anything it does not recognise. SQL never filters by scope alone;
 * candidate rows are fetched and then passed through the predicate, so a scope
 * string the enum does not know about is invisible rather than accidentally
 * matched by a `!=` clause.
 */
import { randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { applySpvDiscoverabilitySchema } from "./lib/applySpvDiscoverabilitySchema";
import { applyWave38EventLedgerSchemaOnce } from "./lib/applyWave38EventLedgerSchema";
import {
  isBroadcastDiscoverable,
  isReachableByViewer,
  summariseReach,
  isSpvScope,
  type SpvDiscoveryContext,
  type SpvReachSummary,
} from "./lib/spvDiscoverability";

let healed = false;
function db() {
  const d = rawDb();
  if (!healed) {
    applySpvDiscoverabilitySchema(d as any);
    // WAVE 38 ROW 4 — 0183 adds the canonical ledger columns to
    // `spv_discovery_event`. The bootstrap path never runs 0183, so the heal
    // must; `recordDiscoveryEvents` writes `actor_id` and `seq`.
    applyWave38EventLedgerSchemaOnce(d as any);
    healed = true;
  }
  return d;
}

/** Test-only: forget the heal memo so a fresh in-memory DB is healed again. */
export function __resetDiscoverySchemaMemo(): void {
  healed = false;
}

export interface DiscoverableSpv {
  spvId: string;
  name: string;
  sponsorPartnerId: string;
  spvType: string;
  jurisdiction: string;
  status: string;
  currency: string;
  scope: string;
  targetRaiseMinor: number | null;
  minCheckMinor: number | null;
  closeDate: string | null;
  /** TRUE only when an invitation is the reason this row is visible. */
  viaInvitation: boolean;
}

interface SpvRow {
  id: string;
  name: string;
  sponsor_partner_id: string;
  spv_type: string;
  jurisdiction: string;
  status: string;
  currency: string;
  distribution_scope: string;
  target_raise_minor: number | null;
  min_check_minor: number | null;
  close_date: string | null;
  archived_at: string | null;
}

/**
 * The email addresses this user id is known by.
 *
 * Invitations are addressed to an EMAIL because the invitee usually has no
 * account when the GP sends them. Resolution therefore has to bridge
 * `users.email` -> `spv_lp_invite.email`. The comparison is done on a lowered,
 * trimmed value on BOTH sides: a GP typing `Ada@Example.com` and a user
 * registered as `ada@example.com` are the same person, and a case-sensitive
 * join would silently show them nothing while everything appeared configured.
 */
function emailsForUser(userId: string): string[] {
  const out = new Set<string>();
  const push = (v: unknown) => {
    const s = String(v ?? "").trim().toLowerCase();
    if (s) out.add(s);
  };
  try {
    const u = db().prepare(`SELECT email FROM users WHERE id = ? LIMIT 1`).get(userId) as
      | { email?: string }
      | undefined;
    push(u?.email);
  } catch {
    /* `users` is a core table; if it is unreadable the caller's other reads
       will fail loudly. An empty set here simply means no invitations resolve,
       which is the DENYING direction. */
  }
  try {
    const a = db().prepare(`SELECT email FROM auth_users WHERE id = ? LIMIT 1`).get(userId) as
      | { email?: string }
      | undefined;
    push(a?.email);
  } catch {
    /* auth_users is optional in some fixtures. */
  }
  return Array.from(out.values());
}

/**
 * SPV ids this user holds a LIVE invitation to.
 *
 * "Live" = not soft-deleted and not revoked/declined. The status filter is a
 * positive allow-list (`invited` / `accepted`) rather than a negative
 * exclusion: a status value nobody anticipated must not grant access.
 */
export function invitedSpvIdsFor(userId: string): string[] {
  const emails = emailsForUser(userId);
  if (emails.length === 0) return [];
  const placeholders = emails.map(() => "?").join(", ");
  const rows = db()
    .prepare(
      `SELECT DISTINCT spv_id, status FROM spv_lp_invite
        WHERE lower(trim(email)) IN (${placeholders})
          AND deleted_at IS NULL`,
    )
    .all(...emails) as Array<{ spv_id: string; status: string | null }>;
  const LIVE = new Set(["invited", "accepted"]);
  return rows.filter((r) => LIVE.has(String(r.status ?? "invited"))).map((r) => r.spv_id);
}

/** Candidate vehicles: never drafts, never archived. Scope is NOT filtered in SQL. */
function candidateSpvRows(): SpvRow[] {
  return db()
    .prepare(
      `SELECT id, name, sponsor_partner_id, spv_type, jurisdiction, status, currency,
              distribution_scope, target_raise_minor, min_check_minor, close_date, archived_at
         FROM spv
        WHERE archived_at IS NULL AND status <> 'draft'
        ORDER BY created_at DESC, id ASC`,
    )
    .all() as SpvRow[];
}

function toDto(r: SpvRow, viaInvitation: boolean): DiscoverableSpv {
  return {
    spvId: r.id,
    name: r.name,
    sponsorPartnerId: r.sponsor_partner_id,
    spvType: r.spv_type,
    jurisdiction: r.jurisdiction,
    status: r.status,
    currency: r.currency,
    scope: r.distribution_scope,
    targetRaiseMinor: r.target_raise_minor === null || r.target_raise_minor === undefined
      ? null
      : Number(r.target_raise_minor),
    minCheckMinor: r.min_check_minor === null || r.min_check_minor === undefined
      ? null
      : Number(r.min_check_minor),
    closeDate: r.close_date ?? null,
    viaInvitation,
  };
}

/**
 * THE DISCOVERY FEED. Broadcast reach for `context`, PLUS the vehicles this
 * viewer holds an invitation to.
 *
 * The two halves are unioned, not merged into one predicate, precisely so a
 * mistake in the invitation half cannot widen the broadcast half. A vehicle
 * reachable by both routes is reported ONCE with `viaInvitation: false`,
 * because "you can see this because it is public" is the stronger and more
 * honest statement.
 */
export function discoverableSpvsFor(
  userId: string,
  context: SpvDiscoveryContext,
): DiscoverableSpv[] {
  const invited = new Set(invitedSpvIdsFor(userId));
  const out: DiscoverableSpv[] = [];
  for (const r of candidateSpvRows()) {
    const scope = r.distribution_scope;
    if (isBroadcastDiscoverable(scope, context)) {
      out.push(toDto(r, false));
      continue;
    }
    if (
      invited.has(r.id) &&
      isReachableByViewer(scope, "invited", { hasInvitation: true })
    ) {
      out.push(toDto(r, true));
    }
  }
  return out;
}

/** Just the invitation half — the "you were invited to these" surface. */
export function invitedSpvsFor(userId: string): DiscoverableSpv[] {
  const invited = new Set(invitedSpvIdsFor(userId));
  if (invited.size === 0) return [];
  return candidateSpvRows()
    .filter(
      (r) =>
        invited.has(r.id) && isReachableByViewer(r.distribution_scope, "invited", { hasInvitation: true }),
    )
    .map((r) => toDto(r, true));
}

/**
 * Can this viewer reach this ONE vehicle? Used by the detail route.
 *
 * Returns null for "no", so the route can collapse non-reachability and
 * non-existence into one 404 and offer no enumeration oracle.
 */
export function discoverableSpvFor(
  userId: string,
  spvId: string,
  context: SpvDiscoveryContext,
): DiscoverableSpv | null {
  const r = db()
    .prepare(
      `SELECT id, name, sponsor_partner_id, spv_type, jurisdiction, status, currency,
              distribution_scope, target_raise_minor, min_check_minor, close_date, archived_at
         FROM spv WHERE id = ? LIMIT 1`,
    )
    .get(spvId) as SpvRow | undefined;
  if (!r) return null;
  if (r.archived_at) return null;
  if (r.status === "draft") return null;
  if (isBroadcastDiscoverable(r.distribution_scope, context)) return toDto(r, false);
  const invited = invitedSpvIdsFor(userId).includes(spvId);
  if (invited && isReachableByViewer(r.distribution_scope, "invited", { hasInvitation: true })) {
    return toDto(r, true);
  }
  return null;
}

/**
 * Record that a viewer actually reached a vehicle.
 *
 * Written AFTER the vehicle has been resolved, never before — the obligation
 * ("someone reached this") may not be recorded until the fact that satisfies it
 * exists. One row per (viewer, vehicle, context, scope-at-time) pair per
 * resolution; the GP surface counts DISTINCT viewers, so repeated page loads
 * cannot inflate a reach figure into something a GP would read as demand.
 */
export function recordDiscoveryEvents(
  viewerUserId: string,
  context: SpvDiscoveryContext,
  rows: DiscoverableSpv[],
): number {
  if (!viewerUserId || rows.length === 0) return 0;
  const now = new Date().toISOString();
  const stmt = db().prepare(
    // WAVE 38 ROW 4 — canonical event columns (migration 0183). `actor_id` is
    // `viewer_user_id`: the discovery predicate ran FOR that identity, so the
    // actor is a real recorded fact here and nothing is defaulted. `seq` is
    // per-parent over `spv_id`, derived by a scalar subquery in the same
    // statement so a partially applied loop cannot leave a gap it invented.
    `INSERT INTO spv_discovery_event
       (id, spv_id, viewer_user_id, context, scope_at_time, via_invitation,
        actor_id, seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?,
             (SELECT COALESCE(MAX(seq), 0) + 1 FROM spv_discovery_event WHERE spv_id = ?),
             ?)`,
  );
  let n = 0;
  for (const r of rows) {
    // A scope the enum does not recognise is not written: the CHECK constraint
    // guards `context`, and this guards the other column that has a domain.
    if (!isSpvScope(r.scope)) continue;
    stmt.run(
      `spvdisc_${randomBytes(8).toString("hex")}`,
      r.spvId,
      viewerUserId,
      context,
      r.scope,
      r.viaInvitation ? 1 : 0,
      viewerUserId,
      r.spvId,
      now,
    );
    n += 1;
  }
  return n;
}

/**
 * GP-facing reach for one vehicle. Partner-scoped IN THE SQL: a GP asking about
 * a vehicle they do not sponsor gets null, which the route turns into a 404
 * byte-identical to a nonexistent id.
 */
export function reachForSponsoredSpv(partnerId: string, spvId: string): SpvReachSummary | null {
  const r = db()
    .prepare(
      `SELECT id, distribution_scope FROM spv
        WHERE id = ? AND sponsor_partner_id = ? LIMIT 1`,
    )
    .get(spvId, partnerId) as { id: string; distribution_scope: string } | undefined;
  if (!r) return null;

  let invitationCount: number | null = null;
  try {
    const c = db()
      .prepare(
        `SELECT COUNT(*) AS n FROM spv_lp_invite
          WHERE spv_id = ? AND deleted_at IS NULL AND status IN ('invited', 'accepted')`,
      )
      .get(spvId) as { n?: number } | undefined;
    invitationCount = c ? Number(c.n ?? 0) : null;
  } catch {
    // NULL, not 0. "We could not read the invite list" and "there are no
    // invitations" are different statements and the copy renders them
    // differently.
    invitationCount = null;
  }

  let distinctViewers: number | null = null;
  try {
    const c = db()
      .prepare(
        `SELECT COUNT(DISTINCT viewer_user_id) AS n FROM spv_discovery_event WHERE spv_id = ?`,
      )
      .get(spvId) as { n?: number } | undefined;
    distinctViewers = c ? Number(c.n ?? 0) : null;
  } catch {
    distinctViewers = null;
  }

  return summariseReach({ scope: r.distribution_scope, invitationCount, distinctViewers });
}
