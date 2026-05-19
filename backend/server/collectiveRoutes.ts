/**
 * Wave C-3 + C-4 — Collective API Routes
 *
 * All collective-scoped endpoints. Registered from server/routes.ts.
 *
 * Endpoints:
 *   GET  /api/collective/dashboard               — KPI cards + activity feed
 *   GET  /api/collective/dealroom/companies       — Deal room company list
 *   GET  /api/collective/companies               — All companies (broader view)
 *   GET  /api/collective/members                 — Member directory (PII-filtered)
 *   GET  /api/collective/soft-circles            — Soft-circle aggregates
 *   GET  /api/collective/dsc/pipeline            — Kanban grouped by transactionPrepStatus
 *   GET  /api/collective/dsc/scores              — Latest DSC scores table
 *   GET  /api/collective/dsc/composite/:companyId — Live composite (no write)
 *   POST /api/collective/dsc/compute/:companyId  — Compute + write new DscFeedback entry
 *   GET  /api/collective/activity               — Activity feed
 */

import type { Express, Request, Response } from "express";
import { onMutation } from "./lib/eventBus";
import { getCompanyProfile, getAllProfiles } from "./companyProfileStore";
import { partnerDealPromotionsStore } from "./partnerWorkspaceStore";
import { getSubscription } from "./subscriptionsStore";
import { getLatestForCompany, listFeedback, ingestDscScores } from "./dscFeedbackStore";
import { getChannelByCompany, listChannels, TRANSACTION_PREP_THREADS } from "./transactionPrepStore";
import { listContacts } from "./adminContactsStore";
import { getAuditLog } from "./adminPlatformStore";
import { getOutbox } from "./bridgeStore";
import { computeCompositeForCompany, computeAllComposites, computeAutoTier } from "./dscScoringEngine";
import { emitBridgeEvent } from "./bridgeStore";
import { companies as canonicalCompanies, softCircles as canonicalSoftCircles, rounds as canonicalRounds } from "./mockData";
import { getRecentEvents } from "./sprint10Telemetry";

/* ============================================================
 * Helper: safe division
 * ============================================================ */

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

/* ============================================================
 * Patch v5 — production seed strip (defense in depth)
 *
 * The TEST PARTNER, INC sandbox row (and any other isSeed-flagged
 * AdminContact) MUST never leak into production responses, regardless
 * of the DEMO_SEED_ENABLED gate that already prevents seeds from
 * loading at boot — if the gate is ever bypassed (in-memory persistence
 * across tsx reloads, env var leaked, etc.) we still won’t leak.
 * ============================================================ */
function isProdSeedStripActive(): boolean {
  return process.env.NODE_ENV === "production";
}

function filterSeedInProd<T extends { isSeed?: boolean }>(rows: T[]): T[] {
  if (!isProdSeedStripActive()) return rows;
  return rows.filter((r) => !r.isSeed);
}

/* ============================================================
 * Collective-relevant bridge event types for activity feed
 * ============================================================ */

const COLLECTIVE_RELEVANT_EVENT_TYPES = new Set([
  "company.profile.updated",
  "company.ma_intelligence.updated",
  "transaction_prep.updated",
  "dsc.score.recomputed",
  "collective.member.updated",
  "collective.deal_room.opened",
  "profile.completion_changed",
]);

/* ============================================================
 * Route registration
 * ============================================================ */

/**
 * Auto-recompute listener: when transaction_prep is updated, recompute the
 * DSC composite and emit dsc.score.recomputed. This runs once at startup.
 */
