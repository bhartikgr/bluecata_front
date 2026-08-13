/**
 * WAVE 16 — ORP-044 (DEF-044): a milestone broadcast must actually be DELIVERED.
 *
 * WHAT THIS PROVES, and why the obvious test would have been worthless. Before
 * this wave `createBroadcast` resolved recipients from the committed cap-table
 * ledger, persisted them, hash-chained them and emitted
 * `cap_table_broadcast_sent` — and delivered nothing. A test asserting only
 * "createBroadcast returns a record with recipientUserIds" therefore PASSED for
 * years while the feature did not work; that is precisely the "a check that
 * passes may be checking nothing" failure mode. So the assertions here are about
 * the SINK: one `cap_table.broadcast` notification per distinct committed
 * investor, addressed to that investor's user id, carrying the founder's body.
 *
 * BOTH POLES:
 *   · recipients exist  → notifications are emitted, `deliveredInApp` equals the
 *     number emitted, and the telemetry payload carries that same number.
 *   · recipients empty  → ZERO notifications, `deliveredInApp === 0`. Without
 *     this pole a `deliverBroadcast` that blindly notified a hardcoded fixture
 *     (the exact bug v25.11 NC2 removed from this file) would still pass.
 *   · duplicate ledger rows for one investor → ONE notification, not two.
 *   · a throwing recipient → the remaining audience is still delivered and the
 *     count reports the SHORTFALL rather than the hopeful total.
 *   · email is never claimed: every emitted notification has channels.email
 *     false, because the template named in this file's header does not exist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* The store resolves its collaborators through lazy `require`, so the mocks must
   be registered against the module ids it requires, not against static imports. */
const ledgerRows: Array<{ investorId: string }> = [];
const emitted: Array<{ userId: string; kind: string; title: string; body: string; channels?: Record<string, boolean> }> = [];
let emitThrowsFor: string | null = null;

vi.mock("../captableCommitStore", () => ({
  listMembersForCompany: () => ledgerRows,
}));

vi.mock("../notificationsStore", () => ({
  emitNotification: (args: { userId: string; kind: string; title: string; body: string; channels?: Record<string, boolean> }) => {
    if (emitThrowsFor && args.userId === emitThrowsFor) throw new Error("delivery failed for this user");
    emitted.push(args);
    return { id: `ntf_${emitted.length}` };
  },
}));

vi.mock("../multiCompanyStore", () => ({
  getCompanyNameById: (id: string) => (id === "co_named" ? "Northwind Robotics" : undefined),
}));

import { createBroadcast, listBroadcasts, __clearBroadcasts } from "../milestoneBroadcastStore";
import { getRecentEvents, clearEvents } from "../sprint10Telemetry";

function setLedger(ids: string[]): void {
  ledgerRows.length = 0;
  for (const id of ids) ledgerRows.push({ investorId: id });
}

