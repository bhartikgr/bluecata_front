/**
 * Foundation Build — Partner Settings page.
 * Tabs: Profile, Localization, Branding (Nexus+), Notifications.
 * Branding write is gated client-side (banner) AND server-side (403 on tier < nexus).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
/* v25.12 NH11 — toast settings save failures in addition to the inline error
 * shown elsewhere on the page. */
import { useToast } from "@/hooks/use-toast";
/* v25.50 Phase 7 (11) — canonical master lists replace the free-text region /
   currency fields, and back the expanded company-profile subset. */
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { COUNTRIES } from "@/lib/profile/data/countries";
import { buildCurrencyOptions } from "@/lib/currencyOptions";

const TIER_RANK = { catalyst: 1, builder: 2, amplifier: 3, nexus: 4, founding_member: 5 } as const;

const CURRENCY_OPTIONS = buildCurrencyOptions();

type Settings = {
  displayName?: string;
  /* v25.50 Phase 7 (11a) — expanded company-profile subset (persists in the
     workspace-settings JSON blob; the server patch is spread-based). */
  legalName?: string;
  website?: string;
  addressLine1?: string;
  city?: string;
  country?: string;
  regionCode?: string;
  preferredPayoutCurrency?: string;
  branding?: { logoUrl?: string; primaryColor?: string };
  notifications?: { weeklyDigest?: boolean; newClientAlert?: boolean };
};

/* v25.50 Phase 7 (11c) — the Branding tab is HIDDEN entirely. The tab code +
   its write handlers remain below (dormant) so the white-label surface can be
   restored without a rebuild, but it is unreachable from the tab strip. */
const BRANDING_TAB_HIDDEN = true;

