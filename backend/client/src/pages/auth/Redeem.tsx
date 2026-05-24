/**
 * Sprint 15 D5 — Investor invitation token redemption.
 *
 * The ONLY entry path for investors (rule a). Single-use SHA-256-hashed
 * 256-bit `crypto.randomBytes` token, 30-day expiry — preserved from
 * Sprint 7, just relocated into the new auth shell.
 *
 * UI per CAPAVATE-LOGIN-DESIGN.md Part 6:
 *   - Show invitation context (company / round / invited-by / expires)
 *   - Email is locked
 *   - Choose password + confirm + agree to terms
 *   - "View this round" CTA → POST /api/auth/redeem → land on round deal page
 *
 * Edge cases handled (Part 9 #6, #8):
 *   - 404/invalid → shows error state
 *   - 409 already_redeemed → "this invitation has already been redeemed"
 *   - 410 expired → "request a new invitation" + magic link explainer
 *
 * SANDBOX-SAFE: no Web Storage APIs.
 */
import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/pages/auth/AuthShell";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/lib/role";

type Preview = {
  ok: true;
  invitation: {
    roundId: string;
    companyId: string;
    companyName: string;
    inviteeEmail: string;
    inviteeName: string;
    expiresAt: string;
    roundLabel?: string;
    founderName?: string;
  };
};

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

function readToken(): string {
  if (typeof window === "undefined") return "";
  const search = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(search).get("token") ?? "";
}

function daysUntil(iso: string): number {
  const d = (new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(d));
}

export default function Redeem() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { setRole } = useRole();
  const token = useMemo(readToken, []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  // Query the preview (does not consume the token).
  const previewQ = useQuery<Preview>({
    queryKey: ["/api/auth/redeem/preview", token],
    queryFn: async () => {
      if (!token) throw Object.assign(new Error("missing"), { status: 400 });
      const res = await fetch(`${API_BASE}/api/auth/redeem/preview?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw Object.assign(new Error(body.error ?? "preview_failed"), { status: res.status, error: body.error });
      }
      return res.json() as Promise<Preview>;
    },
    enabled: !!token,
    retry: false,
  });

  const errorState = useMemo(() => {
    if (!token) return { kind: "missing" as const, title: "No token provided", body: "Open the secure link from your invitation email, or paste it into your browser." };
    if (previewQ.isError) {
      const e = previewQ.error as { status?: number; error?: string };
      if (e.error === "expired" || e.status === 410) {
        return { kind: "expired" as const, title: "This invitation has expired", body: "Ask the founder to send you a new invitation. Magic links live for 30 days by default." };
      }
      if (e.error === "already_redeemed" || e.status === 409) {
        return { kind: "already_redeemed" as const, title: "This invitation has already been redeemed", body: "If this is your account, sign in with your password instead." };
      }
      if (e.status === 404 || e.error === "not_found") {
        return { kind: "not_found" as const, title: "We don't recognise this invitation", body: "Double-check the URL from your invitation email — tokens are single-use and case-sensitive." };
      }
      if (e.error === "revoked") {
        return { kind: "revoked" as const, title: "This invitation was revoked", body: "Ask the founder to issue a new invitation." };
      }
      return { kind: "other" as const, title: "Couldn't load this invitation", body: "Please try again in a moment." };
    }
    return null;
  }, [token, previewQ.isError, previewQ.error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    if (password.length < 8) return setSubmitErr("Choose a password of at least 8 characters.");
    if (password !== confirm) return setSubmitErr("Passwords don't match.");
    if (!agreed) return setSubmitErr("Please agree to the terms.");
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/redeem", { token, password, agreedToTerms: agreed });
      const json = await res.json() as { ok: true; redirectTo: string; companyId: string };
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setRole("investor");
      toast({ title: "Welcome to Capavate", description: "Redirecting you to the round…" });
      navigate(json.redirectTo);
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("409")) setSubmitErr("This invitation has already been redeemed.");
      else if (msg.includes("410")) setSubmitErr("This invitation has expired.");
      else setSubmitErr("We couldn't redeem this invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  if (errorState) {
    return (
      <AuthShell title={errorState.title} subtitle="Investor invitation">
        <p className="text-sm text-muted-foreground" data-testid="text-redeem-error">
          {errorState.body}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/" data-testid="link-redeem-back-home">
            <Button variant="outline" className="w-full">Back to home</Button>
          </Link>
          {errorState.kind === "already_redeemed" && (
            <Link href="/auth/login?portal=investor" data-testid="link-redeem-signin">
              <Button className="w-full">Sign in instead</Button>
            </Link>
          )}
          {errorState.kind === "expired" && (
            <Link href="/auth/forgot" data-testid="link-redeem-request-new">
              <Button className="w-full">Request a new link</Button>
            </Link>
          )}
        </div>
      </AuthShell>
    );
  }

  if (previewQ.isLoading) {
    return (
      <AuthShell title="Loading your invitation…" subtitle="Investor invitation">
        <div className="space-y-3">
          <div className="h-4 w-2/3 bg-muted animate-pulse rounded" />
          <div className="h-4 w-1/2 bg-muted animate-pulse rounded" />
          <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
        </div>
      </AuthShell>
    );
  }

  const inv = previewQ.data!.invitation;

  return (
    <AuthShell
      title="You've been invited to view a round on Capavate"
      subtitle="Set your password to view the round."
      footer={
        <div className="text-xs">
          Already redeemed? <Link href="/auth/login?portal=investor" className="text-[hsl(184_98%_22%)] hover:underline" data-testid="link-redeem-existing">Sign in</Link>
        </div>
      }
    >
      <div className="rounded-md border border-black/10 bg-muted/30 p-4 text-sm" data-testid="redeem-context">
        <Row label="Company" value={inv.companyName} testId="row-company" />
        <Row label="Round" value={inv.roundLabel ?? "Open round"} testId="row-round" />
        <Row label="Invited by" value={inv.founderName ?? "Founder"} testId="row-founder" />
        <Row label="Expires" value={`in ${daysUntil(inv.expiresAt)} days`} testId="row-expires" />
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" data-testid="form-redeem">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={inv.inviteeEmail} disabled data-testid="input-email-locked" />
          <p className="mt-1 text-xs text-muted-foreground">Locked — this is the address the invitation was sent to.</p>
        </div>
        <div>
          <Label htmlFor="password">Choose password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} data-testid="input-password" />
        </div>
        <div>
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} data-testid="input-confirm" />
        </div>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} data-testid="checkbox-tos" />
          <span className="text-muted-foreground">I agree to the Capavate Terms of Service and Privacy Policy.</span>
        </label>
        {submitErr && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="text-redeem-submit-error">
            {submitErr}
          </div>
        )}
        <Button type="submit" className="w-full" disabled={submitting} data-testid="button-submit-redeem">
          {submitting ? "Redeeming…" : "View this round"}
        </Button>
      </form>
    </AuthShell>
  );
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between py-1" data-testid={testId}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
