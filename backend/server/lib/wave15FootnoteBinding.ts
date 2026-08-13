/**
 * server/lib/wave15FootnoteBinding.ts
 *
 * WAVE 15 — M-1d. Bind `renderFootnotes` (packages/math-fns/src/ilpa.ts:620) to
 * the ACTUAL durable configuration in `wave9_reporting_config`.
 *
 * WHY THIS FILE EXISTS AT ALL. `renderFootnotes` was complete and tested
 * (packages/math-fns/test/ilpa.test.ts:412) with ZERO callers tree-wide. An
 * engine with no route is not shipped, so M-1d is a WIRING item — no new
 * footnote text is invented here.
 *
 * THE DEFECT THIS FILE HAD TO SOLVE (found at source, not cited):
 * migration 0170 seeded five `footnote.*` keys whose VALUES ARE OUT OF DOMAIN
 * for the renderer's `FootnoteConfig`:
 *
 *   - `footnote.recallable_treatment = "excluded_from_paid_in"`, but the
 *     renderer's field accepts only `"restores_unfunded" | "permanent"`.
 *     0170's own description states the equivalence: "recallable distributions
 *     do NOT reduce paid-in capital", which is exactly the renderer's
 *     `"permanent"` branch. The translation is therefore DOCUMENTED, not
 *     guessed — and it lives in ONE table below.
 *   - `footnote.subline_treatment = "disclosed_separately"` describes how the
 *     facility is REPORTED. The renderer needs to know whether one was USED.
 *     Those are different facts, and usage CANNOT be derived: there is no
 *     subscription-line member in the 14-entry `ILPA_TRANSACTION_TYPES`. A new
 *     admin-declared boolean key `footnote.subline_used` (migration 0171)
 *     supplies the fact; `subline_treatment` is still read and echoed so the
 *     admin's reporting choice is not silently dropped.
 *
 * DELIBERATELY NOT DONE: the seeded rows are NOT mutated. They are admin-owned
 * and editable through `PUT /api/admin/reporting/config/:key`; rewriting an
 * admin's row from a migration to suit a renderer's enum is exactly the
 * "silently discard the incompatible definition" failure this wave is guarding
 * against. Unknown values THROW.
 *
 * FALSIFICATION (proved in server/__tests__/wave15_reporting_bindings.test.ts):
 *   - an unmapped `recallable_treatment` value throws
 *     FOOTNOTE_CONFIG_OUT_OF_DOMAIN and renders nothing;
 *   - with `footnote.require_valuation_date = true` and a valuation event that
 *     carries no date, the binding THROWS instead of printing an undated
 *     footnote (0170's description promises exactly this and nothing
 *     implemented it);
 *   - with the flag false the same input renders the "no valuation event"
 *     footnote rather than throwing — so the flag is proved to be READ.
 */
import {
  renderFootnotes,
  type Footnote,
  type FootnoteConfig,
} from "@capavate/math-fns";
import { getW9Config, latestValuationEvent } from "../wave9ReportingStore";
import { rawDb } from "../db/connection";
import { log } from "./logger";

export class FootnoteConfigError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FootnoteConfigError";
  }
}

/**
 * The ONE translation table from admin-facing config vocabulary to the
 * renderer's field domain. Additive by design: a new admin value is a
 * one-line addition HERE, and until it is added it throws rather than
 * defaulting to a treatment nobody chose.
 */
export const RECALLABLE_TREATMENT_MAP: Readonly<
  Record<string, FootnoteConfig["recallableTreatment"]>
> = Object.freeze({
  // Renderer-native values, accepted verbatim.
  restores_unfunded: "restores_unfunded",
  permanent: "permanent",
  // 0170's vocabulary. Its own description defines the equivalence:
  // "recallable distributions do NOT reduce paid-in capital for DPI/TVPI"
  // == the renderer's `permanent` branch.
  excluded_from_paid_in: "permanent",
  // The complementary ILPA treatment, named in the renderer's own text.
  included_in_paid_in: "restores_unfunded",
});

/** Subline REPORTING treatments an admin may declare. Echoed, not rendered. */
export const SUBLINE_TREATMENTS: readonly string[] = Object.freeze([
  "disclosed_separately",
  "netted_in_irr",
  "not_applicable",
]);

export interface FootnoteBindingResult {
  footnotes: Footnote[];
  config: FootnoteConfig;
  /** Config keys actually read, with their raw stored values — auditability. */
  configRead: Record<string, unknown>;
  /** The admin's subline REPORTING choice. Not a renderer input; surfaced. */
  sublineTreatment: string;
  valuationDateRequired: boolean;
}

