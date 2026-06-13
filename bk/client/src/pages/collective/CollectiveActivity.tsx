/**
 * Wave C-3 — Collective Activity Feed
 * Live bridge outbox events filtered to Collective-relevant types.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity } from "lucide-react";

interface ActivityEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateKind: string;
  occurredAt: string;
  actor: { userId: string; ip?: string };
  payload: Record<string, unknown>;
  status: string;
}

const EVENT_LABELS: Record<string, string> = {
  "company.profile.updated": "Company profile updated",
  "company.ma_intelligence.updated": "M&A intelligence updated",
  "transaction_prep.updated": "Transaction prep updated",
  "dsc.score.recomputed": "DSC score recomputed",
  "collective.member.updated": "Member settings changed",
  "collective.deal_room.opened": "Deal room opened",
  "profile.completion_changed": "Profile completion changed",
  // Final Partner CRM
  "partner.deal.promoted_to_collective": "Partner deal promoted to Collective",
  "partner.deal.referred_to_capavate": "Partner deal referred to Capavate",
};

const STATUS_COLORS: Record<string, string> = {
  delivered: "bg-emerald-100 text-emerald-700",
  queued: "bg-amber-100 text-amber-700",
  dead_letter: "bg-red-100 text-red-700",
  delivering: "bg-blue-100 text-blue-700",
};

const EVENT_COLORS: Record<string, string> = {
  "dsc.score.recomputed": "bg-purple-100 text-purple-700",
  "transaction_prep.updated": "bg-blue-100 text-blue-700",
  "company.profile.updated": "bg-slate-100 text-slate-700",
  "collective.member.updated": "bg-[#8E2A4E]/10 text-[#8E2A4E]",
  "collective.deal_room.opened": "bg-emerald-100 text-emerald-700",
  // Final Partner CRM
  "partner.deal.promoted_to_collective": "bg-[#8E2A4E]/10 text-[#8E2A4E]",
  "partner.deal.referred_to_capavate": "bg-indigo-100 text-indigo-700",
};

export default function CollectiveActivity() {
  const { data, isLoading, error } = useQuery<{ feed: ActivityEvent[]; total: number }>({
    queryKey: ["/api/collective/activity"],
    queryFn: () => apiRequest("GET", "/api/collective/activity?limit=50").then((r) => r.json()),
    refetchInterval: 15_000,
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1
          className="text-xl font-semibold flex items-center gap-2"
          style={{ color: "#1A1A2E" }}
          data-testid="heading-activity"
        >
          <Activity className="h-5 w-5 text-[#8E2A4E]" />
          Activity Feed
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Real-time Collective events (last 50). Auto-refreshes every 15 seconds.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-activity">
          Failed to load activity. Please refresh.
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
            Recent Events
            {data && (
              <span className="text-slate-400 font-normal ml-2">({data.total})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !data?.feed?.length ? (
            <div className="py-12 text-center text-slate-500" data-testid="empty-activity">
              <Activity className="h-10 w-10 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-medium">No activity yet</p>
              <p className="text-xs mt-1">
                Collective-relevant events will appear here as they occur.
              </p>
            </div>
          ) : (
            <div className="space-y-2" data-testid="list-activity">
              {data.feed.map((event) => (
                <div
                  key={event.eventId}
                  className="flex items-start gap-3 py-2.5 px-3 rounded-md border bg-white hover:bg-slate-50 transition-colors"
                  data-testid={`row-event-${event.eventId}`}
                >
                  <div className="mt-0.5 shrink-0">
                    <Badge
                      className={`text-[10px] whitespace-nowrap ${EVENT_COLORS[event.eventType] ?? "bg-slate-100 text-slate-600"}`}
                      data-testid={`badge-event-type-${event.eventId}`}
                    >
                      {EVENT_LABELS[event.eventType] ?? event.eventType}
                    </Badge>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 truncate">
                      {event.aggregateKind}: <span className="font-medium">{event.aggregateId}</span>
                    </p>
                    <p className="text-[10px] text-slate-400">
                      by {event.actor?.userId ?? "system"}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <Badge
                      className={`text-[10px] ${STATUS_COLORS[event.status] ?? "bg-slate-100 text-slate-500"}`}
                      data-testid={`badge-status-${event.eventId}`}
                    >
                      {event.status}
                    </Badge>
                    <span className="text-[10px] text-slate-400 whitespace-nowrap">
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
