import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 18 — Communications: Thread + Message + Reaction + Follow.
 * SOT: shared (bidirectional real-time).
 */
export const CommsThreadCanonicalSchema = z.object({
  id: z.string(),
  channelId: z.string(),
  channelType: z.enum(["soft_circle", "cap_table", "company", "round", "direct", "broadcast"]),
  participants: z.array(z.string()),
  visibility: z.enum(["private", "shared", "public"]).optional(),
  lastMessageAt: z.string().optional(),
  messageCount: z.number().optional(),
  pinnedMessageIds: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
});

export type CommsThreadCanonical = z.infer<typeof CommsThreadCanonicalSchema>;

export const COMMSTHREAD_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "shared" },
  participants: { sot: "shared" },
  lastMessageAt: { sot: "shared" },
};

export function toCollectivePayload(p: CommsThreadCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, COMMSTHREAD_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<CommsThreadCanonical>): Partial<CommsThreadCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(COMMSTHREAD_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<CommsThreadCanonical>;
}
export function mergeWithConflicts(
  local: CommsThreadCanonical, remote: Partial<CommsThreadCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<CommsThreadCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: COMMSTHREAD_POLICIES });
}
export function applyVisibilityFilter(p: CommsThreadCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, COMMSTHREAD_POLICIES, audience);
}
