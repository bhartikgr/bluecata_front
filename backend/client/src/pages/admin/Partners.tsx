/* v25.33 Consortium Partner Payment Model — DB-driven, no in-memory.
 * /admin/partners — admin roster of consortium partners. Reads the partner list
 * DB-direct via GET /api/admin/partners (contacts WHERE kind='consortium_partner').
 * Tier, subscription, agreement, and tax-form status all come from the DB row;
 * nothing on this page is hardcoded. Links through to the existing per-partner
 * detail page at /admin/partners/:id.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
/* WAVE 24 · ITEM 2 — AD-4 lifecycle funnel metrics (previously no UI caller). */
import { PartnerFunnelMetricsPanel } from "@/components/admin/PartnerFunnelMetricsPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Users, CheckCircle2, Circle, Download, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
/* WAVE 3A (P-3) — shared fraction→percent display helper. */
import { formatFractionAsPercent } from "@/lib/percentDisplay";
/* WAVE 4B (PT-4) — `Sector // Sub-sector` on the roster, plus a sector filter
   that matches ANY classification a partner holds (owner ruling), so a hybrid
   is found under every sector it holds rather than only its primary. The
   classification card below the roster lists every entry a partner holds;
   single-value contexts elsewhere (detail summary line, CSV primary column)
   use the PRIMARY. See the comment on that card for why it is a card and
   not a 7th roster column. */
import {
  ClassificationChips,
  usePartnerTaxonomy,
} from "@/components/partner/PartnerClassificationSelect";
import {
  type PartnerClassificationDto,
} from "@shared/partnerClassification";
import { fmtLocaleDate } from "@/lib/format"; /* WAVE 87 · ITEM 1 */

interface PartnerRow {
  id: string;
  name: string;
  email: string | null;
  status: string;
  tier: string | null;
  subscriptionId: string | null;
  taxFormCollectedAt: string | null;
  agreementVersion: string | null;
  agreementSignedAt: string | null;
  commissionOverridePct: number | null;
  createdAt: string | null;
}

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "suspended", label: "Suspended" },
];

/* WAVE 87 · ITEM 1 — THIS LOCAL HELPER SHADOWED THE SAFE ONE.
   Twelve files define their own `fmtDate`/`formatIsoDate` whose body is the
   exact defect reviewer 1 reported: `new Date("2026-06-15")` parses as UTC
   midnight, so any local-time reader prints ONE DAY EARLY west of UTC (the
   owner is in New York). Only the BODY changes — every call site is untouched,
   so a timestamp renders byte-identically and nothing is restyled, while a
   date-only value now renders the day that was entered. */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return fmtLocaleDate(iso); } catch { return "—"; }
}

