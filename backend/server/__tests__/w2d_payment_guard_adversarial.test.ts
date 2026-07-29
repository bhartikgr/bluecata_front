/**
 * server/__tests__/w2d_payment_guard_adversarial.test.ts
 *
 * STAGE D BLOCKER FIX — B1 / B2 / B3, owner Option A ("keep the writer, add hard
 * guards; payments is a sacred area").
 *
 * ── THE OUTCOME THESE TESTS EXIST TO MAKE UNREACHABLE ────────────────────────
 * `chapter_memberships` gates money: `collectiveBillingStore.isChapterMember()`
 * (server/collectiveBillingStore.ts:190) is the authorisation for Airwallex
 * payment-intent creation (:1351), the billing portal (:1498), subscription
 * CANCEL (:1555) and RESUME (:1635). So revoking a paying member's chapter
 * membership left them BILLED and 403'd out of their own cancel endpoint.
 * Every test below ACTIVELY TRIES to produce that state and asserts it cannot
 * be produced — not that it is unlikely.
 *
 * ── WHY SEED PERSONAS HERE (and not `u_w2d_*` like w2d_resourcing.test.ts) ────
 * That file bans seed ids because it tests `COMMS_USERS` re-sourcing, where a
 * seed id would make an assertion vacuous. Nothing here reads `COMMS_USERS`:
 * these guards read `chapter_memberships`, `collective_memberships_billing` and
 * `audit_log` only. Seed personas are used because the REAL cancel endpoint sits
 * behind `requireCollectiveMember` (accreditation + cap-table + deactivation
 * sub-gates), and the point of this file is to exercise the real endpoint rather
 * than a stub of it. The chapter, the memberships and the billing rows are all
 * created here, so no assertion depends on seed state.
 *
 * ── ANTI-VACUITY ─────────────────────────────────────────────────────────────
 * Pre-image = the Stage D writer (git-less repo: `_w2dfix_backup/` holds the
 * exact pre-fix `chapterMembershipWriter.ts`, `chapterMembershipRoutes.ts`,
 * `chapterAdminRoutes.ts`, `commsStore.ts`). Observed pre-fix failure modes are
 * recorded per test in /home/user/workspace/work/_W2D_BLOCKER_FIX_RESULT.md.
 * Tests marked REGRESSION GUARD also pass pre-fix and are NOT counted as
 * evidence.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { upsertCapTablePositionForTests } from "../membershipStore";
import { tenantForChapter } from "../lib/chapterDefaults";
import { recordAccreditationDeclaration } from "../investorComplianceRoutes";
import {
  addChapterMembership,
  revokeChapterMembership,
  isActiveChapterMember,
  isChapterAdmin,
} from "../lib/chapterMembershipWriter";
import {
  GUARD_ERRORS,
  billingRowIsBillable,
  billingPrecondition,
  chapterHasOtherActiveAdmin,
} from "../lib/chapterGovernanceRules";

/* ------------------------------------------------------------------- actors */

const CH = "chap_pgfix";
const CH_TENANT = "tenant_platform";
const BILLING_TENANT = tenantForChapter(CH);

const ADMIN = "u_daniel_okafor";   // sole chapter admin (membership row, role=admin)
const ADMIN2 = "u_maya_chen";      // second admin, added only where needed
const PAYER = "u_aisha_patel";     // active Collective member + cap-table position
const PLAIN = "u_chadmin_nyc";     // ordinary member of THIS chapter, never an admin here

let app: Express;
let server: http.Server;
let port: number;

const now = (): string => new Date().toISOString();

/** THROWS on SQL failure — a fixture that silently fails would fake every green. */
function run(sql: string, ...args: unknown[]): void {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[payment-guard fixture] ${(err as Error).message}\nSQL: ${sql}`);
  }
}

function get<T = any>(sql: string, ...args: unknown[]): T | undefined {
  return rawDb().prepare(sql).get(...(args as any[])) as T | undefined;
}

function seedChapter(): void {
  run(
    `INSERT OR REPLACE INTO chapters
       (id, tenant_id, name, region, city, status, admin_user_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'Payment Guard Chapter', 'NA-East', 'Toronto', 'active', NULL, ?, ?, NULL)`,
    CH,
    CH_TENANT,
    now(),
    now(),
  );
}

function seedMembership(userId: string, role: "member" | "admin", status = "active"): void {
  run(
    `INSERT OR REPLACE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    `chm_pgfix_${userId}`,
    CH_TENANT,
    CH,
    userId,
    role,
    status,
    now(),
    now(),
    now(),
  );
}

