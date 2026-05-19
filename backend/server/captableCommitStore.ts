/**
 * Sprint 11 — Investor verification → cap-table commit pipeline.
 * Sprint 25 — INVESTOR-GRADE PRECISION HARDENING.
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
 *     safely represent share counts above 2^53 — a single Series D unicorn
 *     position can exceed that. NO FLOATS for shares. EVER.
 *   - Money amounts are STRINGS (Decimal-as-string) on the wire and in the ledger.
 *     A wire of $50,000,000.05 stored as a JS number rounds to $50,000,000.0625
 *     in some edge cases. The cap-table-engine uses decimal.js (38-digit
 *     precision, banker's rounding). The ledger must match.
 *   - The reconcile hash is computed against the canonical string form, so a
 *     primary/ref divergence cannot be hidden by float coercion.
 */
import type { Express, Request, Response } from "express";
import { createHash } from "node:crypto";
import { emitSync } from "./sprint10Telemetry";
import { BridgeOutbound } from "./lib/bridgeOutbound";

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
 * `amount` is a Decimal-as-string in `currency` (default USD).
 * `shares` is a BigInt-as-string — NEVER a JS number.
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

const ledger: LedgerEntry[] = [];
let lastHash = "GENESIS";
let complianceHold = false;

/**
 * Sprint 25 — in-memory funded-pipeline queue.
 *
 * Tracks per-invitation entries in the `funded` state, waiting for the
 * batch-commit action. In production this is a projection of all investors
 * who have wired funds for a given round but whose positions are not yet
 * appended to the immutable cap-table ledger.
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
const fundedQueue: FundedEntry[] = [];

export function enqueueFunded(e: FundedEntry): void { fundedQueue.push(e); }
export function getFundedQueue(): ReadonlyArray<FundedEntry> { return fundedQueue; }
export function clearFundedQueue(): void { fundedQueue.length = 0; }

export function setComplianceHold(on: boolean): void { complianceHold = on; }
export function getComplianceHold(): boolean { return complianceHold; }
export function getLedger(): ReadonlyArray<LedgerEntry> { return ledger; }

/**
 * V4 (Patch v8) — Public read APIs used by membershipStore to derive
 * entitlements. These do NOT touch packages/cap-table-engine* math; they
 * project the immutable ledger into views the entitlement layer needs.
 */
export function listCommitsForUser(userId: string, companyId?: string): ReadonlyArray<LedgerEntry> {
  return ledger.filter((e) =>
    e.state === "committed" &&
    e.investorId === userId &&
    (!companyId || e.companyId === companyId)
  );
}

export function listMembersForCompany(companyId: string): ReadonlyArray<LedgerEntry> {
  return ledger.filter((e) => e.state === "committed" && e.companyId === companyId);
}
export function clearLedger(): void {
  ledger.length = 0;
  lastHash = "GENESIS";
  complianceHold = false;
  fundedQueue.length = 0;
}

export function isValidTransition(from: CommitState, to: CommitState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Sprint 25 — precision-preserving input validation.
 *
 * `amount` must be a valid Decimal-as-string (no scientific notation, optional
 * single leading `-`, optional single `.`, only digits otherwise) and positive.
 * `shares` must be a valid BigInt-as-string (digits only, optional leading `-`)
 * and positive.
 */
const AMOUNT_RE = /^-?\d+(\.\d+)?$/;
const SHARES_RE = /^-?\d+$/;

export function isValidAmount(s: unknown): s is string {
  return typeof s === "string" && AMOUNT_RE.test(s) && Number(s) > 0;
}
export function isValidShares(s: unknown): s is string {
  if (typeof s !== "string" || !SHARES_RE.test(s)) return false;
  try { return BigInt(s) > 0n; } catch { return false; }
}

/**
 * Reconcile primary + ref engines. Both compute the same expected hash for
 * the given input — in production they are independent computations of the
 * post-money cap table. Here we model success/failure deterministically so
 * the test can exercise both paths.
 *
 * Sprint 25: hash is computed over the canonical string form, so a primary/ref
 * divergence cannot be masked by float coercion.
 */
export function reconcile(input: { invitationId: string; amount: string; currency: string; shares: string }): { primary: string; ref: string; match: boolean } {
  const canonical = `${input.invitationId}:${input.amount}:${input.currency}:${input.shares}`;
  const a = createHash("sha256").update(`primary:${canonical}`).digest("hex").slice(0, 16);
  const b = createHash("sha256").update(`ref:${canonical}`).digest("hex").slice(0, 16);
  // Match policy: in this preview the two engines reconcile when both money
  // and shares are positive and well-formed (validated by the caller).
  const match = isValidAmount(input.amount) && isValidShares(input.shares);
  return { primary: a, ref: match ? a : b, match };
}

export type CommitResult =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; error: string };

