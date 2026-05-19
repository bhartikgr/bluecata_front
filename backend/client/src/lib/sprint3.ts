/**
 * Sprint 3 client-side runtime: ledger handle, telemetry store, reference
 * engine reconciler, sign-off state. All in-memory; production lifts these
 * into Postgres + Cedar policy enforcement.
 */
import { create } from "@/lib/createStore";
import {
  TelemetryStore, defaultTelemetryStore,
  type TelemetryEvent, type TelemetryEventBody,
  ALL_EVENT_TYPES, categoryOf,
  BenchmarkStore, defaultBenchmarkStore,
} from "@capavate/telemetry";
import {
  emptyLedger, type LedgerHandle,
  reconcile, type ReconciliationResult,
  type ComputeOptions, type Holder,
} from "@capavate/cap-table-engine";
import { referenceComputeCapTable } from "@capavate/cap-table-engine-ref";

export type SignoffRecord = {
  actorId: string;
  actorName: string;
  actorRole: "founder" | "admin";
  ts: string;
  ipAddress?: string;
  identityHash: string;
};

export type RoundCloseState = {
  roundId: string;
  reconciliation?: ReconciliationResult;
  founderSignoff?: SignoffRecord;
  adminSignoff?: SignoffRecord;
  closed: boolean;
  closedAt?: string;
};

type Sprint3State = {
  ledger: LedgerHandle;
  reconciliations: ReconciliationResult[];
  closeStates: Record<string, RoundCloseState>;
  telemetryTick: number;     // bumped to force re-renders that depend on the singleton store
  benchmarkTick: number;
  setLedger: (l: LedgerHandle) => void;
  recordReconciliation: (r: ReconciliationResult) => void;
  setCloseState: (s: RoundCloseState) => void;
  bumpTelemetry: () => void;
  bumpBenchmarks: () => void;
};

export const useSprint3 = create<Sprint3State>((set, get) => ({
  ledger: emptyLedger(),
  reconciliations: [],
  closeStates: {},
  telemetryTick: 0,
  benchmarkTick: 0,
  setLedger: (l) => set({ ledger: l }),
  recordReconciliation: (r) => set((s) => ({ reconciliations: [...s.reconciliations, r] })),
  setCloseState: (s2) =>
    set((s) => ({ closeStates: { ...s.closeStates, [s2.roundId]: s2 } })),
  bumpTelemetry: () => set((s) => ({ telemetryTick: s.telemetryTick + 1 })),
  bumpBenchmarks: () => set((s) => ({ benchmarkTick: s.benchmarkTick + 1 })),
}));

// Re-export the shared singletons so the rest of the app uses them.
export {
  defaultTelemetryStore, defaultBenchmarkStore,
  ALL_EVENT_TYPES, categoryOf,
  referenceComputeCapTable,
};

export type { TelemetryEvent, TelemetryEventBody };

/** Convenience wrapper: record + bump react re-renders. */
export function emit(body: TelemetryEventBody, ctx: Parameters<typeof defaultTelemetryStore.recordEvent>[1]) {
  const e = defaultTelemetryStore.recordEvent(body, ctx);
  useSprint3.getState().bumpTelemetry();
  return e;
}

/** Run reconciliation given engine inputs; record into the store + telemetry. */
export function runReconciliation(opts: ComputeOptions, ctx: { actorId: string; actorRole: "founder" | "admin" | "system"; companyId: string; ipAddress?: string }) {
  const r = reconcile(opts, referenceComputeCapTable);
  useSprint3.getState().recordReconciliation(r);
  emit({
    type: "reconciliation.run",
    payload: {
      runId: r.runId,
      companyId: ctx.companyId,
      status: r.status,
      durationMs: r.runDurationMs,
      primaryHash: r.primaryHash,
      referenceHash: r.referenceHash,
    },
  }, { companyId: ctx.companyId, actorId: ctx.actorId, actorRole: ctx.actorRole, ipAddress: ctx.ipAddress });
  if (r.status === "divergence") {
    emit({
      type: "reconciliation.divergence_detected",
      payload: { runId: r.runId, companyId: ctx.companyId, diffCount: r.diffs.length },
    }, { companyId: ctx.companyId, actorId: ctx.actorId, actorRole: ctx.actorRole, ipAddress: ctx.ipAddress });
  }
  return r;
}

/** Build a tiny canonical compute-options for a given mock company. */
/** Cached real securities per company — populated by loadRealSecurities() */
const _realSecuritiesCache: Record<string, unknown[]> = {};

/** Async loader: fetch real securities from the server and cache. */
export async function loadRealSecurities(companyId: string): Promise<unknown[]> {
  try {
    const res = await fetch(`/api/companies/${encodeURIComponent(companyId)}/securities`);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    _realSecuritiesCache[companyId] = Array.isArray(data) ? data : [];
  } catch {
    // fall back to empty; caller uses hardcoded demo data
    _realSecuritiesCache[companyId] ??= [];
  }
  return _realSecuritiesCache[companyId];
}

export function buildDemoComputeOpts(companyId: string): ComputeOptions {
  // Defect 44 — load real securities if cached; fall back to demo seed
  const real = _realSecuritiesCache[companyId];
  const holders: Holder[] = real && real.length > 0
    ? Array.from(new Map((real as any[]).map(s => [s.holderName, { id: s.holderName, name: s.holderName, type: s.holderType ?? "investor" }])).values())
    : [
        { id: "founder1", name: "Avi Barnes", type: "founder" },
        { id: "founder2", name: "Mira Chen", type: "founder" },
        { id: "yc-safe", name: "YC Cohort SAFE", type: "investor" },
        { id: "investors-A", name: "Series A Lead", type: "investor" },
        { id: "pool", name: "ESOP Pool", type: "pool" },
      ];
  return {
    companyId,
    asOf: new Date().toISOString(),
    view: "fully_diluted",
    formulaRegion: "US",
    holders,
    transactions: [
      { type: "issue", date: "2024-01-15", security: { id: "s-f1", holderId: "founder1", kind: "common", series: "Common", shares: 5000000n } },
      { type: "issue", date: "2024-01-15", security: { id: "s-f2", holderId: "founder2", kind: "common", series: "Common", shares: 3000000n } },
      { type: "issue", date: "2024-06-01", security: { id: "s-safe-1", holderId: "yc-safe", kind: "safe", investmentAmount: "500000", currency: "USD", safe: { type: "post_money_cap", cap: "10000000" } } },
      { type: "issue_preferred_round", date: "2025-09-01", round: { id: "A", series: "Series A", preMoneyValuation: "30000000", investmentAmount: "8000000", pricePerShare: "3.50", currency: "USD", liquidationPreferenceMultiple: 1, participating: false, antiDilution: "broad_based" } },
    ],
  };
}