/** A real `collective_memberships_billing` row, in the tenant the payment routes read. */
function seedBilling(
  userId: string,
  status: string,
  cancelAtPeriodEnd = 0,
  chapterId = CH,
): void {
  run(
    `INSERT OR REPLACE INTO collective_memberships_billing
       (id, tenant_id, chapter_id, user_id, tier, status, stripe_customer_id,
        stripe_subscription_id, stripe_price_id, current_period_start,
        current_period_end, cancel_at_period_end, prev_hash, curr_hash,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'standard', ?, 'cus_pgfix', 'sub_pgfix', 'price_standard_test',
             1780000000, 1790000000, ?, NULL, ?, ?, ?, NULL)`,
    `bil_pgfix_${userId}_${chapterId}`,
    tenantForChapter(chapterId),
    chapterId,
    userId,
    status,
    cancelAtPeriodEnd,
    `h_pgfix_${userId}`,
    now(),
    now(),
  );
}

function clearBilling(): void {
  run(`DELETE FROM collective_memberships_billing WHERE id LIKE 'bil_pgfix%'`);
  run(`DELETE FROM collective_membership_deactivation_queue WHERE user_id IN (?, ?, ?, ?)`,
    ADMIN, ADMIN2, PAYER, PLAIN);
}

function membershipRow(userId: string): { role?: string; status?: string; deleted_at?: string | null; tenant_id?: string } | undefined {
  return get(
    `SELECT role, status, deleted_at, tenant_id FROM chapter_memberships
      WHERE chapter_id = ? AND user_id = ?`,
    CH,
    userId,
  );
}

