/**
 * server/lib/percentPolicy.ts — WAVE 5, items P-0 / P-2 / P-4 / P-6 / P-7 / P-10 / P-12.
 *
 * THE ONE PLACE THAT KNOWS WHAT A PERCENT FIELD MEANS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULING (P-0, owner, 2026-08-09) — recorded durably in `percent_policy_record`
 * by migration 0153, NOT hardcoded here.
 *
 *   Percentages are STORED AS FRACTIONS. 0.2 means 20%.
 *   Display multiplies by 100 EXACTLY ONCE, in client/src/lib/percentDisplay.ts.
 *   There is no data migration and no storage change.
 *   v5's unilateral restandardisation is WITHDRAWN (row `ppr_v5_restandardisation`,
 *   status `superseded`).
 *
 * THE BANNED HEURISTIC
 *   `n > 1 ? n / 100 : n`
 *   This is a KNOWN DEFECT and this module exists partly to make it unnecessary.
 *   It cannot distinguish 1% (0.01 stored, or 1 written) from 100% (1 stored).
 *   Applied to the owner-closed VIP discount of 1 — which genuinely IS 100% off
 *   (row `ppr_vip_100`) — it silently turns a free subscription into a 1%
 *   discount. `assertNoPercentGuessHeuristic` below exists so a test can pin the
 *   ban, and `resolvePercentField` exists so no call site ever needs to guess:
 *   the per-field convention is looked up, not inferred from the magnitude.
 *
 * P-2 — VIP=1 AND YC2025=0.3 ARE CORRECT DATA, NOT DEFECTS.
 *   Both are recorded `owner_closed` in `percent_policy_record`. `isOwnerClosed()`
 *   lets any auditor/reporting path suppress them instead of re-raising them
 *   every sweep. They must never be "repaired".
 *
 * P-4 — THE FIELD DOMAINS ARE NOT ALL THE SAME. This was the live defect.
 *   server/lib/spvOfflineOps.ts:87-91 had a single `frac()` that ended in
 *   `Math.min(1, n)` and was applied to BOTH `hurdle` (:105) and `gpCatchUpPct`
 *   (:136). But the SPV wizard writes the HURDLE percent-as-written — the
 *   placeholder in client/src/pages/partner/PartnerSpvEngine.tsx is literally
 *   "e.g. 8" — so a perfectly ordinary 8% hurdle arrived as `8`, hit
 *   `Math.min(1, 8)`, and became `1`: a 100% hurdle. Every LP behind it stopped
 *   receiving carry-eligible proceeds. `gpCatchUpPct` and `carryPct`, by
 *   contrast, really are fractions in [0,1] and clamping them at 1 is correct.
 *   One clamp cannot serve both. Hence PERCENT_FIELD_DOMAIN.
 *
 * P-6 / P-7 — EXACT, NOT FLOAT.
 *   Every conversion here runs through `decimalStringToCarryScaled` from
 *   ./money — pure BigInt on CARRY_FRACTION_SCALE (1e9). A rate carrying more
 *   precision than the scale supports is REJECTED, never rounded. That is what
 *   makes `0.5000000000000001 + 0.5` reject instead of quietly summing to 1.
 *
 * P-10 — `listMigrationSupersessions()` surfaces the 0121/0122/0123
 *   superseded-in-part annotations (DEF-068) so the migration tree cannot be
 *   read as if their percent convention were still current.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE MONEY ACTUALLY FLOWS (the sinks this module serves)
 *   - server/lib/spvOfflineOps.ts:~105  hurdle          -> normaliseHurdleToFractionScaled
 *   - server/lib/spvOfflineOps.ts:~136  gpCatchUpPct    -> normaliseFractionScaled
 *   - server/spvEngineRoutes.ts:~565    distribution preview + persisted routes
 *   - server/lib/partnerFeeResolver.ts:~210 commission override (P-12 read side)
 * Each of those is a PERSISTING or RATE-DECIDING path, not a preview-only guard.
 */
import { rawDb, getDb, getDbDriver } from "../db/connection";
import {
  CARRY_FRACTION_SCALE,
  CARRY_FRACTION_DECIMALS,
  decimalStringToCarryScaled,
} from "./money";
import { ensureWave5MoneySchema } from "./applyWave5MoneySchema";

