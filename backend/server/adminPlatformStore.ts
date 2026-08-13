/**
 * Sprint 12 — Admin platform store.
 *
 * Aggregates routes for: dashboard KPIs, company drill-down stats, investor
 * segmentation, users & auth (sessions, MFA, login history), reconciliation
 * diffs, telemetry power browser, audit log power (chain verify), pricing
 * (Collective tiers + Capavate Founder tiers).
 *
 * All store data is in-memory mock seeded from existing fixtures so the
 * preview demo works without external infra.
 */
import type { Express, Request, Response } from "express";
/* WAVE 34 · TASK 2 — ISO-4217 exponent for the founder-tier displayPrice string. */
import { fromMinor } from "./lib/currency";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { companies, rounds, softCircles, dataroomFiles, reports } from "./mockData";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
// v25.48 DATA-2 (V-1/V-2/V-3) — DB-driven admin KPI reads (replace mockData arrays).
// Wave B v26.4.0-fix (BLOCK-K) — 3 new SPV KPI reads wired into the dashboard
// summary payload. `dbTotalSpvCommittedMinor` and `dbTotalSpvWiredMinor` are
// per-currency maps; `dbTotalActiveSpvs` is a scalar count. Backfill in
// spvEngineStore.backfillLegacyChildCommitments() ensures these tiles reflect
// the full pre-Wave-B history, not just post-Wave-B activity.
import {
  dbTotalCompanies,
  dbTotalFunded,
  dbTotalCommittedSoftCircle,
  dbRegions,
  dbTotalSpvCommittedMinor,
  dbTotalSpvWiredMinor,
  dbTotalActiveSpvs,
} from "./lib/adminKpiDbReads";
import { ALL_OUTBOUND_EVENT_TYPES, getOutbox } from "./bridgeStore";
import { ALL_NOTIFICATION_KINDS } from "./notificationsStore";
// Patch v10 (BUG-3 / BUG-6) — real KPI aggregation from canonical stores.
import { listSubscriptions } from "./subscriptionsStore";
import { getLedger } from "./captableCommitStore";
import { listActive as listActiveCollectiveMembers } from "./collectiveMembershipStore";
import { listAllInvitations } from "./roundInvitationsStore";
import { getRecentEvents } from "./sprint10Telemetry";
// Patch v12 Day 2 Wave 1 — audit_log + recon_runs + founder_tiers DB-backed.
import { getDb, rawDb } from "./db/connection";
import {
  auditLog as auditLogTable,
  reconRuns as reconRunsTable,
  founderTiers as founderTiersTable,
  platformConfig as platformConfigTable,
} from "../shared/schema";
import { log } from "./lib/logger";
import { resolveRateLimitClientIp } from "./lib/rateLimit"; /* WAVE 22 · ITEM 1 — shared hardened client-IP resolver for audit stamping */
// v25.42h round-2 (Blocker 2) — DB read failures must surface as 503, never as
// an empty/default literal payload.
import { DbUnavailableError } from "./lib/errors";

/**
 * Patch v10 — Live activity feed allowlist.
 *
 * Event types in this set are surfaced into the admin dashboard activity
 * feed in real time (not just the static demo seed). Previously these flowed
 * through the bridge / telemetry envelope but the admin dashboard's
 * `/api/admin/dashboard/activity` endpoint only returned the hard-coded
 * `activityFeed` seed — so promotion/cap-table/application events never
 * showed up live.
 */
const LIVE_ACTIVITY_ALLOWLIST = new Set<string>([
  "partner.deal.promoted_to_collective",
  "partner.deal.referred_to_capavate",
  "cap_table.mutated",
  "captable.mutated", // alias used by some emitters
  "collective_application_submitted",
  "collective.member.updated",
  "round.closed",
  "soft_circle.submitted",
  "investor_report.published",
]);

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/* ------------ Dashboard KPIs ------------ */
/**
 * Patch v10 (BUG-3) — derive KPIs from canonical stores instead of hardcoded
 * constants. We still synthesise a few demo-only fields (queue lengths,
 * sample IRRs) that have no canonical source yet, but the headline counts
 * (companies, MRR, investors, regions, funnels) all read from real stores.
 */
function computeKpis() {
  // v25.48 DATA-2 (V-1) — Active companies: read the CANONICAL DB company
  // inventory (getAllCompaniesFromDb), NOT the mockData `companies` array which
  // is empty on live and made this KPI report 0 while 54 real tenants existed.
  const totalCompanies = dbTotalCompanies();

  // Active investors: distinct userIds with at least one committed cap-table entry.
  const ledger = getLedger();
  const investorIds = new Set<string>();
  for (const e of ledger) {
    if (e.state === "committed") investorIds.add(e.investorId);
  }
  const totalInvestors = investorIds.size;

  // v25.48 DATA-2 (V-2) — Soft-circle pipeline: sum from the canonical
  // softCircleStore (DB), not the mockData `softCircles` array.
  const totalCommittedSoftCircle = dbTotalCommittedSoftCircle();

  // v25.48 DATA-2 (V-3) — Funded: sum of Round.raisedAmount from the DB-backed
  // roundsStore (listRounds), not the mockData `rounds` array (which also used
  // the wrong field name `amountRaised`).
  const totalFunded = dbTotalFunded();

  // v25.42h — growth/churn/NRR now DB-derived from subscriptions +
  // subscriptions_history. Any metric without a defensible source returns
  // null so the UI shows "N/A — historical data not available" instead of a
  // fabricated number (was hardcoded 11.4 / 2.1 / 1.18).
  const { momGrowthPct, churnPct, nrr } = computeSubscriptionMetrics();

  const outbox = getOutbox();
  const queues = {
    /* WAVE 24 · ITEM 3b (FINAL REVIEW B, F-1). These two were hardcoded `0`,
       which on the dashboard is indistinguishable from a real measurement of
       an empty queue. Neither has a backing store: there is no eligibility
       recompute queue table, and outbound email goes through the bridge outbox
       (counted separately, just below) rather than a queue of its own. `null`
       renders as "—" at Dashboard.tsx:454 (`{value ?? "—"}`), which is the
       honest claim — unmeasured, not empty. The two figures beneath ARE
       measured, from `getOutbox()`, and stay numeric. */
    eligibilityRecompute: null,
    emailQueue: null,
    bridgeOutbox: outbox.filter(e => e.status === "queued").length,
    deadLetter: outbox.filter(e => e.status === "dead_letter").length,
    /* W-COLLECTIVE Wave 1 (v5 §A.2) — additive; archived envelopes are retained
       history, not queue depth, so they get their own bucket. */
    bridgeOutboxArchived: outbox.filter(e => e.status === "archived").length,
  };
  // v25.42h — health.capTableReconcile now DB-derived from recon_runs. The
  // remaining sub-fields (closeGateFailures, dataroomUploadErrors,
  // messageDelivery, emailSlaSec) have no canonical source table in this wave
  // and are returned as null so the UI shows "N/A" rather than fabricated
  // counts (were 318/316, 4, 2, 1284/1281, 38).
  const reconHealth = computeReconHealth();
  const health = {
    capTableReconcile: reconHealth,
    closeGateFailures: null,
    dataroomUploadErrors: null,
    messageDelivery: { sent: null, delivered: null, deliveryRatePct: null },
    emailSlaSec: null,
  };
  // v25.42h — funnels now DB-derived from audit_log event-type counts.
  const funnels = computeFunnels();
  // v25.42h — top companies / investors now DB-derived (real companies ordered
  // by activity; real role=investor users ordered by deal/audit activity).
  // `raised` / `committed` return null where no canonical aggregate exists.
  const topCompanies = computeTopCompanies(5);
  const topInvestors = computeTopInvestors(3);
  // v25.48 DATA-2 (V-3) — Regions: derived from REAL DB companies + their DB
  // rounds (dbRegions), not the mockData `companies`/`rounds` arrays. Falls back
  // to a single "GLOBAL" bucket only when a company has no region set.
  const regionAcc = new Map<string, { companies: number; raised: number }>();
  for (const r of dbRegions()) {
    regionAcc.set(r.code, { companies: r.companies, raised: r.raised });
  }
  const regions = Array.from(regionAcc.entries()).map(([code, v]) => ({ code, ...v }));

  // MRR/ARR: sum of `annualAmountMinor` across active subscriptions, in dollars.
  const subs = listSubscriptions();
  const activeSubs = subs.filter((s) => s.status === "active" || s.status === "trialing");
  /* WAVE 34 · TASK 2 — was:
   *   const arrUsd = Math.round(activeSubs.reduce((sum, s) => sum + (s.annualAmountMinor ?? 0), 0) / 100);
   * TWO defects in one line. (1) It summed `annualAmountMinor` ACROSS
   * currencies: `Subscription.currency` is a real per-row ISO-4217 code, and a
   * scalar total of ¥ + $ is not a number that means anything. (2) It then
   * divided that mixed total by a hardcoded 100 and labelled the result `Usd`.
   * A single ¥1,200,000 subscription added 12,000 to "ARR in USD".
   *
   * The fix aggregates PER CURRENCY in minor units (never summing across), and
   * `arrUsd`/`mrrUsd` keep their exact contract — they are now honestly the USD
   * slice, converted at USD's own exponent via `fromMinor`. Nothing is dropped:
   * the full per-currency picture is ADDED alongside as
   * `arrByCurrencyMinor` / `mrrByCurrencyMinor`, the same Record<currency,minor>
   * shape the SPV tiles already use. */
  const arrByCurrencyMinor: Record<string, number> = Object.create(null);
  for (const s of activeSubs) {
    const ccy = String(s.currency || "USD").toUpperCase();
    arrByCurrencyMinor[ccy] = (arrByCurrencyMinor[ccy] ?? 0) + (s.annualAmountMinor ?? 0);
  }
  const mrrByCurrencyMinor: Record<string, number> = Object.create(null);
  for (const ccy of Object.keys(arrByCurrencyMinor)) {
    mrrByCurrencyMinor[ccy] = Math.round(arrByCurrencyMinor[ccy] / 12);
  }
  const arrUsd = Math.round(fromMinor(arrByCurrencyMinor["USD"] ?? 0, "USD"));
  const mrrUsd = Math.round(arrUsd / 12);

  // Wave B v26.4.0-fix (BLOCK-K) — SPV KPIs. Per-currency maps so the UI can
  // render one tile per currency (matching the multi-currency reality of
  // Capavate's live test SPVs — Test SPV/USD, Asian Biotech/CAD, etc.).
  const totalSpvCommittedMinor = dbTotalSpvCommittedMinor();
  const totalSpvWiredMinor = dbTotalSpvWiredMinor();
  const totalActiveSpvs = dbTotalActiveSpvs();

  return {
    summary: {
      totalCompanies,
      totalInvestors,
      totalCommittedSoftCircle,
      totalFunded,
      mrrUsd,
      arrUsd,
      /* WAVE 34 · TASK 2 — the full multi-currency picture, added not swapped. */
      arrByCurrencyMinor,
      mrrByCurrencyMinor,
      momGrowthPct,
      churnPct,
      nrr,
      // Wave B v26.4.0-fix (BLOCK-K) — SPV KPI tiles.
      totalSpvCommittedMinor,
      totalSpvWiredMinor,
      totalActiveSpvs,
    },
    queues,
    health,
    funnels,
    topCompanies,
    topInvestors,
    regions,
    // Patch v10 — collective-side counts for cross-surface dashboards.
    collective: {
      activeMembers: listActiveCollectiveMembers().length,
    },
  };
}

/* ------------ Sprint 28 Wave 2 — Collective-side KPIs ------------ */
/**
 * The Collective is the member-facing accredited-investor community layer that
 * sits on top of Capavate. The admin needs visibility into BOTH surfaces:
 *  - Capavate (operations): companies, rounds, cap tables, soft circles
 *  - Collective (community): members, tiers, applications, syndicates, deal flow
 *
 * This function returns the same shape as computeKpis() (so the dashboard can
 * render the same components) but populated with Collective-flavoured numbers.
 */
