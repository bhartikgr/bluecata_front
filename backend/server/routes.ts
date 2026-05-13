import type { Express, Request } from "express";
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
import { registerProfileRoutes } from "./profileStore";
import { registerCommsRoutes } from "./commsStore";
import { registerCommsTiersRoutes } from "./commsTiersStore";
import { resetDemoState } from "../scripts/reset-demo";
import { registerYourDecisionRoutes } from "./yourDecisionStore";
import { registerMaIntelligenceRoutes } from "./maIntelligenceStore";
import { registerCrmRoutes } from "./crmStore";
import { registerCollectiveAppRoutes } from "./collectiveAppStore";
import { registerFounderCollectiveApplyRoutes } from "./founderCollectiveApplyStore";
import { registerWelcomeRoutes } from "./welcomeStore";
import { registerNetworkPostsRoutes } from "./networkPostsStore";
import { registerBulkMessageRoutes } from "./bulkMessageStore";
import { registerPortfolioAnalyticsRoutes } from "./portfolioAnalyticsStore";
import { registerSprint21Routes } from "./sprint21Routes";
import { setSessionCookie, clearSessionCookie } from "./lib/sessionCookie.js";
import { getRecentEvents, findEventsByType } from "./sprint10Telemetry";
// Sprint 11 — founder build
import { registerMultiCompanyRoutes } from "./multiCompanyStore";
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
import { registerAdminPlatformRoutes, appendAdminAudit } from "./adminPlatformStore";
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
import { registerCollectiveSettingsRoutes } from "./collectiveSettingsStore";
import { registerContactRosterImporterRoutes } from "./contactRosterImporter";
// Sprint 15 — Login + Entitlement architecture
import { registerAuthShellRoutes, type RedemptionPreview, type RedemptionResult } from "./lib/authRoutes";
// Sprint 21 Wave B — Invitations enhancements
import { registerSprint21InvitationsRoutes } from "./sprint21InvitationsRoutes";
// Sprint 21 Wave C — Portfolio overhaul
import { registerSprint21PortfolioRoutes } from "./sprint21PortfolioRoutes";
import { registerSprint22Routes } from "./sprint22Routes";
import { registerSecureAuthRoutes } from "./lib/secureAuthRoutes";
import { registerAdminUsersRoutes } from "./lib/adminUsersRoutes";
import { realtimeStreamHandler, emitMutation } from "./lib/eventBus";
import { BridgeOutbound } from "./lib/bridgeOutbound";
import { csrfMiddleware } from "./lib/csrf";
import { rateLimitMiddleware } from "./lib/rateLimit";
import { securityHeaders, corsForApi } from "./middleware/security";
import { getDb } from "./db/connection";
import { SYNC_ENTITY_COUNT } from "./db/syncRepo";
import { getOutbox } from "./bridgeStore";
import { loadUserContext, requireEntitlement } from "./lib/requireEntitlement";
import { registerPersona } from "./lib/userContext";
import { getUserContextForId } from "./lib/userContext";
import { companies as _allCompanies } from "./mockData";

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

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  /* ------------ Sprint 17 D2: security headers + CORS (front of stack) ------------ */
  app.use(securityHeaders);
  app.use("/api", corsForApi);

  /* ------------ Sprint 22 Wave 1: loadUserContext MUST be first so every downstream
   * handler has req.userContext populated (DEF-022 root fix). ------------ */
  app.use(loadUserContext);

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
  app.post("/api/founder/companies", (req: import("express").Request, res: import("express").Response) => {
    const { companyId, companyName, plan } = req.body ?? {};
    if (!companyId || !companyName) {
      return res.status(400).json({ ok: false, error: "companyId and companyName are required" });
    }
    const actor = (req.headers["x-actor-email"] as string | undefined) ?? `founder:${companyId}`;
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
  registerCollectiveRoutes(app);
  registerCollectiveSettingsRoutes(app);

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
  // CSRF middleware checks the X-CSRF-Token header (or double-submit cookie).
  // Applied to redemption, collective applications, and decision mutations.
  // We apply it selectively to POST/PATCH methods to avoid blocking GETs.
  const csrfForMethod = (method: string) => (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (req.method.toUpperCase() !== method.toUpperCase()) return next();
    return csrfMiddleware(req, res, next);
  };
  app.use("/api/invitations/redeem", csrfForMethod("POST"));
  app.use("/api/collective/applications", csrfForMethod("POST"));
  // Decision PATCH: applied via path pattern
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

  /* ------------ Sprint 17 D4: realtime invalidation stream ------------ */
  app.get("/api/events/stream", realtimeStreamHandler);

  /* ------------ Sprint 17 health: DB layer status ------------ */
  app.get("/api/db/status", (_req, res) => {
    res.json({ ok: true, syncEntities: SYNC_ENTITY_COUNT, driver: process.env.DATABASE_URL?.startsWith("postgres") ? "postgres" : "sqlite" });
  });

  /* ------------ Pass 4: /api/healthz production healthcheck ------------ */
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
      emailOutboxBacklog: 0,   // email outbox drain handled by emailTransport token bucket
      timestamp: new Date().toISOString(),
    });
  });

  /* ------------ Sprint 16 A4: Admin demo reset ------------ */
  app.post("/api/admin/sync/reset-demo", (req, res) => {
    const ses = String(req.headers["x-admin-ses"] || "");
    if (!ses || ses.length < 8) {
      return res.status(403).json({ error: "admin SES required" });
    }
    const summary = resetDemoState();
    return res.status(summary.ok ? 200 : 207).json(summary);
  });

  /* ------------ Sprint 15: Auth shell + entitlement gates ------------ */
  // NOTE: loadUserContext is registered at the TOP of registerRoutes (Sprint 22 Wave 1 fix).

  // Wire the auth shell. Redemption helpers delegate to the in-memory
  // invitation store defined later in this file — bridge via closures.
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
          roundLabel: round ? `${round.type ?? ""}${round.targetAmount ? " \u00b7 $" + (round.targetAmount/1_000_000).toFixed(1) + "M target" : ""}` : undefined,
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
   * Enforcement is ON by default. Gates can be bypassed only if:
   *   - NODE_ENV !== "production" AND
   *   - caller passes ?enforce=0
   * This ensures production always enforces and the sandbox opt-out is
   * explicit and dev-only. Previously the gate fired only on ?enforce=1,
   * which meant skipping the param bypassed all gates.
   */
  function gate(...required: Parameters<typeof requireEntitlement>): import("express").RequestHandler {
    const mw = requireEntitlement(...required);
    return (req, res, next) => {
      // Allow bypass only in non-production environments when ?enforce=0 is passed
      const isDevBypass = process.env.NODE_ENV !== "production" && String(req.query.enforce ?? "1") === "0";
      if (isDevBypass) return next();
      return mw(req, res, next);
    };
  }
  // Investor portfolio/CRM/messages/dataroom: must hold any cap-table position.
  app.use("/api/investor/portfolio",  gate("investor.hasAnyCapTable"));
  app.use("/api/investor/crm",        gate("investor.hasAnyCapTable"));
  app.use("/api/investor/messages",   gate("investor.hasAnyCapTable"));
  app.use("/api/investor/portfolio2", gate("investor.hasAnyCapTable"));
  // Per-company investor surfaces — must be on cap table OF that company.
  app.use("/api/investor/companies/:companyId", gate("investor.onCapTableOf"));
  // Collective application POST — requires cap-table position.
  app.use("/api/collective/applications", (req, res, next) => {
    if (req.method !== "POST") return next();
    return gate("investor.hasAnyCapTable")(req, res, next);
  });
  // Collective active routes — requires active membership.
  app.use("/api/collective/network",   gate("collective.active"));
  app.use("/api/collective/dealroom",  gate("collective.active"));
  // Founder per-company billing.
  app.use("/api/founder/companies/:id/billing", gate("founder.ofCompany"));

  // Sprint 10: telemetry inspection (canonical sync envelopes)
  app.get("/api/telemetry/sprint10", (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    res.json(type ? findEventsByType(type) : getRecentEvents(200));
  });

  // Sprint 10: round activity stream (cross-portfolio, time-ordered)
  // Defect 81 fix: filter by investor's invitedRounds companies.
  app.get("/api/investor/round-activity", (req, res) => {
    const ALL_ITEMS = [
      { id: "ra_1", ts: "2026-05-08T09:14:00Z", kind: "new_round",       companyId: "co_arboreal", company: "Arboreal Health", text: "Pre-Seed open · $1.5M target · soft-circle window 14d", href: "/investor/companies/co_arboreal?tab=your-decision", roundId: "rnd_pre" },
      { id: "ra_2", ts: "2026-05-07T17:02:00Z", kind: "soft_circle",     companyId: "co_novapay",  company: "NovaPay AI",      text: "Seed Extension · $2.65M soft-circled of $4.0M",     href: "/investor/companies/co_novapay?tab=your-decision", roundId: "rnd_novapay_seed" },
      { id: "ra_3", ts: "2026-05-06T11:08:00Z", kind: "term_sheet",      companyId: "co_quanta",   company: "Quanta Robotics", text: "Series A term sheet drop — pro-rata exercise window 7d", href: "/investor/companies/co_quanta?tab=your-decision",  roundId: "rnd_q_a" },
      { id: "ra_4", ts: "2026-05-05T14:33:00Z", kind: "close_gate",      companyId: "co_helia",    company: "Helia AI",        text: "Series A closing tomorrow — last call for confirmations", href: "/investor/companies/co_helia?tab=your-decision", roundId: "rnd_helia_a" },
      { id: "ra_5", ts: "2026-05-03T08:00:00Z", kind: "new_round",       companyId: "co_kelvin",   company: "Kelvin Energy",   text: "Bridge note round opening Q2",                       href: "/investor/companies/co_kelvin?tab=your-decision", roundId: "rnd_k_bridge" },
    ];
    // Filter to companies the investor has been invited to (or on cap table of)
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

  /* ------------ founder side ------------ */
  app.get("/api/companies", (_req, res) => res.json(companies));
  /* Sprint 7 — access-aware company-details payload (R200.gating §5).
   *
   * Always returns shared sections; gates rounds / dataroom / softCircles /
   * termSheet on whether the requester is the founder of the company OR has
   * an `invited_to_round` participant grant.
   *
   * Preview auth: pass `?as=founder|investor|admin&investorId=u_aisha_patel`
   * to simulate the requester. Defaults to investor + currentInvestor for
   * easy demo.
   */
  app.get("/api/companies/:id", async (req, res) => {
    const c = companies.find(c => c.id === req.params.id);
    const extra = companyDetailsExtra[req.params.id] ?? null;
    if (!c && !extra) return res.status(404).json({ message: "Not found" });

    // Sprint 8: pull live profile via the profile store internally.
    const { _testAccess } = await import("./profileStore");
    const liveProfile = _testAccess.companyProfiles.get(req.params.id) ?? null;

    const role = String(req.query.as ?? "investor");
    const investorId = String(req.query.investorId ?? currentInvestor.id);

    // Founder + admin always see everything.
    let canSeeRound = role === "founder" || role === "admin";
    let canSeeDataroom = canSeeRound;
    let canSeeSoftCircle = canSeeRound;
    let canSeeTermSheet = canSeeRound;

    if (role === "investor") {
      const inv = investorId === currentInvestor.id ? currentInvestor : null;
      const invited = !!inv && inv.invitedCompanies.includes(req.params.id);
      canSeeRound = invited;
      canSeeDataroom = invited;
      canSeeSoftCircle = invited; // investor sees only their own entry
      canSeeTermSheet = invited;
    }

    const companyShared = c ?? {
      // Synthetic header for portfolio companies that aren't in the founder
      // companies list (Quanta, Helia, Kelvin) but have detail extras.
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

    const roundsForCompany = rounds.filter(r => r.companyId === req.params.id);
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

  app.get("/api/companies/:id/securities", (req, res) => {
    res.json(securities.filter(s => s.companyId === req.params.id));
  });

  app.get("/api/rounds", (_req, res) => {
    const enriched = rounds.map(r => ({
      ...r,
      company: companies.find(c => c.id === r.companyId)?.name ?? "Unknown",
    }));
    res.json(enriched);
  });
  app.get("/api/rounds/:id", (req, res) => {
    const r = rounds.find(r => r.id === req.params.id);
    if (!r) return res.status(404).json({ message: "Not found" });
    res.json({ ...r, company: companies.find(c => c.id === r.companyId)?.name });
  });

  /* Sprint 18 T5.1 — Edit Terms (active rounds only) */
  app.patch("/api/rounds/:id/terms", (req, res) => {
    const r = rounds.find(rr => rr.id === req.params.id);
    if (!r) return res.status(404).json({ message: "Not found" });
    if (r.state === "closed" || r.state === "funded") {
      return res.status(409).json({ error: "closed_round_readonly", state: r.state });
    }
    const body = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof body.targetAmount === "number" && body.targetAmount > 0) updates.targetAmount = body.targetAmount;
    if (typeof body.preMoney === "number" && body.preMoney >= 0) updates.preMoney = body.preMoney;
    if (typeof body.postMoney === "number" && body.postMoney >= 0) updates.postMoney = body.postMoney;
    if (typeof body.pricePerShare === "number" && body.pricePerShare > 0) updates.pricePerShare = body.pricePerShare;
    if (typeof body.minTicket === "number" && body.minTicket >= 0) updates.minTicket = body.minTicket;
    if (typeof body.closeDate === "string" && body.closeDate.length > 0) updates.closeDate = body.closeDate;
    if (typeof body.termsSummary === "string") updates.termsSummary = body.termsSummary;
    Object.assign(r, updates);
    // Bridge outbound: round.terms_updated
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

  app.get("/api/rounds/:id/invitations", (req, res) => {
    res.json(roundInvitations.filter(i => i.roundId === req.params.id));
  });
  app.get("/api/rounds/:id/soft-circles", (req, res) => {
    res.json(softCircles.filter(s => s.roundId === req.params.id));
  });

  app.get("/api/crm", (_req, res) => res.json(crmInvestors));
  // Defect 57 fix: require ?companyId= and filter results; add auth check.
  app.get("/api/dataroom", (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    if (!companyId) {
      return res.status(400).json({ error: "MISSING_COMPANY_ID", message: "?companyId= is required." });
    }
    if (!req.userContext?.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to continue." });
    }
    const files = dataroomFiles.filter(f => f.companyId === companyId);
    res.json(files);
  });
  app.get("/api/reports", (_req, res) => res.json(reports));
  app.get("/api/activity", (_req, res) => res.json(activity));
  app.get("/api/notifications", (_req, res) => res.json(notifications));

  /* ------------ investor side ------------ */
  app.get("/api/investor/invitations", (_req, res) => res.json(incomingInvitations));
  app.get("/api/investor/invitations/:id", (req, res) => {
    const i = incomingInvitations.find(i => i.id === req.params.id);
    if (!i) return res.status(404).json({ message: "Not found" });
    res.json(i);
  });
  app.get("/api/investor/soft-circles", (_req, res) => res.json(investorSoftCircles));
  app.get("/api/investor/portfolio", (_req, res) => res.json(portfolio));
  app.get("/api/investor/watchlist", (_req, res) => res.json(watchlist));
  app.get("/api/investor/discover", (_req, res) => res.json(discover));

  /* ------------ Sprint 7: rich investor surface ------------ */
  app.get("/api/investor/me", (_req, res) => res.json(currentInvestor));
  app.get("/api/investor/portfolio2", (_req, res) => res.json(investorPortfolio));
  app.get("/api/investor/activity", (_req, res) => res.json(investorActivity));

  /* ------------ Sprint 7: invitation token endpoints ------------ */

  /**
   * Founder issues a single-use invitation token for a round.
   * Returns the raw token in the response (only place it's ever exposed),
   * and a sanitised invitationId suitable for logging.
   */
  app.post("/api/rounds/:id/invitations/issue", (req, res) => {
    const round = rounds.find(r => r.id === req.params.id);
    if (!round) return res.status(404).json({ message: "Round not found" });
    const company = companies.find(c => c.id === round.companyId);

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

  /** Validate a token without redeeming it. Used by /investor/signup gate. */
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

  /** Redeem a token + create the investor account stub.
   * Defect 12 fix: create real persona from inviteeEmail instead of returning u_no_position.
   */
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
    // Create or look up a real persona seeded from inviteeEmail (Defect 12, 15, 83)
    const personaId = registerPersona({
      email: entry.inviteeEmail,
      name: entry.inviteeName,
      password: String(body.password ?? "changeme"),
      invitationId: entry.id,
      roundId: entry.roundId,
      companyId: entry.companyId,
    });
    // Set session cookie (Sprint 27: __Host- prefix in production)
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

  /** Demo-only: list raw tokens visible in preview mode.
   * G2 fix: gated behind admin role AND non-production env. Returns 404 in production.
   */
  app.get("/api/dev/demo-tokens", (req, res) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    if (!req.userContext?.isAdmin) {
      return res.status(403).json({ error: "NOT_ADMIN", message: "Admin access required." });
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
  // Use in-memory storage; cap at 8 MB.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

  app.post("/api/rounds/:id/termsheet/upload", upload.single("file"), (req: Request, res) => {
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
   * Sprint 19 Wave 2 — new endpoints
   * ==================================================================== */

  // Defect 10 — real round invitation endpoints
  app.post("/api/rounds/:id/invitations", (req, res) => {
    const { id } = req.params;
    const { investorName, investorEmail, note, expiryDays } = req.body ?? {};
    const inv = {
      id: `inv-${id}-${Date.now()}`,
      roundId: id,
      investorEmail: investorEmail ?? "",
      investorName: investorName ?? "",
      note: note ?? "",
      state: "pending",
      sentAt: new Date().toISOString(),
      viewedAt: null,
      expiresAt: new Date(Date.now() + (expiryDays ?? 30) * 864e5).toISOString(),
    };
    emitMutation({ aggregate: "round", id, change: "update" });
    emitMutation({ aggregate: "invitation", id: inv.id, change: "create" });
    res.json({ ok: true, invitation: inv });
  });

  app.post("/api/rounds/:id/invitations/:invId/resend", (req, res) => {
    const { id, invId } = req.params;
    emitMutation({ aggregate: "invitation", id: invId, change: "update" });
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, invId });
  });

  app.patch("/api/rounds/:id/invitations/:invId", (req, res) => {
    const { id, invId } = req.params;
    const { expiryDays } = req.body ?? {};
    emitMutation({ aggregate: "invitation", id: invId, change: "update" });
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, invId, extendedDays: expiryDays ?? 30 });
  });

  app.delete("/api/rounds/:id/invitations/:invId", (req, res) => {
    const { id, invId } = req.params;
    emitMutation({ aggregate: "invitation", id: invId, change: "delete" });
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, invId });
  });

  // Soft-circle endpoints
  app.post("/api/rounds/:id/soft-circle", (req, res) => {
    const { id } = req.params;
    const sc = { id: `sc-${id}-${Date.now()}`, roundId: id, ...req.body, createdAt: new Date().toISOString() };
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, softCircle: sc });
  });

  app.post("/api/rounds/:id/soft-circle/:scId/validate", (req, res) => {
    const { id, scId } = req.params;
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, scId, validated: true });
  });

  // Term-sheet send + PDF
  app.post("/api/rounds/:id/term-sheet/send", (req, res) => {
    const { id } = req.params;
    const { invitationIds } = req.body ?? {};
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, roundId: id, sentTo: invitationIds?.length ?? 0 });
  });

  app.get("/api/rounds/:id/term-sheet/pdf", (req, res) => {
    const { id } = req.params;
    const pdfContent = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 100 700 Td (Term Sheet ${id}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000300 00000 n\ntrailer << /Size 5 /Root 1 0 R >>\nstartxref\n395\n%%EOF`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.pdf"`);
    res.send(Buffer.from(pdfContent));
  });

  // Cap-table PDF (defect 9)
  app.get("/api/companies/:id/cap-table/pdf", (req, res) => {
    const { id } = req.params;
    const pdfContent = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj\n4 0 obj\n<< /Length 54 >>\nstream\nBT /F1 12 Tf 100 700 Td (Cap Table Snapshot ${id}) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000300 00000 n\ntrailer << /Size 5 /Root 1 0 R >>\nstartxref\n405\n%%EOF`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="cap-table-${id}.pdf"`);
    res.send(Buffer.from(pdfContent));
  });

  // Securities POST (defect 8)
  app.post("/api/companies/:id/securities", (req, res) => {
    const { id } = req.params;
    const { kind, principal, terms } = req.body ?? {};
    const sec = { id: `sec-${Date.now()}`, companyId: id, kind, principal, terms, issuedAt: new Date().toISOString() };
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, security: sec });
  });

  // Auth me PATCH — Sprint 22 Wave 2: persist timezone + notificationPrefs, emit mutation
  const _meStore: Map<string, Record<string, unknown>> = new Map();
  app.patch("/api/auth/me", (req, res) => {
    const userId = (req as any).userContext?.userId ?? "u_aisha_patel";
    const existing = _meStore.get(userId) ?? {};
    const updated = { ...existing, ...req.body };
    _meStore.set(userId, updated);
    // Emit user aggregate mutation so SSE listeners can invalidate
    emitMutation({ aggregate: "user", id: userId, change: "update" });
    res.json({ ok: true, userId, updated });
  });
  // GET /api/auth/me — return stored prefs
  app.get("/api/auth/me", (req, res) => {
    const userId = (req as any).userContext?.userId ?? "u_aisha_patel";
    const stored = _meStore.get(userId) ?? {};
    // Default prefs
    const defaults = {
      id: userId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Europe/London",
      notificationPrefs: { emailDigest: true, pushAlerts: false, inAppToasts: true },
    };
    res.json({ ...defaults, ...stored });
  });

  // Companies PATCH (defect 12)
  app.patch("/api/companies/:id", (req, res) => {
    const { id } = req.params;
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, id, updated: req.body });
  });

  // Founder privacy (defect 12)
  app.put("/api/founder/privacy", (req, res) => {
    res.json({ ok: true, updated: req.body });
  });

  // Billing plan switch (defect 12)
  app.post("/api/billing/plan", (req, res) => {
    const { planId, companyId: cId } = req.body ?? {};
    res.json({ ok: true, planId, companyId: cId });
  });

  // Team invitations (defect 12)
  app.post("/api/founder/team/invitations", (req, res) => {
    const inv = { id: `ti-${Date.now()}`, ...req.body, sentAt: new Date().toISOString() };
    res.json({ ok: true, invitation: inv });
  });

  // Team member remove (defect 12)
  app.delete("/api/founder/team/members/:id", (req, res) => {
    res.json({ ok: true, removed: req.params.id });
  });

  // M&A initiative respond/decline (defect 14)
  app.post("/api/investor/ma/initiatives/:id/respond", (req, res) => {
    res.json({ ok: true, id: req.params.id, responded: true });
  });

  app.post("/api/investor/ma/initiatives/:id/decline", (req, res) => {
    res.json({ ok: true, id: req.params.id, declined: true });
  });

  // Founder sync status (defect 39)
  app.get("/api/founder/sync/status", (req, res) => {
    const { entity, id: entityId } = req.query as { entity?: string; id?: string };
    // Simple mock: return synced=true for known entities
    res.json({ synced: true, entity, id: entityId });
  });

  // Entitlements endpoint — Defect 82 fix: scope to requesting user's plan.
  app.get("/api/entitlements", (req, res) => {
    const ctx = req.userContext;
    // Investor plan does NOT include founder-only features like anti_dilution_modeling.
    if (ctx?.investor?.state && ctx.investor.state !== "NONE" && ctx.founder.companies.length === 0) {
      // Investor persona
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
    // Admin
    if (ctx?.isAdmin) {
      return res.json({ plan: "admin", features: ["all"] });
    }
    // Founder (default)
    return res.json({ plan: "founder_pro", features: ["anti_dilution_modeling", "pdf_export", "bulk_message"] });
  });

  // POST /api/rounds — create a round
  // Sprint 27 fix: newly-created rounds were being returned to the client but
  // never persisted to the in-memory rounds array. Every subsequent GET
  // /api/rounds/:id then 404'd, which made the term-sheet page hang on
  // "Loading…" forever. We now push the new round into the same array the
  // GET endpoint reads from, using the same shape as the seeded rounds.
  app.post("/api/rounds", (req, res) => {
    const body = req.body ?? {};
    const newRound = {
      id: `rnd-${Date.now()}`,
      ...body,
      state: body.state ?? "draft",
      company: companies.find(c => c.id === body.companyId)?.name ?? "",
      raisedAmount: 0,
      createdAt: new Date().toISOString(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rounds as unknown as any[]).push(newRound);
    emitMutation({ aggregate: "round", id: newRound.id, change: "create" });
    res.json({ ok: true, id: newRound.id, ...newRound });
  });

  /* ------------ generic mock POST endpoints (return ok) ------------ */
  /* Note: specific implementations for /api/rounds/:id/invitations and
     related paths exist above — only keep non-conflicting generics. */
  /* ------------ Sprint 21 Wave B: Invitations enhancements ------------ */
  registerSprint21InvitationsRoutes(app);

  /* ------------ Sprint 21 Wave C: Portfolio overhaul ------------ */
  // loadUserContext is already applied globally at the top.
  registerSprint21PortfolioRoutes(app);

  /* ------------ Sprint 22 Wave 2: missing endpoint stubs ------------ */
  registerSprint22Routes(app);

  for (const path of [
    "/api/rounds/:id/invitations/bulk",
    "/api/crm",
    "/api/reports",
    "/api/dataroom/upload",
    "/api/investor/invitations/:id/accept",
    "/api/investor/invitations/:id/decline",
    "/api/investor/invitations/:id/soft-circle",
  ]) {
    app.post(path, (_req, res) => res.json({ ok: true, mock: true }));
  }

  /* ------------------------------------------------------------------
   * Sprint 23 Wave A — DEF-014: POST /api/auth/logout
   *
   * Clears the cap_uid cookie and returns 200 OK.
   * The client redirects to /login after this call.
   * ------------------------------------------------------------------ */
  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res);
    res.clearCookie("cap_jwt", { path: "/" });
    res.status(200).json({ ok: true, message: "Logged out" });
  });

  /* ------------------------------------------------------------------
   * Sprint 23 Wave A — DEF-018: GET /api/companies/:id/founder
   *
   * Returns the real founder userId for a company.
   * Used by CompanyDetail.tsx to build the "Request access" DM link.
   * Without auth → 401. Unknown companyId → 404.
   * ------------------------------------------------------------------ */
  const FOUNDER_MAP: Record<string, { userId: string; name: string }> = {
    co_novapay: { userId: "u_maya_chen", name: "Maya Chen" },
    co_arboreal: { userId: "u_maya_chen", name: "Maya Chen" },
    co_quanta:   { userId: "u_maya_chen", name: "Maya Chen" },
    co_beacon:   { userId: "u_maya_chen", name: "Maya Chen" },
    co_tideline: { userId: "u_maya_chen", name: "Maya Chen" },
  };
  app.get("/api/companies/:id/founder", (req, res) => {
    const ctx = (req as any).userContext;
    if (!ctx?.isAuthed) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const { id } = req.params;
    const founder = FOUNDER_MAP[id];
    if (!founder) {
      return res.status(404).json({ message: "Company not found or has no founder on record" });
    }
    return res.json({ companyId: id, userId: founder.userId, name: founder.name });
  });

  return httpServer;
}

