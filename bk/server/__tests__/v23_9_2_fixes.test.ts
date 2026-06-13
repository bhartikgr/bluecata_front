/**
 * v23.9.2 — A1 (AV-04 / AV-05) investor-onboarding: modern-store redeem bridge.
 *
 * v23.9.1 unblocked the auth + CSRF gates so anonymous POST /api/invitations/redeem
 * reaches its handler. But the handler at routes.ts:1367 only consulted the legacy
 * in-memory `invitationStore`. Invitations created by the canonical founder flow
 * (POST /api/rounds/:id/invitations) live in the DB-backed `roundInvitationsStore`,
 * so every legitimately issued token returned 404 not_found.
 *
 * v23.9.2 mirrors the L-009 v23.4.13 bridge pattern (routes.ts:747) inside the
 * /api/invitations/redeem handler: legacy store first, then findByTokenHash() on
 * the modern store; on a modern hit it mints the investor via registerPersona and
 * marks the invitation redeemed.
 *
 * This suite drives the WHOLE flow over real HTTP:
 *   1. Founder creates a round            → POST /api/rounds
 *   2. Founder creates an invitation       → POST /api/rounds/:id/invitations (redeemUrl)
 *   3. Anonymous redeem of that token      → 200 ok:true (NOT 404 not_found)
 *   4. Investor logs in with the password  → 200 ok:true
 *   5. Re-redeem of the same token         → 409 already_redeemed
 *
 * The redeem call sends NO identity header — it is anonymous, the token IS the
 * credential. The founder calls use installV14TestIdentity (admin) so the
 * ownership check passes without needing seeded founder personas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { applyRouteGuards } from "../lib/applyRouteGuards";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  // Mirror server/index.ts so the global guard + CSRF mount are exercised.
  applyRouteGuards(app);
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
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
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

/** The redeemUrl shape is `<baseUrl>/invite/<rawToken>` (64-char hex). */
function tokenFromRedeemUrl(redeemUrl: string): string {
  const parts = redeemUrl.split("/invite/");
  if (parts.length !== 2) throw new Error(`Unexpected redeemUrl shape: ${redeemUrl}`);
  return decodeURIComponent(parts[1]);
}

// Founder/admin identity for the creation calls. `u_admin` is a real seeded
// admin persona (resolved by the VITEST x-user-id header path), so requireAuth
// sees an authenticated admin and the founder-ownership check is bypassed for
// any company id. A synthetic id like "u_admin_test" would NOT resolve to a
// real persona and getUserContextForId() would yield an unauthenticated ctx.
const FOUNDER_HEADERS = { "x-user-id": "u_admin" };

async function createRoundAndInvitation(
  email: string,
  name: string,
): Promise<{ token: string; roundId: string; invitationId: string }> {
  const companyId = `co_v2392_${Date.now()}`;
  const round = await call("POST", "/api/rounds", {
    headers: FOUNDER_HEADERS,
    body: { companyId, name: "v23.9.2 Seed", type: "seed", targetAmount: 1_000_000 },
  });
  expect(round.status).toBe(200);
  expect(round.body.ok).toBe(true);
  const roundId = round.body.id as string;
  expect(roundId).toBeTruthy();

  const inv = await call("POST", `/api/rounds/${roundId}/invitations`, {
    headers: FOUNDER_HEADERS,
    body: { investorEmail: email, investorName: name },
  });
  expect(inv.status).toBe(200);
  expect(inv.body.ok).toBe(true);
  expect(inv.body.redeemUrl).toMatch(/\/invite\/[a-f0-9]{64}$/);
  const token = tokenFromRedeemUrl(inv.body.redeemUrl);
  return { token, roundId, invitationId: inv.body.invitation.id };
}

describe("v23.9.2 A1 — modern (roundInvitationsStore) tokens redeem end-to-end", () => {
  it("anonymous redeem of a founder-created invitation → 200 ok:true (NOT 404)", async () => {
    const email = `v2392_redeem_${Date.now()}@test.example`;
    const { token, roundId, invitationId } = await createRoundAndInvitation(email, "V2392 Investor");

    const r = await call("POST", "/api/invitations/redeem", {
      body: { token, password: "SecurePass!1" },
    });
    expect(r.status).not.toBe(401);
    expect(r.status).not.toBe(404);
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.invitationId).toBe(invitationId);
    expect(r.body?.roundId).toBe(roundId);
    // A real investor account was minted + authenticated.
    expect(r.body?.ctx?.userId).toMatch(/^u_redeemed_/);
    expect(r.body?.ctx?.isAuthed).toBe(true);
  });

  it("the redeemed investor can log in with the password they set → 200", async () => {
    const email = `v2392_login_${Date.now()}@test.example`;
    const { token } = await createRoundAndInvitation(email, "V2392 Login");

    const redeem = await call("POST", "/api/invitations/redeem", {
      body: { token, password: "MyChosenPw!9" },
    });
    expect(redeem.status).toBe(200);
    expect(redeem.body?.ok).toBe(true);

    const login = await call("POST", "/api/auth/login", {
      body: { email, password: "MyChosenPw!9" },
    });
    expect(login.status).toBe(200);
    expect(login.body?.ok).toBe(true);
    expect(login.body?.ctx?.identity?.email?.toLowerCase()).toBe(email.toLowerCase());
  });

  it("re-redeeming the same modern token → 409 already_redeemed", async () => {
    const email = `v2392_reuse_${Date.now()}@test.example`;
    const { token } = await createRoundAndInvitation(email, "V2392 Reuse");

    const first = await call("POST", "/api/invitations/redeem", {
      body: { token, password: "SecurePass!2" },
    });
    expect(first.status).toBe(200);

    const second = await call("POST", "/api/invitations/redeem", {
      body: { token, password: "SecurePass!2" },
    });
    expect(second.status).toBe(409);
    expect(second.body?.ok).toBe(false);
    expect(second.body?.reason).toBe("already_redeemed");
  });

  it("a bogus token still returns 404 not_found (neither store has it)", async () => {
    const r = await call("POST", "/api/invitations/redeem", {
      body: { token: "f".repeat(64) },
    });
    expect(r.status).not.toBe(401);
    expect(r.status).toBe(404);
    expect(r.body?.reason).toBe("not_found");
  });
});
