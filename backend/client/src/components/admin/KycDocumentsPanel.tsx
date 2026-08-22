/* W-KYC — Admin KYC documents panel.
 *
 * Lists an investor's uploaded KYC documents, lets an admin download the raw
 * blob, and (AK.2) mark each document verified / rejected with optional notes.
 * Reads/writes ONLY the non-sacred kyc_documents backend:
 *   GET  /api/admin/kyc/documents/:investorId        (reconciles derived_inv_*)
 *   POST /api/admin/kyc/documents/:docId/verify       { verified, notes? }
 *   GET  /api/admin/kyc/documents/:docId/blob          (admin-only download)
 * No raw storage key is ever exposed (blobs are streamed by the admin route).
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ShieldX, Download, FileText } from "lucide-react";
import { fmtLocaleDateTime } from "@/lib/format"; /* WAVE 87 · ITEM 1 */

interface KycDoc {
  id: string;
  investorId: string;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNotes: string | null;
  uploadedAt: string;
}
interface KycListResponse {
  ok: boolean;
  investorId: string;
  resolvedInvestorId?: string;
  wasDerived?: boolean;
  documents: KycDoc[];
}

const DOC_TYPE_LABEL: Record<string, string> = {
  passport: "Passport",
  drivers_license: "Driver's license",
  accreditation_letter: "Accreditation letter",
  source_of_funds: "Source of funds",
  other: "Other",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
/* WAVE 87 · ITEM 1 — THIS LOCAL HELPER SHADOWED THE SAFE ONE.
   Twelve files define their own `fmtDate`/`formatIsoDate` whose body is the
   exact defect reviewer 1 reported: `new Date("2026-06-15")` parses as UTC
   midnight, so any local-time reader prints ONE DAY EARLY west of UTC (the
   owner is in New York). Only the BODY changes — every call site is untouched,
   so a timestamp renders byte-identically and nothing is restyled, while a
   date-only value now renders the day that was entered. */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return fmtLocaleDateTime(iso, undefined, undefined, iso);
}

export default function KycDocumentsPanel({ investorId }: { investorId: string }) {
  const { toast } = useToast();
  const [notesById, setNotesById] = useState<Record<string, string>>({});

  const listKey = ["/api/admin/kyc/documents", investorId];
  const { data, isLoading, isError, refetch, isFetching } = useQuery<KycListResponse>({
    queryKey: listKey,
    queryFn: async () => (await apiRequest("GET", `/api/admin/kyc/documents/${encodeURIComponent(investorId)}`)).json(),
    retry: false,
  });

  const verifyMut = useMutation({
    mutationFn: async (v: { docId: string; verified: boolean; notes?: string }) => {
      const r = await apiRequest("POST", `/api/admin/kyc/documents/${encodeURIComponent(v.docId)}/verify`, {
        verified: v.verified,
        notes: v.notes ?? null,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "verify_failed");
      return j;
    },
    onSuccess: (_j, v) => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: v.verified ? "Document marked verified" : "Document marked rejected" });
    },
    onError: (e: any) => toast({ title: "Verify failed", description: e?.message, variant: "destructive" }),
  });

  async function downloadBlob(doc: KycDoc) {
    try {
      const res = await apiRequest("GET", `/api/admin/kyc/documents/${encodeURIComponent(doc.id)}/blob`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message, variant: "destructive" });
    }
  }

  const docs = data?.documents ?? [];

  return (
    <Card data-testid="kyc-documents-panel">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" /> KYC documents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data?.wasDerived && (
          <p className="mb-3 text-xs text-muted-foreground" data-testid="kyc-reconcile-note">
            Showing documents for the resolved investor account
            {data.resolvedInvestorId ? ` (${data.resolvedInvestorId.slice(0, 12)}…)` : ""}.
          </p>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="kyc-loading">Loading documents…</p>
        ) : isError || (data && !data.ok) ? (
          <div className="flex flex-col items-start gap-2" data-testid="kyc-error">
            <p className="text-sm text-rose-600">Couldn’t load KYC documents.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="kyc-retry">
              {isFetching ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="kyc-empty">
            No KYC documents uploaded by this investor.
          </p>
        ) : (
          <div className="space-y-3" data-testid="kyc-list">
            {docs.map((doc) => (
              <div key={doc.id} className="rounded-md border p-3" data-testid={`kyc-doc-${doc.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{doc.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {DOC_TYPE_LABEL[doc.docType] ?? doc.docType} · {fmtBytes(doc.sizeBytes)} · uploaded {fmtDate(doc.uploadedAt)}
                    </div>
                  </div>
                  {doc.verified ? (
                    <Badge className="bg-emerald-100 text-emerald-800" data-testid={`kyc-status-${doc.id}`}>Verified</Badge>
                  ) : (
                    <Badge variant="outline" data-testid={`kyc-status-${doc.id}`}>Unverified</Badge>
                  )}
                </div>

                {doc.verified && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Verified by {doc.verifiedBy ?? "—"} on {fmtDate(doc.verifiedAt)}
                    {doc.verificationNotes ? ` — ${doc.verificationNotes}` : ""}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => downloadBlob(doc)} data-testid={`kyc-download-${doc.id}`}>
                    <Download className="h-3.5 w-3.5 mr-1" /> Download
                  </Button>
                  <Input
                    value={notesById[doc.id] ?? ""}
                    onChange={(e) => setNotesById((m) => ({ ...m, [doc.id]: e.target.value }))}
                    placeholder="Verification notes (optional)"
                    className="h-8 max-w-xs text-xs"
                    data-testid={`kyc-notes-${doc.id}`}
                  />
                  {!doc.verified ? (
                    <Button
                      size="sm"
                      onClick={() => verifyMut.mutate({ docId: doc.id, verified: true, notes: notesById[doc.id] })}
                      disabled={verifyMut.isPending}
                      data-testid={`kyc-verify-${doc.id}`}
                    >
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Mark verified
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => verifyMut.mutate({ docId: doc.id, verified: false, notes: notesById[doc.id] })}
                      disabled={verifyMut.isPending}
                      data-testid={`kyc-reject-${doc.id}`}
                    >
                      <ShieldX className="h-3.5 w-3.5 mr-1" /> Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
