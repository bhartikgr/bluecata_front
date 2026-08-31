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
import { describeFailure } from "@/lib/failureMessage";

interface Note { id: string; title: string; body: string; scope: string; scopeId: string | null; updatedAt: string; authorUserId: string; entries?: NoteEntry[] }

/* ── WAVE 203 · ITEM A — NEWEST FIRST, WITHOUT LETTING A MISSING DATE ACT AS ONE.
 *
 * R176.1: a missing value must never take part in a comparison as if it were a
 * value. `updatedAt` is DECLARED `string` above but the render at :163 already
 * guards it against null (v25.16 NM6), so in practice it can be absent. Sorting
 * with `localeCompare` on a coerced "" would rank an undated note as older than
 * every dated one — a claim about its age that the data does not support.
 *
 * So dated notes are ordered newest-first among THEMSELVES, undated notes are
 * kept together after them in their original relative order, and no dated note is
 * ever compared against an undated one. Nothing is dropped and nothing is dated
 * by inference. */
function W203_notesNewestFirst(list: Note[]): Note[] {
  const dated: Note[] = [];
  const undated: Note[] = [];
  for (const n of list) {
    if (typeof n.updatedAt === "string" && n.updatedAt.trim() !== "") dated.push(n);
    else undated.push(n);
  }
  dated.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...dated, ...undated];
}
/* WAVE 200 ITEM B — R173.9. A note's entry series. `body` above is the ORIGINAL
   text and never changes; each later addition arrives as an entry with its own
   author and date, so the owner can see the history rather than a replacement.
   The server derives a single entry for notes written before this wave. */
interface NoteEntry { seq: number; body: string; authorUserId: string; createdAt: string }
/* w-partner F10 — F1 added companyName to this response; without it the company
   picker would have shown opaque company ids. */
interface ClientRow { companyId: string; companyName: string | null }

/* The note scopes the server already accepts (partnerWorkspaceStore.ts:234).
   Only `client` has a picker today — the other entity scopes stay reachable via
   the API and are not offered here rather than being removed. */
const NOTE_SCOPES = [
  { value: "general", label: "General" },
  { value: "client", label: "Client" },
] as const;

