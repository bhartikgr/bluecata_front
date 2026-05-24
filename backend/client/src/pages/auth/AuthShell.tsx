/**
 * 23-May Fix 6 (Issue 8) \u2014 AuthShell brand panel.
 *
 * Previously the left panel was a flat gradient + tagline only. Ozan
 * requested a richer hero composition. We implemented option (d) from the
 * brief: CSS-only animated grid/dot pattern + an inline SVG "platform
 * preview" card showing a stylised cap-table view. No external image
 * assets are loaded (zero network cost, immune to broken-asset regressions).
 *
 * Composition (top to bottom, left panel):
 *   1. Brand logo lockup (top-left)
 *   2. Animated grid overlay (CSS background-image, no JS)
 *   3. Composed SVG card \u2014 stylised cap-table snapshot
 *   4. Tagline + sub-tagline (bottom-left, mt-auto)
 *
 * Accessibility: the SVG is decorative (aria-hidden + role="presentation")
 * so screen readers skip directly from the logo to the form on the right.
 *
 * Used by both Login.tsx and Signup.tsx (and AdminLogin, Forgot, Redeem
 * via the same wrapper), so every auth surface inherits the new look.
 */
import { ReactNode } from "react";
import { Link } from "wouter";
import { CapavateLogo } from "@/components/CapavateLogo";

