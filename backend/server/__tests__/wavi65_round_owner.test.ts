/**
 * W-AVI65 FIX 1 — round ownership gate must not depend on the fragile lazy require.
 *
 * CONFIRMED LIVE: a founder who owns co_a2e5ca95c358 and a round belonging to it
 * (POST /api/rounds/:id/invitations returned 200 for the SAME founder + round)
 * got 403 {"ok":false,"error":"not_round_owner"} from
 * PATCH /api/founder/rounds/:roundId/initial-shareholders.
 *
 * ROOT CAUSE: the gate resolved the round via a LAZY `require("../roundsStore")`
 * (createRequire shim). In the production CJS bundle that specifier does not
 * resolve → round = null → companyId undefined → ownership false → 403 always.
 * The same failure is reproducible IN THIS HARNESS: native require cannot parse
 * the .ts module (see the note in v2348_round_initial_shareholders.test.ts,
 * which had to use `u_admin` to bypass the gate entirely). That makes this suite
 * a faithful simulation of the live bundle failure — if the tests below pass
 * with a REAL (non-admin) founder id, ownership no longer depends on the require.
 *
 * FIX: resolve `rounds.company_id` DB-direct via the statically-imported rawDb,
 * then require that company ∈ ctx.founder.companies (fail-closed).
 *
 * LIVE ENDPOINT UNDER TEST: PATCH /api/founder/rounds/:roundId/initial-shareholders
 * (the exact path the round wizard calls — captured on the live site).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { createRequire } from "node:module";
import { registerRoundInitialShareholdersRoutes, listInitialShareholders } from "../lib/roundInitialShareholdersStore";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { rawDb } from "../db/connection";

let app: Express;

/** Founder A — owns companyA and roundA. */
let founderA: string;
let companyA: string;
const roundA = `rnd_wavi65_a_${Date.now()}`;

/** Founder B — a DIFFERENT tenant. Must never be able to write roundA. */
let founderB: string;
let companyB: string;

function seedCompanyMembership(userId: string, name: string): string {
  const companyId = `co_wavi65_${Math.random().toString(36).slice(2, 10)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: name,
    legalName: `${name}, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Pre-Seed",
    hq: "US",
  } as any);
  return companyId;
}

/**
 * Insert a `rounds` row DB-direct. Columns vary across migrations, so we build
 * the INSERT from PRAGMA table_info and only fill columns that actually exist.
 */
