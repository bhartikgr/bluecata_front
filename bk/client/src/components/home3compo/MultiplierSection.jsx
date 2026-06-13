import React from "react";
import useScrollReveal from "./useScrollReveal";

export default function MultiplierSection() {
 useScrollReveal();
  return (
    <>
      <section className="multiplier section" id="multiplier">
        <div className="container">
          <div className="multiplier__header js-reveal" style={{ '--reveal-delay': '0s' }}>
            <div className="eyebrow">
              <span className="eyebrow__dot"></span> The Multiplier Effect
            </div>
            <h2 className="section-title">
              Every participant compounds value{" "}
              <em>for everyone else on the platform.</em>
            </h2>
          </div>
          <div className="multiplier__math js-reveal" style={{ '--reveal-delay': '0.1s' }}>
            <div className="math-card">
              <div className="math-card__step">
                <span className="math-card__num">30</span>
                <span className="math-card__label">Companies on one firm</span>
              </div>
              <span className="math-card__operator">×</span>
              <div className="math-card__step">
                <span className="math-card__num">15</span>
                <span className="math-card__label">Avg investors each</span>
              </div>
              <span className="math-card__operator">=</span>
              <div className="math-card__step math-card__step--result">
                <span className="math-card__num">450</span>
                <span className="math-card__label">Connections activated</span>
              </div>
            </div>
            <p className="multiplier__math-note">
              Each investor is connected to 5–10 other companies. Second-order
              reach: <strong>2,000–4,500 verified relationships.</strong> This
              isn't a feature — it's a structural advantage that grows with
              every company that joins.
            </p>
          </div>
          <div className="multiplier__lenses js-reveal" style={{ '--reveal-delay': '0.2s' }}>
            <div className="mult-lens">
              <div className="mult-lens__label">For the Company</div>
              <div className="mult-lens__math">
                15 investors → <em>15 activated networks</em>
              </div>
              <p className="mult-lens__desc">
                75–150 warm intros, follow-on signals, and customer referrals —
                activated, not idle.
              </p>
            </div>
            <div className="mult-lens">
              <div className="mult-lens__label">For the Investor</div>
              <div className="mult-lens__math">
                5 portfolio companies → <em>5 sets of co-investors visible</em>
              </div>
              <p className="mult-lens__desc">
                Independent verification of $250K+ in holdings. Co-investor
                coordination. Governance transparency no other platform
                provides.
              </p>
            </div>
            <div className="mult-lens">
              <div className="mult-lens__label">For the Partner</div>
              <div className="mult-lens__math">
                30 clients → <em>450 investors surfaced</em>
              </div>
              <p className="mult-lens__desc">
                At 5% conversion, that's 22 new engagements from relationships
                already inside your book of business.
              </p>
            </div>
          </div>
          <div className="multiplier__aha   js-reveal" style={{ '--reveal-delay': '0.3s' }}>
            <span className="aha-icon">💡</span>
            <p>
              Capavate doesn't create new relationships. It reveals the ones
              already inside your ownership structure — and gives every
              participant a reason to stay, engage, and compound.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
