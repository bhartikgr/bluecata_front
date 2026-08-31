/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 212 · ITEM A · R186.2 — THE SERVER SIDE OF THE ROUND-CREATION GATE.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE OWNER'S WORDS
 *   "A founder cannot bring a live funding round into existence with one click."
 *   And, on how it must be proved: the gate must be "server-enforced, not a
 *   disabled button".
 *
 * WHY THIS FILE EXISTS AT ALL, RATHER THAN THE LOGIC LIVING IN `routes.ts`.
 *   `POST /api/rounds` is a 700-line handler inside a 9,000-line file that four
 *   other waves are working in this week. Every line added there is a line another
 *   wave has to read around, and the wizard's own source text is fenced by the
 *   silent-drop guard. The route therefore gains a small number of call sites and
 *   nothing else; the decisions, the wording and the refusals live here.
 *
 * WHAT IT ENFORCES, IN ORDER, BEFORE ANYTHING IS CREATED
 *   1. The storage for the sign-off exists and is writable-shaped. A database that
 *      cannot hold the sign-off refuses the round rather than creating an unattested
 *      one.
 *   2. A typed full legal name is present. Empty, whitespace-only, non-string and
 *      over-long are all refused; none is silently repaired.
 *   3. The attestation was accepted, strictly as the boolean `true`.
 *   4. The exact text that must be recorded is assembled from the round's own facts
 *      and is non-empty. A sign-off with no stored text is refused (ITEM B).
 *
 * WHAT IT REFUSES TO TRUST FROM THE CLIENT
 *   The signature and the tick, and NOTHING else. The version, the text, the
 *   timestamp, the acting identity, the IP and the user agent are all derived
 *   server-side. Any body key beginning `creationAttestation` other than the two
 *   inputs is STRIPPED before the route's unknown-key sweep can carry it into
 *   `extras_json` — otherwise a caller could post their own `creationAttestationIp`
 *   and have it stored beside a real one (R187.1, R192.3).
 *
 * EVERY REFUSAL IS BUILT THROUGH `fitToGate()`.
 *   `client/src/lib/queryClient.ts` discards a server message of 240 characters or
 *   more, so a long refusal has not partly fired — it has NOT FIRED, and the founder
 *   is told nothing while the platform looks broken. This class has bitten four
 *   times (waves 192, 195, 193, 198). The round name is the only interpolation and
 *   it rides the NAME ladder, because a legitimate round name must not start
 *   arriving truncated.
 *
 * WHAT IT DOES NOT DO
 *   It does not touch editing a round, closing a round, or any other founder action.
 *   It is called from exactly one place: the creation handler.
 *
 * RULING: R186.2, R187.1, R187.3, R192.3, R166.2, R143.4, R176.1.
 */

import type { Request } from "express";
import { resolveRateLimitClientIp } from "./rateLimit";
import { fitToGate, NAME_FRAGMENT_BUDGETS, boundedFragment } from "../../shared/refusalHeadlineGate";
import {
  ROUND_CREATION_ATTESTATION_VERSION,
  buildRoundCreationAttestationText,
  plainDecimalOrNull,
  roundCreationAttestationAccepted,
  roundCreationSignedNameOutcome,
  ERR_ATTESTATION_REQUIRED,
  ERR_SIGNED_NAME_REQUIRED,
  ERR_SIGNED_NAME_TOO_LONG,
  ROUND_CREATION_SIGNED_NAME_MAX_LENGTH,
  type RoundCreationAttestationFacts,
} from "../../shared/wave212RoundCreationAttestation";
import {
  attestationStorageAvailable,
  recordRoundCreationAttestation,
  usableObservedIp,
  type RoundCreationAttestationRecord,
} from "../wave212RoundCreationAttestationStore";

/** The two body keys the client may supply, and nothing else. */
export const BODY_KEY_SIGNED_NAME = "creationAttestationSignedName";
export const BODY_KEY_ACCEPTED = "creationAttestationAccepted";