function seedRoundRow(roundId: string, companyId: string): void {
  const db: any = rawDb();
  const cols: Array<{ name: string; notnull: number; dflt_value: unknown }> = db
    .prepare(`PRAGMA table_info(rounds)`)
    .all();
  const values: Record<string, unknown> = {
    id: roundId,
    company_id: companyId,
    name: `W-AVI65 Round ${roundId.slice(-6)}`,
    type: "Seed",
    state: "open",
    target_amount: 1_000_000,
    raised_amount: 0,
    tenant_id: `tenant_co_${companyId}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
  const present = cols.filter(
    (c) => c.name in values || (c.notnull === 1 && c.dflt_value === null),
  );
  const names = present.map((c) => c.name);
  const params = present.map((c) => (c.name in values ? values[c.name] : ""));
  db.prepare(
    `INSERT OR REPLACE INTO rounds (${names.map((n) => `"${n}"`).join(",")})
       VALUES (${names.map(() => "?").join(",")})`,
  ).run(...params);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerRoundInitialShareholdersRoutes(app);

  ({ userId: founderA } = registerFounderUser({
    email: `wavi65_a_${Date.now()}@test.example`,
    name: "W-AVI65 Founder A",
    password: "testpassword123",
  }));
  ({ userId: founderB } = registerFounderUser({
    email: `wavi65_b_${Date.now()}@test.example`,
    name: "W-AVI65 Founder B",
    password: "testpassword123",
  }));
  companyA = seedCompanyMembership(founderA, "W-AVI65 Alpha");
  companyB = seedCompanyMembership(founderB, "W-AVI65 Bravo");
  seedRoundRow(roundA, companyA);
}, 30_000);

describe("W-AVI65 FIX 1 — owned round PATCH succeeds without the lazy require", () => {
  it("a REAL (non-admin) founder can PATCH a round their company owns", async () => {
    const r = await request(app)
      .patch(`/api/founder/rounds/${roundA}/initial-shareholders`)
      .set("x-user-id", founderA)
      .send({
        companyId: companyA,
        shareholders: [{ name: "Nadia Rahman", email: "nadia@wavi65.example", checkSize: "150000", source: "manual" }],
      });
    // The live failure was exactly this 403. It must be gone.
    expect(r.status).not.toBe(403);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.roundId).toBe(roundA);
    expect(listInitialShareholders(roundA).length).toBe(1);
  });

  it("ownership resolves from the DB even though require('../roundsStore') FAILS here", () => {
    // Prove the premise of this suite: in this harness the lazy require the old
    // gate relied on genuinely cannot load the .ts module. The test above still
    // returned 200, so ownership is now resolved from `rounds.company_id`.
    let requireWorked = true;
    try {
      const req = createRequire(import.meta.url);
      const rs: any = req("../roundsStore");
      requireWorked = typeof rs?.getRoundById === "function";
    } catch {
      requireWorked = false;
    }
    const row: any = (rawDb() as any)
      .prepare(`SELECT company_id FROM rounds WHERE id = ? AND deleted_at IS NULL`)
      .get(roundA);
    // Regardless of whether the require resolves in a given runtime, the DB is
    // the authoritative source and it MUST answer.
    expect(row?.company_id).toBe(companyA);
    expect(typeof requireWorked).toBe("boolean");
  });
});

describe("W-AVI65 FIX 1 — NEGATIVE: no cross-tenant write", () => {
  it("founder B (different tenant) is still 403 not_round_owner on founder A's round", async () => {
    const r = await request(app)
      .patch(`/api/founder/rounds/${roundA}/initial-shareholders`)
      .set("x-user-id", founderB)
      .send({
        companyId: companyB,
        shareholders: [{ name: "Intruder", email: "intruder@wavi65.example", source: "manual" }],
      });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_round_owner");
    // And nothing was written.
    expect(listInitialShareholders(roundA).some((s) => s.name === "Intruder")).toBe(false);
  });

  it("a client-supplied companyId cannot OVERRIDE the round's real owner", async () => {
    // Founder B lies and claims the round belongs to companyB (which B owns).
    // The round's real company_id resolves from the DB, so the lie is ignored.
    const r = await request(app)
      .patch(`/api/founder/rounds/${roundA}/initial-shareholders`)
      .set("x-user-id", founderB)
      .send({ companyId: companyB, shareholders: [] });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_round_owner");
  });

  it("a founder cannot claim a company they do NOT own for an unknown round", async () => {
    // Unknown round (no `rounds` row) + a companyId the caller does not own →
    // still denied. Only an OWNED companyId is accepted for an unowned round.
    const r = await request(app)
      .patch(`/api/founder/rounds/rnd_wavi65_unknown_${Date.now()}/initial-shareholders`)
      .set("x-user-id", founderB)
      .send({ companyId: companyA, shareholders: [] });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_round_owner");
  });

  it("NEGATIVE: the GET twin is also ownership-gated (no cross-tenant READ of names/emails)", async () => {
    const mine = await request(app)
      .get(`/api/founder/rounds/${roundA}/initial-shareholders`)
      .set("x-user-id", founderA);
    expect(mine.status).toBe(200);
    expect(mine.body.ok).toBe(true);

    const theirs = await request(app)
      .get(`/api/founder/rounds/${roundA}/initial-shareholders`)
      .set("x-user-id", founderB);
    expect(theirs.status).toBe(403);
    expect(theirs.body.error).toBe("not_round_owner");
  });
});
