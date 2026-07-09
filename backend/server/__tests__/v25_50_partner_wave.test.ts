/**
 * v25.50.0 Consortium Partner wave — focused integration tests over REAL routes.
 *
 * Coverage (build-brief Gate 5):
 *   - Pipeline stage advance incl. skip (PATCH stage forward + multi-stage skip)
 *   - Private Portfolio CRUD (create/read/update/delete over real routes)
 *   - SPV create with the Phase-4 fields (distributionScope, targetRaiseMinor…)
 *   - Distribution-scope visibility + co-investor (lp_visibility) enforcement
 *   - Clients-deletion-safe attribution/commission wiring (admin routes intact)
 *   - Team real-name JOIN (GET /team merges canonical users identity)
 *   - Settings dropdown persistence (country / regionCode / payout currency)
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox, TEST_PARTNER_ID, TEST_PARTNER_USERS } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";

const MANAGING = TEST_PARTNER_USERS.managing.userId; // u_avi_managing
const VIEWER = TEST_PARTNER_USERS.viewer.userId; // u_avi_viewer
const ADMIN = "u_admin";

let app: express.Express;

function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}
function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}
function del(path: string, user: string) {
  return request(app).delete(path).set("x-user-id", user);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest?.();
  // Team real-name JOIN reads the canonical `users` table. The sandbox seeds an
  // in-memory team roster but not necessarily a users row — insert one so the
  // JOIN has an identity to merge. Columns per migration 0000.
  const now = new Date().toISOString();
  try {
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, avatar_url)
         VALUES (?, 'tenant_platform', ?, ?, 'user', NULL)`,
      )
      .run(MANAGING, TEST_PARTNER_USERS.managing.email, TEST_PARTNER_USERS.managing.name);
  } catch {
    /* users table shape drift — the JOIN is defensive (try/catch) either way */
  }
});

describe("v25.50 — pipeline stage advance incl. skip", () => {
  let dealId: string;
  it("creates a deal at the initial stage", async () => {
    const r = await post("/api/partner/me/pipeline", MANAGING, { dealName: "Wave Deal", stage: "invited" });
    expect(r.status).toBe(201);
    dealId = r.body.deal.id;
    expect(r.body.deal.stage).toBe("invited");
  });
  it("advances one stage forward", async () => {
    const r = await patch(`/api/partner/me/pipeline/${dealId}`, MANAGING, { stage: "viewed" });
    expect(r.status).toBe(200);
    expect(r.body.deal.stage).toBe("viewed");
  });
  it("SKIPS multiple stages ahead in a single patch", async () => {
    const r = await patch(`/api/partner/me/pipeline/${dealId}`, MANAGING, { stage: "committed" });
    expect(r.status).toBe(200);
    expect(r.body.deal.stage).toBe("committed");
  });
});

describe("v25.50 — Private Portfolio CRUD (real routes)", () => {
  const companyId = "co_wave_portfolio_test";
  it("CREATE/UPSERT a private portfolio profile (managing_partner)", async () => {
    const r = await patch(`/api/partner/me/portfolio/${companyId}`, MANAGING, {
      legal: { legalEntityName: "Wave Holdings Ltd" },
    });
    expect(r.status).toBe(200);
    expect(r.body.profile.legal.legalEntityName).toBe("Wave Holdings Ltd");
  });
  it("READ the single profile back", async () => {
    const r = await get(`/api/partner/me/portfolio/${companyId}`, MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.profile.legal.legalEntityName).toBe("Wave Holdings Ltd");
  });
  it("READ the list surface includes the company", async () => {
    const r = await get("/api/partner/me/portfolio", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.portfolio.some((p: any) => p.companyId === companyId)).toBe(true);
  });
  it("UPDATE merges new fields", async () => {
    const r = await patch(`/api/partner/me/portfolio/${companyId}`, MANAGING, {
      legal: { businessNumber: "BN-42" },
    });
    expect(r.status).toBe(200);
    expect(r.body.profile.legal.legalEntityName).toBe("Wave Holdings Ltd");
    expect(r.body.profile.legal.businessNumber).toBe("BN-42");
  });
  it("DELETE (soft) succeeds and viewer is blocked from writing", async () => {
    const denied = await patch(`/api/partner/me/portfolio/${companyId}`, VIEWER, { legal: { legalEntityName: "x" } });
    expect(denied.status).toBe(403);
    const r = await del(`/api/partner/me/portfolio/${companyId}`, MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

describe("v25.50 — SPV create with new fields + scope/co-investor enforcement", () => {
  let privateSpvId: string;
  let networkSpvId: string;
  it("creates a PRIVATE SPV with Phase-4 fields", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Private Wave SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "private",
      status: "open",
      targetRaiseMinor: 5_000_00,
      minCheckMinor: 25_00,
      currency: "USD",
      lpVisibility: "own_only",
    });
    expect(r.status).toBe(201);
    privateSpvId = r.body.spv.id;
    expect(r.body.spv.distributionScope).toBe("private");
    expect(r.body.spv.targetRaiseMinor).toBe(5_000_00);
    expect(r.body.spv.lpVisibility).toBe("own_only");
  });
  it("rejects an invalid distribution scope (fail-closed)", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Bad Scope SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "totally_public",
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
  it("creates a NETWORK-scoped SPV", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Network Wave SPV",
      jurisdiction: "delaware",
      carryBasis: "per_deployment",
      distributionScope: "network",
      status: "open",
      currency: "USD",
    });
    expect(r.status).toBe(201);
    networkSpvId = r.body.spv.id;
  });
  it("collective context HIDES the private SPV but SHOWS the network SPV", async () => {
    const r = await get("/api/collective/spvs", MANAGING);
    expect(r.status).toBe(200);
    const ids = r.body.spvs.map((s: any) => s.id);
    expect(ids).toContain(networkSpvId);
    expect(ids).not.toContain(privateSpvId);
  });
  it("write roles gate: viewer cannot create an SPV", async () => {
    const r = await post("/api/partner/me/spv", VIEWER, { spvName: "Viewer SPV" });
    expect(r.status).toBe(403);
  });
});

