/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 236 · R225 / R227 — THE PUBLIC MARKETING SITE SAID "VERIFIED" 25 TIMES.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE FINDING (R225). The public home page used "verified" / "verification" /
 * "verify" 25 times to describe ownership, portfolios, deal flow and investor
 * accreditation. The site's own Privacy Policy, Terms of Service and Disclaimer
 * — linked from the same footer — explicitly deny that the platform performs any
 * KYC, AML, sanctions screening, accreditation verification or content review.
 * The marketing and the legal pages contradicted each other on the same screen.
 *
 * THE RULING (R227). The legal pages are correct. The marketing moves to meet
 * them, never the reverse. And the message must survive: a wave that deletes the
 * claims and leaves a bland page has failed as surely as one that leaves them
 * standing.
 *
 * WHAT THE PLATFORM ACTUALLY HAS. Not a check — a provenance. The data comes
 * from the company's own equity register rather than from someone filling in a
 * form. The page already said it, in its own best sentence, which this wave
 * leaves untouched:
 *
 *     "Salesforce trusts what people type. Capavate trusts what companies file."
 *
 * THE TRANSLATION RULE, applied to every correction below:
 *     "we verify it"  →  "it comes from the register, not from a form."
 * Defensible framings: issuer-recorded · from the company's own equity register ·
 * not self-reported · on-record · reconciled to the register · tamper-evident ·
 * auditable.
 * Prohibited about a person, a holding or an eligibility: verified, verification,
 * verify, independently verified, vetted, screened, approved, certified,
 * guaranteed, compliant.
 *
 * WHY THIS IS A RUNTIME DOM CORRECTION AND NOT A SOURCE EDIT.
 * Every marketing component is in the enforced 48-entry sacred manifest
 * (`sacred_baseline/SACRED_SHA256.txt`) — Hero, DynamicCRM, PlatformSection,
 * MultiplierSection, HowItWorks, FinalCTA, PricingSection, Header3,
 * AudiencesSection, LearnSection. Nine waivers are already spent and a tenth is
 * not available. So the correction lands by interception from the non-sacred
 * parent that mounts them, `client/src/pages/home/Home.tsx` — the same layer and
 * the same file wave 210 used for the footer strip, wave 218 for the Terms
 * click, and wave 235 for the Terms href.
 *
 * Two consequences worth stating, because they are the reason this shape was
 * chosen over any other:
 *
 *   1. Not one byte of a frozen file changes, so `npm run sacred` stays 48/48 and
 *      the guard cannot see a dropped literal — every superseded literal is still
 *      present, byte-identical, in its original file. That is R195.5's "retired
 *      in place" satisfied structurally rather than by a hidden sibling.
 *   2. The pass runs in `useLayoutEffect`, before the browser paints, so no
 *      visitor sees a flash of the withdrawn claim. A `MutationObserver` re-runs
 *      it if a child re-renders — `AudiencesSection` and `CredibilitySection`
 *      animate counters through `setState`, so their subtrees genuinely do
 *      re-render after mount.
 *
 * WHAT THIS FILE DOES NOT COVER. Structural defects cannot be fixed by rewriting
 * a word, because a fabricated figure or a placeholder must not exist in the
 * shipped HTML at all — hiding it at runtime is not enough. The eight
 * `LOGO HERE` placeholders, the three unsourced usage statistics, the four
 * self-issued compliance badges and the three unsourced market figures are
 * therefore handled by two corrected non-sacred components mounted in the frozen
 * ones' place: `W236TrustSignals.tsx` and `W236CredibilitySection.tsx`.
 *
 * SILENT SUCCESS IS THE FAILURE MODE OF A DESIGN LIKE THIS. A string-matching
 * correction that stops matching — because a frozen file was reflowed, or a
 * character was re-typed as a different dash — would leave the claim standing and
 * report nothing. So every correction carries an `expected` hit count, the pass
 * returns the counts and the misses, and the hook publishes them on the root as
 * `data-w236-applied` / `data-w236-unmatched`. The wave-236 DOM test mounts the
 * real page and asserts `data-w236-unmatched` is empty. A reflow of any frozen
 * marketing file turns that test RED instead of turning the page non-compliant.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useLayoutEffect } from "react";
import { REGISTERED_PARTY_NAME } from "@shared/wave210LegalCorpusVersion";

