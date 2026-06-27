/**
 * Sprint 21 Wave A — MaIntelligenceCard
 *
 * Shows a compact M&A readiness rollup for the top 3 portfolio companies
 * by readiness score, using computeMaReadinessScore from the profile engine.
 *
 * Fetches /api/companies/:id/profile for each portfolio position and
 * computes the score client-side.
 */

import { useQueries } from "@tanstack/react-query";
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

// v25.13 NH5 — removed `useCompanyProfile` + `useMaRow` (they were only
// used by the deleted MaRollupItem and would have been flagged as unused).
// Equivalent logic is inlined in `MaRollupItems` below using `useQueries`.

// v25.13 NH5 — MaRollupItem removed; presentational `MaRollupRowView`
// (defined below) is used instead so no hooks run inside `.map()`.

/**
 * Inner component: uses `useQueries` (single hook call, variable array) to
 * fetch one profile per position. v25.13 NH5 — the prior implementation
 * called `useMaRow` (which internally calls `useQuery`) inside `.map()`, a
 * Rules-of-Hooks violation that would crash if `positions.length` ever
 * changed across renders.
 */
function MaRollupItems({ positions }: { positions: Position[] }) {
  const profileQueries = useQueries({
    queries: positions.map((pos) => ({
      queryKey: ["/api/companies", pos.companyId, "profile"],
      queryFn: async () => {
        const r = await apiRequest("GET", `/api/companies/${pos.companyId}/profile`);
        return r.json() as Promise<CompanyProfile>;
      },
      staleTime: 60_000,
    })),
  });

  const rows = positions.map((pos, idx) => {
    const profileQ = profileQueries[idx];
    if (!profileQ?.data) return { pos, row: null as MaRollupRow | null };
    try {
      const { score, components } = computeMaReadinessScore(profileQ.data.ma);
      const topSignals = components
        .filter((c) => c.awarded >= c.weight * 0.6)
        .sort((a, b) => b.awarded - a.awarded)
        .slice(0, 2)
        .map((c) => c.label);
      return {
        pos,
        row: { companyId: pos.companyId, companyName: pos.company, score, topSignals } as MaRollupRow,
      };
    } catch {
      return { pos, row: null as MaRollupRow | null };
    }
  });

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
      {top3.map(({ pos, row }, idx) => (
        <MaRollupRowView key={pos.companyId} pos={pos} row={row} rank={idx + 1} />
      ))}
    </div>
  );
}

/** Pure presentational row used by MaRollupItems; no hooks inside. */
function MaRollupRowView({ pos, row, rank }: { pos: Position; row: MaRollupRow | null; rank: number }) {
  if (!row) {
    return (
      <div
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

export function MaIntelligenceCard({ positions }: { positions: Position[] }) {
  return (
    <div
      className="rounded-md border border-border bg-secondary/20 px-4 py-3 mb-4"
      data-testid="ma-intelligence-card"
    >
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp className="h-3.5 w-3.5 text-[hsl(0_100%_40%)]" />
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
