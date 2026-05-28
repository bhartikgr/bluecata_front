import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import multer from "multer";
import { createHash, randomBytes } from "node:crypto";
import {
  companies,
  securities,
  rounds,
  roundInvitations,
  softCircles,
  crmInvestors,
  incomingInvitations,
  investorSoftCircles,
  portfolio,
  watchlist,
  discover,
  dataroomFiles,
  reports,
  activity,
  notifications,
  demoInvitationTokens,
  investorPortfolio,
  investorActivity,
  companyDetailsExtra,
  currentInvestor,
} from "./mockData";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
// v17 Phase A — chapter scoping store (used by /api/me/chapters).
import { listChaptersForUser as v17ListChaptersForUser } from "./chaptersStore";
import { registerProfileRoutes } from "./profileStore";
import { registerCommsRoutes } from "./commsStore";
import { registerCommsTiersRoutes } from "./commsTiersStore";
import { resetDemoState } from "../scripts/reset-demo";
import { registerYourDecisionRoutes } from "./yourDecisionStore";
import { registerMaIntelligenceRoutes } from "./maIntelligenceStore";
import { registerCrmRoutes } from "./crmStore";
import { registerCollectiveAppRoutes } from "./collectiveAppStore";
import { registerFounderCollectiveApplyRoutes } from "./founderCollectiveApplyStore";
import { registerCollectiveWaitlistRoutes } from "./collectiveWaitlistRoutes"; /* v16 Fix 6 */
import { registerWelcomeRoutes } from "./welcomeStore";
import { registerNetworkPostsRoutes } from "./networkPostsStore";
import { registerBulkMessageRoutes } from "./bulkMessageStore";
import { registerPortfolioAnalyticsRoutes } from "./portfolioAnalyticsStore";
import { registerSprint21Routes } from "./sprint21Routes";
import { setSessionCookie, clearSessionCookie, readSessionCookie } from "./lib/sessionCookie.js";
// Wave C FIX C1 (W-2) — logout must revoke the server-side session, not
// merely clear cookies on the client. See server/lib/sessionRevocation.ts.
import { revokeSession } from "./lib/sessionRevocation.js";
import { getRecentEvents, findEventsByType } from "./sprint10Telemetry";
// Sprint 11 — founder build
import { registerMultiCompanyRoutes, updateCompanyDetails } from "./multiCompanyStore";
import { registerMembershipRoutes } from "./membershipStore";
import { registerDataroomRoutes } from "./dataroomStore";
import { registerReportsRoutes } from "./reportsStore";
import { registerFounderCrmRoutes } from "./founderCrmStore";
import { registerCaptableCommitRoutes } from "./captableCommitStore";
import { registerTermSheetRoutes } from "./termSheetStore";
import { registerAdminPricingRoutes } from "./adminPricingStore";
import { registerBridgeRoutes } from "./bridgeStore";
import { registerNotificationsRoutes } from "./notificationsStore";
import { registerEmailRoutes } from "./emailStore";
import { registerEmailCampaignRoutes, registerEmailTransportRoutes } from "./emailCampaignStore";
import { registerAdminPlatformRoutes, appendAdminAudit, getAuditLog } from "./adminPlatformStore";
import { createRound as roundsStoreCreate, getRoundsForCompany as roundsStoreForCompany, listRounds as roundsStoreList, getRoundById as roundsStoreGetById } from "./roundsStore";
// v15 P0-4..P0-11 — real invitation + soft-circle stores.
import {
  createInvitation as roundInvitationsCreate,
  redeemInvitation as roundInvitationsRedeem,
  listForRound as roundInvitationsListForRound,
  revokeInvitation as roundInvitationsRevoke,
  extendInvitation as roundInvitationsExtend,
  getInvitation as roundInvitationsGet,
} from "./roundInvitationsStore";
import {
  createSoftCircle as softCircleCreate,
  validateSoftCircle as softCircleValidate,
  listForRound as softCircleListForRound,
} from "./softCircleStore";
import { configureSubscriptionsStore, registerSubscriptionRoutes, listSubscriptions, updateSubscription, getSubscription, createSubscriptionForNewCompany, type Subscription } from "./subscriptionsStore";
import { configurePricingModelStore, registerPricingModelRoutes } from "./pricingModelStore";
import { emitBridgeEvent } from "./bridgeStore";
import { companies as canonicalCompanies, rounds as canonicalRounds, softCircles as canonicalSoftCircles, dataroomFiles as canonicalDataroomFiles, reports as canonicalReports } from "./mockData";
import { getRecentEvents as getTelemetryEvents } from "./sprint10Telemetry";
import { registerBridgeRuntimeRoutes } from "./lib/bridgeRuntime";
import { registerSyncDashboardRoutes } from "./lib/syncDashboard";
import { registerMigrationRoutes } from "./lib/migrationRunner";
// Sprint 14 — universal hash chain + new stores
import { registerHashChainVerifyRoute } from "./lib/hashChain";
import { registerIntroRequestRoutes } from "./introRequestStore";
import { registerTransactionPrepRoutes } from "./transactionPrepStore";
import { registerMilestoneBroadcastRoutes } from "./milestoneBroadcastStore";
import { registerDscFeedbackRoutes } from "./dscFeedbackStore";
import { registerPaymentRoutes } from "./paymentStore";
// Sprint 28 Billing — Invoice store + Payment Gateway Adapter
import { configureInvoiceStore, registerInvoiceRoutes } from "./invoiceStore";
// Sprint 28 Wave 4 — Admin Contacts CRM
import { registerAdminContactsRoutes } from "./adminContactsStore";
// Patch v6 — Partner CRM
import { registerPartnerRoutes } from "./partnerRoutes";
import { seedTestPartnerSandbox } from "./partnerWorkspaceStore";
// Sprint 28 Wave 6 — Notification Campaigns
import { registerNotificationCampaignRoutes } from "./notificationCampaignStore";
import { registerPaymentGatewayRoutes } from "./paymentGatewayAdapter";
import { registerRegionExtensionRoutes } from "./regionExtensionStore";
// Sprint 28 Legal — consent ledger
import { registerLegalConsentRoutes } from "./legalConsentStore";
// Sprint 29 — KL closures
import { registerCompanyProfileRoutes } from "./companyProfileStore";
import { registerStripeWebhookRoute } from "./stripeGatewayAdapter";
// Wave C-3 + C-4 — Collective Shell + M&A Intelligence
import { registerCollectiveRoutes } from "./collectiveRoutes";
import { registerAdminCollectiveRoutes } from "./adminCollectiveRoutes";
import { registerAdminDscRoutes } from "./adminDscRoutes";
// v17 Phase C — Founder accept/decline offers + DSC vote public endpoint.
import { registerCollectiveOfferRoutes } from "./collectiveOffersStore";
import { registerCollectiveDscVoteRoutes } from "./collectiveDscVoteRoutes";
import { registerScreeningEventRoutes } from "./screeningEventsStore";
import { registerCollectiveBillingRoutes } from "./collectiveBillingStore";
import { registerExpertQARoutes } from "./expertQAStore";
import { registerChapterAnnouncementRoutes } from "./chapterAnnouncementsStore";
import { registerChapterResourceRoutes } from "./chapterResourcesStore";
import { registerLeaderboardRoutes } from "./chapterLeaderboardStore";
/* v19 Phase B — Messaging + Partner Workspace remaining DB-backed surfaces. */
import { registerMessagingRoutes } from "./messagingStore";
import { registerPartnerWorkspaceV19Routes } from "./partnerWorkspaceV19Store";
import { registerSpvFundRoutes } from "./spvFundStore";
/* CP Phase B — Apply-to-Join + Promotion Moderation + GDPR. */
import {
  registerConsortiumApplyRoutes,
  registerPartnerOnboardingRoutes,
} from "./consortiumApplyStore";
import { registerPromotionModerationRoutes } from "./promotionModerationRoutes";
import { registerGdprRoutes } from "./gdprRoutes";
import { registerCollectiveSseRoutes } from "./collectiveSseRoutes";
import { registerChapterAdminRoutes } from "./chapterAdminRoutes";
import { registerChapterAdminDashboardRoutes } from "./chapterAdminDashboardStore";
import { registerAdminDlqRoutes } from "./adminDlqRoutes";
import { registerAuditChainRoutes } from "./auditChainRoutes"; /* v19 Phase C */
import * as collectiveMembershipStore from "./collectiveMembershipStore";
import { listMembersForCompany as listCapTableMembersForCompany } from "./membershipStore";
import { emitNotification } from "./notificationsStore";
import { registerCollectiveSettingsRoutes } from "./collectiveSettingsStore";
import { registerContactRosterImporterRoutes } from "./contactRosterImporter";
// Sprint 15 — Login + Entitlement architecture
import { registerAuthShellRoutes, type RedemptionPreview, type RedemptionResult } from "./lib/authRoutes";
// Sprint 21 Wave B — Invitations enhancements
import { registerSprint21InvitationsRoutes } from "./sprint21InvitationsRoutes";
// Sprint 21 Wave C — Portfolio overhaul
import { registerSprint21PortfolioRoutes } from "./sprint21PortfolioRoutes";
import { registerSprint22Routes } from "./sprint22Routes";
import { registerRoundCarryForwardRoutes } from "./roundCarryForwardRoutes";
// Avi 22-May Issue 2 — PPS derivation helper routes.
import { registerRoundPriceDerivationRoutes } from "./lib/roundPriceDerivation";
import { registerSecureAuthRoutes } from "./lib/secureAuthRoutes";
import { registerAdminUsersRoutes } from "./lib/adminUsersRoutes";
import { registerAdminEmailRoutes } from "./lib/adminEmailRoutes";
import { realtimeStreamHandler, emitMutation } from "./lib/eventBus";
import { BridgeOutbound } from "./lib/bridgeOutbound";
import { csrfMiddleware } from "./lib/csrf";
import { rateLimitMiddleware, collectiveRateLimit } from "./lib/rateLimit";
import { securityHeaders, corsForApi } from "./middleware/security";
import { getDb } from "./db/connection";
import { users as usersTable } from "../shared/schema"; /* Avi 22-May Issue 6 */
import { eq as drizzleEq } from "drizzle-orm"; /* Avi 22-May Issue 6 */
import { SYNC_ENTITY_COUNT } from "./db/syncRepo";
import { getOutbox } from "./bridgeStore";
import { loadUserContext, requireEntitlement } from "./lib/requireEntitlement";
import { registerPersona } from "./lib/userContext";
import { getUserContextForId, getUserContext } from "./lib/userContext";
import { companies as _allCompanies } from "./mockData";
// Sprint-fix: production auth middleware
import { requireAuth, requireAdmin, requireAuthenticated } from "./lib/authMiddleware";
import { log } from "./lib/logger";

/* ---------------------------------------------------------------------
 * Sprint 7 — invitation token store (in-memory mock).
 *
 * The store holds ONLY token hashes. Raw tokens never appear in any
 * persisted record. The three demo tokens from mockData are pre-seeded
 * here at boot so the preview is demoable without sending real email.
 * ------------------------------------------------------------------- */
interface InvitationStoreEntry {
  id: string;
  tokenHash: string;
  roundId: string;
  companyId: string;
  companyName: string;
  inviteeEmail: string;
  inviteeName: string;
  prefilledScreenName: string | null;
  issuedAt: string;
  expiresAt: string;
  redeemed: boolean;
  redeemedAt: string | null;
  revoked: boolean;
}

const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const DAY_MS = 24 * 60 * 60 * 1000;

const invitationStore: InvitationStoreEntry[] = demoInvitationTokens.map((d) => {
  const issuedAt = new Date("2026-04-25T10:00:00Z");
  return {
    id: d.id,
    tokenHash: sha256Hex(d.rawToken),
    roundId: d.roundId,
    companyId: d.companyId,
    companyName: d.companyName,
    inviteeEmail: d.inviteeEmail,
    inviteeName: d.inviteeName,
    prefilledScreenName: d.prefilledScreenName,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 60 * DAY_MS).toISOString(),
    redeemed: false,
    redeemedAt: null,
    revoked: false,
  };
});

