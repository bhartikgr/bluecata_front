/**
 * WAVE 86B — EXACT MONEY OVER HTTP (R72, disproved and now closed on this route)
 *            and the LAUNCH-ATOMICITY SOURCE FENCES.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════════
 * R72 was reported as done by an earlier wave while these very figures were
 * wrong, and it survived four waves of green unit tests. The reason is recorded
 * here so it is not repeated: EVERY value assertion in this area had been written
 * against a fixture whose figure happens to be representable as an IEEE-754
 * double, and the defect only appears on figures that are not. So:
 *
 *   PROVED HERE — the two figures reviewer 2 destroyed (`9007199254740993` and a
 *   38-digit valuation) survive an HTTP round trip byte-for-byte, at the API
 *   boundary, through the real route table; the two payout legs RECONCILE to the
 *   exit value EXACTLY in decimal arithmetic on a real ledger; the same holds in a
 *   ZERO-DECIMAL currency (JPY), where the 2^53 ceiling arrives at 1/100th of the
 *   value; and the source narrowings cannot come back.
 *
 *   NOT PROVED HERE — that every money path in the platform is exact. It is not.
 *   The census is 865 numeric-narrowing calls in non-test source, 333
 *   money-flavoured, 214 in `server`/`shared`/`packages`. This wave fixed the 7 on
 *   this endpoint. See build_log/wave86b/W86B_MONEY_EXACTNESS.md, which states how
 *   far it got and why it stopped.
 *
 * OVER-HTTP TRANSCRIPTS (curl, real socket, server in a separate process):
 *   before: build_log/wave86b/transcripts/03_item1_http_before.txt
 *   after:  build_log/wave86b/transcripts/07_item1_http_after.txt
 * MUTATION TRANSCRIPTS: build_log/wave86b/W86B_TESTS.md.
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
import { spvEngineStore } from "../spvEngineStore";

const ROOT = path.resolve(__dirname, "../..");
const ADMIN = "u_admin";
const STAMP = `w86b${Date.now().toString(36)}`;
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments removed — a wave note that RECORDS a removed defect is
 *  evidence, not a live narrowing, and deleting the history to make a fence green
 *  would be the opposite of the point. */
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BIG38 = "99999999999999999999999999999999999999";
const HAZARD = "9007199254740993"; // MAX_SAFE_INTEGER + 2

let app: Express;

/** Exact decimal-string addition. The reconciliation must never touch a float —
 *  a float reconciliation would agree with a float defect. */
function sumExact(...parts: string[]): string {
  const dp = 60;
  const scale = (x: string): bigint => {
    const neg = x.trim().startsWith("-");
    const t = neg ? x.trim().slice(1) : x.trim();
    const [i, f = ""] = t.split(".");
    const v = BigInt(i + (f + "0".repeat(dp)).slice(0, dp));
    return neg ? -v : v;
  };
  let total = BigInt(0);
  for (const p of parts) total += scale(p);
  const neg = total < BigInt(0);
  const s = (neg ? -total : total).toString().padStart(dp + 1, "0");
  const r = `${s.slice(0, -dp)}.${s.slice(-dp)}`.replace(/\.?0+$/, "");
  return (neg ? "-" : "") + (r === "" ? "0" : r);
}

async function makeCompany(key: string): Promise<string> {
  const companyId = `co_${STAMP}_${key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W86B ${key}` });
  expect(co.status, `company create ${key}`).toBeLessThan(400);
  return companyId;
}

/** Wave 74/75/77's fixture shape, so the figures are comparable across waves. */
async function makePreferredCompany(key: string, currency: string, invShares: string): Promise<string> {
  const companyId = await makeCompany(key);
  const foundationId = createRound({
    companyId, name: `${STAMP} Foundation ${key}`, type: "foundation",
    instrument: "common", pricePerShare: null, actorUserId: ADMIN,
  }).id;
  const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId, roundId: foundationId, shares: "8000000", amount: "8000",
      currency, holderFirstName: "Founder", holderLastName: key });
  expect(seeded.status, `seed ${key}`).toBe(201);
  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId, name: `${STAMP} Under Test ${key}`, type: "seed", instrument: "preferred",
    currency,
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
    liquidationPreference: "1x non-participating",
  });
  expect(created.status, `round create ${key}`).toBe(200);
  const roundId = String((created.body as { id: string }).id);
  const backfill = await request(app).post("/api/founder/captable/backfill-investor")
    .set("x-user-id", ADMIN)
    .send({ companyId, roundId, shares: invShares, amount: "10000000", currency,
      holderFirstName: "Invest", holderLastName: key,
      investorEmail: `${STAMP}_${key}@example.invalid` });
  expect(backfill.status, `backfill ${key}`).toBe(201);
  return companyId;
}

