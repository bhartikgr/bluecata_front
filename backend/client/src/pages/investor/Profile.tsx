/**
 * Sprint 8 — Investor Profile (3-step wizard, full live-Capavate parity).
 * Sprint 21 Wave E — enhancements:
 *   E2. Screen Name + Privacy merged red-border card with extensive guidance
 *   E3. Cascading Country → State → City picker (CountryStateCityPicker)
 *   E4. Phone country-code auto-update when country changes
 *   E5. Inline note examples with interest-specific placeholders
 *
 * Source of truth: capavate_investor_deep_audit.md §1-§3 + R200.gating §6.
 *
 * The wizard hits the production-shape PATCH endpoints in
 * `server/profileStore.ts` and emits `investor.profile.updated`,
 * `privacy.visibility.changed`, `investor.accreditation.changed`,
 * `investor.kyc.uploaded` events to the outbox per the Capavate ↔
 * Collective sync schema (see `capavate_collective_sync_schema.md` §4).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { PageBody, PageHeader } from "@/components/AppShell";
import { CollectiveDeepLink } from "@/components/CollectiveDeepLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HelpTip } from "@/components/HelpTip";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Briefcase, Building2, Check, CheckCircle2,
  Eye, FileText, Save, Shield, ShieldCheck, Target, Upload, User,
} from "lucide-react";
import { CountryPicker, PhoneCountryPicker } from "@/components/profile/CountryPicker";
import { CountryStateCityPicker } from "@/components/profile/CountryStateCityPicker";
import { resolveDialCode } from "@/components/profile/CountryStateCityPicker";
import { ChipMultiSelect, YesNoRadio } from "@/components/profile/ChipMultiSelect";
import {
  INVESTOR_TYPE_OPTIONS, ACCREDITED_STATUS_OPTIONS,
  INDUSTRY_EXPERTISE_OPTIONS, CHEQUE_SIZE_OPTIONS, GEOGRAPHY_FOCUS_OPTIONS,
  PREFERRED_STAGE_OPTIONS, HANDS_ON_OPTIONS, MA_INTEREST_OPTIONS, INVESTMENT_INTEREST_OPTIONS,
} from "@/lib/profile/data/enums";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { InvestorProfile } from "@/lib/profile/types";
import { screenNameSchema, deriveInvestorKycVariant } from "@/lib/profile/types";
import { AccreditationForm } from "@/components/AccreditationForm";
import { useEntitlement } from "@/lib/entitlement";

const STEPS = [
  { id: 1, title: "Contact Info", icon: User, description: "Name, role, contact" },
  { id: 2, title: "Investor Profile", icon: Briefcase, description: "Type, accreditation, KYC" },
  { id: 3, title: "Network Profile", icon: Target, description: "Thesis, interests, privacy" },
] as const;

/**
 * Map of investment interest values to concrete inline-note placeholder text.
 * Used in E5 to give investors focused examples when describing their thesis.
 */
const INTEREST_PLACEHOLDER_MAP: Record<string, string> = {
  fintech: "e.g. 'Particularly excited by embedded-finance + B2B payments'",
  healthtech: "e.g. 'Looking for clinical-grade AI + telehealth'",
  "ai/ml": "e.g. 'Foundation model deployment + agentic systems'",
  ai_ml: "e.g. 'Foundation model deployment + agentic systems'",
  climate: "e.g. 'Hard-tech, carbon removal, grid software'",
  consumer: "e.g. 'D2C health & wellness with strong retention'",
  "enterprise saas": "e.g. 'Vertical SaaS for SMB + AI-native workflows'",
  enterprise_saas: "e.g. 'Vertical SaaS for SMB + AI-native workflows'",
  web3: "e.g. 'Real-world asset tokenization + DeFi infra'",
  deeptech: "e.g. 'Quantum, robotics, advanced materials'",
  proptech: "e.g. 'Construction tech + smart-city infra'",
  legaltech: "e.g. 'AI-driven contract review + compliance automation'",
};

