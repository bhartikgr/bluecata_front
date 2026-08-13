/**
 * Foundation Build — Partner Funds list page.
 * Read-only record-keeping for fund commitments. No money movement.
 */
import { useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
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

/* MAJOR 3 (WAVE 2B) — FIELD-NAME CORRECTION, sibling of the SC-1 fix applied to
 * PartnerFundDetail.tsx in Wave 2.
 *
 * GET /api/partner/me/funds answers
 *   res.json({ funds: spvEngineStore.listByPartner(...).filter(spvType==="fund") })
 *                                       — server/partnerRoutes.ts:1736-1739
 * so every element is a canonical `SpvDTO` (shared/spvEngine.ts:205-230), NOT a
 * bespoke fund record. Three of the four fields read here did not exist:
 *   fundName        → DTO field is `name`                    (spvEngine.ts:208)
 *   targetSizeMinor → DTO field is `targetRaiseMinor`, NULLABLE (spvEngine.ts:214)
 *   vintageYear     → not a DTO field at all. The fund shim stores the vintage
 *                     inside the `terms` JSON blob it writes on create
 *                     (server/partnerRoutes.ts:1771 — `terms: { … vintage … }`),
 *                     which is exactly where PartnerFundDetail.tsx reads it.
 *
 * `fundName` and `targetSizeMinor` remain legitimate WRITE aliases on
 * POST /api/partner/me/funds (partnerRoutes.ts:1747) and PATCH .../funds/:id
 * (partnerRoutes.ts:1798-1799). They are write aliases only and are never echoed
 * on read, so the create form below still sends them — deliberately. */
type Fund = {
  id: string;
  name: string;
  targetRaiseMinor: number | null;
  currency: string;
  status: string;
  /** Fund-specific values (incl. `vintage`) live in the shim's `terms` blob. */
  terms: Record<string, unknown> | null;
};

/** `terms` is `Record<string, unknown>`; render defensively.
 *  Mirrors `termsValue` in PartnerFundDetail.tsx. */
function termsValue(terms: Record<string, unknown> | null, key: string): string | null {
  const v = terms?.[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
}

function formatMinor(minor: number, currency: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, currency, { locale: "en-US" });
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
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard was unreachable dead code. The thrown ApiError reaches onError
         unchanged, preserving the "Create fund failed" toast. */
      const res = await apiRequest("POST", "/api/partner/me/funds", {
        fundName: form.fundName,
        vintageYear: parseInt(form.vintageYear, 10),
        targetSizeMinor: parseInt(form.targetSizeMinor, 10),
        currency: form.currency,
      });
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
      <div className="mb-4 bg-[rgba(4,30,65,0.05)] border border-[rgba(4,30,65,0.2)] text-[var(--cv-color-navy)] p-3 rounded text-sm" data-testid="partner-funds-disclaimer">
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

      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="funds-loading">Loading…</div>}
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
              <Link href={`/collective/partner/funds/${f.id}`} className="block hover:bg-[var(--cv-color-surface-2)] -m-3 p-3 rounded">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs text-[var(--cv-color-text-muted)]">
                      {/* MAJOR 3 — vintage comes from `terms`, and a fund created
                          without one must not render "Vintage undefined". */}
                      {/* Kept as literal JSX text (not a template string) so the
                          "Vintage" copy string stays in the guard inventory. */}
                      {termsValue(f.terms, "vintage") ? (
                        <>
                          Vintage {termsValue(f.terms, "vintage")} · {f.status}
                        </>
                      ) : (
                        f.status
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    {/* MAJOR 3 — nullable target must read as "—", never $0.00. */}
                    <div className="font-mono">
                      {f.targetRaiseMinor === null || f.targetRaiseMinor === undefined
                        ? "\u2014"
                        : formatMinor(f.targetRaiseMinor, f.currency)}
                    </div>
                    <div className="text-xs text-[var(--cv-color-text-muted)]">target</div>
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
