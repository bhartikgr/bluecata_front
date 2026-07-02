/**
 * Wave C-3 — Collective DSC Pipeline (M&A Intelligence)
 * Kanban-style view grouped by transactionPrepStatus.
 * Status change via button (double-confirm) instead of drag-and-drop.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { isCollectiveMembershipError, CollectiveMembershipNotice } from "@/lib/collectiveGateError";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BarChart3, TrendingUp, ChevronRight, ExternalLink, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { safeExternalHref } from "@/lib/safeUrl";

interface PipelineCard {
  companyId: string;
  companyName: string;
  sector: string | null;
  compositeScore: number | null;
  autoTier: string | null;
  mnaReadiness: {
    ipDdReadinessPct: number | null;
    customerContractsReadinessPct: number | null;
    financialAuditReadinessPct: number | null;
    dataRoomOrganizedPct: number | null;
    regulatoryFilingsCompletePct: number | null;
    esgDisclosureCompletePct: number | null;
  };
}

interface PipelineData {
  columns: Record<string, PipelineCard[]>;
  counts: Record<string, number>;
  total: number;
}

const COLUMNS = [
  { id: "not_pursuing", label: "Not Pursuing", color: "bg-slate-100 border-slate-200" },
  { id: "exploring", label: "Exploring", color: "bg-amber-50 border-amber-200" },
  { id: "active", label: "Active", color: "bg-blue-50 border-blue-200" },
  { id: "closing", label: "Closing", color: "bg-emerald-50 border-emerald-200" },
  { id: "closed", label: "Closed", color: "bg-purple-50 border-purple-200" },
];

const TIER_COLORS: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700",
  B: "bg-blue-100 text-blue-700",
  C: "bg-amber-100 text-amber-700",
  D: "bg-red-100 text-red-600",
};

function RadarMini({ mnaReadiness }: { mnaReadiness: PipelineCard["mnaReadiness"] }) {
  const fields = [
    { label: "IP", value: mnaReadiness.ipDdReadinessPct },
    { label: "Cust", value: mnaReadiness.customerContractsReadinessPct },
    { label: "Fin", value: mnaReadiness.financialAuditReadinessPct },
    { label: "DR", value: mnaReadiness.dataRoomOrganizedPct },
    { label: "Reg", value: mnaReadiness.regulatoryFilingsCompletePct },
    { label: "ESG", value: mnaReadiness.esgDisclosureCompletePct },
  ];

  return (
    <div className="grid grid-cols-6 gap-0.5 mt-2">
      {fields.map((f) => (
        <div key={f.label} className="text-center">
          <div
            className="h-8 rounded-sm mx-auto w-3"
            style={{
              backgroundColor: "#cc0001",
              opacity: f.value !== null ? f.value / 100 : 0.1,
              minHeight: 2,
            }}
            data-testid={`bar-${f.label.toLowerCase()}`}
          />
          <p className="text-[9px] text-slate-400 mt-0.5">{f.label}</p>
        </div>
      ))}
    </div>
  );
}

function CompanyCard({
  card,
  onNavigate,
  onReview,
}: {
  card: PipelineCard;
  onNavigate: (id: string) => void;
  onReview: (card: PipelineCard) => void;
}) {
  return (
    <Card
      className="hover:border-[#cc0001]/30 transition-colors"
      onClick={() => onNavigate(card.companyId)}
      data-testid={`card-pipeline-${card.companyId}`}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-800 truncate" data-testid={`name-pipeline-${card.companyId}`}>
              {card.companyName}
            </p>
            {card.sector && (
              <p className="text-[10px] text-slate-500 truncate">{card.sector}</p>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            {card.compositeScore !== null && (
              <span
                className="text-xs font-bold"
                style={{ color: "#cc0001" }}
                data-testid={`score-pipeline-${card.companyId}`}
              >
                {card.compositeScore}
              </span>
            )}
            {card.autoTier && (
              <Badge
                className={`text-[8px] px-1 py-0 ${TIER_COLORS[card.autoTier] ?? ""}`}
                data-testid={`tier-pipeline-${card.companyId}`}
              >
                {card.autoTier}
              </Badge>
            )}
          </div>
        </div>
        <RadarMini mnaReadiness={card.mnaReadiness} />
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full text-[10px] h-6"
          onClick={(e) => { e.stopPropagation(); onReview(card); }}
          data-testid={`button-review-${card.companyId}`}
        >
          Review / Vote
        </Button>
      </CardContent>
    </Card>
  );
}

/** DSC-1b + DSC-1c — Review/vote modal with pitch deck link. */
function DscReviewModal({
  card,
  open,
  onClose,
}: {
  card: PipelineCard | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [vote, setVote] = useState<"approve" | "reject" | "conditional" | "abstain">("approve");
  const [notes, setNotes] = useState("");
  const [chapterId, setChapterId] = useState("");

  // DSC-1c — pitch deck fetch
  type PitchDeckOkResponse = { ok: true; pitchDeck: { id: string; originalName: string; mimeType: string }; url: string; expiresAt: string };
  type PitchDeckErrResponse = { ok?: false; error: string };
  const pitchDeckQ = useQuery<PitchDeckOkResponse | PitchDeckErrResponse>({
    queryKey: ["/api/collective/dsc/pitch-deck", card?.companyId],
    queryFn: () => apiRequest("GET", `/api/collective/dsc/pitch-deck/${card!.companyId}`).then((r) => r.json()),
    enabled: open && !!card?.companyId,
    retry: false,
  });

  const pitchDeckOk = pitchDeckQ.data && "ok" in pitchDeckQ.data && pitchDeckQ.data.ok === true;
  const pitchDeck = pitchDeckOk ? (pitchDeckQ.data as PitchDeckOkResponse).pitchDeck : null;
  const pitchDeckUrl = pitchDeckOk ? (pitchDeckQ.data as PitchDeckOkResponse).url : null;

  const voteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/collective/dsc/votes/${card!.companyId}`, {
        vote,
        chapterId,
        notes: notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Vote cast", description: `Voted "${vote}" for ${card?.companyName}.` });
      qc.invalidateQueries({ queryKey: ["/api/collective/dsc/pipeline"] });
      qc.invalidateQueries({ queryKey: ["/api/collective/dsc/scores"] });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Vote failed", description: err.message, variant: "destructive" });
    },
  });

  const computeMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/collective/dsc/compute/${card!.companyId}`, undefined, { "x-confirm": "true" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Score computed", description: `DSC score computed for ${card?.companyName}.` });
      qc.invalidateQueries({ queryKey: ["/api/collective/dsc/pipeline"] });
      qc.invalidateQueries({ queryKey: ["/api/collective/dsc/scores"] });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Compute failed", description: err.message, variant: "destructive" });
    },
  });

  if (!card) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dsc-vote-modal">
        <DialogHeader>
          <DialogTitle>Review / Vote — {card.companyName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* DSC-1c — Pitch deck */}
          <div>
            <p className="text-xs font-medium text-slate-600 mb-1">Pitch Deck</p>
            {pitchDeckQ.isLoading && <p className="text-xs text-slate-400">Loading…</p>}
            {!pitchDeckQ.isLoading && pitchDeckOk && pitchDeck && safeExternalHref(pitchDeckUrl) ? (
              <a
                href={safeExternalHref(pitchDeckUrl)!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[#cc0001] hover:underline"
                data-testid="dsc-pitch-deck-link"
              >
                <FileText className="h-3.5 w-3.5" />
                {pitchDeck.originalName}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              !pitchDeckQ.isLoading && <p className="text-xs text-slate-400" data-testid="dsc-pitch-deck-link">No pitch deck uploaded.</p>
            )}
          </div>

          {/* Vote selection */}
          <div>
            <Label className="text-xs font-medium text-slate-600">Vote</Label>
            <RadioGroup
              value={vote}
              onValueChange={(v) => setVote(v as typeof vote)}
              className="mt-2 grid grid-cols-2 gap-2"
            >
              {(["approve", "reject", "conditional", "abstain"] as const).map((opt) => (
                <div key={opt} className="flex items-center gap-2">
                  <RadioGroupItem value={opt} id={`vote-${opt}`} />
                  <Label htmlFor={`vote-${opt}`} className="capitalize text-xs cursor-pointer">{opt}</Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Chapter ID */}
          <div>
            <Label className="text-xs font-medium text-slate-600" htmlFor="vote-chapter">Chapter ID</Label>
            <Input
              id="vote-chapter"
              className="mt-1 h-8 text-xs"
              placeholder="e.g. chapter_toronto"
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value)}
            />
          </div>

          {/* Notes / rationale */}
          <div>
            <Label className="text-xs font-medium text-slate-600" htmlFor="vote-notes">Notes / Rationale (optional)</Label>
            <Textarea
              id="vote-notes"
              className="mt-1 text-xs"
              rows={3}
              placeholder="Your rationale for this vote…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} size="sm">Cancel</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => computeMut.mutate()}
            disabled={computeMut.isPending}
            data-testid="dsc-score-submit"
          >
            {computeMut.isPending ? "Computing…" : "Compute Score"}
          </Button>
          <Button
            size="sm"
            className="bg-[#cc0001] hover:bg-[#aa0001] text-white"
            onClick={() => voteMut.mutate()}
            disabled={voteMut.isPending || !chapterId.trim()}
            data-testid="dsc-vote-submit"
          >
            {voteMut.isPending ? "Submitting…" : "Submit Vote"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CollectiveDscPipeline() {
  const [, navigate] = useLocation();
  const [reviewCard, setReviewCard] = useState<PipelineCard | null>(null);

  const { data, isLoading, error } = useQuery<PipelineData>({
    queryKey: ["/api/collective/dsc/pipeline"],
    queryFn: () => apiRequest("GET", "/api/collective/dsc/pipeline").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  return (
    <>
    <div className="p-6 max-w-[1400px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-semibold flex items-center gap-2"
            style={{ color: "#1A1A2E" }}
            data-testid="heading-dsc-pipeline"
          >
            <BarChart3 className="h-5 w-5 text-[#cc0001]" />
            DSC Pipeline
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            M&A deal flow grouped by transaction-prep status.
          </p>
        </div>
        {data && (
          <Badge className="bg-[#cc0001]/10 text-[#cc0001] border-0" data-testid="badge-pipeline-total">
            {data.total} companies
          </Badge>
        )}
      </div>

      {error && (
        isCollectiveMembershipError(error) ? <CollectiveMembershipNotice /> : <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="error-pipeline">
          Failed to load pipeline. Please refresh.
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-5 gap-4">
          {COLUMNS.map((col) => (
            <div key={col.id} className="space-y-3">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="pipeline-kanban">
          {COLUMNS.map((col) => {
            const cards = data?.columns?.[col.id] ?? [];
            const count = data?.counts?.[col.id] ?? 0;
            return (
              <div
                key={col.id}
                className={`rounded-lg border-2 p-3 min-h-48 ${col.color}`}
                data-testid={`column-${col.id}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-700">{col.label}</p>
                  <Badge className="bg-white/60 text-slate-600 text-[10px]" data-testid={`count-${col.id}`}>
                    {count}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {cards.length === 0 ? (
                    <div className="text-center py-4 text-[10px] text-slate-400" data-testid={`empty-col-${col.id}`}>
                      No companies
                    </div>
                  ) : (
                    cards.map((card) => (
                      <CompanyCard
                        key={card.companyId}
                        card={card}
                        onNavigate={(id) => navigate(`/collective/dealroom/${id}`)}
                        onReview={(c) => setReviewCard(c)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
    <DscReviewModal
      card={reviewCard}
      open={reviewCard !== null}
      onClose={() => setReviewCard(null)}
    />
    </>
  );
}
