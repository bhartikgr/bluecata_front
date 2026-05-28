/**
 * v15 P0-10 — every soft-circle write emits a `softCircle.changed` event
 * on the realtime/SSE bus.
 *
 * We subscribe via `onMutation` and assert that:
 *   - createSoftCircle emits a `softCircle:create` mutation.
 *   - updateSoftCircleStatus emits `softCircle:update`.
 *   - deleteSoftCircle emits `softCircle:delete`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { onMutation, type MutationEvent } from "../lib/eventBus";
import {
  createSoftCircle,
  updateSoftCircleStatus,
  deleteSoftCircle,
  _testAccessSoftCircles,
} from "../softCircleStore";

describe("v15 P0-10: soft-circle writes emit realtime events", () => {
  let captured: MutationEvent[] = [];
  let unsubscribe: (() => void) | null = null;

  beforeAll(() => {
    captured = [];
    unsubscribe = onMutation((e) => {
      // Capture only events whose aggregate is "softCircle".
      if (e.aggregate === ("softCircle" as any)) captured.push(e);
    });
  });

  it("create emits softCircle:create", () => {
    _testAccessSoftCircles.reset();
    captured.length = 0;
    const sc = createSoftCircle({
      roundId: "rnd_rt_a",
      companyId: "co_rt_a",
      investorName: "Realtime Rita",
      amount: 5_000,
    });
    expect(captured.length).toBe(1);
    expect(captured[0].aggregate).toBe("softCircle");
    expect(captured[0].change).toBe("create");
    expect(captured[0].id).toBe(sc.id);
    expect(captured[0].tenantId).toBe("tenant_co_co_rt_a");
  });

  it("update emits softCircle:update", () => {
    _testAccessSoftCircles.reset();
    captured.length = 0;
    const sc = createSoftCircle({
      roundId: "rnd_rt_b",
      companyId: "co_rt_b",
      investorName: "Update Ursula",
      amount: 9_000,
    });
    captured.length = 0; // discard the create event
    const updated = updateSoftCircleStatus(sc.id, "confirmed");
    expect(updated?.status).toBe("confirmed");
    expect(captured.length).toBe(1);
    expect(captured[0].change).toBe("update");
    expect(captured[0].id).toBe(sc.id);
  });

  it("delete emits softCircle:delete", () => {
    _testAccessSoftCircles.reset();
    captured.length = 0;
    const sc = createSoftCircle({
      roundId: "rnd_rt_c",
      companyId: "co_rt_c",
      investorName: "Delete Doug",
      amount: 4_000,
    });
    captured.length = 0;
    const ok = deleteSoftCircle(sc.id);
    expect(ok).toBe(true);
    expect(captured.length).toBe(1);
    expect(captured[0].change).toBe("delete");
    expect(captured[0].id).toBe(sc.id);
  });

  it("noop / no events on unknown id", () => {
    captured.length = 0;
    const res = updateSoftCircleStatus("sc_does_not_exist", "confirmed");
    expect(res).toBeNull();
    // Deleting an unknown id returns false and does not emit.
    expect(deleteSoftCircle("sc_does_not_exist")).toBe(false);
    expect(captured.length).toBe(0);

    if (unsubscribe) unsubscribe();
  });
});
