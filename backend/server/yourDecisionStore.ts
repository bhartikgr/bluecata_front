/**
 * Sprint 10 — Your Decision 10-state machine + endpoint.
 *
 * State chart (collective_investor_audit §2 Tab 7):
 *
 *   pending → viewed → accepted → soft_circled → confirmed → signed → funded
 *                   ↘ declined
 *   pending → expired | revoked
 *   viewed  → soft_circled (skip-accept; still requires soft-circle data)
 *
 * Investor-actionable transitions (validated against actor-role):
 *   • view              pending → viewed
 *   • accept            viewed  → accepted
 *   • decline           viewed | accepted | soft_circled → declined
 *   • soft_circle       viewed | accepted → soft_circled (requires amount + currency + softCircleType)
 *   • request_info      no state change; emits decision_request_info
 *   • sign              confirmed → signed
 *
 * System/founder transitions (kept for completeness):
 *   • confirm           soft_circled → confirmed
 *   • fund              signed       → funded
 *   • revoke            any non-terminal → revoked
 *   • expire            any non-terminal → expired
 *
 * Every transition emits a sync envelope per `capavate_collective_sync_schema.md §9`.
 *
 * The store is in-memory and seeded from `incomingInvitations` so the state
 * machine is always exercised on first request.
 */
/* v26.1.x ENH-1 — durable Your-Decision store.
 *
 * The Your-Decision 10-state machine was previously RAM-only (a Map) with a
 * best-effort kv mirror written through a LAZY `require("./lib/storePersistenceShim")`.
 * Under the tsx ESM runtime that lazy require() threw `Unexpected token ')'`,
 * so the kv persist silently failed and every decision (view/accept/soft_circle)
 * drifted back to seed state on restart (root cause of FIX #1's soft-circle
 * "survives-restart" gap).
 *
 * ENH-1 makes the durable SQLite table `your_decision_records` (migration 0107)
 * the SOURCE OF TRUTH via STATIC imports (persistence shim + rawDb). The
 * in-memory Map is retained as a hot-path cache that is always reconciled with
 * the table (write-through + read-hydrate). The legacy kv_yourDecisionStore
 * mirror is KEPT this release as a secondary, non-authoritative belt-and-
 * suspenders mirror (retired in a later cleanup wave). No new require(). */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import {
  YOUR_DECISION_STATES,
  YOUR_DECISION_TRANSITIONS,
  yourDecisionPatchSchema,
  type YourDecisionPatch,
  type YourDecisionState,
} from "@shared/schema";
import { incomingInvitations } from "./mockData";
// v24.1 Bug D: modern (redeemed) round invitations live in roundInvitationsStore,
// not in the static incomingInvitations mock. Bridge them so soft-circle works.
import { getInvitation as getModernInvitation } from "./roundInvitationsStore";
import { emitSync } from "./sprint10Telemetry";
import { getUserContext } from "./lib/userContext";
import type { UserContext } from "./lib/userContext";
// v23.4.8 Phase 3 — propagate investor soft-circle decision into the
// soft-circle store so the founder's GET /api/rounds/:id/soft-circles surface
// sees the new commitment without a refresh hack.
import { createSoftCircle as softCircleCreate } from "./softCircleStore";
import { setSoftCircleSource } from "./track4Routes";
import { log } from "./lib/logger";
// v26.1.x ENH-1 — STATIC imports (ESM-safe). The prior lazy require() of the
// persistence shim threw under tsx ("Unexpected token ')'") and silently
// dropped every kv write; these static imports fix that structurally.
import { persistEntry, hydrateEntries } from "./lib/storePersistenceShim";
import { rawDb, getDbDriver } from "./db/connection";

/**
 * Resolves the request's UserContext, falling back to getUserContext(req)
 * when the loadUserContext middleware hasn't run yet (e.g. routes registered
 * before the middleware in routes.ts).
 */
