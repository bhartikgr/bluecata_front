/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 114 · FINDING 1 (ALL_OPEN_WAVES item 8) — "$0 SOFT-CIRCLED" FOREVER, AND A
 * ROUND THAT COULD NEVER CONCLUDE ON ITS OWN.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, MEASURED RATHER THAN ASSERTED. `rounds.raised_amount` is
 * declared `REAL NOT NULL DEFAULT 0`, is read in eleven places, and is written by
 * NOTHING in the product. The first test in this file proves that by scanning the
 * tree, so the claim is re-verified on every run and cannot rot.
 *
 * Consequence 1: every real round printed `$0 soft-circled` however much had been
 * committed. A printed `$0` that means "unknown" is a false statement about money
 * (owner ruling R6).
 * Consequence 2: `sweepClosedRounds` compared that permanent zero against the
 * target, so `targetMet` could never become true.
 *
 * HOW THESE TESTS FAIL ON THE OLD CODE. Each behavioural test computes the OLD
 * answer first — `raisedAmount` as the round carried it, and the old ratio
 * `raisedAmount / targetAmount` — asserts that the old answer is wrong for the
 * very same rows, and then asserts the new derivation. So "fails before, passes
 * after" is visible inside the test body rather than asserted in prose: the
 * `expect(OLD).toBe(0)` lines ARE the before-state, and they run against real
 * fixture rows that hold hundreds of thousands of dollars.
 *
 * WHAT IS NOT TOUCHED. `computeConversionProjections` is not imported. No sacred
 * file is edited (`server/lib/roundCloseCascade.ts` was proven non-sacred before
 * being changed; `npm run sacred` stays 48/48). NAV returning "no holdings" and a
 * tax form refusing on an unfunded commitment are CORRECT and this file agrees
 * with both by construction: an unfunded commitment never lands in `funded`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  aggregateRoundMoneyOnRecord,
  roundMoneyOnRecord,
  roundProgressBasisPoints,
  fundedMeetsTarget,
  ROUND_MONEY_STATE_LABEL,
  type RoundMoneyRowInput,
} from "../lib/roundRaisedTotals";
import {
  readRoundMoneyOnRecord,
  progressBarPercent,
  ROUND_MONEY_UNAVAILABLE_STATEMENT,
} from "../../shared/roundMoneyOnRecordView";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* ─────────────────────────────────────────────────────────── the fixture book */

const ROUND_ID = "rnd_w114";

/** A real-shaped soft-circle book: one non-binding intent, one signed commitment
 *  with no cash, one wire recorded, one declined. Amounts in minor units exactly
 *  as `createSoftCircle` writes them. */
function book(): RoundMoneyRowInput[] {
  return [
    { id: "sc1", roundId: ROUND_ID, status: "intent", amountMinor: 5_000_000, currency: "USD" },      // $50,000
    { id: "sc2", roundId: ROUND_ID, status: "confirmed", amountMinor: 15_000_000, currency: "USD" },  // $150,000
    { id: "sc3", roundId: ROUND_ID, status: "wired", amountMinor: 30_000_000, currency: "USD" },      // $300,000
    { id: "sc4", roundId: ROUND_ID, status: "declined", amountMinor: 99_900_000, currency: "USD" },   // excluded
  ];
}

/** How the founder screens computed the headline figure BEFORE this wave. */
const OLD_RAISED_AMOUNT = 0; // what `rounds.raised_amount` holds on every real round
const oldPct = (raisedAmount: number, targetAmount: number) =>
  targetAmount > 0 ? (raisedAmount / targetAmount) * 100 : 0;

/* ───────────────────────────────────────────────── 1 · the defect, re-measured */

