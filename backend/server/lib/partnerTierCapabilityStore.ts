// server/lib/partnerTierCapabilityStore.ts
//
// WAVE 45 (owner ruling R3, 2026-08-13) — TIER CAPABILITY AS DATA.
//
// WHY THIS EXISTS
//   Under R3 the five tiers stop being price levels and become CAPABILITY
//   levels: every partner pays the same $240/yr, and the tier governs seats,
//   live-SPV limits, commission rate and features. That only works if capability
//   is data an admin can edit. Before this wave it was a literal:
//
//     server/adminContactsStore.ts
//       export const TIER_SEAT_LIMITS: Record<PartnerTier, number> = {
//         catalyst: 2, builder: 10, amplifier: 25, nexus: 9999, founding_member: 9999,
//       };
//
//   Two defects in five lines. First, it is compiled in — the live admin console
//   displays "Team seat limit — Effective: 2 (from catalyst tier default: 2)" for
//   a value no admin can change. Second, "unlimited" is the magic number 9999,
//   so a nexus partner was really capped at 9999, and "nobody has decided yet"
//   was inexpressible.
//
// THE THREE-WAY DISTINCTION IS THE WHOLE POINT
//   Getting unlimited / zero / unset backwards locks partners out of their own
//   accounts, so this module never infers the distinction from a null:
//
//     { resolution: "configured", value: 0 }   -> ZERO. Genuinely zero seats.
//     { resolution: "unlimited" }              -> no ceiling. value is null
//                                                 because a number would lie.
//     { resolution: "not_configured" }         -> nobody decided. R6: report it
//                                                 as unknown, NEVER as 0.
//
//   `value` is `number | null` and callers MUST branch on `resolution`. A caller
//   that does `limit ?? 0` would turn "unlimited" into "forbidden", which is why
//   `isWithinLimit()` is provided and should be used instead of raw comparison.
//
// PRECEDENCE (mirrors the price model: tier base + optional per-partner override)
//   1. per-partner override — contacts.arrangement_json -> { "seatLimit": n }
//   2. tier capability row  — partner_tier_capability
//   Seat limit is an ARRANGEMENT concern, not a price, so the override stays in
//   arrangement_json and NOT in fee_override_json. That split is pre-existing and
//   is preserved here deliberately.
//
// PERCENT (R16)
//   `percent_as_written` capabilities store percent AS WRITTEN: 5 means 5%. This
//   module performs NO conversion. The pre-existing
//   partner_commission_rate_config table stores FRACTIONS (0.02 = 2%) as a
//   documented internal representation R16 exempts; this module does not read,
//   write, mirror or "harmonise" it.

import { wave45Db } from "./applyWave45PricingSchema";
/* WAVE 56 (R21/R36) — the tier domain is DATA. See partnerTierDomain.ts. */
import { isTierInDomain, tierDomainSlugs } from "./partnerTierDomain";

export type CapabilityResolution = "configured" | "unlimited" | "not_configured";
export type CapabilityValueKind = "int_limit" | "bool_flag" | "percent_as_written";

export const CAPABILITY_SEAT_LIMIT = "seat_limit";
export const CAPABILITY_LIVE_SPV_LIMIT = "live_spv_limit";

/** The five authoritative tier slugs. See the report's taxonomy verdict.
 *
 *  WAVE 56 (R21/R36): these five are now the SEEDED FLOOR, not the domain. A
 *  tier the owner creates is a real tier and gets capability rows like any
 *  other; ask `isCapabilityTierSlug()` / `capabilityTierSlugs()`. Kept as a
 *  literal so an existing tier can never drop out of a list because a database
 *  read failed. */
export const CAPABILITY_TIER_SLUGS = [
  "catalyst",
  "builder",
  "amplifier",
  "nexus",
  "founding_member",
] as const;
export type CapabilityTierSlug = (typeof CAPABILITY_TIER_SLUGS)[number];

/** Every tier that may carry capability rows: the database, with the seeded five
 *  union'd in so nothing existing disappears. */
export function capabilityTierSlugs(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of tierDomainSlugs()) { if (!seen.has(s)) { seen.add(s); out.push(s); } }
  for (const s of CAPABILITY_TIER_SLUGS) { if (!seen.has(s)) { seen.add(s); out.push(s); } }
  return out;
}

/** Membership test for a capability write. Database first, seeded five as the
 *  drop-prevention floor. A slug in neither is refused. */
export function isCapabilityTierSlug(slug: unknown): boolean {
  if (typeof slug !== "string" || slug.length === 0) return false;
  if ((CAPABILITY_TIER_SLUGS as readonly string[]).includes(slug)) return true;
  return isTierInDomain(slug);
}

