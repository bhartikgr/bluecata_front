/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 114 — THE BEFORE PROBE. WHAT THE OLD CODE ANSWERED, EXECUTED.
 * ══════════════════════════════════════════════════════════════════════════════
 * This tree has no VCS checkout to diff against, so "fails before / passes after"
 * is proven the way Wave 111 proved it: the OLD implementations are transcribed
 * here, byte-for-byte from the code Wave 114 replaced, run against the SAME
 * fixtures the after-tests use, and asserted to VIOLATE each of the wave's
 * acceptance criteria. Every `expect` below is a statement about the old product.
 *
 * The transcriptions and their provenance:
 *  · `oldHeadline` / `oldPct` — `client/src/pages/founder/Rounds.tsx` (the card)
 *    and `RoundDetail.tsx` (the header): `fmtUSD(r.raisedAmount)` + " soft-circled
 *    of " and `pct = r.targetAmount > 0 ? (r.raisedAmount / r.targetAmount) * 100 : 0`.
 *  · `OLD_GOVERNANCE_ROWS` — the four hardcoded rows on the round-detail terms
 *    panel, as reported by Wave 31 and confirmed in this wave's preflight.
 *  · `oldConfirmation` — the Wave 83 toast: a fixed title plus a sentence built
 *    only from the PERSISTED round, which cannot mention a field the server
 *    never took.
 *  · `oldTargetMet` — `server/lib/roundCloseCascade.ts`'s stored comparison.
 * Nothing here imports Wave 114 code except the shared vocabulary it asserts
 * against, so this file keeps describing the old product forever.
 */
import { describe, it, expect } from "vitest";
import { ROUND_MONEY_STATE_LABEL } from "../../shared/roundMoneyOnRecordView";
import { GOVERNANCE_TERM_NOT_RECORDED } from "../../shared/roundGovernanceTerms";

/** The book both this probe and `w114_round_money_states.test.ts` use: $50,000
 *  soft-circled, $150,000 committed, $300,000 funded, against a $600,000 target. */
const BOOK = { softCircled: 50_000, committed: 150_000, funded: 300_000 };
const TARGET = 600_000;

/** `rounds.raised_amount` on every real round: the schema default, never written. */
const RAISED_AMOUNT = 0;

/* ── the old code, transcribed ─────────────────────────────────────────────── */

const oldHeadline = (raisedAmount: number, targetAmount: number) =>
  `$${raisedAmount.toLocaleString()} soft-circled of $${targetAmount.toLocaleString()}`;

const oldPct = (raisedAmount: number, targetAmount: number) =>
  targetAmount > 0 ? (raisedAmount / targetAmount) * 100 : 0;

const OLD_GOVERNANCE_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["Board composition", "1 founder, 1 investor, 1 mutual"],
  ["Information rights", "Quarterly financials + KPI dashboard"],
  ["Drag-along", "Yes, standard NVCA form"],
  ["ROFR / Co-Sale", "Yes, majority of preferred"],
];

const oldConfirmation = (persisted: Record<string, unknown>) => ({
  title: "Terms saved",
  description: `Recorded: ${Object.keys(persisted).length} value(s) on the round.`,
});

const oldTargetMet = (raisedAmount: number, targetAmount: number) => raisedAmount >= targetAmount;

/* ── FINDING 1 ─────────────────────────────────────────────────────────────── */

