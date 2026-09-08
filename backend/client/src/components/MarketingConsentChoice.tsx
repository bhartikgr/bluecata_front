/**
 * client/src/components/MarketingConsentChoice.tsx — WAVE 344 · ITEM 3.
 *
 * ONE component, used in TWO places — the signup form and the settings screen —
 * because the choice a person is offered and the choice they can change must be
 * the same choice, worded the same way. Two components would drift, and the drift
 * would be between what somebody agreed to and what they can withdraw.
 *
 * ── WHAT THIS COMPONENT WILL NOT DO ───────────────────────────────────────
 *  · IT NEVER ARRIVES TICKED. `checked` comes from the server and is that person's
 *    own recorded decision; there is no branch anywhere in this file that sets it
 *    true, and there is no `defaultChecked`. A pre-ticked box is the mechanism the
 *    Canadian regulator names explicitly as NOT valid express consent.
 *  · IT IS NEVER REQUIRED. There is no `required` prop and nothing here can block
 *    a form. On signup it sits below the terms checkbox as a clearly separate,
 *    clearly optional question, and the account is created whether it is ticked or
 *    not.
 *  · IT NEVER SHAMES A DECLINE. There is no confirmation dialog, no "are you sure
 *    you'll miss out", no warning colour on the off state, and no extra step to
 *    say no. Turning it off is the same single click as turning it on.
 *  · IT HIDES ITSELF RATHER THAN ASKING BADLY. If the server reports that the
 *    request is not complete — the postal address the request has to include has
 *    not been configured, or any of the four required parts is missing from the
 *    wording — the box does not render at all and the reason is shown instead.
 *    Asking for permission with an incomplete request would collect consent
 *    records that look valid and are not. WAVE 345: the address has now been
 *    supplied as configuration, so the box is live; blank that configuration and
 *    this branch takes over again, which is proved by disarm, not assumed.
 *
 * ── WHAT IT ALWAYS SHOWS ──────────────────────────────────────────────────
 * The full wording, verbatim, including who is asking, the postal address, and the
 * statement that permission can be withdrawn. It is not behind a "learn more"
 * link, because the request itself is what has to carry those things. The same
 * text is what the server stores against the decision.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface MarketingConsentPayload {
  ok?: boolean;
  available?: boolean;
  reason?: string | null;
  disclosure?: {
    version: string;
    text: string;
    purposes: string;
    requesterIdentity: string;
    mailingAddress: string;
    withdrawalStatement: string;
  } | null;
  checked?: boolean;
  decision?: string | null;
  decidedAt?: string | null;
  serviceMessagesAlwaysDelivered?: boolean;
}

export interface MarketingConsentChoiceProps {
  /**
   * "signup" records the decision immediately on toggle only if the caller says
   * the account exists; on the signup form the caller holds the answer and calls
   * `submitSignupConsent` after the account is created, because there is no user
   * to record a decision against until then.
   */
  channel: "signup" | "settings";
  /** Signup only: told the current answer so the page can submit it afterwards. */
  onAnswerChange?: (answer: boolean, disclosureVersion: string | null) => void;
  /** Signup only: the account does not exist yet, so do not POST on toggle. */
  deferSubmission?: boolean;
}

