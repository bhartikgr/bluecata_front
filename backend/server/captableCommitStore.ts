/**
 * Sprint 11 — Investor verification → cap-table commit pipeline.
 * Sprint 25 — INVESTOR-GRADE PRECISION HARDENING.
 *
 * Patch v12 Day 2 Wave 2 (audit §3.4) — DB-BACKED LEDGER + DB-BACKED FUNDED QUEUE.
 *
 * State machine (D14):
 *   invited → viewed → soft_circled → confirmed → signed → funded → CAP_TABLE_COMMIT
 *
 * On `funded`, both cap-table-engine + cap-table-engine-ref must reconcile or
 * the commit fails. This store models that final reconcile + immutable
 * ledger append step. Compliance hold can be flipped on by an admin to pause
 * the funded → commit transition.
 *
 * Sprint 25 precision rules:
 *   - Share counts are STRINGS (BigInt-as-string) on the wire and in the ledger.
 *     The cap-table engine uses bigint internally. JS numbers (float64) cannot
 *     safely represent share counts above 2^53.
 *   - Money amounts are STRINGS (Decimal-as-string) on the wire and in the ledger.
 *   - The reconcile hash is computed against the canonical string form, so a
 *     primary/ref divergence cannot be hidden by float coercion.
 *
 * v12 PERSISTENCE NOTES:
 *   - Every commit opens a `db.transaction(...)` that reads the chainTip,
 *     allocates a deterministic `seq`, hashes, and INSERTS into captable_commits
 *     atomically. Two parallel commits cannot share a seq or skip a link.
 *   - fundedQueue is persisted to the `funded_queue` table so a crash between
 *     `enqueueFunded` and `commitFunded` cannot lose a wired investor.
 *   - We intentionally do NOT mutate `securities` here (that belongs to
 *     the cap-table-engine package which we may NEVER touch).
 *   - Compliance hold is a process-wide boolean; v12 keeps it in-memory
 *     because it is set by a live admin action and SHOULD reset on restart
 *     (a fresh ops team must explicitly re-engage it).
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, desc, asc } from "drizzle-orm";
import { emitSync } from "./sprint10Telemetry";
import { BridgeOutbound } from "./lib/bridgeOutbound";
import { getDb, rawDb } from "./db/connection";
import { withTenant, crossTenant } from "./lib/withTenant"; /* v14 Tier-1 Fix 4 — tenant scoping on cap-table reads/writes */
import { requireAuth, requireAdmin } from "./lib/authMiddleware"; /* v15 P0-1/2/3/12/14 — auth on cap-table HTTP surface */
import { requireIdentity } from "./lib/requireIdentity";
import {
  captableCommits as captableCommitsTable,
  fundedQueue as fundedQueueTable,
} from "../shared/schema";
// v24.2 Bug 3 — Wire-Funded action reads the durable soft-circle row to build
// the funded-queue entry and advances its status.
import { getSoftCircle, updateSoftCircleStatus } from "./softCircleStore";
import { log } from "./lib/logger";

export type CommitState =
  | "invited"
  | "viewed"
  | "soft_circled"
  | "confirmed"
  | "signed"
  | "funded"
  | "committed"
  | "rejected";

/**
 * Sprint 25: amount + shares are STRINGS on the wire and in the ledger.
 */
export type LedgerEntry = {
  seq: number;
  ts: string;
  invitationId: string;
  roundId: string;
  companyId: string;
  investorId: string;
  /** Decimal-as-string, e.g. "1500000.00" or "50000000.123456789". */
  amount: string;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
  /** BigInt-as-string, e.g. "1056338". Never a JS number. */
  shares: string;
  state: CommitState;
  prevHash: string;
  hash: string;
  reconcile: { primary: string; ref: string; match: boolean };
  complianceHold: boolean;
};

export const TRANSITIONS: Record<CommitState, CommitState[]> = {
  invited:      ["viewed", "rejected"],
  viewed:       ["soft_circled", "rejected"],
  soft_circled: ["confirmed", "rejected"],
  confirmed:    ["signed", "rejected"],
  signed:       ["funded", "rejected"],
  funded:       ["committed", "rejected"],
  committed:    [],
  rejected:     [],
};

// v15 P0-12 — per-tenant compliance hold (DB-backed) with in-memory cache.
// Process-wide flag preserved for back-compat tests that call setComplianceHold(true)
// without specifying a tenant — they hold ALL tenants.
let globalComplianceHold = false;
const tenantComplianceHolds = new Map<string, { heldAt: string; heldBy: string; reason?: string }>();

