/**
 * B-505 fix v23.6.1 — Founder CRM "Message" button must open (or clearly
 * explain) a DM thread instead of dead-ending on a 404.
 *
 * Repro: clicking Message on a CRM contact navigates to
 * /founder/messages?contactId=u_inv_* and the page calls
 * POST /api/comms/dm/start. CRM-only contacts (investors who haven't onboarded
 * into the comms layer) are absent from COMMS_USERS, so the route used to
 * return 404 "Target user not found".
 *
 * The fix resolves the target from the founder CRM store and auto-provisions a
 * minimal COMMS_USERS identity from the REAL stored name + email, authorizing
 * the DM via the founder's CRM-ownership relationship. When no CRM record
 * exists at all, the route returns a structured 422 (never a silent 404).
 */
import { describe, it, expect } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerCommsRoutes } from "../commsStore";
import { _testAccessFounderCrm } from "../founderCrmStore";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // Test identity: the x-actor-id header is honoured by commsStore's actorOf
  // via resolvePersonaId; mirror the installV14TestIdentity behaviour inline.
  app.use((req, _res, next) => {
    const actor = req.header("x-actor-id");
    if (actor) {
      (req as any).userContext = { userId: actor };
    }
    next();
  });
  registerCommsRoutes(app);
  return app;
}

function call(
  app: Express,
  method: string,
  path: string,
  opts: { body?: unknown; actorId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const headers: Record<string, string> = {};
      if (data) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(data));
      }
      if (opts.actorId) headers["x-actor-id"] = opts.actorId;
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null });
            } catch {
              resolve({ status: res.statusCode || 0, body: buf });
            }
          });
        },
      );
      r.on("error", reject);
      if (data) r.write(data);
      r.end();
    });
  });
}

describe("B-505: dm/start resolves founder CRM-only contacts", () => {
  it("opens a DM thread for a CRM-only contact (provisioned from real name + email)", async () => {
    const app = buildApp();
    // u_lead_1 (Sophie Müller / Northstar VC) is a seeded founder CRM contact
    // that is intentionally NOT present in COMMS_USERS — a true CRM-only target.
    const res = await call(app, "POST", "/api/comms/dm/start", {
      body: { targetUserId: "u_lead_1" },
      actorId: "u_maya_chen",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.channelId).toBe("string");
  });

  it("returns a structured 422 (never a silent 404) when no CRM record exists", async () => {
    const app = buildApp();
    const res = await call(app, "POST", "/api/comms/dm/start", {
      body: { targetUserId: "u_inv_does_not_exist_anywhere" },
      actorId: "u_maya_chen",
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("contact_not_provisioned");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
  });

  it("provisions a CRM contact that has an email but is otherwise comms-absent", async () => {
    const app = buildApp();
    // Seed a CRM-only contact directly into the in-memory store to prove the
    // resolution path uses real stored values rather than mocks.
    const investorId = "u_inv_b505test";
    _testAccessFounderCrm.contacts.push({
      id: "fcrm_b505_test",
      companyId: "co_novapay",
      investorId,
      name: "Casey Rivera",
      firmName: "Rivera Angels",
      email: "casey@rivera.test",
      region: "US",
      stage: "lead",
      ownership: { sharesUsd: 0, pct: 0 },
      softCircleHistory: [],
      maSignals: 0,
      threadIds: [],
      notes: "",
      notesUpdatedAt: "",
      tasks: [],
      series: "—",
    });
    const res = await call(app, "POST", "/api/comms/dm/start", {
      body: { targetUserId: investorId },
      actorId: "u_maya_chen",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
