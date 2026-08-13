/**
 * WAVE 27 · CP-PIPE-04 — the pipeline activity log gets a read path.
 *
 * BEFORE: `partnerPipelineActivityStore.listForPipeline`
 * (`server/partnerWorkspaceStore.ts:2261`) had no route and no client caller
 * anywhere in the tree. The log was write-only in both directions — the POST
 * writer plus an automatic `stage_change` entry on every stage move
 * (`partnerWorkspaceStore.ts:2155`) accumulated deal history that nothing could
 * ever read back.
 *
 * The risky part of exposing it is NOT the read: it is that `listForPipeline`
 * filters on `pipelineId` alone and knows nothing about partners. A GET that
 * forgot the ownership lookup would hand any authenticated partner any other
 * partner's deal history for a guessed id. That is the pole this file leans on
 * hardest, and it is asserted with a REAL foreign deal (one that exists and has
 * activity), not a fabricated id — an id that does not exist would 404 even
 * from a broken route and would prove nothing.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";

const MANAGING = "u_avi_managing";

let app: express.Express;
const get = (path: string, user: string) => request(app).get(path).set("x-user-id", user);
const post = (path: string, user: string, body?: unknown) =>
  request(app).post(path).set("x-user-id", user).send(body ?? {});

async function createDeal(dealName: string): Promise<string> {
  const r = await post("/api/partner/me/pipeline", MANAGING, { dealName });
  expect([200, 201]).toContain(r.status);
  return (r.body.deal?.id ?? r.body.id) as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("WAVE 27 · CP-PIPE-04 — GET /api/partner/me/pipeline/:id/activities", () => {
  it("returns what the writer wrote — the read path is genuinely connected to the write path", async () => {
    const dealId = await createDeal("W27 PIPE04 roundtrip");

    // LOWER POLE: a deal with no manual activity must not invent any.
    const empty = await get(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING);
    expect(empty.status).toBe(200);
    expect(Array.isArray(empty.body.activities)).toBe(true);
    const baseline = empty.body.activities.length;

    const w1 = await post(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING, {
      activityType: "call",
      body: "Intro call with the founder",
    });
    expect(w1.status).toBe(201);
    const w2 = await post(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING, {
      activityType: "note",
      body: "Sent the data room link",
    });
    expect(w2.status).toBe(201);

    // UPPER POLE: exactly the two new entries are readable, with their content.
    const after = await get(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING);
    expect(after.status).toBe(200);
    expect(after.body.activities.length).toBe(baseline + 2);
    const bodies = after.body.activities.map((a: { body: string }) => a.body);
    expect(bodies).toContain("Intro call with the founder");
    expect(bodies).toContain("Sent the data room link");
    const types = after.body.activities.map((a: { activityType: string }) => a.activityType);
    expect(types).toContain("call");
    expect(types).toContain("note");
  });

  it("surfaces the AUTOMATIC stage_change entries, which is the history no one could read before", async () => {
    const dealId = await createDeal("W27 PIPE04 stage history");
    const before = (await get(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING)).body.activities.length;

    const moved = await request(app)
      .patch(`/api/partner/me/pipeline/${dealId}`)
      .set("x-user-id", MANAGING)
      .send({ stage: "soft_circle" });
    expect([200, 201]).toContain(moved.status);

    const after = await get(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING);
    expect(after.status).toBe(200);
    /* If the stage writer ever stops emitting, this fails rather than quietly
       returning a shorter list. */
    expect(after.body.activities.length).toBeGreaterThan(before);
    expect(after.body.activities.some((a: { activityType: string }) => a.activityType === "stage_change")).toBe(true);
  });

  it("orders newest first, deterministically", async () => {
    const dealId = await createDeal("W27 PIPE04 ordering");
    for (const body of ["first", "second", "third"]) {
      await post(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING, { activityType: "note", body });
    }
    const r = await get(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING);
    const times = r.body.activities.map((a: { occurredAt: string }) => a.occurredAt);
    const sorted = [...times].sort((a: string, b: string) => b.localeCompare(a));
    expect(times).toEqual(sorted);
    // And the ordering is stable across identical calls (the id tiebreak).
    const again = await get(`/api/partner/me/pipeline/${dealId}/activities`, MANAGING);
    expect(again.body.activities.map((a: { id: string }) => a.id)).toEqual(
      r.body.activities.map((a: { id: string }) => a.id),
    );
  });

  it("404s an unknown deal id rather than returning an empty list", async () => {
    /* An empty 200 would be the wrong answer twice over: it invents a deal, and
       it makes a missing ownership check look like a working one. */
    const r = await get("/api/partner/me/pipeline/pdeal_does_not_exist/activities", MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("DEAL_NOT_FOUND");
  });

  it("requires authentication — an anonymous caller cannot read deal history", async () => {
    const dealId = await createDeal("W27 PIPE04 auth");
    const r = await request(app).get(`/api/partner/me/pipeline/${dealId}/activities`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).not.toBe(200);
  });

  it("the ownership guard is real — a partner cannot read another partner's deal history", async () => {
    /* Built as a positive control first: the foreign deal EXISTS and HAS
       activity, proven by reading it as its owner. Only then is it requested by
       a different partner. Without that first half a 404 could simply mean the
       fixture never worked. */
    const foreignDeal = await createDeal("W27 PIPE04 foreign");
    await post(`/api/partner/me/pipeline/${foreignDeal}/activities`, MANAGING, {
      activityType: "meeting",
      body: "CONFIDENTIAL — other partner's meeting",
    });
    const asOwner = await get(`/api/partner/me/pipeline/${foreignDeal}/activities`, MANAGING);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.activities.some((a: { body: string }) => a.body.includes("CONFIDENTIAL"))).toBe(true);

    /* Now the same id from a DIFFERENT partner identity. Anything other than a
       refusal — including a 200 with an empty list — is a leak or a probe
       oracle. */
    const OTHER = "u_w27_other_partner";
    const asStranger = await get(`/api/partner/me/pipeline/${foreignDeal}/activities`, OTHER);
    expect(asStranger.status).not.toBe(200);
    expect(JSON.stringify(asStranger.body)).not.toContain("CONFIDENTIAL");
  });

  it("the route exists in the REAL router stack with its guards attached", () => {
    /* Behavioural cases above build their own app; this reads back what
       `registerPartnerRoutes` actually registered, so the guards cannot be
       removed while the behaviour tests keep passing against a fixture. */
    const probe = express();
    registerPartnerRoutes(probe);
    const stack = (
      (probe as unknown as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } }).router ??
      (probe as unknown as { _router: { stack: unknown[] } })._router
    ).stack as Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: { name: string } }> } }>;

    const layer = stack.find(
      (l) => l.route && l.route.path === "/api/partner/me/pipeline/:id/activities" && l.route.methods.get,
    );
    expect(layer, "GET .../activities is not registered at all").toBeTruthy();
    const names = layer!.route!.stack.map((s) => s.handle.name);
    expect(names).toContain("requirePartnerAuth");
    expect(names).toContain("requireSignedAgreement");
    // Control: the matcher is capable of NOT finding something.
    expect(stack.find((l) => l.route && l.route.path === "/api/partner/me/pipeline/:id/nope")).toBeFalsy();
  });
});
