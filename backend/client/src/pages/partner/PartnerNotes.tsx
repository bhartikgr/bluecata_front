import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

  const createMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partner/me/notes", { title, body, scope: "general" })).json(),
    onSuccess: () => { setTitle(""); setBody(""); queryClient.invalidateQueries({ queryKey: ["/api/partner/me/notes"] }); },
  });

  if (!role.ready || !role.identity) return null;
  return (
    <PartnerShell title="Notes" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {canWrite && (
          <div className="bg-white p-4 rounded border" data-testid="note-editor">
            <Input data-testid="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" className="mb-2" />
            <Textarea data-testid="note-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown content…" rows={6} />
            <Button data-testid="note-save" className="mt-2" disabled={!title || !body} onClick={() => createMut.mutate()}>Save</Button>
          </div>
        )}
        <div className="bg-white p-4 rounded border" data-testid="notes-list">
          <div className="text-xs uppercase text-slate-500 mb-2">All notes</div>
          {(q.data?.notes ?? []).length === 0 && <div className="text-xs text-slate-500">No notes yet.</div>}
          <ul className="space-y-2">
            {(q.data?.notes ?? []).map((n) => (
              <li key={n.id} className="border-b pb-2" data-testid={`note-${n.id}`}>
                <div className="text-sm font-medium">{n.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{n.scope} · {new Date(n.updatedAt).toLocaleDateString()}</div>
                <div className="text-xs text-slate-700 mt-1 whitespace-pre-wrap">{n.body}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PartnerShell>
  );
}