describe("W114 · FINDING 1 — the defect itself, re-measured on every run", () => {
  it("W114-F1-a — `raised_amount` has NO WRITER in the product, so the old figure is structurally zero", () => {
    /* Every mention of the column/field in server code, minus the ones that are
       provably not writes. If a writer is ever added this test must be revisited
       deliberately — which is the point of pinning it. */
    const files = [
      "server/roundsStore.ts",
      "server/lib/roundCloseCascade.ts",
      "server/routes.ts",
    ];
    for (const f of files) {
      const src = read(f);
      /* No UPDATE of the column anywhere. `createRound` initialises it to 0 (that
         is the default, not a total), and `UPDATE_WHITELIST` maps the key so an
         admin patch could reach it — neither is a product write path that reflects
         a commitment. */
      /* No SQL that writes the column. */
      expect(src).not.toMatch(/UPDATE\s+rounds[^;]*raised_amount\s*=/is);
      expect(src).not.toMatch(/set\(\{[^}]*raisedAmount/s);
      /* The only assignments to the field are the literal `0` initialiser in
         `createRound` and the projection read in `rowToRound`. */
      const assigns = (src.match(/raisedAmount:\s*[^,\n]+/g) ?? []).filter(
        (a) => !/raisedAmount:\s*(0|number|"raisedAmount")/.test(a),
      );
      for (const a of assigns) {
        expect(a).toMatch(/row\.raised_amount|round\?\.raisedAmount/);
      }
    }
    /* And the schema really does make unknown indistinguishable from zero. */
    expect(read("server/db/connection.ts")).toMatch(/raised_amount[^,)]*NOT NULL DEFAULT 0/);
  });

  it("W114-F1-b — the OLD figure and the OLD percentage are both wrong for this book: $0 and 0%", () => {
    /* THE BEFORE-STATE, executed. These four rows carry $500,000 of real money
       and $450,000 that is committed or funded, against a $600,000 target. */
    expect(OLD_RAISED_AMOUNT).toBe(0);
    expect(oldPct(OLD_RAISED_AMOUNT, 600_000)).toBe(0);

    const money = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: book() });
    expect(money.determined).toBe(true);
    /* THE AFTER-STATE. Off zero, from the same rows. */
    expect(money.onBookMinor).toBe("50000000");        // $500,000 on the book
    expect(money.subscribedMinor).toBe("45000000");    // $450,000 committed + funded
    expect(BigInt(money.subscribedMinor) > BigInt(0)).toBe(true);
  });
});

/* ──────────────────────────────────── 2 · three states, counted and LABELLED */

describe("W114 · FINDING 1 — soft-circled, committed and funded are distinct and named", () => {
  it("W114-F1-c — each state holds only its own rows, and nothing is double-counted", () => {
    const m = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: book() });
    expect(m.buckets.softCircled.minor).toBe("5000000");   // intent only
    expect(m.buckets.committed.minor).toBe("15000000");    // confirmed only
    expect(m.buckets.funded.minor).toBe("30000000");       // wired only
    /* Mutually exclusive: the three add up to the book exactly. */
    const sum =
      BigInt(m.buckets.softCircled.minor) + BigInt(m.buckets.committed.minor) + BigInt(m.buckets.funded.minor);
    expect(sum.toString()).toBe(m.onBookMinor);
    /* The declined row is excluded AND counted, never quietly folded in. */
    expect(m.declinedRows).toBe(1);
  });

  it("W114-F1-d — every figure travels with the words that say what it counts", () => {
    const m = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: book() });
    expect(m.buckets.softCircled.label).toBe("Soft-circled (non-binding)");
    expect(m.buckets.committed.label).toBe("Committed (signed, cash not received)");
    expect(m.buckets.funded.label).toBe("Funded (cash recorded)");
    /* The client reads the SAME declaration — one vocabulary, not two. */
    expect(ROUND_MONEY_STATE_LABEL.funded).toBe(m.buckets.funded.label);
    /* And no label pretends a soft circle is money in the bank. */
    expect(m.buckets.softCircled.label.toLowerCase()).toContain("non-binding");
    expect(m.buckets.committed.label.toLowerCase()).toContain("cash not received");
  });

  it("W114-F1-e — an UNFUNDED COMMITMENT IS NOT FUNDED, so NAV's 'no holdings' stays correct", () => {
    const m = aggregateRoundMoneyOnRecord({
      roundId: ROUND_ID,
      rows: [{ id: "s", roundId: ROUND_ID, status: "confirmed", amountMinor: 25_000_000, currency: "USD" }],
    });
    expect(m.buckets.committed.minor).toBe("25000000");
    expect(m.buckets.funded.minor).toBe("0");
    expect(m.buckets.funded.count).toBe(0);
    /* Which is exactly why a tax form may refuse on it: no cash was recorded. */
    expect(fundedMeetsTarget(m, 100_000)).toBe(false);
  });
});

