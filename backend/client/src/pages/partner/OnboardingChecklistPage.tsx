/**
 * CP Phase B — Partner onboarding checklist.
 *
 * GET   /api/partner/onboarding/state  → { state: {...} }
 * PATCH /api/partner/onboarding/state  → { ok: true, state: {...} }
 *
 * Partner-admin only (server resolves partnerId from session; 403 if not
 * a partner). Each item is a boolean checkbox; the page persists the
 * whole JSON state on every toggle. Progress is computed client-side.
 *
 * No mock data; no localStorage; no TODOs.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { serverRefusalText } from "@/lib/serverRefusalMessage"; /* WAVE 73 · ITEM 1 */
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole"; /* v25.15 NM12 */
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { describeFailure } from "@/lib/failureMessage";

/* ----------------- checklist definition ----------------- */

interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  group: string;
  /* ══════════════════════════════════════════════════════════════════════════
   * WAVE 165 · ITEM F · R135.6 — "mark unsupported, do not remove".
   *
   * THE DEFECT. Several items on this list read as platform features and are
   * not. "Configure SSO (optional but recommended) — SAML 2.0 / OIDC. Required
   * for orgs >25 seats per security policy" is the worst of them: a grep of the
   * whole tree for SAML/OIDC finds ONE hit, and it is this file. The platform
   * has no SSO. A partner who ticks the box has told the record they configured
   * something that does not exist, and a partner who tries to configure it finds
   * nothing to configure. The two KYC items say "Upload …" while this screen
   * offers no upload control at all — the tick is a self-declaration that the
   * document was handled off-platform.
   *
   * R135.6 forbids deleting the items, so each stays exactly where it was, still
   * tickable, and now carries a plain statement of what the tick actually means.
   * An empty/absent value renders nothing, so the supported items are unchanged.
   * ══════════════════════════════════════════════════════════════════════════ */
  support?: string;
}

/**
 * The keys here are the canonical JSON keys persisted in
 * partner_organizations.onboarding_state. New items can be appended without
 * a migration — old keys missing from state default to false.
 */
const CHECKLIST: ChecklistItem[] = [
  {
    key: "kyc_org_doc",
    label: "Upload organisation KYC document",
    description: "Certificate of incorporation, organising agreement, or equivalent.",
    group: "Identity & Compliance",
    support:
      "Manual step — there is no upload control on this screen. Send the document to your chapter admin, then tick this to record that you have done so.",
  },
  {
    key: "kyc_signatory_doc",
    label: "Upload authorised signatory ID",
    description: "Government-issued photo ID for the primary signatory on partner agreements.",
    group: "Identity & Compliance",
    support:
      "Manual step — there is no upload control on this screen. Send the ID to your chapter admin, then tick this to record that you have done so.",
  },
  {
    key: "signed_partner_agreement",
    label: "Sign the consortium partner agreement",
    description:
      "Signed electronically at application (or once, on your first workspace change). Reflects the durable signature on record — not a manual checkbox.",
    group: "Identity & Compliance",
  },
  {
    key: "billing_contact",
    label: "Add billing contact + invoice address",
    description: "Used for subscription fees and SPV admin pass-throughs.",
    group: "Operations",
  },
  {
    key: "team_invites",
    label: "Invite at least one partner-team member",
    description: "Use /collective/partner/team to issue magic-link invitations.",
    group: "Operations",
  },
  {
    key: "first_pipeline_deal",
    label: "Log your first pipeline deal",
    description: "Pipeline → New deal. This is the trigger for downstream syndication.",
    group: "Operations",
  },
  {
    key: "first_client_org",
    label: "Add your first client org",
    description: "Either via direct entry or by accepting an inbound request.",
    group: "Operations",
  },
  {
    key: "sso_configured",
    label: "Configure SSO (optional but recommended)",
    description: "SAML 2.0 / OIDC. Required for orgs >25 seats per security policy.",
    group: "Security",
    support:
      "Not currently supported — Capavate has no SSO integration to configure, so this item cannot be completed on the platform. It is retained for the roadmap and for orgs whose own policy requires the record.",
  },
  {
    key: "data_retention_acked",
    label: "Acknowledge data-retention policy",
    description: "GDPR / PIPEDA retention windows for client + investor data. See /settings/privacy.",
    group: "Security",
  },
  {
    key: "go_live_review",
    label: "Schedule go-live review with chapter admin",
    description: "Final review before LP-visible promotions are enabled.",
    group: "Launch",
    support:
      "Manual step — arranged directly with your chapter admin. Nothing on the platform books this review.",
  },
];