describe("v25.50 REVISE R2 — mandate mode round-trip + mandate description enforcement", () => {
  const RULE_TREE = { op: "and", rules: [] };
  async function makeSpv(name: string) {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name,
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "private",
    });
    expect(r.status).toBe(201);
    return r.body.spv.id as string;
  }

  it("Blocker 1 — thesis_lp_approval mandate mode round-trips (stored === sent)", async () => {
    const spvId = await makeSpv("Thesis SPV");
    const put = await request(app)
      .put(`/api/partner/me/spv/${spvId}/mandate`)
      .set("x-user-id", MANAGING)
      .send({ mode: "thesis_lp_approval", ruleTree: RULE_TREE });
    expect(put.status).toBe(200);
    expect(put.body.mandate.mode).toBe("thesis_lp_approval");
    const r = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(r.body.mandate.mode).toBe("thesis_lp_approval");
  });

  it("Blocker 1 — sector_restricted mandate mode round-trips (stored === sent)", async () => {
    const spvId = await makeSpv("Sector SPV");
    const put = await request(app)
      .put(`/api/partner/me/spv/${spvId}/mandate`)
      .set("x-user-id", MANAGING)
      .send({ mode: "sector_restricted", ruleTree: RULE_TREE });
    expect(put.status).toBe(200);
    expect(put.body.mandate.mode).toBe("sector_restricted");
    const r = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(r.body.mandate.mode).toBe("sector_restricted");
  });

  it("Blocker 1 — an unrecognized mandate mode is REJECTED fail-closed (not coerced)", async () => {
    const spvId = await makeSpv("Bad Mode SPV");
    const put = await request(app)
      .put(`/api/partner/me/spv/${spvId}/mandate`)
      .set("x-user-id", MANAGING)
      .send({ mode: "totally_made_up", ruleTree: RULE_TREE });
    expect(put.status).toBeGreaterThanOrEqual(400);
  });

  it("Blocker 2 — createSpv with EMPTY mandateDescription is REJECTED", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Empty Mandate SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "private",
      status: "open",
      terms: { mandateDescription: "   " },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("Blocker 2 — createSpv with >1200-char mandateDescription is REJECTED", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Too Long Mandate SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "private",
      status: "open",
      terms: { mandateDescription: "x".repeat(1201) },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("Blocker 2 — createSpv with a valid mandateDescription SUCCEEDS", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Valid Mandate SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "private",
      status: "open",
      terms: { mandateDescription: "Fintech seed-stage companies in North America." },
    });
    expect(r.status).toBe(201);
  });

  it("R3 — updateSpv REJECTS whitespacing-out an existing mandate description (fail-closed)", async () => {
    const create = await post("/api/partner/me/spv", MANAGING, {
      name: "Patchable Mandate SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "private",
      status: "open",
      terms: { mandateDescription: "AI infra companies, Series A." },
    });
    expect(create.status).toBe(201);
    const spvId = create.body.spv.id as string;

    const blanked = await patch(`/api/partner/me/spv/${spvId}`, MANAGING, {
      terms: { mandateDescription: "   " },
    });
    expect(blanked.status).toBe(400);

    const tooLong = await patch(`/api/partner/me/spv/${spvId}`, MANAGING, {
      terms: { mandateDescription: "x".repeat(1201) },
    });
    expect(tooLong.status).toBe(400);

    // Rejected patches must not have mutated the stored description.
    const after = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(after.body.spv.terms.mandateDescription).toBe("AI infra companies, Series A.");
  });

  it("R3 — updateSpv allows a partial patch that does NOT touch mandateDescription", async () => {
    const create = await post("/api/partner/me/spv", MANAGING, {
      name: "Untouched Mandate SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      distributionScope: "private",
      status: "open",
      terms: { mandateDescription: "Climate hardware, seed." },
    });
    expect(create.status).toBe(201);
    const spvId = create.body.spv.id as string;
    const r = await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { name: "Renamed SPV" });
    expect(r.status).toBe(200);
    expect(r.body.spv.name).toBe("Renamed SPV");
  });
});

