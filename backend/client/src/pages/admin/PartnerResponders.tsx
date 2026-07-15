/* W6 — Admin partner-responder registry.
 * /admin/partner-responders — manage which Consortium Partners are available to
 * respond to member questions (per chapter, with topic tags). DB-driven via
 * /api/admin/partner-responders (non-sacred). No payment/sacred code touched.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Handshake, Plus, Trash2, Pause, Play } from "lucide-react";

interface Responder {
  id: string; partnerId: string; chapterId: string | null; displayName: string;
  topics: string[]; status: "active" | "paused" | "archived";
}
const QK = "/api/admin/partner-responders";

export default function PartnerResponders() {
  const { toast } = useToast();
  const [form, setForm] = useState({ partnerId: "", displayName: "", chapterId: "", topics: "" });
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<{ ok: boolean; responders: Responder[] }>({
    queryKey: [QK],
    queryFn: async () => (await apiRequest("GET", QK)).json(),
    retry: false,
  });

  function invalidate() { queryClient.invalidateQueries({ queryKey: [QK] }); }

  const createMut = useMutation({
    mutationFn: async () => {
      const body = {
        partnerId: form.partnerId.trim(),
        displayName: form.displayName.trim(),
        chapterId: form.chapterId.trim() || null,
        topics: form.topics.split(",").map((s) => s.trim()).filter(Boolean),
      };
      const r = await apiRequest("POST", QK, body);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "create_failed");
      return j;
    },
    onSuccess: () => { invalidate(); setShowCreate(false); setForm({ partnerId: "", displayName: "", chapterId: "", topics: "" }); toast({ title: "Responder added" }); },
    onError: (e: any) => toast({ title: "Create failed", description: e?.message, variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: async (v: { id: string; status: Responder["status"] }) => {
      const r = await apiRequest("PATCH", `${QK}/${v.id}`, { status: v.status });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "update_failed");
      return j;
    },
    onSuccess: () => { invalidate(); toast({ title: "Responder updated" }); },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      if (typeof window !== "undefined" && !window.confirm("Remove this partner responder? Members will no longer be able to request them.")) {
        throw new Error("cancelled");
      }
      const r = await apiRequest("DELETE", `${QK}/${id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "delete_failed");
      return j;
    },
    onSuccess: () => { invalidate(); toast({ title: "Responder removed" }); },
    onError: (e: any) => { if (e?.message === "cancelled") return; toast({ title: "Remove failed", description: e?.message, variant: "destructive" }); },
  });

  const responders = data?.responders ?? [];

  return (
    <>
      <PageHeader
        title="Partner Responders"
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Partner Responders" }]}
        description="Consortium Partners available to respond to member Ask-an-Expert questions. Members can request an active responder on any question; the partner accepts and answers via the normal Q&A flow."
      />
      <PageBody>
        <div className="flex items-center gap-3 mb-4">
          <Button onClick={() => setShowCreate((s) => !s)} data-testid="button-new-responder">
            <Plus className="h-4 w-4 mr-1" /> Add responder
          </Button>
        </div>

        {showCreate && (
          <Card className="mb-6" data-testid="responder-create">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Handshake className="h-4 w-4" /> New responder</CardTitle></CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Partner ID</Label>
                <Input value={form.partnerId} onChange={(e) => setForm({ ...form, partnerId: e.target.value })} placeholder="ac_consortium_partner_…" data-testid="input-partner-id" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Display name</Label>
                <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Trendwell Ventures" data-testid="input-display-name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Chapter ID (blank = all chapters)</Label>
                <Input value={form.chapterId} onChange={(e) => setForm({ ...form, chapterId: e.target.value })} placeholder="chap_keiretsu_canada" data-testid="input-chapter-id" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Topics (comma-separated)</Label>
                <Input value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} placeholder="SPVs, tax, fundraising" data-testid="input-topics" />
              </div>
              <div className="md:col-span-2 flex gap-3">
                <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !form.partnerId.trim() || !form.displayName.trim()} data-testid="button-save-responder">Create</Button>
                <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle className="text-sm">Responders</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="responders-loading">Loading responders…</p>
            ) : isError || (data && !data.ok) ? (
              <div className="flex flex-col items-start gap-2" data-testid="responders-error">
                <p className="text-sm text-rose-600">Couldn’t load responders.</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
              </div>
            ) : responders.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="responders-empty">No partner responders yet. Add one to let members request partner responses.</p>
            ) : (
              <div className="space-y-2" data-testid="responders-list">
                {responders.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3" data-testid={`responder-${r.id}`}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{r.displayName}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.partnerId} · {r.chapterId ?? "all chapters"}{r.topics.length ? ` · ${r.topics.join(", ")}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={r.status === "active" ? "default" : "outline"}>{r.status}</Badge>
                      {r.status === "active" ? (
                        <Button variant="ghost" size="sm" onClick={() => patchMut.mutate({ id: r.id, status: "paused" })} title="Pause" data-testid={`pause-${r.id}`}><Pause className="h-3.5 w-3.5" /></Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => patchMut.mutate({ id: r.id, status: "active" })} title="Activate" data-testid={`activate-${r.id}`}><Play className="h-3.5 w-3.5" /></Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(r.id)} title="Remove" data-testid={`delete-${r.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
