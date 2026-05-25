import React from "react";

export default function PricingSection() {
  return (
    <>
      <section className="pricing section" id="pricing">
        <div className="container">
          <div className="pricing__header reveal">
            <div className="eyebrow">
              <span className="eyebrow__dot"></span> Pricing
            </div>
            <h2 className="section-title">
              $840/year per company to activate a network <em>worth multiples more.</em>
            </h2>
            <p className="section-sub">
              One plan for companies, billed annually. Free for every investor
              they bring. Custom pricing for ecosystem partners who want to
              scale it across their entire client base.
            </p>
          </div>
          <div className="pricing__card reveal">
            <div className="pricing__card-header">
              <div>
                <h3 className="pricing__card-name">Capavate Platform</h3>
                <p className="pricing__card-desc">
                  Full access to the equity social network, investor CRM, and
                  communication tools.
                </p>
              </div>
              <div className="pricing__card-price-wrap">
                <span className="pricing__card-price">$840</span>
                <span className="pricing__card-term">
                  /year · per company
                </span>
                <span className="pricing__card-annual">
                  Each additional company: $840/year (per-company billing)
                </span>
              </div>
            </div>
            <div className="pricing__card-features">
              <div className="pricing__feature-col">
                <div className="pricing__feature">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="3"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>{" "}
                  Company profile &amp; equity register
                </div>
                <div className="pricing__feature">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="3"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>{" "}
                  Investor CRM &amp; tracking
                </div>
                <div className="pricing__feature">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="3"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>{" "}
                  Network intelligence alerts
                </div>
              </div>
              <div className="pricing__feature-col">
                <div className="pricing__feature">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="3"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>{" "}
                  Equity communications
                </div>
                <div className="pricing__feature">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="3"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>{" "}
                  Document sharing
                </div>
                <div className="pricing__feature">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--color-success)"
                    strokeWidth="3"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>{" "}
                  Knowledge Hub access
                </div>
              </div>
            </div>
            <div className="pricing__card-actions">
              <a
                href="https://capavate.com/#/onboarding"
                className="btn btn--primary btn--lg text-white"
              >
                Register Your Company
              </a>
            </div>
          </div>
          <div className="pricing__secondary reveal">
            <div className="pricing__secondary-card">
              <h4 className="pricing__secondary-name">For Investors</h4>
              <div className="pricing__secondary-price">Free. Always.</div>
              <p className="pricing__secondary-desc">
                Access your verified portfolio, see co-investors, and track
                every holding — at no cost. Investors are invited by their
                companies.
              </p>
              <ul className="pricing__secondary-features">
                <li>Verified portfolio holdings</li>
                <li>Co-investor visibility</li>
                <li>Real-time round updates</li>
              </ul>
              <a
                href="https://capavate.com/#/onboarding?portal=investor"
                className="btn btn--ghost btn--sm"
              >
                Access Your Portfolio
              </a>
            </div>
            <div className="pricing__secondary-card">
              <h4 className="pricing__secondary-name">
                For Ecosystem Partners
              </h4>
              <div className="pricing__secondary-price">Custom pricing</div>
              <p className="pricing__secondary-desc">
                Volume onboarding, portfolio-wide management, and referral
                revenue. Pricing based on number of client companies.
              </p>
              <a href="https://capavate.com/#/apply/consortium" className="btn btn--ghost btn--sm">
                Become an Ecosystem Partner
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
