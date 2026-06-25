/**
 * Dedicated admin login.
 *
 * The public /auth/login page is restricted to founders + investors. Admin
 * sign-in lives here on a separate page so:
 *
 *   1. Uninvited visitors browsing the public portal never see an "Admin"
 *      tab or learn that an admin surface exists.
 *   2. We can apply stricter UX cues here (hardened banner, explicit "restricted
 *      access" copy, no demo persona panel in production).
 *   3. Audit logs and rate limits can be tightened on this endpoint without
 *      affecting the founder/investor path.
 *
 * Routing rules:
 *   - On success: ctx.isAdmin must be true. Otherwise reject with 403-style copy
 *     ("This account is not an admin").
 *   - Any non-admin who somehow has credentials cannot enter the admin dashboard.
 *   - Stale links to /auth/login?portal=admin redirect here (handled in Login.tsx).
 *
 * Demo personas: only visible when ?demo=1 is in the URL, identical pattern
 * to the founder/investor page.
 *
 * SANDBOX-SAFE: no Web Storage APIs. Session lives in httpOnly cookie.
 */
import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/pages/auth/AuthShell";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRole } from "@/lib/role";
import type { UserContext } from "@/lib/entitlement";
import { Lock, Mail, ShieldCheck, AlertTriangle, Zap } from "lucide-react";

// Demo admin persona — only visible with ?demo=1.
const DEMO_ADMIN = { email: "admin@capavate.io", password: "adminpass", label: "Admin (demo)" };

/**
 * Preview/sandbox detector — true ONLY on Perplexity preview hosts and localhost.
 * The one-click "sign me in" button is gated on this so it CANNOT appear on a
 * real production *.capavate.com deployment. Self-deletes at production cutover.
 */
function isPreviewEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".pplx.app") ||
    h.endsWith(".perplexity.ai") ||
    h.endsWith(".replit.dev") ||
    h.endsWith(".repl.co")
  );
}

function readHashQuery(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  return new URLSearchParams(qIdx === -1 ? "" : hash.slice(qIdx + 1));
}

export default function AdminLogin() {
  const [, navigate] = useLocation();
  const { setRole } = useRole();
  const query = useMemo(readHashQuery, []);
  const demoMode = query.get("demo") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const previewMode = useMemo(isPreviewEnvironment, []);

  /**
   * One-click preview-only admin sign-in. Submits the demo credentials
   * directly so the user doesn't have to type anything. Gated on
   * isPreviewEnvironment() so this control never renders on production.
   */
  async function quickSignIn() {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest("POST", "/api/auth/login", {
        email: DEMO_ADMIN.email,
        password: DEMO_ADMIN.password,
      });
      const json = (await res.json()) as { ok: true; ctx: UserContext };
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      if (!json.ctx.isAdmin) {
        setErrorMsg("Quick sign-in account is not flagged as admin on the server.");
        return;
      }
      setRole("admin");
      navigate("/admin/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg.includes("Failed to fetch") ? "Network error — try again in a moment." : "Quick sign-in failed. Try manual sign-in below.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest("POST", "/api/auth/login", { email: email.trim(), password });
      const json = (await res.json()) as { ok: true; ctx: UserContext };
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      if (!json.ctx.isAdmin) {
        // Non-admin credentials succeeded but the account doesn't have admin rights.
        // Reject explicitly — do NOT route them anywhere from this page.
        setErrorMsg("This account is not authorised for admin access.");
        return;
      }
      setRole("admin");
      navigate("/admin/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusMatch = /^(\d{3}):\s*(.*)$/.exec(msg);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      let serverMessage: string | undefined;
      if (statusMatch) {
        try { serverMessage = (JSON.parse(statusMatch[2]) as { message?: string }).message; } catch { /* not JSON */ }
      }
      if (status === 401) {
        setErrorMsg(serverMessage ?? "Email or password is incorrect.");
      } else if (status === 429) {
        setErrorMsg("Too many attempts. Wait a minute and try again.");
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setErrorMsg("Network error — try again in a moment.");
      } else {
        setErrorMsg(serverMessage ?? "Sign-in failed. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo() {
    setEmail(DEMO_ADMIN.email);
    setPassword(DEMO_ADMIN.password);
    setErrorMsg(null);
  }

  return (
    <AuthShell
      title="Admin sign-in"
      subtitle="Platform administration. Restricted access."
      footer={
        <div className="space-y-2 text-xs">
          <div>
            Not an admin?{" "}
            <Link href="/auth/login" className="text-[#cc0001] hover:underline" data-testid="link-back-to-public-login">
              Back to founder / investor sign-in
            </Link>
          </div>
          <div className="text-muted-foreground">
            Contact platform operations if you need admin credentials.
          </div>
        </div>
      }
    >
      {/* Restricted-access banner */}
      <div
        role="note"
        className="mb-5 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed"
        data-testid="banner-admin-restricted"
      >
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-700 shrink-0" />
        <span className="text-amber-900">
          This is the admin portal. All sign-in attempts here are logged and rate-limited. If you're a founder or investor,
          {" "}
          <Link href="/auth/login" className="font-semibold underline">return to the public login</Link>.
        </span>
      </div>

      {/* Preview-only one-click sign-in — auto-removed on production hostnames */}
      {previewMode && (
        <div
          className="mb-5 rounded-md border-2 border-dashed border-[hsl(0_100%_40%)] bg-[hsl(0_100%_97%)] p-4"
          data-testid="preview-quick-signin-panel"
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-[#cc0001]" />
            <span className="text-sm font-semibold text-[hsl(219_45%_20%)]">Preview environment — one-click sign-in</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            This shortcut only appears on preview hosts and is automatically hidden on the production domain. Click below to sign in instantly.
          </p>
          <Button
            type="button"
            onClick={quickSignIn}
            disabled={submitting}
            className="w-full bg-[#cc0001] hover:bg-[#a30001] text-white rounded-full font-semibold"
            data-testid="button-preview-quick-signin"
          >
            <Zap className="h-4 w-4 mr-2" />
            {submitting ? "Signing you in…" : "Sign in as Admin (preview only)"}
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-admin-login" autoComplete="on">
        <div>
          <Label htmlFor="email" className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Admin email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            placeholder="admin@capavate.io"
            data-testid="input-admin-email"
          />
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
            autoComplete="current-password"
            placeholder="••••••••"
            data-testid="input-admin-password"
          />
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            data-testid="text-admin-login-error"
          >
            {errorMsg}
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-[hsl(219_45%_20%)] hover:bg-[hsl(219_45%_15%)] text-white"
          disabled={submitting || email.trim().length === 0 || password.length === 0}
          data-testid="button-submit-admin-login"
        >
          <ShieldCheck className="h-4 w-4 mr-2" />
          {submitting ? "Signing in…" : "Sign in to admin"}
        </Button>
      </form>

      {/* Demo admin quick-fill — only when ?demo=1 */}
      {demoMode && (
        <div className="mt-6 border-t pt-4" data-testid="demo-admin-panel">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Demo admin (visible because ?demo=1)
          </div>
          <button
            type="button"
            onClick={fillDemo}
            className="text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 text-muted-foreground w-full"
            data-testid="preset-admin-demo"
          >
            <span className="font-medium text-foreground">{DEMO_ADMIN.email}</span> — {DEMO_ADMIN.label}
          </button>
        </div>
      )}
    </AuthShell>
  );
}
