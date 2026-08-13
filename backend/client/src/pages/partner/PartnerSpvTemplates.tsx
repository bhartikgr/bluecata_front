/**
 * WAVE 30 · ENGINE 3 — SPV Templates.
 *
 * `spv_template` was absent tree-wide before this wave — verified at source, the
 * only mention anywhere was `docs/WAVE_D_LINE_DELTA_AUDIT.md:121` tracking it as
 * an expected surface with "zero hits". Migration 0177 creates the tables; this
 * page is their first and only surface.
 *
 * WHAT IT IS FOR: a sponsor that runs the same structure repeatedly has had to
 * re-enter jurisdiction, carry basis, minimum check and LP visibility into the
 * SPV wizard on every launch. A template saves those defaults once.
 *
 * WHAT "APPLY" DOES, AND DELIBERATELY DOES NOT DO: it copies the template's
 * values into the SPV create form. It does NOT create an SPV, and the UI says so
 * in as many words. SPV creation is gated by the Wave 1c launch sign-off, which
 * records a durable attested signature before the SPV row exists; an
 * apply-and-launch shortcut would route around that gate. The operator still
 * signs.
 *
 * MONEY RENDERING: every amount goes through `formatMinor(minor, currency)`.
 * Never `/100` — that is wrong by a factor of one hundred for JPY and every
 * other zero-decimal currency. An unset amount renders as an explicit "Not set",
 * never as a zero amount, because "no minimum check" and "a minimum check of
 * zero" are different statements about a deal.
 *
 * CARRY RENDERING: carry is stored as an integer fraction scaled by 1e9. It is
 * rendered by dividing by that scale, and the input takes a PERCENT which is
 * converted once, explicitly, at the point of entry. The forbidden
 * `n > 1 ? n / 100 : n` guess appears nowhere: Wave 5 / P-4 is what that costs.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest } from "@/lib/queryClient";
import { formatMinor, toMinor } from "@/lib/currency";

/** Must match `CARRY_FRACTION_SCALE` in server/lib/money.ts. */
const CARRY_SCALE = 1000000000;

