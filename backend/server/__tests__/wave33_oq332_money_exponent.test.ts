/**
 * WAVE 33 · OQ-33-2 — the five hardcoded-exponent money sinks, EXECUTED.
 *
 * WHY THIS FILE EXISTS. Five separate sites converted major units to minor
 * units with a hardcoded `× 100`, i.e. an assumed ISO 4217 exponent of 2:
 *
 *   1. server/wave9ReportingStore.ts   toMinorUnits(major)      (2 call sites)
 *   2. server/routes.ts                closed-round raised amount
 *   3. server/routes.ts                30-day soft-circle amount
 *   4. server/track1Routes.ts          waterfall invested amount
 *   5. server/track4Routes.ts          CAST(ROUND(sc.amount * 100)) — in SQL
 *
 * For JPY (exponent 0) every one of them is wrong by a factor of 100. This is
 * the SEVENTH instance of the class in this build, and the reason the earlier
 * six were invisible is identical every time: NO MONEY TEST IN THE REPOSITORY
 * USED A CURRENCY WHOSE EXPONENT IS NOT 2. A USD fixture passes against the
 * defect and against the fix, so it measures nothing.
 *
 * Every case here therefore carries a JPY (exponent 0) fixture AND its USD
 * (exponent 2) twin, and asserts BOTH POLES:
 *   · the JPY pole pins the fixed number (¥1,000,000 → 1,000,000 minor), and
 *   · the USD pole pins that the conversion still happens at all
 *     ($1,000,000 → 100,000,000 minor).
 * A mutant that restores `× 100` fails the JPY pole; a mutant that deletes the
 * conversion entirely fails the USD pole. Neither pole alone is sufficient.
 *
 * Assertions are on what each sink EMITS (a returned bundle, an HTTP response
 * body), never on what it consults — the harness lesson of this wave.
 *
 * This file establishes all of its own preconditions and never reads
 * `process.env`. All imports are static.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";

/* The two route families under test sit behind real auth middleware. It is
 * replaced with a pass-through carrying an EXPLICIT, TEST-OWNED admin identity
 * (never a seeded demo persona). Group (G) separately asserts that the SHIPPED
 * routes are still wired to the real middleware, so this stub cannot hide an
 * unauthenticated endpoint. */
const TEST_ACTOR = "u_oq332_admin";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserContext: () => ({
      isAuthed: true,
      isAdmin: true,
      userId: TEST_ACTOR,
      founder: { companies: [] },
    }),
  };
});

import { rawDb } from "../db/connection";
import { buildInvestorMetrics, ensureWave9Schema, recordCashflow } from "../wave9ReportingStore";
import { currencyExponent, toMinor } from "../lib/currency";
import { registerAdminCompaniesFullRoute } from "../routes";
import { createRound, updateRound, getRoundById } from "../roundsStore";
import { computePortfolioAnalyticsFor, type RealPosition } from "../portfolioAnalyticsStore";
import { registerTrack1Routes } from "../track1Routes";
import { registerTrack4Routes } from "../track4Routes";

const TENANT = "t_oq332";
const CO_JPY = "co_oq332_jpy";
const CO_USD = "co_oq332_usd";
let RD_JPY = "";
let RD_USD = "";

/** ¥1,000,000 / $1,000,000 expressed in MAJOR units, the shape every one of
 * the five sinks receives. Exponent 0 → 1,000,000 minor. Exponent 2 →
 * 100,000,000 minor. The two answers differ by exactly the defect's factor. */
const MAJOR = 1_000_000;
const JPY_MINOR = 1_000_000;
const USD_MINOR = 100_000_000;

let app: Express;

