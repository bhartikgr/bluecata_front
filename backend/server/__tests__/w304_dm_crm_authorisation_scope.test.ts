/**
 * W304 (R244.1) — A DM AUTHORISATION DERIVED FROM AN UNSCOPED CRM LOOKUP.
 *
 * `openDmChannelCore` provisioned a comms identity — and authorised a direct
 * message — from `findCrmContactByInvestorId`, which searched EVERY company's
 * founder CRM rows with no reference to who was asking. A caller owning no
 * company and holding no engagement could name any investor id in any
 * founder's CRM and get a durable DM channel. Proved over HTTP before the fix:
 * build_log/wave304/artefacts/http_exposure_before_raw.txt.
 *
 * THIS TEST IS BUILT TO REFUSE TO BE VACUOUS.
 *   - Every refusal assertion is paired with a POSITIVE assertion that the
 *     legitimate caller on the SAME CRM row still gets 200 and a channel. A
 *     fixture where nobody can open a DM would prove nothing.
 *   - The CRM row is asserted to exist in the DATABASE before either call, so
 *     "refused because there is no row" cannot masquerade as "refused because
 *     it is scoped".
 *   - The channel list is read back after each call, so an authorisation that
 *     returns 422 but still mints a channel would be caught.
 *
 * The CRM-provision branch only runs when `commsUserRef(target)` is undefined,
 * so the target MUST be a CRM-only investor id, never a seeded persona.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { patchConfig, getConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";
import {
  findCrmContactByInvestorId,
  findCrmContactByInvestorIdForCompanies,
} from "../founderCrmStore";

const CO = "co_w304_fence_owner";
const GHOST = "u_inv_w304_fence_ghost";
const SEEDED_CRM_ONLY = "u_hydra"; // seeded CRM row on co_novapay
const SEEDED_OWNER = "u_maya_chen"; // owns co_novapay

let app: Express;
let server: http.Server;
let founderId = "";
let strangerId = "";

async function signup(name: string) {
  _resetRateLimitsForTests();
  const r = await request(app).post("/api/auth/signup").send({
    email: `${name}.${Date.now()}@w304fence.test`,
    name,
    password: "w304-fence-pw",
  });
  expect(r.status, `signup ${name}: ${JSON.stringify(r.body)}`).toBe(200);
  return String(r.body.ctx.userId);
}

function dm(uid: string, targetUserId: string) {
  _resetRateLimitsForTests();
  return request(app).post("/api/comms/dm/start").set("x-user-id", uid).send({ targetUserId });
}

/** NOTE: this route returns a BARE ARRAY, not `{ channels: [...] }`. Reading
 *  `body.channels` yields undefined and every `[]` comparison against it
 *  passes vacuously — which is exactly what happened on the first run of this
 *  file and is why the durability assertions are written against `body`. */
