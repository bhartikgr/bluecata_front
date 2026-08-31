/**
 * server/lib/wave197BridgeInboundLeakGuard.ts — WAVE 197 / R169 Item A.3.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────────
 *
 * `server/lib/bridgeRuntime.ts:254` ends the inbound webhook handler with:
 *
 *     } catch (err) {
 *       res.status(500).json({ error: "handler_error", message: (err as Error).message });
 *     }
 *
 * `dispatchInbound(env)` runs real handlers that touch the database, so that
 * `message` can carry driver text, a table name, a source path or a stack
 * fragment straight back over the wire. The owner's standing instruction is
 * verbatim: "I don't want any exposure of our internal process."
 *
 * ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 *
 * `server/lib/bridgeRuntime.ts` is entry 11 of the 48-entry SACRED manifest
 * (`bash scripts/sacred_check.sh --list`). It is FROZEN. It is not opened, not
 * edited, and no tenth waiver is sought. R169 requires the leak to be closed
 * from a NON-SACRED layer, which is the pattern waves 189, 192 and 195 all used.
 *
 * ── A CORRECTION TO WAVE 196'S CLASSIFICATION ─────────────────────────────
 *
 * Wave 196 filed this site under "admin-only, deferred". That is wrong, and it
 * matters. `POST /api/bridge/inbound` carries NO `requireAdmin` — it is the one
 * deliberate exception to the B16 admin lockdown, authenticated instead by HMAC
 * (`verifyHmac(body, sig)`). So the audience is anything holding the bridge
 * secret, not an administrator. It is still not a browser surface, so it is not
 * member-facing either; it sits between the two, and it is fixed here rather
 * than deferred again.
 *
 * ── THE MECHANISM, AND WHY IT IS THE MINIMUM ──────────────────────────────
 *
 * The in-tree precedent is two lines away in `server/routes.ts`:
 * `registerBridgeOutboundGuard(app)` at :1423 pre-registers
 * `app.post("/api/bridge/drain", guard)` so Express matches it BEFORE
 * `registerBridgeRuntimeRoutes(app)` at :1425. Express dispatches route
 * handlers in registration order, so anything registered in that slot runs
 * first.
 *
 * This guard uses that slot, but it deliberately does NOT short-circuit and does
 * NOT reimplement the sacred handler:
 *
 *   1. It registers a middleware on the same method+path and calls `next()`
 *      immediately, so the SACRED handler still does all of the work — HMAC
 *      verification, idempotency, dispatch, status codes, every field of every
 *      success body. Duplicating any of that would be a second implementation
 *      of frozen logic, which is worse than the leak.
 *   2. Before calling `next()`, it swaps `res.json` for a one-shot wrapper. If
 *      the body the sacred handler eventually emits carries internal detail, the
 *      wrapper substitutes an authored sentence in that field and logs the raw
 *      text. Otherwise it passes the body through byte-for-byte.
 *
 * So the sacred file's bytes, control flow, status codes and success payloads
 * are untouched; only the text of a failure field is replaced, at the boundary.
 *
 * ── DIAGNOSTICS ───────────────────────────────────────────────────────────
 *
 * The raw handler error is logged in full with `log.error` at the moment it is
 * suppressed. Since the sacred handler logs nothing on this path, the operator
 * now sees strictly MORE than before, not less. Sanitising the response does not
 * cost the engineer anything they had.
 *
 * ── SCOPE LIMIT, STATED HONESTLY ──────────────────────────────────────────
 *
 * This guard covers `POST /api/bridge/inbound` only. It is not a global response
 * filter: a tree-wide `res.json` interceptor would change the behaviour of 1277
 * routes at once to fix one line, which is not the smallest correct change and
 * is not something to do while wave 194 is still running.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { carriesInternalDetail } from "./sanitize";
import { BRIDGE_INBOUND_FAILURE } from "./wave197FailureCopy";
import { log } from "./logger";

/**
 * The fields a bridge failure body can put text in. `bridgeRuntime.ts:254` uses
 * `message`; `error` is checked too because the same handler's other exits use
 * `error` for a code, and a code is only safe while it stays a code.
 */
const TEXT_FIELDS = ["message", "error", "detail"] as const;

