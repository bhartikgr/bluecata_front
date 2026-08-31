/* ═════════════════════════════════════════════════════════════════════════════
   WAVE 211 · ITEM A + ITEM B — THE PARTNER MONEY-GATE PANEL

   ONE component for all four gated actions: recording a distribution, recording a
   capital call, inviting a limited partner, and committing a limited partner to the
   cap table. Every word it renders comes from `shared/wave211MoneyEventAttestation`,
   which is the SAME module the server builds its stored copy from. That is the whole
   point of putting the text in `shared/`: the sentence the partner reads and the
   sentence kept on the row are produced by one function, not by two hand-copied
   literals that drift apart at the next edit.

   WHAT THIS COMPONENT IS NOT.

   It is NOT the gate. The gate is `wave211Preflight` on the server, and it refuses a
   request that arrives without a complete confirmation no matter what this file does.
   The handbook is explicit that a disabled button is not a control, and the owner's
   audit found exactly that pattern more than once on this platform. So this panel
   deliberately does NOT disable the submit button. It shows the blocker sentence, it
   lets the request go, and the server refuses it with words the partner can act on.
   A partner who scripts the endpoint gets the identical refusal.

   It also does NOT offer a global "I am an accredited investor" tick, and it renders
   no accreditation thresholds of its own. Five jurisdictions define accreditation in
   mutually incompatible terms and one of them excludes individuals altogether, so a
   single global tick could not be true. The nine-jurisdiction component
   (`client/src/components/AccreditationForm.tsx`) is the platform's one accreditation
   mechanism; WAVE 215 owns correcting and wiring it. This panel POINTS AT that
   mechanism and creates no second one.

   R-ASSERT (§14). Every figure in the recital is restated from the event's own data
   or is replaced by a sentence saying it is absent. Nothing is defaulted to zero,
   nothing is converted between currencies, and no `Number()` / `parseFloat` /
   `parseInt` appears anywhere in this file or in the module it reads.
   ═════════════════════════════════════════════════════════════════════════════ */

import { useCallback, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  W211_BASIS_MAX_LENGTH,
  W211_CPA_LINK_LABEL,
  W211_CPA_LINK_PATH,
  W211_CPA_QUOTE_UNAVAILABLE,
  W211_MONEY_EVENT_BASIS_LABEL,
  W211_SIGNED_NAME_MAX_LENGTH,
  wave211AgreementSection,
  wave211AttestationParagraphs,
  wave211AttestationVersion,
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_VERSION,
  wave211BlockerText,
  wave211CpaMarkerFor,
  wave211CpaQuoteHeadingFor,
  wave211FootnoteText,
  wave211MoneyEventBasisInstruction,
  wave211NameLabel,
  wave211NamePlaceholder,
  wave211PanelHeading,
  wave211RequiresBasis,
  wave211TickLabels,
  type Wave211AttestationFacts,
  type Wave211AttestationKind,
} from "@shared/wave211MoneyEventAttestation";

/** The navy this platform's sign-off blocks already use. */
const W211_NAVY = "#041E41";

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE STATE, AND THE BODY FIELDS IT PRODUCES
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface Wave211AttestationState {
  signedName: string;
  tick1: boolean;
  tick2: boolean;
  tick3: boolean;
  basis: string;
  currencyConfirmed: boolean;
}

const EMPTY_STATE: Wave211AttestationState = {
  signedName: "",
  tick1: false,
  tick2: false,
  tick3: false,
  basis: "",
  currencyConfirmed: false,
};

/**
 * The exact keys the server's `stripClientWave211Keys` allows and reads. Kept in one
 * function so a rename cannot leave the client posting a key the gate ignores — which
 * would look to a partner like a complete confirmation being refused.
 *
 * `w211AttestationVersion` is the ONLY thing the client asserts about the text. The
 * prose itself is never posted: the server renders and stores its own copy, so a
 * forged or paraphrased body cannot become the record. A stale bundle posts a stale
 * version and is refused with an instruction to reload.
 */
