// FUTURE: Migrate to Fastify per R200 §25.1
// (Sprint 1 preview keeps Express runtime; production target is Fastify 4.x +
// @fastify/type-provider-typebox + Auth0 JWT validation + Helmet + idempotency.)
import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { startBridgeWorker } from "./bridgeWorker";
import { startCollectiveRenewalWorker, isRenewalWorkerEnabled } from "./lib/collectiveRenewalWorker";
import { hydrateBridgeStore } from "./bridgeStore";
import { hydrateAllStores } from "./lib/hydrateStores";
// Sprint-fix May 14 2026 — wire the catch-all route guard AFTER registerRoutes.
import { applyRouteGuards } from "./lib/applyRouteGuards";
import { originAllowlistForWrites } from "./middleware/security";
import { assertAuthSecretsAtBoot } from "./lib/auth"; // v25.25 Avi-1
// v12 Phase A.6 — demo seed gate (non-prod only).
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { seedDemoData } from "./lib/seedDemoData";
import { getDb } from "./db/connection";
import { log as structuredLog } from "./lib/logger";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

/**
 * Sprint 26 — lightweight inline cookie parser.
 *
 * Avoids the `cookie-parser` dependency. Parses the Cookie header into
 * `req.cookies: Record<string,string>` exactly as cookie-parser does for
 * the unsigned-cookie case. Idempotent: if `req.cookies` is already set
 * (e.g. by a future middleware), we don't overwrite it.
 *
 * This is the missing link that lets the cap_uid session cookie set by
 * /api/auth/login flow through to credentialed endpoints (like the
 * term-sheet save endpoint).
 */
