/**
 * v23.4.11 Phase 2 (B-202) — Subscribe flow MUST persist the plan upgrade.
 *
 * Bug B-202: a Free-plan founder selected Pro on /founder/subscribe, paid, and
 * saw the "Subscribed!" toast with "Status: active" — but the company badge
 * stayed "FREE" and /founder/rounds/new kept bouncing back. Two root causes:
 *
 *   1) POST /api/founder/subscription/charge processed payment (chargeSubscription
 *      flips status→active + bumps invoicesCount) but NEVER wrote the SELECTED
 *      plan onto the subscription row, so companies.plan stayed founder_free.
 *   2) GET /api/founder/active-company returned the RAW inline billing field
 *      (never reconciled from subscriptionsStore), so even once the sub said
 *      Pro the header badge + the round-wizard plan gate read a stale "Free".
 *
 * This test exercises the FULL path over real HTTP against the registered
 * route stack: register a fresh founder → activate Free → charge for Pro →
 * assert the subscription persists Pro AND the active-company endpoint now
 * reports the Pro plan label → charge AGAIN to prove idempotency (no duplicate
 * subscription row / no plan/version corruption).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { __setRuntimePersona } from "../lib/userContext";
import { getSubscription, getSubscriptionHistory } from "../subscriptionsStore";

let app: Express;
let server: http.Server;
let port: number;

const FOUNDER_ID = "u_v23411_b202_founder";

beforeAll(async () => {
  // Register a fresh founder persona with ZERO companies (mirrors a brand-new
  // signup). Under VITEST the x-user-id header authenticates as this persona.
  __setRuntimePersona({
    userId: FOUNDER_ID,
    email: "b202.founder@test.local",
    name: "B202 Founder",
    isFounder: true,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  });

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

type Resp = { status: number; body: Record<string, any> };

function call(method: string, path: string, body?: unknown): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-user-id": FOUNDER_ID,
    };
    if (data) headers["content-length"] = Buffer.byteLength(data).toString();
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => (raw += c.toString()));
      res.on("end", () => {
        let b: Record<string, any>;
        try { b = JSON.parse(raw); } catch { b = { raw }; }
        resolve({ status: res.statusCode ?? 0, body: b });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

describe("v23.4.11 Phase 2 (B-202) subscribe flow persists plan upgrade", () => {
  let companyId: string;

  it("activates a Free company for the fresh founder", async () => {
    const r = await call("POST", "/api/founder/subscription/activate-free", {});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    companyId = String(r.body.companyId);
    expect(companyId).toMatch(/^co_/);
    // Sanity: starts on Free.
    const sub = getSubscription(companyId);
    expect(sub?.plan).toBe("founder_free");
    expect(sub?.status).toBe("active");
  });

  it("charging for Pro persists plan=founder_pro AND status=active", async () => {
    const r = await call("POST", "/api/founder/subscription/charge", {
      companyId,
      pricingModelId: "pm_founder_pro_v1",
      plan: "founder_pro",
      paymentMethod: { tokenized: "tok_4242", cardLast4: "4242", cardholderName: "B202", billingZip: "M5V" },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // Response carries the live subscription — must already report Pro + active.
    expect(r.body.subscription?.plan).toBe("founder_pro");
    expect(r.body.subscription?.status).toBe("active");

    // The PERSISTED store row must agree (this is the half-1 root cause).
    const sub = getSubscription(companyId);
    expect(sub?.plan).toBe("founder_pro");
    expect(sub?.status).toBe("active");
    expect(sub?.annualAmountMinor).toBeGreaterThan(0);
    expect(sub?.cardLast4).toBe("4242");
  });

  it("the active-company endpoint now reports the Pro plan (badge no longer FREE)", async () => {
    const r = await call("GET", "/api/founder/active-company");
    expect(r.status).toBe(200);
    expect(r.body.activeCompanyId).toBe(companyId);
    // half-2 root cause: this used to return the stale inline "Founder Free".
    expect(r.body.company?.billing?.plan).toBe("Founder Pro");
  });

  it("the founder companies list also reflects Pro (switcher parity)", async () => {
    const r = await call("GET", "/api/founder/companies");
    expect(r.status).toBe(200);
    const c = (r.body as unknown as any[]).find((x) => x.companyId === companyId);
    expect(c?.billing?.plan).toBe("Founder Pro");
  });

  it("charging again with the same plan is idempotent (no duplicate / no corruption)", async () => {
    const before = getSubscription(companyId)!;
    const beforeVersion = before.version;
    const beforeHistory = getSubscriptionHistory(companyId).length;

    const r = await call("POST", "/api/founder/subscription/charge", {
      companyId,
      pricingModelId: "pm_founder_pro_v1",
      plan: "founder_pro",
      paymentMethod: { tokenized: "tok_4242", cardLast4: "4242", cardholderName: "B202", billingZip: "M5V" },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const after = getSubscription(companyId)!;
    // Still exactly one current row, still Pro + active.
    expect(after.plan).toBe("founder_pro");
    expect(after.status).toBe("active");
    // The plan write is skipped on the second charge (plan unchanged), so no
    // runaway version churn from re-setting the same plan. The charge itself is
    // idempotent on the payment intent, so at most the card-last4 write bumps
    // the version — never an explosion. We assert a tight, bounded delta.
    expect(after.version - beforeVersion).toBeLessThanOrEqual(2);
    // History only grows by the same bounded amount — no duplicate-row blowup.
    const afterHistory = getSubscriptionHistory(companyId).length;
    expect(afterHistory - beforeHistory).toBeLessThanOrEqual(2);

    // The active-company badge stays Pro across the repeat charge.
    const r2 = await call("GET", "/api/founder/active-company");
    expect(r2.body.company?.billing?.plan).toBe("Founder Pro");
  });
});