export function wave211BodyFields(
  kind: Wave211AttestationKind,
  state: Wave211AttestationState,
): Record<string, unknown> {
  /* The key NAMES come from the shared module, never from literals typed here: the
     server reads the same constants, so the two sides cannot drift apart and refuse
     an honest submission for a key the server never looked at. */
  const fields: Record<string, unknown> = {
    [W211_BODY_KEY_VERSION]: wave211AttestationVersion(kind),
    [W211_BODY_KEY_SIGNED_NAME]: state.signedName,
    [W211_BODY_KEY_TICK_1]: state.tick1,
    [W211_BODY_KEY_TICK_2]: state.tick2,
    [W211_BODY_KEY_TICK_3]: state.tick3,
  };
  if (wave211RequiresBasis(kind)) {
    fields[W211_BODY_KEY_BASIS] = state.basis;
    fields[W211_BODY_KEY_CURRENCY_CONFIRMED] = state.currencyConfirmed;
  }
  return fields;
}

/**
 * Local state for one panel.
 *
 * `complete` is ADVISORY ONLY — it drives the blocker sentence, never a `disabled`
 * attribute. See the header: the server is the gate.
 */
export function useWave211Attestation(kind: Wave211AttestationKind) {
  const [state, setState] = useState<Wave211AttestationState>(EMPTY_STATE);

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  const patch = useCallback(
    (next: Partial<Wave211AttestationState>) => setState((prev) => ({ ...prev, ...next })),
    [],
  );

  /* Presence and TYPE before any comparison (R176.1): `signedName` is only trimmed
     after it is known to be a string, and the ticks are compared to `true` itself
     rather than coerced. */
  const complete = useMemo(() => {
    const named = typeof state.signedName === "string" && state.signedName.trim().length > 0;
    const ticked = state.tick1 === true && state.tick2 === true && state.tick3 === true;
    if (!wave211RequiresBasis(kind)) return named && ticked;
    const based = typeof state.basis === "string" && state.basis.trim().length > 0;
    return named && ticked && based;
  }, [kind, state]);

  const bodyFields = useCallback(() => wave211BodyFields(kind, state), [kind, state]);

  return { state, patch, reset, complete, bodyFields };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE QUOTED AGREEMENT CLAUSE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The signed Consortium Partner Agreement, QUOTED — not paraphrased.
 *
 * WAVE 213 shipped a paraphrase of a governing clause and the owner ruled that a
 * paraphrase of an executed agreement is not the agreement. So the clause is sliced
 * out of `CONSORTIUM_AGREEMENT_TEXT` at render time and shown verbatim. When the
 * slice cannot be produced the panel SAYS SO and links to the agreement, rather than
 * showing an empty quote box that reads as though nothing had been agreed.
 */
function Wave211AgreementQuote({ kind }: { kind: Wave211AttestationKind }) {
  const quote = wave211AgreementSection(wave211CpaMarkerFor(kind));
  return (
    <div
      className="rounded border p-2 text-xs"
      style={{ borderColor: "rgba(4,30,65,0.25)", background: "rgba(4,30,65,0.03)" }}
      data-testid="w211-agreement-quote"
    >
      <div className="font-medium" data-testid="w211-agreement-quote-heading">
        {wave211CpaQuoteHeadingFor(kind)}
      </div>
      {quote === null ? (
        <div className="mt-1 text-rose-700" data-testid="w211-agreement-quote-unavailable">
          {W211_CPA_QUOTE_UNAVAILABLE}
        </div>
      ) : (
        <pre
          className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-[var(--cv-color-text-secondary)]"
          data-testid="w211-agreement-quote-text"
        >
          {quote}
        </pre>
      )}
      <a
        href={W211_CPA_LINK_PATH}
        className="mt-1 inline-block underline"
        style={{ color: W211_NAVY }}
        data-testid="w211-agreement-quote-link"
      >
        {W211_CPA_LINK_LABEL}
      </a>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE PANEL
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface Wave211AttestationPanelProps {
  /** Which of the three attestations this is. */
  kind: Wave211AttestationKind;
  /** The event's OWN data. Every figure shown is restated from this. */
  facts: Wave211AttestationFacts;
  /** Panel state from `useWave211Attestation`. */
  state: Wave211AttestationState;
  patch: (next: Partial<Wave211AttestationState>) => void;
  /** Advisory completeness — drives the blocker sentence only. */
  complete: boolean;
  /**
   * Suffix for every `data-testid`, so two panels on one screen stay addressable.
   * Required rather than defaulted: two panels silently sharing one id is exactly
   * the sort of thing that makes a rendered-DOM proof meaningless.
   */
  testIdSuffix: string;
}

export function Wave211AttestationPanel({
  kind,
  facts,
  state,
  patch,
  complete,
  testIdSuffix,
}: Wave211AttestationPanelProps) {
  const eventNoun = facts.kind === "money_event" ? facts.eventNoun : null;
  const ticks = wave211TickLabels(kind, eventNoun);
  /* The paragraphs are generated LIVE from `facts` on every render, so an amount the
     partner changes in the form above changes the sentence they are signing. A
     snapshot taken once would let them sign yesterday's figure. */
  const paragraphs = wave211AttestationParagraphs(facts);
  const needsBasis = wave211RequiresBasis(kind);
  const tid = (leaf: string) => `w211-${leaf}-${testIdSuffix}`;

  return (
    <div
      className="mt-3 rounded-md border p-3 space-y-2 text-xs"
      style={{ borderColor: W211_NAVY, background: "rgba(4,30,65,0.04)" }}
      data-testid={tid("panel")}
      data-w211-kind={kind}
      data-w211-version={wave211AttestationVersion(kind)}
    >
      <div className="font-medium text-sm" data-testid={tid("heading")}>
        {wave211PanelHeading(kind, eventNoun)}
      </div>

      {/* The disclosure, generated live from the event's own data. */}
      <div className="space-y-1" data-testid={tid("text")}>
        {paragraphs.map((p, i) => (
          <div
            key={`${kind}-${i}`}
            className="whitespace-pre-wrap text-[var(--cv-color-text-secondary)]"
            data-testid={tid(`text-line-${String(i)}`)}
          >
            {p}
          </div>
        ))}
      </div>

      <Wave211AgreementQuote kind={kind} />

      <div>
        <Label>{wave211NameLabel(kind)}</Label>
        <Input
          data-testid={tid("legalname")}
          value={state.signedName}
          maxLength={W211_SIGNED_NAME_MAX_LENGTH}
          onChange={(e) => patch({ signedName: e.target.value })}
          placeholder={wave211NamePlaceholder(kind)}
        />
      </div>

      {ticks.map((label, i) => {
        const n = i + 1;
        const key = n === 1 ? "tick1" : n === 2 ? "tick2" : "tick3";
        const checked = n === 1 ? state.tick1 : n === 2 ? state.tick2 : state.tick3;
        return (
          <label
            key={`${kind}-tick-${String(n)}`}
            className="flex items-start gap-2 cursor-pointer"
            htmlFor={tid(`tick-${String(n)}`)}
          >
            <input
              id={tid(`tick-${String(n)}`)}
              type="checkbox"
              className="mt-1"
              data-testid={tid(`tick-${String(n)}`)}
              checked={checked}
              onChange={(e) => patch({ [key]: e.target.checked } as Partial<Wave211AttestationState>)}
            />
            <span className="text-[var(--cv-color-text-secondary)]" data-testid={tid(`tick-${String(n)}-label`)}>
              {label}
            </span>
          </label>
        );
      })}

      {needsBasis && (
        <div>
          <Label>{W211_MONEY_EVENT_BASIS_LABEL}</Label>
          <div className="text-[11px] text-[var(--cv-color-text-muted)]" data-testid={tid("basis-instruction")}>
            {wave211MoneyEventBasisInstruction(eventNoun ?? "")}
          </div>
          <Textarea
            data-testid={tid("basis")}
            value={state.basis}
            maxLength={W211_BASIS_MAX_LENGTH}
            rows={3}
            onChange={(e) => patch({ basis: e.target.value })}
          />
        </div>
      )}

      {!complete && (
        <div className="text-rose-600" data-testid={tid("blocker")}>
          {wave211BlockerText(kind, eventNoun)}
        </div>
      )}

      <div className="text-[10px] text-[var(--cv-color-text-faint)]" data-testid={tid("footnote")}>
        {wave211FootnoteText(kind)}
      </div>
    </div>
  );
}
