/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 116 — AFTER. ONE MONEY TRUTH PER TILE, AND NO INVENTED DENOMINATORS.
 * ══════════════════════════════════════════════════════════════════════════════
 * The companion to `w116_before_probe.test.ts`: same fixtures, same acceptance
 * criteria, asserted the other way round. Each `describe` below names the AC it
 * closes so the two files read as a pair.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO. It does not re-derive a single figure.
 * Every money number it checks comes out of Wave 114's `roundMoneyOnRecord`
 * projection via Wave 116's company-level reader, and every ownership figure
 * comes from `computeCommittedOwnership`. A test that computed its own expected
 * total would be a tenth derivation and would pass while production was wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "./w116_strip_comments";

/** Executable text only. This wave's block comments quote the very expressions the
 *  locks forbid, so the stripper has to be real; see `w116_strip_comments.ts`. */
function codeOf(file: string): string {
  return stripComments(readFileSync(file, "utf8"));
}
import {
  readCompanyMoneyOnRecord,
  readCompanyTargetOnRecord,
  roundCountsTowardCompanyMoney,
  chartMajorFromMinor,
  displayCompanyMinor,
  COMPANY_MONEY_REFUSAL_STATEMENT,
  COMPANY_TARGET_REFUSAL_STATEMENT,
  COMPANY_MONEY_BASIS_LABEL,
  COMPANY_MONEY_SUBSCRIBED_LABEL,
  COMPANY_TARGET_BASIS_LABEL,
} from "../../client/src/lib/money/companyMoneyOnRecord";
import {
  ROUND_MONEY_STATE_LABEL,
  ROUND_MONEY_STATE_ORDER,
} from "../../shared/roundMoneyOnRecordView";
import { roundMoneyOnRecord } from "../lib/roundRaisedTotals";
import {
  computeCommittedOwnership,
  computeOwnershipPct,
  COMMITTED_LEDGER_BASIS,
  COMMITTED_LEDGER_BASIS_LABEL,
  COMMITTED_LEDGER_BASIS_SENTENCE,
} from "../lib/captableDisplayResolver";

/* ── fixtures: a real book, built through Wave 114's projection ─────────────── */

/** $250,000 committed and $400,000 funded on the round's book, plus $50,000 still
 *  only soft-circled. `raised_amount` stays `0`, as it is in production. */
function realBookRound(id: string, targetAmount: number, currency = "USD") {
  /* The soft-circle status vocabulary is Wave 114's, read from
     `server/lib/roundRaisedTotals.ts::STATUS_TO_BUCKET`: `intent` is
     soft-circled, `confirmed` is committed, `wired`/`committed` are funded.
     R91 — this is NOT the round-STATE ladder and is not harmonised with it. */
  const rows = [
    { id: `${id}-sc`, roundId: id, status: "intent", amount: "50000.00", amountMinor: null, currency, deletedAt: null },
    { id: `${id}-c`, roundId: id, status: "confirmed", amount: "250000.00", amountMinor: null, currency, deletedAt: null },
    { id: `${id}-f`, roundId: id, status: "wired", amount: "400000.00", amountMinor: null, currency, deletedAt: null },
  ];
  const money = roundMoneyOnRecord({ roundId: id, rows, fallbackCurrency: currency, targetAmount });
  return {
    id,
    state: "soft_circle_open",
    archivedAt: null,
    targetAmount,
    currency,
    raisedAmount: 0,
    moneyOnRecord: money,
  };
}

function emptyRound(id: string, targetAmount: number, currency = "USD") {
  const money = roundMoneyOnRecord({ roundId: id, rows: [], fallbackCurrency: currency, targetAmount });
  return { id, state: "soft_circle_open", archivedAt: null, targetAmount, currency, raisedAmount: 0, moneyOnRecord: money };
}

/* ── AC-1 / AC-3: a real book shows a NON-ZERO figure, in three named states ── */

