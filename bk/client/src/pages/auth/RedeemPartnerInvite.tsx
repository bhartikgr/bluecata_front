/**
 * Foundation Build — Partner magic-link invite redemption page.
 * Token is hashed at rest server-side; this page POSTs the raw token from the
 * URL once. After success, redirects to /collective/partner/dashboard.
 */
import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";

export default function RedeemPartnerInvite() {
  const [, params] = useRoute<{ token: string }>("/auth/redeem-partner-invite/:token");
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"redeeming" | "success" | "error">("redeeming");
  const [error, setError] = useState<string>("");

  /* v25.23 NM-3 — guard the single-use redeem REQUEST (not just setState) so it
     fires exactly once even when React 18 StrictMode double-invokes the effect
     in dev. The single-use token must never be POSTed twice. */
  const firedRef = useRef(false);

  useEffect(() => {
    if (!params?.token) return;
    if (firedRef.current) return;
    firedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("POST", `/api/auth/redeem-partner-invite/${params.token}`, {});
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "redeem_failed" }));
          setError(body.error || "redeem_failed");
          setStatus("error");
          return;
        }
        setStatus("success");
        setTimeout(() => setLocation("/collective/partner/dashboard"), 1200);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || "network_error");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [params?.token, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="p-8 max-w-md w-full" data-testid="partner-redeem-card">
        {status === "redeeming" && (
          <div data-testid="partner-redeem-redeeming">
            <h1 className="text-xl font-semibold mb-2">Redeeming invite…</h1>
            <p className="text-sm text-slate-500">Verifying your magic link.</p>
          </div>
        )}
        {status === "success" && (
          <div data-testid="partner-redeem-success">
            <h1 className="text-xl font-semibold text-emerald-700 mb-2">Welcome!</h1>
            <p className="text-sm text-slate-600">Redirecting to your workspace…</p>
          </div>
        )}
        {status === "error" && (
          <div data-testid="partner-redeem-error">
            <h1 className="text-xl font-semibold text-red-700 mb-2">Could not redeem invite</h1>
            <p className="text-sm text-slate-600 mb-2">{error}</p>
            <p className="text-xs text-slate-500">
              Magic links expire after 7 days and can only be used once. Ask your managing partner to send a new invite.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
