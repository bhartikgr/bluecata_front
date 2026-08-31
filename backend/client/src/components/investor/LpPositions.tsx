/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 5 — LP positions in the EXISTING portfolio.
 *
 * Owner ruling: "The LP portal is NOT a separate portal. It is the existing
 * investor portal." So there is no `pages/lp/*` tree and no second login — this
 * is a section of `pages/investor/Portfolio.tsx`, which until now contained
 * ZERO SPV references, meaning an LP's own position was invisible to them.
 *
 * AN LP INTEREST MUST NEVER READ AS A DIRECT HOLDING. They own a slice of a
 * VEHICLE; the vehicle owns the shares in the company. Every card is badged
 * "Vehicle interest (LP)" and says so in words, because a portfolio that shows
 * a vehicle interest next to direct holdings without distinguishing them is how
 * an LP comes to believe they are on a company's cap table.
 *
 * WHAT IS DELIBERATELY ABSENT: any other LP. No register, no co-investor list,
 * no other commitments — the server never sends them (Wave 29 / WAIVER-4), and
 * this component has nothing to render even if a future response carried them.
 *
 * MONEY via `formatMinorOrUnavailable`, never `/100` (JPY has exponent 0).
 * Ownership arrives as a FRACTION and is multiplied by 100 only here, at the
 * render boundary. A figure the server could not derive prints as an explicit
 * refusal with the server's own sentence — never as zero.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
/* WAVE 174 · R142 — the tax document an LP should expect, resolved from the
   jurisdiction ALREADY stored on the vehicle and already carried on this
   payload (`LpPosition.jurisdiction`). No jurisdiction literal lives here. */
import { LpTaxDocumentNote } from "@/components/investor/LpTaxDocumentNote";
import { describeFailure } from "@/lib/failureMessage";

interface LpPosition {
  spvId: string;
  spvName: string;
  jurisdiction: string;
  /* WAVE 189 · ITEM A · R154.3 — the vehicle's optional, GP-stated legal form,
     served by `server/lpPositionsStore.ts`. Optional here so an older payload that
     does not carry it still type-checks and still renders the unresolved hedge. */
  legalForm?: string | null;
  currency: string;
  positionType: "spv_lp_interest";
  commitmentMinor: number;
  calledCapitalMinor: number | null;
  distributionsReceivedMinor: number;
  ownershipFraction: number | null;
  capitalAccountMinor: number | null;
  navTotalMinor: number | null;
  navShareMinor: number | null;
  navAsOfDate: string;
  navBadge: string | null;
  navRefusalCopy: string | null;
  hasSideLetter: boolean;
  refusalCopy: string | null;
}

const BADGE_COPY: Record<string, string> = {
  fresh: "Valued from a priced round inside the freshness window.",
  stale: "The underlying priced round is older than the staleness threshold.",
  expired: "The underlying priced round is older than the expiry threshold. The figure is shown and badged, and should be refreshed.",
  gp_override: "A general partner override is in force for a holding in this vehicle.",
};

function Figure({ label, minor, currency, testid }: { label: string; minor: number | null; currency: string; testid: string }) {
  return (
    <div data-testid={testid}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">
        {minor === null ? (
          <span style={{ color: "#8a5a06" }} data-testid={`${testid}-unavailable`}>Not available</span>
        ) : (
          formatMinorOrUnavailable(minor, currency)
        )}
      </div>
    </div>
  );
}