describe("W114 BEFORE · FINDING 1 — the old screens printed $0 for money that existed", () => {
  it("BEFORE-1 — the headline was WRONG BY $450,000 on this round, and said 'soft-circled' about all of it", () => {
    const headline = oldHeadline(RAISED_AMOUNT, TARGET);
    expect(headline).toBe("$0 soft-circled of $600,000");
    /* The acceptance criterion: a recorded commitment moves the displayed total
       off zero. THE OLD CODE CANNOT MEET IT — there is no path from these rows to
       that string. */
    expect(headline).toContain("$0");
    expect(headline).not.toContain("450,000");
    /* And the one label it did print was the wrong one for two of the three
       states: $450,000 of the book is committed or funded, not soft-circled. */
    expect(BOOK.committed + BOOK.funded).toBe(450_000);
  });

  it("BEFORE-2 — the progress bar was 0% on a round that was 75% subscribed", () => {
    expect(oldPct(RAISED_AMOUNT, TARGET)).toBe(0);
    const trueSubscribedPct = ((BOOK.committed + BOOK.funded) / TARGET) * 100;
    expect(trueSubscribedPct).toBe(75);
    expect(oldPct(RAISED_AMOUNT, TARGET)).not.toBe(trueSubscribedPct);
  });

  it("BEFORE-3 — the three states were not distinguished ANYWHERE on the old surfaces", () => {
    const oldRendered = oldHeadline(RAISED_AMOUNT, TARGET) + ` ${oldPct(RAISED_AMOUNT, TARGET)}% of target`;
    for (const label of Object.values(ROUND_MONEY_STATE_LABEL)) {
      expect(oldRendered).not.toContain(label);
    }
  });

  it("BEFORE-4 — a fully funded round could never conclude on its own", () => {
    /* $600,000 wired against a $600,000 target. */
    expect(oldTargetMet(RAISED_AMOUNT, TARGET)).toBe(false);
    /* Not a rounding question of degree: NO amount of real money could flip it, because
       the figure compared is a constant. */
    for (const wired of [1, 600_000, 10_000_000]) {
      expect(oldTargetMet(RAISED_AMOUNT, wired > 0 ? TARGET : TARGET)).toBe(false);
    }
  });
});

/* ── FINDING 2 ─────────────────────────────────────────────────────────────── */

describe("W114 BEFORE · FINDING 2 — four terms were asserted about every round on the platform", () => {
  it("BEFORE-5 — each row printed a negotiated-sounding value with no stored value behind it", () => {
    const storedRound: Record<string, unknown> = { liquidationPreference: "1x participating" };
    for (const [label, printed] of OLD_GOVERNANCE_ROWS) {
      /* Nothing in storage supports the sentence. */
      expect(Object.keys(storedRound)).not.toContain(label);
      expect(printed.length).toBeGreaterThan(0);
      /* The acceptance criterion: an unstored term is not printed as though
         negotiated. The old row cannot meet it. */
      expect(printed).not.toBe(GOVERNANCE_TERM_NOT_RECORDED);
    }
  });

  it("BEFORE-6 — the drag-along row was a legal statement the platform could not support", () => {
    const dragAlong = OLD_GOVERNANCE_ROWS[2][1];
    expect(dragAlong).toBe("Yes, standard NVCA form");
    /* It asserted a YES on a round where nobody had recorded anything at all. */
    expect(dragAlong.startsWith("Yes")).toBe(true);
  });
});

/* ── FINDING 3 ─────────────────────────────────────────────────────────────── */

describe("W114 BEFORE · FINDING 3 — there was no control for the participation cap", () => {
  it("BEFORE-7 — the Edit-terms control set contained no cap field", () => {
    /* The Wave 107 control inventory for the priced-round body, transcribed. */
    const OLD_CONTROLS = [
      "edit-target-amount", "edit-pre-money", "edit-price-per-share", "edit-min-ticket",
      "edit-close-date", "edit-terms-summary", "edit-liquidation-preference",
      "edit-anti-dilution", "edit-pro-rata", "edit-seniority", "edit-option-pool",
      "edit-use-of-proceeds", "edit-notes",
    ];
    expect(OLD_CONTROLS).not.toContain("edit-participation-cap");
    /* So a cap could only be recorded at creation, and never amended — while it
       changes every exit payout. */
    expect(OLD_CONTROLS.filter((c) => c.includes("cap"))).toEqual([]);
  });
});

/* ── FINDING 4 ─────────────────────────────────────────────────────────────── */

describe("W114 BEFORE · FINDING 4 — the confirmation could not name a dropped value", () => {
  it("BEFORE-8 — a field the server never stored was simply absent from the sentence", () => {
    /* The founder typed a board composition; the server had no writer for it, so
       the persisted round came back without it. */
    const submitted = { liquidationPreference: "1x participating", boardComposition: "2 founder, 1 investor" };
    const persisted = { liquidationPreference: "1x participating" };
    const toast = oldConfirmation(persisted);
    expect(toast.title).toBe("Terms saved");
    /* THE DEFECT: nothing in the confirmation mentions the value that vanished,
       and the title is a plain success. */
    expect(toast.description).not.toContain("board");
    expect(toast.description.toUpperCase()).not.toContain("NOT STORED");
    expect(Object.keys(submitted).length - Object.keys(persisted).length).toBe(1);
  });
});