/* ── WAVE 71b · D11 — THE COMMON LEG, ON THE RECORD ────────────────────────────
   `GET /api/founder/captable/waterfall` divides everything below the preference
   stack by the company's COMMON share count. Until Wave 71 the route set that
   count equal to the total PREFERRED count (its own comment: "simplified: 1 common
   holder"), so group (C) below measured its currency exponent on top of an invented
   denominator. D11 made the route read the real rows through the securities
   provider `server/routes.ts:7113` hands it, and REFUSE by name
   (`COMMON_SHARES_NOT_ON_RECORD`) when there are none.

   These fixtures therefore now state their own common shares, exactly as they
   already state their own rounds and ledger rows. 8,000,000 is chosen so the
   2-share preferred class's as-converted alternative is negligible and the
   non-participating class demonstrably takes its PREFERENCE — which is the branch
   the exponent has to be able to flip. */
const COMMON_SHARES = 8_000_000;
const SECURITIES: Record<string, Array<Record<string, unknown>>> = {};

function exec(sql: string, args: unknown[] = []): void {
  rawDb().prepare(sql).run(...(args as never[]));
}

beforeAll(() => {
  ensureWave9Schema();

  /* ---- preconditions: two companies, two priced+closed rounds ---------- */
  for (const [co, name] of [[CO_JPY, "OQ332 JPY KK"], [CO_USD, "OQ332 USD Inc"]] as const) {
    exec(
      `INSERT OR REPLACE INTO companies (id, tenant_id, name, legal_name, sector, stage, hq, is_demo)
       VALUES (?,?,?,?,?,?,?,0)`,
      [co, TENANT, name, name, "fintech", "seed", "Tokyo"],
    );
  }

  /* Rounds go through the store's own writer, not raw SQL: `getRoundsForCompany`
   * and `getRoundById` both read the store's cache, so a row inserted behind
   * the store's back would be invisible and every case below would pass
   * against an empty round set. */
  const mkRound = (co: string, cur: string): string => {
    const r = createRound({
      companyId: co,
      name: `OQ332 ${cur} Seed`,
      type: "seed",
      targetAmount: MAJOR,
      /* price per share, MAJOR units: 2 shares × 500,000 = the same MAJOR total */
      pricePerShare: 500_000,
      currency: cur,
      closeDate: "2026-01-15",
      actorUserId: TEST_ACTOR,
    });
    const up = updateRound(r.id, { state: "closed", raisedAmount: MAJOR }, { actor: TEST_ACTOR });
    if (!up.ok) throw new Error(`fixture round could not be closed: ${up.error}`);
    /* ── WAVE 71b · D11 — THE NEGOTIATED TERM, ON THE RECORD ─────────────────
       This is a PRICED equity class (`pricePerShare` above, closed, with a
       committed `instrument_class: "equity"` ledger row). Whether it takes its
       money back first, and at what multiple, is a term of its charter — NVCA
       Model Certificate of Incorporation Art. IV Sec. 2.1. Until Wave 71 this
       route assumed "1x non-participating" for every class on every cap table,
       which is why this fixture never had to say it. It now says it. The value is
       the market standard and is the same for both currencies, so it cannot be
       what makes the two waterfalls differ — the exponent still is. */
    const terms = updateRound(
      r.id,
      { liquidationPreference: "1x non-participating" },
      { actor: TEST_ACTOR },
    );
    if (!terms.ok) throw new Error(`fixture liquidation preference not recorded: ${terms.error}`);
    const readBack = getRoundById(r.id) as unknown as { liquidationPreference?: string | null };
    if (String(readBack?.liquidationPreference ?? "") !== "1x non-participating") {
      throw new Error("fixture liquidation preference did not persist");
    }
    return r.id;
  };
  RD_JPY = mkRound(CO_JPY, "JPY");
  RD_USD = mkRound(CO_USD, "USD");

  /* ---- soft circles, one per company, MAJOR-only (amount_minor = 0) ----
   * amount_minor is deliberately left at 0 so sink 5's fallback branch — the
   * one that used to do the conversion IN SQL — is the branch under test. */
  for (const [scid, co, rid, cur] of [
    ["sc_oq332_jpy", CO_JPY, RD_JPY, "JPY"],
    ["sc_oq332_usd", CO_USD, RD_USD, "USD"],
  ] as const) {
    exec(
      `INSERT OR REPLACE INTO soft_circles
         (id, tenant_id, round_id, company_id, investor_user_id, investor_name,
          amount, amount_minor, currency, status, source_type, source_id, created_at)
       VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?)`,
      [
        scid, TENANT, rid, co, "u_oq332_inv", "OQ332 Investor",
        MAJOR, cur, "confirmed", "direct", null, new Date().toISOString(),
      ],
    );
  }

  /* ---- committed cap-table ledger rows, MAJOR units on `amount` -------- */
  let seq = 900_000;
  for (const [id, co, rid, cur] of [
    ["cc_oq332_jpy", CO_JPY, RD_JPY, "JPY"],
    ["cc_oq332_usd", CO_USD, RD_USD, "USD"],
  ] as const) {
    exec(
      `INSERT OR REPLACE INTO captable_commits
         (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
          amount, currency, shares, state, prev_hash, hash,
          reconcile_match, compliance_hold, instrument_class)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,'equity')`,
      [
        id, TENANT, seq++, "2026-02-01T00:00:00.000Z", `inv_${id}`, rid, co, "u_oq332_inv",
        String(MAJOR), cur, "2", "committed", "0".repeat(64), `h_${id}`,
      ],
    );
  }

  /* ---- mark thresholds: rows, not literals. Without these the mark
   * derivation throws and every position reads UNMARKED, which would make the
   * residual-value pole (sink 1's positive half) vacuously null. ---------- */
  exec(
    `INSERT OR REPLACE INTO wave9_reporting_config
       (key, value_json, value_type, description, updated_by, updated_at)
     VALUES ('marks.stale_warn_days','180','number','test precondition',?,?)`,
    [TEST_ACTOR, new Date().toISOString()],
  );
  exec(
    `INSERT OR REPLACE INTO wave9_reporting_config
       (key, value_json, value_type, description, updated_by, updated_at)
     VALUES ('marks.stale_expired_days','365000','number','test precondition',?,?)`,
    [TEST_ACTOR, new Date().toISOString()],
  );
  exec(
    `INSERT OR REPLACE INTO wave9_reporting_config
       (key, value_json, value_type, description, updated_by, updated_at)
     VALUES ('marks.auto_derive','true','boolean','test precondition',?,?)`,
    [TEST_ACTOR, new Date().toISOString()],
  );

  /* One common holder per company, so D11(3)'s common leg has real rows to read.
     Shape mirrors what `buildCompanySecurities` returns and what
     `readCompanyCommonRows` filters on: `instrument === "common"`, integer shares. */
  for (const co of [CO_JPY, CO_USD]) {
    SECURITIES[co] = [
      { id: `sec_${co}_founder`, holderName: "OQ332 Founder", instrument: "common", shares: COMMON_SHARES },
    ];
  }

  app = express();
  app.use(express.json());
  registerAdminCompaniesFullRoute(app);
  /* WAVE 71b — the securities provider, wired exactly as production wires it
     (`server/routes.ts:7113` passes `buildCompanySecurities`). Registering without
     one leaves the waterfall permanently refusing `COMMON_SHARES_NOT_ON_RECORD`,
     which would make group (C) measure a refusal instead of an exponent. */
  registerTrack1Routes(app, (cid: string) => (SECURITIES[cid] ?? []) as never);
  registerTrack4Routes(app);
});

