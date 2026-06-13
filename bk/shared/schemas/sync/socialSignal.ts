import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 23 — Network Social Signals (Collective inbound).
 * SOT: Collective. Trigger: network.social_signals real-time.
 */
export const SocialSignalCanonicalSchema = z.object({
  subjectId: z.string(),
  subjectKind: z.enum(["user", "company"]),
  followerCount: z.number().optional(),
  mentionCount: z.number().optional(),
  networkActivity: z.string().optional(),
  followGraph: z.array(z.string()).optional(),
  computedAt: z.string().optional(),
});

export type SocialSignalCanonical = z.infer<typeof SocialSignalCanonicalSchema>;

export const SOCIALSIGNAL_POLICIES: Record<string, FieldPolicy> = {
  subjectId: { sot: "capavate" },
  followerCount: { sot: "collective" },
  mentionCount: { sot: "collective" },
  networkActivity: { sot: "collective" },
  followGraph: { sot: "collective" },
  computedAt: { sot: "collective" },
};

export function toCollectivePayload(p: SocialSignalCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, SOCIALSIGNAL_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<SocialSignalCanonical>): Partial<SocialSignalCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(SOCIALSIGNAL_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<SocialSignalCanonical>;
}
export function mergeWithConflicts(
  local: SocialSignalCanonical, remote: Partial<SocialSignalCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<SocialSignalCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: SOCIALSIGNAL_POLICIES });
}
export function applyVisibilityFilter(p: SocialSignalCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, SOCIALSIGNAL_POLICIES, audience);
}
