/* WAVE 156 — THE SPV LAUNCH CHECK: ADMIN SCREEN.   R124.4.1, R114.3, R77, R111 Q13
 *
 * /admin/spv-launch-gate
 *
 * WHY THIS SCREEN EXISTS. R114.3 makes the admin override a HARD release
 * condition, and R124.4.1 found the override had no user interface at all:
 * `grep -rn "spv-launch-gate|spvLaunchGate|launch-gate" client/src` returned
 * nothing before this file. The server side existed and was reviewed in wave 154;
 * the owner simply could not reach it. Nothing here invents server behaviour: it
 * drives the endpoints registered in server/adminSpvLaunchGateRoutes.ts.
 *
 * WHAT IS DELIBERATELY NOT HERE.
 *   · No way to switch the no-company policy or the freeze flag. Those are rule
 *     changes, not operational switches, and neither has a writer.
 *   · No way to delete an override. Withdrawing keeps the record (wave 154).
 *
 * Plain language only (R77): no raw codes on screen. "Not on record" wherever the
 * platform could not read the answer (R111 Q13) — never a confident guess.
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
import { AlertTriangle, PlayCircle, Settings2, ShieldOff } from "lucide-react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const NOT_ON_RECORD = "Not on record";

interface SettingsPayload {
  ok: boolean;
  mode: "enforced" | "warn";
  noCompanyPolicy: string;
  freezeEnabled: boolean;
  note?: string;
}

interface OverrideRow {
  id: string;
  scopeKind: "spv" | "company";
  scopeId: string;
  scopeLabel: string;
  reason: string;
  createdAt: string;
  createdBy: string;
  revokedAt: string | null;
  revokedBy: string | null;
  live: boolean;
}

interface EvaluateCompany {
  companyId: string;
  companyName: string;
  state: string;
  stateLabel: string;
  standingLabel: string;
  basis: string | null;
  compedGrantId: string | null;
  reason: string;
  checkedAt: string;
}

interface EvaluatePayload {
  ok: boolean;
  spvId: string;
  mode: string;
  launchAllowed: boolean;
  warned: boolean;
  frozenForNewMoney: boolean;
  distributionsFrozen: boolean;
  transfersFrozen: boolean;
  override: { id?: string; reason?: string } | null;
  companies: EvaluateCompany[];
  message: string;
}

/** The two modes, in the words an owner uses, not the words the row stores. */
const MODES = [
  { value: "enforced", label: "Refuse the launch (strict)" },
  { value: "warn", label: "Allow the launch and record a warning" },
];

function whenText(iso: string | null | undefined): string {
  if (!iso) return NOT_ON_RECORD;
  const t = Date.parse(String(iso));
  if (Number.isNaN(t)) return String(iso);
  return new Date(t).toLocaleString();
}

