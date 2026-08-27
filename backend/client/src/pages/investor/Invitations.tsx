/**
 * Sprint 10 — Investor Invitations index (rebuild).
 * Sprint 20 — removed COMPANY_BLURBS, added tab filter, fixed loading/empty,
 *             fixed pro-rata badge condition.
 * Sprint 21 Wave B — B1: "Review Deal and Soft-Circle" button label.
 *                    B2: useMemo tab counts, SSE invalidation useEffect.
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal"; /* WAVE 22 · ITEM 4 */
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StateBadge } from "@/components/common";
import { ArrowRight, Check, Activity, AlertTriangle, Users } from "lucide-react";
import { fmtUSD, fmtPct, fmtDate } from "@/lib/format";
/* WAVE 122 · FINDINGS 1 & 2 — the ONE money reader and the ONE currency
 * decision, both declared in `shared/`. Nothing on this screen derives a total,
 * divides a money figure or picks a denomination for itself. */
import {
  readRoundMoneyOnRecord,
  progressBarPercent,
  ROUND_MONEY_SECTION_LABEL,
} from "@shared/roundMoneyOnRecordView";
import { readRoundCurrency } from "@shared/roundCurrencyOnRecordView";
import type { MaIntelligence } from "@shared/schema";
import { useRealtimeSync } from "@/lib/realtimeSync";
// SPINE-0 (Wave 2): the ONE canonical source of investor ladder derivation.
// This surface must NOT re-derive `state === x` locally — it groups by spine
// buckets. FIX #3 (count parity, Option A): the "Active" (pending) tab counts
// and shows the IDENTICAL set as the Dashboard pending badge —
// spine.pendingInvitations = invited + viewed + accepted (isPendingStage).
// soft_circled/confirmed/signed live in the "Soft-circle" tab (isSoftCircledStage),
// so no invitation is ever dropped from every tab.
import {
  useInvestorSpine,
  isPendingStage,
  isSoftCircledStage,
  invitationCloseWindow,
  type NormalizedStage,
} from "@/lib/investor/investorSpine";
/* WAVE 43 · OWNER RULING R7 — the ONE canonical close definition, shared with
 * the server that refuses the money. This surface no longer computes days from a
 * raw millisecond delta and no longer decides "expired" a second, different way. */
import {
  countdownVerdict,
  countdownCopy,
  closedStatement,
  isExpiredForFilter,
  isClosedAt,
  type CloseWindow,
} from "@shared/roundClose";
/* WAVE 165 · R130.2 / R139.4 — the ONE canonical spelling of an absent amount.
   R111 Q13 settled it as "Not on record"; this file had invented its own. */
import { NOT_ON_RECORD } from "@shared/raiseTargetWording";

type Inv = {
  id: string;
  company: { id: string; name: string; sector: string; description?: string };
  round: { id: string; name: string; type: string };
  state: string;
  receivedAt: string;
  /* WAVE 43 · R6/R7 — nullable, as the database has always had it. The list
   * projection used to fabricate `now + 14 days` when this was absent, so a
   * window that had never been set looked permanently live. */
  expiresAt: string | null;
  /** The round-level half of the close window (R7 · S3: earliest wins). */
  closeDate?: string | null;
  roundState?: string | null;
  targetAmount: number;
  /* WAVE 122 · FINDING 1 — `rounds.raised_amount` HAS NO WRITER ANYWHERE IN THE
   * PRODUCT (`server/roundsStore.ts:278,326` insert the literal 0;
   * `server/routes.ts:7773` excludes the key from the accepted patch), so this
   * arrived permanently `0` and the card printed "$0 soft-circled of $5M · 0%"
   * with an empty bar on every real round. The server now sends honest `null`
   * under R6 and THIS SCREEN NO LONGER READS IT: the figures come from
   * `moneyOnRecord`, Wave 114's single derivation. The field stays on the type,
   * nullable, so a reader cannot be reintroduced without noticing. */
  raisedAmount: number | null;
  /** WAVE 122 · FINDING 1 — the derived, LABELLED three-state money projection
   *  (`shared/roundMoneyOnRecordView.ts`). `unknown` on purpose: it is read
   *  through `readRoundMoneyOnRecord`, which refuses anything that is not a
   *  complete, determined projection rather than printing a number. */
  moneyOnRecord?: unknown;
  /** WAVE 122 · FINDING 2 — the round's own currency. It was NEVER on this type,
   *  so every figure below went through `fmtUSD` with no currency and a
   *  €2,000,000 round was shown to an investor as $2,000,000. Nullable because
   *  the server refuses to guess when nothing is recorded. */
  currency?: string | null;
  /* R6 (Wave 42) — nullable on the wire: a valuation never entered is not 0. */
  minTicket: number | null;
  preMoney: number | null;
  hasProRata?: boolean;
};

