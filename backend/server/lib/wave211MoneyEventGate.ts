/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 211 · ITEM A + ITEM B — THE SERVER SIDE OF THE PARTNER MONEY GATES.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE OWNER'S WORDS
 *   "Record Distribution" states that "Distributions are append-only and cannot be
 *   edited or deleted once recorded" — "and then requires nothing at all." Also
 *   unguarded: "Record Capital Call", "Invite an LP", "Commit an LP to the cap
 *   table". And on how it must be proved: "Server-enforced, not a disabled button."
 *
 * WHY THIS FILE EXISTS RATHER THAN THE LOGIC LIVING IN THE ROUTE FILES
 *   The four actions are spread across TWO registrars — the distribution, invite and
 *   commit routes are in `server/spvEngineRoutes.ts` (mounted at `routes.ts:1687`)
 *   and the capital call is in `server/spvLegacyAdapters.ts` (mounted at
 *   `routes.ts:1907`), because it posts to the PLURAL `/spvs/` family while the
 *   distribution posts to the SINGULAR `/spv/` family. One letter apart, two files.
 *   A gate written inline in one of them would leave the other ungated, which is
 *   exactly the defect this wave was sent to fix. Both route files therefore gain a
 *   small number of call sites and nothing else; the decisions, the wording and the
 *   refusals live here, once.
 *   It also keeps the enforcement in a NON-SACRED layer: the commit path ends in
 *   `server/captableCommitStore.ts`, which is frozen, so the commitment is gated
 *   BEFORE that store is reached rather than inside it (§2.4).
 *
 * WHAT IT ENFORCES, IN ORDER, BEFORE ANYTHING IS RECORDED
 *   1. The storage for the attestation exists and is writable-shaped. A database
 *      that cannot hold the attestation refuses the money event rather than
 *      recording an unattested one — and says so as a storage problem, not as a
 *      problem with what the partner typed. This ordering is deliberate and is the
 *      single most important safety property of the wave.
 *   2. The version token the client claims matches this build's. A forged or
 *      paraphrased attestation is refused here.
 *   3. A typed full legal name is present. Empty, whitespace-only, non-string and
 *      over-long are all refused; none is silently repaired and none is truncated.
 *   4. All three confirmations were accepted, strictly as the boolean `true`.
 *   5. For a money event only, draft 03's basis of determination is present.
 *   6. The exact text that will be recorded is assembled from the EVENT'S OWN DATA
 *      and is non-empty. An attestation with no stored text is refused (ITEM B).
 *
 * WHAT IT REFUSES TO TRUST FROM THE CLIENT
 *   The signature, the three ticks, the basis text, the currency tick and the
 *   version token — and NOTHING else. The text, the timestamp, the acting identity,
 *   the IP and the user agent are all derived server-side. Any body key beginning
 *   `w211Attestation` other than those inputs is STRIPPED before any downstream
 *   unknown-key sweep can carry it into a persisted blob — otherwise a caller could
 *   post their own `w211AttestationIp` and have it stored beside a real one
 *   (R187.1).
 *
 * WHAT IT DOES NOT CLAIM (R188.5)
 *   Nothing here verifies anything about an investor, and no string it emits says
 *   otherwise. The disclosure states that the platform does not verify and that the
 *   obligation sits with the partner, and it QUOTES the Consortium Partner Agreement
 *   clause at render rather than paraphrasing it (R197.4).
 *
 * EVERY REFUSAL IS BUILT THROUGH `fitToGate()`
 *   `client/src/lib/queryClient.ts:60-65` discards a server message of 240
 *   characters or more, so a long refusal has not partly fired — it has NOT FIRED,
 *   and the partner is told nothing while the platform looks broken. This class has
 *   bitten four times. Every refusal below names the MISSING FACT and rides the NAME
 *   ladder, so a legitimate long vehicle name cannot break the gate.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *   · `POST …/subscriptions/:investorId/confirm-funds` — settling an existing
 *     commitment to `funded`. Wave 211 adds nothing to that path, so a legitimate
 *     settlement cannot be trapped by this wave.
 *   · The SPV launch gate (§2.7/§5.13, R123.1, R185.1). NOT WIRED. Wired and
 *     reverted five times; not touched here.
 *   · The nine-jurisdiction accreditation component. Wave 215 owns correcting and
 *     wiring it. Referenced, never rebuilt, and no second accreditation mechanism
 *     is created.
 *
 * RULINGS: R176.1, R187.1, R187.3, R188.4, R188.5, R195.5, R196, R197.4.
 */
