/**
 * WAVE 4B (PT-2) — admin CRUD for the partner-classification lookup tables.
 *
 * Route: /admin/partner-taxonomy
 *
 * Owner ruling: "DB-driven, no hardcoded client array. Admin must be able to
 * add or retire a type WITHOUT a migration." That is what this page is for —
 * it is the surface that makes migration 0149's seed a starting point rather
 * than a permanent enum.
 *
 * RETIRE, never delete: DELETE on the API sets `active = 0`. A sub-sector that
 * partners already hold keeps working on their records and in historical
 * reports; it simply stops being offered in the selector. Hard-deleting would
 * silently rewrite history, which is exactly the failure mode this wave exists
 * to avoid.
 *
 * 🚧 SCOPE FENCE (PT-5): nothing here reads or writes a permission. Editing the
 * taxonomy changes reporting labels and nothing else.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Tags, Plus, Archive, RotateCcw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  groupTaxonomy,
  type PartnerTaxonomyDto,
} from "@shared/partnerClassification";

const TAXONOMY_KEY = ["/api/admin/partner-taxonomy/all"];

/** Admin view includes RETIRED rows, so they can be reinstated. */
function useAdminTaxonomy() {
  return useQuery<PartnerTaxonomyDto>({
    queryKey: TAXONOMY_KEY,
    queryFn: async () => {
      const [sr, br] = await Promise.all([
        apiRequest("GET", "/api/admin/partner-taxonomy/sectors?includeInactive=1"),
        apiRequest("GET", "/api/admin/partner-taxonomy/subsectors?includeInactive=1"),
      ]);
      const [sj, bj] = await Promise.all([sr.json(), br.json()]);
      return { sectors: sj.sectors ?? [], subsectors: bj.subsectors ?? [] };
    },
    retry: false,
  });
}