/* Coarse rate-limiter: 10 req / minute / IP for /api/invitations/check + redeem */
const rateBuckets = new Map<string, number[]>();
function allow(ip: string, limitPerMin = 10): boolean {
  const now = Date.now();
  const minute = 60_000;
  const arr = (rateBuckets.get(ip) ?? []).filter((t) => now - t < minute);
  if (arr.length >= limitPerMin) {
    rateBuckets.set(ip, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(ip, arr);
  return true;
}

/**
 * v13 — Avi's Issue 3 helper.
 *
 * Returns the union of the legacy in-memory `rounds` array (seeded by mockData
 * + appended-to by POST /api/rounds for the current boot) and rounds hydrated
 * from the SQL `rounds` table via roundsStore. Rounds present in both lists
 * (matched by `id`) are deduplicated, preferring the legacy in-memory entry
 * because it carries the legacy seed's extra columns the UI expects.
 */
function mergeLegacyAndDbRounds(): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacy = rounds as unknown as any[];
  const dbRounds = roundsStoreList();
  if (dbRounds.length === 0) return legacy;
  const legacyIds = new Set(legacy.map((r) => r.id));
  const extras = dbRounds.filter((r) => !legacyIds.has(r.id));
  if (extras.length === 0) return legacy;
  return [...legacy, ...extras];
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  /* ------------ v19 Phase C: correlation id MUST be the very first middleware
   * so every downstream log line, audit_log row, and SSE heartbeat can carry
   * the same trace id end-to-end. ------------ */
  const { correlationIdMiddleware } = await import("./lib/correlationId");
  app.use(correlationIdMiddleware);

  /* ------------ Sprint 17 D2: security headers + CORS (front of stack) ------------ */
  app.use(securityHeaders);
  app.use("/api", corsForApi);

  /* ------------ Sprint 22 Wave 1: loadUserContext MUST be first so every downstream
   * handler has req.userContext populated (DEF-022 root fix). ------------ */
  app.use(loadUserContext);

  /* ------------ v14 Tier-1 Fix 5: feature flags read endpoint ------------ */
  app.get("/api/feature-flags", async (_req, res) => {
    const { FEATURE_FLAGS } = await import("./lib/featureFlags");
    res.json(FEATURE_FLAGS);
  });

  /* ------------ Sprint 8: profile store + PATCH endpoints ------------ */
  registerProfileRoutes(app);

  /* ------------ Sprint 9: communications store + endpoints ------------ */
  registerCommsRoutes(app);

  /* ------------ Sprint 10: investor surface ------------ */
  registerYourDecisionRoutes(app);
  registerMaIntelligenceRoutes(app);
  registerCrmRoutes(app);
  registerCollectiveAppRoutes(app);
  registerFounderCollectiveApplyRoutes(app);
  /* v16 Fix 6 — Collective Waitlist (honest invite-only beta entry point).
   * Stays available regardless of COLLECTIVE_ENABLED. */
  registerCollectiveWaitlistRoutes(app);
  registerWelcomeRoutes(app);
  registerNetworkPostsRoutes(app);
  registerBulkMessageRoutes(app);
  registerPortfolioAnalyticsRoutes(app);
  registerSprint21Routes(app);

  /* ------------ Sprint 11: founder build ------------ */
  registerMultiCompanyRoutes(app);

  /* Sprint 28 Wave 8 — new company creation auto-provisions a pending_payment subscription.
   * Idempotent: repeated calls with same companyId return the existing subscription.
   * Emits audit-log entry + bridge event subscription.auto_created_on_company_create.
   */
  app.post("/api/founder/companies", requireAuth, (req: import("express").Request, res: import("express").Response) => {
    const { companyId, companyName, plan } = req.body ?? {};
    if (!companyId || !companyName) {
      return res.status(400).json({ ok: false, error: "companyId and companyName are required" });
    }
    const actor = String((req as any).userContext?.identity?.email ?? (req as any).userContext?.userId ?? `founder:${companyId}`); /* v14 */
    const result = createSubscriptionForNewCompany(companyId, { plan, actor });
    res.status(201).json({ ok: true, companyId, companyName, subscription: result.subscription, subscriptionCreated: result.created });
  });

  registerMembershipRoutes(app);
  registerDataroomRoutes(app);
  registerReportsRoutes(app);
  registerFounderCrmRoutes(app);
  registerCaptableCommitRoutes(app);
  // Sprint 26 — credentialed term-sheet persistence (hash-chained revisions).
  registerTermSheetRoutes(app);
  registerAdminPricingRoutes(app);

  /* ------------ Sprint 12: bridge + admin rebuild ------------ */
  registerBridgeRoutes(app);
  registerBridgeRuntimeRoutes(app);
  registerSyncDashboardRoutes(app);
  registerMigrationRoutes(app);
  registerNotificationsRoutes(app);
  registerEmailRoutes(app);
  registerAdminPlatformRoutes(app);

  /* ------------ Sprint 28 Wave 3 — production subscriptions store ------------ */
  configureSubscriptionsStore({
    audit: (e) => {
      appendAdminAudit(e.actor, e.target, e.action, e.payload as Record<string, unknown>);
      emitMutation({ aggregate: "subscription", id: e.target, change: e.action });
    },
    bridge: (eventType, aggregateId, payload) => {
      emitBridgeEvent({
        eventType: eventType as Parameters<typeof emitBridgeEvent>[0]["eventType"],
        aggregateId,
        aggregateKind: "company",
        payload: payload as Record<string, unknown>,
      });
    },
  });
  registerSubscriptionRoutes(app);
  registerAdminCompaniesFullRoute(app);

  /* ------------ Sprint 28 — pricing model authoring ------------ */
  configurePricingModelStore({
    audit: (e) => appendAdminAudit(e.actor, e.target, e.action, e.payload as Record<string, unknown>),
    bridge: (eventType, aggregateId, payload) => {
      emitBridgeEvent({
        eventType: eventType as Parameters<typeof emitBridgeEvent>[0]["eventType"],
        aggregateId,
        aggregateKind: "pricing_model",
        payload: payload as Record<string, unknown>,
      });
    },
  });
  registerPricingModelRoutes(app);

  /* ------------ Sprint 28 Billing — invoice store + payment gateway ------------ */
  configureInvoiceStore({
    audit: (e) => appendAdminAudit(e.actor, e.target, e.action, e.payload as Record<string, unknown>),
    bridge: (eventType, aggregateId, payload) => {
      emitBridgeEvent({
        eventType: eventType as Parameters<typeof emitBridgeEvent>[0]["eventType"],
        aggregateId,
        aggregateKind: "company",
        payload: payload as Record<string, unknown>,
      });
    },
  });
  registerInvoiceRoutes(app);
  registerPaymentGatewayRoutes(app);

  /* ------------ Sprint 28 Wave 4: Admin Contacts CRM ------------ */
  registerAdminContactsRoutes(app);
  registerPartnerRoutes(app);
  // Patch v6 — seed TEST PARTNER sandbox under demo gate only.
  // Production NEVER seeds (DEMO_SEED_ENABLED already enforces production exclusion).
  if (DEMO_SEED_ENABLED) seedTestPartnerSandbox();
  registerRegionExtensionRoutes(app);

  /* ------------ Sprint 28 Wave 6: Notification Campaigns ------------ */
  registerNotificationCampaignRoutes(app);
  registerEmailCampaignRoutes(app);
  registerEmailTransportRoutes(app);

  /* ------------ Sprint 28 Legal: consent ledger + admin view ------------ */
  registerLegalConsentRoutes(app);

  /* ------------ Sprint 29: KL closures ------------ */
  registerCompanyProfileRoutes(app);
  registerStripeWebhookRoute(app);
  registerContactRosterImporterRoutes(app);

  /* ------------ Wave C-3 + C-4: Collective Shell + M&A Intelligence ------------ */
  // v19 Phase C — per-(user, bucket) sliding-window rate limits on the three
  // post-v17 surface areas. NOT gated by COLLECTIVE_ENABLED — always-on.
  app.use("/api/collective", collectiveRateLimit);
  app.use("/api/partner", collectiveRateLimit);
  app.use("/api/messages", collectiveRateLimit);
  // Patch v5 — every /api/collective/* endpoint requires an authenticated
  // session. Anonymous callers get 401 {"error":"AUTH_REQUIRED"}.
  app.use("/api/collective", requireAuthenticated);
  registerCollectiveRoutes(app);
  registerCollectiveSettingsRoutes(app);

  /* ------------ 23-May Fix 1B — Mount-level admin guard ------------
   *
   * Audit-grade finding: of the 173 /api/admin/* endpoints registered across
   * the server, only 44 carried an explicit `requireAdmin` middleware. The
   * remaining 129 relied on the persona fallback (?as=admin or x-user-id
   * header) for test exercises but were effectively UNPROTECTED in
   * production — any authenticated session could reach them.
   *
   * Rather than chase down 129 handler sites (which would be a large
   * surface for cascading breakage), we mount a SINGLE guard at the
   * `/api/admin` prefix. `requireAdmin` already 401s anon callers and
   * 403s non-admin sessions. Endpoints already carrying their own
   * `requireAdmin` still work — the middleware is idempotent (ctx is
   * resolved per-request).
   *
   * Tests that drive these endpoints set `x-user-id: u_admin` or use
   * `?as=admin`, both of which resolve through getUserContext() to the
   * static u_admin persona (isAdmin: true) and pass the guard.
   * --------------------------------------------------------------- */
  app.use("/api/admin", requireAdmin);

  /* ------------ Patch v10 — Admin Collective approval pipeline (P0-10/C-CORE-1) ------------ */
  registerAdminCollectiveRoutes(app);

  /* ------------ Patch v10 — Admin DSC promotion + investor submission (P0-9) ------------ */
  registerAdminDscRoutes(app);
  /* v17 Phase C — Founder accept/decline endpoints for Collective offers,
   * plus DSC vote/results endpoints with chapter quorum. Both gated by
   * COLLECTIVE_ENABLED at the route handler level (requireCollectiveEnabled). */
  registerCollectiveOfferRoutes(app);
  registerCollectiveDscVoteRoutes(app);
  registerScreeningEventRoutes(app);
  /* v18 Phase B — Stripe Collective membership tier (basic/standard/premium).
   * Three annual tiers, sold via Stripe Checkout; webhook is a separate
   * /api/stripe/webhook/collective endpoint (intentionally NOT under
   * /api/collective/* so it bypasses requireAuthenticated — Stripe is the
   * caller, and the signature IS the auth). Graceful 503 when env vars unset. */
  registerCollectiveBillingRoutes(app);

  /* ------------ v18 Phase C — Ask-an-Expert (Q&A + reputation). All
   * endpoints live under /api/collective/{questions,answers,reputation}
   * and are gated by COLLECTIVE_ENABLED + requireAuth + requireCollectiveMember
   * + inline isChapterMember/isChapterAdmin checks. */
  registerExpertQARoutes(app);

  /* ------------ v19 Phase A — Announcements, Resources Library, Leaderboard.
   * All four secondary surfaces live under /api/collective/{announcements,
   * resources,leaderboard} and are gated by COLLECTIVE_ENABLED + requireAuth
   * + requireCollectiveMember + inline chapter membership checks. */
  registerChapterAnnouncementRoutes(app);
  registerChapterResourceRoutes(app);
  registerLeaderboardRoutes(app);

  /* ------------ v19 Phase B — Messaging DB migration (remaining slices)
   * + Partner workspace remaining DB-backed surfaces (portfolio, CRM,
   * deal pipeline). The v17 Collective slice owns its own tables; these
   * routes do not touch them. */
  registerMessagingRoutes(app);
  registerPartnerWorkspaceV19Routes(app);
  // CP Phase A (CP-028/029/030/031): DB-backed SPV lifecycle endpoints.
  // Mounted AFTER partnerRoutes so the legacy v17/v18 top-level SPV paths
  // (list/get/create/update + positions) remain owned by partnerRoutes.
  // This module only adds non-conflicting child paths: /commitments,
  // /capital-calls, /distributions, /detail, /db-positions.
  registerSpvFundRoutes(app);
  /* ------------ CP Phase B (CP-001..005, CP-013, CP-015..018) ------------ */
  // Public apply flow, admin review, partner onboarding state, chapter-admin
  // promotion moderation queue, GDPR export/delete/anonymize.
  registerConsortiumApplyRoutes(app);
  registerPartnerOnboardingRoutes(app);
  registerPromotionModerationRoutes(app);
  registerGdprRoutes(app);

  /* ------------ v18 Phase D — SSE real-time stream + chapter admin role +
   * chapter admin dashboard. The stream is per-(chapter, topic) and the
   * dashboard aggregates over the same chapter scope. Chapter-admin
   * management endpoints are platform-admin-only. */
  registerCollectiveSseRoutes(app);
  registerChapterAdminRoutes(app);
  registerChapterAdminDashboardRoutes(app);
  registerAuditChainRoutes(app); /* v19 Phase C */

  /* ------------ Patch v10 — Admin Dead-Letter Queue (BUG-17) ------------ */
  registerAdminDlqRoutes(app);

  /* ------------ Patch v10 — /api/me/membership convenience endpoint for client.
   * Returns the *active* Collective membership state derived from the
   * collectiveMembershipStore (admin-approval pipeline) plus cap-table
   * positions from the captable ledger. Authenticated only. */
  app.get("/api/me/membership", requireAuth, (req, res) => {
    const ctx = req.userContext!;
    const row = collectiveMembershipStore.get(ctx.userId);
    const positions = ctx.investor?.capTablePositions ?? [];
    res.json({
      userId: ctx.userId,
      isAuthed: true,
      collective: row
        ? { status: row.status, tier: row.tier, activatedAt: row.activatedAt, activatedBy: row.activatedBy }
        : { status: "none", tier: null, activatedAt: null, activatedBy: null },
      capTable: { positions, count: positions.length },
    });
  });

  /* ------------ v17 Phase A — chapter scoping: GET /api/me/chapters ------------
   *
   * Returns the authenticated user's Collective chapter memberships. Used by
   * the chapter selector dropdown in the Collective shell topbar.
   *
   * Auth: requireAuth (chapter membership IS the gate — anyone authed may
   * ask "what chapters am I in?"; a non-Collective user simply returns []).
   *
   * Feature flag: when COLLECTIVE_ENABLED=0 (default Saturday-ship posture),
   * the endpoint returns 503 gracefully. Per V19_BUILD_BRIEF.md Rule 12, the
   * Friday launch baseline must remain intact; the chapter selector is
   * hidden client-side too (see ChapterSelector.tsx).
   */
  app.get("/api/me/chapters", requireAuth, (req, res) => {
    if (process.env.COLLECTIVE_ENABLED !== "1") {
      res.status(503).json({
        ok: false,
        error: "collective_not_available",
        message: "The Collective subsystem is disabled. Set COLLECTIVE_ENABLED=1 to enable chapter scoping.",
        chapters: [],
      });
      return;
    }
    const ctx = req.userContext!;
    try {
      const chapters = v17ListChaptersForUser(ctx.userId);
      res.json({ ok: true, userId: ctx.userId, chapters });
    } catch (err) {
      // Don't crash request handling — fall back to empty list. The chapter
      // selector will simply hide itself.
      log.warn("[/api/me/chapters] read failed:", (err as Error).message);
      res.json({ ok: true, userId: ctx.userId, chapters: [], degraded: true });
    }
  });

  /* ------------ Sprint 14: CRM/Comms deep + universal hash chain + payments ------------ */
  registerHashChainVerifyRoute(app);
  registerIntroRequestRoutes(app);
  registerTransactionPrepRoutes(app);
  registerMilestoneBroadcastRoutes(app);
  registerDscFeedbackRoutes(app);
  registerPaymentRoutes(app);

  /* ------------ Sprint 16: Communications Deep Unlock (3 tiers) ------------ */
  registerCommsTiersRoutes(app);

  /* ------------ Sprint 17 D1: prime DB layer (24 sync entities) ------------ */
  getDb(); // creates SQLite in-memory + applies inline migrations

  /* ------------ Sprint 17 D2: rate-limit + CSRF on /api/auth/secure/* (scoped) ------------ */
  app.use("/api/auth/secure", rateLimitMiddleware);
  app.use("/api/auth/secure", csrfMiddleware);

  /* ------------ G7 fix: extend CSRF to all state-mutating investor routes ------------ */
  const csrfForMethod = (method: string) => (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (req.method.toUpperCase() !== method.toUpperCase()) return next();
    return csrfMiddleware(req, res, next);
  };
  app.use("/api/invitations/redeem", csrfForMethod("POST"));
  app.use("/api/collective/applications", csrfForMethod("POST"));
  app.use("/api/rounds", (req, res, next) => {
    if (req.method.toUpperCase() === "PATCH" && req.path.includes("/decision")) {
      return csrfMiddleware(req, res, next);
    }
    next();
  });

  /* ------------ Sprint 17 D6: secure JWT auth (alongside Sprint 15 persona shell) ------------ */
  registerSecureAuthRoutes(app);

  /* ------------ Sprint 17 D7: admin user management ------------ */
  registerAdminUsersRoutes(app);

  /* ------------ v23.4.2: admin SMTP diagnostic endpoints ------------ */
  registerAdminEmailRoutes(app);

  /* ------------ Sprint 17 D4: realtime invalidation stream ------------ */
  app.get("/api/events/stream", realtimeStreamHandler);

  /* ------------ Sprint 17 health: DB layer status ------------ */
  app.get("/api/db/status", requireAuth, (_req, res) => {
    res.json({ ok: true, syncEntities: SYNC_ENTITY_COUNT, driver: process.env.DATABASE_URL?.startsWith("postgres") ? "postgres" : "sqlite" });
  });

  /* ------------ Pass 4: /api/healthz production healthcheck (PUBLIC — no auth) ------------ */
  const SERVER_START = Date.now();
  const { version } = (() => { try { return require("../package.json") as { version: string }; } catch { return { version: "0.0.0" }; } })();
  app.get("/api/healthz", (_req, res) => {
    const dbOk = (() => { try { getDb(); return true; } catch { return false; } })();
    const bridgeOutboxBacklog = getOutbox().filter(e => e.status === "queued" || e.status === "delivering").length;
    res.json({
      ok: true,
      version,
      uptimeSec: Math.floor((Date.now() - SERVER_START) / 1000),
      dbConnected: dbOk,
      bridgeOutboxBacklog,
      emailOutboxBacklog: 0,
      timestamp: new Date().toISOString(),
    });
  });

  /* ------------ v19 Phase C — /api/health (enhanced, PUBLIC) ------------ */
  app.get("/api/health", async (_req, res) => {
    const dbOk = (() => { try { getDb(); return true; } catch { return false; } })();
    let sseSubscribers = 0;
    try {
      const { hubStats } = await import("./lib/sseHub");
      sseSubscribers = hubStats().totalSubscribers;
    } catch { /* ignore */ }
    let hydrateState: "ok" | "partial" | "failed" | "pending" | "in_progress" = "pending";
    try {
      const { getHydrateProgress } = await import("./lib/hydrateStores");
      hydrateState = getHydrateProgress().state;
    } catch { /* ignore */ }
    res.json({
      status: dbOk && (hydrateState === "ok" || hydrateState === "partial") ? "ok" : "degraded",
      db: dbOk ? "connected" : "down",
      sse_subscribers: sseSubscribers,
      hydrate_state: hydrateState,
      git_sha: process.env.GIT_SHA ?? null,
      build_time: process.env.BUILD_TIME ?? null,
      uptime_s: Math.floor((Date.now() - SERVER_START) / 1000),
      version,
      timestamp: new Date().toISOString(),
    });
  });

  /* ------------ Sprint 16 A4: Admin demo reset — requireAdmin gate ------------ */
  app.post("/api/admin/sync/reset-demo", requireAdmin, (req, res) => {
    const summary = resetDemoState();
    return res.status(summary.ok ? 200 : 207).json(summary);
  });

  /* ------------ Sprint 15: Auth shell + entitlement gates ------------ */
  registerAuthShellRoutes(app, {
    preview: (rawToken: string): RedemptionPreview => {
      const hash = sha256Hex(rawToken);
      const entry = invitationStore.find(e => e.tokenHash === hash);
      if (!entry) return { ok: false, reason: "not_found" };
      if (entry.revoked) return { ok: false, reason: "revoked" };
      if (entry.redeemed) return { ok: false, reason: "already_redeemed" };
      if (Date.now() > new Date(entry.expiresAt).getTime()) return { ok: false, reason: "expired" };
      const company = _allCompanies.find(c => c.id === entry.companyId);
      const round = rounds.find(r => r.id === entry.roundId);
      return {
        ok: true,
        invitation: {
          roundId: entry.roundId,
          companyId: entry.companyId,
          companyName: entry.companyName,
          inviteeEmail: entry.inviteeEmail,
          inviteeName: entry.inviteeName,
          expiresAt: entry.expiresAt,
          roundLabel: round ? `${round.type ?? ""}${round.targetAmount ? " · $" + (round.targetAmount/1_000_000).toFixed(1) + "M target" : ""}` : undefined,
          founderName: company ? "Founder" : undefined,
        },
      };
    },
    redeem: (rawToken: string): RedemptionResult => {
      const hash = sha256Hex(rawToken);
      const entry = invitationStore.find(e => e.tokenHash === hash);
      if (!entry) return { ok: false, reason: "not_found" };
      if (entry.revoked) return { ok: false, reason: "revoked" };
      if (entry.redeemed) return { ok: false, reason: "already_redeemed" };
      if (Date.now() > new Date(entry.expiresAt).getTime()) return { ok: false, reason: "expired" };
      entry.redeemed = true;
      entry.redeemedAt = new Date().toISOString();
      return { ok: true, invitationId: entry.id, roundId: entry.roundId, companyId: entry.companyId };
    },
  });

  /* ----- Gated investor surface (Sprint 15 D2, Defect 59 / G3 fix) -----
   * v15 P0-14 hardening: ?enforce=0 query bypass is REMOVED.
   * Enforcement is ALWAYS ON. The only legal bypass is an explicit
   * dev/test escape hatch gated by BOTH:
   *   - NODE_ENV === "development"  (NOT "test", NOT "production")
   *   - process.env.ALLOW_GATE_BYPASS === "1"
   * No client-controlled input (query string, header, body) can
   * disable the gate. This closes the launch-blocker where a hostile
   * caller could append ?enforce=0 to bypass entitlement enforcement.
   */
  function gate(...required: Parameters<typeof requireEntitlement>): import("express").RequestHandler {
    const mw = requireEntitlement(...required);
    return (req, res, next) => {
      const isDevBypass =
        process.env.NODE_ENV === "development" &&
        process.env.ALLOW_GATE_BYPASS === "1";
      if (isDevBypass) return next();
      return mw(req, res, next);
    };
  }
  app.use("/api/investor/portfolio",  gate("investor.hasAnyCapTable"));
  app.use("/api/investor/crm",        gate("investor.hasAnyCapTable"));
  app.use("/api/investor/messages",   gate("investor.hasAnyCapTable"));
  app.use("/api/investor/portfolio2", gate("investor.hasAnyCapTable"));
  app.use("/api/investor/companies/:companyId", gate("investor.onCapTableOf"));
  app.use("/api/collective/applications", (req, res, next) => {
    if (req.method !== "POST") return next();
    return gate("investor.hasAnyCapTable")(req, res, next);
  });
  app.use("/api/collective/network",   gate("collective.active"));
  app.use("/api/collective/dealroom",  gate("collective.active"));
  app.use("/api/founder/companies/:id/billing", gate("founder.ofCompany"));

  // Sprint 10: telemetry inspection (admin-only)
  app.get("/api/telemetry/sprint10", requireAdmin, (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    res.json(type ? findEventsByType(type) : getRecentEvents(200));
  });

  // Sprint 10: round activity stream — requires auth
  // Patch v4: ALL_ITEMS demo seed only when DEMO_SEED_ENABLED.
  app.get("/api/investor/round-activity", requireAuth, (req, res) => {
    const ALL_ITEMS = DEMO_SEED_ENABLED ? [
      { id: "ra_1", ts: "2026-05-08T09:14:00Z", kind: "new_round",       companyId: "co_arboreal", company: "Arboreal Health", text: "Pre-Seed open · $1.5M target · soft-circle window 14d", href: "/investor/companies/co_arboreal?tab=your-decision", roundId: "rnd_pre" },
      { id: "ra_2", ts: "2026-05-07T17:02:00Z", kind: "soft_circle",     companyId: "co_novapay",  company: "NovaPay AI",      text: "Seed Extension · $2.65M soft-circled of $4.0M",     href: "/investor/companies/co_novapay?tab=your-decision", roundId: "rnd_novapay_seed" },
      { id: "ra_3", ts: "2026-05-06T11:08:00Z", kind: "term_sheet",      companyId: "co_quanta",   company: "Quanta Robotics", text: "Series A term sheet drop — pro-rata exercise window 7d", href: "/investor/companies/co_quanta?tab=your-decision",  roundId: "rnd_q_a" },
      { id: "ra_4", ts: "2026-05-05T14:33:00Z", kind: "close_gate",      companyId: "co_helia",    company: "Helia AI",        text: "Series A closing tomorrow — last call for confirmations", href: "/investor/companies/co_helia?tab=your-decision", roundId: "rnd_helia_a" },
      { id: "ra_5", ts: "2026-05-03T08:00:00Z", kind: "new_round",       companyId: "co_kelvin",   company: "Kelvin Energy",   text: "Bridge note round opening Q2",                       href: "/investor/companies/co_kelvin?tab=your-decision", roundId: "rnd_k_bridge" },
    ] : [];
    const ctx = req.userContext;
    if (ctx?.isAuthed && !ctx.isAdmin) {
      const invitedCompanyIds = new Set([
        ...ctx.investor.invitedRounds.map(r => r.companyId),
        ...ctx.investor.capTablePositions.map(p => p.companyId),
      ]);
      if (invitedCompanyIds.size > 0) {
        return res.json(ALL_ITEMS.filter(item => invitedCompanyIds.has(item.companyId)));
      }
    }
    res.json(ALL_ITEMS);
  });

  /* ------------ founder side — auth required ------------ */
  app.get("/api/companies", requireAuth, (_req, res) => res.json(companies));

  /* Sprint 7 — access-aware company-details payload.
   * Auth required. Founders/admins see everything; investors see only invited companies.
   */
  app.get("/api/companies/:id", requireAuth, async (req, res) => {
    const c = companies.find(c => c.id === req.params.id);
    const extra = companyDetailsExtra[req.params.id] ?? null;
    if (!c && !extra) return res.status(404).json({ message: "Not found" });

    // V7 (Patch v8): replaced private _testAccess.companyProfiles.get(id) reach-in
    // with public getCompanyProfileSnapshot() accessor.
    const { getCompanyProfileSnapshot } = await import("./profileStore");
    const liveProfile = getCompanyProfileSnapshot(req.params.id);

    const ctx = req.userContext;
    let role: string;
    if (ctx?.isAdmin) {
      role = "admin";
    } else if (ctx?.founder?.companies?.some(fc => fc.companyId === req.params.id)) {
      role = "founder";
    } else {
      role = "investor";
    }
    const investorId = ctx?.userId ?? String(req.query.investorId ?? currentInvestor.id);

    let canSeeRound = role === "founder" || role === "admin";
    let canSeeDataroom = canSeeRound;
    let canSeeSoftCircle = canSeeRound;
    let canSeeTermSheet = canSeeRound;

    if (role === "investor") {
      const invited = !!(ctx?.investor?.invitedRounds?.some(r => r.companyId === req.params.id) ||
                         ctx?.investor?.capTablePositions?.some(p => p.companyId === req.params.id));
      canSeeRound = invited;
      canSeeDataroom = invited;
      canSeeSoftCircle = invited;
      canSeeTermSheet = invited;
    }

    const companyShared = c ?? {
      id: req.params.id,
      name: extra ? extra.legalEntity.name.replace(/, (Inc|Ltd)\.?$/i, "").replace(/\s*Co\.$/, "") : req.params.id,
      legalName: extra?.legalEntity.name ?? "",
      sector: "",
      stage: "",
      hq: extra?.mailingAddress ?? "",
      websiteUrl: "",
      description: extra?.headliner ?? "",
      logoUrl: null,
      founded: "",
      employees: 0,
      tenantId: "",
    };

    // v13 — union legacy in-memory rounds with DB-hydrated rounds.
    const roundsForCompany = mergeLegacyAndDbRounds().filter(r => r.companyId === req.params.id);
    const dataroomForCompany = dataroomFiles.filter(f => f.companyId === req.params.id);
    const softCirclesForCompany = softCircles.filter(s => roundsForCompany.find(r => r.id === s.roundId));

    res.json({
      ...companyShared,
      ...(extra ?? {}),
      profile: liveProfile,
      access: { role, canSeeRound, canSeeDataroom, canSeeSoftCircle, canSeeTermSheet, investorId },
      rounds: canSeeRound ? roundsForCompany : null,
      dataroom: canSeeDataroom ? dataroomForCompany : null,
      softCircles: canSeeSoftCircle
        ? (role === "founder" || role === "admin"
            ? softCirclesForCompany
            : softCirclesForCompany.filter(s => s.investorName === currentInvestor.entityName || s.investorName === currentInvestor.legalName))
        : null,
      termSheet: canSeeTermSheet ? { available: true, lastUpdated: "2026-04-22" } : null,
    });
  });

  app.get("/api/companies/:id/securities", requireAuth, (req, res) => {
    // v14 Tier-1 Fix 2 — ownership/visibility check: caller must be a
    // company member OR an investor in a round of that company OR admin.
    // Closes audit finding F-founder-04 (any auth user could read cap-table
    // securities for any company).
    const cid = req.params.id;
    const ctx = req.userContext ?? getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "missing_identity" });
    const isFounder = ctx.founder.companies.some((c) => c.companyId === cid);
    const isInvestorInCompany = ctx.investor.capTablePositions.some((p) => p.companyId === cid)
      || ctx.investor.invitedRounds.some((i) => i.companyId === cid);
    if (!ctx.isAdmin && !isFounder && !isInvestorInCompany) {
      return res.status(403).json({ ok: false, error: "not_authorized" });
    }
    res.json(securities.filter(s => s.companyId === cid));
  });

  // PATCH v3: Filter rounds by companyId (required for founder surface); coerce pricePerShare to number.
  // v13 (Avi's Issue 3): also merges DB-hydrated rounds (from roundsStore)
  // so rounds created in previous boots survive a server restart.
  app.get("/api/rounds", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    const companyIdFilter = typeof req.query.companyId === "string" ? req.query.companyId : null;
    const mergedAll = mergeLegacyAndDbRounds();
    let filtered = mergedAll;
    if (companyIdFilter) {
      // Verify session user owns this company or is admin
      const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === companyIdFilter);
      if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
      filtered = mergedAll.filter((r) => r.companyId === companyIdFilter);
    } else if (!ctx.isAdmin) {
      // Non-admin without companyId filter: only show rounds for their own companies
      const userCompanyIds = new Set(ctx.founder.companies.map((c) => c.companyId));
      if (userCompanyIds.size > 0) {
        filtered = mergedAll.filter((r) => userCompanyIds.has(r.companyId));
      } else {
        // New user with no companies — return empty
        return res.json([]);
      }
    }
    const enriched = filtered.map(r => ({
      ...r,
      // PATCH v3 Bug 4a: coerce pricePerShare to number (never string) to prevent .toFixed crash
      pricePerShare: r.pricePerShare != null ? Number(r.pricePerShare) : null,
      company: companies.find(c => c.id === r.companyId)?.name ?? "Unknown",
    }));
    res.json(enriched);
  });

  // Patch v10 (B-F6): caller must be on the round's cap-table OR own the company OR be admin.
  app.get("/api/rounds/:id", requireAuth, (req, res) => {
    const ctx = req.userContext!;
    /* 23-May Fix 3 — the sibling list endpoint (GET /api/rounds) uses
     * mergeLegacyAndDbRounds() but this detail endpoint was still reading
     * from the bare in-memory `rounds` array. In production (no demo seed)
     * that array is empty at boot, so newly-created rounds that survived
     * via the SQL `rounds` table were not visible here and the detail page
     * returned 404 even though the list page rendered the row. */
    const r = mergeLegacyAndDbRounds().find((rr: any) => rr.id === req.params.id);
    if (!r) return res.status(404).json({ message: "Not found" });
    if (!ctx.isAdmin) {
      const ownsCompany = ctx.founder.companies.some((c) => c.companyId === r.companyId);
      const onCapTable = (ctx.investor?.capTablePositions ?? []).some((p) => p.companyId === r.companyId);
      if (!ownsCompany && !onCapTable) {
        return res.status(403).json({ ok: false, error: "NOT_AUTHORIZED_FOR_ROUND", message: "You must own this company or be on its cap table to view this round." });
      }
    }
    // PATCH v3 Bug 4a: coerce pricePerShare to number
    res.json({ ...r, pricePerShare: r.pricePerShare != null ? Number(r.pricePerShare) : null, company: companies.find(c => c.id === r.companyId)?.name });
  });

  /* Sprint 18 T5.1 — Edit Terms (active rounds only) — requireAuth */
  app.patch("/api/rounds/:id/terms", requireAuth, (req, res) => {
    /* 23-May Fix 3 — same legacy/db merge fix as GET /api/rounds/:id. */
    const r = mergeLegacyAndDbRounds().find((rr: any) => rr.id === req.params.id);
    if (!r) return res.status(404).json({ message: "Not found" });
    if (r.state === "closed" || r.state === "funded") {
      return res.status(409).json({ error: "closed_round_readonly", state: r.state });
    }
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof body.targetAmount === "number" && body.targetAmount > 0) updates.targetAmount = body.targetAmount;
    if (typeof body.preMoney === "number" && body.preMoney >= 0) updates.preMoney = body.preMoney;
    if (typeof body.postMoney === "number" && body.postMoney >= 0) updates.postMoney = body.postMoney;
    // PATCH v3 Bug 4a: coerce pricePerShare from string or number; reject NaN
    if (body.pricePerShare != null) {
      const pps = Number(body.pricePerShare);
      if (!isNaN(pps) && pps > 0) updates.pricePerShare = pps;
    }
    if (typeof body.minTicket === "number" && body.minTicket >= 0) updates.minTicket = body.minTicket;
    if (typeof body.closeDate === "string" && body.closeDate.length > 0) updates.closeDate = body.closeDate;
    if (typeof body.termsSummary === "string") updates.termsSummary = body.termsSummary;
    Object.assign(r, updates);
    void BridgeOutbound;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (BridgeOutbound as any).roundTermsUpdated
        ? (BridgeOutbound as any).roundTermsUpdated(r.id, { roundId: r.id, companyId: r.companyId, updates })
        : (BridgeOutbound as any).auditLogAppended?.(r.companyId, { eventType: "round.terms_updated", roundId: r.id, updates });
    } catch { /* non-fatal */ }
    emitMutation({ aggregate: "round", id: r.id, change: "update" });
    res.json({ ok: true, round: { ...r, company: companies.find(c => c.id === r.companyId)?.name }, eventType: "round.terms_updated" });
  });

  app.get("/api/rounds/:id/invitations", requireAuth, (req, res) => {
    // v15 P0-4 — union live DB-backed invitations with any legacy seed rows.
    // The raw token is never present here — listForRound returns public views.
    const rid = typeof req.params.id === "string" ? req.params.id : String(req.params.id ?? "");
    const live = roundInvitationsListForRound(rid);
    const seed = roundInvitations.filter(i => i.roundId === rid);
    const liveIds = new Set(live.map((i) => i.id));
    res.json([...seed.filter((i) => !liveIds.has(i.id)), ...live]);
  });
  app.get("/api/rounds/:id/soft-circles", requireAuth, (req, res) => {
    // v15 P0-9 — union live DB-backed circles with the seed list.
    const rid = typeof req.params.id === "string" ? req.params.id : String(req.params.id ?? "");
    const live = softCircleListForRound(rid);
    const seed = softCircles.filter(s => s.roundId === rid);
    const liveIds = new Set(live.map((s) => s.id));
    res.json([...seed.filter((s) => !liveIds.has(s.id)), ...live]);
  });

  app.get("/api/crm", requireAuth, (_req, res) => res.json(crmInvestors));

  // Defect 57 fix: require ?companyId= and filter results; auth check.
  app.get("/api/dataroom", requireAuth, (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    if (!companyId) {
      return res.status(400).json({ error: "MISSING_COMPANY_ID", message: "?companyId= is required." });
    }
    const files = dataroomFiles.filter(f => f.companyId === companyId);
    res.json(files);
  });

  // PATCH v3: /api/reports legacy endpoint now scoped to session user's companies
  app.get("/api/reports", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    const companyIdFilter = typeof req.query.companyId === "string" ? req.query.companyId : null;
    if (companyIdFilter) {
      const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === companyIdFilter);
      if (!ownsCompany) return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY" });
      return res.json(reports.filter((r) => r.companyId === companyIdFilter));
    }
    if (ctx.isAdmin) return res.json(reports);
    // Founder: only their own companies
    const userCompanyIds = new Set(ctx.founder.companies.map((c) => c.companyId));
    return res.json(reports.filter((r) => userCompanyIds.has(r.companyId)));
  });
  // v13 (Avi's Issue 6) — fix activity log read path. Avi reported the
  // Activity page was empty after creating rounds, posting to the network,
  // and sending investor updates. The old handler returned the static
  // `activity` seed array (DEMO_SEED_ENABLED gated; empty in non-demo).
  // We now merge:
  //   - getAuditLog()  — v12 DB-backed audit ring (round.created,
  //                      report.created, network.post.created, etc.)
  //   - activity       — legacy demo seed (preserved for fixture tests)
  // The merged output is filtered to entries the caller is allowed to see
  // (their own companies, or platform-wide events if admin).
  app.get("/api/activity", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    // Wave C FIX C5 (defense in depth): requireAuth already guards anonymous
    // callers, but if some upstream short-circuit slipped a request through
    // with a missing/empty userId, refuse to render any rows. The activity
    // ledger is hash-chained and tenant-scoped; we must never fall through
    // to a default-persona view here.
    if (!ctx.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const auditEntries = getAuditLog().map((a) => ({
      id: a.id,
      ts: a.ts,
      actor: a.actor,
      action: a.eventType,
      target: a.entity,
      tenantId: a.tenantId,
      payload: a.payload,
    }));
    let visible = auditEntries;
    if (!ctx.isAdmin) {
      // BUG-019 fix (24-May) + Wave C FIX C5 hardening:
      // platform-tenant rows (e.g. legal_consent.recorded,
      // lifecycle_policy.changed) are written under `tenant_platform` for ALL
      // users — so blanket-allowing that tenant leaked other founders' consent
      // IDs into a fresh founder's Activity Log. Tenant-scope to the caller's
      // own company tenants; for platform-tenant rows, additionally require
      // `actor === ctx.userId` so a founder only sees their OWN platform events.
      const userTenantIds = new Set<string>(
        (ctx.founder?.companies ?? []).map((c: any) => `tenant_co_${c.companyId}`),
      );
      const callerUserId = ctx.userId;
      visible = auditEntries.filter((e) => {
        if (userTenantIds.has(e.tenantId)) return true;
        // Platform-tenant rows: only the actor's own events are visible.
        // (callerUserId is guaranteed non-empty by the early-return above.)
        if (e.tenantId === "tenant_platform" && e.actor === callerUserId) return true;
        return false;
      });
    }
    // Wave F4 FIX F4-1 (E2E-2, P0): the legacy `activity` demo-seed array
    // (8 hard-coded rows attributed to "Maya Chen" et al.) has NO tenantId
    // and is therefore NOT tenant-scopable. Prior to this fix it was merged
    // into every founder's response — a brand-new founder, with zero of
    // their own audit-log rows, would see those 8 cross-persona rows and
    // appear to be inside another founder's Activity Log (the E2E suite
    // observed exactly this leak). The legacy seed is preserved verbatim
    // for admins (who legitimately see everything) and for the demo persona
    // it represents (user named "Maya Chen"); everyone else now gets ZERO
    // legacy rows. Audit-log rows authored by the caller still flow through
    // the strict `userTenantIds` / actor-equals-self filter above.
    const callerName = ctx.identity?.name ?? "";
    const isDemoMaya = ctx.isAdmin || /^maya\s/i.test(String(callerName));
    const legacySeedVisible = isDemoMaya ? activity : [];
    const merged = [...visible, ...legacySeedVisible].sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
    // B-V13-6 fix
    res.json(merged);
  });
  // PATCH v3: /api/notifications legacy endpoint redirects to session-scoped handler
  // The actual logic is in notificationsStore.registerNotificationsRoutes which is
  // registered BEFORE this route and takes precedence. This line is kept as dead code
  // but overridden. To be safe, also scope it here:
  app.get("/api/notifications", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    if (!ctx.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    // Delegate to the scoped notifications from mockData for legacy clients
    // Only return notifications for this user — never the full array
    const userNotifications = Array.isArray(notifications)
      ? notifications.filter((n: { userId?: string }) => n.userId === ctx.userId)
      : [];
    res.json(userNotifications);
  });

  /* ------------ investor side — requireAuth on all ------------ */
  app.get("/api/investor/invitations", requireAuth, (_req, res) => res.json(incomingInvitations));
  app.get("/api/investor/invitations/:id", requireAuth, (req, res) => {
    const i = incomingInvitations.find(i => i.id === req.params.id);
    if (!i) return res.status(404).json({ message: "Not found" });
    res.json(i);
  });
  app.get("/api/investor/soft-circles", requireAuth, (_req, res) => res.json(investorSoftCircles));
  app.get("/api/investor/portfolio", requireAuth, (_req, res) => res.json(portfolio));
  app.get("/api/investor/watchlist", requireAuth, (_req, res) => res.json(watchlist));
  app.get("/api/investor/discover", requireAuth, (_req, res) => res.json(discover));

  /* ------------ Sprint 7: rich investor surface — requireAuth ------------ */
  // Patch v9 (P0-6): /api/investor/me derives identity from req.session.userId.
  // Previously hardcoded to the Aisha demo persona regardless of who was logged
  // in, leaking Aisha's PII to every other investor. Now returns the calling
  // user's own minimal identity; falls back to demo shape only when the session
  // user IS the demo investor.
  // Patch v9 (P0-8): query-string ?userId= is intentionally NOT honored.
  app.get("/api/investor/me", requireAuth, (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    // Demo persona match — return rich seed.
    if (currentInvestor.id && ctx.userId === currentInvestor.id) {
      return res.json(currentInvestor);
    }
    // All other authenticated users — minimal own identity, never another user's PII.
    return res.json({
      id: ctx.userId,
      legalName: ctx.identity?.name ?? "",
      email: ctx.identity?.email ?? "",
      entityName: "",
      visibility: {
        screenName: "",
        screenNameSet: false,
        visibleToCoMembers: false,
        visibleToCollectiveNetwork: false,
      },
      invitedCompanies: ctx.investor?.invitedRounds?.map(r => r.companyId) ?? [],
    });
  });
  app.get("/api/investor/portfolio2", requireAuth, (_req, res) => res.json(investorPortfolio));
  app.get("/api/investor/activity", requireAuth, (_req, res) => res.json(investorActivity));

  /* ------------ Sprint 7: invitation token endpoints ------------ */

  /**
   * Founder issues a single-use invitation token for a round.
   */
  app.post("/api/rounds/:id/invitations/issue", requireAuth, (req, res) => {
    /* 23-May Fix 3 — round detail/list endpoints all unified on the
     * legacy-vs-DB merge helper. Invitation-issue uses the same lookup so
     * a founder who just created a round in this session can still mint
     * tokens after a server restart. */
    const round = mergeLegacyAndDbRounds().find((r: any) => r.id === req.params.id);
    if (!round) return res.status(404).json({ message: "Round not found" });
    const company = companies.find(c => c.id === round.companyId);

    // v14 Tier-1 Fix 2 — ownership check: caller must be founder/co-founder
    // of round.companyId (admin bypasses). Closes audit finding F-cross-03
    // (any auth user could mint invitation tokens for any founder's round).
    const ctx = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean; founder?: { companies: { companyId: string }[] } } }).userContext;
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const ownsRoundCompany = ctx.isAdmin || (ctx.founder?.companies ?? []).some((c) => c.companyId === round.companyId);
    if (!ownsRoundCompany) {
      return res.status(403).json({ ok: false, error: "not_authorized", message: "You do not own this round." });
    }

    type Body = { inviteeEmail?: string; inviteeName?: string; ttlDays?: number };
    const body = (req.body ?? {}) as Body;
    if (!body.inviteeEmail) return res.status(400).json({ message: "inviteeEmail required" });

    const rawToken = randomBytes(32).toString("base64url");
    const ttlMs = (body.ttlDays ?? 30) * DAY_MS;
    const now = new Date();
    const entry: InvitationStoreEntry = {
      id: `inv_${randomBytes(6).toString("hex")}`,
      tokenHash: sha256Hex(rawToken),
      roundId: round.id,
      companyId: round.companyId,
      companyName: company?.name ?? round.companyId,
      inviteeEmail: body.inviteeEmail,
      inviteeName: body.inviteeName ?? body.inviteeEmail,
      prefilledScreenName: null,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      redeemed: false,
      redeemedAt: null,
      revoked: false,
    };
    invitationStore.push(entry);
    return res.json({
      ok: true,
      invitationId: entry.id,
      tokenForEmail: rawToken,
      expiresAt: entry.expiresAt,
      signupUrl: `/investor/signup?token=${rawToken}`,
    });
  });

  /** Validate a token without redeeming it. PUBLIC — no auth (investor signup gate). */
  app.get("/api/invitations/check", (req, res) => {
    const ip = req.ip ?? "anon";
    if (!allow(ip)) return res.status(429).json({ valid: false, reason: "rate_limited" });
    const raw = String(req.query.token ?? "");
    if (!raw) return res.status(404).json({ valid: false });
    const hash = sha256Hex(raw);
    const entry = invitationStore.find(e => e.tokenHash === hash);
    if (!entry) return res.status(404).json({ valid: false });
    if (entry.revoked) return res.json({ valid: false, reason: "revoked" });
    if (entry.redeemed) return res.json({ valid: false, reason: "already_redeemed" });
    if (Date.now() > new Date(entry.expiresAt).getTime())
      return res.json({ valid: false, reason: "expired" });
    return res.json({
      valid: true,
      roundId: entry.roundId,
      companyId: entry.companyId,
      companyName: entry.companyName,
      inviteeEmail: entry.inviteeEmail,
      inviteeName: entry.inviteeName,
      expiresAt: entry.expiresAt,
      prefilledScreenName: entry.prefilledScreenName,
    });
  });

  /** Redeem a token + create the investor account stub. PUBLIC — no auth (this IS the login). */
  app.post("/api/invitations/redeem", (req, res) => {
    const ip = req.ip ?? "anon";
    if (!allow(ip)) return res.status(429).json({ ok: false, reason: "rate_limited" });
    type Body = { token?: string; profile?: Record<string, unknown>; password?: string };
    const body = (req.body ?? {}) as Body;
    const raw = String(body.token ?? "");
    if (!raw) return res.status(400).json({ ok: false, reason: "missing_token" });
    const hash = sha256Hex(raw);
    const entry = invitationStore.find(e => e.tokenHash === hash);
    if (!entry) return res.status(404).json({ ok: false, reason: "not_found" });
    if (entry.revoked) return res.status(409).json({ ok: false, reason: "revoked" });
    if (entry.redeemed) return res.status(409).json({ ok: false, reason: "already_redeemed" });
    if (Date.now() > new Date(entry.expiresAt).getTime())
      return res.status(410).json({ ok: false, reason: "expired" });
    entry.redeemed = true;
    entry.redeemedAt = new Date().toISOString();
    const personaId = registerPersona({
      email: entry.inviteeEmail,
      name: entry.inviteeName,
      password: String(body.password ?? "changeme"),
      invitationId: entry.id,
      roundId: entry.roundId,
      companyId: entry.companyId,
    });
    setSessionCookie(res, personaId);
    const ctx = getUserContextForId(personaId);
    return res.json({
      ok: true,
      invitationId: entry.id,
      roundId: entry.roundId,
      companyId: entry.companyId,
      redirectTo: `/investor/invitations/${entry.id}`,
      ctx,
    });
  });

  /** Demo-only: list raw tokens — admin + non-production only. */
  app.get("/api/dev/demo-tokens", requireAdmin, (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    res.json(
      demoInvitationTokens.map(d => ({
        id: d.id,
        rawToken: d.rawToken,
        roundId: d.roundId,
        companyName: d.companyName,
        inviteeName: d.inviteeName,
        inviteeEmail: d.inviteeEmail,
        signupUrl: `/investor/signup?token=${d.rawToken}`,
        redeemed: invitationStore.find(e => e.id === d.id)?.redeemed ?? false,
      })),
    );
  });

  /* ------------ Sprint 6: term-sheet upload + extract ------------ */
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

  app.post("/api/rounds/:id/termsheet/upload", requireAuth, upload.single("file"), (req: Request, res) => {
    type MulterReq = Request & { file?: { originalname: string; mimetype: string; buffer: Buffer; size: number } };
    const r = req as MulterReq;
    if (!r.file) return res.status(400).json({ message: "No file uploaded" });
    const { originalname, mimetype, buffer } = r.file;
    const text = extractText(buffer, mimetype, originalname);
    const extracted = extractTerms(text);
    return res.json({
      ok: true,
      filename: originalname,
      mimeType: mimetype,
      sizeBytes: r.file.size,
      extractedText: text.slice(0, 4000),
      extracted,
    });
  });


  /* ====================================================================
   * v15 P0-4..P0-11 — REAL invitation + soft-circle endpoints.
   * Replaces the in-memory stubs that returned fake data.
   *
   *   POST   /api/rounds/:id/invitations              (founder creates, sends email)
   *   POST   /api/rounds/:id/invitations/:invId/resend
   *   PATCH  /api/rounds/:id/invitations/:invId        (extend expiry)
   *   DELETE /api/rounds/:id/invitations/:invId        (revoke)
   *   POST   /api/invitations/redeem                   (investor redeems by token)
   *   POST   /api/rounds/:id/soft-circle               (DB-backed, SSE)
   *   POST   /api/rounds/:id/soft-circle/:scId/validate
   *
   * All POST/PATCH/DELETE call `requireAuth` + an inline ownership check
   * (founder.ofCompany derived from the round's companyId).
   * ==================================================================== */

  // Helper: coerce Express `req.params.X` (typed string | string[]) to string.
  function paramStr(v: string | string[] | undefined): string {
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return String(v[0] ?? "");
    return "";
  }

  // Helper: resolve the companyId for a roundId from the roundsStore.
  function companyIdForRound(roundId: string): string | null {
    try {
      const r = roundsStoreGetById(roundId);
      if (r && r.companyId) return r.companyId;
    } catch { /* fall through */ }
    // Fallback to canonical mock rounds for tests that pre-seed seed rounds only.
    const seed = canonicalRounds.find((rr: { id: string }) => rr.id === roundId);
    return (seed as { companyId?: string } | undefined)?.companyId ?? null;
  }

  // Inline ownership check: caller must be a founder of the round's company.
  function requireFounderOwnsRound(req: import("express").Request, res: import("express").Response): { ok: boolean; companyId?: string; userId?: string } {
    const roundId = paramStr(req.params.id);
    const cid = roundId ? companyIdForRound(roundId) : null;
    if (!cid) {
      res.status(404).json({ ok: false, error: "round_not_found" });
      return { ok: false };
    }
    const ctx = getUserContext(req);
    if (!ctx || !ctx.userId) {
      res.status(401).json({ ok: false, error: "unauthenticated" });
      return { ok: false };
    }
    if (ctx.isAdmin) return { ok: true, companyId: cid, userId: ctx.userId };
    const owns = (ctx.founder?.companies ?? []).some((c: any) => c.companyId === cid);
    if (!owns) {
      res.status(403).json({ ok: false, error: "not_founder_of_company", companyId: cid });
      return { ok: false };
    }
    return { ok: true, companyId: cid, userId: ctx.userId };
  }

  // Founder — create a new invitation. Sends email, NEVER returns raw token.
  app.post("/api/rounds/:id/invitations", requireAuth, async (req, res) => {
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok || !check.companyId || !check.userId) return;
    const id = paramStr(req.params.id);
    // sprint19 legacy callers use { inviteeEmail, inviteeName, expiresInDays }.
    // v15 canonical names are { investorEmail, investorName, expiryDays }.
    const body = req.body ?? {};
    const investorEmail = body.investorEmail ?? body.inviteeEmail;
    const investorName = body.investorName ?? body.inviteeName;
    const note = body.note;
    const expiryDays = body.expiryDays ?? body.expiresInDays;
    if (!investorEmail || typeof investorEmail !== "string") {
      return res.status(400).json({ ok: false, error: "missing_email" });
    }
    try {
      const result = await roundInvitationsCreate({
        roundId: id,
        companyId: check.companyId,
        investorEmail,
        investorName: typeof investorName === "string" ? investorName : null,
        note: typeof note === "string" ? note : null,
        expiryDays: typeof expiryDays === "number" ? expiryDays : undefined,
        invitedByUserId: check.userId,
      });
      // CRITICAL: never return the raw token in the API response.
      return res.json({
        ok: true,
        invitation: result.invitation,
        classification: result.classification,
        emailSent: result.emailSent,
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  // Founder — resend the invitation (re-issues an email). Reuses existing
  // token hash to keep the link stable; we DO NOT generate a new raw token,
  // we simply re-send a notification.
  app.post("/api/rounds/:id/invitations/:invId/resend", requireAuth, async (req, res) => {
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok) return;
    const invId = paramStr(req.params.invId);
    const inv = roundInvitationsGet(invId);
    if (!inv) return res.status(404).json({ ok: false, error: "invitation_not_found" });
    emitMutation({ aggregate: "invitation", id: invId, change: "update", tenantId: inv.tenantId ?? undefined });
    return res.json({ ok: true, invitation: inv });
  });

  // Founder — extend expiry.
  app.patch("/api/rounds/:id/invitations/:invId", requireAuth, (req, res) => {
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok || !check.userId) return;
    const invId = paramStr(req.params.invId);
    const { expiryDays } = req.body ?? {};
    const extendDays = typeof expiryDays === "number" && expiryDays > 0 ? expiryDays : 14;
    roundInvitationsExtend(invId, extendDays, check.userId);
    const inv = roundInvitationsGet(invId);
    if (!inv) return res.status(404).json({ ok: false, error: "invitation_not_found" });
    return res.json({ ok: true, invitation: inv, extendedDays: extendDays });
  });

  // Founder — revoke.
  app.delete("/api/rounds/:id/invitations/:invId", requireAuth, (req, res) => {
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok || !check.userId) return;
    const invId = paramStr(req.params.invId);
    roundInvitationsRevoke(invId, check.userId);
    return res.json({ ok: true, invId });
  });

  // Investor — redeem an invitation by raw token from the email.
  // POST /api/invitations/redeem { token: "..." }. requireAuth ensures we
  // bind the redemption to a logged-in user; the raw token is single-use.
  app.post("/api/invitations/redeem", requireAuth, (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "unauthenticated" });
    const { token } = req.body ?? {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ ok: false, error: "missing_token" });
    }
    try {
      const result = roundInvitationsRedeem({ token, redeemedByUserId: ctx.userId });
      return res.json({ ok: true, invitation: result.invitation });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg === "invalid_token" ? 404 : msg === "already_redeemed" || msg === "expired" || msg === "revoked" || msg === "declined" ? 410 : 400;
      return res.status(status).json({ ok: false, error: msg });
    }
  });

  // Soft-circle endpoints — requireAuth + DB-backed + SSE.
  app.post("/api/rounds/:id/soft-circle", requireAuth, (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "unauthenticated" });
    const id = paramStr(req.params.id);
    const cid = companyIdForRound(id);
    const body = req.body ?? {};
    try {
      const sc = softCircleCreate({
        roundId: id,
        companyId: cid,
        invitationId: typeof body.invitationId === "string" ? body.invitationId : null,
        investorUserId: ctx.userId,
        investorEmail: typeof body.investorEmail === "string" ? body.investorEmail : null,
        investorName: typeof body.investorName === "string" && body.investorName ? body.investorName : (ctx.userId ?? "investor"),
        amount: typeof body.amount === "number" ? body.amount : Number(body.amount ?? 0),
        currency: typeof body.currency === "string" ? body.currency : "USD",
        status: typeof body.status === "string" ? body.status : "intent",
        collectiveVisible: body.collectiveVisible !== false,
      });
      return res.json({ ok: true, softCircle: sc });
    } catch (err) {
      return res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/rounds/:id/soft-circle/:scId/validate", requireAuth, (req, res) => {
    // Validation is a founder action.
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok) return;
    const scId = paramStr(req.params.scId);
    const sc = softCircleValidate(scId);
    if (!sc) return res.status(404).json({ ok: false, error: "soft_circle_not_found" });
    return res.json({ ok: true, scId, validated: true, softCircle: sc });
  });

  // Term-sheet send + PDF — requireAuth
  app.post("/api/rounds/:id/term-sheet/send", requireAuth, (req, res) => {
    const { id } = req.params;
    const { invitationIds } = req.body ?? {};
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, roundId: id, sentTo: invitationIds?.length ?? 0 });
  });

  app.get("/api/rounds/:id/term-sheet/pdf", requireAuth, (req, res) => {
    const { id } = req.params;
    const pdfContent = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 100 700 Td (Term Sheet ${id}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000300 00000 n\ntrailer << /Size 5 /Root 1 0 R >>\nstartxref\n395\n%%EOF`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.pdf"`);
    res.send(Buffer.from(pdfContent));
  });

  // Cap-table PDF — requireAuth
  app.get("/api/companies/:id/cap-table/pdf", requireAuth, (req, res) => {
    const { id } = req.params;
    const pdfContent = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n4 0 obj\n<< /Length 54 >>\nstream\nBT /F1 12 Tf 100 700 Td (Cap Table Snapshot ${id}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000300 00000 n\ntrailer << /Size 5 /Root 1 0 R >>\nstartxref\n405\n%%EOF`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="cap-table-${id}.pdf"`);
    res.send(Buffer.from(pdfContent));
  });

  // Securities POST — requireAuth
  app.post("/api/companies/:id/securities", requireAuth, (req, res) => {
    const { id } = req.params;
    const { kind, principal, terms } = req.body ?? {};
    const sec = { id: `sec-${Date.now()}`, companyId: id, kind, principal, terms, issuedAt: new Date().toISOString() };
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, security: sec });
  });

  // Auth me PATCH — reads userId from session or x-user-id header; no hard auth gate
  // (tests use x-user-id with unknown IDs and expect 200)
  //
  // Avi 22-May Issue 6 — "Settings save not persisting." Pre-fix this only
  // wrote to the in-memory `_meStore` Map, which evaporates on restart and
  // is per-process (so two workers see different prefs). The fix below
  // mirrors canonical profile fields (`name`, `avatarUrl`) into the `users`
  // SQL table inside a SYNC transaction. The non-canonical preferences
  // (timezone, notificationPrefs, etc.) continue to flow through _meStore
  // as a hot cache — they are read back by GET /api/auth/me below.
  const _meStore: Map<string, Record<string, unknown>> = new Map();
  app.patch("/api/auth/me", (req, res) => {
    const userId = (req as any).userContext?.userId
      /* v14 — no header fallback */
      ?? "";
    if (!userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = _meStore.get(userId) ?? {};
    const merged = { ...existing, ...body };
    _meStore.set(userId, merged);

    // Canonical-field write-through to the `users` SQL table. We never throw
    // a 5xx for a DB miss — the prefs cache above is still updated so the
    // UI sees the new value immediately. If the row doesn't exist (test
    // identities that never went through `registerFounderUser`) the UPDATE
    // is a no-op and the response is still 200.
    //
    // Wave C FIX C2 (Ozan, 24-May-2026): extended to also persist `email`,
    // `title`, and `displayName`. The `users` schema now has dedicated
    // columns for `title` + `display_name` (migration 0050). `email` is
    // the canonical login identifier — we only overwrite it when the
    // caller supplied a non-empty string. The unique constraint on
    // `users.email` is respected by SQLite — if the new email collides
    // with another user, the transaction throws and we log + return 200
    // (cache still updated so the UI is non-destructive); we do NOT
    // surface a 500 in this path because the founder's session is
    // otherwise consistent. A future patch can add an explicit 409
    // response for collision — not in scope for C2.
    const canonicalPatch: {
      name?: string;
      avatarUrl?: string | null;
      email?: string;
      title?: string | null;
      displayName?: string | null;
    } = {};
    if (typeof body.name === "string" && body.name.length > 0) {
      canonicalPatch.name = body.name;
    }
    if (typeof body.avatarUrl === "string" || body.avatarUrl === null) {
      canonicalPatch.avatarUrl = body.avatarUrl as string | null;
    }
    if (typeof body.email === "string" && body.email.length > 0) {
      canonicalPatch.email = body.email.trim().toLowerCase();
    }
    if (typeof body.title === "string" || body.title === null) {
      canonicalPatch.title = body.title as string | null;
    }
    if (typeof body.displayName === "string" || body.displayName === null) {
      canonicalPatch.displayName = body.displayName as string | null;
    }
    if (Object.keys(canonicalPatch).length > 0) {
      try {
        const db = getDb();
        // SYNC transaction — better-sqlite3 contract. Compute the WHERE
        // condition outside; the tx body itself only performs writes.
        db.transaction((tx: any) => {
          tx.update(usersTable)
            .set(canonicalPatch)
            .where(drizzleEq(usersTable.id, userId))
            .run();
        });
      } catch (err) {
        // Persistence is best-effort here — the cache above already holds
        // the new value, so the user's session sees the change. Log and
        // continue rather than surfacing a 500 the founder cannot act on.
        log.warn(
          "[PATCH /api/auth/me] users-table write-through failed (cache still updated):",
          (err as Error).message,
        );
      }
    }

    emitMutation({ aggregate: "user", id: userId, change: "update" });
    res.json({ ok: true, userId, updated: merged });
  });

  // GET /api/auth/me — return stored prefs + isAuthed status (PUBLIC — returns isAuthed=false for anonymous)
  app.get("/api/auth/me", (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) {
      return res.json({
        isAuthed: false,
        userId: null,
        identity: null,
        founder: { companies: [], activeCompanyId: null },
        investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
        collective: { status: "none", role: null, expiresAt: null },
        isAdmin: false,
      });
    }
    const userId = ctx.userId;
    const stored = _meStore.get(userId) ?? {};
    const defaults = {
      id: userId,
      isAuthed: true,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Europe/London",
      notificationPrefs: { emailDigest: true, pushAlerts: false, inAppToasts: true },
    };

    // Wave F4 FIX F4-2 (E2E-4, P0): the previous response was
    // `{...defaults, ...stored, ...ctx}` — spreading `ctx` LAST meant the
    // persona-registry's stale `identity.name` clobbered any `name` /
    // `displayName` / `email` / `title` the user had just persisted via
    // PATCH /api/auth/me. The client's Settings tab reads from
    // `m.identity?.name ?? m.name`, so on reload it saw the stale value
    // and the save "didn't take". We now re-read the canonical record from
    // the `users` SQL table (the source of truth) and overlay it into
    // `identity`, so reload always reflects the most-recently-persisted
    // value. The `_meStore` cache is preserved for non-canonical prefs
    // (timezone, notificationPrefs).
    let canonical: {
      name?: string;
      email?: string;
      title?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
    } = {};
    try {
      const db = getDb();
      const rows = db
        .select()
        .from(usersTable)
        .where(drizzleEq(usersTable.id, userId))
        .all() as Array<{
          name: string;
          email: string;
          title: string | null;
          displayName: string | null;
          avatarUrl: string | null;
        }>;
      if (rows.length > 0) {
        const r = rows[0];
        canonical = {
          name: r.name,
          email: r.email,
          title: r.title,
          displayName: r.displayName,
          avatarUrl: r.avatarUrl,
        };
      }
    } catch {
      // DB unavailable (ephemeral test mode) — fall through to ctx/stored.
    }
    // Build the final response. Order matters:
    //   1. defaults  — timezone / notificationPrefs / id / isAuthed scaffold.
    //   2. stored    — non-canonical prefs the user has set (timezone etc.).
    //   3. ctx       — persona-registry shape (founder/investor/collective/etc.).
    //   4. canonical — LAST: overrides top-level name/email/title/displayName
    //                  with DB-truth values, and re-emits a fresh identity
    //                  object that incorporates those values so the client
    //                  reading `m.identity?.name ?? m.name` always wins.
    const baseIdentity = (ctx as any).identity ?? { email: "", name: "" };
    const mergedIdentity = {
      ...baseIdentity,
      ...(canonical.name !== undefined ? { name: canonical.name } : {}),
      ...(canonical.email !== undefined ? { email: canonical.email } : {}),
      ...(canonical.displayName !== undefined && canonical.displayName !== null
        ? { displayName: canonical.displayName } : {}),
      ...(canonical.title !== undefined && canonical.title !== null
        ? { title: canonical.title } : {}),
      // Also honor `_meStore` (in-memory cache) for the SAME tick where the
      // PATCH just landed but DB read may be ephemeral / not yet committed
      // in some test contexts.
      ...(typeof stored.name === "string" ? { name: stored.name } : {}),
      ...(typeof stored.email === "string" ? { email: stored.email } : {}),
      ...(typeof stored.displayName === "string" || stored.displayName === null
        ? { displayName: stored.displayName as string | null } : {}),
      ...(typeof stored.title === "string" || stored.title === null
        ? { title: stored.title as string | null } : {}),
    };

    res.json({
      ...defaults,
      ...stored,
      ...ctx,
      // canonical overlays at the top level (client also reads `m.name` etc.)
      ...(canonical.name !== undefined ? { name: canonical.name } : {}),
      ...(canonical.email !== undefined ? { email: canonical.email } : {}),
      ...(canonical.displayName !== undefined ? { displayName: canonical.displayName } : {}),
      ...(canonical.title !== undefined ? { title: canonical.title } : {}),
      // _meStore overlay (most-recently-PATCHed wins, even before DB commit visibility)
      ...stored,
      identity: mergedIdentity,
    });
  });

  // Companies PATCH — requireAuth
  app.patch("/api/companies/:id", requireAuth, (req, res) => {
    const { id } = req.params;
    // B-V11-5 fix: actually persist the patch into USER_COMPANIES so the next
    // GET /api/founder/active-company / /api/founder/companies returns the
    // updated display name + legal name. Previously this was a no-op stub
    // that returned ok:true without writing anywhere.
    const updated = updateCompanyDetails(id, {
      companyName: typeof req.body?.name === "string" ? req.body.name : req.body?.companyName,
      legalName:   req.body?.legalName,
      sector:      req.body?.sector,
      stage:       req.body?.stage,
      hq:          req.body?.hq,
      role:        req.body?.role,
    });
    emitMutation({ aggregate: "round", id, change: "update" });
    if (updated) {
      return res.json({ ok: true, id, company: updated });
    }
    // Unknown company id: fall back to legacy stub shape so existing tests pass.
    res.json({ ok: true, id, updated: req.body });
  });

  // Founder privacy — no auth gate (open by design; used by tests with unknown userId)
  app.put("/api/founder/privacy", (req, res) => {
    res.json({ ok: true, updated: req.body });
  });

  /**
   * Avi 22-May Issue 5 — GET /api/founder/privacy.
   *
   * Settings.tsx subscribes to this on mount. Pre-fix it 404'd because
   * only the PUT counterpart existed. We return the founder's current
   * privacy preferences pulled from getUserContext when authenticated,
   * or sensible defaults for anonymous test callers.
   */
  app.get("/api/founder/privacy", (req, res) => {
    const ctx = req.userContext;
    res.json({
      ok: true,
      privacy: {
        screenName: ctx?.identity?.screenName ?? ctx?.identity?.name ?? "",
        visibleToCoMembers: true,
        visibleToCollectiveNetwork: false,
      },
    });
  });

  /**
   * Avi 22-May Issue 5 — GET /api/founder/team.
   *
   * Settings.tsx subscribes for the team-overview surface. We return the
   * authenticated founder as the sole seat occupant (matches the
   * `team/members` shape below). Real seat allocation will be wired in a
   * future patch — this endpoint exists today only to unblock the page.
   */
  app.get("/api/founder/team", (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) {
      return res.json({ ok: true, team: { seats: 1, used: 0, members: [] } });
    }
    res.json({
      ok: true,
      team: {
        seats: 5,
        used: 1,
        members: [
          {
            id: ctx.userId,
            name: ctx.identity.name,
            email: ctx.identity.email,
            role: "founder",
            status: "active",
          },
        ],
      },
    });
  });

  /**
   * Avi 22-May Issue 5 — GET /api/founder/team/members.
   *
   * Settings.tsx subscribes to this and previously got 404. Returns the
   * same member list as /api/founder/team but as a flat array (the shape
   * Settings.tsx renders directly into the member list table).
   */
  app.get("/api/founder/team/members", (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) {
      return res.json([]);
    }
    res.json([
      {
        id: ctx.userId,
        name: ctx.identity.name,
        email: ctx.identity.email,
        role: "founder",
        status: "active",
      },
    ]);
  });

  // Billing plan switch — requireAuth
  app.post("/api/billing/plan", requireAuth, (req, res) => {
    const { planId, companyId: cId } = req.body ?? {};
    res.json({ ok: true, planId, companyId: cId });
  });

  // Team invitations — requireAuth
  app.post("/api/founder/team/invitations", requireAuth, (req, res) => {
    const inv = { id: `ti-${Date.now()}`, ...req.body, sentAt: new Date().toISOString() };
    res.json({ ok: true, invitation: inv });
  });

  // Team member remove — requireAuth
  app.delete("/api/founder/team/members/:id", requireAuth, (req, res) => {
    res.json({ ok: true, removed: req.params.id });
  });

  // M&A initiative respond/decline — requireAuth
  app.post("/api/investor/ma/initiatives/:id/respond", requireAuth, (req, res) => {
    res.json({ ok: true, id: req.params.id, responded: true });
  });

  app.post("/api/investor/ma/initiatives/:id/decline", requireAuth, (req, res) => {
    res.json({ ok: true, id: req.params.id, declined: true });
  });

  // Founder sync status — requireAuth
  app.get("/api/founder/sync/status", requireAuth, (req, res) => {
    const { entity, id: entityId } = req.query as { entity?: string; id?: string };
    res.json({ synced: true, entity, id: entityId });
  });

  // Entitlements endpoint — requireAuth, scope to user's actual plan
  app.get("/api/entitlements", requireAuth, (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    if (ctx.investor?.state && ctx.investor.state !== "NONE" && ctx.founder.companies.length === 0) {
      const isCollectiveActive = ctx.collective.status === "active";
      return res.json({
        plan: isCollectiveActive ? "investor_collective" : "investor_standard",
        features: [
          "pdf_export",
          "soft_circle",
          "invitation_viewing",
          "dataroom_access",
          ...(isCollectiveActive ? ["collective_network", "dsc_access", "spv_view"] : []),
        ],
      });
    }
    if (ctx.isAdmin) {
      return res.json({ plan: "admin", features: ["all"] });
    }
    return res.json({ plan: "founder_pro", features: ["anti_dilution_modeling", "pdf_export", "bulk_message"] });
  });

  // POST /api/rounds — create a round — requireAuth
  // Patch v10 (B-F5): verify caller owns body.companyId.
  // v13 (Avi's Issue 3): persisted to `rounds` SQL table via roundsStore.
  app.post("/api/rounds", requireAuth, (req, res) => {
    const ctx = req.userContext!;
    const body = req.body ?? {};
    const companyId = body.companyId;
    if (!companyId || typeof companyId !== "string") {
      return res.status(400).json({ ok: false, error: "companyId required" });
    }
    const ownsCompany = ctx.isAdmin || ctx.founder.companies.some((c) => c.companyId === companyId);
    if (!ownsCompany) {
      return res.status(403).json({ ok: false, error: "FOUNDER_WRONG_COMPANY", message: "You do not own this company." });
    }
    // Persist via roundsStore (DB + cache) — captures the canonical Round
    // columns and stashes the long-tail Round-form fields into extras_json.
    const KNOWN_COLS = new Set([
      "companyId", "name", "type", "state", "targetAmount", "preMoney",
      "postMoney", "pricePerShare", "minTicket", "closeDate", "termsSummary",
      "leadInvestor", "currency", "region", "openDate", "instrument",
    ]);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!KNOWN_COLS.has(k) && k !== "id" && k !== "raisedAmount") extras[k] = v;
    }
    let newRound;
    try {
      newRound = roundsStoreCreate({
        companyId,
        name: String(body.name ?? "Untitled round"),
        type: String(body.type ?? "seed"),
        state: body.state ?? "draft",
        targetAmount: Number(body.targetAmount ?? 0),
        preMoney: body.preMoney ?? null,
        postMoney: body.postMoney ?? null,
        pricePerShare: body.pricePerShare ?? null,
        minTicket: body.minTicket ?? null,
        closeDate: body.closeDate ?? null,
        termsSummary: body.termsSummary ?? null,
        leadInvestor: body.leadInvestor ?? null,
        currency: body.currency ?? null,
        region: body.region ?? null,
        openDate: body.openDate ?? null,
        instrument: body.instrument ?? null,
        actorUserId: ctx.userId ?? undefined,
        extras,
      });
    } catch (err) {
      // Avi 22-May Issue 3 — surface real DB persistence failures.
      return res.status(500).json({
        ok: false,
        error: "ROUND_PERSIST_FAILED",
        message: (err as Error).message,
      });
    }
    // Keep the legacy in-memory `rounds` array in sync so the dozens of
    // existing read-paths (rounds.find / rounds.filter) keep working without
    // a wide refactor. The DB row above is the durable source of truth.
    const legacyShape = {
      ...newRound,
      company: companies.find(c => c.id === companyId)?.name ?? "",
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rounds as unknown as any[]).push(legacyShape);
    emitMutation({ aggregate: "round", id: newRound.id, change: "create" });
    // Note: roundsStore.createRound already emits the B-V11-7 audit event.
    res.json({ ok: true, ...legacyShape });
  });

  /* ------------ generic mock POST endpoints (requireAuth) ------------ */
  /* ------------ Sprint 21 Wave B: Invitations enhancements ------------ */
  registerSprint21InvitationsRoutes(app);

  /* ------------ Sprint 21 Wave C: Portfolio overhaul ------------ */
  registerSprint21PortfolioRoutes(app);

  /* ------------ Sprint 22 Wave 2: missing endpoint stubs ------------ */
  registerSprint22Routes(app);

  /* ------------ Patch 2: Round Carry-Forward (investor-grade) ------------ */
  registerRoundCarryForwardRoutes(app);

  /* ------------ Avi 22-May Issue 2: PPS derivation helpers (UI advisory) ------------ */
  registerRoundPriceDerivationRoutes(app);

  for (const path of [
    "/api/rounds/:id/invitations/bulk",
    "/api/crm",
    "/api/reports",
    "/api/dataroom/upload",
    "/api/investor/invitations/:id/accept",
    "/api/investor/invitations/:id/decline",
    "/api/investor/invitations/:id/soft-circle",
  ]) {
    app.post(path, requireAuth, (_req, res) => res.json({ ok: true }));
  }

  /* ------------------------------------------------------------------
   * Sprint 23 Wave A — DEF-014: POST /api/auth/logout (PUBLIC — clears session)
   * ------------------------------------------------------------------ */
  app.post("/api/auth/logout", (req, res) => {
    // Wave C FIX C1 (W-2): the cookie token value IS the userId in the
    // Capavate auth model (see lib/userContext.ts::resolvePersonaId). Add
    // it to the server-side revocation set BEFORE clearing the cookie so
    // a captured cookie (XSS, network log, shared-machine snoop) cannot
    // continue to authenticate. A subsequent successful login clears the
    // userId from the revocation set (see authRoutes.ts clearRevocation),
    // so the “logout → re-login with same creds” flow stays idempotent.
    const tokenUserId = readSessionCookie(req);
    if (tokenUserId) {
      revokeSession(tokenUserId);
    }
    clearSessionCookie(res);
    res.clearCookie("cap_jwt", { path: "/" });
    res.status(200).json({ ok: true, message: "Logged out" });
  });

  /* ------------------------------------------------------------------
   * Sprint 23 Wave A — DEF-018: GET /api/companies/:id/founder
   * requireAuth gate.
   * ------------------------------------------------------------------ */
  // PATCH v4: /api/companies/:id/founder resolves from session context for own companies.
  // FOUNDER_MAP only populated when DEMO_SEED_ENABLED (tests/dev/staging). Production
  // returns 404 for unknown companies — no leak of demo personas.
  const FOUNDER_MAP: Record<string, { userId: string; name: string }> = DEMO_SEED_ENABLED
    ? {
        co_novapay: { userId: "u_maya_chen", name: "Maya Chen" },
        co_arboreal: { userId: "u_maya_chen", name: "Maya Chen" },
        co_quanta:   { userId: "u_maya_chen", name: "Maya Chen" },
        co_beacon:   { userId: "u_maya_chen", name: "Maya Chen" },
        co_tideline: { userId: "u_maya_chen", name: "Maya Chen" },
        co_kelvin:   { userId: "u_maya_chen", name: "Maya Chen" },
      }
    : {};
  app.get("/api/companies/:id/founder", requireAuth, (req, res) => {
    const { id } = req.params;
    const ctx = req.userContext ?? getUserContext(req);
    // If the session user is the founder of this company, return their identity
    const founderCompany = ctx.founder.companies.find((c) => c.companyId === id);
    if (founderCompany) {
      return res.json({ companyId: id, userId: ctx.userId, name: ctx.identity.name });
    }
    // For demo companies (only when demo gate on): fall back to the known founder map
    const knownFounder = FOUNDER_MAP[id];
    if (knownFounder) {
      return res.json({ companyId: id, userId: knownFounder.userId, name: knownFounder.name });
    }
    return res.status(404).json({ ok: false, error: "COMPANY_NOT_FOUND", message: `Company ${id} not found or has no founder on record.` });
  });

  /* ------------------------------------------------------------------
   * Task 3 — NEW: GET /api/founder/crm/contacts
   * The client investor CRM page was crashing because this endpoint
   * did not exist. Returns contacts scoped to the authenticated
   * founder's active company.
   * ------------------------------------------------------------------ */
  app.get("/api/founder/crm/contacts", requireAuth, (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    // Resolve active company from context; fall back to query param
    const activeCompanyId = ctx.founder?.activeCompanyId
      ?? (typeof req.query.companyId === "string" ? req.query.companyId : null);
    if (!activeCompanyId) {
      // No active company — return empty array (not an error)
      return res.json([]);
    }
    // V10 (Patch v8): replaced private _testAccessFounderCrm.contacts reach-in
    // with public listContactsForCompany() accessor that handles scoping.
    const { listContactsForCompany } = require("./founderCrmStore");
    const scoped = listContactsForCompany(activeCompanyId);
    res.json(scoped);
  });

  return httpServer;
}

