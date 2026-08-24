/**
 * Sprint 18 Phase 2 — T4.4 Member Value & Intelligence box.
 *
 * Per SPRINT-18-MANDATE.md T4.4. Renders one card per cap-table holder showing
 * area-of-expertise and an experience signal (years, # rounds, # exits) WITHOUT
 * disclosing specific investments, plus quick-action buttons.
 *
 * Privacy: founder always sees REAL NAMES on their own cap table (R200 §16).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 110 · FINDING 6 — THE FIGURES IN THIS CARD WERE INVENTED FROM THE ARRAY
 * INDEX AND PRESENTED AS FACTS.
 * ════════════════════════════════════════════════════════════════════════════
 * `defaultYearsFor` / `defaultRoundsFor` / `defaultExitsFor` returned
 * `8 + (i % 7)`, `12 + (i % 18)` and `1 + (i % 4)` — arithmetic on the holder's
 * POSITION IN THE ARRAY — and the card printed the result in bold ("9y Investing
 * · 13 Rounds · 2 Exits") under a subtitle claiming the numbers were "drawn from
 * cross-platform signals". They were drawn from a loop counter: re-sorting the
 * table changed a holder's "years investing", and a holder reading the founder's
 * screen would read a figure about themselves that no system ever recorded.
 * `defaultExpertiseFor` was the same defect in words — every `investor` row was
 * tagged "Fintech · B2B SaaS" whether or not anything was known about them, and
 * every `founder` row "Founder · Operator".
 *
 * This platform refuses rather than guesses everywhere else, so the fabrications
 * are REMOVED, not softened, and no substitute figure is invented in their place.
 * A metric renders only when the upstream signal actually carries it; when a
 * holder has none, the card says so in words and shows no number at all. What
 * remains is all real: the resolved holder label, the holder type, region/sector
 * when recorded, and the DM / Post actions.
 *
 * There is no other computed figure in this component. The only remaining
 * index-derived value is the React `key` and the `data-testid` suffix, which are
 * machine-readable identifiers and are never rendered as text.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, MessageSquare, Send } from "lucide-react";
import { Link } from "wouter";
/* WAVE 108 · FINDING 3 — this card printed `holderName` raw, so a row whose
   stored name is an internal id rendered `u_redeemed_…` as a person's name, in
   bold, beside real people. Same resolver the holdings table uses. */
import { resolveHolderLabel } from "@/lib/captable/holderLabel";

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

/** A metric is shown only when a real, finite, non-negative number was recorded. */
function recordedMetric(value: number | undefined): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

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
        {/* WAVE 110 · FINDING 6 — the old subtitle claimed cross-platform
            provenance for figures that were computed from an array index. It now
            states exactly what this card shows and what it does not. */}
        <p className="text-xs text-muted-foreground mt-1" data-testid="text-member-value-provenance">
          Per-holder context, shown only where a holder's expertise or experience has actually been
          recorded. Nothing here is estimated or inferred, and specific investments are never
          disclosed.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {holders.map((h, i) => {
            const label = resolveHolderLabel(h.holderName, h.holderId);
            /* A DESCRIPTION has no initials — "RH" for "Redeemed holder" would
               read as a person's monogram. A neutral mark is used instead. */
            const initials = label.kind === "description" ? "·" : (label.text || "?")
              .split(" ")
              .map((s) => s[0])
              .filter(Boolean)
              .slice(0, 2)
              .join("")
              .toUpperCase();
            /* WAVE 110 · FINDING 6 — recorded values only. No default, no
               placeholder, no index arithmetic. */
            const expertise = h.expertise ?? [];
            const yrs = recordedMetric(h.yearsInvesting);
            const rnds = recordedMetric(h.roundsParticipated);
            const exits = recordedMetric(h.exitsAchieved);
            const metrics: { key: string; value: number; label: string; suffix: string }[] = [];
            if (yrs !== null) metrics.push({ key: "years", value: yrs, label: "Investing", suffix: "y" });
            if (rnds !== null) metrics.push({ key: "rounds", value: rnds, label: "Rounds", suffix: "" });
            if (exits !== null) metrics.push({ key: "exits", value: exits, label: "Exits", suffix: "" });
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
                    <div
                      className={`text-sm truncate ${label.kind === "description" ? "font-normal italic text-muted-foreground" : "font-medium"}`}
                      data-testid={`text-holder-name-${i}`}
                      data-holder-name-source={label.kind === "description" ? "described" : "recorded"}
                    >
                      {label.text}
                    </div>
                    <div className="text-[11px] text-muted-foreground capitalize">
                      {h.holderType}
                      {h.region ? ` · ${h.region}` : ""}
                      {h.sector ? ` · ${h.sector}` : ""}
                    </div>
                  </div>
                </div>
                {expertise.length > 0 && (
                  <div className="flex flex-wrap gap-1" data-testid={`holder-expertise-${i}`}>
                    {expertise.slice(0, 3).map((e) => (
                      <Badge key={e} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {e}
                      </Badge>
                    ))}
                  </div>
                )}
                {metrics.length > 0 ? (
                  <div
                    className="grid grid-cols-3 gap-2 text-center text-[11px]"
                    data-testid={`holder-metrics-${i}`}
                  >
                    {metrics.map((m) => (
                      <div key={m.key}>
                        <div className="font-semibold tabular-nums" data-testid={`holder-metric-${m.key}-${i}`}>
                          {m.value}
                          {m.suffix}
                        </div>
                        <div className="text-muted-foreground text-[10px]">{m.label}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  /* WAVE 110 · FINDING 6 — the honest state. Previously this branch
                     could not be reached because a figure was always invented. */
                  <div
                    className="text-[10px] text-muted-foreground leading-relaxed"
                    data-testid={`holder-metrics-unavailable-${i}`}
                  >
                    No experience record on file for this holder — years investing, rounds and exits
                    are not available rather than estimated.
                  </div>
                )}
                <div className="flex items-center gap-1.5 pt-1">
                  <Button size="sm" variant="outline" className="w-full h-7 text-[11px] flex-1" data-testid={`button-dm-${i}`} asChild>
                    <Link href={`/founder/messages?to=${encodeURIComponent(h.holderId ?? h.holderName)}`}>
                      <MessageSquare className="h-3 w-3 mr-1" /> DM
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" className="w-full h-7 text-[11px] flex-1" data-testid={`button-post-${i}`} asChild>
                    <Link href={`/founder/network-posts?compose=1&audience=${encodeURIComponent(h.holderId ?? h.holderName)}`}>
                      <Send className="h-3 w-3 mr-1" /> Post
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default MemberValueIntelligenceBox;
