/**
 * WAVE 167 · TASK 3.2 — THE OWNER'S "WHO CAN THIS PERSON ACTUALLY REACH?" CHECK.
 *                                                                        R139.3
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════════════
 * `GET /api/comms/audience-rules/:key/preview` shipped in this wave with NO
 * client caller, which is the same defect wave 143 fixed for the toggle route:
 * a confidentiality-inspection tool reachable only from a shell is not an
 * inspection tool the owner has. R139.3 requires the owner to be able to see
 * exactly who is reachable and verify it ON THE LIVE SERVER. This is that
 * surface.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LOAD-BEARING DESIGN NOTES
 * ══════════════════════════════════════════════════════════════════════════════
 *  · EVERY SENTENCE OF THE VERDICT IS SERVER DATA. `statement` and `sourceLabel`
 *    are rendered verbatim. This component does not author a claim about who a
 *    rule reaches, because a locally authored claim is one edit away from
 *    disagreeing with the rule it describes — the same reason
 *    MessagingAudienceRulesPanel does not author rule descriptions.
 *
 *  · NO RAW CODES ON SCREEN (R77). The server's `viewerRole` is a machine token
 *    ("partner", "investor", "unknown"); it is mapped to a sentence here. The
 *    rule key is never printed. Account references ARE shown, because the owner's
 *    whole task is to check a specific person against the live database and there
 *    is nothing else to check them by — they are labelled as what they are.
 *
 *  · "Not on record" FOR ANYTHING UNREADABLE (R111 Q13). A missing role, a
 *    missing source description and a missing statement each render that exact
 *    phrase. They are NOT rendered as blank, as "unknown", or as an empty list,
 *    because on a confidentiality surface an absent value and a value of zero
 *    are different facts and must not look the same.
 *
 *  · ZERO IS A RESULT, NOT AN ABSENCE. A rule that reaches nobody says so in
 *    words. The live symptom this whole wave exists to fix was an empty list that
 *    looked like a working list, so an empty audience here is stated loudly.
 *
 *  · A FAILED CHECK IS STATED, NEVER SHOWN AS AN EMPTY AUDIENCE. If the request
 *    fails, the owner sees a failure. Rendering a failure as "reaches nobody"
 *    would be the exact class of bug task 3.1 of this wave removed from the
 *    dashboard Messages panel.
 *
 *  · READ-ONLY. This component never writes. Toggling stays in the panel that
 *    already owns it, with its confirmation flow intact.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** R111 Q13 — one phrase for every value that cannot be read, in one place, so
 *  no branch can quietly substitute a blank or a guess. */
const NOT_ON_RECORD = "Not on record";

interface PreviewResponse {
  ok?: boolean;
  ruleKey?: string;
  viewerId?: string;
  viewerRole?: string;
  enabledForThisViewer?: boolean;
  appliesToViewerRole?: string;
  sourceLabel?: string;
  audienceCount?: number;
  audienceUserIds?: string[];
  statement?: string;
}

/** R77 — the server's role token is machine vocabulary. Say what it MEANS. An
 *  unrecognised token is reported as unreadable rather than printed raw. */
function describeRole(role: string | undefined): string {
  switch (role) {
    case "partner":
      return "The platform treats this person as a Consortium Partner.";
    case "investor":
      return "The platform treats this person as an investor.";
    case "founder":
      return "The platform treats this person as a founder.";
    case "admin":
      return "The platform treats this person as an administrator.";
    case "unknown":
      return "The platform cannot tell what kind of account this is, so no rule will apply to them.";
    default:
      return NOT_ON_RECORD;
  }
}

/** Plain-language reading of scope AND enablement together — the pair that
 *  actually decides whether the picker changes for this person. */
function describeApplies(p: PreviewResponse): string {
  if (p.enabledForThisViewer === true) {
    return "This rule is ON and it applies to this person right now.";
  }
  if (p.enabledForThisViewer === false) {
    return "This rule does NOT apply to this person right now — either it is switched off, or it is meant for a different kind of account.";
  }
  return NOT_ON_RECORD;
}