export default function SpvLaunchGate() {
  const { toast } = useToast();

  const [pendingMode, setPendingMode] = useState("");
  const [modeReason, setModeReason] = useState("");

  const [scopeKind, setScopeKind] = useState("company");
  const [scopeId, setScopeId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const [dryRunId, setDryRunId] = useState("");
  const [dryRun, setDryRun] = useState<EvaluatePayload | null>(null);

  const settingsQ = useQuery<SettingsPayload>({
    queryKey: ["/api/admin/spv-launch-gate/settings"],
  });
  const ledgerQ = useQuery<{ ok: boolean; overrides: OverrideRow[]; total: number }>({
    queryKey: ["/api/admin/spv-launch-gate/overrides"],
  });

  const modeMut = useMutation({
    mutationFn: async () =>
      apiRequest("PUT", "/api/admin/spv-launch-gate/settings", {
        mode: pendingMode,
        reason: modeReason.trim(),
      }),
    onSuccess: async (res) => {
      const body = await res.json();
      toast({ title: "Launch check updated", description: String(body?.message ?? "") });
      setModeReason("");
      setPendingMode("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spv-launch-gate/settings"] });
    },
    onError: (err: Error) =>
      toast({ title: "Nothing was changed", description: err.message, variant: "destructive" }),
  });

  const grantMut = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/admin/spv-launch-gate/overrides", {
        scopeKind,
        scopeId: scopeId.trim(),
        reason: overrideReason.trim(),
      }),
    onSuccess: () => {
      toast({
        title: "Override granted",
        description:
          "This company or SPV can now launch even when the membership check would refuse it. The reason and your name are on the record permanently.",
      });
      setScopeId("");
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spv-launch-gate/overrides"] });
    },
    onError: (err: Error) =>
      toast({ title: "Nothing was saved", description: err.message, variant: "destructive" }),
  });

  const revokeMut = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("POST", `/api/admin/spv-launch-gate/overrides/${id}/revoke`, {}),
    onSuccess: () => {
      toast({
        title: "Override withdrawn",
        description:
          "The record is kept for history. It no longer excuses this company or SPV from the membership check.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/spv-launch-gate/overrides"] });
    },
    onError: (err: Error) =>
      toast({ title: "Nothing was changed", description: err.message, variant: "destructive" }),
  });

  const dryRunMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/spv-launch-gate/evaluate/${encodeURIComponent(dryRunId.trim())}`,
      );
      return (await res.json()) as EvaluatePayload;
    },
    onSuccess: (data) => setDryRun(data),
    onError: (err: Error) => {
      setDryRun(null);
      toast({ title: "Could not run the check", description: err.message, variant: "destructive" });
    },
  });

  /* ══ WAVE 159 · R126.2 — THIS SCREEN USED TO CLAIM A PROTECTION IT DOES NOT HAVE.
     The stored setting says `enforced`, and this text used to read "Right now the
     launch is REFUSED when a company in it is not a current member." The
     independent review proved the check is NOT CONNECTED to any create path — no
     product route imports `enforceLaunchGate` — so nothing is refused by it and
     nothing ever was. The owner's first reading of this screen was an assurance he
     did not actually hold.

     Every claim is therefore CONDITIONAL until the check is connected: the setting
     is reported honestly as a setting, and the not-connected notice above states
     plainly that no SPV or fund creation is currently being refused. The mode
     values and the default are unchanged (R122/R123) — this wave changes only what
     the screen SAYS. */
  const modeText = useMemo(() => {
    if (settingsQ.isLoading) return "Reading the setting…";
    const m = settingsQ.data?.mode;
    if (m === "enforced") {
      return "The setting is on Strict. When the check is connected, Strict would refuse the launch whenever a company in it is not a current member.";
    }
    if (m === "warn") {
      return "The setting is on Warning. When the check is connected, Warning would allow the launch and record a warning instead of refusing it.";
    }
    return NOT_ON_RECORD;
  }, [settingsQ.isLoading, settingsQ.data?.mode]);

  const policyText = useMemo(() => {
    const p = settingsQ.data?.noCompanyPolicy;
    if (p === "require_company") {
      return "A vehicle that names no company is checked against the membership of the partner creating it. It is never refused merely because no company exists.";
    }
    if (p === "allow") return "A vehicle that names no company is not checked at all.";
    return NOT_ON_RECORD;
  }, [settingsQ.data?.noCompanyPolicy]);

  const freezeText = useMemo(() => {
    const f = settingsQ.data?.freezeEnabled;
    if (f === true) {
      return "A live SPV whose company membership has lapsed stops taking NEW money. Distributions and transfers are never stopped.";
    }
    if (f === false) return "A lapsed membership does not stop a live SPV taking new money.";
    return NOT_ON_RECORD;
  }, [settingsQ.data?.freezeEnabled]);

  const overrides = ledgerQ.data?.overrides ?? [];

  /* Hoisted so the ledger body keeps ONE static shape whether or not there are
     rows — swapping siblings for a conditional trips the drop gate. */
  const ledgerRows = useMemo(
    () =>
      overrides.map((o) => ({
        ...o,
        kindLabel: o.scopeKind === "company" ? "Company" : "One SPV",
        createdText: whenText(o.createdAt),
        createdByText: o.createdBy || NOT_ON_RECORD,
        endedText: o.revokedAt ? whenText(o.revokedAt) : "Still in place",
        statusLabel: o.live ? "In place" : "Withdrawn",
      })),
    [overrides],
  );

  const ledgerEmptyText = useMemo(() => {
    if (ledgerQ.isLoading) return "Reading the record…";
    if (ledgerQ.isError) return NOT_ON_RECORD;
    return "No override has ever been granted.";
  }, [ledgerQ.isLoading, ledgerQ.isError]);

  const dryRunRows = useMemo(
    () =>
      (dryRun?.companies ?? []).map((c) => ({
        ...c,
        checkedText: whenText(c.checkedAt),
        /* WAVE 155 — a comped membership is named as comped here, never "Paid". */
        standing: c.standingLabel || NOT_ON_RECORD,
      })),
    [dryRun],
  );

  const dryRunHeadline = useMemo(() => {
    if (!dryRun) return "";
    const verdict = dryRun.launchAllowed
      ? "As things stand, this WOULD be allowed to launch."
      : "As things stand, this WOULD be refused.";
    const warn = dryRun.warned
      ? " A warning would be recorded because the launch check is not strict right now."
      : "";
    const frozen = dryRun.frozenForNewMoney
      ? " It is also not taking new money, because a company membership has lapsed. Distributions and transfers are unaffected."
      : "";
    return `${verdict}${warn}${frozen}`;
  }, [dryRun]);

  const dryRunDetail = useMemo(() => dryRun?.message ?? "", [dryRun]);

  const canChangeMode = pendingMode.length > 0 && modeReason.trim().length > 0;
  const canGrant = scopeId.trim().length > 0 && overrideReason.trim().length > 0;

  return (
    <PageBody>
      <PageHeader
        title="SPV launch check"
        description="The setting that would decide whether creating or launching an SPV or fund is refused when a company is not a current Capavate member — and who would be excused from it. Read the notice below before relying on it."
      />

      {/* W159 · R126.2 — the disclosure comes BEFORE any mode language, because a
          reader who stops after one paragraph must not walk away believing a
          protection is running. Plain language, no code names (R77). */}
      <div
        className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900"
        data-testid="notice-launch-gate-not-connected"
      >
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" /> This check is built but not yet connected
        </div>
        <p className="mt-1" data-testid="text-launch-gate-not-connected">
          Nothing on this screen is refusing anything today. The membership check has been
          built and can be configured and tested here, but it is not yet connected to the
          screens that create SPVs and funds — so no SPV or fund creation is currently being
          refused because of a missing membership. Everything below describes what would
          happen once it is connected. Use the dry run to see who would be affected.
        </p>
      </div>

      <Card data-testid="card-launch-gate-settings">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> How strict the check is
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm font-medium" data-testid="text-launch-gate-mode">{modeText}</p>
          <p className="text-sm text-muted-foreground" data-testid="text-launch-gate-policy">
            {policyText}
          </p>
          <p className="text-sm text-muted-foreground" data-testid="text-launch-gate-freeze">
            {freezeText}
          </p>
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" /> Before you set this to strict
            </div>
            <p className="mt-1">
              Once the check is connected, Strict would refuse every SPV and fund create for any
              company with no membership on record. Setting it to Strict today changes the recorded
              setting only; it does not begin refusing anything.
              Give the companies and partners you expect to transact a membership first — a paid one,
              or a comped one on the{" "}
              <Link href="/admin/comped-memberships" className="underline" data-testid="link-comped-memberships">
                comped memberships screen
              </Link>
              . Use the dry run below to see exactly who would be refused.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="gate-mode">Change it to</Label>
              <Select value={pendingMode} onValueChange={setPendingMode}>
                <SelectTrigger id="gate-mode" data-testid="select-launch-gate-mode">
                  <SelectValue placeholder="Choose how strict the check should be" />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="gate-mode-reason">Why is it changing?</Label>
              <Input
                id="gate-mode-reason"
                data-testid="input-launch-gate-mode-reason"
                value={modeReason}
                onChange={(e) => setModeReason(e.target.value)}
                placeholder="Recorded permanently in the settings history"
              />
            </div>
          </div>
          <Button
            data-testid="button-launch-gate-save-mode"
            disabled={!canChangeMode || modeMut.isPending}
            onClick={() => modeMut.mutate()}
          >
            Save how strict the check is
          </Button>
        </CardContent>
      </Card>

      <Card data-testid="card-launch-gate-dry-run">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlayCircle className="h-4 w-4" /> Dry run — what would happen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This runs the real check and changes nothing: no launch is attempted, no record is
            written. It answers for one SPV or fund and for every company inside it. To check a single
            company or partner on its own, use the{" "}
            <Link href="/admin/comped-memberships" className="underline" data-testid="link-standing-check">
              comped memberships screen
            </Link>
            .
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Label htmlFor="gate-dry-run-id">SPV or fund ID</Label>
              <Input
                id="gate-dry-run-id"
                data-testid="input-launch-gate-dry-run-id"
                value={dryRunId}
                onChange={(e) => setDryRunId(e.target.value)}
                placeholder="e.g. spv_1234"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                data-testid="button-launch-gate-dry-run"
                disabled={dryRunId.trim().length === 0 || dryRunMut.isPending}
                onClick={() => dryRunMut.mutate()}
              >
                Run the check
              </Button>
            </div>
          </div>
          <p className="text-sm font-medium" data-testid="text-launch-gate-dry-run-verdict">
            {dryRunHeadline}
          </p>
          <p className="text-sm text-muted-foreground" data-testid="text-launch-gate-dry-run-detail">
            {dryRunDetail}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Membership standing</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Checked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dryRunRows.map((c) => (
                <TableRow key={c.companyId} data-testid={`row-launch-gate-company-${c.companyId}`}>
                  <TableCell className="font-medium">{c.companyName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{c.standing}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md text-sm">{c.reason}</TableCell>
                  <TableCell className="text-sm">{c.checkedText}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card data-testid="card-launch-gate-overrides">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldOff className="h-4 w-4" /> Excuse a company or one SPV from the check
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            An override lets a launch through even when the membership check would refuse it. It does
            not create a membership and it is not a payment — use it when the decision has been made
            outside the platform. Withdrawing an override keeps the record.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="gate-scope-kind">What is being excused?</Label>
              <Select value={scopeKind} onValueChange={setScopeKind}>
                <SelectTrigger id="gate-scope-kind" data-testid="select-launch-gate-scope-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">A company, everywhere it appears</SelectItem>
                  <SelectItem value="spv">One SPV or fund only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="gate-scope-id">Company or SPV ID</Label>
              <Input
                id="gate-scope-id"
                data-testid="input-launch-gate-scope-id"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="gate-override-reason">Why is it being excused?</Label>
            <Textarea
              id="gate-override-reason"
              data-testid="input-launch-gate-override-reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Required. Recorded permanently against your name and cannot be edited afterwards."
            />
          </div>
          <Button
            data-testid="button-launch-gate-grant-override"
            disabled={!canGrant || grantMut.isPending}
            onClick={() => grantMut.mutate()}
          >
            Grant the override
          </Button>

          <p className="text-sm" data-testid="text-launch-gate-ledger-empty">{ledgerEmptyText}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Granted by</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead>Withdrawn</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerRows.map((o) => (
                <TableRow key={o.id} data-testid={`row-launch-gate-override-${o.id}`}>
                  <TableCell>
                    <div className="font-medium">{o.scopeLabel}</div>
                    <div className="text-xs text-muted-foreground">{o.kindLabel}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={o.live ? "secondary" : "outline"}>{o.statusLabel}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs text-sm">{o.reason}</TableCell>
                  <TableCell className="text-sm">{o.createdByText}</TableCell>
                  <TableCell className="text-sm">{o.createdText}</TableCell>
                  <TableCell className="text-sm">{o.endedText}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!o.live || revokeMut.isPending}
                      data-testid={`button-launch-gate-withdraw-${o.id}`}
                      onClick={() => {
                        const ok = window.confirm(
                          "Withdraw this override? The record is kept for history and only stops excusing this company or SPV from now on.",
                        );
                        if (ok) revokeMut.mutate(o.id);
                      }}
                    >
                      Withdraw override
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
