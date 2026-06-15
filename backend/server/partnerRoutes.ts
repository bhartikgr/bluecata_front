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
/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto"; /* v25.14 NC1 — secure team-invite redeem password */
import { requireAdmin, requireAuth } from "./lib/authMiddleware";
import { requirePartnerAuth, assertSubRole, assertTier, assertTierSeats } from "./lib/requirePartnerAuth";
import { getUserContext } from "./lib/userContext";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { TIER_RANK, type PartnerTier, type PartnerType, type PartnerSubRole, getById } from "./adminContactsStoreShim";
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
  hashInviteToken,
} from "./partnerWorkspaceStore";
import { getAllContacts, listContacts, updateContact, createContact, upsertConsortiumPartner } from "./adminContactsStore";
import { registerPersona, getUserContextForId } from "./lib/userContext";
import { rawDb } from "./db/connection";
import { setSessionCookie } from "./lib/sessionCookie";
import { getCompanyRecordById } from "./multiCompanyStore";
import { getCompanyProfile } from "./companyProfileStore"; /* v25.15 NM5 — real snapshot data */
import { linkConsortiumPartner, unlinkConsortiumPartner, getConsortiumPartnerId } from "./consortiumLinkStore";
import { upsertInvestorContactFromPartner, removeInvestorContactForPartner } from "./founderCrmStore";

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

  /* ------------------------------------------------------------------
   * v23.9 A4/CP-5 — link a Capavate company to a consortium partner.
   * ------------------------------------------------------------------ */
  app.get("/api/admin/companies/:id", requireAdmin, (req: Request, res: Response) => {
    const companyId = String(req.params.id);
    const rec = getCompanyRecordById(companyId);
    if (!rec) return res.status(404).json({ error: "COMPANY_NOT_FOUND" });
    const consortiumPartnerId = getConsortiumPartnerId(companyId);
    const consortiumPartner = consortiumPartnerId
      ? getAllContacts().find((c) => c.id === consortiumPartnerId && c.kind === "consortium_partner") ?? null
      : null;
    res.json({ company: { ...rec, consortiumPartnerId, consortiumPartner } });
  });

  app.post("/api/admin/companies/:id/consortium-partner", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ error: "missing_identity" });
    const companyId = String(req.params.id);
    const partnerId = String((req.body ?? {}).partnerId ?? "");
    if (!partnerId) return badRequest(res, "partnerId required");
    const company = getCompanyRecordById(companyId);
    if (!company) return res.status(404).json({ error: "COMPANY_NOT_FOUND" });
    const partner = getAllContacts().find((c) => c.id === partnerId && c.kind === "consortium_partner");
    if (!partner) return res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    /* v25.23 NH-M — linkConsortiumPartner now fails closed (DB write first,
     * throws on persist failure). Surface a 500 instead of proceeding with a
     * lost link so the caller knows the sponsor attribution did not persist. */
    try {
      linkConsortiumPartner(companyId, partnerId);
    } catch (linkErr) {
      return res.status(500).json({ error: "CONSORTIUM_LINK_PERSIST_FAILED", message: (linkErr as Error).message });
    }
    // v23.9 C8/CP-6 — surface the sponsor in the founder's CRM.
    try {
      upsertInvestorContactFromPartner(companyId, {
        partnerId: partner.id,
        name: partner.displayName || partner.legalName,
        email: partner.email ?? "",
        region: (partner as { region?: string }).region ?? null,
      });
    } catch { /* non-fatal — link still succeeds */ }
    appendAdminAudit(actor, `company:${companyId}`, "company.consortium_partner_linked", { partnerId });
    // v25.14 NM1 / F7-NM1 — emit bridge event so Collective + Capavate can
    // react in real-time to consortium attribution changes.
    try {
      emitBridgeEvent({
        eventType: "partner.company_linked",
        aggregateId: companyId,
        aggregateKind: "company",
        payload: { companyId, partnerId, actor },
      });
    } catch { /* non-fatal */ }
    res.json({ ok: true, company: { ...company, consortiumPartnerId: partnerId, consortiumPartner: partner } });
  });

  app.delete("/api/admin/companies/:id/consortium-partner", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ error: "missing_identity" });
    const companyId = String(req.params.id);
    const company = getCompanyRecordById(companyId);
    if (!company) return res.status(404).json({ error: "COMPANY_NOT_FOUND" });
    /* v25.16 cross-comp NH1 — capture the partner id BEFORE the link is
       severed so we can correctly tear down the corresponding CRM contact
       and revoke the partner-attribution row. */
    const prevPartnerId = getConsortiumPartnerId(companyId);
    const removed = unlinkConsortiumPartner(companyId);
    let crmRemoved = false;
    let attributionRevoked = false;
    if (prevPartnerId) {
      try {
        crmRemoved = removeInvestorContactForPartner(companyId, prevPartnerId).removed;
      } catch { /* non-fatal */ }
      try {
        partnerAttributionStore.revoke(prevPartnerId, companyId, actor);
        attributionRevoked = true;
      } catch (e) {
        // ATTRIBUTION_NOT_FOUND is expected when no attribution was ever
        // created (e.g. partner linked but never sourced a deal). Silently
        // continue; any other error is surfaced in the audit detail.
        const msg = (e as Error).message;
        if (msg !== "ATTRIBUTION_NOT_FOUND") {
          appendAdminAudit(actor, `company:${companyId}`, "company.consortium_partner_unlink_attr_warn", { partnerId: prevPartnerId, msg });
        }
      }
    }
    appendAdminAudit(actor, `company:${companyId}`, "company.consortium_partner_unlinked", {
      removed,
      prevPartnerId,
      crmRemoved,
      attributionRevoked,
    });
    // v25.14 NM1 / F7-NM1 — emit bridge event so downstream surfaces can
    // drop consortium attribution badges, etc.
    try {
      emitBridgeEvent({
        eventType: "partner.company_unlinked",
        aggregateId: companyId,
        aggregateKind: "company",
        payload: { companyId, removed, prevPartnerId, crmRemoved, attributionRevoked, actor },
      });
    } catch { /* non-fatal */ }
    res.json({ ok: true, company: { ...company, consortiumPartnerId: null, consortiumPartner: null } });
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
      // v25.14 F8-NM2 — emit bridge event so Collective / Capavate downstream
      // surfaces (deal feeds, attribution badges, etc.) can react instead of
      // waiting for a server restart re-hydration.
      try {
        emitBridgeEvent({
          eventType: "partner.suspended",
          aggregateId: String(req.params.id),
          aggregateKind: "platform",
          payload: { partnerId: String(req.params.id), suspendedBy: actor },
        });
      } catch { /* non-fatal */ }
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  // v25.14 F8-NH3 — reactivate (unsuspend) endpoint. Without this, every
  // suspension was effectively permanent and admins needed raw SQL to
  // restore a partner. Mirror of suspend, sets status back to "active" and
  // emits the matching bridge event.
  app.post("/api/admin/partners/:id/reactivate", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? "");
    if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { status: "active" }, actor, "partner.reactivated");
      try {
        emitBridgeEvent({
          eventType: "partner.reactivated",
          aggregateId: String(req.params.id),
          aggregateKind: "platform",
          payload: { partnerId: String(req.params.id), reactivatedBy: actor },
        });
      } catch { /* non-fatal */ }
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  app.post("/api/admin/partners/:id/archive", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    try {
      const updated = updateContact(String(req.params.id), { status: "archived" }, actor, "partner.archived");
      // v25.14 F8-NM2 — emit bridge event on archive too (same gap as suspend).
      try {
        emitBridgeEvent({
          eventType: "partner.archived",
          aggregateId: String(req.params.id),
          aggregateKind: "platform",
          payload: { partnerId: String(req.params.id), archivedBy: actor },
        });
      } catch { /* non-fatal */ }
      res.json({ partner: updated });
    } catch {
      res.status(404).json({ error: "PARTNER_NOT_FOUND" });
    }
  });

  /**
   * GET /api/admin/partners/:partnerId/workspace/audit
   *
   * v24.5 GAP-4 — Read-only audit snapshot of a partner workspace.
   * Admin-only. Returns team_members + notes + tasks + files from the DB
   * even when the partner status is "archived". Does NOT enforce any
   * partner-side workspace gate so archived partners remain fully auditable.
   *
   * Implementation note: the in-memory stores (loaded by
   * hydratePartnerWorkspaceStoreV241) already hold data for all partners
   * regardless of archive status. We also do a direct DB read so the
   * response stays correct after a restart even if the in-memory state
   * was not re-populated (e.g. a hot-swap deploy where only the new DB
   * row was written by a sibling process). The DB layer is the source of
   * truth; in-memory results supplement it.
   */
  app.get("/api/admin/partners/:partnerId/workspace/audit", requireAdmin, (req: Request, res: Response) => {
    const partnerId = String(req.params.partnerId || "").trim();
    if (!partnerId) return res.status(400).json({ error: "partnerId_required" });

    // Verify the partner exists in adminContactsStore (any status, including archived).
    const contact = getById(partnerId);
    if (!contact || contact.kind !== "consortium_partner") {
      return res.status(404).json({ error: "PARTNER_NOT_FOUND", partnerId });
    }

    // Read workspace data from in-memory stores (hydrated from DB on boot).
    const teamMembers = partnerTeamStore.listByPartner(partnerId);
    const notes       = partnerNotesStore.listByPartner(partnerId);
    const tasks       = partnerTasksStore.listByPartner(partnerId);
    const files       = partnerFilesStore.listByPartner(partnerId);

    // Supplement with a direct DB read so archived partners that were
    // never loaded into RAM (e.g. archived before server boot) are covered.
    let dbTeamMembers: unknown[] = [];
    let dbNotes:       unknown[] = [];
    let dbTasks:       unknown[] = [];
    let dbFiles:       unknown[] = [];
    try {
      const db = rawDb();
      dbTeamMembers = (db.prepare(
        `SELECT id, partner_id, user_id, sub_role, status, joined_at, removed_at FROM partner_team_members WHERE partner_id = ?`,
      ).all(partnerId) as unknown[]) ?? [];
      dbNotes = (db.prepare(
        `SELECT id, partner_id, note_json FROM partner_notes WHERE partner_id = ?`,
      ).all(partnerId) as Array<{ note_json: string }>).map((r) => {
        try { return JSON.parse(r.note_json); } catch { return r; }
      });
      dbTasks = (db.prepare(
        `SELECT id, partner_id, task_json FROM partner_tasks WHERE partner_id = ?`,
      ).all(partnerId) as Array<{ task_json: string }>).map((r) => {
        try { return JSON.parse(r.task_json); } catch { return r; }
      });
      /* v25.16 cross-comp NH3 — exclude tombstoned files from the admin audit
         view so soft-deleted rows (v25.15 NH2) do not resurface via this path. */
      dbFiles = (db.prepare(
        `SELECT id, partner_id, file_json FROM partner_files WHERE partner_id = ?`,
      ).all(partnerId) as Array<{ file_json: string }>)
        .map((r) => {
          try { return JSON.parse(r.file_json); } catch { return r; }
        })
        .filter((f: any) => !f || !f.deletedAt);
    } catch { /* DB may not be available — use in-memory data only */ }

    // Deduplicate: prefer in-memory rows (which carry richer runtime fields),
    // then append DB-only rows not yet in RAM.
    const memTeamIds = new Set(teamMembers.map((m) => m.id));
    const memNoteIds = new Set(notes.map((n) => n.id));
    const memTaskIds = new Set(tasks.map((t) => t.id));
    const memFileIds = new Set(files.map((f) => f.id));

    return res.json({
      ok: true,
      partnerId,
      partnerStatus: contact.status,
      auditedAt: new Date().toISOString(),
      teamMembers: [
        ...teamMembers,
        ...(dbTeamMembers as Array<{ id?: string }>).filter((r) => r.id && !memTeamIds.has(r.id)),
      ],
      notes: [
        ...notes,
        ...(dbNotes as Array<{ id?: string }>).filter((r) => r.id && !memNoteIds.has(r.id)),
      ],
      tasks: [
        ...tasks,
        ...(dbTasks as Array<{ id?: string }>).filter((r) => r.id && !memTaskIds.has(r.id)),
      ],
      files: [
        ...files,
        ...(dbFiles as Array<{ id?: string }>).filter((r) => r.id && !memFileIds.has(r.id)),
      ],
    });
  });

  app.post("/api/admin/partners/:id/attributions", requireAdmin, (req: Request, res: Response) => {
    const { companyId, source, notes } = req.body ?? {};
    if (!isString(companyId)) return badRequest(res, "companyId required");
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const partnerId = String(req.params.id);
    const a = partnerAttributionStore.create(partnerId, companyId, actor, source ?? "admin_manual", notes ?? null);
    // v25.14 NM2 — notify the partner's managing_partner team members so
    // they don't have to poll the admin attribution page to discover a
    // newly-granted attribution.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { emitNotification } = require("./notificationsStore");
      const team = partnerTeamStore.listByPartner(partnerId);
      for (const tm of team) {
        if (tm.subRole === "managing_partner" && tm.status === "active") {
          try {
            emitNotification({
              userId: tm.userId,
              kind: "partner.attribution_granted",
              title: "New company attribution granted",
              body: `Your partner workspace was granted attribution for company ${companyId}.`,
              link: "/collective/partner/clients",
            });
          } catch { /* per-recipient failures non-fatal */ }
        }
      }
    } catch { /* notification optional; attribution itself already persisted */ }
    res.status(201).json({ attribution: a });
  });

  app.delete("/api/admin/partners/:id/attributions/:companyId", requireAdmin, (req: Request, res: Response) => {
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const partnerId = String(req.params.id);
    const companyId = String(req.params.companyId);
    try {
      const a = partnerAttributionStore.revoke(partnerId, companyId, actor);
      // v25.14 NM2 — notify the partner's managing_partner team members
      // about revocation as well.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { emitNotification } = require("./notificationsStore");
        const team = partnerTeamStore.listByPartner(partnerId);
        for (const tm of team) {
          if (tm.subRole === "managing_partner" && tm.status === "active") {
            try {
              emitNotification({
                userId: tm.userId,
                kind: "partner.attribution_revoked",
                title: "Company attribution revoked",
                body: `Attribution for company ${companyId} was revoked from your partner workspace.`,
                link: "/collective/partner/clients",
              });
            } catch { /* per-recipient failures non-fatal */ }
          }
        }
      } catch { /* notification optional */ }
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
    const companyId = String(req.params.id);
    const attrs = partnerAttributionStore.listByPartner(pid);
    const a = attrs.find((x) => x.companyId === companyId);
    if (!a) return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    // v25.15 NM5 — real read-only company snapshot from profile + membership
    const clientNotes = partnerNotesStore.listByPartner(pid, { scope: "client", scopeId: companyId });
    const profile = getCompanyProfile(companyId);
    const record = getCompanyRecordById(companyId);
    res.json({
      attribution: a,
      companyId,
      snapshot: {
        companyId,
        companyName: record?.companyName ?? null,
        legalName: record?.legalName ?? null,
        logoUrl: record?.logoUrl ?? null,
        stage: profile.stage ?? "unknown",
        sector: profile.sector ?? "unknown",
        jurisdiction: profile.jurisdiction ?? null,
        founderName: profile.founderName ?? null,
        founderEmail: profile.founderEmail ?? null,
        employees: profile.employees ?? null,
        runwayMonths: profile.runwayMonths ?? null,
        healthScore: profile.healthScore ?? null,
        complianceScore: profile.complianceScore ?? null,
        kycStatus: profile.kycStatus ?? null,
        kybStatus: profile.kybStatus ?? null,
        lastRaiseDate: profile.lastRaiseDate ?? null,
        lastRaiseAmount: profile.lastRaiseAmount ?? null,
        valuationMinor: profile.valuationMinor ?? null,
      },
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
      // v25.14 F3-NC1 — the referral approve path used to ONLY flip status
      // to "live" and write an audit row. The downstream Capavate referral
      // (founder invite + provisional attribution + cross-component bridge
      // event + recipient notification) never fired. We now do all four,
      // in best-effort try/catch so a failure in any one does not block
      // the approval itself (which is already persisted).
      try {
        if (p.promotionType === "capavate_referral" && p.targetEmail) {
          // 1. Provisional attribution: if a company is named on the
          //    referral, write an attribution row so the partner gets
          //    credit the moment the founder signs up against the same
          //    companyId. If only an email is known, write a
          //    provisional row keyed by email so the founder signup
          //    flow can promote it later.
          try {
            if (p.companyId) {
              // v25.14 — source must be a member of the attributionSource
              // union: admin_manual | referral_code | partner_claim.
              partnerAttributionStore.create(
                p.partnerId,
                p.companyId,
                u.userId,
                "partner_claim",
                `Referral promotion ${p.id} approved; targetEmail=${p.targetEmail}`,
              );
            } else {
              /* v25.16 cross-comp NM1 — email-only referral: persist a
                 provisional attribution row keyed by lowercased email so the
                 founder signup flow can promote it to a real attribution
                 when that account is created. Stored via the kv shim
                 (provisionalPartnerAttributions) so it survives restart
                 without requiring a new DB migration. */
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { persistEntry } = require("./lib/storePersistenceShim");
                const key = `${p.targetEmail.toLowerCase()}::${p.partnerId}`;
                persistEntry("provisionalPartnerAttributions", key, {
                  email: p.targetEmail.toLowerCase(),
                  partnerId: p.partnerId,
                  promotionId: p.id,
                  source: "partner_claim",
                  approvedBy: u.userId,
                  approvedAt: new Date().toISOString(),
                });
              } catch { /* non-fatal */ }
            }
          } catch { /* attribution may already exist; non-fatal */ }

          // 2. In-app notification to the target if they already have an
          //    account on the platform.
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { emitNotification } = require("./notificationsStore");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { rawDb } = require("./db/connection");
            const db = rawDb();
            const row = db
              .prepare("SELECT user_id FROM user_credentials WHERE email = ? LIMIT 1")
              .get(p.targetEmail) as { user_id?: string } | undefined;
            if (row?.user_id) {
              emitNotification({
                userId: row.user_id,
                kind: "partner.referral_received",
                title: "You've been referred to Capavate",
                body: `A Consortium Partner has referred you to Capavate. Sign in or sign up to claim your invite.`,
                link: "/founder/dashboard",
              });
            }
          } catch { /* notification optional; non-fatal */ }

          // 3. Bridge event so Capavate / Collective downstream surfaces
          //    can react to the approved referral.
          try {
            emitBridgeEvent({
              eventType: "partner.referral.approved",
              aggregateId: p.id,
              aggregateKind: "platform",
              payload: {
                promotionId: p.id,
                partnerId: p.partnerId,
                targetEmail: p.targetEmail,
                companyId: p.companyId ?? null,
                approvedBy: u.userId,
              },
            });
          } catch { /* bridge optional */ }

          // 4. Best-effort outbound invite email. The sendEmail stub
          //    silently no-ops if SMTP is not configured.
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { sendEmail } = require("./lib/emailSender");
            const inviteUrl = `${(process.env.PUBLIC_BASE_URL ?? "https://capavate.com")}/auth/signup?ref=partner&promoId=${encodeURIComponent(p.id)}&email=${encodeURIComponent(p.targetEmail)}`;
            sendEmail({
              to: p.targetEmail,
              subject: "You've been referred to Capavate",
              text:
                `Hello,\n\nA Consortium Partner has referred you to Capavate. ` +
                `Use the link below to claim your invite:\n\n${inviteUrl}\n\nThanks,\nCapavate Team`,
            });
          } catch { /* email optional */ }
        }
      } catch { /* swallow — approval itself already succeeded */ }
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
    /* v25.16 NL1 — expose `email` alias alongside `invitedEmail` so callers
       using either name see the address. v25.16 NH5 — listByPartner now
       filters redeemed/expired by default. */
    const invitations = partnerInvitationStore.listByPartner(pid).map((inv) => ({
      ...inv,
      email: inv.invitedEmail,
    }));
    res.json({
      members: partnerTeamStore.listByPartner(pid),
      invitations,
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
      /* v25.23 NL-U fix — surface the server-side last-managing_partner guard
       * (partnerTeamStore.remove throws LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED)
       * with a 409 + machine-readable error so the UI can render the right copy. */
      try {
        const removed = partnerTeamStore.remove(ctx.partnerId, String(req.params.userId), ctx.userId);
        if (!removed) return res.status(404).json({ error: "TEAM_MEMBER_NOT_FOUND" });
        res.json({ member: removed });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "LAST_MANAGING_PARTNER_CANNOT_BE_REMOVED") {
          return res.status(409).json({
            error: msg,
            message:
              "This is the only managing partner left. Promote another team member to managing partner first.",
          });
        }
        throw e;
      }
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

  app.delete(
    "/api/partner/me/notes/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      // Notes are soft-deleted by overwriting body to indicate deletion.
      // Full delete: remove from store by filtering out (store.listByPartner excludes it).
      // For now, just mark it archived by patching an internal flag.
      // The store doesn't support hard delete — we zero out the body as a tombstone.
      try {
        const note = partnerNotesStore.update(
          ctx.partnerId,
          String(req.params.id),
          { body: "[DELETED]", title: "[DELETED]", scope: "general" },
          ctx.userId,
          ctx.partnerSubRole === "managing_partner",
        );
        res.json({ ok: true, note });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
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
        // v25.14 NL2 — distinguish tombstoned (410) from forbidden (403) and
        // not-found (404) so the client can show a sensible error.
        const msg = (e as Error).message;
        if (msg === "NOTE_NOT_FOUND") return res.status(404).json({ error: msg });
        if (msg === "NOTE_TOMBSTONED") return res.status(410).json({ error: msg });
        res.status(403).json({ error: msg });
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
    assertSubRole("managing_partner", "associate", "bd"),
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
  app.delete(
    "/api/partner/me/tasks/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const t = partnerTasksStore.update(ctx.partnerId, String(req.params.id), { status: "cancelled" }, ctx.userId);
        res.json({ ok: true, task: t });
      } catch (e) {
        res.status(404).json({ error: (e as Error).message });
      }
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

  // v25.15 NH2 — DELETE /api/partner/me/files/:id (soft delete). Restricted to
  // managing_partner so analysts/viewers cannot remove files. Idempotent: a
  // second call on the same id returns the already-tombstoned row.
  app.delete(
    "/api/partner/me/files/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      try {
        const f = partnerFilesStore.remove(ctx.partnerId, String(req.params.id), ctx.userId);
        return res.json({ ok: true, file: f });
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "FILE_NOT_FOUND") return res.status(404).json({ error: msg });
        return res.status(400).json({ error: msg });
      }
    },
  );

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
    assertSubRole("managing_partner"),
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
    assertSubRole("managing_partner"),
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
    assertSubRole("managing_partner"),
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

  /* ==========================================================
   * v25.23 NC-A fix — SPV capital-calls + distributions.
   * The previous stub handlers here (registered first) WON Express
   * dispatch over the real DB-backed handlers in spvFundStore.ts:1341
   * / 1381, returning 201 without persisting anything. That violated
   * the NO-MOCK-DATA / NO-MEMORY-STORAGE standing rules and lost
   * financial records on the most sensitive money surface.
   *
   * The fix has two parts:
   *   1. Remove these stubs here so spvFundStore's real DB-backed
   *      handlers take effect (registered at routes.ts:640 via
   *      registerSpvFundRoutes).
   *   2. Add `assertSubRole("managing_partner")` to the real handlers
   *      in spvFundStore.ts (separate edit) so the financial gate is
   *      preserved — v25.14 NH3 only covered POST commitments; this
   *      wave covers PATCH commitments + capital-calls + distributions.
   *
   * The single source of truth is now spvFundStore.
   * ========================================================== */

  /* ============================================================
   * Magic-link redemption
   * v23.9 A5/CP-3 — PUBLIC. A freshly-invited consortium partner has no
   * account yet, so requiring auth here was a bootstrapping deadlock (they
   * could never onboard). The signed invite token IS the credential: we look
   * it up, mint/resolve a persona seeded from the invited email, set the
   * session cookie, then redeem — mirroring the public /api/auth/redeem flow.
   * ============================================================ */

  app.post("/api/auth/redeem-partner-invite/:token", (req: Request, res: Response) => {
    const token = String(req.params.token ?? "");
    if (!token) return res.status(400).json({ error: "MISSING_TOKEN" });

    // Resolve the invitation up-front so we know which email to mint against.
    const pending = partnerInvitationStore.findByTokenHash(hashInviteToken(token));
    if (!pending) {
      // A7 (v24.0) — consortium-approval fallback. Approved-partner invites are
      // minted into auth_redeem_tokens (intent='partner_invite', sha256 of raw),
      // a DIFFERENT store/hash scheme than partnerInvitationStore team invites.
      // Without this branch every approved-partner link returned
      // PARTNER_INVITATION_INVALID_TOKEN. Look the token up there and consume it.
      try {
        const approvalHash = createHash("sha256").update(token).digest("hex");
        const db = rawDb();
        const row = db
          .prepare(
            `SELECT id, email, intent, consumed_at, expires_at FROM auth_redeem_tokens WHERE token_hash = ? AND intent = 'partner_invite'`,
          )
          .get(approvalHash) as
          | { id: string; email: string; intent: string; consumed_at: string | null; expires_at: string }
          | undefined;
        if (!row) return res.status(404).json({ error: "PARTNER_INVITATION_INVALID_TOKEN" });
        if (row.consumed_at) return res.status(409).json({ error: "PARTNER_INVITATION_ALREADY_REDEEMED" });
        if (new Date(row.expires_at).getTime() < Date.now())
          return res.status(410).json({ error: "PARTNER_INVITATION_EXPIRED" });

        // Mint/resolve the persona for the invited email and consume the token.
        const existingCtx = getUserContext(req);
        /* v25.23 NC-B fix — email-binding gate (privilege escalation hole).
         * Previously: if the caller was already authenticated, we redeemed AS
         * that user even if their email did not match the invited email. A
         * Collective member or other-partner user who obtained the link could
         * join the target workspace bound to their own account. Single-use
         * tokens stop replay, not redirection. Now we require the authed
         * session's email to (case-insensitively) match the invited email, or
         * the redeem is rejected with PARTNER_INVITATION_EMAIL_MISMATCH so the
         * caller can log out and redeem cleanly. The audit chain (and the
         * partnerInvitationStore.redeem path below) already covers logging. */
        if (
          existingCtx.isAuthed &&
          (existingCtx.identity?.email ?? "").trim().toLowerCase() !== (row.email ?? "").trim().toLowerCase()
        ) {
          return res.status(403).json({
            error: "PARTNER_INVITATION_EMAIL_MISMATCH",
            message: "This invitation was sent to a different email. Please log out and redeem with the invited address.",
          });
        }
        const approvedUserId = existingCtx.isAuthed
          ? existingCtx.userId
          : registerPersona({
              email: row.email,
              name: row.email,
              // Strong random password (C15) — the partner can re-set via the
              // set-password flow; the single-use token is the real credential.
              password: createHash("sha256").update(`${token}:${Date.now()}:${Math.random()}`).digest("hex"),
              invitationId: row.id,
              roundId: "",
              companyId: "",
            });
        /* v25.24 NH-4 fix — atomic single-use consume on the consortium-approval
         * redeem branch. The v25.23 NH-L atomic redeem covered only the
         * partner-invite store (`partnerInvitationStore.redeem` via
         * better-sqlite3 IMMEDIATE tx). This branch (auth_redeem_tokens with
         * intent='partner_invite' from `mintPartnerInviteToken`) used a plain
         * `UPDATE ... WHERE id = ?` with NO `consumed_at IS NULL` guard. Two
         * concurrent redeems could both observe `row.consumed_at == null`,
         * both compute their userId in registerPersona, and both UPDATE the
         * same row — second wins, but BOTH responded 200 to their respective
         * callers. Now we use `WHERE id = ? AND consumed_at IS NULL` and
         * check `changes` (better-sqlite3 result) to detect lost-race; if
         * the conditional UPDATE doesn't affect a row, another caller won. */
        const consumeRes = db
          .prepare(
            `UPDATE auth_redeem_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL`,
          )
          .run(new Date().toISOString(), row.id);
        if (consumeRes && typeof consumeRes.changes === "number" && consumeRes.changes === 0) {
          return res.status(409).json({ error: "PARTNER_INVITATION_ALREADY_REDEEMED" });
        }

        // Ensure partner-workspace authz records exist (idempotent with A8). The
        // approval path already creates these, but guarantee it here so redeem
        // never lands the user in a 403 partner workspace.
        let partnerId: string | null = null;
        try {
          const contact = upsertConsortiumPartner({ legalName: row.email, email: row.email }, approvedUserId);
          partnerTeamStore.upsertOwner(approvedUserId, contact.id, "managing_partner");
          partnerId = contact.id;
        } catch (authzErr) {
          // Non-fatal: an existing membership (from approval) still authorizes.
          const existingMember = partnerTeamStore.findByUserId(approvedUserId);
          partnerId = existingMember?.partnerId ?? null;
        }

        if (!existingCtx.isAuthed) setSessionCookie(res, approvedUserId);
        const ctx = getUserContextForId(approvedUserId);
        return res.json({ ok: true, partnerId, subRole: "managing_partner", ctx });
      } catch (fallbackErr) {
        return res.status(404).json({ error: "PARTNER_INVITATION_INVALID_TOKEN" });
      }
    }
    if (pending.redeemedAt) return res.status(409).json({ error: "PARTNER_INVITATION_ALREADY_REDEEMED" });
    if (Date.parse(pending.expiresAt) < Date.now()) return res.status(410).json({ error: "PARTNER_INVITATION_EXPIRED" });

    // If the caller is already authenticated, redeem as that user; otherwise
    // the token mints the partner's account.
    const existing = getUserContext(req);
    /* v25.23 NC-B fix — email-binding gate. Same rationale as the approved-
     * partner fallback branch above: single-use tokens stop replay, not
     * redirection. An authed caller with a non-matching email must log out
     * first. */
    if (
      existing.isAuthed &&
      (existing.identity?.email ?? "").trim().toLowerCase() !== (pending.invitedEmail ?? "").trim().toLowerCase()
    ) {
      return res.status(403).json({
        error: "PARTNER_INVITATION_EMAIL_MISMATCH",
        message: "This invitation was sent to a different email. Please log out and redeem with the invited address.",
      });
    }
    // v25.14 NC1 — was hardcoded to "changeme" giving full account takeover
    // to anyone who knew an invited team member's email. Now mints a strong
    // random password; the user is expected to use the invite link itself to
    // first-time-sign-in, and can reset via the password-reset flow after.
    const userId = existing.isAuthed
      ? existing.userId
      : registerPersona({
          email: pending.invitedEmail,
          name: pending.invitedEmail,
          password: createHash("sha256").update(randomBytes(32)).digest("hex"),
          invitationId: pending.id,
          roundId: "",
          companyId: "",
        });

    const ip = (req.ip ?? "").toString();
    const ua = String(req.headers["user-agent"] ?? "");
    try {
      /* v25.16 NH1 — close the TOCTOU seat race: re-check tier seat limit at
         redeem (not just at invite-create) so a downgrade-then-redeem or
         concurrent-redeem cannot blow past the tier seat ceiling. */
      try {
        assertTierSeats(pending.partnerId);
      } catch (seatErr) {
        return res.status(403).json({ error: (seatErr as Error).message ?? "TIER_SEAT_LIMIT_EXCEEDED" });
      }
      const inv = partnerInvitationStore.redeem(token, userId, { ip, ua });
      if (!existing.isAuthed) setSessionCookie(res, userId);
      const ctx = getUserContextForId(userId);
      res.json({ ok: true, partnerId: inv.partnerId, subRole: inv.subRole, ctx });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "PARTNER_INVITATION_EXPIRED") return res.status(410).json({ error: msg });
      if (msg === "PARTNER_INVITATION_ALREADY_REDEEMED") return res.status(409).json({ error: msg });
      res.status(400).json({ error: msg });
    }
  });
}
