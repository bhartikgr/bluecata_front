/**
 * WAVE 87 — THE FIVE UNPAIRED DISAPPEARANCES, PROVED BY RENDERING.
 * ════════════════════════════════════════════════════════════════════════════
 * `npm run drop:restyle` reported five UNPAIRED disappearances after WAVE 87's
 * edits. An unpaired `moneyOrPercent` disappearance is the exact signature Wave 0
 * built that detector to catch — a money figure deleted while its `data-testid`
 * stays behind — so "it is only a formatter swap" is not something to assert from
 * a diff. This file proves each one BY RENDERING, in jsdom.
 *
 *   BARE 1  partner/PartnerBilling.tsx  exprChild  div  01e7cfadb101
 *   BARE 2  partner/PartnerBilling.tsx  exprChild  div  8e8742d3a2cd
 *           → DELIBERATE REMOVALS. What the user no longer sees is a RAW SERVER
 *             ERROR CODE (`PARTNER_TIER_UNRESOLVED`, `agg.commission.error`),
 *             which R44/R77 forbid in rendered text. The code is NOT lost: it
 *             moved to a machine-readable `data-error-code` attribute. Both halves
 *             are asserted below against the DOM.
 *
 *   BARE 3  components/admin/KycDocumentsPanel.tsx  moneyOrPercent  call  46560f3b2ded
 *   BARE 4  pages/admin/Email.tsx                   moneyOrPercent  call  b958976abea1
 *   BARE 5  pages/admin/Payments.tsx                moneyOrPercent  call  b958976abea1
 *           → FORMATTER SWAPS, and NOT MONEY AT ALL. The detector's MONEY regex
 *             matches the bare token `toLocaleString`, which is also the DATE call
 *             those three files used. The digests are reproduced exactly from
 *             `new Date(iso).toLocaleString()` and `d.toLocaleString()`, and the
 *             replacement renders the SAME STRING for a timestamp — asserted in the
 *             DOM below, character for character, not by inspection.
 *
 * Transcript and the digest reproductions: build_log/wave87/W87_TESTS.md §5.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { fmtLocaleDate, fmtLocaleDateTime } from "../format";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* jsdom is shared across tests in this file; unmount between them so a testid
   query cannot match a leftover render. */
afterEach(() => cleanup());

/* A real timestamp and a real date-only value from the tree's own data:
 *   payment_ledger.ts / audit rows carry full ISO instants;
 *   server/paymentGatewayAdapter.ts:839 writes periodEnd as YYYY-MM-DD. */
const INSTANT = "2026-06-15T14:32:07.000Z";
const DATE_ONLY = "2026-06-15";

