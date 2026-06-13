/**
 * v23.4.2 — Admin SMTP diagnostic endpoints.
 *
 * These exist because operators (Avi, future ops) need to validate their SMTP
 * configuration BEFORE depending on it for partner invites. The previous
 * pattern of "submit a partner application and hope the email arrives" buried
 * SMTP misconfiguration behind a real workflow, making debugging painful.
 *
 * Endpoints:
 *   GET  /api/admin/email/config     — sanitized SMTP config (no password ever)
 *   POST /api/admin/email/test       — calls nodemailer.verify(); returns ok + actionable hint
 *   POST /api/admin/email/send-test  — sends a real test email; returns delivery result
 *
 * Security:
 *   - Auth: applyRouteGuards.ts already enforces requireAdmin on /api/admin/*
 *     (we do not re-attach the middleware here, by convention).
 *   - The password (SMTP_PASS) is NEVER returned. config endpoint only echoes
 *     host/port/secure/from/replyTo/mode/user.
 *   - Every test invocation is audited via appendAdminAudit so operators have
 *     a trail of "who tested SMTP, when, what was the result".
 *
 * Non-goals:
 *   - This module does NOT write the SMTP config. .env is the source of truth.
 *   - This module does NOT cache verify() results. Each call probes live.
 */
import type { Express, Request, Response } from "express";
import { verifyTransport, sendEmail } from "./emailSender";
import { appendAdminAudit } from "../adminPlatformStore";

interface SanitizedSmtpConfig {
  mode: string;
  host: string | null;
  port: number | null;
  secure: boolean | null;
  user: string | null;
  from: string | null;
  replyTo: string | null;
  /** True if SMTP_PASS is non-empty. The password itself is never returned. */
  passwordPresent: boolean;
  /** True if APP_URL is set and not localhost (invite-link sanity). */
  appUrlOk: boolean;
  appUrl: string | null;
}

function getSanitizedConfig(): SanitizedSmtpConfig {
  const replyToRaw = process.env.SMTP_REPLY_TO;
  const replyTo =
    replyToRaw && replyToRaw.trim().length > 0 ? replyToRaw : null;
  const appUrl = process.env.APP_URL ?? null;
  const appUrlOk =
    !!appUrl &&
    !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(appUrl);
  return {
    mode: process.env.SMTP_MODE ?? "smtp",
    host: process.env.SMTP_HOST ?? null,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : null,
    secure: process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === "true"
      : null,
    user: process.env.SMTP_USER ?? null,
    from: process.env.SMTP_FROM ?? null,
    replyTo,
    passwordPresent: !!(process.env.SMTP_PASS && process.env.SMTP_PASS.length > 0),
    appUrlOk,
    appUrl,
  };
}

function actorIdFromReq(req: Request): string {
  return (req as unknown as { userContext?: { userId?: string } })
    .userContext?.userId ?? "u_unknown_admin";
}

export function registerAdminEmailRoutes(app: Express): void {
  // ---- GET /api/admin/email/config ----
  app.get("/api/admin/email/config", (_req: Request, res: Response) => {
    const cfg = getSanitizedConfig();
    res.json(cfg);
  });

  // ---- POST /api/admin/email/test ----
  // Probes SMTP via nodemailer.verify(). Does NOT send mail. Fast, cheap diagnostic.
  app.post("/api/admin/email/test", async (req: Request, res: Response) => {
    const actor = actorIdFromReq(req);
    const result = await verifyTransport();
    try {
      appendAdminAudit(actor, "smtp.verify", "email.test", {
        ok: result.ok,
        mode: result.mode,
        host: result.host ?? null,
        port: result.port ?? null,
        secure: result.secure ?? null,
        error: result.error ?? null,
      });
    } catch {
      /* audit must never break the response */
    }
    res.json(result);
  });

  // ---- POST /api/admin/email/send-test ----
  // Sends a real email to the address in the body (or the admin's own user email).
  // Used to confirm end-to-end delivery, including SPF/DKIM/inbox routing.
  app.post(
    "/api/admin/email/send-test",
    async (req: Request, res: Response) => {
      const actor = actorIdFromReq(req);
      const body = (req.body ?? {}) as { to?: string };
      const ctxEmail = (req as unknown as { userContext?: { email?: string } })
        .userContext?.email;
      const to = (body.to ?? ctxEmail ?? "").trim();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res
          .status(400)
          .json({ error: "bad_recipient", hint: "Provide { to: '<email>' } in the body." });
      }

      const subject = "Capavate SMTP test message";
      const text = [
        "This is a Capavate SMTP test message.",
        "",
        `Triggered by admin: ${actor}`,
        `At: ${new Date().toISOString()}`,
        `From host: ${process.env.SMTP_HOST ?? "(unset)"}`,
        `Port: ${process.env.SMTP_PORT ?? "(default 587)"}`,
        `Secure: ${process.env.SMTP_SECURE ?? "(default false)"}`,
        "",
        "If you received this, your Capavate SMTP configuration is working.",
      ].join("\n");

      const result = await sendEmail({
        to,
        subject,
        text,
        category: "smtp_test",
        refId: actor,
      });
      try {
        appendAdminAudit(actor, "smtp.send_test", "email.send-test", {
          to,
          delivered: result.delivered,
          mode: result.mode,
          error: result.error ?? null,
        });
      } catch {
        /* audit must never break the response */
      }
      res.json({ to, ...result });
    },
  );
}