/** Refusal identifiers. Stable strings a client or a test may assert on. */
export const ERR_STORAGE_UNAVAILABLE = "ROUND_CREATION_ATTESTATION_STORAGE_UNAVAILABLE";
export const ERR_TEXT_UNAVAILABLE = "ROUND_CREATION_ATTESTATION_TEXT_UNAVAILABLE";
export const ERR_NOT_RECORDED = "ROUND_ATTESTATION_NOT_RECORDED";

export interface GateRefusal {
  status: number;
  payload: { ok: false; error: string; message: string };
}

export interface GateAccepted {
  signedName: string;
  version: string;
  attestationText: string;
  observedIp: string | null;
  userAgent: string | null;
  /** Keys the caller sent that this gate removed before the extras sweep. */
  strippedKeys: string[];
}

export type GateOutcome = { ok: true; accepted: GateAccepted } | { ok: false; refusal: GateRefusal };

/**
 * Remove every `creationAttestation*` key from a request body except the two the
 * client is allowed to send, and return the names of the keys removed.
 *
 * The route sweeps unrecognised body keys into `extras`, and `rowToRound()`
 * re-spreads `extras_json` onto every hydrated round, so an unstripped key would be
 * echoed to every reader of the round — including a forged IP address sitting beside
 * the real one.
 */
export function stripClientAttestationKeys(body: Record<string, unknown>): string[] {
  const stripped: string[] = [];
  for (const key of Object.keys(body)) {
    if (!/^creationAttestation/i.test(key)) continue;
    if (key === BODY_KEY_SIGNED_NAME || key === BODY_KEY_ACCEPTED) continue;
    delete body[key];
    stripped.push(key);
  }
  return stripped;
}

function refusal(status: number, error: string, message: string): GateRefusal {
  return { status, payload: { ok: false, error, message } };
}

/** A round-name fragment for a refusal, bounded so it cannot break the gate. */
function nameFragment(roundName: string | null | undefined, budget: number): string {
  return boundedFragment(typeof roundName === "string" ? roundName : "", budget);
}

/**
 * THE PRE-FLIGHT. Runs before the round is created, so a refusal leaves nothing
 * behind. Returns either everything the recorder needs or the exact refusal to send.
 */
