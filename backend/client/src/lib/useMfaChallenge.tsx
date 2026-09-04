/**
 * client/src/lib/useMfaChallenge.tsx — WAVE 305 · R251.
 *
 * THE SECOND-FACTOR STEP ON THE LOGIN FORM, as one hook shared by all three login
 * pages (admin/Login.tsx, partner/PartnerLogin.tsx, auth/Login.tsx).
 *
 * WHY A HOOK AND NOT A PAGE
 * -------------------------
 * All three pages have substantial, hard-won post-login routing logic — the
 * multi-workspace chooser, the `returnTo` deep-link honouring, the wrong-portal
 * suggestion. Sending the user to a separate /login/two-factor page would mean
 * re-implementing or bypassing that continuation, and bypassing it is exactly the
 * class of defect ("silently navigating to /founder/dashboard") the pages were
 * fixed for. So the challenge happens IN PLACE: the submit handler awaits a code,
 * exchanges it for a session, and then runs the SAME continuation it always did,
 * unchanged.
 *
 * `requestCode()` returns a promise the inline panel resolves. Cancelling rejects
 * it, which the caller's existing catch already handles.
 *
 * THE TOKEN NEVER TOUCHES STORAGE. It lives in React state for the seconds the
 * panel is open. `localStorage` would leave a login-completing credential on disk.
 *
 * NO MONEY ON THIS SURFACE.
 */
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldCheck } from "lucide-react";

/** Thrown when the user closes the panel instead of entering a code. */
export const MFA_CANCELLED = "MFA_CANCELLED";

export type MfaChallenge = {
  /** Open the panel and resolve with the code the user typed. */
  requestCode: () => Promise<string>;
  /** Render this at the END of the page's JSX (guard rule: panels append last). */
  panel: JSX.Element | null;
  /** True while the panel is open. */
  open: boolean;
};

export function useMfaChallenge(): MfaChallenge {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const resolverRef = useRef<{ resolve: (c: string) => void; reject: (e: Error) => void } | null>(null);

  const requestCode = useCallback(() => {
    setCode("");
    setOpen(true);
    return new Promise<string>((resolve, reject) => {
      resolverRef.current = { resolve, reject };
    });
  }, []);

  const submit = useCallback(() => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    r?.resolve(code.trim());
  }, [code]);

  const cancel = useCallback(() => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    r?.reject(new Error(MFA_CANCELLED));
  }, []);

  const panel = open ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="mfa-challenge-panel"
    >
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-lg space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
          <span className="font-medium" data-testid="mfa-challenge-title">
            Two-step sign-in
          </span>
        </div>
        <div className="text-sm text-muted-foreground" data-testid="mfa-challenge-help">
          Enter the six-digit code from your authenticator app. If you do not have your phone, enter one of your one-time
          backup codes instead.
        </div>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          autoFocus
          data-testid="mfa-challenge-code"
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.trim().length > 0) submit();
          }}
        />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={cancel} data-testid="mfa-challenge-cancel">
            Cancel
          </Button>
          <Button disabled={code.trim().length === 0} onClick={submit} data-testid="mfa-challenge-submit">
            <Loader2 className="h-4 w-4 mr-2 hidden" />
            Continue
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  return { requestCode, panel, open };
}

/**
 * Exchange a step-up token plus a code for a real session.
 *
 * Returns the parsed body on success. Throws with the SERVER'S OWN message on
 * failure — the server distinguishes a wrong code, an already-used code, an
 * exhausted set of backup codes and an expired attempt, and each of those needs a
 * different action from the user. Collapsing them into "login failed" is what
 * would send someone hunting for a typo when the truth is "you have no codes
 * left".
 */
export async function completeMfaLogin(token: string, code: string): Promise<{ ok: true; ctx: unknown }> {
  const r = await fetch("/api/auth/login/mfa", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, code }),
  });
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
  if (!r.ok || !body.ok) {
    throw new Error(body.message || body.error || "That code could not be checked. Please try again.");
  }
  return body as { ok: true; ctx: unknown };
}
