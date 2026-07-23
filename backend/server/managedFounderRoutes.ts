/**
 * W-MFCRM — Managed Founder CRM route module.
 *
 * `registerMfcrmRoutes(app)` mounts the partner-facing engine endpoints under
 * `/api/partner/me/mfcrm*` and the platform-admin capability-profile endpoints
 * under `/api/admin/mfcrm*`. Both path prefixes are deliberately distinct from
 * every existing route so there is NO Express collision — this module shadows
 * nothing and is purely additive (registered alongside the other
 * `registerXRoutes(app)` calls).
 *
 * FAIL-CLOSED isolation (identical to partnerClientCrmRoutes):
 *   - `partnerId` is ALWAYS `req.partnerContext!.partnerId` (session-derived,
 *     never the URL/body).
 *   - Any `companyId` in scope is verified attributed to THAT partner before the
 *     store is touched; an unattributed / cross-partner companyId returns 404
 *     (never leaks existence or state).
 *   - Capability gates live in managedFounderStore (the SoT); this layer maps a
 *     thrown `GateError.code` to the right HTTP status.
 *
 * Admin routes additionally sit behind the `/api/admin` requireAdmin mount guard
 * (server/routes.ts) AND re-check `getUserContext(req).isAdmin` in-handler, the
 * belt-and-suspenders convention used by spvEngineRoutes.
 */
import type { Express, Request, Response } from "express";
import { requirePartnerAuth, assertSubRole } from "./lib/requirePartnerAuth";
import { getUserContext } from "./lib/userContext";
import { partnerAttributionStore } from "./partnerWorkspaceStore";
import { managedFounderStore, GateError, type EngagementMode } from "./managedFounderStore";

/** Returns true iff companyId is attributed to this partner (partner-scoped). */
function isAttributed(partnerId: string, companyId: string): boolean {
  return partnerAttributionStore.listByPartner(partnerId).some((a) => a.companyId === companyId);
}

/** GateError / plain-Error → HTTP status + body. Fail-closed: unknown → 403. */
function sendError(res: Response, e: unknown): Response {
  const code = e instanceof GateError ? e.code : (e as Error)?.message ?? "ERROR";
  const message = (e as Error)?.message ?? String(e);
  // 404 — not found / cross-partner (never leak existence).
  if (["ENGAGEMENT_NOT_FOUND", "HANDOVER_NOT_FOUND", "PUSH_NOT_FOUND"].includes(code)) {
    return res.status(404).json({ error: code });
  }
  // 400 — malformed request.
  if (["COMPANY_ID_REQUIRED", "PARTNER_ID_REQUIRED", "INVALID_MODE"].includes(code)) {
    return res.status(400).json({ error: code, message });
  }
  // 409 — conflicting state.
  if (["ENGAGEMENT_ALREADY_EXISTS", "HANDOVER_NOT_PENDING"].includes(code)) {
    return res.status(409).json({ error: code, message });
  }
  // 500 — strict-persist / infrastructure failure.
  if (code.startsWith("STRICT_PERSIST_FAILED")) {
    return res.status(500).json({ error: "STRICT_PERSIST_FAILED", message });
  }
  // Default: capability / authority denial → 403 (fail-closed).
  return res.status(403).json({ error: code, message });
}

const WRITE_ROLES = ["managing_partner", "associate", "bd"] as const;

