/**
 * WAVE 56 — ADMIN SURFACE FOR THE PARTNER TIER CATALOGUE (R21 / R36 / 56-Q9).
 *
 * Before this panel there was no way to add a partner tier from anywhere in the
 * product. Every tier picker in the client carried its own compiled-in list of
 * five slugs, and the four plausible create endpoints all returned 404. This is
 * the surface for the write path added in server/partnerTierAdminRoutes.ts.
 *
 * WHAT IT DELIBERATELY SHOWS
 *   • Every tier, INCLUDING archived ones, read from partner_tier_lifecycle.
 *     Nothing is hidden: an archived tier still resolves on historical invoices,
 *     so an admin has to be able to see it.
 *   • "Still needed" per tier — no price, no commission rate, unset capability
 *     limits — because a freshly created tier is NOT ready to sell and a screen
 *     that implies otherwise is how a tier ends up advertised at a price the
 *     charge path refuses.
 *   • Rank, which decides which gated features open. It is required at creation
 *     because an absent rank silently denies everything with no error.
 *
 * NO DELETE BUTTON. The database refuses a tier delete outright; archive is the
 * reversible equivalent and is what this panel offers.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Layers, Plus, Snowflake, Archive, RotateCcw } from "lucide-react";

export type AdminTierRow = {
  slug: string;
  label: string;
  state: "active" | "frozen" | "archived";
  rank: number | null;
  stateReason: string | null;
  stateChangedAt: string | null;
  stateChangedBy: string | null;
  unresolved?: string[];
};

const TIERS_KEY = "/api/admin/partner-tiers";

export function PartnerTierLifecycleAdmin() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [rank, setRank] = useState("");
  const [reasonBySlug, setReasonBySlug] = useState<Record<string, string>>({});

  const tiersQ = useQuery<{ ok: boolean; tiers: AdminTierRow[] }>({
    queryKey: [TIERS_KEY],
    queryFn: async () => (await apiRequest("GET", TIERS_KEY)).json(),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [TIERS_KEY] });
    // Every other surface reads the same catalogue; refresh the pricing and
    // commission views too so they cannot disagree with this screen.
    qc.invalidateQueries({ queryKey: ["/api/consortium/pricing"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/partner/commission-rates"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/partner-billing/tier-prices"] });
  };

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", TIERS_KEY, {
          slug: slug.trim().toLowerCase(),
          label: label.trim(),
          rank: Number(rank),
        })
      ).json(),
    onSuccess: (data: { tier?: AdminTierRow; unresolved?: string[] }) => {
      setSlug("");
      setLabel("");
      setRank("");
      refresh();
      toast({
        title: `Tier "${data?.tier?.label ?? "created"}" added`,
        description:
          (data?.unresolved ?? []).length > 0
            ? `Still needed: ${(data?.unresolved ?? []).length} item(s) — see the row below.`
            : undefined,
      });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not add the tier", description: e.message }),
  });

  const transition = useMutation({
    mutationFn: async (args: { slug: string; action: "freeze" | "archive" | "activate" }) =>
      (
        await apiRequest(
          "POST",
          `${TIERS_KEY}/${encodeURIComponent(args.slug)}/${args.action}`,
          args.action === "activate" ? {} : { reason: reasonBySlug[args.slug] ?? "" },
        )
      ).json(),
    onSuccess: () => {
      refresh();
      toast({ title: "Tier state updated" });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not change the tier state", description: e.message }),
  });

  const rows = tiersQ.data?.tiers ?? [];

  return (
    <Card className="p-5 mb-6" data-testid="admin-partner-tier-lifecycle">
      <div className="flex items-center gap-2 mb-1">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Partner tiers</h3>
        <Badge variant="outline" className="ml-auto text-[10px]" data-testid="badge-tier-count">
          {rows.length} tier{rows.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        The tier list every surface reads. A tier is never deleted — archive it instead, so historical
        invoices, subscriptions and commission rates still resolve. A new tier needs a price and a
        commission rate before it can be sold or paid on; until then it is refused rather than guessed.
      </p>

      {/* ── Add a tier ─────────────────────────────────────────── */}
      <div className="rounded-md border p-3 mb-5" data-testid="panel-add-partner-tier">
        <div className="flex items-center gap-2 mb-2">
          <Plus className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase text-muted-foreground">Add a tier</span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Input
            placeholder="slug (e.g. bridge)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="max-w-[180px]"
            data-testid="input-new-tier-slug"
          />
          <Input
            placeholder="Display name (e.g. Bridge)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="max-w-[220px]"
            data-testid="input-new-tier-label"
          />
          <Input
            placeholder="Rank (1 = most junior)"
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            className="max-w-[180px]"
            data-testid="input-new-tier-rank"
          />
          <Button
            size="sm"
            disabled={!slug.trim() || !label.trim() || !rank.trim() || create.isPending}
            onClick={() => create.mutate()}
            data-testid="button-create-partner-tier"
          >
            Add tier
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Rank decides which gated features open (white-label, for example). It is required, because a
          tier with no rank is silently denied every gated feature with no error shown anywhere.
        </p>
      </div>

      {/* ── The catalogue ──────────────────────────────────────── */}
      {tiersQ.isPending ? (
        <div className="text-sm text-muted-foreground" data-testid="text-tiers-loading">
          Loading tiers…
        </div>
      ) : tiersQ.isError ? (
        <div className="text-sm text-destructive" data-testid="text-tiers-error">
          The tier catalogue could not be read. Nothing has been changed.
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground" data-testid="text-tiers-empty">
          No tiers are recorded. That is not a display problem — the catalogue is genuinely empty.
        </div>
      ) : (
        <div className="space-y-3" data-testid="list-partner-tiers">
          {rows.map((t) => (
            <div key={t.slug} className="rounded-md border p-3" data-testid={`row-tier-${t.slug}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm" data-testid={`text-tier-label-${t.slug}`}>
                  {t.label}
                </span>
                <code className="text-[11px] text-muted-foreground">{t.slug}</code>
                <Badge
                  /* WAVE 101 - active tier chip was brand red. Colour only. */
                  variant={t.state === "active" ? "positive" : "outline"}
                  className="text-[10px]"
                  data-testid={`badge-tier-state-${t.slug}`}
                >
                  {t.state}
                </Badge>
                <span className="text-[11px] text-muted-foreground" data-testid={`text-tier-rank-${t.slug}`}>
                  rank {t.rank === null ? "not set" : t.rank}
                </span>
                {t.stateReason ? (
                  <span className="text-[11px] text-muted-foreground">· {t.stateReason}</span>
                ) : null}
              </div>

              {(t.unresolved ?? []).length > 0 ? (
                <ul className="mt-2 text-[11px] text-muted-foreground list-disc pl-4" data-testid={`list-tier-unresolved-${t.slug}`}>
                  {(t.unresolved ?? []).map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              ) : null}

              <div className="flex gap-2 flex-wrap items-center mt-3">
                <Input
                  placeholder="Reason (required to freeze or archive)"
                  value={reasonBySlug[t.slug] ?? ""}
                  onChange={(e) => setReasonBySlug({ ...reasonBySlug, [t.slug]: e.target.value })}
                  className="max-w-sm"
                  data-testid={`input-tier-reason-${t.slug}`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={transition.isPending || t.state === "frozen"}
                  onClick={() => transition.mutate({ slug: t.slug, action: "freeze" })}
                  data-testid={`button-tier-freeze-${t.slug}`}
                >
                  <Snowflake className="h-3 w-3 mr-1" />
                  Freeze
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={transition.isPending || t.state === "archived"}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Archive "${t.label}"? It disappears from every catalogue but stays resolvable for historical invoices. It is not deleted.`,
                      )
                    )
                      transition.mutate({ slug: t.slug, action: "archive" });
                  }}
                  data-testid={`button-tier-archive-${t.slug}`}
                >
                  <Archive className="h-3 w-3 mr-1" />
                  Archive
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={transition.isPending || t.state === "active"}
                  onClick={() => transition.mutate({ slug: t.slug, action: "activate" })}
                  data-testid={`button-tier-activate-${t.slug}`}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Make active
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
