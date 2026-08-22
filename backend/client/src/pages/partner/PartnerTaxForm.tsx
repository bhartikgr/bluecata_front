/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /collective/partner/tax-form — collect a partner's W-9 / W-8BEN / T4A tax
 * form. Lists existing forms from GET /api/partner/me/tax-forms and submits new
 * ones via POST /api/partner/me/tax-form. The raw tax id is sent once and hashed
 * server-side (never persisted in clear, never returned). Nothing is hardcoded;
 * the form list is read DB-direct. apiRequest throws ApiError on non-2xx, so a
 * 403 (non-managing-partner) is surfaced as an access note, not a hard error.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, ApiError, queryClient } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
/* WAVE 102 · ITEM 3 — Wave 87's timezone-safe formatter. See the block above
   `formatDate` below for why this file needs it. */
import { fmtLocaleDate } from "@/lib/format";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
/* v25.50 Phase 7 (10) — canonical ISO-3166 country master list replaces the
   free-text jurisdiction field. */
import { COUNTRIES } from "@/lib/profile/data/countries";

type TaxForm = {
  id: string;
  formType: string;
  jurisdiction: string;
  collectedAt: string;
  expiresAt: string | null;
  documentUrl: string | null;
  createdAt: string;
};

const FORM_TYPES = ["W-9", "W-8BEN", "W-8BEN-E", "T4A"];

/* ══ WAVE 102 · ITEM 3 — THIS RENDERED A TAX-FORM EXPIRY ONE DAY EARLY ══════════
   The body was `new Date(value).toLocaleDateString(…)`. For a DATE-ONLY value
   that is a one-day shift in every zone behind UTC, and the owner is in New
   York. Reviewer C proved it by execution:

     TZ=UTC                 expires_at="2026-06-15" -> Jun 15, 2026
     TZ=America/New_York    expires_at="2026-06-15" -> Jun 14, 2026   <- the owner
     TZ=Pacific/Auckland    expires_at="2026-06-15" -> Jun 15, 2026

   THE VALUE IS DATE-ONLY, PROVED FROM THE TREE AND THE SCHEMA, NOT FROM THE NAME:
     · the input at :151 carries `placeholder="YYYY-MM-DD"` and NO `type="date"`,
       so the partner types a bare calendar date;
     · `server/lib/partnerSelfServiceRoutes.ts:416` takes `body.expiresAt.trim()`
       and `:434` stores that string VERBATIM into `partner_tax_forms.expires_at`
       — no normalisation, no `new Date()`, no `.toISOString()`;
     · the column is `expires_at TEXT` (nullable) in BOTH places a database can
       come from: `migrations/0054_v25_33_partner_payment_model.sql:75` and the
       inline DDL in `server/db/connection.ts:1998`.

   WHY THE WAVE 87 FENCE EXCUSED IT: `expiresAt` is on `TIMESTAMP_FIELDS` while
   `expiresOn` is in the date-only registry — two near-identical names, opposite
   treatment — and `firstDateOnlyField` consults the timestamp list FIRST. The
   fence's blind spot is fixed in the same wave (see the WAVE 102 block in
   `scripts/lint/dateOnlyRenderFence.ts`), so this site cannot silently come back.

   THE FIX handles BOTH kinds correctly, which matters because this one helper
   renders two different kinds on the same row:
     `expiresAt`   date-only  -> local midnight of that calendar day, no shift
     `collectedAt` an instant (`nowIso()` at routes :427) -> localised as before
   `fmtLocaleDate` is Wave 87's own helper and it discriminates on the VALUE'S
   SHAPE, not on any field name. The rendered format is byte-identical: the same
   `locales`/`options` are passed straight through.
   ═══════════════════════════════════════════════════════════════════════ */
