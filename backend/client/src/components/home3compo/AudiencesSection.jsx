import React, { useEffect, useRef, useState, useCallback } from "react";
import useScrollReveal from "./useScrollReveal";

function AudiencesSection() {
  useScrollReveal();
  const [companyCounts, setCompanyCounts] = useState({
    direct: 0,
    second: 0,
    overlap: 0,
    signals: 0,
  });
  const [investorCounts, setInvestorCounts] = useState({
    companies: 0,
    investors: 0,
    clusters: 0,
    events: 0,
  });
  const [partnerCounts, setPartnerCounts] = useState({
    clients: 0,
    surfaced: 0,
    overlaps: 0,
    signals: 0,
  });
  const companyRef = useRef(null);
  const investorRef = useRef(null);
  const partnerRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            if (entry.target === companyRef.current) {
              animateCounters(15, 128, 7, 3, setCompanyCounts);
            } else if (entry.target === investorRef.current) {
              animateCounters(5, 240, 12, 2, (vals) =>
                setInvestorCounts({
                  companies: vals[0],
                  investors: vals[1],
                  clusters: vals[2],
                  events: vals[3],
                }),
              );
            } else if (entry.target === partnerRef.current) {
              animateCounters(30, 412, 24, 6, (vals) =>
                setPartnerCounts({
                  clients: vals[0],
                  surfaced: vals[1],
                  overlaps: vals[2],
                  signals: vals[3],
                }),
              );
            }
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 },
    );

    if (companyRef.current) observer.observe(companyRef.current);
    if (investorRef.current) observer.observe(investorRef.current);
    if (partnerRef.current) observer.observe(partnerRef.current);

    return () => observer.disconnect();
  }, []);

  const animateCounters = (target1, target2, target3, target4, setter) => {
    const duration = 2000;
    const startTime = performance.now();
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setter({
        direct: Math.floor(target1 * eased),
        second: Math.floor(target2 * eased),
        overlap: Math.floor(target3 * eased),
        signals: Math.floor(target4 * eased),
      });
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  };
  return (
    <>
      <section className="audiences section" id="audiences">
        <div className="container">
          <div className="audiences__transition js-reveal" style={{ '--reveal-delay': '0s' }}>
            <div className="audiences__transition-line"></div>
            <div className="eyebrow eyebrow--lg">
              <span className="eyebrow__dot"></span> Who It's For
            </div>
            <h2 className="section-title">
              A different promise <em>for each side of the table.</em>
            </h2>
            <p className="section-sub">
              Three audiences. Three undeniable reasons Capavate stops being
              optional the moment you understand what you're leaving on the
              table without it.
            </p>
          </div>

          {/* For Companies */}
          <div className="audience audience--companies js-reveal" style={{ '--reveal-delay': '0.1s' }} ref={companyRef}>
            <div className="audience__inner">
              <div>
                <span className="audience__label audience__label--prominent">
                  For Companies
                </span>
                <h3 className="audience__headline">
                  Your competitors' investors are coordinating.{" "}
                  <em>Are yours?</em>
                </h3>
                <p className="audience__edge">
                  Most founders treat their investor register as a filing
                  obligation. The ones pulling ahead treat it as their most
                  underleveraged asset — a network of capital, expertise, and
                  customers that compounds every quarter. Without Capavate,
                  you're activating maybe 2 of 15 investors. The rest is dead
                  capital.
                </p>
                <div className="audience__points">
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>75–150 warm introductions sitting idle.</strong>{" "}
                      Your investors' networks overlap with your customers,
                      partners, and next-round leads. Capavate surfaces every
                      path. Automatically.
                    </div>
                  </div>
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>Updates that trigger follow-on capital.</strong>{" "}
                      One broadcast hits every shareholder. You see who opened
                      it, who engaged, and who's ready to re-invest. BCC chains
                      can't do this.
                    </div>
                  </div>
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>Governance signal that attracts capital.</strong>{" "}
                      Founders on Capavate signal maturity. Investors notice.
                      The platform you use is now part of the due diligence
                      conversation.
                    </div>
                  </div>
                </div>
              </div>
              <div className="audience__visual">
                <div className="audience__mockup">
                  <div className="audience__mockup-header">
                    <div>
                      <div className="audience__mockup-title">
                        Investor Network Reach
                      </div>
                      <div className="audience__mockup-sub">TechCo · Live</div>
                    </div>
                    <span className="audience__mockup-badge">Activated</span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <span
                        className="audience__mockup-row-dot"
                        style={{ background: "#CC0001" }}
                      ></span>
                      <span>Direct investors</span>
                    </div>
                    <span className="audience__mockup-row-val">
                      {companyCounts.direct}
                    </span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <span
                        className="audience__mockup-row-dot"
                        style={{ background: "#D4850A" }}
                      ></span>
                      <span>2nd-degree connections</span>
                    </div>
                    <span className="audience__mockup-row-val">
                      {companyCounts.second}
                    </span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <span
                        className="audience__mockup-row-dot"
                        style={{ background: "#2D8B4E" }}
                      ></span>
                      <span>Co-invest overlap</span>
                    </div>
                    <span className="audience__mockup-row-val">
                      {companyCounts.overlap}
                    </span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <span
                        className="audience__mockup-row-dot"
                        style={{ background: "#6FCF97" }}
                      ></span>
                      <span>Follow-on signals</span>
                    </div>
                    <span className="audience__mockup-row-val">
                      {companyCounts.signals}
                    </span>
                  </div>
                  <div className="audience__mockup-footer">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    3 investors overlap with <strong>GreenTech Holdings</strong>{" "}
                    — warm intro available
                  </div>
                </div>
              </div>
            </div>
            <div className="audience__bottom-grid">
              <div className="audience__pitch">
                <div className="audience__pitch-label">
                  The question every founder should ask
                </div>
                <p className="audience__pitch-q">
                  “If your competitor's investors are coordinating on
                  introductions and co-investments, and yours aren't even
                  receiving the same update —{" "}
                  <em>how long before the gap shows?</em>”
                </p>
              </div>
              <div className="audience__losing">
                <strong>What you're losing without this:</strong> You have
                investors who could be referring customers, making intros, and
                co-leading your next round — willingly. Every month without
                Capavate is a month of compounding value you'll never recover.
              </div>
            </div>
            <div className="audience__cta-row">
              <a
                href="#/onboarding"
                className="btn btn--primary text-white"
              >
                Register Your Company
              </a>
              <span className="audience__cta-note">
                14-day free trial · No credit card required
              </span>
            </div>
          </div>

          {/* For Investors */}
          <div
            className="audience audience--investors audience--reverse js-reveal"
            style={{ '--reveal-delay': '0.2s' }}
            ref={investorRef}
          >
            <div className="audience__inner">
              <div>
                <span className="audience__label audience__label--prominent">
                  For Investors
                </span>
                <h3 className="audience__headline">
                  The only platform that shows you{" "}
                  <em>what you actually own.</em>
                </h3>
                <p className="audience__edge">
                  After you write a check, you enter a black box. No independent
                  registry. No way to verify your ownership percentage. No
                  visibility on who else is on the register. Every other asset
                  class comes with independent verification as a baseline.
                  Private company equity doesn't. Capavate is the first platform
                  that changes that.
                </p>
                <div className="audience__points">
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>Verify what you actually own.</strong> You
                      deployed $250K across five deals. Without Capavate, you
                      have zero independent confirmation those numbers are
                      accurate. Now you do.
                    </div>
                  </div>
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>See your co-investors. Coordinate.</strong> You
                      don't know who else is on the register. Capavate surfaces
                      co-investors across every deal so you can align on rounds,
                      intros, and governance.
                    </div>
                  </div>
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>
                        Transparency that every other asset class already has.
                      </strong>{" "}
                      Stocks have filings. Real estate has title search. Private
                      equity has nothing. Until Capavate.
                    </div>
                  </div>
                </div>
              </div>
              <div className="audience__visual">
                <div className="audience__mockup">
                  <div className="audience__mockup-header">
                    <div>
                      <div className="audience__mockup-title">
                        Your Portfolio · Verified
                      </div>
                      <div className="audience__mockup-sub">
                        {investorCounts.companies} companies · $
                        {investorCounts.investors}K deployed
                      </div>
                    </div>
                    <span className="audience__mockup-badge">Live</span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <div
                        className="mockup__cap-avatar"
                        style={{
                          width: "24px",
                          height: "24px",
                          fontSize: "9px",
                          background: "linear-gradient(135deg,#041E41,#0C2D55)",
                        }}
                      >
                        TC
                      </div>
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "white",
                            fontSize: "12px",
                          }}
                        >
                          TechCo Ltd
                        </div>
                        <div className="audience__mockup-row-meta">
                          Series A · 1.2% · verified
                        </div>
                      </div>
                    </div>
                    <span className="audience__mockup-row-val">
                      ${investorCounts.investors * 20}
                    </span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <div
                        className="mockup__cap-avatar"
                        style={{
                          width: "24px",
                          height: "24px",
                          fontSize: "9px",
                          background: "linear-gradient(135deg,#D4850A,#F5A623)",
                        }}
                      >
                        GE
                      </div>
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            color: "white",
                            fontSize: "12px",
                          }}
                        >
                          GreenEnergy Inc
                        </div>
                        <div className="audience__mockup-row-meta">
                          Seed · 2.4% · verified
                        </div>
                      </div>
                    </div>
                    <span className="audience__mockup-row-val">
                      ${investorCounts.investors * 16}
                    </span>
                  </div>
                  <div className="audience__mockup-footer">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {investorCounts.clusters} co-investors overlap across{" "}
                    <strong>TechCo &amp; GreenEnergy.</strong> Coordinate the
                    next round?
                  </div>
                </div>
              </div>
            </div>
            <div className="audience__bottom-grid">
              <div className="audience__pitch">
                <div className="audience__pitch-label">
                  The question every investor should ask
                </div>
                <p className="audience__pitch-q">
                  “You wouldn't complete a real estate transaction without an
                  independent title search.{" "}
                  <em>Why is $50,000 in equity any different?</em>”
                </p>
              </div>
              <div className="audience__losing">
                <strong>What you're losing without this:</strong> You're relying
                entirely on the founders you backed to tell you what you own. No
                mechanism to coordinate with co-investors, track your position
                across a portfolio, or get ahead of governance issues before
                they become disputes. Capavate is the infrastructure the private
                market never built for angels.
              </div>
            </div>
            <div className="audience__cta-row">
              <a
                href="https://capavate.com/onboarding"
                className="btn btn--primary text-white"
              >
                Access Your Portfolio
              </a>
              <span className="audience__cta-note">
                Free for all investors · Invitation via company
              </span>
            </div>
          </div>

          {/* For Ecosystem Partners */}
          <div
            className="audience audience--partners js-reveal"
            style={{ '--reveal-delay': '0.3s' }}
            id="ecosystem"
            ref={partnerRef}
          >
            <div className="audience__inner">
              <div>
                <span className="audience__label audience__label--prominent">
                  For Ecosystem Partners
                </span>
                <h3 className="audience__headline">
                  Behind your 30 clients are 450 investors{" "}
                  <em>you've never met.</em>
                </h3>
                <p className="audience__edge">
                  Your firm manages equity structures for founders. But behind
                  every founder is a register of investors — each with their own
                  accounting, legal, compliance, and investment needs. With 30
                  clients averaging 15 investors each, that's 450 qualified,
                  warm-adjacent relationships sitting inside your existing book
                  of business. Capavate surfaces them, with consent, and
                  positions your firm as the first to reach them.
                </p>
                <div className="audience__points">
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>450 qualified leads you already have.</strong> 30
                      clients × 15 investors = 450 people who need your
                      services. 5% conversion = 22 new engagements. Zero cold
                      outreach.
                    </div>
                  </div>
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>A new billable service line.</strong> Equity
                      communication and register management — packaged,
                      recurring, and the reason founders consolidate with your
                      firm.
                    </div>
                  </div>
                  <div className="audience__point">
                    <span className="audience__point-icon">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <div>
                      <strong>First movers lock in the network.</strong> The
                      firm that surfaces these investor connections first owns
                      them. Referral fees for every company you onboard. Your
                      competitors don't have this yet.
                    </div>
                  </div>
                </div>
              </div>
              <div className="audience__visual">
                <div className="audience__mockup">
                  <div className="audience__mockup-header">
                    <div>
                      <div className="audience__mockup-title">
                        Firm Portfolio View
                      </div>
                      <div className="audience__mockup-sub">
                        Partner dashboard · Live
                      </div>
                    </div>
                    <span className="audience__mockup-badge">
                      {partnerCounts.clients} clients
                    </span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <span
                        className="audience__mockup-row-dot"
                        style={{ background: "#CC0001" }}
                      ></span>
                      <span>Client companies</span>
                    </div>
                    <span className="audience__mockup-row-val">
                      {partnerCounts.clients}
                    </span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <span
                        className="audience__mockup-row-dot"
                        style={{ background: "#D4850A" }}
                      ></span>
                      <span>Investors surfaced</span>
                    </div>
                    <span className="audience__mockup-row-val">
                      {partnerCounts.surfaced}
                    </span>
                  </div>
                  <div className="audience__mockup-row">
                    <div className="audience__mockup-row-name">
                      <span
                        className="audience__mockup-row-dot"
                        style={{ background: "#2D8B4E" }}
                      ></span>
                      <span>Overlap clusters</span>
                    </div>
                    <span className="audience__mockup-row-val">
                      {partnerCounts.overlaps}
                    </span>
                  </div>
                  <div className="audience__mockup-footer">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <strong>{partnerCounts.signals} investors</strong> active
                    across 3 client portfolios — introduction recommended.
                  </div>
                </div>
              </div>
            </div>
            <div className="audience__bottom-grid">
              <div className="audience__pitch">
                <div className="audience__pitch-label">
                  The question every partner should ask
                </div>
                <p className="audience__pitch-q">
                  “Behind every client you have today is a network of investors
                  who need accounting, legal, and advisory services — and have
                  no relationship with your firm.{" "}
                  <em>How long are you going to leave that on the table?</em>”
                </p>
              </div>
              <div className="audience__losing">
                <strong>What you're losing without this:</strong> Every month
                you don't have visibility into your clients' investor registers,
                those relationships are forming elsewhere — with other advisors,
                other firms who get there first. The firms that solve it early
                will have a compounding advantage over the ones that don't.
              </div>
            </div>
            <div className="audience__cta-row">
              <a href="#cta-final" className="btn btn--primary text-white">
                Become an Ecosystem Partner
              </a>
              <span className="audience__cta-note">
                Accounting, legal, incubator, angel network &amp; fund
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

export default AudiencesSection;
