/**
 * WAVE 10 — EN-3 UI surface: "I invested before I had an account."
 *
 * THE SITUATION THIS SCREEN EXISTS FOR.
 *   An LP subscribes to an SPV by email before they are a platform user. The
 *   subscription route records their position against a SYNTHETIC identifier —
 *   `ext_<first 16 hex of sha256(lowercased email)>` — in the cap-table commit
 *   ledger, which is append-only and sacred. Weeks later they create an
 *   account, receive a real `usr_...` id, sign in, and see an empty portfolio.
 *   The position is intact, correct and immutable, and completely invisible to
 *   the person who owns it.
 *
 * WHY THE FIX IS A CLAIM AND NOT A REPAIR.
 *   The obvious move is to rewrite the ledger rows to the new user id. That is
 *   exactly what an append-only ownership record forbids, and the prohibition
 *   is not bureaucratic: a cap table that gets edited to fix display problems
 *   stops being evidence of anything. So the ledger is never touched. This page
 *   creates a LINK, recorded with who asserted it and when, and revocable.
 *
 * WHY IT IS SAFE TO EXPOSE SELF-SERVE.
 *   The candidate identifier is derived on the SERVER from the caller's own
 *   verified session email. This page cannot submit an identifier, and the
 *   route will not read one from the request body. So the claim reduces to
 *   "show me the rows recorded against the hash of the address I am signed in
 *   as" — a statement the caller can only make about themselves.
 *
 * WHAT IT DELIBERATELY WILL NOT DO.
 *   It will not create a link when the derived identifier has no rows anywhere.
 *   A "successfully linked!" confirmation for an identity with nothing behind
 *   it is a false reassurance to the LP and a meaningless row for the next
 *   audit to explain. The empty case says so plainly and offers the support
 *   path instead.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { AppCard } from "@/components/ui/app-card";
import { Button } from "@/components/ui/button";

type Alias = {
  id: string;
  aliasInvestorId: string;
  canonicalUserId: string;
  matchEmail: string | null;
  basis: string;
  state: "active" | "revoked";
  verifiedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

type IdentityResponse = {
  ok: boolean;
  canonicalUserId: string;
  email: string | null;
  derivedExternalId: string | null;
  aliases: Alias[];
  resolvedIdSet: string[];
};

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 12)}…${id.slice(-4)}` : id;
}

export default function ClaimPositions() {
  const qc = useQueryClient();

  const identityQ = useQuery<IdentityResponse>({
    queryKey: ["/api/me/investor-identity"],
    queryFn: async () => (await apiRequest("GET", "/api/me/investor-identity")).json(),
    retry: false,
  });

  const claimM = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/me/investor-identity/claim", {})).json(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/me/investor-identity"] });
      // The portfolio read widens as soon as the alias exists, so it has to be
      // refetched or the LP claims successfully and still sees an empty page —
      // which is the exact complaint this feature answers.
      qc.invalidateQueries({ queryKey: ["/api/me/cashflows"] });
      qc.invalidateQueries({ queryKey: ["/api/investor/portfolio"] });
    },
  });

  const identity = identityQ.data;
  const activeAliases = (identity?.aliases ?? []).filter((a) => a.state === "active");
  const revokedAliases = (identity?.aliases ?? []).filter((a) => a.state === "revoked");
  const alreadyLinked = activeAliases.length > 0;

  // 404 NOTHING_TO_CLAIM is the expected, correct answer for most users. It is
  // not an error and must not be rendered as one.
  const nothingToClaim =
    claimM.isError && claimM.error instanceof ApiError && claimM.error.status === 404;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-6" data-testid="claim-positions-page">
      <div>
        <h1 className="text-xl font-semibold text-[var(--cv-color-navy)]" data-testid="page-title">
          Earlier investments
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          If you subscribed to a vehicle by email before creating this account, your position was
          recorded against that email address rather than against your login. Linking them here makes
          it visible in your portfolio. Nothing in the investment record itself is changed.
        </p>
      </div>

      {identityQ.isLoading && <div className="text-sm text-slate-500">Checking…</div>}

      {identityQ.isError && (
        <AppCard className="p-4" data-testid="claim-positions-error">
          <div className="text-sm text-rose-800">
            We could not check for earlier investments right now. Please try again shortly.
          </div>
        </AppCard>
      )}

      {identity && !identity.email && (
        <AppCard className="p-4" data-testid="claim-positions-no-email">
          <div className="text-sm text-slate-700">
            Your account has no verified email address, so there is nothing to match an earlier
            investment against. Verify your email first and this check will become available.
          </div>
        </AppCard>
      )}

      {identity?.email && (
        <AppCard className="p-4" data-testid="claim-positions-identity">
          <div className="text-xs uppercase tracking-wide text-slate-500">Signed in as</div>
          <div className="mt-1 font-medium" data-testid="claim-positions-email">{identity.email}</div>
          <div className="mt-3 text-xs text-slate-500">
            Earlier positions taken by email are filed under a derived reference. Yours is{" "}
            <code className="rounded bg-slate-100 px-1" data-testid="claim-positions-derived-id">
              {identity.derivedExternalId ? shortId(identity.derivedExternalId) : "—"}
            </code>
            . It is derived from your address; it is not a second account.
          </div>

          {!alreadyLinked && (
            <div className="mt-4">
              <Button
                onClick={() => claimM.mutate()}
                disabled={claimM.isPending}
                data-testid="claim-positions-button"
              >
                {claimM.isPending ? "Checking…" : "Check for earlier investments"}
              </Button>
            </div>
          )}

          {nothingToClaim && (
            <div
              className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              data-testid="claim-positions-nothing"
            >
              <div className="font-medium">No earlier investments found for this address.</div>
              <div className="mt-1">
                Nothing was linked, because there is nothing to link — we do not create a record for a
                position that does not exist. If you invested using a different email address, ask your
                fund administrator to link it for you; that route is deliberately not self-serve.
              </div>
            </div>
          )}

          {claimM.isError && !nothingToClaim && (
            <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900" data-testid="claim-positions-claim-error">
              We could not complete the link. Nothing was changed. Please contact your fund
              administrator.
            </div>
          )}

          {claimM.isSuccess && (
            <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="claim-positions-success">
              Linked. Your earlier position now appears in your portfolio.
            </div>
          )}
        </AppCard>
      )}

      {alreadyLinked && (
        <AppCard className="p-4" data-testid="claim-positions-linked">
          <div className="text-sm font-medium text-[var(--cv-color-navy)]">Linked references</div>
          <ul className="mt-2 space-y-2 text-sm">
            {activeAliases.map((a) => (
              <li key={a.id} className="flex items-center justify-between" data-testid={`claim-alias-${a.id}`}>
                <span>
                  <code className="rounded bg-slate-100 px-1">{shortId(a.aliasInvestorId)}</code>
                  {a.matchEmail && <span className="ml-2 text-slate-600">{a.matchEmail}</span>}
                </span>
                <span className="text-xs text-slate-500">
                  linked {a.verifiedAt ? new Date(a.verifiedAt).toLocaleDateString() : "—"} · {a.basis.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-xs text-slate-500">
            To remove a link, contact your fund administrator. Unlinking is an administrative action so
            that a mistaken claim leaves a record rather than disappearing.
          </div>
        </AppCard>
      )}

      {/* Revoked links are SHOWN, not hidden. If a claim was made and undone,
          the LP is entitled to see that it happened. */}
      {revokedAliases.length > 0 && (
        <AppCard className="p-4" data-testid="claim-positions-revoked">
          <div className="text-sm font-medium text-slate-700">Previously linked</div>
          <ul className="mt-2 space-y-1 text-sm text-slate-600">
            {revokedAliases.map((a) => (
              <li key={a.id}>
                <code className="rounded bg-slate-100 px-1">{shortId(a.aliasInvestorId)}</code> — removed
                {a.revokedAt ? ` ${new Date(a.revokedAt).toLocaleDateString()}` : ""}
                {a.revokeReason ? ` (${a.revokeReason})` : ""}
              </li>
            ))}
          </ul>
        </AppCard>
      )}
    </div>
  );
}
