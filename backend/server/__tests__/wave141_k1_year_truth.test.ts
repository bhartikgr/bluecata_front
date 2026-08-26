/**
 * WAVE 141 · BATCH 1 ITEM 3 — THE K-1 REPORTED $0.00 FOR REAL CONFIRMED CAPITAL.
 * (The pre-flight names this file `batch1_item3_k1_year_truth.test.ts`; it is
 *  wave-prefixed here to match every other test file in the tree.)
 *
 * THE DEFECT. An LP whose confirmed receipt is dated 2026, read for tax year
 * 2025, had `myConfirmations.length > 0` — so the NO_FUNDS_CONFIRMATION branch
 * did not fire — and the in-year sum of an EMPTY list is `0`. Three capital
 * boxes therefore came back as `0` with NO refusal, and the panel printed
 * `$0.00`: a positive assertion that this partner contributed nothing, on a tax
 * artifact, beneath the panel's own printed promise that a non-derivable figure
 * "is never shown as zero".
 *
 * BOTH POLES ARE ASSERTED THROUGHOUT, because the cheap over-correction — null
 * whenever the in-year sum is zero — would destroy the LEGITIMATE zero: an LP
 * who funded in a prior year and nothing this year genuinely contributed zero
 * this year and must keep their rolled-forward capital. A2 is that pole and it
 * fails against the over-correction.
 *
 * Fences this must not disturb: A10 (the year filter, wave32 :297), A11 (every
 * null box appears as a refusal field, wave32 :320-355), B8 (`/k1` still 400s
 * without a taxYear, wave32 :478-486 — re-pinned here as B4 so a later
 * "convenience default" fails in two files).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

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

import {
  computeK1Statements,
  suggestClosedTaxYear,
  k1ActivityYears,
  type K1ComputeArgs,
  type K1Statement,
} from "../lib/spvK1";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvK1Routes } from "../spvK1Routes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { ensureK1SchemaForTests } from "../spvK1Store";

const MANAGING = "u_avi_managing";
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

/** Put an LP on the COMMITTED register — the set the K-1 engine iterates. */
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

async function createSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "per_deployment", status: "open",
    signoffLegalName: "Avi Managing", signoffAccepted: true,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/**
 * Write a DATED funds confirmation onto the real `spv.terms_json` row.
 * `confirmFundsReceived` stamps `nowIso()`, so a wrong-year fixture cannot be
 * produced through the route; this writes the same shape the route writes, at
 * the sink the reader actually reads, and the assertions below then travel the
 * production path (`k1ContributionsForSpv` → `computeK1Statements`).
 */
function seedConfirmation(spvId: string, investorId: string, confirmedAt: string, receivedMinor: number) {
  const row = rawDb().prepare(`SELECT terms_json FROM spv WHERE id = ?`).get(spvId) as { terms_json?: string };
  const terms = row?.terms_json ? JSON.parse(row.terms_json) : {};
  terms._fundsConfirmations = { ...(terms._fundsConfirmations ?? {}) };
  terms._fundsConfirmations[investorId] = { receivedMinor, confirmedAt, status: "matched" };
  rawDb().prepare(`UPDATE spv SET terms_json = ? WHERE id = ?`).run(JSON.stringify(terms), spvId);
  // THE FIXTURE ESTABLISHES ITS OWN PRECONDITION: if this write did not land,
  // every assertion below would be checking an empty bag.
  const back = JSON.parse(
    (rawDb().prepare(`SELECT terms_json FROM spv WHERE id = ?`).get(spvId) as any).terms_json,
  );
  expect(back._fundsConfirmations[investorId].confirmedAt).toBe(confirmedAt);
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
    spvId: "spv_k1_w141",
    taxYear: 2025,
    vehicleCurrency: "USD",
    register: [{ investorId: "lp_a", commitmentMinor: 600_000 }],
    distributions: [],
    contributions: [],
    ...over,
  };
}

function boxes(k: K1Statement) {
  return {
    contributionsMinor: k.contributionsMinor,
    beginningCapitalMinor: k.beginningCapitalMinor,
    endingCapitalMinor: k.endingCapitalMinor,
  };
}

