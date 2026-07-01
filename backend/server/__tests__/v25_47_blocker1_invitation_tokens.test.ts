/**
 * v25.47 BLOCKER-1/5 (APD-026/027) — Round invitation token email + single-use
 * redeem (sha256 token hash, 14-day expiry).
 *
 * Invitations are SEEDED through the canonical store (createInvitation, dryRun
 * so no email leaves the box); every ASSERTION hits a REAL Express route:
 *   GET  /api/invitations/check?token=...
 *   POST /api/invitations/redeem  { token }
 *
 *   1. A freshly issued token validates (check → valid:true).
 *   2. Redeeming it succeeds and returns a redirect.
 *   3. The token is single-use — a second redeem is rejected 409.
 *   4. After redemption, check reports already_redeemed.
 *   5. A garbage token is 404 not_found.
 *   6. The DB stores only sha256(token), never the raw token; expiry is ~14d.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash } from "node:crypto";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { createInvitation } from "../roundInvitationsStore";

let app: Express;
let server: http.Server;
let port: number;

const ROUND_ID = `round_inv_${Date.now()}`;
const COMPANY_ID = `co_inv_${Date.now()}`;

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** createInvitation returns redeemUrl `.../invite/<rawToken>`. */
function tokenFromRedeemUrl(url: string): string {
  return decodeURIComponent(url.split("/invite/")[1] ?? "");
}

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    if (payload) headers["content-length"] = String(Buffer.byteLength(payload));
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
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
    if (payload) r.write(payload);
    r.end();
  });
}

let liveToken = "";
let liveInvId = "";

beforeAll(async () => {
  getDb();
  const created = await createInvitation({
    roundId: ROUND_ID,
    companyId: COMPANY_ID,
    investorEmail: "blocker1@example.com",
    investorName: "Blocker One",
    invitedByUserId: "u_founder",
    dryRun: true,
  });
  liveToken = tokenFromRedeemUrl(created.redeemUrl);
  liveInvId = created.invitation.id;

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

describe("BLOCKER-1/5 invitation token redeem", () => {
  it("validates a freshly issued token", async () => {
    const res = await call("GET", `/api/invitations/check?token=${encodeURIComponent(liveToken)}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.roundId).toBe(ROUND_ID);
  });

  it("stores only sha256(token) and a ~14-day expiry", () => {
    const row: any = rawDb()
      .prepare(`SELECT token_hash, expires_at FROM round_invitations WHERE id = ?`)
      .get(liveInvId);
    expect(row).toBeTruthy();
    expect(row.token_hash).toBe(sha256Hex(liveToken));
    expect(row.token_hash).not.toBe(liveToken);
    const days = (Date.parse(row.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(15);
  });

  it("redeems the token once", async () => {
    const res = await call("POST", "/api/invitations/redeem", { body: { token: liveToken } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.redirectTo).toContain(liveInvId);
  });

  it("rejects a second redeem (single-use)", async () => {
    const res = await call("POST", "/api/invitations/redeem", { body: { token: liveToken } });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("already_redeemed");
  });

  it("reports already_redeemed on a post-redeem check", async () => {
    const res = await call("GET", `/api/invitations/check?token=${encodeURIComponent(liveToken)}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe("already_redeemed");
  });

  it("404s an unknown token", async () => {
    const res = await call("POST", "/api/invitations/redeem", { body: { token: "deadbeef".repeat(8) } });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
  });
});