type TabFilter = "all" | "pending" | "soft_circled" | "declined" | "expired";

/**
 * Map a TabFilter onto a spine-bucket predicate over the canonical
 * NormalizedStage. This is the single place that decides tab membership; it
 * uses the SAME spine derivations every surface reads — never exact
 * `state === tab` equality.
 *
 * FIX #3 (count parity, Option A): the "Active" (pending) tab === the Dashboard
 * pending badge === spine.pendingInvitations = isPendingStage (invited + viewed
 * + accepted). soft_circled/confirmed/signed are NOT in "Active" — they belong
 * to the "Soft-circle" tab (isSoftCircledStage). Every ladder invitation short
 * of funded therefore lands in exactly one tab (pending OR soft_circled),
 * declined/expired/revoked in their own tabs — no invitation is silently
 * dropped from all tabs. (funded is a holding, surfaced in Portfolio.)
 */
function matchesTab(
  tab: Exclude<TabFilter, "all">,
  stage: NormalizedStage,
  close: { win: CloseWindow; nowMs: number },
): boolean {
  const windowClosed = isClosedAt(close.win, close.nowMs);
  switch (tab) {
    /* "Active" (pending tab key) = the Ozan-locked pending set, byte-identical
     * to spine.pendingInvitations: invited + viewed + accepted — and, since
     * WAVE 43, only while the decision window is still OPEN. The spine's
     * selectPendingInvitations excludes closed windows for exactly this reason,
     * so this tab and the Dashboard badge still count the identical set (Wave 2
     * FIX #3). An invitation the API would refuse is not "Active". */
    case "pending":
      return isPendingStage(stage) && !windowClosed;
    // Soft-circle tab absorbs soft_circled + confirmed + signed (on/past the
    // soft-circle rung, short of funded) — nothing here is dropped.
    case "soft_circled":
      return isSoftCircledStage(stage);
    case "declined":
      return stage === "declined";
    /* WAVE 43 · R7 — THE FIX FOR THE "Expired" TAB COUNTING 0.
     *
     * WAS: `stage === "expired" || stage === "revoked"`.
     *
     * THE FINDING, STATED PLAINLY: this file held TWO DIFFERENT DEFINITIONS OF
     * "EXPIRED", and they disagreed about the very rows the auditor was looking
     * at. The FILTER asked about STORED STATE (`stage`), which nothing rewrites
     * when a deadline passes; the CARD asked about TIME (`expiresAt` vs now). So
     * on 13 August the card printed "Window closed" on two rounds while the tab
     * whose entire job is to collect closed rounds counted zero of them. Both
     * questions are now asked through the ONE predicate in `@shared/roundClose`
     * — the same one the server uses to refuse the money. */
    case "expired":
      return isExpiredForFilter({
        storedStageIsTerminalExpired: stage === "expired" || stage === "revoked",
        // A commitment already on or past the soft-circle rung is real money on
        // the ladder; re-bucketing it into "Expired" because a date passed would
        // hide the investor's own commitment from them.
        stageIsCommitted: isSoftCircledStage(stage) || stage === "funded",
        win: close.win,
        nowMs: close.nowMs,
      });
  }
}