function getInterestPlaceholder(optionLabel: string, optionValue: string): string {
  const key = optionValue.toLowerCase();
  const labelKey = optionLabel.toLowerCase();
  return (
    INTEREST_PLACEHOLDER_MAP[key] ??
    INTEREST_PLACEHOLDER_MAP[labelKey] ??
    "e.g. add any specific subdomain or thesis-relevant notes"
  );
}

export default function Profile() {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // DEF-005: derive userId from session; block profile operations until resolved.
  const { data: entCtx, isLoading: entLoading } = useEntitlement();
  const INVESTOR_ID = entCtx?.userId;

  const { data: profile, isLoading: profileLoading, isError } = useQuery<InvestorProfile>({
    queryKey: ["/api/investors", INVESTOR_ID, "profile"],
    enabled: !!INVESTOR_ID,
  });

  // v24.1 Bug E: while we are genuinely still loading, show the skeleton.
  if (entLoading || !INVESTOR_ID || profileLoading) {
    return (
      <>
        <PageHeader title="Investor profile" description="Loading…" />
        <PageBody>
          <div className="space-y-3">
            <div className="h-6 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-72 bg-muted animate-pulse rounded" />
            <div className="h-4 w-60 bg-muted animate-pulse rounded" />
          </div>
        </PageBody>
      </>
    );
  }

  // v24.1 Bug E: render a real error state instead of an INFINITE skeleton when
  // the query resolved but returned no profile (getQueryFn maps non-2xx to null).
  // After the v24.1 synthesis fix this 404 should not happen for the
  // authenticated investor, but we no longer trap the user in a loading spinner.
  if (isError || !profile) {
    return (
      <>
        <PageHeader title="Investor profile" description="We couldn't load your profile" />
        <PageBody>
          <div className="max-w-md space-y-3" data-testid="profile-error">
            <p className="text-sm text-muted-foreground">
              We couldn't load your investor profile right now. This can happen if
              your account is still being set up. Please refresh the page, and if the
              problem persists, contact your administrator.
            </p>
            <button
              type="button"
              className="text-sm font-medium underline hover:text-foreground"
              onClick={() => window.location.reload()}
            >
              Refresh
            </button>
          </div>
        </PageBody>
      </>
    );
  }

  return <InvestorWizard profile={profile} step={step} setStep={setStep} toast={toast} />;
}

