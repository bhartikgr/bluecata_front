/**
 * client/src/pages/SetPasswordPage.tsx — v23.4.1 hotfix Task C
 *
 * Public page at /set-password?token=...
 *
 * Consumed by the Consortium Partner invite flow:
 *   1. Applicant submits /apply/consortium
 *   2. Server auto-approves and sends an invite email with this URL
 *   3. Applicant clicks the link, lands here, sets their password
 *   4. POST /api/auth/secure/redeem — consumes token, creates auth_users row,
 *      sets password, issues JWT session cookie
 *   5. On success: redirect to /partner/login (or /login based on role)
 *
 * Token is read from ?token= query parameter (hash-router aware).
 *
 * Error states:
 *   - Token missing/invalid → "This link is invalid."
 *   - Token expired (400 token_expired) → "This invite has expired. Contact your admin."
 *   - Token already used (409 token_consumed) → "This link has already been used. Try logging in."
 *   - Network error → generic "Something went wrong" with retry
 *
 * Security: this page posts to /api/auth/secure/redeem (secureAuthRoutes.ts:139)
 * which requires a valid 32+ char token + password >= 10 chars. No auth required
 * to visit this page (public route — no requireAuth middleware).
 *
 * Design: matches AuthShell style used by Login/Signup/Forgot pages.
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

const API_BASE = (import.meta as any).env?.VITE_API_BASE ?? "";

/** Read ?token= from both regular search params and hash-router (?foo in the hash). */
function readTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  // Try plain query string first (standard routing)
  const plainSearch = new URLSearchParams(window.location.search);
  if (plainSearch.has("token")) return plainSearch.get("token") ?? "";
  // Fall back to hash-embedded query string (wouter hash-router)
  const hashPart = window.location.hash ?? "";
  const qIndex = hashPart.indexOf("?");
  if (qIndex !== -1) {
    const hashSearch = new URLSearchParams(hashPart.slice(qIndex + 1));
    if (hashSearch.has("token")) return hashSearch.get("token") ?? "";
  }
  return "";
}

// v24.1 Bug A: client-side password rules MUST match the server gate in
// server/lib/auth.ts:passwordIsStrong (length >= 10, uppercase, lowercase,
// number, not a common prefix). Previously the client only checked length+match,
// so the server rejected with 400 weak_password after the user submitted.
function passwordStrengthHint(pw: string): string | null {
  if (pw.length === 0) return null;
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Z]/.test(pw)) return "Add an uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Add a lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Add a number.";
  if (/^(password|123456|qwerty|letmein)/i.test(pw)) return "Password is too common.";
  return null;
}

function passwordMeetsPolicy(pw: string): boolean {
  return passwordStrengthHint(pw) === null && pw.length >= 10;
}

export default function SetPasswordPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const token = useMemo(readTokenFromUrl, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwHint = passwordStrengthHint(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    token.length >= 32 &&
    passwordMeetsPolicy(password) &&
    password === confirm &&
    !submitting;

  // No token present at all
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">Invalid link</h1>
          <p className="text-sm text-muted-foreground">
            This set-password link is missing a token. Please check your email for
            the correct link, or contact your admin.
          </p>
          <Button variant="outline" onClick={() => navigate("/login")}>
            Go to login
          </Button>
        </div>
      </div>
    );
  }

  // Success state
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-4xl">✓</div>
          <h1 className="text-xl font-semibold text-foreground">Password set!</h1>
          <p className="text-sm text-muted-foreground">
            Your account is ready. Redirecting you to login…
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const resp = await fetch(`${API_BASE}/api/auth/secure/redeem`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await resp.json().catch(() => ({} as Record<string, unknown>));

      if (!resp.ok) {
        const errCode = (body as { error?: string }).error ?? "";
        if (errCode === "token_expired" || resp.status === 400) {
          setError(
            "This invite link has expired. Contact your admin to get a new link.",
          );
        } else if (errCode === "token_consumed" || resp.status === 409) {
          setError(
            "This link has already been used. Try logging in, or contact your admin if you need a new link.",
          );
        } else if (errCode === "weak_password") {
          // Surface the exact server reason (e.g. "Add an uppercase letter").
          setError(
            `Password too weak: ${(body as { reason?: string }).reason ?? "choose a stronger password."}`,
          );
        } else if (errCode === "no_user_for_reset") {
          setError(
            "We couldn't find an account for this reset link. Contact your admin to get a new invite.",
          );
        } else if (errCode === "token_invalid") {
          setError(
            "This link is invalid. Please check your email for the correct link, or contact your admin.",
          );
        } else {
          setError(
            "Something went wrong. Please try again, or contact your admin.",
          );
        }
        return;
      }

      // Success — token consumed, session cookie set.
      setDone(true);
      toast({ title: "Password set", description: "Redirecting to login…" });

      // A3 (v24.0) — redirect to the correct persona login based on the redeemed role.
      // Founders and investors must NOT be stranded on /partner/login.
      const role = (body as { role?: string }).role ?? "investor";
      const redirectTo =
        role === "admin"
          ? "/admin/login"
          : role === "partner"
            ? "/partner/login"
            : /* founder | investor | anything else */ "/auth/login";

      setTimeout(() => {
        navigate(redirectTo);
      }, 1500);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-sm w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Set your password
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose a password to activate your Capavate account.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sp-password">New password</Label>
            <Input
              id="sp-password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 10 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              data-testid="input-password"
            />
            {pwHint && (
              <p className="text-xs text-amber-600">{pwHint}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sp-confirm">Confirm password</Label>
            <Input
              id="sp-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Repeat password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={submitting}
              data-testid="input-confirm"
            />
            {mismatch && (
              <p className="text-xs text-destructive">Passwords do not match.</p>
            )}
          </div>

          {error && (
            <div
              className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2"
              data-testid="error-message"
            >
              {error}
            </div>
          )}

          {/* v25.43 R4-1 — capavate.com red pill CTA (default Button variant
             inherits the red --primary token; pill + semibold added). */}
          <Button
            type="submit"
            className="w-full rounded-full font-semibold"
            disabled={!canSubmit}
            data-testid="button-submit"
          >
            {submitting ? "Setting password…" : "Set password & activate account"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="underline hover:text-foreground">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
