/**
 * client/src/components/admin/Wave206BridgeDeliveryPanel.tsx — WAVE 206 · R182.2.
 *
 * "push to live. I want it working and fully dynamic."
 * "Do not break anything or dramatically make assumptions to change things."
 *
 * WHAT THIS SCREEN IS FOR
 * ----------------------
 * The bridge's configuration used to live only in host environment variables,
 * which meant the owner could not change it without his developer. This panel is
 * where he changes it himself, and — just as importantly — where he can read
 * WHICH value is in force and WHERE IT CAME FROM for every setting.
 *
 * TWO RULES THIS COMPONENT ENFORCES
 * --------------------------------
 * 1. NO SECRET IS EVER SHOWN. The server never sends one. This panel shows only
 *    whether a signing secret is set, and the environment-variable names to set
 *    it in. There is no input for a secret, because storing one in the database
 *    would be a permanent exposure.
 * 2. DRY RUN IS THE DEFAULT. "Preview" asks the server what a drain would do and
 *    sends nothing. Sending requires the separate, clearly-labelled confirm
 *    action. Turning delivery on does NOT send the queued events.
 *
 * It is a NEW file so that no existing copy, tab, button or panel identity in
 * client/src/pages/admin/Bridge.tsx is renamed or renumbered — the guard
 * fingerprints source text.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Radio, ShieldAlert, Eye } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ResolvedField<T> = {
  value: T;
  source: "database" | "environment" | "default";
  envVarNames: string[];
  dbVersion: number | null;
  precedence: string;
};

type DeliveryConfigResp = {
  ok: boolean;
  config: {
    deliveryEnabled: ResolvedField<boolean>;
    receiverUrl: ResolvedField<string>;
    drainBatchLimit: ResolvedField<number>;
    secret: {
      configured: boolean;
      placeholder: boolean;
      source: string;
      envVarNames: string[];
      statement: string;
    };
    mayDeliver: boolean;
    mayDeliverReason: string;
    envFindings: Array<{ severity: string; code: string; message: string }>;
    envOk: boolean;
    envOutboundConfigured: boolean;
    workerNote: string;
  };
  census: {
    total: number;
    queued: number;
    deadLettered: number;
    queuedWithDestination: number;
    queuedRefusedByFence: number;
    queuedWithoutDestination: number;
    byType: Array<{
      eventType: string;
      queued: number;
      hasDestination: boolean;
      kind: string;
      handler: string | null;
      reason: string;
      fenced: boolean;
      unknownType: boolean;
    }>;
    statement: string;
  };
  expectedReceiverPath: string;
  batchLimitRange: { min: number; max: number };
};

type DrainResp = {
  ok: boolean;
  dryRun: boolean;
  attempted: number;
  delivered: number;
  deadLettered: number;
  refused: number;
  statement: string;
  plan: {
    limit: number;
    targetHost: string | null;
    targetPath: string | null;
    targetSource: string;
    mayDeliver: boolean;
    mayDeliverReason: string;
    eligibleQueued: number;
    selectedDeliverable: number;
    selectedRefused: number;
    heldBackByLimit: number;
    statement: string;
    selected: Array<{
      eventId: string;
      eventType: string;
      wouldDeliver: boolean;
      refusalReason: string | null;
      fenced: boolean;
    }>;
  };
};

const SOURCE_WORDS: Record<string, string> = {
  database: "set here, in the database",
  environment: "from the host environment",
  default: "built-in default",
};

function SourceBadge({ source }: { source: string }) {
  return (
    <Badge variant={source === "database" ? "default" : "outline"} className="text-[10px]">
      {SOURCE_WORDS[source] ?? source}
    </Badge>
  );
}

export function Wave206BridgeDeliveryPanel() {
  const qc = useQueryClient();
  const cfg = useQuery<DeliveryConfigResp>({ queryKey: ["/api/admin/bridge/delivery-config"] });
  const [urlDraft, setUrlDraft] = useState("");
  const [limitDraft, setLimitDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [drain, setDrain] = useState<DrainResp | null>(null);
  const [busy, setBusy] = useState(false);

  const config = cfg.data?.config;
  const census = cfg.data?.census;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["/api/admin/bridge/delivery-config"] });
    qc.invalidateQueries({ queryKey: ["/api/admin/bridge/outbox"] });
  };

  const save = async (key: string, value: unknown) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiRequest("POST", "/api/admin/bridge/delivery-config", { key, value });
      const body = (await res.json()) as { ok?: boolean; error?: string; statement?: string };
      setMessage(body.ok ? (body.statement ?? "Saved.") : (body.error ?? "That change was refused."));
      refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runDrain = async (confirm: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiRequest("POST", "/api/admin/bridge/backlog-drain", { confirm });
      const body = (await res.json()) as DrainResp;
      setDrain(body);
      if (confirm) refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 mb-5" data-testid="card-wave206-bridge-delivery">
      <div className="flex items-center gap-2 mb-1">
        <Radio className="h-4 w-4 text-muted-foreground" />
        <div className="text-sm font-semibold">Collective delivery — settings and the waiting queue</div>
        {config ? (
          <Badge
            variant={config.mayDeliver ? "default" : "outline"}
            className="text-[10px]"
            data-testid="badge-wave206-may-deliver"
          >
            {config.mayDeliver ? "ready to send when you ask" : "not sending"}
          </Badge>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground mb-3" data-testid="text-wave206-worker-note">
        {config?.workerNote ??
          "Turning delivery on here does not start the background sender and does not send the queued events."}
      </div>

      {config ? (
        <div className="text-xs mb-3" data-testid="text-wave206-may-deliver-reason">
          {config.mayDeliverReason}
        </div>
      ) : null}

      {/* ---- Setting 1: delivery on or off ---- */}
      <div className="border-t border-border pt-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs font-medium">Delivery</div>
          {config ? <SourceBadge source={config.deliveryEnabled.source} /> : null}
          <Badge variant="outline" className="text-[10px]" data-testid="badge-wave206-delivery-state">
            {config?.deliveryEnabled.value ? "on" : "off"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !config}
            onClick={() => save("collective.bridge.delivery_enabled", !(config?.deliveryEnabled.value ?? false))}
            data-testid="button-wave206-toggle-delivery"
          >
            {config?.deliveryEnabled.value ? "Turn delivery off" : "Turn delivery on"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || config?.deliveryEnabled.source !== "database"}
            onClick={() => save("collective.bridge.delivery_enabled", "unset")}
            data-testid="button-wave206-unset-delivery"
          >
            Use the host environment instead
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground mt-1" data-testid="text-wave206-delivery-precedence">
          {config?.deliveryEnabled.precedence ?? ""}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">
          Falls back to: {(config?.deliveryEnabled.envVarNames ?? []).join(", ")}
        </div>
      </div>

      {/* ---- Setting 2: where deliveries go ---- */}
      <div className="border-t border-border pt-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs font-medium">Collective receiver address</div>
          {config ? <SourceBadge source={config.receiverUrl.source} /> : null}
        </div>
        <div className="text-[11px] font-mono mt-1 break-all" data-testid="text-wave206-receiver-url">
          {config?.receiverUrl.value || "not set"}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder={`must end with ${cfg.data?.expectedReceiverPath ?? "the real receiver path"}`}
            className="h-8 text-xs"
            data-testid="input-wave206-receiver-url"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => save("collective.bridge.receiver_url", urlDraft)}
            data-testid="button-wave206-save-receiver-url"
          >
            Save address
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || config?.receiverUrl.source !== "database"}
            onClick={() => save("collective.bridge.receiver_url", "unset")}
            data-testid="button-wave206-unset-receiver-url"
          >
            Use the host address instead
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground mt-1" data-testid="text-wave206-url-precedence">
          {config?.receiverUrl.precedence ?? ""}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">
          Falls back to: {(config?.receiverUrl.envVarNames ?? []).join(", ")}
        </div>
      </div>

      {/* ---- The signing secret: presence only, never the value ---- */}
      <div className="border-t border-border pt-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs font-medium">Signing secret</div>
          <Badge
            variant={config?.secret.configured ? "default" : "outline"}
            className="text-[10px]"
            data-testid="badge-wave206-secret-state"
          >
            {config?.secret.configured ? "set" : config?.secret.placeholder ? "placeholder, not usable" : "not set"}
          </Badge>
          <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="text-[11px] text-muted-foreground mt-1" data-testid="text-wave206-secret-statement">
          {config?.secret.statement ?? ""}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1 font-mono break-all">
          {(config?.secret.envVarNames ?? []).join(", ")}
        </div>
      </div>

      {/* ---- Setting 3: the batch limit ---- */}
      <div className="border-t border-border pt-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs font-medium">Events per drain</div>
          {config ? <SourceBadge source={config.drainBatchLimit.source} /> : null}
          <Badge variant="outline" className="text-[10px]" data-testid="badge-wave206-batch-limit">
            {config?.drainBatchLimit.value ?? "—"}
          </Badge>
          <Input
            value={limitDraft}
            onChange={(e) => setLimitDraft(e.target.value)}
            placeholder={`${cfg.data?.batchLimitRange.min ?? 1}–${cfg.data?.batchLimitRange.max ?? 100}`}
            className="h-8 w-24 text-xs"
            data-testid="input-wave206-batch-limit"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || limitDraft.trim() === ""}
            onClick={() => save("collective.bridge.drain_batch_limit", Math.floor(Number(limitDraft)))}
            data-testid="button-wave206-save-batch-limit"
          >
            Save limit
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || config?.drainBatchLimit.source !== "database"}
            onClick={() => save("collective.bridge.drain_batch_limit", 0)}
            data-testid="button-wave206-unset-batch-limit"
          >
            Use the built-in limit instead
          </Button>
        </div>
        <div className="text-[11px] text-muted-foreground mt-1" data-testid="text-wave206-limit-precedence">
          {config?.drainBatchLimit.precedence ?? ""}
        </div>
      </div>

      {/* ---- What is waiting, and where each type could go ---- */}
      <div className="border-t border-border pt-3 mb-3">
        <div className="text-xs font-medium mb-1">What is waiting</div>
        <div className="text-[11px] text-muted-foreground mb-2" data-testid="text-wave206-census-statement">
          {census?.statement ?? ""}
        </div>
        <div className="space-y-1">
          {(census?.byType ?? []).map((row) => (
            <div
              key={row.eventType}
              className="text-[11px] border border-border rounded px-2 py-1"
              data-testid={`row-wave206-census-${row.eventType}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{row.eventType}</span>
                <Badge variant="outline" className="text-[10px]">{row.queued} waiting</Badge>
                <Badge
                  variant={row.hasDestination ? "default" : "outline"}
                  className="text-[10px]"
                >
                  {row.hasDestination ? "has a destination" : row.fenced ? "refused by the ownership fence" : "no destination"}
                </Badge>
              </div>
              <div className="text-muted-foreground mt-0.5">{row.reason}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- The drain: preview first, send second ---- */}
      <div className="border-t border-border pt-3">
        <div className="text-xs font-medium mb-1">Sending the waiting events</div>
        <div className="text-[11px] text-muted-foreground mb-2">
          Preview shows what would be sent and sends nothing. Sending is a separate, deliberate step and is limited to
          the number of events per drain shown above, so you can send the queue in controlled batches.
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => runDrain(false)}
            data-testid="button-wave206-drain-preview"
          >
            <Eye className="h-3.5 w-3.5 mr-1" /> Preview a drain (sends nothing)
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !config?.mayDeliver}
            onClick={() => runDrain(true)}
            data-testid="button-wave206-drain-send"
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1" /> Send this batch now
          </Button>
        </div>

        {drain ? (
          <div className="mt-3 text-[11px] border border-border rounded p-2" data-testid="panel-wave206-drain-result">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={drain.dryRun ? "outline" : "default"} className="text-[10px]" data-testid="badge-wave206-drain-mode">
                {drain.dryRun ? "preview only — nothing was sent" : "sent"}
              </Badge>
              <span data-testid="text-wave206-drain-statement">{drain.statement}</span>
            </div>
            <div className="text-muted-foreground mt-1" data-testid="text-wave206-drain-target">
              Destination: {drain.plan.targetHost ?? "none set"}
              {drain.plan.targetPath ?? ""} · limit {drain.plan.limit} · {drain.plan.eligibleQueued} waiting ·{" "}
              {drain.plan.selectedDeliverable} would send · {drain.plan.selectedRefused} refused ·{" "}
              {drain.plan.heldBackByLimit} held back by the limit
            </div>
            <div className="mt-2 space-y-1">
              {drain.plan.selected.slice(0, 25).map((c) => (
                <div key={c.eventId} data-testid={`row-wave206-drain-${c.eventId}`}>
                  <span className="font-mono">{c.eventType}</span>{" "}
                  {c.wouldDeliver ? (
                    <Check className="h-3 w-3 inline text-emerald-700" />
                  ) : (
                    <span className="text-muted-foreground">— {c.refusalReason ?? "refused"}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* ---- The real environment findings, codes and names only ---- */}
      {(config?.envFindings ?? []).length > 0 ? (
        <div className="border-t border-border pt-3 mt-3">
          <div className="text-xs font-medium mb-1">What the server reports about the bridge environment</div>
          <div className="space-y-1">
            {(config?.envFindings ?? []).map((f) => (
              <div key={f.code} className="text-[11px]" data-testid={`row-wave206-finding-${f.code}`}>
                <Badge
                  variant={f.severity === "error" ? "destructive" : "outline"}
                  className="text-[10px] mr-1"
                >
                  {f.severity}
                </Badge>
                {f.message}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="mt-3 text-[11px]" data-testid="text-wave206-message">
          {message}
        </div>
      ) : null}
    </Card>
  );
}

export default Wave206BridgeDeliveryPanel;
