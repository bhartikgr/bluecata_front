/**
 * WAVE 35 · F4 — the SECOND company-creation sink, over real HTTP.
 *
 * `server/routes.ts` `POST /api/founder/companies` calls
 * `addCompanyForFounder` just as `POST /api/founder/companies/new`
 * (multiCompanyStore) does. The brief named only one sink. Both are live
 * founder-facing company-creation paths, so a referral claim must be redeemed
 * on EITHER of them — the standing "hunt a SECOND path" rule.
 *
 * This file mounts the FULL `registerRoutes` stack and drives the route as a
 * real, test-owned founder identity (never anonymous, never a demo persona).
 * It asserts the row that lands in the authoritative `partner_attributions`
 * table, not a helper return value.
 *
 * BOTH POLES:
 *   • a founder WITH a stamped provisional claim gets the partner credited and
 *     the provisional row retired;
 *   • a founder with NO claim gets NO attribution (an "always attribute" fix
 *     fails here).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

const FOUNDER = "u_w35_f4_path2_founder";
const FOUNDER_NOREF = "u_w35_f4_path2_noref";
const PARTNER = "p_w35_f4_path2";
const STORE = "provisionalPartnerAttributions";

function ctxFor(userId: string, email: string) {
  return {
    isAuthed: true,
    userId,
    identity: { email, name: "W35 F4 Path2 Founder" },
    email,
    isAdmin: false,
    roles: ["founder"],
    founder: { companies: [], activeCompanyId: null },
    investor: { state: "NONE", capTablePositions: [], invitedRounds: [] },
    collective: { status: "none", role: null, expiresAt: null },
  };
}

let ACTIVE_CTX: any = ctxFor(FOUNDER, "path2@w35.test");

vi.mock("../lib/userContext", async () => {
  const actual = await vi.importActual<any>("../lib/userContext");
  return {
    ...actual,
    getUserContext: () => ACTIVE_CTX,
    getUserContextForId: () => ACTIVE_CTX,
  };
});

vi.mock("../lib/authMiddleware", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => {
      req.userContext = ACTIVE_CTX;
      next();
    },
  };
});

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => { port = (server.address() as any).port; resolve(); });
  });
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1", port, path, method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let parsed: any = buf;
          try { parsed = JSON.parse(buf); } catch { /* raw */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function attributionPartners(companyId: string): Promise<string[]> {
  const { rawDb } = await import("../db/connection");
  return ((rawDb() as any)
    .prepare(`SELECT partner_id FROM partner_attributions WHERE company_id = ? AND revoked_at IS NULL`)
    .all(companyId) as Array<{ partner_id: string }>).map((r) => r.partner_id);
}

describe("WAVE 35 F4 — POST /api/founder/companies is a second referral sink", () => {
  it("F4-P2-1: a stamped provisional claim is redeemed on this path and the row is retired", async () => {
    const { persistEntry, hydrateEntries } = await import("../lib/storePersistenceShim");
    const email = "path2@w35.test";
    const key = `${email}::${PARTNER}`;
    // Precondition established here: the post-signup state — stamped, live.
    persistEntry(STORE, key, {
      email,
      partnerId: PARTNER,
      promotionId: "promo_w35_path2",
      source: "partner_claim",
      founderUserId: FOUNDER,
      claimedAt: new Date().toISOString(),
    });
    expect(hydrateEntries<any>(STORE).some(([k]) => k === key)).toBe(true);

    ACTIVE_CTX = ctxFor(FOUNDER, email);
    const companyId = `co_w35f4p2_${Date.now().toString(36)}`;
    const res = await post("/api/founder/companies", { companyId, companyName: "W35 F4 Path2 Co" });
    expect(res.status).toBe(201);

    expect(await attributionPartners(companyId)).toContain(PARTNER);
    expect(hydrateEntries<any>(STORE).some(([k]) => k === key)).toBe(false);
  });

  it("F4-P2-2 (no over-fix): a founder with no referral claim gets no attribution", async () => {
    ACTIVE_CTX = ctxFor(FOUNDER_NOREF, "path2noref@w35.test");
    const companyId = `co_w35f4p2n_${Date.now().toString(36)}`;
    const res = await post("/api/founder/companies", { companyId, companyName: "W35 F4 Path2 Unreferred" });
    expect(res.status).toBe(201);
    expect(await attributionPartners(companyId)).toHaveLength(0);
  });
});
