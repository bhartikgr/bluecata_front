/**
 * WAVE 143 · BATCH 1 · ITEM 4 — THE OWNER'S SWITCH FOR THE MESSAGING AUDIENCE
 * RULES.                                                  R108.1 item 3 · R95
 *
 * WHY THIS EXISTS. `POST /api/comms/audience-rules/:key` has shipped behind
 * `requireAdmin` since WAVE 33 (server/commsStore.ts:3528) and had **ZERO client
 * callers** — `grep -rn "audience-rules" client/src` returned nothing. So the
 * mechanism the platform advertises as "the owner rules on a pending audience
 * question and the picker changes on the next request" was reachable only by an
 * engineer with a shell. Functionality that exists but cannot be seen or operated
 * is not shipped. This panel is the first client caller of that route.
 *
 * R108.1 item 3 makes it mandatory in THIS wave, for a specific reason: this wave
 * enables `partner_team_peers` and deliberately leaves
 * `partner_engaged_company_people` DISABLED on confidentiality grounds. Both of
 * those are the owner's to revisit, so the owner must be able to SEE both rules
 * and their enabled state, and TOGGLE either, without a developer.
 *
 * LOAD-BEARING DESIGN NOTES
 *
 *  · EVERY RULE STRING IS SERVER DATA. `description` and `recommendedDefault`
 *    come from `comms_audience_rules` rows (via GET /api/comms/audience-policy,
 *    commsStore.ts:3498-3505) and are rendered verbatim. This panel does not
 *    author a label for any rule, because a locally authored description is one
 *    edit away from disagreeing with the rule it describes.
 *  · NO NEW READ ENDPOINT. The policy endpoint already returns everything needed.
 *  · A FAILED READ IS STATED, NOT BLANK. A blank panel reads as "no rules exist",
 *    which would be a lie about an audience gate. Same idiom as
 *    MessagingAudienceNotice.tsx:86-97.
 *  · A FAILED WRITE SHOWS THE SERVER'S OWN ERROR AND DOES NOT MOVE THE SWITCH.
 *    The switch renders from server state only — there is no optimistic local
 *    state — so a 404 `unknown_rule` or a 500 `write_failed` leaves it exactly
 *    where it was. An audience gate that LOOKS flipped but is not is worse than
 *    one that refuses.
 *  · THE DELIBERATE-OFF RULE SAYS SO. `partner_engaged_company_people` is not
 *    merely off; it is off pending a privacy fix, and the panel states that in
 *    terms so nobody switches it on believing it is an oversight.
 *  · After a successful write both `/api/comms/audience-policy` and
 *    `/api/comms/users` are invalidated. The server-side reader has NO cache
 *    (commsAudienceRules.ts module doc: every call re-reads SQLite), so the effect
 *    is live on the next request.
 */
/*
 * WAVE 144 · ITEM 5 — A STATED EXPOSURE AND AN EXPLICIT CONFIRMATION.
 *
 * Wave 143 shipped this panel with the held-off rule ONE CLICK from live: the
 * Switch called `toggle.mutate` directly for every rule, so the rule R108.1
 * holds off on confidentiality grounds was operated exactly like
 * `follow_peer`. Post-build Review 2 flagged that as a moderate finding.
 *
 * What changed, and what deliberately did NOT:
 *  · The owner is still not prevented from acting. R108.1 item 3 requires the
 *    owner to be able to revisit either partner rule without a developer.
 *  · ENABLING a rule the SERVER marks `requiresExplicitConfirmation` now opens
 *    an inline confirmation that states, verbatim from the server, what the rule
 *    exposes and which prerequisite is outstanding. Confirming sends the
 *    server's own `confirmationToken` as `confirmExposure`.
 *  · DISABLING never asks for confirmation. A catch that makes it harder to
 *    CLOSE an exposure than to open one would be backwards.
 *  · The warning text is SERVER DATA (`exposureWarning`), like every other
 *    string here. A locally authored warning is one edit away from disagreeing
 *    with the rule it warns about — the same reason descriptions are not
 *    authored here.
 *  · The confirmation is enforced in `setAudienceRuleEnabled`, not just here, so
 *    a future caller cannot skip it (server/lib/commsAudienceRules.ts).
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { AudienceRulePreview } from "./AudienceRulePreview";

interface PolicyRule {
  ruleKey: string;
  appliesToViewerRole: string;
  enabled: boolean;
  requiresOwnerDecision: boolean;
  description: string;
  recommendedDefault: string | null;
  /* WAVE 144 · ITEM 5 — server-authored; absent on a build that predates it. */
  exposureWarning?: string | null;
  requiresExplicitConfirmation?: boolean;
  confirmationToken?: string | null;
}

