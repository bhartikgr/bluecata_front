/**
 * WAVE 28 ITEM 2 — CP-CRM-04 · CRM duplicate-contact review queue (admin).
 *
 * `crm_dedup_review` has been collecting shared-inbox conflicts since migration
 * 0097 (v25.52) with no reader anywhere in the tree. This is that reader, plus
 * the two resolution actions the migration's own header promised.
 *
 * Endpoints used (all under /api/admin, covered by requireAdmin at routes.ts:555):
 *   GET  /api/admin/crm-dedup-review?status=open|resolved|all&scope=founder|investor|partner
 *   POST /api/admin/crm-dedup-review/detect
 *   POST /api/admin/crm-dedup-review/:id/resolve   { action: "merge" | "distinct", survivorId?, note? }
 *   POST /api/admin/crm-dedup-review/:id/reopen
 *
 * Two things this page deliberately does NOT do:
 *   • It does not hide the Merge control for partner-scope conflicts. It renders
 *     the server's refusal reason instead, so the operator learns WHY rather than
 *     wondering where the button went.
 *   • It does not render a missing contact name as an empty cell. An unknown name
 *     is null on the wire and is rendered as an explicit refusal string, because
 *     "no name recorded" and "named empty string" are different facts and the
 *     whole point of this queue is telling near-identical people apart.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, RefreshCw, Search, Users } from "lucide-react";

type CrmScope = "founder" | "investor" | "partner";

interface DedupMember {
  contactId: string;
  name: string | null;
  email: string | null;
  createdAt: string | null;
  dedupExempt: boolean;
  live: boolean;
}

interface DedupReview {
  id: string;
  crmScope: CrmScope;
  scopeId: string;
  emailNorm: string;
  contactIds: string[];
  distinctNames: string[];
  status: "open" | "resolved";
  resolution: "merged" | "distinct" | null;
  survivorId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  members: DedupMember[];
  liveMemberCount: number;
  mergeAllowed: boolean;
  mergeBlockedReason: string | null;
}

interface QueueCounts {
  open: number;
  resolved: number;
  merged: number;
  distinct: number;
}

interface QueueResponse {
  ok: boolean;
  reviews: DedupReview[];
  counts: QueueCounts;
  scopes: CrmScope[];
}

const SCOPE_LABEL: Record<CrmScope, string> = {
  founder: "Founder CRM",
  investor: "Investor CRM",
  partner: "Partner CRM",
};

/** An unknown name is not a blank name. Say so on screen. */
function renderName(name: string | null): JSX.Element {
  if (name === null) {
    return <span className="italic text-muted-foreground">no name recorded</span>;
  }
  return <span className="font-medium">{name}</span>;
}

function renderEmail(email: string | null): JSX.Element {
  if (email === null) {
    return <span className="italic text-muted-foreground">no email recorded</span>;
  }
  return <span>{email}</span>;
}

