/**
 * WAVE 18 — ORP-040 (DEF-040), KYC half: the orphaned investor KYC document
 * surface.
 *
 * WHAT WAS WRONG. Two live endpoints, registered at server/routes.ts:1143
 * (`registerKycDocumentRoutes`), had ZERO client callers — an investor could not
 * upload a single KYC document from anywhere in the product, and could not see
 * what had already been uploaded or whether an administrator had verified it:
 *
 *   POST /api/investor/kyc/documents   server/lib/kycDocumentStore.ts:132
 *   GET  /api/investor/kyc/documents   server/lib/kycDocumentStore.ts:218
 *
 * Verified by `grep -rn "kyc/documents" client/src` before this file existed:
 * no match. So this item is **WIRING** — no route, no store method, no migration.
 *
 * SCOPING IS THE SERVER'S. Both routes read `ctx.userId` from the session and the
 * GET filters `WHERE investor_id = ?` (:227). No investor id is ever sent from
 * this client; a client-supplied id would be an authorisation hole.
 *
 * DOC TYPES ARE NOT DUPLICATED BY HAND. The five allowed values are the ones the
 * server validates against (`KYC_DOC_TYPES`, kycDocumentStore.ts:39), and the
 * server answers 400 `invalid_doc_type` with the allowed list for anything else.
 * The list here is deliberately declared once, exported, and asserted in the suite
 * against the server constant, so a drift cannot ship an option that always fails.
 *
 * FAIL-CLOSED STATES ARE RENDERED. Every documented refusal has copy:
 * `invalid_doc_type` (400), `fileName_required` / `mimeType_required` /
 * `blobBase64_required` (400), `invalid_base64` (400), `empty_blob` (400),
 * `file_too_large` (413, `maxBytes` echoed by the server at :164) and
 * `insert_failed` (500). None of them is swallowed and none is shown as success.
 *
 * NO MONEY on this surface, so there is no `formatMinor` call and no currency —
 * intentionally, since inventing one would be worse than omitting it.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";

/** Mirrors `KYC_DOC_TYPES` (server/lib/kycDocumentStore.ts:39) — the exact list
 *  the POST route validates against at :139. */
export const KYC_DOC_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's licence" },
  { value: "accreditation_letter", label: "Accreditation letter" },
  { value: "source_of_funds", label: "Source of funds" },
  { value: "other", label: "Other" },
];

/** Mirrors `KycDocSummary` (server/lib/kycDocumentStore.ts rowToSummary). */
export interface KycDocSummary {
  id: string;
  investorId: string;
  kycId: string | null;
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

/** Every refusal the two routes can return, with human copy. Keys are the exact
 *  `error` strings in server/lib/kycDocumentStore.ts. */
export const KYC_ERROR_COPY: Record<string, string> = {
  invalid_doc_type: "That document type is not accepted. Choose one of the listed types.",
  fileName_required: "Choose a file before uploading.",
  mimeType_required: "This file has no detectable type. Try a PDF or an image.",
  blobBase64_required: "The file could not be read. Try selecting it again.",
  invalid_base64: "The file could not be encoded for upload. Try selecting it again.",
  empty_blob: "That file is empty.",
  file_too_large: "That file is larger than the 10 MB limit.",
  insert_failed: "The upload could not be saved. Nothing was stored — please retry.",
  UNAUTHORIZED: "Your session has expired. Sign in again to upload documents.",
};

export function kycErrorCopy(error: string | null | undefined): string {
  if (!error) return "The upload did not complete. Nothing was stored.";
  return KYC_ERROR_COPY[error] ?? `The upload was refused (${error}). Nothing was stored.`;
}

/** Bytes → a short human string. Not money; no currency involved. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Strip the `data:...;base64,` prefix a FileReader data-URL carries, because the
 *  server does `Buffer.from(blobBase64, "base64")` on the raw value (:155). */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 && dataUrl.slice(0, comma).includes("base64") ? dataUrl.slice(comma + 1) : dataUrl;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_failed"));
    reader.onload = () => resolve(stripDataUrlPrefix(String(reader.result ?? "")));
    reader.readAsDataURL(file);
  });
}

