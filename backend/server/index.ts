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
import { hydrateAllStores } from "./lib/hydrateStores";
// Sprint-fix May 14 2026 — wire the catch-all route guard AFTER registerRoutes.
import { applyRouteGuards } from "./lib/applyRouteGuards";
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
  // KL-04: Hydrate in-memory stores from DB on startup (no-op in sandbox)
  await hydrateAllStores();

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
      host: "localhost",
      // reusePort: true,  // ❌ Windows pe yeh hatao
    },
    () => {
      log(`serving on port ${port}`);

      if (process.env.BRIDGE_WORKER_ENABLED !== "false") {
        startBridgeWorker();
      } else {
        log("bridge worker disabled via BRIDGE_WORKER_ENABLED=false", "bridge-worker");
      }
    },
  );
})();

