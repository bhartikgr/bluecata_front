/**
 * WAVE 179 · ITEM C · R151.2 — "Download CSV" FOR THE PARTNER'S OWN DATA.
 *
 * ONE button component for all three exports (LP roster, SPV fee history, CRM
 * contacts) so the download mechanics exist in exactly one place.
 *
 * WHY NOT A PLAIN `<a href>`: the session travels as the `cap_uid` cookie and
 * `apiRequest` sends `credentials: "include"` against `API_BASE`, which is NOT
 * always the page's own origin (proxy deploys set it). A bare anchor would work on
 * a same-origin deploy and silently 401 on a proxied one, which is exactly the kind
 * of "passes in fixtures, broken for a live GP" failure this platform refuses. So
 * the file is fetched through the SAME client that every other partner call uses and
 * handed to the browser as a blob — the mechanism the one pre-existing partner
 * export (Invoices CSV on the Billing tab) already uses.
 *
 * THE SERVER OWNS THE CONTENT. This component builds no rows, formats no money and
 * derives nothing: it downloads bytes the server produced from the same store reads
 * that fed the screen. Nothing here can make an export disagree with the page.
 *
 * FAILURE IS VISIBLE. A refused or failed export says so in an alert next to the
 * button instead of handing the user an empty or truncated file.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

export const PARTNER_CSV_DOWNLOAD_LABEL = "Download CSV";
export const PARTNER_CSV_DOWNLOAD_BUSY_LABEL = "Preparing CSV…";
export const PARTNER_CSV_DOWNLOAD_FAILED = "Could not download the CSV. Nothing was saved — please try again.";
export const PARTNER_CSV_DOWNLOAD_REFUSED = "You can only export your own data.";

export default function PartnerCsvDownloadButton({
  url,
  filename,
  testid,
  label,
}: {
  url: string;
  filename: string;
  testid: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest("GET", url);
      if (!res.ok) {
        setError(res.status === 403 || res.status === 404 ? PARTNER_CSV_DOWNLOAD_REFUSED : PARTNER_CSV_DOWNLOAD_FAILED);
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
    } catch {
      setError(PARTNER_CSV_DOWNLOAD_FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1" data-testid={`${testid}-wrap`}>
      <Button size="sm" variant="outline" onClick={download} disabled={busy} data-testid={testid}>
        {busy ? PARTNER_CSV_DOWNLOAD_BUSY_LABEL : (label ?? PARTNER_CSV_DOWNLOAD_LABEL)}
      </Button>
      {error ? (
        <div className="text-xs text-rose-600" role="alert" data-testid={`${testid}-error`}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
