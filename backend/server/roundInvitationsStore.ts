/**
 * server/roundInvitationsStore.ts — v15 P0-4..P0-8
 *
 * Replaces the in-memory stub at routes.ts:997-1014 with a canonical,
 * DB-backed founder-invitation system that closes audit findings:
 *
 *   P0-4  Invitations persisted to `round_invitations` table (sha256 token hash).
 *   P0-5  CRM classification — emails on the founder's CRM are tagged
 *         `in_crm`; brand-new emails are tagged `new_registration`. ALL
 *         emails are allowed; classification is informational, not a gate.
 *   P0-6  32-byte secure random token, sha256(token) stored, raw token sent
 *         ONLY via email + included in the JSON response **never**.
 *   P0-7  Email delivered via `emailTransport.sendMail()` (console/smtp).
 *   P0-8  redeemInvitation(token) — single-use, 14-day default expiry,
 *         atomic transition pending|sent → accepted.
 *
 * Hard-rule compliance:
 *   - Every state-changing write goes through `getDb().transaction((tx) => {...})`
 *     with NO trailing `()` — Drizzle's `db.transaction` invokes the callback.
 *   - Hydration is awaited sequentially from `HYDRATE_ORDER` (no Promise.all).
 *   - `withTenant()` is used for reads/writes that touch a single tenant;
 *     cross-tenant reads are explicitly marked in comments.
 *   - SSE emission via `emitMutation()` on every state change so the founder
 *     dashboard updates in real time.
 */
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { createHash, randomBytes } from "crypto";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { escapeHtml as e } from "./lib/htmlEscape"; /* v25.17 Lane A NH4 */
import { getDb, rawDb } from "./db/connection";
import { roundInvitations as invitationsTable } from "../shared/schema";
import { sendMail, getConfig as getEmailConfig } from "./emailTransport";
import { emitMutation } from "./lib/eventBus";
import { listContactsForCompany, upsertCrmContactForInvitation } from "./founderCrmStore";
import { getCompanyNameById } from "./multiCompanyStore";
import { getRoundById } from "./roundsStore";
import { log } from "./lib/logger";
/* ---- Wave C-2 / D1 additive imports. Appended after the existing `log` import at :45 so
   every pre-existing import line (32-45) is byte-preserved. `./lib/delegatedAgency` imports
   NOTHING from this file, so no cycle is created (grep: 0 hits for "roundInvitationsStore"
   in delegatedAgency.ts). `appendMfEngagementEvent` is deliberately NOT statically imported —
   see the §9.3-A audit-append block inside `createInvitationTx`, which uses the file's own
   `createRequire` shim at :33 instead. `randomUUID` is NOT added to :35 (zero call sites
   after §9.3-A centralization; adding it would trip noUnusedLocals), and `Database` from
   `better-sqlite3` is NOT imported (`db` is typed `ReturnType<typeof rawDb>`, and `rawDb` is
   already imported at :38) — so this block adds ZERO net-new runtime dependencies. ---- */
import {
  ROUTE_SCOPE_MAP,
  engagementHasScope,
  DELEGATED_WRITE_SUB_ROLES,
} from "./lib/delegatedAgency";

/* ---------- Types ---------- */

export type InvitationState =
  | "pending"
  | "sent"
  | "viewed"
  | "accepted"
  | "declined"
  | "expired"
  | "revoked";

export type InvitationClassification = "in_crm" | "new_registration";

export interface RoundInvitationRow {
  id: string;
  tenantId: string | null;
  roundId: string;
  companyId: string | null;
  investorEmail: string;
  investorName: string | null;
  investorFirstName: string | null;
  investorLastName: string | null;
  state: InvitationState;
  classification: InvitationClassification | null;
  /** sha256(token) — never the raw token. */
  tokenHash: string | null;
  invitedByUserId: string | null;
  note: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  redeemedAt: string | null;
  redeemedByUserId: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** v25.55 5b — ISO timestamp of the last resend, or null if never resent. */
  resentAt: string | null;
  /* ---- Wave C-2 (migration 0133) delegated provenance/principal columns. NULL on every
     founder-originated row. All five are OPTIONAL so every existing construction site of
     RoundInvitationRow in the tree (:403-425, :1163-1187, mapDbRow :243-265) compiles
     unchanged. Field order = 0133 ALTER order = delegated INSERT positions 21-25. ---- */
  sourcedFromPartnerId?: string | null;              // 0133 col 21
  sourcedFromPartnerAttributionId?: string | null;   // 0133 col 22
  actingOnBehalfOfUserId?: string | null;            // 0133 col 23
  actorPartnerUserId?: string | null;                // 0133 col 24
  engagementId?: string | null;                      // 0133 col 25 (v3.3.4 V33-4-B5)
}

export interface CreateInvitationArgs {
  roundId: string;
  companyId: string;
  investorEmail: string;
  investorName?: string | null;
  investorFirstName?: string | null;
  investorLastName?: string | null;
  /** v25.53 8a — optional CRM-aligned fields, persisted onto the CRM contact. */
  investorCompany?: string | null;
  stageFocus?: string | null;
  typicalMarketSize?: string | null;
  note?: string | null;
  expiryDays?: number;
  invitedByUserId: string;
  tenantId?: string | null;
  /** Test/dry-run hook so unit tests can intercept the outbound email. */
  dryRun?: boolean;
  /* ---- Wave C-2 delegated-agency fields. Founder-path callers pass NONE of these seven;
     `createInvitation`'s dispatch requires exactly-all-seven or exactly-none (V33-4-B1).
     Explicit `| null` per V33-4-N1. ---- */
  actorPartnerUserId?: string | null;
  actingOnBehalfOfUserId?: string | null;
  partnerAttributionId?: string | null;
  engagementId?: string | null;
  partnerId?: string | null;
  routePath?: string | null;
  authorityArtifactId?: string | null;
}

export interface CreateInvitationResult {
  /** Invitation row WITHOUT the raw token. */
  invitation: Omit<RoundInvitationRow, "tokenHash"> & { tokenHash?: never };
  /** True if the email transport accepted the message. */
  emailSent: boolean;
  /** v25.52 Avi-BUG-1 — the ACTUAL transport mode used ("smtp" | "console" | "dry_run"). */
  emailMode?: string;
  /** v25.52 Avi-BUG-1 — true ONLY when a real SMTP send succeeded (not console/dry_run). */
  emailDelivered?: boolean;
  /** Email transport messageId (for audit/debug); never contains the token. */
  emailMessageId?: string;
  /** Classification of the recipient. */
  classification: InvitationClassification;
  /** L-006 fix v23.4.13: return redeemUrl on create. Only available at create-time; list never exposes raw tokens. */
  redeemUrl: string;
}

/* ---------- In-memory mirror (for fast list/lookup + tests) ---------- */

const memInvitations: RoundInvitationRow[] = [];

