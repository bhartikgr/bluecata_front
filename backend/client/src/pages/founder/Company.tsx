/**
 * Sprint 8 — Founder Company Profile (4-step wizard, full live-Capavate parity).
 *
 * Sources of truth:
 * - capavate_founder_deep_audit.md §1 (every field, dropdown, validation)
 * - capavate_collective_sync_schema.md §3 (which fields sync to Collective)
 * - client/src/lib/profile/types.ts (production-shape schemas + zod)
 *
 * Production migration: this page consumes the same PATCH endpoints + payload
 * shape that production will. Swapping to Postgres is a one-line change at
 * the storage layer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
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
import { HelpTip } from "@/components/HelpTip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
 Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
 Building2, Mail, MapPin, Briefcase, Target, Eye, ArrowLeft, ArrowRight, Check,
 Upload, Save, Globe, Shield, Users, AlertTriangle, FileText, FlaskConical, ScanFace,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LegalConsentCheckbox, type LegalConsentCheckboxRef } from "@/components/LegalConsentCheckbox";
import { CountryPicker, PhoneCountryPicker } from "@/components/profile/CountryPicker";
import { ChipMultiSelect, YesNoRadio } from "@/components/profile/ChipMultiSelect";
import {
 INDUSTRY_OPTIONS, EMPLOYEE_COUNT_OPTIONS, ENTITY_TYPE_OPTIONS, entityTypesForCountry,
 STRATEGIC_PRIORITY_OPTIONS, TRANSACTION_INTEREST_OPTIONS, PARTNER_TYPE_OPTIONS, DEAL_BREAKER_OPTIONS,
 OPERATING_GEOGRAPHY_OPTIONS, CUSTOMER_SEGMENT_OPTIONS,
} from "@/lib/profile/data/enums";
import type { CompanyProfile, CompanyMAIntelligence } from "@/lib/profile/types";
import { computeMaReadinessScore, deriveLegalFields } from "@/lib/profile/types";
import { EXCHANGE_COUNTRIES, exchangesForCountry } from "@/lib/profile/data/exchanges";
import { engineAttribution } from "@/lib/profile/region";
import { useActiveCompanyId } from "@/lib/useActiveCompany";

// Defect 7 — removed hardcoded COMPANY_ID; use hook
const _COMPANY_ID_REMOVED = null; void _COMPANY_ID_REMOVED;

const STEPS = [
 { id: 1, title: "Company Contact Info", icon: Building2, description: "Basics, industry, employees" },
 { id: 2, title: "Mailing Address", icon: MapPin, description: "Street, city, postal" },
 { id: 3, title: "Legal Entity Information", icon: Shield, description: "Articles, incorporation, type" },
 { id: 4, title: "Strategic Intent (JV / M&A)", icon: Target, description: "M&A intelligence (30 fields)" },
] as const;

export default function Company() {
 const { toast } = useToast();
 const companyId = useActiveCompanyId();
 const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

 // v23.4.7 Phase 10 / B-104 — Company Profile context snap-back.
 //
 // Symptom (Avi): create a new company, land on its dashboard, click
 // "Company Profile" — the page renders the OLD company's profile and the
 // top-bar quietly switches back. Root cause: a stale TanStack cache of
 // /api/founder/active-company can return a companyId that's no longer the
 // user's current active company.
 //
 // Mitigation: cross-check `companyId` against the canonical company list
 // at /api/founder/companies. If the active id is missing OR doesn't match
 // any of the user's current companies, render a "Select a company" CTA
 // instead of silently picking companies[0] or a stale id.
 type FounderCompanyRow = { id?: string; companyId?: string; name?: string; companyName?: string };
 const companiesQ = useQuery<{ companies?: FounderCompanyRow[] } | FounderCompanyRow[]>({
 queryKey: ["/api/founder/companies"],
 });
 const companiesList: FounderCompanyRow[] = (() => {
 const d = companiesQ.data as { companies?: FounderCompanyRow[] } | FounderCompanyRow[] | undefined;
 if (!d) return [];
 if (Array.isArray(d)) return d;
 return Array.isArray(d.companies) ? d.companies : [];
 })();
 const activeCompanyBelongsToUser =
 !!companyId &&
 companiesList.some((c) => (c.id ?? c.companyId) === companyId);

 // Avi 22-May Issue 1 — only fire the profile query once we have a real
 // companyId. With an empty id the URL becomes /api/companies//profile and
 // express returns 404; queryClient maps that to `null` (see getQueryFn in
 // lib/queryClient.ts) and the old guard `isLoading || !profile` left the
 // page stuck on "Loading…". The `enabled` flag stops the broken query
 // entirely; the “no company yet” branch below renders an actionable CTA.
 //
 // v23.4.7 Phase 10 — ALSO gate the profile fetch on the cross-check above
 // so a stale activeCompanyId never paints the wrong company's profile.
 const { data: profile, isLoading, isError } = useQuery<CompanyProfile>({
 queryKey: ["/api/companies", companyId, "profile"],
 enabled: Boolean(companyId) && (companiesQ.isLoading || activeCompanyBelongsToUser),
 });

 // v23.4.7 Phase 10 — companies query loaded AND activeCompanyId is unknown
 // to the user's company list → snap-back prompt instead of silent default.
 if (!companiesQ.isLoading && companyId && !activeCompanyBelongsToUser) {
 return (
 <>
 <PageHeader title="Company profile" description="Pick a company" />
 <PageBody>
 <Card>
 <CardContent className="p-6 space-y-3" data-testid="company-profile-snapback">
 <div className="text-sm text-muted-foreground">
 The active company in your session no longer matches your
 available companies. Pick a company to view its profile.
 </div>
 <Link href="/select-company">
 <Button data-testid="button-pick-company">Select a company</Button>
 </Link>
 </CardContent>
 </Card>
 </PageBody>
 </>
 );
 }

 if (!companyId) {
 return (
 <>
 <PageHeader title="Company profile" description="No active company" />
 <PageBody>
 <Card>
 <CardContent className="p-6 space-y-3">
 <div className="text-sm text-muted-foreground">
 You don’t have an active company yet. Create one from the Welcome
 flow or the company switcher to start the profile wizard.
 </div>
 <Link href="/founder/welcome">
 <Button>Go to Welcome</Button>
 </Link>
 </CardContent>
 </Card>
 </PageBody>
 </>
 );
 }

 if (isError) {
 return (
 <>
 <PageHeader title="Company profile" description="Could not load profile" />
 <PageBody>
 <Card>
 <CardContent className="p-6 text-sm">
 We couldn’t load the company profile. Refresh the page; if the
 problem persists, the page error is surfaced to admin logs.
 </CardContent>
 </Card>
 </PageBody>
 </>
 );
 }

 if (isLoading || !profile) {
 return (
 <>
 <PageHeader title="Company profile" description="Loading…" />
 <PageBody><div className="text-sm text-muted-foreground">Loading company profile…</div></PageBody>
 </>
 );
 }

 return <CompanyWizard profile={profile} step={step} setStep={setStep} toast={toast} />;
}

function CompanyWizard({
 profile, step, setStep, toast,
}: {
 profile: CompanyProfile;
 step: 1 | 2 | 3 | 4;
 setStep: (s: 1 | 2 | 3 | 4) => void;
 toast: ReturnType<typeof useToast>["toast"];
}) {
 const [contact, setContact] = useState(profile.contact);
 const [address, setAddress] = useState(profile.address);
 const [legal, setLegal] = useState(profile.legal ?? {
   legalEntityName: "", businessNumber: "", countryOfIncorporationCode: "",
   entityType: null, articlesFileName: null, articlesFileSizeBytes: null,
   isPubliclyTraded: false, listingCountryCode: null, exchangeCode: null,
   tickerSymbol: null, registeredOfficeAddress: "", region: "US",
   kycVariant: "standard", engineAttribution: "US-default v1.0.0",
 });
 const [ma, setMa] = useState(profile.ma);
 const [savedAt, setSavedAt] = useState<Date | null>(new Date(profile.updatedAt));
 const legalConsentRef = useRef<LegalConsentCheckboxRef>(null);
 const [legalConsentChecked, setLegalConsentChecked] = useState(false);

 // Whenever country_of_incorporation_code changes, recompute legal derivations.
 useEffect(() => {
 if (!legal?.countryOfIncorporationCode) return;
 const derived = deriveLegalFields(legal.countryOfIncorporationCode);
 if (
 derived.region !== legal.region ||
 derived.kycVariant !== legal.kycVariant ||
 derived.engineAttribution !== legal.engineAttribution
 ) {
 setLegal((l) => ({ ...l, ...derived }));
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [legal.countryOfIncorporationCode]);

 /* ---- Mutation: PATCH the profile (debounced auto-save) ---- */
 const patchMutation = useMutation({
 mutationFn: async (patch: Record<string, unknown>) => {
 const r = await apiRequest("PATCH", `/api/companies/${profile.id}/profile`, patch);
 return r.json();
 },
 onSuccess: () => {
 setSavedAt(new Date());
 // CRITICAL: invalidate all surfaces that depend on profile data so the
 // engine region propagates dynamically (cap-table, rounds, term sheet).
 queryClient.invalidateQueries({ queryKey: ["/api/companies", profile.id, "profile"] });
 queryClient.invalidateQueries({ queryKey: [`/api/companies/${profile.id}?as=founder`] });
 queryClient.invalidateQueries({ queryKey: [`/api/companies/${profile.id}?as=investor`] });
 queryClient.invalidateQueries({ queryKey: [`/api/companies/${profile.id}/securities`] });
 queryClient.invalidateQueries({ queryKey: ["/api/rounds"] });
 },
 });

 /* ---- Debounced auto-save: 800 ms after last change ---- */
 const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
 const queueAutosave = (patch: Record<string, unknown>) => {
 if (debounceRef.current) clearTimeout(debounceRef.current);
 debounceRef.current = setTimeout(() => patchMutation.mutate(patch), 800);
 };

 /* ---- Patches per section ---- */
 const updateContact = (next: typeof contact) => { setContact(next); queueAutosave({ contact: next }); };
 const updateAddress = (next: typeof address) => { setAddress(next); queueAutosave({ address: next }); };
 const updateLegal = (next: typeof legal) => { setLegal(next); queueAutosave({ legal: next }); };
 const updateMa = (next: typeof ma) => { setMa(next); queueAutosave({ ma: next }); };

 /* ---- v23.4.5 Phase 7 — required-field validation ---- */
 /* The three industry-required fields per QA #14 / BUG 006:
  *   1. contact.companyName       (Name of Company)
  *   2. legal.countryOfIncorporationCode (Jurisdiction)
  *   3. legal.entityType          (Entity type)
  * The full zod schema enforces additional shape constraints (email, URL, etc)
  * — those still surface server-side, but the three below are the
  * “cannot save profile without these” fields the audit asks for. */
 const missingRequired = (): string[] => {
 const missing: string[] = [];
 if (!contact.companyName || !contact.companyName.trim()) missing.push("Company name");
 if (!legal.countryOfIncorporationCode) missing.push("Country of incorporation");
 if (!legal.entityType) missing.push("Entity type");
 return missing;
 };
 const requiredMissingList = missingRequired();
 const isProfileValid = requiredMissingList.length === 0;

 /* ---- BUG 006 fix v23.7 — enforce the (*) fields on "Continue" ----
  * Previously the Continue button only advanced the wizard; founders could
  * skip past every required field and the gaps were only ever caught (for the
  * three industry fields) on the final save. We now validate the (*) fields of
  * the CURRENT step before allowing advancement, mirroring the asterisks shown
  * in each step's form. The final-save gate (missingRequired) is unchanged. */
 const missingForStep = (s: number): string[] => {
   const missing: string[] = [];
   const need = (cond: boolean, label: string) => { if (cond) missing.push(label); };
   if (s === 1) {
     need(!contact.companyName?.trim(), "Name of Company");
     need(!contact.companyEmail?.trim(), "Company Email");
     need(!contact.industry, "Industry");
     need(!contact.phoneNumber?.trim(), "Phone");
     need(!contact.companyWebsiteUrl?.trim(), "Company Website / URL");
     need(!contact.numberOfEmployees, "Number of Employees");
     need(!contact.dateOfIncorporation?.trim(), "Date of Incorporation");
     need(!contact.oneSentenceHeadliner?.trim(), "One-sentence headliner");
     need(!contact.problemStatement?.trim(), "Problem statement");
     need(!contact.solutionStatement?.trim(), "Solution statement");
   } else if (s === 2) {
     need(!address.street?.trim(), "Street");
     need(!address.countryCode, "Country");
     need(!address.stateProvince?.trim(), "State / Province");
     need(!address.city?.trim(), "City");
     need(!address.postalCode?.trim(), "Postal Code / Zip");
   } else if (s === 3) {
     need(!legal.articlesFileName?.trim(), "Articles of Incorporation");
     need(!legal.legalEntityName?.trim(), "Legal Entity Name");
     need(!legal.countryOfIncorporationCode, "Country of Incorporation");
     need(!legal.entityType, "Type of Entity");
     need(legal.isPubliclyTraded === null || legal.isPubliclyTraded === undefined, "Public exchange?");
     need(!legal.registeredOfficeAddress?.trim(), "Registered Office Address");
   }
   return missing;
 };

 const saveDraft = () => {
 if (debounceRef.current) clearTimeout(debounceRef.current);
 const missing = missingRequired();
 if (missing.length) {
 toast({
 title: "Missing required fields",
 description: `Please fill in: ${missing.join(", ")}.`,
 variant: "destructive",
 });
 return;
 }
 patchMutation.mutate({ contact, address, legal, ma });
 toast({ title: "Saved", description: "Draft saved. Investor surfaces will refresh on next view." });
 };

 const goNext = () => {
   // BUG 006 fix v23.7 — block advancement until this step's (*) fields are filled.
   const missing = missingForStep(step);
   if (missing.length) {
     toast({
       title: "Missing required fields",
       description: `Please fill in: ${missing.join(", ")}.`,
       variant: "destructive",
     });
     return;
   }
   setStep(Math.min(4, step + 1) as 1 | 2 | 3 | 4);
 };
 const goBack = () => setStep(Math.max(1, step - 1) as 1 | 2 | 3 | 4);

 return (
 <>
 <PageHeader
 title="Company profile"
 description="The single source of truth investors see in every invitation, dataroom, and report."
 breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Company profile" }]}
 actions={
 <div className="flex items-center gap-2">
 <Dialog>
 <DialogTrigger asChild>
 <Button variant="outline" size="sm" data-testid="button-view-as-investor">
 <Eye className="h-3.5 w-3.5 mr-1.5" /> Investor View
 <Badge variant="outline" className="ml-2 border-emerald-300 text-emerald-700 text-[10px]" data-testid="badge-live-preview">Live preview</Badge>
 </Button>
 </DialogTrigger>
 <DialogContent className="max-w-6xl w-[95vw] h-[85vh] p-0 overflow-hidden">
 <DialogHeader className="px-5 py-3 border-b border-border bg-secondary/40">
 <DialogTitle className="text-sm flex items-center gap-2">
 <Eye className="h-4 w-4" /> Investor view of {profile.contact.companyName}
 <Badge variant="outline" className="border-emerald-300 text-emerald-700 text-[10px] ml-2">Live preview · auto-syncs on save</Badge>
 </DialogTitle>
 </DialogHeader>
 <div
 className="w-full h-full overflow-auto bg-background p-4"
 data-testid="iframe-investor-preview"
 >
 <div className="text-sm text-muted-foreground italic text-center pt-8">
 Investor preview — opens full-page at{" "}
 <a href={`/investor/companies/${profile.id}`} target="_blank" rel="noreferrer" className="text-[hsl(184_98%_22%)] underline">
   /investor/companies/{profile.id}
 </a>
 </div>
 </div>
 </DialogContent>
 </Dialog>
 <Link href={`/founder/companies/${profile.id}`}>
 <Button variant="ghost" size="sm" data-testid="link-view-as-investor-full">
 Full page <Eye className="h-3.5 w-3.5 ml-1.5" />
 </Button>
 </Link>
 <CollectiveDeepLink entity="company" id={profile.id} label="View in Collective Deal Room" />
 <Badge variant="outline" data-testid="badge-region">
 Region: {legal.region}
 </Badge>
 <Badge variant="outline" data-testid="badge-engine">
 {legal.engineAttribution}
 </Badge>
 </div>
 }
 />
 <PageBody>
 {/* Stepper / progress */}
 <Card className="mb-5">
 <CardContent className="p-4">
 <div className="flex items-center justify-between mb-3">
 <div className="text-xs font-medium" data-testid="text-step-position">
 Step {step} of 4 · {STEPS[step - 1].title}
 </div>
 <div className="text-xs text-muted-foreground" data-testid="text-saved-at">
 {patchMutation.isPending ? "Saving…" : savedAt ? `Saved · ${savedAt.toLocaleTimeString()}` : "Not yet saved"}
 </div>
 </div>
 <Progress value={(step / 4) * 100} className="h-1.5 mb-3" />
 <ol className="flex items-stretch gap-2 overflow-x-auto pb-1">
 {STEPS.map((s) => {
 const Icon = s.icon;
 const active = s.id === step;
 const done = s.id < step;
 return (
 <li key={s.id} className="flex-1 min-w-[180px]">
 <button
 type="button"
 onClick={() => setStep(s.id as 1 | 2 | 3 | 4)}
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

 {step === 1 && <Step1ContactInfo value={contact} onChange={updateContact} />}
 {step === 2 && <Step2Address value={address} onChange={updateAddress} />}
 {step === 3 && <Step3LegalEntity value={legal} onChange={updateLegal} />}
 {step === 4 && <Step4MaIntent value={ma} onChange={updateMa} />}

 <div className="flex items-center justify-between mt-6">
 <Button variant="outline" onClick={goBack} disabled={step === 1} data-testid="button-step-back">
 <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
 </Button>
 <div className="flex items-center gap-2">
 <Button variant="outline" onClick={saveDraft} data-testid="button-save-draft">
 <Save className="h-4 w-4 mr-1.5" /> Save draft
 </Button>
 {step < 4 ? (
 <Button onClick={goNext} data-testid="button-step-continue">
 Continue <ArrowRight className="h-4 w-4 ml-1.5" />
 </Button>
 ) : (
 <>
 {!legalConsentChecked && (
 <LegalConsentCheckbox
 ref={legalConsentRef}
 docs={["terms", "privacy", "acceptable-use"]}
 context="new_company"
 required
 onCheckedChange={setLegalConsentChecked}
 />
 )}
 {/* L-005 fix v23.4.13: save profile validation feedback — show count near button */}
 {!legalConsentChecked && (
 <p className="text-xs text-muted-foreground" data-testid="text-save-requires-consent">Please accept the terms to continue.</p>
 )}
 {legalConsentChecked && !isProfileValid && (
 <p className="text-xs text-amber-700" data-testid="text-save-missing-count">{requiredMissingList.length} required field{requiredMissingList.length !== 1 ? "s" : ""} missing: {requiredMissingList.join(", ")}</p>
 )}
 <Button
 onClick={() => {
 if (!legalConsentChecked) { legalConsentRef.current?.recordConsent().catch(() => null); return; }
 const missing = missingRequired();
 if (missing.length) {
 toast({
 title: "Missing required fields",
 description: `Please fill in: ${missing.join(", ")}.`,
 variant: "destructive",
 });
 // L-005 fix v23.4.13: scroll to first missing field
 const firstMissingTestId = missing[0]?.toLowerCase().includes("company name") ? "input-company-name"
 : missing[0]?.toLowerCase().includes("country of incorp") ? "picker-country-incorp"
 : missing[0]?.toLowerCase().includes("entity") ? "select-entity-type" : null;
 if (firstMissingTestId) {
 const el = document.querySelector(`[data-testid="${firstMissingTestId}"]`);
 if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
 }
 return;
 }
 saveDraft();
 legalConsentRef.current?.recordConsent().catch(() => null);
 toast({ title: "Profile saved", description: "All four steps captured. Sync to Collective queued." });
 }}
 disabled={false}
 data-testid="button-save-profile"
 >
 <Check className="h-4 w-4 mr-1.5" /> Save profile
 </Button>
 </>
 )}
 </div>
 </div>
 </PageBody>
 </>
 );
}

/* ============================ STEP 1 ============================ */
function Step1ContactInfo({
 value, onChange,
}: { value: CompanyProfile["contact"]; onChange: (next: CompanyProfile["contact"]) => void }) {
 // v23.4.7 Phase 13 / BUG 030 — read the active company id so logo uploads
 // can post to /api/founder/company/:id/logo. The hook is safe to call from
 // a nested step component; useActiveCompany() is already used elsewhere in
 // this file.
 const companyId = useActiveCompanyId();
 const set = <K extends keyof CompanyProfile["contact"]>(k: K, v: CompanyProfile["contact"][K]) =>
 onChange({ ...value, [k]: v });
 return (
 <Card>
 <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4" /> Step 1: Company Contact Info</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 <div className="grid md:grid-cols-2 gap-5">
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Name of Company <span className="text-rose-500">*</span></Label>
 <Input value={value.companyName} onChange={(e) => set("companyName", e.target.value)} maxLength={100} data-testid="input-company-name" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Company Email <span className="text-rose-500">*</span></Label>
 <Input type="email" value={value.companyEmail} onChange={(e) => set("companyEmail", e.target.value)} placeholder="hello@yourcompany.com" data-testid="input-company-email" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Industry <span className="text-rose-500">*</span></Label>
 <Select value={value.industry ?? ""} onValueChange={(v) => set("industry", (v || null) as typeof value.industry)}>
 <SelectTrigger data-testid="select-industry"><SelectValue placeholder="Select industry…" /></SelectTrigger>
 <SelectContent className="max-h-72">
 {INDUSTRY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Phone <span className="text-rose-500">*</span></Label>
 <div className="flex items-center gap-2">
 <PhoneCountryPicker value={value.phoneCountryCode} onChange={(c) => set("phoneCountryCode", c)} testId="picker-phone-country" />
 <Input value={value.phoneNumber} onChange={(e) => set("phoneNumber", e.target.value)} placeholder="Phone number" data-testid="input-phone-number" />
 </div>
 </div>
 <div className="space-y-1.5 md:col-span-2">
 <Label className="flex items-center gap-1">Company Website / URL <span className="text-rose-500">*</span></Label>
 <Input type="url" value={value.companyWebsiteUrl} onChange={(e) => set("companyWebsiteUrl", e.target.value)} placeholder="https://" data-testid="input-website" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Number of Employees <span className="text-rose-500">*</span></Label>
 <Select value={value.numberOfEmployees ?? ""} onValueChange={(v) => set("numberOfEmployees", (v || null) as typeof value.numberOfEmployees)}>
 <SelectTrigger data-testid="select-employees"><SelectValue placeholder="Select range…" /></SelectTrigger>
 <SelectContent>
 {EMPLOYEE_COUNT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">
 Date of Incorporation / Registration <span className="text-rose-500">*</span>
 <HelpTip>Format DD-Month-YYYY. We store as ISO date in the production database.</HelpTip>
 </Label>
 {/* v23.4.7 Phase 4 (BUG 029): reject future dates client-side with max
     attribute + inline error display. Server zod also rejects.            */}
 {(() => {
   const todayIso = new Date().toISOString().split("T")[0];
   const isFuture = !!value.dateOfIncorporation && value.dateOfIncorporation > todayIso;
   return (
     <>
       <Input
         type="date"
         max={todayIso}
         value={value.dateOfIncorporation}
         onChange={(e) => set("dateOfIncorporation", e.target.value)}
         data-testid="input-date-incorporation"
         aria-invalid={isFuture || undefined}
       />
       {isFuture && (
         <div
           className="text-[11px] text-rose-600"
           data-testid="error-date-incorporation-future"
         >
           Date of Incorporation cannot be in the future.
         </div>
       )}
     </>
   );
 })()}
 </div>
 </div>

 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">One-sentence headliner about the company <span className="text-rose-500">*</span></Label>
 <Textarea value={value.oneSentenceHeadliner} onChange={(e) => set("oneSentenceHeadliner", e.target.value)} maxLength={400} rows={2} data-testid="textarea-headliner" />
 <div className="text-[11px] text-muted-foreground text-right">{value.oneSentenceHeadliner.length} / 400</div>
 </div>

 <div className="grid md:grid-cols-2 gap-5">
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">What problem are you solving? <span className="text-rose-500">*</span></Label>
 <Textarea value={value.problemStatement} onChange={(e) => set("problemStatement", e.target.value)} maxLength={600} rows={5} data-testid="textarea-problem" />
 <div className="text-[11px] text-muted-foreground text-right">{value.problemStatement.length} / 600</div>
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">What is Your Solution? <span className="text-rose-500">*</span></Label>
 <Textarea value={value.solutionStatement} onChange={(e) => set("solutionStatement", e.target.value)} maxLength={600} rows={5} data-testid="textarea-solution" />
 <div className="text-[11px] text-muted-foreground text-right">{value.solutionStatement.length} / 600</div>
 </div>
 </div>

 {/* v23.4.7 Phase 13 / BUG 030 — logos are uploaded to the dedicated
  * server endpoint (POST /api/founder/company/:id/logo) on file-pick,
  * and the form state then stores ONLY the returned URL string. This
  * eliminates the multi-MB base64 data URL that previously lived in
  * form state and caused stale-save / focus-loss bugs. The legacy
  * `logoDataUrl` field is preserved as a fallback when the upload
  * fails so the user still sees a preview. */}
 <div className="space-y-1.5">
 <Label>Logo (optional)</Label>
 {/* BUG 030 fix v23.7 — the persisted logo "disappeared" because the only
  * preview was the freshly-picked file; on a later visit the file input is
  * empty so the founder couldn't tell their saved logo was still there. We
  * now always render the persisted `logoDataUrl` as a labelled "Current
  * logo" thumbnail next to the picker, so the saved upload stays visible
  * even when the file input is empty. */}
 <div className="flex items-center gap-3">
 <div className="flex flex-col items-center gap-1">
 <div className="h-12 w-12 rounded-md bg-secondary flex items-center justify-center text-muted-foreground overflow-hidden" data-testid="logo-preview">
 {value.logoDataUrl ? (
 <img src={value.logoDataUrl} alt="Current company logo" className="h-12 w-12 rounded-md object-cover" data-testid="img-current-logo" />
 ) : (
 <Building2 className="h-5 w-5" />
 )}
 </div>
 {value.logoDataUrl && (
 <span className="text-[10px] text-muted-foreground" data-testid="label-current-logo">Current logo</span>
 )}
 </div>
 <Input
 type="file"
 accept="image/jpeg,image/png,image/webp"
 onChange={async (e) => {
 const f = e.target.files?.[0];
 if (!f) return;
 // Best-effort server upload (v23.4.7 Phase 13). If it fails we
 // fall back to the legacy FileReader path so the user still
 // gets a preview — the form save then carries the base64 URL.
 try {
 const fd = new FormData();
 fd.append("logo", f);
 const r = await fetch(
 `/api/founder/company/${encodeURIComponent(companyId)}/logo`,
 { method: "POST", body: fd, credentials: "include" },
 );
 if (r.ok) {
 const data = (await r.json()) as { url?: string };
 if (data?.url) {
 // Bust the browser cache so a same-URL replacement still re-renders.
 set("logoDataUrl", `${data.url}?t=${Date.now()}`);
 return;
 }
 }
 } catch {
 /* network errors fall through to the FileReader fallback */
 }
 const reader = new FileReader();
 reader.onload = () => set("logoDataUrl", reader.result as string);
 reader.readAsDataURL(f);
 }}
 data-testid="input-logo"
 />
 </div>
 </div>
 </CardContent>
 </Card>
 );
}

/* ============================ STEP 2 ============================ */
function Step2Address({
 value, onChange,
}: { value: CompanyProfile["address"]; onChange: (next: CompanyProfile["address"]) => void }) {
 const set = <K extends keyof CompanyProfile["address"]>(k: K, v: CompanyProfile["address"][K]) => onChange({ ...value, [k]: v });
 return (
 <Card>
 <CardHeader><CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4" /> Step 2: Mailing Address</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 <div className="grid md:grid-cols-2 gap-5">
 <div className="space-y-1.5 md:col-span-2">
 <Label className="flex items-center gap-1">Street <span className="text-rose-500">*</span></Label>
 <Input value={value.street} onChange={(e) => set("street", e.target.value)} placeholder="Enter street address" data-testid="input-street" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Country <span className="text-rose-500">*</span></Label>
 <CountryPicker value={value.countryCode} onChange={(c) => set("countryCode", c)} testId="picker-country" />
 </div>
 <div className="space-y-1.5">
 <Label>Unit / Suite / Floor <span className="text-muted-foreground">(optional)</span></Label>
 <Input value={value.unitSuite ?? ""} onChange={(e) => set("unitSuite", e.target.value || null)} data-testid="input-unit" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">State / Province / Territory <span className="text-rose-500">*</span></Label>
 <Input value={value.stateProvince} onChange={(e) => set("stateProvince", e.target.value)} placeholder="e.g. California" data-testid="input-state" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">City <span className="text-rose-500">*</span></Label>
 <Input value={value.city} onChange={(e) => set("city", e.target.value)} data-testid="input-city" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Postal Code / Zip <span className="text-rose-500">*</span></Label>
 <Input value={value.postalCode} onChange={(e) => set("postalCode", e.target.value)} data-testid="input-postal" />
 </div>
 </div>
 </CardContent>
 </Card>
 );
}

/* ============================ STEP 3 ============================ */
function Step3LegalEntity({
 value, onChange,
}: { value: CompanyProfile["legal"]; onChange: (next: CompanyProfile["legal"]) => void }) {
 const set = <K extends keyof CompanyProfile["legal"]>(k: K, v: CompanyProfile["legal"][K]) => onChange({ ...value, [k]: v });
 const allowedEntities = entityTypesForCountry(value.countryOfIncorporationCode);
 return (
 <Card>
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Step 3: Legal Entity Information</CardTitle>
 </CardHeader>
 <CardContent className="space-y-5">
 <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start gap-3">
 <FlaskConical className="h-4 w-4 text-[hsl(var(--highlight))] shrink-0 mt-0.5" />
 <div className="text-xs">
 <strong>Region drives the engine.</strong> The country of incorporation here selects which regional formula pack runs everywhere on the platform — cap-table view, term-sheet templates, KYC variant for invited investors.
 </div>
 </div>

 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Upload Articles of Incorporation <span className="text-rose-500">*</span></Label>
 <Input
 type="file" accept="application/pdf"
 onChange={(e) => {
 const f = e.target.files?.[0];
 if (!f) return;
 set("articlesFileName", f.name);
 set("articlesFileSizeBytes", f.size);
 }}
 data-testid="input-articles"
 />
 {value.articlesFileName && (
 <div className="text-xs text-muted-foreground flex items-center gap-1.5">
 <Upload className="h-3 w-3" /> {value.articlesFileName} · {Math.round((value.articlesFileSizeBytes ?? 0) / 1024)} KB
 </div>
 )}
 </div>

 <div className="grid md:grid-cols-2 gap-5">
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Legal Entity Name <span className="text-rose-500">*</span></Label>
 <Input value={value.legalEntityName} onChange={(e) => set("legalEntityName", e.target.value)} placeholder="e.g. Acme Inc." data-testid="input-legal-name" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Business Number / Identification Number <span className="text-muted-foreground text-[11px]">(optional)</span></Label>
 <Input value={value.businessNumber} onChange={(e) => set("businessNumber", e.target.value)} placeholder="EIN / business number (optional)" data-testid="input-business-number" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">
 Country of Incorporation <span className="text-rose-500">*</span>
 <HelpTip>Drives the engine region used across cap-table, rounds, and term-sheet templates.</HelpTip>
 </Label>
 <CountryPicker value={value.countryOfIncorporationCode} onChange={(c) => {
 // v23.8 W-2 — when the jurisdiction changes, an entityType picked for the
 // prior country may not exist in the new country's list. Radix Select then
 // renders the placeholder ("appears not selected") while state still holds
 // the orphaned value, so save complained "Entity type missing"/mismatched.
 // Clear the orphaned value atomically so the displayed and submitted values
 // always agree.
 const stillValid = entityTypesForCountry(c).some((o) => o.value === value.entityType);
 onChange({ ...value, countryOfIncorporationCode: c, entityType: stillValid ? value.entityType : null });
 }} testId="picker-country-incorp" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Type of Entity <span className="text-rose-500">*</span></Label>
 <Select value={value.entityType ?? ""} onValueChange={(v) => set("entityType", (v || null) as typeof value.entityType)}>
 <SelectTrigger data-testid="select-entity-type"><SelectValue placeholder="Select entity type…" /></SelectTrigger>
 <SelectContent>
 {allowedEntities.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
 </SelectContent>
 </Select>
 {allowedEntities.length <= 1 && (
 <div className="text-[11px] text-muted-foreground">Pick a country first to see jurisdiction-appropriate entity types.</div>
 )}
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">
 Public exchange? <span className="text-rose-500">*</span>
 <HelpTip>Is the company traded on a public stock exchange?</HelpTip>
 </Label>
 <YesNoRadio value={value.isPubliclyTraded} onChange={(v) => set("isPubliclyTraded", v)} testId="radio-public" />
 </div>
 </div>

 {value.isPubliclyTraded === true && (
 <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3" data-testid="section-exchange-picker">
 <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Public listing details</div>
 <div className="grid md:grid-cols-3 gap-3">
 <div className="space-y-1.5">
 <Label>Listing country</Label>
 <Select
 value={value.listingCountryCode ?? ""}
 onValueChange={(v) => {
 set("listingCountryCode", v);
 // Clear exchangeCode if country changes
 const stillValid = exchangesForCountry(v).some((e) => e.code === (value.exchangeCode ?? ""));
 if (!stillValid) set("exchangeCode", "");
 }}
 >
 <SelectTrigger data-testid="select-listing-country"><SelectValue placeholder="Select country…" /></SelectTrigger>
 <SelectContent className="max-h-72">
 {EXCHANGE_COUNTRIES.map((c) => (
 <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label>Exchange</Label>
 <Select
 value={value.exchangeCode ?? ""}
 onValueChange={(v) => set("exchangeCode", v)}
 disabled={!value.listingCountryCode}
 >
 <SelectTrigger data-testid="select-exchange"><SelectValue placeholder={value.listingCountryCode ? "Select exchange…" : "Pick country first"} /></SelectTrigger>
 <SelectContent className="max-h-72">
 {exchangesForCountry(value.listingCountryCode ?? "").map((e) => (
 <SelectItem key={e.code} value={e.code}>{e.label}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label>Ticker symbol</Label>
 <Input
 value={value.tickerSymbol ?? ""}
 onChange={(e) => set("tickerSymbol", e.target.value.toUpperCase())}
 placeholder="e.g. AAPL"
 maxLength={20}
 data-testid="input-ticker-symbol"
 />
 </div>
 </div>
 </div>
 )}

 <div className="space-y-1.5">
 <Label className="flex items-center gap-1">Registered Office Address <span className="text-rose-500">*</span></Label>
 <Textarea value={value.registeredOfficeAddress} onChange={(e) => set("registeredOfficeAddress", e.target.value)} rows={3} data-testid="textarea-registered-office" />
 </div>

 {/* Read-only adaptations */}
 <div className="grid md:grid-cols-3 gap-3 rounded-md border border-border bg-muted/30 p-3">
 <div>
 <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Region (auto-derived)</div>
 <div className="text-sm font-medium" data-testid="text-region">{value.region}</div>
 </div>
 <div>
 <div className="text-[10px] uppercase tracking-wider text-muted-foreground">KYC variant (jurisdiction-aware)</div>
 <div className="text-sm font-medium" data-testid="text-kyc-variant">{value.kycVariant}</div>
 </div>
 <div>
 <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Engine attribution</div>
 <div className="text-sm font-medium" data-testid="text-engine-attribution">{value.engineAttribution}</div>
 </div>
 </div>
 </CardContent>
 </Card>
 );
}

/* ============================ STEP 4 ============================ */
function Step4MaIntent({
 value, onChange,
}: { value: CompanyProfile["ma"]; onChange: (next: CompanyProfile["ma"]) => void }) {
 const set = <K extends keyof CompanyProfile["ma"]>(k: K, v: CompanyProfile["ma"][K]) => onChange({ ...value, [k]: v });
 const score = useMemo(() => computeMaReadinessScore(value), [value]);
 return (
 <div className="space-y-5">
 <Card>
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4" /> Step 4: Strategic Intent for JV / M&A</CardTitle>
 </CardHeader>
 <CardContent className="text-xs text-muted-foreground">
 <p>Determining whether a company is truly &ldquo;ready&rdquo; for a joint venture or acquisition requires more than financial performance alone — it reflects strategic alignment, operational maturity, and a clear value narrative. Please complete the following section transparently to help assess your company&apos;s readiness for a JV or acquisition, and update it as your business evolves.</p>
 </CardContent>
 </Card>

 {/* Score panel */}
 <Card data-testid="card-ma-score">
 <CardHeader>
 <CardTitle className="text-sm flex items-center gap-2"><FlaskConical className="h-4 w-4" /> M&A readiness score</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="flex items-end gap-4 mb-3">
 <div className="text-4xl font-semibold tabular-nums" data-testid="text-ma-score">{score.score}</div>
 <div className="text-xs text-muted-foreground mb-1">/ 100</div>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
 {score.components.map((c) => (
 <div key={c.label} className="text-[11px] flex justify-between border border-border rounded px-2 py-1">
 <span className="text-muted-foreground">{c.label}</span>
 <span className="font-mono">{Math.min(c.weight, c.awarded).toFixed(0)} / {c.weight}</span>
 </div>
 ))}
 </div>
 </CardContent>
 </Card>

 {/* Section 1 */}
 <Card>
 <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Briefcase className="h-4 w-4" /> Section 1 — Strategic Intent (next 24 months)</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 <div>
 <Label className="text-xs">Top 3 strategic priorities <span className="text-muted-foreground font-normal">(select up to 3)</span></Label>
 <div className="mt-2">
 <ChipMultiSelect options={STRATEGIC_PRIORITY_OPTIONS} value={value.strategicPriorities} onChange={(v) => set("strategicPriorities", v)} max={3} testIdPrefix="chip-priority" />
 </div>
 </div>
 <div>
 <Label className="text-xs flex items-center gap-1">
 Are you actively interested in <HelpTip>Multi-select. Select all transaction types you would consider in the next 24 months.</HelpTip>
 </Label>
 <div className="mt-2">
 <ChipMultiSelect options={TRANSACTION_INTEREST_OPTIONS} value={value.transactionInterests} onChange={(v) => set("transactionInterests", v)} testIdPrefix="chip-tx-interest" />
 </div>
 </div>
 <div>
 <Label className="text-xs">Partner types sought</Label>
 <div className="mt-2">
 <ChipMultiSelect options={PARTNER_TYPE_OPTIONS} value={value.partnerTypesSought} onChange={(v) => set("partnerTypesSought", v)} testIdPrefix="chip-partner" />
 </div>
 </div>
 <div>
 <Label className="text-xs flex items-center gap-1">
 Deal breakers — would NOT consider under any circumstances
 <HelpTip>Anything you mark here will appear as a red flag on the company details page so investors know upfront.</HelpTip>
 </Label>
 <div className="mt-2">
 <ChipMultiSelect options={DEAL_BREAKER_OPTIONS} value={value.dealBreakers} onChange={(v) => set("dealBreakers", v)} testIdPrefix="chip-deal-breaker" />
 </div>
 </div>
 </CardContent>
 </Card>

 {/* Section 2 — Competitors */}
 <Card>
 <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4" /> Section 2 — Top Three Direct Competitors</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 {[1, 2, 3].map((i) => {
 const nameKey = `competitor${i}Name` as keyof CompanyMAIntelligence;
 const urlKey = `competitor${i}WebsiteUrl` as keyof CompanyMAIntelligence;
 const diffKey = `competitor${i}Differentiator` as keyof CompanyMAIntelligence;
 return (
 <div key={i} className="border border-border rounded-md p-3 space-y-3">
 <div className="text-xs font-medium">Competitor {i}</div>
 <div className="grid md:grid-cols-2 gap-3">
 <div className="space-y-1.5">
 <Label className="text-xs">Name of the company</Label>
 <Input value={value[nameKey]} onChange={(e) => set(nameKey, e.target.value)} maxLength={400} data-testid={`input-competitor-${i}-name`} />
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">URL of the company</Label>
 <Input value={value[urlKey]} onChange={(e) => set(urlKey, e.target.value)} placeholder="https://" data-testid={`input-competitor-${i}-url`} />
 </div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">Why do you believe this is a competitor?</Label>
 <Textarea value={value[diffKey]} onChange={(e) => set(diffKey, e.target.value)} maxLength={400} rows={3} data-testid={`textarea-competitor-${i}-diff`} />
 </div>
 </div>
 );
 })}
 </CardContent>
 </Card>

 {/* Section 3 — Governance */}
 <Card>
 <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Shield className="h-4 w-4" /> Section 3 — Corporate Governance</CardTitle></CardHeader>
 <CardContent className="space-y-3">
 <GovYN label="Formal Board of Directors / Advisory Board?" v={value.hasFormalBoard} onChange={(v) => set("hasFormalBoard", v)} testId="radio-gov-board" />
 <GovYN label="Pending litigation, disputes, or regulatory investigations?" v={value.hasPendingLitigation} onChange={(v) => set("hasPendingLitigation", v)} testId="radio-gov-litigation" />
 <GovYN label="Compliant with key sector regulations (data, financial, healthcare)?" v={value.isRegulatoryCompliant} onChange={(v) => set("isRegulatoryCompliant", v)} testId="radio-gov-regulatory" />
 <GovYN label="External legal counsel / law firm retained?" v={value.hasExternalLegalCounsel} onChange={(v) => set("hasExternalLegalCounsel", v)} testId="radio-gov-counsel" />
 <GovYN label="Financial audit by an independent registered firm?" v={value.isFinanciallyAudited} onChange={(v) => set("isFinanciallyAudited", v)} testId="radio-gov-audit" />
 <GovYN label="SaaS / recurring-revenue business model?" v={value.isSaasRecurring} onChange={(v) => set("isSaasRecurring", v)} testId="radio-gov-saas" />
 <GovYN label="Material IP holdings (patents, trademarks, copyrights)?" v={value.holdsMaterialIp} onChange={(v) => set("holdsMaterialIp", v)} testId="radio-gov-ip" />
 <GovYN label="ESG reporting framework adopted?" v={value.hasEsgFramework} onChange={(v) => set("hasEsgFramework", v)} testId="radio-gov-esg" />
 <GovYN label="DEI policy in place?" v={value.hasDeiPolicy} onChange={(v) => set("hasDeiPolicy", v)} testId="radio-gov-dei" />
 <GovYN label="Cybersecurity compliance certification (SOC 2, ISO 27001)?" v={value.hasCybersecurityCertification} onChange={(v) => set("hasCybersecurityCertification", v)} testId="radio-gov-cyber" />

 <div className="space-y-1.5 pt-2 border-t border-border">
 <Label className="text-xs">Accounting firm name <span className="text-muted-foreground font-normal">(optional)</span></Label>
 <Input value={value.accountingFirmName} onChange={(e) => set("accountingFirmName", e.target.value)} data-testid="input-accounting-firm" />
 </div>
 </CardContent>
 </Card>

 {/* Section 4 — Market Presence */}
 <Card>
 <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Section 4 — Market, Customers, and Contracts</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 <div>
 <Label className="text-xs">Operating geographies (select all that apply)</Label>
 <div className="mt-2">
 <ChipMultiSelect columns={2} options={OPERATING_GEOGRAPHY_OPTIONS} value={value.operatingGeographies} onChange={(v) => set("operatingGeographies", v)} testIdPrefix="chip-geo" />
 </div>
 </div>
 <div>
 <Label className="text-xs">Primary customer segments</Label>
 <div className="mt-2">
 <ChipMultiSelect options={CUSTOMER_SEGMENT_OPTIONS} value={value.customerSegments} onChange={(v) => set("customerSegments", v)} testIdPrefix="chip-segment" />
 </div>
 </div>
 <GovYN
 label="Material exclusivity / non-compete / MFN clauses with customers, suppliers, or partners?"
 help={<>MFN = &ldquo;Most-Favored-Nation&rdquo; clause: any improvement offered to another customer is automatically extended to this one.</>}
 v={value.hasMfnExclusivity} onChange={(v) => set("hasMfnExclusivity", v)} testId="radio-mkt-mfn"
 />
 <GovYN
 label="Revenue concentration > 30% with any single customer or supplier?"
 v={value.hasRevenueConcentration30Pct} onChange={(v) => set("hasRevenueConcentration30Pct", v)} testId="radio-mkt-concentration"
 />
 <GovYN
 label="Long-term contracts requiring consent or change-of-control approval in a transaction?"
 help={<>Change-of-control: a contract clause that triggers re-negotiation or termination if the company is sold or merges.</>}
 v={value.hasChangeOfControlClauses} onChange={(v) => set("hasChangeOfControlClauses", v)} testId="radio-mkt-coc"
 />
 </CardContent>
 </Card>

 {/* Section 5 — Narrative */}
 <Card>
 <CardHeader><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> Section 5 — Readiness Narrative</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 <div className="space-y-1.5">
 <Label className="text-xs">M&A readiness narrative — why are you (or aren&apos;t you) ready?</Label>
 <Textarea value={value.maReadinessNarrative} onChange={(e) => set("maReadinessNarrative", e.target.value)} rows={6} maxLength={2000} data-testid="textarea-ma-readiness" />
 <div className="text-[11px] text-muted-foreground text-right">{value.maReadinessNarrative.length} / 2000</div>
 </div>
 <div className="space-y-1.5">
 <Label className="text-xs">Unique value proposition vs competitors (one or two sentences)</Label>
 <Textarea value={value.uniqueValueProposition} onChange={(e) => set("uniqueValueProposition", e.target.value)} rows={3} maxLength={800} data-testid="textarea-uvp" />
 <div className="text-[11px] text-muted-foreground text-right">{value.uniqueValueProposition.length} / 800</div>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}

function GovYN({
 label, v, onChange, testId, help,
}: { label: string; v: boolean; onChange: (b: boolean) => void; testId?: string; help?: React.ReactNode }) {
 return (
 <div className="flex items-center justify-between gap-3 py-1">
 <Label className="text-xs flex items-center gap-1.5">
 {label}
 {help && <HelpTip>{help}</HelpTip>}
 </Label>
 <YesNoRadio value={v} onChange={onChange} testId={testId} />
 </div>
 );
}

// Eat unused imports to avoid lint warnings while we keep them for readability.
void Mail;
void ScanFace;
void AlertTriangle;
void engineAttribution;
