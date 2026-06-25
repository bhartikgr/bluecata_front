import { Switch, Route, Router, useLocation, Redirect } from "wouter";
import { V23413_FIXES_SHIPPED } from "@/lib/v23413Marker";
void V23413_FIXES_SHIPPED;
// v23.4.3 Phase 2: removed useHashLocation import — switched to BrowserRouter
// (History API). URLs are now /founder/dashboard, not /#/founder/dashboard.
// Ozan architectural decision #1 locked.
import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEntitlement } from "@/lib/entitlement";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { RoleProvider } from "@/lib/role";
import NotFound from "@/pages/not-found";
// Wave C FIX C7 — polished admin 404.
import AdminNotFound from "@/pages/admin/AdminNotFound";
import FinancialsFill from "@/pages/FinancialsFill";
import { AppShell } from "@/components/AppShell";

import Home from "@/pages/home/Home";
import LegalTermsPage from "@/pages/Terms"; // v25.26 — stub Terms of Service page (was 404 fallback to login)
import LegalPrivacyPage from "@/pages/Privacy"; // v25.26 — stub Privacy Policy page (note: separate from @/pages/settings/PrivacyPage which is the settings screen)
// Sprint-fix May 14 2026 — import the new guard + boundary components
import { RequireAuth } from "@/components/RequireAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import Landing from "@/pages/Landing";
import Login from "@/pages/auth/Login";
import Signup from "@/pages/auth/Signup";
import Forgot from "@/pages/auth/Forgot";
import Redeem from "@/pages/auth/Redeem";
import SetPasswordPage from "@/pages/SetPasswordPage"; // v23.4.1 Task C — consortium partner invite
import SelectCompany from "@/pages/SelectCompany";

import FounderDashboard from "@/pages/founder/Dashboard";
import FounderCompany from "@/pages/founder/Company";
import FounderCapTable from "@/pages/founder/CapTable";
import FounderRounds from "@/pages/founder/Rounds";
import FounderRoundNew from "@/pages/founder/RoundNew";
import FounderRoundDetail from "@/pages/founder/RoundDetail";
import FounderTermSheet from "@/pages/founder/TermSheet";
import FounderCRM from "@/pages/founder/CRM";
import FounderCRMNew from "@/pages/founder/CRMNew";
import FounderDataroom from "@/pages/founder/Dataroom";
import FounderReports from "@/pages/founder/Reports";
import FounderReportNew from "@/pages/founder/ReportNew";
import FounderActivity from "@/pages/founder/Activity";
import FounderSettings from "@/pages/founder/Settings";
import FounderProfileWizard from "@/pages/founder/ProfileWizard";
import FounderCollective from "@/pages/founder/Collective";
import FounderMessages from "@/pages/founder/Messages";
import FounderApplyToCollective from "@/pages/founder/ApplyToCollective";
import FounderWelcome from "@/pages/founder/Welcome";
import FounderGlossary from "@/pages/founder/Glossary";
import FounderNetworkPosts from "@/pages/founder/NetworkPosts";
import InvestorNetworkPosts from "@/pages/investor/NetworkPosts";
import PostDetail from "@/pages/PostDetail";

// Patch v6 — Partner workspace pages
import PartnerDashboard from "@/pages/partner/PartnerDashboard";
import PartnerClients from "@/pages/partner/PartnerClients";
import PartnerClientDetail from "@/pages/partner/PartnerClientDetail";
import PartnerPipeline from "@/pages/partner/PartnerPipeline";
import PartnerTeam from "@/pages/partner/PartnerTeam";
import PartnerNotes from "@/pages/partner/PartnerNotes";
import PartnerTasks from "@/pages/partner/PartnerTasks";
import PartnerFiles from "@/pages/partner/PartnerFiles";
import PartnerSettings from "@/pages/partner/PartnerSettings";
import PartnerSpvs from "@/pages/partner/PartnerSpvs";
import PartnerSpvDetail from "@/pages/partner/PartnerSpvDetail";
import PartnerFunds from "@/pages/partner/PartnerFunds";
import PartnerBilling from "@/pages/partner/PartnerBilling"; /* v25.32 A3 — consortium partner commission ledger */
/* v25.33 Consortium Partner Payment Model — partner self-service pages. */
import PartnerSubscribe from "@/pages/partner/PartnerSubscribe";
import PartnerAgreementSign from "@/pages/partner/PartnerAgreementSign";
import PartnerTaxForm from "@/pages/partner/PartnerTaxForm";
import PartnerFundDetail from "@/pages/partner/PartnerFundDetail";
import RedeemPartnerInvite from "@/pages/auth/RedeemPartnerInvite";

import InvestorDashboard from "@/pages/investor/Dashboard";
import InvestorInvitations from "@/pages/investor/Invitations";
import InvestorInvitationDetail from "@/pages/investor/InvitationDetail";
import InvestorPortfolio from "@/pages/investor/Portfolio";
import InvestorCRM from "@/pages/investor/CRM";
import InvestorCRMNew from "@/pages/investor/CRMNew";
import InvestorApplyToCollective from "@/pages/investor/ApplyToCollective";
import InvestorProfile from "@/pages/investor/Profile";
import InvestorMessages from "@/pages/investor/Messages";
import InvestorCollective from "@/pages/investor/Collective";
import InvestorSignup from "@/pages/investor/Signup";
import InvestorLogin from "@/pages/investor/Login";
import InvestorCompanyDetail from "@/pages/investor/CompanyDetail";
import FounderCompanyDetail from "@/pages/founder/CompanyDetail";
// Sprint 20 Wave 2 — new investor pages
import InvestorSettings from "@/pages/investor/Settings";
import InvestorGlossary from "@/pages/investor/Glossary";
import InvestorNotifications from "@/pages/investor/Notifications";