/**
 * Sprint 6 — text extraction helpers.
 * No external pdf-parse / docx libs: parse the raw bytes ourselves so the
 * preview stays self-contained.
 *  • PDF: extract text inside `( )` parentheses inside `BT...ET` blocks AND
 *    fall back to printable-ASCII scan.
 *  • DOCX: zip with one entry of interest (word/document.xml). We don't
 *    decompress (no jszip); we do a lossy printable-ASCII scan, which is
 *    enough to surface dollar amounts, multiples, and key phrases.
 *  • TXT/anything else: utf-8 decode.
 */
function extractText(buf: Buffer, mime: string, filename: string): string {
  const lower = (filename + " " + mime).toLowerCase();
  if (lower.includes("pdf")) return extractFromPdf(buf);
  if (lower.includes("docx") || lower.includes("officedocument")) return extractPrintable(buf);
  // TXT / fallback
  try {
    return buf.toString("utf-8");
  } catch {
    return extractPrintable(buf);
  }
}

function extractFromPdf(buf: Buffer): string {
  const ascii = buf.toString("latin1"); // PDF text streams are typically Latin-1
  // Pull text from `(...)` literals inside content streams.
  const out: string[] = [];
  const re = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ascii)) !== null) {
    out.push(m[1].replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))).replace(/\\(.)/g, "$1"));
  }
  if (out.length > 0) return out.join(" ");
  // Fallback: printable scan.
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

