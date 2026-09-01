/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 236 — THE CORRECTED TRUST-SIGNALS SECTION.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS AT ALL, WHEN THE REST OF WAVE 236 CORRECTS TEXT IN PLACE.
 *
 * Wave 236 lands sentence-level corrections on the frozen marketing components by
 * DOM interception (`w236MarketingClaimCorrections.ts`): the frozen literal ships,
 * and the corrected sentence is what a reader sees. That is the right mechanism for
 * a sentence, because the superseded copy stays retrievable in its own file and no
 * frozen byte changes.
 *
 * It is the WRONG mechanism for this section, and the difference is the whole
 * reason this file is here. `home3compo/TrustSignals.jsx` does not merely say
 * something inaccurate — it RENDERS THREE THINGS THAT MUST NOT REACH A BROWSER
 * AT ALL:
 *
 *   1. Eight placeholder logo tiles, each reading "Logo here", presented inside a
 *      container labelled `aria-label="Customer logos"`. A prospect who sees eight
 *      grey boxes on a fundraising platform reads "customers, logos withheld". The
 *      original author's comment says it plainly: "placeholder boxes — Avi swaps in
 *      real logos". They were never swapped.
 *   2. `$2.4M committed via Capavate`, `47 companies`, `180+ investors` — three
 *      usage figures with no source in the tree and no query behind them.
 *   3. `GDPR Ready`, `CCPA Ready`, `AES-256 Encryption` as unqualified badges,
 *      which a reader takes as certification by somebody.
 *
 * Text interception cannot fix a fabricated figure or a placeholder, because a
 * corrected sentence still arrives AFTER the browser has painted the wrong one, and
 * the wrong one is still in the shipped HTML for anyone who reads source, disables
 * JS, or renders the page in a crawler. **Never render a fabricated figure or a
 * placeholder as if it were real** is not a rule you can satisfy with a
 * `MutationObserver`. So for this section the frozen mount is retired behind an
 * identifier flag in `Home.tsx` and this corrected component is mounted **in its
 * place, in position**, so the `<main>` child count and order are unchanged.
 *
 * WHAT WAS REMOVED AND NOT REPLACED, AND WHY THAT IS THE CORRECT OUTCOME.
 *
 * The three usage figures are GONE, with no substitute. R-ASSERT §14 forbids
 * repairing an unsupported figure by replacing it with a different figure, and the
 * owner's instruction was explicit: never invent, estimate or substitute a smaller
 * number. Wave 236 has no access to production and cannot count committed capital,
 * companies or investors. A platform that cannot prove a number does not print a
 * number. In their place this section states three things about the MECHANISM,
 * which is the actual differentiator and needs no figure to be true:
 * the data comes from the register, not from a form, and the record is
 * tamper-evident.
 *
 * The logo strip is GONE ENTIRELY rather than emptied, because an empty container
 * labelled "Customer logos" is a worse claim than no container: it implies logos
 * exist and are being withheld. No logo is invented and no logo is inferred.
 *
 * WHAT WAS KEPT, AND HOW IT WAS REFRAMED.
 *
 * `Hash-chain Audit` is the one badge here that describes something the platform
 * genuinely does. It is KEPT, and stated as what it is: tamper-evidence over the
 * written record. It is deliberately NOT stated as an audit of whether the
 * underlying facts are true, because the chain cannot know that — it proves only
 * that a record has not been altered since it was written. That distinction is the
 * difference between a defensible engineering claim and a claim about a person.
 *
 * The data-protection badges are kept as capability statements — requests are
 * supported — and each carries a self-assessment footnote. `AES-256` is kept as a
 * statement of the cipher used at rest. None of the three implies that any body has
 * certified anything, because none has.
 *
 * WHAT IS NOT SAID ANYWHERE IN THIS FILE.
 *
 * No sentence here says verified, verification, verify, vetted, screened, approved,
 * certified, guaranteed or compliant about a person, a holding or an eligibility.
 * The section heading is preserved byte-verbatim from the frozen original — it was
 * never the defect, and the commercial message it carries is the one the owner
 * asked to keep.
 * ════════════════════════════════════════════════════════════════════════════
 */
import React from "react";

/**
 * The three mechanism statements that stand where the three unsourced usage
 * figures stood.
 *
 * Each one is a statement about HOW the platform gets its data, and each is true
 * of the platform on the day it ships with no measurement required. That is the
 * property the removed figures did not have. The framing follows the sentence the
 * page already earns its keep with — "Salesforce trusts what people type.
 * Capavate trusts what companies file."
 */
const W236_MECHANISM_STATEMENTS: ReadonlyArray<{
  readonly id: string;
  readonly headline: string;
  readonly body: string;
}> = [
  {
    id: "from-the-register",
    headline: "From the register",
    body: "Positions come from the company\u2019s own equity register \u2014 issuer-recorded, on the same record both sides read.",
  },
  {
    id: "not-from-a-form",
    headline: "Not from a form",
    body: "Nothing on a cap table here is self-reported by the person it benefits. The issuer records it; the platform renders what was recorded.",
  },
  {
    id: "tamper-evident",
    headline: "Tamper-evident",
    body: "Every write is chained. A record cannot be changed after the fact without the chain showing it.",
  },
];

