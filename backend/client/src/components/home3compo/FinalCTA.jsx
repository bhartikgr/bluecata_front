import React from "react";
import useScrollReveal from "./useScrollReveal";

export default function FinalCTA() {
  useScrollReveal();
  return (
    <>
      <section className="cta-final section" id="cta-final">
        <div className="container">
          <div className="cta-final__inner js-reveal" style={{ '--reveal-delay': '0s' }}>
            <h2 className="cta-final__headline">
              The network already exists{" "}
              <em>inside your ownership structure.</em>
              <br />
              The only question is: <em>who activates it first?</em>
            </h2>
            <p className="cta-final__sub">
              75–150 warm introductions per company. Independent ownership
              verification for every investor. 450 qualified relationships per
              ecosystem partner. The value is already there — Capavate is what
              makes it visible, coordinated, and compounding. First movers lock
              in the network.
            </p>
            <div className="cta-final__actions">
              <a
                href="https://capavate.com/user/register"
                className="btn btn--primary btn--lg text-white"
              >
                Register Your Company
              </a>
              <a href="#cta-final" className="btn btn--ghost btn--lg">
                Become an Ecosystem Partner
              </a>
            </div>
            <span className="cta-final__ps">
              One ecosystem partner. Five companies. Seventy-five investors.
              That's all it takes to start the multiplier — and the window to
              move first is closing.
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
