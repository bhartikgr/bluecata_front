/**
 * Sprint 28 — Admin page intro block.
 *
 * Standard top-of-page component used across every admin section. Combines:
 *   - A title-level guidance card (what this section does, when to use it,
 *     consequences of changes, links to related sections).
 *   - A dynamic stats strip (live numbers relevant to this page) so the admin
 *     immediately sees the macro state without scrolling.
 *
 * Each admin page passes its own copy + stats; this component owns layout +
 * consistent styling so the admin section feels coherent.
 *
 * Sandbox-safe — pure presentational, no Web Storage APIs.
 */
import { useState } from "react";
import { Lightbulb, X, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AdminIntroStat = {
  label: string;
  value: string | number;
  hint?: string;
  /** Visual tone — neutral/positive/warning/critical changes the dot color. */
  tone?: "neutral" | "positive" | "warning" | "critical";
};

export type AdminIntroGuidance = {
  /** One-liner above the title — categorises the section. */
  eyebrow?: string;
  /** Bold section title. */
  title: string;
  /** Body paragraph — "what this section is for". */
  description: string;
  /** Optional warning bullet — appears in amber. */
  warning?: string;
  /** Optional reassurance bullet — appears in teal. */
  positive?: string;
  /** Optional related links shown as chips. */
  links?: Array<{ href: string; label: string; icon?: LucideIcon }>;
};

export function AdminPageIntro({
  guidance,
  stats,
}: {
  guidance: AdminIntroGuidance;
  stats?: AdminIntroStat[];
}) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <div className="mb-6 space-y-3" data-testid="admin-page-intro">
      {!dismissed && (
        <div
          className="relative rounded-xl p-5 text-white shadow-md"
          style={{
            background:
              "linear-gradient(135deg, hsl(219 45% 18%) 0%, hsl(219 45% 25%) 55%, hsl(0 100% 40%) 100%)",
          }}
          data-testid="admin-intro-guidance"
        >
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss guidance"
            className="absolute top-2.5 right-2.5 h-7 w-7 inline-flex items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white"
            data-testid="button-dismiss-admin-intro"
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-start gap-3.5">
            <div className="h-10 w-10 rounded-lg bg-white/15 text-white flex items-center justify-center shrink-0 ring-1 ring-white/20">
              <Lightbulb className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              {guidance.eyebrow && (
                <div className="text-[11px] uppercase tracking-widest text-white/70 mb-1">
                  {guidance.eyebrow}
                </div>
              )}
              <div className="font-semibold text-base text-white">{guidance.title}</div>
              <p className="text-sm text-white/85 mt-1.5 max-w-3xl leading-relaxed">
                {guidance.description}
              </p>
              {guidance.warning && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-500/15 ring-1 ring-amber-300/30 px-3 py-2 text-xs text-amber-100">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{guidance.warning}</span>
                </div>
              )}
              {guidance.positive && (
                <div className="mt-2 flex items-start gap-2 rounded-md bg-emerald-500/15 ring-1 ring-emerald-300/30 px-3 py-2 text-xs text-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{guidance.positive}</span>
                </div>
              )}
              {guidance.links && guidance.links.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  {guidance.links.map((l) => (
                    <a
                      key={l.href}
                      href={`#${l.href}`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-white px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 ring-1 ring-white/15"
                      data-testid={`admin-intro-link-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {l.icon && <l.icon className="h-3.5 w-3.5" />}
                      {l.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {dismissed && (
        <button
          type="button"
          onClick={() => setDismissed(false)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          data-testid="button-show-admin-intro"
        >
          <Info className="h-3.5 w-3.5" />
          Show guidance for this section
        </button>
      )}

      {stats && stats.length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 5)}, minmax(0, 1fr))` }}
          data-testid="admin-intro-stats"
        >
          {stats.map((s, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card px-4 py-3"
              data-testid={`admin-intro-stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    s.tone === "positive"
                      ? "bg-emerald-500"
                      : s.tone === "warning"
                      ? "bg-amber-500"
                      : s.tone === "critical"
                      ? "bg-rose-500"
                      : "bg-slate-400"
                  }`}
                />
                {s.label}
              </div>
              <div className="mt-1 font-semibold text-lg leading-tight" data-testid={`admin-intro-stat-value-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {s.value}
              </div>
              {s.hint && <div className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
