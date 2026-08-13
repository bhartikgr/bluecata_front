/**
 * WAVE 36 · ROW 9 — falsification harness.
 *
 * TWO DEFECTS, TWO DIFFERENT REMEDIES, AND THE HARNESS SAYS WHICH IS WHICH.
 *
 * (a) DEAD PROMISE. `SPV_EDU.capitalAccounts` promised "Valuation-based metrics
 *     (TVPI/DPI/IRR) appear only once there's data" while the capital-accounts
 *     grid rendered four columns and no metric at all.
 *       · DPI  → WIRED. It is realised (distributions ÷ paid-in) and needs no
 *                mark, so a canonical producer now emits it
 *                (server/lib/spvOfflineOps.ts computeCapitalAccounts) and the
 *                grid renders it. Poles P1–P5 execute that producer.
 *       · TVPI → COPY CORRECTED. Needs a per-LP share of a NAV mark.
 *       · IRR  → COPY CORRECTED. Needs dated per-LP flows.
 *                Neither has a canonical producer at capital-account
 *                granularity, so the copy stopped promising them instead of a
 *                number being invented. P6/P7 assert exactly that, both poles.
 *
 * (b) ORPHAN ROUTE. `GET /api/admin/founder-channels/:companyId` had zero
 *     client callers, so Wave 35's honest mixed-currency `null` +
 *     `unavailableReason` reached nobody. SURFACED, not retired (retiring would
 *     delete a capability). P8–P10 assert the caller exists, is mounted, and
 *     renders the refusal rather than a zero.
 *
 * Money rules under test: integer minor units, never summed across currencies,
 * nulls not zeros with a rendered refusal, and a JPY fixture (ISO 4217
 * exponent 0) in every money pole.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

/* WAVE 38 · ROW 5 — the founder-channels poles below call the REAL route. The
 * auth layer is stubbed (this row is about the aggregation, and the auth poles
 * are owned by wave35_founder_channels_currency_partition + the privacy e2e),
 * but nothing about the handler itself is mocked. */
const TEST_ACTOR = "u_w38_r5_admin";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserContext: () => ({ isAuthed: true, isAdmin: true, userId: TEST_ACTOR, founder: { companies: [] } }),
  };
});

import { computeCapitalAccounts } from "../lib/spvOfflineOps";
import { rawDb } from "../db/connection";
import { createRound, updateRound } from "../roundsStore";
import { registerTrack4Routes } from "../track4Routes";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const EDU = "client/src/lib/spvEducation.ts";
const TABS = "client/src/components/partner/SpvDetailTabs.tsx";
const HOOK = "client/src/components/partner/SpvOperationsPanels.tsx";
const PANEL = "client/src/components/admin/FounderChannelsPanel.tsx";
const PAGE = "client/src/pages/admin/CompanyDetail.tsx";

/** Strip block and line comments so a source-text assertion cannot be satisfied
 *  by a sentence in a comment. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/* ── founder-channels fixtures (Wave 38 · Row 5) ─────────────────────────── */
/* This suite establishes its OWN preconditions: it inserts the companies,
   rounds and soft circles it asserts on, with ids unique to this file, and
   reads nothing from `process.env`. Amounts are integer minor units. */
const TENANT = "t_w38_r5";
const CO_USD = "co_w38_r5_usd";
const CO_JPY = "co_w38_r5_jpy";
const CO_MIXED = "co_w38_r5_mixed";
const CO_EMPTY = "co_w38_r5_empty";

let app: Express;

function exec(sql: string, args: unknown[] = []): void {
  rawDb().prepare(sql).run(...(args as never[]));
}

