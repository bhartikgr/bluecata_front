/**
 * server/lib/spvDeploymentFeeSource.ts
 *
 * WAVE 46 — OWNER RULING **R22**: THE SPV DEPLOYMENT FEE GETS **ONE SOURCE**.
 *
 * ── THE DEFECT THIS MODULE EXISTS TO CLOSE ─────────────────────────────────
 *
 * The owner asked: *"What is the difference between admin console and billing
 * code?"* — and the answer was a defect, not a distinction:
 *
 *   • **The console** writes `platform_fees`, key `consortium.spv_deployment_fee`
 *     (wrapped by `server/consortiumFeesStore.ts`, edited on the consolidated
 *     admin fee screen under the hint "Flat fee charged when an SPV is
 *     deployed"). The live row holds the owner's **$240.00**.
 *   • **The billing code** (`chargeSpvDeploymentFee`) resolved the amount from
 *     `partner_fee_schedules` via `resolvePartnerFee(partnerId, tier,
 *     "spv_deployment", { sizeMinor })` — a DIFFERENT table, banded by tier and
 *     SPV size.
 *   • Nobody joined them. The number the owner types was **never read at charge
 *     time.**
 *
 * WORSE, AND MEASURED RATHER THAN ASSUMED: the only `spv_deployment` rows that
 * exist on a fresh or live deploy are the four **$0 platform-default bands**
 * seeded by `migrations/0054_v25_33_partner_payment_model.sql:149` and mirrored
 * in the `connection.ts` bootstrap (`pfs_def_spv_band1..4`, `tier IS NULL`,
 * `amount_minor = 0`). So the charge path did not merely read the wrong table —
 * with no per-tier band configured it resolved **$0.00** and billed nothing,
 * while the console displayed $240. That is precisely the `$0`-instead-of-a-
 * refusal antipattern **R6** forbids, sitting on a money path.
 *
 * ── THE RULING, IMPLEMENTED ────────────────────────────────────────────────
 *
 * R22: *"the value the owner edits is authoritative. The charge path must read
 * the same row the console writes. The banded `partner_fee_schedules` mechanism
 * is retained, not deleted (R3 requires the tiered machinery to survive so
 * tiered pricing can be reinstated), but it no longer decides this fee."*
 *
 * So the precedence for `spv_deployment`, and ONLY for `spv_deployment`, is:
 *
 *   1. **`partner_override`**  — `contacts.fee_override_json`. A deliberate,
 *      per-partner, admin-authored amount. RETAINED and still wins: R17's
 *      grandfathering is expressed this way, and an explicit override is a
 *      decision, not a second source.
 *   2. **`tier_default`**      — `partner_fee_schedules WHERE tier = <tier>`. A
 *      deliberate per-tier / per-size band an admin created on the Partner Fee
 *      Schedules screen. RETAINED: this is the machinery R3 requires to survive
 *      so tiered pricing can be reinstated **as configuration**.
 *   3. **`platform_fee_authoritative`** — `platform_fees` key
 *      `consortium.spv_deployment_fee`. **THE ROW THE CONSOLE WRITES.** This
 *      REPLACES the old level 3.
 *
 * WHAT WAS **DEMOTED OUT OF THE DECISION**, and why that is the whole fix: the
 * old level 3 was `partner_fee_schedules WHERE tier IS NULL` — the seeded $0
 * bands above. Those rows are **left byte-untouched** (R3: retain, never
 * delete; and they still serve every other `fee_kind`), but they no longer
 * decide this fee. Nothing was deleted; one read was re-pointed.
 *
 * NO LEVEL 4. If the authoritative row is absent or has never been configured,
 * this module **REFUSES** with `SpvDeploymentFeeUnconfiguredError` (R6). It does
 * not fall back to $5,000 (the historical seed), it does not fall back to $0,
 * and it contains no money literal of its own — `grep -nE '[0-9]{3,}' ` on this
 * file returns only ruling numbers, never an amount.
 *
 * MONEY. Integer minor units end to end. No `/100`, no `*100`, no float. A
 * currency is carried alongside every amount and never assumed, so a JPY
 * (exponent 0) fee is the same integer as a USD (exponent 2) one and is never
 * divided by anything.
 *
 * SACRED. Reads `platform_fees` through the caller's raw handle when one is
 * supplied so the read participates in the caller's transaction, exactly as the
 * previous resolution did. `paymentGatewayAdapter.ts`, `connection.ts` and every
 * other sacred file are read-only to this wave and untouched.
 */
