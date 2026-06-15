/**
 * Sprint 14 D3 — Warm-Intro Request modal.
 *
 * Per harvest §3 Bullet 1 + Conflict 5: gated on `isCollectiveMember=true`.
 * Submit emits `crm_intro_requested` and appends to introRequestStore's
 * hash chain.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useCapavateToast } from "./Toast";
import { InlineError } from "./InlineError";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";

export interface WarmIntroPrefill {
  brokerContactId?: string;
  brokerName?: string;
  targetKind?: "acquirer" | "investor" | "expert";
  targetName?: string;
  targetSector?: string;
  targetRegion?: string;
}

export interface WarmIntroModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requesterCompanyId: string;
  prefill?: WarmIntroPrefill;
  isCollectiveMember: boolean;
}

export function WarmIntroModal({ open, onOpenChange, requesterCompanyId, prefill, isCollectiveMember }: WarmIntroModalProps) {
  const toast = useCapavateToast();
  const [targetKind, setTargetKind] = useState<"acquirer" | "investor" | "expert">(prefill?.targetKind ?? "acquirer");
  const [targetName, setTargetName] = useState(prefill?.targetName ?? "");
  const [sector, setSector] = useState(prefill?.targetSector ?? "");
  const [region, setRegion] = useState(prefill?.targetRegion ?? "");
  const [askText, setAskText] = useState("");
  const [deckUrl, setDeckUrl] = useState("");

  const mutate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/founder/crm/intro-requests", {
        requesterCompanyId,
        brokerContactId: prefill?.brokerContactId,
        targetEntity: { kind: targetKind, name: targetName, sector: sector || undefined, region: region || undefined },
        askText,
        attachedDeckUrl: deckUrl || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      // v25.13 NM1 — refresh any open intro-request lists so the new
      // request appears without requiring a manual refetch.
      queryClient.invalidateQueries({ queryKey: ["/api/founder/crm/intro-requests"] });
      toast({ title: "Warm intro requested", description: "We'll notify you when the recipient responds.", tone: "success" });
      onOpenChange(false);
      setTargetName(""); setAskText(""); setDeckUrl("");
    },
    onError: (e: unknown) => {
      toast({ title: "Couldn't send request", description: (e as Error).message, tone: "destructive" });
    },
  });

  if (!isCollectiveMember) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="dialog-warm-intro-locked">
          <DialogHeader>
            <DialogTitle>Collective members only</DialogTitle>
            <DialogDescription>Warm-intro requests are available to active Collective members.</DialogDescription>
          </DialogHeader>
          <InlineError title="Membership required" message="Apply to join Collective to unlock warm-intro routing through your cap-table network." />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-warm-intro" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a warm intro</DialogTitle>
          <DialogDescription>
            {prefill?.brokerName
              ? `Route through ${prefill.brokerName} as a co-investor broker.`
              : "Choose a target entity and write your ask. ≤ 500 characters."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="target-kind">Target type</Label>
              <Select value={targetKind} onValueChange={(v) => setTargetKind(v as typeof targetKind)}>
                <SelectTrigger id="target-kind" data-testid="select-target-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="acquirer">Acquirer</SelectItem>
                  <SelectItem value="investor">Investor</SelectItem>
                  <SelectItem value="expert">Expert</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="target-name">Target name</Label>
              <Input id="target-name" data-testid="input-target-name" value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="e.g. Visa Inc." />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sector">Sector (optional)</Label>
              <Input id="sector" data-testid="input-sector" value={sector} onChange={(e) => setSector(e.target.value)} placeholder="fintech" />
            </div>
            <div>
              <Label htmlFor="region">Region (optional)</Label>
              <Input id="region" data-testid="input-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="US" />
            </div>
          </div>

          <div>
            <Label htmlFor="ask-text">Your ask <span className="text-muted-foreground">({askText.length}/500)</span></Label>
            <Textarea id="ask-text" data-testid="textarea-ask" value={askText} onChange={(e) => setAskText(e.target.value.slice(0, 500))} rows={4} placeholder="Why this intro, what stage of conversation, what's the right next step?" />
          </div>

          <div>
            <Label htmlFor="deck-url">Deck URL (optional)</Label>
            <Input id="deck-url" data-testid="input-deck-url" value={deckUrl} onChange={(e) => setDeckUrl(e.target.value)} placeholder="https://..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-warm-intro-cancel">Cancel</Button>
          <Button
            onClick={() => mutate.mutate()}
            disabled={!targetName || !askText || mutate.isPending}
            data-testid="button-warm-intro-submit"
          >
            {mutate.isPending ? "Sending…" : "Send request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