export class CapabilityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "CapabilityError";
    this.code = code;
  }
}

export interface ResolvedCapability {
  tierSlug: string;
  capabilityKey: string;
  valueKind: CapabilityValueKind;
  resolution: CapabilityResolution;
  /**
   * NULL whenever `resolution` is not "configured". Never coerce this to 0 —
   * see the header. Use `isWithinLimit()` for limit checks.
   */
  value: number | null;
  boolValue: boolean | null;
  /** Percent AS WRITTEN (R16). 5 means 5%. */
  percentValue: number | null;
  label: string;
  notes: string | null;
  editable: boolean;
  /** Where the effective value came from. */
  source: "tier" | "partner_override";
  /** True when NO row exists at all, as distinct from a row saying unset. */
  missingRow: boolean;
}

interface CapabilityRow {
  tier_slug: string;
  capability_key: string;
  value_kind: string;
  resolution: string;
  int_value: number | null;
  bool_value: number | null;
  percent_value: number | null;
  label: string;
  notes: string | null;
  editable: number;
}

function toResolution(v: string): CapabilityResolution {
  return v === "configured" ? "configured" : v === "unlimited" ? "unlimited" : "not_configured";
}

function toValueKind(v: string): CapabilityValueKind {
  return v === "bool_flag" ? "bool_flag" : v === "percent_as_written" ? "percent_as_written" : "int_limit";
}

function mapRow(row: CapabilityRow, source: "tier" | "partner_override"): ResolvedCapability {
  return {
    tierSlug: row.tier_slug,
    capabilityKey: row.capability_key,
    valueKind: toValueKind(row.value_kind),
    resolution: toResolution(row.resolution),
    value: row.int_value,
    boolValue: row.bool_value === null ? null : row.bool_value === 1,
    percentValue: row.percent_value,
    label: row.label,
    notes: row.notes,
    editable: row.editable === 1,
    source,
    missingRow: false,
  };
}

/**
 * Resolve one capability for a tier. When NO row exists this returns
 * `resolution: "not_configured"` with `missingRow: true` — an absent row and a
 * row that says "unset" are both unknown, but they are reported distinguishably
 * so an operator can tell "never seeded" from "deliberately left open".
 *
 * It does NOT throw for a missing row, because a capability read happens on
 * every seat check and an exception there would take down partner login. It
 * throws only for an unknown tier slug, which is a programming error.
 */
export function resolveTierCapability(
  tierSlug: string,
  capabilityKey: string,
): ResolvedCapability {
  const db = wave45Db();
  let row: CapabilityRow | undefined;
  try {
    row = db
      .prepare(
        `SELECT tier_slug, capability_key, value_kind, resolution, int_value, bool_value,
                percent_value, label, notes, editable
           FROM partner_tier_capability
          WHERE tier_slug = ? AND capability_key = ?`,
      )
      .get(tierSlug, capabilityKey) as CapabilityRow | undefined;
  } catch {
    row = undefined;
  }
  if (row) return mapRow(row, "tier");
  return {
    tierSlug,
    capabilityKey,
    valueKind: "int_limit",
    resolution: "not_configured",
    value: null,
    boolValue: null,
    percentValue: null,
    label: capabilityKey,
    notes: null,
    editable: true,
    source: "tier",
    missingRow: true,
  };
}

/** Every capability configured for a tier, for an admin surface. */
export function listTierCapabilities(tierSlug: string): ResolvedCapability[] {
  const db = wave45Db();
  try {
    const rows = db
      .prepare(
        `SELECT tier_slug, capability_key, value_kind, resolution, int_value, bool_value,
                percent_value, label, notes, editable
           FROM partner_tier_capability WHERE tier_slug = ? ORDER BY capability_key`,
      )
      .all(tierSlug) as CapabilityRow[];
    return rows.map((r) => mapRow(r, "tier"));
  } catch {
    return [];
  }
}

/** The whole capability matrix, for the admin capability editor. */
export function listAllCapabilities(): ResolvedCapability[] {
  const db = wave45Db();
  try {
    const rows = db
      .prepare(
        `SELECT tier_slug, capability_key, value_kind, resolution, int_value, bool_value,
                percent_value, label, notes, editable
           FROM partner_tier_capability ORDER BY capability_key, tier_slug`,
      )
      .all() as CapabilityRow[];
    return rows.map((r) => mapRow(r, "tier"));
  } catch {
    return [];
  }
}

