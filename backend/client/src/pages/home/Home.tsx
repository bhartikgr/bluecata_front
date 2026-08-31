
import React from 'react'
import './home3style.css';
import Header3 from "../../components/home3compo/Header3";
import Footer3 from "../../components/home3compo/Footer3";
/* WAVE 210 — Footer3.jsx is SACRED (BASE entry, enforced 48-file list) and its
 * "Terms" link points at the privacy policy while its copyright line misspells
 * the registered party name. Neither can be corrected in that file without a
 * tenth waiver, which is not available. This strip is the non-sacred
 * interception: it is APPENDED below the frozen footer and adds the first
 * working public link to the Terms of Service plus the correct party name. The
 * frozen footer's own defects remain and are reported as unfixed. */
import { PublicLegalStrip } from "../../components/PublicLegalStrip";
/* WAVE 218 — the frozen footer's "Terms" anchor points at `/privacy-policy`
 * (`Footer3.jsx:209`). `Footer3.jsx` is SACRED and a tenth waiver is not
 * available, so the click is intercepted from here — the non-sacred parent that
 * mounts it — in the same layer wave 210 used for the entity name in that same
 * file. The handler is scoped to `div.home3-root` below, so it can only ever see
 * clicks inside the marketing tree, and it matches exactly one anchor. Read the
 * header of the imported module before changing either. */
import { useFrozenFooterTermsInterception } from "../../components/FrozenFooterTermsInterception";
import Hero from "../../components/home3compo/Hero";
import AudiencesSection from "../../components/home3compo/AudiencesSection";
import HowItWorks from "../../components/home3compo/HowItWorks";
import MultiplierSection from "../../components/home3compo/MultiplierSection";
import DynamicCRM from "../../components/home3compo/DynamicCRM";
import PlatformSection from "../../components/home3compo/PlatformSection";
import CredibilitySection from "../../components/home3compo/CredibilitySection";
import PricingSection from "../../components/home3compo/PricingSection";
import LearnSection from "../../components/home3compo/LearnSection";
import FinalCTA from "../../components/home3compo/FinalCTA";
import TrustSignals from "../../components/home3compo/TrustSignals";

export default function Home() {
  const interceptFrozenFooterTermsLink = useFrozenFooterTermsInterception();
  return (
    /* WAVE 0 · H-1 — the scope for the marketing button reset.
       `home3style.css` used to reset `border` on EVERY button on the platform
       because it is emitted into the one global stylesheet. The reset is now
       `.home3-root button { border: none }`, and this wrapper is its only
       anchor. Presentation only: a plain <div> with no styling of its own, no
       route change, no handler, no reordering — the marketing tree keeps its
       exact order and every component keeps its exact position. Removing this
       class silently restores the platform-wide bug, so do not remove it. */
    <div className="home3-root" onClickCapture={interceptFrozenFooterTermsLink}>
      <Header3 />
      {/* Wave E Fix E5/E6 — explicit <main id="main-content"> landmark.
          Pairs with the skip-to-content link in Header3 and gives SRs a primary region. */}
      <main id="main-content" role="main">
        <Hero />
        {/* Wave G Track 2 — G6: Trust signals (between hero and audiences/pricing) */}
        <TrustSignals />
        <AudiencesSection />
        <HowItWorks />
        <MultiplierSection />
        <DynamicCRM />
        <PlatformSection />
        <CredibilitySection />
        <PricingSection />
        <LearnSection />
        <FinalCTA />
      </main>
      <Footer3 />
      <PublicLegalStrip />
    </div>
  )
}
