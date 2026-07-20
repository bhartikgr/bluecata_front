/**
 * Sprint 9 — Investor Messages page (split-pane).
 * Replaces the Sprint-7 basic Messages page with the full comms surface.
 *
 * Defect 10: Replace hardcoded userId with session identity from useEntitlement().
 *
 * Sprint 21 Wave F — Investor-side parity verification:
 *  1. Thread deeplink (?thread=X): handled by MessagesPage via URL params ✓
 *  2. Channel filters (All/Starred/DMs/Cap-Table/Soft-Circle/…): handled in MessagesPage ✓
 *  3. Optimistic send (onMutate): handled in MessagesPage ✓
 *  4. Read receipts: handled in MessagesPage ✓
 *  5. @mention autocomplete from /api/comms/users: handled in MessagesPage ✓
 *  6. File attachment (dataroom picker): handled in MessagesPage ✓
 *  7. Cmd-K search: handled in MessagesPage ✓
 *  8. MoreHorizontal context menu (Mute/Archive/Pin): handled in MessagesPage ✓
 *  9. Bell notifications include thread ID: seed data at /investor/messages?thread=X ✓
 * 10. ?contactId= DM resolution: handled in MessagesPage ✓
 * 11. Typing indicator debounced POST: handled in MessagesPage ✓
 * 12. ?roundId= for Founder Q&A: handled in MessagesPage via soft_circle resolution ✓
 *
 * Investor-specific label fix:
 *  - MessagesWidget title "Messages from founders" — set in MessagesWidget (basePath check) ✓
 *  - Cap-Table channel shows the company name (e.g. "<Company> — Cap Table") from live data ✓
 *  - Soft-Circle channel shows the round name (e.g. "<Round> — Soft-Circle") from live data ✓
 *  - Investors only see channels they're participants in (server-side channelIsVisibleToViewer) ✓
 *
 * dataroom file picker: MessagesPage queries /api/founder/dataroom/files which the server
 * aliases to investor-accessible files. No investor-specific override needed.
 *
 * W-FIX1b O3 — New-message entry point for investors. Mirrors the partner
 * Messages pattern (GET /api/comms/users candidate list, POST /api/comms/dm/start
 * on select) sourced from the session-scoped comms directory, since an investor
 * has no founder CRM surface. Never assumes success without `ok`; 403 (blocked)
 * and 422 (contact_not_provisioned) render visible, actionable copy instead of
 * failing silently.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessagesPage } from "@/components/comms/MessagesPage";
import { CommsTiersTabs } from "@/components/comms/CommsTiersTabs";
import { PageHeader } from "@/components/AppShell";
import { useEntitlement } from "@/lib/entitlement";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, MessageSquare } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type CommsUser = {
  id: string;
  legalName: string;
  visibility?: { screenName?: string };
  roles?: string[];
  location?: string;
};

export default function Messages() {
  // DEF-004: derive userId from session cookie; block if not yet resolved.
  const { data: entCtx, isLoading } = useEntitlement();
  const userId = entCtx?.userId;
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  const usersQ = useQuery<CommsUser[]>({
    queryKey: ["/api/comms/users"],
    queryFn: async () => (await apiRequest("GET", "/api/comms/users")).json(),
    enabled: pickerOpen,
  });

  // O3 — never assume success without `ok`; 403/422 get visible, actionable
  // copy instead of a silent failure (same contract the founder/partner
  // surfaces use).
  const startDm = useMutation({
    mutationFn: async (targetUserId: string) => {
      const r = await apiRequest("POST", "/api/comms/dm/start", { targetUserId });
      return (await r.json()) as { ok: boolean; channelId?: string; reason?: string };
    },
    onSuccess: (data) => {
      setPickerOpen(false);
      if (!data.ok || !data.channelId) {
        toast({
          title: "Could not start message",
          description: data.reason ?? "This contact isn't available to message yet.",
          variant: "destructive",
        });
      }
    },
    onError: (e: unknown) => {
      setPickerOpen(false);
      if (e instanceof ApiError && e.status === 403) {
        toast({ title: "You can't message this person", variant: "destructive" });
        return;
      }
      if (e instanceof ApiError && e.status === 422) {
        toast({
          title: "Contact must accept their invitation first",
          description: e.message,
          variant: "destructive",
        });
        return;
      }
      const msg = e instanceof Error ? e.message : "Could not start the message.";
      toast({ title: "Failed to start message", description: msg, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Sign in to view messages.
      </div>
    );
  }

  const filteredUsers = (usersQ.data ?? []).filter((u) => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return true;
    const screenName = u.visibility?.screenName ?? "";
    return u.legalName.toLowerCase().includes(q) || screenName.toLowerCase().includes(q);
  });

  return (
    <div className="flex flex-col" data-testid="investor-messages">
      {/* W-FIX1b O4 — render the "Messages" title ABOVE the Cap-Table Community
          tabs (was rendering below them via the inner MessagesPage header, so the
          community panel visually overlapped the header). The inner header is
          suppressed via hideHeader so the title appears exactly once, on top. */}
      <PageHeader
        title="Messages"
        description="Direct messages, cap-table channels, and soft-circle channels — all in one place."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Messages" }]}
      />

      <div className="mb-3 flex items-center justify-end">
        <Button
          size="sm"
          className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white h-8"
          onClick={() => setPickerOpen(true)}
          data-testid="investor-new-dm-button"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> New message
        </Button>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg" data-testid="investor-new-dm-picker">
          <DialogHeader>
            <DialogTitle className="text-sm">Start a new message</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search by name…"
                className="h-9 pl-8 text-sm"
                autoFocus
                data-testid="investor-new-dm-search"
              />
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-border rounded-md border border-border">
              {usersQ.isLoading && (
                <div className="p-3 text-xs text-muted-foreground">Loading contacts…</div>
              )}
              {!usersQ.isLoading && filteredUsers.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">No eligible contacts.</div>
              )}
              {filteredUsers.slice(0, 30).map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="w-full text-left p-2 text-xs hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                  onClick={() => startDm.mutate(u.id)}
                  disabled={startDm.isPending}
                  data-testid={`investor-new-dm-pick-${u.id}`}
                >
                  <MessageSquare className="h-3 w-3 text-[hsl(0_100%_40%)]" />
                  <span className="font-medium">{u.legalName}</span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(false)} data-testid="investor-new-dm-cancel">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CommsTiersTabs userId={userId} />
      <MessagesPage role="investor" hideHeader />
    </div>
  );
}