async function channelIds(uid: string): Promise<string[]> {
  const r = await request(app).get("/api/comms/channels").set("x-user-id", uid);
  expect(Array.isArray(r.body), "the channels route must return an array").toBe(true);
  return (r.body as Array<{ id: string }>).map((c) => c.id);
}

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  founderId = await signup("w304fencefounder");
  strangerId = await signup("w304fencestranger");

  _resetRateLimitsForTests();
  const co = await request(app)
    .post("/api/founder/companies")
    .set("x-user-id", founderId)
    .send({ companyId: CO, companyName: "W304 Fence Owner Co", sector: "fintech", stage: "seed" });
  expect(co.status, `company create: ${JSON.stringify(co.body)}`).toBe(201);
  await hydrateMultiCompanyStore();

  _resetRateLimitsForTests();
  const crm = await request(app)
    .post("/api/founder/investor-crm")
    .set("x-user-id", founderId)
    .send({
      name: "Ghost Investor W304 Fence",
      email: "ghost.fence.w304@example.test",
      firmName: "Ghost Capital",
      investorId: GHOST,
    });
  expect(crm.status, `crm create: ${JSON.stringify(crm.body)}`).toBe(200);
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W304 — a DM authorisation may not come from an unscoped CRM lookup", () => {
  it("FIXTURE INTEGRITY — the CRM row exists in the DB and belongs ONLY to the founder's company", () => {
    const rows = rawDb()
      .prepare(
        "SELECT id, company_id, investor_id, email FROM founder_crm_contacts WHERE investor_id = ?",
      )
      .all(GHOST) as Array<{ company_id: string; email: string }>;
    // If this were empty, every refusal below would be a refusal for the WRONG
    // reason and the whole test would be inert.
    expect(rows.length, "the CRM row must exist, or nothing below discriminates").toBeGreaterThan(0);
    expect(rows.every((r) => r.company_id === CO)).toBe(true);
    expect(rows[0].email.length, "the row must carry an email — the provision branch requires one").toBeGreaterThan(0);
    expect(founderId).not.toBe(strangerId);
    // DO NOT SEND MAIL — assert the sender is inert, every run.
    expect(getConfig().mode, "the mail sender must be inert for this whole file").toBe("dry_run");
  });

  it("POSITION — the unscoped lookup still FINDS the row, so the refusal is the scoping and not a missing row", () => {
    // The retired-in-place unscoped function is asserted to still match. This
    // is what makes the stranger's refusal meaningful: the row is findable,
    // it is simply not findable BY THE STRANGER.
    expect(findCrmContactByInvestorId(GHOST)?.companyId).toBe(CO);
    expect(findCrmContactByInvestorIdForCompanies(GHOST, [CO])?.companyId).toBe(CO);
    // Fail-closed by construction.
    expect(findCrmContactByInvestorIdForCompanies(GHOST, [])).toBeUndefined();
    expect(findCrmContactByInvestorIdForCompanies(GHOST, ["", "   "])).toBeUndefined();
    expect(findCrmContactByInvestorIdForCompanies(GHOST, ["co_someone_else"])).toBeUndefined();
  });

  it("CONSEQUENCE — a stranger is REFUSED, and no channel is minted for them", async () => {
    const beforeIds = await channelIds(strangerId);

    const r = await dm(strangerId, GHOST);
    expect(r.status, `stranger must not be authorised: ${JSON.stringify(r.body)}`).not.toBe(200);
    expect(r.body.ok).toBe(false);

    // A 422 that still created the channel would be a refusal in name only.
    const afterIds = await channelIds(strangerId);
    expect(afterIds.filter((id) => id.includes(GHOST)), "no DM channel with that investor may exist for the stranger").toEqual([]);
    expect(afterIds.length, "the stranger's channel list must not have grown").toBe(beforeIds.length);
  });

  it("NEVER RESTRICT A LEGITIMATE USER — the founder who owns that CRM row still opens the DM", async () => {
    const r = await dm(founderId, GHOST);
    expect(r.status, `the legitimate founder must still succeed: ${JSON.stringify(r.body)}`).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(String(r.body.channelId)).toContain(GHOST);
    expect(String(r.body.channelId)).toContain(founderId);
    // Durability read back through the SHIPPED detail route, by id.
    const detail = await request(app)
      .get(`/api/comms/channels/${String(r.body.channelId)}`)
      .set("x-user-id", founderId);
    expect(detail.status, `the founder's channel must be durable, not just a 200: ${JSON.stringify(detail.body)}`).toBe(200);
    const ids = await channelIds(founderId);
    expect(ids.length, "the founder must be able to list at least one channel").toBeGreaterThan(0);
  });

  it("CONSEQUENCE on SEEDED data — a stranger is refused the seeded CRM-only investor, whose OWNER still succeeds", async () => {
    const strangerAsk = await dm(strangerId, SEEDED_CRM_ONLY);
    expect(
      strangerAsk.status,
      `stranger must not reach a seeded CRM-only investor: ${JSON.stringify(strangerAsk.body)}`,
    ).not.toBe(200);

    // The POSITIVE pole on the SAME target: the founder of co_novapay. If this
    // failed, the fix would be over-tight and the test would say so.
    const ownerAsk = await dm(SEEDED_OWNER, SEEDED_CRM_ONLY);
    expect(
      ownerAsk.status,
      `the owner of that company must still open the DM: ${JSON.stringify(ownerAsk.body)}`,
    ).toBe(200);
    expect(ownerAsk.body.ok).toBe(true);
  });

  it("NEVER RESTRICT A LEGITIMATE USER — DMs between two existing personas are untouched by this change", async () => {
    // Neither party goes through the CRM provision branch at all, so this must
    // be completely unaffected. It is asserted so that an over-broad edit to
    // `openDmChannelCore` cannot pass unnoticed.
    const r = await dm(SEEDED_OWNER, "u_aisha_patel");
    expect(r.status, `persona-to-persona DM must still work: ${JSON.stringify(r.body)}`).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});
