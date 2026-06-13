/**
 * Foundation Build — Partner Tasks page.
 * List/board/calendar view toggles. Reads /api/partner/me/tasks. Viewer cannot create.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
/* v25.12 NH9 — toast task-creation failures. */
import { useToast } from "@/hooks/use-toast";

type PartnerTask = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done";
  dueDate?: string | null;
  assigneeUserId?: string | null;
};

export default function PartnerTasks() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "board" | "calendar">("list");
  const [newTitle, setNewTitle] = useState("");

  const { data, isLoading, isError } = useQuery<{ tasks: PartnerTask[] }>({
    /* v25.12 NL1 — explicit queryFn for robustness. */
    /* v25.15 NM4 — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/tasks"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/tasks")).json(),
  });

  /* v25.12 NH9 — toast helper. */
  const { toast } = useToast();

  const createTask = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("POST", "/api/partner/me/tasks", { title });
      /* v25.23 NM — check res.ok so a non-2xx response surfaces as an error
         instead of clearing the input + invalidating the list as a false success. */
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string; message?: string }));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/tasks"] });
      setNewTitle("");
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Could not create task", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole !== "viewer";
  const tasks = data?.tasks ?? [];

  return (
    <PartnerShell title="Tasks" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          {(["list", "board", "calendar"] as const).map((v) => (
            <Button
              key={v}
              variant={view === v ? "default" : "outline"}
              size="sm"
              data-testid={`partner-tasks-view-${v}`}
              onClick={() => setView(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </Button>
          ))}
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Input
              placeholder="New task title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              data-testid="partner-tasks-new-input"
              className="w-64"
            />
            <Button
              disabled={!newTitle.trim() || createTask.isPending}
              onClick={() => createTask.mutate(newTitle)}
              data-testid="partner-tasks-new-button"
            >
              Add Task
            </Button>
          </div>
        )}
      </div>

      {isLoading && <div className="text-sm text-slate-500" data-testid="tasks-loading">Loading…</div>}
      {/* v25.15 NM4 — explicit error branch. */}
      {isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="tasks-error"
        >
          Could not load tasks. Please refresh and try again.
        </div>
      )}
      {!isLoading && !isError && tasks.length === 0 && (
        <PartnerEmptyState
          title="No tasks yet"
          description="Add a task to begin tracking your work."
        />
      )}

      {tasks.length > 0 && view === "list" && (
        <div className="space-y-2" data-testid="partner-tasks-list">
          {tasks.map((t) => (
            <Card key={t.id} className="p-3 flex justify-between items-center" data-testid={`partner-task-${t.id}`}>
              <div>
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-slate-500">{t.status}{t.dueDate ? ` · due ${t.dueDate}` : ""}</div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tasks.length > 0 && view === "board" && (
        <div className="grid grid-cols-3 gap-4" data-testid="partner-tasks-board">
          {(["open", "in_progress", "done"] as const).map((col) => (
            <div key={col} className="bg-slate-50 p-3 rounded">
              <div className="font-medium mb-2 capitalize">{col.replace("_", " ")}</div>
              {tasks.filter((t) => t.status === col).map((t) => (
                <Card key={t.id} className="p-2 mb-2 text-sm" data-testid={`partner-task-board-${t.id}`}>
                  {t.title}
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      {tasks.length > 0 && view === "calendar" && (
        <div data-testid="partner-tasks-calendar" className="text-sm text-slate-600">
          Calendar view — tasks grouped by due date.
          {tasks.filter((t) => t.dueDate).map((t) => (
            <div key={t.id} className="border-b py-2">
              <span className="font-mono text-xs mr-2">{t.dueDate}</span>{t.title}
            </div>
          ))}
        </div>
      )}
    </PartnerShell>
  );
}
