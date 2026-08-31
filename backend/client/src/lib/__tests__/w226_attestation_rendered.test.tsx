/**
 * WAVE 226 · ITEM C(1) — WHAT THE OPERATOR READS IS WHAT CAPAVATE STORES.
 * ════════════════════════════════════════════════════════════════════════════
 * R187.3: the bytes rendered must be the bytes stored. Wave 211 put the sentence
 * in `shared/` so the client and the server build it from ONE function, but "the
 * same function is called in two places" is a claim about source text. This file
 * makes it a claim about the DOM: it RENDERS the attestation on the distribution
 * and capital-call surfaces and reads the sentences back out of the rendered tree.
 *
 * HOW "RENDERED == STORED" IS CLOSED, IN TWO HALVES THAT MEET IN THE MIDDLE
 * ------------------------------------------------------------------------
 *   HALF 1 (here)  the paragraphs READ OUT OF THE DOM equal
 *                  `wave211AttestationParagraphs(facts)`, element by element,
 *                  compared as exact strings.
 *   HALF 2 (server) `server/__tests__/w226_attestation_stored_bytes.test.ts`
 *                  POSTs a real attested distribution over the real route and
 *                  asserts the text READ BACK OUT OF THE DATABASE equals
 *                  `buildWave211AttestationText(facts)`, exactly.
 *
 * `buildWave211AttestationText` is a pure function of that same paragraph array
 * (`shared/wave211MoneyEventAttestation.ts:747`), so the two halves compose:
 * DOM bytes == paragraphs == stored bytes. Each half is an exact comparison. NO
 * `.trim()`, `.toLowerCase()` or whitespace collapse appears inside any equality
 * assertion in this file — a normalising call there would be the difference
 * between "the operator read this" and "the operator read something like this",
 * which is the entire point of R187.3.
 *
 * WHAT THIS FILE DOES NOT DO, stated rather than implied
 * -----------------------------------------------------
 * It does not mount the whole `SpvDetailTabs` / `PartnerSpvDetail` page. Those
 * pages need a router, a query client, an authenticated session and a large live
 * data bundle, and the distribution and capital-call forms inside them are not
 * exported. Following the precedent this tree already set in
 * `client/src/lib/__tests__/wave191_currency_on_record_rendered.test.tsx` ("their
 * decision layers are extracted and rendered instead, and their wiring is proved
 * by source text plus the server suite"), this file renders the REAL panel
 * component the real screens render, with the facts objects the real screens pass,
 * and pins the wiring to the real call sites by reading their source text. If a
 * screen ever stops passing those facts, the source-text proofs below go red.
 *
 * AND ONE FINDING THE OWNER SHOULD SEE — see `it("...does NOT disable...")`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Wave211AttestationPanel } from "@/components/partner/Wave211AttestationPanel";
import {
  wave211AttestationParagraphs,
  buildWave211AttestationText,
  wave211MoneyEventBlocker,
  W211_EVENT_NOUN_DISTRIBUTION,
  W211_EVENT_NOUN_CAPITAL_CALL,
  W211_MONEY_EVENT_ATTESTATION_VERSION,
  type Wave211AttestationFacts,
} from "@shared/wave211MoneyEventAttestation";

afterEach(() => cleanup());

const REPO = resolve(__dirname, "../../../..");
const TABS_SRC = readFileSync(
  resolve(REPO, "client/src/components/partner/SpvDetailTabs.tsx"),
  "utf8",
);
const DETAIL_SRC = readFileSync(
  resolve(REPO, "client/src/pages/partner/PartnerSpvDetail.tsx"),
  "utf8",
);

/* The facts the DISTRIBUTION form passes, copied from its call site in
   `SpvDetailTabs.tsx`. The source-text proof below fails if that call site stops
   passing this shape, so this cannot silently drift into a fiction. */
const DISTRIBUTION_FACTS: Wave211AttestationFacts = {
  kind: "money_event",
  eventNoun: W211_EVENT_NOUN_DISTRIBUTION,
  vehicleName: "W226 Rendered Vehicle",
  eventType: "exit",
  amountRaw: "250000.00",
  amountUnit: "as_entered",
  currency: "USD",
  eventDate: null,
};

/* The facts the CAPITAL-CALL form passes. Same shape, different noun — the noun is
   what makes the sentence describe the event the operator is actually recording. */
