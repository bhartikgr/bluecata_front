/**
 * WAVE 207 · ITEM A · R195.1 — THE BASIS, NOT THE NUMBER.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * THE OWNER'S COMPLAINT, IN HIS WORDS: a vehicle fee was described everywhere as
 * being decided by the capital confirmed in the vehicle. "Change the BASIS, not
 * the NUMBER." Nothing in this file changes an amount. It changes what the
 * platform is *allowed to say and to store* about how an amount is decided.
 *
 * WHAT WAS ACTUALLY TRUE IN THE TREE, MEASURED (see build_log/wave207/W207_PREFLIGHT.md §1.4):
 *
 *   - `pickBandRow()` (server/lib/partnerFeeResolver.ts:114-135) selects WHICH ROW of a
 *     precedence level applies, by testing a size against `size_band_min/max`. It never
 *     multiplies anything. The size handed to it is confirmed capital
 *     (server/lib/spvEngineDeploymentFeeHook.ts:419-432).
 *   - The ONLY `spv_deployment` rows carrying bands are the four PLATFORM-DEFAULT rows
 *     `pfs_def_spv_band1..4` (migration 0054), all priced `amount_minor = 0` — and
 *     `resolveSpvDeploymentFee` DISCARDS a platform_default answer in favour of the flat
 *     authoritative `platform_fees` row.
 *
 *   So capital was being computed and passed on every charge while no priced capital band
 *   decided any amount. The machinery was real; the sentence describing it was the defect.
 *
 * WHY A PERMITTED SET AND NOT A DELETION. The owner was explicit: "I need to have the
 * option/flexibility to charge in the future so do not archive the functionality." The
 * banding mechanism therefore survives untouched — `size_band_min`, `size_band_max` and
 * `pickBandRow` are not edited by wave 207. What changes is that a band may only ever be
 * read against one of the dimensions NAMED BELOW, none of which is capital. The set is
 * enforced by a database CHECK constraint in migration 0217, so a capital basis is
 * unrepresentable rather than merely unused (R180.3).
 *
 * WHY THE LEGACY TOKEN EXISTS. R143.1: append, never replace a literal. Every sentence
 * that described a capital basis is still in its file, byte-identical, on a branch gated by
 * `isCapitalFeeBasisDimension()`. `LEGACY_CAPITAL_BASIS_DIMENSION` is the only token that
 * satisfies that gate, and the database refuses to store it — so the old words are
 * preserved, provable and unreachable in production at the same time.
 */

/**
 * THE PERMITTED SET, NAMED EXPLICITLY (owner requirement A4). Kept byte-identical to the
 * `CHECK (basis_dimension IN (...))` list in migration 0217; the wave-207 test asserts the
 * two lists agree, so they cannot drift apart silently.
 *
 * NOT A MEMBER, DELIBERATELY: anything that measures money — confirmed capital, target
 * raise, amount invested, transaction value, vehicle size.
 */
export const PERMITTED_FEE_BASIS_DIMENSIONS = [
  /** One amount for the vehicle. No bands. The default, and what every row is today. */
  "flat_per_vehicle",
  /** How many investors are on the register. A count of people, not of money. */
  "investor_count",
  /** How many jurisdictions the vehicle has to satisfy. */
  "jurisdiction_complexity",
  /** How many documents the vehicle's administration produces. */
  "document_count",
  /** How long the vehicle is administered for. */
  "duration",
] as const;

export type FeeBasisDimension = (typeof PERMITTED_FEE_BASIS_DIMENSIONS)[number];

/** What every existing row is, and what a new row is unless somebody says otherwise. */
export const DEFAULT_FEE_BASIS_DIMENSION: FeeBasisDimension = "flat_per_vehicle";

/** The `platform_config` key that records the basis in force platform-wide. */
export const FEE_BASIS_DIMENSION_CONFIG_KEY = "fee.vehicle.basis_dimension";

/**
 * The token the old copy was written against. NOT a permitted value: migration 0217's CHECK
 * constraint refuses it, so no row can ever declare it. It exists so the legacy sentences
 * have a condition to hang from (R143.1) and so a test can prove those sentences are still
 * there, unaltered, rather than deleted.
 */
export const LEGACY_CAPITAL_BASIS_DIMENSION = "capital_banded";

/** Tokens that would mean "this fee follows the money". All refused by the database. */
const CAPITAL_BASIS_TOKENS: readonly string[] = [
  LEGACY_CAPITAL_BASIS_DIMENSION,
  "confirmed_capital",
  "target_raise",
  "amount_invested",
  "transaction_value",
  "vehicle_size",
];