function readBool(key: string): boolean {
  const v = getW9Config<unknown>(key);
  if (typeof v !== "boolean") {
    throw new FootnoteConfigError(
      "FOOTNOTE_CONFIG_OUT_OF_DOMAIN",
      `FOOTNOTE_CONFIG_OUT_OF_DOMAIN: ${key} must be a boolean, got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

function readString(key: string): string {
  const v = getW9Config<unknown>(key);
  if (typeof v !== "string" || v.trim() === "") {
    throw new FootnoteConfigError(
      "FOOTNOTE_CONFIG_OUT_OF_DOMAIN",
      `FOOTNOTE_CONFIG_OUT_OF_DOMAIN: ${key} must be a non-empty string, got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

/**
 * GP commitment in minor units, from the REAL source: `spv_carry_terms`
 * (migration 0159:201, column `gp_commitment_minor`). Wave 14's footnote seeds
 * had no source for it at all, so the renderer's optional
 * `(GP commitment recorded in ...)` clause could never have printed.
 *
 * Returns null when there is no terms row — the renderer then omits the clause
 * rather than printing a zero it did not measure.
 */
export function readGpCommitmentMinor(vehicleKind: string, vehicleId: string): number | null {
  if (vehicleKind !== "spv") return null;
  try {
    const row = rawDb()
      .prepare(`SELECT gp_commitment_minor FROM spv_carry_terms WHERE spv_id = ?`)
      .get(vehicleId) as { gp_commitment_minor?: number } | undefined;
    if (!row || row.gp_commitment_minor === undefined || row.gp_commitment_minor === null) return null;
    const n = Number(row.gp_commitment_minor);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    return n === 0 ? null : n;
  } catch (err) {
    // Missing table (pre-0159 install) or a non-sqlite driver. Absence of a
    // GP commitment is reported as absence; it is never faked as 0.
    log.warn(`[w15-footnote] gp commitment read failed for ${vehicleId}: ${String(err)}`);
    return null;
  }
}

/**
 * Resolve + render the footnote block for one vehicle at one as-of date.
 *
 * @throws {FootnoteConfigError} FOOTNOTE_CONFIG_OUT_OF_DOMAIN — a stored config
 *   value is not in the renderer's domain and no documented translation exists.
 * @throws {FootnoteConfigError} FOOTNOTE_VALUATION_DATE_REQUIRED — a valuation
 *   was used but carries no date while `footnote.require_valuation_date` is on.
 */
export function buildFootnotes(args: {
  vehicleKind: string;
  vehicleId: string;
  asOfDate: string;
  currency?: string;
}): FootnoteBindingResult {
  const rawRecallable = readString("footnote.recallable_treatment");
  const recallableTreatment = RECALLABLE_TREATMENT_MAP[rawRecallable];
  if (!recallableTreatment) {
    throw new FootnoteConfigError(
      "FOOTNOTE_CONFIG_OUT_OF_DOMAIN",
      `FOOTNOTE_CONFIG_OUT_OF_DOMAIN: footnote.recallable_treatment=${JSON.stringify(rawRecallable)} ` +
        `is not one of ${Object.keys(RECALLABLE_TREATMENT_MAP).join(", ")}. ` +
        `Set it via PUT /api/admin/reporting/config/footnote.recallable_treatment.`,
    );
  }

  const sublineTreatment = readString("footnote.subline_treatment");
  if (!SUBLINE_TREATMENTS.includes(sublineTreatment)) {
    throw new FootnoteConfigError(
      "FOOTNOTE_CONFIG_OUT_OF_DOMAIN",
      `FOOTNOTE_CONFIG_OUT_OF_DOMAIN: footnote.subline_treatment=${JSON.stringify(sublineTreatment)} ` +
        `is not one of ${SUBLINE_TREATMENTS.join(", ")}.`,
    );
  }
  // USAGE is a separate, admin-declared fact (0171). `not_applicable` as a
  // reporting treatment does not by itself prove non-usage, so the boolean is
  // always the authority.
  const sublineUsed = readBool("footnote.subline_used");

  const gpCapitalIncluded = readBool("footnote.gp_capital_included");
  const requireValuationDate = readBool("footnote.require_valuation_date");
  const valuationSourceLabel = readString("footnote.valuation_source_label");

  const ev = latestValuationEvent(args.vehicleKind, args.vehicleId);
  const valuationDate = ev && typeof ev.valuationDate === "string" && ev.valuationDate.trim() !== ""
    ? ev.valuationDate
    : null;

  /* THE REJECTION 0170 PROMISED AND NOBODY IMPLEMENTED. A valuation exists and
   * is being relied on, but it carries no date. Printing the footnote undated
   * is the dishonest outcome; the binding refuses. */
  if (ev && !valuationDate && requireValuationDate) {
    throw new FootnoteConfigError(
      "FOOTNOTE_VALUATION_DATE_REQUIRED",
      `FOOTNOTE_VALUATION_DATE_REQUIRED: valuation_event ${ev.id} for ${args.vehicleKind}/${args.vehicleId} ` +
        `has no valuation_date and footnote.require_valuation_date is true.`,
    );
  }

  const currency = args.currency ?? ev?.currency ?? "USD";
  const config: FootnoteConfig = {
    recallableTreatment,
    gpCapitalIncluded,
    gpCommitmentMinor: gpCapitalIncluded
      ? readGpCommitmentMinor(args.vehicleKind, args.vehicleId)
      : null,
    sublineUsed,
    // The label is the ADMIN's name for the source; `ev.source` is the row's
    // own provenance. When they differ, both are informative, so the label
    // qualifies the row rather than replacing it.
    valuationSource: ev ? (ev.source ? `${valuationSourceLabel} (${ev.source})` : valuationSourceLabel) : null,
    valuationDate,
    valuationMethod: ev?.method ?? null,
    currency,
    asOfDate: args.asOfDate,
  };

  return {
    footnotes: renderFootnotes(config),
    config,
    configRead: {
      "footnote.recallable_treatment": rawRecallable,
      "footnote.subline_treatment": sublineTreatment,
      "footnote.subline_used": sublineUsed,
      "footnote.gp_capital_included": gpCapitalIncluded,
      "footnote.require_valuation_date": requireValuationDate,
      "footnote.valuation_source_label": valuationSourceLabel,
    },
    sublineTreatment,
    valuationDateRequired: requireValuationDate,
  };
}
