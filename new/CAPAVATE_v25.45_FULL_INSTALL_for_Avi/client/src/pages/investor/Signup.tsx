/**
 * Sprint 7 — Token-gated investor signup at /investor/signup.
 *
 * Behaviour (R200.gating §1):
 * - WITHOUT a `?token=` query param OR with an invalid/expired/revoked
 * token → renders a 404 (not a redirect, not an empty page). This
 * prevents enumeration of the platform by uninvited investors.
 * - WITH a valid token → renders a 3-step inline signup:
 * 1. Confirm identity (full name, phone, country)
 * 2. Investor profile (type, accredited, KYC docs — file upload stub)
 * 3. Privacy + screen name (opt-in checkboxes; default OFF)
 * - On submit → POST /api/invitations/redeem; on success navigate to the
 * invitation detail page so the user lands on their round.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
 Lock, Loader2, CheckCircle2, ChevronLeft, ChevronRight, Shield, IdCard,
 UserRound, Globe2, Phone, Upload, Eye, EyeOff,
} from "lucide-react";
import { CapavateLogo } from "@/components/CapavateLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/lib/role";
import { apiRequest } from "@/lib/queryClient";
import { validateScreenName } from "@/lib/privacy/visibility";
import NotFound from "@/pages/not-found";
void NotFound; // kept for fallback; primary no-token path now redirects

type CheckResp = {
 valid: boolean;
 reason?: string;
 roundId?: string;
 companyId?: string;
 companyName?: string;
 inviteeEmail?: string;
 inviteeName?: string;
 expiresAt?: string;
 prefilledScreenName?: string | null;
};

function getTokenFromHash(): string | null {
 // We're inside wouter's hash router so location.search isn't reliable.
 // The URL looks like https://host/#/investor/signup?token=abc
 if (typeof window === "undefined") return null;
 const hash = window.location.hash || "";
 const qIdx = hash.indexOf("?");
 if (qIdx === -1) return null;
 const params = new URLSearchParams(hash.slice(qIdx + 1));
 return params.get("token");
}

const STEPS = [
 { id: 1, title: "Confirm identity", icon: IdCard, desc: "Full name, phone, country" },
 { id: 2, title: "Investor profile", icon: Shield, desc: "Type, accredited, KYC documents" },
 { id: 3, title: "Privacy & screen name", icon: Eye, desc: "Choose how you appear to co-members" },
];

export default function InvestorSignup() {
 const [, navigate] = useLocation();
 const { setRole } = useRole();
 const { toast } = useToast();
 const token = useMemo(getTokenFromHash, []);

 // Validate the token; until the network round-trip completes we render
 // a small loader rather than 404 (so a brief flash isn't misclassified).
 const check = useQuery<CheckResp>({
 queryKey: ["/api/invitations/check", token ?? ""],
 queryFn: async () => {
 if (!token) return { valid: false };
 const res = await fetch(`/api/invitations/check?token=${encodeURIComponent(token)}`);
 if (res.status === 404) return { valid: false };
 return res.json();
 },
 enabled: !!token,
 retry: false,
 });

 const [step, setStep] = useState(1);
 const [fullName, setFullName] = useState("");
 const [phone, setPhone] = useState("");
 const [country, setCountry] = useState("United States");
 const [investorType, setInvestorType] = useState("angel");
 const [accredited, setAccredited] = useState("yes");
 const [kycFile, setKycFile] = useState<File | null>(null);
 const [screenName, setScreenName] = useState("");
 const [visibleCo, setVisibleCo] = useState(false);
 const [visibleNet, setVisibleNet] = useState(false);
 const [showName, setShowName] = useState(false);
 // Defect 74: stable prefilled ref prevents the effect from fighting user edits
 // when `fullName` / `screenName` appear in the dependency array.
 const prefilledRef = useRef(false);

 // Pre-fill from invitation once it loads.
 useEffect(() => {
 if (prefilledRef.current) return;
 if (!check.data?.valid) return;
 prefilledRef.current = true;
 if (check.data.inviteeName) setFullName(check.data.inviteeName);
 if (check.data.prefilledScreenName) setScreenName(check.data.prefilledScreenName);
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [check.data]);

 const redeem = useMutation<{ ok: boolean; redirectTo?: string; reason?: string }, Error>({
 mutationFn: async () => {
 // A5 (v24.0): apiRequest JSON-stringifies its body, so a FormData payload
 // collapsed to `{}` server-side and the redeem handler returned missing_token.
 // Send the JSON shape the server reads at routes.ts: { token, profile, password }.
 // The token IS the auth; KYC binary upload is handled separately post-redeem.
 const r = await apiRequest("POST", "/api/invitations/redeem", {
 token: token ?? "",
 profile: {
 fullName,
 phone,
 country,
 investorType,
 accredited,
 screenName,
 visibleCo,
 visibleNet,
 },
 });
 return r.json();
 },
 onSuccess: (data) => {
 /* v25.32 P0 — apiRequest throws on non-2xx, so non-ok responses never
  * reach this onSuccess. The redeem mutationFn always either returns
  * data with ok:true or throws — dropped the unreachable else branch. */
 if (data.ok) {
 toast({ title: "Welcome to Capavate", description: "Your account is active. Loading your round invitation…" });
 setRole("investor");
 navigate(data.redirectTo ?? "/investor/dashboard");
 }
 },
 onError: (err) => {
 /* v25.32 P0 — surface the actual server error code/message instead of
  * the generic "Network error" toast. ApiError carries .code and the
  * friendly message via Error.message. */
 toast({ title: "Could not redeem", description: err.message || "Try again in a moment.", variant: "destructive" });
 },
 });

 // Sprint 24: no ?token= → redirect to the unified investor sign-in page
 // (was /investor/login, retired in Sprint 24). Prevents enumeration of the
 // platform by uninvited visitors while sending them to a real page.
 if (!token) {
 navigate("/auth/login?portal=investor");
 return null;
 }
 // Token check still in flight → small loader.
 if (check.isLoading) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
 <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" data-testid="loader-token-check" />
 </div>
 );
 }
 // Token check completed and is invalid → 404.
 if (!check.data?.valid) return <NotFound />;

 const inv = check.data;

 const screenValidation = screenName ? validateScreenName(screenName) : { ok: true as const };
 const canSubmit =
 fullName.trim().length > 1 &&
 phone.trim().length > 4 &&
 !!country &&
 (screenName.length === 0 || screenValidation.ok);

 return (
 <div className="min-h-screen bg-background text-foreground">
 {/* Top brand bar */}
 <div className="h-14 bg-[hsl(219_45%_20%)] flex items-center px-6">
 <span className="inline-flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
 <CapavateLogo className="h-6 w-auto" />
 </span>
 <span className="ml-3 text-white/80 text-sm">Investor onboarding</span>
 <Badge className="ml-3 bg-white/15 text-white/90 border-0 text-[10px]">Single-use invitation token</Badge>
 </div>

 <div className="max-w-3xl mx-auto px-6 py-10">
 {/* Invitation banner */}
 <Card className="border-[hsl(0_100%_40%)] mb-6" data-testid="card-invitation-summary">
 <CardContent className="p-5 flex items-start gap-4">
 <div className="h-10 w-10 rounded-md bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)] flex items-center justify-center shrink-0">
 <Lock className="h-5 w-5" />
 </div>
 <div className="flex-1 min-w-0">
 <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">You've been invited to</div>
 <div className="text-lg font-semibold" data-testid="text-invited-company">{inv.companyName}</div>
 <p className="text-sm text-muted-foreground mt-1">
 Token expires <span className="font-medium text-foreground">{new Date(inv.expiresAt!).toLocaleDateString()}</span>.
 Single-use — once you complete signup it cannot be reused.
 </p>
 </div>
 </CardContent>
 </Card>

 {/* Stepper */}
 <Card className="mb-6">
 <CardContent className="p-4">
 <div className="flex items-center justify-between gap-2">
 {STEPS.map((s, i) => {
 const active = s.id === step;
 const done = s.id < step;
 const Icon = s.icon;
 return (
 <div key={s.id} className="flex items-center gap-3 flex-1">
 <div
 className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 border ${
 done
 ? "bg-emerald-500 text-white border-emerald-500"
 : active
 ? "bg-[hsl(0_100%_40%)] text-white border-[hsl(0_100%_40%)]"
 : "bg-muted text-muted-foreground border-border"
 }`}
 data-testid={`step-${s.id}`}
 >
 {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
 </div>
 <div className="hidden md:block min-w-0">
 <div className={`text-sm font-medium truncate ${active ? "" : "text-muted-foreground"}`}>{s.title}</div>
 <div className="text-xs text-muted-foreground truncate">{s.desc}</div>
 </div>
 {i < STEPS.length - 1 && <div className={`hidden md:block flex-1 h-px ${done ? "bg-emerald-500" : "bg-border"}`} />}
 </div>
 );
 })}
 </div>
 </CardContent>
 </Card>

 <Card>
 <CardHeader><CardTitle className="text-base">{STEPS[step - 1].title}</CardTitle></CardHeader>
 <CardContent className="space-y-5">
 {step === 1 && (
 <div className="space-y-4">
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5" /> Legal full name</Label>
 <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="As it appears on your ID" data-testid="input-full-name" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> Phone</Label>
 <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 415 555 1234" data-testid="input-phone" />
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" /> Country of residence</Label>
 <Select value={country} onValueChange={setCountry}>
 <SelectTrigger data-testid="select-country"><SelectValue /></SelectTrigger>
 <SelectContent>
 {["United States", "United Kingdom", "Singapore", "Germany", "Canada", "Australia", "Japan", "Hong Kong", "India"].map(c => (
 <SelectItem key={c} value={c}>{c}</SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <p className="text-xs text-muted-foreground">
 We use this to map you to the right regulatory regime — Reg D in the US, EMIR in the EU, MAS in Singapore, and so on.
 </p>
 </div>
 )}

 {step === 2 && (
 <div className="space-y-4">
 <div className="space-y-1.5">
 <Label>Type of investor</Label>
 <Select value={investorType} onValueChange={setInvestorType}>
 <SelectTrigger data-testid="select-investor-type"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="angel">Individual / Angel</SelectItem>
 <SelectItem value="vc">Venture fund (LP/GP)</SelectItem>
 <SelectItem value="family_office">Family office</SelectItem>
 <SelectItem value="syndicate">Angel syndicate / SPV</SelectItem>
 <SelectItem value="strategic">Strategic / corporate</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label>Accreditation status</Label>
 <Select value={accredited} onValueChange={setAccredited}>
 <SelectTrigger data-testid="select-accredited"><SelectValue /></SelectTrigger>
 <SelectContent>
 <SelectItem value="yes">Accredited — third-party verified</SelectItem>
 <SelectItem value="self">Accredited — self-attested</SelectItem>
 <SelectItem value="sophisticated">Sophisticated investor</SelectItem>
 <SelectItem value="no">Neither / unsure</SelectItem>
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> KYC document (preview stub)</Label>
 <input
 type="file"
 onChange={(e) => setKycFile(e.target.files?.[0] ?? null)}
 className="block w-full text-xs text-muted-foreground file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-secondary file:text-foreground hover:file:bg-secondary/80 cursor-pointer"
 data-testid="input-kyc-file"
 />
 {kycFile && <div className="text-xs text-emerald-600 ">{kycFile.name} · {Math.round(kycFile.size / 1024)} KB</div>}
 <p className="text-xs text-muted-foreground">
 In production this is encrypted at rest with KMS-per-tenant. The preview accepts a file but does not upload it.
 </p>
 </div>
 </div>
 )}

 {step === 3 && (
 <div className="space-y-4">
 <div className="rounded-md border border-border bg-muted/40 p-4 text-sm space-y-1">
 <div className="font-medium flex items-center gap-1.5"><Shield className="h-4 w-4 text-[hsl(0_100%_40%)]" /> Privacy by default</div>
 <p className="text-muted-foreground text-xs leading-relaxed">
 All visibility is opt-in. If you leave these toggles off, your identity is hidden from co-investors,
 your portfolio is yours alone, and no one can message you through Capavate.
 </p>
 </div>

 <div className="space-y-1.5">
 <Label>Screen name (optional)</Label>
 <div className="relative">
 <Input
 value={screenName}
 onChange={e => setScreenName(e.target.value)}
 placeholder="e.g. maya_chen, GreenwoodCap"
 type={showName ? "text" : "password"}
 data-testid="input-screen-name"
 />
 <button type="button" onClick={() => setShowName(s => !s)} className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground">
 {showName ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
 </button>
 </div>
 {!screenValidation.ok && (
 <p className="text-xs text-rose-600 " data-testid="text-screen-name-error">
 {screenValidation.reason === "too_short" && "Screen name must be at least 3 characters."}
 {screenValidation.reason === "too_long" && "Screen name must be 30 characters or fewer."}
 {screenValidation.reason === "invalid_chars" && "Letters, digits, underscore, and dash only."}
 {screenValidation.reason === "taken" && "That screen name is already taken."}
 </p>
 )}
 <p className="text-xs text-muted-foreground">3–30 characters · letters, digits, underscore, and dash only.</p>
 </div>

 <label className="flex items-start gap-2.5 cursor-pointer">
 <Checkbox checked={visibleCo} onCheckedChange={(v) => setVisibleCo(v === true)} data-testid="checkbox-visible-co" />
 <div>
 <div className="text-sm font-medium">Visible to cap-table co-members</div>
 <p className="text-xs text-muted-foreground mt-0.5">Other people on cap tables you share can find you by your screen name.</p>
 </div>
 </label>

 <label className="flex items-start gap-2.5 cursor-pointer">
 <Checkbox checked={visibleNet} onCheckedChange={(v) => setVisibleNet(v === true)} data-testid="checkbox-visible-net" />
 <div>
 <div className="text-sm font-medium">Visible to the broader Capavate Collective network</div>
 <p className="text-xs text-muted-foreground mt-0.5">Eligible Collective members can discover you by your screen name.</p>
 </div>
 </label>
 </div>
 )}

 <div className="flex items-center justify-between pt-3 border-t border-border">
 <Button variant="outline" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1} data-testid="button-step-back">
 <ChevronLeft className="h-4 w-4 mr-1" /> Back
 </Button>
 <div className="text-xs text-muted-foreground">Step {step} of 3</div>
 {step < 3 ? (
 <Button onClick={() => setStep(s => s + 1)} className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white" data-testid="button-step-next">
 Continue <ChevronRight className="h-4 w-4 ml-1" />
 </Button>
 ) : (
 <Button
 onClick={() => redeem.mutate()}
 disabled={!canSubmit || redeem.isPending}
 className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
 data-testid="button-submit-signup"
 >
 {redeem.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
 Accept invitation & enter
 </Button>
 )}
 </div>
 </CardContent>
 </Card>

 <p className="text-center text-xs text-muted-foreground mt-6">
 Already on Capavate? <a href="/#/auth/login?portal=investor" className="underline hover:text-foreground" data-testid="link-to-login">Sign in instead</a>
 </p>
 </div>
 </div>
 );
}