/* ── errors ─────────────────────────────────────────────────────────────── */

/** A value fell outside the DECLARED domain for its field. */
export const PERCENT_FIELD_OUT_OF_DOMAIN = "PERCENT_FIELD_OUT_OF_DOMAIN";
/** The field name handed in has no declared domain — fail closed, never guess. */
export const PERCENT_FIELD_UNKNOWN = "PERCENT_FIELD_UNKNOWN";
/** The percent policy record store is unreachable (e.g. Postgres backend). */
export const PERCENT_POLICY_UNAVAILABLE = "PERCENT_POLICY_UNAVAILABLE";
/** Someone tried to apply the banned `n > 1 ? n/100 : n` magnitude heuristic. */
export const PERCENT_GUESS_HEURISTIC_BANNED = "PERCENT_GUESS_HEURISTIC_BANNED";

/* ── field domains (P-4) ────────────────────────────────────────────────── */

export type PercentInputForm = "percent_as_written" | "fraction";

export interface PercentFieldDomain {
  /** Canonical field identifier, matching the `ruling_key` in the DB where one exists. */
  field: string;
  /** How the WRITER supplies the value. */
  inputForm: PercentInputForm;
  /** Inclusive minimum, expressed in the INPUT form. */
  min: number;
  /** Inclusive maximum, expressed in the INPUT form. */
  max: number;
  /** Why this field differs from its neighbours — quoted in the thrown error. */
  rationale: string;
}

/**
 * The per-field domain table.
 *
 * WHY THIS IS A CODE CONSTANT AND NOT A DB ROW: it is a description of what an
 * EXISTING WIRE FORMAT already is — what the SPV wizard on the client is
 * already sending today — not a business policy anyone may tune. Making it
 * editable would let an operator "fix" a mismatch by relabelling the field
 * instead of fixing the writer, which is exactly how a 100% hurdle gets
 * normalised into existence a second time. The business-policy side of the
 * percent question (storage form, the owner-closed discount values, the
 * supersessions) IS DB-driven and lives in `percent_policy_record`, read by
 * `getPercentPolicy()` below.
 */