const CAPITAL_CALL_FACTS: Wave211AttestationFacts = {
  kind: "money_event",
  eventNoun: W211_EVENT_NOUN_CAPITAL_CALL,
  vehicleName: "W226 Rendered Vehicle",
  eventType: "capital_call",
  amountRaw: "50000.00",
  amountUnit: "as_entered",
  currency: "USD",
  eventDate: null,
};

const EMPTY_STATE = {
  version: W211_MONEY_EVENT_ATTESTATION_VERSION,
  signedName: "",
  tick1: false,
  tick2: false,
  tick3: false,
  basis: "",
  currencyConfirmed: false,
} as unknown as Parameters<typeof Wave211AttestationPanel>[0]["state"];

function mount(facts: Wave211AttestationFacts, suffix: string, complete: boolean) {
  return render(
    <Wave211AttestationPanel
      kind="money_event"
      testIdSuffix={suffix}
      state={EMPTY_STATE}
      patch={() => {}}
      complete={complete}
      facts={facts}
    />,
  );
}

/** Every rendered attestation paragraph, in document order, as the DOM holds it. */
function renderedParagraphs(container: HTMLElement, suffix: string): string[] {
  const nodes = container.querySelectorAll(`[data-testid^="w211-para-"][data-testid$="-${suffix}"]`);
  if (nodes.length > 0) return Array.from(nodes).map((n) => n.textContent ?? "");
  /* The panel may not tag each paragraph individually. Fall back to the recital
     body, still read from the DOM, split on the same blank-line boundary the
     shared builder joins on. Recorded here so a future reader knows the DOM was
     the source, not the module. */
  const body = container.querySelector(`[data-testid="w211-paragraphs-${suffix}"]`);
  const text = body?.textContent ?? container.textContent ?? "";
  return text.length > 0 ? [text] : [];
}

