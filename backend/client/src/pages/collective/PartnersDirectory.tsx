/**
 * v25.42 R8 — /collective/partners (member-facing)
 *
 * Reads the NEW endpoint GET /api/collective/partners/public, which returns
 * ONLY public partner-card fields (economics redacted server-side). Renders a
 * card grid: name, governance, HQ, member count, AUM band, sectors. The
 * endpoint fails closed with 503 on DB error — we surface that as a friendly
 * "temporarily unavailable" state. Loading / error / empty states handled.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";

interface PartnerCard {
  id: string;
  name: string;
  logoUrl?: string | null;
  governance?: string | null;
  hq?: string | null;
  memberCount?: number | null;
  aumUsd?: string | number | null;
  sectors?: string[];
}
interface PartnersResponse {
  count?: number;
  total?: number;
  items?: PartnerCard[];
}

export default function PartnersDirectory() {
  const { data, isLoading, error } = useQuery<PartnersResponse>({
    queryKey: ["/api/collective/partners/public"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/partners/public")).json(),
    retry: false,
    staleTime: 30_000,
  });

  const unavailable =
    error instanceof ApiError && (error as ApiError).status === 503;
  const items = data?.items ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-partners">
          Partners
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Consortium partners in the Capavate network.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="partners-loading">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : unavailable ? (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800" data-testid="partners-unavailable">
          The public partners directory is temporarily unavailable. Please try again shortly.
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="partners-error">
          Couldn't load partners. Please refresh.
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500" data-testid="partners-empty">
          <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No partners listed yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="partners-list">
          {items.map((p) => (
            <Card key={p.id} data-testid={`partner-card-${p.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
                  {p.logoUrl ? (
                    <img src={p.logoUrl} alt="" className="w-6 h-6 rounded object-contain" />
                  ) : (
                    <span className="w-6 h-6 rounded bg-[#cc0001]/15 text-[#cc0001] flex items-center justify-center text-[10px] font-bold">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {p.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {p.governance && (
                    <Badge className="text-[10px] bg-slate-100 text-slate-600">{p.governance}</Badge>
                  )}
                  {p.hq && (
                    <Badge className="text-[10px] bg-slate-100 text-slate-600">{p.hq}</Badge>
                  )}
                  {p.aumUsd != null && p.aumUsd !== "" && (
                    <Badge className="text-[10px] bg-emerald-100 text-emerald-700">AUM {String(p.aumUsd)}</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{p.memberCount != null ? `${p.memberCount} members` : ""}</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {(p.sectors ?? []).slice(0, 3).map((s) => (
                      <Badge key={s} className="text-[10px] bg-slate-100 text-slate-600">{s}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
