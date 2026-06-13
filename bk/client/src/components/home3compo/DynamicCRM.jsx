import React from "react";
import useScrollReveal from "./useScrollReveal";
export default function DynamicCRM() {
 useScrollReveal();
  return (
    
    <>
      <section className="dynamic-crm section" id="dynamic-crm">
        <div className="container">
          <div className="dynamic-crm__inner js-reveal" style={{ '--reveal-delay': '0s' }}>
            <div className="dynamic-crm__header">
              <div className="eyebrow">
                <span className="eyebrow__dot"></span> Dynamic CRM &amp; M&amp;A
                Intelligence
              </div>
              <h2 className="section-title">
                The only CRM where every contact{" "}
                <em>is a verified shareholder.</em>
              </h2>
              <p className="section-sub">
                Generic CRMs track contacts. Capavate tracks ownership — and
                every ownership change is an M&amp;A signal you'd otherwise
                miss.
              </p>
            </div>
            <div className="dynamic-crm__grid">
              <div className="dynamic-crm__card">
                <div className="dynamic-crm__card-icon">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
                  </svg>
                </div>
                <h3 className="dynamic-crm__card-title">
                  Equity-Anchored Relationships
                </h3>
                <p className="dynamic-crm__card-desc">
                  Every contact is tied to a real shareholding. When ownership
                  changes, your CRM updates automatically. No manual entry. No
                  stale data. No guessing who still holds what.
                </p>
              </div>
              <div className="dynamic-crm__card">
                <div className="dynamic-crm__card-icon">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                  </svg>
                </div>
                <h3 className="dynamic-crm__card-title">
                  Live M&amp;A Signals
                </h3>
                <p className="dynamic-crm__card-desc">
                  When an investor exits, a co-investor consolidates, or a
                  founder's register shifts — Capavate flags it. You see capital
                  movement before it becomes public. That's deal intelligence no
                  data room provides.
                </p>
              </div>
              <div className="dynamic-crm__card">
                <div className="dynamic-crm__card-icon">
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <h3 className="dynamic-crm__card-title">
                  Verified, Not Self-Reported
                </h3>
                <p className="dynamic-crm__card-desc">
                  Salesforce trusts what people type. Capavate trusts what
                  companies file. Every relationship is backed by auditable
                  equity data — the only CRM where trust is structural.
                </p>
              </div>
            </div>
            <div className="dynamic-crm__callout js-reveal" style={{ '--reveal-delay': '0.1s' }}>
              <span className="aha-icon">🎯</span>
              <div>
                <strong>Why this is a must-have:</strong> Every CRM on the
                market tracks contacts after you meet them. Capavate surfaces
                relationships you didn't know existed — because they're hidden
                inside ownership structures. The moment an investor appears on
                two registers, that's a warm path, a co-investment signal, and
                an M&amp;A indicator. No other tool sees this.
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