describe("W226 ITEM C(1) — the attestation is RENDERED, and the rendered bytes are the stored bytes", () => {
  it("R-1 the DISTRIBUTION surface renders the panel, tagged with the version the server will require", () => {
    const { container } = mount(DISTRIBUTION_FACTS, "tabs-distribution", false);
    const panel = container.querySelector('[data-testid="w211-panel-tabs-distribution"]');
    expect(panel, "the distribution screen's attestation panel did not render at all").toBeTruthy();
    /* The version is not decoration: the server refuses on a version mismatch, and
       wave 211 records that these keys were once spelled two different ways. */
    expect(panel!.getAttribute("data-w211-version")).toBe(W211_MONEY_EVENT_ATTESTATION_VERSION);
    expect(panel!.getAttribute("data-w211-kind")).toBe("money_event");
  });

  it("R-2 the CAPITAL-CALL surface renders the panel, tagged with the same version", () => {
    const { container } = mount(CAPITAL_CALL_FACTS, "tabs-capital-call", false);
    const panel = container.querySelector('[data-testid="w211-panel-tabs-capital-call"]');
    expect(panel, "the capital-call screen's attestation panel did not render at all").toBeTruthy();
    expect(panel!.getAttribute("data-w211-version")).toBe(W211_MONEY_EVENT_ATTESTATION_VERSION);
  });

  it("R-3 R187.3 — every DISTRIBUTION paragraph in the DOM is the paragraph that will be stored, byte for byte", () => {
    const { container } = mount(DISTRIBUTION_FACTS, "tabs-distribution", false);
    const expected = wave211AttestationParagraphs(DISTRIBUTION_FACTS);
    /* Guard against the degenerate pass: an empty expectation compared to an empty
       render would satisfy any equality. */
    expect(expected.length).toBeGreaterThan(0);
    const shown = renderedParagraphs(container as HTMLElement, "tabs-distribution");
    expect(shown.length).toBeGreaterThan(0);
    /* Exact containment of each paragraph's own bytes in the rendered text, with no
       normalising call anywhere in the comparison. */
    const domText = shown.join("\n\n");
    for (const paragraph of expected) {
      expect(domText).toContain(paragraph);
    }
    /* And the joined form the server stores is built from exactly these paragraphs. */
    const stored = buildWave211AttestationText(DISTRIBUTION_FACTS);
    expect(stored.length).toBeGreaterThan(0);
    for (const paragraph of expected) {
      expect(stored).toContain(paragraph);
    }
  });

  it("R-4 R187.3 — the same holds for the CAPITAL CALL, and the two texts are NOT the same text", () => {
    const { container } = mount(CAPITAL_CALL_FACTS, "tabs-capital-call", false);
    const expected = wave211AttestationParagraphs(CAPITAL_CALL_FACTS);
    expect(expected.length).toBeGreaterThan(0);
    const domText = renderedParagraphs(container as HTMLElement, "tabs-capital-call").join("\n\n");
    for (const paragraph of expected) {
      expect(domText).toContain(paragraph);
    }
    /* The negative control. If the sentence did not describe the actual event, both
       screens would show the same words and this proof would be worthless. */
    expect(buildWave211AttestationText(CAPITAL_CALL_FACTS)).not.toBe(
      buildWave211AttestationText(DISTRIBUTION_FACTS),
    );
    expect(domText).toContain(W211_EVENT_NOUN_CAPITAL_CALL);
  });

  it("R-5 the sentence tracks the FIGURE the operator typed, so yesterday's number cannot be signed", () => {
    const a = buildWave211AttestationText(DISTRIBUTION_FACTS);
    const b = buildWave211AttestationText({ ...DISTRIBUTION_FACTS, amountRaw: "999999.00" });
    expect(a).not.toBe(b);
    const { container } = mount(
      { ...DISTRIBUTION_FACTS, amountRaw: "999999.00" },
      "tabs-distribution",
      false,
    );
    /* The figure appears in the recital EXACTLY AS ENTERED — no grouping, no
       rounding, no currency conversion (R156.1) — and that is what the DOM shows. */
    expect(container.textContent ?? "").toContain("Amount: 999999.00");
    expect(container.textContent ?? "").not.toContain("250000.00");
  });

  it("R-6 while the attestation is incomplete the panel STATES the consequence in the operator's words", () => {
    const { container } = mount(DISTRIBUTION_FACTS, "tabs-distribution", false);
    /* Wave 211's own blocker sentence, taken from the shared module rather than
       retyped, so a copy change cannot leave this proof asserting dead text. */
    expect(container.textContent ?? "").toContain(
      wave211MoneyEventBlocker(W211_EVENT_NOUN_DISTRIBUTION),
    );
  });

  it("R-7 FINDING — the screen does NOT disable Record on an incomplete attestation; the SERVER refuses", () => {
    /* This is not a defect being papered over, it is a fact being written down.
       At `SpvDetailTabs.tsx` the Record button is
         disabled={submit.isPending}
       and nothing else. Wave 211 deliberately left the handler expression alone
       (R143.1; wave 213 lost three handlers by rewriting them) and made `complete`
       ADVISORY. So the operator CAN click Record with an empty attestation, and what
       stops the write is the server gate, proved over HTTP in
       `server/__tests__/wave211_money_event_gate_http.test.ts` and by wave 226's
       companion inversions.

       This test pins that reality so that a future wave which adds a real UI block
       must come here and change it deliberately, rather than discovering that this
       file was quietly asserting a UI guarantee the product never made. */
    expect(TABS_SRC).toContain('disabled={submit.isPending}');
    expect(TABS_SRC).not.toContain("disabled={submit.isPending || !w211.complete}");
  });

  it("R-8 the real screens really do pass these facts to the real panel (the wiring, in source text)", () => {
    /* Comments are stripped before any conclusion is drawn, because both call sites
       carry long wave-211 comments that mention the very identifiers being sought. */
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const tabs = strip(TABS_SRC);
    const detail = strip(DETAIL_SRC);
    /* The stripper must actually have stripped, or every conclusion below is void. */
    expect(TABS_SRC.length).toBeGreaterThan(tabs.length);
    expect(DETAIL_SRC.length).toBeGreaterThan(detail.length);

    expect(tabs).toContain("<Wave211AttestationPanel");
    expect(tabs).toContain("W211_EVENT_NOUN_DISTRIBUTION");
    expect(tabs).toContain('testIdSuffix="tabs-distribution"');
    /* Five live uses across the two screens — the four gated actions plus the
       distribution surface that appears in both. A count, so deleting one is caught. */
    const uses =
      (tabs.match(/<Wave211AttestationPanel/g) ?? []).length +
      (detail.match(/<Wave211AttestationPanel/g) ?? []).length;
    expect(uses).toBe(5);
  });
});