function mkCompany(id: string, name: string): void {
  exec(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, legal_name, sector, stage, hq, is_demo)
     VALUES (?,?,?,?,?,?,?,0)`,
    [id, TENANT, name, name, "fintech", "seed", "Tokyo"],
  );
}

function mkRound(companyId: string, currency: string): string {
  const r = createRound({
    companyId,
    name: `W38 R5 ${currency}`,
    type: "seed",
    targetAmount: 1_000_000,
    pricePerShare: 500_000,
    currency,
    closeDate: "2026-01-15",
    actorUserId: TEST_ACTOR,
  } as never);
  updateRound((r as { id: string }).id, { state: "closed", raisedAmount: 1_000_000 } as never, { actor: TEST_ACTOR } as never);
  return (r as { id: string }).id;
}

function mkSoftCircle(o: {
  id: string; roundId: string; companyId: string; investorId: string;
  amountMinor: number; currency: string; sourceType: string | null;
}): void {
  exec(
    `INSERT OR REPLACE INTO soft_circles
       (id, tenant_id, round_id, company_id, investor_user_id, investor_name,
        amount, amount_minor, currency, status, source_type, source_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [o.id, TENANT, o.roundId, o.companyId, o.investorId, `W38 R5 ${o.investorId}`,
     1_000_000, o.amountMinor, o.currency, "confirmed", o.sourceType, null,
     new Date().toISOString()],
  );
}

beforeAll(() => {
  mkCompany(CO_USD, "W38 R5 USD Inc");
  mkCompany(CO_JPY, "W38 R5 JPY KK");
  mkCompany(CO_MIXED, "W38 R5 Mixed KK");
  mkCompany(CO_EMPTY, "W38 R5 Empty Inc");

  const rdUsd = mkRound(CO_USD, "USD");
  const rdJpy = mkRound(CO_JPY, "JPY");
  const rdMixJpy = mkRound(CO_MIXED, "JPY");
  const rdMixUsd = mkRound(CO_MIXED, "USD");

  // USD: $1,500.00 + $2,500.00 = 400,000 minor units (exponent 2).
  mkSoftCircle({ id: "sc_w38_r5_usd_a", roundId: rdUsd, companyId: CO_USD, investorId: "u_w38_r5_1", amountMinor: 150_000, currency: "USD", sourceType: "direct" });
  mkSoftCircle({ id: "sc_w38_r5_usd_b", roundId: rdUsd, companyId: CO_USD, investorId: "u_w38_r5_2", amountMinor: 250_000, currency: "USD", sourceType: "direct" });
  // JPY: ¥250,000 = 250,000 minor units (exponent 0).
  mkSoftCircle({ id: "sc_w38_r5_jpy", roundId: rdJpy, companyId: CO_JPY, investorId: "u_w38_r5_3", amountMinor: 250_000, currency: "JPY", sourceType: "direct" });
  // Mixed: one leg of each. Their integers must never be added together.
  mkSoftCircle({ id: "sc_w38_r5_mx_jpy", roundId: rdMixJpy, companyId: CO_MIXED, investorId: "u_w38_r5_4", amountMinor: 250_000, currency: "JPY", sourceType: "direct" });
  mkSoftCircle({ id: "sc_w38_r5_mx_usd", roundId: rdMixUsd, companyId: CO_MIXED, investorId: "u_w38_r5_5", amountMinor: 400_000, currency: "USD", sourceType: "direct" });
  // CO_EMPTY deliberately gets no round and no soft circle.

  app = express();
  app.use(express.json());
  registerTrack4Routes(app);
});

/* ── (a) DPI — the canonical producer, executed ──────────────────────────── */

