/**
 * Sprint 13 — Drift detector.
 *
 * Compares the local Capavate snapshot of an entity to the last-acked
 * Collective state and reports per-entity-row drift status.
 */
import { Registry, ALL_ENTITY_KEYS, buildSample, type EntityKey } from "@shared/schemas/sync";

export type DriftStatus = "clean" | "drifted" | "never_synced";

export interface DriftRow {
  entityKey: EntityKey;
  aggregateId: string;
  status: DriftStatus;
  driftedFields?: string[];
  lastSyncedAt?: string;
}

/* In-memory snapshot stores — populated by outbound emit and inbound ack.    */
const lastOutboundByEntity = new Map<string, { ts: string; payload: Record<string, unknown> }>(); // key=`${entity}:${aggId}`
const lastAckedByEntity = new Map<string, { ts: string; payload: Record<string, unknown> }>();
const localSnapshotByEntity = new Map<string, Record<string, unknown>>();

export function recordLocalSnapshot(entity: EntityKey, aggId: string, payload: Record<string, unknown>) {
  localSnapshotByEntity.set(`${entity}:${aggId}`, payload);
}

export function recordOutbound(entity: EntityKey, aggId: string, payload: Record<string, unknown>) {
  lastOutboundByEntity.set(`${entity}:${aggId}`, { ts: new Date().toISOString(), payload });
}

export function recordAck(entity: EntityKey, aggId: string, payload: Record<string, unknown>) {
  lastAckedByEntity.set(`${entity}:${aggId}`, { ts: new Date().toISOString(), payload });
}

export function clearDriftState() {
  lastOutboundByEntity.clear();
  lastAckedByEntity.clear();
  localSnapshotByEntity.clear();
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out;
}

/** Compute drift for every (entity, aggId) we have local state for. */
export function computeDrift(): DriftRow[] {
  const rows: DriftRow[] = [];
  for (const [key, payload] of Array.from(localSnapshotByEntity.entries())) {
    const [entity, aggId] = key.split(":") as [EntityKey, string];
    const acked = lastAckedByEntity.get(key);
    if (!acked) {
      rows.push({ entityKey: entity, aggregateId: aggId, status: "never_synced" });
      continue;
    }
    const driftedFields = diff(payload, acked.payload);
    rows.push({
      entityKey: entity,
      aggregateId: aggId,
      status: driftedFields.length === 0 ? "clean" : "drifted",
      driftedFields: driftedFields.length ? driftedFields : undefined,
      lastSyncedAt: acked.ts,
    });
  }
  return rows;
}

/** Seed: build a snapshot from each entity's `buildSample`. Used by demo + tests. */
export function seedSnapshot() {
  for (const k of ALL_ENTITY_KEYS) {
    const sample = buildSample(k);
    const id = (sample.id ?? sample.userId ?? sample.companyId ?? sample.subjectId ?? sample.policyVersion ?? `${k}_seed`) as string;
    recordLocalSnapshot(k, id, sample);
    recordAck(k, id, sample); // start clean
  }
}

// Suppress unused import warning — Registry is part of the public surface
// even if not referenced inside seedSnapshot.
void Registry;

export { ALL_ENTITY_KEYS };
export type { EntityKey };