app.use((req, _res, next) => {
  const r = req as Request & { cookies?: Record<string, string> };
  if (!r.cookies) {
    const header = req.headers.cookie;
    const out: Record<string, string> = {};
    if (typeof header === "string" && header.length > 0) {
      for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1) continue;
        const k = part.slice(0, eq).trim();
        const v = part.slice(eq + 1).trim();
        if (k.length > 0) {
          try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
        }
      }
    }
    r.cookies = out;
  }
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  structuredLog.info(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // v25.25 Avi-1 — fail fast in production if JWT_SECRET is missing/short.
  // Avi reported a 500 on /api/auth/login when his .env had `JWT_SECRET=`
  // (empty). The v25.17 throw was at module-import time — which fired only
  // on the first request that imported `auth.ts`. Now we assert at boot so
  // the symptom is obvious (process exits 1 with a clear message) instead
  // of latent 500s on first login.
  assertAuthSecretsAtBoot();

  // KL-04: Hydrate in-memory stores from DB on startup (no-op in sandbox)
  await hydrateAllStores();

  // v23.4.1 Task J — Boot-time migration drift check.
  // Runs db_doctor logic inline (not via child_process) to avoid startup overhead.
  // In production: BLOCKING — exits 1 if schema is out of date.
  // In development: WARN only (so hot-reload is not killed by drift).
  if (process.env.SKIP_DB_DOCTOR !== "1") {
    try {
      const { rawDb: rawDbFn } = await import("./db/connection");
      const db = rawDbFn();
      const criticalColumns: Record<string, string[]> = {
        "founder_tiers": ["id", "name", "usd_monthly", "billing_cycle"],
        "consortium_applications": ["id", "contact_email", "status", "invite_payload_json"],
        "auth_redeem_tokens": ["id", "token_hash", "email", "intent", "expires_at"],
      };
      const missing: string[] = [];
      const existingTables = new Set(
        (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
          .map((r: { name: string }) => r.name),
      );
      for (const [tbl, cols] of Object.entries(criticalColumns)) {
        if (!existingTables.has(tbl)) {
          missing.push(`table:${tbl}`);
          continue;
        }
        const actualCols = new Set(
          (db.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[]).map(
            (r: { name: string }) => r.name,
          ),
        );
        for (const col of cols) {
          if (!actualCols.has(col)) missing.push(`${tbl}.${col}`);
        }
      }
      if (missing.length > 0) {
        const isProd = process.env.NODE_ENV === "production";
        const msg = `[boot] Database schema is out of date. Run 'npm run db:migrate' then restart. Missing: ${missing.join(", ")}.`;
        if (isProd) {
          structuredLog.error(msg + " Aborting boot.");
          process.exit(1);
        } else {
          structuredLog.warn(msg + " (non-production: continuing anyway)");
        }
      } else {
        structuredLog.info("[boot] db:doctor passed — schema is current");
      }
    } catch (doctorErr) {
      // Doctor check failed (e.g. fresh DB before first migrate) — warn and continue
      structuredLog.warn("[boot] db:doctor check skipped (DB may be fresh):", String(doctorErr));
    }
  }

  // v12 Phase A.6 — seed demo personas (Maya / Aisha / Daniel + NovaPay /
  // Arboreal / Kelvin + Keiretsu Canada) BEHIND the demo gate. Production
  // never seeds. Every row carries is_demo=1 so v13 can purge cleanly.
  // Idempotent: re-runs are no-ops via onConflictDoNothing.
  if (DEMO_SEED_ENABLED) {
    try {
      const summary = await seedDemoData(getDb());
      structuredLog.info("[v12 demo-seed]", summary);

      // v15 fix — re-hydrate stores AFTER seeding so the in-memory caches
      // reflect the seeded DB rows. Without this, the boot order is:
      //   1) hydrate (DB empty) → caches empty
      //   2) seed (DB now has rows) → caches still empty
      //   3) Maya logs in → 0 companies in response (bug)
      // Re-running hydration here is idempotent and cheap.
      await hydrateAllStores();
      structuredLog.info("[v15 post-seed re-hydrate] complete");
    } catch (err) {
      structuredLog.error("[v12 demo-seed] failed", err);
    }
  }

  // v25.24 NH-5 fix (post-verifier) — origin allowlist for state-mutating
  // writes MUST mount BEFORE applyRouteGuards so cross-site POSTs get a 403
  // origin_not_allowed BEFORE the generic 401 UNAUTHORIZED. Previously the
  // allowlist was mounted inside registerRoutes, which Express runs AFTER
  // applyRouteGuards — making the allowlist a no-op (auth gate fired first).
  // Same-origin requests, native clients, and curl omit Origin and pass.
  app.use("/api", originAllowlistForWrites);

  // Patch v9 (P0-11): apply catch-all route guards BEFORE registerRoutes
  // so the middleware actually intercepts requests. Express middleware runs
  // in registration order — when registered AFTER routes, an `app.use("/api")`
  // middleware only runs for unmatched paths, which means matched admin/
  // founder/investor routes bypass the guard. Mounting BEFORE registerRoutes
  // ensures requireAdmin/requireAuth run before every /api/* handler.
  applyRouteGuards(app);

  await registerRoutes(httpServer, app);

  // Patch v9 (BUG-11): JSON 404 middleware for unmatched /api/* routes.
  // Must be registered AFTER all route handlers but BEFORE the Vite/static
  // catch-all so dead admin endpoints return JSON 404 instead of SPA HTML.
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next();
    res.status(404)
      .type("application/json")
      .json({ error: "not_found", path: req.path });
  });

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    structuredLog.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // v23.4.2 — boot-time APP_URL sanity check.
  // In production, APP_URL is used to construct invite-email links
  // (partner signup, password reset, etc.). If it points at localhost,
  // every link a recipient receives will be unusable from outside the
  // server. Log loudly so the operator notices BEFORE inviting anyone.
  // This is a warning, not a hard fail — the server still boots, and
  // localhost APP_URL is legitimate for staging on the host machine.
  if (process.env.NODE_ENV === "production") {
    const appUrl = process.env.APP_URL ?? "";
    if (!appUrl) {
      log(
        "[boot] APP_URL is not set. Invite-email links will use a relative path or default. " +
          "Set APP_URL=https://<your-public-domain> in .env.",
      );
    } else if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(appUrl)) {
      log(
        `[boot] WARNING: APP_URL=${appUrl} in production. ` +
          "Invite-email links will be broken for external recipients. " +
          "Set APP_URL to your public domain (https://...) in .env, then restart.",
      );
    }
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  // Patch v9 (PT-FIX-3): bind on 0.0.0.0 so IPv4 clients (Linux fetch, supertest,
  // partner E2E harness) can reach the server. Previously bound to "localhost"
  // which on some hosts resolves to ::1 only, breaking IPv4 callers.
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      // reusePort: true,  // ❌ Windows pe yeh hatao
    },
    () => {
      log(`serving on port ${port}`);

      if (process.env.BRIDGE_WORKER_ENABLED !== "false") {
        /* v25.4 — hydrate queued envelopes from bridge_outbox before the
         * drain worker starts, so queued events survive restart. */
        try {
          hydrateBridgeStore();
        } catch (err) {
          log(`bridge hydrate failed (non-fatal): ${(err as Error).message}`, "bridge-worker");
        }
        /* v25.21 Lane D NC-001 fix — hydrate every registered durableMap
         * (DSC scores, M&A intelligence, KYC decisions, membership renewals,
         * partner status, social signals, member decisions, round
         * participants, company tier) from `sync_inbox_state` BEFORE the
         * bridge drain worker starts dispatching inbound events. Before this
         * fix the maps were RAM-only and lost every restart. */
        try {
          // Lazy require so a circular import (durableMap → db → …) can't
          // break boot ordering.
          const { hydrateDurableMaps } = require("./durableMap");
          hydrateDurableMaps();
        } catch (err) {
          log(`durable-map hydrate failed (non-fatal): ${(err as Error).message}`, "bridge-worker");
        }
        startBridgeWorker();
      } else {
        log("bridge worker disabled via BRIDGE_WORKER_ENABLED=false", "bridge-worker");
      }

      /* v25.4 — Collective renewal scheduler (Airwallex). Gated by env so
       * tests + dev don't poll. */
      if (isRenewalWorkerEnabled()) {
        startCollectiveRenewalWorker();
        log("collective renewal worker started", "collective-renewal");
      }
    },
  );
})();

