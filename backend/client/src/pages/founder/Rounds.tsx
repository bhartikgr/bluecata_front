import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StateBadge, EmptyState } from "@/components/common";
import { Plus, Briefcase, Calendar, Users, ArrowRight, Lock } from "lucide-react";
import { fmtUSD, fmtPct, fmtDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

type Round = { id: string; company: string; name: string; type: string; state: string; targetAmount: number; raisedAmount: number; preMoney: number | null; postMoney: number | null; pricePerShare: number | null; minTicket: number | null; closeDate: string; termsSummary?: string; instrument?: string | null; valuationCap?: number | null; discount?: number | null; interestRate?: number | null; maturityMonths?: number | null; strikePrice?: number | null; expiryYears?: number | null; mfn?: boolean | null };

// BUG 034 — group instruments so the Edit-Terms dialog can show the right
// field set. Priced rounds use pre/post-money + PPS; SAFEs and notes use a
// valuation cap + discount (+ interest/maturity for notes); warrants use a
// strike price + expiry. Anything unmatched falls back to priced fields.
function instrumentFamily(instrument?: string | null): "priced" | "safe" | "note" | "warrant" {
  const i = (instrument ?? "").toLowerCase();
  if (i.includes("warrant")) return "warrant";
  if (i.includes("note") || i.includes("convertible")) return "note";
  if (i.includes("safe")) return "safe";
  return "priced";
}

const CLOSED_STATES = new Set(["closed", "funded"]);

const TYPE_LABEL: Record<string, string> = {
  foundation: "Foundation (Round 0)",
  preseed: "Pre-Seed",
  seed: "Seed",
  series_a: "Series A",
  series_b: "Series B",
  series_c: "Series C",
};

export default function Rounds() {
  // v23.4.5 BUG 020 fix: key the rounds query by activeCompanyId AND send the
  // companyId query param explicitly. Previously the query was keyed only by
  // "/api/rounds" so React Query served stale data after a company switch —
  // founder saw rounds from their previous company. The server already scopes
  // results when ?companyId= is passed and the caller owns the company.
  const activeCompanyId = useActiveCompanyId();
  const rounds = useQuery<Round[]>({
    queryKey: ["/api/rounds", activeCompanyId],
    enabled: Boolean(activeCompanyId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/rounds?companyId=${encodeURIComponent(activeCompanyId)}`);
      return res.json();
    },
  });
  const [editingRound, setEditingRound] = useState<Round | null>(null);
  const [, setLocation] = useLocation();

  return (
    <>
      <PageHeader
        title="Rounds"
        description="Foundation through Series C, each with its own state machine, terms, and soft-circle book."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Rounds" }]}
        actions={
          <Link href="/founder/rounds/new">
            <Button className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-new-round"><Plus className="h-4 w-4 mr-2" /> New round</Button>
          </Link>
        }
      />
      <PageBody>
        {rounds.data && rounds.data.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No rounds yet"
            description="Start with a Foundation round to set the cap table baseline, or jump to Pre-Seed to begin fundraising."
            action={{ label: "Create your first round", onClick: () => setLocation("/founder/rounds/new"), testid: "button-empty-create" }}
          />
        ) : (
          <div className="grid gap-4">
            {rounds.data?.map(r => {
              const pct = r.targetAmount > 0 ? (r.raisedAmount / r.targetAmount) * 100 : 0;
              return (
                <Card key={r.id} data-testid={`card-round-${r.id}`}>
                  <CardContent className="p-5">
                    <div className="flex flex-col md:flex-row md:items-start gap-5">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold">{r.name}</h3>
                          <StateBadge state={r.state} />
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{TYPE_LABEL[r.type] ?? r.type}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5" /> {r.company}</span>
                          <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> Target close {fmtDate(r.closeDate)}</span>
                          <span className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Min ticket {fmtUSD(r.minTicket ?? 0, { compact: true })}</span>
                        </div>

                        <div className="mt-4">
                          <div className="flex items-baseline justify-between text-sm mb-1">
                            <div>
                              <span className="font-semibold text-base">{fmtUSD(r.raisedAmount)}</span>{" "}
                              <span className="text-muted-foreground">soft-circled of {fmtUSD(r.targetAmount)}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">{fmtPct(pct, 0)} of target</div>
                          </div>
                          <div className="h-2 bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-[hsl(184_98%_22%)]" style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                          <div><div className="text-xs text-muted-foreground">Pre-money</div><div className="font-medium">{fmtUSD(r.preMoney ?? 0, { compact: true })}</div></div>
                          {/* B-504 fix v23.6: post-money derived inline from pre+target instead of reading stale postMoney field */}
                          <div><div className="text-xs text-muted-foreground">Post-money</div><div className="font-medium" data-testid={`post-money-${r.id}`}>{fmtUSD((Number(r.preMoney ?? 0) + Number(r.targetAmount ?? 0)), { compact: true })}</div></div>
                          <div><div className="text-xs text-muted-foreground">Price/share</div><div className="font-medium">${r.pricePerShare?.toFixed(2)}</div></div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 md:w-48">
                        <Link href={`/founder/rounds/${r.id}`}>
                          <Button className="w-full" variant="outline" data-testid={`button-open-${r.id}`}>Open <ArrowRight className="h-4 w-4 ml-2" /></Button>
                        </Link>
                        {CLOSED_STATES.has(r.state) ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="w-full inline-block">
                                  <Button variant="ghost" className="w-full text-muted-foreground" disabled aria-disabled="true" data-testid={`button-edit-${r.id}`}>
                                    <Lock className="h-3.5 w-3.5 mr-2" /> Edit terms
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Closed rounds are read-only</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setEditingRound(r)} data-testid={`button-edit-${r.id}`}>Edit terms</Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
      {editingRound && (
        <EditTermsDialog round={editingRound} onClose={() => setEditingRound(null)} />
      )}
    </>
  );
}

function EditTermsDialog({ round, onClose }: { round: Round; onClose: () => void }) {
  const { toast } = useToast();
  // BUG 034 — branch the editable field set by instrument family so SAFEs,
  // convertible notes, and warrants no longer show meaningless priced-round
  // fields (pre/post-money + PPS). The dialog flow is unchanged.
  const family = instrumentFamily(round.instrument);
  const [targetAmount, setTargetAmount] = useState(round.targetAmount);
  const [preMoney, setPreMoney] = useState(round.preMoney ?? 0);
  const [postMoney, setPostMoney] = useState(round.postMoney ?? 0);
  const [pricePerShare, setPricePerShare] = useState(round.pricePerShare ?? 0);
  const [minTicket, setMinTicket] = useState(round.minTicket ?? 0);
  const [closeDate, setCloseDate] = useState(round.closeDate);
  const [termsSummary, setTermsSummary] = useState(round.termsSummary ?? "");
  // Instrument extras (SAFE / note / warrant).
  const [valuationCap, setValuationCap] = useState(round.valuationCap ?? 0);
  const [discount, setDiscount] = useState(round.discount ?? 0);
  const [interestRate, setInterestRate] = useState(round.interestRate ?? 0);
  const [maturityMonths, setMaturityMonths] = useState(round.maturityMonths ?? 0);
  const [strikePrice, setStrikePrice] = useState(round.strikePrice ?? 0);
  const [expiryYears, setExpiryYears] = useState(round.expiryYears ?? 0);
  // MFN (Most-Favored-Nation) — sourced from the round's extras (extras_json).
  const [mfn, setMfn] = useState<boolean>(round.mfn === true);

  const saveMut = useMutation({
    mutationFn: async () => {
      // Only send the fields relevant to this instrument family; the server
      // PATCH ignores keys it does not recognize for the round and never
      // performs a retroactive migration of other rounds.
      const common = { targetAmount, minTicket, closeDate, termsSummary };
      const byFamily: Record<string, unknown> =
        family === "priced"
          ? { preMoney, postMoney, pricePerShare }
          : family === "warrant"
            ? { strikePrice, expiryYears }
            : family === "note"
              ? { valuationCap, discount, interestRate, maturityMonths, mfn }
              : { valuationCap, discount, mfn }; // safe
      const res = await apiRequest("PATCH", `/api/rounds/${round.id}/terms`, {
        ...common,
        ...byFamily,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.ok) {
        toast({ title: "Terms saved", description: `Bridge event ${data.eventType} emitted.` });
        queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
        onClose();
      } else {
        toast({ title: "Save failed", description: data?.error ?? "Validation", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-edit-terms">
        <DialogHeader>
          <DialogTitle>Edit terms — {round.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Target amount (USD)</Label>
            <Input type="number" min={0} value={targetAmount} onChange={e => setTargetAmount(Number(e.target.value))} className="mt-1" data-testid="input-target" />
          </div>
          <div>
            <Label>Min ticket (USD)</Label>
            <Input type="number" min={0} value={minTicket} onChange={e => setMinTicket(Number(e.target.value))} className="mt-1" data-testid="input-min-ticket" />
          </div>

          {family === "priced" && (
            <>
              <div>
                <Label>Pre-money valuation</Label>
                <Input type="number" min={0} value={preMoney} onChange={e => setPreMoney(Number(e.target.value))} className="mt-1" data-testid="input-pre-money" />
              </div>
              <div>
                <Label>Post-money valuation</Label>
                <Input type="number" min={0} value={postMoney} onChange={e => setPostMoney(Number(e.target.value))} className="mt-1" data-testid="input-post-money" />
              </div>
              <div>
                <Label>Price per share (USD)</Label>
                <Input type="number" step="0.0001" min={0} value={pricePerShare} onChange={e => setPricePerShare(Number(e.target.value))} className="mt-1" data-testid="input-pps" />
              </div>
            </>
          )}

          {(family === "safe" || family === "note") && (
            <>
              <div>
                <Label>Valuation cap (USD)</Label>
                <Input type="number" min={0} value={valuationCap} onChange={e => setValuationCap(Number(e.target.value))} className="mt-1" data-testid="input-valuation-cap" />
              </div>
              <div>
                <Label>Discount (%)</Label>
                <Input type="number" min={0} value={discount} onChange={e => setDiscount(Number(e.target.value))} className="mt-1" data-testid="input-discount" />
              </div>
            </>
          )}

          {family === "note" && (
            <>
              <div>
                <Label>Interest rate (% APR)</Label>
                <Input type="number" step="0.1" min={0} value={interestRate} onChange={e => setInterestRate(Number(e.target.value))} className="mt-1" data-testid="input-interest-rate" />
              </div>
              <div>
                <Label>Maturity (months)</Label>
                <Input type="number" min={0} value={maturityMonths} onChange={e => setMaturityMonths(Number(e.target.value))} className="mt-1" data-testid="input-maturity-months" />
              </div>
            </>
          )}

          {(family === "safe" || family === "note") && (
            <div className="col-span-2 flex items-center gap-3 rounded-md border border-border p-3">
              <Switch checked={mfn} onCheckedChange={setMfn} data-testid="switch-mfn" />
              <div>
                <Label className="cursor-pointer">MFN clause (Most-Favored-Nation)</Label>
                <p className="text-xs text-muted-foreground">Investor inherits any better terms granted to a later SAFE/Note holder before the priced round.</p>
              </div>
            </div>
          )}

          {family === "warrant" && (
            <>
              <div>
                <Label>Strike price (USD)</Label>
                <Input type="number" step="0.01" min={0} value={strikePrice} onChange={e => setStrikePrice(Number(e.target.value))} className="mt-1" data-testid="input-strike-price" />
              </div>
              <div>
                <Label>Expiry (years)</Label>
                <Input type="number" min={0} value={expiryYears} onChange={e => setExpiryYears(Number(e.target.value))} className="mt-1" data-testid="input-expiry-years" />
              </div>
            </>
          )}

          <div>
            <Label>Target close date</Label>
            <Input type="date" value={closeDate?.slice(0, 10)} onChange={e => setCloseDate(e.target.value)} className="mt-1" data-testid="input-close-date" />
          </div>
          <div className="col-span-2">
            <Label>Terms summary</Label>
            <Textarea rows={3} value={termsSummary} onChange={e => setTermsSummary(e.target.value)} className="mt-1" data-testid="textarea-terms-summary" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
            data-testid="button-save-terms"
          >Save terms</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
