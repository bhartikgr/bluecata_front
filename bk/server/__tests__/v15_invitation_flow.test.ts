/**
 * v15 P0-4..P0-8 — invitation flow end-to-end.
 *
 *  - POST /api/rounds/:id/invitations persists a row, classifies the email,
 *    and sends an email via emailTransport (console mode in tests).
 *  - The response includes a public-view invitation row with NO raw token
 *    and NO token_hash.
 *  - The store keeps a token_hash internally that is NOT the raw token.
 *  - GET /api/rounds/:id/invitations returns the persisted row.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { _testAccessInvitations } from "../roundInvitationsStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("v15 P0-4..P0-8: invitation flow", () => {
  const ROUND_ID = "rnd_novapay_foundation";

  it("anonymous → 401", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const r = await call("POST", `/api/rounds/${ROUND_ID}/invitations`, {
        body: { investorEmail: "anon@example.com" },
      });
      expect(r.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("wrong founder → 403", async () => {
    const r = await call("POST", `/api/rounds/${ROUND_ID}/invitations`, {
      body: { investorEmail: "wrong@example.com" },
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(403);
  });

  it("missing email → 400", async () => {
    const r = await call("POST", `/api/rounds/${ROUND_ID}/invitations`, {
      body: {},
      userId: "u_maya_chen",
    });
    expect(r.status).toBe(400);
  });

  it("legitimate founder creates an invitation; response has NO raw token", async () => {
    const beforeCount = _testAccessInvitations.rows.length;
    const r = await call("POST", `/api/rounds/${ROUND_ID}/invitations`, {
      body: {
        investorEmail: "v15-flow-test@example.com",
        investorName: "v15 Flow Test",
        note: "Welcome aboard",
        expiryDays: 14,
      },
      userId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.invitation?.id).toMatch(/^inv_/);
    expect(r.body?.invitation?.investorEmail).toBe("v15-flow-test@example.com");

    // CRITICAL: the response must NOT contain the raw token OR the token_hash.
    const json = JSON.stringify(r.body);
    expect(json).not.toMatch(/"tokenHash"/);
    expect(json).not.toMatch(/"token"/);
    // Classification surfaced.
    expect(["in_crm", "new_registration"]).toContain(r.body?.classification);

    // Store has one more row.
    expect(_testAccessInvitations.rows.length).toBe(beforeCount + 1);
    // The persisted row has a token hash, and it is NOT the empty string.
    const row = _testAccessInvitations.rows[_testAccessInvitations.rows.length - 1];
    expect(row.tokenHash).toBeTruthy();
    expect((row.tokenHash ?? "").length).toBeGreaterThanOrEqual(64); // sha256 hex
  });

  it("CRM classification — known CRM email is tagged in_crm", async () => {
    // Maya's CRM has 'aisha@forge.vc' (founderCrmStore demo seed).
    const r = await call("POST", `/api/rounds/${ROUND_ID}/invitations`, {
      body: { investorEmail: "aisha@forge.vc", investorName: "Aisha" },
      userId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(r.body?.classification).toBe("in_crm");
  });

  it("GET /api/rounds/:id/invitations lists persisted invitations", async () => {
    const r = await call("GET", `/api/rounds/${ROUND_ID}/invitations`, {
      userId: "u_maya_chen",
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    // At least our two test invitations are returned.
    const ours = (r.body as any[]).filter(
      (i) => i.investorEmail === "v15-flow-test@example.com" || i.investorEmail === "aisha@forge.vc",
    );
    expect(ours.length).toBeGreaterThanOrEqual(2);
    // None of them carry tokenHash on the wire.
    for (const inv of r.body as any[]) {
      expect(inv.tokenHash).toBeUndefined();
    }
  });
});
