/**
 * WAVE 33 · CP-SPV-53 — the INVITEE-facing surface.
 *
 * Backed by `GET /api/investor/me/spv-invitations`.
 *
 * AN ENGINE WITH NO ROUTE, OR A COMPONENT MOUNTED NOWHERE, IS NOT SHIPPED.
 * This component is mounted in `client/src/pages/investor/Portfolio.tsx`,
 * appended as the last sibling of `PageBody`.
 *
 * WHY IT EXISTS. `spv_lp_invite` rows and a GP invite route have existed for
 * several waves, but `server/spvEngineStore.ts:478` excluded `invite_only` from
 * every discovery context for every viewer — so a GP could invite someone to a
 * vehicle that the invitee had no surface anywhere to see. This is that surface.
 *
 * NOT A SECOND PORTAL (ruling A-23 and `spec/LP_SCOPED_VIEW_DESIGN.md`). There
 * is no `client/src/pages/lp/*` and no invitee account type. An invitation is a
 * ROW addressed to an email, resolved against the session identity's own email
 * server-side; there is no id in the URL for one person to point at another.
 *
 * The empty state is a SENTENCE, not a blank. It is authored on the server and
 * printed verbatim, and it says the one thing an invitee actually needs — that
 * an invitation is addressed to an email address, so a missing invitation is
 * usually an address mismatch rather than a system failure.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatMinorOrUnavailable } from "@/lib/moneyDisplay";
import { statusLabel } from "@shared/investorDisplayLabels"; /* WAVE 90 · ITEM 3 (M-3) */

interface InvitedSpv {
  spvId: string;
  name: string;
  sponsorPartnerId: string;
  spvType: string;
  jurisdiction: string;
  status: string;
  currency: string;
  scope: string;
  targetRaiseMinor: number | null;
  minCheckMinor: number | null;
  closeDate: string | null;
  viaInvitation: boolean;
  scopeCopy: string;
}

export function SpvInvitations() {
  const q = useQuery<{ spvs: InvitedSpv[]; emptyCopy: string }>({
    queryKey: ["/api/investor/me/spv-invitations"],
    queryFn: async () => (await apiRequest("GET", "/api/investor/me/spv-invitations")).json(),
  });

  if (q.isLoading) {
    return (
      <div className="mt-8 text-sm text-muted-foreground" data-testid="spv-invitations-loading">
        Loading your vehicle invitations…
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="mt-8 text-sm" data-testid="spv-invitations-unavailable">
        We couldn&rsquo;t load your vehicle invitations. Nothing has been changed — this is a loading
        failure, not a statement that you have none.
      </div>
    );
  }

  const spvs = q.data?.spvs ?? [];

  return (
    <div className="mt-8" data-testid="spv-invitations">
      <h2 className="text-base font-semibold">Vehicle invitations</h2>
      <p className="text-xs text-muted-foreground mt-1">
        Invite-only vehicles a sponsor has invited you to. These are invitations, not positions — you
        hold nothing here until you subscribe.
      </p>

      {spvs.length === 0 ? (
        <p className="mt-3 text-sm" data-testid="spv-invitations-empty">
          {q.data?.emptyCopy ??
            "You have no live invitations to a sponsored vehicle."}
        </p>
      ) : (
        <ul className="mt-3 space-y-3" data-testid="spv-invitations-list">
          {spvs.map((s) => (
            <li
              key={s.spvId}
              className="rounded-md border p-3"
              data-testid={`spv-invitation-${s.spvId}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium" data-testid={`spv-invitation-name-${s.spvId}`}>
                  {s.name}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Invitation
                </span>
              </div>
              {/* WAVE 90 · ITEM 3 (M-3) — `spvType` and `status` are machine enums
                  (`deal_specific`, `signing_open`); the jurisdiction code is an
                  ISO/registry code an LP legitimately reads, so it passes through
                  verbatim. R77: machine values retained as `data-` attributes. */}
              <div className="text-xs text-muted-foreground mt-1" data-spv-type={s.spvType} data-status={s.status}>
                {statusLabel(s.spvType)} · {s.jurisdiction} · {statusLabel(s.status)}
              </div>
              <div className="text-xs mt-2">
                Minimum check:{" "}
                <span data-testid={`spv-invitation-min-${s.spvId}`}>
                  {formatMinorOrUnavailable(s.minCheckMinor, s.currency)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2" data-testid={`spv-invitation-scope-${s.spvId}`}>
                {s.scopeCopy}
              </p>
              {/* ═══════════════════════════════════════════════════════════════
                  WAVE 191 · ITEM D — TELL THE LP WHICH CURRENCY TO SEND.
                  ═══════════════════════════════════════════════════════════════
                  WHAT WAS MISSING. An LP was invited to a vehicle, shown a minimum
                  cheque, and never once told what currency any of it was in. The
                  minimum above formats with `s.currency`, so the LP saw a glyph and
                  had to guess which of several dollars it was; a CAD vehicle and a
                  USD vehicle both read "$". Since Capavate never converts (R156.1),
                  an LP who wires the wrong currency has not underpaid or overpaid —
                  the vehicle simply cannot record what arrived. The currency tag on
                  the vehicle IS the instruction, so it has to be said in words.

                  DERIVED, NEVER NAMED. The code comes from the vehicle record on the
                  invitation payload. No currency is written into this file, and if
                  the record holds none the sentence is not printed at all rather
                  than defaulting to dollars.

                  APPENDED AS A STATIC SIBLING (R143.1): `scopeCopy` above is
                  untouched. */}
              {/^[A-Z]{3}$/.test(s.currency ?? "") && (
                <p className="text-xs text-muted-foreground mt-1" data-testid={`spv-invitation-currency-${s.spvId}`}>
                  This vehicle is denominated in {s.currency}. Your commitment is recorded in {s.currency}, and funds must be delivered in {s.currency}. Capavate does not convert between currencies, so a transfer in any other currency cannot be applied to this commitment.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
