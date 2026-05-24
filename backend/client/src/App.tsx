import { Switch, Route, Router, useLocation, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useCallback, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEntitlement } from "@/lib/entitlement";

/**
 * Hash-router hook that strips ?query so Wouter's Route matchers see the
 * pathname only. Sprint 7's /investor/signup uses ?token=..., which would
 * otherwise drop into the NotFound catch-all.
 */
function useHashLocationWithoutQuery(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const [loc, nav] = useHashLocation();
  const path = loc.split("?")[0] || "/";
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => nav(to, opts), [nav]);
  return [path, navigate];
}
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { RoleProvider } from "@/lib/role";
import NotFound from "@/pages/not-found";
import FinancialsFill from "@/pages/FinancialsFill";
import { AppShell } from "@/components/AppShell";

import Home from "@/pages/home/Home";
// Sprint-fix May 14 2026 — import the new guard + boundary components
import { RequireAuth } from "@/components/RequireAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import Landing from "@/pages/Landing";
import Login from "@/pages/auth/Login";
import Signup from "@/pages/auth/Signup";
import Forgot from "@/pages/auth/Forgot";
import Redeem from "@/pages/auth/Redeem";
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
import AdminTelemetry from "@/pages/admin/Telemetry";
// Sprint 12 — new admin + cross-role pages
import NotificationCenter from "@/pages/NotificationCenter";
import AdminBridge from "@/pages/admin/Bridge";
import AdminEmail from "@/pages/admin/Email";
import AdminEmailComposer from "@/pages/admin/EmailComposer";
import AdminNotifications from "@/pages/admin/Notifications";
import AdminNotificationComposer from "@/pages/admin/NotificationComposer";
import AdminPricing from "@/pages/admin/Pricing";
import AdminPricingModelDetail from "@/pages/admin/PricingModelDetail";
// Sprint 28 Billing — founder subscription + billing pages
import FounderSubscribe from "@/pages/founder/Subscribe";
import FounderBilling from "@/pages/founder/Billing";
import AdminInvestorDetail from "@/pages/admin/InvestorDetail";
import AdminSync from "@/pages/admin/Sync";
import AdminMigration from "@/pages/admin/Migration";
// CP Phase B — Apply flow + Admin queue + Onboarding + Privacy
import ConsortiumApplyPage from "@/pages/public/ConsortiumApplyPage";
import AdminConsortiumApplicationsPage from "@/pages/admin/ConsortiumApplicationsPage";
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
import CollectiveActivity from "@/pages/collective/CollectiveActivity";
import CollectiveSettings from "@/pages/collective/CollectiveSettings";
import EventsCalendarPage from "@/pages/collective/EventsCalendarPage";
import LeaderboardPage from "@/pages/collective/LeaderboardPage";

// Bootstrap demo telemetry once at app load
seedSprint3Telemetry();

/* ---------- Sprint 28 Billing — Subscription gate HOC ----------
 * Wraps any founder route that requires an active subscription.
 * Reads subscription from /api/founder/subscription on every mount.
 * Non-active statuses redirect to /founder/subscribe.
 * Does NOT gate: /founder/subscribe, /founder/company, /founder/settings, /founder/billing.
 * ---------------------------------------------------------------- */
const INACTIVE_STATUSES = new Set(["pending_payment", "past_due", "canceled", "cancelled", "paused", "unpaid"]);

function RequireActiveSubscription({ children }: { children: ReactNode }) {
  const { data: entCtx } = useEntitlement();
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

  // No active company yet (fresh user) — route to subscribe/onboarding
  if (!companyId) {
    return <Redirect to="/founder/subscribe" />;
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
    path === "/select-company"
  );
}

function AppRouter() {
  const [location] = useLocation();
  const bare = isAuthRoute(location);
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

        {/* Sprint 27 — dedicated admin login (public) */}
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
        <Route path="/admin/reconciliation">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminReconciliation /></RequireAuth>}
        </Route>
        <Route path="/admin/telemetry">
          {() => <RequireAuth role="admin" redirectTo="/admin/login"><AdminTelemetry /></RequireAuth>}
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
          {() => <RequireAuth><CollectiveShell><CollectiveMembership /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/activity">
          {() => <RequireAuth><CollectiveShell><CollectiveActivity /></CollectiveShell></RequireAuth>}
        </Route>
        <Route path="/collective/settings">
          {() => <RequireAuth><CollectiveShell><CollectiveSettings /></CollectiveShell></RequireAuth>}
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

        <Route component={NotFound} />
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
            <Router hook={useHashLocationWithoutQuery}>
              <AppRouter />
            </Router>
          </TooltipProvider>
        </RoleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
