/**
 * server/wave195CommitCurrencyRoutes.ts
 *
 * WAVE 195 · ITEM B + ITEM C · R167 — SUPPLY THE ROUND'S CURRENCY BEFORE THE
 * SACRED STORE EVER NEEDS ITS DEFAULT, FROM OUTSIDE THE FROZEN FILE.
 *
 * ══ THE LINE THAT CANNOT BE EDITED ═══════════════════════════════════════════
 * `server/captableCommitStore.ts:713`:
 *
 *     const currency = (args.currency ?? "USD").toUpperCase();
 *
 * That file is SACRED (`scripts/sacred_check.sh`, 48 entries, 9 owner-ratified
 * waivers). R121 is absolute: fix forward from a non-sacred layer, never seek a
 * tenth waiver. Wave 189 learned this the expensive way — it edited
 * `server/messagingStore.ts` directly, tripped `npm run sacred`, reverted
 * byte-for-byte and rebuilt the change as a pre-router. This file is that shape.
 *
 * ══ MADE UNREACHABLE, NOT REMOVED (R167 ITEM B.2) ════════════════════════════
 * The default is not deleted — it cannot be, the file is frozen. It is starved.
 * Express dispatches in registration order, so this module's handlers run BEFORE
 * the sacred ones (`registerWave195CommitCurrencyRoutes(app)` is called before
 * `registerCaptableCommitRoutes(app)` in `server/routes.ts`, and a comment there
 * says so). Each hook resolves the round's actual currency and puts it where the
 * sacred handler will read it, so `args.currency` is never `undefined` and the
 * `?? "USD"` branch never evaluates. Where a currency CANNOT be established
 * honestly, the hook REFUSES and NAMES THE MISSING FACT — it never quietly
 * becomes USD.
 *
 * WHERE EACH SACRED HANDLER TAKES ITS CURRENCY FROM, which is what determines the
 * shape of each hook (read from the sacred source, not assumed):
 *
 *   · POST /api/founder/captable/commit-funded            (store :1308 → :1312)
 *       `req.body.currency` when a non-empty string, else the route's own "USD"
 *       literal, then into `commitFunded()` where the `?? "USD"` sits.
 *       → the hook sets `req.body.currency`.
 *   · POST /api/founder/captable/commit-funded-batch      (store :1070 → :1074)
 *       Reads NOTHING from the body: it takes `e.currency` off each
 *       `funded_queue` row (`getFundedQueue()`, store :1092/:1198). It has no USD
 *       default of its own — the queue row's value flows straight through.
 *       → the hook corrects the QUEUE ROW via the store's own `enqueueFunded()`,
 *         which is an upsert on `funded_queue` and touches NO commit row.
 *   · POST /api/founder/captable/commit-funded-batch-v2   (V2548 :129)
 *       `entries[].currency` when a non-empty string, else its own "USD" at :174.
 *       → the hook fills `entries[].currency`.
 *
 * ══ ITEM B.4 — WHICH REGISTRAR PRODUCTION ACTUALLY USES ══════════════════════
 * WAVE 189'S REGISTRAR LESSON (R166.1): production mounts one registrar and a
 * dormant twin exists elsewhere, so a proof against the twin proves nothing.
 * Established three ways before a line was written (full evidence in
 * build_log/wave195/W195_PREFLIGHT.md §3):
 *
 *   1. MOUNT — `server/routes.ts:1337` calls `registerCaptableCommitRoutes(app)`
 *      from the SACRED `server/captableCommitStore.ts:911`. `:1340` also mounts
 *      the twin `registerCaptableCommitV2548Routes` from
 *      `server/lib/captableCommitV2548.ts:116`.
 *   2. CLIENT — the only call sites in the client tree are
 *      `client/src/pages/founder/RoundDetail.tsx:2552` (→ `-batch`),
 *      `client/src/components/founder/CapTableInterim.tsx:93` (→ `commit-funded`)
 *      and `:111` (→ `-batch`). NO client file references `-batch-v2` at all.
 *   3. UI — the visible control is `data-testid="button-commit-funded"` at
 *      RoundDetail.tsx:2640, on the `-batch` path.
 *
 * SO PRODUCTION RUNS THE SACRED PAIR, and the v2 route is dormant. All three are
 * hooked anyway — the dormant one because "dormant" is a fact about today's
 * client, not a guarantee, and it carries its own `: "USD"` default at :174 —
 * but the tests that matter drive `commit-funded` and `commit-funded-batch`,
 * the routes the buttons actually call.
 *
 * ══ THIS FILE MUTATES NO COMMIT ROW ══════════════════════════════════════════
 * There is no INSERT, UPDATE or DELETE against `captable_commits` here, and the
 * table is not named in this file at all. The only write is `enqueueFunded()`
 * against `funded_queue` — a pre-commit staging table, not the hash-chained
 * ledger — and it only ever corrects a currency the round itself states.
 *
 * ══ IT CANNOT TAKE AWAY AN EXISTING VERDICT ══════════════════════════════════
 * Every hook `next()`s — handing the request to the untouched sacred handler —
 * whenever it is not certain the caller would have been allowed through:
 *   · not authenticated                → next() (sacred `requireAuth` 401s)
 *   · account suspended/inactive       → next() (sacred `requireAuth` 403s)
 *   · not admin and not this company's founder
 *                                      → next() (sacred gate 403s)
 *   · companyId/roundId missing        → next() (sacred handler 400s)
 *   · anything throws in here          → next() (fail OPEN to the sacred
 *                                        handler's own behaviour, never a
 *                                        500 that blocks capital)
 * A refusal is therefore only ever issued to a caller the sacred handler was
 * about to let commit. Combined with the resolver's branch 3 and branch 5, which
 * resolve rather than refuse for legacy state, NO commit that succeeds today can
 * start failing because of this wave.
 *
 * ══ R156.1 / R156.2 ═════════════════════════════════════════════════════════
 * No currency literal appears in any code path in this file. No conversion. No
 * arithmetic of any kind on any amount — no `Number()`, `parseInt`,
 * `parseFloat`, `Decimal` or `BigInt`. Amounts are forwarded untouched as the
 * strings the caller sent.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { getUserContext } from "./lib/userContext";
import { getAccountStatusByUserId, isBlockedAccountStatus } from "./lib/accountStatus";
import { enqueueFunded, getFundedQueue } from "./captableCommitStore";
import {
  resolveCommitCurrency,
  roundReferenceUnusableMessage,
  commitCurrencyProvenance,
  readCommitCurrencyDeclaration,
  declarationFingerprint,
  COMMIT_CURRENCY_DECLARATION_KEY,
  type CommitCurrencyResolution,
} from "./lib/wave195CommitCurrencyDeclaration";
import { log } from "./lib/logger";

/* ─────────────────────────────────────────────────────────────────────────── */
/* THE HAND-BACK GUARD — everything uncertain goes to the sacred handler        */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Would the sacred handler have let this caller commit?
 *
 * Deliberately reproduces the sacred gate's QUESTION, not its ANSWER: when the
 * answer is "no", this returns false and the caller `next()`s so the SACRED
 * handler emits its own 401/403 verbatim. Nothing here ever sends an auth
 * response, so no existing auth test can change verdict — which is why
 * `v15_captable_auth` keeps its exact results.
 *
 * `getUserContext` and the account-status readers are the same functions the
 * sacred `requireAuth` calls, so a caller resolves identically on both sides.
 */