/* ---------------------------- helpers ---------------------------- */

type State = Record<string, boolean>;

/* W2-I — the agreement checklist item is NOT a self-toggle. It reflects the
   DURABLE signed state read from GET /api/partner/me/agreement (which reads the
   canonical contacts column, never the mutable onboarding_state blob). When
   unsigned the item is read-only and links the managing partner to the sign
   page; it flips to done only once a signature of the CURRENT version exists. */
const AGREEMENT_KEY = "signed_partner_agreement";
const AGREEMENT_SIGN_PATH = "/collective/partner/agreement";

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 232 — ONE PERCENTAGE, THREE PROVENANCES.
 *
 * THE DEFECT, precisely. `progress` below divides `done` by `CHECKLIST.length`
 * and renders one number. Those ten items are not the same kind of thing:
 *
 *   1. ONE is recorded by Capavate. `isItemDone(AGREEMENT_KEY)` reads
 *      `agreementSigned`, which comes from GET /api/partner/me/agreement and
 *      therefore from the durable contacts column. Nothing on this screen can
 *      set it.
 *   2. EIGHT are ticked by the partner. `isItemDone` reads `state[key]`, a
 *      persisted JSON toggle. NOTHING TICKS ITSELF — no server process writes
 *      any of these keys. Two of them say "Upload …" while this screen offers
 *      no upload control; the tick is the partner's own note that the thing was
 *      done off-platform. Capavate does not check any of them.
 *   3. ONE cannot be done on the platform at all. Capavate has no SSO
 *      integration, so `sso_configured` describes a configuration that does not
 *      exist to perform.
 *
 * Averaging the three into "7 / 10 complete · 70%" tells a partner — and a
 * chapter admin reading over their shoulder — that Capavate established seven
 * things. It established at most one.
 *
 * WHY THE DERIVATION IS BY MECHANISM AND NOT BY `support`.
 * The obvious shortcut is "items carrying `support` are the ones the platform
 * cannot do". THAT IS A DIFFERENT LIE. FOUR items carry `support`; three of
 * those four open "Manual step" and are ordinary self-attestations that the
 * partner absolutely can complete off-platform and record here. Counting them
 * as impossible would produce 1 / 6 / 3 — wrong in the other direction, and it
 * would tell a partner that a step they had genuinely completed was one the
 * platform could never accept.
 *
 * So each bucket is keyed to the MECHANISM that decides the tick, read straight
 * out of `isItemDone`:
 *   `key === AGREEMENT_KEY`                  → durable record   (bucket 1)
 *   support says it cannot be completed      → not supported    (bucket 3)
 *   otherwise `state[key]`                   → self-attested    (bucket 2)
 *
 * AND THE STATE NAMES ARE HONEST. An earlier approach on this defect was
 * rejected for deriving a `platform_verified` bucket: eight of these are user
 * toggles, and calling their provenance "verified" would have FABRICATED a
 * check that no code performs. Nothing here is called verified. Bucket 1 is
 * "recorded", which is what a stored signature is.
 * ══════════════════════════════════════════════════════════════════════════════ */

/* The marker is read from the item's own `support` prose rather than from a
   second parallel list of keys, so a future item that says it cannot be
   completed is classified correctly without anyone remembering to update a
   registry here. `sso_configured`'s support string contains this substring
   verbatim; a test asserts that, which doubles as the R221.6 proof that the
   protected sentence still reads as written. */
export const PROGRESS_NOT_SUPPORTED_MARKER = "cannot be completed on the platform";

export type ProgressProvenance = "recorded_by_capavate" | "self_attested" | "not_supported";