import AdminLogin from "@/pages/admin/Login";
// 23-May Fix 7 — dedicated Consortium Partner login + signup-apply pages
import PartnerLogin from "@/pages/partner/PartnerLogin";
import PartnerSignup from "@/pages/partner/PartnerSignup";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminCompanies from "@/pages/admin/Companies";
import AdminCompanyDetail from "@/pages/admin/CompanyDetail";
import AdminInvestors from "@/pages/admin/Investors";
import AdminInvestorImport from "@/pages/admin/InvestorImport";
import AdminUsers from "@/pages/admin/Users";
import AdminFormulas from "@/pages/admin/Formulas";
import AdminFormulaDetail from "@/pages/admin/FormulaDetail";
import AdminFormulaNew from "@/pages/admin/FormulaNew";
import AdminLifecyclePolicies from "@/pages/admin/LifecyclePolicies";
import AdminRegionsExtensions from "@/pages/admin/RegionsExtensions";
import AdminRegionExtensionDetail from "@/pages/admin/RegionExtensionDetail";
import AdminAuditLog from "@/pages/admin/AuditLog";
import AuditChainVerifyPage from "@/pages/admin/AuditChainVerifyPage"; /* v19 Phase C */
import AdminReconciliation from "@/pages/admin/Reconciliation";
import AdminPayments from "@/pages/admin/Payments"; /* v25.32 P1h */
/* v25.33 Consortium Partner Payment Model — admin surfaces (DB-driven). */
import AdminPartners from "@/pages/admin/Partners";
import AdminPartnerFeeSchedules from "@/pages/admin/PartnerFeeSchedules";
import AdminApplicationFee from "@/pages/admin/AdminApplicationFee"; /* v25.39 */
import AdminCommissionRates from "@/pages/admin/AdminCommissionRates"; /* v25.39 */
import AdminPartnerPL from "@/pages/admin/PartnerPL";
/* v25.34 Collective Payment Model — admin pages (DB-driven). */
import AdminCollectivePaymentSchedules from "@/pages/admin/CollectivePaymentSchedules";
import AdminCollectivePaymentPL from "@/pages/admin/CollectivePaymentPL";
import AdminTelemetry from "@/pages/admin/Telemetry";
// Sprint 12 — new admin + cross-role pages
import NotificationCenter from "@/pages/NotificationCenter";
import AdminBridge from "@/pages/admin/Bridge";
import AdminBridgeHistory from "@/pages/admin/BridgeHistory";
import AdminPartnerDetail from "@/pages/admin/PartnerDetail";
import AdminEmail from "@/pages/admin/Email";
import AdminEmailComposer from "@/pages/admin/EmailComposer";
import AdminNotifications from "@/pages/admin/Notifications";
import AdminNotificationComposer from "@/pages/admin/NotificationComposer";
import AdminPricing from "@/pages/admin/Pricing";
import AdminPricingModelDetail from "@/pages/admin/PricingModelDetail";
// Sprint 28 Billing — founder subscription + billing pages
import FounderSubscribe from "@/pages/founder/Subscribe";
import FounderBilling from "@/pages/founder/Billing";
// v24.2 Airwallex wiring — hosted-checkout return landing (polls activation).
import BillingReturn from "@/pages/founder/BillingReturn";
import AdminInvestorDetail from "@/pages/admin/InvestorDetail";
import AdminSync from "@/pages/admin/Sync";
import AdminMigration from "@/pages/admin/Migration";
// CP Phase B — Apply flow + Admin queue + Onboarding + Privacy
import ConsortiumApplyPage from "@/pages/public/ConsortiumApplyPage";
import AdminConsortiumApplicationsPage from "@/pages/admin/ConsortiumApplicationsPage";
// v23.5 C-003 — admin Collective pages
import AdminCollectiveApplications from "@/pages/admin/CollectiveApplications";
import AdminCollectiveMembers from "@/pages/admin/CollectiveMembers";
import AdminCollectiveSettings from "@/pages/admin/CollectiveSettings";
import AdminCollectiveWaitlist from "@/pages/admin/CollectiveWaitlist";
import { V25_COLLECTIVE_SHIPPED } from "@/lib/v25Marker"; void V25_COLLECTIVE_SHIPPED;
import { V26_FIXES_SHIPPED } from "@/lib/v26Marker"; void V26_FIXES_SHIPPED;
import PartnerOnboardingChecklistPage from "@/pages/partner/OnboardingChecklistPage";
import PrivacyPage from "@/pages/settings/PrivacyPage";
import CollectivePreview from "@/pages/CollectivePreview";
import { seedSprint3Telemetry } from "@/lib/sprint3Seed";
import { useRealtimeSync } from "@/lib/realtimeSync";
// Wave C-3 + C-4 — Collective Shell
import { CollectiveShell } from "@/components/CollectiveShell";
import CollectiveDashboard from "@/pages/collective/CollectiveDashboard";
import CollectiveDealRoom from "@/pages/collective/CollectiveDealRoom";
import CollectiveDealRoomDetail from "@/pages/collective/CollectiveDealRoomDetail";
import CollectiveMembers from "@/pages/collective/CollectiveMembers";
import CollectiveCompanies from "@/pages/collective/CollectiveCompanies";
import CollectiveCompanyDetail from "@/pages/collective/CollectiveCompanyDetail";
import CollectiveSoftCircles from "@/pages/collective/CollectiveSoftCircles";
import CollectiveDscPipeline from "@/pages/collective/CollectiveDscPipeline";
import CollectiveDscScores from "@/pages/collective/CollectiveDscScores";
import CollectiveTransactionPrep from "@/pages/collective/CollectiveTransactionPrep";
import CollectiveMembership from "@/pages/collective/CollectiveMembership";
// v25.22 NC-4 fix — the live self-serve membership UI (tier catalog +
// Subscribe buttons + working Airwallex checkout/portal mutations) lives in
// MembershipPage.tsx. It was previously unreachable: every router (App.tsx +
// backup copies) routed `/collective/membership` to the read-only
// `CollectiveMembership.tsx` summary, and its "Upgrade Membership" button
// navigated back to the same route. The upgrade/payment happy path was dead
// code. We now mount MembershipPage at the same route so members can
// actually checkout, and keep CollectiveMembership reachable as
// `/collective/membership-summary` for the read-only view.
import MembershipPage from "@/pages/collective/MembershipPage";
import CollectiveActivity from "@/pages/collective/CollectiveActivity";
import CollectiveSettings from "@/pages/collective/CollectiveSettings";
import EventsCalendarPage from "@/pages/collective/EventsCalendarPage";
import LeaderboardPage from "@/pages/collective/LeaderboardPage";
/* v25.12 NC2 — the three pages below are fully implemented but were never
 * imported or routed. Adding them so deep links from the calendar, nav
 * items, and notification CTAs no longer land on NotFoundOrLogin. */
