import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { apiRequestLog, API_LOG_ROUTE_FALLBACK } from "../lib/apiRequestLog";
import { correlationIdMiddleware } from "../lib/correlationId";
import { log } from "../lib/logger";

afterEach(() => vi.restoreAllMocks());

function harness() {
  const messages: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(apiRequestLog(message => messages.push(message)));
  return { app, messages };
}

describe("slide13b operational API logs exclude bearer data", () => {
  it("returns the complete JSON response unchanged but logs no payload or headers", async () => {
    const { app, messages } = harness();
    const body = {
      founderInvite: { claimUrl: "https://example.test/auth/redeem?token=claim-sentinel", email: "private@example.test" },
      token: "token-sentinel", password: "password-sentinel", pass: "pass-sentinel",
      arbitrary: [{ customSecretField: "arbitrary-sentinel" }],
    };
    app.post("/api/invitations/:id", (_req, res) => {
      res.setHeader("Location", "https://example.test/?token=location-sentinel");
      res.status(201).json(body);
    });
    const response = await request(app).post("/api/invitations/path-sentinel?token=query-sentinel")
      .set("Cookie", "session=cookie-sentinel")
      .set("Authorization", "Bearer authorization-sentinel")
      .send({ password: "request-sentinel" });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(body);
    expect(response.headers.location).toContain("location-sentinel");
    expect(messages).toHaveLength(1);
    for (const sentinel of [
      "claim-sentinel", "private@example.test", "token-sentinel", "password-sentinel",
      "pass-sentinel", "arbitrary-sentinel", "location-sentinel", "path-sentinel",
      "query-sentinel", "cookie-sentinel", "authorization-sentinel", "request-sentinel",
    ]) expect(messages.join("\n")).not.toContain(sentinel);
    expect(messages[0]).toMatch(/^POST \/api\/invitations\/:id 201 in \d+ms$/);
  });

  it("never includes a parameterized mount prefix, even without mergeParams", async () => {
    const { app, messages } = harness();
    const router = express.Router();
    router.get("/items/:id", (_req, res) => res.json({ ok: true }));
    app.use("/api/tenants/:tenantToken", router);
    const response = await request(app).get("/api/tenants/mount-secret/items/item-secret");
    expect(response.status).toBe(200);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^GET \/items\/:id 200 in \d+ms$/);
    expect(messages.join()).not.toMatch(/mount-secret|item-secret|tenants/);
  });

  it("uses a constant for an unmatched API request and excludes non-API traffic", async () => {
    const { app, messages } = harness();
    await request(app).get("/api/unmatched-secret?token=query-secret").expect(404);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(new RegExp(`^GET \\${API_LOG_ROUTE_FALLBACK.slice(0, -1)}\\] 404 in \\d+ms$`));
    expect(messages.join()).not.toMatch(/unmatched-secret|query-secret/);
    app.get("/status", (_req, res) => res.json({ secret: "outside-api-secret" }));
    await request(app).get("/status").expect(200);
    expect(messages).toHaveLength(1);
  });

  it("uses constants for array and RegExp patterns instead of resolved URLs", async () => {
    const { app, messages } = harness();
    app.get(["/api/array-one/:id", "/api/array-two/:id"], (_req, res) => res.sendStatus(204));
    app.get(/^\/api\/regex\/([^/]+)$/, (_req, res) => res.sendStatus(204));
    await request(app).get("/api/array-one/array-secret").expect(204);
    await request(app).get("/api/regex/regex-secret").expect(204);
    expect(messages).toHaveLength(2);
    expect(messages.every(line => line.includes(API_LOG_ROUTE_FALLBACK))).toBe(true);
    expect(messages.join()).not.toMatch(/array-secret|regex-secret/);
  });

  it("preserves status for errors without serializing their JSON details", async () => {
    const { app, messages } = harness();
    app.get("/api/failure", (_req, res) => res.status(503).json({ error: "private-error-sentinel" }));
    const response = await request(app).get("/api/failure");
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "private-error-sentinel" });
    expect(messages[0]).toMatch(/^GET \/api\/failure 503 in \d+ms$/);
    expect(messages.join()).not.toContain("private-error-sentinel");
  });

  it("retains correlation in the actual logger-before-correlation middleware order", async () => {
    const entries: string[] = [];
    vi.spyOn(console, "log").mockImplementation(line => { entries.push(String(line)); });
    const app = express();
    app.use(apiRequestLog(message => log.info(message)));
    app.use(correlationIdMiddleware);
    app.get("/api/correlated", (_req, res) => {
      setTimeout(() => res.status(202).json({ secret: "correlated-body-secret" }), 1);
    });
    const id = "0a6f1690-239a-4c3b-895f-18f13aa6fdc1";
    const response = await request(app).get("/api/correlated").set("X-Correlation-ID", id);
    expect(response.status).toBe(202);
    expect(response.headers["x-correlation-id"]).toBe(id);
    const entry = entries.map(line => JSON.parse(line)).find(line => line.message?.includes("/api/correlated"));
    expect(entry).toMatchObject({ level: "info", correlationId: id });
    expect(entry.message).toMatch(/^GET \/api\/correlated 202 in \d+ms$/);
    expect(entries.join()).not.toContain("correlated-body-secret");
  });

  it("mounts the safe middleware in the production entrypoint and removes capture", () => {
    const source = readFileSync(resolve("server/index.ts"), "utf8");
    expect(source).toContain('import { apiRequestLog } from "./lib/apiRequestLog"');
    expect(source).toContain("app.use(apiRequestLog(log));");
    expect(source.indexOf("app.use(apiRequestLog(log));")).toBeLessThan(source.indexOf("await registerRoutes"));
    expect(source).not.toMatch(/capturedJsonResponse|originalResJson|res\.json\s*=/);
    const helper = readFileSync(resolve("server/lib/apiRequestLog.ts"), "utf8");
    expect(helper).not.toMatch(/baseUrl|originalUrl|req\.(?:url|params|query|headers|cookies|body)|res\.(?:json|body)|JSON\.stringify|process\.env/);
  });
});
