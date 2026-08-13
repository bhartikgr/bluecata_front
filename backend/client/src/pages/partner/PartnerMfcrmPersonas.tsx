/**
 * WAVE 20 / XT-10 — Partner persona surface for the Managed-Founder CRM.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE EXISTS
 * ---------------------------------------------------------------------------
 * `server/managedFounderPersonaRoutes.ts` registers 17 partner-facing routes,
 * mounted at `server/routes.ts:1014`. Before this wave a grep of `client/` for
 * `mfcrm/angel`, `mfcrm/acct` or `mfcrm/law` returned ZERO hits: seventeen live,
 * gated, DB-backed endpoints with no door. Per the standing owner rule, an
 * engine with no route — or a route with no UI — is not shipped.
 *
 * This page is that door. It is DB-driven end to end: which persona it shows,
 * which controls inside it are enabled, and every row it lists all come from
 * the server. There is no seeded data, no in-memory list and no hardcoded
 * partner or firm anywhere in this file.
 *
 * ---------------------------------------------------------------------------
 * FAIL-CLOSED, AND THE REFUSAL IS RENDERED
 * ---------------------------------------------------------------------------
 * `sendError` (`server/managedFounderPersonaRoutes.ts:32-40`) maps anything that
 * is not a 404/400/500 to **403** — capability denials are authority denials.
 * A 403 here must show copy explaining what is missing. It must never render an
 * empty list, a zero, or a cheerful "nothing yet": a law firm with a live
 * conflict register being shown "No conflicts" because its profile is
 * unreadable is the precise failure mode this codebase has already shipped
 * once. Every list below therefore distinguishes THREE states — loading,
 * refused/errored (with copy), and genuinely empty — and never collapses the
 * middle one into the last.
 *
 * ---------------------------------------------------------------------------
 * MONEY AND PERCENT
 * ---------------------------------------------------------------------------
 * Rebills are integer minor units plus an ISO currency (`mf_acct_rebill`,
 * `server/mfcrmAcctStore.ts:105-108`). They render through `formatMinor`
 * (`client/src/lib/currency.ts:102`), which honours the ISO-4217 exponent, so a
 * ¥5000 JPY expense shows as ¥5,000 and not ¥50.00. There is no `/100` in this
 * file.
 *
 * Totals are grouped BY CURRENCY and never summed across them. Note that the
 * server's own `fundAdminReport` DOES sum `amount_minor` across currencies into
 * a single `pendingAmountMinor` (`server/mfcrmAcctStore.ts:156`) — that figure
 * is meaningless for a multi-currency partner, so this page deliberately does
 * not print it as money; it renders per-currency subtotals computed from the
 * rebill rows instead, and says so on screen. The server defect is recorded in
 * the wave report rather than papered over here.
 *
 * Chapter carry is stored in BASIS POINTS as an integer (`carry_bps`,
 * `server/mfcrmAngelStore.ts:63`). Basis points are not the fractional
 * convention `client/src/lib/percentDisplay.ts` guards, so the conversion is an
 * explicit, documented `bps / 100` unit change into `formatPercentValue`, never
 * the forbidden `n > 1 ? n / 100 : n` guess.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PartnerShell, PartnerEmptyState } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
/* `currencyExponent` is imported alongside `formatMinor` so the write side
 * (major → minor) and the read side (minor → display) use the SAME ISO
 * exponent table and cannot disagree. */
import { formatMinor, currencyExponent as currencyExponentFor } from "@/lib/currency";
import { formatPercentValue } from "@/lib/percentDisplay";
import {
  MFCRM_PERSONAS,
  capabilityLabel,
  gateRefusalText,
  personaActionState,
  resolvePersona,
  type MfcrmCapability,
  type MfcrmPersonaAction,
  type MfcrmPersonaDef,
} from "@/lib/partner/mfcrmPersona";

/* ---------------------------------------------------------------- error copy */

/**
 * Server error code → partner-facing sentence. Every code below was read in the
 * store or route that throws it; none is invented. Anything unmapped falls
 * through to the server's own message, which is always shown rather than
 * swallowed.
 */
const PERSONA_ERROR_COPY: Record<string, string> = {
  CHAPTER_SCOPING_REQUIRED:
    "Chapter scoping is not enabled for your firm, so chapters cannot be created or changed. An administrator enables it on your capability profile.",
  PAYS_ON_BEHALF_REQUIRED:
    "Your firm is not marked as paying on behalf of founders, so rebillable expenses cannot be recorded. An administrator enables this on your capability profile.",
  DOCUMENT_CUSTODY_REQUIRED:
    "Document custody is not enabled for your firm, so documents cannot be taken into custody. An administrator enables it on your capability profile.",
  FUND_ADMIN_REQUIRED:
    "Fund administration is not enabled for your firm, so the fund-administration report is unavailable. An administrator enables it on your capability profile.",
  INVESTOR_SPINE_FORBIDDEN:
    "Your firm is currently marked as sourcing capital, which is incompatible with acting as counsel of record. An administrator must correct the capability profile.",
  CAPABILITY_UNCLASSIFIED:
    "Your firm's capability profile has not been classified yet. An administrator classifies the partner firm before persona tools become available.",
  COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED:
    "That company is not attributed to your firm, so it cannot be acted on here.",
  COMPANY_ID_REQUIRED: "Enter the company this applies to.",
  CHAPTER_NAME_REQUIRED: "Enter a name for the chapter.",
  CHAPTER_ID_REQUIRED: "Choose a chapter.",
  CHAPTER_NOT_FOUND: "That chapter no longer exists.",
  ENGAGEMENT_NOT_FOUND: "That engagement no longer exists, or is not attributed to your firm.",
  DESCRIPTION_REQUIRED: "Describe the expense being rebilled.",
  DOC_REF_REQUIRED: "Enter the document reference to take into custody.",
  MATTER_TITLE_REQUIRED: "Enter a title for the matter.",
  CONFLICT_CODE_REQUIRED: "Enter a conflict code.",
  CONFLICT_NOT_FOUND: "That conflict record no longer exists.",
  STRICT_PERSIST_FAILED: "The change could not be saved. Nothing was recorded — please try again.",
};

function personaErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : null;
  if (code && PERSONA_ERROR_COPY[code]) return PERSONA_ERROR_COPY[code];
  const msg = (err as Error)?.message;
  return msg && msg.trim() ? msg : "The request could not be completed.";
}

/**
 * The rendered failure state for a list. RULE 3: a refusal is copy, never an
 * empty state and never a zero. `testId` is distinct per list so a harness can
 * pin that THIS list refused, not merely that some error text exists on the
 * page.
 */
function PersonaLoadError({ err, testId }: { err: unknown; testId: string }) {
  const code = err instanceof ApiError ? err.code : null;
  return (
    <div
      className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
      data-testid={testId}
    >
      <div className="font-medium">This could not be loaded.</div>
      <div className="mt-1" data-testid={`${testId}-message`}>{personaErrorMessage(err)}</div>
      {code && (
        <div className="mt-1 text-xs text-rose-700" data-testid={`${testId}-code`}>
          Reference: {code}
        </div>
      )}
    </div>
  );
}

/** The rendered refusal for a CONTROL whose capability gate the profile fails.
 *  Shown INSTEAD of the control, so the partner never presses a button that is
 *  guaranteed to 403. */
function GateNotice({ action, capability, testId }: { action: MfcrmPersonaAction; capability: MfcrmCapability | null; testId: string }) {
  const state = personaActionState(action, capability);
  if (state.allowed) return null;
  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      data-testid={testId}
    >
      <div className="font-medium">{action.label} is not available to your firm.</div>
      <div className="mt-1" data-testid={`${testId}-reason`}>{gateRefusalText(state.blockedBy)}</div>
    </div>
  );
}

/* --------------------------------------------------------------- primitives */

