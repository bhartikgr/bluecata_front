/**
 * WAVE 274b · R221.4 — THE LEGAL PANELS RENDER MARKDOWN, NOT HASH MARKS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT, AS THE OWNER SAW IT
 * -------------------------------
 * `"## 5. SPV Formation & Administration"` and
 * `"## 4. Eligibility, Licensing & Regulatory Compliance"` reached the screen with
 * their hash marks inside the capital-call, distribution, LP-invite and commit
 * confirmation panels. R221.4: "the attestations the audit called genuinely
 * best-in-class legal candor are presented as an unstyled string dump."
 *
 * THE CONSTRAINT THAT DECIDES WHAT THIS FILE MUST ASSERT
 * -----------------------------------------------------
 * The quote is SLICED out of the signed Consortium Partner Agreement at render
 * time (R197.4). Editing the words would break that binding. So the only lawful
 * change is presentational, and the assertion that has to hold is:
 *
 *     split.marker + <the DOM textContent> === <the sliced source>
 *
 * byte for byte. There is **NO normalising call inside any equality assertion in
 * this file** — no `.trim()`, no `.toLowerCase()`, no whitespace collapse, on
 * either side of any `toBe`. R200: wave 212 shipped a green test that was blind to
 * its own subject because a helper called `.trim()`. The bytes are the subject.
 *
 * WHY THE COMPARISON CANNOT GO VACUOUSLY GREEN — five inert-proof mechanisms
 * closed explicitly
 * -------------------------------------------------------------------------
 *  1. **Not a replica.** It renders the REAL `Wave211AttestationPanel` — the exact
 *     component `PartnerSpvDetail.tsx` and `SpvDetailTabs.tsx` mount — with the
 *     real `wave211AgreementSection` slicer, not a fixture string.
 *  2. **The fixture cannot be moved, so the source is read live.** The subject of
 *     every comparison is `wave211AgreementSection(marker)` called in the test, and
 *     `CONSORTIUM_AGREEMENT_TEXT` itself. If the agreement changes, both sides
 *     change together and the invariant still has to hold.
 *  3. **The mutation-sensitivity test below proves the comparison is live**: a
 *     one-character whitespace nudge of the rendered text is asserted NOT to be
 *     contained in the agreement. A whitespace-collapsing comparison would pass
 *     that and therefore prove nothing.
 *  4. **The DOM query is scoped** to the rendered container via `within`, never to
 *     a global `document.querySelector`.
 *  5. **The predicate is not unconditionally true**: `expect(text).not.toContain("## ")`
 *     is asserted to FAIL against the unrendered source in the same test, so the
 *     absence of hash marks is a fact about the screen and not about the matcher.
 *
 * WHAT IS PROVED BY SOURCE TEXT RATHER THAN BY MOUNTING THE WHOLE PAGE
 * -------------------------------------------------------------------
 * Following the precedent this tree set in
 * `client/src/lib/__tests__/w226_attestation_rendered.test.tsx` (same panel, same
 * reason: the pages need a router, a session and a large live bundle, and the four
 * forms inside them are not exported), the wiring to the four real surfaces is
 * pinned by reading the mount sites' source text. If a screen stops mounting this
 * panel, those proofs go red.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Wave211AttestationPanel } from "@/components/partner/Wave211AttestationPanel";
import {
  wave211AgreementSection,
  wave211CpaMarkerFor,
  W211_CPA_MARKER_MONEY_EVENT,
  W211_CPA_MARKER_ELIGIBILITY,
  W211_EVENT_NOUN_DISTRIBUTION,
  W211_EVENT_NOUN_CAPITAL_CALL,
  type Wave211AttestationFacts,
  type Wave211AttestationKind,
} from "@shared/wave211MoneyEventAttestation";
import { CONSORTIUM_AGREEMENT_TEXT } from "@shared/consortiumAgreement";
import {
  wave274bSplitAtxHeading,
  wave274bReassembleAtxHeading,
  wave274bRenderedText,
} from "@shared/wave274bAtxHeading";

afterEach(() => cleanup());

const REPO = resolve(__dirname, "../../../../..");
const src = (rel: string) => readFileSync(resolve(REPO, rel), "utf8");

/* ── The facts each real surface passes, in the shape the real call sites use ── */

