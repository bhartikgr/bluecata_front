/**
 * WAVE 33 · CP-MFC-20 (client half) — a delivered frame must INVALIDATE
 * something, on every pillar.
 *
 * The server half of this item was dead in production for a module-resolution
 * reason no source review could see. The client half has the same failure
 * shape available to it: `AGGREGATE_TO_KEYS[e.aggregate] ?? []` silently
 * resolves to `[]` for an aggregate that is missing or misspelled, so a
 * perfectly delivered frame invalidates nothing and refreshes no pillar — with
 * no error anywhere. That is asserted here BY EXECUTION: a real
 * `mutation` event is pushed through a stubbed `EventSource` and the resulting
 * `invalidateQueries` calls are read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

const invalidateSpy = vi.fn();
vi.mock("@/lib/queryClient", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    queryClient: { invalidateQueries: (arg: unknown) => invalidateSpy(arg) },
  };
});

import {
  useRealtimeSync,
  subscribeToMutation,
  PARTNER_REPRESENTATION_AGGREGATE,
} from "../realtimeSync";

/** Minimal EventSource stand-in that lets the test push a frame. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  push(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function Harness() {
  useRealtimeSync();
  return <div data-testid="rt" />;
}

beforeEach(() => {
  invalidateSpy.mockReset();
  FakeEventSource.last = null;
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
});
afterEach(() => {
  cleanup();
});

const KEYS = () => invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);

describe("a partnerRepresentation frame reaches every pillar's queries", () => {
  it("R1 the stream is opened at all", () => {
    render(<Harness />);
    expect(FakeEventSource.last?.url).toContain("/api/events/stream");
  });

  it("R2 EMITTED KEYS — the frame invalidates the partner, Capavate, Collective and admin keys", () => {
    render(<Harness />);
    FakeEventSource.last!.push("mutation", {
      aggregate: PARTNER_REPRESENTATION_AGGREGATE,
      id: "ac_p:co_c",
      change: "update",
      ts: Date.now(),
    });
    const keys = KEYS();
    // Asserted on what is EMITTED to invalidateQueries — not on the key table.
    expect(keys).toContain("/api/partner/me/pipeline"); // pillar 3
    expect(keys).toContain("/api/companies"); // pillar 2
    expect(keys).toContain("/api/collective/dsc/pipeline"); // pillar 1
    expect(keys).toContain("/api/admin/companies"); // pillar 4
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  it("R3 THE POLE — an unmapped aggregate invalidates NOTHING, which is the silent failure this guards", () => {
    render(<Harness />);
    FakeEventSource.last!.push("mutation", {
      aggregate: "partnerRepresentationn", // one typo
      id: "ac_p:co_c",
      change: "update",
      ts: Date.now(),
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("R4 targeted subscribers receive the frame, and unsubscribing really stops it", () => {
    render(<Harness />);
    const seen: string[] = [];
    const off = subscribeToMutation(PARTNER_REPRESENTATION_AGGREGATE, (e) => seen.push(e.id));
    FakeEventSource.last!.push("mutation", {
      aggregate: PARTNER_REPRESENTATION_AGGREGATE,
      id: "ac_p:co_c",
      change: "update",
      ts: Date.now(),
    });
    off();
    FakeEventSource.last!.push("mutation", {
      aggregate: PARTNER_REPRESENTATION_AGGREGATE,
      id: "ac_p:co_second",
      change: "update",
      ts: Date.now(),
    });
    expect(seen).toEqual(["ac_p:co_c"]);
  });

  it("R5 a malformed frame is survived without tearing the stream down", () => {
    render(<Harness />);
    const es = FakeEventSource.last!;
    for (const fn of es.listeners["mutation"] ?? []) {
      expect(() => fn({ data: "{not json" } as MessageEvent)).not.toThrow();
    }
    es.push("mutation", {
      aggregate: PARTNER_REPRESENTATION_AGGREGATE,
      id: "ac_p:co_c",
      change: "update",
      ts: Date.now(),
    });
    expect(KEYS()).toContain("/api/partner/me/pipeline");
  });
});