function SectionCard({ title, description, testId, children }: { title: string; description?: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-[var(--cv-color-border)] bg-white p-4" data-testid={testId}>
      <h3 className="text-sm font-semibold text-[var(--cv-color-text)]">{title}</h3>
      {description && <p className="mt-0.5 text-xs text-[var(--cv-color-text-muted)]">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Chapter carry, basis points → percent. `carry_bps` is an integer count of
 *  hundredths of a percent, so 2000 bps is 20%. This is a UNIT conversion with
 *  a known source unit, not a magnitude guess. */
function carryBpsToPercentText(bps: unknown): string {
  const n = typeof bps === "number" ? bps : Number(bps);
  if (!Number.isFinite(n)) return "—";
  return formatPercentValue(n / 100);
}

/* =========================================================== ANGEL persona */

interface ChapterRow { id: string; name: string; region: string | null; carry_bps: number; status: string }
interface CarryReportRow { chapterId: string; name: string; region: string | null; carryBps: number; engagementCount: number; activeCount: number }

function AngelPersona({ persona, capability, canWrite }: { persona: MfcrmPersonaDef; capability: MfcrmCapability | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [carryPct, setCarryPct] = useState("");
  const [engagementId, setEngagementId] = useState("");
  const [assignChapterId, setAssignChapterId] = useState("");

  const act = (id: string) => persona.actions.find((a) => a.id === id)!;

  const chaptersQ = useQuery<{ chapters: ChapterRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/angel/chapters"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/angel/chapters")).json(),
  });
  const reportQ = useQuery<{ report: CarryReportRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/angel/carry-report"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/angel/carry-report")).json(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/angel/chapters"] });
    qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/angel/carry-report"] });
  };

  const createM = useMutation({
    mutationFn: async () => {
      /* Percent input → basis points. Rounding a user-typed RATE to the nearest
       * basis point is not the forbidden "round a per-party share" — no amount
       * is being apportioned here; the server itself truncates to an integer
       * (`Math.trunc`, mfcrmAngelStore.ts:63), so rounding first is what makes
       * a typed 12.5% land on 1250 rather than 1249. */
      const pct = Number(carryPct);
      const carryBps = Number.isFinite(pct) ? Math.max(0, Math.round(pct * 100)) : 0;
      return (await apiRequest("POST", "/api/partner/me/mfcrm/angel/chapters", {
        name, region: region.trim() ? region.trim() : null, carryBps,
      })).json();
    },
    onSuccess: () => { setName(""); setRegion(""); setCarryPct(""); invalidate(); toast({ title: "Chapter created" }); },
    onError: (e) => toast({ title: "Could not create chapter", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const carryM = useMutation({
    mutationFn: async (v: { chapterId: string; pct: string }) => {
      const pct = Number(v.pct);
      const carryBps = Number.isFinite(pct) ? Math.max(0, Math.round(pct * 100)) : 0;
      return (await apiRequest("PATCH", `/api/partner/me/mfcrm/angel/chapters/${encodeURIComponent(v.chapterId)}/carry`, { carryBps })).json();
    },
    onSuccess: () => { invalidate(); toast({ title: "Carry updated" }); },
    onError: (e) => toast({ title: "Could not update carry", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const assignM = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", `/api/partner/me/mfcrm/angel/engagements/${encodeURIComponent(engagementId)}/chapter`, { chapterId: assignChapterId })).json(),
    onSuccess: () => { setEngagementId(""); setAssignChapterId(""); invalidate(); toast({ title: "Engagement assigned to chapter" }); },
    onError: (e) => toast({ title: "Could not assign engagement", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const chapters = chaptersQ.data?.chapters ?? [];

  return (
    <div data-testid="mfcrm-persona-angel">
      <SectionCard title="Chapters" description="Regional chapters of your network, and the carry each one earns." testId="mfcrm-angel-chapters">
        {chaptersQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-angel-chapters-loading">Loading…</div>}
        {chaptersQ.isError && <PersonaLoadError err={chaptersQ.error} testId="mfcrm-angel-chapters-error" />}
        {!chaptersQ.isLoading && !chaptersQ.isError && chapters.length === 0 && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-angel-chapters-empty">
            No chapters recorded yet.
          </div>
        )}
        {!chaptersQ.isError && chapters.length > 0 && (
          <table className="w-full text-sm" data-testid="mfcrm-angel-chapters-table">
            <thead>
              <tr className="text-left text-xs text-[var(--cv-color-text-muted)]">
                <th className="py-1">Chapter</th><th className="py-1">Region</th><th className="py-1">Carry</th><th className="py-1">Status</th><th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {chapters.map((c) => (
                <tr key={c.id} className="border-t border-[var(--cv-color-border)]" data-testid={`mfcrm-angel-chapter-${c.id}`}>
                  <td className="py-1.5">{c.name}</td>
                  <td className="py-1.5">{c.region ?? "—"}</td>
                  <td className="py-1.5" data-testid={`mfcrm-angel-chapter-carry-${c.id}`}>{carryBpsToPercentText(c.carry_bps)}</td>
                  <td className="py-1.5">{c.status}</td>
                  <td className="py-1.5 text-right">
                    {canWrite && personaActionState(act("angel-chapter-carry"), capability).allowed && (
                      <ChapterCarryEditor
                        chapterId={c.id}
                        currentBps={c.carry_bps}
                        pending={carryM.isPending}
                        onSave={(pct) => carryM.mutate({ chapterId: c.id, pct })}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard title="Create a chapter" testId="mfcrm-angel-create">
        <GateNotice action={act("angel-chapter-create")} capability={capability} testId="mfcrm-angel-create-gate" />
        {!canWrite && (
          <div className="rounded-md border border-[var(--cv-color-border)] bg-[var(--cv-color-surface-muted)] p-3 text-sm" data-testid="mfcrm-angel-create-role">
            Your sub-role is read-only for this action. A managing partner, associate or BD user can create chapters.
          </div>
        )}
        {canWrite && personaActionState(act("angel-chapter-create"), capability).allowed && (
          <div className="grid gap-2 sm:grid-cols-4">
            <div><Label htmlFor="mfcrm-ch-name">Name</Label><Input id="mfcrm-ch-name" data-testid="mfcrm-angel-create-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-ch-region">Region</Label><Input id="mfcrm-ch-region" data-testid="mfcrm-angel-create-region" value={region} onChange={(e) => setRegion(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-ch-carry">Carry %</Label><Input id="mfcrm-ch-carry" data-testid="mfcrm-angel-create-carry" inputMode="decimal" value={carryPct} onChange={(e) => setCarryPct(e.target.value)} /></div>
            <div className="flex items-end">
              <Button data-testid="mfcrm-angel-create-submit" disabled={createM.isPending || !name.trim()} onClick={() => createM.mutate()}>
                {createM.isPending ? "Creating…" : "Create chapter"}
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Assign an engagement to a chapter" testId="mfcrm-angel-assign">
        <GateNotice action={act("angel-engagement-chapter")} capability={capability} testId="mfcrm-angel-assign-gate" />
        {canWrite && personaActionState(act("angel-engagement-chapter"), capability).allowed && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div><Label htmlFor="mfcrm-as-eng">Engagement ID</Label><Input id="mfcrm-as-eng" data-testid="mfcrm-angel-assign-engagement" value={engagementId} onChange={(e) => setEngagementId(e.target.value)} /></div>
            <div>
              <Label htmlFor="mfcrm-as-ch">Chapter</Label>
              <select
                id="mfcrm-as-ch"
                data-testid="mfcrm-angel-assign-chapter"
                className="h-10 w-full rounded-md border border-[var(--cv-color-border)] bg-white px-2 text-sm"
                value={assignChapterId}
                onChange={(e) => setAssignChapterId(e.target.value)}
              >
                <option value="">Select…</option>
                {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <Button data-testid="mfcrm-angel-assign-submit" disabled={assignM.isPending || !engagementId.trim() || !assignChapterId} onClick={() => assignM.mutate()}>
                {assignM.isPending ? "Assigning…" : "Assign"}
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Chapter carry report" description="Engagements scoped to each chapter, with that chapter's carry." testId="mfcrm-angel-report">
        {reportQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-angel-report-loading">Loading…</div>}
        {reportQ.isError && <PersonaLoadError err={reportQ.error} testId="mfcrm-angel-report-error" />}
        {!reportQ.isLoading && !reportQ.isError && (reportQ.data?.report ?? []).length === 0 && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-angel-report-empty">No chapters to report on yet.</div>
        )}
        {!reportQ.isError && (reportQ.data?.report ?? []).length > 0 && (
          <table className="w-full text-sm" data-testid="mfcrm-angel-report-table">
            <thead><tr className="text-left text-xs text-[var(--cv-color-text-muted)]"><th className="py-1">Chapter</th><th className="py-1">Carry</th><th className="py-1">Engagements</th><th className="py-1">Active</th></tr></thead>
            <tbody>
              {(reportQ.data?.report ?? []).map((r) => (
                <tr key={r.chapterId} className="border-t border-[var(--cv-color-border)]" data-testid={`mfcrm-angel-report-${r.chapterId}`}>
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5" data-testid={`mfcrm-angel-report-carry-${r.chapterId}`}>{carryBpsToPercentText(r.carryBps)}</td>
                  <td className="py-1.5">{r.engagementCount}</td>
                  <td className="py-1.5">{r.activeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}

function ChapterCarryEditor({ chapterId, currentBps, pending, onSave }: { chapterId: string; currentBps: number; pending: boolean; onSave: (pct: string) => void }) {
  const [open, setOpen] = useState(false);
  /* Seed from basis points, not from the formatted string, so re-saving an
   * unedited field is a no-op instead of a silent rounding drift. */
  const [pct, setPct] = useState(String((Number(currentBps) || 0) / 100));
  if (!open) {
    return <Button variant="outline" size="sm" data-testid={`mfcrm-angel-carry-edit-${chapterId}`} onClick={() => setOpen(true)}>Edit carry</Button>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Input className="h-8 w-20" inputMode="decimal" data-testid={`mfcrm-angel-carry-input-${chapterId}`} value={pct} onChange={(e) => setPct(e.target.value)} />
      <Button size="sm" disabled={pending} data-testid={`mfcrm-angel-carry-save-${chapterId}`} onClick={() => { onSave(pct); setOpen(false); }}>Save</Button>
    </span>
  );
}

/* ====================================================== ACCOUNTING persona */

interface RebillRow { id: string; company_id: string; description: string; amount_minor: number; currency: string; status: string; incurred_at: string | null }
interface CustodyRow { id: string; company_id: string; doc_ref: string; doc_type: string | null; status: string; created_at: string }

function AcctPersona({ persona, capability, canWrite }: { persona: MfcrmPersonaDef; capability: MfcrmCapability | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const act = (id: string) => persona.actions.find((a) => a.id === id)!;

  const [forCompany, setForCompany] = useState("");
  const [rbCompany, setRbCompany] = useState("");
  const [rbDesc, setRbDesc] = useState("");
  const [rbAmount, setRbAmount] = useState("");
  const [rbCurrency, setRbCurrency] = useState("USD");
  const [cuCompany, setCuCompany] = useState("");
  const [cuDocRef, setCuDocRef] = useState("");
  const [cuDocType, setCuDocType] = useState("");

  const rebillsQ = useQuery<{ rebills: RebillRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/acct/rebill"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/acct/rebill")).json(),
  });
  const custodyQ = useQuery<{ custody: CustodyRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/acct/custody"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/acct/custody")).json(),
  });
  const fundAdminAllowed = personaActionState(act("acct-fund-admin-report"), capability).allowed;
  /* WAVE 23 · ITEM 3: `pendingAmountMinor` is now `number | null` — null when
   * the pending rebills span more than one currency. `pendingByCurrency` is
   * the authoritative shape. This component still does not render the scalar
   * (see the note at the bottom of the fund-admin card). */
  const reportQ = useQuery<{ engagements: number; activeEngagements: number; custodyDocs: number; rebills: { total: number; pendingAmountMinor: number | null; pendingByCurrency: Array<{ currency: string; minor: number }> } }>({
    queryKey: ["/api/partner/me/mfcrm/acct/fund-admin-report"],
    /* Only fetched when the profile actually grants fundAdmin. This is a UX
     * choice, not the security boundary — the server asserts the same
     * capability (mfcrmAcctStore.ts:151) and 403s regardless. */
    enabled: fundAdminAllowed,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/acct/fund-admin-report")).json(),
  });

  /**
   * Pending rebill totals, GROUPED BY CURRENCY. Summing 5000 JPY and 5000 USD
   * into "10000" is meaningless, so nothing is added across currency codes.
   * Each subtotal renders through `formatMinor`, which applies that currency's
   * ISO exponent — JPY (0) prints ¥5,000, USD (2) prints $50.00 for the SAME
   * integer, which is exactly the case a hardcoded `/100` gets wrong.
   */
  const pendingByCurrency = useMemo(() => {
    const rows = rebillsQ.data?.rebills ?? [];
    const acc = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== "pending") continue;
      const code = (r.currency || "USD").toUpperCase();
      acc.set(code, (acc.get(code) ?? 0) + (Number(r.amount_minor) || 0));
    }
    /* Array.from, never [...iterator] — TS2802 under this tsconfig (rule 9). */
    return Array.from(acc.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rebillsQ.data]);

  const forM = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partner/me/mfcrm/acct/firm-of-record", { companyId: forCompany.trim() })).json(),
    onSuccess: () => { setForCompany(""); toast({ title: "Firm-of-record recorded" }); },
    onError: (e) => toast({ title: "Could not stamp firm-of-record", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const rebillM = useMutation({
    mutationFn: async () => {
      /* Major → integer minor units for the SELECTED currency's exponent. A
       * hardcoded ×100 would bill a JPY expense a hundred times over. */
      const amountMinor = majorToMinor(rbAmount, rbCurrency);
      return (await apiRequest("POST", "/api/partner/me/mfcrm/acct/rebill", {
        companyId: rbCompany.trim(), description: rbDesc, amountMinor, currency: rbCurrency.toUpperCase(),
      })).json();
    },
    onSuccess: () => { setRbDesc(""); setRbAmount(""); qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/acct/rebill"] }); qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/acct/fund-admin-report"] }); toast({ title: "Rebillable expense recorded" }); },
    onError: (e) => toast({ title: "Could not record expense", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const custodyM = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partner/me/mfcrm/acct/custody", {
      companyId: cuCompany.trim(), docRef: cuDocRef, docType: cuDocType.trim() ? cuDocType.trim() : null,
    })).json(),
    onSuccess: () => { setCuDocRef(""); setCuDocType(""); qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/acct/custody"] }); toast({ title: "Document taken into custody" }); },
    onError: (e) => toast({ title: "Could not add to custody", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const rebills = rebillsQ.data?.rebills ?? [];
  const custody = custodyQ.data?.custody ?? [];

  return (
    <div data-testid="mfcrm-persona-acct">
      <SectionCard title="Firm of record" description="Record your firm as firm-of-record for a company attributed to you." testId="mfcrm-acct-for">
        {canWrite ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2"><Label htmlFor="mfcrm-for-co">Company ID</Label><Input id="mfcrm-for-co" data-testid="mfcrm-acct-for-company" value={forCompany} onChange={(e) => setForCompany(e.target.value)} /></div>
            <div className="flex items-end">
              <Button data-testid="mfcrm-acct-for-submit" disabled={forM.isPending || !forCompany.trim()} onClick={() => forM.mutate()}>{forM.isPending ? "Recording…" : "Stamp firm-of-record"}</Button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-acct-for-role">Your sub-role is read-only for this action.</div>
        )}
      </SectionCard>

      <SectionCard title="Rebillable expenses" description="Expenses your firm paid on a founder's behalf. Totals are shown per currency and are never combined across currencies." testId="mfcrm-acct-rebill">
        <GateNotice action={act("acct-rebill-create")} capability={capability} testId="mfcrm-acct-rebill-gate" />
        {canWrite && personaActionState(act("acct-rebill-create"), capability).allowed && (
          <div className="mb-3 grid gap-2 sm:grid-cols-5">
            <div><Label htmlFor="mfcrm-rb-co">Company ID</Label><Input id="mfcrm-rb-co" data-testid="mfcrm-acct-rebill-company" value={rbCompany} onChange={(e) => setRbCompany(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="mfcrm-rb-desc">Description</Label><Input id="mfcrm-rb-desc" data-testid="mfcrm-acct-rebill-desc" value={rbDesc} onChange={(e) => setRbDesc(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-rb-amt">Amount</Label><Input id="mfcrm-rb-amt" data-testid="mfcrm-acct-rebill-amount" inputMode="decimal" value={rbAmount} onChange={(e) => setRbAmount(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-rb-cur">Currency</Label><Input id="mfcrm-rb-cur" data-testid="mfcrm-acct-rebill-currency" value={rbCurrency} onChange={(e) => setRbCurrency(e.target.value)} /></div>
            <div className="flex items-end sm:col-span-5">
              <Button data-testid="mfcrm-acct-rebill-submit" disabled={rebillM.isPending || !rbCompany.trim() || !rbDesc.trim()} onClick={() => rebillM.mutate()}>{rebillM.isPending ? "Recording…" : "Record expense"}</Button>
            </div>
          </div>
        )}
        {rebillsQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-acct-rebill-loading">Loading…</div>}
        {rebillsQ.isError && <PersonaLoadError err={rebillsQ.error} testId="mfcrm-acct-rebill-error" />}
        {!rebillsQ.isLoading && !rebillsQ.isError && rebills.length === 0 && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-acct-rebill-empty">No rebillable expenses recorded yet.</div>
        )}
        {!rebillsQ.isError && rebills.length > 0 && (
          <>
            <table className="w-full text-sm" data-testid="mfcrm-acct-rebill-table">
              <thead><tr className="text-left text-xs text-[var(--cv-color-text-muted)]"><th className="py-1">Company</th><th className="py-1">Description</th><th className="py-1">Amount</th><th className="py-1">Status</th></tr></thead>
              <tbody>
                {rebills.map((r) => (
                  <tr key={r.id} className="border-t border-[var(--cv-color-border)]" data-testid={`mfcrm-acct-rebill-${r.id}`}>
                    <td className="py-1.5">{r.company_id}</td>
                    <td className="py-1.5">{r.description}</td>
                    <td className="py-1.5" data-testid={`mfcrm-acct-rebill-amount-${r.id}`}>{formatMinor(Number(r.amount_minor) || 0, (r.currency || "USD").toUpperCase())}</td>
                    <td className="py-1.5">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 text-sm" data-testid="mfcrm-acct-rebill-pending-totals">
              <span className="text-xs text-[var(--cv-color-text-muted)]">Pending, by currency: </span>
              {pendingByCurrency.length === 0
                ? <span data-testid="mfcrm-acct-rebill-pending-none">none pending</span>
                : pendingByCurrency.map(([code, minor]) => (
                    <span key={code} className="mr-3 font-medium" data-testid={`mfcrm-acct-rebill-pending-${code}`}>{formatMinor(minor, code)}</span>
                  ))}
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="Document custody" testId="mfcrm-acct-custody">
        <GateNotice action={act("acct-custody-create")} capability={capability} testId="mfcrm-acct-custody-gate" />
        {canWrite && personaActionState(act("acct-custody-create"), capability).allowed && (
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <div><Label htmlFor="mfcrm-cu-co">Company ID</Label><Input id="mfcrm-cu-co" data-testid="mfcrm-acct-custody-company" value={cuCompany} onChange={(e) => setCuCompany(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-cu-ref">Document reference</Label><Input id="mfcrm-cu-ref" data-testid="mfcrm-acct-custody-docref" value={cuDocRef} onChange={(e) => setCuDocRef(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-cu-type">Type</Label><Input id="mfcrm-cu-type" data-testid="mfcrm-acct-custody-doctype" value={cuDocType} onChange={(e) => setCuDocType(e.target.value)} /></div>
            <div className="flex items-end"><Button data-testid="mfcrm-acct-custody-submit" disabled={custodyM.isPending || !cuCompany.trim() || !cuDocRef.trim()} onClick={() => custodyM.mutate()}>{custodyM.isPending ? "Adding…" : "Add to custody"}</Button></div>
          </div>
        )}
        {custodyQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-acct-custody-loading">Loading…</div>}
        {custodyQ.isError && <PersonaLoadError err={custodyQ.error} testId="mfcrm-acct-custody-error" />}
        {!custodyQ.isLoading && !custodyQ.isError && custody.length === 0 && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-acct-custody-empty">No documents in custody yet.</div>
        )}
        {!custodyQ.isError && custody.length > 0 && (
          <table className="w-full text-sm" data-testid="mfcrm-acct-custody-table">
            <thead><tr className="text-left text-xs text-[var(--cv-color-text-muted)]"><th className="py-1">Company</th><th className="py-1">Reference</th><th className="py-1">Type</th><th className="py-1">Status</th></tr></thead>
            <tbody>
              {custody.map((c) => (
                <tr key={c.id} className="border-t border-[var(--cv-color-border)]" data-testid={`mfcrm-acct-custody-${c.id}`}>
                  <td className="py-1.5">{c.company_id}</td><td className="py-1.5">{c.doc_ref}</td><td className="py-1.5">{c.doc_type ?? "—"}</td><td className="py-1.5">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard title="Fund administration" testId="mfcrm-acct-fundadmin">
        <GateNotice action={act("acct-fund-admin-report")} capability={capability} testId="mfcrm-acct-fundadmin-gate" />
        {fundAdminAllowed && reportQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-acct-fundadmin-loading">Loading…</div>}
        {fundAdminAllowed && reportQ.isError && <PersonaLoadError err={reportQ.error} testId="mfcrm-acct-fundadmin-error" />}
        {fundAdminAllowed && reportQ.data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="mfcrm-acct-fundadmin-figures">
            <Figure label="Engagements" value={String(reportQ.data.engagements)} testId="mfcrm-acct-fa-engagements" />
            <Figure label="Active" value={String(reportQ.data.activeEngagements)} testId="mfcrm-acct-fa-active" />
            <Figure label="Documents in custody" value={String(reportQ.data.custodyDocs)} testId="mfcrm-acct-fa-custody" />
            <Figure label="Rebills recorded" value={String(reportQ.data.rebills.total)} testId="mfcrm-acct-fa-rebills" />
          </div>
        )}
        {/* WAVE 23 · ITEM 3: the report's `pendingAmountMinor` used to be a sum
            ACROSS currencies. It is now per-currency-grouped server-side and is
            `null` whenever the pending rebills are mixed, so it can never again
            carry a meaningless number. It is still not rendered here: the
            per-currency pending subtotals above the rebill table remain the
            correct presentation of the same underlying rows. */}
      </SectionCard>
    </div>
  );
}

function Figure({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-lg border border-[var(--cv-color-border)] bg-white p-3" data-testid={testId}>
      <div className="text-xs text-[var(--cv-color-text-muted)]">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

/**
 * A typed major amount → integer minor units, using the currency's real ISO
 * exponent. `formatMinor` is the read-side counterpart; this is the write side
 * and must agree with it or a round-trip drifts.
 *
 * JPY (exponent 0): "5000" → 5000.   USD (exponent 2): "50.00" → 5000.
 * BHD (exponent 3): "5.000" → 5000.
 *
 * A hardcoded ×100 gets two of those three wrong, which is why the exponent is
 * derived rather than assumed.
 */
export function majorToMinor(input: string, currency: string): number {
  const n = Number(String(input).trim());
  if (!Number.isFinite(n)) return 0;
  const exp = currencyExponentFor(currency);
  /* Round at the currency's own precision. Rounding a single typed AMOUNT is
   * not the forbidden per-party share rounding — nothing is being apportioned
   * between parties here. */
  return Math.round(n * Math.pow(10, exp));
}

/* ============================================================ LAW persona */

interface MatterRow { id: string; company_id: string; title: string; matter_type: string | null; status: string }
interface ConflictRow { id: string; company_id: string; matter_id: string | null; conflict_code: string; counterparty: string | null; status: string }

function LawPersona({ persona, capability, canWrite }: { persona: MfcrmPersonaDef; capability: MfcrmCapability | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const act = (id: string) => persona.actions.find((a) => a.id === id)!;

  const [mtCompany, setMtCompany] = useState("");
  const [mtTitle, setMtTitle] = useState("");
  const [mtType, setMtType] = useState("");
  const [corCompany, setCorCompany] = useState("");
  const [cfCompany, setCfCompany] = useState("");
  const [cfCode, setCfCode] = useState("");
  const [cfCounterparty, setCfCounterparty] = useState("");

  const mattersQ = useQuery<{ matters: MatterRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/law/matters"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/law/matters")).json(),
  });
  const conflictsQ = useQuery<{ conflicts: ConflictRow[] }>({
    queryKey: ["/api/partner/me/mfcrm/law/conflicts"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/law/conflicts")).json(),
  });

  const matterM = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partner/me/mfcrm/law/matters", {
      companyId: mtCompany.trim(), title: mtTitle, matterType: mtType.trim() ? mtType.trim() : null,
    })).json(),
    onSuccess: () => { setMtTitle(""); setMtType(""); qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/law/matters"] }); toast({ title: "Matter opened" }); },
    onError: (e) => toast({ title: "Could not open matter", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const corM = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partner/me/mfcrm/law/counsel-of-record", { companyId: corCompany.trim() })).json(),
    onSuccess: () => { setCorCompany(""); toast({ title: "Counsel-of-record recorded" }); },
    onError: (e) => toast({ title: "Could not stamp counsel-of-record", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const flagM = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/partner/me/mfcrm/law/conflicts", {
      companyId: cfCompany.trim(), conflictCode: cfCode, counterparty: cfCounterparty.trim() ? cfCounterparty.trim() : null,
    })).json(),
    onSuccess: () => { setCfCode(""); setCfCounterparty(""); qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/law/conflicts"] }); toast({ title: "Conflict flagged", description: "Flagging records the conflict; it does not block the matter." }); },
    onError: (e) => toast({ title: "Could not flag conflict", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const resolveM = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/partner/me/mfcrm/law/conflicts/${encodeURIComponent(id)}/resolve`)).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/partner/me/mfcrm/law/conflicts"] }); toast({ title: "Conflict resolved" }); },
    onError: (e) => toast({ title: "Could not resolve conflict", description: personaErrorMessage(e), variant: "destructive" }),
  });

  const matters = mattersQ.data?.matters ?? [];
  const conflicts = conflictsQ.data?.conflicts ?? [];

  return (
    <div data-testid="mfcrm-persona-law">
      <SectionCard title="Matters" testId="mfcrm-law-matters">
        {canWrite && (
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <div><Label htmlFor="mfcrm-mt-co">Company ID</Label><Input id="mfcrm-mt-co" data-testid="mfcrm-law-matter-company" value={mtCompany} onChange={(e) => setMtCompany(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-mt-title">Title</Label><Input id="mfcrm-mt-title" data-testid="mfcrm-law-matter-title" value={mtTitle} onChange={(e) => setMtTitle(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-mt-type">Type</Label><Input id="mfcrm-mt-type" data-testid="mfcrm-law-matter-type" value={mtType} onChange={(e) => setMtType(e.target.value)} /></div>
            <div className="flex items-end"><Button data-testid="mfcrm-law-matter-submit" disabled={matterM.isPending || !mtCompany.trim() || !mtTitle.trim()} onClick={() => matterM.mutate()}>{matterM.isPending ? "Opening…" : "Open matter"}</Button></div>
          </div>
        )}
        {mattersQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-law-matters-loading">Loading…</div>}
        {mattersQ.isError && <PersonaLoadError err={mattersQ.error} testId="mfcrm-law-matters-error" />}
        {!mattersQ.isLoading && !mattersQ.isError && matters.length === 0 && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-law-matters-empty">No matters opened yet.</div>
        )}
        {!mattersQ.isError && matters.length > 0 && (
          <table className="w-full text-sm" data-testid="mfcrm-law-matters-table">
            <thead><tr className="text-left text-xs text-[var(--cv-color-text-muted)]"><th className="py-1">Company</th><th className="py-1">Title</th><th className="py-1">Type</th><th className="py-1">Status</th></tr></thead>
            <tbody>
              {matters.map((m) => (
                <tr key={m.id} className="border-t border-[var(--cv-color-border)]" data-testid={`mfcrm-law-matter-${m.id}`}>
                  <td className="py-1.5">{m.company_id}</td><td className="py-1.5">{m.title}</td><td className="py-1.5">{m.matter_type ?? "—"}</td><td className="py-1.5">{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard title="Counsel of record" testId="mfcrm-law-cor">
        <GateNotice action={act("law-counsel-of-record")} capability={capability} testId="mfcrm-law-cor-gate" />
        {canWrite && personaActionState(act("law-counsel-of-record"), capability).allowed && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2"><Label htmlFor="mfcrm-cor-co">Company ID</Label><Input id="mfcrm-cor-co" data-testid="mfcrm-law-cor-company" value={corCompany} onChange={(e) => setCorCompany(e.target.value)} /></div>
            <div className="flex items-end"><Button data-testid="mfcrm-law-cor-submit" disabled={corM.isPending || !corCompany.trim()} onClick={() => corM.mutate()}>{corM.isPending ? "Recording…" : "Stamp counsel-of-record"}</Button></div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Conflict register" description="Conflicts are flagged for a human to resolve. Flagging never blocks a matter." testId="mfcrm-law-conflicts">
        {canWrite && (
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <div><Label htmlFor="mfcrm-cf-co">Company ID</Label><Input id="mfcrm-cf-co" data-testid="mfcrm-law-conflict-company" value={cfCompany} onChange={(e) => setCfCompany(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-cf-code">Conflict code</Label><Input id="mfcrm-cf-code" data-testid="mfcrm-law-conflict-code" value={cfCode} onChange={(e) => setCfCode(e.target.value)} /></div>
            <div><Label htmlFor="mfcrm-cf-cp">Counterparty</Label><Input id="mfcrm-cf-cp" data-testid="mfcrm-law-conflict-counterparty" value={cfCounterparty} onChange={(e) => setCfCounterparty(e.target.value)} /></div>
            <div className="flex items-end"><Button data-testid="mfcrm-law-conflict-submit" disabled={flagM.isPending || !cfCompany.trim() || !cfCode.trim()} onClick={() => flagM.mutate()}>{flagM.isPending ? "Flagging…" : "Flag conflict"}</Button></div>
          </div>
        )}
        {conflictsQ.isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-law-conflicts-loading">Loading…</div>}
        {conflictsQ.isError && <PersonaLoadError err={conflictsQ.error} testId="mfcrm-law-conflicts-error" />}
        {!conflictsQ.isLoading && !conflictsQ.isError && conflicts.length === 0 && (
          <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="mfcrm-law-conflicts-empty">No conflicts recorded.</div>
        )}
        {!conflictsQ.isError && conflicts.length > 0 && (
          <table className="w-full text-sm" data-testid="mfcrm-law-conflicts-table">
            <thead><tr className="text-left text-xs text-[var(--cv-color-text-muted)]"><th className="py-1">Company</th><th className="py-1">Code</th><th className="py-1">Counterparty</th><th className="py-1">Status</th><th className="py-1" /></tr></thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.id} className="border-t border-[var(--cv-color-border)]" data-testid={`mfcrm-law-conflict-${c.id}`}>
                  <td className="py-1.5">{c.company_id}</td><td className="py-1.5">{c.conflict_code}</td><td className="py-1.5">{c.counterparty ?? "—"}</td>
                  <td className="py-1.5" data-testid={`mfcrm-law-conflict-status-${c.id}`}>{c.status}</td>
                  <td className="py-1.5 text-right">
                    {canWrite && c.status === "open" && (
                      <Button size="sm" variant="outline" data-testid={`mfcrm-law-conflict-resolve-${c.id}`} disabled={resolveM.isPending} onClick={() => resolveM.mutate(c.id)}>Resolve</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}

/* ================================================================== page */

const WRITE_SUB_ROLES = ["managing_partner", "associate", "bd"];

export default function PartnerMfcrmPersonas() {
  const role = useRequirePartnerRole();

  const capQ = useQuery<{ capability: MfcrmCapability }>({
    queryKey: ["/api/partner/me/mfcrm/capability"],
    enabled: role.ready,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/mfcrm/capability")).json(),
  });

  const capability = capQ.data?.capability ?? null;
  const persona = resolvePersona(capability);
  const canWrite = !!role.identity && WRITE_SUB_ROLES.indexOf(role.identity.subRole) >= 0;

  if (!role.ready || !role.identity) return null;

  return (
    <PartnerShell
      title="Persona tools"
      tier={role.identity.tier}
      subRole={role.identity.subRole}
      partnerName={role.identity.identity.name}
    >
      {capQ.isLoading && (
        <div className="text-[var(--cv-color-text-muted)]" data-testid="mfcrm-persona-loading">Loading your firm's capability profile…</div>
      )}

      {/* RULE 3 — a failed capability read is RENDERED. It is never allowed to
          fall through to "you have no persona tools", which would tell a law
          firm with a live conflict register that it has none. */}
      {capQ.isError && <PersonaLoadError err={capQ.error} testId="mfcrm-persona-capability-error" />}

      {!capQ.isLoading && !capQ.isError && !persona && (
        <PartnerEmptyState
          title="No persona tools for your firm type"
          description={
            capability && capability.classified
              ? `Persona tools exist for angel networks, accounting firms and law firms. Your firm is classified as “${capability.partnerType ?? "unclassified"}”, which uses the standard Managed Founders workspace instead.`
              : "Your firm's capability profile has not been classified yet. An administrator classifies the partner firm, after which the tools for your firm type appear here."
          }
        />
      )}

      {persona && (
        <>
          <div className="mb-4 rounded-lg border border-[var(--cv-color-border)] bg-[var(--cv-color-surface-muted)] p-3" data-testid="mfcrm-persona-header">
            <div className="text-sm font-semibold" data-testid="mfcrm-persona-label">{persona.label}</div>
            <div className="text-xs text-[var(--cv-color-text-muted)]">{persona.blurb}</div>
            <div className="mt-2 flex flex-wrap gap-1" data-testid="mfcrm-persona-capabilities">
              {CAPABILITY_CHIPS.map((k) => (
                <span
                  key={k}
                  className={`rounded px-2 py-0.5 text-xs border ${capability && (capability as unknown as Record<string, unknown>)[k] ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-[var(--cv-color-border)] bg-white text-[var(--cv-color-text-muted)]"}`}
                  data-testid={`mfcrm-persona-cap-${k}`}
                >
                  {capabilityLabel(k)}: {capability && (capability as unknown as Record<string, unknown>)[k] ? "on" : "off"}
                </span>
              ))}
            </div>
          </div>

          {persona.id === "angel" && <AngelPersona persona={persona} capability={capability} canWrite={canWrite} />}
          {persona.id === "acct" && <AcctPersona persona={persona} capability={capability} canWrite={canWrite} />}
          {persona.id === "law" && <LawPersona persona={persona} capability={capability} canWrite={canWrite} />}
        </>
      )}
    </PartnerShell>
  );
}

/** The capability flags worth showing on the header chip row: the ones that
 *  actually gate a persona route, derived from the shared table so a new gate
 *  appears here automatically. */
const CAPABILITY_CHIPS: string[] = Array.from(
  new Set(
    MFCRM_PERSONAS.flatMap((p) => p.actions.flatMap((a) => a.gates.map((g) => String(g.key)))),
  ),
);