/** The mechanism that decides this item's tick. Mirrors `isItemDone`. */
export function progressProvenanceOf(item: {
  key: string;
  support?: string;
}): ProgressProvenance {
  if (item.key === AGREEMENT_KEY) return "recorded_by_capavate";
  if (item.support?.includes(PROGRESS_NOT_SUPPORTED_MARKER)) return "not_supported";
  return "self_attested";
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 340 · ITEM 1 — OWNER RULING, 6 SEPTEMBER 2026: "The onboarding should be
 * able to reach 100%."
 *
 * WHAT WAS WRONG. `progress` divided by `CHECKLIST.length`, which included
 * `sso_configured`. That item's own `support` sentence says, on screen, that it
 * "cannot be completed on the platform". A denominator containing a step that
 * cannot be completed means the bar can never read 100% for any partner, however
 * much work they do. The bar was therefore measuring the platform's roadmap, not
 * the partner's progress.
 *
 * THE CHANGE, and its exact limits.
 *   · The DENOMINATOR now contains only COMPLETABLE steps — provenance
 *     `not_supported` is excluded from BOTH `done` and `total`. 9 of 9 is
 *     reachable.
 *   · Excluded steps are NOT removed (R135.6). They still render, still tick,
 *     still carry their support sentence, and are still counted in their own
 *     provenance bucket line, which now says plainly that they sit outside the
 *     percentage.
 *   · Derived from `progressProvenanceOf`, never from a hardcoded 9. If SSO is
 *     ever implemented, deleting its support sentence returns it to the
 *     denominator with no further edit.
 *
 * AND THE HONESTY REQUIREMENT, WHICH IS A SEPARATE THING. Reaching 100% and
 * being TRUE are different requirements. 100% here means "every completable step
 * is recorded as done" — it does NOT mean Capavate checked them. Eight of the
 * nine are partner toggles that no server process verifies, so each one now
 * carries a visible SELF-ATTESTED label, and the percentage's own provenance
 * note says which kinds of evidence it is now made of.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** A step the platform states cannot be completed is not part of the score. */
export function isCompletableChecklistItem(item: { key: string; support?: string }): boolean {
  return progressProvenanceOf(item) !== "not_supported";
}

/** Rendered beside every step whose tick the platform cannot verify. */
export const SELF_ATTESTED_LABEL =
  "Self-attested \u2014 your own record. Capavate does not verify this step.";

/* ── WAVE 219 · ITEM 3 — THE RETENTION LINK, AND A CORRECTION TO THE SPEC ──────
 * The build document says the retention acknowledgement links to `/settings/privacy`
 * "which does not exist", and `spec/OWNER_RULINGS_2026_08_13.md:9652` says the same.
 * BOTH ARE WRONG, verified before building anything: the route is registered at
 * `client/src/App.tsx:1546` and renders `client/src/pages/settings/PrivacyPage.tsx`.
 *
 * The real defect is narrower and different in kind. The path appears only inside the
 * item's `description` STRING — "…See /settings/privacy." — rendered as plain text at
 * the description div below. A partner reading a legal acknowledgement is shown a path
 * they must retype by hand. "A broken link inside a legal acknowledgement is worse
 * than none" — this one is not broken, it is simply not a link.
 *
 * FIXED BY APPENDING A STATIC SIBLING (R143.1). The description literal is
 * BYTE-UNTOUCHED — no literal replaced, no handler expression rewritten — and the
 * anchor is added as the LAST sibling inside the item body, after the existing
 * agreement link. Inserting it mid-block is what tripped the positional panel guard in
 * wave 221; the last-sibling placement is the fix that wave found. */
/* WAVE A · ITEM 3b — the retention link now stays inside the partner's own shell.
   `/settings/privacy` is registered in App.tsx WITHOUT CollectiveShell, so following
   it was a full page load that dropped the partner out of their rail and topbar.
   `/collective/partner/privacy` is a SECOND DOOR onto the SAME `PrivacyPage`
   component, registered in-shell next to the `/collective/notifications` precedent.
   The bare route is untouched and still serves the founder and investor personas.
   The description literal below — "…See /settings/privacy." — is NOT edited: the
   server-side copy fingerprint reads replaced literals as removals, and the bare
   path remains a valid copy-and-paste fallback for anyone who prints the page. */
const PRIVACY_SETTINGS_PATH = "/collective/partner/privacy";
/* Retained so the previous destination stays readable at the call site and so a
   test can prove the old door was not closed. */
const LEGACY_BARE_PRIVACY_PATH = "/settings/privacy";
void LEGACY_BARE_PRIVACY_PATH;
const RETENTION_ITEM_KEY = "data_retention_acked";
const RETENTION_LINK_LABEL = "Open Settings → Privacy to read the retention policy →";

/* ═══════════════════════════════════════════════════════════════════════════
   WALKTHROUGH WAVE F · ITEM 3a — "Include guidance for Consortium Partners as
   to how/where they can complete their profiles."

   RE-MEASURED FIRST. Ten items. Every one already carried a description, and
   six of them already NAMED a destination in prose ("Use /collective/partner/
   team to issue magic-link invitations", "Pipeline → New deal"). Two of the ten
   already carried a real clickable anchor. So the gap was never "no guidance";
   the gap was that eight items told a partner where to go and then made them
   find it themselves.

   WHAT IS ADDED: a route for each item that HAS an in-platform destination, and
   NOTHING for the four that do not. Those four are:
     · kyc_org_doc / kyc_signatory_doc — no upload control exists anywhere on
       the platform; the support prose already says the document goes to the
       chapter admin. A link would have to point somewhere, and there is nowhere
       true to point.
     · sso_configured — Capavate has no SSO integration to configure. It cannot
       be completed on the platform. Inventing a "Configure SSO" link would be a
       lie on screen.
     · go_live_review — arranged with a human. Nothing on the platform books it.

   EVERY PATH BELOW IS A ROUTE REGISTERED IN client/src/App.tsx AND WRAPPED IN
   CollectiveShell. That is asserted by test against the real router source, not
   claimed here; an href is only a string until something answers it.

   The map is keyed by checklist key and is deliberately PARTIAL. A key with no
   entry renders no anchor — absence is the honest default, not an oversight.
   ═══════════════════════════════════════════════════════════════════════════ */
type ItemRoute = { href: string; label: string };
const ITEM_ROUTES: Record<string, ItemRoute> = {
  billing_contact: {
    href: "/collective/partner/billing",
    label: "Open Billing to add your billing contact and invoice address →",
  },
  team_invites: {
    href: "/collective/partner/team",
    label: "Open Team to send a magic-link invitation →",
  },
  first_pipeline_deal: {
    href: "/collective/partner/pipeline",
    label: "Open Pipeline to log your first deal →",
  },
  first_client_org: {
    href: "/collective/partner/clients",
    label: "Open Clients to add or accept your first client org →",
  },
};

/* The items that genuinely have no in-platform destination. Named as data so a
   test can assert the ABSENCE is deliberate and complete, rather than reading a
   missing link as an accident. */
const ITEMS_WITH_NO_PLATFORM_DESTINATION: string[] = [
  "kyc_org_doc",
  "kyc_signatory_doc",
  "sso_configured",
  "go_live_review",
];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    /* WAVE 73 · ITEM 1 · R58 — A CONSORTIUM PARTNER'S OWN ONBOARDING SCREEN.
       This wrapper is a byte-for-byte sibling of the admin one
       (`admin/ConsortiumApplicationsPage.tsx`) and threw the same thing away: a
       partner blocked on a checklist step saw an enum code and an HTTP number
       instead of the sentence the server wrote about what to do next. Reads the
       server's `message` now, through the module Wave 69 created, and falls back
       to this function's own previous string when there is none. */
    throw new Error(await serverRefusalText(r));
  }
  return (await r.json()) as T;
}

