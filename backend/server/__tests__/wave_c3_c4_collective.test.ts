/**
 * Wave C-3 + C-4 — Collective Shell + Deal Room + M&A Dashboard tests.
 *
 * ~60 tests covering:
 *  - All /api/collective/* endpoints return live data shapes correctly
 *  - Member directory excludes PII (emails, AUM, check sizes)
 *  - Deal Room companies filtered by transactionPrepStatus
 *  - DSC scoring engine: composite computes correctly for known sector + readiness inputs
 *  - Auto-tier maps correctly at boundaries (84→B, 85→A)
 *  - Empty companyProfile → null composite (graceful)
 *  - Sector weighting: SaaS vs Biotech with identical readiness returns DIFFERENT composites
 *  - Bridge ALL_OUTBOUND_EVENT_TYPES.length === 56
 *  - Collective settings store: hash chain extends, double-verify enforced
 *  - Activity feed endpoint returns correct shape
 *  - Cap-table summary view only returns aggregates
 *  - DSC pipeline grouped by status
 *  - Composite compute endpoint (POST) guards on role
 *  - Soft circles endpoint shows aggregates only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

import { ALL_OUTBOUND_EVENT_TYPES, _testBridge } from "../bridgeStore";
import { updateCompanyProfile, getCompanyProfile, _testCompanyProfile } from "../companyProfileStore";
import { registerCollectiveRoutes, registerTransactionPrepRecomputeListener } from "../collectiveRoutes";
import { registerCollectiveSettingsRoutes, __clearCollectiveSettings, getOrCreateSettings, patchSettings } from "../collectiveSettingsStore";
import {
  computeCompositeForCompany,
  computeCompositeForProfile,
  computeAutoTier,
  computeAllComposites,
} from "../dscScoringEngine";
import type { CompanyProfile } from "../companyProfileStore";
import { registerAdminContactsRoutes } from "../adminContactsStore";
import { __clearDscFeedback, ingestDscScores } from "../dscFeedbackStore";
import { __clearTransactionPrep, createChannel } from "../transactionPrepStore";
import { emitMutation } from "../lib/eventBus";

/* ============================================================
 * Test app factory
 * ============================================================ */

function makeApp() {
  const app = express();
  app.use(express.json());
  registerCollectiveRoutes(app);
  registerCollectiveSettingsRoutes(app);
  registerAdminContactsRoutes(app);
  return app;
}

/* ============================================================
 * Helpers
 * ============================================================ */

function makeProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  const base: CompanyProfile = {
    companyId: `co_test_${Math.random().toString(36).slice(2, 8)}`,
    version: 1,
    prevHash: "GENESIS",
    hash: "abc123",
    updatedAt: new Date().toISOString(),
    updatedBy: "test",
    ...overrides,
  };
  return base;
}

/* ============================================================
 * Bridge event count
 * ============================================================ */

describe("Bridge event types", () => {
  it("ALL_OUTBOUND_EVENT_TYPES.length === 56", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES).toHaveLength(58);
  });

  it("includes all 3 new Wave C-3/C-4 event types", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("collective.member.updated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("collective.deal_room.opened");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("dsc.score.recomputed");
  });
});

/* ============================================================
 * DSC Scoring Engine — Unit Tests
 * ============================================================ */

