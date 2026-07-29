/**
 * server/__tests__/wgdpr_chapterstore_hardening_adversarial.test.ts
 *
 * W-COLLECTIVE — GDPR + chaptersStore revoke hardening (owner Option A).
 *
 * ── THE TWO OUTCOMES THESE TESTS EXIST TO PIN DOWN ───────────────────────────
 * `chapter_memberships` is a MONEY table: `collectiveBillingStore.isChapterMember()`
 * gates payment-intent creation, the billing portal and subscription
 * CANCEL / RESUME. Two consequences, pulling in OPPOSITE directions:
 *
 *   A. An ORDINARY revoke of a paying member must be REFUSED
 *      (`SUBSCRIPTION_ACTIVE_CANCEL_FIRST`), because it would leave them billed
 *      and 403'd out of their own cancel endpoint. `server/chaptersStore.ts`
 *      now routes its revoke through the SAME shared preconditions in
 *      `server/lib/chapterGovernanceRules.ts` as the HTTP writer.
 *
 *   B. A GDPR ERASURE must NEVER be refused for a billing reason. It CANCELS
 *      first (the same local, Airwallex-free cancellation the self-service route
 *      performs), THEN revokes, and proceeds even if the cancellation fails —
 *      recording an explicit follow-up marker instead of aborting.
 *
 * ── NO AIRWALLEX ─────────────────────────────────────────────────────────────
 * `globalThis.fetch` is replaced by a throwing spy around every path exercised
 * here; the Airwallex gateway is the only outbound caller and it uses `fetch`
 * (server/lib/airwallexGateway.ts:164/281/328/359). The spy asserts zero calls.
 *
 * ── ANTI-VACUITY ─────────────────────────────────────────────────────────────
 * Pre-image (git-less repo) = /home/user/workspace/work/_gdprfix/pre_fix_backup/.
 * Observed pre-fix failure modes are recorded per test in
 * /home/user/workspace/work/_GDPR_CHAPTERSTORE_FIX_RESULT.md. Tests labelled
 * REGRESSION GUARD also pass pre-fix and are NOT counted as evidence.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { upsertCapTablePositionForTests } from "../membershipStore";
import { tenantForChapter } from "../lib/chapterDefaults";
import { recordAccreditationDeclaration } from "../investorComplianceRoutes";
import {
  joinChapter,
  revokeChapterMembership as storeRevoke,
  ChapterGovernanceRefusalError,
} from "../chaptersStore";
import { GUARD_ERRORS } from "../lib/chapterGovernanceRules";
import {
  applyLocalCancelAtPeriodEnd,
  getBillingForUser,
} from "../collectiveBillingStore";
import { collectiveMembershipsBilling as billingTable } from "@shared/schema";
import { appendAdminAudit } from "../adminPlatformStore";

/* ------------------------------------------------------------------ actors */

const CH = "chap_wgdpr";
const CH_TENANT = "tenant_platform";

const ADMIN = "u_daniel_okafor";   // sole chapter admin
const ADMIN2 = "u_maya_chen";      // second admin where needed
const PAYER = "u_aisha_patel";     // seeded Collective member (real cancel endpoint)
const PLAIN = "u_chadmin_nyc";     // ordinary member

/** Erasure targets — plain `users` rows created here, one per erasure test. */
const ERASE_PAYER = "u_wgdpr_erase_payer";
const ERASE_FAULT = "u_wgdpr_erase_fault";
const ERASE_CLEAN = "u_wgdpr_erase_clean";
const EQUIV_DIRECT = "u_wgdpr_equiv_direct";
const EQUIV_LEGACY = "u_wgdpr_equiv_legacy";

let app: Express;
let server: http.Server;
let port: number;

const now = (): string => new Date().toISOString();

function run(sql: string, ...args: unknown[]): void {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[wgdpr fixture] ${(err as Error).message}\nSQL: ${sql}`);
  }
}
function get<T = any>(sql: string, ...args: unknown[]): T | undefined {
  return rawDb().prepare(sql).get(...(args as any[])) as T | undefined;
}
function all<T = any>(sql: string, ...args: unknown[]): T[] {
  return rawDb().prepare(sql).all(...(args as any[])) as T[];
}

function seedChapter(): void {
  run(
    `INSERT OR REPLACE INTO chapters
       (id, tenant_id, name, region, city, status, admin_user_id, created_at, updated_at, deleted_at)
     VALUES (?, ?, 'GDPR Hardening Chapter', 'NA-East', 'Toronto', 'active', NULL, ?, ?, NULL)`,
    CH, CH_TENANT, now(), now(),
  );
}

function seedUser(userId: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, deleted_at)
     VALUES (?, ?, ?, ?, 'investor', NULL)`,
    userId, CH_TENANT, `${userId}@wgdpr.test.local`, `WGDPR ${userId}`,
  );
}

