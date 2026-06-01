/**
 * Sprint 24 — Founder-only signup.
 *
 * Investors NEVER self-signup (rule a). The only investor entry path is
 * /auth/redeem with a single-use SHA-256-hashed token.
 *
 * Sprint 24 changes:
 *   - Empty defaults (no "Maya Chen" / "maya@novapay.ai" persona leakage)
 *   - Live password strength meter (8+ chars, mix of upper/lower/digit/symbol)
 *   - Inline error display (was toast-only)
 *   - Email validation feedback before submit
 *   - Server-side 409 (duplicate email) handled with a "sign in instead" CTA
 *
 * SANDBOX-SAFE: no Web Storage APIs.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/pages/auth/AuthShell";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRole } from "@/lib/role";
import { useToast } from "@/hooks/use-toast";
import { UserRound, Mail, Lock, CheckCircle2, AlertCircle } from "lucide-react";
import { useRef, useState as useStateForConsent } from "react";
import { LegalConsentCheckbox, type LegalConsentCheckboxRef } from "@/components/LegalConsentCheckbox";

type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; color: string };

function gradePassword(pw: string): Strength {
  if (pw.length === 0) return { score: 0, label: "", color: "bg-transparent" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const map: Strength[] = [
    { score: 0, label: "Too short",  color: "bg-red-500" },
    { score: 1, label: "Weak",       color: "bg-red-500" },
    { score: 2, label: "Fair",       color: "bg-amber-500" },
    { score: 3, label: "Strong",     color: "bg-emerald-500" },
    { score: 4, label: "Very strong",color: "bg-emerald-600" },
  ];
  return map[Math.min(score, 4)] as Strength;
}

function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default function Signup() {
  const [, navigate] = useLocation();
  const { setRole } = useRole();
  const { toast } = useToast();

  // L-008 fix v23.4.13: gate investor signup — investors join by invitation only
  const portalParam = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("portal") : null;
  const isInvestorPortal = portalParam === "investor";

  // B-V13-1 fix (Avi's Issue 1): if the user is already authenticated, do not
  // show the signup form again — redirect to the appropriate dashboard.
  const meProbe = useQuery<{ isAuthed: boolean; isAdmin?: boolean; founder?: { companies: unknown[] }; investor?: { state?: string } }>({
    queryKey: ["/api/auth/me", "signup-redirect-probe"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/me");
        if (!res.ok) return { isAuthed: false };
        return res.json();
      } catch { return { isAuthed: false }; }
    },
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    const me = meProbe.data;
    if (!me?.isAuthed) return;
    if (me.isAdmin) { navigate("/admin/dashboard"); return; }
    const hasCompany = ((me.founder?.companies?.length) ?? 0) > 0;
    const isInvestor = me.investor?.state !== undefined && me.investor.state !== "NONE";
    if (hasCompany) { navigate("/founder/dashboard"); return; }
    if (isInvestor)  { navigate("/investor/dashboard"); return; }
    navigate("/founder/dashboard");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meProbe.data]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicateEmail, setDuplicateEmail] = useState(false);
  const [legalChecked, setLegalChecked] = useStateForConsent(false);
  const legalConsentRef = useRef<LegalConsentCheckboxRef>(null);
  // v23.4.6 Phase 6 (L-010) — post-signup interstitial state. Holds the
  // email the account was created for so we can echo it on the
  // "check your inbox" interstitial without depending on `email` state
  // (which could be cleared on navigation).
  const [signedUpAs, setSignedUpAs] = useState<string | null>(null);
  const [requiresEmailConfirmation, setRequiresEmailConfirmation] = useState(false);

  const strength = useMemo(() => gradePassword(password), [password]);
  const emailValid = email.length === 0 || looksLikeEmail(email);

  // v23.4.6 Phase 5 (L-006) — aggregate field validation. Mirrors the
  // missingRequired() pattern already in client/src/pages/founder/Company.tsx
  // (v23.4.5). The previous Signup form only surfaced ONE error at a time
  // ("Enter your name to continue.") even when name + email + password were
  // all blank, which forced power users to submit, fix, submit, fix in a
  // frustrating loop. We now collect ALL blank-or-invalid required fields,
  // render an aggregate banner listing them, AND set aria-invalid on each
  // bad input so per-field affordances stay accurate for assistive tech.
  const missingFields = useMemo(() => {
    const missing: string[] = [];
    if (name.trim().length < 2) missing.push("your name");
    if (!looksLikeEmail(email)) missing.push("a valid work email");
    if (password.length < 8) missing.push("a password with at least 8 characters");
    else if (strength.score < 2)
      missing.push("a stronger password (mix upper/lower/digits/symbols)");
    if (!legalChecked) missing.push("the Terms and Privacy consent checkbox");
    return missing;
  }, [name, email, password, strength.score, legalChecked]);
  const [aggregateError, setAggregateError] = useState<string | null>(null);
  // Per-field validity flags exposed so individual <Input>s render their
  // own red border + aria-invalid when the user has tried to submit.
  const nameInvalid = name.trim().length > 0 && name.trim().length < 2;
  const passwordInvalid = password.length > 0 && password.length < 8;
  const showFieldErrors = aggregateError !== null;

  // canSubmit is preserved as the explicit AND cascade so the existing
  // signupCheckboxVisible regression test still pins legalChecked as the
  // final clause. (Semantically equivalent to missingFields.length === 0.)
  const canSubmit =
    name.trim().length >= 2 &&
    looksLikeEmail(email) &&
    password.length >= 8 &&
    strength.score >= 2 &&
    legalChecked;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // v23.4.6 Phase 5 — if any required fields are missing, surface ALL of
    // them in one aggregate message instead of returning silently. This is
    // the L-006 fix: previously the form just returned (button was disabled)
    // which left the user with only the live "first-failing-precondition"
    // hint. Submitting now produces an explicit, listed banner.
    if (!canSubmit) {
      setAggregateError(
        `Please complete: ${missingFields.join(", ")}.`,
      );
      return;
    }
    setAggregateError(null);
    setSubmitting(true);
    setErrorMsg(null);
    setDuplicateEmail(false);
    // apiRequest() throws on non-2xx — we parse status + message from the
    // thrown error string (format: "<status>: <body-json>").
    try {
      const res = await apiRequest("POST", "/api/auth/signup", {
        email: email.trim(),
        name: name.trim(),
        password,
        portal: "founder",
      });
      const responseBody = (await res.json()) as {
        ok?: boolean;
        requiresEmailConfirmation?: boolean;
      };
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setRole("founder");
      // Record legal consent after successful account creation
      legalConsentRef.current?.recordConsent().catch(() => null);
      // v23.4.6 Phase 6 (L-010) — surface an explicit post-signup
      // interstitial instead of silently redirecting. The interstitial
      // tells the user (a) the account exists, (b) whether they need to
      // confirm their email before signing in (driven by the server's
      // `requiresEmailConfirmation` flag if present), and (c) how to
      // continue. The current server flow auto-signs-in (sets cookie) so
      // by default we render the "welcome — you're signed in" variant.
      setRequiresEmailConfirmation(
        responseBody?.requiresEmailConfirmation === true,
      );
      setSignedUpAs(email.trim());
      toast({
        title: "Account created",
        description: "Welcome to Capavate.",
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusMatch = /^(\d{3}):\s*(.*)$/.exec(msg);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      let serverMessage: string | undefined;
      if (statusMatch) {
        try { serverMessage = (JSON.parse(statusMatch[2]) as { message?: string }).message; } catch { /* body was not JSON */ }
      }
      if (status === 409) {
        setDuplicateEmail(true);
        setErrorMsg(serverMessage ?? "An account with that email already exists.");
      } else if (status === 403) {
        setErrorMsg(serverMessage ?? "Signup is not available for this portal.");
      } else if (status === 400) {
        setErrorMsg(serverMessage ?? "Please check your details and try again.");
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setErrorMsg("Network error — try again in a moment.");
      } else {
        setErrorMsg(serverMessage ?? "Signup failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // v23.4.6 Phase 6 (L-010) — post-signup confirmation interstitial.
  // When `signedUpAs` is non-null the account was just created; render an
  // explicit confirmation screen instead of redirecting silently. The copy
  // branches on `requiresEmailConfirmation` so a future server change that
  // requires email verification will be honored automatically.
  if (signedUpAs !== null) {
    return (
      <AuthShell
        title="Account created"
        subtitle="Welcome to Capavate."
      >
        <div
          className="space-y-4"
          data-testid="signup-interstitial"
          role="status"
          aria-live="polite"
        >
          {requiresEmailConfirmation ? (
            <>
              <p data-testid="text-signup-confirm-email">
                Check your inbox at{" "}
                <strong>{signedUpAs}</strong> for a confirmation link
                before signing in.
              </p>
              <p className="text-sm text-muted-foreground">
                Once confirmed, return to{" "}
                <Link
                  href="/auth/login?portal=founder"
                  className="text-[hsl(184_98%_22%)] hover:underline"
                >
                  sign in
                </Link>
                .
              </p>
            </>
          ) : (
            <>
              <p data-testid="text-signup-welcome">
                Account created — welcome,{" "}
                <strong>{signedUpAs}</strong>. You&apos;re signed in.
              </p>
              <button
                type="button"
                onClick={() => navigate("/founder/dashboard")}
                data-testid="button-continue-dashboard"
                className="inline-flex h-10 items-center justify-center rounded-md bg-[hsl(184_98%_22%)] px-4 text-sm font-medium text-white hover:opacity-90"
              >
                Continue to your dashboard →
              </button>
            </>
          )}
        </div>
      </AuthShell>
    );
  }

  // L-008 fix v23.4.13: render investor gate instead of signup form
  if (isInvestorPortal) {
    return (
      <AuthShell title="Investor access" subtitle="Investors join by invitation">
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground" data-testid="text-investor-gate">
            Investors join Capavate by invitation only. Ask the founder to send you an invitation, or open the link from your invitation email.
          </p>
          <div className="flex flex-col gap-2 mt-4">
            <Link href="/auth/login?portal=investor" data-testid="link-investor-login">
              <Button className="w-full">Sign in as investor</Button>
            </Link>
            <Link href="/onboarding" data-testid="link-onboarding">
              <Button variant="outline" className="w-full">Learn about Capavate</Button>
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create a founder account"
      subtitle="Run your cap table, structure rounds, communicate with investors."
      footer={
        <div>
          Already have an account?{" "}
          <Link href="/auth/login?portal=founder" className="text-[hsl(184_98%_22%)] hover:underline" data-testid="link-login">
            Sign in
          </Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-signup" autoComplete="on">
        <div>
          <Label htmlFor="name" className="flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5" /> Your name
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (aggregateError) setAggregateError(null);
            }}
            required
            autoComplete="name"
            autoFocus
            placeholder="Full name"
            data-testid="input-name"
            aria-invalid={nameInvalid || (showFieldErrors && name.trim().length < 2)}
          />
          {(nameInvalid || (showFieldErrors && name.trim().length < 2)) && (
            <p
              className="mt-1 text-xs text-red-700 flex items-center gap-1"
              data-testid="text-name-invalid"
            >
              <AlertCircle className="h-3 w-3" /> Enter your name (at least 2 characters).
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="email" className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Work email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setDuplicateEmail(false);
              if (aggregateError) setAggregateError(null);
            }}
            required
            autoComplete="email"
            placeholder="you@company.com"
            data-testid="input-email"
            aria-invalid={!emailValid || (showFieldErrors && !looksLikeEmail(email))}
          />
          {!emailValid && (
            <p className="mt-1 text-xs text-red-700 flex items-center gap-1" data-testid="text-email-invalid">
              <AlertCircle className="h-3 w-3" /> Enter a valid email address.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="password" className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> Password
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (aggregateError) setAggregateError(null);
            }}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            data-testid="input-password"
            aria-invalid={passwordInvalid || (showFieldErrors && password.length < 8)}
          />
          {(passwordInvalid || (showFieldErrors && password.length < 8)) && (
            <p
              className="mt-1 text-xs text-red-700 flex items-center gap-1"
              data-testid="text-password-too-short"
            >
              <AlertCircle className="h-3 w-3" /> Password must be at least 8 characters.
            </p>
          )}
          {/* Strength meter — only renders once typing starts */}
          {password.length > 0 && (
            <div className="mt-2 space-y-1" data-testid="password-strength">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${strength.color} transition-all`}
                  style={{ width: `${(strength.score / 4) * 100}%` }}
                  data-testid="password-strength-bar"
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span data-testid="password-strength-label">{strength.label}</span>
                <span>{password.length} chars</span>
              </div>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Use 8+ characters. Mix of upper/lower case, digits, and symbols recommended.
          </p>
        </div>

        {aggregateError && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            data-testid="text-signup-aggregate-error"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{aggregateError}</span>
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 space-y-2"
            data-testid="text-signup-error"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            {duplicateEmail && (
              <Link
                href="/auth/login?portal=founder"
                className="inline-flex items-center text-xs underline text-red-800 hover:text-red-900"
                data-testid="link-existing-account"
              >
                Sign in to the existing account instead
              </Link>
            )}
          </div>
        )}

        <LegalConsentCheckbox
          ref={legalConsentRef}
          docs={["terms", "privacy"]}
          context="signup"
          required
          onCheckedChange={setLegalChecked}
        />

        {/* v23.4.6 Phase 5 (L-006) — the submit button is NO LONGER disabled
         * when required fields are missing. Disabling it hides the cause of
         * the form being unresponsive; enabling it + aggregating the missing
         * fields into an explicit banner on submit is more usable AND more
         * accessible (screen readers announce role="alert" content). */}
        <Button
          type="submit"
          className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
          disabled={submitting}
          data-testid="button-submit-signup"
        >
          {submitting ? "Creating account…" : "Create founder account"}
        </Button>

        {/* 23-May Fix 5 — deterministic disabled-button hint. If the user
         * sees a greyed-out button they need to know WHY: this surfaces the
         * first failing precondition so they can act on it instead of
         * staring at an unresponsive control. */}
        {!canSubmit && !submitting && (
          <p
            className="text-xs text-muted-foreground flex items-center gap-1"
            data-testid="text-form-pending"
            aria-live="polite"
          >
            <AlertCircle className="h-3 w-3" />{" "}
            {name.trim().length < 2
              ? "Enter your name to continue."
              : !looksLikeEmail(email)
              ? "Enter a valid work email to continue."
              : password.length < 8
              ? "Choose a password with at least 8 characters."
              : strength.score < 2
              ? "Strengthen your password (mix upper/lower/digits/symbols)."
              : !legalChecked
              ? "Check the consent box to agree to the Terms and Privacy Policy."
              : "Complete all fields to continue."}
          </p>
        )}

        {canSubmit && !submitting && (
          <p className="text-xs text-emerald-700 flex items-center gap-1" data-testid="text-form-ready">
            <CheckCircle2 className="h-3 w-3" /> Ready to submit.
          </p>
        )}
      </form>

      <div
        className="mt-6 text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2.5 border border-black/5"
        data-testid="text-investor-note"
      >
        <span className="font-medium text-foreground">Investors:</span> Capavate is invitation-only on the
        investor side. Check your email for a secure invitation link, or{" "}
        <Link href="/auth/redeem" className="text-[hsl(184_98%_22%)] hover:underline" data-testid="link-redeem-from-signup">
          redeem an invitation token
        </Link>
        .
      </div>
    </AuthShell>
  );
}
