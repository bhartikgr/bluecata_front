
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

export default function Home() {
  return (
    <>
      <Header3 />
      <Hero />
      <AudiencesSection />
      <HowItWorks />
      <MultiplierSection />
      <DynamicCRM />
      <PlatformSection />
      <CredibilitySection />
      <PricingSection />
      <LearnSection />
      <FinalCTA />
      <Footer3 />
    </>
  )
}
