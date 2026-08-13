/**
 * Foundation Build — Partner SPVs list page.
 * Read-only record-keeping (no money movement). Lists all SPVs recorded for this partner.
 */
import { useState } from "react";
import { formatMinor as formatMinorLib } from "@/lib/currency"; /* v25.38 currency sweep */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
/* v25.12 NL7 — toast errors on create. */
import { useToast } from "@/hooks/use-toast";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

/* MAJOR 3 (WAVE 2B) — FIELD-NAME CORRECTION, sibling of SC-1.
 *
 * Wave 2 fixed the DETAIL pages (PartnerSpvDetail.tsx) but this LIST page read
 * the same fictional fields, so Review B (build_log/WAVES_012_REVIEW_B.md,
 * MAJOR 3) left every row rendering `undefined` for the name and `$0.00` for
 * the target.
 *
 * GET /api/partner/me/spvs answers
 *   res.json({ spvs: spvEngineStore.listByPartner(...) })  — partnerRoutes.ts:1595-1597
 * i.e. an array of canonical `SpvDTO` (shared/spvEngine.ts:205-230). The DTO has:
 *   name              (NOT `spvName`)               — spvEngine.ts:208
 *   targetRaiseMinor  (NOT `targetSizeMinor`, and NULLABLE) — spvEngine.ts:214
 *
 * `spvName` remains a legitimate WRITE alias on POST /api/partner/me/spvs
 * (partnerRoutes.ts:1606) and PATCH /api/partner/me/spvs/:id
 * (partnerRoutes.ts:1681). It is a write alias only and is never echoed on
 * read, so the create form below still sends `spvName` — deliberately. */
type Spv = {
  id: string;
  name: string;
  jurisdiction: string;
  targetRaiseMinor: number | null;
  currency: string;
  status: string;
};

function formatMinor(minor: number, currency: string) {
  // v25.38 — delegate to shared ISO-4217-aware formatter (2-decimal parity).
  return formatMinorLib(minor, currency, { locale: "en-US" });
}

export default function PartnerSpvs() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [form, setForm] = useState({ spvName: "", jurisdiction: "Delaware", targetSizeMinor: "0", currency: "USD" });
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<{ spvs: Spv[] }>({
    /* v25.12 NL1 — explicit queryFn for robustness. */
    /* v25.15 NM6 — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/spvs"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spvs")).json(),
  });

  /* v25.12 NL7 — toast helper. */
  const { toast } = useToast();

  const create = useMutation({
    mutationFn: async () => {
      /* v25.33 — apiRequest() throws ApiError on non-2xx; the former `if (!res.ok)`
         guard was unreachable dead code. The thrown ApiError reaches onError
         unchanged, preserving the "Create SPV failed" toast. */
      const res = await apiRequest("POST", "/api/partner/me/spvs", {
        spvName: form.spvName,
        jurisdiction: form.jurisdiction,
        targetSizeMinor: parseInt(form.targetSizeMinor, 10),
        currency: form.currency,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/partner/me/spvs"] });
      setForm({ spvName: "", jurisdiction: "Delaware", targetSizeMinor: "0", currency: "USD" });
      setShowForm(false);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Create SPV failed", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole === "managing_partner" || me.subRole === "associate";
  const spvs = data?.spvs ?? [];

  return (
    <PartnerShell title="SPVs" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="mb-4 bg-[rgba(4,30,65,0.05)] border border-[rgba(4,30,65,0.2)] text-[var(--cv-color-navy)] p-3 rounded text-sm" data-testid="partner-spvs-disclaimer">
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

      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="spvs-loading">Loading…</div>}
      {/* v25.15 NM6 — explicit error branch. */}
      {isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="spvs-error"
        >
          Could not load SPVs. Please refresh and try again.
        </div>
      )}
      {!isLoading && !isError && spvs.length === 0 && (
        <PartnerEmptyState
          title="No SPVs recorded yet"
          description="Record an SPV to keep documentation in one place."
        />
      )}

      {spvs.length > 0 && (
        <div className="space-y-2" data-testid="partner-spvs-list">
          {spvs.map((s) => (
            <Card key={s.id} className="p-3" data-testid={`partner-spv-${s.id}`}>
              <Link href={`/collective/partner/spvs/${s.id}`} className="block hover:bg-[var(--cv-color-surface-2)] -m-3 p-3 rounded">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-[var(--cv-color-text-muted)]">{s.jurisdiction} · {s.status}</div>
                  </div>
                  <div className="text-right">
                    {/* MAJOR 3 — `targetRaiseMinor` is nullable on the DTO; an
                        unset target must read as "—", never as $0.00. */}
                    <div className="font-mono">
                      {s.targetRaiseMinor === null || s.targetRaiseMinor === undefined
                        ? "\u2014"
                        : formatMinor(s.targetRaiseMinor, s.currency)}
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
