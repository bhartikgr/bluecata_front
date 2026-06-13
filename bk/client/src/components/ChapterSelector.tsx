/**
 * v17 Phase A — ChapterSelector
 *
 * Dropdown showing the authenticated user's Collective chapter memberships,
 * mounted in the Collective shell topbar. Renders nothing (returns null) when:
 *   - feature flag COLLECTIVE_ENABLED is not "1"  → endpoint replies 503
 *   - the user has zero chapter memberships       → no point showing an empty box
 *   - the /api/me/chapters request is still loading or has errored
 *
 * Storage of the active selection is in-memory only (component state). The
 * brief explicitly forbids web storage for Collective state in Phase A; the
 * server-side `active chapter` switch is reserved for v17 Phase B.
 *
 * Wires to: GET /api/me/chapters (registered in server/routes.ts).
 * Backed by: server/chaptersStore.ts via listChaptersForUser().
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Mirror of the response shape from GET /api/me/chapters.
// Kept inline (rather than imported from server) to avoid coupling the
// client bundle to server-only modules.
interface ChapterMembershipDTO {
  id: string;
  tenantId: string;
  name: string;
  region: string;
  city: string | null;
  status: string;
  membershipId: string;
  membershipRole: string;
  membershipStatus: string;
  joinedAt: string;
}

interface MeChaptersResponse {
  ok: boolean;
  userId?: string;
  chapters?: ChapterMembershipDTO[];
  degraded?: boolean;
  error?: string;
}

interface FeatureFlagsResponse {
  COLLECTIVE_ENABLED?: boolean;
}

export interface ChapterSelectorProps {
  /** Optional callback for parent components that want to observe selection. */
  onChange?: (chapterId: string) => void;
  /** Initial chapter id; defaults to the first membership row. */
  initialChapterId?: string;
  /** Data-testid for end-to-end test hooks. */
  "data-testid"?: string;
}

/**
 * Renders the chapter selector, or null when it should be hidden.
 * Hidden states are intentionally silent — no spinner, no error toast — so
 * the topbar layout is identical to the v16 Friday baseline when the
 * subsystem is off.
 */
export function ChapterSelector(props: ChapterSelectorProps) {
  const { onChange, initialChapterId, "data-testid": testId } = props;

  // 1) Feature flag: hide entirely when COLLECTIVE_ENABLED is off.
  const flagsQ = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: async () => (await apiRequest("GET", "/api/feature-flags")).json(),
  });
  const collectiveOn = flagsQ.data?.COLLECTIVE_ENABLED === true;

  // 2) User's memberships. Enabled only when the flag is on, so we never
  //    fire a request that would 503 every time the topbar mounts.
  const chaptersQ = useQuery<MeChaptersResponse>({
    queryKey: ["/api/me/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/me/chapters")).json(),
    enabled: collectiveOn,
  });

  const chapters: ChapterMembershipDTO[] = chaptersQ.data?.chapters ?? [];

  // 3) Local "active chapter" — component state only (no web storage in
  //    Phase A per V19_BUILD_BRIEF.md Rule 8 / Rule 12).
  const [active, setActive] = useState<string | null>(initialChapterId ?? null);
  useEffect(() => {
    if (active) return;
    if (chapters.length > 0) {
      setActive(chapters[0].id);
    }
  }, [chapters, active]);

  function handleChange(next: string) {
    setActive(next);
    if (onChange) onChange(next);
  }

  // Visibility gates — return null silently so the topbar layout is
  // unaffected when the selector is not applicable.
  if (!collectiveOn) return null;
  if (chaptersQ.isLoading) return null;
  if (chaptersQ.isError) return null;
  if (chapters.length === 0) return null;

  return (
    <Select value={active ?? undefined} onValueChange={handleChange}>
      <SelectTrigger
        className="h-8 min-w-[180px] text-xs border-[#8E2A4E]/30 text-[#1A1A2E]"
        data-testid={testId ?? "chapter-selector-trigger"}
        aria-label="Active chapter"
      >
        <SelectValue placeholder="Select chapter…" />
      </SelectTrigger>
      <SelectContent>
        {chapters.map((c) => (
          <SelectItem
            key={c.id}
            value={c.id}
            data-testid={`chapter-selector-item-${c.id}`}
          >
            <span className="text-xs">
              {c.name}
              {c.city ? (
                <span className="text-slate-500"> · {c.city}</span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default ChapterSelector;
