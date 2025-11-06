import React from "react";
import AboutSection from "../components/Capavatehome/AboutSection";
import Header from "../components/Capavatehome/Header";
import HeroBanner from "../components/Capavatehome/HeroBanner";
import ServicesSection from "../components/Capavatehome/ServicesSection";
import Footer from "../components/Capavatehome/Footer";
import TestmoSection from "../components/Capavatehome/TestmoSection";
import WorkSection from "../components/Capavatehome/WorkSection";

export default function CapavateHome() {
  return (
    <>
      <Header />
      <HeroBanner />
      <AboutSection />
      <ServicesSection />
      <WorkSection />
      <TestmoSection />
      <Footer />
    </>
  );
}
