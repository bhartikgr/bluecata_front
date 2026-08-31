/**
 * WAVE 179 · ITEM A · R151.1 — "CREATE SPV FOR THIS MANAGED CLIENT", SERVER SIDE.
 *
 * ── WHAT WAS ACTUALLY MISSING ────────────────────────────────────────────────
 * Wave 178 recorded that the backend "already persists `targetCompanyId`". That
 * claim was re-verified this wave and is TRUE: the column is
 * `spv.target_company_id` (db/connection.ts:5200, SACRED), it is written by
 * `persistSpv` (spvEngineStore.ts:384-399) and read back by the row mapper
 * (:5018), and it is rendered live on the SPV detail Overview tab
 * (SpvDetailTabs.tsx, `spv-detail-target-company-id`).
 *
 * What did NOT exist was (a) any way for a GP to set it from a managed-client
 * page, and (b) ANY CHECK THAT THE COMPANY IS ACTUALLY THEIR CLIENT. Both create
 * routes accepted an arbitrary `targetCompanyId` string and persisted it, so a
 * partner could attribute a vehicle to a company managed by a rival firm. That is
 * the fence this file pins.
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   0 · Precondition: partner A manages CO_A, partner B manages CO_B, and A does
 *       NOT manage CO_B. Asserted, so no later pole can pass vacuously.
 *   1 · A creates an SPV attributed to its OWN client → 201 and the persisted
 *       row carries `target_company_id = CO_A`. Read from SQL, not the response.
 *   2 · DB READ-BACK, the refetch a real page performs: the new
 *       `GET /api/partner/me/clients/:id/spvs` lists the vehicle. This is the
 *       proof the client page is not showing optimistic UI.
 *   3 · THE FENCE — A attributes to CO_B (partner B's client) → refused, and
 *       NOTHING is persisted. A partner must never be able to point a vehicle at
 *       a company it does not manage.
 *   4 · The fence does not over-fire: omitting `targetCompanyId` still creates a
 *       normal unattributed vehicle (`target_company_id IS NULL`).
 *   5 · The read-back route is fail-CLOSED: A asking for CO_B's vehicles is a
 *       404, not an empty list and not partner B's data.
 *   6 · ANTI-VACUITY for pole 3: the refusal is proved to come from the FENCE and
 *       not from generic validation, by showing the SAME body with A's own
 *       company id succeeds (pole 1) and that the refusal names the fence.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { SPV_TARGET_COMPANY_NOT_YOURS } from "../lib/partnerCompanyLinkGate";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";
const PARTNER_B = "ac_consortium_partner_w179_other_firm";
const CO_A = "co_w179_client_of_a";
const CO_B = "co_w179_client_of_b";

let app: express.Express;

/** The body the legacy create route requires (partnerRoutes.ts:2230-2246). */
function createBody(name: string, targetCompanyId?: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    spvName: name,
    jurisdiction: "delaware",
    vintage: 2026,
    currency: "USD",
    status: "planned",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  };
  if (targetCompanyId !== undefined) body.targetCompanyId = targetCompanyId;
  return body;
}

function spvRow(id: string): { target_company_id: string | null } | undefined {
  return rawDb()
    .prepare(`SELECT target_company_id FROM spv WHERE id = ?`)
    .get(id) as { target_company_id: string | null } | undefined;
}