describe("W141 / A — the engine refuses a year it has no receipts for, and keeps the real zero", () => {
  it("A1 THE LIVE REPRODUCTION — a 2026 receipt read for 2025 blanks three boxes, never prints zero", () => {
    const k = computeK1Statements(args({
      taxYear: 2025,
      contributions: [{ investorId: "lp_a", confirmedAt: "2026-03-01T00:00:00.000Z", receivedMinor: 25_000_000 }],
    }))[0];
    expect(boxes(k)).toEqual({
      contributionsMinor: null,
      beginningCapitalMinor: null,
      endingCapitalMinor: null,
    });
    // Named, and named with the TRUE reason — not "unknown contributions".
    const byField = new Map(k.refusals.map((r) => [r.field, r.code]));
    expect(byField.get("contributionsMinor")).toBe("NOT_A_MEMBER_IN_YEAR");
    expect(byField.get("beginningCapitalMinor")).toBe("NOT_A_MEMBER_IN_YEAR");
    expect(byField.get("endingCapitalMinor")).toBe("NOT_A_MEMBER_IN_YEAR");
    expect(k.refusals.some((r) => r.code === "DEPENDS_ON_UNKNOWN_CONTRIBUTIONS")).toBe(false);
    // The copy speaks about CONFIRMED RECEIPTS, which is what the branch checks.
    // It must NOT claim anything about when the position was committed: the
    // register carries no date and the engine cannot know that.
    const copy = k.refusals.find((r) => r.field === "contributionsMinor")!.copy;
    expect(copy).toContain("confirmed capital receipt");
    expect(copy).not.toContain("committed position");
  });

  it("A2 THE OPPOSITE POLE — a prior-year member keeps a TRUE zero and rolls capital forward", () => {
    const k = computeK1Statements(args({
      taxYear: 2026,
      contributions: [{ investorId: "lp_a", confirmedAt: "2025-05-05T00:00:00.000Z", receivedMinor: 25_000_000 }],
    }))[0];
    expect(k.contributionsMinor).toBe(0);                 // a REAL zero: they truly added nothing in 2026
    expect(k.beginningCapitalMinor).toBe(25_000_000);
    expect(k.endingCapitalMinor).toBe(25_000_000);
    expect(k.refusals.map((r) => r.code)).not.toContain("NOT_A_MEMBER_IN_YEAR");
    expect(k.refusals).toEqual([]);
  });

  it("A3 the CORRECT year still returns the real figure — nothing regressed", () => {
    const k = computeK1Statements(args({
      taxYear: 2026,
      contributions: [{ investorId: "lp_a", confirmedAt: "2026-03-01T00:00:00.000Z", receivedMinor: 25_000_000 }],
    }))[0];
    expect(k.contributionsMinor).toBe(25_000_000);
    expect(k.beginningCapitalMinor).toBe(0);
    expect(k.endingCapitalMinor).toBe(25_000_000);
    expect(k.refusals).toEqual([]);
  });

  it("A4 no confirmations AT ALL is still NO_FUNDS_CONFIRMATION, not the new code", () => {
    const k = computeK1Statements(args({ taxYear: 2025, contributions: [] }))[0];
    expect(k.contributionsMinor).toBeNull();
    const codes = k.refusals.map((r) => r.code);
    expect(codes).toContain("NO_FUNDS_CONFIRMATION");
    expect(codes).not.toContain("NOT_A_MEMBER_IN_YEAR");
  });

  it("A5 exactly one refusal per nulled box — never duplicated per field", () => {
    const k = computeK1Statements(args({
      taxYear: 2024,
      contributions: [
        { investorId: "lp_a", confirmedAt: "2026-01-02T00:00:00.000Z", receivedMinor: 10_000 },
        { investorId: "lp_a", confirmedAt: "2026-07-02T00:00:00.000Z", receivedMinor: 20_000 },
      ],
    }))[0];
    const notMember = k.refusals.filter((r) => r.code === "NOT_A_MEMBER_IN_YEAR");
    expect(notMember.length).toBe(3);
    expect(new Set(notMember.map((r) => r.field)).size).toBe(3);
    // FENCE A11, RESTATED HERE: every null box is explained, so a future edit
    // that nulls a fourth box without a refusal fails in this file too.
    const nullFields = Object.entries(boxes(k)).filter(([, v]) => v === null).map(([f]) => f);
    const explained = new Set(k.refusals.map((r) => r.field));
    for (const f of nullFields) expect(explained.has(f)).toBe(true);
  });

  it("A6 MIXED_CURRENCY still short-circuits ahead of the new branch", () => {
    const out = computeK1Statements(args({
      taxYear: 2025,
      distributions: [{
        id: "d_jpy", createdAt: "2025-06-01T00:00:00.000Z", currency: "JPY",
        grossProceedsMinor: 1_000, realizedProfitMinor: 100,
        allocations: [{ investorId: "lp_a", grossMinor: 1_000, carryMinor: 0, netMinor: 1_000 }],
      }],
      contributions: [{ investorId: "lp_a", confirmedAt: "2026-03-01T00:00:00.000Z", receivedMinor: 25_000_000 }],
    }));
    expect(out[0].refusals.every((r) => r.code === "MIXED_CURRENCY")).toBe(true);
  });

  it("A7 the suggestion is the most recent CLOSED year, and NEVER the open one (R108.4 item 4)", () => {
    expect(suggestClosedTaxYear([2026, 2025, 2023], 2026)).toBe(2025);
    // Activity only in the open year -> null. The panel is not handed a year
    // that has not finished; absence is reported as absence.
    expect(suggestClosedTaxYear([2026], 2026)).toBeNull();
    expect(suggestClosedTaxYear([], 2026)).toBeNull();
    // A future-dated row cannot be suggested either.
    expect(suggestClosedTaxYear([2030], 2026)).toBeNull();
    expect(suggestClosedTaxYear([2030, 2024], 2026)).toBe(2024);
  });

  it("A8 activity years merge receipts and distributions, distinct and descending", () => {
    const years = k1ActivityYears(
      [
        { investorId: "lp_a", confirmedAt: "2024-02-02T00:00:00.000Z", receivedMinor: 1 },
        { investorId: "lp_b", confirmedAt: "2024-09-09T00:00:00.000Z", receivedMinor: 1 },
      ],
      [{ createdAt: "2026-01-01T00:00:00.000Z" }, { createdAt: "2025-01-01T00:00:00.000Z" }],
    );
    expect(years).toEqual([2026, 2025, 2024]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART B — THE ROUTE, OVER REAL ROWS
 * ═════════════════════════════════════════════════════════════════════════ */

describe("W141 / B — /k1/years over real rows", () => {
  let spvId: string;
  let emptySpvId: string;

  beforeAll(async () => {
    spvId = await createSpv("W141 K1 years SPV");
    emptySpvId = await createSpv("W141 K1 empty SPV");
    await commitLp(spvId, "inv_w141_a", 10_000_000);
    await commitLp(spvId, "inv_w141_b", 20_000_000);
    seedConfirmation(spvId, "inv_w141_a", "2024-04-04T00:00:00.000Z", 10_000_000);
    seedConfirmation(spvId, "inv_w141_b", "2026-04-04T00:00:00.000Z", 20_000_000);
  });

  it("B1 returns the distinct years descending and suggests the most recent CLOSED one", async () => {
    const r = await get(`/api/partner/me/spv/${spvId}/k1/years`, MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.years).toEqual([2026, 2024]);
    expect(r.body.suggestedTaxYear).toBe(2024);          // 2026 is still open
  });

  it("B2 a vehicle with no recorded activity returns an ABSENCE, never a guessed year", async () => {
    const r = await get(`/api/partner/me/spv/${emptySpvId}/k1/years`, MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.years).toEqual([]);
    expect(r.body.suggestedTaxYear).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain(String(new Date().getUTCFullYear()));
  });

  it("B3 the new route carries the same ownership gate — 404, with no existence leak", async () => {
    const r = await get(`/api/partner/me/spv/spv_not_this_partner_zzz/k1/years`, MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("SPV_NOT_FOUND");
    const anon = await get(`/api/partner/me/spv/${spvId}/k1/years`);
    expect(anon.status).toBeGreaterThanOrEqual(401);
    expect(anon.status).toBeLessThan(404);
  });

  it("B4 FENCE RE-PIN — /k1 itself still refuses a request with no taxYear", async () => {
    const missing = await get(`/api/partner/me/spv/${spvId}/k1`, MANAGING);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("TAX_YEAR_REQUIRED");
    // And the suggestion route did not become a back door for defaulting: it
    // returns years, never statements.
    const years = await get(`/api/partner/me/spv/${spvId}/k1/years`, MANAGING);
    expect(years.body.statements).toBeUndefined();
  });

  it("B5 END TO END — the wrong-year read is a REFUSAL on the wire, not $0.00", async () => {
    // A real HTTP response, from real rows, through the real handler.
    const wrong = await get(`/api/partner/me/spv/${spvId}/k1?taxYear=2025`, MANAGING);
    expect(wrong.status).toBe(200);
    const b = wrong.body.statements.find((s: any) => s.investorId === "inv_w141_b");
    expect(b).toBeTruthy();                              // the LP IS on the register
    expect(b.contributionsMinor).toBeNull();
    expect(b.endingCapitalMinor).toBeNull();
    expect(b.refusals.map((r: any) => r.code)).toContain("NOT_A_MEMBER_IN_YEAR");
    // POLE: the 2024 LP, read for 2025, keeps a TRUE zero and a real capital
    // balance on the same response — so B5 is not passing by nulling everything.
    const a = wrong.body.statements.find((s: any) => s.investorId === "inv_w141_a");
    expect(a.contributionsMinor).toBe(0);
    expect(a.beginningCapitalMinor).toBe(10_000_000);
  });
});
