/**
 * Sprint 24 — Legacy investor login retired.
 *
 * The original /investor/login (Sprint 7) duplicated /auth/login and disagreed
 * with it (no portal awareness, no admin path, no mixed-role detection,
 * stale entitlement context). Sprint 24 collapses both into the unified
 * /auth/login surface.
 *
 * This component is now a thin redirect to /auth/login?portal=investor.
 * Kept as a route stub so any outstanding email links / bookmarks resolve.
 *
 * SANDBOX-SAFE: no Web Storage APIs.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function InvestorLogin() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/auth/login?portal=investor");
  }, [navigate]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-sm text-muted-foreground" data-testid="text-investor-login-redirect">
        Redirecting to investor sign-in…
      </div>
    </div>
  );
}
