/**
 * server/lib/emailSender.ts — v23.4.2 (hardened for Gmail STARTTLS)
 *
 * SMTP send helper with smart fallback. Modes (controlled by SMTP_MODE env var):
 *   smtp      (default) — send via nodemailer; falls back gracefully if SMTP_HOST unset
 *   dry_run   — log headers only, do not send; returns transportAccepted:true (CI/staging)
 *   console   — log headers + body to stdout; returns transportAccepted:true (local dev)
 *   disabled  — silent no-op; returns transportAccepted:false (feature-flag off)
 *
 * Transport policy:
 *   - SMTP_SECURE=true  → implicit TLS from socket open (port 465 idiomatic)
 *   - SMTP_SECURE=false → opportunistic STARTTLS; we set requireTLS=true so the
 *     handshake REFUSES to deliver mail in cleartext. This is the v23.4.2 fix:
 *     Gmail and most modern providers require STARTTLS on port 587, and the
 *     v23.4.1 transporter let nodemailer fall back to plaintext silently if
 *     STARTTLS negotiation failed. That manifested as "email never arrived"
 *     with no obvious error on the live server. requireTLS=true makes the
 *     failure loud.
 *   - Connect/greeting/socket timeouts are explicit so a misconfigured SMTP
 *     host does not hang the request thread.
 *
 * Smart fallback policy (SMTP mode only):
 *   - SMTP_HOST not set → warn + return fallback hint for admin "copy invite link"
 *   - SMTP send throws  → warn + return error details; caller decides whether to surface
 *
 * Security contract:
 *   - This module NEVER returns inviteLink or token in a public API response.
 *     Callers (consortiumApplyStore) are responsible for that gating.
 *   - appendAdminAudit is called for every consortium_invite send attempt so
 *     admins have a full trail.
 *
 * References:
 *   - adminUsersRoutes.ts uses rawDb() + auth_redeem_tokens for the invite pattern
 *   - secureAuthRoutes.ts:139 is the canonical /api/auth/secure/redeem consumer
 *   - nodemailer is already listed in package.json dependencies (no new dep)
 */

import nodemailer from "nodemailer";
import { log } from "./logger";
import { appendAdminAudit } from "../adminPlatformStore";
/* WAVE 49 · C-1 — Review C named the Outbox. The token can reach three other
 * DURABLE sinks from this file, and all three are closed here:
 *   · the `console`-mode log line, which prints the ENTIRE body (raw reset link
 *     included) to stdout and therefore to the log file / log aggregator;
 *   · the `audit_log` row `_auditEmailSend` appends, via `subject`, `error` and
 *     `fallback` — and `audit_log` is APPEND-ONLY and hash-chained, so a token
 *     landing there is unremovable;
 *   · the transport error string that `outboxRecord` persists, in case a relay
 *     quotes the message back.
 * `redactSecrets` only ever covered `SMTP_PASS`; it cannot see a token. */
import { redactTokenMaterial } from "./emailTokenRedaction";

/* ============================================================
 * Public types
 * ============================================================ */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Semantic category for audit trail, e.g. "consortium_invite", "password_reset" */
  category?: string;
  /** Opaque reference ID (applicationId, userId) attached to audit entry */
  refId?: string;
}

export interface EmailSendResult {
  /* "THE TRANSPORT ACCEPTED THE HANDOFF" — and nothing more than that.
   *
   * WAVE 48 · ITEM 4 — RENAMED FROM `delivered`. This is a rename FOR
   * TRUTHFULNESS, not a behaviour change: the value is computed exactly as
   * before, on every path, and `wave48_transport_accepted_rename.test.ts` pins
   * that equivalence mode by mode.
   *
   * WAVE 47 · R19 had disclosed the trap and left the name alone: `delivered`
   * has NEVER meant "the mailbox received it" — it is `true` for `dry_run` and
   * `console`, where the message is discarded or printed, and three call sites
   * in `consortiumApplyStore` were reporting it to callers as `emailSent`. A
   * field whose name asserts something the process cannot observe is a lie an
   * operator will eventually act on, so Wave 48 renames it to what it measures.
   * `status` below remains the authoritative outcome, and the DURABLE OUTBOX ROW
   * still agrees with `status`, never with this boolean. */
  transportAccepted: boolean;
  mode: "smtp" | "dry_run" | "console" | "disabled";
  /** Human-readable hint for admin recovery (e.g. "copy invite link") */
  fallback?: string;
  error?: string;
  /* WAVE 47 · R19 — appended. The honest outbox status of this send:
   *   `sent`    — the transport accepted it; delivery is NOT confirmed;
   *   `failed`  — the attempt did not complete (no host, timeout, auth, refused);
   *   `bounced` — the relay/recipient permanently REJECTED it.
   * Never `delivered`: nothing in this process can observe a delivery. */
  status?: "queued" | "sent" | "failed" | "bounced";
  /** WAVE 47 · R19 — id of the durable outbox row for this send. */
  outboxId?: string;
}

