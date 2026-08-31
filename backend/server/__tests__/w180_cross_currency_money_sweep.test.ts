/**
 * WAVE 180 · ITEM A — THE CROSS-CURRENCY MONEY SWEEP, EXECUTED (server half).
 *
 * WHY THIS FILE EXISTS. Wave 178 listed seven sites that were still adding minor
 * units across ISO 4217 codes into a single total and then labelling that total
 * with one currency. Owner ruling R149.4 records that live data really does hold
 * CA$1,200.00 and HK$2,000,000.00 alongside USD, so on the owner's data these are
 * not theoretical: they are wrong numbers on screen and, in one case, a wrong
 * number PERSISTED to a monthly snapshot row.
 *
 * WHAT THIS FILE PROVES, and the shape of every proof. Each site gets:
 *
 *   · a MIXED fixture — USD + CAD + HKD, exactly the live combination — asserting
 *     that the site now REFUSES a single figure, names the currencies, and
 *     reports the per-currency truth; and
 *   · a SINGLE-CURRENCY NEGATIVE CONTROL asserting that the ordinary case still
 *     produces its ordinary number. Without the control, deleting the total
 *     altogether would pass — a refusal that refuses everything measures nothing.
 *
 * WHY MIXED FIXTURES AND NOT LIVE DATA. The local database in this checkout holds
 * no CAD or HKD row at all (364 subscriptions, all USD; `rounds.currency` NULL on
 * every one of 1045 rows; `spvs.deployment_fee_currency` NULL on all six;
 * `partner_billing_entries` and `soft_circles` empty). CA$/HK$ exist in
 * production only. Every proof here is therefore FIXTURE-BASED by necessity, and
 * that is stated rather than glossed: these tests demonstrate the code's
 * behaviour on mixed input, not that the owner's specific production rows are now
 * rendered correctly.
 *
 * NO EXCHANGE RATE IS ASSERTED ANYWHERE, because none exists in this repository.
 * A test that expected some converted total would be inventing an FX rate in the
 * assertion, which is the same defect wearing a lab coat.
 *
 * This file establishes all of its own preconditions, never reads `process.env`,
 * and uses only static imports.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const TEST_ACTOR = "u_w180_admin";
const TENANT = "t_w180";

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
import { buildInvestorMetrics, snapshotInvestor, ensureWave9Schema } from "../wave9ReportingStore";
import { currencyExponent, toMinor } from "../lib/currency";
import { registerAdminCompaniesFullRoute } from "../routes";
import { registerPartnerFeeAdminRoutes } from "../lib/partnerFeeAdminRoutes";
import { createRound, updateRound } from "../roundsStore";

function exec(sql: string, args: unknown[] = []): void {
  rawDb().prepare(sql).run(...(args as never[]));
}

/* THE THREE LIVE CURRENCIES, and their real ISO exponents. HKD and CAD are both
 * exponent 2 like USD, so an exponent bug cannot be what these tests detect —
 * they detect the ADDITION of unlike units, which is the wave 180 defect. JPY
 * appears only where an exponent-0 control is also wanted. */
const CCY = ["USD", "CAD", "HKD"] as const;

