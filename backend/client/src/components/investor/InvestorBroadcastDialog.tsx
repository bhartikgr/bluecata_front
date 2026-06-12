/**
 * Sprint 21 Wave D — InvestorBroadcastDialog
 *
 * Bulk-message recipient picker for the investor CRM.
 * Supports two modes:
 *   "dm"   — sends a DM to each selected recipient individually
 *   "post" — creates a single network post
 *
 * No window.confirm / window.alert / window.prompt — Dialog modal only.
 * No localStorage / sessionStorage / indexedDB.
 * All network calls via apiRequest().
 */

import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MessageSquare, Rss, Loader2, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { InvestorCrmContact } from "@/pages/investor/CRM";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All currently visible (filtered) contacts shown in the list */
  contacts: InvestorCrmContact[];
  /** Pre-selected IDs (from bulk-select checkboxes). If empty, all contacts are selected. */
  initialIds?: Set<string>;
};

export function InvestorBroadcastDialog({
  open,
  onOpenChange,
  contacts,
  initialIds,
}: Props) {
  const { toast } = useToast();

  const [body, setBody] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [done, setDone] = useState(false);

  // Reset and initialise when dialog opens
  useEffect(() => {
    if (open) {
      setBody("");
      setDone(false);
      setProgress(null);
      if (initialIds && initialIds.size > 0) {
        setSelectedIds(new Set(initialIds));
      } else {
        // default: all contacts selected
        setSelectedIds(new Set(contacts.map((c) => c.id)));
      }
    }
  }, [open]); // intentionally only re-run when `open` changes

  // DEF-057: use contacts.every() for strict select-all detection
  function toggleAll() {
    const allSelected = contacts.every((c) => selectedIds.has(c.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  const recipients = contacts.filter((c) => selectedIds.has(c.id));

  async function sendDms() {
    // DEF-008: use platformUserId; skip contacts without one.
    // DEF-041: report skipped count in toast.
    const linked = recipients.filter((c) => !!c.platformUserId);
    const skipped = recipients.length - linked.length;
    const total = recipients.length;
    setProgress({ sent: 0, total: linked.length });
    let sent = 0;
    let failed = 0;
    for (const c of linked) {
      try {
        // Step 1: start or resolve DM channel
        const dmRes = await apiRequest("POST", "/api/comms/dm/start", {
          targetUserId: c.platformUserId,
        });
        const { channelId } = await dmRes.json();
        if (channelId) {
          // Step 2: post message into channel
          await apiRequest("POST", `/api/comms/channels/${channelId}/messages`, {
            body,
            kind: "text",
          });
        }
        sent++;
      } catch {
        failed++;
      }
      setProgress({ sent: sent + failed, total: linked.length });
    }
    setDone(true);
    const skippedNote = skipped > 0 ? ` (${skipped} not linked to platform accounts)` : "";
    toast({
      title: "DMs sent",
      description: `Sent to ${sent} of ${total} contacts${skippedNote}${failed > 0 ? `, ${failed} failed` : ""}.`,
    });
  }

  async function postToNetwork() {
    await apiRequest("POST", "/api/comms/posts", {
      body,
      visibility: "network",
    });
    setDone(true);
    toast({ title: "Posted to network" });
  }

  const [sending, setSending] = useState(false);

  async function handleSendDms() {
    if (!body.trim() || recipients.length === 0) return;
    setSending(true);
    try { await sendDms(); } finally { setSending(false); }
  }

  async function handlePost() {
    if (!body.trim()) return;
    setSending(true);
    try { await postToNetwork(); } finally { setSending(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialIds && initialIds.size > 0
              ? `Bulk message (${initialIds.size} selected)`
              : "Broadcast to network"}
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <div className="text-base font-medium">
              {progress
                ? `Sent ${progress.sent} of ${progress.total} DMs`
                : "Post published"}
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Recipients */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs uppercase tracking-wide">
                  Recipients ({selectedIds.size} of {contacts.length})
                </Label>
                <button
                  onClick={toggleAll}
                  className="text-xs text-[hsl(184_98%_22%)] hover:underline"
                  data-testid="button-toggle-all"
                >
                  {contacts.every((c) => selectedIds.has(c.id)) ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto rounded-md border bg-secondary/20 p-2 space-y-1">
                {contacts.length === 0 && (
                  <div className="text-sm text-muted-foreground px-2 py-1">No contacts visible.</div>
                )}
                {contacts.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 p-1 rounded hover:bg-accent cursor-pointer"
                    data-testid={`recipient-row-${c.id}`}
                  >
                    <Checkbox
                      checked={selectedIds.has(c.id)}
                      onCheckedChange={() => toggleOne(c.id)}
                      data-testid={`recipient-check-${c.id}`}
                    />
                    <span className="text-sm flex-1 truncate">{c.name}</span>
                    {c.affiliation && (
                      <span className="text-xs text-muted-foreground truncate">{c.affiliation}</span>
                    )}
                  </label>
                ))}
              </div>
              {selectedIds.size > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {recipients.slice(0, 8).map((c) => (
                    <Badge key={c.id} variant="outline" className="text-[10px]" data-testid={`badge-recipient-${c.id}`}>
                      {c.name}
                    </Badge>
                  ))}
                  {recipients.length > 8 && (
                    <Badge variant="outline" className="text-[10px]">+{recipients.length - 8} more</Badge>
                  )}
                </div>
              )}
            </div>

            {/* Message body */}
            <div>
              <Label className="text-xs uppercase tracking-wide">Message</Label>
              <Textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message…"
                className="mt-1"
                data-testid="textarea-broadcast-body"
              />
            </div>

            {/* Progress */}
            {progress && !done && (
              <div className="text-sm text-muted-foreground text-center">
                Sending {progress.sent} of {progress.total}…
              </div>
            )}
          </div>
        )}

        {!done && (
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="outline"
              onClick={handlePost}
              disabled={!body.trim() || sending}
              data-testid="button-post-network"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Rss className="w-3.5 h-3.5 mr-1" />}
              Post once to my network
            </Button>
            <Button
              onClick={handleSendDms}
              disabled={!body.trim() || selectedIds.size === 0 || sending}
              className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
              data-testid="button-send-dms"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5 mr-1" />}
              Send DM to each ({selectedIds.size})
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
