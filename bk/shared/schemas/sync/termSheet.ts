import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 13 — Term Sheet Draft + Signatures (SES).
 * SOT: Capavate. Trigger: term_sheet.signed (audit_log.appended).
 */
export const TermSheetCanonicalSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  companyId: z.string(),
  templateId: z.string(),
  region: z.string(),
  status: z.enum(["draft", "sent", "viewed", "signed", "rejected", "expired"]),
  partyEmails: z.array(z.string()).optional(),  // VIS-1
  documentHash: z.string(),
  signedAt: z.string().optional(),
  signatureProviderRefs: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});

export type TermSheetCanonical = z.infer<typeof TermSheetCanonicalSchema>;

export const TERMSHEET_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "capavate" },
  partyEmails: { sot: "capavate", privacy: "VIS-1" },
  documentHash: { sot: "capavate" },
  signedAt: { sot: "capavate" },
};

export function toCollectivePayload(p: TermSheetCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, TERMSHEET_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<TermSheetCanonical>): Partial<TermSheetCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(TERMSHEET_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<TermSheetCanonical>;
}
export function mergeWithConflicts(
  local: TermSheetCanonical, remote: Partial<TermSheetCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<TermSheetCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: TERMSHEET_POLICIES });
}
export function applyVisibilityFilter(p: TermSheetCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, TERMSHEET_POLICIES, audience);
}