export function wave212RoundCreationPreflight(
  req: Request,
  facts: RoundCreationAttestationFacts,
): GateOutcome {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const strippedKeys = stripClientAttestationKeys(body);

  /* 1 — can the sign-off be stored at all? */
  const storage = attestationStorageAvailable();
  if (!storage.ok) {
    return {
      ok: false,
      refusal: refusal(
        500,
        ERR_STORAGE_UNAVAILABLE,
        fitToGate(
          (b) =>
            `Capavate did not create ${nameFragment(facts.roundName, b)} because it cannot record the authorised sign-off right now. Nothing was created. Please try again, and tell your Capavate contact if it keeps happening.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  /* 2 — the signature. */
  const nameOutcome = roundCreationSignedNameOutcome(body[BODY_KEY_SIGNED_NAME]);
  if (!nameOutcome.ok) {
    if (nameOutcome.code === ERR_SIGNED_NAME_TOO_LONG) {
      return {
        ok: false,
        refusal: refusal(
          400,
          ERR_SIGNED_NAME_TOO_LONG,
          fitToGate(
            () =>
              `Capavate did not create this round. The full legal name on the authorised sign-off is longer than ${String(ROUND_CREATION_SIGNED_NAME_MAX_LENGTH)} characters, and Capavate will not store part of a signature.`,
            NAME_FRAGMENT_BUDGETS,
          ),
        ),
      };
    }
    return {
      ok: false,
      refusal: refusal(
        400,
        ERR_SIGNED_NAME_REQUIRED,
        fitToGate(
          (b) =>
            `Capavate did not create ${nameFragment(facts.roundName, b)}. The authorised sign-off needs your full legal name, typed, and none was supplied. Nothing was created.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  /* 3 — the tick. */
  if (!roundCreationAttestationAccepted(body[BODY_KEY_ACCEPTED])) {
    return {
      ok: false,
      refusal: refusal(
        400,
        ERR_ATTESTATION_REQUIRED,
        fitToGate(
          (b) =>
            `Capavate did not create ${nameFragment(facts.roundName, b)}. The authorised sign-off attestation was not accepted. Nothing was created.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  /* 4 — the exact text that will be recorded. Assembled from the round's own facts,
     with every figure passed through the one normaliser the wizard also uses so the
     stored sentence and the sentence on the screen are the same bytes. */
  const attestationText = buildRoundCreationAttestationText({
    companyName: facts.companyName ?? null,
    roundName: facts.roundName ?? null,
    pricePerShareRaw: plainDecimalOrNull(facts.pricePerShareRaw ?? null),
    targetAmountRaw: plainDecimalOrNull(facts.targetAmountRaw ?? null),
    currency: facts.currency ?? null,
  });
  if (attestationText.trim().length === 0) {
    return {
      ok: false,
      refusal: refusal(
        500,
        ERR_TEXT_UNAVAILABLE,
        fitToGate(
          () =>
            `Capavate did not create this round because it could not assemble the sign-off wording to record. Nothing was created. Please tell your Capavate contact.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  return {
    ok: true,
    accepted: {
      signedName: nameOutcome.signedName,
      version: ROUND_CREATION_ATTESTATION_VERSION,
      attestationText,
      /* The server's own view of the peer. Never a client-supplied header value;
         `usableObservedIp` turns the resolver's "unknown" into a null that is
         recorded as NOT CAPTURED rather than stored as if it were an address. */
      observedIp: usableObservedIp(resolveRateLimitClientIp(req)),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
      strippedKeys,
    },
  };
}

export type RecordAfterCreateOutcome =
  | { ok: true; record: RoundCreationAttestationRecord }
  | { ok: false; refusal: GateRefusal; code: string; detail: string };

/**
 * Record the sign-off against the round that has just been created, and refuse the
 * whole request if it cannot be recorded.
 *
 * ON THE ORDERING, HONESTLY. The vehicle launch sign-off writes the signature FIRST
 * and links it to the vehicle afterwards, which is strictly better. That ordering is
 * not available here: §212.3 puts the sign-off in columns ON THE ROUND ROW, so the
 * row must exist before it can be signed. The pre-flight above therefore moves every
 * refusable condition ahead of the create, leaving only a genuine mid-write database
 * failure in the window between the round row and its sign-off. If that happens the
 * caller is told plainly that nothing usable was created and the failure is audited;
 * the row is NOT deleted, because R195.5 forbids this platform deleting records, and
 * a round with no sign-off is visibly unsigned rather than silently signed.
 */
export function wave212RecordAfterCreate(input: {
  roundId: string;
  accepted: GateAccepted;
  signedBy: string;
  roundName: string | null | undefined;
}): RecordAfterCreateOutcome {
  const outcome = recordRoundCreationAttestation({
    roundId: input.roundId,
    signedName: input.accepted.signedName,
    version: input.accepted.version,
    attestationText: input.accepted.attestationText,
    signedBy: input.signedBy,
    observedIp: input.accepted.observedIp,
    userAgent: input.accepted.userAgent,
  });
  if (outcome.ok) return { ok: true, record: outcome.record };
  return {
    ok: false,
    code: outcome.code,
    detail: outcome.detail,
    refusal: refusal(
      500,
      ERR_NOT_RECORDED,
      fitToGate(
        (b) =>
          `Capavate could not record the authorised sign-off for ${nameFragment(input.roundName, b)}, so this round has not been created for use. Do not treat it as created. Please tell your Capavate contact.`,
        NAME_FRAGMENT_BUDGETS,
      ),
    ),
  };
}
