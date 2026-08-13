/**
 * WAVE 15 — Platform Surfaces & Integrity.
 *
 * WHY THIS PAGE EXISTS. Four Wave 15 items produced real server state that no
 * human could see, which by the owner's standing rule ("existing functionality
 * must be reflected in the UI") means they were not shipped:
 *
 *   ORP-062  the LIVE orphan-surface inventory — every mounted route joined to
 *            its stored ruling, with unruled routes reported as `pending` BY
 *            ABSENCE so a new endpoint cannot slip in unaccounted for.
 *   ORP-053  twelve DDL-only column rulings that existed in
 *            `ddl_column_disposition` with zero readers, now VERIFIED against
 *            the live schema rather than merely published.
 *   A-2      the platform audit incident record, and the clear form that
 *            refuses a clear whose evidence names a file that does not exist.
 *   A-3b     the bridge-mode disclosure: why the bridge is not live, which
 *            credential inputs are absent (presence only, never values), and
 *            the fact that flipping it is an OWNER decision (GATE-A3) this wave
 *            did not make.
 *
 * NOTHING ON THIS PAGE IS DECORATIVE. Every number comes from a fetch; there is
 * no placeholder state that could be mistaken for data. Where a value cannot be
 * obtained the page says so instead of rendering a zero — an unresolved figure
 * shown as 0 is read as 0 by whoever is looking at it.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ShieldCheck, Network, Columns3, ListTree, Scale } from "lucide-react";
/* WAVE 24 · ITEM 1 — the mark-override review surface. Mounted HERE, as a
   sibling tab, rather than at a new /admin/... route: this page is already the
   "functionality that exists must be visible" surface, and re-fragmenting the
   admin area is what lost RS-1 and RS-2 in July. */
import { MarkOverrideReviewPanel } from "@/components/admin/MarkOverrideReviewPanel";
import { LockTextAdminPanel } from "@/components/admin/LockTextAdminPanel"; /* WAVE 33 · CP-PIPE-10 */
import { asArray } from "@/lib/safeArray";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/* ── Response shapes (structural, so a server-side addition renders rather than
 *    disappearing silently). ─────────────────────────────────────────────── */

interface InventoryEntry {
  method: string;
  path: string;
  silo: string;
  disposition: "adopted" | "retired" | "pending";
  ruled: boolean;
  callerRef: string | null;
  itemId: string | null;
  rationale: string | null;
}
interface DispositionRow {
  id: string;
  surfaceKind: string;
  method: string | null;
  path: string;
  silo: string;
  disposition: string;
  callerRef: string | null;
  itemId: string;
  rationale: string;
}
interface OrphanSurfacesResponse {
  ok?: boolean;
  computedFrom?: string;
  mountedCount?: number;
  counts?: Record<string, number>;
  siloCounts?: Record<string, Record<string, number>>;
  entries?: InventoryEntry[];
  orphanRulings?: DispositionRow[];
  nonRouteRulings?: DispositionRow[];
  note?: string;
}
interface DdlRow {
  id: string;
  tableName: string;
  columnName: string;
  declaredIn: string;
  disposition: string;
  rationale: string;
  riskClass: string;
  ownerRuled: boolean;
}
interface DdlResponse {
  ok?: boolean;
  rows?: DdlRow[];
  verification?: {
    ok: boolean;
    checked: number;
    missing: Array<{ table: string; column: string; riskClass: string }>;
    notDropped: Array<{ table: string; column: string }>;
    tableAbsent: string[];
  };
  error?: string;
}
interface IncidentRow {
  id: string;
  incidentKey: string;
  severity: string;
  state: string;
  headline: string;
  detail: string;
  scope: string;
  tenantId: string | null;
  openedAt: string;
  clearedAt: string | null;
  clearedBy: string | null;
  clearedEvidence: string | null;
}
interface BannerResponse {
  ok?: boolean;
  banner?: {
    incident: boolean;
    sources: string[];
    openIncidents: IncidentRow[];
    liveChainOk: boolean | null;
  };
  liveSignalDetail?: string;
}
interface BridgeModeResponse {
  ok?: boolean;
  disclosure?: {
    mode: string;
    inputs: Array<{ name: string; present: boolean }>;
    missing: string[];
    blockedOnCredentials: boolean;
    gateId: string;
    gateStatus: string;
    gateRationale: string;
    ownerDecisionRequired: boolean;
    effectOfFlip: string[];
  };
}

