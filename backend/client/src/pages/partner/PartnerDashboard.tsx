/**
 * Foundation Build — Partner Dashboard.
 *
 * Tier-aware landing page summarizing portfolio + pipeline + recent activity.
 * No mock data on any code path. Empty state for new partners.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole, tierAtLeast } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
/* WAVE 115 · FINDING 1 — `partnerPipelineStageLabel`, `quotaEnforcementLabel`
   and `planTierLabel` join `activityTypeLabel` from the same module. The stage
   accessor delegates to PARTNER_PIPELINE_STAGE_LABELS (shared/crmStages.ts:130),
   the map that already governs these six keys on PartnerPipeline.tsx — no second
   vocabulary is introduced here. */
import { activityTypeLabel, partnerPipelineStageLabel, quotaEnforcementLabel, planTierLabel, billingPeriodPhrase } from "@/lib/partnerDisplay";
import { formatMinor } from "@/lib/currency"; /* v25.40 FIX-12 currency sweep */
// v25.46 BLOCKER FIX #4 (Tier 9 #73) — dashboard cards now use the canonical
// AppCard primitive instead of shadcn Card. Widgets/data-testids unchanged.
import { AppCard } from "@/components/ui/app-card";
// v25.49 Phase-3B — surface the shared comms Messages + Posts on the partner
// dashboard. Reuses the same session-scoped feeds (fail-closed server-side);
// no parallel backend.
import { MessagesWidget } from "@/components/comms/MessagesWidget";
import { PostsFeed } from "@/components/comms/PostsFeed";
import { VentureMarketsCard } from "@/components/collective/widgets/VentureMarketsCard";

/* GROUP C (C5) — the dynamic effective plan the server composes for THIS
   partner (price incl. per-partner override, commission, report-only quota,
   fixed rev-share). Drives the quota tracker + rev-share status cards below. */
interface EffectivePlan {
  /* WAVE 129 — `billingPeriod` is the cadence stored on the authoritative
     `partner_tier_price` row (or, for an override, the cadence that override was
     written under). It is nullable because "no cadence on record" is a real
     state that must be refused, not defaulted. */
  effectivePrice: { amountMinor: number; currency: string; source: string; billingPeriod: string | null };
  advertisedPrice: { amountMinor: number; currency: string; billingPeriod: string | null } | null;
  commission: { rate: number; via: string };
  arrangement: {
    subscriptionModel?: string | null;
    revShare?: { enabled?: boolean; fixedAmountMinor?: number; currency?: string; source?: string } | null;
  } | null;
  quotaProgress: {
    metric: string;
    registeredThisPeriod: number;
    threshold: number | null;
    period: string;
    enforcement: string;
    met: boolean;
  };
}
interface PartnerMeResp {
  partnerId: string;
  tier: string;
  effectivePlan: EffectivePlan | null;
  /* GROUP F3 — additive, DISPLAY-only reconciliation fields. */
  status?: "active" | "inactive" | "suspended" | "archived" | null;
  commissionPct?: number | null;
  partnerType?: string | null;
  region?: string | null;
  /* WAVE 7B FE-14 (DEF-060) — additive, DISPLAY-only. Derived server-side from
     contacts.subscription_id at server/partnerRoutes.ts. Absent on an older
     server, which is why the label below treats undefined as "unknown" and
     falls back to neutral wording rather than to the old false claim. */
  subscriptionState?: "subscribed" | "unsubscribed" | "unknown" | null;
  /* WAVE 69 · V-4 (R58 row 4) — additive, DISPLAY-only. Wave 56b added this field
     to `GET /api/partner/me` (`server/partnerRoutes.ts:761/767-770/832`) so a
     partner learns WHY their plan is missing. It had ZERO client consumers, so it
     said why to nobody. Read here for the first time. Optional, so an older
     server that omits it renders exactly what it renders today. */
  effectivePlanError?: { code: string; tier: string; message: string } | null;
}

interface DashboardSnapshot {
  /* WAVE 115 · FINDING 7 — `null` means the authoritative committed figure could
     not be read. It is NOT zero and must never be formatted as $0.00. */
  portfolio: {
    attributedCompanies: number;
    totalSpvCommittedMinor: number | null;
    totalFundCommittedMinor: number | null;
    committedFigureSource?: string;
    /* WAVE 178 · ITEM A — the per-currency rollup. The two scalars above are the
       engine's all-vehicle sums and are NOT displayed as one labelled figure any
       more: adding CA$ and HK$ into a USD total is not a quantity. Optional on
       this type so a stale cached payload cannot crash the tile. */
    capitalByCurrency?: {
      rows: Array<{
        currency: string;
        vehicleCount: number;
        committedMinor: number;
        spvCommittedMinor: number;
        fundCommittedMinor: number;
        /** `null` — never 0 — when no vehicle in this currency records a goal. */
        targetMinor: number | null;
        targetUnknownCount: number;
      }>;
      vehiclesWithoutCurrency: number;
      unavailable: boolean;
    };
  };
  pipeline: { byStage: Record<string, number>; topDeals: Array<{ id: string; dealName: string; estCheckSizeMinor: number | null; currency: string | null }> };
  recentActivity: Array<{ id: string; activityType: string; body: string; occurredAt: string }>;
  team: { activeSeats: number; pendingInvitations: number; seatLimit: number };
  empty: boolean;
}

