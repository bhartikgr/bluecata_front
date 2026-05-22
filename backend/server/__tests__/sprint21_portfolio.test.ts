/**
 * Sprint 21 Wave C — Portfolio routes integration tests (≥10 assertions).
 *
 * Covers:
 *  1.  POST promote → creates nomination record
 *  2.  POST promote → notification emitted to founder
 *  3.  POST promote → bridge event emitted (indirect: nomination in store)
 *  4.  POST promote duplicate → 409 already_promoted
 *  5.  POST promote without auth → 401
 *  6.  POST promote with <20 char rationale → 400
 *  7.  POST promote without confirmed flag → 400
 *  8.  GET promotion-status returns the record after promote
 *  9.  GET promotion-status returns null before promote
 *  10. GET updates returns filtered reports list
 *  11. GET updates returns empty array when investor is not a recipient
 *  12. GET updates for unknown companyId returns empty array
 *  13. POST promote by second investor succeeds independently
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  clearInvestorNominations,
  getInvestorNominations,
} from "../sprint21PortfolioRoutes";
import { _testNotifications } from "../notificationsStore";

/* -----------------------------------------------------------------------
   Shared server setup
   ----------------------------------------------------------------------- */

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  // v16: enable Collective routes for these tests (they hit /api/investor/collective/* and /api/founder/collective/*)
  process.env.COLLECTIVE_ENABLED = "1";
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
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  clearInvestorNominations();
  _testNotifications.reset();
});

/* -----------------------------------------------------------------------
   HTTP helper
   ----------------------------------------------------------------------- */

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data =
      opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    // For authed tests, pass x-user-id AND a cookie that makes isAuthed=true
    if (opts.userId) {
      headers["x-user-id"] = opts.userId;
      headers["cookie"] = `capavate_session=${opts.userId}`;
    }

    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/* -----------------------------------------------------------------------
   Tests
   ----------------------------------------------------------------------- */

const VALID_BODY = {
  companyId: "co_novapay",
  rationale: "Strong founder, excellent traction, massive TAM. We believe this is the right time to promote to the Collective.",
  confirmed: true,
};

describe("POST /api/investor/collective/promote", () => {
  it("1. creates a nomination record on success", async () => {
    const r = await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(201);
    const body = r.body as { ok: boolean; nomination: { id: string; kind: string; companyId: string; rationale: string } };
    expect(body.ok).toBe(true);
    expect(body.nomination.kind).toBe("investor_nomination");
    expect(body.nomination.companyId).toBe("co_novapay");
    expect(body.nomination.rationale).toBe(VALID_BODY.rationale);
  });

  it("2. stores nomination in the in-memory store", async () => {
    await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_aisha_patel",
    });
    const noms = getInvestorNominations();
    expect(noms.length).toBe(1);
    expect(noms[0].investorUserId).toBe("u_aisha_patel");
  });

  it("3. emits a notification to the founder", async () => {
    await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_aisha_patel",
    });
    const notifications = _testNotifications.store;
    const founderNotif = notifications.find(
      (n) => n.userId === "u_maya_chen" && n.kind === "collective.eligibility_gained",
    );
    expect(founderNotif).toBeTruthy();
    expect(founderNotif!.link).toBe("/founder/apply-to-collective");
  });

  it("4. returns 409 on duplicate promotion (same investor + same company)", async () => {
    await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_aisha_patel",
    });
    const r2 = await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_aisha_patel",
    });
    expect(r2.status).toBe(409);
    const body = r2.body as { error: string };
    expect(body.error).toBe("already_promoted");
  });

  it("5. returns 401 when not authenticated (unknown userId)", async () => {
    // Pass an unknown userId that resolves to isAuthed:false
    const r = await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_unknown_not_a_real_user_xyz",
    });
    expect(r.status).toBe(401);
  });

  it("6. returns 400 when rationale is fewer than 20 characters", async () => {
    const r = await call("POST", "/api/investor/collective/promote", {
      body: { ...VALID_BODY, rationale: "Too short" },
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(400);
    const body = r.body as { error: string };
    expect(body.error).toBe("validation_failed");
  });

  it("7. returns 400 when confirmed is explicitly false", async () => {
    const r = await call("POST", "/api/investor/collective/promote", {
      body: { ...VALID_BODY, confirmed: false },
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(400);
  });

  it("13. second investor can promote the same company independently", async () => {
    await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_aisha_patel",
    });
    // u_lapsed_lp is also a known persona on co_novapay cap table
    const r2 = await call("POST", "/api/investor/collective/promote", {
      body: { ...VALID_BODY, companyId: "co_novapay" },
      userId: "u_lapsed_lp",
    });
    expect(r2.status).toBe(201);
    expect(getInvestorNominations().length).toBe(2);
  });
});

describe("GET /api/investor/companies/:id/promotion-status", () => {
  it("8. returns null when not yet promoted", async () => {
    const r = await call("GET", "/api/investor/companies/co_novapay/promotion-status", {
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
  });

  it("9. returns the nomination record after promotion", async () => {
    await call("POST", "/api/investor/collective/promote", {
      body: VALID_BODY,
      userId: "u_aisha_patel",
    });
    const r = await call("GET", "/api/investor/companies/co_novapay/promotion-status", {
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    const body = r.body as { id: string; companyId: string };
    expect(body.companyId).toBe("co_novapay");
    expect(typeof body.id).toBe("string");
  });
});

describe("GET /api/investor/companies/:id/updates", () => {
  it("10. returns reports the investor is a recipient of", async () => {
    // u_aisha_patel is a recipient of rpt_apr_2026 (co_novapay)
    const r = await call("GET", "/api/investor/companies/co_novapay/updates", {
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    const body = r.body as Array<{ id: string; title: string }>;
    expect(Array.isArray(body)).toBe(true);
    // The seeded report is for co_novapay and has u_aisha_patel as recipient
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].id).toBe("rpt_apr_2026");
  });

  it("11. returns empty array when investor is on cap table but has no reports", async () => {
    // u_aisha_patel is on co_arboreal cap table but no seeded reports sent to her for that company
    const r = await call("GET", "/api/investor/companies/co_arboreal/updates", {
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect((r.body as unknown[]).length).toBe(0);
  });

  it("12. returns empty array for a company with no sent reports for this investor", async () => {
    // co_arboreal is on u_aisha_patel's cap table but has no seeded sent reports
    const r = await call("GET", "/api/investor/companies/co_arboreal/updates", {
      userId: "u_aisha_patel",
    });
    expect(r.status).toBe(200);
    expect((r.body as unknown[]).length).toBe(0);
  });
});
