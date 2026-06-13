/**
 * 23-May Fix 7 \u2014 Dedicated Consortium Partner login.
 *
 * Before this page existed, partners had to use /auth/login (the
 * founder/investor portal) and the page silently probed /api/partner/me
 * after authentication. That worked but was undiscoverable and confusing.
 *
 * This page parallels /admin/login (Sprint 27) so each persona has its own
 * front door:
 *
 *   /auth/login    \u2014 founders + investors (PUBLIC self-signup for founders)
 *   /admin/login   \u2014 platform admins
 *   /partner/login \u2014 consortium partners (this page)
 *
 * Routing rules:
 *   - On success: probes /api/partner/me. If 200, navigate to
 *     /collective/partner/dashboard. If 401/403 (account isn\u2019t a partner),
 *     reject with copy that links to /partner/signup (apply-by-application).
 *   - Stale links to /auth/login?portal=partner redirect here (handled in
 *     Login.tsx).
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
import { Lock, Mail, Handshake, AlertTriangle, Zap } from "lucide-react";

// Demo partner persona \u2014 only visible with ?demo=1.
const DEMO_PARTNER = {
  email: "partner@keiretsu.ca",
  password: "password123",
  label: "Consortium Partner (demo)",
};

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
  // v25.13 NC3 — also merge in window.location.search so redirects via
  // History API (e.g. ?error=no_access from useRequirePartnerRole) are
  // visible here in addition to the existing hash-style ?demo=1 param.
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  const fromHash = qIdx === -1 ? "" : hash.slice(qIdx + 1);
  const fromSearch = window.location.search?.startsWith("?")
    ? window.location.search.slice(1)
    : (window.location.search || "");
  const merged = [fromHash, fromSearch].filter(Boolean).join("&");
  return new URLSearchParams(merged);
}

/** Probe the partner endpoint to confirm this user is actually a partner. */
async function probePartner(): Promise<boolean> {
  try {
    const res = await apiRequest("GET", "/api/partner/me");
    return res.ok;
  } catch {
    return false;
  }
}

