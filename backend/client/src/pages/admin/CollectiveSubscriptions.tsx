/* W4 — Admin authoring UI for the Collective dynamic subscription-package catalog.
 * /admin/collective-subscriptions
 *
 * DB-driven (no in-memory / no hardcoded tiers). Reads + writes ONLY via
 * /api/admin/collective-subscriptions/* and reads the existing Airwallex tier
 * price refs via .../airwallex-price-refs. The price ref MUST be chosen from the
 * existing configured Airwallex tiers (no free-form price entry) — the amount/
 * currency/interval auto-fill from the selected ref and a mismatch is warned
 * before publish. Publishing is blocked server-side on airwallex_price_mismatch.
 *
 * Look-and-feel mirrors AdminApplicationFee.tsx (PageHeader/PageBody/Card/Input/
 * Label/Button + apiRequest/queryClient/useToast + data-testid attributes).
 */
import { useEffect, useMemo, useState } from "react";
import { fmtUSD } from "@/lib/format";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DollarSign, AlertTriangle, Plus, Copy, Rocket, Archive, Trash2, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Interval = "monthly" | "quarterly" | "annual" | "one_time";
type Tier = "basic" | "standard" | "premium";
type Status = "draft" | "preview" | "live" | "deprecated";
type Role = "member" | "dsc_member" | "chapter_admin";

interface Pkg {
  id: string; slug: string; label: string; description: string; entitlements: string[];
  amountMinor: number; currency: string; interval: Interval;
  airwallexTier: Tier; airwallexPriceId: string; membershipRole: Role;
  status: Status; sortOrder: number; effectiveFrom?: string | null; effectiveTo?: string | null;
  version: number; revisionHash: string; updatedAt: string; updatedBy?: string | null;
}
interface PriceRef {
  tier: Tier; priceId: string | null; amountMinor: number | null; currency: string | null;
  interval: string | null; available: boolean;
}
const QK_LIST = "/api/admin/collective-subscriptions?includeExpired=true";
const QK_REFS = "/api/admin/collective-subscriptions/airwallex-price-refs";

const EMPTY_FORM = {
  slug: "", label: "", description: "", entitlements: "" as string,
  amountMinor: 0, currency: "USD", interval: "annual" as Interval,
  airwallexTier: "standard" as Tier, airwallexPriceId: "", membershipRole: "member" as Role,
  sortOrder: 0, effectiveFrom: "", effectiveTo: "",
};