function computeCollectiveKpis() {
  // v25.42h — 100% DB-derived from the real Collective tables
  // (collective_memberships, chapters, chapter_memberships, collective_apps,
  // subscriptions). Was entirely hardcoded (totalMembers=142, etc.). Metrics
  // with no defensible source return null so the UI shows an explicit "N/A"
  // state rather than a fabricated number.
  const m = computeCollectiveKpisFromDb();
  const queues = {
    pendingApplications: m.pendingApplications,
    pendingKyc: null,                  // no KYC-queue source table this wave
    syndicationAllocations: null,      // no syndicate-allocation source this wave
    deadLetter: getOutbox().filter(e => e.status === "dead_letter").length,
  };
  // Collective-shared cap-table reconciles share the same recon_runs table.
  const reconHealth = computeReconHealth();
  const health = {
    capTableReconcile: reconHealth,
    closeGateFailures: null,
    dataroomUploadErrors: null,
    messageDelivery: { sent: null, delivered: null, deliveryRatePct: null },
    emailSlaSec: null,
  };
  // Onboarding funnel from collective_apps status counts; investor funnel from
  // audit_log event-type counts (shared with the Capavate funnel helper).
  const appStatusCount = (statuses: string[]): number => {
    if (statuses.length === 0) return 0;
    const ph = statuses.map(() => "?").join(",");
    try {
      return Number((dbGet(`SELECT COUNT(*) AS n FROM collective_apps WHERE deleted_at IS NULL AND status IN (${ph})`, ...statuses) as { n: number })?.n ?? 0);
    } catch (err) {
      // v25.42h round-2 (Blocker 2b) — fail-closed: rethrow rather than reporting
      // a fabricated 0 application count. Propagates to the KPI route as 503.
      log.warn("[adminPlatformStore.computeCollectiveKpis.appStatusCount] DB read failed:", (err as Error).message);
      throw new DbUnavailableError("collective application counts", err);
    }
  };
  const funnels = {
    onboarding: [
      { step: "application_started",   count: appStatusCount(["started", "draft"]) },
      { step: "application_submitted", count: appStatusCount(["submitted", "pending", "in_review"]) },
      { step: "kyc_completed",         count: appStatusCount(["kyc_completed", "approved"]) },
      { step: "member_activated",      count: m.activeMembers },
    ],
    investor: computeFunnels().investor,
  };
  // No member-tier brand aggregate table exists; surface real chapters as the
  // "top" rows (name + member activity) instead of fabricated tier brands.
  let topCompanies: { id: string; name: string; traction: number; raised: number | null }[] = [];
  try {
    topCompanies = (dbAll(
      `SELECT ch.id AS id, ch.name AS name, COUNT(cm.user_id) AS members
         FROM chapters ch
         LEFT JOIN chapter_memberships cm ON cm.chapter_id = ch.id AND cm.deleted_at IS NULL
        WHERE ch.deleted_at IS NULL
        GROUP BY ch.id, ch.name
        ORDER BY members DESC, ch.name ASC
        LIMIT 5`,
    ) as Array<{ id: string; name: string; members: number }>).map((r) => ({
      id: r.id, name: r.name, traction: Number(r.members ?? 0), raised: null,
    }));
  } catch (err) {
    // v25.42h round-2 (Blocker 2b) — fail-closed: rethrow rather than returning
    // an empty top-companies list as if the chapters table were genuinely empty.
    log.warn("[adminPlatformStore.computeCollectiveKpis.topCompanies] DB read failed:", (err as Error).message);
    throw new DbUnavailableError("collective top companies", err);
  }
  const topInvestors = computeTopInvestors(3);
  // Regions from real chapters grouped by region.
  let regions: { code: string; companies: number; raised: number | null }[] = [];
  try {
    regions = (dbAll(
      `SELECT COALESCE(region, 'GLOBAL') AS code, COUNT(*) AS n
         FROM chapters WHERE deleted_at IS NULL
        GROUP BY code ORDER BY n DESC`,
    ) as Array<{ code: string; n: number }>).map((r) => ({ code: r.code, companies: Number(r.n ?? 0), raised: null }));
  } catch (err) {
    // v25.42h round-2 (Blocker 2b) — fail-closed: rethrow rather than returning
    // an empty regions list as if no chapters had a region.
    log.warn("[adminPlatformStore.computeCollectiveKpis.regions] DB read failed:", (err as Error).message);
    throw new DbUnavailableError("collective regions", err);
  }
  return {
    summary: {
      totalCompanies: m.totalMembers,          // re-use shape: "companies" = members
      totalInvestors: m.activeMembers,         // "investors" = active members
      totalCommittedSoftCircle: null,          // no syndication-commit aggregate this wave
      totalFunded: null,                       // no deployed-syndication aggregate this wave
      momGrowthPct: m.momGrowthPct,
      churnPct: m.churnPct,
      nrr: m.nrr,
    },
    queues,
    health,
    funnels,
    topCompanies,
    topInvestors,
    regions,
  };
}
/* ------------ Activity feed ------------ */
const activityFeed: Array<{ id: string; ts: string; actor: string; entity: string; kind: string; text: string }> = [
  { id: "act_1", ts: new Date(Date.now() - 2 * 60_000).toISOString(), actor: "u_maya", entity: "co_novapay", kind: "round.closed", text: "NovaPay Seed Extension closed — $4.0M" },
  { id: "act_2", ts: new Date(Date.now() - 6 * 60_000).toISOString(), actor: "u_aisha_patel", entity: "co_novapay", kind: "soft_circle.submitted", text: "Aisha soft-circled $250K" },
  { id: "act_3", ts: new Date(Date.now() - 18 * 60_000).toISOString(), actor: "u_admin", entity: "platform", kind: "lifecycle_policy.changed", text: "Admin updated nonPaymentGraceDays = 30" },
  { id: "act_4", ts: new Date(Date.now() - 32 * 60_000).toISOString(), actor: "u_admin", entity: "co_quanta", kind: "compliance.hold_placed", text: "Compliance hold on Quanta SPV" },
  { id: "act_5", ts: new Date(Date.now() - 64 * 60_000).toISOString(), actor: "u_helia_founder", entity: "co_helia", kind: "investor_report.published", text: "Helia April KPI report sent" },
];

/* ------------ Users & Auth ------------ */
type AdminRole = "Admin" | "Founder" | "Investor" | "Collective Member" | "Consortium Partner";
interface AdminUser {
  id: string; name: string; email: string; roles: AdminRole[];
  mfaEnabled: boolean; suspended: boolean;
  lastLoginAt: string; lastLoginIp: string; lastLoginDevice: string;
  loginHistory: { at: string; ip: string; device: string; success: boolean; geo: string }[];
  sessions: { id: string; createdAt: string; lastSeenAt: string; ip: string; device: string }[];
}
const users: AdminUser[] = [
  { id: "u_admin", name: "Capavate Admin", email: "ops@capavate.com", roles: ["Admin"], mfaEnabled: true, suspended: false,
    lastLoginAt: new Date().toISOString(), lastLoginIp: "172.0.0.1", lastLoginDevice: "macOS · Chrome 128",
    loginHistory: [
      { at: new Date(Date.now()-3600_000).toISOString(), ip: "172.0.0.1", device: "macOS · Chrome 128", success: true, geo: "San Francisco, US" },
      { at: new Date(Date.now()-7200_000).toISOString(), ip: "172.0.0.1", device: "macOS · Chrome 128", success: true, geo: "San Francisco, US" },
    ],
    sessions: [{ id: "sess_admin_1", createdAt: new Date(Date.now()-3600_000).toISOString(), lastSeenAt: new Date().toISOString(), ip: "172.0.0.1", device: "macOS · Chrome 128" }],
  },
  { id: "u_maya", name: "Maya Chen", email: "maya@novapay.ai", roles: ["Founder"], mfaEnabled: true, suspended: false,
    lastLoginAt: new Date().toISOString(), lastLoginIp: "73.21.112.4", lastLoginDevice: "iPad · Safari",
    loginHistory: [
      { at: new Date(Date.now()-1800_000).toISOString(), ip: "73.21.112.4", device: "iPad · Safari", success: true, geo: "Brooklyn, US" },
      { at: new Date(Date.now()-86400_000).toISOString(), ip: "73.21.112.4", device: "Mac · Chrome", success: true, geo: "Brooklyn, US" },
    ],
    sessions: [{ id: "sess_maya_1", createdAt: new Date(Date.now()-1800_000).toISOString(), lastSeenAt: new Date().toISOString(), ip: "73.21.112.4", device: "iPad · Safari" }],
  },
  { id: "u_aisha_patel", name: "Aisha Patel", email: "aisha@hydra.vc", roles: ["Investor", "Collective Member"], mfaEnabled: false, suspended: false,
    lastLoginAt: new Date(Date.now() - 30 * 60_000).toISOString(), lastLoginIp: "98.55.41.211", lastLoginDevice: "iPhone · Safari",
    loginHistory: [
      { at: new Date(Date.now() - 30 * 60_000).toISOString(), ip: "98.55.41.211", device: "iPhone · Safari", success: true, geo: "London, UK" },
      { at: new Date(Date.now() - 2 * 86400_000).toISOString(), ip: "203.0.113.42", device: "Mac · Firefox", success: false, geo: "Singapore (geo-mismatch)" },
    ],
    sessions: [{ id: "sess_aisha_1", createdAt: new Date(Date.now() - 30 * 60_000).toISOString(), lastSeenAt: new Date().toISOString(), ip: "98.55.41.211", device: "iPhone · Safari" }],
  },
  { id: "u_lapsed_lp", name: "Cascadia LP", email: "ops@cascadia.fund", roles: ["Investor"], mfaEnabled: false, suspended: true,
    lastLoginAt: new Date(Date.now() - 90 * 86400_000).toISOString(), lastLoginIp: "8.8.8.8", lastLoginDevice: "Chrome",
    loginHistory: [
      { at: new Date(Date.now() - 90 * 86400_000).toISOString(), ip: "8.8.8.8", device: "Chrome", success: true, geo: "Seattle, US" },
    ],
    sessions: [],
  },
  { id: "u_p_y_combinator", name: "Y Combinator", email: "partner@ycombinator.com", roles: ["Consortium Partner"], mfaEnabled: true, suspended: false,
    lastLoginAt: new Date(Date.now() - 5 * 86400_000).toISOString(), lastLoginIp: "104.17.0.5", lastLoginDevice: "Chrome",
    loginHistory: [
      { at: new Date(Date.now() - 5 * 86400_000).toISOString(), ip: "104.17.0.5", device: "Chrome", success: true, geo: "Mountain View, US" },
    ],
    sessions: [],
  },
];

/* ------------ Audit log w/ tamper-evident chain ------------
 *
 * Patch v12 Day 2 Wave 1 — audit_log is now DB-backed.
 *
 * The in-memory `auditLog: AuditEntry[]` array remains as a READ MIRROR. It
 * preserves:
 *   - the legacy `_testAdmin.auditLog` test access (length = 0 reset works)
 *   - `getAuditLog()` returning the same in-process array reference
 *   - synchronous appends (better-sqlite3 transactions are synchronous)
 *
 * Schema column-name mapping (per the audit §3.8 brief):
 *   store field   <-> schema column (shared/schema.ts auditLog)
 *   --------------    ----------------------------------------
 *   actor         <-> actor_id
 *   entity        <-> target           (packed as "<kind>:<id>" when applicable)
 *   eventType     <-> action
 *   payload       <-> payload_json     (JSON.stringify on write, parse on hydrate)
 *   priorHash     <-> prev_hash
 *   hash          <-> hash
 *   ts            <-> created_at
 *
 * Hash chain is tenant-scoped: each tenant has its own SHA-256 chain. The
 * chain tip is read inside the SAME transaction that inserts the new row —
 * better-sqlite3's BEGIN IMMEDIATE serializes writers, so two parallel inserts
 * for the same tenant will never race on the chain head (DB-6).
 */
interface AuditEntry {
  id: string;
  ts: string;
  actor: string;
  entity: string;
  eventType: string;
  payload: Record<string, unknown>;
  priorHash: string;
  hash: string;
  tenantId: string;
}
const auditLog: AuditEntry[] = [];

/** Cap on the in-memory mirror; hydrator loads the most recent N rows. */
const AUDIT_MIRROR_LIMIT = 5000;

/** Default per-tenant resolver — derive from the entity string if possible. */
function resolveTenantId(entity: string, explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  // entity like "co_<id>" or "company:co_<id>" or "contact:<id>" etc.
  // Match co_<id> as the most reliable signal of a company tenant.
  const m = entity.match(/co_([a-z0-9_]+)/i);
  if (m) return `tenant_co_${m[1]}`;
  // Any other entity (platform / users / partners / campaigns) routes to the
  // platform tenant so the chain is still consistent.
  return "tenant_platform";
}

export function getAuditLog(): AuditEntry[] {
  return auditLog;
}

/* v25.47 APD-029 (BLOCKER-6) — audit-chain continuity health.
 *
 * Reads the additive `audit_chain_health` table (DB-driven; no in-memory
 * canonical state). Each row is a per-tenant continuity flag the P0 banner
 * consumes. `incident` is true when ANY row is not "ok", so the admin shell
 * can surface the banner without re-deriving status client-side. */
export interface AuditChainHealthRow {
  key: string;
  status: string;
  detail: string | null;
  updatedAt: string | null;
}

export function getAuditChainHealth(): { rows: AuditChainHealthRow[]; incident: boolean } {
  let rows: AuditChainHealthRow[] = [];
  try {
    const raw = rawDb()
      .prepare(`SELECT key, status, detail, updated_at FROM audit_chain_health ORDER BY key`)
      .all() as Array<{ key: string; status: string; detail: string | null; updated_at: string | null }>;
    rows = raw.map((r) => ({
      key: r.key,
      status: r.status,
      detail: r.detail ?? null,
      updatedAt: r.updated_at ?? null,
    }));
  } catch {
    rows = [];
  }
  const incident = rows.some((r) => String(r.status).toLowerCase() !== "ok");
  return { rows, incident };
}

/**
 * W-V44 (banner) — admin RESOLVE control for an audit-chain-health incident.
 * DB-driven, no in-memory state. Honest by design: it does NOT blindly clear
 * the banner. It flips the row to `ok` ONLY when `verified` is true (the caller
 * has just re-run the real chain verification and it passed). If verification
 * did NOT pass, the row is left as an incident (we never hide a real break).
 * Returns the refreshed health snapshot.
 *
 * @param key       the audit_chain_health.key to resolve (e.g. tenant_admin_capavate)
 * @param verified  true only if a fresh chain verification passed cleanly
 * @param note      short admin note stored in `detail` for the audit trail
 */
export function resolveAuditChainHealth(
  key: string,
  verified: boolean,
  note: string,
): { ok: boolean; cleared: boolean; rows: AuditChainHealthRow[]; incident: boolean } {
  if (!verified) {
    // Refuse to clear — the chain did not verify clean. Keep the incident.
    const snap = getAuditChainHealth();
    return { ok: false, cleared: false, ...snap };
  }
  try {
    rawDb()
      .prepare(
        `UPDATE audit_chain_health SET status = 'ok', detail = ?, updated_at = ? WHERE key = ?`,
      )
      .run(
        note && note.trim().length > 0
          ? `Resolved by admin: ${note.trim()}`
          : "Resolved by admin after clean re-verification.",
        new Date().toISOString(),
        key,
      );
  } catch (err) {
    log.error("[resolveAuditChainHealth] update failed:", (err as Error).message);
    const snap = getAuditChainHealth();
    return { ok: false, cleared: false, ...snap };
  }
  const snap = getAuditChainHealth();
  return { ok: true, cleared: true, ...snap };
}

/**
 * Append a new audit entry. Tenant-scoped, hash-chained, DB-backed.
 *
 * Signature is backward-compatible: existing 4-arg callers (actor, entity,
 * eventType, payload) keep working; new callers may pass an explicit tenantId.
 */
export function appendAdminAudit(
  actor: string,
  entity: string,
  eventType: string,
  payload: Record<string, unknown>,
  tenantId?: string,
): AuditEntry {
  return appendAudit(actor, entity, eventType, payload, tenantId);
}

/**
 * Wave A-1 (ADR-3 action 2): the single ordering + soft-delete function.
 *
 * Writer and verifier MUST agree on how the chain is ordered and how
 * soft-deleted rows are treated. Any drift here forks the chain.
 *
 * Design decisions (from ADR-3 rationale):
 *   - `deleted_at` MUST NOT participate in chain math — audit_log is
 *     append-only; the column exists for schema symmetry only. Both writer
 *     and verifier ignore it.
 *   - Ordering is `created_at ASC, id ASC`. The `id ASC` tiebreak closes
 *     the same-millisecond flake documented in §6.5.
 *
 * The writer reads the tip via this canonical form (single-row LIMIT 1
 * against a scoped tenant, DESC pairing of the same ordering — last row
 * by (created_at, id) is the tip). The verifier walks in ASC order using
 * the same ordering.
 *
 * DO NOT REFACTOR THE STRING FORMULA. `${prevHash}|${id}|${eventType}|${entity}|${ts}|${payloadStr}`
 * is byte-compatible with every hash already in the chain. A change here
 * invalidates the entire history.
 */
