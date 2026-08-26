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

/* ---------------------------------------------------------------------------
   WAVE 144 · ITEM 5 — AN EXPLICIT CONFIRMATION FOR THE ONE RULE THAT EXPOSES
   ANOTHER ORGANISATION'S PEOPLE.                       R108.1 items 2 and 3

   `setAudienceRuleEnabled` is the ONLY write path to `comms_audience_rules`, and
   before this wave every rule was one identical call away from live. One of the
   six is not like the others: `partner_engaged_company_people` opens the ACTIVE
   members of a partner's CLIENT companies — people at another organisation — and
   R108.1 holds it off pending the payload scoping done in ITEM 4 of this wave.

   R108.1 item 3 is explicit that the owner must be able to operate BOTH partner
   rules without a developer, so this is NOT a block. It is a stated warning plus
   a deliberate second act: the caller must pass `EXPOSURE_CONFIRMATION_TOKEN`,
   which cannot be produced by a stray `true`, a replayed request, or a
   mis-click. Turning the rule OFF never requires it — a safety catch that makes
   it harder to CLOSE an exposure would be backwards.

   Deliberately enforced HERE and not only in the HTTP route: a confirmation that
   lives in one route is bypassed by the next caller, which is the same defect
   moved. --------------------------------------------------------------------- */

/** The rules whose exposure crosses an organisation boundary. */
export const RULES_REQUIRING_EXPLICIT_CONFIRMATION: readonly string[] = [
  "partner_engaged_company_people",
];

/** The exact string a caller must state to enable such a rule. */
export const EXPOSURE_CONFIRMATION_TOKEN = "I_UNDERSTAND_THIS_EXPOSES_CLIENT_COMPANY_PEOPLE";

/**
 * What enabling the rule actually exposes, and what is still outstanding, in the
 * server's own words so the client cannot soften it.
 */
export function exposureWarningFor(key: string): string | null {
  if (key !== "partner_engaged_company_people") return null;
  return (
    "ENABLING THIS OPENS ANOTHER ORGANISATION'S PEOPLE. A Consortium Partner will be able to " +
    "message the ACTIVE members of every client company they hold a live engagement for, and " +
    "those people will appear in the partner's recipient directory. OUTSTANDING PREREQUISITE: " +
    "R108.1 item 2 requires the messaging directory payload to be scoped to identity for " +
    "addressing before this rule is enabled. WAVE 144 item 4 removed capTables, location and " +
    "capavateAngelNetwork from that payload; the ruling itself has not been revisited, so the " +
    "owner — not this code — decides whether the prerequisite is now satisfied. Turning it off " +
    "again is immediate and needs no confirmation."
  );
}

export interface SetRuleResult {
  ok: boolean;
  error?: "unknown_rule" | "write_failed" | "confirmation_required";
  rule?: AudienceRule;
  /** Present with `confirmation_required`: what the caller must state, and why. */
  requiredConfirmation?: string;
  warning?: string;
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
  /* WAVE 144 · ITEM 5 — required ONLY to ENABLE a rule listed in
     RULES_REQUIRING_EXPLICIT_CONFIRMATION. Every other call is unchanged. */
  confirmation?: string,
): SetRuleResult {
  if (!AUDIENCE_RULE_KEYS.includes(key as AudienceRuleKey)) {
    return { ok: false, error: "unknown_rule" };
  }
  if (
    enabled &&
    RULES_REQUIRING_EXPLICIT_CONFIRMATION.includes(key) &&
    confirmation !== EXPOSURE_CONFIRMATION_TOKEN
  ) {
    return {
      ok: false,
      error: "confirmation_required",
      requiredConfirmation: EXPOSURE_CONFIRMATION_TOKEN,
      warning: exposureWarningFor(key) ?? undefined,
    };
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