async function resolveCtx(req: Request): Promise<UserContext> {
  if (req.userContext) return req.userContext;
  return getUserContext(req);
}

/**
 * v25.54 AVI-1 Fix A — authorize by durable invitation ownership, faithfully
 * mirroring the working landing path at routes.ts:2067-2122.
 *
 * The prior guard read ONLY ctx.investor.invitedRounds, which is empty after a
 * pm2 restart with RUNTIME_INVITATIONS cleared and (pre-Fix-B) excluded accepted
 * invites — so a legitimately-invited investor (even one whose invitation is
 * "accepted") got a spurious 403 NOT_ON_CAP_TABLE.
 *
 * Resolution order matches the landing path:
 *   1. admin bypass (preserved).
 *   2. MODERN (redeemed/durable) invitation from roundInvitationsStore →
 *      authorize by email-match. Fail-closed: missing caller email, revoked
 *      invitation, email mismatch, or round mismatch → deny (403). This is the
 *      durable path that survives a restart and covers "accepted".
 *   3. LEGACY mock invitation (incomingInvitations seed) → preserve the existing
 *      invitedRounds membership check so demo/seed flows and their tests are
 *      unchanged.
 *   4. Neither store knows the invitation → 404 (do not reveal existence).
 */
type OwnershipResult =
  | { ok: true }
  | { ok: false; status: number; body: { error: string; message?: string } };

function authorizeInvitationOwnership(
  ctx: UserContext,
  invId: string,
  roundId: string,
): OwnershipResult {
  if (ctx.isAdmin) return { ok: true };

  const modern = getModernInvitation(invId);
  if (modern) {
    // Fail-closed on a revoked invitation regardless of any other binding.
    if (modern.state === "revoked") {
      return {
        ok: false,
        status: 403,
        body: { error: "NOT_ON_CAP_TABLE", message: "You are not invited to this round." },
      };
    }
    const callerEmail = (ctx.identity?.email ?? "").toLowerCase();
    const inviteEmail = (modern.investorEmail ?? "").toLowerCase();
    const roundMatches = !roundId || modern.roundId === roundId;
    // Primary (AVI-1): durable email-match ownership — survives a pm2 restart
    // that clears RUNTIME_INVITATIONS and covers the "accepted" state.
    const emailMatch = !!callerEmail && callerEmail === inviteEmail && roundMatches;
    // Superset (v24.1 Bug D): a persona bound to this invitation via the redeem
    // path (invitedRounds) stays authorized even when its persona email differs
    // from the invitation email. This is a strict OR over email-match, so it can
    // never regress Bug D while still restoring the restart-durable path.
    const boundByInvitation = ctx.investor.invitedRounds.some(
      (r) => r.invitationId === invId || r.roundId === modern.roundId,
    );
    if (!emailMatch && !boundByInvitation) {
      return {
        ok: false,
        status: 403,
        body: { error: "NOT_ON_CAP_TABLE", message: "You are not invited to this round." },
      };
    }
    return { ok: true };
  }

  // Legacy mock invitation (demo seed) — keep the original membership contract.
  const legacy = incomingInvitations.find((i) => i.id === invId);
  if (legacy) {
    const hasInv = ctx.investor.invitedRounds.some((r) => r.invitationId === invId || r.roundId === roundId);
    if (!hasInv) {
      return {
        ok: false,
        status: 403,
        body: { error: "NOT_ON_CAP_TABLE", message: "You are not invited to this round." },
      };
    }
    return { ok: true };
  }

  return { ok: false, status: 404, body: { error: "invitation_not_found" } };
}

export type DecisionRecord = {
  invitationId: string;
  roundId: string;
  companyId: string;
  state: YourDecisionState;
  amount?: number;
  currency?: string;
  softCircleType?: string;
  note?: string;
  /** Defect 19: track when the investor first viewed the deal */
  viewedAt?: string;
  history: Array<{ ts: string; from: YourDecisionState; to: YourDecisionState; action: string; reason?: string }>;
  // MIM (Members Interested in this Deal) — anonymized list of co-investors
  // who have soft-circled the same round, plus their indicated totals.
  mim: Array<{ screenName: string; amountUsd: number; softCircleType: string }>;
};