// Wave A-1 v2 (ADR-3): the id must be insertion-monotonic so (created_at, id)
// sorts by insertion order. Random ids collide within the same millisecond
// (Opus/GPT-5 v1 B1). The id encodes a millisecond timestamp in base36 (9
// chars fixed-width, sortable through year 2059+) followed by a per-process
// monotonic counter (5 hex chars) then 6 random hex chars for uniqueness
// across processes. Total length after "al_" prefix: 20 chars.
let _auditIdCounter = 0;
let _auditIdLastMs = 0;
export function generateAuditId(nowMs: number = Date.now()): string {
  // Advance clock or reset counter within the same millisecond.
  if (nowMs > _auditIdLastMs) {
    _auditIdLastMs = nowMs;
    _auditIdCounter = 0;
  } else {
    _auditIdCounter++;
    // If the caller reused a stale ms, force strict monotonicity: bump
    // effective ms upward for the id lexicographic sort. This is safe
    // because the id is not the source of truth for ordering; created_at is
    // still the ISO string and (created_at, id) tie-breaks with id.
    nowMs = _auditIdLastMs;
  }
  const ts = nowMs.toString(36).padStart(9, "0").slice(-9);
  const ctr = _auditIdCounter.toString(16).padStart(5, "0").slice(-5);
  const rand = randomBytes(3).toString("hex"); // 6 hex chars
  return `al_${ts}${ctr}${rand}`;
}

export const AUDIT_CHAIN_ORDER_SQL_ASC = "ORDER BY created_at ASC, id ASC" as const;
export const AUDIT_CHAIN_ORDER_SQL_DESC = "ORDER BY created_at DESC, id DESC" as const;

/** SQL fragment listing the columns needed by both writer and verifier,
 *  keyed on tenant_id and IGNORING deleted_at (audit_log is append-only). */
export const AUDIT_CHAIN_SELECT_SQL =
  `SELECT id, action, target, created_at AS ts, payload_json AS "payloadJson", prev_hash AS "priorHash", hash FROM audit_log WHERE tenant_id = ? ${AUDIT_CHAIN_ORDER_SQL_ASC}` as const;

/** SQL fragment for tip read: newest link by (created_at, id). */
export const AUDIT_CHAIN_TIP_SQL =
  `SELECT hash FROM audit_log WHERE tenant_id = ? ${AUDIT_CHAIN_ORDER_SQL_DESC} LIMIT 1` as const;

/**
 * Wave A-1 v2 (ADR-3): shared chain verifier used by /verify, /resolve, and
 * the boot tick. Applies the chain_genesis re-base.
 *
 * Genesis contract (v2 corrected per Opus/GPT-5 v2 B1/B2):
 *   audit_chain_genesis.anchor_hash IS the hash the walker uses as its
 *     starting `prior`. The FIRST row verified is the first row whose
 *     created_at > genesis.effective_at (or, equivalently, whose id sorts
 *     lexicographically after any pre-genesis marker).
 *   audit_chain_genesis.anchor_row_id (nullable) is the id of the LAST
 *     pre-genesis row — informational only; the walker uses it to skip
 *     everything up to and including it.
 *   When a tenant has ONLY malformed rows and no valid successors yet,
 *     the migration pins anchor_hash = <chosen pre-genesis row's hash>
 *     and anchor_row_id = <that row's id>. Verification then walks zero
 *     post-genesis rows and returns ok=true — no false green because the
 *     boot tick will re-run once any successor is appended.
 */
export interface AuditChainVerifyResult {
  tenantId: string;
  ok: boolean;
  brokenAt: number;
  totalLinks: number;
  genesisApplied: boolean;
  genesisHash: string | null;
  preGenesisRowCount: number;
}

export function verifyTenantAuditChain(
  db: import("better-sqlite3").Database,
  tenantId: string,
): AuditChainVerifyResult {
  // 1. Look up the chain_genesis record if present.
  let anchorHash: string | null = null;
  let anchorRowId: string | null = null;
  try {
    const g = db
      .prepare(
        `SELECT anchor_hash AS "anchorHash", anchor_row_id AS "anchorRowId" FROM audit_chain_genesis WHERE tenant_id = ?`,
      )
      .get(tenantId) as { anchorHash: string; anchorRowId: string | null } | undefined;
    if (g) {
      anchorHash = g.anchorHash;
      anchorRowId = g.anchorRowId ?? null;
    }
  } catch {
    // audit_chain_genesis table not yet migrated — fall back to "0"*64.
  }
  // 2. Walk the chain.
  const rows = db.prepare(AUDIT_CHAIN_SELECT_SQL).all(tenantId) as Array<{ id: string; action: string; target: string; ts: string; payloadJson: string | null; priorHash: string | null; hash: string }>;
  // 3. If a genesis is set: FAIL CLOSED if the anchor row is missing or its
  //    stored hash differs from anchor_hash (GPT-5 v2.1 B1). A dangling
  //    anchor is not a graceful degradation — it silently changes the
  //    declared contract into "trust whatever hash is in the genesis table."
  let startIndex = 0;
  if (anchorHash !== null && anchorRowId !== null) {
    const idx = rows.findIndex((r) => r.id === anchorRowId);
    if (idx < 0) {
      // Anchor row was deleted or never existed. Fail closed with a
      // distinct brokenAt=-2 sentinel so the caller can distinguish from
      // a chain that broke mid-walk.
      return {
        tenantId,
        ok: false,
        brokenAt: -2,
        totalLinks: rows.length,
        genesisApplied: true,
        genesisHash: anchorHash,
        preGenesisRowCount: 0,
      };
    }
    if (rows[idx].hash !== anchorHash) {
      // Anchor row exists but its stored hash disagrees with the pinned
      // genesis hash. Someone tampered with either the row or the genesis
      // record. Fail closed with brokenAt=-3.
      return {
        tenantId,
        ok: false,
        brokenAt: -3,
        totalLinks: rows.length,
        genesisApplied: true,
        genesisHash: anchorHash,
        preGenesisRowCount: 0,
      };
    }
    startIndex = idx + 1;
  }
  const effectiveRows = rows.slice(startIndex);
  const prior0 = anchorHash ?? "0".repeat(64);
  let prior = prior0;
  let broken = -1;
  for (let i = 0; i < effectiveRows.length; i++) {
    const a = effectiveRows[i];
    if (a.priorHash !== prior) { broken = i; break; }
    const expected = sha256(`${prior}|${a.id}|${a.action}|${a.target}|${a.ts}|${a.payloadJson ?? "{}"}`);
    if (a.hash !== expected) { broken = i; break; }
    prior = a.hash;
  }
  return {
    tenantId,
    ok: broken === -1,
    brokenAt: broken,
    totalLinks: effectiveRows.length,
    genesisApplied: anchorHash !== null,
    genesisHash: anchorHash,
    preGenesisRowCount: startIndex,
  };
}

function appendAudit(
  actor: string,
  entity: string,
  eventType: string,
  payload: Record<string, unknown>,
  explicitTenantId?: string,
): AuditEntry {
  const id = generateAuditId();
  const ts = new Date().toISOString();
  const tenantId = resolveTenantId(entity, explicitTenantId);
  const payloadStr = JSON.stringify(payload);

  // DB-6: a single BEGIN IMMEDIATE transaction reads the per-tenant chain tip
  // and inserts the new row. Concurrent inserts for the same tenant are
  // serialized by sqlite, so two appends can never compute the same prevHash.
  let finalEntry: AuditEntry | null = null;
  try {
    const db = getDb();
    db.transaction((tx: any) => {
      // CROSS-TENANT (admin) — the chain-tip read is intentionally scoped to a
      // SINGLE tenantId (the entry's own), but bypasses any soft-delete filter
      // because audit_log is append-only and `deleted_at` must never participate
      // in chain math even though the column exists for schema symmetry.
      // Wave A-1 (ADR-3 action 2): (created_at DESC, id DESC) matches the
      // canonical AUDIT_CHAIN_ORDER_SQL_DESC. `deleted_at` deliberately
      // ignored — append-only chain math.
      const tipRow = tx
        .select({ hash: auditLogTable.hash })
        .from(auditLogTable)
        .where(eq(auditLogTable.tenantId, tenantId))
        .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
        .limit(1)
        .all() as Array<{ hash: string }>;
      const prevHash = tipRow[0]?.hash ?? "0".repeat(64);
      const body = `${prevHash}|${id}|${eventType}|${entity}|${ts}|${payloadStr}`;
      const hash = sha256(body);

      tx.insert(auditLogTable)
        .values({
          id,
          tenantId,
          actorId: actor,
          action: eventType,
          target: entity, // packed entity is acceptable per audit §3.8 (no target_id column).
          targetId: null,
          payloadJson: payloadStr,
          prevHash,
          hash,
          createdAt: ts,
          deletedAt: null,
        })
        .run();

      finalEntry = { id, ts, actor, entity, eventType, payload, priorHash: prevHash, hash, tenantId };
    });
  } catch (err) {
    /* v25.23 NH-J fix — prevent in-memory audit-chain corruption on DB failure.
     *
     * Previous behaviour: on DB write failure we logged the error, minted a
     * synthetic in-memory entry with `prevHash = 0*64`, and returned it as
     * success. That reset the chain tip in the cache and corrupted future
     * audits (a successful DB write would then compute against a synthetic
     * prevHash, producing an unverifiable chain segment). Callers also got a
     * fake `hash` for an event that does not exist in audit_log, violating
     * the NO MEMORY STORAGE rule.
     *
     * Fix: log loudly with a distinct AUDIT_DB_WRITE_FAILED error type and
     * DO NOT mirror the failed write into the in-memory cache (so the chain
     * tip is undisturbed). Many call sites are *not* wrapped in try/catch
     * today (companyProfileStore, emailCampaignStore, etc.), so unconditionally
     * throwing would crash route handlers; instead we return a tagged
     * `AuditEntry` with `hash: ""` and `priorHash: ""` so callers receive a
     * value but the chain in the cache remains uncorrupted. Tests / verifiers
     * can detect the failure via the empty hash sentinel. */
    log.error({
      route: "adminPlatformStore.appendAudit",
      errorType: "AUDIT_DB_WRITE_FAILED",
      message: (err as Error).message,
      actor,
      entity,
      eventType,
      tenantId,
    });
    // Return a sentinel entry; do NOT mirror into auditLog cache.
    return { id, ts, actor, entity, eventType, payload, priorHash: "", hash: "", tenantId };
  }

  // Mirror into the in-memory cache. Cap the mirror size so it never grows
  // unbounded under heavy write load.
  auditLog.push(finalEntry!);
  if (auditLog.length > AUDIT_MIRROR_LIMIT) {
    auditLog.splice(0, auditLog.length - AUDIT_MIRROR_LIMIT);
  }
  return finalEntry!;
}

function seedAudit() {
  if (auditLog.length > 0) return;
  const seed: Array<[string,string,string,Record<string,unknown>]> = [
    ["u_maya","co_novapay","cap_table.mutated",{ roundId: "rnd_novapay_seed", txCount: 3 }],
    ["u_aisha_patel","co_novapay","soft_circle.submitted",{ amount: 250000, currency: "USD" }],
    ["u_admin","platform","lifecycle_policy.changed",{ founderTenureDays: 180 }],
    ["u_maya","co_novapay","round.closed",{ amountClosed: 4000000 }],
    ["u_admin","co_helia","compliance.hold_placed",{ reason: "Form D not filed" }],
    ["u_maya","co_novapay","investor_report.published",{ readers: 9 }],
    ["u_admin","u_lapsed_lp","membership.lapsed",{ graceDays: 30 }],
    ["u_admin","co_novapay","audit_log.appended",{ source: "bridge" }],
    ["u_aisha_patel","u_aisha_patel","kyc.status_changed",{ newStatus: "verified" }],
    ["u_admin","platform","formula.published",{ formulaId: "ca-default-v2", version: "2.0.0" }],
  ];
  for (const [a,e,t,p] of seed) appendAudit(a,e,t,p);
}
// Patch v4: seed audit only when demo gate is on.
if (DEMO_SEED_ENABLED) {
  seedAudit();
}

/* ============================================================
 * v25.42h Housekeeping — DB-derived admin metrics helpers.
 *
 * These replace the hardcoded literals that previously seeded the admin
 * dashboard (momGrowthPct/churn/nrr, health, funnels, topCompanies/Investors,
 * collective KPIs, activity feed, per-company stats, investor lookup). The
 * store header described all store data as "in-memory mock seeded from
 * existing fixtures" — i.e. OUR preview code, not Avi's. Per the brief:
 *   - real DB-derived value when the source rows exist, OR
 *   - null  → UI renders an explicit "N/A — historical data not available"
 *             state (NEVER a fabricated number), OR
 *   - 503 + ok:false at the route layer on a hard DB error.
 *
 * All reads use rawDb() (synchronous better-sqlite3) and exclude soft-deleted
 * rows (deleted_at IS NULL) where the column exists.
 * ============================================================ */

/** Run a parametrized SELECT, returning rows or throwing on DB error. */
function dbAll(sql: string, ...binds: any[]): any[] {
  return rawDb().prepare(sql).all(...binds) as any[];
}
function dbGet(sql: string, ...binds: any[]): any {
  return rawDb().prepare(sql).get(...binds);
}

/**
 * W2 Avi#2 (v26.2.0-w2) — admin↔investor profile/KYC RECONCILIATION.
 *
 * Root cause (Avi finding #2): the admin investor record reads `users`+`securities`
 * (and a `derived_inv_<invitationId>` snapshot elsewhere), NEVER the SACRED
 * profileStore where investors actually save name/bio/tax-id/KYC. So the admin
 * sees "empty / unverified" even though the investor's edits persisted.
 *
 * This helper lives in the NON-SACRED admin layer and only READS:
 *   - the real investor profile JSON from `profilestore_investor_profile`
 *     (the table SACRED profileStore writes; we do not import or mutate it),
 *   - the accreditation status via getAccreditationGateStatus (W2 A2),
 *   - KYC document descriptors embedded in the profile JSON.
 * It resolves synthetic `derived_inv_<invitationId>` ids to the real redeemer
 * userId via the previously-UNUSED `redeemed_by_user_id` join key.
 * Fail-soft: any read error returns nulls (never throws / never blocks the page).
 */