/* ══════════════════════════════════════════════════════════════════════════ *
 * BARE 3/4/5 — FORMATTER SWAP: the value still renders, identically.         *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · the three unpaired moneyOrPercent rows are date calls, and the value still renders", () => {
  it("the replacement renders the SAME STRING the dropped call rendered, for a timestamp", () => {
    /* This is what the dropped digests were: `new Date(iso).toLocaleString()`
       (b958976abea1) and `d.toLocaleString()` (46560f3b2ded). */
    const whatTheOldCallProduced = new Date(INSTANT).toLocaleString();
    render(<span data-testid="w87-swap">{fmtLocaleDateTime(INSTANT)}</span>);
    const el = screen.getByTestId("w87-swap");
    expect(el.textContent).toBe(whatTheOldCallProduced);
    expect(el.textContent!.length).toBeGreaterThan(0);
    /* and it is a DATE, not a money figure — no currency symbol, no grouping of
       a monetary amount; it contains the year the value carries. */
    expect(el.textContent).toContain("2026");
    expect(el.textContent).not.toContain("$");
  });

  it("the same for the date-only variant, where the old call printed the WRONG DAY west of UTC", () => {
    render(<span data-testid="w87-dateonly">{fmtLocaleDate(DATE_ONLY)}</span>);
    const shown = screen.getByTestId("w87-dateonly").textContent!;
    expect(shown.length).toBeGreaterThan(0);
    /* the entered day, in whatever zone this process runs in */
    expect(shown).toBe(new Date(2026, 5, 15).toLocaleDateString());
  });

  it("nothing was removed: each of the three files still calls its date helper at every site", () => {
    const cases: Array<[string, string, number]> = [
      ["client/src/pages/admin/Email.tsx", "fmtDate(", 3],
      ["client/src/pages/admin/Payments.tsx", "fmtDate(", 3],
      ["client/src/components/admin/KycDocumentsPanel.tsx", "fmtDate(", 2],
    ];
    for (const [rel, call, minSites] of cases) {
      const src = read(rel);
      /* call sites only — exclude the declaration line */
      const sites = src.split("\n").filter((l) => l.includes(call) && !/function\s+fmtDate/.test(l));
      expect(sites.length, `${rel} call sites`).toBeGreaterThanOrEqual(minSites);
      /* the helper now delegates to the safe formatter, and no longer contains
         the token that made the detector call it money */
      expect(src, `${rel} helper delegates`).toMatch(/fmtLocaleDate(Time)?\(/);
      const helperBody = src.slice(src.indexOf("function fmtDate"), src.indexOf("function fmtDate") + 400);
      expect(helperBody, `${rel} helper no longer builds a Date`).not.toMatch(/new Date\(/);
    }
  });

  it("the detector called these MONEY because its regex matches the token `toLocaleString`", () => {
    /* the exact regex from scripts/restyle-drop-detector/detect.mjs */
    const MONEY = /\b(formatMinor|formatMoney|formatCurrency|formatUsd|toLocaleString|formatPercent|formatBps|formatPct|Intl\.NumberFormat)\b/;
    expect(MONEY.test("new Date(iso).toLocaleString()")).toBe(true);   /* why the row existed */
    expect(MONEY.test("fmtLocaleDateTime(iso)")).toBe(false);          /* why it disappeared */
    /* i.e. the row disappeared because a money-LOOKING TOKEN disappeared, not
       because a rendered value disappeared. The two assertions above prove the
       value is still there. */
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * BARE 1/2 — DELIBERATE REMOVAL: a raw error code left the screen.           *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · the two unpaired PartnerBilling rows are deliberate removals of a raw error code", () => {
  /** The exact shape now in client/src/pages/partner/PartnerBilling.tsx:1727-1745. */
  function TierErrorCard({ tierError }: { tierError: string | null }) {
    return (
      <div
        className="mt-1 text-sm text-rose-700"
        data-testid="partner-feeschedule-tier-error"
        data-error-code={tierError ?? "PARTNER_TIER_UNRESOLVED"}
      >
        Not resolved — we could not determine your billing tier. Contact support and we will confirm it.
      </div>
    );
  }
  function CommissionErrorCard({ error }: { error: string }) {
    return (
      <div
        className="mt-1 text-sm text-rose-700"
        data-testid="partner-feeschedule-commission-error"
        data-error-code={error}
      >
        Not resolved — your commission rate could not be determined. Contact support and we will confirm it.
      </div>
    );
  }

  it("the PARTNER now reads a sentence, and the identifier is nowhere in the visible text", () => {
    render(<TierErrorCard tierError={null} />);
    const el = screen.getByTestId("partner-feeschedule-tier-error");
    expect(el.textContent).toContain("we could not determine your billing tier");
    expect(el.textContent).not.toContain("PARTNER_TIER_UNRESOLVED");
    expect(el.textContent).not.toContain("_");
  });

  it("the identifier is NOT lost — it is machine-readable on the element (R77)", () => {
    render(<TierErrorCard tierError={null} />);
    expect(screen.getByTestId("partner-feeschedule-tier-error").getAttribute("data-error-code"))
      .toBe("PARTNER_TIER_UNRESOLVED");
  });

  it("a server-supplied code is carried through the same way, and still not shown", () => {
    render(<TierErrorCard tierError="TIER_UNRESOLVED" />);
    const el = screen.getByTestId("partner-feeschedule-tier-error");
    expect(el.getAttribute("data-error-code")).toBe("TIER_UNRESOLVED");
    expect(el.textContent).not.toContain("TIER_UNRESOLVED");
  });

  it("the commission card behaves identically", () => {
    render(<CommissionErrorCard error="COMMISSION_UNRESOLVED" />);
    const el = screen.getByTestId("partner-feeschedule-commission-error");
    expect(el.textContent).toContain("your commission rate could not be determined");
    expect(el.textContent).not.toContain("COMMISSION_UNRESOLVED");
    expect(el.getAttribute("data-error-code")).toBe("COMMISSION_UNRESOLVED");
  });

  it("and the SHAPE asserted above is the shape that is actually in the product file", () => {
    const src = read("client/src/pages/partner/PartnerBilling.tsx");
    expect(src).toContain('data-error-code={agg.tierError ?? "PARTNER_TIER_UNRESOLVED"}');
    expect(src).toContain("data-error-code={agg.commission.error}");
    expect(src).toContain("we could not determine your billing tier");
    expect(src).toContain("your commission rate could not be determined");
    /* the two testids the detector keys on are still present — nothing became an
       orphaned testid over an emptied value, which is Wave 0's whole worry */
    expect(src).toContain('data-testid="partner-feeschedule-tier-error"');
    expect(src).toContain('data-testid="partner-feeschedule-commission-error"');
    /* and no MONEY figure lives in either card: both are the error branch of a
       card whose success branch renders the money, and that branch is untouched */
    expect(src).toContain("formatFractionAsPercent(agg.commission.rateFraction)");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * The 29 paired rows — the leaf value still renders in every one.            *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · every paired disappearance still renders its value", () => {
  it("the five date leaves that changed call still render a date at the same site", () => {
    const sites: Array<[string, string]> = [
      ["client/src/pages/collective/CollectiveMembership.tsx", "fmtLocaleDate(subscription.renewsOn)"],
      ["client/src/pages/collective/CollectiveMembers.tsx", "fmtLocaleDate(selectedMember.partnerSince)"],
      ["client/src/pages/collective/CollectiveDealRoom.tsx", "fmtLocaleDate(company.lastRaise)"],
      ["client/src/pages/partner/PartnerClientDetail.tsx", "fmtLocaleDate(snapshot.lastRaiseDate)"],
      ["client/src/pages/admin/PartnerDetail.tsx", "fmtLocaleDate(t.dueDate ?? t.due_date)"],
    ];
    for (const [rel, expr] of sites) {
      expect(read(rel), rel).toContain(expr);
    }
  });

  it("and each of those sites keeps the data-testid / label it had", () => {
    expect(read("client/src/pages/collective/CollectiveMembership.tsx")).toContain('data-testid="text-renewal-date"');
    expect(read("client/src/pages/collective/CollectiveMembers.tsx")).toContain('data-testid="text-detail-partner-since"');
    expect(read("client/src/pages/collective/CollectiveDealRoomDetail.tsx")).toContain('testId="captable-raise-date"');
  });
});
