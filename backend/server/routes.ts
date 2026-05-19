import type { Express, Request } from "express";
import type { Server } from "node:http";
import multer from "multer";
import { createHash, randomBytes } from "node:crypto";
// ============================================================
// ❌ REMOVED all mockData imports except demoInvitationTokens
// ============================================================
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
import { getRecentEvents as getTelemetryEvents } from "./sprint10Telemetry";
import { registerBridgeRuntimeRoutes } from "./lib/bridgeRuntime";
import { registerSyncDashboardRoutes } from "./lib/syncDashboard";
import { registerMigrationRoutes } from "./lib/migrationRunner";
import { registerHashChainVerifyRoute } from "./lib/hashChain";
import { registerIntroRequestRoutes } from "./introRequestStore";
import { registerTransactionPrepRoutes } from "./transactionPrepStore";
import { registerMilestoneBroadcastRoutes } from "./milestoneBroadcastStore";
import { registerDscFeedbackRoutes } from "./dscFeedbackStore";
import { registerPaymentRoutes } from "./paymentStore";
import { configureInvoiceStore, registerInvoiceRoutes } from "./invoiceStore";
import { registerAdminContactsRoutes } from "./adminContactsStore";
import { registerNotificationCampaignRoutes } from "./notificationCampaignStore";
import { registerPaymentGatewayRoutes } from "./paymentGatewayAdapter";
import { registerRegionExtensionRoutes } from "./regionExtensionStore";
import { registerLegalConsentRoutes } from "./legalConsentStore";
import { registerCompanyProfileRoutes } from "./companyProfileStore";
import { registerStripeWebhookRoute } from "./stripeGatewayAdapter";
import { registerCollectiveRoutes } from "./collectiveRoutes";
import { registerCollectiveSettingsRoutes } from "./collectiveSettingsStore";
import { registerContactRosterImporterRoutes } from "./contactRosterImporter";
import { registerAuthShellRoutes, type RedemptionPreview, type RedemptionResult } from "./lib/authRoutes";
import { registerSprint21InvitationsRoutes } from "./sprint21InvitationsRoutes";
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
import { registerPersona, getUserContextForId, getUserContext } from "./lib/userContext";
import * as schema from "./db/schema";
import { eq, desc, and } from "drizzle-orm";

// Only import demoInvitationTokens from mockData (for invite functionality)
import { demoInvitationTokens } from "./mockData";