function callerWouldBeAllowed(req: Request, companyId: string): boolean {
  let ctx;
  try {
    ctx = getUserContext(req);
  } catch {
    return false;
  }
  if (!ctx?.isAuthed) return false;
  try {
    if (ctx.userId && isBlockedAccountStatus(getAccountStatusByUserId(ctx.userId))) {
      return false;
    }
  } catch {
    /* Status unreadable — the sacred `requireAuth` will 503. Hand it back. */
    return false;
  }
  if (ctx.isAdmin) return true;
  const companies = ctx.founder?.companies ?? [];
  return companies.some((c) => c.companyId === companyId);
}

/**
 * THE GUARD ADVERSARIAL CASE X1h FORCED.
 *
 * Returns a refusal when the body names a round in a form no lookup can use, and
 * `null` when the request should be handed back to the sacred handler unchanged.
 *
 * The distinction matters and is drawn from measured behaviour, not taste:
 *   · absent / null / "" -> hand back. The sacred handler answers each with its
 *     own 400 (X1h measured exactly that), and duplicating it here would take a
 *     response away from the owner of that route.
 *   · present but not a string (a number, an array, an object) -> REFUSE. The
 *     sacred handler returned 200 for `12345` and `["r"]`, wrote a commit row
 *     defaulted by `?? "USD"`, and left `verifyChain()` reporting a broken
 *     ledger. There is no honest currency answer for a round that cannot be
 *     looked up, so the request must stop here.
 */
