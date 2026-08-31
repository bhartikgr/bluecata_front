/**
 * WAVE 189 · ITEM C · R159.6 — THE ATTESTATION GATE, WHERE THE WRITE HAPPENS.
 *
 * Owner: *"Go with your recommendation."* — drafts allowed, clearly labelled
 * unattested, and **structurally incapable of holding capital**.
 *
 * WHAT THIS FILE IS. The DB half of `shared/spvUnattestedDraft.ts`. The rule
 * itself is pure and lives there; this resolves the one fact the rule needs —
 * does a durable launch sign-off exist for this vehicle — and throws the refusal
 * the route mapper serves.
 *
 * WHY IT IS A SEPARATE MODULE AND NOT A METHOD ON A STORE. Four sinks in two
 * different stores plus the route boundary need the same answer. Wave 182 proved
 * what happens when the predicate is copied: five write paths, four of them
 * fixed, and the fifth keeps taking money.
 *
 * WHY IT READS `spv_launch_signoffs` DIRECTLY RATHER THAN CALLING
 * `listSignoffsForSpv`. That function is partner-scoped by design (it takes a
 * partnerId and ANDs it in), and the sinks here are not all partner-scoped —
 * `engineAddCommitment`'s legacy adapter family reaches ids that may exist only
 * in the legacy mirror. Asking "is THIS VEHICLE attested" must not depend on the
 * caller happening to hold the right partner id, or a vehicle would read as
 * unattested to one caller and attested to another. `spvLaunchSignoffStore.ts`
 * is not modified, imported or re-exported by this file.
 *
 * FAIL BEHAVIOUR — CORRECTED BY WAVE 192 · ITEM B · R164.3. If the sign-off
 * table cannot be read at all (absent on a minimal database, or a driver
 * failure), this now THROWS a refusal naming what could not be read. It fails
 * CLOSED.
 *
 * WHAT IT USED TO DO, AND WHY THAT WAS WRONG. It caught the read failure and
 * `return true` — ATTESTED — on the argument that refusing everything is "a
 * larger and less recoverable failure". That argument inverts the actual
 * recoverability, and it is acute because of WHO CALLS THIS FUNCTION: the only
 * production caller is `assertSpvAttestedForNewCapital` below, i.e. wave 189's
 * own draft-gating enforcement. An unreadable table therefore reported EVERY
 * VEHICLE ATTESTED and let capital attach to an unattested draft, defeating the
 * gate wave 189 had just built — while reporting success. A gate that fails open
 * is worse than no gate, because it reports success.
 *
 * Permitting risks an unattested capital record that cannot be undone; refusing
 * costs a retry. `shared/spvAttestationUnreadable.ts` carries the full argument
 * and the copy. A read that SUCCEEDS and returns no row is, as before, a definite
 * "unattested" and refuses with wave 189's own words.
 *
 * IT CANNOT TRAP SETTLEMENT. Every sink that calls the gate is a NEW-CAPITAL
 * sink; `engineTransitionCommitment`, `chargeFeeObligation` and
 * `waiveFeeObligation` do not call it at all. Wave 182's rule — block new
 * capacity, never block settling commitments that already exist — therefore holds
 * structurally, and wave 192 proves it at route level anyway.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";
import {
  SPV_UNATTESTED_DRAFT_CODE,
  spvUnattestedDraftDecision,
  spvUnattestedDraftHeadline,
  spvUnattestedDraftSentence,
  type SpvUnattestedAttachKind,
} from "../../shared/spvUnattestedDraft";
/* WAVE 192 · ITEM B · R164.3 — the UNREADABLE case, which is a third answer and
   not a synonym for either of the other two. */
import {
  SPV_ATTESTATION_UNREADABLE_CODE,
  spvAttestationUnreadableHeadline,
  spvAttestationUnreadableSentence,
} from "../../shared/spvAttestationUnreadable";

export interface SpvUnattestedDraftError extends Error {
  unattestedDraft: true;
  attachKind: SpvUnattestedAttachKind;
  refusalHeadline: string;
  refusalGuidance: string;
}

