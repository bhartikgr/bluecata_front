/**
 * W2 A6 — optional KYC document upload profile convenience.
 *
 * This card is entirely OPTIONAL: uploading a document here never gates
 * Collective access and never participates in the server or client gate
 * decisions in `CollectiveMemberGate` / `GET /api/collective/gate-state`.
 * It is a convenience surface only — real company/founder verification is
 * a separate process. Do NOT mount this inside `CollectiveMemberGate`.
 *
 * POSTs multipart `FormData` (field `file`) to `/api/collective/kyc-upload`,
 * which accepts `.pdf,.jpg,.jpeg,.png` up to 20MB and returns
 * `{ ok:true, id, url }`. We never auto-load or preview the uploaded binary
 * — only a lazy link to the returned URL is shown after a successful upload.
 */
import { useRef, useState } from "react";
import { FileUp, CheckCircle2, AlertCircle, RotateCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import type { CollectiveLegalCopy } from "@shared/collectiveLegalCopy";

type UploadState = "empty" | "validating" | "uploading" | "success" | "failure";

const ACCEPTED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];

function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXT.some((ext) => lower.endsWith(ext));
}

export function OptionalKycUploadCard({
  copy,
  onUploaded,
}: {
  copy?: CollectiveLegalCopy;
  onUploaded?: (doc: { id: string; url: string }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("empty");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<{ id: string; url: string; name: string } | null>(null);

  const doUpload = async (file: File) => {
    setState("validating");
    setErrorMessage(null);
    if (!hasAcceptedExtension(file.name)) {
      setState("failure");
      setErrorMessage("Only PDF, JPG, or PNG files are accepted.");
      return;
    }
    setState("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiRequest("POST", "/api/collective/kyc-upload", fd);
      const data = await res.json();
      if (!data?.ok) {
        setState("failure");
        setErrorMessage(data?.message || data?.error || "Upload failed. Try again.");
        return;
      }
      const doc = { id: data.id as string, url: data.url as string };
      setUploaded({ ...doc, name: file.name });
      setState("success");
      onUploaded?.(doc);
    } catch (e: any) {
      setState("failure");
      setErrorMessage(e?.message || "Network error — try again.");
    }
  };

  const onFileChange = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void doUpload(file);
  };

  const reset = () => {
    setState("empty");
    setErrorMessage(null);
    setUploaded(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <Card data-testid="optional-kyc-upload-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileUp className="h-4 w-4" /> Optional KYC documents
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Optional KYC documents. Uploading is not required for Collective access and does not
          replace company/founder verification.
        </p>

        {copy && (
          <div
            className="rounded-md border p-3 text-[12px] leading-relaxed"
            style={{ background: "var(--cv-surface-muted, #f8fafc)", borderColor: "var(--cv-border, #e2e8f0)", color: "var(--cv-text-muted, #475569)" }}
            data-testid={`collective-legal-copy-${copy.slot}`}
          >
            <div className="mb-1.5 flex items-center gap-2">
              {copy.status === "NON_LEGAL_ADVICE" && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide" data-testid={`badge-non-legal-advice-${copy.slot}`}>
                  NON-LEGAL-ADVICE
                </Badge>
              )}
              {copy.title && <span className="text-xs font-semibold">{copy.title}</span>}
            </div>
            <p className="whitespace-pre-wrap">{copy.body}</p>
          </div>
        )}

        {state === "success" && uploaded ? (
          <div
            className="rounded-md border p-3 text-sm flex items-center gap-2"
            style={{ background: "var(--cv-ok-bg, #ecfdf5)", borderColor: "var(--cv-ok-border, #a7f3d0)", color: "var(--cv-ok-text, #065f46)" }}
            data-testid="optional-kyc-upload-success"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Uploaded <span className="font-medium">{uploaded.name}</span> ·{" "}
              <a href={uploaded.url} className="underline" data-testid="link-optional-kyc-uploaded-doc">
                View document
              </a>
            </span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={reset} data-testid="button-optional-kyc-upload-another">
              Upload another
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => onFileChange(e.target.files)}
              disabled={state === "validating" || state === "uploading"}
              data-testid="input-optional-kyc-upload"
              className="text-sm"
            />
            {(state === "validating" || state === "uploading") && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5" data-testid="optional-kyc-upload-progress">
                <RotateCw className="h-3.5 w-3.5 animate-spin" />
                {state === "validating" ? "Checking file…" : "Uploading…"}
              </div>
            )}
            {state === "failure" && (
              <div
                className="rounded-md border p-3 text-sm flex items-start gap-2"
                style={{ background: "var(--cv-warn-bg, #fffbeb)", borderColor: "var(--cv-warn-border, #fde68a)", color: "var(--cv-warn-text, #92400e)" }}
                data-testid="optional-kyc-upload-failure"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div>{errorMessage ?? "Upload failed. Try again."}</div>
                  <Button variant="outline" size="sm" className="mt-2" onClick={reset} data-testid="button-optional-kyc-upload-retry">
                    Try again
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OptionalKycUploadCard;