export default function CollectiveSubscriptions() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data: listData, isLoading } = useQuery<{ ok: boolean; packages: Pkg[] }>({
    queryKey: [QK_LIST],
    queryFn: async () => (await apiRequest("GET", QK_LIST)).json(),
    retry: false,
  });
  const { data: refsData } = useQuery<{ ok: boolean; refs: PriceRef[] }>({
    queryKey: [QK_REFS],
    queryFn: async () => (await apiRequest("GET", QK_REFS)).json(),
    retry: false,
  });

  const packages = listData?.packages ?? [];
  const refs = refsData?.refs ?? [];
  const availableRefs = refs.filter((r) => r.available && r.priceId);

  // When a price ref (tier) is chosen, AUTO-FILL amount/currency/interval from the
  // existing configured Airwallex tier. Price is never free-form.
  function applyRef(tier: Tier) {
    const r = refs.find((x) => x.tier === tier);
    setForm((f) => ({
      ...f,
      airwallexTier: tier,
      airwallexPriceId: r?.priceId ?? "",
      amountMinor: r?.amountMinor ?? f.amountMinor,
      currency: r?.currency ?? f.currency,
      interval: (r?.interval as Interval) ?? f.interval,
    }));
  }

  const selectedRef = refs.find((r) => r.tier === form.airwallexTier);
  const priceMismatch = useMemo(() => {
    if (!selectedRef || !selectedRef.available || !selectedRef.priceId) return true;
    return (
      selectedRef.priceId !== form.airwallexPriceId ||
      selectedRef.amountMinor !== form.amountMinor ||
      (selectedRef.currency ?? "") !== form.currency ||
      (selectedRef.interval ?? "") !== form.interval
    );
  }, [selectedRef, form.airwallexPriceId, form.amountMinor, form.currency, form.interval]);

  function beginCreate() {
    setCreating(true); setEditingId(null);
    const first = availableRefs[0];
    const base = { ...EMPTY_FORM };
    if (first) {
      base.airwallexTier = first.tier;
      base.airwallexPriceId = first.priceId ?? "";
      base.amountMinor = first.amountMinor ?? 0;
      base.currency = first.currency ?? "USD";
      base.interval = (first.interval as Interval) ?? "annual";
    }
    setForm(base);
  }
  function beginEdit(p: Pkg) {
    setEditingId(p.id); setCreating(false);
    setForm({
      slug: p.slug, label: p.label, description: p.description,
      entitlements: p.entitlements.join(", "),
      amountMinor: p.amountMinor, currency: p.currency, interval: p.interval,
      airwallexTier: p.airwallexTier, airwallexPriceId: p.airwallexPriceId,
      membershipRole: p.membershipRole, sortOrder: p.sortOrder,
      effectiveFrom: p.effectiveFrom ?? "", effectiveTo: p.effectiveTo ?? "",
    });
  }
  function cancelForm() { setCreating(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: [QK_LIST] });
    queryClient.invalidateQueries({ queryKey: ["/api/collective/membership/tiers"] });
  }

  const body = () => ({
    slug: form.slug.trim().toLowerCase(),
    label: form.label,
    description: form.description,
    entitlements: form.entitlements.split(",").map((s) => s.trim()).filter(Boolean),
    amountMinor: Number(form.amountMinor),
    currency: form.currency.toUpperCase(),
    interval: form.interval,
    airwallexTier: form.airwallexTier,
    airwallexPriceId: form.airwallexPriceId,
    membershipRole: form.membershipRole,
    sortOrder: Number(form.sortOrder),
    effectiveFrom: form.effectiveFrom || null,
    effectiveTo: form.effectiveTo || null,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const method = editingId ? "PATCH" : "POST";
      const url = editingId ? `/api/admin/collective-subscriptions/${editingId}` : "/api/admin/collective-subscriptions";
      const r = await apiRequest(method, url, body());
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "save_failed");
      return j;
    },
    onSuccess: () => { invalidate(); cancelForm(); toast({ title: editingId ? "Package updated" : "Package created" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e?.message, variant: "destructive" }),
  });

  const actionMut = useMutation({
    mutationFn: async (v: { id: string; action: "promote" | "clone" | "delete"; to?: Status }) => {
      let r: Response;
      if (v.action === "promote") r = await apiRequest("POST", `/api/admin/collective-subscriptions/${v.id}/promote`, { to: v.to });
      else if (v.action === "clone") r = await apiRequest("POST", `/api/admin/collective-subscriptions/${v.id}/clone`, {});
      else r = await apiRequest("DELETE", `/api/admin/collective-subscriptions/${v.id}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error === "airwallex_price_mismatch"
        ? "Publish blocked: package price does not match the configured Airwallex tier."
        : (j.error || "action_failed"));
      return j;
    },
    onSuccess: (_d, v) => { invalidate(); toast({ title: `Package ${v.action}${v.action === "delete" ? "d" : "d"}` }); },
    onError: (e: any) => toast({ title: "Action failed", description: e?.message, variant: "destructive" }),
  });

  const bootstrapMut = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/admin/collective-subscriptions/bootstrap-from-env", {});
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "bootstrap_failed");
      return j;
    },
    onSuccess: () => { invalidate(); toast({ title: "Bootstrapped draft packages from env tiers" }); },
    onError: (e: any) => toast({ title: "Bootstrap failed", description: e?.message, variant: "destructive" }),
  });

  const showEditor = creating || editingId !== null;

  return (
    <>
      <PageHeader
        title="Collective Subscriptions"
        description="Author the Collective member subscription packages shown at /collective/membership. Prices are chosen from the existing configured Airwallex tiers only — checkout is blocked if a package's price does not match its tier. Publishing a package (status → live) makes the member catalog dynamic; with no live package the member page falls back to the env/static tiers."
      />
      <PageBody>
        <div className="flex items-center gap-3 mb-4">
          <Button onClick={beginCreate} data-testid="button-new-package"><Plus className="h-4 w-4 mr-1" /> New package</Button>
          <Button variant="outline" onClick={() => bootstrapMut.mutate()} disabled={bootstrapMut.isPending || packages.length > 0} data-testid="button-bootstrap-env">
            Bootstrap from env tiers
          </Button>
          {availableRefs.length === 0 && (
            <span className="text-xs text-amber-700 flex items-center gap-1" data-testid="text-no-refs">
              <AlertTriangle className="h-3.5 w-3.5" /> No Airwallex tier is configured — set the tier env vars before publishing.
            </span>
          )}
        </div>

        {/* ---------------------------------------------------------- editor */}
        {showEditor && (
          <Card className="mb-6" data-testid="card-package-editor">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> {editingId ? "Edit package" : "New package"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Slug</Label>
                <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="e.g. standard-annual" data-testid="input-slug" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Label</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Standard" data-testid="input-label" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-description" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Entitlements (comma-separated)</Label>
                <Input value={form.entitlements} onChange={(e) => setForm({ ...form, entitlements: e.target.value })} placeholder="read, events:attend, dsc:vote" data-testid="input-entitlements" />
              </div>

              {/* Price ref — EXISTING Airwallex tiers only */}
              <div className="space-y-1.5">
                <Label className="text-xs">Airwallex price ref (existing tier)</Label>
                <select
                  className="w-full h-9 rounded-md border px-2 text-sm bg-background"
                  value={form.airwallexTier}
                  onChange={(e) => applyRef(e.target.value as Tier)}
                  data-testid="select-price-ref"
                >
                  {refs.map((r) => (
                    <option key={r.tier} value={r.tier} disabled={!r.available}>
                      {r.tier}{r.available ? ` — ${r.priceId} (${r.amountMinor != null ? fmtUSD(r.amountMinor) : "?"} ${r.currency ?? ""}/${r.interval ?? "?"})` : " — not configured"}
                    </option>
                  ))}
                </select>
                <div className="text-[10px] text-muted-foreground" data-testid="text-price-id">Price id: {form.airwallexPriceId || "—"}</div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Membership role on activation</Label>
                <select
                  className="w-full h-9 rounded-md border px-2 text-sm bg-background"
                  value={form.membershipRole}
                  onChange={(e) => setForm({ ...form, membershipRole: e.target.value as Role })}
                  data-testid="select-role"
                >
                  <option value="member">member</option>
                  <option value="dsc_member">dsc_member</option>
                  <option value="chapter_admin">chapter_admin</option>
                </select>
              </div>

              {/* Amount/currency/interval are auto-filled from the ref (read-only display of the charged price) */}
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (from tier — display)</Label>
                <div className="h-9 flex items-center text-sm font-medium" data-testid="text-amount">{fmtUSD(form.amountMinor)} {form.currency}</div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Interval (from tier)</Label>
                <div className="h-9 flex items-center text-sm font-medium" data-testid="text-interval">{form.interval}</div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Sort order</Label>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} data-testid="input-sort" />
              </div>
              <div className="space-y-1.5" />
              <div className="space-y-1.5">
                <Label className="text-xs">Effective from (ISO, optional)</Label>
                <Input value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} placeholder="2026-08-01T00:00:00Z" data-testid="input-eff-from" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Effective to (ISO, optional)</Label>
                <Input value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} placeholder="2027-08-01T00:00:00Z" data-testid="input-eff-to" />
              </div>

              {priceMismatch && (
                <div className="md:col-span-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800" data-testid="text-mismatch-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    This package's price does not match the selected Airwallex tier's configured price.
                    Airwallex checkout charges the tier's configured amount, so publishing is BLOCKED until they match.
                    Use "New package" and pick the price ref again to auto-fill the correct values.
                  </span>
                </div>
              )}

              {/* Member preview */}
              <div className="md:col-span-2 rounded-md border p-3" data-testid="card-member-preview">
                <div className="text-xs font-medium mb-1 flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> Member preview</div>
                <div className="text-sm font-semibold">{form.label || "—"}</div>
                <div className="text-xs text-muted-foreground">{form.description || "—"}</div>
                <div className="text-sm mt-1">{fmtUSD(form.amountMinor)} {form.currency} / {form.interval}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{form.entitlements || "no entitlements"}</div>
              </div>

              <div className="md:col-span-2 flex items-center gap-3">
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="button-save-package">{editingId ? "Save changes" : "Create draft"}</Button>
                <Button variant="ghost" onClick={cancelForm} data-testid="button-cancel">Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---------------------------------------------------------- index */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Packages</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-loading">Loading packages…</p>
            ) : packages.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-empty">No packages yet. The member page falls back to env/static tiers. Create or bootstrap to begin.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-packages">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 pr-3">Label</th><th className="pr-3">Slug</th><th className="pr-3">Tier</th>
                      <th className="pr-3">Price</th><th className="pr-3">Status</th><th className="pr-3">v</th><th className="pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packages.map((p) => (
                      <tr key={p.id} className="border-b" data-testid={`row-package-${p.slug}`}>
                        <td className="py-2 pr-3 font-medium">{p.label}</td>
                        <td className="pr-3">{p.slug}</td>
                        <td className="pr-3">{p.airwallexTier}</td>
                        <td className="pr-3">{fmtUSD(p.amountMinor)} {p.currency}/{p.interval}</td>
                        <td className="pr-3"><span className="text-xs font-medium">{p.status}</span></td>
                        <td className="pr-3 text-xs">{p.version}</td>
                        <td className="pr-3">
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => beginEdit(p)} data-testid={`button-edit-${p.slug}`}>Edit</Button>
                            {p.status !== "live" && (
                              <Button size="sm" variant="ghost" onClick={() => actionMut.mutate({ id: p.id, action: "promote", to: "live" })} data-testid={`button-publish-${p.slug}`} title="Publish (live)"><Rocket className="h-3.5 w-3.5" /></Button>
                            )}
                            {p.status === "live" && (
                              <Button size="sm" variant="ghost" onClick={() => actionMut.mutate({ id: p.id, action: "promote", to: "deprecated" })} data-testid={`button-deprecate-${p.slug}`} title="Deprecate"><Archive className="h-3.5 w-3.5" /></Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => actionMut.mutate({ id: p.id, action: "clone" })} data-testid={`button-clone-${p.slug}`} title="Clone"><Copy className="h-3.5 w-3.5" /></Button>
                            {p.status !== "live" && (
                              <Button size="sm" variant="ghost" onClick={() => actionMut.mutate({ id: p.id, action: "delete" })} data-testid={`button-delete-${p.slug}`} title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
