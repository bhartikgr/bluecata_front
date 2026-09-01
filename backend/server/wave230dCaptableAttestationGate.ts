/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 230D · TASK 3 — THE ATTESTATION ON THE CAP-TABLE COMMIT ROUTE PRODUCTION
 * ACTUALLY USES.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE PRECONDITION, PROVED BEFORE THIS FILE WAS WRITTEN. R226.1 records the
 * finding and its own limitation: *"the 'no caller' finding is grep-and-read,
 * not driven over HTTP … confirm it over HTTP before acting."*
 * `server/__tests__/w230d_captable_attestation_http.test.ts` §A/§B does exactly
 * that, and the observed result was:
 *
 *   · the founder's button posts to `/api/founder/captable/commit-funded-batch`
 *     (path read OUT OF `client/src/pages/founder/RoundDetail.tsx`, comments
 *     stripped, not typed in from the brief);
 *   · that route answered **200 `{"ok":true,"committedCount":1}`** with **no
 *     attestation of any kind in the request**;
 *   · `commit-funded-batch-v2` answered **422 `attestation_required`**;
 *   · **zero** client files reference `-v2`, comment-stripped, whole tree.
 *
 * So production takes the ungated path, exactly as described, and the gate
 * belongs in front of THAT route.
 *
 * WHAT THIS FILE DOES NOT DO, DELIBERATELY:
 *
 * • **It does not wake the dormant twin.** `-v2` is not imported, not
 *   registered, not called and not referenced by any route added here.
 * • **It does not touch the sacred store.** `server/captableCommitStore.ts` is
 *   frozen. This is a middleware registered on the same path IMMEDIATELY BEFORE
 *   `registerCaptableCommitRoutes(app)`, so a satisfied attestation calls
 *   `next()` and the store's own handler runs unchanged, byte for byte.
 * • **It does not degrade or bypass any existing gate.** Auth, founder
 *   ownership, compliance hold and currency resolution all still run — they run
 *   AFTER this, in the handlers that already own them. Nothing here answers 200.
 * • **It invents no evidence.** The attestor is the server-observed session
 *   user; if there is none, the commit is REFUSED rather than attributed to
 *   somebody invented.
 *
 * CONSISTENT WITH THE FOUR PARTNER MONEY GATES, BY REUSE RATHER THAN BY
 * RESEMBLANCE. The three tick-boxes, the typed legal name, the
 * basis-of-determination and the version token are validated by the SAME shared
 * functions the wave-211 partner gates use (`wave211AllTicksAccepted`,
 * `wave211SignedNameOutcome`, `wave211BasisOutcome`, `wave211VersionMatches`)
 * with the SAME body keys and the SAME error codes. A second, slightly
 * different definition of "attested" is exactly how two gates drift apart.
 *
 * FAIL CLOSED, INCLUDING ON THE RECORD ITSELF. The attestation is recorded
 * through wave 186's existing audit writer — no new table, no second audit
 * path. If that write fails, the request is REFUSED and nothing is committed. A
 * gate that lets the money action through while failing to record the
 * confirmation would produce exactly the false evidence R233 is about.
 *
 * NO MONEY ARITHMETIC HAPPENS HERE. This middleware reads no amount, sums
 * nothing, converts no currency and hardcodes no price. It decides one thing:
 * whether a confirmation was given.
 */
import type { Express, Request, Response, NextFunction } from "express";

import {
  W211_BODY_KEY_BASIS,
  W211_BODY_KEY_SIGNED_NAME,
  W211_BODY_KEY_TICK_1,
  W211_BODY_KEY_TICK_2,
  W211_BODY_KEY_TICK_3,
  W211_BODY_KEY_VERSION,
  W211_ERR_BASIS_TOO_LONG,
  W211_ERR_NAME_TOO_LONG,
  W211_ERR_TICKS_REQUIRED,
  W211_ERR_VERSION_MISMATCH,
  wave211AllTicksAccepted,
  wave211AttestationVersion,
  wave211BasisOutcome,
  wave211SignedNameOutcome,
  wave211VersionMatches,
} from "../shared/wave211MoneyEventAttestation";
import { appendAdminAudit, isAuditWriteFailure } from "./adminPlatformStore";
import { log } from "./lib/logger";

/** The one path this gate stands in front of — the one production hits. */
export const W230D_COMMIT_PATH = "/api/founder/captable/commit-funded-batch";

/** The audit event the attestation is recorded as. */
export const W230D_ATTESTATION_EVENT = "captable.commit_funded_batch.attested";

/** Refused because the confirmation could not be RECORDED, not because it was bad. */
export const W230D_ERR_RECORD_FAILED = "WAVE230D_ATTESTATION_RECORD_FAILED";
/** Refused because there is no server-observed identity to attribute it to. */
export const W230D_ERR_NO_ACTOR = "WAVE230D_ATTESTATION_NO_ACTOR";

