/**
 * Sprint 21 Wave C — C1: PortfolioCompanySwitcher
 *
 * Renders a large, bordered company switcher at the top of the Portfolio page.
 * - If 0 companies: redirects to /investor/invitations with banner.
 * - If 1 company: renders a static label.
 * - If 2+ companies: renders a shadcn Select dropdown.
 * - Updates ?company=<id> URL param on selection.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Briefcase } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  useLpVehicleInterests,
  lpOnlyBody,
  LP_ONLY_HEADLINE,
  LP_INTERESTS_UNAVAILABLE_COPY,
} from "@/lib/investor/lpVehicleInterests";

type Position = {
  id: string;
  companyId: string;
  company: string;
  logoColor: string;
};

interface PortfolioCompanySwitcherProps {
  selectedCompanyId: string | null;
  onCompanyChange: (companyId: string) => void;
}

function CompanyThumbnail({
  company,
  logoColor,
  size = "sm",
}: {
  company: string;
  logoColor: string;
  size?: "sm" | "md";
}) {
  const initials = company
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");
  const dim = size === "md" ? "h-9 w-9 text-xs" : "h-7 w-7 text-[10px]";
  return (
    <div
      className={`${dim} rounded flex items-center justify-center font-bold text-white flex-shrink-0`}
      style={{ background: logoColor }}
    >
      {initials}
    </div>
  );
}

export function PortfolioCompanySwitcher({
  selectedCompanyId,
  onCompanyChange,
}: PortfolioCompanySwitcherProps) {
  const [, navigate] = useLocation();

  const positions = useQuery<Position[]>({
    queryKey: ["/api/investor/portfolio2"],
  });

  const data = positions.data ?? [];

  // WAVE 35 · ROW 7 — `positions` counts DIRECT cap-table positions only. An LP
  // who has wired real capital into a vehicle has none of them, and used to be
  // told "Your portfolio is empty" immediately above <LpPositions />, which was
  // at that moment rendering their actual holdings. Same query key as
  // LpPositions, so the two share one cache entry and cannot disagree.
  const lp = useLpVehicleInterests();

  // v25.48.2 Q8 (Ozan) — do NOT bounce an investor with no holdings off the
  // Portfolio page. The previous redirect to /investor/invitations made the
  // Portfolio nav item feel broken (clicking it silently threw you elsewhere).
  // We now render an in-page empty-state with a CTA (below) and stay on route.

  // Sprint 21 hotfix: auto-select the first company on mount so the per-company
  // overview renders immediately instead of showing "Select a portfolio company".
  useEffect(() => {
    if (!positions.isLoading && data.length > 0 && !selectedCompanyId) {
      onCompanyChange(data[0].companyId);
    }
  // DEF-062: removed onCompanyChange from deps to prevent infinite re-render
  // when parent defines onCompanyChange inline without useCallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.isLoading, data.length, selectedCompanyId]);

  if (positions.isLoading) {
    return (
      <div className="flex items-center gap-4 p-4 border-2 border-border rounded-lg bg-background animate-pulse">
        <div className="h-9 w-9 rounded bg-muted" />
        <div className="h-5 w-48 bg-muted rounded" />
      </div>
    );
  }

  // Hold the empty-state until we know whether there are vehicle interests.
  // Rendering "empty" during the LP request and then correcting it is still a
  // moment in which the product lied to the investor.
  if (data.length === 0 && !lp.isResolved) {
    return (
      <div
        className="flex items-center gap-4 p-4 border-2 border-border rounded-lg bg-background animate-pulse"
        data-testid="portfolio-empty-pending-lp"
      >
        <div className="h-9 w-9 rounded bg-muted" />
        <div className="h-5 w-48 bg-muted rounded" />
      </div>
    );
  }

  // No direct positions, but this identity IS a committed LP somewhere. Say
  // what is true instead of what is convenient. The genuinely-empty state below
  // is left byte-for-byte intact for the investor it was written for.
  if (data.length === 0 && (lp.count ?? 0) > 0) {
    return (
      <div
        className="flex flex-col items-center text-center gap-4 p-10 border-2 border-dashed border-border rounded-lg bg-background"
        data-testid="portfolio-lp-only-state"
      >
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Briefcase className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-semibold" data-testid="portfolio-lp-only-headline">
            {LP_ONLY_HEADLINE}
          </h2>
          <p
            className="text-sm text-muted-foreground mt-1 max-w-md"
            data-testid="portfolio-lp-only-body"
          >
            {lpOnlyBody(lp.count ?? 0)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            onClick={() => navigate("/investor/invitations")}
            data-testid="button-lp-only-review-invitations"
          >
            Review invitations
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/investor/earlier-investments")}
            data-testid="button-lp-only-claim-earlier"
          >
            I invested before I had an account
          </Button>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className="flex flex-col items-center text-center gap-4 p-10 border-2 border-dashed border-border rounded-lg bg-background"
        data-testid="portfolio-empty-state"
      >
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Briefcase className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Your portfolio is empty</h2>
          {/* Wave 2 (#8): educational ladder copy — a holding requires
              soft-circling AND the founder marking the investment funded.
              Accepting an invitation alone does NOT create a position. */}
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            You don't hold any positions yet. Once you soft-circle a round and the founder
            marks your investment funded, it will appear here with its updates, marks, and
            analytics.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            onClick={() => navigate("/investor/invitations")}
            data-testid="button-portfolio-review-invitations"
          >
            Review invitations
          </Button>
          {/* WAVE 22 · ITEM 3 (REVIEW B F-1) — inbound link to
              `/investor/earlier-investments` (ClaimPositions). Added as a
              SIBLING button alongside the existing two, never as text spliced
              into an existing node. This is exactly the user the page was
              built for: an LP looking at an empty portfolio who holds a
              position taken before they had an account. Second inbound link:
              investor nav, DEALS section (AppShell.tsx). */}
          <Button
            variant="outline"
            onClick={() => navigate("/investor/earlier-investments")}
            data-testid="button-portfolio-claim-earlier"
          >
            I invested before I had an account
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/investor/dashboard")}
            data-testid="button-portfolio-explore"
          >
            Back to dashboard
          </Button>
        </div>
        {/* Appended as the LAST sibling of the empty-state, never spliced into
            an existing text node: when the LP question could not be answered we
            must not present "empty" as established fact. */}
        {lp.isUnavailable && (
          <p
            className="text-sm mt-1 max-w-md"
            style={{ color: "#8a5a06" }}
            data-testid="portfolio-lp-unavailable"
          >
            {LP_INTERESTS_UNAVAILABLE_COPY}
          </p>
        )}
      </div>
    );
  }

  const activePosition =
    data.find((p) => p.companyId === selectedCompanyId) ?? data[0];

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-2 border-primary rounded-lg bg-background"
      data-testid="portfolio-company-switcher"
    >
      <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
        Viewing portfolio company:
      </span>

      {data.length === 1 ? (
        /* Static label for single company */
        <div className="flex items-center gap-3">
          <CompanyThumbnail
            company={activePosition.company}
            logoColor={activePosition.logoColor}
            size="md"
          />
          <span
            className="text-base font-semibold"
            data-testid="switcher-single-label"
          >
            {activePosition.company}
          </span>
        </div>
      ) : (
        /* Dropdown for multiple companies */
        <Select
          value={selectedCompanyId ?? activePosition.companyId}
          onValueChange={(val) => onCompanyChange(val)}
        >
          <SelectTrigger
            className="h-auto border-2 border-primary bg-background min-w-[260px] max-w-sm"
            data-testid="switcher-select-trigger"
          >
            <SelectValue>
              <div className="flex items-center gap-3 py-1">
                <CompanyThumbnail
                  company={activePosition.company}
                  logoColor={activePosition.logoColor}
                  size="md"
                />
                <span className="text-base font-semibold">
                  {activePosition.company}
                </span>
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {data.map((p) => (
              <SelectItem
                key={p.companyId}
                value={p.companyId}
                data-testid={`switcher-option-${p.companyId}`}
              >
                <div className="flex items-center gap-3 py-1">
                  <CompanyThumbnail
                    company={p.company}
                    logoColor={p.logoColor}
                    size="sm"
                  />
                  <span className="font-medium">{p.company}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
