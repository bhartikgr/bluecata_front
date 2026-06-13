import React  from "react";
import useScrollReveal from "./useScrollReveal";

export default function HowItWorks() {
 useScrollReveal();
  return (
    <>
      <section className="how-it-works section" id="how-it-works">
        <div className="container">
          <div className="how-it-works__header js-reveal" style={{ '--reveal-delay': '0s' }}>
            <div className="eyebrow">
              <span className="eyebrow__dot"></span> How It Works
            </div>
            <h2 className="section-title">
              Activate your ownership structure <em>in minutes.</em>
            </h2>
            <p className="section-sub">
              Start compounding the relationships already inside it.
            </p>
          </div>
          <div className="how-it-works__steps">
            <div className="hiw-step js-reveal" style={{ '--reveal-delay': '0s' }}>
              <div className="hiw-step__num">1</div>
              <h3 className="hiw-step__title">Register your company</h3>
              <p className="hiw-step__desc">
                Create your company profile and upload your investor register.
                Takes less than 5 minutes.
              </p>
            </div>
            <div className="hiw-step__arrow">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14m-7-7l7 7-7 7" />
              </svg>
            </div>
            <div className="hiw-step js-reveal" style={{ '--reveal-delay': '0.1s' }}>
              <div className="hiw-step__num">2</div>
              <h3 className="hiw-step__title">Invite your investors</h3>
              <p className="hiw-step__desc">
                Each investor gets verified access to see their holdings,
                co-investors, and portfolio activity — automatically.
              </p>
            </div>
            <div className="hiw-step__arrow">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14m-7-7l7 7-7 7" />
              </svg>
            </div>
            <div className="hiw-step js-reveal" style={{ '--reveal-delay': '0.2s' }}>
              <div className="hiw-step__num">3</div>
              <h3 className="hiw-step__title">Your network activates</h3>
              <p className="hiw-step__desc">
                Investors see each other. Overlaps surface. Follow-on signals
                appear. The relationships that were always there start working.
              </p>
            </div>
          </div>
          <div className="how-it-works__callout js-reveal" style={{ '--reveal-delay': '0.4s' }}>
            <span className="how-it-works__callout-icon">🤝</span>
            <p>
              Ecosystem partners? You do this for all your clients at once.{" "}
              <a href="#ecosystem">Learn more →</a>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
