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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

  // If zero portfolio companies, redirect to /investor/invitations
  useEffect(() => {
    if (!positions.isLoading && data.length === 0) {
      navigate("/investor/invitations");
    }
  }, [positions.isLoading, data.length, navigate]);

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

  if (data.length === 0) {
    return (
      <Alert className="border-amber-400 bg-amber-50 dark:bg-amber-950/30">
        <AlertDescription className="text-amber-800 dark:text-amber-200">
          You have no portfolio holdings yet. Review pending invitations.
        </AlertDescription>
      </Alert>
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
