/**
 * w-partner F3 (C3) — the CRM hydrator must CLEAR-AFTER-SUCCESSFUL-READ.
 *
 * ANTI-VACUITY. The original hydrator called crmByKey.clear() BEFORE its
 * SELECT, and the surrounding catch is non-fatal BY DESIGN. So a SELECT that
 * threw — exactly what happens on a deployed DB that got the CREATE TABLE
 * self-heal but not the ADD COLUMN one, i.e. `no such column: lead_user_id` —
 * completed boot with an EMPTY projection and silently wiped every partner's
 * CRM stage and activity state. No error surfaced anywhere.
 *
 * This file mocks db/connection so the SELECT can be made to fail on demand.
 * It is deliberately a SEPARATE file: the mock would otherwise replace the real
 * database for every other suite in the process.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
/* vi.mock is hoisted above this import, so the store binds to the stub below.
   The stub's rawDb() is only invoked at call time, never during hoisting. */
import { partnerClientCrmStore, hydratePartnerClientCrmStore } from "../partnerClientCrmStore";

type Row = Record<string, unknown>;

let crmRows: Row[] = [];
let actRows: Row[] = [];
/** When true, any SELECT against partner_client_crm throws. */
let selectFails = false;

vi.mock("../db/connection", () => ({
  rawDb: () => ({
    prepare: (sql: string) => {
      const isCrmSelect = /SELECT[\s\S]*FROM partner_client_crm\b/.test(sql);
      const isActSelect = /SELECT[\s\S]*FROM partner_client_activity\b/.test(sql);
      if (selectFails && isCrmSelect) {
        throw new Error("no such column: lead_user_id");
      }
      return {
        all: () => (isCrmSelect ? crmRows : isActSelect ? actRows : []),
        get: () => undefined,
        run: () => ({ changes: 0 }),
      };
    },
  }),
  getDb: () => ({}),
}));

const PID = "ac_hydrator_guard_partner";
const CO = "co_hydrator_guard";

beforeEach(() => {
  selectFails = false;
  crmRows = [
    {
      partner_id: PID,
      company_id: CO,
      stage: "engaged",
      updated_at: "2026-07-25T00:00:00.000Z",
      updated_by: "u_actor",
      lead_user_id: "u_lead",
    },
  ];
  actRows = [
    {
      id: "act_1",
      partner_id: PID,
      company_id: CO,
      activity_type: "lead_assigned",
      body: "Lead assigned to u_lead",
      actor_user_id: "u_actor",
      occurred_at: "2026-07-25T00:00:00.000Z",
      meta_json: JSON.stringify({ from: null, to: "u_lead" }),
    },
  ];
});

describe("C3 — hydrator clear-after-successful-read", () => {
  it("a healthy boot rebuilds stage, lead and activity from the durable rows", async () => {
    await hydratePartnerClientCrmStore();
    expect(partnerClientCrmStore.getStage(PID, CO)).toBe("engaged");
    expect(partnerClientCrmStore.getLead(PID, CO)).toBe("u_lead");
    expect(partnerClientCrmStore.listActivity(PID, CO)).toHaveLength(1);
  });

  it("a FAILED read leaves the previous projection intact instead of wiping it", async () => {
    await hydratePartnerClientCrmStore();
    expect(partnerClientCrmStore.getStage(PID, CO)).toBe("engaged");

    // Simulate the missing-column boot: the SELECT throws and the hydrator
    // swallows it non-fatally.
    selectFails = true;
    await expect(hydratePartnerClientCrmStore()).resolves.toBeUndefined();

    // With a clear-BEFORE-read hydrator these would be the default stage, null
    // and [] — every partner's CRM state silently gone.
    expect(partnerClientCrmStore.getStage(PID, CO)).toBe("engaged");
    expect(partnerClientCrmStore.getLead(PID, CO)).toBe("u_lead");
    expect(partnerClientCrmStore.listActivity(PID, CO)).toHaveLength(1);
    expect(partnerClientCrmStore.listStages(PID)).toEqual({ [CO]: "engaged" });
  });

  it("a successful read still REPLACES the projection (stale rows are dropped)", async () => {
    await hydratePartnerClientCrmStore();
    crmRows = [];
    actRows = [];
    await hydratePartnerClientCrmStore();
    expect(partnerClientCrmStore.listStages(PID)).toEqual({});
    expect(partnerClientCrmStore.listActivity(PID, CO)).toEqual([]);
  });
});
