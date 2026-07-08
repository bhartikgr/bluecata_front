/**
 * Foundation Build — Partner SPV detail page.
 * Shows SPV summary, audit receipt, and (managing_partner-only) capital-call
 * + distribution forms wired to the v25.23 NC-A real DB-backed handlers.
 */
import { useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
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
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, currency, { locale: "en-US" });
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
  const canWriteLp =
    role.identity?.subRole === "managing_partner" ||
    role.identity?.subRole === "associate" ||
    role.identity?.subRole === "bd";
  const [callAmount, setCallAmount] = useState("");
  const [distAmount, setDistAmount] = useState("");
  const [lpEmail, setLpEmail] = useState("");
  const [lpFirstName, setLpFirstName] = useState("");
  const [lpLastName, setLpLastName] = useState("");

  /* W2-H — GP LP roster (subscribers + pending invites). */
  const roster = useQuery<{
    spvId: string;
    lpVisibility: string;
    subscribers: Array<{ investorId: string; name: string | null; email: string | null; commitmentMinor: number; status: string; ownershipPct: number }>;
    invites: Array<{ id: string; email: string; firstName: string | null; lastName: string; note: string | null; status: string; createdAt: string }>;
  }>({
    queryKey: ["/api/partner/me/spv", spvId, "lp-roster"],
    enabled: role.ready && !!role.identity && !!spvId,
    queryFn: async () => (await apiRequest("GET", `/api/partner/me/spv/${spvId}/lp-roster`)).json(),
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/partner/me/spv/${spvId}/lp-invites`, {
        email: lpEmail.trim(),
        firstName: lpFirstName.trim() || undefined,
        lastName: lpLastName.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      setLpEmail(""); setLpFirstName(""); setLpLastName("");
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId, "lp-roster"] });
      toast({ title: "LP invited" });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Invite failed", description: e.message }),
  });

  const callMut = useMutation({
    mutationFn: async (amountMinor: number) => {
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard (here and in distMut below) was unreachable dead code. The thrown
         ApiError reaches onError unchanged, preserving the failure toast. */
      const res = await apiRequest("POST", `/api/partner/me/spvs/${spvId}/capital-calls`, {
        amount_minor: amountMinor,
        called_at: new Date().toISOString(),
      });
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

      {/* W2-H — LP roster (subscribers + pending invites) + partner-gated invite. */}
      <Card className="p-4 mb-4 space-y-3" data-testid="partner-spv-lp-roster">
        <div className="font-medium">LP Roster</div>
        {roster.isLoading && <div className="text-sm text-slate-500" data-testid="partner-spv-lp-roster-loading">Loading…</div>}
        {roster.isError && (
          <div className="text-sm text-rose-600" data-testid="partner-spv-lp-roster-error">
            Could not load the LP roster. Please refresh and try again.
          </div>
        )}
        {roster.data && (
          <>
            {roster.data.subscribers.length === 0 && roster.data.invites.length === 0 ? (
              <div className="text-sm text-slate-500" data-testid="partner-spv-lp-roster-empty">
                No LPs yet. Invite one below to get started.
              </div>
            ) : (
              <table className="w-full text-sm" data-testid="partner-spv-lp-roster-table">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="text-left p-2">LP</th>
                    <th className="text-left p-2">Email</th>
                    <th className="text-left p-2">Commitment</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.data.subscribers.map((sub) => (
                    <tr key={sub.investorId} className="border-t" data-testid={`partner-spv-lp-sub-${sub.investorId}`}>
                      <td className="p-2">{sub.name ?? "—"}</td>
                      <td className="p-2 text-slate-500">{sub.email ?? "—"}</td>
                      <td className="p-2 font-mono">{formatMinor(sub.commitmentMinor, s.currency)}</td>
                      <td className="p-2">{sub.status}</td>
                    </tr>
                  ))}
                  {roster.data.invites.map((inv) => (
                    <tr key={inv.id} className="border-t text-slate-500" data-testid={`partner-spv-lp-invite-${inv.id}`}>
                      <td className="p-2">{[inv.firstName, inv.lastName].filter(Boolean).join(" ") || inv.lastName}</td>
                      <td className="p-2">{inv.email}</td>
                      <td className="p-2">—</td>
                      <td className="p-2">invited</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {canWriteLp && (
          <div className="pt-2 border-t space-y-2" data-testid="partner-spv-lp-invite-form">
            <div className="text-sm font-medium">Invite an LP</div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="First name (optional)"
                value={lpFirstName}
                onChange={(e) => setLpFirstName(e.target.value)}
                data-testid="partner-spv-lp-invite-firstname"
              />
              <Input
                placeholder="Last name *"
                value={lpLastName}
                onChange={(e) => setLpLastName(e.target.value)}
                data-testid="partner-spv-lp-invite-lastname"
              />
              <Input
                type="email"
                placeholder="Email *"
                value={lpEmail}
                onChange={(e) => setLpEmail(e.target.value)}
                data-testid="partner-spv-lp-invite-email"
              />
            </div>
            {!lpLastName.trim() && (
              <div className="text-xs text-rose-600" data-testid="partner-spv-lp-invite-lastname-error">
                Last name is required to invite an LP.
              </div>
            )}
            <Button
              disabled={!lpEmail.trim() || !lpLastName.trim() || inviteMut.isPending}
              onClick={() => inviteMut.mutate()}
              data-testid="partner-spv-lp-invite-submit"
            >
              {inviteMut.isPending ? "Inviting…" : "Send invite"}
            </Button>
          </div>
        )}
      </Card>

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