export function LpPositions() {
  const q = useQuery<{ positions: LpPosition[]; collectiveScope: string }>({
    queryKey: ["/api/investor/me/lp-positions"],
    queryFn: () => apiRequest("GET", "/api/investor/me/lp-positions").then((r) => r.json()),
  });

  /* ─── WAVE 196 · ITEM B2 ─────────────────────────────────────────────────────
   * A FAILED LOAD USED TO LOOK EXACTLY LIKE HOLDING NOTHING.
   *
   * The single line `if (q.isLoading || q.isError) return null;` meant an LP whose
   * positions read had FAILED saw the same blank space as an investor who holds no
   * vehicle interests at all — on the one page where they check what they own.
   * That is the wave-183 defect (a real state rendering as an absence) on the
   * investor portfolio, so it is fixed the same way: split the branches and give
   * the failure its own named block that says what happened.
   *
   * THE LOADING BRANCH AND THE ZERO-POSITION BRANCH ARE LEFT EXACTLY AS THEY WERE,
   * comment included. Rendering nothing for zero positions is the deliberate design
   * recorded in that comment — a direct cap-table investor's portfolio must be
   * unchanged by this capability — and printing "you hold no vehicle interests" to
   * every non-LP investor would be a regression, not a fix. */
  if (q.isLoading) return null;
  if (q.isError) {
    return (
      <div className="mt-6" data-testid="investor-lp-positions-load-failed">
        <div className="text-sm font-medium mb-1">Vehicle interests (LP)</div>
        <div
          className="rounded-md p-3 text-xs leading-relaxed"
          style={{ border: "1px solid rgba(140,20,20,0.28)", background: "rgba(140,20,20,0.05)", color: "#7a1212" }}
          role="alert"
          data-testid="investor-lp-positions-error"
        >
          {describeFailure(
            q.error,
            "read",
            "Your vehicle interests could not be loaded. This is a loading failure, not a statement that you hold none — nothing has been changed, and any interests you hold are still on record. Reload to try again.",
          )}
        </div>
      </div>
    );
  }
  // Nothing at all is rendered for an investor with no LP positions, so a
  // direct cap-table investor's portfolio is unchanged by this capability.
  const positions = q.data?.positions ?? [];
  if (positions.length === 0) return null;

  return (
    <div className="mt-6" data-testid="investor-lp-positions">
      <div className="text-sm font-medium mb-1">Vehicle interests (LP)</div>
      <div className="text-xs mb-3 leading-relaxed text-muted-foreground" data-testid="investor-lp-positions-explainer">
        These are limited partner interests in investment vehicles, not direct holdings in the underlying companies. You
        hold an interest in the vehicle; the vehicle holds the shares. Figures shown are your own — a vehicle's other
        partners are not shown to you, and yours are not shown to them.
      </div>

      {positions.map((p) => (
        <div
          key={p.spvId}
          className="rounded-md p-3 mb-3"
          style={{ border: "1px solid rgba(4,30,65,0.18)" }}
          data-testid="investor-lp-position-card"
        >
          <div className="flex items-baseline gap-3 flex-wrap mb-2">
            <span className="font-medium text-sm" data-testid="investor-lp-position-name">{p.spvName}</span>
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
              style={{ background: "rgba(4,30,65,0.10)", color: "#041e41" }}
              data-testid="investor-lp-position-type-badge"
            >
              Vehicle interest (LP)
            </span>
            {p.jurisdiction && (
              <span className="text-xs text-muted-foreground">{p.jurisdiction}</span>
            )}
            {p.navBadge && (
              <span
                className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={
                  p.navBadge === "fresh"
                    ? { background: "rgba(16,122,87,0.12)", color: "#0b6b4f" }
                    : { background: "rgba(180,120,10,0.14)", color: "#8a5a06" }
                }
                title={BADGE_COPY[p.navBadge] ?? p.navBadge}
                data-testid={`investor-lp-nav-badge-${p.navBadge}`}
              >
                {p.navBadge === "fresh" ? "Fresh mark" : p.navBadge === "stale" ? "Stale mark" : p.navBadge === "expired" ? "Expired mark" : "GP override"}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Figure label="Your commitment" minor={p.commitmentMinor} currency={p.currency} testid="investor-lp-commitment" />
            <Figure label="Called capital" minor={p.calledCapitalMinor} currency={p.currency} testid="investor-lp-called" />
            <Figure label="Distributions received" minor={p.distributionsReceivedMinor} currency={p.currency} testid="investor-lp-distributions" />
            <Figure label="Capital account" minor={p.capitalAccountMinor} currency={p.currency} testid="investor-lp-capital-account" />
            <Figure label="Your share of vehicle NAV" minor={p.navShareMinor} currency={p.currency} testid="investor-lp-nav-share" />
            <div data-testid="investor-lp-ownership">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Your share of the vehicle</div>
              <div className="text-sm font-semibold">
                {p.ownershipFraction === null ? (
                  <span style={{ color: "#8a5a06" }}>Not available</span>
                ) : (
                  `${(p.ownershipFraction * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`
                )}
              </div>
            </div>
          </div>

          {p.navAsOfDate && (
            <div className="text-[11px] mt-2 text-muted-foreground" data-testid="investor-lp-nav-asof">
              Vehicle net asset value {formatMinorOrUnavailable(p.navTotalMinor, p.currency)} as of {p.navAsOfDate}.
            </div>
          )}
          {/* ═══════════════════════════════════════════════════════════════════
              WAVE 191 · ITEM D — THE FUNDING CURRENCY, STATED IN WORDS.
              ═══════════════════════════════════════════════════════════════════
              Every figure in this block is already formatted with `p.currency`, so
              the vehicle's denomination is on this screen — as a GLYPH. "$" is not
              an instruction: it is shared by the US, Canadian, Singapore, Hong Kong
              and Australian dollar, and an LP reading it cannot tell which of them
              to wire. Because Capavate never converts (R156.1), a transfer in the
              wrong currency is not a shortfall to be topped up — it is an amount the
              vehicle cannot record at all. So the code is named explicitly, once,
              beside the numbers it governs.

              DERIVED FROM THE RECORD, NEVER NAMED IN THIS FILE, and not printed at
              all when the record holds no currency. Appended as a static sibling;
              nothing above is reworded (R143.1). */}
          {/^[A-Z]{3}$/.test(p.currency ?? "") && (
            <div className="text-[11px] mt-2 text-muted-foreground" data-testid="investor-lp-funding-currency">
              This vehicle is denominated in {p.currency}. Every figure above is {p.currency}, and capital calls must be funded in {p.currency}. Capavate does not convert between currencies, so funds delivered in another currency cannot be applied to your capital account.
            </div>
          )}
          {p.hasSideLetter && (
            <div className="text-[11px] mt-1 text-muted-foreground" data-testid="investor-lp-side-letter">
              A side letter applies to your interest in this vehicle. Its terms are shown in your documents.
            </div>
          )}
          {p.refusalCopy && (
            <div className="text-[11px] mt-2 leading-relaxed" style={{ color: "#8a5a06" }} data-testid="investor-lp-refusal">
              {p.refusalCopy}
            </div>
          )}

          {/* WAVE 189 · ITEM A · R154.3 — `legalForm` now passed. Wave 179 wired the
              optional legal-form field into the GP surface only, so on a
              form-dependent jurisdiction the GP saw the conditional RESOLVED while
              the LP saw the hedge for the same vehicle. `null`/absent — the case for
              every vehicle whose GP has not stated a form — renders exactly what it
              rendered before this wave. */}
          <LpTaxDocumentNote jurisdiction={p.jurisdiction} legalForm={p.legalForm ?? null} />
        </div>
      ))}
    </div>
  );
}