function auditCount(userId: string): number {
  const row = get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM audit_log WHERE target = ?`,
    `chapter_membership:${CH}:${userId}`,
  );
  return row?.n ?? 0;
}

/* ---------------------------------------------------------------- HTTP call */

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string; userRole?: string } = {},
): Promise<{ status: number; body: any; text: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) {
      headers["x-user-id"] = opts.userId;
      headers["x-actor-user-id"] = opts.userId;
    }
    if (opts.userRole) headers["x-role"] = opts.userRole;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body, text: buf });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const revokeHttp = (target: string, as: string) =>
  call("DELETE", `/api/collective/chapters/${CH}/members/${target}`, { userId: as });

const addHttp = (target: string, as: string, role?: "member" | "admin") =>
  call("POST", `/api/collective/chapters/${CH}/members`, {
    userId: as,
    body: { userId: target, ...(role ? { role } : {}) },
  });

const cancelHttp = (as: string) =>
  call("POST", "/api/collective/membership/cancel", { userId: as, body: { chapter_id: CH } });

/* ------------------------------------------------------------------ harness */

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  for (const uid of [ADMIN, ADMIN2, PAYER, PLAIN]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
    upsertCapTablePositionForTests(uid);
    /* `requireCollectiveMember` also enforces the W3-C accreditation
       self-declaration; without it the REAL cancel endpoint 403s before the
       chapter-membership check and the strand assertion would be vacuous. */
    recordAccreditationDeclaration(uid, {
      signatureName: `Payment Guard ${uid}`,
      criteria: ["us_income"],
    });
  }
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

beforeEach(() => {
  run(`DELETE FROM chapter_memberships WHERE chapter_id = ?`, CH);
  run(`DELETE FROM audit_log WHERE target LIKE ?`, `chapter_membership:${CH}:%`);
  clearBilling();
  seedChapter();
  seedMembership(ADMIN, "admin");
  seedMembership(PAYER, "member");
  seedMembership(PLAIN, "member");
});

/* =========================================================================
   A. STRANDING A SUBSCRIBER — the sacred path
   ========================================================================= */

describe("B2 — a paying member cannot be revoked (the strand is unreachable)", () => {
  it("REFUSES to revoke a member holding an ACTIVE subscription", async () => {
    seedBilling(PAYER, "active", 0);
    const r = await revokeHttp(PAYER, ADMIN);
    expect(r.status).toBe(409);
    expect(r.body?.ok).toBe(false);
    expect(r.body?.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
    expect(String(r.body?.message ?? "")).toMatch(/cancel/i);
    // and the row is UNTOUCHED — no partial write
    const row = membershipRow(PAYER);
    expect(row?.status).toBe("active");
    expect(row?.deleted_at ?? null).toBeNull();
    expect(isActiveChapterMember(CH, PAYER)).toBe(true);
  });

  it("and the payer can STILL reach the cancel endpoint afterwards (no 403 not_chapter_member)", async () => {
    seedBilling(PAYER, "active", 0);
    const refused = await revokeHttp(PAYER, ADMIN);
    expect(refused.status).toBe(409);
    const c = await cancelHttp(PAYER);
    expect(c.body?.error).not.toBe("not_chapter_member");
    expect(c.status).toBe(200);
    expect(c.body?.ok).toBe(true);
    expect(c.body?.cancelAtPeriodEnd).toBe(true);
  });

  it("REFUSES for a PENDING subscription (it still needs cancelling)", async () => {
    seedBilling(PAYER, "pending", 0);
    const r = await revokeHttp(PAYER, ADMIN);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
    expect(isActiveChapterMember(CH, PAYER)).toBe(true);
  });

  it("REFUSES for a PAST_DUE subscription (it can still bill)", async () => {
    seedBilling(PAYER, "past_due", 0);
    const r = await revokeHttp(PAYER, ADMIN);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
    expect(isActiveChapterMember(CH, PAYER)).toBe(true);
  });

  it("REFUSES for an UNRECOGNISED billing status (unknown ⇒ billable, fail closed)", async () => {
    seedBilling(PAYER, "trialing_new_gateway_state", 0);
    const r = await revokeHttp(PAYER, ADMIN);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
  });

  it("SELF-removal cannot strand either: the payer revoking THEMSELVES is refused", async () => {
    seedBilling(PAYER, "active", 0);
    const r = await revokeHttp(PAYER, PAYER);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
    expect(isActiveChapterMember(CH, PAYER)).toBe(true);
  });

  it("a PLATFORM ADMIN cannot override the money guard either (writer-level)", () => {
    seedBilling(PAYER, "active", 0);
    const r = revokeChapterMembership(CH, PAYER, { userId: "u_platform_root", isPlatformAdmin: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
    expect(isActiveChapterMember(CH, PAYER)).toBe(true);
  });

  it("ALLOWS the revoke once cancel-at-period-end is set (cancel first, then revoke)", async () => {
    seedBilling(PAYER, "active", 0);
    expect((await revokeHttp(PAYER, ADMIN)).status).toBe(409);
    const c = await cancelHttp(PAYER);
    expect(c.status).toBe(200);
    // the real endpoint set cancel_at_period_end on the real row
    const b = get<{ cancel_at_period_end: number }>(
      `SELECT cancel_at_period_end FROM collective_memberships_billing WHERE user_id = ? AND chapter_id = ?`,
      PAYER, CH,
    );
    expect(b?.cancel_at_period_end).toBe(1);
    const r = await revokeHttp(PAYER, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(membershipRow(PAYER)?.status).toBe("revoked");
    expect(isActiveChapterMember(CH, PAYER)).toBe(false);
  });

  it("REGRESSION GUARD (passes pre-fix): ALLOWS the revoke for a settled (cancelled / expired) subscription", async () => {
    for (const status of ["cancelled", "expired"]) {
      run(`DELETE FROM chapter_memberships WHERE chapter_id = ?`, CH);
      seedMembership(ADMIN, "admin");
      seedMembership(PAYER, "member");
      clearBilling();
      seedBilling(PAYER, status, 0);
      const r = await revokeHttp(PAYER, ADMIN);
      expect(r.status, `status=${status}`).toBe(200);
      expect(membershipRow(PAYER)?.status).toBe("revoked");
    }
  });

  it("REGRESSION GUARD (passes pre-fix): ALLOWS the revoke when there is no billing row at all", async () => {
    const r = await revokeHttp(PLAIN, ADMIN);
    expect(r.status).toBe(200);
    expect(membershipRow(PLAIN)?.status).toBe("revoked");
  });

  it("REGRESSION GUARD (passes pre-fix): a billing row in ANOTHER chapter does not block this chapter's revoke", async () => {
    seedBilling(PAYER, "active", 0, "chap_pgfix_other");
    const r = await revokeHttp(PAYER, ADMIN);
    expect(r.status).toBe(200);
  });

  it("MATRIX: for every billable state, revoke is refused AND chapter membership survives", async () => {
    const matrix: Array<[string, number, boolean]> = [
      /* status, cancelAtPeriodEnd, expectBillable */
      ["pending", 0, true],
      ["pending", 1, true],
      ["active", 0, true],
      ["active", 1, false],
      ["past_due", 0, true],
      ["past_due", 1, true],
      ["cancelled", 0, false],
      ["cancelled", 1, false],
      ["expired", 0, false],
      ["expired", 1, false],
      ["", 0, true],
      ["something_new", 0, true],
    ];
    for (const [status, cape, billable] of matrix) {
      run(`DELETE FROM chapter_memberships WHERE chapter_id = ?`, CH);
      seedMembership(ADMIN, "admin");
      seedMembership(PAYER, "member");
      clearBilling();
      seedBilling(PAYER, status, cape);
      const label = `status=${status || "<empty>"} cancelAtPeriodEnd=${cape}`;
      expect(billingRowIsBillable(status, !!cape), label).toBe(billable);
      const r = await revokeHttp(PAYER, ADMIN);
      if (billable) {
        expect(r.status, label).toBe(409);
        expect(r.body?.error, label).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
        // THE INVARIANT: a billable member is still a chapter member, so
        // `isChapterMember` in collectiveBillingStore can never 403 them.
        expect(isActiveChapterMember(CH, PAYER), label).toBe(true);
        const c = await cancelHttp(PAYER);
        expect(c.body?.error, label).not.toBe("not_chapter_member");
      } else {
        expect(r.status, label).toBe(200);
        expect(membershipRow(PAYER)?.status, label).toBe("revoked");
      }
    }
  });

  it("FAILS CLOSED when the billing table cannot be read at all", async () => {
    seedBilling(PAYER, "cancelled", 0); // settled ⇒ would otherwise be allowed
    run(`ALTER TABLE collective_memberships_billing RENAME TO collective_memberships_billing_hidden`);
    try {
      const verdict = billingPrecondition(CH, PAYER);
      expect(verdict.allow).toBe(false);
      if (!verdict.allow) expect(verdict.error).toBe(GUARD_ERRORS.BILLING_STATE_UNVERIFIABLE);
      const r = revokeChapterMembership(CH, PAYER, { userId: ADMIN });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(GUARD_ERRORS.BILLING_STATE_UNVERIFIABLE);
      expect(membershipRow(PAYER)?.status).toBe("active");
    } finally {
      run(`ALTER TABLE collective_memberships_billing_hidden RENAME TO collective_memberships_billing`);
    }
    // and the guard recovers as soon as the read works again
    expect(billingPrecondition(CH, PAYER).allow).toBe(true);
  });
});

/* =========================================================================
   B. LAST-ADMIN PROTECTION (shared rule)
   ========================================================================= */

describe("B2 — last-admin protection (shared RULE_LAST_ADMIN)", () => {
  it("REFUSES to revoke the only active admin of a chapter", async () => {
    const r = await revokeHttp(ADMIN, ADMIN);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe(GUARD_ERRORS.LAST_CHAPTER_ADMIN);
    expect(membershipRow(ADMIN)?.status).toBe("active");
    expect(membershipRow(ADMIN)?.role).toBe("admin");
    expect(isChapterAdmin(CH, ADMIN)).toBe(true);
  });

  it("REGRESSION GUARD (passes pre-fix): ALLOWS revoking an admin once a second active admin exists", async () => {
    seedMembership(ADMIN2, "admin");
    expect(chapterHasOtherActiveAdmin(CH, ADMIN)).toBe(true);
    const r = await revokeHttp(ADMIN, ADMIN2);
    expect(r.status).toBe(200);
    expect(membershipRow(ADMIN)?.status).toBe("revoked");
    // the chapter still has an admin — the invariant, not just the happy path
    expect(chapterHasOtherActiveAdmin(CH, "nobody")).toBe(true);
  });

  it("the shared rule ignores REVOKED admins when counting", async () => {
    seedMembership(ADMIN2, "admin", "revoked");
    run(`UPDATE chapter_memberships SET deleted_at = ? WHERE user_id = ? AND chapter_id = ?`,
      now(), ADMIN2, CH);
    const r = await revokeHttp(ADMIN, ADMIN);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe(GUARD_ERRORS.LAST_CHAPTER_ADMIN);
  });

  it("a plain member is revocable and never trips the admin rule (REGRESSION GUARD)", async () => {
    const r = await revokeHttp(PLAIN, ADMIN);
    expect(r.status).toBe(200);
  });
});

/* =========================================================================
   C. NO SILENT DEMOTION
   ========================================================================= */

describe("B3 — addChapterMembership can never change a live role", () => {
  it("REFUSES to silently demote an existing admin (role=member on an admin)", async () => {
    const r = await addHttp(ADMIN, ADMIN, "member");
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.role).toBe("admin");
    expect(r.body?.roleUnchanged).toBe(true);
    expect(membershipRow(ADMIN)?.role).toBe("admin");
    expect(isChapterAdmin(CH, ADMIN)).toBe(true);
  });

  it("also refuses the implicit DEFAULT demotion (no role field at all)", async () => {
    const r = await addHttp(ADMIN, ADMIN);
    expect(r.status).toBe(200);
    expect(membershipRow(ADMIN)?.role).toBe("admin");
  });

  it("cannot implicitly PROMOTE either — role changes go through the admin surface", async () => {
    const r = await addHttp(PLAIN, ADMIN, "admin");
    expect(r.status).toBe(200);
    expect(membershipRow(PLAIN)?.role).toBe("member");
    expect(isChapterAdmin(CH, PLAIN)).toBe(false);
  });

  it("does not overwrite tenant_id of an existing row", async () => {
    run(`UPDATE chapter_memberships SET tenant_id = 'tenant_original' WHERE user_id = ? AND chapter_id = ?`,
      PLAIN, CH);
    await addHttp(PLAIN, ADMIN, "member");
    expect(membershipRow(PLAIN)?.tenant_id).toBe("tenant_original");
  });

  it("REGRESSION GUARD (passes pre-fix): a REVOKED row is restored with the requested role", async () => {
    const r0 = await revokeHttp(PLAIN, ADMIN);
    expect(r0.status).toBe(200);
    const r = await addHttp(PLAIN, ADMIN, "admin");
    expect(r.status).toBe(200);
    expect(membershipRow(PLAIN)?.role).toBe("admin");
    expect(membershipRow(PLAIN)?.status).toBe("active");
  });

  it("stays idempotent for a plain re-add (REGRESSION GUARD)", async () => {
    await addHttp(PLAIN, ADMIN, "member");
    await addHttp(PLAIN, ADMIN, "member");
    const n = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM chapter_memberships WHERE chapter_id = ? AND user_id = ?`, CH, PLAIN);
    expect(n?.n).toBe(1);
    expect(membershipRow(PLAIN)?.status).toBe("active");
  });
});

