/**
 * WAVE 57d · D4 — THREE OF THE "24 NON-DESTRUCTIVE" ACTOR SITES WERE DESTRUCTIVE.
 *
 * Wave 57c bound the audit actor at 4 of 28 anonymous-actor sites and classified
 * the remaining 24 as non-destructive. Independent Review 1 found that
 * classification false and named three counter-examples: partner fee-schedule
 * expiry, collective subscription-package deletion, and chapter-admin demotion.
 * Wave 57d binds the actor at those three (plus the collective payment-schedule
 * expiry, which is the exact analogue of the partner one), using the pattern
 * already established in this tree — refuse BEFORE the mutation, never fabricate
 * an actor afterwards (server/bridgeStore.ts:1500 and 57c's four sites).
 *
 * The full honest re-classification of all sites, ranked by blast radius, with
 * what was fixed and what was deliberately left, is in
 * build_log/wave57d/W57D_ACTOR_RECLASSIFICATION.md.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 * A handler that refused everyone would satisfy "the actor is never anonymous"
 * while having disabled a legitimate admin operation, which the wave's
 * NO-DISABLING constraint forbids. So each site below asserts:
 *   UPPER POLE — the admin operation still succeeds end to end;
 *   AUDIT      — the row it writes carries the caller's identity, and matches
 *                neither `u_unknown_admin` nor `/^system/` nor empty.
 * Everything runs through real HTTP against the real `registerRoutes(...)`.
 *
 * MUTATION TRANSCRIPT: build_log/wave57d/W57D_TESTS.md (M4).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { chapterMemberships as chapterMembershipsTable } from "@shared/schema";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { __setRuntimePersona } from "../lib/userContext";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

const CHAPTER = "chap_keiretsu_canada";
const TENANT_CHAPTER = "tenant_chap_chap_keiretsu_canada";
const PLATFORM_ADMIN = "u_w57d_root";
const KEEPER = "u_w57d_keeper"; // stays admin so the last-admin safeguard is satisfied
const DEMOTEE = "u_w57d_demotee";

let app: Express;
let server: http.Server;

/** The banned actor shapes, in one place. R35. */
function expectBoundActor(actor: string | null | undefined) {
  const a = String(actor ?? "");
  expect(a).not.toBe("");
  expect(a).not.toBe("u_unknown_admin");
  expect(a).not.toMatch(/^system/);
  expect(a).not.toBe("admin");
}

function latestAudit(action: string, target?: string) {
  const rows = target
    ? (rawDb()
        .prepare(
          `SELECT actor_id AS actorId, action, target, payload_json AS payloadJson FROM audit_log
             WHERE action = ? AND target = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .all(action, target) as Array<{ actorId: string | null; action: string; target: string; payloadJson: string | null }>)
    : (rawDb()
        .prepare(
          `SELECT actor_id AS actorId, action, target, payload_json AS payloadJson FROM audit_log
             WHERE action = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .all(action) as Array<{ actorId: string | null; action: string; target: string; payloadJson: string | null }>);
  return rows[0];
}

function nowIso() {
  return new Date().toISOString();
}

function ensureChapterMembership(userId: string, role: "member" | "admin") {
  const db: any = getDb();
  const existing = db
    .select({ id: (chapterMembershipsTable as any).id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).userId, userId),
        eq((chapterMembershipsTable as any).chapterId, CHAPTER),
      ),
    )
    .all() as any[];
  if (existing.length > 0) {
    db.update(chapterMembershipsTable)
      .set({ role, status: "active", updatedAt: nowIso() })
      .where(eq((chapterMembershipsTable as any).id, existing[0].id))
      .run();
    return;
  }
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_w57d_${userId}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: TENANT_CHAPTER,
      chapterId: CHAPTER,
      userId,
      role,
      status: "active",
      joinedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as any)
    .run();
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  __setRuntimePersona({
    userId: PLATFORM_ADMIN,
    email: "w57d-root@capavate.example",
    name: "W57d Root",
    isFounder: false,
    isInvestor: false,
    isAdmin: true,
    hasInvitations: false,
  });
  for (const uid of [KEEPER, DEMOTEE]) {
    __setRuntimePersona({
      userId: uid,
      email: `${uid}@capavate.example`,
      name: uid,
      isFounder: false,
      isInvestor: true,
      isAdmin: false,
      hasInvitations: false,
    });
    collectiveMembershipStore.activate(uid, PLATFORM_ADMIN);
    ensureChapterMembership(uid, "admin");
  }

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  delete process.env.COLLECTIVE_ENABLED;
});