/* ── (F) THE FIXTURES THIS FILE'S CONCLUSIONS REST ON ─────────────────────── */

describe("F — fixtures and the exponent table itself", () => {
  it("F1 JPY really is exponent 0 and USD really is exponent 2", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
    // Without this inequality every case below would be a tautology.
    expect(currencyExponent("JPY")).not.toBe(currencyExponent("USD"));
  });

  it("F2 the two fixture answers differ by exactly the defect's factor of 100", () => {
    expect(toMinor(MAJOR, "JPY")).toBe(JPY_MINOR);
    expect(toMinor(MAJOR, "USD")).toBe(USD_MINOR);
    expect(USD_MINOR).toBe(JPY_MINOR * 100);
  });

  it("F3 the seeded rows really landed, in MAJOR units, with the currency set", () => {
    // Read back through the STORE, which is what all four route sinks consult.
    const rd = getRoundById(RD_JPY);
    expect(rd).toBeTruthy();
    expect(rd!.currency).toBe("JPY");
    expect(Number(rd!.raisedAmount)).toBe(MAJOR);
    expect(rd!.state).toBe("closed");
    expect(Number(rd!.pricePerShare)).toBe(500_000);

    const sc = rawDb()
      .prepare(`SELECT amount, amount_minor, currency FROM soft_circles WHERE id = ?`)
      .get("sc_oq332_jpy") as { amount: number; amount_minor: number; currency: string };
    expect(Number(sc.amount)).toBe(MAJOR);
    // The fallback branch is the one under test; if this were already > 0 the
    // conversion would never run and sink 5's case would pass vacuously.
    expect(Number(sc.amount_minor)).toBe(0);
    expect(sc.currency).toBe("JPY");
  });
});

