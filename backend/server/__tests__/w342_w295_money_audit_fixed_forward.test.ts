/**
 * WAVE 342 · ITEM 6 · W295 — THE TWO MONEY-AUDIT DEFECTS, FIXED FORWARD.
 * ════════════════════════════════════════════════════════════════════════════
 * Wave 341's own test (`w341_w295_one_audit_entry_per_money_event.test.ts`)
 * exposed both and left them deliberately RED. They are now GREEN because the
 * PRODUCT changed; that file was not edited (sha256 recorded in
 * build_log/productgaps3/evidence/W295_stored_rows_POST.txt).
 *
 * THIS file is the positive statement of what the fix does, and it asserts
 * STORED ROWS through `rawDb()` only — never a function call count, never a
 * variable name.
 *
 *   DEFECT 1  a refund was filed under the action `telemetry.payment_charged`.
 *   DEFECT 2  `audit_log.target_id` was NULL on every money-event row.
 *
 * FIX FORWARD, PROVED: §4 counts the rows that were already NULL before this
 * test ran anything and asserts the count did not move. No historical row is
 * rewritten and this file issues no destructive SQL.
 *
 * EVERY database assertion below is preceded by a `rows > 0` precondition,
 * because the harness opens SQLite at `:memory:` and an empty table would
 * otherwise manufacture a green.
 *
 * INTERNATIONAL: no amount is converted and no amount is summed across
 * currencies. Each event is compared to its own row, in its own currency.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { chargeOrIdempotent } from "../paymentStore";
import { auditTargetIdOf } from "../adminPlatformStore";

type AuditRow = {
  id: string;
  action: string;
  target: string | null;
  target_id: string | null;
  payload_json: string;
};

const stamp = randomBytes(4).toString("hex");
const customerId = `co_w342_w295_${stamp}`;
let chargeId = "";
let refundId = "";
let audits: AuditRow[] = [];
/** money-event audit rows that were ALREADY NULL before this file ran */
let preExistingNullTargetIds: string[] = [];

function auditFor(payId: string): AuditRow | undefined {
  return audits.find((a) => {
    try {
      return JSON.parse(a.payload_json)?.payload?.id === payId;
    } catch {
      return false;
    }
  });
}

beforeAll(() => {
  const db = rawDb();
  /* Snapshot the pre-existing NULLs FIRST — this is the fix-forward control. */
  preExistingNullTargetIds = (db
    .prepare(
      `SELECT id FROM audit_log
        WHERE target_id IS NULL AND (action LIKE 'telemetry.payment%' OR payload_json LIKE '%"pay_%')`,
    )
    .all() as { id: string }[]).map((r) => r.id);

  const intentId = `intent_w342_${stamp}`;
  chargeId = chargeOrIdempotent({
    intentId,
    customerId,
    kind: "company_billing",
    amountCents: 24900,
    currency: "USD",
    forceState: "demo",
    description: "W342 W295 charge",
  } as never).entry.id;

  refundId = chargeOrIdempotent({
    intentId: `refund_${intentId}`,
    customerId,
    kind: "refund",
    amountCents: -24900,
    currency: "USD",
    forceState: "succeeded",
    description: "W342 W295 refund",
  } as never).entry.id;

  audits = db
    .prepare(
      `SELECT id, action, target, target_id, payload_json
         FROM audit_log
        WHERE deleted_at IS NULL AND target = ?`,
    )
    .all(`investor:${customerId}`) as AuditRow[];
});

describe("W342 §0 — CONTROL: the rows this file asserts about really exist", () => {
  it("both money events landed in payment_ledger and both have an audit row", () => {
    const db = rawDb();
    const ledger = db
      .prepare(`SELECT id, entry_json FROM payment_ledger WHERE customer_id = ?`)
      .all(customerId) as { id: string; entry_json: string }[];
    expect(ledger.length, "payment_ledger rows for this test's customer").toBe(2);
    expect(ledger.map((l) => l.id).sort()).toEqual([chargeId, refundId].sort());
    expect(audits.length, "audit_log rows for this test's customer").toBeGreaterThan(0);
    expect(auditFor(chargeId), "audit row for the charge").toBeTruthy();
    expect(auditFor(refundId), "audit row for the refund").toBeTruthy();
  });
});