let _listenerRegistered = false;
export function registerTransactionPrepRecomputeListener(): void {
  if (_listenerRegistered) return;
  _listenerRegistered = true;

  onMutation((evt) => {
    if (evt.aggregate !== "transaction_prep" && evt.change !== "update") return;
    const companyId = evt.id;
    if (!companyId) return;

    // Compute without writing — only auto-publish if composite is non-null
    const composite = computeCompositeForCompany(companyId);
    if (!composite) return;

    // Auto-ingest a new score entry
    const tierMap: Record<string, "watch" | "qualified" | "featured" | "priority"> = {
      D: "watch", C: "qualified", B: "featured", A: "priority",
    };
    try {
      ingestDscScores({
        companyId,
        tier: tierMap[composite.autoTier] ?? "watch",
        dimensions: {
          composite: composite.compositeScore,
          mna_sub_score: composite.mnaScore,
          round_sub_score: composite.roundScore,
        },
        narrative: `Auto-recomputed on transaction_prep.updated event. Composite: ${composite.compositeScore}`,
        collectiveShortlist: [],
      });
      emitBridgeEvent({
        eventType: "dsc.score.recomputed",
        aggregateId: companyId,
        aggregateKind: "company",
        payload: {
          compositeScore: composite.compositeScore,
          autoTier: composite.autoTier,
          triggeredBy: "transaction_prep.updated",
        },
      });
    } catch {
      // swallow errors in listener to not crash the server
    }
  });
}