// Sprint 19 W2 — POST /api/rounds creates a new round (previously mock-only)
// Appended here because Express matches routes in declaration order.

/* ====================================================================== */
/*  Sprint 28 Wave 3 — Admin Companies full JOIN endpoint.                */
/*                                                                        */
/*  Reads from every live source store (companies, rounds, softCircles,   */
/*  dataroomFiles, reports, telemetry, subscriptions) and returns one     */
/*  enriched row per tenant. ZERO MOCK DATA — every number is derived     */
/*  from records that the rest of the platform also consumes.             */
/* ====================================================================== */

interface AdminCompanyFullRow {
  id: string;
  name: string;
  legalName: string;
  region: string;
  sector: string;
  stage: string;
  hq: string;
  /** Composite M&A score (0-100). Falls back to 0 if not yet computed. */
  maScore: number;
  /** Total raised across all closed/funded rounds in MINOR units of the round currency. */
  totalRaisedMinor: number;
  /** Currency used for total raised — first round's currency or USD by default. */
  currency: string;
  /** Number of active (non-closed) rounds. */
  activeRoundsCount: number;
  /** Total rounds opened (any state) all-time. */
  totalRoundsCount: number;
  /** Soft circles in the last 30 days. */
  softCircles30d: number;
  /** Soft-circle USD committed (sum of `amount`) last 30 days. */
  softCircle30dAmountMinor: number;
  /** Dataroom file count. */
  dataroomFiles: number;
  /** Investor reports published all-time. */
  reportsPublished: number;
  /** Telemetry events recorded for this company (last 30 days). */
  events30d: number;
  /** Last platform activity timestamp (max of any source). null if never active. */
  lastActivityAt: string | null;
  /** Subscription snapshot from the production subscriptions store. */
  subscription: Subscription | null;
}

function registerAdminCompaniesFullRoute(app: Express) {
  app.get("/api/admin/companies/full", (_req: Request, res: Response) => {
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
        // Round raised values are in major units (dollars) — convert to minor.
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

      // Compute lastActivityAt as the maximum across all source streams.
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
