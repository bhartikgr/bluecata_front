import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT, WAVE214_TYPED_NAME_LABEL } from "@shared/wave214ThirdPartyAuthorityCopy";
import { invitationHandoffCopy, invalidateFounderInvitationQueries, type FounderInvitation } from "@/lib/portfolioFounderInvitation";

type Status = { companyId: string; companyName: string; invitation: FounderInvitation | null;
  registrationState?: "registered" | "pending" | "indeterminate" | "error"; canReissue: boolean };
type Review = Readonly<{ expectedInvitationId: string; oldEmail: string; founderEmail: string;
  founderName: string; authorityTypedName: string; authorityStatementShown: string }>;

function validateStatus(value: unknown, companyId: string): Status {
  const data = value as Status | null;
  if (!data || data.companyId !== companyId || typeof data.companyName !== "string" ||
      typeof data.canReissue !== "boolean" || !Object.hasOwn(data, "invitation")) {
    throw new Error("Invitation status response is invalid.");
  }
  const invite = data.invitation;
  if (invite !== null && (!invite || typeof invite.id !== "string" || typeof invite.email !== "string" ||
      typeof invite.status !== "string" || !invite.handoff ||
      !["smtp", "console", "dry_run", "unknown"].includes(invite.handoff.mode) ||
      !["accepted", "simulated", "failed", "unknown"].includes(invite.handoff.result))) {
    throw new Error("Invitation status response is invalid.");
  }
  return data;
}

/** Partner-only placement. The server separately enforces session, relationship,
 * write role, signed agreement, authority and guarded pending-owner status. */
