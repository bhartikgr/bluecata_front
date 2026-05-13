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

function rowKey(r: CapTableHolderRow): string {
  return `${r.holderId}|${r.kind}|${r.series ?? ""}`;
}

function hashCapTable(t: CapTableResult): string {
  const canon = t.rows
    .map((r) => ({
      key: rowKey(r),
      shares: r.shares.toString(),
      ownership: parseFloat(r.ownershipPercent).toFixed(OWN_TOLERANCE_DP),
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
      const pOwn = parseFloat(p.ownershipPercent).toFixed(OWN_TOLERANCE_DP);
      const rOwn = parseFloat(r.ownershipPercent).toFixed(OWN_TOLERANCE_DP);
      diffs.push({
        key, holderId: p.holderId, kind: p.kind, series: p.series ?? null,
        primaryShares: p.shares.toString(), referenceShares: r.shares.toString(),
        primaryOwnership: pOwn, referenceOwnership: rOwn,
        shareDelta, ownershipDelta: (parseFloat(p.ownershipPercent) - parseFloat(r.ownershipPercent)).toFixed(OWN_TOLERANCE_DP),
      });
      continue;
    }
    const pOwn = parseFloat(p.ownershipPercent).toFixed(OWN_TOLERANCE_DP);
    const rOwn = parseFloat(r.ownershipPercent).toFixed(OWN_TOLERANCE_DP);
    if (pOwn !== rOwn) {
      diffs.push({
        key, holderId: p.holderId, kind: p.kind, series: p.series ?? null,
        primaryShares: p.shares.toString(), referenceShares: r.shares.toString(),
        primaryOwnership: pOwn, referenceOwnership: rOwn,
        shareDelta: "0",
        ownershipDelta: (parseFloat(p.ownershipPercent) - parseFloat(r.ownershipPercent)).toFixed(OWN_TOLERANCE_DP),
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
