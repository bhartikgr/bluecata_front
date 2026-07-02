/**
 * v25.48 shared supertest helpers. Builds a real Express app with registerRoutes
 * and exposes an authed request helper keyed to the sandbox test-persona
 * resolver (?as= / ?userId= / x-user-id — Vitest-only identity in userContext.ts).
 */
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { getDb } from "../db/connection.ts";

export async function buildApp() {
  getDb();
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  return { app, server, port };
}

export function closeApp(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Issue a request as a given persona.
 * @param opts.userId  explicit persona id (e.g. "u_aisha_patel", "u_no_position")
 * @param opts.as      role shortcut ("admin" | "founder" | "investor")
 */
export function call(port, method, path, { userId, as, body, headers } = {}) {
  const params = [];
  if (as) params.push(`as=${encodeURIComponent(as)}`);
  if (userId) params.push(`userId=${encodeURIComponent(userId)}`);
  const qs = params.length ? (path.includes("?") ? "&" : "?") + params.join("&") : "";
  const fullPath = `${path}${qs}`;
  const payload = body ? JSON.stringify(body) : null;
  const hdrs = { ...(payload ? { "content-type": "application/json" } : {}), ...(userId ? { "x-user-id": userId } : {}), ...(headers || {}) };
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path: fullPath, method, headers: hdrs }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        let j = null;
        try { j = JSON.parse(b); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: j, raw: b });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
