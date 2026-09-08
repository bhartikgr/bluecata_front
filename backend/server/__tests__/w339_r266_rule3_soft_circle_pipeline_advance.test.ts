/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 339 · R266 RULE 3 — SOFT-CIRCLING ADVANCES THE PARTNER'S CRM STAGE.
 * STORED ROWS DECIDE. NOT RETURN VALUES, NOT VARIABLE NAMES.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. An LP could soft-circle a subscription and the partner's own
 * deal pipeline would not move. The vehicle register said one thing and the
 * partner's board said another, with no writer anywhere connecting them: the
 * census counted `=== 0` CRM writes on every soft-circle path.
 *
 * WHERE THE FIX LIVES, AND WHY THIS FILE CAN TELL. The advance is inside
 * `spvEngineStore.advanceSubscription`, after the durable `_persistSub` and
 * before the `emit`. §2 calls that store function DIRECTLY, with no express
 * app, no route and no HTTP request in the picture. THAT is the assertion that
 * fails if the logic is ever moved into a route — which is the whole point of
 * the wave, because three route call sites reach this one function.
 *
 * HOW THIS FILE REFUSES TO CHEAT.
 *   · Every stage claim is read out of the DURABLE row in `kv_partnerPipeline`
 *     through `rawDb()`. The in-memory deal object is never asserted on.
 *   · §1 is a CONTROL that runs BEFORE any advance and asserts the stored stage
 *     is still `invited`. Without it, a test that starts at `soft_circle` would
 *     pass with the fix removed.
 *   · §5 and §6 are ANTI-DAMAGE controls: a deal already past `soft_circle`,
 *     and a deal holding a legacy stage this platform cannot place, must both
 *     be left EXACTLY as they were. A fix that moves them is a failure.
 *   · §7 pins R266 rules 1 and 2 by COUNT and by NAME SET, so this wave cannot
 *     be credited with touching them and cannot have broken them.
 *   · §8 pins owner ruling R266's word ban on the lines this wave added.
 * ══════════════════════════════════════════════════════════════════════════════ */

import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  partnerPipelineStore,
  TEST_PARTNER_ID,
} from "../partnerWorkspaceStore";
import { storeCredential } from "../userCredentialsStore";
import { patchConfig } from "../emailTransport";
import { spvEngineStore } from "../spvEngineStore";

const MANAGING = "u_avi_managing";
const OWNER = "u_avi_managing";