describe("W116 AFTER · AC-1 + AC-3 — a company with a real book shows a non-zero figure, by state", () => {
  const company = readCompanyMoneyOnRecord([realBookRound("r1", 1_000_000)]);

  it("is determined, and the figure is not zero", () => {
    expect(company.determined).toBe(true);
    expect(company.refusal).toBeNull();
    expect(company.subscribedMinor).toBe("65000000");
    expect(company.subscribedDisplay).not.toMatch(/^\$0(\.00)?$/);
    expect(company.subscribedDisplay).toBe(displayCompanyMinor(65_000_000n, "USD"));
  });

  it("distinguishes and labels soft-circled, committed and funded separately", () => {
    const byKey = new Map(company.buckets.map((b) => [b.key, b]));
    expect([...byKey.keys()].sort()).toEqual(["committed", "funded", "softCircled"]);
    expect(byKey.get("softCircled")!.minor).toBe("5000000");
    expect(byKey.get("committed")!.minor).toBe("25000000");
    expect(byKey.get("funded")!.minor).toBe("40000000");
    /* Three DISTINCT labels — the words are Wave 114's, not new ones. */
    const labels = company.buckets.map((b) => b.label);
    expect(new Set(labels).size).toBe(3);
    for (const key of ROUND_MONEY_STATE_ORDER) {
      expect(labels).toContain(ROUND_MONEY_STATE_LABEL[key]);
    }
  });

  it("the headline is committed + funded only — a soft circle is not money raised", () => {
    /* $250,000 + $400,000 = $650,000. The $50,000 soft circle is shown, and is
       NOT inside the headline. */
    expect(company.subscribedMinor).toBe(String(25_000_000n + 40_000_000n));
    expect(COMPANY_MONEY_SUBSCRIBED_LABEL).toMatch(/committed \+ funded/i);
  });

  it("names its own basis, and the basis is not a calendar period", () => {
    /* The tile the owner screenshotted said "RAISED THIS YEAR", which nothing in
       the data supports: no round row carries a period. */
    expect(COMPANY_MONEY_BASIS_LABEL).toMatch(/all time/i);
    expect(COMPANY_MONEY_BASIS_LABEL).toMatch(/not a calendar period/i);
  });

  it("sums across several rounds without ever touching the dead column", () => {
    const many = readCompanyMoneyOnRecord([
      realBookRound("r1", 1_000_000),
      realBookRound("r2", 2_000_000),
    ]);
    expect(many.determined).toBe(true);
    expect(many.subscribedMinor).toBe("130000000");
    expect(many.roundsCounted).toBe(2);
  });
});

/* ── AC-2: nothing on record → a SENTENCE, never $0 ─────────────────────────── */

describe("W116 AFTER · AC-2 — nothing on record prints a sentence and no figure", () => {
  it("refuses with no_rounds_on_record when the company has no countable round", () => {
    const none = readCompanyMoneyOnRecord([]);
    expect(none.determined).toBe(false);
    expect(none.refusal).toBe("no_rounds_on_record");
    expect(none.subscribedDisplay).toBe("");
    expect(none.statement).toBe(COMPANY_MONEY_REFUSAL_STATEMENT.no_rounds_on_record);
    /* The statement is a sentence about the absence, and contains no figure. */
    expect(none.statement).not.toMatch(/\$/);
    expect(none.statement.length).toBeGreaterThan(20);
  });

  it("an EMPTY book is a different statement from an UNREADABLE one", () => {
    const empty = readCompanyMoneyOnRecord([emptyRound("r1", 1_000_000)]);
    expect(empty.determined).toBe(false);
    expect(empty.refusal).toBe("not_determined_on_some_rounds");
    expect(empty.subscribedDisplay).toBe("");
    expect(empty.statement).not.toBe(COMPANY_MONEY_REFUSAL_STATEMENT.no_rounds_on_record);
  });

  it("refuses rather than adding two currencies together", () => {
    const mixed = readCompanyMoneyOnRecord([
      realBookRound("r1", 1_000_000, "USD"),
      realBookRound("r2", 1_000_000, "EUR"),
    ]);
    expect(mixed.determined).toBe(false);
    expect(mixed.refusal).toBe("mixed_currency");
    expect(mixed.subscribedDisplay).toBe("");
    expect(mixed.statement).toBe(COMPANY_MONEY_REFUSAL_STATEMENT.mixed_currency);
  });

  it("never returns a printable zero for an undetermined company", () => {
    for (const c of [
      readCompanyMoneyOnRecord([]),
      readCompanyMoneyOnRecord([emptyRound("r1", 1_000)]),
      readCompanyMoneyOnRecord([realBookRound("a", 1, "USD"), realBookRound("b", 1, "JPY")]),
    ]) {
      expect(c.subscribedDisplay).toBe("");
      expect(c.statement).not.toMatch(/\$\s?0/);
    }
  });
});

/* ── AC-4: what the $53.7M sums, and what it now sums ──────────────────────── */

