/* ════════════════════════════════════════════════════════════════════════════
   WAVE 282 · REAL HTTP, REAL DATABASE, NO MOCK ANYWHERE IN THIS FILE.
   ════════════════════════════════════════════════════════════════════════════
   The companion file `w282_crm_projection_state.test.ts` mocks db/connection so
   a SELECT can be forced to throw. Nothing here does. Both branches of
   `stagesAvailable` are reached over supertest against the REAL Express routes
   and the REAL sqlite database, using the fact that the projection genuinely
   has three lifecycle states:

       "not_run"  — this process has not hydrated the CRM projection yet
       "ok"       — hydrate ran and both SELECTs returned
       "failed"   — hydrate ran and a SELECT threw

   A vitest worker that mounts these routes without booting the app is in the
   FIRST state for real. That is not a simulation of a failure: it is the exact
   condition in which `listStages` returns `{}` and `getStage` returns
   `PARTNER_CLIENT_DEFAULT_STAGE` with nothing having been read — the condition
   that printed "Prospect" for every managed client. So the false branch is
   asserted first, then the real hydrate is run against the real database and
   the true branch is asserted on the same two routes.

   ORDER MATTERS AND IS ENFORCED. The two describes below must run in file
   order; the "before hydrate" assertions would be meaningless after it.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerClientCrmRoutes } from "../partnerClientCrmRoutes";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { hydratePartnerClientCrmStore, crmProjectionState } from "../partnerClientCrmStore";
import { PARTNER_CLIENT_DEFAULT_STAGE } from "../../shared/crmStages";
import { installV14TestIdentity } from "./_v14TestIdentity";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const CO_ALPHA = "co_w282_http_alpha";
const ACTOR = "u_avi_managing";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerClientCrmRoutes(app);
  seedTestPartnerSandbox({ force: true });
  partnerAttributionStore.create(PARTNER_A, CO_ALPHA, ACTOR);
});

describe("WAVE 282 · A — BEFORE any hydrate, both routes say the stages were NOT read", () => {
  it("PRECONDITION — the routes are live and the company really is attributed", async () => {
    /* Prove the harness can talk to the server at all, and that the fixture is
       non-empty, BEFORE concluding anything from a `false`. An unreachable
       route and a route that answers `stagesAvailable:false` are different
       facts and must not be confused. */
    const attributed = partnerAttributionStore.listByPartner(PARTNER_A);
    expect(attributed.length).toBeGreaterThan(0);
    expect(attributed.some((a) => a.companyId === CO_ALPHA)).toBe(true);
    expect(crmProjectionState()).toBe("not_run");
  });

  it("GET /client-crm-index — stagesAvailable is false, and `stages` is empty for the SAME reason", async () => {
    const r = await request(app)
      .get("/api/partner/me/client-crm-index")
      .set("x-user-id", ACTOR);
    expect(r.status).toBe(200);
    /* The pre-282 payload, unchanged and still present — nothing was dropped. */
    expect(typeof r.body.stages).toBe("object");
    expect(Array.isArray(r.body.vocabulary)).toBe(true);
    expect(r.body.vocabulary).toContain(PARTNER_CLIENT_DEFAULT_STAGE);
    /* THE NEW FIELD. Strictly `false`, never merely falsy: a missing key would
       be read by the client as "assume readable", which is the deploy-skew
       behaviour this was designed for. */
    expect(r.body.stagesAvailable).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r.body, "stagesAvailable")).toBe(true);
  });

  it("GET /client-crm/:companyId — stagesAvailable is false while `stage` STILL returns the default", async () => {
    const r = await request(app)
      .get(`/api/partner/me/client-crm/${CO_ALPHA}`)
      .set("x-user-id", ACTOR);
    expect(r.status).toBe(200);
    /* This is the whole defect, on the wire, in one object: a stage value that
       looks like a fact sitting beside the statement that nothing was read.
       Before wave 282 only the first half of this line existed. */
    expect(r.body.stage).toBe(PARTNER_CLIENT_DEFAULT_STAGE);
    expect(r.body.stagesAvailable).toBe(false);
  });
});

describe("WAVE 282 · B — AFTER a real hydrate against the real database, both routes say the stages WERE read", () => {
  beforeAll(async () => {
    /* The real function, the real sqlite handle, no stub. */
    await hydratePartnerClientCrmStore();
  });

  it("PRECONDITION — the hydrate actually ran and reported success", () => {
    expect(crmProjectionState()).toBe("ok");
  });

  it("GET /client-crm-index — stagesAvailable is now true", async () => {
    const r = await request(app)
      .get("/api/partner/me/client-crm-index")
      .set("x-user-id", ACTOR);
    expect(r.status).toBe(200);
    expect(r.body.stagesAvailable).toBe(true);
  });

  it("GET /client-crm/:companyId — stagesAvailable is now true", async () => {
    const r = await request(app)
      .get(`/api/partner/me/client-crm/${CO_ALPHA}`)
      .set("x-user-id", ACTOR);
    expect(r.status).toBe(200);
    expect(r.body.stagesAvailable).toBe(true);
    expect(r.body.stage).toBe(PARTNER_CLIENT_DEFAULT_STAGE);
  });

  it("BOTH VALUES MOVED — the two routes did not simply hardcode a boolean", async () => {
    /* Anti-vacuity across the two describes: the field is asserted to have
       taken BOTH values in this one process. A constant `true` would have
       failed group A; a constant `false` fails here. */
    const idx = await request(app).get("/api/partner/me/client-crm-index").set("x-user-id", ACTOR);
    const one = await request(app).get(`/api/partner/me/client-crm/${CO_ALPHA}`).set("x-user-id", ACTOR);
    expect(idx.body.stagesAvailable).toBe(true);
    expect(one.body.stagesAvailable).toBe(true);
  });
});

/* Referenced so the identity helper's import cannot be pruned as unused by a
   future edit; the harness above relies on the same x-user-id resolution the
   sibling CRM suite uses. */
void installV14TestIdentity;
