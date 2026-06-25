/**
 * Wave C-3 — Collective Membership
 * Current user's Collective membership view.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCircle, Calendar, TrendingUp } from "lucide-react";

interface Subscription {
  companyId: string;
  status: string;
  plan: string;
  annualAmountMinor: number;
  currency: string;
  renewsOn: string;
  cardLast4: string | null;
  invoicesCount: number;
  version: number;
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  trialing: "bg-blue-100 text-blue-700",
  past_due: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
  pending_payment: "bg-amber-100 text-amber-700",
};

export default function CollectiveMembership() {
  const { data: subscription, isLoading, error } = useQuery<Subscription | null>({
    queryKey: ["/api/subscriptions/mine"],
    queryFn: () => apiRequest("GET", "/api/subscriptions/mine").then((r) => r.json()),
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1
          className="text-xl font-semibold flex items-center gap-2"
          style={{ color: "#1A1A2E" }}
          data-testid="heading-membership"
        >
          <UserCircle className="h-5 w-5 text-[#cc0001]" />
          My Membership
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Your Collective membership status and billing details.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-membership">
          Failed to load membership data. Please refresh.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !subscription ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500" data-testid="empty-membership">
            <UserCircle className="h-10 w-10 mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-medium">No membership found</p>
            <p className="text-xs mt-1">
              Contact your Collective administrator to set up your membership.
            </p>
            {/* v25.12 NM1 — wire "Contact Admin" to a mailto link so the button is no longer dead. */}
            <Button
              variant="outline"
              className="mt-4 text-sm border-[#cc0001]/30 text-[#cc0001] hover:bg-[#cc0001]/05"
              data-testid="button-contact-admin"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.href = "mailto:ops@capavate.com?subject=Collective%20Membership%20Help";
                }
              }}
            >
              Contact Admin
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card data-testid="card-membership-status">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold" style={{ color: "#1A1A2E" }}>
                Membership Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Status</span>
                <Badge
                  className={`capitalize ${STATUS_COLORS[subscription.status] ?? "bg-slate-100 text-slate-500"}`}
                  data-testid="badge-membership-status"
                >
                  {subscription.status.replace(/_/g, " ")}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Plan</span>
                <span className="text-sm font-medium text-slate-800" data-testid="text-plan">
                  {subscription.plan.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  Renewal date
                </span>
                <span className="text-sm text-slate-800" data-testid="text-renewal-date">
                  {new Date(subscription.renewsOn).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600 flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Annual amount
                </span>
                <span className="text-sm text-slate-800" data-testid="text-annual-amount">
                  {subscription.currency} {(subscription.annualAmountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              {subscription.cardLast4 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Payment method</span>
                  <span className="text-sm text-slate-800" data-testid="text-card">
                    •••• {subscription.cardLast4}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Invoices</span>
                <span className="text-sm text-slate-800" data-testid="text-invoices">
                  {subscription.invoicesCount}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* v25.12 NM2 — wire "Upgrade Membership" to the membership page so the CTA is no longer dead. */}
          <Button
            variant="outline"
            className="w-full border-[#cc0001]/30 text-[#cc0001] hover:bg-[#cc0001]/05"
            data-testid="button-upgrade"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.href = "/collective/membership";
              }
            }}
          >
            Upgrade Membership
          </Button>
        </div>
      )}
    </div>
  );
}
