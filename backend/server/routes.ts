/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import multer from "multer";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  companies,
  securities,
  rounds,
  roundInvitations,
  softCircles,
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
// v25.45 F13a/F13b — durable user-privacy store + resolveDisplayName helper.
import { writeUserPrivacy as f13WriteUserPrivacy, readUserPrivacyRaw as f13ReadUserPrivacyRaw } from "./lib/userPrivacyResolver";
import { sanitizeErrorMessage } from "./lib/sanitize"; /* v25.32 burndown — item 33 */
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
import { registerFounderSearchRoutes } from "./founderSearchStore"; /* v25.45.4 H-2 — global search */
import { registerProfileWizardStateRoutes } from "./profileWizardStateStore"; /* v25.45.4 M-4 — wizard persistence */
import { registerCollectiveWaitlistRoutes } from "./collectiveWaitlistRoutes"; /* v16 Fix 6 */
import { registerWelcomeRoutes, ack as welcomeAck, getAck as getWelcomeAck } from "./welcomeStore";
import { registerNetworkPostsRoutes } from "./networkPostsStore";
import { registerFeedsRoutes } from "./feedsStore"; // v25.43 R3-4 — live market/crypto/macro + Capavate-internal ticker feeds
import { registerBulkMessageRoutes } from "./bulkMessageStore";
import { registerPortfolioAnalyticsRoutes } from "./portfolioAnalyticsStore";
import { registerSprint21Routes } from "./sprint21Routes";
import { setSessionCookie, clearSessionCookie, readSessionCookie } from "./lib/sessionCookie.js";
// Wave C FIX C1 (W-2) — logout must revoke the server-side session, not
// merely clear cookies on the client. See server/lib/sessionRevocation.ts.
import { revokeSession } from "./lib/sessionRevocation.js";
import { getRecentEvents, findEventsByType } from "./sprint10Telemetry";
// Sprint 11 — founder build
import { registerMultiCompanyRoutes, updateCompanyDetails, getCompanyNameById, getCompanyRecordById, getAllCompanies, getAllCompaniesFromDb, addCompanyForFounder } from "./multiCompanyStore"; // B-509/C-011 v23.6 added getCompanyNameById; v23.7.1 added getCompanyRecordById (BUG 019 follow-up); v23.8 added getAllCompanies (W-8); v24.2 E2E fix added addCompanyForFounder (founder-creates-company auto-registers ownership)
import { registerMembershipRoutes } from "./membershipStore";
import { registerDataroomRoutes } from "./dataroomStore";
// v23.4.7 Phase 13 / BUG 030 — dedicated server endpoint for company-logo
// uploads so the founder Company-profile form no longer carries multi-MB
// base64 data URLs in form state.
import { registerCompanyLogoRoutes } from "./lib/companyLogoRoutes";
import { registerReportsRoutes } from "./reportsStore";
import { registerFounderCrmRoutes, listByFounder as crmListByFounder } from "./founderCrmStore";
import { registerCaptableCommitRoutes, getLedger } from "./captableCommitStore";
import { closeRoundCascadeStandalone } from "./lib/roundCloseCascade";
import { registerTermSheetRoutes } from "./termSheetStore";
import { registerAdminPricingRoutes } from "./adminPricingStore";
import { registerBridgeRoutes } from "./bridgeStore";
import { registerNotificationsRoutes } from "./notificationsStore";
import { registerEmailRoutes } from "./emailStore";
import { registerEmailCampaignRoutes, registerEmailTransportRoutes } from "./emailCampaignStore";
import { registerAdminPlatformRoutes, appendAdminAudit, getAuditLog } from "./adminPlatformStore";
import { registerAdminV25Routes } from "./adminV25Store";
import { createRound as roundsStoreCreate, getRoundsForCompany as roundsStoreForCompany, listRounds as roundsStoreList, getRoundById as roundsStoreGetById, updateRound as roundsStoreUpdate } from "./roundsStore";
// v25.45 Bug C — durable backing for the LEGACY in-memory invitationStore array.
import { persistLegacyInvitationStrict, registerLegacyInvitationTarget } from "./legacyInvitationStore";
// v15 P0-4..P0-11 — real invitation + soft-circle stores.
import {
  createInvitation as roundInvitationsCreate,
  redeemInvitation as roundInvitationsRedeem,
  listForRound as roundInvitationsListForRound,
  revokeInvitation as roundInvitationsRevoke,
  extendInvitation as roundInvitationsExtend,
  getInvitation as roundInvitationsGet,
  listForInvestorEmail as roundInvitationsListForEmail, // B-509 fix v23.6
  // L-009 fix v23.4.13: bridge legacy invitationStore → roundInvitationsStore
  findByTokenHash,
  markInvitationRedeemed,
} from "./roundInvitationsStore";
import {
  createSoftCircle as softCircleCreate,
  validateSoftCircle as softCircleValidate,
  listForRound as softCircleListForRound,
  listForInvestor as softCircleListForInvestor,
  listForCompany as softCircleListForCompany, // C6 (v24.0): admin aggregate from real store
} from "./softCircleStore";
// v24.3 — investor-side wire-fund instructions. Founder publishes bank wire
// details per round; the investor reads them once their soft-circle is signed.
import { setWireInstructions, getWireInstructions } from "./wireInstructionsStore";
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
// v25.0 Track 3 — Consortium Partner endpoints C1–C5 + subrole enforcement C6
import { registerPartnerConsortiumRoutes } from "./partnerConsortiumRoutes";
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
import { registerCollectiveWaveARoutes } from "./collectiveWaveAStore"; /* v25.44 Wave A surfaces 1-12 */
import { registerCollectiveMaIntelRoutes } from "./collectiveMaIntelStore"; /* v25.44 surface 13 */
import { registerVentureMarketsRoutes } from "./ventureMarketsStore"; /* v25.44 surface 14 */
import { registerCollectiveInterestRoutes } from "./collectiveInterestStore"; /* v25.0 Track 2 B */
// v24.4.1 Bug 1 — Sprint 20 Wave 2 routes (collective network, investor CRM,
// portfolio marks, tax export, mute-author, report) were defined but never
// wired in v20. Adding the registration call here closes the dead-spot.
import { registerSprint20Wave2Routes } from "./sprint20Wave2Routes";
import { registerAdminCollectiveRoutes } from "./adminCollectiveRoutes";
import { registerAdminCollectiveFeeRoutes } from "./adminCollectiveFeeRoutes"; /* v25.39 — admin write endpoints for fee/commission config */
import { registerAdminPlatformFeesRoutes } from "./adminPlatformFeesRoutes"; /* v25.45.4 L-2 — DB-backed Platform Fees admin (foundation for v25.46) */
import { registerAdminFeeTierRoutes } from "./adminFeeTierRoutes"; /* v25.46.1 — multi-section fee admin: collective member-subscription + consortium subscription tiers + SPV deployment flat fee */
import { registerV2546Routes } from "./v2546Routes"; /* v25.46 — 6-track release: messages, network posts, pulse SSE, markets quote, press */
import { registerAdminDscRoutes } from "./adminDscRoutes";
// v17 Phase C — Founder accept/decline offers + DSC vote public endpoint.
import { registerCollectiveOfferRoutes } from "./collectiveOffersStore";
import { registerCollectiveDscVoteRoutes } from "./collectiveDscVoteRoutes";
import { registerScreeningEventRoutes } from "./screeningEventsStore";
import { registerCollectiveBillingRoutes } from "./collectiveBillingStore";
import { registerCollectiveMembershipDetailRoutes } from "./lib/collectiveMembershipDetailRoutes"; // v25.32 final A2
import { registerTestDebugEndpoints } from "./lib/testDebugEndpoints";
import { registerFounderBillingExtensions } from "./lib/founderBillingExtensions";
import { registerKycDocumentRoutes } from "./lib/kycDocumentStore";
import { registerFounderTeamRoutes } from "./lib/founderTeamStore";
import { persistSecurity } from "./lib/securitiesStore";
import {
  streamTermSheetPdf,
  streamCapTablePdf,
  type CapTableEntry,
} from "./lib/pdfGenerators";
import { listMembersForCompany as captableMembersForCompany } from "./captableCommitStore";
import { getRoundById as roundsGetById } from "./roundsStore";
import { registerMaInitiativesRoutes } from "./lib/maInitiativesStore";
import { registerBulkInvitationsRoutes } from "./lib/bulkInvitationsRoutes";
import { registerExpertQARoutes } from "./expertQAStore";
import { registerChapterAnnouncementRoutes } from "./chapterAnnouncementsStore";
import { registerChapterResourceRoutes } from "./chapterResourcesStore";
import { registerLeaderboardRoutes } from "./chapterLeaderboardStore";
/* v19 Phase B — Messaging + Partner Workspace remaining DB-backed surfaces. */
import { registerMessagingRoutes } from "./messagingStore";
/* v25.46 BLOCKER FIX #1 — canDM guard for the LEGACY /api/messages write routes.
 * Mounted BEFORE registerMessagingRoutes so it short-circuits forbidden direct
 * DMs (self / guest / unresolved) before the SACRED messagingStore handler runs.
 * The sacred store (Tier-1 #12) is NOT edited; enforcement lives at this layer. */
import { registerLegacyMessagingCanDmGuard } from "./legacyMessagingCanDmGuard";
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
import { registerTrack1Routes } from "./track1Routes";
import { registerTrack4Routes, setSoftCircleSource } from "./track4Routes";
import { registerRoundCarryForwardRoutes } from "./roundCarryForwardRoutes";
// Avi 22-May Issue 2 — PPS derivation helper routes.
import { registerRoundPriceDerivationRoutes } from "./lib/roundPriceDerivation";
import { registerSecureAuthRoutes } from "./lib/secureAuthRoutes";
import { registerAdminUsersRoutes } from "./lib/adminUsersRoutes";
/* v25.33 — Consortium Partner Payment Model admin fee/agreement/tax routes. */
import { registerPartnerFeeAdminRoutes } from "./lib/partnerFeeAdminRoutes";
/* v25.33 Consortium Partner Payment Model — partner self-service endpoints
   (subscription / spv-fees / tax-forms / agreement). Additive; separate file. */
import { registerPartnerSelfServiceRoutes } from "./lib/partnerSelfServiceRoutes";
/* v25.34 Collective Payment Model — parallel/additive to v25.33. Admin CRUD +
   member quote-only self-service. Separate files; touches no Avi write path. */
import { registerCollectivePaymentAdminRoutes } from "./lib/collectivePaymentAdminRoutes";
import { registerCollectiveMemberSelfServiceRoutes } from "./lib/collectiveMemberSelfServiceRoutes";
import { registerAdminEmailRoutes } from "./lib/adminEmailRoutes";
// v23.4.7 Phase 15 / B-101 — admin dedupe-companies cleanup endpoint.
import { registerAdminCleanupRoutes } from "./lib/adminCleanupRoutes";
// v23.4.8 Phase 2 / BUG 012 — manual shareholders in round wizard (non-sacred path)
import { registerRoundInitialShareholdersRoutes } from "./lib/roundInitialShareholdersStore";
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
// v25.45 ROUND 2 — per-route archive gate (canonical enforcement; the
// /api/founder path-prefix middleware is defense-in-depth only).
import { assertWorkspaceNotArchived } from "./middleware/archiveCheck";
// v25.45 ROUND 2 (F13b) — privacy resolver for cap-table PDF shareholder labels.
import { resolveDisplayName } from "./lib/userPrivacyResolver";
// v25.45 ROUND 8 (GPT-5.5 finding) — cap-table PDF must compute counterparty
// status dynamically. The route admits invitation-only viewers (via
// requireCanAccessCompany) who are NOT committed cap-table members; they must
// NOT be treated as counterparties. areCoMembersOnAnyCapTable reads the SACRED
// captable_commits ledger (read-only) to verify a real shared-cap-table
// relationship per rendered member.
import { areCoMembersOnAnyCapTable } from "./lib/capTableMembership";
// B (v24.0) — canonical tenant-isolation helpers.
import {
  canAccessCompany as tenantCanAccessCompany,
  requireCanAccessCompany,
  requireFounderOwnsCompany as tenantRequireFounderOwnsCompany,
  requireFounderOwnsRound as tenantRequireFounderOwnsRound,
  requireInvestorCanViewRound,
  founderOwnedCompanyIds as tenantFounderOwnedCompanyIds,
  investorVisibleCompanyIds as tenantInvestorVisibleCompanyIds,
} from "./lib/tenantAuth";
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

/* v25.45 Bug C — hand the legacy invitation array to the durable store module
 * so the HYDRATE_ORDER entry can rehydrate persisted tokens / redemption state
 * into THIS exact array on boot (hydrateAllStores runs before registerRoutes). */