describe("W116 AFTER · AC-4 — the target denominator excludes drafts and archived rounds", () => {
  const rounds = [
    { id: "r1", state: "closed", targetAmount: 1_000_000, currency: "USD", archivedAt: null },
    { id: "r2", state: "draft", targetAmount: 40_000_000, currency: "USD", archivedAt: null },
    { id: "r3", state: "soft_circle_open", targetAmount: 2_700_000, currency: "USD", archivedAt: null },
    { id: "r4", state: "closed", targetAmount: 10_000_000, currency: "USD", archivedAt: "2025-01-01" },
  ];

  it("a draft round and an archived round do not count", () => {
    expect(roundCountsTowardCompanyMoney(rounds[0]).counts).toBe(true);
    expect(roundCountsTowardCompanyMoney(rounds[1]).counts).toBe(false);
    expect(roundCountsTowardCompanyMoney(rounds[2]).counts).toBe(true);
    expect(roundCountsTowardCompanyMoney(rounds[3]).counts).toBe(false);
    /* And each exclusion says WHY, so the tile can explain the denominator. */
    expect(roundCountsTowardCompanyMoney(rounds[1]).reason).toMatch(/draft/i);
    expect(roundCountsTowardCompanyMoney(rounds[3]).reason).toMatch(/archiv/i);
  });

  it("the target is $3.7M, not $53.7M", () => {
    const target = readCompanyTargetOnRecord(rounds);
    expect(target.determined).toBe(true);
    expect(target.minor).toBe("370000000");
    expect(target.roundsCounted).toBe(2);
    expect(target.display).toBe(displayCompanyMinor(370_000_000n, "USD"));
    expect(target.display).not.toMatch(/53,7|58,7/);
  });

  it("the target names which rounds it sums", () => {
    expect(COMPANY_TARGET_BASIS_LABEL).toMatch(/drafts and archived rounds excluded/i);
  });

  it("a company with no target recorded gets a sentence, not $0", () => {
    const target = readCompanyTargetOnRecord([{ id: "r", state: "closed", targetAmount: null, currency: "USD", archivedAt: null }]);
    expect(target.determined).toBe(false);
    expect(target.display).toBe("");
    expect(target.statement).toBe(COMPANY_TARGET_REFUSAL_STATEMENT.no_target_recorded);
  });

  it("two target currencies refuse rather than add", () => {
    const target = readCompanyTargetOnRecord([
      { id: "a", state: "closed", targetAmount: 1_000_000, currency: "USD", archivedAt: null },
      { id: "b", state: "closed", targetAmount: 1_000_000, currency: "EUR", archivedAt: null },
    ]);
    expect(target.determined).toBe(false);
    expect(target.statement).toBe(COMPANY_TARGET_REFUSAL_STATEMENT.mixed_currency);
  });
});

/* ── AC-5: the admin KPI no longer sums the dead column ────────────────────── */

describe("W116 AFTER · AC-5 — the admin funded KPI is derived, and refuses", () => {
  it("dbTotalFunded returns null (not 0) when nothing can be determined", async () => {
    const mod = await import("../lib/adminKpiDbReads");
    const funded = mod.dbFundedOnRecord();
    /* On whatever the test DB holds, the contract is the same: either a
       determined bigint total or an explicit refusal — never a bare 0 standing in
       for "unknown". */
    if (funded.determined) {
      expect(typeof funded.minor).toBe("bigint");
    } else {
      expect(funded.refusal).not.toBeNull();
      expect(mod.dbTotalFunded()).toBeNull();
    }
  });

  it("the module no longer reads rounds.raisedAmount at all", () => {
    /* Source lock: the dead column is gone from the EXECUTABLE lines. Mentions in
       comments are how the wave explains itself and are allowed. */
    expect(codeOf("server/lib/adminKpiDbReads.ts")).not.toMatch(/\braisedAmount\b/);
  });
});

/* ── AC-6 / AC-7: no percentage derives from a hardcoded share count ───────── */

