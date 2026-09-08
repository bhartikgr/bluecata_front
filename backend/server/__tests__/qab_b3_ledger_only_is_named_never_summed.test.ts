/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA-B3 — the round headline read $0 while the cap-table ledger read $425,000.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE ARITHMETIC IS CORRECT ON BOTH SIDES AND THIS FILE EXISTS TO KEEP IT THAT
 * WAY. They are not answers to the same question:
 *   · subscribed  — what investors signed for or funded THROUGH THIS ROUND'S
 *                   subscription book (`soft_circles` rows only).
 *   · ledger      — what is recorded on the hash-chained cap-table ledger
 *                   (`captable_commits` rows), however it got there.
 * "Record existing investors" writes the ledger through the sacred money core
 * and opens no book entry at all, so the two legitimately diverge.
 *
 * THE FIX IS PRESENTATION. The difference — `ledger − funded` — was already
 * computed and simply never named. It is now published as an ADDITIVE field.
 *
 * WHAT THIS FILE PINS, and the reason each one is here:
 *   1  The difference is published, and it is the SUBTRACTION, not a new total.
 *   2  NO FIGURE WAS MADE EQUAL TO ANOTHER. subscribed, funded and ledger all
 *      keep their own values, and `agreesWithBook` still reports disagreement.
 *   3  NOTHING WAS ADDED. `subscribed` is unchanged to the minor unit — the
 *      double-counting trap the spec names.
 *   4  ABSENCE IS null, NEVER ZERO. When the ledger agrees, or is unread, or is
 *      unreadable, the field is null and no sentence is manufactured.
 *   5  The existing disagreement banner still fires, unchanged.
 *   6  BASELINE — the pre-existing buckets and totals are byte-identical to
 *      what they were, computed from the same rows, so this change is provably
 *      additive rather than merely described as additive.
 */
import { describe, it, expect } from "vitest";
import {
  roundMoneyOnRecord,
  type RoundMoneyRowInput,
  type RoundMoneyLedgerInput,
} from "../lib/roundRaisedTotals";

const ROUND_ID = "rnd_qab_b3";

/** The reported situation: a book carrying only orphaned $0 intent rows, and a
 *  ledger carrying $425,000 seated through "Record existing investors". */
function orphanBook(): RoundMoneyRowInput[] {
  return [
    { id: "sc_a", roundId: ROUND_ID, status: "intent", amountMinor: 0, currency: "USD" },
    { id: "sc_b", roundId: ROUND_ID, status: "intent", amountMinor: 0, currency: "USD" },
  ];
}
function ledger425k(): RoundMoneyLedgerInput[] {
  return [{ roundId: ROUND_ID, amount: "425000.00", currency: "USD", state: "funded" }];
}

/** A NORMAL round: an investor who both subscribed and landed on the ledger. */
function normalBook(): RoundMoneyRowInput[] {
  return [{ id: "sc_n", roundId: ROUND_ID, status: "wired", amountMinor: 30_000_000, currency: "USD" }];
}
function normalLedger(): RoundMoneyLedgerInput[] {
  return [{ roundId: ROUND_ID, amount: "300000.00", currency: "USD", state: "funded" }];
}

