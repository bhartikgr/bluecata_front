/**
 * WAVE 52 — round & cap-table mathematics.
 *
 * Every test here fails if its fix is removed; the failing-without-the-fix proof
 * for each one is recorded in build_log/wave52/W52_NEW_TESTS.md.
 *
 * The canonical figures are NOT taken from this codebase. They are the worked
 * example published to the external reviewer, traceable to the YC post-money
 * safe primer and to Wilson Sonsini's price-per-share formula, and they are
 * asserted as literals here precisely so the code cannot drift into agreeing
 * with itself.
 */
import { describe, it, expect } from "vitest";
import {
  buildCapTablePreview,
  commonNotionalRaise,
  computePostMoney,
  dm,
  DENOM_LABELS,
  DENOM_LABEL_SHORT,
  DENOM_LABEL_TEXT,
  derivePricePerShare,
  deriveInvestorShares,
  describeResidual,
  discloseConversions,
  formatPct,
  fractionFromPct,
  parseShareCount,
  pctFromFraction,
  RESIDUAL_DISPOSITIONS,
} from "../roundMath";

/* Canonical starting position. */
const FOUNDERS = 8_000_000;
const GRANTED = 1_000_000;
const EXISTING_POOL = 1_000_000;
const SAFE_SHARES = 2_500_000;
const NEW_POOL = 2_500_000;
/** D = 8m + 1m + 1m + 2.5m + 2.5m. The wizard collects this as one figure. */
const FD_PRE_MONEY = FOUNDERS + GRANTED + EXISTING_POOL + SAFE_SHARES;