function InvestorWizard({
  profile, step, setStep, toast,
}: {
  profile: InvestorProfile;
  step: 1 | 2 | 3;
  setStep: (s: 1 | 2 | 3) => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const [role, setRole] = useState(profile.role);
  const [contact, setContact] = useState(profile.contact);
  const [coreProfile, setCoreProfile] = useState(profile.profile);
  const [network, setNetwork] = useState(profile.network);
  const [visibility, setVisibility] = useState(profile.visibility);
  const [savedAt, setSavedAt] = useState<Date | null>(new Date(profile.updatedAt));

  // Re-derive KYC variant whenever the country of tax residency changes.
  useEffect(() => {
    const v = deriveInvestorKycVariant(coreProfile.countryOfTaxResidencyCode);
    if (v !== coreProfile.kycVariant) setCoreProfile((p) => ({ ...p, kycVariant: v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreProfile.countryOfTaxResidencyCode]);

  // Keep visibility.screenNameSet in sync with role.screenName.
  useEffect(() => {
    const set = ((role.screenName ?? "").trim().length > 0);
    if (set !== visibility.screenNameSet) setVisibility((v) => ({ ...v, screenNameSet: set }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.screenName]);

  const patchMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const r = await apiRequest("PATCH", `/api/investors/${profile.id}/profile`, patch);
      return r.json();
    },
    onSuccess: () => {
      setSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ["/api/investors", profile.id, "profile"] });
      // The investor's screen name affects every cap-table view they're on.
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueAutosave = (patch: Record<string, unknown>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => patchMutation.mutate(patch), 800);
  };

  const updateRole = (n: typeof role) => { setRole(n); queueAutosave({ role: n }); };
  const updateContact = (n: typeof contact) => { setContact(n); queueAutosave({ contact: n }); };
  const updateCore = (n: typeof coreProfile) => { setCoreProfile(n); queueAutosave({ profile: n }); };
  const updateNetwork = (n: typeof network) => { setNetwork(n); queueAutosave({ network: n }); };
  const updateVisibility = (n: typeof visibility) => { setVisibility(n); queueAutosave({ visibility: n }); };

  const saveDraft = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    patchMutation.mutate({ role, contact, profile: coreProfile, network, visibility });
    toast({ title: "Saved", description: "Investor profile draft saved." });
  };

  const goNext = () => setStep((s) => (Math.min(3, s + 1) as 1 | 2 | 3));
  const goBack = () => setStep((s) => (Math.max(1, s - 1) as 1 | 2 | 3));

  return (
    <>
      <PageHeader
        title="Investor profile"
        description="Complete your profile so founders see verified, accredited details."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Profile" }]}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" data-testid="badge-kyc-variant">KYC: {coreProfile.kycVariant}</Badge>
            {coreProfile.accreditationVerified ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-300/40" data-testid="badge-accred-verified">
                <ShieldCheck className="h-3 w-3 mr-1" /> Verified
              </Badge>
            ) : (
              <Badge variant="outline" data-testid="badge-accred-pending">Re-verification pending</Badge>
            )}
            {/* Defect 49: use profile.id not hardcoded string */}
            <CollectiveDeepLink entity="investor" id={profile.id} label="View Collective Member Profile" />
          </div>
        }
      />
      <PageBody>
        <Card className="mb-5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-medium" data-testid="text-step-position">
                Step {step} of 3 · {STEPS[step - 1].title}
              </div>
              <div className="text-xs text-muted-foreground" data-testid="text-saved-at">
                {patchMutation.isPending ? "Saving…" : savedAt ? `Saved · ${savedAt.toLocaleTimeString()}` : "Not yet saved"}
              </div>
            </div>
            <Progress value={(step / 3) * 100} className="h-1.5 mb-3" />
            <ol className="flex items-stretch gap-2 overflow-x-auto pb-1">
              {STEPS.map((s) => {
                const Icon = s.icon;
                const active = s.id === step;
                const done = s.id < step;
                return (
                  <li key={s.id} className="flex-1 min-w-[180px]">
                    <button
                      type="button"
                      onClick={() => setStep(s.id as 1 | 2 | 3)}
                      data-testid={`step-button-${s.id}`}
                      className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 rounded-md border transition ${
                        active ? "border-primary bg-primary/10"
                        : done ? "border-emerald-300/70 bg-emerald-50 "
                        : "border-border hover:bg-secondary"
                      }`}
                    >
                      <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${
                        active ? "bg-primary text-primary-foreground"
                        : done ? "bg-emerald-500 text-white"
                        : "bg-secondary text-muted-foreground"
                      }`}>
                        {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-medium truncate">{s.title}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{s.description}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        {step === 1 && (
          <Step1Contact
            role={role}
            contact={contact}
            visibility={visibility}
            onRole={updateRole}
            onContact={updateContact}
            onVisibility={updateVisibility}
          />
        )}
        {step === 2 && <Step2Profile value={coreProfile} onChange={updateCore} investorId={profile.id} toast={toast} />}
        {step === 3 && (
          <Step3Network
            network={network}
            onNetwork={updateNetwork}
          />
        )}

        <div className="flex items-center justify-between mt-6">
          <Button variant="outline" onClick={goBack} disabled={step === 1} data-testid="button-step-back">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={saveDraft} data-testid="button-save-draft">
              <Save className="h-4 w-4 mr-1.5" /> Save draft
            </Button>
            {step < 3 ? (
              <Button onClick={goNext} data-testid="button-step-continue">
                Continue <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            ) : (
              <Button
                onClick={() => { saveDraft(); toast({ title: "Profile saved", description: "Investor profile saved. Privacy + accreditation updates queued." }); }}
                data-testid="button-save-profile"
              >
                <Check className="h-4 w-4 mr-1.5" /> Save profile
              </Button>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}

/* ---------- STEP 1 ---------- */
function Step1Contact({
  role, contact, visibility, onRole, onContact, onVisibility,
}: {
  role: InvestorProfile["role"];
  contact: InvestorProfile["contact"];
  visibility: InvestorProfile["visibility"];
  onRole: (n: InvestorProfile["role"]) => void;
  onContact: (n: InvestorProfile["contact"]) => void;
  onVisibility: (n: InvestorProfile["visibility"]) => void;
}) {
  const setR = <K extends keyof InvestorProfile["role"]>(k: K, v: InvestorProfile["role"][K]) => onRole({ ...role, [k]: v });
  const setC = <K extends keyof InvestorProfile["contact"]>(k: K, v: InvestorProfile["contact"][K]) => onContact({ ...contact, [k]: v });

  const screenNameVal = (role.screenName ?? "").toString();
  const snParse = screenNameVal.length === 0 ? null : screenNameSchema.safeParse(screenNameVal);

  /**
   * E4: track whether the user has manually overridden the phone dial code.
   * If they haven't touched it since the last country change, auto-update.
   */
  const [dialCodeManuallySet, setDialCodeManuallySet] = useState(false);

  const handleCountryStateCityChange = (next: { countryCode: string; stateProvince: string; city: string }) => {
    onContact({ ...contact, countryCode: next.countryCode, stateProvince: next.stateProvince, city: next.city });
  };

  const handleDialCodeChange = (dialCode: string) => {
    if (!dialCodeManuallySet) {
      // Find the country code that corresponds to this dial code and auto-set
      // The dial code comes from REGIONS — we use the country code directly
      setC("mobileCountryCode", dialCode.replace(/^\+/, ""));
    }
  };

  const handleManualDialCodeChange = (code: string) => {
    setDialCodeManuallySet(true);
    setC("mobileCountryCode", code);
  };

  // Reset the "manually set" flag when the country changes (new selection resets auto-follow)
  const prevCountry = useRef(contact.countryCode);
  useEffect(() => {
    if (contact.countryCode !== prevCountry.current) {
      prevCountry.current = contact.countryCode;
      setDialCodeManuallySet(false);
      // Auto-apply dial code for new country
      const dc = resolveDialCode(contact.countryCode);
      if (dc) {
        const stripped = dc.replace(/^\+/, "");
        onContact({ ...contact, mobileCountryCode: stripped });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.countryCode]);

  return (
    <div className="space-y-5">
      {/* ----------------------------------------------------------------
          E2 — Screen Name + Privacy MERGED card with red border
          ---------------------------------------------------------------- */}
      <div
        className="border-2 border-destructive rounded-xl p-6 bg-destructive/5"
        data-testid="section-screen-name-privacy"
      >
        {/* Header callout */}
        <div className="flex items-start gap-3 mb-5">
          <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <div className="text-base font-semibold text-destructive leading-tight">
              Your screen name &amp; privacy — set carefully
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              These choices propagate everywhere on Capavate AND the Collective network.
              Other investors and founders will see you based on these settings.
            </p>
          </div>
        </div>

        {/* Extensive guidance — ≥6 prose lines */}
        <div className="rounded-md border border-destructive/30 bg-background p-4 space-y-2 mb-6 text-sm leading-relaxed">
          <p>
            <span className="font-semibold">Screen name OFF →</span> you appear as{" "}
            <code className="bg-muted px-1 rounded text-xs">[Anonymous Holder]</code> to anyone
            who is NOT on the same cap table as you. Founders and co-investors cannot identify
            you by name in the network directory or in soft-circle lists.
          </p>
          <p>
            <span className="font-semibold">Screen name ON →</span> other investors and founders
            see your chosen screen name on shared cap tables, in network posts, and on
            co-soft-circle lists. Choose a handle that you are comfortable being associated with
            across multiple companies and rounds.
          </p>
          <p>
            <span className="font-semibold">Cap-table visibility — "Visible to co-members" →</span>{" "}
            other holders of the same security can see you by your screen name. Note that the
            founder real-name rule still applies for founders on their own cap table — they
            always appear with their legal name.
          </p>
          <p>
            <span className="font-semibold">Collective network visibility →</span> only members
            of your Collective chapter can see your screen name, expertise, and activity. This
            is independent of cap-table visibility and can be toggled separately.
          </p>
          <p>
            <span className="font-semibold">DM eligibility →</span> you can only receive direct
            messages from cap-table co-members OR Collective chapter co-members, per your settings
            below. Turning both toggles off disables inbound DMs entirely while keeping your
            cap-table records intact.
          </p>
          <p>
            <span className="font-semibold">Privacy settings apply RETROACTIVELY —</span> changing
            them updates all visible-by views within seconds. If you turn off co-member visibility,
            existing threads are not deleted but your identity is masked immediately in new views.
          </p>
        </div>

        {/* Screen name input */}
        <div className="space-y-1.5 mb-6">
          <Label className="flex items-center gap-1">
            Screen Name <span className="text-muted-foreground font-normal">(optional)</span>
            <HelpTip>Visible to all cap-table co-members. 3–30 chars, letters / digits / underscore / dash. Your portfolio companies always see your real name.</HelpTip>
          </Label>
          <Input
            value={screenNameVal}
            onChange={(e) => setR("screenName", e.target.value || null)}
            placeholder="e.g. GreenwoodCap"
            data-testid="input-screen-name"
            className={snParse && !snParse.success ? "border-destructive ring-1 ring-destructive" : ""}
          />
          {snParse && !snParse.success && (
            <div className="text-xs text-rose-600" data-testid="text-screen-name-error">
              {snParse.error.issues[0].message}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground">
            This is shown across cap tables, posts, and DMs. · 3–30 chars · letters, digits, underscore, dash only.
          </div>
        </div>

        {/* Privacy toggles — grouped within the same card */}
        <div className="space-y-3" data-testid="privacy-toggles">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Visibility settings
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-background p-3">
            <div>
              <div className="text-sm font-medium">Visible to cap-table co-members</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                When ON, others on cap tables you share can find you by your screen name.
                Default OFF.
              </p>
            </div>
            <Switch
              checked={visibility.visibleToCoMembers}
              onCheckedChange={(v) => onVisibility({ ...visibility, visibleToCoMembers: v })}
              data-testid="switch-visible-co"
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-background p-3">
            <div>
              <div className="text-sm font-medium">Visible to the broader Capavate Collective network</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Eligible Collective members can discover you. Leaves cap-table privacy untouched.
                Default OFF.
              </p>
            </div>
            <Switch
              checked={visibility.visibleToCollectiveNetwork}
              onCheckedChange={(v) => onVisibility({ ...visibility, visibleToCollectiveNetwork: v })}
              data-testid="switch-visible-net"
            />
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-background p-3">
            <label className="flex items-start gap-2.5 cursor-pointer flex-1">
              <Checkbox
                checked={!!(visibility as any).allowDms}
                onCheckedChange={(v) => onVisibility({ ...visibility, ...(({ allowDms: v === true }) as any) })}
                data-testid="checkbox-allow-dms"
              />
              <div>
                <div className="text-sm font-medium">Allow direct messages</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Enable inbound DMs from cap-table co-members and Collective chapter members per
                  the visibility settings above.
                </p>
              </div>
            </label>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Briefcase className="h-4 w-4" /> Section A — Your Current Role / Work</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <Label>Current Company Name</Label>
              <Input value={role.currentCompanyName} onChange={(e) => setR("currentCompanyName", e.target.value)} placeholder="e.g. Greenwood Capital" data-testid="input-current-company" />
            </div>
            <div className="space-y-1.5">
              <Label>Company Country</Label>
              <CountryPicker value={role.companyCountryCode} onChange={(c) => setR("companyCountryCode", c)} testId="picker-company-country" />
            </div>
            <div className="space-y-1.5">
              <Label>Current Job Title</Label>
              <Input value={role.currentJobTitle} onChange={(e) => setR("currentJobTitle", e.target.value)} placeholder="e.g. Managing Partner" data-testid="input-job-title" />
            </div>
            <div className="space-y-1.5">
              <Label>Company Website</Label>
              <Input value={role.companyWebsite} onChange={(e) => setR("companyWebsite", e.target.value)} placeholder="https://" data-testid="input-company-website" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><User className="h-4 w-4" /> Section B — Contact Information</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">First Name <span className="text-rose-500">*</span></Label>
              <Input value={contact.firstName} onChange={(e) => setC("firstName", e.target.value)} data-testid="input-first-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">Last Name <span className="text-rose-500">*</span></Label>
              <Input value={contact.lastName} onChange={(e) => setC("lastName", e.target.value)} data-testid="input-last-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">Email <HelpTip>Read-only. Set at Auth0 invitation redemption.</HelpTip></Label>
              <Input value={contact.email} disabled data-testid="input-email" />
            </div>
          </div>

          {/* E3 — Cascading Country / State / City picker */}
          <CountryStateCityPicker
            value={{
              countryCode: contact.countryCode,
              stateProvince: contact.stateProvince,
              city: contact.city,
            }}
            onChange={handleCountryStateCityChange}
            onDialCodeChange={handleDialCodeChange}
            testIdPrefix="contact-csc"
          />

          {/* E4 — Phone with auto-updating country code */}
          <div className="space-y-1.5">
            <Label>Mobile Phone</Label>
            <div className="flex items-center gap-2">
              <PhoneCountryPicker
                value={contact.mobileCountryCode}
                onChange={handleManualDialCodeChange}
                testId="picker-mobile-country"
              />
              <Input
                value={contact.mobileNumber}
                onChange={(e) => setC("mobileNumber", e.target.value)}
                placeholder="Phone number"
                data-testid="input-mobile"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              The dial code auto-updates when you change your contact country above. You can override it manually.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- STEP 2 ---------- */
function Step2Profile({
  value, onChange, investorId, toast,
}: {
  value: InvestorProfile["profile"];
  onChange: (n: InvestorProfile["profile"]) => void;
  investorId: string;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const set = <K extends keyof InvestorProfile["profile"]>(k: K, v: InvestorProfile["profile"][K]) => onChange({ ...value, [k]: v });

  // KYC upload uses dedicated /kyc endpoint with multer; not part of debounced PATCH.
  // Defect 9: use apiRequest() instead of raw fetch().
  const onKycFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append("files", files[i]);
    try {
      const res = await apiRequest("POST", `/api/investors/${investorId}/kyc`, fd as unknown as Record<string, unknown>);
      const data = await res.json();
      if (data.ok) {
        set("kycDocuments", [...value.kycDocuments, ...data.added]);
        toast({ title: "KYC documents uploaded", description: `${data.added.length} file(s) added · hashed + stored.` });
      } else {
        toast({ title: "Upload failed", description: data.message ?? "Try again", variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", description: "Network error — try again.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Briefcase className="h-4 w-4" /> Investor Profile</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <Label>Type of Investor</Label>
              <Select value={value.investorType ?? ""} onValueChange={(v) => set("investorType", (v || null) as typeof value.investorType)}>
                <SelectTrigger data-testid="select-investor-type"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {INVESTOR_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1">
                Accredited Status
                <HelpTip>Changes here trigger admin re-screening before the &ldquo;Verified&rdquo; badge re-applies.</HelpTip>
              </Label>
              <Select value={value.accreditedStatus ?? ""} onValueChange={(v) => set("accreditedStatus", (v || null) as typeof value.accreditedStatus)}>
                <SelectTrigger data-testid="select-accredited"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {ACCREDITED_STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Network Bio (max 500 characters)</Label>
            <Textarea value={value.networkBio} onChange={(e) => set("networkBio", e.target.value)} maxLength={500} rows={3} data-testid="textarea-bio" />
            <div className="text-[11px] text-muted-foreground text-right">{value.networkBio.length} / 500</div>
          </div>

          <div className="space-y-1.5">
            <Label>LinkedIn / Professional Profile</Label>
            <Input value={value.linkedinUrl} onChange={(e) => set("linkedinUrl", e.target.value)} placeholder="https://linkedin.com/in/…" data-testid="input-linkedin" />
          </div>

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Do you invest through a company?</Label>
              <YesNoRadio value={value.investsThroughCompany} onChange={(v) => set("investsThroughCompany", v)} testId="radio-through-company" />
            </div>
            {value.investsThroughCompany && (
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Investment Entity Name</Label>
                  <Input value={value.investmentEntityName ?? ""} onChange={(e) => set("investmentEntityName", e.target.value || null)} data-testid="input-entity-name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Entity Jurisdiction</Label>
                  <CountryPicker value={value.investmentEntityJurisdiction ?? ""} onChange={(c) => set("investmentEntityJurisdiction", c || null)} testId="picker-entity-jurisdiction" />
                </div>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <Label>Country of Tax Residency</Label>
              <CountryPicker value={value.countryOfTaxResidencyCode} onChange={(c) => set("countryOfTaxResidencyCode", c)} testId="picker-tax-residency" />
              <div className="text-[11px] text-muted-foreground">KYC variant: <span className="font-medium" data-testid="text-kyc-variant">{value.kycVariant}</span></div>
            </div>
            <div className="space-y-1.5">
              <Label>Tax ID / National ID</Label>
              <Input value={value.taxIdOrNationalId} onChange={(e) => set("taxIdOrNationalId", e.target.value)} placeholder="XXX-XXX-XXX" data-testid="input-tax-id" />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1">
              KYC / AML Documentation
              <HelpTip>Upload passport, ID, or proof of address. Documents are hashed for integrity. Production: KMS-encrypted at rest, never shared with founders.</HelpTip>
            </Label>
            <Input type="file" multiple onChange={(e) => onKycFiles(e.target.files)} data-testid="input-kyc-files" />
            {value.kycDocuments.length > 0 && (
              <ul className="text-xs space-y-1 mt-1" data-testid="list-kyc-docs">
                {value.kycDocuments.map((d, i) => (
                  <li key={i} className="flex items-center gap-2 text-muted-foreground">
                    <Upload className="h-3 w-3" />
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto text-[10px] font-mono">{Math.round(d.sizeBytes / 1024)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Profile Picture</Label>
            {/* Defect 50: upload avatar via FormData POST to /api/investors/:id/avatar */}
            <Input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.append("avatar", file);
                try {
                  const res = await apiRequest("POST", `/api/investors/${investorId}/avatar`, fd as unknown as Record<string, unknown>);
                  const data = await res.json();
                  if (data.ok) {
                    set("profilePictureName", data.filename ?? file.name);
                    toast({ title: "Avatar uploaded", description: "Profile picture updated." });
                  } else {
                    toast({ title: "Upload failed", description: data.message ?? "Try again", variant: "destructive" });
                  }
                } catch {
                  toast({ title: "Upload failed", description: "Network error — try again.", variant: "destructive" });
                }
              }}
              data-testid="input-profile-picture"
            />
            {value.profilePictureName && <div className="text-[11px] text-muted-foreground">{value.profilePictureName}</div>}
          </div>

          {/* Verified status panel */}
          <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start gap-3">
            {value.accreditationVerified ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5" /> : <Shield className="h-4 w-4 text-muted-foreground mt-0.5" />}
            <div className="text-xs">
              {value.accreditationVerified ? (
                <>Accreditation verified · last confirmed {value.accreditationVerifiedAt?.slice(0, 10)} · Variant: {value.kycVariant}</>
              ) : (
                <>Accreditation re-verification pending. Admin will re-confirm after the change.</>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      {/* Sprint 14 D10 — 9-jurisdiction accreditation form */}
      <AccreditationForm initialJurisdiction="US" />
    </div>
  );
}

/* ---------- STEP 3 ---------- */
function Step3Network({
  network,
  onNetwork,
}: {
  network: InvestorProfile["network"];
  onNetwork: (n: InvestorProfile["network"]) => void;
}) {
  const set = <K extends keyof InvestorProfile["network"]>(k: K, v: InvestorProfile["network"][K]) => onNetwork({ ...network, [k]: v });
  const interestList = useMemo(() => network.investmentInterests, [network.investmentInterests]);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Capavate Angel Investor Network — visible to founders</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label className="text-xs">Industry Expertise (you can select multiple)</Label>
            <div className="mt-2">
              <ChipMultiSelect size="sm" options={INDUSTRY_EXPERTISE_OPTIONS} value={network.industryExpertise} onChange={(v) => set("industryExpertise", v)} testIdPrefix="chip-industry" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Typical Cheque Size (select multiple)</Label>
            <div className="mt-2">
              <ChipMultiSelect options={CHEQUE_SIZE_OPTIONS} value={network.chequeSizes} onChange={(v) => set("chequeSizes", v)} testIdPrefix="chip-cheque" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Geography Focus</Label>
            <div className="mt-2">
              <ChipMultiSelect options={GEOGRAPHY_FOCUS_OPTIONS} value={network.geographyFocus} onChange={(v) => set("geographyFocus", v)} testIdPrefix="chip-geo-focus" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Preferred Stage</Label>
            <div className="mt-2">
              <ChipMultiSelect options={PREFERRED_STAGE_OPTIONS} value={network.preferredStages} onChange={(v) => set("preferredStages", v)} testIdPrefix="chip-stage" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Hands-on Preference</Label>
            <div className="mt-2">
              <ChipMultiSelect options={HANDS_ON_OPTIONS} value={network.handsOn} onChange={(v) => set("handsOn", v)} testIdPrefix="chip-hands-on" />
            </div>
          </div>
          <div>
            <Label className="text-xs">M&A Interests</Label>
            <div className="mt-2">
              <ChipMultiSelect options={MA_INTEREST_OPTIONS} value={network.maInterests} onChange={(v) => set("maInterests", v)} testIdPrefix="chip-ma" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* E5 — Investment Interests with inline note examples */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" /> Investment Interests
            <HelpTip>
              These notes appear on your investor profile to founders deciding whether to invite you.
              Be specific — concrete thesis notes increase your invite rate.
            </HelpTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChipMultiSelect options={INVESTMENT_INTEREST_OPTIONS} value={network.investmentInterests} onChange={(v) => set("investmentInterests", v)} testIdPrefix="chip-investment" />
          {interestList.length > 0 && (
            <div className="space-y-2 mt-3">
              <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                Add an inline note for any selected interest:
                <HelpTip>
                  These notes appear on your investor profile to founders deciding whether to invite you.
                  Be specific — concrete thesis notes increase your invite rate significantly.
                </HelpTip>
              </div>
              {INVESTMENT_INTEREST_OPTIONS.filter(o => interestList.includes(o.value)).map((o) => (
                <div key={o.value} className="grid sm:grid-cols-[180px,1fr] gap-2 items-center">
                  <Label className="text-xs">{o.label}</Label>
                  <Input
                    value={network.investmentInterestDescriptions[o.value] ?? ""}
                    onChange={(e) =>
                      set("investmentInterestDescriptions", { ...network.investmentInterestDescriptions, [o.value]: e.target.value })
                    }
                    placeholder={getInterestPlaceholder(o.label, o.value)}
                    data-testid={`input-interest-desc-${o.value}`}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

void Building2;
void Eye;