/* ============================================================
 * WAVE 47 · R19 — injectable transport, so tests can prove BOTH poles
 * without opening a socket or sending real mail.
 * ============================================================ */
export interface InjectedEmailTransport {
  send(msg: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    from?: string;
    replyTo?: string;
  }): Promise<{ accepted: boolean; error?: string; permanent?: boolean }>;
}

let _injectedTransport: InjectedEmailTransport | null = null;

/**
 * TEST-ONLY. Installs a fake transport that takes precedence over nodemailer,
 * or clears it with `null`. This exists so the WAVE 47 suite can assert an
 * accepted send AND a rejected send without ever touching smtp.gmail.com.
 */
export function __setEmailTransportForTests(t: InjectedEmailTransport | null): void {
  _injectedTransport = t;
}

/* ============================================================
 * WAVE 47 · R19 — SECRET REDACTION.
 *
 * SMTP servers quote credentials back at you: a 535 auth failure can contain
 * the password, and nodemailer error strings can carry the whole config. Those
 * strings are now PERSISTED (outbox row) and RETURNED (admin response), so they
 * are scrubbed first. `SMTP_PASS` is matched both raw and whitespace-stripped,
 * because getTransporter() strips whitespace before use (Gmail App Passwords
 * are pasted in four groups) — so the value that reaches the server differs
 * from the value in the environment, and both must be caught.
 * ============================================================ */
export function redactSecrets(text: string | null | undefined): string {
  let out = String(text ?? "");
  const raw = process.env.SMTP_PASS ?? "";
  const candidates = [raw, raw.replace(/\s+/g, "")].filter((c) => c.length >= 4);
  for (const c of Array.from(new Set(candidates))) {
    out = out.split(c).join("[REDACTED]");
  }
  return out;
}

/**
 * WAVE 47 · R19 — is this failure the recipient's fault (permanent) or the
 * network's (transient)? A 5xx / "mailbox unavailable" is a bounce; a timeout or
 * refused connection is a `failed` attempt that says nothing about the address.
 * Guessing "bounced" for a network blip would make an admin delete a good
 * address, so the default is the non-accusatory one.
 */
function isPermanentSendFailure(errMsg: string): boolean {
  return /(^|\D)5[0-9]{2}(\D|$)|5\.\d\.\d|mailbox unavailable|user unknown|no such user|does not exist|recipient rejected|address rejected/i.test(
    errMsg,
  );
}

/* ============================================================
 * WAVE 47 · R19 — the outbox bridge.
 *
 * `server/emailStore.ts` is imported LAZILY, for two reasons: it runs a
 * top-level demo seed on import, and a static import here would drag that into
 * every module that merely wants to send an email. An outbox failure must NEVER
 * block or fail a send — the email is the user-visible thing — so both helpers
 * swallow their own errors and say so in the log.
 * ============================================================ */
async function outboxEnqueue(msg: EmailMessage): Promise<string | null> {
  try {
    const store = await import("../emailStore");
    const row = store.enqueueTransactional({
      to: msg.to,
      subject: msg.subject,
      bodyHtml: msg.html ?? msg.text,
      bodyText: msg.text,
      category: msg.category,
      refId: msg.refId,
    });
    return row.id;
  } catch (err) {
    log.warn(`[email] outbox enqueue failed (send continues): ${(err as Error).message}`);
    return null;
  }
}

