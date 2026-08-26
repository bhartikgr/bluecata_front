/**
 * WAVE 151 · ITEM C · R105 — A COMMIT THAT PASSES AN SPV'S CAP IS RECORDED.
 *
 * R105 requires three things of `POST /api/partner/me/spv/:spvId/lp-commit`,
 * which deliberately does NOT re-run the subscribe() cap gate (the sacred ledger
 * has already recorded the money by the time the roster is projected):
 *
 *   (1) a clear PRE-COMMIT warning naming cap, current committed total, overage
 *       — the client half, pinned in the rendered-DOM test alongside this file;
 *   (2) a DURABLE, TIMESTAMPED audit record naming operator, SPV, cap, resulting
 *       total and overage — `audit_log` via `appendAdminAudit`;
 *   (3) the overage VISIBLE afterwards on the SPV — `terms._capOverrides`.
 *
 * ANTI-VACUITY. Every money assertion below is against a figure DERIVED from the
 * amounts this test posted (cap − total, etc.), the audit row is read out of
 * `audit_log` with raw SQL rather than from any helper this wave wrote, and the
 * SPV `terms` are read back through `getSpv` (the store's own read path), not
 * from the write's return value.
 *
 * THE K-1 PIN. C-T3 is the one that matters most: `updateSpv` (spvEngineStore.ts
 * :502) assigns `s.terms = patch.terms` wholesale, so a careless override write
 * would DELETE `terms._fundsConfirmations` and every K-1 / funds-received surface
 * reading `confirmedByInvestor` would silently return nothing. It is pinned
 * explicitly, from the store's own reader.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { spvEngineStore, computeCapImpact } from "../spvEngineStore";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { lpInvestorIdForEmail } from "../lib/lpIdentity";

const MANAGING = "u_avi_managing";
const PARTNER_ID = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}

/** An SPV with an explicit cap, in minor units. */
async function newCappedSpv(name: string, capMinor: number): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  const id = c.body.spv.id as string;
  spvEngineStore.updateSpv(PARTNER_ID, id, { capMinor }, "u_test_seed");
  expect(spvEngineStore.getSpv(PARTNER_ID, id)!.capMinor).toBe(capMinor);
  return id;
}

function commit(spvId: string, email: string, amountWholeUnits: string, units = "100") {
  return post(`/api/partner/me/spv/${spvId}/lp-commit`, {
    holderFirstName: "Lp",
    holderLastName: "Holder",
    investorEmail: email,
    amount: amountWholeUnits,
    shares: units,
  });
}

/** The audit rows this wave writes, newest first, read with raw SQL. */
function capOverrideAuditRows(spvId: string): Array<{ payload: Record<string, unknown>; actorId: string; ts: string }> {
  const rows = rawDb()
    .prepare(
      `SELECT actor_id AS actorId, created_at AS ts, payload_json AS payloadJson
         FROM audit_log
        WHERE action = 'spv.cap_override_recorded' AND target = ?
        ORDER BY created_at DESC, id DESC`,
    )
    .all(`spv:${spvId}`) as Array<{ actorId: string; ts: string; payloadJson: string }>;
  return rows.map((r) => ({ actorId: r.actorId, ts: r.ts, payload: JSON.parse(r.payloadJson) }));
}

