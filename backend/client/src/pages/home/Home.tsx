
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
    <>
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
    </>
  )
}