interface PolicyResponse {
  viewerRole?: string;
  rules?: PolicyRule[];
}

/** The rule R108.1 holds OFF, and the reason, stated on the surface itself. The
 *  key is the server's; the caution is fixed UI copy about a ruling, not an
 *  invented description of the rule. */
const HELD_OFF_KEY = "partner_engaged_company_people";
/* WAVE 144 · ITEM 5/6 — CORRECTED. The wave-143 wording said the directory
   payload "carries capTables, location and an unresolved capavateAngelNetwork".
   ITEM 4 of this wave removed all three from `GET /api/comms/users`, so that
   sentence became false the moment this wave landed; leaving it would have this
   panel lying about the state of the fix it depends on. What is still TRUE is
   that the rule remains OFF and that the RULING has not been revisited — which
   is the owner's call, not the code's. */
/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 192 · ITEM C1 · R160.4 — THE SECOND CONTRADICTION ON THIS SAME RULE.
   ══════════════════════════════════════════════════════════════════════════════
   WHAT WAS ON SCREEN, LIVE. The badge for `partner_engaged_company_people` read
   "ENABLED" — because the owner enabled the rule on live — directly above a
   paragraph whose own words were "the rule stays off until you decide otherwise"
   and "This is not an oversight and it is not a pending owner decision". Wave 177
   fixed a contradiction on this same rule; this is a SECOND one it did not reach.

   WHICH ONE IS THE TRUTH. The badge is not UI opinion: it renders `r.enabled`,
   which is the server's reading of the `enabled` column on the rule row. The body
   was a HARDCODED SENTENCE that described a state, and the state moved out from
   under it. **The badge is the truth and the body text was stale.**

   SO THE BODY NOW FOLLOWS THE STATE, DYNAMICALLY. The state-dependent clauses are
   derived from `r.enabled` and `r.requiresOwnerDecision` — the SAME two fields the
   two badges above render — so there is one source of truth and no sentence that
   can go stale again. A third hardcoded sentence describing the enabled case would
   have reproduced the defect in the other direction.

   R143.1 — THE LITERALS THAT ARE STILL TRUE DID NOT MOVE. `HELD_OFF_REASON_STABLE`
   below is the byte-verbatim prefix of the shipped `HELD_OFF_REASON`: the R108.1
   citation, the cross-organisation privacy warning and the WAVE 144 item 4 note
   are true in BOTH states and are unchanged, character for character. Only the
   trailing state-dependent clauses became derived. In the disabled-and-pending
   state — what the local database holds, and what every shipped assertion was
   written against — `heldOffReasonForState()` reproduces the shipped
   `HELD_OFF_REASON` BYTE FOR BYTE. A test asserts exactly that equality, which is
   what keeps wave 177's C-3/C-4/C-5 assertions green.

   GUARD SAFETY. This paragraph's text is rendered from an EXPRESSION, not a JSX
   text node, so it is not a `copy` identity in
   `scripts/silent-drop-guard/extract-inventory.ts` and splitting the constant
   cannot retire one. No JSX element is added or removed, the `<p>` and its
   `data-testid` are unchanged, so no panel and no sibling cell is renumbered. */

/** The part that is true whether the rule is on or off. BYTE-VERBATIM prefix of
 *  the sentence this panel has always shipped (R143.1) — do not reword. */
const HELD_OFF_REASON_STABLE =
  "HELD OFF DELIBERATELY (R108.1). Switching this on lets a Consortium Partner message the " +
  "ACTIVE members of another organisation — their client companies' people. The privacy " +
  "prerequisite R108.1 item 2 named has been ADDRESSED in WAVE 144 item 4 (the messaging " +
  "directory payload no longer carries cap-table positions, location or capavateAngelNetwork; privacy " +
  "resolution still covers legal name and visibility only).";

/** The DISABLED tail, byte-verbatim as shipped. Kept as its own constant rather
 *  than rebuilt from fragments, so the equality test below compares real text. */