function reconcileInvestorProfileForAdmin(rawId: string): {
  resolvedUserId: string;
  profile: Record<string, any> | null;
  accreditationStatus: "none" | "self_certified" | "verified" | null;
  kycDocuments: Array<{ id?: string; name?: string; url?: string; uploadedAt?: string }>;
} {
  let resolvedUserId = rawId;
  // Resolve synthetic invitation-derived ids to the real redeemer userId.
  if (rawId.startsWith("derived_inv_")) {
    try {
      const invId = rawId.slice("derived_inv_".length);
      const inv = dbGet(
        "SELECT redeemed_by_user_id FROM round_invitations WHERE id = ?",
        invId,
      ) as { redeemed_by_user_id: string | null } | undefined;
      if (inv?.redeemed_by_user_id) resolvedUserId = inv.redeemed_by_user_id;
    } catch { /* fail-soft */ }
  }

  let profile: Record<string, any> | null = null;
  let kycDocuments: Array<{ id?: string; name?: string; url?: string; uploadedAt?: string }> = [];
  try {
    const row = dbGet(
      "SELECT profile_json FROM profilestore_investor_profile WHERE investor_id = ? AND deleted_at IS NULL",
      resolvedUserId,
    ) as { profile_json: string } | undefined;
    if (row?.profile_json) {
      const parsed = JSON.parse(row.profile_json);
      // profileStore stores { profile: {...}, ... } or a flat profile; handle both.
      profile = (parsed && typeof parsed === "object" && parsed.profile && typeof parsed.profile === "object")
        ? parsed.profile
        : parsed;
      const docs = profile && Array.isArray(profile.kycDocuments) ? profile.kycDocuments : [];
      kycDocuments = docs.filter((d: any) => d && typeof d === "object");
    }
  } catch { /* fail-soft: leave profile null */ }

  // Read the denormalized accreditation fast-flag DIRECTLY from the compliance
  // profile table. A static import of getAccreditationGateStatus would be
  // circular (investorComplianceRoutes already imports this module), and this
  // file has no createRequire shim (ESM-only, no new shims per project rules),
  // so we query the same source table the gate helper reads.
  let accreditationStatus: "none" | "self_certified" | "verified" | null = null;
  try {
    const acc = dbGet(
      "SELECT accreditation_status FROM investor_compliance_profile WHERE investor_id = ?",
      resolvedUserId,
    ) as { accreditation_status: string | null } | undefined;
    const s = acc?.accreditation_status ?? null;
    accreditationStatus =
      s === "verified" || s === "self_certified" ? s
      : s === null ? null
      : "none";
  } catch { accreditationStatus = null; }

  return { resolvedUserId, profile, accreditationStatus, kycDocuments };
}

/**
 * MoM growth / churn / NRR from subscriptions + subscriptions_history.
 * Returns null for any metric that cannot be computed from real history
 * (so the UI shows "N/A — historical data not available" instead of a lie).
 */
function computeSubscriptionMetrics(): { momGrowthPct: number | null; churnPct: number | null; nrr: number | null } {
  try {
    const activeNow = Number(
      (dbGet(`SELECT COUNT(*) AS n FROM subscriptions WHERE status IN ('active','trialing') AND deleted_at IS NULL`) as { n: number })?.n ?? 0,
    );
    const histCount = Number(
      (dbGet(`SELECT COUNT(*) AS n FROM subscriptions_history`) as { n: number })?.n ?? 0,
    );
    if (activeNow === 0 && histCount === 0) {
      return { momGrowthPct: null, churnPct: null, nrr: null };
    }
    const everCount = Number(
      (dbGet(
        `SELECT COUNT(DISTINCT company_id) AS n FROM (
           SELECT company_id FROM subscriptions WHERE deleted_at IS NULL
           UNION SELECT company_id FROM subscriptions_history
         )`,
      ) as { n: number })?.n ?? 0,
    );
    const cancelled = Math.max(0, everCount - activeNow);
    const churnPct = everCount > 0 ? Number(((cancelled / everCount) * 100).toFixed(2)) : null;
    // MoM growth requires a clean prior-period base. With only a single period
    // of history we cannot compute a defensible rate, so return null rather
    // than invent a number.
    const priorBase = everCount - activeNow;
    const momGrowthPct = histCount >= everCount && priorBase > 0
      ? Number((((activeNow - priorBase) / priorBase) * 100).toFixed(2))
      : null;
    // NRR requires per-period revenue retention snapshots we do not have; null.
    const nrr = null;
    return { momGrowthPct, churnPct, nrr };
  } catch (err) {
    // v25.42h round-2 (Blocker 2a) — fail-closed. A DB read failure here must NOT
    // be swallowed into a {null,null,null} payload; rethrow so the KPI route
    // responds 503 + ok:false.
    log.warn("[adminPlatformStore.computeSubscriptionMetrics] DB read failed:", (err as Error).message);
    throw new DbUnavailableError("subscription metrics", err);
  }
}

/** Cap-table reconcile health from the recon_runs table. */
function computeReconHealth(): { runs: number; success: number; successRatePct: number | null } {
  const runs = Number((dbGet(`SELECT COUNT(*) AS n FROM recon_runs WHERE deleted_at IS NULL`) as { n: number })?.n ?? 0);
  // A run is a success when its diff_json marks ok:true. INSTR avoids brittle
  // quote-escaping in a LIKE pattern; diff_json stores a JSON object.
  const success = Number(
    (dbGet(`SELECT COUNT(*) AS n FROM recon_runs WHERE deleted_at IS NULL AND INSTR(diff_json, '"ok":true') > 0`) as { n: number })?.n ?? 0,
  );
  const successRatePct = runs > 0 ? Number(((success / runs) * 100).toFixed(2)) : null;
  return { runs, success, successRatePct };
}

/**
 * Funnel step counts from audit_log event-type (action) counts. Steps with
 * zero matches still appear (count: 0) so the funnel chart shape is stable.
 */
function computeFunnels(): { onboarding: { step: string; count: number }[]; investor: { step: string; count: number }[] } {
  const countAction = (actions: string[]): number => {
    if (actions.length === 0) return 0;
    const placeholders = actions.map(() => "?").join(",");
    return Number(
      (dbGet(`SELECT COUNT(*) AS n FROM audit_log WHERE deleted_at IS NULL AND action IN (${placeholders})`, ...actions) as { n: number })?.n ?? 0,
    );
  };
  return {
    onboarding: [
      { step: "company_created", count: countAction(["company.created", "company.onboarded"]) },
      { step: "first_round_opened", count: countAction(["round.opened", "round.created"]) },
      { step: "first_close", count: countAction(["round.closed"]) },
    ],
    investor: [
      { step: "invited", count: countAction(["investor.invited", "invitation.sent", "round.invitation.sent"]) },
      { step: "soft_circled", count: countAction(["soft_circle.submitted"]) },
      { step: "funded", count: countAction(["cap_table.mutated", "captable.mutated", "funding.committed"]) },
    ],
  };
}

/** Top companies by recent audit activity (joined to real company names). */
function computeTopCompanies(limit = 5): { id: string; name: string; traction: number; raised: number | null }[] {
  const rows = dbAll(
    `SELECT c.id AS id, c.name AS name, COUNT(a.id) AS activity
       FROM companies c
       LEFT JOIN audit_log a
         ON a.deleted_at IS NULL
        AND (a.target = c.id OR a.target LIKE c.id || '%' OR a.target LIKE '%' || c.id || '%')
      WHERE c.deleted_at IS NULL
      GROUP BY c.id, c.name
      ORDER BY activity DESC, c.name ASC
      LIMIT ?`,
    limit,
  ) as Array<{ id: string; name: string; activity: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, traction: Number(r.activity ?? 0), raised: null }));
}

/** Top investors: real users with role=investor, ordered by audit activity. */
function computeTopInvestors(limit = 3): { id: string; name: string; activity: number; committed: number | null }[] {
  const rows = dbAll(
    `SELECT u.id AS id, COALESCE(u.name, u.email, u.id) AS name, COUNT(a.id) AS activity
       FROM users u
       LEFT JOIN audit_log a ON a.deleted_at IS NULL AND a.actor_id = u.id
      WHERE u.deleted_at IS NULL AND LOWER(u.role) LIKE '%investor%'
      GROUP BY u.id, name
      ORDER BY activity DESC, name ASC
      LIMIT ?`,
    limit,
  ) as Array<{ id: string; name: string; activity: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, activity: Number(r.activity ?? 0), committed: null }));
}

