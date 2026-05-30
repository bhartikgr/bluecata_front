import React from "react";

export default function Hero() {
  return (
    <>
      <section className="hero">
        <div className="hero__inner">
          <div className="hero__content">
            <div className="eyebrow">
              <span className="eyebrow__dot"></span>
              The Equity Social Network
            </div>
            <h1 className="hero__headline">
              Your investors are more connected <em>than you think.</em>
            </h1>
            <p className="hero__sub">
              Every investor on your register knows other founders, other
              investors, and potential customers — but none of them can see each
              other.{" "}
              <strong>
                Capavate makes those connections visible, verified, and
                actionable.
              </strong>{" "}
              One platform turns a static list of names into a live network that
              compounds with every company that joins.
            </p>
            <div className="hero__ctas">
              <a
                href="/onboarding"
                className="btn btn--primary btn--lg text-white"
              >
                Register Your Company
              </a>
              <a href="#ecosystem" className="btn btn--ghost btn--lg">
                Become an Ecosystem Partner
              </a>
            </div>
            <a
              href="https://capavate.com/onboarding"
              className="hero__investor-link"
            >
              Investor? Access your portfolio →
            </a>
          </div>

          <div className="hero__visual">
            <div className="mockup">
              <div className="mockup__network">
                <div className="mockup__network-header">
                  <div>
                    <div className="mockup__network-title">
                      TechCo Ltd · Investor Network
                    </div>
                    <div className="mockup__network-sub">
                      Revealing hidden connections…
                    </div>
                  </div>
                  <span className="mockup__network-badge">• Live</span>
                </div>
                <div className="mockup__cap-row">
                  <div
                    className="mockup__cap-avatar"
                    style={{
                      background: "linear-gradient(135deg,#CC0001,#FF4444)",
                    }}
                  >
                    MR
                  </div>
                  <div className="mockup__cap-body">
                    <div className="mockup__cap-name">Maya Rodriguez</div>
                    <div className="mockup__cap-meta">Angel · 4.2%</div>
                  </div>
                  <span className="mockup__cap-pct">4.2%</span>
                </div>
                <div className="mockup__cap-row">
                  <div
                    className="mockup__cap-avatar"
                    style={{
                      background: "linear-gradient(135deg,#041E41,#0C2D55)",
                    }}
                  >
                    JP
                  </div>
                  <div className="mockup__cap-body">
                    <div className="mockup__cap-name">Jun Park</div>
                    <div className="mockup__cap-meta">Seed · 2.8%</div>
                  </div>
                  <span className="mockup__cap-pct">2.8%</span>
                </div>
                <div className="mockup__cap-row">
                  <div
                    className="mockup__cap-avatar"
                    style={{
                      background: "linear-gradient(135deg,#D4850A,#F5A623)",
                    }}
                  >
                    CA
                  </div>
                  <div className="mockup__cap-body">
                    <div className="mockup__cap-name">Capavate Angels</div>
                    <div className="mockup__cap-meta">Syndicate · 8.5%</div>
                    <span className="mockup__cap-link">
                      3 co-investors overlap →
                    </span>
                  </div>
                  <span className="mockup__cap-pct">8.5%</span>
                </div>
                <div className="mockup__cap-row">
                  <div
                    className="mockup__cap-avatar"
                    style={{
                      background: "linear-gradient(135deg,#2D8B4E,#4FBF74)",
                    }}
                  >
                    SL
                  </div>
                  <div className="mockup__cap-body">
                    <div className="mockup__cap-name">Sarah Liu</div>
                    <div className="mockup__cap-meta">Follow-on · 1.5%</div>
                  </div>
                  <span className="mockup__cap-pct">1.5%</span>
                </div>
              </div>
              <div className="mockup__float mockup__float--connection">
                <div className="notif-label">Network Signal</div>
                <div className="notif-title">
                  Maya &amp; Jun both invest in GreenTech Holdings
                </div>
              </div>
              <div className="mockup__float mockup__float--reveal">
                <div className="notif-label">Connection Found</div>
                <div className="notif-title">3 shared investors</div>
                <div className="notif-desc">
                  Warm intro path available via Capavate Angels
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