/* =========================================================================
   D. ADMIN-ONLY, ENFORCED IN THE WRITER (not only in the route)
   ========================================================================= */

describe("B1 — every write requires chapter-admin authority, fail closed", () => {
  it("REGRESSION GUARD (passes pre-fix, route gate): a plain member cannot add anyone over HTTP", async () => {
    const r = await addHttp(ADMIN2, PAYER, "member");
    expect(r.status).toBe(403);
    expect(membershipRow(ADMIN2)).toBeUndefined();
  });

  it("REGRESSION GUARD (passes pre-fix, route gate): a plain member cannot revoke a third party over HTTP", async () => {
    const r = await revokeHttp(PLAIN, PAYER);
    expect(r.status).toBe(403);
    expect(membershipRow(PLAIN)?.status).toBe("active");
  });

  it("the WRITER itself denies a non-admin actor (route bypass gives nothing)", () => {
    const a = addChapterMembership(CH, ADMIN2, { userId: PLAIN }, "member");
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toBe(GUARD_ERRORS.NOT_CHAPTER_ADMIN);
    const b = revokeChapterMembership(CH, PAYER, { userId: PLAIN });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe(GUARD_ERRORS.NOT_CHAPTER_ADMIN);
    expect(membershipRow(PAYER)?.status).toBe("active");
    expect(membershipRow(ADMIN2)).toBeUndefined();
  });

  it("the WRITER denies a MISSING actor identity", () => {
    const a = addChapterMembership(CH, ADMIN2, { userId: "" }, "member");
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.error).toBe(GUARD_ERRORS.NOT_CHAPTER_ADMIN);
    const b = revokeChapterMembership(CH, PAYER, undefined as any);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toBe(GUARD_ERRORS.NOT_CHAPTER_ADMIN);
  });

  it("an unauthenticated caller gets 401 (REGRESSION GUARD)", async () => {
    const r = await call("POST", `/api/collective/chapters/${CH}/members`, { body: { userId: PLAIN } });
    expect([401, 403]).toContain(r.status);
  });
});

