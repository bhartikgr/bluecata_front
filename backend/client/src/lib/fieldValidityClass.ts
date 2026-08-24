/**
 * WAVE 106 · FINDING 5 — ONE validity-driven border for text fields.
 *
 * The report was that the red invalid border on the SPV wizard's Name and
 * Mandate-description fields STAYS red after the field becomes valid, while the
 * inline error text and the Next button both update correctly.
 *
 * What is actually in the tree: those two fields had **no invalid border at
 * all**. `components/ui/input.tsx` and `components/ui/textarea.tsx` carry no
 * error variant and no `aria-invalid` styling, and there is no `:invalid` rule
 * in `index.css` or `styles/*.css`. What the operator most likely saw is the
 * BROWSER's own `:invalid` styling on a native control, which no code here can
 * clear. So the honest fix is not to hunt a stuck class: it is to give the
 * fields a real border that is DERIVED from validity, so that being valid and
 * looking invalid is not a state this component can hold.
 *
 * Derived, not toggled: callers pass the same boolean that drives the inline
 * error text and the Next button. There is no separate "touched"/"dirty" flag to
 * fall out of sync with, which is the mechanism by which a stuck border happens
 * in the first place.
 *
 * `aria-invalid` is emitted alongside the class so the state is not colour-only.
 *
 * A near-identical local pattern lives at
 * `client/src/pages/founder/ApplyToCollective.tsx` (`errorRing()`), fenced by a
 * WAVE 59 test. It is in the founder area and is deliberately left untouched by
 * this wave; consolidating both onto this helper is an open item.
 */

/** The ring applied to an invalid field. Kept identical to the founder-side
 *  pattern so the product does not grow a second look for the same state. */
export const INVALID_FIELD_CLASS =
  "border-2 border-solid border-rose-500 ring-2 ring-rose-200 focus-visible:ring-rose-400";

/**
 * The className for a field, given whether it is currently valid.
 * Returns "" when valid — the field keeps its default border, so validity can
 * never leave a red ring behind.
 */
export function fieldValidityClass(isValid: boolean): string {
  return isValid ? "" : INVALID_FIELD_CLASS;
}

/**
 * Props to spread onto an `Input`/`Textarea` so the border and the accessible
 * state come from the SAME predicate and cannot diverge.
 *
 *   <Input {...fieldValidityProps(name.trim().length > 0)} />
 */
export function fieldValidityProps(isValid: boolean): {
  className: string;
  "aria-invalid": boolean;
} {
  return { className: fieldValidityClass(isValid), "aria-invalid": !isValid };
}
