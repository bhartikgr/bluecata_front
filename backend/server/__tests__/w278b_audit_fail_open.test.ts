/**
 * WAVE 278b · A5 — FAIL-OPEN, LOUD: PROVED, NOT ASSUMED.
 *
 * `spvLifecycleAudit`'s contract (module rule 3) is that an audit failure must
 * NEVER roll back the business write. That is a property of the code, and a
 * happy-path test cannot tell it apart from luck — so this file INJECTS the
 * fault at the only place it can occur and drives the real HTTP routes.
 *
 * TWO FAULTS, because there are two failure modes and only one of them is on
 * the code's expected path:
 *   F1  `appendAdminAudit` returns the empty-hash SENTINEL (`isAuditWriteFailure`
 *       true). This is what a real SQLite write failure looks like: it does NOT
 *       throw. The writer must log at error level, count the loss into audit-write
 *       health, and let `setMandate` / `addFee` return normally.
 *   F2  `appendAdminAudit` THROWS. Not expected (it catches internally) but the
 *       writer wraps everything in try/catch precisely so this cannot take the
 *       money path down with it.
 *
 * WHY THIS FILE IS SEPARATE from `w278b_mandate_and_fee_audit.test.ts`: that
 * file must run against the REAL, unmocked store and the REAL database, because
 * its whole value is reading the stored row back. `vi.mock` is file-scoped, so
 * the fault injection lives here and nowhere near the durable proofs.
 *
 * The mock replaces exactly ONE export and passes everything else through with
 * `importActual`, so `reportAuditWriteOutcome` and the health counters are the
 * real ones and the health assertion is not itself a replica.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

/** The injected fault, switchable per test. `null` = behave normally. */
let injected: null | "sentinel" | "throw" = null;

/** Set by the injected `appendAdminAudit` the first time it actually runs.
 *  If this is false, EVERY result in this file is meaningless. */
let mockIsLive = false;

/** Every `reportAuditWriteOutcome` call the writers make, and its verdict.
 *  See the AN INERT MECHANISM I FOUND IN MY OWN TEST note below for why this,
 *  and not the boot counter, is the observable that means something here. */
const outcomes: Array<{ action: string; bearing: string; subject?: string; lost: boolean }> = [];

vi.mock("../adminPlatformStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminPlatformStore")>();
  return {
    ...actual,
    reportAuditWriteOutcome: (entry: any, ctx: any) => {
      /* The REAL function decides the verdict; this only records that it ran
         and what it returned. Re-implementing the predicate here would prove my
         own arithmetic instead of the platform's (handbook §8, instance 4). */
      const ok = actual.reportAuditWriteOutcome(entry, ctx);
      outcomes.push({ action: ctx.action, bearing: ctx.bearing, subject: ctx.subject, lost: !ok });
      return ok;
    },
    appendAdminAudit: (
      actor: string,
      entity: string,
      eventType: string,
      payload: Record<string, unknown>,
      tenantId?: string,
    ) => {
      mockIsLive = true;
      if (injected === "throw") throw new Error("W278b injected: audit append threw");
      if (injected === "sentinel") {
        /* Exactly the shape `appendAudit`'s own catch block returns: a normal
           entry object whose `hash` is empty. NOT a throw. */
        return { id: "", tenantId: tenantId ?? "", actor, entity, eventType, payload, ts: "", priorHash: "", hash: "" } as any;
      }
      return actual.appendAdminAudit(actor, entity, eventType, payload, tenantId);
    },
  };
});

/* ── IMPORT ORDER IS LOad-BEARING. DO NOT REORDER. ────────────────────────────
   `../lib/spvLifecycleAudit` MUST be imported before the route modules. If the
   route modules load first, `spvLifecycleAudit` is pulled in through their
   dependency graph (partly via the CJS require shim in
   `_fixtures/vitestRequireShim.ts`) and binds the REAL `adminPlatformStore`,
   after which this file's `vi.mock` is completely inert — the factory is never
   even invoked. That was measured, not assumed: with the routes imported first
   the injected `appendAdminAudit` logged ZERO times across the whole file while
   every assertion still went green. That is inert-proof mechanism 4 exactly — a
   fence that exists but is never passed — and the `mockIsLive` control below
   exists so it can never happen again silently. */
