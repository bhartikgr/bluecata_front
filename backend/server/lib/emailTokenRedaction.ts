/**
 * server/lib/emailTokenRedaction.ts — WAVE 49 · C-1
 *
 * ============================================================
 * WHY THIS FILE EXISTS
 * ============================================================
 * Wave 47 (R19) routed every transactional send through the Outbox so that a
 * partner invite or a password reset would leave a durable, observable row.
 * That was the right goal. The implementation stored the RENDERED MESSAGE BODY
 * on the row, and `persistOutbox` serialises the whole row into
 * `kv_emailStoreOutbox.payload_json`. Those bodies carry the RAW single-use
 * `auth_redeem_tokens` value:
 *
 *   · `${APP_URL}/auth/redeem-partner-invite/<raw 32-byte hex>`   (14 days)
 *   · `${APP_URL}/auth/set-password?token=<raw 32-byte hex>`      (24 hours)
 *
 * `GET /api/admin/email/outbox` returned the raw rows, so any platform admin
 * could call the public `POST /api/auth/forgot` for any user, read that user's
 * reset link out of the Outbox, and take the account over — with the audit trail
 * then attributing everything to the victim. Anyone holding a copy of the
 * database file held live credentials. The approval code's own comment claims
 * the token is "sha-hashed at rest"; the Outbox contradicted that claim.
 *
 * ============================================================
 * THE RULE THIS MODULE ENFORCES
 * ============================================================
 * A raw token, or any URL carrying one, must NEVER be persisted and must NEVER
 * appear in an API response, a log line, an error string or an audit row.
 * Observability must not require storing the secret: the durable row still
 * records recipient, subject, template/category, status, attempt count, queued
 * and delivered times — everything R19 asked for — and the token is rendered at
 * DISPATCH time only, living in the caller's local `msg` variable and nowhere
 * else.
 *
 * ============================================================
 * BOTH POLES, DELIBERATELY
 * ============================================================
 * A redactor that rejects everything would pass a one-sided "no token leaked"
 * test and destroy every legitimate body, subject and link in the Outbox. So the
 * rules below are narrow and high-signal, and `emailTokenRedaction` is tested
 * from BOTH directions: token-shaped inputs must be caught, and benign inputs
 * (names, org names, prose, ordinary product URLs, short slugs, ISO timestamps,
 * money strings, outbox/token IDs) must come back BYTE-IDENTICAL.
 *
 * The four rules, in order of specificity:
 *   1. secret-bearing query parameters — `?token=`, `&reset_token=`, `&code=` …
 *   2. secret-bearing path segments — the segment after `/redeem…/`,
 *      `/set-password/`, `/accept-invite/`, `/invite/` …
 *   3. long hexadecimal runs — every token minted in this tree is
 *      `randomBytes(24|32).toString("hex")`, i.e. 48 or 64 hex characters. A run
 *      of >= 32 hex characters in an email body is a token or a hash; neither
 *      belongs in a durable row.
 *   4. long base64url runs — 32 raw bytes base64url-encode to 43 characters.
 *      Guarded at >= 43 so ordinary words, slugs and paths are untouched.
 *
 * Rule 3's floor of 32 is chosen against the SHORTEST token this tree mints
 * (`randomBytes(24)` = 48 hex, `partnerWorkspaceStore.ts:1418/1486`), leaving a
 * 16-character margin, while staying above anything a human writes by hand.
 */

/** The single marker written in place of removed token material. */
export const TOKEN_REDACTION_MARKER = "[REDACTED:TOKEN]";

/* Rule 1 — query-parameter names whose VALUE is secret material. Matched
 * case-insensitively, on `?name=` or `&name=`, with the value terminated by the
 * first `&`, whitespace, quote, angle bracket or closing bracket — i.e. exactly
 * the characters that end a URL inside HTML or plain text. */