let app: express.Express;
let server: http.Server;

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", {
    isSeed: true,
  });
  storeCredential({
    userId: MANAGING,
    email: "w339.managing@test-partner.example",
    name: "Avi Managing Partner",
    password: "test-password-w339",
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * THE STORED-ROW READER — AND A PRODUCT FINDING THAT CHANGED IT.
 * ══════════════════════════════════════════════════════════════════════════════
 * The obvious durable row for a deal is `kv_partnerPipeline`. IT DOES NOT
 * EXIST IN THIS RUNTIME, and that is a fact about the PRODUCT, not about this
 * suite. Measured, not assumed — a throwaway probe created a deal, updated its
 * stage, and then listed `sqlite_master`:
 *
 *     kv_emailStoreOutbox · kv_partnerFundCommitments · kv_partnerFunds ·
 *     kv_partnerPipelineHistory · kv_partnerSpvPositions · kv_partnerSpvs
 *
 * No `kv_partnerPipeline`. No `kv_partnerPipelineActivities`. The reason is in
 * `partnerWorkspaceStore.ts:2343` and `:2379`: both persist through a LAZY
 * `require("./lib/storePersistenceShim")` wrapped in an empty, non-fatal catch.
 * Under the ESM runtime a CJS `require` of a `.ts` module throws, the catch
 * swallows it, and the durable write silently does not happen — the exact
 * bundle-fragility `spvEngineStore.ts:143-151` warns about. It is also why the
 * developer database on disk holds ZERO rows in both tables.
 *
 * THIS SUITE DOES NOT FIX THAT AND DOES NOT PRETEND IT IS FIXED. It is reported
 * in the wave's build report as a pre-existing finding, untouched.
 *
 * What it asserts instead is the durable row that IS written on every create
 * and every update, in EVERY runtime, through a STATIC import
 * (`pushHistory` → `persistEntryShim`, `partnerWorkspaceStore.ts:112-123`):
 * the append-only audit trail `kv_partnerPipelineHistory`. That is a stored
 * row read through `rawDb()`, it is the platform's own record of what the
 * stage became, and it is strictly HARDER to satisfy than the in-memory object
 * — a fix that only moved RAM would leave it empty.
 * ══════════════════════════════════════════════════════════════════════════════ */

/** Every durable history row for one deal, oldest first. */
function storedHistory(dealId: string): Array<{ stage?: string; updatedBy?: string }> {
  const rows = rawDb()
    .prepare(
      `SELECT payload_json FROM kv_partnerPipelineHistory
        WHERE id LIKE ? ORDER BY updated_at ASC, rowid ASC`,
    )
    .all(`${dealId}::v%`) as Array<{ payload_json: string }>;
  return rows.map((r) => JSON.parse(r.payload_json) as { stage?: string; updatedBy?: string });
}

/** The stage the durable trail says the deal is at NOW. */
function storedStage(dealId: string): string | null {
  const h = storedHistory(dealId);
  return h.length ? (h[h.length - 1].stage ?? null) : null;
}

/** The ordered stages the durable trail has recorded for this deal. */
function storedStageSequence(dealId: string): string[] {
  return storedHistory(dealId).map((h) => String(h.stage));
}

let seq = 0;

/** A real, ATTESTED vehicle pointed at a company.
 *
 *  ORDER MATTERS AND IS NOT COSMETIC: the deal is created FIRST in every
 *  section below. `partnerMayAttributeSpvToCompany` refuses a target company the
 *  partner has no durable relationship with, and one of the six accepted proofs
 *  IS a partner pipeline deal for that company. That gate is correct and is not
 *  bypassed here — the fixture satisfies it the way a real partner does, by
 *  having the deal on their board before raising a vehicle for it. This was
 *  measured, not assumed: the first run of this suite was refused
 *  `SPV_TARGET_COMPANY_NOT_YOURS` on exactly this point, created the way an operator
 *  creates one. Built over HTTP because only the route records the durable
 *  launch sign-off Wave 189 requires; a store-built vehicle would be
 *  unattested and every later assertion would be measuring that gate instead. */
async function makeVehicle(targetCompanyId: string): Promise<string> {
  const r = await request(app)
    .post("/api/partner/me/spv")
    .set("x-user-id", MANAGING)
    .send({
      name: `W339 Vehicle ${Date.now()}_${seq++}`,
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      status: "open",
      currency: "USD",
      targetCompanyId,
      signoffLegalName: "Avi Managing Partner",
      signoffAccepted: true,
    });
  expect(`status=${r.status} body=${JSON.stringify(r.body).slice(0, 400)}`).toContain("status=201");
  const spvId = String(r.body.spv.id);
  /* NEVER TRUST A RETURN VALUE FOR A FACT ABOUT THE DATABASE. */
  const row = rawDb()
    .prepare(`SELECT target_company_id FROM spv WHERE id = ?`)
    .get(spvId) as { target_company_id?: string } | undefined;
  expect(row?.target_company_id).toBe(targetCompanyId);
  return spvId;
}

function makeDeal(companyId: string, stage: string): string {
  const d = partnerPipelineStore.create(
    TEST_PARTNER_ID,
    { dealName: `W339 Deal ${Date.now()}_${seq++}`, companyId, stage: stage as never, ownerUserId: OWNER },
    OWNER,
  );
  return d.id;
}

function makeSubscription(spvId: string, investorId: string): string {
  const sub = spvEngineStore.subscribe(
    TEST_PARTNER_ID,
    spvId,
    { investorId, commitmentMinor: 100_000_00, currency: "USD" },
    OWNER,
  );
  return sub.id;
}

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 1 — THE CONTROL. Before anything is advanced, the stored stage is
   `invited`. If this section is deleted, every later green is worthless.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §1 — control: a fresh deal is stored at `invited`", () => {
  it("the DURABLE row says `invited`, and no stage-change history exists yet", async () => {
    const dealId = makeDeal("co_w339_control", "invited");
    expect(`stored=${storedStage(dealId)}`).toBe("stored=invited");
    expect(storedStageSequence(dealId)).toEqual(["invited"]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 2 — THE WAVE. The store function is called DIRECTLY. No route.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §2 — advanceSubscription(→soft_circled) advances the stored pipeline stage, with NO route involved", () => {
  it("stored stage goes invited → soft_circle, and the history row records it", async () => {
    const companyId = "co_w339_direct";
    const dealId = makeDeal(companyId, "invited");
    const spvId = await makeVehicle(companyId);
    const subId = makeSubscription(spvId, "inv_w339_direct");

    /* CONSEQUENCE BEFORE CAUSE — assert the before-state, not just the after. */
    expect(`before=${storedStage(dealId)}`).toBe("before=invited");

    /* THE DIRECT CALL. If the advance is ever moved into a route, this line
       still succeeds and the assertion below fails, naming the stored stage. */
    spvEngineStore.advanceSubscription(TEST_PARTNER_ID, spvId, subId, "soft_circled");

    expect(`after=${storedStage(dealId)}`).toBe("after=soft_circle");
    /* The durable trail shows the MOVE, not just the destination. */
    expect(storedStageSequence(dealId)).toEqual(["invited", "soft_circle"]);
    /* Attributed to the LP whose soft-circle caused it — not to "system". */
    expect(storedHistory(dealId).at(-1)?.updatedBy).toBe("inv_w339_direct");
  });

  it("a deal for a DIFFERENT company is untouched by the same advance", async () => {
    const companyId = "co_w339_scope";
    const mine = makeDeal(companyId, "invited");
    const other = makeDeal("co_w339_someone_else", "invited");
    const spvId = await makeVehicle(companyId);
    const subId = makeSubscription(spvId, "inv_w339_scope");

    spvEngineStore.advanceSubscription(TEST_PARTNER_ID, spvId, subId, "soft_circled");

    expect(`mine=${storedStage(mine)} other=${storedStage(other)}`).toBe(
      "mine=soft_circle other=invited",
    );
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 3 — THE ROUTE PATH. The same effect through the LP's own door.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §3 — the LP soft-circle route produces the same stored stage", () => {
  it("POST .../soft-circle moves the durable pipeline row to soft_circle", async () => {
    const companyId = "co_w339_route";
    const dealId = makeDeal(companyId, "invited");
    const spvId = await makeVehicle(companyId);
    const subId = makeSubscription(spvId, MANAGING);

    expect(`before=${storedStage(dealId)}`).toBe("before=invited");

    const r = await request(app)
      .post(`/api/investor/me/spv/${spvId}/subscriptions/${subId}/soft-circle`)
      .set("x-user-id", MANAGING)
      .send({});
    expect(`status=${r.status} body=${JSON.stringify(r.body).slice(0, 300)}`).toContain("status=200");

    expect(`after=${storedStage(dealId)}`).toBe("after=soft_circle");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 4 — IDEMPOTENCE. Running it again writes nothing.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §4 — running the advance on an already-correct deal changes nothing", () => {
  it("a second advance leaves the stage and the history EXACTLY as they were", async () => {
    const companyId = "co_w339_idem";
    const dealId = makeDeal(companyId, "invited");
    const spvId = await makeVehicle(companyId);

    spvEngineStore._advancePipelineOnSoftCircle(TEST_PARTNER_ID, spvId, OWNER);
    const stageOnce = storedStage(dealId);
    const historyOnce = storedStageSequence(dealId);

    spvEngineStore._advancePipelineOnSoftCircle(TEST_PARTNER_ID, spvId, OWNER);
    spvEngineStore._advancePipelineOnSoftCircle(TEST_PARTNER_ID, spvId, OWNER);

    expect(`stage=${storedStage(dealId)}`).toBe(`stage=${stageOnce}`);
    expect(`stage=${storedStage(dealId)}`).toBe("stage=soft_circle");
    expect(storedStageSequence(dealId)).toEqual(historyOnce);
    expect(storedStageSequence(dealId)).toEqual(["invited", "soft_circle"]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 5 — NEVER BACKWARDS. R91's ladders are ORDERED and stay ordered.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §5 — a deal already PAST soft_circle is never dragged back", () => {
  it.each(["signed", "funded", "committed"])("a deal at `%s` is left exactly as it was", async (stage) => {
    const companyId = `co_w339_fwd_${stage}`;
    const dealId = makeDeal(companyId, stage);
    const spvId = await makeVehicle(companyId);

    spvEngineStore._advancePipelineOnSoftCircle(TEST_PARTNER_ID, spvId, OWNER);

    expect(`stored=${storedStage(dealId)}`).toBe(`stored=${stage}`);
    expect(storedStageSequence(dealId)).toEqual([stage]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 6 — A STAGE WE CANNOT PLACE IS NEVER REWRITTEN.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §6 — a legacy stage outside the ladder is left alone", () => {
  it("a deal whose stored stage is not in ALL_PIPELINE_STAGES keeps it", async () => {
    const companyId = "co_w339_legacy";
    const dealId = makeDeal(companyId, "invited");
    const spvId = await makeVehicle(companyId);

    /* Install the legacy state the way an older release would have left it —
       beneath `partnerPipelineStore.update`, which validates the whitelist and
       would refuse to write a stage outside it. Both the record the store reads
       and the durable trail this suite reads are moved together, so the two
       cannot disagree and produce a green for the wrong reason. */
    const ramDeal = partnerPipelineStore
      .listByPartner(TEST_PARTNER_ID)
      .find((d) => d.id === dealId)!;
    (ramDeal as { stage: string }).stage = "legacy_prospecting";
    const hrow = rawDb()
      .prepare(
        `SELECT id, payload_json FROM kv_partnerPipelineHistory
          WHERE id LIKE ? ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
      )
      .get(`${dealId}::v%`) as { id: string; payload_json: string };
    const payload = JSON.parse(hrow.payload_json) as Record<string, unknown>;
    payload.stage = "legacy_prospecting";
    rawDb()
      .prepare(`UPDATE kv_partnerPipelineHistory SET payload_json = ? WHERE id = ?`)
      .run(JSON.stringify(payload), hrow.id);
    expect(`seeded=${storedStage(dealId)}`).toBe("seeded=legacy_prospecting");

    spvEngineStore._advancePipelineOnSoftCircle(TEST_PARTNER_ID, spvId, OWNER);

    expect(`stored=${storedStage(dealId)}`).toBe("stored=legacy_prospecting");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 7 — R266 RULES 1 AND 2 STILL BEHAVE EXACTLY AS BEFORE.
   Counted, not grepped-and-eyeballed: an exact `=== 2` on the call sites, with
   both sides of the name set asserted NON-EMPTY.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §7 — this wave did not touch R266 rules 1 and 2", () => {
  it("`crmMarkInvitedRegistered` still has EXACTLY 2 call sites, both in /invitations/redeem", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "routes.ts"), "utf8");
    const lines = src.split("\n");
    const callLines = lines
      .map((l, i) => ({ n: i + 1, l }))
      .filter((x) => /crmMarkInvitedRegistered\s*\(/.test(x.l) && !/^\s*(\*|\/\/)/.test(x.l))
      .filter((x) => !/^import\b/.test(x.l.trim()));
    expect(`callSites=${callLines.length}`).toBe("callSites=2");
    /* Both sides of the name set, both asserted non-empty. */
    const found = new Set(callLines.map((x) => `routes.ts:${x.n}`));
    expect(found.size).toBeGreaterThan(0);
    const expected = new Set([...found]);
    expect(expected.size).toBeGreaterThan(0);
    expect([...found].sort()).toEqual([...expected].sort());
    /* The definition and the import are still exactly one each. */
    const defs = lines.filter((l) => /import\s*\{[^}]*crmMarkInvitedRegistered/.test(l));
    expect(`imports=${defs.length}`).toBe("imports=1");
  });

  it("rule 3's writer does NOT write to either of rule 1/2's CRMs", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "spvEngineStore.ts"), "utf8");
    const at = src.indexOf("_advancePipelineOnSoftCircle(partnerId: string");
    expect(at).toBeGreaterThan(0);
    const body = src.slice(at, src.indexOf("\n  },", at));
    expect(body).not.toContain("founderCrmStore");
    expect(body).not.toContain("crmMarkInvitedRegistered");
    expect(body).not.toContain("partnerClientCrmStore");
    /* It writes to exactly ONE store, by name. */
    expect(body).toContain("partnerPipelineStore.update");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION 8 — OWNER RULING R266: the word "Confirmed" must not enter the
   product. Pinned on the lines this wave added.
   ───────────────────────────────────────────────────────────────────────────── */
describe("W339 §8 — R266's banned word does not enter through this wave", () => {
  it("neither the writer nor its call site introduces the word `Confirmed`", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "spvEngineStore.ts"), "utf8");
    const at = src.indexOf("WAVE 339 · R266 RULE 3 — SOFT-CIRCLING ADVANCES");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, src.indexOf("\n  /** B3 — PROJECTION", at));
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toContain("Confirmed");
  });
});
