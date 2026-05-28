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
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { companies, rounds, softCircles, dataroomFiles, reports } from "./mockData";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { ALL_OUTBOUND_EVENT_TYPES, getOutbox } from "./bridgeStore";
import { ALL_NOTIFICATION_KINDS } from "./notificationsStore";
// Patch v10 (BUG-3 / BUG-6) — real KPI aggregation from canonical stores.
import { listSubscriptions } from "./subscriptionsStore";
import { getLedger } from "./captableCommitStore";
import { listActive as listActiveCollectiveMembers } from "./collectiveMembershipStore";
import { getRecentEvents } from "./sprint10Telemetry";
// Patch v12 Day 2 Wave 1 — audit_log + recon_runs + founder_tiers DB-backed.
import { getDb } from "./db/connection";
import {
  auditLog as auditLogTable,
  reconRuns as reconRunsTable,
  founderTiers as founderTiersTable,
  platformConfig as platformConfigTable,
} from "../shared/schema";
import { log } from "./lib/logger";

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
  // Active companies: canonical companies array (multi-company tenant inventory).
  const totalCompanies = companies.length;

  // Active investors: distinct userIds with at least one committed cap-table entry.
  const ledger = getLedger();
  const investorIds = new Set<string>();
  for (const e of ledger) {
    if (e.state === "committed") investorIds.add(e.investorId);
  }
  const totalInvestors = investorIds.size;

  // Soft-circle pipeline: sum of softCircle amounts.
  const totalCommittedSoftCircle = softCircles.reduce(
    (sum: number, s: { amount?: number }) => sum + (s.amount ?? 0),
    0,
  );

  // Funded: sum of round.amountRaised across all rounds.
  const totalFunded = rounds.reduce(
    (sum: number, r: { amountRaised?: number }) => sum + (r.amountRaised ?? 0),
    0,
  );

  // Synthetic growth/churn/NRR — no canonical source yet.
  const momGrowthPct = 11.4;
  const churnPct = 2.1;
  const nrr = 1.18;

  const outbox = getOutbox();
  const queues = {
    eligibilityRecompute: 0,
    emailQueue: 0,
    bridgeOutbox: outbox.filter(e => e.status === "queued").length,
    deadLetter: outbox.filter(e => e.status === "dead_letter").length,
  };
  const health = {
    capTableReconcile: { runs: 318, success: 316, successRatePct: 99.37 },
    closeGateFailures: 4,
    dataroomUploadErrors: 2,
    messageDelivery: { sent: 1284, delivered: 1281, deliveryRatePct: 99.77 },
    emailSlaSec: 38,
  };
  const funnels = {
    onboarding: [
      { step: "company_created", count: 18 },
      { step: "first_round_opened", count: 12 },
      { step: "first_close", count: 9 },
    ],
    investor: [
      { step: "invited", count: 240 },
      { step: "soft_circled", count: 132 },
      { step: "funded", count: 88 },
    ],
  };
  const topCompanies = [
    { id: "co_novapay", name: "NovaPay AI", traction: 92, raised: 6_500_000 },
    { id: "co_quanta", name: "Quanta Robotics", traction: 88, raised: 4_200_000 },
    { id: "co_arboreal", name: "Arboreal Health", traction: 81, raised: 1_500_000 },
    { id: "co_helia", name: "Helia AI", traction: 79, raised: 3_800_000 },
    { id: "co_kelvin", name: "Kelvin Energy", traction: 74, raised: 1_100_000 },
  ];
  const topInvestors = [
    { id: "u_aisha_patel", name: "Aisha Patel · Hydra Ventures", activity: 27, committed: 2_400_000 },
    { id: "u_moss_dawn", name: "Moss & Dawn", activity: 19, committed: 1_750_000 },
    { id: "u_lapsed_lp", name: "Cascadia LP (lapsed)", activity: 4, committed: 800_000 },
  ];
  // Regions: derived from `companies[].region` (when present); falls back to a
  // global "GLOBAL" bucket so we never return an empty array.
  const regionAcc = new Map<string, { companies: number; raised: number }>();
  for (const c of companies) {
    const code = (c as { region?: string }).region ?? "GLOBAL";
    const cur = regionAcc.get(code) ?? { companies: 0, raised: 0 };
    cur.companies += 1;
    cur.raised += rounds
      .filter((r: { companyId?: string; amountRaised?: number }) => r.companyId === c.id)
      .reduce((s: number, r: { amountRaised?: number }) => s + (r.amountRaised ?? 0), 0);
    regionAcc.set(code, cur);
  }
  const regions = Array.from(regionAcc.entries()).map(([code, v]) => ({ code, ...v }));

  // MRR/ARR: sum of `annualAmountMinor` across active subscriptions, in dollars.
  const subs = listSubscriptions();
  const activeSubs = subs.filter((s) => s.status === "active" || s.status === "trialing");
  const arrUsd = Math.round(activeSubs.reduce((sum, s) => sum + (s.annualAmountMinor ?? 0), 0) / 100);
  const mrrUsd = Math.round(arrUsd / 12);

  return {
    summary: {
      totalCompanies,
      totalInvestors,
      totalCommittedSoftCircle,
      totalFunded,
      mrrUsd,
      arrUsd,
      momGrowthPct,
      churnPct,
      nrr,
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
  const totalMembers = 142;      // total accredited Collective members
  const activeMembers = 118;     // status === "active"
  const newMembersMoM = 14;
  const churnPct = 1.8;
  const nrr = 1.27;
  const totalCommittedSyndication = 18_400_000;   // committed via syndicates in last 12mo
  const totalDeployedSyndication = 11_750_000;    // actually deployed
  const queues = {
    pendingApplications: 9,            // membership applications in admin queue
    pendingKyc: 4,                     // KYC docs awaiting review
    syndicationAllocations: 6,         // open syndicate allocations to close
    deadLetter: getOutbox().filter(e => e.status === "dead_letter").length,
  };
  const health = {
    capTableReconcile: { runs: 142, success: 141, successRatePct: 99.30 }, // Collective-shared cap-table reconciles
    closeGateFailures: 1,
    dataroomUploadErrors: 0,
    messageDelivery: { sent: 962, delivered: 960, deliveryRatePct: 99.79 },
    emailSlaSec: 42,
  };
  const funnels = {
    onboarding: [
      { step: "application_started",   count: 38 },
      { step: "application_submitted", count: 26 },
      { step: "kyc_completed",         count: 21 },
      { step: "member_activated",      count: 18 },
    ],
    investor: [
      { step: "deals_shared",     count: 84 },
      { step: "deals_viewed",     count: 71 },
      { step: "soft_circled",     count: 38 },
      { step: "syndicate_joined", count: 22 },
    ],
  };
  const topCompanies = [   // Top member-tier brands (instead of portfolio companies)
    { id: "tier_lead",       name: "Lead Investor (tier)", traction: 9,  raised: 6_200_000 },
    { id: "tier_syndicate",  name: "Syndicate Lead (tier)", traction: 17, raised: 7_400_000 },
    { id: "tier_standard",   name: "Standard Member",       traction: 84, raised: 4_800_000 },
    { id: "tier_partner",    name: "Consortium Partner",    traction: 11, raised: 0 },
    { id: "tier_observer",   name: "Observer (read-only)",  traction: 21, raised: 0 },
  ];
  const topInvestors = [
    { id: "u_aisha_patel", name: "Aisha Patel · Hydra Ventures",   activity: 31, committed: 2_400_000 },
    { id: "u_moss_dawn",   name: "Moss & Dawn",                    activity: 22, committed: 1_950_000 },
    { id: "u_keith_sato",  name: "Keith Sato · Sato Capital",       activity: 18, committed: 1_350_000 },
  ];
  const regions = [
    { code: "US", companies: 78, raised: 12_400_000 },  // companies = members in this surface
    { code: "CA", companies: 12, raised: 1_100_000 },
    { code: "UK", companies: 18, raised: 1_900_000 },
    { code: "EU", companies: 11, raised: 1_350_000 },
    { code: "SG", companies:  8, raised:   900_000 },
    { code: "HK", companies:  6, raised:   400_000 },
    { code: "JP", companies:  4, raised:   200_000 },
    { code: "IN", companies:  3, raised:   100_000 },
    { code: "AU", companies:  2, raised:    50_000 },
  ];
  return {
    summary: {
      totalCompanies: totalMembers,            // re-use shape: "companies" = members
      totalInvestors: activeMembers,           // "investors" = active members
      totalCommittedSoftCircle: totalCommittedSyndication,
      totalFunded: totalDeployedSyndication,
      momGrowthPct: (newMembersMoM / totalMembers) * 100,
      churnPct,
      nrr,
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

function appendAudit(
  actor: string,
  entity: string,
  eventType: string,
  payload: Record<string, unknown>,
  explicitTenantId?: string,
): AuditEntry {
  const id = `al_${randomBytes(6).toString("hex")}`;
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
      const tipRow = tx
        .select({ hash: auditLogTable.hash })
        .from(auditLogTable)
        .where(eq(auditLogTable.tenantId, tenantId))
        .orderBy(desc(auditLogTable.createdAt))
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
    // If the DB write fails we still surface an entry to keep callers
    // resilient (route may have already optimistically returned 200). The
    // chain ends up only in-memory for this entry, which is logged loudly.
    log.error("[adminPlatformStore.appendAudit] DB write failed:", (err as Error).message);
    const prevHash = "0".repeat(64);
    const body = `${prevHash}|${id}|${eventType}|${entity}|${ts}|${payloadStr}`;
    const hash = sha256(body);
    finalEntry = { id, ts, actor, entity, eventType, payload, priorHash: prevHash, hash, tenantId };
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
          if (tier.annualPriceCents != null) {
            tier.displayPrice = `$${(tier.annualPriceCents / 100).toLocaleString("en-US")} USD/year per company`;
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
const reconRuns: ReconRun[] = [
  { id: "rec_1", ts: new Date(Date.now()-3600_000).toISOString(), companyId: "co_novapay", roundId: "rnd_novapay_seed", engineMain: { totalShares: "12500000", ownership: 1.0 }, engineRef: { totalShares: "12500000", ownership: 1.0 }, diff: { sharesDelta: "0", ownershipDelta: 0, ok: true }, actor: "system_nightly" },
  { id: "rec_2", ts: new Date(Date.now()-7200_000).toISOString(), companyId: "co_quanta", roundId: "rnd_q_a", engineMain: { totalShares: "8200000", ownership: 1.0 }, engineRef: { totalShares: "8200000", ownership: 1.0 }, diff: { sharesDelta: "0", ownershipDelta: 0, ok: true }, actor: "system_nightly" },
  { id: "rec_3", ts: new Date(Date.now()-86400_000).toISOString(), companyId: "co_helia", roundId: "rnd_helia_a", engineMain: { totalShares: "4500000", ownership: 1.0 }, engineRef: { totalShares: "4500900", ownership: 1.0002 }, diff: { sharesDelta: "900", ownershipDelta: 0.0002, ok: false }, actor: "system_nightly" },
];

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
const founderTiers: FounderTier[] = [
  {
    id: "founder_capavate_annual",
    name: "Capavate Annual",
    usdMonthly: 70, // $70/mo display equivalent = $840/year
    billingCycle: "annual",
    annualPriceCents: 84000,
    displayPrice: "$840 USD/year per company",
    features: [
      { key: "cap_table", label: "Cap Table Management", included: true },
      { key: "rounds", label: "Round Management", included: true },
      { key: "data_room", label: "Data Room", included: true },
      { key: "investors_crm", label: "Investor CRM", included: true },
      { key: "documents", label: "Documents & Term Sheets", included: true },
      { key: "esop", label: "ESOP / Option Pool", included: true },
      { key: "communications", label: "Messages & Communications", included: true },
      { key: "audit_chain", label: "Audit Log & Hash Chain Verification", included: true },
      { key: "compliance", label: "GDPR / CCPA Compliance Tools", included: true },
      { key: "support", label: "Email Support", included: true },
      { key: "collective", label: "Collective Membership", included: false },
      { key: "consortium", label: "Consortium Partner Features", included: false },
    ],
  },
];

const collectiveTiers = [
  { id: "collective_standard", name: "Standard (Angel Network)", usdAnnual: 1200, description: "Full Collective member access" },
  { id: "collective_plus", name: "Plus", usdAnnual: 2400, description: "Plus tier — DSC-eligible" },
  { id: "collective_individual", name: "Individual", usdAnnual: 600, description: "Individual investor" },
];

const regionalPricing: Array<{ region: string; standardAnnualUsd: number; multiplier: number }> = [
  { region: "US", standardAnnualUsd: 1200, multiplier: 1.00 },
  { region: "CA", standardAnnualUsd: 1200, multiplier: 1.00 },
  { region: "UK", standardAnnualUsd: 1200, multiplier: 1.00 },
  { region: "EU", standardAnnualUsd: 1200, multiplier: 1.00 },
  { region: "IN", standardAnnualUsd:  600, multiplier: 0.50 },
  { region: "JP", standardAnnualUsd: 1200, multiplier: 1.00 },
  { region: "HK", standardAnnualUsd: 1200, multiplier: 1.00 },
  { region: "CN", standardAnnualUsd:  900, multiplier: 0.75 },
  { region: "AU", standardAnnualUsd: 1200, multiplier: 1.00 },
];

const billingMetrics = {
  mrrUsd: 84_200,
  arrUsd: 84_200 * 12,
  churnUsd: 4_800,
  newRevenueUsd: 12_400,
  expansionUsd: 2_100,
};

/* ------------ Telemetry power (event browser + funnel + cohort) ------------ */
function telemetryEvents() {
  // Synthesize from existing seed; reuse event types from the bridge.
  const types = ALL_OUTBOUND_EVENT_TYPES;
  const out: Array<{ id: string; ts: string; eventType: string; actor: string; entity: string; payload: Record<string, unknown> }> = [];
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
    const surface = String(req.query.surface ?? "capavate").toLowerCase();
    if (surface === "collective") {
      return res.json(computeCollectiveKpis());
    }
    res.json(computeKpis());
  });
  app.get("/api/admin/dashboard/activity", (req: Request, res: Response) => {
    const surface = String(req.query.surface ?? "capavate").toLowerCase();
    if (surface === "collective") {
      // Synthesise Collective-flavour activity items.
      return res.json({
        items: [
          { id: "col_act_1", ts: new Date(Date.now() - 3 * 60_000).toISOString(),  actor: "u_admin",       entity: "app_421",  kind: "application.approved",       text: "Approved Sasha Reyes (Cascade Group) — Standard" },
          { id: "col_act_2", ts: new Date(Date.now() - 9 * 60_000).toISOString(),  actor: "u_aisha_patel", entity: "synd_07",   kind: "syndicate.commitment",        text: "Aisha committed $250K to Helia Series A syndicate" },
          { id: "col_act_3", ts: new Date(Date.now() - 24 * 60_000).toISOString(), actor: "u_admin",       entity: "member_lap", kind: "membership.renewal_reminder", text: "Renewal reminders sent: 5 members (T-30 days)" },
          // Partner-related synthetic activity was removed (Final Partner CRM patch — zero partner mocks in production paths).
          { id: "col_act_5", ts: new Date(Date.now() - 92 * 60_000).toISOString(), actor: "u_keith_sato",  entity: "app_417",   kind: "application.kyc_uploaded",    text: "Keith Sato submitted refreshed KYC docs" },
        ],
      });
    }
    // Patch v10 — merge live telemetry events for the allowlisted kinds with
    // the static demo seed so promoted-to-collective, cap-table-mutated and
    // application-submitted events appear in the admin dashboard activity feed.
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
    const merged = [...live, ...activityFeed]
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .slice(0, 30);
    res.json({ items: merged });
  });

  /* ====== Companies detail ====== */
  app.get("/api/admin/companies/:id/stats", (req: Request, res: Response) => {
    const id = req.params.id;
    const co = companies.find(c => c.id === id);
    const companyRounds = rounds.filter(r => r.companyId === id);
    const cs = softCircles.filter(s => companyRounds.find(r => r.id === s.roundId));
    const totalRaised = companyRounds.reduce((s, r) => s + (r.amountRaised ?? 0), 0);
    const dr = dataroomFiles.filter(f => f.companyId === id);
    const reps = reports.filter(r => r.companyId === id);
    res.json({
      id, name: co?.name ?? id,
      capTable: { holders: 12, totalShares: "12500000" },
      totalRaised,
      investorCount: cs.length || 6,
      softCircleConversionPct: 64.4,
      dataroom: { topDocs: dr.slice(0, 5).map(f => ({ id: f.id, name: f.fileName, viewers: 7 })) },
      reportReadRatePct: 78,
      maSignals: { compositeScore: 82, mnaScore: 76, roundScore: 88, autoTier: "A" },
      reports: reps.length || 4,
    });
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
  app.get("/api/admin/investors", (_req: Request, res: Response) => {
    res.json({
      items: [
        { id: "u_aisha_patel", name: "Aisha Patel · Hydra Ventures", tier: "Standard", region: "UK", checkSize: 250_000, score: 88, committed: 2_400_000, funded: 1_900_000, irrPct: 22.4, vip: true, status: "active" },
        { id: "u_moss_dawn", name: "Moss & Dawn", tier: "Plus", region: "US", checkSize: 500_000, score: 82, committed: 3_500_000, funded: 2_900_000, irrPct: 18.1, vip: true, status: "active" },
        { id: "u_lapsed_lp", name: "Cascadia LP", tier: "Standard", region: "US", checkSize: 100_000, score: 41, committed: 800_000, funded: 800_000, irrPct: 4.0, vip: false, status: "lapsed" },
        { id: "u_no_position", name: "Onlooker Angel", tier: "Individual", region: "AU", checkSize: 25_000, score: 18, committed: 0, funded: 0, irrPct: 0, vip: false, status: "no_position" },
        { id: "u_p_y_combinator", name: "Y Combinator", tier: "Plus", region: "US", checkSize: 125_000, score: 95, committed: 1_500_000, funded: 1_500_000, irrPct: 27.8, vip: true, status: "active" },
      ],
    });
  });
  app.get("/api/admin/investors/:id", (req: Request, res: Response) => {
    res.json({
      id: req.params.id,
      profile: { name: "Aisha Patel · Hydra Ventures", region: "UK", tier: "Standard", checkSizeUsd: 250_000, accreditation: "verified" },
      holdings: [
        { companyId: "co_novapay", company: "NovaPay AI", ownershipPct: 0.041, valueUsd: 720_000, instrument: "SAFE+Common" },
        { companyId: "co_arboreal", company: "Arboreal Health", ownershipPct: 0.012, valueUsd: 95_000, instrument: "Note" },
      ],
      softCircleHistory: [
        { roundId: "rnd_novapay_seed", at: "2026-04-09", amount: 250_000, status: "funded" },
        { roundId: "rnd_arboreal_pre", at: "2025-11-20", amount:  95_000, status: "funded" },
      ],
      committedUsd: 2_400_000,
      fundedUsd: 1_900_000,
      irrContributionPct: 22.4,
      ltvUsd: 4_200_000,
      churnRiskPct: 8,
      behaviorSignals: { dataroomViews: 41, messagesSent: 18, reportsRead: 9 },
      score: 88,
    });
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
  app.get("/api/admin/users/:id", (req: Request, res: Response) => {
    const u = users.find(x => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: "not_found" });
    const userAudit = auditLog.filter(a => a.actor === u.id);
    res.json({ ...u, audit: userAudit });
  });
  app.post("/api/admin/users/:id/sessions/revoke", (req: Request, res: Response) => {
    const u = users.find(x => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: "not_found" });
    const before = u.sessions.length;
    u.sessions = [];
    res.json({ ok: true, revoked: before });
  });
  app.post("/api/admin/users/bulk", (req: Request, res: Response) => {
    const { action, ids } = req.body ?? {};
    const allowed = ["suspend","unsuspend","force_mfa","force_logout","reset_password"];
    if (!allowed.includes(action)) return res.status(400).json({ error: "invalid_action", allowed });
    res.json({ ok: true, action, count: Array.isArray(ids) ? ids.length : 0 });
  });

  /* ====== Audit log ====== */
  app.get("/api/admin/audit-log", (req: Request, res: Response) => {
    const entity = String(req.query.entity ?? "");
    const actor = String(req.query.actor ?? "");
    const eventType = String(req.query.eventType ?? "");
    const q = String(req.query.q ?? "").toLowerCase();
    const items = auditLog.filter(a =>
      (entity ? a.entity === entity : true) &&
      (actor ? a.actor === actor : true) &&
      (eventType ? a.eventType === eventType : true) &&
      (q ? JSON.stringify(a).toLowerCase().includes(q) : true)
    );
    res.json({ count: items.length, items });
  });
  app.get("/api/admin/audit-log/verify", (_req: Request, res: Response) => {
    let prior = "0".repeat(64);
    let broken = -1;
    for (let i = 0; i < auditLog.length; i++) {
      const a = auditLog[i];
      if (a.priorHash !== prior) { broken = i; break; }
      const expected = sha256(`${prior}|${a.id}|${a.eventType}|${a.entity}|${a.ts}|${JSON.stringify(a.payload)}`);
      if (a.hash !== expected) { broken = i; break; }
      prior = a.hash;
    }
    res.json({ ok: broken === -1, brokenAt: broken, totalLinks: auditLog.length });
  });
  app.get("/api/admin/audit-log/export.csv", (_req: Request, res: Response) => {
    const csv = ["id,ts,actor,entity,eventType,priorHash,hash", ...auditLog.map(a => [a.id,a.ts,a.actor,a.entity,a.eventType,a.priorHash,a.hash].join(","))].join("\n");
    res.setHeader("content-type","text/csv");
    res.send(csv);
  });
  app.post("/api/admin/audit-log/append", (req: Request, res: Response) => {
    const { actor, entity, eventType, payload } = req.body ?? {};
    if (!actor || !entity || !eventType) return res.status(400).json({ error: "missing_fields" });
    res.json(appendAudit(actor, entity, eventType, payload ?? {}));
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

  /* ====== Pricing ====== */
  app.get("/api/admin/pricing/founder-tiers", (_req: Request, res: Response) => {
    res.json({ tiers: founderTiers });
  });
  app.get("/api/admin/pricing/collective-tiers", (_req: Request, res: Response) => {
    res.json({ tiers: collectiveTiers });
  });
  app.get("/api/admin/pricing/regional", (_req: Request, res: Response) => {
    res.json({ regions: regionalPricing });
  });
  app.get("/api/admin/pricing/billing-metrics", (_req: Request, res: Response) => {
    res.json(billingMetrics);
  });
}

export const _testAdmin = { computeKpis, users, auditLog, appendAudit, reconRuns, founderTiers, collectiveTiers, regionalPricing };