export function AudienceRulePreview({ ruleKey }: { ruleKey: string }) {
  const [viewerId, setViewerId] = useState("");
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const check = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest(
        "GET",
        `/api/comms/audience-rules/${encodeURIComponent(ruleKey)}/preview?viewerId=${encodeURIComponent(id)}`,
      );
      return (await res.json()) as PreviewResponse;
    },
    onSuccess: (data) => {
      setFailure(null);
      setResult(data);
    },
    onError: () => {
      /* A FAILED CHECK IS NOT AN EMPTY AUDIENCE. The previous result is cleared
         so a stale verdict can never be read as the answer to a new question. */
      setResult(null);
      setFailure(
        "We couldn't check this person just now. Nothing has changed about who can message whom — this is only the check that failed. Confirm the account reference is right and try again.",
      );
    },
  });

  /* Hoisted so the branches below are static sibling JSX with fixed text nodes,
     rather than one node whose wording varies with the response. */
  const view = useMemo(() => {
    if (!result) return null;
    const ids = Array.isArray(result.audienceUserIds) ? result.audienceUserIds : [];
    return {
      /* Server-authored verdict, verbatim. Unreadable → NOT_ON_RECORD. */
      statement: typeof result.statement === "string" && result.statement.length > 0 ? result.statement : NOT_ON_RECORD,
      role: describeRole(result.viewerRole),
      applies: describeApplies(result),
      source:
        typeof result.sourceLabel === "string" && result.sourceLabel.length > 0
          ? result.sourceLabel
          : NOT_ON_RECORD,
      count: typeof result.audienceCount === "number" ? result.audienceCount : null,
      ids,
      /* Zero is a RESULT. Distinguished from "we could not read the count". */
      reachesNobody: typeof result.audienceCount === "number" && result.audienceCount === 0,
    };
  }, [result]);

  const trimmed = viewerId.trim();

  return (
    <div className="mt-2 rounded-md border border-border/60 p-2" data-testid={`audience-preview-${ruleKey}`}>
      <p className="text-xs text-muted-foreground" data-testid={`audience-preview-intro-${ruleKey}`}>
        Check one person against the live database: enter their account reference and this shows
        exactly who this rule would make reachable for them, right now, on this server. It is a
        read-only check — nothing is changed by running it.
      </p>

      <div className="mt-2 flex gap-2">
        <Input
          value={viewerId}
          onChange={(e) => setViewerId(e.target.value)}
          placeholder="Account reference of the person to check"
          className="h-8 text-xs"
          data-testid={`audience-preview-input-${ruleKey}`}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={trimmed.length === 0 || check.isPending}
          onClick={() => check.mutate(trimmed)}
          data-testid={`audience-preview-run-${ruleKey}`}
        >
          Check who this reaches
        </Button>
      </div>

      {check.isPending ? (
        <p className="mt-2 text-xs" data-testid={`audience-preview-checking-${ruleKey}`}>
          Checking against the live database…
        </p>
      ) : null}

      {failure !== null ? (
        <p className="mt-2 text-xs text-destructive" role="status" data-testid={`audience-preview-failed-${ruleKey}`}>
          {failure}
        </p>
      ) : null}

      {view !== null ? (
        <div className="mt-2 space-y-1" data-testid={`audience-preview-result-${ruleKey}`}>
          <p className="text-xs font-medium" data-testid={`audience-preview-statement-${ruleKey}`}>
            {view.statement}
          </p>
          <p className="text-xs text-muted-foreground" data-testid={`audience-preview-role-${ruleKey}`}>
            {view.role}
          </p>
          <p className="text-xs text-muted-foreground" data-testid={`audience-preview-applies-${ruleKey}`}>
            {view.applies}
          </p>
          <p className="text-xs text-muted-foreground" data-testid={`audience-preview-source-${ruleKey}`}>
            Where this audience comes from: {view.source}
          </p>

          {view.reachesNobody ? (
            <p className="text-xs" data-testid={`audience-preview-nobody-${ruleKey}`}>
              This rule reaches nobody for this person. That is a real result, not a failure to
              look: either they have no relationships of this kind on record, or the records this
              rule reads are empty.
            </p>
          ) : null}

          {view.count === null ? (
            <p className="text-xs" data-testid={`audience-preview-count-unreadable-${ruleKey}`}>
              Number of people reachable: {NOT_ON_RECORD}
            </p>
          ) : null}

          {view.ids.length > 0 ? (
            <div data-testid={`audience-preview-people-${ruleKey}`}>
              <p className="text-xs font-medium">
                Everyone this rule makes reachable for that person, by account reference:
              </p>
              <ul className="mt-1 space-y-0.5">
                {view.ids.map((id) => (
                  <li key={id} className="text-xs font-mono" data-testid={`audience-preview-person-${id}`}>
                    {id}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                Names are deliberately not shown here. This check exists to protect people&rsquo;s
                privacy, so it does not hand out the identities it is meant to guard.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