function countAttributedTo(companyId: string): number {
  const r = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM spv WHERE target_company_id = ?`)
    .get(companyId) as { n: number };
  return r.n;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
  partnerAttributionStore.create(PARTNER_A, CO_A, ACTOR_A);
  partnerAttributionStore.create(PARTNER_B, CO_B, "u_w179_other_actor");
});

describe("WAVE 179 · ITEM A — SPV attribution to a MANAGED client", () => {
  it("POLE 0 — precondition: A manages CO_A, B manages CO_B, and A does NOT manage CO_B", () => {
    const aClients = partnerAttributionStore.listByPartner(PARTNER_A).map((r: { companyId: string }) => r.companyId);
    expect(aClients).toContain(CO_A);
    expect(aClients).not.toContain(CO_B);
    const bClients = partnerAttributionStore.listByPartner(PARTNER_B).map((r: { companyId: string }) => r.companyId);
    expect(bClients).toContain(CO_B);
  });

  it("POLE 1 — A creates an SPV for its OWN client: 201 and target_company_id is PERSISTED", async () => {
    const res = await request(app)
      .post("/api/partner/me/spvs")
      .set("x-user-id", ACTOR_A)
      .send(createBody("W179 Own Client Vehicle", CO_A));
    expect(res.status).toBe(201);
    const id = res.body.spv?.id as string;
    expect(id).toBeTruthy();
    /* Read from SQL, NOT from the response body: the response could echo an id it
       never wrote. */
    expect(spvRow(id)?.target_company_id).toBe(CO_A);
  });

  it("POLE 2 — DB READ-BACK: the managed-client page's own route lists the vehicle after a fresh request", async () => {
    const res = await request(app)
      .get(`/api/partner/me/clients/${CO_A}/spvs`)
      .set("x-user-id", ACTOR_A);
    expect(res.status).toBe(200);
    expect(res.body.companyId).toBe(CO_A);
    const names = (res.body.spvs as Array<{ name: string; targetCompanyId: string | null }>).map((s) => s.name);
    expect(names).toContain("W179 Own Client Vehicle");
    /* Every row this route returns really is attributed to this client. */
    for (const s of res.body.spvs as Array<{ targetCompanyId: string | null }>) {
      expect(s.targetCompanyId).toBe(CO_A);
    }
  });

  it("POLE 3 — THE FENCE: A cannot attribute an SPV to partner B's client, and nothing is written", async () => {
    const before = countAttributedTo(CO_B);
    const res = await request(app)
      .post("/api/partner/me/spvs")
      .set("x-user-id", ACTOR_A)
      .send(createBody("W179 Rival Client Vehicle", CO_B));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe(SPV_TARGET_COMPANY_NOT_YOURS);
    /* The refusal must be a refusal, not a warning next to a completed write. */
    expect(countAttributedTo(CO_B)).toBe(before);
    const leaked = rawDb()
      .prepare(`SELECT id FROM spv WHERE name = ?`)
      .get("W179 Rival Client Vehicle");
    expect(leaked).toBeUndefined();
  });

  it("POLE 4 — the fence does not over-fire: an UNATTRIBUTED vehicle still creates normally", async () => {
    const res = await request(app)
      .post("/api/partner/me/spvs")
      .set("x-user-id", ACTOR_A)
      .send(createBody("W179 Unattributed Vehicle"));
    expect(res.status).toBe(201);
    const id = res.body.spv?.id as string;
    expect(spvRow(id)?.target_company_id).toBeNull();
  });

  it("POLE 5 — the read-back route is FAIL-CLOSED: A asking for B's client is 404, not an empty list", async () => {
    const res = await request(app)
      .get(`/api/partner/me/clients/${CO_B}/spvs`)
      .set("x-user-id", ACTOR_A);
    expect(res.status).toBe(404);
    expect(res.body.spvs).toBeUndefined();
  });

  it("POLE 6 — ANTI-VACUITY: pole 3 fails on the FENCE, not on validation — the body differs only in the company id", async () => {
    /* Identical body, own client id: succeeds. So the 404 in pole 3 cannot be
       explained by a malformed payload. */
    const ok = await request(app)
      .post("/api/partner/me/spvs")
      .set("x-user-id", ACTOR_A)
      .send(createBody("W179 Anti Vacuity Vehicle", CO_A));
    expect(ok.status).toBe(201);
    const bad = await request(app)
      .post("/api/partner/me/spvs")
      .set("x-user-id", ACTOR_A)
      .send(createBody("W179 Anti Vacuity Vehicle 2", CO_B));
    expect(bad.status).toBe(404);
    expect(bad.body.message).toBeTruthy();
    /* And the refusal never names the rival firm or the rival client back to the
       caller beyond the id they themselves supplied. */
    expect(String(bad.body.message)).not.toContain(PARTNER_B);
  });
});