/* =========================================================================
   E. AUDIT IS A PRECONDITION, NOT A COURTESY
   ========================================================================= */

describe("B1 — every write is audited, and an unauditable write does not happen", () => {
  it("REGRESSION GUARD (passes pre-fix): records actor, target, chapter and before/after role+status on a revoke", async () => {
    const before = auditCount(PLAIN);
    const r = await revokeHttp(PLAIN, ADMIN);
    expect(r.status).toBe(200);
    expect(auditCount(PLAIN)).toBe(before + 1);
    const row = get<{ actor_id: string; action: string; payload_json: string }>(
      `SELECT actor_id, action, payload_json FROM audit_log
        WHERE target = ? ORDER BY created_at DESC LIMIT 1`,
      `chapter_membership:${CH}:${PLAIN}`,
    );
    expect(row?.actor_id).toBe(ADMIN);
    expect(row?.action).toBe("collective.chapter_membership.revoked");
    const p = JSON.parse(row?.payload_json ?? "{}");
    expect(p.chapterId).toBe(CH);
    expect(p.targetUserId).toBe(PLAIN);
    expect(p.previousRole).toBe("member");
    expect(p.previousStatus).toBe("active");
    expect(p.newStatus).toBe("revoked");
  });

  it("records the preserved role on an add that would have demoted", async () => {
    await addHttp(ADMIN, ADMIN, "member");
    const row = get<{ payload_json: string }>(
      `SELECT payload_json FROM audit_log WHERE target = ? ORDER BY created_at DESC LIMIT 1`,
      `chapter_membership:${CH}:${ADMIN}`,
    );
    const p = JSON.parse(row?.payload_json ?? "{}");
    expect(p.requestedRole).toBe("member");
    expect(p.newRole).toBe("admin");
    expect(p.roleChangeIgnored).toBe(true);
  });

  it("a REFUSED write appends no mutation and no success entry", async () => {
    seedBilling(PAYER, "active", 0);
    const r = await revokeHttp(PAYER, ADMIN);
    expect(r.status).toBe(409);
    expect(auditCount(PAYER)).toBe(0);
    expect(membershipRow(PAYER)?.status).toBe("active");
  });

  it("FAILS CLOSED when the audit log cannot be written", async () => {
    run(`ALTER TABLE audit_log RENAME TO audit_log_hidden`);
    try {
      const r = await revokeHttp(PLAIN, ADMIN);
      expect(r.status).toBe(503);
      expect(r.body?.error).toBe(GUARD_ERRORS.AUDIT_UNAVAILABLE);
      expect(membershipRow(PLAIN)?.status).toBe("active");
    } finally {
      run(`ALTER TABLE audit_log_hidden RENAME TO audit_log`);
    }
    const ok = await revokeHttp(PLAIN, ADMIN);
    expect(ok.status).toBe(200);
  });
});