async function outboxRecord(
  outboxId: string | null,
  outcome: { accepted: boolean; mode: string; error?: string | null; permanent?: boolean },
): Promise<void> {
  if (!outboxId) return;
  try {
    const store = await import("../emailStore");
    store.recordTransactionalOutcome(outboxId, {
      accepted: outcome.accepted,
      mode: outcome.mode,
      // WAVE 49 · C-1 — SMTP_PASS *and* token material.
      error: outcome.error ? redactTokenMaterial(redactSecrets(outcome.error)) : null,
      permanent: outcome.permanent,
    });
  } catch (err) {
    log.warn(`[email] outbox record failed: ${(err as Error).message}`);
  }
}

/* ============================================================
 * Transporter — lazy, cached, disposed when SMTP_HOST changes
 * ============================================================ */
let _cachedTransporter: nodemailer.Transporter | null = null;
let _cachedHost: string | undefined = undefined;

function getTransporter(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  // Invalidate cache if SMTP_HOST changed at runtime (e.g. test teardown)
  if (_cachedHost !== host) {
    _cachedTransporter = null;
    _cachedHost = host;
  }
  if (_cachedTransporter) return _cachedTransporter;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true";
  // v23.4.2: when secure=false (STARTTLS path, typically port 587),
  // require TLS upgrade so we never silently fall back to cleartext auth.
  // This is the difference between "works on Gmail" and "silently fails on Gmail".
  // Strip whitespace from password — Gmail App Passwords are commonly pasted as
  // four space-separated groups ("abcd efgh ijkl mnop") and nodemailer treats
  // the spaces as literal characters, causing 535-5.7.8 auth failure.
  const rawPass = process.env.SMTP_PASS ?? "";
  const normalizedPass = rawPass.replace(/\s+/g, "");
  _cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure, // refuse plaintext when on STARTTLS path
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: normalizedPass }
      : undefined,
    // Explicit timeouts so a wrong host doesn't hang the event loop.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return _cachedTransporter;
}

/* ============================================================
 * verifyTransport — SMTP self-test (admin diagnostic endpoint)
 * ============================================================
 * Returns the exact result of nodemailer's verify() probe. Used by the
 * admin /api/admin/email/test endpoint so operators can validate SMTP
 * BEFORE relying on it for partner invites.
 */
export interface VerifyTransportResult {
  ok: boolean;
  mode: "smtp" | "dry_run" | "console" | "disabled" | "not_configured";
  host?: string;
  port?: number;
  secure?: boolean;
  error?: string;
  hint?: string;
}

export async function verifyTransport(): Promise<VerifyTransportResult> {
  const mode = (process.env.SMTP_MODE ?? "smtp") as VerifyTransportResult["mode"];
  if (mode === "disabled") {
    return { ok: false, mode: "disabled", hint: "SMTP_MODE=disabled; set to 'smtp' to enable" };
  }
  if (mode === "dry_run" || mode === "console") {
    return { ok: true, mode };
  }
  const host = process.env.SMTP_HOST;
  if (!host) {
    return {
      ok: false,
      mode: "not_configured",
      hint: "SMTP_HOST not set in environment",
    };
  }
  const t = getTransporter();
  if (!t) {
    return { ok: false, mode: "smtp", host, hint: "Transporter could not be initialized" };
  }
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true";
  try {
    await t.verify();
    return { ok: true, mode: "smtp", host, port, secure };
  } catch (err) {
    const errMsg = (err as Error).message;
    // Provide actionable hints for the three most common Gmail failure modes.
    let hint: string | undefined;
    if (/535-5\.7\.8|Username and Password not accepted/i.test(errMsg)) {
      hint =
        "Auth rejected. For Gmail: SMTP_PASS must be a 16-char App Password (NOT your regular Gmail password). Generate at https://myaccount.google.com/apppasswords. Spaces in the App Password are auto-stripped.";
    } else if (/wrong version|TLS|SSL/i.test(errMsg)) {
      hint =
        "TLS/port mismatch. For Gmail: use port=465 + SMTP_SECURE=true, OR port=587 + SMTP_SECURE=false. The two are mutually exclusive.";
    } else if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(errMsg)) {
      hint =
        "Network/DNS issue reaching SMTP host. Check firewall rules and that outbound port 465/587 is open from this server.";
    }
    return { ok: false, mode: "smtp", host, port, secure, error: errMsg, hint };
  }
}

