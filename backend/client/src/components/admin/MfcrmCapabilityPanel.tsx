/**
 * WAVE 17 — ORP-031, second half: the ADMIN capability surface.
 *
 * WHAT WAS WRONG
 * --------------
 * Wave 16 wired the PARTNER side of managed-founder CRM (create engagement, mode
 * change, hand-over initiate/confirm) and stated honestly in
 * `client/src/pages/partner/PartnerManagedFounders.tsx:79-85` that the
 * prerequisite it renders — the partner firm's capability profile — "can only be
 * set by an administrator" and that "there is no admin client surface for either
 * route". That left the partner surface refusing every creation with
 * `CAPABILITY_UNCLASSIFIED` and nobody able to clear it from the UI. This panel
 * is that missing surface.
 *
 * ROUTES CALLED — every line re-read in the tree before this file was written,
 * in `server/managedFounderRoutes.ts`:
 *   GET   /api/admin/mfcrm/capability/:partnerId                        (:425)
 *   POST  /api/admin/mfcrm/capability/:partnerId/seed                   (:439)
 *   PATCH /api/admin/mfcrm/capability/:partnerId                        (:462)
 *   GET   /api/admin/mfcrm/engagements/:partnerId                       (:483, NEW this wave)
 *   POST  /api/admin/mfcrm/engagements/:partnerId/:engagementId/trial-override (:491)
 *   POST  /api/admin/mfcrm/engagements/:partnerId/expire-stale-trials   (:517)
 *   GET   /api/admin/mfcrm/handovers/:partnerId                         (:494, NEW this wave)
 *   POST  /api/admin/mfcrm/handovers/:partnerId/:handoverId/override    (:507)
 * Before this wave the client contained ZERO matches for `admin/mfcrm` — all
 * eight are reachable from here now.
 *
 * SINKS, NAMED PER ACTION (server/managedFounderStore.ts):
 *   seed   → seedCapabilityProfile  → persistProfile → mf_partner_capability row
 *   patch  → setCapabilityProfile   → persistProfile → same row
 *   trial-override      → overrideTrial      → mf_pricing_trial.trial_expires_at
 *   expire-stale-trials → expireStaleTrials  → mf_pricing_trial.status + engagement
 *   handover override   → handoverConfirm(adminOverride) → mf_handover.status +
 *                         mf_engagement.mode
 * SECOND PATH check: the capability row has exactly one other writer — the same
 * `persistProfile` reached through `seedCapabilityProfile` from the partner-side
 * gate path — so this panel does not create a competing write path. `partnerType`
 * on the CONTACT (`contacts.metadata_json.partnerType`) is a different, read-only
 * legacy column that Wave 4B already documented; it is shown, not written.
 *
 * NOT CLAIMED: the seed choices come from the server (`seedableTypes` in the GET
 * response, sourced from `SEEDABLE_PARTNER_TYPES`, store `:222`) rather than a
 * second hardcoded copy here, because `seedCapabilityProfile` REJECTS anything
 * outside that set and a drifting client list would render options that always
 * fail.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck } from "lucide-react";

/** Mirrors `CapabilityProfile` (server/managedFounderStore.ts:41-56) exactly. */
interface Capability {
  partnerId: string;
  partnerType: string | null;
  classified: boolean;
  sourcesCapital: boolean;
  delegatedAgency: boolean;
  spvWriteAuthority: boolean;
  advisoryCoseat: boolean;
  documentCustody: boolean;
  paysOnBehalf: boolean;
  attributionTracking: boolean;
  collectiveFronting: boolean;
  chapterScoping: boolean;
  fundAdmin: boolean;
  updatedAt: string | null;
}

/** The ten boolean capability keys, in the store's own declaration order
 *  (`CapabilityKey`, server/managedFounderStore.ts:74-77). Each label states what
 *  the flag GATES, because that is the only reason an admin toggles it. */