export default function PartnerSettings() {
  const role = useRequirePartnerRole();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"profile" | "localization" | "branding" | "notifications">("profile");
  const [form, setForm] = useState<Settings>({});

  const { data, isLoading, isError } = useQuery<{ settings: Settings }>({
    /* v25.12 NL1 — explicit queryFn for robustness. */
    /* v25.15 NM8 — isError surfaced for explicit error UI. */
    queryKey: ["/api/partner/me/workspace-settings"],
    enabled: role.ready && !!role.identity,
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/workspace-settings")).json(),
  });

  /* v25.12 NH11 — toast helper. */
  const { toast } = useToast();

  const save = useMutation({
    mutationFn: async (body: Settings) => {
      /* v25.33 — apiRequest() throws ApiError on non-2xx, so the former `if (!res.ok)`
         guard was unreachable dead code. The thrown ApiError reaches onError
         unchanged, preserving the "Settings save failed" toast. */
      const res = await apiRequest("PATCH", "/api/partner/me/workspace-settings", body);
      return res.json();
    },
    /* v25.16 NM1 — reset the dirty-form state after a successful save so
       subsequent saves don't re-submit the previous diff. */
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["/api/partner/me/workspace-settings"] });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: "Settings save failed", description: e.message }),
  });

  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  const canWrite = me.subRole === "managing_partner";
  const canBrand = canWrite && TIER_RANK[me.tier] >= TIER_RANK.nexus;
  const settings = { ...(data?.settings ?? {}), ...form };

  /* GROUP E (E1) — non-blocking onboarding nudge. Lists the profile fields
     that are still blank so the partner can complete their profile. We only
     report what is genuinely empty — nothing is pre-filled or fabricated. */
  const isBlank = (v?: string) => !v || v.trim().length === 0;
  const missingProfileFields = [
    { label: "Legal Company Name", empty: isBlank(settings.legalName) },
    { label: "Website", empty: isBlank(settings.website) },
    { label: "Address", empty: isBlank(settings.addressLine1) },
  ].filter((f) => f.empty).map((f) => f.label);

  return (
    <PartnerShell title="Settings" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="flex gap-2 mb-4 border-b">
        {(["profile", "localization", "branding", "notifications"] as const)
          .filter((t) => !(t === "branding" && BRANDING_TAB_HIDDEN))
          .map((t) => (
          <button
            key={t}
            data-testid={`partner-settings-tab-${t}`}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-[var(--cv-color-primary)] text-[var(--cv-color-primary)] font-medium" : "text-[var(--cv-color-text-secondary)]"}`}
          >
            {t} {t === "branding" && TIER_RANK[me.tier] < TIER_RANK.nexus && "🔒"}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-[var(--cv-color-text-muted)]" data-testid="settings-loading">Loading…</div>}
      {/* v25.15 NM8 — explicit error branch. */}
      {isError && (
        <div
          className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
          data-testid="settings-error"
        >
          Could not load settings. Please refresh and try again.
        </div>
      )}

      {tab === "profile" && (
        <Card className="p-4 space-y-3" data-testid="partner-settings-profile">
          {/* GROUP E (E1) — non-blocking onboarding nudge for an incomplete profile. */}
          {missingProfileFields.length > 0 && (
            <div
              className="rounded-md p-3 text-sm"
              style={{
                background: "var(--cv-color-warning-light)",
                border: "1px solid var(--cv-color-warning)",
                color: "var(--cv-color-text)",
                borderRadius: "var(--cv-radius-md)",
              }}
              data-testid="partner-settings-onboarding-nudge"
            >
              Complete your partner profile to help clients find you. Still to
              add: <strong>{missingProfileFields.join(", ")}</strong>.
            </div>
          )}
          {/* v25.50 Phase 7 (11a) — expanded editable profile: display name plus
             a CompanyProfile-taxonomy subset (legal name, website, address). */}
          <div>
            <Label>Display Name</Label>
            <Input
              value={settings.displayName ?? ""}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              disabled={!canWrite}
              data-testid="partner-settings-display-name"
            />
          </div>
          <div>
            <Label>Legal Company Name</Label>
            <Input
              value={settings.legalName ?? ""}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              disabled={!canWrite}
              data-testid="partner-settings-legal-name"
            />
          </div>
          <div>
            <Label>Website</Label>
            <Input
              value={settings.website ?? ""}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              disabled={!canWrite}
              data-testid="partner-settings-website"
              placeholder="https://…"
            />
          </div>
          <div>
            <Label>Address</Label>
            <Input
              value={settings.addressLine1 ?? ""}
              onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
              disabled={!canWrite}
              data-testid="partner-settings-address"
              placeholder="Street address"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>City</Label>
              <Input
                value={settings.city ?? ""}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                disabled={!canWrite}
                data-testid="partner-settings-city"
              />
            </div>
            <div>
              <Label>Country</Label>
              <Select
                value={settings.country ?? ""}
                onValueChange={(v) => setForm({ ...form, country: v })}
                disabled={!canWrite}
              >
                <SelectTrigger data-testid="partner-settings-country"><SelectValue placeholder="Select country" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Card>
      )}

      {tab === "localization" && (
        <Card className="p-4 space-y-3" data-testid="partner-settings-localization">
          {/* v25.50 Phase 7 (11b) — free-text region/currency → canonical dropdowns. */}
          <div>
            <Label>Region (ISO 3166-1 country)</Label>
            <Select
              value={settings.regionCode ?? ""}
              onValueChange={(v) => setForm({ ...form, regionCode: v })}
              disabled={!canWrite}
            >
              <SelectTrigger data-testid="partner-settings-region"><SelectValue placeholder="Select region" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Preferred Payout Currency (ISO 4217)</Label>
            <Select
              value={settings.preferredPayoutCurrency ?? ""}
              onValueChange={(v) => setForm({ ...form, preferredPayoutCurrency: v })}
              disabled={!canWrite}
            >
              <SelectTrigger data-testid="partner-settings-currency"><SelectValue placeholder="Select currency" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {CURRENCY_OPTIONS.map((c) => <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </Card>
      )}

      {tab === "branding" && !BRANDING_TAB_HIDDEN && (
        <Card className="p-4 space-y-3" data-testid="partner-settings-branding">
          {!canBrand && (
            <div className="bg-amber-50 border border-amber-200 p-3 rounded text-sm" data-testid="partner-settings-branding-locked">
              White-label branding requires <strong>Nexus tier</strong> or higher. Current tier: <strong>{me.tier}</strong>.
            </div>
          )}
          <div>
            <Label>Logo URL</Label>
            <Input
              value={settings.branding?.logoUrl ?? ""}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, logoUrl: e.target.value } })}
              disabled={!canBrand}
              data-testid="partner-settings-logo-url"
            />
          </div>
          <div>
            <Label>Primary Color</Label>
            <Input
              value={settings.branding?.primaryColor ?? ""}
              onChange={(e) => setForm({ ...form, branding: { ...form.branding, primaryColor: e.target.value } })}
              disabled={!canBrand}
              data-testid="partner-settings-primary-color"
              placeholder="#0EA5E9"
            />
          </div>
        </Card>
      )}

      {tab === "notifications" && (
        <Card className="p-4 space-y-3" data-testid="partner-settings-notifications">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.notifications?.weeklyDigest ?? false}
              onChange={(e) => setForm({ ...form, notifications: { ...form.notifications, weeklyDigest: e.target.checked } })}
              disabled={!canWrite}
              data-testid="partner-settings-weekly-digest"
            />
            Weekly digest email
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.notifications?.newClientAlert ?? false}
              onChange={(e) => setForm({ ...form, notifications: { ...form.notifications, newClientAlert: e.target.checked } })}
              disabled={!canWrite}
              data-testid="partner-settings-new-client-alert"
            />
            Alert on new client attribution
          </label>
        </Card>
      )}

      {canWrite && (
        <div className="mt-4">
          <Button
            onClick={() => save.mutate(form)}
            disabled={save.isPending || Object.keys(form).length === 0}
            data-testid="partner-settings-save"
          >
            {save.isPending ? "Saving…" : "Save Changes"}
          </Button>
          {save.error && <div className="text-sm text-red-600 mt-2">{(save.error as Error).message}</div>}
        </div>
      )}
    </PartnerShell>
  );
}
