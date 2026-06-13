/**
 * Foundation Build — Partner Fund detail page.
 * Read-only fund record with commitment ledger and audit receipt.
 */
import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast"; /* v25.14 NC3 — pledge error toast */

type Commitment = {
  id: string;
  lpName: string;
  amountMinor: number;
  currency: string;
  pledgedAt: string;
};

type FundDetail = {
  id: string;
  fundName: string;
  vintageYear: number;
  targetSizeMinor: number;
  currency: string;
  status: string;
  version: number;
  revisionHash: string;
  prevRevisionHash: string;
  createdAt: string;
  commitments: Commitment[];
};

function formatMinor(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export default function PartnerFundDetail() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, params] = useRoute<{ id: string }>("/collective/partner/funds/:id");
  const fundId = params?.id;
  const [pledgeForm, setPledgeForm] = useState({ lpName: "", amountMinor: "0" });

  const { data, isLoading, error } = useQuery<{ fund: FundDetail }>({
    /* v25.12 NL1 — explicit queryFn for robustness.
       v25.14 NH4 — canonical 2-element queryKey so the parent list's
       invalidateQueries({queryKey: ["/api/partner/me/funds"]}) cascades. */
    queryKey: ["/api/partner/me/funds", fundId],
    enabled: role.ready && !!role.identity && !!fundId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/funds/${fundId}`)).json(),
  });

  const pledge = useMutation({
    mutationFn: async () => {
      // v25.14 NL7 — client-side numeric validation before submit so the
      // user sees an immediate, sensible error instead of a 400 Zod blob.
      const amount = parseInt(pledgeForm.amountMinor, 10);
      if (!pledgeForm.lpName.trim()) throw new Error("LP name required.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Pledge amount must be a positive number.");
      const res = await apiRequest("POST", `/api/partner/me/funds/${fundId}/commitments`, {
        lpName: pledgeForm.lpName,
        amountMinor: amount,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "pledge_failed" }));
        throw new Error(e.error || "pledge_failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/funds", fundId] });
      qc.invalidateQueries({ queryKey: ["/api/partner/me/funds"] });
      setPledgeForm({ lpName: "", amountMinor: "0" });
      toast({ title: "Pledge recorded" });
    },
    // v25.14 NC3 — was silently swallowed; only an inline error div that
    // reset on next mutate. Now surfaces a destructive toast.
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Pledge failed.";
      toast({ title: "Pledge failed", description: msg, variant: "destructive" });
    },
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  if (isLoading) return <PartnerShell title="Fund" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}><div>Loading…</div></PartnerShell>;
  if (error || !data?.fund) {
    return (
      <PartnerShell title="Fund not found" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
        <div className="text-red-600" data-testid="partner-fund-not-found">
          This fund does not exist or you do not have access to it.
        </div>
      </PartnerShell>
    );
  }

  const f = data.fund;
  const canPledge = me.subRole === "managing_partner" || me.subRole === "associate";

  return (
    <PartnerShell title={`${f.fundName} · Vintage ${f.vintageYear} · ${f.status}`} tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <Card className="p-4 mb-4 space-y-2" data-testid="partner-fund-detail">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-slate-500">Target Size</div>
            <div className="font-mono">{formatMinor(f.targetSizeMinor, f.currency)}</div>
          </div>
          <div>
            <div className="text-slate-500">Currency (ISO 4217)</div>
            <div className="font-mono">{f.currency}</div>
          </div>
        </div>
      </Card>

      <Card className="p-4 mb-4" data-testid="partner-fund-commitments">
        <div className="flex justify-between items-center mb-3">
          <div className="font-medium">Commitments</div>
        </div>
        {f.commitments.length === 0 ? (
          <div className="text-sm text-slate-500">No commitments pledged yet.</div>
        ) : (
          <div className="space-y-2">
            {f.commitments.map((c) => (
              <div key={c.id} className="flex justify-between text-sm border-b pb-2" data-testid={`partner-commitment-${c.id}`}>
                <div>{c.lpName}</div>
                <div className="font-mono">{formatMinor(c.amountMinor, c.currency)}</div>
              </div>
            ))}
          </div>
        )}

        {canPledge && (
          <div className="mt-4 border-t pt-3 space-y-2">
            <Label>Record New Pledge</Label>
            <div className="flex gap-2">
              <Input
                placeholder="LP name"
                value={pledgeForm.lpName}
                onChange={(e) => setPledgeForm({ ...pledgeForm, lpName: e.target.value })}
                data-testid="partner-pledge-lp-name"
              />
              <Input
                type="number"
                placeholder="Amount (minor units)"
                value={pledgeForm.amountMinor}
                onChange={(e) => setPledgeForm({ ...pledgeForm, amountMinor: e.target.value })}
                data-testid="partner-pledge-amount"
              />
              <Button
                onClick={() => pledge.mutate()}
                disabled={!pledgeForm.lpName.trim() || pledge.isPending}
                data-testid="partner-pledge-submit"
              >
                Pledge
              </Button>
            </div>
            {pledge.error ? (
              <div className="text-sm text-red-600">
                {pledge.error instanceof Error ? pledge.error.message : String(pledge.error)}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card className="p-4 space-y-2" data-testid="partner-fund-hash-chain">
        <div className="font-medium mb-2">Audit Receipt</div>
        <div className="text-xs font-mono space-y-1">
          <div>version: {f.version}</div>
          <div>prev_revision_hash: {f.prevRevisionHash}</div>
          <div>revision_hash: {f.revisionHash}</div>
          <div>created_at: {f.createdAt}</div>
        </div>
      </Card>
    </PartnerShell>
  );
}
