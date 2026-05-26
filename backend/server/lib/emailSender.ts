/**
 * server/lib/emailSender.ts — v23.4.1 hotfix Task A
 *
 * SMTP send helper with smart fallback. Modes (controlled by SMTP_MODE env var):
 *   smtp      (default) — send via nodemailer; falls back gracefully if SMTP_HOST unset
 *   dry_run   — log headers only, do not send; returns delivered:true (CI/staging)
 *   console   — log headers + body to stdout; returns delivered:true (local dev)
 *   disabled  — silent no-op; returns delivered:false (feature-flag off)
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
  _cachedTransporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });
  return _cachedTransporter;
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

  try {
    await t.sendMail({
      from: process.env.SMTP_FROM ?? "noreply@capavate.io",
      replyTo: process.env.SMTP_REPLY_TO,
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