import { rawDb } from "../db/connection";
import { resolvePartnerFee, FeeResolutionError, type ResolvedFee } from "./partnerFeeResolver";
import type { PartnerTier } from "../adminContactsStoreShim";

/**
 * THE ONE KEY. Declared here as the single textual identity of this fee so that
 * "which row is authoritative" is answerable by grep. `consortiumFeesStore.ts`
 * exports the same constant for the admin write path; both name the same row.
 */
export const AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY = "consortium.spv_deployment_fee";

/** Provenance recorded on the billing entry when the authoritative row decided. */
export const AUTHORITATIVE_COMPUTED_VIA = "platform_fee_authoritative";

/**
 * The refusal (R6). Thrown when a deployment fee is ASKED FOR and the
 * authoritative row cannot answer. It names the key an operator has to fill in,
 * because an operator handed "$0" learns nothing and an operator handed a
 * plausible-looking $5,000 learns something false.
 */
export class SpvDeploymentFeeUnconfiguredError extends Error {
  readonly code = "SPV_DEPLOYMENT_FEE_UNCONFIGURED";
  readonly key = AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY;
  readonly detail: string;
  constructor(detail: string) {
    super(
      `SPV_DEPLOYMENT_FEE_UNCONFIGURED: the authoritative SPV deployment fee ` +
        `(platform_fees key "${AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY}") ${detail}. ` +
        `This build has no compiled-in SPV deployment fee to fall back on and will not ` +
        `charge $0 in place of a price. Set the amount in Admin → Fees → Consortium ` +
        `Partners → "SPV deployment fee".`,
    );
    this.name = "SpvDeploymentFeeUnconfiguredError";
    this.detail = detail;
  }
}

export interface AuthoritativeSpvDeploymentFee {
  amountMinor: number;
  currency: string;
  updatedAt: string;
  updatedByUserId: string | null;
}

interface PlatformFeeRow {
  key: string;
  amount_minor: number | null;
  currency: string | null;
  updated_at: string | null;
  updated_by_user_id: string | null;
  deleted_at?: string | null;
}

/**
 * Raw read of the authoritative row. DELIBERATELY NOT `platformFeesStore.getFee`
 * — that helper resolves a genuinely MISSING row to `amountMinor = 0`, which is
 * the one answer this module must be able to tell apart from a real zero. The
 * distinction between "absent" and "zero" is the whole of R6, and it is only
 * observable at the raw row.
 *
 * @param raw optional better-sqlite3 handle so the read joins the caller's
 *            transaction. Falls back to `rawDb()`.
 */
export function readAuthoritativeSpvDeploymentFeeRow(raw?: any): PlatformFeeRow | null {
  let handle = raw;
  if (!handle) {
    try {
      handle = rawDb();
    } catch {
      return null;
    }
  }
  try {
    const row = handle
      .prepare(`SELECT * FROM platform_fees WHERE key = ?`)
      .get(AUTHORITATIVE_SPV_DEPLOYMENT_FEE_KEY) as PlatformFeeRow | undefined;
    return row ?? null;
  } catch {
    // A read we cannot perform is NOT an absent price and NOT a zero. Returning
    // null routes it to the refusal, which is the fail-closed direction.
    return null;
  }
}

