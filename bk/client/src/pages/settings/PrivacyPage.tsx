/**
 * CP Phase B — User privacy / GDPR self-service page.
 *
 *   GET   /api/me/data-export                 → JSON download
 *   POST  /api/me/data-delete                 { reason? }              → { token, requestedAt }
 *   POST  /api/me/data-delete/confirm         { token }                → { ok: true, deletedAt }
 *
 * Auth required; server resolves the user from session. Delete is a TWO-STEP
 * flow: requesting issues a token (echoed to the user via email by the
 * server, but also returned in the JSON response for in-session
 * confirmation). The user must paste/click confirm with that token within
 * the server-side TTL window.
 *
 * No mock data; no localStorage of tokens; no TODOs.
 */
import { useCallback, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Download, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

/* ---------------------------- helpers ---------------------------- */

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = j?.error ?? "";
    } catch {
      detail = await r.text().catch(() => "");
    }
    throw new Error(`HTTP ${r.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await r.json()) as T;
}

/* ----------------------------- page ----------------------------- */

export default function PrivacyPage() {
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSizeBytes, setExportSizeBytes] = useState<number | null>(null);

  const [reason, setReason] = useState<string>("");
  const [deleteToken, setDeleteToken] = useState<string | null>(null);
  const [requestedAt, setRequestedAt] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<boolean>(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [confirmTokenInput, setConfirmTokenInput] = useState<string>("");
  const [confirming, setConfirming] = useState<boolean>(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [deletedAt, setDeletedAt] = useState<string | null>(null);

  const doExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const r = await fetch("/api/me/data-export", {
        method: "GET",
        credentials: "include",
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}${txt ? `: ${txt.slice(0, 200)}` : ""}`);
      }
      const blob = await r.blob();
      setExportSizeBytes(blob.size);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `data-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a tick so the browser has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }, []);

  const requestDelete = useCallback(async () => {
    setRequesting(true);
    setRequestError(null);
    setDeleteToken(null);
    setRequestedAt(null);
    try {
      const r = await postJson<{ token: string; requestedAt: string }>(
        "/api/me/data-delete",
        { reason: reason.trim() || undefined },
      );
      setDeleteToken(r.token);
      setRequestedAt(r.requestedAt);
      setConfirmTokenInput(r.token);
    } catch (e) {
      setRequestError((e as Error).message);
    } finally {
      setRequesting(false);
    }
  }, [reason]);

  const confirmDelete = useCallback(async () => {
    setConfirming(true);
    setConfirmError(null);
    setDeletedAt(null);
    try {
      const r = await postJson<{ ok: boolean; deletedAt: string }>(
        "/api/me/data-delete/confirm",
        { token: confirmTokenInput.trim() },
      );
      if (r.ok) {
        setDeletedAt(r.deletedAt);
      } else {
        throw new Error("confirm_failed");
      }
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }, [confirmTokenInput]);

  return (
    <>
      <PageHeader
        title="Privacy & data controls"
        description="Export everything we hold about you, or request deletion. Both operations are hash-chained into the admin audit log."
        breadcrumbs={[{ label: "Settings" }, { label: "Privacy" }]}
      />
      <PageBody>
        {/* Export */}
        <Card className="mb-4">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Download className="h-5 w-5 text-[hsl(327_77%_30%)] mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium mb-1">Export your data</div>
                <div className="text-xs text-muted-foreground mb-3">
                  We assemble a single JSON envelope containing your profile, sessions, audit-relevant
                  activity, partner / investor / founder records (whichever apply), notification preferences,
                  and any documents you uploaded. The download starts immediately. A copy of the request
                  (size in bytes + timestamp + IP) is recorded on the admin audit chain.
                </div>
                <Button
                  size="sm"
                  className="bg-[hsl(327_77%_30%)] hover:bg-[hsl(327_77%_25%)] h-8"
                  onClick={() => void doExport()}
                  disabled={exporting}
                  data-testid="button-export"
                >
                  {exporting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      Preparing…
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5 mr-1" />
                      Download data export
                    </>
                  )}
                </Button>
                {exportSizeBytes != null && (
                  <div className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                    Last export: {exportSizeBytes.toLocaleString()} bytes.
                  </div>
                )}
                {exportError && (
                  <div className="text-xs text-rose-700 mt-2 flex items-center gap-2" data-testid="error-export">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {exportError}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Delete — request */}
        <Card className="mb-4 border-amber-200">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-700 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium mb-1">Request data deletion</div>
                <div className="text-xs text-muted-foreground mb-3">
                  Deletion is a two-step process. Step 1: request a deletion token. The token is also
                  emailed to your registered address, so you can confirm from a different device. Step 2:
                  paste the token in the confirmation box below within the server-side TTL window.
                  <br />
                  <strong className="text-amber-800">
                    Records required for legal hold (signed cap-table sign-offs, audit entries, financial
                    transactions) are NOT erased — they are anonymised. Your PII is unlinked from those
                    rows and replaced with a deterministic hash.
                  </strong>
                </div>
                <label className="block text-xs text-muted-foreground mb-1">Reason (optional, max 1000 chars)</label>
                <textarea
                  className="w-full text-sm border border-border rounded p-2 mb-3"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                  data-testid="textarea-delete-reason"
                  disabled={requesting}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-amber-300 text-amber-900 hover:bg-amber-50"
                  onClick={() => void requestDelete()}
                  disabled={requesting}
                  data-testid="button-request-delete"
                >
                  {requesting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      Requesting…
                    </>
                  ) : (
                    "Request deletion token"
                  )}
                </Button>
                {deleteToken && requestedAt && (
                  <div className="mt-3 text-xs">
                    <Badge className="bg-amber-100 text-amber-900 border-0 mr-2">Token issued</Badge>
                    Requested at {new Date(requestedAt).toLocaleString()}. Token has been copied
                    into the confirmation box below.
                  </div>
                )}
                {requestError && (
                  <div className="text-xs text-rose-700 mt-2 flex items-center gap-2" data-testid="error-request-delete">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {requestError}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Delete — confirm */}
        <Card className="mb-4 border-rose-200">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-rose-700 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-medium mb-1">Confirm deletion</div>
                <div className="text-xs text-muted-foreground mb-3">
                  Paste the token from step 1 (or from the confirmation email) and click confirm. This
                  action is irreversible. On success you will be signed out and any future logins with
                  this email will be rejected.
                </div>
                <input
                  type="text"
                  className="w-full text-sm border border-border rounded p-2 mb-3 font-mono"
                  value={confirmTokenInput}
                  onChange={(e) => setConfirmTokenInput(e.target.value)}
                  placeholder="Paste deletion token"
                  data-testid="input-delete-token"
                  disabled={confirming || !!deletedAt}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8"
                  onClick={() => void confirmDelete()}
                  disabled={confirming || !confirmTokenInput.trim() || !!deletedAt}
                  data-testid="button-confirm-delete"
                >
                  {confirming ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      Confirming…
                    </>
                  ) : (
                    "Permanently delete my data"
                  )}
                </Button>
                {deletedAt && (
                  <div className="mt-3 text-xs flex items-center gap-2" data-testid="deleted-banner">
                    <Badge className="bg-rose-100 text-rose-900 border-0">Deleted</Badge>
                    Deletion completed at {new Date(deletedAt).toLocaleString()}. You will be signed out.
                  </div>
                )}
                {confirmError && (
                  <div className="text-xs text-rose-700 mt-2 flex items-center gap-2" data-testid="error-confirm-delete">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {confirmError}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Retention summary */}
        <Card>
          <CardContent className="py-4">
            <div className="text-sm font-medium mb-2">Retention summary</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-1.5">Data class</th>
                  <th className="text-left py-1.5">Retention</th>
                  <th className="text-left py-1.5">On delete request</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/40">
                  <td className="py-1.5">Profile, preferences</td>
                  <td>Active account lifetime</td>
                  <td>Erased</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="py-1.5">Session + auth logs</td>
                  <td>180 days</td>
                  <td>Erased</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="py-1.5">Notifications</td>
                  <td>Active account lifetime</td>
                  <td>Erased</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="py-1.5">Cap-table sign-offs</td>
                  <td>7 years (statutory)</td>
                  <td>Anonymised — PII replaced with deterministic hash</td>
                </tr>
                <tr className="border-b border-border/40">
                  <td className="py-1.5">Audit chain entries</td>
                  <td>Indefinite</td>
                  <td>Anonymised — hash chain preserved</td>
                </tr>
                <tr>
                  <td className="py-1.5">Financial transactions (SPV)</td>
                  <td>10 years (statutory)</td>
                  <td>Anonymised</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
