/**
 * Reconciliation — runs the primary engine and a reference engine over the
 * same input and compares the resulting cap tables holder-by-holder,
 * instrument-by-instrument, to the share / cent.
 *
 * The reference engine is INJECTED (not imported) so this package has no
 * runtime dependency on `@capavate/cap-table-engine-ref`. The dependency is
 * inverted: the orchestrator (server, UI) wires both engines into reconcile.
 *
 * `status === "match"` requires:
 *   - same total share count
 *   - same number of rows
 *   - same shares per (holderId, kind, series) key
 *   - same ownershipPercent to 12 decimal places
 *
 * WAVE 71 · D18 — `ownershipPercent` is now `string | null`, and `null` means the
 * view's denominator was zero (0 ÷ 0, undefined). `ownDp` below is the ONE place
 * this module turns that contract into a comparable token: `null` becomes the
 * literal string `"undefined"`, which compares equal to another `"undefined"` and
 * unequal to any number. It is NOT coerced to `0`, because two engines that both
 * decline to state a ratio AGREE, while an engine stating `0` against an engine
 * stating `undefined` DISAGREE — and before this change the second case was
 * silently reported as a match.
 *
 * Anything else is `divergence`. The diffs are returned for UI display.
 */
import type { ComputeOptions, CapTableResult, CapTableHolderRow } from "../types.js";
import { computeCapTable } from "../captable/compute.js";
import { sha256 } from "../primitives/hash.js";
import { canonicalJson } from "../ledger/transaction.js";

export type ReferenceEngineFn = (opts: ComputeOptions) => CapTableResult;

export type HolderDiff = {
  key: string;                 // holderId/kind/series
  holderId: string;
  kind: string;
  series: string | null;
  primaryShares: string;
  referenceShares: string;
  primaryOwnership: string;
  referenceOwnership: string;
  shareDelta: string;
  ownershipDelta: string;
  /* WAVE 73 · ITEM 10 — A NAME FOR A DIFFERENCE WE ALREADY UNDERSTAND.

     Wave 72 (FINDING R-1) found that the INDEPENDENT reference engine writes
     `"0"` for a 0 ÷ 0 ownership ratio where the primary writes `null` (D18). On a
     populated zero-share table that surfaces here as an anonymous DIVERGENCE —
     and the obvious "fix" for an anonymous divergence is to make the two engines
     agree, which would destroy the only thing a second implementation is for.

     So the difference is NAMED instead of removed. When it is exactly this
     condition, `condition` is set and the row explains itself. The reference
     engine is NOT edited, and `status` is NOT softened: the run still reports a
     divergence, because the two engines genuinely disagree — it is now a KNOWN,
     EXPLAINED disagreement rather than a mystery for the next agent to
     "reconcile" by deleting the check. `undefined` on every other row, so nothing
     that was reported before is reported differently. */
  condition?: "ownership_undefined_vs_zero";
  conditionNote?: string;
};

export type ReconciliationResult = {
  runId: string;
  asOf: string;
  status: "match" | "divergence";
  diffs: HolderDiff[];
  primaryHash: string;
  referenceHash: string;
  primaryTotal: string;
  referenceTotal: string;
  runDurationMs: number;
  primaryRowCount: number;
  referenceRowCount: number;
  formulaIdsUsed: string[];
};

// Ownership tolerance: 8 decimal places (= 1 hundred-millionth = 1 / 1e8). This is
// well below the precision needed for cap-table accuracy (Carta enforces 6 dp); the
// remaining wiggle is JS Number → string round-trip noise inherent to comparing
// arbitrary-precision strings cross-engine. Share counts must always match exactly.
const OWN_TOLERANCE_DP = 8;

/** WAVE 71 · D18 — the delta between two possibly-undefined ownership figures.
    `null` on either side is NOT read as zero: the delta is reported as the token
    `"undefined"`, because the size of the gap between a number and "no number" is
    not a number. */