const CAPABILITY_FIELDS: ReadonlyArray<{ key: keyof Capability; label: string; gate: string }> = [
  { key: "sourcesCapital", label: "Sources capital", gate: "Firm raises or introduces capital." },
  { key: "delegatedAgency", label: "Delegated agency", gate: "Required for Mode A engagements (GATE 6)." },
  { key: "spvWriteAuthority", label: "SPV write authority", gate: "May act on SPV records for managed companies." },
  { key: "advisoryCoseat", label: "Advisory co-seat", gate: "Mode B advisory posture." },
  { key: "documentCustody", label: "Document custody", gate: "Holds documents on the founder's behalf." },
  { key: "paysOnBehalf", label: "Pays on behalf", gate: "May settle amounts for the managed company." },
  { key: "attributionTracking", label: "Attribution tracking", gate: "Attribution stamps are recorded for this firm." },
  { key: "collectiveFronting", label: "Collective fronting", gate: "Fronts a Collective to the founder." },
  { key: "chapterScoping", label: "Chapter scoping", gate: "Engagements may be scoped to a chapter." },
  { key: "fundAdmin", label: "Fund administration", gate: "Acts as fund administrator." },
];

interface Engagement {
  id: string;
  companyId: string;
  mode: "A" | "B";
  status: string;
  trialExpiresAt: string | null;
}

interface HandoverRow {
  id: string;
  engagementId: string;
  companyId: string;
  direction: "A_TO_B" | "B_TO_A";
  initiatorParty: "partner" | "founder";
  status: string;
  createdAt: string;
  confirmedAt: string | null;
}

/** Server gate codes → human copy, each read at the cited line. */
const ADMIN_MF_ERROR_COPY: Record<string, string> = {
  INVALID_CAPABILITY_SEED_TYPE:
    "That capability seed type is not one the server recognises. Pick a listed type.",
  TRIAL_EXPIRES_AT_REQUIRED: "Enter the new trial expiry date.",
  TRIAL_NOT_FOUND: "This engagement has no Mode-A trial to override.",
  HANDOVER_NOT_FOUND: "That hand-over no longer exists for this partner.",
  HANDOVER_NOT_PENDING: "That hand-over has already been confirmed or overridden.",
  ENGAGEMENT_NOT_FOUND: "That engagement no longer exists for this partner.",
  DELEGATED_AGENCY_REQUIRED:
    "Confirming this hand-over would move the engagement into Mode A, which needs delegated agency enabled above.",
  AUTHORITY_ARTIFACT_REQUIRED:
    "Confirming into Mode A needs the authority artifact reference recorded on the hand-over.",
  AUTHORITY_ARTIFACT_EXPIRED: "The authority artifact on that hand-over has expired.",
  ADMIN_REQUIRED: "This action needs an administrator session.",
};

function adminMfErrorMessage(err: unknown): string {
  /* `ApiError.code` is where queryClient puts the server's `error` field
     (client/src/lib/queryClient.ts:22) — the same accessor the partner surface
     uses at PartnerManagedFounders.tsx:155. Reading `.body` here was wrong and
     cost one tsc error before it was corrected. */
  const code = err instanceof ApiError ? err.code : null;
  if (code && ADMIN_MF_ERROR_COPY[code]) return ADMIN_MF_ERROR_COPY[code];
  return (err as Error)?.message ?? "The request could not be completed.";
}

