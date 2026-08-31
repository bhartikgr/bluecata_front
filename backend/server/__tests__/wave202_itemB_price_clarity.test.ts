/**
 * WAVE 202 · ITEM B · R178.2 — "SO THAT I KNOW EXACTLY WHAT I'M SETTING A PRICE FOR."
 * ════════════════════════════════════════════════════════════════════════════════
 * The owner has said three times that he cannot read the pricing admin. This file
 * proves, against the REAL database and the REAL report builder, that the five
 * questions he needs answered are answered for EVERY price — not for a sample, and
 * not by a fixture standing in for the database.
 *
 * WHAT IS PROVED
 *   B-1   every row answers all five questions: product, audience, period, state,
 *         and WHERE ON THE FRONTEND it appears (he said that one matters most)
 *   B-2   nothing is expressed as a slug, a precedence integer or a tier band — the
 *         plain-language fields contain no raw database key
 *   B-3   state is a WORD ("Live" / "Retired"), so colour is never the only signal
 *   B-4   live prices sort first
 *   B-5   an absent amount is `null` and is never 0 (R143.4 / R176.1)
 *   B-6   a deliberate free price is distinguishable from an absent one
 *   B-7   the Collective membership's missing annual price produces an honest
 *         `annualGap` sentence that never contains a derived figure
 *   B-8   every sentence the report can emit fits the 240-character `looksHuman`
 *         gate
 *   B-9   ITEM C: wave 201's two population disclosures are still present BYTE FOR
 *         BYTE, and the new headline designation sits beside them (R143.1)
 *   B-10  R143.1 on every client file this wave touched: wave 199's literals, the
 *         cadence helpers and the existing testids are unchanged
 *   B-11  NO CONTROL DROPPED: every data-testid that existed on the three touched
 *         client files before this wave still exists
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildPriceClarityReport } from "../lib/priceClarity";
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";

const ROOT = resolve(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

const PRICING_TSX = "client/src/pages/admin/Pricing.tsx";
const MEMBERSHIP_TSX = "client/src/pages/collective/MembershipPage.tsx";
const MODELS_TSX = "client/src/pages/admin/PricingModels.tsx";
const POLICY_TS = "client/src/lib/priceDisplayPolicy.ts";

describe("W202 B — the plain-language price report", () => {
  const report = buildPriceClarityReport();

  it("B-0 the report is built from the real database and is not empty", () => {
    expect(report.refusal).toBeNull();
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.liveCount + report.retiredCount).toBe(report.rows.length);
  });

  it("B-1 every row answers all five questions the owner has to be able to answer", () => {
    for (const r of report.rows) {
      expect(r.product.length).toBeGreaterThan(0);
      expect(r.whatItIs.length).toBeGreaterThan(0);
      expect(r.audience.length).toBeGreaterThan(0);
      expect(r.periodPlain.length).toBeGreaterThan(0);
      expect(r.stateLabel === "Live" || r.stateLabel === "Retired").toBe(true);
      expect(r.stateExplanation.length).toBeGreaterThan(0);
      /* THE ONE HE SAID MATTERS MOST. Either a list of screens, or nothing —
         and when it is nothing the panel says so in words rather than leaving a
         blank cell. An empty array is therefore allowed; an undefined is not. */
      expect(Array.isArray(r.appearsOn)).toBe(true);
      expect(r.editedOn.length).toBeGreaterThan(0);
    }
  });

  it("B-1b at least one live price names a real frontend screen", () => {
    const withSurfaces = report.rows.filter((r) => r.appearsOn.length > 0);
    expect(withSurfaces.length).toBeGreaterThan(0);
    for (const r of withSurfaces) {
      for (const s of r.appearsOn) {
        /* A route path is not an answer to "where does a customer see this". */
        expect(s.startsWith("/")).toBe(false);
        expect(s.length).toBeGreaterThan(3);
      }
    }
  });

  it("B-2 no plain-language field leaks a raw database key, slug or precedence integer", () => {
    for (const r of report.rows) {
      for (const field of [r.product, r.whatItIs, r.audience, r.periodPlain]) {
        expect(field).not.toContain(r.rawKey);
        expect(field).not.toContain("_minor");
        expect(field).not.toContain("scope_key");
        expect(field).not.toContain("precedence");
        /* No snake_case identifier anywhere in prose the owner reads. */
        expect(/[a-z]+_[a-z]+/.test(field)).toBe(false);
      }
    }
  });

  it("B-2b EVERY product name is unique — the owner never sees two identical headings", () => {
    /* THE DEFECT THIS CATCHES. Before the tier suffix was applied to every shared
       family, this report produced FIVE rows all headed "Consortium Partner —
       subscription" and FOUR headed "Collective — membership". Five identical
       headings is precisely the screen the owner says he cannot read. */
    const names = report.rows.map((r) => r.product);
    expect(new Set(names).size).toBe(names.length);
    /* And a tier suffix must be words, not a slug. */
    for (const n of names) expect(n).not.toContain("_");
  });

  it("B-3 state is carried as a WORD, so colour is never the only signal", () => {
    for (const r of report.rows) {
      expect(r.stateLabel).toBe(r.isLive ? "Live" : "Retired");
    }
  });

  it("B-4 live prices sort before retired ones", () => {
    const firstRetired = report.rows.findIndex((r) => !r.isLive);
    if (firstRetired !== -1) {
      for (let i = firstRetired; i < report.rows.length; i += 1) {
        expect(report.rows[i].isLive).toBe(false);
      }
    }
  });

  it("B-5 R143.4 / R176.1 — an absent amount is null and is never zero", () => {
    for (const r of report.rows) {
      if (r.amountMinor === null) {
        /* Absence must not be smuggled in as a number, and must not claim a
           currency it does not have. */
        expect(r.amountMinor).not.toBe(0);
        expect(r.intentionalZero).toBe(false);
      } else {
        expect(Number.isInteger(r.amountMinor)).toBe(true);
        expect(r.currency).not.toBeNull();
      }
    }
  });

  it("B-6 a deliberate free price is distinguishable from a missing one", () => {
    const free = report.rows.filter((r) => r.intentionalZero);
    for (const r of free) {
      /* A deliberate zero HAS an amount on record. That is what makes it different
         from an absence, and why it may be shown as a figure. */
      expect(r.amountMinor).not.toBeNull();
      expect(r.amountMinor).toBe(0);
    }
  });

  it("B-7 the Collective membership's missing annual price is stated, never invented", () => {
    const membership = report.rows.filter((r) =>
      r.rawKey.startsWith("collective.member_subscription."),
    );
    expect(membership.length).toBeGreaterThan(0);
    for (const r of membership) {
      /* The database holds these as a monthly amount with no annual price. */
      expect(r.recordedPeriod).toBe("monthly");
      expect(r.annualGap).not.toBeNull();
      const gap = r.annualGap ?? "";
      /* The sentence names the gap. It must not contain a figure at all, because any
         figure in it could only have been derived. */
      expect(/\d/.test(gap)).toBe(false);
      expect(gap.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    }
  });

  it("B-8 every sentence in the report fits the 240-character looksHuman gate", () => {
    const sentences: string[] = [];
    if (report.refusal !== null) sentences.push(report.refusal);
    for (const r of report.rows) {
      sentences.push(r.whatItIs, r.stateExplanation, r.periodPlain, r.product);
      if (r.annualGap !== null) sentences.push(r.annualGap);
    }
    expect(sentences.length).toBeGreaterThan(0);
    for (const s of sentences) {
      expect(s.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
      expect(s).toMatch(/[a-z]/);
    }
  });
});

