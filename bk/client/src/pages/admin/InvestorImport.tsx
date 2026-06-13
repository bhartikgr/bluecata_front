/**
 * Sprint 29 — Admin CSV Roster Importer
 *
 * Route: /admin/investors/import
 *
 * Step 1 (dry-run): drag-and-drop upload → preview table + errors → admin confirms
 * Step 2 (apply): POST with x-confirm: true → progress + per-row status
 * Recovery: errors.csv download if any rows fail
 */

import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  ArrowLeft,
  Users,
} from "lucide-react";

/* ============================================================
 * Types (mirrored from server)
 * ============================================================ */
interface ParsedRow {
  rowNumber: number;
  legalName: string;
  displayName: string;
  email: string;
  kind: string;
  type: string;
  region: string;
  hqCountry: string;
  hqCity: string;
  industries: string[];
  aumMinor: number | null;
  tags: string[];
}

interface ParseError {
  row: number;
  reason: string;
}

interface DryRunResult {
  ok: boolean;
  dryRun: true;
  preview: ParsedRow[];
  errors: ParseError[];
  validRows: number;
  invalidRows: number;
}

interface ApplyResult {
  ok: boolean;
  importedCount: number;
  skippedCount: number;
  errors: ParseError[];
  results: Array<{ row: number; action: string; email: string }>;
}

type Step = "upload" | "preview" | "apply" | "done";

function fmtAum(minor: number | null): string {
  if (minor === null || minor === 0) return "—";
  if (minor >= 1_000_000_00) return `$${(minor / 1_000_000_00).toFixed(0)}M`;
  if (minor >= 100_000) return `$${(minor / 100_000).toFixed(0)}k`;
  return `$${minor}¢`;
}

function generateErrorsCsv(errors: ParseError[]): string {
  const lines = ["row,reason", ...errors.map((e) => `${e.row},"${e.reason.replace(/"/g, '""')}"`)];
  return lines.join("\n");
}