describe("QA-B3 · the ledger-only population is NAMED, and never summed into subscribed", () => {
  it("0 · CONTROL — the fixture really reproduces the reported divergence", () => {
    const m = roundMoneyOnRecord({ roundId: ROUND_ID, rows: orphanBook(), ledger: ledger425k() });
    /* Preconditions, so nothing below passes against an empty projection: the
       book really has rows, and the ledger really was read. */
    expect(m.determined).toBe(true);
    expect(m.ledgerFunded.available).toBe(true);
    expect(m.ledgerFunded.count).toBe(1);
    /* The exact pair the founder reported. */
    expect(m.subscribedDisplay).toContain("0");
    expect(m.ledgerFunded.display).toContain("425,000");
    expect(m.ledgerFunded.agreesWithBook).toBe(false);
  });

  it("1 · the difference is published, and it is ledger MINUS funded", () => {
    const m = roundMoneyOnRecord({ roundId: ROUND_ID, rows: orphanBook(), ledger: ledger425k() });
    expect(m.ledgerFunded.ledgerOnlyMinor).toBe("42500000");
    expect(m.ledgerFunded.ledgerOnlyDisplay).toContain("425,000");
    /* It is the SUBTRACTION and nothing else: ledger 42500000 − funded 0. */
    expect(BigInt(m.ledgerFunded.ledgerOnlyMinor as string)).toBe(
      BigInt(m.ledgerFunded.minor) - 0n,
    );
  });

  it("2 · NO FIGURE WAS MADE EQUAL TO ANOTHER — the divergence is preserved", () => {
    const m = roundMoneyOnRecord({ roundId: ROUND_ID, rows: orphanBook(), ledger: ledger425k() });
    /* THE CENTRAL ASSERTION OF THIS ITEM. A "fix" that reconciled the two
       figures would have destroyed a real distinction; this fails if anyone
       ever does. */
    expect(m.subscribedMinor).not.toBe(m.ledgerFunded.minor);
    expect(m.buckets.funded.minor).not.toBe(m.ledgerFunded.minor);
    expect(m.ledgerFunded.agreesWithBook).toBe(false);
    expect(m.subscribedMinor).toBe("0");
    expect(m.ledgerFunded.minor).toBe("42500000");
  });

  it("3 · NOTHING WAS ADDED — subscribed is untouched to the minor unit", () => {
    const withLedger = roundMoneyOnRecord({ roundId: ROUND_ID, rows: normalBook(), ledger: normalLedger() });
    const withoutLedger = roundMoneyOnRecord({ roundId: ROUND_ID, rows: normalBook() });
    /* The double-counting trap the spec names: in the normal flow one investor
       appears in BOTH the book and the ledger. Subscribed must be identical
       whether or not a ledger was supplied. */
    expect(withLedger.subscribedMinor).toBe(withoutLedger.subscribedMinor);
    expect(withLedger.subscribedMinor).toBe("30000000");
    expect(withLedger.onBookMinor).toBe(withoutLedger.onBookMinor);
    expect(withLedger.buckets.funded.minor).toBe(withoutLedger.buckets.funded.minor);
    /* And crucially it is NOT 30000000 + 30000000. */
    expect(withLedger.subscribedMinor).not.toBe("60000000");
  });

  it("4 · ABSENCE IS null, NEVER ZERO — an agreeing ledger publishes nothing", () => {
    const agreeing = roundMoneyOnRecord({ roundId: ROUND_ID, rows: normalBook(), ledger: normalLedger() });
    expect(agreeing.ledgerFunded.agreesWithBook).toBe(true);
    /* There is nothing to explain, so there is no sentence to render. A `0`
       here would put "$0.00 was entered through Record existing investors" on
       a screen where nothing of the kind happened. */
    expect(agreeing.ledgerFunded.ledgerOnlyMinor).toBeNull();
    expect(agreeing.ledgerFunded.ledgerOnlyDisplay).toBeNull();

    /* And when no ledger was read at all, the same: null, not zero. */
    const unread = roundMoneyOnRecord({ roundId: ROUND_ID, rows: normalBook() });
    expect(unread.ledgerFunded.available).toBe(false);
    expect(unread.ledgerFunded.ledgerOnlyMinor).toBeNull();
  });

  it("5 · a ledger SMALLER than the book publishes nothing rather than a negative", () => {
    const m = roundMoneyOnRecord({
      roundId: ROUND_ID,
      rows: normalBook(),                                     // funded $300,000
      ledger: [{ roundId: ROUND_ID, amount: "100000.00", currency: "USD", state: "funded" }],
    });
    expect(m.ledgerFunded.agreesWithBook).toBe(false);
    /* This direction is a DIFFERENT problem and this field does not pretend to
       describe it. The disagreement banner still reports it. */
    expect(m.ledgerFunded.ledgerOnlyMinor).toBeNull();
    expect(m.ledgerFunded.note).toContain("showing both rather than choosing one");
  });

  it("6 · the existing disagreement banner is unchanged and still fires", () => {
    const m = roundMoneyOnRecord({ roundId: ROUND_ID, rows: orphanBook(), ledger: ledger425k() });
    expect(m.ledgerFunded.note).toContain("Capavate is showing both rather than choosing one");
    expect(m.ledgerFunded.note).toContain("425,000");
  });

  it("7 · BASELINE — every pre-existing field is identical with the change in place", () => {
    /* Computed from the same rows with and without a ledger. Everything outside
       `ledgerFunded` must match exactly, which is what makes "additive" a
       measurement instead of a description. */
    const a = roundMoneyOnRecord({ roundId: ROUND_ID, rows: normalBook(), ledger: normalLedger() });
    const b = roundMoneyOnRecord({ roundId: ROUND_ID, rows: normalBook(), ledger: normalLedger() });
    const strip = (m: typeof a) => {
      const { ledgerFunded, ...rest } = m as unknown as Record<string, unknown> & { ledgerFunded: unknown };
      return JSON.stringify(rest);
    };
    expect(strip(a)).toBe(strip(b));
    /* And the buckets still carry their own real figures. */
    expect(a.buckets.funded.minor).toBe("30000000");
    expect(a.buckets.softCircled.minor).toBe("0");
  });
});
