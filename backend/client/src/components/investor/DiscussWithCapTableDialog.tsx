/**
 * Sprint 21 Wave A — DiscussWithCapTableDialog
 *
 * Opens a dialog to send an M&A discussion to cap-table co-members.
 * Supports two modes:
 *   "message" — sends as a DM to selected recipients
 *   "post"    — posts to the cap-table channel for the company
 *
 * No window.confirm / window.alert / window.prompt — uses Dialog modal only.
 * No localStorage / sessionStorage / indexedDB.
 * All network calls via apiRequest().
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Rss, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type CoMember = {
  memberId: string;
  displayLabel: string;
  areaOfExpertise: string[];
  investorExperienceTier: string;
  chapter?: string;
  screenNameOnly: boolean;
  allowDM: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  companyName: string;
  topBuyer: string;
  maScore: number;
};

export function DiscussWithCapTableDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  topBuyer,
  maScore,
}: Props) {
  const { toast } = useToast();

  const defaultBody = `Discussing M&A signal on ${companyName} — top buyer ${topBuyer || "TBD"}, M&A score ${maScore}/100.`;

  const [messageBody, setMessageBody] = useState(defaultBody);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"message" | "post">("message");

  // Reset state when dialog opens with new company context
  useEffect(() => {
    if (open) {
      setMessageBody(`Discussing M&A signal on ${companyName} — top buyer ${topBuyer || "TBD"}, M&A score ${maScore}/100.`);
      setMode("message");
      // v25.13 NM2 — clear stale recipient selection from a prior open so
      // a rapid reopen-then-submit can't fire at the previous company's list.
      setSelectedIds(new Set());
    }
  }, [open, companyName, topBuyer, maScore]);

  const coMembersQuery = useQuery<CoMember[]>({
    queryKey: ["/api/investor/companies", companyId, "co-members"],
    queryFn: async () => {
      const r = await apiRequest(
        "GET",
        `/api/investor/companies/${companyId}/co-members`,
      );
      return r.json();
    },
    enabled: open && !!companyId,
  });

  // Pre-select all members when data loads
  useEffect(() => {
    if (coMembersQuery.data) {
      setSelectedIds(new Set(coMembersQuery.data.map((m) => m.memberId)));
    }
  }, [coMembersQuery.data]);

  const discussMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/investor/dashboard/ma-discuss", {
        companyId,
        body: messageBody.trim(),
        recipientIds: Array.from(selectedIds),
        mode,
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (mode === "message") {
        toast({
          title: "Messages sent",
          description: `Sent to ${data.recipientCount ?? selectedIds.size} cap-table member(s).`,
        });
      } else {
        toast({
          title: "Posted to cap-table channel",
          description: `Your M&A discussion has been posted for ${companyName}.`,
        });
      }
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to send",
        description: e.message ?? "An unexpected error occurred.",
        variant: "destructive",
      });
    },
  });

  function toggleMember(memberId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  const members = coMembersQuery.data ?? [];
  const dmableMembers = members.filter((m) => m.allowDM);
  const allSelected =
    dmableMembers.length > 0 &&
    dmableMembers.every((m) => selectedIds.has(m.memberId));

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(dmableMembers.map((m) => m.memberId)));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="dialog-discuss-cap-table">
        <DialogHeader>
          <DialogTitle className="text-base">
            Discuss M&amp;A signal — {companyName}
          </DialogTitle>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex items-center gap-2 border rounded-md p-1 w-fit">
          <button
            type="button"
            onClick={() => setMode("message")}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
              mode === "message"
                ? "bg-[hsl(0_100%_40%)] text-white"
                : "text-muted-foreground hover:bg-secondary"
            }`}
            data-testid="button-mode-message"
          >
            <MessageSquare className="h-3.5 w-3.5" /> Send as message
          </button>
          <button
            type="button"
            onClick={() => setMode("post")}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded ${
              mode === "post"
                ? "bg-[hsl(0_100%_40%)] text-white"
                : "text-muted-foreground hover:bg-secondary"
            }`}
            data-testid="button-mode-post"
          >
            <Rss className="h-3.5 w-3.5" /> Post to cap-table
          </button>
        </div>

        {/* Message body */}
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground font-medium">Message</label>
          <Textarea
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            rows={3}
            className="resize-none text-sm"
            data-testid="input-discuss-body"
          />
        </div>

        {/* Recipient list — only shown in message mode */}
        {mode === "message" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground font-medium">
                Recipients ({selectedIds.size} selected)
              </label>
              {dmableMembers.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-xs text-[hsl(0_100%_40%)] hover:underline"
                  data-testid="button-toggle-all-recipients"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>

            {coMembersQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading co-members…
              </div>
            )}

            {!coMembersQuery.isLoading && members.length === 0 && (
              <div className="text-sm text-muted-foreground py-3 text-center">
                No co-members found for this company.
              </div>
            )}

            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {members.map((m) => (
                <li
                  key={m.memberId}
                  className={`flex items-start gap-3 px-3 py-2 rounded-md border text-sm ${
                    !m.allowDM ? "opacity-50" : "hover:bg-secondary/40"
                  }`}
                  data-testid={`recipient-row-${m.memberId}`}
                >
                  <Checkbox
                    checked={selectedIds.has(m.memberId)}
                    onCheckedChange={() => m.allowDM && toggleMember(m.memberId)}
                    disabled={!m.allowDM}
                    data-testid={`checkbox-recipient-${m.memberId}`}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">
                      {m.displayLabel}
                      {!m.allowDM && (
                        <span className="ml-2 text-[10px] text-muted-foreground">(DMs off)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                        {m.investorExperienceTier}
                      </Badge>
                      {m.areaOfExpertise.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] text-muted-foreground px-1.5 h-4 rounded-full bg-secondary inline-flex items-center"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {mode === "post" && (
          <p className="text-xs text-muted-foreground">
            This will be posted as a message to the <strong>{companyName}</strong> cap-table channel, visible to all cap-table members.
          </p>
        )}

        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline" size="sm" data-testid="button-discuss-dismiss">
              Dismiss
            </Button>
          </DialogClose>
          <Button
            size="sm"
            className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
            disabled={
              !messageBody.trim() ||
              discussMutation.isPending ||
              (mode === "message" && selectedIds.size === 0)
            }
            onClick={() => discussMutation.mutate()}
            data-testid="button-discuss-send"
          >
            {discussMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : null}
            {mode === "message" ? "Send as message" : "Post to cap-table channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