function seedMembership(userId: string, role: "member" | "admin", status = "active", chapterId = CH): void {
  run(
    `INSERT OR REPLACE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    `chm_wgdpr_${userId}_${chapterId}`, CH_TENANT, chapterId, userId, role, status, now(), now(), now(),
  );
}

/** A real billing row in the tenant the payment routes read. */
function seedBilling(userId: string, status: string, cancelAtPeriodEnd = 0, chapterId = CH): string {
  const id = `bil_wgdpr_${userId}_${chapterId}`;
  run(
    `INSERT OR REPLACE INTO collective_memberships_billing
       (id, tenant_id, chapter_id, user_id, tier, status, stripe_customer_id,
        stripe_subscription_id, stripe_price_id, current_period_start,
        current_period_end, cancel_at_period_end, prev_hash, curr_hash,
        created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, 'standard', ?, 'cus_wgdpr', 'sub_wgdpr', 'price_standard_test',
             1780000000, 1790000000, ?, NULL, ?, ?, ?, NULL)`,
    id, tenantForChapter(chapterId), chapterId, userId, status, cancelAtPeriodEnd,
    `h_wgdpr_seed_${userId}`, now(), now(),
  );
  return id;
}

function billingRow(userId: string, chapterId = CH) {
  return get<{
    id: string; status: string; cancel_at_period_end: number;
    prev_hash: string | null; curr_hash: string; updated_at: string;
  }>(
    `SELECT id, status, cancel_at_period_end, prev_hash, curr_hash, updated_at
       FROM collective_memberships_billing WHERE user_id = ? AND chapter_id = ?`,
    userId, chapterId,
  );
}

function membershipRow(userId: string, chapterId = CH) {
  return get<{ role: string; status: string; deleted_at: string | null }>(
    `SELECT role, status, deleted_at FROM chapter_memberships WHERE chapter_id = ? AND user_id = ?`,
    chapterId, userId,
  );
}

function auditRows(target: string) {
  return all<{ actor_id: string; action: string; payload_json: string }>(
    `SELECT actor_id, action, payload_json FROM audit_log WHERE target = ? ORDER BY created_at ASC, id ASC`,
    target,
  );
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
    const r = http.request({ hostname: "127.0.0.1", port, path: apiPath, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body, text: buf });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

const cancelHttp = (as: string) =>
  call("POST", "/api/collective/membership/cancel", { userId: as, body: { chapter_id: CH } });

const anonymizeHttp = (target: string, as = "u_admin") =>
  call("POST", `/api/admin/users/${target}/anonymize`, { userId: as, userRole: "admin" });

/* ------------------------------------------------ fetch spy (no Airwallex) */

let fetchSpy: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

function armFetchSpy(): void {
  fetchSpy = vi.fn((...args: any[]) => {
    throw new Error(`FORBIDDEN OUTBOUND CALL in a local-only path: ${String(args[0])}`);
  });
  (globalThis as any).fetch = fetchSpy;
}
function assertNoOutboundCall(): void {
  expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual([]);
}

/* ------------------------------------------------------------------ harness */

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  for (const uid of [ADMIN, ADMIN2, PAYER, PLAIN]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
    upsertCapTablePositionForTests(uid);
    recordAccreditationDeclaration(uid, {
      signatureName: `WGDPR ${uid}`,
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
}, 90_000);

afterAll(async () => {
  (globalThis as any).fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

beforeEach(() => {
  run(`DELETE FROM chapter_memberships WHERE chapter_id = ?`, CH);
  run(`DELETE FROM collective_memberships_billing WHERE id LIKE 'bil_wgdpr%'`);
  run(`DELETE FROM audit_log WHERE target LIKE ?`, `chapter_membership:${CH}:%`);
  run(`DELETE FROM audit_log WHERE target LIKE 'collective_billing:bil_wgdpr%'`);
  seedChapter();
  seedMembership(ADMIN, "admin");
  seedMembership(PAYER, "member");
  seedMembership(PLAIN, "member");
  for (const u of [ERASE_PAYER, ERASE_FAULT, ERASE_CLEAN, EQUIV_DIRECT, EQUIV_LEGACY]) seedUser(u);
  armFetchSpy();
});

/* =========================================================================
   1. chaptersStore REVOKE — the shared preconditions, fail closed
   ========================================================================= */

describe("Task 1 — chaptersStore revoke runs the SHARED chapterGovernanceRules preconditions", () => {
  it("REFUSES to revoke a member holding an ACTIVE subscription (SUBSCRIPTION_ACTIVE_CANCEL_FIRST)", () => {
    seedBilling(PAYER, "active", 0);
    const r = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: ADMIN } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
      expect(String(r.message ?? "")).toMatch(/cancel/i);
    }
    // untouched — no partial write, so `isChapterMember` can never 403 the payer
    expect(membershipRow(PAYER)?.status).toBe("active");
    expect(membershipRow(PAYER)?.deleted_at ?? null).toBeNull();
    assertNoOutboundCall();
  });

  it("REFUSES for pending / past_due / unknown statuses too (fail closed)", () => {
    for (const status of ["pending", "past_due", "trialing_new_gateway_state", ""]) {
      run(`DELETE FROM collective_memberships_billing WHERE id LIKE 'bil_wgdpr%'`);
      seedBilling(PAYER, status, 0);
      const r = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: ADMIN } });
      expect(r.ok, `status=${status || "<empty>"}`).toBe(false);
      if (!r.ok) expect(r.error, `status=${status || "<empty>"}`).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
      expect(membershipRow(PAYER)?.status).toBe("active");
    }
    assertNoOutboundCall();
  });

  it("a PLATFORM ADMIN cannot override the money guard from the store either", () => {
    seedBilling(PAYER, "active", 0);
    const r = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: "u_platform_root", isPlatformAdmin: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
    expect(membershipRow(PAYER)?.status).toBe("active");
  });

  it("SUCCEEDS once the subscription is cancelled — cancel first, then revoke (via the REAL cancel endpoint)", async () => {
    seedBilling(PAYER, "active", 0);
    const refused = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: ADMIN } });
    expect(refused.ok).toBe(false);

    const c = await cancelHttp(PAYER);
    expect(c.status).toBe(200);
    expect(c.body?.cancelAtPeriodEnd).toBe(true);
    expect(billingRow(PAYER)?.cancel_at_period_end).toBe(1);

    const r = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: ADMIN } });
    expect(r.ok).toBe(true);
    expect(membershipRow(PAYER)?.status).toBe("revoked");
    expect(membershipRow(PAYER)?.deleted_at).not.toBeNull();
    assertNoOutboundCall();
  });

  it("REFUSES to revoke the LAST active admin of the chapter (LAST_CHAPTER_ADMIN)", () => {
    const r = storeRevoke({ chapterId: CH, userId: ADMIN, actor: { userId: ADMIN } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(GUARD_ERRORS.LAST_CHAPTER_ADMIN);
    expect(membershipRow(ADMIN)?.status).toBe("active");
    expect(membershipRow(ADMIN)?.role).toBe("admin");
  });

  it("allows revoking an admin once a SECOND active admin exists (rule is not a blanket ban)", () => {
    seedMembership(ADMIN2, "admin");
    const r = storeRevoke({ chapterId: CH, userId: ADMIN, actor: { userId: ADMIN2 } });
    expect(r.ok).toBe(true);
    expect(membershipRow(ADMIN)?.status).toBe("revoked");
  });

  it("REFUSES when the billing table cannot be read at all (BILLING_STATE_UNVERIFIABLE)", () => {
    seedBilling(PAYER, "cancelled", 0); // settled ⇒ would otherwise be allowed
    run(`ALTER TABLE collective_memberships_billing RENAME TO collective_memberships_billing_hidden`);
    try {
      const r = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: ADMIN } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(GUARD_ERRORS.BILLING_STATE_UNVERIFIABLE);
      expect(membershipRow(PAYER)?.status).toBe("active");
    } finally {
      run(`ALTER TABLE collective_memberships_billing_hidden RENAME TO collective_memberships_billing`);
    }
    // recovers as soon as the read works again
    const after = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: ADMIN } });
    expect(after.ok).toBe(true);
  });

  it("the refusal is RETURNED, never swallowed: nothing is written and nothing is audited", () => {
    seedBilling(PAYER, "active", 0);
    const before = auditRows(`chapter_membership:${CH}:${PAYER}`).length;
    const r = storeRevoke({ chapterId: CH, userId: PAYER, actor: { userId: ADMIN } });
    expect(r.ok).toBe(false);
    expect(auditRows(`chapter_membership:${CH}:${PAYER}`).length).toBe(before);
    expect(membershipRow(PAYER)?.status).toBe("active");
  });

  it("joinChapter behaviour is UNCHANGED: activates a pending member, preserves a live admin role (the gate is a no-op on both)", async () => {
    seedMembership(PLAIN, "member", "pending");
    const j = await joinChapter({ userId: PLAIN, chapterId: CH, role: "member" });
    expect(j.id).toBeTruthy();
    expect(membershipRow(PLAIN)?.status).toBe("active");
    // a live ACTIVE admin is never demoted by a role='member' join
    const j2 = await joinChapter({ userId: ADMIN, chapterId: CH, role: "member" });
    expect(j2.created).toBe(false);
    expect(membershipRow(ADMIN)?.role).toBe("admin");
    /* The refusal type exists and is exported for callers to branch on. */
    expect(typeof ChapterGovernanceRefusalError).toBe("function");
  });
});

/* =========================================================================
   2. GDPR ERASURE — cancel, then revoke, NEVER blocked
   ========================================================================= */

describe("Task 2 — GDPR erasure of a PAYING member: cancels, revokes, and is never blocked", () => {
  it("SUCCEEDS for a member with an ACTIVE subscription, cancels it, and revokes memberships", async () => {
    seedMembership(ERASE_PAYER, "member");
    const billingId = seedBilling(ERASE_PAYER, "active", 0);

    const r = await anonymizeHttp(ERASE_PAYER);

    /* NOT BLOCKED — no 409/403, and no billing guard code anywhere in the body */
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.text).not.toContain(GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST);
    expect(r.text).not.toContain(GUARD_ERRORS.BILLING_STATE_UNVERIFIABLE);

    /* 1. cancelled */
    const b = billingRow(ERASE_PAYER);
    expect(b?.cancel_at_period_end).toBe(1);
    expect(b?.prev_hash).toBe(`h_wgdpr_seed_${ERASE_PAYER}`);
    expect(r.body?.billingFollowUpRequired).toBe(false);
    expect(r.body?.subscriptionsCancelled?.map((c: any) => c.billingId)).toContain(billingId);

    /* 2. revoked */
    expect(membershipRow(ERASE_PAYER)?.status).toBe("revoked");
    expect(membershipRow(ERASE_PAYER)?.deleted_at).not.toBeNull();

    /* 3. erasure completed */
    const u = get<{ anonymized_at: string | null; email: string }>(
      `SELECT anonymized_at, email FROM users WHERE id = ?`, ERASE_PAYER,
    );
    expect(u?.anonymized_at).toBeTruthy();
    expect(u?.email).toBe(`deleted+${ERASE_PAYER}@example.invalid`);
    const del = get<{ reason: string; confirmed_at: string | null }>(
      `SELECT reason, confirmed_at FROM data_delete_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
      ERASE_PAYER,
    );
    expect(del?.reason).toBe("admin_anonymization"); // clean run ⇒ no follow-up marker
    expect(del?.confirmed_at).toBeTruthy();

    /* 4. provable in the audit trail */
    const audits = auditRows(`user:${ERASE_PAYER}`);
    const cancelAudit = audits.find((a) => a.action === "gdpr.erasure.billing_cancelled");
    expect(cancelAudit).toBeTruthy();
    const payload = JSON.parse(cancelAudit?.payload_json ?? "{}");
    expect(payload.cancelled?.[0]?.billingId).toBe(billingId);
    expect(payload.followUpRequired).toBe(false);
    const cancelRequested = auditRows(`collective_billing:${billingId}`);
    expect(cancelRequested.map((a) => a.action)).toContain("collective.billing.cancel_requested");

    /* 5. no Airwallex */
    assertNoOutboundCall();
  });

  it("COMPLETES even when the cancellation write FAILS, and records a follow-up marker", async () => {
    seedMembership(ERASE_FAULT, "member");
    const billingId = seedBilling(ERASE_FAULT, "active", 0);

    /* Fault injection: the billing row is READABLE but any UPDATE aborts.
       This is exactly the "cancellation write failed" case. */
    run(
      `CREATE TRIGGER wgdpr_block_billing_update BEFORE UPDATE ON collective_memberships_billing
         BEGIN SELECT RAISE(ABORT, 'injected cancel write failure'); END`,
    );
    let r: { status: number; body: any; text: string };
    try {
      r = await anonymizeHttp(ERASE_FAULT);
    } finally {
      run(`DROP TRIGGER wgdpr_block_billing_update`);
    }

    /* THE ERASURE STILL HAPPENED */
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    const u = get<{ anonymized_at: string | null }>(`SELECT anonymized_at FROM users WHERE id = ?`, ERASE_FAULT);
    expect(u?.anonymized_at).toBeTruthy();
    expect(membershipRow(ERASE_FAULT)?.status).toBe("revoked");

    /* the cancellation genuinely failed */
    expect(billingRow(ERASE_FAULT)?.cancel_at_period_end).toBe(0);

    /* FOLLOW-UP MARKER — in the delete log and in the audit trail */
    expect(r.body?.billingFollowUpRequired).toBe(true);
    expect(r.body?.subscriptionCancellationFailures?.[0]?.billingId).toBe(billingId);
    const del = get<{ reason: string }>(
      `SELECT reason FROM data_delete_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, ERASE_FAULT,
    );
    expect(del?.reason).toBe("admin_anonymization+billing_cancel_followup_required");
    const audits = auditRows(`user:${ERASE_FAULT}`);
    const marker = audits.find((a) => a.action === "gdpr.erasure.billing_cancel_followup_required");
    expect(marker).toBeTruthy();
    const payload = JSON.parse(marker?.payload_json ?? "{}");
    expect(payload.followUpRequired).toBe(true);
    expect(String(payload.failed?.[0]?.reason ?? "")).toMatch(/injected cancel write failure/);
    expect(String(payload.note ?? "")).toMatch(/MANUAL FINANCE RECONCILIATION REQUIRED/);
    assertNoOutboundCall();
  });

  it("COMPLETES when the whole billing TABLE is unreadable, with a follow-up marker", async () => {
    seedMembership(ERASE_CLEAN, "member");
    run(`ALTER TABLE collective_memberships_billing RENAME TO collective_memberships_billing_hidden`);
    let r: { status: number; body: any; text: string };
    try {
      r = await anonymizeHttp(ERASE_CLEAN);
    } finally {
      run(`ALTER TABLE collective_memberships_billing_hidden RENAME TO collective_memberships_billing`);
    }
    expect(r.status).toBe(200);
    expect(r.body?.billingFollowUpRequired).toBe(true);
    expect(membershipRow(ERASE_CLEAN)?.status).toBe("revoked");
    const del = get<{ reason: string }>(
      `SELECT reason FROM data_delete_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, ERASE_CLEAN,
    );
    expect(del?.reason).toBe("admin_anonymization+billing_cancel_followup_required");
    assertNoOutboundCall();
  });

  it("REGRESSION GUARD (passes pre-fix): a member with NO billing row erases cleanly, reason unchanged", async () => {
    const target = "u_wgdpr_erase_nobilling";
    seedUser(target);
    seedMembership(target, "member");
    const r = await anonymizeHttp(target);
    expect(r.status).toBe(200);
    const del = get<{ reason: string }>(
      `SELECT reason FROM data_delete_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, target,
    );
    expect(del?.reason).toBe("admin_anonymization");
    expect(membershipRow(target)?.status).toBe("revoked");
  });

  it("does NOT touch a SETTLED (cancelled/expired) subscription — nothing to cancel, no false marker", async () => {
    const target = "u_wgdpr_erase_settled";
    seedUser(target);
    seedMembership(target, "member");
    seedBilling(target, "cancelled", 0);
    const r = await anonymizeHttp(target);
    expect(r.status).toBe(200);
    expect(r.body?.billingFollowUpRequired).toBe(false);
    expect(r.body?.subscriptionsCancelled).toEqual([]);
    expect(billingRow(target)?.cancel_at_period_end).toBe(0);
    expect(billingRow(target)?.status).toBe("cancelled");
  });
});

/* =========================================================================
   3. EXTRACTION EQUIVALENCE — the extracted cancellation == the old inline code
   ========================================================================= */

/**
 * The PRE-EXTRACTION inline body of `POST /api/collective/membership/cancel`,
 * copied verbatim from /home/user/workspace/work/_gdprfix/pre_fix_backup/
 * server/collectiveBillingStore.ts (the try-block of the route handler), with
 * only `res.json(...)` replaced by returning the same object. Nothing else was
 * altered: same payloadForHash, same hash input, same UPDATE, same audit call.
 */
function legacyInlineCancel(billing: any, actorUserId: string) {
  const nowIsoLocal = (): string => new Date().toISOString();
  const computeHashLocal = (prevHash: string | null, payload: Record<string, unknown>): string => {
    const h = createHash("sha256");
    h.update(prevHash ?? "GENESIS");
    h.update("|");
    h.update(JSON.stringify(payload));
    return h.digest("hex");
  };
  try {
    const ts = nowIsoLocal();
    const payloadForHash = { id: billing.id, action: "cancel_at_period_end", ts };
    const currHash = computeHashLocal(billing.currHash, payloadForHash);
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(billingTable)
        .set({ cancelAtPeriodEnd: 1, prevHash: billing.currHash, currHash, updatedAt: ts } as any)
        .where(eq((billingTable as any).id, billing.id))
        .run();
    });
    try {
      appendAdminAudit(
        actorUserId,
        `collective_billing:${billing.id}`,
        "collective.billing.cancel_requested",
        { billingId: billing.id, chapterId: billing.chapterId, userId: billing.userId, tier: billing.tier },
      );
    } catch { /* non-fatal */ }
    return {
      ok: true as const,
      billingId: billing.id,
      cancelAtPeriodEnd: true as const,
      accessThrough: billing.currentPeriodEnd ?? null,
    };
  } catch (err) {
    return { ok: false as const, error: "db_write_failed" as const, message: (err as Error).message };
  }
}

/** Normalise per-user identifiers away so two runs are directly comparable. */
function normalise(obj: unknown, userId: string, billingId: string): string {
  return JSON.stringify(obj)
    .split(billingId).join("<BILLING_ID>")
    .split(userId).join("<USER_ID>");
}

describe("Task 2 (constraint) — the EXTRACTED cancellation is behaviourally identical to the old inline code", () => {
  it("produces the same DB state, the same hash-chain step and the same audit entry", () => {
    seedMembership(EQUIV_DIRECT, "member");
    seedMembership(EQUIV_LEGACY, "member");
    const idDirect = seedBilling(EQUIV_DIRECT, "active", 0);
    const idLegacy = seedBilling(EQUIV_LEGACY, "active", 0);

    const bDirect = getBillingForUser(EQUIV_DIRECT, CH);
    const bLegacy = getBillingForUser(EQUIV_LEGACY, CH);
    expect(bDirect).toBeTruthy();
    expect(bLegacy).toBeTruthy();

    const outDirect = applyLocalCancelAtPeriodEnd(bDirect!, "u_equiv_actor");
    const outLegacy = legacyInlineCancel(bLegacy!, "u_equiv_actor");

    /* identical return shape and values (ids normalised) */
    expect(normalise(outDirect, EQUIV_DIRECT, idDirect)).toBe(normalise(outLegacy, EQUIV_LEGACY, idLegacy));

    /* identical resulting DB row */
    const rowDirect = billingRow(EQUIV_DIRECT)!;
    const rowLegacy = billingRow(EQUIV_LEGACY)!;
    expect(rowDirect.cancel_at_period_end).toBe(1);
    expect(rowLegacy.cancel_at_period_end).toBe(1);
    expect(rowDirect.prev_hash).toBe(`h_wgdpr_seed_${EQUIV_DIRECT}`);
    expect(rowLegacy.prev_hash).toBe(`h_wgdpr_seed_${EQUIV_LEGACY}`);

    /* identical hash algorithm, payload and ts source, proven independently */
    const expectHash = (row: typeof rowDirect) => {
      const h = createHash("sha256");
      h.update(row.prev_hash ?? "GENESIS");
      h.update("|");
      h.update(JSON.stringify({ id: row.id, action: "cancel_at_period_end", ts: row.updated_at }));
      return h.digest("hex");
    };
    expect(rowDirect.curr_hash).toBe(expectHash(rowDirect));
    expect(rowLegacy.curr_hash).toBe(expectHash(rowLegacy));

    /* identical audit entry */
    const aDirect = auditRows(`collective_billing:${idDirect}`);
    const aLegacy = auditRows(`collective_billing:${idLegacy}`);
    expect(aDirect.length).toBe(1);
    expect(aLegacy.length).toBe(1);
    expect(aDirect[0].action).toBe("collective.billing.cancel_requested");
    expect(aDirect[0].actor_id).toBe("u_equiv_actor");
    expect(normalise(JSON.parse(aDirect[0].payload_json), EQUIV_DIRECT, idDirect))
      .toBe(normalise(JSON.parse(aLegacy[0].payload_json), EQUIV_LEGACY, idLegacy));

    assertNoOutboundCall();
  });

  it("the REAL route still returns exactly the pre-extraction response shape", async () => {
    seedBilling(PAYER, "active", 0);
    const c = await cancelHttp(PAYER);
    expect(c.status).toBe(200);
    expect(Object.keys(c.body).sort()).toEqual(
      ["accessThrough", "billingId", "cancelAtPeriodEnd", "gateway", "ok"],
    );
    expect(c.body.ok).toBe(true);
    expect(c.body.gateway).toBe("airwallex");
    expect(c.body.cancelAtPeriodEnd).toBe(true);
    expect(c.body.billingId).toBe(`bil_wgdpr_${PAYER}_${CH}`);
    expect(c.body.accessThrough).toBe(1790000000);
    assertNoOutboundCall();
  });

  it("the route's DB-write failure still surfaces as 500 db_write_failed (unchanged failure shape)", async () => {
    seedBilling(PAYER, "active", 0);
    run(
      `CREATE TRIGGER wgdpr_block_billing_update_route BEFORE UPDATE ON collective_memberships_billing
         BEGIN SELECT RAISE(ABORT, 'injected route write failure'); END`,
    );
    try {
      const c = await cancelHttp(PAYER);
      expect(c.status).toBe(500);
      expect(c.body?.ok).toBe(false);
      expect(c.body?.error).toBe("db_write_failed");
      expect(String(c.body?.message ?? "")).toMatch(/injected route write failure/);
    } finally {
      run(`DROP TRIGGER wgdpr_block_billing_update_route`);
    }
  });
});

/* =========================================================================
   4. NO AIRWALLEX PLUMBING WAS TOUCHED
   ========================================================================= */

describe("ABSOLUTE CONSTRAINT — no Airwallex call, no Airwallex code, on any of these paths", () => {
  it("the extracted cancellation contains no outbound/gateway call at all (static proof)", () => {
    const src = readFileSync(new URL("../collectiveBillingStore.ts", import.meta.url), "utf8");
    const start = src.indexOf("export function applyLocalCancelAtPeriodEnd(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\nfunction rowToBilling", start));
    expect(body).not.toMatch(/airwallex/i);
    expect(body).not.toMatch(/\bfetch\s*\(/);
    expect(body).not.toMatch(/paymentGatewayAdapter|createPaymentIntent|gatewayFor/);
  });

  it("the GDPR erasure cancellation helper contains no outbound/gateway call at all (static proof)", () => {
    const src = readFileSync(new URL("../gdprRoutes.ts", import.meta.url), "utf8");
    const start = src.indexOf("function cancelBillableSubscriptionsForErasure(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\nfunction clientIp(", start));
    expect(body).not.toMatch(/airwallex/i);
    expect(body).not.toMatch(/\bfetch\s*\(/);
  });

  it("REGRESSION GUARD: an erasure with a live subscription performs zero outbound requests", async () => {
    const target = "u_wgdpr_erase_nofetch";
    seedUser(target);
    seedMembership(target, "member");
    seedBilling(target, "past_due", 0);
    const r = await anonymizeHttp(target);
    expect(r.status).toBe(200);
    expect(billingRow(target)?.cancel_at_period_end).toBe(1);
    assertNoOutboundCall();
  });
});
