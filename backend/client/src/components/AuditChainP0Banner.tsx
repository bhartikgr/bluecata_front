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
import { Link } from "wouter"; /* WAVE 157 — R124.3 */
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
          {/* WAVE 93 · ITEM 2 — THIS ALARM IS REAL, AND IT IS NOT SUPPRESSED.
              The wave established the truth before touching anything
              (build_log/wave93/W93_AUDIT_CHAIN.md): an EMPTY chain verifies clean and a
              canonically-appended single row verifies clean, so "link 0 of 1" is
              neither an off-by-one nor an empty chain misreported. It means the one
              record in that ledger does not match its own hash, because a retired
              script formula wrote it directly instead of through the append path.
              Wave 51 fixed the writers; the already-written record is still there.

              So NOTHING here hides the alarm. What is ADDED is the plain-English
              meaning and the one instruction an operator needs, because an alarm
              that says only "chain broken at link 0 of 1" on every page for weeks
              is what actually teaches people to ignore alarms. The raw key, status
              and technical detail are all still rendered underneath, unchanged. */}
          <p className="mt-1 text-sm text-white/90">
            One record in the ledger below does not match its own integrity hash, so
            the ledger cannot be proved unaltered from that record onwards. No record
            has been lost and new records are still being written and verified. Do not
            clear this — the platform will refuse to clear it while the mismatch is
            real. It needs an integrity repair, not a dismissal.
          </p>
          {/* WAVE 157 · R124.3 — NAVIGATION ONLY, AND THE POINT OF THE WAVE.
              This banner has said "immediate review required" on every admin page
              without ever saying WHERE the review happens. The repair screen has
              existed all along at /admin/audit-chain-verify (routed in
              client/src/App.tsx, and also reachable at /admin/audit/verify-chain);
              it was simply unreachable from the alarm. Nothing else is touched:
              not `data.incident` — the trigger — not the re-anchor call, not the
              incident state machine. The wording says "check and repair", not
              "clear", because the paragraph above correctly says the platform will
              refuse to clear a real mismatch. */}
          <p className="mt-2 text-sm">
            <Link
              href="/admin/audit-chain-verify"
              className="font-semibold underline decoration-white/70 text-white"
              data-testid="link-audit-chain-p0-resolve"
            >
              Go to Audit chain verification to check and repair the chain
            </Link>
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
