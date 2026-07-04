/**
 * v25.49 Phase-4B — per-SPV LP co-investor visibility toggle (Ozan decision #5).
 *
 * FAIL-CLOSED SERVER-SIDE contract for the LP-context roster
 * (GET /api/spv/:spvId/lp-roster, spvEngineStore.lpRosterForViewer):
 *   - default `own_only`: LP A sees ONLY their own position, never LP B;
 *   - `co_investors`: LP A sees the co-investor (LP B) too;
 *   - the FOUNDER/target is NOT a subscriber → NOT_AN_LP (403) in BOTH modes;
 *     the LP roster is NEVER exposed to the founder (Private Investor contract);
 *   - the GP still sees the FULL roster via its own partner detail route.
 *
 * Plus: migration 0085 idempotency — the additive ADD COLUMN is a no-op on
 * re-run (SQLite duplicate-column error is expected + swallowed), so lp_visibility
 * exists exactly once with DEFAULT 'own_only'.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { __setRuntimePersona } from "../lib/userContext";

const MANAGING = "u_avi_managing";
const LP_A = "u_lp_a";
const LP_B = "u_lp_b";
const FOUNDER = "u_founder_x";

let app: express.Express;

function post(p: string, user: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", user).send(body ?? {});
}
function get(p: string, user: string) {
  return request(app).get(p).set("x-user-id", user);
}

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open", minCheckMinor: 1000, ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/** Seed two LPs onto an SPV via the GP subscription route. */
async function seedTwoLps(spvId: string): Promise<void> {
  const a = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId: LP_A, commitmentMinor: 30000 });
  expect(a.status).toBe(201);
  const b = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId: LP_B, commitmentMinor: 10000 });
  expect(b.status).toBe(201);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  // LPs + a founder need authenticated identities for the investor-context route.
  __setRuntimePersona({ userId: LP_A, email: "lpa@test.local", name: "LP A", isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
  __setRuntimePersona({ userId: LP_B, email: "lpb@test.local", name: "LP B", isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
  __setRuntimePersona({ userId: FOUNDER, email: "founder@test.local", name: "Founder X", isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });
});

describe("SPV LP-visibility — default own_only", () => {
  it("defaults to own_only on create", async () => {
    const id = await createSpv("Own Only SPV");
    const r = await get(`/api/partner/me/spv/${id}`, MANAGING);
    expect(r.body.spv.lpVisibility).toBe("own_only");
  });

  it("LP A sees ONLY their own position, NEVER LP B", async () => {
    const id = await createSpv("Own Only Roster SPV");
    await seedTwoLps(id);
    const r = await get(`/api/spv/${id}/lp-roster`, LP_A);
    expect(r.status).toBe(200);
    expect(r.body.lpVisibility).toBe("own_only");
    const ids = r.body.entries.map((e: any) => e.investorId);
    expect(ids).toEqual([LP_A]);
    expect(ids).not.toContain(LP_B);
    expect(r.body.entries[0].isSelf).toBe(true);
  });
});

describe("SPV LP-visibility — co_investors", () => {
  it("LP A CAN see co-investor LP B", async () => {
    const id = await createSpv("Club Deal SPV", { lpVisibility: "co_investors" });
    await seedTwoLps(id);
    const r = await get(`/api/spv/${id}/lp-roster`, LP_A);
    expect(r.status).toBe(200);
    expect(r.body.lpVisibility).toBe("co_investors");
    const ids = r.body.entries.map((e: any) => e.investorId).sort();
    expect(ids).toEqual([LP_A, LP_B].sort());
    expect(r.body.entries.find((e: any) => e.investorId === LP_A).isSelf).toBe(true);
    expect(r.body.entries.find((e: any) => e.investorId === LP_B).isSelf).toBe(false);
  });

  it("toggling via PATCH flips visibility server-side", async () => {
    const id = await createSpv("Toggle SPV");
    await seedTwoLps(id);
    let r = await get(`/api/spv/${id}/lp-roster`, LP_A);
    expect(r.body.entries.map((e: any) => e.investorId)).toEqual([LP_A]);
    await request(app).patch(`/api/partner/me/spv/${id}`).set("x-user-id", MANAGING).send({ lpVisibility: "co_investors" });
    r = await get(`/api/spv/${id}/lp-roster`, LP_A);
    expect(r.body.entries.map((e: any) => e.investorId).sort()).toEqual([LP_A, LP_B].sort());
  });
});

describe("SPV LP-visibility — founder NEVER sees roster; GP sees full", () => {
  it("founder is refused the LP roster in own_only mode → 403 NOT_AN_LP", async () => {
    const id = await createSpv("Founder Own Only SPV");
    await seedTwoLps(id);
    const r = await get(`/api/spv/${id}/lp-roster`, FOUNDER);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_AN_LP");
  });

  it("founder is refused the LP roster in co_investors mode too → 403 NOT_AN_LP", async () => {
    const id = await createSpv("Founder Club SPV", { lpVisibility: "co_investors" });
    await seedTwoLps(id);
    const r = await get(`/api/spv/${id}/lp-roster`, FOUNDER);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_AN_LP");
  });

  it("GP sees the FULL roster via its own partner detail route (both modes)", async () => {
    const own = await createSpv("GP Own Only SPV");
    await seedTwoLps(own);
    const r1 = await get(`/api/partner/me/spv/${own}`, MANAGING);
    expect(r1.body.register.map((e: any) => e.investorId).sort()).toEqual([LP_A, LP_B].sort());

    const club = await createSpv("GP Club SPV", { lpVisibility: "co_investors" });
    await seedTwoLps(club);
    const r2 = await get(`/api/partner/me/spv/${club}`, MANAGING);
    expect(r2.body.register.map((e: any) => e.investorId).sort()).toEqual([LP_A, LP_B].sort());
  });

  it("invalid lp_visibility on create → 400 INVALID_LP_VISIBILITY", async () => {
    const r = await post("/api/partner/me/spv", MANAGING, {
      name: "Bad Vis SPV", jurisdiction: "delaware", carryBasis: "whole_spv", lpVisibility: "everyone",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_LP_VISIBILITY");
  });
});

describe("Migration 0085 — additive + idempotent ADD COLUMN", () => {
  it("running the ALTER twice is a no-op (column exists exactly once, default own_only)", () => {
    const sqlPath = path.resolve(__dirname, "../../migrations/0085_v25_49_spv_lp_visibility.sql");
    const alter = fs
      .readFileSync(sqlPath, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--") && l.trim().length > 0)
      .join("\n");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE spv (id TEXT PRIMARY KEY NOT NULL, carry_basis TEXT NOT NULL);");

    const apply = () => {
      try {
        db.exec(alter);
      } catch (e) {
        // Idempotent guard mirrors the migration runner / connection.ts bootstrap:
        // a duplicate-column error on re-run is expected and safe to swallow.
        if (!/duplicate column name/i.test((e as Error).message)) throw e;
      }
    };
    apply();
    apply(); // second run = no-op

    const cols = (db.prepare("PRAGMA table_info(spv)").all() as Array<{ name: string; dflt_value: string | null }>)
      .filter((c) => c.name === "lp_visibility");
    expect(cols.length).toBe(1);
    expect(String(cols[0].dflt_value).replace(/'/g, "")).toBe("own_only");

    db.prepare("INSERT INTO spv (id, carry_basis) VALUES ('spv_x', 'whole_spv')").run();
    const row = db.prepare("SELECT lp_visibility FROM spv WHERE id = 'spv_x'").get() as { lp_visibility: string };
    expect(row.lp_visibility).toBe("own_only");
    db.close();
  });
});