/** Test helper: reset cached transporter (so test teardown works cleanly). */
export function _resetTransporterCacheForTests(): void {
  _cachedTransporter = null;
  _cachedHost = undefined;
}

/* ============================================================
 * sendEmail — primary entry point
 * ============================================================ */
export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const mode = (process.env.SMTP_MODE ?? "smtp") as
    | "smtp"
    | "dry_run"
    | "console"
    | "disabled";

  /* ---- disabled ----
   * WAVE 47 · R19: the suppression IS recorded (an admin must be able to see
   * that the invite did not go out and why), but the RETURN VALUE is left
   * byte-identical to the legacy object. `emailSender.test.ts` asserts
   * `toEqual({ transportAccepted: false, mode: "disabled" })`, an exact-shape check, and
   * a test that pins the whole result of a feature-flag-off path is a test worth
   * keeping — adding fields to satisfy tidiness would have meant weakening it. */
  if (mode === "disabled") {
    // WAVE 49 · C-1 — same reason as every other log line touching a subject.
    log.info(`[email:disabled] suppressed: to=${msg.to} subject="${redactTokenMaterial(msg.subject)}"`);
    const suppressedId = await outboxEnqueue(msg);
    await outboxRecord(suppressedId, {
      accepted: false,
      mode: "disabled",
      error: "suppressed:smtp_mode_disabled",
      permanent: false,
    });
    return { transportAccepted: false, mode: "disabled" };
  }

  /* Every remaining path gets a durable `queued` row BEFORE the transport is
   * touched. If the process dies mid-send, the row survives as `queued` with 0
   * attempts and the worker can pick it up — which is the whole difference from
   * the pre-WAVE-47 behaviour, where a send left nothing behind at all. */
  const outboxId = await outboxEnqueue(msg);

  // ---- dry_run / console ----
  if (mode === "dry_run" || mode === "console") {
    // WAVE 49 · C-1 — same reason as every other log line touching a subject.
    log.info(`[email:${mode}] to=${msg.to} subject="${redactTokenMaterial(msg.subject)}" category=${msg.category ?? "—"}`);
    if (mode === "console") {
      /* WAVE 49 · C-1 — this line printed the raw body, so in `console` mode a
       * password-reset link went to stdout in full. Local-dev convenience is not
       * worth a live credential in a log file that gets pasted into tickets. */
      log.info(`[email:console] body:\n${redactTokenMaterial(msg.text)}`);
    }
    /* Recorded as `sent`, never `delivered`: in these modes the message was
     * printed or discarded, so the row carries `transportMode` to say exactly
     * that instead of implying a mailbox received it. */
    await outboxRecord(outboxId, { accepted: true, mode });
    const dryResult: EmailSendResult = {
      transportAccepted: true,
      mode,
      status: "sent",
      outboxId: outboxId ?? undefined,
    };
    _auditEmailSend(msg, dryResult);
    return dryResult;
  }

  // ---- smtp ----
  /* WAVE 47 · R19 — an injected transport takes precedence over nodemailer so
   * the test suite can exercise both poles without a socket. It is only ever
   * non-null when a test installed it. */
  const injected = _injectedTransport;
  const t = injected ? null : getTransporter();
  if (!injected && !t) {
    const hint = "SMTP_HOST not set — admin can use 'Copy invite link' instead";
    // WAVE 49 · C-1 — same reason as every other log line touching a subject.
    log.warn(
      `[email] SMTP not configured (no SMTP_HOST); email not sent: subject="${redactTokenMaterial(msg.subject)}" to=${msg.to}`,
    );
    await outboxRecord(outboxId, {
      accepted: false,
      mode: "smtp",
      error: "smtp_not_configured",
      permanent: false,
    });
    const result: EmailSendResult = {
      transportAccepted: false,
      mode: "smtp",
      fallback: hint,
      error: "smtp_not_configured",
      status: "failed",
      outboxId: outboxId ?? undefined,
    };
    _auditEmailSend(msg, result);
    return result;
  }

  // Normalize replyTo: an empty string trips some SMTP relays; treat "" as undefined.
  const replyToRaw = process.env.SMTP_REPLY_TO;
  const replyTo = replyToRaw && replyToRaw.trim().length > 0 ? replyToRaw : undefined;
  const from = process.env.SMTP_FROM ?? "noreply@capavate.io";
  try {
    let permanent = false;
    if (injected) {
      const out = await injected.send({
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? msg.text,
        from,
        replyTo,
      });
      if (!out.accepted) {
        permanent = out.permanent === true;
        /* NOT swallowed and NOT thrown into the void: turned into the same
         * refusal shape a real transport failure produces below. */
        throw new Error(out.error ?? "send_failed");
      }
    } else {
      await t!.sendMail({
        from,
        replyTo,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? msg.text,
      });
    }
    // WAVE 49 · C-1 — a caller is free to put a link in the subject; the log file is durable.
    log.info(
      `[email] sent to=${msg.to} subject="${redactTokenMaterial(msg.subject)}" category=${msg.category ?? "—"}`,
    );
    await outboxRecord(outboxId, { accepted: true, mode: "smtp" });
    /* `transportAccepted: true` = the relay ACCEPTED it — the same value this
     * path always returned, under the honest name (WAVE 48 · ITEM 4).
     * `status: "sent"` is the authoritative outcome, and the outbox row agrees
     * with `status`, not with this boolean. */
    const result: EmailSendResult = {
      transportAccepted: true,
      mode: "smtp",
      status: "sent",
      outboxId: outboxId ?? undefined,
    };
    _auditEmailSend(msg, result);
    return result;
  } catch (err) {
    /* WAVE 49 · C-1 — redacted HERE, at the single point where the transport's
     * message enters the process, because this one string then fans out to FOUR
     * places, three of which are durable or caller-visible:
     *   · the `log.warn` below,
     *   · `outboxRecord` → `kv_emailStoreOutbox.payload_json`,
     *   · the returned `fallback`, which callers put into API responses
     *     (`inviteEmailStatus` in `consortiumApplyStore`),
     *   · `_auditEmailSend` → the append-only `audit_log`.
     * My own C-1 test caught the `fallback` leak: a relay that quotes the
     * rejected body back — "550 rejected: body contained <raw token>" — handed
     * the live reset link straight to the API caller. Redacting at each sink
     * would have been four chances to miss one; this is one. */
    const errMsg = redactTokenMaterial(redactSecrets((err as Error).message));
    const permanent = isPermanentSendFailure(errMsg);
    log.warn(`[email] send FAILED to=${msg.to} subject="${redactTokenMaterial(msg.subject)}": ${errMsg}`);
    await outboxRecord(outboxId, {
      accepted: false,
      mode: "smtp",
      error: errMsg,
      permanent,
    });
    const result: EmailSendResult = {
      transportAccepted: false,
      mode: "smtp",
      fallback: errMsg,
      error: "smtp_send_failed",
      status: permanent ? "bounced" : "failed",
      outboxId: outboxId ?? undefined,
    };
    _auditEmailSend(msg, result);
    return result;
  }
}

