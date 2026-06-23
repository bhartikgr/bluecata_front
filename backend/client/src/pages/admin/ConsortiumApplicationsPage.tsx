/**
 * CP Phase B — Admin queue: Consortium-partner applications.
 * v23.4.1 Task D: added "Copy invite link" + "Resend invite" for approved applications.
 *
 * Routes used:
 *   GET   /api/admin/consortium/applications?status=&partner_type=&limit=&offset=
 *   GET   /api/admin/consortium/applications/:id
 *   POST  /api/admin/consortium/applications/:id/review        { status, review_notes? }
 *   POST  /api/admin/consortium/applications/:id/withdraw      { review_notes? }
 *   GET   /api/admin/consortium/applications/:id/invite-link   [v23.4.1]
 *   POST  /api/admin/consortium/applications/:id/resend-invite [v23.4.1]
 *
 * Plus the partner-promotion moderation queue surfaces from
 *   GET   /api/admin/partner/promotions/queue
 *   POST  /api/admin/partner/promotions/:id/{approve|reject|request-changes}
 *
 * Admin-only. No mock data; if the network call fails the page surfaces the
 * error inline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminPageIntro } from "@/components/AdminPageIntro";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Inbox,
  Mail,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

/* ----------------------------- types ----------------------------- */

type AppStatus = "submitted" | "under_review" | "approved" | "rejected" | "withdrawn";
type PartnerType = "vc" | "syndicate" | "family_office" | "angel_network" | "other";

interface InvitePayload {
  inviteLink: string;
  inviteEmailStatus: "pending" | "delivered" | "failed";
  inviteEmailError: string | null;
  sentAt: string | null;
}

interface Application {
  id: string;
  contactName: string;
  contactEmail: string;
  orgName: string;
  partnerType: PartnerType;
  aumRange?: string | null;
  thesisSummary?: string | null;
  expectedChapter?: string | null;
  proposedRoles?: string[] | null;
  refLinks?: string[] | null;
  status: AppStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  /** v23.4.1 — invite payload (present once approved) */
  invitePayload?: InvitePayload | null;
}

interface PromotionRow {
  id: string;
  partnerId: string;
  promotionType: string;
  moderationStatus: "pending" | "approved" | "rejected" | "changes_requested";
  moderationNotes?: string | null;
  moderatedBy?: string | null;
  moderatedAt?: string | null;
  notes?: string | null;
  promotedAt: string;
}

/* ---------------------------- helpers ---------------------------- */

const STATUS_TONES: Record<AppStatus, string> = {
  submitted: "bg-amber-100 text-amber-900",
  under_review: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  withdrawn: "bg-zinc-200 text-zinc-700",
};

const MOD_TONES: Record<PromotionRow["moderationStatus"], string> = {
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-900",
  rejected: "bg-rose-100 text-rose-900",
  changes_requested: "bg-sky-100 text-sky-900",
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = j?.error ?? "";
    } catch {
      detail = await r.text().catch(() => "");
    }
    throw new Error(`HTTP ${r.status}${detail ? `: ${detail}` : ""}`);
  }
  return (await r.json()) as T;
}

/* ----------------------------- page ----------------------------- */

