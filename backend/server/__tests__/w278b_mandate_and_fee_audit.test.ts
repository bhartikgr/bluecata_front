/**
 * WAVE 278b — THE TWO MISSING SPV AUDIT WRITERS, PROVED FROM THE DATABASE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND HOW IT REFUSES TO PROVE IT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THE GAP, STATED PRECISELY. Both sinks ALREADY EMIT:
 *   · `spvEngineStore.setMandate` emits `spv.mandate_set`
 *   · `spvEngineStore.addFee`     emits `spv.fee_set`
 * Neither wrote an audit row. So the gap was never a missing emission — it is
 * that AN EMISSION IS NOT AN AUDIT ROW. `emit` writes a bridge-outbox envelope
 * (drained, dead-letterable, pruned by `clearBridgeOutbox()`) and it SWALLOWS
 * its own failure in a bare `catch {}` at `spvEngineStore.ts:408`. Therefore an
 * emit is not evidence of anything durable, and this file never asserts one.
 *
 * NEVER PROVE A REPLICA (handbook §8). Every assertion below:
 *   · drives the REAL express route table over HTTP (supertest), and
 *   · reads the STORED `audit_log` ROW back out of SQLite with `rawDb()`.
 * No assertion reads a response body for the audited value, none reads a log
 * line, and none calls the writer directly.
 *
 * ANTI-INERTNESS. The payload assertions compare the stored row against values
 * READ BACK from `getMandate()` / `listFees()` — never against a literal typed
 * into this file. A test that compares a literal to a literal cannot tell the
 * fix from the defect (inert-proof mechanism 10).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";
const ADMIN = { "x-user-id": "u_admin" };
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
const put = (p: string, body?: unknown) =>
  request(app).put(p).set("x-user-id", MANAGING).send(body ?? {});

let seq = 0;
function launchBody(extraTerms: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    name: `W278b audit ${Date.now()}_${seq++}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    spvType: "spv",
    distributionScope: "private",
    lpVisibility: "own_only",
    targetRaiseMinor: 50_000_000,
    minCheckMinor: 2_500_000,
    capMinor: 250_000_000,
    currency: "USD",
    status: "open",
    terms: { mandateDescription: "W278b audit probe mandate", ...extraTerms },
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    ...extra,
  };
}

/** THE STORED ROW. Read straight out of SQLite — not the mirror, not a body. */
function auditRows(action: string): Array<Record<string, any>> {
  return rawDb()
    .prepare(
      `SELECT id, tenant_id AS tenantId, actor_id AS actorId, action, target,
              payload_json AS payloadJson, created_at AS createdAt,
              prev_hash AS prevHash, hash
         FROM audit_log WHERE action = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(action) as Array<Record<string, any>>;
}

function rowFor(action: string, spvId: string): Record<string, any> | undefined {
  return auditRows(action).find((r) => String(r.target) === `spv:${spvId}`);
}

function rowsFor(action: string, spvId: string): Array<Record<string, any>> {
  return auditRows(action).filter((r) => String(r.target) === `spv:${spvId}`);
}

/** Every audit row in the table, as an immutable fingerprint. Used to prove the
 *  ABSOLUTE rule: no pre-existing row is ever rewritten or deleted. */
function auditFingerprint(): Array<string> {
  return (
    rawDb()
      .prepare(
        `SELECT id, tenant_id AS t, actor_id AS a, action, target, payload_json AS p,
                created_at AS c, prev_hash AS ph, hash
           FROM audit_log ORDER BY id`,
      )
      .all() as Array<Record<string, any>>
  ).map(
    (r) =>
      `${r.id}|${r.t}|${r.a}|${r.action}|${r.target}|${r.c}|${r.ph}|${r.hash}|${r.p}`,
  );
}

async function launch(extra: Record<string, unknown> = {}) {
  const res = await post("/api/partner/me/spv", launchBody({}, extra));
  return res;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerAdminPlatformRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W278b A1 — PUT …/mandate over HTTP writes a durable spv.mandate_set row", () => {
  let spvId = "";
  let res: any;

  beforeAll(async () => {
    const created = await launch();
    expect(created.status, "the launch itself must succeed — a proof against a refused route proves nothing").toBe(201);
    spvId = String(created.body.spv.id);
    res = await put(`/api/partner/me/spv/${spvId}/mandate`, {
      mode: "sector_restricted",
      ruleTree: { op: "and", children: [] },
      sector: ["fintech", "healthtech"],
      geography: ["us", "eu"],
      stage: ["seed", "series_a"],
      checkMinMinor: 1_000_000,
      checkMaxMinor: 9_000_000,
    });
  }, 120_000);

  it("the route succeeded (200) and stored a mandate", () => {
    expect(res.status).toBe(200);
    expect(spvEngineStore.getMandate(PARTNER_A, spvId)).toBeTruthy();
  });

  it("a spv.mandate_set row EXISTS IN audit_log for this SPV — read from the DB, not the body", () => {
    const row = rowFor("spv.mandate_set", spvId);
    expect(row, `no spv.mandate_set audit_log row for spv:${spvId}`).toBeTruthy();
    /* POSITION, not merely existence: the row must carry a real chained hash.
       An empty hash is `isAuditWriteFailure`'s sentinel, i.e. a lost write. */
    expect(String(row!.hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the row names the AUTHENTICATED user, not a placeholder", () => {
    const row = rowFor("spv.mandate_set", spvId)!;
    expect(row.actorId).toBe(MANAGING);
    const payload = JSON.parse(String(row.payloadJson));
    expect(payload.actorResolved).toBe(true);
    expect(payload.actorUnresolvedReason).toBeUndefined();
    expect(payload.auditWriter).toBe("spvLifecycleAudit");
    expect(payload.auditWaveCompleted).toBe(278);
  });

  it("the payload equals what the STORE PERSISTED — compared against getMandate(), never a literal", () => {
    const stored = spvEngineStore.getMandate(PARTNER_A, spvId)!;
    const payload = JSON.parse(String(rowFor("spv.mandate_set", spvId)!.payloadJson));
    expect(payload.spvId).toBe(spvId);
    expect(payload.mandateId).toBe(stored.id);
    expect(payload.mode).toBe(stored.mode);
    expect(payload.sector).toEqual(stored.sector);
    expect(payload.geography).toEqual(stored.geography);
    expect(payload.stage).toEqual(stored.stage);
    expect(payload.companyIds).toEqual(stored.companyIds);
    expect(payload.revisionHash).toBe(stored.revisionHash);
    /* Money as a STRING of the STORED value. `String(stored.x)` is a
       normalising call INSIDE the equality assertion on purpose: the left side
       is the row, the right side is the store. Neither is a literal. */
    expect(payload.checkMinMinor).toBe(String(stored.checkMinMinor));
    expect(payload.checkMaxMinor).toBe(String(stored.checkMaxMinor));
    expect(typeof payload.checkMinMinor).toBe("string");
  });

  it("a null check bound is recorded as null, NEVER as a fabricated \"0\"", async () => {
    const created = await launch();
    const id = String(created.body.spv.id);
    const r = await put(`/api/partner/me/spv/${id}/mandate`, {
      mode: "open",
      ruleTree: { op: "and", children: [] },
    });
    expect(r.status).toBe(200);
    const payload = JSON.parse(String(rowFor("spv.mandate_set", id)!.payloadJson));
    expect(payload.checkMinMinor).toBeNull();
    expect(payload.checkMaxMinor).toBeNull();
    expect(payload.checkMinMinor).not.toBe("0");
  }, 60_000);
});

describe("W278b A2 — POST …/fees over HTTP writes a durable spv.fee_set row", () => {
  let spvId = "";
  let res: any;

  beforeAll(async () => {
    const created = await launch();
    expect(created.status).toBe(201);
    spvId = String(created.body.spv.id);
    res = await post(`/api/partner/me/spv/${spvId}/fees`, {
      layer: "management",
      feeType: "fixed",
      fixedAmountMinor: 5_000_00,
      currency: "USD",
    });
  }, 120_000);

  it("the route succeeded (201) and stored exactly one fee", () => {
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(spvEngineStore.listFees(PARTNER_A, spvId)).toHaveLength(1);
  });

  it("a spv.fee_set row EXISTS IN audit_log for this SPV, with a real chained hash", () => {
    const row = rowFor("spv.fee_set", spvId);
    expect(row, `no spv.fee_set audit_log row for spv:${spvId}`).toBeTruthy();
    expect(String(row!.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.actorId).toBe(MANAGING);
  });

  it("the payload equals the STORED spv_fee row — compared against listFees(), never a literal", () => {
    const stored = spvEngineStore.listFees(PARTNER_A, spvId)[0];
    const payload = JSON.parse(String(rowFor("spv.fee_set", spvId)!.payloadJson));
    expect(payload.feeId).toBe(stored.id);
    expect(payload.layer).toBe(stored.layer);
    expect(payload.feeType).toBe(stored.feeType);
    expect(payload.currency).toBe(stored.currency);
    expect(payload.effectiveDate).toBe(stored.effectiveDate);
    expect(payload.revisionHash).toBe(stored.revisionHash);
    expect(payload.fixedAmountMinor).toBe(String(stored.fixedAmountMinor));
    expect(typeof payload.fixedAmountMinor).toBe("string");
    expect(payload.auditWaveCompleted).toBe(278);
    /* NEVER CONVERTED: the currency on the row is the currency in the store. */
    expect(payload.currency).toBe("USD");
  });

  it("a pure-carry fee records fixedAmountMinor as null and carryPct verbatim, unscaled", async () => {
    const created = await launch();
    const id = String(created.body.spv.id);
    const r = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management",
      feeType: "carry",
      carryPct: 0.185,
    });
    expect(r.status).toBe(201);
    const stored = spvEngineStore.listFees(PARTNER_A, id)[0];
    const payload = JSON.parse(String(rowFor("spv.fee_set", id)!.payloadJson));
    expect(payload.fixedAmountMinor).toBeNull();
    expect(payload.fixedAmountMinor).not.toBe("0");
    /* NO SCALING. 0.185 is recorded as "0.185", not "18.5" and not "185". */
    expect(payload.carryPct).toBe(String(stored.carryPct));
    expect(payload.carryPct).toBe("0.185");
  }, 60_000);

  it("a non-USD fee records its own currency and is never converted", async () => {
    const created = await launch();
    const id = String(created.body.spv.id);
    const r = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management",
      feeType: "fixed",
      fixedAmountMinor: 750_000,
      currency: "JPY",
    });
    expect(r.status).toBe(201);
    const stored = spvEngineStore.listFees(PARTNER_A, id)[0];
    const payload = JSON.parse(String(rowFor("spv.fee_set", id)!.payloadJson));
    expect(payload.currency).toBe(stored.currency);
    expect(payload.currency).toBe("JPY");
    expect(payload.fixedAmountMinor).toBe(String(stored.fixedAmountMinor));
    expect(payload.fixedAmountMinor).toBe("750000");
  }, 60_000);
});

describe("W278b A3 — the ATOMIC launch (one call, mandate + fees) is audited too", () => {
  let spvId = "";

  beforeAll(async () => {
    const created = await launch({
      mandate: {
        mode: "sector_restricted",
        ruleTree: { op: "and", children: [] },
        sector: ["fintech"],
        geography: ["us"],
        stage: ["seed"],
        checkMinMinor: 500_000,
        checkMaxMinor: 4_000_000,
      },
      fees: [{ layer: "management", feeType: "fixed", fixedAmountMinor: 200_000, currency: "USD" }],
    });
    expect(created.status).toBe(201);
    expect(created.body.launchComplete).toBe(true);
    spvId = String(created.body.spv.id);
  }, 120_000);

  it("ONE HTTP call produced BOTH new audit rows", () => {
    expect(rowFor("spv.mandate_set", spvId), "atomic launch wrote no mandate audit row").toBeTruthy();
    expect(rowFor("spv.fee_set", spvId), "atomic launch wrote no fee audit row").toBeTruthy();
  });

  it("both rows still match the stored state, and both name the real actor", () => {
    const m = spvEngineStore.getMandate(PARTNER_A, spvId)!;
    const f = spvEngineStore.listFees(PARTNER_A, spvId)[0];
    const mp = JSON.parse(String(rowFor("spv.mandate_set", spvId)!.payloadJson));
    const fp = JSON.parse(String(rowFor("spv.fee_set", spvId)!.payloadJson));
    expect(mp.mandateId).toBe(m.id);
    expect(mp.mode).toBe(m.mode);
    expect(fp.feeId).toBe(f.id);
    expect(fp.fixedAmountMinor).toBe(String(f.fixedAmountMinor));
    expect(rowFor("spv.mandate_set", spvId)!.actorId).toBe(MANAGING);
    expect(rowFor("spv.fee_set", spvId)!.actorId).toBe(MANAGING);
  });
});

describe("W278b A4 — THE ABSOLUTE RULE: no pre-existing audit row is rewritten or deleted", () => {
  it("every row that existed before the writes is byte-identical afterwards, and the count only GREW", async () => {
    const before = auditFingerprint();
    expect(before.length, "the fingerprint is EMPTY — this comparison could not distinguish anything").toBeGreaterThan(0);

    const created = await launch();
    const id = String(created.body.spv.id);
    await put(`/api/partner/me/spv/${id}/mandate`, { mode: "open", ruleTree: { op: "and", children: [] } });
    await post(`/api/partner/me/spv/${id}/fees`, { layer: "management", feeType: "fixed", fixedAmountMinor: 100_000, currency: "USD" });

    const after = auditFingerprint();
    expect(after.length).toBeGreaterThan(before.length);
    /* The prefix of `after` must be `before`, byte for byte. Any UPDATE, any
       DELETE and any re-chaining of an existing row breaks this. */
    expect(after.slice(0, before.length)).toEqual(before);
    /* And the new rows must genuinely include ours, or the assertion above is
       satisfied by an unrelated write and proves nothing (mechanism 9). */
    const added = after.slice(before.length).join("\n");
    expect(added).toContain("spv.mandate_set");
    expect(added).toContain("spv.fee_set");
  }, 120_000);
});

describe("W278b A6 — two fees in one atomic launch write TWO fee rows, not one", () => {
  it("one row per fee term set", async () => {
    const created = await launch({
      fees: [
        { layer: "management", feeType: "fixed", fixedAmountMinor: 150_000, currency: "USD" },
        { layer: "management", feeType: "carry", carryPct: 0.1 },
      ],
    });
    expect(created.status).toBe(201);
    const id = String(created.body.spv.id);
    expect(spvEngineStore.listFees(PARTNER_A, id)).toHaveLength(2);
    /* CONSEQUENCE, not existence: exactly two, matching the two stored fees. */
    const rows = rowsFor("spv.fee_set", id);
    expect(rows).toHaveLength(2);
    const feeIds = rows.map((r) => JSON.parse(String(r.payloadJson)).feeId).sort();
    expect(feeIds).toEqual(spvEngineStore.listFees(PARTNER_A, id).map((f) => f.id).sort());
  }, 120_000);
});

describe("W278b A8 — the rows are VISIBLE through the endpoint the admin screen reads", () => {
  it("GET /api/admin/audit-log serves both new event types from the TABLE, not the mirror", async () => {
    const created = await launch({
      mandate: { mode: "open", ruleTree: { op: "and", children: [] } },
      fees: [{ layer: "management", feeType: "fixed", fixedAmountMinor: 120_000, currency: "USD" }],
    });
    expect(created.status).toBe(201);
    const id = String(created.body.spv.id);

    for (const action of ["spv.mandate_set", "spv.fee_set"]) {
      const resp = await request(app)
        .get(`/api/admin/audit-log?limit=500&eventType=${action}`)
        .set(ADMIN);
      expect(resp.status).toBe(200);
      /* `fallback: true` means the in-memory mirror answered. A proof on the
         mirror proves nothing about the durable ledger. */
      expect(resp.body.fallback).not.toBe(true);
      const item = (resp.body.items as Array<any>).find((i) => i.entity === `spv:${id}`);
      expect(item, `${action} is in audit_log but NOT reachable through the read endpoint`).toBeTruthy();
      expect(item.eventType).toBe(action);
      expect(item.actor).toBe(MANAGING);
    }
  }, 120_000);
});
