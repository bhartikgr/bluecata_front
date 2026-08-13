/**
 * WAVE 2B / MAJOR 1 — platform-admin tenant verification FAILS CLOSED.
 *
 * Review B (build_log/WAVES_012_REVIEW_B.md, MAJOR 1) found that
 * `server/lib/feeSettlementAuthority.ts:176-187` returned `true` for ANY
 * authenticated `isAdmin` persona when:
 *   (a) the `users` row did not exist,
 *   (b) `tenant_id` was empty, or
 *   (c) the database lookup THREW.
 *
 * (c) is the security defect: a database fault silently CONFERRED settlement
 * authority, which is the capability that can drive a fee obligation to
 * `state = "paid"` and thereby clear `hasUnsettledFixedFees` — the fail-closed
 * gate on subscription commit, deployment and CAP-TABLE LEDGER COMMIT.
 *
 * This suite drives `isPlatformAdmin` directly with synthetic user contexts so
 * each branch is exercised in isolation, and additionally proves the end-to-end
 * consequence through `authorizePlatformAdminSettlement`, which is the only
 * caller that turns the boolean into a mintable capability.
 *
 * Run: npx vitest run server/__tests__/wave2b_major1_platform_admin_fail_closed.test.ts
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import type { Request } from "express";

/* The fault-injection harness.
 *
 * `feeSettlementAuthority` imports `rawDb` as a live ESM binding, so a
 * `vi.spyOn(namespace, "rawDb")` would NOT be observed by it. We therefore
 * replace the module itself and drive the behaviour from these two flags. */
let RAW_DB_SHOULD_THROW = false;
let rawDbCallCount = 0;