function overridesOnSpv(spvId: string) {
  return spvEngineStore.capOverridesForSpv(PARTNER_ID, spvId);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

/* ── C-T1 + C-T2 — the record, and the figures in it ───────────────────────── */
describe("C-T1/C-T2 — an over-cap commit is recorded with the right cap, total and overage", () => {
  it("writes the audit row AND the durable SPV record, and reports both to the caller", async () => {
    // Cap 1,000,000.00 USD => 100_000_000 minor units.
    const capMinor = 100_000_000;
    const spvId = await newCappedSpv("W151 Cap Override SPV", capMinor);

    // First LP: 900,000.00 — inside the cap, so nothing may be recorded.
    const a = await commit(spvId, "w151.a@example.com", "900000");
    expect(a.status).toBe(201);
    expect(a.body.cap.overCap).toBe(false);
    expect(a.body.cap.overageMinor).toBe(0);
    expect(a.body.cap.overrideRecorded).toBe(false);
    expect(capOverrideAuditRows(spvId).length).toBe(0);
    expect(overridesOnSpv(spvId).length).toBe(0);

    // Second LP: 250,000.00 — takes the vehicle to 1,150,000.00, i.e. 150,000.00 over.
    const b = await commit(spvId, "w151.b@example.com", "250000");
    expect(b.status).toBe(201);

    const expectedTotal = 90_000_000 + 25_000_000;
    const expectedOverage = expectedTotal - capMinor; // 15_000_000
    expect(expectedOverage).toBe(15_000_000);

    // (a) reported to the caller
    expect(b.body.cap.capMinor).toBe(capMinor);
    expect(b.body.cap.committedBeforeMinor).toBe(90_000_000);
    expect(b.body.cap.resultingTotalMinor).toBe(expectedTotal);
    expect(b.body.cap.overageMinor).toBe(expectedOverage);
    expect(b.body.cap.overCap).toBe(true);
    expect(b.body.cap.overrideRecorded).toBe(true);
    expect(b.body.cap.overrideRecordFailed).toBe(false);
    expect(b.body.cap.basis).toBe("status !== withdrawn");
    // the bigint sum never reaches JSON — it is narrowed to a number at the boundary
    expect(typeof b.body.cap.canonicalCommittedMinor).toBe("number");

    // (b) R105(2) — the durable timestamped audit record
    const rows = capOverrideAuditRows(spvId);
    expect(rows.length).toBe(1);
    expect(rows[0].actorId).toBe(MANAGING);
    expect(String(rows[0].ts).length).toBeGreaterThan(0);
    expect(new Date(String(rows[0].ts)).toString()).not.toBe("Invalid Date");
    expect(rows[0].payload.spvId).toBe(spvId);
    expect(rows[0].payload.capMinor).toBe(capMinor);
    expect(rows[0].payload.resultingTotalMinor).toBe(expectedTotal);
    expect(rows[0].payload.overageMinor).toBe(expectedOverage);
    expect(rows[0].payload.investorId).toBe(lpInvestorIdForEmail("w151.b@example.com"));
    expect(rows[0].payload.investorEmail).toBe("w151.b@example.com");
    expect(rows[0].payload.currency).toBe("USD");

    // (c) R105(3) — visible on the SPV afterwards, read back through the store
    const durable = overridesOnSpv(spvId);
    expect(durable.length).toBe(1);
    expect(durable[0].capMinor).toBe(capMinor);
    expect(durable[0].resultingTotalMinor).toBe(expectedTotal);
    expect(durable[0].overageMinor).toBe(expectedOverage);
    expect(durable[0].actor).toBe(MANAGING);
    expect(durable[0].recordedAt.length).toBeGreaterThan(0);
  });
});

/* ── C-T3 — THE K-1 PIN ───────────────────────────────────────────────────── */
describe("C-T3 — _fundsConfirmations SURVIVES a cap-override write", () => {
  it("the funds-received bag and the override bag coexist in terms", async () => {
    const capMinor = 50_000_000; // 500,000.00
    const spvId = await newCappedSpv("W151 K1 Survival SPV", capMinor);

    // Seat an LP within cap, then record an offline wire confirmation for them:
    // this is the write whose destruction would break every K-1 on the vehicle.
    const email = "w151.k1@example.com";
    const first = await commit(spvId, email, "400000");
    expect(first.status).toBe(201);
    const investorId = lpInvestorIdForEmail(email);
    spvEngineStore.confirmFundsReceived(PARTNER_ID, spvId, investorId, 40_000_000, "WIRE-K1", MANAGING);

    const beforeBag = spvEngineStore.confirmedByInvestor(PARTNER_ID, spvId);
    expect(beforeBag[investorId]).toBe(40_000_000);

    // A SECOND LP pushes past the cap, which triggers the override write.
    const over = await commit(spvId, "w151.k1b@example.com", "300000");
    expect(over.status).toBe(201);
    expect(over.body.cap.overCap).toBe(true);
    expect(over.body.cap.overrideRecorded).toBe(true);

    // THE PIN: the funds confirmation is still there, byte-for-byte, read through
    // the store's own reader — the one every K-1 surface uses.
    const afterBag = spvEngineStore.confirmedByInvestor(PARTNER_ID, spvId);
    expect(afterBag).toEqual(beforeBag);
    expect(afterBag[investorId]).toBe(40_000_000);

    // and the raw terms hold BOTH keys, so nothing was replaced wholesale
    const terms = (spvEngineStore.getSpv(PARTNER_ID, spvId)!.terms ?? {}) as Record<string, unknown>;
    expect(terms._fundsConfirmations).toBeTruthy();
    expect(terms._capOverrides).toBeTruthy();
    const confs = terms._fundsConfirmations as Record<string, { receivedMinor: number; reference: string | null }>;
    expect(confs[investorId].receivedMinor).toBe(40_000_000);
    expect(confs[investorId].reference).toBe("WIRE-K1");
  });
});

/* ── C-T4 — THE IN-CALL OVERLAP ───────────────────────────────────────────── */
describe("C-T4 — an amended commitment REPLACES the LP's own figure, it does not stack", () => {
  it("the overage counts the LP once, and a no-op re-commit reports no overage", async () => {
    const capMinor = 100_000_000; // 1,000,000.00
    const spvId = await newCappedSpv("W151 Overlap SPV", capMinor);
    const email = "w151.overlap@example.com";

    // 1,000,000.00 — exactly AT the cap, not over it.
    const at = await commit(spvId, email, "1000000");
    expect(at.status).toBe(201);
    expect(at.body.cap.resultingTotalMinor).toBe(100_000_000);
    expect(at.body.cap.overCap).toBe(false);

    /* THE OVERLAP. The same LP is now amended UP to 1,050,000.00. The naive
       `committedBefore + amount` would report a total of 2,050,000.00 and an
       overage of 1,050,000.00 — counting this LP's existing 1,000,000.00 twice,
       because `projectLpCommitted` ASSIGNS the new figure onto their row rather
       than adding to it. The truthful overage is 50,000.00. A different email is
       used for the ledger's idempotency key by amending through the store-facing
       route again with the SAME email, which is the real amendment path. */
    const up = await commit(spvId, email, "1050000", "105");
    expect(up.status).toBe(200); // idempotent ledger line, same deterministic key
    expect(up.body.cap.committedBeforeMinor).toBe(100_000_000);
    expect(up.body.cap.existingContributionMinor).toBeUndefined(); // not leaked to the wire
    expect(up.body.cap.resultingTotalMinor).toBe(105_000_000);
    expect(up.body.cap.overageMinor).toBe(5_000_000);
    expect(up.body.cap.resultingTotalMinor).not.toBe(205_000_000);

    /* The arithmetic itself, exercised directly against the store so the
       correction is pinned independently of the route's plumbing. */
    const investorId = lpInvestorIdForEmail(email);
    const impact = computeCapImpact(spvId, investorId, 105_000_000, capMinor);
    expect(impact.existingContributionMinor).toBeGreaterThan(0);
    expect(impact.resultingTotalMinor).toBe(
      impact.committedBeforeMinor - impact.existingContributionMinor + 105_000_000,
    );

    /* A zero/non-finite amount must PREDICT WHAT THE PROJECTION WILL DO — which
       is to leave the existing figure alone (spvEngineStore.ts:1571) — not to
       treat the commitment as zero. */
    const noop = computeCapImpact(spvId, investorId, 0, capMinor);
    expect(noop.effectiveNewCommitmentMinor).toBe(noop.existingContributionMinor);
    expect(noop.resultingTotalMinor).toBe(noop.committedBeforeMinor);
  });
});

/* ── C-T5 — silence when nothing happened ─────────────────────────────────── */
describe("C-T5 — a legitimate within-cap commit writes NO override record", () => {
  it("no audit row, no terms key, and the response says so", async () => {
    const spvId = await newCappedSpv("W151 Within Cap SPV", 100_000_000);
    const r = await commit(spvId, "w151.within@example.com", "10000");
    expect(r.status).toBe(201);
    expect(r.body.cap.overCap).toBe(false);
    expect(r.body.cap.overageMinor).toBe(0);
    expect(r.body.cap.overrideRecorded).toBe(false);
    expect(capOverrideAuditRows(spvId).length).toBe(0);
    expect(overridesOnSpv(spvId).length).toBe(0);
    const terms = (spvEngineStore.getSpv(PARTNER_ID, spvId)!.terms ?? {}) as Record<string, unknown>;
    expect(terms._capOverrides).toBeUndefined();
  });

  it("an SPV with NO cap is never over cap (null is not zero)", async () => {
    const c = await post("/api/partner/me/spv", {
      name: "W151 Uncapped SPV",
      jurisdiction: "delaware",
      carryBasis: "whole_spv",
      status: "open",
      signoffLegalName: "Avi Managing",
      signoffAccepted: true,
    });
    expect(c.status).toBe(201);
    const spvId = c.body.spv.id as string;
    expect(spvEngineStore.getSpv(PARTNER_ID, spvId)!.capMinor).toBeNull();
    const r = await commit(spvId, "w151.nocap@example.com", "99999999");
    expect(r.status).toBe(201);
    expect(r.body.cap.capMinor).toBeNull();
    expect(r.body.cap.overCap).toBe(false);
    expect(capOverrideAuditRows(spvId).length).toBe(0);
  });
});

/* ── C-T6 — REGRESSION GUARD (passes before AND after this wave) ───────────── */
describe("C-T6 [REGRESSION GUARD, not a fail-before] — projectLpCommitted ASSIGNS", () => {
  it("a replayed identical commit does not move the total and adds no second record", async () => {
    const capMinor = 20_000_000;
    const spvId = await newCappedSpv("W151 Replay SPV", capMinor);
    const email = "w151.replay@example.com";

    const over = await commit(spvId, email, "300000"); // 30,000,000 > 20,000,000
    expect(over.status).toBe(201);
    expect(over.body.cap.overCap).toBe(true);
    const totalAfterFirst = over.body.cap.resultingTotalMinor as number;
    expect(capOverrideAuditRows(spvId).length).toBe(1);

    // The SAME request again. `existing.commitmentMinor = ...` is an ASSIGNMENT,
    // not `+=`, so the total is unchanged. The V2 review's "double-count" claim
    // is false; this test exists so nobody "fixes" it.
    const again = await commit(spvId, email, "300000");
    expect(again.status).toBe(200);
    expect(again.body.idempotent).toBe(true);
    expect(again.body.cap.resultingTotalMinor).toBe(totalAfterFirst);

    // and a replay writes no SECOND audit row — no phantom breach accumulates
    expect(capOverrideAuditRows(spvId).length).toBe(1);
    expect(overridesOnSpv(spvId).length).toBe(1);
  });
});