export default function CrmDedupReviewPage(): JSX.Element {
  const [reviews, setReviews] = useState<DedupReview[]>([]);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [statusFilter, setStatusFilter] = useState<"open" | "resolved" | "all">("open");
  const [scopeFilter, setScopeFilter] = useState<CrmScope | "">("");
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string>("");
  const [survivorByReview, setSurvivorByReview] = useState<Record<string, string>>({});
  const [scanSummary, setScanSummary] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ status: statusFilter });
      if (scopeFilter) qs.set("scope", scopeFilter);
      const r = await fetch(`/api/admin/crm-dedup-review?${qs.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error(`http_${r.status}`);
      const data = (await r.json()) as QueueResponse;
      setReviews(Array.isArray(data.reviews) ? data.reviews : []);
      setCounts(data.counts ?? null);
    } catch (err) {
      // A failed load must not render as "zero conflicts" — that would read as
      // an all-clear on a page whose entire job is surfacing conflicts.
      setReviews([]);
      setCounts(null);
      setLoadError((err as Error).message || "load_failed");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, scopeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const runScan = useCallback(async () => {
    setBusyId("__scan__");
    setActionError(null);
    setScanSummary(null);
    try {
      const r = await fetch("/api/admin/crm-dedup-review/detect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await r.json()) as {
        ok?: boolean;
        inserted?: number;
        alreadyOpen?: number;
        skippedSettled?: number;
        scanned?: number;
        error?: string;
      };
      if (!r.ok || !data.ok) throw new Error(data.error || `http_${r.status}`);
      setScanSummary(
        `Scanned ${data.scanned ?? 0} duplicate groups — ${data.inserted ?? 0} newly queued, ` +
          `${data.alreadyOpen ?? 0} already open, ${data.skippedSettled ?? 0} previously settled as separate people.`,
      );
      await load();
    } catch (err) {
      setActionError((err as Error).message || "scan_failed");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const act = useCallback(
    async (review: DedupReview, action: "merge" | "distinct" | "reopen") => {
      setBusyId(review.id);
      setActionError(null);
      try {
        const url =
          action === "reopen"
            ? `/api/admin/crm-dedup-review/${encodeURIComponent(review.id)}/reopen`
            : `/api/admin/crm-dedup-review/${encodeURIComponent(review.id)}/resolve`;
        const body =
          action === "reopen"
            ? {}
            : {
                action,
                survivorId: action === "merge" ? survivorByReview[review.id] : undefined,
                note: actionNote.trim() === "" ? undefined : actionNote.trim(),
              };
        const r = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await r.json()) as { ok?: boolean; error?: string; message?: string };
        if (!r.ok || !data.ok) throw new Error(data.message || data.error || `http_${r.status}`);
        setActionNote("");
        await load();
      } catch (err) {
        setActionError((err as Error).message || "action_failed");
      } finally {
        setBusyId(null);
      }
    },
    [actionNote, survivorByReview, load],
  );

  const openCount = counts?.open ?? 0;
  const headerNote = useMemo(() => {
    if (loadError) return "Queue unavailable — the count below cannot be trusted.";
    if (openCount === 0) return "No duplicate-contact conflicts are waiting for a decision.";
    return `${openCount} duplicate-contact conflict${openCount === 1 ? "" : "s"} waiting for a decision.`;
  }, [openCount, loadError]);

  return (
    <>
      <PageHeader
        title="CRM Duplicate Review"
        description="Same email address, more than one person. Decide whether to merge them or keep them apart."
      />
      <PageBody>
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="text-sm">{headerNote}</span>
              {counts && (
                <span className="text-xs text-muted-foreground">
                  {counts.open} open · {counts.merged} merged · {counts.distinct} kept separate
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(["open", "resolved", "all"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "outline"}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "open" ? "Open" : s === "resolved" ? "Resolved" : "All"}
                </Button>
              ))}
              <span className="mx-1 text-muted-foreground">|</span>
              <Button
                size="sm"
                variant={scopeFilter === "" ? "default" : "outline"}
                onClick={() => setScopeFilter("")}
              >
                All CRMs
              </Button>
              {(["founder", "investor", "partner"] as const).map((sc) => (
                <Button
                  key={sc}
                  size="sm"
                  variant={scopeFilter === sc ? "default" : "outline"}
                  onClick={() => setScopeFilter(sc)}
                >
                  {SCOPE_LABEL[sc]}
                </Button>
              ))}
              <span className="mx-1 text-muted-foreground">|</span>
              <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
                <RefreshCw className="mr-1 h-3 w-3" /> Refresh
              </Button>
              <Button size="sm" onClick={() => void runScan()} disabled={busyId !== null}>
                <Search className="mr-1 h-3 w-3" /> Scan for new duplicates
              </Button>
            </div>
            {scanSummary && <p className="text-xs text-muted-foreground">{scanSummary}</p>}
            {loadError && (
              <p className="text-sm text-destructive">
                Could not load the review queue ({loadError}). This is not an all-clear — no conflict count can be
                shown until the queue loads.
              </p>
            )}
            {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          </CardContent>
        </Card>

        {loading && <p className="mt-4 text-sm text-muted-foreground">Loading review queue…</p>}

        {!loading && !loadError && reviews.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing in this view. Duplicate groups are added by migration 0097 and by the scan above.
          </p>
        )}

        <div className="mt-4 space-y-4">
          {reviews.map((rv) => {
            const busy = busyId === rv.id;
            const chosen = survivorByReview[rv.id] ?? "";
            return (
              <Card key={rv.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{SCOPE_LABEL[rv.crmScope]}</Badge>
                    <span className="font-mono text-sm">{rv.emailNorm}</span>
                    <Badge variant={rv.status === "open" ? "destructive" : "secondary"}>
                      {rv.status === "open"
                        ? "Needs a decision"
                        : rv.resolution === "merged"
                          ? "Merged"
                          : "Kept separate"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      scope {rv.scopeId} · {rv.liveMemberCount} live of {rv.contactIds.length}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {rv.members.map((m) => (
                      <div key={m.contactId} className="flex flex-wrap items-center gap-2 text-sm">
                        {rv.status === "open" && rv.mergeAllowed && m.live && (
                          <input
                            type="radio"
                            name={`survivor_${rv.id}`}
                            aria-label={`Keep ${m.name ?? m.contactId}`}
                            checked={chosen === m.contactId}
                            onChange={() => setSurvivorByReview((prev) => ({ ...prev, [rv.id]: m.contactId }))}
                          />
                        )}
                        {renderName(m.name)}
                        <span className="text-muted-foreground">·</span>
                        {renderEmail(m.email)}
                        <span className="font-mono text-xs text-muted-foreground">{m.contactId}</span>
                        {!m.live && <Badge variant="secondary">deleted</Badge>}
                        {m.dedupExempt && <Badge variant="outline">outside unique index</Badge>}
                        {rv.survivorId === m.contactId && <Badge>kept</Badge>}
                      </div>
                    ))}
                  </div>

                  {rv.status === "open" && (
                    <div className="space-y-2">
                      {!rv.mergeAllowed && (
                        <p className="flex items-start gap-2 text-sm text-amber-600">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>Merge unavailable: {rv.mergeBlockedReason}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="grow">
                          <Label htmlFor={`note_${rv.id}`} className="text-xs">
                            Reason (optional, stored with the decision)
                          </Label>
                          <Input
                            id={`note_${rv.id}`}
                            value={actionNote}
                            onChange={(e) => setActionNote(e.target.value)}
                            placeholder="e.g. shared ops@ inbox, two different people"
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={busy || !rv.mergeAllowed || chosen === ""}
                          onClick={() => void act(rv, "merge")}
                        >
                          Merge into selected
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(rv, "distinct")}>
                          Different people — keep both
                        </Button>
                      </div>
                      {rv.mergeAllowed && chosen === "" && (
                        <p className="text-xs text-muted-foreground">
                          Choose which contact to keep before merging.
                        </p>
                      )}
                    </div>
                  )}

                  {rv.status === "resolved" && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {rv.resolution === "merged" ? "Merged" : "Kept separate"} by {rv.resolvedBy ?? "unknown"} on{" "}
                        {rv.resolvedAt ?? "unknown date"}
                        {rv.resolutionNote ? ` — ${rv.resolutionNote}` : ""}
                      </span>
                      {rv.resolution === "distinct" && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(rv, "reopen")}>
                          Reopen
                        </Button>
                      )}
                      {rv.resolution === "merged" && (
                        <span className="italic">
                          A merged conflict cannot be reopened — the merged-away contacts were soft-deleted.
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </PageBody>
    </>
  );
}
