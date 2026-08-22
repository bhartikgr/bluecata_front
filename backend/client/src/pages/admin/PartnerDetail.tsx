/**
 * v25.0 Track 5 — E7: Admin Partner Detail page.
 *
 * Route: /admin/partners/:id
 *
 * Calls GET /api/admin/partners/:id and
 *        GET /api/admin/partners/:id/workspace/audit
 * Renders: partner summary + team members + notes + tasks + workspace audit.
 */

import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
/* v25.12 NL4 — explicit queryFn for the two queries below. */
import { apiRequest, queryClient } from "@/lib/queryClient";
/* WAVE 3A (P-3) — shared percent input helpers. This editor was VERIFIED to
   ALREADY convert correctly (seed ×100 at :242, save ÷100 at :274), so this is
   a behaviour-preserving refactor onto the one helper — NOT a second
   conversion. The only observable change is that float dust disappears:
   String(0.12 * 100) was "12.000000000000002". */
import { fractionToPercentInput, parsePercentInputToFraction } from "@/lib/percentDisplay";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; /* v25.41 Bug-3 — admin SPV create form */
import { Label } from "@/components/ui/label"; /* v25.41 Bug-3 */
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"; /* v25.41 Bug-3 */
import { useToast } from "@/hooks/use-toast"; /* v25.41 Bug-3 */
/* WAVE 7 AD-1/AD-2 — admin lifecycle controls (tier, status, attributions).
   Extracted into its own component so PartnerDetail stays readable and the
   panel can be mounted from the operations page too if that is ever wanted. */
import { PartnerLifecyclePanel } from "@/components/admin/PartnerLifecyclePanel";
/* WAVE 17 ORP-031 — the admin capability surface Wave 16 recorded as missing
   (client/src/pages/partner/PartnerManagedFounders.tsx:79-85). Mounted as its own
   CARD for the same reason as the lifecycle panel above: additive to the guard
   fingerprint. */
import { MfcrmCapabilityPanel } from "@/components/admin/MfcrmCapabilityPanel";
import { ArrowLeft, Building2, Users, FileText, CheckSquare, FolderOpen, Layers, Plus, Archive, Sliders, Tags } from "lucide-react";
import { Link } from "wouter";
/* WAVE 87 · ITEM 1 — a DATE-ONLY value must not be parsed by `new Date()`:
   `new Date("2026-06-15")` is UTC midnight, which prints ONE DAY EARLY in every
   zone west of UTC (the owner is in New York). `fmtLocaleDate` keeps the exact
   rendered format of the call it replaces and removes only the shift.
   Shape evidence for each field is in build_log/wave87/W87_DATE_CENSUS.md §2. */
import { fmtLocaleDate } from "@/lib/format";
/* WAVE 4B (PT-3/PT-4) — partner classification. Before this wave the summary
   header rendered TWO unlabelled badges: `partner.tier` ("catalyst") and
   `partner.partnerType` ("syndicate"). The second came from
   contacts.metadata_json.partnerType — a single free string written once at
   consortium-application approval, never labelled and never editable. It is
   kept below, READ-ONLY and now labelled "Legacy type", for grandfathered
   rows; the real, mandatory, two-level `Sector // Sub-sector` classification
   is the editor card added under the summary. */
import {
  ClassificationChips,
  ClassificationEditor,
  usePartnerTaxonomy,
} from "@/components/partner/PartnerClassificationSelect";
import {
  validateClassifications,
  type PartnerClassificationDto,
  type PartnerClassificationInput,
} from "@shared/partnerClassification";

/* GROUP C (C4) — consolidated per-partner Arrangement editor response shape
   (GET /api/admin/partners/:id/fee-override). The per-partner PRICE lives in
   feeOverride.subscription_monthly/annual; the non-price arrangement (model,
   report-only quota, fixed rev-share) lives in `arrangement`. */
interface FeeOverrideResp {
  ok: boolean;
  feeOverride: {
    subscription_monthly?: { amountMinor?: number; currency?: string };
    subscription_annual?: { amountMinor?: number; currency?: string };
  } | null;
  commissionOverridePct: number | null;
  arrangement: {
    subscriptionModel?: string | null;
    quota?: { metric?: string; threshold?: number; period?: string; enforcement?: string } | null;
    revShare?: { enabled?: boolean; fixedAmountMinor?: number; currency?: string; appliesTo?: string; source?: string } | null;
    seatLimit?: number | null; /* W-V44 FIX R3 — per-partner seat override */
    notes?: string | null;
  } | null;
  /* W-V44 FIX R3 — resolved seat info (tier default + effective + source). */
  seats?: {
    tier: string;
    tierDefault: number;
    effective: number;
    source: "override" | "tier";
  };
}