/* The DISTRIBUTION / CAPITAL-CALL shape, copied from the call site in
   `SpvDetailTabs.tsx` (the same shape `w226_attestation_rendered.test.tsx` uses). */
const MONEY_EVENT_FACTS: Wave211AttestationFacts = {
  kind: "money_event",
  eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
  vehicleName: "W274b Rendered Vehicle",
  eventType: "exit",
  amountRaw: "250000.00",
  amountUnit: "as_entered",
  currency: "USD",
  eventDate: null,
};

const CAPITAL_CALL_FACTS: Wave211AttestationFacts = {
  kind: "money_event",
  eventNoun: W211_EVENT_NOUN_CAPITAL_CALL,
  vehicleName: "W274b Rendered Vehicle",
  eventType: "capital_call",
  amountRaw: "50000.00",
  amountUnit: "as_entered",
  currency: "USD",
  eventDate: null,
};

const LP_INVITE_FACTS: Wave211AttestationFacts = {
  kind: "lp_invitation",
  partnerName: "W274b Partner",
  vehicleName: "W274b Rendered Vehicle",
  inviteeEmail: "lp@example.test",
};

const LP_COMMIT_FACTS: Wave211AttestationFacts = {
  kind: "lp_commitment",
  partnerName: "W274b Partner",
  vehicleName: "W274b Rendered Vehicle",
  investorEmail: "lp@example.test",
  amountRaw: "25000.00",
  amountUnit: "as_entered",
  currency: "USD",
};

const EMPTY_STATE = {
  signedName: "",
  tick1: false,
  tick2: false,
  tick3: false,
  basis: "",
  currencyConfirmed: false,
} as unknown as Parameters<typeof Wave211AttestationPanel>[0]["state"];

function mount(facts: Wave211AttestationFacts, suffix: string) {
  return render(
    <Wave211AttestationPanel
      kind={facts.kind}
      testIdSuffix={suffix}
      state={EMPTY_STATE}
      patch={() => {}}
      complete={false}
      facts={facts}
    />,
  );
}

/**
 * All FOUR surfaces the ruling names — capital call, distribution, LP invite and
 * commit confirmation — with the marker each one quotes. The two money-event rows
 * are the capital-call and distribution panels; they share a `kind` but not a
 * `facts` object, and both are mounted so neither is proved by proxy.
 */
