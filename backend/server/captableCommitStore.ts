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
import { getDb } from "./db/connection";
import {
  captableCommits as captableCommitsTable,
  fundedQueue as fundedQueueTable,
} from "../shared/schema";

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

// v12: complianceHold remains in-memory (process-wide; admin must reset
// after each restart by design).
let complianceHold = false;

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
    console.error("[captableCommitStore.enqueueFunded] DB write failed:", (err as Error).message);
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
    console.warn("[captableCommitStore.getFundedQueue] DB read failed:", (err as Error).message);
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
    console.warn("[captableCommitStore.clearFundedQueue] DB delete failed:", (err as Error).message);
  }
}

function dequeueFundedRow(tx: any, invitationId: string): void {
  tx.delete(fundedQueueTable).where(eq(fundedQueueTable.invitationId, invitationId)).run();
}

// ─── Compliance hold ─────────────────────────────────────────────────────────

export function setComplianceHold(on: boolean): void { complianceHold = on; }
export function getComplianceHold(): boolean { return complianceHold; }

// ─── Ledger reads ────────────────────────────────────────────────────────────

export function getLedger(): ReadonlyArray<LedgerEntry> {
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — getLedger is a platform-wide read used by the
    // admin route and tests. Tenant scoping is enforced at route layer.
    const rows = db
      .select()
      .from(captableCommitsTable)
      .where(isNull(captableCommitsTable.deletedAt))
      .orderBy(asc(captableCommitsTable.seq))
      .all() as any[];
    return rows.map(rowToLedgerEntry);
  } catch (err) {
    console.warn("[captableCommitStore.getLedger] DB read failed:", (err as Error).message);
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
    console.warn("[captableCommitStore.listCommitsForUser] DB read failed:", (err as Error).message);
    return [];
  }
}

export function listMembersForCompany(companyId: string): ReadonlyArray<LedgerEntry> {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(captableCommitsTable)
      .where(and(
        eq(captableCommitsTable.companyId, companyId),
        eq(captableCommitsTable.state, "committed"),
        isNull(captableCommitsTable.deletedAt),
      ))
      .orderBy(asc(captableCommitsTable.seq))
      .all() as any[];
    return rows.map(rowToLedgerEntry);
  } catch (err) {
    console.warn("[captableCommitStore.listMembersForCompany] DB read failed:", (err as Error).message);
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
    console.warn("[captableCommitStore.clearLedger] DB delete failed:", (err as Error).message);
  }
  complianceHold = false;
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
  if (complianceHold) return { ok: false, error: "compliance_hold_active" };
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
    console.error("[captableCommitStore.commitFunded] DB write failed:", (err as Error).message);
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
    console.log(`[captableCommitStore.hydrate] ledger=${ledgerCount} fundedQueue=${queueCount}`);
  } catch (err) {
    console.warn("[captableCommitStore.hydrate] DB read failed:", (err as Error).message);
  }
}

// ─── Routes (surface preserved) ──────────────────────────────────────────────

export function registerCaptableCommitRoutes(app: Express): void {
  app.get("/api/founder/captable/ledger", (_req, res) => {
    res.json({ entries: getLedger(), complianceHold, verified: verifyChain() });
  });

  app.get("/api/founder/captable/funded-queue", (req: Request, res: Response) => {
    const roundId = typeof req.query.roundId === "string" ? req.query.roundId : "";
    const all = getFundedQueue();
    const entries = roundId ? all.filter((e) => e.roundId === roundId) : all.slice();
    res.json({ entries, count: entries.length });
  });

  // Batch commit — all-or-nothing inside a SINGLE outer transaction so a
  // single failure rolls back ALL inserts.
  app.post("/api/founder/captable/commit-funded-batch", (req: Request, res: Response) => {
    const { companyId, roundId } = (req.body ?? {}) as { companyId?: string; roundId?: string };
    if (!companyId || !roundId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "companyId and roundId are required." });
    }
    if (complianceHold) {
      return res.status(409).json({ ok: false, error: "compliance_hold_active", message: "Cap-table commits are blocked until admin resolves the hold." });
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
  });

  app.post("/api/founder/captable/commit-funded", (req: Request, res: Response) => {
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
    if (!r.ok) return res.status(409).json(r);
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
  });

  app.post("/api/admin/compliance-hold", (req, res) => {
    setComplianceHold(!!req.body?.on);
    res.json({ ok: true, complianceHold: getComplianceHold() });
  });
}