/* ── (A) SINK 1 — server/wave9ReportingStore.ts, BOTH call sites ──────────── */

describe("A — sink 1: buildInvestorMetrics minor-unit conversion", () => {
  const commit = (companyId: string, roundId: string, currency: string) => ({
    companyId,
    roundId,
    amount: String(MAJOR),
    shares: "2",
    currency,
    ts: "2026-02-01T00:00:00.000Z",
  });

  it("A1 JPY (exponent 0) contributes ¥1,000,000 as 1,000,000 minor units", () => {
    const b = buildInvestorMetrics([commit(CO_JPY, RD_JPY, "JPY")], { asOf: "2026-03-01" });
    expect(b.contributedMinor).toBe(JPY_MINOR);
  });

  it("A2 USD (exponent 2) contributes $1,000,000 as 100,000,000 minor units", () => {
    const b = buildInvestorMetrics([commit(CO_USD, RD_USD, "USD")], { asOf: "2026-03-01" });
    expect(b.contributedMinor).toBe(USD_MINOR);
  });

  it("A3 the two currencies really produce different answers for the same major amount", () => {
    const jpy = buildInvestorMetrics([commit(CO_JPY, RD_JPY, "JPY")], { asOf: "2026-03-01" });
    const usd = buildInvestorMetrics([commit(CO_USD, RD_USD, "USD")], { asOf: "2026-03-01" });
    expect(jpy.contributedMinor).not.toBe(usd.contributedMinor);
    expect(usd.contributedMinor).toBe(jpy.contributedMinor * 100);
  });

  it("A4 the RESIDUAL-VALUE call site (the positive pole) is exponent-driven too", () => {
    const jpy = buildInvestorMetrics([commit(CO_JPY, RD_JPY, "JPY")], { asOf: "2026-03-01" });
    // If the position were UNMARKED the residual would be null and the
    // assertion below would prove nothing about the conversion.
    expect(jpy.markedPositions).toBe(1);
    expect(jpy.unmarkedPositions).toBe(0);
    expect(jpy.residualValueMinor).not.toBeNull();
    // 2 shares × ¥500,000 = ¥1,000,000 → 1,000,000 minor at exponent 0.
    expect(jpy.residualValueMinor).toBe(JPY_MINOR);

    const usd = buildInvestorMetrics([commit(CO_USD, RD_USD, "USD")], { asOf: "2026-03-01" });
    expect(usd.markedPositions).toBe(1);
    expect(usd.residualValueMinor).toBe(USD_MINOR);
  });

  it("A5 both poles are reached through the SAME helper — a zero-exponent currency other than JPY behaves identically", () => {
    const krw = buildInvestorMetrics(
      [{ ...commit(CO_JPY, RD_JPY, "KRW") }],
      { asOf: "2026-03-01" },
    );
    expect(currencyExponent("KRW")).toBe(0);
    expect(krw.contributedMinor).toBe(JPY_MINOR);
    expect(krw.residualValueMinor).toBe(JPY_MINOR);
  });
});

