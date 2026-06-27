/**
 * v25.42 W2 — Membership badges strip.
 * From /api/auth/me. Shows badges for: in_good_standing, dsc_committee,
 * admin, founder, fund_admin — ONLY the badges that apply.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe, deriveBadges, type BadgeKey } from "./useMe";

const BADGE_LABELS: Record<BadgeKey, string> = {
  in_good_standing: "In Good Standing",
  dsc_committee: "DSC Committee",
  admin: "Admin",
  founder: "Founder",
  fund_admin: "Fund Admin",
};

const BADGE_CLASS: Record<BadgeKey, string> = {
  in_good_standing: "bg-emerald-100 text-emerald-700",
  dsc_committee: "bg-indigo-100 text-indigo-700",
  admin: "bg-[#cc0001]/15 text-[#cc0001]",
  founder: "bg-amber-100 text-amber-700",
  fund_admin: "bg-sky-100 text-sky-700",
};

export function MembershipBadgesStrip() {
  const { data, isLoading, error } = useMe();
  const badges = deriveBadges(data);

  return (
    <Card data-testid="widget-badges">
      <CardContent className="py-4">
        {isLoading ? (
          <div className="flex gap-2" data-testid="widget-badges-loading">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-24" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="widget-badges-error">
            Couldn't load your badges.
          </div>
        ) : badges.length === 0 ? (
          <div className="text-sm text-slate-500" data-testid="widget-badges-empty">
            No membership badges yet.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2" data-testid="widget-badges-list">
            {badges.map((b) => (
              <Badge
                key={b}
                className={`text-xs px-2 py-1 ${BADGE_CLASS[b]}`}
                data-testid={`widget-badge-${b}`}
              >
                {BADGE_LABELS[b]}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
