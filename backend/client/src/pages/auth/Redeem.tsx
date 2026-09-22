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
import { useState, useMemo, useEffect } from "react";
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
  // BUG N6 — true when the invitee email already maps to a registered account.
  // Existing users must NOT be forced through registration/password-set again;
  // they sign in and land on the round instead.
  existingAccount?: boolean;
  sessionState?: "new_account" | "sign_in_required" | "matching" | "mismatch";
  invitation: {
    /* v25.48.3 Q-J1 — team invitations reuse this envelope with kind:"team".
     * Investor/round invitations omit `kind` (treated as "investor"). */
    kind?: "team" | "investor";
    roundId?: string;
    companyId: string;
    companyName: string;
    inviteeEmail: string;
    inviteeName: string;
    expiresAt: string;
    roundLabel?: string;
    founderName?: string;
    role?: string;
  };
};

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

// L-007 fix v23.4.13: parse URL token + manual paste
// App uses BrowserRouter (History API) — token is in window.location.search, not hash.
function readToken(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

function daysUntil(iso: string): number {
  const d = (new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(d));
}

/** Team-only errors: an identity conflict is NOT a consumed/expired token. */
function teamErrorCopy(code?: string | null): string | null {
  switch (code) {
    case "INVITED_IDENTITY_AMBIGUOUS":
    case "INVITED_IDENTITY_CHANGED":
    case "INVITED_IDENTITY_INCOMPLETE":
      return "We cannot safely match this invitation to an account. Contact your administrator.";
    case "INVITED_IDENTITY_STATE_CHANGED":
      return "The account for this invitation changed. Refresh this page and try again.";
    case "IDENTITY_STATE_NEEDS_OPERATOR":
      return "Your account needs administrator attention before this invitation can be accepted. Contact your administrator; retrying now will not resolve it.";
    case "INVITED_IDENTITY_DELETED":
      return "The account for this invitation is deleted or unavailable for reuse. Contact your administrator.";
    case "SESSION_IDENTITY_MISMATCH":
      return "You are signed in to a different account. Sign out, then sign in with the invited email shown here. Your current account has not been signed out automatically.";
    case "SIGN_IN_REQUIRED_TO_ACCEPT":
      return "Sign in with the invited email to accept this invitation.";
    case "ACCOUNT_NOT_ACTIVE":
      return "Your account is not active. Contact your administrator before accepting this invitation.";
    case "ACCOUNT_RESOLUTION_UNAVAILABLE":
    case "ACCOUNT_STATUS_UNAVAILABLE":
    case "TEAM_INVITE_LOOKUP_FAILED":
      return "We could not confirm your account or invitation just now. Please try again.";
    case "PERSONA_NOT_DURABLE":
      return "Your account could not be safely created. The invitation has not been accepted. Contact your administrator before trying again.";
    case "TERMS_NOT_ACCEPTED":
      return "Please agree to the terms before accepting.";
    case "expired":
      return "This invitation has expired. Ask for a new invitation.";
    case "revoked":
      return "This invitation was revoked. Ask for a new invitation.";
    case "already_redeemed":
      return "This invitation has already been redeemed.";
    default:
      return null;
  }
}

export default function Redeem() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { setRole } = useRole();
  const urlToken = useMemo(readToken, []);
  // L-007 fix v23.4.13: manual paste fallback for users without email link
  const [manualToken, setManualToken] = useState("");
  const [manualTokenSubmitted, setManualTokenSubmitted] = useState(false);
  const token = manualTokenSubmitted && manualToken.trim() ? manualToken.trim() : urlToken;
  // v25.53 REVISE B1 — `continue=1` marks the return trip AFTER the existing
  // investor has authenticated via login (returnTo brought them back here). On
  // that trip we auto-POST the require-auth redeem so the single-use token is
  // consumed and associated with the now-authenticated user.
  const continueFlag = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("continue") === "1";
  }, []);
  const [autoFired, setAutoFired] = useState(false);
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
        const body = await res.json().catch(() => ({} as { error?: string; kind?: string }));
        throw Object.assign(new Error(body.error ?? "preview_failed"), { status: res.status, error: body.error, kind: body.kind });
      }
      return res.json() as Promise<Preview>;
    },
    enabled: !!token,
    retry: false,
  });

  const errorState = useMemo(() => {
    if (!token) return { kind: "missing" as const, title: "No token provided", body: "Open the secure link from your invitation email, or paste your token below." };
    if (previewQ.isError) {
      const e = previewQ.error as { status?: number; error?: string; kind?: string };
      if (e.kind === "team") {
        const title = e.error === "expired" ? "This invitation has expired"
          : e.error === "revoked" ? "This invitation was revoked"
          : e.error === "already_redeemed" ? "This invitation has already been redeemed"
          : "We couldn't confirm this account";
        return { kind: "team" as const, title, body: teamErrorCopy(e.error) ?? "Couldn't load this company invitation. Please try again." };
      }
      // Identity-specific codes must precede the investor's historic generic
      // 409 handling. Preserve its existing token error behavior otherwise.
      if (e.error?.startsWith("INVITED_IDENTITY_") || e.error?.startsWith("ACCOUNT_")) {
        return { kind: "identity" as const, title: "We couldn't confirm this account", body: teamErrorCopy(e.error) ?? "Please try again." };
      }
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
      const json = await res.json() as { ok: true; redirectTo: string; companyId: string; kind?: "team" | "investor" };
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      /* v25.48.3 Q-J1 — team members join the founder workspace, not a round. */
      const isTeam = json.kind === "team" || previewQ.data?.invitation.kind === "team";
      setRole(isTeam ? "founder" : "investor");
      toast({ title: "Welcome to Capavate", description: isTeam ? "Redirecting you to your workspace…" : "Redirecting you to the round…" });
      navigate(json.redirectTo);
    } catch (err: any) {
      if (previewQ.data?.invitation.kind === "team") {
        setSubmitErr(teamErrorCopy(err?.code) ?? "We couldn't accept this invitation. Please try again.");
        return;
      }
      const msg = String(err?.message ?? "");
      if (msg.includes("409")) setSubmitErr("This invitation has already been redeemed.");
      else if (msg.includes("410")) setSubmitErr("This invitation has expired.");
      else setSubmitErr("We couldn't redeem this invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptExistingTeam(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    if (!agreed) return setSubmitErr("Please agree to the terms before accepting.");
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/redeem", { token, agreedToTerms: true });
      const json = await res.json() as { redirectTo: string };
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setRole("founder");
      toast({ title: "Invitation accepted", description: "Taking you to your company workspace…" });
      navigate(json.redirectTo);
    } catch (err: any) {
      setSubmitErr(teamErrorCopy(err?.code) ?? "We couldn't accept this invitation. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // v25.53 REVISE B1 — existing-account token-consumption flow. This is the
  // authenticated, end-to-end path: POST the require-auth redeem endpoint. When
  // the caller is not yet authenticated the server responds { requiresLogin,
  // redirectTo:/login?...&returnTo=/auth/redeem?...&continue=1 } and we bounce to
  // login (which honors `returnTo`, NOT `next`); after authentication login
  // returns here with continue=1 and we auto-fire this again — now authenticated,
  // so the server consumes the single-use token, associates it with the user, and
  // returns the invitation-authorized surface (/investor/invitations/:id).
  async function redeemExisting() {
    setSubmitErr(null);
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/auth/redeem", { token, continue: true });
      const json = await res.json() as { ok: true; requiresLogin?: boolean; redirectTo: string };
      if (json.requiresLogin) {
        // Not authenticated yet — go authenticate, then return to finish (continue=1).
        navigate(json.redirectTo);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setRole("investor");
      toast({ title: "Invitation accepted", description: "Taking you to the invitation…" });
      navigate(json.redirectTo);
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("409")) setSubmitErr("This invitation has already been redeemed.");
      else if (msg.includes("410")) setSubmitErr("This invitation has expired.");
      else if (msg.includes("503")) setSubmitErr("We couldn't confirm your account just now. Please try again.");
      else setSubmitErr("We couldn't complete this invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  // v25.53 REVISE B1 — on the post-login return trip (continue=1) auto-consume
  // the token for the existing, now-authenticated investor. Fires exactly once.
  useEffect(() => {
    if (autoFired) return;
    const d = previewQ.data;
    if (d?.existingAccount && d.invitation.kind !== "team" && continueFlag) {
      setAutoFired(true);
      void redeemExisting();
    }
    // redeemExisting is stable (hoisted); intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewQ.data, continueFlag, autoFired]);

  if (errorState) {
    return (
      <AuthShell title={errorState.title} subtitle={errorState.kind === "identity" || errorState.kind === "team" ? "Company invitation" : "Investor invitation"}>
        <p className="text-sm text-muted-foreground" data-testid="text-redeem-error">
          {errorState.body}
        </p>
        {/* L-007 fix v23.4.13: manual paste field for users without the email link */}
        {errorState.kind === "missing" && (
          <div className="mt-4 space-y-2">
            <Label htmlFor="manual-token">Paste your invitation token</Label>
            <div className="flex gap-2">
              <Input
                id="manual-token"
                value={manualToken}
                onChange={e => setManualToken(e.target.value)}
                placeholder="Paste token from invitation email"
                data-testid="input-manual-token"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={() => { if (manualToken.trim()) setManualTokenSubmitted(true); }}
                disabled={!manualToken.trim()}
                data-testid="button-redeem-manual-token"
              >Redeem</Button>
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="outline" className="w-full" asChild>
            <Link href="/" data-testid="link-redeem-back-home">Back to home</Link>
          </Button>
          {errorState.kind === "already_redeemed" && (
            <Button className="w-full" asChild>
              <Link href="/auth/login?portal=investor" data-testid="link-redeem-signin">Sign in instead</Link>
            </Button>
          )}
          {errorState.kind === "expired" && (
            <Button className="w-full" asChild>
              <Link href="/auth/forgot" data-testid="link-redeem-request-new">Request a new link</Link>
            </Button>
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
  const existingAccount = previewQ.data!.existingAccount === true;
  // No request-controlled returnTo is forwarded. Encode the token as query
  // data inside a fixed, site-relative claim URL, then encode that URL for login.
  const teamLoginUrl = `/login?returnTo=${encodeURIComponent(`/auth/redeem?token=${encodeURIComponent(token)}&continue=1`)}`;

  if (existingAccount && inv.kind === "team") {
    const matchingSession = previewQ.data!.sessionState === "matching";
    const mismatch = previewQ.data!.sessionState === "mismatch";
    return (
      <AuthShell
        title={matchingSession ? "Accept your company invitation" : "Sign in to accept invitation"}
        subtitle="Join your company's team on Capavate."
      >
        <div className="rounded-md border border-black/10 bg-muted/30 p-4 text-sm" data-testid="redeem-context">
          <Row label="Company" value={inv.companyName} testId="row-company" />
          <Row label="Team role" value={inv.role ?? "member"} testId="row-team-role" />
          <Row label="Expires" value={`in ${daysUntil(inv.expiresAt)} days`} testId="row-expires" />
        </div>
        <div className="mt-4">
          <Label htmlFor="email">Invited email</Label>
          <Input id="email" value={inv.inviteeEmail} disabled data-testid="input-email-locked" />
        </div>
        {mismatch && (
          <p className="mt-4 text-sm text-red-700" data-testid="text-redeem-session-mismatch">
            {teamErrorCopy("SESSION_IDENTITY_MISMATCH")}
          </p>
        )}
        {matchingSession && (
          <form onSubmit={acceptExistingTeam} className="mt-6 space-y-4" data-testid="form-redeem-team-accept">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={agreed} onCheckedChange={v => setAgreed(v === true)} data-testid="checkbox-tos" />
              <span>I agree to the Capavate Terms of Service and Privacy Policy.</span>
            </label>
            <Button type="submit" disabled={submitting || !agreed} className="w-full rounded-full font-semibold" data-testid="button-accept-team-invitation">
              {submitting ? "Accepting…" : "Accept invitation"}
            </Button>
          </form>
        )}
        {submitErr && (
          <p className="mt-4 text-sm text-red-700" data-testid="text-redeem-submit-error">{submitErr}</p>
        )}
        {(!matchingSession || submitErr) && (
          <Button asChild className="mt-6 w-full rounded-full font-semibold">
            <Link href={teamLoginUrl} data-testid="link-team-invitation-signin">Sign in to accept invitation</Link>
          </Button>
        )}
      </AuthShell>
    );
  }

  // BUG N6 — the invitee already has a Capavate account. Do NOT show the
  // password-set form (which would force a second registration). Route them to
  // sign in; after login they land straight on the round.
  if (existingAccount && inv.kind !== "team") {
    return (
      <AuthShell
        title="You've been invited to view a round on Capavate"
        subtitle="You already have an account — sign in to accept this invitation."
      >
        <div className="rounded-md border border-black/10 bg-muted/30 p-4 text-sm" data-testid="redeem-context">
          <Row label="Company" value={inv.companyName} testId="row-company" />
          <Row label="Round" value={inv.roundLabel ?? "Open round"} testId="row-round" />
          <Row label="Invited by" value={inv.founderName ?? "Founder"} testId="row-founder" />
          <Row label="Expires" value={`in ${daysUntil(inv.expiresAt)} days`} testId="row-expires" />
        </div>
        <div className="mt-4">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={inv.inviteeEmail} disabled data-testid="input-email-locked" />
          <p className="mt-1 text-xs text-muted-foreground">This email is already registered — sign in with your existing password.</p>
        </div>
        {submitErr && (
          <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="text-redeem-submit-error">
            {submitErr}
          </div>
        )}
        {continueFlag ? (
          // Post-login return trip — the token is being consumed automatically.
          <p className="mt-6 text-sm text-muted-foreground" data-testid="text-redeem-finishing">
            Finishing your sign-in and accepting the invitation…
          </p>
        ) : (
          // First visit — POST the require-auth redeem. Because we are not yet
          // authenticated the server responds requiresLogin and we bounce to
          // login (returnTo), then return here with continue=1 to finish.
          <Button
            type="button"
            onClick={() => redeemExisting()}
            disabled={submitting}
            className="mt-6 w-full rounded-full font-semibold"
            data-testid="button-redeem-existing-signin"
          >
            {submitting ? "Redirecting…" : "Sign in to view this round"}
          </Button>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={inv.kind === "team" ? "Create your account to join the company" : "You've been invited to view a round on Capavate"}
      subtitle={inv.kind === "team" ? "Set your password to join your company's team." : "Set your password to view the round."}
      footer={
        <div className="text-xs">
          Already redeemed? <Link href={inv.kind === "team" ? teamLoginUrl : "/auth/login?portal=investor"} className="text-[#cc0001] hover:underline" data-testid="link-redeem-existing">Sign in</Link>
        </div>
      }
    >
      <div className="rounded-md border border-black/10 bg-muted/30 p-4 text-sm" data-testid="redeem-context">
        <Row label="Company" value={inv.companyName} testId="row-company" />
        {inv.kind === "team" ? (
          <Row label="Team role" value={inv.role ?? "member"} testId="row-team-role" />
        ) : (
          <>
            <Row label="Round" value={inv.roundLabel ?? "Open round"} testId="row-round" />
            <Row label="Invited by" value={inv.founderName ?? "Founder"} testId="row-founder" />
          </>
        )}
        <Row label="Expires" value={`in ${daysUntil(inv.expiresAt)} days`} testId="row-expires" />
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" data-testid="form-redeem">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={inv.inviteeEmail} disabled data-testid="input-email-locked" />
          <p className="mt-1 text-xs text-muted-foreground">
            {inv.kind === "team" ? (
              <>Locked — this is the address on this invitation.</>
            ) : (
              <>Locked — this is the address the invitation was sent to.</>
            )}
          </p>
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
          {/* v25.51 1b (Shadie) — match the shared LegalConsentCheckbox's
              distinct high-contrast emerald so the mandatory consent tick is
              consistent and unmistakable across every consent surface. */}
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5 h-5 w-5 border-2 border-[hsl(158_64%_32%)] bg-white shadow-sm ring-1 ring-[hsl(158_64%_32%)]/25 data-[state=checked]:bg-[hsl(158_64%_32%)] data-[state=checked]:border-[hsl(158_64%_32%)] data-[state=checked]:text-white"
            data-testid="checkbox-tos"
          />
          <span className="text-muted-foreground">I agree to the Capavate Terms of Service and Privacy Policy.</span>
        </label>
        {submitErr && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2" data-testid="text-redeem-submit-error">
            {submitErr}
          </div>
        )}
        {/* v25.43 R4-1 — capavate.com red pill CTA (default Button variant
           inherits the red --primary token; pill + semibold added). */}
        <Button type="submit" className="w-full rounded-full font-semibold" disabled={submitting} data-testid="button-submit-redeem">
          {submitting ? "Redeeming…" : inv.kind === "team" ? "Create account and join company" : "View this round"}
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