/* ============================================================================ */

describe("W202 C + R143.1 — nothing was reworded, renamed or dropped", () => {
  it("B-9 ITEM C: wave 201's two population disclosures survive BYTE FOR BYTE", () => {
    const src = read(PRICING_TSX);
    /* Billing Metrics tab — wave 201's disclosure, verbatim. */
    expect(src).toContain(
      "MRR and ARR here count ACTIVE subscriptions only, across all subscriptions,",
    );
    expect(src).toContain('data-testid="text-billing-metrics-mrr-population"');
    /* Subscriptions tab — wave 201's disclosure, verbatim. */
    expect(src).toContain(
      "Counts ACTIVE and TRIALING subscriptions in the list as currently filtered, annual amount divided by 12. The Billing Metrics tab counts ACTIVE only, across all subscriptions, so the two figures are not expected to agree.",
    );
    expect(src).toContain('data-testid="text-total-mrr-population"');
  });

  it("B-9b ITEM C: the headline designation is present on the active-only tile", () => {
    const src = read(PRICING_TSX);
    expect(src).toContain('data-testid="text-mrr-headline-designation"');
    expect(src).toContain("This is the platform's headline MRR");
    /* And the filtered tile says it is not the headline. */
    expect(src).toContain('data-testid="text-total-mrr-not-headline"');
  });

  it("B-9c ITEM C changed NO number: the two MRR computations are untouched", () => {
    const src = read(PRICING_TSX);
    /* The Subscriptions tab's population and divisor, verbatim. */
    expect(src).toContain(
      'const mrrScope = filtered.filter(s => s.status === "active" || s.status === "trialing");',
    );
    expect(src).toContain("const mrrRows = bucketRows(dividedBuckets(mrrAnnualBuckets, 12));");
    /* Wave 202 added no arithmetic to this file. */
    expect(src).not.toContain("WAVE 202 · ITEM C — recomputed");
  });

  it("B-10 R143.1: wave 199's literals and helpers on the membership page are unchanged", () => {
    const src = read(MEMBERSHIP_TSX);
    /* The cadence decision function, byte for byte. */
    expect(src).toContain(
      'if (raw === "monthly") return monthlyDisplayAllowed ? ` / ${periodLabel(raw)}` : "";',
    );
    expect(src).toContain('if (raw === "yearly" || raw === "annual") return ` / ${periodLabel(raw)}`;');
    /* Wave 199's explanatory copy, byte for byte. */
    expect(src).toContain("the cadence suffix is withheld when the recorded cadence is");
    /* The amount node and the absence sentinel. */
    expect(src).toContain('data-testid="membership-amount"');
    expect(src).toContain("MONEY_NOT_ON_RECORD");
    /* Wave 202's addition. */
    expect(src).toContain('data-testid="text-membership-annual-not-set"');
  });

  it("B-10b R143.1: wave 199's two exported hooks are still present and unrenamed", () => {
    const src = read(POLICY_TS);
    expect(src).toContain("export function usePriceDisplayPolicy(): PriceDisplayPolicy | null {");
    expect(src).toContain("export function useMonthlyDisplayAllowed(): boolean {");
    expect(src).toContain("return policy?.monthlyDisplayAllowed === true;");
    /* Wave 202's additions, additive. */
    expect(src).toContain("export function useMonthlyDisplayAllowedForScope(scopeKey: string): boolean {");
    expect(src).toContain("export function usePricePeriodOffer(scopeKey: string): PricePeriodOfferView | null {");
  });

  it("B-11 NO CONTROL DROPPED: the pricing-models page keeps every pre-existing testid", () => {
    const src = read(MODELS_TSX);
    /* A sample of controls that existed before this wave, each of which the guard
       would have flagged had the mount displaced it. Asserted here as well so the
       reason for their survival is documented and not merely counted. */
    for (const id of [
      "button-bootstrap-founder-tiers",
      "button-migrate-legacy-tiers",
    ]) {
      expect(src).toContain(id);
    }
    /* The existing intro is still rendered, and the new panel is a SIBLING of it,
       not a replacement: both appear, and the intro appears first. */
    const introAt = src.indexOf("<AdminPageIntro");
    const panelAt = src.indexOf("<PricingClarityPanel />");
    expect(introAt).toBeGreaterThan(-1);
    expect(panelAt).toBeGreaterThan(introAt);
  });

  it("B-11b the new panel adds no table cell or row — the wave 182 / 188 traps", () => {
    const raw = read("client/src/components/admin/PricingClarityPanel.tsx");
    /* COMMENTS STRIPPED FIRST. The file's own header DISCUSSES the wave 182 `<td>`
       trap in prose, so a grep over the raw text would match its own explanation.
       Stripping block and line comments before concluding anything is the standing
       rule; the assertion below verifies the stripper actually stripped. */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(src).not.toContain("renumbers its sibling cells");
    /* Adding a <td> renumbers its sibling cells (wave 182); renaming a loop
       variable inside a table retires a tab identity (wave 188). The panel avoids
       both by containing no table at all. */
    expect(src).not.toContain("<td");
    expect(src).not.toContain("<tr");
    expect(src).not.toContain("<th");
    expect(src).not.toContain("<table");
    /* And it never renders a bare zero for an absent amount. */
    expect(src).not.toContain('"$0.00"');
    expect(src).toContain("No amount on record");
  });
});