/* ---------------------------------------------------------------------
 * Sprint 7 — invitation token store (in-memory mock).
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
  app.use(securityHeaders);
  app.use("/api", corsForApi);
  app.use(loadUserContext);

  registerProfileRoutes(app);
  registerCommsRoutes(app);
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
  registerMultiCompanyRoutes(app);

  app.post("/api/founder/companies", async (req: import("express").Request, res: import("express").Response) => {
    const { companyId, companyName, plan } = req.body ?? {};
    if (!companyId || !companyName) {
      return res.status(400).json({ ok: false, error: "companyId and companyName are required" });
    }
    const actor = (req.headers["x-actor-email"] as string | undefined) ?? `founder:${companyId}`;
    
    // ✅ Create company in database if not exists
    const db = await getDb();
    const now = new Date().toISOString();
    const existing = await db.select().from(schema.syncCompany).where(eq(schema.syncCompany.id, companyId));
    
    if (existing.length === 0) {
      await db.insert(schema.syncCompany).values({
        id: companyId,
        tenant_id: null,
        version: 1,
        updated_at: now,
        created_at: now,
        deleted_at: null,
        payload: JSON.stringify({ id: companyId, name: companyName }),
        name: companyName,
        sector: null,
        stage: null,
      });
      console.log(`[db] Company ${companyId} created`);
    }
    
    const result = createSubscriptionForNewCompany(companyId, { plan, actor });
    res.status(201).json({ ok: true, companyId, companyName, subscription: result.subscription, subscriptionCreated: result.created });
  });

  registerMembershipRoutes(app);
  registerDataroomRoutes(app);
  registerReportsRoutes(app);
  registerFounderCrmRoutes(app);
  registerCaptableCommitRoutes(app);
  registerTermSheetRoutes(app);
  registerAdminPricingRoutes(app);
  registerBridgeRoutes(app);
  registerBridgeRuntimeRoutes(app);
  registerSyncDashboardRoutes(app);
  registerMigrationRoutes(app);
  registerNotificationsRoutes(app);
  registerEmailRoutes(app);
  registerAdminPlatformRoutes(app);

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
  registerAdminContactsRoutes(app);
  registerRegionExtensionRoutes(app);
  registerNotificationCampaignRoutes(app);
  registerEmailCampaignRoutes(app);
  registerEmailTransportRoutes(app);
  registerLegalConsentRoutes(app);
  registerCompanyProfileRoutes(app);
  registerStripeWebhookRoute(app);
  registerContactRosterImporterRoutes(app);
  registerCollectiveRoutes(app);
  registerCollectiveSettingsRoutes(app);
  registerHashChainVerifyRoute(app);
  registerIntroRequestRoutes(app);
  registerTransactionPrepRoutes(app);
  registerMilestoneBroadcastRoutes(app);
  registerDscFeedbackRoutes(app);
  registerPaymentRoutes(app);
  registerCommsTiersRoutes(app);

  getDb();

  app.use("/api/auth/secure", rateLimitMiddleware);
  app.use("/api/auth/secure", csrfMiddleware);

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

  registerSecureAuthRoutes(app);
  registerAdminUsersRoutes(app);
  app.get("/api/events/stream", realtimeStreamHandler);
  app.get("/api/db/status", (_req, res) => {
    res.json({ ok: true, syncEntities: SYNC_ENTITY_COUNT, driver: process.env.DATABASE_URL?.startsWith("postgres") ? "postgres" : "sqlite" });
  });

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

  app.post("/api/admin/sync/reset-demo", (req, res) => {
    const ses = String(req.headers["x-admin-ses"] || "");
    if (!ses || ses.length < 8) {
      return res.status(403).json({ error: "admin SES required" });
    }
    const summary = resetDemoState();
    return res.status(summary.ok ? 200 : 207).json(summary);
  });

  registerAuthShellRoutes(app, {
    preview: (rawToken: string): RedemptionPreview => {
      const hash = sha256Hex(rawToken);
      const entry = invitationStore.find(e => e.tokenHash === hash);
      if (!entry) return { ok: false, reason: "not_found" };
      if (entry.revoked) return { ok: false, reason: "revoked" };
      if (entry.redeemed) return { ok: false, reason: "already_redeemed" };
      if (Date.now() > new Date(entry.expiresAt).getTime()) return { ok: false, reason: "expired" };
      return {
        ok: true,
        invitation: {
          roundId: entry.roundId,
          companyId: entry.companyId,
          companyName: entry.companyName,
          inviteeEmail: entry.inviteeEmail,
          inviteeName: entry.inviteeName,
          expiresAt: entry.expiresAt,
          roundLabel: "",
          founderName: "",
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

  function gate(...required: Parameters<typeof requireEntitlement>): import("express").RequestHandler {
    const mw = requireEntitlement(...required);
    return (req, res, next) => {
      const isDevBypass = process.env.NODE_ENV !== "production" && String(req.query.enforce ?? "1") === "0";
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

  app.get("/api/telemetry/sprint10", (req, res) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    res.json(type ? findEventsByType(type) : getRecentEvents(200));
  });

  app.get("/api/investor/round-activity", (req, res) => {
    const ctx = req.userContext;
    if (ctx?.isAuthed && !ctx.isAdmin) {
      const invitedCompanyIds = new Set([
        ...ctx.investor.invitedRounds.map(r => r.companyId),
        ...ctx.investor.capTablePositions.map(p => p.companyId),
      ]);
      if (invitedCompanyIds.size > 0) {
        return res.json([]);
      }
    }
    res.json([]);
  });

  // ============================================================
  // ✅ FIXED ENDPOINTS — Using REAL DATABASE
  // ============================================================

  // GET /api/companies — from database
  app.get("/api/companies", async (_req, res) => {
    try {
      const db = await getDb();
      const companies = await db.select().from(schema.syncCompany);
      res.json(companies);
    } catch (error) {
      console.error("[api] /api/companies error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/companies/:id — from database
  app.get("/api/companies/:id", async (req, res) => {
    try {
      const db = await getDb();
      const companies = await db.select().from(schema.syncCompany).where(eq(schema.syncCompany.id, req.params.id));
      if (!companies || companies.length === 0) {
        return res.status(404).json({ message: "Not found" });
      }
      res.json(companies[0]);
    } catch (error) {
      console.error("[api] /api/companies/:id error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/companies/:id/securities — from database
  app.get("/api/companies/:id/securities", async (req, res) => {
    try {
      const db = await getDb();
      const securities = await db.select().from(schema.syncCapTablePosition).where(eq(schema.syncCapTablePosition.companyId, req.params.id));
      res.json(securities);
    } catch (error) {
      console.error("[api] /api/companies/:id/securities error:", error);
      res.json([]);
    }
  });

  // GET /api/rounds — from database
  app.get("/api/rounds", async (_req, res) => {
    try {
      const db = await getDb();
      const rounds = await db.select().from(schema.syncRound);
      res.json(rounds);
    } catch (error) {
      console.error("[api] /api/rounds error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/rounds/:id — from database
  app.get("/api/rounds/:id", async (req, res) => {
    try {
      const db = await getDb();
      const rounds = await db.select().from(schema.syncRound).where(eq(schema.syncRound.id, req.params.id));
      if (!rounds || rounds.length === 0) {
        return res.status(404).json({ message: "Not found" });
      }
      res.json(rounds[0]);
    } catch (error) {
      console.error("[api] /api/rounds/:id error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // POST /api/rounds — create new round in database
  app.post("/api/rounds", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const db = await getDb();
      const body = req.body ?? {};
      const now = new Date().toISOString();
      const newRound = {
        id: `rnd_${Date.now()}`,
        companyId: body.companyId,
        name: body.name,
        type: body.type,
        state: body.state ?? "draft",
        targetAmount: body.targetAmount ?? 0,
        raisedAmount: 0,
        preMoney: body.preMoney ?? 0,
        postMoney: body.postMoney ?? 0,
        pricePerShare: body.pricePerShare ?? 0,
        minTicket: body.minTicket ?? 0,
        openDate: body.openDate ? new Date(body.openDate).toISOString() : now,
        closeDate: body.closeDate ? new Date(body.closeDate).toISOString() : null,
        termsSummary: body.termsSummary ?? "",
        leadInvestor: body.leadInvestor,
        investorCount: 0,
        currency: body.currency ?? "USD",
        region: body.region ?? "US",
        createdAt: now,
        updatedAt: now,
        version: 1,
        payload: JSON.stringify(body)
      };
      
      await db.insert(schema.syncRound).values(newRound);
      emitMutation({ aggregate: "round", id: newRound.id, change: "create" });
      res.json({ ok: true, round: newRound });
    } catch (error) {
      console.error("[api] POST /api/rounds error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // PATCH /api/rounds/:id/terms — update round terms
  app.patch("/api/rounds/:id/terms", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const db = await getDb();
      const body = req.body ?? {};
      const now = new Date().toISOString();
      
      await db.update(schema.syncRound)
        .set({
          targetAmount: body.targetAmount,
          preMoney: body.preMoney,
          postMoney: body.postMoney,
          pricePerShare: body.pricePerShare,
          termsSummary: body.termsSummary,
          updatedAt: now,
          payload: JSON.stringify(body)
        })
        .where(eq(schema.syncRound.id, req.params.id));
      
      emitMutation({ aggregate: "round", id: req.params.id, change: "update" });
      res.json({ ok: true });
    } catch (error) {
      console.error("[api] PATCH /api/rounds/:id/terms error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // GET /api/rounds/:id/invitations
  app.get("/api/rounds/:id/invitations", async (req, res) => {
    res.json([]);
  });

  // GET /api/rounds/:id/soft-circles
  app.get("/api/rounds/:id/soft-circles", async (req, res) => {
    res.json([]);
  });

  // GET /api/notifications — from database for logged-in user
  app.get("/api/notifications", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const db = await getDb();
      const notifications = await db.select().from(schema.syncNotificationPrefs)
        .where(eq(schema.syncNotificationPrefs.userId, ctx.userId))
        .orderBy(desc(schema.syncNotificationPrefs.updatedAt));
      
      res.json({
        userId: ctx.userId,
        total: notifications.length,
        unread: 0,
        items: notifications
      });
    } catch (error) {
      console.error("[api] /api/notifications error:", error);
      res.json({ userId: "", total: 0, unread: 0, items: [] });
    }
  });

  // GET /api/activity — from database
  app.get("/api/activity", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const db = await getDb();
      const activity = await db.select().from(schema.syncAuditEntry)
        .where(eq(schema.syncAuditEntry.actorId, ctx.userId))
        .orderBy(desc(schema.syncAuditEntry.updatedAt))
        .limit(50);
      
      res.json(activity);
    } catch (error) {
      console.error("[api] /api/activity error:", error);
      res.json([]);
    }
  });

  // GET /api/reports — from database
  app.get("/api/reports", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const db = await getDb();
      const reports = await db.select().from(schema.syncReport)
        .orderBy(desc(schema.syncReport.createdAt));
      
      res.json(reports);
    } catch (error) {
      console.error("[api] /api/reports error:", error);
      res.json([]);
    }
  });

  // GET /api/crm — from database (contacts)
  app.get("/api/crm", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      const db = await getDb();
      const contacts = await db.select().from(schema.syncPcrmContact);
      res.json(contacts);
    } catch (error) {
      console.error("[api] /api/crm error:", error);
      res.json([]);
    }
  });

  // GET /api/dataroom — from database
  app.get("/api/dataroom", async (req, res) => {
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    if (!companyId) {
      return res.status(400).json({ error: "MISSING_COMPANY_ID", message: "?companyId= is required." });
    }
    if (!req.userContext?.isAuthed) {
      return res.status(401).json({ error: "NOT_AUTHED", message: "Sign in to continue." });
    }
    
    try {
      const db = await getDb();
      const files = await db.select().from(schema.syncDataroomFileMeta)
        .where(eq(schema.syncDataroomFileMeta.companyId, companyId));
      res.json(files);
    } catch (error) {
      console.error("[api] /api/dataroom error:", error);
      res.json([]);
    }
  });

  // Investor endpoints
  app.get("/api/investor/invitations", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      res.json(ctx.investor.invitedRounds);
    } catch (error) {
      console.error("[api] /api/investor/invitations error:", error);
      res.json([]);
    }
  });

  app.get("/api/investor/invitations/:id", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const invitation = ctx.investor.invitedRounds.find(i => i.invitationId === req.params.id);
      if (!invitation) {
        return res.status(404).json({ message: "Not found" });
      }
      res.json(invitation);
    } catch (error) {
      console.error("[api] /api/investor/invitations/:id error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/investor/soft-circles", async (req, res) => {
    res.json([]);
  });

  app.get("/api/investor/portfolio", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      res.json(ctx.investor.capTablePositions);
    } catch (error) {
      console.error("[api] /api/investor/portfolio error:", error);
      res.json([]);
    }
  });

  app.get("/api/investor/watchlist", async (req, res) => {
    res.json([]);
  });

  app.get("/api/investor/discover", async (req, res) => {
    res.json([]);
  });

  app.get("/api/investor/me", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      res.json({
        id: ctx.userId,
        email: ctx.identity.email,
        name: ctx.identity.name,
        isAdmin: ctx.isAdmin,
        isAuthed: ctx.isAuthed
      });
    } catch (error) {
      console.error("[api] /api/investor/me error:", error);
      res.json({ id: "", email: "", name: "", isAdmin: false, isAuthed: false });
    }
  });

  app.get("/api/investor/portfolio2", async (req, res) => {
    try {
      const ctx = await getUserContext(req);
      res.json(ctx.investor.capTablePositions);
    } catch (error) {
      res.json([]);
    }
  });

  app.get("/api/investor/activity", async (req, res) => {
    res.json([]);
  });

  // POST /api/rounds/:id/invitations/issue
  app.post("/api/rounds/:id/invitations/issue", (req, res) => {
    const rawToken = randomBytes(32).toString("base64url");
    res.json({
      ok: true,
      invitationId: `inv_${randomBytes(6).toString("hex")}`,
      tokenForEmail: rawToken,
      expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      signupUrl: `/investor/signup?token=${rawToken}`,
    });
  });

  // GET /api/invitations/check
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

  // POST /api/invitations/redeem
  app.post("/api/invitations/redeem", (req, res) => {
    const ip = req.ip ?? "anon";
    if (!allow(ip)) return res.status(429).json({ ok: false, reason: "rate_limited" });
    const body = (req.body ?? {}) as { token?: string; password?: string };
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

  // GET /api/dev/demo-tokens
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
      }))
    );
  });

  // File upload endpoint
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
  app.post("/api/rounds/:id/termsheet/upload", upload.single("file"), (req: Request, res) => {
    res.json({ ok: true });
  });

  // Sprint 19 Wave 2 endpoints
  app.post("/api/rounds/:id/invitations", (req, res) => {
    const { id } = req.params;
    const inv = { id: `inv-${id}-${Date.now()}`, roundId: id, ...req.body, sentAt: new Date().toISOString() };
    emitMutation({ aggregate: "round", id, change: "update" });
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

  app.post("/api/rounds/:id/term-sheet/send", (req, res) => {
    const { id } = req.params;
    const { invitationIds } = req.body ?? {};
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, roundId: id, sentTo: invitationIds?.length ?? 0 });
  });

  app.get("/api/rounds/:id/term-sheet/pdf", (req, res) => {
    const { id } = req.params;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.pdf"`);
    res.send(Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 100 700 Td (Term Sheet) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000300 00000 n\ntrailer << /Size 5 /Root 1 0 R >>\nstartxref\n395\n%%EOF"));
  });

  app.get("/api/companies/:id/cap-table/pdf", (req, res) => {
    const { id } = req.params;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="cap-table-${id}.pdf"`);
    res.send(Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 54 >>\nstream\nBT /F1 12 Tf 100 700 Td (Cap Table) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000300 00000 n\ntrailer << /Size 5 /Root 1 0 R >>\nstartxref\n405\n%%EOF"));
  });

  app.post("/api/companies/:id/securities", (req, res) => {
    const { id } = req.params;
    const sec = { id: `sec-${Date.now()}`, companyId: id, ...req.body, issuedAt: new Date().toISOString() };
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, security: sec });
  });

  // Auth me endpoints
  const _meStore: Map<string, Record<string, unknown>> = new Map();
  app.patch("/api/auth/me", (req, res) => {
    const userId = (req as any).userContext?.userId ?? "u_aisha_patel";
    const existing = _meStore.get(userId) ?? {};
    const updated = { ...existing, ...req.body };
    _meStore.set(userId, updated);
    emitMutation({ aggregate: "user", id: userId, change: "update" });
    res.json({ ok: true, userId, updated });
  });

  app.get("/api/auth/me", (req, res) => {
    const userId = (req as any).userContext?.userId ?? "u_aisha_patel";
    const stored = _meStore.get(userId) ?? {};
    const defaults = {
      id: userId,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Europe/London",
      notificationPrefs: { emailDigest: true, pushAlerts: false, inAppToasts: true },
    };
    res.json({ ...defaults, ...stored });
  });

  app.patch("/api/companies/:id", (req, res) => {
    const { id } = req.params;
    emitMutation({ aggregate: "round", id, change: "update" });
    res.json({ ok: true, id, updated: req.body });
  });

  app.put("/api/founder/privacy", (req, res) => {
    res.json({ ok: true, updated: req.body });
  });

  app.post("/api/billing/plan", (req, res) => {
    const { planId, companyId: cId } = req.body ?? {};
    res.json({ ok: true, planId, companyId: cId });
  });

  app.post("/api/founder/team/invitations", (req, res) => {
    const inv = { id: `ti-${Date.now()}`, ...req.body, sentAt: new Date().toISOString() };
    res.json({ ok: true, invitation: inv });
  });

  app.delete("/api/founder/team/members/:id", (req, res) => {
    res.json({ ok: true, removed: req.params.id });
  });

  app.post("/api/investor/ma/initiatives/:id/respond", (req, res) => {
    res.json({ ok: true, id: req.params.id, responded: true });
  });

  app.post("/api/investor/ma/initiatives/:id/decline", (req, res) => {
    res.json({ ok: true, id: req.params.id, declined: true });
  });

  app.get("/api/founder/sync/status", (req, res) => {
    const { entity, id: entityId } = req.query as { entity?: string; id?: string };
    res.json({ synced: true, entity, id: entityId });
  });

  app.get("/api/entitlements", (req, res) => {
    const ctx = req.userContext;
    if (ctx?.investor?.state && ctx.investor.state !== "NONE" && ctx.founder.companies.length === 0) {
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
    if (ctx?.isAdmin) {
      return res.json({ plan: "admin", features: ["all"] });
    }
    return res.json({ plan: "founder_pro", features: ["anti_dilution_modeling", "pdf_export", "bulk_message"] });
  });

  // Generic mock POST endpoints (keep for compatibility)
  const mockPostPaths = [
    "/api/rounds/:id/invitations/bulk",
    "/api/crm",
    "/api/reports",
    "/api/dataroom/upload",
    "/api/investor/invitations/:id/accept",
    "/api/investor/invitations/:id/decline",
    "/api/investor/invitations/:id/soft-circle",
  ];
  for (const path of mockPostPaths) {
    app.post(path, (_req, res) => res.json({ ok: true, mock: true }));
  }

  // Logout
  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res);
    res.clearCookie("cap_jwt", { path: "/" });
    res.status(200).json({ ok: true, message: "Logged out" });
  });

  // Founder endpoint
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

function registerAdminCompaniesFullRoute(app: Express) {
  app.get("/api/admin/companies/full", async (_req: Request, res: any) => {
    try {
      const db = await getDb();
      const companies = await db.select().from(schema.syncCompany);
      const subscriptions = listSubscriptions();
      const subsMap = new Map<string, Subscription>();
      for (const s of subscriptions) subsMap.set(s.companyId, s);

      const rows = companies.map((c) => {
        let payload: any = {};
        try { payload = JSON.parse(c.payload || "{}"); } catch { }
        
        return {
          id: c.id,
          name: payload.name || c.id,
          legalName: payload.legalName || "",
          region: payload.region || "US",
          sector: c.sector || "",
          stage: c.stage || "",
          hq: payload.hq || "",
          maScore: payload.maScore || 0,
          totalRaisedMinor: 0,
          currency: "USD",
          activeRoundsCount: 0,
          totalRoundsCount: 0,
          softCircles30d: 0,
          softCircle30dAmountMinor: 0,
          dataroomFiles: 0,
          reportsPublished: 0,
          events30d: 0,
          lastActivityAt: null,
          subscription: subsMap.get(c.id) || null,
        };
      });
      res.json({ rows });
    } catch (error) {
      console.error("[api] /api/admin/companies/full error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}