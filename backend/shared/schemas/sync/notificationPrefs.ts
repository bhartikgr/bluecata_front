import { z } from "zod";
import { type FieldPolicy, filterPayloadByPolicy, resolveConflicts, type Audience } from "./_common";

/**
 * Entity 16 — Notification + Email Preferences.
 * SOT: shared. Per-user. Trigger: prefs.updated (LWW).
 */
export const NotificationPrefsCanonicalSchema = z.object({
  userId: z.string(),
  emailEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  digestFrequency: z.enum(["realtime", "daily", "weekly", "never"]).optional(),
  channels: z.record(z.boolean()).optional(),
  unsubscribeAll: z.boolean().optional(),
  updatedAt: z.string().optional(),
});

export type NotificationPrefsCanonical = z.infer<typeof NotificationPrefsCanonicalSchema>;

export const NOTIFICATIONPREFS_POLICIES: Record<string, FieldPolicy> = {
  userId: { sot: "capavate" },
  emailEnabled: { sot: "shared" },
  pushEnabled: { sot: "shared" },
  digestFrequency: { sot: "shared" },
  channels: { sot: "shared" },
  unsubscribeAll: { sot: "shared" },
};

export function toCollectivePayload(p: NotificationPrefsCanonical, audience: Audience = "collective_public") {
  return filterPayloadByPolicy(p, NOTIFICATIONPREFS_POLICIES, audience);
}
export function fromCollectivePayload(p: Partial<NotificationPrefsCanonical>): Partial<NotificationPrefsCanonical> {
  const out: Record<string, unknown> = { ...p };
  for (const [k, pol] of Object.entries(NOTIFICATIONPREFS_POLICIES)) if (pol.derived) delete out[k];
  return out as Partial<NotificationPrefsCanonical>;
}
export function mergeWithConflicts(
  local: NotificationPrefsCanonical, remote: Partial<NotificationPrefsCanonical>,
  localUpdatedAt?: string, remoteUpdatedAt?: string,
) {
  return resolveConflicts<NotificationPrefsCanonical>({ local, remote, localUpdatedAt, remoteUpdatedAt, policies: NOTIFICATIONPREFS_POLICIES });
}
export function applyVisibilityFilter(p: NotificationPrefsCanonical, audience: Audience) {
  return filterPayloadByPolicy(p, NOTIFICATIONPREFS_POLICIES, audience);
}