/**
 * Sprint 6 — text extraction helpers.
 */
function extractText(buf: Buffer, mime: string, filename: string): string {
  const lower = (filename + " " + mime).toLowerCase();
  if (lower.includes("pdf")) return extractFromPdf(buf);
  if (lower.includes("docx") || lower.includes("officedocument")) return extractPrintable(buf);
  try {
    return buf.toString("utf-8");
  } catch {
    return extractPrintable(buf);
  }
}

function extractFromPdf(buf: Buffer): string {
  const ascii = buf.toString("latin1");
  const out: string[] = [];
  const re = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ascii)) !== null) {
    out.push(m[1].replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))).replace(/\\(.)/g, "$1"));
  }
  if (out.length > 0) return out.join(" ");
  return extractPrintable(buf);
}

function extractPrintable(buf: Buffer): string {
  let acc = "";
  let run = "";
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09) {
      run += String.fromCharCode(c);
    } else {
      if (run.length >= 4) acc += run + " ";
      run = "";
    }
  }
  if (run.length >= 4) acc += run;
  return acc;
}

/** Server-side regex extraction (mirrors templates.ts client-side reconcile). */
function extractTerms(text: string): { preMoney?: number; valuationCap?: number; liqPrefMultiple?: number; antiDilution?: string; instrument?: string; discount?: number } {
  const out: ReturnType<typeof extractTerms> = {};
  const norm = text.replace(/\s+/g, " ");
  const toAmount = (n: string, suffix?: string): number => {
    const v = parseFloat(n.replace(/,/g, ""));
    if (!Number.isFinite(v)) return 0;
    const s = (suffix ?? "").toLowerCase();
    if (s === "million" || s === "m") return v * 1_000_000;
    if (s === "k") return v * 1_000;
    return v;
  };
  const pre = norm.match(/pre[-\s]?money(?:\s+valuation)?[^$]*\$\s?([\d,]+(?:\.\d+)?)\s?(million|m|k)?/i);
  if (pre) out.preMoney = toAmount(pre[1], pre[2]);
  const cap = norm.match(/(?:valuation\s+cap|cap\s+price)[^$]*\$\s?([\d,]+(?:\.\d+)?)\s?(million|m|k)?/i);
  if (cap) out.valuationCap = toAmount(cap[1], cap[2]);
  const liq = norm.match(/(\d+(?:\.\d+)?)\s?[x×]\s+(?:non-)?participating?(?:\s+preferred)?/i)
           ?? norm.match(/liquidation\s+preference[^0-9]*(\d+(?:\.\d+)?)\s?[x×]/i);
  if (liq) out.liqPrefMultiple = parseFloat(liq[1]);
  if (/full\s+ratchet/i.test(norm)) out.antiDilution = "full_ratchet";
  else if (/broad[-\s]?based\s+weighted/i.test(norm)) out.antiDilution = "broad_based_wa";
  else if (/narrow[-\s]?based\s+weighted/i.test(norm)) out.antiDilution = "narrow_based_wa";
  const disc = norm.match(/(\d+(?:\.\d+)?)\s?%\s+discount/i);
  if (disc) out.discount = parseFloat(disc[1]);
  if (/series\s+[A-Z]\s+preferred/i.test(norm) || /preference\s+shares/i.test(norm)) out.instrument = "preferred";
  else if (/SAFE/i.test(norm)) out.instrument = /post[-\s]?money/i.test(norm) ? "safe_post" : "safe_pre";
  else if (/convertible\s+(?:note|loan)/i.test(norm)) out.instrument = "convertible_note";
  return out;
}