/* ----------------------------- page ----------------------------- */

export default function PartnerOnboardingChecklistPage() {
  /* v25.15 NM12 — gate the page on a resolved partner identity. */
  const role = useRequirePartnerRole();
  const [state, setState] = useState<State>({});
  /* W2-I — durable agreement signed state (current-version). null = unknown. */
  const [agreementSigned, setAgreementSigned] = useState<boolean | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ state: unknown }>(
        "/api/partner/onboarding/state",
      );
      const raw = res.state && typeof res.state === "object" ? (res.state as Record<string, unknown>) : {};
      const coerced: State = {};
      for (const item of CHECKLIST) {
        coerced[item.key] = Boolean(raw[item.key]);
      }
      setState(coerced);
      /* W2-I — overlay the DURABLE agreement signed state so the checklist
         reflects the canonical contacts column, not the mutable JSON blob. */
      try {
        const ag = await fetchJson<{ signed?: boolean; signedCurrent?: boolean }>(
          "/api/partner/me/agreement",
        );
        setAgreementSigned(Boolean(ag.signedCurrent ?? ag.signed));
      } catch {
        setAgreementSigned(null);
      }
    } catch (e) {
      /* WAVE 197 #55 — READ. the local `fetchJson` helper uses a bare `fetch` and
         `await r.json()`, so a network TypeError or a JSON SyntaxError reaches
         the error banner (data-testid="error-banner") with nothing in between. Loading changes
         nothing, so read copy is the true one. */
      setError(describeFailure(e, "read"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role.ready && role.identity) void load();
  }, [load, role.ready, role.identity]);

  /* v25.15 NM13 — capture previous state via setState((prev) => ...) so the
     optimistic rollback path is not bound to a stale closure value. */
  async function toggle(key: string): Promise<void> {
    let prev: State = {};
    setState((current) => {
      prev = current;
      return { ...current, [key]: !current[key] };
    });
    const next = { ...prev, [key]: !prev[key] };
    setSaving(true);
    setError(null);
    try {
      await fetchJson("/api/partner/onboarding/state", {
        method: "PATCH",
        body: JSON.stringify(next),
      });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      // Roll back the optimistic toggle using the captured previous state.
      setState(prev);
      /* WAVE 197 #56 — WRITE. The rollback above restores the LOCAL view; it
         does not undo a server change, and the PATCH may have applied before
         the failure surfaced. So the copy must not claim nothing was saved. */
      setError(describeFailure(e, "write"));
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, ChecklistItem[]>();
    for (const item of CHECKLIST) {
      const list = m.get(item.group) ?? [];
      list.push(item);
      m.set(item.group, list);
    }
    return Array.from(m.entries());
  }, []);

  /* W2-I — the agreement item's completion comes from the durable signed
     state, every other item from the persisted JSON toggle. */
  const isItemDone = useCallback(
    (key: string): boolean => (key === AGREEMENT_KEY ? !!agreementSigned : !!state[key]),
    [state, agreementSigned],
  );

  /* WAVE 340 · ITEM 1 — the denominator holds COMPLETABLE steps only, so 100% is
     reachable. See the block comment above `isCompletableChecklistItem`. */
  const progress = useMemo(() => {
    const completable = CHECKLIST.filter(isCompletableChecklistItem);
    const done = completable.filter((i) => isItemDone(i.key)).length;
    const total = completable.length;
    return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
  }, [isItemDone]);

  /* WAVE 232 — the same ten items, split by the mechanism that decides each
     tick. `progress` above is deliberately left exactly as it was: the bar and
     the badge are not the defect, the absence of a statement about what they mix
     is. Derived from CHECKLIST itself, never from a hardcoded 1 / 8 / 1, so
     appending, reordering or reclassifying an item moves these numbers with it. */
  const provenance = useMemo(() => {
    const buckets: Record<ProgressProvenance, { done: number; total: number }> = {
      recorded_by_capavate: { done: 0, total: 0 },
      self_attested: { done: 0, total: 0 },
      not_supported: { done: 0, total: 0 },
    };
    for (const item of CHECKLIST) {
      const bucket = buckets[progressProvenanceOf(item)];
      bucket.total += 1;
      if (isItemDone(item.key)) bucket.done += 1;
    }
    return buckets;
  }, [isItemDone]);

  /* The agreement read can fail (`setAgreementSigned(null)` in the catch above),
     and `isItemDone` maps null to false through `!!`. So the percentage counts an
     UNREADABLE signature record as an incomplete step. Saying "0 of 1 recorded"
     in that state would put a fabricated zero where the truth is "not known", so
     the recorded line says which of the two it is. */
  const agreementRecordKnown = agreementSigned !== null;

  /* v25.15 NM12 — wait for partner role gate before rendering the checklist. */
  if (!role.ready || !role.identity) return null;

  return (
    <>
      <PageHeader
        title="Onboarding checklist"
        description="Steps to take your consortium-partner workspace from approved → live."
        breadcrumbs={[{ label: "Partner" }, { label: "Onboarding" }]}
        actions={
          <div className="flex items-center gap-2">
            {saving && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </span>
            )}
            {!saving && savedAt && (
              <span className="text-xs text-muted-foreground" data-testid="text-saved-at">
                Saved at {savedAt}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading || saving}
              data-testid="button-reload"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Reload
            </Button>
          </div>
        }
      />
      <PageBody>
        {/* Progress card */}
        <Card className="mb-4">
          <CardContent className="py-4">
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck className="h-5 w-5 text-[var(--cv-color-primary)]" />
              <div className="text-sm font-medium">Progress</div>
              <Badge variant="outline" className="ml-auto" data-testid="badge-progress">
                {progress.done} / {progress.total} complete · {progress.pct}%
              </Badge>
            </div>
            <div className="h-2 rounded bg-secondary overflow-hidden">
              <div
                className="h-full bg-[var(--cv-color-primary)] transition-all"
                style={{ width: `${progress.pct}%` }}
                data-testid="bar-progress"
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Your progress is saved against your organisation. Checkboxes are
              optimistic; any failure rolls back and surfaces the error.
            </div>
            {/* WAVE 232 — APPENDED AS THE LAST SIBLING inside this CardContent,
                after the existing muted note. Inserting it above the bar would
                renumber this card's existing children for the positional panel
                guard, which is the trap wave 221 hit; last-sibling placement is
                the fix that wave found. Nothing above is touched — the badge, the
                bar, its width style and the muted note are byte-identical, and
                `progress` still computes exactly what it computed before. These
                are plain divs, so no panel is added either. */}
            <div
              className="text-xs text-muted-foreground mt-2"
              data-testid="text-progress-provenance"
            >
              <div data-testid="text-progress-provenance-lead">
                What that percentage is made of. It counts only the steps that can
                be completed, so 100% is reachable — but it counts steps recorded,
                not steps Capavate has checked.
              </div>
              <div data-testid="text-progress-provenance-recorded">
                Recorded by Capavate — {provenance.recorded_by_capavate.total}{" "}
                {provenance.recorded_by_capavate.total === 1 ? "step" : "steps"}: read
                from the durable signature on record, not a checkbox here.{" "}
                {agreementRecordKnown
                  ? `${provenance.recorded_by_capavate.done} of ${provenance.recorded_by_capavate.total} on record.`
                  : "Not established \u2014 the record could not be read, so the percentage counts it as incomplete."}
              </div>
              <div data-testid="text-progress-provenance-self">
                Ticked by you — {provenance.self_attested.total}{" "}
                {provenance.self_attested.total === 1 ? "step" : "steps"}:{" "}
                {provenance.self_attested.done} ticked. Your own record that the work
                was done, usually off this screen. Capavate does not check them.
              </div>
              <div data-testid="text-progress-provenance-unsupported">
                Capavate cannot do at all — {provenance.not_supported.total}{" "}
                {provenance.not_supported.total === 1 ? "step" : "steps"}:{" "}
                {provenance.not_supported.done} ticked. There is nothing on the
                platform to perform, so a tick records only your own note. These
                steps are outside the percentage above and cannot hold it below
                100%.
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <Card className="mb-4 border-rose-200 bg-rose-50">
            <CardContent className="py-3 text-sm text-rose-900 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span data-testid="error-banner">{error}</span>
            </CardContent>
          </Card>
        )}

        {/* Grouped checklist */}
        {grouped.map(([group, items]) => (
          <Card key={group} className="mb-4">
            <CardContent className="py-4">
              <div className="text-sm font-medium mb-3">{group}</div>
              <ul className="space-y-3">
                {items.map((it) => {
                  const done = isItemDone(it.key);
                  const isAgreement = it.key === AGREEMENT_KEY;
                  return (
                    <li
                      key={it.key}
                      className="flex items-start gap-3"
                      data-testid={`item-${it.key}`}
                    >
                      {isAgreement ? (
                        /* W2-I — read-only: reflects the durable signed state,
                           never a self-toggle. Icon is not a toggle button. */
                        <span className="mt-0.5 shrink-0" aria-hidden data-testid={`status-${it.key}`}>
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground" />
                          )}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void toggle(it.key)}
                          disabled={loading || saving}
                          className="mt-0.5 shrink-0"
                          aria-pressed={done}
                          data-testid={`toggle-${it.key}`}
                        >
                          {done ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground" />
                          )}
                        </button>
                      )}
                      <div className="flex-1">
                        <div className={`text-sm ${done ? "line-through text-muted-foreground" : ""}`}>
                          {it.label}
                        </div>
                        <div className="text-xs text-muted-foreground">{it.description}</div>
                        {/* WAVE 165 · ITEM F · R135.6 — what ticking this box does
                            and does not do. A new sibling: the label and the
                            description above are untouched, because R135.6 marks
                            rather than rewrites. */}
                        <div className="text-xs text-amber-800" data-testid={`support-${it.key}`}>
                          {it.support ?? ""}
                        </div>
                        {isAgreement && !done && (
                          <a
                            href={AGREEMENT_SIGN_PATH}
                            className="text-xs text-[var(--cv-color-primary)] underline"
                            data-testid="link-sign-agreement"
                          >
                            Sign the Consortium Partner Agreement →
                          </a>
                        )}
                        {/* WAVE 219 · ITEM 3 — appended as the LAST sibling. Rendered
                            unconditionally for the retention item, not only while it is
                            unticked: a partner who has already acknowledged the policy
                            must still be able to reach it, and gating it on `!done`
                            would take a route away from someone who had it (R190.10). */}
                        {it.key === RETENTION_ITEM_KEY && (
                          <a
                            href={PRIVACY_SETTINGS_PATH}
                            className="text-xs text-[var(--cv-color-primary)] underline"
                            data-testid="link-data-retention-privacy"
                          >
                            {RETENTION_LINK_LABEL}
                          </a>
                        )}
                        {/* WAVE F · ITEM 3a — APPENDED AS THE LAST SIBLING, after
                            every existing child, so no existing element changes
                            position. Rendered whether or not the item is ticked:
                            a partner who has already added a billing contact must
                            still be able to reach Billing to change it, and taking
                            a route away on completion would be a regression
                            (R190.10). Renders NOTHING for a key with no entry. */}
                        {ITEM_ROUTES[it.key] && (
                          <a
                            href={ITEM_ROUTES[it.key].href}
                            className="mt-0.5 block text-xs text-[var(--cv-color-primary)] underline"
                            data-testid={`link-${it.key}`}
                          >
                            {ITEM_ROUTES[it.key].label}
                          </a>
                        )}
                        {/* WAVE 340 · ITEM 1 — APPENDED AS THE LAST SIBLING, after
                            every existing child, so nothing above changes position.
                            The owner asked for a reachable 100%; that makes it more
                            important, not less, that a partner can see which ticks
                            are their own word and which Capavate holds a record of.
                            Rendered for self-attested steps only: the agreement step
                            IS held on record, and the unsupported step already says
                            something stronger in its own support line. */}
                        {progressProvenanceOf(it) === "self_attested" && (
                          <div
                            className="mt-0.5 text-xs text-muted-foreground"
                            data-testid={`selfattested-${it.key}`}
                          >
                            {SELF_ATTESTED_LABEL}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </PageBody>
    </>
  );
}
