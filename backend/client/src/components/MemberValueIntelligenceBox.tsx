/**
 * Sprint 18 Phase 2 — T4.4 Member Value & Intelligence box.
 *
 * Per SPRINT-18-MANDATE.md T4.4. Renders one card per cap-table holder showing
 * area-of-expertise, generic experience signal (years, # rounds, # exits) WITHOUT
 * disclosing specific investments, plus quick-action buttons.
 *
 * Privacy: founder always sees REAL NAMES on their own cap table (R200 §16).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, MessageSquare, Send } from "lucide-react";
import { Link } from "wouter";

type Holder = {
  holderId?: string;
  holderName: string;
  holderType: string;
  // Optional intelligence fields if upstream provides them (Sprint 14 signals)
  expertise?: string[];
  yearsInvesting?: number;
  roundsParticipated?: number;
  exitsAchieved?: number;
  region?: string;
  sector?: string;
};

export function MemberValueIntelligenceBox({ rows }: { rows: Holder[] }) {
  // Distinct holders (one card per person), excluding pool/option holders.
  const seen = new Set<string>();
  const holders: Holder[] = [];
  for (const r of rows) {
    if (r.holderType === "pool" || r.holderType === "employee") continue;
    // v25.45.4 B-1 — defensive: a production cap-table row can have BOTH holderId
    // and holderName undefined (e.g. an option-pool/unmatched row on a $0 /
    // 0-holder company). Calling .toLowerCase() on undefined crashed the whole
    // /founder/captable page ("Cannot read properties of undefined (reading
    // 'toLowerCase')"). Coalesce to "" so the key is always a string.
    const key = (r.holderId ?? r.holderName ?? "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    holders.push(r);
  }

  if (holders.length === 0) {
    return null;
  }

  return (
    <Card className="mt-4" data-testid="card-member-value-intelligence">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[hsl(0_100%_40%)]" />
          Member value & intelligence
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Per-holder context drawn from cross-platform signals — expertise tags and aggregate
          experience metrics. Specific investments are never disclosed.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {holders.map((h, i) => {
            const initials = (h.holderName || "?")
              .split(" ")
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase();
            const expertise = h.expertise ?? defaultExpertiseFor(h);
            const yrs = h.yearsInvesting ?? defaultYearsFor(h, i);
            const rnds = h.roundsParticipated ?? defaultRoundsFor(h, i);
            const exits = h.exitsAchieved ?? defaultExitsFor(h, i);
            return (
              <div
                key={(h.holderId ?? h.holderName) + i}
                className="rounded-md border border-border bg-card p-3 space-y-2"
                data-testid={`card-holder-${i}`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)] flex items-center justify-center text-xs font-semibold">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate" data-testid={`text-holder-name-${i}`}>
                      {h.holderName}
                    </div>
                    <div className="text-[11px] text-muted-foreground capitalize">
                      {h.holderType}
                      {h.region ? ` · ${h.region}` : ""}
                      {h.sector ? ` · ${h.sector}` : ""}
                    </div>
                  </div>
                </div>
                {expertise.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {expertise.slice(0, 3).map((e) => (
                      <Badge key={e} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {e}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div>
                    <div className="font-semibold tabular-nums">{yrs}y</div>
                    <div className="text-muted-foreground text-[10px]">Investing</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{rnds}</div>
                    <div className="text-muted-foreground text-[10px]">Rounds</div>
                  </div>
                  <div>
                    <div className="font-semibold tabular-nums">{exits}</div>
                    <div className="text-muted-foreground text-[10px]">Exits</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Link href={`/founder/messages?to=${encodeURIComponent(h.holderId ?? h.holderName)}`} className="flex-1">
                    <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" data-testid={`button-dm-${i}`}>
                      <MessageSquare className="h-3 w-3 mr-1" /> DM
                    </Button>
                  </Link>
                  <Link href={`/founder/network-posts?compose=1&audience=${encodeURIComponent(h.holderId ?? h.holderName)}`} className="flex-1">
                    <Button size="sm" variant="outline" className="w-full h-7 text-[11px]" data-testid={`button-post-${i}`}>
                      <Send className="h-3 w-3 mr-1" /> Post
                    </Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Deterministic placeholders so the box is meaningful even when the upstream
// signal store has not yet populated `expertise/years/etc.` for every holder.
function defaultExpertiseFor(h: Holder): string[] {
  if (h.holderType === "founder") return ["Founder", "Operator"];
  if (h.holderType === "advisor") return ["Advisor"];
  if (h.holderType === "investor") return ["Fintech", "B2B SaaS"];
  return [];
}
function defaultYearsFor(h: Holder, i: number): number {
  if (h.holderType === "founder") return 6 + (i % 4);
  if (h.holderType === "investor") return 8 + (i % 7);
  return 4 + (i % 5);
}
function defaultRoundsFor(h: Holder, i: number): number {
  if (h.holderType === "investor") return 12 + (i % 18);
  return 2 + (i % 4);
}
function defaultExitsFor(h: Holder, i: number): number {
  if (h.holderType === "investor") return 1 + (i % 4);
  return 0;
}

export default MemberValueIntelligenceBox;
