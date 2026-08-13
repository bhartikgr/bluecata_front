/**
 * WAVE 16 — ORP-044 (DEF-044): founder cap-table milestone broadcasts.
 *
 * WHAT WAS WRONG. `server/milestoneBroadcastStore.ts` implements a complete
 * segmented broadcast engine — schema (`:32`), recipient resolution from the
 * canonical cap-table commit ledger (`:109`), hash chain (`:91`), telemetry
 * `cap_table_broadcast_sent` (`:154`), a persistence write-through (`:66`) and a
 * boot hydrate (`:74`) — and it registers BOTH of its routes:
 *   GET  /api/founder/broadcasts  (`:183`)
 *   POST /api/founder/broadcasts  (`:196`)
 * registered for real at `server/routes.ts:1271`. VERIFIED AT SOURCE: a
 * tree-wide search for `founder/broadcasts` outside that one server file returns
 * NOTHING. So the telemetry event named in the spec row could only ever fire from
 * a direct HTTP call — no founder could send a broadcast, and no founder could
 * read one they had somehow sent. This is WIRING: nothing server-side was added,
 * renamed or re-routed for this item.
 *
 * WHY HERE. Recipients are resolved as the distinct investors on the company's
 * COMMITTED cap table (`listMembersForCompany`, `:111`). The audience of this
 * feature is therefore literally the table this page renders, so the control
 * belongs on `/founder/captable` next to it rather than in a generic comms page.
 *
 * HONESTY ABOUT THE SEGMENT FIELD — owner rule "never silently drop
 * functionality", inverted. `resolveRecipients` takes `segmentKind` and
 * `segmentValue` and then IGNORES both: its own comment at `:104` says segment
 * filters "fall through to all" because the stage/region/series metadata lives on
 * the investor profile and is not indexed there. The field is real (validated,
 * stored, hash-chained, and emitted in telemetry), so it is offered — but the
 * panel states plainly that delivery currently reaches every committed investor
 * regardless of the segment chosen. Rendering a segment picker that silently
 * implied narrower delivery would be the more dangerous option: a founder would
 * believe a message went to one region when it went to all of them.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

/** Mirrors `SEGMENT_KINDS` (server/milestoneBroadcastStore.ts:29) verbatim. */
export const BROADCAST_SEGMENT_KINDS = [
  { key: "all", label: "All investors on the cap table" },
  { key: "by_stage", label: "By stage" },
  { key: "by_region", label: "By region" },
  { key: "by_series", label: "By series" },
  { key: "by_ownership_tier", label: "By ownership tier" },
] as const;

type SegmentKind = (typeof BROADCAST_SEGMENT_KINDS)[number]["key"];

/** `broadcastCreateSchema` caps the body at 500 chars (`:36`). Enforced here too. */
export const BROADCAST_BODY_MAX = 500;

/** Mirrors `MilestoneBroadcast` (server/milestoneBroadcastStore.ts:39). */
interface Broadcast {
  id: string;
  companyId: string;
  founderUserId: string;
  segmentKind: SegmentKind;
  segmentValue?: string;
  body: string;
  trigger: "manual" | "round_closed" | "governance_metric_published" | "ma_initiative_started";
  recipientUserIds: string[];
  /** ORP-044 — real delivered count; absent on records sent before delivery existed. */
  deliveredInApp?: number;
  ts: string;
}

const TRIGGER_LABEL: Record<Broadcast["trigger"], string> = {
  manual: "Sent manually",
  round_closed: "Auto — round closed",
  governance_metric_published: "Auto — governance metric published",
  ma_initiative_started: "Auto — M&A initiative started",
};

function segmentLabel(kind: SegmentKind, value?: string): string {
  const base = BROADCAST_SEGMENT_KINDS.find((s) => s.key === kind)?.label ?? kind;
  return value ? `${base}: ${value}` : base;
}

