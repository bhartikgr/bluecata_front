/**
 * server/lib/emailSender.ts — v23.4.2 (hardened for Gmail STARTTLS)
 *
 * SMTP send helper with smart fallback. Modes (controlled by SMTP_MODE env var):
 *   smtp      (default) — send via nodemailer; falls back gracefully if SMTP_HOST unset
 *   dry_run   — log headers only, do not send; returns delivered:true (CI/staging)
 *   console   — log headers + body to stdout; returns delivered:true (local dev)
 *   disabled  — silent no-op; returns delivered:false (feature-flag off)
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
  delivered: boolean;
  mode: "smtp" | "dry_run" | "console" | "disabled";
  /** Human-readable hint for admin recovery (e.g. "copy invite link") */
  fallback?: string;
  error?: string;
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

  // ---- disabled ----
  if (mode === "disabled") {
    log.info(`[email:disabled] suppressed: to=${msg.to} subject="${msg.subject}"`);
    return { delivered: false, mode: "disabled" };
  }

  // ---- dry_run / console ----
  if (mode === "dry_run" || mode === "console") {
    log.info(`[email:${mode}] to=${msg.to} subject="${msg.subject}" category=${msg.category ?? "—"}`);
    if (mode === "console") {
      log.info(`[email:console] body:\n${msg.text}`);
    }
    _auditEmailSend(msg, { delivered: true, mode });
    return { delivered: true, mode };
  }

  // ---- smtp ----
  const t = getTransporter();
  if (!t) {
    const hint = "SMTP_HOST not set — admin can use 'Copy invite link' instead";
    log.warn(
      `[email] SMTP not configured (no SMTP_HOST); email not sent: subject="${msg.subject}" to=${msg.to}`,
    );
    const result: EmailSendResult = {
      delivered: false,
      mode: "smtp",
      fallback: hint,
      error: "smtp_not_configured",
    };
    _auditEmailSend(msg, result);
    return result;
  }

  // Normalize replyTo: an empty string trips some SMTP relays; treat "" as undefined.
  const replyToRaw = process.env.SMTP_REPLY_TO;
  const replyTo = replyToRaw && replyToRaw.trim().length > 0 ? replyToRaw : undefined;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM ?? "noreply@capavate.io",
      replyTo,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html ?? msg.text,
    });
    log.info(
      `[email] sent to=${msg.to} subject="${msg.subject}" category=${msg.category ?? "—"}`,
    );
    const result: EmailSendResult = { delivered: true, mode: "smtp" };
    _auditEmailSend(msg, result);
    return result;
  } catch (err) {
    const errMsg = (err as Error).message;
    log.warn(`[email] send FAILED to=${msg.to} subject="${msg.subject}": ${errMsg}`);
    const result: EmailSendResult = {
      delivered: false,
      mode: "smtp",
      fallback: errMsg,
      error: "smtp_send_failed",
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
        subject: msg.subject,
        category: msg.category,
        delivered: result.delivered,
        mode: result.mode,
        error: result.error ?? null,
      },
    );
  } catch {
    // Audit failure must never block email delivery
  }
}