const HELD_OFF_TAIL_DISABLED_PENDING =
  " The RULING itself has not been " +
  "revisited, so the rule stays off until you decide otherwise. This is not an oversight: it " +
  "is the pending owner decision the badge above reports, and it stays pending until you make it.";

/** Disabled, and the owner HAS since ruled — so there is no pending decision to
 *  point at, and claiming one would be the same class of false statement in the
 *  other direction. */
const HELD_OFF_TAIL_DISABLED_DECIDED =
  " The rule is currently OFF, as the badge above reports, and it is off by a decision that has " +
  "been recorded rather than by a decision still outstanding. Turning it on is a choice available " +
  "to you here; nothing is waiting on anyone else.";

/** ENABLED. The state the live platform is in, and the state the shipped sentence
 *  denied. It states what is now permitted, because that is the fact an owner
 *  auditing this screen needs, and it does not pretend the rule is off. */
const HELD_OFF_TAIL_ENABLED =
  " This rule is currently ON, as the badge above reports: a Consortium Partner team member CAN " +
  "now be offered the active members of any company their organisation holds an active engagement " +
  "for. The R108.1 caution above is why it was held off, not a description of the rule's present " +
  "state. The privacy scope stated above still applies in full, and turning the rule off here " +
  "withdraws the audience again.";

/** ENABLED while the row still marks a decision outstanding. Both facts are
 *  stated rather than one being suppressed, because suppressing either is how this
 *  screen came to contradict itself twice. */
const HELD_OFF_TAIL_ENABLED_PENDING =
  " The badge above also reports that an owner decision is still recorded as outstanding on this " +
  "rule, so the audience is live while the ruling behind it has not been closed out. Both of those " +
  "are true at once; neither is hidden here.";

/**
 * The body text, DERIVED. Same two fields the badges render, so the paragraph
 * cannot disagree with the badge above it.
 *
 * The disabled-and-pending branch returns the byte-verbatim shipped sentence.
 */
export function heldOffReasonForState(args: {
  enabled: boolean;
  requiresOwnerDecision: boolean;
}): string {
  if (!args.enabled) {
    return (
      HELD_OFF_REASON_STABLE +
      (args.requiresOwnerDecision ? HELD_OFF_TAIL_DISABLED_PENDING : HELD_OFF_TAIL_DISABLED_DECIDED)
    );
  }
  return (
    HELD_OFF_REASON_STABLE +
    HELD_OFF_TAIL_ENABLED +
    (args.requiresOwnerDecision ? HELD_OFF_TAIL_ENABLED_PENDING : "")
  );
}

/** The sentence this panel shipped, retained so a test can assert that the
 *  derived text reproduces it byte for byte in the state it described (R143.1). */
export const HELD_OFF_REASON_AS_SHIPPED =
  HELD_OFF_REASON_STABLE + HELD_OFF_TAIL_DISABLED_PENDING;

/* ══════════════════════════════════════════════════════════════════════════════
   WAVE 177 · ITEM C · R148.3 item 3 — THE CONTRADICTION, RESOLVED FROM THE DATA.
   ══════════════════════════════════════════════════════════════════════════════
   TWO STATEMENTS ABOUT ONE RULE DISAGREED ON SCREEN. The badge above this text
   read "awaiting an owner decision" while the final clause of the paragraph read
   "it is not a pending owner decision". Both were rendered, together, for
   `partner_engaged_company_people`. One of them had to be wrong.

   WHICH ONE, DECIDED BY THE RECORD AND NOT BY PREFERENCE. The badge is not UI
   opinion: it renders if and only if `r.requiresOwnerDecision` is true, which is
   the server's reading of `requires_owner_decision` on the rule row. For this
   rule that column is 1 and `decided_at` is NULL. Migration 0199 establishes what
   a real ruling looks like — it sets `requires_owner_decision = 0` alongside
   `decided_at` and `decided_by` (migrations/0199_wave143_partner_team_peers_enable.sql:53-72).
   That never happened for this rule. So the DATA says a decision is genuinely
   outstanding, the BADGE reports the data faithfully, and the CLAUSE was the
   false statement.

   SO ONLY THE CLAUSE MOVED. The badge literal is untouched, byte for byte, and
   the rest of this paragraph — the R108.1 citation, the WAVE 144 item 4 privacy
   note, the statement that the rule stays off — is unchanged, because none of it
   was in conflict with anything. The correction is the smallest one that makes
   the screen stop contradicting itself.

   WHAT WAS NOT DONE: `requires_owner_decision` was NOT flipped to 0 to silence
   the badge. That would resolve the contradiction by fabricating a ruling the
   owner never made, on the very surface whose job is to tell the owner which
   rulings are still theirs to make. */