const SURFACES: Array<{
  label: string;
  facts: Wave211AttestationFacts;
  kind: Wave211AttestationKind;
  marker: string;
}> = [
  { label: "distribution", facts: MONEY_EVENT_FACTS, kind: "money_event", marker: W211_CPA_MARKER_MONEY_EVENT },
  { label: "capital-call", facts: CAPITAL_CALL_FACTS, kind: "money_event", marker: W211_CPA_MARKER_MONEY_EVENT },
  { label: "lp-invite", facts: LP_INVITE_FACTS, kind: "lp_invitation", marker: W211_CPA_MARKER_ELIGIBILITY },
  { label: "lp-commit", facts: LP_COMMIT_FACTS, kind: "lp_commitment", marker: W211_CPA_MARKER_ELIGIBILITY },
];

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 1 — the lossless split. The invariant, over the real document.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W274b §1 — wave274bSplitAtxHeading is LOSSLESS", () => {
  it("reassembly returns the input bytes exactly, for every section of the signed agreement", () => {
    /* Every `## ` heading in the real document, not a chosen sample. */
    const markers = CONSORTIUM_AGREEMENT_TEXT.split("\n")
      .filter((l) => l.startsWith("## "))
      .map((l) => l);
    expect(markers.length).toBeGreaterThanOrEqual(14);
    for (const heading of markers) {
      const sliced = wave211AgreementSection(heading);
      expect(sliced, heading).not.toBeNull();
      const split = wave274bSplitAtxHeading(sliced!);
      // NO NORMALISATION on either side.
      expect(wave274bReassembleAtxHeading(split)).toBe(sliced!);
      expect(split.hasHeading).toBe(true);
      expect(split.marker).toBe("## ");
      expect(split.level).toBe(2);
      expect(split.heading.startsWith("#")).toBe(false);
    }
  });

  /**
   * WHY THIS LIST CONTAINS WHITESPACE-BEARING CASES — A GREEN DISARM I HAD TO FIX.
   *
   * The first version of this suite had an invariant test that a `.trim()` planted
   * inside the splitter could NOT detect. The reason is instructive: every `## `
   * heading in the real Consortium Partner Agreement has no leading or trailing
   * whitespace, and `wave211AgreementSection` already trims the whole slice, so a
   * normalising call is a NO-OP on the only input the DOM tests ever supply. The
   * disarm came back GREEN on the invariant and was caught only by the separate
   * source-text ban. A proof that depends on a second, source-text proof to notice
   * a violation is not a proof of the bytes.
   *
   * The cases below therefore carry whitespace in every position a normaliser would
   * touch: after the marker, at the end of the heading line, at the start of the
   * body, at the end of the body, and a whitespace-only heading. Re-running the
   * `.trim()` disarm against THIS list goes red on the invariant itself.
   * Transcript: `build_log/wave274b/W274b_TESTS.md` § disarm 2.
   */
  it("is lossless for inputs that are NOT headings, and for edge shapes", () => {
    for (const s of [
      "",
      "no heading here",
      "no heading\nbut two lines",
      "#nospace is not a heading",
      "####### seven hashes is not a heading",
      "## trailing newline\n",
      "\n",
      "## a\n## b",
      "  ## indented is not an ATX heading",
      /* WHITESPACE-BEARING — these are the cases a normalising call fails. */
      "##  two spaces after the marker\nbody",
      "## heading with trailing spaces   \nbody",
      "## heading\n   body with leading spaces",
      "## heading\nbody with trailing spaces   ",
      "## \nan empty heading is still lossless",
      "## \t tab after the marker\nbody",
      "## heading\n\nblank line then body",
      "##   ",
    ]) {
      expect(wave274bReassembleAtxHeading(wave274bSplitAtxHeading(s))).toBe(s);
    }
    /* And spelled out, so the sensitivity is visible rather than implied: the
       heading and body come back with their whitespace intact. */
    const ws = wave274bSplitAtxHeading("##  spaced heading   \n   spaced body   ");
    expect(ws.heading).toBe(" spaced heading   ");
    expect(ws.body).toBe("   spaced body   ");
    expect(ws.marker).toBe("## ");
    expect(ws.separator).toBe("\n");
    expect(wave274bSplitAtxHeading("#nospace is not a heading").hasHeading).toBe(false);
    expect(wave274bSplitAtxHeading("####### seven").hasHeading).toBe(false);
    expect(wave274bSplitAtxHeading("  ## indented").hasHeading).toBe(false);
    expect(wave274bSplitAtxHeading("# one").level).toBe(1);
    expect(wave274bSplitAtxHeading("###### six").level).toBe(6);
  });

  it("the marker is the ONLY thing wave274bRenderedText drops", () => {
    const sliced = wave211AgreementSection(W211_CPA_MARKER_MONEY_EVENT)!;
    const split = wave274bSplitAtxHeading(sliced);
    expect(split.marker + wave274bRenderedText(split)).toBe(sliced);
    expect(split.marker).toBe("## ");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 2 — the DOM. The real panel, the real slicer, byte-exact.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W274b §2 — the rendered quote is byte-identical to the slice, minus the marker", () => {
  for (const { label, facts, kind, marker } of SURFACES) {
    it(`[${label}] marker + rendered textContent === the sliced source, exactly`, () => {
      const { container } = mount(facts, label);
      const pre = within(container).getByTestId("w211-agreement-quote-text");
      const rendered = pre.textContent!;

      const sliced = wave211AgreementSection(wave211CpaMarkerFor(kind))!;
      expect(sliced).not.toBeNull();
      /* `marker` here is the CPA SECTION marker ("## 5." / "## 4.") — it includes
         the section number, which IS part of the rendered heading. The ATX marker
         that leaves the screen is only the hash run plus its space. Keeping the
         two distinct is not pedantry: the first version of this test concatenated
         the CPA marker and produced "## 5.5. SPV Formation…", i.e. it would have
         gone red for a reason that had nothing to do with the change. */
      const atx = wave274bSplitAtxHeading(sliced).marker;
      expect(atx).toBe("## ");
      expect(sliced.startsWith(marker)).toBe(true);

      /* THE assertion of this file. No normalisation on either side. If a single
         byte of whitespace, casing or punctuation changed anywhere in the quote,
         this fails. */
      expect(atx + rendered).toBe(sliced);

      /* And the whole thing is still a verbatim substring of the executed
         instrument — i.e. the screen is not a second version of the agreement. */
      expect(CONSORTIUM_AGREEMENT_TEXT.includes(atx + rendered)).toBe(true);
      expect(rendered.length).toBeGreaterThan(200);
      /* The section number survived onto the screen — only the hashes went. */
      expect(rendered.startsWith(marker.slice(atx.length))).toBe(true);
    });

    it(`[${label}] the hash marks are GONE from the screen, and that claim is not vacuous`, () => {
      const { container } = mount(facts, label);
      const rendered = within(container).getByTestId("w211-agreement-quote-text").textContent!;
      const sliced = wave211AgreementSection(wave211CpaMarkerFor(kind))!;

      // The screen has no ATX marker anywhere in the quote.
      expect(rendered.includes("## ")).toBe(false);
      expect(rendered.startsWith("#")).toBe(false);

      // NOT VACUOUS: the same predicate applied to the unrendered source is TRUE,
      // so this is a fact about the screen, not about the matcher.
      expect(sliced.includes("## ")).toBe(true);
      expect(sliced.startsWith("## ")).toBe(true);
    });

    it(`[${label}] the heading line is a real heading element carrying the heading TEXT`, () => {
      const { container } = mount(facts, label);
      const heading = within(container).getByTestId("w211-agreement-quote-section-heading");
      const sliced = wave211AgreementSection(wave211CpaMarkerFor(kind))!;
      const split = wave274bSplitAtxHeading(sliced);

      expect(heading.textContent).toBe(split.heading);
      expect(heading.tagName).toBe("STRONG");
      // It is emphasised — the presentational half of the fix.
      expect(heading.className).toContain("font-semibold");
      // And it is the first line of the section, with the marker removed.
      expect(split.marker + heading.textContent!).toBe(sliced.split("\n")[0]);
    });

    it(`[${label}] the body after the heading is a contiguous verbatim substring`, () => {
      const { container } = mount(facts, label);
      const rendered = within(container).getByTestId("w211-agreement-quote-text").textContent!;
      const sliced = wave211AgreementSection(wave211CpaMarkerFor(kind))!;
      const split = wave274bSplitAtxHeading(sliced);

      expect(split.body.length).toBeGreaterThan(100);
      expect(CONSORTIUM_AGREEMENT_TEXT.includes(split.body)).toBe(true);
      expect(rendered.endsWith(split.body)).toBe(true);
      // The newline between heading and body survived, so the shape is preserved.
      expect(rendered).toBe(split.heading + "\n" + split.body);
    });
  }

  it("the containment comparison is NOT blind: one whitespace character breaks it", () => {
    const { container } = mount(MONEY_EVENT_FACTS, "distribution");
    const rendered = within(container).getByTestId("w211-agreement-quote-text").textContent!;
    const nudged = rendered.replace(" ", "  ");
    expect(nudged).not.toBe(rendered);
    expect(CONSORTIUM_AGREEMENT_TEXT.includes("## " + nudged)).toBe(false);
    // ...while the un-nudged reassembly IS contained, so the test is live.
    expect(CONSORTIUM_AGREEMENT_TEXT.includes("## " + rendered)).toBe(true);
  });

  it("the <pre> still wraps, so the preserved newlines are readable rather than one long line", () => {
    const { container } = mount(MONEY_EVENT_FACTS, "distribution");
    const pre = within(container).getByTestId("w211-agreement-quote-text");
    expect(pre.tagName).toBe("PRE");
    expect(pre.className).toContain("whitespace-pre-wrap");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 3 — R195.5 / R221.6: nothing was dropped from this panel.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W274b §3 — NO-DROP: everything the panel rendered before still renders", () => {
  for (const { label, facts } of SURFACES) {
    it(`[${label}] the quote heading, the quote and the full-agreement link all survive`, () => {
      const { container } = mount(facts, label);
      const w = within(container);
      expect(w.getByTestId("w211-agreement-quote")).toBeTruthy();
      expect(w.getByTestId("w211-agreement-quote-heading").textContent!.length).toBeGreaterThan(10);
      expect(w.getByTestId("w211-agreement-quote-text")).toBeTruthy();
      const link = w.getByTestId("w211-agreement-quote-link") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe("/collective/partner/agreement");
      expect(link.textContent!.length).toBeGreaterThan(10);
      // The unavailable fallback is NOT shown when a quote exists.
      expect(w.queryByTestId("w211-agreement-quote-unavailable")).toBeNull();
    });
  }

  it("the panel still does NOT disable its submit path (a disabled button is not a control)", () => {
    const { container } = mount(MONEY_EVENT_FACTS, "distribution");
    const disabled = container.querySelectorAll("button[disabled]");
    expect(disabled.length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 4 — the wiring to the four real surfaces, pinned by source text.
   ════════════════════════════════════════════════════════════════════════════ */

describe("W274b §4 — the four real surfaces still mount THIS panel", () => {
  it("PartnerSpvDetail and SpvDetailTabs both mount Wave211AttestationPanel", () => {
    const detail = src("client/src/pages/partner/PartnerSpvDetail.tsx");
    const tabs = src("client/src/components/partner/SpvDetailTabs.tsx");
    expect(detail.includes("Wave211AttestationPanel")).toBe(true);
    expect(tabs.includes("Wave211AttestationPanel")).toBe(true);
    // Three mount sites, matching the count recorded in the wave-274 handoff.
    const mounts =
      (detail.match(/<Wave211AttestationPanel/g) ?? []).length +
      (tabs.match(/<Wave211AttestationPanel/g) ?? []).length;
    expect(mounts).toBeGreaterThanOrEqual(3);
  });

  it("the panel imports the shared splitter and no local re-implementation of it", () => {
    const panel = src("client/src/components/partner/Wave211AttestationPanel.tsx");
    expect(panel.includes('from "@shared/wave274bAtxHeading"')).toBe(true);
    // No second slicer, no regex on "##" living in the component.
    expect(panel.includes('indexOf("## ")')).toBe(false);
    expect(panel.includes("replace(/^#")).toBe(false);
  });

  it("the splitter module contains NO normalising call at all", () => {
    const mod = src("shared/wave274bAtxHeading.ts");
    const code = mod.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Prove the stripper stripped: the header prose is gone from `code`.
    expect(mod.includes("PRESENTATION ONLY")).toBe(true);
    expect(code.includes("PRESENTATION ONLY")).toBe(false);
    for (const banned of [".trim(", ".toLowerCase(", ".toUpperCase(", ".normalize(", "replace(/\\s"]) {
      expect(code.includes(banned), banned).toBe(false);
    }
  });
});
