/**
 * WAVE 36 · ROW 9 (b) — the founder-channels surface.
 *
 * THE ORPHAN. `GET /api/admin/founder-channels/:companyId`
 * (server/track4Routes.ts:690, handler at :124) had ZERO callers anywhere in
 * `client/src` — re-verified at source, not taken from the review: the only
 * other occurrences of the string are the route's own header comment and a
 * comment in server/consortiumLinkStore.ts. Wave 35 · F3 hardened this handler
 * so it emits `null` — never a zero, never a silently FX-converted figure —
 * whenever two or more currencies contributed to a total, and attaches
 * `unavailableReason` plus the list of currencies involved. That honesty had
 * no way to reach a human. This panel is that way.
 *
 * WHY SURFACE RATHER THAN RETIRE. The endpoint answers a question no other
 * surface answers: how a company's raise splits across the DIRECT, COLLECTIVE
 * and PARTNER channels, and which partner or Collective member sourced it.
 * Retiring it would delete a capability, which the standing rules forbid.
 *
 * WHERE IT MOUNTS. As a sibling card APPENDED at the end of the existing
 * detail grid on the admin Company Detail page, next to CompanyMarkPanel —
 * the record it describes. Appended, never inserted: the silent-drop guard
 * reads a card inserted mid-list as a renumbering of its siblings' positional
 * paths and reports untouched cards as removed.
 *
 * MONEY (Rule 4), the whole point of this panel:
 *   · Every amount is INTEGER MINOR UNITS on the wire and is rendered with
 *     `formatMinor()`, which is ISO 4217 exponent-aware. Never `/100`. A JPY
 *     figure (exponent 0) renders with no decimals, a USD figure with two.
 *   · NOTHING IS SUMMED HERE. Not across currencies, not within one. Every
 *     figure displayed is a scalar the server already computed.
 *   · A `null` total is rendered as a REFUSAL that names the reason and lists
 *     the currencies — never as 0, never as a blank, never as an em-dash
 *     pretending to be data. The per-currency breakdown is always shown
 *     alongside, because that array is the authoritative shape and is present
 *     even when the scalar is not.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { formatMinor } from "@/lib/currency";

interface ByCurrency { currency: string; minor: number }

interface ChannelBucket {
  countSCs: number;
  totalMinor: number | null;
  currency: string | null;
  byCurrency?: ByCurrency[];
  unavailableReason?: string;
  currencies?: string[];
}

interface FounderChannelsResponse {
  ok?: boolean;
  companyId?: string;
  totalRaisedMinor: number | null;
  totalRaisedCurrency: string | null;
  totalRaisedByCurrency?: ByCurrency[];
  totalRaisedUnavailableReason?: string;
  currencies?: string[];
  byChannel?: { direct?: ChannelBucket; collective?: ChannelBucket; partner?: ChannelBucket };
  unattributed?: ChannelBucket;
  byPartner?: Array<ChannelBucket & { partnerId: string; partnerName?: string | null }>;
  byCollectiveMember?: Array<ChannelBucket & { userId: string; name?: string | null }>;
}

/** The server's machine reason, said in words a human can act on. An unknown
 *  reason is printed verbatim rather than swallowed — a reason we do not
 *  recognise is still a reason the reader deserves to see. */
function reasonSentence(reason: string | undefined, currencies: string[] | undefined): string {
  const list = (currencies ?? []).join(", ");
  if (reason === "needs_fx_conversion") {
    return list
      ? `No single total: this figure spans ${list}, and the platform does not convert between currencies. The per-currency amounts below are the whole answer.`
      : "No single total: more than one currency contributed, and the platform does not convert between currencies.";
  }
  if (reason === "no_data") return "Not reported — nothing has been raised against this company yet.";
  return reason ? `Not reported — ${reason}.` : "Not reported.";
}

function Scalar({
  minor, currency, reason, currencies, testid,
}: {
  minor: number | null;
  currency: string | null;
  reason?: string;
  currencies?: string[];
  testid: string;
}) {
  if (minor == null || !currency) {
    return (
      <span className="text-xs text-muted-foreground" data-testid={`${testid}-unavailable`}>
        {reasonSentence(reason, currencies)}
      </span>
    );
  }
  return (
    <span className="font-mono text-sm" data-testid={testid}>{formatMinor(minor, currency)}</span>
  );
}