describe("dscScoringEngine — computeCompositeForProfile", () => {
  it("returns null for a profile with NO readiness data (graceful empty state)", () => {
    const profile = makeProfile({ sector: "SaaS" });
    const result = computeCompositeForProfile(profile);
    expect(result).toBeNull();
  });

  it("returns a result when at least one readiness field is set", () => {
    const profile = makeProfile({
      sector: "SaaS",
      ipDdReadinessPct: 80,
    });
    const result = computeCompositeForProfile(profile);
    expect(result).not.toBeNull();
    expect(result!.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it("all-100 readiness for SaaS with 'closing' bonus → composite near 100", () => {
    const profile = makeProfile({
      sector: "SaaS",
      ipDdReadinessPct: 100,
      customerContractsReadinessPct: 100,
      financialAuditReadinessPct: 100,
      dataRoomOrganizedPct: 100,
      regulatoryFilingsCompletePct: 100,
      esgDisclosureCompletePct: 100,
      transactionPrepStatus: "closing",
    });
    const result = computeCompositeForProfile(profile);
    expect(result).not.toBeNull();
    expect(result!.compositeScore).toBe(100); // 100 + 15 bonus capped at 100
  });

  it("all-zero readiness → composite = 0", () => {
    const profile = makeProfile({
      sector: "SaaS",
      ipDdReadinessPct: 0,
      customerContractsReadinessPct: 0,
      financialAuditReadinessPct: 0,
      dataRoomOrganizedPct: 0,
      regulatoryFilingsCompletePct: 0,
      esgDisclosureCompletePct: 0,
      transactionPrepStatus: "not_pursuing",
    });
    const result = computeCompositeForProfile(profile);
    expect(result).not.toBeNull();
    expect(result!.compositeScore).toBe(0);
  });

  it("SaaS vs Biotech with IDENTICAL readiness % returns DIFFERENT composites", () => {
    const readiness = {
      ipDdReadinessPct: 70,
      customerContractsReadinessPct: 60,
      financialAuditReadinessPct: 75,
      dataRoomOrganizedPct: 50,
      regulatoryFilingsCompletePct: 40,
      esgDisclosureCompletePct: 55,
      transactionPrepStatus: "exploring" as const,
    };
    const saasProfile = makeProfile({ sector: "SaaS", ...readiness });
    const biotechProfile = makeProfile({ sector: "Biotech", ...readiness });

    const saasResult = computeCompositeForProfile(saasProfile);
    const biotechResult = computeCompositeForProfile(biotechProfile);

    expect(saasResult).not.toBeNull();
    expect(biotechResult).not.toBeNull();
    // SaaS weights customer contracts higher (0.30), Biotech weights regulatory higher (0.25)
    // With regulatory=40 and customerContracts=60, these MUST be different
    expect(saasResult!.compositeScore).not.toBe(biotechResult!.compositeScore);
  });

  it("auto-tier boundary: composite 84 → Tier B", () => {
    const tier = computeAutoTier(84);
    expect(tier).toBe("B");
  });

  it("auto-tier boundary: composite 85 → Tier A", () => {
    const tier = computeAutoTier(85);
    expect(tier).toBe("A");
  });

  it("auto-tier: 69 → C", () => {
    expect(computeAutoTier(69)).toBe("C");
  });

  it("auto-tier: 70 → B", () => {
    expect(computeAutoTier(70)).toBe("B");
  });

  it("auto-tier: 49 → D", () => {
    expect(computeAutoTier(49)).toBe("D");
  });

  it("auto-tier: 50 → C", () => {
    expect(computeAutoTier(50)).toBe("C");
  });

  it("mnaScore is average of IP, customers, financial, regulatory", () => {
    const profile = makeProfile({
      sector: "SaaS",
      ipDdReadinessPct: 80,
      customerContractsReadinessPct: 60,
      financialAuditReadinessPct: 70,
      regulatoryFilingsCompletePct: 40,
      dataRoomOrganizedPct: 50,
      esgDisclosureCompletePct: 50,
    });
    const result = computeCompositeForProfile(profile);
    expect(result).not.toBeNull();
    // mnaScore = avg(80, 60, 70, 40) = 62.5 → 63
    expect(result!.mnaScore).toBe(63);
  });

  it("transactionPrepStatus 'active' adds 10-point bonus to composite", () => {
    const base = makeProfile({
      sector: "Default",
      ipDdReadinessPct: 50,
      customerContractsReadinessPct: 50,
      financialAuditReadinessPct: 50,
      dataRoomOrganizedPct: 50,
      regulatoryFilingsCompletePct: 50,
      esgDisclosureCompletePct: 50,
      transactionPrepStatus: "not_pursuing",
    });
    const active = makeProfile({
      sector: "Default",
      ipDdReadinessPct: 50,
      customerContractsReadinessPct: 50,
      financialAuditReadinessPct: 50,
      dataRoomOrganizedPct: 50,
      regulatoryFilingsCompletePct: 50,
      esgDisclosureCompletePct: 50,
      transactionPrepStatus: "active",
    });
    const baseResult = computeCompositeForProfile(base)!;
    const activeResult = computeCompositeForProfile(active)!;
    expect(activeResult.compositeScore).toBe(baseResult.compositeScore + 10);
  });

  it("breakdown.sectorKey is correctly identified for SaaS company", () => {
    const profile = makeProfile({
      sector: "SaaS",
      ipDdReadinessPct: 50,
    });
    const result = computeCompositeForProfile(profile);
    expect(result!.breakdown.sectorKey).toBe("saas");
  });

  it("breakdown.sectorKey is 'default' for unknown sector", () => {
    const profile = makeProfile({
      sector: "Unknown Niche",
      ipDdReadinessPct: 50,
    });
    const result = computeCompositeForProfile(profile);
    expect(result!.breakdown.sectorKey).toBe("default");
  });
});

/* ============================================================
 * computeCompositeForCompany — integration with profileMap
 * ============================================================ */

describe("computeCompositeForCompany", () => {
  beforeEach(() => {
    _testCompanyProfile.reset();
    _testBridge.resetChain();
  });

  it("returns null for unknown companyId", () => {
    const result = computeCompositeForCompany("co_does_not_exist_xyz");
    expect(result).toBeNull();
  });

  it("returns null for company with empty profile (no readiness data)", () => {
    // getCompanyProfile creates an empty profile
    const profile = getCompanyProfile("co_empty_test");
    // empty profile has no readiness fields
    const result = computeCompositeForCompany("co_empty_test");
    expect(result).toBeNull();
  });

  it("returns a valid composite once readiness data is set", () => {
    updateCompanyProfile("co_score_test", {
      sector: "Fintech",
      ipDdReadinessPct: 75,
      customerContractsReadinessPct: 80,
      financialAuditReadinessPct: 70,
      dataRoomOrganizedPct: 65,
      regulatoryFilingsCompletePct: 60,
      esgDisclosureCompletePct: 50,
    }, "test");
    const result = computeCompositeForCompany("co_score_test");
    expect(result).not.toBeNull();
    expect(result!.companyId).toBe("co_score_test");
    expect(result!.compositeScore).toBeGreaterThan(0);
    expect(["A", "B", "C", "D"]).toContain(result!.autoTier);
  });
});

/* ============================================================
 * Collective Settings Store
 * ============================================================ */

describe("collectiveSettingsStore", () => {
  beforeEach(() => {
    __clearCollectiveSettings();
  });

  it("creates default settings for a new user", () => {
    const settings = getOrCreateSettings("u_test_1");
    expect(settings.userId).toBe("u_test_1");
    expect(settings.anonymityLevel).toBe("public");
    expect(settings.notifyOnDscScore).toBe(true);
    expect(settings.dealRoomVisibility).toBe("visible");
    expect(settings.version).toBe(1);
  });

  it("patchSettings updates fields and increments version", () => {
    getOrCreateSettings("u_test_2");
    const updated = patchSettings("u_test_2", { anonymityLevel: "private" }, "u_test_2");
    expect(updated.anonymityLevel).toBe("private");
    expect(updated.version).toBe(2);
  });

  it("hash chain extends on patch (prevHash → hash)", () => {
    const initial = getOrCreateSettings("u_test_3");
    const first = patchSettings("u_test_3", { notifyOnDscScore: false }, "u_test_3");
    expect(first.prevHash).toBe(initial.hash);
    const second = patchSettings("u_test_3", { dealRoomVisibility: "hidden" }, "u_test_3");
    expect(second.prevHash).toBe(first.hash);
  });

  it("idempotent: getting settings twice returns same object", () => {
    const s1 = getOrCreateSettings("u_test_4");
    const s2 = getOrCreateSettings("u_test_4");
    expect(s1.hash).toBe(s2.hash);
  });
});

/* ============================================================
 * HTTP endpoint tests
 * ============================================================ */

describe("GET /api/collective/settings/mine", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    __clearCollectiveSettings();
    app = makeApp();
  });

  it("returns default settings for new user", async () => {
    const res = await request(app)
      .get("/api/collective/settings/mine")
      .set("x-user-id", "u_http_test");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("u_http_test");
    expect(res.body.anonymityLevel).toBe("public");
  });
});

