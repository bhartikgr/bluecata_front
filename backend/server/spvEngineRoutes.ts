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
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { getUserContext } from "./lib/userContext";
import { commitFunded } from "./captableCommitStore";
import { spvEngineStore } from "./spvEngineStore";
import { resolveDisplayNames } from "./lib/displayNameResolver";
import { listLpInvites, createLpInvite } from "./spvLpInviteStore";
import {
  SPV_JURISDICTIONS,
  SPV_CARRY_BASES,
  SPV_DISTRIBUTION_SCOPES,
  SPV_TYPES,
  SPV_CARRY_BASIS_HELP,
} from "../shared/spvEngine";

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

/** minor units → decimal-as-string the ledger expects (2dp). */
function minorToDecimal(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

function err(res: Response, e: unknown): Response {
  const msg = (e as Error).message || "ERROR";
  const map: Record<string, number> = {
    SPV_NOT_FOUND: 404, DEPLOYMENT_NOT_FOUND: 404, SUBSCRIPTION_NOT_FOUND: 404, NO_MANDATE: 404,
    CARRY_BASIS_REQUIRED: 400, INVALID_JURISDICTION: 400, INVALID_SPV_TYPE: 400, SPV_NAME_REQUIRED: 400,
    INVALID_DISTRIBUTION_SCOPE: 400, INVALID_FEE_LAYER: 400, INVALID_FEE_TYPE: 400, FIXED_AMOUNT_REQUIRED: 400,
    CARRY_PCT_REQUIRED: 400, FEES_EXCEED_RAISE: 400, RULE_TREE_REQUIRED: 400, INVALID_COMMITMENT: 400, INVALID_AMOUNT: 400,
    INVALID_GROSS: 400, EVENT_REQUIRED: 400, BELOW_MIN_CHECK: 400, EXCEEDS_CAP: 400, ALREADY_SUBSCRIBED: 409,
    INVESTOR_ID_REQUIRED: 400, COMPANY_AND_ROUND_REQUIRED: 400, STORAGE_KEY_REQUIRED: 400,
    TRANSFER_PARTIES_REQUIRED: 400, PLATFORM_FEE_ADMIN_ONLY: 403,
    INVALID_LP_VISIBILITY: 400, NOT_AN_LP: 403,
    INVALID_MANDATE_MODE: 400, MANDATE_DESCRIPTION_REQUIRED: 400, MANDATE_DESCRIPTION_TOO_LONG: 400,
    GATE_KYC_REQUIRED: 422, GATE_ACCREDITATION_REQUIRED: 422, GATE_SUBSCRIPTION_ESIGN_REQUIRED: 422,
    FEE_OBLIGATION_NOT_FOUND: 404, FEES_UNPAID: 409, FEE_COLLECTION_FAILED: 402,
    FOUNDER_NOT_CONFIRMED: 409, WIRE_PAYMENT_REF_REQUIRED: 409,
    NO_ACTIVE_ROUND: 409, COMPANY_NOT_ELIGIBLE: 409, INSUFFICIENT_COMMITTED_CAPITAL: 409,
    INSTRUMENT_NOT_IN_ROUND: 409, DISTRIBUTION_BASIS_REQUIRED: 400, NO_COMMITTED_LPS: 409,
    LP_INVITE_EMAIL_REQUIRED: 400, LP_INVITE_LAST_NAME_REQUIRED: 400, LP_INVITE_PERSIST_FAILED: 500,
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
      const spv = spvEngineStore.createSpv(req.partnerContext!.partnerId, req.body ?? {}, req.partnerContext!.userId);
      res.status(201).json({ spv });
    } catch (e) { err(res, e); }
  });

  app.get("/api/partner/me/spv/:spvId", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const spv = spvEngineStore.getSpv(pid, String(req.params.spvId));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    res.json({
      spv,
      mandate: spvEngineStore.getMandate(pid, spv.id),
      fees: spvEngineStore.listFees(pid, spv.id),
      subscriptions: spvEngineStore.listSubscriptions(pid, spv.id),
      deployments: spvEngineStore.listDeployments(pid, spv.id),
      distributions: spvEngineStore.listDistributions(pid, spv.id),
      documents: spvEngineStore.listDocuments(pid, spv.id),
      register: spvEngineStore.investorRegister(pid, spv.id),
    });
  });

  app.patch("/api/partner/me/spv/:spvId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const spv = spvEngineStore.updateSpv(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}, req.partnerContext!.userId);
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

  // Collect a fixed fee obligation THROUGH the existing payment ledger.
  app.post("/api/partner/me/spv/:spvId/fee-obligations/:obId/charge", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      const pid = req.partnerContext!.partnerId;
      const outcome = (req.body ?? {}).outcome === "failed" ? "failed" : "succeeded";
      res.json({ obligation: spvEngineStore.chargeFeeObligation(pid, String(req.params.spvId), String(req.params.obId), pid, outcome) });
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
      res.json({
        profile: spvEngineStore.getComplianceProfile(String(req.params.investorId)),
        gates: spvEngineStore.gateStatus(String(req.params.investorId)),
      });
    } catch (e) { err(res, e); }
  });

  app.put("/api/partner/me/compliance/:investorId", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.json({ profile: spvEngineStore.upsertComplianceProfile(String(req.params.investorId), req.body ?? {}) });
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
      amount: minorToDecimal(dep.amountMinor),
      currency: dep.currency,
      shares,
    });
    if (!result.ok) return res.status(409).json({ error: "LEDGER_COMMIT_FAILED", detail: result.error });
    const deployment = spvEngineStore.markDeployed(pid, spvId, depId, result.entry.hash, shares);
    res.json({ deployment, ledger: { hash: result.entry.hash, seq: result.entry.seq } });
  });

  /* ── distributions / waterfall ─────────────────────────────────────────── */
  app.post("/api/partner/me/spv/:spvId/distributions", requirePartnerAuth, assertSubRole(...WRITE_ROLES), requireSignedAgreement, (req: Request, res: Response) => {
    try {
      res.status(201).json({ distribution: spvEngineStore.recordDistribution(req.partnerContext!.partnerId, String(req.params.spvId), req.body ?? {}, req.partnerContext!.userId) });
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
     to 400. */
  app.post(
    "/api/partner/me/spv/:spvId/lp-invites",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const spvId = String(req.params.spvId);
      if (!spvEngineStore.getSpv(ctx.partnerId, spvId)) {
        return res.status(404).json({ error: "SPV_NOT_FOUND" });
      }
      const body = req.body ?? {};
      try {
        const invite = createLpInvite(
          ctx.partnerId,
          spvId,
          { email: body.email, firstName: body.firstName, lastName: body.lastName, note: body.note },
          ctx.userId,
        );
        res.status(201).json({ invite });
      } catch (e) { err(res, e); }
    },
  );

  /* ── Collective visibility context (read-only) ─────────────────────────── */
  app.get("/api/collective/spvs", (req: Request, res: Response) => {
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
        { ...body, layer: "platform" }, ctx.userId ?? "admin", { adminPlatform: true },
      );
      res.status(201).json({ fee });
    } catch (e) { err(res, e); }
  });
}