/* ============================================================
 * Audit trail helper (fire-and-forget; never throws)
 * ============================================================ */
function _auditEmailSend(msg: EmailMessage, result: EmailSendResult): void {
  try {
    appendAdminAudit(
      "u_system_email",
      msg.refId ? `${msg.category ?? "email"}:${msg.refId}` : (msg.category ?? "email"),
      "email.send",
      {
        to: msg.to,
        // WAVE 49 · C-1 — `audit_log` is append-only and hash-chained; a token
        // written here could never be removed without breaking the chain.
        subject: redactTokenMaterial(msg.subject),
        category: msg.category,
        transportAccepted: result.transportAccepted,
        // WAVE 47 · R19 — the honest status, alongside the legacy boolean.
        status: result.status ?? null,
        outboxId: result.outboxId ?? null,
        mode: result.mode,
        /* WAVE 47 · R19 — the audit row is durable too, so it is redacted with
         * the same helper. `fallback` carries the raw transport message, which
         * is precisely where a quoted credential would appear. */
        error: result.error ? redactTokenMaterial(redactSecrets(result.error)) : null,
        fallback: result.fallback ? redactTokenMaterial(redactSecrets(result.fallback)) : null,
      },
    );
  } catch {
    // Audit failure must never block email delivery
  }
}