describe("W116 AFTER · AC-6 + AC-7 — the invented denominators are gone from the tree", () => {
  const OWNED = [
    "client/src/components/CapitalizationJourney.tsx",
    "client/src/pages/founder/Dashboard.tsx",
    "client/src/pages/founder/Welcome.tsx",
    "client/src/lib/money/companyMoneyOnRecord.ts",
    "server/lib/adminKpiDbReads.ts",
    "server/lib/captableDisplayResolver.ts",
    "server/membershipStore.ts",
    "server/lib/pdfGenerators.ts",
  ];

  it("no executable line in any owned file contains a hardcoded 12,000,000 share count", () => {
    for (const f of OWNED) expect(codeOf(f), f).not.toMatch(/12_000_000|12000000/);
  });

  it("no executable line divides money by a literal 1.0 to invent a share price", () => {
    expect(codeOf("client/src/components/CapitalizationJourney.tsx")).not.toMatch(/\/\s*1\.0\b/);
  });

  it("the journey component refuses a snapshot containing an unconverted convertible", async () => {
    const { buildSnapshots, SNAPSHOT_DENOMINATOR_LABEL } =
      await import("../../client/src/components/CapitalizationJourney");
    const rounds = [{ id: "r1", companyId: "co", name: "Seed", closeDate: "2024-01-01", preMoney: 1, postMoney: 2, state: "closed" }] as never[];
    const securities = [
      { holderType: "founder", instrument: "common", shares: 1_000_000, issuedAt: "2023-01-01" },
      { holderType: "investor", instrument: "safe", shares: 0, investmentAmount: 100_000, cap: 8_000_000, issuedAt: "2023-06-01" },
    ] as never[];
    const built = buildSnapshots(rounds, securities, "co");
    expect(built.snapshots).toHaveLength(0);
    expect(built.refusals).toHaveLength(1);
    expect(built.refusals[0].unconvertedRows).toBe(1);
    /* It says so in words, and names no invented figure. */
    expect(built.refusals[0].statement).toMatch(/had not converted/i);
    expect(built.refusals[0].statement).not.toMatch(/12,000,000|150,000/);
    expect(built.denominatorLabel).toBe(SNAPSHOT_DENOMINATOR_LABEL);
  });

  it("a book with only recorded share counts still draws, and names its denominator", async () => {
    const { buildSnapshots } = await import("../../client/src/components/CapitalizationJourney");
    const rounds = [{ id: "r1", companyId: "co", name: "Seed", closeDate: "2024-01-01", preMoney: 1, postMoney: 2, state: "closed" }] as never[];
    const securities = [
      { holderType: "founder", instrument: "common", shares: 900_000, issuedAt: "2023-01-01" },
      { holderType: "pool", instrument: "option", shares: 100_000, issuedAt: "2023-01-01" },
    ] as never[];
    const built = buildSnapshots(rounds, securities, "co");
    expect(built.refusals).toHaveLength(0);
    expect(built.snapshots).toHaveLength(1);
    expect(built.snapshots[0].composition.founder).toBeCloseTo(90, 6);
    expect(built.denominatorLabel).toMatch(/recorded/i);
    expect(built.denominatorLabel).toMatch(/not fully diluted/i);
  });
});

/* ── AC-8 / AC-10: every remaining percentage names its denominator ────────── */