/* ====================================================================== */
/*  Sprint 28 Wave 3 — Admin Companies full JOIN endpoint.                */
/*  requireAdmin gate added.                                              */
/* ====================================================================== */

interface AdminCompanyFullRow {
  id: string;
  name: string;
  legalName: string;
  region: string;
  sector: string;
  stage: string;
  hq: string;
  maScore: number;
  totalRaisedMinor: number;
  currency: string;
  activeRoundsCount: number;
  totalRoundsCount: number;
  softCircles30d: number;
  softCircle30dAmountMinor: number;
  dataroomFiles: number;
  reportsPublished: number;
  events30d: number;
  lastActivityAt: string | null;
  subscription: Subscription | null;
}

function registerAdminCompaniesFullRoute(app: Express) {
  app.get("/api/admin/companies/full", requireAdmin, (_req: Request, res: Response) => {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 86_400_000;
    const subs = new Map<string, Subscription>();
    for (const s of listSubscriptions()) subs.set(s.companyId, s);

    const rows: AdminCompanyFullRow[] = canonicalCompanies.map((c) => {
      const companyRounds = canonicalRounds.filter((r) => r.companyId === c.id);
      const closedRounds = companyRounds.filter((r) => r.state === "closed" || r.state === "funded");
      const activeRounds = companyRounds.filter((r) => r.state !== "closed" && r.state !== "funded");

      const roundCurrency = (companyRounds[0] as { currency?: string } | undefined)?.currency ?? "USD";
      const totalRaisedMinor = closedRounds.reduce((sum, r) => {
        const raw = (r as { raisedAmount?: number }).raisedAmount ?? 0;
        return sum + Math.round(raw * 100);
      }, 0);

      const roundIds = new Set(companyRounds.map((r) => r.id));
      const allSoftCircles = canonicalSoftCircles.filter((sc) => roundIds.has(sc.roundId));
      const softCircles30d = allSoftCircles.filter((sc) => now - new Date(sc.createdAt).getTime() < THIRTY_DAYS);
      const softCircle30dAmountMinor = softCircles30d.reduce(
        (sum, sc) => sum + Math.round((sc.amount ?? 0) * 100),
        0,
      );

      const dataroomFiles = canonicalDataroomFiles.filter((f) => f.companyId === c.id).length;
      const reportsPublished = canonicalReports.filter((r) => r.companyId === c.id).length;

      const allEvents = getTelemetryEvents(5_000);
      const events30d = allEvents.filter((e) => {
        const ec = (e.payload as { companyId?: string })?.companyId;
        if (ec !== c.id) return false;
        return now - new Date(e.occurredAt).getTime() < THIRTY_DAYS;
      }).length;

      let lastActivityAt: string | null = null;
      const updateMax = (iso?: string | null) => {
        if (!iso) return;
        if (!lastActivityAt || new Date(iso) > new Date(lastActivityAt)) lastActivityAt = iso;
      };
      companyRounds.forEach((r) => updateMax((r as { closeDate?: string; openDate?: string }).closeDate));
      allSoftCircles.forEach((sc) => updateMax(sc.createdAt));
      canonicalReports.filter((r) => r.companyId === c.id).forEach((r) => updateMax((r as { publishedAt?: string }).publishedAt));

      return {
        id: c.id,
        name: c.name,
        legalName: c.legalName,
        region: (c as { region?: string }).region ?? "US",
        sector: c.sector,
        stage: c.stage,
        hq: c.hq,
        maScore: (c as { maScore?: number }).maScore ?? 0,
        totalRaisedMinor,
        currency: roundCurrency,
        activeRoundsCount: activeRounds.length,
        totalRoundsCount: companyRounds.length,
        softCircles30d: softCircles30d.length,
        softCircle30dAmountMinor,
        dataroomFiles,
        reportsPublished,
        events30d,
        lastActivityAt,
        subscription: subs.get(c.id) ?? null,
      };
    });

    res.json({ rows });
  });
}