// ── Types ─────────────────────────────────────────────────────────────────

interface PartnerContact {
  id: string;
  kind: string;
  legalName?: string;
  displayName?: string;
  email?: string;
  status?: string;
  tier?: string;
  region?: string;
  partnerType?: string;
}

interface PartnerDetailResp {
  partner: PartnerContact;
}

interface WorkspaceAuditResp {
  ok: boolean;
  partnerId: string;
  partnerStatus: string;
  auditedAt: string;
  teamMembers: Array<{
    id: string;
    sub_role?: string;
    user_id?: string;
    status?: string;
    joined_at?: string;
  }>;
  notes: Array<{
    id: string;
    content?: string;
    text?: string;
    createdAt?: string;
    created_at?: string;
  }>;
  tasks: Array<{
    id: string;
    title?: string;
    status?: string;
    dueDate?: string;
    due_date?: string;
  }>;
  files: Array<{
    id: string;
    name?: string;
    sizeBytes?: number;
    uploadedAt?: string;
  }>;
}

/* v25.41 Bug-3 — admin-created SPV row (subset of PartnerSpv surfaced to admin).
 *
 * MAJOR 3 (WAVE 2B) — FIELD-NAME CORRECTION, sibling of the SC-1 detail-page fix.
 * GET /api/admin/partners/:partnerId/spvs reads THROUGH the canonical engine
 *   const spvs = spvEngineStore.listByPartner(partnerId);
 *   res.json({ ok: true, spvs, total: spvs.length });
 *                                  — server/lib/partnerFeeAdminRoutes.ts:333-346
 * so every row is a canonical `SpvDTO` (shared/spvEngine.ts:205-230). Two fields
 * read here did not exist on it:
 *   spvName → DTO field is `name`   (spvEngine.ts:208) — the Name column was blank
 *   vintage → not a DTO field; the admin create route stores it in the `terms`
 *             JSON blob (server/lib/partnerFeeAdminRoutes.ts:388)
 * `spvName` IS still the correct WRITE key on POST /api/admin/partners/:id/spvs
 * (partnerFeeAdminRoutes.ts:360) — the create form below is unchanged. */
interface AdminPartnerSpv {
  id: string;
  name: string;
  jurisdiction: string;
  currency: string;
  status: string;
  /** Legacy-only values (incl. `vintage`) are preserved here as provenance. */
  terms?: Record<string, unknown> | null;
  recordedAt?: string;
}

/** MAJOR 3 — `terms` is `Record<string, unknown>`; render defensively.
 *  Mirrors `termsValue` in client/src/pages/partner/PartnerFundDetail.tsx. */
function spvTermsValue(terms: Record<string, unknown> | null | undefined, key: string): string {
  const v = terms?.[key];
  return typeof v === "string" || typeof v === "number" ? String(v) : "\u2014";
}
interface AdminPartnerSpvsResp {
  ok: boolean;
  spvs: AdminPartnerSpv[];
  total: number;
}

const SPV_STATUSES = ["planned", "open", "closed", "wound_down"] as const;

// ── Page ──────────────────────────────────────────────────────────────────