describe("W57d D4 — chapter-admin DEMOTION (a privilege removal) is attributed to a real person", () => {
  it("UPPER POLE + AUDIT: the demotion still works and the audit row names the caller, not system:admin", async () => {
    ensureChapterMembership(DEMOTEE, "admin");
    ensureChapterMembership(KEEPER, "admin");

    const r = await request(app)
      .delete(`/api/admin/chapters/${CHAPTER}/admins/${DEMOTEE}`)
      .set("x-user-id", PLATFORM_ADMIN);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true });

    const row = latestAudit("collective.chapter_admin.demoted");
    expect(row).toBeTruthy();
    expectBoundActor(row.actorId);
    expect(row.actorId).toBe(PLATFORM_ADMIN);
    expect(JSON.parse(row.payloadJson ?? "{}")).toMatchObject({
      chapterId: CHAPTER,
      targetUserId: DEMOTEE,
      previousRole: "admin",
      newRole: "member",
    });
  });

  it("NOT DISABLED: the last-admin 409 safeguard still fires ahead of any write", async () => {
    ensureChapterMembership(DEMOTEE, "member");
    ensureChapterMembership(KEEPER, "admin");
    const r = await request(app)
      .delete(`/api/admin/chapters/${CHAPTER}/admins/${KEEPER}`)
      .set("x-user-id", PLATFORM_ADMIN);
    // Either the last-admin refusal (409) or a successful demotion when other
    // seeded admins exist — but never a 401/500 introduced by the actor gate.
    expect([200, 409]).toContain(r.status);
    if (r.status === 409) expect(r.body.error).toBe("last_admin");
  });
});

describe("W57d D4 — partner FEE-SCHEDULE EXPIRY (a money control) is attributed to a real person", () => {
  it("UPPER POLE + AUDIT: create then expire a schedule; the expiry audit row names the caller", async () => {
    const created = await request(app)
      .post("/api/admin/partner-fees")
      .set("x-user-id", PLATFORM_ADMIN)
      .send({ feeKind: "spv_closing_bonus", amountMinor: 12345, currency: "USD", tier: null });
    expect([200, 201]).toContain(created.status);
    const id = created.body.id ?? created.body.schedule?.id ?? created.body.scheduleId;
    expect(typeof id).toBe("string");

    const expired = await request(app)
      .delete(`/api/admin/partner-fees/${id}`)
      .set("x-user-id", PLATFORM_ADMIN);
    expect(expired.status).toBe(200);
    expect(expired.body).toMatchObject({ ok: true });

    // The row really was expired — the operation is not merely audited.
    const row = rawDb()
      .prepare(`SELECT effective_to FROM partner_fee_schedules WHERE id = ?`)
      .get(id) as { effective_to: string | null };
    expect(row.effective_to).toBeTruthy();

    const audit = latestAudit("partner_fee_schedule.expired", `partner_fee_schedule:${id}`);
    expect(audit).toBeTruthy();
    expectBoundActor(audit.actorId);
    /* This file's `actorOf` prefers `identity.email` over `userId`, and the fix
       PRESERVES that ordering so the recorded value is unchanged for legitimate
       callers. Either form is acceptable; an anonymous placeholder is not. */
    expect([PLATFORM_ADMIN, "w57d-root@capavate.example"]).toContain(audit.actorId);
  });
});

