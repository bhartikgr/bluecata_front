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
import { requirePartnerAuth, requirePartnerSelf, assertSubRole, assertTier, assertTierSeats, assertSeatCapacity } from "./lib/requirePartnerAuth";
import { requireSignedAgreement } from "./lib/requireSignedAgreement";
import { resolvePartnerEffectivePlan, EffectivePlanError } from "./lib/partnerEffectivePlan"; /* GROUP C (C5) — /api/partner/me surfaces the dynamic effective plan (price incl override, commission, report-only quota, rev-share) that drives the partner FE. */
import { getUserContext } from "./lib/userContext";
import { appendAdminAudit } from "./adminPlatformStore";
import { emitBridgeEvent } from "./bridgeStore";
import { TIER_RANK, type PartnerTier, type PartnerType, type PartnerSubRole, getById } from "./adminContactsStoreShim";
import {
  partnerTeamStore,
  partnerTeamContactStore,
  partnerInvitationStore,
  partnerAttributionStore,
  ATTRIBUTION_SOURCES,
  isAttributionSource,
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
  type PartnerTeamInvitation,
} from "./partnerWorkspaceStore";
import { getAllContacts, listContacts, updateContact, createContact, upsertConsortiumPartner } from "./adminContactsStore";
import { registerPersona, getUserContextForId } from "./lib/userContext";
import { resolveDisplayNames } from "./lib/displayNameResolver"; /* W2-G — shared userId->name resolver */
import { isPartnerTitle } from "../shared/partnerTitles"; /* 2a — display title enum (distinct from permission tier) */
import { recordSignoff, linkSignoffToSpv } from "./spvLaunchSignoffStore"; /* 1c — durable launch sign-off (also gates the legacy /spvs create path) */
/* WAVE 22 · ITEM 2 (REVIEW B F-3) — legacy SPV-create sign-off `ip` was the raw
 * forwarded header. One shared hardened resolver, not a second local copy. */
import { resolveRateLimitClientIp } from "./lib/rateLimit";
import { hashPassword } from "./lib/auth"; /* v25.49.3 R1 — partner-role auth_users seed hash */
import { storeCredential, lookupByUserId } from "./userCredentialsStore"; /* v25.49.3 R1 — durable bcrypt credential + hydration probe */
import { rawDb } from "./db/connection";
import { log } from "./lib/logger"; /* w-partner F7 — non-fatal mirror warnings */
/* w-partner F-new3 — the SAME resolver the seat gate enforces with
   (requirePartnerAuth.ts:207), so the banner can never disagree with the 403. */
import { resolvePartnerSeatLimit } from "./lib/partnerFeeResolver";
import { setSessionCookie } from "./lib/sessionCookie";
import { getCompanyRecordById } from "./multiCompanyStore";
import { getCompanyProfile } from "./companyProfileStore"; /* v25.15 NM5 — real snapshot data */
import { listFollowedCompanyIdsForMember } from "./collectiveInterestStore"; /* v25.50.0 Phase 2 — Following from Collective */
import {
  getPortfolioCompany,
  listPortfolioCompanies,
  upsertPortfolioProfile,
  parsePortfolioPatchDetailed,
  archivePortfolioCompany,
} from "./partnerPortfolioStore"; /* v25.50.0 Phase 3 — Private Portfolio company profiles */
import { PORTFOLIO_PROFILE_WRITE_ROLES } from "../shared/partnerRoles"; /* w-partner F-new2 — shared server/client write-role constant */
import { linkConsortiumPartner, unlinkConsortiumPartner, getConsortiumPartnerId } from "./consortiumLinkStore";
import { upsertInvestorContactFromPartner, removeInvestorContactForPartner } from "./founderCrmStore";
import { spvEngineStore } from "./spvEngineStore"; /* Ozan #4 — legacy SPV routes shim THROUGH the canonical engine so no SPV is ever created outside it */
import { resolveSpvJurisdiction } from "../shared/spvEngine"; /* WAVE 4A follow-up 2 */

/* ============================================================
 * Helpers
 * ============================================================ */

function badRequest(res: Response, msg: string, details?: unknown): void {
  res.status(400).json({ error: "BAD_REQUEST", message: msg, details });
}
function isString(v: unknown): v is string { return typeof v === "string" && v.length > 0; }

/* v25.49.3 R1 — resolve/create a CONSORTIUM_PARTNER runtime identity for an
 * approved-partner magic-link redemption WITHOUT going through
 * registerPersona() (which lives in the SACRED userContext.ts and hard-codes
 * an INVESTOR persona + durable auth_users.role='investor'). The approved
 * partner's `users` row is provisioned at approval with role='consortium_partner'
 * (consortiumApplyStore); we reuse that identity. If none exists (or only an
 * auth_users row exists) we reuse/create it, but NEVER stamp an investor role.
 * The durable auth_users + users rows both carry role='consortium_partner' so
 * getDbUserRole / secureAuthRoutes redeem classify the session as a partner,
 * not an investor — fixing 2a (password-reset routing) end-to-end. Fail-closed:
 * an existing 'admin' identity is never downgraded. */
