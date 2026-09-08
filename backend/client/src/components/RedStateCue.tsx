/**
 * client/src/components/RedStateCue.tsx — WAVE 342 · ITEM 3 · W291.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT: ONE COLOUR, FOUR MEANINGS.
 * ─────────────────────────────────────────────────────────────────────────────
 * Red is used across this platform for FOUR unrelated states:
 *
 *   1. ERROR       — something the person entered is not accepted.
 *   2. REQUIRED    — something must be supplied before saving (nothing is wrong yet).
 *   3. DESTRUCTIVE — an action that cannot be undone.
 *   4. OVERDUE     — money or an obligation is late.
 *
 * A person who cannot distinguish the colour — roughly one man in twelve has a
 * red/green deficiency, and a monochrome print or a bright screen removes the
 * colour for everyone — receives NO information from it. Worse, the four states
 * are not interchangeable: "required" is not a failure, and "overdue" is not a
 * destructive action. Red alone tells the reader nothing about WHICH of the four
 * they are looking at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE canonical, non-colour treatment per meaning: a distinct GLYPH plus WORDS.
 * WCAG 2.1 SC 1.4.1 (Use of Colour) is satisfied by the glyph and the words, not
 * by the colour — remove every colour from the page and each of the four states
 * is still legible and still distinct from the other three.
 *
 * NO COLOUR IS DEFINED, CHANGED OR REMOVED HERE, deliberately:
 *   • `client/src/styles/capavate-tokens.css` is SACRED and is not touched.
 *   • The prohibited border-colour token is not referenced anywhere in this
 *     module or at any of its call sites (asserted by the test, which greps for
 *     the token name — so the name itself is deliberately not spelled here).
 *   • The only colour referenced is `--cv-color-danger`, the token the country
 *     field's shipped `⚠` cue already uses
 *     (`client/src/components/partner/PartnerPortfolioProfileDialog.tsx:269`),
 *     and it is referenced for the ERROR cue only, exactly as that precedent
 *     does. Every existing className at every call site is left as it was: this
 *     wave ADDS a cue, it does not restyle anything.
 *
 * THE PRECEDENT THIS FOLLOWS, verbatim in shape: `aria-invalid` on the control,
 * a `role="alert"` paragraph, and `<span aria-hidden="true">⚠ </span>` before the
 * sentence so the glyph is not read out twice by a screen reader.
 */
import * as React from "react";

/** The four things red means in this platform. Exhaustive by construction. */
export type RedStateMeaning = "error" | "required" | "destructive" | "overdue";

export const RED_STATE_MEANINGS: RedStateMeaning[] = [
  "error",
  "required",
  "destructive",
  "overdue",
];

/**
 * The glyph for each meaning. FOUR DIFFERENT GLYPHS — the point of the item is
 * that the four states must not look alike, so these must never be unified.
 * Each is decorative (`aria-hidden`) and each is paired with words below.
 */
export const RED_STATE_GLYPH: Record<RedStateMeaning, string> = {
  error: "⚠",
  required: "*",
  destructive: "✕",
  overdue: "⏱",
};

/** The WORD a reader sees for each meaning when no colour is perceived. */
export const RED_STATE_WORD: Record<RedStateMeaning, string> = {
  error: "Error",
  required: "Required",
  destructive: "Cannot be undone",
  overdue: "Overdue",
};

/**
 * ERROR — something entered was not accepted.
 *
 * `role="alert"` so it is announced when it appears. Pair it with
 * `aria-invalid` on the control itself; the two together are what makes the
 * state perceivable without colour AND available to assistive technology.
 */
export function RedErrorCue({
  children,
  className,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      role="alert"
      data-testid={testId}
      data-red-state="error"
      className={className ?? "text-xs text-[var(--cv-color-danger)]"}
    >
      <span aria-hidden="true">{RED_STATE_GLYPH.error} </span>
      {children}
    </p>
  );
}

/**
 * REQUIRED — nothing is wrong yet; something must be supplied.
 *
 * The asterisk is decorative and the word "required" is given to assistive
 * technology, so the meaning survives with no colour and with no sight of the
 * glyph. Use `RequiredFieldsLegend` once per form so a SIGHTED reader who cannot
 * see the colour also learns what the asterisk means.
 */
export function RequiredMark({
  testId,
  className = "text-destructive",
}: {
  testId?: string;
  /** The EXISTING class at the call site, passed through unchanged. This
      component adds a cue; it must never restyle what it replaces. */
  className?: string;
}) {
  return (
    <span data-testid={testId} data-red-state="required" className={className}>
      <span aria-hidden="true">{RED_STATE_GLYPH.required}</span>
      <span className="sr-only"> (required)</span>
    </span>
  );
}

/** The legend that gives the asterisk its meaning in words. Once per form. */
export function RequiredFieldsLegend({ testId }: { testId?: string }) {
  return (
    <p
      data-testid={testId ?? "required-fields-legend"}
      data-red-state="required-legend"
      className="text-[11px] text-muted-foreground"
    >
      <span aria-hidden="true">{RED_STATE_GLYPH.required} </span>
      {RED_STATE_WORD.required} — these fields must be filled in before saving.
    </p>
  );
}

/**
 * DESTRUCTIVE — an action whose effect cannot be undone.
 *
 * NOT `role="alert"`: nothing has gone wrong and nothing has happened yet, so
 * announcing it as an alert would be a false statement about the page's state.
 * It is a warning attached to a choice, and it says what the consequence is.
 */
export function DestructiveActionCue({
  children,
  className,
  testId,
}: {
  children?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      data-red-state="destructive"
      className={className ?? "text-xs text-muted-foreground"}
    >
      <span aria-hidden="true">{RED_STATE_GLYPH.destructive} </span>
      <span className="font-medium">{RED_STATE_WORD.destructive}.</span>
      {children ? <> {children}</> : null}
    </p>
  );
}

/**
 * OVERDUE — late, and therefore actionable by the person looking at it.
 *
 * Rendered as a prefix INSIDE the existing badge so no badge style changes: the
 * badge keeps its variant and its class list exactly, and gains a glyph and a
 * word. This is what separates "overdue" from every other red badge — most
 * importantly from `void`, which is also painted red today and means something
 * entirely different (cancelled, and NOT owed).
 */
export function OverdueCue({ testId }: { testId?: string }) {
  return (
    <span data-testid={testId} data-red-state="overdue">
      <span aria-hidden="true">{RED_STATE_GLYPH.overdue} </span>
      <span className="sr-only">{RED_STATE_WORD.overdue}: </span>
    </span>
  );
}

/**
 * VOID — red today, but not overdue and not an error. Given its own glyph so the
 * two red badges are distinguishable without colour. NOT one of the four
 * meanings; it exists here because it currently BORROWS the overdue colour, and
 * a reader must be able to tell a cancelled charge from a late one.
 */
export const VOID_GLYPH = "⊘";

export function VoidCue({ testId }: { testId?: string }) {
  return (
    <span data-testid={testId} data-red-state="void">
      <span aria-hidden="true">{VOID_GLYPH} </span>
      <span className="sr-only">Cancelled: </span>
    </span>
  );
}

/** Every glyph in use, for the test that asserts the four are all different. */
export function redStateGlyphsAreDistinct(): boolean {
  const all = [...RED_STATE_MEANINGS.map((m) => RED_STATE_GLYPH[m]), VOID_GLYPH];
  return new Set(all).size === all.length;
}
