/**
 * W-AVI64 FIX 2 — an investor can DM the founder who invited them.
 *
 * Root cause: GET /api/messages/recipients enumerated DM candidates with a flat
 * `SELECT id,email,name FROM auth_users LIMIT 200` scan. messagingPolicy.canDM
 * fails CLOSED unless it can prove a real relationship, so an investor viewing
 * an arbitrary auth_users slice never reliably included the founder who invited
 * them → every candidate was denied → "No eligible contacts".
 *
 * The fix (v2546Routes.listDmCandidates) UNIONs the viewer's REAL counterparties
 * onto the base scan: for an investor it resolves the round_invitations they were
 * invited on (email-keyed) → the owning company → the founder owner, and also
 * adds the invitation's invited_by_user_id directly. Every candidate is STILL
 * gated through canDM (the fail-closed permission check is unchanged — we only
 * widen the pool). canDM itself is NOT weakened.
 *
 * This test drives the REAL routes end-to-end: a founder issues a round
 * invitation, the investor redeems it (becoming a registered investor), then the
 * investor's /api/messages/recipients MUST include that founder.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { createRound } from "../roundsStore";

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
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function makeFounderWithCompany(tag: string): { userId: string; companyId: string } {
  const { userId } = registerFounderUser({
    email: `wavi64dm_${tag}_${Date.now()}@founder.example`,
    name: `WAVI64 ${tag}`,
    password: "testpassword123",
  });
  const companyId = `co_wavi64dm_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: `WAVI64 ${tag} Corp`,
    legalName: `WAVI64 ${tag} Corp, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: {
      capTableHolders: 0,
      activeRoundsCount: 0,
      raisedThisYearUsd: 0,
      dataroomFiles: 0,
      pendingSoftCircles: 0,
      ownershipPct: 1.0,
    },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Pre-Seed",
    hq: "US",
  } as any);
  return { userId, companyId };
}

describe("W-AVI64 FIX 2: invited investor sees the inviting founder in DM recipients", () => {
  it("the founder who issued the round invitation is an eligible DM recipient for the investor", async () => {
    const { userId: founder, companyId } = makeFounderWithCompany("invite");
    const round = createRound({ companyId, name: "WAVI64 Seed", type: "SAFE", state: "open" });

    const inviteeEmail = `wavi64dm_investor_${Date.now()}@investor.example`;
    const issued = await call("POST", `/api/rounds/${round.id}/invitations/issue`, {
      userId: founder,
      body: { inviteeEmail, inviteeName: "Invited Investor" },
    });
    expect(issued.status).toBe(200);
    const token = issued.body?.tokenForEmail as string;
    expect(typeof token).toBe("string");

    const redeemed = await call("POST", "/api/invitations/redeem", { body: { token } });
    expect(redeemed.status).toBe(200);
    const investorId = redeemed.body?.ctx?.userId as string;
    expect(typeof investorId).toBe("string");
    expect(investorId.length).toBeGreaterThan(0);

    // The fix under test: the investor's eligible-recipient set must include the
    // founder who invited them (previously empty → "No eligible contacts").
    const recips = await call("GET", "/api/messages/recipients", { userId: investorId });
    expect(recips.status).toBe(200);
    expect(Array.isArray(recips.body?.recipients)).toBe(true);
    const ids = (recips.body.recipients as Array<{ userId: string }>).map((r) => r.userId);
    expect(ids).toContain(founder);
  });

  it("still fail-closed: an anonymous caller gets 401 (canDM is not weakened)", async () => {
    // TRIAGE (c) ENVIRONMENTAL. `vitest.config.ts` pins NODE_ENV=test, and
    // userContext.resolvePersonaIdWithFallback (:518-531) then maps a
    // header-less request onto demo persona `u_aisha_patel` so the sandbox can
    // be browsed without logging in. That persona is fully authed, so
    // requireAuth admitted it and the handler answered 200 with that persona's
    // own recipient list — the anonymous path was never actually exercised.
    // Production disables the fallback via NODE_ENV=production OR
    // DISABLE_DEV_BYPASS=1 (:523-525), where this route does return 401.
    //
    // Setting the same switch production uses makes this test assert the
    // PRODUCTION contract. The assertion itself is unchanged (still 401); only
    // the environment is corrected. Scoped to this test — the sibling test
    // needs the x-user-id header, which resolvePersonaId (:485) also gates on
    // `!bypassDisabled`, so setting it file-wide would break that test.
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const recips = await call("GET", "/api/messages/recipients");
      expect(recips.status).toBe(401);
    } finally {
      delete process.env.DISABLE_DEV_BYPASS;
    }
  });
});
