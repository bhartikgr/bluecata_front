/**
 * shared/currencyDomain.ts — WAVE 306 · BAND "MONEY & CURRENCY" · WAVE 1
 *
 * THE REFUSAL CODES AND THE INVESTOR-FACING SENTENCES FOR AN SPV DENOMINATION
 * THE PLATFORM WILL NOT ACCEPT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * An SPV's `currency` is IMMUTABLE once the vehicle is created — every
 * commitment, fee, distribution and tax form for that vehicle is recorded in it
 * forever. Until this wave it was the only immutable SPV field that was never
 * validated anywhere: `createSpv` persisted `data.currency ?? "USD"`, so a
 * client typing `NOTACURRENCY123` had that string written into a permanent
 * column, and a client sending nothing at all silently got US dollars.
 *
 * A display default is a lie on screen. A WRITE default is a lie in the
 * database that survives the screen closing. This file supplies the vocabulary
 * for refusing both, in plain language, BEFORE anything is written.
 *
 * NO CONVERSION. NOTHING HERE CONVERTS, INFERS OR SUGGESTS A CURRENCY. The
 * platform holds no exchange rate and will not invent a denomination for a
 * jurisdiction — it only says, truthfully, that it does not recognise the code
 * it was given, and asks the client to read it off the vehicle's formation
 * documents.
 *
 * SHAPE COPIED FROM `shared/spvSubscriptionRefusalCopy.ts` (R77): the code, a
 * boundary-safe HEADLINE under 240 characters (because
 * `client/src/lib/queryClient.ts:60-65` discards any server `message` of 240
 * characters or more and substitutes a generic one), and the unabridged
 * GUIDANCE sentence alongside it. No refusal leaves the server as a bare code.
 */

/* ════════════════════════════════════════════════════════════════════════════
   THE CODES
   ════════════════════════════════════════════════════════════════════════════
   Three distinct refusals, because they are three genuinely different facts and
   a client can act on each differently:

     REQUIRED     — you sent no denomination at all. 400. Choose one.
     UNKNOWN      — you sent something we do not recognise. 400. Fix it.
     UNVERIFIABLE — WE cannot read our own currency reference right now. 503,
                    NOT 400: the request may be perfectly correct, and the
                    client must never be told to "fix" a value that is fine.
                    Retryable. NEVER a fall-through to a default.

   `UNKNOWN` carries the offending code AFTER the code word, in the platform's
   established prefix form (`SPV_CURRENCY_UNKNOWN:NOTACURRENCY123`), so an
   operator quoting a ticket can see what was actually sent. The prefix map in
   `server/spvEngineRoutes.ts` resolves it to 400 exactly the way
   `INVALID_SUBSCRIPTION_STATUS:…` is already resolved.
   ════════════════════════════════════════════════════════════════════════════ */

export const SPV_CURRENCY_REQUIRED_CODE = "SPV_CURRENCY_REQUIRED";
export const SPV_CURRENCY_UNKNOWN_CODE = "SPV_CURRENCY_UNKNOWN";
export const SPV_CURRENCY_UNVERIFIABLE_CODE = "SPV_CURRENCY_UNVERIFIABLE";

/** The separator between `SPV_CURRENCY_UNKNOWN` and the rejected code. */
export const SPV_CURRENCY_DETAIL_SEPARATOR = ":";

/* ════════════════════════════════════════════════════════════════════════════
   THE SENTENCES
   ════════════════════════════════════════════════════════════════════════════ */

export const SPV_CURRENCY_REQUIRED_HEADLINE =
  "This vehicle needs a denomination before it can be created.";

export const SPV_CURRENCY_REQUIRED_GUIDANCE =
  "Every commitment, fee, distribution and tax form for this vehicle will be recorded in a single currency, " +
  "and that currency cannot be changed after the vehicle is created. Capavate will not choose one for you and " +
  "will not fall back to US dollars. Select the denomination that appears on the vehicle's formation documents " +
  "and create the vehicle again.";

export const SPV_CURRENCY_UNKNOWN_HEADLINE =
  "Capavate does not recognise that currency code, so this vehicle was not created.";

export const SPV_CURRENCY_UNKNOWN_GUIDANCE =
  "A vehicle's denomination has to be a currency Capavate can account in for the life of the vehicle, and it " +
  "cannot be changed afterwards, so an unrecognised code is refused rather than stored. Use the three-letter " +
  "ISO 4217 code shown on the vehicle's formation documents — for example USD, EUR or GBP. Withdrawn codes " +
  "(currencies that no longer exist) are also refused. Nothing has been created or charged.";

export const SPV_CURRENCY_UNVERIFIABLE_HEADLINE =
  "Capavate cannot confirm currency codes right now, so this vehicle was not created.";

export const SPV_CURRENCY_UNVERIFIABLE_GUIDANCE =
  "This is a fault on Capavate's side, not a problem with what you submitted. A vehicle's denomination is " +
  "permanent, so Capavate refuses to record one it cannot verify rather than assuming US dollars. Nothing has " +
  "been created or charged. Please try again shortly; if it keeps happening, contact Capavate.";

/* ════════════════════════════════════════════════════════════════════════════
   LOOKUP — used by the route error mapper so no code reaches a client naked.
   Keyed by the BARE code; the caller strips any `:detail` suffix first.
   ════════════════════════════════════════════════════════════════════════════ */

export interface CurrencyRefusalCopy {
  readonly headline: string;
  readonly guidance: string;
  /** HTTP status. 503 for UNVERIFIABLE — a server fault is not a client error. */
  readonly status: number;
}

const COPY: Readonly<Record<string, CurrencyRefusalCopy>> = {
  [SPV_CURRENCY_REQUIRED_CODE]: {
    headline: SPV_CURRENCY_REQUIRED_HEADLINE,
    guidance: SPV_CURRENCY_REQUIRED_GUIDANCE,
    status: 400,
  },
  [SPV_CURRENCY_UNKNOWN_CODE]: {
    headline: SPV_CURRENCY_UNKNOWN_HEADLINE,
    guidance: SPV_CURRENCY_UNKNOWN_GUIDANCE,
    status: 400,
  },
  [SPV_CURRENCY_UNVERIFIABLE_CODE]: {
    headline: SPV_CURRENCY_UNVERIFIABLE_HEADLINE,
    guidance: SPV_CURRENCY_UNVERIFIABLE_GUIDANCE,
    status: 503,
  },
};

/** Every code this module defines. Exported so a test can assert the set. */
export const SPV_CURRENCY_REFUSAL_CODES: readonly string[] = [
  SPV_CURRENCY_REQUIRED_CODE,
  SPV_CURRENCY_UNKNOWN_CODE,
  SPV_CURRENCY_UNVERIFIABLE_CODE,
];

/**
 * Resolve a thrown message to its copy, or `null` if it is not one of ours.
 * Accepts both the bare code and the `CODE:detail` prefix form.
 */
export function spvCurrencyRefusalCopy(message: string): CurrencyRefusalCopy | null {
  const bare = message.split(SPV_CURRENCY_DETAIL_SEPARATOR)[0];
  return COPY[bare] ?? null;
}
