/**
 * WAVE 26 — S-3 SECOND PATH: a failed `spv_fee` hydration must not be able to
 * produce a fee-free money surface anywhere.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * Wave 5 shipped the S-3 machinery (`spv_fee_hydration_state`,
 * `feeStateUnknown()`, `probeFeeRowCount()`) and wired it into ONE consumer,
 * `hasUnsettledFixedFees`. Its own report says, verbatim: "Not executed. I did
 * not write an S-3 test. The reasoning above is TRACED STATICALLY... It needs a
 * fault-injection test before release." No such test was ever written — a grep
 * for `spv_fee_hydration_state` or `probeFeeRowCount` across `server/__tests__`
 * and `client/src` returned zero hits before this file.
 *
 * Executing that reasoning found the fix was also INCOMPLETE. Four further
 * functions read the same `feesBySpv` map through `effectiveFee()` with no
 * knowledge of the hydration verdict:
 *
 *   feeBreakdown()             → mgmt 0, platform 0, netDeployed = the WHOLE
 *                                commitment. An investor is shown a fee-free
 *                                SPV because a SELECT failed.
 *   recordDistribution()       → gpCarryPct 0 and platCarryPct 0 on a
 *                                PERSISTED, hash-chained money movement. No
 *                                fee gate guarded this function at all.
 *   previewDistributionSplit() → the same carry-free split, shown to the GP who
 *                                is deciding what to distribute.
 *   accrueFundingFeeObligations() → accrues nothing and returns [], which reads
 *                                as "no funding fees are owed".
 *
 * HOW THE FAULT IS INJECTED — and why it is injected THIS way
 * -----------------------------------------------------------
 * The failure being modelled is: the boot-time `spv_fee` SELECT threw, so
 * `feesBySpv` is EMPTY while rows sit on disk. So the test writes fee rows
 * STRAIGHT INTO SQLITE and never through `addFee` (which writes the row and the
 * in-memory map in one transaction). Creating the fee through the store would
 * populate both and could not tell a durable read from a RAM read — that is the
 * shape of a check that checks nothing, of which this build has fourteen.
 *
 * BOTH POLES are asserted for every sink: with the verdict 'ok' the real
 * numbers still come through unchanged (a guard that is always shut is a
 * silent removal of working functionality, not a fix), and with the verdict
 * poisoned every sink refuses.
 *
 * JPY FIXTURE. Every money assertion here is repeated in JPY (ISO-4217
 * exponent 0). A hardcoded `/100` passes every USD test in this repository.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getDb, rawDb } from "../db/connection";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { readFeeHydration, recordFeeHydration, feeStateUnknown, probeFeeRowCount } from "../lib/spvFeeHydrationState";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const MANAGING = "u_avi_managing";

function db(): any {
  getDb();
  return rawDb() as any;
}

/** Restore the verdict to the healthy pole. */
function setHydrationOk(): void {
  recordFeeHydration("ok", 1, null);
}
/** The dangerous pole: hydration is known to have failed. */
function setHydrationFailed(): void {
  recordFeeHydration("failed", 0, "injected: spv_fee SELECT threw");
}

/**
 * Write a fee row DIRECTLY to sqlite, bypassing `addFee`, so the DB has a fee
 * the in-memory map does not. This is exactly the post-failed-hydration state.
 */
