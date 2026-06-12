/**
 * Foundation Build — Partner SPV detail page.
 * Read-only view of one SPV record. Shows hash chain receipt.
 */
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Card } from "@/components/ui/card";

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

  const { data, isLoading, error } = useQuery<{ spv: SpvDetail }>({
    queryKey: [`/api/partner/me/spvs/${spvId}`],
    enabled: role.ready && !!role.identity && !!spvId,
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
