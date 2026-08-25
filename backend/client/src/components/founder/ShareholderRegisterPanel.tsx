/**
 * client/src/components/founder/ShareholderRegisterPanel.tsx — WAVE 130.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE THINGS, ON THE CAP TABLE ITSELF
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. RECORD A SHAREHOLDER with no round in existence, where an unknown figure
 *      is recordable AS UNKNOWN and never as zero.
 *   2. BOTH FIRST-RUN STARTING POINTS the owner named — the shareholders the
 *      company was incorporated with, OR the cap table as it stands as at a date
 *      — kept separate, resumable, and skippable without ever locking anyone out.
 *   3. WHO CAN SEE THIS CAP TABLE, said in plain words, with the founder able to
 *      grant and withdraw the access that is his to control.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO RAW IDENTIFIER OR MACHINE KEY REACHES A HUMAN
 * ═══════════════════════════════════════════════════════════════════════════
 * Every holder kind, instrument, scenario, grant state and party kind is put
 * through a named label map or `humanizeMachineKey()` from
 * `@/lib/partnerDisplay`, and a grant is refused server-side unless it carries a
 * human label to render. `data-testid`, query keys and `href`s are the explicitly
 * allowed exceptions.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MONEY
 * ═══════════════════════════════════════════════════════════════════════════
 * The client sends the founder's own decimal STRING and the currency, and the
 * server converts it to exact minor units with the currency's ISO-4217 exponent.
 * The client performs NO arithmetic on money: no `Number()`, no `parseFloat`, no
 * multiply and no divide on a monetary value anywhere in this file. Reading back,
 * an unknown figure renders through `NOT_PROVIDED` — the platform's standing
 * refusal — and never as `0` or `$0`.
 *
 * CURRENCY IS NEVER ASSUMED. The select is pre-filled from the company's own
 * round history when there is one, and otherwise starts EMPTY so the founder
 * chooses. There is no `"USD"` default in this file — the company in the owner's
 * walkthrough prices in HK$.
 */
import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Users, Eye, Check, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { humanizeMachineKey } from "@/lib/partnerDisplay";
import { NOT_PROVIDED } from "@/lib/moneyDisplay";
import { fmtNum } from "@/lib/format";

/* ═══════════════════════════════════════════════════════════════════════════
   VOCABULARIES — ONE MAP PER SET OF KEYS, SO NOTHING RENDERS RAW
   ═══════════════════════════════════════════════════════════════════════════ */

const HOLDER_TYPE_LABELS: Record<string, string> = {
  founder: "Founder",
  investor: "Investor",
  employee: "Employee",
  advisor: "Advisor",
  entity: "Company or trust",
  option_pool: "Option pool",
};

const INSTRUMENT_LABELS: Record<string, string> = {
  common: "Common / ordinary shares",
  preferred: "Preferred shares",
  option: "Options",
  warrant: "Warrant",
  safe: "SAFE",
  note: "Convertible note",
};

const SUBJECT_KIND_LABELS: Record<string, string> = {
  consortium_partner: "Consortium Partner",
  collective: "Collective",
};

const GRANT_STATE_LABELS: Record<string, string> = {
  live: "Can see the cap table",
  revoked: "Access withdrawn",
  expired: "Access has ended",
};

/** The two starting points, in the owner's own terms — the exact distinction he
 *  drew, kept as two separate answers rather than one "setup" step. */
const SCENARIO_LABELS: Record<string, string> = {
  incorporation: "the shareholders you incorporated with",
  existing_captable: "your cap table as it stands today",
};

const ORIGIN_LABELS: Record<string, string> = {
  incorporation: "Recorded as an incorporation shareholder",
  existing_captable: "Recorded from the existing cap table",
  direct: "Recorded directly on the cap table",
};

/** Every label lookup goes through this, so an unmapped key becomes a sentence
 *  rather than a raw token. `humanizeMachineKey` is the platform's existing
 *  fallback and no second one is defined here. */
