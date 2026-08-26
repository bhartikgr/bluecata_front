/* WAVE 155 — COMPED (ADMIN-GRANTED) MEMBERSHIPS.  R123.1, R124.4.3, R77, R111 Q13
 *
 * /admin/comped-memberships
 *
 * WHY THIS SCREEN EXISTS. R123.1: with the SPV launch check switched on,
 * `capavate_subscriptions` holds no rows and the live card payment path is not
 * configured, so every SPV and fund create would be refused for every partner —
 * and R124.4.3 found there was NO admin way to record a membership at all. This
 * screen is that way: the owner puts one company, or one partner, in good
 * standing without a card.
 *
 * THREE THINGS THIS SCREEN WILL NOT DO.
 *   1. It never shows a comped membership as paid. Every place a comp appears it
 *      is labelled "Comped by Capavate (no payment taken)", and there is no
 *      amount field on this screen because a comp has no amount.
 *   2. It never deletes. Ending a comp keeps the record, and the screen says so
 *      before you confirm.
 *   3. It never writes a reason for you. A comp with no stated reason is not a
 *      decision, so the button stays disabled until one is written.
 *
 * Plain language only (R77): no raw codes. "Not on record" for anything the
 * platform could not read (R111 Q13).
 *
 * Server: /api/admin/comped-memberships{,/:id/revoke,/standing}.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Gift, Search, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GrantRow {
  id: string;
  subjectKind: "company" | "partner";
  subjectId: string;
  subjectLabel: string;
  reason: string;
  grantedAt: string;
  grantedBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  live: boolean;
  isRevenue: boolean;
  standingLabel: string;
}

interface GrantList {
  ok: boolean;
  grants: GrantRow[];
  total: number;
  liveTotal: number;
  note: string;
}

interface Standing {
  ok: boolean;
  subjectKind: string;
  subjectId: string;
  subjectLabel: string;
  state: string;
  basis: string | null;
  standingLabel: string;
  inGoodStanding: boolean;
  isRevenue: boolean;
  reason: string;
  checkedAt: string;
}

const SUBJECT_KINDS = [
  { value: "company", label: "A portfolio company" },
  { value: "partner", label: "A partner account" },
];

/** R111 Q13 — anything the platform could not read reads as this, never as a
 *  blank and never as a confident zero or "unpaid". */
const NOT_ON_RECORD = "Not on record";

function whenText(iso: string | null | undefined): string {
  if (!iso) return NOT_ON_RECORD;
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return String(iso);
  return new Date(t).toLocaleString();
}