function unusableRoundReference(
  raw: unknown,
): Extract<CommitCurrencyResolution, { ok: false }> | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string") return null;
  const kind = Array.isArray(raw) ? "a list" : `a ${typeof raw}`;
  return {
    ok: false,
    code: "ROUND_REFERENCE_UNUSABLE",
    message: roundReferenceUnusableMessage(kind),
    missingFact: "the round's identifier, as text",
    roundId: "",
  };
}

/** The 409 body a refusal sends. `error` is a stable machine code; `message` is
 *  the human sentence, already fitted under the client's 240-char gate. */
function refusalBody(
  refusal: Extract<CommitCurrencyResolution, { ok: false }>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ok: false,
    error: refusal.code,
    message: refusal.message,
    /* NAME THE MISSING FACT — R167 item B.2. Not a currency, and not a guess:
       the specific fact the platform does not have. */
    missingFact: refusal.missingFact,
    roundId: refusal.roundId,
    declarationKey: COMMIT_CURRENCY_DECLARATION_KEY,
    ...(extra ?? {}),
  };
}

function logRefusal(route: string, refusal: Extract<CommitCurrencyResolution, { ok: false }>): void {
  log.warn(
    `[wave195CommitCurrency] REFUSED ${route}: ${refusal.code} — ${refusal.missingFact}. ` +
      "No commit was written and no currency was assumed.",
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* HOOK 1 — POST /api/founder/captable/commit-funded (single)                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * The single-commit path. Sacred handler at `captableCommitStore.ts:1312`.
 *
 * WHAT IT SETS, AND THE ONE JUDGEMENT INSIDE IT:
 *   · The round STATES a currency → `req.body.currency` is set to it,
 *     overriding whatever the caller sent. The round's own record is the
 *     authority on the round's currency; that is the entire point of R167's
 *     forward fix, and letting a client body outrank it would preserve exactly
 *     the defect the owner ruled on.
 *   · The round states NONE and the declaration covers it → the DECLARED
 *     currency is supplied, but ONLY if the caller did not state one. A caller
 *     who explicitly says EUR on a legacy round is not overridden: the
 *     declaration speaks for silence, not over a stated fact.
 *   · Unresolvable → 409, named, nothing written.
 */
function commitFundedSingleHook(req: Request, res: Response, next: NextFunction): void {
  try {
    const body = (req.body ?? {}) as {
      companyId?: unknown;
      roundId?: unknown;
      currency?: unknown;
      invitationId?: unknown;
    };
    const companyId = typeof body.companyId === "string" ? body.companyId : "";
    const roundId = typeof body.roundId === "string" ? body.roundId : "";
    /* AUTH FIRST, ALWAYS. A caller who is not entitled to this company gets
       the SACRED handler's own 401/403 and learns nothing here — including
       nothing about whether their round reference was well formed. */
    if (!companyId) return next();
    if (!callerWouldBeAllowed(req, companyId)) return next();
    const unusable = unusableRoundReference(body.roundId);
    if (unusable) {
      logRefusal("commit-funded", unusable);
      res.status(409).json(refusalBody(unusable));
      return;
    }
    if (!roundId) return next();

    const resolution = resolveCommitCurrency(roundId);
    if (!resolution.ok) {
      logRefusal("commit-funded", resolution);
      res.status(409).json(
        refusalBody(resolution, {
          invitationId: typeof body.invitationId === "string" ? body.invitationId : null,
        }),
      );
      return;
    }

    const callerStated =
      typeof body.currency === "string" && body.currency.trim().length > 0
        ? body.currency.trim()
        : null;

    if (resolution.provenance === "round_record") {
      (req.body as Record<string, unknown>).currency = resolution.currency;
    } else if (callerStated === null) {
      (req.body as Record<string, unknown>).currency = resolution.currency;
      (req as Request & { wave195CurrencyAttribution?: unknown }).wave195CurrencyAttribution =
        resolution.attribution;
    }
    /* else: the caller stated a currency and the round records none — leave the
       caller's value exactly as sent. The sacred handler will use it, so the
       `?? "USD"` default is still never reached. */

    attachCommitAttribution(res, resolution);
    return next();
  } catch (err) {
    log.warn(
      "[wave195CommitCurrency] single hook failed open:",
      (err as Error).message,
    );
    return next();
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* HOOK 2 — POST /api/founder/captable/commit-funded-batch                      */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * The batch path — THE ONE THE BUTTON CALLS (`button-commit-funded`,
 * RoundDetail.tsx:2640 → :2552).
 *
 * The sacred handler ignores the request body's currency entirely and reads
 * `e.currency` off each `funded_queue` row, so supplying a currency here means
 * correcting the QUEUE ROW before the handler reads it. That is done with the
 * store's own exported `enqueueFunded()` — an upsert keyed on `invitationId`
 * (store :223, `onConflictDoUpdate`) — so no second write path into
 * `funded_queue` is created and NO commit row is touched.
 *
 * A queue row is rewritten only when the round STATES a currency that the row
 * disagrees with, or when the row carries no currency at all. Correcting the
 * staging row is not a mutation of the ledger: nothing has been committed yet.
 */
function commitFundedBatchHook(req: Request, res: Response, next: NextFunction): void {
  try {
    const body = (req.body ?? {}) as { companyId?: unknown; roundId?: unknown };
    const companyId = typeof body.companyId === "string" ? body.companyId : "";
    const roundId = typeof body.roundId === "string" ? body.roundId : "";
    /* AUTH FIRST, ALWAYS. A caller who is not entitled to this company gets
       the SACRED handler's own 401/403 and learns nothing here — including
       nothing about whether their round reference was well formed. */
    if (!companyId) return next();
    if (!callerWouldBeAllowed(req, companyId)) return next();
    const unusable = unusableRoundReference(body.roundId);
    if (unusable) {
      logRefusal("commit-funded-batch", unusable);
      res.status(409).json(refusalBody(unusable));
      return;
    }
    if (!roundId) return next();

    /* Same filter the sacred handler applies at store :1092, so this reasons
       about exactly the rows it is about to commit — no more, no fewer. */
    const candidates = getFundedQueue().filter(
      (e) => e.companyId === companyId && e.roundId === roundId,
    );
    /* Nothing queued: the sacred handler returns its "No funded entries
       waiting." reply. Refusing here would replace a benign no-op with an
       error. */
    if (candidates.length === 0) return next();

    const resolution = resolveCommitCurrency(roundId);
    if (!resolution.ok) {
      logRefusal("commit-funded-batch", resolution);
      res.status(409).json(
        refusalBody(resolution, { companyId, queuedEntryCount: candidates.length }),
      );
      return;
    }

    let corrected = 0;
    candidates.forEach((e) => {
      const rowStated =
        typeof e.currency === "string" && e.currency.trim().length > 0
          ? e.currency.trim()
          : null;
      const needsCorrection =
        rowStated === null ||
        (resolution.provenance === "round_record" &&
          rowStated.toUpperCase() !== resolution.currency);
      if (!needsCorrection) return;
      enqueueFunded({ ...e, currency: resolution.currency });
      corrected += 1;
    });
    if (corrected > 0) {
      log.info(
        `[wave195CommitCurrency] supplied currency ${resolution.currency} ` +
          `(${resolution.provenance}) to ${corrected} queued entr(ies) on round ` +
          `${roundId} before the sacred batch handler read them.`,
      );
    }

    attachCommitAttribution(res, resolution);
    return next();
  } catch (err) {
    log.warn("[wave195CommitCurrency] batch hook failed open:", (err as Error).message);
    return next();
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* HOOK 3 — POST /api/founder/captable/commit-funded-batch-v2 (dormant twin)    */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * The DORMANT registrar (`server/lib/captableCommitV2548.ts:129`). No client file
 * references it — proved by grep, recorded in the header above — but it mounts on
 * the same app and carries its own `: "USD"` at :174, so leaving it unhooked
 * would leave a live HTTP route through which a commit can still silently become
 * USD. Its entries each carry their own `roundId`, so each is resolved
 * separately.
 */
function commitFundedBatchV2Hook(req: Request, res: Response, next: NextFunction): void {
  try {
    const body = (req.body ?? {}) as {
      companyId?: unknown;
      roundId?: unknown;
      entries?: unknown;
    };
    const companyId = typeof body.companyId === "string" ? body.companyId : "";
    const roundId = typeof body.roundId === "string" ? body.roundId : "";
    /* AUTH FIRST, ALWAYS. A caller who is not entitled to this company gets
       the SACRED handler's own 401/403 and learns nothing here — including
       nothing about whether their round reference was well formed. */
    if (!companyId) return next();
    if (!callerWouldBeAllowed(req, companyId)) return next();
    const unusable = unusableRoundReference(body.roundId);
    if (unusable) {
      logRefusal("commit-funded-batch-v2", unusable);
      res.status(409).json(refusalBody(unusable));
      return;
    }
    if (!roundId) return next();
    if (!Array.isArray(body.entries) || body.entries.length === 0) return next();

    const entries = body.entries as Array<Record<string, unknown>>;
    for (let i = 0; i < entries.length; i += 1) {
      const e = entries[i];
      if (!e || typeof e !== "object") continue;
      const entryRoundId =
        typeof e.roundId === "string" && e.roundId.length > 0 ? e.roundId : roundId;
      const resolution = resolveCommitCurrency(entryRoundId);
      if (!resolution.ok) {
        logRefusal("commit-funded-batch-v2", resolution);
        res.status(409).json(
          refusalBody(resolution, {
            companyId,
            entryIndex: i,
            invitationId: typeof e.invitationId === "string" ? e.invitationId : null,
          }),
        );
        return;
      }
      const stated =
        typeof e.currency === "string" && e.currency.trim().length > 0
          ? e.currency.trim()
          : null;
      if (resolution.provenance === "round_record" || stated === null) {
        e.currency = resolution.currency;
      }
    }
    return next();
  } catch (err) {
    log.warn("[wave195CommitCurrency] v2 hook failed open:", (err as Error).message);
    return next();
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* ITEM A.5 — SURFACE IT WHERE IT MATTERS                                      */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Attach the attribution to the RESPONSE of a commit, so a commit that took the
 * declared currency is ATTRIBUTABLE TO THE DECLARATION at the moment it happens
 * (R167 item C.1) rather than only in a separate report.
 *
 * Implemented as a `res.json` wrap — the technique
 * `server/lib/complianceHoldAuditGuard.ts:200-226` already uses on this same
 * sacred route — because the sacred handler builds and sends its own body and
 * cannot be edited. It only ever ADDS a key to a successful body; a refusal or
 * error body from the sacred handler is passed through byte-for-byte.
 */
function attachCommitAttribution(res: Response, resolution: CommitCurrencyResolution): void {
  if (!resolution.ok) return;
  const originalJson = res.json.bind(res);
  res.json = ((payload: unknown) => {
    try {
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const p = payload as Record<string, unknown>;
        if (p.ok === true) {
          p.currencyProvenance = {
            currency: resolution.currency,
            source: resolution.provenance,
            attribution: resolution.attribution,
          };
        }
      }
    } catch {
      /* Never let a reporting concern break a commit response. */
    }
    return originalJson(payload as never);
  }) as Response["json"];
}

/**
 * `GET /api/founder/captable/ledger` — the payload that already reports every
 * commit's amount AND its currency. Wrapping it is the LIGHTEST HONEST PLACEMENT
 * (Item A.5): the answer to "why are these USD?" travels with the numbers it
 * explains, so nobody has to know a second endpoint exists to find it, and the
 * per-response counts show the declaration's boundary next to the rows.
 *
 * WHY NOT A SCREEN. `client/src/pages/founder/CapTable.tsx` is SACRED and
 * `RoundDetail.tsx` is guard-fingerprinted on its SOURCE TEXT under R143.1 —
 * where adding a `td` renumbers sibling cells (wave 182) and renaming a loop
 * variable retires a tab identity (wave 188) — with wave 194 concurrently
 * working in the client tree. Editing either to render this would risk the guard
 * and a collision for a caption. THIS IS A DECLARED LIMITATION, NOT A CLAIM OF
 * COMPLETENESS: the declaration is in the API payload and on its own endpoint,
 * and NO RENDERED SCREEN SHOWS IT. It is written down here, in
 * W195_BUILD.md and in OWNER_DECLARATION_RECORD.md rather than left for someone
 * to discover.
 */
function ledgerProvenanceHook(req: Request, res: Response, next: NextFunction): void {
  try {
    const originalJson = res.json.bind(res);
    res.json = ((payload: unknown) => {
      try {
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const p = payload as Record<string, unknown>;
          /* Only the success shape carries entries; 400/401/403 bodies are left
             exactly as the sacred handler wrote them. */
          if (Array.isArray(p.entries)) {
            const seqs: number[] = [];
            (p.entries as Array<Record<string, unknown>>).forEach((e) => {
              if (e && typeof e.seq === "number") seqs.push(e.seq);
            });
            p.currencyProvenance = commitCurrencyProvenance(seqs);
          }
        }
      } catch (err) {
        log.warn(
          "[wave195CommitCurrency] ledger provenance annotation skipped:",
          (err as Error).message,
        );
      }
      return originalJson(payload as never);
    }) as Response["json"];
  } catch {
    /* fall through — the ledger must render with or without provenance */
  }
  return next();
}

/**
 * The dedicated read: one endpoint that answers, on its own, "why does the
 * platform believe these commits are in this currency?" — in the owner's own
 * words, with the coverage, the boundary, and an explicit statement that nothing
 * was rewritten.
 *
 * Readable by any authenticated caller. It exposes no company data, no amounts
 * and no identities — only the platform-level declaration, which is precisely
 * the fact an auditor needs to be able to ask for without first being granted a
 * company.
 */
function declarationReadEndpoint(req: Request, res: Response): void {
  let ctx;
  try {
    ctx = getUserContext(req);
  } catch {
    ctx = null;
  }
  if (!ctx?.isAuthed) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "Sign in to continue." });
    return;
  }
  const declaration = readCommitCurrencyDeclaration();
  res.json({
    ok: true,
    declared: declaration !== null,
    declarationKey: COMMIT_CURRENCY_DECLARATION_KEY,
    declaration,
    provenance: commitCurrencyProvenance(),
    fingerprint: declarationFingerprint(),
    /* Stated on the response, not just in a document, because this is the
       question the endpoint exists to answer. */
    commitRowsModifiedByThisDeclaration: 0,
    backfilled: false,
  });
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* REGISTRATION                                                                */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * MUST be called BEFORE `registerCaptableCommitRoutes(app)` and before
 * `registerCaptableCommitV2548Routes(app)` in `server/routes.ts`.
 *
 * Express matches in registration order and the sacred handlers END the request,
 * so a hook registered afterwards would never run and the `?? "USD"` default
 * would stay reachable. `server/roundMathRoutes.ts:406-407` and
 * `server/lib/complianceHoldAuditGuard.ts:234` carry the same requirement on the
 * same routes and are mounted in the same place for the same reason.
 */
export function registerWave195CommitCurrencyRoutes(app: Express): void {
  app.post("/api/founder/captable/commit-funded", commitFundedSingleHook);
  app.post("/api/founder/captable/commit-funded-batch", commitFundedBatchHook);
  app.post("/api/founder/captable/commit-funded-batch-v2", commitFundedBatchV2Hook);
  app.get("/api/founder/captable/ledger", ledgerProvenanceHook);
  app.get("/api/founder/captable/commit-currency-declaration", declarationReadEndpoint);
}