describe("W342 §1 — DEFECT 1: a refund is no longer recorded as a charge", () => {
  it("the refund's STORED action names a refund and never says charged", () => {
    const a = auditFor(refundId)!;
    expect(a.action).toBe("telemetry.payment_refunded");
    expect(a.action).not.toMatch(/charged/);
  });

  it("the charge's STORED action is unchanged — nothing else was renamed", () => {
    const a = auditFor(chargeId)!;
    expect(a.action).toBe("telemetry.payment_charged");
  });

  it("the two money events do NOT share one action name (the defect, stated directly)", () => {
    expect(auditFor(chargeId)!.action).not.toBe(auditFor(refundId)!.action);
  });

  it("HONEST LIMITATION, PINNED: the KPI firehose still types the refund as payment_charged", () => {
    /* The peer contract (`ALL_OUTBOUND_EVENT_TYPES`) is pinned by count in
       seven test files, so renaming the telemetry type is an owner-scale
       change and was NOT made. This assertion exists so the limitation is a
       recorded fact rather than a sentence in a report: the FORENSIC record is
       correct, the FIREHOSE type is not yet. If a later wave changes the peer
       contract, this line must be updated with a stated reason. */
    const db = rawDb();
    const rows = db
      .prepare(
        `SELECT event_type, payload_json FROM telemetry_events
          WHERE aggregate_id = ? AND payload_json LIKE ?`,
      )
      .all(customerId, `%${refundId}%`) as { event_type: string }[];
    expect(rows.length, "telemetry_events rows for the refund").toBeGreaterThan(0);
    expect(rows.every((r) => r.event_type === "payment_charged")).toBe(true);
  });
});

describe("W342 §2 — DEFECT 2: target_id names the subject in the indexed column", () => {
  it("both money-event rows have a non-NULL, non-empty target_id", () => {
    for (const payId of [chargeId, refundId]) {
      const a = auditFor(payId)!;
      expect(a.target_id, `${payId} target_id`).toBeTruthy();
      expect(String(a.target_id).length).toBeGreaterThan(0);
    }
  });

  it("target_id is the SUBJECT id, unpacked from the packed target", () => {
    for (const payId of [chargeId, refundId]) {
      const a = auditFor(payId)!;
      expect(a.target).toBe(`investor:${customerId}`);
      expect(a.target_id).toBe(customerId);
      expect(a.target_id).not.toContain(":");
    }
  });

  it("the exact-match filter that could never fire now finds the row", () => {
    /* server/lib/adminUsersRoutes.ts:359 filters
       `target_id = ? OR target = ? OR target LIKE ?`. The first arm was dead. */
    const db = rawDb();
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE target_id = ? AND deleted_at IS NULL`)
      .get(customerId) as { n: number };
    expect(n.n).toBeGreaterThan(0);
  });

  it("the unpacking rule itself: kinds, missing colons, and empty ids", () => {
    expect(auditTargetIdOf("investor:cust_7")).toBe("cust_7");
    expect(auditTargetIdOf("spv:spv_3")).toBe("spv_3");
    // no colon → stored whole, because the whole string IS the subject
    expect(auditTargetIdOf("u_admin")).toBe("u_admin");
    // an empty id half must not become "" — that is not a subject
    expect(auditTargetIdOf("investor:")).toBe("investor:");
    expect(auditTargetIdOf("")).toBeNull();
    // a value with more than one colon keeps everything after the FIRST
    expect(auditTargetIdOf("kind:ns:id")).toBe("ns:id");
  });
});

describe("W342 §3 — the chain still verifies: the hash body never included target_id", () => {
  it("both new money-event rows are inside the hash chain", () => {
    const db = rawDb();
    const ids = [auditFor(chargeId)!.id, auditFor(refundId)!.id];
    const rows = db
      .prepare(`SELECT id, prev_hash, hash FROM audit_log WHERE id IN (?, ?)`)
      .all(...ids) as { id: string; prev_hash: string | null; hash: string | null }[];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.hash, `${r.id} hash`).toBeTruthy();
      expect(String(r.hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(r.prev_hash, `${r.id} prev_hash`).not.toBeNull();
    }
  });
});

describe("W342 §4 — FIX FORWARD: not one historical row was touched", () => {
  it("every money-event row that was already NULL is still NULL and still present", () => {
    const db = rawDb();
    /* This control is only meaningful when there WERE pre-existing rows; when
       the harness DB is fresh there are none, and that is stated rather than
       hidden. */
    if (preExistingNullTargetIds.length === 0) {
      const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number };
      expect(total.n, "audit_log is non-empty even though no pre-existing money NULLs exist").toBeGreaterThan(0);
      return;
    }
    const placeholders = preExistingNullTargetIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, target_id FROM audit_log WHERE id IN (${placeholders})`)
      .all(...preExistingNullTargetIds) as { id: string; target_id: string | null }[];
    expect(rows.length, "no pre-existing row was deleted").toBe(preExistingNullTargetIds.length);
    expect(rows.filter((r) => r.target_id !== null).map((r) => r.id), "rewritten history").toEqual([]);
  });
});
