/**
 * Sprint 16 C4 — Messages 3-tab reorganisation.
 *
 * Tabs:
 *   1. Cap-Table Community  (Tier 1: co-investor groups)
 *   2. Soft-Circle Community (Tier 2: peer share + IOI Pulse)
 *   3. Cross-Cohort         (Tier 3: cross-cohort DM, endorsements, Q&A, diligence)
 *
 * Pulls from /api/comms/channels-tiered?view=tabbed.
 * Sandbox-safe (no storage).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useActiveCompany } from "@/lib/useActiveCompany";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users2, Heart, Network } from "lucide-react";

interface TabbedView {
  capTableCommunity: Array<{ id: string; companyId?: string; tier: 1; badge: string }>;
  softCircleCommunity: Array<{ id: string; roundId?: string; tier: 2; badge: string }>;
  crossCohort: Array<{ id: string; roundId?: string; tier: 3; badge: string; status?: string }>;
}

export function CommsTiersTabs({ userId }: { userId: string }) {
  const [tab, setTab] = useState<"cap_table" | "soft_circle" | "cross_cohort">("cap_table");
  const q = useQuery<TabbedView>({
    queryKey: ["/api/comms/channels-tiered", "tabbed", userId],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/comms/channels-tiered?view=tabbed&userId=${encodeURIComponent(userId)}`).catch(() => null);
        if (!res || !res.ok) return { capTableCommunity: [], softCircleCommunity: [], crossCohort: [] };
        const j = await res.json();
        return {
          capTableCommunity: Array.isArray(j?.capTableCommunity) ? j.capTableCommunity : [],
          softCircleCommunity: Array.isArray(j?.softCircleCommunity) ? j.softCircleCommunity : [],
          crossCohort: Array.isArray(j?.crossCohort) ? j.crossCohort : [],
        };
      } catch {
        return { capTableCommunity: [], softCircleCommunity: [], crossCohort: [] };
      }
    },
    retry: false,
  });
  const data: TabbedView = q.data ?? { capTableCommunity: [], softCircleCommunity: [], crossCohort: [] };

  return (
    <div data-testid="comms-tiers-tabs" className="border-t border-border bg-muted/30 px-4 py-3">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid w-full grid-cols-3" data-testid="tabs-comms-tiers">
          <TabsTrigger value="cap_table" data-testid="tab-cap-table">
            <Users2 className="mr-1 h-4 w-4" /> Cap-Table
            <Badge variant="secondary" className="ml-2" data-testid="badge-cap-table-count">
              {data.capTableCommunity.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="soft_circle" data-testid="tab-soft-circle">
            <Heart className="mr-1 h-4 w-4" /> Soft-Circle
            <Badge variant="secondary" className="ml-2" data-testid="badge-soft-circle-count">
              {data.softCircleCommunity.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="cross_cohort" data-testid="tab-cross-cohort">
            <Network className="mr-1 h-4 w-4" /> Cross-Cohort
            <Badge variant="secondary" className="ml-2" data-testid="badge-cross-cohort-count">
              {data.crossCohort.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cap_table" className="mt-3">
          {q.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Cap-Table Community</CardTitle>
              </CardHeader>
              <CardContent>
                {data.capTableCommunity.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-cap-table">
                    No co-investor groups yet. Founders create these to facilitate intros across your cap table.
                  </p>
                ) : (
                  <ul className="space-y-2" data-testid="list-cap-table-groups">
                    {data.capTableCommunity.map((g) => (
                      <li key={g.id} className="flex items-center justify-between rounded border border-border p-2" data-testid={`item-cap-table-${g.id}`}>
                        <CompanyNameDisplay companyId={g.companyId} />
                        <Badge variant="outline">{g.badge}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="soft_circle" className="mt-3">
          {q.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Soft-Circle Community</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  Default: opt-OUT. Cross-cohort DM is OFF unless explicitly enabled.
                </p>
                {data.softCircleCommunity.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-soft-circle">No active soft-circle peer rooms.</p>
                ) : (
                  <ul className="space-y-2" data-testid="list-soft-circle-rooms">
                    {data.softCircleCommunity.map((s) => (
                      <li key={s.id} className="flex items-center justify-between rounded border border-border p-2" data-testid={`item-soft-circle-${s.id}`}>
                        <span className="text-sm">Round <span className="font-mono text-xs">{s.roundId ?? "(unknown)"}</span></span>
                        <Badge variant="outline">{s.badge}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="cross_cohort" className="mt-3">
          {q.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Cross-Cohort</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">
                  Hard cap: 3 unsolicited DMs per soft-circler per round, combined across senders.
                </p>
                {data.crossCohort.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-cross-cohort">No cross-cohort threads yet.</p>
                ) : (
                  <ul className="space-y-2" data-testid="list-cross-cohort-threads">
                    {data.crossCohort.map((d) => (
                      <li key={d.id} className="flex items-center justify-between rounded border border-border p-2" data-testid={`item-cross-cohort-${d.id}`}>
                        <span className="text-sm">Round <span className="font-mono text-xs">{d.roundId ?? "(unknown)"}</span></span>
                        <div className="flex items-center gap-2">
                          {d.status && <Badge variant={d.status === "rate_limited" ? "destructive" : "secondary"}>{d.status}</Badge>}
                          <Badge variant="outline">{d.badge}</Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}


/* Helper to resolve companyId to name using active company context */
function CompanyNameDisplay({ companyId }: { companyId?: string }) {
  const active = useActiveCompany();
  if (!companyId) return <span className="text-sm">(no company)</span>;
  const name = active.data?.company?.companyName;
  if (active.data?.activeCompanyId === companyId && name) {
    return <span className="text-sm">{name}</span>;
  }
  return <span className="text-sm font-mono text-xs">{companyId}</span>;
}
