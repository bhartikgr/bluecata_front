import React from "react";
import { Skeleton } from "@/components/Skeleton";
import { usePublicPricing } from "@/lib/usePublicPricing";

/**
 * D2.5 Slice 2 — Dynamic public pricing.
 *
 * $840/year used to be hardcoded here (and in the deployed JS bundle) so an
 * admin change at /admin/pricing-models never reached this page. This
 * component now reads GET /api/pricing-public (via usePublicPricing) so
 * admin pricing changes auto-propagate to the public homepage without a
 * redeploy. On fetch failure it falls back to the last-known static values
 * and logs the failure with console.error (see usePublicPricing.ts).
 */
export default function PricingSection() {
  const { data: pricing, isLoading, isFallback } = usePublicPricing();
  const annual = pricing?.capavate_annual;
  const investors = pricing?.investors_free;
  const partners = pricing?.partners_custom;
  const asOf = pricing?.as_of;
  const annualDisplay = annual?.display ?? "$840/year per company";
  const annualAmount = annual?.price_minor != null && annual?.currency
    ? `${annual.currency === "USD" ? "$" : `${annual.currency} `}${Math.round(annual.price_minor / 100).toLocaleString()}`
    : "$840";

  return (
    <>
      <section className="pricing section" id="pricing">
        <div className="container">
          <div className="pricing__header reveal">
            <div className="eyebrow">
              <span className="eyebrow__dot"></span> Pricing
            </div>
            {isLoading ? (
              <Skeleton variant="title" className="h-8 w-4/5" />
            ) : (
              <h2 className="section-title">
                {annualDisplay} to activate a network <em>worth multiples more.</em>
              </h2>
            )}
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
                {isLoading ? (
                  <Skeleton variant="title" className="h-9 w-24" />
                ) : (
                  <span className="pricing__card-price">{annualAmount}</span>
                )}
                <span className="pricing__card-term">
                  /year · per company
                </span>
                <span className="pricing__card-annual">
                  Each additional company: {annualAmount}/year (per-company billing)
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
                href="https://capavate.com/onboarding"
                className="btn btn--primary btn--lg text-white"
              >
                Register Your Company
              </a>
            </div>
          </div>
          <div className="pricing__secondary reveal">
            <div className="pricing__secondary-card">
              <h4 className="pricing__secondary-name">For Investors</h4>
              {isLoading ? (
                <Skeleton variant="line" className="h-6 w-32" />
              ) : (
                <div className="pricing__secondary-price">{investors?.display ?? "Free. Always."}</div>
              )}
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
                href="https://capavate.com/onboarding?portal=investor"
                className="btn btn--ghost btn--sm"
              >
                Access Your Portfolio
              </a>
            </div>
            <div className="pricing__secondary-card">
              <h4 className="pricing__secondary-name">
                For Ecosystem Partners
              </h4>
              {isLoading ? (
                <Skeleton variant="line" className="h-6 w-32" />
              ) : (
                <div className="pricing__secondary-price">{partners?.display ?? "Custom pricing"}</div>
              )}
              <p className="pricing__secondary-desc">
                Volume onboarding, portfolio-wide management, and referral
                revenue. Pricing based on number of client companies.
              </p>
              <a href="https://capavate.com/apply/consortium" className="btn btn--ghost btn--sm">
                Become an Ecosystem Partner
              </a>
            </div>
          </div>
          {!isLoading && asOf ? (
            <p
              className="pricing__as-of"
              style={{ marginTop: "1rem", fontSize: "0.75rem", opacity: 0.6, textAlign: "center" }}
              data-testid="pricing-as-of"
            >
              Pricing effective {asOf.slice(0, 10)}
              {isFallback ? " (showing default pricing — live pricing temporarily unavailable)" : ""}
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}