/**
 * The authoritative amount, or `null` when the row cannot answer. Use this on
 * DISPLAY surfaces, which must render an explicit "Not provided" (R6) rather
 * than a number.
 *
 * A row answers when it exists, is not soft-deleted, and carries an integer
 * amount. **A genuine, deliberately-entered `0` DOES answer** and means free —
 * R6 is explicit that a real zero renders as `0` and means it. What does NOT
 * answer is a `0` that no human ever entered (`updated_by_user_id IS NULL`),
 * which is the shape of an untouched placeholder rather than a decision.
 */
export function resolveAuthoritativeSpvDeploymentFee(
  raw?: any,
): AuthoritativeSpvDeploymentFee | null {
  const row = readAuthoritativeSpvDeploymentFeeRow(raw);
  if (!row) return null;
  if (row.deleted_at !== null && row.deleted_at !== undefined) return null;
  const amount = row.amount_minor;
  if (amount === null || amount === undefined) return null;
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount)) return null;
  if (amount < 0) return null;
  if (amount === 0 && (row.updated_by_user_id === null || row.updated_by_user_id === undefined)) {
    // An untouched zero is an absence wearing a number's clothes.
    return null;
  }
  return {
    amountMinor: amount,
    currency: (row.currency || "USD").toUpperCase(),
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
    updatedByUserId: row.updated_by_user_id ?? null,
  };
}

/** Same read, but THROWS the refusal instead of returning null. Use this on any
 *  path that must produce a price. */
export function requireAuthoritativeSpvDeploymentFee(
  raw?: any,
): AuthoritativeSpvDeploymentFee {
  const row = readAuthoritativeSpvDeploymentFeeRow(raw);
  if (!row) throw new SpvDeploymentFeeUnconfiguredError("has no row (or could not be read)");
  const resolved = resolveAuthoritativeSpvDeploymentFee(raw);
  if (!resolved) {
    if (row.deleted_at !== null && row.deleted_at !== undefined) {
      throw new SpvDeploymentFeeUnconfiguredError("is soft-deleted");
    }
    if (row.amount_minor === null || row.amount_minor === undefined) {
      throw new SpvDeploymentFeeUnconfiguredError("holds no amount");
    }
    if (row.amount_minor === 0) {
      throw new SpvDeploymentFeeUnconfiguredError(
        "holds an untouched zero that no operator has ever entered, so it is an " +
          "unset placeholder rather than a deliberate free fee",
      );
    }
    throw new SpvDeploymentFeeUnconfiguredError("holds a value that is not a non-negative integer of minor units");
  }
  return resolved;
}

/**
 * How the amount for one SPV deployment was decided. Extends
 * `partnerFeeResolver.ComputedVia` with the authoritative source; the three
 * pre-existing values keep their exact meaning so historical
 * `partner_billing_entries.computed_via` values stay readable.
 */
export type SpvDeploymentFeeVia =
  | "partner_override"
  | "tier_default"
  | typeof AUTHORITATIVE_COMPUTED_VIA;

export interface ResolvedSpvDeploymentFee {
  amountMinor: number;
  currency: string;
  feeScheduleId: string | null;
  computedVia: SpvDeploymentFeeVia;
}

/**
 * THE ONE READ that decides what an SPV deployment costs.
 *
 * Walks the precedence documented in this file's header. Throws
 * `SpvDeploymentFeeUnconfiguredError` when no level answers — never returns a
 * guessed, defaulted or zero amount.
 *
 * The banded machinery is invoked through the UNMODIFIED `resolvePartnerFee`,
 * so levels 1 and 2 keep their existing semantics, provenance and tests. Only a
 * `platform_default` answer — the seeded $0 bands — is DISCARDED in favour of
 * the authoritative row.
 */
