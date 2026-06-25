/**
 * 23-May Fix 6 (Issue 8) — AuthShell brand panel.
 * v25.43 R3-1 — Auth panel re-skin to match capavate.com.
 *
 * Layout (R3-1, Ozan-approved this session):
 *   - The left brand panel is now a SOLID deep-navy surface (#041e41), matching
 *     the capavate.com hero card. The previous cyan→burgundy gradient was
 *     off-brand vs the live site.
 *   - The animated cap-table network-graph SVG (hub, nodes, edges, labels) has
 *     been REMOVED entirely. The brief's earlier "keep widget, re-skin only"
 *     rule is OVERRIDDEN for the auth surface specifically.
 *   - KEEP: the Capavate logo at the top.
 *   - KEEP: the tagline + subline copy props (each portal — founder vs investor
 *     — passes its own audience-specific copy; defaults to founder copy so the
 *     other auth surfaces render unchanged).
 *   - Tagline uses the Instrument Serif display family (`font-serif`); subline
 *     uses Montserrat body (`font-sans`). Headings render in cream (#faf6f1).
 *
 * Accessibility: the panel is purely decorative chrome now; no SVG to hide.
 *
 * Used by Login.tsx, Signup.tsx, AdminLogin, Forgot, Redeem — every auth
 * surface inherits the look.
 */
import { ReactNode } from "react";
import { Link } from "wouter";
import { CapavateLogo } from "@/components/CapavateLogo";

// v25.43 F4/F5/F7 — brand panel tagline + subline are now overridable per
// surface (investor vs founder copy) while defaulting to the historical
// founder-leaning copy so every other auth surface (Forgot, Redeem, Admin,
// Partner) renders unchanged.
const DEFAULT_TAGLINE =
  "Run your cap table, structure your rounds, and turn every shareholder into a verified contact — in one place.";
const DEFAULT_SUBLINE =
  "Activate the network already inside your ownership structure.";

export function AuthShell({ title, subtitle, children, footer, tagline, subline }: {
  title: string; subtitle?: string; children: ReactNode; footer?: ReactNode;
  /** v25.43 F4/F5/F7 — brand-panel headline copy. Defaults to founder copy. */
  tagline?: string;
  /** v25.43 F4/F5/F7 — brand-panel sub-headline copy. Defaults to founder copy. */
  subline?: string;
}) {
  const heroTagline = tagline ?? DEFAULT_TAGLINE;
  const heroSubline = subline ?? DEFAULT_SUBLINE;
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left: Brand panel — solid deep navy (#041e41), matching the
          capavate.com hero card. R3-1 removed the network-graph SVG; the
          panel now carries only the logo (top) and tagline/subline (bottom). */}
      <div
        className="relative hidden lg:flex bg-[#041e41] text-white p-10 flex-col overflow-hidden"
        data-testid="auth-shell-brand-panel"
      >
        {/* Logo */}
        <Link href="/" className="relative z-10 flex items-center gap-2">
          <span className="inline-flex items-center bg-white rounded-md px-2.5 py-1.5 shadow-sm">
            <CapavateLogo className="h-7 w-auto" />
          </span>
        </Link>

        {/* Tagline + subline. v25.43 F4/F5/F7 — copy is driven by the
            `tagline`/`subline` props so the investor and founder portals show
            audience-specific messaging (defaults to founder copy). R3-1 —
            tagline uses the Instrument Serif display family; subline uses
            Montserrat body; headings render in cream (#faf6f1). */}
        <div className="relative z-10 mt-auto max-w-md">
          <p
            className="font-serif text-3xl tracking-tight leading-snug text-[#faf6f1]"
            data-testid="auth-shell-tagline"
          >
            {heroTagline}
          </p>
          <p
            className="font-sans mt-3 text-sm text-white/70"
            data-testid="auth-shell-subtagline"
          >
            {heroSubline}
          </p>
        </div>
      </div>

      {/* Right: Form */}
      <div className="flex items-center justify-center p-6 lg:p-10 bg-background">
        <div className="w-full max-w-md">
          <Link href="/" className="lg:hidden flex items-center gap-2 text-foreground mb-8">
            <CapavateLogo className="h-7 w-auto" />
          </Link>
          {/* v25.43 R4-1 — capavate.com brand: the form heading uses the
             Instrument Serif display family (font-serif), larger/confident
             size, and the brand body-text color #1a1a1a. */}
          <h1 className="font-serif text-3xl lg:text-4xl tracking-tight text-[#1a1a1a]">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-sm text-muted-foreground text-center">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
