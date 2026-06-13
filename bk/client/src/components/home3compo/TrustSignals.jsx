/**
 * Wave G Track 2 — G6: Trust signals section.
 *
 * Added between the hero and the pricing section on the public homepage.
 * Three rows:
 *   1. Customer logo grid (placeholder boxes — Avi swaps in real logos)
 *   2. Security / compliance badges
 *   3. Quantitative trust stats
 *
 * Styling matches the rest of `home3compo` — plain JSX + inline CSS-in-JSX
 * with the existing `home3style.css` palette. Center-aligned, muted
 * background, generous spacing.
 */
import React from "react";

const LOGO_PLACEHOLDERS = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  label: `Logo ${i + 1}`,
}));

const COMPLIANCE_BADGES = [
  { label: "SOC 2 Type II", note: "in progress", icon: "🛡️" },
  { label: "GDPR Ready",    note: null,          icon: "🇪🇺" },
  { label: "CCPA Ready",    note: null,          icon: "🛡" },
  { label: "AES-256 Encryption", note: null,     icon: "🔒" },
  { label: "Hash-chain Audit",   note: null,     icon: "⛓" },
];

const TRUST_STATS = [
  { value: "$2.4M", label: "committed via Capavate" },
  { value: "47",    label: "companies" },
  { value: "180+",  label: "investors" },
];

export default function TrustSignals() {
  return (
    <section
      data-testid="trust-signals-section"
      aria-labelledby="trust-signals-heading"
      style={{
        background: "#F8FAFC",
        borderTop: "1px solid #E2E8F0",
        borderBottom: "1px solid #E2E8F0",
        padding: "72px 24px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", textAlign: "center" }}>
        <h2
          id="trust-signals-heading"
          style={{
            fontSize: "clamp(1.5rem, 2.4vw, 2rem)",
            fontWeight: 700,
            color: "#0F172A",
            letterSpacing: "-0.01em",
            marginBottom: 48,
          }}
        >
          Trusted infrastructure for modern fundraising
        </h2>

        {/* Row 1 — Customer logos */}
        <div
          data-testid="trust-signals-logos"
          aria-label="Customer logos"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 16,
            marginBottom: 64,
            maxWidth: 960,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {LOGO_PLACEHOLDERS.map((l) => (
            <div
              key={l.id}
              style={{
                height: 56,
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#94A3B8",
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
              aria-hidden="true"
            >
              Logo here
            </div>
          ))}
        </div>

        {/* Row 2 — Security & compliance */}
        <div
          data-testid="trust-signals-compliance"
          aria-label="Security and compliance badges"
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 12,
            marginBottom: 64,
          }}
        >
          {COMPLIANCE_BADGES.map((b) => (
            <div
              key={b.label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "#FFFFFF",
                border: "1px solid #E2E8F0",
                borderRadius: 999,
                padding: "8px 16px",
                fontSize: 13,
                color: "#334155",
                fontWeight: 500,
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 16 }}>{b.icon}</span>
              <span>{b.label}</span>
              {b.note ? (
                <span style={{ color: "#94A3B8", fontSize: 12 }}>
                  ({b.note})
                </span>
              ) : null}
            </div>
          ))}
        </div>

        {/* Row 3 — Quantitative trust stats */}
        <div
          data-testid="trust-signals-stats"
          aria-label="Trust statistics"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 24,
            maxWidth: 720,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {TRUST_STATS.map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: "clamp(1.75rem, 3vw, 2.25rem)",
                  fontWeight: 700,
                  color: "#0E7C9F",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.1,
                }}
              >
                {s.value}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 14,
                  color: "#475569",
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