describe("WAVE 36 ROW 9 · P1-P5 — DPI comes from a canonical producer and is honest about nulls", () => {
  it("P1 — realised DPI is distributions ÷ paid-in, not ÷ committed", () => {
    const rows = computeCapitalAccounts(
      [{ investorId: "lp1", commitmentMinor: 1_000_000 }],   // committed 10,000.00
      { lp1: 500_000 },                                       // paid in    5,000.00
      [{ allocations: [{ investorId: "lp1", netMinor: 750_000 }] }], // paid out 7,500.00
    );
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.confirmedMinor).toBe(500_000);
    expect(r.distributedMinor).toBe(750_000);
    /* 7,500 / 5,000 = 1.5. Against the COMMITMENT it would have been 0.75 —
       the wrong denominator is a different, plausible-looking number, which is
       precisely why this pole pins the value and not merely "is a number". */
    expect(r.dpiRatio).toBeCloseTo(1.5, 12);
    expect(r.dpiRatio).not.toBeCloseTo(0.75, 6);
  });

  it("P2 — nothing paid in yields NULL, never 0", () => {
    const rows = computeCapitalAccounts(
      [{ investorId: "lp1", commitmentMinor: 1_000_000 }],
      {},                       // called nothing
      [],
    );
    expect(rows[0]!.dpiRatio).toBeNull();
    expect(rows[0]!.dpiRatio).not.toBe(0);
  });

  it("P3 — paid in but nothing distributed is a REAL zero, and stays 0", () => {
    /* The counter-pole to P2: null must mean "undefined", not "small". A fund
       that called capital and has returned nothing genuinely has DPI 0. */
    const rows = computeCapitalAccounts(
      [{ investorId: "lp1", commitmentMinor: 1_000_000 }],
      { lp1: 1_000_000 },
      [],
    );
    expect(rows[0]!.dpiRatio).toBe(0);
  });

  it("P4 — JPY (exponent 0) and USD (exponent 2) give the IDENTICAL ratio", () => {
    /* A ratio of two minor-unit integers in the SAME currency is exponent
       independent. Economically identical flows must not produce a DPI that
       differs by 100x because of the currency's exponent. */
    const usd = computeCapitalAccounts(
      [{ investorId: "lp1", commitmentMinor: 100_000 }],
      { lp1: 100_000 },                                        // USD 1,000.00
      [{ allocations: [{ investorId: "lp1", netMinor: 250_000 }] }],  // USD 2,500.00
    )[0]!;
    const jpy = computeCapitalAccounts(
      [{ investorId: "lp1", commitmentMinor: 1_000 }],
      { lp1: 1_000 },                                          // JPY 1,000
      [{ allocations: [{ investorId: "lp1", netMinor: 2_500 }] }],    // JPY 2,500
    )[0]!;
    expect(usd.dpiRatio).toBeCloseTo(2.5, 12);
    expect(jpy.dpiRatio).toBeCloseTo(2.5, 12);
    expect(jpy.dpiRatio).toBe(usd.dpiRatio);
  });

  it("P5 — the grid renders the SERVER's ratio and refuses a null", () => {
    const tabs = stripComments(read(TABS));
    expect(tabs).toContain("spv-cap-acct-dpi-");
    expect(tabs).toContain("c.dpiRatio == null");
    expect(tabs).toContain("not reported");
    /* The four original headers survive — this was an APPEND, not a rewrite. */
    for (const h of ["Investor", "Contributed", "Confirmed", "Distributed"]) expect(tabs).toContain(`<div>${h}</div>`);
    expect(tabs).toContain("<div>DPI</div>");
    /* DPI is the LAST header, i.e. appended, not inserted mid-list. */
    const headerRow = /<div>Investor<\/div>[\s\S]{0,300}?\n/.exec(tabs)![0];
    expect(headerRow.trim().endsWith("<div>DPI</div>")).toBe(true);
    /* The browser must not compute its own DPI. */
    expect(tabs).not.toMatch(/distributedMinor\s*\/\s*(confirmedMinor|contributedMinor)/);
    expect(stripComments(read(HOOK))).not.toMatch(/distributedMinor\s*\/\s*(confirmedMinor|contributedMinor)/);
  });

  it("P5b — the hook reads the key the endpoint actually emits, and never zero-fills a missing ratio", () => {
    const hook = stripComments(read(HOOK));
    /* server/spvEngineRoutes.ts:665 emits `{ rows: … }`. */
    expect(read("server/spvEngineRoutes.ts")).toContain("res.json({ rows: spvEngineStore.capitalAccounts(");
    expect(hook).toContain("q.data?.rows");
    expect(hook).toMatch(/dpiRatio:[\s\S]{0,160}: null/);
    expect(hook).not.toMatch(/dpiRatio:\s*Number\(c\.dpiRatio\s*\?\?\s*0\)/);
  });
});