export function AuthShell({ title, subtitle, children, footer }: {
  title: string; subtitle?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Brand panel \u2014 gradient + animated grid + SVG hero */}
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
        <style>{`
          @keyframes authShellDriftA {
            0%   { background-position: 0 0; }
            100% { background-position: 56px 56px; }
          }
          @keyframes authShellDriftB {
            0%   { transform: translate3d(0,0,0); }
            100% { transform: translate3d(8px,-12px,0); }
          }
        `}</style>

        {/* Logo */}
        <Link href="/" className="relative z-10 flex items-center gap-2">
          <span className="inline-flex items-center bg-white rounded-md px-2.5 py-1.5 shadow-sm">
            <CapavateLogo className="h-7 w-auto" />
          </span>
        </Link>

        {/* Composed SVG platform preview \u2014 a stylised cap-table snapshot.
            Decorative only (aria-hidden). Roughly mirrors the look of the
            real Founder Cap Table page so the hero feels native to the
            product without leaking any real data. */}
        <div className="relative z-10 mt-10 max-w-md" data-testid="auth-shell-hero-svg-wrap">
          <svg
            viewBox="0 0 480 280"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            role="presentation"
            className="w-full h-auto drop-shadow-2xl"
            data-testid="auth-shell-hero-svg"
          >
            {/* Card body */}
            <rect x="0" y="0" width="480" height="280" rx="14" fill="white" fillOpacity="0.96" />
            <rect x="0" y="0" width="480" height="44" rx="14" fill="hsl(219 45% 20%)" />
            <rect x="0" y="30" width="480" height="14" fill="hsl(219 45% 20%)" />
            {/* Title bar text */}
            <circle cx="20" cy="22" r="5" fill="#ff5f57" />
            <circle cx="38" cy="22" r="5" fill="#ffbd2e" />
            <circle cx="56" cy="22" r="5" fill="#28c840" />
            <text x="80" y="27" fill="white" fontSize="12" fontFamily="ui-sans-serif, system-ui" fontWeight="600">
              Cap Table \u2014 NovaPay AI
            </text>
            <text x="380" y="27" fill="rgba(255,255,255,0.7)" fontSize="10" fontFamily="ui-monospace, monospace">
              v.2026.05
            </text>

            {/* Donut summary */}
            <g transform="translate(40,80)">
              <circle r="38" cx="38" cy="38" fill="hsl(219 45% 95%)" />
              <circle
                r="28"
                cx="38"
                cy="38"
                fill="none"
                stroke="hsl(184 98% 22%)"
                strokeWidth="20"
                strokeDasharray="65 100"
                strokeDashoffset="0"
                transform="rotate(-90 38 38)"
              />
              <circle
                r="28"
                cx="38"
                cy="38"
                fill="none"
                stroke="hsl(219 45% 35%)"
                strokeWidth="20"
                strokeDasharray="20 100"
                strokeDashoffset="-65"
                transform="rotate(-90 38 38)"
              />
              <circle
                r="28"
                cx="38"
                cy="38"
                fill="none"
                stroke="hsl(300 60% 45%)"
                strokeWidth="20"
                strokeDasharray="15 100"
                strokeDashoffset="-85"
                transform="rotate(-90 38 38)"
              />
              <text x="38" y="42" textAnchor="middle" fontSize="11" fontWeight="700" fill="hsl(219 45% 20%)">
                100%
              </text>
            </g>

            {/* Legend rows */}
            <g transform="translate(140,80)" fontFamily="ui-sans-serif, system-ui">
              <rect x="0" y="0" width="280" height="20" rx="4" fill="hsl(219 45% 96%)" />
              <rect x="0" y="0" width="14" height="20" rx="4" fill="hsl(184 98% 22%)" />
              <text x="22" y="14" fontSize="11" fill="hsl(219 45% 20%)" fontWeight="600">Founders</text>
              <text x="240" y="14" fontSize="11" fill="hsl(219 45% 20%)" textAnchor="end">65.0%</text>

              <rect x="0" y="26" width="280" height="20" rx="4" fill="hsl(219 45% 96%)" />
              <rect x="0" y="26" width="14" height="20" rx="4" fill="hsl(219 45% 35%)" />
              <text x="22" y="40" fontSize="11" fill="hsl(219 45% 20%)" fontWeight="600">Investors</text>
              <text x="240" y="40" fontSize="11" fill="hsl(219 45% 20%)" textAnchor="end">20.0%</text>

              <rect x="0" y="52" width="280" height="20" rx="4" fill="hsl(219 45% 96%)" />
              <rect x="0" y="52" width="14" height="20" rx="4" fill="hsl(300 60% 45%)" />
              <text x="22" y="66" fontSize="11" fill="hsl(219 45% 20%)" fontWeight="600">Option Pool</text>
              <text x="240" y="66" fontSize="11" fill="hsl(219 45% 20%)" textAnchor="end">15.0%</text>
            </g>

            {/* KPI row */}
            <g transform="translate(40,180)" fontFamily="ui-sans-serif, system-ui">
              <rect x="0" y="0" width="125" height="60" rx="8" fill="hsl(184 98% 96%)" stroke="hsl(184 98% 22% / 0.25)" />
              <text x="12" y="22" fontSize="10" fill="hsl(184 98% 18%)" fontWeight="600">Valuation</text>
              <text x="12" y="44" fontSize="18" fill="hsl(184 98% 18%)" fontWeight="700">$24.0M</text>

              <rect x="138" y="0" width="125" height="60" rx="8" fill="hsl(219 45% 96%)" stroke="hsl(219 45% 35% / 0.25)" />
              <text x="150" y="22" fontSize="10" fill="hsl(219 45% 20%)" fontWeight="600">Round</text>
              <text x="150" y="44" fontSize="18" fill="hsl(219 45% 20%)" fontWeight="700">Seed</text>

              <rect x="276" y="0" width="125" height="60" rx="8" fill="hsl(300 60% 96%)" stroke="hsl(300 60% 45% / 0.25)" />
              <text x="288" y="22" fontSize="10" fill="hsl(300 60% 30%)" fontWeight="600">Holders</text>
              <text x="288" y="44" fontSize="18" fill="hsl(300 60% 30%)" fontWeight="700">17</text>
            </g>
          </svg>
        </div>

        {/* Tagline at bottom */}
        <div className="relative z-10 mt-auto max-w-md">
          <p className="text-2xl font-semibold tracking-tight leading-snug">
            Cap tables, rounds, and investor relations \u2014 every number, document, and term sheet in one place.
          </p>
          <p className="mt-3 text-sm text-white/70" data-testid="auth-shell-subtagline">
            Trusted by founders, investors, and consortium partners across North America and Asia.
          </p>
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
