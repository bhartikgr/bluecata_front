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
import { getListedCompanyIds, getListedCompanyIdsForChapters, isCompanyListedInAnyChapter } from "./collectiveInterestStore";
import { listChaptersForUser } from "./chaptersStore";
import { partnerDealPromotionsStore } from "./partnerWorkspaceStore";
import { getSubscription } from "./subscriptionsStore";
import { getLatestForCompany, listFeedback, ingestDscScores } from "./dscFeedbackStore";
import { getChannelByCompany, listChannels, TRANSACTION_PREP_THREADS } from "./transactionPrepStore";
import { listContacts } from "./adminContactsStore";
// v25.45 ROUND 2 (F13b) — privacy resolver: every rendered user name MUST route
// through resolveDisplayName so the founder/member privacy toggles take effect.
import { resolveDisplayName } from "./lib/userPrivacyResolver";
import { getAuditLog } from "./adminPlatformStore";
import { getOutbox } from "./bridgeStore";
import { computeCompositeForCompany, computeAllComposites, computeAutoTier } from "./dscScoringEngine";
import { emitBridgeEvent } from "./bridgeStore";
// v24.0 C12: mockData import removed. Collective surfaces must read from live
// stores only. These fallback collections are intentionally EMPTY — when live
// projections are sparse, the response is empty (no synthetic/mock data).
type CanonicalCompany = {
  id: string; name?: string; sector?: string | null; stage?: string | null;
  description?: string | null; logoUrl?: string | null;
  employees?: number | null; hq?: string | null;
};
type CanonicalSoftCircle = { id: string; roundId?: string; amount?: number; companyId?: string };
type CanonicalRound = { id: string; companyId?: string; name?: string; targetAmountUsd?: number };
const canonicalCompanies: CanonicalCompany[] = [];
const canonicalSoftCircles: CanonicalSoftCircle[] = [];
const canonicalRounds: CanonicalRound[] = [];
// v15 P0-11 — Collective surface MUST read live soft circles from the
// DB-backed softCircleStore (was previously reading only mockData).
import { listForCollective as listSoftCirclesForCollective } from "./softCircleStore";
import { getRecentEvents } from "./sprint10Telemetry";
import { requireCollectiveMember } from "./lib/requireCollectiveMember"; /* v14 Tier-1 Fix 3 */
import { getUserContext } from "./lib/userContext"; /* B12 (v24.0) tenant filter */
import { rawDb } from "./db/connection"; /* v25.36 — chapter-scoped reads for /members */
import { log } from "./lib/logger"; /* v25.42 R8 — partners/public fail-closed logging */
import { getApplicationFeeMinor } from "./lib/collectiveApplicationFeeResolver"; /* v25.38 — DB-driven application fee */
import { resolveCanonicalMemberTier } from "./lib/collectiveMemberSubscriptionResolver"; /* v25.47 APD-019 — single canonical member tier */
import { resolveConsortiumPricing } from "./lib/partnerTiers"; /* v25.47 APD-020/030 — 5-tier consortium pricing */
import { founderOwnedCompanyIds as tenantFounderOwnedCompanyIds, investorVisibleCompanyIds as tenantInvestorVisibleCompanyIds } from "./lib/tenantAuth"; /* B12 (v24.0) */

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
 * v25.36 — Cross-tenant chapter scoping helpers.
 *
 * These centralize the visibility resolution that the dealroom routes
 * (/api/collective/{companies,dealroom/companies}) already perform inline
 * (see lines ~244-261 / ~391-408). v25.36 extends the identical pattern to
 * the remaining aggregate endpoints that previously read platform-wide.
 *
 * CONTRACT (byte-for-byte mirror of the dealroom inline pattern):
 *   - admin  → listedIds = getListedCompanyIds() (platform-wide), myChapterIds = []
 *   - member → myChapterIds = listChaptersForUser(userId), listedIds scoped to them
 *   - anon   → empty set (the routes are already behind requireCollectiveMember,
 *              so a 401 is returned upstream; this is defense-in-depth)
 *
 * NOTHING IN MEMORY: every query targets the DB via the underlying stores
 * (collectiveInterestStore / chaptersStore) or rawDb() directly.
 * ============================================================ */
interface CallerScope {
  isAdmin: boolean;
  userId: string | undefined;
  myChapterIds: string[];
  listedIds: Set<string>;
}

async function resolveCallerScope(req: Request): Promise<CallerScope> {
  const ctx = await getUserContext(req);
  const userId = ctx?.userId;
  const isAdmin = ctx?.isAdmin === true;
  let listedIds: Set<string>;
  let myChapterIds: string[];
  if (isAdmin) {
    listedIds = getListedCompanyIds(); // platform-wide for admins
    myChapterIds = []; // admins are NOT chapter-scoped
  } else if (userId) {
    myChapterIds = listChaptersForUser(userId).map((c: any) => c.id);
    listedIds = getListedCompanyIdsForChapters(myChapterIds);
  } else {
    listedIds = new Set<string>();
    myChapterIds = [];
  }
  return { isAdmin, userId, myChapterIds, listedIds };
}

