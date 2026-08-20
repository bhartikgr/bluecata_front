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
import { createHash } from "crypto";
import { z } from "zod";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
/* WAVE 22 · ITEM 2 (REVIEW B F-3) — the SPV launch sign-off `ip` used to be the
 * raw `x-forwarded-for` header, i.e. attacker-chosen text in an authorization
 * record. Reuse the ONE hardened, fail-closed resolver instead of a local copy. */
import { resolveRateLimitClientIp } from "./lib/rateLimit";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { getUserContext } from "./lib/userContext";
import { requireCollectiveMember } from "./lib/requireCollectiveMember";
// WAVE 1A / S-2 — the fee self-mark fix. See server/lib/feeSettlementAuthority.ts.
import { authorizeGatewaySettlement, authorizePlatformAdminSettlement } from "./lib/feeSettlementAuthority";
import { commitFunded, getLedger } from "./captableCommitStore";
import { spvEngineStore } from "./spvEngineStore";
import { normaliseSpvTermsHurdle } from "./lib/percentPolicy";
// CP-SPV-31 — currency-aware minor-unit conversion. Static imports only.
import { decimalStringToMinor, currencyExponent } from "./lib/money";
import { resolveDisplayNames } from "./lib/displayNameResolver";
import { listLpInvites, createLpInvite } from "./spvLpInviteStore";
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
  };
  return res.status(map[msg] ?? 500).json({ error: msg });
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
    res.json({ spvs: spvEngineStore.listByPartner(req.partnerContext!.partnerId) });
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
      // 1c — a full launch sign-off is REQUIRED before an SPV can be created.
      // The signer must type their full legal name AND explicitly accept the
      // versioned attestation. Identity of record is the SESSION user, never a
      // client-supplied id. Missing/invalid sign-off => 400 (no SPV created).
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
      let signoff;
      try {
        signoff = recordSignoff({
          partnerId: ctx.partnerId,
          spvId: "", // linked to the real id below once the SPV exists
          userId: ctx.userId,
          signerLegalName: signoffLegalName,
          signerSubRole: ctx.partnerSubRole ?? null,
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
      res.status(201).json({ spv, signoff: { id: signoff.id, signedAt: signoff.signedAt, attestationVersion: signoff.attestationVersion } });
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
      // W-FIX1f — surface the built-but-hidden capabilities in the tabbed detail:
      // secondary transfers, minimal capital accounts (D10), and the close summary.
      transfers: spvEngineStore.listTransfers(pid, spv.id),
      capitalAccounts: spvEngineStore.capitalAccounts(pid, spv.id),
      closeSummary: spvEngineStore.closeSummary(pid, spv.id),
    });
  });

  app.patch("/api/partner/me/spv/:spvId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      // WAVE 5 / P-4 — SECOND PATH to the same persisted terms blob. The POST
      // above is not the only writer; a GP can edit the hurdle after creation
      // through this PATCH. Both are normalised, or the defect simply moves.
      const patchBody = { ...((req.body ?? {}) as Record<string, unknown>) };
      if ("terms" in patchBody) patchBody.terms = normaliseSpvTermsHurdle(patchBody.terms);
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
    const commitmentMinor = Number(req.query.commitmentMinor ?? spv.minCheckMinor ?? 0);
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

  /* ── subscriptions (unified flow + 3 gates) ────────────────────────────── */
  app.post("/api/partner/me/spv/:spvId/subscriptions", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.status(201).json({ subscription: spvEngineStore.subscribe(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}, req.partnerContext!.userId) });
    } catch (e) { err(res, e); }
  });

  app.patch("/api/partner/me/spv/:spvId/subscriptions/:subId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      res.json({ subscription: spvEngineStore.advanceSubscription(req.partnerContext!.partnerId, String(req.params.spvId), String(req.params.subId), body.to, body) });
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
      res.status(201).json({ distribution: spvEngineStore.recordDistribution(req.partnerContext!.partnerId, String(req.params.spvId), pickDistributionBody(req.body), req.partnerContext!.userId) });
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
      const subs = spvEngineStore.listSubscriptions(ctx.partnerId, spvId);
      const names = resolveDisplayNames(subs.map((s) => s.investorId));
      const total = subs
        .filter((s) => s.status !== "withdrawn")
        .reduce((a, s) => a + s.commitmentMinor, 0);
      const subscribers = subs.map((s) => {
        const idn = names.get(String(s.investorId).trim());
        return {
          investorId: s.investorId,
          name: idn?.name ?? null,
          email: idn?.email ?? null,
          commitmentMinor: s.commitmentMinor,
          status: s.status,
          ownershipPct: total > 0 && s.status !== "withdrawn" ? s.commitmentMinor / total : 0,
        };
      });
      const invites = listLpInvites(ctx.partnerId, spvId).map((i) => ({
        id: i.id,
        email: i.email,
        firstName: i.firstName,
        lastName: i.lastName,
        note: i.note,
        status: i.status,
        createdAt: i.createdAt,
      }));
      res.json({ spvId, lpVisibility: spv.lpVisibility, subscribers, invites });
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
      let invite;
      try {
        invite = createLpInvite(
          ctx.partnerId,
          spvId,
          { email: body.email, firstName: body.firstName, lastName: body.lastName, note: body.note },
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

      // Deterministic per-LP + per-SPV keys → idempotent re-commit (no dup line).
      const stableKey = createHash("sha256").update(investorEmail, "utf8").digest("hex").slice(0, 16);
      const investorId = `ext_${stableKey}`;
      const roundId = `spvlp_${spv.id}`;            // synthetic, price-less → no reconcile price coupling
      const invitationId = `spvlp_${spv.id}_${stableKey}`;

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
          const status = result.error.startsWith("compliance_hold") ? 409 : 400;
          return res.status(status).json({ error: "LEDGER_COMMIT_FAILED", detail: result.error });
        }
        entry = result.entry;
      }

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

      return res.status(existing ? 200 : 201).json({
        ok: true,
        idempotent: !!existing,
        ledger: entry ? { hash: entry.hash, seq: entry.seq } : null,
        subscription,
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