/* ── (E) SINK 6 — server/portfolioAnalyticsStore.ts, sink 1's SECOND PATH ─── */

describe("E — sink 6: computePortfolioAnalyticsFor major-unit rendering", () => {
  const position = (currency: string, companyId: string, roundId: string): RealPosition => ({
    invested: MAJOR,
    currentValue: MAJOR,
    stage: "Seed",
    sector: "fintech",
    vintageYear: 2026,
    companyId,
    roundId,
    shares: 2,
    currency,
    ts: "2026-02-01T00:00:00.000Z",
    markBadge: null as unknown as RealPosition["markBadge"],
  });

  it("E1 JPY: 1,000,000 minor units are rendered back as ¥1,000,000, NOT ¥10,000", () => {
    const a = computePortfolioAnalyticsFor([position("JPY", CO_JPY, RD_JPY)], { asOf: "2026-03-01" });
    expect(a.totalCurrentValue).toBe(MAJOR);
    // The paper gain is the difference between the rendered value and the
    // cost, both in MAJOR units. A /100 here would report a ¥990,000 LOSS.
    expect(a.paperGain).toBe(0);
  });

  it("E2 USD: 100,000,000 minor units are rendered back as $1,000,000", () => {
    const a = computePortfolioAnalyticsFor([position("USD", CO_USD, RD_USD)], { asOf: "2026-03-01" });
    expect(a.totalCurrentValue).toBe(MAJOR);
    expect(a.paperGain).toBe(0);
  });

  it("E3 the REALIZED pole is exponent-driven too — a real ¥250,000 distribution renders as 250,000, not 2,500", () => {
    // A zero-distribution fixture would prove nothing here: 0/100 === 0. The
    // realized pole only discriminates once a NON-ZERO distribution exists,
    // so the test establishes that precondition itself.
    const LP = "u_oq332_lp_realized";
    const DIST_MAJOR = 250_000;
    recordCashflow({
      tenantId: TENANT,
      vehicleKind: "company",
      vehicleId: CO_JPY,
      lpId: LP,
      txnType: "distribution_gain_loss",
      valueDate: "2026-02-15",
      /* JPY, exponent 0 → ¥250,000 IS 250,000 minor units. */
      amountMinor: DIST_MAJOR,
      currency: "JPY",
      createdBy: "oq332-fixture",
    });

    const a = computePortfolioAnalyticsFor(
      [position("JPY", CO_JPY, RD_JPY)],
      { asOf: "2026-03-01", userId: LP },
    );
    expect(a.totalRealized).toBe(DIST_MAJOR);
    expect(a.totalRealized).not.toBe(DIST_MAJOR / 100);

    // USD pole: the same 250,000 MINOR units are only $2,500 in major units,
    // so the two currencies must NOT render the same number.
    const LP_USD = "u_oq332_lp_realized_usd";
    recordCashflow({
      tenantId: TENANT,
      vehicleKind: "company",
      vehicleId: CO_USD,
      lpId: LP_USD,
      txnType: "distribution_gain_loss",
      valueDate: "2026-02-15",
      amountMinor: DIST_MAJOR,
      currency: "USD",
      createdBy: "oq332-fixture",
    });
    const u = computePortfolioAnalyticsFor(
      [position("USD", CO_USD, RD_USD)],
      { asOf: "2026-03-01", userId: LP_USD },
    );
    expect(u.totalRealized).toBe(DIST_MAJOR / 100);
    expect(u.totalRealized).not.toBe(a.totalRealized);
  });
});

/* ── (B) SINKS 2 AND 3 — server/routes.ts admin company aggregate ─────────── */