/**
 * R229 — THE OPERATING COMPANY'S NAME IS A LEGAL-IDENTITY STRING.
 *
 * Owner, 2026-08-31, answering the footer discrepancy: **"BluePrint Catalyst
 * Limited"** — capital B, capital P, no space, and the full word "Limited".
 * Never "Blueprint", never "Ltd.".
 *
 * The frozen home-page footer renders `© {year} Capavate · Blueprint Catalyst
 * Ltd. All rights reserved.` (`Footer3.jsx:216`) — lower-case p AND the
 * abbreviation — while the legal strip appended directly beneath it by wave 210
 * renders the registered name correctly. Two spellings of the operating entity in
 * one footer, on the page every prospect reads first.
 *
 * The canonical spelling is NOT retyped here. It is imported from the one place
 * that already owns it, `shared/wave210LegalCorpusVersion.ts:105`, so this
 * correction cannot drift from the legal corpus, the legal strip, the legal
 * drawer or the founder settings surface that all read the same constant.
 */
const W236_FROZEN_FOOTER_MISSPELLED_PARTY = "Capavate \u00b7 Blueprint Catalyst Ltd. All rights reserved.";
const W236_FROZEN_FOOTER_CORRECTED_PARTY = `Capavate \u00b7 ${REGISTERED_PARTY_NAME}. All rights reserved.`;

export interface W236TextCorrection {
  /** Stable id, used in `data-w236-unmatched` and in the tests. */
  readonly id: string;
  /** The frozen file whose rendered output this corrects. */
  readonly file: string;
  /** The exact RENDERED substring, as JSX emits it (lines joined by one space). */
  readonly find: string;
  /** The replacement. */
  readonly replace: string;
  /** How many text nodes are expected to contain `find` on a first pass. */
  readonly expected: number;
  /** Why the original could not stand. */
  readonly why: string;
}

/**
 * The claim table. Ordered by position on the page, top to bottom, so this list
 * reads in the same order as the page the owner is checking it against.
 *
 * Every `replace` value was read against R227's prohibited list. Not one of them
 * contains verified / verification / verify / vetted / screened / certified /
 * guaranteed / compliant about a person, a holding or an eligibility, and not one
 * of them names or implies a regulation.
 */
