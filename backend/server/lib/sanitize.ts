/**
 * Sprint 17 D2 — sensitive-data redaction for logs / audit trail.
 *
 * Never log: full passwords, JWTs, refresh tokens, KYC documents, full
 * SSN/EIN/PAN. Redacted to `***last4` for fixed-width numeric IDs and to
 * `[redacted]` for tokens / passwords.
 *
 * Use:  log("auth.login", redact({ email, password, jwt }))
 */
const SENSITIVE_KEYS = new Set([
  "password", "pwd", "newPassword", "passwordHash", "password_hash",
  "token", "jwt", "accessToken", "refreshToken", "refresh_token",
  "csrfToken", "csrf_token", "_csrf", "secret", "apiKey", "api_key",
  "ssn", "ein", "tin", "pan", "kycDoc", "kyc_doc",
  "Authorization", "authorization", "Cookie", "cookie",
]);

function redactValue(key: string, value: unknown): unknown {
  if (value == null) return value;
  if (SENSITIVE_KEYS.has(key)) {
    if (typeof value === "string" && value.length > 4 && /^\d+$/.test(value)) {
      return `***${value.slice(-4)}`;
    }
    return "[redacted]";
  }
  // Heuristic: long hex strings (likely tokens) get clipped
  if (typeof value === "string" && /^[a-f0-9]{32,}$/i.test(value)) {
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
  }
  return value;
}

export function redact<T>(obj: T): T {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(v => redact(v)) as unknown as T;
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "object" && v !== null) {
        out[k] = SENSITIVE_KEYS.has(k) ? "[redacted]" : redact(v);
      } else {
        out[k] = redactValue(k, v);
      }
    }
    return out as T;
  }
  return obj;
}

/** Drop-in replacement for console.log on sensitive paths. */
export function safeLog(label: string, payload: unknown): void {
  // eslint-disable-next-line no-console
  console.log(label, JSON.stringify(redact(payload)));
}

/*
 * v25.32 burndown — item 33: scrub raw err.message from client responses in
 * production. Several routes echoed `err?.message` straight back to the client
 * (e.g. /api/billing/plan 500), which can leak DB driver text, file paths, SQL
 * fragments, or stack detail to end users. This helper returns the raw message
 * in non-production (so local/dev debugging is unchanged) and a fixed generic
 * string in production. Always pair with a server-side log.error(...) that
 * keeps the full error for operators. Source: server/routes.ts billing/plan
 * 500 handler. Additive: a new export; existing callers are unaffected.
 */
export function sanitizeErrorMessage(
  err: unknown,
  fallback = "An unexpected error occurred. Please try again.",
): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (process.env.NODE_ENV === "production") return fallback;
  /* WAVE 197 / R169 — the owner's instruction is "I don't want any exposure of
     our internal process", and that is not conditional on an environment
     variable. The production branch above is kept exactly as it was; this step
     is additional and env-independent. If the raw text carries an unmistakable
     internal artefact — a stack frame, a filesystem path, a SQL clause, a
     driver code, a source-line reference, an exception class prefix or a
     machine token — the authored fallback is returned no matter what NODE_ENV
     says. Ordinary prose still passes through in dev exactly as before, so
     local debugging of authored messages is unchanged, and this step can only
     ever WITHHOLD text: it can never emit text that was not already going out.
     Pair every call with a log.error(...) carrying the raw message — the detail
     moves to the operator's log, it is not destroyed. */
  if (carriesInternalDetail(raw)) return fallback;
  return raw || fallback;
}

/*
 * WAVE 197 / R169 — what counts as "our internal process" in a response body.
 *
 * Deliberately the same families the client-side backstop in
 * `client/src/lib/failureMessage.ts` (wave 196) recognises, so the two ends of
 * the wire agree on what must never be rendered. Each pattern matches an
 * artefact a user can do nothing with and an attacker can learn from:
 *
 *   stack frame          at Object.<anonymous> (/app/server/x.ts:12:3)
 *   filesystem path      /home/..., /var/..., /app/..., C:\...
 *   source reference     sprint20Wave2Routes.ts:244
 *   SQL clause           SELECT ... FROM, INSERT INTO, UPDATE ... SET, DELETE FROM
 *   schema complaint     no such table: collective_kyc_blobs, no such column
 *   driver code          SQLITE_ERROR, SQLITE_CONSTRAINT
 *   constraint text      UNIQUE constraint failed: users.email
 *   parser text          syntax error near "..."
 *   exception prefix     TypeError: ...
 *   machine token        PERSIST_FAILED
 *
 * Exported so a test can assert the families directly rather than only
 * observing them through a route.
 */