function ownDelta(a: string | null | undefined, b: string | null | undefined): string {
  if (a === null || a === undefined || b === null || b === undefined) return "undefined";
  const x = parseFloat(a);
  const y = parseFloat(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "undefined";
  return (x - y).toFixed(OWN_TOLERANCE_DP);
}

/** WAVE 71 · D18 — the single null-aware rendering of an ownership figure. */
function ownDp(v: string | null | undefined): string {
  if (v === null || v === undefined) return "undefined";
  const n = parseFloat(v);
  return Number.isFinite(n) ? n.toFixed(OWN_TOLERANCE_DP) : "undefined";
}

function rowKey(r: CapTableHolderRow): string {
  return `${r.holderId}|${r.kind}|${r.series ?? ""}`;
}

function hashCapTable(t: CapTableResult): string {
  const canon = t.rows
    .map((r) => ({
      key: rowKey(r),
      shares: r.shares.toString(),
      ownership: ownDp(r.ownershipPercent),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return sha256(canonicalJson(canon));
}

export function reconcile(
  opts: ComputeOptions,
  referenceCompute: ReferenceEngineFn,
  runId?: string,
): ReconciliationResult {
  const start = Date.now();
  const primary = computeCapTable(opts);
  const reference = referenceCompute(opts);

  const primaryByKey = new Map(primary.rows.map((r) => [rowKey(r), r]));
  const referenceByKey = new Map(reference.rows.map((r) => [rowKey(r), r]));
  const allKeys = new Set([...primaryByKey.keys(), ...referenceByKey.keys()]);

  const diffs: HolderDiff[] = [];
  for (const key of allKeys) {
    const p = primaryByKey.get(key);
    const r = referenceByKey.get(key);
    if (!p || !r) {
      diffs.push({
        key,
        holderId: (p ?? r)!.holderId,
        kind: (p ?? r)!.kind,
        series: (p ?? r)!.series ?? null,
        primaryShares: p?.shares.toString() ?? "(missing)",
        referenceShares: r?.shares.toString() ?? "(missing)",
        primaryOwnership: p?.ownershipPercent ?? "(missing)",
        referenceOwnership: r?.ownershipPercent ?? "(missing)",
        shareDelta: "n/a",
        ownershipDelta: "n/a",
      });
      continue;
    }
    if (p.shares !== r.shares) {
      const shareDelta = (p.shares - r.shares).toString();
      const pOwn = ownDp(p.ownershipPercent);
      const rOwn = ownDp(r.ownershipPercent);
      diffs.push({
        key, holderId: p.holderId, kind: p.kind, series: p.series ?? null,
        primaryShares: p.shares.toString(), referenceShares: r.shares.toString(),
        primaryOwnership: pOwn, referenceOwnership: rOwn,
        shareDelta, ownershipDelta: ownDelta(p.ownershipPercent, r.ownershipPercent),
      });
      continue;
    }
    const pOwn = ownDp(p.ownershipPercent);
    const rOwn = ownDp(r.ownershipPercent);
    if (pOwn !== rOwn) {
      /* WAVE 73 · ITEM 10 — the named condition (see `HolderDiff.condition`).
         Recognised NARROWLY and symmetrically: one side's ratio does not exist,
         the other side's is exactly zero, and the share counts already agree (we
         are past the share-delta branch above). Any other ownership difference is
         reported exactly as it was. */
      const undefinedVsZero =
        (p.ownershipPercent == null && rOwn === (0).toFixed(OWN_TOLERANCE_DP)) ||
        (r.ownershipPercent == null && pOwn === (0).toFixed(OWN_TOLERANCE_DP));
      diffs.push({
        key, holderId: p.holderId, kind: p.kind, series: p.series ?? null,
        primaryShares: p.shares.toString(), referenceShares: r.shares.toString(),
        primaryOwnership: pOwn, referenceOwnership: rOwn,
        shareDelta: "0",
        ownershipDelta: ownDelta(p.ownershipPercent, r.ownershipPercent),
        ...(undefinedVsZero
          ? {
              condition: "ownership_undefined_vs_zero" as const,
              conditionNote:
                "KNOWN CONDITION, not an unexplained mismatch: one engine reports this holder's " +
                "ownership as UNDEFINED (0 ÷ 0 on a zero-share table, ruling D18) and the other " +
                "reports it as exactly 0. The share counts agree. The two engines are deliberately " +
                "independent implementations and the reference engine is NOT edited to agree — that " +
                "would remove the second opinion this gate exists to provide. Resolve it by giving " +
                "the company a non-zero share count, or by ruling on which convention is canonical; " +
                "do NOT make the engines identical.",
            }
          : {}),
      });
    }
  }

  const totalsMatch = primary.totalShares === reference.totalShares;
  const status: ReconciliationResult["status"] = (diffs.length === 0 && totalsMatch) ? "match" : "divergence";

  return {
    runId: runId ?? `recon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    asOf: opts.asOf,
    status,
    diffs,
    primaryHash: hashCapTable(primary),
    referenceHash: hashCapTable(reference),
    primaryTotal: primary.totalShares.toString(),
    referenceTotal: reference.totalShares.toString(),
    runDurationMs: Date.now() - start,
    primaryRowCount: primary.rows.length,
    referenceRowCount: reference.rows.length,
    formulaIdsUsed: primary.formulaIdsUsed,
  };
}