function downloadText(filename: string, content: string, mime = "text/csv"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
 * Component
 * ============================================================ */
export default function AdminInvestorImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  /* ---- Drag-and-drop ---- */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) {
      setSelectedFile(file);
    } else {
      toast({ title: "Invalid file type", description: "Please upload a .csv file", variant: "destructive" });
    }
  }, [toast]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  /* ---- Step 1: Dry run ---- */
  async function runDryRun() {
    if (!selectedFile) return;
    setIsLoading(true);
    setProgress(30);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      // No x-confirm header → dry-run
      const res = await fetch("/api/admin/contacts/import-csv", {
        method: "POST",
        body: fd,
      });
      setProgress(80);
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Upload failed", description: data.error ?? "Unknown error", variant: "destructive" });
        return;
      }
      setDryRunResult(data as DryRunResult);
      setStep("preview");
    } catch (e) {
      toast({ title: "Network error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  }

  /* ---- Step 2: Apply ---- */
  async function applyImport() {
    if (!selectedFile) return;
    setIsLoading(true);
    setStep("apply");
    setProgress(20);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      const res = await fetch("/api/admin/contacts/import-csv", {
        method: "POST",
        headers: { "x-confirm": "true" },
        body: fd,
      });
      setProgress(90);
      const data = await res.json();
      setApplyResult(data as ApplyResult);
      setStep("done");
      toast({
        title: "Import complete",
        description: `${data.importedCount} contacts imported, ${data.skippedCount} skipped`,
      });
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
      setStep("preview");
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  }

  /* ---- Reset ---- */
  function reset() {
    setStep("upload");
    setSelectedFile(null);
    setDryRunResult(null);
    setApplyResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /* ---- Render ---- */
  return (
    <>
      <PageHeader
        title="Bulk Import Contacts"
        description="Upload a CSV to create or update investors, founders, and consortium partners in bulk."
        breadcrumbs={[
          { label: "Admin" },
          { href: "/admin/investors", label: "Contacts CRM" },
          { label: "Bulk Import" },
        ]}
        actions={
          <Link href="/admin/investors">
            <Button variant="outline" size="sm" className="gap-1.5" data-testid="btn-back-to-contacts">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to contacts
            </Button>
          </Link>
        }
      />

      <PageBody>
        <div className="max-w-4xl mx-auto space-y-6">

          {/* ── Step 1: Upload ─────────────────────────────── */}
          {step === "upload" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Upload CSV file
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Drag-and-drop zone */}
                <div
                  data-testid="dropzone"
                  className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
                    ${isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  {selectedFile ? (
                    <div>
                      <p className="font-medium text-sm" data-testid="text-selected-file">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium">Drop your CSV here or click to browse</p>
                      <p className="text-xs text-muted-foreground mt-1">Max 5MB · CSV files only</p>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    data-testid="input-file"
                    onChange={handleFileChange}
                  />
                </div>

                {/* Sample CSV download */}
                <div className="flex items-center gap-3 pt-2">
                  <a href="/api/admin/contacts/sample-csv" download="contacts_sample.csv" data-testid="link-sample-csv">
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <Download className="h-3.5 w-3.5" />
                      Download sample CSV
                    </Button>
                  </a>
                  <span className="text-xs text-muted-foreground">3 rows — 1 investor, 1 founder, 1 partner</span>
                </div>

                {/* Column reference */}
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs font-mono">
                    Required: legalName, displayName, email, kind (investor|founder|consortium_partner)
                    <br />
                    Optional: type, region, hqCountry, hqCity, industries, aumMinor, checkSizeMinMinor, checkSizeMaxMinor, partnerWeight, partnerSince, tags
                  </AlertDescription>
                </Alert>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={runDryRun}
                    disabled={!selectedFile || isLoading}
                    className="gap-1.5"
                    data-testid="btn-dry-run"
                  >
                    {isLoading ? "Parsing…" : "Preview import"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Step 2: Preview ────────────────────────────── */}
          {step === "preview" && dryRunResult && (
            <>
              {/* Summary bar */}
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-emerald-600" data-testid="text-valid-rows">{dryRunResult.validRows}</div>
                    <div className="text-xs text-muted-foreground mt-1">Valid rows</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold text-rose-600" data-testid="text-invalid-rows">{dryRunResult.invalidRows}</div>
                    <div className="text-xs text-muted-foreground mt-1">Invalid rows</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <div className="text-2xl font-bold" data-testid="text-total-rows">{dryRunResult.validRows + dryRunResult.invalidRows}</div>
                    <div className="text-xs text-muted-foreground mt-1">Total rows</div>
                  </CardContent>
                </Card>
              </div>

              {/* Validation errors */}
              {dryRunResult.errors.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-rose-600 flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      Validation errors ({dryRunResult.errors.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0">
                    <Table data-testid="table-errors">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Row</TableHead>
                          <TableHead>Reason</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dryRunResult.errors.map((e, i) => (
                          <TableRow key={i} data-testid={`row-error-${e.row}`}>
                            <TableCell className="font-mono text-xs">{e.row}</TableCell>
                            <TableCell className="text-xs text-rose-700">{e.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Preview table */}
              {dryRunResult.preview.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      Preview — {dryRunResult.preview.length} valid rows
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0">
                    <div className="overflow-x-auto">
                      <Table data-testid="table-preview">
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Legal Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Kind</TableHead>
                            <TableHead>Region</TableHead>
                            <TableHead>Industries</TableHead>
                            <TableHead className="text-right">AUM</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dryRunResult.preview.map((row) => (
                            <TableRow key={row.rowNumber} data-testid={`row-preview-${row.rowNumber}`}>
                              <TableCell className="font-mono text-xs">{row.rowNumber}</TableCell>
                              <TableCell className="text-xs font-medium">{row.legalName}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{row.email}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">{row.kind}</Badge>
                              </TableCell>
                              <TableCell className="text-xs">{row.region}</TableCell>
                              <TableCell className="text-xs">{row.industries.slice(0, 2).join(", ")}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{fmtAum(row.aumMinor)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={applyImport}
                  disabled={isLoading || dryRunResult.validRows === 0}
                  className="gap-1.5"
                  data-testid="btn-apply-import"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Apply import ({dryRunResult.validRows} rows)
                </Button>
                <Button variant="outline" onClick={reset} data-testid="btn-start-over">
                  Start over
                </Button>
                {dryRunResult.errors.length > 0 && (
                  <Button
                    variant="outline"
                    onClick={() => downloadText("errors.csv", generateErrorsCsv(dryRunResult.errors))}
                    data-testid="btn-download-errors"
                    className="gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download errors.csv
                  </Button>
                )}
              </div>
            </>
          )}

          {/* ── Step 3: Applying ───────────────────────────── */}
          {step === "apply" && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-3">
                  <Upload className="h-5 w-5 animate-pulse text-primary" />
                  <span className="text-sm font-medium">Applying import…</span>
                </div>
                <Progress value={progress} className="h-2" data-testid="progress-apply" />
                <p className="text-xs text-muted-foreground">Creating and updating contacts, auditing each row…</p>
              </CardContent>
            </Card>
          )}

          {/* ── Step 4: Done ───────────────────────────────── */}
          {step === "done" && applyResult && (
            <>
              <Alert className="border-emerald-200 bg-emerald-50">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertDescription>
                  <span className="font-medium text-emerald-700">Import complete.</span>{" "}
                  <span className="text-emerald-600">
                    {applyResult.importedCount} contacts imported
                    {applyResult.skippedCount > 0 ? `, ${applyResult.skippedCount} skipped` : ""}.
                  </span>
                </AlertDescription>
              </Alert>

              {/* Results table */}
              {applyResult.results.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Import results</CardTitle>
                  </CardHeader>
                  <CardContent className="px-0">
                    <Table data-testid="table-results">
                      <TableHeader>
                        <TableRow>
                          <TableHead>#</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {applyResult.results.map((r, i) => (
                          <TableRow key={i} data-testid={`row-result-${r.row}`}>
                            <TableCell className="font-mono text-xs">{r.row}</TableCell>
                            <TableCell className="text-xs">{r.email}</TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${r.action === "created" ? "border-emerald-400 text-emerald-700" : "border-blue-400 text-blue-700"}`}
                                data-testid={`badge-action-${r.row}`}
                              >
                                {r.action}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Error rows */}
              {applyResult.errors.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-rose-600 flex items-center gap-2">
                      <XCircle className="h-4 w-4" />
                      {applyResult.errors.length} rows failed
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => downloadText("errors.csv", generateErrorsCsv(applyResult.errors))}
                      data-testid="btn-download-errors-done"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download errors.csv
                    </Button>
                  </CardContent>
                </Card>
              )}

              <div className="flex gap-2">
                <Button onClick={reset} variant="outline" data-testid="btn-import-another">
                  Import another file
                </Button>
                <Link href="/admin/investors">
                  <Button data-testid="btn-view-contacts">View contacts</Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </PageBody>
    </>
  );
}
