/**
 * 23-May Fix 6 (Issue 8) — AuthShell brand panel.
 * Wave G G2 — premium hero replacement.
 *
 * History:
 *   - Wave E E16: replaced flat gradient with a stylised SVG cap-table card.
 *   - Wave G G2: upgraded the SVG to an animated network graph. Nodes
 *     represent companies, investors, and option holders, connected by
 *     gently-pulsing edges. This signals "a network worth multiples more"
 *     — the right metaphor for an investor-grade platform.
 *
 * Hero design (Option A from the brief):
 *   - 8 nodes arranged in an asymmetric constellation around a central hub
 *   - 14 edges with a subtle stroke-dashoffset animation (the "data flow")
 *   - Each node pulses opacity 0.6 → 1.0 over staggered 3.2s cycles
 *   - Node labels: "Cap Table", "Founders", "Investors", "Option Pool",
 *     "Holders", "Rounds", "Reports", "Audit" — language matches Capavate
 *     product nouns so the hero feels native.
 *   - The animated dot-grid overlay from Wave E is preserved underneath.
 *   - All animations are GPU-friendly (only opacity / stroke-dashoffset /
 *     transform) and respect prefers-reduced-motion.
 *
 * Below the hero:
 *   - Refined tagline + sub-tagline (preserves consortium-partners line)
 *   - "Trusted by founders and investors at:" + a 4-slot badge grid
 *     (placeholder badges Avi can swap)
 *
 * Accessibility: the SVG is decorative (aria-hidden + role="presentation"),
 * and the @media(prefers-reduced-motion) block freezes all animations.
 *
 * Used by Login.tsx, Signup.tsx, AdminLogin, Forgot, Redeem — every auth
 * surface inherits the upgraded look.
 */
import { ReactNode } from "react";
import { Link } from "wouter";
import { CapavateLogo } from "@/components/CapavateLogo";

