/**
 * Sprint 16 — Track C integration: route smoke + tabbed channels view.
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import { registerCommsTiersRoutes, __resetCommsTiers } from "../../commsTiersStore";

function buildApp() {
  const app = express();
  app.use(express.json());
  registerCommsTiersRoutes(app);
  return app;
}

function call(app: express.Express, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null }); }
            catch { resolve({ status: res.statusCode || 0, body: buf }); }
          });
        },
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

describe("Sprint 16 — Comms tiers routes", () => {
  beforeEach(() => __resetCommsTiers());

  it("POST /api/comms/co-investor-groups creates a group", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/comms/co-investor-groups", {
      companyId: "co_novapay", participants: ["u_a", "u_b"], actorId: "u_a",
    });
    expect(r.status).toBe(200);
    expect(r.body.id).toMatch(/^cig_/);
  });

  it("POST /api/comms/co-investor-groups validates required fields", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/comms/co-investor-groups", { companyId: "co_x" });
    expect(r.status).toBe(400);
  });

  it("GET /api/comms/channels-tiered returns 3 buckets", async () => {
    const app = buildApp();
    await call(app, "POST", "/api/comms/co-investor-groups", {
      companyId: "co_novapay", participants: ["u_a", "u_b"], actorId: "u_a",
    });
    const r = await call(app, "GET", "/api/comms/channels-tiered?view=tabbed&userId=u_a");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.capTableCommunity)).toBe(true);
    expect(Array.isArray(r.body.softCircleCommunity)).toBe(true);
    expect(Array.isArray(r.body.crossCohort)).toBe(true);
    expect(r.body.capTableCommunity[0].badge).toBe("Cap-Table");
    expect(r.body.capTableCommunity[0].tier).toBe(1);
  });

  it("GET /api/comms/channels-tiered rejects unknown view", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/comms/channels-tiered?view=other");
    expect(r.status).toBe(400);
  });

  it("POST /api/comms/cross-cohort/dm/start returns 429 when blocked", async () => {
    const app = buildApp();
    // No opt-in → blocked
    const r = await call(app, "POST", "/api/comms/cross-cohort/dm/start", {
      roundId: "r1", fromUserId: "u_ct", toUserId: "u_sc", body: "hi",
    });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("soft_circler_opted_out");
  });

  it("POST /api/rounds/:roundId/qa posts a question", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/rounds/rnd_x/qa", { askerUserId: "u_a", body: "?" });
    expect(r.status).toBe(200);
    expect(r.body.id).toMatch(/^qaq_/);
  });

  it("GET /api/founder/crm/high-value-advocates labels advisory only", async () => {
    const app = buildApp();
    const r = await call(app, "GET", "/api/founder/crm/high-value-advocates");
    expect(r.status).toBe(200);
    expect(r.body.label).toBe("For informational purposes only");
    expect(Array.isArray(r.body.advocates)).toBe(true);
    expect(r.body.note).toMatch(/NOT a cap-table-engine input/);
  });

  it("POST /api/rounds/:roundId/endorsements rejects without disclaimer", async () => {
    const app = buildApp();
    const r = await call(app, "POST", "/api/rounds/r1/endorsements", {
      companyId: "c1", endorserUserId: "u_a", chip: "team_quality", text: "ok", disclaimerAck: false,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("disclaimer_required");
  });
});