export const PERCENT_FIELD_DOMAIN: Readonly<Record<string, PercentFieldDomain>> =
  Object.freeze({
    "spv.hurdleRatePct": Object.freeze({
      field: "spv.hurdleRatePct",
      inputForm: "percent_as_written" as const,
      min: 0,
      max: 100,
      rationale:
        'The SPV wizard writes this percent-as-written; the field placeholder is "e.g. 8". ' +
        "Clamping it to min(1, n) turned an 8% hurdle into a 100% hurdle (P-4 / DEF).",
    }),
    "spv.gpCatchUpPct": Object.freeze({
      field: "spv.gpCatchUpPct",
      inputForm: "fraction" as const,
      min: 0,
      max: 1,
      rationale: "Stored and supplied as a fraction; 0.8 means 80% catch-up.",
    }),
    "spv.carryPct": Object.freeze({
      field: "spv.carryPct",
      inputForm: "fraction" as const,
      min: 0,
      max: 1,
      rationale:
        "Fraction, per the owner storage ruling. Deliberately NOT widened to [0,100]: " +
        "widening would reintroduce the 1%-vs-100% ambiguity the ruling exists to remove.",
    }),
    "partner.commissionOverridePct": Object.freeze({
      field: "partner.commissionOverridePct",
      inputForm: "fraction" as const,
      min: 0,
      max: 1,
      rationale:
        "Fraction. The write side already clamped to [0,1]; the READ side in " +
        "partnerFeeResolver did not, which is the path that actually decides the fee (P-12).",
    }),
    "promotion.percentOff": Object.freeze({
      field: "promotion.percentOff",
      inputForm: "fraction" as const,
      min: 0,
      max: 1,
      rationale:
        "Fraction. 1 is a legitimate 100%-off VIP grant and is OWNER-CLOSED (P-2); " +
        "it must not be rewritten to 0.01.",
    }),
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 58f · F0 — THIS ENTRY SAID "fraction, [0,1]". THAT WAS WRONG.
       ═══════════════════════════════════════════════════════════════════════
       `captable_commits.discount_pct` is PERCENT-AS-WRITTEN under owner ruling
       R30, and always has been in practice:
         · `shared/schema.ts:1425` — `discountPct: text("discount_pct"),
           // Decimal-as-string (e.g. "20" = 20%)`.
         · THE WRITER — `server/captableCommitStore.ts:575` (SACRED, unmodified)
           writes `round.discount` VERBATIM, and `rounds.extras_json` holds
           percent-as-written (live stores `"discount": 20`).
         · THE READERS — `server/routes.ts:2127` and
           `server/captableSnapshotsStore.ts:109` take `Number(discountPct)`
           into the securities shape, after which
           `roundMathEngineAdapter.toWireDiscount` divides by 100 EXACTLY ONCE
           to reach the engine wire. A stored `0.2` therefore prices as a 0.2%
           discount, not 20% — R16 forbids reading the unit off the magnitude.

       WHAT THE OLD ENTRY WAS AGREEING WITH. Migration 0153's two triggers,
       which aborted any `discount_pct` outside a fraction [0,1]. Reproduced by
       execution in Wave 58f: `'20'` -> `RAISE(ABORT,
       'DISCOUNT_PCT_OUT_OF_DOMAIN:expected fraction 0..1')`. Those triggers are
       corrected by `migrations/0190_wave58f_discount_pct_domain.sql`, so this
       entry is corrected with them — a policy record that contradicts the
       column it describes is how the contradiction survived two waves.

       THIS CHANGE IS INERT AT RUNTIME AND SAID SO HONESTLY. VERIFIED: the key
       `"captable.discountPct"` has NO caller anywhere in the tree — no
       `normalisePercentField`, no `assertStoredFraction`, no route. It fenced
       nothing before and it fences nothing now. It is documentation, and it is
       corrected so the written record and the enforced record agree.

       NOTE ON `assertStoredFraction`. That helper throws
       `PERCENT_FIELD_UNKNOWN:<field>:not_a_fraction_field` for any
       `percent_as_written` field. That is the CORRECT outcome here: this column
       is not a fraction, and a future caller must not be handed one.

       The upper bound is `< 100`, matching `DISCOUNT_STORED_PERCENT_MAX` in
       `shared/roundMathEngineAdapter.ts` — but `max` here is INCLUSIVE, so the
       exact shared bound is asserted against this file by the Wave 58f test
       rather than restated as a second rule (R21). 100% or more would price the
       shares at or below zero. */
    "captable.discountPct": Object.freeze({
      field: "captable.discountPct",
      inputForm: "percent_as_written" as const,
      min: 0,
      max: 99.999999999,
      rationale:
        "SAFE/note discount, PERCENT-AS-WRITTEN under owner ruling R30: '20' means 20%. " +
        "Fenced at the table by migration 0190's triggers, which CORRECT 0153's " +
        "fraction-domain [0,1] fence (P-11) — that fence aborted the platform's own " +
        "canonical value and would have failed the first SAFE commit carrying a discount.",
    }),
    /**
     * WAVE 10 / EN-5 — the hurdle AFTER `normaliseSpvTermsHurdle` has run.
     *
     * "spv.hurdleRatePct" above describes the value as an operator TYPES it
     * ("e.g. 8"). By the time the waterfall consumes it, it is a fraction, and
     * the two forms are not interchangeable: validating a stored 0.08 against
     * the percent-as-written domain and shifting it again yields 0.0008. They
     * therefore need separate entries rather than one entry doing double duty.
     *
     * This exists because the waterfall had no policy-backed read check at all.
     * It used a local `frac()` ending in `Math.min(1, n)` — the exact clamp
     * P-4 was raised to remove — so a hurdle of 8 arriving unnormalised was
     * silently rewritten to 1, a 100% preferred return that absorbs every
     * LP distribution. The create/update routes were fixed; the OFFLINE
     * PREVIEW route was not, and it reaches the same clamp with an
     * unnormalised body value. Rejecting here closes that second path.
     */
    "spv.hurdleRateFraction": Object.freeze({
      field: "spv.hurdleRateFraction",
      inputForm: "fraction" as const,
      min: 0,
      max: 1,
      rationale:
        "The hurdle as STORED and as consumed by the waterfall: a fraction, 0.08 = 8%. " +
        "Distinct from spv.hurdleRatePct, which is the same quantity percent-as-written " +
        "at the input boundary. A value above 1 here means an unnormalised percent " +
        "reached the engine and must be REJECTED, never clamped (P-4).",
    }),
    "founder.tractionGrowthPct": Object.freeze({
      field: "founder.tractionGrowthPct",
      inputForm: "percent_as_written" as const,
      min: 0,
      max: 100000,
      rationale:
        "Self-reported growth, percent-as-written, and legitimately >100 (a 10x quarter is 900%). " +
        "Fenced only against NEGATIVES by 0153 (P-11); it is not a fraction field.",
    }),
  });

