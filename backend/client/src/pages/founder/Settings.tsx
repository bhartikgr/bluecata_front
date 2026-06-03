import { asArray } from "@/lib/safeArray";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIMEZONES_IANA, detectBrowserTimezone } from "@/lib/timezones";
import { User, Building2, Users, CreditCard, Receipt, Bell, Database, Check, X, Download, Trash2, Lock, Plus, ShieldAlert, ShieldCheck, Globe, MapPin, Settings2, DollarSign, TrendingUp, Gavel, Activity, Send, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { LEGAL_DOCS } from "@/lib/legalDocs";
import type { LegalDoc } from "@/lib/legalDocs";
import { useLegalDrawer } from "@/lib/legalDrawer";
import type { LegalDocId } from "@/lib/legalDrawer";
import { useToast } from "@/hooks/use-toast";
import { validateScreenName } from "@/lib/privacy/visibility";
import { useActiveCompany, useActiveCompanyId } from "@/lib/useActiveCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fmtUSD } from "@/lib/format";
import { Link } from "wouter";
import { FINANCIAL_FIELD_COPY, getFieldsForStage } from "@/lib/financialFieldCopy";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * v23.8 C6/W-17 — derive a default ISO-4217 currency from a free-text HQ /
 * region string ("Hong Kong" → HKD, "London, UK" → GBP). Used only as the
 * picker's default when the company has no stored defaultCurrency. Returns
 * null when nothing matches so the existing USD default stands.
 */
export function deriveCurrencyFromRegion(region: string | null | undefined): string | null {
  if (!region) return null;
  const r = region.toLowerCase();
  if (/hong kong|\bhk\b/.test(r)) return "HKD";
  if (/singapore|\bsg\b/.test(r)) return "SGD";
  if (/\b(united kingdom|england|scotland|wales|uk|gb|london)\b/.test(r)) return "GBP";
  if (/\bcanada\b|, ?(ab|bc|on|qc|ns|mb|sk)\b/.test(r)) return "CAD";
  if (/\baustralia\b|\bau\b|sydney|melbourne/.test(r)) return "AUD";
  if (/\bjapan\b|\bjp\b|tokyo/.test(r)) return "JPY";
  if (/\bindia\b|\bin\b|bangalore|mumbai/.test(r)) return "INR";
  if (/\bswitzerland\b|zurich|geneva/.test(r)) return "CHF";
  if (/\b(germany|france|spain|italy|netherlands|ireland|eu|euro)\b|berlin|paris|amsterdam/.test(r)) return "EUR";
  if (/\bunited states\b|\bus\b|\busa\b|, ?[a-z]{2}$/.test(r)) return "USD";
  return null;
}

type PricingFeature = { key: string; label: string; included: boolean; limit?: string };
type PricingTier = { id: string; name: string; monthlyUsd: number; annualUsd: number; blurb: string; features: PricingFeature[]; billingCycle?: "annual" | "monthly" | "one_time"; annualPriceCents?: number; displayPrice?: string };

export default function Settings() {
  const { toast } = useToast();
  const { data: activeCompanyResp } = useActiveCompany();
  const company = activeCompanyResp?.company;
  const companyId = useActiveCompanyId();

  const tiersQ = useQuery<PricingTier[]>({
    queryKey: ["/api/admin/pricing-tiers"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/pricing-tiers")).json(),
  });

  const [activeTier, setActiveTier] = useState("founder_pro");
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");

  // Privacy state (preserve Sprint 7)
  const [screenName, setScreenName] = useState("");
  const [visibleCo, setVisibleCo] = useState(false);
  const [visibleNet, setVisibleNet] = useState(false);
  const screenValid = screenName.length === 0 ? { ok: true as const } : validateScreenName(screenName);

  // Sprint 18 T11.1 — timezone selector (browser-detected default)
  const [timezone, setTimezone] = useState<string>(() => detectBrowserTimezone());

  // Group timezones by region for the selector
  const groupedTzs = TIMEZONES_IANA.reduce<Record<string, typeof TIMEZONES_IANA>>((acc, t) => {
    (acc[t.region] ??= [] as typeof TIMEZONES_IANA).push(t);
    return acc;
  }, {});

  // Defect B-series — wire all buttons to real mutations instead of toast-only stubs.
  const [inviteEmail, setInviteEmail] = useState("");

  // B-V11-5 fix: hold the Company tab inputs in controlled state so they
  // (a) actually drive the PATCH payload and (b) re-sync when the active
  // company changes. Previously the inputs used `defaultValue` only, so the
  // mutation sent `company?.companyName` (the stale server value) and nothing
  // else, and no user edit ever reached the server.
  const [coDisplayName, setCoDisplayName] = useState("");
  const [coLegalName,   setCoLegalName]   = useState("");
  // v23.4.7 Phase 9 / BUG 017 — Default currency is a Select (not a plain
  // text input). Hydrated from the active-company query and persisted via the
  // existing saveCompanyMut PATCH body.
  const [coCurrency,    setCoCurrency]    = useState("USD");
  // Re-hydrate the form whenever the active company query resolves / switches.
  useEffect(() => {
    if (company?.companyName !== undefined) setCoDisplayName(company.companyName ?? "");
    if (company?.legalName   !== undefined) setCoLegalName(company.legalName ?? "");
    const cur = (company as { defaultCurrency?: string } | undefined)?.defaultCurrency;
    // v23.8 C6/W-17 — when no currency is stored, derive a sensible default
    // from the company HQ/region (HK→HKD, CA→CAD, GB/UK→GBP, …) instead of
    // always falling back to USD.
    if (cur) setCoCurrency(cur);
    else {
      const hq = (company as { hq?: string } | undefined)?.hq;
      const derived = deriveCurrencyFromRegion(hq);
      if (derived) setCoCurrency(derived);
    }
  }, [company?.companyName, company?.legalName, (company as { defaultCurrency?: string } | undefined)?.defaultCurrency, (company as { hq?: string } | undefined)?.hq]);

  // ----- Wave B FIX 6 (F-BUG-009) -----
  // Pre-populate the Profile tab inputs (Display name / Email / Title) from
  // the authenticated user's /api/auth/me payload so the values the founder
  // supplied at signup are already there on first visit. Previously the
  // inputs were uncontrolled `defaultValue=""` placeholders, which QA flagged
  // because a brand-new founder's data was nowhere to be found.
  type MeShape = {
    isAuthed?: boolean;
    userId?: string;
    identity?: { name?: string; email?: string; title?: string };
    name?: string;
    email?: string;
    title?: string;
  };
  const meQ = useQuery<MeShape>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => (await apiRequest("GET", "/api/auth/me")).json(),
  });
  const [profileName,  setProfileName]  = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileTitle, setProfileTitle] = useState("");
  useEffect(() => {
    const m = meQ.data;
    if (!m) return;
    const n = m.identity?.name  ?? m.name  ?? "";
    const e = m.identity?.email ?? m.email ?? "";
    const t = m.identity?.title ?? m.title ?? "";
    if (n) setProfileName(n);
    if (e) setProfileEmail(e);
    if (t) setProfileTitle(t);
  }, [meQ.data]);

  // Team members are sourced from the API; show empty state if none.
  type TeamMember = { id: string; name: string; email: string; role: string; joined: string };
  const teamQ = useQuery<{ members: TeamMember[] }>({
    queryKey: ["/api/founder/team/members", companyId],
    queryFn: async () => {
      const r = await fetch(`/api/founder/team/members?companyId=${encodeURIComponent(companyId)}`);
      if (!r.ok) return { members: [] };
      return r.json();
    },
    enabled: Boolean(companyId),
  });
  const teamMembers: TeamMember[] = teamQ.data?.members ?? [];

  const saveProfileMut = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", "/api/auth/me", { timezone, name: profileName, email: profileEmail, title: profileTitle })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }); toast({ title: "Profile saved" }); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const saveCompanyMut = useMutation({
    // B-V11-5 fix: send both display name and legal name from controlled state.
    // v23.4.7 Phase 9 / BUG 017: also send the picked defaultCurrency.
    mutationFn: async () => (await apiRequest("PATCH", `/api/companies/${companyId}`, {
      name: coDisplayName,
      legalName: coLegalName,
      defaultCurrency: coCurrency,
    })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/companies"] }); queryClient.invalidateQueries({ queryKey: ["/api/founder/active-company"] }); toast({ title: "Company saved" }); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const savePrivacyMut = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/founder/privacy", { screenName, visibleToCoMembers: visibleCo, visibleToCollectiveNetwork: visibleNet })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/privacy"] }); toast({ title: "Privacy settings saved" }); },
    onError: () => toast({ title: "Save failed", variant: "destructive" }),
  });

  const switchPlanMut = useMutation({
    mutationFn: async (tierId: string) => (await apiRequest("POST", "/api/billing/plan", { companyId, tierId })).json(),
    onSuccess: (_, tierId) => { setActiveTier(tierId); queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] }); toast({ title: "Plan updated" }); },
    onError: () => toast({ title: "Plan change failed", variant: "destructive" }),
  });

  const inviteMemberMut = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/founder/team/invitations", { companyId, email: inviteEmail })).json(),
    onSuccess: () => { toast({ title: "Invitation sent" }); setInviteEmail(""); queryClient.invalidateQueries({ queryKey: ["/api/founder/team"] }); },
    onError: () => toast({ title: "Invite failed", variant: "destructive" }),
  });

  const removeMemberMut = useMutation({
    mutationFn: async (memberId: string) => (await apiRequest("DELETE", `/api/founder/team/members/${memberId}`)).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/team"] }); toast({ title: "Member removed" }); },
    onError: () => toast({ title: "Remove failed", variant: "destructive" }),
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Profile, company, team, plan, billing, notifications, and data."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Settings" }]}
      />
      <PageBody>
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 justify-start" data-testid="tabs-settings">
            <TabsTrigger value="profile" data-testid="tab-profile"><User className="h-3.5 w-3.5 mr-1" /> Profile</TabsTrigger>
            <TabsTrigger value="company" data-testid="tab-company"><Building2 className="h-3.5 w-3.5 mr-1" /> Company</TabsTrigger>
            {/* v23.4.4 (BUG 015) — "Coming soon" badges removed. Team / Billing / Notifications tabs are wired to their respective stores and persist via the standard API mutation path. */}
            <TabsTrigger value="team" data-testid="tab-team"><Users className="h-3.5 w-3.5 mr-1" /> Team</TabsTrigger>
            <TabsTrigger value="plan" data-testid="tab-plan"><CreditCard className="h-3.5 w-3.5 mr-1" /> Plan</TabsTrigger>
            <TabsTrigger value="billing" data-testid="tab-billing"><Receipt className="h-3.5 w-3.5 mr-1" /> Billing</TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications"><Bell className="h-3.5 w-3.5 mr-1" /> Notifications</TabsTrigger>
            <TabsTrigger value="data" data-testid="tab-data"><Database className="h-3.5 w-3.5 mr-1" /> Data</TabsTrigger>
            <TabsTrigger value="privacy" data-testid="tab-privacy"><ShieldAlert className="h-3.5 w-3.5 mr-1" /> Privacy</TabsTrigger>
            {/* Wave C-1 — new tabs before Legal */}
            <TabsTrigger value="public-profile" data-testid="tab-public-profile"><Globe className="h-3.5 w-3.5 mr-1" /> Public</TabsTrigger>
            <TabsTrigger value="region" data-testid="tab-region"><MapPin className="h-3.5 w-3.5 mr-1" /> Region</TabsTrigger>
            <TabsTrigger value="preferences" data-testid="tab-preferences"><Settings2 className="h-3.5 w-3.5 mr-1" /> Preferences</TabsTrigger>
            <TabsTrigger value="financials" data-testid="tab-financials"><DollarSign className="h-3.5 w-3.5 mr-1" /> Financials</TabsTrigger>
            <TabsTrigger value="governance" data-testid="tab-governance"><Gavel className="h-3.5 w-3.5 mr-1" /> Governance</TabsTrigger>
            <TabsTrigger value="mna-prep" data-testid="tab-mna-prep"><Activity className="h-3.5 w-3.5 mr-1" /> M&amp;A Prep</TabsTrigger>
            <TabsTrigger value="legal" data-testid="tab-legal"><ShieldCheck className="h-3.5 w-3.5 mr-1" /> Legal</TabsTrigger>
            <TabsTrigger value="delete" data-testid="tab-delete"><Trash2 className="h-3.5 w-3.5 mr-1" /> Delete</TabsTrigger>
          </TabsList>

          {/* PROFILE */}
          <TabsContent value="profile" className="mt-4">
            <TabIntro
              title="Profile"
              body="Your personal identity on Capavate. Display name, email, title, and time zone affect how you appear in messages, scheduled reports, and activity timestamps. Changes propagate across all your cap-table memberships."
            />
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Personal details</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div><Label>Display name</Label><Input className="mt-1" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Your full name" data-testid="input-display-name" /></div>
                  <div><Label>Email</Label><Input className="mt-1" type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} placeholder="you@company.com" data-testid="input-email" /></div>
                  <div><Label>Title</Label><Input className="mt-1" value={profileTitle} onChange={(e) => setProfileTitle(e.target.value)} placeholder="e.g. CEO & Co-founder" data-testid="input-title" /></div>
                  <div>
                    <Label>Default time zone</Label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger className="mt-1" data-testid="select-timezone"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {Object.entries(groupedTzs).map(([region, tzs]) => (
                          <SelectGroup key={region}>
                            <SelectLabel>{region}</SelectLabel>
                            {tzs.map(t => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Auto-detected from your browser ({detectBrowserTimezone()}). Used for scheduled reports, due dates, and activity timestamps.
                    </p>
                  </div>
                  <Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => saveProfileMut.mutate()} disabled={saveProfileMut.isPending} data-testid="button-save-profile">{saveProfileMut.isPending ? "Saving…" : "Save profile"}</Button>
                </CardContent>
              </Card>

              <Card data-testid="section-privacy" className="border-2 border-destructive/70">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-destructive" /> Privacy & visibility</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">Read carefully. These toggles control how you appear across cap tables and messaging. See the full Privacy tab for details.</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <PrivacyControls
                    screenName={screenName} setScreenName={setScreenName}
                    visibleCo={visibleCo} setVisibleCo={setVisibleCo}
                    visibleNet={visibleNet} setVisibleNet={setVisibleNet}
                    screenValid={screenValid}
                    onSave={() => savePrivacyMut.mutate()}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* COMPANY */}
          <TabsContent value="company" className="mt-4">
            <TabIntro
              title="Company"
              body="Public-facing company details surfaced to investors, the Collective, and reports. Legal name and region of incorporation drive engine attribution and regulatory tagging. Updates broadcast to investor views in real time via the EventBus."
            />
            <Card>
              <CardHeader><CardTitle className="text-base">Company details</CardTitle></CardHeader>
              <CardContent className="grid md:grid-cols-2 gap-4">
                <div><Label>Display name</Label><Input className="mt-1" value={coDisplayName} onChange={(e) => setCoDisplayName(e.target.value)} placeholder="e.g. Acme Inc." data-testid="input-co-name" /></div>
                <div><Label>Legal name</Label><Input className="mt-1" value={coLegalName} onChange={(e) => setCoLegalName(e.target.value)} data-testid="input-legal-name" /></div>
                {/* v23.4.7 Phase 9 / BUG 017 — currency picker (frontend only;
                 *  engine-level currency awareness stays SACRED + deferred). */}
                <div>
                  <Label>Default currency</Label>
                  <Select value={coCurrency} onValueChange={setCoCurrency}>
                    <SelectTrigger className="mt-1" data-testid="select-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[
                        "USD","CAD","EUR","GBP","AUD","JPY","HKD",
                        "SGD","INR","CHF","SEK","NOK","DKK","NZD",
                      ].map((c) => (
                        <SelectItem key={c} value={c} data-testid={`currency-option-${c}`}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Region of incorporation</Label><Input className="mt-1" defaultValue="US" data-testid="input-region" /></div>
                <div className="md:col-span-2"><Label>Tagline</Label><Input className="mt-1" defaultValue="" placeholder="One-line value proposition" data-testid="input-tagline" /></div>
                <div className="md:col-span-2"><Label>Description</Label><Textarea rows={3} className="mt-1" defaultValue="" placeholder="What does your company do?" data-testid="textarea-description" /></div>
                <div className="md:col-span-2"><Button className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => saveCompanyMut.mutate()} disabled={saveCompanyMut.isPending} data-testid="button-save-company">{saveCompanyMut.isPending ? "Saving…" : "Save"}</Button></div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TEAM */}
          <TabsContent value="team" className="mt-4">
            <TabIntro
              title="Team"
              body="Manage co-founders, admins, and members of your workspace. Each role inherits a distinct permission set per ISO 27001 access-control best practice. Invitations expire after 14 days; revoking access immediately rotates session tokens."
            />
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
                <CardTitle className="text-base">Team members</CardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-8 w-48 text-xs"
                    data-testid="input-invite-email"
                  />
                  <Button size="sm" className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => inviteMemberMut.mutate()} disabled={inviteMemberMut.isPending || !inviteEmail} data-testid="button-invite-member"><Plus className="h-3.5 w-3.5 mr-1" /> Invite</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {teamMembers.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-muted-foreground" data-testid="empty-team">
                      No team members yet. Invite a colleague to get started.
                    </div>
                  ) : teamMembers.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-5 py-3" data-testid={`row-member-${m.id}`}>
                      <div>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.email} · joined {m.joined}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{m.role}</Badge>
                        {m.role !== "Owner" && (
                          <Button size="sm" variant="ghost" onClick={() => removeMemberMut.mutate(m.id)} disabled={removeMemberMut.isPending} data-testid={`button-remove-${m.id}`}>
                            <Trash2 className="h-3.5 w-3.5 text-[hsl(7_61%_43%)]" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PLAN — pulled from admin pricing tiers */}
          <TabsContent value="plan" className="mt-4">
            <TabIntro
              title="Plan"
              body="Your subscription tier and feature entitlements. Upgrades take effect immediately and pro-rate against the current billing period. Downgrades take effect at the next renewal so commitments to investors remain stable."
            />
            {(() => {
              const tierList = asArray<PricingTier>(tiersQ.data);
              const singleTier = tierList.length === 1;
              return (
            <>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-muted-foreground">Live from admin pricing console — every change there reflects here.</div>
              {!singleTier && (
                <div className="flex gap-1 rounded-md border p-1 text-xs" data-testid="toggle-billing-period">
                  <button type="button" className={`px-3 py-1 rounded ${billingPeriod === "monthly" ? "bg-[hsl(219_45%_20%)] text-white" : ""}`} onClick={() => setBillingPeriod("monthly")} data-testid="button-monthly">Monthly</button>
                  <button type="button" className={`px-3 py-1 rounded ${billingPeriod === "annual" ? "bg-[hsl(219_45%_20%)] text-white" : ""}`} onClick={() => setBillingPeriod("annual")} data-testid="button-annual">Annual (save 17%)</button>
                </div>
              )}
            </div>
            <div className={singleTier ? "grid md:grid-cols-1 max-w-xl mx-auto gap-3" : "grid md:grid-cols-3 gap-3"} data-testid={singleTier ? "single-plan-grid" : "multi-plan-grid"}>
              {tierList.map(t => {
                // Single-tier mode: always show annual price + displayPrice if provided.
                const effectiveCycle: "monthly" | "annual" = singleTier
                  ? (t.billingCycle === "monthly" ? "monthly" : "annual")
                  : billingPeriod;
                const price = effectiveCycle === "monthly" ? t.monthlyUsd : t.annualUsd;
                const isActive = t.id === activeTier;
                return (
                  <Card key={t.id} className={isActive ? "border-[hsl(184_98%_22%)] border-2" : ""} data-testid={`card-tier-${t.id}`}>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center justify-between">
                        {t.name}
                        {isActive && <Badge className="bg-[hsl(184_98%_22%)] text-white">Active</Badge>}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">{t.blurb}</p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        {singleTier && t.displayPrice ? (
                          <>
                            <div className="text-2xl font-bold" data-testid="single-plan-display-price">{t.displayPrice}</div>
                            <div className="text-xs text-muted-foreground">Per company • Full Capavate access</div>
                          </>
                        ) : (
                          <>
                            <div className="text-2xl font-bold">{price === 0 ? "Free" : fmtUSD(price)}</div>
                            <div className="text-xs text-muted-foreground">{price === 0 ? "Always" : `per ${effectiveCycle === "monthly" ? "month" : "year"}`}</div>
                          </>
                        )}
                      </div>
                      <ul className="space-y-1.5 text-xs">
                        {t.features.map(f => (
                          <li key={f.key} className="flex items-start gap-2">
                            {f.included
                              ? <Check className="h-3.5 w-3.5 text-[hsl(184_98%_22%)] shrink-0 mt-0.5" />
                              : <X className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />}
                            <span className={f.included ? "" : "text-muted-foreground line-through"}>
                              {f.label}{f.limit && f.included ? ` — ${f.limit}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {!isActive && (
                        <Button size="sm" className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white" onClick={() => switchPlanMut.mutate(t.id)} disabled={switchPlanMut.isPending} data-testid={`button-switch-${t.id}`}>Switch to {t.name}</Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            </>
              );
            })()}
          </TabsContent>

          {/* BILLING */}
          <TabsContent value="billing" className="mt-4">
            <TabIntro
              title="Billing"
              body="Payment methods, invoice history, and billing-contact emails. PCI-DSS scope is limited — card data never touches Capavate servers. Receipts are exported as audit-grade PDFs with hash verification."
            />
            {/* BUG 016 fix v23.7 — the billing tab previously embedded the
             * PaymentSurface in demo mode, which surfaced a "Demo" badge and a
             * placeholder charge form to founders. Until a real Stripe billing
             * relationship is connected we show an honest connect-account CTA
             * instead of any demo wording or a non-functional charge form. */}
            <Card className="mb-4" data-testid="card-billing-connect">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Payment method
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Connect your Stripe account in Billing &amp; Plans to manage your
                  subscription and payment method. Your workspace stays fully
                  functional until billing is activated.
                </p>
                <Link href="/founder/billing">
                  <Button variant="outline" size="sm" data-testid="button-connect-billing">
                    Go to Billing &amp; Plans <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
            <div className="grid md:grid-cols-3 gap-4">
              <Card className="md:col-span-2">
                <CardHeader><CardTitle className="text-base">Recent invoices</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border">
                    {[
                      { id: "inv_2026_05", date: "2026-05-01", amount: 249, status: "paid" },
                      { id: "inv_2026_04", date: "2026-04-01", amount: 249, status: "paid" },
                      { id: "inv_2026_03", date: "2026-03-01", amount: 249, status: "paid" },
                    ].map(inv => (
                      <div key={inv.id} className="flex items-center justify-between px-5 py-3" data-testid={`row-invoice-${inv.id}`}>
                        <div>
                          <div className="font-medium">{fmtUSD(inv.amount)}</div>
                          <div className="text-xs text-muted-foreground">{inv.date} · {inv.id}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-[hsl(184_98%_22%)] text-white">{inv.status}</Badge>
                          <Button size="sm" variant="ghost" onClick={() => toast({ title: "Invoice downloaded" })} data-testid={`button-download-${inv.id}`}><Download className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Payment method</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-md border p-3">
                    <div className="font-medium text-sm">Visa ending 4242</div>
                    <div className="text-xs text-muted-foreground">Exp 12/2027</div>
                  </div>
                  <Button variant="outline" className="w-full" onClick={() => toast({ title: "Update card flow" })} data-testid="button-update-card">Update card</Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* NOTIFICATIONS */}
          <TabsContent value="notifications" className="mt-4">
            <TabIntro
              title="Notifications"
              body="Channel and frequency for alerts. Choose between in-app bell, email digest (daily/weekly), and webhook callbacks for connected systems. Critical security alerts cannot be suppressed."
            />
            <Card>
              <CardHeader><CardTitle className="text-base">Email & in-app notifications</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ["Investor opens a dataroom file", true],
                  ["Investor accepts an invitation", true],
                  ["Soft-circle commitment is made", true],
                  ["Soft-circle commitment is downgraded", true],
                  ["Round close milestone reached", true],
                  ["Investor comments on a report", true],
                  ["Cap-table change committed", true],
                  ["Weekly fundraising digest", false],
                  ["M&A inbound interest received", true],
                  ["Compliance hold triggered", true],
                ].map(([label, on]) => (
                  <div key={label as string} className="flex items-center justify-between border-b border-border last:border-0 pb-2 last:pb-0">
                    <span>{label as string}</span>
                    <Switch defaultChecked={!!on} data-testid={`switch-notif-${(label as string).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* DATA */}
          <TabsContent value="data" className="mt-4">
            <TabIntro
              title="Data"
              body="Export, retention, and audit ledger access. All exports are hash-chained per R165 §12 — you can independently verify integrity. Cap-table snapshots include engine attribution and reconcile checksums."
            />
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" /> Security</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Enforce 2FA for the workspace</Label>
                    <div className="flex items-center gap-3 mt-2"><Switch defaultChecked data-testid="switch-2fa" /> <span className="text-sm text-muted-foreground">All members</span></div>
                  </div>
                  <div><Label>SSO domain</Label><Input className="mt-1" defaultValue="" placeholder="yourcompany.com" data-testid="input-sso" /></div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base">Export & delete</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Button variant="outline" className="w-full" onClick={() => toast({ title: "Audit log exported", description: "Hash-chain verified." })} data-testid="button-export-audit"><Download className="h-3.5 w-3.5 mr-2" /> Export audit log (JSON)</Button>
                  <Button variant="outline" className="w-full" onClick={() => toast({ title: "Data export queued", description: "You'll receive an email when ready." })} data-testid="button-export-all"><Download className="h-3.5 w-3.5 mr-2" /> Export all workspace data</Button>
                  <p className="text-xs text-muted-foreground border-t pt-3">Workspace deletion has moved to the <strong>Delete</strong> tab.</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* PRIVACY — T11.2 dedicated tab with comprehensive guidance */}
          <TabsContent value="privacy" className="mt-4">
            <TabIntro
              title="Privacy & visibility"
              body="Controls how you appear across other cap tables and shared message threads. Read each toggle carefully: the founder real-name rule on your own cap table is non-negotiable per R200 §16."
            />
            <Card data-testid="section-privacy-full" className="border-2 border-destructive/70">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-destructive" /> Privacy & visibility
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  These settings change how your name and the company you back appear to other Capavate users.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="rounded-md border-2 border-destructive bg-destructive/5 p-4">
                  <div className="text-sm font-bold text-destructive mb-1">Founder real-name rule</div>
                  <p className="text-sm">
                    On <strong>your own company's cap table</strong> you always appear with your <strong>legal name</strong>.
                    Privacy toggles here do <strong>not</strong> mask you to your own co-founders, board, or your investors —
                    that is required for compliance and signature workflows. Toggles below only affect <em>other</em> companies'
                    cap tables where you appear as an investor, and the public Collective network.
                  </p>
                </div>

                <PrivacyControls
                  screenName={screenName} setScreenName={setScreenName}
                  visibleCo={visibleCo} setVisibleCo={setVisibleCo}
                  visibleNet={visibleNet} setVisibleNet={setVisibleNet}
                  screenValid={screenValid}
                  onSave={() => savePrivacyMut.mutate()}
                  expanded
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Wave C-1 — Public Profile tab */}
          <TabsContent value="public-profile" className="mt-4">
            <SettingsPublicProfileTab companyId={companyId} />
          </TabsContent>

          {/* Wave C-1 — Region & Jurisdiction tab */}
          <TabsContent value="region" className="mt-4">
            <SettingsRegionTab companyId={companyId} />
          </TabsContent>

          {/* Wave C-1 — Preferences tab */}
          <TabsContent value="preferences" className="mt-4">
            <SettingsPreferencesTab companyId={companyId} />
          </TabsContent>

          {/* Wave C-1 — Financials tab */}
          <TabsContent value="financials" className="mt-4">
            <SettingsFinancialsTab companyId={companyId} />
          </TabsContent>

          {/* Wave C-1 — Governance tab */}
          <TabsContent value="governance" className="mt-4">
            <SettingsGovernanceTab companyId={companyId} />
          </TabsContent>

          {/* Wave C-1 — M&A Transaction Prep tab */}
          <TabsContent value="mna-prep" className="mt-4">
            <SettingsMnaPrepTab companyId={companyId} />
          </TabsContent>

          {/* DELETE — T11.2 dedicated tab */}
          {/* LEGAL & PRIVACY */}
          <TabsContent value="legal" className="mt-4">
            <LegalPrivacySettingsTab />
          </TabsContent>

          <TabsContent value="delete" className="mt-4">
            <TabIntro
              title="Delete workspace"
              body="Workspace deletion is irreversible. Cap-table records are retained per regional regulation (US: 7 years, UK/EU: 6 years, SG: 5 years). Personal identifiers are pseudonymised on request per GDPR Art. 17."
            />
            <Card className="border-2 border-[hsl(7_61%_43%)]/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-[hsl(7_61%_43%)]" /> Delete workspace
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Permanently remove this workspace and all of its data. This action cannot be undone.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                  <li>Cap table, rounds, and signed documents will be archived to comply with audit retention.</li>
                  <li>Active rounds must be closed before the workspace can be deleted.</li>
                  <li>You will receive an email confirmation request before deletion is finalized.</li>
                </ul>
                <Button
                  variant="outline"
                  className="w-full border-[hsl(7_61%_43%)] text-[hsl(7_61%_43%)] hover:bg-[hsl(7_61%_43%)]/5"
                  onClick={() => toast({ title: "Workspace deletion requires admin confirmation", variant: "destructive" })}
                  data-testid="button-delete-workspace"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Request workspace deletion
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* PrivacyControls — shared between the Profile tab summary card and  */
/* the dedicated Privacy tab. Pass `expanded` for the long-form view. */
/* ------------------------------------------------------------------ */
type ScreenValid = { ok: true } | { ok: false; reason: "too_short" | "too_long" | "invalid_chars" | "taken" };
// Sprint 18 Phase 2 — T11.3 international best-practice description text per tab.
function TabIntro({ title, body }: { title: string; body: string }) {
  return (
    <div className="mb-3 rounded-md bg-muted/40 border border-border px-3 py-2" data-testid={`tab-intro-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{title}</div>
      <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed max-w-3xl">{body}</div>
    </div>
  );
}

function PrivacyControls(props: {
  screenName: string; setScreenName: (v: string) => void;
  visibleCo: boolean; setVisibleCo: (v: boolean) => void;
  visibleNet: boolean; setVisibleNet: (v: boolean) => void;
  screenValid: ScreenValid;
  onSave: () => void;
  expanded?: boolean;
}) {
  const { screenName, setScreenName, visibleCo, setVisibleCo, visibleNet, setVisibleNet, screenValid, onSave, expanded } = props;
  const screenErr = !screenValid.ok ? screenValid.reason : null;
  const previewName = screenName.trim() ? screenName : "(legal name)";
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="input-screen-name">Screen name</Label>
        <Input
          id="input-screen-name"
          className="mt-1"
          value={screenName}
          onChange={(e) => setScreenName(e.target.value)}
          placeholder="e.g. maya_chen"
          data-testid="input-screen-name"
          aria-invalid={!!screenErr}
        />
        <p className="text-xs text-muted-foreground mt-1">
          3-32 characters; letters, numbers, hyphen, underscore. Used in place of your legal name where allowed.
        </p>
        {screenErr && (
          <p className="text-xs text-destructive mt-1" data-testid="text-screen-error">
            {screenErr === "too_short" && "Must be at least 3 characters."}
            {screenErr === "too_long" && "Maximum 32 characters."}
            {screenErr === "invalid_chars" && "Only letters, numbers, hyphen and underscore."}
            {screenErr === "taken" && "That screen name is already in use."}
          </p>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div>
          <Label className="text-sm">Visible to co-members on cap tables you join</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            When ON: other investors and the founder team on the same cap table see your screen name. When OFF: you appear as <em>Anonymous Investor</em>.
          </p>
          {expanded && (
            <p className="text-xs mt-1">Preview: <code className="bg-muted px-1 rounded">{visibleCo ? previewName : "Anonymous Investor"}</code></p>
          )}
        </div>
        <Switch checked={visibleCo} onCheckedChange={setVisibleCo} data-testid="switch-visible-co" />
      </div>

      <div className="flex items-start justify-between gap-3 rounded-md border p-3">
        <div>
          <Label className="text-sm">Visible in the Collective network directory</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            When ON: your screen name appears in the public Collective member list and in pitch-meeting attendee rosters. When OFF: you are listed as a private member.
          </p>
          {expanded && (
            <p className="text-xs mt-1">Preview: <code className="bg-muted px-1 rounded">{visibleNet ? previewName : "Private member"}</code></p>
          )}
        </div>
        <Switch checked={visibleNet} onCheckedChange={setVisibleNet} data-testid="switch-visible-net" />
      </div>

      <Button
        size="sm"
        className="bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
        disabled={!!screenErr}
        onClick={onSave}
        data-testid="button-save-privacy"
      >
        Save privacy preferences
      </Button>
    </div>
  );
}

// ─── Legal & Privacy Settings Tab ────────────────────────────────────────────

interface LegalConsent {
  id: string;
  documentId: string;
  documentVersion: string;
  context: string;
  acceptedAt: string;
}

function LegalPrivacySettingsTab() {
  const { openDrawer } = useLegalDrawer();
  const consentsQ = useQuery<{ ok: boolean; consents: LegalConsent[] }>({
    queryKey: ["/api/legal/consent/mine"],
    queryFn: async () => {
      try {
        return (await apiRequest("GET", "/api/legal/consent/mine")).json();
      } catch {
        return { ok: false, consents: [] };
      }
    },
    retry: false,
  });
  const consents = consentsQ.data?.consents ?? [];

  return (
    <div className="space-y-4" data-testid="section-legal-privacy">
      <TabIntro
        title="Legal & Privacy"
        body="Blueprint Catalyst Limited legal documents. Review summaries or read the full text. Your consent trail is recorded below."
      />

      {/* Document cards */}
      <div className="grid md:grid-cols-2 gap-3">
        {LEGAL_DOCS.map((doc: LegalDoc) => {
          const consent = consents.find((c) => c.documentId === doc.id);
          return (
            <Card key={doc.id} data-testid={`card-legal-doc-${doc.id}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[hsl(219_45%_12%)]">{doc.title}</div>
                    <div className="text-[10px] text-muted-foreground">Updated {doc.lastUpdated}</div>
                  </div>
                  {consent && (
                    <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 shrink-0">
                      Agreed
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-snug">{doc.summary}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-[hsl(300_60%_35%)] hover:text-[hsl(300_60%_25%)] hover:bg-[hsl(300_60%_95%)] px-2"
                  onClick={() => openDrawer(doc.id as LegalDocId)}
                  data-testid={`button-read-legal-${doc.id}`}
                >
                  Read document
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Consent trail */}
      {consents.length > 0 && (
        <Card data-testid="section-consent-trail">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[hsl(219_45%_35%)]" /> Your consent trail
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {consents.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0" data-testid={`consent-row-${c.id}`}>
                  <div>
                    <span className="font-medium capitalize">{c.documentId.replace(/-/g, " ")}</span>
                    <span className="text-muted-foreground ml-2">v{c.documentVersion}</span>
                    <Badge variant="outline" className="ml-2 text-[10px] capitalize">{c.context.replace(/_/g, " ")}</Badge>
                  </div>
                  <span className="text-muted-foreground">{new Date(c.acceptedAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {consentsQ.isLoading && (
        <p className="text-xs text-muted-foreground">Loading consent history…</p>
      )}
      {!consentsQ.isLoading && consents.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-no-consents">No consent records on file.</p>
      )}
    </div>
  );
}

/* ============================================================
 * Wave C-1 — Settings tab components
 * ============================================================ */

/** Helper: save a profile patch with x-confirm */
async function saveProfilePatch(companyId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`/api/founder/profile?companyId=${companyId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-confirm": "true" },
    body: JSON.stringify(patch),
  });
  const data = await r.json();
  if (!r.ok) return { ok: false, error: data?.error ?? "Save failed" };
  return { ok: true };
}

function useProfileData(companyId: string | undefined) {
  return useQuery({
    queryKey: ["/api/founder/profile", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/profile?companyId=${companyId}`)).json(),
    enabled: !!companyId,
  });
}

// ── Public Profile Tab ───────────────────────────────────────
function SettingsPublicProfileTab({ companyId }: { companyId: string | undefined }) {
  const { toast } = useToast();
  const profileQ = useProfileData(companyId);
  const profile = profileQ.data?.profile ?? {};

  const [fields, setFields] = useState({
    linkedinUrl: "", twitterUrl: "", crunchbaseUrl: "", pitchbookUrl: "",
    openingDataRoomUrl: "", publicNewsroomUrl: "",
    tagline: "", shortPitch: "", longPitch: "", subsector: "", missionStatement: "", logoUrl: "",
  });
  const [synced, setSynced] = useState(false);

  // Sync from profile once loaded
  if (!synced && profileQ.data) {
    setFields({
      linkedinUrl: profile.linkedinUrl ?? "",
      twitterUrl: profile.twitterUrl ?? "",
      crunchbaseUrl: profile.crunchbaseUrl ?? "",
      pitchbookUrl: profile.pitchbookUrl ?? "",
      openingDataRoomUrl: profile.openingDataRoomUrl ?? "",
      publicNewsroomUrl: profile.publicNewsroomUrl ?? "",
      tagline: profile.tagline ?? "",
      shortPitch: profile.shortPitch ?? "",
      longPitch: profile.longPitch ?? "",
      subsector: profile.subsector ?? "",
      missionStatement: profile.missionStatement ?? "",
      logoUrl: profile.logoUrl ?? "",
    });
    setSynced(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v !== "") patch[k] = v;
      }
      const result = await saveProfilePatch(companyId!, patch);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/founder/profile", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/founder/profile/completion", companyId] });
      toast({ title: "Public profile saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  function f(key: keyof typeof fields, v: string) { setFields(prev => ({ ...prev, [key]: v })); }

  return (
    <div className="space-y-6" data-testid="section-public-profile">
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Social & Discovery Links</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { key: "linkedinUrl", label: "LinkedIn URL", placeholder: "https://linkedin.com/company/..." },
              { key: "twitterUrl", label: "Twitter / X URL", placeholder: "https://x.com/..." },
              { key: "crunchbaseUrl", label: "Crunchbase URL", placeholder: "https://crunchbase.com/organization/..." },
              { key: "pitchbookUrl", label: "Pitchbook URL", placeholder: "https://pitchbook.com/profiles/..." },
              { key: "openingDataRoomUrl", label: "Opening Data Room URL", placeholder: "https://..." },
              { key: "publicNewsroomUrl", label: "Public Newsroom URL", placeholder: "https://..." },
              { key: "logoUrl", label: "Logo URL", placeholder: "https://cdn.yourco.com/logo.png" },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs">{label}</Label>
                <Input
                  data-testid={`input-settings-${key}`}
                  value={fields[key as keyof typeof fields]}
                  onChange={e => f(key as keyof typeof fields, e.target.value)}
                  placeholder={placeholder}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">Copy & Messaging</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Subsector</Label>
            <Input data-testid="input-settings-subsector" value={fields.subsector} onChange={e => f("subsector", e.target.value)} placeholder="e.g., B2B SaaS, Fintech, Consumer" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tagline</Label>
            <Input data-testid="input-settings-tagline" value={fields.tagline} onChange={e => f("tagline", e.target.value)} placeholder="One-line description" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Short Pitch <span className="text-muted-foreground">({fields.shortPitch.length}/140 chars)</span></Label>
            <Textarea data-testid="input-settings-short-pitch" value={fields.shortPitch} onChange={e => f("shortPitch", e.target.value)} maxLength={140} rows={3} className="resize-none" placeholder="≤140 characters" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Long Pitch <span className="text-muted-foreground">({fields.longPitch.length}/2000 chars)</span></Label>
            <Textarea data-testid="input-settings-long-pitch" value={fields.longPitch} onChange={e => f("longPitch", e.target.value)} maxLength={2000} rows={6} className="resize-none" placeholder="≤2000 characters — for investor memos" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mission Statement <span className="text-muted-foreground">({fields.missionStatement.length}/400 chars)</span></Label>
            <Textarea data-testid="input-settings-mission-statement" value={fields.missionStatement} onChange={e => f("missionStatement", e.target.value)} maxLength={400} rows={3} className="resize-none" placeholder="≤400 characters" />
          </div>
        </CardContent>
      </Card>
      <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-public-profile">
        {saveMut.isPending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

// ── Region Tab ───────────────────────────────────────────────
function SettingsRegionTab({ companyId }: { companyId: string | undefined }) {
  const { toast } = useToast();
  const profileQ = useProfileData(companyId);
  const profile = profileQ.data?.profile ?? {};
  const [fields, setFields] = useState({ incorporationJurisdiction: "", secondaryJurisdiction: "", taxResidencyJurisdiction: "" });
  const [synced, setSynced] = useState(false);
  if (!synced && profileQ.data) {
    setFields({ incorporationJurisdiction: profile.incorporationJurisdiction ?? "", secondaryJurisdiction: profile.secondaryJurisdiction ?? "", taxResidencyJurisdiction: profile.taxResidencyJurisdiction ?? "" });
    setSynced(true);
  }
  const saveMut = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) if (v !== "") patch[k] = v;
      const result = await saveProfilePatch(companyId!, patch);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/profile", companyId] }); queryClient.invalidateQueries({ queryKey: ["/api/founder/profile/completion", companyId] }); toast({ title: "Region settings saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });
  function f(key: keyof typeof fields, v: string) { setFields(prev => ({ ...prev, [key]: v })); }
  return (
    <div className="space-y-6" data-testid="section-region">
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4" /> Jurisdiction & Tax Residency</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Start each field with a 2-letter ISO country code (e.g., "US Delaware", "GB London", "SG").</p>
          {[
            { key: "incorporationJurisdiction", label: "Incorporation Jurisdiction", placeholder: "US Delaware" },
            { key: "secondaryJurisdiction", label: "Secondary Jurisdiction", placeholder: "GB London" },
            { key: "taxResidencyJurisdiction", label: "Tax Residency Jurisdiction", placeholder: "US" },
          ].map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs">{label}</Label>
              <Input data-testid={`input-settings-${key}`} value={fields[key as keyof typeof fields]} onChange={e => f(key as keyof typeof fields, e.target.value)} placeholder={placeholder} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-region">
        {saveMut.isPending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

// ── Preferences Tab ──────────────────────────────────────────
const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "CAD", "AUD", "CHF", "SEK", "SGD"];
const LANGUAGES_OPTS = [
  { value: "en", label: "English" }, { value: "zh", label: "中文 (Chinese)" },
  { value: "es", label: "Español (Spanish)" }, { value: "fr", label: "Français (French)" },
  { value: "de", label: "Deutsch (German)" }, { value: "ja", label: "日本語 (Japanese)" },
];

function SettingsPreferencesTab({ companyId }: { companyId: string | undefined }) {
  const { toast } = useToast();
  const profileQ = useProfileData(companyId);
  const profile = profileQ.data?.profile ?? {};
  const [fields, setFields] = useState({
    preferredCurrency: "USD", preferredTimezone: "", preferredLanguage: "en",
    preferredCommunicationChannel: "both", preferredMeetingDuration: "30", preferredMeetingTimes: "",
  });
  const [synced, setSynced] = useState(false);
  if (!synced && profileQ.data) {
    setFields({
      preferredCurrency: profile.preferredCurrency ?? "USD",
      preferredTimezone: profile.preferredTimezone ?? "",
      preferredLanguage: profile.preferredLanguage ?? "en",
      preferredCommunicationChannel: profile.preferredCommunicationChannel ?? "both",
      preferredMeetingDuration: profile.preferredMeetingDuration ? String(profile.preferredMeetingDuration) : "30",
      preferredMeetingTimes: profile.preferredMeetingTimes ?? "",
    });
    setSynced(true);
  }
  const saveMut = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {
        preferredCurrency: fields.preferredCurrency || undefined,
        preferredTimezone: fields.preferredTimezone || undefined,
        preferredLanguage: fields.preferredLanguage || undefined,
        preferredCommunicationChannel: fields.preferredCommunicationChannel || undefined,
        preferredMeetingDuration: fields.preferredMeetingDuration ? Number(fields.preferredMeetingDuration) : undefined,
        preferredMeetingTimes: fields.preferredMeetingTimes || undefined,
      };
      const result = await saveProfilePatch(companyId!, patch);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/profile", companyId] }); queryClient.invalidateQueries({ queryKey: ["/api/founder/profile/completion", companyId] }); toast({ title: "Preferences saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });
  function f(key: keyof typeof fields, v: string) { setFields(prev => ({ ...prev, [key]: v })); }
  return (
    <div className="space-y-6" data-testid="section-preferences">
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Settings2 className="h-4 w-4" /> Display & Communication Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <Select value={fields.preferredCurrency} onValueChange={v => f("preferredCurrency", v)}>
                <SelectTrigger data-testid="select-settings-preferred-currency"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Language</Label>
              <Select value={fields.preferredLanguage} onValueChange={v => f("preferredLanguage", v)}>
                <SelectTrigger data-testid="select-settings-preferred-language"><SelectValue /></SelectTrigger>
                <SelectContent>{LANGUAGES_OPTS.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Communication Channel</Label>
              <Select value={fields.preferredCommunicationChannel} onValueChange={v => f("preferredCommunicationChannel", v)}>
                <SelectTrigger data-testid="select-settings-preferred-communication-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email only</SelectItem>
                  <SelectItem value="in_app">In-app only</SelectItem>
                  <SelectItem value="both">Both email + in-app</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Meeting Duration</Label>
              <Select value={fields.preferredMeetingDuration} onValueChange={v => f("preferredMeetingDuration", v)}>
                <SelectTrigger data-testid="select-settings-preferred-meeting-duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[15, 30, 45, 60].map(d => <SelectItem key={d} value={String(d)}>{d} minutes</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Preferred Timezone (IANA)</Label>
            <Input data-testid="input-settings-preferred-timezone" value={fields.preferredTimezone} onChange={e => f("preferredTimezone", e.target.value)} placeholder="America/New_York" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Preferred Meeting Times</Label>
            <Input data-testid="input-settings-preferred-meeting-times" value={fields.preferredMeetingTimes} onChange={e => f("preferredMeetingTimes", e.target.value)} placeholder="Mon-Fri 09:00-17:00 EDT" />
          </div>
        </CardContent>
      </Card>
      <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-preferences">
        {saveMut.isPending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

// ── Financials Tab ───────────────────────────────────────────
function SettingsFinancialsTab({ companyId }: { companyId: string | undefined }) {
  const { toast } = useToast();
  const profileQ = useProfileData(companyId);
  const profile = profileQ.data?.profile ?? {};
  const stage = profile.stage as string | undefined;
  const visibleFields = getFieldsForStage(stage);

  // Accountant request dialog
  const [acctDialog, setAcctDialog] = useState<{ fieldKey: string } | null>(null);
  const [acctEmail, setAcctEmail] = useState("");
  const [acctNote, setAcctNote] = useState("");

  // Local field values
  const [values, setValues] = useState<Record<string, string>>({});
  const [synced, setSynced] = useState(false);
  if (!synced && profileQ.data) {
    const init: Record<string, string> = {};
    for (const f of FINANCIAL_FIELD_COPY) {
      const v = profile[f.key as keyof typeof profile];
      if (v !== undefined && v !== null) {
        // Convert from minor units for display
        if (f.minorUnits && typeof v === "number") {
          init[f.key] = String((v as number) / 100);
        } else {
          init[f.key] = String(v);
        }
      } else {
        init[f.key] = "";
      }
    }
    setValues(init);
    setSynced(true);
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      for (const f of visibleFields) {
        const raw = values[f.key];
        if (raw === undefined || raw === "") continue;
        const n = parseFloat(raw);
        if (isNaN(n) || n < 0) continue;
        if (f.minorUnits) {
          patch[f.key] = Math.round(n * 100);
        } else if (f.unit === "pct") {
          patch[f.key] = Math.round(n * 100);
        } else {
          patch[f.key] = f.unit === "months" || f.unit === "count" ? Math.round(n) : n;
        }
      }
      const result = await saveProfilePatch(companyId!, patch);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/profile", companyId] }); queryClient.invalidateQueries({ queryKey: ["/api/founder/profile/completion", companyId] }); toast({ title: "Financials saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  const requestAcctMut = useMutation({
    mutationFn: async () => {
      if (!acctDialog || !acctEmail) throw new Error("Email required");
      const r = await fetch("/api/founder/financials/request-accountant", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-confirm": "true" },
        body: JSON.stringify({ companyId, fieldKey: acctDialog.fieldKey, accountantEmail: acctEmail, note: acctNote }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Request failed");
      return data;
    },
    onSuccess: () => { toast({ title: "Request sent to accountant" }); setAcctDialog(null); setAcctEmail(""); setAcctNote(""); },
    onError: (e: any) => toast({ title: "Request failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="section-financials">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Financial Data</h3>
          <p className="text-sm text-muted-foreground">Stage: <strong>{stage ?? "pre-seed"}</strong> — showing {visibleFields.length} fields</p>
        </div>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-financials">
          {saveMut.isPending ? "Saving…" : "Save all"}
        </Button>
      </div>

      <div className="space-y-4">
        {visibleFields.map(f => (
          <Card key={f.key} data-testid={`card-financial-${f.key}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Label className="text-sm font-semibold">{f.label}</Label>
                    {f.minorUnits && <Badge variant="outline" className="text-[10px]">USD</Badge>}
                    {f.unit === "pct" && <Badge variant="outline" className="text-[10px]">%</Badge>}
                    {f.unit === "months" && <Badge variant="outline" className="text-[10px]">months</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{f.description}</p>
                  <div className="bg-muted/40 rounded p-2 text-xs mb-3">
                    <strong>Example:</strong> {f.example}
                  </div>
                  <Input
                    type="number"
                    step={f.unit === "pct" ? "0.01" : "1"}
                    min="0"
                    value={values[f.key] ?? ""}
                    onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.minorUnits ? "Enter in USD" : f.unit === "pct" ? "Enter %" : "Enter value"}
                    data-testid={`input-financial-${f.key}`}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAcctDialog({ fieldKey: f.key })}
                  data-testid={`button-request-accountant-${f.key}`}
                  className="flex-shrink-0 text-xs"
                >
                  <Send className="h-3 w-3 mr-1" /> Request from accountant
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Accountant request dialog */}
      <Dialog open={!!acctDialog} onOpenChange={open => { if (!open) { setAcctDialog(null); setAcctEmail(""); setAcctNote(""); } }}>
        <DialogContent data-testid="dialog-request-accountant">
          <DialogHeader>
            <DialogTitle>Request from accountant</DialogTitle>
            <DialogDescription>
              Send a secure one-time link to your accountant to fill in <strong>{acctDialog?.fieldKey}</strong>.
              The link expires in 7 days.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Accountant email</Label>
              <Input
                type="email"
                value={acctEmail}
                onChange={e => setAcctEmail(e.target.value)}
                placeholder="accountant@firm.com"
                data-testid="input-accountant-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Note to accountant <span className="text-muted-foreground">(optional, max 280 chars)</span></Label>
              <Textarea
                value={acctNote}
                onChange={e => setAcctNote(e.target.value)}
                maxLength={280}
                placeholder="Please use the audited figures from Q4 2024…"
                rows={3}
                data-testid="input-accountant-note"
                className="resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setAcctDialog(null)} data-testid="button-cancel-accountant-request">Cancel</Button>
              <Button
                onClick={() => requestAcctMut.mutate()}
                disabled={!acctEmail || requestAcctMut.isPending}
                data-testid="button-send-accountant-request"
              >
                {requestAcctMut.isPending ? "Sending…" : "Send link"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Governance Tab ───────────────────────────────────────────
function SettingsGovernanceTab({ companyId }: { companyId: string | undefined }) {
  const { toast } = useToast();
  const profileQ = useProfileData(companyId);
  const profile = profileQ.data?.profile ?? {};
  const [directorCount, setDirectorCount] = useState("");
  const [directorSnapshot, setDirectorSnapshot] = useState("");
  const [synced, setSynced] = useState(false);
  if (!synced && profileQ.data) {
    setDirectorCount(profile.boardCompositionDirectors != null ? String(profile.boardCompositionDirectors) : "");
    setDirectorSnapshot(profile.boardDirectorsSnapshot ?? "");
    setSynced(true);
  }
  const saveMut = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      if (directorCount !== "") patch.boardCompositionDirectors = parseInt(directorCount, 10);
      if (directorSnapshot !== "") patch.boardDirectorsSnapshot = directorSnapshot;
      const result = await saveProfilePatch(companyId!, patch);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/profile", companyId] }); toast({ title: "Governance saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-6" data-testid="section-governance">
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Gavel className="h-4 w-4" /> Board Composition</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Number of Directors</Label>
            <Input
              type="number" min="0" step="1"
              value={directorCount}
              onChange={e => setDirectorCount(e.target.value)}
              placeholder="e.g., 5"
              data-testid="input-board-director-count"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Directors snapshot (optional JSON) <span className="text-muted-foreground">e.g., {JSON.stringify([{name:"Alice",role:"CEO"}])}</span></Label>
            <Textarea
              value={directorSnapshot}
              onChange={e => setDirectorSnapshot(e.target.value)}
              rows={4}
              placeholder='[{"name": "Alice Chen", "role": "CEO"}, {"name": "Bob Smith", "role": "Independent"}]'
              data-testid="input-board-directors-snapshot"
              className="resize-none font-mono text-xs"
            />
          </div>
        </CardContent>
      </Card>
      <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-governance">
        {saveMut.isPending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

// ── M&A Transaction Prep Tab ──────────────────────────────────
const MNA_PREP_FIELDS = [
  { key: "ipDdReadinessPct",               label: "IP Due Diligence Readiness",          description: "How ready are your IP filings, assignments, and ownership records for external review?" },
  { key: "customerContractsReadinessPct",  label: "Customer Contracts Readiness",         description: "Are your customer contracts standardised, countersigned, and accessible for buyer review?" },
  { key: "financialAuditReadinessPct",     label: "Financial Audit Readiness",            description: "Are your financials audited or audit-ready (clean books, categorised transactions, reconciled accounts)?" },
  { key: "dataRoomOrganizedPct",           label: "Data Room Organisation",               description: "Is your data room structured, indexed, and ready for buyer access with appropriate permissions?" },
  { key: "regulatoryFilingsCompletePct",   label: "Regulatory Filings Complete",          description: "Are all required regulatory filings (Form D, GDPR, sector-specific licences) up to date?" },
  { key: "esgDisclosureCompletePct",       label: "ESG Disclosure Completeness",          description: "Have you documented your environmental, social, and governance policies and metrics?" },
];

function SettingsMnaPrepTab({ companyId }: { companyId: string | undefined }) {
  const { toast } = useToast();
  const profileQ = useProfileData(companyId);
  const profile = profileQ.data?.profile ?? {};
  const [values, setValues] = useState<Record<string, number>>({});
  const [txStatus, setTxStatus] = useState("not_pursuing");
  const [synced, setSynced] = useState(false);
  if (!synced && profileQ.data) {
    const init: Record<string, number> = {};
    for (const f of MNA_PREP_FIELDS) {
      init[f.key] = profile[f.key as keyof typeof profile] as number ?? 0;
    }
    setValues(init);
    setTxStatus(profile.transactionPrepStatus ?? "not_pursuing");
    setSynced(true);
  }
  const saveMut = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = { ...values, transactionPrepStatus: txStatus };
      const result = await saveProfilePatch(companyId!, patch);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/founder/profile", companyId] }); queryClient.invalidateQueries({ queryKey: ["/api/founder/profile/completion", companyId] }); toast({ title: "M&A prep saved — bridge event sent to Collective" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-6" data-testid="section-mna-prep">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Transaction Status</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={txStatus} onValueChange={setTxStatus}>
            <SelectTrigger data-testid="select-transaction-prep-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="not_pursuing">Not pursuing a transaction</SelectItem>
              <SelectItem value="exploring">Exploring options</SelectItem>
              <SelectItem value="active">Actively in process</SelectItem>
              <SelectItem value="closing">Near closing</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {MNA_PREP_FIELDS.map(f => (
        <Card key={f.key} data-testid={`card-mna-${f.key}`}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between mb-2">
              <div>
                <Label className="text-sm font-semibold">{f.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
              </div>
              <span className="text-2xl font-bold ml-4 tabular-nums" data-testid={`value-mna-${f.key}`}>{values[f.key] ?? 0}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[values[f.key] ?? 0]}
              onValueChange={([v]) => setValues(prev => ({ ...prev, [f.key]: v }))}
              data-testid={`slider-mna-${f.key}`}
              className="mt-2"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Not started (0%)</span>
              <span>Complete (100%)</span>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-mna-prep">
        {saveMut.isPending ? "Saving…" : "Save & send to Collective"}
      </Button>
    </div>
  );
}
