/**
 * In-memory admin store. Holds custom formulas, lifecycle policy overrides,
 * and audit-log entries appended as admins make changes.
 *
 * This mirrors what would be persisted to Postgres + outbox in production. For the
 * preview build it's all in-memory and survives navigation.
 */
import { create } from "@/lib/createStore";
import type { FormulaRecord, Region } from "@capavate/cap-table-engine";

export type LifecyclePolicies = {
  founderDashboardTenureDays: number;
  archivalRetentionDays: number;
  governanceMetricsCadenceDays: number;
  softCircleExpiryDays: number;
  invitationExpiryDays: number;
};

const DEFAULT_POLICIES: LifecyclePolicies = {
  founderDashboardTenureDays: 180,
  archivalRetentionDays: 3650,
  governanceMetricsCadenceDays: 30,
  softCircleExpiryDays: 14,
  invitationExpiryDays: 21,
};

export type AuditEntry = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  prevHash: string;
  hash: string;
  payload: Record<string, unknown>;
};

export type FormulaTestRun = {
  formulaKey: string;
  status: "pass" | "fail";
  passed: number;
  failed: number;
  ranAt: string;
};

type AdminState = {
  customFormulas: FormulaRecord[];
  formulaDrafts: Record<string, FormulaRecord>;
  policies: LifecyclePolicies;
  auditLog: AuditEntry[];
  testRuns: Record<string, FormulaTestRun>;

  registerFormula: (f: FormulaRecord) => void;
  saveDraft: (key: string, f: FormulaRecord) => void;
  setPolicies: (p: Partial<LifecyclePolicies>) => void;
  appendAudit: (e: Omit<AuditEntry, "id" | "ts" | "prevHash" | "hash">) => void;
  recordTestRun: (key: string, run: FormulaTestRun) => void;
};

function fnvHash(input: string): string {
  let h = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export const useAdminStore = create<AdminState>((set, get) => ({
  customFormulas: [],
  formulaDrafts: {},
  policies: DEFAULT_POLICIES,
  auditLog: [
    {
      id: "audit-genesis",
      ts: "2026-04-01T08:00:00Z",
      actor: "system",
      action: "audit_log.initialized",
      target: "audit_log",
      prevHash: "0".repeat(8),
      hash: fnvHash("genesis"),
      payload: { note: "Audit log initialized" },
    },
  ],
  testRuns: {},

  registerFormula: (f) => set((s) => ({ customFormulas: [...s.customFormulas, f] })),
  saveDraft: (key, f) => set((s) => ({ formulaDrafts: { ...s.formulaDrafts, [key]: f } })),
  setPolicies: (p) => set((s) => ({ policies: { ...s.policies, ...p } })),
  appendAudit: (e) => set((s) => {
    const prev = s.auditLog[s.auditLog.length - 1];
    const id = `audit-${s.auditLog.length}`;
    const ts = new Date().toISOString();
    const prevHash = prev?.hash ?? "0".repeat(8);
    const payload = JSON.stringify({ ...e, ts, prevHash });
    const hash = fnvHash(payload);
    return { auditLog: [...s.auditLog, { id, ts, prevHash, hash, ...e }] };
  }),
  recordTestRun: (key, run) => set((s) => ({ testRuns: { ...s.testRuns, [key]: run } })),
}));

// Trick to satisfy TS without a real zustand dep — see createStore.ts
export type { AdminState };
