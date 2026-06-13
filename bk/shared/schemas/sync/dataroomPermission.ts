import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 14 — Dataroom Permission Grant.
 * SOT: Capavate. Per-investor × per-folder. Trigger: dataroom.permission_changed (audit).
 */
export const DataroomPermissionCanonicalSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  folderId: z.string(),
  granteeUserId: z.string(),
  permission: z.enum(["view", "download", "admin"]),
  grantedAt: z.string(),
  grantedBy: z.string(),
  expiresAt: z.string().optional(),
  watermark: z.boolean().optional(),
  revokedAt: z.string().optional(),
});

export type DataroomPermissionCanonical = z.infer<typeof DataroomPermissionCanonicalSchema>;

export const DATAROOMPERMISSION_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  permission: { sot: "capavate" },
  grantedBy: { sot: "capavate" },
};

export function toCollectivePayload(p: DataroomPermissionCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, DATAROOMPERMISSION_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<DataroomPermissionCanonical>): Partial<DataroomPermissionCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(DATAROOMPERMISSION_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<DataroomPermissionCanonical>;
}
export function mergeWithConflicts(
  local: DataroomPermissionCanonical, remote: Partial<DataroomPermissionCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<DataroomPermissionCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: DATAROOMPERMISSION_POLICIES });
}
export function applyVisibilityFilter(p: DataroomPermissionCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, DATAROOMPERMISSION_POLICIES, audience);
}
