/**
 * Sprint 24 — Audience-driven login.
 *
 * Capavate has four distinct audiences entering the same front door:
 *   1. Founders managing their own cap tables (may have 0/1/N companies)
 *   2. Investors (invitation-only — never self-signup, but they sign in here
 *      after redeeming an invitation token)
 *   3. Admins running the platform
 *   4. Mixed-role users (same email is both a founder and an investor)
 *
 * Design decisions:
 *   - Portal switcher is a visible tab strip (not just a ?portal= URL param),
 *     so a user can see *and* change which portal they're entering.
 *   - Email + password fields START EMPTY. No persona prefill in production
 *     UI (Sprint 23 hardening rule).
 *   - Demo persona quick-fill panel is gated behind `?demo=1` so the production
 *     login page never shows internal personas to real users.
 *   - Wrong-portal handling: instead of toast+redirect, we show an inline
 *     "your account is set up for the X portal — switch?" panel after a 401
 *     that turned out to be a portal mismatch (server returns 200 + ctx, then
 *     we detect it client-side).
 *   - Investor portal footer shows "I have an invitation token" → /auth/redeem,
 *     not a signup link (investors never self-signup).
 *   - All routing happens after queryClient.invalidateQueries(/api/auth/me)
 *     so the entitlement context is fresh before navigation.
 *
 * SANDBOX-SAFE: no Web Storage APIs. Session lives in httpOnly cookie.
 */
import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/pages/auth/AuthShell";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRole } from "@/lib/role";
import type { UserContext } from "@/lib/entitlement";
import { Lock, Mail, ArrowRight, Briefcase, Users } from "lucide-react";

// Public login is FOUNDER + INVESTOR only. Admin login lives at
// /admin/login on a separate page so the public portal does not advertise the
// existence of an admin surface to uninvited visitors.
type Portal = "founder" | "investor";

const PORTAL_META: Record<Portal, { label: string; icon: typeof Briefcase; subtitle: string }> = {
  founder:  { label: "Founder",  icon: Briefcase, subtitle: "Run your cap table, structure rounds, communicate with investors." },
  investor: { label: "Investor", icon: Users,     subtitle: "Track your positions, deal flow, and Collective network — invitation only." },
};

// v25.43 F4/F5 — brand-panel copy per portal (DRAFT for Ozan red-line). The
// AuthShell left-panel tagline/subline now reflect the chosen audience.
const PORTAL_BRAND_COPY: Record<Portal, { tagline: string; subline: string }> = {
  founder: {
    tagline:
      "Run your cap table, structure your rounds, and turn every shareholder into a verified contact — in one place.",
    subline: "Activate the network already inside your ownership structure.",
  },
  investor: {
    tagline:
      "Where your portfolio companies’ cap tables, rounds, and term sheets live — and your invitations are verified before you act.",
    subline:
      "Invitation-only access to verified ownership. Your seat on the cap table, your view of the round.",
  },
};

// Demo personas — ONLY compiled in dev builds with VITE_ENABLE_DEMO_SEED="1",
// AND only rendered when ?demo=1 is present in the URL. In production builds
// the array is empty so no persona strings ship in the bundle.
// Admin persona removed from the public login page (admin-separation). Admin demo
// credentials live on /admin/login (separate page).
const DEMO_PRESETS: Array<{ email: string; password: string; label: string; portal: Portal }> =
  (import.meta.env.MODE !== "production" && import.meta.env.VITE_ENABLE_DEMO_SEED === "1")
    ? [
        { email: "maya@novapay.ai",         password: "password123", label: "Founder · 3 companies",            portal: "founder"  },
        { email: "aisha@greenwood.capital", password: "password123", label: "Investor · State 3 (Collective)",  portal: "investor" },
        { email: "lp@lapsed-fund.example",  password: "password123", label: "Investor · State 4 (lapsed)",      portal: "investor" },
        { email: "newinvestor@example.com", password: "password123", label: "Investor · State 1 (nudge)",       portal: "investor" },
      ]
    : [];

