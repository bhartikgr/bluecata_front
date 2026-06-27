/**
 * v25.42 W1 — Hero card.
 * Reads /api/auth/me. Shows "Welcome back, <name>" + active chapter +
 * membership status badge. Loading / error / empty states handled.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles } from "lucide-react";
import { useMe, meDisplayName } from "./useMe";
import { useActiveChapter } from "./useActiveChapter";

function statusBadgeClass(status?: string | null) {
  if (status === "active") return "bg-emerald-100 text-emerald-700";
  if (status === "pending") return "bg-amber-100 text-amber-700";
  if (status === "expired" || status === "cancelled") return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
}

export function HeroCard() {
  const { data, isLoading, error } = useMe();
  const { activeChapter, isLoading: chLoading } = useActiveChapter();

  return (
    <Card data-testid="widget-hero" className="border-[#cc0001]/20">
      <CardContent className="py-6">
        {isLoading ? (
          <div className="space-y-2" data-testid="widget-hero-loading">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : error ? (
          <div className="text-sm text-red-700" data-testid="widget-hero-error">
            Couldn't load your profile. Please refresh.
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4" data-testid="widget-hero-content">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-[#cc0001]" />
                <h2 className="text-xl font-semibold" style={{ color: "#1A1A2E" }}>
                  Welcome back, {meDisplayName(data)}
                </h2>
              </div>
              <p className="text-sm text-slate-500 mt-1" data-testid="widget-hero-chapter">
                {chLoading
                  ? "Loading your chapter…"
                  : activeChapter
                    ? `Active chapter: ${activeChapter.name ?? activeChapter.id}`
                    : "No active chapter yet."}
              </p>
            </div>
            <Badge
              className={`text-xs px-2 py-1 ${statusBadgeClass(data?.collective?.status)}`}
              data-testid="widget-hero-status"
            >
              {data?.collective?.status ?? "none"}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