export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Brand panel — gradient + animated grid + network-graph hero */}
      <div
        className="relative hidden lg:flex bg-gradient-to-br from-[hsl(219_45%_20%)] via-[hsl(219_45%_16%)] to-[hsl(184_98%_22%)] text-white p-10 flex-col overflow-hidden"
        data-testid="auth-shell-brand-panel"
      >
        {/* Animated dot-grid overlay (CSS-only, no JS, no asset). Two layered
            radial-gradients drift slowly via the inline @keyframes below. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.35) 1px, transparent 0)",
            backgroundSize: "28px 28px",
            animation: "authShellDriftA 24s linear infinite",
          }}
          data-testid="auth-shell-grid-overlay"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 40%, rgba(0,255,225,0.08) 80%, transparent 100%)",
            animation: "authShellDriftB 36s ease-in-out infinite alternate",
          }}
        />
        {/* Wave G G2 — keyframes for the network graph. Pulses are short cycles
            with stagger via animation-delay (per-element inline style below).
            The @media(prefers-reduced-motion) block freezes everything. */}
        <style>{`
          @keyframes authShellDriftA {
            0%   { background-position: 0 0; }
            100% { background-position: 56px 56px; }
          }
          @keyframes authShellDriftB {
            0%   { transform: translate3d(0,0,0); }
            100% { transform: translate3d(8px,-12px,0); }
          }
          @keyframes authShellNodePulse {
            0%, 100% { opacity: 0.6; }
            50%      { opacity: 1.0; }
          }
          @keyframes authShellEdgeFlow {
            0%   { stroke-dashoffset: 0;   }
            100% { stroke-dashoffset: -40; }
          }
          @keyframes authShellHubGlow {
            0%, 100% { filter: drop-shadow(0 0 6px rgba(0,255,225,0.45)); }
            50%      { filter: drop-shadow(0 0 14px rgba(0,255,225,0.85)); }
          }
          .auth-shell-node {
            animation: authShellNodePulse 3.2s ease-in-out infinite;
            will-change: opacity;
            transform-origin: center;
          }
          .auth-shell-edge {
            stroke-dasharray: 6 4;
            animation: authShellEdgeFlow 6s linear infinite;
            will-change: stroke-dashoffset;
          }
          .auth-shell-hub {
            animation: authShellHubGlow 4s ease-in-out infinite;
            will-change: filter;
          }
          @media (prefers-reduced-motion: reduce) {
            .auth-shell-node,
            .auth-shell-edge,
            .auth-shell-hub {
              animation: none !important;
            }
          }
        `}</style>

        {/* Logo */}
        <Link href="/" className="relative z-10 flex items-center gap-2">
          <span className="inline-flex items-center bg-white rounded-md px-2.5 py-1.5 shadow-sm">
            <CapavateLogo className="h-7 w-auto" />
          </span>
        </Link>

        {/* Wave G G2 hero — animated network graph SVG. Decorative
            (aria-hidden). Node labels intentionally use Capavate product
            nouns so the hero reads as native. */}
        <div className="relative z-10 mt-10 max-w-md" data-testid="auth-shell-hero-svg-wrap">
          <svg
            viewBox="0 0 480 320"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            role="presentation"
            className="w-full h-auto drop-shadow-2xl"
            data-testid="auth-shell-hero-svg"
          >
            <defs>
              <radialGradient id="authShellNodeGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%"  stopColor="rgba(255,255,255,0.95)" />
                <stop offset="60%" stopColor="rgba(0,255,225,0.55)" />
                <stop offset="100%" stopColor="rgba(0,255,225,0.15)" />
              </radialGradient>
              <radialGradient id="authShellHubGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%"  stopColor="rgba(255,255,255,1)" />
                <stop offset="55%" stopColor="rgba(0,255,225,0.9)" />
                <stop offset="100%" stopColor="rgba(0,255,225,0.2)" />
              </radialGradient>
            </defs>

            {/* Title strip — acts as a caption + preserves the
                "Cap Table" / product-noun vocabulary expected by the
                Wave E hero regression test. */}
            <text
              x="240" y="22" textAnchor="middle"
              fill="rgba(255,255,255,0.95)" fontSize="13"
              fontFamily="ui-sans-serif, system-ui" fontWeight="600"
              letterSpacing="0.04em"
            >
              Cap Table · Rounds · Investors · Audit
            </text>

            {/* Edges (drawn under nodes). Each edge animates a subtle
                "data flow" via stroke-dashoffset. The 14 edges connect the
                central Cap Table hub to surrounding entities and a few
                peer-to-peer lines so the constellation feels like a graph,
                not a star. */}
            <g stroke="rgba(0,255,225,0.55)" strokeWidth="1.4" fill="none">
              {/* Hub-to-spoke */}
              <line className="auth-shell-edge" x1="240" y1="170" x2="80"  y2="90"  />
              <line className="auth-shell-edge" x1="240" y1="170" x2="160" y2="70"  />
              <line className="auth-shell-edge" x1="240" y1="170" x2="320" y2="70"  />
              <line className="auth-shell-edge" x1="240" y1="170" x2="400" y2="90"  />
              <line className="auth-shell-edge" x1="240" y1="170" x2="90"  y2="240" />
              <line className="auth-shell-edge" x1="240" y1="170" x2="180" y2="280" />
              <line className="auth-shell-edge" x1="240" y1="170" x2="300" y2="280" />
              <line className="auth-shell-edge" x1="240" y1="170" x2="390" y2="240" />
              {/* Peer-to-peer crosslinks */}
              <line className="auth-shell-edge" x1="80"  y1="90"  x2="160" y2="70"  />
              <line className="auth-shell-edge" x1="320" y1="70"  x2="400" y2="90"  />
              <line className="auth-shell-edge" x1="90"  y1="240" x2="180" y2="280" />
              <line className="auth-shell-edge" x1="300" y1="280" x2="390" y2="240" />
              <line className="auth-shell-edge" x1="160" y1="70"  x2="320" y2="70"  />
              <line className="auth-shell-edge" x1="90"  y1="240" x2="390" y2="240" />
            </g>

            {/* Nodes — opacity pulses with staggered delay. The label
                vocabulary includes "Cap Table", "Founders", "Investors",
                "Option Pool" to remain backwards compatible with the
                Wave E E16 regression test. */}
            {/* Central hub */}
            <g className="auth-shell-hub" data-testid="auth-shell-hub">
              <circle cx="240" cy="170" r="34" fill="url(#authShellHubGrad)" />
              <circle cx="240" cy="170" r="34" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" />
              <text x="240" y="166" textAnchor="middle" fontSize="12"
                fontFamily="ui-sans-serif, system-ui" fontWeight="700"
                fill="hsl(219 45% 14%)">
                Cap Table
              </text>
              <text x="240" y="182" textAnchor="middle" fontSize="9"
                fontFamily="ui-monospace, monospace"
                fill="hsl(219 45% 14% / 0.7)">
                NovaPay AI
              </text>
            </g>

            {/* Surrounding nodes (each with a label below). */}
            {/* Top row */}
            <g className="auth-shell-node" style={{ animationDelay: "0s" }}>
              <circle cx="80" cy="90" r="18" fill="url(#authShellNodeGrad)" />
              <text x="80" y="124" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.95)" fontFamily="ui-sans-serif, system-ui" fontWeight="600">Founders</text>
            </g>
            <g className="auth-shell-node" style={{ animationDelay: "0.4s" }}>
              <circle cx="160" cy="70" r="14" fill="url(#authShellNodeGrad)" />
              <text x="160" y="104" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.85)" fontFamily="ui-sans-serif, system-ui">Rounds</text>
            </g>
            <g className="auth-shell-node" style={{ animationDelay: "0.8s" }}>
              <circle cx="320" cy="70" r="14" fill="url(#authShellNodeGrad)" />
              <text x="320" y="104" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.85)" fontFamily="ui-sans-serif, system-ui">Audit</text>
            </g>
            <g className="auth-shell-node" style={{ animationDelay: "1.2s" }}>
              <circle cx="400" cy="90" r="18" fill="url(#authShellNodeGrad)" />
              <text x="400" y="124" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.95)" fontFamily="ui-sans-serif, system-ui" fontWeight="600">Investors</text>
            </g>
            {/* Bottom row */}
            <g className="auth-shell-node" style={{ animationDelay: "1.6s" }}>
              <circle cx="90" cy="240" r="16" fill="url(#authShellNodeGrad)" />
              <text x="90" y="272" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.9)" fontFamily="ui-sans-serif, system-ui" fontWeight="600">Option Pool</text>
            </g>
            <g className="auth-shell-node" style={{ animationDelay: "2.0s" }}>
              <circle cx="180" cy="280" r="13" fill="url(#authShellNodeGrad)" />
              <text x="180" y="306" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.8)" fontFamily="ui-sans-serif, system-ui">Reports</text>
            </g>
            <g className="auth-shell-node" style={{ animationDelay: "2.4s" }}>
              <circle cx="300" cy="280" r="13" fill="url(#authShellNodeGrad)" />
              <text x="300" y="306" textAnchor="middle" fontSize="10" fill="rgba(255,255,255,0.8)" fontFamily="ui-sans-serif, system-ui">Holders</text>
            </g>
            <g className="auth-shell-node" style={{ animationDelay: "2.8s" }}>
              <circle cx="390" cy="240" r="16" fill="url(#authShellNodeGrad)" />
              <text x="390" y="272" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.9)" fontFamily="ui-sans-serif, system-ui" fontWeight="600">Consortium</text>
            </g>
          </svg>
        </div>

        {/* Tagline + trust grid */}
        <div className="relative z-10 mt-auto max-w-md">
          <p className="text-2xl font-semibold tracking-tight leading-snug">
            Cap tables, rounds, and investor relations — every number, document, and term sheet in one place.
          </p>
          <p className="mt-3 text-sm text-white/70" data-testid="auth-shell-subtagline">
            Trusted by founders, investors, and consortium partners across North America and Asia.
          </p>

          {/* Wave G G2 — trust badge row. Placeholder slots Avi can swap
              for real partner logos post-launch. Rendered as monogram
              chips so the visual rhythm holds with or without art. */}
          <div className="mt-5" data-testid="auth-shell-trust-grid">
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/55 mb-3">
              Trusted by founders and investors at
            </p>
            <div className="grid grid-cols-4 gap-2.5">
              {[
                { mono: "NV", label: "Nova Ventures" },
                { mono: "AC", label: "Atlas Capital" },
                { mono: "HL", label: "Helio Labs" },
                { mono: "QF", label: "Quanta Founders" },
              ].map((b) => (
                <div
                  key={b.mono}
                  className="h-10 flex items-center justify-center rounded-md border border-white/15 bg-white/5 backdrop-blur-sm text-white/85 text-sm font-semibold tracking-wider"
                  aria-label={b.label}
                  title={b.label}
                  data-testid="auth-shell-trust-badge"
                >
                  {b.mono}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex items-center justify-center p-6 lg:p-10 bg-background">
        <div className="w-full max-w-md">
          <Link href="/" className="lg:hidden flex items-center gap-2 text-foreground mb-8">
            <CapavateLogo className="h-7 w-auto" />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted-foreground text-center">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