/** Every declared field name. Used by tests to assert nothing is silently added. */
export function listPercentFields(): string[] {
  return Object.keys(PERCENT_FIELD_DOMAIN).sort();
}

function domainOf(field: string): PercentFieldDomain {
  const d = PERCENT_FIELD_DOMAIN[field];
  if (!d) {
    // FAIL CLOSED. An unknown field must not fall back to "assume fraction" —
    // that assumption is precisely the P-4 defect.
    throw new Error(`${PERCENT_FIELD_UNKNOWN}:${field}`);
  }
  return d;
}

/* ── exact conversion ───────────────────────────────────────────────────── */

const B_HUNDRED = BigInt(100);

/**
 * Shift a decimal string by a power of ten WITHOUT going through a float.
 * `"8"` shifted by -2 becomes `"8e-2"`; `"1.5e3"` shifted by -2 becomes
 * `"1.5e1"`. The result is fed to `decimalStringToCarryScaled`, which is pure
 * BigInt, so no binary rounding happens anywhere on this path.
 */
function shiftDecimalString(s: string, byPowerOfTen: number): string {
  const t = s.trim();
  const m = /^([+-]?[\d.]*)(?:[eE]([+-]?\d+))?$/.exec(t);
  if (!m) return t; // let decimalStringToCarryScaled produce the canonical error
  const mantissa = m[1];
  const exp = m[2] ? parseInt(m[2], 10) : 0;
  return `${mantissa}e${exp + byPowerOfTen}`;
}

/**
 * Normalise a value in a declared field's INPUT form to an exact integer on
 * CARRY_FRACTION_SCALE (1e9) representing the FRACTION.
 *
 *   normalisePercentField("spv.hurdleRatePct", 8)    -> 80000000n   (= 0.08)
 *   normalisePercentField("spv.gpCatchUpPct",  0.8)  -> 800000000n  (= 0.8)
 *   normalisePercentField("spv.hurdleRatePct", 8000) -> THROWS      (out of domain)
 *
 * NOT a clamp. Out-of-domain THROWS. A clamp is how an 8 became a 1.
 *
 * @throws `PERCENT_FIELD_UNKNOWN:<field>`
 * @throws `PERCENT_FIELD_OUT_OF_DOMAIN:<field>:<value>:[min,max]`
 * @throws `DISTRIBUTION_ALLOCATION_RATE_PRECISION_UNSUPPORTED:<field>` when the
 *   value carries more precision than 1e9 can represent exactly.
 */
export function normalisePercentField(field: string, raw: unknown): bigint {
  const d = domainOf(field);
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`${PERCENT_FIELD_OUT_OF_DOMAIN}:${field}:${String(raw)}:[${d.min},${d.max}]`);
  }
  if (n < d.min || n > d.max) {
    throw new Error(
      `${PERCENT_FIELD_OUT_OF_DOMAIN}:${field}:${n}:[${d.min},${d.max}] — ${d.rationale}`,
    );
  }
  const asWritten = typeof raw === "string" ? raw.trim() : String(n);
  const decimal =
    d.inputForm === "percent_as_written" ? shiftDecimalString(asWritten, -2) : asWritten;
  return decimalStringToCarryScaled(decimal, field);
}

/**
 * Same as `normalisePercentField` but returns a JS number fraction, for the
 * legacy call sites whose stored column is still a REAL. The BigInt path above
 * is what does the validating; this only divides an already-validated exact
 * integer, so the domain check and the precision rejection both still apply.
 */
export function normalisePercentFieldToFraction(field: string, raw: unknown): number {
  return Number(normalisePercentField(field, raw)) / CARRY_FRACTION_SCALE;
}

/**
 * Read side (P-12). Validate a value that is ALREADY STORED as a fraction and
 * return it, or throw. Used by resolvers that previously returned the raw column
 * unchecked — the read path is what decides the fee, so an unchecked read
 * defeats a checked write.
 */
