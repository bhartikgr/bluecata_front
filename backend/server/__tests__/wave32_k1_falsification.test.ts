/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 3 — K-1 FALSIFICATION.
 *
 * A K-1 is a tax filing, so the central claim under test is NOT "the arithmetic
 * is right" but "the engine refuses rather than invents". Every refusal case
 * therefore asserts BOTH POLES: the blank appears when the data is missing AND
 * a real figure appears when the data is present — otherwise a harness would
 * pass just as happily against an engine that returns null for everything.
 *
 * Part A — the pure engine.
 * Part B — the persisted statement and the routes, including the LP privacy
 *          probe with a REAL-BUT-WRONG identity (rule 3).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

/* THE PROBE MUST MATCH THE CONTROL (rule 3). The investor identity is injected
   so a probe can present a REAL, fully authenticated identity that simply does
   not own the data — anonymity would be a different, weaker test.
 *
 * `CURRENT.override` is a three-state switch, not a boolean:
 *   undefined -> defer to the REAL `getUserContext`, so GP/admin fixture calls
 *                authenticate exactly as they do in production;
 *   a string  -> that investor is the session;
 *   null      -> genuinely anonymous, for the 401 pole.
 * Collapsing this to "string or anonymous" is what broke the fixture setup:
 * the admin distribution write needs a real session too. */
const CURRENT: { override?: string | null } = {};
vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/userContext")>();
  return {
    ...actual,
    getUserContext: (req: any) =>
      CURRENT.override === undefined
        ? (actual as any).getUserContext(req)
        : CURRENT.override === null
          ? null
          : { isAuthed: true, userId: CURRENT.override },
  };
});

