/**
 * Sprint 11 Phase 2 — Dataroom rebuild.
 *
 * Surfaces:
 *  - File browser by folder (Pitch / Financials / Legal / Diligence / Round-Specific)
 *  - Real upload (multipart to /api/founder/dataroom/files)
 *  - Preview pane: PDF iframe / image inline / docx download
 *  - Permission matrix UI: investor × folder × view/download
 *  - Engagement stats: top docs + per-investor totals
 *  - Watermarking toggle (CSS overlay on preview)
 *  - Audit events feed
 */
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderOpen, Upload, FileText, Download, Eye, ShieldCheck, Plus, Activity as ActivityIcon, BarChart3, Lock, ExternalLink } from "lucide-react";
import { fmtBytes, timeAgo } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

type Folder = { id: string; companyId: string; name: string; isRoundFolder: boolean; roundId?: string; createdAt: string };
type DRFile = { id: string; companyId: string; folderId: string; name: string; sizeBytes: number; mime: string; uploadedAt: string; uploadedBy: string; sha256: string; watermark: boolean };
type Permission = { investorId: string; folderId: string; view: boolean; download: boolean };
type DREvent = { id: string; ts: string; actor: string; action: string; targetKind: string; targetId: string; meta?: Record<string, unknown> };
type Engagement = {
  topDocs: Array<{ fileId: string; name: string; uniqueViewers: number; totalViews: number; avgTimeSeconds: number; lastViewedAt: string | null }>;
  allDocs: Array<{ fileId: string; name: string; uniqueViewers: number; totalViews: number; avgTimeSeconds: number }>;
  investors: Array<{ investorId: string; docsViewed: number; totalSeconds: number; lastActiveAt: string | null }>;
};