function tenantForCompany(companyId: string | null | undefined): string {
  if (companyId) return `tenant_co_${companyId}`;
  return "tenant_platform";
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function makeId(roundId: string): string {
  return `inv_${roundId}_${randomBytes(8).toString("hex")}`;
}

function generateToken(): string {
  // 32 raw bytes = 256 bits of entropy, hex-encoded for URL safety.
  return randomBytes(32).toString("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function plusDaysIso(days: number, from: Date = new Date()): string {
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toISOString();
}

/**
 * Wave C3 (Shadie 2a) — SINGLE SOURCE OF TRUTH for the invitation email markup.
 * Both the real send (createInvitation) and the founder-facing PREVIEW endpoint
 * render through this, so "what the founder sees == what the investor receives".
 * Only the personal note is founder-editable; the round facts (company, round
 * name, expiry) and the secure invite link are fixed by the caller. Every
 * interpolated value is HTML-escaped (Lane A NH4).
 */
export function renderInvitationEmail(input: {
  investorName?: string | null;
  companyName: string;
  roundName: string;
  link: string;
  note?: string | null;
  expiryDays?: number | null;
}): { subject: string; html: string; text: string } {
  const investorName = input.investorName ?? "there";
  const expiryDays = input.expiryDays ?? 14;
  const note = (input.note ?? "").trim();
  const subject = `[Capavate] You're invited to ${input.companyName} — ${input.roundName}`;
  const html =
    `<p>Hi ${e(investorName)},</p>` +
    `<p>You've been invited to participate in <strong>${e(input.roundName)}</strong> at <strong>${e(input.companyName)}</strong>.</p>` +
    `<p><a href="${e(input.link)}">Click here to view the invitation</a></p>` +
    (note ? `<p>Note from the founder: ${e(note)}</p>` : "") +
    `<p>This invitation expires in ${e(String(expiryDays))} days.</p>`;
  const text =
    `You've been invited to participate in ${input.roundName} at ${input.companyName} on Capavate.\n` +
    `View it here: ${input.link}\n` +
    (note ? `Note: ${note}\n` : "") +
    `This invitation expires in ${expiryDays} days.`;
  return { subject, html, text };
}

function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Resolve discrete first/last + composed name for an invitation. Prefers
 * explicit first/last; otherwise splits a single legacy `name` (parts[0]=first,
 * remainder=last). The composed name is always kept populated ("First Last")
 * so all existing readers/exports stay byte-stable.
 */
function resolveInvestorNameParts(
  name?: string | null,
  first?: string | null,
  last?: string | null,
): { first: string | null; last: string | null; composed: string | null } {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f || l) {
    const composed = [f, l].filter(Boolean).join(" ") || null;
    return { first: f || null, last: l || null, composed };
  }
  const whole = (name ?? "").trim();
  if (!whole) return { first: null, last: null, composed: null };
  const parts = whole.split(/\s+/);
  const splitFirst = parts.shift() ?? "";
  const splitLast = parts.join(" ");
  return { first: splitFirst || null, last: splitLast || null, composed: whole };
}

/** Classify by checking the founder's CRM for an email match. */
function classifyEmail(companyId: string, email: string): InvitationClassification {
  const normalized = normalizeEmail(email);
  if (!normalized) return "new_registration";
  try {
    const crm = listContactsForCompany(companyId);
    const hit = crm.find((c) => normalizeEmail((c as any).email ?? "") === normalized);
    return hit ? "in_crm" : "new_registration";
  } catch {
    return "new_registration";
  }
}

/** Strip the token hash so a response object never contains it. */
function publicView(row: RoundInvitationRow): Omit<RoundInvitationRow, "tokenHash"> {
  const { tokenHash: _omit, ...rest } = row;
  return rest;
}

/* ---------- Wave C-2 (§7.6-A) — partner-aware DTO ----------
 * `publicView` (:230-233) is UNTOUCHED and remains the DTO for all eight of its existing call
 * sites. A-D1-19: §7.6-A names five `publicView` → `partnerInvitationView` swaps (:604, :769,
 * :779, :786, :796) but THREE further `publicView` sites exist and are unnamed (:805, :817,
 * :1208); swapping only five would leave the DTO shape inconsistent across endpoints — some
 * returning `actingOnBehalfOf`, some not — and four of the five named sites are FOUNDER read
 * endpoints, which the brief's overriding instruction for this file requires be byte-preserved.
 * D1 therefore leaves all eight `publicView` sites byte-identical and uses
 * `partnerInvitationView` ONLY in `createDelegatedInvitation`'s return, the one genuinely new
 * partner-only surface. The DTO-parity gap across all eight sites is flagged as an open product
 * decision (ASSUMPTIONS_D1.md TOUGH QUESTIONS #4) rather than half-applied.
 */
export interface PublicRoundInvitation extends Omit<RoundInvitationRow, "tokenHash"> {
  actingOnBehalfOf:
    | { actorPartnerUserId: string; engagementId: string; partnerAttributionId: string }
    | null;
}

export function partnerInvitationView(row: RoundInvitationRow): PublicRoundInvitation {
  const base = publicView(row);
  const actorPartnerUserId = row.actorPartnerUserId ?? null;
  const engagementId = row.engagementId ?? null;
  const partnerAttributionId = row.sourcedFromPartnerAttributionId ?? null;
  // Fail-closed on partial state: ANY partial combination degrades to `actingOnBehalfOf: null`
  // ("founder-shaped") rather than emitting a partial object that would crash a UI reading
  // `actingOnBehalfOf.engagementId`.
  const allSet =
    actorPartnerUserId !== null && engagementId !== null && partnerAttributionId !== null;
  const actingOnBehalfOf = allSet
    ? { actorPartnerUserId, engagementId, partnerAttributionId }
    : null;
  return { ...base, actingOnBehalfOf } as PublicRoundInvitation;
}

/* ---------- v25.35 — DB-first read helpers (BLOCKER #12) ----------
 * memInvitations is a fast cache; the DB is the read authority. A cold cache
 * after restart previously caused invitation reads (redeem, list, lookup) to
 * miss and 404 a genuinely-persisted invitation. These helpers query the DB
 * with rawDb() and opportunistically repopulate the cache. DB read errors
 * degrade to a cache-only result (non-fatal) — writes remain fail-closed.
 */
function mapDbRow(r: any): RoundInvitationRow {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? null,
    roundId: r.round_id,
    companyId: r.company_id ?? null,
    investorEmail: r.investor_email,
    investorName: r.investor_name ?? null,
    investorFirstName: r.investor_first_name ?? r.investorFirstName ?? null,
    investorLastName: r.investor_last_name ?? r.investorLastName ?? null,
    state: (r.state ?? "sent") as InvitationState,
    classification: (r.classification ?? null) as InvitationClassification | null,
    tokenHash: r.token_hash ?? null,
    invitedByUserId: r.invited_by_user_id ?? null,
    note: r.note ?? null,
    sentAt: r.sent_at ?? null,
    viewedAt: r.viewed_at ?? null,
    redeemedAt: r.redeemed_at ?? null,
    redeemedByUserId: r.redeemed_by_user_id ?? null,
    expiresAt: r.expires_at ?? null,
    createdAt: r.created_at ?? null,
    updatedAt: r.updated_at ?? null,
    resentAt: r.resent_at ?? null,
    /* ---- Wave C-2 (migration 0133) provenance columns. REQUIRED, not cosmetic: `mapDbRow`
       has no spread, so without these five assignments every provenance value is silently
       dropped on every cold-cache DB read and on boot hydration (§6). ---- */
    sourcedFromPartnerId:            r.sourced_from_partner_id ?? null,
    sourcedFromPartnerAttributionId: r.sourced_from_partner_attribution_id ?? null,
    actingOnBehalfOfUserId:          r.acting_on_behalf_of_user_id ?? null,
    actorPartnerUserId:              r.actor_partner_user_id ?? null,
    engagementId:                    r.engagement_id ?? null,
  };
}

/** Upsert a freshly-read DB row into the in-memory mirror, returning the
 *  cached reference (so callers mutate the canonical object). */
function cacheUpsert(row: RoundInvitationRow): RoundInvitationRow {
  const idx = memInvitations.findIndex((r) => r.id === row.id);
  if (idx >= 0) {
    memInvitations[idx] = row;
    return memInvitations[idx];
  }
  memInvitations.push(row);
  return row;
}

function dbFindById(id: string): RoundInvitationRow | null {
  try {
    const r: any = rawDb().prepare("SELECT * FROM round_invitations WHERE id = ?").get(id);
    return r ? mapDbRow(r) : null;
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindById] DB fallback failed:", (err as Error).message);
    return null;
  }
}

function dbFindByTokenHash(hash: string): RoundInvitationRow | null {
  try {
    const r: any = rawDb().prepare("SELECT * FROM round_invitations WHERE token_hash = ?").get(hash);
    return r ? mapDbRow(r) : null;
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindByTokenHash] DB fallback failed:", (err as Error).message);
    return null;
  }
}

function dbFindByRound(roundId: string): RoundInvitationRow[] {
  try {
    const rows: any[] = rawDb().prepare("SELECT * FROM round_invitations WHERE round_id = ?").all(roundId);
    return rows.map(mapDbRow);
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindByRound] DB fallback failed:", (err as Error).message);
    return [];
  }
}

function dbFindByCompany(companyId: string): RoundInvitationRow[] {
  try {
    const rows: any[] = rawDb().prepare("SELECT * FROM round_invitations WHERE company_id = ?").all(companyId);
    return rows.map(mapDbRow);
  } catch (err) {
    log.warn("[roundInvitationsStore.dbFindByCompany] DB fallback failed:", (err as Error).message);
    return [];
  }
}

/** Merge a DB row-set into the cache, returning the merged set keyed by id. */
function mergeForRead(dbRows: RoundInvitationRow[], cacheRows: RoundInvitationRow[]): RoundInvitationRow[] {
  const byId = new Map<string, RoundInvitationRow>();
  for (const r of cacheRows) byId.set(r.id, r);
  for (const r of dbRows) {
    // DB is authoritative for read; repopulate the cache opportunistically.
    byId.set(r.id, cacheUpsert(r));
  }
  return Array.from(byId.values());
}

/* ---------- Create ---------- */

/** v25.53 6a — active invitation states that block a duplicate re-invite. */
const ACTIVE_INVITE_STATES: InvitationState[] = ["pending", "sent", "viewed", "accepted"];

/**
 * v25.53 6a — true if an ACTIVE invitation already exists for this
 * (roundId, normalized email). DB is authoritative; the in-memory mirror is a
 * fallback for no-DB/test paths. Email is normalized (lower/trim) on both sides.
 */
