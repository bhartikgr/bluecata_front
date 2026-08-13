/**
 * v25.49 Phase-3B — Consortium Partner Messages page.
 *
 * Reuses the shared comms MessagesPage component + the session-scoped
 * /api/comms/channels feed — NO parallel messaging backend. Visibility is
 * enforced server-side by channelIsVisibleToViewer (a partner only ever sees
 * channels they participate in / derive membership for), so a partner can never
 * read another partner's or another tenant's private threads. `hideHeader`
 * suppresses the shared component's investor/founder breadcrumb; PartnerShell
 * supplies the on-brand "Messages" header instead.
 *
 * W2M B2 — New-DM button + picker. Mirrors the founder Messages.tsx pattern
 * (GET /api/comms/users candidate list, POST /api/comms/dm/start on select)
 * but sourced from the comms users directory instead of the founder CRM,
 * since a partner has no CRM surface. Never assumes success without `ok`;
 * 403 (blocked) and 422 (contact_not_provisioned) render visible, actionable
 * copy instead of failing silently.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessagesPage } from "@/components/comms/MessagesPage";
import { MessagingAudienceNotice } from "@/components/comms/MessagingAudienceNotice";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
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

export default function PartnerMessages() {
  const role = useRequirePartnerRole();
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  /* WAVE 18 CP-MSG-05 — a rate-limited send is a FAIL-CLOSED state and has to
     stay on screen. A toast is gone in four seconds and takes the retry window
     with it, which leaves the partner clicking a button that keeps failing for
     reasons they can no longer read. The server's own `retryAfterMs` is the
     only source of the wait; we never invent one. */
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);

  const usersQ = useQuery<CommsUser[]>({
    queryKey: ["/api/comms/users"],
    queryFn: async () => (await apiRequest("GET", "/api/comms/users")).json(),
    enabled: pickerOpen,
  });

  // W2M B2 — never assume success without `ok`; 403/422 get visible,
  // actionable copy instead of a silent failure.
  const startDm = useMutation({
    mutationFn: async (targetUserId: string) => {
      const r = await apiRequest("POST", "/api/comms/dm/start", { targetUserId });
      return (await r.json()) as { ok: boolean; channelId?: string };
    },
    onSuccess: (data) => {
      setPickerOpen(false);
      /* A send that got through means the window has reopened. */
      setRateLimitedUntil(null);
      if (!data.ok || !data.channelId) {
        toast({
          title: "Could not start message",
          description: "This contact isn't available to message yet.",
          variant: "destructive",
        });
      }
    },
    onError: (e: unknown) => {
      setPickerOpen(false);
      if (e instanceof ApiError && e.status === 429) {
        /* `retryAfterMs` comes from the limiter (`server/lib/rateLimit.ts`
           429 body). If the payload is not the shape we expect we show the
           refusal WITHOUT a countdown rather than guess a number. */
        const payload = e.payload as { retryAfterMs?: unknown } | null;
        const ms =
          payload && typeof payload.retryAfterMs === "number" && payload.retryAfterMs > 0
            ? payload.retryAfterMs
            : null;
        setRateLimitedUntil(ms === null ? 0 : Date.now() + ms);
        toast({ title: "Too many messages — please slow down", variant: "destructive" });
        return;
      }
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

  if (!role.ready || !role.identity) return null;
  const me = role.identity;

  const filteredUsers = (usersQ.data ?? []).filter((u) => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return true;
    const screenName = u.visibility?.screenName ?? "";
    return u.legalName.toLowerCase().includes(q) || screenName.toLowerCase().includes(q);
  });

  return (
    <PartnerShell title="Messages" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      {rateLimitedUntil !== null && (
        <div
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          role="status"
          data-testid="partner-messages-rate-limited"
        >
          You&rsquo;ve sent too many messages in a short time. Your next message will go
          through
          {rateLimitedUntil > 0
            ? ` in about ${Math.max(1, Math.ceil((rateLimitedUntil - Date.now()) / 1000))} seconds.`
            : " shortly."}
        </div>
      )}

      <div className="mb-3 flex items-center justify-end">
        <Button
          size="sm"
          className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white h-8"
          onClick={() => setPickerOpen(true)}
          data-testid="partner-new-dm-button"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> New message
        </Button>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg" data-testid="partner-new-dm-picker">
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
                data-testid="partner-new-dm-search"
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
                  data-testid={`partner-new-dm-pick-${u.id}`}
                >
                  <MessageSquare className="h-3 w-3 text-[hsl(0_100%_40%)]" />
                  <span className="font-medium">{u.legalName}</span>
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(false)} data-testid="partner-new-dm-cancel">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MessagesPage role="investor" hideHeader />
      {/* WAVE 33 CP-MSG-01 — appended at the END as a SIBLING (guard rule 4).
          The empty recipient picker is a SHARED PLATFORM rule, so the identical
          component is mounted on the investor and founder Messages pages too. */}
      <MessagingAudienceNotice className="mt-4" />
    </PartnerShell>
  );
}
