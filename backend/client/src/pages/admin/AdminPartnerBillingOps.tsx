/**
 * WAVE 14 — /admin/partner-billing-ops
 *
 * THE ADMIN SURFACE FOR THE PARTNER MONEY ENGINE.
 *
 * `server/lib/partnerBillingStore.ts` is a 1 100-line money engine written in
 * Wave 5. Before this wave, exactly one of its exports had a live caller
 * (`quotePartnerSubscription`). Tier prices could be read but never set, the
 * promotion moderation queue existed but could not be worked, invoices could be
 * created only by a test, and the commission allocator — the one piece whose
 * whole purpose is not losing a cent — had no way to be exercised or inspected.
 * "An engine with no route is NOT shipped", and a route with no screen is not
 * shipped either. This is the screen.
 *
 * FOUR TABS, one per item cluster:
 *   Tier Prices  — CP-SUB-12 / CP-SUB-13. Coverage first: WHICH tiers are
 *                  unpriced, not just a list of rows.
 *   Promotions   — CP-PROMO-07 / 09 / 19 / 20. Moderation queue with scope and
 *                  value semantics visible; grant records a supersession.
 *   Reconcile    — CP-SUB-11. Enumerates the specific ways Dashboard, partner
 *                  Billing and the admin roster can disagree.
 *   Decisions    — CP-SUB-19 / CP-PROMO-04 / 17 / 22. The build's own open
 *                  pricing questions, including the two that need the owner.
 *
 * MONEY UNITS. Every amount on the wire is INTEGER MINOR UNITS. The inputs here
 * accept major-unit dollars for humans and convert once, at the edge, with an
 * explicit reject on anything that is not a clean 2-decimal figure — a price
 * that had to be rounded to be accepted is a price nobody authorised. Nothing in
 * this file multiplies a percentage by 100; percentages arrive as fractions and
 * render through the shared display helper.
 *
 * EMPTY IS NOT ZERO. The price input distinguishes "" (deliberately unpriced,
 * sent as null) from "0" (a real free tier). That distinction exists in the
 * schema and collapsing it here would defeat it.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { AppCard } from "@/components/ui/app-card";
import { FilterChip } from "@/components/ui/filter-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, RefreshCw, X } from "lucide-react";
import { apiRequest, queryClient, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
/* Percentages are FRACTIONS on the wire; this is the only thing that multiplies
   by 100 anywhere on this page. */
import { formatFractionAsPercent } from "@/lib/percentDisplay";
import { formatMinor, toMinor } from "@/lib/currency";
import { minorToMajorString } from "@/lib/moneyDisplay";

/* WAVE 24 · ITEM 2 — the three orphaned admin partner-billing endpoints
   (invoice mint, commission split, admin money events) arrive as ONE MORE TAB
   on this page rather than a new /admin route, keeping the admin surface
   consolidated. */
import { AdminInvoicingOpsPanel } from "@/components/admin/AdminInvoicingOpsPanel";

type OpsTab = "prices" | "promotions" | "reconcile" | "spv-fees" | "invoicing" | "decisions";

/* ── unit conversion at the edge, and nowhere else ─────────────────────── */

/** Minor units → major-unit string for an input field. */
/* WAVE 21 ITEM 5: exponent-aware; USD default preserves existing callers. */
function minorToMajorInput(minor: number | null, currency = "USD"): string {
  return minor === null ? "" : minorToMajorString(minor, currency);
}

/**
 * Major-unit dollars → integer minor units.
 *
 * Returns `null` for the EMPTY string, which means "deliberately unpriced" and
 * is a legitimate value the server accepts. Returns `undefined` for anything
 * malformed, so the caller can reject rather than guess. `"0"` returns 0 — a
 * real free tier, distinct from unpriced.
 */
