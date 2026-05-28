/**
 * Foundation Build — Partner CRM + SPV/Fund Record-Keeping REST surface.
 *
 * Two route families:
 *   - /api/admin/partners/*  — admin-only management (requireAdmin)
 *   - /api/partner/me/*       — partner workspace (requirePartnerAuth)
 *
 * Every mutation:
 *   - validates partnerId comes from SESSION (never URL)
 *   - enforces sub-role + tier gates at the route layer
 *   - calls store helpers that hash-chain + emit bridge events + audit
 *
 * Magic-link redemption: POST /api/auth/redeem-partner-invite/:token (mounted
 * at /api/auth/* so unauthenticated visitors can hit it; the redeeming user
 * must still be signed in — the flow is "sign up first, then redeem").
 */
import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import { requirePartnerAuth, assertSubRole, assertTier, assertTierSeats } from "./lib/requirePartnerAuth";
import { getUserContext } from "./lib/userContext";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { TIER_RANK, type PartnerTier, type PartnerType, type PartnerSubRole } from "./adminContactsStoreShim";
import {
  partnerTeamStore,
  partnerInvitationStore,
  partnerAttributionStore,
  partnerPipelineStore,
  partnerPipelineActivityStore,
  partnerNotesStore,
  partnerTasksStore,
  partnerFilesStore,
  partnerWorkspaceSettingsStore,
  partnerSpvStore,
  partnerFundsStore,
  partnerDashboardSnapshot,
  partnerDealPromotionsStore,
  PromotionConflictError,
  ALL_PIPELINE_STAGES,
} from "./partnerWorkspaceStore";
import { getAllContacts, listContacts, updateContact, createContact } from "./adminContactsStore";

/* ============================================================
 * Helpers
 * ============================================================ */

