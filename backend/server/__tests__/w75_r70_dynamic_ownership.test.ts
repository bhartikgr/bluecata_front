/**
 * WAVE 75 — R70: FOUNDER OWNERSHIP IS COMPUTED, DYNAMIC AND REAL-TIME.
 *
 * Owner ruling R70 (2026-08-18): *"Q2: Change it. Has to be dynamic and real-time.
 * No hard codes."* — deliberately stronger than the dash the agent recommended.
 * `server/paymentGatewayAdapter.ts:630` and `:765` wrote `ownershipPct: 1.0`, which
 * the founder dashboard consumes as a FRACTION and rendered as a confident
 * `100.00%` on a brand-new company beside `capTableHolders: 0`.
 *
 * ALL THREE POLES R70 CONDITION 6 NAMES ARE HERE:
 *   · POLE 1  securities on the cap table  → the COMPUTED figure
 *   · POLE 2  no securities at all         → `—` (a `null` fraction, R47)
 *   · POLE 3  a founder who genuinely owns 100% → `100.00%`, COMPUTED not asserted
 *
 * Pole 3 is the one that proves the fabrication was removed and not the feature.
 *
 * EVERY POLE IS DRIVEN THROUGH THE REAL READ ENDPOINT the dashboard uses
 * (`GET /api/founder/active-company` → `client/src/lib/useActiveCompany.ts` →
 * `Dashboard.tsx:262`, `:483`, `:585`), not through the helper in isolation — R58's
 * rule is that a fix at the API is not a fix on the screen, so the assertions are
 * made on the bytes the screen is served.
 *
 * MUTATION TRANSCRIPTS: build_log/wave75/W75_TESTS.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createRound } from "../roundsStore";
import { computeFounderOwnership } from "../lib/founderOwnershipEngine";

const ROOT = path.resolve(__dirname, "../..");
const ADAPTER_SRC = path.join(ROOT, "server/paymentGatewayAdapter.ts");
const STAMP = `w75o${Date.now().toString(36)}`;
const ADMIN = "u_admin";

let app: Express;

/**
 * The exact payload the founder dashboard's ownership tile is served. `companyId`
 * is activated first, because these fixtures share one authenticated founder and
 * the endpoint answers for whichever company is active.
 */
async function activeCompanyKpi(userId: string, companyId: string): Promise<{ ownershipPct: unknown; capTableHolders: unknown }> {
  const act = await request(app).post(`/api/founder/companies/${companyId}/activate`).set("x-user-id", userId).send({});
  expect(act.status, `activate ${companyId}`).toBe(200);
  const res = await request(app).get("/api/founder/active-company").set("x-user-id", userId);
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return (res.body as { company: { kpi: { ownershipPct: unknown; capTableHolders: unknown } } }).company.kpi;
}

/** Create a company owned by `userId` and make it active. */
async function makeCompany(userId: string, key: string): Promise<string> {
  const companyId = `co_${STAMP}_${key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", userId)
    .send({ companyId, companyName: `W75 ${key}` });
  expect(co.status, `company create ${key}: ${JSON.stringify(co.body).slice(0, 300)}`).toBeLessThan(400);
  const act = await request(app).post(`/api/founder/companies/${companyId}/activate`).set("x-user-id", userId).send({});
  expect(act.status, `activate ${key}`).toBe(200);
  return companyId;
}

/**
 * Give a company a founder common block through the platform's own reachable
 * creator — `POST /api/founder/captable/seed-founder-shares`, the same one Wave 74
 * used. Nothing is written to the securities array by hand.
 */
async function seedFounderShares(userId: string, companyId: string, key: string, shares: string): Promise<void> {
  const foundationId = createRound({
    companyId, name: `${STAMP} Foundation ${key}`, type: "foundation",
    instrument: "common", pricePerShare: null, actorUserId: userId,
  }).id;
  const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", userId)
    .send({
      companyId, roundId: foundationId, shares, amount: "8000",
      currency: "USD", holderFirstName: "Founder", holderLastName: key,
    });
  expect(seeded.status, `seed-founder-shares ${key}: ${JSON.stringify(seeded.body).slice(0, 300)}`).toBe(201);
}

/** Add a PRICED investor block, so the founder no longer owns everything. */
async function addInvestor(userId: string, companyId: string, key: string): Promise<void> {
  const created = await request(app).post("/api/rounds").set("x-user-id", userId).send({
    companyId, name: `${STAMP} Priced ${key}`, type: "seed", instrument: "preferred",
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
  });
  expect(created.status, `priced round ${key}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
  const roundId = String((created.body as { id: string }).id);
  const backfill = await request(app).post("/api/founder/captable/backfill-investor")
    .set("x-user-id", userId)
    .send({
      companyId, roundId, shares: String(Math.floor(10_000_000 / 2.5)),
      amount: "10000000", currency: "USD",
      holderFirstName: "Invest", holderLastName: key,
      investorEmail: `${STAMP}_${key}@example.invalid`,
    });
  expect(backfill.status, `backfill ${key}`).toBe(201);
}

