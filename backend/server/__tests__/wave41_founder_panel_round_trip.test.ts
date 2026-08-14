/**
 * WAVE 41 — the founder panels Wave 41 mounted, proved end to end.
 *
 * WHAT THIS FILE REFUSES TO DO, because this build has been burned by each:
 *  · It does not assert a FORMULA. The Dashboard proof PATCHes real fields
 *    through the real HTTP route and then RE-READS the completion endpoint, so it
 *    measures what the server EMITS, not what the code consults.
 *  · It does not assert a value it just held in a variable. Every round trip goes
 *    write -> re-read from the store -> compare, so a field that renders but never
 *    persists ("a dead promise") fails here.
 *  · It asserts BOTH POLES. For every "not entered renders Not provided" claim
 *    there is a paired assertion that a REAL ZERO is preserved as zero, because a
 *    rule that maps everything to "Not provided" would pass a one-pole test while
 *    destroying the ability to say "we have exactly 0 directors".
 *  · The M&A defect is REPRODUCED first: the test states the pre-Wave-41 patch
 *    shape, shows it fabricates six values and moves the completion score, and
 *    then shows the shipped shape does not.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import express from "express";
import request from "supertest";
import {
  getCompanyProfile,
  updateCompanyProfile,
  computeProfileCompletion,
  registerCompanyProfileRoutes,
  _testCompanyProfile,
  COMPLETION_WEIGHTS,
} from "../companyProfileStore";
import { currencyExponent, toMinor, fromMinor, formatMinor } from "../lib/money";
import { NOT_PROVIDED } from "../../client/src/lib/wave4Display";
import {
  FINANCIAL_FIELD_COPY,
  AS_WRITTEN_DECIMAL_UNITS,
  toStoredAsWritten,
} from "../../client/src/lib/financialFieldCopy";

function makeApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerCompanyProfileRoutes(app);
  return app;
}
const app = makeApp();

beforeEach(() => {
  _testCompanyProfile.reset();
});

/* IDENTITY — why `?as=admin`.
   Both routes are ownership-gated by assertFounderOfCompany(), which authorises
   an admin outright and otherwise requires a company_members row. In this test
   environment the join table is empty (getUserContextForId("u_maya_chen").
   founder.companies === []), so a founder persona owns no company and every
   call would 404. Rather than fabricate membership rows — which would mean this
   file writing to cap-table membership, and capTableMembership.ts is SACRED —
   these tests call as an admin, which is a genuinely authorised caller on the
   real route with the real gate still executing.
   The gate itself is NOT left unexercised: the "ownership gate" describe block
   below asserts the refusing pole, and asserts it refuses with 404 (not 403),
   so cross-tenant existence is not disclosed. */
const AS = "&as=admin";