/* ───────────────────────────────────────── 3 · it refuses instead of guessing */

describe("W114 · FINDING 1 — a screen that admits it does not know beats a confident $0", () => {
  it("W114-F1-f — NO ROWS produces a refusal and a sentence, never a zero to print", () => {
    const m = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: [] });
    expect(m.determined).toBe(false);
    expect(m.refusal).toBe("no_rows_on_record");
    expect(m.statement.length).toBeGreaterThan(20);
    /* The sentence may EXPLAIN that it refuses to print $0 - what it must never
       do is present a figure. No digit sits where a total would. */
    expect(m.statement).toMatch(/not the same as zero/i);
    expect(m.statement).not.toMatch(/[$][\s]?[\d]/);
    /* The client's one reader refuses to print figures for it. */
    const view = readRoundMoneyOnRecord(m);
    expect(view.canPrintFigures).toBe(false);
    expect(view.buckets).toEqual([]);
    expect(view.statement).toBe(m.statement);
  });

  it("W114-F1-g — a MIXED-CURRENCY book refuses rather than adding unlike money", () => {
    const m = aggregateRoundMoneyOnRecord({
      roundId: ROUND_ID,
      rows: [
        { id: "a", roundId: ROUND_ID, status: "confirmed", amountMinor: 10_000_00, currency: "USD" },
        { id: "b", roundId: ROUND_ID, status: "confirmed", amountMinor: 10_000_00, currency: "EUR" },
      ],
    });
    expect(m.determined).toBe(false);
    expect(m.refusal).toBe("mixed_currency");
    expect(m.currenciesSeen.sort()).toEqual(["EUR", "USD"]);
    expect(readRoundMoneyOnRecord(m).canPrintFigures).toBe(false);
  });

  it("W114-F1-h — NO PROJECTION AT ALL still yields a sentence, not $0", () => {
    for (const absent of [undefined, null, "", 0, "not-a-projection"]) {
      const view = readRoundMoneyOnRecord(absent);
      expect(view.canPrintFigures).toBe(false);
      expect(view.reason).toBe("absent");
      expect(view.statement).toBe(ROUND_MONEY_UNAVAILABLE_STATEMENT);
      expect(view.statement.toLowerCase()).toContain("not recorded");
    }
  });

  it("W114-F1-i — a legacy seed row with no `amount_minor` and no currency is converted and COUNTED as legacy", () => {
    /* `server/mockData.ts` seed rows carry only `amount`. They must still total,
       and the fallback must be visible rather than assumed. */
    const m = aggregateRoundMoneyOnRecord({
      roundId: ROUND_ID,
      rows: [{ id: "seed", roundId: ROUND_ID, status: "intent", amount: 75_000 }],
      fallbackCurrency: "USD",
    });
    expect(m.determined).toBe(true);
    expect(m.buckets.softCircled.minor).toBe("7500000");
    expect(m.legacyMajorUnitRows).toBe(1);
  });
});

/* ─────────────────────────────────────────── 4 · progress, in basis points */

