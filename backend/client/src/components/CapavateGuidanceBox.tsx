/**
 * Sprint 18 Phase 2 — T2 Capavate guidance info-box.
 *
 * Dismissible per-user info banner that anchors to the four Capavate value
 * pillars (Cap Table · Rounds · Comms · Collective). Per-user dismiss state is
 * held in component memory with a keyed identifier; this is sandbox-safe (no
 * Web Storage). The dismissal is client-session only — refreshing brings it
 * back, but the banner is non-intrusive.
 */
import { useState } from "react";
import { Link } from "wouter";
import { X, PieChart, Briefcase, MessageSquare, Sparkles, Lightbulb } from "lucide-react";

type Variant = "founder" | "investor";

const COPY: Record<Variant, { title: string; body: string }> = {
  founder: {
    title: "Capavate is your equity story HQ",
    body: "Track an accurate cap table, run rounds end-to-end, communicate with investors, and (when ready) plug into the Collective for direct accredited deal flow.",
  },
  investor: {
    title: "Capavate is your investment workspace",
    body: "Review companies, soft-circle into rounds, message founders, and track portfolio holdings — all anchored to a dual-engine reconciled cap table you can trust.",
  },
};

export function CapavateGuidanceBox({ variant = "founder" }: { variant?: Variant }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const c = COPY[variant];
  const links = variant === "founder"
    ? [
        { href: "/founder/captable", label: "Cap table", icon: PieChart },
        { href: "/founder/rounds", label: "Rounds", icon: Briefcase },
        { href: "/founder/messages", label: "Comms", icon: MessageSquare },
        { href: "/founder/collective", label: "Collective", icon: Sparkles },
      ]
    : [
        { href: "/investor/portfolio", label: "Portfolio", icon: PieChart },
        { href: "/investor/invitations", label: "Invitations", icon: Briefcase },
        { href: "/investor/messages", label: "Comms", icon: MessageSquare },
        { href: "/investor/apply-collective", label: "Collective", icon: Sparkles },
      ];
  // Sprint 18 Phase 2 hotfix — user reported the cream/amber tone didn't read as
  // a Capavate hero info-box. Restyled to dark Navy gradient (Collective parity)
  // with white text + Hydra-Teal accent ring on links.
  return (
    <div
      className="relative rounded-xl p-5 mb-6 text-white shadow-md"
      style={{
        background:
          "linear-gradient(135deg, hsl(219 45% 18%) 0%, hsl(219 45% 25%) 55%, hsl(184 70% 28%) 100%)",
      }}
      data-testid="box-capavate-guidance"
    >
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute top-2.5 right-2.5 h-7 w-7 inline-flex items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
        data-testid="button-dismiss-guidance"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-start gap-3.5">
        <div className="h-10 w-10 rounded-lg bg-white/15 text-white flex items-center justify-center shrink-0 ring-1 ring-white/20">
          <Lightbulb className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-base text-white">{c.title}</div>
          <p className="text-sm text-white/80 mt-1 max-w-3xl leading-relaxed">{c.body}</p>
          <div className="flex items-center gap-2 flex-wrap mt-3">
            {links.map(l => (
              <Link key={l.href} href={l.href}>
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-white px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 ring-1 ring-white/15"
                  data-testid={`link-guidance-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <l.icon className="h-3.5 w-3.5" />
                  {l.label}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