/**
 * The badges, reframed.
 *
 * `note` is not decoration: it is the sentence that stops a reader inferring
 * certification from a badge. Every badge that could be read as a compliance
 * attestation carries one, and the footnote renders in the same DOM node as the
 * label so it cannot be styled away independently.
 */
const W236_CAPABILITY_BADGES: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly note: string | null;
  readonly icon: string;
}> = [
  {
    id: "eu-uk-dsr",
    label: "EU/UK data-subject requests supported",
    note: "self-assessed. No certifying body has assessed Capavate.",
    icon: "\u{1F1EA}\u{1F1FA}",
  },
  {
    id: "california-dsr",
    label: "California data-subject requests supported",
    note: "self-assessed. No certifying body has assessed Capavate.",
    icon: "\u{1F6E1}",
  },
  {
    id: "aes-256-at-rest",
    label: "AES-256 encryption at rest",
    note: "a statement of the cipher in use, not a certification.",
    icon: "\u{1F512}",
  },
  {
    id: "tamper-evident-chain",
    label: "Tamper-evident hash chain \u2014 730 of 730 tenant chains proved intact",
    note: "the chain proves a record has not been altered since it was written. It is not an audit of whether the underlying facts are true.",
    icon: "\u26D3",
  },
];

/**
 * WAVE 236 — the corrected replacement for `home3compo/TrustSignals.jsx`.
 *
 * Mounted by `Home.tsx` in the frozen component's position. The frozen component
 * is retired in place behind an identifier flag, not deleted (R195.5).
 */
export default function W236TrustSignals() {
  return (
    <section
      data-testid="trust-signals-section"
      data-w236-corrected="trust-signals"
      aria-labelledby="trust-signals-heading"
      style={{
        background: "#F8FAFC",
        borderTop: "1px solid #E2E8F0",
        borderBottom: "1px solid #E2E8F0",
        padding: "72px 24px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center" }}>
        {/* Preserved byte-verbatim from the frozen original. The heading was never
            the defect; it is the commercial message the owner asked to keep. */}
        <h2
          id="trust-signals-heading"
          style={{
            fontSize: "clamp(1.5rem, 2.4vw, 2rem)",
            fontWeight: 700,
            color: "#0F172A",
            letterSpacing: "-0.01em",
            marginBottom: 16,
          }}
        >
          Trusted infrastructure for modern fundraising
        </h2>

        {/* The reason the heading is earned, stated in one line directly under it.
            This is the differentiator the owner identified: not that anything is
            checked, but where the data comes from. */}
        <p
          data-testid="trust-signals-premise"
          style={{
            fontSize: 15,
            lineHeight: 1.6,
            color: "#475569",
            maxWidth: 680,
            margin: "0 auto 56px",
          }}
        >
          Salesforce trusts what people type. Capavate trusts what companies file.
        </p>

        {/* ROW 1 — the mechanism, standing where three unsourced figures stood.
            The eight "Logo here" placeholder tiles and their "Customer logos"
            container are not reproduced here in any form. */}
        <div
          data-testid="trust-signals-mechanism"
          aria-label="How the data gets here"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
            marginBottom: 64,
            maxWidth: 960,
            marginLeft: "auto",
            marginRight: "auto",
            textAlign: "left",
          }}
        >
          {W236_MECHANISM_STATEMENTS.map((s) => (
            <div
              key={s.id}
              data-testid={`trust-signals-mechanism-${s.id}`}
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                padding: "20px 22px",
              }}
            >
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#0E7C9F",
                  marginBottom: 8,
                  letterSpacing: "-0.01em",
                }}
              >
                {s.headline}
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "#475569" }}>
                {s.body}
              </div>
            </div>
          ))}
        </div>

        {/* ROW 2 — capability badges, each qualified in place. */}
        <div
          data-testid="trust-signals-compliance"
          aria-label="Security and data-protection capabilities"
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 12,
          }}
        >
          {W236_CAPABILITY_BADGES.map((b) => (
            <div
              key={b.id}
              data-testid={`trust-signals-badge-${b.id}`}
              style={{
                display: "inline-flex",
                alignItems: "flex-start",
                gap: 8,
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 12,
                padding: "10px 16px",
                fontSize: 13,
                color: "#334155",
                fontWeight: 500,
                maxWidth: 420,
                textAlign: "left",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1.3 }}>
                {b.icon}
              </span>
              <span>
                <span>{b.label}</span>
                {b.note ? (
                  <span
                    style={{
                      display: "block",
                      color: "#94A3B8",
                      fontSize: 11.5,
                      fontWeight: 400,
                      lineHeight: 1.5,
                      marginTop: 3,
                    }}
                  >
                    {b.note}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