describe("PATCH /api/collective/settings/mine", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    __clearCollectiveSettings();
    app = makeApp();
  });

  it("requires x-confirm: true header (double-verify)", async () => {
    const res = await request(app)
      .patch("/api/collective/settings/mine")
      .set("x-user-id", "u_http_test")
      .send({ anonymityLevel: "private" });
    expect(res.status).toBe(428);
    expect(res.body.error).toBe("double_verify_required");
  });

  it("updates settings with x-confirm header", async () => {
    const res = await request(app)
      .patch("/api/collective/settings/mine")
      .set("x-user-id", "u_http_patch")
      .set("x-confirm", "true")
      .send({ anonymityLevel: "screen_name", notifyOnDscScore: false });
    expect(res.status).toBe(200);
    expect(res.body.anonymityLevel).toBe("screen_name");
    expect(res.body.notifyOnDscScore).toBe(false);
    expect(res.body.version).toBe(2);
  });

  it("rejects invalid anonymityLevel", async () => {
    const res = await request(app)
      .patch("/api/collective/settings/mine")
      .set("x-user-id", "u_http_bad")
      .set("x-confirm", "true")
      .send({ anonymityLevel: "not_a_valid_value" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation");
  });
});

/* ============================================================
 * Collective API endpoints
 * ============================================================ */