const spvLifecycleAudit = await import("../lib/spvLifecycleAudit");
void spvLifecycleAudit;
const { registerPartnerRoutes } = await import("../partnerRoutes");
const { registerSpvEngineRoutes } = await import("../spvEngineRoutes");
const { seedTestPartnerSandbox } = await import("../partnerWorkspaceStore");
const { spvEngineStore } = await import("../spvEngineStore");
const { getAuditWriteHealth, _resetAuditWriteHealthForTest } = await import("../adminPlatformStore");

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
const put = (p: string, body?: unknown) =>
  request(app).put(p).set("x-user-id", MANAGING).send(body ?? {});

let seq = 0;
const launchBody = () => ({
  name: `W278b failopen ${Date.now()}_${seq++}`,
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
  terms: { mandateDescription: "W278b fail-open probe" },
  signoffLegalName: "Avi Managing",
  signoffAccepted: true,
});

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

beforeEach(() => {
  injected = null;
  outcomes.length = 0;
});

/** Created with the fault OFF, so the vehicle itself is never the variable. */
async function freshSpv(): Promise<string> {
  injected = null;
  const created = await post("/api/partner/me/spv", launchBody());
  expect(created.status, "the vehicle must be created cleanly — the fault is injected AFTER this").toBe(201);
  return String(created.body.spv.id);
}

describe("W278b A5 · F1 — a LOST audit row (empty-hash sentinel) does not fail the business write", () => {
  it("setMandate still succeeds and the mandate still persists", async () => {
    const id = await freshSpv();
    injected = "sentinel";
    const res = await put(`/api/partner/me/spv/${id}/mandate`, {
      mode: "sector_restricted",
      ruleTree: { op: "and", children: [] },
      sector: ["fintech"],
      checkMinMinor: 1_000_000,
      checkMaxMinor: 2_000_000,
    });
    /* CONSEQUENCE: 200, a returned DTO, AND a durable mandate. */
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mandate?.id).toMatch(/^spvmnd/);
    const stored = spvEngineStore.getMandate(PARTNER_A, id);
    expect(stored, "the mandate was rolled back by an audit failure — fail-open is BROKEN").toBeTruthy();
    expect(stored!.mode).toBe("sector_restricted");
    expect(stored!.checkMaxMinor).toBe(2_000_000);
  }, 60_000);

  it("addFee still succeeds and the fee still persists", async () => {
    const id = await freshSpv();
    injected = "sentinel";
    const res = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management",
      feeType: "fixed",
      fixedAmountMinor: 300_000,
      currency: "USD",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const fees = spvEngineStore.listFees(PARTNER_A, id);
    expect(fees, "the fee was rolled back by an audit failure — fail-open is BROKEN").toHaveLength(1);
    expect(fees[0].fixedAmountMinor).toBe(300_000);
    expect(fees[0].currency).toBe("USD");
  }, 60_000);

  /* ── AN INERT MECHANISM I FOUND IN MY OWN TEST ─────────────────────────────
     This assertion FIRST read `getAuditWriteHealth().writeFailuresSinceBoot`
     and expected it to grow by 2. It came back 0, and the reason is a genuine
     property of the platform, not a bug in the writers:

       `_auditWriteFailuresSinceBoot` is incremented ONLY by
       `noteAuditWriteFailure`, which is called ONLY from `appendAudit`'s own
       catch block (`adminPlatformStore.ts:1683`). `reportAuditWriteOutcome`
       LOGS the loss; it does NOT increment that counter.

     This file injects the fault at `appendAdminAudit`, which sits ABOVE
     `appendAudit` — so `appendAudit` never runs and the counter physically
     cannot move. Asserting on it was inert-proof mechanism 5: a filter keyed to
     a field the writer never writes. It would have gone green the day the
     writers were deleted, for a reason unrelated to them.

     What IS observable, and what the writers are actually responsible for, is
     that they hand the lost entry to `reportAuditWriteOutcome` with the right
     bearing. That is asserted below. In a REAL DB failure `appendAudit` runs,
     its catch fires, and the boot counter does move — that path is pinned by
     wave 186's own tests and is deliberately not re-proved from a mock here. */
  it("LOUD, not silent: each loss is reported with the correct BEARING", async () => {
    _resetAuditWriteHealthForTest();
    const id = await freshSpv();
    outcomes.length = 0;
    injected = "sentinel";
    await put(`/api/partner/me/spv/${id}/mandate`, { mode: "open", ruleTree: { op: "and", children: [] } });
    await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management", feeType: "fixed", fixedAmountMinor: 100_000, currency: "USD",
    });
    injected = null;

    const mandate = outcomes.filter((o) => o.action === "spv.mandate_set");
    const fee = outcomes.filter((o) => o.action === "spv.fee_set");
    /* EXACTLY one report per writer — a count is an observation. */
    expect(mandate).toHaveLength(1);
    expect(fee).toHaveLength(1);
    /* BEARING is the consequence: it is what triages the loss for an operator.
       A lost fee row must be triaged as a MONEY loss, not as routine. */
    expect(mandate[0].bearing).toBe("identity");
    expect(fee[0].bearing).toBe("money");
    expect(mandate[0].subject).toBe(`spv:${id}`);
    expect(fee[0].subject).toBe(`spv:${id}`);
    /* And the real predicate must have judged both as LOST. */
    expect(mandate[0].lost).toBe(true);
    expect(fee[0].lost).toBe(true);
    /* Honest and asserted: the boot counter does NOT move under THIS
       injection, for the reason in the note above. Stated, not hidden. */
    expect(getAuditWriteHealth().writeFailuresSinceBoot).toBe(0);
  }, 60_000);
});