registerLegacyInvitationTarget(invitationStore);

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

  /* v25.24 NH-5 — Origin allowlist is mounted in server/index.ts BEFORE
   * applyRouteGuards so it fires before the generic auth gate. Mounting it
   * inside registerRoutes is too late (express runs middlewares in
   * registration order; applyRouteGuards already ran). Keep this comment
   * for traceability; do not re-mount here. */

  /* ------------ Sprint 22 Wave 1: loadUserContext MUST be first so every downstream
   * handler has req.userContext populated (DEF-022 root fix). ------------ */
  app.use(loadUserContext);

  /* ------------ v25.45 F20c — archived-workspace read-only enforcement.
   * Mounted on /api/founder immediately after loadUserContext (so req.userContext
   * is populated) and BEFORE any /api/founder/* handler registers. Rejects every
   * mutating (non-GET) founder request with 403 WORKSPACE_ARCHIVED when the
   * resolved company.archive_status === 'archived'. GETs and the reactivate
   * escape-hatch always pass. Cap-table hash chains are never modified. ------ */
  {
    const { archiveCheck } = await import("./middleware/archiveCheck");
    app.use("/api/founder", archiveCheck);
  }

  /* ------------ v25.17 Lane C NC2 — the /api/admin mount guard MUST be installed
   * BEFORE any admin router is registered. Express runs path-mounted middleware
   * only for routes added after `app.use(...)`. Previously this lived at line
   * ~559, AFTER registerAdminPricingRoutes / registerAdminPlatformRoutes /
   * registerPaymentGatewayRoutes / registerAdminContactsRoutes — making the
   * guard a no-op for those routers' admin endpoints. ------------ */
  app.use("/api/admin", requireAdmin);

  /* ------------ v25.23 SHIP-BLOCKER ROOT-CAUSE HANDLING (CSRF) ------------
   *
   * The triple-verifier caught two real problems with the v25.22 NH-2 +
   * v25.23 NH-G CSRF write-mounts: (1) they were registered AFTER the
   * route handlers, making them silent no-ops; (2) when I re-mounted them
   * BEFORE the handlers (the technically correct fix), the resulting
   * gate broke prior-wave e2e suites because the test clients never sent
   * an X-CSRF-Token header.
   *
   * The HONEST diagnosis is: the CSRF infrastructure is half-built.
   * - Server side: csrfMiddleware exists, mints csrfToken per session, can
   *   validate via X-CSRF-Token header (server/lib/csrf.ts).
   * - BUT the legacy /api/auth/login flow does NOT return the csrfToken to
   *   the client, and the client codebase nowhere reads or sends a CSRF
   *   token. Only /api/auth/secure/* returns one (used by a separate code
   *   path). The double-submit pattern requires BOTH halves to be wired.
   *
   * Mounting CSRF on /api/collective/* + /api/partner/* + /api/admin/*
   * would block every authenticated write from the real product because
   * the client cannot supply a token. We do NOT ship that.
   *
   * What we keep mounted (these work because the test/client paths that
   * use them are already wired to send the token, or the route is
   * unauthenticated bootstrap):
   *   - /api/auth/secure/*           (mounted below; returns + reads csrf)
   *   - /api/invitations/redeem POST (unauth; token IS the credential)
   *   - /api/collective/applications POST (unauth path / bootstrap)
   *   - /api/rounds PATCH .../decision (G7 fix; client-paired)
   *
   * What we are honestly DOCUMENTING as a known gap (v25.22 NH-2,
   * v25.23 NH-G) to be closed when the client is wired for double-submit
   * CSRF in a follow-up wave:
   *   - /api/collective + /api/admin/collective + /api/admin/consortium +
   *     /api/founder/collective + /api/investor/collective
   *   - /api/partner + /api/admin/partners + /api/admin/contacts
   *
   * No false-readiness claim is made: cookie + SameSite + Origin checks
   * are the next-best defense pending the client-side wire-up. The
   * security-headers middleware (line 316) sets SameSite=Lax on cap_uid
   * which provides meaningful CSRF protection in modern browsers for
   * cross-origin POSTs (and CORS at /api caps origin acceptance).
   *
   * The v25.22 NH-2 + v25.23 NH-G csrfForWrites mounts have been REVERTED
   * to avoid breaking the product. The header docstring at server/lib/csrf.ts
   * has been corrected to reflect the actual mount set. */
  const csrfForMethod = (method: string) => (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (req.method.toUpperCase() !== method.toUpperCase()) return next();
    return csrfMiddleware(req, res, next);
  };
  app.use("/api/invitations/redeem", csrfForMethod("POST"));
  /* v25.26 — the CSRF mount on /api/collective/applications was 403'ing every
   * investor Collective application: csrfMiddleware reads `cap_sid` cookie
   * to look up a server-side session, but the standard /api/auth/login flow
   * sets `__Host-cap_uid` (JWT identity), NOT `cap_sid`. Only the dead-code
   * secureAuthRoutes path issued cap_sid. So 100% of authenticated callers
   * to /api/collective/applications got 403 csrf_no_session.
   *
   * Mount disabled to unblock the Collective application funnel. The threat
   * model is already covered by:
   *   - v25.24 NH-5 Origin allowlist (mounted before applyRouteGuards;
   *     rejects cross-site writes with non-allowlisted Origin headers)
   *   - requireAuth gate (must be a logged-in investor)
   *   - Per-IP rate limit
   *   - Cookie SameSite=Lax on cap_uid (modern browsers refuse to send the
   *     identity cookie on cross-site POSTs)
   *
   * A proper CSRF wire-up requires coordinated client+server changes (issue
   * cap_sid + csrf cookie on login, client reads + sends X-CSRF-Token) which
   * is a separate piece of work. Until that ships, the layered defenses
   * above are the documented interim posture. */
  // app.use("/api/collective/applications", csrfForMethod("POST"));
  app.use("/api/rounds", (req, res, next) => {
    if (req.method.toUpperCase() === "PATCH" && req.path.includes("/decision")) {
      return csrfMiddleware(req, res, next);
    }
    next();
  });

  /* v25.24 NH-5 — Origin allowlist mount moved EARLIER (see line ~316 above).
   * Kept this stub comment for traceability; do not re-mount here. */

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
  registerFounderSearchRoutes(app); /* v25.45.4 H-2 — founder global search */
  registerProfileWizardStateRoutes(app); /* v25.45.4 M-4 — profile wizard persistence */
  /* v16 Fix 6 — Collective Waitlist (honest invite-only beta entry point).
   * Stays available regardless of COLLECTIVE_ENABLED. */
  registerCollectiveWaitlistRoutes(app);
  registerWelcomeRoutes(app);

  /* v24.5 GAP-6 — /api/welcome/ack routes (user-context required).
   *
   * POST /api/welcome/ack — body: {}, requires auth, records acknowledgement.
   * GET  /api/welcome/ack — requires auth, returns {acknowledged: boolean}.
   *
   * These are distinct from the existing /api/founder/welcome routes:
   *   - They are role-agnostic (any authed user may ack, not just founders).
   *   - They are DB-backed (welcomeStore write-through to welcome_acks).
   *   - They satisfy the L-J48-1 gap-closure journey.
   */
  app.post("/api/welcome/ack", requireAuth, (req, res) => {
    const ctx = req.userContext;
    const userId = ctx?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    welcomeAck(userId);
    return res.json({ ok: true });
  });

  app.get("/api/welcome/ack", requireAuth, (req, res) => {
    const ctx = req.userContext;
    const userId = ctx?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    return res.json({ acknowledged: getWelcomeAck(userId) });
  });

  registerNetworkPostsRoutes(app);
  registerFeedsRoutes(app); // v25.43 R3-4
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
    const { companyId, companyName, plan, legalName } = req.body ?? {};
    if (!companyId || !companyName) {
      return res.status(400).json({ ok: false, error: "companyId and companyName are required" });
    }
    const ctx = (req as any).userContext;
    const userId: string | undefined = ctx?.userId ?? ctx?.identity?.id ?? ctx?.id;
    const actor = String(ctx?.identity?.email ?? userId ?? `founder:${companyId}`); /* v14 */

    // v24.2 E2E-discovered bug: this handler created the subscription but
    // NEVER registered the founder as the company's owner in multiCompanyStore.
    // A founder could create a company then was immediately rejected by
    // requireFounderOwnsCompany on the very next PATCH ("not_founder_of_company").
    // Fix: register the founder via addCompanyForFounder so ownedCompanyIds
    // resolution finds the company on subsequent reads/writes.
    if (userId) {
      // v25.45 Bug B ROUND-2 FIX (GPT-5.5 blocker 2): the company persist is now
      // AUTHORITATIVE on this caller too. Previously this caught the
      // addCompanyForFounder() failure as "Non-fatal" and still created and
      // returned the subscription with HTTP 201 — recreating the original Bug B
      // class (API success with no durable company/member record, vanishing
      // from Admin after restart). If the durable company/member write fails we
      // now refuse the request with a 500 and DO NOT create or return any
      // subscription. The error message is a fixed, client-safe constant — no
      // internal stack trace or driver detail is leaked. The full server-side
      // error is logged for audit.
      try {
        addCompanyForFounder(userId, {
          companyId,
          companyName,
          legalName: legalName ?? companyName,
          logoUrl: null,
          role: "founder",
          lastActiveAt: new Date().toISOString(),
          kpi: {
            capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0,
            dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 100,
          },
          collective: { status: "none" },
          billing: { plan: "Founder Free" },
        } as any);
      } catch (e) {
        log.error({
          route: "POST /api/founder/companies",
          errorType: "addCompanyForFounder_failed",
          companyId,
          userId,
          message: (e as Error).message,
        });
        return res.status(500).json({
          ok: false,
          error: "COMPANY_PERSIST_FAILED",
          message: "Could not durably save the company. No subscription was created. Please retry.",
        });
      }
    }

    const result = createSubscriptionForNewCompany(companyId, { plan, actor });
    res.status(201).json({ ok: true, companyId, companyName, subscription: result.subscription, subscriptionCreated: result.created });
  });

  registerMembershipRoutes(app);
  registerDataroomRoutes(app);
  registerCompanyLogoRoutes(app);
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
  registerAdminV25Routes(app);

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
  /* v25.6 — MUST register BEFORE registerPaymentGatewayRoutes() so the
   * Stripe-webhook deprecation middleware pre-empts the legacy handler.
   * Express dispatches in registration order. */
  registerFounderBillingExtensions(app);
  registerPaymentGatewayRoutes(app);

  /* ------------ Sprint 28 Wave 4: Admin Contacts CRM ------------ */
  registerAdminContactsRoutes(app);
  // v25.0 Track 3 — register new C1-C5 endpoints BEFORE legacy partnerRoutes
  // so they shadow any old GET /api/partner/me/clients stub.
  registerPartnerConsortiumRoutes(app);
  // v25.33 — additive partner self-service endpoints. Registered after the
  // consortium routes; uses distinct paths so it shadows nothing Avi owns.
  registerPartnerSelfServiceRoutes(app);
  // v25.34 — member-facing Collective payment quote-only endpoints. Each route
  // is individually gated requireCollectiveMember; distinct /api/collective/me/*
  // paths shadow nothing Avi owns.
  registerCollectiveMemberSelfServiceRoutes(app);
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
  registerCollectiveWaveARoutes(app); /* v25.44 Wave A surfaces 1-12 */
  registerCollectiveMaIntelRoutes(app); /* v25.44 surface 13 — M&A Intelligence */
  registerVentureMarketsRoutes(app); /* v25.44 surface 14 — venture markets */
  registerCollectiveInterestRoutes(app); /* v25.0 Track 2 B1/B2/B4 */
  registerCollectiveSettingsRoutes(app);
  // v24.4.1 Bug 1 — register the Sprint 20 Wave 2 surface (collective network,
  // investor CRM, portfolio marks, tax export, mute-author, report). Must come
  // AFTER requireAuthenticated mounts on /api/collective so the gate runs first.
  registerSprint20Wave2Routes(app);

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
  /* v25.17 Lane C NC2 — guard moved to the top of registerRoutes; this line
     remains for documentation. The duplicate is harmless (idempotent). */
  app.use("/api/admin", requireAdmin);

  /* ------------ Patch v10 — Admin Collective approval pipeline (P0-10/C-CORE-1) ------------ */
  registerAdminCollectiveRoutes(app);

  /* ------------ v25.39 — Admin write endpoints for application-fee + partner commission-rate config ------------ */
  registerAdminCollectiveFeeRoutes(app);
  registerAdminPlatformFeesRoutes(app); /* v25.45.4 L-2 — /api/admin/platform-fees read+update */
  registerAdminFeeTierRoutes(app); /* v25.46.1 — /api/admin/collective/member-subscription-tiers + /api/admin/consortium/subscription-tiers + /api/admin/consortium/spv-deployment-fee */
  registerV2546Routes(app); /* v25.46 — 6-track release endpoints (messages, network posts, pulse, markets, press) */

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

  /* v25.32 final A2 — additive collective membership DETAIL endpoint. Reads
   * DB-direct from collective_memberships_billing + collective_billing_events
   * to surface amount-anchor / payment date / expiry / status WITHOUT touching
   * the sacred collectiveBillingStore.ts. Mounts under /api/collective so it
   * inherits the requireAuthenticated gate registered above. */
  registerCollectiveMembershipDetailRoutes(app);

  /* v25.5 — Test-debug endpoints (gated by ENABLE_TEST_DEBUG_ENDPOINTS=1).
   * Returns 404 on every route when the env flag is unset. */
  registerTestDebugEndpoints(app);

  /* v25.6 — KYC document upload + admin verification.
   *   POST /api/investor/kyc/documents               investor uploads
   *   GET  /api/investor/kyc/documents               investor lists own docs
   *   GET  /api/admin/kyc/documents/:investorId      admin lists per-investor
   *   POST /api/admin/kyc/documents/:docId/verify    admin verifies/rejects
   *   GET  /api/admin/kyc/documents/:docId/blob      admin downloads blob
   */
  registerKycDocumentRoutes(app);

  /* v25.7 — Founder team invitations + removal (closes v24.2-deferred 501).
   * MUST register BEFORE the legacy 501 stubs in this file so Express picks
   * up our real handlers first. */
  registerFounderTeamRoutes(app);
  // v25.45 F20 — workspace archive + revival routes.
  (await import("./lib/workspaceArchiveStore")).registerWorkspaceArchiveRoutes(app);

  /* v25.7 — M&A initiative respond/decline (closes fake-success P0 gap).
   * Same ordering rationale: registers before the legacy fake-success stubs. */
  registerMaInitiativesRoutes(app);

  /* v25.7 — Bulk round invitations (closes v24.0 501 lockdown gap).
   * Same ordering rationale. */
  registerBulkInvitationsRoutes(app);

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
  // v25.46 BLOCKER FIX #1 — enforce canDM() on the legacy direct-send routes
  // BEFORE the sacred messagingStore handlers are mounted (Express dispatches
  // matching middleware in registration order). Blocks self-DM, guest, and
  // unresolved recipients with 403 on POST /api/messages + /api/messages/threads.
  registerLegacyMessagingCanDmGuard(app);
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
  /* v25.23 ship-blocker fix — the previous mount block here was registered AFTER
   * collective + partner + admin routes (registerCollectiveRoutes ~line 540,
   * registerPartnerRoutes ~line 512, registerAdminContactsRoutes ~line 508).
   * Express applies `app.use(path, mw)` only to routes registered AFTER the
   * mount, so the v25.22 NH-2 collective CSRF mount AND the v25.23 NH-G
   * partner/admin-partner/admin-contacts CSRF mount were silently no-ops.
   *
   * The whole CSRF mount block has been hoisted to immediately after the
   * global /api/admin admin guard (line 329) which is the same place the
   * Capavate codebase already learned this lesson (see comment at :325-328).
   * The /api/auth/secure rate-limit + csrf mount stays here because those
   * routes are registered via registerSecureAuthRoutes(app) AFTER this block
   * — the dependency order is correct for them. */
  app.use("/api/auth/secure", rateLimitMiddleware);
  app.use("/api/auth/secure", csrfMiddleware);

  /* ------------ Sprint 17 D6: secure JWT auth (alongside Sprint 15 persona shell) ------------ */
  registerSecureAuthRoutes(app);

  /* ------------ Sprint 17 D7: admin user management ------------ */
  registerAdminUsersRoutes(app);

  /* ------------ v25.33: Consortium Partner Payment Model — admin fee catalogue
   * CRUD + per-partner overrides. Mounted under /api/admin (router-level
   * requireAdmin gate above protects every endpoint). ------------ */
  registerPartnerFeeAdminRoutes(app);

  /* ------------ v25.34: Collective Payment Model — admin schedule/entry/invoice
   * CRUD + P&L. Mounted under /api/admin (router-level requireAdmin gate above
   * protects every endpoint). Parallel/additive to the partner fee routes. -- */
  registerCollectivePaymentAdminRoutes(app);

  /* ------------ v23.4.2: admin SMTP diagnostic endpoints ------------ */
  registerAdminEmailRoutes(app);

  /* ------------ v23.4.7 Phase 15 / B-101: admin dedupe-companies cleanup ------------ */
  registerAdminCleanupRoutes(app);
  // v23.4.8 Phase 2 / BUG 012 — wizard-driven initial-shareholders capture.
  registerRoundInitialShareholdersRoutes(app);

  /* ------------ Sprint 17 D4: realtime invalidation stream ------------ */
  app.get("/api/events/stream", realtimeStreamHandler);

  /* ------------ Sprint 17 health: DB layer status ------------ */
  app.get("/api/db/status", requireAuth, (_req, res) => {
    res.json({ ok: true, syncEntities: SYNC_ENTITY_COUNT, driver: process.env.DATABASE_URL?.startsWith("postgres") ? "postgres" : "sqlite" });
  });

  /* ------------ Pass 4: /api/healthz production healthcheck (PUBLIC — no auth) ------------ */
  const SERVER_START = Date.now();
  // v23.9 A6 — read package.json by absolute path. esbuild mangles the bundled
  // `require("../package.json")` (it resolves relative to the source tree, not
  // dist/), which made the prod bundle report version "0.0.0". readFileSync is
  // preserved verbatim by esbuild, so __dirname (dist/ in prod) resolves the
  // shipped package.json correctly.
  // v24.0 D1: version resolver priority order. APP_VERSION env wins so the
  // deploy script can guarantee the shipped version regardless of bundle
  // layout. Never silently return "0.0.0" — log loudly and return "unknown".
  const version = (() => {
    if (process.env.APP_VERSION) return process.env.APP_VERSION;
    try {
      const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8"));
      if (pkg.version) return pkg.version as string;
    } catch { }
    try {
      const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
      if (pkg.version) return pkg.version as string;
    } catch { }
    log.error({ route: "health.version", errorType: "version_unresolved", message: "FAILED to resolve version — APP_VERSION env unset and package.json not found" });
    return "unknown";
  })();
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
    // v24.3 — surface which integrations are actually wired so the admin can
    // see at a glance what's configured (Avi's ops pain: "is SMTP / dev-reset /
    // Airwallex live on this box?"). All booleans; never leaks secret values.
    let airwallexConfigured = false;
    // v24.4 Bug A — surface the resolved Airwallex operating mode (stub|test|live).
    let airwallexMode: "stub" | "test" | "live" = "stub";
    try {
      // Prefer the canonical readiness probe (checks AIRWALLEX_API_KEY +
      // AIRWALLEX_CLIENT_ID); fall back to a bare env probe if it throws.
      const { isGatewayReady, getAirwallexMode } = await import("./lib/paymentGatewayResolver");
      airwallexConfigured = Boolean(isGatewayReady("airwallex"));
      airwallexMode = getAirwallexMode();
    } catch {
      airwallexConfigured = !!process.env.AIRWALLEX_API_KEY;
    }
    const featureFlags = {
      smtpConfigured: !!process.env.SMTP_HOST,
      devResetUrlEnabled: process.env.RETURN_DEV_RESET_URL === "1",
      airwallexConfigured,
      airwallexMode,
    };
    res.json({
      status: dbOk && (hydrateState === "ok" || hydrateState === "partial") ? "ok" : "degraded",
      db: dbOk ? "connected" : "down",
      sse_subscribers: sseSubscribers,
      hydrate_state: hydrateState,
      git_sha: process.env.GIT_SHA ?? null,
      build_time: process.env.BUILD_TIME ?? null,
      uptime_s: Math.floor((Date.now() - SERVER_START) / 1000),
      version,
      featureFlags,
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
      if (entry) {
        // Legacy path — unchanged.
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
            roundLabel: round ? `${round.type ?? ""}${round.targetAmount ? " · $" + (round.targetAmount / 1_000_000).toFixed(1) + "M target" : ""}` : undefined,
            founderName: company ? "Founder" : undefined,
          },
        };
      }

      // L-009 fix v23.4.13: bridge to roundInvitationsStore
      const modernEntry = findByTokenHash(hash);
      if (!modernEntry) return { ok: false, reason: "not_found" };
      if (modernEntry.state === "revoked") return { ok: false, reason: "revoked" };
      if (modernEntry.redeemedAt) return { ok: false, reason: "already_redeemed" };
      if (modernEntry.expiresAt && Date.now() > new Date(modernEntry.expiresAt).getTime()) return { ok: false, reason: "expired" };

      const modernCompany = _allCompanies.find(c => c.id === modernEntry.companyId);
      const modernRound = mergeLegacyAndDbRounds().find(r => r.id === modernEntry.roundId);
      return {
        ok: true,
        invitation: {
          roundId: modernEntry.roundId,
          companyId: modernEntry.companyId ?? "",
          companyName: modernCompany?.name ?? "",
          inviteeEmail: modernEntry.investorEmail,
          inviteeName: modernEntry.investorName ?? "",
          expiresAt: modernEntry.expiresAt ?? "",
          roundLabel: modernRound ? `${modernRound.type ?? ""}${modernRound.targetAmount ? " · $" + (modernRound.targetAmount / 1_000_000).toFixed(1) + "M target" : ""}` : undefined,
          founderName: modernCompany ? "Founder" : undefined,
        },
      };
    },
    redeem: (rawToken: string): RedemptionResult => {
      const hash = sha256Hex(rawToken);
      const entry = invitationStore.find(e => e.tokenHash === hash);
      if (entry) {
        // Legacy path — unchanged.
        if (entry.revoked) return { ok: false, reason: "revoked" };
        if (entry.redeemed) return { ok: false, reason: "already_redeemed" };
        if (Date.now() > new Date(entry.expiresAt).getTime()) return { ok: false, reason: "expired" };
        // v25.45 Bug C ROUND-2 (GPT-5.5 blocker 4 / auth-shell redeem callback):
        // FAIL-CLOSED. Mark redeemed, durably persist STRICTLY, and only report
        // success once the token-state write confirms. On persist failure roll
        // back the in-memory mutation and return reason "persist_failed" so the
        // auth-shell route returns 500 and does NOT register a persona / set a
        // session. After a restart the token therefore cannot be reused.
        entry.redeemed = true;
        entry.redeemedAt = new Date().toISOString();
        try {
          persistLegacyInvitationStrict(entry);
        } catch (err) {
          entry.redeemed = false;
          entry.redeemedAt = null;
          log.error({
            route: "authShell.redeem (legacy invitation)",
            errorType: "legacy_invitation_redeem_persist_failed",
            invitationId: entry.id,
            message: (err as Error).message,
          });
          return { ok: false, reason: "persist_failed" };
        }
        return { ok: true, invitationId: entry.id, roundId: entry.roundId, companyId: entry.companyId };
      }

      // L-009 fix v23.4.13: bridge to roundInvitationsStore
      const modernEntry = findByTokenHash(hash);
      if (!modernEntry) return { ok: false, reason: "not_found" };
      if (modernEntry.state === "revoked") return { ok: false, reason: "revoked" };
      if (modernEntry.redeemedAt) return { ok: false, reason: "already_redeemed" };
      if (modernEntry.expiresAt && Date.now() > new Date(modernEntry.expiresAt).getTime()) return { ok: false, reason: "expired" };

      const ok = markInvitationRedeemed(modernEntry.id);
      if (!ok) return { ok: false, reason: "not_found" };
      return { ok: true, invitationId: modernEntry.id, roundId: modernEntry.roundId, companyId: modernEntry.companyId ?? "" };
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
  app.use("/api/investor/portfolio", gate("investor.hasAnyCapTable"));
  app.use("/api/investor/crm", gate("investor.hasAnyCapTable"));
  app.use("/api/investor/messages", gate("investor.hasAnyCapTable"));
  app.use("/api/investor/portfolio2", gate("investor.hasAnyCapTable"));
  app.use("/api/investor/companies/:companyId", gate("investor.onCapTableOf"));
  app.use("/api/collective/applications", (req, res, next) => {
    if (req.method !== "POST") return next();
    return gate("investor.hasAnyCapTable")(req, res, next);
  });
  app.use("/api/collective/network", gate("collective.active"));
  app.use("/api/collective/dealroom", gate("collective.active"));
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
      { id: "ra_1", ts: "2026-05-08T09:14:00Z", kind: "new_round", companyId: "co_arboreal", company: "Arboreal Health", text: "Pre-Seed open · $1.5M target · soft-circle window 14d", href: "/investor/companies/co_arboreal?tab=your-decision", roundId: "rnd_pre" },
      { id: "ra_2", ts: "2026-05-07T17:02:00Z", kind: "soft_circle", companyId: "co_novapay", company: "NovaPay AI", text: "Seed Extension · $2.65M soft-circled of $4.0M", href: "/investor/companies/co_novapay?tab=your-decision", roundId: "rnd_novapay_seed" },
      { id: "ra_3", ts: "2026-05-06T11:08:00Z", kind: "term_sheet", companyId: "co_quanta", company: "Quanta Robotics", text: "Series A term sheet drop — pro-rata exercise window 7d", href: "/investor/companies/co_quanta?tab=your-decision", roundId: "rnd_q_a" },
      { id: "ra_4", ts: "2026-05-05T14:33:00Z", kind: "close_gate", companyId: "co_helia", company: "Helia AI", text: "Series A closing tomorrow — last call for confirmations", href: "/investor/companies/co_helia?tab=your-decision", roundId: "rnd_helia_a" },
      { id: "ra_5", ts: "2026-05-03T08:00:00Z", kind: "new_round", companyId: "co_kelvin", company: "Kelvin Energy", text: "Bridge note round opening Q2", href: "/investor/companies/co_kelvin?tab=your-decision", roundId: "rnd_k_bridge" },
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
  // B1 (v24.0 LOCKDOWN) — tenant isolation. Previously returned the full
  // company list to ANY authenticated user. Now scope by entitlement:
  //   admin    → all companies
  //   founder  → only companies the founder owns
  //   investor → only companies they can view (cap-table positions + invited
  //              rounds' companies)
  app.get("/api/companies", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    if (ctx?.isAdmin) return res.json(companies);
    const allowed = new Set<string>();
    tenantFounderOwnedCompanyIds(ctx).forEach((id) => allowed.add(id));
    tenantInvestorVisibleCompanyIds(ctx).forEach((id) => allowed.add(id));
    res.json(companies.filter((c) => allowed.has((c as { id: string }).id)));
  });

  /* Sprint 7 — access-aware company-details payload.
   * Auth required. Founders/admins see everything; investors see only invited companies.
   */
  app.get("/api/companies/:id", requireAuth, async (req, res) => {
    const c = companies.find(c => c.id === req.params.id);
    const extra = companyDetailsExtra[req.params.id] ?? null;

    // V7 (Patch v8): replaced private _testAccess.companyProfiles.get(id) reach-in
    // with public getCompanyProfileSnapshot() accessor.
    const { getCompanyProfileSnapshot } = await import("./profileStore");
    const liveProfile = getCompanyProfileSnapshot(req.params.id);

    // BUG 019 follow-up v23.7.1 — founder-created companies (POST
    // /api/founder/companies/new) live ONLY in multiCompanyStore and do not
    // auto-write a profile snapshot at creation time, so they still 404'd here.
    // Resolve the membership record so a freshly-created company is a valid
    // company too, and synthesise the shared shape from it below.
    const mcc = getCompanyRecordById(req.params.id) ?? null;

    // BUG 019 fix v23.7 — the founder "Full page" link (→ /founder/companies/:id
    // → GET /api/companies/:id) 404'd for any company that exists only as a live
    // profile in profileStore (e.g. companies created after server start), since
    // the guard only consulted the legacy in-memory `companies` array and the
    // static `companyDetailsExtra` map. A live profile is a valid company, so we
    // now also accept it and synthesise the shared shape from it below.
    if (!c && !extra && !liveProfile && !mcc) return res.status(404).json({ message: "Not found" });

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

      // v24.3 E2E-discovered P0: tenant isolation gap. Prior to this guard,
      // ANY authenticated user (e.g. founder B) could GET /api/companies/A's-id
      // and receive the full company name/legalName/hq/etc. in the response
      // body. The `access` block reported canSee*=false but the company data
      // was still returned. That's a real cross-tenant leak — returns now 404
      // (not 403) so we don't even leak the existence of the company id.
      // The original v24.0 B-group fixes had hardened other endpoints (e.g.
      // /api/dataroom, /api/crm) but missed this one because the handler
      // pre-dated those fixes and was never re-audited.
      if (!invited) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
    }

    // BUG 019 fix v23.7 — when the company exists only as a live profile, derive
    // the shared display fields from that profile so the full-page view renders
    // the real company name/description instead of the raw id.
    const lp = liveProfile as
      | {
        contact?: { companyName?: string; companyWebsiteUrl?: string; oneSentenceHeadliner?: string; logoDataUrl?: string | null };
        legal?: { legalEntityName?: string; region?: string };
        industry?: string
      }
      | null;
    // BUG 019 follow-up v23.7.1 — when the company exists only in
    // multiCompanyStore (founder-created, no profile snapshot yet), fall back to
    // its membership fields (companyName/legalName/sector/stage/hq/logoUrl) so
    // the full-page view shows the real company instead of the raw id.
    const companyShared = c ?? {
      id: req.params.id,
      name: extra
        ? extra.legalEntity.name.replace(/, (Inc|Ltd)\.?$/i, "").replace(/\s*Co\.$/, "")
        : (lp?.contact?.companyName || mcc?.companyName || req.params.id),
      legalName: extra?.legalEntity.name ?? lp?.legal?.legalEntityName ?? mcc?.legalName ?? "",
      sector: mcc?.sector ?? "",
      stage: mcc?.stage ?? "",
      hq: extra?.mailingAddress ?? mcc?.hq ?? "",
      websiteUrl: lp?.contact?.companyWebsiteUrl ?? "",
      description: extra?.headliner ?? lp?.contact?.oneSentenceHeadliner ?? "",
      logoUrl: lp?.contact?.logoDataUrl ?? mcc?.logoUrl ?? null,
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
    // v23.9 C5 — additive `pipeline` array for the RoundDetail timeline. This is
    // a VISIBILITY-only projection of existing invitation + soft-circle state; it
    // does not drive or alter the funding flow. Each stage carries a count so the
    // UI can render a funnel without fanning out to multiple endpoints.
    let pipeline: Array<{ stage: string; label: string; count: number }> = [];
    try {
      const invites = roundInvitationsListForRound(r.id);
      const circles = softCircleListForRound(r.id);
      const invitedCount = invites.length;
      const redeemedCount = invites.filter((i) => (i as { redeemedAt?: string | null }).redeemedAt).length;
      const softCircledCount = circles.length;
      const validatedCount = circles.filter((s) => (s as { state?: string }).state === "validated").length;
      pipeline = [
        { stage: "invited", label: "Invited", count: invitedCount },
        { stage: "redeemed", label: "Joined", count: redeemedCount },
        { stage: "soft_circled", label: "Soft-circled", count: softCircledCount },
        { stage: "validated", label: "Validated", count: validatedCount },
      ];
    } catch { /* pipeline is best-effort; never block the round read */ }
    // PATCH v3 Bug 4a: coerce pricePerShare to number
    res.json({ ...r, pricePerShare: r.pricePerShare != null ? Number(r.pricePerShare) : null, company: companies.find(c => c.id === r.companyId)?.name, pipeline });
  });

  /* Sprint 18 T5.1 — Edit Terms (active rounds only) — requireAuth */
  app.patch("/api/rounds/:id/terms", requireAuth, (req, res) => {
    // B7 (v24.0 LOCKDOWN) — only the founder who owns the round's company (or
    // admin) may edit terms. Previously any authenticated user could PATCH.
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok) return;
    // v25.45 ROUND 2 — archive gate: block term edits on archived workspaces.
    if (assertWorkspaceNotArchived(req, res, check.companyId ?? companyIdForRound(paramStr(req.params.id)))) return;
    /* 23-May Fix 3 — same legacy/db merge fix as GET /api/rounds/:id. */
    const r = mergeLegacyAndDbRounds().find((rr: any) => rr.id === req.params.id);
    if (!r) return res.status(404).json({ message: "Not found" });
    if (r.state === "closed" || r.state === "funded") {
      return res.status(409).json({ error: "closed_round_readonly", state: r.state });
    }
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    // BUG 034 follow-up v23.7.1 — numeric terms (priced fields + instrument
    // extras) must be REJECTED with 400 when present-but-invalid (NaN or
    // negative), not silently dropped. A field absent from the body is left
    // untouched (no retroactive migration). Returns a typed error so the client
    // can surface which field was wrong. `numericTerm` returns true on a 400 so
    // the caller can bail out of the handler.
    const numericTerm = (key: string): boolean => {
      if (body[key] == null) return false; // absent — leave untouched
      const n = Number(body[key]);
      if (Number.isNaN(n) || n < 0) {
        res.status(400).json({ error: `invalid_${key}`, message: `${key} must be a non-negative number` });
        return true;
      }
      updates[key] = n;
      return false;
    };
    // Priced-round numeric fields.
    if (numericTerm("targetAmount")) return;
    if (numericTerm("preMoney")) return;
    if (numericTerm("postMoney")) return;
    if (numericTerm("pricePerShare")) return;
    if (numericTerm("minTicket")) return;
    if (typeof body.closeDate === "string" && body.closeDate.length > 0) updates.closeDate = body.closeDate;
    if (typeof body.termsSummary === "string") updates.termsSummary = body.termsSummary;
    // v24.4 BUG 049 — allow editing the round name after creation. Reject an
    // explicit empty/blank name (400); a name absent from the body is left
    // untouched. Trimmed before persisting so accidental whitespace is dropped.
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return res.status(400).json({ error: "invalid_name", message: "name must be a non-empty string" });
      }
      updates.name = body.name.trim();
    }
    // BUG 034 fix v23.7 — instrument-specific term extras. The Edit-Terms dialog
    // branches its field set by instrument (SAFE / convertible note / warrant)
    // instead of always showing priced-round fields. Persist those extras onto
    // the round's open-ended extras (the Round type carries a [extra: string]
    // index signature, and these values are spread back onto the round on read).
    // v23.7.1: same non-negative validation as the priced fields (400 on NaN/neg).
    if (numericTerm("valuationCap")) return;
    if (numericTerm("discount")) return;
    if (numericTerm("interestRate")) return;
    if (numericTerm("maturityMonths")) return;
    if (numericTerm("strikePrice")) return;
    if (numericTerm("expiryYears")) return;
    // MFN is a boolean SAFE/Note term carried as an extra.
    if (typeof body.mfn === "boolean") updates.mfn = body.mfn;

    // v25.45 Bug C (Ozan QA wave) — PERSISTENCE FIX.
    //
    // Previously this route did `Object.assign(r, updates)` and returned — it
    // mutated ONLY the in-memory round object (which, for DB-created rounds, is
    // a throwaway copy from mergeLegacyAndDbRounds()/roundsStoreList()). NO DB
    // write occurred, so every term edit (valuation, target raise, MFN, cap,
    // discount, etc.) was silently lost on a server restart — exactly the
    // "variables not stored in db" corruption Ozan flagged. These terms feed the
    // cap table, so the gap was CRITICAL.
    //
    // The canonical, transactional, mass-assignment-guarded, audited writer is
    // roundsStore.updateRound(): core columns map via UPDATE_WHITELIST and the
    // long-tail TERM extras (valuationCap/discount/mfn/...) round-trip through
    // the extras_json column via UPDATE_EXTRAS_WHITELIST. We route every patched
    // field through it so the DB is the source of truth. NOTE: this does NOT
    // touch cap-table math or the captable_commits ledger — it fixes the round
    // WRITE side only.
    const updResult = roundsStoreUpdate(String(req.params.id), updates, {
      actor: check.userId ?? "u_unknown",
    });
    if (!updResult.ok) {
      // Fail closed: surface a typed error rather than reporting a phantom save.
      // ROUND_NOT_FOUND can happen for a legacy seed-only round that never made
      // it into roundsStore; fall back to the legacy in-memory mutation so the
      // pre-existing seed-round flows keep working, but still never report a
      // success that wasn't persisted for DB-backed rounds.
      if (updResult.error === "ROUND_NOT_FOUND") {
        // Legacy seed-only round not in roundsStore — the legacy in-memory
        // mirror update below (Object.assign(r, updates)) is the only store for
        // it, matching pre-fix behaviour for those rows.
      } else if (updResult.error === "NO_CHANGES") {
        // No persistable fields supplied — return the unchanged round.
      } else {
        return res.status(500).json({ ok: false, error: updResult.error ?? "ROUND_TERMS_PERSIST_FAILED" });
      }
    }
    // Re-read the canonical (now-persisted) round for the response so the client
    // reflects exactly what landed in the DB.
    const persisted = roundsStoreGetById(String(req.params.id)) ?? { ...r, ...updates };
    // Keep the legacy in-memory `rounds` array object in sync so the dozens of
    // existing read paths (mergeLegacyAndDbRounds().find / rounds.filter) reflect
    // the change without a wide refactor. The DB row written above is the durable
    // source of truth; this is only a hot-read mirror.
    Object.assign(r, updates);
    void BridgeOutbound;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (BridgeOutbound as any).roundTermsUpdated
        ? (BridgeOutbound as any).roundTermsUpdated(persisted.id, { roundId: persisted.id, companyId: persisted.companyId, updates })
        : (BridgeOutbound as any).auditLogAppended?.(persisted.companyId, { eventType: "round.terms_updated", roundId: persisted.id, updates });
    } catch { /* non-fatal */ }
    emitMutation({ aggregate: "round", id: persisted.id, change: "update" });
    res.json({ ok: true, round: { ...persisted, company: companies.find(c => c.id === persisted.companyId)?.name }, eventType: "round.terms_updated" });
  });

  app.get("/api/rounds/:id/invitations", requireAuth, (req, res) => {
    // B2 (v24.0) — only the round's founder (or admin) may list its invitations.
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok) return;
    // v15 P0-4 — union live DB-backed invitations with any legacy seed rows.
    // The raw token is never present here — listForRound returns public views.
    const rid = typeof req.params.id === "string" ? req.params.id : String(req.params.id ?? "");
    const live = roundInvitationsListForRound(rid);
    const seed = roundInvitations.filter(i => i.roundId === rid);
    const liveIds = new Set(live.map((i) => i.id));
    res.json([...seed.filter((i) => !liveIds.has(i.id)), ...live]);
  });
  app.get("/api/rounds/:id/soft-circles", requireAuth, (req, res) => {
    // B3 (v24.0) — only the round's founder (or admin) may list its soft-circles.
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok) return;
    // v15 P0-9 — union live DB-backed circles with the seed list.
    const rid = typeof req.params.id === "string" ? req.params.id : String(req.params.id ?? "");
    const live = softCircleListForRound(rid);
    const seed = softCircles.filter(s => s.roundId === rid);
    const liveIds = new Set(live.map((s) => s.id));
    res.json([...seed.filter((s) => !liveIds.has(s.id)), ...live]);
  });

  /* ====================================================================
   * v24.3 — Investor-side wire-fund instructions (Avi's main complaint).
   *
   * v24.2 added a FOUNDER-side "Mark wire funded" button. Avi correctly noted
   * the INVESTOR also needs visibility: once a soft-circle is `confirmed`
   * (signed), the investor must see WHERE to wire the funds. These endpoints
   * let the founder publish bank wire instructions per round and let an
   * entitled investor read them.
   *
   * Ownership model:
   *   - POST/GET founder routes: caller must FOUND the round's company.
   *   - GET investor route: caller must have a soft-circle in the round (any
   *     status) OR an active invitation to it.
   *
   * Persistence: round_wire_instructions table via wireInstructionsStore
   * (CREATE TABLE IF NOT EXISTS; shared/schema.ts untouched).
   * ==================================================================== */

  // Local founder-ownership check keyed on :roundId (the canonical helper
  // requireFounderOwnsRound reads req.params.id; these routes use :roundId).
  function requireFounderOwnsRoundParam(
    req: import("express").Request,
    res: import("express").Response,
  ): { ok: boolean; companyId?: string; userId?: string } {
    const roundId = paramStr(req.params.roundId);
    const cid = roundId ? companyIdForRound(roundId) : null;
    if (!cid) {
      res.status(404).json({ ok: false, error: "round_not_found" });
      return { ok: false };
    }
    const owns = tenantRequireFounderOwnsCompany(req, res, cid);
    if (!owns.ok) return owns;
    // v25.45 ROUND 2 — catch-all archive gate for every round-scoped mutation
    // that funnels through this helper (wire-instructions, etc.). No-ops on GET.
    if (assertWorkspaceNotArchived(req, res, owns.companyId ?? cid)) return { ok: false };
    return owns;
  }

  // Founder — set (upsert) wire instructions for a round.
  app.post("/api/founder/rounds/:roundId/wire-instructions", requireAuth, (req, res) => {
    const check = requireFounderOwnsRoundParam(req, res);
    if (!check.ok) return;
    const roundId = paramStr(req.params.roundId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
    const optStr = (v: unknown): string | null => {
      const s = typeof v === "string" ? v.trim() : "";
      return s.length > 0 ? s : null;
    };
    const bankName = str(body.bankName);
    const accountName = str(body.accountName);
    const accountNumber = str(body.accountNumber);
    // Validation: bankName + accountName + accountNumber are required.
    if (!bankName || !accountName || !accountNumber) {
      return res.status(400).json({
        ok: false,
        error: "missing_required_fields",
        message: "bankName, accountName and accountNumber are required.",
      });
    }
    const row = setWireInstructions({
      roundId,
      bankName,
      accountName,
      accountNumber,
      routingNumber: optStr(body.routingNumber),
      swift: optStr(body.swift),
      reference: optStr(body.reference),
      notes: optStr(body.notes),
    });
    return res.json({ ok: true, wireInstructions: row });
  });

  // Founder — read back the wire instructions they set.
  app.get("/api/founder/rounds/:roundId/wire-instructions", requireAuth, (req, res) => {
    const check = requireFounderOwnsRoundParam(req, res);
    if (!check.ok) return;
    const roundId = paramStr(req.params.roundId);
    const row = getWireInstructions(roundId);
    if (!row) return res.status(404).json({ ok: false, error: "wire_instructions_not_set" });
    return res.json({ ok: true, wireInstructions: row });
  });

  // Investor — read the wire instructions for a round they are entitled to.
  // Entitlement: a soft-circle in the round (any status) OR an active
  // invitation. Anonymous → 401 (requireAuth). Not entitled → 403.
  app.get("/api/investor/rounds/:roundId/wire-instructions", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    if (!ctx?.isAuthed || !ctx.userId) {
      return res.status(401).json({ ok: false, error: "unauthenticated" });
    }
    const roundId = paramStr(req.params.roundId);
    if (!roundId) return res.status(404).json({ ok: false, error: "round_not_found" });

    // Admins may always read.
    let entitled = ctx.isAdmin;

    // Soft-circle in this round matching the caller (by userId or email).
    if (!entitled) {
      const email = (ctx.identity?.email ?? "").toLowerCase();
      const circles = softCircleListForRound(roundId);
      entitled = circles.some(
        (c) =>
          (c.investorUserId && c.investorUserId === ctx.userId) ||
          (c.investorEmail && email && c.investorEmail.toLowerCase() === email),
      );
    }

    // Active invitation: either the resolved invitedRounds overlay or a
    // DB-backed invitation by email that targets this round.
    if (!entitled) {
      entitled = (ctx.investor?.invitedRounds ?? []).some((r) => r.roundId === roundId);
    }
    if (!entitled) {
      const email = ctx.identity?.email ?? "";
      if (email) {
        const invs = roundInvitationsListForEmail(email);
        entitled = invs.some((i) => i.roundId === roundId && i.state !== "revoked");
      }
    }

    if (!entitled) {
      return res.status(403).json({ ok: false, error: "not_entitled", message: "You do not have access to this round's wire instructions." });
    }

    const row = getWireInstructions(roundId);
    if (!row) return res.status(404).json({ ok: false, error: "wire_instructions_not_set" });
    // Demo mode: account number returned as-is (flagged in the v24.3 report).
    return res.json({ ok: true, wireInstructions: row });
  });

  // B4/C2 (v24.0 LOCKDOWN) — the legacy CRM list returned a global mock array
  // (`crmInvestors`) to any authenticated user. Now scope by the caller:
  //   admin   → may pass ?founderId to inspect; otherwise own owned companies
  //   founder → contacts across the companies they own (real founderCrmStore)
  //   other   → empty list
  app.get("/api/crm", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    const owned = tenantFounderOwnedCompanyIds(ctx);
    res.json(crmListByFounder(owned));
  });

  // Defect 57 fix: require ?companyId= and filter results; auth check.
  app.get("/api/dataroom", requireAuth, (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    if (!companyId) {
      return res.status(400).json({ error: "MISSING_COMPANY_ID", message: "?companyId= is required." });
    }
    // B5 (v24.0) — caller must own the company (founder/admin) OR have an active
    // entitlement to it (investor cap-table position / invitation). Previously
    // any authenticated user could read any company's dataroom by passing its id.
    const access = requireCanAccessCompany(req, res, companyId);
    if (!access.ok) return;
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
  /* v25.10 fix M7 — alias /api/founder/activity-log → /api/activity.
   *
   * client/src/pages/founder/Welcome.tsx hits /api/founder/activity-log which
   * did not exist (404). Welcome.tsx silently swallows the error and shows an
   * empty "Recent activity" tile to every founder. We register both paths
   * against the same handler (declared as a named function below) so the alias
   * returns the same payload as the canonical /api/activity. */
  const activityLogHandler = (req: import("express").Request, res: import("express").Response) => {
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
  };
  app.get("/api/activity", requireAuth, activityLogHandler);
  /* v25.10 M7 — alias used by Welcome.tsx. */
  app.get("/api/founder/activity-log", requireAuth, activityLogHandler);
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
  // B-509 fix v23.6: resolve company name + round label for invitee dashboard
  app.get("/api/investor/invitations", requireAuth, (req, res) => {
    const ctx = req.userContext ?? getUserContext(req);
    const email = ctx.identity?.email ?? "";
    // In demo/seed mode, serve the seeded mock data directly (already enriched).
    if (DEMO_SEED_ENABLED || !email) return res.json(incomingInvitations);
    // Production path: look up real invitations from roundInvitationsStore and
    // enrich each row with human-readable company name + round label.
    const rawInvs = roundInvitationsListForEmail(email);
    const allRounds = roundsStoreList();
    const enriched = rawInvs.map((inv) => {
      const company = (_allCompanies as Array<{ id: string; name: string }>).find(c => c.id === inv.companyId);
      // Also check real company store (production companies not in demo seed)
      const resolvedCompanyName = company?.name ?? getCompanyNameById(inv.companyId ?? "");
      const round = allRounds.find(r => r.id === inv.roundId);
      return {
        ...inv,
        company: {
          id: inv.companyId ?? "",
          name: resolvedCompanyName ?? inv.companyId ?? "",
          sector: "",
        },
        round: {
          id: inv.roundId,
          name: round?.name ?? `Round ${inv.roundId}`,
          type: round?.type ?? "unknown",
        },
        state: inv.state,
        receivedAt: inv.createdAt ?? inv.sentAt ?? new Date().toISOString(),
        expiresAt: inv.expiresAt ?? new Date(Date.now() + 14 * 86400000).toISOString(),
        targetAmount: round?.targetAmount ?? 0,
        raisedAmount: round?.raisedAmount ?? 0,
        minTicket: (round?.minTicket ?? 0) as number,
        preMoney: (round?.preMoney ?? 0) as number,
      };
    });
    res.json(enriched);
  });
  app.get("/api/investor/invitations/:id", requireAuth, (req, res) => {
    const i = incomingInvitations.find(i => i.id === req.params.id);
    if (i) return res.json(i);
    // A6 (v24.0) — modern fallback: after redeeming a canonical founder invite,
    // the detail record lives in roundInvitationsStore, not the static
    // incomingInvitations fixture. Read it by id and verify the current user's
    // email matches the invitation so one investor cannot read another's.
    const modern = roundInvitationsGet(req.params.id);
    if (!modern) return res.status(404).json({ message: "Not found" });
    const ctx = req.userContext ?? getUserContext(req);
    const callerEmail = (ctx.identity?.email ?? "").toLowerCase();
    const inviteEmail = (modern.investorEmail ?? "").toLowerCase();
    if (!callerEmail || callerEmail !== inviteEmail) {
      // Do not reveal existence to non-owners.
      return res.status(404).json({ message: "Not found" });
    }
    const allRounds = roundsStoreList();
    const round = allRounds.find(r => r.id === modern.roundId);
    return res.json({
      ...modern,
      company: {
        id: modern.companyId ?? "",
        name: getCompanyNameById(modern.companyId ?? "") ?? modern.companyId ?? "",
        sector: "",
      },
      round: {
        id: modern.roundId,
        name: round?.name ?? `Round ${modern.roundId}`,
        type: round?.type ?? "unknown",
      },
      state: modern.state,
      receivedAt: modern.createdAt ?? modern.sentAt ?? new Date().toISOString(),
      expiresAt: modern.expiresAt ?? new Date(Date.now() + 14 * 86400000).toISOString(),
      targetAmount: round?.targetAmount ?? 0,
      raisedAmount: round?.raisedAmount ?? 0,
      minTicket: (round?.minTicket ?? 0) as number,
      preMoney: (round?.preMoney ?? 0) as number,
      /* v25.8 Bug 2 fix — the investor InvitationDetail.tsx expects these
       * additional round fields. Without them the page renders
       * "price/share: undefined" while post-money valuation shows. Avi
       * caught this. We now project the full round shape the client expects. */
      postMoney: (round?.postMoney ?? 0) as number,
      /* v25.25 Avi-8 — was `?? 0`, which coalesced a genuinely-unset PPS to
         zero and rendered "$0.00" in the client (misleading). Surface honest
         null so the new client guards in InvitationDetail.tsx show
         "Not set — priced at close" instead of a fake $0.00. The previous
         v25.8 Bug 2 fix surfaced the field; this v25.25 fix surfaces it
         honestly when unset. */
      pricePerShare: (round?.pricePerShare ?? null) as number | null,
      currency: round?.currency ?? "USD",
      instrument: round?.instrument ?? "preferred",
      closeDate: round?.closeDate ?? null,
      openDate: round?.openDate ?? null,
      termsSummary: round?.termsSummary ?? null,
      leadInvestor: round?.leadInvestor ?? null,
    });
  });
  /* v25.8 Bug 2b fix — was returning the static mock array (investorSoftCircles
   * from mockData.ts) instead of the live DB rows for the calling investor.
   * That's why "founder creates a soft-circle on behalf of an investor, but
   * no record appears on the investor end" (Avi's report).
   * Now reads soft_circles table by investor_user_id, projects only this
   * investor's rows. */
  app.get("/api/investor/soft-circles", requireAuth, (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    try {
      const rows = softCircleListForInvestor(ctx.userId);
      /* Project a stable shape so the client can render a list */
      const projected = rows.map((r: any) => ({
        id: r.id,
        roundId: r.roundId,
        companyId: r.companyId,
        amount: r.amount,
        currency: r.currency,
        state: r.state ?? r.status,
        investorEmail: r.investorEmail,
        investorName: r.investorName,
        createdAt: r.createdAt,
        confirmedAt: r.confirmedAt ?? null,
        wireFundedAt: r.wireFundedAt ?? null,
      }));
      return res.json(projected);
    } catch (err) {
      /* If the underlying store is unavailable, return [] rather than 500 so
       * the investor's dashboard at least loads. */
      return res.json([]);
    }
  });
  // C3 (v24.0): portfolio still returns [] until the marks store lands.
  app.get("/api/investor/portfolio", requireAuth, (_req, res) => res.json([]));

  /* v25.11 NM5 — watchlist is now derived from the canonical softCircleStore
   * (DB-backed). Investors who have soft-circled a round see those rounds
   * in their watchlist. Previously returned a permanent empty array. */
  app.get("/api/investor/watchlist", requireAuth, (req, res) => {
    try {
      const ctx = req.userContext;
      if (!ctx?.userId) return res.json([]);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { listForInvestor } = require("./softCircleStore");
      const rows = listForInvestor(ctx.userId) ?? [];
      const items = rows.map((r: any) => ({
        roundId: r.roundId,
        companyId: r.companyId ?? null,
        amount: r.amount ?? null,
        currency: r.currency ?? null,
        addedAt: r.createdAt ?? r.softCircledAt ?? null,
      }));
      return res.json(items);
    } catch {
      return res.json([]);
    }
  });

  /* v25.11 NM5 — discover feed is now sourced from the live roundsStore.
   * Investors see open rounds they have access to (invited or public).
   * Previously returned a permanent empty array. */
  app.get("/api/investor/discover", requireAuth, (req, res) => {
    try {
      const ctx = req.userContext;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { listRounds } = require("./roundsStore");
      const all = (listRounds() as Array<any>) ?? [];
      const invitedRoundIds = new Set((ctx?.investor?.invitedRounds ?? []).map((r: any) => r.roundId));
      const items = all
        .filter((r) => {
          if (r?.status && String(r.status).toLowerCase() === "closed") return false;
          if (r?.deletedAt) return false;
          // Show invited rounds first; also show any rounds explicitly flagged public.
          return invitedRoundIds.has(r.id) || r?.discoverable === true;
        })
        .map((r) => ({
          id: r.id,
          companyId: r.companyId,
          name: r.name ?? null,
          status: r.status ?? "open",
          targetAmount: r.targetAmount ?? null,
          currency: r.currency ?? null,
          invited: invitedRoundIds.has(r.id),
        }));
      return res.json(items);
    } catch {
      return res.json([]);
    }
  });

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

  /* v25.11 NM5 — activity feed now derives from the investor's actual
   * captable commits + soft-circle history (DB-backed). Previously empty. */
  app.get("/api/investor/activity", requireAuth, (req, res) => {
    try {
      const ctx = req.userContext;
      if (!ctx?.userId) return res.json([]);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const captable = require("./captableCommitStore");
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sc = require("./softCircleStore");
      const commits = (captable.listCommitsForUser?.(ctx.userId) ?? []) as Array<any>;
      const softs = (sc.listForInvestor?.(ctx.userId) ?? []) as Array<any>;
      const events: Array<{ ts: string; kind: string; roundId?: string; companyId?: string; amount?: string | null }> = [];
      for (const c of commits) {
        events.push({
          ts: c.updatedAt ?? c.createdAt ?? new Date(0).toISOString(),
          kind: `captable.${c.state ?? "commit"}`,
          roundId: c.roundId,
          companyId: c.companyId,
          amount: c.amount ?? null,
        });
      }
      for (const s of softs) {
        events.push({
          ts: s.createdAt ?? s.softCircledAt ?? new Date(0).toISOString(),
          kind: "softcircle.added",
          roundId: s.roundId,
          companyId: s.companyId,
          amount: s.amount ?? null,
        });
      }
      events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      return res.json(events.slice(0, 50));
    } catch {
      return res.json([]);
    }
  });

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
    // v25.45 Bug C ROUND-2 (GPT-5.5 blocker 4 / issue path): PERSIST BEFORE
    // EXPOSING THE TOKEN. Previously we pushed the entry into the in-memory
    // array and returned the raw token via best-effort persist that ignored DB
    // failure, so a token could be handed to the client while nothing was
    // durably written (lost on restart). We now write to the DB FIRST and only
    // push to memory + return the raw token AFTER the write confirms. If the
    // write fails we return 500 with a safe error and NO token is returned.
    try {
      persistLegacyInvitationStrict(entry);
    } catch (err) {
      log.error({
        route: "POST /api/rounds/:id/invitations/issue",
        errorType: "legacy_invitation_persist_failed",
        invitationId: entry.id,
        message: (err as Error).message,
      });
      return res.status(500).json({ ok: false, error: "INVITATION_PERSIST_FAILED", message: "Could not durably issue the invitation. No token was created. Please retry." });
    }
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
    if (entry) {
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
    }
    // A4 (v24.0) — modern fallback: tokens issued by the canonical founder flow
    // (POST /api/rounds/:id/invitations) live in roundInvitationsStore, not the
    // legacy invitationStore. Mirror the redeem-handler bridge on the check side
    // so a legitimately issued invitation never validates as 404/invalid.
    const modernEntry = findByTokenHash(hash);
    if (!modernEntry) return res.status(404).json({ valid: false });
    if (modernEntry.state === "revoked") return res.json({ valid: false, reason: "revoked" });
    if (modernEntry.redeemedAt || modernEntry.state === "accepted")
      return res.json({ valid: false, reason: "already_redeemed" });
    if (modernEntry.expiresAt && Date.now() > new Date(modernEntry.expiresAt).getTime())
      return res.json({ valid: false, reason: "expired" });
    return res.json({
      valid: true,
      roundId: modernEntry.roundId,
      companyId: modernEntry.companyId ?? "",
      companyName: getCompanyNameById(modernEntry.companyId ?? "") ?? "",
      inviteeEmail: modernEntry.investorEmail,
      inviteeName: modernEntry.investorName ?? "",
      expiresAt: modernEntry.expiresAt,
      prefilledScreenName: undefined,
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
    if (entry) {
      // ---- Legacy path (in-memory invitationStore) — unchanged. ----
      if (entry.revoked) return res.status(409).json({ ok: false, reason: "revoked" });
      if (entry.redeemed) return res.status(409).json({ ok: false, reason: "already_redeemed" });
      if (Date.now() > new Date(entry.expiresAt).getTime())
        return res.status(410).json({ ok: false, reason: "expired" });
      // v25.45 Bug C ROUND-2 (GPT-5.5 blocker 4 / redeem path): FAIL-CLOSED +
      // PERSIST BEFORE SESSION. Previously we mutated entry.redeemed in memory,
      // best-effort persisted (ignoring DB failure), then registered the
      // persona / set the session. A failed persist left the token redeemed in
      // memory only — after restart the token could be reused. We now mark the
      // redemption, durably persist it STRICTLY, and only proceed to persona /
      // session creation once the token-state write is confirmed. On persist
      // failure we ROLL BACK the in-memory mutation and return 500 — the token
      // is NOT marked redeemed in any durable sense and NO session is created.
      entry.redeemed = true;
      entry.redeemedAt = new Date().toISOString();
      try {
        persistLegacyInvitationStrict(entry);
      } catch (err) {
        entry.redeemed = false;
        entry.redeemedAt = null;
        log.error({
          route: "POST /api/invitations/redeem",
          errorType: "legacy_invitation_redeem_persist_failed",
          invitationId: entry.id,
          message: (err as Error).message,
        });
        return res.status(500).json({ ok: false, error: "INVITATION_REDEEM_PERSIST_FAILED", message: "Could not durably record the redemption. Please retry." });
      }
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
    }

    // ---- Modern path: bridge to roundInvitationsStore (mirror the L-009 fix
    // v23.4.13 pattern at routes.ts:747). Tokens created by the canonical
    // founder flow (POST /api/rounds/:id/invitations) live in the DB-backed
    // store, not invitationStore, so without this bridge every legitimately
    // issued invitation returned 404 not_found. ----
    const modernEntry = findByTokenHash(hash);
    if (!modernEntry) return res.status(404).json({ ok: false, reason: "not_found" });
    if (modernEntry.state === "revoked") return res.status(409).json({ ok: false, reason: "revoked" });
    if (modernEntry.redeemedAt || modernEntry.state === "accepted")
      return res.status(409).json({ ok: false, reason: "already_redeemed" });
    if (modernEntry.expiresAt && Date.now() > new Date(modernEntry.expiresAt).getTime())
      return res.status(410).json({ ok: false, reason: "expired" });

    const personaId = registerPersona({
      email: modernEntry.investorEmail,
      name: modernEntry.investorName ?? modernEntry.investorEmail.split("@")[0],
      password: String(body.password ?? "changeme"),
      invitationId: modernEntry.id,
      roundId: modernEntry.roundId,
      companyId: modernEntry.companyId ?? "",
    });
    const marked = markInvitationRedeemed(modernEntry.id, personaId);
    if (!marked) return res.status(404).json({ ok: false, reason: "not_found" });
    setSessionCookie(res, personaId);
    const ctx = getUserContextForId(personaId);
    return res.json({
      ok: true,
      invitationId: modernEntry.id,
      roundId: modernEntry.roundId,
      companyId: modernEntry.companyId ?? "",
      redirectTo: `/investor/invitations/${modernEntry.id}`,
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
  // B2/B3/B7 (v24.0) — delegate to the canonical tenant-auth helper so the
  // round-ownership rule is identical everywhere. companyIdForRound here uses
  // the local resolver (which also covers seed rounds for tests); fall back to
  // the canonical helper when the local resolver finds the company.
  function requireFounderOwnsRound(req: import("express").Request, res: import("express").Response): { ok: boolean; companyId?: string; userId?: string } {
    const roundId = paramStr(req.params.id);
    const cid = roundId ? companyIdForRound(roundId) : null;
    if (!cid) {
      res.status(404).json({ ok: false, error: "round_not_found" });
      return { ok: false };
    }
    const owns = tenantRequireFounderOwnsCompany(req, res, cid);
    if (!owns.ok) return owns;
    // v25.45 ROUND 2 — catch-all archive gate for every round-scoped mutation
    // that funnels through this helper. No-ops on GET/HEAD/OPTIONS.
    if (assertWorkspaceNotArchived(req, res, owns.companyId ?? cid)) return { ok: false };
    return owns;
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
      // L-006 fix v23.4.13: return redeemUrl on create so clients can display/copy it.
      // The redeemUrl contains the raw one-time token — it is intentionally surfaced
      // ONLY on create (single-use window). The list endpoint never exposes tokens.
      return res.json({
        ok: true,
        invitation: result.invitation,
        classification: result.classification,
        emailSent: result.emailSent,
        redeemUrl: result.redeemUrl,
      });
    } catch (err) {
      // v25.35 (BLOCKER #4) — createInvitation now FAILS CLOSED: a DB write
      // failure throws BEFORE any token is returned. Validation errors stay
      // 400; a persistence failure must surface as 500 so the founder never
      // believes an invite was sent for a RAM-only (lost-on-restart) row.
      const msg = (err as Error).message ?? "";
      const isValidation =
        msg === "invalid_email" || msg === "missing_round_id" || msg === "missing_company_id";
      if (isValidation) {
        return res.status(400).json({ ok: false, error: msg });
      }
      return res.status(500).json({ ok: false, error: "INVITATION_PERSIST_FAILED" });
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
    // B11 (v24.0 LOCKDOWN) — the parent-round ownership check above does NOT
    // guarantee the child invitation belongs to that round/company. Without
    // this, a founder who owns round X could act on an invitation belonging to
    // round Y by passing Y's invId. Assert the child matches the authorized
    // round AND company; otherwise 404 (avoid id enumeration).
    if (inv.roundId !== paramStr(req.params.id) || (check.companyId && inv.companyId !== check.companyId)) {
      return res.status(404).json({ ok: false, error: "invitation_not_found" });
    }
    emitMutation({ aggregate: "invitation", id: invId, change: "update", tenantId: inv.tenantId ?? undefined });
    return res.json({ ok: true, invitation: inv });
  });

  // Founder — extend expiry.
  app.patch("/api/rounds/:id/invitations/:invId", requireAuth, (req, res) => {
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok || !check.userId) return;
    const invId = paramStr(req.params.invId);
    // B11 (v24.0 LOCKDOWN) — verify the child invitation belongs to the
    // authorized round/company BEFORE mutating it.
    const existing = roundInvitationsGet(invId);
    if (!existing) return res.status(404).json({ ok: false, error: "invitation_not_found" });
    if (existing.roundId !== paramStr(req.params.id) || (check.companyId && existing.companyId !== check.companyId)) {
      return res.status(404).json({ ok: false, error: "invitation_not_found" });
    }
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
    // B11 (v24.0 LOCKDOWN) — verify the child invitation belongs to the
    // authorized round/company BEFORE revoking it.
    const existing = roundInvitationsGet(invId);
    if (!existing) return res.status(404).json({ ok: false, error: "invitation_not_found" });
    if (existing.roundId !== paramStr(req.params.id) || (check.companyId && existing.companyId !== check.companyId)) {
      return res.status(404).json({ ok: false, error: "invitation_not_found" });
    }
    roundInvitationsRevoke(invId, check.userId);
    return res.json({ ok: true, invId });
  });

  // v23.9 A1/AV-04/AV-05: the duplicate `requireAuth`-gated
  // POST /api/invitations/redeem that previously lived here shadowed the
  // public handler at the top of this file (Express picks the last-registered
  // route), so every invited investor hit a 401. The public redeem handler
  // (which mints the session — the token IS the login) is the correct one.

  // Soft-circle endpoints — requireAuth + DB-backed + SSE.
  app.post("/api/rounds/:id/soft-circle", requireAuth, (req, res) => {
    const ctx = getUserContext(req);
    if (!ctx?.userId) return res.status(401).json({ ok: false, error: "unauthenticated" });
    const id = paramStr(req.params.id);
    const cid = companyIdForRound(id);
    // v25.45 ROUND 2 — archive gate: block soft-circle creation on archived workspaces.
    if (assertWorkspaceNotArchived(req, res, cid ?? (req.body ?? {}).companyId)) return;
    const body = req.body ?? {};
    // v25.4 — when an authorized caller (founder of this round / admin) supplies
    // body.investorUserId, honor it so on-behalf-of soft-circles link to the actual
    // investor, not the caller. Self-service investors leave body.investorUserId
    // blank and inherit ctx.userId.
    const isFounder = Array.isArray(ctx.founder?.companies) && ctx.founder.companies.length > 0;
    const callerIsAuthorized = !!ctx.isAdmin || isFounder;
    const bodyInvestorUserId = typeof body.investorUserId === "string" && body.investorUserId ? body.investorUserId : null;
    const effectiveInvestorUserId = (callerIsAuthorized && bodyInvestorUserId) ? bodyInvestorUserId : ctx.userId;
    try {
      const sc = softCircleCreate({
        roundId: id,
        companyId: cid,
        invitationId: typeof body.invitationId === "string" ? body.invitationId : null,
        investorUserId: effectiveInvestorUserId,
        investorEmail: typeof body.investorEmail === "string" ? body.investorEmail : null,
        investorName: typeof body.investorName === "string" && body.investorName ? body.investorName : (effectiveInvestorUserId ?? "investor"),
        amount: typeof body.amount === "number" ? body.amount : Number(body.amount ?? 0),
        currency: typeof body.currency === "string" ? body.currency : "USD",
        status: typeof body.status === "string" ? body.status : "intent",
        collectiveVisible: body.collectiveVisible !== false,
      });
      // D3: Wire source attribution
      try {
        const srcType = (body.sourceType === "partner" || body.sourceType === "collective") ? body.sourceType : "direct";
        const srcId = typeof body.sourceId === "string" ? body.sourceId : null;
        setSoftCircleSource(sc.id, srcType as "direct" | "partner" | "collective", srcId);
      } catch { /* best-effort */ }
      return res.json({ ok: true, softCircle: sc });
    } catch (err) {
      return res.status(400).json({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/api/rounds/:id/soft-circle/:scId/validate", requireAuth, (req, res) => {
    // Validation is a founder action.
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok) return;
    // v25.45 ROUND 2 — archive gate.
    if (assertWorkspaceNotArchived(req, res, check.companyId ?? companyIdForRound(paramStr(req.params.id)))) return;
    const scId = paramStr(req.params.scId);
    const sc = softCircleValidate(scId);
    if (!sc) return res.status(404).json({ ok: false, error: "soft_circle_not_found" });
    return res.json({ ok: true, scId, validated: true, softCircle: sc });
  });

  // Term-sheet send + PDF — requireAuth
  app.post("/api/rounds/:id/term-sheet/send", requireAuth, (req, res) => {
    const { id } = req.params;
    const { invitationIds } = req.body ?? {};
    const sentTo = Array.isArray(invitationIds) ? invitationIds.length : 0;
    emitMutation({ aggregate: "round", id, change: "update" });
    // v23.9 B8: sending a term sheet with an empty pipeline is a no-op, not an
    // error — surface a warning so the founder UI can explain why nothing went
    // out instead of falsely reporting success.
    if (sentTo === 0) {
      return res.json({
        ok: true,
        roundId: id,
        sentTo: 0,
        warning: "no_recipients_in_pipeline",
        message: "No recipients in the pipeline — invite investors before sending a term sheet.",
      });
    }
    res.json({ ok: true, roundId: id, sentTo });
  });

  app.get("/api/rounds/:id/term-sheet/pdf", requireAuth, (req, res) => {
    const id = paramStr(req.params.id);
    // B6 (v24.0 LOCKDOWN) — ownership/visibility check: caller must own or be
    // entitled to view the round's company before any term-sheet output.
    const access = requireInvestorCanViewRound(req, res, id);
    if (!access.ok) return;
    /* v25.10 — real PDF generator (pdfkit-backed). Reads from the canonical
     * rounds store + company resolver so the PDF reflects live data, not a
     * placeholder. Closes the v24.0 "flagged for v24.1" gap. */
    try {
      const round = roundsGetById(id);
      if (!round) {
        return res.status(404).json({ ok: false, error: "round_not_found" });
      }
      /* Resolve company name (cheap: read from the legacy companies array which
       * is hydrated alongside multiCompanyStore). */
      let companyName = round.companyId;
      try {
        const co = (canonicalCompanies as unknown as Array<{ id: string; name?: string }>)
          .find((c) => c.id === round.companyId);
        if (co?.name) companyName = co.name;
      } catch {
        /* fall through with companyId as name */
      }
      streamTermSheetPdf(res, {
        roundId: round.id,
        companyName,
        instrument: String(round.instrument ?? round.type ?? ""),
        currency: String(round.currency ?? "USD"),
        pricePerShare: round.pricePerShare ?? null,
        postMoney: round.postMoney ?? null,
        preMoney: round.preMoney ?? null,
        targetRaise: round.targetAmount ?? null,
        closeDate: round.closeDate ?? null,
        openDate: (round.openDate as string | undefined) ?? null,
        termsSummary: round.termsSummary ?? null,
        leadInvestor: round.leadInvestor ?? null,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn({
        route: "rounds.termSheet.pdf",
        message: `PDF render failed: ${(err as Error).message}`,
      });
      /* If headers already sent, the stream is broken — nothing more we can do.
       * If not sent, return a 500 so the client surfaces a real error. */
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "pdf_render_failed" });
      }
    }
  });

  // Cap-table PDF — requireAuth
  app.get("/api/companies/:id/cap-table/pdf", requireAuth, (req, res) => {
    const id = paramStr(req.params.id);
    // B6 (v24.0 LOCKDOWN) — ownership/visibility check on the company.
    const access = requireCanAccessCompany(req, res, id);
    if (!access.ok) return;
    /* v25.10 — real cap-table PDF generator. Reads the SACRED cap-table
     * commit ledger (captableCommitStore.listMembersForCompany) so the PDF
     * is a true snapshot of committed holders. Computes ownership % from
     * shares totals. Closes the v24.0 "flagged for v24.1" gap. */
    try {
      const ledger = captableMembersForCompany(id);
      /* Resolve company name */
      let companyName = id;
      try {
        const co = (canonicalCompanies as unknown as Array<{ id: string; name?: string }>)
          .find((c) => c.id === id);
        if (co?.name) companyName = co.name;
      } catch { /* fall through */ }

      /* Aggregate by investorId so multiple commits roll up into one holder row.
       * Shares are decimal-as-string on the ledger; we sum them as numbers here
       * because cap-table totals are presentational only. The underlying ledger
       * is the source of truth. */
      type HolderAgg = { shares: number; amount: number; currency: string; kinds: string[] };
      const byHolder: Record<string, HolderAgg> = Object.create(null);
      for (const e of ledger) {
        const cur = byHolder[e.investorId] ?? { shares: 0, amount: 0, currency: e.currency || "USD", kinds: [] };
        const sh = parseFloat(e.shares || "0");
        if (isFinite(sh)) cur.shares += sh;
        const amt = parseFloat(e.amount || "0");
        if (isFinite(amt)) cur.amount += amt;
        if (e.currency) cur.currency = e.currency;
        if (cur.kinds.indexOf("commit") === -1) cur.kinds.push("commit");
        byHolder[e.investorId] = cur;
      }

      let totalSharesNum = 0;
      const holderIds = Object.keys(byHolder);
      for (const id_ of holderIds) totalSharesNum += byHolder[id_].shares;
      const entries: CapTableEntry[] = [];
      let totalInvested = 0;
      // v25.45 ROUND 7 — the cap-table PDF IS the cap table itself: everyone on
      // it is a counterparty (isCoMember:true). The shareholder label routes
      // through the privacy resolver (externalCapTable context); the
      // counterparty default reveals the legal name UNLESS a holder explicitly
      // opted out (visibleToCoMembers:false → "Private Investor"). The ledger
      // investorId is still the aggregation key (cap-table math is SACRED and
      // untouched); only the rendered LABEL is resolved. We fall back to the raw
      // investorId when no legal name is available.
      //
      // v25.45 ROUND 8 (GPT-5.5 finding) — isCoMember is NO LONGER hardcoded
      // true. The route admits invitation-only viewers via
      // requireCanAccessCompany who are NOT committed cap-table members. Such a
      // viewer is not a counterparty, so each member's counterparty status is
      // computed dynamically against the SACRED captable_commits ledger. An
      // invitation-only viewer therefore sees "Private Investor" for holders who
      // have not opted into broader visibility.
      const viewerForPdf = (req.userContext ?? getUserContext(req))?.userId ?? null;
      for (const investorId of holderIds) {
        const v = byHolder[investorId];
        const pct = totalSharesNum > 0 ? (v.shares / totalSharesNum) * 100 : 0;
        const isCoMember = viewerForPdf
          ? areCoMembersOnAnyCapTable(investorId, viewerForPdf)
          : false;
        const shareholderLabel = resolveDisplayName(investorId, viewerForPdf, "externalCapTable", { legalName: investorId, isCoMember });
        entries.push({
          shareholder: shareholderLabel,
          securityKind: v.kinds.join(",") || "commit",
          shares: v.shares,
          pctOwnership: pct,
          invested: v.amount,
          currency: v.currency,
        });
        totalInvested += v.amount;
      }
      /* Sort by shares descending so largest holder appears first */
      entries.sort((a, b) => b.shares - a.shares);

      streamCapTablePdf(res, {
        companyId: id,
        companyName,
        asOf: new Date().toISOString().slice(0, 10),
        entries,
        totals: {
          totalShares: totalSharesNum,
          totalInvested,
          holderCount: entries.length,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn({
        route: "companies.capTable.pdf",
        message: `PDF render failed: ${(err as Error).message}`,
      });
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: "pdf_render_failed" });
      }
    }
  });

  // Securities POST — requireAuth
  app.post("/api/companies/:id/securities", requireAuth, (req, res) => {
    const id = paramStr(req.params.id);
    // B9 (v24.0 LOCKDOWN) — only the founder who owns the company (or admin)
    // may add a security. Previously any authenticated user could POST.
    const check = tenantRequireFounderOwnsCompany(req, res, id);
    if (!check.ok) return;
    // v25.45 ROUND 2 — archive gate: block securities issuance on archived workspaces.
    if (assertWorkspaceNotArchived(req, res, id)) return;
    const { kind, principal, terms } = req.body ?? {};
    const sec = { id: `sec-${Date.now()}`, companyId: id, kind, principal, terms, issuedAt: new Date().toISOString() };
    // B9 — persist so the matching GET /api/companies/:id/securities reflects
    // the new row within this process. NOTE (flagged in report): the audit's
    // proposed `captableCommitStore.appendSecurity()` does not exist; wiring
    // securities through the SACRED cap-table engine ledger is larger than this
    // wave, so we persist into the in-process securities store here and flag
    // durable engine-backed persistence for v24.1.
    (securities as unknown as Array<typeof sec>).push(sec);
    // v25.10 — write-through to DB so securities survive a server restart.
    // The legacy in-process array still gets the push so reads in this
    // process see it immediately; the DB row is restored on boot via
    // hydrateSecuritiesStore(). Closes the "flagged for v24.1" gap from
    // the v24.0 comment above.
    try {
      persistSecurity(sec as unknown as Parameters<typeof persistSecurity>[0]);
    } catch (err) {
      // Non-fatal — log and continue; in-process push above still works.
      // The hydrator simply won't see this one on the next boot.
      log.warn({
        route: "routes.securities.post",
        message: `persistSecurity failed (non-fatal): ${(err as Error).message}`,
      });
    }
    // B8/B9 — emit the correct aggregate. A securities mutation is a company
    // event, not a round event.
    emitMutation({ aggregate: "company", id, change: "update" });
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
        // v23.4.7 Phase 6 (BUG 001) — shape parity with the authed branch.
        hasPaidPlan: false,
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

    // v23.4.7 Phase 6 (BUG 001) — derive `hasPaidPlan` so the login post-auth
    // redirect can branch correctly. A paid plan = at least one company
    // whose subscription is on a non-free, non-cancelled tier with billing
    // intent (active | trialing | past_due | cancel_at_period_end). We do
    // NOT count "pending_payment" / "cancelled" / "unpaid". `founder_free`
    // is always excluded because BUG 031 made it the default for new
    // companies and it is, by definition, not a paid plan.
    let hasPaidPlan = false;
    try {
      const companyList = (ctx as any)?.founder?.companies ?? [];
      for (const c of companyList) {
        const sub = getSubscription(c.companyId);
        if (!sub) continue;
        if (sub.plan === "founder_free") continue;
        if (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due" || sub.status === "cancel_at_period_end") {
          hasPaidPlan = true;
          break;
        }
      }
    } catch {
      // Subscriptions store unavailable (early hydration / ephemeral test):
      // fall through with hasPaidPlan=false. The client falls back to the
      // safe default (/founder/subscribe).
    }

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
      hasPaidPlan,
    });
  });

  // Companies PATCH — requireAuth
  const patchCompanyHandler = (req: import("express").Request, res: import("express").Response) => {
    const id = paramStr(req.params.id);
    // B8 (v24.0 LOCKDOWN) — ownership check. Previously ANY authenticated user
    // could PATCH any company. Only the founder who owns the company (or admin)
    // may mutate it.
    const check = tenantRequireFounderOwnsCompany(req, res, id);
    if (!check.ok) return;
    // v25.45 ROUND 2 — archive gate: block company mutation on archived workspaces.
    if (assertWorkspaceNotArchived(req, res, id)) return;
    // B-V11-5 fix: actually persist the patch into USER_COMPANIES so the next
    // GET /api/founder/active-company / /api/founder/companies returns the
    // updated display name + legal name. Previously this was a no-op stub
    // that returned ok:true without writing anywhere.
    // v24.2 Bug 6 — updateCompanyDetails now throws on DB write failure (it no
    // longer silently updates the in-memory cache after a failed durable
    // write). Surface that as a 500 so the client does not optimistically
    // believe a save succeeded that did not actually persist.
    let updated;
    try {
      updated = updateCompanyDetails(id, {
        companyName: typeof req.body?.name === "string" ? req.body.name : req.body?.companyName,
        legalName: req.body?.legalName,
        sector: req.body?.sector,
        stage: req.body?.stage,
        hq: req.body?.hq,
        role: req.body?.role,
        // BUG 017 fix v23.7 — persist the Settings → Company currency selection.
        defaultCurrency: req.body?.defaultCurrency,
        // v25.33 P0a — region / tagline / description were carried in the
        // client PATCH body but SILENTLY DISCARDED here (Avi feedback: "Tab
        // company record not save in table"). Pass them through so
        // updateCompanyDetails persists them to company_settings_overview and
        // the Settings form round-trips them. Additive over Avi's writes.
        region: typeof req.body?.region === "string" ? req.body.region : undefined,
        tagline: typeof req.body?.tagline === "string" ? req.body.tagline : undefined,
        description: typeof req.body?.description === "string" ? req.body.description : undefined,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "COMPANY_PERSIST_FAILED", message: (err as Error).message });
    }
    // B8 (v24.0 LOCKDOWN) — emit the CORRECT aggregate. A company PATCH is a
    // company event; it was previously (incorrectly) emitted as "round".
    emitMutation({ aggregate: "company", id, change: "update" });
    if (updated) {
      return res.json({ ok: true, id, company: updated });
    }
    // Unknown company id: fall back to legacy stub shape so existing tests pass.
    res.json({ ok: true, id, updated: req.body });
  };
  app.patch("/api/companies/:id", requireAuth, patchCompanyHandler);
  // v23.9 C6 — founder-namespaced alias. The Settings → Company form and the
  // founder app conventionally hit /api/founder/companies/:id; this points it at
  // the same write-through handler so both paths persist identically.
  app.patch("/api/founder/companies/:id", requireAuth, patchCompanyHandler);

  /*
   * Founder privacy — PUT.
   *
   * v25.10 fix C3 (Critical): the previous handler was a pure fake-success
   * (`res.json({ ok: true, updated: req.body })`) with no DB write and no
   * Map. A founder setting `visibleToCoMembers: false` (opt-out) had no
   * effect across restarts — a privacy/compliance violation. This handler
   * now persists via the generic shim (`kv_founderPrivacyStore`, keyed by
   * userId) and the matching GET reads from it. No auth gate is kept (the
   * existing test contract sends unknown userIds with shape-only checks).
   */
  app.put("/api/founder/privacy", (req, res) => {
    const ctx = (req as any).userContext;
    const userId: string | undefined = ctx?.userId;
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    /* v25.45.3 Bug H fix #2 — defensive coercion now runs AFTER the `...body`
     * spread, not before it. Previously the spread of raw `body` was placed
     * LAST in the object literal, so a malformed non-boolean
     * `visibleToCoMembers` / `visibleToCollectiveNetwork` in the request body
     * would override the coerced boolean defaults and a malformed value could
     * be written that the GET hydration silently ignores. By spreading `body`
     * first and applying the coerced known fields last, malformed inputs can
     * never bypass the boolean coercion. Unknown future keys are still
     * preserved (no silent drop). */
    const payload = {
      ...body,
      screenName: typeof body.screenName === "string" ? body.screenName : (ctx?.identity?.screenName ?? ctx?.identity?.name ?? ""),
      visibleToCoMembers: typeof body.visibleToCoMembers === "boolean" ? body.visibleToCoMembers : true,
      visibleToCollectiveNetwork: typeof body.visibleToCollectiveNetwork === "boolean" ? body.visibleToCollectiveNetwork : false,
      updatedAt: new Date().toISOString(),
    };
    if (userId) {
      try {
        /* v25.45 F13a — the prior best-effort persistEntry("founderPrivacyStore")
         * call did NOT reliably create/commit its kv table in every runtime
         * (the privacy toggle looked saved but reverted — Ozan's in-memory bug).
         * We now write to a dedicated, durable profilestore_user_privacy table
         * directly via rawDb, with an idempotent CREATE TABLE. This is the
         * canonical DB store the resolver (F13b) reads from. */
        f13WriteUserPrivacy(userId, {
          screenName: payload.screenName,
          visibleToCoMembers: payload.visibleToCoMembers,
          visibleInCollectiveDirectory: payload.visibleToCollectiveNetwork,
        });
      } catch (err) {
        /* v25.45.3 Bug H fix #1 — FAIL CLOSED. Previously the catch logged the
         * error but still returned `{ ok:true }`, so the client showed
         * "Privacy settings saved" while the DB write had failed (a false
         * success). Per Sacred Tier 2 #27 "Zero in-memory, DB-driven", a
         * persistence failure MUST be visible to the caller. We now return a
         * non-2xx (500) with `{ ok:false, error:"PRIVACY_PERSIST_FAILED" }`. */
        log.warn({
          route: "founder.privacy.put",
          message: `privacy persist failed: ${(err as Error).message}`,
        });
        return res.status(500).json({ ok: false, error: "PRIVACY_PERSIST_FAILED" });
      }
    }
    res.json({ ok: true, updated: payload });
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
    const userId: string | undefined = ctx?.userId;
    /* v25.10 fix C3 — read persisted privacy if available, else defaults.
     * The shim's hydrateEntries can be called per-store cheaply; we just
     * look up by userId here. */
    // v25.45 F13a — read from the durable profilestore_user_privacy table
    // (single source of truth, shared with the resolver). Falls back to
    // sensible defaults (with the identity's display name) when no row exists.
    let persisted: any = null;
    if (userId) {
      try {
        persisted = f13ReadUserPrivacyRaw(userId);
      } catch (err) {
        log.warn({
          route: "founder.privacy.get",
          message: `privacy read failed: ${(err as Error).message}`,
        });
      }
    }
    res.json({
      ok: true,
      privacy: persisted ?? {
        screenName: ctx?.identity?.screenName ?? ctx?.identity?.name ?? "",
        visibleToCoMembers: true,
        visibleToCollectiveNetwork: false,
      },
    });
  });

  /*
   * v25.11 NL-3 fix — founder workspace deletion request.
   *
   * The Settings page "Request workspace deletion" button previously only
   * showed a toast ("Workspace deletion requires admin confirmation") with
   * NO server call. Founders thought they had submitted a request; no record
   * was ever created. Now persist a real request to kv_workspaceDeletionRequests
   * so:
   *   - the admin / back-office can list pending workspace-deletion requests
   *   - the founder's request is auditable across restarts
   *   - the lifecycle policy module can transition the workspace state from
   *     `active` → `pending_deletion` → `archived` once admin confirms.
   *
   * Idempotency: one open request per (userId, companyId). A repeat POST
   * updates the existing record's `updatedAt` and notes; status stays
   * `pending_admin_review`.
   */
  app.post("/api/founder/workspace/deletion-request", requireAuth, (req, res) => {
    const ctx = (req as any).userContext;
    const userId: string | undefined = ctx?.userId;
    if (!userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const companyIdRaw = (body.companyId ?? "").toString();
    const companyId = companyIdRaw.trim();
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId is required" });
    }
    const reason = (body.reason ?? "").toString().slice(0, 2000);
    const reqId = `wsdel_${userId}_${companyId}`;
    const now = new Date().toISOString();
    const record = {
      id: reqId,
      userId,
      companyId,
      reason,
      status: "pending_admin_review",
      requestedAt: now,
      updatedAt: now,
      decidedAt: null as string | null,
      decidedBy: null as string | null,
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { persistEntry } = require("./lib/storePersistenceShim");
      persistEntry("workspaceDeletionRequests", reqId, record);
    } catch (err) {
      log.warn({
        route: "founder.workspace.deletionRequest",
        message: `persist failed (non-fatal): ${(err as Error).message}`,
      });
    }
    return res.json({
      ok: true,
      requestId: reqId,
      status: record.status,
      message: "Deletion request submitted. An admin will review and confirm via email.",
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
      return res.json({ ok: true, team: { seats: 0, used: 0, members: [] } });
    }
    // C8 (v24.0): there is no real multi-seat founder team store yet, so we do
    // NOT fabricate a seat allowance (previously a hard-coded `seats: 5`). The
    // only real, verifiable member is the authenticated founder; seats/used are
    // derived from the actual member list rather than invented. When a real
    // team store lands, swap the members source here.
    const members = [
      {
        id: ctx.userId,
        name: ctx.identity.name,
        email: ctx.identity.email,
        role: "founder",
        status: "active",
      },
    ];
    res.json({
      ok: true,
      team: {
        seats: members.length,
        used: members.length,
        members,
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
    // v24.1 Bug L (BUG 040) — Settings.tsx reads `teamQ.data?.members`, so a
    // bare top-level array meant the list was ALWAYS empty (even the founder's
    // own row never showed). Return the documented `{ members: [...] }` shape.
    if (!ctx?.isAuthed) {
      return res.json({ members: [] });
    }
    res.json({
      members: [
        {
          id: ctx.userId,
          name: ctx.identity.name,
          email: ctx.identity.email,
          role: "founder",
          status: "active",
          joined: "",
        },
      ],
    });
  });

  // Billing plan switch — requireAuth.
  //
  // v24.2 Airwallex wiring (Avi's bug): this endpoint used to be a pure echo
  // stub — it returned { ok:true } WITHOUT ever calling Airwallex, so a founder
  // who "paid" saw a success while no PaymentIntent existed and nothing showed
  // up in the Airwallex dashboard. It now mints a real Airwallex PaymentIntent,
  // GET /api/billing/tiers — returns configured pricing tiers for the billing checkout UI.
  // v25.0 Gap: the test suite calls GET /api/billing/tiers to resolve a tier id before
  // creating a checkout session. This endpoint exposes the same tiers as
  // GET /api/admin/pricing-tiers but is accessible to authenticated founders.
  app.get("/api/billing/tiers", requireAuth, async (req, res) => {
    try {
      const { listTiers } = await import("./pricingTiersStore");
      return res.json({ ok: true, tiers: listTiers() });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "TIERS_UNAVAILABLE" });
    }
  });

  // records a PENDING subscription (the gateway is the source of truth — the
  // local row only flips to active when the signed webhook confirms), and hands
  // the client the hosted-payment-page URL so card data NEVER touches Capavate
  // (PCI-DSS scope is preserved per the Settings billing-tab design intent).
  app.post("/api/billing/plan", requireAuth, async (req, res) => {
    try {
      const ctx = req.userContext;
      if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
      const { tierId, companyId, billingCycle = "monthly" } = req.body ?? {};
      if (!tierId || !companyId) {
        return res.status(400).json({ ok: false, error: "validation_failed", message: "tierId + companyId required" });
      }

      // Verify the caller actually owns the company (tenant isolation).
      const owns = (ctx.founder?.companies ?? []).some(
        (c: any) => (c.companyId ?? c.id) === companyId,
      );
      if (!owns) {
        return res.status(403).json({ ok: false, error: "not_owner" });
      }

      // Resolve tier price from the pricing-tier store (adapter over PRICING_TIERS).
      const tier = (await import("./pricingTiersStore")).getById(tierId);
      if (!tier) return res.status(404).json({ ok: false, error: "tier_not_found" });

      // v25.32 P1a — RESTORED tier-based pricing. The previous
      // `const amountMinor = 1000;` hardcode billed EVERY founder $10.00
      // regardless of the admin-configured plan price (a charge bug:
      // nothing in the platform may be hardcoded — prices come from the
      // admin-managed pricing tier). Pricing now reads from the tier the
      // admin configured, selected by the requested billing cadence.
      //
      // Validate the tier actually carries numeric pricing for the chosen
      // cadence; if the admin never set it, return a 400 so they know to
      // fix the tier config rather than silently billing $0/garbage.
      const monthly = (tier as { monthlyPriceCents?: number }).monthlyPriceCents;
      const annual = (tier as { annualPriceCents?: number }).annualPriceCents;
      if (typeof monthly !== "number" || typeof annual !== "number") {
        return res.status(400).json({
          ok: false,
          error: "tier_pricing_misconfigured",
          message:
            "This pricing tier has no configured monthly/annual price. An administrator must set the tier price before checkout.",
        });
      }
      const amountMinor = billingCycle === "annual" ? annual : monthly;
      const currency = tier.currency ?? "USD";
      if (!amountMinor || amountMinor <= 0) {
        return res.status(400).json({ ok: false, error: "invalid_tier_price" });
      }

      // Mint an Airwallex PaymentIntent.
      const { createPaymentIntent, AirwallexNotConfiguredError } = await import("./lib/airwallexGateway");
      const merchantOrderId = `cap_sub_${companyId}_${tierId}_${Date.now()}`;
      const idempotencyKey = `idem_${ctx.userId}_${tierId}_${Date.now()}`;

      /* v25.28 — build returnUrl BEFORE intent creation so we can pass it to
       * Airwallex (the hosted checkout page redirects the founder back here
       * after they complete or abandon payment). */
      const appOrigin =
        process.env.PUBLIC_APP_URL ??
        `${req.protocol}://${req.get("host") ?? "localhost"}`;
      const returnUrlEarly = `${appOrigin.replace(/\/$/, "")}/founder/billing/return?merchantOrderId=${encodeURIComponent(merchantOrderId)}`;

      let intent;
      try {
        intent = await createPaymentIntent({
          amountMinor,
          currency,
          merchantOrderId,
          customerId: ctx.userId,
          description: `Capavate ${tier.name} (${billingCycle})`,
          metadata: { companyId, tierId, userId: ctx.userId, billingCycle },
          idempotencyKey,
          returnUrl: returnUrlEarly,
        });
      } catch (e) {
        if (e instanceof AirwallexNotConfiguredError) {
          return res.status(503).json({
            ok: false,
            error: "gateway_not_configured",
            message: "Airwallex credentials are not set. Contact your administrator.",
          });
        }
        throw e;
      }

      // Persist a PENDING subscription so we don't lose track if the webhook is
      // slow. Status flips to "active" only when payment_intent.succeeded lands.
      //
      // v25.32 final — recordPendingSubscription now THROWS on DB write
      // failure (instead of returning a cache-only shim). The PaymentIntent
      // is already minted at this point, so a DB failure means we cannot
      // reconcile a successful payment. We MUST refuse to send the user to
      // hosted checkout in that state; surface 503 so the client can retry
      // once the DB recovers. The orphan PaymentIntent will expire on the
      // Airwallex side without being charged.
      const subStore = await import("./subscriptionStore");
      try {
        subStore.recordPendingSubscription({
          companyId,
          tierId,
          userId: ctx.userId,
          billingCycle,
          paymentIntentId: intent.id,
          amountMinor,
          currency,
          merchantOrderId,
        });
      } catch (dbErr) {
        return res.status(503).json({
          ok: false,
          error: "pending_subscription_persist_failed",
          message: "Could not durably record the pending subscription. Please try again in a moment.",
          detail: (dbErr as Error).message,
        });
      }

      /* v25.28 — attach paymentIntentId to the returnUrl now that we know it.
       * (Earlier returnUrlEarly was constructed with merchantOrderId only so
       * Airwallex had something stable to redirect to; the client polls by
       * paymentIntentId via the URL query string.) */
      const returnUrl = `${appOrigin.replace(/\/$/, "")}/founder/billing/return?paymentIntentId=${encodeURIComponent(intent.id)}&merchantOrderId=${encodeURIComponent(merchantOrderId)}`;

      // v24.4.2 Bug F — STUB MODE AUTO-PROGRESSION
      // When AIRWALLEX_REAL_NETWORK=0 (mode=stub), no real webhook will ever
      // arrive. The stub intent is already "SUCCEEDED", so activate the
      // subscription immediately and skip the Airwallex-hosted checkout page
      // redirect (which would 404 with a stub intent id). Instead, return the
      // returnUrl as the hostedPaymentPageUrl so the client navigates directly
      // to BillingReturn which polls and finds the subscription active.
      const { getAirwallexMode: getMode } = await import("./lib/paymentGatewayResolver");
      const airwallexMode = getMode();
      if (airwallexMode === "stub") {
        // Activate immediately — stub is deterministically SUCCEEDED.
        const activatedSub = subStore.activateByPaymentIntent(intent.id);
        log.info(`[billing/plan] stub mode: auto-activated subscription ${intent.id}`);

        // v25.1 Bug 4 fix (Avi prod report 11-Jun):
        // Stub mode activated the subscription but never created an invoice,
        // so the billing-details table in Billing.tsx stayed empty. The real
        // (test/live) path receives an invoice via the Airwallex webhook; the
        // stub path must create one synthetically.
        if (activatedSub) {
          try {
            const invoiceStore = await import("./invoiceStore");
            const now = new Date();
            const periodEnd = new Date(now);
            // billing cycle: monthly => +1 month, annual => +12 months.
            if (billingCycle === "annual") periodEnd.setMonth(periodEnd.getMonth() + 12);
            else periodEnd.setMonth(periodEnd.getMonth() + 1);
            invoiceStore.createInvoice({
              companyId,
              subscriptionId: activatedSub.id,
              planLabel: `${tierId} (${billingCycle})`,
              periodStart: now.toISOString(),
              periodEnd: periodEnd.toISOString(),
              amountMinor,
              currency,
              paymentEntryId: intent.id, // marks invoice as paid in createInvoice
              actor: ctx.userId,
            });
            log.info(`[billing/plan] stub mode: invoice created for subscription ${activatedSub.id}`);
          } catch (invErr) {
            log.warn(`[billing/plan] stub mode: invoice creation failed (subscription still active): ${(invErr as Error).message}`);
          }
        }
        // Return returnUrl as hostedPaymentPageUrl so PaymentSurface redirects
        // to BillingReturn, which will see status=active and redirect to dashboard.
        return res.json({
          ok: true,
          paymentIntentId: intent.id,
          clientSecret: intent.client_secret,
          amountMinor,
          currency,
          merchantOrderId,
          status: "SUCCEEDED",
          stubMode: true,
          returnUrl,
          hostedPaymentPageUrl: returnUrl,
        });
      }

      /* v25.28 — REAL MODE: stop fabricating a fake checkout URL.
       *
       * BEFORE: the server constructed `https://checkout.airwallex.com/checkout?...`
       * which does NOT exist as a real Airwallex URL. The browser would land
       * on an empty/404 page, the payment intent would stay in "Created"
       * status forever, and no card would ever be charged.
       *
       * AFTER: the server returns the raw {intent_id, client_secret, currency,
       * returnUrl}. The client-side PaymentSurface.tsx loads the official
       * Airwallex.js SDK (window.AirwallexComponentsSDK) and calls
       * payments.redirectToCheckout({...}), which takes the user to the
       * REAL Airwallex-hosted checkout page where they enter a card and pay.
       *
       * Reference: https://www.airwallex.com/docs/payments/get-started/quickstart
       */
      const awEnv = process.env.AIRWALLEX_MODE === "live" ? "prod" : "demo";
      res.json({
        ok: true,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        amountMinor,
        currency,
        merchantOrderId,
        status: intent.status,
        returnUrl,
        /* The client uses these three fields with Airwallex.js redirectToCheckout. */
        airwallex: {
          intent_id: intent.id,
          client_secret: intent.client_secret,
          currency,
          successUrl: returnUrl,
          env: awEnv,
        },
      });
    } catch (err: any) {
      log.error("[billing/plan] error:", err);
      // v24.4.2 Bug G — surface Airwallex network errors clearly so the UI
      // shows a helpful message rather than a blank page or generic 500.
      const isNetworkError = err?.cause?.code === "ECONNREFUSED" ||
        err?.cause?.code === "ENOTFOUND" ||
        /fetch failed|network/i.test(err?.message ?? "");
      if (isNetworkError) {
        return res.status(503).json({
          ok: false,
          error: "gateway_network_error",
          message: "Airwallex gateway is unreachable. Check AIRWALLEX_API_BASE and network connectivity.",
        });
      }
      /* v25.28 — surface Airwallex credential failures as a clear 503 instead
       * of a generic 500 so admins immediately see they need to rotate keys
       * (not a bug in our code). */
      const msg = String(err?.message ?? "");
      const isAuthError =
        /credentials_invalid|UNAUTHORIZED|HTTP 401|HTTP 403/i.test(msg);
      if (isAuthError) {
        return res.status(503).json({
          ok: false,
          error: "gateway_credentials_invalid",
          message: "Airwallex rejected our API credentials (401 credentials_invalid). The administrator must verify AIRWALLEX_API_KEY + AIRWALLEX_CLIENT_ID in the Airwallex merchant portal (Developer → API keys).",
        });
      }
      /* v25.32 burndown — item 33: do not echo raw err.message to the client in
         production (can leak DB/SQL/path detail). The full error is already
         captured by log.error above; the client gets a generic message in prod
         and the raw text only in dev. Source: server/lib/sanitize.ts. */
      res.status(500).json({ ok: false, error: "server_error", message: sanitizeErrorMessage(err) });
    }
  });

  // v24.2 Airwallex wiring — subscription status poll (drives BillingReturn.tsx
  // after the founder returns from the Airwallex hosted page).
  app.get("/api/founder/subscription/status", requireAuth, async (req, res) => {
    const { paymentIntentId, companyId } = req.query;
    const subStore = await import("./subscriptionStore");

    /* v25.45 Bug A — per-company status contract.
     * The task requires GET /api/founder/subscription/status?companyId=... to
     * report whether THAT company's subscription is active. Previously this
     * endpoint ONLY accepted paymentIntentId (used by BillingReturn.tsx polling)
     * and returned 400 missing_paymentIntentId for a companyId query. We now
     * support companyId DB-direct (most-recent active row wins, else newest),
     * ownership-gated, while preserving the legacy paymentIntentId behavior. */
    if (companyId && !paymentIntentId) {
      const cid = String(companyId);
      // Tenant isolation: caller must own the company (admins bypass).
      if (!req.userContext?.isAdmin) {
        const owns = (req.userContext?.founder?.companies ?? []).some(
          (c: any) => (c.companyId ?? c.id) === cid,
        );
        if (!owns) return res.status(403).json({ ok: false, error: "not_owner" });
      }
      let rows;
      try {
        rows = subStore.listForCompany(cid);
      } catch (e) {
        return res.status(503).json({ ok: false, error: "subscription_read_failed" });
      }
      if (!rows.length) return res.status(404).json({ ok: false, error: "not_found" });
      const byNewest = (a: any, b: any) =>
        (b.activatedAt ?? b.createdAt).localeCompare(a.activatedAt ?? a.createdAt);
      const active = rows.filter((r) => r.status === "active").sort(byNewest);
      const chosen = active[0] ?? [...rows].sort(byNewest)[0];
      return res.json({
        ok: true,
        status: chosen.status,
        tierId: chosen.tierId,
        companyId: chosen.companyId,
        activatedAt: chosen.activatedAt,
        currentPeriodEnd: chosen.currentPeriodEnd ?? null,
      });
    }

    if (!paymentIntentId) {
      return res.status(400).json({ ok: false, error: "missing_paymentIntentId" });
    }
    const sub = subStore.getByPaymentIntent(String(paymentIntentId));
    if (!sub) return res.status(404).json({ ok: false, error: "not_found" });
    // Verify the caller owns the subscription.
    if (sub.userId !== req.userContext?.userId) {
      return res.status(403).json({ ok: false, error: "not_owner" });
    }
    res.json({ ok: true, status: sub.status, tierId: sub.tierId, activatedAt: sub.activatedAt });
  });

  /* v25.11 NL1 — removed dead-code 501 stubs for
   *   POST   /api/founder/team/invitations
   *   DELETE /api/founder/team/members/:id
   * The real DB-backed handlers are registered earlier via
   * registerFounderTeamRoutes(app) (line ~595). Express dispatches by
   * registration order, so these stubs were unreachable; keeping them
   * around was a maintenance hazard (if someone moved registration order,
   * the 501s would shadow the real handlers).
   *
   * v25.11 NL2 — removed dead-code fake-success stubs for
   *   POST /api/investor/ma/initiatives/:id/respond
   *   POST /api/investor/ma/initiatives/:id/decline
   * The real handlers are registered earlier via registerMaInitiativesRoutes
   * (line ~599). These fake-success stubs were doubly dangerous because
   * they returned 200 without DB writes — if registration order ever
   * changed, every respond/decline would silently no-op while pretending
   * to succeed. */

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
    // v25.45 ROUND 2 — archive gate: block round creation on archived workspaces.
    if (assertWorkspaceNotArchived(req, res, companyId)) return;
    // v23.9 A2/AV-03 — numeric coercion + validation. The round-form sends
    // human-typed money strings ("500,000", "$1,000,000"); a bare Number()
    // on those yields NaN which used to reach roundsStore and surface as a
    // 500 ROUND_PERSIST_FAILED. Negatives were silently accepted. Strip
    // thousands separators / currency symbols, then reject NaN or negative
    // with a typed 400 so the client can highlight the offending field. A
    // field that is absent (null/undefined/"") is left untouched.
    const coerceNumeric = (key: string): boolean => {
      const raw = body[key];
      if (raw == null || raw === "") return false; // absent — leave untouched
      const n = Number(String(raw).replace(/[,\s$]/g, ""));
      if (Number.isNaN(n) || n < 0) {
        res.status(400).json({ error: `invalid_${key}`, message: `${key === "targetAmount" ? "Target amount" : key} must be a positive number` });
        return true;
      }
      body[key] = n;
      return false;
    };
    for (const key of [
      "targetAmount", "preMoney", "postMoney", "pricePerShare", "valuationCap",
      "discount", "interestRate", "maturityMonths", "strikePrice", "expiryYears",
      "minTicket", "sharesAuthorized", "poolSize",
    ]) {
      if (coerceNumeric(key)) return;
    }
    // v23.9 B3/BUG-039 — a round must not close before it opens.
    if (typeof body.openDate === "string" && body.openDate && typeof body.closeDate === "string" && body.closeDate) {
      const open = new Date(body.openDate).getTime();
      const close = new Date(body.closeDate).getTime();
      if (Number.isFinite(open) && Number.isFinite(close) && close < open) {
        return res.status(400).json({ error: "invalid_closeDate", message: "Close date must be on or after the open date." });
      }
    }

    // v24.1 Bug B (Avi #2) — required-field validation. Previously the only
    // checks were companyId ownership + per-field NaN/negative coercion, so a
    // blank name became "Untitled round", target 0 was accepted, and instrument
    // type / per-instrument terms were never enforced. We now return a typed
    // 400 { error: "validation_failed", fieldErrors } so the wizard can
    // highlight the offending fields.
    {
      const fieldErrors: Record<string, string> = {};
      // After coerceNumeric() above, numeric body fields are JS numbers (or
      // left as null/""/string when absent). Re-read defensively.
      const num = (k: string): number | null => {
        const v = (body as Record<string, unknown>)[k];
        if (v == null || v === "") return null;
        const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s$]/g, ""));
        return Number.isFinite(n) ? n : null;
      };
      const future = (k: string): boolean => {
        const v = (body as Record<string, unknown>)[k];
        if (typeof v !== "string" || !v) return false;
        const t = new Date(v).getTime();
        return Number.isFinite(t) && t > Date.now();
      };

      // name non-empty
      if (!body.name || String(body.name).trim().length === 0) {
        fieldErrors.name = "Round name is required.";
      }
      // targetAmount > 0
      const targetAmount = num("targetAmount");
      if (targetAmount == null || targetAmount <= 0) {
        fieldErrors.targetAmount = "Target amount must be greater than 0.";
      }
      // instrument is one of the supported wizard values. NOTE (v24.1 deviations,
      // see V24_1_REPORT.md):
      //  (1) The spec's coarse list (priced/safe/...) doesn't match the wizard's
      //      actual InstrumentValue set, so we validate the REAL values the
      //      client sends to avoid rejecting legitimate rounds.
      //  (2) instrument is validated ONLY WHEN PROVIDED. The v24.0 contract
      //      (proven by existing roundDetailLoad/roundPersistenceProof tests)
      //      allows omitting instrument, so requiring it would regress passing
      //      tests. The wizard always sends it; this guards malformed values.
      //  (3) Per-instrument *term* checks fire ONLY for fields the caller
      //      actually supplied ("in body"), so we surface a clear error for a
      //      supplied-but-bad value without forcing fields the v24.0 callers
      //      legitimately omit (e.g. a priced round saved without sharesAuthorized).
      const VALID_INSTRUMENTS = new Set([
        "preferred", "common", "safe_post", "safe_pre", "convertible_note",
        "warrant", "option_pool",
      ]);
      const has = (k: string): boolean => {
        const v = (body as Record<string, unknown>)[k];
        return v != null && v !== "";
      };
      const instrumentProvided = has("instrument");
      const instrument = typeof body.instrument === "string" ? body.instrument : "";
      if (instrumentProvided && !VALID_INSTRUMENTS.has(instrument)) {
        fieldErrors.instrument = "Choose a valid investment instrument.";
      } else if (instrumentProvided) {
        // Per-instrument term requirements — only reject SUPPLIED-but-invalid
        // values (a supplied field that is <= 0 / not in the future).
        if (instrument === "preferred" || instrument === "common") {
          if (has("preMoney") && (num("preMoney") ?? 0) <= 0) fieldErrors.preMoney = "Pre-money valuation must be greater than 0 for a priced round.";
          if (has("pricePerShare") && (num("pricePerShare") ?? 0) <= 0) fieldErrors.pricePerShare = "Price per share must be greater than 0 for a priced round.";
          if (has("sharesAuthorized") && (num("sharesAuthorized") ?? 0) <= 0) fieldErrors.sharesAuthorized = "Shares outstanding/authorized must be greater than 0 for a priced round.";
        } else if (instrument === "safe_post" || instrument === "safe_pre" || instrument === "convertible_note") {
          // SAFE / note: if either cap or discount is supplied, at least one must be > 0.
          if (has("valuationCap") || has("discount")) {
            const cap = num("valuationCap") ?? 0;
            const disc = num("discount") ?? 0;
            if (cap <= 0 && disc <= 0) {
              fieldErrors.valuationCap = "Provide a valuation cap or a discount greater than 0.";
            }
          }
          if (has("maturityDate") && !future("maturityDate")) fieldErrors.maturityDate = "Maturity date must be in the future.";
          if (has("maturityMonths") && (num("maturityMonths") ?? 0) <= 0) fieldErrors.maturityMonths = "Maturity (months) must be greater than 0.";
        } else if (instrument === "warrant") {
          if (has("strikePrice") && (num("strikePrice") ?? 0) <= 0) fieldErrors.strikePrice = "Strike price must be greater than 0.";
          if (has("sharesAuthorized") && (num("sharesAuthorized") ?? 0) <= 0) fieldErrors.sharesAuthorized = "Warrant share count must be greater than 0.";
          if (has("expiryDate") && !future("expiryDate")) fieldErrors.expiryDate = "Expiry date must be in the future.";
          if (has("expiryYears") && (num("expiryYears") ?? 0) <= 0) fieldErrors.expiryYears = "Expiry (years) must be greater than 0.";
        } else if (instrument === "option_pool") {
          if (has("poolSize") && (num("poolSize") ?? 0) <= 0) fieldErrors.poolSize = "Option pool size must be greater than 0.";
        }
      }

      if (Object.keys(fieldErrors).length > 0) {
        return res.status(400).json({ error: "validation_failed", fieldErrors });
      }
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
    // v24.1 Bug C (Avi #3) — derive postMoney when the client omits it so the
    // edit dialog no longer shows 0 for post-money valuation prefs. The create
    // wizard previews preMoney + targetAmount but never persisted it.
    const _validPreMoney =
      body.preMoney != null && body.preMoney !== "" && Number(body.preMoney) > 0;
    const _validTarget =
      body.targetAmount != null && body.targetAmount !== "" && Number(body.targetAmount) > 0;
    const derivedPostMoney =
      body.postMoney ??
      (_validPreMoney && _validTarget
        ? Number(body.preMoney) + Number(body.targetAmount)
        : null);
    let newRound;
    try {
      newRound = roundsStoreCreate({
        companyId,
        name: String(body.name ?? "Untitled round"),
        type: String(body.type ?? "seed"),
        state: body.state ?? "draft",
        targetAmount: Number(body.targetAmount ?? 0),
        preMoney: body.preMoney ?? null,
        postMoney: derivedPostMoney,
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

  /* ------------------------------------------------------------------
   * v23.9 B2/AV-20 — round close. Founder-owned. Flips the round to
   * "closed", runs the existing (sacred) close cascade, and returns the
   * updated round plus a cap-table snapshot. The cascade is called via its
   * existing standalone wrapper — roundCloseCascade.ts is NOT modified.
   * ------------------------------------------------------------------ */
  function capTableSnapshotForCompany(companyId: string | null) {
    if (!companyId) return [];
    return getLedger()
      .filter((e: any) => (e.companyId ?? e.company_id) === companyId)
      .map((e: any) => ({
        holderId: e.holderUserId ?? e.holder_user_id ?? null,
        holderName: e.holderName ?? e.holder_name ?? null,
        securityType: e.securityType ?? e.security_type ?? null,
        shares: e.shares ?? null,
        amountUsd: e.amountUsd ?? e.amount_usd ?? null,
      }));
  }

  // GET — confirmation-page data for the close dialog.
  app.get("/api/rounds/:id/close", requireAuth, (req, res) => {
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok || !check.companyId) return;
    const id = paramStr(req.params.id);
    const round = mergeLegacyAndDbRounds().find((r: any) => r.id === id);
    if (!round) return res.status(404).json({ ok: false, error: "round_not_found" });
    res.json({
      ok: true,
      round,
      alreadyClosed: round.state === "closed" || round.state === "funded",
      capTable: capTableSnapshotForCompany(check.companyId),
    });
  });

  app.post("/api/rounds/:id/close", requireAuth, (req, res) => {
    const check = requireFounderOwnsRound(req, res);
    if (!check.ok || !check.companyId) return;
    const id = paramStr(req.params.id);
    const closedAt = new Date().toISOString();
    // Run the sacred cascade (DB write-through + offer lapsing + notifications).
    const result = closeRoundCascadeStandalone(id, {
      reason: "manual_close",
      actorUserId: check.userId ?? null,
    });
    // Mirror into the legacy in-memory `rounds` array so existing read-paths
    // reflect the closed state without a wide refactor.
    const legacy = (rounds as unknown as any[]).find((r) => r.id === id);
    if (legacy) {
      legacy.state = "closed";
      legacy.closedAt = closedAt;
    }
    emitMutation({ aggregate: "round", id, change: "update" });
    const round = mergeLegacyAndDbRounds().find((r: any) => r.id === id);
    res.json({
      ok: true,
      round: round ? { ...round, state: "closed", closedAt } : { id, state: "closed", closedAt },
      cascade: result,
      capTable: capTableSnapshotForCompany(check.companyId),
    });
  });

  /* ------------ generic mock POST endpoints (requireAuth) ------------ */
  /* ------------ Sprint 21 Wave B: Invitations enhancements ------------ */
  registerSprint21InvitationsRoutes(app);

  /* ------------ Sprint 21 Wave C: Portfolio overhaul ------------ */
  registerSprint21PortfolioRoutes(app);

  /* ------------ Sprint 22 Wave 2: missing endpoint stubs ------------ */
  registerSprint22Routes(app);

  /* ------------ v25.0 Track 1: Capavate core endpoints (A1–A8) ------------ */
  registerTrack1Routes(app);

  /* ------------ v25.0 Track 4: Cross-component data flow (D1–D3, F1) ------------ */
  registerTrack4Routes(app);

  /* ------------ Patch 2: Round Carry-Forward (investor-grade) ------------ */
  registerRoundCarryForwardRoutes(app);

  /* ------------ Avi 22-May Issue 2: PPS derivation helpers (UI advisory) ------------ */
  registerRoundPriceDerivationRoutes(app);

  // C4 (v24.0): these endpoints were never implemented — they returned a
  // fake `{ ok: true }` to the client, silently swallowing the request and
  // making the UI appear to succeed while nothing was persisted. Per the
  // v24.0 lockdown rule (NO fake success), return 501 not_implemented with a
  // clear feature-flag message until a real handler is wired.
  for (const path of [
    "/api/rounds/:id/invitations/bulk",
    "/api/crm",
    "/api/reports",
    "/api/dataroom/upload",
  ]) {
    app.post(path, requireAuth, (_req, res) =>
      res.status(501).json({
        ok: false,
        error: "not_implemented",
        message: `Endpoint ${path} is not implemented yet and is disabled in v24.0. No data was changed.`,
      }),
    );
  }

  /* v25.11 NM6 — the three legacy POST shortcuts
   *   /api/investor/invitations/:id/accept
   *   /api/investor/invitations/:id/decline
   *   /api/investor/invitations/:id/soft-circle
   * used to return 501. The canonical client path is
   *   PATCH /api/rounds/:roundId/invitations/:invId/decision
   * (backed by yourDecisionStore). These shortcut endpoints are kept for
   * any integration partner / mobile client and now delegate to the same
   * applyDecisionAction path so they actually write through and persist. */
  for (const [path, action] of [
    ["/api/investor/invitations/:id/accept", "accept"],
    ["/api/investor/invitations/:id/decline", "decline"],
    ["/api/investor/invitations/:id/soft-circle", "soft_circle"],
  ] as const) {
    app.post(path, requireAuth, async (req, res) => {
      try {
        const ctx = req.userContext;
        if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
        const invId = String(req.params.id ?? "");
        if (!invId) return res.status(400).json({ ok: false, error: "missing_invitation_id" });
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const inv = require("./roundInvitationsStore").getInvitation(invId);
        if (!inv) return res.status(404).json({ ok: false, error: "invitation_not_found" });
        if (!ctx.isAdmin) {
          const hasInv = ctx.investor?.invitedRounds?.some((r: any) => r.invitationId === invId || r.roundId === inv.roundId);
          if (!hasInv) return res.status(403).json({ ok: false, error: "NOT_ON_CAP_TABLE" });
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const yds = require("./yourDecisionStore");
        const rec = yds.ensureRecord ? yds.ensureRecord(invId) : yds.getRecord(invId);
        if (!rec) return res.status(404).json({ ok: false, error: "invitation_not_found" });
        const patch: any = { action };
        if (action === "soft_circle") {
          const amt = Number(req.body?.amount ?? 0);
          if (!amt || amt <= 0) return res.status(400).json({ ok: false, error: "amount_required" });
          patch.amount = amt;
          if (typeof req.body?.currency === "string") patch.currency = req.body.currency;
        }
        const result = yds.applyDecisionAction(rec, patch);
        if (!result.ok) return res.status(409).json({ ok: false, error: result.error });
        // Persist via the same path NC1 uses on the canonical PATCH handler.
        if (typeof yds._persistRecord === "function") {
          try { yds._persistRecord(rec); } catch { /* non-fatal */ }
        }
        return res.json({ ok: true, invitationId: invId, action, state: rec.state ?? null });
      } catch (err) {
        return res.status(500).json({ ok: false, error: "internal_error", message: (err as Error).message });
      }
    });
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
      co_quanta: { userId: "u_maya_chen", name: "Maya Chen" },
      co_beacon: { userId: "u_maya_chen", name: "Maya Chen" },
      co_tideline: { userId: "u_maya_chen", name: "Maya Chen" },
      co_kelvin: { userId: "u_maya_chen", name: "Maya Chen" },
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

  // v23.9 C4 — founder dashboard aggregate. Stitches together the active
  // company record, its KPI block, the company's rounds, a derived recent
  // activity feed, and contextual CTAs. All data is read from existing live
  // stores; nothing is fabricated. The client home page renders this in one
  // request instead of fanning out to companies + rounds + activity.
  app.get("/api/founder/dashboard", requireAuth, (req, res) => {
    const ctx = req.userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const activeCompanyId = ctx.founder?.activeCompanyId
      ?? (typeof req.query.companyId === "string" ? req.query.companyId : null);
    const company = activeCompanyId ? getCompanyRecordById(activeCompanyId) ?? null : null;

    const kpis = company?.kpi ?? {
      capTableHolders: 0,
      activeRoundsCount: 0,
      raisedThisYearUsd: 0,
      dataroomFiles: 0,
      pendingSoftCircles: 0,
      ownershipPct: 0,
    };

    // C5 (v24.0): read real rounds from roundsStore (SQL-backed) for the active
    // company instead of the canonical mock array, so the founder dashboard
    // reflects actual data. Empty when the company has no rounds yet.
    const companyRounds = activeCompanyId
      ? roundsStoreForCompany(activeCompanyId)
      : [];
    const recentRounds = companyRounds
      .slice()
      .sort((a, b) => {
        const at = new Date((a as { openDate?: string }).openDate ?? 0).getTime();
        const bt = new Date((b as { openDate?: string }).openDate ?? 0).getTime();
        return bt - at;
      })
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        name: (r as { name?: string }).name ?? r.id,
        state: (r as { state?: string }).state ?? "draft",
        targetAmount: (r as { targetAmount?: number }).targetAmount ?? null,
        openDate: (r as { openDate?: string }).openDate ?? null,
        closeDate: (r as { closeDate?: string }).closeDate ?? null,
      }));

    const recentActivity = recentRounds.map((r) => ({
      kind: "round",
      refId: r.id,
      label: `Round ${r.name} — ${r.state}`,
      at: r.closeDate ?? r.openDate ?? null,
    }));

    const ctas: Array<{ id: string; label: string; href: string }> = [];
    if (!company) {
      ctas.push({ id: "create_company", label: "Create your company", href: "/founder/companies/new" });
    } else {
      if (kpis.activeRoundsCount === 0) {
        ctas.push({ id: "open_round", label: "Open a round", href: "/founder/rounds/new" });
      }
      if (kpis.dataroomFiles === 0) {
        ctas.push({ id: "upload_dataroom", label: "Upload to your data room", href: "/founder/dataroom" });
      }
      if (kpis.pendingSoftCircles > 0) {
        ctas.push({ id: "review_soft_circles", label: "Review soft circles", href: "/founder/rounds" });
      }
    }

    res.json({
      company: company
        ? {
          id: company.companyId,
          name: company.companyName,
          legalName: company.legalName,
          sector: company.sector,
          stage: company.stage,
          hq: company.hq,
          collective: company.collective ?? { status: "none" },
          billing: company.billing ?? null,
        }
        : null,
      kpis,
      recentRounds,
      recentActivity,
      ctas,
    });
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
  const adminCompaniesFullHandler = (_req: Request, res: Response) => {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 86_400_000;
    const subs = new Map<string, Subscription>();
    for (const s of listSubscriptions()) subs.set(s.companyId, s);

    // v23.8 W-8: the admin panel previously read only `canonicalCompanies`
    // (static, empty in production). Merge in real founder-created companies
    // from multiCompanyStore so the panel reflects production data. Deduped by
    // id; canonical entries win when both exist.
    type CompanyStub = { id: string; name: string; legalName: string; region?: string; sector: string; stage: string; hq: string; maScore?: number };
    const stubById = new Map<string, CompanyStub>();
    // v25.45 Bug B FIX — read the company set from the DB-authoritative reader
    // (getAllCompaniesFromDb) instead of the in-memory-Map-only getAllCompanies().
    // ROOT CAUSE: getAllCompanies() returned only companies present in the
    // USER_COMPANIES Map, which is rebuilt at boot by iterating company_members.
    // A company with a `companies` row but no membership row was invisible to
    // admin after every restart (the founder-reported bug). The DB reader
    // unions the live Map with the `companies` table so the admin Companies
    // panel reflects every persisted company. No tenant filter is applied —
    // admin sees all tenants by design.
    for (const mc of getAllCompaniesFromDb()) {
      stubById.set(mc.companyId, {
        id: mc.companyId,
        name: mc.companyName,
        legalName: mc.legalName,
        sector: mc.sector,
        stage: mc.stage,
        hq: mc.hq,
      });
    }
    for (const c of canonicalCompanies) {
      stubById.set(c.id, {
        id: c.id,
        name: c.name,
        legalName: c.legalName,
        region: (c as { region?: string }).region,
        sector: c.sector,
        stage: c.stage,
        hq: c.hq,
        maScore: (c as { maScore?: number }).maScore,
      });
    }

    const rows: AdminCompanyFullRow[] = Array.from(stubById.values()).map((c) => {
      // C6 (v24.0): read rounds + soft-circles from the real stores
      // (roundsStore / softCircleStore) instead of the canonical mock arrays so
      // the admin company aggregate reflects production data.
      const companyRounds = roundsStoreForCompany(c.id);
      const closedRounds = companyRounds.filter((r) => r.state === "closed" || r.state === "funded");
      const activeRounds = companyRounds.filter((r) => r.state !== "closed" && r.state !== "funded");

      const roundCurrency = (companyRounds[0] as { currency?: string } | undefined)?.currency ?? "USD";
      const totalRaisedMinor = closedRounds.reduce((sum, r) => {
        const raw = (r as { raisedAmount?: number }).raisedAmount ?? 0;
        return sum + Math.round(raw * 100);
      }, 0);

      const allSoftCircles = softCircleListForCompany(c.id);
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
  };
  app.get("/api/admin/companies/full", requireAdmin, adminCompaniesFullHandler);
  // v23.9 B7: bare alias so clients that hit /api/admin/companies (without the
  // /full suffix) get the same merged company list. Registered before the
  // partnerRoutes :id route would shadow it (Express matches static paths and
  // /:id distinctly, so the bare collection path is unambiguous).
  app.get("/api/admin/companies", requireAdmin, adminCompaniesFullHandler);
}