export default function AdminConsortiumApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | AppStatus>("submitted");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [notes, setNotes] = useState<string>("");
  /* v25.16 NM4 — dedicated state for promotion-moderation notes so they
     don't bleed in from the application-review textarea. */
  const [promoNotes, setPromoNotes] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  // v23.4.1 Task D — invite status feedback
  const [inviteMsg, setInviteMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        statusFilter === "all" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
      const [appRes, promRes] = await Promise.all([
        fetchJson<{ rows: Application[]; total: number }>(
          `/api/admin/consortium/applications${qs}`,
        ),
        fetchJson<{ rows: PromotionRow[]; total: number }>(
          `/api/admin/partner/promotions/queue?status=pending`,
        ).catch(() => ({ rows: [], total: 0 })),
      ]);
      setApps(appRes.rows ?? []);
      setPromotions(promRes.rows ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const counts = useMemo(() => {
    const c: Record<AppStatus, number> = {
      submitted: 0,
      under_review: 0,
      approved: 0,
      rejected: 0,
      withdrawn: 0,
    };
    for (const a of apps) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [apps]);

  async function doReview(
    id: string,
    decision: "approved" | "rejected",
  ): Promise<void> {
    setBusy(`${id}:${decision}`);
    try {
      const body = JSON.stringify({
        status: decision,
        review_notes: notes.trim() || undefined,
      });
      await fetchJson(
        `/api/admin/consortium/applications/${encodeURIComponent(id)}/review`,
        { method: "POST", body },
      );
      setNotes("");
      setSelected(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function doWithdraw(id: string): Promise<void> {
    setBusy(`${id}:withdraw`);
    try {
      const body = JSON.stringify({
        review_notes: notes.trim() || undefined,
      });
      await fetchJson(
        `/api/admin/consortium/applications/${encodeURIComponent(id)}/withdraw`,
        { method: "POST", body },
      );
      setNotes("");
      setSelected(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // v23.4.1 Task D: Copy invite link
  async function copyInviteLink(id: string): Promise<void> {
    setBusy(`${id}:invite-link`);
    setInviteMsg(null);
    try {
      const data = await fetchJson<{ inviteLink: string; inviteEmailStatus: string }>(
        `/api/admin/consortium/applications/${encodeURIComponent(id)}/invite-link`,
      );
      await navigator.clipboard.writeText(data.inviteLink);
      setInviteMsg({ id, msg: "Link copied to clipboard.", ok: true });
    } catch (e) {
      setInviteMsg({ id, msg: `Copy failed: ${(e as Error).message}`, ok: false });
    } finally {
      setBusy(null);
    }
  }

  // v23.4.1 Task D: Resend invite email
  async function resendInvite(id: string): Promise<void> {
    setBusy(`${id}:resend`);
    setInviteMsg(null);
    try {
      const data = await fetchJson<{ ok: boolean; inviteEmailStatus: string; inviteLink: string }>(
        `/api/admin/consortium/applications/${encodeURIComponent(id)}/resend-invite`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setInviteMsg({
        id,
        msg: data.inviteEmailStatus === "delivered"
          ? "Invite email sent."
          : `Email not delivered — link available. Status: ${data.inviteEmailStatus}`,
        ok: data.inviteEmailStatus === "delivered",
      });
      await reload();
    } catch (e) {
      setInviteMsg({ id, msg: `Resend failed: ${(e as Error).message}`, ok: false });
    } finally {
      setBusy(null);
    }
  }

  async function moderatePromotion(
    id: string,
    action: "approve" | "reject" | "request-changes",
  ): Promise<void> {
    setBusy(`prom:${id}:${action}`);
    try {
      /* v25.16 NM4 — use the dedicated promoNotes state so the application
         review textarea cannot leak its content into promotion moderation. */
      await fetchJson(
        `/api/admin/partner/promotions/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({ notes: promoNotes.trim() || undefined }),
        },
      );
      setPromoNotes("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Consortium applications"
        description="Inbound applications to join the consortium-partner program and pending promotion moderations. Hash-chained admin actions; SSE-broadcast decisions."
        breadcrumbs={[{ label: "Admin" }, { label: "Consortium applications" }]}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void reload()}
            disabled={loading}
            data-testid="button-reload"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
            Reload
          </Button>
        }
      />
      <PageBody>
        <AdminPageIntro
          guidance={{
            eyebrow: "Partner onboarding",
            title: "Inbound consortium-partner queue",
            description:
              "Each submission via /apply/consortium lands here under status='submitted'. Review the org, contact, AUM range and thesis, then approve or reject. Approval auto-provisions a partner_organizations row + tenant + magic-link invite. The action is hash-chained into the admin audit log and emitted on the SSE 'consortium-apply' topic.",
            warning:
              "Public submissions are rate-limited 5/hr/IP via the 'public:apply' bucket. If a legitimate applicant gets blocked they can retry after 60 minutes — there is NO admin override (rate-limit bypass would violate the SOC 2 brute-force control).",
            positive:
              "Promotion moderation (pending collective deal-room deals) is also surfaced below so the chapter admin has one inbox. Approvals here gate deal visibility for non-partner LPs.",
          }}
          stats={[
            { label: "Submitted", value: counts.submitted, hint: "Awaiting review", tone: counts.submitted > 0 ? "warning" : undefined },
            { label: "Approved", value: counts.approved, tone: "positive" },
            { label: "Rejected", value: counts.rejected, tone: "critical" },
            { label: "Pending promotions", value: promotions.length, hint: "Deal-room moderation" },
          ]}
        />

        {error && (
          <Card className="mb-4 border-rose-200 bg-rose-50">
            <CardContent className="py-3 text-sm text-rose-900 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span data-testid="error-banner">{error}</span>
            </CardContent>
          </Card>
        )}

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Status:</span>
          {(["submitted", "under_review", "approved", "rejected", "withdrawn", "all"] as const).map(
            (f) => (
              <Button
                key={f}
                size="sm"
                variant={statusFilter === f ? "default" : "outline"}
                className={statusFilter === f ? "bg-[hsl(327_77%_30%)] hover:bg-[hsl(327_77%_25%)] h-7" : "h-7"}
                onClick={() => setStatusFilter(f)}
                data-testid={`filter-${f}`}
              >
                {f.replace("_", " ")}
              </Button>
            ),
          )}
          <span className="text-xs text-muted-foreground ml-auto">{apps.length} applications</span>
        </div>

        {/* Applications table */}
        <Card className="mb-6">
          <CardContent className="px-0 max-h-[55vh] overflow-y-auto">
            <table className="w-full text-sm" data-testid="table-applications">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-6 py-2.5">Submitted</th>
                  <th className="text-left font-medium px-3 py-2.5">Org</th>
                  <th className="text-left font-medium px-3 py-2.5">Contact</th>
                  <th className="text-left font-medium px-3 py-2.5">Type</th>
                  <th className="text-left font-medium px-3 py-2.5">AUM</th>
                  <th className="text-left font-medium px-3 py-2.5">Status</th>
                  <th className="text-left font-medium px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {apps.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground text-sm">
                      <Inbox className="h-5 w-5 mx-auto mb-2 opacity-60" />
                      No applications match this filter.
                    </td>
                  </tr>
                )}
                {apps.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-border/60 hover:bg-secondary/40"
                    data-testid={`row-application-${a.id}`}
                  >
                    <td className="px-6 py-3 text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-3">{a.orgName}</td>
                    <td className="px-3 py-3 text-xs">
                      {a.contactName}
                      <div className="text-muted-foreground">{a.contactEmail}</div>
                    </td>
                    <td className="px-3 py-3 text-xs">{a.partnerType}</td>
                    <td className="px-3 py-3 text-xs">{a.aumRange ?? "—"}</td>
                    <td className="px-3 py-3">
                      <Badge className={`${STATUS_TONES[a.status]} border-0`}>{a.status}</Badge>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => {
                          setSelected(a);
                          setNotes(a.reviewNotes ?? "");
                          /* v25.16 NM3 — clear stale invite-msg when the admin
                             switches to a different application row. */
                          setInviteMsg(null);
                        }}
                        data-testid={`button-review-${a.id}`}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Selected application detail */}
        {selected && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-base font-medium">{selected.orgName}</div>
                  <div className="text-xs text-muted-foreground font-mono">{selected.id}</div>
                </div>
                <Badge className={`${STATUS_TONES[selected.status]} border-0`}>
                  {selected.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                <div>
                  <div className="text-muted-foreground">Contact</div>
                  <div>{selected.contactName} · {selected.contactEmail}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Partner type</div>
                  <div>{selected.partnerType} · {selected.aumRange ?? "AUM not provided"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-muted-foreground">Thesis</div>
                  <div className="whitespace-pre-wrap">{selected.thesisSummary ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Expected chapter</div>
                  <div>{selected.expectedChapter ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Proposed roles</div>
                  <div>{(selected.proposedRoles ?? []).join(", ") || "—"}</div>
                </div>
                {selected.refLinks && selected.refLinks.length > 0 && (
                  <div className="col-span-2">
                    <div className="text-muted-foreground">References</div>
                    <ul className="list-disc pl-4">
                      {/* v25.16 NC1 — sanitize applicant-supplied URLs to
                         http(s) only. Previously a javascript:/data: URL would
                         render as a clickable anchor and execute in the admin
                         session on click (stored-XSS / session theft). */}
                      {selected.refLinks.map((u) => {
                        const safe = /^https?:\/\//i.test(u);
                        return (
                          <li key={u}>
                            {safe ? (
                              <a
                                className="underline text-[hsl(327_77%_30%)]"
                                href={u}
                                target="_blank"
                                rel="noreferrer noopener"
                                data-testid={`ref-link-${u}`}
                              >
                                {u}
                              </a>
                            ) : (
                              <span
                                className="text-muted-foreground line-through"
                                title="Reference URL is not http(s); rendered inert."
                                data-testid={`ref-link-blocked-${u}`}
                              >
                                {u} (invalid URL)
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                {selected.reviewedAt && (
                  <div className="col-span-2 text-muted-foreground">
                    Previously reviewed by {selected.reviewedBy ?? "—"} on{" "}
                    {new Date(selected.reviewedAt).toLocaleString()}.
                  </div>
                )}
              </div>
              <label className="block text-xs text-muted-foreground mb-1">Review notes (optional)</label>
              <textarea
                className="w-full text-sm border border-border rounded p-2 mb-3"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason, follow-ups, conditions…"
                data-testid="textarea-review-notes"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  className="bg-emerald-700 hover:bg-emerald-800 h-8"
                  disabled={!!busy || (selected.status !== "submitted" && selected.status !== "under_review")}
                  onClick={() => void doReview(selected.id, "approved")}
                  data-testid="button-approve"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8"
                  disabled={!!busy || (selected.status !== "submitted" && selected.status !== "under_review")}
                  onClick={() => void doReview(selected.id, "rejected")}
                  data-testid="button-reject"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={!!busy || (selected.status === "withdrawn" || selected.status === "approved" || selected.status === "rejected")}
                  onClick={() => void doWithdraw(selected.id)}
                  data-testid="button-withdraw"
                >
                  Withdraw
                </Button>
                {/* v23.4.1 Task D — invite controls for approved applications */}
                {selected.status === "approved" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!!busy}
                      onClick={() => void copyInviteLink(selected.id)}
                      data-testid="button-copy-invite-link"
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" />
                      Copy invite link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={!!busy}
                      onClick={() => void resendInvite(selected.id)}
                      data-testid="button-resend-invite"
                    >
                      <Mail className="h-3.5 w-3.5 mr-1" />
                      Resend invite
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 ml-auto"
                  onClick={() => {
                    setSelected(null);
                    setNotes("");
                    setInviteMsg(null);
                  }}
                >
                  Close
                </Button>
              </div>

              {/* Invite status/feedback message */}
              {inviteMsg && inviteMsg.id === selected.id && (
                <div
                  className={`mt-2 text-xs px-3 py-2 rounded ${inviteMsg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}
                  data-testid="invite-feedback"
                >
                  {inviteMsg.msg}
                </div>
              )}

              {/* Invite email status badge for approved applications */}
              {selected.status === "approved" && selected.invitePayload && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Invite email:</span>
                  <Badge
                    className={[
                      selected.invitePayload.inviteEmailStatus === "delivered" ? "bg-emerald-100 text-emerald-900" : "",
                      selected.invitePayload.inviteEmailStatus === "failed" ? "bg-rose-100 text-rose-900" : "",
                      selected.invitePayload.inviteEmailStatus === "pending" ? "bg-amber-100 text-amber-900" : "",
                      "border-0",
                    ].filter(Boolean).join(" ")}
                    data-testid="badge-invite-status"
                  >
                    {selected.invitePayload.inviteEmailStatus}
                  </Badge>
                  {selected.invitePayload.inviteEmailStatus === "failed" && selected.invitePayload.inviteEmailError && (
                    <span className="text-xs text-rose-700">{selected.invitePayload.inviteEmailError}</span>
                  )}
                  {selected.invitePayload.sentAt && (
                    <span className="text-xs text-muted-foreground">
                      sent {new Date(selected.invitePayload.sentAt).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Promotion moderation queue */}
        <div className="mb-2 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[hsl(327_77%_30%)]" />
          <h2 className="text-sm font-medium">Promotion moderation queue</h2>
          <Badge variant="outline" className="text-xs">{promotions.length} pending</Badge>
        </div>
        <Card>
          <CardContent className="px-0 max-h-[40vh] overflow-y-auto">
            <table className="w-full text-sm" data-testid="table-promotions">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b border-border">
                  <th className="text-left font-medium px-6 py-2.5">Promoted</th>
                  <th className="text-left font-medium px-3 py-2.5">Partner</th>
                  <th className="text-left font-medium px-3 py-2.5">Type</th>
                  <th className="text-left font-medium px-3 py-2.5">Status</th>
                  <th className="text-left font-medium px-3 py-2.5">Notes</th>
                  <th className="text-left font-medium px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {promotions.length === 0 && !loading && (
                  <tr>
                    <td colSpan={6} className="px-6 py-6 text-center text-muted-foreground text-sm">
                      <Clock className="h-5 w-5 mx-auto mb-2 opacity-60" />
                      Nothing pending moderation.
                    </td>
                  </tr>
                )}
                {promotions.map((p) => (
                  <tr key={p.id} className="border-b border-border/60" data-testid={`row-promotion-${p.id}`}>
                    <td className="px-6 py-3 text-xs text-muted-foreground">{new Date(p.promotedAt).toLocaleString()}</td>
                    <td className="px-3 py-3 text-xs font-mono">{p.partnerId}</td>
                    <td className="px-3 py-3 text-xs">{p.promotionType}</td>
                    <td className="px-3 py-3">
                      <Badge className={`${MOD_TONES[p.moderationStatus]} border-0`}>{p.moderationStatus.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{p.notes ?? "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={!!busy}
                          onClick={() => void moderatePromotion(p.id, "approve")}
                          data-testid={`button-promotion-approve-${p.id}`}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={!!busy}
                          onClick={() => void moderatePromotion(p.id, "request-changes")}
                          data-testid={`button-promotion-changes-${p.id}`}
                        >
                          Changes
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7"
                          disabled={!!busy}
                          onClick={() => void moderatePromotion(p.id, "reject")}
                          data-testid={`button-promotion-reject-${p.id}`}
                        >
                          Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
