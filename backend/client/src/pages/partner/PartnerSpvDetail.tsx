/**
 * Foundation Build — Partner SPV detail page.
 * Shows SPV summary, audit receipt, and (managing_partner-only) capital-call
 * + distribution forms wired to the v25.23 NC-A real DB-backed handlers.
 */
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient"; /* v25.14 NH3 — needed for queryFn */
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type SpvDetail = {
  id: string;
  spvName: string;
  jurisdiction: string;
  targetSizeMinor: number;
  currency: string;
  status: string;
  version: number;
  revisionHash: string;
  prevRevisionHash: string;
  createdAt: string;
};

function formatMinor(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export default function PartnerSpvDetail() {
  const role = useRequirePartnerRole();
  const [, params] = useRoute<{ id: string }>("/collective/partner/spvs/:id");
  const spvId = params?.id;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<{ spv: SpvDetail }>({
    /* v25.12 NL1 — explicit queryFn for robustness.
       v25.14 NH3 — canonical 2-element queryKey so the parent list's
       invalidateQueries({queryKey: ["/api/partner/me/spvs"]}) cascades. */
    queryKey: ["/api/partner/me/spvs", spvId],
    enabled: role.ready && !!role.identity && !!spvId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spvs/${spvId}`)).json(),
  });

  /* v25.24 NM-1 fix — wire capital-call + distribution forms to the v25.23
   * NC-A real DB-backed handlers. PartnerSpvDetail was a read-only dead-end
   * even after v25.23 made the server side correct + gated. Both endpoints
   * are managing_partner-only on the server, so we also disable the forms
   * unless the user holds that subRole. */
  const isManagingPartner = role.identity?.subRole === "managing_partner";
  const [callAmount, setCallAmount] = useState("");
  const [distAmount, setDistAmount] = useState("");

  const callMut = useMutation({
    mutationFn: async (amountMinor: number) => {
      const res = await apiRequest("POST", `/api/partner/me/spvs/${spvId}/capital-calls`, {
        amount_minor: amountMinor,
        called_at: new Date().toISOString(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.message || body?.error || `Capital call failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      setCallAmount("");
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs", spvId] });
      toast({ title: "Capital call recorded" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Capital call failed", description: e.message }),
  });

  const distMut = useMutation({
    mutationFn: async (totalMinor: number) => {
      const res = await apiRequest("POST", `/api/partner/me/spvs/${spvId}/distributions`, {
        distribution_type: "cash",
        total_minor: totalMinor,
        distributed_at: new Date().toISOString(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.message || body?.error || `Distribution failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      setDistAmount("");
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs", spvId] });
      toast({ title: "Distribution recorded" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Distribution failed", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  if (isLoading) return <PartnerShell title="SPV" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}><div>Loading…</div></PartnerShell>;
  if (error || !data?.spv) {
    return (
      <PartnerShell title="SPV not found" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
        <div className="text-red-600" data-testid="partner-spv-not-found">
          This SPV does not exist or you do not have access to it.
        </div>
      </PartnerShell>
    );
  }
  const s = data.spv;

  return (
    <PartnerShell title={`${s.spvName} · ${s.jurisdiction} · ${s.status}`} tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <Card className="p-4 mb-4 space-y-2" data-testid="partner-spv-detail">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-slate-500">Target Size</div>
            <div className="font-mono">{formatMinor(s.targetSizeMinor, s.currency)}</div>
          </div>
          <div>
            <div className="text-slate-500">Currency (ISO 4217)</div>
            <div className="font-mono">{s.currency}</div>
          </div>
          <div>
            <div className="text-slate-500">Jurisdiction</div>
            <div>{s.jurisdiction}</div>
          </div>
          <div>
            <div className="text-slate-500">Status</div>
            <div>{s.status}</div>
          </div>
        </div>
      </Card>

      {/* v25.24 NM-1 — managing_partner-only capital-call + distribution UI.
          Server endpoints are also gated with assertSubRole; the disable here
          is defense-in-depth for UX (avoid pre-flight failed POSTs). */}
      {isManagingPartner ? (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-spv-capital-call-form">
          <div className="font-medium">Record Capital Call</div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder={`Amount in minor units (${s.currency})`}
              value={callAmount}
              onChange={(e) => setCallAmount(e.target.value)}
              data-testid="partner-spv-capital-call-amount"
            />
            <Button
              disabled={!callAmount || callMut.isPending}
              onClick={() => {
                const n = Number(callAmount);
                if (!Number.isFinite(n) || n <= 0) {
                  toast({ variant: "destructive", title: "Invalid amount" });
                  return;
                }
                callMut.mutate(Math.round(n));
              }}
              data-testid="partner-spv-capital-call-submit"
            >
              {callMut.isPending ? "Recording…" : "Record"}
            </Button>
          </div>
        </Card>
      ) : null}

      {isManagingPartner ? (
        <Card className="p-4 mb-4 space-y-3" data-testid="partner-spv-distribution-form">
          <div className="font-medium">Record Distribution (cash)</div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min="1"
              placeholder={`Total in minor units (${s.currency})`}
              value={distAmount}
              onChange={(e) => setDistAmount(e.target.value)}
              data-testid="partner-spv-distribution-amount"
            />
            <Button
              disabled={!distAmount || distMut.isPending}
              onClick={() => {
                const n = Number(distAmount);
                if (!Number.isFinite(n) || n <= 0) {
                  toast({ variant: "destructive", title: "Invalid amount" });
                  return;
                }
                distMut.mutate(Math.round(n));
              }}
              data-testid="partner-spv-distribution-submit"
            >
              {distMut.isPending ? "Recording…" : "Record"}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-4 space-y-2" data-testid="partner-spv-hash-chain">
        <div className="font-medium mb-2">Audit Receipt</div>
        <div className="text-xs font-mono space-y-1">
          <div>version: {s.version}</div>
          <div>prev_revision_hash: {s.prevRevisionHash}</div>
          <div>revision_hash: {s.revisionHash}</div>
          <div>created_at: {s.createdAt}</div>
        </div>
      </Card>
    </PartnerShell>
  );
}