import type { Request } from "express";
import { resolveRateLimitClientIp } from "./rateLimit";
import { fitToGate, NAME_FRAGMENT_BUDGETS, boundedFragment } from "../../shared/refusalHeadlineGate";
import {
  buildWave211AttestationText,
  wave211AttestationVersion,
  wave211BasisOutcome,
  wave211EventNounOrNull,
  wave211PlainDecimalOrNull,
  wave211SignedNameOutcome,
  wave211TickAccepted,
  wave211VersionMatches,
  W211_BASIS_MAX_LENGTH,
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
  W211_BODY_KEY_PATTERN,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_VERSION,
  W211_CLIENT_SUPPLIABLE_KEYS,
  W211_ERR_BASIS_REQUIRED,
  W211_ERR_BASIS_TOO_LONG,
  W211_ERR_NAME_REQUIRED,
  W211_ERR_NAME_TOO_LONG,
  W211_ERR_TICKS_REQUIRED,
  W211_ERR_VERSION_MISMATCH,
  W211_ERR_STORAGE_UNAVAILABLE,
  W211_EVENT_NOUN_CAPITAL_CALL,
  W211_EVENT_NOUN_DISTRIBUTION,
  W211_SIGNED_NAME_MAX_LENGTH,
  type Wave211AttestationFacts,
} from "../../shared/wave211MoneyEventAttestation";
import {
  wave211RecordAttestation,
  wave211StorageAvailable,
  wave211UsableObservedIp,
  type Wave211AttestationRecord,
  type Wave211Slot,
} from "../wave211MoneyEventAttestationStore";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE BODY KEYS THE CLIENT MAY SUPPLY — AND ONLY THESE
 * ═══════════════════════════════════════════════════════════════════════════ */

/* The key names are NOT restated here. They live in the shared module both sides
   import, because they were once defined twice with two different spellings and the
   mismatch would have refused every honest submission. Re-exported so existing
   server-side importers keep working. */
export {
  W211_BODY_KEY_VERSION,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_CURRENCY_CONFIRMED,
} from "../../shared/wave211MoneyEventAttestation";

export const W211_ERR_NOT_RECORDED = "WAVE211_ATTESTATION_NOT_RECORDED";
export const W211_ERR_TEXT_UNAVAILABLE = "WAVE211_ATTESTATION_TEXT_UNAVAILABLE";
export const W211_ERR_EVENT_NOUN_UNKNOWN = "WAVE211_ATTESTATION_EVENT_UNKNOWN";

/**
 * Remove every `w211Attestation*` key the client is NOT allowed to set.
 *
 * Returns what it removed so the route can audit an attempt. A caller who posts
 * `w211AttestationSignedAt` or `w211AttestationIp` is trying to write their own
 * evidence; the key is dropped and the server's own value is used (R187.1).
 */
export function stripClientWave211Keys(body: Record<string, unknown>): string[] {
  const stripped: string[] = [];
  for (const key of Object.keys(body)) {
    if (!W211_BODY_KEY_PATTERN.test(key)) continue;
    if (W211_CLIENT_SUPPLIABLE_KEYS.includes(key)) continue;
    delete body[key];
    stripped.push(key);
  }
  return stripped;
}

export interface W211Refusal {
  status: number;
  payload: { ok: false; error: string; message: string };
}

export interface W211Accepted {
  slot: Wave211Slot;
  signedName: string;
  version: string;
  attestationText: string;
  basis: string | null;
  currencyConfirmed: boolean;
  currencyConfirmedCode: string | null;
  observedIp: string | null;
  userAgent: string | null;
  strippedKeys: string[];
}

