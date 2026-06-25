/**
 * v25.42 R5 — /collective/portal/requests
 *
 * Read-only join of the caller's outstanding requests across existing
 * per-user store endpoints (no new endpoint):
 *   - Collective applications     → GET /api/collective/applications/mine
 *   - Membership / seat standing  → GET /api/me/membership
 *   - Invitations addressed to me → GET /api/investor/invitations
 * Each source is queried independently; a 404 / empty source degrades to an
 * empty section (it is not an error). Loading / error / empty states handled.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Inbox, AlertTriangle } from "lucide-react";

interface AppMine {
  application?: { id: string; status?: string; submittedAt?: string };
}
interface Membership {
  status?: string;
  tier?: string;
  role?: string;
}
interface Invitation {
  id: string;
  companyName?: string;
  roundName?: string;
  state?: string;
}

/**
 * v25.42 round-2 (Blocker 2) — only 404 degrades to an empty section. A 404
 * genuinely means "this caller has no rows in this per-store endpoint" and is
 * a legitimate empty state. Every other error (401/403/5xx) is RE-THROWN so
 * `useQuery` surfaces it via `isError` and the render path can show a visible
 * per-section "Couldn't load …" row instead of silently masking a backend
 * failure as an empty state.
 */
function useSafeQuery<T>(key: string, url: string) {
  return useQuery<T | null>({
    queryKey: [url, key],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", url);
        return (await res.json()) as T;
      } catch (err) {
        // Per-store endpoints 404 when the caller has no rows; treat as empty.
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        // Re-throw all other errors (401/403/5xx) so useQuery surfaces them
        // via isError — never silently collapse a failure into an empty state.
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

/** Visible per-section error row (Blocker 2) — replaces a false empty state. */
function SectionError({ source }: { source: string }) {
  return (
    <div
      className="flex items-center gap-2 text-sm text-rose-600"
      data-testid="my-requests-section-error"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>Couldn&rsquo;t load {source}. Please refresh.</span>
    </div>
  );
}

export default function MyRequests() {
  const appQ = useSafeQuery<AppMine>("requests-app", "/api/collective/applications/mine");
  const memQ = useSafeQuery<Membership>("requests-membership", "/api/me/membership");
  const invQ = useSafeQuery<{ invitations?: Invitation[] } | Invitation[]>(
    "requests-invitations",
    "/api/investor/invitations",
  );

  const isLoading = appQ.isLoading || memQ.isLoading || invQ.isLoading;

  const app = appQ.data?.application;
  const membership = memQ.data ?? null;
  const invRaw = invQ.data;
  const invitations: Invitation[] = Array.isArray(invRaw)
    ? invRaw
    : (invRaw?.invitations ?? []);

  // v25.42 round-2 (Blocker 2) — never show the global "No requests yet." empty
  // state when any source failed; those sections render a visible error row.
  const anyError = appQ.isError || memQ.isError || invQ.isError;
  const nothing = !anyError && !app && !membership?.status && invitations.length === 0;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-my-requests">
          My Requests
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your applications, seat standing, and invitations in one place.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3" data-testid="my-requests-loading">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : nothing ? (
        <div className="text-center py-12 text-slate-500" data-testid="my-requests-empty">
          <Inbox className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No requests yet.</p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="my-requests-list">
          <Card data-testid="my-requests-application">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                Collective Application
              </CardTitle>
            </CardHeader>
            <CardContent>
              {appQ.isError ? (
                <SectionError source="your application" />
              ) : app ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Submitted {app.submittedAt ? new Date(app.submittedAt).toLocaleDateString() : ""}</span>
                  <Badge className="text-[10px] bg-amber-100 text-amber-700">{app.status ?? "pending"}</Badge>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No application on file.</p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="my-requests-seat">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                Seat / Membership Standing
              </CardTitle>
            </CardHeader>
            <CardContent>
              {memQ.isError ? (
                <SectionError source="your membership standing" />
              ) : membership?.status ? (
                <div className="flex items-center gap-2">
                  <Badge className="text-[10px] bg-emerald-100 text-emerald-700">{membership.status}</Badge>
                  {membership.tier && <Badge className="text-[10px] bg-slate-100 text-slate-600">{membership.tier}</Badge>}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No membership record.</p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="my-requests-invitations">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                Invitations Addressed to You
              </CardTitle>
            </CardHeader>
            <CardContent>
              {invQ.isError ? (
                <SectionError source="your invitations" />
              ) : invitations.length === 0 ? (
                <p className="text-sm text-slate-400">No pending invitations.</p>
              ) : (
                <div className="space-y-2">
                  {invitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between py-2 px-3 rounded-md bg-slate-50"
                      data-testid={`my-requests-invitation-${inv.id}`}
                    >
                      <span className="text-sm text-slate-700">
                        {inv.companyName ?? "Company"} {inv.roundName ? `· ${inv.roundName}` : ""}
                      </span>
                      <Badge className="text-[10px] bg-sky-100 text-sky-700">{inv.state ?? "invited"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
