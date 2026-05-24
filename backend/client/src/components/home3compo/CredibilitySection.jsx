import React, { useEffect, useRef, useState, useCallback } from "react";

export default function CredibilitySection() {
  const [stats, setStats] = useState({ aum: 0, deals: 0, intros: 0 });
  const statsRef = useRef(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateStats();
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.3 },
    );
    if (statsRef.current) observer.observe(statsRef.current);
    return () => observer.disconnect();
  }, []);

  const animateStats = () => {
    const duration = 2000;
    const startTime = performance.now();
    const targets = { aum: 8.4, deals: 62, intros: 90 };
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setStats({
        aum: targets.aum * eased,
        deals: Math.floor(targets.deals * eased),
        intros: Math.floor(targets.intros * eased),
      });
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  };
  return (
    <>
      <section className="credibility section">
        <div className="container">
          <div className="credibility__header reveal">
            <div className="eyebrow">
              <span className="eyebrow__dot"></span> Why Capavate
            </div>
            <h2 className="section-title">
              This isn't theoretical.
              <br />
              <em>The market demands it.</em>
            </h2>
          </div>
          <div className="credibility__grid">
            <div className="cred-card reveal">
              <div className="cred-card__stat">Capavate Angel Network</div>
              <p className="cred-card__desc">
                A global syndication community of accredited investors —
                purpose-built for co-investment coordination, verified deal
                flow, and the kind of investor-to-investor visibility that
                doesn't exist anywhere else.
              </p>
            </div>
            <div className="cred-card reveal">
              <div className="cred-card__stat">Verified Equity</div>
              <p className="cred-card__desc">
                Every connection is anchored in real shareholding data. No
                anonymous profiles, no self-reported claims — auditable equity
                relationships that investors and companies can both trust
                independently.
              </p>
            </div>
            <div className="cred-card reveal">
              <div className="cred-card__stat">Accredited Only</div>
              <p className="cred-card__desc">
                Platform access is limited to verified accredited investors and
                registered companies. Quality over quantity — every node in the
                network is real.
              </p>
            </div>
            <div className="cred-card reveal">
              <div className="cred-card__stat">3 Reinforcing Layers</div>
              <p className="cred-card__desc">
                Verified ownership, network intelligence, and equity
                communications — each layer makes the other two more valuable.
                Remove one, and the system breaks. That's what makes it
                irreplaceable.
              </p>
            </div>
          </div>
          <div className="credibility__stats reveal" ref={statsRef}>
            <div className="cred-stat">
              <span className="cred-stat__number">
                ${stats.aum.toFixed(1)}T
              </span>
              <span className="cred-stat__label">
                Global private equity AUM
              </span>
            </div>
            <div className="cred-stat__divider"></div>
            <div className="cred-stat">
              <span className="cred-stat__number">{stats.deals}%</span>
              <span className="cred-stat__label">
                Deals sourced via relationships
              </span>
            </div>
            <div className="cred-stat__divider"></div>
            <div className="cred-stat">
              <span className="cred-stat__number">{stats.intros}%</span>
              <span className="cred-stat__label">
                Investor intros via warm network
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
