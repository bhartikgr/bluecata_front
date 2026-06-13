import React from "react";
import useScrollReveal from "./useScrollReveal";

export default function PlatformSection() {
 useScrollReveal();
  return (
    <>
      <section className="platform section" id="platform">
        <div className="container">
          <div className="platform__header js-reveal" style={{ '--reveal-delay': '0s' }}>
            <div className="eyebrow">
              <span className="eyebrow__dot"></span> The Platform
            </div>
            <h2 className="section-title">
              The infrastructure private markets{" "}
              <em>should have built years ago.</em>
            </h2>
            <p className="section-sub">
              Public equities have Bloomberg. Real estate has MLS. Private
              company ownership has spreadsheets and BCC chains. Capavate is the
              operating layer that replaces all of it — and once your network is
              on it, going back to email isn't an option.
            </p>
          </div>
          <div className="platform__pillars js-reveal" style={{ '--reveal-delay': '0.1s' }}>
            <div className="platform-pillar">
              <div className="platform-pillar__number">01</div>
              <h3 className="platform-pillar__title">Verified Ownership</h3>
              <p className="platform-pillar__desc">
                The single source of truth for who owns what — verified and
                live. Every investor sees their position independently. Every
                founder knows exactly who's on their register.
              </p>
              <ul className="platform-pillar__list">
                <li>Independent verification of every holding</li>
                <li>No anonymous profiles — real identities only</li>
                <li>Auditable equity records, always current</li>
              </ul>
            </div>
            <div className="platform-pillar">
              <div className="platform-pillar__number">02</div>
              <h3 className="platform-pillar__title">Network Intelligence</h3>
              <p className="platform-pillar__desc">
                See who overlaps, who co-invests, and where the warm paths are.
                Every new company makes the network smarter. This data layer
                can't be replicated in spreadsheets.
              </p>
              <ul className="platform-pillar__list">
                <li>Co-investor overlap detection across deals</li>
                <li>Warm introduction paths surfaced automatically</li>
                <li>Alerts when opportunity or overlap appears</li>
              </ul>
            </div>
            <div className="platform-pillar">
              <div className="platform-pillar__number">03</div>
              <h3 className="platform-pillar__title">Equity Communications</h3>
              <p className="platform-pillar__desc">
                One update reaches every stakeholder, on verified rails. Track
                who opened, read, and acted. Replace BCC chains with a system
                investors actually check.
              </p>
              <ul className="platform-pillar__list">
                <li>Structured updates to all shareholders at once</li>
                <li>Open, read, and engagement tracking</li>
                <li>Secure document sharing with permissions</li>
              </ul>
            </div>
          </div>
          <div className="platform__replaces js-reveal" style={{ '--reveal-delay': '0.2s' }}>
            <h3 className="platform__replaces-title">What Capavate replaces</h3>
            <div className="platform__replaces-grid">
              <div className="platform__replaces-item">
                <span className="platform__replaces-icon">×</span>
                <div>
                  <strong>Spreadsheets</strong>
                  <p>
                    Static, unverified, invisible to investors. No engagement,
                    no verification, no network effect.
                  </p>
                </div>
              </div>
              <div className="platform__replaces-item">
                <span className="platform__replaces-icon">×</span>
                <div>
                  <strong>Email / BCC</strong>
                  <p>
                    One-way, untracked, no co-investor visibility. Engagement
                    erodes with every blast.
                  </p>
                </div>
              </div>
              <div className="platform__replaces-item">
                <span className="platform__replaces-icon">×</span>
                <div>
                  <strong>Generic CRMs</strong>
                  <p>
                    Built for sales contacts, not equity relationships. No
                    network graph, no investor experience.
                  </p>
                </div>
              </div>
              <div className="platform__replaces-item">
                <span className="platform__replaces-icon">×</span>
                <div>
                  <strong>Data Rooms</strong>
                  <p>
                    Transaction tools that go dark after close. Capavate stays
                    live because every participant has a reason to return.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="platform__aha js-reveal" style={{ '--reveal-delay': '0.3s' }}>
            <div className="platform__aha-inner">
              <span className="aha-icon">⚡</span>
              <div>
                <strong className="platform__aha-headline">
                  The switching cost is the network itself.
                </strong>
                <p>
                  Once your investors, co-investors, and partners are verifying
                  ownership, coordinating rounds, and receiving updates through
                  Capavate — switching back to spreadsheets and BCC chains isn't
                  a downgrade. It's going dark. And no one who's experienced
                  transparency goes back to opacity voluntarily.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