describe("W75 · R70 — hardcoded ownership became computed", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     R70 CONDITION 2 — NO HARDCODED OWNERSHIP VALUE OF ANY KIND SURVIVES.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-R70-A — no `ownershipPct: <number>` literal remains in the sacred adapter", () => {
    const s = fs.readFileSync(ADAPTER_SRC, "utf8");
    /* Every assignment of the field, whatever its value. `1.0`, `0`, `100` and
       anything else numeric all fail this, which is exactly R70 condition 2:
       "not `1.0`, not `0`, not `100`". */
    /* COMMENTS ARE STRIPPED PROPERLY, not by a leading-`*` heuristic. This file
       deliberately QUOTES the removed `ownershipPct: 1.0` in its explanatory blocks
       (the project's convention is that a pre-fix value goes on the record rather
       than being erased), and a naive line filter counted those quotations as
       surviving hardcodes — which is how this stripper came to be written. Block
       comments are removed whole; line comments to end of line. */
    const codeOnly = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    const codeLines = codeOnly.split("\n");
    const offenders = codeLines.filter((l) => /ownershipPct\s*:\s*[-+0-9.]/.test(l));
    expect(offenders, `hardcoded ownership survives:\n${offenders.join("\n")}`).toEqual([]);
    /* And the two sites are wired to the ONE computation. */
    const calls = codeLines.filter((l) => /ownershipPct:\s*computeFounderOwnershipFraction\(/.test(l));
    expect(calls.length, "both R70 sites must call the engine-backed helper").toBe(2);
    /* R70 condition 3 — no fabricated default anywhere on this path. */
    expect(s).not.toMatch(/computeFounderOwnershipFraction\([^)]*\)\s*(\?\?|\|\|)/);
    /* R70 condition 1 — the sacred file contains no arithmetic of its own for this
       quantity, and does NOT read the stored KPI back (R57's outlier). */
    expect(s).not.toMatch(/kpi\.ownershipPct/);
  });

  it("W75-R70-B — the computation goes through the ONE engine and nothing else", () => {
    const helper = fs.readFileSync(path.join(ROOT, "server/lib/founderOwnershipEngine.ts"), "utf8");
    /* R70 condition 1: `shared/roundMathEngineAdapter.ts`, the single source. */
    expect(helper).toContain('from "@shared/roundMathEngineAdapter"');
    expect(helper).toContain("runEngine(");
    /* R70 condition 3: no coalesce, in either spelling, anywhere in the module. */
    const helperCode = helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(helperCode).not.toContain("?? 0");
    expect(helperCode).not.toContain("|| 1");
    /* R57: the stored literal is never read. */
    expect(helperCode).not.toContain("kpi.ownershipPct");
    /* R69 STANDING — this wave did not go anywhere near the carry-forward engine. */
    const carry = fs.readFileSync(path.join(ROOT, "server/roundCarryForwardEngine.ts"), "utf8");
    expect(carry).toContain("computeConversionProjections");
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     POLE 2 (R70 condition 6, second half) — NOTHING TO COMPUTE FROM → `—`.
     Asserted FIRST because this is what a brand-new founder actually sees.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-R70-C — a brand-new company with no securities reports `null`, never 1.0 and never 0", async () => {
    const user = ADMIN;
    const companyId = await makeCompany(user, "fresh");
    const kpi = await activeCompanyKpi(user, companyId);
    /* `null` is the whole point: `fmtPct(null, 2)` renders the platform's em-dash,
       so the founder sees `—`. A `0` here would print `0.00%` and a `1` would print
       the `100.00%` this wave removed. Both are asserted against by name. */
    expect(kpi.ownershipPct).toBeNull();
    expect(kpi.ownershipPct).not.toBe(1);
    expect(kpi.ownershipPct).not.toBe(0);
    /* The neighbour that WAS honest stays honest — zero holders is a fact (R47). */
    expect(kpi.capTableHolders).toBe(0);
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     POLE 3 (R70 condition 6, third pole) — A GENUINE 100% IS STILL 100%.
     "That third pole is the one that proves you fixed the fabrication and not the
     feature."
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-R70-D — a founder who really owns everything still reads 100.00%, computed", async () => {
    const user = ADMIN;
    const companyId = await makeCompany(user, "solo");
    /* Before any securities exist the honest answer is `—`. */
    expect((await activeCompanyKpi(user, companyId)).ownershipPct).toBeNull();
    /* Now the founder's own common block, and NOTHING else on the cap table. */
    await seedFounderShares(user, companyId, "solo", "8000000");
    const kpi = await activeCompanyKpi(user, companyId);
    expect(kpi.ownershipPct).toBe(1);
    /* And it is a COMPUTATION, not the old literal: the engine's own numerator and
       denominator are the founder's real share count, read back here. */
    const detail = computeFounderOwnership(companyId);
    expect(detail.reason).toBe("computed");
    expect(detail.founderShares).toBe("8000000");
    expect(detail.totalShares).toBe("8000000");
    expect(detail.exact).toBe("1");
    /* What `Dashboard.tsx:283` then renders, reproduced exactly. */
    expect(((kpi.ownershipPct as number) * 100).toFixed(2)).toBe("100.00");
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     POLE 1 (R70 condition 6, first half) — SECURITIES PRESENT → COMPUTED.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-R70-E — an investor on the cap table MOVES the figure, and it is re-derived per read", async () => {
    const user = ADMIN;
    const companyId = await makeCompany(user, "mixed");
    await seedFounderShares(user, companyId, "mixed", "8000000");
    const before = await activeCompanyKpi(user, companyId);
    expect(before.ownershipPct).toBe(1);

    /* THE REAL-TIME PROPERTY, MEASURED RATHER THAN CLAIMED (R70 condition 4). The
       cap table changes; NOTHING re-writes the stored KPI; the very next read of the
       same endpoint returns a different, smaller figure. A stored literal could not
       do this — that is the difference between dynamic and asserted. */
    await addInvestor(user, companyId, "mixed");
    const after = await activeCompanyKpi(user, companyId);
    expect(after.ownershipPct).not.toBeNull();
    expect(after.ownershipPct as number).toBeLessThan(1);
    expect(after.ownershipPct as number).toBeGreaterThan(0);

    /* The engine's own totals for the same company, so the assertion is on the
       arithmetic and not merely on the direction of travel. */
    const detail = computeFounderOwnership(companyId);
    expect(detail.reason).toBe("computed");
    expect(detail.founderShares).toBe("8000000");
    expect(BigInt(String(detail.totalShares))).toBeGreaterThan(BigInt("8000000"));
    /* And the KPI the SCREEN receives is that exact quantity, not a second one. */
    expect(after.ownershipPct).toBe(detail.fraction);
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     THE DASHBOARD AND THE CAP TABLE CANNOT DISAGREE (R46's stated reason).
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-R70-F — the dashboard figure is the same aggregation /founder/captable renders", async () => {
    /* `client/src/pages/founder/CapTable.tsx` sums the engine's `holderType ===
       "founder"` rows (`:285-289`) and divides by the engine's own `totalShares`
       (`:581`). This asserts THAT definition on the source, so a future edit which
       makes one surface disagree with the other fails here. */
    const capTable = fs.readFileSync(path.join(ROOT, "client/src/pages/founder/CapTable.tsx"), "utf8");
    expect(capTable).toContain('sumByType("founder")');
    expect(capTable).toContain("founderSharesNum / totalSharesNum");
    const helper = fs.readFileSync(path.join(ROOT, "server/lib/founderOwnershipEngine.ts"), "utf8");
    expect(helper).toContain('r.holderType === "founder"');
    /* And the KPI is projected at READ time, not stored (R46: "A stored number
       nothing recomputes is a dead variable"). */
    const store = fs.readFileSync(path.join(ROOT, "server/multiCompanyStore.ts"), "utf8");
    expect(store).toContain("withComputedOwnership");
    expect(store).toMatch(/app\.get\("\/api\/founder\/active-company"/);
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     THE REFUSAL PATHS ARE DISTINGUISHABLE — an honest `null` says WHY.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-R70-G — `null` carries a reason, so 'no securities' and 'engine refused' are not the same fact", () => {
    const unknownCompany = computeFounderOwnership(`co_${STAMP}_does_not_exist`);
    expect(unknownCompany.fraction).toBeNull();
    expect(unknownCompany.reason).toBe("no_securities_on_record");
    const blank = computeFounderOwnership("");
    expect(blank.fraction).toBeNull();
    expect(blank.reason).toBe("no_securities_on_record");
  });
});
