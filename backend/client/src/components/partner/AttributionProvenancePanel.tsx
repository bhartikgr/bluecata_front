/**
 * WAVE 33 · CP-PIPE-06 — provenance integrity, and the pre-flight claim check.
 *
 * Enforcement that is only visible at the moment of rejection is not shipped.
 * This panel does two things the product could not do at all before:
 *
 *  1. States, per live attribution, whether its provenance is COMPLETE — the
 *     Clients table shows `attributionSource` as a bare string and has no way
 *     to say that a row is missing the person or the date behind it.
 *  2. Lets a partner ASK whether a company can be claimed, before attempting a
 *     write. Previously the only way to discover a company was already claimed
 *     was that there wasn't one: competing claims were silently admitted.
 *
 * EVERY sentence rendered here is authored by the server and printed verbatim —
 * including refusals and the empty state. Nothing is assembled client-side, so
 * the wording the partner reads cannot drift from the rule the store enforces.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProvenanceRow {
  id: string;
  companyId: string;
  attributionSource: string;
  attributedBy: string | null;
  attributedAt: string | null;
  selfService: boolean;
  intact: boolean;
  issues: string[];
  copy: string;
}

interface ProvenanceResponse {
  attributions: ProvenanceRow[];
  total: number;
  incomplete: number;
  summary: string;
  sources: string[];
}

interface PreflightResponse {
  companyId: string;
  verdict: string;
  admit: boolean;
  copy: string;
  contested: boolean;
}

export default function AttributionProvenancePanel() {
  const [companyId, setCompanyId] = useState("");
  const [checking, setChecking] = useState("");

  const q = useQuery<ProvenanceResponse>({
    queryKey: ["/api/partner/me/attributions/provenance"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/partner/me/attributions/provenance")).json(),
    retry: false,
  });

  const pre = useQuery<PreflightResponse>({
    queryKey: ["/api/partner/me/attributions/provenance", checking],
    queryFn: async () =>
      (await apiRequest(
        "GET",
        `/api/partner/me/attributions/provenance/${encodeURIComponent(checking)}`,
      )).json(),
    enabled: checking.trim().length > 0,
    retry: false,
  });

  return (
    <div className="rounded border p-4 space-y-4" data-testid="attribution-provenance-panel">
      <div>
        <h3 className="font-medium" data-testid="attribution-provenance-title">
          Attribution provenance
        </h3>
        <p className="text-xs text-[var(--cv-color-text-muted)]" data-testid="attribution-provenance-intro">
          Every attribution records how it arose, who made it and when. Provenance is not optional and is
          not assumed, and an attribution held by another partner cannot be taken by asserting a competing
          claim — an administrator decides.
        </p>
      </div>

      {q.isLoading ? (
        <div className="text-sm" data-testid="attribution-provenance-loading">
          Reading attribution provenance…
        </div>
      ) : q.error || !q.data ? (
        <div className="text-sm" data-testid="attribution-provenance-unavailable">
          Attribution provenance could not be read. No status is shown rather than one that may be wrong —
          nothing has been changed.
        </div>
      ) : (
        <>
          {/* Server-authored. It deliberately does NOT say "0 problems" for an
              empty list: no rows is not a clean bill of health. */}
          <div className="text-sm" data-testid="attribution-provenance-summary">
            {q.data.summary}
          </div>

          {q.data.attributions.length > 0 ? (
            <ul className="space-y-2" data-testid="attribution-provenance-list">
              {q.data.attributions.map((a) => (
                <li key={a.id} className="border-t pt-2" data-testid={`attribution-provenance-row-${a.id}`}>
                  <div className="text-sm font-medium">{a.companyId}</div>
                  <div className="text-xs text-[var(--cv-color-text-muted)]">
                    {/* Nulls render as an em dash, never as a fabricated value. */}
                    Source: {a.attributionSource || "—"} · By: {a.attributedBy || "—"} · On:{" "}
                    {a.attributedAt || "—"}
                  </div>
                  <div
                    className="text-xs"
                    data-testid={`attribution-provenance-integrity-${a.id}`}
                  >
                    {a.copy}
                  </div>
                  {a.selfService ? (
                    <div
                      className="text-xs text-[var(--cv-color-text-faint)]"
                      data-testid={`attribution-provenance-selfservice-${a.id}`}
                    >
                      This attribution was self-asserted rather than adjudicated by an administrator.
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      <div className="border-t pt-3 space-y-2">
        <Label htmlFor="prov-company" className="text-xs">
          Check whether a company can be claimed
        </Label>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            id="prov-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            placeholder="company id"
            data-testid="attribution-provenance-company-input"
          />
          <Button
            variant="outline"
            onClick={() => setChecking(companyId.trim())}
            disabled={companyId.trim().length === 0}
            data-testid="attribution-provenance-check"
          >
            Check
          </Button>
        </div>
        {checking && pre.isLoading ? (
          <div className="text-xs" data-testid="attribution-provenance-preflight-loading">
            Checking…
          </div>
        ) : checking && (pre.error || !pre.data) ? (
          <div className="text-xs" data-testid="attribution-provenance-preflight-unavailable">
            This company's attribution status could not be read. No verdict is shown rather than one that
            may be wrong.
          </div>
        ) : pre.data ? (
          <div className="text-xs" data-testid="attribution-provenance-preflight-result">
            {/* The refusal sentence is the server's, printed verbatim. The
                incumbent partner is deliberately NOT named: a provenance check
                must not become a way to enumerate a competitor's portfolio. */}
            {pre.data.copy}
          </div>
        ) : null}
      </div>
    </div>
  );
}