/**
 * THE LIMIT CHECK. Use this instead of comparing against `value` directly.
 *
 * A raw `used < (cap.value ?? 0)` would deny everything for an unlimited tier —
 * the exact "locks partners out of their own accounts" failure the ruling warns
 * about. This function makes each of the three resolutions explicit:
 *
 *   configured   -> compare. 0 means zero, so nothing is ever allowed.
 *   unlimited    -> always within.
 *   not_configured -> NOT within, and `reason` says why. Refusing an unknown is
 *                   the fail-closed direction for a quota, and R6 forbids
 *                   inventing a 0 or an infinity to paper over it.
 */
export function isWithinLimit(
  cap: ResolvedCapability,
  used: number,
): { within: boolean; reason: string } {
  if (cap.resolution === "unlimited") {
    return { within: true, reason: `${cap.label} is unlimited for tier ${cap.tierSlug}` };
  }
  if (cap.resolution === "not_configured") {
    return {
      within: false,
      reason:
        `CAPABILITY_NOT_CONFIGURED: ${cap.label} has not been configured for tier ` +
        `${cap.tierSlug}${cap.missingRow ? " (no row exists)" : ""}. This is not zero and not ` +
        `unlimited — an admin must set it. Refusing rather than guessing a limit.`,
    };
  }
  const limit = cap.value;
  if (limit === null) {
    // Structurally prevented by the table's CHECK constraints; treated as a
    // refusal rather than trusted, because a corrupt row must not become an
    // accidental infinity.
    return {
      within: false,
      reason: `CAPABILITY_CORRUPT: ${cap.label} for tier ${cap.tierSlug} is marked configured but carries no value.`,
    };
  }
  if (used < limit) {
    return { within: true, reason: `${used} of ${limit} ${cap.label} used` };
  }
  return {
    within: false,
    reason:
      limit === 0
        ? `CAPABILITY_LIMIT_ZERO: ${cap.label} for tier ${cap.tierSlug} is zero. Zero means zero, not unlimited.`
        : `CAPABILITY_LIMIT_REACHED: ${used} of ${limit} ${cap.label} already used for tier ${cap.tierSlug}.`,
  };
}

/** Human-readable rendering. R6: an unknown is named, never shown as 0. */
export function describeCapability(cap: ResolvedCapability): string {
  if (cap.resolution === "unlimited") return "Unlimited";
  if (cap.resolution === "not_configured") return "Not configured";
  if (cap.valueKind === "bool_flag") return cap.boolValue ? "Enabled" : "Disabled";
  if (cap.valueKind === "percent_as_written") {
    // R16: as written. No multiplication, no division.
    return cap.percentValue === null ? "Not configured" : `${cap.percentValue}%`;
  }
  return cap.value === null ? "Not configured" : String(cap.value);
}

export interface SetCapabilityInput {
  tierSlug: string;
  capabilityKey: string;
  valueKind: CapabilityValueKind;
  resolution: CapabilityResolution;
  value?: number | null;
  boolValue?: boolean | null;
  /** Percent AS WRITTEN (R16). 5 means 5%. */
  percentValue?: number | null;
  label: string;
  notes?: string | null;
  updatedBy: string;
  now?: string;
}

/**
 * Admin write path. Validates the three-way distinction BEFORE hitting the DB so
 * the caller gets a named error rather than a raw CHECK-constraint failure, and
 * so an out-of-band writer cannot smuggle a value onto an "unlimited" row.
 *
 * The table's CHECK constraints enforce the same invariants underneath — this is
 * belt and braces on purpose, because a capability that silently flips meaning
 * locks people out of their accounts.
 */