/* v14 Tier-1 Fix 5 — feature-flag gate. Hides the partner workspace behind a
 * preview banner when FEATURE_PARTNER_WORKSPACE_ENABLED=false. Default is
 * enabled — the banner only renders on preview/staging deploys that opt out. */
interface FeatureFlags {
  PARTNER_WORKSPACE_ENABLED: boolean;
  COLLECTIVE_ADMIN_APPROVAL_ENABLED: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════════
   WALKTHROUGH WAVE F · ITEM 1c — FOUR NAMED READING GROUPS.

   The owner: "This is very boring and plain for any user. It can also be
   confusing to follow. Rebrand/redesign this to be more engaging and easier to
   read/look at."

   THE DIAGNOSIS. Eight cards sat in one flat grid, each with the same weight,
   the same white ground and a two-word title. Nothing told the eye where to
   start or which boxes belonged together — "Portfolio", "Plan & quota" and
   "Recent activity" looked like three unrelated things when two of them are
   about money and one is a log.

   THE FIX IS GROUPING, NOT DECORATION. Each card now declares which of four
   groups it belongs to, and each group has a name that is RENDERED AS TEXT on
   every card in it. One accent — the ratified navy — at four depths marks the
   group as a 3px rule along the top of the card.

   NEVER COLOUR ALONE. The rule and the label always ship together: the label is
   the fact, the rule is the reinforcement. A reader who cannot distinguish the
   four navy depths still reads four named groups, and
   `client/src/pages/partner/__tests__/wf_dashboard_dom.test.tsx` fails if a card
   ever carries the group attribute without the matching rendered label.

