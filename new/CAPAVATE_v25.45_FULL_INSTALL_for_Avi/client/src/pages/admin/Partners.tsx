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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Users, CheckCircle2, Circle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return "—"; }
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
  const [q, setQ] = useState("");

  const qs = new URLSearchParams();
  if (statusFilter !== "all") qs.set("status", statusFilter);
  if (q.trim()) qs.set("q", q.trim());

  const { data, isLoading, error } = useQuery<{ ok: boolean; partners: PartnerRow[]; total: number }>({
    queryKey: ["/api/admin/partners", statusFilter, q.trim()],
    queryFn: async () => (await apiRequest("GET", `/api/admin/partners?${qs.toString()}`)).json(),
    retry: false,
  });

  const partners = data?.partners ?? [];

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
                        <Badge variant={p.status === "active" ? "default" : "outline"}>{p.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <YesNo on={!!p.subscriptionId} label="Subscribed" />
                          <YesNo on={!!p.agreementSignedAt} label="Agreement" />
                          <YesNo on={!!p.taxFormCollectedAt} label="Tax form" />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.commissionOverridePct === null || p.commissionOverridePct === undefined
                          ? <span className="text-muted-foreground">tier default</span>
                          : `${p.commissionOverridePct}%`}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(p.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
