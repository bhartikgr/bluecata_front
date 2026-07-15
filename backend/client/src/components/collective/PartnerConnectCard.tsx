/* W6 — "Connect a partner" card on a question detail page.
 *
 * Lets a Collective member request an available Consortium Partner to respond to
 * a question, and shows the status of any existing connect requests. Reads/writes
 * ONLY the non-sacred W6 partner-responder backend:
 *   GET  /api/collective/questions/:id/responders
 *   GET  /api/collective/questions/:id/connect-requests
 *   POST /api/collective/questions/:id/connect                { partnerId, message? }
 *   POST /api/collective/questions/:id/connect/:requestId/cancel
 *
 * W6.3 states: loading / empty / error+retry are all explicit. When no partner
 * is available for the chapter, we show a clear "no partners available yet"
 * empty state rather than a broken control.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Handshake } from "lucide-react";

interface Responder { id: string; partnerId: string; displayName: string; topics: string[]; }
interface ConnectRequest {
  id: string; partnerId: string; status: "requested" | "accepted" | "declined" | "answered" | "cancelled";
  message: string | null; declineReason: string | null; respondedAt: string | null; createdAt: string;
}

const STATUS_STYLE: Record<ConnectRequest["status"], string> = {
  requested: "bg-amber-100 text-amber-800",
  accepted: "bg-blue-100 text-blue-800",
  answered: "bg-emerald-100 text-emerald-800",
  declined: "bg-rose-100 text-rose-800",
  cancelled: "bg-muted text-muted-foreground",
};

export default function PartnerConnectCard({ questionId }: { questionId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [partnerId, setPartnerId] = useState("");
  const [message, setMessage] = useState("");

  const respKey = ["/api/collective/questions", questionId, "responders"];
  const reqKey = ["/api/collective/questions", questionId, "connect-requests"];

  const respQ = useQuery<{ ok: boolean; responders: Responder[] }>({
    queryKey: respKey,
    queryFn: async () => (await apiRequest("GET", `/api/collective/questions/${encodeURIComponent(questionId)}/responders`)).json(),
    retry: false,
  });
  const reqQ = useQuery<{ ok: boolean; requests: ConnectRequest[] }>({
    queryKey: reqKey,
    queryFn: async () => (await apiRequest("GET", `/api/collective/questions/${encodeURIComponent(questionId)}/connect-requests`)).json(),
    retry: false,
  });

  const connectMut = useMutation({
    mutationFn: async () => {
      if (!partnerId) throw new Error("Select a partner first.");
      const r = await apiRequest("POST", `/api/collective/questions/${encodeURIComponent(questionId)}/connect`, {
        partnerId, message: message.trim() || undefined,
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "connect_failed");
      return j;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reqKey });
      setMessage("");
      toast({ title: "Partner requested", description: "The partner has been asked to respond." });
    },
    onError: (e: any) => toast({ title: "Couldn’t request partner", description: e?.message, variant: "destructive" }),
  });

  const cancelMut = useMutation({
    mutationFn: async (requestId: string) => {
      const r = await apiRequest("POST", `/api/collective/questions/${encodeURIComponent(questionId)}/connect/${encodeURIComponent(requestId)}/cancel`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "cancel_failed");
      return j;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: reqKey }); toast({ title: "Request cancelled" }); },
    onError: (e: any) => toast({ title: "Cancel failed", description: e?.message, variant: "destructive" }),
  });

  const responders = respQ.data?.responders ?? [];
  const requests = reqQ.data?.requests ?? [];

  return (
    <Card data-testid="partner-connect-card">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Handshake className="h-4 w-4" /> Connect a partner
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {respQ.isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="connect-loading">Loading partners…</p>
        ) : respQ.isError || (respQ.data && !respQ.data.ok) ? (
          <div className="flex flex-col items-start gap-2" data-testid="connect-error">
            <p className="text-sm text-rose-600">Couldn’t load available partners.</p>
            <Button variant="outline" size="sm" onClick={() => respQ.refetch()} data-testid="connect-retry">Retry</Button>
          </div>
        ) : responders.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="connect-empty">
            No Consortium Partners are available to respond in this chapter yet.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2" data-testid="connect-form">
            <div className="min-w-[200px]">
              <label className="text-xs text-muted-foreground">Partner</label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger data-testid="connect-partner-select"><SelectValue placeholder="Select a partner" /></SelectTrigger>
                <SelectContent>
                  {responders.map((r) => (
                    <SelectItem key={r.id} value={r.partnerId} data-testid={`connect-partner-${r.partnerId}`}>
                      {r.displayName}{r.topics.length ? ` — ${r.topics.slice(0, 3).join(", ")}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional note to the partner"
              className="h-9 max-w-xs text-sm"
              data-testid="connect-message"
            />
            <Button onClick={() => connectMut.mutate()} disabled={connectMut.isPending || !partnerId} data-testid="connect-submit">
              {connectMut.isPending ? "Requesting…" : "Request response"}
            </Button>
          </div>
        )}

        {/* Existing requests */}
        {reqQ.isLoading ? null : requests.length > 0 && (
          <div className="space-y-2" data-testid="connect-requests-list">
            <div className="text-xs font-medium text-muted-foreground">Requests</div>
            {requests.map((req) => {
              const responder = responders.find((r) => r.partnerId === req.partnerId);
              return (
                <div key={req.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2" data-testid={`connect-request-${req.id}`}>
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{responder?.displayName ?? req.partnerId}</span>
                    {req.message && <span className="ml-2 text-xs text-muted-foreground">“{req.message}”</span>}
                    {req.status === "declined" && req.declineReason && (
                      <span className="ml-2 text-xs text-rose-600">— {req.declineReason}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_STYLE[req.status]} data-testid={`connect-status-${req.id}`}>{req.status}</Badge>
                    {(req.status === "requested" || req.status === "accepted") && (
                      <Button variant="ghost" size="sm" onClick={() => cancelMut.mutate(req.id)} disabled={cancelMut.isPending} data-testid={`connect-cancel-${req.id}`}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