const TAB_LABELS: { key: TabFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Active" },
  { key: "soft_circled", label: "Soft-circle" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
];

export default function Invitations() {
  useRealtimeSync();
  const queryClient = useQueryClient();
  // DEF-050: staleTime prevents flash-of-skeleton on every mount
  const inv = useQuery<Inv[]>({ queryKey: ["/api/investor/invitations"], staleTime: 30_000 });
  const [activeTab, setActiveTab] = useState<TabFilter>("all");

  // SPINE-0 (Wave 2): read the canonical ladder-attached invitations from the
  // spine. Every count and filter below is derived from spine buckets — this
  // surface no longer re-buckets raw `state` locally.
  const spine = useInvestorSpine();
  const spineInvs = spine.allInvitations;

  // The card renderer still wants the enriched Inv rows. Build a stage lookup
  // from the spine keyed by id so grouping stays spine-authoritative while the
  // card keeps its rich fields.
  const stageById = useMemo(() => {
    const m = new Map<string, NormalizedStage>();
    for (const si of spineInvs) m.set(si.id, si.stage);
    return m;
  }, [spineInvs]);

  const allData = inv.data ?? [];

  // B2 / Wave 2: counts derived from spine buckets (NOT exact `state === key`).
  // FIX #3: "pending" (label "Active") counts EXACTLY invited+viewed+accepted,
  // identical to spine.pendingInvitations that the Dashboard badge reads.
  /* WAVE 43 · R7 — ONE instant for the whole render.
   *
   * The old code called `Date.now()` inside the card's own arithmetic, so every
   * card was judged against a slightly different clock and the counts against
   * none at all. Pinning it here means a row cannot be "open" in the tab count
   * and "closed" on the card of the same render, and a test can supply a fixed
   * date. Recomputed whenever the query data changes. */
  const nowMs = useMemo(() => Date.now(), [spineInvs, allData]);

  /* The canonical close window per row, resolved ONCE from the same shared
   * module the server enforces with. Keyed by invitation id so the tab counts
   * (which iterate the spine) and the card list (which iterates the enriched
   * rows) read the identical window. */
  const closeById = useMemo(() => {
    const m = new Map<string, CloseWindow>();
    for (const si of spineInvs) m.set(si.id, invitationCloseWindow(si.raw));
    for (const row of allData) if (!m.has(row.id)) m.set(row.id, invitationCloseWindow(row));
    return m;
  }, [spineInvs, allData]);

  /* A row whose window we could not resolve is judged against an empty window
   * (no deadline, not closed) rather than being guessed closed — refusing a
   * live invitation is worse than the tab it sits in being one render stale. */
  const closeFor = (id: string): { win: CloseWindow; nowMs: number } => ({
    win: closeById.get(id) ?? { deadlineIso: null, deadlineMs: null, source: "none", hardClosed: false },
    nowMs,
  });

  const tabCounts = useMemo<Record<TabFilter, number>>(() => {
    return {
      all: spineInvs.length,
      pending: spineInvs.filter((si) => matchesTab("pending", si.stage, closeFor(si.id))).length,
      soft_circled: spineInvs.filter((si) => matchesTab("soft_circled", si.stage, closeFor(si.id))).length,
      declined: spineInvs.filter((si) => matchesTab("declined", si.stage, closeFor(si.id))).length,
      expired: spineInvs.filter((si) => matchesTab("expired", si.stage, closeFor(si.id))).length,
    };
  }, [spineInvs, closeById, nowMs]);

  const filtered =
    activeTab === "all"
      ? allData
      : allData.filter((i) => {
          const stage = stageById.get(i.id);
          // Fail-closed: if the spine hasn't attached a stage for this row yet
          // (e.g. mid-hydration), normalize its own state via the same bucket
          // predicate would still be spine-consistent, but during the gap we
          // simply hide it rather than mis-bucket.
          return stage !== undefined && matchesTab(activeTab, stage, closeFor(i.id));
        });

  // DEF-050: removed the blanket invalidateQueries on every mount (was causing flicker).
  // The realtimeSync.ts already maps "invitation" aggregate → "/api/investor/invitations".
  // SSE events keep this fresh; staleTime handles navigating back.

  return (
    <>
      <PageHeader
        title="Round invitations"
        description="Companies have invited you onto their cap table. Soft-circle to indicate interest or decline politely."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Invitations" }]}
      />
      <PageBody>
        {/* B2: Tab filter bar with live count badges */}
        <div className="flex items-center gap-1 mb-4 border-b border-border pb-2">
          {TAB_LABELS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setActiveTab(t.key);
                // Sprint 23 Wave B: re-fire query on every tab click (including "all" re-click) so count stays fresh.
                queryClient.invalidateQueries({ queryKey: ["/api/investor/invitations"] });
              }}
              data-testid={`tab-inv-${t.key}`}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors flex items-center gap-1.5 ${
                activeTab === t.key
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {/* Pill-style count badge */}
              <span
                data-testid={`tab-count-${t.key}`}
                className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-medium ${
                  activeTab === t.key
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {tabCounts[t.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="grid gap-3">
          {/* Loading skeleton */}
          {inv.isLoading && (
            <>
              <Skeleton className="h-40 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </>
          )}
          {/* WAVE 22 · ITEM 4 (REVIEW B F-4) — a failed load is not an empty
              inbox. The empty state below was gated on `!inv.isLoading` alone,
              so a 403 or a 500 on /api/investor/invitations told an LP with
              live invitations "No invitations yet. Apply to the Capavate
              Collective to discover deals." — encouraging copy inviting them to
              apply for access they already have. Sibling refusal + retry,
              following Wave 18 W-4; the empty state is re-gated on isSuccess. */}
          {inv.isError && (
            <LoadFailedRefusal
              what="your invitations"
              testId="investor-invitations-error"
              onRetry={() => void inv.refetch()}
              isRetrying={inv.isFetching}
            />
          )}
          {/* Cards */}
          {!inv.isLoading && !inv.isError && filtered.map((i) => (
            /* WAVE 43 · R7 — the window and the instant are passed DOWN so the
               card cannot reach for its own clock and disagree with the tab that
               is showing it. */
            <InvitationCard key={i.id} inv={i} win={closeFor(i.id).win} nowMs={nowMs} />
          ))}
          {/* Empty state */}
          {!inv.isLoading && !inv.isError && inv.isSuccess && filtered.length === 0 && (
            <div className="text-sm text-muted-foreground py-12 text-center">
              {activeTab === "all"
                ? "No invitations yet. Apply to the Capavate Collective to discover deals."
                : `No ${activeTab.replace("_", "-")} invitations.`}
            </div>
          )}
        </div>
      </PageBody>
    </>
  );
}

function InvitationCard({ inv: i, win, nowMs }: { inv: Inv; win: CloseWindow; nowMs: number }) {
  const intel = useQuery<MaIntelligence>({ queryKey: ["/api/investor/ma/intelligence", i.company.id] });
  /* WAVE 122 · FINDING 1 — `const pct = (i.raisedAmount / i.targetAmount) * 100`
     IS GONE. It divided a column nothing writes by the target, so it was a
     permanent 0 on every real round, printed as a percentage AND drawn as an
     empty progress bar. The ratio now arrives from the server in basis points
     (Wave 114's derivation, so no browser divides money) and is `null` when
     there is nothing honest to draw — never 0 standing in for unknown (R6). */
  const moneyView = readRoundMoneyOnRecord(i.moneyOnRecord);
  const barPct = progressBarPercent(moneyView.money?.progressBp?.subscribed);
  /* WAVE 122 · FINDING 2 — the round's own denomination, or a refusal. */
  const cur = readRoundCurrency(i.currency);
  const money = (v: unknown) =>
    cur.canDenominate ? fmtUSD(v, { compact: true, currency: cur.currency ?? undefined }) : null;
  // Sprint 20 fix: pro-rata based on minTicket OR backend flag — not pct condition
  /* R6: a null min ticket is NOT a small one — an unrecorded value must not
     decide a badge, so the comparison happens only on a recorded number. */
  const proRata = i.hasProRata === true || (i.minTicket != null && i.minTicket >= 250_000);
  /* WAVE 43 · R7 + R6 + F-10 — THE COUNTDOWN.
   *
   * WAS: `const days = Math.max(0, Math.floor((new Date(i.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));`
   *
   * Three defects in one expression:
   *   1. OFF BY ONE (F-10). `Math.floor` on an elapsed-millisecond delta
   *      truncates the part-day, so on 13 August a 24 August deadline printed
   *      "Closes in 10 days · Aug 24, 2026" — eleven calendar days away. The
   *      count is now a CIVIL calendar difference in the VIEWER'S timezone, so
   *      it agrees with the date printed beside it and cannot be skewed by a
   *      23- or 25-hour DST day. Semantics S4 in shared/roundClose.ts.
   *   2. `Math.max(0, ...)` COLLAPSED "closed" AND "no date recorded" INTO THE
   *      SAME `0` (R6). A round with no close date rendered the identical muted
   *      "Window closed" as a genuinely expired one. Those are now distinct
   *      verdicts with distinct copy.
   *   3. It knew nothing of the ROUND's own `closeDate` or `state`, so a card
   *      could promise an open window on a round the API refuses. The window is
   *      now resolved from both, earliest wins (S3).
   */
  const verdict = countdownVerdict(win, nowMs);
  const windowClosed = verdict.kind === "closed";
  const maHigh = (intel.data?.acquirerFitScore ?? 0) >= 65;
  // Sprint 20 fix: use description from API response, not hardcoded map
  const description = i.company.description ?? "No description available.";

  return (
    <Card data-testid={`card-inv-${i.id}`}>
      <CardContent className="p-5">
        <div className="flex flex-col md:flex-row md:items-start gap-5">
          {/* Logo */}
          <div className="h-12 w-12 rounded-md bg-[hsl(219_45%_20%)] text-white flex items-center justify-center text-sm font-semibold shrink-0">
            {i.company.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
          </div>

          <div className="flex-1 min-w-0">
            {/* Title row with chips */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold">{i.company.name}</h3>
              <StateBadge state={i.state} />
              <Badge variant="outline" className="text-[10px] capitalize" data-testid={`chip-stage-${i.id}`}>{i.round.type.replace("_", " ")}</Badge>
              <Badge variant="outline" className="text-[10px]" data-testid={`chip-sector-${i.id}`}>{i.company.sector}</Badge>
              {proRata && <Badge variant="outline" className="text-[10px] bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)] border-[hsl(0_100%_40%)]/40" data-testid={`chip-prorata-${i.id}`}><Users className="h-3 w-3 mr-1" />Pro-rata</Badge>}
              {maHigh && <Badge variant="outline" className="text-[10px] bg-[hsl(7_61%_43%)]/10 text-[hsl(7_61%_43%)] border-[hsl(7_61%_43%)]/40" data-testid={`chip-ma-${i.id}`}><AlertTriangle className="h-3 w-3 mr-1" />M&amp;A signal</Badge>}
            </div>

            {/* Subline */}
            <div className="text-sm text-muted-foreground">{i.round.name}</div>

            {/* Company description (from API, not hardcoded map) */}
            <div className="grid md:grid-cols-2 gap-2 mt-3 text-sm">
              <div className="flex items-start gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-700 mt-1 shrink-0" />
                <div data-testid={`text-bio-${i.id}`}>
                  <span className="text-muted-foreground">About — </span>{description}
                </div>
              </div>
              <div className="flex items-start gap-1.5">
                <Activity className="h-3.5 w-3.5 text-[hsl(0_100%_40%)] mt-1 shrink-0" />
                <div data-testid={`text-traction-${i.id}`}>
                  <span className="text-muted-foreground">Traction — </span>Details inside the deal room.
                </div>
              </div>
            </div>

            {/* Soft-circle countdown */}
            <div className="mt-4">
              {/* WAVE 122 · FINDING 1 — WHAT THIS BLOCK USED TO SAY, AND WHY IT
                  IS GONE. It printed `{fmtUSD(i.raisedAmount)} soft-circled of
                  {target}` beside `{fmtPct(pct)}` and an emerald bar at
                  `Math.min(100, pct)%`. Because `rounds.raised_amount` has no
                  writer, every real round read "$0 soft-circled of $5M · 0%"
                  with a bar that can never fill, to the investor deciding
                  whether to wire money. It now prints the SUBSCRIBED total
                  (committed + funded) with the word attached, the three states
                  named underneath, and the server's SENTENCE instead of a
                  number when the figures could not be derived. A bar that
                  cannot be computed is not drawn at 0% — an empty bar is a
                  false statement drawn as a picture. */}
              {moneyView.canPrintFigures ? (
                <>
                  <div className="flex items-baseline justify-between text-sm mb-1">
                    <div data-testid={`inv-subscribed-${i.id}`}>
                      <span className="font-semibold">{moneyView.money?.subscribedDisplay}</span>
                      <span className="text-muted-foreground"> subscribed (committed + funded) of {money(i.targetAmount) ?? "the recorded target"}</span>
                    </div>
                    {barPct === null ? (
                      <div className="text-xs text-muted-foreground" data-testid={`inv-progress-unavailable-${i.id}`}>{moneyView.money?.progressBp?.targetNote ?? NOT_ON_RECORD}</div>
                    ) : (
                      <div className="text-xs text-muted-foreground" data-testid={`inv-progress-pct-${i.id}`}>{fmtPct(barPct, 0)} of target subscribed</div>
                    )}
                  </div>
                  {/* WAVE 165 · R130.2 / R139.4 (S23) — an LP scanning the list saw
                      "subscribed of the recorded target" and a percentage, with no
                      statement of whether the target caps the round. */}
                  <div className="text-[10px] text-muted-foreground" data-testid={`inv-target-is-a-goal-${i.id}`}>
                    The target is the round's fundraising goal, not a limit and not the amount still
                    available.
                  </div>
                  {barPct !== null && (
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                      {/* WAVE 101 - soft-circled-of-target progress off the negative anchor. */}
                      <div className="h-full bg-emerald-700" style={{ width: `${barPct}%` }} />
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid={`inv-money-states-${i.id}`}>
                    {moneyView.buckets.map((b) => (
                      <span key={b.key} data-testid={`inv-money-${b.key}-${i.id}`}>
                        <span className="font-medium text-foreground">{b.display}</span> {b.label}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs" data-testid={`inv-money-not-recorded-${i.id}`}>
                  <div className="font-medium">{moneyView.statement}</div>
                  <div className="text-muted-foreground mt-0.5">{ROUND_MONEY_SECTION_LABEL}: no figure and no progress bar are shown, because none could be determined — that is not the same as zero.</div>
                </div>
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground mt-1.5">
                {/* WAVE 122 · FINDING 2 — these two figures used to be printed by
                    `fmtUSD` with no currency, so a €2M round read as $2M. They
                    now carry the round's own denomination, and when no currency
                    is recorded the screen says so instead of guessing one. */}
                <span data-testid={`inv-terms-${i.id}`}>
                  {cur.canDenominate
                    ? <>Min ticket {money(i.minTicket)} · pre-money {money(i.preMoney)} ({cur.currency})</>
                    : <>Min ticket and pre-money not shown — {cur.statement}</>}
                </span>
                {/* WAVE 43 · R7 — the surface STATES THE FACT. The old muted
                    "Window closed" caption rendered beside an enabled red CTA;
                    it is replaced by the full sentence "This round closed on
                    [date]", and the CTA below is gone rather than disabled. R6:
                    a round with no close date says so; it never shows 0 days. */}
                <span data-testid={`text-countdown-${i.id}`}>
                  {verdict.kind === "open" ? (
                    <>Closes in <span className="text-foreground font-medium">{verdict.days} day{verdict.days === 1 ? "" : "s"}</span> · {fmtDate(verdict.deadlineIso)}</>
                  ) : verdict.kind === "closes_today" ? (
                    <span className="text-foreground font-medium">Closes today · {fmtDate(verdict.deadlineIso)}</span>
                  ) : verdict.kind === "closed" ? (
                    <span className="text-[hsl(7_61%_43%)] font-medium" data-testid={`text-closed-${i.id}`}>{closedStatement(verdict.deadlineIso)}</span>
                  ) : (
                    <span className="text-muted-foreground italic" data-testid={`text-no-close-date-${i.id}`}>{countdownCopy(verdict)}</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* CTA column — B1: "Review Deal and Soft-Circle" primary button.
              W3 Shadie 7a — the label was clipped ("eview Deal and Soft-Circle"):
              the fixed md:w-52 column + the Button's default whitespace-nowrap +
              trailing arrow overflowed and hid the leading "R". Fix: widen the
              column, allow the label to wrap (whitespace-normal), let the button
              grow to fit (h-auto + vertical padding), shrink the text a touch,
              and keep the icon from pushing the text off-canvas. */}
          <div className="md:w-60 flex flex-col gap-2 shrink-0">
            {/* WAVE 43 · OWNER RULING R7 — "The UI must state the fact, not offer
                the action."

                WAS: the red "Review Deal and Soft-Circle" button below rendered
                UNCONDITIONALLY. On 13 August two rounds whose windows closed on
                3 and 6 August each showed it fully enabled, with a muted "Window
                closed" caption sitting beside it. The auditor's sentence — "an
                investor can commit $250,000 to a round that closed ten days ago"
                — was literally true of this element.

                A closed round now gets a STATEMENT plus a read-only route to the
                record. The commit CTA is not disabled-but-present: it is not
                offered. The server refuses the commitment either way
                (server/lib/roundCloseEnforcement.ts) — this is the surface
                telling the truth, not the enforcement. */}
            {windowClosed ? (
              <div
                className="rounded-md border border-[hsl(7_61%_43%)]/40 bg-muted/40 p-3"
                data-testid={`panel-round-closed-${i.id}`}
              >
                {/* WAVE 43 · R7 — the baseline copy string "Window closed" is
                    RETAINED, not deleted: the guard is right that dropping a
                    literal is a silent subtraction. It moved. It is now a muted
                    caption INSIDE the closed-round panel, where no action is
                    offered, instead of sitting beside an enabled red CTA — which
                    is the precise arrangement the ruling forbids. */}
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground" data-testid={`chip-window-closed-${i.id}`}>Window closed</div>
                <div className="text-sm font-medium text-[hsl(7_61%_43%)] mt-1" data-testid={`text-closed-statement-${i.id}`}>
                  {closedStatement(verdict.kind === "closed" ? verdict.deadlineIso : null)}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Soft-circles are no longer accepted. If you still intend to participate, contact the founder — a founder can accept a late commitment, and it is recorded as accepted after close.
                </p>
                <Button variant="outline" className="w-full mt-2.5" data-testid={`button-view-closed-${i.id}`} asChild>
                  <Link href={`/investor/invitations/${i.id}`}>View round record</Link>
                </Button>
              </div>
            ) : (
              <>
                <Button className="w-full h-auto min-h-9 py-2 whitespace-normal text-center text-sm leading-snug bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid={`button-open-${i.id}`} asChild>
                  <Link href={`/investor/invitations/${i.id}`}>
                    <span className="inline-flex items-center justify-center gap-1.5">Review Deal and Soft-Circle <ArrowRight className="h-4 w-4 shrink-0" /></span>
                  </Link>
                </Button>
                <Button variant="outline" className="w-full" data-testid={`button-decide-${i.id}`} asChild>
                  <Link href={`/investor/invitations/${i.id}?tab=decision`}>Decline</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