describe("W278b A5 · F2 — a THROWN audit failure does not fail the business write either", () => {
  it("setMandate and addFee both still succeed and both rows still persist", async () => {
    const id = await freshSpv();
    injected = "throw";
    const m = await put(`/api/partner/me/spv/${id}/mandate`, {
      mode: "open",
      ruleTree: { op: "and", children: [] },
    });
    const f = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management", feeType: "carry", carryPct: 0.2,
    });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    expect(spvEngineStore.getMandate(PARTNER_A, id)).toBeTruthy();
    expect(spvEngineStore.listFees(PARTNER_A, id)).toHaveLength(1);
    expect(spvEngineStore.listFees(PARTNER_A, id)[0].carryPct).toBe(0.2);
  }, 60_000);
});

describe("W278b A5 · control — the fault injection is REAL, not inert", () => {
  it("THE FENCE WAS PASSED: the injected appendAdminAudit actually ran", async () => {
    /* Asserted FIRST, before anything is read from a green tick in this file.
       Without this, every other assertion here can pass against the unmocked
       module and prove nothing at all — which is exactly what happened once. */
    const id = await freshSpv();
    injected = "sentinel";
    await put(`/api/partner/me/spv/${id}/mandate`, { mode: "open", ruleTree: { op: "and", children: [] } });
    injected = null;
    expect(mockIsLive, "vi.mock is INERT in this file — see the import-order note above").toBe(true);
  }, 60_000);

  it("with the fault OFF the same requests succeed and NO loss is counted", async () => {
    _resetAuditWriteHealthForTest();
    const before = getAuditWriteHealth().writeFailuresSinceBoot;
    const id = await freshSpv();
    injected = null;
    const m = await put(`/api/partner/me/spv/${id}/mandate`, { mode: "open", ruleTree: { op: "and", children: [] } });
    const f = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management", feeType: "fixed", fixedAmountMinor: 100_000, currency: "USD",
    });
    expect(m.status).toBe(200);
    expect(f.status).toBe(201);
    /* THE CONTROL THAT MAKES F1 MEAN SOMETHING. With the fault off, both
       writers still REPORT — with `lost: false`. If `lost` were true here too,
       the F1 assertion would be scoring the injection rather than the loss. */
    expect(outcomes.filter((o) => o.action === "spv.mandate_set")).toHaveLength(1);
    expect(outcomes.filter((o) => o.action === "spv.fee_set")).toHaveLength(1);
    expect(outcomes.every((o) => o.lost === false)).toBe(true);
    expect(getAuditWriteHealth().writeFailuresSinceBoot - before).toBe(0);
  }, 60_000);
});
