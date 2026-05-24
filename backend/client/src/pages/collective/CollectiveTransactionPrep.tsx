/**
 * Wave C-3 — Collective Transaction Prep Tracker
 * Per-company transaction-prep channels with 30 thread anchors and open-issue counts.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ClipboardList, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";

interface ThreadStatus {
  anchor: string;
  messageCount: number;
  openIssues: number;
  readinessPct: number | null;
}

interface ChannelRow {
  channelId: string;
  companyId: string;
  companyName: string;
  transactionPrepStatus: string;
  threads: ThreadStatus[];
  totalThreads: number;
  openIssuesTotal: number;
  createdAt: string;
  archivedAt: string | null;
}

function anchorLabel(anchor: string): string {
  return anchor
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_COLORS: Record<string, string> = {
  exploring: "bg-amber-100 text-amber-700",
  active: "bg-blue-100 text-blue-700",
  closing: "bg-emerald-100 text-emerald-700",
  not_pursuing: "bg-slate-100 text-slate-500",
};

export default function CollectiveTransactionPrep() {
  const [expandedChannels, setExpandedChannels] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery<{
    channels: ChannelRow[];
    total: number;
    threadAnchors: readonly string[];
  }>({
    queryKey: ["/api/collective/dsc/prep"],
    queryFn: () => apiRequest("GET", "/api/collective/dsc/prep").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  function toggleExpand(channelId: string) {
    setExpandedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1
          className="text-xl font-semibold flex items-center gap-2"
          style={{ color: "#1A1A2E" }}
          data-testid="heading-transaction-prep"
        >
          <ClipboardList className="h-5 w-5 text-[#8E2A4E]" />
          Transaction Prep Tracker
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Per-company M&A readiness thread status. 30 thread anchors per channel.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-prep">
          Failed to load transaction prep data. Please refresh.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : !data?.channels?.length ? (
        <Card>
          <CardContent className="py-16 text-center text-slate-500" data-testid="empty-prep">
            <ClipboardList className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium">No transaction prep channels</p>
            <p className="text-xs mt-1">
              Channels are created automatically when founders enter M&A mode.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data.channels.map((channel) => {
            const isExpanded = expandedChannels.has(channel.channelId);
            const completedThreads = channel.threads.filter(
              (t) => t.openIssues === 0 && t.messageCount > 0
            ).length;
            const completionPct = channel.totalThreads > 0
              ? Math.round((completedThreads / channel.totalThreads) * 100)
              : 0;

            return (
              <Card key={channel.channelId} data-testid={`card-prep-${channel.companyId}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                          {channel.companyName}
                        </CardTitle>
                        {channel.transactionPrepStatus && (
                          <Badge
                            className={`text-[10px] capitalize ${STATUS_COLORS[channel.transactionPrepStatus] ?? "bg-slate-100 text-slate-500"}`}
                            data-testid={`badge-status-${channel.companyId}`}
                          >
                            {channel.transactionPrepStatus.replace("_", " ")}
                          </Badge>
                        )}
                        {channel.archivedAt && (
                          <Badge className="bg-slate-100 text-slate-500 text-[10px]">Archived</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <Progress
                          value={completionPct}
                          className="h-1.5 flex-1 max-w-48"
                          data-testid={`progress-${channel.companyId}`}
                        />
                        <span className="text-xs text-slate-500">
                          {completedThreads}/{channel.totalThreads} threads resolved
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {channel.openIssuesTotal > 0 && (
                        <Badge
                          className="bg-red-100 text-red-600 text-[10px] gap-1"
                          data-testid={`badge-issues-${channel.companyId}`}
                        >
                          <AlertCircle className="h-3 w-3" />
                          {channel.openIssuesTotal} open
                        </Badge>
                      )}
                      <button
                        onClick={() => toggleExpand(channel.channelId)}
                        className="p-1 rounded hover:bg-slate-100"
                        data-testid={`button-expand-${channel.companyId}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-slate-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-slate-500" />
                        )}
                      </button>
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0">
                    <div className="border-t pt-3 mt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {channel.threads.map((thread) => (
                          <div
                            key={thread.anchor}
                            className="flex items-center justify-between py-1.5 px-2 rounded bg-slate-50 text-xs"
                            data-testid={`thread-${channel.companyId}-${thread.anchor}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-700 truncate">{anchorLabel(thread.anchor)}</p>
                              {thread.readinessPct !== null && (
                                <p className="text-[10px] text-slate-400">
                                  Readiness: {thread.readinessPct}%
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              {thread.openIssues > 0 && (
                                <Badge className="bg-red-100 text-red-600 text-[8px] px-1 py-0">
                                  {thread.openIssues} issue{thread.openIssues !== 1 ? "s" : ""}
                                </Badge>
                              )}
                              <span className="text-[10px] text-slate-400">
                                {thread.messageCount} msg{thread.messageCount !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