describe("W180 preconditions — the fixture currencies are real and distinct", () => {
  it("P1 USD, CAD and HKD are three DIFFERENT ISO codes the platform can format", () => {
    expect(new Set(CCY).size).toBe(3);
    for (const c of CCY) expect(currencyExponent(c)).toBe(2);
  });

  it("P2 the only FX rows on this platform are a frozen seed unfit for a GP-facing total", () => {
    /* THIS TEST CHANGED SHAPE MID-WAVE, and the reason is worth recording.
     *
     * The wave 180 brief states there is no rate source on this platform. That is
     * very nearly true but not exactly true, and the difference matters. Two
     * tables exist:
     *
     *   · `fx_rate_snapshot` (migration 0122, STRICT, integer numerator and
     *     denominator, `source` attributed, `as_of_date` constrained, and made
     *     append-only by trg_fx_no_update / trg_fx_no_delete). This is what a
     *     defensible rate source looks like on this platform. IT IS EMPTY.
     *
     *   · `fx_rates` — a flat REAL rate per currency, created and seeded by
     *     INSERT OR IGNORE in server/db/connection.ts:5043-5054 as SEVEN
     *     HARDCODED CONSTANTS all stamped 2026-06-21. It is read by exactly one
     *     caller, paymentStore.softCircleRates(), for the soft-circle currency
     *     picker, and by nothing else.
     *
     * So converting a partner's P&L or an investor's contributed capital through
     * `fx_rates` would mean: a float rate, from a code-seeded constant, with no
     * provenance, frozen months before the reporting date, silently applied to a
     * financial figure a GP acts on. That is the SAME defect as hardcoding 1.35
     * in the reducer, with a table in between. The wave 180 refusals therefore
     * stand, and this test pins the two facts that justify them.
     *
     * If `fx_rate_snapshot` is ever populated from a real, dated, attributed
     * feed, THIS ASSERTION IS THE TRIPWIRE: it fails, and whoever sees it should
     * revisit these refusals rather than leave them wrong in the other direction. */
    const snapshotRows = (rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM fx_rate_snapshot`)
      .get() as { n: number }).n;
    expect(snapshotRows).toBe(0);

    const seed = rawDb()
      .prepare(`SELECT currency_code, updated_at, typeof(rate) AS t FROM fx_rates ORDER BY currency_code`)
      .all() as Array<{ currency_code: string; updated_at: string; t: string }>;
    /* Every row is a float, and every row carries the one seed timestamp. */
    expect(seed.length).toBeGreaterThan(0);
    for (const r of seed) {
      expect(r.t).toBe("real");
      expect(r.updated_at).toBe("2026-06-21T00:00:00Z");
    }
    /* And CAD and HKD — the two live currencies from R149.4 — are among them, so
     * the temptation is real and the refusal is a deliberate choice, not an
     * accident of missing data. */
    const codes = seed.map((r) => r.currency_code);
    expect(codes).toContain("CAD");
    expect(codes).toContain("HKD");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 1 — server/lib/partnerFeeAdminRoutes.ts
 *   GET /api/admin/partner-pl  ·  was: totals = {pending:0,paid:0,all:0}
 *   summed over commission_minor with no currency key at all.
 * ════════════════════════════════════════════════════════════════════════ */
describe("SITE 1 — admin partner P&L totals", () => {
  let app: Express;
  const PARTNER_MIXED = "c_w180_partner_mixed";
  const PARTNER_SINGLE = "c_w180_partner_single";

  beforeAll(() => {
    /* Three SPVs, one per currency, so the entry rows have a currency to derive
     * THROUGH — `partner_billing_entries` has no currency column of its own. */
    for (const c of CCY) {
      exec(
        `INSERT OR REPLACE INTO spvs (id, tenant_id, partner_id, name, deployment_fee_currency, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
        [`spv_w180_${c}`, TENANT, PARTNER_MIXED, `W180 ${c} SPV`, c, "2026-08-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z"],
      );
    }
    /* NO `contacts` ROW IS CREATED, deliberately. The route joins contacts with a
     * LEFT JOIN purely to decorate each entry with `partnerName`, so a partner
     * with no contact row still produces every entry and every total. Omitting it
     * keeps this fixture off the contacts revision-hash chain (created_by,
     * prev_revision_hash, revision_hash, version), which has nothing to do with
     * currency and whose shape could drift under another wave. */

    /* MIXED partner: one SPV-fee entry per currency. Amounts are deliberately
     * DIFFERENT so a bug that returned any one of them, or their sum, is
     * distinguishable from a refusal. */
    const mixed: Array<[string, string, number, string]> = [
      ["pbe_w180_usd", "USD", 500_00, "pending"],
      ["pbe_w180_cad", "CAD", 1_200_00, "paid"],
      ["pbe_w180_hkd", "HKD", 2_000_000_00, "pending"],
    ];
    for (const [id, c, minor, status] of mixed) {
      exec(
        `INSERT OR REPLACE INTO partner_billing_entries
           (id, partner_id, deal_ref, entry_kind, amount_funded_minor, tier_at_funding,
            commission_pct, commission_minor, status, spv_fund_id, computed_via, created_at)
         VALUES (?,?,?, 'spv_deployment_fee', ?, 'gold', 0.02, ?, ?, ?, 'w180_fixture', ?)`,
        [id, PARTNER_MIXED, `deal_${id}`, minor * 50, minor, status, `spv_w180_${c}`, "2026-08-01T00:00:00.000Z"],
      );
    }

    /* SINGLE-CURRENCY CONTROL: two CAD entries for a different partner. CAD, not
     * USD, precisely so a fix that hardcoded USD as "the" answer still fails. */
    for (const [id, minor, status] of [
      ["pbe_w180_ctl_a", 1_200_00, "pending"],
      ["pbe_w180_ctl_b", 800_00, "paid"],
    ] as const) {
      exec(
        `INSERT OR REPLACE INTO partner_billing_entries
           (id, partner_id, deal_ref, entry_kind, amount_funded_minor, tier_at_funding,
            commission_pct, commission_minor, status, spv_fund_id, computed_via, created_at)
         VALUES (?,?,?, 'spv_deployment_fee', ?, 'gold', 0.02, ?, ?, 'spv_w180_CAD', 'w180_fixture', ?)`,
        [id, PARTNER_SINGLE, `deal_${id}`, minor * 50, minor, status, "2026-08-01T00:00:00.000Z"],
      );
    }

    app = express();
    app.use(express.json());
    registerPartnerFeeAdminRoutes(app);
  });

  it("S1.1 MIXED (USD+CAD+HKD): no COMBINED total is returned, and the reason is named", async () => {
    const res = await request(app).get(`/api/admin/partner-pl?partnerId=${PARTNER_MIXED}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3); // a zero-row fixture would make everything below vacuous
    expect(res.body.totalsAvailable).toBe(false);
    expect(res.body.totalsUnavailableReason).toBe("needs_fx_conversion");
    expect(res.body.totals.all).toBeNull();
    expect(res.body.totalsCurrency).toBeNull();
    expect(res.body.totalsCurrencyByBucket.all).toBeNull();
    expect([...res.body.totalsCurrencies].sort()).toEqual(["CAD", "HKD", "USD"]);
  });

  it("S1.1b MIXED: a SUB-bucket that is single-currency keeps its real figure AND its own label", async () => {
    /* WHY THIS CASE EXISTS. The fixture settles only the CAD entry, so the `paid`
     * bucket is entirely CAD even though the ledger as a whole spans three
     * currencies. Withholding that subtotal would throw away a fact the platform
     * genuinely knows; emitting it under `totalsCurrency` (which is null here)
     * would let a consumer's `|| "USD"` default print CA$1,200.00 as $1,200.00 —
     * the wave 180 defect one level down. The figure and its label therefore
     * travel together, per bucket. */
    const res = await request(app).get(`/api/admin/partner-pl?partnerId=${PARTNER_MIXED}`);
    expect(res.body.totals.paid).toBe(1_200_00);
    expect(res.body.totalsCurrencyByBucket.paid).toBe("CAD");
    /* And the bucket that IS mixed carries no figure and no label — the two are
     * null together, never one without the other. */
    expect(res.body.totals.pending).toBeNull();
    expect(res.body.totalsCurrencyByBucket.pending).toBeNull();
    for (const k of ["all", "paid", "pending"] as const) {
      expect(res.body.totals[k] === null).toBe(res.body.totalsCurrencyByBucket[k] === null);
    }
  });

  it("S1.2 MIXED: the pre-fix wrong answer is specifically NOT returned", async () => {
    const res = await request(app).get(`/api/admin/partner-pl?partnerId=${PARTNER_MIXED}`);
    /* The old code returned 500_00 + 1_200_00 + 2_000_000_00 = 200_170_000 and
     * called it dollars. Pinning that exact integer as forbidden is what makes
     * this test fail if the reducer is ever restored. */
    const WRONG = 500_00 + 1_200_00 + 2_000_000_00;
    expect(res.body.totals.all).not.toBe(WRONG);
    expect(JSON.stringify(res.body.totals)).not.toContain(String(WRONG));
  });

  it("S1.3 MIXED: the per-currency breakdown carries each currency's own untouched figure", async () => {
    const res = await request(app).get(`/api/admin/partner-pl?partnerId=${PARTNER_MIXED}`);
    const byAll: Array<{ currency: string; minor: number }> = res.body.totalsByCurrency.all;
    const get = (c: string) => byAll.find((r) => r.currency === c);
    expect(get("USD")!.minor).toBe(500_00);
    expect(get("CAD")!.minor).toBe(1_200_00);
    expect(get("HKD")!.minor).toBe(2_000_000_00);
    /* Status keying survives the split: CAD was the only paid entry. */
    const byPaid: Array<{ currency: string; minor: number }> = res.body.totalsByCurrency.paid;
    expect(byPaid.find((r) => r.currency === "CAD")!.minor).toBe(1_200_00);
    expect(byPaid.find((r) => r.currency === "USD")).toBeUndefined();
  });

  it("S1.4 NEGATIVE CONTROL — single-currency (CAD) still returns one real total, labelled CAD", async () => {
    const res = await request(app).get(`/api/admin/partner-pl?partnerId=${PARTNER_SINGLE}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.totalsAvailable).toBe(true);
    expect(res.body.totalsCurrency).toBe("CAD");
    expect(res.body.totals.all).toBe(1_200_00 + 800_00);
    expect(res.body.totals.pending).toBe(1_200_00);
    expect(res.body.totals.paid).toBe(800_00);
    /* And it is NOT silently relabelled USD, which is what the page used to do. */
    expect(res.body.totalsCurrency).not.toBe("USD");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 3 — server/wave9ReportingStore.ts  buildInvestorMetrics / snapshotInvestor
 *   was: currency = positions[0].currency, with residualValueMinor and the
 *   computeFundMetrics flow array summed across every currency, and the wrong
 *   label then PERSISTED by snapshotInvestor.
 * ════════════════════════════════════════════════════════════════════════ */
describe("SITE 3 — investor metric bundle", () => {
  const CO: Record<string, string> = {};
  const RD: Record<string, string> = {};
  const MAJOR: Record<string, number> = { USD: 500, CAD: 1_200, HKD: 2_000_000 };

  beforeAll(() => {
    ensureWave9Schema();
    /* Marks config as ROWS, not literals — without these the mark derivation
     * throws, every position reads UNMARKED, and the residual-value pole would be
     * vacuously null in both the mixed and the control case. */
    for (const [k, v] of [
      ["marks.stale_warn_days", "180"],
      ["marks.stale_expired_days", "365000"],
      ["marks.auto_derive", "true"],
    ] as const) {
      exec(
        `INSERT OR REPLACE INTO wave9_reporting_config (key, value_json, value_type, description, updated_by, updated_at)
         VALUES (?,?,?,'w180 test precondition',?,?)`,
        [k, v, k === "marks.auto_derive" ? "boolean" : "number", TEST_ACTOR, new Date().toISOString()],
      );
    }
    for (const c of CCY) {
      const co = `co_w180_${c}`;
      CO[c] = co;
      exec(
        `INSERT OR REPLACE INTO companies (id, tenant_id, name, legal_name, sector, stage, hq, is_demo)
         VALUES (?,?,?,?,'fintech','seed','Toronto',0)`,
        [co, TENANT, `W180 ${c} Co`, `W180 ${c} Co`],
      );
      /* Through the store's own writer: getRoundsForCompany reads the store's
       * cache, so a raw INSERT would be invisible and the marks would never
       * derive. 2 shares × (MAJOR/2) keeps the marked value equal to MAJOR. */
      const r = createRound({
        companyId: co,
        name: `W180 ${c} Seed`,
        type: "seed",
        targetAmount: MAJOR[c],
        pricePerShare: MAJOR[c] / 2,
        currency: c,
        closeDate: "2026-01-15",
        actorUserId: TEST_ACTOR,
      });
      const up = updateRound(r.id, { state: "closed", raisedAmount: MAJOR[c] }, { actor: TEST_ACTOR });
      if (!up.ok) throw new Error(`w180 fixture round not closed: ${up.error}`);
      RD[c] = r.id;
    }
  });

  const commit = (c: string) => ({
    companyId: CO[c]!,
    roundId: RD[c]!,
    amount: String(MAJOR[c]),
    shares: "2",
    currency: c,
    ts: "2026-02-01T00:00:00.000Z",
  });

  it("S3.1 MIXED (USD+CAD+HKD): every money scalar is withheld and the currency label is null", () => {
    const b = buildInvestorMetrics([commit("USD"), commit("CAD"), commit("HKD")], { asOf: "2026-03-01" });
    expect(b.positions).toHaveLength(3); // a 0-position bundle would prove nothing
    expect(b.metricsAvailable).toBe(false);
    expect(b.currency).toBeNull();
    expect(b.contributedMinor).toBeNull();
    expect(b.distributedMinor).toBeNull();
    expect(b.residualValueMinor).toBeNull();
    expect([...b.currencies].sort()).toEqual(["CAD", "HKD", "USD"]);
  });

  it("S3.2 MIXED: the refusal states the reason and names all three currencies", () => {
    const b = buildInvestorMetrics([commit("USD"), commit("CAD"), commit("HKD")], { asOf: "2026-03-01" });
    expect(b.metricsUnavailable).not.toBeNull();
    expect(b.metricsUnavailable!.reason).toBe("needs_fx_conversion");
    for (const c of CCY) expect(b.metricsUnavailable!.message).toContain(c);
    expect(b.metricsUnavailable!.message.toLowerCase()).toContain("exchange rate");
    /* Not a blank and not a fabricated zero — the two forbidden shapes. */
    expect(b.metricsUnavailable!.message.trim().length).toBeGreaterThan(40);
  });

  it("S3.3 MIXED: the pre-fix summed figure is specifically NOT produced under any label", () => {
    const b = buildInvestorMetrics([commit("USD"), commit("CAD"), commit("HKD")], { asOf: "2026-03-01" });
    const WRONG = toMinor(500, "USD") + toMinor(1_200, "CAD") + toMinor(2_000_000, "HKD");
    expect(b.contributedMinor).not.toBe(WRONG);
    expect(b.residualValueMinor).not.toBe(WRONG);
  });

  it("S3.4 MIXED: the per-currency breakdown holds each currency's own real figure", () => {
    const b = buildInvestorMetrics([commit("USD"), commit("CAD"), commit("HKD")], { asOf: "2026-03-01" });
    const get = (c: string) => b.byCurrency.find((r) => r.currency === c);
    for (const c of CCY) {
      expect(get(c), `a bucket for ${c} must exist`).toBeTruthy();
      expect(get(c)!.positions).toBe(1);
      expect(get(c)!.contributedMinor).toBe(toMinor(MAJOR[c]!, c));
    }
  });

  it("S3.5 MIXED: the DURABLE snapshot write is REFUSED rather than written with a wrong label", () => {
    const id = snapshotInvestor(TENANT, "u_w180_inv_mixed", [commit("USD"), commit("CAD"), commit("HKD")], "2026-03-01");
    expect(id).toBeNull();
    const rows = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM portfolio_metric_snapshot WHERE subject_id = ?`)
      .get("u_w180_inv_mixed") as { n: number };
    expect(rows.n).toBe(0);
  });

  it("S3.6 NEGATIVE CONTROL — single-currency (CAD) bundle still reports real figures in CAD", () => {
    const b = buildInvestorMetrics([commit("CAD")], { asOf: "2026-03-01" });
    expect(b.metricsAvailable).toBe(true);
    expect(b.currency).toBe("CAD");
    expect(b.metricsUnavailable).toBeNull();
    expect(b.contributedMinor).toBe(toMinor(1_200, "CAD"));
    expect(b.markedPositions).toBe(1);
    expect(b.unmarkedPositions).toBe(0);
    expect(b.residualValueMinor).toBe(toMinor(1_200, "CAD"));
  });

  it("S3.7 NEGATIVE CONTROL — the single-currency snapshot IS still written", () => {
    const id = snapshotInvestor(TENANT, "u_w180_inv_single", [commit("CAD")], "2026-04-01");
    expect(id).not.toBeNull();
    const row = rawDb()
      .prepare(`SELECT currency FROM portfolio_metric_snapshot WHERE subject_id = ? ORDER BY period_start DESC LIMIT 1`)
      .get("u_w180_inv_single") as { currency: string } | undefined;
    expect(row?.currency).toBe("CAD");
  });

  it("S3.8 two currencies is enough — USD+HKD alone refuses, so the rule is not '3 or more'", () => {
    const b = buildInvestorMetrics([commit("USD"), commit("HKD")], { asOf: "2026-03-01" });
    expect(b.metricsAvailable).toBe(false);
    expect(b.currency).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * SITE 6 — server/routes.ts  GET /api/admin/companies/full
 *   was: raised and 30-day soft-circle amounts accumulated with the ROUND's
 *   currency hoisted once per company, across rows that carry their own.
 * ════════════════════════════════════════════════════════════════════════ */
describe("SITE 6 — admin companies aggregate", () => {
  let app: Express;
  const CO_MIXED = "co_w180_mixed_raise";
  const CO_SINGLE = "co_w180_single_raise";
  let rows: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    for (const [id, name] of [[CO_MIXED, "W180 Mixed Raise Inc"], [CO_SINGLE, "W180 Single Raise Inc"]] as const) {
      exec(
        `INSERT OR REPLACE INTO companies (id, tenant_id, name, legal_name, sector, stage, hq, is_demo)
         VALUES (?,?,?,?,'fintech','seed','Hong Kong',0)`,
        [id, TENANT, name, name],
      );
    }
    /* MIXED company: three CLOSED rounds, one per currency, each with its own
     * raised amount. Through the store's writer so the aggregate can see them. */
    const majors: Record<string, number> = { USD: 500, CAD: 1_200, HKD: 2_000_000 };
    for (const c of CCY) {
      const r = createRound({
        companyId: CO_MIXED,
        name: `W180 mixed ${c}`,
        type: "seed",
        targetAmount: majors[c],
        currency: c,
        closeDate: "2026-01-15",
        actorUserId: TEST_ACTOR,
      });
      const up = updateRound(r.id, { state: "closed", raisedAmount: majors[c] }, { actor: TEST_ACTOR });
      if (!up.ok) throw new Error(`w180 site6 fixture round not closed: ${up.error}`);
    }
    /* SINGLE-CURRENCY CONTROL: one closed HKD round. HKD, not USD, so a fix that
     * defaults everything to dollars still fails here. */
    const ctl = createRound({
      companyId: CO_SINGLE,
      name: "W180 single HKD",
      type: "seed",
      targetAmount: 2_000_000,
      currency: "HKD",
      closeDate: "2026-01-15",
      actorUserId: TEST_ACTOR,
    });
    const upc = updateRound(ctl.id, { state: "closed", raisedAmount: 2_000_000 }, { actor: TEST_ACTOR });
    if (!upc.ok) throw new Error(`w180 site6 control round not closed: ${upc.error}`);

    app = express();
    app.use(express.json());
    registerAdminCompaniesFullRoute(app);
    const res = await request(app).get("/api/admin/companies/full");
    expect(res.status).toBe(200);
    rows = (res.body.companies ?? res.body.rows ?? res.body) as Array<Record<string, unknown>>;
  });

  const row = (id: string) => {
    const r = rows.find((x) => x.id === id);
    expect(r, `the aggregate must emit a row for ${id}`).toBeTruthy();
    return r as Record<string, unknown>;
  };

  it("S6.1 MIXED (USD+CAD+HKD): totalRaisedMinor is withheld and the reason is stated", () => {
    const r = row(CO_MIXED);
    expect(r.totalRaisedMinor).toBeNull();
    expect(r.totalRaisedUnavailableReason).toBe("needs_fx_conversion");
    expect([...(r.raisedCurrencies as string[])].sort()).toEqual(["CAD", "HKD", "USD"]);
  });

  it("S6.2 MIXED: the pre-fix summed figure is not emitted", () => {
    const r = row(CO_MIXED);
    const WRONG = toMinor(500, "USD") + toMinor(1_200, "CAD") + toMinor(2_000_000, "HKD");
    expect(r.totalRaisedMinor).not.toBe(WRONG);
  });

  it("S6.3 MIXED: the per-currency breakdown is emitted with each real figure", () => {
    const r = row(CO_MIXED);
    const by = r.totalRaisedByCurrency as Array<{ currency: string; minor: number }>;
    expect(by.length).toBe(3);
    expect(by.find((x) => x.currency === "CAD")!.minor).toBe(toMinor(1_200, "CAD"));
    expect(by.find((x) => x.currency === "HKD")!.minor).toBe(toMinor(2_000_000, "HKD"));
    expect(by.find((x) => x.currency === "USD")!.minor).toBe(toMinor(500, "USD"));
  });

  it("S6.4 NEGATIVE CONTROL — single-currency (HKD) company still emits one real total", () => {
    const r = row(CO_SINGLE);
    expect(r.totalRaisedUnavailableReason).toBeNull();
    expect(r.totalRaisedMinor).toBe(toMinor(2_000_000, "HKD"));
    expect([...(r.raisedCurrencies as string[])]).toEqual(["HKD"]);
  });
});