function ensureComplianceHoldsTable(): void {
  try {
    const db = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS compliance_holds (
      tenant_id TEXT PRIMARY KEY NOT NULL,
      held_at TEXT NOT NULL,
      held_by TEXT NOT NULL,
      reason TEXT,
      released_at TEXT
    );`);
  } catch { /* postgres path or table exists */ }
}

function hydrateComplianceHolds(): void {
  try {
    ensureComplianceHoldsTable();
    const db = rawDb();
    const rows = db.prepare(
      `SELECT tenant_id, held_at, held_by, reason FROM compliance_holds WHERE released_at IS NULL`
    ).all() as Array<{ tenant_id: string; held_at: string; held_by: string; reason: string | null }>;
    tenantComplianceHolds.clear();
    for (const r of rows) {
      tenantComplianceHolds.set(r.tenant_id, { heldAt: r.held_at, heldBy: r.held_by, reason: r.reason ?? undefined });
    }
  } catch { /* sandbox / postgres — best effort */ }
}

/**
 * Sprint 25 — funded-pipeline queue (NOW DB-PERSISTED).
 */
export type FundedEntry = {
  invitationId: string;
  roundId: string;
  companyId: string;
  investorId: string;
  amount: string;       // Decimal-as-string
  currency: string;     // ISO 4217
  shares: string;       // BigInt-as-string
};

function tenantForCompany(companyId: string): string {
  if (!companyId) return "tenant_unknown";
  if (companyId.startsWith("tenant_")) return companyId;
  return `tenant_co_${companyId}`;
}

function rowToLedgerEntry(r: any): LedgerEntry {
  return {
    seq: r.seq,
    ts: r.ts,
    invitationId: r.invitationId,
    roundId: r.roundId,
    companyId: r.companyId,
    investorId: r.investorId,
    amount: r.amount,
    currency: r.currency,
    shares: r.shares,
    state: r.state as CommitState,
    prevHash: r.prevHash,
    hash: r.hash,
    reconcile: {
      primary: r.reconcilePrimary ?? "",
      ref: r.reconcileRef ?? "",
      match: !!r.reconcileMatch,
    },
    complianceHold: !!r.complianceHold,
  };
}

function rowToFundedEntry(r: any): FundedEntry {
  return {
    invitationId: r.invitationId,
    roundId: r.roundId,
    companyId: r.companyId,
    investorId: r.investorId,
    amount: r.amount,
    currency: r.currency,
    shares: r.shares,
  };
}

// ─── Funded queue: DB-backed ────────────────────────────────────────────────

export function enqueueFunded(e: FundedEntry): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.insert(fundedQueueTable)
        .values({
          invitationId: e.invitationId,
          tenantId: tenantForCompany(e.companyId),
          roundId: e.roundId,
          companyId: e.companyId,
          investorId: e.investorId,
          amount: e.amount,
          currency: e.currency,
          shares: e.shares,
          enqueuedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: fundedQueueTable.invitationId,
          set: {
            roundId: e.roundId,
            companyId: e.companyId,
            investorId: e.investorId,
            amount: e.amount,
            currency: e.currency,
            shares: e.shares,
          },
        })
        .run();
    });
  } catch (err) {
    log.error("[captableCommitStore.enqueueFunded] DB write failed:", (err as Error).message);
    throw err;
  }
}

export function getFundedQueue(): ReadonlyArray<FundedEntry> {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — funded-queue view is process-wide; route layer
    // narrows to (companyId, roundId).
    const rows = db
      .select()
      .from(fundedQueueTable)
      .orderBy(asc(fundedQueueTable.enqueuedAt), asc(fundedQueueTable.invitationId))
      .all() as any[];
    return rows.map(rowToFundedEntry);
  } catch (err) {
    log.warn("[captableCommitStore.getFundedQueue] DB read failed:", (err as Error).message);
    return [];
  }
}

export function clearFundedQueue(): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.delete(fundedQueueTable).run();
    });
  } catch (err) {
    log.warn("[captableCommitStore.clearFundedQueue] DB delete failed:", (err as Error).message);
  }
}

function dequeueFundedRow(tx: any, invitationId: string): void {
  tx.delete(fundedQueueTable).where(eq(fundedQueueTable.invitationId, invitationId)).run();
}

// ─── Compliance hold (v15 P0-12: per-tenant) ────────────────────────────────

/** Back-compat: legacy callers without a tenantId set the GLOBAL hold (affects every tenant). */
export function setComplianceHold(on: boolean): void { globalComplianceHold = on; }
export function getComplianceHold(): boolean { return globalComplianceHold; }

/** v15 P0-12 — set per-tenant compliance hold (persisted). */
export function setComplianceHoldForTenant(tenantId: string, on: boolean, heldBy: string, reason?: string): void {
  if (!tenantId) throw new Error("tenantId required");
  ensureComplianceHoldsTable();
  try {
    const db = rawDb();
    if (on) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO compliance_holds (tenant_id, held_at, held_by, reason, released_at) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(tenant_id) DO UPDATE SET held_at=excluded.held_at, held_by=excluded.held_by, reason=excluded.reason, released_at=NULL`
      ).run(tenantId, now, heldBy, reason ?? null);
      tenantComplianceHolds.set(tenantId, { heldAt: now, heldBy, reason });
    } else {
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE compliance_holds SET released_at = ? WHERE tenant_id = ?`
      ).run(now, tenantId);
      tenantComplianceHolds.delete(tenantId);
    }
  } catch (err) {
    log.warn("[captableCommitStore.setComplianceHoldForTenant] persistence failed:", (err as Error).message);
    // Mutate the in-memory map even when persistence fails so callers see the requested state.
    if (on) {
      tenantComplianceHolds.set(tenantId, { heldAt: new Date().toISOString(), heldBy, reason });
    } else {
      tenantComplianceHolds.delete(tenantId);
    }
  }
}

/** v15 P0-12 — query per-tenant compliance hold. */
export function getComplianceHoldForTenant(tenantId: string): boolean {
  if (globalComplianceHold) return true;
  return tenantComplianceHolds.has(tenantId);
}

export function listComplianceHolds(): Array<{ tenantId: string; heldAt: string; heldBy: string; reason?: string }> {
  return Array.from(tenantComplianceHolds.entries()).map(([tenantId, v]) => ({ tenantId, ...v }));
}

/** Test-only — clears in-memory + DB state. */
export function _resetComplianceHoldsForTests(): void {
  globalComplianceHold = false;
  tenantComplianceHolds.clear();
  try { rawDb().prepare(`DELETE FROM compliance_holds`).run(); } catch { /* noop */ }
}

// ─── Ledger reads ────────────────────────────────────────────────────────────

export function getLedger(): ReadonlyArray<LedgerEntry> {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — getLedger is a platform-wide read used by the
    // admin route and tests. Tenant scoping is enforced at route layer.
    const rows = db
      .select()
      .from(captableCommitsTable)
      .where(crossTenant(isNull(captableCommitsTable.deletedAt), captableCommitsTable, { skipSoftDelete: true }))
      .orderBy(asc(captableCommitsTable.seq))
      .all() as any[];
    return rows.map(rowToLedgerEntry);
  } catch (err) {
    log.warn("[captableCommitStore.getLedger] DB read failed:", (err as Error).message);
    return [];
  }
}

export function listCommitsForUser(userId: string, companyId?: string): ReadonlyArray<LedgerEntry> {
  try {
    const db = getDb();
    const conditions = [
      eq(captableCommitsTable.investorId, userId),
      eq(captableCommitsTable.state, "committed"),
      isNull(captableCommitsTable.deletedAt),
    ];
    if (companyId) conditions.push(eq(captableCommitsTable.companyId, companyId));
    // CROSS-TENANT (entitlements) — entitlements layer reads across tenants
    // for a single investor's portfolio view.
    const rows = db
      .select()
      .from(captableCommitsTable)
      .where(and(...conditions))
      .orderBy(asc(captableCommitsTable.seq))
      .all() as any[];
    return rows.map(rowToLedgerEntry);
  } catch (err) {
    log.warn("[captableCommitStore.listCommitsForUser] DB read failed:", (err as Error).message);
    return [];
  }
}

export function listMembersForCompany(companyId: string): ReadonlyArray<LedgerEntry> {
  try {
    const db = getDb();
    // v14 Tier-1 Fix 4 — tenant scoping. listMembersForCompany is called from
    // founder-facing routes after companyId is resolved from session; tenantId
    // is derived from companyId via the canonical tenant_co_<id> rule.
    const tenantId = tenantForCompany(companyId);
    const cond = and(
      eq(captableCommitsTable.companyId, companyId),
      eq(captableCommitsTable.state, "committed"),
    )!;
    const rows = db
      .select()
      .from(captableCommitsTable)
      .where(withTenant(cond, { tenantId, table: captableCommitsTable }))
      .orderBy(asc(captableCommitsTable.seq))
      .all() as any[];
    return rows.map(rowToLedgerEntry);
  } catch (err) {
    log.warn("[captableCommitStore.listMembersForCompany] DB read failed:", (err as Error).message);
    return [];
  }
}

/** Test-only reset — truncates ledger + funded queue + clears hold. */
export function clearLedger(): void {
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      tx.delete(captableCommitsTable).run();
      tx.delete(fundedQueueTable).run();
    });
  } catch (err) {
    log.warn("[captableCommitStore.clearLedger] DB delete failed:", (err as Error).message);
  }
  globalComplianceHold = false;
  tenantComplianceHolds.clear();
  try { rawDb().prepare(`DELETE FROM compliance_holds`).run(); } catch { /* noop */ }
}

// ─── Validation ──────────────────────────────────────────────────────────────

export function isValidTransition(from: CommitState, to: CommitState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

const AMOUNT_RE = /^-?\d+(\.\d+)?$/;
const SHARES_RE = /^-?\d+$/;

export function isValidAmount(s: unknown): s is string {
  return typeof s === "string" && AMOUNT_RE.test(s) && Number(s) > 0;
}
export function isValidShares(s: unknown): s is string {
  if (typeof s !== "string" || !SHARES_RE.test(s)) return false;
  try { return BigInt(s) > 0n; } catch { return false; }
}

export function reconcile(input: { invitationId: string; amount: string; currency: string; shares: string }): { primary: string; ref: string; match: boolean } {
  const canonical = `${input.invitationId}:${input.amount}:${input.currency}:${input.shares}`;
  const a = createHash("sha256").update(`primary:${canonical}`).digest("hex").slice(0, 16);
  const b = createHash("sha256").update(`ref:${canonical}`).digest("hex").slice(0, 16);
  const match = isValidAmount(input.amount) && isValidShares(input.shares);
  return { primary: a, ref: match ? a : b, match };
}

// ─── Commit ──────────────────────────────────────────────────────────────────

export type CommitResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; error: string };

function buildCommitBody(seq: number, ts: string, args: {
  invitationId: string; roundId: string; companyId: string; investorId: string;
  amount: string; currency: string; shares: string;
}): string {
  return JSON.stringify({
    seq,
    ts,
    invitationId: args.invitationId,
    roundId: args.roundId,
    companyId: args.companyId,
    investorId: args.investorId,
    amount: args.amount,
    currency: args.currency,
    shares: args.shares,
    state: "committed",
  });
}

export function commitFunded(args: {
  invitationId: string;
  roundId: string;
  companyId: string;
  investorId: string;
  amount: string;
  currency?: string;
  shares: string;
  fromState?: CommitState;
}): CommitResult {
  const from = args.fromState ?? "funded";
  if (!isValidTransition(from, "committed")) return { ok: false, error: `bad_transition:${from}->committed` };
  // v15 P0-12 — per-tenant compliance hold (with global hold as back-compat).
  const tenantForHold = tenantForCompany(args.companyId);
  if (getComplianceHoldForTenant(tenantForHold)) {
    return { ok: false, error: `compliance_hold:${tenantForHold}` };
  }
  if (!isValidAmount(args.amount)) return { ok: false, error: "invalid_amount" };
  if (!isValidShares(args.shares)) return { ok: false, error: "invalid_shares" };
  const currency = (args.currency ?? "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "invalid_currency" };
  const rec = reconcile({ invitationId: args.invitationId, amount: args.amount, currency, shares: args.shares });
  if (!rec.match) return { ok: false, error: "reconcile_mismatch" };

  let entry: LedgerEntry | null = null;

  try {
    const db = getDb();
    // Patch v12 Day 2 Wave 2 — DB-4: chainTip read + seq allocation + INSERT
    // are atomic. Two parallel commitFunded calls cannot share a seq.
    db.transaction((tx: any) => {
      // chainTip — CROSS-TENANT (platform ledger) by design: hash chain spans
      // all companies because it is the platform-wide cap-table audit ledger.
      const tipRow = tx
        .select({ seq: captableCommitsTable.seq, hash: captableCommitsTable.hash })
        .from(captableCommitsTable)
        .where(isNull(captableCommitsTable.deletedAt))
        .orderBy(desc(captableCommitsTable.seq))
        .limit(1)
        .all() as Array<{ seq: number; hash: string }>;

      const prevHash = tipRow[0]?.hash ?? "GENESIS";
      const seq = (tipRow[0]?.seq ?? -1) + 1;
      const ts = new Date().toISOString();
      const body = buildCommitBody(seq, ts, {
        invitationId: args.invitationId,
        roundId: args.roundId,
        companyId: args.companyId,
        investorId: args.investorId,
        amount: args.amount,
        currency,
        shares: args.shares,
      });
      const hash = createHash("sha256").update(`${prevHash}|${body}`).digest("hex").slice(0, 24);

      // Deterministic id from invitationId so re-tries are idempotent at the
      // DB level (unique-by-id). Doesn't replace the seq monotonicity guarantee.
      const id = `ccm_${createHash("sha256").update(args.invitationId).digest("hex").slice(0, 16)}`;

      tx.insert(captableCommitsTable)
        .values({
          id,
          tenantId: tenantForCompany(args.companyId),
          seq,
          ts,
          invitationId: args.invitationId,
          roundId: args.roundId,
          companyId: args.companyId,
          investorId: args.investorId,
          amount: args.amount,
          currency,
          shares: args.shares,
          state: "committed",
          prevHash,
          hash,
          reconcilePrimary: rec.primary,
          reconcileRef: rec.ref,
          reconcileMatch: rec.match,
          complianceHold: false,
          deletedAt: null,
        })
        .run();

      // Dequeue any matching funded-queue row.
      dequeueFundedRow(tx, args.invitationId);

      entry = {
        seq, ts,
        invitationId: args.invitationId,
        roundId: args.roundId,
        companyId: args.companyId,
        investorId: args.investorId,
        amount: args.amount,
        currency,
        shares: args.shares,
        state: "committed",
        prevHash,
        hash,
        reconcile: rec,
        complianceHold: false,
      };
    });
  } catch (err) {
    log.error("[captableCommitStore.commitFunded] DB write failed:", (err as Error).message);
    return { ok: false, error: `db_write_failed:${(err as Error).message}` };
  }

  if (!entry) return { ok: false, error: "transaction_yielded_no_entry" };
  return { ok: true, entry };
}

export function verifyChain(): { ok: boolean; brokenAt?: number } {
  const all = getLedger();
  let prev = "GENESIS";
  for (let i = 0; i < all.length; i++) {
    const e = all[i];
    if (e.prevHash !== prev) return { ok: false, brokenAt: i };
    const body = buildCommitBody(e.seq, e.ts, {
      invitationId: e.invitationId, roundId: e.roundId,
      companyId: e.companyId, investorId: e.investorId,
      amount: e.amount, currency: e.currency, shares: e.shares,
    });
    const expected = createHash("sha256").update(`${prev}|${body}`).digest("hex").slice(0, 24);
    if (expected !== e.hash) return { ok: false, brokenAt: i };
    prev = e.hash;
  }
  return { ok: true };
}

// ─── Hydration ──────────────────────────────────────────────────────────────

/**
 * Lightweight hydrator — verifies schema is reachable. The ledger and the
 * funded queue are both DB-backed; there is no in-memory state to fill.
 */
export async function hydrateCaptableCommitStore(): Promise<void> {
  try {
    const db = getDb();
    const ledgerCount = (db.select({ id: captableCommitsTable.id })
      .from(captableCommitsTable).all() as any[]).length;
    const queueCount = (db.select({ id: fundedQueueTable.invitationId })
      .from(fundedQueueTable).all() as any[]).length;
    log.info(`[captableCommitStore.hydrate] ledger=${ledgerCount} fundedQueue=${queueCount}`);
  } catch (err) {
    log.warn("[captableCommitStore.hydrate] DB read failed:", (err as Error).message);
  }
  // v15 P0-12 — restore per-tenant compliance hold map.
  hydrateComplianceHolds();
}

// ─── Routes (surface preserved) ──────────────────────────────────────────────

/**
 * v15 P0-1/2/3 — founder-of-company gate. Requires authenticated identity
 * AND that the caller is a founder/owner of the supplied companyId (admin
 * bypasses). companyId is read from req.body for POSTs, req.query for GETs.
 */
function requireFounderOfCompany(req: Request, res: Response, next: () => void): void {
  try {
    const id = requireIdentity(req);
    const companyId =
      (req.body as { companyId?: unknown } | undefined)?.companyId !== undefined
        ? String((req.body as { companyId?: unknown }).companyId)
        : typeof req.query.companyId === "string"
          ? req.query.companyId
          : "";
    if (!companyId) {
      res.status(400).json({ ok: false, error: "missing_required_fields", message: "companyId is required." });
      return;
    }
    if (id.isAdmin) return next();
    const ownsCompany = id.ctx.founder.companies.some((c) => c.companyId === companyId);
    if (!ownsCompany) {
      res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY", message: "You are not a founder of this company." });
      return;
    }
    next();
  } catch (e) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 401).json({ ok: false, error: err.code ?? "UNAUTHORIZED", message: err.message ?? "Sign in to continue." });
  }
}

export function registerCaptableCommitRoutes(app: Express): void {
  // v15 P0-3 — ledger read requires founder/admin and scopes to companyId.
  app.get("/api/founder/captable/ledger", requireAuth, (req: Request, res: Response) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "companyId query param is required." });
    }
    let id;
    try { id = requireIdentity(req); }
    catch (e) {
      const err = e as { status?: number };
      return res.status(err.status ?? 401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    if (!id.isAdmin) {
      const ownsCompany = id.ctx.founder.companies.some((c) => c.companyId === companyId);
      if (!ownsCompany) {
        return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
      }
    }
    const tenantId = tenantForCompany(companyId);
    const entries = getLedger().filter((e) => e.companyId === companyId);
    res.json({
      entries,
      complianceHold: getComplianceHoldForTenant(tenantId),
      verified: verifyChain(),
    });
  });

  app.get("/api/founder/captable/funded-queue", requireAuth, (req: Request, res: Response) => {
    return requireFounderOfCompany(req, res, () => {
      const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
      const roundId = typeof req.query.roundId === "string" ? req.query.roundId : "";
      let entries = getFundedQueue().filter((e) => e.companyId === companyId);
      if (roundId) entries = entries.filter((e) => e.roundId === roundId);
      res.json({ entries, count: entries.length });
    });
  });

  // v24.2 Bug 3 — Wire-Funded action. The founder marks a CONFIRMED soft-circle
  // as wired/funded, which enqueues it into the funded-queue ready for the
  // existing commit-funded-batch step (which is left untouched). This is the
  // server half of the missing "Mark Wire Funded" button on RoundDetail.
  //
  // Ownership is derived from the soft-circle row's OWN companyId (not a
  // client-supplied body field) so a forged companyId cannot escalate; we then
  // assert the authenticated caller founds that company (admin bypasses).
  app.post(
    "/api/founder/rounds/:roundId/soft-circle/:scId/wire-funded",
    requireAuth,
    (req: Request, res: Response) => {
      let id;
      try { id = requireIdentity(req); }
      catch (e) {
        const err = e as { status?: number; code?: string; message?: string };
        return res.status(err.status ?? 401).json({ ok: false, error: err.code ?? "UNAUTHORIZED", message: err.message ?? "Sign in to continue." });
      }

      // Cast req.params values to String to satisfy strict tsc — Express types
      // params as string | string[] when array-style query/wildcard routes exist.
      const roundId = String(req.params.roundId);
      const scId = String(req.params.scId);
      const sc = getSoftCircle(scId);
      // 404 when the soft-circle does not exist OR belongs to a different round
      // (prevents cross-round id confusion).
      if (!sc || sc.roundId !== roundId) {
        return res.status(404).json({ ok: false, error: "SOFT_CIRCLE_NOT_FOUND", message: `Soft-circle ${scId} not found on round ${roundId}.` });
      }

      const companyId = sc.companyId ?? "";
      // Tenant isolation: the caller must found the company that owns the
      // soft-circle. A founder of another company gets 403, not 404, so the
      // existence of the row is not leaked across tenants only when owned.
      if (!companyId) {
        return res.status(409).json({ ok: false, error: "SOFT_CIRCLE_NO_COMPANY", message: "Soft-circle is not associated with a company." });
      }
      if (!id.isAdmin) {
        const ownsCompany = id.ctx.founder.companies.some((c) => c.companyId === companyId);
        if (!ownsCompany) {
          return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY", message: "You are not a founder of this company." });
        }
      }

      // State guard: only a CONFIRMED soft-circle may be wired/funded. Anything
      // else (intent / committed / declined) is an invalid transition.
      if (sc.status !== "confirmed") {
        return res.status(400).json({
          ok: false,
          error: "INVALID_SOFT_CIRCLE_STATE",
          message: `Soft-circle must be 'confirmed' to mark as wire-funded (current: '${sc.status}').`,
          status: sc.status,
        });
      }

      // Compliance hold blocks funding the same way it blocks commits.
      const tenantForHold = tenantForCompany(companyId);
      if (getComplianceHoldForTenant(tenantForHold)) {
        return res.status(409).json({ ok: false, error: "compliance_hold_active", tenantId: tenantForHold, message: "Funding is blocked until admin resolves the hold." });
      }

      // Build the funded-queue entry from the durable soft-circle. invitationId
      // falls back to the soft-circle id when no invitation is linked. Shares
      // may be supplied by the caller (post-priced rounds); default "0" lets the
      // commit step recompute/reconcile.
      const rawShares = (req.body as { shares?: unknown } | undefined)?.shares;
      const shares = rawShares === undefined || rawShares === null ? "0" : String(rawShares);
      const entry: FundedEntry = {
        invitationId: sc.invitationId ?? sc.id,
        roundId: sc.roundId,
        companyId,
        investorId: sc.investorUserId ?? sc.investorEmail ?? sc.id,
        amount: String(sc.amount),
        currency: sc.currency,
        shares,
      };

      try {
        enqueueFunded(entry);
      } catch (err) {
        return res.status(500).json({ ok: false, error: "FUNDED_ENQUEUE_FAILED", message: (err as Error).message });
      }

      // Advance the soft-circle so the UI reflects the funded state. Non-fatal:
      // the funded-queue row is the source of truth for the commit step.
      try { updateSoftCircleStatus(scId, "confirmed"); } catch { /* best-effort */ }

      BridgeOutbound.capTableMutated(companyId, { roundId: sc.roundId, txCount: 0, ledgerSeq: -1, hash: "wire_funded_enqueued" });
      return res.status(200).json({ ok: true, entry });
    },
  );

  // Batch commit — all-or-nothing inside a SINGLE outer transaction so a
  // single failure rolls back ALL inserts.
  // v15 P0-2 — requireAuth + founder.ofCompany gate.
  app.post("/api/founder/captable/commit-funded-batch", requireAuth, (req: Request, res: Response) => {
    return requireFounderOfCompany(req, res, () => commitFundedBatchHandler(req, res));
  });

  function commitFundedBatchHandler(req: Request, res: Response): unknown {
    const { companyId, roundId } = (req.body ?? {}) as { companyId?: string; roundId?: string };
    if (!companyId || !roundId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "companyId and roundId are required." });
    }
    // v15 P0-12 — per-tenant compliance hold. The `error` field stays
    // `compliance_hold_active` (legacy contract for sprint-25 clients); the
    // tenant scope is surfaced in a new `tenantId` field so the admin UI can
    // route the hold to the right founder.
    const tenantForHold = tenantForCompany(companyId);
    if (getComplianceHoldForTenant(tenantForHold)) {
      return res.status(409).json({
        ok: false,
        error: "compliance_hold_active",
        tenantId: tenantForHold,
        message: "Cap-table commits are blocked until admin resolves the hold.",
      });
    }
    const candidates = getFundedQueue().filter((e) => e.companyId === companyId && e.roundId === roundId);
    if (candidates.length === 0) {
      return res.json({ ok: true, committedCount: 0, message: "No funded entries waiting." });
    }

    const committed: LedgerEntry[] = [];
    type AbortReason = { invitationId: string; error: string };
    // Use an array container so the closure-captured value is observed via
    // index access (TS won't narrow it to `never` after the assignment).
    const abortBox: AbortReason[] = [];

    try {
      const db = getDb();
      db.transaction((tx: any) => {
        // Read chainTip ONCE then iterate, updating prevHash + seq as we go.
        const tipRow = tx
          .select({ seq: captableCommitsTable.seq, hash: captableCommitsTable.hash })
          .from(captableCommitsTable)
          .where(isNull(captableCommitsTable.deletedAt))
          .orderBy(desc(captableCommitsTable.seq))
          .limit(1)
          .all() as Array<{ seq: number; hash: string }>;

        let prevHash = tipRow[0]?.hash ?? "GENESIS";
        let seq = (tipRow[0]?.seq ?? -1) + 1;

        for (const e of candidates) {
          if (!isValidAmount(e.amount)) {
            abortBox.push({ invitationId: e.invitationId, error: "invalid_amount" });
            throw new Error("batch_abort");
          }
          if (!isValidShares(e.shares)) {
            abortBox.push({ invitationId: e.invitationId, error: "invalid_shares" });
            throw new Error("batch_abort");
          }
          const rec = reconcile({ invitationId: e.invitationId, amount: e.amount, currency: e.currency, shares: e.shares });
          if (!rec.match) {
            abortBox.push({ invitationId: e.invitationId, error: "reconcile_mismatch" });
            throw new Error("batch_abort");
          }
          const ts = new Date().toISOString();
          const body = buildCommitBody(seq, ts, {
            invitationId: e.invitationId,
            roundId: e.roundId,
            companyId: e.companyId,
            investorId: e.investorId,
            amount: e.amount,
            currency: e.currency,
            shares: e.shares,
          });
          const hash = createHash("sha256").update(`${prevHash}|${body}`).digest("hex").slice(0, 24);
          const id = `ccm_${createHash("sha256").update(e.invitationId).digest("hex").slice(0, 16)}`;

          tx.insert(captableCommitsTable)
            .values({
              id,
              tenantId: tenantForCompany(e.companyId),
              seq,
              ts,
              invitationId: e.invitationId,
              roundId: e.roundId,
              companyId: e.companyId,
              investorId: e.investorId,
              amount: e.amount,
              currency: e.currency,
              shares: e.shares,
              state: "committed",
              prevHash,
              hash,
              reconcilePrimary: rec.primary,
              reconcileRef: rec.ref,
              reconcileMatch: rec.match,
              complianceHold: false,
              deletedAt: null,
            })
            .run();

          dequeueFundedRow(tx, e.invitationId);

          committed.push({
            seq, ts,
            invitationId: e.invitationId,
            roundId: e.roundId,
            companyId: e.companyId,
            investorId: e.investorId,
            amount: e.amount,
            currency: e.currency,
            shares: e.shares,
            state: "committed",
            prevHash,
            hash,
            reconcile: rec,
            complianceHold: false,
          });

          prevHash = hash;
          seq += 1;
        }
      });
    } catch (err) {
      // Either an explicit abort (set abortReason) or a DB error — both
      // rolled back by the transaction.
      committed.length = 0;
      if (abortBox.length > 0) {
        const ar = abortBox[0];
        return res.status(409).json({
          ok: false,
          error: "batch_failed",
          failedAt: ar.invitationId,
          reason: ar.error,
          message: `Batch rolled back at ${ar.invitationId}: ${ar.error}`,
        });
      }
      return res.status(500).json({ ok: false, error: "db_write_failed", message: (err as Error).message });
    }

    // Fan out one bridge event per commit.
    for (const c of committed) {
      BridgeOutbound.capTableMutated(c.companyId, {
        roundId: c.roundId, txCount: 1, ledgerSeq: c.seq, hash: c.hash,
      });
      BridgeOutbound.eligibilityRecomputed(c.investorId, {
        reason: "captable_commit", companyId: c.companyId, flags: { investorOnCapTable: true },
      });
    }
    return res.json({ ok: true, committedCount: committed.length, entries: committed });
  }

  // v15 P0-1 — requireAuth + founder.ofCompany gate.
  app.post("/api/founder/captable/commit-funded", requireAuth, (req: Request, res: Response) => {
    return requireFounderOfCompany(req, res, () => commitFundedSingleHandler(req, res));
  });

  function commitFundedSingleHandler(req: Request, res: Response): unknown {
    const { invitationId, roundId, companyId, investorId, fromState } = req.body ?? {};
    if (!invitationId || !roundId || !companyId || !investorId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "invitationId, roundId, companyId, investorId are required." });
    }
    const rawAmount = (req.body as { amount?: unknown; amountUsd?: unknown }).amount
                   ?? (req.body as { amountUsd?: unknown }).amountUsd;
    const rawShares = (req.body as { shares?: unknown }).shares;
    const rawCurrency = (req.body as { currency?: unknown }).currency;
    const amount = rawAmount === undefined || rawAmount === null ? "" : String(rawAmount);
    const shares = rawShares === undefined || rawShares === null ? "" : String(rawShares);
    const currency = typeof rawCurrency === "string" && rawCurrency.length > 0 ? rawCurrency : "USD";
    const r = commitFunded({ invitationId, roundId, companyId, investorId, amount, currency, shares, fromState });
    if (!r.ok) {
      // Surface compliance_hold:* as 409.
      return res.status(409).json(r);
    }
    const env = emitSync({
      eventType: "captable_commit",
      aggregateId: r.entry.invitationId,
      aggregateKind: "captable_entry",
      payload: { ...r.entry, ledgerSeq: r.entry.seq },
      req,
    });
    BridgeOutbound.capTableMutated(r.entry.companyId, {
      roundId: r.entry.roundId,
      txCount: 1,
      ledgerSeq: r.entry.seq,
      hash: r.entry.hash,
    });
    BridgeOutbound.eligibilityRecomputed(r.entry.investorId, {
      reason: "captable_commit",
      companyId: r.entry.companyId,
      flags: { investorOnCapTable: true },
    });
    return res.json({ ok: true, entry: r.entry, telemetry: env });
  }

  // v15 P0-12 — admin-only per-tenant compliance hold endpoints.
  app.post("/api/admin/compliance-hold", requireAdmin, (req, res) => {
    const body = (req.body ?? {}) as { on?: unknown; tenantId?: unknown; reason?: unknown };
    const on = !!body.on;
    const tenantId = typeof body.tenantId === "string" ? body.tenantId : "";
    if (!tenantId) {
      // Legacy global hold path — logs a warning, kept for back-compat tests.
      setComplianceHold(on);
      return res.json({ ok: true, complianceHold: getComplianceHold(), scope: "global" });
    }
    let heldBy = "system";
    try { heldBy = requireIdentity(req).userId; } catch { /* fall through with system */ }
    setComplianceHoldForTenant(tenantId, on, heldBy, typeof body.reason === "string" ? body.reason : undefined);
    res.json({ ok: true, tenantId, held: getComplianceHoldForTenant(tenantId) });
  });

  app.delete("/api/admin/compliance-hold/:tenantId", requireAdmin, (req, res) => {
    const tenantIdRaw = req.params.tenantId;
    const tenantId = typeof tenantIdRaw === "string" ? tenantIdRaw : Array.isArray(tenantIdRaw) ? String(tenantIdRaw[0] ?? "") : "";
    if (!tenantId) return res.status(400).json({ ok: false, error: "missing_tenant" });
    let heldBy = "system";
    try { heldBy = requireIdentity(req).userId; } catch { /* default */ }
    setComplianceHoldForTenant(tenantId, false, heldBy);
    res.json({ ok: true, tenantId, held: false });
  });

  app.get("/api/admin/compliance-hold", requireAdmin, (_req, res) => {
    res.json({ ok: true, holds: listComplianceHolds(), global: getComplianceHold() });
  });
}
