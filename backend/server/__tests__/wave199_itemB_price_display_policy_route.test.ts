/**
 * WAVE 199 · ITEM B · R173.6 — THE DISPLAY POLICY IS READABLE BY THE FRONTEND, AND
 * IT FOLLOWS THE ADMIN.
 *
 * THE OWNER'S WORDS: "In the admin area, I did not intend to set a monthly price.
 * The platform is annual and/or fixed only. Therefore there really should not be a
 * displayed as monthly. These are ALL 100% dynamic from the admin area and
 * dynamically updated/displayed in the frontend."
 *
 * THE GAP THIS ENDPOINT CLOSES. Wave 188 shipped the whole mechanism
 * (`partner_pricing_model_config`, `readBillingPeriodOffer()`, the admin switches),
 * but the ONLY reader was `GET /api/admin/billing-period-offer` — admin-only. So no
 * founder, partner or Collective surface could see the admin's decision, and every
 * monthly figure rendered regardless. `GET /api/price-display-policy` is the
 * read-only door that makes the display dynamic.
 *
 * WHAT IS ASSERTED
 *   B1 · a non-admin authenticated persona CAN read it (that is the entire point;
 *        an admin-only policy cannot drive a founder screen).
 *   B2 · the shipped state is reported: monthly not offered ⇒ monthlyDisplayAllowed
 *        false, annual offered true, and `forbidX12Derivation` surfaced so no caller
 *        divides an annual figure by twelve.
 *   B3 · BOTH POLES / THE CAPABILITY SURVIVES: switching monthly back ON through the
 *        wave-188 WRITER makes the endpoint report monthlyDisplayAllowed true. This
 *        is the proof that wave 199 suppressed a DISPLAY and did not delete monthly.
 *   B4 · no price, currency or cadence figure is invented by the endpoint — the
 *        payload carries the policy flags only, so nothing here can become a
 *        hardcoded price (R156.2).
 *
 * The state is restored after B3 so the test leaves the shipped policy as it found it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  readBillingPeriodOffer,
  writeBillingPeriodOffer,
} from "../lib/partnerFeeAdminDisplayPolicy";

let app: Express;
let server: http.Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 60_000);

/** A NON-admin persona: exactly the case wave 188 could not serve. */
const asFounder = (req: request.Test): request.Test =>
  req.set("x-test-user-id", "u_maya").query({ as: "founder" });

type PolicyBody = {
  ok?: boolean;
  policy?: {
    monthlyDisplayAllowed?: boolean;
    annualOffered?: boolean;
    monthlyOffered?: boolean;
    model?: string;
    forbidX12Derivation?: boolean;
  };
};

const SHIPPED = { monthly: false, annual: true };

afterAll(() => {
  /* Leave the platform's policy exactly as it was found. */
  try {
    writeBillingPeriodOffer({
      monthlyOffered: SHIPPED.monthly,
      annualOffered: SHIPPED.annual,
      actor: "u_admin",
    });
  } catch {
    /* restoration failure must not mask a real assertion above */
  }
});

describe("WAVE 199 · ITEM B — GET /api/price-display-policy", () => {
  it("B1 — a non-admin persona can read the policy", async () => {
    const r = await asFounder(request(app).get("/api/price-display-policy"));
    expect(r.status).toBe(200);
    const body = r.body as PolicyBody;
    expect(body.ok).toBe(true);
    expect(typeof body.policy?.monthlyDisplayAllowed).toBe("boolean");
  });

  it("B2 — it reports the SHIPPED state: monthly not offered, annual offered", async () => {
    /* Read the same authority the endpoint wraps, so the expectation is derived
       from the platform rather than retyped here. */
    const offer = readBillingPeriodOffer();
    const r = await asFounder(request(app).get("/api/price-display-policy"));
    const p = (r.body as PolicyBody).policy ?? {};
    expect(p.monthlyOffered).toBe(offer.monthlyOffered);
    expect(p.annualOffered).toBe(offer.annualOffered);
    expect(p.monthlyDisplayAllowed).toBe(offer.monthlyOffered);
    /* The shipped row really is annual-only — if it were not, B3's "both poles"
       claim would be about nothing. */
    expect(p.monthlyOffered).toBe(false);
    expect(p.annualOffered).toBe(true);
    expect(typeof p.forbidX12Derivation).toBe("boolean");
  });

  it("B3 — BOTH POLES: switching monthly back ON is reported, so the capability survives", async () => {
    writeBillingPeriodOffer({ monthlyOffered: true, annualOffered: true, actor: "u_admin" });
    const on = await asFounder(request(app).get("/api/price-display-policy"));
    expect((on.body as PolicyBody).policy?.monthlyDisplayAllowed).toBe(true);
    expect((on.body as PolicyBody).policy?.monthlyOffered).toBe(true);

    /* … and switching it off again is reported too: the endpoint tracks the admin,
       it does not latch. */
    writeBillingPeriodOffer({ monthlyOffered: false, annualOffered: true, actor: "u_admin" });
    const off = await asFounder(request(app).get("/api/price-display-policy"));
    expect((off.body as PolicyBody).policy?.monthlyDisplayAllowed).toBe(false);
  });

  it("B4 — the payload carries policy flags only: no price, currency or cadence figure", async () => {
    const r = await asFounder(request(app).get("/api/price-display-policy"));
    const serialized = JSON.stringify(r.body);
    /* No money-shaped value and no currency code can leak out of a display-policy
       door (R156.2 — nothing here may become a hardcoded price). */
    expect(/amountMinor|priceMinor|"USD"|"EUR"|\$\d/.test(serialized)).toBe(false);
  });
});