interface TemplateRow {
  id: string;
  partnerId: string;
  name: string;
  description: string | null;
  spvType: string;
  jurisdiction: string;
  carryBasis: string;
  distributionScope: string | null;
  lpVisibility: string | null;
  currency: string;
  minCheckMinor: number | null;
  targetRaiseMinor: number | null;
  capMinor: number | null;
  carryFractionScaled: number | null;
  isArchived: boolean;
  usageCount: number;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CurrencyCount {
  currency: string;
  templates: number;
  withMinCheck: number;
}

interface ListResponse {
  templates: TemplateRow[];
  countsByCurrency: CurrencyCount[];
}

/**
 * Renders an amount, or an explicit refusal when it is unset. Returning "—" or
 * "0" for a null would assert something the data does not say.
 */
function Amount({ minor, currency }: { minor: number | null; currency: string }) {
  if (minor === null || minor === undefined) {
    return (
      <span className="text-muted-foreground italic" data-testid="amount-not-set">
        Not set
      </span>
    );
  }
  return <span>{formatMinor(minor, currency)}</span>;
}

/** Carry as a percentage, derived from the scaled integer fraction. */
function carryLabel(scaled: number | null): string {
  if (scaled === null || scaled === undefined) return "Not set";
  const pct = (scaled / CARRY_SCALE) * 100;
  return `${Number(pct.toFixed(4))}%`;
}

export default function PartnerSpvTemplates() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [prefill, setPrefill] = useState<Record<string, unknown> | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    description: "",
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    spvType: "spv",
    currency: "USD",
    minCheck: "",
    targetRaise: "",
    carryPct: "",
  });

  const listQ = useQuery<ListResponse>({
    queryKey: ["/api/partner/me/spv-templates", includeArchived],
    enabled: role.ready,
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/partner/me/spv-templates${includeArchived ? "?includeArchived=1" : ""}`,
        )
      ).json(),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["/api/partner/me/spv-templates"] });

  const createM = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await apiRequest("POST", "/api/partner/me/spv-templates", body)).json(),
    onSuccess: () => {
      setShowNew(false);
      setFormError(null);
      invalidate();
    },
    onError: (e: any) => setFormError(String(e?.message ?? "Could not save the template.")),
  });

  const applyM = useMutation({
    mutationFn: async (id: string) =>
      (await apiRequest("POST", `/api/partner/me/spv-templates/${id}/apply`, {})).json(),
    onSuccess: (res: any) => {
      setPrefill(res?.prefill ?? null);
      invalidate();
    },
  });

  const archiveM = useMutation({
    mutationFn: async (v: { id: string; archived: boolean }) =>
      (
        await apiRequest("POST", `/api/partner/me/spv-templates/${v.id}/archive`, {
          archived: v.archived,
        })
      ).json(),
    onSuccess: invalidate,
  });

  const templates = listQ.data?.templates ?? [];
  const counts = listQ.data?.countsByCurrency ?? [];

  /* Mirrors the server's WRITE_ROLES exactly. This is a CONVENIENCE, not the
     control: the server refuses on its own regardless of what the UI renders.
     Hiding a button the server would reject is a courtesy; relying on the
     hidden button as the gate would be the defect. */
  const canWrite = useMemo(() => {
    const sub = String(role.identity?.subRole ?? "");
    return ["managing_partner", "associate", "bd"].includes(sub);
  }, [role.identity]);

  function submit() {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("A template name is required.");
      return;
    }
    /* Carry is entered as a PERCENT and converted here, once, explicitly. The
     * forbidden `n > 1 ? n / 100 : n` inference is not used: it cannot tell a 1%
     * carry written as 1 from a 100% carry written as 1, and Wave 5 / P-4 shows
     * what guessing costs — an 8% hurdle silently became a 100% preferred
     * return. Out-of-range REJECTS here and again at the server and again at the
     * database CHECK constraint. */
    let carryFractionScaled: number | null = null;
    if (form.carryPct.trim() !== "") {
      const pct = Number(form.carryPct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        setFormError("Carry must be a percentage between 0 and 100.");
        return;
      }
      carryFractionScaled = Math.round((pct / 100) * CARRY_SCALE);
    }
    /* Amounts are entered in MAJOR units and converted with the shared
     * `toMinor(amount, currency)`, which consults the ISO-4217 exponent table.
     * NOT `* 100` — that is wrong by a factor of one hundred for JPY and every
     * other zero-decimal currency, in the opposite direction from the `/100`
     * render bug and just as silent.
     *
     * Blank stays BLANK: it is sent as null, never coerced to 0, because "no
     * minimum check" and "a minimum check of zero" are different statements. */
    const toMinorSafe = (raw: string): number | null => {
      if (raw.trim() === "") return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return null;
      return toMinor(n, form.currency);
    };
    createM.mutate({
      name: form.name.trim(),
      description: form.description.trim() || null,
      jurisdiction: form.jurisdiction,
      carryBasis: form.carryBasis,
      spvType: form.spvType,
      currency: form.currency,
      minCheckMinor: toMinorSafe(form.minCheck),
      targetRaiseMinor: toMinorSafe(form.targetRaise),
      carryFractionScaled,
    });
  }

  if (!role.ready || !role.identity) return null;

  return (
    <PartnerShell
      title="SPV Templates"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      <div className="space-y-6" data-testid="spv-templates-root">
        <section className="rounded-lg border p-4" data-testid="spv-templates-intro">
          <h2 className="text-lg font-semibold">Reusable SPV structures</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Save the jurisdiction, carry basis and economics you use repeatedly, then apply them
            when launching a vehicle. Applying a template fills in the create form —{" "}
            <strong>it does not create an SPV</strong>. Every launch still goes through the signed
            sign-off flow.
          </p>
        </section>

        {/* Per-currency, never a cross-currency total: summing minor units across
            currencies produces a number that is not money in any of them. */}
        <section className="rounded-lg border p-4" data-testid="spv-templates-currency-strip">
          <h3 className="text-sm font-medium mb-2">By currency</h3>
          {counts.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="currency-strip-empty">
              No active templates yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {counts.map((c) => (
                <div
                  key={c.currency}
                  className="rounded border px-3 py-2 text-sm"
                  data-testid={`currency-count-${c.currency}`}
                >
                  <span className="font-semibold">{c.currency}</span>
                  <span className="text-muted-foreground"> · {c.templates} template(s)</span>
                  <span className="text-muted-foreground"> · {c.withMinCheck} with a minimum</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Counts are shown per currency. Amounts in different currencies are never added
            together.
          </p>
        </section>

        <section className="flex items-center gap-3" data-testid="spv-templates-controls">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              data-testid="toggle-include-archived"
            />
            Show archived
          </label>
          {canWrite ? (
            <button
              type="button"
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={() => setShowNew((v) => !v)}
              data-testid="button-new-spv-template"
            >
              {showNew ? "Cancel" : "New template"}
            </button>
          ) : (
            /* An explicit rendered refusal rather than a silently missing or
               dead control — the operator is told why, not left guessing. */
            <span className="text-sm text-muted-foreground" data-testid="spv-templates-readonly">
              Your role can view templates but not create them.
            </span>
          )}
        </section>

        {showNew && canWrite && (
          <section className="rounded-lg border p-4 space-y-3" data-testid="spv-template-form">
            {formError && (
              <p className="text-sm text-destructive" data-testid="spv-template-form-error">
                {formError}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Name
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="input-template-name"
                />
              </label>
              <label className="text-sm">
                Currency
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                  data-testid="input-template-currency"
                />
              </label>
              <label className="text-sm">
                Jurisdiction
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.jurisdiction}
                  onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
                  data-testid="input-template-jurisdiction"
                />
              </label>
              <label className="text-sm">
                Carry basis
                <select
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.carryBasis}
                  onChange={(e) => setForm({ ...form, carryBasis: e.target.value })}
                  data-testid="select-template-carry-basis"
                >
                  <option value="whole_spv">Whole SPV</option>
                  <option value="per_deployment">Per deployment</option>
                </select>
              </label>
              <label className="text-sm">
                Minimum check ({form.currency})
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.minCheck}
                  onChange={(e) => setForm({ ...form, minCheck: e.target.value })}
                  placeholder="Leave blank for no minimum"
                  data-testid="input-template-min-check"
                />
              </label>
              <label className="text-sm">
                Carry %
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={form.carryPct}
                  onChange={(e) => setForm({ ...form, carryPct: e.target.value })}
                  placeholder="e.g. 20"
                  data-testid="input-template-carry-pct"
                />
              </label>
            </div>
            <button
              type="button"
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={submit}
              disabled={createM.isPending}
              data-testid="button-save-spv-template"
            >
              {createM.isPending ? "Saving…" : "Save template"}
            </button>
          </section>
        )}

        {prefill && (
          <section
            className="rounded-lg border border-primary p-4"
            data-testid="spv-template-prefill-panel"
          >
            <h3 className="text-sm font-semibold">
              Template applied — carry these values into the SPV create form
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              No SPV has been created. Launching still requires the signed sign-off on the SPV
              create form.
            </p>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Jurisdiction</dt>
                <dd data-testid="prefill-jurisdiction">{String(prefill.jurisdiction ?? "")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Carry basis</dt>
                <dd data-testid="prefill-carry-basis">{String(prefill.carryBasis ?? "")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Minimum check</dt>
                <dd data-testid="prefill-min-check">
                  <Amount
                    minor={(prefill.minCheckMinor as number | null) ?? null}
                    currency={String(prefill.currency ?? "USD")}
                  />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Carry</dt>
                <dd data-testid="prefill-carry">
                  {carryLabel((prefill.carryFractionScaled as number | null) ?? null)}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="mt-3 rounded border px-3 py-1.5 text-sm"
              onClick={() => setPrefill(null)}
              data-testid="button-dismiss-prefill"
            >
              Dismiss
            </button>
          </section>
        )}

        <section data-testid="spv-templates-list">
          {listQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading templates…</p>
          ) : templates.length === 0 ? (
            <PartnerEmptyState
              title="No SPV templates yet"
              description="Save a structure you use repeatedly and it will appear here, ready to apply to your next vehicle."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2">Template</th>
                    <th className="px-3 py-2">Structure</th>
                    <th className="px-3 py-2">Minimum check</th>
                    <th className="px-3 py-2">Carry</th>
                    <th className="px-3 py-2">Used</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-t" data-testid={`spv-template-row-${t.id}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{t.name}</div>
                        {t.description && (
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        )}
                        {t.isArchived && (
                          <span
                            className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-xs"
                            data-testid={`badge-archived-${t.id}`}
                          >
                            Archived
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div>{t.jurisdiction}</div>
                        <div className="text-xs text-muted-foreground">
                          {t.spvType} · {t.carryBasis}
                        </div>
                      </td>
                      <td className="px-3 py-2" data-testid={`min-check-${t.id}`}>
                        <Amount minor={t.minCheckMinor} currency={t.currency} />
                      </td>
                      <td className="px-3 py-2" data-testid={`carry-${t.id}`}>
                        {carryLabel(t.carryFractionScaled)}
                      </td>
                      <td className="px-3 py-2" data-testid={`usage-${t.id}`}>
                        {t.usageCount}
                      </td>
                      <td className="px-3 py-2">
                        {canWrite ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-xs"
                              disabled={t.isArchived || applyM.isPending}
                              onClick={() => applyM.mutate(t.id)}
                              data-testid={`button-apply-${t.id}`}
                            >
                              Apply
                            </button>
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-xs"
                              onClick={() =>
                                archiveM.mutate({ id: t.id, archived: !t.isArchived })
                              }
                              data-testid={`button-archive-${t.id}`}
                            >
                              {t.isArchived ? "Restore" : "Archive"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">View only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PartnerShell>
  );
}
