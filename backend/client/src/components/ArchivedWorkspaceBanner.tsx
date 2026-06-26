/**
 * v25.45 F20c — Archived-workspace banner.
 *
 * Renders a prominent brand-red banner above founder page content whenever the
 * active company's archive_status === 'archived'. Copy uses F20g Option 3:
 *   "Workspace archived on {date}. Reactivate to resume editing — anytime
 *    before {retention_end_date}."
 * The Reactivate Workspace button routes to /founder/subscribe?reactivate=1
 * (the self-serve revival flow, F20d/F20h).
 *
 * Read path is DB-driven: GET /api/founder/workspace/archive-status?companyId=…
 * returns the archive state straight from the companies table (no in-memory
 * mock). The banner self-hides when the workspace is active or the status can't
 * be resolved.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Archive } from "lucide-react";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

type ArchiveStatusResponse = {
  ok: boolean;
  archiveStatus?: "active" | "archived" | "permanent_deletion_requested";
  archivedAt?: string | null;
  archiveRetentionUntil?: string | null;
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ArchivedWorkspaceBanner() {
  const companyId = useActiveCompanyId();
  const { data } = useQuery<ArchiveStatusResponse>({
    queryKey: ["/api/founder/workspace/archive-status", companyId],
    queryFn: async () => {
      const r = await fetch(
        `/api/founder/workspace/archive-status?companyId=${encodeURIComponent(companyId)}`,
        { credentials: "include" },
      );
      if (!r.ok) return { ok: false };
      return r.json();
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  if (!data || data.archiveStatus !== "archived") return null;

  return (
    <div
      className="bg-[#cc0001] text-white px-6 py-3 flex flex-wrap items-center gap-3 justify-between"
      data-testid="banner-archived-workspace"
      role="alert"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Archive className="h-4 w-4 shrink-0" />
        <span className="text-sm font-medium" data-testid="text-archived-banner-copy">
          Workspace archived on {fmtDate(data.archivedAt)}. Reactivate to resume
          editing — anytime before {fmtDate(data.archiveRetentionUntil)}.
        </span>
      </div>
      <Link href="/founder/subscribe?reactivate=1">
        <Button
          size="sm"
          variant="outline"
          className="bg-white text-[#cc0001] hover:bg-white/90 border-white shrink-0"
          data-testid="button-reactivate-workspace"
        >
          Reactivate Workspace
        </Button>
      </Link>
    </div>
  );
}

export default ArchivedWorkspaceBanner;
