/**
 * v25.47 APD-029 (BLOCKER-6) — Admin audit-chain P0 banner.
 *
 * Polls GET /api/admin/audit-chain-health and renders a high-visibility banner
 * ONLY when the chain is in an incident state (any row status != 'ok', surfaced
 * by the endpoint's `incident` flag). DB-flag-driven — nothing hardcoded; when
 * the chain is healthy the component renders nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface AuditChainHealthRow {
  key: string;
  status: string;
  detail: string | null;
  updatedAt: string | null;
}

interface AuditChainHealthResponse {
  ok: boolean;
  incident: boolean;
  rows: AuditChainHealthRow[];
}

export function AuditChainP0Banner() {
  const { data } = useQuery<AuditChainHealthResponse>({
    queryKey: ["/api/admin/audit-chain-health"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/audit-chain-health")).json(),
    retry: false,
    refetchInterval: 60_000,
  });

  if (!data?.ok || !data.incident) return null;

  const incidentRows = data.rows.filter((r) => String(r.status).toLowerCase() !== "ok");

  return (
    <div
      role="alert"
      className="border-b border-red-700 bg-[#cc0001] px-6 py-3 text-white"
      data-testid="audit-chain-p0-banner"
    >
      <div className="max-w-[1400px] mx-auto flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold">
            Audit chain integrity incident — immediate review required
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-white/90">
            {incidentRows.map((r) => (
              <li key={r.key} data-testid={`audit-chain-incident-${r.key}`}>
                <span className="font-medium">{r.key}</span>: {r.status}
                {r.detail ? ` — ${r.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default AuditChainP0Banner;
