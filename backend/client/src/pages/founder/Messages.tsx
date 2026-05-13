import { asArray } from "@/lib/safeArray";
/**
 * Sprint 9 + Sprint 11 D8 — Founder Messages.
 *
 * Wraps the shared MessagesPage with a founder context strip exposing
 * unified links: jump-to cap-table holder, CRM record, active rounds, dataroom.
 * Selecting a thread auto-deep-links via the existing channel layer; this
 * surface adds the cross-surface jump shortcuts the spec requires.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { MessagesPage } from "@/components/comms/MessagesPage";
import { useToast } from "@/hooks/use-toast";
import { CommsTiersTabs } from "@/components/comms/CommsTiersTabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filter, Users, BarChart3, FileBox, ExternalLink, Search, Plus, MessageSquare } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { apiRequest } from "@/lib/queryClient";

type CrmRow = { id: string; investorId: string; name: string; firmName: string; region: string; stage: string; threadIds?: string[] };
type Round = { id: string; name: string; state: string; companyId: string };

export default function Messages() {
  const companyId = useActiveCompanyId();
  const [, setLocation] = useLocation();
  const meQ = useQuery<{ id: string; displayName: string }>({ queryKey: ["/api/auth/me"] });
  const [filter, setFilter] = useState("");
  // Sprint 18 Phase 2 — T9.1 user picker for new threads.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const { toast } = useToast();

  // Sprint 18 Phase 3 E1 — actually open a DM thread when the user picks a
  // contact. Hits the existing /api/comms/dm/start endpoint (which enforces the
  // Sprint 15 entitlement gate + Sprint 9 visibility resolver) and on success
  // navigates to the new channel inside the inbox.
  const startDm = useMutation({
    mutationFn: async (targetUserId: string) => {
      const r = await apiRequest("POST", "/api/comms/dm/start", { targetUserId });
      return r.json() as Promise<{ ok: boolean; channelId?: string; reason?: string }>;
    },
    onSuccess: (data) => {
      setPickerOpen(false);
      if (!data.ok || !data.channelId) {
        toast({
          title: "Cannot DM that user",
          description: data.reason ?? "You do not have a shared cap-table or visibility context with this user.",
          variant: "destructive",
        });
        return;
      }
      setLocation(`/founder/messages?thread=${encodeURIComponent(data.channelId)}&channel=${encodeURIComponent(data.channelId)}`);
    },
    onError: (e: Error) => toast({ title: "Failed to start thread", description: e.message, variant: "destructive" }),
  });

  const crmQ = useQuery<CrmRow[]>({
    queryKey: ["/api/founder/investor-crm", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${companyId}`)).json(),
  });
  const roundsQ = useQuery<Round[]>({
    queryKey: ["/api/rounds", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/rounds?companyId=${companyId}`)).json(),
  });

  const investedHolders = useMemo(
    () => asArray<CrmRow>(crmQ.data).filter(c => c.stage === "invested"),
    [crmQ.data]
  );
  const activeRounds = useMemo(
    () => asArray<Round>(roundsQ.data).filter(r => ["draft", "terms_set", "soft_circle_open", "signing_open"].includes(r.state)),
    [roundsQ.data]
  );

  const filteredHolders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return investedHolders;
    return investedHolders.filter(h => h.name.toLowerCase().includes(q) || h.firmName.toLowerCase().includes(q));
  }, [investedHolders, filter]);

  return (
    <div data-testid="founder-messages">
      {/* Unified-link context strip — Sprint 11 D8 */}
      <Card className="mb-3 border-[hsl(184_98%_22%)]/30">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[hsl(184_98%_22%)]">
              <Filter className="h-3.5 w-3.5" /> Cross-surface jump
            </div>

            {/* Sprint 18 Phase 3 B2 — the "Cap Table" jump on the Messages page now
                routes to the cap-table CHANNEL inside Messages (per spec) rather
                than the cap-table sheet at /founder/captable. The latter remains
                accessible from the dashboard cap-table card. */}
            <Link href={`/founder/messages?channel=cap_table&companyId=${encodeURIComponent(companyId)}`}>
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="link-captable">
                <Users className="h-3 w-3 mr-1" /> Cap-table channel ({investedHolders.length} holders)
                <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </Link>
            <Link href="/founder/captable">
              <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid="link-captable-sheet">
                <ExternalLink className="h-3 w-3 mr-1" /> Open cap-table sheet
              </Button>
            </Link>

            <Link href="/founder/crm">
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="link-crm">
                <BarChart3 className="h-3 w-3 mr-1" /> CRM ({crmQ.data?.length ?? 0})
                <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </Link>

            <Link href="/founder/dataroom">
              <Button size="sm" variant="outline" className="h-7 text-xs" data-testid="link-dataroom">
                <FileBox className="h-3 w-3 mr-1" /> Dataroom
                <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
              </Button>
            </Link>

            {activeRounds.map(r => (
              <Link key={r.id} href={`/founder/rounds/${r.id}`}>
                <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`link-round-${r.id}`}>
                  <Badge variant="outline" className="h-4 mr-1 px-1 text-[9px] border-[hsl(184_98%_22%)] text-[hsl(184_98%_22%)]">{r.state}</Badge>
                  {r.name}
                  <ExternalLink className="h-3 w-3 ml-1 opacity-60" />
                </Button>
              </Link>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter cap-table holders…"
                className="h-7 pl-7 text-xs"
                data-testid="input-filter-holders"
              />
            </div>
            <div className="flex flex-wrap gap-1 max-w-[60%] overflow-x-auto">
              {filteredHolders.slice(0, 8).map(h => (
                <Link key={h.id} href={`/founder/crm?contactId=${encodeURIComponent(h.investorId)}`}>
                  <Badge
                    variant="outline"
                    className="text-[10px] cursor-pointer hover:bg-[hsl(184_98%_22%)]/10"
                    data-testid={`badge-holder-${h.investorId}`}
                  >
                    <Users className="h-2.5 w-2.5 mr-1 text-[hsl(184_98%_22%)]" />
                    {h.name} · {h.firmName}
                  </Badge>
                </Link>
              ))}
              {filteredHolders.length > 8 && (
                <Badge variant="outline" className="text-[10px]">+{filteredHolders.length - 8} more</Badge>
              )}
              {filteredHolders.length === 0 && filter && (
                <span className="text-[10px] text-muted-foreground">No matching holders.</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sprint 18 Phase 2 — T9.1 New-message user picker */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Threads are role-aware. You can DM cap-table members and active-round investors. Uninvited investors are gated per Sprint 15 entitlement rules.
        </div>
        <Button
          size="sm"
          className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white h-8"
          onClick={() => setPickerOpen(true)}
          data-testid="button-new-message"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> New message
        </Button>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Start a new message</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Search by name, firm, or email…"
                className="h-9 pl-8 text-sm"
                autoFocus
                data-testid="input-new-message-search"
              />
            </div>

            {/* Recent contacts shortcut */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Recent contacts</div>
              <div className="flex flex-wrap gap-1.5">
                {investedHolders.slice(0, 6).map((h) => (
                  <Button
                    key={h.id}
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => startDm.mutate(h.investorId)}
                    disabled={startDm.isPending}
                    data-testid={`recent-${h.investorId}`}
                  >
                    <Users className="h-3 w-3 mr-1" /> {h.name}
                  </Button>
                ))}
                {investedHolders.length === 0 && (
                  <div className="text-xs text-muted-foreground">No recent contacts yet.</div>
                )}
              </div>
            </div>

            {/* Search results from CRM */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">All eligible contacts</div>
              <div className="max-h-72 overflow-y-auto divide-y divide-border rounded-md border border-border">
                {asArray<CrmRow>(crmQ.data)
                  .filter((c) => {
                    const q = pickerQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      c.name.toLowerCase().includes(q) ||
                      c.firmName.toLowerCase().includes(q) ||
                      ((c as any).email ?? "").toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 30)
                  .map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left p-2 text-xs hover:bg-muted flex items-center justify-between gap-2 disabled:opacity-50"
                      onClick={() => startDm.mutate(c.investorId)}
                      disabled={startDm.isPending}
                      data-testid={`pick-contact-${c.investorId}`}
                    >
                      <span className="flex items-center gap-2">
                        <MessageSquare className="h-3 w-3 text-[hsl(184_98%_22%)]" />
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">· {c.firmName}</span>
                      </span>
                      <Badge variant="outline" className="text-[9px]">{c.stage}</Badge>
                    </button>
                  ))}
                {asArray<CrmRow>(crmQ.data).length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">No eligible contacts.</div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(false)} data-testid="button-cancel-new-message">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CommsTiersTabs userId={meQ?.data?.id ?? "u_maya_chen"} />
      <MessagesPage role="founder" />
    </div>
  );
}