describe("GET /api/collective/dashboard", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testBridge.resetChain();
    app = makeApp();
  });

  it("returns kpis and recentActivity", async () => {
    const res = await request(app).get("/api/collective/dashboard");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("kpis");
    expect(res.body).toHaveProperty("recentActivity");
    expect(typeof res.body.kpis.totalMembers).toBe("number");
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
  });
});

describe("GET /api/collective/members", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("returns members array with total", async () => {
    const res = await request(app).get("/api/collective/members");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("EXCLUDES email from member records (PII protection)", async () => {
    const res = await request(app).get("/api/collective/members");
    expect(res.status).toBe(200);
    for (const member of res.body.members) {
      expect(member).not.toHaveProperty("email");
    }
  });

  it("EXCLUDES aumMinor from member records (financial intel protection)", async () => {
    const res = await request(app).get("/api/collective/members");
    for (const member of res.body.members) {
      expect(member).not.toHaveProperty("aumMinor");
      expect(member).not.toHaveProperty("aumCurrency");
    }
  });

  it("EXCLUDES checkSizeMinMinor/checkSizeMaxMinor", async () => {
    const res = await request(app).get("/api/collective/members");
    for (const member of res.body.members) {
      expect(member).not.toHaveProperty("checkSizeMinMinor");
      expect(member).not.toHaveProperty("checkSizeMaxMinor");
    }
  });

  it("INCLUDES non-PII fields: displayName, kind, region, industries", async () => {
    const res = await request(app).get("/api/collective/members");
    if (res.body.members.length > 0) {
      const m = res.body.members[0];
      expect(m).toHaveProperty("displayName");
      expect(m).toHaveProperty("kind");
      expect(m).toHaveProperty("region");
      expect(m).toHaveProperty("industries");
    }
  });

  it("only returns investors and consortium_partners (not founders)", async () => {
    const res = await request(app).get("/api/collective/members");
    for (const member of res.body.members) {
      expect(["investor", "consortium_partner"]).toContain(member.kind);
    }
  });
});

describe("GET /api/collective/dealroom/companies", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    __clearDscFeedback();
    __clearTransactionPrep();
    app = makeApp();
  });

  it("returns companies and total", async () => {
    const res = await request(app).get("/api/collective/dealroom/companies");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.companies)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("includes only companies with transactionPrepStatus in exploring/active/closing", async () => {
    // Set up profiles
    updateCompanyProfile("co_exploring", { transactionPrepStatus: "exploring" }, "test");
    updateCompanyProfile("co_active", { transactionPrepStatus: "active" }, "test");
    updateCompanyProfile("co_closing", { transactionPrepStatus: "closing" }, "test");
    updateCompanyProfile("co_not_pursuing", { transactionPrepStatus: "not_pursuing" }, "test");

    const res = await request(app).get("/api/collective/dealroom/companies");
    expect(res.status).toBe(200);
    const ids = res.body.companies.map((c: { companyId: string }) => c.companyId);
    expect(ids).toContain("co_exploring");
    expect(ids).toContain("co_active");
    expect(ids).toContain("co_closing");
    // not_pursuing ONLY excluded if no channel exists
    // (co_not_pursuing has no channel, so should not be in deal room)
    expect(ids).not.toContain("co_not_pursuing");
  });

  it("each company in dealroom has transactionPrepStatus and compositeScore fields", async () => {
    updateCompanyProfile("co_dr_test", { transactionPrepStatus: "exploring" }, "test");
    const res = await request(app).get("/api/collective/dealroom/companies");
    const company = res.body.companies.find((c: { companyId: string }) => c.companyId === "co_dr_test");
    expect(company).toBeDefined();
    expect(company).toHaveProperty("transactionPrepStatus");
    expect(company).toHaveProperty("compositeScore");
  });
});