vi.mock("../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/connection")>();
  return {
    ...actual,
    rawDb: (...args: unknown[]) => {
      rawDbCallCount += 1;
      if (RAW_DB_SHOULD_THROW) throw new Error("SQLITE_IOERR: disk I/O error");
      return (actual.rawDb as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import {
  isPlatformAdmin,
  authorizePlatformAdminSettlement,
  PLATFORM_ADMIN_TENANT_ID,
} from "../lib/feeSettlementAuthority";
import { rawDb, getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { __setRuntimePersona } from "../lib/userContext";

/** A request carrying only the fields `getUserContext` reads. */
function reqFor(userId: string, isAdmin: boolean): Request {
  registerPersona(userId, isAdmin);
  return { headers: { "x-user-id": userId }, query: {}, cookies: {} } as unknown as Request;
}

function registerPersona(userId: string, isAdmin: boolean): void {
  __setRuntimePersona({
    userId,
    email: `${userId}@wave2b.test`,
    name: userId,
    isFounder: false,
    isInvestor: false,
    isAdmin,
    hasInvitations: false,
  });
}

/** An identity that is NOT in the test-only enumerated set. */
const UNKNOWN_ADMIN = "u_admin_not_in_any_table_9f2c";

/** Insert a users row with an explicit tenant, then clean it up.
 *  NOTE: `users.tenant_id` is NOT NULL (server/db/connection.ts:3075), so the
 *  "absent tenant" case is representable only as the empty string. */
function insertUser(id: string, tenantId: string): void {
  rawDb()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, name, role)
       VALUES (?, ?, ?, ?, 'admin')
       ON CONFLICT(id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    )
    .run(id, tenantId, `${id}@example.test`, id);
}

function deleteUser(id: string): void {
  try {
    rawDb().prepare(`DELETE FROM users WHERE id = ?`).run(id);
  } catch {
    /* best effort */
  }
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeAll(async () => {
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());
}, 30_000);

afterEach(() => {
  RAW_DB_SHOULD_THROW = false;
  vi.restoreAllMocks();
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("WAVE 2B MAJOR 1 — isPlatformAdmin fails closed", () => {
  it("(control) a real users row in tenant_admin_capavate → TRUE", () => {
    const id = "u_wave2b_real_capavate_admin";
    insertUser(id, PLATFORM_ADMIN_TENANT_ID);
    try {
      expect(isPlatformAdmin(reqFor(id, true))).toBe(true);
    } finally {
      deleteUser(id);
    }
  });

  it("(control) a real users row in ANOTHER tenant → FALSE (unchanged behaviour)", () => {
    const id = "u_wave2b_other_tenant_admin";
    insertUser(id, "tenant_some_other_customer");
    try {
      expect(isPlatformAdmin(reqFor(id, true))).toBe(false);
    } finally {
      deleteUser(id);
    }
  });

  it("(a) MISSING users row, production → FALSE (was: true)", () => {
    process.env.NODE_ENV = "production";
    deleteUser(UNKNOWN_ADMIN);
    expect(isPlatformAdmin(reqFor(UNKNOWN_ADMIN, true))).toBe(false);
  });

  it("(b) EMPTY tenant_id, production → FALSE (was: true)", () => {
    process.env.NODE_ENV = "production";
    const id = "u_wave2b_empty_tenant_admin";
    insertUser(id, "");
    try {
      expect(isPlatformAdmin(reqFor(id, true))).toBe(false);
    } finally {
      deleteUser(id);
    }
  });

  it("(c) THE SECURITY CASE — the DB lookup throws → FALSE, in production AND in test", () => {
    for (const env of ["production", "test"]) {
      process.env.NODE_ENV = env;
      RAW_DB_SHOULD_THROW = true;
      try {
        // Even the enumerated test-only identity must be denied on a DB fault:
        // an outage may never mint settlement authority.
        expect(isPlatformAdmin(reqFor("u_admin", true))).toBe(false);
        expect(isPlatformAdmin(reqFor(UNKNOWN_ADMIN, true))).toBe(false);
      } finally {
        RAW_DB_SHOULD_THROW = false;
      }
    }
  });

  it("(a) MISSING row under NODE_ENV=test is allowed ONLY for an enumerated identity", () => {
    process.env.NODE_ENV = "test";
    deleteUser(UNKNOWN_ADMIN);
    deleteUser("u_admin_test");
    // Enumerated test identity: permitted (the narrowed successor to A-2).
    expect(isPlatformAdmin(reqFor("u_admin_test", true))).toBe(true);
    // Any other admin persona: denied even in test.
    expect(isPlatformAdmin(reqFor(UNKNOWN_ADMIN, true))).toBe(false);
  });

  it("the test-only exception does NOT exist in production", () => {
    process.env.NODE_ENV = "production";
    deleteUser("u_admin_test");
    expect(isPlatformAdmin(reqFor("u_admin_test", true))).toBe(false);
  });

  it("a non-admin persona is still rejected before any DB access", () => {
    process.env.NODE_ENV = "production";
    const nonAdmin = reqFor("u_wave2b_non_admin", false);
    const before = rawDbCallCount;
    expect(isPlatformAdmin(nonAdmin)).toBe(false);
    expect(
      isPlatformAdmin({ headers: {}, query: {}, cookies: {} } as unknown as Request),
    ).toBe(false);
    expect(rawDbCallCount).toBe(before);
  });
});

describe("WAVE 2B MAJOR 1 — the consequence: no capability is minted", () => {
  const settleInput = {
    purpose: "fee_obligation" as const,
    spvId: "spv_wave2b_major1",
    obligationId: "ob_wave2b_major1",
    outcome: "succeeded",
    reason: "wave 2b major 1 probe",
  };

  it("a fail-open case can no longer mint a settlement authorization", () => {
    process.env.NODE_ENV = "production";
    deleteUser(UNKNOWN_ADMIN);
    expect(() => authorizePlatformAdminSettlement(reqFor(UNKNOWN_ADMIN, true), settleInput)).toThrow(
      /ADMIN_REQUIRED/,
    );
  });

  it("a DB fault can no longer mint a settlement authorization", () => {
    process.env.NODE_ENV = "production";
    RAW_DB_SHOULD_THROW = true;
    expect(() => authorizePlatformAdminSettlement(reqFor("u_admin", true), settleInput)).toThrow(
      /ADMIN_REQUIRED/,
    );
  });

  it("a genuine tenant_admin_capavate admin still CAN mint one", () => {
    const id = "u_wave2b_real_capavate_admin_2";
    insertUser(id, PLATFORM_ADMIN_TENANT_ID);
    try {
      const auth = authorizePlatformAdminSettlement(reqFor(id, true), settleInput);
      expect(auth).toBeTruthy();
    } finally {
      deleteUser(id);
    }
  });
});
