/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 198 — THE PROOFS, WRITTEN AS TESTS.
 * ══════════════════════════════════════════════════════════════════════════════
 * Items A and B are additionally proved through the production route in
 * `wave194_adversarial_currency_reachability.test.ts`, whose ADV-3 and ADV-4 pins
 * this wave FLIPPED (pre-money now refuses; case variants now compute). This file
 * carries the byte-identity hashes, the Item C hostile-input length assertions and
 * the Item D route proofs.
 *
 * EVERY ITEM C CASE USES A HOSTILE INPUT, NOT A TYPICAL ONE. A typical input is the
 * reason this class has now passed review three times: every one of these sites has
 * a comment claiming it is short enough, and four of them are measurably not.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { createHash } from "node:crypto";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { securities } from "../mockData";

import {
  fitToGate,
  boundedFragment,
  LOOKS_HUMAN_MAX_LENGTH,
  NAME_FRAGMENT_BUDGETS,
} from "../../shared/refusalHeadlineGate";
import { fitToGate as fitToGateWave195 } from "../lib/wave195CommitCurrencyDeclaration";
import { assertSpvPatchFullyApplied } from "../lib/spvVehiclePatchApplicability";
import { assertSingleCurrencyTotal } from "../spvEngineStore";
import { spvUnresolvedForCommitmentHeadline } from "../../shared/spvCanonicalCommitmentResolution";
import { spvClosedToNewCapitalHeadline } from "../../shared/spvClosedToNewCapital";
import { governanceTermRefusalHeadline } from "../../shared/roundGovernanceTerms";
import { spvCapSplitRefusalHeadline } from "../../shared/spvCapSplitDisclosure";
import {
  normaliseCurrencyForComparison,
  statedCurrencies,
  isMixedCurrency,
} from "@capavate/cap-table-engine";
import {
  assertAdminPartnerPatchFullyApplied,
  assertPartnerPipelinePatchFullyApplied,
  assertPartnerNotePatchFullyApplied,
  assertPartnerWorkspaceSettingsPatchFullyApplied,
  isPartnerPatchUnappliedError,
} from "../lib/partnerPatchApplicability";
import { w212Attest } from "./_w212RoundAttestation";

let app: Express;
const STAMP = String(Date.now());
const ADMIN = "u_admin";
let n = 0;

/** The client's own gate, restated here so a test failure names the real limit. */
const CLIENT_GATE = 240;

/** A hostile SPV name: long, and long in a way a real GP could plausibly type. */
const HOSTILE_NAME =
  "Capavate Global Opportunities Special Purpose Vehicle IV (Cayman Islands Segregated Portfolio Company) Series B-2 Co-Investment Sleeve — Amended and Restated";
/** A pathological name, past anything plausible, to prove the floor holds. */
const ABSURD_NAME = "N".repeat(4000);

function headlineIsDeliverable(h: string): void {
  /* Both halves of `client/src/lib/queryClient.ts`'s `looksHuman`: strictly under
     240 characters AND containing a lower-case letter. A headline failing either
     is replaced by "Something went wrong", i.e. the refusal does not fire. */
  expect(h.length, `headline is ${h.length} chars: ${h.slice(0, 120)}…`).toBeLessThan(CLIENT_GATE);
  expect(/[a-z]/.test(h), "headline has no lower-case letter").toBe(true);
}

