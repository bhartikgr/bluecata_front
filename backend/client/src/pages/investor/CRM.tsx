/**
 * Sprint 21 Wave D — Investor CRM (rich port from founder side).
 *
 * Route: /investor/crm
 *
 * Stages: Cold / Met / Discussing / Following / Backed / Co-invested / Closed-no
 *
 * Features:
 *  - Stage-based grouping + filter chips (All / Starred / by-stage / by-tag)
 *  - Per-contact actions: Message, Add Note, Add Task, Star/Unstar, Edit, Delete, Move Stage
 *  - Bulk actions: multi-select → InvestorBroadcastDialog
 *  - Tags: attach/remove tags per contact
 *  - Notes: append-only dated timeline
 *  - Tasks: per-contact next-touch task list
 *  - CSV export (client-side, anchor download)
 *  - Realtime sync via investor_crm aggregate
 *  - Search: name + company client-side filter
 *  - PageHeader with breadcrumb
 *  - Loading skeleton + empty state
 */
import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRealtimeSync } from "@/lib/realtimeSync";
import { PageBody, PageHeader } from "@/components/AppShell";
import {
  Users, UserPlus, Download, Star, StarOff, Trash2, Tag,
  CheckCircle2, Mail, MessageSquare, Calendar, ChevronRight,
  Building2, Search, Megaphone, Plus, Filter,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtDateTime } from "@/lib/format";
import { InvestorBroadcastDialog } from "@/components/investor/InvestorBroadcastDialog";

/* ---------------------------------------------------------------- */
/* Types                                                            */
/* ---------------------------------------------------------------- */

export type InvestorCrmStage =
  | "cold"
  | "met"
  | "discussing"
  | "following"
  | "backed"
  | "co_invested"
  | "closed_no";

export type InvestorCrmContact = {
  id: string;
  /** Sprint 22 Wave 1: links CRM contact to a Capavate platform user for DM (DEF-001 fix). */
  platformUserId?: string;
  name: string;
  role: string;
  email: string;
  affiliation: string;
  stage: InvestorCrmStage;
  tags: string[];
  notes: string;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  tasks: Array<{ id: string; title: string; priority: "low" | "medium" | "high"; status: "todo" | "done"; dueDate?: string; createdAt: string; completedAt?: string }>;
  noteLog: Array<{ id: string; body: string; noteType: string; createdAt: string }>;
};

/* ---------------------------------------------------------------- */
/* Stage config                                                     */
/* ---------------------------------------------------------------- */

export const INVESTOR_STAGES: Array<{ key: InvestorCrmStage; label: string; tone: string }> = [
  { key: "cold",        label: "Cold",         tone: "bg-slate-100 text-slate-700" },
  { key: "met",         label: "Met",          tone: "bg-blue-100 text-blue-700" },
  { key: "discussing",  label: "Discussing",   tone: "bg-amber-100 text-amber-700" },
  { key: "following",   label: "Following",    tone: "bg-violet-100 text-violet-700" },
  { key: "backed",      label: "Backed",       tone: "bg-emerald-100 text-emerald-700" },
  { key: "co_invested", label: "Co-invested",  tone: "bg-cyan-100 text-cyan-700" },
  { key: "closed_no",   label: "Closed-no",    tone: "bg-zinc-200 text-zinc-600" },
];

const STAGE_MAP = Object.fromEntries(INVESTOR_STAGES.map((s) => [s.key, s])) as Record<InvestorCrmStage, typeof INVESTOR_STAGES[0]>;

/* ---------------------------------------------------------------- */
/* CSV export                                                       */
/* ---------------------------------------------------------------- */

