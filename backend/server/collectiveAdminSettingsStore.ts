/**
 * v25.47 APD-031 (HIGH-3) — Collective admin settings (DB-backed, no in-memory
 * canonical state).
 *
 * Persists the Collective surface's admin-tunable settings onto the additive
 * `collective_admin_settings` table (migration 0071 + connection.ts bootstrap).
 * The whole settings object lives in one row (key='collective', value_json) so
 * the table's key/value_json shape backs a typed object without per-field rows.
 *
 * A documented PUBLIC subset (getPublicCollectiveSettings) is exposed unauthed
 * so the marketing/landing surfaces can render live copy without leaking the
 * admin-only fields.
 */
import { rawDb } from "./db/connection";

const SETTINGS_KEY = "collective";

export interface CollectiveSettings {
  /** Whether the Collective is accepting new founder applications. */
  applicationsOpen: boolean;
  /** Headline shown on the public membership/landing surface. */
  membershipHeadline: string;
  /** Short public blurb under the headline. */
  membershipBlurb: string;
  /** Public-facing support contact. */
  supportEmail: string;
  /** Admin-only internal note (never exposed publicly). */
  internalNote: string;
}

export const DEFAULT_COLLECTIVE_SETTINGS: CollectiveSettings = {
  applicationsOpen: true,
  membershipHeadline: "Join the Capavate Collective",
  membershipBlurb: "A curated network of founders and private investors.",
  supportEmail: "scale@capavate.com",
  internalNote: "",
};

/** Fields safe to expose without authentication. */
const PUBLIC_FIELDS = [
  "applicationsOpen",
  "membershipHeadline",
  "membershipBlurb",
  "supportEmail",
] as const;

export type PublicCollectiveSettings = Pick<CollectiveSettings, (typeof PUBLIC_FIELDS)[number]>;

function coerce(raw: unknown): CollectiveSettings {
  const obj = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  return {
    applicationsOpen:
      typeof obj.applicationsOpen === "boolean"
        ? obj.applicationsOpen
        : DEFAULT_COLLECTIVE_SETTINGS.applicationsOpen,
    membershipHeadline:
      typeof obj.membershipHeadline === "string"
        ? obj.membershipHeadline
        : DEFAULT_COLLECTIVE_SETTINGS.membershipHeadline,
    membershipBlurb:
      typeof obj.membershipBlurb === "string"
        ? obj.membershipBlurb
        : DEFAULT_COLLECTIVE_SETTINGS.membershipBlurb,
    supportEmail:
      typeof obj.supportEmail === "string"
        ? obj.supportEmail
        : DEFAULT_COLLECTIVE_SETTINGS.supportEmail,
    internalNote:
      typeof obj.internalNote === "string"
        ? obj.internalNote
        : DEFAULT_COLLECTIVE_SETTINGS.internalNote,
  };
}

export function getCollectiveSettings(): CollectiveSettings {
  try {
    const row = rawDb()
      .prepare(`SELECT value_json FROM collective_admin_settings WHERE key = ?`)
      .get(SETTINGS_KEY) as { value_json: string | null } | undefined;
    if (row && row.value_json) {
      return coerce(JSON.parse(row.value_json));
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_COLLECTIVE_SETTINGS };
}

export function getPublicCollectiveSettings(): PublicCollectiveSettings {
  const full = getCollectiveSettings();
  return {
    applicationsOpen: full.applicationsOpen,
    membershipHeadline: full.membershipHeadline,
    membershipBlurb: full.membershipBlurb,
    supportEmail: full.supportEmail,
  };
}

/** Merge a partial patch over the current settings and persist. */
export function updateCollectiveSettings(patch: Partial<CollectiveSettings>): CollectiveSettings {
  const current = getCollectiveSettings();
  const next = coerce({ ...current, ...patch });
  rawDb()
    .prepare(
      `INSERT INTO collective_admin_settings (key, value_json, updated_at)
         VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(SETTINGS_KEY, JSON.stringify(next), new Date().toISOString());
  return next;
}
