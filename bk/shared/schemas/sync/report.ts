import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 21 — Investor Reports + Read Receipts.
 * SOT: Capavate.
 */
export const ReportCanonicalSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  title: z.string(),
  period: z.string().optional(),
  publishedAt: z.string().optional(),
  recipients: z.array(z.string()).optional(),
  readBy: z.array(z.string()).optional(),
  attachmentCount: z.number().optional(),
  documentHash: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ReportCanonical = z.infer<typeof ReportCanonicalSchema>;

export const REPORT_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  title: { sot: "capavate" },
  documentHash: { sot: "capavate" },
};

export function toCollectivePayload(p: ReportCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, REPORT_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<ReportCanonical>): Partial<ReportCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(REPORT_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<ReportCanonical>;
}
export function mergeWithConflicts(
  local: ReportCanonical, remote: Partial<ReportCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<ReportCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: REPORT_POLICIES });
}
export function applyVisibilityFilter(p: ReportCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, REPORT_POLICIES, audience);
}
