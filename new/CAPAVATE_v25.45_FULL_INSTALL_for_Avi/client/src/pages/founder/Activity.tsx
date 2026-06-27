import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Activity as ActivityIcon, Download, Search, Shield } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

type ActivityRow = { id: string; ts: string; actor: string; action: string; target: string; threadId?: string; postId?: string };

/**
 * v23.4.5 Phase 8 — actor display formatting.
 *
 * Audit-log rows store the actor as the raw user id (`usr_abc123…`). The
 * Activity Log UI used to render that id verbatim (QA #26). We now:
 *   1. If the actor matches the signed-in user, use their display name.
 *   2. Else if it has the `usr_` prefix, shorten to `User abc12345` so the
 *      column is readable and still identifies the user uniquely enough for
 *      audit correlation.
 *   3. Else (legacy demo seed rows like “Maya Chen”) pass through.
 */
function formatActor(actor: string, selfId: string | null, selfName: string | null): string {
  if (!actor) return "";
  if (selfId && actor === selfId) return selfName ?? "You";
  if (actor.startsWith("usr_")) {
    const tail = actor.slice(4, 12); // 8 chars is plenty for human recognition
    return `User ${tail}`;
  }
  return actor;
}

type MeShape = { isAuthed?: boolean; userId?: string | null; identity?: { name?: string | null; displayName?: string | null } | null; name?: string | null };

// ----- Wave B FIX 7 (F-BUG-014) -----
// Real /api/activity rows return canonical dot-notation eventTypes
// (e.g. "round.created", "legal_consent.recorded", "partner.application.submitted",
// "network.post.created", "dataroom.uploaded", "captable.edited", "report.sent").
// The previous classifier only matched English verbs in legacy demo seed
// strings, so every real production audit row fell through to "Other" —
// QA flagged this as F-BUG-014. We now map by canonical prefix FIRST,
// then fall back to substring matching for legacy seed rows.
function classifyAction(action: string): string {
  const a = (action ?? "").toLowerCase();

  // 1) Canonical dot-prefix routing (real audit eventTypes).
  const prefix = a.split(".", 1)[0] ?? "";
  switch (prefix) {
    case "dataroom":
    case "document":
    case "file":
      return "dataroom";
    case "round":
    case "invitation":
    case "softcircle":
    case "soft_circle":
    case "commit":
      return "round";
    case "crm":
    case "contact":
    case "broadcast":
    case "message":
    case "messaging":
      return "crm";
    case "captable":
    case "cap_table":
    case "position":
    case "share":
    case "shares":
    case "ledger":
      return "captable";
    case "report":
    case "update":
    case "network":
    case "post":
      return "report";
  }

  // 2) Legacy substring fallback for demo seed strings.
  if (a.includes("upload") || a.includes("download") || a.includes("view")) return "dataroom";
  if (a.includes("soft-circled") || a.includes("commit") || a.includes("invest")) return "round";
  if (a.includes("invit") || a.includes("crm") || a.includes("broadcast")) return "crm";
  if (a.includes("edit") || a.includes("cap")) return "captable";
  if (a.includes("report") || a.includes("send")) return "report";
  return "other";
}

/** Sprint 19 J — return a navigation href for message/post activity items, or null. */
function activityLink(row: ActivityRow): string | null {
  const a = row.action.toLowerCase();
  if (a.includes("message") || a.includes("sent message")) {
    if (row.threadId) return `/founder/messages?thread=${row.threadId}`;
    return `/founder/messages`;
  }
  if (a.includes("post")) {
    if (row.postId) return `/founder/posts/${row.postId}`;
    return `/founder/network-posts`;
  }
  return null;
}

const TYPE_LABEL: Record<string, string> = {
  all: "All types",
  dataroom: "Dataroom",
  round: "Round",
  crm: "CRM",
  captable: "Cap-table",
  report: "Reports",
  other: "Other",
};