export const INTERNAL_DETAIL_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bat\s+\S+\s*\([^)]*:\d+:\d+\)/,
  /\bat\s+[^\s(]+:\d+:\d+/,
  /(^|[\s("'`])\/(home|var|usr|etc|opt|root|tmp|app|srv|proc|Users)\//,
  /[A-Za-z]:\\/,
  /\.(ts|tsx|js|mjs|cjs|jsx):\d+/,
  /\bSQLITE[_A-Z]*\b/,
  /\bno such (table|column|module|function|index)\b/i,
  /* WAVE 197 — FOUND BY THE TEST, NOT BY INSPECTION. The write-path failure this
     wave was commissioned to close produces `table collective_kyc_blobs has no
     column named payload`: a bare table name and a bare column name with NO sql
     verb and NO "no such" prefix, so the first draft of this list let it through.
     `server/__tests__/w197_item_a_member_leak.test.ts` caught it. Recorded here
     rather than quietly fixed, because "the reviewer read the list and it looked
     complete" is exactly the reasoning that produced the gap. */
  /\bhas no column named\b/i,
  /* Module-resolution and parse failures are never anything but internal. These
     reach a response body whenever a lazily-`require`d module fails to load
     inside a request handler, which is how these two KYC routes behave under a
     non-CommonJS loader. */
  /\bUnexpected token\b/,
  /\bCannot find module\b/i,
  /\brequire is not defined\b/i,
  /\bCannot read propert(y|ies) of\b/i,
  /\bconstraint failed\b/i,
  /\b(UNIQUE|FOREIGN KEY|NOT NULL|CHECK) constraint\b/i,
  /\bsyntax error\b/i,
  /\bSELECT\b[\s\S]*\bFROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b[\s\S]*\bSET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bCREATE\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bDROP\s+(TABLE|INDEX|VIEW)\b/i,
  /\bPRAGMA\b/i,
  /^\s*(Error|TypeError|RangeError|SyntaxError|ReferenceError|EvalError|URIError|AssertionError|AggregateError)\s*:/,
  /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9]*(_[A-Z0-9]+)+([^A-Za-z0-9_]|$)/,
  /\bECONN(REFUSED|RESET|ABORTED)\b|\bENOENT\b|\bEACCES\b|\bEPIPE\b|\bETIMEDOUT\b/,
  /\b(node_modules|better-sqlite3|drizzle)\b/i,
  /* ── FOUND BY THE ADVERSARIAL INJECTION PHASE, NOT BY THE MUTATION PHASE ────
     `build_log/wave197/W197_DISARM.py` phase 2 pushed six hand-built payloads at
     this function. Four were held. TWO GOT THROUGH, and R169 item 7 names both of
     them by name — "no response body contains a SQL fragment, TABLE NAME, file
     path, stack frame or INTERNAL ID":

       · `collective_kyc_blobs` alone. Every SQL pattern above needs a keyword,
         and every schema pattern needs a complaint phrase. A table name on its
         own has neither. This is not hypothetical: a driver that reports only the
         offending relation, or a handler that interpolates a table name into its
         own message, produces exactly this.

       · `req_9f2a4c8e-0000-4000-8000-abcdef123456` alone. The ALL-CAPS machine
         token pattern above is case-sensitive by design, so a lowercase
         correlation id sailed past it.

     THE TWO PATTERNS BELOW, AND THEIR COST. The first is a LOWERCASE snake_case
     token; the second is a bare UUID. Both are broad, and being broad is the
     intended trade: this function only ever WITHHOLDS text in favour of an
     authored sentence, and the fallback is always a real sentence, so the cost of
     a false positive is one look at the server log (which now carries the full
     original — see the WRITE site in `server/sprint20Wave2Routes.ts`).

     THE BLAST RADIUS, MEASURED RATHER THAN GUESSED. An earlier draft of this
     comment claimed these two patterns change behaviour for all 28 callers of
     `sanitizeErrorMessage`. THAT WAS WRONG, and the correction matters more than
     the claim did: the `NODE_ENV === "production"` branch ABOVE returns the
     fallback unconditionally, before this list is ever consulted. So in
     production these patterns change nothing anywhere. They change dev and test
     only — where a genuine refusal containing a lowercase snake_case word is now
     replaced by its call site's fallback instead of being shown to a developer.
     That is the safe direction and the cost is one look at the server log.

     WHERE THEY DO BITE IN PRODUCTION is the ONE caller that consults
     `carriesInternalDetail` DIRECTLY rather than through `sanitizeErrorMessage`:
     `server/lib/wave197BridgeInboundLeakGuard.ts`. That file needed an explicit
     exemption for its machine `error` field, because a snake_case pattern applied
     to a field of machine codes flattens every distinct code into one. See
     `isBareMachineCode` there. Any FUTURE direct caller of this function must make
     the same human-text / machine-field distinction; applying it to a whole
     serialised response body will flag legitimate codes. */
  /(^|[^A-Za-z0-9_])[a-z][a-z0-9]*(_[a-z0-9]+)+([^A-Za-z0-9_]|$)/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
]);

/**
 * True when `text` carries something the platform must not put in a response
 * body. Conservative by construction: it only ever causes text to be withheld,
 * so a false positive costs a developer one look at the server log, while a
 * false negative is an exposure of internal process.
 */
export function carriesInternalDetail(text: unknown): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  for (let i = 0; i < INTERNAL_DETAIL_PATTERNS.length; i += 1) {
    if (INTERNAL_DETAIL_PATTERNS[i].test(text)) return true;
  }
  return false;
}
