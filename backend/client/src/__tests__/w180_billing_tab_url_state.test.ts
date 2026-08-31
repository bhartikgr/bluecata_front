/**
 * WAVE 180 · ITEM C — the partner Billing tab is addressable.
 *
 * THE DEFECT, precisely. All eight sub-tabs were already rendered and reachable
 * by clicking; the owner's first reading that some were missing was a misreport
 * and is recorded as such. The real defect was that the selected tab lived in
 * `useState<BillingTab>("referral")`, which means:
 *
 *   · a link to a tab is impossible — every URL lands on `referral`;
 *   · reload loses the tab;
 *   · Back does not undo a tab change, it leaves the page.
 *
 * WHAT IS ASSERTED HERE, and what is deliberately not. The parser and the tab
 * inventory are pure and are tested directly and exhaustively: all eight tabs
 * round-trip from a URL, the default holds when the param is absent, and every
 * malformed value falls back to the default rather than to nothing. The history
 * SEMANTICS (push, not replace, so Back works) are asserted against the source of
 * the navigate call rather than a simulated browser, because this repository's
 * client tests do not mount a router — that limitation is stated in W180_TESTS.md
 * rather than papered over with a test that would pass either way.
 *
 * THE TAB COUNT IS PINNED AT EIGHT. The silent-drop guard counts 319 tabs across
 * the app; if this file's list and the rendered chip strip ever disagree, the
 * assertion below fails before the guard has to.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BILLING_TABS,
  BILLING_TAB_DEFAULT,
  parseBillingTabParam,
} from "@/pages/partner/PartnerBilling";

const SRC = path.resolve(__dirname, "../pages/partner/PartnerBilling.tsx");
const src = fs.readFileSync(SRC, "utf8");

describe("W180 ITEM C — the eight tabs are all still there", () => {
  it("C1 exactly eight tabs, and they are the eight the page has always had", () => {
    expect(BILLING_TABS).toHaveLength(8);
    expect([...BILLING_TABS].sort()).toEqual([
      "fee-schedule", "history", "invoices", "issued",
      "referral", "spv-fees", "subscription", "tax-forms",
    ]);
  });

  it("C2 every tab in the list has a rendered chip with its own testid", () => {
    /* This is the half of the tab-count guarantee a pure list cannot give: the
     * list could be complete while a chip was dropped from the strip. */
    for (const t of BILLING_TABS) {
      expect(src, `tab-${t} must still be rendered`).toContain(`data-testid="tab-${t}"`);
    }
    /* And the strip itself, which is what the guard's tab inventory hangs off. */
    expect(src).toContain('data-testid="partner-billing-tabs"');
  });

  it("C3 the chip strip renders no MORE tabs than the list knows about", () => {
    const rendered = [...src.matchAll(/data-testid="tab-([a-z-]+)"/g)].map((m) => m[1]);
    expect(new Set(rendered).size).toBe(8);
    for (const r of rendered) expect(BILLING_TABS).toContain(r as (typeof BILLING_TABS)[number]);
  });
});

describe("W180 ITEM C — every tab is reachable by URL", () => {
  it("C4 DEEP LINK: each of the eight tabs round-trips from its own `?tab=` value", () => {
    for (const t of BILLING_TABS) {
      expect(parseBillingTabParam(`?tab=${t}`), `?tab=${t} must select ${t}`).toBe(t);
      /* And without the leading "?", because wouter's useSearch() has returned
       * both shapes across 2.x/3.x and the parser must not care. */
      expect(parseBillingTabParam(`tab=${t}`)).toBe(t);
    }
  });

  it("C5 the deep link works alongside OTHER query params, in either order", () => {
    expect(parseBillingTabParam("?tab=invoices&from=email")).toBe("invoices");
    expect(parseBillingTabParam("?from=email&tab=invoices")).toBe("invoices");
    expect(parseBillingTabParam("?utm_source=x&tab=tax-forms&utm_medium=y")).toBe("tax-forms");
  });

  it("C6 DEFAULT PRESERVED: an absent param selects `referral`, exactly as useState did", () => {
    expect(BILLING_TAB_DEFAULT).toBe("referral");
    for (const s of ["", "?", "?from=email", "?tab=", "?tab"]) {
      expect(parseBillingTabParam(s), `${JSON.stringify(s)} must fall back`).toBe("referral");
    }
  });

  it("C7 UNKNOWN VALUE falls back to the default rather than rendering nothing", () => {
    /* Each of these is a real way a bad value arrives: a typo, a stale link from
     * an older build, a truncated share, a case mismatch, an injection attempt. */
    for (const bad of [
      "?tab=nonsense",
      "?tab=Referral",        // case matters to the union; must not half-match
      "?tab=invoice",         // singular — a plausible typo for `invoices`
      "?tab=spv_fees",        // underscore for the real hyphen
      "?tab=referral%20",     // trailing space
      "?tab=../../etc/passwd",
      "?tab=<script>",
    ]) {
      expect(parseBillingTabParam(bad), `${bad} must fall back to the default`).toBe("referral");
    }
  });

  it("C8 a repeated param takes the first value, and still validates it", () => {
    expect(parseBillingTabParam("?tab=invoices&tab=history")).toBe("invoices");
    expect(parseBillingTabParam("?tab=nonsense&tab=history")).toBe("referral");
  });
});

describe("W180 ITEM C — the state really is the URL, and Back really can undo it", () => {
  it("C9 the component reads the tab from the URL and no longer holds it in useState", () => {
    /* The regression this catches is a later edit reintroducing local state and
     * leaving the URL as decoration — the page would look fixed and deep links
     * would silently stop working again. */
    expect(src).toContain("const tab = parseBillingTabParam(search)");
    expect(src).toContain("const search = useSearch()");
    expect(src).not.toContain('useState<BillingTab>("referral")');
    expect(src).not.toMatch(/useState[^\n]*BillingTab/);
  });

  it("C10 BACK BUTTON: the tab change PUSHES a history entry, it does not replace one", () => {
    /* wouter's navigate() pushes by default and replaces only when passed
     * `{ replace: true }`. Replacing is precisely what leaves Back unable to
     * return to the previous tab, so the absence of that option on THIS call is
     * the assertion — a stronger one than observing a re-render. */
    const call = src.match(/navigate\(`\$\{pathname\}\?tab=\$\{next\}`[^)]*\)/);
    expect(call, "the tab setter must navigate to ?tab=<next>").toBeTruthy();
    expect(call![0]).not.toContain("replace");
    /* And the destination is the CURRENT path, not a hardcoded one: this page is
     * mounted at /collective/partner/billing, not at /partner/billing as its
     * filename suggests, so a literal path would navigate the reader away. */
    expect(call![0]).toContain("${pathname}");
    expect(src).not.toContain('navigate("/partner/billing');
  });

  it("C11 the wouter hooks the rest of this codebase uses are the ones imported here", () => {
    /* Item C's brief says to follow an existing convention rather than invent one.
     * The convention followed is investor/InvitationDetail.tsx: a validated union
     * list plus a parse function over useSearch(). */
    expect(src).toMatch(/import \{[^}]*useSearch[^}]*\} from "wouter"/);
    expect(src).toMatch(/import \{[^}]*useLocation[^}]*\} from "wouter"/);
    const sibling = fs.readFileSync(
      path.resolve(__dirname, "../pages/investor/InvitationDetail.tsx"),
      "utf8",
    );
    expect(sibling).toContain("useSearch");
    expect(sibling).toMatch(/new URLSearchParams/);
  });
});