// v23.4.3: BrowserRouter — read query from window.location.search (not hash).
function readHashQuery(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function Login() {
  const [, navigate] = useLocation();
  const { setRole } = useRole();
  const query = useMemo(readHashQuery, []);
  const rawPortal = (query.get("portal") ?? "founder").toLowerCase();
  // W-AVI64 FIX 6 — did the visitor EXPLICITLY request a portal (e.g. they
  // arrived via /investor/login → ?portal=investor, or /partner/login)? An
  // explicit portal intent means "show me THIS portal's sign-in", so an active
  // session for a DIFFERENT role (notably an admin session) must NOT silently
  // bounce them to that other role's dashboard.
  const hasExplicitPortalIntent = query.has("portal");
  // If a stale URL or email link asks for portal=admin, redirect
  // to the dedicated /admin/login page. Public login is founder + investor only.
  useEffect(() => {
    if (rawPortal === "admin") navigate("/admin/login");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPortal]);

  // B-V13-1 fix (Avi's Issue 1): if the user is already authenticated, an
  // immediate visit to /auth/login should NOT show the login form again.
  // Probe GET /api/auth/me; on `isAuthed=true` redirect into the right portal.
  // honours ?returnTo=... if the user landed here via RequireAuth.
  // v23.4.7 Phase 6 (BUG 001) — widen the probe shape to include hasPaidPlan
  // so the post-auth redirect can branch correctly. See BUG 001: a returning
  // founder was being dumped onto /founder/subscribe because /founder/dashboard
  // is gated by RequireActiveSubscription which redirects to /subscribe when
  // there is no activeCompanyId. The correct landing is:
  //   companies.length > 1  → /select-company
  //   companies.length === 1 → /founder/dashboard
  //   no companies, hasPaidPlan → /onboarding (post-pay, pre-company)
  //   no companies, no paid plan → /company-profile?onboarding=1 (company first; then subscribe)
  // v25.52 Track 0.3 — declared BEFORE the meProbe redirect effect so the effect
  // can stand down while the explicit workspace CHOOSER is active. Without this,
  // the legacy "already-authenticated → skip login" redirect effect below fires
  // on the post-login /api/auth/me refetch and navigates to /founder/dashboard,
  // silently defeating the chooser for multi-workspace accounts.
  type WorkspaceKey = "founder" | "investor" | "partner" | "collective";
  // Store the known-good login ctx alongside the options so the chooser click
  // handler navigates from the authoritative login response rather than the
  // separately-cached meProbe query (removes cache-timing reliance + an unsafe
  // cast) — GPT-5.5 lower-priority observation.
  const [roleChoice, setRoleChoice] = useState<{ options: WorkspaceKey[]; ctx: UserContext } | null>(null);
  // Set true for the duration of an EXPLICIT credential login (handleSubmit).
  // The redirect effect defers to handleSubmit's own routing (chooser or
  // single-workspace navigate) so the two never race. Reset only when we
  // deliberately fall through to legacy routing.
  const manualLoginRef = useRef(false);
  const meProbe = useQuery<{ isAuthed: boolean; isAdmin?: boolean; founder?: { companies: unknown[] }; investor?: { state?: string }; hasPaidPlan?: boolean }>({
    queryKey: ["/api/auth/me", "login-redirect-probe"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/auth/me");
        if (!res.ok) return { isAuthed: false };
        return res.json();
      } catch {
        return { isAuthed: false };
      }
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  useEffect(() => {
    // W-CAP LW-2 (2026-07-17) — only auto-redirect on a probe that COMPLETED
    // after this mount. A stale/cached /api/auth/me from a prior (now logged-out)
    // session must never silently re-authenticate the login page; requiring a
    // fresh post-mount fetch guarantees we branch on the server's current
    // session state, so an explicit visit to /login always shows the form when
    // the session is truly gone.
    if (!meProbe.isFetchedAfterMount) return;
    const me = meProbe.data;
    if (!me?.isAuthed) return;
    // v25.52 Track 0.3 — the explicit-login handler (handleSubmit) owns routing
    // when the user just signed in through the form: it either shows the
    // multi-workspace CHOOSER or navigates into the single qualifying workspace.
    // This legacy effect only handles the "visited /login while ALREADY authed"
    // case. Stand down if the chooser is open OR a manual login is in flight,
    // so we never override the chooser with a silent /founder/dashboard redirect.
    if (roleChoice || manualLoginRef.current) return;
    const returnTo = query.get("returnTo");
    if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
      navigate(returnTo);
      return;
    }
    // Admins never enter through the public login page.
    // W-AVI64 FIX 6 — but if the visitor EXPLICITLY asked for a specific portal
    // (arrived via /investor/login, /partner/login, or an explicit ?portal=),
    // stand down and show the login form so they can re-authenticate into the
    // requested portal, instead of silently bouncing the active admin session
    // to /admin/dashboard. The no-explicit-intent case (bare /login) keeps the
    // prior behavior so "already an admin → your dashboard" still works.
    if (me.isAdmin) {
      if (hasExplicitPortalIntent) return;
      navigate("/admin/dashboard");
      return;
    }
    const companyCount = me.founder?.companies?.length ?? 0;
    const isInvestor = me.investor?.state !== undefined && me.investor.state !== "NONE";
    // FIX 1b — honour an explicit investor portal intent BEFORE any founder
    // fallthrough. A user who reached this page via ?portal=investor must never
    // be routed to founder onboarding (/company-profile?onboarding=1).
    if (rawPortal === "investor") { navigate("/investor/dashboard"); return; }
    // BUG 001 — branch on number of companies BEFORE falling through to the
    // empty-state. Multi-company founders MUST land on /select-company so
    // the active-company context is established before any subscription
    // gate fires; single-company founders land on the dashboard directly.
    if (companyCount > 1) { navigate("/select-company"); return; }
    if (companyCount === 1) { navigate("/founder/dashboard"); return; }
    if (isInvestor) { navigate("/investor/dashboard"); return; }
    // Authenticated founder with NO company → canonical first step is
    // /company-profile?onboarding=1 (then subscribe). If they’ve already
    // paid for a plan but haven’t completed company onboarding (rare but
    // real), send them to the onboarding wizard instead.
    if (me.hasPaidPlan) { navigate("/onboarding"); return; }
    navigate("/company-profile?onboarding=1");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meProbe.data, meProbe.isFetchedAfterMount, roleChoice]);
  const initialPortal: Portal = rawPortal === "investor" ? "investor" : "founder";
  const demoMode = query.get("demo") === "1";

  const [portal, setPortal] = useState<Portal>(initialPortal);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // After a successful auth that landed on the wrong portal, we offer to switch
  // rather than silently bouncing. This holds the suggested portal.
  const [wrongPortalSuggest, setWrongPortalSuggest] = useState<{ to: Portal; ctx: UserContext } | null>(null);
  // v25.52 Track 0.3 (Ozan decision: Option 1) — when a single account qualifies
  // for 2+ workspaces (Founder / Investor / Consortium Partner / Collective),
  // show an explicit CHOOSER instead of the old silent partner-first precedence
  // (the mechanism behind Bug 2b / login mis-redirects). Single-role users skip
  // this and route straight in.
  const meta = PORTAL_META[portal];
  const PortalIcon = meta.icon;
  const brandCopy = PORTAL_BRAND_COPY[portal];

  function switchPortal(p: Portal) {
    setPortal(p);
    setErrorMsg(null);
    setWrongPortalSuggest(null);
    // v23.4.3: BrowserRouter — update search params (not hash) so a refresh
    // or share preserves the portal choice.
    if (typeof window !== "undefined") {
      const newQuery = new URLSearchParams(window.location.search);
      newQuery.set("portal", p);
      window.history.replaceState(null, "", `/login?${newQuery.toString()}`);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // v25.52 Track 0.3 — claim routing ownership for this explicit login so the
    // legacy meProbe redirect effect stands down (see effect guard above). This
    // prevents the post-login /api/auth/me refetch from silently navigating to
    // /founder/dashboard and defeating the multi-workspace chooser.
    manualLoginRef.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    setWrongPortalSuggest(null);
    // apiRequest() throws on non-2xx with `"{status}: {body}"`. We catch and
      // parse status + server-provided message from the error string.
    try {
      const res = await apiRequest("POST", "/api/auth/login", { email: email.trim(), password });
      const json = (await res.json()) as { ok: true; ctx: UserContext };
      // Refresh entitlement context BEFORE routing so consumers see fresh data.
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });

      /* v25.52 Track 0.3 (Ozan decision: Option 1) — compute the FULL qualifying
       * workspace SET for this account, then:
       *   • 2+ workspaces qualify → show the explicit chooser (no silent
       *     precedence; this replaces the old partner-first probe that forced
       *     every partner-linked account into the partner dashboard and was the
       *     mechanism behind Bug 2b / login mis-redirects).
       *   • exactly 1 qualifies → route straight into it (via route(ctx) for
       *     founder/investor so the wrong-portal suggestion + BUG-001 company
       *     routing are preserved; direct navigate only for partner/collective
       *     which route() does not cover).
       *   • 0 qualify → fall through to the existing `route()` onboarding logic.
       * Admins never reach here (route() handles the admin guard). */
      const ctx = json.ctx;

      /* v25.52 Track 0.3 (GPT-5.5 blocker #1) — a user sent here via RequireAuth
       * (`/login?returnTo=/protected/path`) must return to that exact
       * destination after an EXPLICIT credential login, exactly as the
       * already-authenticated redirect effect does. Because manualLoginRef is
       * now claimed for the whole handler, that effect stands down, so we MUST
       * honour returnTo here or the deep-link is silently dropped (rule #78).
       * Same-origin guard mirrors the effect: absolute path, not protocol-
       * relative. Admins are excluded (they never deep-link into the public
       * app; route() surfaces the admin-portal error below). */
      const rt = query.get("returnTo");
      if (!ctx.isAdmin && rt && rt.startsWith("/") && !rt.startsWith("//")) {
        navigate(rt);
        return;
      }

      if (ctx.isAdmin) {
        // Public login is not an admin entry point. route() surfaces a clear
        // error and stays on the form; manualLoginRef intentionally REMAINS
        // true so the meProbe effect keeps standing down and cannot bounce an
        // authenticated admin off this page (admin-separation is preserved).
        route(ctx);
        return;
      }
      const qualifies: WorkspaceKey[] = [];
      if (ctx.founder.companies.length > 0) qualifies.push("founder");
      const investorQual =
        ctx.investor.state !== "NONE" ||
        ctx.investor.invitedRounds.length > 0 ||
        ctx.investor.capTablePositions.length > 0;
      if (investorQual) qualifies.push("investor");
      // Partner membership is not in ctx; probe the partner endpoint (200 = member).
      try {
        const probe = await apiRequest("GET", "/api/partner/me");
        if (probe.status === 200) qualifies.push("partner");
      } catch { /* non-partner account — not a qualifying workspace */ }
      // Collective membership overlay (active/renewing counts as a workspace).
      if (ctx.collective && ctx.collective.status && ctx.collective.status !== "none") {
        qualifies.push("collective");
      }

      if (qualifies.length >= 2) {
        // Chooser owns routing from here; keep manualLoginRef claimed so the
        // meProbe effect never overrides the chooser while it is open. Persist
        // the authoritative login ctx so the click handler does not depend on
        // the meProbe cache being populated at click time.
        setRoleChoice({ options: qualifies, ctx });
        return;
      }
      if (qualifies.length === 1) {
        const only = qualifies[0];
        /* v25.52 Track 0.3 (GPT-5.5 blocker #2) — for a single FOUNDER- or
         * INVESTOR-only account, defer to route(ctx). route() honours the
         * selected portal tab, preserves the BUG-001 single-vs-multi-company
         * landing, AND (critically) still shows the existing wrong-portal
         * suggestion panel when a founder-only account signed in from the
         * Investor tab (or vice-versa) — behaviour the old code had and that a
         * blind navigate() would silently drop (rule #78). manualLoginRef stays
         * TRUE: route() either navigates away (ref moot) or shows the
         * wrong-portal panel and STAYS on /login, where the meProbe effect must
         * remain suppressed so it cannot redirect over the panel. Partner and
         * Collective are not modelled by route(), so they navigate directly. */
        if (only === "founder" || only === "investor") {
          route(ctx);
        } else {
          navigateToWorkspace(only, ctx);
        }
        return;
      }
      // 0 qualifying workspaces — hand routing back to the legacy onboarding
      // path. route() performs its own navigate() (or, for a wrong-portal /
      // admin case, stays on the form); manualLoginRef stays TRUE so the
      // meProbe effect cannot race route()'s decision. (route() never depends
      // on the effect firing.)
      route(ctx);
    } catch (err: unknown) {
      // Login failed — release the routing claim so a later already-authed
      // visit (or a successful retry) is handled normally.
      manualLoginRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      // Format from apiRequest: "<status>: <body-text>"
      const statusMatch = /^(\d{3}):\s*(.*)$/.exec(msg);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      let serverMessage: string | undefined;
      if (statusMatch) {
        try { serverMessage = (JSON.parse(statusMatch[2]) as { message?: string }).message; } catch { /* body was not JSON */ }
      }
      if (status === 401) {
        setErrorMsg(serverMessage ?? "Email or password is incorrect.");
      } else if (status === 429) {
        setErrorMsg("Too many attempts. Wait a minute and try again.");
      } else if (status >= 400 && status < 500) {
        setErrorMsg(serverMessage ?? "Sign-in failed. Check your details and try again.");
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setErrorMsg("Network error — try again in a moment.");
      } else {
        setErrorMsg(serverMessage ?? "Sign-in failed. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* v25.52 Track 0.3 — route into a specific chosen workspace, setting the
   * client role so downstream gating + the PersonaSwitcher reflect the choice.
   * Mirrors the existing per-workspace landing targets used elsewhere in route(). */
  function navigateToWorkspace(ws: WorkspaceKey, ctx: UserContext) {
    switch (ws) {
      case "founder": {
        setRole("founder");
        const n = ctx.founder.companies.length;
        navigate(n === 1 ? "/founder/dashboard" : "/select-company");
        return;
      }
      case "investor":
        setRole("investor");
        navigate("/investor/dashboard");
        return;
      case "partner":
        // Partner workspace uses the investor client role for gating parity with
        // the prior partner-landing behavior; the partner dashboard is the target.
        navigate("/collective/partner/dashboard");
        return;
      case "collective":
        setRole("investor");
        navigate("/collective");
        return;
    }
  }

  function route(ctx: UserContext) {
    // Admin accounts cannot enter through the public portal. Surface
    // a clear error and point them to /admin/login. We do NOT silently route
    // an admin into the admin dashboard from here — the dedicated admin page
    // is the only authorised entry point.
    if (ctx.isAdmin) {
      setErrorMsg("Admin sign-in is on a separate page. Use the admin login URL.");
      return;
    }

    const isFounder  = ctx.founder.companies.length > 0;
    // v23.8 W-7: a freshly-created investor has state "NONE" until they redeem
    // an invite, but they may already hold pending round invitations or
    // cap-table positions. Treat any of those as "is an investor" so they land
    // on /investor/dashboard instead of being bounced to /founder/subscribe.
    const isInvestor =
      ctx.investor.state !== "NONE" ||
      ctx.investor.invitedRounds.length > 0 ||
      ctx.investor.capTablePositions.length > 0;

    // Honour the chosen portal if the account supports it.
    if (portal === "investor" && isInvestor) {
      setRole("investor");
      navigate("/investor/dashboard");
      return;
    }
    if (portal === "founder" && isFounder) {
      setRole("founder");
      const n = ctx.founder.companies.length;
      if (n === 1) navigate("/founder/dashboard");
      else navigate("/select-company");
      return;
    }
    if (portal === "founder" && !isFounder && !isInvestor) {
      // v25.43 F13 R2-2 — brand-new founder with NO company. Canonical first
      // step is /company-profile?onboarding=1 (then subscribe): F13 requires
      // the founder to create a company BEFORE the subscription gate, so we
      // send them to the company-onboarding step rather than /founder/subscribe.
      // B-V11-1 (the original loop) was caused by routing to /auth/signup;
      // /company-profile is loop-safe because it is auth-only (not
      // subscription-gated) and renders its own onboarding empty state.
      setRole("founder");
      navigate("/company-profile?onboarding=1");
      return;
    }

    // Wrong-portal cases — offer an inline switch instead of bouncing.
    if (portal === "investor" && isFounder) {
      setWrongPortalSuggest({ to: "founder", ctx });
      return;
    }
    if (portal === "founder" && isInvestor) {
      setWrongPortalSuggest({ to: "investor", ctx });
      return;
    }

    // Fallback — account exists but matches neither portal cleanly.
    // FIX 1a — never dump an authenticated user onto the marketing home (`/`).
    // Prefer a concrete workspace; if none resolves, honour the chosen portal
    // by returning to its login rather than the public landing page.
    if (isFounder)       { setRole("founder");  navigate("/select-company"); }
    else if (isInvestor) { setRole("investor"); navigate("/investor/dashboard"); }
    else if (portal === "investor") { setRole("investor"); navigate("/investor/dashboard"); }
    else                  navigate(`/login?portal=${portal}`);
  }

  function acceptSuggestedPortal() {
    if (!wrongPortalSuggest) return;
    const { to, ctx } = wrongPortalSuggest;
    if (to === "founder") {
      setRole("founder");
      const n = ctx.founder.companies.length;
      navigate(n === 1 ? "/founder/dashboard" : "/select-company");
    } else if (to === "investor") {
      setRole("investor");
      navigate("/investor/dashboard");
    }
  }

  function fillDemo(p: typeof DEMO_PRESETS[number]) {
    setEmail(p.email);
    setPassword(p.password);
    setPortal(p.portal);
    setErrorMsg(null);
    setWrongPortalSuggest(null);
  }

  return (
    <AuthShell
      title="Sign in to Capavate"
      subtitle={meta.subtitle}
      tagline={brandCopy.tagline}
      subline={brandCopy.subline}
      footer={
        <div className="space-y-3">
          <div>
            <Link href="/auth/forgot" className="text-[#cc0001] hover:underline" data-testid="link-forgot">
              Forgot password?
            </Link>
          </div>
          {portal === "founder" && (
            <div>
              New here?{" "}
              <Link href="/auth/signup" className="text-[#cc0001] hover:underline" data-testid="link-signup">
                Create a founder account
              </Link>
            </div>
          )}
          {portal === "investor" && (
            <div className="text-xs space-y-1.5">
              <div className="text-muted-foreground">Investors join Capavate by invitation only.</div>
              <div>
                Have an invitation token?{" "}
                <Link href="/auth/redeem" className="text-[#cc0001] hover:underline" data-testid="link-redeem">
                  Redeem your invitation
                </Link>
              </div>
              <div className="text-muted-foreground">
                No invitation? Ask the founder of the round to send one.
              </div>
            </div>
          )}
          {/* O6 (W-FIX1d, 2026-07-19) — the public tabs are Founder + Investor
           * only, so Consortium Partners had no signposted entry and were forced
           * onto the Investor tab. Surface a clear partner sign-in path to the
           * dedicated /partner/login page. */}
          <div className="text-xs border-t border-border/50 pt-3 text-muted-foreground" data-testid="partner-login-affordance">
            Consortium Partner?{" "}
            <Link href="/partner/login" className="text-[#cc0001] hover:underline font-medium" data-testid="link-partner-login">
              Sign in to the partner portal
            </Link>
          </div>
        </div>
      }
    >
      {/* v25.52 Track 0.3 (Option 1) — multi-role WORKSPACE CHOOSER. Shown after a
          successful login when the account qualifies for 2+ workspaces, instead
          of silently forcing a single one. Single-role accounts never see this. */}
      {roleChoice ? (
        <div className="space-y-4" data-testid="workspace-chooser">
          <div className="text-center space-y-1">
            <h2 className="text-lg font-semibold">Choose your workspace</h2>
            <p className="text-sm text-muted-foreground">
              Your account has access to more than one workspace. Pick where you'd
              like to go — you can switch anytime from the top bar.
            </p>
          </div>
          <div className="space-y-2">
            {roleChoice.options.map((ws) => {
              const LABELS: Record<WorkspaceKey, { label: string; desc: string }> = {
                founder: { label: "Founder", desc: "Cap tables, rounds, and investor CRM" },
                investor: { label: "Investor", desc: "Your positions, deal flow, and decisions" },
                partner: { label: "Consortium Partner", desc: "SPVs, syndicates, and your partner network" },
                collective: { label: "Collective", desc: "Chapter directory, deal room, and members" },
              };
              const info = LABELS[ws];
              return (
                <button
                  key={ws}
                  type="button"
                  data-testid={`workspace-option-${ws}`}
                  onClick={() => {
                    // Use the authoritative ctx captured at login time (stored in
                    // roleChoice) — no cache-timing dependency, no unsafe cast.
                    navigateToWorkspace(ws, roleChoice.ctx);
                  }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border/70 bg-white hover:border-[#cc0001]/50 hover:bg-[#cc0001]/[0.03] transition-all text-left"
                >
                  <span>
                    <span className="block font-semibold text-foreground">{info.label}</span>
                    <span className="block text-xs text-muted-foreground">{info.desc}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-[#cc0001]" />
                </button>
              );
            })}
          </div>
        </div>
      ) : (
      <>
      {/* Portal tabs — visible, accessible, click to switch */}
      <div
        role="tablist"
        aria-label="Choose portal"
        className="grid grid-cols-2 gap-1.5 mb-6 bg-muted/60 rounded-lg p-1.5 border border-border/60"
        data-testid="portal-tabs"
      >
        {(Object.keys(PORTAL_META) as Portal[]).map((p) => {
          const isActive = portal === p;
          const Icon = PORTAL_META[p].icon;
          // v25.43 R4-1 — capavate.com brand flip. Both portal tabs now use the
          // single Capavate brand red (#cc0001) when active: a red FILLED pill
          // with white text + red focus ring. The per-portal teal/burgundy
          // distinction is retired; the brand color is the same for both, and
          // the active/inactive distinction is filled-vs-de-emphasised. Both
          // tabs ALWAYS render — the inactive tab is never removed.
          // v25.48.3 Q-A1 — make the active portal tab MORE highlighted (Ozan):
          // bolder red fill, stronger ring, subtle lift; inactive tabs become
          // distinct white pills so the two choices read clearly as tabs. Both
          // tabs ALWAYS render.
          const activeFill =
            "bg-[#cc0001] text-white shadow-md ring-2 ring-[#cc0001] font-bold scale-[1.02]";
          const inactiveFill =
            "bg-white text-foreground border border-border/70 hover:border-[#cc0001]/40 hover:text-[#cc0001]";
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-active={isActive ? "true" : "false"}
              onClick={() => switchPortal(p)}
              data-testid={`tab-portal-${p}`}
              className={[
                "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-all",
                isActive
                  ? activeFill
                  : inactiveFill,
              ].join(" ")}
            >
              <Icon className="h-4 w-4" />
              {PORTAL_META[p].label}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" data-testid="form-login" autoComplete="on">
        <div>
          <Label htmlFor="email" className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            data-testid="input-email"
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
            data-testid="input-password"
          />
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2"
            data-testid="text-login-error"
          >
            {errorMsg}
          </div>
        )}

        {wrongPortalSuggest && (
          <div
            className="text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2"
            data-testid="panel-wrong-portal"
          >
            <div className="flex items-start gap-2">
              <PortalIcon className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
              <div className="text-amber-900">
                Your account is set up for the{" "}
                <span className="font-semibold">{PORTAL_META[wrongPortalSuggest.to].label}</span> portal.
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                onClick={acceptSuggestedPortal}
                className="bg-[#cc0001] hover:bg-[#a30001] text-white rounded-full font-semibold"
                data-testid="button-accept-portal"
              >
                Continue as {PORTAL_META[wrongPortalSuggest.to].label} <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { switchPortal(wrongPortalSuggest.to); setWrongPortalSuggest(null); }}
                data-testid="button-stay-on-portal"
              >
                Stay here
              </Button>
            </div>
          </div>
        )}

        <Button
          type="submit"
          className="w-full bg-[#cc0001] hover:bg-[#a30001] text-white rounded-full font-semibold"
          disabled={submitting || email.trim().length === 0 || password.length === 0}
          data-testid="button-submit-login"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {/* Demo persona quick-fill — only when ?demo=1 */}
      {demoMode && (
        <div className="mt-6 border-t pt-4" data-testid="demo-personas-panel">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Demo personas (visible because ?demo=1)
          </div>
          <div className="grid gap-1.5">
            {DEMO_PRESETS.filter((p) => p.portal === portal).map((p) => (
              <button
                key={p.email}
                type="button"
                onClick={() => fillDemo(p)}
                className="text-left text-xs px-2 py-1.5 rounded hover:bg-muted/50 text-muted-foreground"
                data-testid={`preset-${p.email.replace(/[^a-z]/gi, "_")}`}
              >
                <span className="font-medium text-foreground">{p.email}</span> — {p.label}
              </button>
            ))}
            {DEMO_PRESETS.filter((p) => p.portal === portal).length === 0 && (
              <div className="text-xs text-muted-foreground italic">No demo personas for this portal.</div>
            )}
          </div>
        </div>
      )}
      </>
      )}
    </AuthShell>
  );
}
