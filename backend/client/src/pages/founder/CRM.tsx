import { asArray } from "@/lib/safeArray";
/**
 * Sprint 11 Phase 2 — Founder Investor CRM rebuild.
 *
 * Pipeline: Lead → Engaged → Soft-Circle → Invested → Long-term partner
 *
 * Features:
 *  - Drag-free kanban (stage column buttons; click to move)
 *  - Per-investor card: ownership, soft-circle history count, M&A signal count, threads count
 *  - Bulk message + segmented broadcast (stage / region / series)
 *  - Notes + tasks editing
 *  - Read-only data path: GET /api/founder/investor-crm?companyId=...
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Search, Mail, Send, MessageSquare, ArrowUpRight, Megaphone, ChevronRight, Filter, Users, Network, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtUSD, fmtPct, timeAgo } from "@/lib/format";
import { REGIONS_ALL, type Region9 } from "@/lib/regions";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { WarmIntroModal } from "@/components/WarmIntroModal";
import { AutoTierBadge } from "@/components/AutoTierBadge";
import { computeAutoTier } from "@shared/crmStages";

// Sprint 14 D3 — founder pipeline becomes 7 stages.
type Stage = "lead" | "engaged" | "soft_circle" | "committed" | "signing" | "invested" | "longterm";

const STAGES: Array<{ key: Stage; label: string; tone: string }> = [
  { key: "lead",         label: "Lead",                tone: "bg-zinc-100 text-zinc-700" },
  { key: "engaged",      label: "Engaged",             tone: "bg-amber-100 text-amber-700" },
  { key: "soft_circle",  label: "Soft-Circle",         tone: "bg-cyan-100 text-cyan-700" },
  { key: "committed",    label: "Committed",           tone: "bg-violet-100 text-violet-700" },
  { key: "signing",      label: "Signing",             tone: "bg-blue-100 text-blue-700" },
  { key: "invested",     label: "Invested",            tone: "bg-emerald-100 text-emerald-700" },
  { key: "longterm",     label: "Long-term Partner",   tone: "bg-[hsl(184_98%_22%)]/10 text-[hsl(184_98%_22%)]" },
];

type CrmContact = {
  id: string;
  companyId: string;
  investorId: string;
  name: string;
  firmName: string;
  email: string;
  region: string;
  stage: Stage;
  ownership: { sharesUsd: number; pct: number };
  softCircleHistory: Array<{ ts: string; amountUsd: number; type: string }>;
  maSignals: number;
  threadIds: string[];
  notes: string;
  notesUpdatedAt: string;
  tasks: Array<{ id: string; text: string; due: string; status: "open" | "done" }>;
  series: string;
};

export default function FounderInvestorCRM() {
  const { toast } = useToast();
  const companyId = useActiveCompanyId();
  const [filterStage, setFilterStage] = useState<Stage | "all">("all");
  const [filterRegion, setFilterRegion] = useState<Region9 | "all">("all");
  const [search, setSearch] = useState("");
  // Sprint 18 Phase 2 — T6.2 pre-filtered quick chips.
  type QuickChip = "all" | "high_value" | "soft_circled" | "inactive_90d" | "series_a" | "strategic_intro";
  const [activeChip, setActiveChip] = useState<QuickChip>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CrmContact | null>(null);
  const [bcOpen, setBcOpen] = useState(false);
  const [bcStage, setBcStage] = useState<Stage | "all">("all");
  const [bcRegion, setBcRegion] = useState<string>("all");
  const [bcSeries, setBcSeries] = useState("");
  const [bcMsg, setBcMsg] = useState("");
  // Defect 39 — when opened from "Bulk message", pre-populate with selected contact IDs.
  const [bcInitialIds, setBcInitialIds] = useState<Set<string>>(new Set());
  const [warmIntroOpen, setWarmIntroOpen] = useState(false);
  const [warmIntroTarget, setWarmIntroTarget] = useState<{ id: string; name: string } | null>(null);

  const contactsQ = useQuery<CrmContact[]>({
    queryKey: ["/api/founder/investor-crm", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${companyId}`)).json(),
  });

  // Sprint 18 Phase 2 — T6.1 enrich each contact with insight markers used by chips.
  const enrichedContacts = useMemo(() => {
    const list = asArray(contactsQ.data) as CrmContact[];
    const now = Date.now();
    return list.map((c) => {
      const lastTs = (c as any).lastTouchAt
        ? Date.parse((c as any).lastTouchAt)
        : c.notesUpdatedAt ? Date.parse(c.notesUpdatedAt) : 0;
      const inactive90d = lastTs > 0 && now - lastTs > 90 * 24 * 60 * 60 * 1000;
      const isHighValue = (c.maSignals ?? 0) >= 3 || (c.ownership?.pct ?? 0) >= 0.05;
      const isSoftCircled = c.stage === "soft_circle" || (c.softCircleHistory ?? []).length > 0;
      const isSeriesA = (c.series ?? "").toLowerCase().includes("series a");
      const introCount = (c as any).introductionsMade ?? 0;
      const isStrategicIntro = introCount >= 3;
      return { ...c, _inactive90d: inactive90d, _isHighValue: isHighValue, _isSoftCircled: isSoftCircled, _isSeriesA: isSeriesA, _isStrategicIntro: isStrategicIntro };
    });
  }, [contactsQ.data]);

  const chipCounts = useMemo(() => ({
    all: enrichedContacts.length,
    high_value: enrichedContacts.filter((c: any) => c._isHighValue).length,
    soft_circled: enrichedContacts.filter((c: any) => c._isSoftCircled).length,
    inactive_90d: enrichedContacts.filter((c: any) => c._inactive90d).length,
    series_a: enrichedContacts.filter((c: any) => c._isSeriesA).length,
    strategic_intro: enrichedContacts.filter((c: any) => c._isStrategicIntro).length,
  }), [enrichedContacts]);

  const filtered = useMemo(() => {
    return enrichedContacts.filter((c: any) => {
      if (filterStage !== "all" && c.stage !== filterStage) return false;
      if (filterRegion !== "all" && c.region !== filterRegion) return false;
      if (activeChip === "high_value" && !c._isHighValue) return false;
      if (activeChip === "soft_circled" && !c._isSoftCircled) return false;
      if (activeChip === "inactive_90d" && !c._inactive90d) return false;
      if (activeChip === "series_a" && !c._isSeriesA) return false;
      if (activeChip === "strategic_intro" && !c._isStrategicIntro) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!c.name.toLowerCase().includes(q) && !c.firmName.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [enrichedContacts, filterStage, filterRegion, search, activeChip]);

  const moveStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) =>
      (await apiRequest("PATCH", `/api/founder/investor-crm/${id}`, { stage })).json(),
    onSuccess: () => {
      // Sprint 19 I — include companyId in queryKey to match the fetch key.
      queryClient.invalidateQueries({ queryKey: ["/api/founder/investor-crm", companyId] });
      toast({ title: "Stage updated" });
    },
  });

  const updateNotes = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) =>
      (await apiRequest("PATCH", `/api/founder/investor-crm/${id}`, { notes })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/investor-crm"] });
      setEditing(null);
      toast({ title: "Notes saved" });
    },
  });

  const broadcast = useMutation({
    mutationFn: async () => {
      const filter: Record<string, string> = {};
      if (bcStage !== "all") filter.stage = bcStage;
      if (bcRegion !== "all") filter.region = bcRegion;
      if (bcSeries.trim()) filter.series = bcSeries.trim();
      // Defect 39 — if opened from selection, send explicit recipientIds instead of filter.
      const recipientIds = bcInitialIds.size > 0 ? Array.from(bcInitialIds) : undefined;
      return (await apiRequest("POST", "/api/founder/investor-crm/broadcast", { companyId, filter: recipientIds ? {} : filter, recipientIds, message: bcMsg })).json();
    },
    onSuccess: (data: { recipientCount: number }) => {
      toast({ title: `Broadcast sent`, description: `Reached ${data.recipientCount} investors.` });
      setBcOpen(false); setBcMsg(""); setBcInitialIds(new Set());
    },
  });

  const counts = useMemo(() => {
    const m: Record<Stage, number> = { lead: 0, engaged: 0, soft_circle: 0, committed: 0, signing: 0, invested: 0, longterm: 0 };
    asArray<CrmContact>(contactsQ.data).forEach(c => { m[c.stage] = (m[c.stage] || 0) + 1; });
    return m;
  }, [contactsQ.data]);

  // Sprint 14 D3 — Network Reach panel: aggregate co-investors by series + region distribution.
  const reach = useMemo(() => {
    const data = contactsQ.data ?? [];
    const total = data.length;
    const invested = data.filter(c => c.stage === "invested" || c.stage === "longterm").length;
    const seriesMap: Record<string, number> = {};
    const regionMap: Record<string, number> = {};
    data.forEach(c => {
      if (c.series) seriesMap[c.series] = (seriesMap[c.series] || 0) + 1;
      if (c.region) regionMap[c.region] = (regionMap[c.region] || 0) + 1;
    });
    return {
      total,
      invested,
      coInvestorEdges: Math.max(0, invested * (invested - 1) / 2), // n choose 2
      series: Object.entries(seriesMap).sort((a, b) => b[1] - a[1]).slice(0, 5),
      regions: Object.entries(regionMap).sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [contactsQ.data]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  return (
    <>
      <PageHeader
        title="Investor CRM"
        description="Pipeline from lead to long-term partner. Includes soft-circle history, ownership, M&A signals, and per-investor threads."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Investor CRM" }]}
        actions={
          <div className="flex items-center gap-2">
            <Dialog open={bcOpen} onOpenChange={(open) => { setBcOpen(open); if (!open) setBcInitialIds(new Set()); }}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-segmented-broadcast"><Megaphone className="h-4 w-4 mr-2" /> Segmented broadcast</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{bcInitialIds.size > 0 ? `Bulk message (${bcInitialIds.size} selected)` : "Segmented broadcast"}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  {bcInitialIds.size > 0 && (
                    <div className="rounded-md border bg-secondary/30 p-2">
                      <Label className="text-xs mb-1 block">Recipients ({bcInitialIds.size})</Label>
                      <div className="flex flex-wrap gap-1">
                        {Array.from(bcInitialIds).map((id) => {
                          const contact = (contactsQ.data ?? []).find((c) => c.id === id);
                          return <Badge key={id} variant="outline" className="text-[10px]" data-testid={`badge-recipient-${id}`}>{contact?.name ?? id}</Badge>;
                        })}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3" style={bcInitialIds.size > 0 ? { display: "none" } : undefined}>
                    <div>
                      <Label className="text-xs">Stage</Label>
                      <Select value={bcStage} onValueChange={(v) => setBcStage(v as Stage | "all")}>
                        <SelectTrigger data-testid="select-bc-stage"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All stages</SelectItem>
                          {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Region</Label>
                      <Select value={bcRegion} onValueChange={setBcRegion}>
                        <SelectTrigger data-testid="select-bc-region"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All regions</SelectItem>
                          {REGIONS_ALL.map(r => <SelectItem key={r.code} value={r.code}>{r.flag} {r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div style={bcInitialIds.size > 0 ? { display: "none" } : undefined}>
                    <Label className="text-xs">Series filter (optional)</Label>
                    <Input value={bcSeries} onChange={(e) => setBcSeries(e.target.value)} placeholder='e.g. "Series A"' data-testid="input-bc-series" />
                  </div>
                  <div>
                    <Label className="text-xs">Message</Label>
                    <Textarea rows={4} value={bcMsg} onChange={(e) => setBcMsg(e.target.value)} placeholder="Quarterly update — link in dataroom." data-testid="textarea-bc-msg" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setBcOpen(false)}>Cancel</Button>
                  <Button onClick={() => broadcast.mutate()} disabled={!bcMsg.trim() || broadcast.isPending} className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" data-testid="button-bc-send">
                    {broadcast.isPending ? "Sending…" : "Send broadcast"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Link href="/founder/crm/new">
              <Button className="bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white" data-testid="button-add-investor"><Plus className="h-4 w-4 mr-2" /> Add investor</Button>
            </Link>
          </div>
        }
      />
      <PageBody>
        {/* Sprint 14 D3 — Network Reach panel */}
        <Card className="mb-4" data-testid="reach-panel">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex items-center gap-2">
                <Network className="h-5 w-5 text-[hsl(184_98%_22%)]" />
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Network reach</span>
              </div>
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div><div className="text-[10px] uppercase text-muted-foreground">Contacts</div><div className="text-xl font-semibold" data-testid="reach-total">{reach.total}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Invested</div><div className="text-xl font-semibold" data-testid="reach-invested">{reach.invested}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Co-investor edges</div><div className="text-xl font-semibold" data-testid="reach-edges">{reach.coInvestorEdges}</div></div>
                <div><div className="text-[10px] uppercase text-muted-foreground">Top series</div><div className="text-sm font-medium truncate" data-testid="reach-top-series">{reach.series[0]?.[0] ?? "—"}</div></div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pipeline counts strip */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 mb-6">
          {STAGES.map(s => (
            <button
              key={s.key}
              onClick={() => setFilterStage(filterStage === s.key ? "all" : s.key)}
              data-testid={`stage-${s.key}`}
              className={`rounded-md border p-3 text-left transition ${filterStage === s.key ? "border-[hsl(184_98%_22%)] ring-1 ring-[hsl(184_98%_22%)]" : "border-border"}`}
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="text-2xl font-semibold mt-0.5">{counts[s.key]}</div>
            </button>
          ))}
        </div>

        {/* Sprint 18 Phase 2 — T6.2 quick filter chips */}
        <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="filter-chips">
          {([
            { key: "all", label: "All investors" },
            { key: "high_value", label: "High-value advocates" },
            { key: "soft_circled", label: "Soft-circled" },
            { key: "inactive_90d", label: "Inactive 90d" },
            { key: "series_a", label: "Series A holders" },
            { key: "strategic_intro", label: "Strategic introducers" },
          ] as const).map((chip) => {
            const active = activeChip === chip.key;
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
                  {chipCounts[chip.key as keyof typeof chipCounts]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <Card className="mb-4">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-[220px]">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search firm, contact, email…" value={search} onChange={(e) => setSearch(e.target.value)} className="border-0 shadow-none focus-visible:ring-0 px-0 h-8" data-testid="input-search-crm" />
            </div>
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filterStage} onValueChange={(v) => setFilterStage(v as Stage | "all")}>
              <SelectTrigger className="w-44" data-testid="filter-stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterRegion} onValueChange={(v) => setFilterRegion(v as Region9 | "all")}>
              <SelectTrigger className="w-40" data-testid="filter-region"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {REGIONS_ALL.map(r => <SelectItem key={r.code} value={r.code}>{r.flag} {r.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {selectedIds.size > 0 && (
          <Card className="mb-4 border-[hsl(184_98%_22%)]/40 bg-[hsl(184_98%_22%)]/5" data-testid="bulk-actions-bar">
            <CardContent className="p-3 flex items-center justify-between">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())} data-testid="button-clear-selection">Clear</Button>
                <Button size="sm" onClick={() => { setBcInitialIds(new Set(selectedIds)); setBcOpen(true); }} data-testid="button-bulk-message"><MessageSquare className="h-3.5 w-3.5 mr-1" /> Bulk message</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3">
          {filtered.map(c => {
            // B-V11-2 fix: defensive fallback. If a legacy contact carries
            // an invalid free-text "stage" value (e.g. "Seed-Series A" from
            // a prior bug), STAGES.find returns undefined and `.tone` throws.
            // Fall back to the "lead" tone so the page renders instead of
            // crashing the whole CRM list.
            const stageInfo = STAGES.find(s => s.key === c.stage) ?? STAGES[0];
            const checked = selectedIds.has(c.id);
            return (
              <Card key={c.id} data-testid={`card-crm-${c.id}`} className={checked ? "border-[hsl(184_98%_22%)]" : ""}>
                <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-4">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(c.id)}
                    className="h-4 w-4"
                    data-testid={`checkbox-${c.id}`}
                  />
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-[hsl(219_45%_20%)] text-white text-xs font-semibold">
                      {c.name.split(" ").map(s => s[0]).slice(0, 2).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.name}</span>
                      <Badge variant="outline" className={`text-[10px] ${stageInfo.tone}`}>{stageInfo.label}</Badge>
                      <Badge variant="outline" className="text-[10px]">{c.region}</Badge>
                      {c.ownership.sharesUsd > 0 && (
                        <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">
                          {fmtUSD(c.ownership.sharesUsd, { compact: true })} · {fmtPct(c.ownership.pct * 100, 1)}
                        </Badge>
                      )}
                      {c.maSignals > 0 && <Badge variant="outline" className="text-[10px] border-[hsl(333_75%_35%)]/40 text-[hsl(333_75%_35%)]">{c.maSignals} M&amp;A signal</Badge>}
                      <AutoTierBadge tier={computeAutoTier(
                        // engagement score: 0..100 derived from threads, soft-circles, M&A signals
                        Math.min(100, c.threadIds.length * 8 + c.softCircleHistory.length * 25 + c.maSignals * 15)
                      )} testId={`auto-tier-${c.id}`} />
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5">
                      {c.firmName} · <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1.5 italic">"{c.notes}"</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {c.softCircleHistory.length > 0 && <>Soft-circles: {c.softCircleHistory.length} · last {timeAgo(c.softCircleHistory[0].ts)} · </>}
                      Notes updated {timeAgo(c.notesUpdatedAt)} · Series: {c.series}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0 min-w-[200px]">
                    <Select value={c.stage} onValueChange={(v) => moveStage.mutate({ id: c.id, stage: v as Stage })}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-stage-${c.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAGES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setEditing(c)} data-testid={`button-edit-notes-${c.id}`}>Notes</Button>
                      <Link href={`/founder/messages?contactId=${c.investorId}`}>
                        <Button size="sm" variant="ghost" data-testid={`button-message-${c.id}`}><MessageSquare className="h-3.5 w-3.5" /></Button>
                      </Link>
                      {/* Sprint 19 I — wire Mail button to navigate to messages?contactId */}
                      <Link href={`/founder/messages?contactId=${c.investorId}`}>
                        <Button size="sm" variant="ghost" data-testid={`button-mail-${c.id}`}><Mail className="h-3.5 w-3.5" /></Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Request warm intro"
                        onClick={() => { setWarmIntroTarget({ id: c.investorId, name: c.name }); setWarmIntroOpen(true); }}
                        data-testid={`button-warm-intro-${c.id}`}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && contactsQ.data && (
            <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No contacts match the current filters.</CardContent></Card>
          )}
        </div>

        {/* Sprint 14 D3 — Warm-Intro Modal */}
        <WarmIntroModal
          open={warmIntroOpen}
          onOpenChange={(o) => { setWarmIntroOpen(o); if (!o) setWarmIntroTarget(null); }}
          requesterCompanyId={companyId ?? ""}
          isCollectiveMember={true}
          prefill={warmIntroTarget ? { targetKind: "investor", targetName: warmIntroTarget.name, brokerContactId: warmIntroTarget.id } : undefined}
        />

        {/* Notes editor dialog */}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Notes — {editing?.name}</DialogTitle></DialogHeader>
            {editing && (
              <Textarea
                rows={6}
                defaultValue={editing.notes}
                onBlur={(e) => updateNotes.mutate({ id: editing.id, notes: e.target.value })}
                data-testid="textarea-edit-notes"
              />
            )}
            <DialogFooter>
              <Button variant="ghost" onClick={() => setEditing(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </>
  );
}
