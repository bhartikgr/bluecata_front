/**
 * Sprint 28 Wave 7 — Production SMTP Transport
 *
 * Safety modes:
 *   - "smtp"      : real nodemailer transport (production)
 *   - "console"   : logs to stdout, returns synthetic messageId (sandbox/dev default)
 *   - "dry_run"   : no-op success — useful for unit tests
 *
 * All credentials come ONLY from env vars — never from API request bodies.
 * pass is masked in all API responses.
 * Rate limit: 30 messages/sec via token bucket.
 * Idempotency: last 1000 idempotency keys are cached.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { randomBytes } from "node:crypto";
import { log } from "./lib/logger";

export type TransportMode = "smtp" | "console" | "dry_run";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;             // always "***" in API responses
  fromAddress: string;
  replyTo: string | null;
  mode: TransportMode;
}

export interface SendMailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface SendMailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/* ============================================================
 * Config from env vars
 * ============================================================ */

function readMode(): TransportMode {
  const raw = (process.env.SMTP_MODE ?? "").toLowerCase();
  if (raw === "smtp" || raw === "console" || raw === "dry_run") return raw;
  return "console"; // safe default
}

let _config: SmtpConfig | null = null;

function buildConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST ?? "";
  const rawMode = readMode();

  // If SMTP_HOST missing and mode is smtp, fall back to console with a warning.
  let mode = rawMode;
  if (!host && mode === "smtp") {
    log.warn("[emailTransport] SMTP_HOST is not set — falling back to 'console' mode.");
    mode = "console";
  }

  return {
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true",
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",       // real value stored internally
    fromAddress: process.env.SMTP_FROM ?? "Capavate <no-reply@capavate.com>",
    replyTo: process.env.SMTP_REPLY_TO || null,
    mode,
  };
}

function getConfigInternal(): SmtpConfig {
  if (!_config) _config = buildConfig();
  return _config;
}

/**
 * Returns a masked snapshot safe for API responses (pass = "***").
 */
export function getConfig(): Omit<SmtpConfig, "pass"> & { pass: string } {
  const c = getConfigInternal();
  return { ...c, pass: "***" };
}

/**
 * Admin can rotate fromAddress, replyTo, mode (host/port/user/pass are env-only).
 */
export function patchConfig(patch: Partial<Pick<SmtpConfig, "fromAddress" | "replyTo" | "mode">>): void {
  const c = getConfigInternal();
  if (patch.fromAddress !== undefined) c.fromAddress = patch.fromAddress;
  if (patch.replyTo !== undefined) c.replyTo = patch.replyTo;
  if (patch.mode !== undefined) c.mode = patch.mode;
  // Reset transporter when mode changes
  if (patch.mode !== undefined) {
    _transporter = null;
    _transporterBroken = false;
  }
}

/* ============================================================
 * Nodemailer transporter (lazy + cached)
 * ============================================================ */

let _transporter: Transporter | null = null;
let _transporterBroken = false;

function getTransporter(): Transporter {
  if (_transporter && !_transporterBroken) return _transporter;
  const c = getConfigInternal();
  _transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: {
      user: c.user,
      pass: c.pass,
    },
  });
  _transporterBroken = false;
  return _transporter;
}

/* ============================================================
 * Rate limiter — token bucket, 30 tokens/sec
 * ============================================================ */

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  readonly capacity: number;
  readonly refillRate: number; // tokens per ms
}

const _bucket: TokenBucket = {
  tokens: 30,
  lastRefill: Date.now(),
  capacity: 30,
  refillRate: 30 / 1000, // 30 per second
};

// Queue of over-limit sends (resolve immediately, but will be retried by caller)
let _rateLimitedCount = 0;

function consumeToken(): boolean {
  const now = Date.now();
  const elapsed = now - _bucket.lastRefill;
  _bucket.tokens = Math.min(_bucket.capacity, _bucket.tokens + elapsed * _bucket.refillRate);
  _bucket.lastRefill = now;
  if (_bucket.tokens >= 1) {
    _bucket.tokens -= 1;
    return true;
  }
  _rateLimitedCount++;
  return false;
}

export function getRateLimitedCount(): number {
  return _rateLimitedCount;
}

/* ============================================================
 * Idempotency cache — last 1000 keys
 * ============================================================ */

const _idempotencyCache = new Map<string, SendMailResult>();
const _idempotencyOrder: string[] = [];
const IDEM_MAX = 1000;

function cacheIdempotencyResult(key: string, result: SendMailResult): void {
  if (_idempotencyCache.has(key)) return;
  _idempotencyCache.set(key, result);
  _idempotencyOrder.push(key);
  if (_idempotencyOrder.length > IDEM_MAX) {
    const evicted = _idempotencyOrder.shift()!;
    _idempotencyCache.delete(evicted);
  }
}

/* ============================================================
 * sendMail — main entry point
 * ============================================================ */

export async function sendMail(args: SendMailArgs): Promise<SendMailResult> {
  // Idempotency check
  if (args.idempotencyKey) {
    const cached = _idempotencyCache.get(args.idempotencyKey);
    if (cached) return cached;
  }

  // Rate limit check — caller is responsible for requeue
  if (!consumeToken()) {
    const result: SendMailResult = { ok: false, error: "rate_limited" };
    return result;
  }

  const c = getConfigInternal();
  let result: SendMailResult;

  try {
    if (c.mode === "dry_run") {
      result = { ok: true, messageId: `dry_${randomBytes(8).toString("hex")}` };
    } else if (c.mode === "console") {
      const msgId = `console_${randomBytes(8).toString("hex")}`;
      // Intentionally minimal: no credential logging
      log.info(
        `[emailTransport][console] to=${args.to} subject="${args.subject}" msgId=${msgId}`
      );
      result = { ok: true, messageId: msgId };
    } else {
      // smtp mode
      const transporter = getTransporter();
      const replyTo = args.replyTo ?? c.replyTo ?? undefined;
      const info = await transporter.sendMail({
        from: c.fromAddress,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        replyTo,
        headers: args.headers,
      });
      result = { ok: true, messageId: info.messageId };
    }
  } catch (err) {
    const msg = (err as Error).message ?? "send_failed";
    // Mark transporter broken on auth-class errors
    if (c.mode === "smtp" && /auth|credentials|535|534|530/i.test(msg)) {
      _transporterBroken = true;
      _transporter = null;
    }
    result = { ok: false, error: msg };
  }

  if (args.idempotencyKey) {
    cacheIdempotencyResult(args.idempotencyKey, result);
  }
  return result;
}

/* ============================================================
 * testConnection — latency probe
 * ============================================================ */

export async function testConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const c = getConfigInternal();
  if (c.mode === "dry_run" || c.mode === "console") {
    return { ok: true, latencyMs: 0 };
  }
  const start = Date.now();
  try {
    const t = getTransporter();
    await t.verify();
    _transporterBroken = false;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    _transporterBroken = true;
    _transporter = null;
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}

/* ============================================================
 * Test helpers
 * ============================================================ */

export const _testTransport = {
  reset(): void {
    _config = null;
    _transporter = null;
    _transporterBroken = false;
    _idempotencyCache.clear();
    _idempotencyOrder.length = 0;
    _bucket.tokens = 30;
    _bucket.lastRefill = Date.now();
    _rateLimitedCount = 0;
  },
  forceMode(mode: TransportMode): void {
    const c = getConfigInternal();
    c.mode = mode;
    _transporter = null;
    _transporterBroken = false;
  },
};