export type W211GateOutcome =
  | { ok: true; accepted: W211Accepted }
  | { ok: false; refusal: W211Refusal };

function refusal(status: number, error: string, message: string): W211Refusal {
  return { status, payload: { ok: false, error, message } };
}

/** A vehicle-name fragment for a refusal, bounded so a long name cannot break the gate. */
function nameFragment(vehicleName: string | null | undefined, budget: number): string {
  return boundedFragment(typeof vehicleName === "string" ? vehicleName : "", budget);
}

/** What the partner is trying to do, in the words the refusal will use. */
function actionPhrase(slot: Wave211Slot): string {
  if (slot === "distribution") return `record this ${W211_EVENT_NOUN_DISTRIBUTION}`;
  if (slot === "capital_call") return `record this ${W211_EVENT_NOUN_CAPITAL_CALL}`;
  if (slot === "lp_invitation") return "send this invitation";
  return "record this commitment";
}

/** The past-tense form, for "Capavate did not …". */
function didNotPhrase(slot: Wave211Slot): string {
  if (slot === "distribution") return `record this ${W211_EVENT_NOUN_DISTRIBUTION}`;
  if (slot === "capital_call") return `record this ${W211_EVENT_NOUN_CAPITAL_CALL}`;
  if (slot === "lp_invitation") return "send this invitation";
  return "record this commitment";
}

/**
 * A currency code from the request, or `null`.
 *
 * No currency is ever assumed, converted or hardcoded. This is a shape test on
 * text; nothing here reads a rate or totals across currencies.
 */