function csvEscape(v: string): string {
  if (v == null) return "";
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function contactsToCsv(contacts: InvestorCrmContact[]): string {
  const header = ["id", "name", "role", "email", "affiliation", "stage", "tags", "starred", "notes"];
  const rows = contacts.map((c) => [
    c.id, c.name, c.role ?? "", c.email ?? "", c.affiliation ?? "",
    c.stage, (c.tags ?? []).join("|"), String(c.starred ?? false), c.notes ?? "",
  ].map(String).map(csvEscape).join(","));
  return [header.join(","), ...rows].join("\n");
}

/* ---------------------------------------------------------------- */
/* Edit-contact dialog                                              */
/* ---------------------------------------------------------------- */

function EditContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: InvestorCrmContact;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: contact.name,
    role: contact.role ?? "",
    email: contact.email ?? "",
    affiliation: contact.affiliation ?? "",
    stage: contact.stage,
  });
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);

  const m = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/investor/crm/${contact.id}`, { ...form, tags });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
      toast({ title: "Contact updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Update failed", description: err.message }),
  });

  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-edit-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Role / Title</Label>
              <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="input-edit-role" />
            </div>
            <div>
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v as InvestorCrmStage })}>
                <SelectTrigger data-testid="select-edit-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVESTOR_STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Primary Affiliation (company / fund)</Label>
            <Input value={form.affiliation} onChange={(e) => setForm({ ...form, affiliation: e.target.value })} data-testid="input-edit-affiliation" />
          </div>
          <div>
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-edit-email" />
          </div>
          <div>
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                placeholder="Type and Enter"
                data-testid="input-edit-tag"
              />
              <Button type="button" variant="outline" onClick={addTag}>Add</Button>
            </div>
            {!!tags.length && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((t) => (
                  <Badge
                    key={t}
                    variant="secondary"
                    className="cursor-pointer"
                    onClick={() => setTags(tags.filter((x) => x !== t))}
                  >
                    {t} ×
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => m.mutate()}
            disabled={m.isPending || !form.name.trim()}
            className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)]"
            data-testid="button-save-edit"
          >
            {m.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- */
/* Add Note dialog                                                  */
/* ---------------------------------------------------------------- */

function AddNoteDialog({
  contactId,
  open,
  onOpenChange,
}: {
  contactId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [noteType, setNoteType] = useState("call");

  const m = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/investor/crm/${contactId}/notes`, { body, noteType });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
      toast({ title: "Note added" });
      setBody("");
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed", description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add note</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Type</Label>
            <Select value={noteType} onValueChange={setNoteType}>
              <SelectTrigger data-testid="select-note-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="message">Message</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note</Label>
            <Textarea
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What did you discuss?"
              data-testid="textarea-note-body"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => m.mutate()}
            disabled={!body.trim() || m.isPending}
            className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)]"
            data-testid="button-save-note"
          >
            {m.isPending ? "Saving…" : "Save note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- */
/* Add Task dialog                                                  */
/* ---------------------------------------------------------------- */

function AddTaskDialog({
  contactId,
  open,
  onOpenChange,
}: {
  contactId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [dueDate, setDueDate] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/investor/crm/${contactId}/tasks`, { title, priority, dueDate: dueDate || undefined });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
      toast({ title: "Task added" });
      setTitle(""); setDueDate("");
      onOpenChange(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Failed", description: err.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Task</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Next step?"
              data-testid="input-task-title"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as "low" | "medium" | "high")}>
                <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Due date (optional)</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-task-due" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => m.mutate()}
            disabled={!title.trim() || m.isPending}
            className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)]"
            data-testid="button-save-task"
          >
            {m.isPending ? "Saving…" : "Add task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- */
/* Contact detail panel                                             */
/* ---------------------------------------------------------------- */

function ContactDetailPanel({ contact, onClose }: { contact: InvestorCrmContact; onClose: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const starMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/investor/crm/${contact.id}`, { starred: !contact.starred });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/investor/crm/${contact.id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
      toast({ title: "Contact removed" });
      onClose();
    },
  });

  const moveStage = useMutation({
    mutationFn: async (stage: InvestorCrmStage) => {
      const res = await apiRequest("PATCH", `/api/investor/crm/${contact.id}`, { stage });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
      toast({ title: "Stage updated" });
    },
  });

  const completeTask = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await apiRequest("PATCH", `/api/investor/crm/${contact.id}/tasks/${taskId}`, { status: "done" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/investor/crm"] });
      toast({ title: "Task complete" });
    },
  });

  const stageInfo = STAGE_MAP[contact.stage];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle data-testid={`text-contact-name-${contact.id}`}>{contact.name}</CardTitle>
                <button onClick={() => starMut.mutate()} data-testid={`button-star-${contact.id}`} className="text-amber-400 hover:text-amber-500">
                  {contact.starred ? <Star className="w-4 h-4 fill-current" /> : <StarOff className="w-4 h-4" />}
                </button>
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                <Building2 className="w-3.5 h-3.5" />
                {contact.affiliation ?? "Independent"} · {contact.role ?? "—"}
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${stageInfo?.tone ?? ""}`}>
                  {stageInfo?.label ?? contact.stage}
                </span>
                {(contact.tags ?? []).map((t) => (
                  <Badge key={t} variant="secondary" className="text-xs"><Tag className="w-3 h-3 mr-1" />{t}</Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Sprint 22 Wave 1 — DEF-001 fix: use platformUserId for DM; disable if not linked. */}
              <Button
                size="sm"
                variant="default"
                className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white disabled:opacity-50"
                onClick={() => contact.platformUserId && navigate(`/investor/messages?targetUserId=${encodeURIComponent(contact.platformUserId)}`)}
                disabled={!contact.platformUserId}
                title={contact.platformUserId ? undefined : "No platform account linked"}
                data-testid={`button-message-${contact.id}`}
              >
                <MessageSquare className="w-3.5 h-3.5 mr-1" /> Message
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} data-testid={`button-edit-${contact.id}`}>Edit</Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => deleteMut.mutate()}
                data-testid={`button-delete-${contact.id}`}
                className="text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm pt-0">
          <div className="flex items-center gap-4 flex-wrap">
            {contact.email && (
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <a className="text-[hsl(184_98%_22%)] hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Move stage:</Label>
            <Select value={contact.stage} onValueChange={(v) => moveStage.mutate(v as InvestorCrmStage)}>
              <SelectTrigger className="w-40 h-7 text-xs" data-testid={`select-stage-${contact.id}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVESTOR_STAGES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="notes">
        <TabsList>
          <TabsTrigger value="notes" data-testid="tab-notes">Notes</TabsTrigger>
          <TabsTrigger value="tasks" data-testid="tab-tasks">Tasks</TabsTrigger>
        </TabsList>

        <TabsContent value="notes" className="space-y-3 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNoteOpen(true)}
            data-testid={`button-add-note-${contact.id}`}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add note
          </Button>
          <div className="space-y-2">
            {(contact.noteLog ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground p-3">No notes yet.</div>
            )}
            {(contact.noteLog ?? []).map((n) => (
              <Card key={n.id} data-testid={`card-note-${n.id}`}>
                <CardContent className="pt-4 text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-[10px] uppercase">{n.noteType}</Badge>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(n.createdAt)}</span>
                  </div>
                  <div className="whitespace-pre-wrap">{n.body}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-3 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTaskOpen(true)}
            data-testid={`button-add-task-${contact.id}`}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add task
          </Button>
          <div className="space-y-2">
            {(contact.tasks ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground p-3">No tasks yet.</div>
            )}
            {(contact.tasks ?? []).map((t) => (
              <Card key={t.id} data-testid={`card-task-${t.id}`}>
                <CardContent className="pt-4 flex items-center justify-between gap-3">
                  <div>
                    <div className={`text-sm ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                      <Badge variant={t.priority === "high" ? "destructive" : "outline"} className="text-[10px]">{t.priority}</Badge>
                      {t.dueDate && <span><Calendar className="w-3 h-3 inline mr-1" />{t.dueDate}</span>}
                      {t.completedAt && <span>· done {fmtDateTime(t.completedAt)}</span>}
                    </div>
                  </div>
                  {t.status !== "done" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => completeTask.mutate(t.id)}
                      data-testid={`button-complete-task-${t.id}`}
                    >
                      <CheckCircle2 className="w-4 h-4 mr-1" /> Complete
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {editOpen && <EditContactDialog contact={contact} open={editOpen} onOpenChange={setEditOpen} />}
      <AddNoteDialog contactId={contact.id} open={noteOpen} onOpenChange={setNoteOpen} />
      <AddTaskDialog contactId={contact.id} open={taskOpen} onOpenChange={setTaskOpen} />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Loading skeleton                                                 */
/* ---------------------------------------------------------------- */

function CrmSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4 flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-8 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Page                                                             */
/* ---------------------------------------------------------------- */

export default function InvestorCRM() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [activeChip, setActiveChip] = useState<"all" | "starred" | InvestorCrmStage>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastInitialIds, setBroadcastInitialIds] = useState<Set<string>>(new Set());

  // Realtime SSE invalidation for investor_crm aggregate
  useRealtimeSync();

  // Patch v4: CRM list comes strictly from /api/investor/crm/contacts.
  // If the API returns an empty list, the page shows an empty state —
  // no hardcoded persona fallbacks ship in the client bundle.
  const listQ = useQuery<InvestorCrmContact[]>({
    queryKey: ["/api/investor/crm/contacts"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/investor/crm/contacts");
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
  });

  const contacts: InvestorCrmContact[] = Array.isArray(listQ.data) ? listQ.data : [];

  // Filter logic
  const filtered = useMemo(() => {
    let out = contacts.slice();

    // Chip filters
    if (activeChip === "starred") {
      out = out.filter((c) => c.starred);
    } else if (activeChip !== "all") {
      out = out.filter((c) => c.stage === activeChip);
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.affiliation ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }

    return out;
  }, [contacts, activeChip, search]);

  const selected = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? filtered[0] ?? null,
    [contacts, selectedId, filtered],
  );

  // Stage counts for chips
  const stageCounts = useMemo(() => {
    const m: Record<string, number> = { all: contacts.length, starred: 0 };
    for (const c of contacts) {
      m[c.stage] = (m[c.stage] ?? 0) + 1;
      if (c.starred) m.starred++;
    }
    return m;
  }, [contacts]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function exportCsv() {
    const csv = contactsToCsv(contacts);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `capavate-investor-crm-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported", description: `${contacts.length} contacts.` });
  }

  const chips: Array<{ key: "all" | "starred" | InvestorCrmStage; label: string }> = [
    { key: "all", label: "All" },
    { key: "starred", label: "Starred" },
    ...INVESTOR_STAGES.map((s) => ({ key: s.key as InvestorCrmStage, label: s.label })),
  ];

  return (
    <>
      <PageHeader
        title="CRM"
        description="Founders, co-investors, advisors — track every relationship."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "CRM" }]}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={exportCsv} disabled={!contacts.length} data-testid="button-export">
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => { setBroadcastInitialIds(selectedIds.size > 0 ? new Set(selectedIds) : new Set()); setBroadcastOpen(true); }}
              data-testid="button-broadcast"
            >
              <Megaphone className="w-4 h-4 mr-1" /> Broadcast
            </Button>
            <Link href="/investor/crm/new">
              <Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-add-contact">
                <UserPlus className="w-4 h-4 mr-1" /> Add contact
              </Button>
            </Link>
          </div>
        }
      />
      <PageBody>
        {/* Search + filter bar */}
        <Card className="mb-4">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, company, email, tag…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border-0 shadow-none focus-visible:ring-0 px-0 h-8"
                data-testid="input-search"
              />
            </div>
            <Filter className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>

        {/* Filter chips */}
        <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="filter-chips">
          {chips.map((chip) => {
            const active = activeChip === chip.key;
            const count = stageCounts[chip.key] ?? 0;
            return (
              <button
                key={chip.key}
                onClick={() => setActiveChip(chip.key)}
                data-testid={`chip-${chip.key}`}
                className={`text-xs px-3 py-1.5 rounded-full border transition ${
                  active
                    ? "bg-[hsl(184_98%_22%)] text-white border-[hsl(184_98%_22%)]"
                    : "bg-card text-foreground border-border hover:border-[hsl(184_98%_22%)]/40"
                }`}
              >
                {chip.label}
                <span className={`ml-1.5 ${active ? "text-white/80" : "text-muted-foreground"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <Card className="mb-4 border-[hsl(184_98%_22%)]/40 bg-[hsl(184_98%_22%)]/5" data-testid="bulk-actions-bar">
            <CardContent className="p-3 flex items-center justify-between">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">
                  Clear
                </Button>
                <Button
                  size="sm"
                  onClick={() => { setBroadcastInitialIds(new Set(selectedIds)); setBroadcastOpen(true); }}
                  data-testid="button-bulk-message"
                >
                  <MessageSquare className="h-3.5 w-3.5 mr-1" /> Bulk message
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main content */}
        {listQ.isLoading ? (
          <CrmSkeleton />
        ) : contacts.length === 0 ? (
          /* Empty state */
          <Card>
            <CardContent className="py-16 text-center space-y-4">
              <Users className="w-10 h-10 mx-auto text-muted-foreground" />
              <div>
                <div className="text-base font-medium">No contacts yet</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Start building your investor network.
                </div>
              </div>
              <Link href="/investor/crm/new">
                <Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-empty-add">
                  <UserPlus className="w-4 h-4 mr-1" /> Add contact
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Contact list */}
            <Card className="md:col-span-1">
              <CardContent className="pt-4 max-h-[680px] overflow-y-auto space-y-1">
                {filtered.length === 0 && (
                  <div className="text-sm text-muted-foreground p-4 text-center">
                    No contacts match the current filter.
                  </div>
                )}
                {filtered.map((c) => {
                  const stageInfo = STAGE_MAP[c.stage];
                  const checked = selectedIds.has(c.id);
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center gap-2 p-3 rounded-md border transition-colors cursor-pointer ${
                        selected?.id === c.id
                          ? "border-[hsl(184_98%_22%)] bg-[hsl(184_98%_22%)]/5"
                          : "border-transparent hover:bg-slate-50"
                      }`}
                      data-testid={`row-contact-${c.id}`}
                      onClick={() => { setSelectedId(c.id); }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => { e.stopPropagation(); toggleSelect(c.id); }}
                        className="h-4 w-4 shrink-0"
                        data-testid={`checkbox-${c.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <div className="font-medium text-sm truncate">{c.name}</div>
                          {c.starred && <Star className="w-3 h-3 text-amber-400 fill-current shrink-0" />}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">{c.affiliation ?? c.role ?? "—"}</div>
                        <div className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${stageInfo?.tone ?? ""}`}>
                          {stageInfo?.label ?? c.stage}
                        </div>
                        {(c.tags ?? []).slice(0, 2).map((t) => (
                          <Badge key={t} variant="secondary" className="text-[10px] ml-1">{t}</Badge>
                        ))}
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Detail panel */}
            <div className="md:col-span-2">
              {selected ? (
                <ContactDetailPanel contact={selected} onClose={() => setSelectedId(null)} />
              ) : (
                <Card>
                  <CardContent className="pt-12 pb-12 text-center text-sm text-muted-foreground">
                    Select a contact to view details.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Broadcast dialog */}
        <InvestorBroadcastDialog
          open={broadcastOpen}
          onOpenChange={(o) => { setBroadcastOpen(o); if (!o) setBroadcastInitialIds(new Set()); }}
          contacts={filtered}
          initialIds={broadcastInitialIds}
        />
      </PageBody>
    </>
  );
}
