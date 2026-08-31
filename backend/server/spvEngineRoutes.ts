/**
 * v25.49 Phase-4 — CANONICAL SPV Engine routes (one engine, three contexts).
 *
 * Route families:
 *   /api/partner/me/spv…        GP (Consortium Partner) context — tenant-scoped
 *                               to req.partnerContext.partnerId (session, never
 *                               URL). Sub-role gated for writes.
 *   /api/collective/spvs        Collective visibility context (read-only).
 *   /api/capavate/spvs          Capavate investor visibility context (read-only).
 *                               collective_only SPVs are NEVER returned here.
 *   /api/admin/consortium-spv…  Platform-admin governance context (separate
 *                               Consortium-Partners admin tab set); this is
 *                               where the platform fee layer is configured
 *                               (read-only to the GP).
 *
 * FAIL-CLOSED: spvEngineStore.getSpv returns null for a cross-partner id, so
 * every GP write/read on another partner's SPV yields 404 (no existence leak).
 *
 * DEPLOYMENT: the SINGLE cap-table ledger line is written through the EXISTING
 * sacred `commitFunded` path with the SPV as the single investor of record. The
 * founder-confirmed / docs-sent / investor-wired lifecycle is tracked OUTSIDE
 * the sacred ledger, in spv_deployment, at this route/parallel layer.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
/* WAVE 22 · ITEM 2 (REVIEW B F-3) — the SPV launch sign-off `ip` used to be the
 * raw `x-forwarded-for` header, i.e. attacker-chosen text in an authorization
 * record. Reuse the ONE hardened, fail-closed resolver instead of a local copy. */
import { resolveRateLimitClientIp } from "./lib/rateLimit";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import {
  partnerMayAttributeSpvToCompany,
  SPV_TARGET_COMPANY_NOT_YOURS,
  SPV_TARGET_COMPANY_NOT_YOURS_MESSAGE,
} from "./lib/partnerCompanyLinkGate"; /* WAVE 179 · ITEM A · R151.1 — the shared six-proof partner↔company predicate */
/* WAVE 193 · ITEM B · R165.4 — the accept-list of keys the vehicle PATCH actually
   applies, so the route can no longer answer 200 for a change the store drops. */
import {
  assertSpvPatchFullyApplied,
  isSpvPatchUnappliedError,
} from "./lib/spvVehiclePatchApplicability";
import { getSpvLegalForm, setSpvLegalForm } from "./spvLegalFormStore"; /* WAVE 179 · ITEM B · R151.3 — the OPTIONAL legal-form annotation, off the vehicle's own write path */
/* WAVE 154 · ITEM K — the SPV eligibility gate: every company an SPV invests
   into must hold a current paid Capavate membership before the vehicle may be
   created/launched or take money in (R116.3). */
import { getUserContext } from "./lib/userContext";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
// WAVE 1A / S-2 — the fee self-mark fix. See server/lib/feeSettlementAuthority.ts.
import { authorizeGatewaySettlement, authorizePlatformAdminSettlement } from "./lib/feeSettlementAuthority";
import { commitFunded, getLedger } from "./captableCommitStore";
import { spvEngineStore } from "./spvEngineStore";
/* WAVE 161 · BATCH 3 ITEM A — one stage-split helper and one set of denominator
   sentences, shared with the client surfaces that render these payloads. */
import {
  SPV_REGISTER_ALL_STAGES_BASIS,
  SPV_REGISTER_OWNERSHIP_DENOMINATOR_LABEL,
  SPV_CONFIRMED_CAPITAL_DENOMINATOR_LABEL,
  spvStageSplit,
  spvStageSplitStatement,
  spvSubscriptionStageLabelForRegister,
} from "@shared/spvCommittedCapital";
/* WAVE 162 · BATCH 3 ITEM B — the ONE transition-legality map and the ONE enum
   guard, consulted here so a malformed PATCH is a clean 400 at the boundary
   rather than a 500 raised out of the store. The store re-asserts both (see
   `advanceSubscription`); neither layer is sufficient alone. */
import { isSpvSubscriptionStatus, isSpvMoneyMinor } from "@shared/spvSubscriptionTransitions";
/* WAVE 162 · ITEM B (B-4) · R77 — the plain-language sentences, in `shared/` so
   this file can reach them. A refusal that leaves here as a bare code is read
   verbatim by `PartnerSpvDetail.tsx:267/:314`, so no refusal leaves here as a
   bare code. */
import {
  spvSubscriptionRefusalCopy,
  spvSubscriptionRefusalHeadline,
} from "@shared/spvSubscriptionRefusalCopy";
/* WAVE 151 · ITEM C · R105 — the cap arithmetic and the canonical committed sum
   live in the store; this route computes no rival figure of its own. */
import {
  computeCapImpact,
  canonicalCommittedMinorForSpv,
  /* WAVE 164 · ITEM C — the cap refusal that carries its own five-part split,
     and the builder the lp-commit route uses to attach the same split to the
     audit record and the response. */
  isSpvCapRefusalError,
  /* WAVE 182 · ITEM A · R152 — the closed-vehicle refusal and the shared gate the
     lp-commit route runs BEFORE it writes anything. */
  isSpvClosedToNewCapitalError,
  assertSpvOpenToNewCapital,
  spvCapSplitFiguresForSpv,
  /* WAVE 193 · ITEM A.5 · R165.1 — the mixed-currency committed-total refusal, so
     the five guarded totals reach a GP as a stated fact rather than a 500. */
  isSpvMixedCurrencyTotalError,
} from "./spvEngineStore";
/* WAVE 189 · ITEM C · R159.6 — the attestation gate and its refusal, imported from
   the same module the store sinks use so the route boundary and the store cannot
   come to disagree about whether a vehicle is attested. */
/* WAVE 192 · ITEM B1 · R164.3 — `isSpvAttestationUnreadableError` added to the
   import this file ALREADY had, so the fail-CLOSED refusal is served from the same
   module as the fail-open one it replaces. */
import {
  assertSpvAttestedForNewCapital,
  isSpvUnattestedDraftError,
  isSpvAttestationUnreadableError,
} from "./lib/spvAttestationGate";
/* WAVE 176 · ITEM B · R147.3(1) — the SAME sentence builder the store uses for the
   durable `_targetOverages` record, so the warning a partner reads on screen and
   the warning attached to the record cannot be worded differently. */
import { spvTargetRaiseWarningSentence } from "@shared/spvCapSplitDisclosure";
import { appendAdminAudit, isAuditWriteFailure } from "./adminPlatformStore";
/* WAVE 186 · R159.1 — the two SPV lifecycle writers wave 181 specified and
   deferred (W181_BUILD.md §5.1). They live in the shared writer module so the
   actor-resolution rule and the sentinel check are enforced in ONE place. */
import { auditSpvLpCommitted, auditSpvLpInvited } from "./lib/spvLifecycleAudit";
import { normaliseSpvTermsHurdle, PERCENT_FIELD_OUT_OF_DOMAIN, PERCENT_FIELD_UNKNOWN } from "./lib/percentPolicy";
/* WAVE 170 · R77 — the opaque support reference for a refusal with no copy, and
   the logger that joins it to the internal code (R77 permits the code in a log). */
import { mintRefusalIncidentCode } from "./lib/refusalIncidentCode";
import { log } from "./lib/logger";
// CP-SPV-31 — currency-aware minor-unit conversion. Static imports only.
import { decimalStringToMinor, currencyExponent } from "./lib/money";
import { resolveDisplayNames } from "./lib/displayNameResolver";
import {
  listLpInvites,
  createLpInvite,
  recordLpCommitIdentity,
  lpIdentitiesByInvestorId,
  lpInviteDisplayName,
  /* WAVE 112 · FINDING 3 — compensating write when the ledger insert fails. */
  revertLpCommitIdentityStatus,
} from "./spvLpInviteStore";
import { lpInvestorIdForEmail, lpCommitInvitationId } from "./lib/lpIdentity";
/* WAVE 25 / FE-3 — the rolling-close window comes from the DB policy ladder.
 * `resolveCloseWindowDays` shipped in WAVE 6 with ZERO callers while the literal
 * `30` stayed at this file's reopen route and at SpvDetailTabs.tsx. A policy
 * resolver nothing consults is a dead promise, so this is the wiring. */
import { resolveCloseWindowDays } from "./lib/spvFeeScheduleStore";
/* WAVE 3F / ITEM 4 — durable pending/failed deployment-fee billing + the
 * IDEMPOTENT retry the review found was missing everywhere in this file. */
import {
  listPendingEngineSpvDeploymentFees,
  getEngineSpvDeploymentFeeBilling,
  retryEngineSpvDeploymentFee,
} from "./lib/spvEngineDeploymentFeeHook";
/* WAVE 3F / ITEM 2 — admin remedy for a PARTNER_TIER_UNRESOLVED billing block. */
import { setCanonicalPartnerTier, PartnerTierResolutionError } from "./lib/partnerTierResolver";
// 1c — durable, verifiable launch sign-off recorded before an SPV is created.
import { recordSignoff, linkSignoffToSpv, listSignoffsForSpv } from "./spvLaunchSignoffStore";
import { createInvitation } from "./roundInvitationsStore";
import {
  SPV_JURISDICTIONS,
  SPV_CARRY_BASES,
  SPV_DISTRIBUTION_SCOPES,
  SPV_TYPES,
  SPV_CARRY_BASIS_HELP,
} from "../shared/spvEngine";
// WAVE 166 · ITEM D (D-4) — the alias-aware viewer identity set.
import { viewerInvestorIds } from "./lib/lpIdentityBinding";
/* WAVE 211 — the partner money gate. Text lives in shared/, capture lives in the
   store, and this is the one entry point the routes call. */
import {
  wave211Preflight,
  wave211RecordAfter,
  wave211AuditAttestation,
} from "./lib/wave211MoneyEventGate";
import { W211_EVENT_NOUN_DISTRIBUTION } from "../shared/wave211MoneyEventAttestation";
/* WAVE 227 / ITEM 1 — G6's writer fence. Imported FROM the one accreditation
   mechanism rather than reimplemented here, so this route cannot drift into being
   a second mechanism with its own idea of what a jurisdiction is. */
import { accreditationAssertionRefusal } from "./investorComplianceRoutes";

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

/* WAVE 1A / S-2 — the request-body WHITELIST for BOTH distribution routes.
 *
 * `spvEngineRoutes.ts:397` used to forward `req.body ?? {}` WHOLESALE into
 * `recordDistribution`, where `data.collectionOutcome` (spvEngineStore.ts:1456)
 * became the carry settlement outcome. Two independent defences now:
 *
 *   1. `assertNoSmuggledSettlement` — a LOUD 400 if any settlement-shaped key is
 *      present, so a client cannot believe it set an outcome that was ignored.
 *   2. `pickDistributionBody` — an allowlisting PROJECTION. Only these four
 *      fields are ever constructed; anything else cannot reach the store even if
 *      (1) missed it. Field-level validation stays in the store, so existing
 *      error codes (EVENT_REQUIRED / INVALID_GROSS / DISTRIBUTION_BASIS_REQUIRED)
 *      are unchanged. */
const SETTLEMENT_SMUGGLING_KEYS = ["collectionOutcome", "outcome", "forceState", "state", "settlement", "paymentRef"] as const;

function assertNoSmuggledSettlement(raw: unknown): void {
  const b = (raw ?? {}) as Record<string, unknown>;
  for (const k of SETTLEMENT_SMUGGLING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(b, k)) throw new Error("SETTLEMENT_NOT_CLIENT_SUPPLIED");
  }
}

function pickDistributionBody(raw: unknown): {
  event: string; grossProceedsMinor: number; currency?: string; costBasisMinor?: number; distributionType?: string;
} {
  const b = (raw ?? {}) as Record<string, unknown>;
  const out: { event: string; grossProceedsMinor: number; currency?: string; costBasisMinor?: number; distributionType?: string } = {
    event: b.event as string,
    grossProceedsMinor: b.grossProceedsMinor as number,
  };
  if (b.currency !== undefined) out.currency = b.currency as string;
  if (b.costBasisMinor !== undefined) out.costBasisMinor = b.costBasisMinor as number;
  /* WAVE 6 / SC-3 + SC-5 — FIFTH allowlisted field.

     This projection is the reason SC-5 could not be done client-side alone.
     It is an ALLOWLIST: a key absent from here is silently dropped, so adding
     the GP's tax/accounting classification to the form without adding it here
     would have produced exactly the project's recurring failure — a UI control
     wired to nothing, on a path where the data does not flow. Both callers of
     this function (:504 partner, :527 admin) reach the same single canonical
     sink, spvEngineStore.recordDistribution, which validates the value
     fail-closed and persists it to spv_distribution.distribution_type.

     Allowlist discipline is preserved: this stays a five-field projection, and
     no settlement key can ride in on it (WAVE 1A / S-2 SINK 2). */
  if (b.distributionType !== undefined) out.distributionType = b.distributionType as string;
  return out;
}

/* W1 C2 (v26.2.0) — strict schema for the investor compliance profile PUT.
 * Dates are validated as bounded non-empty strings (fixtures may not be RFC3339);
 * .strict() rejects any unknown key so a partner cannot smuggle arbitrary fields. */
const investorComplianceProfilePatchSchema = z.object({
  kycStatus: z.enum(["none", "pending", "verified", "expired", "manual_review"]).optional(),
  kycVerifiedAt: z.string().trim().min(1).max(64).nullable().optional(),
  kycExpiry: z.string().trim().min(1).max(64).nullable().optional(),
  accreditationStatus: z.enum(["none", "self_certified", "verified", "manual_review"]).optional(),
  accreditationCertifiedAt: z.string().trim().min(1).max(64).nullable().optional(),
  jurisdiction: z.string().trim().min(2).max(64).nullable().optional(),
}).strict();

/* ── WAVE 33 / CP-SPV-31 · SINK 4 ─────────────────────────────────────────────
 * WAS:
 *
 *     function minorToDecimal(minor: number): string {
 *       const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
 *       ...
 *     }
 *
 * The EXACT INVERSE of sink 1, hardcoding exponent 2 in the other direction,
 * and it sits on a worse path: its single caller is the deployment-commit
 * handler, where the returned string is the `amount` written into the SACRED
 * cap-table ledger via `commitFunded`. A ¥1,000,000 deployment (amountMinor =
 * 1_000_000, JPY exponent 0) was written to the ledger as "10000.00" — a 100x
 * UNDERSTATEMENT of capital deployed into a real company round, recorded in the
 * one store the platform treats as authoritative and append-only.
 *
 * Sinks 1 and 4 therefore inflated the LP roster 100x and deflated the ledger
 * 100x, in the same currency, in the same file. Neither had a test that used a
 * non-2dp currency, so both were invisible.
 *
 * Now exponent-driven, and exact: BigInt only, no float ever holds the value.
 */