export function setTierCapability(input: SetCapabilityInput): ResolvedCapability {
  const db = wave45Db();
  const now = input.now ?? new Date().toISOString();

  // WAVE 56 (R21/R36): membership comes from partner_tier_lifecycle, so an
  // owner-created tier can be given seat and SPV limits. The refusal for a slug
  // that does not exist is UNCHANGED and still names the tiers that do — and the
  // database refuses it too (trg_ptc_tier_must_exist_insert), so this check is
  // now belt-and-braces rather than the only control.
  if (!isCapabilityTierSlug(input.tierSlug)) {
    throw new CapabilityError(
      "CAPABILITY_UNKNOWN_TIER",
      `"${input.tierSlug}" is not one of this platform's tiers ` +
        `(${capabilityTierSlugs().join(", ")}). Capability rows are keyed on the tier taxonomy the ` +
        `charge path and partner_tier_current actually use.`,
    );
  }

  if (input.resolution === "configured") {
    if (input.valueKind === "int_limit") {
      if (typeof input.value !== "number" || !Number.isInteger(input.value) || input.value < 0) {
        throw new CapabilityError(
          "CAPABILITY_VALUE_REQUIRED",
          `a configured int_limit needs a non-negative integer value. To express "no ceiling" use ` +
            `resolution "unlimited"; to express "nobody has decided" use "not_configured". ` +
            `Do NOT pass a sentinel like 9999.`,
        );
      }
    } else if (input.valueKind === "bool_flag") {
      if (typeof input.boolValue !== "boolean") {
        throw new CapabilityError("CAPABILITY_VALUE_REQUIRED", `a configured bool_flag needs a boolean.`);
      }
    } else if (typeof input.percentValue !== "number" || input.percentValue < 0 || input.percentValue > 100) {
      throw new CapabilityError(
        "CAPABILITY_VALUE_REQUIRED",
        `a configured percent_as_written needs a number between 0 and 100 inclusive, AS WRITTEN ` +
          `(R16: 5 means 5%, not 0.05).`,
      );
    }
  } else {
    if (input.value != null || input.boolValue != null || input.percentValue != null) {
      throw new CapabilityError(
        "CAPABILITY_VALUE_FORBIDDEN",
        `resolution "${input.resolution}" must NOT carry a value. A leftover number on an ` +
          `unlimited or unconfigured row is exactly how "unlimited" silently becomes a ceiling.`,
      );
    }
    if (input.resolution === "unlimited" && input.valueKind !== "int_limit") {
      throw new CapabilityError(
        "CAPABILITY_UNLIMITED_NOT_APPLICABLE",
        `"unlimited" is only meaningful for an int_limit; ${input.valueKind} has no ceiling to remove.`,
      );
    }
  }

  const existing = db
    .prepare(`SELECT editable FROM partner_tier_capability WHERE tier_slug = ? AND capability_key = ?`)
    .get(input.tierSlug, input.capabilityKey) as { editable: number } | undefined;
  if (existing && existing.editable !== 1) {
    throw new CapabilityError(
      "CAPABILITY_NOT_EDITABLE",
      `${input.capabilityKey} for tier ${input.tierSlug} is marked not editable.`,
    );
  }

  const id = `ptc_${input.tierSlug}_${input.capabilityKey}`;
  db.prepare(
    `INSERT INTO partner_tier_capability
       (id, tier_slug, capability_key, value_kind, resolution, int_value, bool_value, percent_value,
        label, notes, editable, created_at, updated_at, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)
     ON CONFLICT (tier_slug, capability_key) DO UPDATE SET
       value_kind = excluded.value_kind,
       resolution = excluded.resolution,
       int_value = excluded.int_value,
       bool_value = excluded.bool_value,
       percent_value = excluded.percent_value,
       label = excluded.label,
       notes = excluded.notes,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(
    id,
    input.tierSlug,
    input.capabilityKey,
    input.valueKind,
    input.resolution,
    input.resolution === "configured" && input.valueKind === "int_limit" ? input.value : null,
    input.resolution === "configured" && input.valueKind === "bool_flag" ? (input.boolValue ? 1 : 0) : null,
    input.resolution === "configured" && input.valueKind === "percent_as_written" ? input.percentValue : null,
    input.label,
    input.notes ?? null,
    now,
    now,
    input.updatedBy,
  );

  return resolveTierCapability(input.tierSlug, input.capabilityKey);
}

/**
 * EFFECTIVE SEAT LIMIT — the DB-backed replacement for the TIER_SEAT_LIMITS
 * literal, preserving the pre-existing per-partner override precedence.
 *
 * `arrangementJson` is `contacts.arrangement_json` (string | null), passed in by
 * the caller so this module keeps no direct dependency on the contacts store —
 * the same shape the previous `resolveEffectiveSeatLimit` used.
 *
 * A per-partner override of 0 means ZERO SEATS and is honoured as such. Only an
 * absent or malformed override falls through to the tier row.
 */
export function resolveEffectiveSeatCapability(
  tierSlug: string,
  arrangementJson: string | null | undefined,
): ResolvedCapability {
  const tierCap = resolveTierCapability(tierSlug, CAPABILITY_SEAT_LIMIT);
  if (!arrangementJson) return tierCap;
  try {
    const parsed = JSON.parse(arrangementJson) as Record<string, unknown>;
    const raw = parsed?.seatLimit;
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) {
      return {
        ...tierCap,
        resolution: "configured",
        value: raw,
        boolValue: null,
        percentValue: null,
        source: "partner_override",
        missingRow: false,
      };
    }
    // An explicit JSON null is a deliberate "use the tier default", which is
    // different from a malformed value; both fall through, but only the second
    // is a data problem.
  } catch {
    // Malformed override json must never break seat resolution.
  }
  return tierCap;
}
