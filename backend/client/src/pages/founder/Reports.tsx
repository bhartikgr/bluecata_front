import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { StateBadge, EmptyState } from "@/components/common";
import { FileText, Plus, Send, Eye, Calendar, MessageSquare, Users, Mail } from "lucide-react";
import { fmtDate, fmtDateTime, fmtPct } from "@/lib/format";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Recipient = { investorId: string; openedAt: string; reads: number };
type Comment = { id: string; ts: string; actor: string; text: string; reactions: Record<string, number> };
type Section = { id: string; kind: string; title: string; body: string; comments: Comment[] };
type Report = {
  id: string; companyId: string; template: string; title: string; period: string;
  status: "draft" | "scheduled" | "sent"; sentAt: string | null;
  recipients: string[]; recipientsCount: number;
  metricsSnapshot: { raisedToDateUsd: number; capTableHolders: number; softCirclePipelineUsd: number; activeRounds: number };
  sections: Section[];
  readReceipts: Recipient[];
  schedule: { cron: string; cadence: string; nextSendAt: string; enabled: boolean } | null;
};

type CrmRow = { id: string; investorId: string; name: string; firmName: string; region: string; stage: string; series?: string };

const TEMPLATES = [
  { id: "monthly_kpi", label: "Monthly KPI" },
  { id: "quarterly_update", label: "Quarterly Update" },
  { id: "annual", label: "Annual Letter" },
  { id: "round_close", label: "Round Close" },
  { id: "adhoc", label: "Ad-hoc" },
];

const CADENCES = [
  { id: "monthly", label: "Monthly", cron: "0 9 1 * *" },
  { id: "quarterly", label: "Quarterly", cron: "0 9 1 */3 *" },
  { id: "annual", label: "Annual", cron: "0 9 1 1 *" },
];

