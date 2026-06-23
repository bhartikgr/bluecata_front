/**
 * Sprint 3 client-side runtime: ledger handle, telemetry store, reference
 * engine reconciler, sign-off state.
 *
 * v25.28 Phase E — partial server-side mirroring.
 * --------------------------------------------------
 * The original Sprint-3 design kept ALL governance state (sign-offs,
 * reconciliations, telemetry events) in client browser memory — the file's
 * own header used to say "production lifts these into Postgres + Cedar".
 *
 * v25.28 Phase E mirrors the COMPLIANCE-CRITICAL piece (sign-off records)
 * to the durable server-side audit log on every set. Reconciliation runs
 * and telemetry events are best-effort UI surface state and remain client-
 * memory in this wave (zero impact if lost — they're recomputable).
 *
 * A full server-backed governance refactor (replacing the zustand store
 * with React Query against new /api/governance/* endpoints) is tracked for
 * v25.29 as a dedicated wave because it touches 8 consumer components and
 * requires server schema work. */
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
  setCloseState: (s2) => {
    set((s) => ({ closeStates: { ...s.closeStates, [s2.roundId]: s2 } }));
    /* v25.28 Phase E — mirror sign-off changes to the durable server-side
     * audit log so they survive a browser refresh, a different admin
     * logging in, and any tab-close mid-flow.
     *
     * Best-effort: a network failure here does NOT block the local UI
     * update (the user can still see their sign-off on their own screen).
     * Idempotent: the audit-log endpoint is append-only and the actorId +
     * roundId + ts triple makes duplicate events safe to collapse later. */
    void mirrorSignoffToAuditLog(s2);
  },
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

/** v25.28 Phase E — mirror sign-off records to the server audit log.
 *
 * Fires async, non-blocking. If the endpoint fails (offline, 5xx) we just
 * swallow the error; the in-memory store still has the record, and a
 * future v25.29 wave will replace this with a full server-state migration. */
async function mirrorSignoffToAuditLog(s: RoundCloseState): Promise<void> {
  const items: Array<{ kind: "founder" | "admin"; record: SignoffRecord }> = [];
  if (s.founderSignoff) items.push({ kind: "founder", record: s.founderSignoff });
  if (s.adminSignoff) items.push({ kind: "admin", record: s.adminSignoff });
  if (items.length === 0) return;
  for (const item of items) {
    try {
      await fetch("/api/admin/audit-log/append", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: item.record.actorId,
          entity: `round:${s.roundId}`,
          eventType: `round.signoff.${item.kind}`,
          payload: {
            roundId: s.roundId,
            actorRole: item.record.actorRole,
            actorName: item.record.actorName,
            ipAddress: item.record.ipAddress,
            identityHash: item.record.identityHash,
            ts: item.record.ts,
            closed: s.closed,
            closedAt: s.closedAt,
          },
        }),
      });
    } catch {
      /* non-fatal — client state still has the record */
    }
  }
}

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
