/**
 * slide13b WAVE D (D2) — admin CRUD for the DB-backed COMPANY-SECTOR taxonomy.
 *
 * Route: /admin/company-taxonomy
 *
 * This is the surface that turns migration 0236's 45-row seed into a starting
 * point instead of a permanent enum. It is DISTINCT from
 * /admin/partner-taxonomy (partner classification, `partner_sectors`): that
 * page classifies PARTNERS; this one lists the sectors a COMPANY, a Collective
 * mandate or an SPV thesis may hold.
 *
 * RULES ENFORCED HERE AND ON THE SERVER
 *   • `value` is the stored identifier and is IMMUTABLE — shown read-only,
 *     monospaced. Only `label` is editable. Renaming a label never rewrites
 *     any company/mandate row.
 *   • RETIRE, never delete. A retired sector stays on the records that hold it
 *     and stops being offered. It can be reinstated.
 *   • Labels are unique per namespace case-insensitively (server 409).
 *   • Every mutation is audited server-side inside the same transaction; a
 *     mutation the audit could not record is rolled back and reported here as
 *     an error — it is NOT durable and the list will not show it.
 *
 * FRESHNESS: on success every mutation invalidates BOTH the admin list and the
 * public selector cache (`invalidateCompanyTaxonomy`), so an open selector in
 * this browser refetches at once; other sessions pick it up on focus / ≤60s.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Tags, Plus, Archive, RotateCcw, Pencil, Check, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  invalidateCompanyTaxonomy,
  useAdminCompanyTaxonomy,
} from "@/lib/companyTaxonomy";
import {
  COMPANY_SECTOR_NAMESPACE,
  TAXONOMY_LABEL_MAX,
  TAXONOMY_VALUE_MAX,
  compareTaxonomyTerms,
  type TaxonomyTermDto,
} from "@shared/companyTaxonomy";

const ADMIN_BASE = `/api/admin/company-taxonomy/${COMPANY_SECTOR_NAMESPACE}`;

async function call(method: "POST", url: string, body: unknown) {
  const r = await apiRequest(method, url, body as any);
  const j = await r.json();
  if (!j?.ok) {
    const durability = j?.durable === false ? " (not saved — rolled back)" : "";
    throw new Error((j?.message || j?.code || j?.error || `${method} ${url} failed`) + durability);
  }
  return j;
}

export default function CompanyTaxonomyAdmin() {
  const { toast } = useToast();
  const q = useAdminCompanyTaxonomy();
  const terms = useMemo(() => [...(q.data ?? [])].sort(compareTaxonomyTerms), [q.data]);
  const activeCount = terms.filter((t) => t.active).length;
  const retiredCount = terms.length - activeCount;

  const [addForm, setAddForm] = useState({ value: "", label: "" });
  const [editing, setEditing] = useState<{ value: string; label: string } | null>(null);

  const done = async (title: string) => {
    await invalidateCompanyTaxonomy();
    toast({ title });
  };
  const failed = (title: string) => (e: any) =>
    toast({ title, description: e?.message, variant: "destructive" });

  const addMut = useMutation({
    mutationFn: async () => {
      const value = addForm.value.trim();
      if (!value) throw new Error("Value is required");
      return call("POST", `${ADMIN_BASE}/terms`, {
        value,
        label: addForm.label.trim() || undefined,
      });
    },
    onSuccess: async () => {
      setAddForm({ value: "", label: "" });
      await done("Sector added");
    },
    onError: failed("Add sector failed"),
  });

  const relabelMut = useMutation({
    mutationFn: async (v: { value: string; label: string }) => {
      if (!v.label.trim()) throw new Error("Label is required");
      return call("POST", `${ADMIN_BASE}/terms/label`, { value: v.value, label: v.label.trim() });
    },
    onSuccess: async () => {
      setEditing(null);
      await done("Label updated");
    },
    onError: failed("Rename failed"),
  });

  const toggleMut = useMutation({
    mutationFn: async (t: TaxonomyTermDto) =>
      call("POST", `${ADMIN_BASE}/terms/${t.active ? "retire" : "reactivate"}`, { value: t.value }),
    onSuccess: async (_d, t) => done(t.active ? "Sector retired" : "Sector reinstated"),
    onError: failed("Update failed"),
  });

  const busy = addMut.isPending || relabelMut.isPending || toggleMut.isPending;

  return (
    <>
      <PageHeader
        title="Company Sector Taxonomy"
        description="The sector list offered to partners adding a portfolio company, to the SPV thesis builder and to Collective applicants. It is read from the database on every load; adding, relabelling or retiring a sector here takes effect without a migration or deploy. The stored value never changes — only its label. Retiring keeps the sector on records that already hold it and stops offering it for new selections. This is separate from the Partner Classification taxonomy."
      />
      <PageBody>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="text-company-taxonomy-loading">Loading company taxonomy…</p>
        ) : q.isError ? (
          <div className="space-y-2" data-testid="text-company-taxonomy-error">
            <p className="text-sm text-rose-600">
              Could not load the company taxonomy. Nothing is shown from a cached or built-in list.
            </p>
            <p className="text-xs text-muted-foreground font-mono">{q.error?.message}</p>
            <Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="button-company-taxonomy-retry">
              Retry
            </Button>
          </div>
        ) : (
          <>
            <Card className="p-4 mb-6" data-testid="card-add-company-sector">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Add sector</h3>
              </div>
              <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <div>
                  <Label className="text-xs">Stored value (immutable)</Label>
                  <Input
                    value={addForm.value}
                    maxLength={TAXONOMY_VALUE_MAX}
                    onChange={(e) => setAddForm((f) => ({ ...f, value: e.target.value }))}
                    placeholder="e.g. Quantum Computing"
                    className="h-9 text-sm font-mono"
                    data-testid="input-company-sector-value"
                  />
                </div>
                <div>
                  <Label className="text-xs">Label (defaults to the value)</Label>
                  <Input
                    value={addForm.label}
                    maxLength={TAXONOMY_LABEL_MAX}
                    onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="e.g. Quantum Computing"
                    className="h-9 text-sm"
                    data-testid="input-company-sector-label"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => addMut.mutate()}
                  disabled={busy}
                  data-testid="button-add-company-sector"
                >
                  {addMut.isPending ? "Adding…" : "Add sector"}
                </Button>
              </div>
            </Card>

            <Card className="p-4" data-testid="card-company-sectors">
              <div className="flex items-center gap-2 mb-3">
                <Tags className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Company sectors</h3>
                <span className="text-xs text-muted-foreground" data-testid="text-company-sector-counts">
                  {activeCount} active · {retiredCount} retired
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Stored value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {terms.map((t) => {
                    const isEditing = editing?.value === t.value;
                    return (
                      <TableRow key={t.value} data-testid={`row-company-sector-${t.value.replace(/\W/g, "_")}`}>
                        <TableCell className="text-sm">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editing!.label}
                                maxLength={TAXONOMY_LABEL_MAX}
                                onChange={(e) => setEditing({ value: t.value, label: e.target.value })}
                                className="h-8 text-sm"
                                data-testid={`input-company-sector-relabel-${t.value.replace(/\W/g, "_")}`}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => relabelMut.mutate(editing!)}
                                disabled={busy}
                                data-testid={`button-company-sector-relabel-save-${t.value.replace(/\W/g, "_")}`}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span data-testid={`text-company-sector-label-${t.value.replace(/\W/g, "_")}`}>{t.label}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{t.value}</TableCell>
                        <TableCell>
                          {t.active ? (
                            <Badge variant="secondary">active</Badge>
                          ) : (
                            <Badge variant="outline">retired</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!isEditing && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setEditing({ value: t.value, label: t.label })}
                              disabled={busy}
                              data-testid={`button-company-sector-relabel-${t.value.replace(/\W/g, "_")}`}
                            >
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Relabel
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleMut.mutate(t)}
                            disabled={busy}
                            data-testid={`button-company-sector-toggle-${t.value.replace(/\W/g, "_")}`}
                          >
                            {t.active ? (
                              <><Archive className="h-3.5 w-3.5 mr-1" /> Retire</>
                            ) : (
                              <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Reinstate</>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          </>
        )}
      </PageBody>
    </>
  );
}