function hasActiveInvitation(roundId: string, normalizedEmail: string): boolean {
  const email = normalizeEmail(normalizedEmail);
  if (!roundId || !email) return false;
  try {
    const db = rawDb();
    const placeholders = ACTIVE_INVITE_STATES.map(() => "?").join(", ");
    const hit = db
      .prepare(
        `SELECT 1 FROM round_invitations
           WHERE round_id = ?
             AND lower(trim(investor_email)) = ?
             AND state IN (${placeholders})
           LIMIT 1`,
      )
      .get(roundId, email, ...ACTIVE_INVITE_STATES);
    if (hit) return true;
  } catch {
    // DB unavailable — fall through to the in-memory mirror.
  }
  return memInvitations.some(
    (r) =>
      r.roundId === roundId &&
      normalizeEmail(r.investorEmail) === email &&
      ACTIVE_INVITE_STATES.includes(r.state),
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * Wave C-2 / D1b — LOCK 5 refactor of the former `createInvitation` (real :368-613).
 *
 * This region is replaced by FOUR functions:
 *   1. `createInvitationTx`         export  — the writer. Opens NO transaction of its own.
 *   2. `createInvitation`           export  — atomic FOUNDER wrapper. Signature UNCHANGED.
 *   3. `sendInvitationEmailInline`  private — real :512-590, transposed verbatim.
 *   4. `createDelegatedInvitation`  export  — new, §7.6, partner-delegated path.
 *
 * LOCK 5 CONTRACT — what is byte-preserved and what is not:
 *   • The FOUNDER INSERT is the original 20-column / 20-bind statement, byte-identical to
 *     real :442-469 modulo a uniform +2-space indent from nesting inside `if (!delegated)`.
 *     It NEVER names `sourced_from_partner_id`, `sourced_from_partner_attribution_id`,
 *     `acting_on_behalf_of_user_id`, `actor_partner_user_id`, or `engagement_id`. That is not
 *     cosmetic: under `PRAGMA foreign_keys = ON` (db/connection.ts:125) SQLite resolves a
 *     table's REFERENCES targets at statement-prepare time for the whole table, so naming a
 *     column whose REFERENCES target is absent fails EVERY insert — including one binding
 *     NULL. A single shared 25-column statement would convert a partner-only hazard into a
 *     founder-path hazard. (Independently moot in this tree — 0133:78 adds `engagement_id`
 *     as bare `TEXT` with no live REFERENCES clause — but the branch costs nothing and the
 *     brief mandates it. A-D1-18.)
 *   • The founder side-effect SEQUENCE is unchanged: DB insert → `memInvitations.push` →
 *     CRM upsert → email send → `emitMutation(invitation/create)` →
 *     `emitMutation(round/update)` → `redeemUrl` → 7-field return via `publicView`.
 *   • The two `log` label strings are kept VERBATIM as
 *     `[roundInvitationsStore.createInvitation]` (A-D1-17). The brief says byte-preserve the
 *     founder path; a log label is a byte. The founder path has ZERO string deltas.
 *   • `duplicate_invitation` still surfaces as HTTP 409, not 500: `hasActiveInvitation`
 *     throws INSIDE the transaction, and better-sqlite3's `db.transaction()` rolls back and
 *     re-throws the ORIGINAL error object synchronously, so routes.ts's
 *     `msg === "duplicate_invitation"` test still matches.
 *
 * Founder-path observable deltas — the complete, closed list (3 items):
 *   1. An explicit `db.transaction()` wrapper replaces SQLite per-statement autocommit.
 *      Strict correctness improvement; §7.6 names it. The single INSERT is unchanged, so the
 *      committed row is byte-identical.
 *   2. `getCompanyNameById` / `getRoundById` are now called from `sendInvitationEmailInline`
 *      rather than inline in the same scope. Same functions, same arguments, both already
 *      try-wrapped best-effort.
 *   3. `emitMutation`'s `tenantId ?? undefined` becomes `row.tenantId ?? undefined`.
 *      IDENTICAL value — `row.tenantId` is assigned from `tenantId` at real :405.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * The invitation writer. Opens NO transaction of its own — the caller-provided-`db` idiom,
 * matching `teamInviteRedeem.ts:256` / `multiCompanyStore.ts:692`. Callers wrap it so the
 * invitation row and (on the delegated path) its `mf_engagement_event` audit row commit or
 * roll back together.
 *
 * `memInvitations.push(row)` is deliberately NOT in this function (it is at real :492): inside
 * a transaction it would open a commit-failure phantom-row window. It stays with the callers,
 * strictly after `tx()` returns.
 *
 * `db` is typed `ReturnType<typeof rawDb>` (V33-5-B10) so this file gains zero new imports.
 */
export function createInvitationTx(
  db: ReturnType<typeof rawDb>,
  args: CreateInvitationArgs,
  delegated: boolean = false,
): { row: RoundInvitationRow; tokenPlain: string } {
  // D1 (A-D1-16) — `createInvitationTx` is exported per the D1 brief, so it is reachable from
  // outside this module. Re-assert the all-seven-or-none invariant here (not only in
  // `createInvitation`'s dispatcher) so an external caller can never persist provenance columns
  // without the matching audit row. Founder calls pass `delegated === false` and skip this entirely.
  if (delegated) {
    const present = [
      args.actorPartnerUserId, args.actingOnBehalfOfUserId, args.partnerAttributionId,
      args.engagementId, args.partnerId, args.routePath, args.authorityArtifactId,
    ].filter((v) => v != null && v !== "").length;
    if (present !== 7) throw Object.assign(new Error("DELEGATED_ARGS_INCOMPLETE"), { statusCode: 500 });
  }

  const investorEmail = normalizeEmail(args.investorEmail);
  if (!investorEmail) throw new Error("invalid_email");
  if (!args.roundId) throw new Error("missing_round_id");
  // W-FIX2 F1 (write path) — if the caller omitted companyId, derive it from the
  // round so a persisted invitation is NEVER null-companyId (the root cause of
  // the empty investor cap-table + dataroom). Additive: existing callers that
  // pass companyId are unaffected.
  if (!args.companyId) {
    const derived = getRoundById(args.roundId)?.companyId;
    if (derived) args = { ...args, companyId: derived };
  }
  if (!args.companyId) throw new Error("missing_company_id");

  // v25.53 6a — block a duplicate ACTIVE invitation for the same
  // (roundId, normalized email). "Active" = an invite that is still live:
  // pending | sent | viewed | accepted. A prior invite that was revoked,
  // expired, or declined is legitimately re-invitable, so those states do NOT
  // block. Fail-closed: if an active row exists we throw `duplicate_invitation`
  // (mapped to HTTP 409 by the route) BEFORE minting a token or sending mail.
  if (hasActiveInvitation(args.roundId, investorEmail)) {
    throw new Error("duplicate_invitation");
  }

  const tenantId = args.tenantId ?? tenantForCompany(args.companyId);
  const classification = classifyEmail(args.companyId, investorEmail);
  const id = makeId(args.roundId);
  const tokenPlain = generateToken();
  const tokenHash = sha256Hex(tokenPlain);
  const expiresAt = plusDaysIso(args.expiryDays ?? 14);
  const createdAt = nowIso();

  const { first: invFirst, last: invLast, composed: invComposed } =
    resolveInvestorNameParts(args.investorName, args.investorFirstName, args.investorLastName);

  const row: RoundInvitationRow = {
    id,
    tenantId,
    roundId: args.roundId,
    companyId: args.companyId,
    investorEmail,
    investorName: invComposed,
    investorFirstName: invFirst,
    investorLastName: invLast,
    state: "sent",
    classification,
    tokenHash,
    invitedByUserId: args.invitedByUserId,
    note: args.note ?? null,
    sentAt: createdAt,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt,
    createdAt,
    updatedAt: createdAt,
    resentAt: null,
    /* ---- Wave C-2 (0133) provenance. On the founder path every one of these is `null`
       (the seven delegated args are absent), and the founder INSERT below does not name
       the columns at all, so they are never bound. ---- */
    sourcedFromPartnerId: args.partnerId ?? null,
    sourcedFromPartnerAttributionId: args.partnerAttributionId ?? null,
    actingOnBehalfOfUserId: args.actingOnBehalfOfUserId ?? null,
    actorPartnerUserId: args.actorPartnerUserId ?? null,
    engagementId: args.engagementId ?? null,
  };

  // Persist atomically. v25.0 fix: use raw SQL because the Drizzle schema (sacred
  // shared/schema.ts) declares only the base columns; the v15 additive columns
  // (tenant_id, company_id, classification, token_hash, invited_by_user_id, note,
  // redeemed_at, redeemed_by_user_id, created_at, updated_at) exist in the DB via
  // PRAGMA-guarded ALTERs in connection.ts but are silently dropped by Drizzle's
  // .values({ tokenHash: ... }). Raw SQL writes them correctly so /api/investor/
  // invitations/:token/kyc can find the row by token_hash (B-J7-5).
  // v25.35 — FAIL-CLOSED (BLOCKER #4): previously this swallowed the DB write
  // and still pushed the row to memory + returned a redeem token. An investor
  // could receive an emailed redeem link for a RAM-only invitation that 404s
  // after restart. We now throw on DB failure BEFORE emitting the token, the
  // CRM upsert, the email send, or the in-memory push — so no token is ever
  // returned for an invitation that did not durably persist.
  try {
    if (!delegated) {
      /* ---- FOUNDER PATH — statement text and all 20 binds are a VERBATIM slice of real
         :442-469. The ONLY change is a uniform +2-space indent from nesting inside this
         `if`. Whitespace-normalized diff vs the real slice: ZERO differences. ---- */
      db.prepare(
        `INSERT INTO round_invitations (
           id, round_id, investor_email, investor_name, investor_first_name, investor_last_name, state, expires_at, sent_at, viewed_at,
           tenant_id, company_id, classification, token_hash, invited_by_user_id, note,
           redeemed_at, redeemed_by_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.roundId,
        row.investorEmail,
        row.investorName ?? null,
        row.investorFirstName ?? null,
        row.investorLastName ?? null,
        row.state,
        row.expiresAt,
        row.sentAt,
        row.viewedAt,
        row.tenantId,
        row.companyId,
        row.classification,
        row.tokenHash,
        row.invitedByUserId,
        row.note,
        null,
        null,
        row.createdAt,
        row.updatedAt,
      );
    } else {
      /* ---- DELEGATED PATH — 25 columns. Positions 1-20 are byte-identical to the founder
         text above (column names AND bind expressions); positions 21-25 are migration
         0133's ALTER order. ---- */
      db.prepare(
        `INSERT INTO round_invitations (
           id, round_id, investor_email, investor_name, investor_first_name, investor_last_name, state, expires_at, sent_at, viewed_at,
           tenant_id, company_id, classification, token_hash, invited_by_user_id, note,
           redeemed_at, redeemed_by_user_id, created_at, updated_at,
           sourced_from_partner_id, sourced_from_partner_attribution_id,
           acting_on_behalf_of_user_id, actor_partner_user_id, engagement_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        row.id,
        row.roundId,
        row.investorEmail,
        row.investorName ?? null,
        row.investorFirstName ?? null,
        row.investorLastName ?? null,
        row.state,
        row.expiresAt,
        row.sentAt,
        row.viewedAt,
        row.tenantId,
        row.companyId,
        row.classification,
        row.tokenHash,
        row.invitedByUserId,
        row.note,
        null,
        null,
        row.createdAt,
        row.updatedAt,
        row.sourcedFromPartnerId ?? null,
        row.sourcedFromPartnerAttributionId ?? null,
        row.actingOnBehalfOfUserId ?? null,
        row.actorPartnerUserId ?? null,
        row.engagementId ?? null,
      );
    }
  } catch (err) {
    const emsg = (err as Error).message ?? "";
    // v25.53 REVISE B3 (6a) — DB-authoritative race guard. The partial UNIQUE
    // index uq_round_invite_active_email (migration 0099 / connection.ts inline)
    // rejects a second ACTIVE invite for the same (round_id, normalized email)
    // even when two concurrent requests both passed the preflight SELECT. Map
    // that UNIQUE violation to the same typed `duplicate_invitation` the
    // preflight throws (route → 409), NOT a 500 — the loser of the race is a
    // client conflict, not a server failure. No token/email/CRM/memory side
    // effect has happened yet, so failing here is clean.
    if (/UNIQUE constraint failed/i.test(emsg)) {
      throw new Error("duplicate_invitation");
    }
    // v25.35 — fail-closed: do NOT push to memory, do NOT send the email, do
    // NOT return a token. Surface to the route so it returns 500.
    log.error(
      "[roundInvitationsStore.createInvitation] DB write failed:",
      emsg,
    );
    throw err;
  }

  /* ---- §9.3-A — the delegated write's audit row, on the SAME `db` handle so it commits or
     rolls back with the invitation row. Founder path: not reached.

     D1b-APPLY-NOTE (assumption A-APPLY-1, logged in the apply report): §9.3-A's canonical
     `appendMfEngagementEvent(db, {...})` centralizer does NOT exist in this tree — grep for
     `appendMfEngagementEvent` across server/ returns 0 hits, and the only existing
     `mf_engagement_event` writer is `managedFounderStore.ts:228`'s module-PRIVATE
     `recordEvent`, which calls `rawDb()` itself (so it would write OUTSIDE this transaction)
     and does not populate 0131's five LOCK-3-A columns. Rather than emit a call that would
     throw `appendMfEngagementEvent is not a function` on the first delegated write, this
     block PREFERS §9.3-A's centralizer when it exists and otherwise falls back to a
     transaction-correct local INSERT with identical semantics. When §9.3-A lands in
     managedFounderStore.ts the fallback becomes dead and the lazy require takes over with no
     edit here. The lazy `require` is the file's own :33 `createRequire` idiom, so the founder
     path never resolves managedFounderStore at all.

     `eventData` is passed as an OBJECT, not pre-stringified: §9.3-A owns JSON.stringify
     (V33-4-M1). The local fallback stringifies once, into BOTH `detail_json` (the pre-C-2
     column `recordEvent` uses) and `event_data_json` (0131's additive column), so the row is
     readable by both the old and the new reader. ---- */
  if (delegated) {
    const eventPayload = {
      partnerId: args.partnerId!,
      engagementId: args.engagementId!,
      companyId: args.companyId ?? null,
      eventType: "delegated_write",
      actor: args.actorPartnerUserId!,
      actorRole: "partner",
      actorPartnerUserId: args.actorPartnerUserId!,
      actingOnBehalfOfUserId: args.actingOnBehalfOfUserId ?? null,
      partnerAttributionId: args.partnerAttributionId!,
      eventData: { route: args.routePath ?? "POST /api/rounds/:id/invitations" },
    };
    let appended = false;
    try {
      const mfs = require("./managedFounderStore");
      if (typeof mfs?.appendMfEngagementEvent === "function") {
        mfs.appendMfEngagementEvent(db, eventPayload);
        appended = true;
      }
    } catch (reqErr) {
      // Module resolution failed. Fall through to the local INSERT; do NOT swallow the
      // audit obligation. Logged so the condition is visible in boot logs.
      log.warn(
        "[roundInvitationsStore.createInvitation] managedFounderStore resolve failed, using local audit append:",
        (reqErr as Error).message,
      );
    }
    if (!appended) {
      const detailJson = JSON.stringify(eventPayload.eventData);
      db.prepare(
        `INSERT INTO mf_engagement_event (
           id, partner_id, engagement_id, company_id, event_type, detail_json, actor, created_at,
           actor_role, actor_partner_user_id, acting_on_behalf_of_user_id,
           partner_attribution_id, event_data_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `mfev_${sha256Hex(`${row.id}|${eventPayload.eventType}|${row.createdAt}`).slice(0, 32)}`,
        eventPayload.partnerId,
        eventPayload.engagementId,
        eventPayload.companyId,
        eventPayload.eventType,
        detailJson,
        eventPayload.actor,
        row.createdAt,
        eventPayload.actorRole,
        eventPayload.actorPartnerUserId,
        eventPayload.actingOnBehalfOfUserId,
        eventPayload.partnerAttributionId,
        detailJson,
      );
    }
  }

  return { row, tokenPlain };
}

/**
 * The FOUNDER path. Public signature is UNCHANGED from real :368.
 *
 * Dispatches to `createDelegatedInvitation` when all seven delegated args are present, and
 * hard-fails a PARTIAL set (V33-4-B1) rather than silently writing a founder row that drops
 * provenance. `DELEGATED_ARGS_INCOMPLETE` carries `statusCode: 500` because it signals
 * implementer misuse, not a caller-facing authorization failure — routes.ts's DELEGATED_403
 * allowlist deliberately EXCLUDES it.
 */
export async function createInvitation(args: CreateInvitationArgs): Promise<CreateInvitationResult> {
  const delegatedPresent = [
    args.actorPartnerUserId, args.actingOnBehalfOfUserId, args.partnerAttributionId,
    args.engagementId, args.partnerId, args.routePath, args.authorityArtifactId,
  ].filter((v) => v != null && v !== "").length;
  if (delegatedPresent === 7) {
    return createDelegatedInvitation(args as Parameters<typeof createDelegatedInvitation>[0]);
  }
  if (delegatedPresent !== 0) {
    throw Object.assign(new Error("DELEGATED_ARGS_INCOMPLETE"), { statusCode: 500 });
  }

  // LOCK 5 atomic boundary — founder path. `delegated` omitted ⇒ 20-column INSERT.
  const db = rawDb();                                                            // real :441
  const { row, tokenPlain } = db.transaction(() => createInvitationTx(db, args))();

  // POST-COMMIT side effects, in the real code's exact order.
  // v25.35 — in-memory mirror updated only AFTER the durable DB insert.
  memInvitations.push(row);                                                       // real :492

  // L-010 fix v23.4.13: also create CRM contact
  // Non-fatal: best-effort; invitation creation must not fail if CRM upsert fails.
  try {
    upsertCrmContactForInvitation({                                               // real :497-507
      companyId: args.companyId,
      name: args.investorName ?? null,
      email: row.investorEmail,
      classification: row.classification,
      roundId: args.roundId,
      // v25.53 8a — optional CRM-aligned fields (best-effort persistence).
      company: args.investorCompany ?? null,
      stageFocus: args.stageFocus ?? null,
      typicalMarketSize: args.typicalMarketSize ?? null,
    });
  } catch (crmErr) {
    log.warn("[roundInvitationsStore] CRM upsert failed (non-fatal):", (crmErr as Error).message);
  }

  const em = await sendInvitationEmailInline(row, tokenPlain, args);              // real :512-590

  // Real-time emission so any open founder dashboard sees the new row.
  emitMutation({                                                                  // real :567-572
    aggregate: "invitation",
    id: row.id,
    change: "create",
    tenantId: row.tenantId ?? undefined,
  });
  emitMutation({                                                                  // real :573-578
    aggregate: "round",
    id: row.roundId,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });

  // L-006 fix v23.4.13: return redeemUrl on create (raw token never stored in list view)
  const appUrl = process.env.APP_URL ?? process.env.INVITATION_BASE_URL ?? "https://capavate.com";
  const redeemUrl = `${appUrl}/invite/${encodeURIComponent(tokenPlain)}`;          // real :601

  return {                                                                        // real :603-612
    invitation: publicView(row) as any,
    emailSent: em.emailSent,
    // v25.52 Avi-BUG-1 — honest delivery signals.
    emailMode: em.emailMode,
    emailDelivered: em.emailDelivered,
    emailMessageId: em.emailMessageId,
    classification: row.classification as InvitationClassification,
    redeemUrl,
  };
}

/**
 * Module-private. Body transposed verbatim from real :512-590.
 *
 * NEVER throws: an outer safety net returns `{ emailSent: false, ... }`, so a COMMITTED
 * transaction can never be lost to a post-commit send failure. Only mechanical change vs the
 * real slice: `sendMail({ to: investorEmail })` → `to: row.investorEmail` (identical value —
 * real :409 assigns `row.investorEmail` from `investorEmail`).
 */
async function sendInvitationEmailInline(
  row: RoundInvitationRow,
  tokenPlain: string,
  args: CreateInvitationArgs,
): Promise<{ emailSent: boolean; emailMode?: string; emailDelivered?: boolean; emailMessageId?: string }> {
  // v25.52 Avi-BUG-1 — resolved up-front so the safety-net return can report it too.
  const emailMode = (() => {                                                      // real :584-586
    try { return getEmailConfig().mode; } catch { return "console"; }
  })();
  try {
    // Send the email. The redeem link includes the RAW token, never the hash.
    // Production deploys should set INVITATION_BASE_URL.
    const baseUrl = process.env.INVITATION_BASE_URL ?? process.env.APP_URL ?? "https://capavate.com";
    // v24.4 BUG 047 + 048 — resolve company + round display names so the subject
    // is unique per deal. A unique subject (a) gives investors the deal context
    // they were missing, and (b) prevents email clients from threading unrelated
    // invitations into a single conversation. Lookups are best-effort; if either
    // store misses we fall back to neutral labels rather than failing the send.
    let companyName = "a company";
    let roundName = "a funding round";
    try {
      const resolvedCompany = getCompanyNameById(args.companyId);
      if (resolvedCompany && resolvedCompany.trim()) companyName = resolvedCompany.trim();
    } catch { /* non-fatal */ }
    try {
      const resolvedRound = getRoundById(args.roundId);
      if (resolvedRound?.name && resolvedRound.name.trim()) roundName = resolvedRound.name.trim();
    } catch { /* non-fatal */ }
    // v24.1 Bug I+K (BUG 042): canonical client route is /auth/redeem (App.tsx:406).
    // The legacy /invitations/redeem path is not registered in the SPA and produced
    // the "we don't recognise this invitation" error for Avi #4/#5/#10.
    const link = `${baseUrl}/auth/redeem?token=${encodeURIComponent(tokenPlain)}`;
    let emailSent = false;
    let emailMessageId: string | undefined;
    if (!args.dryRun) {
      try {
        // Wave C3 (Shadie 2a) — render through the shared renderer so the sent
        // email is byte-identical to the founder's preview.
        const composed = renderInvitationEmail({
          investorName: args.investorName,
          companyName,
          roundName,
          link,
          note: args.note,
          expiryDays: args.expiryDays ?? 14,
        });
        const result = await sendMail({
          to: row.investorEmail,
          subject: composed.subject,
          html: composed.html,
          text: composed.text,
        });
        emailSent = !!result.ok;
        emailMessageId = result.messageId;
      } catch (err) {
        log.warn(
          "[roundInvitationsStore.createInvitation] email send failed (continuing):",
          (err as Error).message,
        );
      }
    } else {
      emailSent = true; // tests treat dry-run as success
    }
    // emailDelivered is true ONLY for a REAL smtp send: not console, not dry_run.
    // (GPT-5.5 review 20260706 — exclude the internal dryRun path which sets
    // emailSent=true without transmitting anything.)
    const emailDelivered = emailSent && emailMode === "smtp" && !args.dryRun;
    return { emailSent, emailMode, emailDelivered, emailMessageId };
  } catch (outerErr) {
    // Safety net — the transaction is ALREADY committed at this point. Never rethrow.
    log.warn(
      "[roundInvitationsStore.createInvitation] email stage failed (continuing):",
      (outerErr as Error).message,
    );
    return { emailSent: false, emailMode, emailDelivered: false, emailMessageId: undefined };
  }
}

/**
 * §7.6 — the PARTNER-DELEGATED path. New export; not on the founder call path.
 *
 * All seven delegated fields are REQUIRED `string` (not `| null`) so Predicate 5 cannot be
 * bypassed by omitting `routePath`.
 *
 * Seven transactional predicates, ALL inside `db.transaction(() => { ... })()`, ALL via direct
 * `db.prepare().get()` on the transaction's own handle — V33-3-B1: no cache-backed store
 * methods, because `partnerTeamStore` / `partnerAttributionStore` / `managedFounderStore` keep
 * in-memory maps that can lag DB state or be primed by a concurrent write. These predicates
 * INTENTIONALLY duplicate `delegatedAgency.ts`'s route-layer preflight: the preflight is the
 * fast fail-closed check, this is the ToC/ToU close. Neither is redundant.
 *
 * Every denial throws a typed error whose message routes.ts maps to a 403 via its DELEGATED_403
 * allowlist. Throwing INSIDE the transaction guarantees no partial write survives.
 */
export async function createDelegatedInvitation(
  args: CreateInvitationArgs & {
    actorPartnerUserId: string; actingOnBehalfOfUserId: string; partnerAttributionId: string;
    engagementId: string;       partnerId: string;              routePath: string;
    authorityArtifactId: string;
  },
): Promise<CreateInvitationResult> {
  const db = rawDb();
  const nowLit = nowIso();

  const { row, tokenPlain } = db.transaction(() => {
    /* ── Predicate 1 — team membership still active, still bound to the same partner_id.
       partner_id is bound in the WHERE so an actor with two active memberships is authorized
       ONLY for the org the route resolved (multi-membership determinism, V33-4-M2). ── */
    const teamMemberRow = db
      .prepare(
        `SELECT id, partner_id AS partnerId, sub_role AS subRole, user_id AS userId
           FROM partner_team_members
          WHERE user_id = ?
            AND partner_id = ?
            AND status = 'active'
            AND removed_at IS NULL
          LIMIT 1`,
      )
      .get(args.actorPartnerUserId, args.partnerId) as
      | { id: string; partnerId: string; subRole: string; userId: string }
      | undefined;
    if (!teamMemberRow) throw new Error("PARTNER_MISMATCH");
    // V33-5-N5: ONE source of truth for the sub-role allowlist, shared with the route layer
    // and with delegatedAgency's P0.
    if (!(DELEGATED_WRITE_SUB_ROLES as readonly string[]).includes(teamMemberRow.subRole)) {
      throw new Error("SUB_ROLE_NOT_ALLOWED");
    }
    // Belt-and-braces post-hoc compare: the WHERE already bound it, but an explicit assert
    // makes a future query edit that drops the bind fail loudly rather than silently widen.
    if (teamMemberRow.partnerId !== args.partnerId) throw new Error("PARTNER_MISMATCH");

    /* ── Predicate 1-B (V33-5-B2) — active consortium-partner organization. Mirrors real
       requirePartnerAuth.ts:56. This is the ToC/ToU close for the org-status window that the
       route layer deliberately does NOT duplicate (D1-08). ── */
    const partnerContactRow = db
      .prepare(`SELECT kind, status FROM contacts WHERE id = ?`)
      .get(args.partnerId) as { kind: string; status: string } | undefined;
    if (
      !partnerContactRow ||
      partnerContactRow.kind !== "consortium_partner" ||
      partnerContactRow.status !== "active"
    ) {
      throw new Error("PARTNER_NOT_ACTIVE");
    }

    /* ── Predicate 2 (V33-5-B1) — attribution PINNED BY ID (not "latest for this company"),
       plus §5.2's six-conjunct engagement_letter_active. Binding `id` closes the window where
       a newer attribution row supersedes the one the route preflight authorized. ── */
    const attributionRow = db
      .prepare(
        `SELECT id, partner_id AS partnerId, company_id AS companyId,
                client_authority_scope_json AS scopeJson,
                authority_artifact_id AS authorityArtifactId,
                engagement_letter_effective_at AS letterEffectiveAt,
                engagement_letter_expires_at   AS letterExpiresAt,
                engagement_letter_revoked_at   AS letterRevokedAt
           FROM partner_attributions
          WHERE id = ?
            AND partner_id = ?
            AND company_id = ?
            AND revoked_at IS NULL
          LIMIT 1`,
      )
      .get(args.partnerAttributionId, args.partnerId, args.companyId) as
      | {
          id: string;
          partnerId: string;
          companyId: string;
          scopeJson: string | null;
          authorityArtifactId: string | null;
          letterEffectiveAt: string | null;
          letterExpiresAt: string | null;
          letterRevokedAt: string | null;
        }
      | undefined;
    if (!attributionRow) throw new Error("ATTRIBUTION_REVOKED");

    /* §5.2's six-conjunct `engagement_letter_active`, with A-C2J-08's hardening ADOPTED as
       A-D1-20. Conjunct 1 (`revoked_at IS NULL`) is in the WHERE clause above. Every
       nullability test is an explicit `=== null` / `!== null` — NO truthy coercion, because a
       NULL `engagement_letter_effective_at` must fail CLOSED (§5.2 requires
       `IS NOT NULL AND <= :now`; an earlier draft had this exactly backwards). */
    const letterActive =
         attributionRow.letterRevokedAt === null                       // conjunct 5
      && attributionRow.letterEffectiveAt !== null                     // conjunct 2 ← NULL FAILS CLOSED
      && attributionRow.letterEffectiveAt <= nowLit                    // conjunct 3
      && (attributionRow.letterExpiresAt === null                      // conjunct 4a
          || attributionRow.letterExpiresAt >= nowLit)                 // conjunct 4b
      // conjunct 6, HARDENED (A-D1-20): read the artifact id FROM THE ROW rather than
      // trusting `args`, and pin it to the id the route preflight resolved. Closes the
      // ToC/ToU window where the attribution's authority_artifact_id is nulled or swapped
      // between preflight and transaction.
      && attributionRow.authorityArtifactId !== null
      && attributionRow.authorityArtifactId === args.authorityArtifactId;
    if (!letterActive) throw new Error("ENGAGEMENT_LETTER_REVOKED");

    /* ── Predicate 3 — engagement PINNED BY ID, ACTIVE, not founder-revoked. `founder_revoked_at`
       is added by migration 0131; pre-0131 this query raises `no such column`, which propagates
       as a 500 by design (a missing migration is an operator error, not a client 403). ── */
    const engagementRow = db
      .prepare(
        `SELECT id, partner_id AS partnerId, company_id AS companyId, status
           FROM mf_engagement
          WHERE id = ?
            AND partner_id = ?
            AND company_id = ?
            AND status = 'ACTIVE'
            AND founder_revoked_at IS NULL
          LIMIT 1`,
      )
      .get(args.engagementId, args.partnerId, args.companyId) as
      | { id: string; partnerId: string; companyId: string; status: string }
      | undefined;
    if (!engagementRow) throw new Error("ENGAGEMENT_REVOKED");

    /* ── Predicate 4 — signed partner agreement. Bound to the partner ORG contact id
       (`teamMemberRow.partnerId`), NOT the user id. ── */
    const agreement = db
      .prepare(`SELECT partner_agreement_signed_at AS signedAt FROM contacts WHERE id = ?`)
      .get(teamMemberRow.partnerId) as { signedAt: string | null } | undefined;
    if (!agreement?.signedAt) throw new Error("AGREEMENT_NOT_SIGNED");

    /* ── Predicate 4-B — the authority artifact, EXACT row. `kind = 'engagement_letter'` is
       REQUIRED: without it any dpa / referral_consent / client_authority_scope row on the same
       attribution would satisfy the predicate (0130's `kind` CHECK is a four-value list).
       `expires_at IS NULL` means perpetual, per §5.2's unified date-nullability rule. ── */
    const artifactRow = db
      .prepare(
        `SELECT id
           FROM authority_artifacts
          WHERE id = ?
            AND partner_attribution_id = ?
            AND kind = 'engagement_letter'
            AND revoked_at IS NULL
            AND effective_at <= ?
            AND (expires_at IS NULL OR expires_at >= ?)
          LIMIT 1`,
      )
      .get(attributionRow.authorityArtifactId, attributionRow.id, nowLit, nowLit) as
      | { id: string }
      | undefined;
    if (!artifactRow) throw new Error("AUTHORITY_ARTIFACT_MISSING_OR_EXPIRED");

    /* ── Predicate 5 — route scope. FAIL-CLOSED: an unmapped route is SCOPE_NOT_MAPPED, never
       "no scope required". `engagementHasScope` does EXACT string membership — no wildcard, no
       prefix matching, no case-folding. ── */
    const requiredScope = ROUTE_SCOPE_MAP[args.routePath];
    if (requiredScope === undefined) throw new Error("SCOPE_NOT_MAPPED");
    if (!engagementHasScope(attributionRow.scopeJson, requiredScope)) {
      throw new Error("SCOPE_NOT_GRANTED");
    }

    // All seven predicates passed. Write the 25-column row + its §9.3-A audit row on THIS
    // transaction's handle, so both commit or neither does.
    return createInvitationTx(db, args, /* delegated */ true);
  })();

  /* ── POST-COMMIT side effects — identical to the founder sequence plus one extra emit. ── */
  memInvitations.push(row);

  try {
    upsertCrmContactForInvitation({
      companyId: args.companyId,
      name: args.investorName ?? null,
      email: row.investorEmail,
      classification: row.classification,
      roundId: args.roundId,
      company: args.investorCompany ?? null,
      stageFocus: args.stageFocus ?? null,
      typicalMarketSize: args.typicalMarketSize ?? null,
    });
  } catch (crmErr) {
    log.warn("[roundInvitationsStore] CRM upsert failed (non-fatal):", (crmErr as Error).message);
  }

  const em = await sendInvitationEmailInline(row, tokenPlain, args);

  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "create",
    tenantId: row.tenantId ?? undefined,
  });
  emitMutation({
    aggregate: "round",
    id: row.roundId,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
  /* LOCK 4 / §15.4 (V33-F2) — the partnerRepresentation aggregate, so an open partner
     workspace sees the delegated write land. Composite id is `${partnerId}:${companyId}`,
     the form `eventBus.ts`'s LOCK 4 branch parses via `parsePartnerRepresentationId`. */
  emitMutation({
    aggregate: "partnerRepresentation",
    id: `${args.partnerId}:${args.companyId}`,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });

  const appUrl = process.env.APP_URL ?? process.env.INVITATION_BASE_URL ?? "https://capavate.com";
  const redeemUrl = `${appUrl}/invite/${encodeURIComponent(tokenPlain)}`;

  return {
    // The ONE genuinely new, partner-only surface — so the ONE place
    // `partnerInvitationView` is used (A-D1-19). All eight existing `publicView` sites,
    // including the founder return above, stay byte-identical.
    invitation: partnerInvitationView(row) as any,
    emailSent: em.emailSent,
    emailMode: em.emailMode,
    emailDelivered: em.emailDelivered,
    emailMessageId: em.emailMessageId,
    classification: row.classification as InvitationClassification,
    redeemUrl,
  };
}

/* ---------- Redeem ---------- */

export interface RedeemInvitationArgs {
  /** Raw token from the email link. */
  token: string;
  redeemedByUserId: string;
}

export interface RedeemInvitationResult {
  invitation: Omit<RoundInvitationRow, "tokenHash">;
}

export function redeemInvitation(args: RedeemInvitationArgs): RedeemInvitationResult {
  if (!args.token) throw new Error("missing_token");
  if (!args.redeemedByUserId) throw new Error("missing_user");
  const tokenHash = sha256Hex(args.token);
  const now = nowIso();

  // v25.35 (BLOCKER #12) — DB-first lookup so a cold cache after restart still
  // resolves a genuinely-persisted invitation instead of throwing invalid_token.
  let row = memInvitations.find((r) => r.tokenHash === tokenHash);
  if (!row) {
    const dbRow = dbFindByTokenHash(tokenHash);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  if (!row) throw new Error("invalid_token");

  // Single-use guard.
  if (row.redeemedAt || row.state === "accepted") throw new Error("already_redeemed");
  if (row.state === "revoked") throw new Error("revoked");
  if (row.state === "declined") throw new Error("declined");
  if (row.state === "expired") throw new Error("expired");

  // Expiry guard.
  if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) {
    row.state = "expired";
    row.updatedAt = now;
    try {
      const db: any = getDb();
      db.transaction((tx: any) => {
        tx.update(invitationsTable)
          .set({ state: "expired", updatedAt: now } as any)
          .where(eq(invitationsTable.id, row.id))
          .run();
      });
    } catch (err) {
      // tolerated
    }
    emitMutation({
      aggregate: "invitation",
      id: row.id,
      change: "update",
      tenantId: row.tenantId ?? undefined,
    });
    throw new Error("expired");
  }

  /* v25.17 Lane A NH3 — close the TOCTOU race: the in-memory guard above
     can be raced by two concurrent redeem calls. We commit the DB UPDATE
     conditionally on `state = 'pending'` first; only when changes === 1 do
     we mark the in-memory row accepted. Concurrent calls see changes === 0
     and surface 'already_redeemed'. */
  // v25.35 fix-2 (Concern 3) — persist-first-throw. Previously a DB write
  // failure here fell through to a memory-only "success" path, so a redeem
  // could report success to the caller (and consume the token in RAM) while
  // the durable invitation row stayed `sent`/`pending`. After a restart the
  // invitation would be redeemable again. We now require a durable conditional
  // UPDATE: on DB error we throw (route -> 500) and the in-memory row is NOT
  // mutated; `already_redeemed` is preserved for the concurrent-redeem race.
  let acceptedRowsDb = 0;
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      const result = tx.update(invitationsTable)
        .set({
          state: "accepted",
          redeemedAt: now,
          redeemedByUserId: args.redeemedByUserId,
          updatedAt: now,
        } as any)
        .where(and(
          eq(invitationsTable.id, row.id),
          // v25.18 Lane A NC2 — invitations are created with state='sent',
          // not 'pending'. Both are redeemable; only `accepted` / `revoked`
          // / `expired` are terminal.
          inArray(invitationsTable.state as any, ["pending", "sent"] as any),
        ))
        .run();
      acceptedRowsDb = Number((result as { changes?: number }).changes ?? 0);
    });
    if (acceptedRowsDb === 0) {
      // Another concurrent redeem won the race. Surface that to the caller.
      throw new Error("already_redeemed");
    }
  } catch (err) {
    // v25.35 fix-2 (Concern 3) — fail-closed: the in-memory state has NOT been
    // mutated yet. Propagate the original error so the route returns 500
    // (or 409 for `already_redeemed`). Do NOT silently fall back to memory.
    if ((err as Error).message !== "already_redeemed") {
      log.error(
        "[roundInvitationsStore.redeemInvitation] DB write failed:",
        (err as Error).message,
      );
    }
    throw err;
  }

  // v25.35 fix-2 (Concern 3) — in-memory mirror updated only AFTER the durable
  // conditional UPDATE committed.
  row.state = "accepted";
  row.redeemedAt = now;
  row.redeemedByUserId = args.redeemedByUserId;
  row.updatedAt = now;

  // W-FIX3 2a (redeem self-heal) — if a legacy invitation persisted a NULL
  // companyId, resolve it from the round and backfill it now that the invite is
  // accepted, so the accepted row is never company-less (the root cause of the
  // empty investor cap-table / dataroom). Purely ADDITIVE: only fires when
  // companyId is null; an existing non-null value is never overwritten. Runs
  // AFTER the money/token-critical redeem commit and is fully guarded, so it can
  // never affect redeem success/failure. Uses raw SQL because the durable
  // `company_id` column is not modelled on the drizzle invitations table.
  if (!row.companyId) {
    const derived = getRoundById(row.roundId)?.companyId ?? null;
    if (derived) {
      try {
        rawDb()
          .prepare(
            "UPDATE round_invitations SET company_id = ?, updated_at = ? WHERE id = ? AND (company_id IS NULL OR company_id = '')",
          )
          .run(derived, now, row.id);
        row.companyId = derived;
      } catch (err) {
        log.warn(
          "[roundInvitationsStore.redeemInvitation] companyId self-heal skipped:",
          (err as Error).message,
        );
      }
    }
  }

  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
  emitMutation({
    aggregate: "round",
    id: row.roundId,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });

  return { invitation: publicView(row) };
}

/* ---------- Reads ---------- */

export function listForRound(roundId: string): Array<Omit<RoundInvitationRow, "tokenHash">> {
  // v25.35 (BLOCKER #12) — DB-first: merge DB rows with the cache so a cold
  // cache does not under-report invitations for the round.
  const cacheRows = memInvitations.filter((r) => r.roundId === roundId);
  const merged = mergeForRead(dbFindByRound(roundId), cacheRows);
  return merged.filter((r) => r.roundId === roundId).map(publicView);
}

export function listForCompany(companyId: string): Array<Omit<RoundInvitationRow, "tokenHash">> {
  // v25.35 (BLOCKER #12) — DB-first merge for cold-cache correctness.
  const cacheRows = memInvitations.filter((r) => r.companyId === companyId);
  const merged = mergeForRead(dbFindByCompany(companyId), cacheRows);
  return merged.filter((r) => r.companyId === companyId).map(publicView);
}

export function getInvitation(id: string): Omit<RoundInvitationRow, "tokenHash"> | null {
  // v25.35 (BLOCKER #12) — DB-first lookup with cache fallback.
  let row = memInvitations.find((r) => r.id === id);
  if (!row) {
    const dbRow = dbFindById(id);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  return row ? publicView(row) : null;
}

/**
 * v23.9 A3/W-9 — every invitation (any state). The admin Investors panel
 * aggregates these (deduped by email) into the real investor directory so it
 * no longer ships hard-coded sample investors.
 */
export function listAllInvitations(): Array<Omit<RoundInvitationRow, "tokenHash">> {
  return memInvitations.map(publicView);
}

/**
 * v23.8 W-9 — return every invitation that has been redeemed/accepted. The
 * admin Investors panel uses this to surface REAL investors (those who have
 * accepted a round invite) instead of only the demo-seeded CRM contacts, which
 * are empty in production.
 */
export function getRedeemedRecords(): Array<Omit<RoundInvitationRow, "tokenHash">> {
  return memInvitations
    .filter((r) => r.state === "accepted" || r.redeemedAt != null)
    .map(publicView);
}

/* ---------- L-009 helpers v23.4.13: bridge to authRoutes ---------- */

/**
 * L-009 helper v23.4.13: findByTokenHash
 * Looks up the in-memory invitation row whose tokenHash equals `hash`
 * and whose state is not yet redeemed. Returns null if not found.
 * Uses the in-memory mirror (memInvitations) — same fast-path as all
 * other reads in this file; DB is the source of truth at hydration only.
 */
export function findByTokenHash(hash: string): RoundInvitationRow | null {
  // v25.35 (BLOCKER #12) — DB-first lookup with cache fallback so the redeem
  // bridge resolves persisted invitations after a restart.
  let row = memInvitations.find((r) => r.tokenHash === hash);
  if (!row) {
    const dbRow = dbFindByTokenHash(hash);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  return row ?? null;
}

/**
 * L-009 helper v23.4.13: markInvitationRedeemed
 *
 * v25.18 Lane A NC1/NC2 hard close:
 *   The pre-v25.18 implementation performed an unconditional UPDATE-by-id,
 *   which (a) re-opened the v25.17 NH3 TOCTOU race (two concurrent redeems
 *   could both succeed) and (b) the v25.17 patch landed on a sibling that is
 *   never called. We now perform a conditional UPDATE in the only
 *   redeemable states (`pending` and `sent`); the raw-sqlite `changes`
 *   counter tells us whether we actually flipped the row. Concurrent callers
 *   see false and must surface `already_redeemed`.
 */
export function markInvitationRedeemed(id: string, redeemedByUserId?: string | null): boolean {
  // v25.35 (BLOCKER #12) — DB-first lookup with cache fallback.
  let row = memInvitations.find((r) => r.id === id);
  if (!row) {
    const dbRow = dbFindById(id);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  if (!row) return false;
  // v25.18 — only allow transition from a redeemable state.
  if (row.state !== "pending" && row.state !== "sent") return false;
  const now = nowIso();
  // DB-first conditional UPDATE. If we wrote zero rows somebody else
  // already redeemed; do NOT touch the in-memory copy.
  let dbChanged = 0;
  try {
    const stmt = rawDb().prepare(
      "UPDATE round_invitations SET state = 'accepted', redeemed_at = ?, redeemed_by_user_id = ?, updated_at = ? " +
      "WHERE id = ? AND state IN ('pending','sent')",
    );
    const r = stmt.run(now, redeemedByUserId ?? null, now, id);
    dbChanged = Number((r as any).changes ?? 0);
  } catch (err) {
    log.warn(
      "[roundInvitationsStore.markInvitationRedeemed] DB write failed:",
      (err as Error).message,
    );
    // Fall through — in-memory only update below if DB unavailable.
  }
  if (dbChanged === 0) {
    // DB row was already redeemed by a concurrent caller (or doesn't exist).
    // Refuse to mutate in-memory state.
    return false;
  }
  row.state = "accepted";
  row.redeemedAt = now;
  row.redeemedByUserId = redeemedByUserId ?? null;
  row.updatedAt = now;
  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
  return true;
}

/* ---------- Lifecycle ---------- */

export function revokeInvitation(id: string, actorUserId: string): void {
  const row = memInvitations.find((r) => r.id === id);
  if (!row) return;
  // Wave C1 (Shadie 3a) FAIL-CLOSED — revoking an ALREADY-revoked invitation is a
  // no-op: no DB write, no cache mutation, and (critically) NO notification.
  // The prior code re-ran the UPDATE + could re-notify a revoked investor.
  if (row.state === "revoked") throw new Error("ALREADY_REVOKED");
  // v25.55 4a (Ozan / Scenario 2) — an accepted invite CAN now be revoked so
  // the founder can pull access from an investor who redeemed but should no
  // longer participate. The accepted->revoked transition persists via the
  // UPDATE path below; access is cut automatically because buildInvitedRounds
  // filters out `revoked`. (A committed investor holding a cap-table position
  // keeps their seat — that access does not flow through the invite.)
  // v25.35 fix-2 (Concern 3) — persist-first-throw. Previously the in-memory
  // row was flipped to `revoked` BEFORE the DB update, and the DB failure was
  // tolerated, so a revoke could report success while the durable row stayed
  // active. We now stage the new state, persist FIRST, throw on DB failure
  // (route -> 500), and mutate the cache only after the durable commit.
  const updatedAt = nowIso();
  // v25.35 fix-3 (Concern 3, GPT-5.5 strict re-verify) — also verify the
  // UPDATE actually affected a durable row. If the DB row is missing (deleted
  // by another process, never persisted, or wrong tenant) the update matches
  // zero rows and we must NOT mutate the cache to revoked. Use rawDb so we
  // can read `info.changes`.
  let revokeAffected = 0;
  try {
    const info = rawDb()
      .prepare(
        `UPDATE round_invitations SET state = 'revoked', updated_at = ? WHERE id = ?`,
      )
      .run(updatedAt, row.id);
    revokeAffected = info.changes;
  } catch (err) {
    log.error(
      "[roundInvitationsStore.revokeInvitation] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  if (revokeAffected === 0) {
    // Durable row is gone — drop the stale cache entry and surface a
    // not-found error so the caller cannot believe the revoke succeeded.
    const idx = memInvitations.findIndex((r) => r.id === row.id);
    if (idx >= 0) memInvitations.splice(idx, 1);
    throw new Error(`Invitation ${row.id} not found in DB; cache cleared`);
  }
  // v25.35 fix-2 (Concern 3) — cache mutated only after the durable commit.
  row.state = "revoked";
  row.updatedAt = updatedAt;
  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
}

export function extendInvitation(id: string, expiryDays: number, _actorUserId: string): void {
  const row = memInvitations.find((r) => r.id === id);
  if (!row) return;
  // Wave C1 (Shadie 4a) FAIL-CLOSED — a terminal invitation cannot have its
  // expiry extended. Revoked access is gone; an accepted investor no longer
  // needs an expiry (Ozan: disable extend for revoked AND accepted).
  if (row.state === "revoked") throw new Error("INVITATION_REVOKED");
  if (row.state === "accepted") throw new Error("INVITATION_ACCEPTED");
  // v25.35 fix-2 (Concern 3) — persist-first-throw. Previously the in-memory
  // expiry was extended BEFORE the DB update and the DB failure was tolerated,
  // so an extend could report success while the durable row kept the old
  // expiry. We now stage the new expiry, persist FIRST, throw on DB failure
  // (route -> 500), and mutate the cache only after the durable commit.
  // v25.55 6a (Ozan) — the extension is ADDITIVE: anchor +expiryDays on the
  // LATER of now / the current expiry so re-extending a still-live invite
  // actually pushes the expiry out (previously `now+days` could look unchanged
  // when the current expiry was already further in the future).
  const anchorMs = Math.max(Date.now(), Date.parse(row.expiresAt ?? "") || 0);
  const expiresAt = plusDaysIso(expiryDays, new Date(anchorMs));
  const updatedAt = nowIso();
  // v25.35 fix-3 (Concern 3, GPT-5.5 strict re-verify) — same zero-row guard
  // as revoke. If the DB row is missing, do not silently extend the cached
  // expiry; drop the cache entry and throw.
  let extendAffected = 0;
  try {
    const info = rawDb()
      .prepare(
        `UPDATE round_invitations SET expires_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(expiresAt, updatedAt, row.id);
    extendAffected = info.changes;
  } catch (err) {
    log.error(
      "[roundInvitationsStore.extendInvitation] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }
  if (extendAffected === 0) {
    const idx = memInvitations.findIndex((r) => r.id === row.id);
    if (idx >= 0) memInvitations.splice(idx, 1);
    throw new Error(`Invitation ${row.id} not found in DB; cache cleared`);
  }
  // v25.35 fix-2 (Concern 3) — cache mutated only after the durable commit.
  row.expiresAt = expiresAt;
  row.updatedAt = updatedAt;
  emitMutation({
    aggregate: "invitation",
    id: row.id,
    change: "update",
    tenantId: row.tenantId ?? undefined,
  });
}

/* ---------- Resend / notify (v25.55 4a + 5a/5b) ---------- */

/** Resolve human-readable company + round display names, best-effort. */
function resolveDealNames(companyId: string | null, roundId: string): { companyName: string; roundName: string } {
  let companyName = "a company";
  let roundName = "a funding round";
  try {
    const resolved = companyId ? getCompanyNameById(companyId) : null;
    if (resolved && resolved.trim()) companyName = resolved.trim();
  } catch { /* non-fatal */ }
  try {
    const resolved = getRoundById(roundId);
    if (resolved?.name && resolved.name.trim()) roundName = resolved.name.trim();
  } catch { /* non-fatal */ }
  return { companyName, roundName };
}

/** Locate a row in the cache, falling back to the DB (opportunistically cached). */
function findRowById(id: string): RoundInvitationRow | null {
  let row = memInvitations.find((r) => r.id === id);
  if (!row) {
    const dbRow = dbFindById(id);
    if (dbRow) row = cacheUpsert(dbRow);
  }
  return row ?? null;
}

export interface ResendInvitationResult {
  ok: boolean;
  emailSent: boolean;
  emailMode: string;
  resentAt: string;
  redeemUrl?: string;
}

/**
 * v25.55 5a/5b — resend a pending invitation. Because only the token HASH is
 * stored (never the raw token), a working redeem link requires TOKEN ROTATION:
 * we mint a NEW raw token, UPDATE token_hash, and email a fresh redeem link.
 * The previous link stops working (expected, Ozan-confirmed Caveat A). We also
 * stamp `resent_at` (durable, migration 0104) so the UI can show a "resent"
 * chip. Persist-first: the DB UPDATE commits before the cache is mutated or the
 * email is sent.
 */
export async function resendInvitation(id: string, _actorUserId: string): Promise<ResendInvitationResult> {
  const row = findRowById(id);
  if (!row) throw new Error("invitation_not_found");
  // Wave C1 (Shadie 5a) FAIL-CLOSED — a revoked invitation cannot be resent; the
  // prior code re-minted a token + emailed the revoked investor. (An accepted
  // invite is already blocked at the route/UI; guard revoked here server-side.)
  if (row.state === "revoked") throw new Error("INVITATION_REVOKED");

  const token = generateToken();
  const tokenHash = sha256Hex(token);
  const resentAt = nowIso();

  let affected = 0;
  try {
    const info = rawDb()
      .prepare(
        `UPDATE round_invitations SET token_hash = ?, resent_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(tokenHash, resentAt, resentAt, row.id);
    affected = info.changes;
  } catch (err) {
    log.error("[roundInvitationsStore.resendInvitation] DB write failed:", (err as Error).message);
    throw err;
  }
  if (affected === 0) {
    const idx = memInvitations.findIndex((r) => r.id === row.id);
    if (idx >= 0) memInvitations.splice(idx, 1);
    throw new Error(`Invitation ${row.id} not found in DB; cache cleared`);
  }
  // Cache mutated only after the durable commit.
  row.tokenHash = tokenHash;
  row.resentAt = resentAt;
  row.updatedAt = resentAt;

  const { companyName, roundName } = resolveDealNames(row.companyId, row.roundId);
  const baseUrl = process.env.INVITATION_BASE_URL ?? process.env.APP_URL ?? "https://capavate.com";
  const link = `${baseUrl}/auth/redeem?token=${encodeURIComponent(token)}`;
  let emailSent = false;
  try {
    const result = await sendMail({
      to: row.investorEmail,
      subject: `[Capavate] Reminder: your pending invitation to ${companyName} — ${roundName}`,
      html:
        `<p>Hi ${e(row.investorName ?? "there")},</p>` +
        `<p>This is a reminder that you have a <strong>pending invitation</strong> to review <strong>${e(roundName)}</strong> at <strong>${e(companyName)}</strong>.</p>` +
        `<p><a href="${e(link)}">Click here to review the invitation</a></p>` +
        `<p>This link replaces any earlier one you may have received.</p>`,
      text:
        `Reminder: you have a pending invitation to review ${roundName} at ${companyName} on Capavate.\n` +
        `Review it here: ${link}\n` +
        `This link replaces any earlier one you may have received.`,
    });
    emailSent = !!result.ok;
  } catch (err) {
    log.warn("[roundInvitationsStore.resendInvitation] email send failed (continuing):", (err as Error).message);
  }

  emitMutation({ aggregate: "invitation", id: row.id, change: "update", tenantId: row.tenantId ?? undefined });

  const emailMode = (() => {
    try { return getEmailConfig().mode; } catch { return "console"; }
  })();
  const appUrl = process.env.APP_URL ?? process.env.INVITATION_BASE_URL ?? "https://capavate.com";
  const redeemUrl = `${appUrl}/invite/${encodeURIComponent(token)}`;
  return { ok: true, emailSent, emailMode, resentAt, redeemUrl };
}

/**
 * v25.55 4a — notify an investor that a round is no longer available after the
 * founder revoked their invitation. No redeem link (there is nothing to
 * redeem). Best-effort; a send failure is logged, not thrown.
 */
export async function notifyInvitationRevoked(id: string): Promise<{ emailSent: boolean }> {
  const row = findRowById(id);
  if (!row) return { emailSent: false };
  const { companyName, roundName } = resolveDealNames(row.companyId, row.roundId);
  let emailSent = false;
  try {
    const result = await sendMail({
      to: row.investorEmail,
      subject: `[Capavate] The ${roundName} round at ${companyName} is no longer available`,
      html:
        `<p>Hi ${e(row.investorName ?? "there")},</p>` +
        `<p>We're writing to let you know that your invitation to <strong>${e(roundName)}</strong> at <strong>${e(companyName)}</strong> has been withdrawn and the round is no longer available to you.</p>` +
        `<p>If you believe this is a mistake, please reach out to the founder directly.</p>`,
      text:
        `Your invitation to ${roundName} at ${companyName} has been withdrawn and the round is no longer available to you.\n` +
        `If you believe this is a mistake, please reach out to the founder directly.`,
    });
    emailSent = !!result.ok;
  } catch (err) {
    log.warn("[roundInvitationsStore.notifyInvitationRevoked] email send failed (continuing):", (err as Error).message);
  }
  return { emailSent };
}

/* ---------- Hydration ---------- */

export async function hydrateRoundInvitationsStore(): Promise<void> {
  memInvitations.length = 0;
  try {
    /* ---- Wave C-2 §6 — route boot hydration through `mapDbRow` (the same mapper the
       DB-first read helpers use) instead of 21 hand-maintained inline field assignments.
       WHY THIS IS REQUIRED, not a refactor: the inline block never read the five 0133
       provenance columns, so every restart silently reset `sourcedFromPartnerId` /
       `actorPartnerUserId` / `engagementId` to `undefined` on every cached row — the
       delegated audit trail would evaporate on restart even though the DB rows were intact.
       Routing through `mapDbRow` also structurally prevents this class of drift recurring on
       the NEXT column add.

       Reads via `rawDb()` + `SELECT *` rather than the Drizzle select: `shared/schema.ts`'s
       `roundInvitations` table declares only the base columns, so a Drizzle `.select()`
       cannot return the additive columns at all. `SELECT *` returns whatever the live table
       has, and `mapDbRow`'s `?? null` guards make missing columns degrade to null.

       `getDb` / `invitationsTable` / `isNull` imports are intentionally NOT removed — the
       first two are still used at :653-700 and the import lines stay byte-identical. ---- */
    const db = rawDb();
    // CROSS-TENANT (boot hydration) — read all rows then bucket per tenant.
    const rows = db
      .prepare(`SELECT * FROM round_invitations WHERE deleted_at IS NULL`)
      .all() as any[];
    for (const r of rows) {
      memInvitations.push(mapDbRow(r));
    }
    if (rows.length > 0) {
      log.info(`[hydrate] roundInvitationsStore: ${rows.length} invitations restored`);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] roundInvitationsStore: DB read failed:", msg);
    }
  }
}

/**
 * B-509 fix v23.6: list all non-revoked invitations for a given investor email.
 * Used by /api/investor/invitations to return real DB-backed records in
 * production (non-demo) mode.
 */
export function listForInvestorEmail(email: string): Array<Omit<RoundInvitationRow, "tokenHash">> {
  const normalized = email.trim().toLowerCase();
  return memInvitations
    .filter((r) => r.investorEmail.trim().toLowerCase() === normalized && r.state !== "revoked")
    .map(publicView);
}

/* ---------- Test helpers ---------- */

export const _testAccessInvitations = {
  rows: memInvitations,
  reset(): void {
    memInvitations.length = 0;
  },
  /** Test-only: peek at a token hash to assemble a redeem URL deterministically. */
  hashToken(token: string): string {
    return sha256Hex(token);
  },
};
