import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 20 — Posts (Company Posts Feed).
 * SOT: shared. Bidirectional real-time.
 */
export const PostCanonicalSchema = z.object({
  id: z.string(),
  authorUserId: z.string(),
  companyId: z.string().optional(),
  body: z.string(),
  attachments: z.array(z.string()).optional(),
  visibility: z.enum(["public", "co_members", "cap_table", "private"]).optional(),
  reactionCount: z.number().optional(),
  commentCount: z.number().optional(),
  pinned: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type PostCanonical = z.infer<typeof PostCanonicalSchema>;

export const POST_POLICIES: Record<string, FieldPolicy> = {
  id: { sot: "shared" },
  body: { sot: "shared" },
  reactionCount: { sot: "shared" },
  commentCount: { sot: "shared" },
};

export function toCollectivePayload(p: PostCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, POST_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<PostCanonical>): Partial<PostCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(POST_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<PostCanonical>;
}
export function mergeWithConflicts(
  local: PostCanonical, remote: Partial<PostCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<PostCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: POST_POLICIES });
}
export function applyVisibilityFilter(p: PostCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, POST_POLICIES, audience);
}
