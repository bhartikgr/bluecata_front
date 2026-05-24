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

  const strength = useMemo(() => gradePassword(password), [password]);
  const emailValid = email.length === 0 || looksLikeEmail(email);
  const canSubmit =
    name.trim().length >= 2 &&
    looksLikeEmail(email) &&
    password.length >= 8 &&
    strength.score >= 2 &&
    legalChecked;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !canSubmit) return;
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
      await res.json();
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setRole("founder");
      toast({ title: "Account created", description: "Let's set up your first company." });
      // Record legal consent after successful account creation
      legalConsentRef.current?.recordConsent().catch(() => null);
      navigate("/founder/dashboard");
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
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            autoFocus
            placeholder="Full name"
            data-testid="input-name"
          />
        </div>

        <div>
          <Label htmlFor="email" className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Work email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setDuplicateEmail(false); }}
            required
            autoComplete="email"
            placeholder="you@company.com"
            data-testid="input-email"
            aria-invalid={!emailValid}
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
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            data-testid="input-password"
          />
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

        <Button
          type="submit"
          className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_18%)] text-white"
          disabled={submitting || !canSubmit}
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