function majorToMinorStrict(s: string, currency = "USD"): number | null | undefined {
  const raw = (s ?? "").trim();
  if (raw === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return undefined;
  /* WAVE 21 ITEM 5: parse partner scales by the same exponent. */
  const cents = toMinor(Number(raw), currency);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

/* ── server shapes (verified against server/lib/wave14MoneyRoutes.ts) ───── */

/* Mirrors `TierPrice` (server/lib/partnerBillingStore.ts:110) EXACTLY — read at
   source rather than assumed. Note what is NOT here: no id, no updatedAt, no
   updatedBy. Those columns exist in `partner_tier_price` but the engine's mapper
   does not project them, so the table below keys on (tierSlug, cadence) — the
   real unique constraint — and does not display audit fields it cannot see. */
type TierPriceRow = {
  tierSlug: string;
  cadence: string;
  /** NULL means DELIBERATELY UNPRICED — it is NOT zero. */
  priceMinor: number | null;
  currency: string;
  derivation: "unpriced" | "admin_set" | "derived_x12";
  active: boolean;
};

type CoverageResponse = {
  ok: boolean;
  rows: TierPriceRow[];
  total: number;
  priced: number;
  unpriced: number;
  tiers: string[];
  unpricedPairs: Array<{ tierSlug: string; cadence: string }>;
  cadences: string[];
};

/* Mirrors `Promotion` (server/lib/partnerBillingStore.ts:252). The value fields
   are `valueScaled` (exact integer on scale 1e9), `valueMinor` and `valueDays` —
   NOT percentScaled/flatMinor, and the third value kind is
   `trial_extension_days`. The moderation states include `draft` and
   `pending_review`; there is no bare `pending`. Every one of these was corrected
   after reading the engine, which is why the moderation filter below uses
   `pending_review`. */
type PromotionRow = {
  id: string;
  code: string;
  name: string;
  scopeKind: "platform" | "tier" | "partner" | "deal";
  scopeId: string;
  valueKind: "percent" | "flat_minor" | "trial_extension_days";
  valueScaled: number | null;
  valueMinor: number | null;
  valueDays: number | null;
  supersedesGrandfathered: boolean;
  moderationState: "draft" | "pending_review" | "approved" | "rejected" | "changes_requested";
  active: boolean;
  maxRedemptions: number | null;
  redemptionCount: number;
  expiresAt: string | null;
};

type DecisionRow = {
  id: string;
  itemId: string;
  decisionKey: string;
  state: string;
  question: string;
  ruling: string | null;
  rationale: string | null;
  sourceRef: string | null;
  ownerRequired: boolean;
  recordedAt: string;
  recordedBy: string;
};

type ReconcileResponse = {
  ok: boolean;
  liveCount: number;
  live: Array<{
    id: string;
    partnerId: string;
    partnerName: string | null;
    tierSlug: string;
    cycle: string;
    status: string;
    amountMinor: number;
    listAmountMinor: number | null;
    discountMinor: number | null;
    priceDerivation: string | null;
  }>;
  findings: Array<{ kind: string; partnerId: string; subscriptionId: string; detail: string }>;
  reconciled: boolean;
  coverage: { total: number; priced: number; unpriced: number };
};

const FINDING_LABELS: Record<string, string> = {
  subscription_without_roster_row: "Entitlement without a roster row",
  live_on_unpriced_tier: "Live on an unpriced tier",
  amount_not_list_minus_discount: "Stored amount ≠ list − discount",
};

/* ── Tab 1: tier prices (CP-SUB-12 / CP-SUB-13) ────────────────────────── */

function TierPricesTab() {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const coverage = useQuery<CoverageResponse>({
    queryKey: ["/api/admin/partner-billing/tier-prices"],
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/admin/partner-billing/tier-prices")).json(),
  });

  const save = useMutation({
    mutationFn: async (vars: { tierSlug: string; cadence: string; priceMinor: number | null; currency: string }) =>
      (await apiRequest("PUT", "/api/admin/partner-billing/tier-prices", vars)).json(),
    onSuccess: (data: any, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-billing/tier-prices"] });
      setDrafts((d) => {
        const next = { ...d };
        delete next[`${vars.tierSlug}|${vars.cadence}`];
        return next;
      });
      toast({
        title: vars.priceMinor === null ? "Tier marked unpriced" : "Price saved",
        description:
          data?.annualPreview && data.annualPreview.usedLegacyFallback
            ? `Annual for this tier still resolves via the ×12 fallback (${formatMinor(data.annualPreview.amountMinor, data.annualPreview.currency)}). Set an explicit annual price to remove the fallback.`
            : `${vars.tierSlug} / ${vars.cadence}`,
      });
    },
    onError: (e: unknown) => {
      toast({
        title: "Price not saved",
        description: e instanceof ApiError ? e.message : String(e),
        variant: "destructive",
      });
    },
  });

  if (coverage.isLoading) return <div className="text-sm text-muted-foreground" data-testid="tier-prices-loading">Loading tier prices…</div>;
  if (coverage.isError) {
    return (
      <AppCard title="Tier prices unavailable" data-testid="tier-prices-error">
        <p className="text-sm">{coverage.error instanceof ApiError ? coverage.error.message : "Could not load tier prices."}</p>
      </AppCard>
    );
  }
  const c = coverage.data!;

  return (
    <>
      {/* CP-SUB-13 — coverage is the promise, so it leads. An admin must be able
          to see WHICH tiers are unpriced, which a plain row list does not show. */}
      <AppCard title="Price coverage" data-testid="tier-price-coverage">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Tier / cadence pairs</div>
            <div className="mt-1 text-lg" data-testid="coverage-total">{c.total}</div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Priced</div>
            <div className="mt-1 text-lg" data-testid="coverage-priced">{c.priced}</div>
          </div>
          <div className={`rounded-md border p-3 ${c.unpriced > 0 ? "border-amber-500 bg-amber-500/10" : ""}`}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Unpriced</div>
            <div className="mt-1 text-lg" data-testid="coverage-unpriced">{c.unpriced}</div>
          </div>
        </div>
        {c.unpriced > 0 && (
          <p className="mt-3 text-sm" data-testid="coverage-unpriced-list">
            Unpriced: {c.unpricedPairs.map((p) => `${p.tierSlug}/${p.cadence}`).join(", ")}. A checkout against an
            unpriced tier is refused by the engine (<code>TIER_PRICE_UNPRICED</code>) rather than charged at a guessed
            amount. A tier priced at <strong>0</strong> is a real free tier and counts as priced.
          </p>
        )}
      </AppCard>

      <div className="mt-4">
        <AppCard title={`Tier prices (${c.rows.length})`} data-testid="tier-prices">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-tier-prices">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Cadence</th>
                  <th className="px-3 py-2">Current</th>
                  <th className="px-3 py-2">Basis</th>
                  <th className="px-3 py-2">New price (major units)</th>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => {
                  const key = `${r.tierSlug}|${r.cadence}`;
                  const draft = drafts[key] ?? minorToMajorInput(r.priceMinor);
                  const parsed = majorToMinorStrict(draft);
                  const invalid = parsed === undefined;
                  const changed = parsed !== undefined && parsed !== r.priceMinor;
                  return (
                    <tr className="border-b last:border-0" key={key} data-testid={`tier-price-row-${r.tierSlug}-${r.cadence}`}>
                      <td className="px-3 py-2">{r.tierSlug}</td>
                      <td className="px-3 py-2">{r.cadence}</td>
                      <td className="px-3 py-2 font-mono">
                        {r.priceMinor === null ? (
                          <span className="text-amber-600" data-testid={`tier-price-unpriced-${r.tierSlug}-${r.cadence}`}>unpriced</span>
                        ) : (
                          formatMinor(r.priceMinor, r.currency)
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{r.derivation}</td>
                      <td className="px-3 py-2">
                        <Input
                          value={draft}
                          placeholder="blank = unpriced"
                          className={invalid ? "border-destructive" : ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                          data-testid={`input-tier-price-${r.tierSlug}-${r.cadence}`}
                        />
                        {invalid && (
                          <p className="mt-1 text-xs text-destructive" data-testid={`tier-price-invalid-${r.tierSlug}-${r.cadence}`}>
                            Enter a whole or 2-decimal amount, or leave blank to mark this tier deliberately unpriced. The
                            value is never rounded to fit.
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {r.active ? "active" : "inactive"} · {r.currency}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          disabled={invalid || !changed || save.isPending}
                          onClick={() =>
                            save.mutate({ tierSlug: r.tierSlug, cadence: r.cadence, priceMinor: parsed as number | null, currency: r.currency })
                          }
                          data-testid={`button-save-tier-price-${r.tierSlug}-${r.cadence}`}
                        >
                          Save
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AppCard>
      </div>
    </>
  );
}

/* ── Tab 2: promotions (CP-PROMO-07 / 09 / 19 / 20) ────────────────────── */

function PromotionsTab() {
  const { toast } = useToast();
  const [note, setNote] = useState<Record<string, string>>({});
  const promos = useQuery<{ ok: boolean; promotions: PromotionRow[]; total: number; pendingCount: number }>({
    queryKey: ["/api/admin/partner-billing/promotions"],
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/admin/partner-billing/promotions")).json(),
  });

  const moderate = useMutation({
    mutationFn: async (vars: { id: string; decision: string; note?: string }) =>
      (await apiRequest("POST", `/api/admin/partner-billing/promotions/${vars.id}/moderate`, {
        decision: vars.decision,
        note: vars.note,
      })).json(),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-billing/promotions"] });
      toast({ title: `Promotion ${vars.decision}` });
    },
    onError: (e: unknown) =>
      toast({ title: "Moderation failed", description: e instanceof ApiError ? e.message : String(e), variant: "destructive" }),
  });

  if (promos.isLoading) return <div className="text-sm text-muted-foreground" data-testid="promotions-loading">Loading promotions…</div>;
  const rows = promos.data?.promotions ?? [];

  return (
    <AppCard title={`Promotions (${rows.length}, ${promos.data?.pendingCount ?? 0} awaiting moderation)`} data-testid="admin-promotions">
      <p className="mb-3 text-xs text-muted-foreground" data-testid="promotions-invariant-note">
        A promotion cannot be active unless it is approved — the database enforces
        <code className="mx-1">CHECK (active = 0 OR moderation_state = 'approved')</code>, so no code path, including this
        one, can produce an active unapproved discount. Percentage values are stored as exact integers (scale 1e9), never
        as floats.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="promotions-empty">
          No promotions have been created. Codes are authored by partners and land here for moderation.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-admin-promotions">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Value</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Expiry</th>
                <th className="px-3 py-2">Redemptions</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr className="border-b last:border-0" key={p.id} data-testid={`admin-promotion-row-${p.id}`}>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.code}
                    <div className="text-[10px] text-muted-foreground">{p.name}</div>
                    {p.supersedesGrandfathered && (
                      <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px]" data-testid={`promotion-supersedes-${p.id}`}>
                        supersedes grandfathered
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {/* CP-PROMO-09 — value semantics shown, never inferred. A
                        percent value is a FRACTION on the wire and is rendered
                        ×100 by the shared helper only. */}
                    {p.valueKind === "percent" && p.valueScaled !== null
                      ? `${formatFractionAsPercent(p.valueScaled / 1e9)} off`
                      : p.valueKind === "flat_minor" && p.valueMinor !== null
                        ? `${formatMinor(p.valueMinor, "USD")} off`
                        : p.valueKind === "trial_extension_days"
                          ? `${p.valueDays ?? 0} extra trial days`
                          : p.valueKind}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.scopeKind}
                    {p.scopeId ? <span className="ml-1 font-mono">{p.scopeId}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.expiresAt ? `until ${new Date(p.expiresAt).toLocaleDateString()}` : "no expiry"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.redemptionCount}
                    {p.maxRedemptions === null ? " / ∞" : ` / ${p.maxRedemptions}`}
                  </td>
                  <td className="px-3 py-2">
                    <span data-testid={`promotion-state-${p.id}`}>{p.moderationState}</span>
                    {p.active ? <span className="ml-1 text-xs text-emerald-600">active</span> : null}
                  </td>
                  <td className="px-3 py-2">
                    {p.moderationState === "pending_review" || p.moderationState === "draft" || p.moderationState === "changes_requested" ? (
                      <div className="space-y-1">
                        <Input
                          value={note[p.id] ?? ""}
                          placeholder="Reason (required to reject)"
                          onChange={(e) => setNote((n) => ({ ...n, [p.id]: e.target.value }))}
                          data-testid={`input-promotion-note-${p.id}`}
                        />
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            disabled={moderate.isPending}
                            onClick={() => moderate.mutate({ id: p.id, decision: "approved", note: note[p.id] })}
                            data-testid={`button-promotion-approve-${p.id}`}
                          >
                            <Check className="mr-1 h-3 w-3" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={moderate.isPending || (note[p.id] ?? "").trim().length < 5}
                            onClick={() => moderate.mutate({ id: p.id, decision: "rejected", note: note[p.id] })}
                            data-testid={`button-promotion-reject-${p.id}`}
                          >
                            <X className="mr-1 h-3 w-3" /> Reject
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={moderate.isPending || (note[p.id] ?? "").trim().length < 5}
                            onClick={() => moderate.mutate({ id: p.id, decision: "changes_requested", note: note[p.id] })}
                            data-testid={`button-promotion-changes-${p.id}`}
                          >
                            Changes
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">decided</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppCard>
  );
}

/* ── Tab 3: roster reconcile (CP-SUB-11) ───────────────────────────────── */

function ReconcileTab() {
  const recon = useQuery<ReconcileResponse>({
    queryKey: ["/api/admin/partner-billing/roster-reconcile"],
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/admin/partner-billing/roster-reconcile")).json(),
  });

  if (recon.isLoading) return <div className="text-sm text-muted-foreground" data-testid="reconcile-loading">Reconciling…</div>;
  const d = recon.data;

  return (
    <>
      <AppCard title="Roster reconciliation" data-testid="admin-roster-reconcile">
        <p className="mb-3 text-xs text-muted-foreground" data-testid="reconcile-method-note">
          The Dashboard, a partner's Billing page and this roster are three reads of two tables, so they can only disagree
          in a small number of enumerable ways. This check enumerates them rather than asserting agreement — an
          "everything matches" banner that was never falsified would be evidence of nothing.
        </p>
        {!d ? (
          <p className="text-sm">Reconciliation unavailable.</p>
        ) : d.reconciled ? (
          <div className="rounded-md border border-emerald-500 bg-emerald-500/10 p-3 text-sm" data-testid="reconcile-clean">
            <Check className="mr-1 inline h-4 w-4" />
            {d.liveCount} live subscription{d.liveCount === 1 ? "" : "s"} checked against the roster, the authored price
            table and the stored amount arithmetic. No discrepancies. ({d.coverage.unpriced} tier/cadence pairs remain
            unpriced overall, which is reported on the Tier Prices tab.)
          </div>
        ) : (
          <div className="rounded-md border border-destructive bg-destructive/10 p-3" data-testid="reconcile-findings">
            <p className="text-sm font-medium">
              <AlertTriangle className="mr-1 inline h-4 w-4" />
              {d.findings.length} discrepanc{d.findings.length === 1 ? "y" : "ies"} across {d.liveCount} live subscriptions
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {d.findings.map((f, i) => (
                <li key={`${f.subscriptionId}-${f.kind}-${i}`} data-testid={`reconcile-finding-${i}`}>
                  <strong>{FINDING_LABELS[f.kind] ?? f.kind}</strong> — partner <span className="font-mono text-xs">{f.partnerId}</span>,
                  subscription <span className="font-mono text-xs">{f.subscriptionId}</span>: {f.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AppCard>

      <div className="mt-4">
        <AppCard title={`Live subscriptions (${d?.liveCount ?? 0})`} data-testid="admin-live-subscriptions">
          {(d?.live ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="live-subscriptions-empty">
              No partner currently holds a pending, active, past-due, grace or grandfathered subscription.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-admin-live-subscriptions">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Partner</th>
                    <th className="px-3 py-2">Tier</th>
                    <th className="px-3 py-2">Cycle</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">List</th>
                    <th className="px-3 py-2 text-right">Discount</th>
                    <th className="px-3 py-2 text-right">Charged</th>
                    <th className="px-3 py-2">Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {(d?.live ?? []).map((r) => (
                    <tr className="border-b last:border-0" key={r.id} data-testid={`admin-live-subscription-${r.id}`}>
                      <td className="px-3 py-2">
                        {r.partnerName ?? <span className="text-destructive">no roster row</span>}
                        <div className="font-mono text-[10px] text-muted-foreground">{r.partnerId}</div>
                      </td>
                      <td className="px-3 py-2">{r.tierSlug}</td>
                      <td className="px-3 py-2">{r.cycle}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.listAmountMinor === null ? "—" : formatMinor(r.listAmountMinor, "USD")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinor(r.discountMinor ?? 0, "USD")}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatMinor(r.amountMinor, "USD")}</td>
                      <td className="px-3 py-2 text-xs">{r.priceDerivation ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AppCard>
      </div>
    </>
  );
}

/* ── Tab: SPV fee obligations (W-9) ─────────────────────────────────────── */

/* Mirrors `SpvFeeObligationDTO` (shared/spvEngine.ts:721) plus the three
   context fields the admin read joins on. */
type FeeObligationRow = {
  id: string;
  spvId: string;
  layer: string;
  portion: string;
  timing: string;
  amountMinor: number;
  currency: string;
  state: string;
  paymentRef: string | null;
  distributionId: string | null;
  waivedBy: string | null;
  waivedReason: string | null;
  createdAt: string;
  updatedAt: string;
  spvName: string | null;
  sponsorPartnerId: string;
  spvStatus: string | null;
};

function SpvFeeObligationsTab() {
  const { toast } = useToast();
  const [reason, setReason] = useState<Record<string, string>>({});

  const obligations = useQuery<{
    ok: boolean;
    obligations: FeeObligationRow[];
    total: number;
    blockingCount: number;
    states: string[];
    waiveRoute: string;
  }>({
    queryKey: ["/api/admin/spv-fee-obligations"],
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/admin/spv-fee-obligations")).json(),
  });

  /* The waive endpoint is NOT new — it has existed since v25.49 and had no
     client caller at all. This mutation is the caller; no server logic was
     re-implemented, so there is still exactly one writer to an obligation. */
  const waive = useMutation({
    mutationFn: async (vars: { spvId: string; obId: string; reason: string }) =>
      (await apiRequest("POST", `/api/admin/consortium-spv/${vars.spvId}/fee-obligations/${vars.obId}/waive`, {
        reason: vars.reason,
      })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spv-fee-obligations"] });
      toast({ title: "Fee obligation waived", description: "The fail-closed block on this SPV is cleared." });
    },
    onError: (e: unknown) =>
      toast({ title: "Waive failed", description: e instanceof ApiError ? e.message : String(e), variant: "destructive" }),
  });

  if (obligations.isLoading) {
    return <div className="text-sm text-muted-foreground" data-testid="spv-fee-obligations-loading">Loading fee obligations…</div>;
  }
  const rows = obligations.data?.obligations ?? [];

  return (
    <AppCard
      title={`SPV fee obligations (${rows.length}, ${obligations.data?.blockingCount ?? 0} blocking)`}
      data-testid="admin-spv-fee-obligations"
    >
      <p className="mb-3 text-xs text-muted-foreground" data-testid="spv-fee-obligations-note">
        A pending FIXED-fee funding obligation blocks its SPV by design (fail-closed). Waiving is the only way to clear
        that block, and until this wave the waive endpoint had no caller anywhere in the product — so a blocked SPV could
        not be unblocked from any screen. A waive is permanent and recorded against your account with the reason you give.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="spv-fee-obligations-empty">
          No SPV carries a fee obligation. Obligations are created when a fixed or hybrid fee is configured on a layer.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-admin-spv-fee-obligations">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">SPV</th>
                <th className="px-3 py-2">Layer / portion</th>
                <th className="px-3 py-2">Timing</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Waive</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const blocking = o.state === "pending" && o.timing === "funding";
                return (
                  <tr
                    className={`border-b last:border-0 ${blocking ? "bg-amber-500/5" : ""}`}
                    key={o.id}
                    data-testid={`spv-fee-obligation-row-${o.id}`}
                  >
                    <td className="px-3 py-2">
                      {o.spvName ?? o.spvId}
                      <div className="font-mono text-[10px] text-muted-foreground">{o.spvId}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {o.layer} / {o.portion}
                    </td>
                    <td className="px-3 py-2 text-xs">{o.timing}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMinor(o.amountMinor, o.currency)}</td>
                    <td className="px-3 py-2">
                      {o.state}
                      {blocking && (
                        <span className="ml-1 text-xs text-amber-600" data-testid={`spv-fee-obligation-blocking-${o.id}`}>
                          blocking
                        </span>
                      )}
                      {o.state === "waived" && (
                        <div className="text-[10px] text-muted-foreground" data-testid={`spv-fee-obligation-waived-${o.id}`}>
                          by {o.waivedBy ?? "unknown"}
                          {o.waivedReason ? ` — ${o.waivedReason}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {o.state === "pending" ? (
                        <div className="space-y-1">
                          <Input
                            value={reason[o.id] ?? ""}
                            placeholder="Reason (required, min 10 chars)"
                            onChange={(e) => setReason((r) => ({ ...r, [o.id]: e.target.value }))}
                            data-testid={`input-waive-reason-${o.id}`}
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            /* A waive with no stated reason is unauditable, so the
                               button stays disabled until one is written. */
                            disabled={waive.isPending || (reason[o.id] ?? "").trim().length < 10}
                            onClick={() => waive.mutate({ spvId: o.spvId, obId: o.id, reason: reason[o.id] })}
                            data-testid={`button-waive-obligation-${o.id}`}
                          >
                            Waive permanently
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{o.state}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AppCard>
  );
}

/* ── Tab 4: decision ledger (CP-SUB-19 / PROMO-04 / 17 / 22) ───────────── */

function DecisionsTab() {
  const decisions = useQuery<{
    ok: boolean;
    decisions: DecisionRow[];
    openPercentPolicy: Array<{ id: string; rulingKey: string; rulingStatus: string; notes: string | null }>;
    openCount: number;
    awaitingOwner: string[];
  }>({
    queryKey: ["/api/admin/partner-billing/decisions"],
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/admin/partner-billing/decisions")).json(),
  });

  if (decisions.isLoading) return <div className="text-sm text-muted-foreground" data-testid="decisions-loading">Loading decisions…</div>;
  const d = decisions.data;

  return (
    <>
      <AppCard title="Open questions" data-testid="admin-billing-open-decisions">
        <p className="mb-3 text-xs text-muted-foreground" data-testid="decisions-purpose-note">
          Some money items are decisions, not features. Recording them in a migration makes them durable; showing them
          here makes them visible. An open pricing question that exists only in a .sql file is indistinguishable from a
          dropped one.
        </p>
        {(d?.awaitingOwner ?? []).length > 0 && (
          <div className="mb-3 rounded-md border border-amber-500 bg-amber-500/10 p-3 text-sm" data-testid="decisions-awaiting-owner">
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            Awaiting an owner ruling: {(d?.awaitingOwner ?? []).join(", ")}. No default has been invented for these; the
            conservative behaviour is in force and is documented in each row below.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-admin-billing-decisions">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Question</th>
                <th className="px-3 py-2">Ruling / current behaviour</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {(d?.decisions ?? []).map((row) => (
                <tr
                  className={`border-b last:border-0 ${row.state === "open" ? "bg-amber-500/5" : ""}`}
                  key={row.id}
                  data-testid={`billing-decision-row-${row.itemId}`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.itemId}</td>
                  <td className="px-3 py-2">
                    {row.state}
                    {row.ownerRequired && row.state === "open" ? (
                      <span className="ml-1 text-xs text-amber-600" data-testid={`decision-owner-required-${row.itemId}`}>owner</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.question}</td>
                  <td className="px-3 py-2">
                    {row.ruling ?? <span className="text-muted-foreground">not ruled</span>}
                    {row.rationale ? <div className="mt-1 text-xs text-muted-foreground">{row.rationale}</div> : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">{row.sourceRef ?? "—"}</td>
                </tr>
              ))}
              {(d?.openPercentPolicy ?? []).map((row) => (
                <tr className="border-b bg-amber-500/5 last:border-0" key={row.id} data-testid={`percent-policy-open-${row.id}`}>
                  <td className="px-3 py-2 font-mono text-xs">{row.rulingKey}</td>
                  <td className="px-3 py-2">{row.rulingStatus}</td>
                  <td className="px-3 py-2">Percent-policy question recorded in percent_policy_record</td>
                  <td className="px-3 py-2">{row.notes ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">percent_policy_record</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AppCard>
    </>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */

export default function AdminPartnerBillingOps() {
  const [tab, setTab] = useState<OpsTab>("prices");

  return (
    <>
      <PageHeader
        title="Partner Billing Operations"
        description="Tier prices, promotion moderation, roster reconciliation and the build's open pricing decisions."
      />
      <PageBody>
        <div className="flex flex-wrap gap-2" data-testid="admin-partner-billing-ops-tabs" role="tablist">
          <FilterChip active={tab === "prices"} onClick={() => setTab("prices")} data-testid="tab-ops-prices">Tier Prices</FilterChip>
          <FilterChip active={tab === "promotions"} onClick={() => setTab("promotions")} data-testid="tab-ops-promotions">Promotions</FilterChip>
          <FilterChip active={tab === "reconcile"} onClick={() => setTab("reconcile")} data-testid="tab-ops-reconcile">Reconcile</FilterChip>
          <FilterChip active={tab === "spv-fees"} onClick={() => setTab("spv-fees")} data-testid="tab-ops-spv-fees">SPV Fees</FilterChip>
          <FilterChip active={tab === "invoicing"} onClick={() => setTab("invoicing")} data-testid="tab-ops-invoicing">Invoicing</FilterChip>
          <FilterChip active={tab === "decisions"} onClick={() => setTab("decisions")} data-testid="tab-ops-decisions">Decisions</FilterChip>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-billing/tier-prices"] })}
            data-testid="button-ops-refresh"
          >
            <RefreshCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>
        <div className="mt-4">
          {tab === "prices" && <TierPricesTab />}
          {tab === "promotions" && <PromotionsTab />}
          {tab === "reconcile" && <ReconcileTab />}
          {tab === "spv-fees" && <SpvFeeObligationsTab />}
          {tab === "invoicing" && <AdminInvoicingOpsPanel />}
          {tab === "decisions" && <DecisionsTab />}
        </div>
      </PageBody>
    </>
  );
}