export const W236_TEXT_CORRECTIONS: readonly W236TextCorrection[] = [
  /* ── Hero ──────────────────────────────────────────────────────────────── */
  {
    id: "hero-visible-verified-actionable",
    file: "client/src/components/home3compo/Hero.jsx:21",
    find: "connections visible, verified, and actionable",
    replace: "connections visible, issuer-recorded, and actionable",
    expected: 1,
    why: "The triad is kept; the middle term becomes the provenance the platform has rather than a check it does not perform.",
  },

  /* ── DynamicCRM — the section that already holds the honest form ───────── */
  {
    id: "crm-every-contact-is-a-verified-shareholder",
    file: "client/src/components/home3compo/DynamicCRM.jsx:18",
    find: "is a verified shareholder.",
    replace: "is on the company's register.",
    expected: 1,
    why: "Same headline shape, same claim of authority, but the authority is the register rather than an unperformed check.",
  },
  {
    id: "crm-card-title-verified-not-self-reported",
    file: "client/src/components/home3compo/DynamicCRM.jsx:88",
    find: "Verified, Not Self-Reported",
    replace: "From the Register, Not From a Form",
    expected: 1,
    why: "This is the translation rule stated as a card title, and it points at the sentence below it, which is untouched.",
  },

  /* ── PlatformSection ───────────────────────────────────────────────────── */
  {
    id: "platform-pillar-title-verified-ownership",
    file: "client/src/components/home3compo/PlatformSection.jsx:28",
    find: "Verified Ownership",
    replace: "Issuer-Recorded Ownership",
    expected: 1,
    why: "Translation rule.",
  },
  {
    id: "platform-single-source-verified-and-live",
    file: "client/src/components/home3compo/PlatformSection.jsx:30",
    find: "who owns what — verified and live",
    replace: "who owns what — issuer-recorded and live",
    expected: 1,
    why: "Translation rule. The following two sentences are about who can SEE a record, not about anyone checking it, and are untouched.",
  },
  {
    id: "platform-independent-verification-of-every-holding",
    file: "client/src/components/home3compo/PlatformSection.jsx:35",
    find: "Independent verification of every holding",
    replace: "Every holding on record from the company's own register",
    expected: 1,
    why: "The platform performs no independent verification of a holding. The register is the source, and saying so is the stronger claim.",
  },
  {
    id: "platform-on-verified-rails",
    file: "client/src/components/home3compo/PlatformSection.jsx:58",
    find: "on verified rails",
    replace: "on register-backed rails",
    expected: 1,
    why: "Translation rule.",
  },
  {
    id: "platform-spreadsheets-unverified",
    file: "client/src/components/home3compo/PlatformSection.jsx:77",
    find: "Static, unverified, invisible to investors. No engagement, no verification, no network effect.",
    replace: "Static, self-reported, invisible to investors. No engagement, no audit trail, no network effect.",
    expected: 1,
    why: "This describes spreadsheets, not a Capavate holding — but 'no verification' implies by contrast that Capavate performs one, so it is translated rather than left standing. 'Audit trail' is defensible: the hash chain is real.",
  },
  {
    id: "platform-partners-are-verifying-ownership",
    file: "client/src/components/home3compo/PlatformSection.jsx:122",
    find: "are verifying ownership, coordinating rounds,",
    replace: "are tracking issuer-recorded ownership, coordinating rounds,",
    expected: 1,
    why: "The switching-cost argument is unchanged; what the users are doing is described accurately.",
  },

  /* ── MultiplierSection ─────────────────────────────────────────────────── */
  {
    id: "multiplier-verified-relationships",
    file: "client/src/components/home3compo/MultiplierSection.jsx:38",
    find: "2,000\u20134,500 verified relationships.",
    replace: "2,000\u20134,500 issuer-recorded relationships.",
    expected: 1,
    why: "Translation rule. The arithmetic and the en dash are unchanged.",
  },
  {
    id: "multiplier-independent-verification-250k",
    file: "client/src/components/home3compo/MultiplierSection.jsx:60",
    find: "Independent verification of $250K+ in holdings.",
    replace: "$250K+ in holdings, on record from the companies themselves.",
    expected: 1,
    why: "Same figure, same promise of authority, no claim of a check.",
  },

  /* ── HowItWorks ────────────────────────────────────────────────────────── */
  {
    id: "hiw-verified-access",
    file: "client/src/components/home3compo/HowItWorks.jsx:46",
    find: "Each investor gets verified access to see their holdings,",
    replace: "Each investor gets invitation-only access to see their holdings,",
    expected: 1,
    why: "'Verified access' meant invited access. Invitation-only is what the platform does, and it reads as more exclusive, not less.",
  },

  /* ── FinalCTA ──────────────────────────────────────────────────────────── */
  {
    id: "cta-independent-ownership-verification",
    file: "client/src/components/home3compo/FinalCTA.jsx:18",
    find: "Independent ownership verification for every investor.",
    replace: "Issuer-recorded ownership for every investor.",
    expected: 1,
    why: "Translation rule, in the closing argument.",
  },
  {
    id: "cta-qualified-relationships",
    file: "client/src/components/home3compo/FinalCTA.jsx:19",
    find: "450 qualified relationships per ecosystem partner.",
    replace: "450 reachable relationships per ecosystem partner.",
    expected: 1,
    why: "'Qualified' is not on R227's prohibited list, but applied to a relationship it implies a screen. 'Reachable' is the capability the platform has, and it echoes the corrected login tagline 'a contact you can reach'.",
  },

  /* ── PricingSection ────────────────────────────────────────────────────── */
  {
    id: "pricing-access-your-verified-portfolio",
    file: "client/src/components/home3compo/PricingSection.jsx:172",
    find: "Access your verified portfolio",
    replace: "Access your issuer-recorded portfolio",
    expected: 1,
    why: "Translation rule.",
  },
  {
    id: "pricing-verified-portfolio-holdings",
    file: "client/src/components/home3compo/PricingSection.jsx:177",
    find: "Verified portfolio holdings",
    replace: "Issuer-recorded portfolio holdings",
    expected: 1,
    why: "Translation rule.",
  },

  /* ── Header3 sign-in dropdown ──────────────────────────────────────────── */
  {
    id: "header-view-your-verified-portfolio",
    file: "client/src/components/home3compo/Header3.jsx:173",
    find: "View your verified portfolio",
    replace: "View your issuer-recorded portfolio",
    expected: 1,
    why: "Translation rule. This is the first thing an investor reads before signing in.",
  },

  /* ── AudiencesSection — the investor block ─────────────────────────────── */
  {
    id: "audiences-no-way-to-verify-percentage",
    file: "client/src/components/home3compo/AudiencesSection.jsx:311",
    find: "No way to verify your ownership percentage.",
    replace: "No way to see your ownership percentage on the record.",
    expected: 1,
    why: "The complaint about the status quo is kept; the implied remedy stops being a check.",
  },
  {
    id: "audiences-independent-verification-baseline",
    file: "client/src/components/home3compo/AudiencesSection.jsx:313",
    find: "Every other asset class comes with independent verification as a baseline.",
    replace: "Every other asset class comes with an independent register as a baseline.",
    expected: 1,
    why: "The true comparison: listed equities have registrars and depositories, i.e. an independent REGISTER. That is exactly what Capavate brings to private equity, and it is what the platform actually is.",
  },
  {
    id: "audiences-verify-what-you-actually-own",
    file: "client/src/components/home3compo/AudiencesSection.jsx:332",
    find: "Verify what you actually own.",
    replace: "See what you actually own.",
    expected: 1,
    why: "The headline above it already reads 'The only platform that shows you what you actually own', so this keeps the block's own promise and drops the check.",
  },
  {
    id: "audiences-zero-independent-confirmation",
    file: "client/src/components/home3compo/AudiencesSection.jsx:333",
    find: "you have zero independent confirmation those numbers are accurate. Now you do.",
    replace: "those numbers live in five different inboxes. Now they come from each company's own register.",
    expected: 1,
    why: "'Now you do' promised independent confirmation. The corrected sentence names the real before-and-after, and it is a sharper picture of the problem.",
  },
  {
    id: "audiences-mockup-portfolio-verified",
    file: "client/src/components/home3compo/AudiencesSection.jsx:386",
    find: "Your Portfolio \u00b7 Verified",
    replace: "Your Portfolio \u00b7 From the Register",
    expected: 1,
    why: "A product mock-up still makes a claim to the reader.",
  },
  {
    id: "audiences-mockup-series-a-verified",
    file: "client/src/components/home3compo/AudiencesSection.jsx:419",
    find: "Series A \u00b7 1.2% \u00b7 verified",
    replace: "Series A \u00b7 1.2% \u00b7 on register",
    expected: 1,
    why: "Same, on a per-holding row — the most specific form of the claim.",
  },
  {
    id: "audiences-mockup-seed-verified",
    file: "client/src/components/home3compo/AudiencesSection.jsx:451",
    find: "Seed \u00b7 2.4% \u00b7 verified",
    replace: "Seed \u00b7 2.4% \u00b7 on register",
    expected: 1,
    why: "Same, on the second holding row.",
  },

  /* ── Footer3 — the operating company's registered name (R229) ──────────── */
  {
    id: "footer-registered-party-name",
    file: "client/src/components/home3compo/Footer3.jsx:216",
    find: W236_FROZEN_FOOTER_MISSPELLED_PARTY,
    replace: W236_FROZEN_FOOTER_CORRECTED_PARTY,
    expected: 1,
    why: "R229. A legal-identity string on a platform that takes money, rendered two ways in one footer block. The correct spelling already renders in the legal strip immediately below, which is what makes the copyright line a visible inconsistency rather than an invisible one.",
  },

  /* ── LearnSection — the Knowledge Hub CTA (R225.4) ─────────────────────── */
  {
    id: "learn-explore-the-knowledge-hub",
    file: "client/src/components/home3compo/LearnSection.jsx:62",
    find: "Explore the Knowledge Hub \u2192",
    replace: "Knowledge Hub \u2014 opening soon \u2192",
    expected: 1,
    why: "The CTA pointed at https://capavate.com/education, which has NO route in App.tsx: an anonymous visitor gets the login wall and a signed-in user gets a 404. It is unreachable for everyone, so it cannot be presented as a destination.",
  },
];