export function isSpvUnattestedDraftError(e: unknown): e is SpvUnattestedDraftError {
  return (
    e instanceof Error &&
    e.message === SPV_UNATTESTED_DRAFT_CODE &&
    (e as SpvUnattestedDraftError).unattestedDraft === true &&
    typeof (e as SpvUnattestedDraftError).refusalHeadline === "string"
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 192 · ITEM B · R164.3 — THE UNREADABLE REFUSAL.
 * ══════════════════════════════════════════════════════════════════════════════
 * A SEPARATE ERROR TYPE, not a reuse of `SpvUnattestedDraftError`, deliberately.
 * "There is definitely no attestation" and "we cannot tell whether there is an
 * attestation" are different facts with different remedies: the first is fixed by
 * a general partner signing, the second by an operator restoring a table. Telling
 * a GP to sign an attestation they may already have signed would be a false
 * statement, and collapsing the two would make that unavoidable.
 *
 * It carries the SAME field shape (`refusalHeadline` / `refusalGuidance` /
 * `attachKind`) so every existing 409 responder can serve it by adding one branch
 * rather than learning a new payload. */
export interface SpvAttestationUnreadableError extends Error {
  attestationUnreadable: true;
  attachKind: SpvUnattestedAttachKind;
  refusalHeadline: string;
  refusalGuidance: string;
}

export function isSpvAttestationUnreadableError(e: unknown): e is SpvAttestationUnreadableError {
  return (
    e instanceof Error &&
    e.message === SPV_ATTESTATION_UNREADABLE_CODE &&
    (e as SpvAttestationUnreadableError).attestationUnreadable === true &&
    typeof (e as SpvAttestationUnreadableError).refusalHeadline === "string"
  );
}

/** Build the unreadable refusal. Persists nothing, emits nothing, reads nothing.
 *  The caught driver error is NOT carried on it: a driver message can contain a
 *  filesystem path, and this error's text is rendered to a general partner. */
export function buildSpvAttestationUnreadableError(args: {
  spvName: string | null | undefined;
  kind: SpvUnattestedAttachKind;
}): SpvAttestationUnreadableError {
  const e = new Error(SPV_ATTESTATION_UNREADABLE_CODE) as SpvAttestationUnreadableError;
  e.attestationUnreadable = true;
  e.attachKind = args.kind;
  e.refusalHeadline = spvAttestationUnreadableHeadline(args);
  e.refusalGuidance = spvAttestationUnreadableSentence(args);
  return e;
}

/** Build the refusal. Persists nothing, emits nothing, reads nothing. */
export function buildSpvUnattestedDraftError(args: {
  spvName: string | null | undefined;
  kind: SpvUnattestedAttachKind;
}): SpvUnattestedDraftError {
  const e = new Error(SPV_UNATTESTED_DRAFT_CODE) as SpvUnattestedDraftError;
  e.unattestedDraft = true;
  e.attachKind = args.kind;
  e.refusalHeadline = spvUnattestedDraftHeadline(args);
  e.refusalGuidance = spvUnattestedDraftSentence(args);
  return e;
}

/**
 * Does a durable launch sign-off exist for this vehicle?
 *
 * READ-ONLY. One indexed-by-value lookup on `spv_launch_signoffs.spv_id`. A blank
 * or missing id is NOT attested — an id nobody can name cannot have been signed
 * for.
 *
 * THREE ANSWERS, NOT TWO (wave 192 · item B). `true` — attested. `false` — the
 * read succeeded and there is no sign-off, so definitely unattested. And THROWS
 * `SpvAttestationUnreadableSignal` — the read failed, so the question has no
 * answer and the caller must not be handed one. It used to return `true` here,
 * which is a fail-open that reported success; see the file header.
 *
 * The thrown signal deliberately carries NO vehicle name and NO attach kind,
 * because this function knows neither. `assertSpvAttestedForNewCapital` catches
 * it and builds the customer-facing refusal, which is the only place that holds
 * the name and the kind. The signal is internal and never reaches a screen.
 */
export class SpvAttestationUnreadableSignal extends Error {
  readonly attestationUnreadableSignal = true as const;
  constructor() {
    super(SPV_ATTESTATION_UNREADABLE_CODE);
    this.name = "SpvAttestationUnreadableSignal";
  }
}

export function spvIsAttested(spvId: string | null | undefined): boolean {
  const id = String(spvId ?? "").trim();
  if (id.length === 0) return false;
  try {
    const row = rawDb()
      .prepare(`SELECT 1 AS hit FROM spv_launch_signoffs WHERE spv_id = ? LIMIT 1`)
      .get(id) as { hit?: number } | undefined;
    return row?.hit === 1;
  } catch (err) {
    /* WAVE 192 · ITEM B · R164.3 — FAILS CLOSED. The driver message is LOGGED for
       an operator and is NOT carried on the thrown signal, because it can contain
       a filesystem path and the refusal built from this is rendered to a general
       partner. */
    log.error(
      "[spvAttestationGate.spvIsAttested] sign-off table unreadable; REFUSING new capital (fail-closed, wave 192 item B):",
      (err as Error).message,
    );
    throw new SpvAttestationUnreadableSignal();
  }
}

/**
 * THE SHARED GATE. Every path that could attach a limited partner, a commitment
 * or a fee to a vehicle calls exactly this.
 *
 * THROWS the refusal, or returns cleanly. It never returns a boolean: a sink that
 * forgets to test the boolean is exactly the failure mode wave 182 was fixing and
 * this wave is not repeating.
 */
export function assertSpvAttestedForNewCapital(args: {
  spvId: string | null | undefined;
  spvName: string | null | undefined;
  kind: SpvUnattestedAttachKind;
}): void {
  /* WAVE 192 · ITEM B · R164.3 — the UNREADABLE answer is converted here, and
     only here, into the customer-facing refusal, because this is the only layer
     that holds the vehicle name and the attach kind. Nothing else is caught: a
     bug in the predicate must still surface as a bug, not as a refusal. */
  let attested: boolean;
  try {
    attested = spvIsAttested(args.spvId);
  } catch (err) {
    if (err instanceof SpvAttestationUnreadableSignal) {
      throw buildSpvAttestationUnreadableError({ spvName: args.spvName, kind: args.kind });
    }
    throw err;
  }
  const decision = spvUnattestedDraftDecision({
    attested,
    kind: args.kind,
  });
  if (!decision.refused || decision.kind === null) return;
  throw buildSpvUnattestedDraftError({ spvName: args.spvName, kind: decision.kind });
}
