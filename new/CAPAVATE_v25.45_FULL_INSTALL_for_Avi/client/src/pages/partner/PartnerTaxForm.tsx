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
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

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

function formatDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
        className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
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
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Submit a tax form</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Form type</Label>
                <Select value={form.formType} onValueChange={(v) => setForm((f) => ({ ...f, formType: v }))}>
                  <SelectTrigger data-testid="select-taxform-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{FORM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Jurisdiction</Label>
                <Input value={form.jurisdiction} onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))} placeholder="US / CA / …" data-testid="input-taxform-jurisdiction" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tax ID (hashed on submit)</Label>
                <Input value={form.taxId} onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} placeholder="SSN / EIN / SIN" data-testid="input-taxform-taxid" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Document URL (optional)</Label>
                <Input value={form.documentUrl} onChange={(e) => setForm((f) => ({ ...f, documentUrl: e.target.value }))} placeholder="https://…" data-testid="input-taxform-docurl" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Expires at (optional, ISO date)</Label>
                <Input value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} placeholder="2029-12-31" data-testid="input-taxform-expires" />
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

          <h2 className="text-sm font-semibold text-slate-900 mb-2">Forms on file</h2>
          {isLoading && <div className="text-sm text-slate-500" data-testid="partner-taxform-loading">Loading…</div>}
          {!isLoading && forms.length === 0 && (
            <PartnerEmptyState title="No tax forms on file" description="Submit a W-9, W-8BEN, or T4A above so payouts can be remitted." />
          )}
          {!isLoading && forms.length > 0 && (
            <Card className="overflow-hidden" data-testid="partner-taxform-table">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
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
                            ? <a href={tf.documentUrl} target="_blank" rel="noreferrer" className="text-[#cc0001] hover:underline">View</a>
                            : <span className="text-slate-400">—</span>}
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
