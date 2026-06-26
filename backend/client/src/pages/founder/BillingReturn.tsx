/**
 * v24.2 Airwallex wiring — hosted-checkout return landing page.
 *
 * The Airwallex hosted payment page redirects the founder back here after they
 * complete (or abandon) payment, with the PaymentIntent id in the query string
 * (?paymentIntentId=int_...). Activation happens server-side via the Airwallex
 * `payment_intent.succeeded` webhook, which flips the pending capavate
 * subscription to `active`. That webhook can land slightly before OR after the
 * browser redirect — and in production it can LAG or FAIL entirely (signature
 * mismatch, endpoint unreachable, transient network). Relying on it alone is
 * exactly what caused the v25.45 "card charged but platform not unlocked" bug.
 *
 * v25.45 Bug A — this page now also RECONCILES server-side on each poll:
 * POST /api/founder/subscription/reconcile verifies the authoritative Airwallex
 * intent status (retrievePaymentIntent) and, if SUCCEEDED, finalizes the
 * subscription via the SAME atomic path the webhook uses. So the platform
 * unlocks immediately on return even if the webhook never arrives. We then
 * POLL GET /api/founder/subscription/status for up to ~10s:
 *
 *   - status === "active"  → redirect to /founder/dashboard
 *   - status === "failed"  → show a clear failure message + retry link
 *   - still "pending" after the polling window → show a "still processing"
 *     message (the webhook may simply be delayed) with a manual refresh.
 *
 * This page is intentionally NOT wrapped in RequireActiveSubscription (the
 * subscription may not be active yet) — only RequireAuth, like /founder/billing.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Sparkles } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Phase = "polling" | "active" | "failed" | "timeout" | "missing";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 10_000;

function getPaymentIntentId(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  // Airwallex hosted page may echo the id under a few different keys depending
  // on the return-url template; accept the common ones.
  return (
    params.get("paymentIntentId") ??
    params.get("payment_intent_id") ??
    params.get("intent_id") ??
    ""
  );
}

export default function BillingReturn() {
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<Phase>("polling");
  const startedAtRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const paymentIntentId = getPaymentIntentId();

  useEffect(() => {
    if (!paymentIntentId) {
      setPhase("missing");
      return;
    }

    cancelledRef.current = false;
    startedAtRef.current = Date.now();

    const poll = async () => {
      if (cancelledRef.current) return;
      try {
        /* v25.45 Bug A — webhook-independent activation. Ask the server to
         * reconcile against the authoritative Airwallex status BEFORE reading
         * the local status. This activates the subscription on the client
         * return path even when the webhook lags or never lands. It is
         * idempotent (safe if the webhook already activated the row). */
        try {
          await apiRequest("POST", "/api/founder/subscription/reconcile", {
            paymentIntentId,
          });
        } catch {
          // Reconcile is best-effort (e.g. gateway briefly unreachable); the
          // status read below still drives the UI and we keep polling.
        }

        const res = await apiRequest(
          "GET",
          `/api/founder/subscription/status?paymentIntentId=${encodeURIComponent(paymentIntentId)}`,
        );
        const data = await res.json();
        const status = data?.status as string | undefined;

        if (status === "active") {
          // Refresh every surface that reads the plan/entitlement so the
          // dashboard renders the active plan immediately on arrival.
          queryClient.invalidateQueries({ queryKey: ["/api/founder/subscription"] });
          queryClient.invalidateQueries({ queryKey: ["/api/founder/active-company"] });
          queryClient.invalidateQueries({ queryKey: ["/api/founder/companies"] });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          setPhase("active");
          // Brief pause so the founder sees the success state before redirect.
          timerRef.current = setTimeout(() => {
            if (!cancelledRef.current) navigate("/founder/dashboard");
          }, 1200);
          return;
        }

        if (status === "failed") {
          setPhase("failed");
          return;
        }
      } catch {
        // 404 (webhook hasn't created/looked-up the row yet) or transient error
        // — keep polling until the timeout window elapses.
      }

      if (Date.now() - startedAtRef.current >= POLL_TIMEOUT_MS) {
        setPhase("timeout");
        return;
      }
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // paymentIntentId is derived from the URL once on mount; intentionally a
    // single-run effect keyed on it.
  }, [paymentIntentId, navigate]);

  return (
    <div className="min-h-screen bg-[hsl(210_20%_98%)] flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="py-10 px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Sparkles className="h-5 w-5 text-[hsl(0_100%_40%)]" />
            <span className="text-base font-semibold text-[hsl(0_100%_40%)]">Capavate</span>
          </div>

          {phase === "polling" && (
            <div data-testid="billing-return-polling">
              <Loader2 className="h-10 w-10 mx-auto mb-4 animate-spin text-[hsl(0_100%_40%)]" />
              <h1 className="text-lg font-semibold mb-1">Activating your plan…</h1>
              <p className="text-sm text-muted-foreground">
                We’re confirming your payment with Airwallex. This usually takes a
                few seconds — please don’t close this window.
              </p>
            </div>
          )}

          {phase === "active" && (
            <div data-testid="billing-return-active">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-4 text-emerald-600" />
              <h1 className="text-lg font-semibold mb-1">You’re all set!</h1>
              <p className="text-sm text-muted-foreground">
                Your subscription is active. Taking you to your dashboard…
              </p>
            </div>
          )}

          {phase === "failed" && (
            <div data-testid="billing-return-failed">
              <XCircle className="h-10 w-10 mx-auto mb-4 text-red-600" />
              <h1 className="text-lg font-semibold mb-1">Payment didn’t go through</h1>
              <p className="text-sm text-muted-foreground mb-5">
                Your payment was not completed, so no plan was activated and you
                were not charged. You can try again at any time.
              </p>
              <Button
                className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
                data-testid="button-billing-return-retry"
                onClick={() => navigate("/founder/subscribe")}
              >
                Try again
              </Button>
            </div>
          )}

          {phase === "timeout" && (
            <div data-testid="billing-return-timeout">
              <Loader2 className="h-10 w-10 mx-auto mb-4 text-amber-500" />
              <h1 className="text-lg font-semibold mb-1">Still processing…</h1>
              <p className="text-sm text-muted-foreground mb-5">
                Your payment is taking a little longer than usual to confirm. It
                will activate automatically once Airwallex finishes processing —
                you can check again in a moment or head to billing.
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  data-testid="button-billing-return-recheck"
                  onClick={() => window.location.reload()}
                >
                  Check again
                </Button>
                <Button
                  className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
                  data-testid="button-billing-return-billing"
                  onClick={() => navigate("/founder/billing")}
                >
                  Go to billing
                </Button>
              </div>
            </div>
          )}

          {phase === "missing" && (
            <div data-testid="billing-return-missing">
              <XCircle className="h-10 w-10 mx-auto mb-4 text-amber-500" />
              <h1 className="text-lg font-semibold mb-1">Nothing to confirm</h1>
              <p className="text-sm text-muted-foreground mb-5">
                We couldn’t find a payment to confirm on this page. If you just
                paid, head to billing to check your plan status.
              </p>
              <Button
                className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
                data-testid="button-billing-return-billing-missing"
                onClick={() => navigate("/founder/billing")}
              >
                Go to billing
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
