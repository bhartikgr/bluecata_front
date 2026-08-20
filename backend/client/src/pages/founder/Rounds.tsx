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
import { Plus, Briefcase, Calendar, Users, ArrowRight, Lock, Archive, ArchiveRestore } from "lucide-react";
import { fmtUSD, fmtPct, fmtDate } from "@/lib/format";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
/* WAVE 58b · DEFECT 2 + DEFECT 3 — the pool edit surface uses the SAME derivation
   function as the create wizard and the SAME base reconciler as the engine path,
   so a pool edited here cannot produce a different number from one created in the
   wizard. Two implementations of one piece of cap-table arithmetic is the defect
   class this wave is closing, so there is only ever one. */
import {
  derivePoolTopUpFromPercent,
  parsePoolPercentAsWritten,
  formatPct,
  /* WAVE 58c · A1 — exact-decimal comparison of the SAVED price against the
     DERIVED price. Lives in the math module so there is one implementation and
     it is unit-testable without a browser. */
  comparePricePerShare,
  PRICE_PER_SHARE_DECIMALS,
} from "@/lib/roundMath";
import {
  resolveFdPreMoneyBase,
  unconvertedConvertibleCount,
  /* WAVE 58c · A3 — the NON-THROWING ledger read. `ledgerFullyDilutedPreMoneyShares`
     throws at render scope on a committed SAFE/note carrying `discount: 20` (the
     R16 percent-as-written house convention, passed through unchanged by
     `server/routes.ts` `buildCompanySecurities`), which took this dialog to the
     ErrorBoundary fallback. Proved by execution — see
     `build_log/wave58cd/probe_before.mts`. */
  tryLedgerFullyDilutedPreMoneyShares,
  /* WAVE 58e · D1/D2/D3 — the ONE range rule and the ONE disclosure, shared with
     the wizard AND with the two HTTP writers, so no two surfaces can disagree. */
  validateDiscountPercentAsWritten,
  validateInterestRatePercentAsWritten,
  describeDiscount,
  /* WAVE 69 · V-1 (R58) — the FOUR R50 ranges that had a server fence and NO
     client gate. Same functions the two HTTP writers call
     (`server/routes.ts` `boundedTerm(...)`), so no two surfaces can disagree. */
  validateMaturityMonths,
  validateExpiryYears,
  validateStrikePrice,
  validateValuationCap,
  /* WAVE 69 · V-2 (R56) — the approved date-shape WARNING, reaching a screen for
     the first time. It WARNS; it never blocks and never refuses (that is R42's
     domain and the two must not be conflated). */
  dateShapedValueWarning,
  /* WAVE 76 · R58 / R21 — the two CLOSED vocabularies, read off the SERVER's own
     exported constants so this dialog cannot offer a token the writer refuses. */
  ANTI_DILUTION_TYPES_FOR_INPUT,
  SAFE_CAP_TYPES_FOR_INPUT,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";
/* WAVE 69 · R58 — `ApiError.message` is capped at 240 chars by queryClient.ts:63
   and replaced with a generic sentence; the real refusal (424-543 chars) lives on
   `ApiError.payload.message`. See the module header. */
import { serverRefusalMessage } from "@/lib/serverRefusalMessage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Round = { id: string; company: string; name: string; type: string; state: string; targetAmount: number; raisedAmount: number; preMoney: number | null; postMoney: number | null; pricePerShare: number | null; minTicket: number | null; closeDate: string; termsSummary?: string; instrument?: string | null; valuationCap?: number | null; discount?: number | null; interestRate?: number | null; maturityMonths?: number | null; strikePrice?: number | null; expiryYears?: number | null; mfn?: boolean | null; archivedAt?: string | null; createdAt?: string | null };

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

// v25.53 5a — Edit-terms money fields previously rendered as raw <input
// type="number"> (e.g. "18000000"), which is hard to read for large figures.
// MoneyInput displays a thousands-separated value while keeping the bound state
// a plain number so the PATCH payload and numeric precision are unchanged.
// Decimals are preserved (formatting only groups the integer part).
function formatMoney(raw: string): string {
  if (raw == null || raw === "") return "";
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "") return "";
  const [intPart, ...rest] = cleaned.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimal = rest.length > 0 ? "." + rest.join("") : (cleaned.endsWith(".") ? "." : "");
  return grouped + decimal;
}
function MoneyInput(props: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  "data-testid"?: string;
}) {
  const { value, onChange, ...rest } = props;
  const [draft, setDraft] = useState<string | null>(null);
  // While focused/editing we track a raw string draft so a trailing "." or an
  // in-progress number never gets clobbered by the numeric round-trip.
  const display = draft != null ? formatMoney(draft) : (Number.isFinite(value) ? formatMoney(String(value)) : "");
  return (
    <Input
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value.replace(/[,\s$]/g, "");
        setDraft(raw);
        const n = Number(raw);
        onChange(raw === "" ? 0 : (Number.isFinite(n) ? n : value));
      }}
      onBlur={() => setDraft(null)}
      {...rest}
    />
  );
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
  const { toast } = useToast();

  // v25.54 G0-2 — archive / unarchive. Archived rounds stay VISIBLE-BUT-INERT.
  // The server refuses (409 ROUND_HAS_CAPTABLE_ENTRIES) if the round has any
  // committed or in-flight cap-table entries; surface that message verbatim.
  const archiveMut = useMutation({
    mutationFn: async (vars: { id: string; archived: boolean }) => {
      const path = vars.archived
        ? `/api/founder/rounds/${vars.id}/unarchive`
        : `/api/founder/rounds/${vars.id}/archive`;
      const res = await apiRequest("POST", path);
      return res.json();
    },
    onSuccess: (data, vars) => {
      if (data?.ok) {
        toast({ title: vars.archived ? "Round unarchived" : "Round archived" });
        queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
      } else {
        toast({
          title: vars.archived ? "Unarchive failed" : "Archive failed",
          description: data?.message ?? data?.error ?? "Please try again.",
          variant: "destructive",
        });
      }
    },
    onError: () => toast({ title: "Request failed", variant: "destructive" }),
  });

  return (
    <>
      <PageHeader
        title="Rounds"
        description="Foundation through Series C, each with its own state machine, terms, and soft-circle book."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Rounds" }]}
        actions={
          // F4 — a real single <button> that navigates via setLocation. The old
          // Link-wrapping-Button form rendered a button nested inside an anchor
          // (invalid interactive nesting), the shared cause of the primary-action
          // "first click no-ops" symptom. A real button acts on the first click.
          <Button
            className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white"
            data-testid="button-new-round"
            onClick={() => setLocation("/founder/rounds/new")}
          >
            <Plus className="h-4 w-4 mr-2" /> New round
          </Button>
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
            {/* Wave C1 (Shadie 6a) — newest (latest-created) round on TOP, oldest
                at the bottom: sort by createdAt DESC. Stable tiebreak on id so
                two rounds sharing a createdAt keep a deterministic order.
                Sort a COPY (never mutate the query cache). */}
            {[...(rounds.data ?? [])]
              .sort((a, b) => {
                const at = a.createdAt ? Date.parse(a.createdAt) : 0;
                const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
                if (bt !== at) return bt - at; // newest first
                return String(b.id).localeCompare(String(a.id));
              })
              .map(r => {
              const pct = r.targetAmount > 0 ? (r.raisedAmount / r.targetAmount) * 100 : 0;
              const isArchived = Boolean(r.archivedAt);
              return (
                <Card key={r.id} data-testid={`card-round-${r.id}`} style={isArchived ? { opacity: 0.6, borderColor: "var(--cv-color-border)" } : undefined}>
                  <CardContent className="p-5">
                    <div className="flex flex-col md:flex-row md:items-start gap-5">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold">{r.name}</h3>
                          <StateBadge state={r.state} />
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{TYPE_LABEL[r.type] ?? r.type}</Badge>
                          {isArchived && (
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide"
                              style={{ color: "var(--cv-color-text-muted)", borderColor: "var(--cv-color-border)" }}
                              data-testid={`badge-archived-${r.id}`}
                            >Archived</Badge>
                          )}
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
                            <div className="h-full bg-[hsl(0_100%_40%)]" style={{ width: `${Math.min(100, pct)}%` }} />
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
                        <Button className="w-full" variant="outline" data-testid={`button-open-${r.id}`} asChild>
                          <Link href={`/founder/rounds/${r.id}`}>Open <ArrowRight className="h-4 w-4 ml-2" /></Link>
                        </Button>
                        {isArchived ? (
                          // Archived rounds are inert: no edit; only un-archive.
                          <Button
                            variant="ghost"
                            className="w-full text-muted-foreground"
                            onClick={() => archiveMut.mutate({ id: r.id, archived: true })}
                            disabled={archiveMut.isPending}
                            data-testid={`button-unarchive-${r.id}`}
                          ><ArchiveRestore className="h-3.5 w-3.5 mr-2" /> Unarchive</Button>
                        ) : (
                          <>
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
                            <Button
                              variant="ghost"
                              className="w-full text-muted-foreground"
                              onClick={() => archiveMut.mutate({ id: r.id, archived: false })}
                              disabled={archiveMut.isPending}
                              data-testid={`button-archive-${r.id}`}
                            ><Archive className="h-3.5 w-3.5 mr-2" /> Archive</Button>
                          </>
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
  // v24.4 BUG 049 — round name is editable after creation.
  const [name, setName] = useState(round.name ?? "");
  const [targetAmount, setTargetAmount] = useState(round.targetAmount);
  const [preMoney, setPreMoney] = useState(round.preMoney ?? 0);
  // v24.1 Bug C (Avi #3): for legacy rows that persisted a null post-money,
  // fall back to the derived preMoney + targetAmount so the dialog never shows 0.
  const [postMoney, setPostMoney] = useState(
    round.postMoney ?? ((round.preMoney || 0) + (round.targetAmount || 0)),
  );
  const [pricePerShare, setPricePerShare] = useState(round.pricePerShare ?? 0);
  const [minTicket, setMinTicket] = useState(round.minTicket ?? 0);
  const [closeDate, setCloseDate] = useState(round.closeDate);
  const [termsSummary, setTermsSummary] = useState(round.termsSummary ?? "");
  // Instrument extras (SAFE / note / warrant).
  const [valuationCap, setValuationCap] = useState(round.valuationCap ?? 0);
  const [discount, setDiscount] = useState(round.discount ?? 0);
  const [interestRate, setInterestRate] = useState(round.interestRate ?? 0);
  /* ══════════════════════════════════════════════════════════════════════════
     WAVE 58f · FOLD-IN 1 — PRESENCE IS ITS OWN FACT. 0% IS NOT "NO DISCOUNT".
     ══════════════════════════════════════════════════════════════════════════
     WHAT WAS WRONG. `discount` seeded to `round.discount ?? 0` and was sent
     UNCONDITIONALLY, so a founder who opened a SAFE with NO discount and saved
     any other field wrote an explicit `0%` discount onto the instrument. A 0%
     discount and NO discount are different facts about a contract: the first
     says the parties agreed the investor converts at the round price with no
     concession; the second says the instrument is silent. The platform does not
     get to invent the first one.

     WHY A SEPARATE FLAG RATHER THAN A NULLABLE FIELD. An `<Input type="number">`
     cannot represent absence — an emptied box yields `""`, and `Number("")` is
     `0`, which IS the defect. Presence is therefore tracked as its own boolean,
     seeded from what is actually stored. This is also why the two number inputs
     below are left BYTE-IDENTICAL: rewriting their `onChange` bodies would
     register with the silent-drop guard as the REMOVAL of two baselined event
     handlers, and this wave's allow-list is frozen at 43 by owner ruling. The
     fix is purely ADDITIVE, so no handler, field or control is lost.

     THE THREE STATES ON THE WIRE:
       · unchecked            → `discount: null`  = EXPLICIT REMOVAL / silent
       · checked, box at 0    → `discount: 0`     = a negotiated 0%
       · checked, box at 20   → `discount: 20`    = 20%, percent-as-written (R16) */
  const [discountPresent, setDiscountPresent] = useState<boolean>(round.discount != null);
  const [interestRatePresent, setInterestRatePresent] = useState<boolean>(round.interestRate != null);
  const [maturityMonths, setMaturityMonths] = useState(round.maturityMonths ?? 0);
  const [strikePrice, setStrikePrice] = useState(round.strikePrice ?? 0);
  const [expiryYears, setExpiryYears] = useState(round.expiryYears ?? 0);
  // MFN (Most-Favored-Nation) — sourced from the round's extras (extras_json).
  const [mfn, setMfn] = useState<boolean>(round.mfn === true);
  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 58b · DEFECT 2 — THE POOL, EDITABLE, SEEDED FROM WHAT IS STORED.
     ═══════════════════════════════════════════════════════════════════════════
     Both keys live in `rounds.extras_json` and are re-spread onto the round by
     `roundsStore.rowToRound`, so they are read here exactly as any other term is.
     PERCENT-AS-WRITTEN (R16): the stored `"15"` is put in the field as `"15"`.
     A round with no pool seeds a blank field and an unchecked toggle — blank is
     not zero, and the toggle is what distinguishes "no pool" from "0% pool". */
  const storedPoolPercent = (round as unknown as Record<string, unknown>).optionPoolPostPercent;
  const storedPoolMode = (round as unknown as Record<string, unknown>).optionPoolMode;
  const [poolOn, setPoolOn] = useState<boolean>(
    storedPoolPercent !== undefined && storedPoolPercent !== null && String(storedPoolPercent) !== "",
  );
  const [poolPercent, setPoolPercent] = useState<string>(
    storedPoolPercent === undefined || storedPoolPercent === null ? "" : String(storedPoolPercent),
  );
  const [poolMode, setPoolMode] = useState<"pre_money" | "post_money">(
    String(storedPoolMode ?? "pre_money") === "post_money" ? "post_money" : "pre_money",
  );
  const [fdShares, setFdShares] = useState<string>(
    (round as unknown as Record<string, unknown>).fdPreMoneyShares == null
      ? ""
      : String((round as unknown as Record<string, unknown>).fdPreMoneyShares),
  );
  /* ═════════════════════════════════════════════════════════════════════════
     WAVE 75 · ITEM 2 (W74 finding N-2) — THE FIELD THE REFUSAL ASKS FOR.
     ═════════════════════════════════════════════════════════════════════════
     `GET /api/founder/captable/waterfall` refuses a preferred round with
     `liquidation_term_not_on_record` and tells the founder to *"Record the
     liquidation preference on the round's terms."* Until this wave there was NO
     control anywhere in `client/` that could do it (`grep -rn liquidationPreference
     client/src` → zero non-termsheet hits) and the PATCH route discarded the key
     on a 200. R58's rule is that a server fix which no screen reaches is not a
     user-visible fix, so the control is added here, on the only post-creation
     terms surface, seeded from the round's own stored value. */
  const [liqPref, setLiqPref] = useState<string>(
    (round as unknown as Record<string, unknown>).liquidationPreference == null
      ? ""
      : String((round as unknown as Record<string, unknown>).liquidationPreference),
  );
  /* ══════════════════════════════════════════════════════════════════
     WAVE 76 · R58 — THE TWO TERMS NO SCREEN IN THIS BUILD COULD SEND.
     ══════════════════════════════════════════════════════════════════
     MEASURED, exactly as Wave 75 measured `liquidationPreference`:
     `grep -rn "antiDilutionType\|safeType" client/src --include=*.tsx --include=*.ts`
     minus tests returned ZERO files. So `UnknownAntiDilutionTermError`
     (`shared/roundMathEngineAdapter.ts`) told the founder to *"Record the class's
     anti-dilution term on the round that issued it, then re-run the projection"* —
     and no control in this application could record it. A refusal that instructs
     the impossible is the dead-promise class the owner forbids by name, and it is
     the SAME defect Wave 75 removed for the preference multiple.

     THE VOCABULARY IS NOT RETYPED HERE. Both option lists come from the server's
     own exported constants, so a control can never offer a token the writer would
     refuse or the engine would reject — which is the drift that made `"FULL_RATCHET"`
     storable in the first place. A `<Select>` rather than a text box is the point:
     these are CLOSED vocabularies, and free text is what produced the near-misses.

     THE EMPTY OPTION IS AN EXPLICIT REMOVAL, and it is labelled as one. "Not on
     record" is a real and different state from `"none"`: `"none"` means the class
     negotiated no anti-dilution protection, while absent means nobody has said, and
     only the second makes a down-round projection refuse. Two states, two labels,
     never collapsed into one. */
  const [antiDilutionType, setAntiDilutionType] = useState<string>(
    (round as unknown as Record<string, unknown>).antiDilutionType == null
      ? ""
      : String((round as unknown as Record<string, unknown>).antiDilutionType),
  );
  const [safeType, setSafeType] = useState<string>(
    (round as unknown as Record<string, unknown>).safeType == null
      ? ""
      : String((round as unknown as Record<string, unknown>).safeType),
  );
  /* DEFECT 3 — the LEDGER's own fully-diluted count, from the same endpoint the
     engine and the cap-table page read. It is fetched, not assumed, so the
     reconciliation below compares two real numbers. */
  const editCompanyId = String((round as unknown as Record<string, unknown>).companyId ?? "");
  const editSecurities = useQuery<ApiSecurity[]>({
    queryKey: ["/api/companies", editCompanyId, "securities"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/companies/${encodeURIComponent(editCompanyId)}/securities`)).json(),
    enabled: !!editCompanyId && family === "priced",
  });
  /* WAVE 58c · A3 — refusal, not throw. `null` still means "not loaded yet". */
  const editLedger = editSecurities.data ? tryLedgerFullyDilutedPreMoneyShares(editSecurities.data) : null;
  const editLedgerFd = editLedger !== null && editLedger.ok ? editLedger.shares : null;
  const editExistingPool = editSecurities.data
    ? editSecurities.data
        .filter((x) => x.instrument === "option")
        .reduce((sum, x) => sum + Number(x.shares ?? 0), 0)
        .toString()
    : null;
  const editBase =
    editLedgerFd === null
      ? null
      : resolveFdPreMoneyBase({
          declaredFdPreMoneyShares: fdShares,
          ledgerFdShares: editLedgerFd,
          outstandingConvertibles: unconvertedConvertibleCount(editSecurities.data ?? []),
        });
  const editPoolPercentCheck = poolOn ? parsePoolPercentAsWritten(poolPercent) : null;
  const editPoolDerivation =
    poolOn && editBase && editBase.ok && editExistingPool !== null
      ? derivePoolTopUpFromPercent({
          poolPercentPostMoney: poolPercent,
          poolPlacement: poolMode,
          fdPreMoneyShares: editBase.base.toString(),
          preMoneyValuation: String(preMoney ?? ""),
          investmentAmount: String(targetAmount ?? ""),
          existingPoolShares: editExistingPool,
        })
      : null;
  /* ════════════════════════════════════════════════════════════════════
     WAVE 58c · A1 — THE SAVED PRICE AND THE DERIVED PRICE CAN NO LONGER DISAGREE
     SILENTLY. See `comparePricePerShare` in `client/src/lib/roundMath.ts` for the
     defect, the `file:line` evidence and why the comparison is exact-decimal.
     `null` = nothing to compare (no pool derivation on screen). It is NEVER read
     as agreement. */
  const editPriceAgreement =
    family === "priced" && poolOn && editPoolDerivation && editPoolDerivation.ok
      ? comparePricePerShare(pricePerShare, editPoolDerivation.pricePerShare)
      : null;
  const editPriceContradicted = editPriceAgreement !== null && !editPriceAgreement.agrees;

  /* ═════════════════════════════════════════════════════════════════
     WAVE 58e · D2 + D3 — THE TERM RANGES AND THE INVESTOR-GRADE DISCLOSURE.
     ═════════════════════════════════════════════════════════════════
     Computed at render scope from the SAME shared functions the server routes use.
     `null` when the field is not on screen for this instrument family — absence is
     never read as validity. The conversion price is quoted against the round's OWN
     stored price per share when there is one; a SAFE has none, and the panel says
     so rather than inventing one. */
  const editDiscountVerdict =
    (family === "safe" || family === "note") && discountPresent
      ? validateDiscountPercentAsWritten(discount)
      : null;
  const editInterestVerdict = family === "note" ? validateInterestRatePercentAsWritten(interestRate) : null;
  const editDiscountDisclosure =
    (family === "safe" || family === "note") && discountPresent
      ? describeDiscount(discount, round.pricePerShare)
      : null;
  /* ═════════════════════════════════════════════════════════════════
     WAVE 69 · V-1 (R58 row 1) — THE OTHER FOUR R50 TERMS NOW HAVE A CLIENT GATE.
     ═════════════════════════════════════════════════════════════════
     Wave 58e gated `discount` and `interestRate` only. `maturityMonths`,
     `expiryYears`, `strikePrice` and `valuationCap` were fenced on the SERVER by
     R50/Wave 61b and on the client by nothing at all — the founder typed
     `20260707`, pressed Save, and got the two words "Save failed".

     THE `> 0` GUARDS ARE DELIBERATE AND MUST NOT BE DROPPED. `valuationCap` and
     `strikePrice` seed from `round.X ?? 0` and `0` means ABSENT here (Wave 61b,
     the `capField`/`strikeField` omission below). Validating the raw `0` would
     disable Save on every UNCAPPED SAFE and every strike-less warrant — the exact
     regression Wave 61b removed. `null` is "nothing to check", never "valid". */
  const editMaturityVerdict = family === "note" ? validateMaturityMonths(maturityMonths) : null;
  const editExpiryVerdict = family === "warrant" ? validateExpiryYears(expiryYears) : null;
  const editStrikeVerdict = family === "warrant" && strikePrice > 0 ? validateStrikePrice(strikePrice) : null;
  const editCapVerdict =
    (family === "safe" || family === "note") && valuationCap > 0 ? validateValuationCap(valuationCap) : null;
  /* ═════════════════════════════════════════════════════════════════
     WAVE 69 · V-2 (R56) — WARN, DO NOT REFUSE, AND DO NOT BLOCK.
     ═════════════════════════════════════════════════════════════════
     `20260707` is BOTH a plausible date (2026-07-07) and a legitimate cap of
     20,260,707. R56: the value is accepted, the save proceeds, the control is
     untouched — the founder is simply TOLD. These two values are NOT folded into
     `editTermsOutOfRange`; doing so would turn the ruling's warning into a
     refusal. Trigger narrowness is the shared function's, not restated here. */
  const editCapDateShape =
    family === "safe" || family === "note" ? dateShapedValueWarning("valuationCap", valuationCap) : null;
  const editStrikeDateShape = family === "warrant" ? dateShapedValueWarning("strikePrice", strikePrice) : null;
  const editTermsOutOfRange =
    (editDiscountVerdict !== null && !editDiscountVerdict.ok) ||
    (editInterestVerdict !== null && !editInterestVerdict.ok) ||
    (editMaturityVerdict !== null && !editMaturityVerdict.ok) ||
    (editExpiryVerdict !== null && !editExpiryVerdict.ok) ||
    (editStrikeVerdict !== null && !editStrikeVerdict.ok) ||
    (editCapVerdict !== null && !editCapVerdict.ok);
  /* WAVE 69 · V-1 — the server's OWN refusal sentence, held in state so it is
     PERSISTENT. A toast is not sufficient: measured in jsdom, the node is gone
     ~10 s after it appears, and these sentences are 424-543 characters. */
  const [saveRefusal, setSaveRefusal] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      /* WAVE 69 · V-1 — a stale refusal must never outlive its cause. Cleared at
         the top of every attempt, so what is on screen always describes THIS
         save. */
      setSaveRefusal(null);
      // Only send the fields relevant to this instrument family; the server
      // PATCH ignores keys it does not recognize for the round and never
      // performs a retroactive migration of other rounds.
      // v24.4 BUG 049 — include the (trimmed) round name. The server rejects an
      // empty name with 400, so guard client-side too.
      const common = { name: name.trim(), targetAmount, minTicket, closeDate, termsSummary };
      /* ═════════════════════════════════════════════════════════════
         WAVE 61b · R50 — DO NOT SEND A ZERO NOBODY TYPED.
         ═════════════════════════════════════════════════════════════
         `valuationCap` and `strikePrice` seed from `round.X ?? 0` (above) and
         were sent UNCONDITIONALLY. For an UNCAPPED SAFE — the ordinary
         discount-only case — that wrote an explicit `$0 cap` onto the instrument
         on every save, which is the same fabricated-zero defect Wave 58f removed
         from `discount`.

         It also matters for R50: the owner bounded these two fields to
         `(0, max]`, so a fabricated `0` would now be REFUSED by the server and
         the founder's Save button would 400 on every uncapped SAFE and every
         strike-less warrant. Omitting the key means the server leaves the stored
         value UNTOUCHED (the documented ABSENT state), so the control keeps
         working and no value is invented. NOTHING IS HIDDEN: both inputs, both
         labels and both onChange handlers are byte-identical — only the request
         body changes. This mirrors the `fdShares` idiom below, which already
         omits a blank field rather than sending 0. */
      const capField: Record<string, unknown> = valuationCap > 0 ? { valuationCap } : {};
      const strikeField: Record<string, unknown> = strikePrice > 0 ? { strikePrice } : {};
      /* WAVE 58b · DEFECT 2 — the pool fields travel on the SAME PATCH the dialog
         already sends. `null` is an EXPLICIT removal (the server distinguishes it
         from absent); a blank/invalid percentage is never sent as a number. */
      /* WAVE 58f · FOLD-IN 1 — three states on the wire. A blank field sends
         `null` (remove); a filled field sends the number. `0` is a VALUE and is
         sent as `0`, because a negotiated 0% discount is a real term. */
      const termFields: Record<string, unknown> = {
        discount: discountPresent ? discount : null,
        ...(family === "note" ? { interestRate: interestRatePresent ? interestRate : null } : {}),
      };
      const poolFields: Record<string, unknown> = poolOn
        ? { optionPoolPostPercent: poolPercent.trim(), optionPoolMode: poolMode }
        : { optionPoolPostPercent: null, optionPoolMode: null };
      const byFamily: Record<string, unknown> =
        family === "priced"
          ? {
              preMoney,
              postMoney,
              pricePerShare,
              ...(fdShares.trim() === "" ? {} : { fdPreMoneyShares: Number(fdShares.trim()) }),
              /* WAVE 75 · ITEM 2 — three states on the wire, the same contract the
                 discount and pool fields use: a blank field sends `null` (explicit
                 removal), a filled field sends the text exactly as typed. It is
                 never omitted, so clearing the box really clears the term. */
              liquidationPreference: liqPref.trim() === "" ? null : liqPref.trim(),
              /* WAVE 76 · R60 — three states on the wire, the same contract as the
                 preference above: the blank option sends `null` (explicit removal,
                 i.e. "not on record"), a chosen token sends that token verbatim. It
                 is never omitted, so clearing the control really clears the term. */
              antiDilutionType: antiDilutionType === "" ? null : antiDilutionType,
              ...poolFields,
            }
          : family === "warrant"
            ? { ...strikeField, expiryYears }
            : family === "note"
              ? { ...capField, ...termFields, maturityMonths, mfn }
              /* WAVE 76 · D5 — the SAFE's cap convention, on the SAFE branch only,
                 because it is a property of a SAFE and of nothing else. Blank sends
                 `null`, which returns the instrument to the STATED YC post-money
                 assumption the projection discloses rather than to a silent guess. */
              : { ...capField, ...termFields, mfn, safeType: safeType === "" ? null : safeType }; // safe
      /* WAVE 58c · A1 — BELT AND BRACES. The Save button is disabled while the two
         prices disagree (below), but the rule is ALSO enforced here so that a
         programmatic click, a re-render race or a future caller cannot post a
         price the platform has already proved wrong. Never save a price the
         platform can prove is wrong. */
      if (editPriceContradicted && editPriceAgreement) {
        throw new Error(
          `price_contradicts_pool: the round would store $${editPriceAgreement.savedExact} while this pool ` +
            `derives $${editPriceAgreement.derivedExact} (difference $${editPriceAgreement.differenceExact}).`,
        );
      }
      /* WAVE 58e · D2/D3.5 — SAME BELT AND BRACES FOR THE TERM RANGES. This dialog
         is the ONLY post-creation edit surface for the discount, and on live it
         accepted anything at all. The Save button is disabled while a value is out
         of range (below), and the rule is re-checked here so no programmatic click
         can post the value that produced the corrupt live row. */
      if (family === "safe" || family === "note") {
        /* WAVE 58f — only validate a term the round actually CARRIES. An absent
           discount is not an invalid one, and must not block the save. */
        if (discountPresent) {
          const dv = validateDiscountPercentAsWritten(discount);
          if (!dv.ok) throw new Error(dv.message);
        }
        if (family === "note" && interestRatePresent) {
          const iv = validateInterestRatePercentAsWritten(interestRate);
          if (!iv.ok) throw new Error(iv.message);
        }
      }
      const res = await apiRequest("PATCH", `/api/rounds/${round.id}/terms`, {
        ...common,
        ...byFamily,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.ok) {
        toast({ title: "Terms saved", description: `Bridge event ${data.eventType} emitted.` });
        /* WAVE 69 · V-2 (R58 row 5) — the server's `termWarnings` channel had ZERO
           client consumers, so R56's approved warning was invisible. It is a
           SECOND toast, not a replacement: `TOAST_LIMIT` is 5, so it stacks
           beside "Terms saved" rather than hiding it. The save has already
           succeeded — this is a heads-up, never a failure. */
        if (Array.isArray(data?.termWarnings) && data.termWarnings.length > 0) {
          toast({
            title: "Saved — one thing to check",
            description: (data.termWarnings as unknown[]).map(String).join(" "),
            duration: 30000,
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
        onClose();
      } else {
        toast({ title: "Save failed", description: data?.error ?? "Validation", variant: "destructive" });
      }
    },
    /* ══════════════════════════════════════════════════════════════════════
       WAVE 69 · V-1 (R58 row 1) — THE REFUSAL IS NO LONGER THROWN AWAY HERE.
       ══════════════════════════════════════════════════════════════════════
       BEFORE: `onError: () => toast({ title: "Save failed", variant: "destructive" })`
       — the arrow took NO ARGUMENT, so the 543-character Wave 61b sentence was
       discarded and the founder saw the two words "Save failed".

       R44: the title "Save failed" is TRUE (the save did fail), merely useless.
       It is therefore KEPT BYTE-IDENTICAL and given a description — ADD, not
       REPLACE. No allowlist entry.

       IT READS `payload.message`, NOT `err.message`. `queryClient.ts:63` drops any
       server message ≥ 240 chars and substitutes "Some of the information was
       invalid. Please review and try again." — so `err.message` would render the
       generic sentence and this fix would look right while showing nothing.

       THE INLINE PANEL IS PRIMARY, THE TOAST IS THE ANNOUNCEMENT. Toasts are gone
       in ~10 s (measured); a 90-word investor-grade refusal needs longer, so it is
       also held in state and rendered persistently below the fields. */
    onError: (err: unknown) => {
      const msg = serverRefusalMessage(err);
      setSaveRefusal(msg);
      toast({
        title: "Save failed",
        description: msg ?? undefined,
        variant: "destructive",
        duration: 30000,
      });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-edit-terms">
        <DialogHeader>
          <DialogTitle>Edit terms — {round.name}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Round name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" data-testid="input-round-name" placeholder="e.g. Seed, Series A" />
          </div>
          <div>
            <Label>Target amount (USD)</Label>
            <MoneyInput value={targetAmount} onChange={setTargetAmount} className="mt-1" data-testid="input-target" />
          </div>
          <div>
            <Label>Min ticket (USD)</Label>
            <MoneyInput value={minTicket} onChange={setMinTicket} className="mt-1" data-testid="input-min-ticket" />
          </div>

          {family === "priced" && (
            <>
              <div>
                <Label>Pre-money valuation</Label>
                <MoneyInput value={preMoney} onChange={setPreMoney} className="mt-1" data-testid="input-pre-money" />
              </div>
              <div>
                <Label>Post-money valuation</Label>
                <MoneyInput value={postMoney} onChange={setPostMoney} className="mt-1" data-testid="input-post-money" />
              </div>
              <div>
                <Label>Price per share (USD)</Label>
                <MoneyInput value={pricePerShare} onChange={setPricePerShare} className="mt-1" data-testid="input-pps" />
              </div>
            </>
          )}

          {(family === "safe" || family === "note") && (
            <>
              <div>
                <Label>Valuation cap (USD)</Label>
                <MoneyInput value={valuationCap} onChange={setValuationCap} className="mt-1" data-testid="input-valuation-cap" />
                {/* WAVE 69 · V-1 — the R50 range refusal, from the SAME shared
                    validator the server calls, beside the field it is about.
                    Only when a cap is actually present: `0` is ABSENT (uncapped
                    SAFE), not invalid. */}
                {editCapVerdict && !editCapVerdict.ok && (
                  <p className="text-xs text-rose-500 mt-1" data-testid="edit-valuation-cap-invalid">{editCapVerdict.message}</p>
                )}
                {/* WAVE 69 · V-2 (R56) — A WARNING, NOT AN ERROR. Amber, never rose;
                    the word "error" never appears; Save is NOT disabled. The value
                    is stored exactly as written. */}
                {editCapDateShape && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid="warn-valuation-cap-date-shape">{editCapDateShape}</p>
                )}
              </div>
              <div>
                <Label>Discount (% off the round price)</Label>
                {/* WAVE 58f · FOLD-IN 1 — ABSENT, ZERO AND A VALUE ARE THREE DIFFERENT
                    FACTS. Switch this off and the round is saved with NO discount at
                    all; switch it on and leave the box at 0 and the round records a
                    negotiated 0%. Before this wave the dialog could only ever say "0",
                    so opening a no-discount SAFE and saving anything wrote a 0% term
                    the parties never agreed. Purely additive: the number input below
                    is unchanged. */}
                <div className="mt-1 flex items-center gap-2">
                  <Switch
                    checked={discountPresent}
                    onCheckedChange={setDiscountPresent}
                    data-testid="switch-discount-present"
                  />
                  <span className="text-xs text-muted-foreground" data-testid="text-discount-presence">
                    {discountPresent
                      ? "This instrument carries a discount"
                      : "This instrument carries NO discount (not 0% — none)"}
                  </span>
                </div>
                {discountPresent && (
                <Input type="number" min={0} value={discount} onChange={e => setDiscount(Number(e.target.value))} className="mt-1" data-testid="input-discount" />
                )}
                {/* ════════════════════════════════════════════════════════
                    WAVE 58e · D2.3 + D3 — THE CORRUPT ROW IS SURFACED HERE, NOT REWRITTEN.
                    ════════════════════════════════════════════════════════
                    This dialog is the ONLY place the live corrupt value `20260707` was
                    ever visible (`R31-a`; the round-detail Terms tab showed no discount
                    at all until this wave). It is a stored financial term on a test
                    record, so it is NOT silently corrected — the founder is TOLD it is
                    out of range and Save is blocked until they fix it themselves. A
                    cleanup is PROPOSED in `build_log/wave58e/W58E_CORRUPTION.md`. */}
                {editDiscountVerdict && !editDiscountVerdict.ok && (
                  <p className="text-xs text-rose-500 mt-1" data-testid="edit-discount-invalid">{editDiscountVerdict.message}</p>
                )}
                {editDiscountDisclosure && !editDiscountDisclosure.refusal && (
                  <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-xs space-y-1" data-testid="edit-disc-disclosure">
                    <p data-testid="edit-disc-both-forms"><strong>{editDiscountDisclosure.bothForms}</strong></p>
                    <p className="font-mono" data-testid="edit-disc-conversion">
                      {editDiscountDisclosure.conversionArithmetic
                        ? `At this round's stored price per share: ${editDiscountDisclosure.conversionArithmetic} a share.`
                        : `This round has no price per share stored, so Capavate will not quote a conversion price — on a $1.00 round it would be $${describeDiscount(discount, "1.00")?.conversionPrice ?? "—"}.`}
                    </p>
                    <p data-testid="edit-disc-lower-of">
                      With a valuation cap as well, conversion happens at whichever of the two implied prices is <strong>LOWER</strong>.
                    </p>
                    {editDiscountDisclosure.marketNormNote && (
                      <p className="text-amber-600" data-testid="edit-disc-market-norm">{editDiscountDisclosure.marketNormNote}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {family === "note" && (
            <>
              <div>
                <Label>Interest rate (% APR)</Label>
                {/* WAVE 58f · FOLD-IN 1 — same three-state treatment for the interest
                    rate. A note with no stated interest is not a note at 0%. */}
                <div className="mt-1 flex items-center gap-2">
                  <Switch
                    checked={interestRatePresent}
                    onCheckedChange={setInterestRatePresent}
                    data-testid="switch-interest-rate-present"
                  />
                  <span className="text-xs text-muted-foreground" data-testid="text-interest-rate-presence">
                    {interestRatePresent
                      ? "This note accrues interest"
                      : "This note states NO interest rate (not 0% — none)"}
                  </span>
                </div>
                {interestRatePresent && (
                <Input type="number" step="0.1" min={0} value={interestRate} onChange={e => setInterestRate(Number(e.target.value))} className="mt-1" data-testid="input-interest-rate" />
                )}
                {/* WAVE 58e · D2 — the SECOND field the live corruption landed in
                    (`interestRate: 20261231` = 2026-12-31). Same treatment: named
                    refusal, no rewrite. */}
                {editInterestVerdict && !editInterestVerdict.ok && (
                  <p className="text-xs text-rose-500 mt-1" data-testid="edit-interest-invalid">{editInterestVerdict.message}</p>
                )}
              </div>
              <div>
                <Label>Maturity (months)</Label>
                <Input type="number" min={0} value={maturityMonths} onChange={e => setMaturityMonths(Number(e.target.value))} className="mt-1" data-testid="input-maturity-months" />
                {/* WAVE 69 · V-1 — R58 row 1, verbatim: the founder typing an
                    8-digit date here used to see only "Save failed". The shared
                    validator's sentence (it names the range AND says "if you are
                    looking at an 8-digit number here, it is a DATE") is now on
                    screen as they type. R56 does NOT apply to this field: months
                    are not money and must keep REFUSING. */}
                {editMaturityVerdict && !editMaturityVerdict.ok && (
                  <p className="text-xs text-rose-500 mt-1" data-testid="edit-maturity-months-invalid">{editMaturityVerdict.message}</p>
                )}
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

          {/* WAVE 76 · D5 — THE SAFE CAP CONVENTION, REACHABLE FOR THE FIRST TIME.
              `safeType` was made storable by Wave 70 precisely so the two market
              conventions stop being one thing, and no control has ever sent it. The
              two options are the ENGINE's own vocabulary, listed from the shared
              constant rather than retyped. Blank is "not recorded", which is a
              DIFFERENT state from either convention and is disclosed as an
              assumption on the projection rather than guessed at silently. */}
          {family === "safe" && (
            <div className="col-span-2 rounded-md border border-border p-3" data-testid="edit-safe-type-section">
              <Label className="text-xs">SAFE cap convention</Label>
              <Select value={safeType === "" ? "__unset__" : safeType} onValueChange={v => setSafeType(v === "__unset__" ? "" : v)}>
                <SelectTrigger className="mt-1" data-testid="edit-safe-type"><SelectValue placeholder="Not recorded" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unset__">Not recorded — the projection states its assumption</SelectItem>
                  {SAFE_CAP_TYPES_FOR_INPUT.map(t => (
                    <SelectItem key={t} value={t}>
                      {t === "post_money_cap"
                        ? "Post-money cap — YC v1.2 (the current market standard)"
                        : "Pre-money cap — the legacy YC SAFE"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                This decides what the cap is a cap ON, and therefore how many shares the SAFE converts into — the two
                conventions give different conversion prices and different share counts on identical terms. Leaving it
                unrecorded does not pick one: the projection tells you which assumption it used.
              </p>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              WAVE 58b · DEFECT 2 — THE OPTION POOL EDIT SURFACE.
              ═══════════════════════════════════════════════════════════════════
              BEFORE THIS WAVE THIS DIALOG HAD NO POOL FIELD OF ANY KIND, and the
              wizard is create-only (`App.tsx:701`), so a founder who mis-set the
              pool could never correct it. `W58_BACKCOMPAT.md` §4's claim that
              "editing the round's terms can now add a percentage" was API-only and
              no screen sent it — the exact dead-promise class (R21) Wave 58 existed
              to remove.

              THE IMMUTABILITY RULE, HONOURED AND NAMED: `PATCH /api/rounds/:id/terms`
              refuses the whole patch with HTTP 409 `closed_round_readonly` when the
              round's state is `closed` or `funded` (`server/routes.ts`, the state
              check at the top of that handler). This dialog is never reachable for
              those states — the "Edit terms" button is rendered DISABLED with a lock
              and the reason "Closed rounds are read-only" (see `CLOSED_STATES`
              above) — so the rule is enforced in both places, and the panel below
              states it rather than leaving the founder to discover it. */}
          {family === "priced" && (
            <div className="col-span-2 rounded-md border border-border p-3 space-y-3" data-testid="edit-pool-section">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={poolOn}
                  onChange={e => setPoolOn(e.target.checked)}
                  data-testid="edit-pool-toggle"
                />
                <span>Option pool (ESOP) on this round</span>
              </label>
              <p className="text-[11px] text-muted-foreground">
                Unticking this REMOVES the pool from the round: the percentage and the placement are cleared and
                the projection returns to showing no pool. Nothing is reset silently — leaving this dialog without
                saving changes nothing. This round can be edited because it is not yet closed or funded; once it is,
                the server refuses every term edit with <code className="font-mono">closed_round_readonly</code> and
                the “Edit terms” button is locked.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Fully-diluted pre-money shares (declared)</Label>
                  <Input
                    type="number"
                    className="mt-1 font-mono"
                    value={fdShares}
                    onChange={e => setFdShares(e.target.value)}
                    data-testid="edit-fd-pre-money-shares"
                    placeholder="e.g. 10000000"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    The denominator for the price per share and for the pool percentage.
                  </p>
                </div>
                {/* WAVE 75 · ITEM 2 — the term the exit-waterfall refusal asks for.
                    Free text, because real preference language is longer than a
                    multiple. The server stores it as typed and returns a
                    non-blocking warning (shown as a second toast) when the text
                    does not yet state BOTH a multiple and participation. */}
                <div>
                  <Label className="text-xs">Liquidation preference</Label>
                  <Input
                    type="text"
                    className="mt-1"
                    value={liqPref}
                    onChange={e => setLiqPref(e.target.value)}
                    data-testid="edit-liquidation-preference"
                    placeholder="e.g. 1x non-participating"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    The exit waterfall needs a multiple written as “1x”, “1.5x” or “2x” AND the word
                    “participating” or “non-participating”. Leaving this blank removes the term.
                  </p>
                </div>
                {/* WAVE 76 · R60 — THE ANTI-DILUTION METHOD, REACHABLE FOR THE FIRST
                    TIME. The projection refuses a DOWN ROUND for a preferred class
                    with no method on record and tells the founder to record it on the
                    round that issued it; until this wave no control in the client
                    could. The four options are the engine's own tokens, listed from
                    the shared constant, so this control cannot offer one the server
                    would refuse. “Not recorded” and “None” are deliberately separate. */}
                <div>
                  <Label className="text-xs">Anti-dilution method</Label>
                  <Select value={antiDilutionType === "" ? "__unset__" : antiDilutionType} onValueChange={v => setAntiDilutionType(v === "__unset__" ? "" : v)}>
                    <SelectTrigger className="mt-1" data-testid="edit-anti-dilution-type"><SelectValue placeholder="Not recorded" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unset__">Not recorded — a down round will refuse to project</SelectItem>
                      {ANTI_DILUTION_TYPES_FOR_INPUT.map(t => (
                        <SelectItem key={t} value={t}>
                          {t === "none"
                            ? "None — the class negotiated no protection"
                            : t === "broad_based"
                              ? "Broad-based weighted average (market standard)"
                              : t === "narrow_based"
                                ? "Narrow-based weighted average"
                                : "Full ratchet — the whole class re-prices"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    What re-prices this class if a later round prices below its original issue price. The methods give
                    materially different share counts on the same event, so Capavate will not choose one for you.
                    “None” is a real term and projects fine; “Not recorded” is what makes a down round refuse.
                  </p>
                </div>
                {poolOn && (
                  <div>
                    <Label className="text-xs">Pool size (% of fully-diluted)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      max="99.9999"
                      className="mt-1 font-mono"
                      value={poolPercent}
                      onChange={e => setPoolPercent(e.target.value)}
                      data-testid="edit-pool-percent"
                      placeholder="e.g. 15 for 15%"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Percent as written — 15 means 15%, of post-money fully-diluted.
                    </p>
                    {editPoolPercentCheck && !editPoolPercentCheck.ok && (
                      <p className="text-xs text-rose-500 mt-1" data-testid="err-edit-pool-percent">
                        {editPoolPercentCheck.reason}
                      </p>
                    )}
                  </div>
                )}
                {poolOn && (
                  <div className="col-span-2">
                    {/* WAVE 58d · B1 — the same two decisions, the same vocabulary, on
                        the third pool surface. Additive: the `Pool placement` label
                        and both option strings are byte-identical to before. */}
                    <Label className="text-xs">Pricing treatment — who pays for the pool?</Label>
                    <p className="text-[10px] text-muted-foreground" data-testid="edit-pool-target-basis">
                      {/* Denominator phrase BEFORE the percentage — the percent fence's
                          neighbourhood window cannot see past the `</` of a closing JSX
                          tag on the same line. Same reason as the wizard's two copies. */}
                      <span className="font-medium">Target basis (the same either way):</span> the unallocated reserve is
                      sized as a percentage of <strong>post-closing fully diluted capitalisation</strong> — the NVCA model
                      term-sheet structure; the choice below changes only whether that reserve sits inside the pre-money
                      pricing denominator. That percentage is <span className="font-mono">{poolPercent || "—"}%</span>
                    </p>
                    <Label className="text-xs">Pool placement</Label>
                    <Select value={poolMode} onValueChange={v => setPoolMode(v as "pre_money" | "post_money")}>
                      <SelectTrigger className="mt-1" data-testid="edit-pool-placement"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pre_money">Pre-money — the founders pay for it alone (market default)</SelectItem>
                        <SelectItem value="post_money">Post-money — everyone pays for it pro-rata</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground mt-1 italic" data-testid="edit-pool-counsel-formulation">
                      {poolMode === "pre_money"
                        ? "In term-sheet language: “the pool increase is INCLUDED in fully-diluted pre-money capitalization; existing holders bear the dilution.” (Cooley GO; Wilson Sonsini ECVC — the market default.)"
                        : "In term-sheet language: “the pool increase is EXCLUDED from pre-money pricing and added after the closing; all holders dilute pro rata.” A negotiated departure from the NVCA/Cooley model form — note that “post-money pool” is often used by counsel to mean only the target basis above, under which the founders still bear it."}
                    </p>
                  </div>
                )}
              </div>
              {/* DEFECT 3 — the base reconciliation, on this screen too, from the
                  SAME function the wizard and the round-math route call. */}
              {editBase && !editBase.ok && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs" data-testid="edit-pool-base-refusal">
                  <div className="font-medium">The fully-diluted base cannot be settled</div>
                  <p className="mt-1">{editBase.reason}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Refusal code: <code className="font-mono">{editBase.code}</code></p>
                </div>
              )}
              {editBase && editBase.ok && (
                <p className="text-[10px] text-muted-foreground" data-testid="edit-pool-base-label">{editBase.label}</p>
              )}
              {editPoolDerivation && !editPoolDerivation.ok && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs" data-testid="edit-pool-refusal">
                  <div className="font-medium">The pool share count cannot be derived yet</div>
                  <p className="mt-1">{editPoolDerivation.reason}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">Refusal code: <code className="font-mono">{editPoolDerivation.code}</code></p>
                </div>
              )}
              {/* ═════════════════════════════════════════════════════════
                  WAVE 58c · A1 — THE MISMATCH, REFUSED BY NAME, WITH BOTH NUMBERS.
                  ═════════════════════════════════════════════════════════
                  The spec allows either "the derived value flows into the field" or
                  "the mismatch is refused by name on screen with both numbers shown
                  and the difference stated". BOTH are done, because each alone has
                  a hole: auto-writing the field would overwrite a price a founder
                  may have negotiated deliberately (a silent change to a money
                  field), and refusing alone would leave a founder with a repeating
                  decimal they cannot type. So: the mismatch is REFUSED (Save is
                  disabled and the reason is on screen), and a one-click APPLY puts
                  the derived price in the field. Nothing is written without the
                  founder pressing something. */}
              {editPriceAgreement && !editPriceAgreement.agrees && (
                <div
                  className="rounded-md border border-rose-400/70 bg-rose-50/70 dark:bg-rose-950/20 p-3 text-xs space-y-2"
                  data-testid="edit-pool-price-contradiction"
                >
                  <div className="font-medium text-rose-700 dark:text-rose-300">
                    This round cannot be saved: the price per share above contradicts this option pool
                  </div>
                  <div className="space-y-1 font-mono">
                    <div className="flex justify-between">
                      <span>Price per share, as typed above (would be SAVED)</span>
                      <span data-testid="edit-price-contradiction-saved">${editPriceAgreement.savedExact}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Price per share this pool derives</span>
                      <span data-testid="edit-price-contradiction-derived">${editPriceAgreement.derivedExact}</span>
                    </div>
                    <div className="flex justify-between border-t border-rose-400/40 pt-1 font-semibold">
                      <span>Difference (derived − typed)</span>
                      <span data-testid="edit-price-contradiction-difference">${editPriceAgreement.differenceExact}</span>
                    </div>
                  </div>
                  <p className="leading-relaxed">
                    Capavate will not store a price it can prove is wrong. The price saved on the round is what turns
                    an investor's wired money into shares — <code className="font-mono">shares = floor(amount ÷ price
                    per share)</code> — so saving <span className="font-mono">${editPriceAgreement.savedExact}</span>{" "}
                    on a round that carries this pool would issue the WRONG NUMBER OF SHARES to every investor in it,
                    on the permanent cap table, with nothing on screen to say so.
                  </p>
                  {editPriceAgreement.derivedIsRepeating && (
                    <p className="leading-relaxed" data-testid="edit-price-contradiction-repeating">
                      The derived price is a repeating decimal, so it cannot be written out in full. Applying it stores{" "}
                      <span className="font-mono">${editPriceAgreement.applyValue}</span> — the same{" "}
                      {PRICE_PER_SHARE_DECIMALS}-decimal figure the round wizard holds for these terms.
                    </p>
                  )}
                  <p className="leading-relaxed">
                    Either apply the derived price, type a price you have agreed that matches it, or untick the option
                    pool. Nothing is changed until you choose.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => setPricePerShare(Number(editPriceAgreement.applyValue))}
                    data-testid="edit-price-apply-derived"
                  >
                    Apply the derived price (${editPriceAgreement.applyValue})
                  </Button>
                </div>
              )}
              {editPriceAgreement && editPriceAgreement.agrees && (
                <p className="text-[10px] text-emerald-700 dark:text-emerald-400" data-testid="edit-price-agrees">
                  The price per share above matches the price this pool derives (${editPriceAgreement.applyValue}).
                </p>
              )}
              {/* WAVE 58c · A3 — an unreadable ledger is stated, not thrown. */}
              {editLedger !== null && !editLedger.ok && (
                <div
                  className="rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs"
                  data-testid="edit-ledger-unreadable"
                >
                  <div className="font-medium">Your cap-table ledger could not be read</div>
                  <p className="mt-1">{editLedger.reason}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Refusal code: <code className="font-mono">{editLedger.code}</code>
                  </p>
                  <p className="mt-1 text-[10px] font-mono text-muted-foreground" data-testid="edit-ledger-unreadable-detail">
                    {editLedger.detail}
                  </p>
                </div>
              )}
              {editPoolDerivation && editPoolDerivation.ok && (
                <div className="rounded-md border border-border p-3 text-xs space-y-1" data-testid="edit-pool-derived">
                  <div className="flex justify-between font-mono"><span>Derived top-up (shares)</span><span data-testid="edit-pool-derived-shares">{editPoolDerivation.poolTopUpShares.toLocaleString()}</span></div>
                  <div className="flex justify-between font-mono"><span>Pool after this round</span><span>{editPoolDerivation.resultingPoolShares.toLocaleString()} shares</span></div>
                  <div className="flex justify-between font-mono"><span>Resulting pool percentage</span><span data-testid="edit-pool-derived-percent">{formatPct(editPoolDerivation.resultingPoolPercent)}</span></div>
                  <div className="flex justify-between font-mono"><span>Pricing denominator ({poolMode === "pre_money" ? "pool INSIDE" : "pool OUTSIDE"})</span><span>{editPoolDerivation.pricingDenominatorShares.toLocaleString()} shares</span></div>
                  <div className="flex justify-between font-mono"><span>Price per share</span><span data-testid="edit-pool-derived-pps">${editPoolDerivation.pricePerShare}</span></div>
                  <div className="flex justify-between font-mono"><span>Effective pre-money</span><span>${editPoolDerivation.effectivePreMoney}</span></div>
                  <p className="text-[11px] leading-relaxed pt-1 border-t border-border" data-testid="edit-pool-who-pays">{editPoolDerivation.whoPays}</p>
                  <p className="text-[10px] text-muted-foreground">{editPoolDerivation.fdDefinition}</p>
                </div>
              )}
            </div>
          )}

          {family === "warrant" && (
            <>
              <div>
                <Label>Strike price (USD)</Label>
                <Input type="number" step="0.01" min={0} value={strikePrice} onChange={e => setStrikePrice(Number(e.target.value))} className="mt-1" data-testid="input-strike-price" />
                {/* WAVE 69 · V-1 — the `min={0}` attribute above is LEFT ALONE on
                    purpose (OQ-6): HTML `min` does not block typing and is not what
                    refuses the value. The shared validator is, and it says so here.
                    `0` is ABSENT (no strike), so it is not validated. */}
                {editStrikeVerdict && !editStrikeVerdict.ok && (
                  <p className="text-xs text-rose-500 mt-1" data-testid="edit-strike-price-invalid">{editStrikeVerdict.message}</p>
                )}
                {/* WAVE 69 · V-2 (R56) — warning only; the strike is stored as written. */}
                {editStrikeDateShape && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid="warn-strike-price-date-shape">{editStrikeDateShape}</p>
                )}
              </div>
              <div>
                <Label>Expiry (years)</Label>
                <Input type="number" min={0} value={expiryYears} onChange={e => setExpiryYears(Number(e.target.value))} className="mt-1" data-testid="input-expiry-years" />
                {/* WAVE 69 · V-1 — R50 bounds expiry to [0, 50]; an 8-digit date is
                    refused, and must keep being refused (R56 is money-fields only). */}
                {editExpiryVerdict && !editExpiryVerdict.ok && (
                  <p className="text-xs text-rose-500 mt-1" data-testid="edit-expiry-years-invalid">{editExpiryVerdict.message}</p>
                )}
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
        {/* WAVE 58c · A1 — A DISABLED BUTTON MUST NEVER BE SILENT. The reason is
            rendered beside it, naming the refusal and the way out. */}
        {editPriceContradicted && (
          <p className="text-xs text-rose-600 dark:text-rose-400" data-testid="edit-save-blocked-reason">
            Saving is blocked: the price per share contradicts this option pool (see above). Apply the derived price,
            match it by hand, or untick the pool.
          </p>
        )}
        {/* WAVE 58e · D2 — A DISABLED BUTTON MUST NEVER BE SILENT, and the reason
            must name the field. This is the block that stops the corrupt live value
            being re-saved from the one screen it is visible on. */}
        {editTermsOutOfRange && (
          <p className="text-xs text-rose-600 dark:text-rose-400" data-testid="edit-save-blocked-term-range">
            Saving is blocked: a term on this round is outside its permitted range (see the field above). Capavate
            will not store it and will not silently correct it — a discount and an interest rate are contractual
            figures, so the number has to be yours. Correct the field, or press Cancel to leave the round as it is.
          </p>
        )}
        {/* ═══════════════════════════════════════════════════════════
            WAVE 69 · V-1 (R58) — THE SERVER'S OWN SENTENCE, PERSISTENT, ON SCREEN.
            ═══════════════════════════════════════════════════════════
            The client gates above stop the ordinary case before the round-trip.
            This panel exists for everything they cannot know: a fence the client
            does not mirror, a value another writer set, a stricter server. It is
            NOT a paraphrase — it is the response body's `message`, read off
            `ApiError.payload` because the 240-char gate at `queryClient.ts:63`
            replaces `ApiError.message` with a generic sentence. Cleared at the top
            of the next attempt. */}
        {saveRefusal && (
          <p className="text-xs text-rose-600 dark:text-rose-400" role="alert" data-testid="edit-save-server-refusal">
            {saveRefusal}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saveMut.isPending || editPriceContradicted || editTermsOutOfRange}
            onClick={() => saveMut.mutate()}
            className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
            data-testid="button-save-terms"
          >Save terms</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