import ScreeningEventsPage from "@/pages/collective/ScreeningEventsPage";
import AskExpertPage from "@/pages/collective/AskExpertPage";
// v25.42 (Bucket B) — 9 new Collective routes/components.
import CollectiveConnections from "@/pages/collective/Connections";
import CollectiveRecaps from "@/pages/collective/Recaps";
import CollectiveScreeningRecaps from "@/pages/collective/ScreeningRecaps";
import CollectiveChapters from "@/pages/collective/Chapters";
import CollectiveMyRequests from "@/pages/collective/MyRequests";
import CollectivePublicProfile from "@/pages/collective/PublicProfile";
import CollectivePartnersDirectory from "@/pages/collective/PartnersDirectory";
import QuestionDetailPage from "@/pages/collective/QuestionDetailPage";

// Bootstrap demo telemetry once at app load
if (import.meta.env.MODE !== "production") {
  seedSprint3Telemetry();
}

/* ---------- Sprint 28 Billing — Subscription gate HOC ----------
 * Wraps any founder route that requires an active subscription.
 * Reads subscription from /api/founder/subscription on every mount.
 * Non-active statuses redirect to /founder/subscribe.
 * Does NOT gate: /founder/subscribe, /founder/company, /founder/settings, /founder/billing.
 * ---------------------------------------------------------------- */
const INACTIVE_STATUSES = new Set(["pending_payment", "past_due", "canceled", "cancelled", "paused", "unpaid"]);

function RequireActiveSubscription({ children }: { children: ReactNode }) {
  const { data: entCtx, isLoading: entLoading } = useEntitlement();
  // Patch v4: no demo fallback. If user has no active company, send them to
  // /founder/subscribe (which handles the empty state) instead of querying
  // for a hardcoded "co_novapay" subscription.
  const companyId = entCtx?.founder?.activeCompanyId ?? "";

  const { data, isLoading } = useQuery<{ ok: boolean; subscription: { status: string } }>({
    queryKey: ["/api/founder/subscription", companyId],
    queryFn: async () => {
      try {
        const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
        const res = await fetch(`${API_BASE}/api/founder/subscription?companyId=${encodeURIComponent(companyId)}`);
        if (!res.ok) return { ok: false, subscription: { status: "pending_payment" } };
        return res.json();
      } catch {
        // Network error: allow through in demo/dev so UI isn't broken
        return { ok: true, subscription: { status: "active" } };
      }
    },
    enabled: !!companyId,
    staleTime: 0,
    retry: false,
  });

  // v23.8 W-1: wait for the entitlement context before deciding. On a hard
  // navigation `useEntitlement()` is still loading, so `companyId` is "" and the
  // old code redirected every founder route to /founder/subscribe. Hold on a
  // skeleton until /api/auth/me resolves.
  if (entLoading || entCtx === undefined) {
    return (
      <div className="p-6" data-testid="subscription-gate-entitlement-loading">
        <div className="h-4 w-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  // No active company yet (fresh user) — v25.43 F13: send first-time founders
  // to the company-creation step FIRST (company-before-subscribe onboarding),
  // not straight to the paywall. The ?onboarding=1 flag tells /company-profile
  // it's the create-company step; on a successful create it forwards to
  // /founder/dashboard (R3-8 — no longer the paywall). The INACTIVE_STATUSES redirect below (inactive
  // subscription state machine) is a DIFFERENT case and still goes to subscribe.
  if (!companyId) {
    return <Redirect to="/company-profile?onboarding=1" />;
  }

  if (isLoading) {
    return (
      <div className="p-6" data-testid="subscription-gate-loading">
        <div className="h-4 w-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  const status = data?.subscription?.status ?? "pending_payment";
  if (INACTIVE_STATUSES.has(status)) {
    return <Redirect to="/founder/subscribe" />;
  }

  return <>{children}</>;
}

function isAuthRoute(path: string) {
  return (
    path === "/onboarding" ||
    path === "/" ||
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path === "/investor/login" ||
    path === "/admin/login" ||
    path === "/partner/login" ||
    path === "/partner/signup" ||
    path.startsWith("/investor/signup") ||
    path.startsWith("/collective/preview") ||
    path.startsWith("/collective/") ||
    path.startsWith("/auth/") ||
    path === "/set-password" || // v23.4.1 Task C — public invite redemption
    path === "/select-company" ||
    // Wave B FIX 8 — legacy/leak paths render bare (no AppShell) so the
    // sidebar/role chip never leak to unauthenticated visitors.
    path === "/dashboard" ||
    path === "/cap-table" ||
    path === "/rounds" ||
    // v25.43 R3-6 — /company-profile is NO LONGER force-bare. The onboarding
    // step (/company-profile?onboarding=1) must render INSIDE the founder app
    // shell (sidebar + header + brand). Anonymous visitors are still protected
    // because AppRouter's `bare` flag also becomes true when `!isAuthed`, so
    // the shell never leaks to unauthenticated probers.
    path.startsWith("/invite/")
  );
}

/* ---------- Wave B FIX 8 (I-BUG-006, I-BUG-007) ---------- */
/* Common legacy paths the QA found exposed. Each component reads
 * /api/auth/me; unauthenticated → /auth/login?returnTo=...,
 * authenticated → the appropriate portal home. Renders BARE (no shell). */
function LegacyDashboardRedirect() {
  const [currentLocation] = useLocation();
  const { data, isLoading } = useQuery<{ isAuthed?: boolean; isAdmin?: boolean; founder?: { activeCompanyId: string | null }; investor?: { state: string } }>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return { isAuthed: false };
        return res.json();
      } catch {
        return { isAuthed: false };
      }
    },
    staleTime: 30_000,
    retry: false,
  });
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" data-testid="legacy-redirect-loading">
        <div className="text-sm text-muted-foreground">Redirecting to your dashboard…</div>
      </div>
    );
  }
  if (!data?.isAuthed) {
    const returnTo = encodeURIComponent(currentLocation);
    return <Redirect to={`/auth/login?returnTo=${returnTo}`} />;
  }
  if (data.isAdmin) return <Redirect to="/admin/dashboard" />;
  if (data.investor && data.investor.state && data.investor.state !== "NONE")
    return <Redirect to="/investor/dashboard" />;
  return <Redirect to="/founder/dashboard" />;
}