describe("W114 · FINDING 1 — the progress ratio is computed once, on the server", () => {
  it("W114-F1-j — subscribed progress replaces the permanently-0% old ratio", () => {
    const m = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: book() });
    const p = roundProgressBasisPoints(m, 600_000);
    expect(p.targetDetermined).toBe(true);
    expect(p.subscribed).toBe(7500);                    // $450k / $600k = 75.00%
    expect(progressBarPercent(p.subscribed)).toBe(75);
    /* The old ratio, on the same round. */
    expect(oldPct(OLD_RAISED_AMOUNT, 600_000)).toBe(0);
  });

  it("W114-F1-k — NO TARGET means no bar, not a 0% bar", () => {
    const m = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: book() });
    for (const bad of [0, -1, null, undefined, "600000"]) {
      const p = roundProgressBasisPoints(m, bad);
      expect(p.targetDetermined).toBe(false);
      expect(p.subscribed).toBeNull();
      expect(progressBarPercent(p.subscribed)).toBeNull();
      expect(p.targetNote).toMatch(/No progress shown/);
    }
  });

  it("W114-F1-l — a refused book yields no ratio either", () => {
    const m = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: [] });
    const p = roundProgressBasisPoints(m, 600_000);
    expect(p.targetDetermined).toBe(false);
    expect(p.funded).toBeNull();
  });

  it("W114-F1-m — the wrapper attaches the ratio only when a target is supplied", () => {
    const withTarget = roundMoneyOnRecord({ roundId: ROUND_ID, rows: book(), targetAmount: 600_000 });
    expect(withTarget.progressBp?.subscribed).toBe(7500);
    const without = roundMoneyOnRecord({ roundId: ROUND_ID, rows: book() });
    expect(without.progressBp).toBeNull();
  });
});

/* ──────────────────────────── 5 · a round can now conclude on its own again */

describe("W114 · FINDING 1 — a fully funded round can reach `targetMet`", () => {
  it("W114-F1-n — funded >= target is TRUE from the rows, where the old comparison was always false", () => {
    const funded = aggregateRoundMoneyOnRecord({
      roundId: ROUND_ID,
      rows: [{ id: "f", roundId: ROUND_ID, status: "wired", amountMinor: 60_000_000, currency: "USD" }],
    });
    /* OLD: `raisedAmount >= targetAmount` with raisedAmount structurally 0. */
    expect(OLD_RAISED_AMOUNT >= 600_000).toBe(false);
    /* NEW: derived from the row that recorded the wire. */
    expect(fundedMeetsTarget(funded, 600_000)).toBe(true);
  });

  it("W114-F1-o — an UNDETERMINED total is not evidence a target was met", () => {
    const none = aggregateRoundMoneyOnRecord({ roundId: ROUND_ID, rows: [] });
    expect(fundedMeetsTarget(none, 600_000)).toBeNull(); // null, never `true`
  });

  it("W114-F1-p · REVERSED BY R93 — the UNATTENDED sweeper must NOT close a round on the derived total", () => {
    /* THIS ASSERTION IS THE INVERSE OF WHAT WAVE 114 WROTE, and deliberately so.

       Wave 114 OR-ed `fundedMeetsTarget(money, target)` into the sweeper's
       `targetMet`. The preflight's `check-formula-bytes` gate caught it as an
       ADDED formula in a sacred-math-tracked file, and on review the lead
       developer withdrew it in ruling R93.

       WHY. `sweepClosedRounds` is an unattended periodic job. When it decides
       `targetMet` it closes the round as `system:round_sweeper`, LAPSES every
       outstanding offer on it, and notifies investors. Because
       `rounds.raised_amount` is never written, `storedTargetMet` could never fire
       in production — so the change did not improve a working path, it ACTIVATED A
       DORMANT ONE, handing a background job a new power over live fundraises.

       And hitting target is not a reason to close: founders routinely keep a
       funded round open to oversubscribe, to extend, or to hold allocation. The
       derivation itself is correct and is still used by every honest money tile —
       only the automatic ACTION was withdrawn. Concluding a fully funded round
       remains a real need, and belongs on a HUMAN-triggered path. */
    const src = read("server/lib/roundCloseCascade.ts");
    /* The sweeper's decision is the stored comparison alone, as it has been in
       every shipped version. */
    expect(src).toMatch(/const targetMet = storedTargetMet;/);
    expect(src).not.toMatch(/storedTargetMet\s*\|\|\s*derivedTargetMet/);
    /* And the predicate is not even in scope here, so it cannot be re-OR-ed by
       accident — a future wave would have to add the import back deliberately. */
    /* Strip BLOCK comments wholesale, not line-by-line. A line-based filter is
       not enough here: the ruling above is a long `/* ... *\/` block whose
       continuation lines do not begin with `*`, and it names `fundedMeetsTarget`
       in prose. Stripping by line would make this assertion fail on its own
       explanation — which is exactly what happened on the first attempt. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("fundedMeetsTarget");
    /* WAVE 121 · FINDING 3 — THIS ASSERTION USED TO BE `expect(code).toContain(
       "roundMoneyOnRecord")`, and it was FALSE ASSURANCE. It passed on the IMPORT
       SPECIFIER: after R93 withdrew the automatic close there were ZERO call sites
       for `roundMoneyOnRecord` in this file, while two unbounded cross-tenant
       reads (`allCircles` over `soft_circles`, `allLedger` over
       `captable_commits`) still ran on every tick of the unattended sweeper and
       were discarded. A test that passes on dead code guards nothing — so the
       dead work was removed (option (b); reasoning in
       build_log/wave121/W121_PREFLIGHT.md §3) and this test now asserts the
       BEHAVIOUR: the sweeper carries no observation it does not use.

       The reconciliation itself is NOT gone from the product. It lives in
       `server/lib/roundRaisedTotals.ts`, which is untouched, is exercised by the
       aggregation tests in this very file, and is what the round's own money
       surfaces read. What is gone is a copy of it that nobody read. */
    expect(code).not.toContain("roundMoneyOnRecord");
    expect(code).not.toContain("allCircles");
    expect(code).not.toContain("allLedger");
    /* And no whole-table scan of either money table survives in this file. */
    expect(code).not.toContain("softCirclesTable");
    expect(code).not.toContain("captableCommitsTable");
    /* The observation's real home is still there and still exported. */
    expect(read("server/lib/roundRaisedTotals.ts")).toContain("export function roundMoneyOnRecord");
  });
});