describe("W52 · item 5a — the Authorized-Shares fallback is gone", () => {
  it("W52 AC-5 POLE A refuses to price without a fully-diluted share count", () => {
    const r = derivePricePerShare({
      preMoneyValuation: "30000000",
      fdPreMoneyShares: "",
      /* The old code substituted THIS number and printed the result as a price. */
      poolTopUpShares: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("fd_pre_money_shares_missing");
    /* The refusal must be a sentence a founder can act on, and must NOT be $0. */
    expect(r.reason).toContain("Fully-diluted pre-money shares is blank");
    expect(r.reason).toContain("numerator, not a denominator");
  });

  it("W52 AC-5 the refusal copy does NOT cite authorized capital", () => {
    /* Strategy Review 1 STRUCK the DGCL §161 / NVCA §2.2 authorised-ceiling
       rationale: the platform never reads an authorized figure, so that
       reasoning would put a false sentence in front of a founder. */
    const r = derivePricePerShare({ preMoneyValuation: "30000000", fdPreMoneyShares: "" });
    if (r.ok) throw new Error("expected a refusal");
    const blob = (r.reason + r.code).toLowerCase();
    expect(blob).not.toContain("dgcl");
    expect(blob).not.toContain("nvca");
    expect(blob).not.toContain("§161");
    expect(blob).not.toContain("authorized capital");
    expect(blob).not.toContain("charter");
  });

  it("W52 AC-5 POLE B a Foundation round still prices, manually", () => {
    /* The one case the fallback legitimately served. A foundation round is the
       formation event: no prior valuation, no prior fully-diluted count. */
    const ok = derivePricePerShare({
      preMoneyValuation: "",
      fdPreMoneyShares: "",
      isFoundationRound: true,
      manualPricePerShare: "0.0001",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) throw new Error("unreachable");
    expect(ok.pricePerShare).toBe("0.0001");
    expect(ok.manual).toBe(true);

    const refused = derivePricePerShare({
      preMoneyValuation: "",
      fdPreMoneyShares: "",
      isFoundationRound: true,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused.code).toBe("foundation_requires_manual_pps");
  });

  it("W52 an unknown pre-money refuses, and a genuine zero is not an unknown", () => {
    const unknown = derivePricePerShare({ preMoneyValuation: "", fdPreMoneyShares: "10000000" });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("unreachable");
    expect(unknown.code).toBe("pre_money_missing");
    expect(unknown.reason).toContain("not $0");

    /* A genuine zero committed amount still produces a real answer: zero shares,
       zero residual — not a refusal. Blank and zero are different facts. */
    const zeroCheque = deriveInvestorShares("0", "2");
    expect(zeroCheque.ok).toBe(true);
    if (!zeroCheque.ok) throw new Error("unreachable");
    expect(zeroCheque.shares.toString()).toBe("0");
    expect(zeroCheque.residual).toBe("0");
  });
});

describe("W52 · AC-1 — the canonical example, reproduced independently", () => {
  it("W52 AC-1 price per share is exactly $2.00 on the canonical denominator", () => {
    const r = derivePricePerShare({
      preMoneyValuation: "30000000",
      fdPreMoneyShares: String(FD_PRE_MONEY),
      poolTopUpShares: String(NEW_POOL),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.denominator.shares.toString()).toBe("15000000");
    expect(r.pricePerShare).toBe("2");
    expect(r.denominator.label).toBe("FD_PRE_INCL_POOL");
  });

  it("W52 AC-1 POLE B the new-issuance count as denominator gives a WRONG price", () => {
    /* The substituted-denominator pole. The round issues 5,000,000 new shares;
       using that as the denominator gives $6.00 instead of $2.00 — a 3× overprice.
       The point of the pole is that the code path can no longer produce it. */
    const wrong = derivePricePerShare({
      preMoneyValuation: "30000000",
      fdPreMoneyShares: "5000000",
    });
    if (!wrong.ok) throw new Error("unreachable");
    expect(wrong.pricePerShare).toBe("6");
    expect(wrong.pricePerShare).not.toBe("2");

    /* And the real path cannot be driven there by leaving the field blank. */
    const blank = derivePricePerShare({ preMoneyValuation: "30000000", fdPreMoneyShares: "" });
    expect(blank.ok).toBe(false);
  });

  it("W52 AC-1 the effective, pool-adjusted pre-money is $25,000,000", () => {
    const r = derivePricePerShare({
      preMoneyValuation: "30000000",
      fdPreMoneyShares: String(FD_PRE_MONEY),
      poolTopUpShares: String(NEW_POOL),
    });
    if (!r.ok) throw new Error("unreachable");
    /* $30,000,000 − 2,500,000 × $2.00. The founders alone pay for the pool, so
       this, not the headline pre-money, is what they are being paid. */
    expect(r.effectivePreMoney).toBe("25000000");
  });

  it("W52 AC-1 a pool SHARE COUNT round-trips exactly: F/(1−π) == F + S", () => {
    /* Wave 50's invariant I-7, restated here as an exact identity rather than a
       float comparison. π = S/(F+S) is never computed as a percentage. */
    for (const [F, S] of [[10_000_000, 2_500_000], [7_777_777, 1], [1, 999_999]]) {
      const withPool = derivePricePerShare({
        preMoneyValuation: "1",
        fdPreMoneyShares: String(F),
        poolTopUpShares: String(S),
      });
      if (!withPool.ok) throw new Error("unreachable");
      expect(withPool.denominator.shares.toString()).toBe(String(F + S));
    }
  });

  it("W52 AC-1 N = floor(I/p) = 5,000,000 with a zero residual", () => {
    const d = deriveInvestorShares("10000000", "2");
    if (!d.ok) throw new Error("unreachable");
    expect(d.shares.toString()).toBe("5000000");
    expect(d.applied).toBe("10000000");
    expect(d.residual).toBe("0");
  });

  it("W52 AC-1 T·p = $40,000,000 and equals PMV + I because r = 0", () => {
    const pricing = derivePricePerShare({
      preMoneyValuation: "30000000",
      fdPreMoneyShares: String(FD_PRE_MONEY),
      poolTopUpShares: String(NEW_POOL),
    });
    if (!pricing.ok) throw new Error("unreachable");
    const d = deriveInvestorShares("10000000", pricing.pricePerShare);
    if (!d.ok) throw new Error("unreachable");
    const pm = computePostMoney({
      denominator: pricing.denominator,
      pricePerShare: pricing.pricePerShare,
      derivations: [d],
      preMoneyValuation: "30000000",
    });
    if (!pm.ok) throw new Error("unreachable");
    expect(pm.postMoneyShares.toString()).toBe("20000000");
    expect(pm.postMoneyValuation).toBe("40000000");
    expect(pm.preMoneyPlusCommitted).toBe("40000000");
    expect(pm.figuresDiffer).toBe(false);
    expect(pm.residualTotal).toBe("0");
    expect(pm.reconciliation).toContain("agree exactly");
  });
});

describe("W52 · §11.4.1 — the withdrawn biconditional, and the residual", () => {
  it("W52 AC-6 POLE B T·p and PMV+I both render when a residual exists", () => {
    /* T·p = PMV + I is NOT an identity: it needs T − N = D AND r = 0. Here the
       cheque does not divide evenly, so the two figures differ by exactly r and
       BOTH must be shown, with the reason. */
    const pricing = derivePricePerShare({
      preMoneyValuation: "900000",
      fdPreMoneyShares: "300000",
      manualPricePerShare: "3",
    });
    if (!pricing.ok) throw new Error("unreachable");
    expect(pricing.pricePerShare).toBe("3");
    /* $1,000 at $3.00 buys 333 shares and leaves $1.00 unapplied. */
    const d = deriveInvestorShares("1000", pricing.pricePerShare);
    if (!d.ok) throw new Error("unreachable");
    expect(d.shares.toString()).toBe("333");
    expect(d.applied).toBe("999");
    expect(d.residual).toBe("1");
    expect(Number(d.residual)).toBeGreaterThan(0);
    expect(Number(d.residual)).toBeLessThan(Number(pricing.pricePerShare));

    const pm = computePostMoney({
      denominator: pricing.denominator,
      pricePerShare: pricing.pricePerShare,
      derivations: [d],
      preMoneyValuation: "900000",
    });
    if (!pm.ok) throw new Error("unreachable");
    /* T·p = 300,333 × $3 = $900,999 while PMV + I = $901,000 — they differ by
       exactly the $1.00 residual, which is why BOTH are rendered. */
    expect(pm.postMoneyValuation).toBe("900999");
    expect(pm.preMoneyPlusCommitted).toBe("901000");
    expect(pm.residualTotal).toBe("1");
    expect(pm.figuresDiffer).toBe(true);
    expect(pm.reconciliation).toContain("agree exactly");
  });

  it("W52 AC-6 the residual bound 0 ≤ r < p holds exactly, with no epsilon", () => {
    for (const [amount, price] of [
      ["1", "3"],
      ["999999", "7.7777"],
      ["1000000", "1.1144"],
      ["499998.97", "1.1144"],
    ]) {
      const d = deriveInvestorShares(amount, price);
      if (!d.ok) throw new Error("unreachable");
      expect(Number(d.residual)).toBeGreaterThanOrEqual(0);
      expect(Number(d.residual)).toBeLessThan(Number(price));
      /* I_applied + r == I_committed exactly (invariant I-5). */
      expect(Number(d.applied) + Number(d.residual)).toBeCloseTo(Number(amount), 8);
    }
  });

  it("W52 the residual disposition is an enumerated stored value with NO default", () => {
    expect(RESIDUAL_DISPOSITIONS).toEqual([
      "returned",
      "not_called",
      "credited_next_close",
      "waived",
      "subscription_receivable",
      "subscription_payable",
      "retained_by_agreement",
    ]);
    const d = deriveInvestorShares("1000", "3");
    if (!d.ok) throw new Error("unreachable");
    /* A non-zero residual with no recorded disposition is an INCOMPLETE round
       and the disclosure says so, rather than guessing what happened to the cash. */
    expect(describeResidual(d, null)).toContain("INCOMPLETE");
    expect(describeResidual(d, "returned")).toContain("refunded to the investor");
    expect(describeResidual(d, "returned")).not.toContain("INCOMPLETE");
  });

  it("W52 shares are FLOORED, never rounded — YC's own worked example", () => {
    /* YC's primer issues 4,486,719 shares for $5,000,000 at $1.1144, and a
       pro-rata holder takes 448,671 shares for $499,998.97. round() would give
       448,672 and fabricate a share. */
    const big = deriveInvestorShares("5000000", "1.1144");
    if (!big.ok) throw new Error("unreachable");
    expect(big.shares.toString()).toBe("4486719");
    const prorata = deriveInvestorShares("499998.97", "1.1144");
    if (!prorata.ok) throw new Error("unreachable");
    expect(prorata.shares.toString()).toBe("448671");
    expect(prorata.shares.toString()).not.toBe("448672");
  });
});

describe("W52 · AC-14 — the preview agrees with the ledger to the share", () => {
  it("W52 AC-14 both production derivation paths agree", () => {
    /* Path A: floor(Decimal(amount) / Decimal(pps)) — the reconcile() reference.
       Path B: floor(round(amount×1e6) / round(pps×1e6)) — the batch handler.
       The preview reproduces BOTH and asserts they agree. */
    for (const [a, p] of [
      ["10000000", "2"],
      ["5000000", "1.1144"],
      ["50000", "0.2"],
      ["123456.78", "3.141593"],
    ]) {
      const d = deriveInvestorShares(a, p);
      if (!d.ok) throw new Error("unreachable");
      expect(d.pathsAgree).toBe(true);
      expect(d.shares.toString()).toBe(d.sharesMicroPath.toString());
    }
  });

  it("W52 AC-14 POLE B the boundary case is one share away from round()", () => {
    /* An amount whose exact quotient is k + 0.999…: floor gives k, round gives
       k+1. The assertion is therefore known to be capable of failing. */
    const p = 3;
    const k = 1000;
    const amount = (k + 0.9999).toFixed(4);
    const d = deriveInvestorShares((Number(amount) * p).toFixed(4), String(p));
    if (!d.ok) throw new Error("unreachable");
    expect(d.shares.toString()).toBe(String(k));
    expect(Math.round(Number(amount))).toBe(k + 1);
    expect(d.shares.toString()).not.toBe(String(k + 1));
  });

  it("W52 the micro-scaled path truncates a price beyond 6 decimals — named, not hidden", () => {
    /* Where the two paths CAN disagree: the batch handler scales pps to 6
       decimal places. This test pins the boundary so it is a known property
       rather than a surprise in production. */
    const d = deriveInvestorShares("1000000", "1.00000049");
    if (!d.ok) throw new Error("unreachable");
    expect(d.shares.toString()).toBe("999999");
    /* round(1.00000049 × 1e6) = 1000000 → the micro path divides by exactly 1. */
    expect(d.sharesMicroPath.toString()).toBe("1000000");
    expect(d.pathsAgree).toBe(false);
  });
});

describe("W52 · AC-7 — every percentage carries its denominator", () => {
  it("W52 AC-7 the same founder is 40.000% / 48.485% / 51.613% under three labels", () => {
    /* The single most important line in the whole wave: identical facts, three
       different denominators, none of them wrong — and none of them publishable
       without saying which. */
    const T = 20_000_000n;
    const exPool = 16_500_000n;
    const outstanding = 15_500_000n;
    const shares = 8_000_000n;
    const mk = (den: bigint, label: (typeof DENOM_LABELS)[number]) =>
      /* Exact decimal division, never parseFloat. */
      pctFromFraction(dm(shares.toString()).div(dm(den.toString())), label, den);
    expect(mk(T, "FD_POST").value).toBe("40.000");
    expect(mk(exPool, "FD_POST_EX_POOL").value).toBe("48.485");
    expect(mk(outstanding, "OUTSTANDING").value).toBe("51.613");
  });

  it("W52 AC-7 a percentage cannot be formatted without its denominator label", () => {
    const p = pctFromFraction(fractionFromPct("40"), "FD_POST", 20_000_000n);
    expect(p.denominator).toBe("FD_POST");
    expect(p.denominatorShares).toBe("20000000");
    /* formatPct always emits the label; there is no code path that emits a bare
       number, because Pct has no constructor that omits the denominator. */
    expect(formatPct(p)).toBe("40.000% FD post-money");
    expect(formatPct(p)).toContain("FD post-money");
  });

  it("W52 R16 percent-as-written: 1 means 1%, and the boundary is explicit", () => {
    expect(fractionFromPct(1).toFixed()).toBe("0.01");
    expect(pctFromFraction(fractionFromPct(1), "FD_POST", 100n).value).toBe("1.000");
    /* A round trip must be exact. */
    expect(pctFromFraction(fractionFromPct("12.5"), "FD_POST", 8n).value).toBe("12.500");
  });

  it("W52 every denominator label has founder-facing text and a short badge", () => {
    for (const l of DENOM_LABELS) {
      expect(DENOM_LABEL_TEXT[l].length).toBeGreaterThan(20);
      expect(DENOM_LABEL_SHORT[l].length).toBeGreaterThan(3);
    }
    /* I-8: FD_POST and FD_POST_EX_POOL are distinct labels, not aliases. */
    expect(DENOM_LABEL_SHORT.FD_POST).not.toBe(DENOM_LABEL_SHORT.FD_POST_EX_POOL);
    expect(DENOM_LABEL_TEXT.FD_POST).not.toBe(DENOM_LABEL_TEXT.FD_POST_EX_POOL);
  });
});

describe("W52 · I-9 — fractional share counts are refused, not rounded", () => {
  it("W52 I-9 a fractional share-count input is rejected by name", () => {
    const r = parseShareCount("1.5", "Fully-diluted pre-money shares");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("Fully-diluted pre-money shares_fractional");
    expect(r.reason).toContain("whole number of shares");
    expect(r.reason).toContain("change the economics");
  });

  it("W52 I-9 a fractional FD figure cannot be smuggled into the price", () => {
    const r = derivePricePerShare({ preMoneyValuation: "30000000", fdPreMoneyShares: "15000000.5" });
    expect(r.ok).toBe(false);
  });

  it("W52 I-9 an integer share count is accepted, and blank is not zero", () => {
    const ok = parseShareCount("15000000", "FD");
    expect(ok.ok).toBe(true);
    const blank = parseShareCount("", "FD");
    expect(blank.ok).toBe(false);
    if (blank.ok) throw new Error("unreachable");
    expect(blank.code).toBe("FD_missing");
    const zero = parseShareCount("0", "FD");
    expect(zero.ok).toBe(true);
  });
});

describe("W52 · AC-17 — the conversion trigger fails closed", () => {
  it("W52 AC-17 converts_in_this_round changes the denominator by its exact count", () => {
    const d = discloseConversions([
      { id: "safe-1", kind: "safe_post", status: "converts_in_this_round", shares: 2_500_000n },
    ]);
    expect(d.includedShares.toString()).toBe("2500000");
    expect(d.priceIsProvisional).toBe(false);
  });

  it("W52 AC-17 does_not_convert leaves the denominator untouched", () => {
    const d = discloseConversions([
      { id: "safe-1", kind: "safe_post", status: "does_not_convert", shares: 2_500_000n },
    ]);
    expect(d.includedShares.toString()).toBe("0");
    expect(d.excluded).toHaveLength(1);
    expect(d.priceIsProvisional).toBe(false);
  });

  it("W52 AC-17 fail-closed: undetermined is EXCLUDED and the price is provisional", () => {
    const d = discloseConversions([
      { id: "safe-1", kind: "safe_post", status: "undetermined", shares: 2_500_000n },
    ]);
    /* Neither silently included nor silently dropped: excluded AND disclosed. */
    expect(d.includedShares.toString()).toBe("0");
    expect(d.priceIsProvisional).toBe(true);
    expect(d.provisionalReasons.join(" ")).toContain("UNRESOLVED conversion trigger");
    expect(d.provisionalReasons.join(" ")).toContain("PROVISIONAL");
  });

  it("W52 AC-17 a note with unmodelled accrued interest REFUSES to be final", () => {
    const d = discloseConversions([
      {
        id: "note-1",
        kind: "convertible_note",
        status: "converts_in_this_round",
        shares: 1_000_000n,
        accruedInterestModelled: false,
      },
    ]);
    expect(d.priceIsProvisional).toBe(true);
    const why = d.provisionalReasons.join(" ");
    expect(why).toContain("accrued interest is not modelled");
    expect(why).toContain("no issue date");
    expect(why).toContain("understates the note and overstates founders");
  });

  it("W52 AC-17 a note WITH the data path modelled does not refuse", () => {
    const d = discloseConversions([
      {
        id: "note-1",
        kind: "convertible_note",
        status: "converts_in_this_round",
        shares: 1_000_000n,
        accruedInterestModelled: true,
      },
    ]);
    expect(d.priceIsProvisional).toBe(false);
    expect(d.includedShares.toString()).toBe("1000000");
  });
});

describe("W52 · §0 / AC-16 — the Review preview exists and refuses honestly", () => {
  it("W52 AC-16 POLE A a priced round previews ownership with named denominators", () => {
    const p = buildCapTablePreview({
      instrument: "preferred",
      pricing: {
        preMoneyValuation: "30000000",
        fdPreMoneyShares: String(FD_PRE_MONEY),
        poolTopUpShares: String(NEW_POOL),
      },
      existingHolders: [{ name: "Existing fully-diluted holders (aggregate)", shares: String(FD_PRE_MONEY) }],
      investments: [{ name: "This round's investors", amount: "10000000" }],
    });
    expect(p.ok).toBe(true);
    if (!p.ok) throw new Error("unreachable");
    expect(p.pricing.pricePerShare).toBe("2");
    expect(p.postMoney?.postMoneyValuation).toBe("40000000");
    expect(p.rows).toHaveLength(2);
    /* The new investor takes 5,000,000 of T = 20,000,000 = 25.000%. */
    const investor = p.rows[1];
    expect(investor.shares.toString()).toBe("5000000");
    const post = investor.percentages.find((x) => x.denominator === "FD_POST");
    expect(post?.value).toBe("25.000");
    /* NO percentage may exist without a denominator. */
    for (const row of p.rows) {
      expect(row.percentages.length).toBeGreaterThan(0);
      for (const pc of row.percentages) {
        expect(DENOM_LABELS).toContain(pc.denominator);
        expect(pc.denominatorShares).not.toBe("0");
      }
    }
  });

  it("W52 AC-16 POLE B the preview refuses when a required input is missing", () => {
    const p = buildCapTablePreview({
      instrument: "preferred",
      pricing: { preMoneyValuation: "30000000", fdPreMoneyShares: "" },
    });
    expect(p.ok).toBe(false);
    if (p.ok) throw new Error("unreachable");
    expect(p.code).toBe("fd_pre_money_shares_missing");
  });

  it("W52 the displayed total is separately rounded, never the sum of the column", () => {
    /* I-4. A three-row fixture whose rounded rows sum to 99.999% must still
       display a 100.000% total, because the total is the exact total rounded
       once. */
    const p = buildCapTablePreview({
      instrument: "preferred",
      pricing: { preMoneyValuation: "3000000", fdPreMoneyShares: "3000000" },
      existingHolders: [
        { name: "A", shares: "1000000" },
        { name: "B", shares: "1000000" },
        { name: "C", shares: "1000000" },
      ],
    });
    if (!p.ok) throw new Error("unreachable");
    const preLabel = p.displayedTotals.find((x) => x.denominator === "FD_PRE_INCL_POOL");
    expect(preLabel?.value).toBe("100.000");
    const rows = p.rows.map((r) => r.percentages.find((x) => x.denominator === "FD_PRE_INCL_POOL")!.value);
    expect(rows).toEqual(["33.333", "33.333", "33.333"]);
    const summed = rows.reduce((a, b) => a + Number(b), 0).toFixed(3);
    expect(summed).toBe("99.999");
    /* The displayed total is NOT the summed column. That is the assertion. */
    expect(preLabel?.value).not.toBe(summed);
  });

  it("W52 item 4a — where the model cannot answer, the preview says so on screen", () => {
    const p = buildCapTablePreview({
      instrument: "preferred",
      pricing: { preMoneyValuation: "30000000", fdPreMoneyShares: String(FD_PRE_MONEY) },
      investments: [{ name: "inv", amount: "10000000" }],
    });
    if (!p.ok) throw new Error("unreachable");
    expect(p.pricing.denominator.incomplete).toBe(true);
    const why = p.pricing.denominator.incompleteReasons.join(" ");
    expect(why).toContain("cannot yet separate granted options from the unallocated pool");
    /* Multi-close and authorized capital are disclosed as ABSENCES, not blanks. */
    const notes = p.notes.join(" ");
    expect(notes).toContain("Structured multi-close is NOT implemented");
    expect(notes).toContain("no authorized-capital");
  });
});

describe("W52 · item 1a — the notional Common raise is a raise, not a post-money", () => {
  it("W52 item 1a the Common raise is PPS × new shares issued", () => {
    /* Matches server/routes.ts's exact-decimal derivation, which stores this as
       `targetAmount`. The multiplicand means NEW SHARES ISSUED, so the product
       is the notional primary raise. It is defensible and it is NOT a post-money. */
    const r = commonNotionalRaise("2", "5000000");
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.raise).toBe("10000000");
    expect(r.newShares.toString()).toBe("5000000");
  });

  it("W52 item 1a the old post-money formula was pre-money whenever there is no target raise", () => {
    /* The pre-Wave-52 surface rendered Number(preMoney) + Number(targetAmount).
       For Common, targetAmount is not a collected field, so the addend was
       NaN → 0 and the box showed the PRE-money under a post-money label. This
       test reproduces the defect arithmetically so the regression is pinned. */
    const preMoney = 30_000_000;
    const targetAmountForCommon = "";
    const oldRendered = Number(preMoney) + Number(targetAmountForCommon) || 0;
    /* Number("") is 0, so the "implied post-money" equalled the pre-money. */
    expect(oldRendered).toBe(preMoney);

    /* The new surface computes T·p instead, which is strictly larger here. */
    const pricing = derivePricePerShare({
      preMoneyValuation: String(preMoney),
      fdPreMoneyShares: "15000000",
    });
    if (!pricing.ok) throw new Error("unreachable");
    const raise = commonNotionalRaise(pricing.pricePerShare, "5000000");
    if (!raise.ok) throw new Error("unreachable");
    const d = deriveInvestorShares(raise.raise, pricing.pricePerShare);
    if (!d.ok) throw new Error("unreachable");
    const pm = computePostMoney({
      denominator: pricing.denominator,
      pricePerShare: pricing.pricePerShare,
      derivations: [d],
      preMoneyValuation: String(preMoney),
    });
    if (!pm.ok) throw new Error("unreachable");
    expect(Number(pm.postMoneyValuation)).toBeGreaterThan(oldRendered);
    expect(pm.postMoneyValuation).toBe("40000000");
  });
});