/** What audience each rule opens, in one line, so the owner is not asked to
 *  infer scope from a rule key. Keyed by the server's own rule keys; a key this
 *  build has not seen falls back to the server's description rather than to a
 *  guess. */
const AUDIENCE_SUMMARY: Record<string, string> = {
  channel_participant: "Opens: everyone already sharing a comms channel with the viewer.",
  cap_table_peer:
    "Opens: committed holders on a cap table the viewer also holds a committed position on.",
  chapter_peer: "Opens: everyone sharing at least one ACTIVE Collective chapter with the viewer.",
  follow_peer: "Opens: everyone connected to the viewer by a durable follow relationship.",
  partner_engaged_company_people:
    "Opens: the ACTIVE members of every client company the partner holds a live engagement for — people at ANOTHER organisation.",
  partner_team_peers:
    "Opens: the other ACTIVE members of the viewer's OWN partner organisation. One tenant only; nothing crosses to another organisation.",
};

export function MessagingAudienceRulesPanel() {
  const { toast } = useToast();

  const q = useQuery<PolicyResponse>({
    queryKey: ["/api/comms/audience-policy"],
    queryFn: async () => (await apiRequest("GET", "/api/comms/audience-policy")).json(),
    retry: false,
  });

  /* WAVE 144 · ITEM 5 — the rule key currently awaiting the owner's explicit
     confirmation. Exactly one at a time, and never persisted: closing the panel
     abandons the intent, which is the correct default for an exposure. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: async (args: { ruleKey: string; enabled: boolean; confirmExposure?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/comms/audience-rules/${encodeURIComponent(args.ruleKey)}`,
        /* The confirmation token is sent ONLY when one was required and given;
           the body shape for every other rule is unchanged. */
        args.confirmExposure === undefined
          ? { enabled: args.enabled }
          : { enabled: args.enabled, confirmExposure: args.confirmExposure },
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_d, args) => {
      setConfirming(null);
      /* The reader has no cache, but the CLIENT does: both the policy and the
         picker must re-read or the admin would be looking at the pre-toggle
         state. Neither existing invalidation is removed by this component. */
      void queryClient.invalidateQueries({ queryKey: ["/api/comms/audience-policy"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/comms/users"] });
      toast({
        title: args.enabled ? "Audience rule enabled" : "Audience rule disabled",
        description: `${args.ruleKey} — live on the next request.`,
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Audience rule NOT changed",
        description:
          (err as Error)?.message ??
          "The rule was not changed. Nothing about who can message whom has moved.",
        variant: "destructive",
      });
    },
  });

  const rules = q.data?.rules;

  return (
    <div className="space-y-4" data-testid="admin-audience-rules-panel">
      <div>
        <h3 className="font-medium" data-testid="admin-audience-rules-title">
          Messaging audience rules
        </h3>
        <p className="text-xs text-muted-foreground" data-testid="admin-audience-rules-intro">
          Each rule is one source of candidates for the DM recipient picker. Rules are read from{" "}
          <code>comms_audience_rules</code> on every request with no caching, so a change here is
          live on the next request and needs no deploy. Descriptions and recommendations below are
          the stored rows, shown verbatim.
        </p>
      </div>

      {q.isLoading ? (
        <div className="text-sm" data-testid="admin-audience-rules-loading">
          Reading the audience rules…
        </div>
      ) : q.error || !Array.isArray(rules) ? (
        <div className="text-sm" data-testid="admin-audience-rules-unavailable">
          The audience rules could not be read, so no rule state is shown rather than a state that
          may be wrong. Nothing has been changed.
        </div>
      ) : rules.length === 0 ? (
        <div className="text-sm" data-testid="admin-audience-rules-empty">
          The rules table returned no rows. No audience rule state can be stated.
        </div>
      ) : (
        <ul className="space-y-3" data-testid="admin-audience-rules-list">
          {rules.map((r) => (
            <li
              key={r.ruleKey}
              className="border-t pt-3 space-y-1"
              data-testid={`admin-audience-rule-${r.ruleKey}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <code className="text-sm font-medium">{r.ruleKey}</code>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant={r.enabled ? "default" : "secondary"}
                      data-testid={`admin-audience-rule-state-${r.ruleKey}`}
                    >
                      {r.enabled ? "ENABLED" : "DISABLED"}
                    </Badge>
                    <Badge variant="outline" data-testid={`admin-audience-rule-role-${r.ruleKey}`}>
                      {`applies to: ${r.appliesToViewerRole}`}
                    </Badge>
                    {r.requiresOwnerDecision ? (
                      <Badge
                        variant="outline"
                        data-testid={`admin-audience-rule-pending-${r.ruleKey}`}
                      >
                        awaiting an owner decision
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <Switch
                  checked={r.enabled}
                  disabled={toggle.isPending}
                  data-testid={`admin-audience-rule-toggle-${r.ruleKey}`}
                  aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.ruleKey}`}
                  onCheckedChange={(next) => {
                    /* WAVE 144 · ITEM 5 — ENABLING a rule the server marks as
                       crossing an organisation boundary asks first; everything
                       else, and every DISABLE, writes immediately as before. */
                    if (next === true && r.requiresExplicitConfirmation) {
                      setConfirming(r.ruleKey);
                      return;
                    }
                    setConfirming(null);
                    toggle.mutate({ ruleKey: r.ruleKey, enabled: next === true });
                  }}
                />
              </div>
              <p
                className="text-xs text-muted-foreground"
                data-testid={`admin-audience-rule-opens-${r.ruleKey}`}
              >
                {AUDIENCE_SUMMARY[r.ruleKey] ?? r.description}
              </p>
              <p
                className="text-xs text-muted-foreground"
                data-testid={`admin-audience-rule-description-${r.ruleKey}`}
              >
                {r.description}
              </p>
              {r.recommendedDefault ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid={`admin-audience-rule-recommendation-${r.ruleKey}`}
                >
                  {r.recommendedDefault}
                </p>
              ) : null}
              {r.ruleKey === HELD_OFF_KEY ? (
                <p
                  className="text-xs font-semibold text-amber-900"
                  data-testid={`admin-audience-rule-held-off-${r.ruleKey}`}
                >
                  {heldOffReasonForState({
                    enabled: !!r.enabled,
                    requiresOwnerDecision: !!r.requiresOwnerDecision,
                  })}
                </p>
              ) : null}
              {/* WAVE 144 · ITEM 5 — the SERVER's warning, always visible for any
                  rule that carries one, not only inside the confirmation. The
                  owner should be able to read what a switch does BEFORE
                  touching it. */}
              {r.exposureWarning ? (
                <p
                  className="text-xs text-amber-900"
                  data-testid={`admin-audience-rule-exposure-${r.ruleKey}`}
                >
                  {r.exposureWarning}
                </p>
              ) : null}
              {/* The explicit second act. Additive sibling: nothing above is
                  replaced or hidden while it is open. */}
              {confirming === r.ruleKey ? (
                <div
                  className="rounded border border-amber-400 bg-amber-50 p-2 space-y-2"
                  data-testid={`admin-audience-rule-confirm-${r.ruleKey}`}
                >
                  <p className="text-xs font-semibold text-amber-900">
                    {`Enable ${r.ruleKey}? This is not yet done. `}
                    {r.exposureWarning ??
                      "Enabling this rule widens who can message whom. Confirm only if you intend that."}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      data-testid={`admin-audience-rule-confirm-yes-${r.ruleKey}`}
                      disabled={toggle.isPending}
                      onClick={() =>
                        toggle.mutate({
                          ruleKey: r.ruleKey,
                          enabled: true,
                          /* The server's own token. If a build ever omits it the
                             write is refused by the store — an unconfirmed
                             enable must not fall through to a plain enable. */
                          confirmExposure: r.confirmationToken ?? "",
                        })
                      }
                    >
                      I understand — enable it
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`admin-audience-rule-confirm-cancel-${r.ruleKey}`}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel — leave it off
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* WAVE 167 · TASK 3.2 — APPENDED AT THE END AS A SIBLING (guard
                  rule 4). Nothing above is moved, rewrapped or reworded; the
                  read-only preview is simply the last child of the rule item.
                  R139.3 requires the owner to be able to verify who a rule
                  reaches on the live server, for EVERY rule — not just the one
                  this wave adds — because the question "who can this person
                  reach?" is the same question for all seven. */}
              <AudienceRulePreview ruleKey={r.ruleKey} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