export function isPermittedFeeBasisDimension(value: unknown): value is FeeBasisDimension {
  return typeof value === "string" && (PERMITTED_FEE_BASIS_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * True only for a basis that would vary with money. Deliberately NOT "everything that is
 * not permitted": an unknown token is not evidence of a capital basis, and claiming it were
 * would be presenting a conclusion the platform has not established.
 */
export function isCapitalFeeBasisDimension(value: unknown): boolean {
  return typeof value === "string" && CAPITAL_BASIS_TOKENS.includes(value);
}

/** Plain words for each permitted dimension. No storage key ever reaches a user (R77). */
export const FEE_BASIS_DIMENSION_LABELS: Record<FeeBasisDimension, string> = {
  flat_per_vehicle: "a flat amount for the vehicle",
  investor_count: "the number of investors",
  jurisdiction_complexity: "the jurisdictions involved",
  document_count: "the number of documents",
  duration: "how long it is administered",
};

/**
 * THE TWO REPLACEMENT SENTENCES.
 *
 * The WHEN sentence is prescribed verbatim by the wave-207 specification (207.2(c)). Both
 * are held under the 240-character `looksHuman` ceiling
 * (`shared/refusalHeadlineGate.ts:LOOKS_HUMAN_MAX_LENGTH`); the wave-207 test measures them
 * rather than trusting this comment.
 */
/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 339 · THE FEE SCHEDULE SENTENCE WAS FALSE. IT NAMED ONE TRIGGER AND THE
 * CODE HAS TWO. CORRECTED IN PLACE, KEEPING ONE SOURCE.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IT SAID. "Charged once per vehicle, WHEN THIS VEHICLE IS MARKED
 * DEPLOYED." A partner reading that would expect no charge until the day they
 * deploy.
 *
 * WHAT THE CODE DOES — counted, not assumed. `chargeEngineSpvDeploymentFee` is
 * invoked from exactly THREE places outside tests:
 *   1. `server/spvEngineStore.ts:3232` — `markDeployed`. The one the old
 *      sentence named.
 *   2. `server/spvEngineStore.ts:1036` — `updateSpv`, guarded by
 *      `isPushToLiveTransition(prevStatus, s.status)`. That predicate is
 *      `!isLiveSpvStatus(prev) && isLiveSpvStatus(next)`, and
 *      `NON_LIVE_SPV_STATUSES` is `["draft", "wound_down"]`. So it fires the
 *      moment a vehicle leaves DRAFT for `open`, `closed`, `deployed` OR
 *      `distributing` — that is, WHEN THE VEHICLE IS FIRST PUBLISHED, which is
 *      normally long before anything is deployed.
 *   3. `server/lib/spvEngineDeploymentFeeHook.ts:340` —
 *      `retryEngineSpvDeploymentFee`, an ADMIN retry of a charge that was
 *      already attempted and left `pending`. That is not a third occasion on
 *      which a partner is billed; it completes the first. It is therefore not
 *      named in a partner-facing sentence.
 *
 * SO A PARTNER WAS BILLED AT PUBLICATION AND TOLD THEY WOULD BE BILLED AT
 * DEPLOYMENT. The new sentence names both occasions and says which one counts.
 *
 * "NEVER CHARGED TWICE" IS NOT A PROMISE THIS SENTENCE INVENTS. The hook
 * documents three independent idempotency layers (a `charged` billing row, an
 * existing `partner_billing_entries` row for the SPV, and a non-NULL
 * `spv.deployment_fee_minor` stamp), so a vehicle that is published and later
 * deployed is billed once in total.
 *
 * NOTHING ABOUT THE TRIGGER, THE AMOUNT OR THE BASIS IS CHANGED — R133.2 rules
 * the trigger unchanged and this wave obeys that. The defect was the WORDS.
 *
 * WHY THE CONSTANT IS EDITED RATHER THAN JOINED BY A SIBLING. Wave 207 added a
 * sibling record to avoid disturbing sentences that were merely incomplete.
 * This one is FALSE, and a false sentence that stays exported can still be
 * rendered somewhere. One source, corrected, cannot drift. The partner Fee
 * Schedule and the admin fee screens both read this constant, so both become
 * true together. The wave-207 DOM tests compare the RENDERED text to this
 * constant rather than to a literal, so they follow the correction.
 *
 * The 240-character `looksHuman` ceiling still applies and is still measured by
 * the wave-207 test rather than trusted from this comment. */
export const W207_VEHICLE_FEE_WHEN =
  "Charged once per vehicle, at whichever comes first: it leaves draft, or it is marked Deployed. Never charged twice. The amount does not vary with the capital confirmed, with whether any investment is made, or with the amount raised.";

export const W207_VEHICLE_FEE_BASIS =
  "A flat amount for the vehicle. Any future banding may only count investors, jurisdictions, documents or duration — never capital, so the amount cannot follow the size of the raise.";

/** For the admin screens, which are allowed more detail than a partner surface. */
export const W207_PERMITTED_DIMENSIONS_SENTENCE =
  "Bands may be read against the number of investors, the jurisdictions involved, the number of documents or how long the vehicle is administered. Capital is not a permitted basis and the database refuses it.";

/** Names the band mechanism without naming money. Replaces "stepped size bands". */
export const W207_BANDING_KEPT_SENTENCE =
  "Vehicle fees may use stepped bands, and those bands never read capital.";
