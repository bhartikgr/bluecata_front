import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
/* v25.12 NH7 — toast errors on note save failures. */
import { useToast } from "@/hooks/use-toast";

interface Note { id: string; title: string; body: string; scope: string; updatedAt: string; authorUserId: string }

export default function PartnerNotes() {
  const role = useRequirePartnerRole();
  const q = useQuery<{ notes: Note[] }>({
    queryKey: ["/api/partner/me/notes"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/notes")).json(),
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const canWrite = role.identity && ["managing_partner", "associate", "bd"].includes(role.identity.subRole);

  /* v25.12 NH7 — toast helper. */
  const { toast } = useToast();

  const createMut = useMutation({
    /* v25.33 — apiRequest() throws ApiError on non-2xx, so the former `if (!res.ok)`
       guard was unreachable dead code. The thrown ApiError reaches onError
       unchanged, preserving the "Note save failed" toast. */
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/me/notes", { title, body, scope: "general" });
      return res.json();
    },
    onSuccess: () => { setTitle(""); setBody(""); queryClient.invalidateQueries({ queryKey: ["/api/partner/me/notes"] }); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Note save failed", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  return (
    <PartnerShell title="Notes" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {canWrite && (
          <div className="bg-white p-4 rounded border" data-testid="note-editor">
            <Input data-testid="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" className="mb-2" />
            <Textarea data-testid="note-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown content…" rows={6} />
            {/* v25.16 NH2 — prevent double-submit duplicates while mutation pending. */}
            <Button
              data-testid="note-save"
              className="mt-2"
              disabled={!title || !body || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
        <div className="bg-white p-4 rounded border" data-testid="notes-list">
          <div className="text-xs uppercase text-slate-500 mb-2">All notes</div>
          {/* v25.15 NM3 — explicit error branch (mirrors PartnerClients NM2). */}
          {q.isError && (
            <div
              className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"
              data-testid="notes-error"
            >
              Could not load notes. Please refresh and try again.
            </div>
          )}
          {q.isLoading && <div className="text-xs text-slate-500" data-testid="notes-loading">Loading…</div>}
          {!q.isLoading && !q.isError && (q.data?.notes ?? []).length === 0 && <div className="text-xs text-slate-500">No notes yet.</div>}
          <ul className="space-y-2">
            {(q.data?.notes ?? []).map((n) => (
              <li key={n.id} className="border-b pb-2" data-testid={`note-${n.id}`}>
                <div className="text-sm font-medium">{n.title}</div>
                {/* v25.16 NM6 — guard against null updatedAt to avoid "Invalid Date". */}
                <div className="text-xs text-slate-500 mt-0.5">{n.scope} · {n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : "—"}</div>
                <div className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{n.body}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PartnerShell>
  );
}