export function resolveSpvDeploymentFee(
  partnerId: string,
  tier: PartnerTier,
  opts: { sizeMinor?: number | null; atIso?: string; raw?: any } = {},
): ResolvedSpvDeploymentFee {
  let banded: ResolvedFee | null = null;
  try {
    banded = resolvePartnerFee(partnerId, tier, "spv_deployment", {
      sizeMinor: opts.sizeMinor ?? null,
      atIso: opts.atIso,
    });
  } catch (err) {
    // A band gap is not fatal any more: the authoritative row is the answer of
    // record. Anything that is not a fee-resolution failure still propagates.
    if (!(err instanceof FeeResolutionError)) throw err;
    banded = null;
  }

  if (banded && banded.computedVia !== "platform_default") {
    // A DELIBERATE override (per-partner or per-tier) wins. This is the retained
    // tiered machinery, and it is deliberate by construction: someone had to
    // create the row on an admin screen.
    return {
      amountMinor: banded.amountMinor,
      currency: banded.currency,
      feeScheduleId: banded.feeScheduleId,
      computedVia: banded.computedVia as SpvDeploymentFeeVia,
    };
  }

  // Otherwise — including the seeded $0 platform-default bands — the row the
  // owner edits decides, or nothing does.
  const authoritative = requireAuthoritativeSpvDeploymentFee(opts.raw);
  return {
    amountMinor: authoritative.amountMinor,
    currency: authoritative.currency,
    feeScheduleId: null,
    computedVia: AUTHORITATIVE_COMPUTED_VIA,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  OBSERVABILITY — A SHADOWING OVERRIDE MUST NEVER BE INVISIBLE
 * ═══════════════════════════════════════════════════════════════════════════ *
 *
 * The pathology R22 names is "one number, several surfaces, several sources".
 * Retaining levels 1 and 2 keeps ONE legitimate way for the charged amount to
 * differ from the console value: a deliberate override. The defect was never
 * that overrides exist — it is that a divergence was UNREPORTED. So the
 * divergence is now a queryable list rather than a surprise on an invoice.
 */

export interface SpvDeploymentFeeDivergence {
  scope: "tier" | "partner";
  /** Tier slug, or partner id, that the shadowing row belongs to. */
  subject: string;
  feeScheduleId: string | null;
  amountMinor: number;
  currency: string;
  authoritativeAmountMinor: number | null;
  authoritativeCurrency: string | null;
  note: string;
}

/**
 * Every deliberate override that would shadow the authoritative SPV deployment
 * fee, with both amounts side by side. Drives an admin disclosure and is the
 * evidence that "one source" is TRUE where it is claimed and DISCLOSED where a
 * deliberate exception exists. Never throws; an unreadable table yields [].
 */
export function listSpvDeploymentFeeSourceDivergences(): SpvDeploymentFeeDivergence[] {
  const out: SpvDeploymentFeeDivergence[] = [];
  const authoritative = resolveAuthoritativeSpvDeploymentFee();
  let raw: any;
  try {
    raw = rawDb();
  } catch {
    return out;
  }
  try {
    const tierRows = raw
      .prepare(
        `SELECT id, tier, amount_minor, currency FROM partner_fee_schedules
          WHERE fee_kind = 'spv_deployment' AND tier IS NOT NULL
          ORDER BY tier, size_band_min`,
      )
      .all() as { id: string; tier: string; amount_minor: number; currency: string }[];
    for (const r of tierRows) {
      if (authoritative && r.amount_minor === authoritative.amountMinor) continue;
      out.push({
        scope: "tier",
        subject: r.tier,
        feeScheduleId: r.id,
        amountMinor: r.amount_minor,
        currency: r.currency,
        authoritativeAmountMinor: authoritative?.amountMinor ?? null,
        authoritativeCurrency: authoritative?.currency ?? null,
        note:
          `partner_fee_schedules row "${r.id}" is a DELIBERATE per-tier override and takes ` +
          `precedence over the authoritative platform_fees value for tier "${r.tier}".`,
      });
    }
  } catch {
    /* table unavailable — nothing to disclose */
  }
  try {
    const partnerRows = raw
      .prepare(
        `SELECT id, fee_override_json FROM contacts
          WHERE kind = 'consortium_partner' AND deleted_at IS NULL
            AND fee_override_json IS NOT NULL`,
      )
      .all() as { id: string; fee_override_json: string }[];
    for (const r of partnerRows) {
      let parsed: Record<string, any>;
      try {
        parsed = JSON.parse(r.fee_override_json) as Record<string, any>;
      } catch {
        continue;
      }
      const entry = parsed["spv_deployment"];
      if (!entry || typeof entry.amountMinor !== "number") continue;
      if (authoritative && entry.amountMinor === authoritative.amountMinor) continue;
      out.push({
        scope: "partner",
        subject: r.id,
        feeScheduleId: null,
        amountMinor: entry.amountMinor,
        currency: typeof entry.currency === "string" && entry.currency ? entry.currency : "USD",
        authoritativeAmountMinor: authoritative?.amountMinor ?? null,
        authoritativeCurrency: authoritative?.currency ?? null,
        note:
          `contacts.fee_override_json on partner "${r.id}" is a DELIBERATE per-partner ` +
          `override (R17 grandfathering is expressed this way) and takes precedence.`,
      });
    }
  } catch {
    /* table unavailable — nothing to disclose */
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 46 / R22 PART 2 — WHEN IS THE FEE CHARGED? "ON THE TRANSITION TO LIVE"
 * ═══════════════════════════════════════════════════════════════════════════ *
 *
 * R22: *"wire the fee to push-to-live, per R3: charged **exactly once**, on the
 * transition to live, **idempotently**."*
 *
 * "Live" is not a status in `shared/spvEngine.ts` — it is a PREDICATE the engine
 * already applies. `spvEngineStore.listVisibleForContext` treats an SPV as
 * visible-to-the-network when `status !== "draft"`, and `archiveSpv` retires one
 * to `wound_down`. So of the six canonical statuses
 * (`draft | open | closed | deployed | distributing | wound_down`), four are
 * LIVE and two are not:
 *
 *   NOT LIVE:  draft       — never published, no obligation
 *              wound_down  — retired; publishing it again is not a first push
 *   LIVE:      open, closed, deployed, distributing
 *
 * The fee is therefore attempted on any `not-live → live` edge. Two deliberate
 * consequences:
 *
 *   • A draft that is created and then DELETED never crosses the edge, so it is
 *     never charged — nothing to reverse, because nothing was billed.
 *   • A re-push after a wind-down DOES re-attempt, and is stopped by the
 *     idempotency latch rather than by the trigger condition. That is the
 *     stronger arrangement: it proves exactly-once at the LATCH (where a real
 *     duplicate would have to get through) instead of merely never asking twice.
 *     The three independent layers are the `spv_deployment_fee_billing` `charged`
 *     row (migration 0162), the existing `partner_billing_entries` row, and the
 *     non-NULL `spv.deployment_fee_minor` stamp.
 *
 * The `deployed` status is reached through `markDeployed`, which has charged the
 * fee since Wave 8. That call site is RETAINED unchanged; this predicate simply
 * closes the earlier door (`draft → open`) that was never wired. Both funnel
 * into the same latch, so adding the second trigger cannot double-charge.
 */

/** The two statuses that are NOT live. Anything else is published. */
export const NON_LIVE_SPV_STATUSES = ["draft", "wound_down"] as const;

/** True when this SPV status means "published / live to the network". */
export function isLiveSpvStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return !(NON_LIVE_SPV_STATUSES as readonly string[]).includes(status);
}

/** True exactly on a push-to-live edge: was not live, now is. */
export function isPushToLiveTransition(
  prevStatus: string | null | undefined,
  nextStatus: string | null | undefined,
): boolean {
  return !isLiveSpvStatus(prevStatus) && isLiveSpvStatus(nextStatus);
}