export default function PartnerTaxonomyAdmin() {
  const { toast } = useToast();
  const taxonomyQ = useAdminTaxonomy();
  const taxonomy = taxonomyQ.data ?? { sectors: [], subsectors: [] };

  const [sectorForm, setSectorForm] = useState({ slug: "", label: "" });
  const [subForm, setSubForm] = useState({
    slug: "",
    label: "",
    sectorSlug: "",
    requiresOtherText: false,
  });

  const grouped = useMemo(() => groupTaxonomy(taxonomy), [taxonomy]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TAXONOMY_KEY });

  async function call(method: string, url: string, body?: unknown) {
    const r = await apiRequest(method as any, url, body as any);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || `${method} ${url} failed`);
    return j;
  }

  const addSectorMut = useMutation({
    mutationFn: async () => {
      if (!sectorForm.slug.trim() || !sectorForm.label.trim()) {
        throw new Error("Slug and label are both required");
      }
      await call("POST", "/api/admin/partner-taxonomy/sectors", {
        slug: sectorForm.slug.trim(),
        label: sectorForm.label.trim(),
      });
    },
    onSuccess: () => {
      setSectorForm({ slug: "", label: "" });
      invalidate();
      toast({ title: "Sector added" });
    },
    onError: (e: any) =>
      toast({ title: "Add sector failed", description: e?.message, variant: "destructive" }),
  });

  const addSubMut = useMutation({
    mutationFn: async () => {
      if (!subForm.sectorSlug) throw new Error("Choose a sector");
      if (!subForm.slug.trim() || !subForm.label.trim()) {
        throw new Error("Slug and label are both required");
      }
      await call("POST", "/api/admin/partner-taxonomy/subsectors", {
        slug: subForm.slug.trim(),
        label: subForm.label.trim(),
        sectorSlug: subForm.sectorSlug,
        requiresOtherText: subForm.requiresOtherText,
      });
    },
    onSuccess: () => {
      setSubForm({ slug: "", label: "", sectorSlug: "", requiresOtherText: false });
      invalidate();
      toast({ title: "Sub-sector added" });
    },
    onError: (e: any) =>
      toast({ title: "Add sub-sector failed", description: e?.message, variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async (v: { kind: "sectors" | "subsectors"; slug: string; active: boolean }) => {
      if (v.active) {
        // Retire.
        await call("DELETE", `/api/admin/partner-taxonomy/${v.kind}/${encodeURIComponent(v.slug)}`);
      } else {
        // Reinstate.
        await call("PATCH", `/api/admin/partner-taxonomy/${v.kind}/${encodeURIComponent(v.slug)}`, {
          active: true,
        });
      }
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Taxonomy updated" });
    },
    onError: (e: any) =>
      toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  return (
    <>
      <PageHeader
        title="Partner Classification Taxonomy"
        description="The Sector // Sub-sector list offered by the partner classification selector. Adding or retiring a type here takes effect immediately — no migration and no deploy. Retiring keeps the type on partners who already hold it and on historical reports; it only stops being offered for new selections."
      />
      <PageBody>
        {taxonomyQ.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading taxonomy…</p>
        ) : taxonomyQ.isError ? (
          <p className="text-sm text-rose-600" data-testid="text-taxonomy-error">
            Could not load the taxonomy. Please retry.
          </p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 mb-6">
              <Card className="p-4" data-testid="card-add-sector">
                <div className="flex items-center gap-2 mb-3">
                  <Plus className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Add sector</h3>
                </div>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Slug</Label>
                    <Input
                      value={sectorForm.slug}
                      onChange={(e) => setSectorForm((f) => ({ ...f, slug: e.target.value }))}
                      placeholder="e.g. investment_capital"
                      className="h-9 text-sm font-mono"
                      data-testid="input-sector-slug"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Label</Label>
                    <Input
                      value={sectorForm.label}
                      onChange={(e) => setSectorForm((f) => ({ ...f, label: e.target.value }))}
                      placeholder="e.g. Investment Capital"
                      className="h-9 text-sm"
                      data-testid="input-sector-label"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => addSectorMut.mutate()}
                    disabled={addSectorMut.isPending}
                    data-testid="button-add-sector"
                  >
                    {addSectorMut.isPending ? "Adding…" : "Add sector"}
                  </Button>
                </div>
              </Card>

              <Card className="p-4" data-testid="card-add-subsector">
                <div className="flex items-center gap-2 mb-3">
                  <Plus className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold">Add sub-sector</h3>
                </div>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Sector</Label>
                    <Select
                      value={subForm.sectorSlug}
                      onValueChange={(v) => setSubForm((f) => ({ ...f, sectorSlug: v }))}
                    >
                      <SelectTrigger className="h-9 text-sm" data-testid="select-subsector-sector">
                        <SelectValue placeholder="Choose a sector" />
                      </SelectTrigger>
                      <SelectContent>
                        {taxonomy.sectors
                          .filter((s) => s.active !== false)
                          .map((s) => (
                            <SelectItem key={s.slug} value={s.slug}>{s.label}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Slug</Label>
                      <Input
                        value={subForm.slug}
                        onChange={(e) => setSubForm((f) => ({ ...f, slug: e.target.value }))}
                        placeholder="search_fund"
                        className="h-9 text-sm font-mono"
                        data-testid="input-subsector-slug"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={subForm.label}
                        onChange={(e) => setSubForm((f) => ({ ...f, label: e.target.value }))}
                        placeholder="Search Fund"
                        className="h-9 text-sm"
                        data-testid="input-subsector-label"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={subForm.requiresOtherText}
                      onChange={(e) =>
                        setSubForm((f) => ({ ...f, requiresOtherText: e.target.checked }))
                      }
                      data-testid="checkbox-requires-other-text"
                    />
                    Requires free-text description (like “Other”)
                  </label>
                  <Button
                    size="sm"
                    onClick={() => addSubMut.mutate()}
                    disabled={addSubMut.isPending}
                    data-testid="button-add-subsector"
                  >
                    {addSubMut.isPending ? "Adding…" : "Add sub-sector"}
                  </Button>
                </div>
              </Card>
            </div>

            {grouped.map((g) => (
              <Card className="p-4 mb-4" key={g.sector.slug} data-testid={`card-sector-${g.sector.slug}`}>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <Tags className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">{g.sector.label}</h3>
                    <span className="font-mono text-xs text-muted-foreground">{g.sector.slug}</span>
                    {g.sector.active === false && <Badge variant="outline">retired</Badge>}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      toggleMut.mutate({
                        kind: "sectors",
                        slug: g.sector.slug,
                        active: g.sector.active !== false,
                      })
                    }
                    disabled={toggleMut.isPending}
                    data-testid={`button-toggle-sector-${g.sector.slug}`}
                  >
                    {g.sector.active === false ? (
                      <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Reinstate</>
                    ) : (
                      <><Archive className="h-3.5 w-3.5 mr-1" /> Retire</>
                    )}
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sub-sector</TableHead>
                      <TableHead>Slug</TableHead>
                      <TableHead>Free text</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.subsectors.map((ss) => (
                      <TableRow key={ss.slug} data-testid={`row-subsector-${ss.slug}`}>
                        <TableCell className="text-sm">
                          {ss.label}
                          {ss.active === false && (
                            <Badge variant="outline" className="ml-2">retired</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{ss.slug}</TableCell>
                        <TableCell className="text-xs">
                          {ss.requiresOtherText ? "required" : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              toggleMut.mutate({
                                kind: "subsectors",
                                slug: ss.slug,
                                active: ss.active !== false,
                              })
                            }
                            disabled={toggleMut.isPending}
                            data-testid={`button-toggle-subsector-${ss.slug}`}
                          >
                            {ss.active === false ? "Reinstate" : "Retire"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            ))}
          </>
        )}
      </PageBody>
    </>
  );
}
