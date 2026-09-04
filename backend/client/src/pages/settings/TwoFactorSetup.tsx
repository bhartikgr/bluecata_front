/**
 * client/src/pages/settings/TwoFactorSetup.tsx — WAVE 305 · R251.
 *
 * THE SCREEN. The owner's requirement was explicit: enrolment must be reachable by
 * a real user, not by curl. This is that surface, at /settings/two-factor.
 *
 *   GET  /api/auth/mfa/status          → current state
 *   POST /api/auth/mfa/enrol/begin     → { secret, otpauthUri }
 *   POST /api/auth/mfa/enrol/confirm   { code } → { recoveryCodes }
 *   POST /api/auth/mfa/disable         { code } → { ok }
 *
 * IT IS OPT-IN. Nothing on this page can be triggered by an administrator and
 * nothing about it changes how anyone else signs in. Turning it on affects this
 * account only, and turning it off is available from the same screen with a live
 * code.
 *
 * THE BACKUP CODES ARE SHOWN ONCE. There is no endpoint that returns them again,
 * so the page says so before the user can navigate away, and keeps them on screen
 * until the user explicitly acknowledges having saved them.
 *
 * NO MONEY ON THIS PAGE. No amounts, no currency, nothing to fabricate a zero for.
 */
import { useCallback, useEffect, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { serverRefusalText } from "@/lib/serverRefusalMessage";

type MfaStatus = {
  ok: boolean;
  state: "pending" | "confirmed" | "disabled" | null;
  stateReadable: boolean;
  enabled: boolean;
  recoveryCodesRemaining: number | null;
  policyMode: "off" | "enrolled_only" | null;
  policyReadable: boolean;
  recoveryCodeCount: number;
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(await serverRefusalText(r));
  return (await r.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(await serverRefusalText(r));
  return (await r.json()) as T;
}

export default function TwoFactorSetup() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  const refresh = useCallback(async () => {
    try {
      setStatus(await getJson<MfaStatus>("/api/auth/mfa/status"));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const begin = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await postJson<{ secret: string; otpauthUri: string }>("/api/auth/mfa/enrol/begin", {});
      setSecret(r.secret);
      setOtpauthUri(r.otpauthUri);
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const confirm = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await postJson<{ recoveryCodes: string[] }>("/api/auth/mfa/enrol/confirm", { code });
      setRecoveryCodes(r.recoveryCodes);
      setAcknowledged(false);
      setSecret(null);
      setOtpauthUri(null);
      setCode("");
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [code, refresh]);

  const disable = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      await postJson<{ ok: true }>("/api/auth/mfa/disable", { code: disableCode });
      setDisableCode("");
      setRecoveryCodes(null);
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [disableCode, refresh]);

  return (
    <>
      <PageHeader
        title="Two-step sign-in"
        description="Add a code from your phone to your password. Optional, and only for this account."
      />
      <PageBody>
        <div className="space-y-4" data-testid="two-factor-setup">
          {loadError ? (
            <Card>
              <CardContent className="p-4 flex items-start gap-3" data-testid="mfa-load-error">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">We could not read your two-step settings just now.</div>
                  <div className="text-muted-foreground">
                    Your password still works normally and nothing has changed. {loadError}
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {status && !status.stateReadable ? (
            <Card>
              <CardContent className="p-4 flex items-start gap-3" data-testid="mfa-state-unreadable">
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                <div className="text-sm">
                  We cannot tell whether two-step sign-in is on for this account right now, so we are not going to guess.
                  Try again shortly. Your password still works normally.
                </div>
              </CardContent>
            </Card>
          ) : null}

          {status?.enabled ? (
            <Card>
              <CardContent className="p-4 space-y-3" data-testid="mfa-enabled-panel">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  <span className="font-medium">Two-step sign-in is on for this account</span>
                  <Badge variant="secondary" data-testid="mfa-state-badge">On</Badge>
                </div>
                <div className="text-sm text-muted-foreground" data-testid="mfa-remaining-codes">
                  {status.recoveryCodesRemaining === null
                    ? "We could not count your remaining backup codes just now."
                    : `${status.recoveryCodesRemaining} of your one-time backup codes are still unused.`}
                </div>
                <div className="space-y-2">
                  <div className="text-sm">
                    To turn it off, enter a current code from your authenticator app or one unused backup code.
                  </div>
                  <div className="flex gap-2 items-center">
                    <Input
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                      placeholder="123456"
                      className="max-w-[180px]"
                      data-testid="mfa-disable-code"
                    />
                    <Button
                      variant="destructive"
                      disabled={busy || disableCode.trim().length === 0}
                      onClick={() => void disable()}
                      data-testid="mfa-disable-submit"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldOff className="h-4 w-4 mr-2" />}
                      Turn off two-step sign-in
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {recoveryCodes ? (
            <Card>
              <CardContent className="p-4 space-y-3" data-testid="mfa-recovery-codes-panel">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-amber-600" />
                  <span className="font-medium">Save these backup codes now</span>
                </div>
                <div className="text-sm" data-testid="mfa-recovery-warning">
                  Each code signs you in once if you lose your phone. This is the only time they will be shown — we keep
                  no copy we can read back to you.
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-sm" data-testid="mfa-recovery-code-list">
                  {recoveryCodes.map((c) => (
                    <div key={c} className="border rounded px-2 py-1">
                      {c}
                    </div>
                  ))}
                </div>
                {acknowledged ? (
                  <div className="text-sm text-emerald-700 flex items-center gap-2" data-testid="mfa-recovery-acknowledged">
                    <CheckCircle2 className="h-4 w-4" />
                    Saved. You can close this page.
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setAcknowledged(true)} data-testid="mfa-recovery-ack">
                    I have saved these codes
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : null}

          {status && !status.enabled ? (
            <Card>
              <CardContent className="p-4 space-y-3" data-testid="mfa-setup-panel">
                <div className="flex items-center gap-2">
                  <ShieldOff className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">Two-step sign-in is off for this account</span>
                </div>
                <div className="text-sm text-muted-foreground" data-testid="mfa-opt-in-note">
                  This is optional. Nobody will ask you for a code until you finish setting it up here, and turning it on
                  changes nothing for anyone else.
                </div>
                {!secret ? (
                  <Button disabled={busy} onClick={() => void begin()} data-testid="mfa-begin">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
                    Set up two-step sign-in
                  </Button>
                ) : (
                  <div className="space-y-3" data-testid="mfa-pending-panel">
                    <div className="text-sm">
                      Add this key to an authenticator app such as Google Authenticator, 1Password or Authy, then enter
                      the six-digit code it shows.
                    </div>
                    <div className="font-mono text-sm break-all border rounded px-2 py-1" data-testid="mfa-secret">
                      {secret}
                    </div>
                    {otpauthUri ? (
                      <div className="text-xs text-muted-foreground break-all" data-testid="mfa-otpauth-uri">
                        {otpauthUri}
                      </div>
                    ) : null}
                    <div className="flex gap-2 items-center">
                      <Input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="123456"
                        className="max-w-[180px]"
                        data-testid="mfa-confirm-code"
                      />
                      <Button disabled={busy || code.trim().length === 0} onClick={() => void confirm()} data-testid="mfa-confirm">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Confirm and turn it on
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid="mfa-not-on-yet">
                      Nothing is switched on until this code is accepted. If you stop here, you sign in exactly as you do
                      today.
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          {actionError ? (
            <Card>
              <CardContent className="p-4 flex items-start gap-3" data-testid="mfa-action-error">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                <div className="text-sm">{actionError}</div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