export function FounderInvitationStatus({ companyId, companyName, canWrite = false }: {
  companyId: string; companyName?: string; canWrite?: boolean;
}) {
  const qc = useQueryClient();
  const endpoint = `/api/partner/me/portfolio-companies/${encodeURIComponent(companyId)}/founder-invitation`;
  const status = useQuery<Status>({
    queryKey: [endpoint], enabled: !!companyId,
    queryFn: async () => validateStatus(await (await apiRequest("GET", endpoint)).json(), companyId),
    refetchOnWindowFocus: true, refetchInterval: 30_000,
  });
  const form = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState("");
  // One-time link is never added to status query data or a read response.
  const [issued, setIssued] = useState<FounderInvitation | null>(null);
  useEffect(() => {
    setEditing(false); setReview(null); setNotice(""); setIssued(null);
  }, [companyId]);
  const invitation = status.data?.invitation;
  const mutation = useMutation({
    mutationFn: async (snapshot: Review) => {
      const response = await apiRequest("POST", `${endpoint}/reissue`, {
        expectedInvitationId: snapshot.expectedInvitationId, founderEmail: snapshot.founderEmail,
        founderName: snapshot.founderName, authorityTypedName: snapshot.authorityTypedName,
        authorityStatementShown: snapshot.authorityStatementShown,
      });
      return response.json() as Promise<{ founderInvite: FounderInvitation }>;
    },
    onSuccess: (data, snapshot) => {
      setReview(null); setEditing(false);
      void invalidateFounderInvitationQueries(qc, companyId);
      if (data.founderInvite.email !== snapshot.founderEmail || (data.founderInvite.name ?? "") !== snapshot.founderName) {
        setIssued(null);
        setNotice("Recipient integrity warning: the server recipient differs from your review. Do not share the link. Refresh the invitation status and contact support.");
        return;
      }
      setIssued(data.founderInvite);
      setNotice(invitationHandoffCopy(data.founderInvite));
    },
    onError: (error: Error) => {
      setNotice(`Invitation was not confirmed. Refresh its status before retrying. ${error.message}`);
      setReview(null); void status.refetch();
    },
  });
  const reviewCurrent = () => {
    if (!form.current || !invitation) return;
    const data = new FormData(form.current);
    const founderEmail = String(data.get("founderEmail") ?? "").trim().toLowerCase();
    const founderName = String(data.get("founderName") ?? "").trim();
    const authorityTypedName = String(data.get("authorityTypedName") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(founderEmail) || !authorityTypedName) {
      setNotice("Enter a valid founder email and your authority confirmation name."); return;
    }
    setNotice("");
    setReview(Object.freeze({ expectedInvitationId: invitation.id, oldEmail: invitation.email,
      founderEmail, founderName, authorityTypedName,
      authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT }));
  };
  const confirm = () => {
    if (!review || !form.current) return;
    const current = new FormData(form.current);
    if (String(current.get("founderEmail") ?? "").trim().toLowerCase() !== review.founderEmail ||
        String(current.get("founderName") ?? "").trim() !== review.founderName ||
        String(current.get("authorityTypedName") ?? "").trim() !== review.authorityTypedName ||
        status.data?.invitation?.id !== review.expectedInvitationId) {
      setReview(null);
      setNotice("Invitation details changed. Review the current recipient again before reissuing.");
      return;
    }
    mutation.mutate(review);
  };
  return <section className="space-y-3 rounded-md border p-3" data-testid="founder-invitation-status">
    <h3 className="font-medium">Founder invitation</h3>
    {status.isLoading && <p>Loading invitation status…</p>}
    {status.isError && <p role="alert">Invitation status is unavailable. <Button type="button" variant="outline" onClick={() => status.refetch()}>Retry status</Button></p>}
    {invitation && <>
      <p>Invitation recipient: <strong>{invitation.email}</strong>{invitation.name ? ` — ${invitation.name}` : ""}</p>
      <p>{invitation.status === "accepted" ? "Founder invitation accepted"
        : status.data?.registrationState === "registered" ? `Company registered; invitation ${invitation.status}`
        : invitation.status === "pending" ? "Awaiting founder registration" : `Invitation ${invitation.status}`}</p>
      {invitation.status === "pending" && invitation.expiresAt && Date.parse(invitation.expiresAt) <= Date.now() &&
        <p className="text-sm">This invitation has expired. An authorized partner can review and reissue it if the company is still unclaimed.</p>}
      <p className="text-sm">{invitationHandoffCopy(invitation)}</p>
      {canWrite && status.data?.canReissue && !status.isError && !editing &&
        <Button type="button" variant="outline" onClick={() => { setEditing(true); setIssued(null); setNotice(""); }}>Review correction or resend</Button>}
    </>}
    {status.data && !invitation && <p>No founder owner invitation is recorded.</p>}
    {editing && invitation && <form ref={form} onSubmit={e => { e.preventDefault(); reviewCurrent(); }}
      onInput={() => setReview(null)} className="space-y-3">
      <label className="block">New invitation email<Input name="founderEmail" aria-label="New invitation email" autoComplete="section-founder email" defaultValue={invitation.email} /></label>
      <label className="block">Founder name<Input name="founderName" aria-label="Founder name" autoComplete="section-founder name" defaultValue={invitation.name ?? ""} /></label>
      <p className="text-sm">{WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT}</p>
      <label className="block">{WAVE214_TYPED_NAME_LABEL}<Input name="authorityTypedName" aria-label="Authority confirmation name" autoComplete="off" /></label>
      <p className="text-sm">Reissue revokes the old claim link. Using the same address sends a replacement invitation, not the old token.</p>
      <Button type="submit" disabled={mutation.isPending}>Review reissue</Button>
      <Button type="button" variant="outline" onClick={() => { setEditing(false); setReview(null); }}>Cancel</Button>
    </form>}
    {notice && <p role="alert">{notice}</p>}
    {issued?.claimUrl && <label className="block">One-time claim link for {issued.email}<Input readOnly value={issued.claimUrl} onFocus={e => e.currentTarget.select()} /></label>}
    {issued?.handoff.statusRecorded === false && <p role="alert">The mail outcome could not be saved. Do not assume the refreshed status confirms this handoff.</p>}
    <Dialog open={!!review} onOpenChange={open => { if (!open && !mutation.isPending) setReview(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Confirm founder invitation reissue</DialogTitle>
          <DialogDescription>Review the exact company and recipient. The previous invitation will be revoked.</DialogDescription></DialogHeader>
        {review && <div className="space-y-3">
          <p>Company: <strong>{status.data?.companyName ?? companyName}</strong></p>
          <p>Old address: <strong>{review.oldEmail}</strong></p>
          <p>New address: <strong>{review.founderEmail}</strong></p>
          <p>Founder name: {review.founderName || "Not provided"}</p>
          <p>Action: revoke the old link, create a new invitation and attempt email handoff.</p>
          <Button type="button" disabled={mutation.isPending} onClick={confirm}>
            {mutation.isPending ? "Reissuing…" : "Confirm reissue"}
          </Button>
          <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setReview(null)}>Back to edit</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </section>;
}