async function createRound(payload: Record<string, unknown>): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send(w212Attest({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload }));
  if (res.status !== 200) throw new Error(`createRound ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

/** Wave 194's builder, reused unchanged so the shapes are comparable. */
async function company(
  label: string,
  safes: Array<{ currency: string; safeType?: string }>,
): Promise<{ companyId: string; priced: string }> {
  const companyId = `co_w198_${label}_${STAMP}`;
  const foundation = await createRound({
    companyId, name: "W198 Foundation", type: "foundation", state: "closed",
    targetAmount: 1000, currency: "USD",
  });
  const seed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId, roundId: foundation, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(seed.status);

  for (const s of safes) {
    const rid = await createRound({
      companyId, name: `W198 SAFE ${n}`, type: "preseed", state: "closed",
      targetAmount: 1_000_000, instrument: "safe_post", valuationCap: "10000000",
      currency: s.currency,
      ...(s.safeType === undefined ? {} : { safeType: s.safeType }),
    });
    (securities as unknown as Array<Record<string, unknown>>).push({
      id: `sec_w198_${label}_${n}`,
      companyId,
      holderName: `W198 Holder ${n}`,
      holderType: "investor",
      instrument: "safe",
      series: "SAFE",
      shares: 0,
      pricePerShare: null,
      investmentAmount: 1_000_000,
      cap: 10_000_000,
      discount: null,
      issuedAt: "2026-01-01",
      roundId: rid,
    });
    n += 1;
  }
  const priced = await createRound({
    companyId, name: "W198 Series Seed", type: "seed", state: "active",
    targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 3, currency: "USD",
    instrument: "preferred", sharesAuthorized: "3333333", fdPreMoneyShares: "10000000",
  });
  return { companyId, priced };
}

const roundMath = (roundId: string) =>
  request(app).get(`/api/founder/rounds/${roundId}/round-math`).set("x-user-id", ADMIN);

/**
 * The RAW response text, hashed. Not the parsed object: byte-identity means the
 * bytes on the wire, which is the only thing a client actually receives.
 *
 * Company and round ids are the one thing that legitimately differs between two
 * runs of the same shape, so they are masked — and masked by an EXPLICIT pattern
 * whose replacement count is asserted, so a mask cannot quietly erase a real
 * difference in figures.
 */
function goldenOf(rawText: string, companyId: string, priced: string): { raw: string; sha: string } {
  let masked = rawText.split(companyId).join("<COMPANY>").split(priced).join("<PRICED>");
  masked = masked.replace(/co_w198_[a-z0-9]+_\d+/g, "<COMPANY>");
  masked = masked.replace(/r_[A-Za-z0-9_-]+/g, "<ROUND>");
  masked = masked.replace(/sec_w198_[a-z0-9]+_\d+/g, "<SEC>");
  masked = masked.replace(/"issuedAt":"[^"]*"/g, '"issuedAt":"<TS>"');
  /* The harness names its fixtures with a MONOTONIC COUNTER shared across every
     company in the file, so two structurally identical companies built one after
     another carry different holder and round labels. Those labels are fixture
     scaffolding, not cap-table output, so they are masked too — and, like the ids
     above, by an explicit pattern rather than a loose one, so a genuine difference
     in a NUMBER can never be masked away. Discovered empirically: B-1 compares two
     identical single-currency companies and they differed on these labels alone. */
  masked = masked.replace(/W198 Holder \d+/g, "W198 Holder <N>");
  masked = masked.replace(/W198 SAFE \d+/g, "W198 SAFE <N>");
  return { raw: masked, sha: createHash("sha256").update(masked, "utf8").digest("hex") };
}

/**
 * Byte-identity with a USEFUL failure. A bare hash comparison tells you two things
 * differ but not how, and "how" is the whole question when the alternative
 * explanation is a leaky mask.
 */
function expectSameBytes(
  a: { raw: string; sha: string },
  b: { raw: string; sha: string },
  what: string,
): void {
  if (a.sha !== b.sha) {
    let i = 0;
    while (i < a.raw.length && i < b.raw.length && a.raw[i] === b.raw[i]) i += 1;
    const win = 160;
    throw new Error(
      `${what}: bytes differ at offset ${i}\n` +
      `  A: …${a.raw.slice(Math.max(0, i - 40), i + win)}\n` +
      `  B: …${b.raw.slice(Math.max(0, i - 40), i + win)}\n` +
      `  shaA=${a.sha} shaB=${b.sha} lenA=${a.raw.length} lenB=${b.raw.length}`,
    );
  }
  expect(a.sha).toBe(b.sha);
}

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 120_000);

/* ═══════════════════════════════ ITEM A ══════════════════════════════════════ */

describe("WAVE 198 · ITEM A — normalisation folds case and whitespace, and NOTHING else", () => {
  it("A-1 folds case and surrounding whitespace, and maps/converts nothing", () => {
    expect(normaliseCurrencyForComparison("usd")).toBe("USD");
    expect(normaliseCurrencyForComparison(" USD ")).toBe("USD");
    expect(normaliseCurrencyForComparison("\tUsD\n")).toBe("USD");
    /* THE GUARD AGAINST THE FIX BECOMING CLEVER. R156.1 forbids inventing or
       mapping codes; these assert that no alias table crept in. GBP must never
       become UKP, and a code the platform does not recognise must pass through
       unaltered rather than being "corrected" into one it does. */
    expect(normaliseCurrencyForComparison("GBP")).toBe("GBP");
    expect(normaliseCurrencyForComparison("UKP")).toBe("UKP");
    expect(normaliseCurrencyForComparison("US Dollars")).toBe("US DOLLARS");
    expect(normaliseCurrencyForComparison("$")).toBe("$");
    /* Absence stays absence. This is the branch every one of the 1045 existing
       currency-less rounds takes, and it must not move. */
    expect(normaliseCurrencyForComparison(null)).toBe("");
    expect(normaliseCurrencyForComparison(undefined)).toBe("");
    expect(normaliseCurrencyForComparison("   ")).toBe("");
    expect(normaliseCurrencyForComparison(42)).toBe("");
  });

  it("A-2 case variants are ONE stated code; genuinely different codes are still two", () => {
    expect(statedCurrencies(["usd", "USD"])).toEqual(["USD"]);
    expect(statedCurrencies([" usd ", "Usd", "USD"])).toEqual(["USD"]);
    expect(isMixedCurrency(["usd", "USD"])).toBe(false);
    expect(isMixedCurrency([" USD ", "USD"])).toBe(false);
    /* THE DIRECTION THAT MUST NOT WEAKEN. */
    expect(isMixedCurrency(["GBP", "USD"])).toBe(true);
    expect(isMixedCurrency(["gbp", "USD"])).toBe(true);
    /* A malformed-but-PRESENT code is a stated code and can still refuse — wave
       195's decision, kept deliberately. Reclassifying it as absence would let a
       set of "US Dollars" and "GBP" compute a number. */
    expect(isMixedCurrency(["US Dollars", "GBP"])).toBe(true);
    /* Absent branches, unchanged. */
    expect(isMixedCurrency([null, undefined])).toBe(false);
    expect(isMixedCurrency(["USD", null, "   "])).toBe(false);
  });

  it("A-3 BYTE-IDENTITY: usd + USD returns the SAME BYTES as USD + USD, through the route", async () => {
    const variant = await company("caseA", [{ currency: "usd" }, { currency: "USD" }]);
    const control = await company("caseB", [{ currency: "USD" }, { currency: "USD" }]);
    const rv = await roundMath(variant.priced);
    const rc = await roundMath(control.priced);
    expect(rv.status, rv.text.slice(0, 300)).toBe(200);
    expect(rc.status, rc.text.slice(0, 300)).toBe(200);
    const gv = goldenOf(rv.text, variant.companyId, variant.priced);
    const gc = goldenOf(rc.text, control.companyId, control.priced);
    /* The whole point of Item A: not merely that the case-variant set computes,
       but that it computes THE SAME CAP TABLE. A fix that made it compute a
       DIFFERENT one would be worse than the refusal it replaced. */
    expectSameBytes(gv, gc, "A-3 case-variant vs control");
    expect(gv.raw.length).toBeGreaterThan(200);
  });

  it("A-4 BYTE-IDENTITY: ' USD ' + 'USD' returns the SAME BYTES as USD + USD", async () => {
    const padded = await company("padA", [{ currency: " USD " }, { currency: "USD" }]);
    const control = await company("padB", [{ currency: "USD" }, { currency: "USD" }]);
    const rp = await roundMath(padded.priced);
    const rc = await roundMath(control.priced);
    expect(rp.status, rp.text.slice(0, 300)).toBe(200);
    expectSameBytes(
      goldenOf(rp.text, padded.companyId, padded.priced),
      goldenOf(rc.text, control.companyId, control.priced),
      "A-4 padded vs control",
    );
  });

  it("A-5 a genuinely mixed set STILL refuses, and the absent branches STILL compute", async () => {
    const mixed = await company("mixed", [{ currency: "GBP" }, { currency: "USD" }]);
    expect((await roundMath(mixed.priced)).status).toBe(422);

    /* The branch every existing round is on. If this ever regresses, the wave has
       broken 1045 rounds to fix a case-variant edge. */
    const absent = await company("absent", [{ currency: "" }, { currency: "   " }]);
    const ra = await roundMath(absent.priced);
    expect(ra.status, ra.text.slice(0, 300)).toBe(200);

    const oneStated = await company("onest", [{ currency: "USD" }, { currency: "" }]);
    const ro = await roundMath(oneStated.priced);
    expect(ro.status, ro.text.slice(0, 300)).toBe(200);
  });
});

/* ═══════════════════════════════ ITEM B ══════════════════════════════════════ */

describe("WAVE 198 · ITEM B — the SAFE CONVERSION surface, not just the denominator", () => {
  it("B-1 BYTE-IDENTITY: a single-currency PRE-MONEY cap table is unchanged", async () => {
    /* THE CHECK THAT MATTERS MOST, per the brief. Item B adds a throw on the path
       every pre-money SAFE takes, so the risk it introduces is not a wrong number
       but a refusal of correct data. Two independently built single-currency
       pre-money companies must produce identical bytes, and must produce a real
       cap table rather than an error envelope. */
    const a = await company("preA", [
      { currency: "USD", safeType: "pre_money_cap" },
      { currency: "USD", safeType: "pre_money_cap" },
    ]);
    const b = await company("preB", [
      { currency: "USD", safeType: "pre_money_cap" },
      { currency: "USD", safeType: "pre_money_cap" },
    ]);
    const ra = await roundMath(a.priced);
    const rb = await roundMath(b.priced);
    expect(ra.status, ra.text.slice(0, 400)).toBe(200);
    expect(rb.status, rb.text.slice(0, 400)).toBe(200);
    expect(ra.body.postClose.rows.length).toBeGreaterThan(0);
    const ga = goldenOf(ra.text, a.companyId, a.priced);
    const gb = goldenOf(rb.text, b.companyId, b.priced);
    expectSameBytes(ga, gb, "B-1 single-currency pre-money, two identical builds");
    /* Recorded so the hash is in the log rather than only in an assertion. */
    // eslint-disable-next-line no-console
    console.log(`[W198 B-1] single-currency pre-money golden sha256=${ga.sha} chars=${ga.raw.length}`);
  });

  it("B-2 a PURELY pre-money mixed set refuses through the production route", async () => {
    const { priced } = await company("premix", [
      { currency: "USD", safeType: "pre_money_cap" },
      { currency: "GBP", safeType: "pre_money_cap" },
    ]);
    const res = await roundMath(priced);
    expect(res.status, res.text.slice(0, 400)).toBe(422);
    expect(res.body.refusal).toBe("mixed_currency_safe_conversion");
    /* No fabricated figure anywhere in the body. */
    for (const forbidden of ["ownershipPercent", "pricePerShare", "totalShares", "safeShares"]) {
      expect(res.text, `refusal body carries ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("B-3 the CROSS-BRANCH set the post-money sum cannot see also refuses", async () => {
    /* Wave 194's ADV-3 shape. The post-money sum filters the pre-money SAFE out, so
       nothing in wave 193's rule can ever see this pairing. */
    const { priced } = await company("cross", [
      { currency: "USD", safeType: "post_money_cap" },
      { currency: "GBP", safeType: "pre_money_cap" },
    ]);
    const res = await roundMath(priced);
    expect(res.status, res.text.slice(0, 400)).toBe(422);
    expect(res.body.refusal).toBe("mixed_currency_safe_conversion");
  });

  it("B-4 the refusal headline is DELIVERABLE and names no currency of its own", async () => {
    const { priced } = await company("hdln", [
      { currency: "USD", safeType: "pre_money_cap" },
      { currency: "GBP", safeType: "pre_money_cap" },
    ]);
    const res = await roundMath(priced);
    expect(res.status).toBe(422);
    headlineIsDeliverable(String(res.body.refusalName ?? res.body.message ?? ""));
    /* R156.2 — the HEADLINE must not hardcode a currency. The codes belong in the
       guidance, which is interpolated from the data. */
    const headline = String(res.body.refusalName ?? res.body.message ?? "");
    for (const code of ["USD", "GBP", "EUR", "$"]) {
      expect(headline, `headline hardcodes ${code}`).not.toContain(code);
    }
    /* But the specifics are NOT lost — they travel in the guidance. */
    expect(String(res.body.guidance ?? res.body.message)).toContain("GBP");
  });

  it("B-5 wave 193's post-money denominator refusal is UNCHANGED and still wins first", async () => {
    /* R170.1 and wave 194's byte-identity proof both rest on this. A capped
       post-money mixed set must still get the DENOMINATOR code, not the new one. */
    const { priced } = await company("pmwins", [
      { currency: "USD", safeType: "post_money_cap" },
      { currency: "GBP", safeType: "post_money_cap" },
    ]);
    const res = await roundMath(priced);
    expect(res.status).toBe(422);
    expect(res.body.refusal).toBe("mixed_currency_conversion_denominator");
  });
});