/* ── (a) TVPI / IRR — copy corrected because there IS no producer ────────── */

describe("WAVE 36 ROW 9 · P6-P7 — TVPI and IRR are not promised per investor", () => {
  it("P6 — no canonical producer emits a per-capital-account TVPI or IRR", () => {
    /* The claim that justifies correcting the copy instead of wiring a number.
       If this ever becomes false the row should be revisited, and this pole is
       what will say so. */
    const producer = read("server/lib/spvOfflineOps.ts");
    const iface = producer.slice(producer.indexOf("export interface CapitalAccountRow"), producer.indexOf("export function computeCapitalAccounts"));
    expect(iface).toContain("dpiRatio");
    expect(stripComments(iface)).not.toMatch(/\btvpi\b/i);
    expect(stripComments(iface)).not.toMatch(/\birr\b/i);

    const rows = computeCapitalAccounts([{ investorId: "lp1", commitmentMinor: 10 }], { lp1: 10 }, []);
    const keys = Object.keys(rows[0]!).map((k) => k.toLowerCase());
    expect(keys).toContain("dpiratio");
    expect(keys.filter((k) => k.includes("tvpi") || k.includes("irr"))).toEqual([]);
  });

  it("P7 — the copy promises DPI, disclaims TVPI/IRR, and points at the surface that HAS them", () => {
    const edu = read(EDU);
    const m = /capitalAccounts:\s*\n\s*"([\s\S]*?)",\n/.exec(edu);
    expect(m, "capitalAccounts copy not found — the assertion below would be vacuous").not.toBeNull();
    const copy = m![1];

    /* Pole 1 — the old dead promise is gone. */
    expect(copy).not.toContain("TVPI/DPI/IRR");
    /* Pole 2 — and it did not go silent: DPI is promised, and it is delivered
       (P1-P5 executed the producer that delivers it). */
    expect(copy).toContain("DPI");
    expect(copy.toLowerCase()).toContain("not reported");
    /* Pole 3 — TVPI/IRR are named as absent rather than quietly dropped, and
       the reader is told where they DO exist. */
    expect(copy).toMatch(/TVPI and IRR are NOT shown per investor/);
    expect(copy).toContain("Performance page");

    /* The vehicle-level surface the copy points at must actually render them,
       or the copy is a new dead promise replacing the old one. */
    const perf = read("client/src/pages/partner/SpvPerformance.tsx");
    expect(perf).toContain('label="Net IRR"');
    expect(perf).toContain('label="DPI"');
    expect(perf).toContain('label="TVPI"');
  });
});

/* ── (b) the orphan route, surfaced — EXERCISED, not described ───────────── */

/**
 * WAVE 38 · ROW 5 — REWRITTEN. The P8-P10 that shipped here asserted only on
 * SOURCE TEXT. Review 3B replaced the shipped success calculation with
 *
 *     const totalRaisedMinor = null;
 *
 * — i.e. the endpoint would have reported "no single total" for a company whose
 * every soft circle is in ONE currency — and this file stayed 12/12 GREEN. It
 * could not have been otherwise: it never called the route.
 *
 * The route is now CALLED, over real HTTP through the real registration, and
 * every claim is read off the response body. Source-text assertions are kept
 * ONLY where the claim genuinely is about source (the mount position, and the
 * absence of browser-side arithmetic), never as a stand-in for behaviour.
 *
 * MONEY: integer minor units on the wire, a JPY fixture (ISO 4217 exponent 0)
 * in every money pole, nothing summed across currencies, and a null — never a
 * zero — with a rendered refusal.
 */