const SECRET_QUERY_PARAM_RE =
  /([?&](?:token|tokens|auth_token|authtoken|access_token|refresh_token|reset_token|invite_token|invitetoken|redeem|redeem_token|code|secret|api_key|apikey|key|otp|nonce|signature|sig)=)([^&\s"'<>()\[\]{}]+)/gi;

/* Rule 2 — the path segment immediately after a redemption-style route. These
 * are the exact shapes this tree emits (`/auth/redeem-partner-invite/<raw>`,
 * `/auth/secure/redeem/<raw>`) plus the sibling shapes a future caller is most
 * likely to reach for. A minimum length of 16 keeps ordinary trailing segments
 * (`/invite/new`, `/redeem/help`) intact. */
const SECRET_PATH_SEGMENT_RE =
  /((?:^|\/)(?:redeem|redeem-partner-invite|redeem-invite|set-password|reset-password|accept-invite|invite|activate|confirm|verify)\/)([A-Za-z0-9_\-.~]{16,})/gi;

/* Rule 3 — a run of >= 32 hexadecimal characters. */
const LONG_HEX_RUN_RE = /(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g;

/* Rule 4 — a run of >= 43 base64url characters that is NOT purely alphabetic.
 * The "not purely alphabetic" condition is what keeps a long ordinary word or a
 * hyphenated English phrase out of scope while still catching a base64url
 * payload, which always mixes cases and digits in practice. */
const LONG_B64URL_RUN_RE = /(?<![0-9A-Za-z_-])[A-Za-z0-9_-]{43,}(?![0-9A-Za-z_-])/g;

function isPurelyAlphabetic(s: string): boolean {
  return /^[A-Za-z-]+$/.test(s);
}

/**
 * Remove every raw-token-shaped substring from `text`, leaving everything else
 * byte-identical. `null`/`undefined` pass through unchanged so a nullable column
 * stays nullable (a redactor that turned `null` into `""` would quietly change
 * the meaning of "no error recorded").
 */
export function redactTokenMaterial<T extends string | null | undefined>(text: T): T {
  if (text === null || text === undefined) return text;
  let out = String(text);
  /* IDEMPOTENCE IS A CORRECTNESS REQUIREMENT, NOT A NICETY.
   * The redactor runs at several boundaries (enqueue, persist, every read
   * projection), so an already-scrubbed string passes through it repeatedly, and
   * `containsTokenMaterial` is defined as "redacting changes the string". If the
   * marker itself were re-matched, `containsTokenMaterial` would answer TRUE for
   * a perfectly clean row and the C-1 assertion would fire on its own output —
   * a false positive that would make the gate meaningless. Every rule therefore
   * leaves `[REDACTED:TOKEN]` alone. */
  const alreadyRedacted = (v: string): boolean => v.startsWith(TOKEN_REDACTION_MARKER);
  out = out.replace(SECRET_QUERY_PARAM_RE, (m, prefix: string, value: string) =>
    alreadyRedacted(value) ? m : `${prefix}${TOKEN_REDACTION_MARKER}`,
  );
  out = out.replace(SECRET_PATH_SEGMENT_RE, (m, prefix: string, value: string) =>
    alreadyRedacted(value) ? m : `${prefix}${TOKEN_REDACTION_MARKER}`,
  );
  out = out.replace(LONG_HEX_RUN_RE, TOKEN_REDACTION_MARKER);
  out = out.replace(LONG_B64URL_RUN_RE, (m: string) =>
    isPurelyAlphabetic(m) ? m : TOKEN_REDACTION_MARKER,
  );
  return out as T;
}

/** True when `text` holds something this module would remove. */
export function containsTokenMaterial(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  const s = String(text);
  return redactTokenMaterial(s) !== s;
}

/**
 * The subset of an outbox row this module reads. Declared structurally rather
 * than importing `OutboxEmail` so that `emailStore` can depend on this module
 * without this module depending back on `emailStore` (that cycle is what makes
 * the store's demo-seed side effect leak into every importer).
 */
export interface RedactableOutboxRow {
  subject?: string;
  bodyHtmlRendered?: string;
  bodyText?: string | null;
  error?: string | null;
  variables?: Record<string, string>;
  /** Appended at the END of the row shape; set only when something was removed. */
  bodyRedacted?: boolean;
}

/**
 * Return a copy of `row` with every free-text and variable field scrubbed of
 * token material, and `bodyRedacted: true` when anything was actually removed.
 *
 * Applied at BOTH boundaries that matter:
 *   · `persistOutbox` — so `kv_emailStoreOutbox.payload_json` can never hold a
 *     live credential, on any enqueue path, including ones added later;
 *   · the admin Outbox responses — so the API cannot hand one out either.
 *
 * `bodyRedacted` is what makes the consequence honest rather than silent: a row
 * whose body was scrubbed cannot be re-sent from the row, so `tickQueue` refuses
 * to send it and `retryOutboxItem` refuses to queue it, with a typed reason,
 * instead of mailing a recipient a dead link.
 */
export function redactOutboxRow<T extends RedactableOutboxRow>(row: T): T {
  let changed = false;
  const next: T = { ...row };

  const scrub = <V extends string | null | undefined>(v: V): V => {
    const r = redactTokenMaterial(v);
    if (r !== v) changed = true;
    return r;
  };

  if (typeof next.subject === "string") next.subject = scrub(next.subject);
  if (typeof next.bodyHtmlRendered === "string") next.bodyHtmlRendered = scrub(next.bodyHtmlRendered);
  if (next.bodyText !== undefined) next.bodyText = scrub(next.bodyText);
  if (next.error !== undefined) next.error = scrub(next.error);

  if (next.variables && typeof next.variables === "object") {
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(next.variables)) {
      vars[k] = typeof v === "string" ? scrub(v) : v;
    }
    next.variables = vars;
  }

  if (changed) next.bodyRedacted = true;
  return next;
}

/**
 * The persisted-row assertion, exported so tests and any future writer can use
 * the SAME predicate the code enforces. Returns the list of field paths that
 * still hold token material — empty means clean.
 */
export function findTokenMaterialFields(obj: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (typeof obj === "string") {
    if (containsTokenMaterial(obj)) hits.push(path);
    return hits;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) hits.push(...findTokenMaterialFields(obj[i], `${path}[${i}]`));
    return hits;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      hits.push(...findTokenMaterialFields(v, `${path}.${k}`));
    }
  }
  return hits;
}