/* ───────────────────────────────── 6 · the ledger cross-check exposes drift */

describe("W114 · FINDING 1 — the second copy is used to EXPOSE disagreement, never to hide it", () => {
  it("W114-F1-q — a ledger that disagrees with the book is reported, not silently preferred", () => {
    const m = aggregateRoundMoneyOnRecord({
      roundId: ROUND_ID,
      rows: [{ id: "w", roundId: ROUND_ID, status: "wired", amountMinor: 30_000_000, currency: "USD" }],
      ledger: [{ roundId: ROUND_ID, amount: "100000.00", currency: "USD", state: "committed" }],
    });
    expect(m.ledgerFunded.available).toBe(true);
    expect(m.ledgerFunded.agreesWithBook).toBe(false);
    expect(m.ledgerFunded.note.length).toBeGreaterThan(20);
    /* The book's own figure is unchanged by the disagreement. */
    expect(m.buckets.funded.minor).toBe("30000000");
  });

  it("W114-F1-r — no money is parsed with Number()/parseFloat anywhere in the derivation", () => {
    const src = read("server/lib/roundRaisedTotals.ts");
    /* Exactly ONE `Number(` survives in the file and it is the basis-point RATIO
       (an integer 0..10000), not a money amount. Display renders the bigint's own
       digits, so no total is ever converted to a double. */
    const codeLines = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l));
    const numberCalls = codeLines.filter((l) => /[^A-Za-z_.`]Number\(/.test(l));
    expect(numberCalls.length).toBe(1);
    expect(src).toMatch(/return Number\(\(m \* BigInt\(10000\)\) \/ targetMinor\)/);
    expect(codeLines.join("\n")).not.toContain("parseFloat");
    expect(codeLines.join("\n")).not.toContain("parseInt");
  });
});