export function MfcrmCapabilityPanel({ partnerId }: { partnerId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [seedType, setSeedType] = useState<string>("");
  const [trialTarget, setTrialTarget] = useState<string>("");
  const [trialExpiry, setTrialExpiry] = useState<string>("");

  const capKey = ["/api/admin/mfcrm/capability", partnerId];
  const engKey = ["/api/admin/mfcrm/engagements", partnerId];
  const hoKey = ["/api/admin/mfcrm/handovers", partnerId];

  const capQ = useQuery<{ capability: Capability; seedableTypes: string[] }>({
    queryKey: capKey,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/mfcrm/capability/${encodeURIComponent(partnerId)}`)).json(),
  });
  const engQ = useQuery<{ engagements: Engagement[] }>({
    queryKey: engKey,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/mfcrm/engagements/${encodeURIComponent(partnerId)}`)).json(),
  });
  const hoQ = useQuery<{ handovers: HandoverRow[] }>({
    queryKey: hoKey,
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/mfcrm/handovers/${encodeURIComponent(partnerId)}`)).json(),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: capKey });
    qc.invalidateQueries({ queryKey: engKey });
    qc.invalidateQueries({ queryKey: hoKey });
  };

  const fail = (title: string) => (err: unknown) =>
    toast({ variant: "destructive", title, description: adminMfErrorMessage(err) });

  const seed = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/mfcrm/capability/${encodeURIComponent(partnerId)}/seed`,
        seedType ? { partnerType: seedType } : {});
      return res.json();
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Capability profile classified" }); },
    onError: fail("Could not classify the capability profile"),
  });

  const patch = useMutation({
    mutationFn: async (body: Record<string, boolean>) => {
      const res = await apiRequest("PATCH", `/api/admin/mfcrm/capability/${encodeURIComponent(partnerId)}`, body);
      return res.json();
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Capability profile updated" }); },
    onError: fail("Could not update the capability profile"),
  });

  const trialOverride = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/admin/mfcrm/engagements/${encodeURIComponent(partnerId)}/${encodeURIComponent(trialTarget)}/trial-override`,
        { trialExpiresAt: new Date(`${trialExpiry}T00:00:00.000Z`).toISOString() },
      );
      return res.json();
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Trial expiry overridden" }); },
    onError: fail("Could not override the trial"),
  });

  const expireStale = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST", `/api/admin/mfcrm/engagements/${encodeURIComponent(partnerId)}/expire-stale-trials`, {});
      return res.json() as Promise<{ lapsed: number }>;
    },
    onSuccess: (data) => {
      invalidateAll();
      toast({ title: `${data?.lapsed ?? 0} stale Mode-A trial${data?.lapsed === 1 ? "" : "s"} lapsed` });
    },
    onError: fail("Could not expire stale trials"),
  });

  const overrideHandover = useMutation({
    mutationFn: async (handoverId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/mfcrm/handovers/${encodeURIComponent(partnerId)}/${encodeURIComponent(handoverId)}/override`,
        {},
      );
      return res.json();
    },
    onSuccess: () => { invalidateAll(); toast({ title: "Hand-over overridden" }); },
    onError: fail("Could not override the hand-over"),
  });

  const cap = capQ.data?.capability ?? null;
  const seedable = capQ.data?.seedableTypes ?? [];
  const engagements = engQ.data?.engagements ?? [];
  const pendingHandovers = (hoQ.data?.handovers ?? []).filter((h) => h.status === "initiated");

  return (
    <Card className="p-5 mb-6" data-testid="admin-mfcrm-capability">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-4 w-4" />
        <h2 className="text-base font-semibold">Managed-founder capability</h2>
        {cap && (
          <Badge variant={cap.classified ? "default" : "secondary"} data-testid="admin-mfcrm-classified">
            {cap.classified ? "Classified" : "Unclassified"}
          </Badge>
        )}
      </div>
      <p className="text-xs text-[var(--cv-color-text-muted)] mb-4">
        This profile is the prerequisite the partner's Managed Founders page reports. Until it is
        classified, that page refuses every engagement; Mode A additionally
        requires delegated agency plus an unexpired authority artifact.
      </p>

      {capQ.isLoading && <div className="text-sm">Loading capability profile…</div>}
      {capQ.isError && (
        <div className="text-sm text-red-700" data-testid="admin-mfcrm-error">
          {adminMfErrorMessage(capQ.error)}
        </div>
      )}

      {cap && !cap.classified && (
        <div className="rounded-md border border-[var(--cv-color-border)] p-3 mb-4" data-testid="admin-mfcrm-seed">
          <div className="text-sm font-medium">Classify this partner firm</div>
          <div className="text-xs text-[var(--cv-color-text-muted)] mt-1">
            Seeding applies the default capability set for the firm type. Every flag stays editable below.
            {cap.partnerType && ` The legacy type recorded on the contact is "${cap.partnerType}".`}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[220px]">
              <Label htmlFor="mfcrm-seed-type">Firm type</Label>
              <Select value={seedType} onValueChange={setSeedType}>
                <SelectTrigger id="mfcrm-seed-type" data-testid="admin-mfcrm-seed-type">
                  <SelectValue placeholder="Use the type on the contact" />
                </SelectTrigger>
                <SelectContent>
                  {seedable.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              data-testid="admin-mfcrm-seed-submit"
              disabled={seed.isPending}
              onClick={() => seed.mutate()}
            >
              {seed.isPending ? "Classifying…" : "Classify firm"}
            </Button>
          </div>
        </div>
      )}

      {cap && (
        <div className="rounded-md border border-[var(--cv-color-border)] p-3 mb-4" data-testid="admin-mfcrm-flags">
          <div className="text-sm font-medium">Capabilities</div>
          <ul className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {CAPABILITY_FIELDS.map((f) => {
              const on = cap[f.key] === true;
              return (
                <li key={String(f.key)} className="flex items-start justify-between gap-3 text-xs">
                  <span>
                    <span className="font-medium">{f.label}</span>
                    <span className="block text-[var(--cv-color-text-muted)]">{f.gate}</span>
                  </span>
                  <Button
                    variant={on ? "default" : "outline"}
                    data-testid={`admin-mfcrm-flag-${String(f.key)}`}
                    disabled={patch.isPending}
                    onClick={() => patch.mutate({ [String(f.key)]: !on })}
                  >
                    {on ? "Enabled" : "Disabled"}
                  </Button>
                </li>
              );
            })}
          </ul>
          {cap.updatedAt && (
            <div className="mt-2 text-[11px] text-[var(--cv-color-text-muted)]">
              Last changed {new Date(cap.updatedAt).toLocaleString()}.
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border border-[var(--cv-color-border)] p-3 mb-4" data-testid="admin-mfcrm-trials">
        <div className="text-sm font-medium">Mode-A trials</div>
        {engagements.length === 0 ? (
          <div className="text-xs text-[var(--cv-color-text-muted)] mt-1" data-testid="admin-mfcrm-trials-empty">
            This partner has no managed-founder engagements yet.
          </div>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {engagements.map((e) => (
              <li key={e.id} data-testid={`admin-mfcrm-engagement-${e.id}`}>
                <span className="font-medium">{e.companyId}</span>
                {` · Mode ${e.mode} · ${e.status}`}
                {e.trialExpiresAt ? ` · trial to ${new Date(e.trialExpiresAt).toLocaleDateString()}` : " · no trial"}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <Label htmlFor="mfcrm-trial-engagement">Engagement</Label>
            <Select value={trialTarget} onValueChange={setTrialTarget}>
              <SelectTrigger id="mfcrm-trial-engagement" data-testid="admin-mfcrm-trial-engagement">
                <SelectValue placeholder="Select an engagement" />
              </SelectTrigger>
              <SelectContent>
                {engagements.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{`${e.companyId} (Mode ${e.mode})`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="mfcrm-trial-expiry">New expiry</Label>
            <Input
              id="mfcrm-trial-expiry"
              type="date"
              data-testid="admin-mfcrm-trial-expiry"
              value={trialExpiry}
              onChange={(ev) => setTrialExpiry(ev.target.value)}
            />
          </div>
          <Button
            variant="outline"
            data-testid="admin-mfcrm-trial-submit"
            disabled={trialOverride.isPending || !trialTarget || !trialExpiry}
            onClick={() => trialOverride.mutate()}
          >
            {trialOverride.isPending ? "Saving…" : "Override trial expiry"}
          </Button>
          <Button
            variant="outline"
            data-testid="admin-mfcrm-expire-stale"
            disabled={expireStale.isPending}
            onClick={() => expireStale.mutate()}
          >
            {expireStale.isPending ? "Sweeping…" : "Expire stale trials"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-[var(--cv-color-border)] p-3" data-testid="admin-mfcrm-handovers">
        <div className="text-sm font-medium">Hand-overs awaiting confirmation</div>
        {pendingHandovers.length === 0 ? (
          <div className="text-xs text-[var(--cv-color-text-muted)] mt-1" data-testid="admin-mfcrm-handovers-empty">
            No pending hand-overs for this partner.
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {pendingHandovers.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                data-testid={`admin-mfcrm-handover-${h.id}`}
              >
                <span>
                  {h.companyId}
                  {h.direction === "B_TO_A" ? " · Mode B → Mode A" : " · Mode A → Mode B"}
                  {` · initiated by the ${h.initiatorParty === "founder" ? "founder" : "partner firm"}`}
                  {h.createdAt ? ` · ${new Date(h.createdAt).toLocaleDateString()}` : ""}
                </span>
                <Button
                  variant="outline"
                  data-testid={`admin-mfcrm-handover-override-${h.id}`}
                  disabled={overrideHandover.isPending}
                  onClick={() => overrideHandover.mutate(h.id)}
                >
                  Override and confirm
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 text-[11px] text-[var(--cv-color-text-muted)]">
          An override into Mode A still re-runs the delegated-agency entry check, so it cannot be used to
          bypass the gate above.
        </div>
      </div>
    </Card>
  );
}