const records = new Map<string, DecisionRecord>();

/**
 * v26.1.x ENH-1 — durable-store internals.
 *
 * The Map above is retained as a hot-path cache. The DB table
 * `your_decision_records` (migration 0107) is the SOURCE OF TRUTH. Reads
 * reconcile the cache with the table (no-downgrade); writes are write-through
 * to BOTH the durable table and the legacy kv_yourDecisionStore mirror.
 */

/**
 * Monotonic rank of the 10 states along the progress chain. Terminal branches
 * (declined/expired/revoked) rank ABOVE their non-terminal predecessors so a
 * re-read can never silently downgrade a terminal decision back to an earlier
 * live state. Used purely for the ensureRecord no-downgrade guard; the state
 * machine itself is unchanged (validateTransition/YOUR_DECISION_TRANSITIONS).
 */
const STATE_RANK: Record<YourDecisionState, number> = {
  pending: 0,
  viewed: 1,
  accepted: 2,
  soft_circled: 3,
  confirmed: 4,
  signed: 5,
  funded: 6,
  declined: 7,
  expired: 7,
  revoked: 7,
};

function stateRank(s: YourDecisionState): number {
  return STATE_RANK[s] ?? 0;
}

/** True when the durable SQLite path is usable (rawDb throws on Postgres). */
function durableAvailable(): boolean {
  return getDbDriver() === "sqlite";
}

/** Serialize a DecisionRecord into the your_decision_records row columns. */
function recordToRow(rec: DecisionRecord): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    invitation_id: rec.invitationId,
    round_id: rec.roundId,
    company_id: rec.companyId ?? "",
    state: rec.state,
    amount: typeof rec.amount === "number" ? rec.amount : null,
    currency: rec.currency ?? null,
    soft_circle_type: rec.softCircleType ?? null,
    viewed_at: rec.viewedAt ?? null,
    note: rec.note ?? null,
    history_json: JSON.stringify(rec.history ?? []),
    mim_json: JSON.stringify(rec.mim ?? []),
    actor: (rec as { actor?: string }).actor ?? null,
    updated_at: now,
  };
}

/** Deserialize a your_decision_records row back into a DecisionRecord. */
function rowToRecord(row: any): DecisionRecord | null {
  if (!row || !row.invitation_id) return null;
  let history: DecisionRecord["history"] = [];
  let mim: DecisionRecord["mim"] = [];
  try { history = JSON.parse(row.history_json ?? "[]"); } catch { history = []; }
  try { mim = JSON.parse(row.mim_json ?? "[]"); } catch { mim = []; }
  const rec: DecisionRecord = {
    invitationId: String(row.invitation_id),
    roundId: String(row.round_id ?? ""),
    companyId: String(row.company_id ?? ""),
    state: (row.state as YourDecisionState) ?? "pending",
    history: Array.isArray(history) ? history : [],
    mim: Array.isArray(mim) ? mim : [],
  };
  if (row.amount != null) rec.amount = Number(row.amount);
  if (row.currency != null) rec.currency = String(row.currency);
  if (row.soft_circle_type != null) rec.softCircleType = String(row.soft_circle_type);
  if (row.viewed_at != null) rec.viewedAt = String(row.viewed_at);
  if (row.note != null) rec.note = String(row.note);
  return rec;
}