function PerCurrency({ rows, testid }: { rows: ByCurrency[] | undefined; testid: string }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2" data-testid={testid}>
      {rows.map((r) => (
        <span key={r.currency} className="rounded border px-1.5 py-0.5 font-mono text-[11px]" data-testid={`${testid}-${r.currency}`}>
          {formatMinor(r.minor, r.currency)}
        </span>
      ))}
    </div>
  );
}

function BucketLine({ label, b, testid }: { label: string; b: ChannelBucket | undefined; testid: string }) {
  if (!b) return null;
  return (
    <div className="border-b border-border/40 py-2 last:border-0" data-testid={testid}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">{label}</span>
        <Scalar
          minor={b.totalMinor}
          currency={b.currency}
          reason={b.unavailableReason}
          currencies={b.currencies}
          testid={`${testid}-total`}
        />
      </div>
      <div className="text-[11px] text-muted-foreground" data-testid={`${testid}-count`}>
        {b.countSCs} soft {b.countSCs === 1 ? "circle" : "circles"}
      </div>
      <PerCurrency rows={b.byCurrency} testid={`${testid}-by-currency`} />
    </div>
  );
}

export function FounderChannelsPanel({ companyId }: { companyId: string }) {
  const q = useQuery<FounderChannelsResponse>({
    queryKey: ["/api/admin/founder-channels", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/admin/founder-channels/${encodeURIComponent(companyId)}`)).json(),
  });

  return (
    <Card data-testid="admin-founder-channels-panel">
      <CardHeader>
        <CardTitle className="text-sm">Raise by channel</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-[11px] text-muted-foreground" data-testid="admin-founder-channels-note">
          Read live from the founder-channels endpoint. Amounts are never converted between currencies:
          where a total would need conversion the platform says so instead of showing a number.
        </p>

        {q.isLoading ? (
          <div className="text-xs text-muted-foreground" data-testid="admin-founder-channels-loading">Loading…</div>
        ) : q.isError ? (
          <div className="text-xs text-destructive" data-testid="admin-founder-channels-error">
            Could not load the channel breakdown: {(q.error as Error)?.message ?? "request failed"}
          </div>
        ) : !q.data ? (
          <div className="text-xs text-muted-foreground" data-testid="admin-founder-channels-empty">No channel data.</div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3 border-b pb-2">
              <span className="text-xs font-medium">Total raised</span>
              <Scalar
                minor={q.data.totalRaisedMinor}
                currency={q.data.totalRaisedCurrency}
                reason={q.data.totalRaisedUnavailableReason}
                currencies={q.data.currencies}
                testid="admin-founder-channels-total"
              />
            </div>
            <PerCurrency rows={q.data.totalRaisedByCurrency} testid="admin-founder-channels-total-by-currency" />

            <div className="mt-2">
              <BucketLine label="Direct" b={q.data.byChannel?.direct} testid="admin-founder-channels-direct" />
              <BucketLine label="Collective" b={q.data.byChannel?.collective} testid="admin-founder-channels-collective" />
              <BucketLine label="Partner" b={q.data.byChannel?.partner} testid="admin-founder-channels-partner" />
              <BucketLine label="Unattributed" b={q.data.unattributed} testid="admin-founder-channels-unattributed" />
            </div>

            {(q.data.byPartner ?? []).length > 0 && (
              <div className="mt-3" data-testid="admin-founder-channels-by-partner">
                <div className="text-xs font-medium">By partner</div>
                {(q.data.byPartner ?? []).map((p) => (
                  <BucketLine
                    key={p.partnerId}
                    label={p.partnerName || p.partnerId}
                    b={p}
                    testid={`admin-founder-channels-partner-${p.partnerId}`}
                  />
                ))}
              </div>
            )}

            {(q.data.byCollectiveMember ?? []).length > 0 && (
              <div className="mt-3" data-testid="admin-founder-channels-by-member">
                <div className="text-xs font-medium">By Collective member</div>
                {(q.data.byCollectiveMember ?? []).map((m) => (
                  <BucketLine
                    key={m.userId}
                    label={m.name || m.userId}
                    b={m}
                    testid={`admin-founder-channels-member-${m.userId}`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
