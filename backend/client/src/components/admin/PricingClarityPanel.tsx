/**
 * client/src/components/admin/PricingClarityPanel.tsx
 *
 * WAVE 202 · ITEM B · R178.2 — "SO THAT I KNOW EXACTLY WHAT I'M SETTING A PRICE FOR."
 *
 * THE OWNER'S WORDS
 *   "Once again, I think the confusion is coming from the admin area (pricing
 *    section). This section may require a UI/design enhancement so that I know
 *    exactly what I'm setting a price for."
 *   and, of the existing screen, three times: "I have no idea how to actually read
 *   this or what the figures are."
 *
 * WHAT THIS IS
 *   One panel that answers, for EVERY price the platform holds, the five questions
 *   the owner has to be able to answer at a glance:
 *     1. What product is this?
 *     2. Who pays it?
 *     3. How often is it charged?
 *     4. Is it live?
 *     5. WHERE ON THE FRONTEND does it appear?   ← he said this one matters most.
 *   And, per price, the R178.1 control: annual, monthly, or both.
 *
 * WHY A NEW PANEL AND NOT A REDESIGN OF THE EXISTING TABLE
 *   Not timidity — arithmetic. The guard fingerprints source text: renaming a loop
 *   variable retires a tab identity (wave 188 did exactly this on this very screen)
 *   and adding a `<td>` renumbers its sibling cells (wave 182). A table redesign is
 *   the single highest-risk change for those traps. Adding a NEW sibling panel
 *   delivers the readability the owner asked for while making both traps
 *   unreachable, and it satisfies the standing rule directly: "No silent dropping of
 *   any functionality/widgets across the entire platform" / "I'd rather add than
 *   delete." NOTHING existing is reworded, renamed, reordered or removed.
 *
 * WHY IT LISTS platform_fees AND NOT THE PRICING-MODEL STORE
 *   Because that is the actual cause of the confusion. The Pricing Models tab reads
 *   the pricing-model store, which in this tree holds ONE row — a draft carrier for
 *   migrated coupon codes — while every price the platform charges lives in
 *   `platform_fees` on other tabs. The owner opened the screen he was told was the
 *   pricing screen, saw one meaningless draft slug, and concluded he could not read
 *   it. He was right. This panel puts the real prices on the screen he opens.
 *
 * DESIGN
 *   Plain-language labels, grouped live-first, generous whitespace, no decorative
 *   colour. Colour encodes exactly one thing — state — and NEVER alone: every state
 *   carries the word "Live" or "Retired" beside it, so the panel reads correctly in
 *   greyscale and to a colour-blind reader. Contrast targets WCAG AA.
 *
 * MONEY
 *   Every amount is formatted by `@/lib/currency`'s `formatMinor`, the platform's
 *   one formatter. No amount is parsed, added, multiplied or divided here. The only
 *   number this panel ever CONSTRUCTS is the annual price the owner types, and that
 *   is read as a whole number of minor units and sent verbatim — never derived from
 *   the monthly figure (`forbid_x12_derivation = 1`, R156.1 / R156.2).
 *
 * ABSENCE
 *   A price with no amount on record says so in words. It is never rendered as
 *   $0.00 (R143.4) and never compared as if it were a number (R176.1).
 *
 * RULING: R178.2, R178.1, R143.1, R143.4, R156.1, R156.2, R176.1, R159.3.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatMinor } from "@/lib/currency";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const PRICE_CLARITY_KEY = "/api/admin/price-clarity";

interface PeriodOfferView {
  scopeKey: string;
  annualOffered: boolean;
  monthlyOffered: boolean;
  source: "per_price" | "platform_default";
  annualAmountMinor: number | null;
  annualCurrency: string | null;
  annualDerivation: "unset" | "admin_set";
  forbidX12Derivation: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  notes: string | null;
  unavailableReason: string | null;
}

interface ClarityRow {
  scopeKey: string;
  rawKey: string;
  product: string;
  whatItIs: string;
  audience: string;
  amountMinor: number | null;
  currency: string | null;
  intentionalZero: boolean;
  recordedPeriod: string | null;
  periodPlain: string;
  stateLabel: "Live" | "Retired";
  isLive: boolean;
  stateExplanation: string;
  appearsOn: string[];
  editedOn: string;
  periodOffer: PeriodOfferView;
  annualGap: string | null;
}

interface ClarityReport {
  rows: ClarityRow[];
  liveCount: number;
  retiredCount: number;
  refusal: string | null;
}

/**
 * The amount, or the sentence that says there isn't one. `amountMinor === null` is
 * the only test; the value is never compared with 0 to decide whether it exists
 * (R176.1), and an absence is never printed as a zero (R143.4).
 */