/** Upsert one record into the durable your_decision_records table. */
function dbUpsertRecord(rec: DecisionRecord): void {
  if (!durableAvailable()) return;
  try {
    const db: any = rawDb();
    const r = recordToRow(rec);
    db.prepare(
      `INSERT INTO your_decision_records
         (invitation_id, round_id, company_id, state, amount, currency,
          soft_circle_type, viewed_at, note, history_json, mim_json, actor,
          created_at, updated_at)
       VALUES
         (@invitation_id, @round_id, @company_id, @state, @amount, @currency,
          @soft_circle_type, @viewed_at, @note, @history_json, @mim_json, @actor,
          @updated_at, @updated_at)
       ON CONFLICT(invitation_id) DO UPDATE SET
         round_id = excluded.round_id,
         company_id = excluded.company_id,
         state = excluded.state,
         amount = excluded.amount,
         currency = excluded.currency,
         soft_circle_type = excluded.soft_circle_type,
         viewed_at = excluded.viewed_at,
         note = excluded.note,
         history_json = excluded.history_json,
         mim_json = excluded.mim_json,
         actor = excluded.actor,
         updated_at = excluded.updated_at`,
    ).run(r);
  } catch (err) {
    log.warn(
      "[yourDecisionStore] durable upsert failed (non-fatal):",
      (err as Error).message,
    );
  }
}