function YesNo({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="inline-flex items-center gap-1 text-emerald-600 text-xs" title={label}>
      <CheckCircle2 className="h-3.5 w-3.5" /> {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground text-xs" title={`No ${label}`}>
      <Circle className="h-3.5 w-3.5" /> {label}
    </span>
  );
}

export default function Partners() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [q, setQ] = useState("");

  const qs = new URLSearchParams();
  if (statusFilter !== "all") qs.set("status", statusFilter);
  if (q.trim()) qs.set("q", q.trim());

  const { data, isLoading, error } = useQuery<{ ok: boolean; partners: PartnerRow[]; total: number }>({
    queryKey: ["/api/admin/partners", statusFilter, q.trim()],
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners?${qs.toString()}`)).json(),
    retry: false,
  });

  const allPartners = data?.partners ?? [];

  /* WAVE 4B (PT-4) — classifications for the visible page in ONE request
     rather than one per row. DB-driven; the sector list comes from the
     taxonomy endpoint, never from a hardcoded client array. */
  const taxonomyQ = usePartnerTaxonomy();
  const partnerIds = allPartners.map((p) => p.id);
  const classificationsQ = useQuery<{
    ok: boolean;
    byPartner: Record<string, PartnerClassificationDto[]>;
  }>({
    queryKey: ["/api/admin/partner-classifications", partnerIds.join(",")],
    enabled: partnerIds.length > 0,
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/admin/partner-classifications?partnerIds=${encodeURIComponent(partnerIds.join(","))}`,
        )
      ).json(),
    retry: false,
  });
  const byPartner = classificationsQ.data?.byPartner ?? {};

  /* Filters match ANY classification — deliberately not `.isPrimary`. */
  const partners =
    sectorFilter === "all"
      ? allPartners
      : allPartners.filter((p) =>
          (byPartner[p.id] ?? []).some((c) => c.sectorSlug === sectorFilter),
        );

  function exportCsv() {
    if (partners.length === 0) return;
    const ids = partners.map((p) => p.id).join(",");
    window.open(
      `/api/admin/partner-classifications/export.csv?partnerIds=${encodeURIComponent(ids)}`,
      "_blank",
    );
  }

  return (
    <>
      <PageHeader
        title="Consortium Partners"
        description="Roster of all consortium partners (contacts of kind=consortium_partner). Tier, subscription, signed agreement, and tax-form status are read directly from the database. Click a partner to open their detail page."
      />
      <PageBody>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or email…"
            className="w-72"
            data-testid="input-partner-search"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48" data-testid="select-partner-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* WAVE 4B (PT-4) — sector filter. Options are DB-driven. */}
          <Select value={sectorFilter} onValueChange={setSectorFilter}>
            <SelectTrigger className="w-64" data-testid="select-partner-sector">
              <SelectValue placeholder="All sectors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sectors</SelectItem>
              {(taxonomyQ.data?.sectors ?? []).map((s) => (
                <SelectItem key={s.slug} value={s.slug}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={partners.length === 0}
            data-testid="button-export-classifications"
          >
            <Download className="h-3.5 w-3.5 mr-1" /> Export classifications
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-[#041e41]" /> Partners ({data?.total ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground" data-testid="text-partners-loading">Loading partner roster…</p>
            ) : error ? (
              <p className="text-sm text-rose-600" data-testid="text-partners-error">Could not load partners. Please retry.</p>
            ) : partners.length === 0 ? (
              <div className="text-center py-10" data-testid="empty-partners">
                <Users className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  No consortium partners match this filter. Approved consortium applications become partner records here.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Onboarding</TableHead>
                    <TableHead>Commission override</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {partners.map((p) => (
                    <TableRow key={p.id} data-testid={`row-partner-${p.id}`}>
                      <TableCell>
                        <Link
                          href={`/admin/partners/${p.id}`}
                          className="font-medium text-[#cc0001] hover:underline"
                          data-testid={`link-partner-${p.id}`}
                        >
                          {p.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{p.email || "—"}</div>
                      </TableCell>
                      <TableCell>
                        {p.tier ? <Badge variant="secondary">{p.tier}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.status === "active" ? "positive" : "outline"}>{p.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <YesNo on={!!p.subscriptionId} label="Subscribed" />
                          <YesNo on={!!p.agreementSignedAt} label="Agreement" />
                          <YesNo on={!!p.taxFormCollectedAt} label="Tax form" />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {/* WAVE 3A (P-3, DEF-008) — `commission_override_pct` is
                            stored as a FRACTION (0.12 = 12%); PartnerDetail.tsx
                            already writes it that way (:274 `pct / 100`) and
                            seeds its editor from it (:242 `* 100`). This roster
                            cell printed the bare fraction with a % sign, so a
                            12% override read "0.12%". Display-only fix; the
                            stored value is unchanged. */}
                        {p.commissionOverridePct === null || p.commissionOverridePct === undefined
                          ? <span className="text-muted-foreground">tier default</span>
                          : formatFractionAsPercent(p.commissionOverridePct)}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(p.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* WAVE 4B (PT-4) — classification on the partner LIST.

            This lives in its own card rather than as a 7th column in the
            roster table above. That is not a cosmetic preference: the
            silent-drop guard fingerprints the roster table by its header
            text and per-row cell count, so adding a column makes the entire
            existing table read to the guard as REMOVED. The only way to add
            the column is an allowlist entry — i.e. permanently silencing a
            real detector on the partner roster in order to accommodate an
            addition, and doing so under a fabricated owner approval. This
            card carries the same information (primary, plus every hybrid
            entry) and leaves the detector intact. Flagged for an owner
            decision in WAVE4B_REPORT.md.

            It honours the same filter as the table above, so what is listed
            here is exactly what is listed there. */}
        <Card className="mt-4" data-testid="card-partner-classifications">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Tags className="h-4 w-4 text-[#041e41]" /> Classification ({partners.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {classificationsQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading classifications…</p>
            ) : partners.length === 0 ? (
              <p className="text-sm text-muted-foreground">No partners in view.</p>
            ) : (
              <ul className="divide-y">
                {partners.map((p) => {
                  const rows = byPartner[p.id] ?? [];
                  return (
                    <li
                      key={p.id}
                      className="flex items-start justify-between gap-4 py-2"
                      data-testid={`classification-row-${p.id}`}
                    >
                      <Link
                        href={`/admin/partners/${p.id}`}
                        className="text-sm text-[#041e41] hover:underline shrink-0"
                      >
                        {p.name}
                      </Link>
                      {rows.length === 0 ? (
                        /* Grandfathered: unclassified, NOT defaulted to "other". */
                        <span className="text-xs text-muted-foreground">Unclassified</span>
                      ) : (
                        <ClassificationChips classifications={rows} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* WAVE 24 · ITEM 2 — AD-4. `GET /api/admin/partners/metrics/funnel` had
            zero client callers. Mounted as a SIBLING card on the page that
            already renders the roster these counts describe, so the badge and
            the list cannot disagree. */}
        <PartnerFunnelMetricsPanel />
      </PageBody>
    </>
  );
}