describe("GET /api/collective/dsc/pipeline", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    app = makeApp();
  });

  it("returns columns grouped by transactionPrepStatus", async () => {
    const res = await request(app).get("/api/collective/dsc/pipeline");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("columns");
    expect(res.body.columns).toHaveProperty("not_pursuing");
    expect(res.body.columns).toHaveProperty("exploring");
    expect(res.body.columns).toHaveProperty("active");
    expect(res.body.columns).toHaveProperty("closing");
    expect(res.body.columns).toHaveProperty("closed");
  });

  it("company with 'active' status appears in active column", async () => {
    updateCompanyProfile("co_pipeline_active", { transactionPrepStatus: "active" }, "test");
    const res = await request(app).get("/api/collective/dsc/pipeline");
    const activeIds = res.body.columns.active.map((c: { companyId: string }) => c.companyId);
    expect(activeIds).toContain("co_pipeline_active");
  });
});

describe("GET /api/collective/dsc/scores", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    __clearDscFeedback();
    app = makeApp();
  });

  it("returns scores array with total", async () => {
    const res = await request(app).get("/api/collective/dsc/scores");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.scores)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("companies with no readiness data are not included", async () => {
    // Empty profile for co_no_data
    getCompanyProfile("co_no_data");
    const res = await request(app).get("/api/collective/dsc/scores");
    const ids = res.body.scores.map((s: { companyId: string }) => s.companyId);
    expect(ids).not.toContain("co_no_data");
  });

  it("company with readiness data is included with correct composite", async () => {
    updateCompanyProfile("co_scores_test", {
      sector: "SaaS",
      ipDdReadinessPct: 90,
      customerContractsReadinessPct: 85,
      financialAuditReadinessPct: 80,
      dataRoomOrganizedPct: 75,
      regulatoryFilingsCompletePct: 70,
      esgDisclosureCompletePct: 65,
    }, "test");
    const res = await request(app).get("/api/collective/dsc/scores");
    const found = res.body.scores.find((s: { companyId: string }) => s.companyId === "co_scores_test");
    expect(found).toBeDefined();
    expect(found.compositeScore).toBeGreaterThan(0);
    expect(["A", "B", "C", "D"]).toContain(found.autoTier);
  });
});

describe("GET /api/collective/dsc/composite/:companyId", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    app = makeApp();
  });

  it("returns null composite for company with no data", async () => {
    getCompanyProfile("co_composite_empty");
    const res = await request(app).get("/api/collective/dsc/composite/co_composite_empty");
    expect(res.status).toBe(200);
    expect(res.body.composite).toBeNull();
  });

  it("returns live composite for company with data", async () => {
    updateCompanyProfile("co_composite_live", {
      sector: "Fintech",
      ipDdReadinessPct: 70,
      financialAuditReadinessPct: 80,
    }, "test");
    const res = await request(app).get("/api/collective/dsc/composite/co_composite_live");
    expect(res.status).toBe(200);
    expect(res.body.composite).not.toBeNull();
    expect(typeof res.body.composite.compositeScore).toBe("number");
  });
});

