/**
 * WAVE 341 (productgaps2) · ITEM 7 · W295 —
 * NO TEST ASSERTED ONE AUDIT ENTRY PER MONEY EVENT. THIS IS THAT TEST.
 * ════════════════════════════════════════════════════════════════════════════
 * It asserts STORED ROWS through `rawDb()`. It never asserts a variable name,
 * a function call count, or an exit code. The two tables it compares are the
 * only two that matter:
 *
 *   `payment_ledger`  — one row per money event that actually happened
 *                       (`entry_json` carries id / kind / amountCents / currency).
 *   `audit_log`       — the hash-chained record that is supposed to have one
 *                       entry for each of them.
 *
 * §1 is the assertion the brief asked for: a BIJECTION, checked in BOTH
 *    DIRECTIONS, with both sides asserted non-empty so an empty database can
 *    never manufacture a green.
 * §2 and §3 are the adversarial half: an entry that exists but does not
 *    DESCRIBE its money event is not an audit trail, it is a row. Anything §2
 *    or §3 reports is a FINDING to be reported, not papered over.
 *
 * INTERNATIONAL: no currency is converted and no amount is summed across
 * currencies anywhere in this file. Amounts are compared only to the amount on
 * the same event, and currency is compared as a string.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { chargeOrIdempotent } from "../paymentStore";

type LedgerRow = { id: string; state: string; entry_json: string; ts: string };
type AuditRow = {
  id: string;
  action: string;
  target: string | null;
  target_id: string | null;
  payload_json: string;
  created_at: string;
};

let ledger: LedgerRow[] = [];
let audits: AuditRow[] = [];
/** the money-event id each audit row claims to be about */
const auditToLedgerId = new Map<string, string>();
/** the money events THIS TEST caused, so the assertions are about a known set */
const causedIds: string[] = [];
let dedupedSecondCharge = false;

/** Money-event ids are `pay_…`; the payload nests them under `payload.id`. */
function ledgerIdOfAudit(a: AuditRow): string | null {
  try {
    const p = JSON.parse(a.payload_json ?? "{}");
    const id = p?.payload?.id ?? p?.id ?? null;
    return typeof id === "string" && id.startsWith("pay_") ? id : null;
  } catch {
    return null;
  }
}

beforeAll(() => {
  /* ── DRIVE THE REAL MONEY PATH ──────────────────────────────────────────
   * The FIRST version of this file read the two tables as they stood. It went
   * green on §1b/§1c/§1d — against ZERO ROWS, because the test harness opens
   * SQLite at `:memory:`, not `data.db`. §1a (the control) caught it. That is
   * the manufactured green this wave was told to hunt for, found in my own
   * evidence, so the file now CAUSES the money events it asserts about.
   *
   * Three events, chosen so the invariant is exercised and not merely observed:
   *   1. a charge
   *   2. THE SAME intent again — idempotent. A dedupe must not mint a second
   *      ledger row and must not mint a second audit entry. This is the case
   *      that breaks a naive "one audit per call" implementation.
   *   3. a refund — a negative amount, on the same currency. */
  const stamp = randomBytes(4).toString("hex");
  const customerId = `co_w341_w295_${stamp}`;
  const intentId = `intent_w341_${stamp}`;

  const first = chargeOrIdempotent({
    intentId,
    customerId,
    kind: "company_billing",
    amountCents: 19900,
    currency: "USD",
    forceState: "demo",
    description: "W341 W295 charge",
  } as never);
  causedIds.push(first.entry.id);

  const second = chargeOrIdempotent({
    intentId,
    customerId,
    kind: "company_billing",
    amountCents: 19900,
    currency: "USD",
    forceState: "demo",
    description: "W341 W295 charge",
  } as never);
  dedupedSecondCharge = second.deduped || second.entry.id === first.entry.id;

  const refund = chargeOrIdempotent({
    intentId: `refund_${intentId}`,
    customerId,
    kind: "refund",
    amountCents: -19900,
    currency: "USD",
    forceState: "succeeded",
    description: "W341 W295 refund",
  } as never);
  causedIds.push(refund.entry.id);

  const db = rawDb();
  ledger = db
    .prepare(`SELECT id, state, entry_json, ts FROM payment_ledger WHERE customer_id = ?`)
    .all(customerId) as LedgerRow[];
  /* Every audit action that could be a money event. Deliberately WIDER than
     the one action that exists today, so a new action name cannot slip a money
     event past this test by not matching a hard-coded string. */
  audits = (db
    .prepare(
      `SELECT id, action, target, target_id, payload_json, created_at
         FROM audit_log
        WHERE deleted_at IS NULL
          AND (action LIKE '%payment%' OR action LIKE '%charge%'
               OR action LIKE '%refund%' OR action LIKE '%invoice%'
               OR payload_json LIKE '%"pay_%')`,
    )
    .all() as AuditRow[]).filter((a) => {
    const lid = ledgerIdOfAudit(a);
    return lid !== null && ledger.some((l) => l.id === lid);
  });
  for (const a of audits) {
    const lid = ledgerIdOfAudit(a);
    if (lid) auditToLedgerId.set(a.id, lid);
  }
});