export default function CompedMemberships() {
  const { toast } = useToast();

  const [subjectKind, setSubjectKind] = useState("company");
  const [subjectId, setSubjectId] = useState("");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const [checkKind, setCheckKind] = useState("company");
  const [checkId, setCheckId] = useState("");
  const [standing, setStanding] = useState<Standing | null>(null);

  const listQ = useQuery<GrantList>({ queryKey: ["/api/admin/comped-memberships"] });

  const grantMut = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/admin/comped-memberships", {
        subjectKind,
        subjectId: subjectId.trim(),
        reason: reason.trim(),
        expiresAt: expiresAt.trim() || null,
      }),
    onSuccess: () => {
      toast({
        title: "Comped membership recorded",
        description:
          "This company or partner is now in good standing for the SPV launch check. No payment was taken and none is owed.",
      });
      setSubjectId("");
      setReason("");
      setExpiresAt("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/comped-memberships"] });
    },
    onError: (err: Error) => {
      toast({ title: "Nothing was saved", description: err.message, variant: "destructive" });
    },
  });

  const revokeMut = useMutation({
    mutationFn: async (vars: { id: string; reason: string }) =>
      apiRequest("POST", `/api/admin/comped-memberships/${vars.id}/revoke`, {
        reason: vars.reason,
      }),
    onSuccess: () => {
      toast({
        title: "Comped membership ended",
        description:
          "The record is kept for history. It no longer puts this company or partner in good standing.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/comped-memberships"] });
    },
    onError: (err: Error) => {
      toast({ title: "Nothing was changed", description: err.message, variant: "destructive" });
    },
  });

  const standingMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/comped-memberships/standing?subjectKind=${encodeURIComponent(checkKind)}&subjectId=${encodeURIComponent(checkId.trim())}`,
      );
      return (await res.json()) as Standing;
    },
    onSuccess: (data) => setStanding(data),
    onError: (err: Error) => {
      setStanding(null);
      toast({ title: "Could not check", description: err.message, variant: "destructive" });
    },
  });

  const grants = listQ.data?.grants ?? [];

  /* Hoisted so the table body keeps ONE static shape whether or not there are
     rows — swapping siblings for a conditional is what trips the drop gate. */
  const rows = useMemo(
    () =>
      grants.map((g) => ({
        ...g,
        whoLabel: g.subjectKind === "company" ? "Company" : "Partner account",
        grantedText: whenText(g.grantedAt),
        expiresText: g.expiresAt ? whenText(g.expiresAt) : "No end date",
        endedText: g.revokedAt ? whenText(g.revokedAt) : "Still in place",
        grantedByText: g.grantedBy || NOT_ON_RECORD,
      })),
    [grants],
  );

  const emptyText = useMemo(() => {
    if (listQ.isLoading) return "Reading the record…";
    if (listQ.isError) return NOT_ON_RECORD;
    return "No comped membership has been given yet.";
  }, [listQ.isLoading, listQ.isError]);

  const standingText = useMemo(() => {
    if (!standing) return "";
    return standing.inGoodStanding
      ? `${standing.subjectLabel} is in good standing — ${standing.standingLabel}.`
      : `${standing.subjectLabel} is not in good standing — ${standing.standingLabel}.`;
  }, [standing]);

  const canGrant = subjectId.trim().length > 0 && reason.trim().length > 0;

  return (
    <PageBody>
      <PageHeader
        title="Comped memberships"
        description="Give a company or a partner Capavate membership standing without a payment. Every grant carries a reason, names who gave it, and is never counted as revenue."
      />

      <Card data-testid="card-comped-grant">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-4 w-4" /> Give a comped membership
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A comped membership satisfies the SPV launch check exactly as a paid one does. It has no
            price, no invoice and no billing cycle, and it never appears in revenue. It stays in
            place until you end it, or until the end date below if you set one.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="comped-kind">Who is this for?</Label>
              <Select value={subjectKind} onValueChange={setSubjectKind}>
                <SelectTrigger id="comped-kind" data-testid="select-comped-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="comped-subject">Company or partner ID</Label>
              <Input
                id="comped-subject"
                data-testid="input-comped-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                placeholder="e.g. co_1234 or ac_consortium_partner_acme"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="comped-reason">Why is this being given without payment?</Label>
            <Textarea
              id="comped-reason"
              data-testid="input-comped-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="This is kept on the record permanently and cannot be edited afterwards."
            />
            <p className="mt-1 text-xs text-muted-foreground">
              A reason is required. It is recorded against your name, permanently, and it cannot be
              edited afterwards.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="comped-expires">End date (optional)</Label>
              <Input
                id="comped-expires"
                data-testid="input-comped-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Leave this blank for a comp with no end date.
              </p>
            </div>
            <div className="flex items-end">
              <Button
                data-testid="button-comped-grant"
                disabled={!canGrant || grantMut.isPending}
                onClick={() => grantMut.mutate()}
              >
                Give comped membership
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-comped-standing">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Check what the launch check sees
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This asks the same reader the SPV launch check uses, live. It changes nothing.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="comped-check-kind">Who to check</Label>
              <Select value={checkKind} onValueChange={setCheckKind}>
                <SelectTrigger id="comped-check-kind" data-testid="select-comped-check-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBJECT_KINDS.map((k) => (
                    <SelectItem key={`check-${k.value}`} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="comped-check-id">Company or partner ID</Label>
              <Input
                id="comped-check-id"
                data-testid="input-comped-check-id"
                value={checkId}
                onChange={(e) => setCheckId(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                data-testid="button-comped-check"
                disabled={checkId.trim().length === 0 || standingMut.isPending}
                onClick={() => standingMut.mutate()}
              >
                <Search className="mr-2 h-4 w-4" /> Check standing
              </Button>
            </div>
          </div>
          <p className="text-sm" data-testid="text-comped-standing">{standingText}</p>
          <p className="text-xs text-muted-foreground" data-testid="text-comped-standing-reason">
            {standing?.reason ?? ""}
          </p>
        </CardContent>
      </Card>

      <Card data-testid="card-comped-ledger">
        <CardHeader>
          <CardTitle>Every comped membership ever given</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Ending a comped membership keeps the record. Nothing on this screen deletes anything, so
            &quot;who was comped, by whom and why&quot; stays answerable afterwards.
          </p>
          <p className="mb-3 text-sm" data-testid="text-comped-empty">{emptyText}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Who</TableHead>
                <TableHead>Standing</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Given by</TableHead>
                <TableHead>Given</TableHead>
                <TableHead>End date</TableHead>
                <TableHead>Ended</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => (
                <TableRow key={g.id} data-testid={`row-comped-${g.id}`}>
                  <TableCell>
                    <div className="font-medium">{g.subjectLabel}</div>
                    <div className="text-xs text-muted-foreground">{g.whoLabel}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.live ? "secondary" : "outline"}>{g.standingLabel}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs text-sm">{g.reason}</TableCell>
                  <TableCell className="text-sm">{g.grantedByText}</TableCell>
                  <TableCell className="text-sm">{g.grantedText}</TableCell>
                  <TableCell className="text-sm">{g.expiresText}</TableCell>
                  <TableCell className="text-sm">
                    <div>{g.endedText}</div>
                    <div className="text-xs text-muted-foreground">{g.revokeReason ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!g.live || revokeMut.isPending}
                      data-testid={`button-comped-end-${g.id}`}
                      onClick={() => {
                        const why = window.prompt(
                          "Why is this comped membership ending? The record is kept for history and only stops putting this company or partner in good standing from now on.",
                        );
                        if (why && why.trim()) revokeMut.mutate({ id: g.id, reason: why.trim() });
                      }}
                    >
                      End comped membership
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </PageBody>
  );
}