function LegacyInviteRedirect() {
  // Always redirect to the public landing — invite tokens are now handled
  // via /auth/redeem (token in querystring) so the legacy /invite/:token
  // path is no longer the canonical ingress.
  const [currentLocation] = useLocation();
  // Pull the token out of the wouter path (last segment).
  const token = currentLocation.split("/").filter(Boolean).pop() ?? "";
  if (token && token !== "invite") {
    return <Redirect to={`/auth/redeem?token=${encodeURIComponent(token)}`} />;
  }
  return <Redirect to="/onboarding" />;
}

/* Auth-aware catch-all. If the user is signed in, show a real 404; if
 * not, send them to login with returnTo. This stops the public 404 inside
 * the founder shell that the QA called out (I-BUG-008). */
function NotFoundOrLogin() {
  const [currentLocation] = useLocation();
  const { data, isLoading } = useQuery<{ isAuthed?: boolean }>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return { isAuthed: false };
        return res.json();
      } catch {
        return { isAuthed: false };
      }
    },
    staleTime: 30_000,
    retry: false,
  });
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!data?.isAuthed) {
    const returnTo = encodeURIComponent(currentLocation);
    return <Redirect to={`/auth/login?returnTo=${returnTo}`} />;
  }
  return <NotFound />;
}

/* ---------- Wave C FIX C6 (I-FINAL-001) ---------- */
/* The Investor / Founder / Partner / Collective / Admin app shells must
 * never render to an UNAUTHENTICATED visitor — doing so leaks the sidebar,
 * "ROLE: Investor" pill, search bar, and other internal navigation to
 * anonymous URLs (e.g. /#/investor/pipeline, /#/investor/deal-flow,
 * /#/investor/billing, /#/investor/activity, /#/dashboard). Wave B FIX 8
 * patched a handful of explicit legacy paths via `isAuthRoute`, but any
 * unregistered URL under a portal namespace fell through to the catch-all
 * INSIDE <AppShell>, exposing the shell to anonymous probers.
 *
 * Fix: probe /api/auth/me once at the AppRouter level. If the visitor is
 * NOT authenticated, render the route tree BARE — no AppShell chrome.
 * Authenticated visitors keep the existing shell behaviour. Routes that
 * are intentionally public-and-bare (the auth shell, marketing landing,
 * etc.) are unaffected because they continue to opt in via isAuthRoute.
 */
function useIsAuthedProbe(): { isAuthed: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery<{ isAuthed?: boolean }>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return { isAuthed: false };
        return res.json();
      } catch {
        return { isAuthed: false };
      }
    },
    staleTime: 30_000,
    retry: false,
  });
  return { isAuthed: Boolean(data?.isAuthed), isLoading };
}