export function InvestorKycDocumentsPanel() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [docType, setDocType] = useState<string>("passport");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);

  const listQ = useQuery<{ ok: boolean; documents?: KycDocSummary[]; error?: string }>({
    queryKey: ["/api/investor/kyc/documents"],
    queryFn: async () => (await apiRequest("GET", "/api/investor/kyc/documents")).json(),
    retry: false,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const blobBase64 = await readFileAsBase64(file);
      const res = await apiRequest("POST", "/api/investor/kyc/documents", {
        docType,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        blobBase64,
      });
      const body = await res.json();
      if (!res.ok || body?.ok === false) {
        throw new Error(String(body?.error ?? `http_${res.status}`));
      }
      return body as { ok: true; document: KycDocSummary };
    },
    onSuccess: (body) => {
      setRefusal(null);
      setUploaded(body.document.fileName);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["/api/investor/kyc/documents"] });
    },
    onError: (err: Error) => {
      setUploaded(null);
      setRefusal(err.message);
    },
  });

  const docs = listQ.data?.documents ?? [];

  return (
    <Card className="mb-6" data-testid="investor-kyc-documents-panel">
      <CardHeader>
        <CardTitle className="text-lg">KYC documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground">
          Documents you upload here are stored with a SHA-256 checksum so an
          administrator can verify they have not been altered. Only you and an
          administrator can see them.
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="kyc-doc-type" className="text-xs">
              Document type
            </Label>
            <select
              id="kyc-doc-type"
              data-testid="investor-kyc-doc-type"
              className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              {KYC_DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="kyc-doc-file" className="text-xs">
              File (10 MB maximum)
            </Label>
            <input
              id="kyc-doc-file"
              data-testid="investor-kyc-file"
              ref={fileRef}
              type="file"
              className="mt-1 block text-sm"
            />
          </div>
          <Button
            data-testid="investor-kyc-upload"
            disabled={upload.isPending}
            onClick={() => {
              const f = fileRef.current?.files?.[0];
              if (!f) {
                setUploaded(null);
                setRefusal("fileName_required");
                return;
              }
              upload.mutate(f);
            }}
          >
            {upload.isPending ? "Uploading…" : "Upload document"}
          </Button>
        </div>

        {refusal && (
          <div className="text-sm text-amber-900" data-testid="investor-kyc-refusal">
            {kycErrorCopy(refusal)}
          </div>
        )}
        {uploaded && !refusal && (
          <div className="text-sm text-emerald-900" data-testid="investor-kyc-uploaded">
            Uploaded {uploaded}. An administrator will review it.
          </div>
        )}

        <div>
          <div className="text-sm font-semibold">Uploaded so far</div>
          {listQ.isLoading && <Skeleton className="h-16 w-full mt-2" />}
          {listQ.isError && (
            <div className="mt-2 text-sm text-amber-900" data-testid="investor-kyc-list-error">
              Your documents could not be loaded right now. Nothing has been lost.
            </div>
          )}
          {!listQ.isLoading && !listQ.isError && docs.length === 0 && (
            <div className="mt-2 text-sm text-muted-foreground" data-testid="investor-kyc-empty">
              No documents uploaded yet.
            </div>
          )}
          {docs.length > 0 && (
            <ul className="mt-2 space-y-2">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                  data-testid={`investor-kyc-row-${d.id}`}
                >
                  <span>
                    <span className="font-medium">{d.fileName}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {KYC_DOC_TYPE_OPTIONS.find((o) => o.value === d.docType)?.label ?? d.docType}
                      {" · "}
                      {formatBytes(d.sizeBytes)}
                    </span>
                  </span>
                  {d.verified ? (
                    <Badge data-testid={`investor-kyc-verified-${d.id}`}>Verified</Badge>
                  ) : (
                    <Badge variant="outline" data-testid={`investor-kyc-pending-${d.id}`}>
                      Awaiting verification
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default InvestorKycDocumentsPanel;