   WHY ONLY THE CARDS THIS FILE RENDERS. `MessagesWidget` and
   `VentureMarketsCard` are shared components owned elsewhere and mounted here;
   reaching into them to paint a group mark would spend another file's risk
   budget on this page's problem. They are therefore left unmarked. An unmarked
   card makes no claim — it simply is not in a group — whereas a wrong mark
   would be a false statement about the page's own structure.
   ══════════════════════════════════════════════════════════════════════════════ */
const DASH_GROUP_LABEL = {
  capital: "Your capital",
  work: "Your work",
  firm: "Your firm",
  market: "Markets and network",
} as const;

type DashGroup = keyof typeof DASH_GROUP_LABEL;

/** The group's name, rendered inside the card it marks. The `cardKey` makes the
 *  test id unique per card, because two cards can share a group. */
function DashGroupLabel({ group, cardKey }: { group: DashGroup; cardKey: string }) {
  return (
    <div
      className="text-[10px] font-semibold mb-1.5"
      data-cv-wf="dash-group-label"
      data-cv-dash-group-label={group}
      data-testid={`dash-group-label-${cardKey}`}
    >
      {DASH_GROUP_LABEL[group]}
    </div>
  );
}

export default function PartnerDashboard() {
  const role = useRequirePartnerRole();
  const flagsQ = useQuery<FeatureFlags>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const q = useQuery<DashboardSnapshot>({
    queryKey: ["/api/partner/me/dashboard"],
    enabled: role.ready && flagsQ.data?.PARTNER_WORKSPACE_ENABLED !== false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/dashboard")).json(),
  });
  /* GROUP C (C5) — dynamic effective plan for the quota tracker + rev-share status. */
  const planQ = useQuery<PartnerMeResp>({
    queryKey: ["/api/partner/me"],
    enabled: role.ready && flagsQ.data?.PARTNER_WORKSPACE_ENABLED !== false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me")).json(),
    /* WAVE 129 (R95) — NO CACHE MAY OUTLIVE AN ADMIN PRICE CHANGE.
       client/src/lib/queryClient.ts:282 sets `staleTime: 30_000` as the default
       for EVERY query, with refetchOnWindowFocus and refetchInterval off. This
       payload carries the partner's price, so that default meant an admin could
       change the tier price and this dashboard would keep quoting the old figure
       for up to 30 seconds. `staleTime: 0` makes the next request read through,
       matching the one surface that already got this right
       (client/src/pages/founder/ApplyToCollective.tsx:565). */
    staleTime: 0,
  });

  /* WAVE 129 (R95) — the plan price and its PERIOD, computed once.
   *
   * Hoisted into a useMemo rather than written as a conditional in the JSX on
   * purpose: replacing sibling elements with one conditional trips the
   * silent-drop gate (build_log/wave116/W116_TESTS.md §3.1). The rendered element
   * shape below is therefore IDENTICAL to before — one div, one span — and only
   * the strings inside them come from here.
   *
   * `figure` is deliberately EMPTY when no billing period is on record. R95: a
   * surface that cannot state the period must print no figure and say why, rather
   * than show an amount whose meaning the reader has to guess. That guess is the
   * defect this wave exists to remove — the annual $240.00 was read as monthly. */
  const planPrice = useMemo(() => {
    const price = planQ.data?.effectivePlan?.effectivePrice ?? null;
    if (!price) return { figure: "", periodText: "" };
    const phrase = billingPeriodPhrase(price.billingPeriod);
    if (!phrase) {
      return {
        figure: "",
        periodText:
          "We cannot show this price: no billing period is recorded for your tier, " +
          "so we will not state an amount that could be read as the wrong period. " +
          "Nothing has been charged. Contact us and we will confirm your price.",
      };
    }
    return {
      figure: formatMinor(price.amountMinor, price.currency, { locale: "en-US" }),
      periodText: `${price.currency} ${phrase}`,
    };
  }, [planQ.data]);

  if (flagsQ.data && flagsQ.data.PARTNER_WORKSPACE_ENABLED === false) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-8" data-testid="partner-workspace-preview-banner">
        <AppCard className="max-w-lg text-center">
          {/* WAVE 126 / FINDING 1 — a construction sign and "Coming Soon" are a
              statement about OUR release schedule. The access rule is the only
              thing the reader needs, and the paragraph below already states it
              and already says who to ask. */}
          <div className="cv-card-title text-base font-semibold mb-2">Access to the Partner Workspace</div>
          <p className="text-[var(--cv-color-text)]">
            The Partner Workspace is an invite-only beta. Reach out to{" "}
            <a className="text-[var(--cv-color-primary)] underline" href="mailto:ops@capavate.com">ops@capavate.com</a>{" "}
            to enable it for your organisation.
          </p>
        </AppCard>
      </div>
    );
  }

  if (!role.ready || !role.identity) return null;
  const data = q.data;
  /* ═════════════════════════════════════════════════════════════════════
     WAVE 178 · ITEM A — THE HEADLINE WAS A CROSS-CURRENCY SUM LABELLED "USD".

     The figure itself was the RIGHT quantity: the server derives it from the
     canonical `status = 'committed'` predicate, the same one the authoritative
     close statement's `confirmedMinor` uses. It was not a sum of target raises.
     What was wrong is that vehicles denominated in CAD and HKD were added into
     the same number and the label said USD.

     Capavate has NO exchange-rate source, and none is invented here. The server
     now returns one row per currency; this tile shows the US-dollar figures
     beside the existing "USD" label — which makes that label true — and every
     currency is listed separately below with its own committed total and its own,
     distinctly labelled, target raise. No selection or arithmetic on money
     happens in this file: each rendered figure is a single server-computed
     integer handed straight to `formatMinor` with ITS OWN currency.
     ═════════════════════════════════════════════════════════════════════ */
  const capital = data?.portfolio.capitalByCurrency ?? null;
  const capitalRows = capital?.rows ?? [];
  const usdRow = capitalRows.find((r) => r.currency === "USD") ?? null;
  /* GROUP F3 — admin-set status from the /me payload drives the non-blocking
   * PartnerShell banner (DISPLAY only; server still gates all data/writes). */
  const partnerStatus = planQ.data?.status ?? role.identity.status ?? null;
  /* ═══════════════════════════════════════════════════════════════════════════
     WALKTHROUGH WAVE F · ITEM 1a — THE NAME THE WELCOME BAND ADDRESSES.

     Read from the SAME field the page header already prints at
     `partner-name` (`role.identity.identity.name`), so the band can never greet
     a different firm from the one the header names. Trimmed and tested for
     emptiness rather than assumed present: a firm record with a blank name would
     otherwise render "Welcome, " with nothing after the comma, and the band has
     an honest wording for that case instead (R257.1 — absent is its own fact).
     ═══════════════════════════════════════════════════════════════════════════ */
  const partnerDisplayName = (role.identity.identity.name ?? "").trim();
  return (
    <PartnerShell title="Dashboard" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name} status={partnerStatus}>
      {/* ════════════════════════════════════════════════════════════════════════
          WALKTHROUGH WAVE F · ITEM 1a — "This top area could be more 'welcoming'
          and powerful."

          A bigger logo answers half of what the owner asked for. The other half
          is that the top of his front page said "Dashboard · Partner workspace"
          and nothing else — it never addressed him, and it never said what the
          workspace is for. This band does both, in three lines, using only facts
          already on the page.

          WHY IT SITS OUTSIDE EVERY DATA BRANCH. It is rendered as the FIRST
          child of the shell body, above the error, loading, empty and loaded
          branches, so the greeting is present in all four. It contains no
          figure, no count and no status, which is precisely why it is safe
          there: there is nothing in it that could be wrong while the dashboard
          query is failing (R257.1, and the wave rule that copy must be true in
          every branch — loaded, empty, loading and error).

          NO NEW HUE. One navy rule on the leading edge at the deepest ramp step,
          the eyebrow at ramp-3 and the lede in the ratified caption grey; the
          measured ratios are asserted in
          `client/src/styles/__tests__/wf_dashboard_colour_contrast.test.tsx`.
          No icon, no illustration, no fill, no gradient.
          ════════════════════════════════════════════════════════════════════════ */}
      <div className="mb-5" data-cv-wf="welcome" data-testid="partner-welcome-band">
        <div
          className="text-[10px] font-semibold"
          data-cv-wf="welcome-eyebrow"
          data-testid="welcome-eyebrow"
        >
          Consortium Partner workspace
        </div>
        <div
          className="mt-1.5 text-2xl font-bold leading-tight"
          data-cv-wf="welcome-title"
          data-testid="welcome-title"
        >
          {partnerDisplayName ? (
            <>
              Welcome,{" "}
              <span data-testid="welcome-partner-name">{partnerDisplayName}</span>
            </>
          ) : (
            <span data-testid="welcome-name-absent">Welcome to your Consortium Partner workspace</span>
          )}
        </div>
        <div
          className="mt-2 text-xs max-w-3xl"
          data-cv-wf="welcome-lede"
          data-testid="welcome-lede"
        >
          Everything your firm runs on Capavate, in one place: the companies attributed to you, the deals in your pipeline, your team and plan, and the growth-market exchanges Capavate tracks for you.
        </div>
      </div>
      {/* v25.16 NH1 — explicit error branch; previously a fetch failure left
         the dashboard stuck on "Loading…" with no retry path. */}
      {q.isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="dashboard-error"
        >
          Could not load dashboard. Please refresh and try again.
        </div>
      )}
      {!data && !q.isError && <div className="text-[var(--cv-color-text-muted)]" data-testid="dashboard-loading">Loading…</div>}
      {data && data.empty && (
        <PartnerEmptyState
          title="Your portfolio is just getting started"
          description="Add your first attributed company to begin. Capavate admin can attribute companies to your partner record, or sign companies up with your referral code."
        />
      )}
      {data && !data.empty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AppCard data-testid="card-portfolio" data-cv-dash-group="capital">
            <DashGroupLabel group="capital" cardKey="portfolio" />
            <div className="cv-card-title text-sm font-semibold mb-3">Portfolio</div>
            <div>
              <div className="text-3xl font-bold" data-testid="kpi-companies">{data.portfolio.attributedCompanies}</div>
              <div className="text-xs text-[var(--cv-color-text-muted)]">attributed companies</div>
              {/* v25.16 NL1 — currency label on committed totals so the
                 number is not bare. (Server-side multi-currency rollup is
                 covered by server NM1.) */}
              {/* v25.40 FIX-12 (consortium P2 #1): the v25.38 currency-formatter
                 sweep missed these two inline `(value / 100).toLocaleString()`
                 calls, which hardcoded a 2-decimal divisor and broke 0-/3-decimal
                 currencies. Use the shared ISO 4217-aware formatMinor instead.
                 The portfolio rollup has no per-currency field yet (server-side
                 multi-currency rollup is tracked separately), so we default to
                 "USD" — matching the prior hardcoded label. */}
              <div className="text-xs mt-3 text-[var(--cv-color-text-secondary)]" data-testid="kpi-spv">
                {/* ═══════════════════════════════════════════════════════════
                    WAVE 115 · FINDING 7 — THIS TILE PRINTED "$0.00 USD" WHILE A
                    REAL $10,000 LP COMMITMENT EXISTED ON PLATFORM.

                    The server figure is now derived from the canonical SPV
                    engine through WAVE 112's one shared predicate
                    (`canonicalCommittedMinorForSpv`, spvEngineStore.ts:3731)
                    instead of from a RAM denorm with no live writer
                    (`server/partnerWorkspaceStore.ts` — full chain documented at
                    its dashboard return statement).

                    AND IT CAN NOW BE `null`. A printed $0.00 that means "we
                    could not read this" is a false statement about money on the
                    owner's front page. When the figure is unavailable this tile
                    says so, in words, and does not format a number.

                    WAVE 283 — THE GUARD AND THE PRINTED NUMBER WERE TWO
                    DIFFERENT FIELDS. The condition below tested
                    `totalSpvCommittedMinor`, but the number actually reaching
                    the screen came from `usdRow`, derived from the SEPARATE
                    `capitalByCurrency` rollup. The server computes the two in
                    two independent try/catch blocks, so the rollup can fail
                    while the totals read fine — and then `usdRow` was `null`
                    and `: 0` printed "$0.00 USD" directly above the sibling at
                    `kpi-by-currency-unavailable` which says, in the platform's
                    own words, that a zero would be a stated failure and not an
                    amount. The guard is therefore widened to cover EVERY state
                    in which the US-dollar figure cannot be read:

                      · totals null            — the engine read failed
                      · capital == null        — the payload carries no rollup
                                                 at all (older server, or a
                                                 stale cached payload)
                      · capital.unavailable    — the rollup itself refused

                    `capital.unavailable === true` is an EXPLICIT sentinel
                    comparison, never falsiness (R257.4): the client ships
                    before or after the server, never with it.

                    `usdRow == null` is DELIBERATELY NOT folded in. When the
                    rollup reads fine and simply holds no US-dollar vehicle, the
                    zero is TRUE, and the sibling at `kpi-no-usd-vehicles` says
                    exactly why. Withholding a truthful figure is the same
                    defect pointing the other way.

                    The existing sentence below is true in all three widened
                    branches, and PENDING cannot reach it: this whole card is
                    inside `{data && !data.empty}`, so while the query is
                    pending `dashboard-loading` renders instead and the tile is
                    not mounted at all (R257.1 — absent, failed and pending are
                    three different facts).
                    ═══════════════════════════════════════════════════════════ */}
                SPVs committed:{" "}
                {data.portfolio.totalSpvCommittedMinor == null || capital == null || capital.unavailable === true ? (
                  <span data-testid="kpi-spv-unavailable">not available right now — we could not read the committed total</span>
                ) : (
                  <>
                    {formatMinor(usdRow ? usdRow.spvCommittedMinor : 0, "USD", { locale: "en-US" })}{" "}
                    <span className="text-[var(--cv-color-text-faint)]">USD</span>
                  </>
                )}
              </div>
              <div className="text-xs text-[var(--cv-color-text-secondary)]" data-testid="kpi-fund">
                Funds committed:{" "}
                {/* WAVE 283 — same widening, same reasons, as the SPV tile
                    above. Both tiles read the SAME `usdRow`, so a fix applied to
                    only one of them would have left the other printing a
                    fabricated $0.00 from the identical failure. */}
                {data.portfolio.totalFundCommittedMinor == null || capital == null || capital.unavailable === true ? (
                  <span data-testid="kpi-fund-unavailable">not available right now — we could not read the committed total</span>
                ) : (
                  <>
                    {formatMinor(usdRow ? usdRow.fundCommittedMinor : 0, "USD", { locale: "en-US" })}{" "}
                    <span className="text-[var(--cv-color-text-faint)]">USD</span>
                  </>
                )}
              </div>
              {/* WAVE 178 · ITEM A — everything from here down is ADDITIVE. Not one
                  literal above was reworded: a replaced text node scores as a
                  removed copy string (R143.1), and the clarifiers this defect
                  needs are static siblings. The card previously printed a total
                  and said nothing about its basis, its currency scope or what it
                  left out. That silence is what let a cross-currency sum sit on
                  the owner's front page unnoticed, so the scope is now stated on
                  screen next to the money. */}
              <div className="text-xs mt-3 text-[var(--cv-color-text-secondary)]" data-testid="kpi-currency-scope">
                Committed capital is never added across currencies, because Capavate holds no exchange-rate source. The two figures above count your US-dollar vehicles only. Vehicles held in any other currency are excluded from them and are listed separately below, each in its own currency.
              </div>
              {capital != null && capital.unavailable && (
                <div className="text-xs mt-2 text-[var(--cv-color-text-secondary)]" data-testid="kpi-by-currency-unavailable">
                  The per-currency breakdown could not be read, so no currency totals are shown here. That is a stated failure, not an amount of zero.
                </div>
              )}
              {capital != null && !capital.unavailable && usdRow === null && (
                <div className="text-xs mt-2 text-[var(--cv-color-text-secondary)]" data-testid="kpi-no-usd-vehicles">
                  Your firm holds no US-dollar vehicles, so the two US-dollar figures above are zero as a matter of record, not because a figure was missing.
                </div>
              )}
              {capital != null && !capital.unavailable && capitalRows.length === 0 && capital.vehiclesWithoutCurrency === 0 && (
                <div className="text-xs mt-2 text-[var(--cv-color-text-secondary)]" data-testid="kpi-capital-none">
                  No SPV or fund vehicles are on record for your firm yet, so there is no committed capital and no target raise to report.
                </div>
              )}
              {capitalRows.length > 0 && (
                <>
                  <div className="text-xs mt-3 font-medium text-[var(--cv-color-text-secondary)]" data-testid="kpi-by-currency-heading">
                    Committed capital and target raise, by currency:
                  </div>
                  <ul className="text-xs space-y-1" data-testid="kpi-by-currency">
                    {capitalRows.map((r) => (
                      <li key={r.currency} data-testid={`kpi-ccy-${r.currency}`}>
                        <span className="font-medium" data-testid={`kpi-ccy-code-${r.currency}`}>{r.currency}</span>{" "}
                        <span data-testid={`kpi-ccy-committed-${r.currency}`}>
                          committed capital: {formatMinor(r.committedMinor, r.currency, { locale: "en-US" })}
                        </span>{" "}
                        <span data-testid={`kpi-ccy-target-${r.currency}`}>
                          target raise, a fundraising goal and not capital committed:{" "}
                          {r.targetMinor == null ? (
                            <span data-testid={`kpi-ccy-target-absent-${r.currency}`}>no goal on record</span>
                          ) : (
                            formatMinor(r.targetMinor, r.currency, { locale: "en-US" })
                          )}
                        </span>{" "}
                        <span data-testid={`kpi-ccy-count-${r.currency}`}>vehicles counted: {r.vehicleCount}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {capital != null && capital.vehiclesWithoutCurrency > 0 && (
                <div className="text-xs mt-2 text-[var(--cv-color-text-secondary)]" data-testid="kpi-no-currency">
                  Vehicles with no currency on record, excluded from every figure on this card rather than assumed to be US dollars: {capital.vehiclesWithoutCurrency}
                </div>
              )}
            </div>
          </AppCard>
          <AppCard data-testid="card-pipeline" data-cv-dash-group="work">
            <DashGroupLabel group="work" cardKey="pipeline" />
            <div className="cv-card-title text-sm font-semibold mb-3">Pipeline</div>
            <div>
              <ul className="text-xs space-y-1">
                {Object.entries(data.pipeline.byStage).map(([s, n]) => (
                  <li key={s} className="flex justify-between"><span className="text-[var(--cv-color-text-muted)]" data-testid={`pipeline-stage-${s}`}>{partnerPipelineStageLabel(s)}</span><span className="font-medium">{n}</span></li>
                ))}
              </ul>
            </div>
          </AppCard>
          <AppCard data-testid="card-team" data-cv-dash-group="firm">
            <DashGroupLabel group="firm" cardKey="team" />
            <div className="cv-card-title text-sm font-semibold mb-3">Team</div>
            <div>
              <div className="text-3xl font-bold" data-testid="kpi-seats">{data.team.activeSeats} / {data.team.seatLimit === 9999 ? "∞" : data.team.seatLimit}</div>
              <div className="text-xs text-[var(--cv-color-text-muted)]">active seats</div>
              <div className="text-xs mt-2" data-testid="kpi-pending-invites">{data.team.pendingInvitations} pending invitations</div>
            </div>
          </AppCard>
          {/* v25.49 Phase-3B — compact NETWORK cards: Messages + Posts. Reuse
             the shared comms widgets; feeds are session-scoped/fail-closed. */}
          <div className="md:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="card-network">
            <MessagesWidget basePath="/collective/partner/messages" title="Messages" />
            <AppCard data-testid="card-posts" data-cv-dash-group="market">
              <DashGroupLabel group="market" cardKey="posts" />
              <div className="cv-card-title text-sm font-semibold mb-3">Network posts</div>
              <PostsFeed role="investor" basePath="/collective/partner" maxPosts={3} viewAllHref="/collective/partner/posts" />
            </AppCard>
          </div>
          {/* WAVE 20 / FE-20 — WIRING, not a build. The Global Venture &
              Early-Stage Markets widget already existed
              (client/src/components/collective/widgets/VentureMarketsCard.tsx),
              reading GET /api/feeds/venture-markets
              (server/ventureMarketsStore.ts:321), and the admin-driven provider
              selection behind it already shipped too
              (GET/POST /api/admin/market-data-integrations,
              server/collectiveAdminSettingsRoutes.ts:133,:146, with the UI at
              client/src/pages/admin/AdminIntegrations.tsx). What was missing was
              a door on the PARTNER side: the card was mounted at exactly ONE
              place, client/src/pages/collective/CollectiveDashboard.tsx:281.
              Partners — the audience for early-stage market context — had no
              way to see it. Mounting the SAME component against the SAME
              endpoint adds no second door onto the data and no second source of
              truth.

              The feed is gated by requireCollectiveMember
              (server/lib/requireCollectiveMember.ts:93). A partner who is not an
              active Collective member therefore gets a 403, and the card renders
              that refusal as copy via collectiveWidgetErrorText
              ("Collective membership required.") — never a fabricated figure and
              never a silent empty table. That is the correct visible outcome,
              not a reason to leave the widget unmounted. */}
          <div className="md:col-span-3" data-testid="card-venture-markets">
            <VentureMarketsCard />
          </div>
          {/* ═══════════════════════════════════════════════════════════════════
              WAVE 80 · ITEM 4.1 + ITEM 1 — THE CARD THAT ADVERTISED A SPRINT NUMBER.
              ═══════════════════════════════════════════════════════════════════
              WHAT A PARTNER SAW. A routed, tier-gated card containing one sentence:
              "Coming with Sprint 32 consent ledger." No data read, no action, no
              route. It named this project's internal delivery schedule to a paying
              Consortium Partner, which is exactly what Q25 forbids, and it promised a
              date the partner has no way to hold anyone to.

              WHAT IT SAYS NOW. The same card, in the same place, kept rather than
              deleted ("we cannot disable vehicles"). It states the BEHAVIOUR and the
              REASON — cross-portfolio overlap needs each investor's consent before one
              partner can be shown that an investor also appears in another partner's
              portfolio — and it states plainly that the feature is not yet available.
              No sprint, no date, no promise anyone has to keep. There is no control on
              this card to disable, because there never was one: it has never had an
              action, so nothing here can report a success it did not earn. */}
          {tierAtLeast(role.identity.tier, "nexus") && (
            <AppCard className="md:col-span-3 border-dashed" data-testid="card-cross-portfolio" data-cv-dash-group="market">
              <DashGroupLabel group="market" cardKey="cross-portfolio" />
              <div className="cv-card-title text-sm font-semibold mb-3">Cross-portfolio investor overlap</div>
              <div>
                {/* WAVE 135 · FINDING 1 — "Not yet available." is a statement about OUR build
                    state, and a client does not buy our build state. Wave 126 wrote it
                    deliberately and this reverses that choice deliberately: the operative
                    fact is a CONSENT RULE, and the consent rule is true today, permanently,
                    and independently of whether anything is shipped. Stating the rule tells
                    the client exactly why the card is empty and what would change it, which
                    is strictly more than "not yet" told them. Nothing about the gating,
                    the card or the absent control moves — only the sentence. */}
                <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="text-cross-portfolio-unavailable">An investor is only shown as appearing in another partner's portfolio when that investor has recorded their consent to it. Capavate will not surface an overlap without that consent, so this card stays empty until consent is on record.</div>
              </div>
            </AppCard>
          )}
          {/* ═══════════════════════════════════════════════════════════════════
              WALKTHROUGH WAVE F · ITEM 1e — THE TWO ADMINISTRATIVE ROWS, MOVED TO
              THE BOTTOM AND SET IN TWO COLUMNS.

              The owner: the two admin boxes should move to the BOTTOM of the
              content section, "maybe even displayed in two columns rather than
              two big rows."

              WHICH TWO BOXES. The only two full-width rows on this page were
              `card-plan` ("Plan & quota") and `card-recent` ("Recent activity") —
              both carried `md:col-span-3`, i.e. they each spanned the whole grid
              and stacked as the "two big rows" the owner described. `card-team`
              is a one-third card in the top row, so it is not one of the two.

              `card-plan-unavailable` travels WITH `card-plan` because it is that
              card's failure branch, not a third box: the two are mutually
              exclusive (`planQ.data?.effectivePlan` versus
              `!effectivePlan && effectivePlanError`). Leaving it behind would put
              the plan area at the bottom when the plan reads and in the middle of
              the page when it does not — the same information moving around
              depending on whether a request succeeded.

              HOW THE MOVE IS DONE, AND WHY IT IS NOT A DROP. The three blocks are
              relocated VERBATIM, in their original source order, into the wrapper
              below; the only edit inside them is that each card's own
              `md:col-span-3` is gone, because the wrapper now owns the span. Not
              one condition, handler, literal, prop or data-testid is changed, and
              nothing is deleted (R195.5).

              THE WRAPPER SHAPE IS ALREADY PROVEN IN THIS FILE. It is the exact
              class list `card-network` above has used since v25.49 Phase-3B:
              full-width on the outer grid, one column on small screens, two from
              the `lg` breakpoint. So the two-column result is not a new layout
              idea being tried out on the owner's front page.

              A MOVE IS A CLAIM ABOUT REACHABILITY, AND REACHABILITY IS A SET.
              `client/src/pages/partner/__tests__/wf_1e_move_set_equality.test.tsx`
              enumerates every `data-testid` the loaded dashboard renders before
              and after, asserts the two sets are EQUAL and both non-empty, and
              runs a control that performs the same relocation by DELETION to show
              the assertion does collapse when the panel really goes missing.
              ═══════════════════════════════════════════════════════════════════ */}
          <div
            className="md:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-4"
            data-testid="card-admin-columns"
          >
            {/* GROUP C (C5) — dynamic plan: quota tracker (report-only) + rev-share
               status. Rendered only when the server resolved an effective plan. */}
            {planQ.data?.effectivePlan && (
              <AppCard data-testid="card-plan" data-cv-dash-group="capital">
                <DashGroupLabel group="capital" cardKey="plan" />
                <div className="cv-card-title text-sm font-semibold mb-3">Plan &amp; quota</div>
                {/* GROUP F3 — DISPLAY-only commission %. Renders the server-derived
                   commissionPct (percent form of the EXISTING commission rate).
                   It NEVER drives any calculation, ledger or payment path. */}
                {planQ.data.commissionPct != null && (
                  <div className="text-xs text-[var(--cv-color-text-muted)] mb-3" data-testid="plan-commission">
                    Commission:{" "}
                    <span className="font-semibold text-[var(--cv-color-text)]" data-testid="kpi-commission-pct">
                      {Number.isInteger(planQ.data.commissionPct)
                        ? planQ.data.commissionPct
                        : planQ.data.commissionPct.toFixed(2)}%
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div data-testid="plan-quota">
                    <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">
                      Registered this month
                      {planQ.data.effectivePlan.quotaProgress.threshold != null && (
                        <span> (quota {planQ.data.effectivePlan.quotaProgress.threshold})</span>
                      )}
                      {/* GROUP F3 — DISPLAY-only quota enforcement mode (report|warn). */}
                      <span data-testid="quota-enforcement-mode" className="text-[var(--cv-color-text-faint)]">
                        {" · "}{quotaEnforcementLabel(planQ.data.effectivePlan.quotaProgress.enforcement)}
                      </span>
                    </div>
                    <div className="text-3xl font-bold" data-testid="kpi-quota-registered">
                      {planQ.data.effectivePlan.quotaProgress.registeredThisPeriod}
                      {planQ.data.effectivePlan.quotaProgress.threshold != null && (
                        <span className="text-base text-[var(--cv-color-text-faint)]"> / {planQ.data.effectivePlan.quotaProgress.threshold}</span>
                      )}
                    </div>
                    {planQ.data.effectivePlan.quotaProgress.threshold != null &&
                      planQ.data.effectivePlan.quotaProgress.met && (
                        <div className="text-xs mt-1 text-amber-600" data-testid="quota-met-warning">
                          Monthly quota reached (report-only — no change to price or access).
                        </div>
                      )}
                  </div>
                  <div data-testid="plan-price">
                    {/* WAVE 7B FE-14 (DEF-060) — the price below has always been
                        DB-driven (partnerEffectivePlan resolves a partner
                        override, else the tier's advertised platform_fees row);
                        the WAVE 7 citation check confirmed that and found the
                        residual defect to be this LABEL. It read "Your
                        subscription" for every partner, including Path-1
                        partners who hold no subscription at all — a false
                        statement about money. The number is unchanged; only the
                        heading now tells the truth about what it is. */}
                    {/* The heading is written as TWO literal branches rather than
                        one interpolated string on purpose. The silent-drop guard
                        fingerprints copy by the TEXT of the node, so collapsing
                        this into {cond ? "Your subscription" : …} reads as a
                        REMOVED copy string and blocks the build — it did, on the
                        first run of this change. Wave 7 §3.4 precedent: restore
                        the expression byte-for-byte instead of allow-listing.
                        The literal below is unchanged from the original line. */}
                    {planQ.data.subscriptionState === "unsubscribed" ? (
                      <div className="text-xs text-[var(--cv-color-text-muted)] mb-1" data-testid="plan-price-label-advertised">
                        Tier price (no active subscription)
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">Your subscription</div>
                    )}
                    <div className="text-xl font-semibold" data-testid="kpi-plan-price">
                      {planPrice.figure}{" "}
                      <span className="text-[var(--cv-color-text-faint)] text-xs" data-testid="kpi-plan-price-period">{planPrice.periodText}</span>
                    </div>
                    {planQ.data.effectivePlan.effectivePrice.source === "partner_override" && (
                      <div className="text-xs mt-1 text-emerald-600" data-testid="price-custom-badge">Custom partner price</div>
                    )}
                    {/* FE-14 — say plainly that nothing is being billed, rather
                        than leaving a price on screen that implies it is. */}
                    {planQ.data.subscriptionState === "unsubscribed" && (
                      <div className="text-xs mt-1 text-[var(--cv-color-text-faint)]" data-testid="plan-price-not-billed">
                        You are not currently billed a subscription. This is the advertised price for your tier.
                      </div>
                    )}
                  </div>
                  <div data-testid="plan-revshare">
                    <div className="text-xs text-[var(--cv-color-text-muted)] mb-1">Rev-share</div>
                    {planQ.data.effectivePlan.arrangement?.revShare?.enabled ? (
                      <div className="text-xl font-semibold" data-testid="kpi-revshare">
                        {formatMinor(
                          planQ.data.effectivePlan.arrangement.revShare.fixedAmountMinor ?? 0,
                          planQ.data.effectivePlan.arrangement.revShare.currency ?? "USD",
                          { locale: "en-US" },
                        )}{" "}
                        <span className="text-[var(--cv-color-text-faint)] text-xs">per paying company</span>
                      </div>
                    ) : (
                      <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="revshare-disabled">Not enabled</div>
                    )}
                  </div>
                </div>
              </AppCard>
            )}
            {/* ═══════════════════════════════════════════════════════════
                WAVE 69 · V-4 (R58 row 4) — A MISSING CARD NOW EXPLAINS ITSELF.
                ═══════════════════════════════════════════════════════════
                `effectivePlanError` is non-null in EXACTLY the case `effectivePlan`
                is null — so the `&&` above evaluated false and the whole "Plan &
                quota" card VANISHED, with no explanation anywhere on the page. That
                is the cleanest silent-drop-by-omission in the tree.

                NOTHING IS FABRICATED HERE. `commissionPct` is `null` in this state
                (`server/partnerRoutes.ts:793-794`) and is deliberately NOT rendered:
                printing a `0%` commission would be a false statement about money,
                which is the whole reason Wave 56 exists. No `?? 0`, no substituted
                rate, no invented price. The message is the server's own.

                APPENDED after `card-plan` and BEFORE `card-recent`, both of which
                carry literal testids, so no sibling identity moves. */}
            {!planQ.data?.effectivePlan && planQ.data?.effectivePlanError && (
              <AppCard data-testid="card-plan-unavailable" data-cv-dash-group="capital">
                <DashGroupLabel group="capital" cardKey="plan-unavailable" />
                <div className="cv-card-title text-sm font-semibold mb-2">Plan &amp; quota unavailable</div>
                <p className="text-sm text-amber-900" role="alert" data-testid="plan-unavailable-reason">
                  {planQ.data.effectivePlanError.message}
                </p>
                <p className="text-xs text-[var(--cv-color-text-muted)] mt-2" data-testid="plan-unavailable-tier">
                  Tier on file: {planTierLabel(planQ.data.effectivePlanError.tier)}
                </p>
              </AppCard>
            )}
            <AppCard data-testid="card-recent" data-cv-dash-group="work">
              <DashGroupLabel group="work" cardKey="recent" />
              <div className="cv-card-title text-sm font-semibold mb-3">Recent activity</div>
              <div>
                {data.recentActivity.length === 0 && <div className="text-xs text-[var(--cv-color-text-muted)]">No activity yet.</div>}
                <ul className="text-xs space-y-2">
                  {data.recentActivity.map((a) => (
                    <li key={a.id} className="border-b pb-1">
                      {/* WAVE 106 - FINDING 4.5: this printed the raw event code
                          (`stage_change`) as the row's primary text. Same rows,
                          same order, human wording. */}
                      <span className="text-[var(--cv-color-text-muted)] mr-2">{activityTypeLabel(a.activityType)}</span>
                      <span>{a.body}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </AppCard>
          </div>
        </div>
      )}
    </PartnerShell>
  );
}