function insertOrphanFeeRow(spvId: string, layer: string, currency: string): string {
  const id = `fee_orphan_${spvId}_${layer}`;
  db()
    .prepare(
      `INSERT OR REPLACE INTO spv_fee (id, spv_id, layer, fee_type, fixed_amount_minor, carry_pct,
         currency, effective_date, set_by, created_at, prev_hash, curr_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id, spvId, layer, "fixed", 5000, null, currency,
      "2026-01-01T00:00:00.000Z", "test", new Date().toISOString(),
      "0".repeat(64), `h_${id}`,
    );
  return id;
}

function deleteOrphanFeeRows(spvId: string): void {
  db().prepare(`DELETE FROM spv_fee WHERE spv_id = ? AND id LIKE 'fee_orphan_%'`).run(spvId);
}

function makeSpv(name: string, currency: string): string {
  return spvEngineStore.createSpv(
    PARTNER_A,
    { name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open", currency },
    MANAGING,
  ).id;
}

let usdSpv: string;
let jpySpv: string;

beforeAll(() => {
  seedTestPartnerSandbox();
  usdSpv = makeSpv("W26 S-3 USD", "USD");
  jpySpv = makeSpv("W26 S-3 JPY", "JPY");
});

afterEach(() => {
  deleteOrphanFeeRows(usdSpv);
  deleteOrphanFeeRows(jpySpv);
  setHydrationOk();
});

describe("WAVE 26 / S-3 — the fault-injection harness itself is real", () => {
  it("HARNESS POLE A — with the verdict 'ok', the fee view is TRUSTED", () => {
    setHydrationOk();
    expect(readFeeHydration().state).toBe("ok");
    expect(feeStateUnknown()).toBe(false);
    expect(spvEngineStore.feeViewUnreliable(usdSpv)).toBe(false);
  });

  it("HARNESS POLE B — a poisoned verdict PLUS an orphan DB row is detected", () => {
    setHydrationFailed();
    insertOrphanFeeRow(usdSpv, "management", "USD");
    expect(feeStateUnknown()).toBe(true);
    const probe = probeFeeRowCount(usdSpv);
    expect(probe.ok).toBe(true);
    // The whole point: the DB knows about a fee the in-memory map does not.
    expect(probe.count).toBeGreaterThan(0);
    expect(spvEngineStore.feeViewUnreliable(usdSpv)).toBe(true);
  });

  it("HARNESS NEGATIVE CONTROL — a poisoned verdict ALONE does not wedge the gate", () => {
    /* If this failed, `feeViewUnreliable` would be shutting every fee surface
       for correctly-configured SPVs whose fees were set through `addFee` in
       this same process — the opposite defect, and still a silent drop. */
    setHydrationFailed();
    expect(feeStateUnknown()).toBe(true);
    expect(probeFeeRowCount(usdSpv).count).toBe(0);
    expect(spvEngineStore.feeViewUnreliable(usdSpv)).toBe(false);
  });
});

describe("WAVE 26 / S-3 — SINK 1: feeBreakdown never fabricates a zero fee", () => {
  it("healthy pole — real numbers still come through (USD)", () => {
    setHydrationOk();
    const bd = spvEngineStore.feeBreakdown(usdSpv, 100000, "USD");
    expect(bd.feesUnknown).toBe(false);
    expect(bd.netDeployedMinor).toBe(100000); // no fees configured on this SPV
    expect(bd.managementFeeMinor).toBe(0);
  });

  it("faulted pole — amounts are WITHHELD, not zeroed (USD)", () => {
    setHydrationFailed();
    insertOrphanFeeRow(usdSpv, "management", "USD");
    const bd = spvEngineStore.feeBreakdown(usdSpv, 100000, "USD");
    expect(bd.feesUnknown).toBe(true);
    expect(bd.managementFeeMinor).toBeNull();
    expect(bd.platformFeeMinor).toBeNull();
    expect(bd.managementCarryPct).toBeNull();
    expect(bd.platformCarryPct).toBeNull();
    // THE DEFECT, stated as an assertion: net deployed must NOT silently become
    // the entire commitment just because the fee table could not be read.
    expect(bd.netDeployedMinor).not.toBe(100000);
    expect(bd.netDeployedMinor).toBeNull();
    // ...and it must not be a fabricated zero either.
    expect(bd.netDeployedMinor).not.toBe(0);
  });

  it("faulted pole — JPY (exponent 0) behaves identically, no /100 anywhere", () => {
    setHydrationFailed();
    insertOrphanFeeRow(jpySpv, "management", "JPY");
    const bd = spvEngineStore.feeBreakdown(jpySpv, 100000, "JPY");
    expect(bd.currency).toBe("JPY");
    expect(bd.feesUnknown).toBe(true);
    expect(bd.netDeployedMinor).toBeNull();
    // The commitment is echoed back in MINOR units untouched. For JPY, 100000
    // minor units is ¥100,000 — a `/100` here would render ¥1,000.
    expect(bd.commitmentMinor).toBe(100000);
  });

  it("healthy pole — JPY commitment is echoed in minor units, undivided", () => {
    setHydrationOk();
    const bd = spvEngineStore.feeBreakdown(jpySpv, 100000, "JPY");
    expect(bd.feesUnknown).toBe(false);
    expect(bd.commitmentMinor).toBe(100000);
    expect(bd.netDeployedMinor).toBe(100000);
  });
});

describe("WAVE 26 / S-3 — SINK 2: the PERSISTED distribution refuses", () => {
  it("faulted pole — recordDistribution throws BEFORE any precondition or write", () => {
    setHydrationFailed();
    insertOrphanFeeRow(usdSpv, "management", "USD");
    const before = db().prepare(`SELECT COUNT(*) AS c FROM spv_distribution WHERE spv_id = ?`).get(usdSpv);
    expect(() =>
      spvEngineStore.recordDistribution(
        PARTNER_A, usdSpv,
        { event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000 },
        MANAGING,
      ),
    ).toThrow("FEE_STATE_UNKNOWN");
    const after = db().prepare(`SELECT COUNT(*) AS c FROM spv_distribution WHERE spv_id = ?`).get(usdSpv);
    // Nothing was persisted by the refused call.
    expect(Number(after?.c ?? 0)).toBe(Number(before?.c ?? 0));
  });

  it("faulted pole — JPY SPV refuses identically", () => {
    setHydrationFailed();
    insertOrphanFeeRow(jpySpv, "management", "JPY");
    expect(() =>
      spvEngineStore.recordDistribution(
        PARTNER_A, jpySpv,
        { event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000 },
        MANAGING,
      ),
    ).toThrow("FEE_STATE_UNKNOWN");
  });

  it("healthy pole — the fee guard is NOT what stops a healthy call", () => {
    /* With a trusted fee view the call proceeds past the fee guard and fails on
       its own real precondition instead. If this ever throws FEE_STATE_UNKNOWN,
       the guard has been left permanently shut. */
    setHydrationOk();
    let msg = "";
    try {
      spvEngineStore.recordDistribution(
        PARTNER_A, usdSpv,
        { event: "exit", grossProceedsMinor: 1000000, costBasisMinor: 500000 },
        MANAGING,
      );
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toBe("FEE_STATE_UNKNOWN");
    expect(msg).toBe("NO_COMMITTED_LPS");
  });
});

describe("WAVE 26 / S-3 — SINK 3: the distribution PREVIEW refuses", () => {
  it("faulted pole — previewDistributionSplit throws instead of showing zero carry", () => {
    setHydrationFailed();
    insertOrphanFeeRow(usdSpv, "platform", "USD");
    expect(() =>
      spvEngineStore.previewDistributionSplit(PARTNER_A, usdSpv, { grossProceedsMinor: 1000000 }),
    ).toThrow("FEE_STATE_UNKNOWN");
  });

  it("healthy pole — the preview still computes", () => {
    setHydrationOk();
    const split = spvEngineStore.previewDistributionSplit(PARTNER_A, usdSpv, { grossProceedsMinor: 1000000 });
    expect(split).toBeTruthy();
    expect(typeof split.lpTotalMinor).toBe("number");
  });
});

describe("WAVE 26 / S-3 — SINK 4: fee accrual refuses instead of accruing nothing", () => {
  it("faulted pole — accrueFundingFeeObligations throws", () => {
    setHydrationFailed();
    insertOrphanFeeRow(usdSpv, "management", "USD");
    expect(() => spvEngineStore.accrueFundingFeeObligations(PARTNER_A, usdSpv)).toThrow("FEE_STATE_UNKNOWN");
  });

  it("healthy pole — accrual runs and returns a list (empty is legitimate here)", () => {
    setHydrationOk();
    expect(() => spvEngineStore.accrueFundingFeeObligations(PARTNER_A, usdSpv)).not.toThrow();
  });
});

describe("WAVE 26 / S-3 — SOURCE FENCE: one predicate, and every sink is on it", () => {
  /* An engine with no caller is not shipped. These read the real file so a
     future refactor that removes a call site fails here rather than silently. */
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "spvEngineStore.ts"),
    "utf8",
  ) as string;

  it("the predicate is DEFINED exactly once", () => {
    const defs = src.match(/^\s{2}feeViewUnreliable\(spvId: string\): boolean \{/gm) ?? [];
    expect(defs.length).toBe(1);
  });

  it("every fee-derived sink CALLS it", () => {
    const calls = src.match(/this\.feeViewUnreliable\(spvId\)/g) ?? [];
    // hasUnsettledFixedFees + feeBreakdown + recordDistribution +
    // previewDistributionSplit + accrueFundingFeeObligations = 5.
    expect(calls.length).toBe(5);
  });

  it("the old inline copy of the reasoning is GONE (one implementation, not two)", () => {
    /* Wave 5's inline `if (feeStateUnknown()) { const probe = ... }` block was
       the only implementation; if a second one reappears the two poles can
       drift apart, which is how this class of defect survives. */
    expect(src).not.toMatch(/if \(feeStateUnknown\(\)\) \{/);
  });
});
