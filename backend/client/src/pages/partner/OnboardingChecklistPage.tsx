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

/* ----------------- checklist definition ----------------- */

interface ChecklistItem {
  key: string;
  label: string;
  description: string;
  group: string;
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
  },
  {
    key: "kyc_signatory_doc",
    label: "Upload authorised signatory ID",
    description: "Government-issued photo ID for the primary signatory on partner agreements.",
    group: "Identity & Compliance",
  },
  {
    key: "signed_partner_agreement",
    label: "Sign the consortium partner agreement",
    description: "Counter-signed PDF returned to the chapter admin.",
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
  },
];

/* ---------------------------- helpers ---------------------------- */

type State = Record<string, boolean>;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = j?.error ?? "";
    } catch {
      detail = await r.text().catch(() => "");
    }
    throw new Error(`HTTP ${r.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await r.json()) as T;
}

/* ----------------------------- page ----------------------------- */

export default function PartnerOnboardingChecklistPage() {
  /* v25.15 NM12 — gate the page on a resolved partner identity. */
  const role = useRequirePartnerRole();
  const [state, setState] = useState<State>({});
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
    } catch (e) {
      setError((e as Error).message);
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
      setError((e as Error).message);
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

  const progress = useMemo(() => {
    const done = CHECKLIST.filter((i) => state[i.key]).length;
    const total = CHECKLIST.length;
    return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
  }, [state]);

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
              <ShieldCheck className="h-5 w-5 text-[#cc0001]" />
              <div className="text-sm font-medium">Progress</div>
              <Badge variant="outline" className="ml-auto" data-testid="badge-progress">
                {progress.done} / {progress.total} complete · {progress.pct}%
              </Badge>
            </div>
            <div className="h-2 rounded bg-secondary overflow-hidden">
              <div
                className="h-full bg-[#cc0001] transition-all"
                style={{ width: `${progress.pct}%` }}
                data-testid="bar-progress"
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              State is persisted as JSON on partner_organizations.onboarding_state. Checkboxes are
              optimistic; any failure rolls back and surfaces the error.
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
                  const done = !!state[it.key];
                  return (
                    <li
                      key={it.key}
                      className="flex items-start gap-3"
                      data-testid={`item-${it.key}`}
                    >
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
                      <div className="flex-1">
                        <div className={`text-sm ${done ? "line-through text-muted-foreground" : ""}`}>
                          {it.label}
                        </div>
                        <div className="text-xs text-muted-foreground">{it.description}</div>
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