function currencyCodeOrNull(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : null;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE PRE-FLIGHT
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface W211PreflightInput {
  slot: Wave211Slot;
  /** The facts the attestation text is generated from — the event's OWN data. */
  facts: Wave211AttestationFacts;
  /** The vehicle name, for the refusal wording. May be absent. */
  vehicleName?: string | null;
  /** The currency the event is denominated in, for the currency-confirmation record. */
  currency?: string | null;
}

/**
 * Runs BEFORE the money event is recorded, so a refusal leaves nothing behind.
 * Returns either everything the recorder needs, or the exact refusal to send.
 */
export function wave211Preflight(req: Request, input: W211PreflightInput): W211GateOutcome {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const strippedKeys = stripClientWave211Keys(body);
  const slot = input.slot;
  const vname = input.vehicleName;

  /* 1 — can the attestation be stored at all? Checked FIRST, so a storage fault is
     never reported to the partner as a problem with their name or their ticks. */
  const storage = wave211StorageAvailable(slot);
  if (!storage.ok) {
    return {
      ok: false,
      refusal: refusal(
        500,
        W211_ERR_STORAGE_UNAVAILABLE,
        fitToGate(
          (b) =>
            `Capavate did not ${didNotPhrase(slot)} for ${nameFragment(vname, b)} because it cannot record your confirmation right now. Nothing was recorded. Please try again, and tell your Capavate contact if it keeps happening.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  /* 2 — the version token. A forged or paraphrased attestation is refused here.
     The VERSION is compared, not the prose: comparing prose would refuse a
     legitimate partner over a byte of round-tripping, while a paraphrase cannot
     produce a matching version token. */
  const kind = slot === "lp_invitation" ? "lp_invitation" : slot === "lp_commitment" ? "lp_commitment" : "money_event";
  if (!wave211VersionMatches(kind, body[W211_BODY_KEY_VERSION])) {
    return {
      ok: false,
      refusal: refusal(
        400,
        W211_ERR_VERSION_MISMATCH,
        fitToGate(
          (b) =>
            `Capavate did not ${didNotPhrase(slot)} for ${nameFragment(vname, b)}. The confirmation Capavate received is not the current wording. Reload this page and confirm again. Nothing was recorded.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  /* 3 — the signature. Never truncated: a silently shortened legal name is a
     forged legal name, so an over-long one is refused with its limit named. */
  const nameOutcome = wave211SignedNameOutcome(body[W211_BODY_KEY_SIGNED_NAME]);
  if (!nameOutcome.ok) {
    if (nameOutcome.code === W211_ERR_NAME_TOO_LONG) {
      return {
        ok: false,
        refusal: refusal(
          400,
          W211_ERR_NAME_TOO_LONG,
          fitToGate(
            () =>
              `Capavate did not ${didNotPhrase(slot)}. The full legal name on the confirmation is longer than ${String(W211_SIGNED_NAME_MAX_LENGTH)} characters, and Capavate will not store part of a signature.`,
            NAME_FRAGMENT_BUDGETS,
          ),
        ),
      };
    }
    return {
      ok: false,
      refusal: refusal(
        400,
        W211_ERR_NAME_REQUIRED,
        fitToGate(
          (b) =>
            `Capavate did not ${didNotPhrase(slot)} for ${nameFragment(vname, b)}. To ${actionPhrase(slot)} Capavate needs your full legal name, typed, and none was supplied. Nothing was recorded.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  /* 4 — the three ticks. Each is accepted ONLY on a literal boolean `true`, and
     presence and type are established by that comparison, so nothing is coerced
     (R176.1). The refusal NAMES WHICH confirmation is missing, because "something
     is missing" is not an actionable refusal. */
  const t1 = wave211TickAccepted(body[W211_BODY_KEY_TICK_1]);
  const t2 = wave211TickAccepted(body[W211_BODY_KEY_TICK_2]);
  const t3 = wave211TickAccepted(body[W211_BODY_KEY_TICK_3]);
  if (!t1 || !t2 || !t3) {
    const missing: string[] = [];
    if (!t1) missing.push("first");
    if (!t2) missing.push("second");
    if (!t3) missing.push("third");
    const which = missing.join(", ");
    return {
      ok: false,
      refusal: refusal(
        400,
        W211_ERR_TICKS_REQUIRED,
        fitToGate(
          (b) =>
            `Capavate did not ${didNotPhrase(slot)} for ${nameFragment(vname, b)}. These confirmations were not accepted: the ${which}. All three are required. Nothing was recorded.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  /* 5 — draft 03's basis of determination, for money events only. Draft 03 makes it
     required, and it is the field that makes the entry auditable against the
     document it came from. */
  let basis: string | null = null;
  if (slot === "distribution" || slot === "capital_call") {
    const basisOutcome = wave211BasisOutcome(body[W211_BODY_KEY_BASIS]);
    if (!basisOutcome.ok) {
      if (basisOutcome.code === W211_ERR_BASIS_TOO_LONG) {
        return {
          ok: false,
          refusal: refusal(
            400,
            W211_ERR_BASIS_TOO_LONG,
            fitToGate(
              () =>
                `Capavate did not ${didNotPhrase(slot)}. The basis of determination is longer than ${String(W211_BASIS_MAX_LENGTH)} characters. Name the document, resolution or notice and its date, and keep it shorter.`,
              NAME_FRAGMENT_BUDGETS,
            ),
          ),
        };
      }
      return {
        ok: false,
        refusal: refusal(
          400,
          W211_ERR_BASIS_REQUIRED,
          fitToGate(
            (b) =>
              `Capavate did not ${didNotPhrase(slot)} for ${nameFragment(vname, b)}. Identify the document, resolution, notice or calculation this entry is based on, and its date. Nothing was recorded.`,
            NAME_FRAGMENT_BUDGETS,
          ),
        ),
      };
    }
    basis = basisOutcome.value;

    /* The event noun must be one this build knows. An unknown noun would put a
       sentence in front of the partner that this build did not write. */
    const facts = input.facts as { kind: string; eventNoun?: unknown };
    if (facts.kind === "money_event" && wave211EventNounOrNull(facts.eventNoun) == null) {
      return {
        ok: false,
        refusal: refusal(
          500,
          W211_ERR_EVENT_NOUN_UNKNOWN,
          fitToGate(
            () =>
              `Capavate did not ${didNotPhrase(slot)} because it could not identify what kind of event this is. Nothing was recorded. Please tell your Capavate contact.`,
            NAME_FRAGMENT_BUDGETS,
          ),
        ),
      };
    }
  }

  /* 6 — the exact text that will be recorded, generated LIVE from the event's own
     data. Every figure goes through the same shape test the client uses, so the
     stored sentence and the sentence on the screen are the same bytes, and an
     absent figure is DECLARED absent rather than shown as a zero (R-ASSERT). */
  const attestationText = buildWave211AttestationText(normaliseFacts(input.facts));
  if (attestationText.trim().length === 0) {
    return {
      ok: false,
      refusal: refusal(
        500,
        W211_ERR_TEXT_UNAVAILABLE,
        fitToGate(
          () =>
            `Capavate did not ${didNotPhrase(slot)} because it could not assemble the confirmation wording to record. Nothing was recorded. Please tell your Capavate contact.`,
          NAME_FRAGMENT_BUDGETS,
        ),
      ),
    };
  }

  return {
    ok: true,
    accepted: {
      slot,
      signedName: nameOutcome.value,
      version: wave211AttestationVersion(kind),
      attestationText,
      basis,
      /* The currency-confirmation tick the partner already gives is now STORED
         rather than discarded. Its text is unchanged by this wave. */
      currencyConfirmed: wave211TickAccepted(body[W211_BODY_KEY_CURRENCY_CONFIRMED]),
      currencyConfirmedCode: currencyCodeOrNull(input.currency),
      /* The server's own view of the peer. Never a client-supplied header value;
         `wave211UsableObservedIp` turns the resolver's "unknown" into a null that
         is recorded as NOT CAPTURED rather than stored as if it were an address. */
      observedIp: wave211UsableObservedIp(resolveRateLimitClientIp(req)),
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
      strippedKeys,
    },
  };
}

/**
 * Pass every figure through the plain-decimal shape test before it reaches the text
 * builder, so a figure that cannot be restated exactly is declared unshowable rather
 * than printed. This is a SHAPE TEST, not a parse: no `Number()`, `parseInt` or
 * `parseFloat` runs here or in the builder.
 */
function normaliseFacts(facts: Wave211AttestationFacts): Wave211AttestationFacts {
  if (facts.kind === "money_event") {
    return { ...facts, amountRaw: wave211PlainDecimalOrNull(facts.amountRaw ?? null) };
  }
  if (facts.kind === "lp_commitment") {
    return { ...facts, amountRaw: wave211PlainDecimalOrNull(facts.amountRaw ?? null) };
  }
  return facts;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  RECORD, AFTER THE ROW EXISTS
 * ═══════════════════════════════════════════════════════════════════════════ */

export type W211RecordAfterOutcome =
  | { ok: true; record: Wave211AttestationRecord }
  | { ok: false; refusal: W211Refusal; code: string; detail: string };

/**
 * Audit the attestation through WAVE 186's EXISTING writer. No second audit path is
 * created (R171.1): `appendAdminAudit` is the one hash-chained, tenant-scoped audit
 * writer, and this calls it.
 *
 * HONEST LABEL, because wave 57c got this wrong and the handbook makes a point of
 * it: `appendAudit` swallows its own DB write failure and returns an empty-hash
 * sentinel. `reportAuditWriteOutcome` NAMES that sentinel, so an audit failure is
 * VISIBLE. It does not make this path fail-closed on the audit, and this wave does
 * not claim it does. What IS fail-closed is the ATTESTATION write itself, which is
 * read back field by field before the request is allowed to succeed.
 *
 * The audit payload deliberately carries the text's DIGEST and not the text: the
 * verbatim text already lives on the event row, and duplicating it into the audit
 * chain would create a second copy that could drift from the first. It also records
 * `strippedKeys`, so an attempt to post forged evidence leaves a trace.
 */
export function wave211AuditAttestation(input: {
  actor: string;
  partnerId: string;
  spvId: string;
  slot: Wave211Slot;
  rowId: string;
  outcome: W211RecordAfterOutcome;
  accepted: W211Accepted;
}): void {
  try {
    const entry = appendAdminAudit(
      input.actor,
      `spv:${input.spvId}`,
      input.outcome.ok ? "spv.money_event.attested" : "spv.money_event.attestation_failed",
      {
        partnerId: input.partnerId,
        spvId: input.spvId,
        slot: input.slot,
        rowId: input.rowId,
        attestationVersion: input.accepted.version,
        /* The digest, not the text. The verbatim text is on the event row. */
        attestationTextSha256: input.outcome.ok ? input.outcome.record.attestationTextSha256 : null,
        signedName: input.accepted.signedName,
        signedAt: input.outcome.ok ? input.outcome.record.signedAt : null,
        ipCapture: input.outcome.ok ? input.outcome.record.ipCapture : null,
        basisRecorded: input.accepted.basis != null,
        currencyConfirmed: input.accepted.currencyConfirmed,
        strippedClientKeys: input.accepted.strippedKeys,
        failureCode: input.outcome.ok ? null : input.outcome.code,
        failureDetail: input.outcome.ok ? null : input.outcome.detail,
      },
    );
    /* `bearing: "money"` — a distribution, a capital call and a cap-table commitment
       are money-bearing by definition, and an LP invitation is the step that puts a
       person in front of an offer, so none of the four is "routine". */
    reportAuditWriteOutcome(entry, {
      bearing: "money",
      action: input.outcome.ok ? "wave211.attestation_recorded" : "wave211.attestation_failed",
      route: `wave211:${input.slot}`,
      subject: `${input.spvId}/${input.rowId}`,
    });
  } catch {
    /* An audit failure must not turn a recorded, attested money event into a 500.
       The attestation write is the fail-closed step; this is the visible trail. */
  }
}

/**
 * Record the attestation against the row that has just been written, and tell the
 * caller plainly if it could not be recorded.
 *
 * ON THE ORDERING, HONESTLY. The vehicle launch sign-off writes the signature FIRST
 * and links it to the vehicle afterwards, which is strictly better. That ordering is
 * not available here: the build doc's wave-211 section puts the attestation in
 * columns ON THE EVENT'S OWN ROW, so the row must exist before it can be signed. The
 * pre-flight above therefore moves every refusable condition ahead of the write,
 * leaving only a genuine mid-write database failure in the window between the event
 * row and its attestation. If that happens the caller is told plainly, and the row is
 * NOT deleted: R195.5 forbids this platform deleting records, and an entry with no
 * attestation is visibly unattested rather than silently attested.
 */
export function wave211RecordAfter(input: {
  rowId: string;
  accepted: W211Accepted;
  signedBy: string;
  vehicleName?: string | null;
}): W211RecordAfterOutcome {
  const outcome = wave211RecordAttestation({
    slot: input.accepted.slot,
    rowId: input.rowId,
    signedName: input.accepted.signedName,
    version: input.accepted.version,
    attestationText: input.accepted.attestationText,
    signedBy: input.signedBy,
    observedIp: input.accepted.observedIp,
    userAgent: input.accepted.userAgent,
    basis: input.accepted.basis,
    currencyConfirmed: input.accepted.currencyConfirmed,
    currencyConfirmedCode: input.accepted.currencyConfirmedCode,
  });
  if (outcome.ok) return { ok: true, record: outcome.record };
  const slot = input.accepted.slot;
  return {
    ok: false,
    code: outcome.code,
    detail: outcome.detail,
    refusal: refusal(
      500,
      W211_ERR_NOT_RECORDED,
      fitToGate(
        (b) =>
          `Capavate could not record your confirmation for ${nameFragment(input.vehicleName, b)}, so this entry is not confirmed. Do not treat it as confirmed. Please tell your Capavate contact. Nothing was deleted.`,
        NAME_FRAGMENT_BUDGETS,
      ),
    ),
  };
}