function resolveOrCreateConsortiumPartnerId(email: string, seedPassword: string): string {
  const db = rawDb();
  const normEmail = email.trim().toLowerCase();

  // 1. Prefer the approval-created users row already stamped consortium_partner.
  const partnerRow = db
    .prepare(`SELECT id FROM users WHERE lower(email) = ? AND role = 'consortium_partner' ORDER BY rowid LIMIT 1`)
    .get(normEmail) as { id: string } | undefined;
  let userId = partnerRow?.id;

  // 2. Else reuse any existing auth identity for this (invited, email-gated) address.
  if (!userId) {
    const authRow = db
      .prepare(`SELECT id FROM auth_users WHERE lower(email) = ? ORDER BY rowid LIMIT 1`)
      .get(normEmail) as { id: string } | undefined;
    userId = authRow?.id;
  }

  if (!userId) userId = `u_partner_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  // Durable auth_users row — role MUST be consortium_partner, never investor.
  // On conflict, preserve an existing password_hash (partner may have set one)
  // and never demote an admin.
  try {
    db.prepare(
      `INSERT INTO auth_users (id, email, password_hash, password_algo, role, status, created_at)
       VALUES (?, ?, ?, 'scrypt', 'consortium_partner', 'active', ?)
       ON CONFLICT(id) DO UPDATE SET role = CASE WHEN auth_users.role = 'admin' THEN 'admin' ELSE 'consortium_partner' END`,
    ).run(userId, normEmail, hashPassword(seedPassword), now);
  } catch (err) {
    // Non-fatal (mirrors registerPersona best-effort posture); users-row role
    // below is the primary source for getDbUserRole.
  }

  // users row — primary role source for getDbUserRole; guarantee partner role.
  try {
    db.prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, ?, ?, ?, 'consortium_partner', 0)
       ON CONFLICT(id) DO UPDATE SET role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE 'consortium_partner' END, email = excluded.email`,
    ).run(userId, "tenant_capavate", normEmail, email);
  } catch (err) {
    /* best-effort */
  }

  // Ensure a durable bcrypt credential exists so getUserContextForId's DB
  // hydration resolves this session as authed (isAuthed:true) after redeem and
  // browser login works — this is what registerPersona did for new users. Only
  // seed a credential when NONE exists; never clobber a password the partner
  // may already have set via the set-password flow.
  try {
    if (!lookupByUserId(userId)) {
      storeCredential({ userId, email: normEmail, name: email, password: seedPassword });
    }
  } catch {
    /* best-effort — matches registerPersona */
  }

  return userId;
}
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
    // v25.47 APD-036 (HIGH-10) — expose a numeric total so the admin Partners
    // page can render a count without re-deriving partners.length client-side.
    res.json({ partners: list, total: list.length });
  });

  /* ------------------------------------------------------------------
   * W-COLLECTIVE Wave 1 (v4 §1.4 / v5 §F) — admin-visible duplicate-seat report.
   *
   * A historical duplicate ACTIVE `partner_team_members` row for the same human
   * consumes a paid seat and makes the partner workspace show "2 seats" for one
   * person. `dedupeActiveTeamMembers()` has been able to DETECT this since W3.5
   * but nothing surfaced it, so the only way to find one was to be told by the
   * partner. This lists every affected organisation from the DURABLE roster so
   * an operator can work the list.
   *
   * READ-ONLY by design. It deliberately does NOT offer a merge/delete action:
   * collapsing a seat is a billing-visible change and the runbook
   * (docs/RUNBOOK_partner_seats.md) requires it be done deliberately, per
   * organisation, with the partner informed.
   *
   * MUST stay registered ABOVE `/api/admin/partners/:id`, or that route would
   * match "seat-report" as a partner id and 404.
   * ------------------------------------------------------------------ */
  app.get("/api/admin/partners/seat-report", requireAdmin, (_req: Request, res: Response) => {
    const partners = getAllContacts().filter((c) => c.kind === "consortium_partner");
    const rows = partners.map((p) => {
      const report = partnerTeamStore.seatReport(p.id);
      const { seatLimit } = resolvePartnerSeatLimit(p.id, (p.tier as PartnerTier) ?? "catalyst");
      return {
        partnerId: p.id,
        tier: p.tier ?? null,
        seatLimit,
        activeSeats: report.activeSeats,
        distinctSeatUsers: report.distinctSeatUsers,
        duplicateSeatCount: report.duplicateSeatCount,
        duplicateSeatIdsByUserId: report.duplicateSeatIdsByUserId,
        seatCountSource: report.source,
        overLimit: report.activeSeats > seatLimit,
      };
    });
    const affected = rows.filter((r) => r.duplicateSeatCount > 0);
    res.json({
      partners: rows,
      total: rows.length,
      affected,
      affectedTotal: affected.length,
      duplicateSeatTotal: affected.reduce((s, r) => s + r.duplicateSeatCount, 0),
      runbook: "docs/RUNBOOK_partner_seats.md",
    });
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
        /* w-partner F1(g) — deliberately NON-strict. The link is already
           severed by this point; a durable-write failure must not abort the
           unlink and strand the company in a half-unlinked state. The kv
           dual-write still records the revocation. */
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
    /* w-partner F1(i) — the 0114 CHECK now rejects off-union sources at the DB
       layer, which would surface as an opaque 500. Validate here so the caller
       gets a 400 naming the allowed values. */
    if (source !== undefined && source !== null && !isAttributionSource(source)) {
      return badRequest(res, `source must be one of: ${ATTRIBUTION_SOURCES.join(", ")}`);
    }
    const actor = String((req.userContext?.userId) ?? ""); /* v14 */ if (!actor) return res.status(401).json({ error: "missing_identity" });
    const partnerId = String(req.params.id);
    /* WAVE 33 / CP-PIPE-06 — PROVENANCE CANNOT BE OMITTED.
       This read `source ?? "admin_manual"`. A caller who sent no source did not
       get a refusal — they got a row permanently asserting the attribution was
       an administrative decision, indistinguishable afterwards from a real one,
       in the table the spec designates the SSOT for who originated a
       relationship. Note that the validator directly above ALREADY rejected an
       *unknown* source with a 400: omission was the single case that received a
       fiction instead of an error. It is now the same refusal. */
    if (source === undefined || source === null || (typeof source === "string" && source.trim() === "")) {
      return badRequest(
        res,
        `source is required and is not assumed — one of: ${ATTRIBUTION_SOURCES.join(", ")}. An unstated source recorded as an administrative decision would fabricate provenance that later readers cannot tell from a real record.`,
      );
    }
    let a;
    try {
      a = partnerAttributionStore.create(partnerId, companyId, actor, source, notes ?? null);
    } catch (err) {
      /* CP-PIPE-06 — a refused acquisition is a 409: the request was
         well-formed, the state of the world forbids it. Nothing was written. */
      const msg = (err as Error).message ?? "";
      if (msg.startsWith("PROVENANCE_REFUSED:")) {
        return res.status(409).json({
          error: "PROVENANCE_REFUSED",
          verdict: (err as Error & { verdict?: string }).verdict ?? null,
          message: msg.slice(msg.indexOf(": ") + 2),
        });
      }
      throw err;
    }
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
              link: "/collective/partner/pipeline",
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
      /* w-partner F1(g) — STRICT. This is the deliberate admin revoke; unlike
         the unlink path there is no already-severed link to strand, so a
         durable-write failure must fail closed rather than leave the caller
         believing a revocation was recorded. */
      const a = partnerAttributionStore.revoke(partnerId, companyId, actor, { strict: true });
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
                link: "/collective/partner/pipeline",
              });
            } catch { /* per-recipient failures non-fatal */ }
          }
        }
      } catch { /* notification optional */ }
      res.json({ attribution: a });
    } catch (e) {
      /* w-partner F1(g) — a strict persist failure is NOT a missing row;
         reporting it as 404 would tell the admin the attribution never
         existed while it is in fact still live. */
      const msg = (e as Error).message ?? "";
      if (msg.startsWith("ATTRIBUTION_REVOKE_PERSIST_FAILED")) {
        return res.status(500).json({ error: "ATTRIBUTION_REVOKE_FAILED" });
      }
      res.status(404).json({ error: "ATTRIBUTION_NOT_FOUND" });
    }
  });

  /* ============================================================
   * PARTNER workspace endpoints — /api/partner/me/*
   * ============================================================ */

  /* GROUP F3 — `/me` is the ONE bootstrap read behind `requirePartnerSelf`
   * (the ONLY relaxation vs requirePartnerAuth is dropping the status==='active'
   * check) so a SUSPENDED partner can still load THIS route to see a status
   * banner. It grants NO data and NO writes; every OTHER /api/partner/me/*
   * route below keeps hard requirePartnerAuth. The payload is extended
   * ADDITIVELY: `status`, `commissionPct` (DISPLAY-ONLY — derived from the
   * EXISTING effectivePlan.commission.rate; no calc/ledger/payment change),
   * `partnerType`, `region`. Existing keys are unchanged. */
  app.get("/api/partner/me", requirePartnerSelf, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    /* GROUP C (C5) — dynamic effective plan drives the partner FE. Read-only
     * composition of the EXISTING resolvers. Fail-closed pricing throws
     * EffectivePlanError; we surface effectivePlan: null (never break /me) so a
     * mis-configured tier degrades gracefully rather than 500-ing the session. */
    let effectivePlan: ReturnType<typeof resolvePartnerEffectivePlan> | null = null;
    try {
      effectivePlan = resolvePartnerEffectivePlan(ctx.partnerId, ctx.tier);
    } catch (err) {
      if (!(err instanceof EffectivePlanError)) throw err;
      effectivePlan = null;
    }
    /* Read admin-set reconciliation fields from the EXISTING partner contact
     * record (getById) — no new store, no body/query input. */
    const partner = getById(ctx.partnerId);
    const status = partner?.status ?? null;
    const partnerType = partner?.partnerType ?? null;
    const region = partner?.region ?? null;
    /* commissionPct is DISPLAY-ONLY: it renders the SAME commission rate the
     * existing resolver already returns (rate is a fraction, e.g. 0.12), scaled
     * to a percent for the FE. It NEVER drives any calculation, ledger or
     * payment path. null when no effective plan resolved (mis-config). */
    const commissionPct =
      effectivePlan ? effectivePlan.commission.rate * 100 : null;
    /* WAVE 7B FE-14 (DEF-060) — subscription STATE, additive and display-only.
     *
     * The dashboard printed the resolved tier price under the fixed heading
     * "Your subscription" for every partner. For a partner with no
     * `contacts.subscription_id` — a Path-1 partner, who is not billed a
     * subscription at all (server/lib/partnerSelfServiceRoutes.ts:106-124
     * returns `subscription: null` for exactly that case) — that heading is a
     * false statement about money: the number shown is the tier's ADVERTISED
     * price, not anything they pay.
     *
     * Resolved HERE rather than by having the dashboard call
     * /api/partner/me/subscription, because that route is gated to
     * `managing_partner` and every other sub-role would get a 403 and fall
     * back to the same wrong label. This is the ONE bootstrap read every
     * partner sub-role can already make, and it already reads the same
     * `contacts` row via getById(). No new store, no new auth surface, no new
     * query — one extra column off a row that is already loaded.
     *
     * DISPLAY-ONLY: nothing branches on this for pricing, billing, ledgers,
     * entitlement or access. It only chooses a label. */
    const subscriptionState: "subscribed" | "unsubscribed" | "unknown" = (() => {
      try {
        const row = rawDb()
          .prepare(`SELECT subscription_id FROM contacts WHERE id = ?`)
          .get(ctx.partnerId) as { subscription_id?: string | null } | undefined;
        if (!row) return "unknown";
        return row.subscription_id ? "subscribed" : "unsubscribed";
      } catch {
        /* Never break /me over a label. */
        return "unknown";
      }
    })();
    res.json({
      partnerId: ctx.partnerId,
      tier: ctx.tier,
      subRole: ctx.partnerSubRole,
      identity: { userId: ctx.userId, email: ctx.email, name: ctx.name },
      effectivePlan,
      status,
      commissionPct,
      partnerType,
      region,
      subscriptionState,
    });
  });

  app.get("/api/partner/me/dashboard", requirePartnerAuth, (req: Request, res: Response) => {
    res.json(partnerDashboardSnapshot(req.partnerContext!.partnerId));
  });

  // CLIENTS — W2-A restore. The read-only `GET /api/partner/me/clients` +
  // `/clients/:id` surface was trimmed in v25.50.0 Phase 6 (spec 4a) WITHOUT
  // authorization (rule #78) while the entire data model, CRM engine, writes,
  // attribution store, dashboard count and boot hydration were DELIBERATELY
  // PRESERVED. These two endpoints are rebuilt from the preserved
  // partnerAttributionStore; both are read-only, requirePartnerAuth, and
  // fail-closed on attribution (the `:id` route 404s on any company not
  // attributed to THE SESSION's partner — never the URL — so there is no
  // cross-partner read). Shapes match what PartnerClients.tsx /
  // PartnerClientDetail.tsx consume.
  app.get("/api/partner/me/clients", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const clients = partnerAttributionStore
      .listByPartner(pid)
      .map((a) => ({
        id: a.id,
        companyId: a.companyId,
        /* w-partner F1(d) — the list rendered raw company ids because the
           name was never joined in. Additive field; the id stays. */
        companyName: getCompanyRecordById(a.companyId)?.companyName ?? null,
        attributionSource: a.attributionSource,
        attributedAt: a.attributedAt,
      }));
    res.json({ clients });
  });

  app.get("/api/partner/me/clients/:id", requirePartnerAuth, (req: Request, res: Response) => {
    const pid = req.partnerContext!.partnerId;
    const companyId = String(req.params.id);
    // Fail-closed: the company must be attributed to THIS partner. A miss
    // returns 404 without leaking whether the company exists elsewhere.
    const attribution = partnerAttributionStore
      .listByPartner(pid)
      .find((a) => a.companyId === companyId);
    if (!attribution) {
      return res.status(404).json({ error: "CLIENT_NOT_FOUND_OR_NOT_ATTRIBUTED" });
    }
    const rec = getCompanyRecordById(companyId);
    const profile = getCompanyProfile(companyId);
    const snapshot = {
      sector: rec?.sector ?? null,
      stage: rec?.stage ?? null,
      valuationMinor: profile?.valuationMinor ?? null,
      lastRaiseAmount: profile?.lastRaiseAmount ?? null,
      lastRaiseDate: profile?.lastRaiseDate ?? null,
    };
    const notes = partnerNotesStore
      .listByPartner(pid, { scope: "client", scopeId: companyId })
      .map((n) => ({ id: n.id, title: n.title, body: n.body }));
    res.json({
      companyId,
      snapshot,
      attribution: { attributionSource: attribution.attributionSource, attributedAt: attribution.attributedAt },
      notes,
    });
  });

  // PIPELINE
  app.get("/api/partner/me/pipeline", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ pipeline: partnerPipelineStore.listByPartner(req.partnerContext!.partnerId), stages: ALL_PIPELINE_STAGES });
  });

  // v25.50.0 Phase 2 (spec 2b) — "Following from Collective": companies this
  // partner (as a Collective member) has opened interest threads on. Read-only;
  // the UI links each row to the Collective company page in a new tab.
  app.get("/api/partner/me/following", requirePartnerAuth, (req: Request, res: Response) => {
    const userId = req.partnerContext!.userId;
    const companyIds = listFollowedCompanyIdsForMember(userId);
    const following = companyIds.map((companyId) => {
      const rec = getCompanyRecordById(companyId);
      return {
        companyId,
        companyName: rec?.companyName ?? null,
        logoUrl: rec?.logoUrl ?? null,
      };
    });
    res.json({ following });
  });

  // ============================================================
  // v25.50.0 Phase 3 (spec 3) — PRIVATE PORTFOLIO company profiles.
  // CP-scoped, non-sacred. Reuses the founder CompanyProfile taxonomy
  // (contact/address/legal/ma) via companyProfilePatchSchema, stored per
  // (partnerId, companyId) in partner_portfolio_company. Never touches the
  // sacred founder profile stores.
  // ============================================================

  /**
   * W1 H3/H4 (v26.2.0) — Partner↔company relationship proof for the portfolio
   * detail/upsert routes. Without this, GET leaked global company name/logo for
   * ANY companyId (enumeration) and PATCH created a private portfolio row for any
   * global company. A partner may access a company's portfolio only via a durable
   * relationship. Following (member personal interest) is intentionally NOT a proof.
   * Returns 404 (not 403) on failure so the route cannot be used as an existence oracle.
   */
  const partnerCanAccessCompanyPortfolio = (partnerId: string, companyId: string): boolean => {
    if (!partnerId || !companyId) return false;
    // 1) live partner-owned portfolio row
    if (getPortfolioCompany(partnerId, companyId)) return true;
    // 2) live attribution (listByPartner excludes revoked by default)
    if (partnerAttributionStore.listByPartner(partnerId).some((a) => a.companyId === companyId && !a.revokedAt)) return true;
    // 3) consortium sponsor link
    if (getConsortiumPartnerId(companyId) === partnerId) return true;
    // 4) partner pipeline deal
    if (partnerPipelineStore.listByPartner(partnerId).some((p) => p.companyId === companyId)) return true;
    // 5) live partner deal promotion (exclude terminal/negative states)
    if (partnerDealPromotionsStore.listByPartner(partnerId).some((p) =>
      p.companyId === companyId && !(["rejected", "withdrawn", "archived"] as string[]).includes(String(p.status)),
    )) return true;
    // 6) partner-sponsored SPV target company
    if (spvEngineStore.listByPartner(partnerId).some((s) => s.targetCompanyId === companyId && !s.archivedAt)) return true;
    return false;
  };

  // List all private-portfolio company profiles for this partner.
  app.get("/api/partner/me/portfolio", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const items = listPortfolioCompanies(ctx.partnerId).map((p) => {
      const rec = getCompanyRecordById(p.companyId);
      return {
        companyId: p.companyId,
        companyName: rec?.companyName ?? null,
        logoUrl: rec?.logoUrl ?? null,
        profile: p.profile,
        updatedAt: p.updatedAt,
      };
    });
    res.json({ portfolio: items });
  });

  // Read a single private-portfolio profile.
  app.get("/api/partner/me/portfolio/:companyId", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const companyId = String(req.params.companyId);
    // W1 H3 — require relationship BEFORE exposing any global company metadata.
    if (!partnerCanAccessCompanyPortfolio(ctx.partnerId, companyId)) {
      return res.status(404).json({ error: "PORTFOLIO_COMPANY_NOT_FOUND" });
    }
    const p = getPortfolioCompany(ctx.partnerId, companyId);
    const rec = getCompanyRecordById(companyId);
    res.json({
      companyId,
      companyName: rec?.companyName ?? null,
      logoUrl: rec?.logoUrl ?? null,
      profile: p?.profile ?? {},
      updatedAt: p?.updatedAt ?? null,
    });
  });

  // Upsert (create-or-merge) the partner's private profile for a company.
  app.patch(
    "/api/partner/me/portfolio/:companyId",
    requirePartnerAuth,
    // w-partner F-new2 — `bd` can already CREATE a portfolio company
    // (partnerPortfolioCompanyRoutes.ts:39); the shared constant keeps the
    // server guard and the client canEdit predicate from re-diverging.
    assertSubRole(...PORTFOLIO_PROFILE_WRITE_ROLES),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const companyId = String(req.params.companyId);
      // W1 H4 — require relationship BEFORE body validation (no validation oracle) or upsert.
      if (!partnerCanAccessCompanyPortfolio(ctx.partnerId, companyId)) {
        return res.status(404).json({ error: "PORTFOLIO_COMPANY_NOT_FOUND" });
      }
      // w-partner F2-b — surface FIELD-LEVEL issues. A single bad value (e.g. a
      // free-text industry) previously 400'd the whole patch and silently
      // discarded all four sections with no indication of the offending field.
      const parsed = parsePortfolioPatchDetailed(req.body ?? {});
      if (!parsed.ok) {
        return res.status(400).json({ error: "INVALID_PROFILE_PATCH", details: parsed.issues });
      }
      const patch = parsed.data;
      try {
        const saved = upsertPortfolioProfile(ctx.partnerId, companyId, patch, ctx.userId);
        res.json({ companyId, profile: saved.profile, updatedAt: saved.updatedAt });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    },
  );

  // Remove a company from the partner's private portfolio (soft-delete).
  app.delete(
    "/api/partner/me/portfolio/:companyId",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const companyId = String(req.params.companyId);
      try {
        const ok = archivePortfolioCompany(ctx.partnerId, companyId);
        if (!ok) return res.status(404).json({ error: "PORTFOLIO_NOT_FOUND" });
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ error: (e as Error).message });
      }
    },
  );

  app.post(
    "/api/partner/me/pipeline",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { dealName, companyId, stage, estCheckSizeMinor, currency, sector, geography, expectedClose, notes } = req.body ?? {};
      if (!isString(dealName)) return badRequest(res, "dealName required");
      try {
        const deal = partnerPipelineStore.create(ctx.partnerId, {
          dealName,
          companyId: companyId ?? null,
          stage: stage ?? "invited",
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
    requireSignedAgreement,
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
    requireSignedAgreement,
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
    requireSignedAgreement,
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

  /* WAVE 27 · CP-PIPE-04 — the read half of the pipeline activity log.

     THE GAP. `partnerPipelineActivityStore.listForPipeline` exists at
     `server/partnerWorkspaceStore.ts:2261` with NO route and NO client caller
     anywhere in the tree — an engine with no door, which the standing rules say
     is not shipped. Until now the log was WRITE-ONLY: the POST above records
     email/note/call/meeting entries, and `partnerWorkspaceStore.ts:2155` also
     writes a `stage_change` entry every time a deal moves stage, so partners
     have been silently accumulating deal history that nothing could ever read
     back. Data written and never surfaced is the same defect as data dropped.

     OWNERSHIP GUARD — note this is NOT redundant. `listForPipeline` filters on
     `pipelineId` ALONE; it has no notion of a partner. Exposing it without
     first resolving the deal through `partnerPipelineStore.getById(ctx.partnerId,
     ...)` would let any authenticated partner read any other partner's deal
     history by guessing an id. The POST above already guards this way and the
     GET must match it exactly — same lookup, same 404, so a foreign id is
     indistinguishable from a missing one and the route cannot be used to probe
     for the existence of other partners' deals.

     Sub-roles are deliberately WIDER than the writer: `viewer` may read the log
     but still cannot append to it.

     Ordering: newest first, tie-broken by id so the sequence is stable across
     calls when two entries share an `occurredAt` (the stage-change writer and a
     manual note can land in the same millisecond). */
  app.get(
    "/api/partner/me/pipeline/:id/activities",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate", "bd", "viewer"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const dealId = String(req.params.id);
      const deal = partnerPipelineStore.getById(ctx.partnerId, dealId);
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      const activities = partnerPipelineActivityStore
        .listForPipeline(dealId)
        .slice()
        .sort((a, b) =>
          a.occurredAt === b.occurredAt
            ? b.id.localeCompare(a.id)
            : b.occurredAt.localeCompare(a.occurredAt),
        );
      res.json({ activities });
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
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const dealId = String(req.params.id);
      // Verify deal is owned by this partner (URL injection guard)
      const deal = partnerPipelineStore.getById(ctx.partnerId, dealId);
      if (!deal) return res.status(404).json({ error: "DEAL_NOT_FOUND" });
      // Wave B2 (3b) INVARIANT — a company must exist ON CAPAVATE (so its cap-table
      // and rounds management are operating) BEFORE it can be published to the
      // Collective. A bare name-only pipeline deal has no linked Capavate company
      // (no companyId / no company record), so promotion is refused with guidance
      // to add it as a real portfolio company first (Wave B1 "Add Portfolio
      // Company" creates the Capavate company + cap table + rounds surface).
      if (!deal.companyId || !getCompanyRecordById(deal.companyId)) {
        return res.status(409).json({
          error: "COMPANY_NOT_ON_CAPAVATE",
          message: "This deal is not yet a company on Capavate. Add it as a portfolio company (so its cap table and rounds are operating) before publishing to the Collective.",
        });
      }
      const { notes } = (req.body ?? {}) as { notes?: unknown };
      try {
        const p = partnerDealPromotionsStore.create(
          ctx.partnerId,
          dealId,
          {
            promotionType: "collective_deal_room",
            companyId: deal.companyId,
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
    requireSignedAgreement,
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
    requireSignedAgreement,
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
    /* v25.50 Phase 7 (7a) — the store returns raw userIds with no identity. JOIN
       the canonical `users` table so the UI can render real name/email instead
       of the opaque id. Read-only; the sacred users store is never mutated.
       (7c) Merge partner-workspace-local contact overrides (mobile, contact
       email, position note) from the additive partner_team_member_contact
       table. */
    // W3.5 — collapse historical duplicate active seats for the same
    // (partnerId, userId) before identity/contact enrichment. Never drops
    // data: duplicateSeatCount + duplicateSeatIdsByUserId are reported in
    // `meta` so operators/cleanup tooling can see exactly what was hidden.
    /* W-COLLECTIVE Wave 1 (v4 §1.4 / v5 §F) — resolve identities BEFORE the
       collapse and hand the store an `emailByUserId` map, so two seat rows that
       are two userIds for the SAME human (the `u_834e8cd5998b` LIVE merge) show
       as one member instead of two. `listByPartner()` is still passed UNCHANGED
       and un-deduplicated — it backs F3 authz, promotion moderation and
       notification fan-out, and must never be collapsed at source. The EMAIL
       collapse applied here is DISPLAY-only.
       v26.7.3 FIX-4 (comment correction, MINOR-3) — the previous sentence
       "countActiveSeats() still counts rows" is no longer true: enforcement now
       collapses duplicate active rows by the canonical server-assigned `userId`
       (never by email). The email-keyed collapse here remains display-only and
       is NOT what the seat limit is enforced against; `activeSeats` below is. */
    const activeRoster = partnerTeamStore.listByPartner(pid);
    const rosterIdentityById = resolveDisplayNames(activeRoster.map((m) => m.userId));
    const emailByUserId = new Map<string, string | null>(
      activeRoster.map((m) => [m.userId, rosterIdentityById.get(m.userId)?.email ?? null]),
    );
    const { members: rawMembers, duplicateSeatCount, duplicateSeatIdsByUserId } =
      partnerTeamStore.dedupeActiveTeamMembers(activeRoster, { emailByUserId });
    const contactMap = partnerTeamContactStore.listByPartner(pid);
    const memberIds = rawMembers.map((m) => m.userId);
    /* W2-G — resolve identities through the shared displayNameResolver instead
       of a bare `users` JOIN. The prior JOIN missed synthetic ids (e.g. the
       `u_redeemed_*` personas minted in userContext.ts) and surfaced a null /
       raw id in place of a name. The resolver checks users -> credentials ->
       user-context and GUARANTEES it never returns a raw "u_..." id as a name. */
    const identityById = resolveDisplayNames(memberIds);
    const members = rawMembers.map((m) => {
      const idn = identityById.get(m.userId);
      const contact = contactMap.get(m.userId);
      // W-V44 FIX N8 — an ACTIVE member should never display the "Pending member"
      // placeholder (that label wrongly implies a not-yet-active seat and is
      // confusing next to the real managing partner). When the resolver could
      // not find a name/email (idn.resolved === false) for an ACTIVE member,
      // show a neutral "Team member" label instead; non-active unresolved seats
      // keep the resolver's status-appropriate placeholder.
      const resolvedName =
        idn && !idn.resolved && m.status === "active"
          ? "Team member"
          : (idn?.name ?? "Pending member");
      return {
        ...m,
        /* v25.56 GROUP-D — never null; resolver already guarantees a non-raw
           name, so a missing identity gets a stable placeholder not null. */
        name: resolvedName,
        email: idn?.email ?? null,
        mobile: contact?.mobile ?? null,
        contactEmail: contact?.contactEmail ?? null,
        positionNote: contact?.positionNote ?? null,
        /* 2a — display title for an active member (presentational). Stored in the
           partner-local contact override's positionNote field; null when unset.
           This is DISTINCT from `subRole` (the enforced permission tier). */
        title: contact?.positionNote ?? null,
      };
    });
    /* w-partner F-new3 — the EFFECTIVE seat cap (per-partner override, else tier
       default). Resolved server-side from the same function the invite gate
       enforces with so the banner can never disagree with the 403; the client
       must not carry its own copy of TIER_SEAT_LIMITS. */
    const { seatLimit } = resolvePartnerSeatLimit(pid, req.partnerContext!.tier);
    // v26.7.3 FIX-4 — expose the same server-owned, userId-deduplicated active
    // seat count used by dashboard and invite enforcement. The roster's existing
    // email-based display collapse remains intact (and still reports its cleanup
    // warning), but must not become the source of truth for the seat-limit banner.
    const activeSeats = partnerTeamStore.seatReport(pid).activeSeats;
    res.json({ members, invitations, seatLimit, activeSeats, meta: { duplicateSeatCount, duplicateSeatIdsByUserId } });
  });

  /* v25.50 Phase 7 (7c) — edit a team member's partner-local contact info.
     Fail-closed: managing_partner only; the member must belong to THIS partner
     workspace (checked against the active roster) before any write. */
  app.patch(
    "/api/partner/me/team/:userId/contact",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const userId = String(req.params.userId);
      const member = partnerTeamStore
        .listByPartner(ctx.partnerId)
        .find((m) => m.userId === userId);
      if (!member) return res.status(404).json({ error: "TEAM_MEMBER_NOT_FOUND" });
      const { mobile, contactEmail, positionNote } = req.body ?? {};
      const norm = (v: unknown): string | null | undefined =>
        v === undefined ? undefined : v === null ? null : String(v).trim();
      const contact = partnerTeamContactStore.upsert(
        ctx.partnerId,
        userId,
        { mobile: norm(mobile), contactEmail: norm(contactEmail), positionNote: norm(positionNote) },
        ctx.userId,
      );
      res.json({ contact });
    },
  );

  app.post(
    "/api/partner/me/team/invitations",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { email, subRole, title } = req.body ?? {};
      if (!isString(email)) return badRequest(res, "email required");
      const allowed: PartnerSubRole[] = ["managing_partner", "associate", "bd", "analyst", "viewer"];
      if (!allowed.includes(subRole)) return badRequest(res, "subRole invalid");
      // 2a — optional DISPLAY title (distinct from the permission tier). Accept
      // only a known title from the shared list; unknown/empty => null (never a
      // permission, so a bad value is harmless — fail soft to null, not 400).
      const resolvedTitle: string | null = isPartnerTitle(title) ? title : null;
      const ip = (req.ip ?? "").toString();
      const ua = String(req.headers["user-agent"] ?? "");
      /* WAVE 19 FE-19 (SEAT-04) — the seat check and the insert are now ONE
         transaction. Previously `assertTierSeats()` ran here and
         `partnerInvitationStore.create()` ran on the next line with no lock
         between them, so two simultaneous invitations could both claim the
         last seat of a paid tier. `createWithSeatGuard` re-reads the durable
         active + pending counts inside a better-sqlite3 IMMEDIATE transaction
         and applies the SAME policy function; the loser's insert rolls back.
         The 403 contract and its error string are unchanged, so the existing
         client copy still matches. */
      let invitation: PartnerTeamInvitation;
      let plainToken: string;
      try {
        ({ invitation, plainToken } = partnerInvitationStore.createWithSeatGuard(
          ctx.partnerId, email, subRole as PartnerSubRole, ctx.userId,
          (counts) => assertSeatCapacity(ctx.partnerId, counts),
          { ip, ua, title: resolvedTitle },
        ));
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (msg.includes("PARTNER_TIER_SEAT_LIMIT_REACHED") || msg.includes("PARTNER_NOT_FOUND")) {
          return res.status(403).json({
            error: msg.includes("PARTNER_NOT_FOUND") ? "PARTNER_NOT_FOUND" : "PARTNER_TIER_SEAT_LIMIT_REACHED",
          });
        }
        throw e;
      }
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
    requireSignedAgreement,
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
    requireSignedAgreement,
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
    requireSignedAgreement,
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
    requireSignedAgreement,
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

  // TASKS + FILES — v25.50.0 Phase 6 (spec 5a/6a): the CP-facing Tasks and Files
  // pages are removed, so their `/api/partner/me/tasks*` and `/api/partner/me/files*`
  // route surfaces are deleted here. The underlying partnerTasksStore/partnerFilesStore
  // are retained (dormant) because the admin audit endpoint (/api/admin/partners/:id/audit)
  // and boot hydration still consume them for admin oversight; admin-side reconciliation
  // is handled in Phase 8 (see partner_v7_admin_delta.md).

  // WORKSPACE SETTINGS
  app.get("/api/partner/me/workspace-settings", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ settings: partnerWorkspaceSettingsStore.get(req.partnerContext!.partnerId) });
  });
  app.patch(
    "/api/partner/me/workspace-settings",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
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
        /* w-partner F7 — mirror the workspace displayName onto the partner's
           contact record so admin/directory surfaces stop showing the stale
           name after a partner renames their workspace. NON-FATAL: the settings
           save has already succeeded and is the user's actual intent; a mirror
           failure must not turn a saved setting into an error response.
           displayName ONLY — legal_name is a legal identifier and is NEVER
           derived from a self-service display field. */
        if ("displayName" in patch) {
          try {
            updateContact(
              ctx.partnerId,
              { displayName: patch.displayName },
              ctx.userId,
              "partner.display_name.mirrored",
            );
          } catch (mirrorErr) {
            log.warn(
              `[partnerRoutes] displayName mirror to contact ${ctx.partnerId} failed (non-fatal):`,
              (mirrorErr as Error).message,
            );
          }
        }
        res.json({ settings: s });
      } catch (e) {
        res.status(403).json({ error: (e as Error).message });
      }
    },
  );

  // SPVs — LEGACY plural surface, now a COMPATIBILITY SHIM over the ONE canonical
  // engine (Ozan decision #4 / Blocker 1). Reads and writes go THROUGH
  // spvEngineStore so an SPV can NEVER be created outside the canonical `spv`
  // table (a legacy-path create is immediately canonical and shows up in the
  // Collective/Capavate context filters with no reboot). The legacy partnerSpvStore
  // rows are kept only as migrated read-only provenance (Sacred Rule #78 — nothing
  // is dropped, every route stays reachable).
  //
  // Legacy jurisdictions were free-text; the canonical engine requires a valid
  // enum. We normalise to a valid jurisdiction and preserve the original in
  // `terms.legacyJurisdiction` so no information is lost.
  const LEGACY_TO_CANONICAL_SPV_STATUS: Record<string, "draft" | "open" | "closed" | "wound_down"> = {
    planned: "draft", open: "open", closed: "closed", wound_down: "wound_down",
  };
  app.get("/api/partner/me/spvs", requirePartnerAuth, (req: Request, res: Response) => {
    res.json({ spvs: spvEngineStore.listByPartner(req.partnerContext!.partnerId) });
  });
  app.post(
    "/api/partner/me/spvs",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const body = req.body ?? {};
      const { spvName, jurisdiction, vintage, currency, status, targetCompanyId, entityStructure, externalAdminProvider, externalAdminRef, notes } = body;
      if (!isString(spvName) || !isString(jurisdiction) || !isNumber(vintage) || !isISOCurrency(currency) || !isString(status)) {
        return badRequest(res, "spvName, jurisdiction, vintage, ISO 4217 currency, status required");
      }
      const validSpvStatus = ["planned", "open", "closed", "wound_down"] as const;
      if (!validSpvStatus.includes(status as typeof validSpvStatus[number])) {
        return badRequest(res, "status must be one of " + validSpvStatus.join("|"));
      }
      // 1c (per GPT-5.5 round-2 review) — this legacy create path must ALSO be
      // sign-off-gated so there is no partner-accessible way to create an SPV
      // without a durable, verifiable authorization record. Same contract as the
      // canonical POST /api/partner/me/spv: typed legal name + accepted
      // attestation required; record the sign-off FIRST (fail-closed 500 on
      // persist failure, no SPV created), then create + link.
      const signoffLegalName = typeof body.signoffLegalName === "string" ? body.signoffLegalName.trim() : "";
      const signoffAccepted = body.signoffAccepted === true;
      if (!signoffLegalName) return res.status(400).json({ error: "SIGNOFF_LEGAL_NAME_REQUIRED" });
      if (!signoffAccepted) return res.status(400).json({ error: "SIGNOFF_ATTESTATION_REQUIRED" });
      let legacySignoff;
      try {
        legacySignoff = recordSignoff({
          partnerId: ctx.partnerId,
          spvId: "",
          userId: ctx.userId,
          signerLegalName: signoffLegalName,
          signerSubRole: ctx.partnerSubRole ?? null,
          ip: resolveRateLimitClientIp(req), /* WAVE 22 · ITEM 2 — trusted-hop resolution, never the raw header */
          userAgent: (req.headers["user-agent"] as string) ?? null,
        });
      } catch {
        return res.status(500).json({ error: "SIGNOFF_PERSIST_FAILED" });
      }
      try {
        /* WAVE 4A / follow-up 2 — resolveSpvJurisdiction() (Wave 3C) replaces the
           hard-coded "delaware" fallback: unknown input becomes "other". */
        const canonicalJurisdiction = resolveSpvJurisdiction(jurisdiction);
        const spv = spvEngineStore.createSpv(
          ctx.partnerId,
          {
            name: spvName,
            jurisdiction: canonicalJurisdiction,
            // Legacy rows carry no explicit carry basis — assign whole_spv as
            // provenance (identical to the boot backfill), never a new-GP default.
            carryBasis: "whole_spv",
            currency,
            status: LEGACY_TO_CANONICAL_SPV_STATUS[status] ?? "draft",
            targetCompanyId: targetCompanyId ?? null,
            terms: { legacyShim: true, vintage, entityStructure, externalAdminProvider, externalAdminRef, notes, legacyJurisdiction: jurisdiction },
          },
          ctx.userId,
        );
        linkSignoffToSpv(legacySignoff.id, spv.id);
        res.status(201).json({ spv });
      } catch (e) {
        return badRequest(res, (e as Error).message);
      }
    },
  );
  app.get("/api/partner/me/spvs/:id", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const spv = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    // Positions map onto the canonical investor register (per-LP commitment + %).
    res.json({ spv, positions: spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)) });
  });
  app.patch(
    "/api/partner/me/spvs/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      // Blocker 1 (4D): mutate THROUGH the canonical engine so a legacy PATCH can
      // never diverge the legacy row from the canonical `spv` table. Legacy status
      // strings are normalised to canonical enums; `spvName` maps to `name`.
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof b.spvName === "string") patch.name = b.spvName;
      if (typeof b.name === "string") patch.name = b.name;
      if (typeof b.status === "string") patch.status = LEGACY_TO_CANONICAL_SPV_STATUS[b.status] ?? b.status;
      if (b.targetRaiseMinor !== undefined) patch.targetRaiseMinor = b.targetRaiseMinor;
      if (b.minCheckMinor !== undefined) patch.minCheckMinor = b.minCheckMinor;
      if (b.capMinor !== undefined) patch.capMinor = b.capMinor;
      if (b.closeDate !== undefined) patch.closeDate = b.closeDate;
      try {
        const spv = spvEngineStore.updateSpv(ctx.partnerId, String(req.params.id), patch, ctx.userId);
        res.json({ spv });
      } catch (e) { res.status(404).json({ error: (e as Error).message }); }
    },
  );
  app.get("/api/partner/me/spvs/:id/positions", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const spv = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!spv) return res.status(404).json({ error: "SPV_NOT_FOUND" });
    // Positions are the canonical investor register (per-LP commitment + %).
    res.json({ positions: spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)) });
  });
  app.post(
    "/api/partner/me/spvs/:id/positions",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { lpContactId, positionAmountMinor, currency } = req.body ?? {};
      if (!isString(lpContactId) || !isNumber(positionAmountMinor) || !isISOCurrency(currency)) {
        return badRequest(res, "lpContactId, positionAmountMinor (int minor), ISO 4217 currency required");
      }
      // Blocker 1 (4D): a NEW position is written THROUGH the canonical engine as
      // a subscription (LP register) — never as a legacy partnerSpvStore position.
      try {
        const sub = spvEngineStore.subscribe(
          ctx.partnerId,
          String(req.params.id),
          { investorId: lpContactId, commitmentMinor: positionAmountMinor, currency },
          ctx.userId,
        );
        res.status(201).json({ position: sub });
      } catch (e) { res.status(400).json({ error: (e as Error).message }); }
    },
  );

  // FUNDS — Blocker 1 (4D): a fund is just an SPV with spvType="fund". Every
  // fund create/read/update/commitment surface is a COMPATIBILITY SHIM over the
  // ONE canonical engine (spvEngineStore) so a fund can NEVER be created outside
  // the canonical `spv` table (no second system). The legacy partnerFundsStore
  // rows remain read-only provenance (Sacred Rule #78). Legacy fund statuses are
  // normalised to canonical SPV enums; fund-specific fields are preserved in
  // `terms` so no information is lost.
  const LEGACY_TO_CANONICAL_FUND_STATUS: Record<string, "draft" | "open" | "closed" | "wound_down"> = {
    planning: "draft", raising: "open", investing: "open", harvesting: "closed", wound_down: "wound_down",
  };
  app.get("/api/partner/me/funds", requirePartnerAuth, (req: Request, res: Response) => {
    const funds = spvEngineStore.listByPartner(req.partnerContext!.partnerId).filter((s) => s.spvType === "fund");
    res.json({ funds });
  });
  app.post(
    "/api/partner/me/funds",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
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
      try {
        /* WAVE 4A / follow-up 2 — resolveSpvJurisdiction() (Wave 3C) replaces the
           hard-coded "delaware" fallback: unknown input becomes "other". */
        const canonicalJurisdiction = resolveSpvJurisdiction(jurisdiction);
        const fund = spvEngineStore.createSpv(
          ctx.partnerId,
          {
            name: fundName,
            spvType: "fund",
            jurisdiction: canonicalJurisdiction,
            carryBasis: "whole_spv",
            currency,
            status: LEGACY_TO_CANONICAL_FUND_STATUS[status] ?? "draft",
            targetRaiseMinor: isNumber(targetSizeMinor) ? targetSizeMinor : null,
            terms: { legacyShim: true, fundType, vintage, externalAdminProvider, externalAdminRef, notes, legacyJurisdiction: jurisdiction, legacyFundStatus: status },
          },
          ctx.userId,
        );
        res.status(201).json({ fund });
      } catch (e) { return badRequest(res, (e as Error).message); }
    },
  );
  app.get("/api/partner/me/funds/:id", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const fund = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!fund || fund.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
    res.json({ fund, commitments: spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)) });
  });
  app.patch(
    "/api/partner/me/funds/:id",
    requirePartnerAuth,
    assertSubRole("managing_partner", "associate"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const existing = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
      if (!existing || existing.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      const b = (req.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      if (typeof b.fundName === "string") patch.name = b.fundName;
      if (typeof b.name === "string") patch.name = b.name;
      if (typeof b.status === "string") patch.status = LEGACY_TO_CANONICAL_FUND_STATUS[b.status] ?? b.status;
      if (b.targetSizeMinor !== undefined) patch.targetRaiseMinor = b.targetSizeMinor;
      if (b.closeDate !== undefined) patch.closeDate = b.closeDate;
      try {
        const fund = spvEngineStore.updateSpv(ctx.partnerId, String(req.params.id), patch, ctx.userId);
        res.json({ fund });
      } catch (e) { res.status(404).json({ error: (e as Error).message }); }
    },
  );
  app.get("/api/partner/me/funds/:id/commitments", requirePartnerAuth, (req: Request, res: Response) => {
    const ctx = req.partnerContext!;
    const fund = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
    if (!fund || fund.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
    res.json({ commitments: spvEngineStore.investorRegister(ctx.partnerId, String(req.params.id)) });
  });
  app.post(
    "/api/partner/me/funds/:id/commitments",
    requirePartnerAuth,
    assertSubRole("managing_partner"),
    requireSignedAgreement,
    (req: Request, res: Response) => {
      const ctx = req.partnerContext!;
      const { lpContactId, commitmentMinor, currency } = req.body ?? {};
      if (!isString(lpContactId) || !isNumber(commitmentMinor) || !isISOCurrency(currency)) {
        return badRequest(res, "lpContactId, commitmentMinor (int minor), ISO 4217 currency required");
      }
      const fund = spvEngineStore.getSpv(ctx.partnerId, String(req.params.id));
      if (!fund || fund.spvType !== "fund") return res.status(404).json({ error: "FUND_NOT_FOUND" });
      // Blocker 1 (4D): a NEW commitment is written THROUGH the canonical engine
      // as a subscription (LP register) — never as a legacy partnerFundsStore row.
      try {
        const sub = spvEngineStore.subscribe(
          ctx.partnerId,
          String(req.params.id),
          { investorId: lpContactId, commitmentMinor, currency },
          ctx.userId,
        );
        res.status(201).json({ commitment: sub });
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
          /* v25.32 P0 — include `invitedEmail` so the client recovery UI can
           * show the partner which mailbox the invite targeted. The recovery
           * "Log out and continue" action then clears the admin session and
           * re-fires the (unconsumed) token as anonymous. */
          return res.status(403).json({
            error: "PARTNER_INVITATION_EMAIL_MISMATCH",
            message: "This invitation was sent to a different email. Please log out and redeem with the invited address.",
            invitedEmail: row.email,
          });
        }
        /* v25.49.3 R1 — approved consortium-partner redemptions must NOT create
         * an investor-shaped persona. registerPersona() (SACRED userContext.ts)
         * hard-codes isInvestor + durable auth_users.role='investor'; that made
         * the post-redeem SESSION investor-shaped and re-broke partner password-
         * reset routing (2a). Instead resolve/create the consortium_partner
         * identity locally (never touching the sacred file). The single-use
         * token is still the credential; the strong random password is only a
         * placeholder the partner re-sets via the set-password flow. */
        const approvedUserId = existingCtx.isAuthed
          ? existingCtx.userId
          : resolveOrCreateConsortiumPartnerId(
              row.email,
              // Strong random password (C15) — the partner can re-set via the
              // set-password flow; the single-use token is the real credential.
              createHash("sha256").update(`${token}:${Date.now()}:${Math.random()}`).digest("hex"),
            );
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
      /* v25.32 P0 — include `invitedEmail` so the client recovery UI can
       * display which mailbox owns this invite. See sibling branch above. */
      return res.status(403).json({
        error: "PARTNER_INVITATION_EMAIL_MISMATCH",
        message: "This invitation was sent to a different email. Please log out and redeem with the invited address.",
        invitedEmail: pending.invitedEmail,
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
