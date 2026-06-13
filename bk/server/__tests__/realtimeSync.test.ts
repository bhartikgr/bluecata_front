/**
 * Sprint 17 D4 — realtime sync proofs.
 *
 * Subscribes to the in-process bus and asserts that an emitted mutation
 * is delivered to every subscriber within the 2-second budget.
 */
import { describe, it, expect } from "vitest";
import { emitMutation, onMutation, type MutationEvent } from "../lib/eventBus";

describe("Realtime event bus", () => {
  it("delivers a mutation to a single subscriber", async () => {
    const got: MutationEvent[] = [];
    const off = onMutation(e => got.push(e));
    emitMutation({ aggregate: "company", id: "c_1", change: "update", version: 2 });
    off();
    expect(got).toHaveLength(1);
    expect(got[0]!.aggregate).toBe("company");
    expect(got[0]!.id).toBe("c_1");
  });

  it("fans out to multiple subscribers in <50ms (well under 2s budget)", async () => {
    const a: number[] = [], b: number[] = [], c: number[] = [];
    const offs = [
      onMutation(() => a.push(Date.now())),
      onMutation(() => b.push(Date.now())),
      onMutation(() => c.push(Date.now())),
    ];
    const start = Date.now();
    emitMutation({ aggregate: "round", id: "r_1", change: "create" });
    const end = Date.now();
    offs.forEach(o => o());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
    expect(end - start).toBeLessThan(50);
    // All three subscribers received within the same tick
    expect(a[0]! - start).toBeLessThan(50);
  });

  it("preserves event payload integrity", () => {
    let captured: MutationEvent | null = null;
    const off = onMutation(e => { captured = e; });
    emitMutation({ aggregate: "softCircle", id: "sc_42", change: "delete", tenantId: "t_co" });
    off();
    expect(captured).toBeTruthy();
    const c = captured! as MutationEvent;
    expect(c.aggregate).toBe("softCircle");
    expect(c.tenantId).toBe("t_co");
    expect(typeof c.ts).toBe("number");
  });

  it("unsubscribe stops further delivery", () => {
    let count = 0;
    const off = onMutation(() => count++);
    emitMutation({ aggregate: "post", id: "p1", change: "create" });
    off();
    emitMutation({ aggregate: "post", id: "p2", change: "create" });
    expect(count).toBe(1);
  });

  it("supports a 100-subscriber fan-out under the 2s budget", () => {
    const counts: number[] = new Array(100).fill(0);
    const offs = counts.map((_, i) => onMutation(() => { counts[i]!++; }));
    const start = Date.now();
    emitMutation({ aggregate: "post", id: "burst", change: "create" });
    const elapsed = Date.now() - start;
    offs.forEach(o => o());
    expect(counts.every(c => c === 1)).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