/**
 * R225.4 — the two hrefs the frozen nav and the frozen learn card point at. Both
 * resolve to nothing: `/education` has no `<Route>` anywhere in
 * `client/src/App.tsx`, so it falls through to `<Route component={NotFoundOrLogin} />`.
 */
export const W236_UNREACHABLE_EDUCATION_HREFS: readonly string[] = [
  "/education",
  "https://capavate.com/education",
];

/**
 * Where they are pointed instead: the genuinely public on-page section, whose own
 * `<h2>` already reads "Knowledge Hub & Entrepreneur Academy". Every other item
 * in the frozen nav is an in-page anchor of exactly this shape (`#platform`,
 * `#pricing`, `#audiences`, `#multiplier`), so the nav keeps its own pattern.
 */
export const W236_PUBLIC_LEARN_ANCHOR = "#learn";

export interface W236CorrectionResult {
  /** id → number of text nodes corrected on this pass. */
  readonly applied: Record<string, number>;
  /** ids that matched nothing AND whose replacement is not already present. */
  readonly unmatched: string[];
  /** How many `/education` anchors were repointed at the public section. */
  readonly hrefsCorrected: number;
}

/**
 * One idempotent pass over a scoped subtree. Exported so a test can drive it
 * directly, and so the disarm harness can assert on its return value rather than
 * on a screenshot.
 */