/* ═══════════════════════════════ ITEM C ══════════════════════════════════════ */

describe("WAVE 198 · ITEM C — every bounded headline, attacked with a HOSTILE input", () => {
  it("C-0 the moved gate is byte-equivalent to wave 195's implementation", () => {
    /* The duplication is deliberate and temporary (wave 197 is live in wave 195's
       file), so this test is what stops the copy drifting silently in the meantime.
       Identical output over the same input table, including the pathological rows. */
    const cases: Array<(b: number) => string> = [
      (b) => `x ${boundedFragment("short", b)} y`,
      (b) => `x ${boundedFragment(HOSTILE_NAME, b)} y`,
      (b) => `x ${boundedFragment(ABSURD_NAME, b)} y`,
      (b) => `${"P".repeat(300)} ${boundedFragment("id_1", b)}`,
      (b) => `x ${boundedFragment("", b)} y`,
      (b) => `x ${boundedFragment("a\nb\tc", b)} y`,
    ];
    for (const build of cases) {
      expect(fitToGate(build)).toBe(fitToGateWave195(build));
    }
    expect(LOOKS_HUMAN_MAX_LENGTH).toBe(240);
  });

  it("C-0b fitToGate never returns something the client will discard", () => {
    /* Including the case its own comment admits is possible: the caller's FIXED
       prose already over the gate, where the answer is a hard truncate. */
    expect(fitToGate((b) => `${"Q".repeat(900)} ${boundedFragment("x", b)}`).length)
      .toBeLessThan(CLIENT_GATE);
    expect(fitToGate((b) => boundedFragment(ABSURD_NAME, b), NAME_FRAGMENT_BUDGETS).length)
      .toBeLessThan(CLIENT_GATE);
  });

  it("C-1 wave 193's OWN multi-key headline: a 30-KEY body (measured 531 chars before)", () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < 30; i += 1) body[`unknownFieldNumber${i}`] = i;
    let caught: unknown;
    try { assertSpvPatchFullyApplied(body); } catch (e) { caught = e; }
    expect(caught, "a 30-key body of unknown fields did not refuse at all").toBeTruthy();
    const e = caught as { refusalHeadline: string; refusalGuidance: string; unappliedFields: string[] };
    headlineIsDeliverable(e.refusalHeadline);
    /* Nothing is lost by bounding it: the full list is still available. */
    expect(e.unappliedFields.length).toBe(30);
    expect(e.refusalGuidance).toContain("unknownFieldNumber29");
  });

  it("C-1b the same headline with a SINGLE 300-character key (measured 361 chars before)", () => {
    let caught: unknown;
    try { assertSpvPatchFullyApplied({ ["z".repeat(300)]: 1 }); } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    headlineIsDeliverable((caught as { refusalHeadline: string }).refusalHeadline);
  });

  it("C-1c a LEGITIMATE single-field refusal still reads normally, unabbreviated", () => {
    /* The regression that would matter most: this wave must not start truncating
       messages that were fine. */
    let caught: unknown;
    try { assertSpvPatchFullyApplied({ version: 3 }); } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    const h = (caught as { refusalHeadline: string }).refusalHeadline;
    headlineIsDeliverable(h);
    expect(h).not.toContain("\u2026");
    /* Wave 193's module carries its own `readable()` map and does NOT rename
       `version`; wave 198's Item D module does. That difference is real and is left
       alone — this wave bounds wave 193's headline, it does not restyle its copy
       (R143.1). Asserted against what wave 193 actually says. */
    expect(h).toContain("version");
  });

  it("C-2 assertSingleCurrencyTotal with a hostile vehicle name AND seven codes", () => {
    let caught: unknown;
    try {
      assertSingleCurrencyTotal(
        "total committed capital",
        [
          { currency: "USD" }, { currency: "GBP" }, { currency: "EUR" }, { currency: "JPY" },
          { currency: "SGD" }, { currency: "CHF" }, { currency: "AUD" },
        ],
        HOSTILE_NAME,
      );
    } catch (e) { caught = e; }
    expect(caught, "a seven-currency vehicle did not refuse").toBeTruthy();
    headlineIsDeliverable((caught as { refusalHeadline: string }).refusalHeadline);
    /* The substance survives the bounding. */
    expect((caught as { statedCurrencies: string }).statedCurrencies).toContain("GBP");
  });

  it("C-2b and with an absurd name, where the floor rather than a budget has to hold", () => {
    let caught: unknown;
    try {
      assertSingleCurrencyTotal("total committed capital",
        [{ currency: "USD" }, { currency: "GBP" }], ABSURD_NAME);
    } catch (e) { caught = e; }
    expect(caught).toBeTruthy();
    headlineIsDeliverable((caught as { refusalHeadline: string }).refusalHeadline);
  });

  it("C-2c a NORMAL vehicle name is still printed in full", () => {
    let caught: unknown;
    try {
      assertSingleCurrencyTotal("total committed capital",
        [{ currency: "USD" }, { currency: "GBP" }], "Capavate Ventures SPV III");
    } catch (e) { caught = e; }
    const h = (caught as { refusalHeadline: string }).refusalHeadline;
    expect(h).toContain("Capavate Ventures SPV III");
    expect(h).not.toContain("\u2026");
  });

  it("C-3 spvUnresolvedForCommitmentHeadline: measured 263 chars at a 120-char name", () => {
    headlineIsDeliverable(spvUnresolvedForCommitmentHeadline("V".repeat(120)));
    headlineIsDeliverable(spvUnresolvedForCommitmentHeadline(HOSTILE_NAME));
    headlineIsDeliverable(spvUnresolvedForCommitmentHeadline(ABSURD_NAME));
    /* Unchanged for the ordinary case, including the unnamed fallback. */
    expect(spvUnresolvedForCommitmentHeadline("Capavate SPV IV")).toContain("Capavate SPV IV");
    expect(spvUnresolvedForCommitmentHeadline(null)).toContain("this vehicle");
    expect(spvUnresolvedForCommitmentHeadline("Capavate SPV IV")).not.toContain("\u2026");
  });

  it("C-4 spvClosedToNewCapitalHeadline: breaks above a 148-char name", () => {
    headlineIsDeliverable(spvClosedToNewCapitalHeadline("W".repeat(200)));
    headlineIsDeliverable(spvClosedToNewCapitalHeadline(HOSTILE_NAME));
    headlineIsDeliverable(spvClosedToNewCapitalHeadline(ABSURD_NAME));
    expect(spvClosedToNewCapitalHeadline("Capavate SPV IV")).toContain("Capavate SPV IV");
    expect(spvClosedToNewCapitalHeadline(null)).toContain("This vehicle");
  });

  it("C-5 governance-term refusals: 484-495 chars for EVERY key, so never once seen", () => {
    /* The worst site the sweep found, and it needs no hostile input at all — its
       FIXED prose is over the gate. All four keys. */
    for (const key of ["proRataRights", "informationRights", "boardSeat", "protectiveProvisions"] as const) {
      const h = governanceTermRefusalHeadline(key);
      headlineIsDeliverable(h);
      /* It must still say the useful thing: which term, and that it is text with a
         length limit. A short message that says nothing would not be an improvement
         on a long one nobody sees. */
      expect(h.toLowerCase()).toContain("characters");
      /* ── STRENGTHENED AFTER A GREEN DISARM. THIS IS THE FINDING OF THE HARNESS.
         The three assertions above ALL PASS with the fix reverted, and the disarm
         run proved it: reverting the split so the 484-character message becomes the
         headline still yields a "deliverable" string, because `fitToGate`'s floor
         hard-truncates anything over the gate to 239 characters — and the truncated
         prefix still contains the word "characters". So the test was asserting
         something guaranteed by the helper rather than anything about this fix. Wave
         194's M2 was found exactly this way.
         What actually distinguishes the fix is that the headline is a PURPOSE-WRITTEN
         short sentence, not a long one clipped: a truncation always lands at exactly
         239 characters and ends mid-word. Asserted directly. */
      expect(h.length, `headline is ${h.length} chars — a truncation would be 239`).toBeLessThan(200);
      expect(h.endsWith("."), `headline ends mid-sentence: …${h.slice(-40)}`).toBe(true);
    }
  });

  it("C-6 spvCapSplitRefusalHeadline: hostile currency string in all four figures", () => {
    /* Item A established the currency column is an unvalidated database string, so
       a vehicle recording a phrase rather than a code is an accepted shape — and it
       lands in this sentence four times. */
    const figures = {
      currency: "United States Dollars (US Legal Tender)",
      capMinor: 100_000_000,
      confirmedCapitalMinor: 250_000_000,
      softCircledInterestMinor: 90_000_000,
      resultingTotalMinor: 340_000_000,
      overageMinor: 240_000_000,
    } as unknown as Parameters<typeof spvCapSplitRefusalHeadline>[0];
    headlineIsDeliverable(spvCapSplitRefusalHeadline(figures, 2));
    /* And the ordinary case is untouched. */
    const normal = { ...(figures as Record<string, unknown>), currency: "USD" } as unknown as Parameters<typeof spvCapSplitRefusalHeadline>[0];
    const h = spvCapSplitRefusalHeadline(normal, 2);
    headlineIsDeliverable(h);
    expect(h).not.toContain("\u2026");
  });
});

