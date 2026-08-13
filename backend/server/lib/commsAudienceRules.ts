// server/lib/commsAudienceRules.ts
//
// WAVE 33 · CP-MSG-01 — the messaging audience rules, read from the DATABASE.
//
// The DM recipient picker (`GET /api/comms/users`) previously derived its
// candidate pool from four peer sources written directly into the handler. This
// module makes the same four sources DATA: rows in `comms_audience_rules` that
// the platform owner can enable or disable through the admin route with no code
// change and no deploy.
//
// TWO INVARIANTS THIS MODULE DEFENDS
//
//  1. NOTHING IS SILENTLY DROPPED. The four pre-existing sources are seeded
//     ENABLED, so a database that installs 0181 behaves identically to one
//     that has not. When the rules table cannot be read at all, the reader
//     returns the four legacy rules as ENABLED (see `readRules`) rather than
//     returning nothing: a broken read must not silently empty every user's
//     recipient picker. That is a deliberate exception to fail-closed and it is
//     argued, not accidental — the legacy behaviour IS the safe state here,
//     because these four sources were already shipping.
//
//  2. AN UNDECIDED RULE IS NOT A DISABLED RULE. The two partner rules carry
//     `requires_owner_decision = 1`. They are OFF, but the UI is told WHY they
//     are off, so a partner sees a stated "awaiting an owner decision" notice
//     instead of an empty list that looks like a bug.
//
// ZERO in-memory caching: every call re-reads SQLite, so an owner's toggle is
// observed by the very next request.
import { rawDb } from "../db/connection";
import { applyCommsDelegatedContextSchema } from "./applyCommsDelegatedContextSchema";

export interface AudienceRule {
  ruleKey: string;
  appliesToViewerRole: string;
  enabled: boolean;
  requiresOwnerDecision: boolean;
  description: string;
  recommendedDefault: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

/** The rule keys this build knows how to evaluate. */
export const AUDIENCE_RULE_KEYS = [
  "channel_participant",
  "cap_table_peer",
  "chapter_peer",
  "follow_peer",
  "partner_engaged_company_people",
  "partner_team_peers",
] as const;
export type AudienceRuleKey = (typeof AUDIENCE_RULE_KEYS)[number];

/**
 * The four sources that were already live before 0181. Used ONLY as the
 * fallback when the rules table is unreadable — see invariant 1.
 */
const LEGACY_ENABLED_KEYS: readonly string[] = [
  "channel_participant",
  "cap_table_peer",
  "chapter_peer",
  "follow_peer",
];

function legacyFallback(): AudienceRule[] {
  return LEGACY_ENABLED_KEYS.map((k) => ({
    ruleKey: k,
    appliesToViewerRole: "any",
    enabled: true,
    requiresOwnerDecision: false,
    description: "Legacy rule (rules table unavailable — pre-0181 behaviour preserved).",
    recommendedDefault: null,
    decidedAt: null,
    decidedBy: null,
  }));
}

function rowToRule(r: Record<string, unknown>): AudienceRule {
  return {
    ruleKey: String(r.rule_key ?? ""),
    appliesToViewerRole: String(r.applies_to_viewer_role ?? "any"),
    enabled: Number(r.enabled ?? 0) === 1,
    requiresOwnerDecision: Number(r.requires_owner_decision ?? 0) === 1,
    description: String(r.description ?? ""),
    recommendedDefault: r.recommended_default == null ? null : String(r.recommended_default),
    decidedAt: r.decided_at == null ? null : String(r.decided_at),
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
  };
}

/** Every rule row, healing the schema first. Never throws. */
export function readRules(): AudienceRule[] {
  try {
    const db: any = rawDb();
    applyCommsDelegatedContextSchema(db);
    const rows = db
      .prepare(
        `SELECT rule_key, applies_to_viewer_role, enabled, requires_owner_decision,
                description, recommended_default, decided_at, decided_by
           FROM comms_audience_rules
          ORDER BY rule_key ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return legacyFallback();
    return rows.map(rowToRule);
  } catch {
    return legacyFallback();
  }
}

/**
 * Is `key` switched on for a viewer in `viewerRole`?
 *
 * A rule scoped to a role applies ONLY to that role; a rule scoped to 'any'
 * applies to everyone. An unknown key is OFF — a rule the code invents but the
 * database has never heard of must not grant an audience.
 */
export function isAudienceRuleEnabled(key: string, viewerRole?: string): boolean {
  const rule = readRules().find((r) => r.ruleKey === key);
  if (!rule || !rule.enabled) return false;
  if (rule.appliesToViewerRole === "any") return true;
  return !!viewerRole && rule.appliesToViewerRole === viewerRole;
}

/** Rules the owner has not yet ruled on, for the rendered notice. */
export function pendingOwnerDecisions(viewerRole?: string): AudienceRule[] {
  return readRules().filter(
    (r) =>
      r.requiresOwnerDecision &&
      (r.appliesToViewerRole === "any" || !viewerRole || r.appliesToViewerRole === viewerRole),
  );
}

export interface SetRuleResult {
  ok: boolean;
  error?: "unknown_rule" | "write_failed";
  rule?: AudienceRule;
}

/**
 * Owner/admin decision sink. Flipping `enabled` also CLEARS
 * `requires_owner_decision` and records who decided and when: once the owner
 * has ruled, the surface must stop telling users the question is open.
 */
export function setAudienceRuleEnabled(
  key: string,
  enabled: boolean,
  decidedBy: string,
): SetRuleResult {
  if (!AUDIENCE_RULE_KEYS.includes(key as AudienceRuleKey)) {
    return { ok: false, error: "unknown_rule" };
  }
  try {
    const db: any = rawDb();
    applyCommsDelegatedContextSchema(db);
    const existing = db
      .prepare(`SELECT rule_key FROM comms_audience_rules WHERE rule_key = ?`)
      .get(key) as { rule_key?: string } | undefined;
    if (!existing?.rule_key) return { ok: false, error: "unknown_rule" };
    db.prepare(
      `UPDATE comms_audience_rules
          SET enabled = ?,
              requires_owner_decision = 0,
              decided_at = datetime('now'),
              decided_by = ?,
              updated_at = datetime('now')
        WHERE rule_key = ?`,
    ).run(enabled ? 1 : 0, decidedBy || "unknown", key);
    const rule = readRules().find((r) => r.ruleKey === key);
    return rule ? { ok: true, rule } : { ok: false, error: "write_failed" };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}
