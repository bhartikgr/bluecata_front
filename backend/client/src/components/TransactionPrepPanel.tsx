/**
 * Sprint 14 D4 — Transaction-Prep channel panel.
 *
 * Channel-of-30 anchored discussion list for an active or pending transaction
 * (M&A, exit, growth round). Backed by `/api/founder/comms/transaction-prep`.
 *
 * Channel is created on-demand; archive on close. Hash chain `transaction_prep`
 * records every create/archive/add-member event.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Briefcase, ArchiveX, Lock, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useCapavateToast } from "./Toast";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";

export interface TransactionPrepPanelProps {
  companyId: string;
  founderUserId: string;
}

export function TransactionPrepPanel({ companyId, founderUserId }: TransactionPrepPanelProps) {
  const toast = useCapavateToast();

  const channelQ = useQuery<{ channel: any | null }>({
    queryKey: ["/api/founder/comms/transaction-prep", companyId],
    queryFn: async () =>
      (await apiRequest("GET", `/api/founder/comms/transaction-prep?companyId=${companyId}`)).json(),
    enabled: !!companyId,
  });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/founder/comms/transaction-prep", {
          companyId,
          founderUserId,
        })
      ).json(),
    onSuccess: () => {
      toast.success({ title: "Transaction-prep channel opened", description: "30 anchored discussion threads ready." });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/comms/transaction-prep"] });
    },
    onError: () => toast.error({ title: "Failed to open channel" }),
  });

  const archive = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: "not_pursuing" | "transaction_closed" }) =>
      (
        await apiRequest("POST", `/api/founder/comms/transaction-prep/${id}/archive`, {
          reason,
          actorUserId: founderUserId,
        })
      ).json(),
    onSuccess: () => {
      toast.info({ title: "Channel archived" });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/comms/transaction-prep"] });
    },
  });

  if (channelQ.isLoading) {
    return (
      <Card data-testid="card-transaction-prep">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-[hsl(333_75%_35%)]" /> Transaction prep
          </CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }

  const channel = channelQ.data?.channel ?? null;

  return (
    <Card data-testid="card-transaction-prep">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-[hsl(333_75%_35%)]" /> Transaction prep
          {channel?.status === "active" && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Active</Badge>}
          {channel?.status === "archived" && <Badge variant="outline">Archived</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Channel of 30 anchored discussions to drive an M&amp;A, exit, or growth round to close.
        </p>
      </CardHeader>
      <CardContent>
        {!channel && (
          <EmptyState
            icon={<Briefcase className="h-8 w-8" />}
            title="No active transaction"
            description="Open a transaction-prep channel when you're ready to engage with bankers, advisors, and select investors on a defined transaction."
            primaryAction={{
              label: create.isPending ? "Opening…" : "Open transaction-prep channel",
              onClick: () => create.mutate(),
              testId: "button-open-transaction-prep",
            }}
          />
        )}
        {channel && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {channel.memberUserIds?.length ?? 0} members</span>
              <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> Hash-chained</span>
              <span>· {channel.threads?.length ?? 0} threads</span>
            </div>
            {channel.threads && channel.threads.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto" data-testid="list-prep-threads">
                {channel.threads.slice(0, 30).map((t: any, i: number) => (
                  <div
                    key={t.id ?? i}
                    className="rounded border border-border bg-card hover-elevate p-2 text-xs"
                    data-testid={`thread-prep-${i}`}
                  >
                    <span className="font-medium">{t.title ?? t.anchor}</span>
                  </div>
                ))}
              </div>
            )}
            {channel.status === "active" && (
              <div className="flex gap-2 pt-2 border-t border-border">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => archive.mutate({ id: channel.id, reason: "transaction_closed" })}
                  data-testid="button-archive-closed"
                >
                  Mark closed
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => archive.mutate({ id: channel.id, reason: "not_pursuing" })}
                  data-testid="button-archive-not-pursuing"
                >
                  <ArchiveX className="h-3.5 w-3.5 mr-1" /> Not pursuing
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
