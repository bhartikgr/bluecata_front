/**
 * WAVE 128 · FINDING 2 — THE PARTNER MONEY-ENTRY NOTICE, SHARED.
 *
 * WHY THIS FILE EXISTS. Wave 126 built the whole-currency-unit entry contract in
 * `partnerMoneyInput.ts` and the live confirmation line that goes under such a
 * field — but the confirmation line was written as a PRIVATE function inside
 * `SpvDetailTabs.tsx:274`, so the five fields Wave 126 could not reach had
 * nowhere to import it from. This wave needs it on two more files
 * (`SpvOperationsPanels.tsx`, `pages/partner/PartnerSpvDetail.tsx`), and the
 * wave's rule is explicit: reuse the converter, do not write a second one.
 *
 * So the notice moves here, unchanged in behaviour, and the conversion helpers
 * are thin wrappers over `partnerMoneyInput`'s `parseWholeUnits` /
 * `toWireMinor`. There is still exactly ONE parser of a client's money on this
 * surface, and now exactly one confirmation line as well.
 *
 * SHAPE DISCIPLINE (build_log/wave116/W116_TESTS.md §3.1). The notice is ONE
 * element in ONE sibling position and it ALWAYS renders — never a conditional
 * that swaps siblings in and out — so adding it beside a field cannot change a
 * panel's positional child shape or trip the silent-drop gate.
 *
 * NO FLOAT, EVER, ON WHAT THE CLIENT TYPED. `parseWholeUnits` is string surgery
 * and applies `BigInt` once, to a string of digits. `Number()` appears in this
 * file exactly once, in `wireMinorNumber`, applied to an ALREADY-PROVEN
 * digits-only minor-unit string, for the two endpoints whose zod schemas type
 * the field as a JSON number (`amount_minor: z.number().int()`,
 * server/spvFundStore.ts:409-413). That is the same ratified boundary check as
 * `parseMinor` (SpvDetailTabs.tsx:109) and `strictMinorOrNull`
 * (SpvOperationsPanels.tsx:76): digits-only regex FIRST, then a safe-integer
 * range check, then refuse. It cannot reinterpret a client's dollars as cents,
 * because the scaling already happened exactly, in bigint.
 */
import { useMemo } from "react";
import {
  parseWholeUnits,
  toWireMinor,
  isImplausiblyLarge,
} from "./partnerMoneyInput";

/**
 * Parse what the client typed, in whole currency units, into the exact
 * minor-unit integer the wire has always carried, as a STRING. Throws with the
 * refusal sentence so a submit handler can surface it; the field's own notice
 * has already shown the same sentence inline as they typed.
 *
 * `allowZero` is a caller decision: a zero cost basis is legitimate, a zero
 * capital call is not.
 */
export function wholeUnitsToWireMinor(
  raw: string,
  currency: string,
  label: string,
  opts?: { allowZero?: boolean },
): string {
  const r = parseWholeUnits(raw, currency, { label, allowZero: opts?.allowZero === true });
  if (!r.ok) throw new Error(r.message);
  return toWireMinor(r.minor);
}

/**
 * Widen an already-proven minor-unit digit string for an endpoint whose schema
 * types the field as a JSON number. Refuses rather than losing precision.
 */
export function wireMinorNumber(minorDigits: string, label: string): number {
  const s = (minorDigits ?? "").trim();
  if (!/^\d+$/.test(s)) throw new Error(`${label} must be an ordinary amount, using digits.`);
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(
      `${label} is larger than this platform can record on this form. Nothing has been submitted — split it or contact Capavate.`,
    );
  }
  return n;
}

/**
 * The live confirmation line beside a partner money field.
 *
 *   1. STATES the amount that will actually be recorded, before anything is
 *      submitted.
 *   2. REFUSES an impossible value inline, in a sentence, as the client types.
 *   3. ASKS, in amber, about an amount large enough to be a slipped decimal,
 *      without ever blocking it — there is no defensible universal maximum on a
 *      private-market amount.
 */
export function PartnerMoneyEntryNotice({
  raw,
  currency,
  label,
  testid,
}: { raw: string; currency: string; label: string; testid: string }) {
  const state = useMemo(() => parseWholeUnits(raw, currency, { label }), [raw, currency, label]);
  const untouched = (raw ?? "").trim() === "";
  const large = state.ok && isImplausiblyLarge(state.minor, currency);
  return (
    <div className="text-[10px] leading-relaxed mt-0.5" data-testid={testid}>
      {untouched ? (
        <span className="text-[var(--cv-color-text-faint)]">Enter the amount in {currency}.</span>
      ) : state.ok ? (
        <span className={large ? "text-amber-700" : "text-[var(--cv-color-text-secondary)]"}>
          {large
            ? `This will be recorded as ${state.formatted}. That is an unusually large amount — please confirm it is the figure you mean.`
            : `This will be recorded as ${state.formatted}.`}
        </span>
      ) : (
        <span className="text-rose-600" data-testid={`${testid}-refusal`}>{state.message}</span>
      )}
    </div>
  );
}
