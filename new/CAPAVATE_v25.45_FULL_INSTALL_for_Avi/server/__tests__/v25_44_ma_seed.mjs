/* v25.44 — shared M&A seeding helper for the surface-13 E2E suite.
 *
 * v25.44 ROUND 2 (BLOCKER 2): the aggregation now reads REAL stored Step 4 M&A
 * fields from `profilestore_company_profile.profile_json`. This helper therefore
 * writes BOTH the company row (with ma_privacy_json) AND a durable company
 * profile containing a populated `ma` block, so seeded companies actually carry
 * M&A data. Companies seeded WITHOUT a profile (profile:false) have no M&A data
 * and must be EXCLUDED from aggregation — useful for the "no data" exclusion
 * test.
 */
import { rawDb } from "../db/connection.ts";

/** Build a populated, schema-shaped `ma` block with optional overrides. */
function buildMaBlock(overrides = {}) {
  const base = {
    strategicPriorities: ["market_expansion", "tech_acquisition"],
    transactionInterests: ["jv_partnership", "minority_investment"],
    partnerTypesSought: ["distribution", "technology"],
    dealBreakers: [],
    competitor1Name: "Comp One", competitor1WebsiteUrl: "https://c1.test", competitor1Differentiator: "Differentiator one for schema length compliance.",
    competitor2Name: "Comp Two", competitor2WebsiteUrl: "https://c2.test", competitor2Differentiator: "Differentiator two for schema length compliance.",
    competitor3Name: "", competitor3WebsiteUrl: "", competitor3Differentiator: "",
    hasFormalBoard: true,
    hasPendingLitigation: false,
    isRegulatoryCompliant: true,
    hasExternalLegalCounsel: true,
    isFinanciallyAudited: true,
    isSaasRecurring: true,
    holdsMaterialIp: true,
    hasEsgFramework: false,
    hasDeiPolicy: true,
    hasCybersecurityCertification: true,
    accountingFirmName: "Seed Accounting",
    operatingGeographies: ["north_america", "western_europe"],
    customerSegments: ["enterprise", "mid_market"],
    hasMfnExclusivity: false,
    hasRevenueConcentration30Pct: false,
    hasChangeOfControlClauses: false,
    maReadinessNarrative: "Seed readiness narrative satisfying minimum length for the aggregation tests.",
    uniqueValueProposition: "Seed unique value proposition long enough to satisfy schema validation.",
  };
  return { ...base, ...overrides };
}

/**
 * Seed a company + (by default) a durable company profile with REAL M&A data.
 *
 * options:
 *   id, name, sector, tenantId, privacy, chapter
 *   profile     — true (default) writes a profile_json; false writes none
 *                 (company will be excluded from aggregation — no M&A data)
 *   ma          — overrides merged into the seeded `ma` block
 *   narrative   — convenience for ma.maReadinessNarrative
 *   memberUserId— if set, inserts an active company_members row (founder test)
 */
export function seedCompany(opts) {
  const { id, name, sector, tenantId, privacy, chapter, profile = true, ma = {}, narrative, memberUserId } = opts;
  const db = rawDb();
  const tid = tenantId ?? `tenant_co_${id}`;
  db.prepare(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, sector, is_demo, ma_privacy_json)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, tid, name, sector, JSON.stringify(privacy));

  if (chapter) {
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT OR REPLACE INTO collective_directory_listings
           (id, company_id, application_id, chapter, stage, sector, listed_at, status)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 'listed')`,
      ).run(`dl_${id}`, id, `app_${id}`, chapter, sector, now);
    } catch { /* table may differ; non-fatal for some tests */ }
  }

  if (profile) {
    const maBlock = buildMaBlock({ ...(narrative != null ? { maReadinessNarrative: narrative } : {}), ...ma });
    const now = new Date().toISOString();
    const profileJson = {
      id, tenantId: tid, schemaVersion: "1.0", createdAt: now, updatedAt: now,
      contact: {}, address: {}, legal: {},
      ma: maBlock,
    };
    db.prepare(
      `INSERT OR REPLACE INTO profilestore_company_profile (company_id, tenant_id, profile_json, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run(id, tid, JSON.stringify(profileJson), now);
  }

  if (memberUserId) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO company_members (id, company_id, user_id, role, tenant_id, is_active, joined_at)
       VALUES (?, ?, ?, 'founder', ?, 1, ?)`,
    ).run(`cm_${id}_${memberUserId}`, id, memberUserId, tid, now);
  }
}

/** Seed an active chapter membership for an arbitrary user (cross-tenant tests). */
export function seedChapterMembershipFor(chapterId, userId, tenantId) {
  const now = new Date().toISOString();
  try {
    rawDb().prepare(
      `INSERT OR IGNORE INTO chapter_memberships
         (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at)
       VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
    ).run(`cm_${userId}_${chapterId}`, tenantId ?? `tenant_chap_${chapterId}`, chapterId, userId, now, now);
  } catch { /* non-fatal */ }
}

export const OPT_IN = { shareWithCollective: true, shareWithChapter: true, shareWithAdvisors: true, redactNarrativeFromAggregates: true };
export const OPT_OUT = { shareWithCollective: false, shareWithChapter: false, shareWithAdvisors: true, redactNarrativeFromAggregates: true };
export const CHAPTER_ONLY = { shareWithCollective: false, shareWithChapter: true, shareWithAdvisors: true, redactNarrativeFromAggregates: true };
/** Chapter-only but narrative NOT redacted (chapter peers may see narrative). */
export const CHAPTER_ONLY_SHOW_NARRATIVE = { shareWithCollective: false, shareWithChapter: true, shareWithAdvisors: true, redactNarrativeFromAggregates: false };