/** Read one record from the durable table. Returns null if absent/unavailable. */
function dbGetRecord(invitationId: string): DecisionRecord | null {
  if (!durableAvailable()) return null;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT * FROM your_decision_records WHERE invitation_id = ?`)
      .get(invitationId);
    return rowToRecord(row);
  } catch (err) {
    log.warn(
      "[yourDecisionStore] durable read failed (non-fatal):",
      (err as Error).message,
    );
    return null;
  }
}

/** Read every durable record (boot hydration). */
function dbAllRecords(): DecisionRecord[] {
  if (!durableAvailable()) return [];
  try {
    const db: any = rawDb();
    const rows: any[] = db.prepare(`SELECT * FROM your_decision_records`).all();
    const out: DecisionRecord[] = [];
    for (const row of rows) {
      const rec = rowToRecord(row);
      if (rec) out.push(rec);
    }
    return out;
  } catch (err) {
    log.warn(
      "[yourDecisionStore] durable list failed (non-fatal):",
      (err as Error).message,
    );
    return [];
  }
}

/* v25.11 NM6 / v26.1.x ENH-1 — exported so the legacy POST shortcuts can mirror
 * the canonical PATCH handler's write-through path. Write-through order:
 *   1. durable table `your_decision_records` (source of truth)
 *   2. legacy kv_yourDecisionStore mirror (secondary, kept this release)
 * Static imports (no lazy require) so this can never throw under tsx ESM — the
 * exact silent-persist-failure that caused the FIX #1 restart drift. */
export function _persistRecord(rec: DecisionRecord): void {
  // 1) Durable source of truth.
  dbUpsertRecord(rec);
  // 2) Legacy kv mirror (belt-and-suspenders; retired in a later cleanup wave).
  try {
    persistEntry("yourDecisionStore", rec.invitationId, rec);
  } catch (err) {
    log.warn(
      "[yourDecisionStore] kv mirror persist failed (non-fatal):",
      (err as Error).message,
    );
  }
}

/**
 * Boot hydrator. Called from HYDRATE_ORDER in lib/hydrateStores.ts.
 *
 * v26.1.x ENH-1 — hydrate from the durable table first (source of truth), then
 * top up from the legacy kv mirror for any invitation the table does not yet
 * carry (live-cutover safety). Never downgrades a state already in the cache.
 */
export function hydrateYourDecisionStore(): number {
  let n = 0;
  // 1) Durable table (authoritative).
  try {
    for (const rec of dbAllRecords()) {
      const id = rec.invitationId;
      if (!id) continue;
      const existing = records.get(id);
      if (!existing || stateRank(rec.state) >= stateRank(existing.state)) {
        records.set(id, rec);
        if (!existing) n++;
      }
    }
  } catch (err) {
    log.warn(
      "[yourDecisionStore.hydrate] durable hydrate failed (non-fatal):",
      (err as Error).message,
    );
  }
  // 2) Legacy kv mirror — only fills gaps the durable table has not yet covered.
  try {
    const rows = hydrateEntries("yourDecisionStore") as Array<[string, DecisionRecord]>;
    for (const [id, rec] of rows) {
      if (rec && id && !records.has(id)) {
        records.set(id, rec);
        n++;
      }
    }
  } catch (err) {
    log.warn(
      "[yourDecisionStore.hydrate] kv mirror hydrate failed (non-fatal):",
      (err as Error).message,
    );
  }
  return n;
}

/**
 * v24.1 Bug D: map a modern InvitationState (roundInvitationsStore) onto a
 * YourDecision state. The modern store has no soft_circled/confirmed/etc., so
 * unknown/"sent" states fall back to "pending".
 */
function mapModernInvitationState(state: string): YourDecisionState {
  if ((YOUR_DECISION_STATES as readonly string[]).includes(state)) {
    return state as YourDecisionState;
  }
  // "sent" (and anything else not in the decision chart) starts at pending.
  return "pending";
}

/* v25.11 NM6 / v26.1.x ENH-1 — exported so the legacy POST shortcuts can locate
 * the record via the same lazy-seed path the canonical PATCH uses.
 *
 * ENH-1 resolution order (durable-first with a strict NO-DOWNGRADE guard):
 *   1. Reconcile the in-memory cache with the durable table. Whichever holds the
 *      MORE-ADVANCED state (by STATE_RANK) wins; on a tie the durable row wins.
 *      This guarantees a re-read after a restart can never downgrade an
 *      already-progressed decision (e.g. soft_circled) back to a seed state.
 *   2. If neither cache nor table knows it, seed from the mock/modern invitation
 *      and PERSIST the seed so the durable table becomes authoritative going
 *      forward.
 */
export function ensureRecord(invitationId: string): DecisionRecord | null {
  const cached = records.get(invitationId) ?? null;
  const durable = dbGetRecord(invitationId);

  if (cached || durable) {
    // No-downgrade reconciliation. Prefer the more-advanced state; tie → durable.
    let winner: DecisionRecord;
    if (cached && durable) {
      winner = stateRank(durable.state) >= stateRank(cached.state) ? durable : cached;
    } else {
      winner = (durable ?? cached)!;
    }
    records.set(invitationId, winner);
    // Backfill the durable table if it was missing or behind the cache.
    if (!durable || stateRank(winner.state) > stateRank(durable.state)) {
      dbUpsertRecord(winner);
    }
    return winner;
  }

  const inv = incomingInvitations.find((i) => i.id === invitationId);
  if (inv) {
    const initialState = (YOUR_DECISION_STATES as readonly string[]).includes(inv.state)
      ? (inv.state as YourDecisionState)
      : "pending";
    const rec: DecisionRecord = {
      invitationId: inv.id,
      roundId: inv.round.id,
      companyId: inv.company.id,
      state: initialState,
      history: [],
      // Demo MIM: a few seeded peer commits per round
      mim: seedMim(inv.round.id),
    };
    records.set(invitationId, rec);
    // v26.1.x ENH-1 — persist the seed so the durable table is the source of
    // truth from first touch (write-through to table + kv mirror).
    _persistRecord(rec);
    return rec;
  }

  // v24.1 Bug D: fall back to the modern round-invitations store. Investors who
  // redeemed a round invite (the production path) have no static record, so the
  // soft-circle PATCH used to 404 even though the investor was authorized.
  const modern = getModernInvitation(invitationId);
  if (modern) {
    const rec: DecisionRecord = {
      invitationId: modern.id,
      roundId: modern.roundId,
      companyId: modern.companyId ?? "",
      state: mapModernInvitationState(modern.state),
      viewedAt: modern.viewedAt ?? undefined,
      history: [],
      mim: seedMim(modern.roundId),
    };
    // Cache so subsequent GET/PATCH calls return the same authoritative record.
    records.set(invitationId, rec);
    // v26.1.x ENH-1 — persist the seed (durable source of truth + kv mirror).
    _persistRecord(rec);
    return rec;
  }

  return null;
}

function seedMim(roundId: string): DecisionRecord["mim"] {
  const seed: Record<string, DecisionRecord["mim"]> = {
    rnd_seed: [
      { screenName: "@hydra_vc",     amountUsd: 1_500_000, softCircleType: "definite" },
      { screenName: "@forge_ang",    amountUsd:   750_000, softCircleType: "indication" },
      { screenName: "@bluepoint_ang", amountUsd:   400_000, softCircleType: "definite" },
    ],
    rnd_pre: [
      { screenName: "@northstar",     amountUsd:   100_000, softCircleType: "indication" },
      { screenName: "@avocado_ang",   amountUsd:    75_000, softCircleType: "conditional" },
    ],
    rnd_q_a: [
      { screenName: "@sequoia_h",     amountUsd: 4_000_000, softCircleType: "definite" },
      { screenName: "@bluepoint",     amountUsd:   500_000, softCircleType: "definite" },
    ],
    rnd_l_b: [
      { screenName: "@helios_growth", amountUsd: 8_000_000, softCircleType: "definite" },
    ],
    rnd_k_seed: [],
  };
  return seed[roundId] ?? [];
}

/**
 * Validate that `from → to` is allowed.
 * Returns null on success or an error string on failure.
 */
export function validateTransition(from: YourDecisionState, to: YourDecisionState): string | null {
  if (!(YOUR_DECISION_STATES as readonly string[]).includes(from)) return `invalid_from_state:${from}`;
  if (!(YOUR_DECISION_STATES as readonly string[]).includes(to))   return `invalid_to_state:${to}`;
  if (from === to) return `noop_transition:${from}`;
  const allowed = YOUR_DECISION_TRANSITIONS[from];
  if (!allowed.includes(to)) return `forbidden_transition:${from}->${to}`;
  return null;
}

const ACTION_TO_STATE: Record<YourDecisionPatch["action"], YourDecisionState | null> = {
  view: "viewed",
  accept: "accepted",
  decline: "declined",
  soft_circle: "soft_circled",
  confirm: "confirmed",
  sign: "signed",
  fund: "funded",
  revoke: "revoked",
  expire: "expired",
  request_info: null,
};

export function applyDecisionAction(rec: DecisionRecord, patch: YourDecisionPatch): { ok: true; from: YourDecisionState; to: YourDecisionState } | { ok: false; error: string } {
  if (patch.action === "request_info") {
    // No state change — we just record a history line.
    rec.history.push({ ts: new Date().toISOString(), from: rec.state, to: rec.state, action: "request_info", reason: patch.note });
    return { ok: true, from: rec.state, to: rec.state };
  }
  const target = ACTION_TO_STATE[patch.action];
  if (!target) return { ok: false, error: `unknown_action:${patch.action}` };

  // Action-specific guards
  if (patch.action === "soft_circle") {
    if (typeof patch.amount !== "number" || patch.amount <= 0) {
      return { ok: false, error: "missing_or_invalid_amount" };
    }
    if (!patch.currency) return { ok: false, error: "missing_currency" };
    if (!patch.softCircleType) return { ok: false, error: "missing_soft_circle_type" };
  }

  // BUG A fix (LOCKED = auto-advance, keep the strict machine): a NEW round
  // invitation starts at `pending`, but `soft_circle` and `accept` both require a
  // prior `viewed` state (pending→soft_circled and pending→accepted are
  // intentionally NOT in YOUR_DECISION_TRANSITIONS). The canonical decision UI
  // fires a `view` on load, but the legacy shortcut endpoints
  // (`POST /api/investor/invitations/:id/{soft-circle,accept}`, routes.ts ~L5067)
  // call applyDecisionAction directly with no prior view, so a repeat investor
  // hit a spurious `forbidden_transition:pending->soft_circled` (and, via the
  // accept shortcut, `pending->accepted`). Auto-record the implicit view
  // transition (pending→viewed, valid + audited) first, then fall through to the
  // normal viewed→{soft_circled,accepted} path. The transition map stays strict.
  if ((patch.action === "soft_circle" || patch.action === "accept") && rec.state === "pending") {
    const viewFrom = rec.state;
    const viewErr = validateTransition(viewFrom, "viewed");
    if (viewErr) return { ok: false, error: viewErr };
    rec.state = "viewed";
    if (!rec.viewedAt) rec.viewedAt = new Date().toISOString();
    rec.history.push({ ts: new Date().toISOString(), from: viewFrom, to: "viewed", action: "view" });
  }

  const from = rec.state;
  const err = validateTransition(from, target);
  if (err) return { ok: false, error: err };

  rec.state = target;
  if (patch.action === "soft_circle") {
    rec.amount = patch.amount;
    rec.currency = patch.currency;
    rec.softCircleType = patch.softCircleType;
    rec.note = patch.note;
  }
  rec.history.push({ ts: new Date().toISOString(), from, to: target, action: patch.action, reason: patch.reason });
  return { ok: true, from, to: target };
}

/**
 * Total all soft-circle amounts for the round (in USD; assumes USD if missing).
 * Defect 63 fix: MIM amounts are informational only (anonymized peer data);
 * they cannot be attributed to real investors in this store, so we document
 * clearly that `totalSoftCircled` returns only the current investor's record
 * amounts. The MIM iteration that previously voided every entry is removed.
 */
export function totalSoftCircled(roundId: string): number {
  let total = 0;
  for (const r of Array.from(records.values())) {
    if (r.roundId !== roundId) continue;
    if (r.state === "soft_circled" || r.state === "confirmed" || r.state === "signed" || r.state === "funded") {
      total += r.amount ?? 0;
    }
  }
  // NOTE: MIM (Members Interested in this deal) amounts are not included.
  // MIM is an anonymized read-only view for UI display; it does not represent
  // attributable investment commitments in this store. If MIM amounts need to
  // be totalled, they should be fetched separately from a dedicated MIM aggregate.
  return total;
}

export function getRecord(invitationId: string): DecisionRecord | null {
  return ensureRecord(invitationId);
}

export function clearRecords(): void {
  records.clear();
  // v26.1.x ENH-1 — also clear the durable table so test isolation (and any
  // deliberate reset) truly starts from a clean slate, matching the prior
  // Map-only semantics. Best-effort; never throws.
  if (durableAvailable()) {
    try {
      rawDb().prepare(`DELETE FROM your_decision_records`).run();
    } catch (err) {
      log.warn(
        "[yourDecisionStore] durable clear failed (non-fatal):",
        (err as Error).message,
      );
    }
  }
}

const TELEMETRY_EVENT_BY_ACTION: Record<YourDecisionPatch["action"], string> = {
  view: "decision_viewed",
  accept: "decision_accepted",
  decline: "decision_declined",
  soft_circle: "soft_circle_submitted",
  confirm: "decision_confirmed",
  sign: "decision_signed",
  fund: "decision_funded",
  revoke: "decision_revoked",
  expire: "decision_expired",
  request_info: "decision_request_info",
};

export function registerYourDecisionRoutes(app: Express): void {
  // Defect 84: GET requires auth + investor must own the invitation.
  app.get("/api/rounds/:roundId/invitations/:invId/decision", async (req: Request, res: Response) => {
    const roundId = String(req.params.roundId ?? "");
    const invId = String(req.params.invId ?? "");
    const ctx = await resolveCtx(req);
    // Auth check
    if (!ctx.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to continue." });
    }
    // Ownership check (v25.54 AVI-1 Fix A): authorize by durable invitation
    // ownership (email-match) rather than the restart-fragile invitedRounds set.
    const auth = authorizeInvitationOwnership(ctx, invId, roundId);
    if (!auth.ok) {
      return res.status(auth.status).json(auth.body);
    }
    const rec = ensureRecord(invId);
    if (!rec) return res.status(404).json({ error: "invitation_not_found" });
    res.json(rec);
  });

  // Defect 85: PATCH requires auth + investor must own the invitation.
  app.patch("/api/rounds/:roundId/invitations/:invId/decision", async (req: Request, res: Response) => {
    const roundId = String(req.params.roundId ?? "");
    const invId = String(req.params.invId ?? "");
    const ctx = await resolveCtx(req);
    // Auth check
    if (!ctx.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to continue." });
    }
    // Ownership check (v25.54 AVI-1 Fix A): durable email-match ownership.
    const auth = authorizeInvitationOwnership(ctx, invId, roundId);
    if (!auth.ok) {
      return res.status(auth.status).json(auth.body);
    }
    const parsed = yourDecisionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "validation_failed", issues: parsed.error.format() });
    }
    const rec = ensureRecord(invId);
    if (!rec) return res.status(404).json({ error: "invitation_not_found" });
    if (rec.roundId !== roundId) return res.status(400).json({ error: "round_invitation_mismatch" });

    // Defect 19: record viewedAt timestamp when action is "view"
    if (parsed.data.action === "view" && !rec.viewedAt) {
      rec.viewedAt = new Date().toISOString();
    }

    const result = applyDecisionAction(rec, parsed.data);
    if (!result.ok) return res.status(409).json({ error: result.error });
    /* v25.11 NC1 fix — write the updated decision to the DB so the state
     * machine survives a server restart. The Map is still updated in-place
     * above by applyDecisionAction; persistEntry now mirrors it to
     * kv_yourDecisionStore. */
    _persistRecord(rec);

    // v23.4.8 Phase 3 — when an investor confirms a soft-circle decision,
    // mirror it into the soft-circle store so founders can see it on
    // /founder/rounds/:id (RoundDetail) without a refresh hack. Best-effort
    // only; never fail the decision PATCH if the mirror write fails.
    if (parsed.data.action === "soft_circle" && typeof parsed.data.amount === "number" && parsed.data.amount > 0) {
      try {
        const investorName = ctx.identity?.name || ctx.identity?.screenName || ctx.userId || "Investor";
        const investorEmail = ctx.identity?.email ?? null;
        const newSc = softCircleCreate({
          roundId: rec.roundId,
          companyId: rec.companyId,
          invitationId: rec.invitationId,
          investorUserId: ctx.userId,
          investorEmail,
          investorName,
          amount: parsed.data.amount,
          currency: parsed.data.currency ?? rec.currency ?? "USD",
          status: "intent",
          collectiveVisible: true,
        });
        // D3: attribute to collective channel (investor acting via their decision surface)
        try { setSoftCircleSource(newSc.id, "collective", ctx.userId ?? null); } catch { /* best-effort */ }
      } catch (err) {
        // Swallow — the decision record is still authoritative; this is a
        // best-effort mirror for founder visibility.
        log.warn(
          "[yourDecisionStore] soft-circle mirror write failed:",
          (err as Error).message,
        );
      }
    }

    const env = emitSync({
      eventType: TELEMETRY_EVENT_BY_ACTION[parsed.data.action],
      aggregateId: rec.invitationId,
      aggregateKind: "invitation",
      payload: {
        invitationId: rec.invitationId,
        roundId: rec.roundId,
        companyId: rec.companyId,
        from: result.from,
        to: result.to,
        amount: rec.amount,
        currency: rec.currency,
        softCircleType: rec.softCircleType,
        note: parsed.data.note,
        action: parsed.data.action,
        viewedAt: rec.viewedAt,
      },
      req,
    });
    res.json({ ok: true, record: rec, telemetry: env });
  });
}
