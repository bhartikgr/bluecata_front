/**
 * Foundation Build — Partner magic-link invite redemption page.
 * Token is hashed at rest server-side; this page POSTs the raw token from the
 * URL once. After success, redirects to /collective/partner/dashboard.
 *
 * v25.30 — Email-mismatch recovery.
 *   When the server returns PARTNER_INVITATION_EMAIL_MISMATCH (v25.23 NC-B
 *   security gate), the original UX stranded the user with no logout button.
 *   This page now renders a "Log out and continue" action that calls
 *   /api/auth/logout and then re-fires the redeem in the same flow, which
 *   resolves the gate cleanly.
 *
 * v25.32 P0 — RECOVERY UI WAS DEAD CODE.
 *   v25.30 added the recovery UI, but apiRequest THROWS on non-2xx (see
 *   queryClient.ts:154 throwIfResNotOk) — control never reached the
 *   `if (!res.ok)` block, so the `error` state held the friendly message
 *   string instead of the error code, and `isEmailMismatch` was always
 *   false. Ozan was stuck on the "Could not redeem invite" screen with no
 *   button for three waves. This rewrite catches ApiError, reads
 *   `.code` for the conditional, `.payload.message` for display text, and
 *   `.payload.invitedEmail` for the address. The server now includes
 *   `invitedEmail` in the 403 (see server/partnerRoutes.ts v25.32 P0).
 */
import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { useRole } from "@/lib/role";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Status = "redeeming" | "success" | "error";

export default function RedeemPartnerInvite() {
  const [, params] = useRoute<{ token: string }>("/auth/redeem-partner-invite/:token");
  const [, setLocation] = useLocation();
  // v25.32 P0'''' — set the role context to "partner" BEFORE navigating so the
  // new /collective/partner/dashboard route mounts with the correct role and
  // does NOT bounce the user back to the Collective member view (the
  // wrong-landing bug). Pairs with the useRequirePartnerRole dead-code fix.
  const { setRole } = useRole();
  const [status, setStatus] = useState<Status>("redeeming");
  const [errorCode, setErrorCode] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [invitedEmail, setInvitedEmail] = useState<string>("");
  // v25.32 Item 64 — surface the CURRENTLY logged-in email alongside the
  // invited email so the mismatch copy tells the user exactly which account is
  // active and which address the invite requires. Read DB-direct from
  // GET /api/auth/me (identity.email) only when a mismatch is detected.
  const [loggedInEmail, setLoggedInEmail] = useState<string>("");
  const [recovering, setRecovering] = useState<boolean>(false);

  /* v25.23 NM-3 — guard the single-use redeem REQUEST (not just setState) so it
     fires exactly once even when React 18 StrictMode double-invokes the effect
     in dev. The single-use token must never be POSTed twice. */
  const firedRef = useRef(false);

  async function attemptRedeem(token: string): Promise<void> {
    setStatus("redeeming");
    setErrorCode("");
    setErrorMessage("");
    try {
      await apiRequest("POST", `/api/auth/redeem-partner-invite/${token}`, {});
      setStatus("success");
      // v25.32 P0'''' — reflect the partner role in context before the route
      // change so partner-scoped pages mount correctly on first paint.
      setRole("partner");
      setTimeout(() => setLocation("/collective/partner/dashboard"), 1200);
    } catch (e) {
      /* v25.32 P0 — apiRequest throws ApiError on non-2xx. Read the
       * structured fields directly: `.code` for the conditional, the
       * server-supplied `message` for display, and `.invitedEmail` if the
       * mismatch branch included it. */
      if (e instanceof ApiError) {
        setErrorCode(e.code ?? "");
        const payload = (typeof e.payload === "object" && e.payload !== null ? e.payload : {}) as {
          message?: string;
          invitedEmail?: string;
        };
        setErrorMessage(typeof payload.message === "string" && payload.message ? payload.message : e.message);
        if (typeof payload.invitedEmail === "string") setInvitedEmail(payload.invitedEmail);
        // v25.32 Item 64 — on a mismatch, resolve the active session email so
        // the UI can name BOTH addresses. Best-effort: failure leaves the copy
        // generic rather than blocking the recovery action.
        if (e.code === "PARTNER_INVITATION_EMAIL_MISMATCH") {
          try {
            const me = (await apiRequest("GET", "/api/auth/me").then((r) => r.json())) as {
              isAuthed?: boolean;
              identity?: { email?: string } | null;
            };
            if (me?.isAuthed && typeof me.identity?.email === "string") {
              setLoggedInEmail(me.identity.email);
            }
          } catch { /* leave loggedInEmail blank — copy degrades gracefully */ }
        }
      } else {
        setErrorCode("");
        setErrorMessage((e as Error)?.message || "network_error");
      }
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!params?.token) return;
    if (firedRef.current) return;
    firedRef.current = true;
    void attemptRedeem(params.token);
    // attemptRedeem captures `params?.token` via closure; the ref guard
    // prevents a re-fire when React 18 StrictMode double-invokes this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.token]);

  /* v25.30 — Log out the current session and re-attempt the redeem.
   *
   * Used by the EMAIL_MISMATCH recovery action. We POST /api/auth/logout to
   * clear the cookie server-side and locally, then fire the redeem again —
   * the same token is still single-use, so this only works if we lost the
   * race to the v25.23 NC-B gate and never actually consumed it (which is
   * exactly the case for EMAIL_MISMATCH). */
  async function logoutAndRetry(): Promise<void> {
    if (!params?.token) return;
    setRecovering(true);
    try {
      await apiRequest("POST", "/api/auth/logout", {}).catch(() => null);
    } finally {
      setRecovering(false);
    }
    await attemptRedeem(params.token);
  }

  const isEmailMismatch = errorCode === "PARTNER_INVITATION_EMAIL_MISMATCH";

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
            <h1 className="text-xl font-semibold text-emerald-700 mb-2">Welcome</h1>
            <p className="text-sm text-slate-600">Redirecting to your workspace…</p>
          </div>
        )}
        {status === "error" && (
          <div data-testid="partner-redeem-error">
            <h1 className="text-xl font-semibold text-red-700 mb-2">Could not redeem invite</h1>
            <p className="text-sm text-slate-600 mb-3">{errorMessage || errorCode}</p>
            {isEmailMismatch && (
              <div className="mb-3 border border-slate-200 rounded-md p-3 bg-slate-50">
                <p className="text-xs text-slate-700 mb-2">
                  You're currently signed in to a different Capavate account. We won't bind this invite to your current session for security reasons.
                  {loggedInEmail && (
                    <>
                      {" "}You're signed in as <strong data-testid="partner-redeem-logged-in-email">{loggedInEmail}</strong>.
                    </>
                  )}
                  {invitedEmail && (
                    <>
                      {" "}This invite was sent to <strong data-testid="partner-redeem-invited-email">{invitedEmail}</strong>{loggedInEmail ? ", so you'll need to log out and continue with that address" : ""}.
                    </>
                  )}
                </p>
                <Button
                  size="sm"
                  onClick={() => void logoutAndRetry()}
                  disabled={recovering}
                  data-testid="partner-redeem-logout-retry"
                >
                  {recovering ? "Logging out…" : "Log out and continue"}
                </Button>
              </div>
            )}
            <p className="text-xs text-slate-500">
              Magic links expire after 14 days and can only be used once. Ask your managing partner to send a new invite if needed.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