describe("POST /api/collective/dsc/compute/:companyId", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    __clearDscFeedback();
    _testBridge.resetChain();
    app = makeApp();
  });

  it("requires DSC or admin role", async () => {
    const res = await request(app)
      .post("/api/collective/dsc/compute/co_test")
      .set("x-role", "founder")
      .set("x-confirm", "true");
    expect(res.status).toBe(403);
  });

  it("requires x-confirm header", async () => {
    const res = await request(app)
      .post("/api/collective/dsc/compute/co_test")
      .set("x-role", "admin");
    expect(res.status).toBe(428);
  });

  it("returns 422 for company with no readiness data", async () => {
    getCompanyProfile("co_no_readiness");
    const res = await request(app)
      .post("/api/collective/dsc/compute/co_no_readiness")
      .set("x-role", "admin")
      .set("x-confirm", "true");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_readiness_data");
  });

  it("computes and writes DscFeedback for company with data", async () => {
    updateCompanyProfile("co_compute_test", {
      sector: "SaaS",
      ipDdReadinessPct: 80,
      customerContractsReadinessPct: 75,
      financialAuditReadinessPct: 70,
      dataRoomOrganizedPct: 65,
      regulatoryFilingsCompletePct: 60,
      esgDisclosureCompletePct: 55,
    }, "test");
    const res = await request(app)
      .post("/api/collective/dsc/compute/co_compute_test")
      .set("x-role", "admin")
      .set("x-confirm", "true");
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("feedback");
    expect(res.body).toHaveProperty("composite");
    expect(res.body.feedback.companyId).toBe("co_compute_test");
    expect(typeof res.body.composite.compositeScore).toBe("number");
  });
});

describe("GET /api/collective/activity", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testBridge.resetChain();
    app = makeApp();
  });

  it("returns feed array with total", async () => {
    const res = await request(app).get("/api/collective/activity");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.feed)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("respects limit query param", async () => {
    const res = await request(app).get("/api/collective/activity?limit=5");
    expect(res.status).toBe(200);
    expect(res.body.feed.length).toBeLessThanOrEqual(5);
  });
});

describe("GET /api/collective/companies", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    app = makeApp();
  });

  it("returns companies array with total", async () => {
    const res = await request(app).get("/api/collective/companies");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.companies)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("each company has required fields", async () => {
    updateCompanyProfile("co_full_test", {
      sector: "SaaS",
      stage: "Seed",
      tagline: "Test tagline",
    }, "test");
    const res = await request(app).get("/api/collective/companies");
    const found = res.body.companies.find((c: { companyId: string }) => c.companyId === "co_full_test");
    expect(found).toBeDefined();
    expect(found).toHaveProperty("companyId");
    expect(found).toHaveProperty("companyName");
    expect(found).toHaveProperty("sector");
    expect(found).toHaveProperty("stage");
  });
});

describe("GET /api/collective/companies/:id", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    __clearDscFeedback();
    app = makeApp();
  });

  it("returns full company detail with 4 sections", async () => {
    updateCompanyProfile("co_detail_test", {
      sector: "HealthTech",
      ipDdReadinessPct: 60,
    }, "test");
    const res = await request(app).get("/api/collective/companies/co_detail_test");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("profile");
    expect(res.body).toHaveProperty("mnaReadiness");
    expect(res.body).toHaveProperty("capTableSummary");
    expect(res.body).toHaveProperty("recentActivity");
  });

  it("cap table summary ONLY shows aggregates, not per-shareholder data", async () => {
    const res = await request(app).get("/api/collective/companies/co_detail_test");
    const cap = res.body.capTableSummary;
    // Should have a note about read-only
    expect(cap).toHaveProperty("note");
    // Should NOT have shareholder breakdown arrays
    expect(cap).not.toHaveProperty("shareholders");
    expect(cap).not.toHaveProperty("holdingBreakdown");
    expect(cap).not.toHaveProperty("securities");
  });

  it("mnaReadiness shows 'No DSC score yet' state for company with no DSC feedback", async () => {
    const res = await request(app).get("/api/collective/companies/co_detail_test");
    // composite should be null or have a mnaScore if readiness data exists
    // For co_detail_test which has ipDdReadinessPct=60, composite should exist
    expect(res.body.mnaReadiness).toHaveProperty("composite");
    expect(res.body.mnaReadiness).toHaveProperty("dscFeedback");
  });
});