export function assertStoredFraction(field: string, stored: unknown): number {
  const d = domainOf(field);
  if (d.inputForm !== "fraction") {
    throw new Error(`${PERCENT_FIELD_UNKNOWN}:${field}:not_a_fraction_field`);
  }
  const n = typeof stored === "string" ? Number(stored) : (stored as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n < d.min || n > d.max) {
    throw new Error(
      `${PERCENT_FIELD_OUT_OF_DOMAIN}:${field}:${String(stored)}:[${d.min},${d.max}] — ${d.rationale}`,
    );
  }
  return n;
}

/**
 * The banned heuristic, present ONLY so a test can call it and assert it throws.
 * If you found this looking for a way to normalise an ambiguous percent: there
 * isn't one. Use `normalisePercentField` with the field name, or fix the writer.
 */
export function assertNoPercentGuessHeuristic(n: number): never {
  throw new Error(
    `${PERCENT_GUESS_HEURISTIC_BANNED}:${n} — "n > 1 ? n/100 : n" cannot distinguish ` +
      `1% from 100%; the owner-closed VIP discount of 1 is genuinely 100% off. ` +
      `Use normalisePercentField(field, value) with the declared field name.`,
  );
}

/** Exact fixed-scale comparison: is `aScaled + bScaled` within `capScaled`? */
export function scaledSumWithinCap(aScaled: bigint, bScaled: bigint, capScaled: bigint): boolean {
  return aScaled + bScaled <= capScaled;
}

/** The scale everything above is expressed on. Re-exported for call-site clarity. */
export { CARRY_FRACTION_SCALE, CARRY_FRACTION_DECIMALS };

/** Convert an exact scaled fraction back to a percent STRING for display/logs. */
export function scaledFractionToPercentString(scaled: bigint, decimals = 4): string {
  const num = scaled * B_HUNDRED; // still on 1e9
  const whole = num / BigInt(CARRY_FRACTION_SCALE);
  const rem = num % BigInt(CARRY_FRACTION_SCALE);
  if (decimals <= 0) return whole.toString();
  const fracDigits = rem
    .toString()
    .padStart(CARRY_FRACTION_DECIMALS, "0")
    .slice(0, decimals)
    .replace(/0+$/, "");
  return fracDigits ? `${whole}.${fracDigits}` : whole.toString();
}

/* ── DB-driven policy records (P-0, P-2, P-10) ──────────────────────────── */

export interface PercentPolicyRecord {
  id: string;
  rulingKey: string;
  rulingStatus: "owner_closed" | "superseded" | "open";
  storageForm: "fraction" | "percent" | "bps" | "n/a";
  inputForm: "percent_as_written" | "fraction" | "n/a";
  displayRule: string;
  rulingSource: string;
  notes: string | null;
  decidedAt: string;
  decidedBy: string;
}

export interface MigrationSupersession {
  id: string;
  migrationId: string;
  supersededBy: string;
  scope: "in_part" | "in_full";
  reason: string;
  recordedAt: string;
  recordedBy: string;
}

function db() {
  if (getDbDriver() === "postgres") throw new Error(PERCENT_POLICY_UNAVAILABLE);
  getDb();
  const handle = rawDb() as any;
  ensureWave5MoneySchema(handle);
  return handle;
}

function mapPolicy(r: any): PercentPolicyRecord {
  return {
    id: String(r.id),
    rulingKey: String(r.ruling_key),
    rulingStatus: r.ruling_status,
    storageForm: r.storage_form,
    inputForm: r.input_form,
    displayRule: String(r.display_rule),
    rulingSource: String(r.ruling_source),
    notes: r.notes == null ? null : String(r.notes),
    decidedAt: String(r.decided_at),
    decidedBy: String(r.decided_by),
  };
}

/** Every recorded percent ruling, newest decision first. */
export function listPercentPolicy(): PercentPolicyRecord[] {
  return db()
    .prepare(`SELECT * FROM percent_policy_record ORDER BY decided_at DESC, id ASC`)
    .all()
    .map(mapPolicy);
}

/** One ruling by key, or null. */
export function getPercentPolicy(rulingKey: string): PercentPolicyRecord | null {
  const r = db()
    .prepare(`SELECT * FROM percent_policy_record WHERE ruling_key = ?`)
    .get(rulingKey);
  return r ? mapPolicy(r) : null;
}