export function registerCollectiveRoutes(app: Express): void {
  // Register the auto-recompute listener once
  registerTransactionPrepRecomputeListener();

  /* -----------------------------------------------------------------
   * GET /api/collective/dashboard
   * KPI cards computed live from existing stores.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/dashboard", (_req: Request, res: Response) => {
    const allContacts = filterSeedInProd(listContacts({}));
    const allProfiles = getAllProfiles();

    // Total members: adminContacts with kind investor or consortium_partner
    const totalMembers = allContacts.filter(
      (c) => c.kind === "investor" || c.kind === "consortium_partner"
    ).length;

    // Active collective-tier subscriptions: approximate via active status
    const activeSubscriptions = allContacts.filter(
      (c) => (c.kind === "investor" || c.kind === "consortium_partner") && c.status === "active"
    ).length;

    // Companies in Deal Room: transactionPrepStatus in (exploring, active, closing)
    const dealRoomStatuses = new Set(["exploring", "active", "closing"]);
    const companiesInDealRoom = allProfiles.filter(
      (p) => p.transactionPrepStatus && dealRoomStatuses.has(p.transactionPrepStatus)
    ).length;

    // DSC pipeline depth: dscFeedback entries where tier != closed (all entries qualify)
    const dscPipelineDepth = listFeedback().length;

    // Pending applications: all collective apps in "pending" state
    // (collectiveAppStore doesn't expose a list count easily — we query via telemetry)
    // Use telemetry event count as a proxy
    const recentTelemetry = getRecentEvents(200);
    const pendingApps = recentTelemetry.filter(
      (e) => e.eventType === "collective.application_submitted"
    ).length;

    // Recent activity feed: last 10 bridge-relevant events from bridge outbox
    let outbox: ReturnType<typeof getOutbox> = [];
    try {
      outbox = getOutbox();
    } catch {
      outbox = [];
    }

    const recentActivity = outbox
      .filter((entry) => COLLECTIVE_RELEVANT_EVENT_TYPES.has(entry.envelope.eventType as string))
      .sort((a, b) => b.envelope.occurredAt.localeCompare(a.envelope.occurredAt))
      .slice(0, 10)
      .map((entry) => ({
        eventId: entry.envelope.eventId,
        eventType: entry.envelope.eventType,
        aggregateId: entry.envelope.aggregateId,
        occurredAt: entry.envelope.occurredAt,
        status: entry.status,
      }));

    res.json({
      kpis: {
        totalMembers,
        activeSubscriptions,
        companiesInDealRoom,
        dscPipelineDepth,
        pendingApps,
      },
      recentActivity,
    });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/dealroom/companies
   * Companies opted into M&A or with open transactionPrep channels.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/dealroom/companies", (_req: Request, res: Response) => {
    const dealRoomStatuses = new Set(["exploring", "active", "closing"]);
    const allProfiles = getAllProfiles();

    // Also include companies that have a transactionPrep channel
    const channelCompanyIds = new Set(
      listChannels()
        .filter((ch) => !ch.archivedAt)
        .map((ch) => ch.companyId)
    );

    const dealRoomProfiles = allProfiles.filter(
      (p) =>
        (p.transactionPrepStatus && dealRoomStatuses.has(p.transactionPrepStatus)) ||
        channelCompanyIds.has(p.companyId)
    );

    type DealRoomEntry = {
      companyId: string;
      companyName: string;
      sector: string | null;
      stage: string | null;
      lastRaise: string | null;
      lastRaiseAmount: number | null;
      transactionPrepStatus: string;
      compositeScore: number | null;
      autoTier: string | null;
      dscTier: string | null;
      dscUpdatedAt: string | null;
      channelId: string | null;
      logoUrl: string | null;
      tagline: string | null;
      source: "profile" | "partner";
      partnerId: string | null;
      promotedAt: string | null;
    };
    const result: DealRoomEntry[] = dealRoomProfiles.map((p) => {
      const dscFeedback = getLatestForCompany(p.companyId);
      const composite = computeCompositeForCompany(p.companyId);
      const channel = getChannelByCompany(p.companyId);

      return {
        companyId: p.companyId,
        companyName: p.founderName
          ? p.founderName
          : canonicalCompanies.find((c) => c.id === p.companyId)?.name ?? p.companyId,
        sector: p.sector ?? null,
        stage: p.stage ?? null,
        lastRaise: p.lastRaiseAt ?? p.lastRaiseDate ?? null,
        lastRaiseAmount: p.lastRaiseSizeUsd ?? p.lastRaiseAmount ?? null,
        transactionPrepStatus: p.transactionPrepStatus ?? "not_pursuing",
        compositeScore: composite?.compositeScore ?? null,
        autoTier: composite?.autoTier ?? null,
        dscTier: dscFeedback?.tier ?? null,
        dscUpdatedAt: dscFeedback?.receivedAt ?? null,
        channelId: channel?.id ?? null,
        logoUrl: p.logoUrl ?? null,
        tagline: p.tagline ?? null,
        source: "profile",
        partnerId: null,
        promotedAt: null,
      };
    });

    /* -----------------------------------------------------------------
     * V5 (Patch v8) — Partner promotions consumer.
     *
     * Previously the partner workspace store recorded promotions via
     * `promoteToCollective` and emitted a bridge event, but no Collective
     * route consumed them. The Deal Room list therefore never reflected
     * partner-promoted deals (Phase 1 bug B5).
     *
     * Strategy: live (status === "live") collective-deal-room promotions
     * are merged into the existing Deal Room list. Dedup is by companyId;
     * a partner-promoted entry that targets the same company as a directly-
     * surfaced deal carries the partner badge but does not duplicate.
     * ----------------------------------------------------------------- */
    const profileById = new Map(allProfiles.map((p) => [p.companyId, p]));
    const seenCompanyIds = new Set(result.map((r) => r.companyId));
    const promotions = partnerDealPromotionsStore.listLiveCollectivePromotions();
    for (const promo of promotions) {
      if (!promo.companyId) continue;
      if (seenCompanyIds.has(promo.companyId)) {
        // Annotate existing entry with partner badge.
        const existing = result.find((r) => r.companyId === promo.companyId);
        if (existing) {
          existing.source = "profile" as const;
          existing.partnerId = promo.partnerId;
          existing.promotedAt = promo.promotedAt;
        }
        continue;
      }
      seenCompanyIds.add(promo.companyId);
      const p = profileById.get(promo.companyId);
      const dscFeedback = getLatestForCompany(promo.companyId);
      const composite = computeCompositeForCompany(promo.companyId);
      const channel = getChannelByCompany(promo.companyId);
      const canonical = canonicalCompanies.find((c) => c.id === promo.companyId);
      const entry: DealRoomEntry = {
        companyId: promo.companyId,
        companyName: canonical?.name ?? p?.founderName ?? promo.companyId,
        sector: (p?.sector ?? canonical?.sector ?? null) as string | null,
        stage: (p?.stage ?? canonical?.stage ?? null) as string | null,
        lastRaise: (p?.lastRaiseAt ?? p?.lastRaiseDate ?? null) as string | null,
        lastRaiseAmount: (p?.lastRaiseSizeUsd ?? p?.lastRaiseAmount ?? null) as number | null,
        transactionPrepStatus: p?.transactionPrepStatus ?? "exploring",
        compositeScore: composite?.compositeScore ?? null,
        autoTier: composite?.autoTier ?? null,
        dscTier: dscFeedback?.tier ?? null,
        dscUpdatedAt: dscFeedback?.receivedAt ?? null,
        channelId: channel?.id ?? null,
        logoUrl: p?.logoUrl ?? null,
        tagline: p?.tagline ?? null,
        source: "partner",
        partnerId: promo.partnerId,
        promotedAt: promo.promotedAt,
      };
      result.push(entry);
    }

    res.json({ companies: result, total: result.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/companies
   * All companies visible to the Collective.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/companies", (_req: Request, res: Response) => {
    const allProfiles = getAllProfiles();

    // Fall back to canonical companies if profileMap is sparse
    const canonicalById = new Map(canonicalCompanies.map((c) => [c.id, c]));

    const result = allProfiles.map((p) => {
      const canonical = canonicalById.get(p.companyId);
      const dscFeedback = getLatestForCompany(p.companyId);
      const composite = computeCompositeForCompany(p.companyId);

      return {
        companyId: p.companyId,
        companyName: canonical?.name ?? p.founderName ?? p.companyId,
        sector: p.sector ?? canonical?.sector ?? null,
        stage: p.stage ?? canonical?.stage ?? null,
        tagline: p.tagline ?? canonical?.description?.slice(0, 120) ?? null,
        logoUrl: p.logoUrl ?? canonical?.logoUrl ?? null,
        linkedinUrl: p.linkedinUrl ?? null,
        crunchbaseUrl: p.crunchbaseUrl ?? null,
        pitchbookUrl: p.pitchbookUrl ?? null,
        transactionPrepStatus: p.transactionPrepStatus ?? null,
        compositeScore: composite?.compositeScore ?? null,
        autoTier: composite?.autoTier ?? null,
        dscTier: dscFeedback?.tier ?? null,
        jurisdiction: p.jurisdiction ?? p.incorporationJurisdiction ?? null,
        employees: p.employees ?? canonical?.employees ?? null,
        hq: p.hqAddress ?? canonical?.hq ?? null,
      };
    });

    // If profileMap is empty, fall back to canonical companies
    if (result.length === 0) {
      const fallback = canonicalCompanies.map((c) => ({
        companyId: c.id,
        companyName: c.name,
        sector: c.sector,
        stage: c.stage,
        tagline: c.description?.slice(0, 120) ?? null,
        logoUrl: c.logoUrl ?? null,
        linkedinUrl: null,
        crunchbaseUrl: null,
        pitchbookUrl: null,
        transactionPrepStatus: null,
        compositeScore: null,
        autoTier: null,
        dscTier: null,
        jurisdiction: null,
        employees: c.employees ?? null,
        hq: c.hq ?? null,
      }));
      return res.json({ companies: fallback, total: fallback.length });
    }

    res.json({ companies: result, total: result.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/companies/:id
   * Single company detail for Collective view.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/companies/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const profile = getCompanyProfile(id);
    const canonical = canonicalCompanies.find((c) => c.id === id);
    const dscFeedback = getLatestForCompany(id);
    const composite = computeCompositeForCompany(id);
    const channel = getChannelByCompany(id);
    const auditLog = getAuditLog();
    const companyActivity = [...auditLog]
      .filter((e) => e.entity?.includes(id))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, 20);

    res.json({
      profile: {
        companyId: profile.companyId,
        companyName: canonical?.name ?? profile.founderName ?? id,
        sector: profile.sector ?? canonical?.sector ?? null,
        stage: profile.stage ?? canonical?.stage ?? null,
        tagline: profile.tagline ?? canonical?.description?.slice(0, 120) ?? null,
        logoUrl: profile.logoUrl ?? canonical?.logoUrl ?? null,
        linkedinUrl: profile.linkedinUrl ?? null,
        twitterUrl: profile.twitterUrl ?? null,
        crunchbaseUrl: profile.crunchbaseUrl ?? null,
        pitchbookUrl: profile.pitchbookUrl ?? null,
        shortPitch: profile.shortPitch ?? null,
        longPitch: profile.longPitch ?? null,
        missionStatement: profile.missionStatement ?? null,
        jurisdiction: profile.incorporationJurisdiction ?? profile.jurisdiction ?? null,
        employees: profile.employees ?? canonical?.employees ?? null,
        hq: profile.hqAddress ?? canonical?.hq ?? null,
        runwayMonths: profile.runwayMonths ?? null,
        lastRaiseAt: profile.lastRaiseAt ?? profile.lastRaiseDate ?? null,
        lastRaiseSizeUsd: profile.lastRaiseSizeUsd ?? profile.lastRaiseAmount ?? null,
        arrUsd: profile.arrUsd ?? null,
        mrrUsd: profile.mrrUsd ?? null,
        grossMarginPct: profile.grossMarginPct ?? null,
        growthRatePct: profile.growthRatePct ?? null,
        customerCount: profile.customerCount ?? null,
      },
      mnaReadiness: {
        ipDdReadinessPct: profile.ipDdReadinessPct ?? null,
        customerContractsReadinessPct: profile.customerContractsReadinessPct ?? null,
        financialAuditReadinessPct: profile.financialAuditReadinessPct ?? null,
        dataRoomOrganizedPct: profile.dataRoomOrganizedPct ?? null,
        regulatoryFilingsCompletePct: profile.regulatoryFilingsCompletePct ?? null,
        esgDisclosureCompletePct: profile.esgDisclosureCompletePct ?? null,
        transactionPrepStatus: profile.transactionPrepStatus ?? null,
        composite: composite,
        dscFeedback: dscFeedback ?? null,
      },
      capTableSummary: {
        // READ-ONLY aggregates only — no per-shareholder breakdown
        totalSharesOutstanding: profile.esopPoolPct !== undefined ? null : null, // not stored at profile level
        esopPoolPct: profile.esopPoolPct ?? null,
        lastValuationUsd: profile.valuationMinor ?? null,
        stage: profile.stage ?? null,
        lastRaiseDate: profile.lastRaiseAt ?? profile.lastRaiseDate ?? null,
        lastRaiseAmount: profile.lastRaiseSizeUsd ?? profile.lastRaiseAmount ?? null,
        outstandingSafesUsd: null, // not stored on profile; would come from roundsStore
        note: "Cap table aggregates from company profile — round-level detail requires cap table engine access.",
      },
      transactionPrepChannel: channel ? {
        channelId: channel.id,
        threads: channel.threads,
        createdAt: channel.createdAt,
        archivedAt: channel.archivedAt ?? null,
        memberCount: channel.memberUserIds.length,
      } : null,
      recentActivity: companyActivity,
    });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/members
   * Collective-scoped member directory (PII-filtered).
   * ----------------------------------------------------------------- */
  app.get("/api/collective/members", (_req: Request, res: Response) => {
    const allContacts = filterSeedInProd(listContacts({}));

    // Only investors and consortium_partners
    const members = allContacts
      .filter((c) => c.kind === "investor" || c.kind === "consortium_partner")
      .map((c) => ({
        // ALLOWED fields only — no email, no AUM, no check sizes
        id: c.id,
        displayName: c.displayName,
        kind: c.kind,
        type: c.type,
        status: c.status,
        region: c.region,
        hqCountry: c.hqCountry,
        industries: c.industries,
        stages: c.stages,
        partnerWeight: c.partnerWeight,
        partnerSince: c.partnerSince,
        website: c.website,
        linkedinUrl: c.linkedinUrl,
        tags: c.tags,
        // Initials for avatar
        initials: c.displayName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase(),
      }));

    res.json({ members, total: members.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/soft-circles
   * Soft-circle aggregates per round (founder privacy: no per-investor amounts).
   * ----------------------------------------------------------------- */
  app.get("/api/collective/soft-circles", (req: Request, res: Response) => {
    const roundId = req.query.roundId ? String(req.query.roundId) : undefined;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;

    let filtered = canonicalSoftCircles;
    if (roundId) filtered = filtered.filter((sc) => sc.roundId === roundId);
    if (companyId) {
      // Find rounds for this company
      const companyRoundIds = new Set(
        canonicalRounds
          .filter((r: { companyId?: string }) => r.companyId === companyId)
          .map((r: { id: string }) => r.id)
      );
      filtered = filtered.filter((sc) => companyRoundIds.has(sc.roundId));
    }

    // Group by roundId
    const roundGroups = new Map<string, typeof filtered>();
    for (const sc of filtered) {
      const arr = roundGroups.get(sc.roundId) ?? [];
      arr.push(sc);
      roundGroups.set(sc.roundId, arr);
    }

    const aggregates = Array.from(roundGroups.entries()).map(([rId, circles]) => {
      const round = canonicalRounds.find((r: { id: string }) => r.id === rId);
      const totalSoftCircled = circles.reduce((sum, sc) => sum + (sc.amount ?? 0), 0);
      const targetUsd = (round as Record<string, unknown>)?.targetAmountUsd as number ?? 0;
      const compId = (round as Record<string, unknown>)?.companyId as string ?? null;
      const canonical = compId ? canonicalCompanies.find((c) => c.id === compId) : null;

      return {
        roundId: rId,
        roundName: (round as Record<string, unknown>)?.name as string ?? rId,
        companyId: compId,
        companyName: canonical?.name ?? compId ?? "Unknown",
        targetUsd: targetUsd,
        softCircledTotal: totalSoftCircled,
        softCircledCount: circles.length,
        fillPct: targetUsd > 0 ? pct(totalSoftCircled, targetUsd) : null,
        // NOTE: per-investor amounts are NOT included (founder privacy)
        note: "Aggregate view only — per-investor amounts are not disclosed.",
      };
    });

    res.json({ aggregates, total: aggregates.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/dsc/pipeline
   * Kanban grouped by transactionPrepStatus.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/dsc/pipeline", (_req: Request, res: Response) => {
    const allProfiles = getAllProfiles();

    const statuses = ["not_pursuing", "exploring", "active", "closing", "closed"] as const;
    const columns: Record<string, typeof allProfiles[number][]> = {
      not_pursuing: [],
      exploring: [],
      active: [],
      closing: [],
      closed: [],
    };

    for (const p of allProfiles) {
      const status = p.transactionPrepStatus ?? "not_pursuing";
      const col = columns[status];
      if (col) col.push(p);
    }

    // Map each profile to a card shape
    const mapCard = (p: typeof allProfiles[number]) => {
      const composite = computeCompositeForCompany(p.companyId);
      const canonical = canonicalCompanies.find((c) => c.id === p.companyId);
      return {
        companyId: p.companyId,
        companyName: canonical?.name ?? p.founderName ?? p.companyId,
        sector: p.sector ?? canonical?.sector ?? null,
        compositeScore: composite?.compositeScore ?? null,
        autoTier: composite?.autoTier ?? null,
        mnaReadiness: {
          ipDdReadinessPct: p.ipDdReadinessPct ?? null,
          customerContractsReadinessPct: p.customerContractsReadinessPct ?? null,
          financialAuditReadinessPct: p.financialAuditReadinessPct ?? null,
          dataRoomOrganizedPct: p.dataRoomOrganizedPct ?? null,
          regulatoryFilingsCompletePct: p.regulatoryFilingsCompletePct ?? null,
          esgDisclosureCompletePct: p.esgDisclosureCompletePct ?? null,
        },
      };
    };

    const grouped = Object.fromEntries(
      statuses.map((s) => [s, columns[s].map(mapCard)])
    );

    res.json({
      columns: grouped,
      counts: Object.fromEntries(statuses.map((s) => [s, columns[s].length])),
      total: allProfiles.length,
    });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/dsc/scores
   * Latest DSC feedback per company as a sortable table.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/dsc/scores", (_req: Request, res: Response) => {
    // Get live composites for all companies
    const composites = computeAllComposites();

    const rows = composites.map((c) => {
      const dscFeedback = getLatestForCompany(c.companyId);
      const profile = getCompanyProfile(c.companyId);
      const canonical = canonicalCompanies.find((co) => co.id === c.companyId);

      return {
        companyId: c.companyId,
        companyName: canonical?.name ?? profile.founderName ?? c.companyId,
        sector: profile.sector ?? canonical?.sector ?? null,
        compositeScore: c.compositeScore,
        mnaScore: c.mnaScore,
        roundScore: c.roundScore,
        autoTier: c.autoTier,
        sectorBenchmark: c.sectorBenchmark,
        dscTier: dscFeedback?.tier ?? null,
        dscNarrative: dscFeedback?.narrative ?? null,
        lastUpdated: dscFeedback?.receivedAt ?? null,
        breakdown: c.breakdown,
      };
    });

    res.json({ scores: rows, total: rows.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/dsc/composite/:companyId
   * Live-computed composite without writing to dscFeedback.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/dsc/composite/:companyId", (req: Request, res: Response) => {
    const { companyId } = req.params;
    const composite = computeCompositeForCompany(companyId);
    if (!composite) {
      return res.json({ composite: null, message: "No readiness data yet for this company." });
    }
    res.json({ composite });
  });

  /* -----------------------------------------------------------------
   * POST /api/collective/dsc/compute/:companyId
   * Compute composite and write a new DscFeedback entry.
   * DSC/admin role only (checked via x-role header).
   * ----------------------------------------------------------------- */
  app.post("/api/collective/dsc/compute/:companyId", (req: Request, res: Response) => {
    // Patch v9 (P0-5 / C-AUTH-3): authorize on session role + DB-stored DSC
    // committee membership, NOT a client-supplied x-role header in production.
    // When userContext is present (production path via loadUserContext), the
    // session governs. When userContext is absent (legacy unit-test harnesses
    // that mount this router standalone), fall back to the x-role header so
    // existing tests keep passing.
    const ctx = (req as unknown as { userContext?: { isAuthed?: boolean; isAdmin?: boolean; collective?: { role?: string | null; status?: string } } }).userContext;
    if (ctx) {
      const isAdmin = !!ctx.isAdmin;
      const isDscCommittee = !!(
        ctx.collective?.status === "active" &&
        (ctx.collective.role === "dsc" || ctx.collective.role === "committee" || ctx.collective.role === "dsc_committee")
      );
      if (!ctx.isAuthed) {
        return res.status(401).json({ error: "unauthorized", message: "Sign in required." });
      }
      if (!isAdmin && !isDscCommittee) {
        return res.status(403).json({ error: "forbidden", message: "DSC committee or admin role required." });
      }
    } else {
      const role = req.headers["x-role"] as string | undefined;
      if (role !== "admin" && role !== "dsc") {
        return res.status(403).json({ error: "forbidden", message: "DSC or admin role required." });
      }
    }

    const confirm = req.headers["x-confirm"];
    if (confirm !== "true") {
      return res.status(428).json({ error: "double_verify_required", hint: "Set header x-confirm: true" });
    }

    const { companyId } = req.params;
    const composite = computeCompositeForCompany(companyId);

    if (!composite) {
      return res.status(422).json({
        error: "no_readiness_data",
        message: "Company has no readiness data to compute a score from.",
      });
    }

    // Map autoTier → dscFeedback tier
    const tierMap: Record<string, "watch" | "qualified" | "featured" | "priority"> = {
      D: "watch",
      C: "qualified",
      B: "featured",
      A: "priority",
    };

    const feedback = ingestDscScores({
      companyId,
      tier: tierMap[composite.autoTier] ?? "watch",
      dimensions: {
        ip_dd_readiness: composite.breakdown.ip,
        customer_contracts: composite.breakdown.customerContracts,
        financial_audit: composite.breakdown.financialAudit,
        data_room: composite.breakdown.dataRoom,
        regulatory: composite.breakdown.regulatory,
        esg: composite.breakdown.esg,
        composite: composite.compositeScore,
        mna_sub_score: composite.mnaScore,
        round_sub_score: composite.roundScore,
      },
      narrative: `Auto-computed by DSC scoring engine v1.0. Composite: ${composite.compositeScore} | Tier: ${composite.autoTier} | Sector: ${composite.breakdown.sectorKey}`,
      collectiveShortlist: [],
    });

    // Emit dsc.score.recomputed bridge event
    emitBridgeEvent({
      eventType: "dsc.score.recomputed",
      aggregateId: companyId,
      aggregateKind: "company",
      payload: {
        feedbackId: feedback.id,
        compositeScore: composite.compositeScore,
        autoTier: composite.autoTier,
        sectorBenchmark: composite.sectorBenchmark,
        triggeredBy: "manual_compute",
        actorUserId: String(req.headers["x-actor-user-id"] ?? "u_admin"),
      },
    });

    res.status(201).json({ feedback, composite });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/activity
   * Activity feed: bridge outbox events filtered to Collective-relevant types.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/activity", (req: Request, res: Response) => {
    const userId = req.query.userId ? String(req.query.userId) : undefined;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));

    let outbox: ReturnType<typeof getOutbox> = [];
    try {
      outbox = getOutbox();
    } catch {
      outbox = [];
    }

    let events = outbox
      .filter((entry) => COLLECTIVE_RELEVANT_EVENT_TYPES.has(entry.envelope.eventType as string))
      .sort((a, b) => b.envelope.occurredAt.localeCompare(a.envelope.occurredAt));

    if (companyId) {
      events = events.filter((e) => e.envelope.aggregateId === companyId);
    }
    if (userId) {
      events = events.filter((e) => e.envelope.actor?.userId === userId || e.envelope.aggregateId === userId);
    }

    const feed = events.slice(0, limit).map((entry) => ({
      eventId: entry.envelope.eventId,
      eventType: entry.envelope.eventType,
      aggregateId: entry.envelope.aggregateId,
      aggregateKind: entry.envelope.aggregateKind,
      occurredAt: entry.envelope.occurredAt,
      actor: entry.envelope.actor,
      payload: entry.envelope.payload,
      status: entry.status,
    }));

    res.json({ feed, total: feed.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/subscriptions/mine
   * Returns the calling company's subscription (used by CollectiveMembership).
   * CompanyId must come from x-company-id header. Patch v4: no demo fallback.
   * ----------------------------------------------------------------- */
  app.get("/api/subscriptions/mine", (req: Request, res: Response) => {
    const headerCompanyId = req.headers["x-company-id"];
    if (!headerCompanyId || typeof headerCompanyId !== "string" || !headerCompanyId.trim()) {
      return res.status(400).json({ error: "companyId_required" });
    }
    const companyId = headerCompanyId.trim();
    const sub = getSubscription(companyId);
    if (!sub) return res.json(null);
    res.json(sub);
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/dsc/prep
   * Transaction-prep tracker: all channels with thread status.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/dsc/prep", (_req: Request, res: Response) => {
    const allChannels = listChannels();
    const allProfiles = getAllProfiles();

    const rows = allChannels.map((ch) => {
      const profile = allProfiles.find((p) => p.companyId === ch.companyId);
      const canonical = canonicalCompanies.find((c) => c.id === ch.companyId);

      // Cross-link readiness % to thread anchor keys
      const readinessMap: Record<string, number | null> = {
        ip_dd_readiness: profile?.ipDdReadinessPct ?? null,
        customer_contracts_readiness: profile?.customerContractsReadinessPct ?? null,
        financial_audit_readiness: profile?.financialAuditReadinessPct ?? null,
        data_room_organization: profile?.dataRoomOrganizedPct ?? null,
        regulatory_filings: profile?.regulatoryFilingsCompletePct ?? null,
        esg_disclosure: profile?.esgDisclosureCompletePct ?? null,
      };

      return {
        channelId: ch.id,
        companyId: ch.companyId,
        companyName: canonical?.name ?? profile?.founderName ?? ch.companyId,
        transactionPrepStatus: profile?.transactionPrepStatus ?? "not_pursuing",
        threads: ch.threads.map((t) => ({
          ...t,
          readinessPct: readinessMap[t.anchor] ?? null,
        })),
        totalThreads: TRANSACTION_PREP_THREADS.length,
        openIssuesTotal: ch.threads.reduce((sum, t) => sum + t.openIssues, 0),
        createdAt: ch.createdAt,
        archivedAt: ch.archivedAt ?? null,
      };
    });

    res.json({ channels: rows, total: rows.length, threadAnchors: TRANSACTION_PREP_THREADS });
  });
}
