/**
 * v25.42 R8 — /collective/partners (member-facing)
 *
 * Reads the NEW endpoint GET /api/collective/partners/public, which returns
 * ONLY public partner-card fields (economics redacted server-side). Renders a
 * card grid: name, governance, HQ, member count, AUM band, sectors. The
 * endpoint fails closed with 503 on DB error — we surface that as a friendly
 * "temporarily unavailable" state. Loading / error / empty states handled.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2 } from "lucide-react";

interface PartnerCard {
  id: string;
  name: string;
  logoUrl?: string | null;
  governance?: string | null;
  hq?: string | null;
  memberCount?: number | null;
  aumUsd?: string | number | null;
  sectors?: string[];
}
interface PartnersResponse {
  count?: number;
  total?: number;
  items?: PartnerCard[];
}

/** WAVE 183 · ITEM B FIX 3 — copy for the 403/401 codes `requireCollectiveMember`
 *  can emit WITHOUT a `message` of their own. Where the server does supply a
 *  message, that is used instead: it is already correct and already human. */
const PARTNERS_REFUSAL_FALLBACK: Record<string, string> = {
  not_collective_member:
    "The missing fact is a Collective membership: Capavate holds no membership record for this account, and the partner directory is visible to members. Refreshing will not change this.",
  not_on_cap_table:
    "The missing fact is a cap-table position: this account has no committed holding on record, which is what grants access to the partner directory. Refreshing will not change this.",
  ACCREDITATION_DECLARATION_REQUIRED:
    "The missing fact is your accreditation declaration: Capavate has not recorded one for this account, and it is required before Collective content can be shown. Complete the declaration to continue \u2014 refreshing will not change this.",
  ACCREDITATION_STATUS_UNAVAILABLE:
    "Your accreditation status could not be read for this request, so Capavate cannot confirm you are eligible to see the partner directory. This one may clear on its own.",
  missing_identity:
    "The missing fact is a signed-in session: this request was not authenticated. Sign in again.",
};

const PARTNERS_REFUSAL_GENERIC =
  "This account is not permitted to view the partner directory. This is an access decision, not a loading problem \u2014 refreshing will not change it.";

const PARTNERS_EMPTY_REASON =
  "This is a successful read: Capavate holds no partner organisations for your chapters, so there is nothing to list. It is not a loading failure and it is not a hidden list.";

export default function PartnersDirectory() {
  const { data, isLoading, error } = useQuery<PartnersResponse>({
    queryKey: ["/api/collective/partners/public"],
    queryFn: async () => (await apiRequest("GET", "/api/collective/partners/public")).json(),
    retry: false,
    staleTime: 30_000,
  });

  const unavailable =
    error instanceof ApiError && (error as ApiError).status === 503;

  /* ═════════════════════════════════════════════════════════════════════════
     WAVE 183 · ITEM B FIX 3 — WHY "Couldn't load partners. Please refresh."

     This page classified exactly ONE status: 503. Everything else fell through
     to the red `partners-error` card and its refresh instruction. But
     `GET /api/collective/partners/public` sits behind `requireCollectiveMember`
     (`server/collectiveRoutes.ts`), which answers **403** for a user with no
     Collective membership record — a permanent, correct, deterministic refusal.
     So the live symptom in R154.2 was a policy decision wearing the costume of a
     network glitch, and no amount of refreshing could ever clear it.

     The route already builds a human, accurate `message` for its 403s. The
     client was parsing it and throwing it away. This reads it.

     The 503 branch, the `partners-error` branch and its literal are all left
     exactly as they were: a real DB failure still says the same thing.
     ═════════════════════════════════════════════════════════════════════════ */
  const refusal = (() => {
    if (!(error instanceof ApiError)) return null;
    if (error.status !== 403 && error.status !== 401) return null;
    const payload = error.payload as
      | { error?: string; message?: string; requiresAccreditationDeclaration?: boolean }
      | null
      | undefined;
    const code =
      (payload && typeof payload === "object" ? payload.error : null) ?? error.code ?? null;
    /* Prefer the server's own sentence — it is written for this reader and it
       already names the missing fact. `PARTNERS_REFUSAL_FALLBACK` covers the
       codes that carry no message. */
    const serverMessage =
      payload && typeof payload === "object" && typeof payload.message === "string"
        ? payload.message.trim()
        : "";
    if (serverMessage.length > 0) return serverMessage;
    return PARTNERS_REFUSAL_FALLBACK[String(code)] ?? PARTNERS_REFUSAL_GENERIC;
  })();

  const items = data?.items ?? [];

  /* An AUTHORISED read that returns zero rows is a different fact from a
     refused read, and on this build it is the likelier one: the wave-183 probe
     found `partner_organizations` holding 0 rows. `partners-empty` below already
     says "No partners listed yet." and that remains correct and untouched; this
     only adds the reason as a sibling so a member does not read an empty
     directory as a broken one. */
  const authorisedButEmpty = !isLoading && !error && items.length === 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#1A1A2E" }} data-testid="heading-partners">
          Partners
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Consortium partners in the Capavate network.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="partners-loading">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : unavailable ? (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800" data-testid="partners-unavailable">
          The public partners directory is temporarily unavailable. Please try again shortly.
        </div>
      ) : refusal ? (
        /* WAVE 183 · ITEM B FIX 3. A NEW SIBLING BRANCH placed ABOVE the
           existing `error` arm, never in place of it: a 403/401 is a stated
           access fact, not a load failure, and it gets no "refresh" advice
           because refreshing cannot grant access. Amber, matching the other
           "this is a fact about you" state on this page rather than the red
           reserved for genuine breakage. */
        <div
          className="rounded-md bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900"
          data-testid="partners-access-refused"
        >
          {refusal}
        </div>
      ) : error ? (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700" data-testid="partners-error">
          Couldn't load partners. Please refresh.
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500" data-testid="partners-empty">
          <Building2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No partners listed yet.</p>
          {/* WAVE 183 · ITEM B FIX 3 — a SIBLING under the preserved sentence
              above, distinguishing "your read succeeded and the network holds no
              partners" from "your read failed". Without it, the two are
              indistinguishable on screen, which is how a working page gets
              reported as a broken one. */}
          {authorisedButEmpty && (
            <p className="text-xs mt-2 max-w-md mx-auto" data-testid="partners-empty-reason">
              {PARTNERS_EMPTY_REASON}
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="partners-list">
          {items.map((p) => (
            <Card key={p.id} data-testid={`partner-card-${p.id}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: "#1A1A2E" }}>
                  {p.logoUrl ? (
                    <img src={p.logoUrl} alt="" className="w-6 h-6 rounded object-contain" />
                  ) : (
                    <span className="w-6 h-6 rounded bg-[#cc0001]/15 text-[#cc0001] flex items-center justify-center text-[10px] font-bold">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {p.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {p.governance && (
                    <Badge className="text-[10px] bg-slate-100 text-slate-600">{p.governance}</Badge>
                  )}
                  {p.hq && (
                    <Badge className="text-[10px] bg-slate-100 text-slate-600">{p.hq}</Badge>
                  )}
                  {p.aumUsd != null && p.aumUsd !== "" && (
                    <Badge className="text-[10px] bg-emerald-100 text-emerald-700">AUM {String(p.aumUsd)}</Badge>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{p.memberCount != null ? `${p.memberCount} members` : ""}</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {(p.sectors ?? []).slice(0, 3).map((s) => (
                      <Badge key={s} className="text-[10px] bg-slate-100 text-slate-600">{s}</Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