function AppRouter() {
  const [location] = useLocation();
  const { isAuthed, isLoading: authProbeLoading } = useIsAuthedProbe();
  // Wave C FIX C6: never render AppShell to anonymous users. `bare` is true
  // if either the route is an explicit auth/landing path OR the visitor is
  // unauthenticated. While the auth probe is loading we render bare to
  // avoid a flash of shell chrome.
  const bare = isAuthRoute(location) || authProbeLoading || !isAuthed;
  useRealtimeSync();

  const routes = (
    /* Sprint-fix May 14 2026 — entire Switch wrapped in ErrorBoundary so that
     * any unhandled render error (e.g. "Cannot read properties of undefined
     * (reading 'tone')") shows the recovery card instead of a blank page. */
    <ErrorBoundary>
      <Switch>
        {/* ===== PUBLIC ROUTES — NO auth gate ===== */}
        <Route path="/" component={Home} />
        <Route path="/onboarding" component={Landing} />
        {/* v25.26 — Terms and Privacy stub routes. Previously these URLs fell
            through to the SPA login fallback (REG-NEW-103). Real legal
            content is in the Terms/Privacy components; replace with final
            policy content before general availability. */}
        <Route path="/terms" component={LegalTermsPage} />
        <Route path="/terms-of-service" component={LegalTermsPage} />
        <Route path="/privacy" component={LegalPrivacyPage} />
        <Route path="/privacy-policy" component={LegalPrivacyPage} />
        {/* CP Phase B — Public consortium-partner application */}
        <Route path="/apply/consortium" component={ConsortiumApplyPage} />
        <Route path="/login" component={Login} />
        <Route path="/signup" component={Signup} />
        <Route path="/forgot-password" component={Forgot} />

        {/* Sprint 15 — new auth shell (public) */}
        <Route path="/auth/login" component={Login} />
        <Route path="/auth/signup" component={Signup} />
        <Route path="/auth/forgot" component={Forgot} />
        <Route path="/auth/redeem" component={Redeem} />
        {/* v23.4.1 Task C — Consortium Partner set-password invite link (public) */}
        <Route path="/set-password" component={SetPasswordPage} />
        {/* A1 (v24.0) — alias for cached forgot-password email links that point to /auth/set-password */}
        <Route path="/auth/set-password" component={SetPasswordPage} />

        {/* dedicated admin login (public) */}
        <Route path="/admin/login" component={AdminLogin} />

        {/* 23-May Fix 7 — dedicated Consortium Partner login + signup-apply (public).
         * These mirror /admin/login: partner-only persona at a discoverable URL
         * instead of relying on /auth/login post-auth probing of /api/partner/me. */}
        <Route path="/partner/login" component={PartnerLogin} />
        <Route path="/partner/signup" component={PartnerSignup} />
        <Route path="/select-company" component={SelectCompany} />

        {/* Public token-gated flow — NOT wrapped in RequireAuth (token IS the auth) */}
        <Route path="/investor/login" component={InvestorLogin} />
        <Route path="/investor/signup" component={InvestorSignup} />

        {/* Patch v6 — partner magic-link redemption (public; one-time token) */}
        <Route path="/auth/redeem-partner-invite/:token" component={RedeemPartnerInvite} />

        {/* Public: collective preview */}
        <Route path="/collective/preview" component={CollectivePreview} />

        {/* Public: financials fill (token-gated at route level) */}
        <Route path="/financials-fill/:token" component={FinancialsFill} />

        {/* ===== FOUNDER ROUTES — RequireAuth + optional subscription gate ===== */}
        {/* Sprint 28 Billing — Subscribe + Billing are NOT gated (user may be mid-payment) */}
        <Route path="/founder/subscribe">
          {() => <RequireAuth><FounderSubscribe /></RequireAuth>}
        </Route>
        <Route path="/founder/billing">
          {() => <RequireAuth><FounderBilling /></RequireAuth>}
        </Route>
        {/* v24.2 Airwallex wiring — return from hosted checkout; NOT subscription-gated
            (the plan may still be activating when the browser lands here). */}
        <Route path="/founder/billing/return">
          {() => <RequireAuth><BillingReturn /></RequireAuth>}
        </Route>

        {/* Gated founder routes — require auth + active subscription */}
        <Route path="/founder/dashboard">
          {() => <RequireAuth><RequireActiveSubscription><FounderDashboard /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/captable">
          {() => <RequireAuth><RequireActiveSubscription><FounderCapTable /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/rounds/new">
          {() => <RequireAuth><RequireActiveSubscription><FounderRoundNew /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/rounds/:id/termsheet">
          {(p) => <RequireAuth><RequireActiveSubscription><FounderTermSheet /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/rounds/:id">
          {(p) => <RequireAuth><RequireActiveSubscription><FounderRoundDetail /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/rounds">
          {() => <RequireAuth><RequireActiveSubscription><FounderRounds /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/crm/new">
          {() => <RequireAuth><RequireActiveSubscription><FounderCRMNew /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/crm">
          {() => <RequireAuth><RequireActiveSubscription><FounderCRM /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/dataroom">
          {() => <RequireAuth><RequireActiveSubscription><FounderDataroom /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/reports/new">
          {() => <RequireAuth><RequireActiveSubscription><FounderReportNew /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/reports">
          {() => <RequireAuth><RequireActiveSubscription><FounderReports /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/messages">
          {() => <RequireAuth><RequireActiveSubscription><FounderMessages /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/network-posts">
          {() => <RequireAuth><RequireActiveSubscription><FounderNetworkPosts /></RequireActiveSubscription></RequireAuth>}
        </Route>
        <Route path="/founder/posts/:id">
          {() => <RequireAuth><RequireActiveSubscription><PostDetail role="founder" /></RequireActiveSubscription></RequireAuth>}
        </Route>

        {/* Founder routes — auth required, NOT subscription-gated */}
        <Route path="/founder/company">
          {() => <RequireAuth><FounderCompany /></RequireAuth>}
        </Route>
        <Route path="/founder/profile/wizard">
          {() => <RequireAuth><FounderProfileWizard /></RequireAuth>}
        </Route>
        <Route path="/founder/activity">
          {() => <RequireAuth><FounderActivity /></RequireAuth>}
        </Route>
        <Route path="/founder/settings">
          {() => <RequireAuth><FounderSettings /></RequireAuth>}
        </Route>
        <Route path="/founder/collective">
          {() => <RequireAuth><FounderCollective /></RequireAuth>}
        </Route>
        <Route path="/founder/apply-to-collective">
          {() => <RequireAuth><FounderApplyToCollective /></RequireAuth>}
        </Route>
        <Route path="/founder/welcome">
          {() => <RequireAuth><FounderWelcome /></RequireAuth>}
        </Route>
        <Route path="/founder/glossary">
          {() => <RequireAuth><FounderGlossary /></RequireAuth>}
        </Route>
        <Route path="/founder/companies/:id">
          {() => <RequireAuth><FounderCompanyDetail /></RequireAuth>}
        </Route>

        {/* ===== INVESTOR ROUTES — RequireAuth ===== */}
        <Route path="/investor/dashboard">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorDashboard /></RequireAuth>}
        </Route>
        <Route path="/investor/companies/:id">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorCompanyDetail /></RequireAuth>}
        </Route>
        <Route path="/investor/invitations/:id">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorInvitationDetail /></RequireAuth>}
        </Route>
        <Route path="/investor/invitations">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorInvitations /></RequireAuth>}
        </Route>
        <Route path="/investor/portfolio">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorPortfolio /></RequireAuth>}
        </Route>
        <Route path="/investor/crm/new">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorCRMNew /></RequireAuth>}
        </Route>
        <Route path="/investor/crm">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorCRM /></RequireAuth>}
        </Route>
        <Route path="/investor/apply-to-collective">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorApplyToCollective /></RequireAuth>}
        </Route>
        <Route path="/investor/profile">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorProfile /></RequireAuth>}
        </Route>
        <Route path="/investor/messages">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorMessages /></RequireAuth>}
        </Route>
        <Route path="/investor/collective">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorCollective /></RequireAuth>}
        </Route>
        <Route path="/investor/network-posts">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorNetworkPosts /></RequireAuth>}
        </Route>
        <Route path="/investor/posts/:id">
          {() => <RequireAuth redirectTo="/investor/login"><PostDetail role="investor" /></RequireAuth>}
        </Route>
        <Route path="/investor/settings">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorSettings /></RequireAuth>}
        </Route>
        <Route path="/investor/glossary">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorGlossary /></RequireAuth>}
        </Route>
        <Route path="/investor/notifications">
          {() => <RequireAuth redirectTo="/investor/login"><InvestorNotifications /></RequireAuth>}
        </Route>

        {/* ===== CROSS-ROLE ROUTES ===== */}
        <Route path="/notifications">
          {() => <RequireAuth><NotificationCenter /></RequireAuth>}
        </Route>

        {/* ===== ADMIN ROUTES — RequireAuth role="admin" ===== */}
        <Route path="/admin/dashboard">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminDashboard /></RequireAuth>}
        </Route>
        <Route path="/admin/companies/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCompanyDetail /></RequireAuth>}
        </Route>
        <Route path="/admin/companies">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCompanies /></RequireAuth>}
        </Route>
        <Route path="/admin/investors/import">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminInvestorImport /></RequireAuth>}
        </Route>
        <Route path="/admin/investors/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminInvestorDetail /></RequireAuth>}
        </Route>
        <Route path="/admin/investors">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminInvestors /></RequireAuth>}
        </Route>
        <Route path="/admin/users">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminUsers /></RequireAuth>}
        </Route>
        <Route path="/admin/bridge">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminBridge /></RequireAuth>}
        </Route>
        {/* v25.0 Track 5 — E8: Bridge Event History */}
        <Route path="/admin/bridge-history">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminBridgeHistory /></RequireAuth>}
        </Route>
        {/* v25.33 Consortium Partner Payment Model — admin partner roster (DB-driven).
           MUST precede /admin/partners/:id so wouter matches the exact list path first. */}
        <Route path="/admin/partners">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminPartners /></RequireAuth>}
        </Route>
        {/* v25.33 — partner fee catalogue + partner P&L (DB-driven). */}
        <Route path="/admin/partner-fees">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminPartnerFeeSchedules /></RequireAuth>}
        </Route>
        <Route path="/admin/partner-pl">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminPartnerPL /></RequireAuth>}
        </Route>
        {/* v25.39 — DB-driven fee config editors (application fee + commission rates). */}
        <Route path="/admin/application-fee">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminApplicationFee /></RequireAuth>}
        </Route>
        <Route path="/admin/commission-rates">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCommissionRates /></RequireAuth>}
        </Route>
        {/* v25.34 — Collective payment schedules + Collective P&L (DB-driven). */}
        <Route path="/admin/collective-payment-schedules">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCollectivePaymentSchedules /></RequireAuth>}
        </Route>
        <Route path="/admin/collective-payment-pl">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCollectivePaymentPL /></RequireAuth>}
        </Route>
        {/* v25.0 Track 5 — E7: Admin Partner Detail */}
        <Route path="/admin/partners/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminPartnerDetail /></RequireAuth>}
        </Route>
        <Route path="/admin/sync">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminSync /></RequireAuth>}
        </Route>
        <Route path="/admin/migration">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminMigration /></RequireAuth>}
        </Route>
        <Route path="/admin/email/new">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminEmailComposer /></RequireAuth>}
        </Route>
        <Route path="/admin/email/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminEmailComposer /></RequireAuth>}
        </Route>
        <Route path="/admin/email">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminEmail /></RequireAuth>}
        </Route>
        <Route path="/admin/notifications/new">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminNotificationComposer /></RequireAuth>}
        </Route>
        <Route path="/admin/notifications/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminNotificationComposer /></RequireAuth>}
        </Route>
        <Route path="/admin/notifications">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminNotifications /></RequireAuth>}
        </Route>
        <Route path="/admin/pricing">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminPricing /></RequireAuth>}
        </Route>
        <Route path="/admin/pricing-models">
          {() => <Redirect to="/admin/pricing" />}
        </Route>
        <Route path="/admin/pricing-models/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminPricingModelDetail /></RequireAuth>}
        </Route>
        <Route path="/admin/formulas/new">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminFormulaNew /></RequireAuth>}
        </Route>
        <Route path="/admin/formulas/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminFormulaDetail /></RequireAuth>}
        </Route>
        <Route path="/admin/formulas">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminFormulas /></RequireAuth>}
        </Route>
        <Route path="/admin/regions/:id">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminRegionExtensionDetail /></RequireAuth>}
        </Route>
        <Route path="/admin/regions">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminRegionsExtensions /></RequireAuth>}
        </Route>
        <Route path="/admin/lifecycle-policies">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminLifecyclePolicies /></RequireAuth>}
        </Route>
        <Route path="/admin/audit-log">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminAuditLog /></RequireAuth>}
        </Route>
        {/* CP Phase B — Admin queue for consortium-partner applications + promotion moderation */}
        <Route path="/admin/consortium-applications">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminConsortiumApplicationsPage /></RequireAuth>}
        </Route>
        {/* v19 Phase C — Hash-chain audit verification UI */}
        <Route path="/admin/audit-chain-verify">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AuditChainVerifyPage /></RequireAuth>}
        </Route>
        {/* Wave B FIX 11 (A-BUG-002) — documented alias path used by the v19
            admin runbook + QA scripts. Both routes render the same page. */}
        <Route path="/admin/audit/verify-chain">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AuditChainVerifyPage /></RequireAuth>}
        </Route>
        {/* Wave B FIX (A-BUG-011) — alias for the audit-log page. */}
        <Route path="/admin/audit">
          {() => <Redirect to="/admin/audit-log" />}
        </Route>
        <Route path="/admin/reconciliation">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminReconciliation /></RequireAuth>}
        </Route>
        <Route path="/admin/payments">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminPayments /></RequireAuth>}
        </Route>
        <Route path="/admin/telemetry">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminTelemetry /></RequireAuth>}
        </Route>

        {/* Wave C FIX C7 — admin sidebar route reconciliation + 404 polish.
         * A-FINAL-023 (Avi, 24-May-2026): the live QA build returned the
         * generic dev 404 "Did you forget to add the page to the router?"
         * for /admin/lifecycle (sidebar uses /admin/lifecycle-policies) and
         * /admin/chapters (phantom URL never registered). This block:
         *
         *   1. Adds an explicit alias for /admin/lifecycle → the canonical
         *      /admin/lifecycle-policies URL so bookmarked / pasted links
         *      from older admin docs keep working.
         *   2. Adds an /admin/* catch-all rendering the polished
         *      AdminNotFound component (admin-branded card with a link
         *      back to the dashboard) for any unregistered admin path.
         *      This sits BEFORE the global NotFoundOrLogin catch-all so
         *      admin visitors see the admin-aware 404 instead of the dev
         *      placeholder. */}
        <Route path="/admin/lifecycle">
          {() => <Redirect to="/admin/lifecycle-policies" />}
        </Route>
        {/* v23.5 C-003 — admin Collective pages */}
        <Route path="/admin/collective/applications">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCollectiveApplications /></RequireAuth>}
        </Route>
        <Route path="/admin/collective/members">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCollectiveMembers /></RequireAuth>}
        </Route>
        <Route path="/admin/collective/settings">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCollectiveSettings /></RequireAuth>}
        </Route>
        <Route path="/admin/collective/waitlist">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminCollectiveWaitlist /></RequireAuth>}
        </Route>
        <Route path="/admin/:rest*">
          {() => (
            <RequireAuth role="admin" redirectTo="/admin/login">
              <AdminNotFound />
            </RequireAuth>
          )}
        </Route>

        {/* ===== COLLECTIVE ROUTES — RequireAuth ===== */}
        <Route path="/collective/dashboard">
          {() => <RequireAuth><CollectiveShell><CollectiveDashboard /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/dealroom/:companyId">
          {(p) => <RequireAuth><CollectiveShell><CollectiveDealRoomDetail /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/dealroom">
          {() => <RequireAuth><CollectiveShell><CollectiveDealRoom /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/members">
          {() => <RequireAuth><CollectiveShell><CollectiveMembers /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/companies/:id">
          {(p) => <RequireAuth><CollectiveShell><CollectiveCompanyDetail /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/companies">
          {() => <RequireAuth><CollectiveShell><CollectiveCompanies /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/soft-circles">
          {() => <RequireAuth><CollectiveShell><CollectiveSoftCircles /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/dsc/pipeline">
          {() => <RequireAuth><CollectiveShell><CollectiveDscPipeline /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/dsc/scores">
          {() => <RequireAuth><CollectiveShell><CollectiveDscScores /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/dsc/prep">
          {() => <RequireAuth><CollectiveShell><CollectiveTransactionPrep /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/membership">
          {/* v25.22 NC-4 fix — swap to the live MembershipPage so the
              checkout flow is actually reachable. The read-only summary is
              now at /collective/membership-summary. */}
          {() => <RequireAuth><CollectiveShell><MembershipPage /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/membership-summary">
          {() => <RequireAuth><CollectiveShell><CollectiveMembership /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/activity">
          {() => <RequireAuth><CollectiveShell><CollectiveActivity /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/settings">
          {() => <RequireAuth><CollectiveShell><CollectiveSettings /></CollectiveShell></RequireAuth>}
        </Route>

        {/* ===== v25.42 (Bucket B) — new Collective routes R1–R6, R8 ===== */}
        <Route path="/collective/connections">
          {() => <RequireAuth><CollectiveShell><CollectiveConnections /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/recaps">
          {() => <RequireAuth><CollectiveShell><CollectiveRecaps /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/screening-recaps">
          {() => <RequireAuth><CollectiveShell><CollectiveScreeningRecaps /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/chapters">
          {() => <RequireAuth><CollectiveShell><CollectiveChapters /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/portal/requests">
          {() => <RequireAuth><CollectiveShell><CollectiveMyRequests /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/profile/:userId">
          {() => <RequireAuth><CollectiveShell><CollectivePublicProfile /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partners">
          {() => <RequireAuth><CollectiveShell><CollectivePartnersDirectory /></CollectiveShell></RequireAuth>}
        </Route>

        {/* v19 Phase A — Events Calendar (month view) + Leaderboard.
         * Both pages are hidden client-side when COLLECTIVE_ENABLED is off
         * (the components return null on the feature-flag check). */}
        <Route path="/collective/calendar">
          {() => <RequireAuth><CollectiveShell><EventsCalendarPage /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/leaderboard">
          {() => <RequireAuth><CollectiveShell><LeaderboardPage /></CollectiveShell></RequireAuth>}
        </Route>
        {/* v25.12 NC2 — screening events list + detail. */}
        <Route path="/collective/screening-events/:id">
          {() => <RequireAuth><CollectiveShell><ScreeningEventsPage /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/screening-events">
          {() => <RequireAuth><CollectiveShell><ScreeningEventsPage /></CollectiveShell></RequireAuth>}
        </Route>
        {/* v25.12 NC2 — Expert Q&A list page. */}
        <Route path="/collective/ask-expert">
          {() => <RequireAuth><CollectiveShell><AskExpertPage /></CollectiveShell></RequireAuth>}
        </Route>
        {/* v25.12 NC2 — Expert Q&A detail page. */}
        <Route path="/collective/questions/:id">
          {() => <RequireAuth><CollectiveShell><QuestionDetailPage /></CollectiveShell></RequireAuth>}
        </Route>
        {/* v25.12 NC3 — announcement detail. We render the events calendar
         * page anchored to the announcement (the calendar shell already
         * surfaces announcement context); a dedicated detail page can be
         * added in v26 if richer detail rendering is required. */}
        <Route path="/collective/announcements/:id">
          {() => <RequireAuth><CollectiveShell><EventsCalendarPage /></CollectiveShell></RequireAuth>}
        </Route>

        {/* Patch v6 — Partner workspace routes live inside the CollectiveShell
         * at /collective/partner/*. Server API stays at /api/partner/me/*;
         * requirePartnerAuth resolves partnerId from the session. */}
        <Route path="/collective/partner/dashboard">
          {() => <RequireAuth><CollectiveShell><PartnerDashboard /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/clients/:id">
          {() => <RequireAuth><CollectiveShell><PartnerClientDetail /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/clients">
          {() => <RequireAuth><CollectiveShell><PartnerClients /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/pipeline">
          {() => <RequireAuth><CollectiveShell><PartnerPipeline /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/team">
          {() => <RequireAuth><CollectiveShell><PartnerTeam /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/notes">
          {() => <RequireAuth><CollectiveShell><PartnerNotes /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/tasks">
          {() => <RequireAuth><CollectiveShell><PartnerTasks /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/files">
          {() => <RequireAuth><CollectiveShell><PartnerFiles /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/settings">
          {() => <RequireAuth><CollectiveShell><PartnerSettings /></CollectiveShell></RequireAuth>}
        </Route>
        {/* v25.32 A3 — consortium partner billing (commission ledger; not subscription) */}
        <Route path="/collective/partner/billing">
          {() => <RequireAuth><CollectiveShell><PartnerBilling /></CollectiveShell></RequireAuth>}
        </Route>
        {/* v25.33 Consortium Partner Payment Model — partner self-service pages. */}
        <Route path="/collective/partner/subscribe">
          {() => <RequireAuth><CollectiveShell><PartnerSubscribe /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/agreement">
          {() => <RequireAuth><CollectiveShell><PartnerAgreementSign /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/tax-form">
          {() => <RequireAuth><CollectiveShell><PartnerTaxForm /></CollectiveShell></RequireAuth>}
        </Route>
        {/* CP Phase B — Partner onboarding checklist */}
        <Route path="/collective/partner/onboarding">
          {() => <RequireAuth><CollectiveShell><PartnerOnboardingChecklistPage /></CollectiveShell></RequireAuth>}
        </Route>
        {/* CP Phase B — Per-user privacy / GDPR controls */}
        <Route path="/settings/privacy">
          {() => <RequireAuth><PrivacyPage /></RequireAuth>}
        </Route>
        <Route path="/collective/partner/spvs/:id">
          {() => <RequireAuth><CollectiveShell><PartnerSpvDetail /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/spvs">
          {() => <RequireAuth><CollectiveShell><PartnerSpvs /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/funds/:id">
          {() => <RequireAuth><CollectiveShell><PartnerFundDetail /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/partner/funds">
          {() => <RequireAuth><CollectiveShell><PartnerFunds /></CollectiveShell></RequireAuth>}
        </Route>

        {/* Wave B FIX 8 (I-BUG-006, I-BUG-007) — explicit redirects for legacy/
            unguarded paths that previously fell through to <NotFound> while
            rendering inside <AppShell>. The shell-leak was a P0 trust issue
            for anonymous visitors hitting copy-pasted internal URLs. These
            routes redirect: unauthenticated → /auth/login (with returnTo),
            authenticated → their portal default. */}
        <Route path="/dashboard" component={LegacyDashboardRedirect} />
        <Route path="/cap-table" component={LegacyDashboardRedirect} />
        <Route path="/rounds" component={LegacyDashboardRedirect} />
        {/* v25.43 F13 — /company-profile now renders the founder Company page so
            the first-time create-company onboarding step (?onboarding=1) lands
            on a real create-company surface instead of the legacy dashboard
            redirect. Company.tsx reads ?onboarding=1 and, after a successful
            create, forwards to /founder/subscribe. */}
        <Route path="/company-profile">
          {() => <RequireAuth><FounderCompany /></RequireAuth>}
        </Route>
        <Route path="/invite/:token" component={LegacyInviteRedirect} />

        {/* Wave B FIX 3 (F-BUG-004) — explicit /onboarding handler is the
            public Landing component (registered above), so no change here.
            The legacy /#/onboarding now resolves via the Landing route at
            line ~249. */}

        <Route component={NotFoundOrLogin} />
      </Switch>
    </ErrorBoundary>
  );

  return bare ? routes : <AppShell>{routes}</AppShell>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RoleProvider>
          <TooltipProvider>
            <Toaster />
            {/* v23.4.3: BrowserRouter (History API) — no hook= prop means wouter
                uses window.history (pushState). Ozan architectural decision #1. */}
            <Router>
              <AppRouter />
            </Router>
          </TooltipProvider>
        </RoleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