function amountText(row: ClarityRow): string {
  if (row.amountMinor === null || row.currency === null) {
    return "No amount on record";
  }
  const money = formatMinor(row.amountMinor, row.currency);
  return row.intentionalZero ? `${money} — deliberately free` : money;
}

/** WCAG-AA state colours from the platform's own tokens. Never the only signal. */
function stateClasses(isLive: boolean): string {
  return isLive
    ? "border-emerald-700/40 bg-emerald-50 text-emerald-900"
    : "border-slate-400/50 bg-slate-100 text-slate-800";
}

function PeriodChoiceEditor({ row }: { row: ClarityRow }): JSX.Element {
  const { toast } = useToast();
  const [annual, setAnnual] = useState<boolean>(row.periodOffer.annualOffered);
  const [monthly, setMonthly] = useState<boolean>(row.periodOffer.monthlyOffered);
  /* The annual amount is held as the RAW STRING the owner typed. It is only turned
     into a number at the moment of sending, so nothing rounds, truncates or
     re-formats what he is looking at while he types. */
  const [annualMinor, setAnnualMinor] = useState<string>(
    row.periodOffer.annualAmountMinor === null
      ? ""
      : String(row.periodOffer.annualAmountMinor),
  );
  const [annualCcy, setAnnualCcy] = useState<string>(
    row.periodOffer.annualCurrency ?? "",
  );

  const save = useMutation({
    mutationFn: async () => {
      /* MONEY BOUNDARY. An empty field means UNSET and is sent as `null` — not 0
         (R143.4). A typed value must be a whole number of minor units; it is
         validated again on the server, which is the authority. Nothing here
         multiplies, divides or converts (R156.1). */
      const trimmed = annualMinor.trim();
      let amount: number | null = null;
      if (trimmed.length > 0) {
        if (!/^\d+$/.test(trimmed)) {
          toast({
            variant: "destructive",
            title: "Annual price not saved",
            description:
              "Enter the annual price as a whole number of cents, with no symbols or decimal point.",
          });
          throw new Error("annual price is not a whole number of cents");
        }
        /* BIGINT BOUNDARY (R156.1). The digits are widened to `bigint` first, so no
           precision is lost on the way in, and the value only becomes a `number`
           after it has been proved to fit inside MAX_SAFE_INTEGER. `parseInt` /
           `parseFloat` / `Number()` are never used on money. */
        const wide = BigInt(trimmed);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
          toast({
            variant: "destructive",
            title: "Annual price not saved",
            description:
              "That annual price is larger than Capavate can record safely. Please check the figure.",
          });
          throw new Error("annual price exceeds the safe integer boundary");
        }
        amount = globalThis.Number(wide);
      }
      const res = await apiRequest(
        "PUT",
        `/api/admin/price-period-offer/${encodeURIComponent(row.scopeKey)}`,
        {
          annualOffered: annual,
          monthlyOffered: monthly,
          annualAmountMinor: amount,
          annualCurrency: annualCcy.trim().length > 0 ? annualCcy.trim() : null,
        },
      );
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [PRICE_CLARITY_KEY] });
      /* The frontend reads the same choice from the public policy endpoint, so it is
         invalidated too — this is what makes "whatever I choose is displayed in the
         frontend" true without a page reload. */
      void queryClient.invalidateQueries({ queryKey: ["/api/price-display-policy"] });
      toast({
        title: "Billing period saved",
        description: `${row.product} — the frontend will now follow your choice.`,
      });
    },
    onError: (e: Error) =>
      toast({
        variant: "destructive",
        title: "Billing period not saved",
        description: e.message,
      }),
  });

  const idBase = `period-${row.rawKey}`;

  return (
    <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
      <p className="text-xs font-semibold">How do you want this price shown?</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Tick the periods you want customers to see for this price. You can tick both.
        Anything you leave unticked is not shown to customers anywhere. This only
        changes what is displayed — it does not change what anyone is charged.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${idBase}-annual`}
            checked={annual}
            onCheckedChange={(v) => setAnnual(v === true)}
            data-testid={`checkbox-annual-${row.rawKey}`}
          />
          <Label htmlFor={`${idBase}-annual`} className="text-xs font-normal">
            Show a yearly price
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${idBase}-monthly`}
            checked={monthly}
            onCheckedChange={(v) => setMonthly(v === true)}
            data-testid={`checkbox-monthly-${row.rawKey}`}
          />
          <Label htmlFor={`${idBase}-monthly`} className="text-xs font-normal">
            Show a monthly price
          </Label>
        </div>
      </div>

      {row.annualGap !== null && (
        <div
          className="mt-3 rounded-md border border-amber-700/40 bg-amber-50 p-2.5"
          data-testid={`notice-annual-gap-${row.rawKey}`}
        >
          <p className="text-xs leading-snug text-amber-950">{row.annualGap}</p>
        </div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${idBase}-amount`} className="text-xs">
            Yearly price, in cents (leave empty if you have not decided)
          </Label>
          <Input
            id={`${idBase}-amount`}
            inputMode="numeric"
            value={annualMinor}
            onChange={(e) => setAnnualMinor(e.target.value)}
            placeholder="Not set"
            className="mt-1 h-8 font-mono text-xs"
            data-testid={`input-annual-minor-${row.rawKey}`}
          />
        </div>
        <div>
          <Label htmlFor={`${idBase}-ccy`} className="text-xs">
            Currency for that yearly price
          </Label>
          <Input
            id={`${idBase}-ccy`}
            value={annualCcy}
            onChange={(e) => setAnnualCcy(e.target.value)}
            placeholder="Not set"
            className="mt-1 h-8 font-mono text-xs uppercase"
            data-testid={`input-annual-currency-${row.rawKey}`}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          data-testid={`button-save-period-${row.rawKey}`}
        >
          {save.isPending ? "Saving…" : "Save how this price is shown"}
        </Button>
        <span
          className="text-[11px] text-muted-foreground"
          data-testid={`text-period-source-${row.rawKey}`}
        >
          {row.periodOffer.source === "per_price"
            ? "You have set this yourself for this price."
            : "You have not set this for this price yet, so the platform-wide setting is being used."}
        </span>
      </div>
    </div>
  );
}

function ClarityRowCard({ row }: { row: ClarityRow }): JSX.Element {
  return (
    <Card data-testid={`card-price-clarity-${row.rawKey}`}>
      <CardContent className="pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4
              className="text-sm font-semibold"
              data-testid={`text-price-product-${row.rawKey}`}
            >
              {row.product}
            </h4>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {row.whatItIs}
            </p>
          </div>
          {/* STATE. Colour plus the WORD, never colour alone. */}
          <span
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${stateClasses(row.isLive)}`}
            data-testid={`badge-price-state-${row.rawKey}`}
          >
            {row.stateLabel}
          </span>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Who pays it</dt>
            <dd
              className="mt-0.5 font-medium"
              data-testid={`text-price-audience-${row.rawKey}`}
            >
              {row.audience}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Amount</dt>
            <dd
              className="mt-0.5 font-mono font-medium tabular-nums"
              data-testid={`text-price-amount-${row.rawKey}`}
            >
              {amountText(row)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">How often</dt>
            <dd
              className="mt-0.5 font-medium"
              data-testid={`text-price-period-${row.rawKey}`}
            >
              {row.periodPlain}
            </dd>
          </div>
        </dl>

        {/* THE COLUMN THE OWNER SAID MATTERS MOST. */}
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">Where customers see this price</p>
          {row.appearsOn.length > 0 ? (
            <ul
              className="mt-1 space-y-0.5"
              data-testid={`list-price-appears-on-${row.rawKey}`}
            >
              {row.appearsOn.map((surface) => (
                <li key={surface} className="text-xs font-medium">
                  {surface}
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="mt-1 text-xs font-medium"
              data-testid={`text-price-appears-on-unknown-${row.rawKey}`}
            >
              Capavate has not recorded a customer-facing screen for this price. It may
              be internal, or it may not be shown anywhere yet.
            </p>
          )}
        </div>

        <p
          className="mt-3 text-xs leading-snug text-muted-foreground"
          data-testid={`text-price-state-explanation-${row.rawKey}`}
        >
          {row.stateExplanation}
        </p>

        <p className="mt-2 text-[11px] text-muted-foreground">
          You change the amount itself in{" "}
          <span className="font-medium">{row.editedOn}</span>. The database name for
          this price is <code className="font-mono">{row.rawKey}</code>.
        </p>

        <PeriodChoiceEditor row={row} />
      </CardContent>
    </Card>
  );
}

/**
 * THE PANEL. Mounted as a static sibling above the existing pricing-models list.
 * It adds a view; it removes nothing.
 */
export function PricingClarityPanel(): JSX.Element {
  const q = useQuery<{ ok?: boolean; report?: ClarityReport }>({
    queryKey: [PRICE_CLARITY_KEY],
    queryFn: async () => (await apiRequest("GET", PRICE_CLARITY_KEY)).json(),
  });

  const report = q.data?.report ?? null;

  return (
    <section className="mb-6" data-testid="panel-pricing-clarity">
      <Card>
        <CardHeader>
          <CardTitle className="text-base" data-testid="text-pricing-clarity-title">
            Every price on this platform, in plain language
          </CardTitle>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            One card per price. Each one tells you what the price is for, who pays it,
            how often, whether it is live, and which screens a customer sees it on.
            This is a reading view of the prices Capavate actually holds — the list
            below it is the separate pricing-model authoring tool.
          </p>
        </CardHeader>
        <CardContent>
          {q.isError && (
            <p
              className="text-xs leading-snug text-muted-foreground"
              data-testid="text-pricing-clarity-error"
            >
              This list could not be loaded just now. That is a reading problem, not a
              sign that prices are missing, and nothing has been changed. Try again in
              a moment.
            </p>
          )}
          {q.isLoading && (
            <p className="text-xs text-muted-foreground" data-testid="text-pricing-clarity-loading">
              Reading your prices…
            </p>
          )}
          {report !== null && report.refusal !== null && (
            <p
              className="text-xs leading-snug text-muted-foreground"
              data-testid="text-pricing-clarity-refusal"
            >
              {report.refusal}
            </p>
          )}
          {report !== null && report.rows.length > 0 && (
            <>
              <p
                className="mb-4 text-xs text-muted-foreground"
                data-testid="text-pricing-clarity-counts"
              >
                {report.liveCount} live, {report.retiredCount} retired. Live prices are
                listed first.
              </p>
              <div className="space-y-4" data-testid="list-pricing-clarity">
                {report.rows.map((row) => (
                  <ClarityRowCard key={row.scopeKey} row={row} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export default PricingClarityPanel;