/** Live activity feed from audit_log (most recent first). */
function computeActivityFeed(limit = 20): { id: string; ts: string; actor: string; entity: string; kind: string; text: string }[] {
  const rows = dbAll(
    `SELECT id, created_at AS ts, actor_id AS actor, target AS entity, action AS kind, payload_json AS payload
       FROM audit_log
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    limit,
  ) as Array<{ id: string; ts: string; actor: string; entity: string; kind: string; payload: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    actor: r.actor ?? "u_system",
    entity: r.entity ?? "platform",
    kind: r.kind,
    text: `${r.kind} on ${r.entity ?? "platform"}`,
  }));
}

/**
 * Collective-side KPIs from the real Collective tables. Membership counts,
 * chapter counts, application pipeline are derived; metrics with no defensible
 * source return null.
 *
 * NB: the brief references tables `collective_applications` and
 * `chapter_members`; the deployed schema names are `collective_apps` and
 * `chapter_memberships` respectively (verified via PRAGMA on the live DB).
 */
function computeCollectiveKpisFromDb(): {
  totalMembers: number; activeMembers: number; chapters: number;
  pendingApplications: number; chapterMembers: number;
  momGrowthPct: number | null; churnPct: number | null; nrr: number | null;
} {
  // v25.42h round-2 (Blocker 2b) — fail-closed. A DB read failure on any of
  // these Collective tables must surface as a typed DbUnavailableError (→ 503),
  // not propagate as a raw error or fall back to a fabricated count.
  try {
  const totalMembers = Number((dbGet(`SELECT COUNT(*) AS n FROM collective_memberships WHERE deleted_at IS NULL`) as { n: number })?.n ?? 0);
  const activeMembers = Number((dbGet(`SELECT COUNT(*) AS n FROM collective_memberships WHERE deleted_at IS NULL AND status = 'active'`) as { n: number })?.n ?? 0);
  const chapters = Number((dbGet(`SELECT COUNT(*) AS n FROM chapters WHERE deleted_at IS NULL`) as { n: number })?.n ?? 0);
  const chapterMembers = Number((dbGet(`SELECT COUNT(*) AS n FROM chapter_memberships WHERE deleted_at IS NULL`) as { n: number })?.n ?? 0);
  const pendingApplications = Number((dbGet(`SELECT COUNT(*) AS n FROM collective_apps WHERE deleted_at IS NULL AND status IN ('submitted','pending','in_review')`) as { n: number })?.n ?? 0);
  const deactivated = Number((dbGet(`SELECT COUNT(*) AS n FROM collective_memberships WHERE deleted_at IS NULL AND status != 'active'`) as { n: number })?.n ?? 0);
  const everMembers = totalMembers;
  const churnPct = everMembers > 0 ? Number(((deactivated / everMembers) * 100).toFixed(2)) : null;
  return {
    totalMembers, activeMembers, chapters, pendingApplications, chapterMembers,
    momGrowthPct: null, churnPct, nrr: null,
  };
  } catch (err) {
    log.warn("[adminPlatformStore.computeCollectiveKpisFromDb] DB read failed:", (err as Error).message);
    throw new DbUnavailableError("collective KPIs", err);
  }
}

/* ============================================================
 * Patch v12 Day 2 Wave 1 — hydrator + lifecycle policy persistence
 * ============================================================ */


export async function hydrateAdminPlatformStore(): Promise<void> {
  // 1) Audit log mirror — load most recent N rows ordered by created_at ASC
  //    so the in-memory array preserves insert order (priorHash links work).
  try {
    const db = getDb();
    // CROSS-TENANT (admin) — the admin dashboard needs the global audit feed;
    // tenant scoping is enforced when callers filter the array by tenantId.
    const rows = (await db
      .select({
        id: auditLogTable.id,
        tenantId: auditLogTable.tenantId,
        actorId: auditLogTable.actorId,
        action: auditLogTable.action,
        target: auditLogTable.target,
        payloadJson: auditLogTable.payloadJson,
        prevHash: auditLogTable.prevHash,
        hash: auditLogTable.hash,
        createdAt: auditLogTable.createdAt,
      })
      .from(auditLogTable)
      .where(isNull(auditLogTable.deletedAt))
      .orderBy(asc(auditLogTable.createdAt))) as any[];

    // Replace the in-memory mirror with the DB state (capped at the limit).
    auditLog.length = 0;
    const tail = rows.length > AUDIT_MIRROR_LIMIT ? rows.slice(-AUDIT_MIRROR_LIMIT) : rows;
    for (const r of tail) {
      let parsed: Record<string, unknown> = {};
      try { parsed = r.payloadJson ? JSON.parse(r.payloadJson) : {}; } catch { /* leave empty */ }
      auditLog.push({
        id: r.id,
        ts: r.createdAt,
        actor: r.actorId ?? "",
        entity: r.target ?? "",
        eventType: r.action,
        payload: parsed,
        priorHash: r.prevHash ?? "0".repeat(64),
        hash: r.hash,
        tenantId: r.tenantId,
      });
    }
  } catch (err) {
    log.warn("[adminPlatformStore.hydrate] audit_log load failed:", (err as Error).message);
  }

  // 2) Reconciliation runs — read all live rows into the in-memory array.
  try {
    const db = getDb();
    const rows = (await db
      .select()
      .from(reconRunsTable)
      .where(isNull(reconRunsTable.deletedAt))
      .orderBy(asc(reconRunsTable.ts))) as any[];
    if (rows.length > 0) {
      reconRuns.length = 0;
      for (const r of rows) {
        try {
          reconRuns.push({
            id: r.id,
            ts: r.ts,
            companyId: r.companyId,
            roundId: r.roundId,
            engineMain: JSON.parse(r.engineMainJson),
            engineRef: JSON.parse(r.engineRefJson),
            diff: JSON.parse(r.diffJson),
            actor: r.actor,
          });
        } catch {
          /* skip malformed row */
        }
      }
    }
  } catch (err) {
    log.warn("[adminPlatformStore.hydrate] recon_runs load failed:", (err as Error).message);
  }

  // 3) Founder tiers — replace seed if DB has rows.
  try {
    const db = getDb();
    const rows = (await db
      .select()
      .from(founderTiersTable)
      .where(isNull(founderTiersTable.deletedAt))) as any[];
    if (rows.length > 0) {
      founderTiers.length = 0;
      for (const r of rows) {
        try {
          const tier: FounderTier = {
            id: r.id,
            name: r.name,
            usdMonthly: r.usdMonthly,
            features: JSON.parse(r.featuresJson),
          };
          // v19 Wave A / Change 2 — read optional billing cycle annotations.
          if (r.billingCycle) tier.billingCycle = r.billingCycle as FounderTier["billingCycle"];
          if (typeof r.annualPriceCents === "number") tier.annualPriceCents = r.annualPriceCents;
          /* WAVE 35 · F1 (second path, Review A "SUSPICIONS" #1) — this hydrate
           * path also hardcodes a `/100` and a literal "$". Unlike the route at
           * :2276 this one IS genuinely USD-only, and that is verifiable from
           * the SCHEMA rather than asserted: `founder_tiers`
           * (shared/schema.ts:1300-1311) has NO currency column and its money
           * columns are literally named `usd_monthly` and `annual_price_cents`.
           * There is no currency to be wrong about. The divisor is nonetheless
           * routed through `fromMinor(..., "USD")` so the exponent is named, not
           * assumed, and so a future currency column has exactly one place to
           * change. Output is byte-identical to before. */
          if (tier.annualPriceCents != null) {
            tier.displayPrice = `$${fromMinor(tier.annualPriceCents, "USD").toLocaleString("en-US")} USD/year per company`;
          }
          founderTiers.push(tier);
        } catch { /* skip malformed row */ }
      }
    }
  } catch (err) {
    log.warn("[adminPlatformStore.hydrate] founder_tiers load failed:", (err as Error).message);
  }

  // 4) Lifecycle policies — platform_config[key="lifecycle_policies"].
  try {
    const db = getDb();
    const rows = (await db
      .select()
      .from(platformConfigTable)
      .where(eq(platformConfigTable.key, "lifecycle_policies"))) as any[];
    if (rows.length > 0 && rows[0].value) {
      try {
        const parsed = JSON.parse(rows[0].value) as Partial<LifecyclePolicies>;
        for (const k of Object.keys(_lifecyclePolicies) as Array<keyof LifecyclePolicies>) {
          const v = (parsed as any)[k];
          if (typeof v === "number" && v > 0) _lifecyclePolicies[k] = v;
        }
      } catch { /* malformed config row; keep defaults */ }
    }
  } catch (err) {
    log.warn("[adminPlatformStore.hydrate] platform_config load failed:", (err as Error).message);
  }
}

/* ------------ Reconciliation ------------ */
interface ReconRun { id: string; ts: string; companyId: string; roundId: string; engineMain: { totalShares: string; ownership: number }; engineRef: { totalShares: string; ownership: number }; diff: { sharesDelta: string; ownershipDelta: number; ok: boolean }; actor: string; }
// v25.48 DATA-2 (V-11) — reconRuns is the DB read-mirror for the recon_runs table
// (hydrated in hydrateAdminPlatformStore). It MUST start empty: previously it was
// seeded with 3 hardcoded demo rows (co_novapay/co_quanta/co_helia) and hydration
// only replaced them `if (rows.length > 0)`, so a fresh LIVE deployment with an
// empty recon_runs table served those 3 fake reconciliation runs to every admin.
// The demo rows are now gated behind DEMO_SEED_ENABLED (never true in production).
const reconRuns: ReconRun[] = [];
if (DEMO_SEED_ENABLED) {
  reconRuns.push(
    { id: "rec_1", ts: new Date(Date.now()-3600_000).toISOString(), companyId: "co_novapay", roundId: "rnd_novapay_seed", engineMain: { totalShares: "12500000", ownership: 1.0 }, engineRef: { totalShares: "12500000", ownership: 1.0 }, diff: { sharesDelta: "0", ownershipDelta: 0, ok: true }, actor: "system_nightly" },
    { id: "rec_2", ts: new Date(Date.now()-7200_000).toISOString(), companyId: "co_quanta", roundId: "rnd_q_a", engineMain: { totalShares: "8200000", ownership: 1.0 }, engineRef: { totalShares: "8200000", ownership: 1.0 }, diff: { sharesDelta: "0", ownershipDelta: 0, ok: true }, actor: "system_nightly" },
    { id: "rec_3", ts: new Date(Date.now()-86400_000).toISOString(), companyId: "co_helia", roundId: "rnd_helia_a", engineMain: { totalShares: "4500000", ownership: 1.0 }, engineRef: { totalShares: "4500900", ownership: 1.0002 }, diff: { sharesDelta: "900", ownershipDelta: 0.0002, ok: false }, actor: "system_nightly" },
  );
}

/* ------------ Pricing tiers (Collective + Founder) ------------
 *
 * v19 Wave A / Change 2 — single-plan default.
 * --------------------------------------------
 * Per founder directive (Ozan, 24-May-2026): exactly ONE active tier
 * by default — Capavate Annual at $840 USD/year per company. Old
 * Free / Pro / Scale tiers are removed from the seed but the schema
 * column structure stays intact so admins can re-add tiers via the
 * existing admin pricing UI (POST/PATCH on /api/admin/pricing-models).
 *
 * The shape now carries optional billingCycle + annualPriceCents +
 * displayPrice annotations — used by the founder UI to render the
 * \$840 figure precisely without doing client-side multiplication.
 */
interface FounderTier {
  id: string;
  name: string;
  usdMonthly: number;
  features: { key: string; label: string; included: boolean }[];
  billingCycle?: "annual" | "monthly" | "one_time";
  annualPriceCents?: number;
  displayPrice?: string;
}
/* v25.27 — founderTiers no longer carries pricing data. The hardcoded $840
 * Capavate Annual tier (and all other hardcoded tiers) has been removed per
 * the standing rule: "Pricing plans are determined from the Admin area. They
 * are never hardcoded."
 *
 * The /api/admin/pricing/founder-tiers route now resolves dynamically from
 * pricingModelStore (durable, admin-editable). This array remains only as an
 * empty placeholder for backwards compatibility with the `_testAdmin` export
 * and historical tests. Live behavior reads from pricingModelStore. */
const founderTiers: FounderTier[] = [];

/* D2.5 SLICE 1 — DELETED: three hard-coded pricing/metric arrays.
 *
 *   • `collectiveTiers`   (H-5)  — $1,200 / $2,400 / $600 fabricated annual
 *                                  Collective prices. Real Collective tiers
 *                                  live in `collective_subscription_configs`
 *                                  (canonical) with legacy `platform_fees`
 *                                  rows; both are surfaced on /admin/fees →
 *                                  "Collective Tiers" with source labels.
 *   • `regionalPricing`   (H-13) — duplicated the REAL mechanism,
 *                                  `region_extensions.pricing_multiplier`,
 *                                  editable at /admin/regions/:id.
 *   • `billingMetrics`    (H-15) — FABRICATED revenue (mrrUsd 84_200, and an
 *                                  arithmetically inconsistent arrUsd =
 *                                  mrr × 12). Live MRR/ARR is computed from
 *                                  `subscriptionsStore` + `paymentStore`.
 *
 * All three violated this file's own standing rule (see the comment above
 * `founderTiers`) and had ZERO client consumers — verified by grepping
 * `client/src/` for their three endpoint paths. Their route handlers are
 * deleted below and they are removed from the `_testAdmin` export.
 */

/* ------------ Telemetry power (event browser + funnel + cohort) ------------ */
function telemetryEvents() {
  type TelRow = { id: string; ts: string; eventType: string; actor: string; entity: string; payload: Record<string, unknown> };
  /* W-AVI64 FIX 5 — the Event Explorer (and funnel/cohort/CSV, all of which
   * call this helper) previously read a SYNTHETIC 60-row seed keyed off
   * ALL_OUTBOUND_EVENT_TYPES. That store is disjoint from the DB-backed
   * `telemetry_events` table that the LIVE activity feed reads via
   * getRecentEvents(). So real soft_circle_submitted / captable_commit events
   * shown in the dashboard feed never appeared in the Explorer (0-of-0). Read
   * the SAME durable store the live feed uses and map it to this helper's row
   * shape. Fall back to the synthetic seed ONLY when the real store is empty
   * (sandbox / fresh boot) so existing behavior with no events is preserved and
   * nothing double-counts. */
  try {
    const real = getRecentEvents(5_000);
    if (Array.isArray(real) && real.length > 0) {
      return real.map((e): TelRow => {
        const payload = (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>;
        const entity =
          (typeof payload.companyId === "string" && payload.companyId) ||
          e.aggregateId ||
          "";
        return {
          id: e.eventId,
          ts: e.occurredAt,
          eventType: e.eventType,
          actor: e.actor?.userId ?? "u_unknown",
          entity: String(entity),
          payload,
        };
      });
    }
  } catch { /* fall through to synthetic seed below */ }

  // Synthesize from existing seed; reuse event types from the bridge.
  const types = ALL_OUTBOUND_EVENT_TYPES;
  const out: TelRow[] = [];
  for (let i = 0; i < 60; i++) {
    out.push({
      id: `tel_${i}`,
      ts: new Date(Date.now() - i * 30 * 60_000).toISOString(),
      eventType: types[i % types.length],
      actor: ["u_maya","u_aisha_patel","u_admin"][i % 3],
      entity: ["co_novapay","co_quanta","co_helia"][i % 3],
      payload: { i, region: ["US","UK","EU","IN","JP","HK","CN","CA","AU"][i % 9] },
    });
  }
  return out;
}

/* ============================================================
 * Sprint 29 KL-02 — Lifecycle Policies (promoted to module-level durable store)
 * In sandbox: in-memory only (survives requests, resets on restart).
 * In production: backed by platform_config Postgres table via hydrateFromDatabase.
 * ============================================================ */
interface LifecyclePolicies {
  founderDashboardTenureDays: number;
  archivalRetentionDays: number;
  governanceMetricsCadenceDays: number;
  softCircleExpiryDays: number;
  invitationExpiryDays: number;
}

const _lifecyclePolicies: LifecyclePolicies = {
  founderDashboardTenureDays: 180,
  archivalRetentionDays: 3650,
  governanceMetricsCadenceDays: 30,
  softCircleExpiryDays: 14,
  invitationExpiryDays: 21,
};

export function getLifecyclePolicies(): LifecyclePolicies {
  return { ..._lifecyclePolicies };
}

export function setLifecyclePolicies(patch: Partial<LifecyclePolicies>): LifecyclePolicies {
  const allowed = Object.keys(_lifecyclePolicies) as Array<keyof LifecyclePolicies>;
  for (const key of allowed) {
    if (patch[key] !== undefined && (patch[key] as number) > 0) {
      _lifecyclePolicies[key] = patch[key] as number;
    }
  }
  // Patch v12 Day 2 Wave 1 — write-through to platform_config (audit §3.8).
  // Stores the full policy bag JSON-encoded under key='lifecycle_policies' with
  // a versioned hash chain (DB-6) just like every other v12 mutator. The chain
  // here is per-key (only one row per key, so really just a version counter).
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const value = JSON.stringify(_lifecyclePolicies);
    db.transaction((tx: any) => {
      const tipRow = tx
        .select({ hash: platformConfigTable.hash, version: platformConfigTable.version })
        .from(platformConfigTable)
        .where(eq(platformConfigTable.key, "lifecycle_policies"))
        .limit(1)
        .all() as Array<{ hash: string; version: number }>;
      const prevHash = tipRow[0]?.hash ?? "0".repeat(64);
      const nextVersion = (tipRow[0]?.version ?? 0) + 1;
      const hash = sha256(`${prevHash}|lifecycle_policies|${nextVersion}|${now}|${value}`);
      tx.insert(platformConfigTable)
        .values({
          key: "lifecycle_policies",
          value,
          version: nextVersion,
          prevHash,
          hash,
          updatedAt: now,
          updatedBy: "admin",
        })
        .onConflictDoUpdate({
          target: platformConfigTable.key,
          set: { value, version: nextVersion, prevHash, hash, updatedAt: now, updatedBy: "admin" },
        })
        .run();
    });
  } catch (err) {
    log.error("[adminPlatformStore.setLifecyclePolicies] DB write failed:", (err as Error).message);
  }
  return { ..._lifecyclePolicies };
}

/** KL-04 hook for lifecycle policies */
export async function hydrateLifecyclePolicies(_db?: unknown): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  log.info(`[hydrate] would load lifecycle_policies from DATABASE_URL=${dbUrl.slice(0, 20)}... if Drizzle pg driver were active`);
}

export function registerAdminPlatformRoutes(app: Express): void {
  /* ====== Dashboard ====== */
  app.get("/api/admin/dashboard/kpis", (req: Request, res: Response) => {
    // Sprint 28 Wave 2 — ?surface=collective swaps the KPI source to the
    // Collective-side counters so the same dashboard UI can render either view.
    // v25.42h — fail-closed: KPI computation now reads the DB; on a hard DB
    // error return 503 + ok:false (never an empty/default literal payload).
    const surface = String(req.query.surface ?? "capavate").toLowerCase();
    try {
      if (surface === "collective") {
        return res.json(computeCollectiveKpis());
      }
      return res.json(computeKpis());
    } catch (err) {
      // v25.42h round-2 (Blocker 2) — store helpers throw DbUnavailableError on a
      // DB read failure; map it to 503 + ok:false with the resource name.
      if (err instanceof DbUnavailableError) {
        log.error({ route: "admin.dashboard.kpis", errorType: "KPI_DB_ERROR", resource: err.resource, message: err.message });
        return res.status(503).json({ ok: false, error: "db_unavailable", message: `${err.resource} temporarily unavailable` });
      }
      log.error({ route: "admin.dashboard.kpis", errorType: "KPI_DB_ERROR", message: (err as Error).message });
      return res.status(503).json({ ok: false, error: "db_unavailable", message: "Dashboard metrics temporarily unavailable" });
    }
  });
  /* v25.47 APD-029 (BLOCKER-6) — audit-chain continuity health. Drives the
   * admin P0 banner. Router-level requireAdmin (routes.ts) gates this. */
  app.get("/api/admin/audit-chain-health", (_req: Request, res: Response) => {
    try {
      return res.json({ ok: true, ...getAuditChainHealth() });
    } catch (err) {
      log.error({ route: "admin.audit-chain-health", message: (err as Error).message });
      return res.status(503).json({ ok: false, error: "db_unavailable" });
    }
  });

  /* W-V44 (banner) — admin RESOLVE control for an audit-chain-health incident.
   * DB-driven + honest: it RE-VERIFIES the tenant's hash chain live and clears
   * the incident ONLY when the chain is genuinely clean. A real break is never
   * hidden (returns 409 with the broken link index). Clearing the last incident
   * makes the P0 banner disappear because getAuditChainHealth().incident flips
   * to false. Router-level requireAdmin (routes.ts) gates this. */
  app.post("/api/admin/audit-chain-health/resolve", (req: Request, res: Response) => {
    const key = String((req.body ?? {}).key ?? "").trim();
    const note = String((req.body ?? {}).note ?? "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "key_required" });
    // W-V44 (H2 fix) — the audit_chain_health.key IS the audit-log tenant id
    // verbatim (the platform's tenant ids themselves use the `tenant_...` form,
    // e.g. `tenant_admin_capavate`, `tenant_platform`). DO NOT strip a `tenant_`
    // prefix — doing so would verify a DIFFERENT (often empty) tenant chain,
    // which could return broken=-1 and falsely clear a genuinely broken chain.
    // Verify the EXACT key so a real break always takes the 409 path.
    const tenantId = key;
    try {
      const db = rawDb();
      // Wave A-1 v2 (ADR-3 action 2): call the single shared verifier. It
      // applies chain_genesis re-base, uses AUDIT_CHAIN_SELECT_SQL, and
      // ignores deleted_at (append-only chain math).
      const vr = verifyTenantAuditChain(db, tenantId);
      const verified = vr.ok;
      const result = resolveAuditChainHealth(key, verified, note);
      if (!result.cleared) {
        // Chain still broken — refuse to clear, surface where.
        return res.status(409).json({
          ok: false,
          error: "chain_not_clean",
          message: `Cannot resolve: the audit chain for ${tenantId} did not verify clean (broken at link ${vr.brokenAt} of ${vr.totalLinks}). Investigate before resolving.`,
          brokenAt: vr.brokenAt,
          totalLinks: vr.totalLinks,
          genesisApplied: vr.genesisApplied,
          rows: result.rows,
          incident: result.incident,
        });
      }
      try {
        const actorId = (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "system:admin";
        appendAdminAudit(
          actorId,
          `audit_chain_health:${key}`,
          "audit_chain_health.resolved",
          { key, tenantId, totalLinks: vr.totalLinks, genesisApplied: vr.genesisApplied, note },
        );
      } catch { /* non-fatal */ }
      return res.json({ ok: true, cleared: true, totalLinks: vr.totalLinks, genesisApplied: vr.genesisApplied, rows: result.rows, incident: result.incident });
    } catch (err) {
      log.error("[admin.audit-chain-health/resolve] failed:", (err as Error).message);
      return res.status(503).json({ ok: false, error: "db_unavailable" });
    }
  });

  app.get("/api/admin/dashboard/activity", (req: Request, res: Response) => {
    const surface = String(req.query.surface ?? "capavate").toLowerCase();
    // v25.42h — fail-closed + DB-driven. The activity feed is now sourced from
    // the durable audit_log table (computeActivityFeed) for BOTH surfaces,
    // merged with the live telemetry firehose for the allowlisted kinds. On a
    // hard DB error return 503 + ok:false rather than a hardcoded literal feed.
    try {
      if (surface === "collective") {
        // Collective activity is the same audit_log feed, scoped to
        // collective/application/membership/syndicate event kinds.
        const all = computeActivityFeed(50);
        const items = all
          .filter((a) => /collective|application|membership|syndicate|chapter|kyc/i.test(a.kind))
          .slice(0, 30);
        return res.json({ items });
      }
      // Patch v10 — merge live telemetry events for the allowlisted kinds with
      // the DB-backed audit_log feed so promoted-to-collective, cap-table-mutated
      // and application-submitted events appear in the admin dashboard feed.
      const live = getRecentEvents(50)
        .filter((e) => LIVE_ACTIVITY_ALLOWLIST.has(e.eventType))
        .map((e, i) => ({
          id: `live_${e.eventId ?? i}`,
          ts: e.occurredAt,
          actor: e.actor?.userId ?? "u_system",
          entity: e.aggregateId,
          kind: e.eventType,
          text: `${e.eventType} on ${e.aggregateKind}:${e.aggregateId}`,
        }));
      const feed = computeActivityFeed(30);
      const merged = [...live, ...feed]
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))
        .slice(0, 30);
      return res.json({ items: merged });
    } catch (err) {
      if (err instanceof DbUnavailableError) {
        log.error({ route: "admin.dashboard.activity", errorType: "ACTIVITY_DB_ERROR", resource: err.resource, message: err.message });
        return res.status(503).json({ ok: false, error: "db_unavailable", message: `${err.resource} temporarily unavailable` });
      }
      log.error({ route: "admin.dashboard.activity", errorType: "ACTIVITY_DB_ERROR", message: (err as Error).message });
      return res.status(503).json({ ok: false, error: "db_unavailable", message: "Activity feed temporarily unavailable" });
    }
  });

  /* ====== Companies detail ====== */
  app.get("/api/admin/companies/:id/stats", (req: Request, res: Response) => {
    // v25.42h — DB-driven company stats + cap-table from real tables. Was a
    // mix of mockData fixtures and hardcoded literals (holders:12,
    // totalShares:12500000, softCircleConversionPct:64.4, maSignals…). Fields
    // with no canonical source return null so the UI shows "N/A" rather than
    // fabricated numbers. Fail-closed: 503 + ok:false on a hard DB error.
    const id = req.params.id;
    try {
      const coRow = dbGet(`SELECT id, name FROM companies WHERE id = ? AND deleted_at IS NULL`, id) as { id: string; name: string } | undefined;
      // Cap-table holders + total shares from the real securities table.
      const capRow = dbGet(
        `SELECT COUNT(*) AS holders, COALESCE(SUM(CAST(shares AS INTEGER)), 0) AS totalShares
           FROM securities WHERE company_id = ? AND deleted_at IS NULL`,
        id,
      ) as { holders: number; totalShares: number } | undefined;
      const holders = Number(capRow?.holders ?? 0);
      const totalShares = String(capRow?.totalShares ?? 0);
      // Distinct investors holding securities in this company.
      const investorRow = dbGet(
        `SELECT COUNT(DISTINCT holder_name) AS n FROM securities WHERE company_id = ? AND deleted_at IS NULL`,
        id,
      ) as { n: number } | undefined;
      const investorCount = Number(investorRow?.n ?? 0);
      // Dataroom top docs from the real dataroom_files table.
      let topDocs: { id: string; name: string; viewers: number | null }[] = [];
      try {
        topDocs = (dbAll(
          `SELECT id, name FROM dataroom_files WHERE company_id = ? AND deleted_at IS NULL ORDER BY uploaded_at DESC LIMIT 5`,
          id,
        ) as Array<{ id: string; name: string }>).map((f) => ({ id: f.id, name: f.name, viewers: null }));
      } catch (err) {
        // v25.42h round-2 (Blocker 2c) — fail-closed: rethrow rather than returning
        // an empty topDocs list as if the company genuinely had no dataroom files.
        // Caught by the outer handler → 503 + ok:false.
        log.warn("[adminPlatformStore.companies.stats.topDocs] DB read failed:", (err as Error).message);
        throw new DbUnavailableError("company dataroom files", err);
      }
      return res.json({
        id, name: coRow?.name ?? id,
        capTable: { holders, totalShares },
        totalRaised: null,            // no canonical per-company raised aggregate this wave
        investorCount,
        softCircleConversionPct: null,
        dataroom: { topDocs },
        reportReadRatePct: null,
        maSignals: null,              // M&A signal engine has no canonical store yet
        reports: null,
      });
    } catch (err) {
      if (err instanceof DbUnavailableError) {
        log.error({ route: "admin.companies.stats", errorType: "COMPANY_STATS_DB_ERROR", resource: err.resource, message: err.message, companyId: id });
        return res.status(503).json({ ok: false, error: "db_unavailable", message: `${err.resource} temporarily unavailable` });
      }
      log.error({ route: "admin.companies.stats", errorType: "COMPANY_STATS_DB_ERROR", message: (err as Error).message, companyId: id });
      return res.status(503).json({ ok: false, error: "db_unavailable", message: "Company stats temporarily unavailable" });
    }
  });
  app.get("/api/admin/companies/:id/export.csv", (req: Request, res: Response) => {
    const id = req.params.id;
    const co = companies.find(c => c.id === id);
    const csv = [
      "company_id,name,total_raised_usd,investors,reports",
      `${id},${co?.name ?? id},6500000,6,4`,
    ].join("\n");
    res.setHeader("content-type", "text/csv");
    res.setHeader("content-disposition", `attachment; filename="${id}-export.csv"`);
    res.send(csv);
  });
  app.get("/api/admin/companies/bulk-export.csv", (_req: Request, res: Response) => {
    const csv = [
      "company_id,name,total_raised_usd,investors,reports",
      ...companies.map(c => `${c.id},${c.name},${1_500_000 + Math.floor(Math.random()*5_000_000)},6,4`),
    ].join("\n");
    res.setHeader("content-type", "text/csv");
    res.setHeader("content-disposition", `attachment; filename="capavate-companies.csv"`);
    res.send(csv);
  });

  /* ====== Investors ====== */
  // v23.9 A3/W-9 — real investor directory (no mock data). Aggregate every
  // investor the platform actually knows about: round invitees (email/name +
  // accept state) and active Collective members. Dedupe by email (falling back
  // to userId). The shape matches the prior API contract the admin UI consumes.
  app.get("/api/admin/investors", (_req: Request, res: Response) => {
    const byKey = new Map<string, {
      id: string; name: string; tier: string; region: string | null;
      checkSize: number; score: number; committed: number; funded: number;
      irrPct: number; vip: boolean; status: string; email: string | null;
    }>();

    for (const inv of listAllInvitations()) {
      const email = (inv.investorEmail ?? "").toLowerCase();
      const key = email || inv.redeemedByUserId || inv.id;
      if (!key) continue;
      const redeemed = inv.state === "accepted" || inv.redeemedAt != null;
      const existing = byKey.get(key);
      const status = redeemed ? "active" : "invited";
      if (!existing) {
        byKey.set(key, {
          id: inv.redeemedByUserId ?? `inv_${inv.id}`,
          name: inv.investorName || inv.investorEmail || "Investor",
          tier: "Standard",
          region: null,
          checkSize: 0,
          score: 0,
          committed: 0,
          funded: 0,
          irrPct: 0,
          vip: false,
          status,
          email: inv.investorEmail ?? null,
        });
      } else if (redeemed && existing.status !== "active") {
        existing.status = "active";
        if (inv.redeemedByUserId) existing.id = inv.redeemedByUserId;
      }
    }

    for (const m of listActiveCollectiveMembers()) {
      const key = m.userId;
      const existing = byKey.get(key) ?? Array.from(byKey.values()).find((v) => v.id === m.userId);
      if (existing) {
        existing.status = "active";
        existing.tier = m.tier === "plus" ? "Plus" : "Standard";
        existing.vip = m.tier === "plus";
      } else {
        byKey.set(key, {
          id: m.userId,
          name: m.userId,
          tier: m.tier === "plus" ? "Plus" : "Standard",
          region: null,
          checkSize: 0,
          score: 0,
          committed: 0,
          funded: 0,
          irrPct: 0,
          vip: m.tier === "plus",
          status: "active",
          email: null,
        });
      }
    }

    res.json({ items: Array.from(byKey.values()) });
  });
  app.get("/api/admin/investors/:id", (req: Request, res: Response) => {
    // v25.42h — DB-driven investor lookup. Was a 100% hardcoded fixture (Aisha
    // Patel + fake holdings/IRR/LTV). Profile now comes from the real `users`
    // table; holdings from the real `securities` table (matched by holder).
    // Investor portfolio analytics (IRR/LTV/churn/behaviour) have no canonical
    // source table in this wave and return null — the UI shows "N/A" rather
    // than fabricated numbers. Fail-closed: 503 + ok:false on a hard DB error;
    // 404 when the id is unknown.
    const id = req.params.id;
    try {
      // W2 Avi#2 (verifier round-1 fix) — resolve FIRST. A synthetic
      // `derived_inv_<invitationId>` admin id has no row in `users`, so the old
      // code 404'd BEFORE reconciliation ever ran — defeating the fix for the
      // exact case Avi hit (admin viewing a derived_inv_ contact). We now run
      // reconciliation first (it resolves derived_inv_ → real redeemer userId
      // via redeemed_by_user_id and reads the real profile/KYC), then look up
      // the RESOLVED user. 404 only when neither the raw nor resolved id maps to
      // a user AND no investor profile exists.
      const reconciled = reconcileInvestorProfileForAdmin(String(id));
      let u = dbGet(
        `SELECT id, COALESCE(name, email, id) AS name, email, role FROM users WHERE id = ? AND deleted_at IS NULL`,
        id,
      ) as { id: string; name: string; email: string | null; role: string } | undefined;
      if (!u && reconciled.resolvedUserId && reconciled.resolvedUserId !== id) {
        u = dbGet(
          `SELECT id, COALESCE(name, email, id) AS name, email, role FROM users WHERE id = ? AND deleted_at IS NULL`,
          reconciled.resolvedUserId,
        ) as { id: string; name: string; email: string | null; role: string } | undefined;
      }
      // Synthesize a minimal user shell when the id resolved to a real profile
      // but no users row exists (e.g. invitation redeemed but user record not
      // yet materialized) so the admin still sees the reconciled data.
      if (!u && reconciled.profile) {
        u = { id: reconciled.resolvedUserId, name: reconciled.resolvedUserId, email: null, role: "investor" };
      }
      if (!u) return res.status(404).json({ ok: false, error: "not_found" });
      // Holdings: securities rows whose holder matches this user's id/name/email.
      let holdings: { companyId: string; company: string; ownershipPct: number | null; valueUsd: number | null; instrument: string }[] = [];
      try {
        const candidates = [u.id, u.name, u.email].filter(Boolean) as string[];
        const ph = candidates.map(() => "?").join(",");
        holdings = (dbAll(
          `SELECT s.company_id AS companyId, COALESCE(c.name, s.company_id) AS company, s.instrument AS instrument
             FROM securities s
             LEFT JOIN companies c ON c.id = s.company_id AND c.deleted_at IS NULL
            WHERE s.deleted_at IS NULL AND s.holder_name IN (${ph})`,
          ...candidates,
        ) as Array<{ companyId: string; company: string; instrument: string }>).map((h) => ({
          companyId: h.companyId, company: h.company, ownershipPct: null, valueUsd: null, instrument: h.instrument,
        }));
      } catch (err) {
        // v25.42h round-2 (Blocker 2d) — fail-closed: rethrow rather than returning
        // an empty holdings list as if the investor genuinely held nothing.
        // Caught by the outer handler → 503 + ok:false.
        log.warn("[adminPlatformStore.investors.byId.holdings] DB read failed:", (err as Error).message);
        throw new DbUnavailableError("investor holdings", err);
      }
      // W2 Avi#2 — reconciled profile/KYC (resolved above, before the users
      // lookup) drives the response so the admin record reflects what the
      // investor actually saved instead of "empty / unverified".
      const rp = reconciled.profile ?? {};
      const reconciledName =
        [rp.firstName, rp.lastName].filter(Boolean).join(" ").trim() ||
        (typeof rp.name === "string" ? rp.name : "") || u.name;

      return res.json({
        id: u.id,
        resolvedUserId: reconciled.resolvedUserId,
        profile: {
          name: reconciledName,
          region: (rp.region ?? rp.jurisdiction ?? null) as string | null,
          tier: (rp.tier ?? null) as string | null,
          checkSizeUsd: (typeof rp.checkSizeUsd === "number" ? rp.checkSizeUsd : null),
          accreditation: reconciled.accreditationStatus,
          bio: (typeof rp.bio === "string" ? rp.bio : null),
          taxId: (typeof rp.taxId === "string" ? rp.taxId : null),
        },
        // W2 Avi#2 — surface the investor's KYC documents in the admin record
        // (previously invisible: uploads went to profileStore, admin never read it).
        kyc: {
          status: reconciled.accreditationStatus === null && reconciled.kycDocuments.length === 0
            ? "unknown" : (reconciled.kycDocuments.length > 0 ? "documents_on_file" : "none"),
          documents: reconciled.kycDocuments,
        },
        holdings,
        softCircleHistory: [],          // no per-investor soft-circle history source this wave
        committedUsd: null,
        fundedUsd: null,
        irrContributionPct: null,
        ltvUsd: null,
        churnRiskPct: null,
        behaviorSignals: { dataroomViews: null, messagesSent: null, reportsRead: null },
        score: null,
      });
    } catch (err) {
      if (err instanceof DbUnavailableError) {
        log.error({ route: "admin.investors.byId", errorType: "INVESTOR_LOOKUP_DB_ERROR", resource: err.resource, message: err.message, investorId: id });
        return res.status(503).json({ ok: false, error: "db_unavailable", message: `${err.resource} temporarily unavailable` });
      }
      log.error({ route: "admin.investors.byId", errorType: "INVESTOR_LOOKUP_DB_ERROR", message: (err as Error).message, investorId: id });
      return res.status(503).json({ ok: false, error: "db_unavailable", message: "Investor lookup temporarily unavailable" });
    }
  });
  app.post("/api/admin/investors/bulk", (req: Request, res: Response) => {
    const { action, ids } = req.body ?? {};
    const allowed = ["invite_to_round","send_broadcast","mark_vip","suspend"];
    if (!allowed.includes(action)) return res.status(400).json({ error: "invalid_action", allowed });
    res.json({ ok: true, action, count: Array.isArray(ids) ? ids.length : 0 });
  });

  /* ====== Users & Auth ====== */
  // Patch v9 (BUG-1): the canonical GET /api/admin/users and PATCH
  // /api/admin/users/:id live in lib/adminUsersRoutes.ts and are registered
  // later in server/routes.ts. The duplicate registrations here used to fire
  // first (Express picks the earlier registration), serving stale fixture data
  // with a different shape than the canonical store. They have been removed.
  // GET /api/admin/users/:id and POST /api/admin/users/:id/sessions/revoke are
  // kept here because adminUsersRoutes.ts does NOT register them — they would
  // otherwise 404 via the new JSON 404 middleware.
  /* v25.28 Phase C — admin user endpoints now DB-backed.
   *
   * BEFORE: these 3 routes read from the hardcoded module-level `users`
   * array in this file. The canonical /api/admin/users LIST endpoint
   * (adminUsersRoutes.ts) ALREADY merges auth_users with the hardcoded
   * seeds, so admins saw inconsistent state: the LIST showed the real DB
   * user, but /api/admin/users/:id 404'd because the hardcoded array
   * didn't include them.
   *
   * AFTER: these routes consult both the hardcoded array (for back-compat
   * with the demo seed users in adminUsersRoutes._seedUsers) AND the
   * durable `auth_users` table. If the requested id matches a real user
   * in the DB, we return their row. The sessions/revoke endpoint also
   * deletes durable auth_sessions rows for that user. */
  app.get("/api/admin/users/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    // v25.42h — the legacy hardcoded `users` short-circuit (fake login history,
    // sessions, geo) has been REMOVED. The durable `auth_users` table is now
    // the sole source. Audit history is read DB-direct from audit_log so it no
    // longer depends on the in-memory mirror. Fail-closed: 503 + ok:false on a
    // hard DB error; 404 when the id is unknown (never a fabricated user).
    try {
      const db = rawDb();
      const row = db.prepare(
        `SELECT id, email, role, status, last_login, created_at FROM auth_users WHERE id = ?`,
      ).get(id) as { id: string; email: string; role: string; status: string; last_login: string | null; created_at: string } | undefined;
      if (!row) return res.status(404).json({ ok: false, error: "not_found" });
      // Audit history DB-direct (actor_id = this user), not the in-memory mirror.
      let userAudit: Array<{ id: string; ts: string; actor: string; entity: string; eventType: string }> = [];
      try {
        userAudit = (db.prepare(
          `SELECT id, created_at AS ts, actor_id AS actor, target AS entity, action AS eventType
             FROM audit_log WHERE deleted_at IS NULL AND actor_id = ? ORDER BY created_at DESC LIMIT 100`,
        ).all(id)) as typeof userAudit;
      } catch { userAudit = []; }
      return res.json({
        id: row.id,
        email: row.email,
        name: row.email.split("@")[0] ?? row.email,
        role: row.role,
        status: row.status,
        lastLogin: row.last_login,
        createdAt: row.created_at,
        // sessions[] no longer hardcoded — use /api/admin/users/:id/sessions if needed
        sessions: [],
        audit: userAudit,
      });
    } catch (err) {
      log.error({ route: "admin.users.byId", errorType: "USER_LOOKUP_DB_ERROR", message: (err as Error).message, userId: id });
      return res.status(503).json({ ok: false, error: "db_unavailable" });
    }
  });
  app.post("/api/admin/users/:id/sessions/revoke", (req: Request, res: Response) => {
    const id = req.params.id;
    // v25.42h — the legacy hardcoded `users` sessions short-circuit has been
    // REMOVED. Revocation now operates solely on the durable auth_sessions table.
    let revoked = 0;
    // Durable: delete all auth_sessions rows for this user.
    try {
      const db = rawDb();
      const result = db.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).run(id);
      revoked += (result as { changes?: number }).changes ?? 0;
    } catch { /* table may not exist in early-boot test sandbox — non-fatal */ }
    // v25.40 FIX-7 (admin P1 #4): emit an audit_log row for the session revoke so
    // every mutating admin endpoint leaves a forensic trail. Actor is the
    // server-derived admin identity (never client-supplied).
    try {
      const actorId = (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "system:admin";
      appendAudit(actorId, `user:${id}`, "user.sessions.revoked", { id, revoked });
    } catch { /* non-fatal */ }
    res.json({ ok: true, revoked });
  });
  app.post("/api/admin/users/bulk", (req: Request, res: Response) => {
    const { action, ids } = req.body ?? {};
    const allowed = ["suspend", "unsuspend", "force_mfa", "force_logout", "reset_password"];
    if (!allowed.includes(action)) return res.status(400).json({ error: "invalid_action", allowed });
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({ ok: true, action, count: 0 });
    }
    /* v25.28 — actually persist the requested action on durable rows.
     * Each action maps to an auth_users column or auth_sessions delete. */
    let applied = 0;
    try {
      const db = rawDb();
      for (const id of ids) {
        if (action === "suspend") {
          const r = db.prepare(`UPDATE auth_users SET status = 'suspended' WHERE id = ?`).run(id);
          applied += (r as { changes?: number }).changes ?? 0;
        } else if (action === "unsuspend") {
          const r = db.prepare(`UPDATE auth_users SET status = 'active' WHERE id = ?`).run(id);
          applied += (r as { changes?: number }).changes ?? 0;
        } else if (action === "force_logout") {
          const r = db.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).run(id);
          applied += (r as { changes?: number }).changes ?? 0;
        }
        // force_mfa + reset_password are tracked by audit only — no schema column yet.
        appendAudit((req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "system:bulk", "platform", `user.${action}`, { id });
      }
    } catch { /* DB not ready in test sandbox — fall back to count-only ack */ }
    res.json({ ok: true, action, count: ids.length, applied });
  });

  /* ====== Audit log ======
   * v25.41 round-2 (per GPT-5.5): server-side filtering + pagination so the
   * admin UI can scale beyond the in-memory cap. Filters now reduce the row
   * set BEFORE pagination, and the response carries `total`, `limit`, `offset`
   * so the client can render a proper paginator. The legacy filter-by-`q`
   * behavior is preserved as a substring match over the JSON payload. */
  app.get("/api/admin/audit-log", (req: Request, res: Response) => {
    /* v25.41 round-3 (per GPT-5.5 re-verify):
     * TRUE DB-BACKED query. Filters + COUNT + LIMIT/OFFSET applied at the
     * SQLite layer against the durable `audit_log` table — NOT the in-memory
     * mirror. This satisfies Avi's unifying directive (every module's page
     * dynamic and DB-driven) and ensures admins see ALL historical rows, not
     * just the most recent AUDIT_MIRROR_LIMIT.
     *
     * Entity prefix wildcard: `entity=co_*` matches all rows where target
     * starts with `co_`. Exact-match is preserved when no trailing `*`. The
     * in-memory mirror remains as a hot-path fallback for cases where the DB
     * is unavailable (e.g., during tests using _testAdmin reset). */
    const entityRaw = String(req.query.entity ?? "");
    const actor = String(req.query.actor ?? "");
    const eventType = String(req.query.eventType ?? "");
    // Wave A-1 (ADR-3 action 5): tenantId is now a real filter. Previously
    // passing ?tenantId=... was silently ignored and returned unfiltered
    // results, which actively hindered investigating a per-tenant chain break.
    const tenantId = String(req.query.tenantId ?? "");
    const q = String(req.query.q ?? "").toLowerCase();
    const rawLimit = Number.parseInt(String(req.query.limit ?? ""), 10);
    const rawOffset = Number.parseInt(String(req.query.offset ?? ""), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : null;
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    try {
      const db = rawDb();
      const where: string[] = ["deleted_at IS NULL"];
      const binds: any[] = [];
      if (entityRaw) {
        if (entityRaw.endsWith("*")) {
          const prefix = entityRaw.slice(0, -1).replace(/[%_\\]/g, (c) => "\\" + c);
          where.push("target LIKE ? ESCAPE '\\'");
          binds.push(prefix + "%");
        } else {
          const escaped = entityRaw.replace(/[%_\\]/g, (c) => "\\" + c);
          where.push("(target = ? OR target LIKE ? ESCAPE '\\')");
          binds.push(entityRaw, escaped + "%");
        }
      }
      if (actor) { where.push("actor_id = ?"); binds.push(actor); }
      if (eventType) { where.push("action = ?"); binds.push(eventType); }
      // Wave A-1 (ADR-3 action 5): honor ?tenantId=... as a real filter.
      if (tenantId) { where.push("tenant_id = ?"); binds.push(tenantId); }
      if (q) { where.push("LOWER(payload_json) LIKE ?"); binds.push("%" + q + "%"); }
      const whereSql = "WHERE " + where.join(" AND ");

      const totalRow = db.prepare("SELECT COUNT(*) AS n FROM audit_log " + whereSql).get(...binds) as { n: number };
      const total = Number(totalRow?.n ?? 0);

      const limSql = limit !== null ? "LIMIT ? OFFSET ?" : "";
      const itemBinds = limit !== null ? [...binds, limit, offset] : binds;
      const rows = db.prepare(
        `SELECT id, created_at AS ts, actor_id AS actor, target AS entity, action AS "eventType", payload_json AS "payloadJson", prev_hash AS "priorHash", hash, tenant_id AS "tenantId" FROM audit_log ${whereSql} ORDER BY created_at ASC, id ASC ${limSql}`
      ).all(...itemBinds) as Array<{ id: string; ts: string; actor: string; entity: string; eventType: string; payloadJson: string | null; priorHash: string; hash: string; tenantId: string }>;

      const items = rows.map((r) => {
        let payload: Record<string, unknown> = {};
        if (r.payloadJson) {
          try { payload = JSON.parse(r.payloadJson) as Record<string, unknown>; } catch { payload = {}; }
        }
        return {
          id: r.id, ts: r.ts, actor: r.actor, entity: r.entity, eventType: r.eventType,
          payload, priorHash: r.priorHash, hash: r.hash, tenantId: r.tenantId,
        };
      });
      return res.json({ count: items.length, total, limit: limit ?? total, offset, items });
    } catch (err) {
      // DB unavailable → degrade to mirror so the page never blanks for admins.
      // Wave A-1 v2 (ADR-3 action 5, GPT-5 v1 finding #8b): honor tenantId in
      // the fallback path too. Without this, ?tenantId=... on DB-error silently
      // returned cross-tenant mirror rows.
      log.warn("[adminPlatformStore.audit-log] DB query failed; falling back to mirror:", (err as Error).message);
      const entity = entityRaw.endsWith("*") ? entityRaw.slice(0, -1) : entityRaw;
      const filtered = auditLog.filter(a =>
        (entity ? (a.entity === entity || a.entity.startsWith(entity)) : true) &&
        (actor ? a.actor === actor : true) &&
        (eventType ? a.eventType === eventType : true) &&
        (tenantId ? ((a as unknown as { tenantId?: string }).tenantId ?? "") === tenantId : true) &&
        (q ? JSON.stringify(a).toLowerCase().includes(q) : true)
      );
      const total = filtered.length;
      const items = limit !== null ? filtered.slice(offset, offset + limit) : filtered;
      return res.json({ count: items.length, total, limit: limit ?? total, offset, items, fallback: true });
    }
  });
  app.get("/api/admin/audit-log/verify", (req: Request, res: Response) => {
    /* v25.41 round-3 (per GPT-5.5 re-verify): per-CHAIN verification.
     * `appendAudit()` scopes the hash chain by `tenantId`. The verifier MUST
     * use the same scope to avoid false fails when mixed entities share a
     * tenant.
     *
     * Query params:
     *   ?tenantId=<id>   — verify a single tenant's chain (PREFERRED)
     *   ?entity=<exact>  — legacy alias; resolved to tenantId via resolveTenantId
     *   (no param)       — verify every tenant chain; returns per-tenant array
     */
    const tenantIdParam = String(req.query.tenantId ?? "");
    const entityParam = String(req.query.entity ?? "");
    const resolvedTenant = tenantIdParam || (entityParam ? resolveTenantId(entityParam) : "");

    try {
      const db = rawDb();
      // Wave A-1 v2 (ADR-3 action 2): the single shared verifier. Applies
      // chain_genesis re-base and honors AUDIT_CHAIN_SELECT_SQL (ignores
      // deleted_at, uses (created_at ASC, id ASC) ordering). Any drift here
      // forks the chain — do not inline an ad-hoc query.
      if (resolvedTenant) {
        const r = verifyTenantAuditChain(db, resolvedTenant);
        return res.json({ ok: r.ok, brokenAt: r.brokenAt, totalLinks: r.totalLinks, scope: `tenant:${resolvedTenant}`, genesisApplied: r.genesisApplied });
      }
      // Whole-platform: verify each tenant's chain independently.
      // Wave A-1 v2 (ADR-3 action 2): drop the `deleted_at IS NULL` filter to
      // match the writer/verifier policy (append-only chain math).
      const tenants = db.prepare(`SELECT DISTINCT tenant_id FROM audit_log`).all() as Array<{ tenant_id: string }>;
      const perTenant = tenants.map((t) => verifyTenantAuditChain(db, t.tenant_id));
      const overallOk = perTenant.every((p) => p.ok);
      const overallLinks = perTenant.reduce((s, p) => s + p.totalLinks, 0);
      return res.json({ ok: overallOk, brokenAt: -1, totalLinks: overallLinks, scope: "all-tenants", perTenant });
    } catch (err) {
      /* v25.41 round-3 (per GPT-5.5 R3 re-verify): FAIL CLOSED on verifier
       * unavailability. The previous draft returned `ok: true` which falsely
       * advertised a valid chain when the verifier could not actually read
       * the durable audit table — a SOC 2 CC7.2 violation. Now we surface a
       * 503 with `ok: false` so the UI can render an explicit "verification
       * unavailable" warning rather than a green badge. */
      log.warn("[adminPlatformStore.audit-log/verify] DB verify failed:", (err as Error).message);
      return res.status(503).json({ ok: false, brokenAt: 0, totalLinks: 0, scope: "unavailable", error: "db_unavailable" });
    }
  });
  app.get("/api/admin/audit-log/export.csv", (_req: Request, res: Response) => {
    // Wave A-1 v2 (ADR-3 action 5): CSV export.
    // - Header order per V7 A-f: id,ts,tenantId,actor,entity,eventType,priorHash,hash
    // - CSV-escape values containing comma / quote / newline / carriage-return
    // - Neutralize spreadsheet formula-injection: cells that lead with '=',
    //   '+', '-', '@', tab, or CR are prefixed with a single apostrophe.
    //   Excel/Sheets treat the leading apostrophe as a text-marker — the
    //   cell displays without the apostrophe. (GPT-5 v1 finding #7.)
    const FORMULA_LEAD = /^[=+\-@\t\r]/;
    const NEEDS_QUOTE = /[,\n\r"]/;
    const esc = (v: unknown) => {
      let s = v === null || v === undefined ? "" : String(v);
      if (FORMULA_LEAD.test(s)) s = "'" + s;
      if (NEEDS_QUOTE.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = "id,ts,tenantId,actor,entity,eventType,priorHash,hash";
    const rows = auditLog.map((a) => [
      esc(a.id),
      esc(a.ts),
      esc((a as unknown as { tenantId?: string }).tenantId ?? ""),
      esc(a.actor),
      esc(a.entity),
      esc(a.eventType),
      esc(a.priorHash),
      esc(a.hash),
    ].join(","));
    const csv = [header, ...rows].join("\n");
    res.setHeader("content-type", "text/csv");
    res.send(csv);
  });
  app.post("/api/admin/audit-log/append", (req: Request, res: Response) => {
    // v25.40 FIX-8 (admin P2 #1, security): NEVER trust a client-supplied actor.
    // The audit chain is the forensic source of truth; allowing the request body
    // to set `actor` lets a caller forge "who did this" attribution. We now
    // derive the actor SOLELY from the authenticated server-side context and
    // ignore any `actor` field in the body.
    const { entity, eventType, payload } = req.body ?? {};
    if (!entity || !eventType) return res.status(400).json({ error: "missing_fields" });
    const actor = (req as Request & { userContext?: { userId?: string } }).userContext?.userId ?? "system:admin";
    /* WAVE 22 · ITEM 1 (REVIEW B F-2) — same rule as `actor` above, applied to
     * the address. The client cannot observe its own public address, so
     * `CloseRoundPanel` now sends `ipAddress: null` with a documented reason
     * instead of the `203.0.113.x` value it used to invent. THE SERVER is the
     * only party that can state the address truthfully, so it stamps the peer
     * it actually observed — resolved through the one hardened trusted-hop
     * resolver (fail-closed to the socket peer; the raw `x-forwarded-for`
     * header is never trusted). Any client-supplied `ipAddress` key is
     * OVERWRITTEN, never merged: a caller must not be able to write an address
     * into the forensic chain. */
    const stampedPayload = {
      ...(payload && typeof payload === "object" ? payload as Record<string, unknown> : {}),
      serverObservedIp: resolveRateLimitClientIp(req),
      ipAddress: null,
    };
    res.json(appendAudit(actor, entity, eventType, stampedPayload));
  });

  /* ====== Reconciliation ====== */
  app.get("/api/admin/reconciliation/runs", (_req: Request, res: Response) => {
    res.json({ items: reconRuns });
  });
  app.post("/api/admin/reconciliation/run", (req: Request, res: Response) => {
    const { companyId, roundId } = req.body ?? {};
    // v14 — require explicit companyId/roundId from caller; no demo fallback.
    if (!companyId || !roundId) return res.status(400).json({ error: "companyId_and_roundId_required" });
    const actorCtx = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext;
    if (!actorCtx?.userId) return res.status(401).json({ error: "missing_identity" });
    const e: ReconRun = { id: `rec_${randomBytes(4).toString("hex")}`, ts: new Date().toISOString(), companyId: String(companyId), roundId: String(roundId), engineMain: { totalShares: "12500000", ownership: 1.0 }, engineRef: { totalShares: "12500000", ownership: 1.0 }, diff: { sharesDelta: "0", ownershipDelta: 0, ok: true }, actor: actorCtx.userId };
    // Patch v12 Day 2 Wave 1 — write-through to recon_runs table.
    try {
      const db = getDb();
      db.transaction((tx: any) => {
        tx.insert(reconRunsTable).values({
          id: e.id,
          tenantId: `tenant_co_${e.companyId}`,
          companyId: e.companyId,
          roundId: e.roundId,
          ts: e.ts,
          engineMainJson: JSON.stringify(e.engineMain),
          engineRefJson: JSON.stringify(e.engineRef),
          diffJson: JSON.stringify(e.diff),
          actor: e.actor,
          deletedAt: null,
        }).run();
      });
    } catch (err) {
      log.error("[adminPlatformStore.reconciliation/run] DB write failed:", (err as Error).message);
    }
    reconRuns.push(e);
    res.json(e);
  });
  app.post("/api/admin/reconciliation/force-commit", (req: Request, res: Response) => {
    const { companyId, roundId, signature } = req.body ?? {};
    if (!signature || String(signature).length < 8) {
      return res.status(403).json({ error: "ses_signature_required", message: "Force commit requires admin SES signature (min 8 chars)" });
    }
    // v14 — identity from session, no "u_admin"/"co_novapay" fallbacks.
    const actorCtx = (req as Request & { userContext?: { userId?: string } }).userContext;
    if (!actorCtx?.userId) return res.status(401).json({ error: "missing_identity" });
    if (!companyId) return res.status(400).json({ error: "companyId_required" });
    appendAudit(actorCtx.userId, String(companyId), "reconciliation.force_commit", { roundId, signature: String(signature).slice(0, 4) + "…" });
    res.json({ ok: true, signedBy: actorCtx.userId, at: new Date().toISOString() });
  });

  /* ====== Telemetry power ====== */
  app.get("/api/admin/telemetry/events", (req: Request, res: Response) => {
    const eventType = String(req.query.eventType ?? "");
    const actor = String(req.query.actor ?? "");
    const entity = String(req.query.entity ?? "");
    const items = telemetryEvents().filter(e =>
      (eventType ? e.eventType === eventType : true) &&
      (actor ? e.actor === actor : true) &&
      (entity ? e.entity === entity : true)
    );
    res.json({ count: items.length, items });
  });
  app.post("/api/admin/telemetry/funnel", (req: Request, res: Response) => {
    const steps: string[] = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const evts = telemetryEvents();
    const result = steps.map(s => ({ step: s, count: evts.filter(e => e.eventType === s).length }));
    res.json({ steps: result, totalEvents: evts.length });
  });
  app.post("/api/admin/telemetry/cohort", (req: Request, res: Response) => {
    const groupBy: string = String(req.body?.groupBy ?? "actor");
    const evts = telemetryEvents();
    const groups: Record<string, number> = {};
    for (const e of evts) {
      const k = String((e as any)[groupBy] ?? "unknown");
      groups[k] = (groups[k] ?? 0) + 1;
    }
    // Synthetic retention curve: returning fraction by week 1..4
    const retention = [1.0, 0.78, 0.62, 0.51];
    res.json({ groupBy, groups, retention });
  });
  app.get("/api/admin/telemetry/schema", (_req: Request, res: Response) => {
    res.json({
      schemaVersion: "1.0",
      envelopeFields: ["eventId","eventType","aggregateId","aggregateKind","occurredAt","tenantId","actor","payload","trace","auditChain","schemaVersion"],
      knownEventTypes: ALL_OUTBOUND_EVENT_TYPES,
      notificationKinds: ALL_NOTIFICATION_KINDS,
    });
  });
  app.get("/api/admin/telemetry/export.csv", (_req: Request, res: Response) => {
    const evts = telemetryEvents();
    const csv = ["id,ts,eventType,actor,entity", ...evts.map(e => [e.id,e.ts,e.eventType,e.actor,e.entity].join(","))].join("\n");
    res.setHeader("content-type","text/csv");
    res.send(csv);
  });

  /* ====== Lifecycle Policies (KL-02: now durable) ====== */
  app.get("/api/admin/lifecycle-policies", (_req: Request, res: Response) => {
    res.json({ ok: true, policies: getLifecyclePolicies() });
  });
  app.patch("/api/admin/lifecycle-policies", (req: Request, res: Response) => {
    // v14 — actor email from session, never x-actor-email header.
    const ctx = (req as Request & { userContext?: { userId?: string; identity?: { email?: string } } }).userContext;
    if (!ctx?.userId) return res.status(401).json({ error: "missing_identity" });
    const actor = ctx.identity?.email ?? ctx.userId;
    const allowed = ["founderDashboardTenureDays","archivalRetentionDays","governanceMetricsCadenceDays","softCircleExpiryDays","invitationExpiryDays"];
    const patch: Record<string, number> = {};
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) {
        const v = Number(req.body[key]);
        if (v > 0) patch[key] = v;
      }
    }
    const updated = setLifecyclePolicies(patch);
    appendAudit(actor, "platform", "lifecycle_policy.changed", patch);
    res.json({ ok: true, policies: updated, changed: patch });
  });

  /* ====== Pricing ======
   * v25.27 — founder-tiers now PROXIES to the admin-editable pricingModelStore
   * (durable, DB-backed). The legacy hardcoded `founderTiers` array is no
   * longer the source of truth; admins manage tiers via /admin/pricing-models.
   * Shape is preserved for backwards compatibility with existing clients. */
  app.get("/api/admin/pricing/founder-tiers", async (_req: Request, res: Response) => {
    try {
      const pm = await import("./pricingModelStore");
      const live = pm.listModels({ productLine: "founder", status: "live" });
      const tiers = live.map((m) => {
        const annualOpt = m.cadenceOptions?.find((c) => c.cadence === "annual");
        const monthlyOpt = m.cadenceOptions?.find((c) => c.cadence === "monthly");
        const annualMinor = annualOpt?.priceMinor ?? (m.cadence === "annual" ? m.basePriceMinor : (m.basePriceMinor || 0) * 12);
        const monthlyMinor = monthlyOpt?.priceMinor ?? (m.cadence === "monthly" ? m.basePriceMinor : Math.round(annualMinor / 12));
        /* WAVE 35 · F1 — `usdMonthly` was `Math.round(monthlyMinor / 100)` in
         * the SAME object literal as the currency-aware `displayPrice` that
         * Wave 34 fixed. Wave 34 classified this field "USD by contract"
         * (category 3); Review A falsified that by execution — the model
         * carries its own `m.currency`, and a ¥100,000/month tier was served
         * to founders as `usdMonthly: 1000`. The USD-named field is now null
         * for non-USD tiers (a refusal the client renders), and the truth is
         * carried alongside in `currency` + integer minor units. */
        const tierCurrency = String(m.currency || "USD").toUpperCase();
        const isUsd = tierCurrency === "USD";
        return {
          id: m.slug,
          name: m.name,
          usdMonthly: isUsd ? Math.round(fromMinor(monthlyMinor || 0, tierCurrency)) : null,
          currency: tierCurrency,
          monthlyMinor: monthlyMinor || 0,
          annualMinor: annualMinor || 0,
          billingCycle: m.cadence,
          annualPriceCents: annualMinor,
          /* WAVE 34 · TASK 2 — the SECOND PATH of the adminPricingStore.ts:64
           * defect: a byte-for-byte copy of the same string on a different
           * endpoint. Was:
           *   `$${Math.round(annualMinor / 100).toLocaleString()} ${m.currency || "USD"}/year per company`
           * Fixing only the first copy would have left this one live — which is
           * exactly how this class kept regenerating. USD output unchanged. */
          displayPrice: annualMinor > 0
            ? (() => {
                const tierCurrency = m.currency || "USD";
                const symbol = tierCurrency === "USD" ? "$" : "";
                return `${symbol}${fromMinor(annualMinor, tierCurrency).toLocaleString()} ${tierCurrency}/year per company`;
              })()
            : "Free",
          features: m.features.map((f) => ({ key: f.key, label: f.label, included: f.included })),
        };
      });
      res.json({ tiers });
    } catch (err) {
      res.status(500).json({ tiers: [], error: (err as Error).message });
    }
  });
  /* D2.5 SLICE 1 — DELETED, zero client consumers, hard-coded payloads:
   *   GET /api/admin/pricing/collective-tiers   (served H-5)
   *   GET /api/admin/pricing/regional          (served H-13)
   *   GET /api/admin/pricing/billing-metrics   (served H-15)
   * `GET /api/admin/pricing/founder-tiers` above is PRESERVED — it resolves
   * dynamically from pricingModelStore. */
}

export const _testAdmin = { computeKpis, users, auditLog, appendAudit, reconRuns, founderTiers };