/**
 * TRUE when a string is a bare machine code and nothing else — `bridge_failed`,
 * `invalid_signature`, `handler_error`. One lowercase token, underscores allowed,
 * NO whitespace and NO punctuation.
 *
 * WHY THIS EXISTS, AND WHY IT IS NARROW. Wave 197's adversarial injection phase
 * got a bare table name (`collective_kyc_blobs`) through `carriesInternalDetail`,
 * so a lowercase snake_case pattern was added to `INTERNAL_DETAIL_PATTERNS`. That
 * pattern is correct for HUMAN text and wrong for the `error` field, which is a
 * machine code on every exit of the sacred handler: without this exemption every
 * distinct bridge code — `invalid_signature`, `unknown_kind`, `replayed` — would
 * have collapsed to the single value `handler_error`, silently destroying a
 * contract that machine callers switch on. Found by re-reading the widened
 * pattern against this call site, and asserted in
 * `server/__tests__/w197_item_a_member_leak.test.ts` group A5.
 *
 * The exemption applies to `error` ONLY, never to `message` / `detail` /
 * `description` / `reason`, and only to a value with no spaces — so
 * `"no such column: bridge_events.applied_at"` in `error` is still replaced.
 * The residual risk is stated plainly: a bare table name placed in `error` and
 * nowhere else would pass. It is a MACHINE field that no surface renders, the
 * human `message` beside it is still sanitised, and choosing this over flattening
 * every bridge code is the deliberate trade.
 */
function isBareMachineCode(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

/**
 * Replace any field of `body` whose value carries internal detail. Returns the
 * body unchanged (same object identity) when there is nothing to replace, so the
 * pass-through case is provably non-mutating.
 */
export function sanitizeBridgeFailureBody(body: unknown): {
  body: unknown;
  replaced: readonly string[];
  rawSuppressed: readonly string[];
} {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { body, replaced: [], rawSuppressed: [] };
  }
  const source = body as Record<string, unknown>;
  const replaced: string[] = [];
  const rawSuppressed: string[] = [];
  for (const field of TEXT_FIELDS) {
    const value = source[field];
    if (typeof value !== "string") continue;
    if (field === "error" && isBareMachineCode(value)) continue;
    if (carriesInternalDetail(value)) {
      replaced.push(field);
      rawSuppressed.push(value);
    }
  }
  if (replaced.length === 0) return { body, replaced: [], rawSuppressed: [] };
  const out: Record<string, unknown> = { ...source };
  for (const field of replaced) {
    /* `error` is a machine-readable code on every other exit of the sacred
       handler. If it is carrying leaked prose instead, it is replaced with a
       stable code rather than with a sentence, so a machine caller still gets a
       code and a human still gets the sentence in `message`. */
    out[field] = field === "error" ? "handler_error" : BRIDGE_INBOUND_FAILURE;
  }
  if (typeof out.message !== "string" || out.message.length === 0) {
    out.message = BRIDGE_INBOUND_FAILURE;
  }
  return { body: out, replaced, rawSuppressed };
}

function guard(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res) as (b?: unknown) => Response;
  let done = false;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  (res as any).json = (body?: unknown): Response => {
    if (done) return originalJson(body);
    done = true;
    /* Only failure responses are inspected. A 2xx body from the sacred handler
       is passed through untouched, which is why a successful inbound dispatch is
       byte-identical to before this guard existed. */
    if (res.statusCode < 400) return originalJson(body);
    const result = sanitizeBridgeFailureBody(body);
    if (result.replaced.length > 0) {
      log.error(
        "[wave197BridgeInboundLeakGuard] suppressed internal detail from POST /api/bridge/inbound;",
        `fields=${result.replaced.join(",")};`,
        "raw:",
        result.rawSuppressed.join(" | "),
      );
    }
    return originalJson(result.body);
  };
  next();
}

/**
 * MOUNT ORDER IS THE WHOLE MECHANISM. Call this BEFORE
 * `registerBridgeRuntimeRoutes(app)` in `server/routes.ts`, in the same slot
 * `registerBridgeOutboundGuard(app)` already occupies.
 */
export function registerWave197BridgeInboundLeakGuard(app: Express): void {
  app.post("/api/bridge/inbound", guard);
}