export default function PartnerNotes() {
  const role = useRequirePartnerRole();
  /* w-partner F10 — list filter. Empty string = no filter (all scopes), which
     preserves the previous unfiltered default. */
  const [filterScope, setFilterScope] = useState("");
  const q = useQuery<{ notes: Note[] }>({
    queryKey: ["/api/partner/me/notes", filterScope],
    enabled: role.ready,
    queryFn: async () => {
      const qs = filterScope ? `?scope=${encodeURIComponent(filterScope)}` : "";
      return (await apiRequest("GET", `/api/partner/me/notes${qs}`)).json();
    },
  });
  /* Roster for the company picker; only fetched once a non-general scope is
     chosen so the default composer costs no extra request. */
  const [scope, setScope] = useState("general");
  const [scopeId, setScopeId] = useState("");
  const clientsQ = useQuery<{ clients: ClientRow[] }>({
    queryKey: ["/api/partner/me/clients"],
    enabled: role.ready && scope !== "general",
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/clients")).json(),
  });
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const canWrite = role.identity && ["managing_partner", "associate", "bd"].includes(role.identity.subRole);

  /* v25.12 NH7 — toast helper. */
  const { toast } = useToast();

  /* WAVE 200 ITEM B — R173.9.3. The delete route existed but no surface called
     it, so "the user should also have the option to delete/erase the note" was
     unreachable. The server soft-deletes and audits; this only asks. */
  const deleteMut = useMutation({
    mutationFn: async (noteId: string) => {
      const res = await apiRequest("DELETE", `/api/partner/me/notes/${noteId}`);
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/partner/me/notes"] }); },
    onError: (e: Error) => toast({ variant: "destructive", title: "Note delete failed", description: describeFailure(e, "write") }),
  });

  const createMut = useMutation({
    /* v25.33 — apiRequest() throws ApiError on non-2xx, so the former `if (!res.ok)`
       guard was unreachable dead code. The thrown ApiError reaches onError
       unchanged, preserving the "Note save failed" toast. */
    mutationFn: async () => {
      /* w-partner F10 — scopeId is sent ONLY for a non-general scope; a general
         note keeps the exact previous payload shape. */
      const payload: Record<string, unknown> = { title, body, scope };
      if (scope !== "general") payload.scopeId = scopeId;
      const res = await apiRequest("POST", "/api/partner/me/notes", payload);
      return res.json();
    },
    onSuccess: () => { setTitle(""); setBody(""); queryClient.invalidateQueries({ queryKey: ["/api/partner/me/notes"] }); },
    /* WAVE 197 #46 — WRITE. */
    onError: (e: Error) => toast({ variant: "destructive", title: "Note save failed", description: describeFailure(e, "write") }),
  });

  if (!role.ready || !role.identity) return null;
  return (
    <PartnerShell title="Notes" tier={role.identity.tier} subRole={role.identity.subRole} partnerName={role.identity.identity.name}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {canWrite && (
          <div className="bg-white p-4 rounded border" data-testid="note-editor">
            <Input data-testid="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" className="mb-2" />
            {/* w-partner F10 — scope this note. Defaults to general, which is the
                behaviour every existing note was created with. */}
            <div className="flex gap-2 mb-2">
              <select
                value={scope}
                onChange={(e) => { setScope(e.target.value); setScopeId(""); }}
                className="rounded-md border border-[var(--cv-color-border)] px-2 py-1 text-sm"
                data-testid="note-scope"
              >
                {NOTE_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {scope !== "general" && (
                <select
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  className="flex-1 rounded-md border border-[var(--cv-color-border)] px-2 py-1 text-sm"
                  data-testid="note-scope-id"
                >
                  <option value="">Select a company…</option>
                  {(clientsQ.data?.clients ?? []).map((c) => (
                    <option key={c.companyId} value={c.companyId}>{c.companyName || c.companyId}</option>
                  ))}
                </select>
              )}
            </div>
            <Textarea data-testid="note-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown content…" rows={6} />
            {/* v25.16 NH2 — prevent double-submit duplicates while mutation pending. */}
            <Button
              data-testid="note-save"
              className="mt-2"
              disabled={!title || !body || createMut.isPending || (scope !== "general" && !scopeId)}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
        <div className="bg-white p-4 rounded border" data-testid="notes-list">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs uppercase text-[var(--cv-color-text-muted)]">All notes</div>
            {/* w-partner F10 — scope filter over the server's existing GET params. */}
            <select
              value={filterScope}
              onChange={(e) => setFilterScope(e.target.value)}
              className="rounded-md border border-[var(--cv-color-border)] px-2 py-1 text-xs"
              data-testid="notes-scope-filter"
            >
              <option value="">All scopes</option>
              {NOTE_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          {/* v25.15 NM3 — explicit error branch (mirrors PartnerClients NM2). */}
          {q.isError && (
            <div
              className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900"
              data-testid="notes-error"
            >
              Could not load notes. Please refresh and try again.
            </div>
          )}
          {q.isLoading && <div className="text-xs text-[var(--cv-color-text-muted)]" data-testid="notes-loading">Loading…</div>}
          {!q.isLoading && !q.isError && (q.data?.notes ?? []).length === 0 && <div className="text-xs text-[var(--cv-color-text-muted)]">No notes yet.</div>}
          <ul className="space-y-2">
            {/* WAVE 203 · ITEM A — R178.5 ("Newest first.") applied to the second
                listing that had the same defect. `partnerNotesStore.listByPartner`
                (server/partnerWorkspaceStore.ts) filters and maps the stored notes
                and never orders them, so this list rendered in INSERTION order —
                oldest first. A partner's newest note was last on the page.
                Ordered here, in the component that renders it, so the ordering is
                provable by mounting this component. */}
            {W203_notesNewestFirst(q.data?.notes ?? []).map((n) => (
              <li key={n.id} className="border-b pb-2" data-testid={`note-${n.id}`}>
                <div className="text-sm font-medium">{n.title}</div>
                {/* v25.16 NM6 — guard against null updatedAt to avoid "Invalid Date". */}
                <div className="text-xs text-[var(--cv-color-text-muted)] mt-0.5">{n.scope} · {n.updatedAt ? new Date(n.updatedAt).toLocaleDateString() : "—"}</div>
                <div className="text-xs text-[var(--cv-color-text-secondary)] mt-1 whitespace-pre-wrap">{n.body}</div>
                {/* WAVE 200 ITEM B — R173.9.1/2. Appended, never substituted: the
                    original text stays above, later additions are listed below
                    with who added each and when. Entry 1 IS the original text
                    already shown, so only later entries are listed here. */}
                {(n.entries ?? []).filter((e) => e.seq > 1).length > 0 && (
                  <div className="mt-2 border-l-2 border-[var(--cv-color-border)] pl-2" data-testid={`note-history-${n.id}`}>
                    <div className="text-[10px] uppercase text-[var(--cv-color-text-muted)]">Added since</div>
                    {(n.entries ?? []).filter((e) => e.seq > 1).map((e) => (
                      <div key={e.seq} className="mt-1" data-testid={`note-entry-${n.id}-${e.seq}`}>
                        <div className="text-[10px] text-[var(--cv-color-text-muted)]">
                          {e.authorUserId} · {e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—"}
                        </div>
                        <div className="text-xs text-[var(--cv-color-text-secondary)] whitespace-pre-wrap">{e.body}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* WAVE 200 ITEM B — R173.9.3. Deletion is permitted; the server
                    records it. Offered only to the sub-roles the route accepts. */}
                {role.identity && ["managing_partner", "associate"].includes(role.identity.subRole) && (
                  <div className="mt-2">
                    <button
                      type="button"
                      data-testid={`note-delete-${n.id}`}
                      className="text-[10px] uppercase text-[var(--cv-color-text-muted)] underline"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(n.id)}
                    >
                      Delete note
                    </button>
                    <div className="text-[10px] text-[var(--cv-color-text-muted)]">Deleting a note is recorded in the audit log.</div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PartnerShell>
  );
}
