/**
 * Foundation Build — Partner SPVs list page.
 * Read-only record-keeping (no money movement). Lists all SPVs recorded for this partner.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Spv = {
  id: string;
  spvName: string;
  jurisdiction: string;
  targetSizeMinor: number;
  currency: string;
  status: string;
};

function formatMinor(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export default function PartnerSpvs() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [form, setForm] = useState({ spvName: "", jurisdiction: "Delaware", targetSizeMinor: "0", currency: "USD" });
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery<{ spvs: Spv[] }>({
    queryKey: ["/api/partner/me/spvs"],
    enabled: role.ready && !!role.identity,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/partner/me/spvs", {
        spvName: form.spvName,
        jurisdiction: form.jurisdiction,
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
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs"] });
      setForm({ spvName: "", jurisdiction: "Delaware", targetSizeMinor: "0", currency: "USD" });
      setShowForm(false);
    },
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole === "managing_partner" || me.subRole === "associate";
  const spvs = data?.spvs ?? [];

  return (
    <PartnerShell title="SPVs" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="mb-4 bg-blue-50 border border-blue-200 p-3 rounded text-sm" data-testid="partner-spvs-disclaimer">
        SPV records are for documentation only. No funds are moved by Capavate.
      </div>

      {canWrite && (
        <div className="mb-4">
          <Button
            onClick={() => setShowForm(!showForm)}
            data-testid="partner-spvs-new-toggle"
          >
            {showForm ? "Cancel" : "Record New SPV"}
          </Button>
        </div>
      )}

      {showForm && canWrite && (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-spvs-new-form">
          <div>
            <Label>SPV Name</Label>
            <Input value={form.spvName} onChange={(e) => setForm({ ...form, spvName: e.target.value })} data-testid="partner-spv-name" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Jurisdiction</Label>
              <Input value={form.jurisdiction} onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })} data-testid="partner-spv-jurisdiction" />
            </div>
            <div>
              <Label>Target Size (minor units)</Label>
              <Input type="number" value={form.targetSizeMinor} onChange={(e) => setForm({ ...form, targetSizeMinor: e.target.value })} data-testid="partner-spv-target" />
            </div>
            <div>
              <Label>Currency (ISO 4217)</Label>
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={3} data-testid="partner-spv-currency" />
            </div>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={!form.spvName.trim() || create.isPending}
            data-testid="partner-spvs-create"
          >
            {create.isPending ? "Recording…" : "Record SPV"}
          </Button>
          {create.error && <div className="text-sm text-red-600">{(create.error as Error).message}</div>}
        </Card>
      )}

      {isLoading && <div className="text-sm text-slate-500">Loading…</div>}
      {!isLoading && spvs.length === 0 && (
        <PartnerEmptyState
          title="No SPVs recorded yet"
          description="Record an SPV to keep documentation in one place."
        />
      )}

      {spvs.length > 0 && (
        <div className="space-y-2" data-testid="partner-spvs-list">
          {spvs.map((s) => (
            <Card key={s.id} className="p-3" data-testid={`partner-spv-${s.id}`}>
              <Link href={`/collective/partner/spvs/${s.id}`} className="block hover:bg-slate-50 -m-3 p-3 rounded">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{s.spvName}</div>
                    <div className="text-xs text-slate-500">{s.jurisdiction} · {s.status}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono">{formatMinor(s.targetSizeMinor, s.currency)}</div>
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
