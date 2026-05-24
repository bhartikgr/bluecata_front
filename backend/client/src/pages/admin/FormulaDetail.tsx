import { useMemo, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Copy, Play, CheckCircle2, XCircle, ArrowLeft, ScrollText } from "lucide-react";
import { listFormulas, type FormulaRecord } from "@capavate/cap-table-engine";
import { useAdminStore } from "@/lib/adminStore";
import { useToast } from "@/hooks/use-toast";

export default function AdminFormulaDetail() {
 const [, params] = useRoute<{ id: string }>("/admin/formulas/:id");
 const [, navigate] = useLocation();
 const { customFormulas, formulaDrafts, saveDraft, recordTestRun, appendAudit } = useAdminStore();
 const { toast } = useToast();

 const allFormulas = useMemo(() => [...listFormulas(), ...customFormulas], [customFormulas]);
 const formula = useMemo(() => {
 const decoded = decodeURIComponent(params?.id ?? "");
 return allFormulas.find((f) => `${f.region}:${f.id}:${f.version}` === decoded);
 }, [allFormulas, params?.id]);

 const [editorText, setEditorText] = useState<string>(() =>
 JSON.stringify(formula?.definition ?? {}, null, 2),
 );
 const [running, setRunning] = useState(false);
 const [testResult, setTestResult] = useState<{ pass: boolean; passed: number; failed: number; ran: string } | null>(null);

 if (!formula) {
 return <PageBody><div className="text-center py-20 text-muted-foreground">Formula not found.</div></PageBody>;
 }

 const isBuiltIn = !customFormulas.includes(formula);
 const draftKey = `${formula.region}:${formula.id}:${formula.version}`;
 const draft = formulaDrafts[draftKey];
 const editing = !isBuiltIn || formula.status === "draft";

 function clone() {
 const newVersion = bumpPatch(formula!.version);
 const cloned: FormulaRecord = {
 ...formula!,
 version: newVersion,
 status: "draft",
 region: formula!.region === "Custom" ? "Custom" : formula!.region,
 };
 saveDraft(`${cloned.region}:${cloned.id}:${cloned.version}`, cloned);
 appendAudit({ actor: "ops@capavate.com", action: "formula.cloned", target: cloned.id, payload: { from: formula!.version, to: newVersion } });
 toast({ title: "Variant cloned", description: `Draft created at ${newVersion}` });
 }

 function runTests() {
 setRunning(true);
 setTimeout(() => {
 // Simulate running golden-master against this variant
 let valid = true;
 try { JSON.parse(editorText); } catch { valid = false; }
 const passed = valid ? 3 : 2;
 const failed = valid ? 0 : 1;
 const result = { pass: failed === 0, passed, failed, ran: new Date().toISOString() };
 setTestResult(result);
 recordTestRun(draftKey, { formulaKey: draftKey, status: result.pass ? "pass" : "fail", passed, failed, ranAt: result.ran });
 appendAudit({ actor: "ops@capavate.com", action: "formula.tested", target: formula!.id, payload: { passed, failed } });
 setRunning(false);
 toast({ title: result.pass ? "All tests passed" : "Tests failed", description: `${passed} passed, ${failed} failed` });
 }, 600);
 }

 function saveDraftClick() {
 try {
 const parsed = JSON.parse(editorText);
 const updated: FormulaRecord = { ...formula!, definition: parsed, status: "draft" };
 saveDraft(draftKey, updated);
 appendAudit({ actor: "ops@capavate.com", action: "formula.draft_saved", target: formula!.id, payload: { defKeys: Object.keys(parsed) } });
 toast({ title: "Draft saved", description: "Definition stored in admin store." });
 } catch (e) {
 toast({ title: "Invalid JSON", description: String(e), variant: "destructive" });
 }
 }

 return (
 <>
 <PageHeader
 title={formula.name}
 description={formula.id}
 breadcrumbs={[
 { label: "Admin" },
 { href: "/admin/formulas", label: "Formulas" },
 { label: formula.id },
 ]}
 actions={
 <>
 <Button variant="outline" onClick={() => navigate("/admin/formulas")} data-testid="button-back"><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button>
 <Button variant="outline" onClick={clone} data-testid="button-clone"><Copy className="h-4 w-4 mr-2" /> Clone</Button>
 <Button onClick={runTests} disabled={running} data-testid="button-run-tests" className="bg-[hsl(327_77%_30%)] hover:bg-[hsl(327_77%_24%)] text-white">
 <Play className="h-4 w-4 mr-2" /> {running ? "Running…" : "Run tests"}
 </Button>
 </>
 }
 />
 <PageBody>
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
 <div className="lg:col-span-2 space-y-4">
 <Card>
 <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
 <CardTitle className="text-base flex items-center gap-2">
 Definition (JSON)
 {isBuiltIn ? <Badge variant="outline" className="text-[10px]">Read-only · built-in</Badge> : <Badge className="bg-amber-100 text-amber-900 border-0 text-[10px]">Editable draft</Badge>}
 </CardTitle>
 {!isBuiltIn && <Button size="sm" variant="outline" onClick={saveDraftClick} data-testid="button-save-draft">Save draft</Button>}
 </CardHeader>
 <CardContent>
 <Textarea
 value={editorText}
 onChange={(e) => setEditorText(e.target.value)}
 readOnly={!editing}
 className="font-mono text-xs min-h-[320px] bg-secondary/40"
 data-testid="textarea-formula-definition"
 />
 </CardContent>
 </Card>

 {testResult && (
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base flex items-center gap-2">
 Test result
 {testResult.pass ? (
 <Badge className="bg-emerald-100 text-emerald-900 border-0 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-1" /> All passing</Badge>
 ) : (
 <Badge className="bg-rose-100 text-rose-900 border-0 text-[10px]"><XCircle className="h-3 w-3 mr-1" /> Failures</Badge>
 )}
 </CardTitle>
 </CardHeader>
 <CardContent className="text-sm space-y-1">
 <div className="text-muted-foreground">Ran at: {new Date(testResult.ran).toLocaleString()}</div>
 <div><span className="text-emerald-600 font-mono">{testResult.passed}</span> passed · <span className="text-rose-600 font-mono">{testResult.failed}</span> failed</div>
 </CardContent>
 </Card>
 )}
 </div>

 <div className="space-y-4">
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base">Metadata</CardTitle></CardHeader>
 <CardContent className="space-y-2 text-sm">
 <Row label="ID" value={<span className="font-mono text-xs">{formula.id}</span>} />
 <Row label="Region" value={<Badge variant="outline">{formula.region}</Badge>} />
 <Row label="Version" value={<span className="font-mono">{formula.version}</span>} />
 <Row label="Status" value={<span className="capitalize">{formula.status}</span>} />
 <Row label="Category" value={<span className="capitalize text-muted-foreground">{formula.category.replace(/_/g, " ")}</span>} />
 </CardContent>
 </Card>

 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ScrollText className="h-4 w-4" /> Citation</CardTitle></CardHeader>
 <CardContent className="space-y-2 text-sm">
 <div className="font-medium">{formula.citation.source}</div>
 {formula.citation.url && (
 <a href={formula.citation.url} target="_blank" rel="noreferrer" className="text-xs text-[hsl(184_98%_22%)] hover:underline inline-flex items-center gap-1">
 {formula.citation.url} <ExternalLink className="h-3 w-3" />
 </a>
 )}
 {formula.citation.note && <p className="text-xs text-muted-foreground italic">{formula.citation.note}</p>}
 </CardContent>
 </Card>

 {draft && (
 <Card>
 <CardHeader className="pb-3"><CardTitle className="text-base">Active draft</CardTitle></CardHeader>
 <CardContent className="text-xs text-muted-foreground">
 Last saved draft for this formula version is in the admin store. Promote to active by adjusting status (not yet wired in preview).
 </CardContent>
 </Card>
 )}
 </div>
 </div>
 </PageBody>
 </>
 );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
 return (
 <div className="flex items-center justify-between gap-3">
 <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
 <span>{value}</span>
 </div>
 );
}

function bumpPatch(v: string): string {
 const [maj, min, patch] = v.split(".").map((n) => parseInt(n, 10) || 0);
 return `${maj}.${min}.${patch + 1}`;
}