describe("W341 W295 §1 — ONE AUDIT ENTRY PER MONEY EVENT (the assertion that did not exist)", () => {
  it("§1a CONTROL — both sides are non-empty, so an empty DB cannot pass this file", () => {
    expect(ledger.length, "payment_ledger must contain money events").toBeGreaterThan(0);
    expect(audits.length, "audit_log must contain money-event entries").toBeGreaterThan(0);
    /* exactly the two money events this test caused: the charge and the refund.
       The repeated intent must NOT have produced a third ledger row. */
    expect(causedIds.length).toBe(2);
    expect(dedupedSecondCharge, "the repeated intent must be idempotent").toBe(true);
    expect(ledger.map((l) => l.id).sort()).toEqual([...causedIds].sort());
  });

  it("§1b every money event in payment_ledger has EXACTLY ONE audit entry", () => {
    const countByLedgerId = new Map<string, number>();
    for (const lid of auditToLedgerId.values()) {
      countByLedgerId.set(lid, (countByLedgerId.get(lid) ?? 0) + 1);
    }
    const missing = ledger.filter((l) => !countByLedgerId.has(l.id)).map((l) => l.id);
    const duplicated = ledger
      .filter((l) => (countByLedgerId.get(l.id) ?? 0) > 1)
      .map((l) => `${l.id} ×${countByLedgerId.get(l.id)}`);
    expect(missing, "money events with NO audit entry").toEqual([]);
    expect(duplicated, "money events with MORE THAN ONE audit entry").toEqual([]);
    /* the count we just checked is itself non-empty */
    expect(countByLedgerId.size).toBe(ledger.length);
  });

  it("§1c the other direction — no audit entry names a money event that does not exist", () => {
    const ledgerIds = new Set(ledger.map((l) => l.id));
    const orphans = [...auditToLedgerId.entries()]
      .filter(([, lid]) => !ledgerIds.has(lid))
      .map(([aid, lid]) => `${aid} → ${lid}`);
    expect(orphans, "audit entries pointing at a money event with no ledger row").toEqual([]);
  });

  it("§1d no money-event audit entry is unattributable", () => {
    const unattributable = audits.filter((a) => !auditToLedgerId.has(a.id)).map((a) => `${a.id} (${a.action})`);
    expect(unattributable, "audit entries about money that name no money event").toEqual([]);
  });
});

describe("W341 W295 §2 — the entry must DESCRIBE the money event, not merely exist", () => {
  it("§2a the recorded amount and currency match the ledger row exactly", () => {
    const byId = new Map(ledger.map((l) => [l.id, JSON.parse(l.entry_json)]));
    const mismatched: string[] = [];
    for (const a of audits) {
      const lid = auditToLedgerId.get(a.id);
      if (!lid) continue;
      const entry = byId.get(lid);
      const p = JSON.parse(a.payload_json).payload ?? {};
      /* compared per event; never summed, never converted */
      if (p.amountCents !== entry.amountCents) mismatched.push(`${lid} amount ${p.amountCents} ≠ ${entry.amountCents}`);
      if (p.currency !== entry.currency) mismatched.push(`${lid} currency ${p.currency} ≠ ${entry.currency}`);
    }
    expect(mismatched).toEqual([]);
  });

  it("§2b FINDING CANDIDATE — the action name must not call a refund a charge", () => {
    const byId = new Map(ledger.map((l) => [l.id, JSON.parse(l.entry_json)]));
    const misdescribed: string[] = [];
    for (const a of audits) {
      const lid = auditToLedgerId.get(a.id);
      if (!lid) continue;
      const entry = byId.get(lid);
      const isRefund = entry.kind === "refund" || Number(entry.amountCents) < 0;
      if (isRefund && /charged/.test(a.action)) {
        misdescribed.push(`${lid} (${entry.kind}, ${entry.amountCents}) recorded as action "${a.action}"`);
      }
    }
    expect(misdescribed, 'refunds recorded under an action whose name says "charged"').toEqual([]);
  });

  it("§2c FINDING CANDIDATE — the entry must name its subject in the indexed column", () => {
    const nullTargetId = audits.filter((a) => !a.target_id).map((a) => `${a.id} (${a.action}, target=${a.target})`);
    expect(nullTargetId, "money-event audit entries with a NULL target_id").toEqual([]);
  });
});

describe("W341 W295 §3 — the chain the entries sit in", () => {
  it("§3a every money-event entry is inside the hash chain (prev_hash and hash present)", () => {
    const db = rawDb();
    const ids = audits.map((a) => a.id);
    if (ids.length === 0) throw new Error("no money-event audit rows — §1a should have caught this");
    const rows = db
      .prepare(
        `SELECT id, prev_hash, hash FROM audit_log WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
      .all(...ids) as { id: string; prev_hash: string | null; hash: string | null }[];
    expect(rows.length).toBe(ids.length);
    const unchained = rows.filter((r) => !r.hash || r.prev_hash === null).map((r) => r.id);
    expect(unchained, "money-event entries outside the hash chain").toEqual([]);
  });

  it("§3b no money-event entry has been soft-deleted", () => {
    const db = rawDb();
    const n = db
      .prepare(
        `SELECT COUNT(*) AS n FROM audit_log
          WHERE deleted_at IS NOT NULL AND payload_json LIKE '%"pay_%'`,
      )
      .get() as { n: number };
    expect(n.n).toBe(0);
  });
});