export default function ActivityPage() {
  const companyId = useActiveCompanyId();
  const a = useQuery<ActivityRow[]>({
    queryKey: ["/api/activity", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/activity?companyId=${companyId}`)).json(),
  });
  // v23.4.5 Phase 8 — resolve the caller’s own id→name so the “You did X”
  // row reads naturally instead of “usr_abc123 did X”.
  const meQ = useQuery<MeShape>({ queryKey: ["/api/auth/me"] });
  const selfId = meQ.data?.userId ?? null;
  const selfName =
    meQ.data?.identity?.displayName ?? meQ.data?.identity?.name ?? meQ.data?.name ?? null;

  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("all");
  const [actorF, setActorF] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Sprint 18 Phase 2 — T10.1 Load-more pagination (50/page).
  const PAGE_SIZE = 50;
  const [pageCount, setPageCount] = useState(1);

  // Wave G HOTFIX (E2E founder.activity-log-tenant-isolation) — exclude
  // platform-compliance audit rows from the founder-facing Activity Log UI.
  // `legal_consent.recorded` events are written under `tenant_platform` for
  // every signup (one per accepted document, so the 2-doc "terms + privacy"
  // bundle yields 2 rows). The server-side `/api/activity` correctly returns
  // these rows (the user IS allowed to see their OWN platform-tenant events;
  // server tenant-isolation vitest coverage in `activityLogTenantIsolation`
  // and `activityLogStrictTenantIsolation` continue to require this), but
  // the founder Activity Log UI is the audit ledger of actions taken on
  // company resources — consent acceptance is surfaced separately via the
  // Legal & Privacy drawer and `/api/legal/consent/mine` (Settings page).
  // Hiding these compliance-only events from this view is purely cosmetic;
  // the rows remain in the underlying ledger, the admin Activity view, and
  // the user's own consent receipts page. This restores the pre-Wave-G UX
  // where a brand-new founder's Activity Log is empty until they actually
  // do something on their cap table.
  const rows = useMemo(
    () => (a.data ?? []).filter(r => r.action !== "legal_consent.recorded"),
    [a.data],
  );

  // Display names for the actor filter dropdown (raw id remains the option value).
  const actors = useMemo(
    () => Array.from(new Set(rows.map((r) => r.actor))).sort(),
    [rows],
  );

  const filtered = useMemo(() => rows.filter(r => {
    if (typeF !== "all" && classifyAction(r.action) !== typeF) return false;
    if (actorF !== "all" && r.actor !== actorF) return false;
    if (from && r.ts < from) return false;
    if (to && r.ts > to + "T23:59:59Z") return false;
    if (q) {
      const needle = q.toLowerCase();
      const actorDisplay = formatActor(r.actor, selfId, selfName).toLowerCase();
      if (
        !r.actor.toLowerCase().includes(needle) &&
        !actorDisplay.includes(needle) &&
        !r.action.toLowerCase().includes(needle) &&
        !r.target.toLowerCase().includes(needle)
      ) return false;
    }
    return true;
  }), [rows, q, typeF, actorF, from, to, selfId, selfName]);

  // Reset visible window when filters change.
  useEffect(() => { setPageCount(1); }, [q, typeF, actorF, from, to]);
  const visibleCount = pageCount * PAGE_SIZE;
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  function exportCSV() {
    const header = ["id", "timestamp", "actor", "action", "target", "type"];
    const lines = [header.join(",")].concat(
      // CSV export keeps the raw actor id so audit correlation is still possible.
      filtered.map(r => [r.id, r.ts, `"${r.actor.replace(/"/g, '""')}"`, `"${r.action.replace(/"/g, '""')}"`, `"${r.target.replace(/"/g, '""')}"`, classifyAction(r.action)].join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Activity log"
        description="Append-only audit ledger. Hash-chained per R165 §12 in production."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Activity" }]}
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" onClick={exportCSV} data-testid="button-export-csv">
              <Download className="h-4 w-4 mr-2" /> Export CSV ({filtered.length})
            </Button>
            <span className="text-[10px] text-muted-foreground">Export reflects current filtered view only</span>
          </div>
        }
      />
      <PageBody>
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="grid md:grid-cols-5 gap-3">
              <div className="md:col-span-2">
                <Label className="text-xs">Search</Label>
                <div className="relative mt-1">
                  <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Actor, action, or target…" className="pl-8" data-testid="input-search" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={typeF} onValueChange={setTypeF}>
                  <SelectTrigger className="mt-1" data-testid="select-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Actor</Label>
                <Select value={actorF} onValueChange={setActorF}>
                  <SelectTrigger className="mt-1" data-testid="select-actor"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All actors</SelectItem>
                    {actors.map(actor => <SelectItem key={actor} value={actor}>{formatActor(actor, selfId, selfName)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1" data-testid="input-from" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1" data-testid="input-to" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <Shield className="h-3 w-3 text-[hsl(0_100%_40%)]" />
              <span data-testid="text-activity-count">
                Showing {visible.length} of {filtered.length} matching entries (total {rows.length}) · audit-grade hash-chained ledger
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border" data-testid="list-activity">
              {visible.map(x => {
                const type = classifyAction(x.action);
                return (
                  <li key={x.id} className={`px-5 py-3 flex items-start gap-3 ${activityLink(x) ? "hover:bg-secondary/40 cursor-pointer" : ""}`} data-testid={`row-activity-${x.id}`}>
                    <div className="mt-1 h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <ActivityIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Sprint 19 J — make message/post activity rows clickable */}
                        {activityLink(x) ? (
                          <Link href={activityLink(x)!} className="text-sm hover:underline">
                            <span className="font-medium">{formatActor(x.actor, selfId, selfName)}</span>{" "}
                            <span className="text-muted-foreground">{x.action}</span>{" "}
                            <span className="font-medium">{x.target}</span>
                          </Link>
                        ) : (
                          <span className="text-sm">
                            <span className="font-medium">{formatActor(x.actor, selfId, selfName)}</span>{" "}
                            <span className="text-muted-foreground">{x.action}</span>{" "}
                            <span className="font-medium">{x.target}</span>
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[type]}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">{fmtDateTime(x.ts)} · {x.id}</div>
                    </div>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">No activity matches those filters.</li>}
            </ul>
            {hasMore && (
              <div className="px-5 py-3 border-t border-border flex items-center justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPageCount((p) => p + 1)}
                  data-testid="button-load-more"
                >
                  Load 50 more ({filtered.length - visibleCount} remaining)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