export default function Dataroom() {
  const { toast } = useToast();
  const companyId = useActiveCompanyId();
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<DRFile | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState("browser");

  const foldersQ = useQuery<Folder[]>({
    queryKey: ["/api/founder/dataroom/folders", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/dataroom/folders?companyId=${companyId}`)).json(),
  });
  const filesQ = useQuery<DRFile[]>({
    queryKey: ["/api/founder/dataroom/files", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/dataroom/files?companyId=${companyId}`)).json(),
  });
  const permsQ = useQuery<Permission[]>({
    queryKey: ["/api/founder/dataroom/permissions", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/dataroom/permissions?companyId=${companyId}`)).json(),
  });
  const eventsQ = useQuery<DREvent[]>({
    queryKey: ["/api/founder/dataroom/events", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/dataroom/events?companyId=${companyId}`)).json(),
  });
  const engQ = useQuery<Engagement>({
    queryKey: ["/api/founder/dataroom/engagement", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/dataroom/engagement?companyId=${companyId}`)).json(),
  });

  const folders = foldersQ.data ?? [];
  const files = filesQ.data ?? [];
  const perms = permsQ.data ?? [];
  const events = eventsQ.data ?? [];

  const filesByFolder = useMemo(() => {
    const m: Record<string, DRFile[]> = {};
    files.forEach(f => { (m[f.folderId] ??= []).push(f); });
    return m;
  }, [files]);

  const activeFiles = activeFolder ? (filesByFolder[activeFolder] ?? []) : files;

  // Investors that have any permission row — used as rows in matrix
  const investorIds = useMemo(() => {
    const set = new Set<string>();
    perms.forEach(p => set.add(p.investorId));
    return Array.from(set);
  }, [perms]);

  const crmQ = useQuery<Array<{ investorId: string; name: string; firmName: string }>>({
    queryKey: ["/api/founder/investor-crm", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${companyId}`)).json(),
  });

  function resolveInvestorName(iid: string): string {
    const row = (crmQ.data ?? []).find(c => c.investorId === iid);
    if (row) return `${row.name} (${row.firmName})`;
    return iid;
  }

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      if (!companyId) throw new Error("No active company");
      const fd = new FormData();
      fd.append("file", file);
      // v23.9 B4/BUG-036 — never silently pick the first folder. The upload
      // button is disabled on the "All" tab, but guard here too.
      if (!activeFolder) throw new Error("Select a folder before uploading");
      fd.append("folderId", activeFolder);
      fd.append("companyId", companyId);
      // v25.10 M1 — include cookies for Safari + cross-origin compatibility.
      const r = await fetch(`/api/founder/dataroom/files`, { method: "POST", body: fd, credentials: "include" });
      if (!r.ok) throw new Error(`upload ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Uploaded" });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/dataroom/files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/dataroom/events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/dataroom/engagement"] });
    },
    onError: () => toast({ title: "Upload failed", variant: "destructive" }),
  });

  const newFolderMut = useMutation({
    mutationFn: async (name: string) => (await apiRequest("POST", "/api/founder/dataroom/folders", { name, companyId })).json(),
    onSuccess: () => {
      toast({ title: "Folder created" });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/dataroom/folders"] });
    },
  });

  const setPermMut = useMutation({
    mutationFn: async (p: Permission) => (await apiRequest("POST", "/api/founder/dataroom/permissions", p)).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/dataroom/permissions"] }),
  });

  const onUploadClick = () => fileInputRef.current?.click();

  return (
    <>
      <PageHeader
        title="Dataroom"
        description="Folders, permissions, audit events. Drag-drop upload with watermarking."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Dataroom" }]}
        actions={
          <>
            <Button variant="outline" onClick={() => setNewFolderOpen(true)} data-testid="button-new-folder"><Plus className="h-4 w-4 mr-2" /> New folder</Button>
            <Button onClick={onUploadClick} disabled={!activeFolder} title={!activeFolder ? "Select a folder before uploading" : undefined} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white disabled:opacity-50" data-testid="button-upload">
              <Upload className="h-4 w-4 mr-2" /> Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMut.mutate(f); e.currentTarget.value = ""; }}
              data-testid="input-file"
            />
            <Dialog open={newFolderOpen} onOpenChange={(open) => { setNewFolderOpen(open); if (!open) setNewFolderName(""); }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create new folder</DialogTitle>
                  <DialogDescription>Folders organize uploads and let you grant per-folder permissions to investors.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="new-folder-name">Folder name</Label>
                  <Input id="new-folder-name" placeholder="e.g. Diligence — Customer references" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} autoFocus data-testid="input-new-folder-name" />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setNewFolderOpen(false)} data-testid="button-cancel-folder">Cancel</Button>
                  <Button onClick={() => { if (newFolderName.trim()) { newFolderMut.mutate(newFolderName.trim()); setNewFolderOpen(false); setNewFolderName(""); } }} disabled={!newFolderName.trim() || newFolderMut.isPending} data-testid="button-create-folder">{newFolderMut.isPending ? "Creating…" : "Create folder"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />
      <PageBody>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="browser" data-testid="tab-browser">Files</TabsTrigger>
            <TabsTrigger value="permissions" data-testid="tab-permissions"><Lock className="h-3.5 w-3.5 mr-1" /> Permissions</TabsTrigger>
            <TabsTrigger value="engagement" data-testid="tab-engagement"><BarChart3 className="h-3.5 w-3.5 mr-1" /> Engagement</TabsTrigger>
            <TabsTrigger value="audit" data-testid="tab-audit"><ActivityIcon className="h-3.5 w-3.5 mr-1" /> Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="browser" className="mt-4">
            <div className="grid md:grid-cols-[260px_1fr] gap-6">
              <Card>
                <CardContent className="p-2">
                  <ul className="space-y-1">
                    <li>
                      <button onClick={() => setActiveFolder(null)} className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-left ${!activeFolder ? "bg-[hsl(0_100%_40%)] text-white" : "hover:bg-secondary"}`} data-testid="folder-all">
                        <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> All</span>
                        <Badge variant="outline" className={`text-[10px] ${!activeFolder ? "border-white/40 text-white" : ""}`}>{files.length}</Badge>
                      </button>
                    </li>
                    {folders.map(f => {
                      const count = filesByFolder[f.id]?.length ?? 0;
                      const sel = activeFolder === f.id;
                      return (
                        <li key={f.id}>
                          <button onClick={() => setActiveFolder(f.id)} className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm text-left ${sel ? "bg-[hsl(0_100%_40%)] text-white" : "hover:bg-secondary"}`} data-testid={`folder-${f.id}`}>
                            <span className="flex items-center gap-2 truncate"><FolderOpen className="h-4 w-4 shrink-0" /> <span className="truncate">{f.name}</span></span>
                            <Badge variant="outline" className={`text-[10px] ${sel ? "border-white/40 text-white" : ""}`}>{count}</Badge>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  {activeFiles.length === 0 ? (
                    <div className="p-12 text-center" data-testid="empty-files">
                      <FolderOpen className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <h3 className="font-semibold">No files yet</h3>
                      <p className="text-sm text-muted-foreground mt-1 mb-4">Click upload to add a file to this folder.</p>
                      <Button variant="outline" onClick={onUploadClick}><Upload className="h-4 w-4 mr-2" /> Upload</Button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm" data-testid="table-files">
                        <thead>
                          <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                            <th className="text-left font-medium px-5 py-2.5">Name</th>
                            <th className="text-left font-medium px-3 py-2.5">Uploaded by</th>
                            <th className="text-left font-medium px-3 py-2.5">When</th>
                            <th className="text-right font-medium px-3 py-2.5">Size</th>
                            <th className="text-right font-medium px-5 py-2.5"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeFiles.map(f => (
                            <tr key={f.id} className="border-b border-border/60 hover:bg-secondary/30" data-testid={`row-file-${f.id}`}>
                              <td className="px-5 py-3 flex items-center gap-3">
                                <div className="h-8 w-8 rounded bg-secondary flex items-center justify-center"><FileText className="h-4 w-4 text-muted-foreground" /></div>
                                <span className="font-medium">{f.name}</span>
                                {f.watermark && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">Watermarked</Badge>}
                              </td>
                              <td className="px-3 py-3 text-muted-foreground">{f.uploadedBy}</td>
                              <td className="px-3 py-3 text-muted-foreground">{timeAgo(f.uploadedAt)}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">{fmtBytes(f.sizeBytes)}</td>
                              <td className="px-5 py-3 text-right">
                                {/* v23.4.7 Phase 12 / BUG 027 — the view icon now
                                 * opens the file in a new tab with
                                 * Content-Disposition: inline (so the browser
                                 * renders the document instead of forcing a
                                 * download). The dedicated download icon
                                 * preserves the original attachment behavior. */}
                                <div className="inline-flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      window.open(
                                        `/api/founder/dataroom/files/${f.id}/download?disposition=inline`,
                                        "_blank",
                                        "noopener,noreferrer"
                                      )
                                    }
                                    data-testid={`button-view-${f.id}`}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" asChild data-testid={`button-download-${f.id}`}>
                                    <a href={`/api/founder/dataroom/files/${f.id}/download`}><Download className="h-3.5 w-3.5" /></a>
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Preview overlay */}
            {previewFile && (
              <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setPreviewFile(null)} data-testid="preview-overlay">
                <div className="bg-white rounded-md w-full max-w-4xl h-[85vh] overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
                  <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                    <span className="font-medium text-sm">{previewFile.name}</span>
                    <div className="flex items-center gap-2">
                      {previewFile.watermark && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">Watermark on</Badge>}
                      <Button size="sm" variant="ghost" onClick={() => setPreviewFile(null)} data-testid="button-close-preview">Close</Button>
                    </div>
                  </div>
                  <div className="relative h-[calc(85vh-49px)] bg-secondary/30 flex items-center justify-center overflow-hidden">
                    {previewFile.watermark && (
                      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                        <div className="text-[hsl(0_100%_40%)]/10 text-3xl font-bold rotate-[-30deg] select-none whitespace-pre-wrap text-center leading-tight" data-testid="watermark-overlay">
                          Confidential — Provided to Authorized Recipient
                          {"\n"}
                          {new Date().toISOString().slice(0, 10)}
                        </div>
                      </div>
                    )}
                    {previewFile.mime.startsWith("image/") ? (
                      /* v23.4.7 Phase 12 / BUG 027: preview surfaces use inline disposition so the browser renders the asset instead of triggering a download prompt. */
                      <img src={`/api/founder/dataroom/files/${previewFile.id}/download?disposition=inline`} alt={previewFile.name} className="max-h-full max-w-full" />
                    ) : previewFile.mime === "application/pdf" ? (
                      <iframe title="pdf-preview" src={`/api/founder/dataroom/files/${previewFile.id}/download?disposition=inline#toolbar=0`} className="w-full h-full" />
                    ) : (
                      <div className="text-center">
                        <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground mb-3">Preview not available for this file type.</p>
                        <Button asChild><a href={`/api/founder/dataroom/files/${previewFile.id}/download`}><Download className="h-4 w-4 mr-2" /> Download</a></Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="permissions" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Permission matrix</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Toggle view/download per investor × folder. Changes are audit-logged.</p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-perms">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 font-medium">Investor</th>
                      {folders.map(f => (
                        <th key={f.id} className="px-3 py-2 font-medium text-xs text-center">{f.name.replace("Round-Specific — ", "Round: ")}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {investorIds.map(iid => (
                      <tr key={iid} className="border-b border-border/60" data-testid={`row-perm-${iid}`}>
                        <td className="px-3 py-2 font-medium text-xs">{resolveInvestorName(iid)}</td>
                        {folders.map(f => {
                          const p = perms.find(x => x.investorId === iid && x.folderId === f.id) ?? { investorId: iid, folderId: f.id, view: false, download: false };
                          return (
                            <td key={f.id} className="px-3 py-2">
                              <div className="flex items-center justify-center gap-3">
                                <label className="flex items-center gap-1 text-xs">
                                  V
                                  <Switch
                                    checked={p.view}
                                    onCheckedChange={(v) => setPermMut.mutate({ ...p, view: v, download: v ? p.download : false })}
                                    data-testid={`switch-view-${iid}-${f.id}`}
                                  />
                                </label>
                                <label className="flex items-center gap-1 text-xs">
                                  D
                                  <Switch
                                    checked={p.download}
                                    onCheckedChange={(v) => setPermMut.mutate({ ...p, view: v ? true : p.view, download: v })}
                                    disabled={!p.view}
                                    data-testid={`switch-download-${iid}-${f.id}`}
                                  />
                                </label>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    {investorIds.length === 0 && (
                      <tr><td colSpan={folders.length + 1} className="px-3 py-8 text-center text-muted-foreground">No investor permissions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="engagement" className="mt-4">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Top documents</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(engQ.data?.allDocs ?? []).map(d => (
                      <li key={d.fileId} className="flex items-center justify-between text-sm" data-testid={`engagement-doc-${d.fileId}`}>
                        <div className="truncate flex-1">
                          <div className="font-medium truncate">{d.name}</div>
                          <div className="text-xs text-muted-foreground">{d.uniqueViewers} unique · avg {d.avgTimeSeconds}s</div>
                        </div>
                        <Badge variant="outline" className="ml-2">{d.totalViews} views</Badge>
                      </li>
                    ))}
                    {(engQ.data?.allDocs ?? []).length === 0 && <li className="text-sm text-muted-foreground">No views yet.</li>}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Per-investor activity</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(engQ.data?.investors ?? []).map(i => (
                      <li key={i.investorId} className="flex items-center justify-between text-sm" data-testid={`engagement-inv-${i.investorId}`}>
                        <div className="truncate flex-1">
                          <div className="font-medium">{i.investorId}</div>
                          <div className="text-xs text-muted-foreground">{i.docsViewed} docs · {Math.round((i.totalSeconds || 0) / 60)} min</div>
                        </div>
                        <span className="text-xs text-muted-foreground">{i.lastActiveAt ? timeAgo(i.lastActiveAt) : ""}</span>
                      </li>
                    ))}
                    {(engQ.data?.investors ?? []).length === 0 && <li className="text-sm text-muted-foreground">No activity yet.</li>}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border" data-testid="audit-events">
                  {events.map(e => (
                    <li key={e.id} className="px-5 py-3 text-sm flex items-start gap-3" data-testid={`audit-row-${e.id}`}>
                      <ActivityIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div><span className="font-medium">{e.actor}</span> <span className="text-muted-foreground">{e.action.replace(/_/g, " ")}</span> <span className="font-mono text-xs">{e.targetId}</span></div>
                        <div className="text-[11px] text-muted-foreground">{timeAgo(e.ts)}</div>
                      </div>
                    </li>
                  ))}
                  {events.length === 0 && <li className="px-5 py-8 text-sm text-center text-muted-foreground">No events yet.</li>}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}