beforeEach(() => {
  __clearBroadcasts();
  clearEvents();
  emitted.length = 0;
  emitThrowsFor = null;
  setLedger([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ORP-044 — in-app delivery actually happens", () => {
  it("emits one cap_table.broadcast notification per committed investor", () => {
    setLedger(["u_inv_1", "u_inv_2", "u_inv_3"]);
    const bc = createBroadcast({ companyId: "co_named", segmentKind: "all", body: "Round closed at $4.2M." }, "u_founder");

    expect(emitted.length).toBe(3);
    expect(emitted.map((e) => e.userId).sort()).toEqual(["u_inv_1", "u_inv_2", "u_inv_3"]);
    for (const e of emitted) {
      expect(e.kind).toBe("cap_table.broadcast");
      expect(e.body).toBe("Round closed at $4.2M.");
      // Resolved from the DB, not hardcoded and not the raw id when a name exists.
      expect(e.title).toContain("Northwind Robotics");
    }
    expect(bc.deliveredInApp).toBe(3);
  });

  it("falls back to the company id in the title only when no name is on record", () => {
    setLedger(["u_inv_1"]);
    createBroadcast({ companyId: "co_unnamed", segmentKind: "all", body: "hi" }, "u_founder");
    expect(emitted[0].title).toContain("co_unnamed");
    expect(emitted[0].title).not.toContain("undefined");
  });

  it("delivers NOTHING when the cap table has no committed investors (opposite pole)", () => {
    setLedger([]);
    const bc = createBroadcast({ companyId: "co_named", segmentKind: "all", body: "anyone there?" }, "u_founder");
    expect(emitted.length).toBe(0);
    expect(bc.recipientUserIds).toEqual([]);
    expect(bc.deliveredInApp).toBe(0);
  });

  it("notifies a repeated holder exactly once", () => {
    setLedger(["u_inv_1", "u_inv_1", "u_inv_2"]);
    const bc = createBroadcast({ companyId: "co_named", segmentKind: "all", body: "twice?" }, "u_founder");
    expect(bc.recipientUserIds).toEqual(["u_inv_1", "u_inv_2"]);
    expect(emitted.length).toBe(2);
    expect(bc.deliveredInApp).toBe(2);
  });

  it("reports the shortfall when one recipient fails, and still delivers the rest", () => {
    setLedger(["u_ok_1", "u_bad", "u_ok_2"]);
    emitThrowsFor = "u_bad";
    const bc = createBroadcast({ companyId: "co_named", segmentKind: "all", body: "partial" }, "u_founder");
    expect(emitted.map((e) => e.userId)).toEqual(["u_ok_1", "u_ok_2"]);
    // The record must NOT claim the full audience.
    expect(bc.recipientUserIds.length).toBe(3);
    expect(bc.deliveredInApp).toBe(2);
  });

  it("never claims email delivery, because the named template does not exist", () => {
    setLedger(["u_inv_1"]);
    createBroadcast({ companyId: "co_named", segmentKind: "all", body: "no email" }, "u_founder");
    expect(emitted[0].channels?.inApp).toBe(true);
    expect(emitted[0].channels?.email).toBe(false);
  });
});

describe("ORP-044 — the delivered count is recorded, persisted and reported", () => {
  it("carries deliveredInApp into the telemetry payload", () => {
    setLedger(["u_inv_1", "u_inv_2"]);
    createBroadcast({ companyId: "co_named", segmentKind: "all", body: "telemetry" }, "u_founder");
    const last = getRecentEvents().at(-1)!;
    expect(last.eventType).toBe("cap_table_broadcast_sent");
    expect((last.payload as { recipients: number }).recipients).toBe(2);
    expect((last.payload as { deliveredInApp: number }).deliveredInApp).toBe(2);
  });

  it("reports the shortfall in telemetry too, not the resolved total", () => {
    setLedger(["u_ok", "u_bad"]);
    emitThrowsFor = "u_bad";
    createBroadcast({ companyId: "co_named", segmentKind: "all", body: "shortfall" }, "u_founder");
    const payload = getRecentEvents().at(-1)!.payload as { recipients: number; deliveredInApp: number };
    expect(payload.recipients).toBe(2);
    expect(payload.deliveredInApp).toBe(1);
  });

  it("keeps the delivered count on the readable record the founder surface lists", () => {
    setLedger(["u_inv_1"]);
    createBroadcast({ companyId: "co_named", segmentKind: "all", body: "listed" }, "u_founder");
    const rows = listBroadcasts({ companyId: "co_named" });
    expect(rows.length).toBe(1);
    expect(rows[0].deliveredInApp).toBe(1);
    // And the filter is not vacuous: another company's list is empty.
    expect(listBroadcasts({ companyId: "co_other" }).length).toBe(0);
  });

  it("still resolves the audience for a segmented broadcast (the server falls through to all)", () => {
    setLedger(["u_inv_1", "u_inv_2"]);
    const bc = createBroadcast(
      { companyId: "co_named", segmentKind: "by_region", segmentValue: "EMEA", body: "segmented" },
      "u_founder",
    );
    /* This is the documented fall-through at milestoneBroadcastStore.ts resolveRecipients:
       segment metadata is not indexed, so EVERY committed investor is reached. The
       founder-facing panel states this in words rather than implying narrower
       delivery — this assertion pins the behaviour the copy describes, so if the
       server ever starts filtering, this test fails and the copy gets corrected. */
    expect(bc.deliveredInApp).toBe(2);
    expect(bc.segmentKind).toBe("by_region");
    expect(bc.segmentValue).toBe("EMEA");
  });
});