describe("WAVE 36 ROW 9 · P8-P10 — founder-channels: the route answers, and a caller renders it", () => {
  it("P8 — the route is registered and the panel calls exactly it", () => {
    expect(read("server/track4Routes.ts")).toContain('app.get("/api/admin/founder-channels/:companyId"');
    const panel = read(PANEL);
    expect(panel).toContain("/api/admin/founder-channels/");
    expect(panel).toContain("encodeURIComponent(companyId)");
  });

  it("P9 — the panel is mounted on a real page, APPENDED after the existing card", () => {
    const page = read(PAGE);
    expect(page).toContain('from "@/components/admin/FounderChannelsPanel"');
    const markAt = page.indexOf("<CompanyMarkPanel");
    const chanAt = page.indexOf("<FounderChannelsPanel");
    expect(markAt).toBeGreaterThan(-1);
    expect(chanAt).toBeGreaterThan(markAt);   // appended, not inserted above
  });

  it("P10 — USD POLE, EXECUTED: a single-currency company gets its exact integer total", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_USD}`);
    expect(res.status).toBe(200);
    // 2 direct soft circles: $1,500.00 + $2,500.00 = 400,000 minor units.
    expect(res.body.totalRaisedMinor).toBe(400_000);
    expect(res.body.totalRaisedCurrency).toBe("USD");
    // The success path must NOT take the refusal branch.
    expect(res.body.totalRaisedMinor).not.toBeNull();
    expect(res.body.totalRaisedUnavailableReason).toBeUndefined();
    expect(res.body.byChannel.direct.totalMinor).toBe(400_000);
    expect(res.body.byChannel.direct.countSCs).toBe(2);
  });

  it("P10b — JPY POLE (exponent 0), EXECUTED: minor units are not scaled by 100", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_JPY}`);
    expect(res.status).toBe(200);
    // ¥250,000 in an exponent-0 currency is 250,000 minor units, not 25,000,000.
    expect(res.body.totalRaisedMinor).toBe(250_000);
    expect(res.body.totalRaisedMinor).not.toBe(25_000_000);
    expect(res.body.totalRaisedCurrency).toBe("JPY");
    expect(res.body.totalRaisedUnavailableReason).toBeUndefined();
  });

  it("P10c — MIXED POLE, EXECUTED: null plus a reason, never a cross-currency sum", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_MIXED}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRaisedMinor).toBeNull();
    expect(res.body.totalRaisedMinor).not.toBe(0);            // a null is not a zero
    expect(res.body.totalRaisedMinor).not.toBe(650_000);      // ¥250,000 + $4,000.00 added
    expect(res.body.totalRaisedUnavailableReason).toBe("needs_fx_conversion");
    expect(res.body.currencies).toEqual(["JPY", "USD"]);
    // Both legs survive intact — refusing the scalar drops no information.
    expect(res.body.totalRaisedByCurrency).toEqual([
      { currency: "JPY", minor: 250_000 },
      { currency: "USD", minor: 400_000 },
    ]);
  });

  it("P10d — EMPTY POLE, EXECUTED: nothing raised is a real 0, not a refusal", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_EMPTY}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRaisedMinor).toBe(0);
    expect(res.body.totalRaisedUnavailableReason).toBeUndefined();
    expect(res.body.totalRaisedByCurrency).toEqual([]);
  });

  it("P10e — the refusal is keyed on null and the browser sums nothing", () => {
    /* These ARE source claims — about what the panel is forbidden to do — so
       source is the right place to assert them. The behavioural claims are the
       executed poles above and the render poles in
       client/src/components/admin/__tests__/wave38_row5_founder_channels_panel.test.tsx. */
    const panel = stripComments(read(PANEL));
    expect(panel).toContain("minor == null");   // not `!minor`, which swallows a real 0
    expect(panel).toContain("needs_fx_conversion");
    expect(panel).toContain("does not convert between currencies");
    expect(panel).toContain("formatMinor(");
    expect(panel).not.toMatch(/\/\s*100\b/);
    expect(panel).not.toMatch(/\.reduce\(/);
  });
});