function labelFor(map: Record<string, string>, key: string | null | undefined): string {
  const raw = String(key ?? "").trim();
  if (!raw) return "Not recorded";
  return map[raw] ?? humanizeMachineKey(raw);
}

/* ═══════════════════════════════════════════════════════════════════════════
   WIRE TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

interface RegisterRecord {
  id: string;
  holderName: string;
  holderEmail: string | null;
  holderType: string;
  instrument: string;
  series: string | null;
  shares: string;
  amountDisplay: string | null;
  amountIsUnknown: boolean;
  pricePerShareDisplay: string | null;
  pricePerShareIsUnknown: boolean;
  currency: string;
  issueDate: string;
  origin: string;
}

interface RegisterListResponse {
  ok: boolean;
  records: RegisterRecord[];
  suggestedCurrency: string | null;
  supportedCurrencies: string[];
  holderTypes: string[];
  instruments: string[];
}

interface FirstRunResponse {
  ok: boolean;
  firstRun: {
    scenario: string | null;
    asAtDate: string | null;
    state: string;
    skippedAt: string | null;
    completedAt: string | null;
  };
  recordedByScenario: { incorporation: number; existing_captable: number; direct: number };
  canResume: boolean;
}

interface VisibilityResponse {
  ok: boolean;
  positional: Array<{ party: string; basis: string; revocable: boolean; reason: string }>;
  grants: Array<{
    id: string;
    subjectKind: string;
    subjectLabel: string;
    expiresAt: string;
    revokedAt: string | null;
    state: string;
    canRevoke: boolean;
  }>;
  subjectKinds: string[];
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE MONEY FIELD — A FIGURE, OR "I DO NOT KNOW". NEVER A SILENT ZERO.
   ═══════════════════════════════════════════════════════════════════════════
   This is the control the whole wave turns on. A founder describing a company he
   incorporated in 2019 frequently does not know what a co-founder paid for his
   ordinary shares, and until now the platform's only way to move past that field
   was to type a number that was not true. So the field has an explicit
   "Not known" choice, and choosing it sends the word `unknown` — which the server
   stores as NULL and every screen renders as a refusal.

   NO ARITHMETIC. The typed string is passed through untouched; the server does
   the exact minor-unit conversion with the currency's own exponent.
   ═══════════════════════════════════════════════════════════════════════════ */