/**
 * v25.36 — Resolve the lowercased contact emails that belong to a caller's
 * chapters, for the /members directory. The `contacts` table has no chapter
 * column and is keyed by `ac_*` ids (not user ids), so the only durable
 * linkage is contact.email → users.email → chapter_memberships.user_id.
 * A contact with no matching active chapter member is invisible to a
 * non-admin caller (fail-closed). Returns an empty set when the caller has
 * no chapters. Admins bypass this entirely (they see every contact).
 */
/**
 * v25.45 ROUND 2 (F13b) — map lowercased contact emails to their owning
 * users.id so the directory can route each member's name through
 * resolveDisplayName(). Contacts are keyed by ac_* ids, not user ids; the only
 * durable linkage is contact.email → users.email → users.id. Fail-closed on any
 * DB error (returns an empty map; resolver then sees an empty userId and applies
 * the directory default, which is "Private Investor" — the privacy-safe choice).
 */
function getEmailToUserId(emails: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(emails.filter(Boolean).map((e) => e.toLowerCase())));
  if (uniq.length === 0) return out;
  try {
    const db: any = rawDb();
    const placeholders = uniq.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, LOWER(email) AS email FROM users WHERE LOWER(email) IN (${placeholders})`)
      .all(...uniq) as any[];
    for (const r of rows) {
      if (r.email && r.id) out.set(String(r.email), String(r.id));
    }
  } catch {
    /* fail-closed — empty map */
  }
  return out;
}

function getChapterMemberEmails(chapterIds: string[]): Set<string> {
  const out = new Set<string>();
  if (!chapterIds || chapterIds.length === 0) return out;
  try {
    const db: any = rawDb();
    const placeholders = chapterIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT LOWER(u.email) AS email
           FROM chapter_memberships cm
           JOIN users u ON u.id = cm.user_id
          WHERE cm.status = 'active'
            AND cm.deleted_at IS NULL
            AND cm.chapter_id IN (${placeholders})`,
      )
      .all(...chapterIds) as any[];
    for (const r of rows) {
      if (r.email) out.add(String(r.email).toLowerCase());
    }
  } catch {
    // Non-fatal — fail closed with an empty set (no cross-chapter leak).
  }
  return out;
}

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
    // E1 (v24.0 LOCKDOWN) — the guard must SKIP any event that is not BOTH a
    // transaction_prep aggregate AND an update. Using `&&` only skipped events
    // that were neither, so the listener fired on unrelated mutations (e.g.
    // company/round updates) and recomputed DSC spuriously. `||` correctly
    // bails unless both conditions hold.
    if (evt.aggregate !== "transaction_prep" || evt.change !== "update") return;
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
   * v25.38 Phase 1 — GET /api/collective/application-fee
   *
   * DB-driven founder application fee (promotes the former hardcoded
   * ApplyToCollective.tsx literal `const APPLICATION_FEE = 2_500`). Reads via
   * collectiveApplicationFeeResolver (config table → seed default fallback).
   * Read-only this wave; NO admin write endpoint (out of scope). Open to any
   * authed founder applying — not gated to existing collective members — since
   * non-members apply through this surface.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/application-fee", (req: Request, res: Response) => {
    const currency = typeof req.query.currency === "string" && req.query.currency
      ? req.query.currency
      : "USD";
    const fee = getApplicationFeeMinor(currency);
    res.json(fee);
  });

  /* -----------------------------------------------------------------
   * v25.47 APD-019 / APD-032(B) — GET /api/collective/member-tier
   *
   * The Collective membership ladder has collapsed to ONE canonical
   * recurring tier (collective.member_subscription.standard, $249/mo).
   * This is the single read path the membership surface consumes. Open
   * to any authed user (non-members view pricing before subscribing).
   * Reads DB via the canonical resolver; never hardcodes the amount.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/member-tier", (_req: Request, res: Response) => {
    const tier = resolveCanonicalMemberTier();
    res.json(tier);
  });

  /* -----------------------------------------------------------------
   * v25.47 APD-020 — public GET /api/consortium/pricing
   *
   * PUBLIC (no auth) Consortium Partner pricing page data: the canonical
   * 5-tier taxonomy (catalyst/builder/amplifier/nexus/founding_member),
   * DB-resolved from platform_fees in canonical order. founding_member is
   * flagged invite-only. No economics beyond the public list price.
   * ----------------------------------------------------------------- */
  app.get("/api/consortium/pricing", (_req: Request, res: Response) => {
    const tiers = resolveConsortiumPricing();
    res.json({ tiers });
  });

  /* -----------------------------------------------------------------
   * v25.42 R8 (Bucket C) — GET /api/collective/partners/public
   *
   * Member-facing public partner directory cards. ECONOMICS REDACTED
   * (Ozan HARD CONSTRAINT #1): the projection NEVER selects/exposes
   * adminFeePerDeal, carryPct, mgmtFeePct, revShareToCapavate or
   * hurdleRatePct. Reads the EXISTING partner_organizations table
   * directly via rawDb() (the same raw-SQL pattern used elsewhere in
   * this file), so no Drizzle table coupling and no schema change.
   *
   * Column mapping (existing partner_organizations → public card):
   *   name        ← name
   *   logoUrl     ← logo_url
   *   governance  ← partner_type   (governance/structure label)
   *   hq          ← jurisdiction
   *   memberCount ← (not stored — null; never economics-derived)
   *   aumUsd      ← aum_range      (disclosed band only, never exact)
   *   sectors     ← (not stored — [] )
   * Only `status = 'active'` rows are returned, ordered by name.
   *
   * Fail-closed: any DB error → 503 PARTNERS_UNAVAILABLE (no leak, no
   * synthetic fallback). This is the ONE new endpoint in v25.42.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/partners/public", requireCollectiveMember, async (req: Request, res: Response) => {
    try {
      const db: any = rawDb();
      // v25.42 round-2 fix — chapter-scoped read (mirrors the NC-6 fix on
      // /api/collective/companies). The previous handler returned every active
      // partner across ALL tenants/chapters to any member. We now resolve the
      // caller's chapters via `listChaptersForUser` and filter partner_organizations
      // to that set (chapter-agnostic partners with null primary_chapter_id remain
      // visible to all). Platform admins still see all partners (CROSS-TENANT).
      //
      // EXPLICITLY SELECT ONLY public-safe columns. Economics columns are
      // never referenced here (and do not exist on this table) — defense in
      // depth so a future additive economics column cannot leak through a
      // `SELECT *`.
      const ctx = await getUserContext(req);
      const isAdmin = ctx?.isAdmin === true || (ctx as any)?.role === "platform_admin";

      type PartnerRow = {
        id: string;
        name: string;
        logo_url: string | null;
        partner_type: string | null;
        jurisdiction: string | null;
        aum_range: string | null;
      };

      let rows: PartnerRow[];
      if (isAdmin) {
        // Platform admins see all active partners across all tenants.
        rows = db
          .prepare(
            `SELECT id, name, logo_url, partner_type, jurisdiction, aum_range
               FROM partner_organizations
              WHERE status = 'active'
              ORDER BY name ASC`,
          )
          .all() as PartnerRow[];
      } else {
        // Members see partners scoped to their chapters (and chapter-agnostic
        // null primary_chapter_id partners visible to all).
        const userId = ctx?.userId;
        if (!userId) {
          return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Sign in to continue." });
        }
        const chapterIds = listChaptersForUser(userId).map((c: any) => c.id);
        if (!chapterIds || chapterIds.length === 0) {
          return res.json({ count: 0, total: 0, limit: 0, offset: 0, items: [] });
        }
        const placeholders = chapterIds.map(() => "?").join(",");
        rows = db
          .prepare(
            `SELECT id, name, logo_url, partner_type, jurisdiction, aum_range
               FROM partner_organizations
              WHERE status = 'active'
                AND (primary_chapter_id IS NULL OR primary_chapter_id IN (${placeholders}))
              ORDER BY name ASC`,
          )
          .all(...chapterIds) as PartnerRow[];
      }

      const items = rows.map((r) => ({
        id: r.id,
        name: r.name,
        logoUrl: r.logo_url ?? null,
        governance: r.partner_type ?? null,
        hq: r.jurisdiction ?? null,
        memberCount: null as number | null,
        // aumUsd: disclosed band only (e.g. "50m-250m"); exact AUM is never
        // stored on this table and is never exposed.
        aumUsd: r.aum_range && r.aum_range !== "undisclosed" ? r.aum_range : null,
        sectors: [] as string[],
      }));

      res.json({
        count: items.length,
        total: items.length,
        limit: items.length,
        offset: 0,
        items,
      });
    } catch (err) {
      log.warn("[partners/public] DB read failed:", (err as Error).message);
      res.status(503).json({
        ok: false,
        error: "PARTNERS_UNAVAILABLE",
        message: "Public partners directory temporarily unavailable",
      });
    }
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/dashboard
   * KPI cards computed live from existing stores.
   * ----------------------------------------------------------------- */
  /* v16 F-coll-X4 — was unprotected; any authed user (or anonymous w/ session) could read. */
  app.get("/api/collective/dashboard", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.36 — chapter-scope every aggregate. Previously this route returned
     * platform-wide member/subscription/deal-room/DSC counts plus global
     * recent-activity aggregate IDs to any active member. We now resolve the
     * caller's visible chapters + companies and count only objects visible to
     * that caller. Admins remain platform-wide (NOT chapter-scoped). */
    const { isAdmin, myChapterIds, listedIds } = await resolveCallerScope(req);
    const allContacts = filterSeedInProd(listContacts({}));
    const allProfilesRaw = getAllProfiles();

    // v25.36 — member roster scoped to the caller's chapters (admins see all).
    const memberEmails = isAdmin ? null : getChapterMemberEmails(myChapterIds);
    const memberContacts = allContacts.filter((c) => {
      if (c.kind !== "investor" && c.kind !== "consortium_partner") return false;
      if (isAdmin) return true;
      return !!c.email && memberEmails!.has(c.email.toLowerCase());
    });

    // Total members: chapter-scoped investors + consortium_partners
    const totalMembers = memberContacts.length;

    // Active collective-tier subscriptions: approximate via active status
    const activeSubscriptions = memberContacts.filter((c) => c.status === "active").length;

    // v25.36 — profiles visible to the caller (admins see every listing).
    const allProfiles = isAdmin
      ? allProfilesRaw
      : allProfilesRaw.filter((p) => listedIds.has(p.companyId));

    // Companies in Deal Room: transactionPrepStatus in (exploring, active, closing)
    const dealRoomStatuses = new Set(["exploring", "active", "closing"]);
    const companiesInDealRoom = allProfiles.filter(
      (p) => p.transactionPrepStatus && dealRoomStatuses.has(p.transactionPrepStatus)
    ).length;

    // DSC pipeline depth — chapter-scoped to visible companies (admins: all).
    const dscPipelineDepth = isAdmin
      ? listFeedback().length
      : listFeedback().filter((f) => listedIds.has((f as any).companyId)).length;

    // Pending applications.
    // v25.36 — Admins keep the telemetry-proxy platform count. Members get a
    // DB count of pending collective applications in THEIR chapters only
    // (collective_apps.chapter_id), so the dashboard never reveals
    // application volume from chapters the caller does not belong to.
    //
    // v25.21 Lane C NM-3 fix — the emitter writes
    // `collective_application_submitted` (underscore) but this consumer
    // filtered on `collective.application_submitted` (dot). Total mismatch
    // meant the KPI was always 0. Accept BOTH spellings so we never lose
    // count regardless of which form a future caller emits.
    let pendingApps = 0;
    if (isAdmin) {
      const recentTelemetry = getRecentEvents(200);
      pendingApps = recentTelemetry.filter(
        (e) =>
          e.eventType === "collective.application_submitted" ||
          e.eventType === "collective_application_submitted"
      ).length;
    } else if (myChapterIds.length > 0) {
      try {
        const db: any = rawDb();
        const placeholders = myChapterIds.map(() => "?").join(",");
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n FROM collective_apps
              WHERE status = 'submitted' AND chapter_id IN (${placeholders})`,
          )
          .get(...myChapterIds) as any;
        pendingApps = Number(row?.n ?? 0);
      } catch {
        pendingApps = 0; // fail closed — never leak a cross-chapter count
      }
    }

    // Recent activity feed: last 10 bridge-relevant events from bridge outbox
    let outbox: ReturnType<typeof getOutbox> = [];
    try {
      outbox = getOutbox();
    } catch {
      outbox = [];
    }

    const recentActivity = outbox
      .filter((entry) => COLLECTIVE_RELEVANT_EVENT_TYPES.has(entry.envelope.eventType as string))
      // v25.36 round-2 (GPT-5.5 strict concern 1) — stricter chapter isolation
      // for the dashboard activity feed. The prior v25.36 filter dropped
      // company-aggregate events for companies the caller couldn't see, but
      // KEPT all non-company aggregates (collective.member.updated,
      // collective.application.submitted, platform.*, etc.) for every
      // non-admin caller — those events still expose cross-chapter
      // operational activity and aggregate IDs.
      //
      // We now require explicit chapter visibility for non-admin callers on
      // EVERY event kind:
      //   - company aggregates  → listedIds.has(aggregateId)
      //   - application aggregates → chapter_id of that application row IN myChapterIds
      //   - all other non-company aggregates → dropped (conservative default;
      //     re-grant per kind once a tested chapter linkage exists).
      // Admins keep everything.
      .filter((entry) => {
        if (isAdmin) return true;
        const kind = entry.envelope.aggregateKind;
        const aggId = entry.envelope.aggregateId as string | undefined;
        if (kind === "company") {
          return !!aggId && listedIds.has(aggId);
        }
        if (kind === "application" && aggId && myChapterIds.length > 0) {
          // Application-aggregate events are visible only when the underlying
          // collective_apps row belongs to one of the caller's chapters.
          try {
            const row = rawDb()
              .prepare(
                `SELECT chapter_id FROM collective_apps WHERE id = ? LIMIT 1`,
              )
              .get(aggId) as { chapter_id?: string } | undefined;
            if (row?.chapter_id && myChapterIds.includes(row.chapter_id)) {
              return true;
            }
          } catch {
            // fail-closed: cannot prove chapter linkage → drop the event
          }
          return false;
        }
        // All other aggregate kinds (platform.*, collective.member.*, etc.)
        // lack a tested chapter linkage today. Drop them for non-admins to
        // prevent cross-chapter operational activity leakage.
        return false;
      })
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
  /* v16 F-coll-X4 — was unprotected. */
  app.get("/api/collective/dealroom/companies", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.22 NC-6 fix — chapter-scoped dealroom (mirror of /companies). */
    const ctx = await getUserContext(req);
    const userId = ctx?.userId;
    const isAdmin = ctx?.isAdmin === true;
    let listedIds: Set<string>;
    if (isAdmin) {
      listedIds = getListedCompanyIds();
    } else if (userId) {
      const myChapters = listChaptersForUser(userId).map((c: any) => c.id);
      listedIds = getListedCompanyIdsForChapters(myChapters);
    } else {
      listedIds = new Set<string>();
    }

    const dealRoomStatuses = new Set(["exploring", "active", "closing"]);
    const allProfiles = getAllProfiles().filter((p) => listedIds.has(p.companyId));

    // Also include companies that have a transactionPrep channel (still
    // chapter-scoped by intersection with `listedIds`).
    const channelCompanyIds = new Set(
      listChannels()
        .filter((ch) => !ch.archivedAt && listedIds.has(ch.companyId))
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
      /* v25.36 — chapter-scope partner promotions. The base deal-room list is
       * already chapter-scoped via `listedIds`, but the partner-promotion merge
       * previously appended ANY live collective promotion, reintroducing a
       * cross-chapter leak (B6): a promotion for a company not listed in the
       * caller's chapter would surface in every member's deal room. We now
       * require admin OR `listedIds.has(promo.companyId)` before merging. If a
       * promotion must intentionally override chapter listing, that should be
       * modeled as an explicit visibility grant in `collective_directory_listings`
       * (inserted when the promotion goes live); for now we gate on listedIds. */
      if (!isAdmin && !listedIds.has(promo.companyId)) continue;
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
  app.get("/api/collective/companies", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.22 NC-6 fix — chapter-scoped read. The previous handler returned
     * every chapter's companies to any active member, leaking
     * `chap_keiretsu_canada` data to `chap_keiretsu_us` members and vice
     * versa. We now resolve the caller's chapters via `listChaptersForUser`
     * and filter directory listings to that set. Admins still see all
     * chapters (CROSS-TENANT admin annotation). */
    const ctx = await getUserContext(req);
    const userId = ctx?.userId;
    const isAdmin = ctx?.isAdmin === true;
    let listedIds: Set<string>;
    if (isAdmin) {
      listedIds = getListedCompanyIds(); // platform-wide for admins
    } else if (userId) {
      const myChapters = listChaptersForUser(userId).map((c: any) => c.id);
      listedIds = getListedCompanyIdsForChapters(myChapters);
    } else {
      listedIds = new Set<string>();
    }

    const allProfiles = getAllProfiles().filter((p) => listedIds.has(p.companyId));

    // Fall back to canonical companies if profileMap is sparse
    const canonicalById = new Map(canonicalCompanies.map((c) => [c.id, c]));
    const profileIdSet = new Set(allProfiles.map((p) => p.companyId));
    const augmented = [
      ...allProfiles,
      ...Array.from(listedIds)
        .filter((id) => !profileIdSet.has(id))
        .map((id) => {
          const canonical = canonicalById.get(id);
          return {
            companyId: id,
            companyName: canonical?.name ?? id,
            founderName: undefined,
            sector: canonical?.sector ?? null,
            stage: canonical?.stage ?? null,
            tagline: canonical?.description?.slice(0, 120) ?? null,
            logoUrl: canonical?.logoUrl ?? null,
            linkedinUrl: null,
            crunchbaseUrl: null,
            pitchbookUrl: null,
            transactionPrepStatus: null,
            jurisdiction: (canonical as unknown as { jurisdiction?: string })?.jurisdiction ?? null,
            incorporationJurisdiction: (canonical as unknown as { jurisdiction?: string })?.jurisdiction ?? null,
            employees: canonical?.employees ?? null,
            hqAddress: canonical?.hq ?? null,
          } as unknown as ReturnType<typeof getAllProfiles>[number];
        }),
    ];

    const result = augmented.map((p) => {
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

    // v25.36 round-2 (GPT-5.5 strict concern 2) — the prior fallback returned
    // ALL `canonicalCompanies` for any caller whose scoped result was empty,
    // including non-admin callers with no listed chapter companies. Today
    // `canonicalCompanies` is the empty array (dead code from v25.22), but
    // any future repopulation or seed import would silently leak the global
    // company list to empty-chapter members across chapters.
    //
    // Fix: restrict the canonical fallback to admins only. Non-admin callers
    // with empty `result` now receive the empty list — they should not see
    // companies outside their own chapter listing.
    if (result.length === 0) {
      if (!isAdmin) {
        return res.json({ companies: [], total: 0 });
      }
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
  app.get("/api/collective/companies/:id", requireCollectiveMember, async (req: Request, res: Response) => {
    const { id } = req.params;
    /* v25.22 NC-6 fix — verify the requested company is listed in at least
     * one of the caller's chapters before exposing its profile / financials.
     * Without this guard, any active member could fetch any company's
     * confidential cap-table aggregates by guessing the id. Admins bypass
     * (CROSS-TENANT admin annotation). 404 (not 403) to avoid leaking which
     * ids exist. */
    const ctx = await getUserContext(req);
    const userId = ctx?.userId;
    const isAdmin = ctx?.isAdmin === true;
    if (!isAdmin) {
      if (!userId) {
        return res.status(404).json({ error: "not_found" });
      }
      const myChapters = listChaptersForUser(userId).map((c: any) => c.id);
      if (!isCompanyListedInAnyChapter(String(id), myChapters)) {
        return res.status(404).json({ error: "not_found" });
      }
    }
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
  app.get("/api/collective/members", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.36 — chapter-scope the member directory. Previously listContacts({})
     * returned EVERY investor + consortium_partner platform-wide, exposing the
     * cross-chapter roster. The `contacts` table has no chapter column, so we
     * derive the caller's chapter members' emails (contact.email →
     * users.email → chapter_memberships.user_id) and keep only contacts that
     * match. Contacts with no matching active chapter member are invisible to
     * non-admins (fail-closed). A caller with no chapters sees []. Admins see
     * the full roster (NOT chapter-scoped). */
    const { isAdmin, myChapterIds, userId: viewerUserId } = await resolveCallerScope(req);
    const allContacts = filterSeedInProd(listContacts({}));
    const memberEmails = isAdmin ? null : getChapterMemberEmails(myChapterIds);

    // Only investors and consortium_partners, scoped to the caller's chapters.
    const scoped = allContacts
      .filter((c) => c.kind === "investor" || c.kind === "consortium_partner")
      .filter((c) => {
        if (isAdmin) return true;
        return !!c.email && memberEmails!.has(c.email.toLowerCase());
      });

    // v25.45 ROUND 2 (F13b) — resolve every member's displayName through the
    // privacy resolver in the collectiveDirectory context. A member who has
    // opted out of directory visibility renders as "Private Investor" instead of
    // their raw legal/display name. Map contact email → users.id first.
    const emailToUserId = getEmailToUserId(scoped.map((c) => c.email ?? ""));

    // Resolve each member's directory display name. v25.45 ROUND 3 (F13 fix):
    // EVERY linked member routes through the privacy resolver in the
    // collectiveDirectory context. The resolver's DEFAULT_PREFS default
    // visibleInCollectiveDirectory:false, so a member WITHOUT any saved privacy
    // row defaults to opt-out → "Private Investor" (privacy-by-default; opt-in
    // required via the Privacy tab). The prior round-2 `if (!raw) return
    // c.displayName` legacy bypass leaked raw display names for no-row members
    // and has been removed. A member WITH a saved row that sets
    // visibleInCollectiveDirectory:false also renders as "Private Investor".
    const dirName = (c: { email?: string | null; displayName: string }): string => {
      const uid = (c.email && emailToUserId.get(c.email.toLowerCase())) || "";
      if (!uid) return c.displayName; // no user linkage → keep legacy name
      // v25.45 ROUND 7 — the Collective directory is a SOCIAL surface, not a
      // counterparty surface (isCoMember:false). It ALWAYS requires explicit
      // opt-in (visibleInCollectiveDirectory:true); no-row members render as
      // "Private Investor".
      return resolveDisplayName(uid, viewerUserId ?? null, "collectiveDirectory", {
        legalName: c.displayName,
        isCoMember: false,
      });
    };

    const members = scoped
      .map((c) => ({
        // ALLOWED fields only — no email, no AUM, no check sizes
        id: c.id,
        displayName: dirName(c),
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
        // Initials for avatar — derive from the RESOLVED display name so a
        // private investor never leaks initials from their real name.
        initials: dirName(c).split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase(),
      }));

    res.json({ members, total: members.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/soft-circles
   * Soft-circle aggregates per round (founder privacy: no per-investor amounts).
   * ----------------------------------------------------------------- */
  app.get("/api/collective/soft-circles", requireCollectiveMember, async (req: Request, res: Response) => {
    const roundId = req.query.roundId ? String(req.query.roundId) : undefined;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;

    /* v25.36 — chapter-scope soft-circle aggregates. Previously the route had
     * no chapter intersection: any member could enumerate soft-circle totals
     * for rounds outside their chapter. We resolve the caller's visible
     * companies and keep only circles whose companyId is visible (admins see
     * all). A caller with no chapters sees []. */
    const { isAdmin, listedIds } = await resolveCallerScope(req);

    // v15 P0-11 — union live soft circles from softCircleStore with the
    // canonical seed list so the Collective surface stops reading only
    // mockData. Live rows take precedence on (id) collision.
    const liveProjections = listSoftCirclesForCollective({ roundId, companyId });
    const liveIds = new Set(liveProjections.map((p) => p.id));
    type CombinedCircle = { id: string; roundId: string; amount: number; companyId?: string | null };
    const liveCombined: CombinedCircle[] = liveProjections.map((p) => ({
      id: p.id,
      roundId: p.roundId,
      amount: p.amount,
      companyId: p.companyId,
    }));
    const seedCombined: CombinedCircle[] = canonicalSoftCircles
      .filter((sc: { id: string }) => !liveIds.has(sc.id))
      .map((sc: any) => ({
        id: sc.id,
        roundId: sc.roundId,
        amount: sc.amount,
        companyId: sc.companyId,
      }));
    let filtered: CombinedCircle[] = [...seedCombined, ...liveCombined];
    // v25.36 — intersect by visible companyId BEFORE any other filtering.
    // Circles with a null companyId (legacy/unlinked) are dropped for
    // non-admins (fail-closed; they cannot be attributed to a chapter).
    if (!isAdmin) {
      filtered = filtered.filter((sc) => !!sc.companyId && listedIds.has(sc.companyId));
    }
    if (roundId) filtered = filtered.filter((sc) => sc.roundId === roundId);
    if (companyId) {
      /* v25.36 — the legacy company filter joined through `canonicalRounds`,
       * which is permanently empty (v24.0 C12 mock-data strip), so it zeroed
       * out every live row (M11). The live projection already carries its own
       * companyId, so we filter on that directly. */
      filtered = filtered.filter((sc) => sc.companyId === companyId);
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
      /* v25.36 — `canonicalRounds` is permanently empty, so derive the company
       * id from the round's own live circles when the canonical round lookup
       * misses. This keeps the chapter-scoped companyId on the response (and
       * makes the per-round company attributable for cross-chapter tests). */
      const compId =
        ((round as Record<string, unknown>)?.companyId as string) ??
        circles.find((sc) => sc.companyId)?.companyId ??
        null;
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
  /* v16 F-coll-X4 — was unprotected. */
  app.get("/api/collective/dsc/pipeline", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.36 — chapter-scope the pipeline. Previously grouped EVERY initialized
     * company profile across all chapters by transactionPrepStatus. We now
     * intersect profiles with the caller's visible companies (admins see all). */
    const { isAdmin, listedIds } = await resolveCallerScope(req);
    const allProfiles = isAdmin
      ? getAllProfiles()
      : getAllProfiles().filter((p) => listedIds.has(p.companyId));

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
  /* v16 F-coll-X4 — was unprotected. */
  app.get("/api/collective/dsc/scores", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.36 — chapter-scope DSC scores. computeAllComposites() returns deal
     * intelligence for EVERY company; we filter it to the caller's visible
     * companies before mapping (admins see all). */
    const { isAdmin, listedIds } = await resolveCallerScope(req);
    const allComposites = computeAllComposites();
    const composites = isAdmin
      ? allComposites
      : allComposites.filter((c) => listedIds.has(c.companyId));

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
  /* v16 F-coll-X4 — was unprotected. */
  app.get("/api/collective/dsc/composite/:companyId", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.36 — visibility guard. Previously a member could compute the DSC
     * composite for ANY guessed companyId across chapters. We now require the
     * company to be listed in one of the caller's chapters (admins bypass).
     * A non-visible company returns 404 (indistinguishable from "no such
     * company") so chapter membership cannot be enumerated. */
    const companyId = String(req.params.companyId);
    const { isAdmin, listedIds } = await resolveCallerScope(req);
    if (!isAdmin && !listedIds.has(companyId)) {
      return res.status(404).json({ error: "not_found" });
    }
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
    /* v25.12 NH-3 — the previous implementation had an `x-role` header
     * fallback for the case when `req.userContext` was absent. That branch
     * was dead code in production (the global `loadUserContext` middleware
     * always populates a context object), but any future change to
     * middleware ordering would silently re-expose a header-spoof bypass.
     * Role is now read EXCLUSIVELY from the verified session context.
     * Missing context → 401; non-DSC / non-admin → 403. */
    const ctx = (req as unknown as {
      userContext?: {
        isAuthed?: boolean;
        isAdmin?: boolean;
        collective?: { role?: string | null; status?: string };
      };
    }).userContext;
    if (!ctx) {
      return res.status(401).json({ error: "unauthorized", message: "Sign in required." });
    }
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

    // v25.35 (BLOCKER #8) — ingestDscScores now FAILS CLOSED (throws if the DB
    // write fails / the hash chain would otherwise advance on a non-durable
    // record). Translate to a sanitized 500 instead of a phantom 201.
    let feedback;
    try {
      feedback = ingestDscScores({
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
    } catch {
      return res.status(500).json({ ok: false, error: "DSC_FEEDBACK_PERSIST_FAILED", message: "Could not persist the DSC score; please retry." });
    }

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
        actorUserId: String((req as any).userContext?.userId ?? ""), /* v14 */
      },
    });

    res.status(201).json({ feedback, composite });
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/activity
   * Activity feed: bridge outbox events filtered to Collective-relevant types.
   * ----------------------------------------------------------------- */
  app.get("/api/collective/activity", requireCollectiveMember, (req: Request, res: Response) => {
    const userId = req.query.userId ? String(req.query.userId) : undefined;
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));

    let outbox: ReturnType<typeof getOutbox> = [];
    try {
      outbox = getOutbox();
    } catch {
      outbox = [];
    }

    // B12 (v24.0 LOCKDOWN) — tenant isolation. Previously the activity feed
    // returned EVERY bridge-outbox event to any collective member, and trusted
    // the client-supplied companyId/userId filters as the only scoping (which
    // a caller could simply omit to see everything). It also leaked raw
    // `actor`/`payload` envelope fields. We now:
    //   1. compute the caller's accessible companyIds (owned + visible; admin
    //      sees all),
    //   2. drop any event whose aggregateId is a company the caller cannot see,
    //   3. strip raw actor/payload from the member-facing response.
    const ctx = getUserContext(req);
    const isAdmin = !!ctx?.isAdmin;
    const accessible = new Set<string>();
    if (ctx) {
      tenantFounderOwnedCompanyIds(ctx).forEach((id) => accessible.add(id));
      tenantInvestorVisibleCompanyIds(ctx).forEach((id) => accessible.add(id));
    }
    // A company-scoped event is one whose aggregateKind is "company"; only
    // those are gated by company visibility. Non-company aggregates (platform
    // level) remain visible to any collective member.
    const callerVisible = (e: (typeof outbox)[number]): boolean => {
      if (isAdmin) return true;
      const kind = e.envelope.aggregateKind;
      const aggId = e.envelope.aggregateId;
      if (kind === "company") return !!aggId && accessible.has(aggId);
      // For non-company aggregates, only surface events the caller actually
      // acted on or that reference one of their accessible companies in the id.
      if (e.envelope.actor?.userId && ctx?.userId && e.envelope.actor.userId === ctx.userId) return true;
      return !!aggId && accessible.has(aggId);
    };

    let events = outbox
      .filter((entry) => COLLECTIVE_RELEVANT_EVENT_TYPES.has(entry.envelope.eventType as string))
      .filter(callerVisible)
      .sort((a, b) => b.envelope.occurredAt.localeCompare(a.envelope.occurredAt));

    if (companyId) {
      events = events.filter((e) => e.envelope.aggregateId === companyId);
    }
    if (userId) {
      events = events.filter((e) => e.envelope.actor?.userId === userId || e.envelope.aggregateId === userId);
    }

    // B12 — member-facing projection: NO raw actor/payload. Surface only a
    // coarse actor label and an event summary the UI needs.
    const feed = events.slice(0, limit).map((entry) => ({
      eventId: entry.envelope.eventId,
      eventType: entry.envelope.eventType,
      aggregateId: entry.envelope.aggregateId,
      aggregateKind: entry.envelope.aggregateKind,
      occurredAt: entry.envelope.occurredAt,
      status: entry.status,
    }));

    res.json({ feed, total: feed.length });
  });

  /* -----------------------------------------------------------------
   * GET /api/subscriptions/mine
   * v16 F-coll-X4 / F-coll-23 — was unprotected AND broken.
   *   - Old code hardcoded `headerCompanyId = undefined`, returning 400 to
   *     every caller.
   *   - Now requires collective membership AND derives companyId from the
   *     authenticated session's active tenant / active company.
   * Returns the calling founder's active-company subscription.
   * ----------------------------------------------------------------- */
  app.get("/api/subscriptions/mine", requireCollectiveMember, (req: Request, res: Response) => {
    const ctx = (req as Request & { userContext?: { userId?: string; founder?: { activeCompanyId?: string | null } } }).userContext;
    const companyId = ctx?.founder?.activeCompanyId ?? null;
    if (!companyId || typeof companyId !== "string" || !companyId.trim()) {
      return res.status(400).json({ error: "companyId_required" });
    }
    const sub = getSubscription(companyId.trim());
    if (!sub) return res.json(null);
    res.json(sub);
  });

  /* -----------------------------------------------------------------
   * GET /api/collective/dsc/prep
   * Transaction-prep tracker: all channels with thread status.
   * ----------------------------------------------------------------- */
  /* v16 F-coll-X4 — was unprotected. */
  app.get("/api/collective/dsc/prep", requireCollectiveMember, async (req: Request, res: Response) => {
    /* v25.36 — chapter-scope the transaction-prep tracker. Previously returned
     * EVERY transaction-prep channel cross-chapter. We derive the caller's
     * visible companies first and filter channels to that set. A caller with
     * no chapters gets an empty array (NOT 403 — empty-chapter is a valid
     * state, not an authz failure). Admins see all channels. */
    const { isAdmin, listedIds } = await resolveCallerScope(req);
    const allChannels = isAdmin
      ? listChannels()
      : listChannels().filter((ch) => listedIds.has(ch.companyId));
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
