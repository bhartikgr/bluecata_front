/**
 * WAVE 210 — THE RE-CONSENT MECHANISM, AND IT IS DELIBERATELY NOT A GATE.
 *
 * THE DECISION AND THE REASONING. Existing users are NOT required to re-consent
 * before continuing to use the platform. They are notified, once, on their next
 * authenticated page view, and acknowledging records which version they accepted.
 *
 *   1. The adopted corpus IS the text the signup consent already attested to —
 *      the 17 March 2026 documents — with the party-name spelling corrected to
 *      the registered name and two clauses APPENDED that disclose more, not
 *      less: the absence of any EU authorisation, and the existence of the
 *      cross-Collective benchmarking feature together with its opt-out. Nobody's
 *      rights are reduced. Compelled re-consent is indicated when terms change
 *      against a user's interest; that is not what happened here.
 *   2. A blocking interstitial on every existing user's next login is the single
 *      most disruptive change available, and the owner asked us not to break
 *      anything. He asked for the corpora to be consolidated, not for the user
 *      base to be stopped at the door.
 *   3. What actually needed fixing was that the served text and the recorded
 *      version disagreed. Acknowledgement records the version accepted, so the
 *      trail is complete either way — which was the point.
 *   4. The argument on the other side, stated because it is real: the corrected
 *      party name means the adopted text differs from the exact string a user
 *      accepted. That is why this notice NAMES THE VERSION and records it. It is
 *      answered by evidence, not by a gate.
 *
 * IT CANNOT BLOCK ANYTHING. It renders inline, it is dismissible, it never
 * returns a route guard, and every failure path renders nothing at all. If the
 * acknowledgement endpoint is down the user sees no notice and loses no access.
 */
import { useEffect, useState } from "react";
import { ADOPTED_LEGAL_CORPUS_VERSION } from "@shared/wave210LegalCorpusVersion";

const DOC_IDS = ["privacy", "terms", "cookies", "acceptable-use", "disclaimer"];

export function LegalUpdateNotice() {
  const [needed, setNeeded] = useState(false);
  const [version, setVersion] = useState(ADOPTED_LEGAL_CORPUS_VERSION);
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/legal/consent/acknowledgement", { credentials: "include" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled || !body?.ok) return;
        if (typeof body.activeVersion === "string") setVersion(body.activeVersion);
        setNeeded(Boolean(body.needsAcknowledgement));
      } catch {
        /* Silent by design: a notice that fails must not become an obstacle. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function acknowledge() {
    setSaving(true);
    try {
      const res = await fetch("/api/legal/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        /* `settings_update` is an EXISTING context value with no other client
         * caller. Reused deliberately: no schema change, no migration, and the
         * chain, the idempotency key and the audit event are the ones already in
         * service. `documentVersion` is what makes this row evidence. */
        body: JSON.stringify({ documentIds: DOC_IDS, context: "settings_update", documentVersion: version }),
      });
      if (res.ok) {
        setAcknowledged(true);
        setNeeded(false);
      }
    } catch {
      /* Leave the notice up. Nothing is claimed that was not recorded. */
    } finally {
      setSaving(false);
    }
  }

  if (acknowledged) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="legal-update-acknowledged">
        Thank you. We have recorded that you have seen version {version} of our legal documents.
      </div>
    );
  }

  if (!needed || dismissed) return null;

  return (
    <div
      className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      data-testid="legal-update-notice"
      role="status"
    >
      <div className="font-semibold text-foreground">Our legal documents have been consolidated</div>
      <p className="mt-1 leading-relaxed">
        The Terms of Service, Privacy Policy, Cookie Policy, Acceptable Use Policy and Disclaimer are now published as
        one set, version {version}, issued by BluePrint Catalyst Limited. Your existing agreement still stands and your
        access is unaffected. You can read the published documents at any time, and we will record which version you
        have seen if you tell us you have read them.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <a className="underline" href="/terms-of-service" data-testid="link-legal-update-terms">
          Read the Terms of Service
        </a>
        <a className="underline" href="/privacy-policy" data-testid="link-legal-update-privacy">
          Read the Privacy Policy
        </a>
        <button
          type="button"
          className="underline font-medium text-foreground disabled:opacity-60"
          onClick={acknowledge}
          disabled={saving}
          data-testid="button-legal-update-acknowledge"
        >
          {saving ? "Recording…" : "I have read these"}
        </button>
        <button
          type="button"
          className="underline"
          onClick={() => setDismissed(true)}
          data-testid="button-legal-update-dismiss"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