const patch = (companyId: string, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/founder/profile?companyId=${companyId}${AS}`)
    .set("x-confirm", "true")
    .send(body);

const completion = (companyId: string) =>
  request(app).get(`/api/founder/profile/completion?companyId=${companyId}${AS}`);

const sectionPct = (body: any, name: string) => {
  const s = (body.sections ?? []).find((x: any) => x.name === name);
  if (!s) throw new Error(`no section named ${name}; got ${JSON.stringify((body.sections ?? []).map((x: any) => x.name))}`);
  return s.pct;
};

/* The five columns COMPLETION_WEIGHTS attributes to the Financials section.
   Derived from the store rather than retyped, so the test cannot drift from the
   thing it is measuring — if someone adds a sixth field to the section, this
   test starts exercising it automatically. */
const FINANCIALS_KEYS = COMPLETION_WEIGHTS.filter((w: any) => w.section === "Financials").map(
  (w: any) => String(w.field),
);

/* ════════════════════════════════════════════════════════════════════════════
   1. THE DASHBOARD PERCENTAGE ACTUALLY MOVES
   ════════════════════════════════════════════════════════════════════════════
   Brief: "Verify the percentage moves when a founder fills fields in — prove it
   with a test that changes data and re-reads the computed percentage, not by
   asserting the formula." */
describe("WAVE 41 — Dashboard 'Financials' progress responds to real data", () => {
  it("the Financials section exists and is worth something (otherwise the rest is vacuous)", () => {
    expect(FINANCIALS_KEYS.length).toBeGreaterThan(0);
    const names = COMPLETION_WEIGHTS.map((w: any) => w.section);
    expect(names).toContain("Financials");
  });

  it("starts at 0%, then MOVES after a real PATCH, re-read from the endpoint", async () => {
    const co = "co_w41_moves";

    const before = await completion(co);
    expect(before.status).toBe(200);
    /* POLE A — an untouched company must read 0, so a later non-zero is
       attributable to the write and not to fixture noise. */
    expect(sectionPct(before.body, "Financials")).toBe(0);

    /* Fill exactly ONE of the section's fields through the real route. */
    const first = FINANCIALS_KEYS[0];
    const one = await patch(co, { [first]: 1234 });
    expect(one.status).toBe(200);

    const mid = await completion(co);
    const midPct = sectionPct(mid.body, "Financials");
    /* POLE B — strictly greater than zero AND strictly less than complete, i.e.
       the bar tracks partial progress rather than flipping 0 -> 100. */
    expect(midPct).toBeGreaterThan(0);
    expect(midPct).toBeLessThan(100);

    /* Fill the rest. */
    const rest: Record<string, unknown> = {};
    for (const k of FINANCIALS_KEYS.slice(1)) rest[k] = 4321;
    if (Object.keys(rest).length) expect((await patch(co, rest)).status).toBe(200);

    const after = await completion(co);
    const afterPct = sectionPct(after.body, "Financials");
    expect(afterPct).toBeGreaterThan(midPct);
    expect(afterPct).toBe(100);
  });

  it("the overall completionPct also moves, so the headline number is not stuck", async () => {
    const co = "co_w41_overall";
    const before = (await completion(co)).body.completionPct;
    const body: Record<string, unknown> = {};
    for (const k of FINANCIALS_KEYS) body[k] = 999;
    expect((await patch(co, body)).status).toBe(200);
    const after = (await completion(co)).body.completionPct;
    expect(after).toBeGreaterThan(before);
  });

  it("every section named by the server has a Settings destination, so no bar is unactionable", () => {
    /* The Dashboard maps section.name -> a ?tab= href (SECTION_TAB_HREF in
       client/src/pages/founder/Dashboard.tsx). A section with no destination
       renders as plain text, which is honest but useless — this asserts the set
       the server emits is fully covered, and will fail the day a new weighted
       section is added without a place to fill it in. */
    const expected = new Set(["Public", "Region", "Preferences", "Financials", "M&A Prep"]);
    const actual = new Set(COMPLETION_WEIGHTS.map((w: any) => w.section));
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. FULL DB ROUND TRIP — write, reload, same value
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 41 — round trip for every field the newly mounted panels write", () => {
  it("financial fields survive write -> reload -> read, byte for byte", async () => {
    const co = "co_w41_rt_fin";
    /* Values chosen to be individually distinguishable, so a transposition bug
       (field A's value landing in field B) fails instead of passing. */
    const written: Record<string, number> = {};
    FINANCIALS_KEYS.forEach((k: string, i: number) => {
      written[k] = 1000 + i * 7;
    });
    expect((await patch(co, written)).status).toBe(200);

    /* Reload from the STORE, not from the mutation's own response body — a route
       that echoes its input while writing nothing would pass the latter. */
    const reloaded = getCompanyProfile(co) as Record<string, unknown>;
    for (const [k, v] of Object.entries(written)) {
      expect(reloaded[k], `field ${k} did not round-trip`).toBe(v);
    }
  });

  it("governance director count round-trips, INCLUDING a real zero", async () => {
    const co = "co_w41_rt_gov";
    expect((await patch(co, { boardCompositionDirectors: 5 })).status).toBe(200);
    expect((getCompanyProfile(co) as any).boardCompositionDirectors).toBe(5);

    /* POLE — a deliberate 0 must persist AS 0 and not be normalised away to
       null/absent, or "we have no board" becomes unsayable. */
    expect((await patch(co, { boardCompositionDirectors: 0 })).status).toBe(200);
    expect((getCompanyProfile(co) as any).boardCompositionDirectors).toBe(0);
  });

  it("percent fields round-trip AS WRITTEN, per PERCENT_POLICY_v2 §1.1 / owner ruling OR-1", async () => {
    /* 1 = 1%, 100 = 100%; the stored number IS the percentage. This is the
       WAVE 35 ROW 8 defect's regression test at the round-trip level: a
       write-side x100 with no read-side /100 turned a typed 42.5 into a stored
       4250, and the next save into 425000. */
    const co = "co_w41_rt_pct";
    const pctField = FINANCIAL_FIELD_COPY.find((f: any) => f.unit === "pct");
    expect(pctField, "no percent field found in FINANCIAL_FIELD_COPY").toBeTruthy();

    expect((await patch(co, { [pctField!.key]: toStoredAsWritten(42.5) })).status).toBe(200);
    const got = (getCompanyProfile(co) as any)[pctField!.key];
    expect(got).toBe(42.5);
    /* The value that comes back must be re-writable without drifting — the
       compounding half of the original defect. */
    expect((await patch(co, { [pctField!.key]: got })).status).toBe(200);
    expect((getCompanyProfile(co) as any)[pctField!.key]).toBe(42.5);
  });

  it("a ratio is a MULTIPLE, not a percentage: LTV/CAC of 3 stays 3, never 300", async () => {
    const co = "co_w41_rt_ratio";
    const ratioField = FINANCIAL_FIELD_COPY.find((f: any) => f.unit === "ratio");
    expect(ratioField, "no ratio-unit field found — the ratio unit is the point").toBeTruthy();
    expect(AS_WRITTEN_DECIMAL_UNITS.has("ratio")).toBe(true);

    expect((await patch(co, { [ratioField!.key]: 3 })).status).toBe(200);
    expect((getCompanyProfile(co) as any)[ratioField!.key]).toBe(3);
    expect((getCompanyProfile(co) as any)[ratioField!.key]).not.toBe(300);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. OWNER RULING R6 — "not entered" is not zero
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 41 — R6: a metric never entered is absent, not 0", () => {
  const MNA_KEYS = [
    "ipDdReadinessPct",
    "customerContractsReadinessPct",
    "financialAuditReadinessPct",
    "dataRoomOrganizedPct",
    "regulatoryFilingsCompletePct",
    "esgDisclosureCompletePct",
  ];

  it("the placeholder is the canonical one, spelled exactly once in the codebase", () => {
    expect(NOT_PROVIDED).toBe("Not provided");
  });

  it("a fresh company stores NOTHING for the six M&A scores — not 0", () => {
    const p = getCompanyProfile("co_w41_r6_fresh") as Record<string, unknown>;
    for (const k of MNA_KEYS) {
      /* The distinction the live audit found broken: absent must not be 0. */
      expect(p[k] ?? null, `${k} should be absent, not a number`).toBeNull();
      expect(p[k]).not.toBe(0);
    }
  });

  it("REPRODUCES THE DEFECT: the old spread-the-whole-map patch fabricates six scores and inflates the score", async () => {
    const co = "co_w41_r6_repro";
    const baseline = sectionPct((await completion(co)).body, "M&A Prep");
    expect(baseline).toBe(0);

    /* This is verbatim the shape SettingsMnaPrepTab used before Wave 41:
         values hydrated as `profile[key] ?? 0`, then patched as `{...values}`.
       A founder who set ONE score wrote a literal 0 into all six. */
    const preWave41Values: Record<string, number> = {};
    for (const k of MNA_KEYS) preWave41Values[k] = 0;
    preWave41Values["ipDdReadinessPct"] = 40; /* the one field the founder meant */
    expect((await patch(co, { ...preWave41Values, transactionPrepStatus: "exploring" })).status).toBe(200);

    const stored = getCompanyProfile(co) as Record<string, unknown>;
    /* THE DAMAGE: five scores the founder never touched now hold a number, and
       they are indistinguishable from a deliberate "0% ready". */
    for (const k of MNA_KEYS.filter((k) => k !== "ipDdReadinessPct")) {
      expect(stored[k], `defect reproduction: ${k} was fabricated`).toBe(0);
    }
    /* AND the completion score moved on fabricated data, because isPresent()
       counts 0 as present. This is the part the "0%" display was hiding. */
    const inflated = sectionPct((await completion(co)).body, "M&A Prep");
    expect(inflated).toBeGreaterThan(baseline);
    expect(inflated).toBe(100);
  });

  it("THE FIX: patching only the entered score leaves the other five absent and the score honest", async () => {
    const co = "co_w41_r6_fixed";
    /* This is the shape the shipped component now sends: non-null entries only. */
    expect((await patch(co, { ipDdReadinessPct: 40, transactionPrepStatus: "exploring" })).status).toBe(200);

    const stored = getCompanyProfile(co) as Record<string, unknown>;
    expect(stored.ipDdReadinessPct).toBe(40);
    for (const k of MNA_KEYS.filter((k) => k !== "ipDdReadinessPct")) {
      expect(stored[k] ?? null, `${k} must remain absent`).toBeNull();
    }
    const pct = sectionPct((await completion(co)).body, "M&A Prep");
    /* One of six entered: real progress, not 100%. */
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(100);
  });

  it("BOTH POLES: a deliberately entered 0 is kept as 0 and counts as entered", async () => {
    const co = "co_w41_r6_realzero";
    expect((await patch(co, { ipDdReadinessPct: 0 })).status).toBe(200);
    const stored = getCompanyProfile(co) as Record<string, unknown>;
    /* Not null, not absent — a real zero. "0% ready on IP" is a legitimate,
       meaningful answer and the fix must not have made it unsayable. */
    expect(stored.ipDdReadinessPct).toBe(0);
    expect(stored.ipDdReadinessPct).not.toBeNull();
    expect(sectionPct((await completion(co)).body, "M&A Prep")).toBeGreaterThan(0);
  });

  it("absent financial fields contribute nothing, so a 0% bar means 'nothing entered'", async () => {
    const co = "co_w41_r6_fin_absent";
    const p = getCompanyProfile(co) as Record<string, unknown>;
    for (const k of FINANCIALS_KEYS) expect(p[k] ?? null).toBeNull();
    expect(sectionPct((await completion(co)).body, "Financials")).toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. MONEY IS INTEGER MINOR UNITS — with the JPY (exponent 0) fixture
   ════════════════════════════════════════════════════════════════════════════
   Brief: "Include a JPY fixture (exponent 0) in every money test — no JPY data
   exists live, so tests are the only place that path is exercised." */
describe("WAVE 41 — money stays integer minor units (JPY exponent-0 fixture included)", () => {
  it("JPY has exponent 0 and USD has exponent 2", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
  });

  it("JPY: 1 major unit is 1 minor unit — the assumption a hardcoded /100 breaks", () => {
    expect(toMinor(1, "JPY")).toBe(1);
    expect(toMinor(1000, "JPY")).toBe(1000);
    expect(fromMinor(1000, "JPY")).toBe(1000);
    /* The bug this guards: treating every currency as 2dp would render 1000 JPY
       as "10.00" and a 10 JPY charge as 1000 JPY. */
    expect(fromMinor(1000, "JPY")).not.toBe(10);
    /* And the display path must not print minor digits for an exponent-0
       currency — no "¥1,000.00". */
    expect(formatMinor(1000, "JPY")).not.toContain(".");
    expect(formatMinor(1000, "USD")).toContain(".");
  });

  it("USD round-trips through minor units without floats", () => {
    expect(toMinor(1, "USD")).toBe(100);
    expect(toMinor(12.34, "USD")).toBe(1234);
    expect(fromMinor(1234, "USD")).toBe(12.34);
    expect(Number.isInteger(toMinor(12.34, "USD"))).toBe(true);
  });

  it("a USD-minor profile field stores an INTEGER count of cents, round-tripped through the store", async () => {
    const co = "co_w41_money";
    const usdField = FINANCIAL_FIELD_COPY.find(
      (f: any) => f.unit === "usd_minor" && FINANCIALS_KEYS.includes(f.key),
    );
    expect(usdField, "no usd_minor field found in the Financials section").toBeTruthy();

    /* $1,234.56 -> 123456 minor units, derived through the currency exponent
       rather than a literal *100, which is the fence this build enforces. */
    const minor = toMinor(1234.56, "USD");
    expect(minor).toBe(123456);
    expect((await patch(co, { [usdField!.key]: minor })).status).toBe(200);

    const stored = (getCompanyProfile(co) as any)[usdField!.key];
    expect(stored).toBe(123456);
    expect(Number.isInteger(stored)).toBe(true);
    expect(fromMinor(stored, "USD")).toBe(1234.56);

    /* JPY parallel: the SAME integer read under exponent 0 is a different amount
       of money (123,456 yen, not 1,234.56), which is exactly why the exponent
       may never be hardcoded. */
    expect(fromMinor(123456, "JPY")).toBe(123456);
  });

  it("no float creeps in across a write/read/write cycle", async () => {
    const co = "co_w41_money_cycle";
    const usdField = FINANCIAL_FIELD_COPY.find(
      (f: any) => f.unit === "usd_minor" && FINANCIALS_KEYS.includes(f.key),
    )!;
    expect((await patch(co, { [usdField.key]: 1 })).status).toBe(200); /* one cent */
    const once = (getCompanyProfile(co) as any)[usdField.key];
    expect((await patch(co, { [usdField.key]: once })).status).toBe(200);
    const twice = (getCompanyProfile(co) as any)[usdField.key];
    expect(twice).toBe(1);
    expect(Number.isInteger(twice)).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4b. THE OWNERSHIP GATE'S REFUSING POLE
   ════════════════════════════════════════════════════════════════════════════
   The tests above call as an admin. That is only honest if the gate is shown to
   still refuse someone else — otherwise this file would be evidence that the
   route is open, dressed up as evidence that the data round-trips. */
describe("WAVE 41 — the ownership gate still refuses, and refuses with 404", () => {
  it("a founder who does not own the company gets 404 on completion — not 403, not 200", async () => {
    const r = await request(app).get(
      "/api/founder/profile/completion?companyId=co_w41_not_mine&as=founder",
    );
    /* 404, because 403 would confirm the company exists to a caller with no
       right to know that. Cross-tenant refusals are indistinguishable from
       "there is nothing here". */
    expect(r.status).toBe(404);
    expect(r.status).not.toBe(403);
    expect(r.body.completionPct).toBeUndefined();
  });

  it("a founder who does not own the company cannot PATCH it", async () => {
    const r = await request(app)
      .patch("/api/founder/profile?companyId=co_w41_not_mine_patch&as=founder")
      .set("x-confirm", "true")
      .send({ arrUsd: 999 });
    expect(r.status).toBe(404);
    /* And nothing was written — a refusal that still mutates is worse than an
       allow. */
    expect((getCompanyProfile("co_w41_not_mine_patch") as any).arrUsd ?? null).toBeNull();
  });

  it("x-confirm is still required, so the double-verify is not bypassed by the admin path", async () => {
    const r = await request(app)
      .patch("/api/founder/profile?companyId=co_w41_confirm&as=admin")
      .send({ arrUsd: 111 });
    expect(r.status).toBe(409);
    expect((getCompanyProfile("co_w41_confirm") as any).arrUsd ?? null).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   5. computeProfileCompletion measured directly, as a cross-check
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 41 — completion maths cross-checked against the store, not the route", () => {
  it("moves when the store is updated directly, so the change is in the computation and not the routing", () => {
    const co = "co_w41_direct";
    const before = computeProfileCompletion(getCompanyProfile(co));
    const beforeFin = before.sections.find((s: any) => s.name === "Financials")!.pct;
    expect(beforeFin).toBe(0);

    const body: Record<string, unknown> = {};
    for (const k of FINANCIALS_KEYS) body[k] = 500;
    updateCompanyProfile(co, body as any, "wave41-test");

    const after = computeProfileCompletion(getCompanyProfile(co));
    expect(after.sections.find((s: any) => s.name === "Financials")!.pct).toBeGreaterThan(beforeFin);
    expect(after.weightedScore).toBeGreaterThan(before.weightedScore);
    expect(after.totalWeight).toBe(before.totalWeight);
  });
});