export function MarketingConsentChoice({
  channel,
  onAnswerChange,
  deferSubmission = false,
}: MarketingConsentChoiceProps) {
  const { toast } = useToast();
  /* Local answer for the deferred (signup) case only. It starts FALSE and there is
     no code path that starts it true. */
  const [localAnswer, setLocalAnswer] = useState(false);

  /* TWO SOURCES FOR THE SAME WORDING, AND WHY.

     On the signup form nobody is signed in yet, so the wording is read from the
     read-only public request path, which returns the text of the request and no
     personal state at all. In settings the person is signed in, so their own
     current answer is read too. The wording itself is composed in one place on the
     server, so the two cannot say different things. */
  const path = deferSubmission ? "/api/consent/marketing-request" : "/api/consent/marketing";
  const q = useQuery<MarketingConsentPayload>({
    queryKey: [path],
    queryFn: async () => (await apiRequest("GET", path)).json(),
    retry: false,
  });

  const save = useMutation({
    mutationFn: async (decision: "granted" | "withdrawn") =>
      (
        await apiRequest("POST", "/api/consent/marketing", {
          decision,
          channel,
          disclosureVersion: q.data?.disclosure?.version ?? null,
        })
      ).json(),
    onSuccess: (r: MarketingConsentPayload) => {
      queryClient.invalidateQueries({ queryKey: [path] });
      if (r?.ok === false) {
        toast({
          title: "Choice not saved",
          description: String((r as { message?: string })?.message ?? ""),
          variant: "destructive",
        });
        return;
      }
      /* Both directions get the same plain confirmation. Withdrawing is not
         treated as a loss and is not argued with. */
      toast({
        title: r?.checked ? "Marketing email turned on" : "Marketing email turned off",
        description: r?.checked
          ? "You can turn this off again at any time, in one step."
          : "You will not be sent marketing email. Messages about your account are not affected.",
      });
    },
    onError: () =>
      toast({
        title: "Choice not saved",
        description: "Nothing has changed. Please try again.",
        variant: "destructive",
      }),
  });

  const available = q.data?.available === true && !!q.data?.disclosure;
  const checked = deferSubmission ? localAnswer : q.data?.checked === true;

  if (q.isLoading) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="marketing-consent-loading">
        Loading the marketing email choice…
      </div>
    );
  }

  if (!available) {
    /* NOT SILENCE. The person is told that they are not being asked, and told that
       nothing about their account is affected. */
    return (
      <div
        className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground"
        data-testid="marketing-consent-unavailable"
      >
        {q.data?.reason ??
          "Marketing email permission is not being asked for at the moment. Nothing about your account or its security messages is affected."}
      </div>
    );
  }

  const d = q.data!.disclosure!;

  const toggle = (next: boolean) => {
    if (deferSubmission) {
      setLocalAnswer(next);
      onAnswerChange?.(next, d.version);
      return;
    }
    save.mutate(next ? "granted" : "withdrawn");
  };

  return (
    <div
      className="rounded-md border border-border p-3 space-y-2"
      data-testid="marketing-consent-block"
    >
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 mt-0.5 shrink-0"
          checked={checked}
          onChange={(e) => toggle(e.target.checked)}
          disabled={save.isPending}
          data-testid="checkbox-marketing-consent"
          aria-describedby="marketing-consent-wording"
        />
        <span className="text-xs font-medium" data-testid="marketing-consent-label">
          Yes, send me marketing email. This is optional.
        </span>
      </label>

      {/* THE WORDING, IN FULL, VERBATIM. Not behind a link, not summarised, and the
          same text the server stores against the decision.

          WAVE 345 — `whitespace-pre-line`. The wording now carries the postal
          address as its own block of lines (entity name, street, city, country,
          then the second address beneath it). HTML collapses newlines by default,
          which would render a two-part postal address as one run-on line: the
          right characters, the wrong address. This preserves the line breaks the
          owner ruled, and nothing else about the text is touched. */}
      <p
        id="marketing-consent-wording"
        className="text-[11px] leading-snug text-muted-foreground whitespace-pre-line"
        data-testid="marketing-consent-wording"
      >
        {d.text}
      </p>

      <p className="text-[11px] text-muted-foreground" data-testid="marketing-consent-optional-note">
        Leaving this unticked is fine and changes nothing else. You can create your
        account, sign in and use everything either way, and messages we have to send
        you about your account and its security are always delivered.
      </p>
    </div>
  );
}

/**
 * Record the signup answer AFTER the account exists.
 *
 * Called by the signup page once the account has been created. It is a separate
 * request from the signup itself and its failure is deliberately swallowed by the
 * caller: a consent record failing must never fail an account creation, and the
 * account has already been created by the time this runs.
 *
 * IT IS ONLY CALLED WHEN THE ANSWER IS YES. A person who left the box alone has
 * not been asked to make a record of anything, so nothing is written for them, and
 * "never decided" stays distinguishable from "decided no".
 */
export async function submitSignupConsent(
  answer: boolean,
  disclosureVersion: string | null,
): Promise<void> {
  if (!answer) return;
  await apiRequest("POST", "/api/consent/marketing", {
    decision: "granted",
    channel: "signup",
    disclosureVersion,
  });
}