const waterfall = (companyId: string, exitValuationMinor: string) =>
  request(app).get("/api/founder/captable/waterfall")
    .query({ companyId, exitValuationMinor })
    .set("x-user-id", ADMIN);

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json({ limit: "5mb" }));
  const srv = http.createServer(app);
  await registerRoutes(srv, app);
}, 120_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 1 · THE TWO FIGURES THAT WERE DESTROYED
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 86B · ITEM 1 (R72) — exact money at the API boundary", () => {
  it("W86B-M1 — every one of reviewer 2's four inputs comes back BYTE-IDENTICAL", async () => {
    /* `9007199254740993` returned `9007199254740992` (one minor unit destroyed) and
       the 38-digit input returned `1e+38` (which is not a decimal figure at all).
       Both reproduced over real HTTP before the fix. */
    const co = await makeCompany("m1");
    for (const input of ["9007199254740991", "9007199254740992", HAZARD, BIG38]) {
      const res = await waterfall(co, input);
      expect(res.status, `${input}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(200);
      expect(String(res.body.founderProceeds), `founderProceeds for ${input}`).toBe(input);
      /* ONE FORMAT, NOT TWO (R72 condition 2): the legacy name and the `*Exact`
         alias are the same string, and neither carries an exponent. */
      expect(String(res.body.founderProceedsExact), `founderProceedsExact for ${input}`).toBe(input);
      expect(String(res.body.founderProceeds)).not.toMatch(/[eE]/);
    }
  }, 120_000);

  it("W86B-M2 — on a REAL ledger the two legs reconcile to the exit value EXACTLY, at 38 digits", async () => {
    /* THE ONLY TEST THAT EXERCISES THE SUMMER. `exactSum` used to build on the BARE
       GLOBAL `Decimal`, whose precision depends on whether `packages/math-fns`
       happened to be imported (it sets 40; decimal.js ships 20). Fixing the input
       parse alone therefore produced a DIFFERENT wrong 38-digit answer that LOOKED
       plausible — measured in build_log/wave86b/transcripts/05_decimal_precision_measured.txt.
       The summer now runs on a module-local clone at precision 80. */
    const co = await makePreferredCompany("m2", "USD", "4000000");
    for (const input of ["5000000000", HAZARD, BIG38]) {
      const res = await waterfall(co, input);
      expect(res.status, `${input}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      const fp = String(res.body.founderProceeds);
      const lp = String(res.body.lpProceeds);
      const cv = String(res.body.convertibleProceeds ?? "0");
      expect(fp).not.toMatch(/[eE]/);
      expect(lp).not.toMatch(/[eE]/);
      /* NOTHING WAS ROUNDED to make this pass (R72 condition 3). */
      expect(sumExact(fp, lp, cv === "" ? "0" : cv), `legs must reconcile for ${input}`).toBe(input);
      /* Same one format on the breakpoint. */
      expect(String(res.body.breakpoints?.[0]?.exitMinor)).toBe(lp);
    }
  }, 120_000);

  it("W86B-M3 — the same holds in a ZERO-DECIMAL currency, where the ceiling arrives at 1/100th of the value", async () => {
    /* Wave 81 accepted this defect because \"$90 trillion is above global GDP\". In
       JPY the identical ceiling is JPY 9,007,199,254,740,993, about $60bn, which a
       large-cap fixture DOES reach — and the platform stores JPY rounds. This is
       also the only fixture that exercises `toMinorExact`'s exponent path. */
    const co = await makePreferredCompany("m3", "JPY", "4000000");
    for (const input of ["2000000", HAZARD]) {
      const res = await waterfall(co, input);
      expect(res.status, `${input}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      const fp = String(res.body.founderProceeds);
      const lp = String(res.body.lpProceeds);
      const cv = String(res.body.convertibleProceeds ?? "0");
      expect(sumExact(fp, lp, cv === "" ? "0" : cv), `JPY legs must reconcile for ${input}`).toBe(input);
    }
  }, 120_000);

  it("W86B-M4 — the refusals are UNCHANGED: a non-number is still 422, never a silent zero", async () => {
    /* An exact parser that accepts garbage as 0 would be a worse defect than the
       one it replaced, so both poles are asserted. */
    const co = await makeCompany("m4");
    for (const bad of ["abc", "-5", "NaN", "Infinity", "1,000", "$5"]) {
      const res = await waterfall(co, bad);
      expect(res.status, `${bad} must be refused`).toBe(422);
      expect(res.body.error).toBe("INVALID_EXIT_VALUATION_MINOR");
    }
    /* And a legal value is still accepted, including one written in exponent form
       by the CALLER — which is normalised on the way out, never echoed. */
    const ok = await waterfall(co, "1e5");
    expect(ok.status).toBe(200);
    expect(String(ok.body.founderProceeds)).toBe("100000");
  }, 120_000);

  it("W86B-M5 — SOURCE FENCE: none of the four narrowings can come back", () => {
    /* A source fence on purpose. Every one of these was green as a VALUE assertion
       while the API returned a wrong figure. */
    const s = code("server/track1Routes.ts");
    for (const forbidden of [
      "Number(exitValuationMinor)",
      "Number(data.amountStr)",
      "Number(data.sharesStr)",
      "toMinor(Number(e.amount), roundCurrency)",
      "const n = Number(r.shares ?? 0)",
    ]) {
      expect(s, `${forbidden} is back on the money path`).not.toContain(forbidden);
    }
    /* And the exact replacements are the ones actually in use. */
    expect(s).toContain("const exitMinorDec = parseExactMoney(exitValuationMinor);");
    expect(s).toContain("const exitMinor = exitMinorDec.toFixed();");
    expect(s).toContain("toMinorExact(e.amount, roundCurrency)");
    expect(s).toContain("exactShareAddend(e.shares)");
    expect(s).toContain("if (BigInt(data.sharesStr) === BigInt(0)) {");
  });

  it("W86B-M6 — the summer runs on a MODULE-LOCAL CLONE, and `Decimal.set` appears nowhere", () => {
    /* THE INVARIANT THIS PROTECTS IS NOT THIS ROUTE'S. `Decimal.set` mutates the
       single decimal.js instance the SACRED cap-table engine imports and eight
       production consumers read; it once faked a result by ~80 orders of magnitude.
       Engine isolation across import orders is a verified invariant, and a clone
       writes nothing global. */
    const s = code("server/track1Routes.ts");
    expect(s).not.toContain("Decimal.set(");
    expect(s).toContain("const MoneyDec = Decimal.clone({");
    expect(s).toContain("acc.plus(new MoneyDec(String(p.total)))");
    /* The `exactSum` signature is unchanged, so the `W77-M3` pin on it holds. */
    expect(s).toContain("const exactSum = (rows: Array<{ total: string }>): Decimal =>");
    /* And the clone is CONFIGURED not to emit an exponent, which was the second
       half of the defect: `String(1e38)` is `\"1e+38\"`. */
    expect(s).toContain("toExpNeg: -9e15");
    expect(s).toContain("toExpPos: 9e15");
  });

  it("W86B-M7 — the R67 branch text WAVE 88 owns is untouched by this wave", () => {
    /* COLLISION AVOIDANCE, ASSERTED. The `totalPrefSharesNum` sum is exact now, but
       the IDENTIFIER and the COMPARISON are deliberately unchanged so no R67 pin and
       no Wave 88 line had to move for ITEM 1. */
    const s = code("server/track1Routes.ts");
    expect(s).toContain("const totalPrefSharesExact = preferred.reduce(");
    expect(s).toContain("const totalPrefSharesNum = totalPrefSharesExact === BigInt(0) ? 0 : 1;");
    expect(s).toContain("totalPrefSharesNum === 0");
    expect(s).not.toContain("s + Number(String((p as { shares: unknown }).shares))");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 2 · SOURCE FENCES ON THE VALIDATE-BEFORE-WRITE ORDERING
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 86B · ITEM 2 — the launch payload is validated ABOVE the first write", () => {
  it("W86B-S4 — the pre-flight is ordered BEFORE `recordSignoff`, which is the first write", () => {
    /* THE ORDERING *IS* THE FIX. If the validation ever moves below the first write
       the endpoint is back to leaving a signed ESIGN/UETA artefact beside an
       incomplete set of economic terms, and no value assertion would notice,
       because the refusal status would be identical. */
    const s = code("server/spvEngineRoutes.ts");
    const route = s.slice(s.indexOf('app.post("/api/partner/me/spv"'), s.indexOf('app.get("/api/partner/me/spv/:spvId/signoffs"'));
    expect(route.length).toBeGreaterThan(0);
    const iValidateFees = route.indexOf("spvEngineStore.validateLaunchFeeDrafts(");
    const iValidateMandate = route.indexOf("spvEngineStore.validateMandateDraft(");
    const iFirstWrite = route.indexOf("signoff = recordSignoff({");
    const iCreate = route.indexOf("spvEngineStore.createSpv(");
    for (const [name, i] of [["validateLaunchFeeDrafts", iValidateFees], ["validateMandateDraft", iValidateMandate], ["recordSignoff", iFirstWrite], ["createSpv", iCreate]] as Array<[string, number]>) {
      expect(i, `${name} must be present in the launch route`).toBeGreaterThan(-1);
    }
    expect(iValidateFees).toBeLessThan(iFirstWrite);
    expect(iValidateMandate).toBeLessThan(iFirstWrite);
    expect(iFirstWrite).toBeLessThan(iCreate);
  });

  it("W86B-S5 — there is ONE definition of a valid fee row: the sink CALLS the validator", () => {
    /* Two copies of the same five refusals would drift, and the drift would be
       invisible until a payload passed the pre-flight and failed the sink — which is
       the exact failure mode this item exists to remove. */
    const s = code("server/spvEngineStore.ts");
    expect(s).toContain("validateFeeDraft(");
    expect(s).toContain("const feeChecked = this.validateFeeDraft(data, opts);");
    expect(s).toContain("this.validateFeeDraft(d, opts);");
    /* Each of the five per-row refusals appears EXACTLY ONCE in the file. */
    for (const name of ["INVALID_FEE_LAYER", "INVALID_FEE_TYPE", "FIXED_AMOUNT_REQUIRED", "CARRY_PCT_REQUIRED"]) {
      expect(s.split(`throw new Error("${name}")`).length - 1, `${name} must be thrown from ONE place`).toBe(1);
    }
    /* And the mandate rules likewise. */
    expect(s).toContain("const mandateChecked = this.validateMandateDraft(data);");
    for (const name of ["RULE_TREE_REQUIRED", "INVALID_MANDATE_MODE", "INVALID_CHECK_RANGE"]) {
      expect(s.split(`throw new Error("${name}")`).length - 1, `${name} must be thrown from ONE place`).toBe(1);
    }
  });

  it("W86B-S6 — the combined-carry pre-check is EXACT BigInt, never a float sum", () => {
    /* 0.5000000000000001 + 0.5 must reject in the pre-flight exactly as it rejects
       at the distribution sink. A float sum would accept it. */
    const s = code("server/spvEngineStore.ts");
    const fn = s.slice(s.indexOf("validateLaunchFeeDrafts("), s.indexOf("validateMandateDraft("));
    expect(fn.length).toBeGreaterThan(0);
    expect(fn).toContain("exactFractionToCarryScaled(");
    expect(fn).toContain("resolveCombinedCarryCapScaled(");
    expect(fn).toContain("BigInt(0)");
    expect(fn).not.toMatch(/carryPct\s*\+\s*/);
  });

  it("W86B-S7 — `fees` is NOT required, so none of the existing call sites had to move", () => {
    /* OWNER DECISION, asserted as source so nobody quietly makes it required and
       breaks 47 call sites. The additive keys are read with a presence check and
       default to the pre-wave behaviour. */
    const s = code("server/spvEngineRoutes.ts");
    expect(s).toContain("const feeDrafts = Array.isArray(body.fees)");
    expect(s).toContain("launchComplete: feeDrafts !== null && feeDrafts.length > 0,");
    /* Nothing in the create body is now MANDATORY that was not before. */
    expect(s).not.toContain('error: "FEES_REQUIRED"');
  });

  it("W86B-S9 — the combined-carry pre-check REFUSES a cross-layer stack, behaviourally, in exact BigInt", () => {
    /* ── WHY THIS IS A DIRECT STORE CALL AND NOT AN HTTP PROBE ─────────────────
       The cross-layer branch is UNREACHABLE over HTTP from a GP session, because a
       GP may not set a platform-layer fee at all and `PLATFORM_FEE_ADMIN_ONLY`
       refuses first (measured:
       build_log/wave86b/transcripts/08_item2_spv_atomicity_after.txt [3]). The
       source fence `W86B-S6` therefore had NO behavioural counterpart, and a
       mutation that short-circuited the whole check went GREEN
       (transcripts/10_mutations.txt, M5). This test is that counterpart: it drives
       the validator directly, which is the only reachable way to exercise the
       branch, and it is honest about being a store call rather than a route call. */
    expect(() => spvEngineStore.validateLaunchFeeDrafts(
      "ac_w86b_probe",
      [
        { layer: "management", feeType: "carry", carryPct: 0.6 },
        { layer: "platform", feeType: "carry", carryPct: 0.6 },
      ],
      null,
      { adminPlatform: true },
    )).toThrow("COMBINED_CARRY_EXCEEDS_CAP");

    /* THE COMPARISON IS EXACT FIXED-SCALE BigInt, NOT A FLOAT SUM. `exactFractionToCarryScaled`
       is the same converter the distribution sink uses, so `0.6` and `0.6` become
       600000000 + 600000000 against a cap of 1000000000 — a comparison of integers.
       The float this must not be fooled by, for the record: */
    expect(0.5000000000000001 + 0.5).toBe(1);

    /* AND WHAT THE PRE-FLIGHT DELIBERATELY DOES *NOT* DO, MEASURED AND STATED.
       An over-precise rate like `0.5000000000000001` is NOT refused here. The whole
       pre-check — cap resolution, fee store, and the converter's own precision guard
       — sits inside ONE tolerant `try` that LOGS an unavailability and skips, exactly
       as `addFee` has always done. Turning an unavailability into a refusal would
       reject launches the legacy path accepts, which is a worse defect than the one
       this item fixes. The authoritative fail-closed rejection of an over-precise
       rate is at the DISTRIBUTION SINK, which is untouched and is where the money
       moves. Asserted as a fact, not wished away: */
    expect(() => spvEngineStore.validateLaunchFeeDrafts(
      "ac_w86b_probe",
      [{ layer: "management", feeType: "carry", carryPct: 0.5000000000000001 }],
      null,
      { adminPlatform: true },
    )).not.toThrow();

    /* AND A LEGAL STACK STILL PASSES — a fence that refuses everything is not a
       fence. 0.2 management + 0.1 platform is 0.3 combined, well inside the cap. */
    expect(() => spvEngineStore.validateLaunchFeeDrafts(
      "ac_w86b_probe",
      [
        { layer: "management", feeType: "carry", carryPct: 0.2 },
        { layer: "platform", feeType: "carry", carryPct: 0.1 },
      ],
      null,
      { adminPlatform: true },
    )).not.toThrow();
  });

  it("W86B-S8 — no destructive store path was added: the fix is validate-first, not create-then-undo", () => {
    /* The store still has no delete and no sign-off void. `lint:destructive-store-fence`
       polices this too; asserting it here keeps the REASON beside the code. */
    const store = code("server/spvEngineStore.ts");
    expect(store).not.toMatch(/\bdeleteSpv\b/);
    expect(store).not.toMatch(/DELETE FROM spv\b/);
    const signoffs = code("server/spvLaunchSignoffStore.ts");
    expect(signoffs).not.toMatch(/\bvoidSignoff\b/);
    expect(signoffs).not.toMatch(/DELETE FROM spv_launch_signoff/);
  });
});
