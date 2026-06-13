/**
 * Sprint 21 Wave A — MaIntelligenceCard
 *
 * Shows a compact M&A readiness rollup for the top 3 portfolio companies
 * by readiness score, using computeMaReadinessScore from the profile engine.
 *
 * Fetches /api/companies/:id/profile for each portfolio position and
 * computes the score client-side.
 */

import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  computeMaReadinessScore,
  type CompanyProfile,
} from "@/lib/profile/types";

type Position = {
  companyId: string;
  company: string;
};

type MaRollupRow = {
  companyId: string;
  companyName: string;
  score: number;
  topSignals: string[];
};

function useCompanyProfile(companyId: string) {
  return useQuery<CompanyProfile>({
    queryKey: ["/api/companies", companyId, "profile"],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/companies/${companyId}/profile`);
      return r.json();
    },
    staleTime: 60_000,
  });
}

/** Single row — fetches profile + computes score. Returns null while loading. */
function useMaRow(pos: Position): MaRollupRow | null {
  const profileQ = useCompanyProfile(pos.companyId);
  if (!profileQ.data) return null;
  try {
    const { score, components } = computeMaReadinessScore(profileQ.data.ma);
    const topSignals = components
      .filter((c) => c.awarded >= c.weight * 0.6)
      .sort((a, b) => b.awarded - a.awarded)
      .slice(0, 2)
      .map((c) => c.label);
    return { companyId: pos.companyId, companyName: pos.company, score, topSignals };
  } catch {
    return null;
  }
}

/** Aggregates MA rows — rendered per-position so hooks are stable. */
function MaRollupItem({ pos, rank }: { pos: Position; rank: number }) {
  const row = useMaRow(pos);
  if (!row) {
    return (
      <div
        key={pos.companyId}
        className="flex items-center gap-3 py-2"
        data-testid={`ma-card-row-${pos.companyId}`}
      >
        <span className="text-xs text-muted-foreground w-4 text-right">{rank}.</span>
        <span className="text-sm font-medium flex-1">{pos.company}</span>
        <span className="text-sm text-muted-foreground font-mono">—</span>
      </div>
    );
  }

  const scoreColor =
    row.score >= 70
      ? "text-emerald-700"
      : row.score >= 45
      ? "text-amber-700"
      : "text-rose-700";

  return (
    <div
      className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0"
      data-testid={`ma-card-row-${pos.companyId}`}
    >
      <span className="text-xs text-muted-foreground w-4 text-right mt-0.5">{rank}.</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{row.companyName}</span>
          <span className={`font-mono tabular-nums text-sm font-semibold ${scoreColor}`}>
            {row.score}/100
          </span>
        </div>
        {row.topSignals.length > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {row.topSignals.map((s) => (
              <span
                key={s}
                className="text-[10px] px-1.5 h-4 rounded-full bg-secondary text-muted-foreground inline-flex items-center"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Inner component: calls useMaRow hooks (must be called at component level, not in callbacks) */
function MaRollupItems({ positions }: { positions: Position[] }) {
  // DEF-056: compute rows for all positions so we can sort them
  // Hooks are called for each position in a fixed order (positions should be stable)
  const rows = positions.map((pos) => ({ pos, row: useMaRow(pos) }));
  // Sort loaded rows by score descending; unloaded rows go to end
  const sorted = [...rows].sort((a, b) => {
    if (a.row && b.row) return b.row.score - a.row.score;
    if (a.row) return -1;
    if (b.row) return 1;
    return 0;
  });
  const top3 = sorted.slice(0, 3);
  return (
    <div className="divide-y divide-border/50">
      {top3.map(({ pos }, idx) => (
        <MaRollupItem key={pos.companyId} pos={pos} rank={idx + 1} />
      ))}
    </div>
  );
}

export function MaIntelligenceCard({ positions }: { positions: Position[] }) {
  return (
    <div
      className="rounded-md border border-border bg-secondary/20 px-4 py-3 mb-4"
      data-testid="ma-intelligence-card"
    >
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="h-3.5 w-3.5 text-[hsl(184_98%_22%)]" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          M&amp;A Readiness Rollup
        </span>
      </div>

      {/* DEF-056: MaRollupItems handles hook ordering and score-based sorting */}
      <MaRollupItems positions={positions} />

      <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
        M&amp;A readiness is computed by the Collective M&amp;A Intelligence engine using strategic
        priorities, transaction interest, partner type, and dealbreakers signals.
      </p>
    </div>
  );
}