export function MilestoneBroadcastPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [segmentKind, setSegmentKind] = useState<SegmentKind>("all");
  const [segmentValue, setSegmentValue] = useState("");
  const [body, setBody] = useState("");

  const listQ = useQuery<{ items: Broadcast[] }>({
    queryKey: ["/api/founder/broadcasts", companyId],
    enabled: Boolean(companyId),
    queryFn: async () =>
      (await apiRequest("GET", `/api/founder/broadcasts?companyId=${encodeURIComponent(companyId)}`)).json(),
  });

  const send = useMutation({
    mutationFn: async (): Promise<Broadcast> => {
      const res = await apiRequest("POST", "/api/founder/broadcasts", {
        companyId,
        segmentKind,
        /* The server's zod field is OPTIONAL, not nullable (`:35`): sending an
           explicit null would fail validation, so an empty box omits the key. */
        ...(segmentKind !== "all" && segmentValue.trim() ? { segmentValue: segmentValue.trim() } : {}),
        body: body.trim(),
        trigger: "manual",
      });
      return res.json();
    },
    onSuccess: (bc) => {
      setBody("");
      setSegmentValue("");
      qc.invalidateQueries({ queryKey: ["/api/founder/broadcasts", companyId] });
      toast({
        title: "Milestone broadcast sent",
        description: `${bc.deliveredInApp ?? 0} of ${bc.recipientUserIds.length} investor${bc.recipientUserIds.length === 1 ? "" : "s"} on the cap table were notified.`,
      });
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Could not send the broadcast", description: e.message }),
  });

  const remaining = BROADCAST_BODY_MAX - body.length;
  const canSend = Boolean(companyId) && body.trim().length > 0 && remaining >= 0 && !send.isPending;
  const items = listQ.data?.items ?? [];

  if (!companyId) return null;

  return (
    <Card className="mb-6" data-testid="card-milestone-broadcast">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Milestone broadcast to your investors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {/* Accurate to the engine as it stands: in-app notifications are delivered
            (server/milestoneBroadcastStore.ts deliverBroadcast → notificationsStore
            emitNotification, kind cap_table.broadcast); the email half of the
            original design has no template in the tree, so it is NOT promised. */}
        <p className="text-muted-foreground" data-testid="broadcast-audience-note">
          Delivered as an in-app notification to every investor holding a committed position on this
          cap table. Email delivery is not enabled for milestone broadcasts yet.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="bc-segment">Audience</Label>
            <select
              id="bc-segment"
              data-testid="broadcast-segment"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
              value={segmentKind}
              onChange={(e) => setSegmentKind(e.target.value as SegmentKind)}
            >
              {BROADCAST_SEGMENT_KINDS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {segmentKind !== "all" && (
            <div>
              <Label htmlFor="bc-segment-value">Segment value (optional)</Label>
              <Input
                id="bc-segment-value"
                className="mt-1"
                data-testid="broadcast-segment-value"
                value={segmentValue}
                onChange={(e) => setSegmentValue(e.target.value)}
                placeholder="e.g. Seed, EMEA, Series A"
              />
            </div>
          )}
        </div>

        {/* The delivery caveat is a SIBLING element, never text appended inside an
            existing node, so the copy guard reads it as one addition. */}
        {segmentKind !== "all" && (
          <p className="text-amber-700" data-testid="broadcast-segment-caveat">
            Segment is recorded on the broadcast for your audit trail, but delivery currently reaches
            every committed investor on this cap table — investor stage, region and series are not yet
            indexed for filtering. Choose “All investors” if that is what you intend.
          </p>
        )}

        <div>
          <Label htmlFor="bc-body">Message</Label>
          <Textarea
            id="bc-body"
            className="mt-1"
            rows={3}
            data-testid="broadcast-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Round closed at $4.2M — thank you for backing us."
          />
          <div
            className={remaining < 0 ? "mt-1 text-rose-600" : "mt-1 text-muted-foreground"}
            data-testid="broadcast-remaining"
          >
            {remaining} character{remaining === 1 || remaining === -1 ? "" : "s"} remaining
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button size="sm" data-testid="broadcast-send" disabled={!canSend} onClick={() => send.mutate()}>
            {send.isPending ? "Sending…" : "Send broadcast"}
          </Button>
          {send.isError && (
            <span className="text-rose-600" data-testid="broadcast-error">
              {(send.error as Error).message}
            </span>
          )}
        </div>

        <div className="pt-2">
          <div className="mb-1 font-medium">Sent broadcasts</div>
          {items.length === 0 ? (
            <div className="text-muted-foreground" data-testid="broadcast-history-empty">
              No milestone broadcasts have been sent for this company yet.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="broadcast-history">
              {items.map((bc) => (
                <li key={bc.id} className="rounded-md border border-border p-2" data-testid={`broadcast-row-${bc.id}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{new Date(bc.ts).toLocaleString()}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {segmentLabel(bc.segmentKind, bc.segmentValue)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {TRIGGER_LABEL[bc.trigger] ?? bc.trigger}
                    </Badge>
                    <span className="text-muted-foreground" data-testid={`broadcast-recipients-${bc.id}`}>
                      {bc.recipientUserIds.length} recipient{bc.recipientUserIds.length === 1 ? "" : "s"}
                    </span>
                    {/* Sibling, not appended text: shows the DELIVERED count, and says
                        plainly when a record predates delivery instead of implying it. */}
                    <span className="text-muted-foreground" data-testid={`broadcast-delivered-${bc.id}`}>
                      {typeof bc.deliveredInApp === "number"
                        ? `${bc.deliveredInApp} notified`
                        : "delivery not recorded"}
                    </span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{bc.body}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default MilestoneBroadcastPanel;
