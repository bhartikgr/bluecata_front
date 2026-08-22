/**
 * WAVE 58c — THE FOUR REGRESSIONS (A1-A4), PROVED THROUGH HTTP ROUTES AND BY
 * EXECUTING THE SHARED MODULES, NEVER BY CALLING A STORE OR THE ENGINE DIRECTLY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Waves 52/52b shipped a flag no production code called; Wave 58 was recommended
 * on a reachability claim a live walkthrough refuted; `W58B_REVIEW_1_MATH.md`
 * graded 58b's reachability PARTIAL because four of its ten mutations were source
 * locks. So this file states its limit up front rather than at the end:
 *
 *   PROVED HERE — every round-creation and terms-edit payload the fixed client
 *   sends is ACCEPTED and STORED by the real routes over supertest, and read back
 *   out of them; every pure decision function is EXECUTED.
 *
 *   NOT PROVED HERE — no browser is opened, so "the founder's click produces this
 *   payload" is asserted against the JSX source, not against a rendered DOM. That
 *   gap is listed as UNVERIFIED in `WAVE58CD_REPORT.md` with what would settle it.
 *   It is not dressed up as reachability.
 *
 * MUTATION TRANSCRIPTS: `build_log/wave58cd/W58CD_NEW_TESTS.md`. Each test names
 * the single source edit that turns it red, with the recorded output.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
/* WAVE 86B · ITEM 3 (R77) — the Wave 84 fence's OWN classifier, so `W58CD-A1e`'s
   "not rendered" pole and the fence cannot drift apart: there is one definition of
   rendered copy in the tree, not two. */
import { fenceInternals } from "../../scripts/lint/internalLanguageFence";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  ledgerFullyDilutedPreMoneyShares,
  tryLedgerFullyDilutedPreMoneyShares,
  /* WAVE 58d · B3 — executed across all three views to test the "shown
     distinctly per Carta convention" claim the cap-table screen makes. */
  runEngine,
  resolveFdPreMoneyBase,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";
import {
  comparePricePerShare,
  parsePoolShareCountAsWritten,
  derivePoolTopUpFromPercent,
  /* WAVE 58d · B2 — `T × PPS` reconciled against `pre-money + new money`. */
  reconcileImpliedCapitalisation,
  PRICE_PER_SHARE_DECIMALS,
} from "../../client/src/lib/roundMath";
import { displayedOwnershipTotal } from "../../client/src/pages/founder/CapTable";

let app: Express;
const STAMP = String(Date.now());
const CO = `co_w58cd_${STAMP}`;
const ADMIN = "u_admin";

/* Source reads are anchored to THIS FILE, not to `process.cwd()`.
   `W58B_REVIEW_1_MATH.md` §5 recorded ten of 58b's display checks failing in an
   independent rerun purely because they resolved sources from the launch
   directory. Same extractor, any working directory. */
const ROOT = path.resolve(__dirname, "..", "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

async function createRound(payload: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload });
  return { status: res.status, body: res.body };
}