function badRequest(res: Response, msg: string, details?: unknown): void {
  res.status(400).json({ error: "BAD_REQUEST", message: msg, details });
}
function isString(v: unknown): v is string { return typeof v === "string" && v.length > 0; }
function isNumber(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function isISOCurrency(v: unknown): v is string {
  return typeof v === "string" && /^[A-Z]{3}$/.test(v);
}

/* ============================================================
 * Registration
 * ============================================================ */

export function registerPartnerRoutes(app: Express): void {

  /* ============================================================
   * ADMIN endpoints — /api/admin/partners/*
   * ============================================================ */

  app.get("/api/admin/partners", requireAdmin, (_req: Request, res: Response) => {
    const list = getAllContacts().filter((c) => c.kind === "consortium_partner");
    res.json({ partners: list });
  });

  app.get("/api/admin/partners/:id", requireAdmin, (req: Request, res: Response) => {
    const c = getAllContacts().find((x) => x.id === String(req.params.id) && x.kind === "consortium_partner");
    if (!c) return res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    res.json({ partner: c });
  });

  app.post("/api/admin/partners", requireAdmin, (req: Request, res: Response) => {
    const { legalName, displayName, email, region, partnerType, tier } = req.body ?? {};
    if (!isString(legalName) || !isString(email)) return badRequest(res, "legalName + email required");
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const contact = createContact({
      kind: "consortium_partner",
      legalName,
      displayName: displayName ?? legalName,
      email,
      type: "partner_org",
      status: "active",
      verification: "pending",
      hqCity: "",
      hqCountry: region ?? "US",
      region: region ?? "US",
      aumMinor: null,
      aumCurrency: "USD",
      checkSizeMinMinor: null,
      checkSizeMaxMinor: null,
      industries: [],
      stages: [],
      companyIds: [],
      partnerWeight: 1,
      partnerSince: new Date().toISOString(),
      phone: null,
      website: null,
      linkedinUrl: null,
      tags: [],
      notes: "",
      createdBy: actor,
      updatedBy: actor,
      // partner fields:
      tier: (tier as PartnerTier) ?? "catalyst",
      tierSince: new Date().toISOString(),
      foundingMember: false,
      partnerType: (partnerType as PartnerType) ?? "angel_network",
      regionCode: region ?? "US",
      preferredPayoutCurrency: "USD",
      configJson: null,
    }, actor);
    appendAdminAudit(actor, `partner:${contact.id}`, "partner.onboarded", { legalName, tier: contact.tier });
    emitBridgeEvent({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventType: "partner.onboarded" as any,
      aggregateId: contact.id,
      aggregateKind: "platform",
      payload: { partnerId: contact.id, legalName, tier: contact.tier, partnerType: contact.partnerType, onboardedBy: actor, idempotencyKey: contact.id },
    });
    res.status(201).json({ partner: contact });
  });

  app.patch("/api/admin/partners/:id", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), req.body ?? {}, actor, "partner.updated");
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/promote-tier", requireAdmin, (req: Request, res: Response) => {
    const { tier, rationale } = req.body ?? {};
    const validTiers: PartnerTier[] = ["catalyst", "builder", "amplifier", "nexus", "founding_member"];
    if (!isString(tier) || !validTiers.includes(tier as PartnerTier)) {
      return badRequest(res, "tier must be one of " + validTiers.join("|"));
    }
    if (!isString(rationale)) return badRequest(res, "rationale required (audit reason)");
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { tier: tier as PartnerTier, tierSince: new Date().toISOString() } as Partial<Parameters<typeof updateContact>[1]>, actor, "partner.tier_changed");
      appendAdminAudit(actor, `partner:${String(req.params.id)}`, "partner.tier_changed", { newTier: tier, rationale });
      emitBridgeEvent({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventType: "partner.tier_changed" as any,
        aggregateId: String(req.params.id),
        aggregateKind: "platform",
        payload: { partnerId: String(req.params.id), tier, rationale, changedAt: new Date().toISOString(), idempotencyKey: `${String(req.params.id)}|${tier}|${Date.now()}` },
      });
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/suspend", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { status: "suspended" }, actor, "partner.suspended");
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/archive", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { status: "archived" }, actor, "partner.archived");
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/attributions", requireAdmin, (req: Request, res: Response) => {
    const { companyId, source, notes } = req.body ?? {};
    if (!isString(companyId)) return badRequest(res, "companyId required");
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const a = partnerAttributionStore.create(String(req.params.id), companyId, actor, source ?? "admin_manual", notes ?? null);
    res.status(201).json({ attribution: a });
  });

  app.delete("/api/admin/partners/:id/attributions/:companyId", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const a = partnerAttributionStore.revoke(String(req.params.id), String(req.params.companyId), actor);
      res.json({ attribution: a });
    } catch {
      res.status(404).json({ error: "ATTRIBUTION_NOT_FOUND" });
    }
  });

  /* ============================================================
   * PARTNER workspace endpoints — /api/partner/me/*
   * ============================================================ */

  app.get("/api/partner/me", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    res.json({
      partnerId: ctx.partnerId,
      tier: ctx.tier,
      subRole: ctx.partnerSubRole,
      identity: { userId: ctx.userId, email: ctx.email, name: ctx.name },
    });
  });

  app.get("/api/partner/me/dashboard", requirePartnerAuth, (req: Request, res: Response) => {
    res.json(partnerDashboardSnapshot(req.partnerContext!.partnerId));
  });

  app.get("/api/partner/me/clients", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const attrs = partnerAttributionStore.listByPartner(pid);
    res.json({ clients: attrs });
  });

  app.get("/api/partner/me/clients/:id", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const attrs = partnerAttributionStore.listByPartner(pid);
    const a = attrs.find((x) => x.companyId === String(req.params.id));
    if (!a) return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    // Read-only company snapshot
    const clientNotes = partnerNotesStore.listByPartner(pid, { scope: "client", scopeId: String(req.params.id) });
    res.json({
      attribution: a,
      companyId: String(req.params.id),
      snapshot: { stage: "unknown", sector: "unknown" }, // would call companyProfileStore here if available
      notes: clientNotes,
    });
  });

  // PIPELINE
  app.get("/api/partner/me/pipeline", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ pipeline: partnerPipelineStore.listByPartner(req.partnerContext!.partnerId), stages: ALL_PIPELINE_STAGES });
  });

  app.post(
    "/api/partner/me/pipeline",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { dealName, companyId, stage, estCheckSizeMinor, currency, sector, geography, expectedClose, notes } = req.body ?? {};
      if (!isString(dealName)) return badRequest(res, "dealName required");
      try {
        const deal = partnerPipelineStore.create(ctx.partnerId, {
          dealName,
          companyId: companyId ?? null,
          stage: stage ?? "sourcing",
          estCheckSizeMinor: isNumber(estCheckSizeMinor) ? estCheckSizeMinor : null,
          currency: currency ?? null,
          sector: sector ?? null,
          geography: geography ?? null,
          ownerUserId: ctx.userId,
          expectedClose: expectedClose ?? null,
          notes: notes ?? null,
        }, ctx.userId);
        res.status(201).json({ deal });
      } catch (e) {
        badRequest(res, (e as Error).message);
      }
    },
  );

  app.patch(
    "/api/partner/me/pipeline/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const deal = partnerPipelineStore.update(ctx.partnerId, String(req.params.id), req.body ?? {}, ctx.userId);
        res.json({ deal });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );

  app.delete(
    "/api/partner/me/pipeline/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        partnerPipelineStore.archive(ctx.partnerId, String(req.params.id), ctx.userId);
        res.json({ ok: true });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );

  app.post(
    "/api/partner/me/pipeline/:id/activities",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { activityType, body } = req.body ?? {};
      if (!isString(activityType) || !isString(body)) return badRequest(res, "activityType+body required");
      // Verify deal belongs to partner
      const deal = partnerPipelineStore.getById(ctx.partnerId, String(req.params.id));
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      const validActivityTypes = ["email", "note", "call", "meeting", "stage_change"] as const;
      if (!validActivityTypes.includes(activityType as typeof validActivityTypes[number])) {
        return badRequest(res, "activityType must be one of " + validActivityTypes.join("|"));
      }
      const a = partnerPipelineActivityStore.add(String(req.params.id), activityType as typeof validActivityTypes[number], body, ctx.userId);
      res.status(201).json({ activity: a });
    },
  );

  // ============================================================
  // PROMOTIONS / REFERRALS (Promote-to-Collective + Refer-to-Capavate)
  // ============================================================

  // POST /api/partner/me/pipeline/:id/promote-to-collective
  // Promotes a partner-owned pipeline deal to the Collective Deal Room.
  // Goes live immediately. Idempotent via PromotionConflictError -> 409.
  app.post(
    "/api/partner/me/pipeline/:id/promote-to-collective",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const dealId = String(req.params.id);
      // Verify deal is owned by this partner (URL injection guard)
      const deal = partnerPipelineStore.getById(ctx.partnerId, dealId);
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      const { notes } = (req.body ?? {}) as { notes?: unknown };
      try {
        const p = partnerDealPromotionsStore.create(
          ctx.partnerId,
          dealId,
          {
            promotionType: "collective_deal_room",
            companyId: deal.companyId ?? null,
            notes: isString(notes) ? notes : null,
          },
          ctx.userId,
        );
        res.status(201).json({ promotion: p });
      } catch (e) {
        if (e instanceof PromotionConflictError) {
          return res.status(409).json({ error: "PROMOTION_CONFLICT", message: e.message });
        }
        throw e;
      }
    },
  );

  // POST /api/partner/me/pipeline/:id/refer-to-capavate
  // Refers a partner-owned pipeline deal to Capavate for review.
  // Status=pending; an admin must approve via /api/admin/partner-referrals/:id/approve.
  app.post(
    "/api/partner/me/pipeline/:id/refer-to-capavate",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const dealId = String(req.params.id);
      const deal = partnerPipelineStore.getById(ctx.partnerId, dealId);
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      const { targetEmail, targetCompanyId, notes } = (req.body ?? {}) as {
        targetEmail?: unknown;
        targetCompanyId?: unknown;
        notes?: unknown;
      };
      try {
        const p = partnerDealPromotionsStore.create(
          ctx.partnerId,
          dealId,
          {
            promotionType: "capavate_referral",
            companyId: isString(targetCompanyId) ? targetCompanyId : (deal.companyId ?? null),
            targetEmail: isString(targetEmail) ? targetEmail : null,
            notes: isString(notes) ? notes : null,
          },
          ctx.userId,
        );
        res.status(201).json({ promotion: p });
      } catch (e) {
        if (e instanceof PromotionConflictError) {
          return res.status(409).json({ error: "PROMOTION_CONFLICT", message: e.message });
        }
        throw e;
      }
    },
  );

  // GET /api/partner/me/promotions — list the calling partner's promotions
  app.get("/api/partner/me/promotions", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    res.json({ promotions: partnerDealPromotionsStore.listByPartner(ctx.partnerId) });
  });

  // POST /api/partner/me/promotions/:id/withdraw — managing_partner only
  app.post(
    "/api/partner/me/promotions/:id/withdraw",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const promoId = String(req.params.id);
      const existing = partnerDealPromotionsStore.getById(promoId);
      if (!existing) return res.status(404).json({ error: "PROMOTION_NOT_FOUND" });
      if (existing.partnerId !== ctx.partnerId) {
        // Cross-partner isolation guard
        return res.status(404).json({ error: "PROMOTION_NOT_FOUND" });
      }
      try {
        const p = partnerDealPromotionsStore.withdraw(ctx.partnerId, promoId, ctx.userId);
        res.json({ promotion: p });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res.status(400).json({ error: "WITHDRAW_FAILED", message: msg });
      }
    },
  );

  // ============================================================
  // ADMIN: Partner Referrals (Capavate review queue)
  // ============================================================

  // GET /api/admin/partner-referrals — list pending capavate referrals
  app.get("/api/admin/partner-referrals", requireAdmin, (_req: Request, res: Response) => {
    res.json({ referrals: partnerDealPromotionsStore.listPendingCapavateReferrals() });
  });

  // POST /api/admin/partner-referrals/:id/approve
  app.post("/api/admin/partner-referrals/:id/approve", requireAdmin, (req: Request, res: Response) => {
    const promoId = String(req.params.id);
    const u = getUserContext(req);
    try {
      const p = partnerDealPromotionsStore.approve(promoId, u.userId);
      res.json({ promotion: p });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ error: "APPROVE_FAILED", message: msg });
    }
  });

  // POST /api/admin/partner-referrals/:id/reject
  app.post("/api/admin/partner-referrals/:id/reject", requireAdmin, (req: Request, res: Response) => {
    const promoId = String(req.params.id);
    const u = getUserContext(req);
    const { reason } = (req.body ?? {}) as { reason?: unknown };
    if (!isString(reason)) return badRequest(res, "reason required");
    try {
      const p = partnerDealPromotionsStore.reject(promoId, u.userId, reason);
      res.json({ promotion: p });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return res.status(400).json({ error: "REJECT_FAILED", message: msg });
    }
  });

  // TEAM
  app.get("/api/partner/me/team", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    res.json({
      members: partnerTeamStore.listByPartner(pid),
      invitations: partnerInvitationStore.listByPartner(pid),
    });
  });

  app.post(
    "/api/partner/me/team/invitations",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { email, subRole } = req.body ?? {};
      if (!isString(email)) return badRequest(res, "email required");
      const allowed: PartnerSubRole[] = ["managing_partner", "associate", "bd", "analyst", "viewer"];
      if (!allowed.includes(subRole)) return badRequest(res, "subRole invalid");
      try {
        assertTierSeats(ctx.partnerId);
      } catch (e) {
        return res.status(403).json({ error: (e as Error).message });
      }
      const ip = (req.ip ?? "").toString();
      const ua = String(req.headers["user-agent"] ?? "");
      const { invitation, plainToken } = partnerInvitationStore.create(
        ctx.partnerId, email, subRole as PartnerSubRole, ctx.userId, { ip, ua },
      );
      // Plain token is returned ONCE to the inviter so they can copy/send via email
      res.status(201).json({ invitation, plainToken });
    },
  );

  app.post(
    "/api/partner/me/team/invitations/:id/redeem",
    requireAuth,
    (req: Request, res: Response) => {
      // Compatibility route: the canonical redemption uses /api/auth/redeem-partner-invite/:token
      // This route is for invites that have already been looked up by id.
      res.status(410).json({ error: "USE_CANONICAL_REDEEM_ROUTE" });
    },
  );

  app.delete(
    "/api/partner/me/team/:userId",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const removed = partnerTeamStore.remove(ctx.partnerId, String(req.params.userId), ctx.userId);
      if (!removed) return res.status(404).json({ error: "TEAM_MEMBER_NOT_FOUND" });
      res.json({ member: removed });
    },
  );

  // NOTES
  app.get("/api/partner/me/notes", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const scope = String(req.query.scope ?? "") || undefined;
    const scopeId = String(req.query.scopeId ?? "") || undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.json({ notes: partnerNotesStore.listByPartner(ctx.partnerId, { scope: scope as any, scopeId }) });
  });

  app.post(
    "/api/partner/me/notes",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { scope, scopeId, title, body } = req.body ?? {};
      if (!isString(title) || !isString(body)) return badRequest(res, "title + body required");
      const note = partnerNotesStore.create(ctx.partnerId, { scope: scope ?? "general", scopeId: scopeId ?? null, title, body }, ctx.userId);
      res.status(201).json({ note });
    },
  );

  app.patch(
    "/api/partner/me/notes/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const note = partnerNotesStore.update(ctx.partnerId, String(req.params.id), req.body ?? {}, ctx.userId, ctx.partnerSubRole === "managing_partner");
        res.json({ note });
      } catch (e) {
        res.status(403).json({ error: (e as Error).message });
      }
    },
  );

  // TASKS
  app.get("/api/partner/me/tasks", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ tasks: partnerTasksStore.listByPartner(req.partnerContext!.partnerId) });
  });
  app.post(
    "/api/partner/me/tasks",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd", "analyst"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      // analyst cannot assign to other users
      const body = { ...(req.body ?? {}) };
      if (ctx.partnerSubRole === "analyst" && body.assignedToUserId && body.assignedToUserId !== ctx.userId) {
        return res.status(403).json({ error: "PARTNER_SUB_ROLE_INSUFFICIENT" });
      }
      const t = partnerTasksStore.create(ctx.partnerId, body, ctx.userId);
      res.status(201).json({ task: t });
    },
  );
  app.patch(
    "/api/partner/me/tasks/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd", "analyst"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const t = partnerTasksStore.update(ctx.partnerId, String(req.params.id), req.body ?? {}, ctx.userId);
        res.json({ task: t });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
    },
  );

  // FILES
  app.get("/api/partner/me/files", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ files: partnerFilesStore.listByPartner(req.partnerContext!.partnerId) });
  });
  app.post(
    "/api/partner/me/files",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { fileName, mimeType, sizeBytes, scope, scopeId, dataroomFileId } = req.body ?? {};
      if (!isString(fileName) || !isString(mimeType) || !isNumber(sizeBytes)) return badRequest(res, "fileName+mimeType+sizeBytes required");
      const f = partnerFilesStore.add(ctx.partnerId, {
        dataroomFileId: dataroomFileId ?? null,
        fileName, mimeType, sizeBytes,
        scope: scope ?? "private",
        scopeId: scopeId ?? null,
        uploadedBy: ctx.userId,
      }, ctx.userId);
      res.status(201).json({ file: f });
    },
  );
  app.get("/api/partner/me/files/:id/url", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const f = partnerFilesStore.getById(ctx.partnerId, String(req.params.id));
    if (!f) return res.status(404).json({ error: "FILE_NOT_FOUND" });
    // Return a fake pre-signed URL pattern; real dataroom integration would generate a 15-min TTL URL
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    res.json({ url: `/api/dataroom/files/${f.dataroomFileId ?? f.id}?ttl=900`, expiresAt });
  });

  // WORKSPACE SETTINGS
  app.get("/api/partner/me/workspace-settings", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ settings: partnerWorkspaceSettingsStore.get(req.partnerContext!.partnerId) });
  });
  app.patch(
    "/api/partner/me/workspace-settings",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const patch = req.body ?? {};
      const wlKeys = ["brandColor", "logoUrl", "customDomain", "whiteLabelEnabled"] as const;
      const touchesWl = wlKeys.some((k) => k in patch);
      const whiteLabelAllowed = TIER_RANK[ctx.tier] >= TIER_RANK["nexus"];
      if (touchesWl && !whiteLabelAllowed) {
        return res.status(403).json({ error: "PARTNER_TIER_INSUFFICIENT", details: { current: ctx.tier, required: "nexus" } });
      }
      try {
        const s = partnerWorkspaceSettingsStore.patch(ctx.partnerId, patch, ctx.userId, { whiteLabelAllowed });
        res.json({ settings: s });
      } catch (e) {
        res.status(403).json({ error: (e as Error).message });
      }
    },
  );

  // SPVs
  app.get("/api/partner/me/spvs", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ spvs: partnerSpvStore.listByPartner(req.partnerContext!.partnerId) });
  });
  app.post(
    "/api/partner/me/spvs",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { spvName, jurisdiction, vintage, currency, status, targetCompanyId, entityStructure, externalAdminProvider, externalAdminRef, notes } = req.body ?? {};
      if (!isString(spvName) || !isString(jurisdiction) || !isNumber(vintage) || !isISOCurrency(currency) || !isString(status)) {
        return badRequest(res, "spvName, jurisdiction, vintage, ISO 4217 currency, status required");
      }
      const validSpvStatus = ["planned", "open", "closed", "wound_down"] as const;
      if (!validSpvStatus.includes(status as typeof validSpvStatus[number])) {
        return badRequest(res, "status must be one of " + validSpvStatus.join("|"));
      }
      const spv = partnerSpvStore.create(ctx.partnerId, { spvName, jurisdiction, vintage, currency, status: status as typeof validSpvStatus[number], targetCompanyId, entityStructure, externalAdminProvider, externalAdminRef, notes }, ctx.userId);
      res.status(201).json({ spv });
    },
  );
  app.get("/api/partner/me/spvs/:id", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const spv = partnerSpvStore.getById(ctx.partnerId, String(req.params.id));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    res.json({ spv, positions: partnerSpvStore.listPositions(ctx.partnerId, String(req.params.id)) });
  });
  app.patch(
    "/api/partner/me/spvs/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const spv = partnerSpvStore.update(ctx.partnerId, String(req.params.id), req.body ?? {}, ctx.userId);
        res.json({ spv });
      } catch (e) { res.status(404).json({ error: (e as Error).message }); }
    },
  );
  app.get("/api/partner/me/spvs/:id/positions", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    try {
      res.json({ positions: partnerSpvStore.listPositions(ctx.partnerId, String(req.params.id)) });
    } catch (e) { res.status(404).json({ error: (e as Error).message }); }
  });
  app.post(
    "/api/partner/me/spvs/:id/positions",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { lpContactId, positionAmountMinor, currency, positionStatus, fxRateToSpvBase, notes } = req.body ?? {};
      if (!isString(lpContactId) || !isNumber(positionAmountMinor) || !isISOCurrency(currency)) {
        return badRequest(res, "lpContactId, positionAmountMinor (int minor), ISO 4217 currency required");
      }
      try {
        const pos = partnerSpvStore.addPosition(ctx.partnerId, String(req.params.id), { lpContactId, positionAmountMinor, currency, positionStatus, fxRateToSpvBase, notes }, ctx.userId);
        res.status(201).json({ position: pos });
      } catch (e) { res.status(400).json({ error: (e as Error).message }); }
    },
  );

  // FUNDS
  app.get("/api/partner/me/funds", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ funds: partnerFundsStore.listByPartner(req.partnerContext!.partnerId) });
  });
  app.post(
    "/api/partner/me/funds",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { fundName, fundType, jurisdiction, vintage, currency, status, targetSizeMinor, externalAdminProvider, externalAdminRef, notes } = req.body ?? {};
      if (!isString(fundName) || !isString(fundType) || !isString(jurisdiction) || !isNumber(vintage) || !isISOCurrency(currency) || !isString(status)) {
        return badRequest(res, "fundName, fundType, jurisdiction, vintage, ISO 4217 currency, status required");
      }
      const validFundType = ["evergreen", "closed_end", "rolling"] as const;
      const validFundStatus = ["planning", "raising", "investing", "harvesting", "wound_down"] as const;
      if (!validFundType.includes(fundType as typeof validFundType[number])) {
        return badRequest(res, "fundType must be one of " + validFundType.join("|"));
      }
      if (!validFundStatus.includes(status as typeof validFundStatus[number])) {
        return badRequest(res, "status must be one of " + validFundStatus.join("|"));
      }
      const f = partnerFundsStore.create(ctx.partnerId, { fundName, fundType: fundType as typeof validFundType[number], jurisdiction, vintage, currency, status: status as typeof validFundStatus[number], targetSizeMinor, externalAdminProvider, externalAdminRef, notes }, ctx.userId);
      res.status(201).json({ fund: f });
    },
  );
  app.get("/api/partner/me/funds/:id", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const f = partnerFundsStore.getById(ctx.partnerId, String(req.params.id));
    if (!f) return res.status(404).json({ error: "FUND_NOT_FOUND" });
    res.json({ fund: f, commitments: partnerFundsStore.listCommitments(ctx.partnerId, String(req.params.id)) });
  });
  app.patch(
    "/api/partner/me/funds/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const f = partnerFundsStore.update(ctx.partnerId, String(req.params.id), req.body ?? {}, ctx.userId);
        res.json({ fund: f });
      } catch (e) { res.status(404).json({ error: (e as Error).message }); }
    },
  );
  app.get("/api/partner/me/funds/:id/commitments", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    try {
      res.json({ commitments: partnerFundsStore.listCommitments(ctx.partnerId, String(req.params.id)) });
    } catch (e) { res.status(404).json({ error: (e as Error).message }); }
  });
  app.post(
    "/api/partner/me/funds/:id/commitments",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { lpContactId, commitmentMinor, currency, isRolling, rollingPeriod, fxRateToFundBase, notes } = req.body ?? {};
      if (!isString(lpContactId) || !isNumber(commitmentMinor) || !isISOCurrency(currency)) {
        return badRequest(res, "lpContactId, commitmentMinor (int minor), ISO 4217 currency required");
      }
      try {
        const c = partnerFundsStore.pledge(ctx.partnerId, String(req.params.id), { lpContactId, commitmentMinor, currency, isRolling, rollingPeriod, fxRateToFundBase, notes }, ctx.userId);
        res.status(201).json({ commitment: c });
      } catch (e) { res.status(400).json({ error: (e as Error).message }); }
    },
  );

  /* ============================================================
   * Magic-link redemption (auth-required)
   * ============================================================ */

  app.post("/api/auth/redeem-partner-invite/:token", requireAuth, (req: Request, res: Response) => {
    const ctx = getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const ip = (req.ip ?? "").toString();
    const ua = String(req.headers["user-agent"] ?? "");
    try {
      const inv = partnerInvitationStore.redeem(String(req.params.token), ctx.userId, { ip, ua });
      res.json({ ok: true, partnerId: inv.partnerId, subRole: inv.subRole });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "PARTNER_INVITATION_EXPIRED") return res.status(410).json({ error: msg });
      if (msg === "PARTNER_INVITATION_ALREADY_REDEEMED") return res.status(409).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });
}