export function commitFunded(args: {
  invitationId: string;
  roundId: string;
  companyId: string;
  investorId: string;
  /** Decimal-as-string. NEVER a number. */
  amount: string;
  /** ISO 4217 currency code. Defaults to USD if omitted. */
  currency?: string;
  /** BigInt-as-string. NEVER a number. */
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
  const seq = ledger.length;
  const ts = new Date().toISOString();
  // Sprint 11/25 — keep the body shape stable (excluding fromState, which is a
  // pre-condition not part of the persisted entry) so verifyChain can replay it.
  // All numeric fields are STRINGS — canonical, precision-preserving.
  const body = JSON.stringify({
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
  });
  const hash = createHash("sha256").update(`${lastHash}|${body}`).digest("hex").slice(0, 24);
  const entry: LedgerEntry = {
    seq, ts,
    invitationId: args.invitationId,
    roundId: args.roundId,
    companyId: args.companyId,
    investorId: args.investorId,
    amount: args.amount,
    currency,
    shares: args.shares,
    state: "committed",
    prevHash: lastHash,
    hash,
    reconcile: rec,
    complianceHold: false,
  };
  ledger.push(entry);
  lastHash = hash;
  return { ok: true, entry };
}

export function verifyChain(): { ok: boolean; brokenAt?: number } {
  let prev = "GENESIS";
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    if (e.prevHash !== prev) return { ok: false, brokenAt: i };
    const body = JSON.stringify({
      seq: e.seq, ts: e.ts,
      invitationId: e.invitationId, roundId: e.roundId,
      companyId: e.companyId, investorId: e.investorId,
      amount: e.amount, currency: e.currency, shares: e.shares,
      state: "committed",
    });
    const expected = createHash("sha256").update(`${prev}|${body}`).digest("hex").slice(0, 24);
    if (expected !== e.hash) return { ok: false, brokenAt: i };
    prev = e.hash;
  }
  return { ok: true };
}

export function registerCaptableCommitRoutes(app: Express): void {
  app.get("/api/founder/captable/ledger", (_req, res) => {
    res.json({ entries: ledger, complianceHold, verified: verifyChain() });
  });

  // Sprint 25 — GET the funded-but-not-yet-committed pipeline for a round.
  app.get("/api/founder/captable/funded-queue", (req: Request, res: Response) => {
    const roundId = typeof req.query.roundId === "string" ? req.query.roundId : "";
    const entries = roundId ? fundedQueue.filter((e) => e.roundId === roundId) : fundedQueue.slice();
    res.json({ entries, count: entries.length });
  });

  // Sprint 25 — batch commit: commits all funded entries for a {companyId, roundId}
  // in a single all-or-nothing transaction. If any single entry fails (bad amount,
  // bad shares, compliance hold, reconcile mismatch), the WHOLE batch is rolled
  // back — no partial commits ever land in the immutable ledger.
  app.post("/api/founder/captable/commit-funded-batch", (req: Request, res: Response) => {
    const { companyId, roundId } = (req.body ?? {}) as { companyId?: string; roundId?: string };
    if (!companyId || !roundId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "companyId and roundId are required." });
    }
    if (complianceHold) {
      return res.status(409).json({ ok: false, error: "compliance_hold_active", message: "Cap-table commits are blocked until admin resolves the hold." });
    }
    const candidates = fundedQueue.filter((e) => e.companyId === companyId && e.roundId === roundId);
    if (candidates.length === 0) {
      return res.json({ ok: true, committedCount: 0, message: "No funded entries waiting." });
    }

    // Snapshot ledger state for rollback.
    const ledgerSnapshot = ledger.slice();
    const lastHashSnapshot = lastHash;
    const committed: LedgerEntry[] = [];
    for (const e of candidates) {
      const r = commitFunded({
        invitationId: e.invitationId,
        roundId: e.roundId,
        companyId: e.companyId,
        investorId: e.investorId,
        amount: e.amount,
        currency: e.currency,
        shares: e.shares,
        fromState: "funded",
      });
      if (!r.ok) {
        // Roll back: restore ledger + lastHash exactly as they were.
        ledger.length = 0;
        for (const x of ledgerSnapshot) ledger.push(x);
        lastHash = lastHashSnapshot;
        return res.status(409).json({
          ok: false,
          error: "batch_failed",
          failedAt: e.invitationId,
          reason: r.error,
          message: `Batch rolled back at ${e.invitationId}: ${r.error}`,
        });
      }
      committed.push(r.entry);
    }
    // Success — remove the now-committed entries from the funded queue.
    for (const c of committed) {
      const idx = fundedQueue.findIndex((e) => e.invitationId === c.invitationId);
      if (idx >= 0) fundedQueue.splice(idx, 1);
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
    // Sprint 25 — INVESTOR-GRADE precision: accept strings only for amount + shares.
    // Legacy clients sending `amountUsd` / numeric `shares` are coerced to strings
    // (best-effort backward compat) but new clients MUST send strings.
    const { invitationId, roundId, companyId, investorId, fromState } = req.body ?? {};
    if (!invitationId || !roundId || !companyId || !investorId) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", message: "invitationId, roundId, companyId, investorId are required." });
    }
    // Accept the new `amount` (string) or legacy `amountUsd` (number/string), coerce to string.
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
    // Sprint 13 — fan out to Collective bridge.
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