describe("v25.50 — Clients-deletion-safe attribution/commission wiring", () => {
  const companyId = "co_attribution_wave";
  it("admin can CREATE an attribution (wiring preserved after Clients page removal)", async () => {
    const r = await post(`/api/admin/partners/${TEST_PARTNER_ID}/attributions`, ADMIN, {
      companyId,
      source: "admin_manual",
    });
    expect(r.status).toBe(201);
    expect(r.body.attribution.companyId).toBe(companyId);
  });
  it("admin can REVOKE the attribution", async () => {
    const r = await del(`/api/admin/partners/${TEST_PARTNER_ID}/attributions/${companyId}`, ADMIN);
    expect(r.status).toBe(200);
  });
  it("non-admin is blocked from the attribution admin route", async () => {
    const r = await post(`/api/admin/partners/${TEST_PARTNER_ID}/attributions`, MANAGING, { companyId });
    expect([401, 403]).toContain(r.status);
  });
});

describe("v25.50 — Team real-name JOIN + contact overrides", () => {
  it("GET /team merges the canonical users identity (real name, not raw id)", async () => {
    const r = await get("/api/partner/me/team", MANAGING);
    expect(r.status).toBe(200);
    const mp = r.body.members.find((m: any) => m.userId === MANAGING);
    expect(mp).toBeTruthy();
    expect(mp.name).toBe(TEST_PARTNER_USERS.managing.name);
    expect(mp.email).toBe(TEST_PARTNER_USERS.managing.email);
  });
  it("GROUP-D — every member name is non-null and never a raw synthetic id", () => {
    return get("/api/partner/me/team", MANAGING).then((r) => {
      expect(r.status).toBe(200);
      expect(r.body.members.length).toBeGreaterThan(0);
      for (const m of r.body.members) {
        expect(m.name).not.toBeNull();
        expect(typeof m.name).toBe("string");
        expect(m.name).not.toMatch(/^u_/);
      }
    });
  });
  it("managing_partner can PATCH a member contact override; it round-trips", async () => {
    const up = await patch(`/api/partner/me/team/${MANAGING}/contact`, MANAGING, {
      mobile: "+1-555-0100",
      positionNote: "Managing Partner",
    });
    expect(up.status).toBe(200);
    const r = await get("/api/partner/me/team", MANAGING);
    const mp = r.body.members.find((m: any) => m.userId === MANAGING);
    expect(mp.mobile).toBe("+1-555-0100");
    expect(mp.positionNote).toBe("Managing Partner");
  });
  it("viewer cannot PATCH a member contact (managing_partner gate)", async () => {
    const r = await patch(`/api/partner/me/team/${MANAGING}/contact`, VIEWER, { mobile: "x" });
    expect(r.status).toBe(403);
  });
});

describe("v25.50 — Settings dropdown persistence", () => {
  it("PATCH workspace-settings persists country / regionCode / payout currency", async () => {
    const up = await patch("/api/partner/me/workspace-settings", MANAGING, {
      country: "CA",
      regionCode: "CA",
      preferredPayoutCurrency: "CAD",
      legalName: "Wave Partners Inc",
    });
    expect(up.status).toBe(200);
    const r = await get("/api/partner/me/workspace-settings", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.settings.country).toBe("CA");
    expect(r.body.settings.regionCode).toBe("CA");
    expect(r.body.settings.preferredPayoutCurrency).toBe("CAD");
    expect(r.body.settings.legalName).toBe("Wave Partners Inc");
  });
});
