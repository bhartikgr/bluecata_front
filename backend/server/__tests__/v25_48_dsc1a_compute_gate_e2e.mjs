/**
 * v25.48 DSC-1a — the compute/score gate ALSO accepts a dsc_roles-granted DSC
 * member (isDscMember), matching the vote route. A granted DSC member can now
 * BOTH vote and compute/score. userContext.ts (Sacred) is NOT edited.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, closeApp, call } from "./v25_48_helpers.mjs";
import { _addDscMemberForTests, _resetForTests } from "../adminDscRoutes.ts";

let ctx;
beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  ctx = await buildApp();
}, 30_000);
afterAll(async () => { await closeApp(ctx.server); });

describe("v25.48 DSC-1a compute/score gate accepts granted DSC members", () => {
  it("a non-DSC, non-admin investor is FORBIDDEN from compute (403)", async () => {
    const res = await call(ctx.port, "POST", "/api/collective/dsc/compute/co_novapay", {
      userId: "u_no_position",
      headers: { "x-confirm": "true" },
      body: {},
    });
    expect(res.status).toBe(403);
  });

  it("a dsc_roles-granted member passes the gate (not 403 forbidden)", async () => {
    _resetForTests();
    _addDscMemberForTests("u_aisha_patel"); // grant DSC role in the in-memory dsc_roles registry
    const res = await call(ctx.port, "POST", "/api/collective/dsc/compute/co_novapay", {
      userId: "u_aisha_patel",
      headers: { "x-confirm": "true" },
      body: {},
    });
    // The DSC gate must let them through. Downstream may return 422
    // no_readiness_data for a company with no readiness data — that PROVES the
    // gate passed (a 403 would mean the gate rejected them).
    expect(res.status).not.toBe(403);
    expect([200, 422]).toContain(res.status);
  });

  it("admin still passes the compute gate", async () => {
    const res = await call(ctx.port, "POST", "/api/collective/dsc/compute/co_novapay", {
      as: "admin",
      headers: { "x-confirm": "true" },
      body: {},
    });
    expect(res.status).not.toBe(403);
  });
});