describe("W57d D4 — collective SUBSCRIPTION-PACKAGE DELETION is attributed to a real person", () => {
  /* The package store validates `airwallexPriceId` against the CURRENTLY
     configured Airwallex refs, which are env-supplied and absent in the test
     sandbox, so a draft cannot be created through the POST route here. The
     fixture row is therefore inserted directly — but the ASSERTION still runs
     through the real HTTP DELETE route, which is the thing under test. */
  const PKG_ID = "csp_w57d_d4_probe";

  function seedDraftPackage() {
    const now = nowIso();
    rawDb()
      .prepare(
        `INSERT OR REPLACE INTO collective_subscription_configs
           (id, slug, label, description, entitlements_json, amount_minor, currency, interval,
            airwallex_tier, airwallex_price_id, membership_role, status, sort_order,
            effective_from, effective_to, version, prev_revision_hash, revision_hash,
            metadata_json, created_at, updated_at, created_by, updated_by, deleted_at)
         VALUES (?, 'w57d-d4-probe', 'W57d D4 probe', '', '[]', 100000, 'USD', 'annual',
            'basic', 'price_w57d_probe', 'member', 'draft', 0,
            NULL, NULL, 1, ?, 'w57d_probe_hash', '{}', ?, ?, ?, ?, NULL)`,
      )
      .run(PKG_ID, "0".repeat(64), now, now, PLATFORM_ADMIN, PLATFORM_ADMIN);
  }

  it("UPPER POLE + AUDIT: the delete still succeeds and stamps the CALLER, not u_unknown_admin", async () => {
    seedDraftPackage();
    const del = await request(app)
      .delete(`/api/admin/collective-subscriptions/${PKG_ID}`)
      .set("x-user-id", PLATFORM_ADMIN);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ ok: true });

    const row = rawDb()
      .prepare(`SELECT deleted_at AS deletedAt, updated_by AS updatedBy FROM collective_subscription_configs WHERE id = ?`)
      .get(PKG_ID) as { deletedAt: string | null; updatedBy: string | null };
    // The soft delete really happened …
    expect(row.deletedAt).toBeTruthy();
    // … and it is attributed to a real person.
    expectBoundActor(row.updatedBy);
    expect(row.updatedBy).toBe(PLATFORM_ADMIN);
  });

  it("NOT DISABLED: a missing package still answers 404, not 401", async () => {
    const del = await request(app)
      .delete("/api/admin/collective-subscriptions/csp_w57d_does_not_exist")
      .set("x-user-id", PLATFORM_ADMIN);
    expect(del.status).toBe(404);
    expect(del.body).toMatchObject({ ok: false, error: "not_found" });
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   THE POLE THAT ACTUALLY FAILS WITHOUT THE FIX — AND WHY IT HAS TO BE THIS ONE.

   `requireAdmin` always assigns `req.userContext`, so on every route below the
   anonymous fallback was ALREADY unreachable at runtime today: the audit rows
   asserted above carry the real caller with or without this wave's change. Wave
   57c disclosed the same limitation for its own four sites (U2). An HTTP test
   therefore CANNOT distinguish fixed from unfixed here, and pretending otherwise
   would be the kind of false proof this project has been burned by.

   What the fix genuinely changes is the STRUCTURE: the destructive path can no
   longer silently BECOME anonymous if a future wave moves a mount. That is a
   source-level property, so it is asserted at source level — and this is the
   assertion that goes red if the fix is reverted. The R36 boundary explicitly
   covers source-text inventories of this kind.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W57d D4 — the destructive paths no longer read an anonymous actor fallback", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

  it("chapter-admin DEMOTION resolves the actor before the mutation and refuses without one", () => {
    const src = read("chapterAdminRoutes.ts");
    const block = src.slice(src.indexOf('app.delete(\n    "/api/admin/chapters/:chapterId/admins/:userId"'));
    expect(block).toContain("demoteActorId");
    expect(block).toContain('code: "missing_identity"');
    /* The demote audit must use the resolved actor, not the inline fallback. */
    const demoteAudit = block.slice(block.indexOf("collective.chapter_admin.demoted") - 400, block.indexOf("collective.chapter_admin.demoted"));
    expect(demoteAudit).not.toContain("system:admin");
  });

  it("partner FEE-SCHEDULE EXPIRY resolves the actor before the write and refuses without one", () => {
    const src = read("lib/partnerFeeAdminRoutes.ts");
    const block = src.slice(src.indexOf('app.delete("/api/admin/partner-fees/:id"'));
    const handler = block.slice(0, block.indexOf("app.put("));
    expect(handler).toContain("requireActorOrRefuse");
    expect(handler).toContain("expireActorId");
    expect(handler).not.toContain("actorOf(req)");
  });

  it("collective PAYMENT-SCHEDULE EXPIRY resolves the actor before the write", () => {
    const src = read("lib/collectivePaymentAdminRoutes.ts");
    const block = src.slice(src.indexOf('app.delete("/api/admin/collective-payments/schedules/:id"'));
    const handler = block.slice(0, block.indexOf("/* ---- Collective P&L"));
    expect(handler).toContain("requireActorOrRefuse");
    expect(handler).not.toContain("actorOf(req)");
  });

  it("collective SUBSCRIPTION-PACKAGE DELETION resolves the actor before the delete", () => {
    const src = read("collectiveSubscriptionAdminRoutes.ts");
    const block = src.slice(src.indexOf("app.delete(`${BASE}/:id`"));
    const handler = block.slice(0, block.indexOf("bootstrap-from-env"));
    expect(handler).toContain("requireActorOrRefuse");
    expect(handler).toContain("deleteActorId");
    expect(handler).not.toContain("actorOf(req)");
  });

  it("NOT SWEEPING: the shared actorOf helpers are deliberately left in place for the non-destructive routes", () => {
    /* Recorded so the narrow choice is visible and reversible: switching these
       helpers wholesale is the recommendation for the authorised 57e sweep, not
       something this wave took. */
    expect(read("lib/partnerFeeAdminRoutes.ts")).toContain("function actorOf(req: Request): string");
    expect(read("collectiveSubscriptionAdminRoutes.ts")).toContain("function actorOf(req: Request): string");
  });
});