describe("B — sinks 2 and 3: GET /api/admin/companies/full", () => {
  let rows: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const res = await request(app).get("/api/admin/companies/full");
    expect(res.status).toBe(200);
    rows = (res.body as { rows: Array<Record<string, unknown>> }).rows;
  });

  const row = (id: string) => {
    const r = rows.find((x) => x.id === id);
    expect(r, `the aggregate must actually emit a row for ${id}`).toBeTruthy();
    return r as Record<string, unknown>;
  };

  it("B1 JPY company: raised ¥1,000,000 is EMITTED as 1,000,000 minor units", () => {
    const r = row(CO_JPY);
    expect(r.currency).toBe("JPY");
    expect(r.totalRaisedMinor).toBe(JPY_MINOR);
  });

  it("B2 USD company: raised $1,000,000 is EMITTED as 100,000,000 minor units", () => {
    const r = row(CO_USD);
    expect(r.currency).toBe("USD");
    expect(r.totalRaisedMinor).toBe(USD_MINOR);
  });

  it("B3 JPY company: the 30-day soft-circle total is EMITTED as 1,000,000 minor units", () => {
    const r = row(CO_JPY);
    // A zero count would make the amount assertion vacuous.
    expect(r.softCircles30d).toBe(1);
    expect(r.softCircle30dAmountMinor).toBe(JPY_MINOR);
  });

  it("B4 USD company: the same figure is 100,000,000 minor units", () => {
    const r = row(CO_USD);
    expect(r.softCircles30d).toBe(1);
    expect(r.softCircle30dAmountMinor).toBe(USD_MINOR);
  });

  it("B5 the emitted currency label and the emitted minor amount agree", () => {
    for (const id of [CO_JPY, CO_USD]) {
      const r = row(id);
      const exp = currencyExponent(String(r.currency));
      expect(Number(r.totalRaisedMinor)).toBe(MAJOR * Math.pow(10, exp));
      expect(Number(r.softCircle30dAmountMinor)).toBe(MAJOR * Math.pow(10, exp));
    }
  });
});

/* ── (C) SINK 4 — server/track1Routes.ts founder exit waterfall ───────────── */

describe("C — sink 4: GET /api/founder/captable/waterfall", () => {
  /* The exit is set to TWICE the correct JPY minor figure. Under the fix the
   * preference (¥1,000,000) is covered and ¥1,000,000 is left for common.
   * Under the defect the class believes it invested 100,000,000 minor, the
   * exit no longer covers the preference, and the founder receives NOTHING.
   * The two behaviours are distinguishable in the EMITTED body, not merely in
   * an internal figure. */
  const EXIT = JPY_MINOR * 2;

  it("C1 JPY: an exit of ¥2,000,000 covers the ¥1,000,000 preference and leaves the founder ¥1,000,000", async () => {
    const res = await request(app)
      .get("/api/founder/captable/waterfall")
      .query({ companyId: CO_JPY, exitValuationMinor: String(EXIT) });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Non-empty: an empty breakdown would satisfy any sum assertion trivially.
    expect(Array.isArray(res.body.byShareClass)).toBe(true);
    expect(res.body.byShareClass.length).toBe(1);
    /* ── WAVE 77 · R72 — THE TYPE CHANGED, THE PROOF DID NOT ──────────────────
       `lpProceeds` / `founderProceeds` are now EXACT DECIMAL TEXT, not JSON
       numbers (owner ruling R72, an authorised interface change). The currency
       exponent proof this test exists for is unchanged VALUE FOR VALUE: the same
       ¥1,000,000 preference and the same ¥1,000,000 founder leg, compared against
       the same `JPY_MINOR` constant, now as its decimal string. Nothing was
       widened, no tolerance was introduced and no figure moved. */
    expect(res.body.lpProceeds).toBe(String(JPY_MINOR));
    expect(res.body.founderProceeds).toBe(String(EXIT - JPY_MINOR));
    /* Was `toBeGreaterThan(0)`. The meaning is preserved without narrowing the
       money string back to a double: it is neither zero nor negative. */
    expect(res.body.founderProceeds).not.toBe("0");
    expect(String(res.body.founderProceeds)).not.toMatch(/^-/);
  });

  it("C2 USD: the SAME major amount at exponent 2 exhausts the same exit — the founder receives nothing", async () => {
    const res = await request(app)
      .get("/api/founder/captable/waterfall")
      .query({ companyId: CO_USD, exitValuationMinor: String(EXIT) });
    expect(res.status).toBe(200);
    expect(res.body.byShareClass.length).toBe(1);
    // $1,000,000 = 100,000,000 minor > the 2,000,000-minor exit.
    /* WAVE 77 · R72 — same figures, now as exact decimal text. The founder still
       receives NOTHING, and "nothing" is `"0"`, not `undefined` and not `""`. */
    expect(res.body.lpProceeds).toBe(String(EXIT));
    expect(res.body.founderProceeds).toBe("0");
  });

  it("C3 the two currencies do NOT produce the same waterfall for the same major amount", async () => {
    const [jpy, usd] = await Promise.all([
      request(app).get("/api/founder/captable/waterfall")
        .query({ companyId: CO_JPY, exitValuationMinor: String(EXIT) }),
      request(app).get("/api/founder/captable/waterfall")
        .query({ companyId: CO_USD, exitValuationMinor: String(EXIT) }),
    ]);
    expect(jpy.body.founderProceeds).not.toBe(usd.body.founderProceeds);
  });
});

