/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 236 — THE CORRECTED CREDIBILITY SECTION.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WHY A REPLACEMENT COMPONENT AND NOT TEXT INTERCEPTION.
 *
 * Four of this section's five defects are sentences, and sentences are corrected in
 * place by `w236MarketingClaimCorrections.ts`. The fifth is not a sentence: it is a
 * strip of three ANIMATED COUNTERS that count up from zero to `$8.4T`, `62%` and
 * `90%` on scroll (`home3compo/CredibilitySection.jsx:26`,
 * `targets = { aum: 8.4, deals: 62, intros: 90 }`).
 *
 * A counter cannot be corrected by replacing a text node, because there is no text
 * node to correct until `requestAnimationFrame` writes one, and it writes a new one
 * sixty times a second for two seconds. Intercepting that is a fight with an
 * animation frame that the animation wins. And the animation is itself part of the
 * claim: a number that counts up reads as a number somebody measured.
 *
 * So the frozen mount is retired in place behind an identifier flag in `Home.tsx`
 * (R195.5 — nothing deleted, the superseded literal stays byte-verbatim in its own
 * frozen file) and this corrected component is mounted **in its position**, keeping
 * the `<main>` child count and order unchanged.
 *
 * THE THREE MARKET FIGURES: REMOVED, NOT RESTATED.
 *
 * The owner's instruction allowed either outcome — cite precisely with the source
 * named on the page, or remove. Wave 236 removes all three, and the reasoning is
 * recorded here because it is the kind of decision a reader of this file will want
 * to second-guess:
 *
 *   `$8.4T global private equity AUM` — no source in the tree and no source found
 *   that states 8.4. The nearest real figures are close enough to show where 8.4
 *   probably came from and far enough to prove it was not read off anything:
 *   McKinsey put private markets AUM at $8.2T as at 30 June 2023, and Preqin put
 *   private equity AUM at $8.6T as at December 2024. Two different measures, two
 *   different dates, neither of them 8.4.
 *
 *   `62% of deals sourced via relationships` — traces to a single vendor blog. The
 *   same underlying founder survey is retold elsewhere as 31%, 20%, 10%, 58%, 70%,
 *   80% and 90% depending on who is quoting it. A figure with that spread is not a
 *   statistic, it is a rumour with a decimal point.
 *
 *   `90% of investor intros via warm network` — same provenance problem, and it is
 *   the same survey being cited a second time with a different number, on the same
 *   strip, as if it were independent corroboration.
 *
 * Nothing is substituted. R-ASSERT §14 forbids repairing an unsupported figure by
 * swapping in a different one, and the owner's instruction was explicit: never
 * invent, estimate or substitute a smaller number. Wave 236 also has no live
 * access, so it could not verify any replacement to the sentence level even if
 * substitution were permitted — and a marketing page that takes money is the last
 * place to print a number the engineer who printed it could not check.
 *
 * WHAT STANDS IN THEIR PLACE.
 *
 * The section keeps its header verbatim — "This isn't theoretical. / The market
 * demands it." — and the counters are replaced by the three layers the section
 * already names in its fourth card. The numbers rendered are `1`, `2`, `3`: an
 * ordinal count of the platform's own layers, which is a fact about this codebase
 * and needs no external source. The visual rhythm of the strip is preserved, the
 * message is preserved, and not one external statistic is asserted.
 *
 * THE FOUR CARDS, REFRAMED RATHER THAN BLANDED.
 *
 * "Similar message" is a binding constraint, so no card is deleted and no card is
 * softened into nothing. Each keeps its argument and states it as a mechanism:
 *
 *   "Verified Equity"  → "Issuer-Recorded Equity". The differentiator was never
 *   that Capavate checks a holding; it is that the holding comes from the company's
 *   own equity register instead of from a form the holder filled in. That is a
 *   stronger claim, and it is true.
 *
 *   "Accredited Only — limited to verified accredited investors" → "Accredited by
 *   Declaration". This was the most dangerous sentence on the site: it told a
 *   reader that somebody had checked their accreditation, and nobody had. It now
 *   records what actually happens — the investor declares it — and says so in the
 *   platform's established words: "This records your declaration. It is not a check
 *   of it." **No regulation is cited anywhere in this file.** Whether the offering
 *   posture is 506(b) or 506(c) is an open question for counsel, and a marketing
 *   page is not the place to answer it by implication.
 *
 * PROHIBITED VOCABULARY.
 *
 * No sentence in this file says verified, verification, verify, vetted, screened,
 * approved, certified, guaranteed or compliant about a person, a holding or an
 * eligibility. The word "accredited" survives only as the thing an investor
 * DECLARES, never as a status the platform confers or confirms.
 * ════════════════════════════════════════════════════════════════════════════
 */