/**
 * P-2. `true` when the owner has already ruled on this value and it must NOT be
 * re-raised as a defect or "repaired". Auditors and reporting sweeps call this
 * before flagging a percent value.
 */
export function isOwnerClosed(rulingKey: string): boolean {
  return getPercentPolicy(rulingKey)?.rulingStatus === "owner_closed";
}

/** P-10. The 0121/0122/0123 superseded-in-part annotations (DEF-068). */
export function listMigrationSupersessions(): MigrationSupersession[] {
  return db()
    .prepare(`SELECT * FROM migration_supersession ORDER BY migration_id ASC`)
    .all()
    .map((r: any) => ({
      id: String(r.id),
      migrationId: String(r.migration_id),
      supersededBy: String(r.superseded_by),
      scope: r.scope,
      reason: String(r.reason),
      recordedAt: String(r.recorded_at),
      recordedBy: String(r.recorded_by),
    }));
}

/* ── P-4 sink helper: SPV terms blob at the route boundary ──────────────── */

/**
 * Marker written alongside a normalised hurdle so the conversion is idempotent
 * and auditable. Without it a second PATCH would divide an already-fractional
 * 0.08 by 100 again and produce an 0.08% hurdle.
 */
export const HURDLE_NORMALISED_MARKER = "_hurdleRatePctForm";

/**
 * P-4 — normalise `terms.hurdleRatePct` from PERCENT-AS-WRITTEN to a FRACTION.
 *
 * THE DEFECT THIS CLOSES
 *   client/src/pages/partner/PartnerSpvEngine.tsx:617 labels the field
 *   "Hurdle % (optional)" with placeholder "e.g. 8", and :257 posts
 *   `Number(w.hurdleRatePct)` — so an ordinary 8% hurdle travels the wire as
 *   the number 8. It landed in the `terms` blob unconverted, and the shared
 *   `frac()` in server/lib/spvOfflineOps.ts:87-91 ended in `Math.min(1, n)`,
 *   so 8 became 1: a ONE HUNDRED PERCENT preferred return. Every LP behind that
 *   SPV had their entire distribution absorbed by the preferred-return tier.
 *
 * WHERE THIS IS CALLED — THE ACTUAL SINKS, both of which persist:
 *   1. POST  /api/partner/me/spv            -> spvEngineStore.createSpv
 *   2. PATCH /api/partner/me/spv/:spvId     -> spvEngineStore.updateSpv
 *   Those are the only two paths on which a CLIENT-SUPPLIED terms blob reaches
 *   the store. `updateSpv` is also called INTERNALLY (e.g. confirmFunds writes
 *   terms._fundsConfirmations at spvEngineStore.ts:~1799) — which is exactly
 *   why this normalisation lives at the ROUTE boundary and not inside the
 *   store: an internal caller passes a terms blob whose hurdle is ALREADY a
 *   fraction, and re-normalising it would turn 0.08 into 0.0008. The marker
 *   below makes the operation idempotent even so, belt and braces.
 *
 * REJECTS, does not clamp. `Math.min(1, n)` is the defect, not the fix.
 *
 * @returns a NEW terms object; the input is not mutated.
 * @throws `PERCENT_FIELD_OUT_OF_DOMAIN:spv.hurdleRatePct:...` for values
 *   outside 0..100 inclusive.
 */
export function normaliseSpvTermsHurdle(terms: unknown): Record<string, unknown> | unknown {
  if (terms === null || typeof terms !== "object" || Array.isArray(terms)) return terms;
  const t = { ...(terms as Record<string, unknown>) };
  const raw = t.hurdleRatePct;
  if (raw === null || raw === undefined || raw === "") return t;
  // Idempotence: an already-normalised blob is left alone.
  if (t[HURDLE_NORMALISED_MARKER] === "fraction") return t;
  const scaled = normalisePercentField("spv.hurdleRatePct", raw);
  t.hurdleRatePct = Number(scaled) / CARRY_FRACTION_SCALE;
  t[HURDLE_NORMALISED_MARKER] = "fraction";
  t._hurdleRatePctAsWritten = typeof raw === "number" ? raw : Number(raw);
  return t;
}