export default function PartnerLogin() {
  const [, navigate] = useLocation();
  const { setRole } = useRole();
  const query = useMemo(readHashQuery, []);
  const demoMode = query.get("demo") === "1";
  // v25.13 NC3 — surfaced when useRequirePartnerRole redirects here on
  // PARTNER_NOT_FOUND so the user understands why they were blocked.
  const noAccessFlag = query.get("error") === "no_access";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notAPartner, setNotAPartner] = useState(false);
  const previewMode = useMemo(isPreviewEnvironment, []);

  async function quickSignIn() {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    setNotAPartner(false);
    try {
      await apiRequest("POST", "/api/auth/login", {
        email: DEMO_PARTNER.email,
        password: DEMO_PARTNER.password,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      const isPartner = await probePartner();
      if (!isPartner) {
        setNotAPartner(true);
        setErrorMsg("Quick sign-in account is not registered as a consortium partner.");
        return;
      }
      setRole("partner");
      navigate("/collective/partner/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(
        msg.includes("Failed to fetch")
          ? "Network error \u2014 try again in a moment."
          : "Quick sign-in failed. Try manual sign-in below.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    setNotAPartner(false);
    try {
      const res = await apiRequest("POST", "/api/auth/login", { email: email.trim(), password });
      const json = (await res.json()) as { ok: true; ctx: UserContext };
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });

      // Confirm this account is actually a consortium partner. Founders +
      // investors who type their credentials here must be turned away with
      // an actionable error \u2014 NOT silently routed into the partner workspace.
      const isPartner = await probePartner();
      if (!isPartner) {
        setNotAPartner(true);
        setErrorMsg("This account is not registered as a consortium partner.");
        return;
      }

      // Defensive: if the credential happens to also be admin, do not auto-
      // route to /admin/dashboard \u2014 partner login should land on the partner
      // workspace, period.
      void json;
      setRole("partner");
      navigate("/collective/partner/dashboard");
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
        setErrorMsg("Network error \u2014 try again in a moment.");
      } else {
        setErrorMsg(serverMessage ?? "Sign-in failed. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fillDemo() {
    setEmail(DEMO_PARTNER.email);
    setPassword(DEMO_PARTNER.password);
    setErrorMsg(null);
    setNotAPartner(false);
  }

  return (
    <AuthShell
      title="Partner sign-in"
      subtitle="Consortium partner workspace. Manage your portfolio of founders and investors."
      footer={
        <div className="space-y-2 text-xs">
          <div>
            Not a partner yet?{" "}
            <Link
              href="/partner/signup"
              className="text-[hsl(184_98%_22%)] hover:underline"
              data-testid="link-partner-apply"
            >
              Apply to join the consortium
            </Link>
          </div>
          <div>
            Founder or investor?{" "}
            <Link
              href="/auth/login"
              className="text-[hsl(184_98%_22%)] hover:underline"
              data-testid="link-back-to-public-login"
            >
              Sign in here
            </Link>
          </div>
        </div>
      }
    >
      {noAccessFlag && (
        <div
          role="alert"
          className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900"
          data-testid="banner-partner-no-access"
        >
          Your account does not have an active partner membership. If you
          were recently invited, your membership may still be pending
          activation — try again in a few minutes or contact your
          consortium administrator.
        </div>
      )}

      {/* Restricted-access banner \u2014 less alarming than admin, but clear about scope */}
      <div
        role="note"
        className="mb-5 flex items-start gap-2 rounded-md border border-[hsl(184_98%_22%_/0.35)] bg-[hsl(184_98%_97%)] px-3 py-2 text-xs leading-relaxed"
        data-testid="banner-partner-info"
      >
        <Handshake className="h-3.5 w-3.5 mt-0.5 text-[hsl(184_98%_22%)] shrink-0" />
        <span className="text-[hsl(184_98%_18%)]">
          This is the Consortium Partner portal. Membership is by approved application only.
          {" "}
          <Link href="/apply/consortium" className="font-semibold underline" data-testid="link-apply-from-banner">
            Apply here
          </Link>
          {" "}or sign in below if you\u2019re already a partner.
        </span>
      </div>

      {/* Preview-only one-click sign-in */}
      {previewMode && (
        <div
          className="mb-5 rounded-md border-2 border-dashed border-[hsl(184_98%_22%)] bg-[hsl(184_98%_97%)] p-4"
          data-testid="preview-quick-signin-panel"
        >
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-[hsl(184_98%_22%)]" />
            <span className="text-sm font-semibold text-[hsl(219_45%_20%)]">Preview environment \u2014 one-click sign-in</span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            This shortcut only appears on preview hosts and is hidden in production. Click to sign in as the Keiretsu Forum demo partner instantly.
          </p>
          <Button
            type="button"
            onClick={quickSignIn}
            disabled={submitting}
            className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
            data-testid="button-preview-quick-signin"
          >
            <Zap className="h-4 w-4 mr-2" />
            {submitting ? "Signing you in\u2026" : "Sign in as Consortium Partner (preview only)"}
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-partner-login" autoComplete="on">
        <div>
          <Label htmlFor="email" className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Partner email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setNotAPartner(false); }}
            required
            autoComplete="email"
            autoFocus
            placeholder="partner@your-consortium.example"
            data-testid="input-partner-email"
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
            placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
            data-testid="input-partner-password"
          />
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2 space-y-2"
            data-testid="text-partner-login-error"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            {notAPartner && (
              <Link
                href="/partner/signup"
                className="inline-flex items-center text-xs underline text-red-800 hover:text-red-900"
                data-testid="link-not-a-partner-apply"
              >
                Apply to join the consortium
              </Link>
            )}
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-[hsl(184_98%_22%)] hover:bg-[hsl(184_98%_17%)] text-white"
          disabled={submitting || email.trim().length === 0 || password.length === 0}
          data-testid="button-submit-partner-login"
        >
          <Handshake className="h-4 w-4 mr-2" />
          {submitting ? "Signing in\u2026" : "Sign in to partner workspace"}
        </Button>
      </form>

      {/* Demo partner quick-fill \u2014 only when ?demo=1 */}
      {demoMode && (
        <div className="mt-6 border-t pt-4" data-testid="demo-partner-panel">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Demo partner (visible because ?demo=1)
          </div>
          <button
            type="button"
            onClick={fillDemo}
            className="text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 text-muted-foreground w-full"
            data-testid="preset-partner-demo"
          >
            <span className="font-medium text-foreground">{DEMO_PARTNER.email}</span> \u2014 {DEMO_PARTNER.label}
          </button>
        </div>
      )}
    </AuthShell>
  );
}
