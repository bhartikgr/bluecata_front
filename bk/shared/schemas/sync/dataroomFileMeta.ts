import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 15 — Dataroom File Metadata (NOT bytes).
 * SOT: Capavate. VIS-6: file bytes never replicated.
 */
export const DataroomFileMetaCanonicalSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  folderId: z.string(),
  fileName: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().optional(),
  sha256: z.string(),
  uploadedAt: z.string(),
  uploadedBy: z.string(),
  version: z.number().optional(),
  watermarkPolicy: z.string().optional(),
  fileBytesUrl: z.string().optional(),  // VIS-6 — never crosses bridge
});

export type DataroomFileMetaCanonical = z.infer<typeof DataroomFileMetaCanonicalSchema>;

export const DATAROOMFILEMETA_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  sha256: { sot: "capavate" },
  fileBytesUrl: { sot: "capavate", privacy: "VIS-6" },
};

export function toCollectivePayload(p: DataroomFileMetaCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, DATAROOMFILEMETA_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<DataroomFileMetaCanonical>): Partial<DataroomFileMetaCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(DATAROOMFILEMETA_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<DataroomFileMetaCanonical>;
}
export function mergeWithConflicts(
  local: DataroomFileMetaCanonical, remote: Partial<DataroomFileMetaCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<DataroomFileMetaCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: DATAROOMFILEMETA_POLICIES });
}
export function applyVisibilityFilter(p: DataroomFileMetaCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, DATAROOMFILEMETA_POLICIES, audience);
}
