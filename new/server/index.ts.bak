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

  console.log(`${formattedTime} [${source}] ${message}`);
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

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

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
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

      // KL-05: Start bridge outbox auto-drain worker
      // Set BRIDGE_WORKER_ENABLED=false to disable (e.g. in multi-process deployments)
      if (process.env.BRIDGE_WORKER_ENABLED !== "false") {
        startBridgeWorker();
      } else {
        log("bridge worker disabled via BRIDGE_WORKER_ENABLED=false", "bridge-worker");
      }
    },
  );
})();
