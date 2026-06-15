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

const TIER_RANK = { catalyst: 1, builder: 2, amplifier: 3, nexus: 4, founding_member: 5 } as const;

type Settings = {
  displayName?: string;
  regionCode?: string;
  preferredPayoutCurrency?: string;
  branding?: { logoUrl?: string; primaryColor?: string };
  notifications?: { weeklyDigest?: boolean; newClientAlert?: boolean };
};

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
      const res = await apiRequest("PATCH", "/api/partner/me/workspace-settings", body);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "save_failed" }));
        throw new Error(err.error || "save_failed");
      }
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

  return (
    <PartnerShell title="Settings" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <div className="flex gap-2 mb-4 border-b">
        {(["profile", "localization", "branding", "notifications"] as const).map((t) => (
          <button
            key={t}
            data-testid={`partner-settings-tab-${t}`}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-blue-600 font-medium" : "text-slate-600"}`}
          >
            {t} {t === "branding" && TIER_RANK[me.tier] < TIER_RANK.nexus && "🔒"}
          </button>
        ))}
      </div>

      {isLoading && <div className="text-sm text-slate-500" data-testid="settings-loading">Loading…</div>}
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
          <div>
            <Label>Display Name</Label>
            <Input
              value={settings.displayName ?? ""}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              disabled={!canWrite}
              data-testid="partner-settings-display-name"
            />
          </div>
        </Card>
      )}

      {tab === "localization" && (
        <Card className="p-4 space-y-3" data-testid="partner-settings-localization">
          <div>
            <Label>Region Code (ISO 3166-1)</Label>
            <Input
              value={settings.regionCode ?? ""}
              onChange={(e) => setForm({ ...form, regionCode: e.target.value })}
              disabled={!canWrite}
              data-testid="partner-settings-region"
              placeholder="CA"
            />
          </div>
          <div>
            <Label>Preferred Payout Currency (ISO 4217)</Label>
            <Input
              value={settings.preferredPayoutCurrency ?? ""}
              onChange={(e) => setForm({ ...form, preferredPayoutCurrency: e.target.value })}
              disabled={!canWrite}
              data-testid="partner-settings-currency"
              placeholder="CAD"
            />
          </div>
        </Card>
      )}

      {tab === "branding" && (
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