/* ── (D) SINK 5 — server/track4Routes.ts founder-channel attribution ──────── */

describe("D — sink 5: GET /api/admin/founder-channels/:companyId (was converted IN SQL)", () => {
  it("D1 JPY: the unmigrated soft circle is EMITTED as 1,000,000 minor units", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_JPY}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRaisedMinor).toBe(JPY_MINOR);
    expect(res.body.byChannel.direct.countSCs).toBe(1);
    expect(res.body.byChannel.direct.totalMinor).toBe(JPY_MINOR);
  });

  it("D2 USD: the same major amount is EMITTED as 100,000,000 minor units", async () => {
    const res = await request(app).get(`/api/admin/founder-channels/${CO_USD}`);
    expect(res.status).toBe(200);
    expect(res.body.totalRaisedMinor).toBe(USD_MINOR);
    expect(res.body.byChannel.direct.countSCs).toBe(1);
    expect(res.body.byChannel.direct.totalMinor).toBe(USD_MINOR);
  });

  it("D3 a row that ALREADY carries amount_minor is passed through untouched, in either currency", async () => {
    exec(
      `INSERT OR REPLACE INTO soft_circles
         (id, tenant_id, round_id, company_id, investor_user_id, investor_name,
          amount, amount_minor, currency, status, source_type, source_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        "sc_oq332_jpy_premigrated", TENANT, RD_JPY, CO_JPY, "u_oq332_inv2", "OQ332 Investor 2",
        MAJOR, 777, "JPY", "confirmed", "direct", null, new Date().toISOString(),
      ],
    );
    const res = await request(app).get(`/api/admin/founder-channels/${CO_JPY}`);
    expect(res.status).toBe(200);
    // 1,000,000 (converted) + 777 (stored verbatim, NOT reconverted).
    expect(res.body.totalRaisedMinor).toBe(JPY_MINOR + 777);
    expect(res.body.byChannel.direct.countSCs).toBe(2);
    exec(`DELETE FROM soft_circles WHERE id = ?`, ["sc_oq332_jpy_premigrated"]);
  });
});

/* ── (S) THE SWEEP — the class must not come back ─────────────────────────── */

describe("S — the five sites no longer hold a hardcoded exponent", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const read = (p: string) => strip(fs.readFileSync(p, "utf8"));

  it("S0 the comment stripper actually strips, and still sees code (a stripper that returns \"\" would pass everything)", () => {
    expect(strip("/* Math.round(x * 100) */\nconst a = 1;")).not.toMatch(/Math\.round/);
    expect(strip("// Math.round(x * 100)\nconst a = 1;")).not.toMatch(/Math\.round/);
    expect(strip("/* c */ const a = Math.round(x * 100);")).toMatch(/Math\.round\(x \* 100\)/);
  });

  it("S1 wave9ReportingStore's converter takes a currency and delegates to toMinor", () => {
    const src = read("server/wave9ReportingStore.ts");
    expect(src).toMatch(/function toMinorUnits\(major: number, currency: string\)/);
    expect(src).toMatch(/return toMinor\(major, currency\)/);
    expect(src).not.toMatch(/Math\.round\(major \* 100\)/);
  });

  it("S2 routes.ts's admin aggregate no longer multiplies by a literal 100", () => {
    const src = read("server/routes.ts");
    expect(src).not.toMatch(/Math\.round\(raw \* 100\)/);
    expect(src).not.toMatch(/Math\.round\(\(sc\.amount \?\? 0\) \* 100\)/);
    expect(src).toMatch(/toMinor\(raw, roundCurrency\)/);
    expect(src).toMatch(/toMinor\(sc\.amount \?\? 0, roundCurrency\)/);
  });

  it("S3 track1Routes no longer multiplies the waterfall invested amount by a literal 100", () => {
    const src = read("server/track1Routes.ts");
    expect(src).not.toMatch(/Math\.round\(Number\(e\.amount\) \* 100\)/);
    expect(src).toMatch(/toMinor\(Number\(e\.amount\), roundCurrency\)/);
  });

  it("S4 track4Routes performs no minor-unit arithmetic in SQL at all", () => {
    const src = read("server/track4Routes.ts");
    expect(src).not.toMatch(/ROUND\(sc\.amount \* 100\)/);
    expect(src).not.toMatch(/\* 100\)/);
    /* WAVE 35 · F3 — the conversion still goes through `toMinor` with the
     * ROW'S OWN currency; that currency is now bound to a local (`cur`) first
     * because the same value is also used to PARTITION the totals instead of
     * being discarded after the exponent lookup. The intent of this assertion
     * (no hardcoded exponent; per-row currency drives the conversion) is
     * unchanged — only the expression it is spelled with moved. */
    expect(src).toMatch(/const cur = String\(r\.currency \?\? "USD"\)/);
    expect(src).toMatch(/toMinor\(Number\(r\.amount_major\) \|\| 0, cur\)/);
  });
});

/* ── (G) THE STUB CANNOT HIDE AN UNAUTHENTICATED ENDPOINT ─────────────────── */

describe("G — the SHIPPED routes are wired to the real middleware", () => {
  it("G1 the admin aggregate is registered behind requireAdmin in the shipped source", () => {
    const src = fs.readFileSync("server/routes.ts", "utf8");
    expect(src).toMatch(/app\.get\("\/api\/admin\/companies\/full", requireAdmin, adminCompaniesFullHandler\)/);
    expect(src).toMatch(/app\.get\("\/api\/admin\/companies", requireAdmin, adminCompaniesFullHandler\)/);
  });

  it("G2 the two track routes are registered behind requireAuth and carry their own identity check", () => {
    const t1 = fs.readFileSync("server/track1Routes.ts", "utf8");
    expect(t1).toMatch(/app\.get\(\s*"\/api\/founder\/captable\/waterfall"[\s\S]{0,200}requireAuth/);
    expect(t1).toMatch(/if \(!ownsCompany\(ctx, companyId\)\)/);

    const t4 = fs.readFileSync("server/track4Routes.ts", "utf8");
    expect(t4).toMatch(/app\.get\("\/api\/admin\/founder-channels\/:companyId", requireAuth, handleFounderChannels\)/);
    expect(t4).toMatch(/if \(!ownsCompany\(ctx, companyId\)\)/);
  });
});