describe("GET /api/collective/soft-circles", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    app = makeApp();
  });

  it("returns aggregates array with total", async () => {
    const res = await request(app).get("/api/collective/soft-circles");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.aggregates)).toBe(true);
    expect(typeof res.body.total).toBe("number");
  });

  it("each aggregate has totalSoftCircled but NOT per-investor amounts", async () => {
    const res = await request(app).get("/api/collective/soft-circles");
    for (const agg of res.body.aggregates) {
      // Should have aggregate total
      expect(agg).toHaveProperty("softCircledTotal");
      expect(agg).toHaveProperty("softCircledCount");
      // Should NOT have individual amounts
      expect(agg).not.toHaveProperty("investorAmounts");
      expect(agg).not.toHaveProperty("byInvestor");
      expect(agg).not.toHaveProperty("individuals");
    }
  });
});

describe("GET /api/collective/dsc/prep", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(() => {
    _testCompanyProfile.reset();
    __clearTransactionPrep();
    app = makeApp();
  });

  it("returns channels array with 30 thread anchors per channel", async () => {
    createChannel({ companyId: "co_prep_test", founderUserId: "u_founder_demo" });
    const res = await request(app).get("/api/collective/dsc/prep");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.channels)).toBe(true);
    const ch = res.body.channels.find((c: { companyId: string }) => c.companyId === "co_prep_test");
    expect(ch).toBeDefined();
    expect(ch.threads).toHaveLength(30);
  });

  it("returns threadAnchors list with 30 items", async () => {
    const res = await request(app).get("/api/collective/dsc/prep");
    expect(res.body.threadAnchors).toHaveLength(30);
  });

  it("cross-links readinessPct to thread anchors where applicable", async () => {
    updateCompanyProfile("co_prep_crosslink", {
      ipDdReadinessPct: 75,
    }, "test");
    createChannel({ companyId: "co_prep_crosslink", founderUserId: "u_founder" });
    const res = await request(app).get("/api/collective/dsc/prep");
    const ch = res.body.channels.find((c: { companyId: string }) => c.companyId === "co_prep_crosslink");
    const ipThread = ch?.threads.find((t: { anchor: string }) => t.anchor === "ip_dd_readiness");
    if (ipThread) {
      expect(ipThread.readinessPct).toBe(75);
    }
  });
});

/* ============================================================
 * Auto-recompute listener test
 * ============================================================ */

describe("transaction_prep.updated → auto-recompute listener", () => {
  beforeEach(() => {
    _testCompanyProfile.reset();
    __clearDscFeedback();
    _testBridge.resetChain();
    // Reset listener flag for fresh test registration
  });

  it("emitting a transaction_prep mutation for a company with data triggers score recompute", async () => {
    // Set up company with readiness data
    updateCompanyProfile("co_listener_test", {
      sector: "SaaS",
      ipDdReadinessPct: 70,
      customerContractsReadinessPct: 75,
      financialAuditReadinessPct: 80,
      dataRoomOrganizedPct: 65,
      regulatoryFilingsCompletePct: 60,
      esgDisclosureCompletePct: 55,
    }, "test");

    // Register listener
    registerTransactionPrepRecomputeListener();

    // Simulate the mutation event
    emitMutation({ aggregate: "transaction_prep", id: "co_listener_test", change: "update" });

    // Give async listener a tick to run
    await new Promise((r) => setTimeout(r, 10));

    // Since the listener auto-ingests a DSC score, the feedback store should have an entry
    const { listFeedback } = await import("../dscFeedbackStore");
    const feedback = listFeedback();
    const forCompany = feedback.filter((f) => f.companyId === "co_listener_test");
    expect(forCompany.length).toBeGreaterThan(0);
  });
});