export function registerMfcrmRoutes(app: Express): void {
  /* ============================ PARTNER SIDE ============================ */

  /* Capability profile (own, session-scoped). Fail-closed unclassified read. */
  app.get("/api/partner/me/mfcrm/capability", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    res.json({ capability: managedFounderStore.getCapabilityProfile(pid) });
  });

  /* Engine dashboard rollup. */
  app.get("/api/partner/me/mfcrm/dashboard", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    res.json(managedFounderStore.dashboard(pid));
  });

  /* ---- Engagements ---- */

  app.get("/api/partner/me/mfcrm/engagements", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    res.json({ engagements: managedFounderStore.listEngagements(pid) });
  });

  app.post(
    "/api/partner/me/mfcrm/engagements",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = req.body ?? {};
      const companyId = String(body.companyId ?? "");
      if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
      // Fail-closed isolation: the company MUST be attributed to this partner.
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      try {
        const e = managedFounderStore.createEngagement(
          pid,
          {
            companyId,
            mode: body.mode === "A" ? "A" : "B",
            authorityArtifactRef: body.authorityArtifactRef ?? null,
            authorityExpiresAt: body.authorityExpiresAt ?? null,
            chapterId: body.chapterId ?? null,
            matterId: body.matterId ?? null,
            trialDays: typeof body.trialDays === "number" ? body.trialDays : undefined,
          },
          actor,
        );
        res.status(201).json({ engagement: e });
      } catch (e) { sendError(res, e); }
    },
  );

  app.get("/api/partner/me/mfcrm/engagements/:engagementId", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const e = managedFounderStore.getEngagement(pid, String(req.params.engagementId));
    if (!e) return res.status(404).json({ error: "ENGAGEMENT_NOT_FOUND" });
    res.json({ engagement: e, trial: managedFounderStore.getTrial(pid, e.id) });
  });

  app.get("/api/partner/me/mfcrm/engagements/:engagementId/events", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    res.json({ events: managedFounderStore.listEvents(pid, String(req.params.engagementId)) });
  });

  /* Mode change. A→B free; B→A re-runs the Mode-A entry gate (GATE 6). */
  app.patch(
    "/api/partner/me/mfcrm/engagements/:engagementId/mode",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = req.body ?? {};
      const newMode: EngagementMode = body.mode === "A" ? "A" : body.mode === "B" ? "B" : ("" as EngagementMode);
      if (newMode !== "A" && newMode !== "B") return res.status(400).json({ error: "INVALID_MODE" });
      try {
        const e = managedFounderStore.setMode(
          pid, String(req.params.engagementId), newMode,
          { authorityArtifactRef: body.authorityArtifactRef ?? null, authorityExpiresAt: body.authorityExpiresAt ?? null },
          actor,
        );
        res.json({ engagement: e });
      } catch (e) { sendError(res, e); }
    },
  );

  /* Hand-over initiate (partner or founder side). */
  app.post(
    "/api/partner/me/mfcrm/engagements/:engagementId/handover",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = req.body ?? {};
      const direction = body.direction === "B_TO_A" ? "B_TO_A" : "A_TO_B";
      const initiatorParty = body.initiatorParty === "founder" ? "founder" : "partner";
      try {
        const ho = managedFounderStore.handoverInitiate(
          pid, String(req.params.engagementId),
          { direction, initiatorParty, authorityArtifactRef: body.authorityArtifactRef ?? null, authorityExpiresAt: body.authorityExpiresAt ?? null },
          actor,
        );
        res.status(201).json({ handover: ho });
      } catch (e) { sendError(res, e); }
    },
  );

  /* Hand-over confirm (partner-initiated). Confirming into Mode A re-runs GATE 6. */
  app.post(
    "/api/partner/me/mfcrm/handovers/:handoverId/confirm",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      try {
        const e = managedFounderStore.handoverConfirm(pid, String(req.params.handoverId), actor);
        res.json({ engagement: e });
      } catch (e) { sendError(res, e); }
    },
  );

  /* ---- Attribution + crossover ---- */

  app.post(
    "/api/partner/me/mfcrm/attribution",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = req.body ?? {};
      const companyId = String(body.companyId ?? "");
      if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      try {
        const out = managedFounderStore.stampAttribution(
          pid,
          { companyId, engagementId: body.engagementId ?? null, dealId: body.dealId ?? null, attributionType: body.attributionType },
          actor,
        );
        res.status(201).json({ attribution: out });
      } catch (e) { sendError(res, e); }
    },
  );

  app.get("/api/partner/me/mfcrm/attribution/:companyId", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = String(req.params.companyId);
    if (!isAttributed(pid, companyId)) {
      return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    res.json(managedFounderStore.readAttribution(pid, companyId));
  });

  app.post(
    "/api/partner/me/mfcrm/crossover-flags",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = req.body ?? {};
      const companyId = String(body.companyId ?? "");
      const flagCode = String(body.flagCode ?? "");
      if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
      if (!flagCode) return res.status(400).json({ error: "FLAG_CODE_REQUIRED" });
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      try {
        const out = managedFounderStore.createCrossoverFlag(pid, { companyId, flagCode, detail: body.detail ?? null }, actor);
        res.status(201).json({ flag: out });
      } catch (e) { sendError(res, e); }
    },
  );

  app.get("/api/partner/me/mfcrm/crossover-flags", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId && !isAttributed(pid, companyId)) {
      return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    res.json({ flags: managedFounderStore.listCrossoverFlags(pid, companyId) });
  });

  /* ---- Layer membership (3 CRM layers drill-down) ---- */

  app.get("/api/partner/me/mfcrm/layers/:companyId", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = String(req.params.companyId);
    if (!isAttributed(pid, companyId)) {
      return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    res.json({ layers: managedFounderStore.listLayerMembership(pid, companyId) });
  });

  /* ---- Money path 1: soft-circle graduation (sacred commitFunded) ---- */
  app.post(
    "/api/partner/me/mfcrm/graduate",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = req.body ?? {};
      const companyId = String(body.companyId ?? "");
      if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      try {
        const out = managedFounderStore.softCircleGraduate(
          pid,
          {
            companyId,
            engagementId: String(body.engagementId ?? ""),
            invitationId: String(body.invitationId ?? ""),
            roundId: String(body.roundId ?? ""),
            investorId: String(body.investorId ?? ""),
            amount: String(body.amount ?? ""),
            shares: String(body.shares ?? ""),
            currency: body.currency,
            investorName: body.investorName,
            investorEmail: body.investorEmail,
            region: body.region ?? null,
          },
          actor,
        );
        if (!out.ok) return res.status(422).json({ error: "GRADUATION_LEDGER_REJECTED", message: out.error });
        res.status(201).json(out);
      } catch (e) { sendError(res, e); }
    },
  );

  /* ---- Money path 2: SPV-on-behalf (GATE 3 / D-9; transactional §3.3) ---- */
  app.post(
    "/api/partner/me/mfcrm/spv-on-behalf",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const actor = req.partnerContext!.userId;
      const body = req.body ?? {};
      const companyId = String(body.companyId ?? "");
      if (!companyId) return res.status(400).json({ error: "COMPANY_ID_REQUIRED" });
      if (!isAttributed(pid, companyId)) {
        return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
      }
      try {
        const out = managedFounderStore.createSpvOnBehalf(
          pid,
          {
            companyId,
            engagementId: String(body.engagementId ?? ""),
            name: String(body.name ?? ""),
            jurisdiction: String(body.jurisdiction ?? ""),
            carryBasis: String(body.carryBasis ?? ""),
            roundId: body.roundId ?? null,
            spvType: body.spvType,
            targetRaiseMinor: typeof body.targetRaiseMinor === "number" ? body.targetRaiseMinor : null,
            currency: body.currency,
            terms: body.terms ?? null,
          },
          actor,
        );
        res.status(201).json(out);
      } catch (e) { sendError(res, e); }
    },
  );

  app.get("/api/partner/me/mfcrm/spv-on-behalf", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId && !isAttributed(pid, companyId)) {
      return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    res.json({ spvOnBehalf: managedFounderStore.listSpvOnBehalf(pid, companyId) });
  });

  /* ---- Collective push queue (GATE 4) ---- */

  app.get("/api/partner/me/mfcrm/collective-push", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    res.json({ pushes: managedFounderStore.listCollectivePush(pid) });
  });

  /* Mark a queued push pushed/failed. GATE 4 (collective_fronting + ACTIVE) is
   * asserted here against the push's engagement before the durable state moves. */
  app.post(
    "/api/partner/me/mfcrm/collective-push/:pushId/mark",
    requirePartnerAuth,
    assertSubRole(...WRITE_ROLES),
    (req: Request, res: Response) => {
      const pid = req.partnerContext!.partnerId;
      const body = req.body ?? {};
      const pushId = String(req.params.pushId);
      try {
        const rows = managedFounderStore.listCollectivePush(pid);
        const row = rows.find((r: any) => r.id === pushId);
        if (!row) return res.status(404).json({ error: "PUSH_NOT_FOUND" });
        const eng = managedFounderStore.getEngagement(pid, row.engagement_id);
        if (!eng) return res.status(404).json({ error: "ENGAGEMENT_NOT_FOUND" });
        managedFounderStore.assertCollectivePush(pid, eng); // GATE 4
        const updated = managedFounderStore.markCollectivePush(pid, pushId, { ok: body.ok !== false, error: body.error });
        res.json({ push: updated });
      } catch (e) { sendError(res, e); }
    },
  );

  /* ---- Audit trail (acting-on-behalf disclosure, RF-4) ---- */
  app.get("/api/partner/me/mfcrm/audit", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    if (companyId && !isAttributed(pid, companyId)) {
      return res.status(404).json({ error: "COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    res.json({ audit: managedFounderStore.listAudit(pid, companyId) });
  });

  /* ============================ ADMIN SIDE ============================= */
  /* Under the /api/admin requireAdmin mount guard; re-checks isAdmin in-handler
   * (spvEngineRoutes convention). Admin operates cross-partner on the explicit
   * :partnerId — this is the platform operator, NOT a partner session. */

  function requireAdminCtx(req: Request, res: Response): boolean {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed || !ctx.isAdmin) {
      res.status(403).json({ error: "ADMIN_REQUIRED" });
      return false;
    }
    return true;
  }

  app.get("/api/admin/mfcrm/capability/:partnerId", (req: Request, res: Response) => {
    if (!requireAdminCtx(req, res)) return;
    res.json({ capability: managedFounderStore.getCapabilityProfile(String(req.params.partnerId)) });
  });

  app.post("/api/admin/mfcrm/capability/:partnerId/seed", (req: Request, res: Response) => {
    if (!requireAdminCtx(req, res)) return;
    const actor = getUserContext(req)?.userId ?? "admin";
    try {
      res.status(201).json({ capability: managedFounderStore.seedCapabilityProfile(String(req.params.partnerId), actor) });
    } catch (e) { sendError(res, e); }
  });

  app.patch("/api/admin/mfcrm/capability/:partnerId", (req: Request, res: Response) => {
    if (!requireAdminCtx(req, res)) return;
    const actor = getUserContext(req)?.userId ?? "admin";
    const patch = req.body ?? {};
    try {
      res.json({ capability: managedFounderStore.setCapabilityProfile(String(req.params.partnerId), patch, actor) });
    } catch (e) { sendError(res, e); }
  });

  /* Admin: extend/override a Mode-A trial (RF-5 reversible). */
  app.post("/api/admin/mfcrm/engagements/:partnerId/:engagementId/trial-override", (req: Request, res: Response) => {
    if (!requireAdminCtx(req, res)) return;
    const actor = getUserContext(req)?.userId ?? "admin";
    const newExpiry = String((req.body ?? {}).trialExpiresAt ?? "");
    if (!newExpiry) return res.status(400).json({ error: "TRIAL_EXPIRES_AT_REQUIRED" });
    try {
      managedFounderStore.overrideTrial(String(req.params.partnerId), String(req.params.engagementId), newExpiry, actor);
      res.json({ ok: true });
    } catch (e) { sendError(res, e); }
  });

  /* Admin: force-confirm a stuck hand-over (override path). */
  app.post("/api/admin/mfcrm/handovers/:partnerId/:handoverId/override", (req: Request, res: Response) => {
    if (!requireAdminCtx(req, res)) return;
    const actor = getUserContext(req)?.userId ?? "admin";
    try {
      const e = managedFounderStore.handoverConfirm(String(req.params.partnerId), String(req.params.handoverId), actor, { adminOverride: true });
      res.json({ engagement: e });
    } catch (e) { sendError(res, e); }
  });

  /* Admin: expire stale Mode-A trials for a partner (RF-5 sweep). */
  app.post("/api/admin/mfcrm/engagements/:partnerId/expire-stale-trials", (req: Request, res: Response) => {
    if (!requireAdminCtx(req, res)) return;
    try {
      const lapsed = managedFounderStore.expireStaleTrials(String(req.params.partnerId));
      res.json({ lapsed });
    } catch (e) { sendError(res, e); }
  });
}