import { computeK1Statements, type K1ComputeArgs } from "../lib/spvK1";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvK1Routes } from "../spvK1Routes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { ensureK1SchemaForTests, deriveK1s, generateK1Drafts, issueK1, listK1s } from "../spvK1Store";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";
const SETTLE = { settlementOutcome: "succeeded", settlementReason: "wave32 k1 fixture" };
let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function put(path: string, user: string, body?: unknown) {
  return request(app).put(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user?: string) {
  const r = request(app).get(path);
  return user ? r.set("x-user-id", user) : r;
}

async function commitLp(spvId: string, investorId: string, commitmentMinor: number) {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, {
    kycStatus: "verified", accreditationStatus: "self_certified",
  });
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`, MANAGING, {
    to: "committed", subscriptionDocRef: `sig_${investorId}`,
  });
  expect(adv.status).toBe(200);
}

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "per_deployment", status: "open",
    signoffLegalName: "Avi Managing", signoffAccepted: true, ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvK1Routes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureK1SchemaForTests();
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART A — THE PURE ENGINE
 * ═════════════════════════════════════════════════════════════════════════ */

function args(over: Partial<K1ComputeArgs> = {}): K1ComputeArgs {
  return {
    spvId: "spv_k1",
    taxYear: 2025,
    vehicleCurrency: "USD",
    register: [
      { investorId: "lp_a", commitmentMinor: 600_000 },
      { investorId: "lp_b", commitmentMinor: 400_000 },
    ],
    distributions: [],
    contributions: [],
    ...over,
  };
}

function dist(over: Partial<import("../lib/spvK1").K1DistributionInput> = {}) {
  return {
    id: "d1",
    createdAt: "2025-06-01T00:00:00.000Z",
    currency: "USD",
    grossProceedsMinor: 1_000_000,
    realizedProfitMinor: 400_000,
    allocations: [
      { investorId: "lp_a", grossMinor: 600_000, carryMinor: 48_000, netMinor: 552_000 },
      { investorId: "lp_b", grossMinor: 400_000, carryMinor: 32_000, netMinor: 368_000 },
    ],
    ...over,
  };
}

describe("W32-C3 / A — the K-1 engine refuses rather than invents", () => {
  it("A1 no confirmed capital receipt → contributions is NULL with a named refusal, NEVER the commitment", () => {
    const out = computeK1Statements(args());
    const a = out.find((k) => k.investorId === "lp_a")!;
    expect(a.contributionsMinor).toBeNull();
    expect(a.contributionsMinor).not.toBe(0);
    expect(a.contributionsMinor).not.toBe(600_000);   // the commitment, NOT cash
    expect(a.refusals.map((r) => r.code)).toContain("NO_FUNDS_CONFIRMATION");
    expect(a.refusals.find((r) => r.field === "contributionsMinor")!.copy).toMatch(/commitment is not a contribution/i);

    /* THE OTHER POLE. Give the same LP a real confirmed receipt and the box
       fills with the real figure — so A1 is not passing because the engine
       returns null unconditionally. */
    const withCash = computeK1Statements(args({
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-03-01T00:00:00.000Z", receivedMinor: 600_000 }],
    }));
    const a2 = withCash.find((k) => k.investorId === "lp_a")!;
    expect(a2.contributionsMinor).toBe(600_000);
    expect(a2.refusals.map((r) => r.code)).not.toContain("NO_FUNDS_CONFIRMATION");
  });

  it("A2 unknown contributions poison beginning AND ending capital — a partial roll-forward is a WRONG figure", () => {
    const out = computeK1Statements(args({ distributions: [dist()] }));
    const a = out.find((k) => k.investorId === "lp_a")!;
    expect(a.beginningCapitalMinor).toBeNull();
    expect(a.endingCapitalMinor).toBeNull();
    expect(a.refusals.map((r) => r.field)).toEqual(
      expect.arrayContaining(["beginningCapitalMinor", "endingCapitalMinor"]),
    );
    // But the boxes that ARE derivable are still filled — the statement is not
    // abandoned wholesale just because one input is missing.
    expect(a.distributionsMinor).toBe(552_000);
    expect(a.carryAllocatedMinor).toBe(48_000);
  });

  it("A3 the roll-forward is exact when every input is real", () => {
    const out = computeK1Statements(args({
      distributions: [
        dist({ id: "d0", createdAt: "2024-06-01T00:00:00.000Z", realizedProfitMinor: 100_000 }),
        dist({ id: "d1", createdAt: "2025-06-01T00:00:00.000Z", realizedProfitMinor: 400_000 }),
      ],
      contributions: [
        { investorId: "lp_a", confirmedAt: "2024-01-15T00:00:00.000Z", receivedMinor: 600_000 },
        { investorId: "lp_b", confirmedAt: "2024-01-15T00:00:00.000Z", receivedMinor: 400_000 },
      ],
    }));
    const a = out.find((k) => k.investorId === "lp_a")!;
    // Prior year: contributed 600,000, income 60% of 100,000 = 60,000,
    // distributed 552,000  ->  beginning 108,000.
    expect(a.beginningCapitalMinor).toBe(108_000);
    expect(a.contributionsMinor).toBe(0);                 // a REAL zero: cash came in 2024
    expect(a.allocatedIncomeMinor).toBe(240_000);         // 60% of 400,000
    expect(a.distributionsMinor).toBe(552_000);
    expect(a.endingCapitalMinor).toBe(108_000 + 0 + 240_000 - 552_000);
    expect(a.refusals).toEqual([]);                       // nothing left unexplained
  });

  it("A4 allocated income sums EXACTLY to the vehicle's realized profit — no cent created or lost", () => {
    const out = computeK1Statements(args({
      register: [
        { investorId: "lp_a", commitmentMinor: 1 },
        { investorId: "lp_b", commitmentMinor: 1 },
        { investorId: "lp_c", commitmentMinor: 1 },
      ],
      distributions: [dist({
        realizedProfitMinor: 100,
        allocations: [
          { investorId: "lp_a", grossMinor: 334, carryMinor: 0, netMinor: 334 },
          { investorId: "lp_b", grossMinor: 333, carryMinor: 0, netMinor: 333 },
          { investorId: "lp_c", grossMinor: 333, carryMinor: 0, netMinor: 333 },
        ],
      })],
      contributions: [
        { investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 1 },
        { investorId: "lp_b", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 1 },
        { investorId: "lp_c", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 1 },
      ],
    }));
    const sum = out.reduce((a, k) => a + (k.allocatedIncomeMinor ?? 0), 0);
    expect(sum).toBe(100);
    expect(out.map((k) => k.allocatedIncomeMinor)).toEqual([34, 33, 33]);
  });

  it("A5 a LOSS is allocated as a negative figure, not clamped to zero", () => {
    const out = computeK1Statements(args({
      distributions: [dist({ realizedProfitMinor: -200_000 })],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    }));
    const a = out.find((k) => k.investorId === "lp_a")!;
    expect(a.allocatedIncomeMinor).toBe(-120_000);   // 60% of the loss
    expect(a.allocatedIncomeMinor).toBeLessThan(0);
  });

  it("A6 a distribution that does not state its realized profit blanks the income box, never zeroes it", () => {
    const out = computeK1Statements(args({
      distributions: [dist({ realizedProfitMinor: null })],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    }));
    const a = out.find((k) => k.investorId === "lp_a")!;
    expect(a.allocatedIncomeMinor).toBeNull();
    expect(a.endingCapitalMinor).toBeNull();
    expect(a.refusals.map((r) => r.code)).toContain("UNKNOWN_REALIZED_PROFIT");
    // POLE: state the profit and both boxes fill.
    const known = computeK1Statements(args({
      distributions: [dist({ realizedProfitMinor: 400_000 })],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    })).find((k) => k.investorId === "lp_a")!;
    expect(known.allocatedIncomeMinor).toBe(240_000);
    expect(known.endingCapitalMinor).not.toBeNull();
  });

  it("A7 MIXED CURRENCY refuses the entire statement — minor units are never summed across currencies", () => {
    const out = computeK1Statements(args({
      distributions: [dist({ id: "d_usd", currency: "USD" }), dist({ id: "d_jpy", currency: "JPY" })],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    }));
    for (const k of out) {
      expect(k.distributionsMinor).toBeNull();
      expect(k.endingCapitalMinor).toBeNull();
      expect(k.refusals.every((r) => r.code === "MIXED_CURRENCY")).toBe(true);
    }
  });

  it("A8 JPY fixture — a zero-decimal vehicle computes in whole yen with no phantom subunit", () => {
    const out = computeK1Statements(args({
      vehicleCurrency: "JPY",
      distributions: [dist({
        currency: "JPY", grossProceedsMinor: 1_000_000, realizedProfitMinor: 400_000,
      })],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    }));
    const a = out.find((k) => k.investorId === "lp_a")!;
    expect(a.currency).toBe("JPY");
    expect(a.allocatedIncomeMinor).toBe(240_000);      // ¥240,000
    expect(a.distributionsMinor).toBe(552_000);        // ¥552,000
    expect(a.endingCapitalMinor).toBe(600_000 + 240_000 - 552_000);
    // The identical minor-unit inputs in USD must agree exactly; a hidden /100
    // or a hardcoded exponent 2 would make exactly one of the two wrong.
    const usd = computeK1Statements(args({
      distributions: [dist()],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    })).find((k) => k.investorId === "lp_a")!;
    expect(a.allocatedIncomeMinor).toBe(usd.allocatedIncomeMinor);
    expect(a.endingCapitalMinor).toBe(usd.endingCapitalMinor);
  });

  it("A9 ownership is a FRACTION in [0,1], never a percent", () => {
    const out = computeK1Statements(args());
    expect(out.find((k) => k.investorId === "lp_a")!.ownershipFraction).toBeCloseTo(0.6, 12);
    expect(out.find((k) => k.investorId === "lp_b")!.ownershipFraction).toBeCloseTo(0.4, 12);
    for (const k of out) {
      expect(k.ownershipFraction!).toBeLessThanOrEqual(1);
      expect(k.ownershipFraction!).toBeGreaterThanOrEqual(0);
    }
    // An empty register refuses rather than dividing by zero into NaN/Infinity.
    const none = computeK1Statements(args({ register: [{ investorId: "lp_a", commitmentMinor: 0 }] }));
    expect(none[0].ownershipFraction).toBeNull();
    expect(none[0].refusals.map((r) => r.code)).toContain("NO_COMMITTED_REGISTER");
  });

  it("A10 only the tax year's events are counted — a later year cannot leak backwards", () => {
    const out = computeK1Statements(args({
      distributions: [
        dist({ id: "d_2025", createdAt: "2025-12-31T23:59:59.000Z" }),
        dist({ id: "d_2026", createdAt: "2026-01-01T00:00:01.000Z" }),
      ],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    }));
    const a = out.find((k) => k.investorId === "lp_a")!;
    expect(a.sourceIds).toEqual(["d_2025"]);
    expect(a.distributionsMinor).toBe(552_000);   // one event, not two
    // POLE: run the same data for 2026 and the OTHER event is the one counted.
    const y2026 = computeK1Statements(args({
      taxYear: 2026,
      distributions: [
        dist({ id: "d_2025", createdAt: "2025-12-31T23:59:59.000Z" }),
        dist({ id: "d_2026", createdAt: "2026-01-01T00:00:01.000Z" }),
      ],
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 }],
    })).find((k) => k.investorId === "lp_a")!;
    expect(y2026.sourceIds).toEqual(["d_2026"]);
  });

  it("A11 refusals is non-empty exactly when a box is null — a blank is always explained", () => {
    const cases = [
      computeK1Statements(args()),
      computeK1Statements(args({ distributions: [dist({ realizedProfitMinor: null })] })),
      computeK1Statements(args({
        distributions: [dist()],
        contributions: [
          { investorId: "lp_a", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 600_000 },
          { investorId: "lp_b", confirmedAt: "2025-01-01T00:00:00.000Z", receivedMinor: 400_000 },
        ],
      })),
    ].flat();
    for (const k of cases) {
      const boxes = [
        ["beginningCapitalMinor", k.beginningCapitalMinor],
        ["contributionsMinor", k.contributionsMinor],
        ["distributionsMinor", k.distributionsMinor],
        ["allocatedIncomeMinor", k.allocatedIncomeMinor],
        ["endingCapitalMinor", k.endingCapitalMinor],
        ["ownershipFraction", k.ownershipFraction],
      ] as const;
      const nullBoxes = boxes.filter(([, v]) => v === null).map(([n]) => n);
      const explained = new Set(k.refusals.map((r) => r.field));
      for (const n of nullBoxes) expect(explained.has(n)).toBe(true);
      // And every refusal carries server-authored copy, so the UI never has to
      // invent tax language of its own.
      for (const r of k.refusals) expect(r.copy.length).toBeGreaterThan(20);
    }
    // The both-poles half: a fully-derived statement carries NO refusals.
    const clean = cases.find((k) => k.refusals.length === 0);
    expect(clean).toBeTruthy();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART B — PERSISTENCE, ROUTES, AND LP PRIVACY
 * ═════════════════════════════════════════════════════════════════════════ */
describe("W32-C3 / B — persistence, routes and LP privacy", () => {
  let spvId: string;
  let otherSpvId: string;

  beforeAll(async () => {
    spvId = await createSpv("W32 K1 SPV");
    await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 });
    await commitLp(spvId, "inv_k1_a", 600_000);
    await commitLp(spvId, "inv_k1_b", 400_000);
    /* THE TEST ESTABLISHES ITS OWN PRECONDITIONS. If the distribution did not
       actually record, every downstream figure would be a vacuous zero and the
       assertions below would pass while checking nothing. */
    const distRes = await post(`/api/admin/consortium-spv/${spvId}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 1_000_000, costBasisMinor: 600_000, ...SETTLE,
    });
    expect(distRes.status).toBe(201);
    expect(
      (rawDb().prepare(`SELECT COUNT(*) AS n FROM spv_distribution WHERE spv_id = ?`).get(spvId) as any).n,
    ).toBe(1);
    otherSpvId = await createSpv("W32 K1 Other SPV");
    await commitLp(otherSpvId, "inv_k1_outsider", 100_000);
  });

  it("B0 the fixture distinguishes identities — the SAME url returns different bodies to two LPs", async () => {
    /* Wave 28's rate-limit suite passed 14/14 while every request collapsed to
       one anonymous identity. If that were happening here, this fails FIRST and
       every privacy assertion below is thereby known to be meaningful. */
    const year = new Date().getUTCFullYear();
    generateK1Drafts(spvId, year, "u_test");
    for (const s of listK1s(spvId, year)) issueK1(spvId, s.id);

    CURRENT.override = "inv_k1_a";
    const a = await get(`/api/investor/me/spv/${spvId}/k1`);
    CURRENT.override = "inv_k1_b";
    const b = await get(`/api/investor/me/spv/${spvId}/k1`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.statements[0].investorId).toBe("inv_k1_a");
    expect(b.body.statements[0].investorId).toBe("inv_k1_b");
    expect(JSON.stringify(a.body)).not.toBe(JSON.stringify(b.body));
  });

  it("B1 the derived figures are PERSISTED with nulls intact — a refusal survives the round trip", () => {
    const year = new Date().getUTCFullYear();
    const rows = generateK1Drafts(spvId, year, "u_test");
    expect(rows.length).toBe(2);
    const a = rows.find((r) => r.investorId === "inv_k1_a")!;
    // No offline funds confirmation exists for these LPs, so contributions and
    // the capital roll-forward must be stored as NULL, not as 0.
    expect(a.contributionsMinor).toBeNull();
    expect(a.beginningCapitalMinor).toBeNull();
    expect(a.endingCapitalMinor).toBeNull();
    expect(a.refusals.length).toBeGreaterThan(0);
    // Straight out of SQLite, not the return value.
    const raw = rawDb()
      .prepare(`SELECT contributions_minor, distributions_minor, refusals_json FROM spv_k1_statement WHERE id = ?`)
      .get(a.id) as any;
    expect(raw.contributions_minor).toBeNull();
    expect(raw.distributions_minor).not.toBeNull();      // this one IS derivable
    expect(JSON.parse(raw.refusals_json).length).toBeGreaterThan(0);
  });

  it("B2 regenerating supersedes the prior draft — history survives, one draft stands", () => {
    const year = 2024;
    generateK1Drafts(spvId, year, "u_test");
    generateK1Drafts(spvId, year, "u_test");
    const all = listK1s(spvId, year);
    expect(all.length).toBe(4);                                        // history kept
    expect(all.filter((s) => s.status === "draft").length).toBe(2);    // one per LP
    expect(all.filter((s) => s.status === "superseded").length).toBe(2);
  });

  it("B3 an LP sees ISSUED statements only — a draft never reaches a taxpayer", async () => {
    const year = 2023;
    const drafts = generateK1Drafts(spvId, year, "u_test");
    CURRENT.override = "inv_k1_a";
    const before = await get(`/api/investor/me/spv/${spvId}/k1`);
    expect(before.status).toBe(200);
    expect(before.body.statements.some((s: any) => s.taxYear === year)).toBe(false);   // pole 1
    issueK1(spvId, drafts.find((d) => d.investorId === "inv_k1_a")!.id);
    const after = await get(`/api/investor/me/spv/${spvId}/k1`);
    expect(after.body.statements.some((s: any) => s.taxYear === year)).toBe(true);     // pole 2
  });

  it("B4 PROBE — a real, authenticated LP of ANOTHER vehicle gets 404, not another LP's K-1", async () => {
    CURRENT.override = "inv_k1_outsider";                       // real identity, wrong vehicle
    const probe = await get(`/api/investor/me/spv/${spvId}/k1`);
    expect(probe.status).toBe(404);
    // And the refusal is byte-identical to a vehicle that does not exist, so
    // the endpoint is not an enumeration oracle (rule 6: 404, not 403).
    const ghost = await get(`/api/investor/me/spv/spv_does_not_exist_zzz/k1`);
    expect(ghost.status).toBe(404);
    expect(JSON.stringify(probe.body)).toBe(JSON.stringify(ghost.body));
  });

  it("B5 WHOLE-BODY LEAK SCAN — LP A's response contains no trace of LP B", async () => {
    CURRENT.override = "inv_k1_a";
    const r = await get(`/api/investor/me/spv/${spvId}/k1`);
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain("inv_k1_b");
    // POLE: LP A's OWN identity and figures ARE present, so B5 cannot be
    // passing because the endpoint returned nothing at all.
    expect(body).toContain("inv_k1_a");
    expect(r.body.statements.length).toBeGreaterThan(0);
  });

  it("B6 there is no tamperable investor parameter on the LP route", async () => {
    CURRENT.override = "inv_k1_a";
    const tampered = await get(`/api/investor/me/spv/${spvId}/k1?investorId=inv_k1_b`);
    expect(tampered.status).toBe(200);
    expect(JSON.stringify(tampered.body)).not.toContain("inv_k1_b");
    expect(tampered.body.statements.every((s: any) => s.investorId === "inv_k1_a")).toBe(true);
  });

  it("B7 anonymous is 401 and distinct from the member refusal — auth is actually mounted", async () => {
    CURRENT.override = null;
    const anon = await get(`/api/investor/me/spv/${spvId}/k1`);
    expect(anon.status).toBe(401);
  });

  it("B8 the GP surface requires a tax year rather than defaulting to one", async () => {
    const missing = await get(`/api/partner/me/spv/${spvId}/k1`, MANAGING);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("TAX_YEAR_REQUIRED");
    const ok = await get(`/api/partner/me/spv/${spvId}/k1?taxYear=2025`, MANAGING);
    expect(ok.status).toBe(200);
    expect(ok.body.taxYear).toBe(2025);
    expect(ok.body.statements.length).toBe(2);
  });

  it("B9 cross-partner access to the GP surface is 404, not 403", async () => {
    const r = await get(`/api/partner/me/spv/spv_not_this_partner_zzz/k1?taxYear=2025`, MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("SPV_NOT_FOUND");
  });

  it("B11 SINK — a LEGACY distribution row with no carry_base tier blanks the income box, never zeroes it", async () => {
    /* Closes the coverage gap mutant K13 exposed: the pure engine refuses an
       unknown profit (A6), but nothing proved the STORE reads a missing tier as
       unknown rather than as zero. Distributions written before the carry_base
       tier existed are real rows in real databases, so this simulates one at
       the sink — a raw insert into `spv_distribution` — and asserts the refusal
       surfaces all the way through `deriveK1s`. */
    const legacySpv = await createSpv("W32 K1 Legacy SPV");
    await commitLp(legacySpv, "inv_k1_legacy", 500_000);
    const now = new Date().toISOString();
    rawDb()
      .prepare(`INSERT INTO spv_distribution (id, spv_id, event, gross_proceeds_minor, currency,
                  waterfall_json, allocations_json, gp_carry_minor, platform_carry_minor, status,
                  created_at, created_by, prev_hash, curr_hash)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        "dist_w32_legacy", legacySpv, "exit", 900_000, "USD",
        // A pre-carry_base waterfall: return_of_capital only.
        JSON.stringify([{ tier: "return_of_capital", amountMinor: 900_000 }]),
        JSON.stringify([{ investorId: "inv_k1_legacy", grossMinor: 900_000, carryMinor: 0, netMinor: 900_000 }]),
        0, 0, "recorded", now, "u_test", "0".repeat(64), "1".repeat(64),
      );
    const year = Number(now.slice(0, 4));
    const k = deriveK1s(legacySpv, year).find((x) => x.investorId === "inv_k1_legacy")!;
    expect(k.allocatedIncomeMinor).toBeNull();
    expect(k.allocatedIncomeMinor).not.toBe(0);
    expect(k.refusals.map((r) => r.code)).toContain("UNKNOWN_REALIZED_PROFIT");
    // The distribution itself IS known, so the boxes that do not depend on the
    // missing tier are still filled — the row is not discarded wholesale.
    expect(k.distributionsMinor).toBe(900_000);

    /* THE OTHER POLE. Add a second event that DOES state its carry_base and,
       on a vehicle where every row states it, the income box fills. */
    const goodSpv = await createSpv("W32 K1 Legacy Control SPV");
    await commitLp(goodSpv, "inv_k1_legacy", 500_000);
    rawDb()
      .prepare(`INSERT INTO spv_distribution (id, spv_id, event, gross_proceeds_minor, currency,
                  waterfall_json, allocations_json, gp_carry_minor, platform_carry_minor, status,
                  created_at, created_by, prev_hash, curr_hash)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        "dist_w32_legacy_ok", goodSpv, "exit", 900_000, "USD",
        JSON.stringify([
          { tier: "return_of_capital", amountMinor: 500_000 },
          { tier: "carry_base", amountMinor: 400_000 },
        ]),
        JSON.stringify([{ investorId: "inv_k1_legacy", grossMinor: 900_000, carryMinor: 0, netMinor: 900_000 }]),
        0, 0, "recorded", now, "u_test", "0".repeat(64), "2".repeat(64),
      );
    const ok = deriveK1s(goodSpv, year).find((x) => x.investorId === "inv_k1_legacy")!;
    expect(ok.allocatedIncomeMinor).toBe(400_000);
    expect(ok.refusals.map((r) => r.code)).not.toContain("UNKNOWN_REALIZED_PROFIT");
  });

  it("B10 the derived K-1 reflects the SIDE-LETTER carry the LP actually bore", async () => {
    /* Capability 2 and capability 3 must agree: whatever carry the waterfall
       charged an LP is the carry their K-1 reports. If these two derived the
       figure independently they would eventually disagree, which is why the
       K-1 reads `allocations_json` rather than recomputing from fee rates. */
    const year = new Date().getUTCFullYear();
    const derived = deriveK1s(spvId, year);
    const persistedCarry = JSON.parse(
      (rawDb().prepare(`SELECT allocations_json FROM spv_distribution WHERE spv_id = ? ORDER BY created_at ASC LIMIT 1`)
        .get(spvId) as any).allocations_json,
    );
    for (const k of derived) {
      const fromLedger = persistedCarry.find((a: any) => a.investorId === k.investorId);
      if (!fromLedger) continue;
      expect(k.carryAllocatedMinor).toBe(fromLedger.carryMinor);
      expect(k.distributionsMinor).toBe(fromLedger.netMinor);
    }
  });
});
