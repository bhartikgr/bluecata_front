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
  return raw || fallback;
}
