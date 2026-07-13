/**
 * Wave B2 (3b) — dynamic SPV lifecycle + visibility, and company Make-Private.
 *
 * The Pipeline SPV row buckets each SPV into a column BY ITS status and lets the
 * partner change the status (which re-buckets the card) and flip the visibility
 * scope (private <-> collective_only). These are the exact endpoints the client
 * calls, so this proves the "item moves to the correct box automatically" and
 * the Make-Private / Publish-to-Collective behaviours end-to-end on the server.
 *
 * Also proves the COMPANY Make-Private path: promote-to-collective then withdraw.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;
function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}

async function createSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    spvName: name,
    name,
    jurisdiction: "delaware",
    vintage: 2025,
    currency: "USD",
    carryBasis: "whole_spv",
    status: "draft",
    signoffLegalName: "Test Managing Partner",
    signoffAccepted: true,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("Wave B2 (3b) — SPV auto-moves to the column matching its status", () => {
  it("changing an SPV's status is persisted, so the card re-buckets", async () => {
    const spvId = await createSpv("Lifecycle SPV");
    // Starts in draft.
    expect(spvEngineStore.getSpv(PARTNER_A, spvId)!.status).toBe("draft");

    // Advance draft -> open -> deployed; each PATCH persists the new status,
    // which is what drives the client to render the card under the new column.
    for (const next of ["open", "deployed"] as const) {
      const r = await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { status: next });
      expect(r.status).toBe(200);
      expect(spvEngineStore.getSpv(PARTNER_A, spvId)!.status).toBe(next);
    }
  });

  it("SPV Publish-to-Collective / Make-Private flips distribution scope instantly", async () => {
    const spvId = await createSpv("Scope SPV");
    // Publish to Collective.
    const pub = await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { distributionScope: "collective_only" });
    expect(pub.status).toBe(200);
    expect(spvEngineStore.getSpv(PARTNER_A, spvId)!.distributionScope).toBe("collective_only");

    // Make Private.
    const priv = await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { distributionScope: "private" });
    expect(priv.status).toBe(200);
    expect(spvEngineStore.getSpv(PARTNER_A, spvId)!.distributionScope).toBe("private");
  });

  it("cross-partner isolation: PATCH on another partner's SPV does not mutate it", async () => {
    const spvId = await createSpv("Isolated SPV");
    const r = await patch(`/api/partner/me/spv/${spvId}`, "u_stranger_not_partner", { status: "open" });
    // Not a partner member -> rejected (401/403); status unchanged.
    expect([401, 403]).toContain(r.status);
    expect(spvEngineStore.getSpv(PARTNER_A, spvId)!.status).toBe("draft");
  });

  it("rejects an out-of-enum SPV status (server integrity, not just UI)", async () => {
    const spvId = await createSpv("Bad Status SPV");
    const r = await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { status: "totally_invalid" });
    expect(r.status).toBe(400);
    // The persisted status is untouched.
    expect(spvEngineStore.getSpv(PARTNER_A, spvId)!.status).toBe("draft");
  });

  it("a DRAFT collective_only SPV is NOT discoverable; an OPEN one IS (draft-exclusion honored)", async () => {
    const spvId = await createSpv("Discovery SPV");
    // Flip to collective_only while still draft — scope set, but not discoverable.
    await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { distributionScope: "collective_only" });
    const draftVisible = spvEngineStore.listVisibleForContext("collective").some((s) => s.id === spvId);
    expect(draftVisible).toBe(false);

    // Move to open — now it becomes discoverable in the Collective context.
    await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { status: "open" });
    const openVisible = spvEngineStore.listVisibleForContext("collective").some((s) => s.id === spvId);
    expect(openVisible).toBe(true);

    // Make private — removed from discovery again.
    await patch(`/api/partner/me/spv/${spvId}`, MANAGING, { distributionScope: "private" });
    const privVisible = spvEngineStore.listVisibleForContext("collective").some((s) => s.id === spvId);
    expect(privVisible).toBe(false);
  });
});

describe("Wave B2 (3b) — company Publish/Make-Private + the on-Capavate invariant", () => {
  it("refuses to publish a bare name-only deal that is NOT a company on Capavate", async () => {
    // A plain pipeline deal has no linked Capavate company (no cap table/rounds).
    const deal = await post("/api/partner/me/pipeline", MANAGING, { dealName: "Name Only Co" });
    expect(deal.status).toBe(201);
    const dealId = deal.body.deal?.id ?? deal.body.id;
    const promo = await post(`/api/partner/me/pipeline/${dealId}/promote-to-collective`, MANAGING, {});
    expect(promo.status).toBe(409);
    expect(promo.body.error).toBe("COMPANY_NOT_ON_CAPAVATE");
  });

  it("publishes a real on-Capavate portfolio company, then withdraw makes it private", async () => {
    // The B1 "Add Portfolio Company" path creates a REAL Capavate company (cap
    // table + rounds operating) AND a pipeline deal linked by companyId.
    const created = await post("/api/partner/me/portfolio-companies", MANAGING, {
      companyName: "On-Capavate Co",
      founderEmail: "oncap-founder@example.com",
    });
    expect(created.status).toBe(201);
    const companyId = created.body.companyId as string;

    // Find the pipeline deal the B1 path created for this company.
    const pipe = await request(app).get("/api/partner/me/pipeline").set("x-user-id", MANAGING);
    expect(pipe.status).toBe(200);
    const deal = (pipe.body.pipeline as Array<{ id: string; companyId?: string | null }>).find((d) => d.companyId === companyId);
    expect(deal).toBeTruthy();

    // Publish to Collective now succeeds (company is on Capavate).
    const promo = await post(`/api/partner/me/pipeline/${deal!.id}/promote-to-collective`, MANAGING, {});
    expect([200, 201]).toContain(promo.status);
    const promoId = promo.body.promotion?.id;
    expect(promoId).toBeTruthy();
    // Created as pending_collective_review (reviewed flow), not instantly live.
    expect(promo.body.promotion.status).toBe("pending_collective_review");

    // Make Private = withdraw.
    const wd = await post(`/api/partner/me/promotions/${promoId}/withdraw`, MANAGING, {});
    expect(wd.status).toBe(200);
    expect(wd.body.promotion.status).toBe("withdrawn");
  });
});
