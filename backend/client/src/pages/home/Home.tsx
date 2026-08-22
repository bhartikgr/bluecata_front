
import React from 'react'
import './home3style.css';
import Header3 from "../../components/home3compo/Header3";
import Footer3 from "../../components/home3compo/Footer3";
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
  return (
    /* WAVE 0 · H-1 — the scope for the marketing button reset.
       `home3style.css` used to reset `border` on EVERY button on the platform
       because it is emitted into the one global stylesheet. The reset is now
       `.home3-root button { border: none }`, and this wrapper is its only
       anchor. Presentation only: a plain <div> with no styling of its own, no
       route change, no handler, no reordering — the marketing tree keeps its
       exact order and every component keeps its exact position. Removing this
       class silently restores the platform-wide bug, so do not remove it. */
    <div className="home3-root">
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
    </div>
  )
}
