/**
 * WAVE 18 — ORP-040 (DEF-040), DSC half.
 *
 * WHAT WAS WRONG. `POST /api/investor/dsc/submit`
 * (server/adminDscRoutes.ts:332, registered at server/routes.ts:1103) has shipped
 * with ZERO client callers — an investor on a cap table had no way to submit the
 * company for Diligence & Scoring Committee review, which is the whole
 * "promote my company to DSC" workflow. Verified by grep over `client/src` before
 * this file existed.
 *
 * WHY A NEW READ ROUTE WAS ADDED (and it is the only thing built here). Wiring the
 * POST alone would have reproduced the Wave 17 hand-over defect: the submission id
 * would live only in this component's state, so a refresh — or a colleague on the
 * same cap table — would see nothing and could submit again. The only existing read
 * of `dsc_pipeline` is `GET /api/admin/dsc/pipeline`, which is `requireAdmin` and
 * platform-wide. So Wave 18 added the cap-table-scoped
 * `GET /api/investor/dsc/submissions?companyId=…` (server/adminDscRoutes.ts, guarded
 * by the SAME `isOnCapTable` predicate as the submit route) and this panel reads it.
 *
 * FAIL-CLOSED STATES ARE RENDERED, NOT HIDDEN:
 *   • 403 `NOT_ON_CAP_TABLE` — the server's own message shape; the panel says the
 *     viewer is not on this cap table and does NOT show a submit button that would
 *     always fail.
 *   • 500 `DSC_PIPELINE_PERSIST_FAILED` — the submit route's deliberate fail-closed
 *     path (:371). Rendered as "nothing was stored, please retry". It must never
 *     look like a success, because the row genuinely does not exist.
 *   • 503 `DSC_PIPELINE_READ_FAILED` — the new read route refuses rather than
 *     answering `[]`, since an empty list would read as "you never submitted".
 *
 * NO MONEY on this surface.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";

/** Mirrors `DscSubmission` (server/adminDscRoutes.ts). */
export interface DscSubmissionRow {
  id: string;
  companyId: string;
  submittedBy: string;
  submittedAt: string;
  status: string;
}

/** Exact `error` strings the two routes can return. */
export const DSC_ERROR_COPY: Record<string, string> = {
  NOT_ON_CAP_TABLE:
    "Only an investor on this company's cap table can submit it for DSC review.",
  DSC_PIPELINE_PERSIST_FAILED:
    "The submission could not be saved. Nothing was stored — please retry.",
  DSC_PIPELINE_READ_FAILED:
    "Existing DSC submissions could not be read right now. Nothing has been lost.",
  UNAUTHORIZED: "Your session has expired. Sign in again to submit.",
  "companyId required": "No company is selected.",
};

export function dscErrorCopy(error: string | null | undefined): string {
  if (!error) return "That did not complete. Nothing was stored.";
  return DSC_ERROR_COPY[error] ?? `That was refused (${error}). Nothing was stored.`;
}

export function dscStatusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "promoted" || status === "accepted") return "default";
  if (status === "pending") return "secondary";
  if (status === "declined" || status === "rejected") return "destructive";
  return "outline";
}

export function InvestorDscSubmitPanel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);

  const listQ = useQuery<{ ok: boolean; items?: DscSubmissionRow[]; error?: string; message?: string }>({
    queryKey: ["/api/investor/dsc/submissions", companyId],
    queryFn: async () =>
      (
        await apiRequest(
          "GET",
          `/api/investor/dsc/submissions?companyId=${encodeURIComponent(companyId)}`,
        )
      ).json(),
    enabled: Boolean(companyId),
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/investor/dsc/submit", { companyId });
      const body = await res.json();
      if (!res.ok || body?.ok === false) {
        throw new Error(String(body?.error ?? `http_${res.status}`));
      }
      return body as { ok: true; submission: DscSubmissionRow };
    },
    onSuccess: () => {
      setRefusal(null);
      setJustSubmitted(true);
      qc.invalidateQueries({ queryKey: ["/api/investor/dsc/submissions", companyId] });
    },
    onError: (err: Error) => {
      setJustSubmitted(false);
      setRefusal(err.message);
    },
  });

  /* A refused READ is a real answer. `listQ.data.ok === false` carries the
   * server's error code; `listQ.isError` covers a non-2xx that threw. */
  const readRefusal =
    listQ.data?.ok === false ? String(listQ.data.error ?? "") : listQ.isError ? "DSC_PIPELINE_READ_FAILED" : null;
  const notOnCapTable = readRefusal === "NOT_ON_CAP_TABLE";
  const items = listQ.data?.items ?? [];

  return (
    <Card className="mb-6" data-testid="investor-dsc-panel">
      <CardHeader>
        <CardTitle className="text-lg">Diligence &amp; Scoring Committee</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Submitting this company asks the Collective's DSC to run a diligence
          review. Submission does not itself change any score.
        </div>

        {listQ.isLoading && <Skeleton className="h-12 w-full" />}

        {readRefusal && (
          <div className="text-sm text-amber-900" data-testid="investor-dsc-read-refusal">
            {dscErrorCopy(readRefusal)}
          </div>
        )}

        {!listQ.isLoading && !readRefusal && items.length === 0 && (
          <div className="text-sm text-muted-foreground" data-testid="investor-dsc-empty">
            This company has not been submitted for DSC review yet.
          </div>
        )}

        {items.length > 0 && (
          <ul className="space-y-2" data-testid="investor-dsc-list">
            {items.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
                data-testid={`investor-dsc-row-${s.id}`}
              >
                <span>
                  <span className="font-medium">Submitted</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {String(s.submittedAt).slice(0, 10)}
                  </span>
                </span>
                <Badge variant={dscStatusVariant(s.status)} data-testid={`investor-dsc-status-${s.id}`}>
                  {s.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {refusal && (
          <div className="text-sm text-amber-900" data-testid="investor-dsc-submit-refusal">
            {dscErrorCopy(refusal)}
          </div>
        )}
        {justSubmitted && !refusal && (
          <div className="text-sm text-emerald-900" data-testid="investor-dsc-submitted">
            Submitted for DSC review.
          </div>
        )}

        {/* A control that can only ever fail is not shown. The viewer is told why
            instead — that is the rendered fail-closed state, not a hidden one. */}
        {!notOnCapTable && (
          <Button
            data-testid="investor-dsc-submit"
            disabled={submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? "Submitting…" : "Submit for DSC review"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default InvestorDscSubmitPanel;