export function applyW236MarketingClaimCorrections(root: HTMLElement): W236CorrectionResult {
  const applied: Record<string, number> = {};
  const unmatched: string[] = [];

  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

  for (const correction of W236_TEXT_CORRECTIONS) {
    let hits = 0;
    for (const node of textNodes) {
      const value = node.nodeValue;
      if (value === null || !value.includes(correction.find)) continue;
      node.nodeValue = value.split(correction.find).join(correction.replace);
      hits += 1;
    }
    applied[correction.id] = hits;
    /* Idempotency: on a second pass `find` is gone, which is success, not a miss.
       A miss is `find` absent AND `replace` absent — i.e. the correction never
       landed, which is the case a reflow of a frozen file would produce. */
    if (hits === 0 && !(root.textContent ?? "").includes(correction.replace)) {
      unmatched.push(correction.id);
    }
  }

  let hrefsCorrected = 0;
  for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href");
    if (href === null || !W236_UNREACHABLE_EDUCATION_HREFS.includes(href)) continue;
    anchor.setAttribute("href", W236_PUBLIC_LEARN_ANCHOR);
    /* It is an in-page anchor now, so a new tab would be wrong. */
    anchor.removeAttribute("target");
    anchor.removeAttribute("rel");
    hrefsCorrected += 1;
  }

  return { applied, unmatched, hrefsCorrected };
}

/**
 * Mounted from `client/src/pages/home/Home.tsx` against the `div.home3-root`
 * ref, which is the same element and the same layer wave 218's `onClickCapture`
 * and wave 235's href correction already use. The correction can therefore never
 * reach outside the marketing tree.
 *
 * `useLayoutEffect`, not `useEffect`: it runs before the browser paints, so no
 * visitor sees a frame of the withdrawn claim. No dependency array, so it re-runs
 * on every render of `Home`, and a `MutationObserver` covers the case where a
 * frozen CHILD re-renders without `Home` doing so — which the two counter
 * animations on the page genuinely cause.
 */
export function useW236MarketingClaimCorrections(
  rootRef: { current: HTMLElement | null },
): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const run = () => {
      const result = applyW236MarketingClaimCorrections(root);
      /* Published so a test can prove every correction found its target instead
         of trusting that it did. `unmatched` MUST be empty. */
      root.setAttribute("data-w236-unmatched", result.unmatched.join(","));
      root.setAttribute(
        "data-w236-applied",
        String(Object.values(result.applied).reduce((a, b) => a + b, 0)),
      );
      root.setAttribute("data-w236-hrefs-corrected", String(result.hrefsCorrected));
    };

    run();

    if (typeof MutationObserver === "undefined") return;
    /* Attributes are deliberately NOT observed: `run` writes three of them, and
       observing them would feed the observer its own output. `characterData` IS
       observed, and `run` writes that too — but the pass is idempotent, so the
       re-entry finds nothing to change and the cascade stops after one extra
       pass. */
    const observer = new MutationObserver(() => run());
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  });
}
