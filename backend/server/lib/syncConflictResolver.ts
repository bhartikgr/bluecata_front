/**
 * Sprint 13 — Centralized conflict resolver.
 *
 * Wraps the generic `resolveConflicts` with per-entity dispatch using the
 * registry. Used by inbound handlers that mutate Capavate-side state.
 */
import { Registry, type EntityKey, type ConflictResolution } from "@shared/schemas/sync";

export function resolveForEntity<T extends Record<string, unknown>>(
  key: EntityKey,
  local: T,
  remote: Partial<T>,
  localUpdatedAt?: string,
  remoteUpdatedAt?: string,
): ConflictResolution<T> {
  const e = Registry[key];
  // The schema files all expose `mergeWithConflicts(local, remote, lUA?, rUA?)`.
  // The generic narrowing here is satisfied by the runtime call — we trust the registry shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (e as any).mergeWithConflicts(local, remote, localUpdatedAt, remoteUpdatedAt) as ConflictResolution<T>;
}

export type { ConflictResolution } from "@shared/schemas/sync";