function dispositionBadge(d: string) {
  const variant = d === "adopted" ? "default" : d === "retired" ? "secondary" : "destructive";
  return (
    <Badge variant={variant as any} data-testid={`badge-disposition-${d}`}>
      {d}
    </Badge>
  );
}

export default function PlatformSurfaces() {
  const { toast } = useToast();
  const [silo, setSilo] = useState<string>("all");
  const [disposition, setDisposition] = useState<string>("all");
  const [clearKey, setClearKey] = useState<string>("");
  const [evidence, setEvidence] = useState<string>("");

  const qs = new URLSearchParams();
  if (silo !== "all") qs.set("silo", silo);
  if (disposition !== "all") qs.set("disposition", disposition);
  const orphanUrl = `/api/admin/orphan-surfaces${qs.toString() ? `?${qs.toString()}` : ""}`;

  const orphanQ = useQuery<OrphanSurfacesResponse>({
    queryKey: [orphanUrl],
    queryFn: async () => (await apiRequest("GET", orphanUrl)).json(),
  });

  const ddlQ = useQuery<DdlResponse>({
    queryKey: ["/api/admin/ddl-column-dispositions"],
    /* The route answers 409 when a ruling is VIOLATED. That is a real state to
     * RENDER, not a fetch failure to swallow — a violated schema ruling shown as
     * a generic "failed to load" is exactly how a genuine schema break got
     * downgraded to a warning in an earlier wave. `apiRequest` throws on a
     * non-2xx, so this one query uses `fetch` directly and reads the body in
     * both cases. */
    queryFn: async () => {
      const res = await fetch("/api/admin/ddl-column-dispositions", { credentials: "include" });
      if (res.status !== 200 && res.status !== 409) {
        throw new Error(`ddl-column-dispositions: HTTP ${res.status}`);
      }
      return (await res.json()) as DdlResponse;
    },
    retry: false,
  });

  const bannerQ = useQuery<BannerResponse>({
    queryKey: ["/api/platform/audit-banner"],
    queryFn: async () => (await apiRequest("GET", "/api/platform/audit-banner")).json(),
  });

  const incidentsQ = useQuery<{ ok?: boolean; incidents?: IncidentRow[] }>({
    queryKey: ["/api/admin/audit/incidents"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/audit/incidents")).json(),
  });

  const bridgeQ = useQuery<BridgeModeResponse>({
    queryKey: ["/api/admin/bridge/mode"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/bridge/mode")).json(),
  });

  const clearMut = useMutation({
    mutationFn: async (vars: { key: string; evidence: string }) =>
      (
        await apiRequest("POST", `/api/admin/audit/incidents/${encodeURIComponent(vars.key)}/clear`, {
          evidence: vars.evidence,
        })
      ).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audit/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/audit-banner"] });
      setEvidence("");
      toast({ title: "Incident cleared", description: "The live chain check passed and the evidence verified." });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "";
      toast({
        title: "Clear refused",
        description: msg.includes("EVIDENCE")
          ? "The evidence named an artefact that is not on disk, or named none at all."
          : msg.includes("LIVE")
            ? "The audit chain does not currently verify, so the incident cannot be cleared."
            : "The incident was not cleared.",
        variant: "destructive",
      });
    },
  });

  const banner = bannerQ.data?.banner;
  const ddlVerification = ddlQ.data?.verification;

  return (
    <>
      <PageHeader
        title="Platform Surfaces & Integrity"
        description="Live route inventory, DDL column rulings, audit-chain incidents, and bridge mode disclosure."
      />
      <PageBody>
        {/* ══ A-2 — the banner. Rendered FIRST because it qualifies every other
            audit-derived figure on the platform. ══════════════════════════ */}
        {banner?.incident && (
          <div
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
            data-testid="banner-platform-audit-incident"
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              <span>Audit chain integrity incident is OPEN.</span>
            </div>
            <span className="block mt-1" data-testid="text-audit-banner-sources">
              {`Raised by: ${asArray<string>(banner.sources).join(", ") || "no source recorded"}`}
            </span>
            <span className="block" data-testid="text-audit-banner-live">
              {banner.liveChainOk === null
                ? "The live chain check could not be evaluated — that is not the same as healthy, and is not treated as healthy."
                : banner.liveChainOk
                  ? "The live chain check currently passes; the durable incident row is still open."
                  : "The live chain check currently FAILS."}
            </span>
            <span className="block" data-testid="text-audit-banner-consequence">
              Audit-derived figures should be treated as unattested until this is cleared.
            </span>
          </div>
        )}
        {banner && !banner.incident && (
          <div
            className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-3 text-sm"
            data-testid="banner-platform-audit-clear"
          >
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4" />
              <span>No open audit-chain incident.</span>
            </div>
            <span className="block mt-1" data-testid="text-audit-clear-detail">
              {bannerQ.data?.liveSignalDetail ?? ""}
            </span>
          </div>
        )}

        <Tabs defaultValue="routes" className="w-full">
          <TabsList data-testid="tabs-platform-surfaces">
            <TabsTrigger value="routes" data-testid="tab-surfaces-routes">
              <ListTree className="h-4 w-4 mr-1.5" /> Route inventory
            </TabsTrigger>
            <TabsTrigger value="columns" data-testid="tab-surfaces-columns">
              <Columns3 className="h-4 w-4 mr-1.5" /> DDL column rulings
            </TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-surfaces-audit">
              <ShieldCheck className="h-4 w-4 mr-1.5" /> Audit incidents
            </TabsTrigger>
            <TabsTrigger value="bridge" data-testid="tab-surfaces-bridge">
              <Network className="h-4 w-4 mr-1.5" /> Bridge mode
            </TabsTrigger>
            <TabsTrigger value="mark-reviews" data-testid="tab-surfaces-mark-reviews">
              <Scale className="h-4 w-4 mr-1.5" /> Mark reviews
            </TabsTrigger>
            {/* WAVE 33 · CP-PIPE-10 — APPENDED as the LAST trigger, never
                inserted mid-list (insertion renumbers a sibling's positional
                path and the guard reads that as a drop). */}
            <TabsTrigger value="lock-text" data-testid="tab-surfaces-lock-text">
              <Scale className="h-4 w-4 mr-1.5" /> Lock wording
            </TabsTrigger>
          </TabsList>

          {/* ══ ORP-062 ═══════════════════════════════════════════════════ */}
          <TabsContent value="routes" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mounted routes joined to stored rulings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <span className="block text-muted-foreground" data-testid="text-orphan-provenance">
                  {orphanQ.data?.computedFrom
                    ? `Computed from the ${orphanQ.data.computedFrom} at request time — never a frozen list.`
                    : "Loading inventory…"}
                </span>
                <span className="block text-muted-foreground" data-testid="text-orphan-note">
                  {orphanQ.data?.note ?? ""}
                </span>
                <div className="flex flex-wrap gap-2" data-testid="row-orphan-counts">
                  <Badge variant="outline" data-testid="badge-orphan-mounted">
                    {orphanQ.data?.mountedCount !== undefined
                      ? `${orphanQ.data.mountedCount} mounted`
                      : "mounted count unavailable"}
                  </Badge>
                  {Object.entries(orphanQ.data?.counts ?? {}).map(([k, v]) => (
                    <Badge key={k} variant="secondary" data-testid={`badge-orphan-count-${k}`}>
                      {`${v} ${k}`}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Silo</Label>
                    <Select value={silo} onValueChange={setSilo}>
                      <SelectTrigger className="w-40" data-testid="select-orphan-silo">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["all", ...Object.keys(orphanQ.data?.siloCounts ?? {})].map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Disposition</Label>
                    <Select value={disposition} onValueChange={setDisposition}>
                      <SelectTrigger className="w-40" data-testid="select-orphan-disposition">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["all", "adopted", "retired", "pending"].map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="max-h-[28rem] overflow-auto border border-border rounded-md">
                  <Table data-testid="table-orphan-surfaces">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Method</TableHead>
                        <TableHead>Path</TableHead>
                        <TableHead>Silo</TableHead>
                        <TableHead>Disposition</TableHead>
                        <TableHead>Consumer</TableHead>
                        <TableHead>Item</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {asArray<InventoryEntry>(orphanQ.data?.entries).map((e) => (
                        <TableRow key={`${e.method} ${e.path}`} data-testid={`row-surface-${e.method}-${e.path}`}>
                          <TableCell className="font-mono text-xs">{e.method}</TableCell>
                          <TableCell className="font-mono text-xs">{e.path}</TableCell>
                          <TableCell>{e.silo}</TableCell>
                          <TableCell>
                            {dispositionBadge(e.disposition)}
                            {!e.ruled && (
                              <span className="ml-1 text-[11px] text-muted-foreground">by absence</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-[11px]">{e.callerRef ?? "—"}</TableCell>
                          <TableCell className="text-xs">{e.itemId ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Stale rulings and non-route rulings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <span className="block text-muted-foreground">
                  A ruling whose route is no longer mounted is shown here rather than dropped, because a
                  disposition that quietly disappears is how a surface stops being accounted for.
                </span>
                <div className="max-h-64 overflow-auto border border-border rounded-md">
                  <Table data-testid="table-stale-rulings">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kind</TableHead>
                        <TableHead>Path</TableHead>
                        <TableHead>Disposition</TableHead>
                        <TableHead>Item</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ...asArray<DispositionRow>(orphanQ.data?.orphanRulings),
                        ...asArray<DispositionRow>(orphanQ.data?.nonRouteRulings),
                      ].map((r) => (
                        <TableRow key={r.id} data-testid={`row-ruling-${r.id}`}>
                          <TableCell className="text-xs">{r.surfaceKind}</TableCell>
                          <TableCell className="font-mono text-xs">{r.path}</TableCell>
                          <TableCell>{dispositionBadge(r.disposition)}</TableCell>
                          <TableCell className="text-xs">{r.itemId}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══ ORP-053 ═══════════════════════════════════════════════════ */}
          <TabsContent value="columns" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">DDL-only column rulings, verified against the live schema</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <span className="block text-muted-foreground">
                  These twelve columns were ruled `document` — retained deliberately, read by nothing. Publishing a
                  ruling is not the same as enforcing it, so each one is checked against the live schema on every load.
                </span>
                {ddlVerification && (
                  <div
                    className={`rounded-md border px-3 py-2 ${
                      ddlVerification.ok
                        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                        : "border-destructive/40 bg-destructive/10"
                    }`}
                    data-testid="panel-ddl-verification"
                  >
                    <span className="block font-medium" data-testid="text-ddl-verdict">
                      {ddlVerification.ok
                        ? `All ${ddlVerification.checked} rulings hold.`
                        : "A ruling is VIOLATED — the schema no longer matches what was ruled."}
                    </span>
                    {ddlVerification.missing.length > 0 && (
                      <span className="block mt-1" data-testid="text-ddl-missing">
                        {`Ruled retained but ABSENT: ${ddlVerification.missing
                          .map((m) => `${m.table}.${m.column} (${m.riskClass})`)
                          .join(", ")}`}
                      </span>
                    )}
                    {ddlVerification.notDropped.length > 0 && (
                      <span className="block" data-testid="text-ddl-not-dropped">
                        {`Ruled drop but STILL PRESENT: ${ddlVerification.notDropped
                          .map((m) => `${m.table}.${m.column}`)
                          .join(", ")}`}
                      </span>
                    )}
                    {ddlVerification.tableAbsent.length > 0 && (
                      <span className="block" data-testid="text-ddl-table-absent">
                        {`Table not installed in this database (ruling not evaluable): ${ddlVerification.tableAbsent.join(", ")}`}
                      </span>
                    )}
                  </div>
                )}
                <div className="max-h-96 overflow-auto border border-border rounded-md">
                  <Table data-testid="table-ddl-dispositions">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Table</TableHead>
                        <TableHead>Column</TableHead>
                        <TableHead>Ruling</TableHead>
                        <TableHead>Risk</TableHead>
                        <TableHead>Declared in</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {asArray<DdlRow>(ddlQ.data?.rows).map((r) => (
                        <TableRow key={r.id} data-testid={`row-ddl-${r.id}`}>
                          <TableCell className="font-mono text-xs">{r.tableName}</TableCell>
                          <TableCell className="font-mono text-xs">{r.columnName}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{r.disposition}</Badge>
                            {r.ownerRuled && (
                              <span className="ml-1 text-[11px] text-muted-foreground">owner-ruled</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{r.riskClass}</TableCell>
                          <TableCell className="font-mono text-[11px]">{r.declaredIn}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══ A-2 detail + clear form ══════════════════════════════════ */}
          <TabsContent value="audit" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audit chain incidents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {asArray<IncidentRow>(incidentsQ.data?.incidents).map((i) => (
                  <div key={i.id} className="border border-border rounded-md p-3" data-testid={`panel-incident-${i.incidentKey}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{i.headline}</span>
                      <Badge variant={i.state === "open" ? "destructive" : "secondary"}>{i.state}</Badge>
                    </div>
                    <span className="block mt-1 text-muted-foreground">{i.detail}</span>
                    <span className="block text-xs text-muted-foreground">
                      {`Scope ${i.scope}${i.tenantId ? ` · tenant ${i.tenantId}` : ""} · opened ${i.openedAt}`}
                    </span>
                    {i.clearedEvidence && (
                      <span className="block mt-1 text-xs font-mono" data-testid={`text-incident-evidence-${i.incidentKey}`}>
                        {`Evidence: ${i.clearedEvidence}`}
                      </span>
                    )}
                  </div>
                ))}
                {asArray<IncidentRow>(incidentsQ.data?.incidents).length === 0 && (
                  <span className="block text-muted-foreground" data-testid="empty-incidents">
                    No incident records in this database.
                  </span>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Clear an incident</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <span className="block text-muted-foreground" data-testid="text-clear-rules">
                  A clear requires all three: the live chain check must pass right now, the evidence must be at least
                  20 characters, and every file path it names must exist on disk. An earlier incident was recorded as
                  mitigated by a file that was never written — this form refuses that.
                </span>
                <div className="space-y-1">
                  <Label className="text-xs">Incident key</Label>
                  <Input
                    value={clearKey}
                    onChange={(e) => setClearKey(e.target.value)}
                    placeholder="audit.chain_integrity"
                    data-testid="input-incident-key"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Evidence (name the artefact)</Label>
                  <Textarea
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    rows={3}
                    placeholder="Chain re-verified for all tenants; see server/lib/wave15AuditIncidents.ts"
                    data-testid="input-incident-evidence"
                  />
                </div>
                <Button
                  disabled={!clearKey || evidence.trim().length < 20 || clearMut.isPending}
                  onClick={() => clearMut.mutate({ key: clearKey, evidence })}
                  data-testid="button-clear-incident"
                >
                  Clear incident
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══ A-3b ═════════════════════════════════════════════════════ */}
          <TabsContent value="bridge" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bridge mode disclosure</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <span className="block" data-testid="text-bridge-mode">
                  {bridgeQ.data?.disclosure ? `Current mode: ${bridgeQ.data.disclosure.mode}` : "Loading…"}
                </span>
                <span className="block text-muted-foreground" data-testid="text-bridge-readonly">
                  This page is read-only by design. Flipping the bridge to live is an owner decision, and this build
                  did not make it.
                </span>
                {bridgeQ.data?.disclosure && (
                  <>
                    <div className="flex flex-wrap gap-2" data-testid="row-bridge-inputs">
                      {bridgeQ.data.disclosure.inputs.map((i) => (
                        <Badge
                          key={i.name}
                          variant={i.present ? "default" : "destructive"}
                          data-testid={`badge-bridge-input-${i.name}`}
                        >
                          {`${i.name}: ${i.present ? "present" : "absent"}`}
                        </Badge>
                      ))}
                    </div>
                    <span className="block text-xs text-muted-foreground" data-testid="text-bridge-presence-only">
                      Presence only — credential values are never returned by the API or rendered here.
                    </span>
                    <span className="block" data-testid="text-bridge-blocked">
                      {bridgeQ.data.disclosure.blockedOnCredentials
                        ? "The bridge is not live because required credentials are absent."
                        : "Credentials are present; the mode is set by configuration, not by a missing secret."}
                    </span>
                    <div className="border border-amber-300 bg-amber-50 text-amber-900 rounded-md px-3 py-2">
                      <span className="block font-medium" data-testid="text-bridge-gate-id">
                        {`${bridgeQ.data.disclosure.gateId} — ${bridgeQ.data.disclosure.gateStatus}`}
                      </span>
                      <span className="block mt-1" data-testid="text-bridge-gate-rationale">
                        {bridgeQ.data.disclosure.gateRationale}
                      </span>
                      <span className="block mt-1" data-testid="text-bridge-owner-required">
                        {bridgeQ.data.disclosure.ownerDecisionRequired
                          ? "An owner ruling is required before this can be flipped."
                          : "No owner ruling outstanding."}
                      </span>
                    </div>
                    <div>
                      <span className="block font-medium">What flipping it would do</span>
                      {bridgeQ.data.disclosure.effectOfFlip.map((e, idx) => (
                        <span key={idx} className="block text-muted-foreground" data-testid={`text-bridge-effect-${idx}`}>
                          {`· ${e}`}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ══ WAVE 24 · ITEM 1 ═════════════════════════════════════════ */}
          <TabsContent value="mark-reviews" className="mt-4">
            <MarkOverrideReviewPanel />
          </TabsContent>

          {/* ══ WAVE 33 · CP-PIPE-10 (OQ-5) ══════════════════════════════ */}
          <TabsContent value="lock-text" className="mt-4">
            <LockTextAdminPanel />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