export default function AdminPartnerDetail() {
  const params = useParams<{ id: string }>();
  const partnerId = params?.id ?? "";
  const { toast } = useToast();

  /* v25.41 Bug-3 — admin SPV creation. DB-driven: the SPV list below is
     fetched live from GET /api/admin/partners/:id/spvs and the create form
     POSTs to the new admin endpoint, which delegates to the existing
     partnerSpvStore.create. Nothing is hardcoded; nothing is held in browser
     memory beyond the transient form draft. */
  const [spvForm, setSpvForm] = useState({
    spvName: "",
    jurisdiction: "",
    vintage: String(new Date().getFullYear()),
    currency: "USD",
    status: "planned" as (typeof SPV_STATUSES)[number],
  });

  const spvsQ = useQuery<AdminPartnerSpvsResp>({
    queryKey: [`/api/admin/partners/${partnerId}/spvs`],
    enabled: !!partnerId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners/${partnerId}/spvs`)).json(),
  });

  const createSpvMut = useMutation({
    mutationFn: async () => {
      const vintage = parseInt(spvForm.vintage, 10);
      if (!spvForm.spvName.trim()) throw new Error("SPV name is required");
      if (!spvForm.jurisdiction.trim()) throw new Error("Jurisdiction is required");
      if (!Number.isInteger(vintage)) throw new Error("Vintage must be a year");
      const currency = (spvForm.currency || "USD").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a 3-letter ISO code");
      const r = await apiRequest("POST", `/api/admin/partners/${partnerId}/spvs`, {
        spvName: spvForm.spvName.trim(),
        jurisdiction: spvForm.jurisdiction.trim(),
        vintage,
        currency,
        status: spvForm.status,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "create_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/partners/${partnerId}/spvs`] });
      setSpvForm((f) => ({ ...f, spvName: "", jurisdiction: "" }));
      toast({ title: "SPV created" });
    },
    onError: (e: any) => toast({ title: "Create SPV failed", description: e?.message, variant: "destructive" }),
  });

  /* ── WAVE 4B (PT-3/PT-4) — classification state ─────────────────────────
     REPORTING AND FILTERING ONLY. Nothing on this page changes what the
     partner or the admin can reach based on the value chosen here. */
  const taxonomyQ = usePartnerTaxonomy();
  const classificationsQ = useQuery<{ ok: boolean; classifications: PartnerClassificationDto[] }>({
    queryKey: [`/api/admin/partners/${partnerId}/classifications`],
    enabled: !!partnerId,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/partners/${partnerId}/classifications`)).json(),
    retry: false,
  });
  const savedClassifications = classificationsQ.data?.classifications ?? [];
  const [editingClassification, setEditingClassification] = useState(false);
  const [classificationDraft, setClassificationDraft] = useState<PartnerClassificationInput[]>([]);

  function beginClassificationEdit() {
    setClassificationDraft(
      savedClassifications.map((c) => ({
        sectorSlug: c.sectorSlug,
        subsectorSlug: c.subsectorSlug,
        otherText: c.otherText,
        isPrimary: c.isPrimary,
      })),
    );
    setEditingClassification(true);
  }

  const classificationErrors = validateClassifications(
    classificationDraft,
    taxonomyQ.data ?? { sectors: [], subsectors: [] },
    { mandatory: true },
  );

  const saveClassificationMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("PUT", `/api/admin/partners/${partnerId}/classifications`, {
        classifications: classificationDraft,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "save_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [`/api/admin/partners/${partnerId}/classifications`],
      });
      setEditingClassification(false);
      toast({ title: "Classification saved" });
    },
    onError: (e: any) =>
      toast({ title: "Save classification failed", description: e?.message, variant: "destructive" }),
  });

  const partnerQ = useQuery<PartnerDetailResp>({
    /* v25.12 NL4 — explicit queryFn. */
    queryKey: [`/api/admin/partners/${partnerId}`],
    enabled: !!partnerId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners/${partnerId}`)).json(),
  });

  /* GROUP C (C4) — Arrangement editor state. Prices are entered/stored in MINOR
     units (cents) so an explicit 0 is a real "$0 override" (blank = no override,
     falls back to the advertised tier). Commission is entered as a percent and
     stored as a fraction. */
  const [arr, setArr] = useState({
    priceOverrideEnabled: false,
    subscriptionMonthlyMinor: "",
    commissionPct: "",
    subscriptionModel: "",
    quotaThreshold: "",
    quotaEnforcement: "report" as "report" | "warn",
    revShareEnabled: false,
    revShareFixedMinor: "",
    revShareCurrency: "USD",
    seatOverrideEnabled: false, /* W-V44 FIX R3 */
    seatLimit: "", /* W-V44 FIX R3 — blank = use tier default */
    notes: "",
  });
  const [arrSeeded, setArrSeeded] = useState(false);

  const feeOverrideQ = useQuery<FeeOverrideResp>({
    queryKey: [`/api/admin/partners/${partnerId}/fee-override`],
    enabled: !!partnerId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners/${partnerId}/fee-override`)).json(),
  });

  // Seed the form once from the server, then let the admin edit freely.
  useEffect(() => {
    if (arrSeeded || !feeOverrideQ.data?.ok) return;
    const d = feeOverrideQ.data;
    const monthly = d.feeOverride?.subscription_monthly;
    const q = d.arrangement?.quota;
    const rev = d.arrangement?.revShare;
    setArr({
      priceOverrideEnabled: typeof monthly?.amountMinor === "number",
      subscriptionMonthlyMinor: typeof monthly?.amountMinor === "number" ? String(monthly.amountMinor) : "",
      commissionPct: fractionToPercentInput(d.commissionOverridePct),
      subscriptionModel: d.arrangement?.subscriptionModel ?? "",
      quotaThreshold: typeof q?.threshold === "number" ? String(q.threshold) : "",
      quotaEnforcement: q?.enforcement === "warn" ? "warn" : "report",
      revShareEnabled: rev?.enabled === true,
      revShareFixedMinor: typeof rev?.fixedAmountMinor === "number" ? String(rev.fixedAmountMinor) : "",
      revShareCurrency: rev?.currency ?? "USD",
      // W-V44 FIX R3 — seed the seat override from the arrangement (override wins).
      seatOverrideEnabled: d.seats?.source === "override",
      seatLimit: d.seats?.source === "override" ? String(d.seats.effective) : "",
      notes: d.arrangement?.notes ?? "",
    });
    setArrSeeded(true);
  }, [feeOverrideQ.data, arrSeeded]);

  const saveArrangementMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      // Per-partner PRICE override (minor units; explicit 0 honored). Blank +
      // toggle-off clears any existing override (send null).
      if (arr.priceOverrideEnabled) {
        const minor = parseInt(arr.subscriptionMonthlyMinor, 10);
        if (!Number.isInteger(minor) || minor < 0) throw new Error("Monthly price override must be a non-negative integer (minor units)");
        body.feeOverrideJson = { subscription_monthly: { amountMinor: minor, currency: arr.revShareCurrency || "USD" } };
      } else {
        body.feeOverrideJson = null;
      }
      // Commission override (percent → fraction). Blank clears it.
      if (arr.commissionPct.trim() === "") {
        body.commissionOverridePct = null;
      } else {
        const parsed = parsePercentInputToFraction(arr.commissionPct, { label: "Commission" });
        if (!parsed.ok) throw new Error("Commission must be a percent between 0 and 100");
        body.commissionOverridePct = parsed.fraction;
      }
      // Non-price arrangement (subscription model, report-only quota, fixed rev-share).
      const threshold = arr.quotaThreshold.trim() === "" ? undefined : parseInt(arr.quotaThreshold, 10);
      if (threshold !== undefined && (!Number.isInteger(threshold) || threshold < 0)) throw new Error("Quota threshold must be a non-negative integer");
      let revFixed: number | undefined;
      if (arr.revShareEnabled) {
        revFixed = parseInt(arr.revShareFixedMinor, 10);
        if (!Number.isInteger(revFixed) || revFixed < 0) throw new Error("Rev-share amount must be a non-negative integer (minor units)");
      }
      body.arrangementJson = {
        subscriptionModel: arr.subscriptionModel.trim() || null,
        quota: {
          metric: "registered_companies",
          threshold: threshold ?? 0,
          period: "monthly",
          enforcement: arr.quotaEnforcement,
        },
        revShare: {
          enabled: arr.revShareEnabled,
          fixedAmountMinor: revFixed ?? 0,
          currency: arr.revShareCurrency || "USD",
          appliesTo: "portfolio_company_paid",
          source: "capavate",
        },
        // W-V44 FIX R3 — per-partner seat override. Enabled+value = override;
        // disabled = null (fall back to the tier default seat limit).
        seatLimit: (() => {
          if (!arr.seatOverrideEnabled) return null;
          const n = parseInt(arr.seatLimit, 10);
          if (!Number.isInteger(n) || n < 0) throw new Error("Seat limit override must be a non-negative integer");
          return n;
        })(),
        notes: arr.notes.trim() || null,
      };
      const r = await apiRequest("PUT", `/api/admin/partners/${partnerId}/fee-override`, body);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "save_failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/admin/partners/${partnerId}/fee-override`] });
      toast({ title: "Arrangement saved" });
    },
    onError: (e: any) => toast({ title: "Save arrangement failed", description: e?.message, variant: "destructive" }),
  });

  const auditQ = useQuery<WorkspaceAuditResp>({
    /* v25.12 NL4 — explicit queryFn. */
    queryKey: [`/api/admin/partners/${partnerId}/workspace/audit`],
    enabled: !!partnerId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners/${partnerId}/workspace/audit`)).json(),
  });

  const partner = partnerQ.data?.partner;
  const audit = auditQ.data;

  const name = partner?.displayName || partner?.legalName || partnerId;

  const statusColor = (s?: string) => {
    if (!s) return "secondary";
    /* WAVE 99 · ITEM 2.2 — `"default"` is the LOGO RED in admin, the ratified
     * NEGATIVE anchor.  `active` is a healthy state.  Colour only. */
    if (s === "active") return "positive" as const;
    if (s === "archived") return "secondary" as const;
    if (s === "suspended") return "destructive" as const;
    return "secondary" as const;
  };

  return (
    <>
      {/* v25.14 NM11 — /admin/partners is not a registered route in App.tsx.
         Send the back button to the consortium applications page (the admin's
         actual entry point for managing partners) instead of the AdminNotFound
         404 catch-all. */}
      <PageHeader
        title={partnerQ.isPending ? "Loading partner…" : name}
        description={partner?.email ?? ""}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/consortium-applications">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Partners
            </Link>
          </Button>
        }
      />
      <PageBody>
        {partnerQ.isError && (
          <div className="rounded-md bg-destructive/10 text-destructive p-4 text-sm">
            Partner not found or access denied.
          </div>
        )}

        {/* ── Partner Summary ─────────────────────────────────────── */}
        {partner && (
          <Card className="p-5 mb-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                <Building2 className="h-6 w-6 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold truncate">{name}</h2>
                  <Badge variant={statusColor(partner.status)}>{partner.status ?? "unknown"}</Badge>
                  {/* WAVE 4B — both badges were previously unlabelled, so
                      "catalyst" and "syndicate" sat side by side with no way
                      to tell what either meant. Labelled in place. */}
                  {partner.tier && (
                    <Badge variant="outline" data-testid="badge-partner-tier">Tier: {partner.tier}</Badge>
                  )}
                  {partner.partnerType && (
                    <Badge
                      variant="outline"
                      className="text-muted-foreground"
                      title="Legacy free-text type from contacts.metadata_json, set once at application approval. Read-only and retained for grandfathered rows — use Classification below."
                      data-testid="badge-partner-legacy-type"
                    >
                      Legacy type: {partner.partnerType}
                    </Badge>
                  )}
                </div>
                <div className="mt-2">
                  <ClassificationChips classifications={savedClassifications} />
                </div>
                <div className="mt-1 text-sm text-muted-foreground space-y-0.5">
                  {partner.email && <p>Email: {partner.email}</p>}
                  {partner.region && <p>Region: {partner.region}</p>}
                  <p className="font-mono text-xs text-muted-foreground/60">ID: {partner.id}</p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* ── WAVE 7 (AD-1/AD-2) — Lifecycle & attributions ─────────
            Rendered as its own CARD, deliberately: the same ruling that kept
            WAVE 4B's classification out of the roster as a 7th column applies
            here. A card is additive to the guard fingerprint; a column changes
            an existing table's header/cell shape and trips drop-detection.
            AdminFeesConsolidated.tsx:1000 already tells the admin that tier
            promotion happens "from the partner detail page" — as of this wave
            that sentence is true. */}
        {partner && (
          <PartnerLifecyclePanel
            partnerId={partnerId}
            status={partner.status ?? null}
            tier={partner.tier ?? null}
          />
        )}

        {/* ── WAVE 17 (ORP-031) — Managed-founder capability ────────── */}
        {partner && <MfcrmCapabilityPanel partnerId={partnerId} />}

        {/* ── WAVE 4B (PT-3/PT-4) — Classification ─────────────────── */}
        {partner && (
          <Card className="p-5 mb-6" data-testid="admin-partner-classification">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <Tags className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Classification</h3>
              </div>
              {!editingClassification && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={beginClassificationEdit}
                  data-testid="button-edit-classification"
                >
                  {savedClassifications.length === 0 ? "Set classification" : "Edit"}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Two levels, rendered as <span className="font-mono">Sector // Sub-sector</span>. A
              hybrid partner may hold several; the starred one is the primary and is what
              single-value contexts (roster column, exports) show. Used for reporting and
              filtering only — it grants and removes nothing.
            </p>

            {editingClassification ? (
              <div className="space-y-3">
                <ClassificationEditor
                  value={classificationDraft}
                  onChange={setClassificationDraft}
                  mandatory
                  showErrors
                  disabled={saveClassificationMut.isPending}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => saveClassificationMut.mutate()}
                    disabled={classificationErrors.length > 0 || saveClassificationMut.isPending}
                    data-testid="button-save-classification"
                  >
                    {saveClassificationMut.isPending ? "Saving…" : "Save classification"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingClassification(false)}
                    disabled={saveClassificationMut.isPending}
                    data-testid="button-cancel-classification"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : classificationsQ.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading classification…</p>
            ) : savedClassifications.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="text-classification-unset">
                Unclassified. This partner predates the classification field and is
                grandfathered — nothing is broken, but setting it makes the partner appear in
                sector reports and filters.
              </p>
            ) : (
              <ClassificationChips classifications={savedClassifications} />
            )}
          </Card>
        )}

        {/* ── GROUP C (C4) — consolidated Arrangement editor ───────── */}
        {partner && (
          <Card className="p-5 mb-6" data-testid="admin-partner-arrangement">
            <div className="flex items-center gap-2 mb-1">
              <Sliders className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Arrangement (plan / deal engine)</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              This is where you grant THIS partner an INDIVIDUAL price (e.g. a discount). The
              general BASE price comes from the partner's tier on “Partner Subscription Tiers”
              (that same tier price is what the public /consortium/pricing page advertises and
              charges). A custom monthly price set here supersedes the tier for this partner's
              OWN checkout only — the public pricing page stays tier-based. Leave “Custom monthly
              price” unchecked to use the tier base price. Quota is report-only. Rev-share is a
              fixed amount credited when a portfolio company pays Capavate.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {/* Price override */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    id="arr-price-enabled"
                    type="checkbox"
                    data-testid="checkbox-price-override"
                    checked={arr.priceOverrideEnabled}
                    onChange={(e) => setArr((a) => ({ ...a, priceOverrideEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="arr-price-enabled" className="text-xs">Custom monthly price</Label>
                </div>
                <Input
                  data-testid="input-price-minor"
                  inputMode="numeric"
                  disabled={!arr.priceOverrideEnabled}
                  value={arr.subscriptionMonthlyMinor}
                  onChange={(e) => setArr((a) => ({ ...a, subscriptionMonthlyMinor: e.target.value }))}
                  placeholder="minor units, e.g. 0 or 49900"
                />
              </div>
              {/* Commission */}
              <div className="space-y-1">
                <Label htmlFor="arr-commission" className="text-xs">Commission override (%)</Label>
                <Input
                  id="arr-commission"
                  data-testid="input-commission-pct"
                  inputMode="decimal"
                  value={arr.commissionPct}
                  onChange={(e) => setArr((a) => ({ ...a, commissionPct: e.target.value }))}
                  placeholder="e.g. 3 (blank = tier default)"
                />
              </div>
              {/* Subscription model */}
              <div className="space-y-1">
                <Label htmlFor="arr-model" className="text-xs">Subscription model</Label>
                <Input
                  id="arr-model"
                  data-testid="input-subscription-model"
                  value={arr.subscriptionModel}
                  onChange={(e) => setArr((a) => ({ ...a, subscriptionModel: e.target.value }))}
                  placeholder="e.g. seat_based"
                />
              </div>
              {/* Quota threshold */}
              <div className="space-y-1">
                <Label htmlFor="arr-quota" className="text-xs">Quota threshold / month</Label>
                <Input
                  id="arr-quota"
                  data-testid="input-quota-threshold"
                  inputMode="numeric"
                  value={arr.quotaThreshold}
                  onChange={(e) => setArr((a) => ({ ...a, quotaThreshold: e.target.value }))}
                  placeholder="registered companies"
                />
              </div>
              {/* Quota enforcement */}
              <div className="space-y-1">
                <Label className="text-xs">Quota enforcement</Label>
                <Select
                  value={arr.quotaEnforcement}
                  onValueChange={(v) => setArr((a) => ({ ...a, quotaEnforcement: v as "report" | "warn" }))}
                >
                  <SelectTrigger data-testid="select-quota-enforcement"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="report">report (silent)</SelectItem>
                    <SelectItem value="warn">warn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Rev-share currency */}
              <div className="space-y-1">
                <Label htmlFor="arr-rev-ccy" className="text-xs">Rev-share currency</Label>
                <Input
                  id="arr-rev-ccy"
                  data-testid="input-revshare-currency"
                  value={arr.revShareCurrency}
                  maxLength={3}
                  onChange={(e) => setArr((a) => ({ ...a, revShareCurrency: e.target.value.toUpperCase() }))}
                  placeholder="USD"
                />
              </div>
              {/* Rev-share enable + amount */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    id="arr-rev-enabled"
                    type="checkbox"
                    data-testid="checkbox-revshare-enabled"
                    checked={arr.revShareEnabled}
                    onChange={(e) => setArr((a) => ({ ...a, revShareEnabled: e.target.checked }))}
                  />
                  <Label htmlFor="arr-rev-enabled" className="text-xs">Rev-share enabled (fixed)</Label>
                </div>
                <Input
                  data-testid="input-revshare-minor"
                  inputMode="numeric"
                  disabled={!arr.revShareEnabled}
                  value={arr.revShareFixedMinor}
                  onChange={(e) => setArr((a) => ({ ...a, revShareFixedMinor: e.target.value }))}
                  placeholder="minor units, e.g. 25000"
                />
              </div>
              {/* W-V44 FIX R3 — Seat limit (tier default + optional per-partner override). */}
              <div className="space-y-1 lg:col-span-2 rounded-md border border-border/60 p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Team seat limit</Label>
                  <span className="text-xs text-muted-foreground" data-testid="text-seat-effective">
                    Effective: <strong>{feeOverrideQ.data?.seats?.effective ?? "—"}</strong>
                    {feeOverrideQ.data?.seats ? (
                      feeOverrideQ.data.seats.source === "override"
                        ? " (custom override)"
                        : ` (from ${feeOverrideQ.data.seats.tier} tier default: ${feeOverrideQ.data.seats.tierDefault})`
                    ) : ""}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Seats are the number of team-member logins this partner may have. The BASE limit
                  comes from their tier ({feeOverrideQ.data?.seats?.tier ?? "—"} → {feeOverrideQ.data?.seats?.tierDefault ?? "—"}).
                  Tick below to grant THIS partner an individual seat allowance (e.g. extra seats) without
                  changing their tier or price. Untick to revert to the tier default.
                </p>
                <label className="flex items-center gap-2 text-xs mt-1">
                  <input
                    type="checkbox"
                    checked={arr.seatOverrideEnabled}
                    onChange={(e) => setArr((a) => ({ ...a, seatOverrideEnabled: e.target.checked }))}
                    data-testid="checkbox-seat-override"
                  />
                  Custom seat limit
                </label>
                <Input
                  type="number"
                  min={0}
                  disabled={!arr.seatOverrideEnabled}
                  value={arr.seatLimit}
                  onChange={(e) => setArr((a) => ({ ...a, seatLimit: e.target.value }))}
                  placeholder={`tier default (${feeOverrideQ.data?.seats?.tierDefault ?? "—"})`}
                  data-testid="input-seat-limit"
                  className="w-40"
                />
              </div>
              {/* Notes */}
              <div className="space-y-1 lg:col-span-2">
                <Label htmlFor="arr-notes" className="text-xs">Notes</Label>
                <Input
                  id="arr-notes"
                  data-testid="input-arrangement-notes"
                  value={arr.notes}
                  onChange={(e) => setArr((a) => ({ ...a, notes: e.target.value }))}
                  placeholder="internal notes"
                />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button
                size="sm"
                data-testid="button-save-arrangement"
                onClick={() => saveArrangementMut.mutate()}
                disabled={saveArrangementMut.isPending || feeOverrideQ.isPending}
              >
                {saveArrangementMut.isPending ? "Saving..." : "Save Arrangement"}
              </Button>
            </div>
          </Card>
        )}

        {/* ── Workspace Audit Sections ─────────────────────────────── */}
        {/* v25.41 Bug-3 - SPV creation + list (admin parity for partner self-service) */}
        {partner && (
          <Card className="p-5 mb-6" data-testid="admin-partner-spvs">
            <div className="flex items-center gap-2 mb-4">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">
                SPVs ({spvsQ.data?.total ?? 0})
              </h3>
            </div>

            {/* Create form */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-4">
              <div className="space-y-1">
                <Label htmlFor="spv-name" className="text-xs">SPV Name</Label>
                <Input
                  id="spv-name"
                  data-testid="input-spv-name"
                  value={spvForm.spvName}
                  onChange={(e) => setSpvForm((f) => ({ ...f, spvName: e.target.value }))}
                  placeholder="Acme SPV I"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spv-jurisdiction" className="text-xs">Jurisdiction</Label>
                <Input
                  id="spv-jurisdiction"
                  data-testid="input-spv-jurisdiction"
                  value={spvForm.jurisdiction}
                  onChange={(e) => setSpvForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                  placeholder="Delaware"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spv-vintage" className="text-xs">Vintage</Label>
                <Input
                  id="spv-vintage"
                  data-testid="input-spv-vintage"
                  inputMode="numeric"
                  value={spvForm.vintage}
                  onChange={(e) => setSpvForm((f) => ({ ...f, vintage: e.target.value }))}
                  placeholder="2026"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="spv-currency" className="text-xs">Currency</Label>
                <Input
                  id="spv-currency"
                  data-testid="input-spv-currency"
                  value={spvForm.currency}
                  onChange={(e) => setSpvForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <Select
                  value={spvForm.status}
                  onValueChange={(v) => setSpvForm((f) => ({ ...f, status: v as (typeof SPV_STATUSES)[number] }))}
                >
                  <SelectTrigger data-testid="select-spv-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPV_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end mb-4">
              <Button
                size="sm"
                data-testid="button-create-spv"
                onClick={() => createSpvMut.mutate()}
                disabled={createSpvMut.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                {createSpvMut.isPending ? "Creating..." : "Create SPV"}
              </Button>
            </div>

            {/* List */}
            {spvsQ.isError && (
              <div className="rounded-md bg-destructive/10 text-destructive p-3 text-sm" data-testid="spv-list-error">
                Could not load SPVs.
              </div>
            )}
            {spvsQ.data && spvsQ.data.spvs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No SPVs yet.</p>
            ) : spvsQ.data ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="spv-table">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left pb-2 pr-4 font-medium">Name</th>
                      <th className="text-left pb-2 pr-4 font-medium">Jurisdiction</th>
                      <th className="text-left pb-2 pr-4 font-medium">Vintage</th>
                      <th className="text-left pb-2 pr-4 font-medium">Currency</th>
                      <th className="text-left pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spvsQ.data.spvs.map((s) => (
                      <tr key={s.id} className="border-b last:border-0" data-testid={`spv-row-${s.id}`}>
                        <td className="py-2 pr-4">{s.name}</td>
                        <td className="py-2 pr-4">{s.jurisdiction}</td>
                        <td className="py-2 pr-4">{spvTermsValue(s.terms, "vintage")}</td>
                        <td className="py-2 pr-4">{s.currency}</td>
                        <td className="py-2">
                          <Badge variant="outline" className="text-xs">{s.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>
        )}

        {auditQ.isPending && (
          <p className="text-sm text-muted-foreground">Loading workspace data…</p>
        )}

        {/* v25.16 NH4 — explicit error branch; previously a failure silently
           rendered an empty page below the partner summary. */}
        {auditQ.isError && (
          <div
            className="rounded-md bg-destructive/10 text-destructive p-4 text-sm"
            data-testid="partner-audit-error"
          >
            Could not load workspace audit data.{" "}
            {(auditQ.error as Error | undefined)?.message ?? ""}
          </div>
        )}

        {audit && (
          <div className="grid gap-6">
            {/* Team Members */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Team Members ({audit.teamMembers.length})</h3>
              </div>
              {audit.teamMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No team members.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-2 pr-4 font-medium">User ID</th>
                        <th className="text-left pb-2 pr-4 font-medium">Role</th>
                        <th className="text-left pb-2 pr-4 font-medium">Status</th>
                        <th className="text-left pb-2 font-medium">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.teamMembers.map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{m.user_id ?? m.id}</td>
                          <td className="py-2 pr-4">{m.sub_role ?? "—"}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={m.status === "active" ? "positive" : "secondary"} className="text-xs">
                              {m.status ?? "unknown"}
                            </Badge>
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Notes */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Notes ({audit.notes.length})</h3>
              </div>
              {audit.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes.</p>
              ) : (
                <div className="space-y-3">
                  {audit.notes.map((n) => (
                    <div key={n.id} className="rounded-md bg-muted/40 p-3 text-sm">
                      <p>{n.content ?? n.text ?? "(empty)"}</p>
                      {(n.createdAt || n.created_at) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(n.createdAt ?? n.created_at ?? "").toLocaleString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* v25.51 Item 9 (Ozan directive) — the partner-facing Tasks + Files
                pages were retired in v25.50.0, but admin keeps these panels for
                historical oversight. Group them under a clearly-labeled
                Legacy / Archived section (read-only historical records) so it's
                obvious they are NOT active CP features. No data/store change. */}
            <div
              className="rounded-lg border border-amber-300/70 bg-amber-50/50 p-4 space-y-4"
              data-testid="admin-legacy-archived-section"
            >
              <div className="flex items-start gap-2">
                <Archive className="h-4 w-4 text-amber-700 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm text-amber-900">Legacy / Archived (partner-facing surface removed)</h3>
                    <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800">Archived</Badge>
                  </div>
                  <p className="text-xs text-amber-800/80 mt-0.5">
                    Read-only historical records. The partner-facing Tasks and Files pages
                    were retired in v25.50.0 — these panels remain for admin oversight only.
                  </p>
                </div>
              </div>

            {/* Tasks */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Tasks ({audit.tasks.length})</h3>
                <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800 ml-auto">Legacy</Badge>
              </div>
              {audit.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-2 pr-4 font-medium">Title</th>
                        <th className="text-left pb-2 pr-4 font-medium">Status</th>
                        <th className="text-left pb-2 font-medium">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.tasks.map((t) => (
                        <tr key={t.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{t.title ?? "—"}</td>
                          <td className="py-2 pr-4">
                            <Badge variant="outline" className="text-xs">{t.status ?? "—"}</Badge>
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {(t.dueDate || t.due_date) ? fmtLocaleDate(t.dueDate ?? t.due_date) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* Files */}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-sm">Files ({audit.files.length})</h3>
                <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-800 ml-auto">Legacy</Badge>
              </div>
              {audit.files.length === 0 ? (
                <p className="text-sm text-muted-foreground">No files.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left pb-2 pr-4 font-medium">Name</th>
                        <th className="text-left pb-2 pr-4 font-medium">Size</th>
                        <th className="text-left pb-2 font-medium">Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.files.map((f) => (
                        <tr key={f.id} className="border-b last:border-0">
                          <td className="py-2 pr-4">{f.name ?? f.id}</td>
                          <td className="py-2 pr-4 text-muted-foreground text-xs">
                            {f.sizeBytes != null ? `${(f.sizeBytes / 1024).toFixed(1)} KB` : "—"}
                          </td>
                          <td className="py-2 text-muted-foreground text-xs">
                            {f.uploadedAt ? new Date(f.uploadedAt).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            </div>
            {/* /v25.51 Item 9 Legacy / Archived section */}

            {/* Audit Meta */}
            <p className="text-xs text-muted-foreground text-right">
              Workspace audited at {new Date(audit.auditedAt).toLocaleString()}
            </p>
          </div>
        )}
      </PageBody>
    </>
  );
}