describe("W116 AFTER · AC-8 + AC-10 — the committed percentage cannot travel unnamed", () => {
  it("computeCommittedOwnership hands back the basis with the number", () => {
    const own = computeCommittedOwnership(250, 1000);
    expect(own.pct).toBe(25);
    expect(own.basis).toBe(COMMITTED_LEDGER_BASIS);
    expect(own.basisLabel).toBe(COMMITTED_LEDGER_BASIS_LABEL);
    expect(own.basisSentence).toBe(COMMITTED_LEDGER_BASIS_SENTENCE);
    expect(own.totalShares).toBe(1000);
  });

  it("it still refuses an undeterminable basis, and the basis name survives the refusal", () => {
    for (const [h, t] of [[0, 0], [100, 0], [0, 100], [Number.NaN, 100], [100, Number.POSITIVE_INFINITY]] as const) {
      const own = computeCommittedOwnership(h, t);
      expect(own.pct).toBeNull();
      expect(own.basisLabel).toBe(COMMITTED_LEDGER_BASIS_LABEL);
    }
  });

  it("the old entry point is preserved exactly, so no existing caller changed behaviour", () => {
    for (const [h, t] of [[250, 1000], [1, 3], [0, 0], [100, 0], [5, 5]] as const) {
      expect(computeOwnershipPct(h, t)).toBe(computeCommittedOwnership(h, t).pct);
    }
  });

  it("the basis sentence distinguishes itself from Basic, Fully Diluted and As Converted", () => {
    expect(COMMITTED_LEDGER_BASIS_SENTENCE).toMatch(/Basic/);
    expect(COMMITTED_LEDGER_BASIS_SENTENCE).toMatch(/Fully Diluted/);
    expect(COMMITTED_LEDGER_BASIS_SENTENCE).toMatch(/As Converted/);
    expect(COMMITTED_LEDGER_BASIS_SENTENCE).toMatch(/not comparable/i);
  });

  it("the PDF generator accepts the basis and prints it beside the percentages", () => {
    const src = readFileSync("server/lib/pdfGenerators.ts", "utf8");
    expect(src).toMatch(/ownershipBasisLabel\?: string;/);
    expect(src).toMatch(/ownershipBasisSentence\?: string;/);
    expect(src).toMatch(/is each holder's share of the \$\{data\.ownershipBasisLabel\}/);
  });

  it("the route hands the shared basis to both the API response and the PDF", () => {
    const src = readFileSync("server/routes.ts", "utf8");
    expect(src).toMatch(/ownershipBasisSentence: COMMITTED_LEDGER_BASIS_SENTENCE/);
    expect(src).toMatch(/ownershipBasisLabel: COMMITTED_LEDGER_BASIS_LABEL/);
    expect(src).toMatch(/computeCommittedOwnership\(v\.shares, totalSharesNum\)\.pct/);
    expect(src).toMatch(/computeCommittedOwnership\(r\.shares, totalCommittedShares\)/);
  });
});

/* ── AC-9: the membership sentinel is labelled, not fabricated ─────────────── */

describe("W116 AFTER · AC-9 — the membership ownership sentinel says it is unknown", () => {
  it("the ledger-derived position is flagged not-known with no basis", () => {
    const src = readFileSync("server/membershipStore.ts", "utf8");
    /* The sentinel cannot become `null` (the shape is declared in the SACRED
       `server/lib/userContext.ts:157`), so the honest fix is a flag beside it. */
    expect(src).toMatch(/ownershipPctKnown: false/);
    expect(src).toMatch(/ownershipBasis: null/);
    expect(src).toMatch(/SENTINEL, NOT A MEASUREMENT/);
  });

  it("demo-seeded positions are flagged known and name their basis", () => {
    const src = readFileSync("server/membershipStore.ts", "utf8");
    expect(src).toMatch(/ownershipPctKnown: true, ownershipBasis: "demo seed \(fraction of fully-diluted shares\)"/);
  });
});

/* ── the exact-money rules ─────────────────────────────────────────────────── */

describe("W116 AFTER · the source-lock stripper itself", () => {
  it("removes block, line and JSX comments but keeps string literals", () => {
    expect(stripComments("a /* raisedAmount */ b")).toBe("a  b");
    expect(stripComments("a // raisedAmount\nb")).toBe("a \nb");
    expect(stripComments("x{/* raisedAmount */}y")).toBe("x{}y");
    expect(stripComments('const s = "keep */ me";')).toContain("keep */ me");
  });

  it("does not let a */ inside a string swallow the code after it", () => {
    const src = 'const a = "*/"; const raisedAmount = 1; /* gone */ const b = 2;';
    const code = stripComments(src);
    expect(code).toMatch(/raisedAmount/);
    expect(code).not.toMatch(/gone/);
    expect(code).toMatch(/const b = 2;/);
  });
});

describe("W116 AFTER · money is exact decimal text and integers", () => {
  it("no owned file parses money with parseInt or parseFloat", () => {
    for (const f of [
      "client/src/lib/money/companyMoneyOnRecord.ts",
      "server/lib/adminKpiDbReads.ts",
    ]) {
      expect(codeOf(f), f).not.toMatch(/\bparseInt\s*\(/);
      expect(codeOf(f), f).not.toMatch(/\bparseFloat\s*\(/);
    }
  });

  it("the one bigint→number conversion refuses above MAX_SAFE_INTEGER", () => {
    expect(chartMajorFromMinor(BigInt(65_000_000), "USD")).toBe(650_000);
    expect(chartMajorFromMinor(BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), "USD")).toBeNull();
  });

  it("display is produced without arithmetic and is exponent-aware", () => {
    expect(displayCompanyMinor(65_000_000n, "USD")).toMatch(/650,000/);
    /* JPY has no minor unit: 650,000 minor is 650,000 major, not 6,500.00. */
    expect(displayCompanyMinor(650_000n, "JPY")).toMatch(/650,000/);
  });
});
