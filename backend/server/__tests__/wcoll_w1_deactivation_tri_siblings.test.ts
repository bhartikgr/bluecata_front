/**
 * server/__tests__/wcoll_w1_deactivation_tri_siblings.test.ts
 *
 * W-COLLECTIVE Wave 1 — v5 §C. The tri-state SIBLINGS in
 * `collectiveMembershipDeactivationStore` must be additive.
 *
 * CONTEXT. `requireCollectiveMember` (SACRED) calls the BOOLEAN readers and
 * fails CLOSED, collapsing "unreadable" into `true`. That is correct for a gate
 * but wrong for a REPORT: a member whose table could not be read was told their
 * billing had lapsed. v5 §C therefore adds `…Tri` siblings that distinguish
 * `"error"`, and forbids touching the boolean pair — an existing test
 * (`waveSEC_collective_gating.test.ts:280`) asserts `typeof … === "boolean"`,
 * and the sacred middleware's fail-closed behaviour must be byte-identical.
 *
 * ANTI-VACUITY. On the PRISTINE tree the two `…Tri` exports do not exist:
 * `hasOpenMembershipDeactivationTri` is `undefined` and calling it throws
 * `TypeError: … is not a function`. The BOOLEAN-parity assertions are honestly
 * NOT anti-vacuous — they pass on pristine by construction. They are declared
 * regression guards over the sacred fail-closed contract, not proof of a fix.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Mode = "empty" | "row" | "throw";
const world = { deactivation: "empty" as Mode, billing: "empty" as Mode };

vi.mock("../db/connection", () => ({
  rawDb: () => ({
    // The store self-heals with `exec` before its single retry; letting that
    // succeed proves the retry path is exercised and that `"error"` is only
    // reported when the read STILL fails.
    exec: () => undefined,
    prepare: (sql: string) => ({
      get: () => {
        const mode = sql.includes("collective_memberships_billing")
          ? world.billing
          : world.deactivation;
        if (mode === "throw") throw new Error("table unreadable");
        return mode === "row" ? { 1: 1 } : undefined;
      },
      all: () => [],
      run: () => undefined,
    }),
  }),
  getDb: () => {
    throw new Error("not used in this suite");
  },
}));

const store = await import("../collectiveMembershipDeactivationStore");

const U = "u_tri_subject";

beforeEach(() => {
  world.deactivation = "empty";
  world.billing = "empty";
});

describe("v5 §C — the boolean pair is untouched (regression guard, passes on pristine)", () => {
  it("both boolean readers still return a primitive boolean in every mode", () => {
    for (const mode of ["empty", "row", "throw"] as Mode[]) {
      world.deactivation = mode;
      world.billing = mode;
      expect(typeof store.hasOpenMembershipDeactivation(U), `deactivation/${mode}`).toBe("boolean");
      expect(typeof store.hasCancelledOrPastDueBilling(U), `billing/${mode}`).toBe("boolean");
    }
  });

  it("an unreadable table still collapses to TRUE for the sacred gate", () => {
    world.deactivation = "throw";
    world.billing = "throw";
    expect(store.hasOpenMembershipDeactivation(U)).toBe(true);
    expect(store.hasCancelledOrPastDueBilling(U)).toBe(true);
  });

  it("an empty userId is false, never a fail-closed true", () => {
    expect(store.hasOpenMembershipDeactivation("")).toBe(false);
    expect(store.hasCancelledOrPastDueBilling("")).toBe(false);
  });
});

describe("v5 §C — the tri siblings agree with the booleans whenever the read SUCCEEDS", () => {
  it("no marker: both report false", () => {
    expect(store.hasOpenMembershipDeactivation(U)).toBe(false);
    expect(store.hasOpenMembershipDeactivationTri(U)).toBe(false);
  });

  it("open marker: both report true", () => {
    world.deactivation = "row";
    expect(store.hasOpenMembershipDeactivation(U)).toBe(true);
    expect(store.hasOpenMembershipDeactivationTri(U)).toBe(true);
  });

  it("lapsed billing: both report true", () => {
    world.billing = "row";
    expect(store.hasCancelledOrPastDueBilling(U)).toBe(true);
    expect(store.hasCancelledOrPastDueBillingTri(U)).toBe(true);
  });

  it("an empty userId is false on the tri readers too — never `\"error\"`", () => {
    expect(store.hasOpenMembershipDeactivationTri("")).toBe(false);
    expect(store.hasCancelledOrPastDueBillingTri("")).toBe(false);
  });
});

describe("v5 §C — the tri siblings diverge ONLY on an unreadable table", () => {
  it("deactivation: boolean says true (deny), tri says `\"error\"` (deny, but say why)", () => {
    world.deactivation = "throw";
    expect(store.hasOpenMembershipDeactivation(U)).toBe(true);
    expect(store.hasOpenMembershipDeactivationTri(U)).toBe("error");
  });

  it("billing: boolean says true (deny), tri says `\"error\"` (deny, but say why)", () => {
    world.billing = "throw";
    expect(store.hasCancelledOrPastDueBilling(U)).toBe(true);
    expect(store.hasCancelledOrPastDueBillingTri(U)).toBe("error");
  });

  it("`\"error\"` is never a falsy value a caller could mistake for `false`", () => {
    world.deactivation = "throw";
    world.billing = "throw";
    expect(store.hasOpenMembershipDeactivationTri(U)).toBeTruthy();
    expect(store.hasCancelledOrPastDueBillingTri(U)).toBeTruthy();
  });
});
