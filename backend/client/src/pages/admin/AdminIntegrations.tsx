/**
 * W-V44 FIX K — Admin Market-Data Integrations (real DB-driven).
 *
 * One canonical, admin-configurable source of truth for the venture-markets
 * data provider that powers the Collective "Global Venture & Early-Stage
 * Markets" widget. Everything here is DB-backed (collective_admin_settings):
 *
 *   - The ACTIVE provider is persisted and applied live (setProvider) on save.
 *   - Each key-gated provider's API KEY is stored server-side and returned to
 *     this page ONLY masked ("•••• 1234") — the raw secret never leaves the
 *     server. Saving a key merges (other providers' keys are preserved);
 *     saving an empty key clears that provider.
 *   - When a key-gated provider is active but no key is set, the backend
 *     transparently falls back to the free Stooq feed, so the widget never
 *     errors or blanks.
 *
 * Reads  GET  /api/admin/market-data-integrations
 * Writes POST /api/admin/market-data-integrations/key   (set/clear a key)
 *        PUT  /api/admin/collective-settings            (switch active provider)
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ProviderRow {
  id: string;
  label: string;
  requiresKey: boolean;
  docsUrl: string;
  blurb: string;
  configured: boolean;
  maskedKey: string;
}
interface IntegrationsResponse {
  ok: boolean;
  active: string;
  providers: ProviderRow[];
}

export default function AdminIntegrations() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<IntegrationsResponse>({
    queryKey: ["/api/admin/market-data-integrations"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/market-data-integrations")).json(),
    retry: false,
  });

  // Local draft of the API-key inputs, keyed by provider id. Blank = unchanged
  // display (we never prefill the real secret; the masked value is shown as a
  // placeholder instead).
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  // Track the selected active provider locally so the radio reflects intent
  // before the save round-trips.
  const [activeDraft, setActiveDraft] = useState<string>("");
  useEffect(() => {
    if (data?.active) setActiveDraft(data.active);
  }, [data?.active]);

  const setActiveMut = useMutation({
    mutationFn: async (provider: string): Promise<unknown> =>
      (await apiRequest("PUT", "/api/admin/collective-settings", { ventureProvider: provider })).json(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/admin/market-data-integrations"] });
      toast({ title: "Active provider updated", description: "The live venture-markets feed now uses this provider." });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Update failed", description: e.message }),
  });

  const saveKeyMut = useMutation({
    mutationFn: async (vars: { provider: string; apiKey: string }): Promise<IntegrationsResponse> =>
      (await apiRequest("POST", "/api/admin/market-data-integrations/key", vars)).json(),
    onSuccess: (resp, vars) => {
      qc.setQueryData(["/api/admin/market-data-integrations"], resp);
      setKeyDrafts((d) => ({ ...d, [vars.provider]: "" }));
      toast({
        title: vars.apiKey.trim().length > 0 ? "API key saved" : "API key cleared",
        description: vars.apiKey.trim().length > 0
          ? "Stored securely (server-side). It is never shown again in full."
          : "This provider is now unconfigured and will fall back to the free feed.",
      });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Save failed", description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Integrations — Market Data"
        description="Choose and configure the live provider for the Collective 'Global Venture & Early-Stage Markets' widget. All settings are DB-driven: the active provider and each provider's API key are persisted server-side and applied live. API keys are stored securely and only ever shown masked. If a key-gated provider is selected without a key, the feed automatically falls back to the free Stooq feed so members never see an error."
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: "Integrations" }]}
      />
      <PageBody>
        {isLoading && <p className="text-sm text-muted-foreground" data-testid="integrations-loading">Loading…</p>}
        {error && (
          <p className="text-sm text-red-600" data-testid="integrations-error">
            Failed to load integrations: {(error as Error).message}
          </p>
        )}

        {data?.providers && (
          <div className="space-y-4" data-testid="integrations-list">
            <Card>
              <CardHeader>
                <CardTitle>Where this shows in the front-end</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <p>
                  The selected provider feeds <strong>GET /api/feeds/venture-markets</strong>, which renders
                  the "Global Venture &amp; Early-Stage Markets" panel on the <strong>Collective member
                  dashboard</strong>. Index levels come from the live provider; any value the provider does not
                  return renders as "—" (never fabricated).
                </p>
                <p>
                  Currently active: <strong data-testid="integrations-active">{data.active}</strong>.
                </p>
              </CardContent>
            </Card>

            {data.providers.map((p) => {
              const isActive = activeDraft === p.id;
              return (
                <Card key={p.id} data-testid={`integrations-provider-${p.id}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="active-provider"
                        checked={isActive}
                        onChange={() => { setActiveDraft(p.id); setActiveMut.mutate(p.id); }}
                        data-testid={`radio-active-${p.id}`}
                        aria-label={`Set ${p.label} as active provider`}
                      />
                      {p.label}
                      {isActive && (
                        <span className="text-xs rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">Active</span>
                      )}
                      {p.requiresKey && (
                        <span
                          className={`text-xs rounded px-2 py-0.5 ${p.configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
                          data-testid={`status-${p.id}`}
                        >
                          {p.configured ? "Key configured" : "No key"}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">{p.blurb}</p>
                    {p.docsUrl && (
                      <a
                        href={p.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary underline"
                        data-testid={`docs-${p.id}`}
                      >
                        Get an API key →
                      </a>
                    )}
                    {p.requiresKey && (
                      <div className="space-y-2">
                        <Label htmlFor={`key-${p.id}`}>API key</Label>
                        <div className="flex gap-2">
                          <Input
                            id={`key-${p.id}`}
                            type="password"
                            autoComplete="off"
                            placeholder={p.configured ? `Configured (${p.maskedKey}). Enter a new key to replace.` : "Enter API key"}
                            value={keyDrafts[p.id] ?? ""}
                            onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                            data-testid={`input-key-${p.id}`}
                          />
                          <Button
                            onClick={() => saveKeyMut.mutate({ provider: p.id, apiKey: keyDrafts[p.id] ?? "" })}
                            disabled={saveKeyMut.isPending || (keyDrafts[p.id] ?? "").trim().length === 0}
                            data-testid={`save-key-${p.id}`}
                          >
                            Save key
                          </Button>
                          {p.configured && (
                            <Button
                              variant="outline"
                              onClick={() => saveKeyMut.mutate({ provider: p.id, apiKey: "" })}
                              disabled={saveKeyMut.isPending}
                              data-testid={`clear-key-${p.id}`}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