import React from "react";

/**
 * The four cards.
 *
 * `title` replaces `cred-card__stat`, `body` replaces `cred-card__desc`. The class
 * names are kept exactly as the frozen component used them so the existing
 * `home3style.css` rules apply unchanged and the section is visually continuous
 * with the rest of the page.
 */
const W236_CREDIBILITY_CARDS: ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly body: React.ReactNode;
}> = [
  {
    id: "angel-network",
    title: "Capavate Angel Network",
    body:
      "A global syndication community of self-declared accredited investors \u2014 purpose-built for co-investment coordination, issuer-recorded deal flow, and the kind of investor-to-investor visibility that doesn\u2019t exist anywhere else.",
  },
  {
    id: "issuer-recorded-equity",
    title: "Issuer-Recorded Equity",
    body:
      "Every connection is anchored in the company\u2019s own equity register. No anonymous profiles, no self-reported ownership \u2014 auditable equity relationships that both sides can read from the same record.",
  },
  {
    id: "accredited-by-declaration",
    title: "Accredited by Declaration",
    body:
      "Platform access is limited to investors who declare they are accredited, and to registered companies. This records your declaration. It is not a check of it.",
  },
  {
    id: "three-layers",
    title: "3 Reinforcing Layers",
    body:
      "Issuer-recorded ownership, network intelligence, and equity communications \u2014 each layer makes the other two more valuable. Remove one, and the system breaks. That\u2019s what makes it irreplaceable.",
  },
];

/**
 * The strip that stands where the three animated market counters stood.
 *
 * `number` is an ordinal, not a measurement. Counting the platform's own layers is
 * something this wave can do from the codebase; counting the private-equity market
 * is not.
 */
const W236_LAYER_STRIP: ReadonlyArray<{
  readonly id: string;
  readonly number: string;
  readonly label: string;
}> = [
  { id: "layer-ownership", number: "1", label: "Ownership, from the register" },
  { id: "layer-network", number: "2", label: "Network intelligence" },
  { id: "layer-communications", number: "3", label: "Equity communications" },
];

/**
 * WAVE 236 — the corrected replacement for `home3compo/CredibilitySection.jsx`.
 *
 * Mounted by `Home.tsx` in the frozen component's position. No IntersectionObserver
 * and no `requestAnimationFrame`: there is no longer a number here worth animating,
 * which is the point.
 */
export default function W236CredibilitySection() {
  return (
    <section
      className="credibility section"
      data-testid="credibility-section"
      data-w236-corrected="credibility"
    >
      <div className="container">
        <div className="credibility__header reveal">
          <div className="eyebrow">
            <span className="eyebrow__dot"></span> Why Capavate
          </div>
          {/* Preserved verbatim from the frozen original. The header was never the
              defect and it carries the commercial message. */}
          <h2 className="section-title">
            This isn't theoretical.
            <br />
            <em>The market demands it.</em>
          </h2>
        </div>

        <div className="credibility__grid">
          {W236_CREDIBILITY_CARDS.map((card) => (
            <div
              className="cred-card reveal"
              key={card.id}
              data-testid={`credibility-card-${card.id}`}
            >
              <div className="cred-card__stat">{card.title}</div>
              <p className="cred-card__desc">{card.body}</p>
            </div>
          ))}
        </div>

        {/* The three layers, in place of the three market counters. */}
        <div className="credibility__stats reveal" data-testid="credibility-layers">
          {W236_LAYER_STRIP.map((layer, i) => (
            <React.Fragment key={layer.id}>
              {i > 0 ? <div className="cred-stat__divider"></div> : null}
              <div className="cred-stat" data-testid={`credibility-${layer.id}`}>
                <span className="cred-stat__number">{layer.number}</span>
                <span className="cred-stat__label">{layer.label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
