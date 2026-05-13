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

// Bootstrap demo telemetry once at app load
seedSprint3Telemetry();

/* ---------- Sprint 28 Billing — Subscription gate HOC ----------
 * Wraps any founder route that requires an active subscription.
 * Reads subscription from /api/founder/subscription on every mount.
 * Non-active statuses (pending_payment, past_due, canceled, paused)
 * redirect to /founder/subscribe.
 * Does NOT gate: /founder/subscribe, /founder/company, /founder/settings, /founder/billing.
 * ---------------------------------------------------------------- */
const INACTIVE_STATUSES = new Set(["pending_payment", "past_due", "canceled", "cancelled", "paused", "unpaid"]);

function RequireActiveSubscription({ children }: { children: ReactNode }) {
  const { data: entCtx } = useEntitlement();
  const companyId = entCtx?.founder?.activeCompanyId ?? "co_novapay";

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
    staleTime: 0,
    retry: false,
  });

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
  // Bare-shell routes: landing, login/signup screens, AND the token-gated
  // investor signup (which needs to render its own layout, including the
  // 404 path when there is no valid token).
  return (
    path === "/" ||
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path === "/investor/login" ||
    path === "/admin/login" ||
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
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={Forgot} />

      {/* Sprint 15 — new auth shell */}
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/signup" component={Signup} />
      <Route path="/auth/forgot" component={Forgot} />
      <Route path="/auth/redeem" component={Redeem} />
      {/* Sprint 27 — dedicated admin login on its own page. */}
      <Route path="/admin/login" component={AdminLogin} />
      <Route path="/select-company" component={SelectCompany} />

      {/* Sprint 28 Billing — Subscribe (NOT gated) + Billing (NOT gated) */}
      <Route path="/founder/subscribe" component={FounderSubscribe} />
      <Route path="/founder/billing" component={FounderBilling} />

      {/* Gated founder routes — redirect to /founder/subscribe if subscription not active */}
      <Route path="/founder/dashboard">{() => <RequireActiveSubscription><FounderDashboard /></RequireActiveSubscription>}</Route>
      <Route path="/founder/captable">{() => <RequireActiveSubscription><FounderCapTable /></RequireActiveSubscription>}</Route>
      <Route path="/founder/rounds/new">{() => <RequireActiveSubscription><FounderRoundNew /></RequireActiveSubscription>}</Route>
      <Route path="/founder/rounds/:id/termsheet">{(p) => <RequireActiveSubscription><FounderTermSheet /></RequireActiveSubscription>}</Route>
      <Route path="/founder/rounds/:id">{(p) => <RequireActiveSubscription><FounderRoundDetail /></RequireActiveSubscription>}</Route>
      <Route path="/founder/rounds">{() => <RequireActiveSubscription><FounderRounds /></RequireActiveSubscription>}</Route>
      <Route path="/founder/crm/new">{() => <RequireActiveSubscription><FounderCRMNew /></RequireActiveSubscription>}</Route>
      <Route path="/founder/crm">{() => <RequireActiveSubscription><FounderCRM /></RequireActiveSubscription>}</Route>
      <Route path="/founder/dataroom">{() => <RequireActiveSubscription><FounderDataroom /></RequireActiveSubscription>}</Route>
      <Route path="/founder/reports/new">{() => <RequireActiveSubscription><FounderReportNew /></RequireActiveSubscription>}</Route>
      <Route path="/founder/reports">{() => <RequireActiveSubscription><FounderReports /></RequireActiveSubscription>}</Route>
      <Route path="/founder/messages">{() => <RequireActiveSubscription><FounderMessages /></RequireActiveSubscription>}</Route>
      <Route path="/founder/network-posts">{() => <RequireActiveSubscription><FounderNetworkPosts /></RequireActiveSubscription>}</Route>
      {/* Sprint 18 Phase 3 E4 — Post Detail */}
      <Route path="/founder/posts/:id">{() => <RequireActiveSubscription><PostDetail role="founder" /></RequireActiveSubscription>}</Route>

      {/* NOT gated: company, settings, collective, welcome, glossary, billing, company detail */}
      <Route path="/founder/company" component={FounderCompany} />
      <Route path="/founder/profile/wizard" component={FounderProfileWizard} />
      <Route path="/financials-fill/:token" component={FinancialsFill} />
      <Route path="/founder/activity" component={FounderActivity} />
      <Route path="/founder/settings" component={FounderSettings} />
      <Route path="/founder/collective" component={FounderCollective} />
      <Route path="/founder/apply-to-collective" component={FounderApplyToCollective} />
      <Route path="/founder/welcome" component={FounderWelcome} />
      <Route path="/founder/glossary" component={FounderGlossary} />
      <Route path="/founder/companies/:id" component={FounderCompanyDetail} />

      <Route path="/investor/login" component={InvestorLogin} />
      <Route path="/investor/signup" component={InvestorSignup} />
      <Route path="/investor/dashboard" component={InvestorDashboard} />
      <Route path="/investor/companies/:id" component={InvestorCompanyDetail} />
      <Route path="/investor/invitations" component={InvestorInvitations} />
      <Route path="/investor/invitations/:id" component={InvestorInvitationDetail} />
      <Route path="/investor/portfolio" component={InvestorPortfolio} />
      <Route path="/investor/crm/new" component={InvestorCRMNew} />
      <Route path="/investor/crm" component={InvestorCRM} />
      <Route path="/investor/apply-to-collective" component={InvestorApplyToCollective} />
      <Route path="/investor/profile" component={InvestorProfile} />
      <Route path="/investor/messages" component={InvestorMessages} />
      <Route path="/investor/collective" component={InvestorCollective} />
      <Route path="/investor/network-posts" component={InvestorNetworkPosts} />
      <Route path="/investor/posts/:id">{() => <PostDetail role="investor" />}</Route>
      {/* Sprint 20 Wave 2 — new investor pages */}
      <Route path="/investor/settings" component={InvestorSettings} />
      <Route path="/investor/glossary" component={InvestorGlossary} />
      <Route path="/investor/notifications" component={InvestorNotifications} />

      <Route path="/notifications" component={NotificationCenter} />

      <Route path="/admin/dashboard" component={AdminDashboard} />
      <Route path="/admin/companies" component={AdminCompanies} />
      <Route path="/admin/companies/:id" component={AdminCompanyDetail} />
      <Route path="/admin/investors/import" component={AdminInvestorImport} />
      <Route path="/admin/investors/:id" component={AdminInvestorDetail} />
      <Route path="/admin/investors" component={AdminInvestors} />
      <Route path="/admin/users" component={AdminUsers} />
      <Route path="/admin/bridge" component={AdminBridge} />
      <Route path="/admin/sync" component={AdminSync} />
      <Route path="/admin/migration" component={AdminMigration} />
      <Route path="/collective/preview" component={CollectivePreview} />

      {/* Wave C-3 + C-4 — Collective Shell routes (CollectiveShell is their own layout) */}
      <Route path="/collective/dashboard">{() => <CollectiveShell><CollectiveDashboard /></CollectiveShell>}</Route>
      <Route path="/collective/dealroom/:companyId">{(p) => <CollectiveShell><CollectiveDealRoomDetail /></CollectiveShell>}</Route>
      <Route path="/collective/dealroom">{() => <CollectiveShell><CollectiveDealRoom /></CollectiveShell>}</Route>
      <Route path="/collective/members">{() => <CollectiveShell><CollectiveMembers /></CollectiveShell>}</Route>
      <Route path="/collective/companies/:id">{(p) => <CollectiveShell><CollectiveCompanyDetail /></CollectiveShell>}</Route>
      <Route path="/collective/companies">{() => <CollectiveShell><CollectiveCompanies /></CollectiveShell>}</Route>
      <Route path="/collective/soft-circles">{() => <CollectiveShell><CollectiveSoftCircles /></CollectiveShell>}</Route>
      <Route path="/collective/dsc/pipeline">{() => <CollectiveShell><CollectiveDscPipeline /></CollectiveShell>}</Route>
      <Route path="/collective/dsc/scores">{() => <CollectiveShell><CollectiveDscScores /></CollectiveShell>}</Route>
      <Route path="/collective/dsc/prep">{() => <CollectiveShell><CollectiveTransactionPrep /></CollectiveShell>}</Route>
      <Route path="/collective/membership">{() => <CollectiveShell><CollectiveMembership /></CollectiveShell>}</Route>
      <Route path="/collective/activity">{() => <CollectiveShell><CollectiveActivity /></CollectiveShell>}</Route>
      <Route path="/collective/settings">{() => <CollectiveShell><CollectiveSettings /></CollectiveShell>}</Route>
      <Route path="/admin/email" component={AdminEmail} />
      <Route path="/admin/email/new" component={AdminEmailComposer} />
      <Route path="/admin/email/:id" component={AdminEmailComposer} />
      <Route path="/admin/notifications/new" component={AdminNotificationComposer} />
      <Route path="/admin/notifications/:id" component={AdminNotificationComposer} />
      <Route path="/admin/notifications" component={AdminNotifications} />
      <Route path="/admin/pricing" component={AdminPricing} />
      <Route path="/admin/pricing-models">{() => <Redirect to="/admin/pricing" />}</Route>
      <Route path="/admin/pricing-models/:id" component={AdminPricingModelDetail} />
      <Route path="/admin/formulas" component={AdminFormulas} />
      <Route path="/admin/formulas/new" component={AdminFormulaNew} />
      <Route path="/admin/formulas/:id" component={AdminFormulaDetail} />
      <Route path="/admin/regions" component={AdminRegionsExtensions} />
      <Route path="/admin/regions/:id" component={AdminRegionExtensionDetail} />
      <Route path="/admin/lifecycle-policies" component={AdminLifecyclePolicies} />
      <Route path="/admin/audit-log" component={AdminAuditLog} />
      <Route path="/admin/reconciliation" component={AdminReconciliation} />
      <Route path="/admin/telemetry" component={AdminTelemetry} />

      <Route component={NotFound} />
    </Switch>
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
