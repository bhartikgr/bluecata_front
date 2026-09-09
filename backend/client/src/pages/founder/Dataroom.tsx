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
import { LoadFailedRefusal } from "@/components/LoadFailedRefusal"; /* WAVE 22 · ITEM 4 */
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
import { partyReferenceLabel } from "@/lib/partnerDisplay"; /* WAVE 124 · FINDING 1 — wave 115's labelled-reference helper, reused. */

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

  /* WAVE 347 · ITEM 2 — the investor CRM query is HOISTED above `investorIds`.
     It was declared below it and used only for name resolution. `investorIds` now
     needs it as a ROW SOURCE (see the block below), and a `const` cannot be read
     before its declaration. Nothing about the query itself changed: same address,
     same key, same shape. */
  const crmQ = useQuery<Array<{ investorId: string; name: string; firmName: string }>>({
    queryKey: ["/api/founder/investor-crm", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/investor-crm?companyId=${companyId}`)).json(),
  });

  /* ════════════════════════════════════════════════════════════════════════════
     WAVE 347 · ITEM 2 — THE PERMISSION MATRIX COULD NOT BE BOOTSTRAPPED.

     WHAT THIS BLOCK USED TO BE:

         // Investors that have any permission row — used as rows in matrix
         const investorIds = useMemo(() => {
           const set = new Set<string>();
           perms.forEach(p => set.add(p.investorId));
           return Array.from(set);
         }, [perms]);

     THE DEFECT, STATED EXACTLY. The matrix's row set was derived FROM THE
     PERMISSIONS THEMSELVES. An investor appeared as a row only if a permission row
     for them already existed — and this screen is the ONLY request-driven writer's
     entry point for `dataroom_permissions` anywhere in the product. Counted, not
     assumed: `persistPermission` (server/dataroomStore.ts:308) has exactly TWO
     callers, both inside that same file — :445, which is HYDRATION re-persisting
     rows that already exist in memory and can therefore never introduce a new
     investor, and :977, the body of POST /api/founder/dataroom/permissions (route
     at :956), whose only client is the switch in this matrix. So there was NO PATH,
     on any surface, to create the FIRST permission row for any investor. With no
     first row there is no row; with no row there is no matrix line; with no matrix
     line there is no switch to toggle. The screen rendered "No
     investor permissions yet." forever and the founder had nothing to click.

     THIS IS NOT A HOLE IN THE FENCE. The enforcement was re-traced in full before
     anything here was touched, and it is sound — do not weaken any of it:
       · `investorFolderGrant` (server/dataroomStore.ts:599-608) fails CLOSED on a
         missing investor id, a missing folder id, NO MATCHING ROW, and on anything
         but an explicit `view === true`.
       · `dataroomFileOwnerGate` (:798-840) calls it on the investor branch (:835)
         and short-circuits on denial; it is called by exactly two handlers,
         `fileMetaHandler` (:860) and `fileDownloadHandler` (:871).
       · `fileDownloadHandler` is the route that serves the bytes (`res.send(bytes)`,
         :942) and carries a SECOND, INDEPENDENT check (:893 refuses with
         `view_denied` when no row is found, :894 refuses with `download_denied`
         when the row's `download` is not set) requiring BOTH `view` AND `download`.
       · Soft-deleted permission rows never enter the in-memory array at all: both
         hydration reads filter `isNull(deletedAt)` (:441, :501-504).
     The fence works. Nothing could walk up to it. That is what this block fixes,
     and it fixes it WITHOUT relaxing a single one of those checks — an investor with
     no permission row is still refused, because nothing below writes a row.

     THE ROW SOURCE, AND WHY THIS ONE. `crmQ` is the founder's own investor CRM,
     `GET /api/founder/investor-crm`, served by server/founderCrmStore.ts (:445) over
     the `founder_crm_contacts` table, scoped by `ensureCompanyId` to the
     authenticated founder's company. THREE reasons it is the correct source and no
     new table was invented:
       (1) It was ALREADY FETCHED BY THIS SCREEN, for `resolveInvestorName` below.
       (2) `resolveInvestorName` ALREADY MATCHES `c.investorId === iid` against the
           matrix's ids — i.e. the original author already treated the CRM's
           `investorId` and the permission row's `investorId` as ONE key space. This
           change adds no new assumption; it uses the one the file already makes.
       (3) It is the only company-scoped investor list this screen can see without a
           new route, a new store or a new table.

     WHAT THIS DOES NOT DO — the honest limits, so nobody reads more into it:
       · It writes NOTHING. Appearing as a row is not a grant. A row with no stored
         permission renders both switches OFF (the `?? { view: false, download:
         false }` default in the row body below), and the server still holds no row.
       · It WIDENS NO DEFAULT. A new row's default is nothing at all.
       · It grants access to no one until a founder deliberately toggles a switch,
         which is exactly the act that was impossible before.
       · A grant is keyed to the CONTACT'S `investorId`. If that id is not the id the
         investor actually signs in under, the grant will be stored and will still
         open nothing, because `dataroomFileOwnerGate` compares against the
         SERVER-DERIVED `ctx.userId` and never a client-supplied id. That
         identity-space question is written up for the owner in
         build_log/dataroomcrm/DATAROOMCRM_FOR_THE_OWNER.md; it is NOT papered over
         here, and it is not something this screen can resolve on its own.
     ════════════════════════════════════════════════════════════════════════════ */
  const investorIds = useMemo(() => {
    const set = new Set<string>();
    /* Permission holders FIRST, so an investor who already has a row keeps their
       existing position in the table and nothing renumbers above them. */
    perms.forEach(p => set.add(p.investorId));
    /* Then every CRM contact that carries an investor id. `investorId` is returned
       as `r.investorId ?? ""` by the store (server/founderCrmStore.ts:172), so the
       empty string is a real possible value and is skipped — a blank id would render
       a nameless row whose switches wrote a permission keyed to "". */
    (crmQ.data ?? []).forEach(c => { if (c.investorId) set.add(c.investorId); });
    return Array.from(set);
  }, [perms, crmQ.data]);

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
        /* ITEM 7 — this said "Drag-drop upload with watermarking", which the
           product does not do. Corrected to what the page actually offers. */
        description="Folders, permissions, audit events. Drag-drop upload."
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
                  {/* WAVE 22 · ITEM 4 (REVIEW B F-4) — `files = filesQ.data ?? []`
                      turned a 403/500 into zero files, and this card then told a
                      founder with a populated data room "No files yet" and
                      invited them to re-upload documents that already exist —
                      an inducement to duplicate confidential material. Sibling
                      refusal first; the empty state is re-gated on isSuccess. */}
                  {filesQ.isError ? (
                    <div className="p-6">
                      <LoadFailedRefusal
                        what="your data-room files"
                        testId="founder-dataroom-files-error"
                        onRetry={() => void filesQ.refetch()}
                        isRetrying={filesQ.isFetching}
                      />
                    </div>
                  ) : !filesQ.isSuccess ? (
                    <div className="p-12 text-center text-sm text-muted-foreground" data-testid="founder-dataroom-files-not-loaded">
                      Files have not loaded. Check your connection.
                    </div>
                  ) : activeFiles.length === 0 ? (
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
                                {/* ITEM 7 — THE BADGE WAS THE DEFECT. The badge said "Watermarked",
                                    but NOTHING IN THIS TREE MODIFIES FILE BYTES: there is no
                                    PDF library, no image compositing and no per-viewer
                                    stamping. The `watermark` column is a boolean that drives
                                    a CSS overlay on the in-app preview and nothing else, and
                                    the download route streams the ORIGINAL bytes. The badge
                                    now names what the flag really does. */}
                                {f.watermark && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700" data-testid={`badge-preview-marked-${f.id}`}>Preview marked · file not modified</Badge>}
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
                      {/* ITEM 7 — same correction as the list badge above. */}
                      {previewFile.watermark && <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700" data-testid="badge-preview-marked">Preview marked · file not modified</Badge>}
                      <Button size="sm" variant="ghost" onClick={() => setPreviewFile(null)} data-testid="button-close-preview">Close</Button>
                    </div>
                  </div>
                  <div className="relative h-[calc(85vh-49px)] bg-secondary/30 flex items-center justify-center overflow-hidden">
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
                    {/* ITEM 7 (step 4) — THE OVERLAY MOVED, AND IT IS STILL NOT
                        A WATERMARK. Three independent reasons it was invisible:
                          1. it was an EARLIER SIBLING of the <img>/<iframe> in
                             the same stacking context with no z-index, so the
                             asset painted over it;
                          2. `/10` is 10% opacity;
                          3. AN <iframe> CANNOT BE MARKED FROM THE PARENT
                             DOCUMENT AT ALL, so for every PDF — most of a
                             dataroom — no parent DOM node can ever appear
                             inside it.
                        Reasons 1 and 2 are fixed here (moved after the asset,
                        z-10, readable opacity). REASON 3 IS NOT FIXABLE THIS
                        WAY, so the mark is rendered ONLY for image previews and
                        the PDF branch carries an explicit statement instead.
                        THIS DOES NOT RE-LEGITIMISE THE OLD BADGE: the badge copy
                        was corrected in the same change, deliberately, so a
                        visible mark on images cannot be mistaken for real
                        byte-level watermarking. */}
                    {previewFile.watermark && previewFile.mime.startsWith("image/") && (
                      <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                        <div className="text-[hsl(0_100%_40%)]/40 text-3xl font-bold rotate-[-30deg] select-none whitespace-pre-wrap text-center leading-tight" data-testid="watermark-overlay">
                          Confidential — Provided to Authorized Recipient
                          {"\n"}
                          {new Date().toISOString().slice(0, 10)}
                        </div>
                      </div>
                    )}
                    {previewFile.watermark && previewFile.mime === "application/pdf" && (
                      <div className="absolute bottom-0 inset-x-0 z-10 bg-background/95 border-t border-border px-3 py-2 text-[11px] text-muted-foreground" data-testid="text-pdf-not-marked">
                        This PDF is shown exactly as it was uploaded. Capavate does not add a mark to PDF files, and a download will be the original, unmarked document.
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
                    {/* WAVE 22 · ITEM 4 — a failed permissions load is not
                        "no permissions granted". Getting that wrong on an access
                        matrix reads as "nobody can see this data room".
                        The empty row keeps its ORIGINAL position (the guard
                        identifies it as tbody>tr#3; inserting rows above it
                        renumbers it and reads as a drop) and the two new rows
                        are appended after it. */}
                    {/* WAVE 347 · ITEM 2 — `&& !crmQ.isError` ADDED, text and position
                        UNCHANGED. This row is now only truthful when BOTH row sources
                        answered. `investorIds` is seeded from the CRM as well as from
                        `perms`, so a FAILED CRM load also produces an empty row set —
                        and "No investor permissions yet." would then be a silent empty
                        dressed as a fact, telling the founder their investor list is
                        empty when the truth is that it could not be read. The refusal
                        row below says so instead. Original position preserved: the
                        guard identifies this as tbody>tr#3 and the new rows are
                        APPENDED after it, exactly as WAVE 22 · ITEM 4 did. */}
                    {permsQ.isSuccess && !crmQ.isError && investorIds.length === 0 && (
                      <tr><td colSpan={folders.length + 1} className="px-3 py-8 text-center text-muted-foreground">No investor permissions yet.</td></tr>
                    )}
                    {permsQ.isError && (
                      <tr><td colSpan={folders.length + 1} className="px-3 py-4">
                        <LoadFailedRefusal
                          what="the investor permission matrix"
                          testId="founder-dataroom-perms-error"
                          onRetry={() => void permsQ.refetch()}
                          isRetrying={permsQ.isFetching}
                        />
                      </td></tr>
                    )}
                    {!permsQ.isError && !permsQ.isSuccess && (
                      <tr><td colSpan={folders.length + 1} className="px-3 py-8 text-center text-muted-foreground" data-testid="founder-dataroom-perms-not-loaded">Permissions have not loaded. Check your connection.</td></tr>
                    )}
                    {/* WAVE 347 · ITEM 2 — NEW, APPENDED LAST so no existing row moves.
                        The investor list is now one of the two things this table is
                        built from, so a failure to load it has to be SAID. Without
                        this row the founder would see a matrix missing every investor
                        who has no permission row yet — which is every investor they
                        have not already granted — and nothing would tell them why.
                        Same component and same shape as the permissions refusal above,
                        so the two failures read alike. */}
                    {crmQ.isError && (
                      <tr><td colSpan={folders.length + 1} className="px-3 py-4">
                        <LoadFailedRefusal
                          what="your investor list, so investors without an existing permission cannot be shown"
                          testId="founder-dataroom-crm-error"
                          onRetry={() => void crmQ.refetch()}
                          isRetrying={crmQ.isFetching}
                        />
                      </td></tr>
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
                          {/* WAVE 124 · FINDING 1 — the per-investor engagement list
                              printed a raw `u_…` / `usr_…` account key in the position a
                              founder reads as the investor's identity. The engagement
                              payload (`DREngagement.investors`) carries no name, so the
                              key is presented as a labelled reference instead of a bare
                              token; no name is fabricated, and the row stays unique. */}
                          <div className="font-medium">{partyReferenceLabel(i.investorId)}</div>
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
                        <div><span className="font-medium">{e.actor}</span> <span className="text-muted-foreground">{e.action.replace(/_/g, " ")}</span> <span className="font-mono text-xs">{partyReferenceLabel(e.targetId)}</span></div>
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
