/**
 * v25.52 Track 2.6 / BUG P-1 — Private Portfolio list route-shadow regression.
 *
 * ROOT CAUSE: `GET /api/partner/me/portfolio` had TWO handlers on the SAME path:
 *   (a) partnerConsortiumRoutes.ts — C4 "sourced founders" list  → { founders }
 *   (b) partnerRoutes.ts          — Private Portfolio profiles list → { portfolio }
 * In production `server/routes.ts` registers (a) BEFORE (b), so (a) SHADOWED (b):
 * the Private Portfolio list rendered BLANK on live even though data was saved
 * (the /portfolio/:companyId detail route, owned by (b), still worked).
 *
 * The prior test (v25_50_partner_wave.test.ts) registered ONLY partnerRoutes, so
 * it never reproduced the collision — a Tier-6 false-green. This test registers
 * BOTH route sets in the REAL production order (consortium first, then partner)
 * so the shadow WOULD be caught if it regressed.
 *
 * FIX: the C4 list was moved to `GET /api/partner/me/sourced-founders`, leaving
 * `/api/partner/me/portfolio` owned solely by the Private Portfolio handler.
 * Both features are preserved (Rule #78).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerConsortiumRoutes } from "../partnerConsortiumRoutes";
import { seedTestPartnerSandbox, TEST_PARTNER_USERS } from "../partnerWorkspaceStore";

const MANAGING = TEST_PARTNER_USERS.managing.userId;

let app: express.Express;

function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  // REAL production registration order (matches server/routes.ts:793 then :801):
  // consortium routes FIRST, then partner routes. This is what created the shadow.
  registerPartnerConsortiumRoutes(app);
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("v25.52 P-1 — /api/partner/me/portfolio is the Private Portfolio (not shadowed)", () => {
  const companyId = "co_p1_shadow_test";

  it("saves a Private Portfolio profile then LISTS it at /portfolio (returns { portfolio })", async () => {
    const up = await patch(`/api/partner/me/portfolio/${companyId}`, MANAGING, {
      legal: { legalEntityName: "Shadow Test Holdings" },
    });
    expect(up.status).toBe(200);

    const list = await get("/api/partner/me/portfolio", MANAGING);
    expect(list.status).toBe(200);
    // The Private Portfolio handler returns { portfolio: [...] }. If the C4
    // sourced-founders handler ({ founders }) were shadowing this path again,
    // `portfolio` would be undefined and this assertion would fail.
    expect(Array.isArray(list.body.portfolio)).toBe(true);
    expect(list.body.founders).toBeUndefined();
    expect(list.body.portfolio.some((p: { companyId: string }) => p.companyId === companyId)).toBe(true);
  });

  it("exposes the C4 sourced-founders list at its OWN path (returns { founders })", async () => {
    const r = await get("/api/partner/me/sourced-founders", MANAGING);
    expect(r.status).toBe(200);
    // C4 handler returns { founders: [...] } — present and distinct from /portfolio.
    expect(Array.isArray(r.body.founders)).toBe(true);
    expect(r.body.portfolio).toBeUndefined();
  });

  it("no longer serves the C4 shape on the /portfolio path (shadow is gone)", async () => {
    const r = await get("/api/partner/me/portfolio", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.founders).toBeUndefined();
    expect(r.body.portfolio).toBeDefined();
  });
});