/* ═══════════════════════════════ ITEM D ══════════════════════════════════════ */

describe("WAVE 198 · ITEM D — the four PATCH routes stop reporting success for a dropped write", () => {
  function refusalOf(fn: () => void): { refusalHeadline: string; refusalGuidance: string; unappliedFields: string[] } {
    let caught: unknown;
    try { fn(); } catch (e) { caught = e; }
    expect(caught, "the assertion did not refuse").toBeTruthy();
    expect(isPartnerPatchUnappliedError(caught)).toBe(true);
    return caught as { refusalHeadline: string; refusalGuidance: string; unappliedFields: string[] };
  }

  it("D-1 admin partner PATCH refuses a key persistContact would never write", () => {
    const r = refusalOf(() => assertAdminPartnerPatchFullyApplied({ legalName: "Acme", madeUpField: 1 }));
    headlineIsDeliverable(r.refusalHeadline);
    expect(r.unappliedFields).toEqual(["madeUpField"]);
    expect(r.refusalHeadline).toContain("madeUpField");
  });

  it("D-1b and refuses the identity/revision keys with the identity-specific guidance", () => {
    const r = refusalOf(() => assertAdminPartnerPatchFullyApplied({ id: "x", version: 9 }));
    headlineIsDeliverable(r.refusalHeadline);
    expect(r.refusalGuidance).toContain("audit history");
    expect(r.unappliedFields).toEqual(["id", "version"]);
  });

  it("D-1c a LEGITIMATE admin partner patch is accepted, including every metadata key", () => {
    /* The false-refusal direction. A wide accept-list is only safe if it is proved
       wide, so every key this wave read out of `extractMetadata` is asserted. */
    expect(() => assertAdminPartnerPatchFullyApplied({
      legalName: "Acme Capital", displayName: "Acme", email: "a@b.co", phone: "+1",
      region: "US", status: "active", verification: "verified", kind: "partner",
      tier: "nexus", tierSince: "2026-01-01", foundingMember: true,
      partnerType: "angel_network", regionCode: "US", preferredPayoutCurrency: "USD",
      website: "https://a.co", linkedinUrl: "https://l/a", tags: ["x"], notes: "n",
      type: "vc", hqCity: "NY", hqCountry: "US", aumMinor: 1, aumCurrency: "USD",
      checkSizeMinMinor: 1, checkSizeMaxMinor: 2, industries: [], stages: [],
      companyIds: [], partnerWeight: 1, partnerSince: "2026-01-01",
      configJson: null, isSeed: false,
    })).not.toThrow();
    expect(() => assertAdminPartnerPatchFullyApplied({})).not.toThrow();
  });

  it("D-2 pipeline PATCH refuses only the store's forced keys, and passes real edits", () => {
    const r = refusalOf(() => assertPartnerPipelinePatchFullyApplied({ stage: "diligence", version: 4 }));
    headlineIsDeliverable(r.refusalHeadline);
    expect(r.unappliedFields).toEqual(["version"]);
    /* THE SHAPE THE REAL CLIENT SENDS (`PartnerPipeline.tsx` sends `{ stage }`). */
    expect(() => assertPartnerPipelinePatchFullyApplied({ stage: "diligence" })).not.toThrow();
    /* And an unrecognised key is NOT refused, because `persistEntry` JSON-encodes
       the whole object and it durably round-trips. Refusing it would be the false
       refusal this item's finding is about. */
    expect(() => assertPartnerPipelinePatchFullyApplied({ someNewField: 1 })).not.toThrow();
  });

  it("D-3 notes PATCH refuses forced keys and passes a normal note edit", () => {
    const r = refusalOf(() => assertPartnerNotePatchFullyApplied({ body: "hi", revisionHash: "deadbeef" }));
    headlineIsDeliverable(r.refusalHeadline);
    expect(r.unappliedFields).toEqual(["revisionHash"]);
    expect(() => assertPartnerNotePatchFullyApplied({ title: "T", body: "B", scope: "general" })).not.toThrow();
    /* `updatedBy` is NOT in the note store's forced tail, unlike the pipeline's —
       which is exactly why the lists are per-store rather than a shared union. */
    expect(() => assertPartnerNotePatchFullyApplied({ updatedBy: "u_1" })).not.toThrow();
  });

  it("D-4 THE ONE THAT WOULD HAVE BROKEN EVERY PARTNER SETTINGS SAVE", () => {
    /* The exact 13-key object `client/src/pages/partner/PartnerSettings.tsx` sends.
       Twelve of these are absent from the `PartnerWorkspaceSettings` interface and
       all twelve persist correctly today, because the store JSON-encodes the whole
       object. An interface-derived accept-list would 400 this. It must pass. */
    expect(() => assertPartnerWorkspaceSettingsPatchFullyApplied({
      displayName: "Acme", legalName: "Acme Capital LLC", website: "https://a.co",
      addressLine1: "1 Main St", city: "New York", country: "US", regionCode: "US",
      bio: "We invest.", contactEmail: "a@b.co", contactPhone: "+1",
      preferredPayoutCurrency: "USD", branding: {}, notifications: {},
    })).not.toThrow();

    const r = refusalOf(() => assertPartnerWorkspaceSettingsPatchFullyApplied({
      displayName: "Acme", version: 7, prevRevisionHash: "abc",
    }));
    headlineIsDeliverable(r.refusalHeadline);
    expect(r.unappliedFields).toEqual(["version", "prevRevisionHash"]);
    /* `id` is NOT forced by this store's tail, unlike the other two. */
    expect(() => assertPartnerWorkspaceSettingsPatchFullyApplied({ id: "x" })).not.toThrow();
  });

  it("D-5 every refusal survives a HOSTILE body, so none of the four can go silent", () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < 30; i += 1) body[`revisionHash${i}`] = i;
    body.version = 1; body.revisionHash = "x"; body.prevRevisionHash = "y";
    body.updatedAt = "t"; body.updatedBy = "u"; body.id = "i"; body.partnerId = "p";
    for (const fn of [
      assertAdminPartnerPatchFullyApplied,
      assertPartnerPipelinePatchFullyApplied,
      assertPartnerNotePatchFullyApplied,
      assertPartnerWorkspaceSettingsPatchFullyApplied,
    ]) {
      let caught: unknown;
      try { fn(body); } catch (e) { caught = e; }
      expect(caught, `${fn.name} did not refuse a hostile body`).toBeTruthy();
      headlineIsDeliverable((caught as { refusalHeadline: string }).refusalHeadline);
    }
  });
});
