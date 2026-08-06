import React from "react";
import useScrollReveal from "./useScrollReveal";
import { Skeleton } from "@/components/Skeleton";
import { usePublicPricing } from "@/lib/usePublicPricing";

/**
 * D2.5 Slice 2 — Dynamic public pricing.
 * The Global Entrepreneur Academy's $1,500 one-time price used to be
 * hardcoded here. Now reads GET /api/pricing-public via usePublicPricing so
 * an admin edit to the Academy pricing model auto-propagates. Falls back to
 * the static $1,500 value (logged via console.error) on fetch failure.
 */
export default function LearnSection() {
  useScrollReveal();
  const { data: pricing, isLoading } = usePublicPricing();
  const academy = pricing?.academy_one_time;
  const academyAmount = academy?.price_minor != null && academy?.currency
    ? `${academy.currency === "USD" ? "$" : `${academy.currency} `}${Math.round(academy.price_minor / 100).toLocaleString()}`
    : "$1,500";
  return (
    <>
      {" "}
      <section className="learn section" id="learn">
        <div className="container">
          <div className="learn__header js-reveal" style={{ '--reveal-delay': '0s' }}>
            <div className="eyebrow">
              <span className="eyebrow__dot"></span> Learn &amp; Grow
            </div>
            <h2 className="section-title">
              Knowledge Hub
              <br />
              <em>&amp; Entrepreneur Academy</em>
            </h2>
            <p className="section-sub">
              Whether you're an ecosystem partner learning to leverage the
              network, a founder preparing for your first raise, or an investor
              building portfolio discipline — we've built the curriculum.
            </p>
          </div>
          <div className="learn__split">
            <div className="learn__card js-reveal" style={{ '--reveal-delay': '0.1s' }}>
              <div className="learn__card-badge learn__card-badge--free">
                Included Free
              </div>
              <h3 className="learn__card-title">Knowledge Hub</h3>
              <p className="learn__card-desc">
                A growing library of guides, playbooks, and case studies on
                investor relations, equity communication, and M&amp;A
                preparation.
              </p>
              <ul className="learn__card-features">
                <li>Investor relations best practices</li>
                <li>Equity management guides</li>
                <li>M&amp;A readiness checklists</li>
                <li>Ecosystem partner playbooks</li>
              </ul>
              <a
                href="https://capavate.com/education"
                target="_blank"
                className="btn btn--ghost"
              >
                Explore the Knowledge Hub →
              </a>
            </div>
            <div className="learn__card learn__card--featured js-reveal" style={{ '--reveal-delay': '0.2s' }}>
              <div className="learn__card-badge learn__card-badge--premium">
                Premium Programme
              </div>
              <h3 className="learn__card-title">Global Entrepreneur Academy</h3>
              <p className="learn__card-desc">
                An intensive programme that takes founders from idea to
                investment-ready — with live mentorship from Capavate Angel
                Network members.
              </p>
              <ul className="learn__card-features">
                <li>12-week structured curriculum</li>
                <li>Live mentorship sessions</li>
                <li>Pitch preparation &amp; review</li>
                <li>Direct access to angel investors</li>
              </ul>
              <div className="learn__card-price">
                {isLoading ? (
                  <Skeleton variant="line" className="h-7 w-20" />
                ) : (
                  <span className="learn__card-amount">{academyAmount}</span>
                )}
                <span className="learn__card-term">one-time investment</span>
              </div>
              <a
                href="https://capavate.com/onboarding"
                className="btn btn--primary text-white"
              >
                Apply Now →
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
