/**
 * WAVE 221 — HTTP surface for the benchmarking / matchmaking opt-out.
 *
 * A NEW non-sacred route module rather than an edit to `server/profileStore.ts`.
 * That file is FROZEN, and its `PATCH /api/investors/:id/privacy` handler validates
 * with a zod schema that strips unknown keys — so routing this preference through it
 * would return HTTP 200 and serve the old value on the next read (§5.10). This is the
 * "intercept from a non-sacred layer" answer, not a second store: the state lives in
 * one place (`server/lib/wave221BenchmarkingOptOut.ts`) and is audited through the
 * platform's one audit path (`appendAdminAudit`).
 *
 * Two silos, §221.3: the investor, and the partner firm. The founder silo already has
 * its control and is not touched by this wave.
 *
 * `sharingEnabled` is the wire field, so the API reads the same way round as the
 * switch the user sees: true = my data may be used, false = it may not.
 */

import type { Express, Request, Response } from "express";
import {
  wave221EnsureColumn,
  wave221IsOptedOut,
  wave221OptOutAt,
  wave221SetSharing,
  type Wave221Subject,
} from "./lib/wave221BenchmarkingOptOut";
import { resolveRateLimitClientIp } from "./lib/rateLimit";
/* Reused, not reimplemented — the same middleware every other partner surface uses,
   so the partner id comes from `req.partnerContext` exactly as it does at
   `server/partnerRoutes.ts:2699` for the workspace-settings routes. */
import { requirePartnerAuth } from "./lib/requirePartnerAuth";

interface Ctx {
  userId?: string;
  isAdmin?: boolean;
  tenantId?: string;
}

function ctxOf(req: Request): Ctx {
  return ((req as Request & { userContext?: Ctx }).userContext ?? {}) as Ctx;
}

/**
 * The IP as the server observed it. `resolveRateLimitClientIp` only trusts an
 * `X-Forwarded-For` header when the immediate peer is in `TRUSTED_PROXY_IPS`, so a
 * forged header from an untrusted client is not what gets recorded (R187.1). Nothing
 * client-supplied is ever stored as the observed IP.
 */
function observedIp(req: Request): string | null {
  try {
    return resolveRateLimitClientIp(req) || null;
  } catch {
    return null;
  }
}

function observedUserAgent(req: Request): string | null {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua.length > 0 ? ua : null;
}

function readBody(req: Request): { sharingEnabled?: boolean } {
  const b = (req.body ?? {}) as Record<string, unknown>;
  return { sharingEnabled: typeof b.sharingEnabled === "boolean" ? b.sharingEnabled : undefined };
}

function respondState(res: Response, subject: Wave221Subject, subjectId: string): Response {
  /* The column is installed on the read path too. A GET that 500s because a
     :memory: database never ran migration 0228 would make the switch look broken
     rather than off. */
  wave221EnsureColumn(subject);
  return res.json({
    ok: true,
    subject,
    subjectId,
    sharingEnabled: !wave221IsOptedOut(subject, subjectId),
    optOutAt: wave221OptOutAt(subject, subjectId),
  });
}

export function registerWave221BenchmarkingOptOutRoutes(app: Express): void {
  /* ── investor ───────────────────────────────────────────────────────────── */

  app.get("/api/investor/me/benchmarking-sharing", (req, res) => {
    const ctx = ctxOf(req);
    if (!ctx.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    return respondState(res, "investor", ctx.userId);
  });

  app.patch("/api/investor/me/benchmarking-sharing", (req, res) => {
    const ctx = ctxOf(req);
    if (!ctx.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const { sharingEnabled } = readBody(req);
    if (sharingEnabled === undefined) {
      return res.status(400).json({ ok: false, error: "SHARING_ENABLED_REQUIRED" });
    }
    const out = wave221SetSharing({
      subject: "investor",
      subjectId: ctx.userId,
      sharingEnabled,
      actorId: ctx.userId,
      ipAddress: observedIp(req),
      userAgent: observedUserAgent(req),
      tenantId: ctx.tenantId,
    });
    if (!out.ok) return res.status(409).json({ ok: false, error: out.reason });
    return respondState(res, "investor", ctx.userId);
  });

  /* ── partner firm ───────────────────────────────────────────────────────── */

  app.get("/api/partner/me/benchmarking-sharing", requirePartnerAuth, (req, res) => {
    const ctx = ctxOf(req);
    if (!ctx.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const partnerId = (req as Request & { partnerContext?: { partnerId?: string } })
      .partnerContext?.partnerId;
    if (!partnerId) return res.status(403).json({ ok: false, error: "NOT_A_PARTNER" });
    return respondState(res, "partner", partnerId);
  });

  app.patch("/api/partner/me/benchmarking-sharing", requirePartnerAuth, (req, res) => {
    const ctx = ctxOf(req);
    if (!ctx.userId) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const partnerId = (req as Request & { partnerContext?: { partnerId?: string } })
      .partnerContext?.partnerId;
    if (!partnerId) return res.status(403).json({ ok: false, error: "NOT_A_PARTNER" });
    const { sharingEnabled } = readBody(req);
    if (sharingEnabled === undefined) {
      return res.status(400).json({ ok: false, error: "SHARING_ENABLED_REQUIRED" });
    }
    const out = wave221SetSharing({
      subject: "partner",
      subjectId: partnerId,
      sharingEnabled,
      actorId: ctx.userId,
      ipAddress: observedIp(req),
      userAgent: observedUserAgent(req),
      tenantId: ctx.tenantId,
    });
    if (!out.ok) return res.status(409).json({ ok: false, error: out.reason });
    return respondState(res, "partner", partnerId);
  });
}
