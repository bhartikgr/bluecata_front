/**
 * WAVE 189 · ITEM B · R159.6 clause 3 — THE DISCLOSURE TO THE LP.
 * ══════════════════════════════════════════════════════════════════════════════
 * Owner: *"Team-visible. Go with your recommendation and global investor grade best
 * practice."* — and the recommendation the owner adopted was explicit that *"the
 * disclosure is what makes it investor-grade; without it this is a privacy change
 * made silently."*
 *
 * WHAT THIS SAYS, AND WHY IT SAYS IT HERE. The limited partner reads their thread on
 * the Messages surface, so the fact that the thread is a firm record is stated on
 * that surface, in plain language, next to the conversation it describes. It is a
 * statement of fact, not a consent request: the LP is being TOLD, which is what the
 * ruling requires.
 *
 * IT NEVER APPEARS WHEN IT WOULD BE FALSE. A privacy notice that is wrong is worse
 * than no notice, so this renders ONLY when the server confirms that at least one of
 * this investor's own conversations actually has an active partner-firm team member
 * on the other side. `GET /api/messages/lp-firm-visibility` answers exactly that and
 * nothing else — no thread ids, no names of individuals, no message content.
 *
 * A READ FAILURE IS STATED, NOT SWALLOWED. If the endpoint cannot be read, this
 * renders a stated read-failure rather than a reassuring blank, so an LP is never
 * silently left believing a conversation is private when the page simply failed to
 * establish who can see it. It is the same discipline `MessagingAudienceNotice`
 * applies to the audience policy, for the same reason.
 *
 * IT IS AN ADDITIVE SIBLING (guard rule 4 / R143.1). It mounts beside the existing
 * Messages surface and replaces no text node, so no existing copy string is removed.
 * All copy is imported as static exported literals from the server-side rule module,
 * so the disclosure the LP reads and the fence the server enforces cannot drift apart.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Users, AlertTriangle } from "lucide-react";
import {
  LP_THREAD_FIRM_VISIBILITY_HEADLINE,
  LP_THREAD_FIRM_VISIBILITY_BODY,
  LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM,
} from "@shared/lpThreadFirmVisibilityCopy";

export interface LpFirmVisibilityPayload {
  visible: boolean;
  firmNames: string[];
}

export function LpThreadFirmVisibilityNotice({ className }: { className?: string }) {
  const q = useQuery<LpFirmVisibilityPayload>({
    queryKey: ["/api/messages/lp-firm-visibility"],
    queryFn: async () => (await apiRequest("GET", "/api/messages/lp-firm-visibility")).json(),
  });

  if (q.isLoading) return null;

  /* A MALFORMED 200 IS A READ FAILURE, NOT A CRASH. The shape check is deliberately
     narrow — only the two fields this component dereferences — so a valid payload can
     never be downgraded into a false refusal. */
  const usable =
    !!q.data && typeof q.data.visible === "boolean" && Array.isArray(q.data.firmNames);

  if (q.isError || !usable) {
    return (
      <div
        data-testid="lp-firm-visibility-unavailable"
        className={`rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive ${className ?? ""}`}
      >
        <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
        We could not check who is able to read your conversations, so this page cannot
        tell you right now. This is a read failure, not a statement that your messages
        are private to one person.
      </div>
    );
  }

  /* NOT FIRM-VISIBLE — say nothing rather than say something untrue. */
  if (!q.data!.visible) return null;

  const names = q.data!.firmNames.filter((n) => typeof n === "string" && n.trim().length > 0);

  return (
    <div
      data-testid="lp-firm-visibility-notice"
      className={`rounded-md border border-border bg-muted/40 p-3 text-xs ${className ?? ""}`}
    >
      <Users className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
      <span className="font-medium" data-testid="lp-firm-visibility-headline">
        {LP_THREAD_FIRM_VISIBILITY_HEADLINE}
      </span>
      <p className="mt-1 leading-relaxed" data-testid="lp-firm-visibility-body">
        {LP_THREAD_FIRM_VISIBILITY_BODY}
      </p>
      {/* The firm's registered name is shown ONLY when it is on file. It usually is
          not — no server path writes `partner_organizations` — so the fallback is a
          stated phrase, never a blank and never an invented org name. */}
      <p className="mt-1 opacity-80" data-testid="lp-firm-visibility-firm">
        {names.length > 0 ? names.join(", ") : LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM}
      </p>
    </div>
  );
}

export default LpThreadFirmVisibilityNotice;