function MoneyOrUnknownField(props: {
  id: string;
  label: string;
  help: string;
  currency: string;
  value: string;
  unknown: boolean;
  onValue: (v: string) => void;
  onUnknown: (v: boolean) => void;
  testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        data-testid={props.testId}
        inputMode="decimal"
        disabled={props.unknown}
        placeholder={props.currency ? `Amount in ${props.currency}` : "Choose a currency first"}
        value={props.unknown ? "" : props.value}
        onChange={(e) => props.onValue(e.target.value)}
      />
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          data-testid={`${props.testId}-unknown`}
          checked={props.unknown}
          onChange={(e) => props.onUnknown(e.target.checked)}
        />
        <span>
          Not known. Record this as unrecorded rather than as a figure. Capavate will show it as
          “{NOT_PROVIDED}” everywhere and will never treat it as zero.
        </span>
      </label>
      <p className="text-xs text-muted-foreground">{props.help}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PANEL
   ═══════════════════════════════════════════════════════════════════════════ */
export function ShareholderRegisterPanel(props: {
  companyId: string;
  /** Opened from the cap-table header control. The panel is also readable inline. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { companyId } = props;
  const { toast } = useToast();

  const registerQ = useQuery<RegisterListResponse>({
    queryKey: ["/api/founder/captable/shareholders", companyId],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/founder/captable/shareholders?companyId=${encodeURIComponent(companyId)}`,
      )).json(),
    enabled: !!companyId,
  });
  const firstRunQ = useQuery<FirstRunResponse>({
    queryKey: ["/api/founder/captable/first-run", companyId],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/founder/captable/first-run?companyId=${encodeURIComponent(companyId)}`,
      )).json(),
    enabled: !!companyId,
  });
  const visibilityQ = useQuery<VisibilityResponse>({
    queryKey: ["/api/founder/captable/visibility", companyId],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/founder/captable/visibility?companyId=${encodeURIComponent(companyId)}`,
      )).json(),
    enabled: !!companyId,
  });

  /* Refetch everything the cap table shows. `/api/companies/:id/securities` is
     invalidated too, because the register is projected into that response by the
     single `buildCompanySecurities` builder — which is how a recorded holder
     appears on every surface at once.

     WAVE 137 · DEFECT B — the securities key was written as ONE INTERPOLATED
     STRING (`[`/api/companies/${companyId}/securities`]`). The founder cap table
     subscribes with the ARRAY key `["/api/companies", companyId, "securities"]`
     (client/src/pages/founder/CapTable.tsx:339), and React Query v5 matches by
     ARRAY PREFIX — a one-element string key shares no prefix with it, so the
     cap-table query was never invalidated and a recorded shareholder did not
     appear until a remount (CapTable sets staleTime 30_000 with
     refetchOnWindowFocus:false and refetchInterval:false, so nothing else went
     and fetched it). The shape is corrected, and the sibling `"cap-table"` key is
     invalidated alongside it, matching the tree's own working precedent on the
     warrant-exercise and add-security paths (CapTable.tsx:960 and :1276-1277).
     The three register/first-run/visibility invalidations below are unchanged. */
  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ["/api/founder/captable/shareholders", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/founder/captable/first-run", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/founder/captable/visibility", companyId] });
    void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "securities"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "cap-table"] });
  }

  const supportedCurrencies = registerQ.data?.supportedCurrencies ?? [];
  const holderTypes = registerQ.data?.holderTypes ?? [];
  const instruments = registerQ.data?.instruments ?? [];
  const records = registerQ.data?.records ?? [];
  const firstRun = firstRunQ.data?.firstRun;
  const counts = firstRunQ.data?.recordedByScenario;

  /* ── The record form ───────────────────────────────────────────────────── */
  const [holderName, setHolderName] = useState("");
  const [holderEmail, setHolderEmail] = useState("");
  const [holderType, setHolderType] = useState("");
  const [instrument, setInstrument] = useState("");
  const [series, setSeries] = useState("");
  const [shares, setShares] = useState("");
  const [currency, setCurrency] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [amountUnknown, setAmountUnknown] = useState(false);
  const [pps, setPps] = useState("");
  const [ppsUnknown, setPpsUnknown] = useState(false);
  const [note, setNote] = useState("");
  const [origin, setOrigin] = useState("direct");
  const [formError, setFormError] = useState<string | null>(null);

  /* The currency the company itself has used before, offered as a starting
     point. When there is no history this stays empty and the founder is asked —
     it never silently becomes USD. */
  const effectiveCurrency = currency || registerQ.data?.suggestedCurrency || "";

  const recordM = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/captable/shareholders", {
        companyId,
        holderName,
        holderEmail: holderEmail || undefined,
        holderType,
        instrument,
        series: series || undefined,
        shares,
        currency: effectiveCurrency,
        issueDate,
        /* THE THREE-WAY ANSWER, sent explicitly. `"unknown"` is a statement; an
           empty string would be an omission and the server refuses it rather
           than defaulting it to zero. */
        amount: amountUnknown ? "unknown" : amount,
        pricePerShare: ppsUnknown ? "unknown" : pps,
        note: note || undefined,
        origin,
      });
      return res.json();
    },
    onSuccess: (data: { ok?: boolean; error?: string; message?: string; warning?: string | null }) => {
      if (!data?.ok) {
        setFormError(data?.message || "That could not be recorded.");
        return;
      }
      setFormError(null);
      if (data.warning) toast({ title: "Recorded, with a note", description: data.warning });
      else toast({ title: "Shareholder recorded", description: "It is on the cap table now." });
      setHolderName("");
      setHolderEmail("");
      setSeries("");
      setShares("");
      setAmount("");
      setPps("");
      setNote("");
      setAmountUnknown(false);
      setPpsUnknown(false);
      refreshAll();
    },
    onError: () => setFormError("That could not be recorded. Nothing was changed."),
  });

  /* ── First run ─────────────────────────────────────────────────────────── */
  const [scenarioAsAt, setScenarioAsAt] = useState("");
  const firstRunM = useMutation({
    mutationFn: async (body: { scenario?: string; state: string; asAtDate?: string }) => {
      const res = await apiRequest("POST", "/api/founder/captable/first-run", {
        companyId,
        ...body,
      });
      return res.json();
    },
    onSuccess: (data: { ok?: boolean; message?: string }) => {
      if (!data?.ok) {
        toast({ title: "Not saved", description: data?.message || "That could not be saved." });
        return;
      }
      refreshAll();
    },
  });

  /* ── Visibility ────────────────────────────────────────────────────────── */
  const [grantKind, setGrantKind] = useState("");
  const [grantSubjectId, setGrantSubjectId] = useState("");
  const [grantLabel, setGrantLabel] = useState("");
  const [grantExpiry, setGrantExpiry] = useState("");
  const [grantError, setGrantError] = useState<string | null>(null);

  const grantM = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/captable/visibility/grants", {
        companyId,
        subjectKind: grantKind,
        subjectId: grantSubjectId,
        subjectLabel: grantLabel,
        expiresAt: grantExpiry ? new Date(`${grantExpiry}T23:59:59Z`).toISOString() : "",
      });
      return res.json();
    },
    onSuccess: (data: { ok?: boolean; message?: string }) => {
      if (!data?.ok) {
        setGrantError(data?.message || "The access could not be granted.");
        return;
      }
      setGrantError(null);
      setGrantSubjectId("");
      setGrantLabel("");
      setGrantExpiry("");
      toast({ title: "Access granted", description: "They can see this cap table from now on." });
      refreshAll();
    },
    onError: () => setGrantError("The access could not be granted."),
  });

  const revokeM = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(
        "POST",
        `/api/founder/captable/visibility/grants/${encodeURIComponent(id)}/revoke`,
        {},
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Access withdrawn", description: "They can no longer see this cap table." });
      refreshAll();
    },
  });

  /* ── Derived copy, hoisted so the JSX keeps a static sibling shape ──────── */
  const scenarioSummary = useMemo(() => {
    if (!firstRun) return "Choose how you want to start.";
    if (firstRun.state === "completed") {
      return `You marked this finished${firstRun.scenario ? ` — ${labelFor(SCENARIO_LABELS, firstRun.scenario)}` : ""}. You can still add or revise shareholders at any time.`;
    }
    if (firstRun.state === "skipped") {
      return "You skipped this for now. Nothing is locked — pick either starting point whenever you are ready.";
    }
    if (firstRun.state === "in_progress" && firstRun.scenario) {
      return `In progress — ${labelFor(SCENARIO_LABELS, firstRun.scenario)}. Leave this page whenever you like; you will come back to exactly here.`;
    }
    return "Choose how you want to start. Both starting points stay open, and you can change your mind later.";
  }, [firstRun]);

  const incorporationCount = counts?.incorporation ?? 0;
  const existingCount = counts?.existing_captable ?? 0;
  const directCount = counts?.direct ?? 0;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto" data-testid="dialog-shareholder-register">
        <DialogHeader>
          <DialogTitle>Shareholders on this cap table</DialogTitle>
          <DialogDescription>
            Record the shareholders this company already has, without creating a fundraising round.
            Where you do not know a figure, say so — Capavate records it as unrecorded and never as
            zero.
          </DialogDescription>
        </DialogHeader>

        {/* ════════════════════════════════════════════════════════════════════
            1. THE TWO STARTING POINTS. Separate, resumable, skippable.
            ════════════════════════════════════════════════════════════════════ */}
        <Card data-testid="card-first-run">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Where this cap table starts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground" data-testid="text-first-run-state">
              {scenarioSummary}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="font-medium text-sm">The shareholders we incorporated with</div>
                <p className="text-xs text-muted-foreground">
                  The original founding split, as it stood on the day the company was formed.
                </p>
                <div className="text-xs text-muted-foreground" data-testid="text-incorporation-count">
                  Recorded so far: {fmtNum(incorporationCount)}
                </div>
                <Button
                  size="sm"
                  variant={firstRun?.scenario === "incorporation" ? "default" : "outline"}
                  data-testid="button-start-incorporation"
                  onClick={() => {
                    setOrigin("incorporation");
                    firstRunM.mutate({ scenario: "incorporation", state: "in_progress" });
                  }}
                >
                  {incorporationCount > 0 ? "Continue this" : "Start here"}
                </Button>
              </div>
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="font-medium text-sm">Our cap table as it stands today</div>
                <p className="text-xs text-muted-foreground">
                  For a company that has already raised. Give the date this position was true as at —
                  a cap table is only accurate as at a moment.
                </p>
                <div className="text-xs text-muted-foreground" data-testid="text-existing-count">
                  Recorded so far: {fmtNum(existingCount)}
                </div>
                <Input
                  type="date"
                  className="h-8"
                  data-testid="input-as-at-date"
                  value={scenarioAsAt || firstRun?.asAtDate || ""}
                  onChange={(e) => setScenarioAsAt(e.target.value)}
                />
                <Button
                  size="sm"
                  variant={firstRun?.scenario === "existing_captable" ? "default" : "outline"}
                  data-testid="button-start-existing-captable"
                  onClick={() => {
                    setOrigin("existing_captable");
                    firstRunM.mutate({
                      scenario: "existing_captable",
                      state: "in_progress",
                      asAtDate: scenarioAsAt || firstRun?.asAtDate || undefined,
                    });
                  }}
                >
                  {existingCount > 0 ? "Continue this" : "Start here"}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                data-testid="button-skip-first-run"
                onClick={() => firstRunM.mutate({ state: "skipped" })}
              >
                Not now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="button-complete-first-run"
                onClick={() =>
                  firstRunM.mutate({
                    scenario: firstRun?.scenario ?? undefined,
                    state: "completed",
                    asAtDate: scenarioAsAt || firstRun?.asAtDate || undefined,
                  })
                }
              >
                <Check className="h-3.5 w-3.5 mr-1.5" /> That is all of them
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Nothing here has to be finished in one sitting, and skipping does not close anything
              off. This panel stays on your cap table.
            </p>
          </CardContent>
        </Card>

        {/* ════════════════════════════════════════════════════════════════════
            2. RECORD A SHAREHOLDER. No round. No valuation. No price per share
               unless the founder actually knows one.
            ════════════════════════════════════════════════════════════════════ */}
        <Card data-testid="card-record-shareholder">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4" /> Record a shareholder
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              This goes straight onto the cap table. You do not need a round, a valuation or a price
              per share to record a holding that already exists.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="shreg-holder-name">Shareholder name</Label>
                <Input
                  id="shreg-holder-name"
                  data-testid="input-register-holder-name"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                  placeholder="As it appears on the company's register"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shreg-holder-email">Email, if you have it</Label>
                <Input
                  id="shreg-holder-email"
                  data-testid="input-register-holder-email"
                  value={holderEmail}
                  onChange={(e) => setHolderEmail(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label>What kind of holder is this?</Label>
                <Select value={holderType} onValueChange={setHolderType}>
                  <SelectTrigger data-testid="select-register-holder-type">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {holderTypes.map((k) => (
                      <SelectItem key={k} value={k}>
                        {labelFor(HOLDER_TYPE_LABELS, k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Instrument or share class</Label>
                <Select value={instrument} onValueChange={setInstrument}>
                  <SelectTrigger data-testid="select-register-instrument">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {instruments.map((k) => (
                      <SelectItem key={k} value={k}>
                        {labelFor(INSTRUMENT_LABELS, k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shreg-series">Class or series name, as your constitution calls it</Label>
                <Input
                  id="shreg-series"
                  data-testid="input-register-series"
                  value={series}
                  onChange={(e) => setSeries(e.target.value)}
                  placeholder="Optional — for example Ordinary A"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shreg-shares">Number of shares</Label>
                <Input
                  id="shreg-shares"
                  data-testid="input-register-shares"
                  inputMode="numeric"
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  placeholder="A whole number"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={effectiveCurrency} onValueChange={setCurrency}>
                  <SelectTrigger data-testid="select-register-currency">
                    <SelectValue placeholder="Choose the currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {supportedCurrencies.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Capavate does not assume a currency. Choose the one this holding was actually
                  subscribed in.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shreg-issue-date">Issue date</Label>
                <Input
                  id="shreg-issue-date"
                  type="date"
                  data-testid="input-register-issue-date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                />
              </div>
              <MoneyOrUnknownField
                id="shreg-amount"
                testId="input-register-amount"
                label="Amount subscribed"
                help="What was actually paid for this holding."
                currency={effectiveCurrency}
                value={amount}
                unknown={amountUnknown}
                onValue={setAmount}
                onUnknown={setAmountUnknown}
              />
              <MoneyOrUnknownField
                id="shreg-pps"
                testId="input-register-pps"
                label="Price per share"
                help="Historic holdings often have no recorded price. That is a legitimate answer."
                currency={effectiveCurrency}
                value={pps}
                unknown={ppsUnknown}
                onValue={setPps}
                onUnknown={setPpsUnknown}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shreg-note">Anything an auditor should know</Label>
              <Textarea
                id="shreg-note"
                data-testid="input-register-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
              />
            </div>
            {formError ? (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                data-testid="text-register-error"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{formError}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                data-testid="button-submit-register-shareholder"
                disabled={recordM.isPending}
                onClick={() => recordM.mutate()}
              >
                Record shareholder
              </Button>
              <span className="text-xs text-muted-foreground" data-testid="text-register-origin">
                {labelFor(ORIGIN_LABELS, origin)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ── What is on the register now ─────────────────────────────────── */}
        <Card data-testid="card-register-list">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              On the register ({fmtNum(records.length)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-register-empty">
                Nothing recorded on the register yet. Holdings that came through a round are on the
                cap table above; this list shows holdings recorded directly.
              </p>
            ) : (
              <div className="space-y-2" data-testid="list-register-records">
                {records.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-md border border-border p-3 text-sm"
                    data-testid={`row-register-${r.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.holderName}</span>
                      <Badge variant="outline" className="text-xs">
                        {labelFor(HOLDER_TYPE_LABELS, r.holderType)}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {labelFor(INSTRUMENT_LABELS, r.instrument)}
                      </Badge>
                      {r.series ? (
                        <Badge variant="outline" className="text-xs">
                          {r.series}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1.5 grid gap-1 text-xs text-muted-foreground md:grid-cols-4">
                      <div>Shares: {r.shares}</div>
                      <div data-testid={`text-register-amount-${r.id}`}>
                        {/* AN UNKNOWN FIGURE RENDERS AS A REFUSAL, NEVER AS 0. */}
                        Amount:{" "}
                        {r.amountIsUnknown
                          ? NOT_PROVIDED
                          : `${r.currency} ${r.amountDisplay ?? NOT_PROVIDED}`}
                      </div>
                      <div data-testid={`text-register-pps-${r.id}`}>
                        Price per share:{" "}
                        {r.pricePerShareIsUnknown
                          ? NOT_PROVIDED
                          : `${r.currency} ${r.pricePerShareDisplay ?? NOT_PROVIDED}`}
                      </div>
                      <div>Issued: {r.issueDate}</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {labelFor(ORIGIN_LABELS, r.origin)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ════════════════════════════════════════════════════════════════════
            3. WHO CAN SEE THIS CAP TABLE.
            ════════════════════════════════════════════════════════════════════ */}
        <Card data-testid="card-captable-visibility">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4" /> Who can see this cap table
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2" data-testid="list-visibility-positional">
              {(visibilityQ.data?.positional ?? []).map((p) => (
                <div key={p.party} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{humanizeMachineKey(p.party)}</span>
                    <Badge variant="outline" className="text-xs">
                      Always
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{p.reason}</p>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="font-medium text-sm">Give a partner or the Collective access</div>
              <p className="text-xs text-muted-foreground">
                Only where it is required. This is yours to grant and yours to withdraw, and it always
                has an end date.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Who</Label>
                  <Select value={grantKind} onValueChange={setGrantKind}>
                    <SelectTrigger data-testid="select-visibility-subject-kind">
                      <SelectValue placeholder="Choose" />
                    </SelectTrigger>
                    <SelectContent>
                      {(visibilityQ.data?.subjectKinds ?? []).map((k) => (
                        <SelectItem key={k} value={k}>
                          {labelFor(SUBJECT_KIND_LABELS, k)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shreg-grant-label">Name them for your records</Label>
                  <Input
                    id="shreg-grant-label"
                    data-testid="input-visibility-subject-label"
                    value={grantLabel}
                    onChange={(e) => setGrantLabel(e.target.value)}
                    placeholder="The name this access should be listed under"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shreg-grant-subject">Their Capavate account</Label>
                  <Input
                    id="shreg-grant-subject"
                    data-testid="input-visibility-subject-id"
                    value={grantSubjectId}
                    onChange={(e) => setGrantSubjectId(e.target.value)}
                    placeholder="The account this access belongs to"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shreg-grant-expiry">Access ends on</Label>
                  <Input
                    id="shreg-grant-expiry"
                    type="date"
                    data-testid="input-visibility-expiry"
                    value={grantExpiry}
                    onChange={(e) => setGrantExpiry(e.target.value)}
                  />
                </div>
              </div>
              {grantError ? (
                <div
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  data-testid="text-visibility-error"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{grantError}</span>
                </div>
              ) : null}
              <Button
                size="sm"
                data-testid="button-grant-visibility"
                disabled={grantM.isPending}
                onClick={() => grantM.mutate()}
              >
                Give access
              </Button>
            </div>

            <div className="space-y-2" data-testid="list-visibility-grants">
              {(visibilityQ.data?.grants ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-visibility-grants-empty">
                  Nobody outside your shareholders and your own team has been given access.
                </p>
              ) : (
                (visibilityQ.data?.grants ?? []).map((g) => (
                  <div
                    key={g.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
                    data-testid={`row-visibility-grant-${g.id}`}
                  >
                    <div>
                      <div className="font-medium">{g.subjectLabel}</div>
                      <div className="text-xs text-muted-foreground">
                        {labelFor(SUBJECT_KIND_LABELS, g.subjectKind)} ·{" "}
                        {labelFor(GRANT_STATE_LABELS, g.state)} · ends {g.expiresAt.slice(0, 10)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!g.canRevoke || revokeM.isPending}
                      data-testid={`button-revoke-visibility-${g.id}`}
                      onClick={() => revokeM.mutate(g.id)}
                    >
                      Withdraw access
                    </Button>
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Everyone listed here reads the same cap table you do, updated the moment you change it.
              Shareholders cannot be removed from this list — seeing the register they appear on
              follows from holding shares, and directly recorded holdings ({fmtNum(directCount)} so
              far) count exactly the same as holdings from a round.
            </p>
          </CardContent>
        </Card>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} data-testid="button-close-shareholder-register">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ShareholderRegisterPanel;
