/**
 * Wave C-1 — Founder Profile Wizard
 *
 * Path: /founder/profile/wizard
 * 4 steps covering "proves legitimacy" fields.
 * Non-blocking: partial completion proceeds to /founder/subscribe.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle2, ArrowRight, ArrowLeft, SkipForward, Globe, MapPin, Settings2, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useActiveCompany, useActiveCompanyId } from "@/lib/useActiveCompany";

/* ============================================================
 * Supported field definitions per step
 * ============================================================ */

const PREFERRED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "CAD", "AUD", "CHF", "SEK", "SGD"];
const PREFERRED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh", label: "中文 (Chinese)" },
  { value: "es", label: "Español (Spanish)" },
  { value: "fr", label: "Français (French)" },
  { value: "de", label: "Deutsch (German)" },
  { value: "ja", label: "日本語 (Japanese)" },
];
const MEETING_DURATIONS = [15, 30, 45, 60] as const;

/* ============================================================
 * Wizard state
 * ============================================================ */
interface WizardData {
  // Step 1 — Public Profile (8 fields)
  linkedinUrl: string;
  twitterUrl: string;
  crunchbaseUrl: string;
  pitchbookUrl: string;
  openingDataRoomUrl: string;
  publicNewsroomUrl: string;
  tagline: string;
  shortPitch: string;
  // Step 2 — Jurisdiction (3 fields)
  incorporationJurisdiction: string;
  secondaryJurisdiction: string;
  taxResidencyJurisdiction: string;
  // Step 3 — Preferences (6 fields)
  preferredCurrency: string;
  preferredTimezone: string;
  preferredLanguage: string;
  preferredCommunicationChannel: string;
  preferredMeetingDuration: string;
  preferredMeetingTimes: string;
}

const INITIAL_DATA: WizardData = {
  linkedinUrl: "", twitterUrl: "", crunchbaseUrl: "", pitchbookUrl: "",
  openingDataRoomUrl: "", publicNewsroomUrl: "", tagline: "", shortPitch: "",
  incorporationJurisdiction: "", secondaryJurisdiction: "", taxResidencyJurisdiction: "",
  preferredCurrency: "USD", preferredTimezone: "", preferredLanguage: "en",
  preferredCommunicationChannel: "both", preferredMeetingDuration: "30",
  preferredMeetingTimes: "",
};

function countFilled(data: WizardData): number {
  return Object.values(data).filter(v => typeof v === "string" && v.trim() !== "").length;
}

/* ============================================================
 * Step components
 * ============================================================ */

function FieldRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Step1({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        These URLs and copy are the first things Collective investors see. Fill in what you have.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <FieldRow label="LinkedIn URL" hint="Your company's LinkedIn page">
          <Input
            data-testid="input-linkedin-url"
            placeholder="https://linkedin.com/company/..."
            value={data.linkedinUrl}
            onChange={e => onChange("linkedinUrl", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Twitter / X URL">
          <Input
            data-testid="input-twitter-url"
            placeholder="https://x.com/yourcompany"
            value={data.twitterUrl}
            onChange={e => onChange("twitterUrl", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Crunchbase URL">
          <Input
            data-testid="input-crunchbase-url"
            placeholder="https://crunchbase.com/organization/..."
            value={data.crunchbaseUrl}
            onChange={e => onChange("crunchbaseUrl", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Pitchbook URL">
          <Input
            data-testid="input-pitchbook-url"
            placeholder="https://pitchbook.com/profiles/company/..."
            value={data.pitchbookUrl}
            onChange={e => onChange("pitchbookUrl", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Data Room URL" hint="Opening data room investors can view">
          <Input
            data-testid="input-opening-data-room-url"
            placeholder="https://drive.google.com/..."
            value={data.openingDataRoomUrl}
            onChange={e => onChange("openingDataRoomUrl", e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Newsroom URL" hint="Public press page or blog">
          <Input
            data-testid="input-public-newsroom-url"
            placeholder="https://yourco.com/news"
            value={data.publicNewsroomUrl}
            onChange={e => onChange("publicNewsroomUrl", e.target.value)}
          />
        </FieldRow>
      </div>
      <FieldRow label="Tagline" hint="One line — what you do, for whom, why it matters">
        <Input
          data-testid="input-tagline"
          placeholder="AI-powered supply chain for Southeast Asian SMEs"
          value={data.tagline}
          onChange={e => onChange("tagline", e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Short Pitch" hint={`≤140 characters (${data.shortPitch.length}/140)`}>
        <Textarea
          data-testid="input-short-pitch"
          placeholder="We help founders..."
          maxLength={140}
          rows={3}
          value={data.shortPitch}
          onChange={e => onChange("shortPitch", e.target.value)}
          className="resize-none"
        />
      </FieldRow>
    </div>
  );
}

function Step2({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Jurisdiction data is used for compliance and Collective matching. Start with a 2-letter ISO country code (e.g., "US New York" or "DE Berlin").
      </p>
      <FieldRow label="Incorporation Jurisdiction" hint='Format: "US Delaware" or "SG"'>
        <Input
          data-testid="input-incorporation-jurisdiction"
          placeholder="US Delaware"
          value={data.incorporationJurisdiction}
          onChange={e => onChange("incorporationJurisdiction", e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Secondary Jurisdiction" hint="Optional — if you operate or are registered in a second jurisdiction">
        <Input
          data-testid="input-secondary-jurisdiction"
          placeholder="GB London"
          value={data.secondaryJurisdiction}
          onChange={e => onChange("secondaryJurisdiction", e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Tax Residency Jurisdiction" hint='Country where your company files taxes'>
        <Input
          data-testid="input-tax-residency-jurisdiction"
          placeholder="US"
          value={data.taxResidencyJurisdiction}
          onChange={e => onChange("taxResidencyJurisdiction", e.target.value)}
        />
      </FieldRow>
    </div>
  );
}

function Step3({ data, onChange }: { data: WizardData; onChange: (k: keyof WizardData, v: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        These preferences control how Capavate communicates with you and how your profile is displayed to investors.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <FieldRow label="Preferred Currency" hint="ISO 4217 — for financial display">
          <Select value={data.preferredCurrency} onValueChange={v => onChange("preferredCurrency", v)}>
            <SelectTrigger data-testid="select-preferred-currency">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent>
              {PREFERRED_CURRENCIES.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Preferred Language">
          <Select value={data.preferredLanguage} onValueChange={v => onChange("preferredLanguage", v)}>
            <SelectTrigger data-testid="select-preferred-language">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {PREFERRED_LANGUAGES.map(l => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Communication Channel">
          <Select value={data.preferredCommunicationChannel} onValueChange={v => onChange("preferredCommunicationChannel", v)}>
            <SelectTrigger data-testid="select-preferred-communication-channel">
              <SelectValue placeholder="Select channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email only</SelectItem>
              <SelectItem value="in_app">In-app only</SelectItem>
              <SelectItem value="both">Both email + in-app</SelectItem>
            </SelectContent>
          </Select>
        </FieldRow>
        <FieldRow label="Meeting Duration">
          <Select value={data.preferredMeetingDuration} onValueChange={v => onChange("preferredMeetingDuration", v)}>
            <SelectTrigger data-testid="select-preferred-meeting-duration">
              <SelectValue placeholder="Select duration" />
            </SelectTrigger>
            <SelectContent>
              {MEETING_DURATIONS.map(d => (
                <SelectItem key={d} value={String(d)}>{d} minutes</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>
      </div>
      <FieldRow label="Timezone (IANA)" hint='e.g., "America/New_York" or "Europe/London"'>
        <Input
          data-testid="input-preferred-timezone"
          placeholder="America/New_York"
          value={data.preferredTimezone}
          onChange={e => onChange("preferredTimezone", e.target.value)}
        />
      </FieldRow>
      <FieldRow label="Preferred Meeting Times" hint='e.g., "Mon-Fri 09:00-17:00 EDT"'>
        <Input
          data-testid="input-preferred-meeting-times"
          placeholder="Mon-Fri 09:00-17:00 EDT"
          value={data.preferredMeetingTimes}
          onChange={e => onChange("preferredMeetingTimes", e.target.value)}
        />
      </FieldRow>
    </div>
  );
}

function Step4({ data, companyId, onCompleteLater }: {
  data: WizardData;
  companyId: string;
  onCompleteLater: () => void;
}) {
  const filled = countFilled(data);
  const total = Object.keys(data).length;
  const sections = [
    { label: "Public Profile", fields: ["linkedinUrl", "twitterUrl", "crunchbaseUrl", "pitchbookUrl", "openingDataRoomUrl", "publicNewsroomUrl", "tagline", "shortPitch"] },
    { label: "Jurisdiction", fields: ["incorporationJurisdiction", "secondaryJurisdiction", "taxResidencyJurisdiction"] },
    { label: "Preferences", fields: ["preferredCurrency", "preferredTimezone", "preferredLanguage", "preferredCommunicationChannel", "preferredMeetingDuration", "preferredMeetingTimes"] },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex-shrink-0 w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-lg font-bold text-primary">{Math.round((filled / total) * 100)}%</span>
        </div>
        <div>
          <p className="font-medium">{filled} of {total} fields completed</p>
          <p className="text-sm text-muted-foreground">
            {filled < total
              ? "You can complete the remaining fields in Settings → Public Profile."
              : "All wizard fields complete! You can always update these in Settings."}
          </p>
        </div>
      </div>

      {sections.map(section => {
        const sectionData = Object.entries(data).filter(([k]) => section.fields.includes(k));
        const completedFields = sectionData.filter(([, v]) => typeof v === "string" && v.trim() !== "");
        return (
          <div key={section.label}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">{section.label}</span>
              <Badge variant={completedFields.length === sectionData.length ? "default" : "secondary"} data-testid={`badge-section-${section.label.toLowerCase().replace(" ", "-")}`}>
                {completedFields.length}/{sectionData.length}
              </Badge>
            </div>
            <div className="space-y-1">
              {sectionData.map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 text-xs" data-testid={`row-confirm-${key}`}>
                  <CheckCircle2 className={`h-3.5 w-3.5 flex-shrink-0 ${value ? "text-emerald-500" : "text-muted-foreground/40"}`} />
                  <span className="text-muted-foreground">{key}:</span>
                  <span className={`truncate ${value ? "" : "text-muted-foreground/60 italic"}`}>
                    {value || "not filled"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="pt-2">
        <Button
          variant="link"
          className="text-muted-foreground text-sm px-0 h-auto"
          onClick={onCompleteLater}
          data-testid="button-complete-later"
        >
          Complete later — go to subscribe →
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 * Main Wizard component
 * ============================================================ */
const STEP_LABELS = ["Public Profile", "Jurisdiction", "Preferences", "Confirm"];
const STEP_ICONS = [Globe, MapPin, Settings2, Eye];

export default function FounderProfileWizard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  // Patch v4: useActiveCompanyId now returns "" when no active company; no demo fallback.
  const companyId = useActiveCompanyId();

  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [saving, setSaving] = useState(false);

  // Pre-fill from existing profile
  const profileQ = useQuery({
    queryKey: ["/api/founder/profile", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/founder/profile?companyId=${companyId}`)).json(),
    enabled: !!companyId,
    onSuccess: (res: any) => {
      const p = res?.profile ?? {};
      setData(prev => ({
        ...prev,
        linkedinUrl: p.linkedinUrl ?? prev.linkedinUrl,
        twitterUrl: p.twitterUrl ?? prev.twitterUrl,
        crunchbaseUrl: p.crunchbaseUrl ?? prev.crunchbaseUrl,
        pitchbookUrl: p.pitchbookUrl ?? prev.pitchbookUrl,
        openingDataRoomUrl: p.openingDataRoomUrl ?? prev.openingDataRoomUrl,
        publicNewsroomUrl: p.publicNewsroomUrl ?? prev.publicNewsroomUrl,
        tagline: p.tagline ?? prev.tagline,
        shortPitch: p.shortPitch ?? prev.shortPitch,
        incorporationJurisdiction: p.incorporationJurisdiction ?? prev.incorporationJurisdiction,
        secondaryJurisdiction: p.secondaryJurisdiction ?? prev.secondaryJurisdiction,
        taxResidencyJurisdiction: p.taxResidencyJurisdiction ?? prev.taxResidencyJurisdiction,
        preferredCurrency: p.preferredCurrency ?? prev.preferredCurrency,
        preferredTimezone: p.preferredTimezone ?? prev.preferredTimezone,
        preferredLanguage: p.preferredLanguage ?? prev.preferredLanguage,
        preferredCommunicationChannel: p.preferredCommunicationChannel ?? prev.preferredCommunicationChannel,
        preferredMeetingDuration: p.preferredMeetingDuration ? String(p.preferredMeetingDuration) : prev.preferredMeetingDuration,
        preferredMeetingTimes: p.preferredMeetingTimes ?? prev.preferredMeetingTimes,
      }));
    },
  });

  function onChange(key: keyof WizardData, value: string) {
    setData(prev => ({ ...prev, [key]: value }));
  }

  async function saveCurrentStep() {
    if (saving) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (step === 0) {
        Object.assign(patch, {
          linkedinUrl: data.linkedinUrl || undefined,
          twitterUrl: data.twitterUrl || undefined,
          crunchbaseUrl: data.crunchbaseUrl || undefined,
          pitchbookUrl: data.pitchbookUrl || undefined,
          openingDataRoomUrl: data.openingDataRoomUrl || undefined,
          publicNewsroomUrl: data.publicNewsroomUrl || undefined,
          tagline: data.tagline || undefined,
          shortPitch: data.shortPitch || undefined,
        });
      } else if (step === 1) {
        Object.assign(patch, {
          incorporationJurisdiction: data.incorporationJurisdiction || undefined,
          secondaryJurisdiction: data.secondaryJurisdiction || undefined,
          taxResidencyJurisdiction: data.taxResidencyJurisdiction || undefined,
        });
      } else if (step === 2) {
        Object.assign(patch, {
          preferredCurrency: data.preferredCurrency || undefined,
          preferredTimezone: data.preferredTimezone || undefined,
          preferredLanguage: data.preferredLanguage || undefined,
          preferredCommunicationChannel: data.preferredCommunicationChannel || undefined,
          preferredMeetingDuration: data.preferredMeetingDuration ? Number(data.preferredMeetingDuration) : undefined,
          preferredMeetingTimes: data.preferredMeetingTimes || undefined,
        });
      }

      // Only PATCH if there's something to save
      const hasValues = Object.values(patch).some(v => v !== undefined);
      if (hasValues) {
        // Two-phase: first dry-run (should 409), then confirm
        await apiRequest("PATCH", `/api/founder/profile?companyId=${companyId}`, patch);
      }
    } catch {
      // Dry-run returns 409 — that's expected; retry with x-confirm
      try {
        const patch: Record<string, unknown> = {};
        if (step === 0) {
          if (data.linkedinUrl) patch.linkedinUrl = data.linkedinUrl;
          if (data.twitterUrl) patch.twitterUrl = data.twitterUrl;
          if (data.crunchbaseUrl) patch.crunchbaseUrl = data.crunchbaseUrl;
          if (data.pitchbookUrl) patch.pitchbookUrl = data.pitchbookUrl;
          if (data.openingDataRoomUrl) patch.openingDataRoomUrl = data.openingDataRoomUrl;
          if (data.publicNewsroomUrl) patch.publicNewsroomUrl = data.publicNewsroomUrl;
          if (data.tagline) patch.tagline = data.tagline;
          if (data.shortPitch) patch.shortPitch = data.shortPitch;
        } else if (step === 1) {
          if (data.incorporationJurisdiction) patch.incorporationJurisdiction = data.incorporationJurisdiction;
          if (data.secondaryJurisdiction) patch.secondaryJurisdiction = data.secondaryJurisdiction;
          if (data.taxResidencyJurisdiction) patch.taxResidencyJurisdiction = data.taxResidencyJurisdiction;
        } else if (step === 2) {
          if (data.preferredCurrency) patch.preferredCurrency = data.preferredCurrency;
          if (data.preferredTimezone) patch.preferredTimezone = data.preferredTimezone;
          if (data.preferredLanguage) patch.preferredLanguage = data.preferredLanguage;
          if (data.preferredCommunicationChannel) patch.preferredCommunicationChannel = data.preferredCommunicationChannel;
          if (data.preferredMeetingDuration) patch.preferredMeetingDuration = Number(data.preferredMeetingDuration);
          if (data.preferredMeetingTimes) patch.preferredMeetingTimes = data.preferredMeetingTimes;
        }
        const r = await fetch(`/api/founder/profile?companyId=${companyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-confirm": "true" },
          body: JSON.stringify(patch),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          toast({ title: "Save failed", description: err?.error ?? "Unknown error", variant: "destructive" });
          return false;
        }
        queryClient.invalidateQueries({ queryKey: ["/api/founder/profile", companyId] });
        queryClient.invalidateQueries({ queryKey: ["/api/founder/profile/completion", companyId] });
      } catch {
        toast({ title: "Save failed", variant: "destructive" });
        return false;
      }
    }
    setSaving(false);
    return true;
  }

  async function handleNext() {
    if (step < 2) {
      await saveCurrentStep();
      setStep(s => s + 1);
    } else if (step === 2) {
      await saveCurrentStep();
      setStep(3);
    } else {
      // Step 4 — final save all and redirect
      navigate("/founder/subscribe");
    }
  }

  function handlePrev() {
    setStep(s => Math.max(0, s - 1));
  }

  function handleCompleteLater() {
    navigate("/founder/subscribe");
  }

  const stepProgress = ((step + 1) / STEP_LABELS.length) * 100;

  return (
    <>
      <PageHeader
        title="Complete Your Profile"
        description="Helps Collective investors find and trust your company — you can skip and return at any time."
      />
      <PageBody>
        {/* Progress bar */}
        <div className="mb-6" data-testid="wizard-progress">
          <div className="flex items-center gap-2 mb-2">
            {STEP_LABELS.map((label, i) => {
              const Icon = STEP_ICONS[i];
              return (
                <div
                  key={label}
                  className={`flex items-center gap-1.5 text-xs font-medium ${i === step ? "text-primary" : i < step ? "text-emerald-600" : "text-muted-foreground"}`}
                  data-testid={`wizard-step-indicator-${i}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {i < STEP_LABELS.length - 1 && <span className="text-muted-foreground/40 ml-1">·</span>}
                </div>
              );
            })}
          </div>
          <Progress value={stepProgress} className="h-1.5" data-testid="wizard-step-progress" />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {(() => { const Icon = STEP_ICONS[step]; return <Icon className="h-4 w-4 text-primary" />; })()}
                Step {step + 1}: {STEP_LABELS[step]}
              </CardTitle>
              <span className="text-xs text-muted-foreground" data-testid="wizard-step-counter">{step + 1} / {STEP_LABELS.length}</span>
            </div>
          </CardHeader>
          <CardContent>
            {step === 0 && <Step1 data={data} onChange={onChange} />}
            {step === 1 && <Step2 data={data} onChange={onChange} />}
            {step === 2 && <Step3 data={data} onChange={onChange} />}
            {step === 3 && <Step4 data={data} companyId={companyId} onCompleteLater={handleCompleteLater} />}

            <Separator className="my-6" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <Button
                    variant="outline"
                    onClick={handlePrev}
                    disabled={saving}
                    data-testid="button-wizard-prev"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCompleteLater}
                  className="text-muted-foreground"
                  data-testid="button-wizard-skip"
                >
                  <SkipForward className="h-3.5 w-3.5 mr-1" />
                  Skip for now
                </Button>
              </div>

              <Button
                onClick={handleNext}
                disabled={saving}
                data-testid="button-wizard-next"
              >
                {saving ? "Saving…" : step === STEP_LABELS.length - 1 ? "Go to Subscribe" : "Next"}
                {step < STEP_LABELS.length - 1 && <ArrowRight className="h-4 w-4 ml-1" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