function formatDate(value: string | null) {
  return fmtLocaleDate(value, undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function PartnerTaxForm() {
  const role = useRequirePartnerRole();
  const { toast } = useToast();
  const [form, setForm] = useState({ formType: "W-9", jurisdiction: "US", taxId: "", documentUrl: "", expiresAt: "" });

  const { data, isLoading, isError, error } = useQuery<{ forms: TaxForm[] }>({
    queryKey: ["/api/partner/me/tax-forms"],
    enabled: role.ready && !!role.identity,
    retry: false,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/tax-forms")).json(),
  });

  /* v25.50 Phase 7 (10) — real document upload; on success the returned
     documentUrl (an authenticated serve URL) is written into the form so the
     subsequent tax-form submit persists it. */
  const [uploading, setUploading] = useState(false);
  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/partner/me/tax-form/upload", { method: "POST", body: fd, credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || `upload ${r.status}`);
      setForm((f) => ({ ...f, documentUrl: j.documentUrl }));
      toast({ title: "Document uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const submitMut = useMutation({
    mutationFn: async () => {
      const body = {
        formType: form.formType,
        jurisdiction: form.jurisdiction.trim(),
        taxId: form.taxId.trim(),
        documentUrl: form.documentUrl.trim() || undefined,
        expiresAt: form.expiresAt.trim() || undefined,
      };
      const j = await (await apiRequest("POST", "/api/partner/me/tax-form", body)).json();
      if (!j.ok) throw new Error(j.error || "submit_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/me/tax-forms"] });
      setForm((f) => ({ ...f, taxId: "", documentUrl: "", expiresAt: "" }));
      toast({ title: "Tax form recorded" });
    },
    onError: (e: any) => toast({ title: "Could not record tax form", description: e?.message, variant: "destructive" }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const isForbidden = isError && error instanceof ApiError && error.status === 403;
  const forms = data?.forms ?? [];

  return (
    <PartnerShell title="Tax Forms" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div
        className="mb-4 rounded-md border border-[rgba(4,30,65,0.2)] bg-[rgba(4,30,65,0.05)] p-4 text-sm text-[var(--cv-color-navy)]"
        data-testid="partner-taxform-explainer"
      >
        <p className="font-medium">Tax compliance for commission & fee payouts.</p>
        <p className="mt-1">
          We collect the appropriate tax form before remitting any commission or SPV-fee payout. Your tax
          identification number is hashed on submission and never stored in clear text.
        </p>
      </div>

      {isForbidden && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="partner-taxform-forbidden">
          Tax form management is available to managing partners only.
        </div>
      )}

      {!isForbidden && (
        <>
          <Card className="mb-4 p-4" data-testid="partner-taxform-form">
            <h2 className="text-sm font-semibold text-[var(--cv-color-text)] mb-3">Submit a tax form</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* v25.50 Phase 7 (10) — Jurisdiction (canonical country) FIRST,
                 before the dependent Form type / Tax ID fields. */}
              <div className="space-y-1.5">
                <Label className="text-xs">Jurisdiction (country)</Label>
                <Select value={form.jurisdiction} onValueChange={(v) => setForm((f) => ({ ...f, jurisdiction: v }))}>
                  <SelectTrigger data-testid="select-taxform-jurisdiction"><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Form type</Label>
                <Select value={form.formType} onValueChange={(v) => setForm((f) => ({ ...f, formType: v }))}>
                  <SelectTrigger data-testid="select-taxform-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{FORM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tax ID (hashed on submit)</Label>
                <Input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} placeholder="SSN / EIN / SIN" data-testid="input-taxform-taxid" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expires at (optional, ISO date)</Label>
                <Input value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} placeholder="YYYY-MM-DD" data-testid="input-taxform-expires" />
              </div>
              {/* v25.50 Phase 7 (10) — real file upload OR a document URL. */}
              <div className="space-y-1.5">
                <Label className="text-xs">Upload document (PDF/image, ≤15MB)</Label>
                <Input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  data-testid="input-taxform-file"
                  disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
                />
                {uploading && <div className="text-xs text-[var(--cv-color-text-muted)]">Uploading…</div>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Document URL (optional)</Label>
                <Input value={form.documentUrl} onChange={(e) => setForm((f) => ({ ...f, documentUrl: e.target.value }))} placeholder="https://… or uploaded above" data-testid="input-taxform-docurl" />
              </div>
            </div>
            <div className="mt-4">
              <Button
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending || !form.taxId.trim() || !form.jurisdiction.trim()}
                data-testid="button-submit-taxform"
              >
                Submit tax form
              </Button>
            </div>
          </Card>

          <h2 className="text-sm font-semibold text-[var(--cv-color-text)] mb-2">Forms on file</h2>
          {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="partner-taxform-loading">Loading…</div>}
          {!isLoading && forms.length === 0 && (
            <PartnerEmptyState title="No tax forms on file" description="Submit a W-9, W-8BEN, or T4A above so payouts can be remitted." />
          )}
          {!isLoading && forms.length > 0 && (
            <Card className="overflow-hidden" data-testid="partner-taxform-table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-[var(--cv-color-surface-2)] text-left text-xs uppercase tracking-wide text-[var(--cv-color-text-muted)]">
                    <tr>
                      <th className="px-4 py-2">Form</th>
                      <th className="px-4 py-2">Jurisdiction</th>
                      <th className="px-4 py-2">Collected</th>
                      <th className="px-4 py-2">Expires</th>
                      <th className="px-4 py-2">Document</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forms.map((tf) => (
                      <tr key={tf.id} className="border-b last:border-0" data-testid={`partner-taxform-row-${tf.id}`}>
                        <td className="px-4 py-2 font-medium">{tf.formType}</td>
                        <td className="px-4 py-2">{tf.jurisdiction}</td>
                        <td className="px-4 py-2">{formatDate(tf.collectedAt)}</td>
                        <td className="px-4 py-2">{formatDate(tf.expiresAt)}</td>
                        <td className="px-4 py-2">
                          {tf.documentUrl
                            ? <a href={tf.documentUrl} target="_blank" rel="noreferrer" className="text-[var(--cv-color-primary)] hover:underline">View</a>
                            : <span className="text-[var(--cv-color-text-faint)]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </PartnerShell>
  );
}
