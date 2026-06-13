/**
 * Foundation Build — Partner Funds list page.
 * Read-only record-keeping for fund commitments. No money movement.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
/* v25.12 NL7 — toast errors in addition to the inline display for consistency
 * with other partner mutations. */
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Fund = {
  id: string;
  fundName: string;
  vintageYear: number;
  targetSizeMinor: number;
  currency: string;
  status: string;
};

function formatMinor(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export default function PartnerFunds() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [form, setForm] = useState({ fundName: "", vintageYear: "2026", targetSizeMinor: "0", currency: "USD" });
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<{ funds: Fund[] }>({
    /* v25.12 NL1 — explicit queryFn for robustness; previously relied on the
     * global default which would silently break if the queryKey ever becomes
     * multi-element. */
    /* v25.15 NM7 — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/funds"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/funds")).json(),
  });

  /* v25.12 NL7 — toast helper. */
  const { toast } = useToast();

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/me/funds", {
        fundName: form.fundName,
        vintageYear: parseInt(form.vintageYear, 10),
        targetSizeMinor: parseInt(form.targetSizeMinor, 10),
        currency: form.currency,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "create_failed" }));
        throw new Error(e.error || "create_failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/funds"] });
      setForm({ fundName: "", vintageYear: "2026", targetSizeMinor: "0", currency: "USD" });
      setShowForm(false);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Create fund failed", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole === "managing_partner" || me.subRole === "associate";
  const funds = data?.funds ?? [];

  return (
    <PartnerShell title="Funds" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="mb-4 bg-blue-50 border border-blue-200 p-3 rounded text-sm" data-testid="partner-funds-disclaimer">
        Fund records are for documentation only. No funds are moved by Capavate.
      </div>

      {canWrite && (
        <div className="mb-4">
          <Button onClick={() => setShowForm(!showForm)} data-testid="partner-funds-new-toggle">
            {showForm ? "Cancel" : "Record New Fund"}
          </Button>
        </div>
      )}

      {showForm && canWrite && (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-funds-new-form">
          <div>
            <Label>Fund Name</Label>
            <Input value={form.fundName} onChange={(e) => setForm({ ...form, fundName: e.target.value })} data-testid="partner-fund-name" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Vintage Year</Label>
              <Input type="number" value={form.vintageYear} onChange={(e) => setForm({ ...form, vintageYear: e.target.value })} data-testid="partner-fund-vintage" />
            </div>
            <div>
              <Label>Target Size (minor units)</Label>
              <Input type="number" value={form.targetSizeMinor} onChange={(e) => setForm({ ...form, targetSizeMinor: e.target.value })} data-testid="partner-fund-target" />
            </div>
            <div>
              <Label>Currency (ISO 4217)</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={3} data-testid="partner-fund-currency" />
            </div>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.fundName.trim() || create.isPending}
            data-testid="partner-funds-create"
          >
            {create.isPending ? "Recording…" : "Record Fund"}
          </Button>
          {create.error && <div className="text-sm text-red-600">{(create.error as Error).message}</div>}
        </Card>
      )}

      {isLoading && <div className="text-sm text-slate-500" data-testid="funds-loading">Loading…</div>}
      {/* v25.15 NM7 — explicit error branch. */}
      {isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="funds-error"
        >
          Could not load funds. Please refresh and try again.
        </div>
      )}
      {!isLoading && !isError && funds.length === 0 && (
        <PartnerEmptyState
          title="No funds recorded yet"
          description="Record a fund to document commitments."
        />
      )}

      {funds.length > 0 && (
        <div className="space-y-2" data-testid="partner-funds-list">
          {funds.map((f) => (
            <Card key={f.id} className="p-3" data-testid={`partner-fund-${f.id}`}>
              <Link href={`/collective/partner/funds/${f.id}`} className="block hover:bg-slate-50 -m-3 p-3 rounded">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{f.fundName}</div>
                    <div className="text-xs text-slate-500">Vintage {f.vintageYear} · {f.status}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono">{formatMinor(f.targetSizeMinor, f.currency)}</div>
                    <div className="text-xs text-slate-500">target</div>
                  </div>
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </PartnerShell>
  );
}