function refuse(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ ok: false, error, message });
}

/**
 * The middleware. Runs before the sacred store's handler on the same path.
 *
 * Order of checks is deliberate: the shape of the confirmation is validated
 * before any identity or storage concern, so a founder is never told their name
 * is wrong when in fact the version token was stale.
 */
export function wave230dCaptableAttestationGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const body = (req.body ?? {}) as Record<string, unknown>;

  /* The version token. A paraphrased or stale confirmation is refused here
     rather than compared as prose, which is what the partner gates do. */
  if (!wave211VersionMatches("money_event", body[W211_BODY_KEY_VERSION])) {
    refuse(
      res,
      400,
      W211_ERR_VERSION_MISMATCH,
      "Capavate did not commit this cap-table batch. The confirmation Capavate received is not the current wording. Reload this page and confirm again. Nothing was committed.",
    );
    return;
  }

  /* All three tick-boxes. */
  if (
    !wave211AllTicksAccepted(
      body[W211_BODY_KEY_TICK_1],
      body[W211_BODY_KEY_TICK_2],
      body[W211_BODY_KEY_TICK_3],
    )
  ) {
    refuse(
      res,
      400,
      W211_ERR_TICKS_REQUIRED,
      "Capavate did not commit this cap-table batch. All three confirmations must be accepted. Nothing was committed.",
    );
    return;
  }

  /* The typed legal name. Never truncated: a silently shortened legal name is a
     forged legal name, so an over-long one is refused with its limit named. */
  const name = wave211SignedNameOutcome(body[W211_BODY_KEY_SIGNED_NAME]);
  if (!name.ok) {
    refuse(
      res,
      400,
      name.code,
      name.code === W211_ERR_NAME_TOO_LONG
        ? "Capavate did not commit this cap-table batch. The full legal name on the confirmation is too long, and Capavate will not store part of a signature."
        : "Capavate did not commit this cap-table batch. Type your full legal name to confirm. Nothing was committed.",
    );
    return;
  }
  /* The basis of determination. */
  const basis = wave211BasisOutcome(body[W211_BODY_KEY_BASIS]);
  if (!basis.ok) {
    refuse(
      res,
      400,
      basis.code,
      basis.code === W211_ERR_BASIS_TOO_LONG
        ? "Capavate did not commit this cap-table batch. The basis you entered is longer than Capavate can store, and it will not store part of it."
        : "Capavate did not commit this cap-table batch. State the basis on which you determined these figures. Nothing was committed.",
    );
    return;
  }
  /* The attestor is the SERVER-OBSERVED session user, never a value supplied by
     the caller. No session, no attribution, no commit. */
  const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
  const actorId = typeof ctx?.userId === "string" && ctx.userId.length > 0 ? ctx.userId : null;
  if (actorId === null) {
    refuse(
      res,
      403,
      W230D_ERR_NO_ACTOR,
      "Capavate did not commit this cap-table batch because it cannot identify who is confirming it. Nothing was committed.",
    );
    return;
  }

  /* Record it BEFORE the commit runs, and refuse if the record fails. An
     unrecorded confirmation is not a confirmation. */
  let entry: ReturnType<typeof appendAdminAudit> | null = null;
  try {
    entry = appendAdminAudit(
      actorId,
      `captable:${typeof body.companyId === "string" ? body.companyId : ""}`,
      W230D_ATTESTATION_EVENT,
      {
        companyId: typeof body.companyId === "string" ? body.companyId : null,
        roundId: typeof body.roundId === "string" ? body.roundId : null,
        attestationVersion: wave211AttestationVersion("money_event"),
        signedName: name.value,
        basisOfDetermination: basis.value,
        ticksAccepted: 3,
        route: W230D_COMMIT_PATH,
      },
    );
  } catch (err) {
    log.error(
      "[wave230dCaptableAttestationGate] attestation audit write threw:",
      (err as Error).message,
    );
    entry = null;
  }
  if (entry === null || isAuditWriteFailure(entry)) {
    refuse(
      res,
      500,
      W230D_ERR_RECORD_FAILED,
      "Capavate did not commit this cap-table batch because it could not record your confirmation. Nothing was committed. Please try again.",
    );
    return;
  }

  next();
}

/**
 * MUST be registered BEFORE `registerCaptableCommitRoutes(app)`. Express
 * dispatches in registration order, so registering it after would leave the
 * store's handler answering first and this gate would never run — a gate that
 * is installed but unreachable, which is one of the inert mechanisms this
 * programme keeps finding.
 */
export function registerWave230dCaptableAttestationGate(app: Express): void {
  app.post(W230D_COMMIT_PATH, wave230dCaptableAttestationGate);
}