export default function Reports() {
  const companyId = useActiveCompanyId();
  const { toast } = useToast();

  const meQ = useQuery<{ id: string; displayName: string }>({ queryKey: ["/api/auth/me"] });
  const reportsQ = useQuery<Report[]>({
    queryKey: ["/api/founder/reports2", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/reports2?companyId=${companyId}`)).json(),
  });
  const crmQ = useQuery<CrmRow[]>({
    queryKey: ["/api/founder/investor-crm", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${companyId}`)).json(),
  });

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [sendId, setSendId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);

  const reports = reportsQ.data ?? [];
  const crm = crmQ.data ?? [];

  const totalSent = reports.filter(r => r.status === "sent").length;
  const totalReads = reports.reduce((sum, r) => sum + r.readReceipts.reduce((s, rr) => s + rr.reads, 0), 0);
  const avgReadRate = reports.length === 0 ? 0
    : reports.filter(r => r.recipientsCount > 0).reduce((sum, r) => sum + (r.readReceipts.length / r.recipientsCount), 0) / Math.max(1, reports.filter(r => r.recipientsCount > 0).length);

  return (
    <>
      <PageHeader
        title="Investor reports"
        description="Templates, scheduling, recipient targeting, read receipts, and per-section comments."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Reports" }]}
        actions={<Link href="/founder/reports/new"><Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-new-report"><Plus className="h-4 w-4 mr-2" /> New report</Button></Link>}
      />
      <PageBody>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total reports</div><div className="text-xl font-semibold mt-1" data-testid="stat-reports-total">{reports.length}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Sent</div><div className="text-xl font-semibold mt-1" data-testid="stat-reports-sent">{totalSent}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total opens</div><div className="text-xl font-semibold mt-1" data-testid="stat-reports-reads">{totalReads}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Avg open rate</div><div className="text-xl font-semibold mt-1" data-testid="stat-reports-rate">{fmtPct(avgReadRate)}</div></CardContent></Card>
        </div>

        {reports.length === 0 ? (
          <EmptyState icon={FileText} title="No reports yet" description="Create your first investor update from a template." />
        ) : (
          <div className="grid gap-3">
            {reports.map(r => {
              const readRate = r.recipientsCount > 0 ? (r.readReceipts.length / r.recipientsCount) : 0;
              const tmpl = TEMPLATES.find(t => t.id === r.template)?.label ?? r.template;
              return (
                <Card key={r.id} data-testid={`card-report-${r.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="h-10 w-10 rounded bg-[hsl(219_45%_20%)] text-white flex items-center justify-center shrink-0">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{r.title}</span>
                          <StateBadge state={r.status} />
                          <Badge variant="outline" className="text-[10px]">{tmpl}</Badge>
                          <Badge variant="outline" className="text-[10px]">{r.period}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {r.sentAt ? `Sent ${fmtDate(r.sentAt)} to ${r.recipientsCount} recipients` : "Not sent yet"}
                          {r.schedule?.enabled && <> · Next: {fmtDate(r.schedule.nextSendAt)} ({r.schedule.cadence})</>}
                        </div>
                        {r.status === "sent" && (
                          <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                            <span>{r.readReceipts.length}/{r.recipientsCount} opened</span>
                            <span>·</span>
                            <span>{fmtPct(readRate)} open rate</span>
                            <span>·</span>
                            <span>{r.sections.reduce((s, sec) => s + sec.comments.length, 0)} comments</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setPreviewId(r.id)} data-testid={`button-preview-${r.id}`}><Eye className="h-3.5 w-3.5 mr-1" /> Preview</Button>
                        <Button size="sm" variant="ghost" onClick={() => setScheduleId(r.id)} data-testid={`button-schedule-${r.id}`}><Calendar className="h-3.5 w-3.5 mr-1" /> Schedule</Button>
                        {r.status !== "sent" && (
                          <Button size="sm" onClick={() => setSendId(r.id)} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid={`button-send-${r.id}`}><Send className="h-3.5 w-3.5 mr-1" /> Send</Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>

      {previewId && (
        <PreviewDialog
          report={reports.find(r => r.id === previewId)!}
          onClose={() => setPreviewId(null)}
        />
      )}
      {sendId && (
        <SendDialog
          report={reports.find(r => r.id === sendId)!}
          crm={crm}
          onClose={() => setSendId(null)}
          onSent={() => { setSendId(null); toast({ title: "Report sent" }); queryClient.invalidateQueries({ queryKey: ["/api/founder/reports2", companyId] }); }}
        />
      )}
      {scheduleId && (
        <ScheduleDialog
          report={reports.find(r => r.id === scheduleId)!}
          onClose={() => setScheduleId(null)}
          onSaved={() => { setScheduleId(null); toast({ title: "Schedule saved" }); queryClient.invalidateQueries({ queryKey: ["/api/founder/reports2", companyId] }); }}
        />
      )}
    </>
  );
}

function PreviewDialog({ report, onClose }: { report: Report; onClose: () => void }) {
  const companyId = useActiveCompanyId();
  const { toast } = useToast();
  const meQ = useQuery<{ id: string; displayName: string }>({ queryKey: ["/api/auth/me"] });
  const [activeSec, setActiveSec] = useState<string>(report.sections[0]?.id ?? "");
  const [draft, setDraft] = useState("");

  const commentMut = useMutation({
    mutationFn: async (vars: { sectionId: string; text: string }) => {
      // Patch v4: actor comes from session only; server resolves from auth if absent.
      const res = await apiRequest("POST", `/api/founder/reports2/${report.id}/comments`, { sectionId: vars.sectionId, text: vars.text, actor: meQ?.data?.id ?? "" });
      return res.json();
    },
    onSuccess: () => {
      setDraft("");
      toast({ title: "Comment added" });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/reports2", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/reports2"] });
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-report-title">{report.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{report.period}</Badge>
            <StateBadge state={report.status} />
            {report.sentAt && <span>Sent {fmtDateTime(report.sentAt)}</span>}
          </div>

          {report.metricsSnapshot && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-md bg-secondary/30 p-3 text-xs">
              <div><div className="text-muted-foreground">Raised to date</div><div className="font-semibold">${(report.metricsSnapshot.raisedToDateUsd / 1_000_000).toFixed(2)}M</div></div>
              <div><div className="text-muted-foreground">Cap-table holders</div><div className="font-semibold">{report.metricsSnapshot.capTableHolders}</div></div>
              <div><div className="text-muted-foreground">Soft-circle pipeline</div><div className="font-semibold">${(report.metricsSnapshot.softCirclePipelineUsd / 1_000_000).toFixed(2)}M</div></div>
              <div><div className="text-muted-foreground">Active rounds</div><div className="font-semibold">{report.metricsSnapshot.activeRounds}</div></div>
            </div>
          )}

          <div className="grid md:grid-cols-[180px_1fr] gap-4">
            <div className="space-y-1">
              {report.sections.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActiveSec(s.id)}
                  className={`w-full text-left rounded px-2 py-1.5 text-xs ${activeSec === s.id ? "bg-[hsl(184_98%_22%)] text-white" : "hover:bg-secondary"}`}
                  data-testid={`button-section-${s.kind}`}
                >
                  {s.title}
                  {s.comments.length > 0 && <span className="ml-1 text-[10px] opacity-70">({s.comments.length})</span>}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {report.sections.filter(s => s.id === activeSec).map(s => (
                <div key={s.id}>
                  <h3 className="font-semibold text-sm mb-2">{s.title}</h3>
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed bg-secondary/30 rounded p-3 font-sans">{s.body}</pre>

                  <div className="mt-4">
                    <div className="text-xs font-semibold mb-2 flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Comments ({s.comments.length})</div>
                    <div className="space-y-2">
                      {s.comments.map(c => (
                        <div key={c.id} className="text-xs bg-secondary/30 rounded p-2" data-testid={`comment-${c.id}`}>
                          <div className="flex justify-between text-muted-foreground"><span>{c.actor}</span><span>{fmtDateTime(c.ts)}</span></div>
                          <div className="mt-0.5">{c.text}</div>
                        </div>
                      ))}
                      {s.comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Textarea rows={2} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a comment…" data-testid="textarea-comment" />
                      <Button size="sm" disabled={!draft.trim() || commentMut.isPending} onClick={() => commentMut.mutate({ sectionId: s.id, text: draft })} data-testid="button-add-comment">Post</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {report.readReceipts.length > 0 && (
            <div>
              <div className="text-xs font-semibold mb-2 flex items-center gap-1"><Eye className="h-3 w-3" /> Read receipts ({report.readReceipts.length}/{report.recipientsCount})</div>
              <div className="space-y-1">
                {report.readReceipts.map(rr => (
                  <div key={rr.investorId} className="flex justify-between text-xs bg-secondary/30 rounded px-2 py-1" data-testid={`receipt-${rr.investorId}`}>
                    <span className="font-mono">{rr.investorId}</span>
                    <span className="text-muted-foreground">{rr.reads} read{rr.reads === 1 ? "" : "s"} · last {fmtDateTime(rr.openedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SendDialog({ report, crm, onClose, onSent }: { report: Report; crm: CrmRow[]; onClose: () => void; onSent: () => void }) {
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set(report.recipients.length > 0 ? report.recipients : crm.filter(c => c.stage === "invested").map(c => c.investorId)));

  const filtered = useMemo(() => crm.filter(c =>
    (stageFilter === "all" || c.stage === stageFilter) &&
    (regionFilter === "all" || c.region === regionFilter)
  ), [crm, stageFilter, regionFilter]);

  const toggleAll = () => {
    const allIds = filtered.map(c => c.investorId);
    const allSelected = allIds.every(id => selected.has(id));
    const next = new Set(selected);
    if (allSelected) allIds.forEach(id => next.delete(id));
    else allIds.forEach(id => next.add(id));
    setSelected(next);
  };

  const sendMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/founder/reports2/${report.id}/send`, { recipients: Array.from(selected) });
      return res.json();
    },
    onSuccess: onSent,
  });

  const regions = Array.from(new Set(crm.map(c => c.region))).sort();
  const stages = ["lead", "engaged", "soft_circle", "invested", "longterm"];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Send className="h-4 w-4" /> Send "{report.title}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Stage</Label>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger className="mt-1" data-testid="select-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {stages.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Region</Label>
              <Select value={regionFilter} onValueChange={setRegionFilter}>
                <SelectTrigger className="mt-1" data-testid="select-region"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All regions</SelectItem>
                  {regions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border">
            <div className="flex items-center justify-between px-3 py-2 border-b bg-secondary/20">
              <div className="text-xs font-semibold flex items-center gap-1"><Users className="h-3 w-3" /> {selected.size} selected · {filtered.length} matching</div>
              <Button size="sm" variant="ghost" onClick={toggleAll} data-testid="button-toggle-all">Toggle filtered</Button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {filtered.map(c => (
                <label key={c.investorId} className="flex items-center gap-3 px-3 py-2 hover:bg-secondary/30 cursor-pointer text-sm">
                  <Checkbox
                    checked={selected.has(c.investorId)}
                    onCheckedChange={(v) => {
                      const next = new Set(selected);
                      if (v) next.add(c.investorId); else next.delete(c.investorId);
                      setSelected(next);
                    }}
                    data-testid={`checkbox-recipient-${c.investorId}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.firmName} · {c.region} · {c.stage.replace("_", " ")}</div>
                  </div>
                </label>
              ))}
              {filtered.length === 0 && <div className="p-4 text-xs text-muted-foreground text-center">No investors match those filters.</div>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => sendMut.mutate()}
            disabled={selected.size === 0 || sendMut.isPending}
            className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
            data-testid="button-confirm-send"
          >
            <Mail className="h-3.5 w-3.5 mr-1" /> Send to {selected.size}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialog({ report, onClose, onSaved }: { report: Report; onClose: () => void; onSaved: () => void }) {
  const [cadence, setCadence] = useState(report.schedule?.cadence ?? "monthly");
  const [enabled, setEnabled] = useState(report.schedule?.enabled ?? true);

  const saveMut = useMutation({
    mutationFn: async () => {
      const c = CADENCES.find(x => x.id === cadence) ?? CADENCES[0];
      const res = await apiRequest("POST", `/api/founder/reports2/${report.id}/schedule`, { cron: c.cron, cadence: c.id, enabled });
      return res.json();
    },
    onSuccess: onSaved,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Schedule "{report.title}"</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Cadence</Label>
            <Select value={cadence} onValueChange={setCadence}>
              <SelectTrigger className="mt-1" data-testid="select-cadence"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CADENCES.map(c => <SelectItem key={c.id} value={c.id}>{c.label} ({c.cron})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(!!v)} data-testid="checkbox-enabled" />
            Auto-send enabled
          </label>
          {report.schedule?.nextSendAt && (
            <div className="text-xs text-muted-foreground">Currently next: {fmtDateTime(report.schedule.nextSendAt)}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-confirm-schedule">Save schedule</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