function minorToDecimal(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const abs = BigInt(Math.abs(Math.trunc(minor)));
  if (exp <= 0) return `${neg ? "-" : ""}${abs.toString()}`;
  // No `**` on bigint: the compile target predates ES2016 exponentiation.
  let divisor = BigInt(1);
  for (let i = 0; i < exp; i += 1) divisor *= BigInt(10);
  const whole = abs / divisor;
  const frac = (abs % divisor).toString().padStart(exp, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

function err(res: Response, e: unknown): Response {
  const msg = (e as Error).message || "ERROR";
  const map: Record<string, number> = {
    SPV_NOT_FOUND: 404, DEPLOYMENT_NOT_FOUND: 404, SUBSCRIPTION_NOT_FOUND: 404, NO_MANDATE: 404,
    CARRY_BASIS_REQUIRED: 400, INVALID_JURISDICTION: 400, INVALID_SPV_TYPE: 400, INVALID_SPV_STATUS: 400, SPV_NAME_REQUIRED: 400,
    INVALID_DISTRIBUTION_SCOPE: 400, INVALID_FEE_LAYER: 400, INVALID_FEE_TYPE: 400, FIXED_AMOUNT_REQUIRED: 400,
    CARRY_PCT_REQUIRED: 400, COMBINED_CARRY_EXCEEDS_CAP: 400, FEES_EXCEED_RAISE: 400, RULE_TREE_REQUIRED: 400, INVALID_COMMITMENT: 400, INVALID_AMOUNT: 400,
    INVALID_GROSS: 400, EVENT_REQUIRED: 400, BELOW_MIN_CHECK: 400, EXCEEDS_CAP: 400, ALREADY_SUBSCRIBED: 409,
    INVESTOR_ID_REQUIRED: 400, COMPANY_AND_ROUND_REQUIRED: 400, STORAGE_KEY_REQUIRED: 400,
    TRANSFER_PARTIES_REQUIRED: 400, PLATFORM_FEE_ADMIN_ONLY: 403,
    // WAVE 25 / FE-4 — the transfer guards the store had no counterpart for.
    // SPV_WOUND_DOWN is 409: the request is well-formed, the vehicle's state
    // forbids it — exactly what the wind-down panel already promises the GP.
    TRANSFER_SELF: 400, TRANSFER_CONSIDERATION_REQUIRED: 400,
    INVALID_UNITS_PCT: 400, SPV_WOUND_DOWN: 409,
    INVESTOR_NOT_IN_PARTNER_TENANT: 403, INVESTOR_TENANT_CHECK_FAILED: 500,
    INVALID_LP_VISIBILITY: 400, NOT_AN_LP: 403,
    INVALID_MANDATE_MODE: 400, MANDATE_DESCRIPTION_REQUIRED: 400, MANDATE_DESCRIPTION_TOO_LONG: 400,
    /* WAVE 82 · ITEM 2 — a negative GP commitment is a client error. */
    INVALID_GP_COMMIT: 400,
    // WAVE 25 / FE-1 — mandate check-size bounds. An inverted or malformed
    // range used to persist silently; it is now a loud 400 at the sink.
    INVALID_CHECK_MIN: 400, INVALID_CHECK_MAX: 400, INVALID_CHECK_RANGE: 400,
    GATE_KYC_REQUIRED: 422, GATE_ACCREDITATION_REQUIRED: 422, GATE_SUBSCRIPTION_ESIGN_REQUIRED: 422,
    FEE_OBLIGATION_NOT_FOUND: 404, FEES_UNPAID: 409, FEE_COLLECTION_FAILED: 402,
    FOUNDER_NOT_CONFIRMED: 409, WIRE_PAYMENT_REF_REQUIRED: 409,
    NO_ACTIVE_ROUND: 409, COMPANY_NOT_ELIGIBLE: 409, INSUFFICIENT_COMMITTED_CAPITAL: 409,
    INSTRUMENT_NOT_IN_ROUND: 409, DISTRIBUTION_BASIS_REQUIRED: 400, NO_COMMITTED_LPS: 409,
    LP_INVITE_EMAIL_REQUIRED: 400, LP_INVITE_LAST_NAME_REQUIRED: 400, LP_INVITE_PERSIST_FAILED: 500,
    // WAVE 1A / S-2 — settlement authority errors.
    SETTLEMENT_AUTHORIZATION_REQUIRED: 403, SETTLEMENT_AUTHORIZATION_REPLAYED: 409,
    SETTLEMENT_AUTHORIZATION_SCOPE_MISMATCH: 403, SETTLEMENT_OUTCOME_REQUIRED: 400,
    SETTLEMENT_REASON_REQUIRED: 400, ADMIN_REQUIRED: 403,
    // WAVE 3F / ITEM 2 — fail-closed partner tier resolution. Missing or
    // inconsistent tier data BLOCKS billing (400) instead of selecting a tier.
    PARTNER_TIER_UNRESOLVED: 400, PARTNER_TIER_INCONSISTENT: 409,
    DEPLOYMENT_FEE_BILLING_NOT_FOUND: 404,
    PAYMENT_GATEWAY_UNAVAILABLE: 503, SETTLEMENT_NOT_CLIENT_SUPPLIED: 400,
    // WAVE 3E — the authority is a DURABLE ROW (migration 0151). These are the
    // additional fail-closed rejections that a DB-backed authorization can
    // produce. All of them DENY; none of them is a degraded "allow".
    SETTLEMENT_AUTHORIZATION_EXPIRED: 403, SETTLEMENT_AUTHORIZATION_REVOKED: 403,
    SETTLEMENT_AUTHORIZATION_NOT_TRANSACTIONAL: 500, SETTLEMENT_AUTHORITY_UNAVAILABLE: 503,
    // WAVE 6 / SC-3 — an explicit distribution_type outside the domain is a
    // client error, not a server error, and is rejected BEFORE any write.
    SPV_DISTRIBUTION_TYPE_INVALID: 400,
    // WAVE 6 / CP-SPV-16 + CP-SPV-34 — the fee resolver fails CLOSED. A missing
    // schedule row is 503 ("we cannot price this right now"), never a silent 0.
    SPV_FEE_SCHEDULE_MISSING: 503, SPV_FEE_SCHEDULE_INVALID: 500,
    SPV_FEE_SCHEDULE_UNAVAILABLE: 503,
    /* WAVE 26 / S-3 SECOND PATH — the `spv_fee` view is not known to be loaded.
       503, matching SPV_FEE_SCHEDULE_UNAVAILABLE: the request is valid and the
       vehicle is fine; the server simply cannot price it right now and will not
       guess a zero. Retryable, and never a 400 the GP might try to "fix". */
    FEE_STATE_UNKNOWN: 503,
    // WAVE 6 / CP-SPV-25 — 1:1 subscription uniqueness.
    SUBSCRIPTION_ALREADY_EXISTS: 409,
    // WAVE 6 / FE-3 — the rolling-close window is DB-driven and fails closed.
    SPV_CLOSE_WINDOW_POLICY_MISSING: 503, INVALID_CLOSE_WINDOW: 400,
    /* WAVE 166 · BATCH 3 ITEM D (PATH 1) · R131.1 — the offline affirmation.
       409 for REQUIRED: the request is well-formed and the amount is fine; the
       SUBSCRIPTION'S STATE forbids calling an unaffirmed indication committed
       capital. 400 for INCOMPLETE: the caller sent a malformed affirmation.
       Both sentences already exist in `shared/spvSubscriptionRefusalCopy.ts`, so
       neither code can reach the GP naked at `PartnerSpvDetail.tsx:267/:314`. */
    GP_OFFLINE_CONFIRMATION_REQUIRED: 409, GP_OFFLINE_CONFIRMATION_INCOMPLETE: 400,
    /* WAVE 166 · ITEM D (Path 2) — an origin outside wave 130's vocabulary. */
    LP_INVITE_INVALID_ORIGIN: 400,
    /* WAVE 161 · BATCH 3 ITEM A (A-5) — a wire recorded against an investor who
       has not committed. 409, not 400: the request is well-formed and the amount
       is fine; the SUBSCRIPTION'S STATE forbids reconciling a wire against a
       non-binding indication. Plain-language copy exists ahead of this line in
       `shared/spvSubscriptionRefusalCopy.ts` — wave 162 MOVED it there from
       `client/src/lib/serverRefusalMessage.ts`, which re-exports it, so this
       file can reach the sentence and attach it below (R77). */
    FUNDS_CONFIRMATION_REQUIRES_COMMITMENT: 409,
    /* WAVE 162 · BATCH 3 ITEM B — a PATCH with no `to` at all. 400: the request
       is malformed, and the subscription is untouched. Plain-language copy for
       this code exists in `shared/spvSubscriptionRefusalCopy.ts` (R77). */
    SUBSCRIPTION_STATUS_REQUIRED: 400,
  };
  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 162 · BATCH 3 ITEM B (B-4) · R77 — NO REFUSAL LEAVES HERE AS A BARE
     CODE, AND THE PREFIX FORMS ARE 400 rather than 500.
     ═══════════════════════════════════════════════════════════════════════
     Three of Item B's codes carry their diagnosis AFTER the code
     (`INVALID_SUBSCRIPTION_STATUS:string:committedd`,
     `INVALID_WIRED_MINOR:string:1000`,
     `ILLEGAL_SUBSCRIPTION_TRANSITION:committed:soft_circled:…`), so the
     exact-key lookup in `map` above can never match them and every one of them
     would have been reported as an HTTP **500** carrying an internal string. A
     rejected input is a 400, and a refused transition of a well-formed status is
     a 409 — never a server failure.

     `message` carries the boundary-safe HEADLINE and `guidance` the unabridged
     sentence. The split is not cosmetic: `client/src/lib/queryClient.ts:60-65`
     discards any server `message` of 240 characters or more and substitutes a
     generic one, and `PartnerSpvDetail.tsx:267/:314` render `e.message` RAW. The
     full reasoning is written out in `shared/spvSubscriptionRefusalCopy.ts`.

     `error` still carries the exact code, unchanged, because an operator quoting
     it in a ticket must still find it (R44: ADD, do not substitute).
     ═══════════════════════════════════════════════════════════════════════ */
  const SPV_SUBSCRIPTION_PREFIX_STATUS: Record<string, number> = {
    INVALID_SUBSCRIPTION_STATUS: 400,
    INVALID_WIRED_MINOR: 400,
    /* 409, not 400: the request is well-formed and the target IS a real stage —
       the SUBSCRIPTION'S CURRENT STATE is what forbids the move. Same reasoning
       as FUNDS_CONFIRMATION_REQUIRES_COMMITMENT above. */
    ILLEGAL_SUBSCRIPTION_TRANSITION: 409,
  };
  {
    const head = msg.split(":")[0] ?? "";
    const prefixStatus = SPV_SUBSCRIPTION_PREFIX_STATUS[head];
    if (prefixStatus !== undefined) {
      return res.status(prefixStatus).json({
        error: msg,
        message: spvSubscriptionRefusalHeadline(head) ?? undefined,
        guidance: spvSubscriptionRefusalCopy(head) ?? undefined,
      });
    }
  }
  /* ══════════════════════════════════════════════════════════════════════
     WAVE 164 · BATCH 3 ITEM C · R77 / R133.1 — THE CAP REFUSAL CARRIES ITS SPLIT.
     ══════════════════════════════════════════════════════════════════════
     `EXCEEDS_CAP` used to leave here as `{ error: "EXCEEDS_CAP" }` with NO
     `message`, and `PartnerSpvDetail.tsx:267/:314` render `e.message` RAW — so a
     GP read the bare code on screen. `spvEngineStore.subscribe` now throws an
     error that CARRIES the five-part split, and this branch serves it.

     `error` is still EXACTLY `EXCEEDS_CAP` and the status is still 400, so no
     shipped assertion on the code or the status changes (R44: ADD, do not
     substitute; R98: never lower an assertion). What is added is the `message`
     headline (short enough to survive `queryClient.ts`'s 240-char `looksHuman`
     gate), the unabridged `guidance`, and a machine `capSplit` object naming cap,
     confirmed capital, soft-circled interest, funds-received-not-committed and
     the overage SEPARATELY — never a single "committed" number, and never a total
     without its parts.

     Placed BEFORE the generic copy lookup below so the vehicle's own figures win
     over the static fallback sentence in `spvSubscriptionRefusalCopy.ts`; that
     fallback still covers any `EXCEEDS_CAP` raised without a split, so the code
     cannot reach a user naked by either route. */
  if (isSpvCapRefusalError(e)) {
    return res.status(400).json({
      error: msg,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      capSplit: e.capSplit,
    });
  }
  /* ═════════════════════════════════════════════════════════════════
     WAVE 182 · ITEM A · R152 / R149.2 — THE CLOSED-VEHICLE REFUSAL, IN WORDS.
     ═════════════════════════════════════════════════════════════════
     409, NOT 400, and the reasoning is the one already written for
     `FUNDS_CONFIRMATION_REQUIRES_COMMITMENT` and `ILLEGAL_SUBSCRIPTION_TRANSITION`
     above: the request is well formed and the vehicle is real — it is the
     VEHICLE'S CURRENT STATE that forbids the write.

     `error` is the machine code `SPV_CLOSED_TO_NEW_LPS`, so a support ticket can
     still be keyed on it (R44: add, do not substitute). What a general partner
     READS is `message`/`guidance`, which name the vehicle, state that it is closed
     to new limited partners, state that funds already committed can still be
     confirmed, and state that it can be reopened for a rolling close. R152 item 3:
     NEVER an all-capitals underscore code on screen.

     Placed BEFORE the generic copy lookup below so this branch owns the code and
     no static fallback sentence can shadow the vehicle's own name. */
  if (isSpvClosedToNewCapitalError(e)) {
    return res.status(409).json({
      error: msg,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      closedToNewLps: { reason: e.closedReason },
    });
  }
  /* WAVE 189 · ITEM C · R159.6 — THE UNATTESTED-DRAFT REFUSAL, IN WORDS.

     Same shape and same placement reasoning as the closed-vehicle branch directly
     above, and for the same owner requirement (R159.6 item 4): a refusal must be a
     STATED FACT, never an ALL-CAPS underscore code on screen. The machine code stays
     in `error` so no existing assertion on a code changes; the sentence the general
     partner actually reads is `message` (short enough to survive the 240-character
     `looksHuman` gate in `client/src/lib/queryClient.ts`) and the unabridged version
     is `guidance`.

     409 CONFLICT, not 403: the request was authorised and well-formed, and the
     vehicle's state is what conflicts with it — the same status the close refusal
     uses, for the same reason. `attestation.required` says which fact is missing and
     `attestation.attaching` says which of the three kinds of capital was refused,
     so a caller never has to parse the prose. */
  if (isSpvUnattestedDraftError(e)) {
    return res.status(409).json({
      error: msg,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      attestation: { required: true, attaching: e.attachKind },
    });
  }
  /* WAVE 192 · ITEM B1 · R164.3 — AND THE CASE WHERE THE PLATFORM CANNOT TELL.

     `spvIsAttested` used to return `true` — ATTESTED — whenever
     `spv_launch_signoffs` could not be read. That is a fail-OPEN on the gate wave
     189 had just built: an unreadable table reported every vehicle attested and
     let capital attach to an unattested draft, while reporting success. It now
     refuses, and the refusal NAMES what could not be read.

     REPORTED SEPARATELY from the branch above, not folded into it, because the
     remedies differ: an unattested draft is fixed by a general partner signing,
     an unreadable table by an operator restoring it. Telling a GP to sign an
     attestation they may already have signed would be a false statement.
     `attestation.unreadable` distinguishes the two for a caller without parsing
     prose. Same 409 and same body shape — a refusal is a refusal. */
  /* WAVE 193 · ITEM B · R165.4 — THE DROPPED-FIELD REFUSAL, IN WORDS.

     400, not 409: the body itself asks for something this endpoint does not do,
     so it is the REQUEST that is wrong, not the vehicle's state. Same body shape
     as the four branches above — the machine code stays in `error` so nothing that
     keys on a code changes (R44: add, do not substitute), `message` is the short
     headline that survives `queryClient.ts`'s 240-character `looksHuman` gate, and
     `guidance` is the unabridged sentence. `unappliedFields` names the offending
     keys machine-readably so a caller never parses prose. NEVER an all-caps
     underscore code on screen (R152 item 3 / R165.4). */
  if (isSpvPatchUnappliedError(e)) {
    return res.status(400).json({
      error: msg,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      unappliedFields: e.unappliedFields,
    });
  }
  /* WAVE 193 · ITEM A.5 · R165.1 — THE MIXED-CURRENCY TOTAL REFUSAL, IN WORDS.

     A vehicle whose commitments are recorded in two different currencies has no
     committed total, no ownership-percentage denominator and no contributed base,
     because Capavate converts no currency (R156.1). 409, like the closed-vehicle
     and unattested-draft branches above and for the same reason: the request is
     well formed and authorised, and it is the VEHICLE'S RECORDED STATE that
     forbids answering. `mixedCurrency` names which figure refused and which codes
     were found, so a caller need not parse the sentence. */
  if (isSpvMixedCurrencyTotalError(e)) {
    return res.status(409).json({
      error: msg,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      mixedCurrency: { total: e.totalName, statedCurrencies: e.statedCurrencies },
    });
  }
  if (isSpvAttestationUnreadableError(e)) {
    return res.status(409).json({
      error: msg,
      message: e.refusalHeadline,
      guidance: e.refusalGuidance,
      attestation: { required: true, attaching: e.attachKind, unreadable: true },
    });
  }
  /* Every OTHER code this module can raise that HAS plain-language copy gets the
     sentence attached too. `error` is untouched, so no existing assertion on the
     code changes; a body that previously carried only a code now also carries
     the words. Codes with no copy are left exactly as they were — this cannot
     invent an explanation for a refusal nobody has written one for. */
  {
    const headline = spvSubscriptionRefusalHeadline(msg);
    if (headline && map[msg] !== undefined) {
      return res.status(map[msg]).json({
        error: msg,
        message: headline,
        guidance: spvSubscriptionRefusalCopy(msg) ?? undefined,
      });
    }
  }
  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 82 · ITEM 2 — THE HURDLE WAS ALREADY FENCED. IT WAS REPORTED AS A 500.
     ═══════════════════════════════════════════════════════════════════════
     THIS CORRECTS THE PRE-FLIGHT. §2.2 of PREFLIGHT_TIER1_2026_08_20.md states
     the hurdle has "**none at create**" server-side and is "[e]nforced **later**,
     at the distribution/waterfall sink". Measured
     (build_log/wave82/W82_ITEM2_LAUNCH_BEFORE.txt, configuration C): a create
     with `terms.hurdleRatePct: 500` is REFUSED and **nothing is created** —
     `normaliseSpvTermsHurdle` has been wired at this file's create AND patch
     boundaries since Wave 5 / P-4 (see :~269 and :~352). The defect that remains
     is the STATUS and the MESSAGE: the thrown string is
     `PERCENT_FIELD_OUT_OF_DOMAIN:spv.hurdleRatePct:500:[0,100] — <rationale>`, so
     the exact-key lookup above can never match it and the partner receives an
     HTTP 500 carrying an internal rationale paragraph. A rejected user input is a
     400, not a server failure.

     Prefix-matched, not added to `map`, precisely because the message carries the
     field, the value and the declared domain after the code — and those three
     facts are the useful part of the refusal, so they are kept in the response.
     `fieldError` names the offending field separately so a client can point at
     the control without parsing the string. Nothing is clamped and no value is
     rescaled: the domain lives in `PERCENT_FIELD_DOMAIN` and this only decides
     how its refusal is reported.
     ═══════════════════════════════════════════════════════════════════════ */
  /* WAVE 161 · ITEM A (A-6) — the write chokepoint refuses a non-integer money
     value and names the field, the type it received and the value, because those
     three facts are the whole diagnosis. Prefix-matched for the same reason the
     percent-domain refusal below is: the useful part follows the code. 400 — a
     malformed amount in a request is a client error, never a server failure. */
  if (msg.startsWith("SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR:")) {
    const parts = msg.split(":");
    /* WAVE 162 · ITEM B (B-4) — `fieldError` names the field for a control to
       point at; `message`/`guidance` are what a PERSON reads. Wave 161 wrote the
       copy for this code and nothing could reach it; now it is attached. */
    return res.status(400).json({
      error: msg,
      fieldError: parts[1] ?? null,
      message: spvSubscriptionRefusalHeadline(msg) ?? undefined,
      guidance: spvSubscriptionRefusalCopy(msg) ?? undefined,
    });
  }
  if (msg.startsWith(`${PERCENT_FIELD_OUT_OF_DOMAIN}:`) || msg.startsWith(`${PERCENT_FIELD_UNKNOWN}:`)) {
    const parts = msg.split(":");
    return res.status(400).json({
      error: msg,
      fieldError: parts[1] ?? null,
      /* WAVE 170 — this branch has never carried a `message`, so the screen shows
         the boundary's generic substitute and the rationale inside `error` is
         discarded. The reference below is the only thing a GP can hand to
         support. See the block at the tail of this function. */
      incidentCode: mintUnexplainedRefusalReference(msg),
    });
  }
  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 170 · BATCH 4 ITEM B · R77 / R111 Q13 — THE UNMAPPED TAIL.
     ═══════════════════════════════════════════════════════════════════════
     WHAT ACTUALLY REACHED THE SCREEN, MEASURED NOT ASSUMED. This line is where
     every code with no status and no copy leaves: `LP_IDENTITY_PERSIST_FAILED`,
     `LP_IDENTITY_EMAIL_REQUIRED`, `SPV_NOT_FOUND` raised from a store, anything
     a future store throws. The body was `{ error: "<CODE>" }` with NO `message`,
     and `client/src/lib/queryClient.ts:60-65` therefore substitutes a GENERIC
     sentence for `ApiError.message` ("Something went wrong on our side. Please
     try again."). The five handlers in `PartnerSpvDetail.tsx` render that
     `e.message`. So the GP was NOT usually shown the raw code by this path — the
     defect here is the opposite one, and it is worse than it looks: a sentence
     that names NO next step and carries NOTHING traceable, while the code that
     would have let support find the failure is discarded by the boundary.

     (The raw code DOES reach the screen through the OTHER shape on these five
     channels: an error thrown inside `mutationFn` that is not an `ApiError` —
     `res.json()` on a truncated body, a helper throwing a bare code — whose
     `.message` is rendered verbatim. That half is fenced on the client, in
     `partnerActionRefusalText`. Neither half is fixed by the other, so both are
     changed in this wave.)

     `error` is UNTOUCHED — byte-for-byte the code every shipped assertion and
     every support ticket already quotes (R44: ADD, do not substitute). What is
     added is `incidentCode`, the wave-148 opaque reference, logged beside the
     internal code so a screenshot resolves to one log line, and safe to render
     because it names nothing internal (R77).
     ═══════════════════════════════════════════════════════════════════════ */
  return res.status(map[msg] ?? 500).json({ error: msg, incidentCode: mintUnexplainedRefusalReference(msg) });
}

/**
 * WAVE 170 — mint the opaque reference AND write the log line that joins it to
 * the internal code. One function so the two can never drift apart: a reference
 * on a screen with no log line behind it is worse than none, because support
 * would ask the client for a code that leads nowhere.
 */
function mintUnexplainedRefusalReference(internalCode: string): string {
  const incidentCode = mintRefusalIncidentCode("SPV");
  log.error(
    `[spv.refusal.unexplained] ${internalCode} (incident ${incidentCode}) — ` +
      "no plain-language copy exists for this code; the client was shown the generic refusal sentence and this reference.",
  );
  return incidentCode;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 82 · ITEM 2 — THE GP COMMITMENT HAD NO BOUND AT ANY WRITER.
   ═══════════════════════════════════════════════════════════════════════════
   `terms.gpCommitMinor` is minor units written straight into the terms blob by
   the SPV wizard (`toMinor(parseFloat(w.gpCommitMajor) …)`). Nothing on either
   the create or the patch path checked its sign, so a NEGATIVE GP commitment
   was storable on a 200 and would then be read by the waterfall as capital the
   GP had contributed. Refused by name at the route boundary, alongside the
   hurdle normalisation, so the two terms-blob money fields are fenced in one
   place. An ABSENT or null key is left untouched — this is not a migration and
   it must not make an optional field required.

   NOT A CLAMP. A negative commitment is a data-entry error, and R16/P-4 is
   explicit that the platform refuses rather than rescales.
   ═══════════════════════════════════════════════════════════════════════════ */
export const INVALID_GP_COMMIT = "INVALID_GP_COMMIT";
function assertGpCommitInDomain(terms: unknown): void {
  if (!terms || typeof terms !== "object" || Array.isArray(terms)) return;
  const t = terms as Record<string, unknown>;
  if (!("gpCommitMinor" in t)) return;
  const raw = t.gpCommitMinor;
  if (raw === null || raw === undefined || raw === "") return;
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new Error(INVALID_GP_COMMIT);
  }
}

/* ══ WAVE 179 · ITEM C · R151.2 — ONE ROSTER PAYLOAD, TWO REPRESENTATIONS ════
   R151.2 is explicit that an export which disagrees with the screen is worse than
   no export. The only way to guarantee they agree is for both to be the SAME
   computation, so the GP LP-roster handler's body is LIFTED HERE VERBATIM and the
   handler now returns it. The JSON route's response is byte-for-byte what it was;
   the CSV export in `server/partnerExportRoutes.ts` calls this same function and
   formats its rows. Nothing is re-derived and no figure is recomputed anywhere.

   `ctx.partnerId` became the `partnerId` argument; that is the only edit. */
export function buildPartnerLpRosterPayload(
  partnerId: string,
  spvId: string,
  spv: { lpVisibility?: string | null },
) {
    const subs = spvEngineStore.listSubscriptions(partnerId, spvId);
    const names = resolveDisplayNames(subs.map((s) => s.investorId));
    /* WAVE 106 — READ-TIME IDENTITY REPAIR.
     *
     * `resolveDisplayNames` can only resolve an id that belongs to a platform
     * user. An off-platform LP seated by the commit form carries a derived
     * `ext_<hash-of-email>` id, which resolves to nothing, and the resolver's
     * fallback then printed the literal "Pending member" — an anonymous row
     * holding real money, next to an unrelated "invited" row for the same
     * human. The LP identity register (spv_lp_invite) holds the name and email
     * that were actually typed, keyed by the SAME derivation, so the money can
     * be put back on the person here. This also repairs rows written before
     * this wave, which is why it is a read and not a migration. */
    const identities = lpIdentitiesByInvestorId(partnerId, spvId);
    const total = subs
      .filter((s) => s.status !== "withdrawn")
      .reduce((a, s) => a + s.commitmentMinor, 0);
    /* ══════════════════════════════════════════════════════════════
       WAVE 161 · BATCH 3 ITEM A (A20/A21) — THE GP ROSTER'S DENOMINATOR.
       ══════════════════════════════════════════════════════════════
       `total` above sums EVERY non-withdrawn subscription, and `ownershipPct`
       divides by it, so a committed LP's ownership was diluted by other
       people's non-binding indications. The row already carried `status`, so
       the STAGE was visible — the PERCENTAGE never was.

       `ownershipPct` keeps its exact value (no client render changes, R44:
       add). What is added: the same figure under an honest name, the
       confirmed-capital share (`null`, not 0, for a row that is not committed),
       the stage in words, and the vehicle-level split so the GP can see how
       much of what is listed is actually capital. */
    const rosterSplit = spvStageSplit(subs);
    /* ══════════════════════════════════════════════════════════════════
       WAVE 182 · ITEM B · R152.3 — "CONFIRMED" WAS NEVER SAYABLE FROM THIS PAYLOAD.
       ══════════════════════════════════════════════════════════════════
       THE DEFECT IS VOCABULARY, NOT WORKFLOW. The two-step flow — commit, then
       confirm funds received — is CORRECT and is not changed by one line of this
       wave. What was wrong is that the roster read "Committed" both BEFORE and
       AFTER the general partner confirmed the wire, so the register could not tell
       a promise from money in the account.

       ALREADY DERIVABLE — SO THIS IS A DISPLAY FIX, NOT A SCHEMA CHANGE. The state
       has been persisted all along, in `terms._fundsConfirmations` keyed by
       investor id, and `spvEngineStore.confirmedByInvestor` is the read-only getter
       that already existed for it. No column, no table, no migration.

       PRESENCE, NOT AMOUNT. The question this answers is "has the general partner
       confirmed receipt for this limited partner", and a confirmation recorded for
       a zero or short receipt is still a confirmation (`computeFundsConfirmation`
       flags a mismatch and never blocks). Reading the amount to answer a yes/no
       question would introduce a money comparison for nothing.

       NOTHING IS WRITTEN. This wave does not touch `confirmFundsReceived`, and it
       performs no `terms` merge — which is the whole point of reading through the
       existing getter rather than reaching into the blob: a one-level-deep merge
       mistake here would delete `_fundsConfirmations` and break every K-1.

       ADDITIVE. `fundsConfirmed` is a NEW key beside the existing ones; `status`,
       `stage`, `stageLabel` and `isConfirmedCapital` keep their exact names, values
       and meanings, so no existing reader (including wave 179's CSV export, which
       shares this builder) can trip on it. */
    const fundsConfirmedInvestorIds = new Set(
      Object.keys(spvEngineStore.confirmedByInvestor(partnerId, spvId)).map((k) => String(k).trim()),
    );
    const subscribers = subs.map((s) => {
      const idn = names.get(String(s.investorId).trim());
      const identity = identities.get(String(s.investorId).trim());
      const identityName = identity ? lpInviteDisplayName(identity) : null;
      /* `resolveDisplayNames` always returns a renderable `name`, but when it
       * resolved nothing that name is a PLACEHOLDER ("Pending member"). A
       * placeholder must never beat a real name the operator typed, so the
       * register wins whenever the resolver did not actually resolve. */
      const resolvedName = idn?.resolved ? idn.name : null;
      return {
        investorId: s.investorId,
        name: resolvedName ?? identityName ?? idn?.name ?? null,
        email: idn?.email ?? identity?.email ?? null,
        commitmentMinor: s.commitmentMinor,
        status: s.status,
        ownershipPct: total > 0 && s.status !== "withdrawn" ? s.commitmentMinor / total : 0,
        /* WAVE 161 · ITEM A (A20) — stage words and BOTH denominators, per row. */
        stage: s.status,
        stageLabel: spvSubscriptionStageLabelForRegister(s.status),
        isConfirmedCapital: s.status === "committed",
        /* WAVE 182 · ITEM B · R152.3 — a SEPARATE fact from `isConfirmedCapital`,
           which means "committed on the register". This one means "the general
           partner has confirmed the funds were received". Conflating them is how
           the roster came to say the same word for both. */
        fundsConfirmed: fundsConfirmedInvestorIds.has(String(s.investorId).trim()),
        ownershipPctOfAllStages:
          total > 0 && s.status !== "withdrawn" ? s.commitmentMinor / total : 0,
        ownershipPctOfConfirmedCapital:
          s.status === "committed"
            ? rosterSplit.confirmedCapitalMinor > 0
              ? s.commitmentMinor / rosterSplit.confirmedCapitalMinor
              : 0
            : null,
      };
    });
    /* An identity row whose LP is already on the roster above is NOT repeated
     * here: they are one limited partner, and listing them twice is the defect
     * this wave exists to remove. Nothing is lost — the subscriber entry now
     * carries their name, email, amount and status. */
    const seatedInvestorIds = new Set(
      subs.filter((s) => s.status !== "withdrawn").map((s) => String(s.investorId).trim()),
    );
    /* ═══ WAVE 112 · FINDING 3 — A COMMITMENT CANNOT RENDER WITHOUT ITS
     * LEDGER ENTRY. ═══
     *
     * THE LIE (OPEN_ITEMS B-38, Reviewer B). The lp-commit route writes the LP
     * identity row (status `committed`) BEFORE the sacred cap-table ledger
     * entry, across two stores with no shared transaction. If the ledger write
     * failed, the row still said `committed` and this read printed `committed`
     * straight out of the register — an LP presented as committed while holding
     * $0. It fails SAFELY for accounting (the money genuinely is not there) but
     * it is a lie on a screen, and a GP chasing a wire that was never asked for
     * is a real cost.
     *
     * WHY THE READER AND NOT A ROLLBACK. `commitFunded` lives in the SACRED
     * captableCommitStore with its own transaction; `spv_lp_invite` is a
     * separate rawDb write. A true transaction across both is NOT AVAILABLE
     * within this wave’s scope, and inventing a rollback the storage layer
     * cannot honour would be worse than the defect. So the READ becomes the
     * invariant: this route will not call an LP committed unless it can see the
     * ledger entry under the deterministic id the writer used
     * (`lpCommitInvitationId`, the ONE derivation both sides share).
     *
     * FAIL CLOSED. The ledger is read ONCE for the whole roster, and if that
     * read throws, EVERY unseated invite is reported unconfirmed rather than
     * optimistically committed — an unreadable ledger is not evidence that
     * money exists.
     *
     * NOT A DEMOTION OF REAL LPs. An LP whose commitment did land is already in
     * `subscribers` above (this list is only the UNSEATED remainder), so the
     * honest path cannot hide a genuine commitment; a w112_ test pins that
     * positive case alongside the negative one. */
    let ledgerInvitationIds: Set<string> | null = null;
    try {
      ledgerInvitationIds = new Set(getLedger().map((e) => String(e.invitationId)));
    } catch {
      ledgerInvitationIds = null;
    }
    const invites = listLpInvites(partnerId, spvId)
      .filter((i) => !seatedInvestorIds.has(lpInvestorIdForEmail(i.email)))
      .map((i) => {
        const claimsCommitted = i.status === "committed";
        const hasLedgerEntry =
          ledgerInvitationIds !== null &&
          ledgerInvitationIds.has(lpCommitInvitationId(spvId, i.email));
        const unconfirmed = claimsCommitted && !hasLedgerEntry;
        return {
          id: i.id,
          email: i.email,
          firstName: i.firstName,
          lastName: i.lastName,
          note: i.note,
          /* The truthful pre-commit state, not the claim the row carries. */
          status: unconfirmed ? "invited" : i.status,
          createdAt: i.createdAt,
          /* Additive disclosure: the register says `committed`, the ledger has
           * no entry, so this is a half-state and not a commitment. Present
           * only when that is actually the case, so an ordinary invited LP is
           * not decorated with a field about a failure that never happened. */
          ...(unconfirmed ? { commitmentUnconfirmed: true as const } : {}),
        };
      });
    return {
      spvId,
      lpVisibility: spv.lpVisibility,
      subscribers,
      invites,
      /* WAVE 161 · ITEM A (A21) — the split, and the words for each
         denominator, so the screen can say which population it divided by
         instead of leaving the GP to assume. */
      split: rosterSplit,
      splitStatement: spvStageSplitStatement(rosterSplit),
      denominatorBasis: "all_stages" as const,
      denominatorLabel: SPV_REGISTER_OWNERSHIP_DENOMINATOR_LABEL,
      confirmedDenominatorLabel: SPV_CONFIRMED_CAPITAL_DENOMINATOR_LABEL,
      basisNote: SPV_REGISTER_ALL_STAGES_BASIS,
    };
}

export function registerSpvEngineRoutes(app: Express): void {
  /* ── wizard bootstrap: defaults-over-inputs + carry-basis help ─────────── */
  app.get("/api/partner/me/spv-wizard/defaults", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    // Pull GP identity/org/tier/jurisdiction from the partner profile so the
    // wizard is defaults-over-inputs. Prior-SPV settings offered for Clone.
    const priorSpvs = spvEngineStore.listByPartner(ctx.partnerId);
    res.json({
      gp: { partnerId: ctx.partnerId, gpUserId: ctx.userId, name: ctx.name, tier: ctx.tier },
      enums: {
        jurisdictions: SPV_JURISDICTIONS,
        carryBases: SPV_CARRY_BASES,
        distributionScopes: SPV_DISTRIBUTION_SCOPES,
        spvTypes: SPV_TYPES,
      },
      carryBasisHelp: SPV_CARRY_BASIS_HELP,
      clonableSpvs: priorSpvs.map((s) => ({ id: s.id, name: s.name, jurisdiction: s.jurisdiction, carryBasis: s.carryBasis })),
    });
  });

  /* ── SPV CRUD ──────────────────────────────────────────────────────────── */
  app.get("/api/partner/me/spv", requirePartnerAuth, (req: Request, res: Response) => {
    const partnerId = req.partnerContext!.partnerId;
    const spvs = spvEngineStore.listByPartner(partnerId);
    /* ════════════════════════════════════════════════════════════════
       WAVE 182 · ITEM C · R152.4(4) — THE CARD NEEDS A FACT IT NEVER HAD.
       ════════════════════════════════════════════════════════════════
       The list card renders `carryBasis` and reads it aloud as though it meant a
       carry is charged. Whether one IS charged lives in `spv_fee`, which is not on
       `SpvDTO` and is not being added to it — widening the SACRED-adjacent SPV DTO
       to carry fee state would put a fee fact into every SPV reader in the platform.

       A SEPARATE, ADDITIVE ARRAY INSTEAD. `spvs` is byte-for-byte the same payload
       it was, so every existing reader of this route is untouched; `carryConfigurations`
       is a new sibling key that a reader either uses or ignores. It is keyed by
       `spvId` rather than positional, so it cannot be mis-zipped if the list order
       ever changes.

       NO MONEY AND NO PERCENTAGE crosses this boundary — only a state and a
       sentence. An unconfigured carry and a 0% carry are different facts, and this
       route is not permitted to blur them by shipping a number. */
    res.json({
      spvs,
      carryConfigurations: spvs.map((s) => ({
        spvId: s.id,
        ...spvEngineStore.carryConfiguration(partnerId, s.id),
      })),
    });
  });

  app.post("/api/partner/me/spv", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const ctx = req.partnerContext!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Preserve the original untyped payload for createSpv (its typed param is
      // satisfied by the store's own validation, as before this change).
      // WAVE 5 / P-4 — normalise terms.hurdleRatePct from PERCENT-AS-WRITTEN to
      // a FRACTION at the route boundary, BEFORE it reaches createSpv and is
      // persisted into the terms blob. The wizard
      // (client/src/pages/partner/PartnerSpvEngine.tsx:257, field labelled
      // "Hurdle %" with placeholder "e.g. 8") posts the number 8 for an 8%
      // hurdle; unconverted it hit Math.min(1, n) in spvOfflineOps and became a
      // 100% preferred return. Out-of-domain values now REJECT (400) instead of
      // clamping. This route and the PATCH below are the only two paths on which
      // a client-supplied terms blob reaches the store.
      const createBody = { ...((req.body ?? {}) as Record<string, unknown>) };
      if ("terms" in createBody) createBody.terms = normaliseSpvTermsHurdle(createBody.terms);
      /* WAVE 82 · ITEM 2 — bound the GP commitment at the same boundary. */
      if ("terms" in createBody) assertGpCommitInDomain(createBody.terms);
      // 1c — a full launch sign-off is REQUIRED before an SPV can be created.
      // The signer must type their full legal name AND explicitly accept the
      // versioned attestation. Identity of record is the SESSION user, never a
      // client-supplied id. Missing/invalid sign-off => 400 (no SPV created).
      /* ══ WAVE 86B · ITEM 2 — VALIDATE THE WHOLE LAUNCH BEFORE CREATING ANYTHING ══
         An attested vehicle is a signed ESIGN/UETA legal artefact. It must never
         exist beside an incomplete set of economic terms. This endpoint used to
         record the sign-off and create the vehicle knowing NOTHING about fee
         terms, because the fee payload arrived on a later call — so a caller
         driving the three-call sequence directly could be refused at the fee
         write and leave an attested vehicle with no fee terms behind. Wave 82
         closed that in the WIZARD; the API is a first-class surface and stayed
         open (reviewer 2, executed).

         ROLLING BACK IS NOT AVAILABLE AND IS FENCED — the store has no delete,
         the sign-off store has no void, `lint:destructive-store-fence` exists to
         keep destructive store paths unreachable, and the in-memory caches beside
         SQLite would not roll back with a DB transaction. So the payload is
         validated IN FULL, FIRST, on the pure validators in `spvEngineStore`
         (the same rules the sinks run, lifted verbatim), and a refusal writes
         NOTHING: no sign-off, no vehicle, no mandate, no fee.

         ADDITIVE AND OPTIONAL. `fees` is NOT required: absent keys behave exactly
         as before, so every existing caller is unaffected. Owner decision, on the
         record: expressing "a vehicle needs fee terms" in the type system would
         break 47 call sites, which risks more than it protects. The legacy
         three-call sequence therefore stays open and is reported as open —
         `server/__tests__/w82_spv_launch_atomicity.test.ts` asserts it. */
      const feeDrafts = Array.isArray(body.fees)
        ? (body.fees as Array<Record<string, unknown>>)
        : null;
      const mandateDraft = (body.mandate && typeof body.mandate === "object" && !Array.isArray(body.mandate))
        ? (body.mandate as Record<string, unknown>)
        : null;

      const signoffLegalName = typeof body.signoffLegalName === "string" ? body.signoffLegalName.trim() : "";
      const signoffAccepted = body.signoffAccepted === true;
      if (!signoffLegalName) {
        return res.status(400).json({ error: "SIGNOFF_LEGAL_NAME_REQUIRED" });
      }
      if (!signoffAccepted) {
        return res.status(400).json({ error: "SIGNOFF_ATTESTATION_REQUIRED" });
      }
      // 1c FAIL-CLOSED (per GPT-5.5 review): record the durable sign-off BEFORE
      // creating the SPV. recordSignoff THROWS on a durable-persist failure, so
      // if the sign-off cannot be recorded we return 500 and NO SPV is ever
      // created — an SPV can never exist without its authorization record. The
      // signer sub-role comes from the session context field `partnerSubRole`.
      /* WAVE 86B · ITEM 2 — THE PRE-FLIGHT. Everything above this line is a read
         or a validation; `recordSignoff` below is the FIRST WRITE. A throw here
         reaches `err()` and becomes the SAME status code the later call would
         have returned (400 for every fee/mandate refusal, 403 for
         PLATFORM_FEE_ADMIN_ONLY), with nothing written. */
      if (feeDrafts) {
        spvEngineStore.validateLaunchFeeDrafts(
          ctx.partnerId,
          feeDrafts as unknown as Parameters<typeof spvEngineStore.validateLaunchFeeDrafts>[1],
          typeof createBody.targetRaiseMinor === "number" ? createBody.targetRaiseMinor : null,
        );
      }
      if (mandateDraft) {
        spvEngineStore.validateMandateDraft(mandateDraft as Parameters<typeof spvEngineStore.validateMandateDraft>[0]);
      }

      /* ══ WAVE 179 · ITEM A · R151.1 — THE TARGET-COMPANY FENCE ══════════════
         "A partner must never attribute an SPV to a client they do not manage."

         `targetCompanyId` has been persisted end-to-end since the canonical engine
         shipped (column `db/connection.ts:5200`, written in `persistSpv`, read back
         in the row mapper, rendered on the SPV detail surface). NOTHING VALIDATED
         IT. The wizard field is a free-text company identifier, so partner A could
         post partner B's managed client and the platform would persist and display
         that vehicle as targeting it.

         Placed here deliberately: this is still the PRE-FLIGHT, above the first
         write (`recordSignoff`), so a refusal leaves no sign-off, no vehicle, no
         mandate and no fee — the same fail-closed contract wave 86B established
         for the fee/mandate validation immediately above.

         The predicate is the SIX-PROOF `partnerHasCompanyRelationship`, the same
         function `partnerRoutes.ts`'s portfolio routes now call — not a second copy
         of it. Absent/blank stays ALLOWED: this fences attribution, it does not
         make attribution mandatory. 404, not 403, so the route cannot be used as
         an existence oracle for other partners' companies. */
      const targetGate = partnerMayAttributeSpvToCompany(ctx.partnerId, createBody.targetCompanyId);
      if (!targetGate.ok) {
        return res.status(404).json({
          error: SPV_TARGET_COMPANY_NOT_YOURS,
          message: SPV_TARGET_COMPANY_NOT_YOURS_MESSAGE,
        });
      }
      /* Normalised in place so the store receives the value the fence APPROVED
         (trimmed, or `null` for the no-target case) rather than the raw body. */
      createBody.targetCompanyId = targetGate.companyId;

      let signoff;
      try {
        signoff = recordSignoff({
          partnerId: ctx.partnerId,
          spvId: "", // linked to the real id below once the SPV exists
          userId: ctx.userId,
          signerLegalName: signoffLegalName,
          signerSubRole: ctx.partnerSubRole ?? null,
          /* WAVE 169 · R77 — the RECORDED sentence must name the vehicle the
             partner chose. The type comes from the SAME `createBody` the store is
             about to create the vehicle from (never a second read of `req.body`),
             so the attested wording and the persisted `spv_type` cannot disagree.
             Absent or unreadable → `resolveAttestation` defaults to the v1
             single-deal wording, which is what this path always recorded. */
          spvType: typeof createBody.spvType === "string" ? createBody.spvType : null,
          ip: resolveRateLimitClientIp(req), /* WAVE 22 · ITEM 2 — trusted-hop resolution, never the raw header */
          userAgent: (req.headers["user-agent"] as string) ?? null,
        });
      } catch {
        return res.status(500).json({ error: "SIGNOFF_PERSIST_FAILED" });
      }
      // Sign-off is now durably recorded; create the SPV and link the two.
      // The cast restores the pre-P-4 typing exactly: `req.body` was passed here
      // untyped and validated by the store. Spreading it to normalise `terms`
      // widened the static type to Record<string, unknown>, nothing more — the
      // runtime payload and the store's own validation are unchanged.
      const spv = spvEngineStore.createSpv(ctx.partnerId, createBody as Parameters<typeof spvEngineStore.createSpv>[1], ctx.userId);
      linkSignoffToSpv(signoff.id, spv.id);
      /* WAVE 86B · ITEM 2 — the mandate and the fees, already proved valid above.
         They can still be refused by the sinks (the SPV-scoped combined-carry cap
         and the fee-exceeds-raise guard read the vehicle that now exists), but
         every refusal a caller can provoke from the PAYLOAD has already fired,
         above the first write. */
      if (mandateDraft) {
        spvEngineStore.setMandate(
          ctx.partnerId, spv.id,
          mandateDraft as Parameters<typeof spvEngineStore.setMandate>[2],
          ctx.userId,
        );
      }
      const fees = feeDrafts
        ? feeDrafts.map((d) => spvEngineStore.addFee(
            ctx.partnerId, spv.id,
            d as Parameters<typeof spvEngineStore.addFee>[2],
            ctx.userId,
          ))
        : [];
      /* ══ WAVE 179 · ITEM B · R151.3 — the OPTIONAL legal form, at creation ═══
         Written AFTER the vehicle exists because it is an annotation ON a vehicle,
         and validated against the jurisdiction the store actually persisted (never
         against whatever the request claimed), so the two can never disagree.

         AN ABSENT KEY IS THE NORMAL CASE and must remain completely inert: with no
         `legalForm` in the body, `resolveSpvLegalForm` returns null, the column is
         written NULL — which is what `ALTER TABLE` already gave it — and every tax
         surface renders wave 175's wording byte-for-byte as before. NOTHING IS
         INFERRED from the vehicle's jurisdiction, name or type.

         Not fatal if it cannot be stored: an unconverged database returns what a
         later read would truthfully say rather than claiming a form was recorded. */
      const legalForm = setSpvLegalForm(spv.id, spv.jurisdiction, createBody.legalForm);
      /* ADDITIVE. Nothing above was removed, renamed or reordered — `spv` and
         `signoff` keep their names, their shapes and their position. */
      res.status(201).json({
        spv,
        signoff: { id: signoff.id, signedAt: signoff.signedAt, attestationVersion: signoff.attestationVersion },
        fees,
        launchComplete: feeDrafts !== null && feeDrafts.length > 0,
        legalForm,
      });
    } catch (e) { err(res, e); }
  });

  // 1c — read the recorded launch sign-off(s) for an SPV (verifiability).
  // Partner-scoped by the session partnerId; a cross-partner spvId returns 404.
  app.get("/api/partner/me/spv/:spvId/signoffs", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const spv = spvEngineStore.getSpv(pid, String(req.params.spvId));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    res.json({ signoffs: listSignoffsForSpv(pid, spv.id) });
  });

  app.get("/api/partner/me/spv/:spvId", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const spv = spvEngineStore.getSpv(pid, String(req.params.spvId));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    res.json({
      spv,
      mandate: spvEngineStore.getMandate(pid, spv.id),
      fees: spvEngineStore.listFees(pid, spv.id),
      // D3/SPV-BUG-5 — the effective management + platform carry %, pulled live
      // from the fee config (DB-driven, admin-set for the platform layer) so the
      // GP sees the real platform-fee % read-only wherever carry is shown.
      feeSummary: spvEngineStore.feeBreakdown(spv.id, 0, spv.currency),
      subscriptions: spvEngineStore.listSubscriptions(pid, spv.id),
      deployments: spvEngineStore.listDeployments(pid, spv.id),
      distributions: spvEngineStore.listDistributions(pid, spv.id),
      documents: spvEngineStore.listDocuments(pid, spv.id),
      register: spvEngineStore.investorRegister(pid, spv.id),
      /* WAVE 161 · ITEM A (A17) — `register` is UNCHANGED (same rows, same order,
         plus additive per-row stage fields). `registerSplit` is the new answer to
         "of the amounts in that register, how much is actually capital?", which no
         consumer could previously compute without re-deriving the predicate. */
      registerSplit: spvEngineStore.investorRegisterWithSplit(pid, spv.id),
      // W-FIX1f — surface the built-but-hidden capabilities in the tabbed detail:
      // secondary transfers, minimal capital accounts (D10), and the close summary.
      transfers: spvEngineStore.listTransfers(pid, spv.id),
      capitalAccounts: spvEngineStore.capitalAccounts(pid, spv.id),
      closeSummary: spvEngineStore.closeSummary(pid, spv.id),
      /* WAVE 179 · ITEM B · R151.3 — ADDITIVE, and `null` for every vehicle that
         has not been told. Read from `spv.legal_form` through its own store, and
         validated against THIS vehicle's recorded jurisdiction on the way out, so a
         value that does not belong to the jurisdiction reads as not stated rather
         than as a tax position. No existing key above changes shape. */
      legalForm: getSpvLegalForm(spv.id),
    });
  });

  /* ══ WAVE 179 · ITEM B · R151.3 — STATE THE LEGAL FORM LATER ══════════════
     R151.3 requires the field on SPV creation AND in SPV settings "so it can be
     set later". This is the settings half.

     A SEPARATE ROUTE RATHER THAN A KEY ON THE PATCH ABOVE, on purpose: that PATCH
     goes to `spvEngineStore.updateSpv`, which rewrites the vehicle row, merges the
     `terms` blob one level deep and re-anchors the audit hash. An optional
     annotation has no business travelling through the vehicle's own write path, and
     routing it there would put every legal-form edit inside the merge contract that
     protects `_fundsConfirmations`.

     WRITE-GATED IDENTICALLY to the PATCH above (`WRITE_ROLES` + signed agreement),
     and partner-scoped by `getSpv`, which returns null for another partner's
     vehicle — so a GP cannot annotate a vehicle they do not sponsor.

     CLEARING IS SUPPORTED. `legalForm: null` (or any value that does not validate
     for this vehicle's jurisdiction) returns the vehicle to NOT STATED, and the tax
     surfaces then render wave 175's conditional wording exactly as they do today.
     A GP who states the wrong form must be able to take it back. */
  app.patch(
    "/api/partner/me/spv/:spvId/legal-form",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      try {
        const pid = req.partnerContext!.partnerId;
        const spv = spvEngineStore.getSpv(pid, String(req.params.spvId));
        if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
        /* The jurisdiction is read from the PERSISTED vehicle, never from the
           request. A caller cannot widen the option set by claiming a different
           jurisdiction than the one the vehicle records. */
        const legalForm = setSpvLegalForm(spv.id, spv.jurisdiction, (req.body ?? {}).legalForm);
        res.json({ spvId: spv.id, legalForm });
      } catch (e) { err(res, e); }
    },
  );

  app.patch("/api/partner/me/spv/:spvId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      // WAVE 5 / P-4 — SECOND PATH to the same persisted terms blob. The POST
      // above is not the only writer; a GP can edit the hurdle after creation
      // through this PATCH. Both are normalised, or the defect simply moves.
      const patchBody = { ...((req.body ?? {}) as Record<string, unknown>) };
      if ("terms" in patchBody) patchBody.terms = normaliseSpvTermsHurdle(patchBody.terms);
      /* WAVE 82 · ITEM 2 — bound the GP commitment at the same boundary. */
      if ("terms" in patchBody) assertGpCommitInDomain(patchBody.terms);
      /* WAVE 193 · ITEM B · R165.4 — REFUSE A CHANGE THIS ROUTE WOULD DROP.

         `updateSpv` assigns nine fields and silently ignores every other key,
         and this handler then answered `200 { spv }` with the UNCHANGED vehicle.
         A general partner correcting the vehicle's currency, its carry basis, its
         jurisdiction, its type or its target company was told the correction had
         been saved, and it had not been. The store's refusal to write was
         correct; reporting it as a success was not.

         Asserted BEFORE `updateSpv`, so a refused request changes nothing at all.
         See `lib/spvVehiclePatchApplicability.ts` for why this is an accept-list
         rather than a `currency` special case, and for the enumeration of callers
         proving no existing caller sends an unapplied key. */
      assertSpvPatchFullyApplied(patchBody);
      const spv = spvEngineStore.updateSpv(req.partnerContext!.partnerId, String(req.params.spvId), patchBody, req.partnerContext!.userId);
      res.json({ spv });
    } catch (e) { err(res, e); }
  });

  app.post("/api/partner/me/spv/:spvId/wind-down", requirePartnerAuth, assertSubRole("managing_partner"), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.json({ spv: spvEngineStore.archiveSpv(req.partnerContext!.partnerId, String(req.params.spvId), req.partnerContext!.userId) });
    } catch (e) { err(res, e); }
  });

  /* ── mandate + eligibility ─────────────────────────────────────────────── */
  app.put("/api/partner/me/spv/:spvId/mandate", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.json({ mandate: spvEngineStore.setMandate(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}, req.partnerContext!.userId) });
    } catch (e) { err(res, e); }
  });

  app.get("/api/partner/me/spv/:spvId/eligibility/:companyId", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    if (!spvEngineStore.getSpv(pid, String(req.params.spvId))) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    res.json(spvEngineStore.isCompanyEligible(pid, String(req.params.spvId), String(req.params.companyId)));
  });

  app.post("/api/partner/me/spv/:spvId/eligibility/evaluate", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    if (!spvEngineStore.getSpv(pid, String(req.params.spvId))) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    const companyIds: string[] = Array.isArray((req.body ?? {}).companyIds) ? req.body.companyIds : [];
    res.json({ eligible: spvEngineStore.evaluateEligibleCompanies(pid, String(req.params.spvId), companyIds) });
  });

  /* ── fees (management = GP; platform = admin-only) ─────────────────────── */
  app.post("/api/partner/me/spv/:spvId/fees", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      if (body.layer === "platform") return res.status(403).json({ error: "PLATFORM_FEE_ADMIN_ONLY" });
      res.status(201).json({ fee: spvEngineStore.addFee(req.partnerContext!.partnerId, String(req.params.spvId), body, req.partnerContext!.userId) });
    } catch (e) { err(res, e); }
  });

  app.get("/api/partner/me/spv/:spvId/fee-breakdown", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const spv = spvEngineStore.getSpv(pid, String(req.params.spvId));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    /* ══════════════════════════════════════════════════════════════════════
       WAVE 127 · FINDING 2 — THIS ROUTE NO LONGER INVENTS A COMMITMENT.
       ══════════════════════════════════════════════════════════════════════
       WHAT THIS LINE USED TO BE:

           const commitmentMinor = Number(req.query.commitmentMinor ?? spv.minCheckMinor ?? 0);

       TWO DEFECTS ON ONE LINE, and the first was visible on production.

       (1) `?? spv.minCheckMinor` — when the client sent no parameter (which the
           fee panel did whenever its "model a commitment" box was empty) the
           server SUBSTITUTED THE VEHICLE'S MINIMUM CHEQUE SIZE and returned a
           complete, arithmetically-correct breakdown of an amount nobody had
           entered. On the live site Test SPV modelled $484.47 (min_check_minor
           48447) and QUantum SPV modelled $100.00 (min_check_minor 10000)
           against verifiably empty inputs. The arithmetic was never wrong; the
           INPUT was fabricated, which is worse than a hardcoded placeholder
           because real code was running on a question nobody asked. A minimum
           cheque size is a MANDATE TERM, not a commitment, and the two are not
           interchangeable on a money surface.

       (2) `Number()` applied to money. It accepts exponent notation ("1e7" is
           read as 10,000,000), accepts decimals into a minor-unit field, and
           yields NaN on junk rather than refusing.

       BOTH ARE CLOSED HERE, AT SOURCE, rather than only in the one client that
       happened to expose them — a client-side guard alone would leave the next
       caller free to be lied to in exactly the same way. The parameter is now
       REQUIRED and strictly parsed: digits only, safe integer. Absent or
       malformed is a 400 naming what is missing, never a substituted amount.

       BLAST RADIUS, CHECKED RATHER THAN ASSUMED. The only other producer of a
       breakdown is the SPV detail route above, which calls the STORE directly
       with an explicit 0 and does not come through here. No route is added or
       removed, so the route-count guard is unmoved. */
    const rawCommitment = req.query.commitmentMinor;
    /* Deliberately NOT trimmed. Measured while writing the tests: with a
       `.trim()` the string " 100" was accepted, and silently repairing a
       malformed money parameter is the same class of helpfulness that produced
       this defect. The client sends URL-encoded digits; anything else is a bug
       in the caller and is told so. */
    const commitmentText = typeof rawCommitment === "string" ? rawCommitment : "";
    if (!/^\d+$/.test(commitmentText)) {
      return res.status(400).json({
        error: "COMMITMENT_MINOR_REQUIRED",
        message:
          "Provide commitmentMinor as a whole number of minor units to model. This endpoint does not " +
          "substitute an amount you did not supply — a fee breakdown of an unstated commitment is not an answer.",
      });
    }
    const commitmentMinor = Number(commitmentText);
    if (!Number.isSafeInteger(commitmentMinor)) {
      return res.status(400).json({
        error: "COMMITMENT_MINOR_OUT_OF_RANGE",
        message: "commitmentMinor is larger than can be represented exactly and is refused rather than rounded.",
      });
    }
    res.json({ breakdown: spvEngineStore.feeBreakdown(spv.id, commitmentMinor, spv.currency) });
  });

  /* ── fee obligations (money-movement-safe fee timing, Blocker 3) ───────── */
  app.get("/api/partner/me/spv/:spvId/fee-obligations", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    if (!spvEngineStore.getSpv(pid, String(req.params.spvId))) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    res.json({ obligations: spvEngineStore.listFeeObligations(pid, String(req.params.spvId)) });
  });

  /* WAVE 1A / S-2 — SINK 1 CLOSED (was `:256`, `const outcome = (req.body ?? {}).outcome …`).
   *
   * The request body is NEVER READ on this route. There is no `outcome`
   * parameter, no default, and no enum value a partner can send that reaches
   * `state = "paid"`. The only settlement a partner can attempt is a REAL one,
   * through the gateway — and `authorizeGatewaySettlement` throws
   * `PAYMENT_GATEWAY_UNAVAILABLE` (503) until a gateway is wired, because there
   * is none in this call graph (paymentGatewayAdapter.ts is sacred and
   * unintegrated; paymentStore.ts:127 defaults `forceState` to "demo").
   *
   * Deliberately NOT hardcoded to `"succeeded"` here — that was Review A's exact
   * finding against v7 (a hardcoded literal at `:257` passed all four v7 ACs and
   * left the hole wide open). Note this route is partner-gated, NOT admin-gated;
   * the admin settlement path is a separate route below. */
  app.post("/api/partner/me/spv/:spvId/fee-obligations/:obId/charge", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const pid = req.partnerContext!.partnerId;
      const spvId = String(req.params.spvId);
      const obId = String(req.params.obId);
      const ob = spvEngineStore.listFeeObligations(pid, spvId).find((o) => o.id === obId);
      if (!ob) return res.status(404).json({ error: "FEE_OBLIGATION_NOT_FOUND" });
      // Throws PAYMENT_GATEWAY_UNAVAILABLE today. When Airwallex lands, this call
      // returns an authorization derived from the gateway's answer — not the body.
      const settlement = authorizeGatewaySettlement({
        purpose: "fee_obligation", spvId, obligationId: obId,
        amountMinor: ob.amountMinor, currency: ob.currency, customerId: pid,
      });
      res.json({ obligation: spvEngineStore.chargeFeeObligation(pid, spvId, obId, pid, settlement) });
    } catch (e) { err(res, e); }
  });

  /* WAVE 1A / S-2 — the ADMIN-ONLY settlement path (ASSUMPTION A-1).
   *
   * Closing S-2 makes `paid` unreachable until a gateway exists, which aborts
   * every carry-bearing distribution via the fail-closed `_collectCarryObligation`
   * and jams `hasUnsettledFixedFees` at spvEngineStore.ts:695. v6 shipped exactly
   * that and was rejected for removing the only settlement outcome. This route
   * restores a REAL settlement outcome for a Capavate platform admin
   * (`tenant_admin_capavate`) and for nobody else. A partner session never
   * carries `isAdmin`, so no partner role can reach it. */
  app.post("/api/admin/consortium-spv/:spvId/fee-obligations/:obId/settle", (req: Request, res: Response) => {
    try {
      const spvId = String(req.params.spvId);
      const spv = spvEngineStore.adminListAll().find((s) => s.id === spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const obId = String(req.params.obId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Throws ADMIN_REQUIRED (403) for every non-platform-admin caller.
      const settlement = authorizePlatformAdminSettlement(req, {
        purpose: "fee_obligation", spvId, obligationId: obId,
        outcome: body.outcome, reason: body.reason,
      });
      res.json({
        obligation: spvEngineStore.chargeFeeObligation(spv.sponsorPartnerId, spvId, obId, spv.sponsorPartnerId, settlement),
      });
    } catch (e) { err(res, e); }
  });

  // Admin-only waive — clears the fail-closed fixed-fee block on this SPV.
  app.post("/api/admin/consortium-spv/:spvId/fee-obligations/:obId/waive", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    try {
      const spvId = String(req.params.spvId);
      const spv = spvEngineStore.adminListAll().find((s) => s.id === spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const ob = spvEngineStore.waiveFeeObligation(spv.sponsorPartnerId, spvId, String(req.params.obId), ctx.userId, String((req.body ?? {}).reason ?? ""));
      res.json({ obligation: ob });
    } catch (e) { err(res, e); }
  });

  /* ══════════════════════════════════════════════════════════════════════════
     WAVE 166 · BATCH 3 ITEM D · PATH 1 · R131.1 — THE TWO CONTROLS THE OWNER'S
     MODEL NEEDS AND THE PLATFORM DID NOT HAVE.
     ══════════════════════════════════════════════════════════════════════════
     The owner's model, verbatim: "invitation to soft-circle so that the LPs can
     review the deal and soft-circle. The GP will confirm the investment when the
     LP signs the proper subscription docs and the funds are in the bank account
     (OFFLINE process)."

     What existed before this wave: the STATES (`soft_circled`, `founder_confirmed`
     in `shared/spvEngine.ts`), the ladder (`advanceSubscription`), and the label.
     What did NOT exist: any way for an LP to soft-circle, and any act by which a
     GP states the two offline facts. A GP could only PATCH the row themselves —
     so "the LP soft-circled" was something a GP asserted on the LP's behalf, and
     "the GP confirmed" was a status assignment with nothing behind it.

     Two routes, in the two voices they belong to. Note the FIRST is on the
     INVESTOR side: it is the LP's own act, taken from the LP's own session, and
     putting it behind `requirePartnerAuth` would have reproduced the bug.
     ══════════════════════════════════════════════════════════════════════════ */

  /* ── LP: I have reviewed this deal and I am soft-circling. ─────────────────
     THIS IS NOT CAPITAL, AND THE ROUTE IS BUILT SO IT CANNOT BECOME CAPITAL:
     the only status it can ever write is `soft_circled`, it takes NO amount from
     the body (the amount is whatever the subscription already says), and it
     cannot reach `committed` because `advanceSubscription`'s legality map has no
     `soft_circled → committed` edge that skips the affirmation gate.
     Wave 161 fenced every aggregation and wave 163 fixed the LP roster; this
     route relies on both and undoes neither. */
  app.post("/api/investor/me/spv/:spvId/subscriptions/:subId/soft-circle", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      const spvId = String(req.params.spvId);
      const subId = String(req.params.subId);
      const spv = spvEngineStore.adminListAll().find((x) => x.id === spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      /* FAIL CLOSED ON IDENTITY. An LP may only soft-circle THEIR OWN
         subscription, and "their own" is resolved through wave 166's alias set
         (D-4) so that a direct-added LP who has since registered is recognised.
         The subscription id from the URL is checked AGAINST that set rather than
         trusted: without this, any authenticated user could soft-circle any
         subscription in any vehicle by guessing an id. */
      const sub = spvEngineStore
        .listSubscriptions(spv.sponsorPartnerId, spvId)
        .find((x) => x.id === subId);
      if (!sub) return res.status(404).json({ error: "SUBSCRIPTION_NOT_FOUND" });
      if (!viewerInvestorIds(ctx.userId).includes(sub.investorId)) {
        return res.status(403).json({ error: "NOT_AN_LP" });
      }
      const updated = spvEngineStore.advanceSubscription(
        spv.sponsorPartnerId,
        spvId,
        subId,
        "soft_circled",
      );
      res.json({
        subscription: updated,
        /* The words ship WITH the act, so no client can render this as a
           commitment by omission. Same sentence the register already uses. */
        stageLabel: spvSubscriptionStageLabelForRegister(updated.status),
        notCapitalNotice:
          "A soft-circle records your interest. It is not a commitment, and no funds are due. " +
          "Your GP will confirm the investment only after your subscription documents are signed " +
          "and your funds have been received.",
      });
    } catch (e) { err(res, e); }
  });

  /* ── GP: I affirm BOTH offline conditions, and I am committing this LP. ────
     ONE request, TWO explicit affirmations, and the stage change happens only
     after the affirmation is durably recorded. Never inferred, never automatic. */
  app.post("/api/partner/me/spv/:spvId/subscriptions/:subId/gp-confirm", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const spvId = String(req.params.spvId);
      const subId = String(req.params.subId);
      const partnerId = req.partnerContext!.partnerId;
      /* RECORD FIRST, ADVANCE SECOND. If this throws, nothing moved and the GP
         gets `GP_OFFLINE_CONFIRMATION_INCOMPLETE` with its sentence. If it
         succeeds and the advance then fails, we are left with an affirmation and
         no commitment — which is the safe direction: a recorded statement with no
         money movement, rather than moved money with no statement of why. */
      const confirmation = spvEngineStore.recordGpOfflineConfirmation(partnerId, spvId, subId, {
        documentsSigned: body.documentsSigned,
        fundsReceived: body.fundsReceived,
        actorId: req.partnerContext!.userId,
      });
      /* The e-sign / KYC / accreditation / fee gates on `committed` are the
         PRE-EXISTING R105 gates and this route does not relax any of them — the
         dual affirmation is an ADDITIONAL condition, never a substitute. The
         document reference is forwarded because "the documents are signed" and
         "here is the signed document" are the same statement, and refusing to
         carry it would force the GP to make the same claim twice. */
      const updated = spvEngineStore.advanceSubscription(partnerId, spvId, subId, "committed", {
        subscriptionDocRef:
          typeof body.subscriptionDocRef === "string" ? body.subscriptionDocRef : undefined,
      });
      res.json({
        subscription: updated,
        confirmation,
        stageLabel: spvSubscriptionStageLabelForRegister(updated.status),
      });
    } catch (e) { err(res, e); }
  });

  /* ── subscriptions (unified flow + 3 gates) ────────────────────────────── */
  app.post("/api/partner/me/spv/:spvId/subscriptions", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.status(201).json({ subscription: spvEngineStore.subscribe(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}, req.partnerContext!.userId) });
    } catch (e) { err(res, e); }
  });

  app.patch("/api/partner/me/spv/:spvId/subscriptions/:subId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      /* ══════════════════════════════════════════════════════════════════════
         WAVE 162 · BATCH 3 ITEM B (B-1) — THE BOUNDARY CHECK, AND IT LANDS
         BEFORE THE STORE IS CALLED AT ALL.
         ══════════════════════════════════════════════════════════════════════
         WHAT WAS HERE. `body.to` went straight into `advanceSubscription` with no
         zod schema and no enum check, and the store assigned it onto the row. Two
         measured consequences:

           1. An ARBITRARY STRING persisted as a subscription status, into a
              hash-chained status column. A row reading "committedd" is neither
              `committed` nor `withdrawn`, so it silently joined every all-stages
              basis while being invisible to every committed-only one.
           2. `body` is forwarded WHOLESALE as the `data` argument, so a JSON
              STRING reached `wiredMinor` untyped.

         WHY VALIDATE HERE WHEN THE STORE ALSO VALIDATES. Because they answer
         different questions and the spec requires both (B-1). The store's check
         is the one that cannot be bypassed by a caller that never touches an HTTP
         body. THIS check is the one that makes the refusal a clean 400 carrying a
         sentence a person can read, instead of a 500 raised from inside a store
         — and `err()` above now maps the store's codes as well, so a caller that
         reaches the store by another route lands on the same words.

         NOTHING IS COERCED. A `to` of the wrong type is refused, not `String()`d;
         a `wiredMinor` of the wrong type is refused, not `Number()`d. Coercing at
         a boundary is how a string became a money value in the first place.

         `message` is the boundary-safe headline — `queryClient.ts:60-65` discards
         any server message of 240 characters or more, and
         `PartnerSpvDetail.tsx:267/:314` render `e.message` RAW, so a bare code
         here would put an enum on a GP's screen (R77). `guidance` carries the
         unabridged sentence. Neither is ever the code.
         ══════════════════════════════════════════════════════════════════════ */
      const to: unknown = body.to;
      if (to === undefined || to === null || to === "") {
        return res.status(400).json({
          error: "SUBSCRIPTION_STATUS_REQUIRED",
          message: spvSubscriptionRefusalHeadline("SUBSCRIPTION_STATUS_REQUIRED") ?? undefined,
          guidance: spvSubscriptionRefusalCopy("SUBSCRIPTION_STATUS_REQUIRED") ?? undefined,
          fieldError: "to",
        });
      }
      if (!isSpvSubscriptionStatus(to)) {
        return res.status(400).json({
          error: `INVALID_SUBSCRIPTION_STATUS:${typeof to}:${String(to).slice(0, 40)}`,
          message: spvSubscriptionRefusalHeadline("INVALID_SUBSCRIPTION_STATUS") ?? undefined,
          guidance: spvSubscriptionRefusalCopy("INVALID_SUBSCRIPTION_STATUS") ?? undefined,
          fieldError: "to",
        });
      }
      if (body.wiredMinor !== undefined && !isSpvMoneyMinor(body.wiredMinor)) {
        return res.status(400).json({
          error: `INVALID_WIRED_MINOR:${typeof body.wiredMinor}:${String(body.wiredMinor).slice(0, 40)}`,
          message: spvSubscriptionRefusalHeadline("INVALID_WIRED_MINOR") ?? undefined,
          guidance: spvSubscriptionRefusalCopy("INVALID_WIRED_MINOR") ?? undefined,
          fieldError: "wiredMinor",
        });
      }
      res.json({ subscription: spvEngineStore.advanceSubscription(req.partnerContext!.partnerId, String(req.params.spvId), String(req.params.subId), to, body) });
    } catch (e) { err(res, e); }
  });

  /* ── compliance profile (reusable, investor-level) ─────────────────────── */
  app.get("/api/partner/me/compliance/:investorId", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      // W1 C1 — IDOR guard: prove the investor belongs to this partner BEFORE any read.
      const ctx = req.partnerContext!;
      const investorId = String(req.params.investorId);
      if (!spvEngineStore.partnerCanAccessInvestorCompliance(ctx.partnerId, investorId)) {
        return res.status(403).json({
          error: "INVESTOR_NOT_RELATED_TO_PARTNER",
          message: "Investor is not related to this partner workspace.",
        });
      }
      res.json({
        profile: spvEngineStore.getComplianceProfile(investorId),
        gates: spvEngineStore.gateStatus(investorId),
      });
    } catch (e) { err(res, e); }
  });

  app.put("/api/partner/me/compliance/:investorId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      // W1 C2 — IDOR guard BEFORE any write, then strict body validation.
      const ctx = req.partnerContext!;
      const investorId = String(req.params.investorId);
      if (!spvEngineStore.partnerCanAccessInvestorCompliance(ctx.partnerId, investorId)) {
        return res.status(403).json({
          error: "INVESTOR_NOT_RELATED_TO_PARTNER",
          message: "Investor is not related to this partner workspace.",
        });
      }
      const parsed = investorComplianceProfilePatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: "INVALID_COMPLIANCE_PROFILE_PATCH",
          issues: parsed.error.flatten(),
        });
      }
      /* WAVE 227 / ITEM 1 — G6's writer fence, BEFORE the write.
         This route is the only HTTP path that can put `self_certified` or
         `verified` on `investor_compliance_profile` without a signed declaration
         behind it, and until now it accepted `{"accreditationStatus":"verified"}`
         with no jurisdiction at all — which unlocked the cap-table funding gate
         and the Collective gates on the strength of one global tick. R189.5:
         the accreditation tests are mutually incompatible across jurisdictions,
         so "no global checkbox is possible". The refusal itself lives with the one
         accreditation mechanism (`investorComplianceRoutes`) and uses that
         mechanism's own nine-code registry — no second mechanism is created here.
         Refuses BEFORE `upsertComplianceProfile`, so a refused patch writes
         nothing, not even the kyc fields. */
      const w227Refusal = accreditationAssertionRefusal(
        parsed.data,
        spvEngineStore.getComplianceProfile(investorId)?.jurisdiction ?? null,
      );
      if (w227Refusal) {
        return res.status(w227Refusal.status).json(w227Refusal.payload);
      }
      res.json({ profile: spvEngineStore.upsertComplianceProfile(investorId, parsed.data) });
    } catch (e) { err(res, e); }
  });

  /* ── deployment (single cap-table ledger line) ─────────────────────────── */
  app.post("/api/partner/me/spv/:spvId/deployments", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.status(201).json({ deployment: spvEngineStore.createDeployment(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}) });
    } catch (e) { err(res, e); }
  });

  app.patch("/api/partner/me/spv/:spvId/deployments/:depId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const b = (req.body ?? {}) as { to?: string; wirePaymentRef?: string | null; closingDocRef?: string | null };
      const to = b.to;
      res.json({
        deployment: spvEngineStore.advanceDeployment(
          req.partnerContext!.partnerId, String(req.params.spvId), String(req.params.depId),
          to as "founder_confirmed" | "docs_sent" | "wired",
          { wirePaymentRef: b.wirePaymentRef, closingDocRef: b.closingDocRef },
        ),
      });
    } catch (e) { err(res, e); }
  });

  /* Final deployment: write the ONE cap-table ledger line via the sacred path. */
  app.post("/api/partner/me/spv/:spvId/deployments/:depId/commit", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const spvId = String(req.params.spvId);
    const depId = String(req.params.depId);
    const spv = spvEngineStore.getSpv(pid, spvId);
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    const dep = spvEngineStore.listDeployments(pid, spvId).find((d) => d.id === depId);
    if (!dep) return res.status(404).json({ error: "DEPLOYMENT_NOT_FOUND" });

    // Blocker 2 — FAIL CLOSED before the sacred cap-table ledger write. The
    // single ledger line may ONLY be committed once the deployment is fully
    // through its money-movement lifecycle: founder-confirmed, investor-wired,
    // status===wired, required closing docs on file, fixed fee obligations
    // settled — and never a SECOND time (idempotent per deployment).
    if (dep.capTableLedgerRef) return res.status(409).json({ error: "ALREADY_COMMITTED" });
    if (dep.status !== "wired") return res.status(409).json({ error: "DEPLOYMENT_NOT_WIRED" });
    if (!dep.founderConfirmedAt) return res.status(409).json({ error: "FOUNDER_NOT_CONFIRMED" });
    if (!dep.wiredAt) return res.status(409).json({ error: "NOT_WIRED" });
    // Blocker 2 (4D): a persisted REAL payment ref is MANDATORY before the ledger
    // write — a mere `wired` status/timestamp is not funding proof (fail-closed).
    if (!dep.wirePaymentRef) return res.status(409).json({ error: "WIRE_PAYMENT_REF_REQUIRED" });
    if (spvEngineStore.listDocuments(pid, spvId).length === 0) return res.status(409).json({ error: "DOCS_REQUIRED" });
    if (spvEngineStore.hasUnsettledFixedFees(pid, spvId)) return res.status(409).json({ error: "FEES_UNPAID" });

    const shares = String((req.body ?? {}).shares ?? "");
    if (!/^-?\d+$/.test(shares)) return res.status(400).json({ error: "INVALID_SHARES" });

    // SINGLE ledger line — SPV is the single investor of record. Founder never
    // sees the LP list; the ledger shows the SPV entity id as the investor.
    const result = commitFunded({
      invitationId: `spvdep_${dep.id}`, // deterministic → idempotent per deployment
      roundId: dep.companyRoundId,
      companyId: dep.companyId,
      investorId: spv.id,
      // CP-SPV-31 sink 4: the deployment's own currency, never an assumed 2dp.
      amount: minorToDecimal(dep.amountMinor, dep.currency),
      currency: dep.currency,
      shares,
    });
    if (!result.ok) return res.status(409).json({ error: "LEDGER_COMMIT_FAILED", detail: result.error });
    const deployment = spvEngineStore.markDeployed(pid, spvId, depId, result.entry.hash, shares);
    res.json({ deployment, ledger: { hash: result.entry.hash, seq: result.entry.seq } });
  });

  /* ── distributions / waterfall ─────────────────────────────────────────── */
  /* WAVE 1A / S-2 — SINK 2 CLOSED (was `req.body ?? {}` forwarded WHOLESALE into
   * recordDistribution, whose `data.collectionOutcome` at spvEngineStore.ts:1456
   * reached `_collectCarryObligation:793` → `chargeFeeObligation` → `paid`).
   *
   * The body is now WHITELISTED to four fields by a `.strict()` schema, so no
   * settlement key survives — and even if one did, `recordDistribution` no longer
   * reads a settlement outcome out of `data` at all: the authorization is a
   * separate argument this route never supplies. A partner-initiated distribution
   * with non-zero carry therefore aborts fail-closed with
   * SETTLEMENT_AUTHORIZATION_REQUIRED (403) and writes no distribution row. */
  app.post("/api/partner/me/spv/:spvId/distributions", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      assertNoSmuggledSettlement(req.body);
      /* ══ WAVE 211 · ITEM A · D1/D2 — THE MONEY GATE, BEFORE THE APPEND-ONLY WRITE.
       * The owner's audit called this "the most severe unguarded action on the
       * platform": the screen states that a distribution cannot be edited or deleted
       * once recorded, and then required nothing at all. It now requires a typed full
       * legal name, three confirmations from draft 03, and the basis of the underlying
       * determination — SERVER-ENFORCED, not a disabled button.
       * The pre-flight runs BEFORE `recordDistribution`, so a refusal leaves no row,
       * no fee obligation and no hash-chain entry behind. Everything above this line
       * is a pure read or a whitelist. */
      const w211Ctx = req.partnerContext!;
      const w211SpvId = String(req.params.spvId);
      const w211Spv = spvEngineStore.getSpv(w211Ctx.partnerId, w211SpvId);
      const w211Body = (req.body ?? {}) as Record<string, unknown>;
      const w211Picked = pickDistributionBody(req.body) as Record<string, unknown>;
      const w211Gate = wave211Preflight(req, {
        slot: "distribution",
        vehicleName: w211Spv?.name ?? null,
        currency: typeof w211Picked.currency === "string" ? w211Picked.currency : (w211Spv?.currency ?? null),
        facts: {
          kind: "money_event",
          eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
          vehicleName: w211Spv?.name ?? null,
          eventType: typeof w211Picked.event === "string" ? w211Picked.event : null,
          /* The route carries the amount in the currency's smallest units. It is
             restated in those units and LABELLED as such — never divided to make a
             prettier sentence, and never defaulted to zero when absent (R-ASSERT). */
          amountRaw:
            typeof w211Picked.grossProceedsMinor === "string" || typeof w211Picked.grossProceedsMinor === "number"
              ? w211Picked.grossProceedsMinor
              : null,
          amountUnit: "minor",
          currency: typeof w211Picked.currency === "string" ? w211Picked.currency : (w211Spv?.currency ?? null),
          eventDate: typeof w211Body.distributedAt === "string" ? w211Body.distributedAt : null,
        },
      });
      if (!w211Gate.ok) {
        res.status(w211Gate.refusal.status).json(w211Gate.refusal.payload);
        return;
      }
      const distribution = spvEngineStore.recordDistribution(w211Ctx.partnerId, w211SpvId, pickDistributionBody(req.body), w211Ctx.userId);
      /* ITEM B — the attestation is recorded against the row it signs, and the
         request is refused if it cannot be recorded. An unattested distribution is
         never reported as recorded. The row is NOT deleted on failure (R195.5): it is
         visibly unattested rather than silently attested. */
      const w211Rec = wave211RecordAfter({
        rowId: String((distribution as { id?: unknown })?.id ?? ""),
        accepted: w211Gate.accepted,
        signedBy: String(w211Ctx.userId ?? ""),
        vehicleName: w211Spv?.name ?? null,
      });
      wave211AuditAttestation({
        actor: String(w211Ctx.userId ?? ""),
        partnerId: w211Ctx.partnerId,
        spvId: w211SpvId,
        slot: "distribution",
        rowId: String((distribution as { id?: unknown })?.id ?? ""),
        outcome: w211Rec,
        accepted: w211Gate.accepted,
      });
      if (!w211Rec.ok) {
        res.status(w211Rec.refusal.status).json(w211Rec.refusal.payload);
        return;
      }
      res.status(201).json({ distribution });
    } catch (e) { err(res, e); }
  });

  /* WAVE 1A / S-2 — ADMIN-ONLY carry-bearing distribution (ASSUMPTION A-1).
   *
   * Keeps distributions operable and testable before Airwallex lands. Same body
   * whitelist; the settlement outcome is minted from the ADMIN's session, never
   * from the body's `collectionOutcome` (that key is stripped by `.strict()`). */
  app.post("/api/admin/consortium-spv/:spvId/distributions", (req: Request, res: Response) => {
    try {
      const spvId = String(req.params.spvId);
      const spv = spvEngineStore.adminListAll().find((s) => s.id === spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const raw = (req.body ?? {}) as Record<string, unknown>;
      assertNoSmuggledSettlement(raw);
      // The admin states the outcome under its own explicit key, and it is minted
      // into an authorization only after `isPlatformAdmin` passes. It is NEVER a
      // field of the object handed to `recordDistribution`.
      const settlement = authorizePlatformAdminSettlement(req, {
        purpose: "distribution_carry", spvId, outcome: raw.settlementOutcome, reason: raw.settlementReason,
      });
      res.status(201).json({
        distribution: spvEngineStore.recordDistribution(spv.sponsorPartnerId, spvId, pickDistributionBody(raw), getUserContext(req).userId, settlement),
      });
    } catch (e) { err(res, e); }
  });

  /* ── W-FIX1e SPV offline core (SPV-CORE-1/2/3) ─────────────────────────────
     Offline-first GP actions. NONE of these move money or block: the LP's
     authoritative seat is the sacred commitFunded ledger line (written at the
     lp-commit route). A funds mismatch is an EDUCATIONAL flag; an under-target
     close proceeds anyway; a rolling reopen is gated only by the close window. */

  // SPV-CORE-1 — record an offline LP wire confirmation (mismatch never blocks).
  app.post("/api/partner/me/spv/:spvId/subscriptions/:investorId/confirm-funds", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      const conf = spvEngineStore.confirmFundsReceived(
        req.partnerContext!.partnerId,
        String(req.params.spvId),
        String(req.params.investorId),
        Number(b.receivedMinor),
        typeof b.reference === "string" ? b.reference : null,
        req.partnerContext!.userId,
      );
      res.status(201).json({ confirmation: conf });
    } catch (e) { err(res, e); }
  });

  // SPV-CORE-2 — minimal per-LP capital accounts (committed / confirmed / distributed).
  app.get("/api/partner/me/spv/:spvId/capital-accounts", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      res.json({ rows: spvEngineStore.capitalAccounts(req.partnerContext!.partnerId, String(req.params.spvId)) });
    } catch (e) { err(res, e); }
  });

  // SPV-CORE-2 — OFFLINE distribution preview (does NOT persist or move money).
  app.post("/api/partner/me/spv/:spvId/distributions/preview", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      const partnerId = req.partnerContext!.partnerId;
      const spvId = String(req.params.spvId);
      /* WAVE 14 / P-7 — `undefined`, NOT `null`, when the caller says nothing.
         `?? null` here would have defeated the store-side default: null is an
         explicit "no hurdle" and would suppress the SPV's own agreed term. */
      const explicitHurdle =
        b.hurdleRatePct === null || b.hurdleRatePct === undefined || b.hurdleRatePct === "" ? undefined : b.hurdleRatePct;
      const stored = spvEngineStore.storedHurdleFraction(partnerId, spvId);
      const split = spvEngineStore.previewDistributionSplit(partnerId, spvId, {
        grossProceedsMinor: Number(b.grossProceedsMinor),
        hurdleRatePct: explicitHurdle as number | null | undefined,
        gpCatchUpPct: b.gpCatchUpPct ?? null,
      });
      /* The preview now SAYS which hurdle it used and where it came from, so a
         GP can see that the SPV's agreed term was applied rather than guessing
         from the tier amounts. */
      res.json({
        split,
        hurdleUsed: {
          fraction: explicitHurdle !== undefined ? Number(explicitHurdle) : stored.fraction,
          source: explicitHurdle !== undefined ? "request" : stored.source,
          termsAsWritten: stored.asWritten,
        },
      });
    } catch (e) { err(res, e); }
  });

  /* WAVE 14 / P-7 — the READ that makes `terms.hurdleRatePct` reachable from
     the UI. Before this, the only way to learn an SPV's agreed hurdle was to
     read the raw terms blob, which no client did — so the launch wizard's Hurdle
     field was write-only. Read-only route; it persists nothing. */
  app.get("/api/partner/me/spv/:spvId/hurdle", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      res.json({ hurdle: spvEngineStore.storedHurdleFraction(req.partnerContext!.partnerId, String(req.params.spvId)) });
    } catch (e) { err(res, e); }
  });

  // SPV-CORE-3 — close summary (under-target flagged, never blocks).
  app.get("/api/partner/me/spv/:spvId/close-summary", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      res.json({ summary: spvEngineStore.closeSummary(req.partnerContext!.partnerId, String(req.params.spvId)) });
    } catch (e) { err(res, e); }
  });

  /* WAVE 25 / FE-3 — the resolved rolling-close policy, so the UI can RENDER
     the real window (and render the fail-closed state) instead of printing a
     literal 30 it invented client-side. */
  app.get("/api/partner/me/spv/:spvId/close-window", requirePartnerAuth, (req: Request, res: Response) => {
    try {
      res.json({ closeWindow: resolveCloseWindowDays({
        spvId: String(req.params.spvId),
        partnerId: req.partnerContext!.partnerId,
      }) });
    } catch (e) { err(res, e); }
  });

  // SPV-CORE-3 — close to new LPs (proceeds even under target; optional set-target=raised).
  app.post("/api/partner/me/spv/:spvId/close", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      const out = spvEngineStore.closeToNewLps(req.partnerContext!.partnerId, String(req.params.spvId), req.partnerContext!.userId, {
        setTargetToRaised: b.setTargetToRaised === true,
        closeDate: typeof b.closeDate === "string" ? b.closeDate : undefined,
      });
      res.json(out);
    } catch (e) { err(res, e); }
  });

  // SPV-CORE-3 — reopen for a rolling close (gated by the close window).
  app.post("/api/partner/me/spv/:spvId/reopen", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      /* WAVE 25 / FE-3. The window is DB policy, resolved spv → partner →
       * platform. It is NOT a literal and it is NOT client-chosen: a caller
       * that supplies a `windowDays` disagreeing with policy gets a LOUD 400
       * rather than a silently-ignored field. Equal is accepted so an existing
       * client that echoes the resolved value keeps working. A missing policy
       * row THROWS (503) — it never quietly restores 30. */
      const policy = resolveCloseWindowDays({
        spvId: String(req.params.spvId),
        partnerId: req.partnerContext!.partnerId,
      });
      if (b.windowDays !== undefined && b.windowDays !== null) {
        const asked = Number(b.windowDays);
        if (!Number.isFinite(asked) || asked !== policy.windowDays) throw new Error("INVALID_CLOSE_WINDOW");
      }
      const spv = spvEngineStore.reopenForRollingClose(req.partnerContext!.partnerId, String(req.params.spvId), policy.windowDays, req.partnerContext!.userId);
      res.json({ spv, closeWindow: policy });
    } catch (e) { err(res, e); }
  });

  /* ── documents ─────────────────────────────────────────────────────────── */
  app.post("/api/partner/me/spv/:spvId/documents", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.status(201).json({ document: spvEngineStore.addDocument(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}, req.partnerContext!.userId) });
    } catch (e) { err(res, e); }
  });

  /* ── secondary transfers (MODEL now) ───────────────────────────────────── */
  app.post("/api/partner/me/spv/:spvId/transfers", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.status(201).json({ transfer: spvEngineStore.createTransfer(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}, req.partnerContext!.userId) });
    } catch (e) { err(res, e); }
  });

  /* ── LP co-investor roster (investor context, FAIL-CLOSED) ──────────────
     Phase-4B / decision #5. The requesting investor's identity comes from the
     SESSION (getUserContext), never a client-supplied param. The store gates
     on subscriber membership (only an LP of this SPV gets a roster — the
     founder/target NEVER does) and omits co-investors server-side unless the
     GP set lp_visibility='co_investors'. */
  app.get("/api/spv/:spvId/lp-roster", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    try {
      res.json(spvEngineStore.lpRosterForViewer(String(req.params.spvId), ctx.userId));
    } catch (e) { err(res, e); }
  });

  /* ── W2-H — GP (partner) LP roster (FAIL-CLOSED, requirePartnerAuth) ────────
     Distinct from the investor-context /api/spv/:spvId/lp-roster above (which
     is gated on subscriber membership for an LP viewer and left intact). This
     partner route is scoped to req.partnerContext.partnerId (session, never
     URL); getSpv returns null cross-partner → 404, so no existence leak. The
     GP sees EVERY LP of their own SPV — both live subscribers (with resolved
     display names, never a raw "u_..." id) and pending email invites. */
  app.get(
    "/api/partner/me/spv/:spvId/lp-roster",
    requirePartnerAuth,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const spvId = String(req.params.spvId);
      const spv = spvEngineStore.getSpv(ctx.partnerId, spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      /* WAVE 179 · ITEM C · R151.2 — the body of this handler now lives in
         `buildPartnerLpRosterPayload` above, unchanged, so the CSV export cannot
         drift from this screen. The response shape is identical. */
      res.json(buildPartnerLpRosterPayload(ctx.partnerId, spvId, spv));
    },
  );

  /* ── W2-H — GP (partner) LP invite (WRITE, sub-role gated). Rule #13: last
     name is MANDATORY. Fail-closed: store throws LP_INVITE_* which err() maps
     to 400.

     B5 — an LP onboards exactly like a cap-table (round) investor: after the
     GP-display invite persists, ALSO fire the shared createInvitation()
     (roundInvitationsStore) with companyId=spv.id and a synthetic per-SPV
     roundId, mirroring the founder backfill. That makes the LP's redeem =
     register = the SAME flow round investors use. This second call is
     ADDITIVE and DECOUPLED: a pre-existing active invite (duplicate_invitation)
     or any transport hiccup must NOT fail the GP invite (best-effort). */
  app.post(
    "/api/partner/me/spv/:spvId/lp-invites",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    async (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const spvId = String(req.params.spvId);
      const spv = spvEngineStore.getSpv(ctx.partnerId, spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
      const body = req.body ?? {};
      /* ══ WAVE 211 · ITEM A · draft 04 Part A — INVITING AN LP IS A REAL STEP.
       * It was unguarded: no eligibility step, no consent, no disclosure. It now
       * requires a typed full legal name and draft 04 A6's three confirmations, with
       * A2's statement that eligibility is the partner's determination and that the
       * platform does not verify anything about this person (R188.5), and §4 of the
       * signed Consortium Partner Agreement QUOTED rather than paraphrased.
       * NO global "I am accredited" tick is offered, because five jurisdictions'
       * definitions are mutually incompatible and one excludes individuals entirely.
       * The nine-jurisdiction accreditation component is REFERENCED; wave 215 owns
       * correcting and wiring it, and no second mechanism is created here.
       * Placed before `createLpInvite`, so a refusal leaves no invite row. */
      const w211InviteGate = wave211Preflight(req, {
        slot: "lp_invitation",
        vehicleName: spv.name,
        facts: {
          kind: "lp_invitation",
          /* NULL, DELIBERATELY, AND ON BOTH SIDES. R187.3 requires the stored text to
             be the text SHOWN. The partner client payload carries no registered
             organisation name, so resolving one here would store a sentence the
             partner never read. Both sides therefore pass null and the shared builder
             renders the second-person attribution — which still says, in full, that
             the invitation is the firm's and not Capavate's. See
             `W211_PARTNER_SELF_REFERENCE`. */
          partnerName: null,
          vehicleName: spv.name,
          inviteeEmail: typeof body.email === "string" ? body.email : null,
        },
      });
      if (!w211InviteGate.ok) {
        return res.status(w211InviteGate.refusal.status).json(w211InviteGate.refusal.payload);
      }
      let invite;
      try {
        invite = createLpInvite(
          ctx.partnerId,
          spvId,
          {
            email: body.email, firstName: body.firstName, lastName: body.lastName, note: body.note,
            /* WAVE 166 · ITEM D (Path 2) · R131.2 — the GP states WHERE this LP
               came from. Forwarded UNCOERCED: `createLpInvite` refuses an
               unrecognised value rather than filing it as `direct`, and absent
               means `direct`, which is what every pre-wave-166 caller was doing. */
            origin: body.origin,
          },
          ctx.userId,
        );
      } catch (e) { return err(res, e); }

      // B5 — shared platform-registration invite (redeem link IS register).
      let inviteEmailSent = false;
      try {
        const result = await createInvitation({
          roundId: `spvlp_${spv.id}`,
          companyId: spv.id,
          investorEmail: invite.email,
          investorFirstName: invite.firstName,
          investorLastName: invite.lastName,
          invitedByUserId: ctx.userId,
        });
        inviteEmailSent = !!result.emailSent;
      } catch {
        // best-effort: duplicate_invitation / transport hiccup never fails the
        // GP-side LP invite (the row above is authoritative for GP display).
      }
      /* ══ WAVE 186 · ITEM B · R159.1 — THE LP INVITATION IS NOW AUDITED ═════
       * The second writer wave 181 deferred (W181_BUILD.md §5.1). An invitation
       * is identity-bearing: it grants a named outsider access to a private
       * vehicle's subscription flow, and until now the only trace was the invite
       * row itself, which the GP can delete. Actor is the authenticated partner
       * user. Placed after the invite row is durable and before the response;
       * does not refuse the invitation on audit failure (W186_BUILD.md §3). */
      auditSpvLpInvited({
        partnerId: ctx.partnerId,
        spvId,
        investorEmail: invite.email,
        inviteId: invite.id ?? null,
        actor: String(ctx.userId ?? ""),
      });
      /* WAVE 211 · ITEM B — the confirmation is recorded against the invite row it
         signs. The invitation is not reported as sent unless the confirmation is
         stored and reads back identically. The row is NOT deleted on failure
         (R195.5); it is visibly unattested. */
      const w211InviteRec = wave211RecordAfter({
        rowId: String(invite.id ?? ""),
        accepted: w211InviteGate.accepted,
        signedBy: String(ctx.userId ?? ""),
        vehicleName: spv.name,
      });
      wave211AuditAttestation({
        actor: String(ctx.userId ?? ""),
        partnerId: ctx.partnerId,
        spvId,
        slot: "lp_invitation",
        rowId: String(invite.id ?? ""),
        outcome: w211InviteRec,
        accepted: w211InviteGate.accepted,
      });
      if (!w211InviteRec.ok) {
        return res.status(w211InviteRec.refusal.status).json(w211InviteRec.refusal.payload);
      }
      res.status(201).json({ invite, inviteEmailSent });
    },
  );

  /* ── B3 — SPV detail = SPV cap table + LP commit (CORE).
     Modeled LINE-FOR-LINE on the founder backfill (founderOpsRoutes.ts:146):
     seat a named LP onto the SPV's cap table by calling the SACRED commitFunded
     UNCHANGED with companyId=spv.id (an SPV IS a company in the entity-agnostic
     ledger). The partner gate (requirePartnerAuth + getSpv ownership → 404
     cross-partner BEFORE any write) SUBSTITUTES the founder-owns-company gate.
     Deterministic keys make it idempotent; a synthetic price-less roundId avoids
     reconcile()'s price coupling. After the authoritative ledger write, the
     subscription roster is advanced to `committed` as a PROJECTION. */
  app.post(
    "/api/partner/me/spv/:spvId/lp-commit",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const spvId = String(req.params.spvId);
      // Ownership gate FIRST — cross-partner id yields 404 (no existence leak),
      // BEFORE any ledger read/write (fail-closed).
      const spv = spvEngineStore.getSpv(ctx.partnerId, spvId);
      if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });

      const body = (req.body ?? {}) as Record<string, unknown>;
      const holderFirstName = typeof body.holderFirstName === "string" ? body.holderFirstName.trim() : "";
      const holderLastName = typeof body.holderLastName === "string" ? body.holderLastName.trim() : "";
      const investorEmailRaw = typeof body.investorEmail === "string" ? body.investorEmail.trim() : "";
      const investorEmail = investorEmailRaw.toLowerCase();
      const amount = typeof body.amount === "string" ? body.amount.trim()
        : (typeof body.amount === "number" ? String(body.amount) : "");
      const shares = typeof body.shares === "string" ? body.shares.trim()
        : (typeof body.shares === "number" ? String(body.shares) : "");
      const currency = typeof body.currency === "string" && body.currency.trim()
        ? body.currency.trim() : spv.currency;

      if (!amount || !shares) {
        return res.status(400).json({ error: "COMMIT_FIELDS_REQUIRED", message: "amount and shares (units) are required." });
      }
      // Rule #13 — never seat an LP without a full legal name.
      if (!holderFirstName || !holderLastName) {
        return res.status(400).json({ error: "MISSING_HOLDER_NAME", message: "Both first and last name are required for the LP." });
      }
      if (!investorEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(investorEmail)) {
        return res.status(400).json({ error: "INVALID_EMAIL", message: "A valid LP email is required." });
      }

      /* ── WAVE 33 / CP-SPV-31 · SINK 1 ─────────────────────────────────────
       * WAS, immediately below the ledger commit:
       *
       *     const amountMinor = Math.round(Number(amount) * 100);
       *     ... commitmentMinor: Number.isFinite(amountMinor) ? amountMinor : 0
       *
       * TWO defects, and the second is the dangerous one.
       *
       * (1) HARDCODED EXPONENT 2. `spv.currency` is free-form and JPY vehicles
       *     exist. A ¥250,000 commitment was projected as 25,000,000 minor
       *     units — 100x. `decimalStringToMinor`'s own doc comment names this
       *     exact expression as forbidden. It is not cosmetic: the projected
       *     figure feeds `committedRegister`, which is the numerator of the
       *     deployment coverage gate at spvEngineStore.ts:1600
       *     (`INSUFFICIENT_COMMITTED_CAPITAL`). A 100x-inflated commitment
       *     therefore authorises a GP to deploy up to 100x the capital the LPs
       *     actually committed, into a real company round, through the sacred
       *     ledger. That is the P0.
       *
       * (2) THE CONVERSION RAN AFTER THE LEDGER WRITE, and a non-finite result
       *     was coerced to `0` rather than refused. So an amount this platform
       *     cannot represent produced a committed LEDGER ENTRY paired with a
       *     ZERO commitment on the roster — money charged with nothing
       *     recording it, the same shape as the carry-before-distribution
       *     defect. Silence, not an error.
       *
       * The conversion is now performed HERE, BEFORE any ledger write, and a
       * value the currency cannot represent is REFUSED (400) rather than
       * rounded or zeroed. Nothing is committed that cannot then be recorded.
       */
      let amountMinorExact: bigint;
      try {
        amountMinorExact = decimalStringToMinor(amount, currency, "amount");
      } catch {
        return res.status(400).json({
          error: "INVALID_AMOUNT",
          message:
            `The amount ${amount} cannot be represented exactly in ${currency}. ` +
            "Nothing has been committed. Enter an amount with no more decimal places than this currency allows.",
        });
      }
      if (amountMinorExact <= BigInt(0)) {
        return res.status(400).json({
          error: "INVALID_AMOUNT",
          message: "A commitment must be a positive amount. Nothing has been committed.",
        });
      }
      // The roster projection carries `number`. Refuse rather than lose precision
      // silently at the boundary — an amount past 2^53 minor units is not a
      // rounding problem, it is an unrepresentable one.
      if (amountMinorExact > BigInt(Number.MAX_SAFE_INTEGER)) {
        return res.status(400).json({
          error: "AMOUNT_TOO_LARGE",
          message: "This amount is too large to record exactly. Nothing has been committed.",
        });
      }
      const amountMinor = Number(amountMinorExact);

      /* ═══════════════════════════════════════════════════════════════════════
         WAVE 182 · ITEM A · R152 — A CLOSED VEHICLE DOES NOT TAKE NEW CAPITAL,
         AND IT REFUSES BEFORE IT WRITES ANYTHING.
         ═══════════════════════════════════════════════════════════════════════
         THE DEFECT, AS REPRODUCED ON LIVE. An SPV was moved Open → Closed (the
         toast "Closed to new LPs" was shown and the close was reported to its
         limited partners), and an LP was then committed $50,000 through THIS route
         from the "Commit an LP to the cap table" form. It succeeded with no refusal
         and no warning, and the close statement recomputed from 1 LP / $400,000 to
         2 LPs / $450,000 AFTER the close.

         WHY THE GATE IS HERE, AT THIS EXACT LINE, AND NOT HIGHER OR LOWER.
           · Everything above it is a PURE READ or a pure parse: the ownership
             lookup, the field validation, and `decimalStringToMinor`. So a refusal
             here can truthfully say nothing was saved.
           · Everything below it WRITES. `recordLpCommitIdentity` (next block) puts
             a row in the LP identity register, and `commitFunded` after it writes
             the SACRED cap-table ledger line. Refusing after either one would leave
             an identity, or a ledger entry, for a commitment that was rejected —
             the half-state this file already fights at WAVE 112 · FINDING 3.
           · It needs `amountMinor`, which is why it is not at the top: the rule
             distinguishes an INCREASE from an equal-or-lower idempotent replay, and
             that cannot be decided before the amount has been parsed exactly.

         THE STORE IS GATED TOO (`projectLpCommitted` calls the same shared assert).
         This is not belt-and-braces for its own sake: this gate protects the SACRED
         ledger write ordering, and that one is the floor no future caller of the
         store can walk around. A disabled button on the form is neither.

         `investorId` is derived by the SAME pure derivation used below
         (`lpInvestorIdForEmail`) — recomputed rather than moved, so this block adds
         no reordering to the identity/ledger sequence that follows it. NOT gated:
         confirming funds on an LP who committed before the close, which is
         settlement and a different route entirely. */
      /* Caught and routed through `err()` explicitly, because this handler has no
         outer try/catch: an uncaught throw here would reach Express's default
         handler and answer a 500 with an HTML page, so the general partner would
         see a server failure instead of the refusal. `err()` maps this error to 409
         WITH its sentence. */
      try {
        assertSpvOpenToNewCapital({
          spvStatus: spv.status,
          spvName: spv.name,
          subs: spvEngineStore.listSubscriptions(ctx.partnerId, spvId),
          investorId: lpInvestorIdForEmail(investorEmail),
          requestedMinor: amountMinor,
        });
        /* WAVE 189 · ITEM C · R159.6 — and the vehicle must be ATTESTED before an LP
           can be committed to it. Here for the same reason the close gate is here
           and not only in the store: this is the route that writes the SACRED ledger
           line, and the refusal has to land BEFORE that write, not after it, or the
           platform is left holding a ledger entry for a vehicle nobody signed for —
           exactly the half-state this handler already fights. The store is gated too
           (`projectLpCommitted` calls the identical assert), so the floor holds for
           any future caller that reaches the store directly. */
        assertSpvAttestedForNewCapital({
          spvId: spv.id,
          spvName: spv.name,
          kind: "limited_partner",
        });
      } catch (e) {
        return err(res, e);
      }

      /* ── WAVE 106 · FINDING 1 — WHO THIS COMMITMENT BELONGS TO ─────────────
       * The name and email above used to travel as far as the sacred ledger and
       * then vanish: the roster projection below has no field for either, so the
       * GP roster showed an anonymous "Pending member" holding the money and a
       * separate, still-"invited" row for the very same person.
       *
       * The identity is now recorded FIRST, into the SPV's LP identity register,
       * which MATCHES an already-invited LP on this SPV by trimmed,
       * case-insensitive email instead of creating a second record. Writing it
       * BEFORE the ledger means a commitment cannot come into existence unless
       * the platform knows whose it is: if this write fails, nothing is
       * committed. Nothing is guessed — a commit with no name or no usable email
       * was already refused above and still is. */
      /* ══ WAVE 211 · ITEM A · draft 04 Part B — A CAP-TABLE COMMITMENT IS NOT A
       * SOFT CIRCLE, AND THIS SCREEN NEVER SAID SO.
       * The partner types an amount and an LP appears on the cap table holding it,
       * with no statement of what that means. Draft 04 B5/B6 is now shown and
       * confirmed: what a recorded commitment is, that the figures are the partner's
       * own and are not checked, and that Capavate holds no money and moves none.
       *
       * WHY EXACTLY HERE. Everything above is a pure read or a pure parse — the
       * ownership 404, the field checks, `decimalStringToMinor`, and the two vehicle
       * asserts. `recordLpCommitIdentity` on the next line WRITES, and `commitFunded`
       * below it writes the SACRED cap-table ledger. A refusal placed here can
       * truthfully say nothing was committed; placed one line lower it could not.
       * The two vehicle asserts keep their position and their precedence: a closed or
       * unattested vehicle still refuses before this gate is ever reached, so no
       * partner is asked to sign for a commitment the vehicle would then reject. */
      const w211CommitGate = wave211Preflight(req, {
        slot: "lp_commitment",
        vehicleName: spv.name,
        currency,
        facts: {
          kind: "lp_commitment",
          /* Null on both sides, for the reason given at the invitation gate above. */
          partnerName: null,
          vehicleName: spv.name,
          investorEmail: investorEmail,
          /* The whole-unit decimal string the partner typed, restated verbatim and
             labelled as entered. `amountMinorExact` is NOT used here: showing the
             minor-unit conversion back to the person who typed "250000" would be
             showing them a figure they never entered. */
          amountRaw: amount,
          amountUnit: "as_entered",
          currency,
        },
      });
      if (!w211CommitGate.ok) {
        return res.status(w211CommitGate.refusal.status).json(w211CommitGate.refusal.payload);
      }

      let identity;
      try {
        identity = recordLpCommitIdentity(
          ctx.partnerId,
          spvId,
          { email: investorEmail, firstName: holderFirstName, lastName: holderLastName },
          String(ctx.userId ?? ""),
        );
      } catch (e) {
        const code = e instanceof Error ? e.message : "LP_IDENTITY_PERSIST_FAILED";
        if (code === "LP_IDENTITY_EMAIL_REQUIRED" || code === "LP_IDENTITY_LAST_NAME_REQUIRED") {
          return res.status(400).json({
            error: code,
            message:
              "This commitment cannot be recorded because it does not say who it belongs to. " +
              "Enter the limited partner's first name, last name and email address, then commit again. " +
              "Nothing has been committed.",
          });
        }
        return res.status(503).json({
          error: "LP_IDENTITY_PERSIST_FAILED",
          message:
            "The limited partner's details could not be saved, so nothing has been committed. " +
            "Please try again.",
        });
      }

      /* WAVE 211 · ITEM B — the confirmation is recorded against the LP identity row
         that `recordLpCommitIdentity` just returned, BEFORE the sacred ledger write.
         Sequenced this way on purpose: if the confirmation cannot be stored, no cap
         table line is created at all, so the platform never holds a cap-table
         commitment whose confirmation it cannot produce. The identity row is left in
         place (R195.5 — nothing is deleted) and is visibly unattested. */
      const w211CommitRec = wave211RecordAfter({
        rowId: String(identity.invite?.id ?? ""),
        accepted: w211CommitGate.accepted,
        signedBy: String(ctx.userId ?? ""),
        vehicleName: spv.name,
      });
      wave211AuditAttestation({
        actor: String(ctx.userId ?? ""),
        partnerId: ctx.partnerId,
        spvId,
        slot: "lp_commitment",
        rowId: String(identity.invite?.id ?? ""),
        outcome: w211CommitRec,
        accepted: w211CommitGate.accepted,
      });
      if (!w211CommitRec.ok) {
        return res.status(w211CommitRec.refusal.status).json(w211CommitRec.refusal.payload);
      }

      /* Deterministic per-LP + per-SPV keys → idempotent re-commit (no dup line).
       * WAVE 106: the investor id now comes from the SHARED derivation in
       * lib/lpIdentity, which the roster read also uses to walk back from this
       * id to the human. Two copies of this hash would let writer and reader
       * disagree, and a roster that cannot find the name is how "Pending member"
       * happened. `stableKey` is kept for the invitation id, unchanged. */
      const investorId = lpInvestorIdForEmail(investorEmail);
      const roundId = `spvlp_${spv.id}`;            // synthetic, price-less → no reconcile price coupling
      /* WAVE 112 · FINDING 3 — the invitation id now comes from the SHARED
       * derivation in lib/lpIdentity, for the same reason the investor id above
       * does. The LP-ROSTER READ has to look this ledger entry up in order to
       * refuse to render a commitment that has none (B-38); with the template
       * inline here, the reader carried a second copy of the hash and any drift
       * between them would silently make every commitment look unconfirmed.
       * `investorEmail` is already trimmed and lower-cased, and the helper applies
       * the same normal form, so every invitation id ever written is reproduced
       * byte-identically. */
      const invitationId = lpCommitInvitationId(spv.id, investorEmail);

      // Idempotency: a prior commit under this deterministic invitationId is
      // returned rather than double-writing the ledger. Ledger reads fail-closed.
      let existing;
      try {
        existing = getLedger().find((e) => e.invitationId === invitationId);
      } catch {
        return res.status(503).json({ error: "ledger_unavailable" });
      }

      let entry = existing;
      if (!existing) {
        const result = commitFunded({
          invitationId,
          roundId,
          companyId: spv.id,     // an SPV is a company in the entity-agnostic ledger
          investorId,
          amount,
          currency,
          shares,
          holderFirstName,
          holderLastName,
        });
        if (!result.ok) {
          /* ═══ WAVE 112 · FINDING 3 — THE HALF-STATE, COMPENSATED AND DISCLOSED.
           *
           * The identity row above is ALREADY `committed` at this point, and the
           * ledger entry does not exist. Nothing used to undo that, so the LP
           * rendered as committed while holding $0 (B-38). There is no
           * transaction spanning `spv_lp_invite` and the sacred cap-table ledger,
           * and one cannot be fabricated without editing a sacred money store, so
           * this is a COMPENSATING WRITE and is not presented as a rollback: it
           * demotes the row back to `invited` and may itself fail.
           *
           * The actual guarantee is on the read side — GET .../lp-roster will not
           * show an invite as `committed` without its ledger entry — so a failure
           * here cannot put a false commitment on a screen. Deliberately not
           * escalated to a 5xx: the caller’s commitment genuinely did not happen,
           * which is what this response already says. */
          revertLpCommitIdentityStatus(ctx.partnerId, spvId, investorEmail);
          const status = result.error.startsWith("compliance_hold") ? 409 : 400;
          return res.status(status).json({ error: "LEDGER_COMMIT_FAILED", detail: result.error });
        }
        entry = result.entry;
      }

      /* ══ WAVE 151 · ITEM C · R105 — CAP IMPACT, MEASURED BEFORE THE PROJECTION.
       *
       * Read-only. Computed here, BEFORE `projectLpCommitted` mutates the roster,
       * because `committedBeforeMinor` is by definition the total as it stood
       * before this commit; reading it afterwards would compare the new state with
       * itself. The overlap correction inside `computeCapImpact` is the actual
       * defect fixed by this wave — see its docblock at spvEngineStore.ts.
       *
       * R105 IS A WARN-AND-RECORD RULING, NOT A NEW GATE. Nothing below refuses
       * the commit: the sacred ledger line already exists at this point, and the
       * subscribe() cap gate (spvEngineStore.ts:1444) is untouched and unrelaxed on
       * its own path. This surfaces and records; it does not block. */
      const capImpact = computeCapImpact(spvId, investorId, amountMinor, spv.capMinor);
      /* ══ WAVE 164 · BATCH 3 ITEM C · R133.1 — THE FIVE-PART SPLIT, MEASURED HERE
       * FOR THE SAME REASON `capImpact` IS: BEFORE the projection.
       *
       * The BASIS is untouched — `computeCapImpact` above still decides the total
       * and this only LABELS what that total is made of, taking the total as an
       * input so the split can never contradict the gate. `excludeInvestorId` is
       * the committing LP because `projectLpCommitted` REPLACES their existing row
       * rather than adding to it, which is exactly the overlap `computeCapImpact`
       * corrects; excluding them keeps confirmed + soft-circled + wired + requested
       * equal to the resulting total.
       *
       * Measured BEFORE the projection so `confirmedCapitalMinor` is the confirmed
       * capital the vehicle held when the breach happened. Reading it afterwards
       * would include this very commit and the record would assert an overage
       * against capital that only exists because of the commit being recorded. */
      const capSplit = spvCapSplitFiguresForSpv({
        spvId,
        capMinor: capImpact.capMinor,
        requestedMinor: capImpact.effectiveNewCommitmentMinor,
        resultingTotalMinor: capImpact.resultingTotalMinor,
        currency,
        excludeInvestorId: investorId,
      });

      // PROJECTION — reflect the authoritative commit onto the SPV roster.
      // `amountMinor` was converted and validated ABOVE, before the ledger
      // write, so this can no longer fall back to a zero that would leave a
      // committed ledger entry unrecorded on the roster.
      let subscription;
      try {
        subscription = spvEngineStore.projectLpCommitted(ctx.partnerId, spvId, {
          investorId,
          commitmentMinor: amountMinor,
          currency,
          investorPersona: "partner",
        });
      } catch (e) { return err(res, e); }

      /* ══ WAVE 186 · ITEM B · R159.1 — THE LP COMMITMENT IS NOW AUDITED ══════
       * Wave 181 proved this gap and deferred it for one honest reason: it could
       * not resolve the acting user from where it was allowed to edit, and it
       * refused to write a MONEY row whose actor read "unresolved"
       * (W181_BUILD.md §5.1; server/lib/spvLifecycleAudit.ts rule 2). Here, in
       * the route handler, `ctx.userId` is the partner user `requirePartnerAuth`
       * already authenticated — so the row names a real person.
       *
       * PLACED EXACTLY HERE: the sacred ledger line and the roster projection
       * have both committed, so the row records something that genuinely
       * happened; and it is before the success response, so no GP is told
       * "committed" ahead of the attempt to record it. It does NOT refuse the
       * commitment if the audit write fails — the capital movement is already
       * durable and refusing now would strand it (W186_BUILD.md §3) — but the
       * failure is counted into audit-write health and surfaces on
       * /admin/audit-log instead of vanishing.
       *
       * MONEY: `amountMinorExact` is a `bigint` and crosses as a STRING. No
       * Number()/parseInt/parseFloat, no arithmetic. (`JSON.stringify` throws on
       * a bigint, so passing one would abort the very write meant to prove this.)
       * ═════════════════════════════════════════════════════════════════════ */
      auditSpvLpCommitted({
        partnerId: ctx.partnerId,
        spvId,
        investorEmail,
        holderName: `${holderFirstName} ${holderLastName}`,
        amountMinor: String(amountMinorExact),
        shares,
        currency,
        subscriptionId: subscription?.id ?? null,
        actor: String(ctx.userId ?? ""),
      });

      /* ══ WAVE 151 · ITEM C · R105(2) and R105(3) — THE RECORD.
       *
       * Written only when the cap was ACTUALLY breached, and only for a commit
       * that actually happened (`!existing`): a replayed request writes no second
       * record, so the compliance surface cannot accumulate phantom breaches for
       * an idempotent retry. A commit that stays within cap writes nothing at all.
       *
       * Both halves are best-effort AFTER the fact and neither can undo the
       * ledger line, which is why the failure is DISCLOSED in the response rather
       * than swallowed or turned into a 5xx for an operation that succeeded. */
      let capOverrideRecorded = false;
      let capOverrideRecordFailed = false;
      if (capImpact.overCap && !existing && capImpact.capMinor != null) {
        try {
          spvEngineStore.recordCapOverride(
            ctx.partnerId,
            spvId,
            {
              investorId,
              capMinor: capImpact.capMinor,
              committedBeforeMinor: capImpact.committedBeforeMinor,
              resultingTotalMinor: capImpact.resultingTotalMinor,
              overageMinor: capImpact.overageMinor,
              currency,
              /* R133.1 — the durable record carries the split, so no record can
                 assert an overage that does not exist in capital. */
              confirmedCapitalMinor: capSplit.confirmedCapitalMinor,
              softCircledInterestMinor: capSplit.softCircledInterestMinor,
              wiredNotCommittedMinor: capSplit.wiredNotCommittedMinor,
            },
            String(ctx.userId ?? ""),
          );
          capOverrideRecorded = true;
        } catch {
          capOverrideRecordFailed = true;
        }
        /* R105(2) — the durable, timestamped audit record. `audit_log` via the
           EXISTING `appendAdminAudit`; no new storage is invented. It names the
           operator, the SPV, the cap, the resulting total and the overage.

           EVERY VALUE IN THIS PAYLOAD IS A `number`. `appendAudit` does
           `JSON.stringify(payload)` (adminPlatformStore.ts:1333) and
           `JSON.stringify` THROWS a TypeError on a bigint, so a `bigint` here
           would not merely serialise oddly — it would abort the audit write
           inside the very path that exists to make this event provable. That is
           why `canonicalCommittedMinor` below is narrowed through an explicit
           safe-integer check and is `null` rather than a bigint when it cannot be
           represented. */
          const auditEntry = appendAdminAudit(
            String(ctx.userId ?? ""),
            `spv:${spvId}`,
            "spv.cap_override_recorded",
            {
              partnerId: ctx.partnerId,
              spvId,
              spvName: spv.name,
              investorId,
              investorEmail,
              capMinor: capImpact.capMinor,
              committedBeforeMinor: capImpact.committedBeforeMinor,
              resultingTotalMinor: capImpact.resultingTotalMinor,
              overageMinor: capImpact.overageMinor,
              currency,
              capBasis: "status !== withdrawn",
              /* WAVE 164 · ITEM C · R133.1 — the machine basis string above is
                 KEPT (an operator's saved query still matches it) and the split is
                 ADDED beside it, plus the basis in words. `capBasis: "status !==
                 withdrawn"` on its own told a reader nothing about how much of
                 that total was actually capital, which is how an audit record came
                 to assert an overage over a population it never named. */
              capBasisSplit: {
                confirmedCapitalMinor: capSplit.confirmedCapitalMinor,
                softCircledInterestMinor: capSplit.softCircledInterestMinor,
                wiredNotCommittedMinor: capSplit.wiredNotCommittedMinor,
                requestedMinor: capSplit.requestedMinor,
                resultingTotalMinor: capSplit.resultingTotalMinor,
                overageMinor: capSplit.overageMinor,
              },
              capBasisStatement:
                "cap capacity counts every non-withdrawn subscription, so soft-circled interest " +
                "occupies capacity without being capital; only the confirmed-capital figure is capital",
              durableRecordWritten: capOverrideRecorded,
            },
          );
        if (isAuditWriteFailure(auditEntry)) capOverrideRecordFailed = true;
      }

      /* WAVE 176 · ITEM B — see the `targetRaise` block below for the full
         reasoning. A target of null, zero, or anything not a safe integer means
         there is no goal to pass, which is NOT an overage: coercing it to 0 would
         make every commitment on a target-less vehicle read as oversubscribed. */
      const targetRaiseMinorForWarning = spv.targetRaiseMinor;
      const targetRaiseExceededByThisCommit =
        typeof targetRaiseMinorForWarning === "number" &&
        Number.isSafeInteger(targetRaiseMinorForWarning) &&
        targetRaiseMinorForWarning > 0 &&
        capSplit.resultingTotalMinor > targetRaiseMinorForWarning;
      const targetRaiseWarning =
        targetRaiseExceededByThisCommit && typeof targetRaiseMinorForWarning === "number"
          ? spvTargetRaiseWarningSentence(
              { ...capSplit, targetRaiseMinor: targetRaiseMinorForWarning },
              currencyExponent(currency),
            )
          : "";

      /* The committed-only (MONEY basis) figure, for disclosure beside the
         capacity-basis totals above. `canonicalCommittedMinorForSpv` returns a
         `bigint`; it is narrowed here at the route boundary and NEVER placed in a
         JSON body as a bigint. */
      const canonicalBig = canonicalCommittedMinorForSpv(spvId);
      const canonicalCommittedMinor =
        canonicalBig <= BigInt(Number.MAX_SAFE_INTEGER) && Number.isSafeInteger(Number(canonicalBig))
          ? Number(canonicalBig)
          : null;

      return res.status(existing ? 200 : 201).json({
        ok: true,
        idempotent: !!existing,
        ledger: entry ? { hash: entry.hash, seq: entry.seq } : null,
        subscription,
        /* R105(1)/(3) — the figures a GP must be able to see, named. `overCap`
           false is reported too, so a caller can tell "within cap" from "cap not
           evaluated" (`capMinor: null` — no cap set on this vehicle). */
        cap: {
          capMinor: capImpact.capMinor,
          committedBeforeMinor: capImpact.committedBeforeMinor,
          resultingTotalMinor: capImpact.resultingTotalMinor,
          overageMinor: capImpact.overageMinor,
          overCap: capImpact.overCap,
          currency,
          basis: "status !== withdrawn",
          canonicalCommittedMinor,
          overrideRecorded: capOverrideRecorded,
          overrideRecordFailed: capOverrideRecordFailed,
          /* WAVE 164 · ITEM C · R133.1 — the split, ADDED beside the existing keys
             (none of which changes meaning). `canonicalCommittedMinor` at the line
             above is retained exactly as it was. */
          split: {
            capMinor: capSplit.capMinor,
            confirmedCapitalMinor: capSplit.confirmedCapitalMinor,
            softCircledInterestMinor: capSplit.softCircledInterestMinor,
            wiredNotCommittedMinor: capSplit.wiredNotCommittedMinor,
            requestedMinor: capSplit.requestedMinor,
            resultingTotalMinor: capSplit.resultingTotalMinor,
            overageMinor: capSplit.overageMinor,
            currency: capSplit.currency,
          },
        },
        /* WAVE 164 · R130 — the TARGET raise, reported SEPARATELY from the cap and
           never conflated with it. `blocked: false` is explicit: a target is a
           goal, and this commit was not refused for passing one. The durable
           records live under `terms._targetOverages`, written by the store's four
           committed-writers. */
        targetRaise: {
          targetRaiseMinor: spv.targetRaiseMinor,
          overages: spvEngineStore.targetOveragesForSpv(ctx.partnerId, spvId),
          blocked: false,
          /* ══ WAVE 176 · ITEM B · R147.3(1) — THE WARN HALF OF R130.1, PUT ON THE
             WIRE. TWO ADDITIVE KEYS; every key above is byte-unchanged.

             THE RECORDING WAS NEVER THE DEFECT. `recordTargetRaiseOverage`
             (spvEngineStore.ts:3155) has written TARGET_RAISE_EXCEEDED with
             `blocked: false` since wave 164, and it BUILDS this very sentence —
             but all four committed-writers call the never-throws wrapper as a
             bare statement and discard its return value, and `projectLpCommitted`
             returns only a subscription DTO. So the sentence existed and was
             thrown away, `overages` above crossed the wire as raw records with no
             wording and no way to tell which of them THIS commit caused, and the
             client had no renderer at all. A $9,000,000 commit against a
             $5,000,000 target therefore produced only "LP committed to the cap
             table." on live 26.29.0. R130.1 asks for warn AND record; only record
             shipped.

             NOTHING IS BLOCKED AND NOTHING RECORDED IS CHANGED. This runs after
             the ledger write and after the projection, on a request that is about
             to answer 200/201; it is a disclosure, not a gate (R135.3). The cap
             refusal path and R133.1's four-figure split are untouched.

             NO RIVAL ARITHMETIC. The figures come from `capSplit`, computed above
             on this same request, whose `resultingTotalMinor` IS
             `capImpact.resultingTotalMinor` — the total INCLUDING this commitment,
             measured before the projection so the committing LP's replaced row is
             not double-counted. The sentence itself is the SHARED
             `spvTargetRaiseWarningSentence` the store uses for the durable record,
             so the screen cannot word this differently from the audit trail. All
             inputs are already-validated minor-unit integers; no money string is
             parsed here and no `Number()`/`parseInt`/`parseFloat` is introduced.

             `exceeded: false` is reported explicitly, so a caller can tell "did
             not pass the target" from "this vehicle has no target set"
             (`targetRaiseMinor: null`). */
          exceeded: targetRaiseExceededByThisCommit,
          warning: targetRaiseWarning,
        },
        /* WAVE 106 — the commitment now names its holder in the response, so a
         * caller can see WHO it was attributed to and whether an existing
         * invited LP was matched rather than duplicated. */
        lp: {
          investorId,
          firstName: identity.invite.firstName,
          lastName: identity.invite.lastName,
          email: identity.invite.email,
          matchedExistingInvite: identity.matchedExistingInvite,
        },
      });
    },
  );

  /* ── Collective visibility context (read-only) ─────────────────────────── */
  // W1 H2 (v26.2.0) — Collective-only SPV visibility is a member benefit; gate it
  // with the canonical membership middleware (admin bypass included). The inner
  // isAuthed check remains as harmless defense-in-depth.
  app.get("/api/collective/spvs", requireCollectiveMember, (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ error: "AUTH_REQUIRED" });
    res.json({ spvs: spvEngineStore.listVisibleForContext("collective") });
  });

  /* ── Capavate investor visibility context (collective_only EXCLUDED) ────── */
  app.get("/api/capavate/spvs", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ error: "AUTH_REQUIRED" });
    res.json({ spvs: spvEngineStore.listVisibleForContext("capavate") });
  });

  /* ── Platform-admin governance (SEPARATE Consortium-Partners admin tabs) ── */
  app.get("/api/admin/consortium-spv", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    // Admin governance sees every SPV across every partner (incl. draft/private).
    res.json({ spvs: spvEngineStore.adminListAll() });
  });

  /* Platform fee layer — Capavate admin only, read-only to the GP. */
  app.post("/api/admin/consortium-spv/:spvId/platform-fee", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    const body = req.body ?? {};
    const partnerId = String(body.sponsorPartnerId ?? "");
    if (!partnerId) return res.status(400).json({ error: "SPONSOR_PARTNER_ID_REQUIRED" });
    try {
      const fee = spvEngineStore.addFee(
        partnerId, String(req.params.spvId),
        { ...body, layer: "platform" }, ctx.userId ?? "u_unknown_admin", { adminPlatform: true },
      );
      res.status(201).json({ fee });
    } catch (e) { err(res, e); }
  });

  /* ═════════════════════════════════════════════════════════════════════════ *
   *  WAVE 3F / ITEM 4 — DEPLOYMENT-FEE BILLING: QUEUE, INSPECT, RETRY
   * ═════════════════════════════════════════════════════════════════════════ *
   * W10 REVIEW A, MAJOR: the deployment persists before the fee hook, the hook
   * returns { charged:false } on failure, and the commit route above answers
   * 409 ALREADY_COMMITTED on any replay (:506) — "No retry route exists
   * anywhere", so a deployed SPV could be permanently unbilled.
   *
   * These three routes are that missing operation. The retry does NOT replay
   * the blocked deployment commit; it re-runs collection off the durable
   * `spv_deployment_fee_billing` row (migration 0162) and is idempotent at
   * three independent layers (billing row state, partner_billing_entries,
   * spv.deployment_fee_minor), so calling it repeatedly cannot double-charge.
   *
   * Adding routes is additive: the silent-drop guard checks for DROPS. */

  /** The retry queue: every deployed engine SPV that still owes a fee. */
  app.get("/api/admin/consortium-spv/deployment-fee/pending", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    try {
      res.json({ pending: listPendingEngineSpvDeploymentFees() });
    } catch (e) { err(res, e); }
  });

  /** One SPV's billing record — state, attempts and the reason it is blocked. */
  app.get("/api/admin/consortium-spv/:spvId/deployment-fee", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    try {
      const billing = getEngineSpvDeploymentFeeBilling(String(req.params.spvId));
      if (!billing) return res.status(404).json({ error: "DEPLOYMENT_FEE_BILLING_NOT_FOUND" });
      res.json({ billing });
    } catch (e) { err(res, e); }
  });

  /** IDEMPOTENT retry. `{ charged:false, reason:"already_charged" }` is the
   *  correct, successful answer for an SPV that has already paid. */
  app.post("/api/admin/consortium-spv/:spvId/deployment-fee/retry", (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) return res.status(403).json({ error: "ADMIN_REQUIRED" });
    const spvId = String(req.params.spvId);
    try {
      /* WAVE 3F / ITEM 2 remedy, optional: an admin may supply the canonical
       * tier that was missing. It is validated against the DB-enforced domain
       * and rejected outright if unknown — never coerced to a default. */
      const tier = (req.body ?? {}).tier;
      const partnerId = String((req.body ?? {}).partnerId ?? "");
      if (tier !== undefined) {
        if (!partnerId) return res.status(400).json({ error: "SPONSOR_PARTNER_ID_REQUIRED" });
        setCanonicalPartnerTier(partnerId, tier, "admin");
      }
      const result = retryEngineSpvDeploymentFee(spvId);
      res.json({ result, billing: getEngineSpvDeploymentFeeBilling(spvId) });
    } catch (e) {
      if (e instanceof PartnerTierResolutionError) {
        return res.status(400).json({ error: e.code, detail: e.detail });
      }
      err(res, e);
    }
  });
}
