import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 9 — Audit Log Entry (append-only, hash-chained).
 * SOT: Capavate. Trigger: audit_log.appended.
 */
export const AuditEntryCanonicalSchema = z.object({
  id: z.string(),
  ts: z.string(),
  actorUserId: z.string(),
  actorRole: z.string().optional(),
  action: z.string(),
  aggregateKind: z.string().optional(),
  aggregateId: z.string().optional(),
  changedFields: z.array(z.string()).optional(),
  diff: z.unknown().optional(),
  priorHash: z.string(),
  hash: z.string(),
  ip: z.string().optional(),
});

export type AuditEntryCanonical = z.infer<typeof AuditEntryCanonicalSchema>;

export const AUDITENTRY_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  hash: { sot: "capavate" },
  priorHash: { sot: "capavate" },
  ip: { sot: "capavate", privacy: "VIS-1" },
};

export function toCollectivePayload(p: AuditEntryCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, AUDITENTRY_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<AuditEntryCanonical>): Partial<AuditEntryCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(AUDITENTRY_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<AuditEntryCanonical>;
}
export function mergeWithConflicts(
  local: AuditEntryCanonical, remote: Partial<AuditEntryCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<AuditEntryCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: AUDITENTRY_POLICIES });
}
export function applyVisibilityFilter(p: AuditEntryCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, AUDITENTRY_POLICIES, audience);
}