async function createRoundOk(payload: Record<string, unknown>): Promise<string> {
  const r = await createRound(payload);
  if (r.status !== 200) throw new Error(`createRound failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}

async function getRound(roundId: string): Promise<Record<string, any>> {
  const res = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
  expect(res.status).toBe(200);
  return res.body as Record<string, any>;
}

async function patchTerms(roundId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .patch(`/api/rounds/${roundId}/terms`)
    .set("x-user-id", ADMIN)
    .send(body);
  return { status: res.status, body: res.body };
}

async function securities(companyId: string): Promise<ApiSecurity[]> {
  const res = await request(app)
    .get(`/api/companies/${encodeURIComponent(companyId)}/securities`)
    .set("x-user-id", ADMIN);
  expect(res.status).toBe(200);
  return res.body as ApiSecurity[];
}

const sec = (o: Partial<ApiSecurity>): ApiSecurity =>
  ({
    id: "s1", companyId: CO, holderName: "H", holderType: "investor", instrument: "common",
    series: null, shares: 0, pricePerShare: null, investmentAmount: null, cap: null,
    discount: null, issuedAt: "2026-01-01", ...o,
  }) as ApiSecurity;

/* The canonical A1 fixture, and the reason the numbers below are what they are.
   Independently recomputed with exact decimals in
   `build_log/wave58cd/w58cd_exact_math.py`; a reviewer can re-run it and diff.

     B = 10,000,000 declared · u = 0 · PMV $18,000,000 · raise $2,000,000 · q 10%
     PRE-MONEY:  S = (10·10,000,000·20,000,000) / (100·18,000,000 − 10·20,000,000)
                   = 2e15 / 1.6e9                       = 1,250,000
                 D = 11,250,000 · p = 18,000,000/11,250,000 = $1.60
     NO POOL:    p = 18,000,000/10,000,000                  = $1.80
   $1.80 is the price live quotes for these terms (`LIVE_AUDIT_2026_08_15.md`),
   which is exactly why the stale-price case is the live-plausible one. */
const A1_FIXTURE = {
  poolPercentPostMoney: "10",
  poolPlacement: "pre_money" as const,
  fdPreMoneyShares: "10000000",
  preMoneyValuation: "18000000",
  investmentAmount: "2000000",
  existingPoolShares: "0",
};

let safePoolRoundId = "";
let notePoolRoundId = "";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 90_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * A1 — THE EDIT-TERMS DIALOG CAN NO LONGER SAVE A PRICE THE PLATFORM
 *      ITSELF CONTRADICTS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58CD-A1 — a saved price and a derived price can never disagree silently", () => {
  it("W58CD-A1a — the exact defect from the review reproduces as a DETECTED contradiction: $1.80 typed vs $1.60 derived, difference stated", () => {
    const d = derivePoolTopUpFromPercent(A1_FIXTURE);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    /* Independently computed, not read off a run. */
    expect(d.poolTopUpShares.toString()).toBe("1250000");
    expect(d.pricePerShare).toBe("1.6");

    const agreement = comparePricePerShare(1.8, d.pricePerShare);
    expect(agreement).not.toBeNull();
    expect(agreement!.agrees).toBe(false);
    expect(agreement!.savedExact).toBe("1.8");
    expect(agreement!.derivedExact).toBe("1.6");
    /* BOTH numbers and THE DIFFERENCE, which is what the spec requires on screen. */
    expect(agreement!.differenceExact).toBe("-0.2");
    expect(agreement!.applyValue).toBe("1.6");
  });

  it("W58CD-A1b — agreement is judged at the field's own precision, so a repeating derived price is still clearable", () => {
    /* The live audit's own case: 500,000 pool shares on a 10,000,000 base gives
       PPS = 18,000,000 / 10,500,000 = $1.714285714…, a repeating decimal. A
       founder cannot type it in full, so if the refusal demanded exact equality
       it could never be cleared — the fix would be a new dead end. */
    const repeating = derivePoolTopUpFromPercent({
      ...A1_FIXTURE,
      poolPercentPostMoney: "10",
      fdPreMoneyShares: "10500000",
    });
    expect(repeating.ok).toBe(true);
    if (!repeating.ok) return;
    const exact = repeating.pricePerShare;
    const rounded = comparePricePerShare(0, exact)!.applyValue;
    expect(rounded.split(".")[1]?.length ?? 0).toBeLessThanOrEqual(PRICE_PER_SHARE_DECIMALS);
    /* Typing the rounded value CLEARS the refusal. */
    const afterApply = comparePricePerShare(rounded, exact);
    expect(afterApply!.agrees).toBe(true);
    expect(afterApply!.derivedIsRepeating).toBe(exact !== rounded);
  });

  it("W58CD-A1c — absence is never read as agreement", () => {
    /* A caller with no derivation on screen gets `null`, not `{agrees:true}`.
       Reading absence as agreement is how a cross-field rule silently stops
       firing. */
    expect(comparePricePerShare(1.8, null)).toBeNull();
    expect(comparePricePerShare(1.8, "")).toBeNull();
    expect(comparePricePerShare(1.8, undefined)).toBeNull();
  });

  it("W58CD-A1d — matching prices agree exactly, so the rule does not block a correct round", () => {
    const d = derivePoolTopUpFromPercent(A1_FIXTURE);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const a = comparePricePerShare(1.6, d.pricePerShare);
    expect(a!.agrees).toBe(true);
    expect(a!.differenceExact).toBe("0");
  });

  it("W58CD-A1e — the dialog RENDERS both numbers and the difference, BLOCKS the save, and states why", () => {
    const s = src("client/src/pages/founder/Rounds.tsx");
    /* The refusal panel, by name, with both figures and the difference. */
    expect(s).toContain('data-testid="edit-pool-price-contradiction"');
    expect(s).toContain('data-testid="edit-price-contradiction-saved"');
    expect(s).toContain('data-testid="edit-price-contradiction-derived"');
    expect(s).toContain('data-testid="edit-price-contradiction-difference"');
    /* The save is refused, and the disabled button is NOT silent. */
    /* AMENDED BY WAVE 58e, STRICTLY STRONGER. This pinned the WHOLE `disabled`
       expression as a literal, so 58e's ADDITIONAL block (a discount or interest
       rate outside its permitted range — D2) turned it red even though the A1 rule
       it exists to protect is untouched. A literal-whole-expression pin cannot
       survive a second, legitimate blocking condition without forbidding one, which
       would be a pin that prevents a fix. It is replaced by assertions on each
       CONDITION, which is what A1 actually requires and which a future third
       condition also cannot silently break:
         · the pending flag still gates it,
         · A1's price contradiction still gates it,
         · and 58e's term-range block gates it too. */
    expect(s).toMatch(/disabled=\{saveMut\.isPending \|\| editPriceContradicted( \|\| \w+)*\}/);
    expect(s).toContain("editPriceContradicted || editTermsOutOfRange");
    expect(s).toContain('data-testid="edit-save-blocked-reason"');
    /* The derived value can also flow into the field, on an explicit action. */
    expect(s).toContain('data-testid="edit-price-apply-derived"');
    expect(s).toContain("setPricePerShare(Number(editPriceAgreement.applyValue))");
    /* And the rule is enforced in the mutation itself, not only in the UI.
       WAVE 85 — STALE COPY PIN, RE-POINTED. Wave 83 rewrote the message this belt-and
       -braces guard throws, because that message is rendered verbatim in the founder's
       failure toast. Both strings, verbatim (`Rounds.tsx` ~:678):
         OLD: `price_contradicts_pool: the round would store $${...savedExact} while this pool `
         NEW: `The price per share contradicts this option pool: the round would store $${...savedExact} while this pool `
       WHAT THIS ASSERTION IS FOR IS UNCHANGED AND STILL PROVED: the guard is still
       inside `saveMut`, so a programmatic click, a re-render race or a future caller
       still cannot post a price the platform has proved wrong.

       ── RESOLVED BY WAVE 86B UNDER R77 · BOTH POLES, ON ONE RULE ───────────────
       Wave 85 recorded this as blocked on the owner: the identifier had to exist so
       a caller could tell WHICH rule refused, but restoring it appeared to collide
       with Wave 83's ban. It no longer does. R77 rules that an internal identifier
       is a defect only WHERE A USER CAN READ IT, and Waves 84/85 narrowed the Wave
       83 pin to `renderedCopy()` — the Wave 84 fence's own classifier — so the two
       poles are compatible and are BOTH asserted here. */
    // POLE A — the prose a founder reads is identifier-free, and is the Wave 83 sentence.
    expect(s).toContain("The price per share contradicts this option pool");
    expect(fenceInternals.collect(path.join(ROOT, "client/src/pages/founder/Rounds.tsx"))
      .filter((n: { text: string }) => fenceInternals.isCopy(n))
      .map((n: { text: string }) => n.text)
      .join("\n")).not.toContain("price_contradicts_pool");
    // POLE B — and a caller can still tell WHICH rule fired, off-screen.
    expect(s).toContain('refusal.code = "price_contradicts_pool"');
    expect(s).toContain('refusal.refusalName = "price_contradicts_pool"');
    // The guard is still the `throw` inside the mutation, not a rendered string.
    expect(s).toMatch(/if \(editPriceContradicted && editPriceAgreement\) \{[\s\S]{0,1600}?throw refusal;/);
  });

  it("W58CD-A1f — the SACRED consumer of that stored price is unchanged and still derives shares from it", () => {
    /* Not an assertion about our code — an assertion about WHY A1 matters, kept
       beside the fix so it cannot drift. `captableCommitStore.ts` is SACRED:
       read, never edited. */
    const commit = src("server/captableCommitStore.ts");
    expect(commit).toContain("shares = floor(amount_in_currency_units / pricePerShare)");
    expect(commit).toContain("round?.pricePerShare");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A2 — THE POOL REMAINS EXPRESSIBLE ON SAFE AND NOTE ROUNDS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58CD-A2 — no instrument loses the ability to record a pool", () => {
  it("W58CD-A2a — the percentage path refuses TWICE on an unpriced round, so collecting the FD base alone would NOT have fixed it", () => {
    /* This is the spec correction, executed. Refusal 1: no base at all. */
    const noBase = resolveFdPreMoneyBase({ declaredFdPreMoneyShares: "", ledgerFdShares: BigInt(0) });
    expect(noBase.ok).toBe(false);
    if (noBase.ok) return;
    expect(noBase.code).toBe("fd_base_unavailable");

    /* Refusal 2, WITH the base supplied — which the spec's remedies do not reach.
       A SAFE has a valuation CAP, not a pre-money valuation. */
    const withBase = derivePoolTopUpFromPercent({
      poolPercentPostMoney: "10",
      poolPlacement: "pre_money",
      fdPreMoneyShares: "10000000",
      preMoneyValuation: "",
      investmentAmount: "500000",
      existingPoolShares: "0",
    });
    expect(withBase.ok).toBe(false);
    if (withBase.ok) return;
    expect(withBase.code).toBe("pre_money_missing_for_pool");
  });

  it("W58CD-A2b — the share-count unit accepts what live accepts, and closes the two holes the live audit found on that field", () => {
    const ok = parsePoolShareCountAsWritten("500000");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.shares.toString()).toBe("500000");
    /* LIVE_AUDIT_2026_08_15.md: `-5` was "accepted, NO error" here while the
       standalone percentage field rejected it. Same app, two answers. */
    const neg = parsePoolShareCountAsWritten("-5");
    expect(neg.ok).toBe(false);
    if (!neg.ok) expect(neg.code).toBe("pool_shares_negative");
    /* And a share count is never rounded into existence. */
    const frac = parsePoolShareCountAsWritten("1000.5");
    expect(frac.ok).toBe(false);
    if (!frac.ok) expect(frac.code).toBe("pool_shares_fractional");
    const zero = parsePoolShareCountAsWritten("0");
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.code).toBe("pool_shares_zero");
    const blank = parsePoolShareCountAsWritten("");
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe("pool_shares_missing");
  });

  it("W58CD-A2c — THROUGH THE ROUTE: a SAFE round stores the placement, and its child option-pool round stores the share count", async () => {
    /* Exactly the two payloads the fixed wizard sends for a SAFE with a pool.
       The parent carries `optionPoolMode` and NO percentage (none has been
       established — R16 forbids filing a share count as a percentage). */
    safePoolRoundId = await createRoundOk({
      companyId: CO, name: `W58cd SAFE pool ${STAMP}`, type: "seed", state: "active",
      instrument: "safe_post", targetAmount: 500_000, currency: "USD",
      valuationCap: 5_000_000, discount: 20,
      optionPoolPostPercent: null, optionPoolMode: "pre_money",
    });
    const parent = await getRound(safePoolRoundId);
    expect(parent.instrument).toBe("safe_post");
    expect(parent.optionPoolMode).toBe("pre_money");
    /* No percentage was invented from a share count. */
    expect(parent.optionPoolPostPercent ?? null).toBeNull();

    const childId = await createRoundOk({
      companyId: CO, type: "seed", instrument: "option_pool",
      name: `W58cd SAFE pool ${STAMP} — Option Pool`,
      poolSize: "500000", sharesAuthorized: "500000",
      optionPoolPostPercent: null, optionPoolMode: "pre_money",
      region: "US", termsheetChoice: "skip", parentRoundId: safePoolRoundId,
    });
    const child = await getRound(childId);
    expect(child.instrument).toBe("option_pool");
    expect(String(child.poolSize)).toBe("500000");
    expect(child.optionPoolMode).toBe("pre_money");
  });

  it("W58CD-A2d — THROUGH THE ROUTE: the same holds for a convertible note, and for the post-money placement", async () => {
    notePoolRoundId = await createRoundOk({
      companyId: CO, name: `W58cd NOTE pool ${STAMP}`, type: "seed", state: "active",
      instrument: "convertible_note", targetAmount: 750_000, currency: "USD",
      valuationCap: 6_000_000, discount: 20, interestRate: 6, maturityMonths: 24,
      optionPoolPostPercent: null, optionPoolMode: "post_money",
    });
    const parent = await getRound(notePoolRoundId);
    expect(parent.instrument).toBe("convertible_note");
    expect(parent.optionPoolMode).toBe("post_money");

    const childId = await createRoundOk({
      companyId: CO, type: "seed", instrument: "option_pool",
      name: `W58cd NOTE pool ${STAMP} — Option Pool`,
      poolSize: "250000", sharesAuthorized: "250000",
      optionPoolMode: "post_money", region: "US", termsheetChoice: "skip",
      parentRoundId: notePoolRoundId,
    });
    expect(String((await getRound(childId)).poolSize)).toBe("250000");
  });

  it("W58CD-A2e — the wizard renders a TYPED share count on unpriced instruments and a DERIVED one on priced, and says which and why", () => {
    const s = src("client/src/pages/founder/RoundNew.tsx");
    /* The unit is instrument-driven, not flag-driven. */
    expect(s).toContain('const poolEntryUnit: "percent" | "shares" = isPricedInstrument ? "percent" : "shares";');
    /* The share-count field is WRITEABLE on the unpriced branch. */
    expect(s).toContain('readOnly={poolEntryUnit === "percent"}');
    expect(s).toContain("onChange={e => setAddonPoolDraft(d => ({ ...d, poolSize: e.target.value }))}");
    /* The derived-value mirror no longer erases what the founder typed. */
    expect(s).toContain("if (!isPricedInstrument) return;");
    /* The placement is stored for a share-count pool too. */
    expect(s).toContain("poolExpressed ? addonPoolDraft.poolMode : null");
    /* And the reason is on screen, not only in a comment. */
    expect(s).toContain('data-testid="addon-pool-unit-note"');
    expect(s).toContain('data-testid="addon-pool-unpriced-recap"');
    expect(s).toContain('data-testid="err-addon-pool-size"');
  });

  it("W58CD-A2f — ALL SEVEN INSTRUMENTS remain creatable through the route, and none is disabled", async () => {
    /* The capability table in `W58C_REGRESSIONS.md` is generated from this test,
       not written by hand. Every row is an HTTP round-trip. */
    const rows: Array<{ instrument: string; payload: Record<string, unknown> }> = [
      /* `common` is a PRICED instrument, so the route requires the full priced
         field set. Discovered from the route's own 400, not assumed. */
      { instrument: "common", payload: { instrument: "common", targetAmount: 1000, preMoney: 1_000_000, pricePerShare: 0.1, sharesAuthorized: "10000", fdPreMoneyShares: "10000000" } },
      { instrument: "preferred", payload: { instrument: "preferred", targetAmount: 2_000_000, preMoney: 18_000_000, pricePerShare: 1.8, sharesAuthorized: "1111111", fdPreMoneyShares: "10000000" } },
      { instrument: "safe_post", payload: { instrument: "safe_post", targetAmount: 500_000, valuationCap: 5_000_000, discount: 20 } },
      { instrument: "safe_pre", payload: { instrument: "safe_pre", targetAmount: 400_000, valuationCap: 4_000_000, discount: 20 } },
      { instrument: "convertible_note", payload: { instrument: "convertible_note", targetAmount: 300_000, valuationCap: 3_000_000, discount: 20, interestRate: 6, maturityMonths: 24 } },
      { instrument: "warrant", payload: { instrument: "warrant", sharesAuthorized: "100000", strikePrice: 0.5, expiryYears: 10, targetAmount: 50_000 } },
      { instrument: "option_pool", payload: { instrument: "option_pool", poolSize: "300000", sharesAuthorized: "300000", poolTiming: "pre_money", optionPoolMode: "pre_money", targetAmount: 0 } },
    ];
    for (const r of rows) {
      const created = await createRound({
        companyId: CO, type: "seed", state: "active", currency: "USD",
        name: `W58cd INST ${r.instrument} ${STAMP}`, region: "US",
        ...r.payload,
      });
      expect(created.status, `${r.instrument} -> ${JSON.stringify(created.body)}`).toBe(200);
      const back = await getRound(created.body.id);
      expect(back.instrument).toBe(r.instrument);
    }
    /* And the selector itself still offers exactly seven, none disabled. */
    const schema = src("shared/schema.ts");
    for (const v of ["common", "preferred", "safe_post", "safe_pre", "convertible_note", "warrant", "option_pool"]) {
      expect(schema).toContain(`value: "${v}"`);
    }
  });

  it("W58CD-A2g — both placement options remain selectable on BOTH pool surfaces", () => {
    const wizard = src("client/src/pages/founder/RoundNew.tsx");
    const edit = src("client/src/pages/founder/Rounds.tsx");
    /* Add-on surface. */
    expect(wizard).toContain('<SelectItem value="pre_money">');
    expect(wizard).toContain('<SelectItem value="post_money">');
    /* Standalone Option-Pool vehicle ("Pool timing"). */
    expect(wizard).toContain('<Label>Pool timing</Label>');
    /* Edit-terms surface. */
    expect(edit).toContain('<SelectItem value="pre_money">');
    expect(edit).toContain('<SelectItem value="post_money">');
    /* Nothing was disabled to make any of this work. */
    expect(wizard).not.toContain('<SelectItem value="post_money" disabled');
    expect(edit).not.toContain('<SelectItem value="post_money" disabled');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A3 — A LEDGER THAT CANNOT BE READ IS A NAMED REFUSAL, NOT A THROW
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58CD-A3 — the render-scope engine call no longer throws on live-plausible data", () => {
  it("W58CD-A3a — an OUT-OF-RANGE committed discount still THROWS through the old entry point (AMENDED BY WAVE 58e)", () => {
    /* AMENDED, AND WHY — stated rather than quietly rewritten. Until Wave 58e this
       assertion used `discount: 20` and expected a throw, because the adapter had no
       conversion and the wire guard rejected any percent-scale value. Owner ruling
       R30 then settled the unit question (storage is percent-as-written) and WAVE
       58e · D1 added the one declared conversion at the boundary, so `20` now
       legitimately converts to the wire fraction `0.2` and computes — see
       `W58E-D1b/D1g`. The assertion is therefore RE-POINTED, not relaxed: it now
       uses the LIVE CORRUPT VALUE `20260707` (owner ruling R31-a, round
       `rnd_64e9d6ad728a`), which is still refused after the conversion because
       20260707 / 100 = 202607.07 is outside [0,1]. Strictly stronger — it pins the
       surviving guard against the real defect instead of against a value the
       platform is now required to accept.

       The throwing form itself is UNCHANGED — the server calls it inside its
       handler `try` and 58b's tests pin it. */
    expect(() =>
      ledgerFullyDilutedPreMoneyShares([sec({ instrument: "safe", investmentAmount: 100_000, cap: 5_000_000, discount: 20260707 })]),
    ).toThrow(/INVALID_DISCOUNT_FRACTION/);
    /* AND THE NEW FACT, asserted here so this file cannot drift from 58e: the house
       percent-as-written `20` is now READ, not refused. */
    expect(
      ledgerFullyDilutedPreMoneyShares([sec({ instrument: "safe", investmentAmount: 100_000, cap: 5_000_000, discount: 20 })]).toString(),
    ).toBe("0");
  });

  it("W58CD-A3b — the same data through the render-scope entry point returns a NAMED REFUSAL, and names the unit conflict (AMENDED BY WAVE 58e)", () => {
    /* AMENDED for the same reason as A3a: the fixture moves from `20` (now valid) to
       the live corrupt `20260707` (still refused). The assertions below are
       unchanged in strength — including the one that proves nothing is rescaled. */
    const r = tryLedgerFullyDilutedPreMoneyShares([
      sec({ instrument: "safe", investmentAmount: 100_000, cap: 5_000_000, discount: 20260707 }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("ledger_unreadable");
    expect(r.reason).toMatch(/will not guess/i);
    expect(r.detail).toMatch(/INVALID_DISCOUNT_FRACTION/);
    /* And it does NOT rescale: 20 never becomes 0.2 anywhere on this path. */
    expect(r.reason).not.toMatch(/0\.2 has been assumed|interpreted as 20%/i);
  });

  it("W58CD-A3c — the other three executed throw cases are refusals too, and the good cases are byte-identical to the old function", () => {
    /* AMENDED BY WAVE 58e: the note fixture moves from `20` to the live corrupt
       `20260707` for the reason recorded in A3a. The other two cases (a null share
       count and a fractional one) are untouched. */
    for (const bad of [
      sec({ instrument: "note", investmentAmount: 100_000, cap: 5_000_000, discount: 20260707 }),
      sec({ shares: null as unknown as number }),
      sec({ shares: 1000.5 }),
    ]) {
      const r = tryLedgerFullyDilutedPreMoneyShares([bad]);
      expect(r.ok).toBe(false);
    }
    /* No arithmetic changed: where the old function returned, this returns the
       identical bigint. */
    for (const good of [[], [sec({ shares: 8_000_000 })], [sec({ instrument: "safe", investmentAmount: 1000, discount: 0.2 })]]) {
      const r = tryLedgerFullyDilutedPreMoneyShares(good as ApiSecurity[]);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.shares).toBe(ledgerFullyDilutedPreMoneyShares(good as ApiSecurity[]));
    }
  });

  it("W58CD-A3d — the two NEW founder screens use the non-throwing form and render the refusal", () => {
    const wizard = src("client/src/pages/founder/RoundNew.tsx");
    const edit = src("client/src/pages/founder/Rounds.tsx");
    expect(wizard).toContain("tryLedgerFullyDilutedPreMoneyShares(existingPoolQ.data as unknown as ApiSecurity[])");
    expect(wizard).not.toContain("ledgerFullyDilutedPreMoneyShares(existingPoolQ.data as unknown as ApiSecurity[])");
    expect(edit).toContain("tryLedgerFullyDilutedPreMoneyShares(editSecurities.data)");
    expect(edit).toContain('data-testid="edit-ledger-unreadable"');
  });

  it("W58CD-A3e — the wire-unit contradiction is REAL and is escalated, not silently resolved", () => {
    /* Producers document percent-as-written; the engine adapter's consumer
       contract demands a fraction. Both sides are quoted here so the owner
       question in `WAVE58CD_REPORT.md` cannot be read as speculation. */
    const schema = src("shared/schema.ts");
    expect(schema).toContain('discount: real("discount"),       // SAFE/Note discount %');
    expect(schema).toContain('discountPct: text("discount_pct"),           // Decimal-as-string (e.g. "20" = 20%)');
    const adapter = src("shared/roundMathEngineAdapter.ts");
    expect(adapter).toContain("discounts are FRACTIONAL on the wire and must be within [0,1]");
    /* The forbidden magnitude heuristic is still absent from the adapter's CODE.
       The regex is applied to non-comment lines only, because the WAVE 3F block
       QUOTES the removed heuristic verbatim so a reader can see what was taken
       out — a naive whole-file match reports that documentation as the defect.
       Found by running this assertion and reading its failure, not assumed. */
    const adapterCode = adapter
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join("\n");
    expect(adapterCode).not.toMatch(/discount\s*>\s*1\s*\?/);
    expect(adapterCode).toContain("readDiscountFraction");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A4 — AN EMPTY CAP TABLE MUST NOT PRINT 0.00% UNDER A NOTE CLAIMING 100%
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58CD-A4 — the empty cap table is honest", () => {
  it("W58CD-A4a — zero rows is its own state: `empty` true, `exact` FALSE, no 100% claim available", () => {
    const t = displayedOwnershipTotal([]);
    expect(t.empty).toBe(true);
    expect(t.exact).toBe(false);
    expect(t.sum).toBe("0.00");
  });

  it("W58CD-A4b — a populated table that happens to sum to 0.00% is NOT the empty state", () => {
    /* Both holders round to 0.00% at 2dp. This is a rounding note, not an empty
       table, and conflating them would hide a real reconciliation problem. */
    const t = displayedOwnershipTotal([{ ownershipPercent: "0.001" }, { ownershipPercent: "0.002" }]);
    expect(t.empty).toBe(false);
    expect(t.exact).toBe(false);
    expect(t.sum).toBe("0.00");
  });

  it("W58CD-A4c — a reconciling table is still exact, and a rounding residual is still reported", () => {
    const exact = displayedOwnershipTotal([{ ownershipPercent: "60" }, { ownershipPercent: "40" }]);
    expect(exact.exact).toBe(true);
    expect(exact.empty).toBe(false);
    expect(exact.sum).toBe("100.00");
    const residual = displayedOwnershipTotal([
      { ownershipPercent: "33.333333" }, { ownershipPercent: "33.333333" }, { ownershipPercent: "33.333334" },
    ]);
    expect(residual.exact).toBe(false);
    expect(residual.sum).toBe("99.99");
  });

  it("W58CD-A4d — the empty branch is rendered FIRST, so neither the 100% note nor the sr-only 100.00% can print on an empty table", () => {
    const s = src("client/src/pages/founder/CapTable.tsx");
    expect(s).toContain('data-testid="captable-flat-total-empty-note"');
    const empty = s.indexOf("displayedTotal.empty ? (");
    const exactBranch = s.indexOf("displayedTotal.exact ? (");
    const note = s.indexOf('data-testid="captable-flat-total-rounding-note"');
    expect(empty).toBeGreaterThan(-1);
    expect(empty).toBeLessThan(exactBranch);
    expect(empty).toBeLessThan(note);
    /* The guard identity is unchanged: the cell still has its direct `%` text. */
    expect(s).toContain('<span data-testid="captable-flat-total-percent">{displayedTotal.sum}</span>%');
  });

  it("W58CD-A4e — THROUGH THE ROUTE: a company with no committed securities really does return zero rows", async () => {
    /* The branch above is only worth fixing because it is the LIVE state. Proved
       from the endpoint the cap-table page reads, not from a fixture. */
    const secs = await securities(`co_w58cd_empty_${STAMP}`);
    expect(Array.isArray(secs)).toBe(true);
    expect(secs.length).toBe(0);
    expect(displayedOwnershipTotal([]).empty).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * NON-REGRESSION — the 58b behaviour this wave must not disturb
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58CD-NR — 58b's priced-round behaviour is unchanged", () => {
  it("W58CD-NR1 — a priced round still derives the pool from a PERCENTAGE and still stores it", async () => {
    const id = await createRoundOk({
      companyId: CO, name: `W58cd priced ${STAMP}`, type: "seed", state: "active",
      instrument: "preferred", targetAmount: 2_000_000, preMoney: 18_000_000,
      pricePerShare: 1.6, sharesAuthorized: "1250000", fdPreMoneyShares: "10000000",
      currency: "USD", optionPoolPostPercent: "10", optionPoolMode: "pre_money",
    });
    const back = await getRound(id);
    expect(String(back.optionPoolPostPercent)).toBe("10");
    expect(back.optionPoolMode).toBe("pre_money");
  });

  it("W58CD-NR2 — the terms route still accepts a pool edit, and still clears it", async () => {
    const id = await createRoundOk({
      companyId: CO, name: `W58cd editable ${STAMP}`, type: "seed", state: "active",
      instrument: "preferred", targetAmount: 2_000_000, preMoney: 18_000_000,
      pricePerShare: 1.8, sharesAuthorized: "1111111", fdPreMoneyShares: "10000000",
      currency: "USD",
    });
    const add = await patchTerms(id, { optionPoolPostPercent: "10", optionPoolMode: "pre_money", pricePerShare: 1.6 });
    expect(add.status).toBe(200);
    expect(String((await getRound(id)).optionPoolPostPercent)).toBe("10");
    const clear = await patchTerms(id, { optionPoolPostPercent: null, optionPoolMode: null });
    expect(clear.status).toBe(200);
    expect((await getRound(id)).optionPoolPostPercent ?? null).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * PART B — WAVE 58d: INVESTOR-GRADE CONVENTIONS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58CD-B1 — the pool control expresses TWO decisions, and removes no option", () => {
  it("W58CD-B1a — all THREE pool surfaces state the target basis separately from the pricing treatment", () => {
    const wizard = src("client/src/pages/founder/RoundNew.tsx");
    const edit = src("client/src/pages/founder/Rounds.tsx");
    for (const [file, testid] of [
      [wizard, "addon-pool-target-basis"],
      [wizard, "standalone-pool-target-basis"],
      [edit, "edit-pool-target-basis"],
    ] as const) {
      expect(file).toContain(`data-testid="${testid}"`);
    }
    /* The precise term-sheet formulation the review asked for, verbatim, on each. */
    expect(wizard).toContain('data-testid="addon-pool-counsel-formulation"');
    expect(wizard).toContain('data-testid="standalone-pool-pricing-treatment"');
    expect(edit).toContain('data-testid="edit-pool-counsel-formulation"');
    for (const f of [wizard, edit]) {
      expect(f).toContain("INCLUDED in fully-diluted pre-money capitalization; existing holders bear the dilution");
      expect(f).toContain("EXCLUDED from pre-money pricing and added after the closing; all holders dilute pro rata");
    }
    /* "Pricing treatment" is now the operative heading on the add-on and the edit
       dialog — "pre-money pool / post-money pool" is no longer the sole label. */
    expect(wizard).toContain("Pricing treatment — who pays for the pool?");
    expect(edit).toContain("Pricing treatment — who pays for the pool?");
  });

  it("W58CD-B1b — RE-EXPRESSION, NOT REDUCTION: every option string that exists on live still renders", () => {
    /* The two `ESOP_TIMING` labels the 2026-08-15 live walkthrough recorded on the
       standalone vehicle, byte for byte. */
    const schema = src("shared/schema.ts");
    expect(schema).toContain("Pre-money pool (dilutes founders only — investor-friendly)");
    expect(schema).toContain("Post-money pool (dilutes everyone — founder-friendly)");
    const wizard = src("client/src/pages/founder/RoundNew.tsx");
    const edit = src("client/src/pages/founder/Rounds.tsx");
    /* The two Wave 58 add-on labels, byte for byte, on both add-on surfaces. */
    /* Asserted as the WHOLE `SelectItem` element, not as a bare substring. A
       substring assertion was NOT falsified by mutating the option label, because
       the same words also appear in the explanatory comment above it — found by
       running the mutation, not by assuming the test was strong. */
    for (const f of [wizard, edit]) {
      expect(f).toContain('<SelectItem value="pre_money">Pre-money — the founders pay for it alone (market default)</SelectItem>');
      expect(f).toContain('<SelectItem value="post_money">Post-money — everyone pays for it pro-rata</SelectItem>');
    }
    /* And the original labels survive as identities, so nothing is dropped. */
    expect(wizard).toContain("<Label>Pool timing</Label>");
    expect(wizard).toContain('<Label className="text-xs">Pool placement</Label>');
    expect(edit).toContain('<Label className="text-xs">Pool placement</Label>');
  });
});

describe("W58CD-B2 — the implied fully-diluted capitalisation is reconciled, in exact decimals", () => {
  /* The canonical fixture from the spec and from `W58B_REVIEW_1_MATH.md` §2.3:
     B = 8,000,000 · PMV $30,000,000 · raise $10,000,000 · target 15%. */
  const CANON = {
    poolPercentPostMoney: "15",
    fdPreMoneyShares: "8000000",
    preMoneyValuation: "30000000",
    investmentAmount: "10000000",
    existingPoolShares: "0",
  };

  it("W58CD-B2a — POST-MONEY: $47,058,821.25 against a nominal $40,000,000 — a difference of $7,058,821.25", () => {
    const d = derivePoolTopUpFromPercent({ ...CANON, poolPlacement: "post_money" });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.poolTopUpShares.toString()).toBe("1882353");
    expect(d.postMoneyFdShares.toString()).toBe("12549019");
    expect(d.pricePerShare).toBe("3.75");
    const r = reconcileImpliedCapitalisation({ ...CANON, derivation: d });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    /* Every figure the spec prints, reproduced independently. */
    expect(r.nominalPostMoney).toBe("40000000");
    expect(r.impliedFullyDilutedCapitalisation).toBe("47058821.25");
    expect(r.difference).toBe("7058821.25");
    expect(r.reconciles).toBe(false);
    /* And the difference is ATTRIBUTED, not left as an unexplained gap:
       reserve at price $7,058,823.75 − $2.50 floor residual = $7,058,821.25. */
    expect(r.poolValueAtPrice).toBe("7058823.75");
    expect(r.investorFloorResidual).toBe("2.5");
    expect(r.explanation).toMatch(/NOT an error|not an error/);
  });

  it("W58CD-B2b — PRE-MONEY: $39,999,999.00 against $40,000,000 — the difference is ENTIRELY the floor residual", () => {
    const d = derivePoolTopUpFromPercent({ ...CANON, poolPlacement: "pre_money" });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.postMoneyFdShares.toString()).toBe("13333333");
    expect(d.pricePerShare).toBe("3");
    const r = reconcileImpliedCapitalisation({ ...CANON, derivation: d });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.impliedFullyDilutedCapitalisation).toBe("39999999");
    expect(r.difference).toBe("-1");
    expect(r.investorFloorResidual).toBe("1");
  });

  it("W58CD-B2c — the reconciliation REFUSES BY NAME rather than reconciling against a blank", () => {
    const d = derivePoolTopUpFromPercent({ ...CANON, poolPlacement: "pre_money" });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const r = reconcileImpliedCapitalisation({ preMoneyValuation: "", investmentAmount: "10000000", derivation: d });
    expect(r.ok).toBe(false);
    if (!r.ok) return;
    expect(r.code).toBe("implied_cap_inputs_missing");
  });

  it("W58CD-B2d — it is RENDERED, not merely returned", () => {
    const wizard = src("client/src/pages/founder/RoundNew.tsx");
    expect(wizard).toContain('data-testid="addon-pool-implied-capitalisation"');
    expect(wizard).toContain('data-testid="implied-cap-nominal"');
    expect(wizard).toContain('data-testid="implied-cap-implied"');
    expect(wizard).toContain('data-testid="implied-cap-difference"');
    expect(wizard).toContain('data-testid="implied-cap-explanation"');
    /* Shown on BOTH placements — not gated on the post-money case only. */
    expect(wizard).toContain("{impliedCap && impliedCap.ok && (");
    expect(wizard).not.toContain('impliedCap.ok && addonPoolDraft.poolMode === "post_money" && (');
  });
});

describe("W58CD-B3 — each cap-table view states its own denominator", () => {
  it("W58CD-B3a — the three views are GENUINELY DISTINCT on a populated ledger (Review 1 §2.5 refuted by execution)", () => {
    /* Review 1: \"On normal inputs, Fully Diluted and As-Converted are therefore
       identical or omit the convertibles that are supposed to distinguish them.\"
       That is true of `computeCapTable`, but the CAP-TABLE SCREEN calls `runEngine`,
       which pre-converts SAFEs/notes for the as_converted view. Executed here so
       the correction is reproducible, not asserted. */
    const ledger: ApiSecurity[] = [
      sec({ id: "f1", holderName: "Founder A", holderType: "founder", instrument: "common", shares: 6_000_000, pricePerShare: 0.0001 }),
      sec({ id: "p1", holderName: "Seed Fund", instrument: "preferred", shares: 2_000_000, pricePerShare: 1.5, series: "Seed" }),
      sec({ id: "o1", holderName: "pool", holderType: "other", instrument: "option", shares: 1_000_000 }),
      sec({ id: "w1", holderName: "Bank", instrument: "warrant", shares: 500_000, pricePerShare: 0.5 }),
      sec({ id: "sa1", holderName: "Angel", instrument: "safe", investmentAmount: 250_000, cap: 8_000_000, discount: 0.2 }),
      /* WAVE 70 · D6 — `interestRate: 6` ADDED. A note with no rate on record now
         refuses instead of being priced at a hardcoded 5% (see W70-D6c). */
      sec({ id: "n1", holderName: "Lender", instrument: "note", investmentAmount: 150_000, cap: 8_000_000, discount: 0.2, interestRate: 6 }),
    ];
    /* ── WAVE 79 · ITEM 3 — THE CLOCK IS NOW SUPPLIED, AND HERE IS WHY ─────────
       THIS ASSERTION WAS A CALENDAR BOMB. `runEngine` read `new Date()`, and the
       `n1` note accrues 6% interest from its `issuedAt` to that date, so the pinned
       As-Converted total rose EVERY NIGHT. Measured: `9991276` on 2026-08-18,
       `9991305` on 2026-08-19 — `+29 shares` of one day's interest, and the test
       failed with no change to the tree (Review A §D-A3, Wave 78's drift proof).
       Wave 70 had already had to move this pin once, from `9975000` to `9991276`,
       which is the same symptom being treated twice.

       THE FIX IS THE CLOCK, NOT THE ASSERTION. `asOf` is the new optional last
       parameter of `runEngine`. `"2026-08-18"` is the day the values below were
       measured, so EVERY LITERAL IN THIS TEST IS UNCHANGED — the totals, the two
       converted share counts, the row counts and the three distinct founder
       percentages all still assert exactly what they asserted before. Nothing is
       widened, nothing is deleted, and the claim this test exists to make (the
       three views are genuinely distinct) is untouched. `W79-C2` additionally
       asserts that a LATER `asOf` accrues more, so the injection cannot be
       silently ignored by a future edit. */
    const AS_OF = "2026-08-18";
    const basic = runEngine(ledger, "basic", "US", undefined, AS_OF);
    const fd = runEngine(ledger, "fully_diluted", "US", undefined, AS_OF);
    const ac = runEngine(ledger, "as_converted", "US", undefined, AS_OF);
    expect(basic.totalShares.toString()).toBe("8000000");
    expect(fd.totalShares.toString()).toBe("9500000");
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 70 · D4 — 9,975,000 → 9,991,276. THE CLAIM THIS TEST MAKES IS INTACT.
       ═══════════════════════════════════════════════════════════════════════
       This test exists to refute Review 1 §2.5 by showing the three views are
       genuinely distinct. They still are, and by MORE than before. What moved is
       the As-Converted total, because the preview no longer has its own
       conversion: it now calls the engine's `convertSafeToPreferred` /
       `convertNoteToPreferred`, the same functions that run at close.

         Angel  (SAFE $250,000, cap $8,000,000)   296,875 → 306,451
             the cap is applied POST-money now: effectiveCap = 8,000,000 −
             250,000 = 7,750,000; rebased = 9,500,000 × 8,000,000 ÷ 7,750,000 =
             9,806,452; capPrice = $0.8157… against the old pre-money $0.8421…
         Lender (note $150,000, 6% APR)           178,125 → 184,825
             ACCRUED INTEREST is now inside the count. It was omitted entirely:
             the preview converted `investmentAmount` and nothing else.

       Both changes take the preview TOWARDS the number the engine produces at
       close and away from the 250,000/190,494-share divergences recorded in
       finding D4. Nothing about this test's purpose is relaxed — the three
       totals, the three row counts and the three distinct founder percentages
       are all still asserted. */
    expect(ac.totalShares.toString()).toBe("9991276");
    expect(ac.rows.find((x) => x.holderName === "Angel")!.shares.toString()).toBe("306451");
    expect(ac.rows.find((x) => x.holderName === "Lender")!.shares.toString()).toBe("184825");
    expect(basic.rows.length).toBe(2);
    expect(fd.rows.length).toBe(4);
    expect(ac.rows.length).toBe(6);
    /* Three different denominators means three different percentages for the SAME
       holder — which is what "shown distinctly" has to mean to be worth saying. */
    const pct = (r: { rows: Array<{ holderName: string; ownershipPercent: string }> }) =>
      r.rows.find((x) => x.holderName === "Founder A")!.ownershipPercent;
    expect(new Set([pct(basic), pct(fd), pct(ac)]).size).toBe(3);
  });

  it("W58CD-B3b — the denominator definition is on screen, per view, with includes/excludes and the market caveat", () => {
    const s = src("client/src/pages/founder/CapTable.tsx");
    expect(s).toContain('data-testid="captable-denominator-definition"');
    expect(s).toContain('data-testid="captable-denominator-includes"');
    expect(s).toContain('data-testid="captable-denominator-excludes"');
    expect(s).toContain('data-testid="captable-denominator-authority"');
    /* Driven by the SELECTED view, not one hardcoded paragraph. ALL THREE reads
       are asserted: a single `toContain` was not falsified by pinning one of them
       to a literal view, because the other two still matched. */
    expect(s).toContain("DENOMINATOR_DEFINITION[view].includes");
    expect(s).toContain("DENOMINATOR_DEFINITION[view].excludes");
    expect(s).toContain("DENOMINATOR_DEFINITION[view].authority");
    expect(s).not.toMatch(/DENOMINATOR_DEFINITION\.(basic|fully_diluted|as_converted)\./);
    /* All three views are defined, and the FD/market divergence is stated. */
    for (const v of ["basic:", "fully_diluted:", "as_converted:"]) expect(s).toContain(v);
    expect(s).toContain("NARROWER THAN THE MARKET TERM");
    /* Unissued authorised capital is named as excluded on every view. */
    expect(s.match(/unissued authorised \(charter\) capital/g)?.length).toBeGreaterThanOrEqual(2);
    /* The as_converted definition names it too, phrased as the only exclusion. */
    expect(s).toContain("unissued authorised (charter) capital. Nothing else outstanding is left out.");
  });
});

describe("W58CD-B4 — the two pool surfaces' units are converged as far as they honestly can be, and the residue is stated", () => {
  it("W58CD-B4a — the percentage is the unit wherever a percentage is DEFINABLE; the share count only where it is not", () => {
    const wizard = src("client/src/pages/founder/RoundNew.tsx");
    /* Standalone vehicle: percentage. Priced add-on: percentage. Both say so. */
    expect(wizard).toContain("Pool size (% of fully-diluted)");
    expect(wizard).toContain('data-testid="standalone-pool-unit-note"');
    /* And the ONE place a share count remains is named, with the reason, on the
       screen where it appears. */
    expect(wizard).toContain('data-testid="addon-pool-unit-note"');
    expect(wizard).toContain("it has a valuation <strong>cap</strong>");
  });
});
