/* v25.35 Phase 5 — E2E: persistence-integrity sweep.
 *
 * Proves the two defect-class fixes shipped in v25.35:
 *   (A) In-memory-authority defects now fall back to the DB, so a COLD CACHE
 *       (simulated by clearing the relevant Map/array) no longer locks out a
 *       genuinely-persisted record (wrong 404 / 403).
 *   (B) Swallow-and-success sites are now FAIL-CLOSED: when the durable write
 *       cannot commit (simulated by transiently renaming the target table so
 *       the INSERT/UPDATE throws), the route returns 500 AND the in-memory
 *       cache / hash chain is NOT advanced (no half-applied state).
 *
 * Everything runs against the live SQLite DB via rawDb(); the express app is
 * booted exactly as the live server boots it (registerRoutes), matching the
 * v25.34 E2E harness. No dev-only code paths.
 *
 * Scenarios (per /tmp/v25_35_brief.md Phase 5):
 *   1. Cache-poison       — clear memberships Map, assert isActive() true for a
 *                           DB-active member (DB fallback works).
 *   2. DB-fail -> 500     — rename dsc_roles so the promote INSERT throws; assert
 *                           the route returns 500 and the role is NOT in memory.
 *   3. Cold-cache lockout — clear membership cache, hit /api/collective/me/
 *                           payment-quote as an active member, assert NOT 403.
 *   4. Invitation persist — create an invite, clear memInvitations, assert
 *                           redeemInvitation still resolves it (DB-first read).
 *   5. Audit chain        — simulate DB fail during carry-forward append; assert
 *                           the in-memory hash-chain head does NOT advance.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";

import * as membershipStore from "../collectiveMembershipStore.ts";
import * as adminDsc from "../adminDscRoutes.ts";
import {
  createInvitation,
  redeemInvitation,
  _testAccessInvitations,
} from "../roundInvitationsStore.ts";
import {
  appendCarryForwardAuditEntry,
  getCarryForwardAuditLog,
} from "../roundCarryForwardRoutes.ts";
// v25.35 fix-2 — round-2 scenario imports.
import { clearFounderCollectiveStore } from "../founderCollectiveApplyStore.ts";
import { addCompanyForFounder } from "../multiCompanyStore.ts";

let app, server, port;
const ADMIN = `u_v2535_admin_${Date.now()}`;
const MEMBER = `u_v2535_member_${Date.now()}`;
const CHAPTER = "chap_demo";
const COMPANY = "co_v2535_demo";
const results = [];

function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`);
}

function req(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? ADMIN };
    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** v25.35 fix-2 — seed a durable billing row for (userId, chapterId) so the
 * member-tier resolver (now fail-closed on a missing row) can quote. */
function seedBillingRow(userId, chapterId, tier) {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO collective_memberships_billing
         (id, tenant_id, chapter_id, user_id, tier, status, cancel_at_period_end, curr_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)`,
    )
    .run(`billing_${userId}_${chapterId}`, `tenant_chap_${chapterId}`, chapterId, userId, tier, `hash_${userId}`, now, now);
}

/** v25.35 fix-2 — minimal FounderCompanyMembership so the founder ownership
 * gate on POST /api/founder/collective/applications passes for a seeded user.
 *
 * v25.45.4 L-3 (Ozan decision b) — Collective apply now requires the company
 * to have an active or live funding round. We seed one here so this v25.35
 * persistence-integrity sweep exercises the post-gate paths (founder duplicate
 * 409, admin reject fail-closed, etc.) instead of being short-circuited by
 * the new NO_ACTIVE_ROUND gate. The gate itself is covered by v25_45_4_regression. */
function seedFounderCompany(founderId, companyId) {
  addCompanyForFounder(founderId, {
    companyId,
    companyName: `Co ${companyId}`,
    legalName: `Co ${companyId} Inc`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 100 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: new Date().toISOString(), cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Seed",
    hq: "SF",
  });
  /* v25.45.4 L-3 active-round seed (additive, idempotent via INSERT OR IGNORE) */
  try {
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO rounds
           (id, company_id, name, type, state, target_amount, raised_amount, created_at, updated_at)
         VALUES (?, ?, ?, 'priced', 'active', 1000000, 0, datetime('now'), datetime('now'))`
      )
      .run(`rnd_v2535_${companyId}`, companyId, `Seed Round ${companyId}`);
  } catch {
    /* silent: if rawDb or rounds table is unavailable, the L-3 gate will
       short-circuit and the test will still report a clear failure */
  }
}

const FOUNDER_APP_BODY = {
  pitchDeckFilename: "deck.pdf",
  tractionMrr: 1000,
  tractionUsers: 100,
  tractionGrowthPct: 10,
  asks: "We are seeking an introduction to the collective for our seed round.",
  references: "",
  coverLetter: "x".repeat(120),
  feeAcknowledged: true,
};

function asAdmin() {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2535.test`, name: "v25.35 Admin", isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false });
}
function asFounder(id) {
  __setRuntimePersona({ userId: id, email: `${id}@v2535.test`, name: "Founder", isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });
}

/** Run `fn` with `table` transiently renamed so any write to it throws. */
function withTableBroken(table, fn) {
  const db = rawDb();
  const shadow = `${table}__v2535_broken`;
  db.prepare(`ALTER TABLE ${table} RENAME TO ${shadow}`).run();
  try {
    return fn();
  } finally {
    // Always restore, even if fn threw.
    db.prepare(`ALTER TABLE ${shadow} RENAME TO ${table}`).run();
  }
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2535.test`, name: "v25.35 Admin",
    isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false,
  });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  // v25.35 fix-2 (Concern 2) — memberTierOf now fail-closes when no billing row
  // exists for (user, chapter). Seed MEMBER's billing row so the existing
  // payment-quote scenarios (3) still resolve a tier and return 200.
  membershipStore.activate(MEMBER, ADMIN, "standard", { chapterId: CHAPTER });
  seedBillingRow(MEMBER, CHAPTER, "standard");
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.35 persistence-integrity sweep — E2E", () => {
  // ── Scenario 1: cache-poison / DB fallback for isActive() ──────────────────
  it("1. cache-poison: isActive() falls back to the DB after the cache is cleared", () => {
    // Activate a member (durable write).
    membershipStore.activate(MEMBER, ADMIN, "standard", { chapterId: CHAPTER });
    const dbRow = rawDb()
      .prepare("SELECT status FROM collective_memberships WHERE user_id = ?")
      .get(MEMBER);
    record("member persisted active in DB", dbRow?.status === "active", JSON.stringify(dbRow));
    expect(dbRow?.status).toBe("active");

    // Poison the cache: clear the in-memory authority Map entirely.
    membershipStore._resetForTests();
    record("membership cache cleared (cold cache simulated)", true);

    // Pre-v25.35 this returned false (Map was the sole authority) -> 403 lockout.
    const active = membershipStore.isActive(MEMBER);
    record("isActive() returns true via DB fallback on cold cache", active === true, `isActive=${active}`);
    expect(active).toBe(true);
  });

  // ── Scenario 2: fail-closed DB write -> route 500, no memory mutation ───────
  it("2. DB-fail: promote returns 500 and does NOT seat the role in memory", async () => {
    const target = `u_v2535_dsc_${Date.now()}`;
    // Target must be an active member for the promote gate to pass.
    membershipStore.activate(target, ADMIN, "standard", { chapterId: CHAPTER });

    // The promote is an async HTTP round-trip, so we cannot use the synchronous
    // withTableBroken() helper (its finally would restore the table before the
    // request completes). Rename manually, AWAIT the request, then restore.
    let res;
    const db = rawDb();
    db.prepare("ALTER TABLE dsc_roles RENAME TO dsc_roles__v2535_broken").run();
    try {
      res = await req("POST", "/api/admin/dsc/promote", { body: { userId: target } });
    } finally {
      db.prepare("ALTER TABLE dsc_roles__v2535_broken RENAME TO dsc_roles").run();
    }

    record("promote returns 500 on DB write failure (fail-closed)", res.status === 500, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,120)}`);
    expect(res.status).toBe(500);
    record("500 body carries a sanitized persist-failed error", res.body?.error === "DSC_ROLE_PERSIST_FAILED", JSON.stringify(res.body));
    expect(res.body?.error).toBe("DSC_ROLE_PERSIST_FAILED");

    // The role must NOT be in the in-memory Set, and (the table being restored
    // empty for this user) isDscMember must be false.
    const seated = adminDsc.isDscMember(target);
    record("role NOT seated in memory after failed persist", seated === false, `isDscMember=${seated}`);
    expect(seated).toBe(false);

    const dbRow = rawDb()
      .prepare("SELECT 1 FROM dsc_roles WHERE user_id = ? AND status = 'active'")
      .get(target);
    record("no durable dsc_roles row for the failed promote", !dbRow, JSON.stringify(dbRow));
    expect(!!dbRow).toBe(false);
  });

  // ── Scenario 2b: happy-path promote persists durably (control) ─────────────
  it("2b. control: promote succeeds and seats the role both in DB and memory", async () => {
    const target = `u_v2535_dsc_ok_${Date.now()}`;
    membershipStore.activate(target, ADMIN, "standard", { chapterId: CHAPTER });
    const res = await req("POST", "/api/admin/dsc/promote", { body: { userId: target } });
    record("promote 200 on healthy DB", res.status === 200 && res.body?.ok === true, `status ${res.status}`);
    expect(res.status).toBe(200);
    const dbRow = rawDb()
      .prepare("SELECT status FROM dsc_roles WHERE user_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(target);
    record("durable dsc_roles row written", dbRow?.status === "active", JSON.stringify(dbRow));
    expect(dbRow?.status).toBe("active");
    record("role seated in memory after successful persist", adminDsc.isDscMember(target) === true);
    expect(adminDsc.isDscMember(target)).toBe(true);
  });

  // ── Scenario 3: cold-cache lockout on a member-gated route ─────────────────
  it("3. cold-cache lockout: payment-quote is NOT 403 after the cache is cleared", async () => {
    // Ensure the member is durably active, then poison the cache.
    membershipStore.activate(MEMBER, ADMIN, "standard", { chapterId: CHAPTER });
    membershipStore._resetForTests();
    adminDsc._resetForTests?.();

    const res = await req("GET", "/api/collective/me/payment-quote", { userId: MEMBER });
    // The gate (requireCollectiveMember -> isActive) must resolve via the DB
    // fallback and NOT return 403. A 200 quote (or any non-403/401) proves the
    // cold-cache lockout is closed.
    record("payment-quote is not 403 on cold cache (gate DB fallback)", res.status !== 403, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,120)}`);
    expect(res.status).not.toBe(403);
    record("payment-quote returns a quote (200)", res.status === 200 && res.body?.ok === true, `status ${res.status}`);
    expect(res.status).toBe(200);
  });

  // ── Scenario 4: invitation persistence survives a cache clear ──────────────
  it("4. round invitation: redeem works after memInvitations is cleared (DB-first read)", async () => {
    const created = await createInvitation({
      roundId: `rnd_v2535_${Date.now()}`,
      companyId: COMPANY,
      investorEmail: `inv_v2535_${Date.now()}@example.com`,
      invitedByUserId: ADMIN,
    });
    // The raw token is only exposed at create-time via redeemUrl (lists never
    // re-expose it). The URL shape is `${appUrl}/invite/<encoded-token>` — the
    // token is the LAST path segment, NOT a `?token=` query param. Parse it out.
    let token;
    try {
      const u = new URL(created?.redeemUrl ?? "", "http://x");
      const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
      token = decodeURIComponent(seg);
    } catch { token = null; }
    record("createInvitation returned a token via redeemUrl", !!token, typeof created === "object" ? Object.keys(created).join(",") : String(created));
    expect(!!token).toBe(true);

    // Confirm the durable row exists.
    const tokenHash = _testAccessInvitations.hashToken(token);
    const dbRow = rawDb()
      .prepare("SELECT id, state FROM round_invitations WHERE token_hash = ?")
      .get(tokenHash);
    record("invitation persisted durably", !!dbRow, JSON.stringify(dbRow));
    expect(!!dbRow).toBe(true);

    // Restart-simulate: wipe the in-memory mirror.
    _testAccessInvitations.reset();
    record("memInvitations cleared (restart simulated)", _testAccessInvitations.rows.length === 0);

    // DB-first redeem must still resolve the invitation.
    const redeemer = `u_v2535_redeemer_${Date.now()}`;
    const out = redeemInvitation({ token, redeemedByUserId: redeemer });
    record("redeemInvitation resolved the cold-cache invitation", !!out?.invitation, JSON.stringify(out?.invitation)?.slice(0, 120));
    expect(!!out?.invitation).toBe(true);

    const after = rawDb()
      .prepare("SELECT state, redeemed_by_user_id AS rb FROM round_invitations WHERE token_hash = ?")
      .get(tokenHash);
    record("redemption persisted to DB (accepted)", after?.state === "accepted", JSON.stringify(after));
    expect(after?.state).toBe("accepted");
  });

  // ── Scenario 5: audit hash-chain does NOT advance on a failed durable write ─
  it("5. audit chain integrity: a failed carry-forward persist does NOT advance the in-memory chain", () => {
    const company = `co_v2535_audit_${Date.now()}`;
    const baseParams = {
      roundId: `rnd_v2535_audit_${Date.now()}`,
      companyId: company,
      actor: ADMIN,
      acceptedFields: [{ fieldName: "valuation_cap", suggestedValue: 1000, acceptedValue: 1000 }],
      overriddenFields: [],
      auditDigest: "deadbeef",
    };

    // First append succeeds -> establishes a chain tip for this company.
    const ok = appendCarryForwardAuditEntry(baseParams);
    const tipAfterOk = ok.entryHash;
    const lenAfterOk = getCarryForwardAuditLog().length;
    record("first carry-forward audit append succeeds", !!tipAfterOk, tipAfterOk?.slice(0, 12));
    expect(!!tipAfterOk).toBe(true);

    // Now break the kv-shim table so persistEntryStrict throws on the next append.
    // The kv-shim stores carryForwardAuditLog under a kv_* table; discover its
    // exact name from sqlite_master so the rename targets the right table.
    const kvTable = rawDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'kv_carryForwardAuditLog'")
      .get();
    record("located kv table for carryForwardAuditLog", !!kvTable?.name, kvTable?.name);
    expect(!!kvTable?.name).toBe(true);

    let threw = false;
    withTableBroken(kvTable.name, () => {
      try {
        appendCarryForwardAuditEntry({ ...baseParams, auditDigest: "cafebabe" });
      } catch (e) {
        threw = true;
      }
    });
    record("append threw (fail-closed) when durable write failed", threw === true, `threw=${threw}`);
    expect(threw).toBe(true);

    // The in-memory chain must be EXACTLY where it was: same length, same tip.
    const lenAfterFail = getCarryForwardAuditLog().length;
    record("audit log length unchanged after failed append", lenAfterFail === lenAfterOk, `before=${lenAfterOk} after=${lenAfterFail}`);
    expect(lenAfterFail).toBe(lenAfterOk);

    // A subsequent healthy append must chain off the ORIGINAL tip (not a
    // phantom advanced one), proving no half-applied chain state leaked.
    const ok2 = appendCarryForwardAuditEntry({ ...baseParams, auditDigest: "feedface" });
    record("post-failure append chains off the original tip", ok2.prevEntryHash === tipAfterOk, `prev=${ok2.prevEntryHash?.slice(0,12)} expected=${tipAfterOk?.slice(0,12)}`);
    expect(ok2.prevEntryHash).toBe(tipAfterOk);
  });

  // ── Scenario 6: founder direct duplicate survives a cache wipe (Fix 1) ──────
  it("6. founder duplicate: a second direct application 409s even after the cache is wiped", async () => {
    const founder = `u_v2535_founder_${Date.now()}`;
    const company = `co_v2535_dup_${Date.now()}`;
    seedFounderCompany(founder, company);
    asFounder(founder);

    const body = { ...FOUNDER_APP_BODY, founderId: founder, companyId: company };
    const first = await req("POST", "/api/founder/collective/applications", { body, userId: founder });
    record("first founder application accepted", first.status === 200 || first.status === 201, `status ${first.status} ${JSON.stringify(first.body)?.slice(0,160)}`);
    expect([200, 201]).toContain(first.status);

    // Durable row exists; now WIPE the in-memory cache (cold-worker simulation).
    clearFounderCollectiveStore();
    record("founder application cache wiped (cold worker simulated)", true);

    // Pre-fix this 200/201'd again (memory-only guard). DB-first guard must 409.
    const second = await req("POST", "/api/founder/collective/applications", { body, userId: founder });
    record("duplicate application 409s after cache wipe (DB-first guard)", second.status === 409, `status ${second.status} ${JSON.stringify(second.body)?.slice(0,160)}`);
    expect(second.status).toBe(409);
    record("duplicate response carries duplicate_application error", second.body?.error === "duplicate_application", JSON.stringify(second.body)?.slice(0,160));
    expect(second.body?.error).toBe("duplicate_application");

    asAdmin();
  });

  // ── Scenario 7: memberTierOf no-billing-row -> 409 (Fix 2) ──────────────────
  it("7. member tier: payment-quote 409s (tier_unavailable) when no billing row exists", async () => {
    const noBill = `u_v2535_nobill_${Date.now()}`;
    membershipStore.activate(noBill, ADMIN, "standard", { chapterId: CHAPTER });
    rawDb().prepare("DELETE FROM collective_memberships_billing WHERE user_id = ?").run(noBill);

    const res = await req("GET", "/api/collective/me/payment-quote", { userId: noBill });
    record("no-billing-row quote returns 409 (no fabricated basic)", res.status === 409, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,160)}`);
    expect(res.status).toBe(409);
    record("409 body carries tier_unavailable error", res.body?.error === "tier_unavailable", JSON.stringify(res.body)?.slice(0,160));
    expect(res.body?.error).toBe("tier_unavailable");
  });

  // ── Scenario 8: invitation redeem with DB-fail -> throws, memory not mutated ─
  it("8. invitation redeem: DB write failure throws and does NOT mutate memory", async () => {
    const created = await createInvitation({
      roundId: `rnd_v2535_redeem_${Date.now()}`,
      companyId: COMPANY,
      investorEmail: `inv_redeem_${Date.now()}@example.com`,
      invitedByUserId: ADMIN,
    });
    let token;
    try {
      const u = new URL(created?.redeemUrl ?? "", "http://x");
      token = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    } catch { token = null; }
    expect(!!token).toBe(true);
    const tokenHash = _testAccessInvitations.hashToken(token);

    // Break the round_invitations table so the conditional UPDATE throws.
    let threw = false;
    withTableBroken("round_invitations", () => {
      try {
        redeemInvitation({ token, redeemedByUserId: `u_redeemer_${Date.now()}` });
      } catch { threw = true; }
    });
    record("redeemInvitation threw (fail-closed) on DB write failure", threw === true, `threw=${threw}`);
    expect(threw).toBe(true);

    // In-memory row must NOT be flipped to accepted.
    const memRow = _testAccessInvitations.rows.find((r) => r.tokenHash === tokenHash);
    record("in-memory invitation NOT mutated to accepted after failed redeem", !memRow || memRow.state !== "accepted", JSON.stringify(memRow && { state: memRow.state }));
    expect(memRow ? memRow.state !== "accepted" : true).toBe(true);

    // A healthy redeem afterwards must still succeed (proves no half-applied state).
    const ok = redeemInvitation({ token, redeemedByUserId: `u_redeemer_ok_${Date.now()}` });
    record("healthy redeem succeeds after the failed attempt", !!ok?.invitation, JSON.stringify(ok?.invitation)?.slice(0,100));
    expect(!!ok?.invitation).toBe(true);
  });

  // ── Scenario 9: admin reject with deactivate-fail -> 500, member stays active
  it("9. admin reject: a membership deactivation DB failure 500s and leaves the member active", async () => {
    const founder = `u_v2535_rej_${Date.now()}`;
    const company = `co_v2535_rej_${Date.now()}`;
    seedFounderCompany(founder, company);
    asFounder(founder);
    const appBody = { ...FOUNDER_APP_BODY, founderId: founder, companyId: company };
    const appRes = await req("POST", "/api/founder/collective/applications", { body: appBody, userId: founder });
    expect([200, 201]).toContain(appRes.status);
    const appId = appRes.body?.application?.id ?? appRes.body?.id;
    record("modern founder application created for reject test", !!appId, JSON.stringify(appRes.body)?.slice(0,120));
    expect(!!appId).toBe(true);
    asAdmin();

    // Give the founder an active membership so deactivate has a row to flip.
    membershipStore.activate(founder, ADMIN, "standard", { chapterId: CHAPTER });

    // Break collective_memberships so deactivate() throws inside the reject route.
    let res;
    const db = rawDb();
    db.prepare("ALTER TABLE collective_memberships RENAME TO collective_memberships__v2535_broken").run();
    try {
      res = await req("POST", `/api/admin/collective/applications/${appId}/reject`, { body: { reason: "no" } });
    } finally {
      db.prepare("ALTER TABLE collective_memberships__v2535_broken RENAME TO collective_memberships").run();
    }
    record("reject returns 500 when deactivate() fails (fail-closed)", res.status === 500, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,160)}`);
    expect(res.status).toBe(500);

    // The durable membership row must STILL be active (never suspended).
    const dbRow = rawDb().prepare("SELECT status FROM collective_memberships WHERE user_id = ?").get(founder);
    record("membership row stays active after failed reject", dbRow?.status === "active", JSON.stringify(dbRow));
    expect(dbRow?.status).toBe("active");
  });

  // ── Scenario 10: waitlist review with DB-fail -> throws, cache not mutated ──
  it("10. waitlist review: a DB write failure throws and does NOT mutate the cached row", async () => {
    const waitlistStore = await import("../collectiveWaitlistStore.ts");
    const wlUser = `u_v2535_wl_${Date.now()}`;
    const entry = waitlistStore.createWaitlistEntry({
      kind: "investor_membership",
      userId: wlUser,
      payload: {},
    });
    record("waitlist entry seeded", !!entry?.id, JSON.stringify(entry && { id: entry.id, status: entry.status })?.slice(0,120));
    expect(!!entry?.id).toBe(true);
    const beforeStatus = entry.status;

    // Break the waitlist table so the review UPDATE throws.
    let threw = false;
    withTableBroken("collective_waitlist", () => {
      try {
        waitlistStore.reviewWaitlistEntry(entry.id, "accepted", ADMIN, "note");
      } catch { threw = true; }
    });
    record("reviewWaitlistEntry threw (fail-closed) on DB write failure", threw === true, `threw=${threw}`);
    expect(threw).toBe(true);

    // The cached row must NOT have been mutated to accepted.
    const after = waitlistStore.getWaitlistEntry(entry.id);
    record("cached waitlist row NOT mutated after failed review", after?.status === beforeStatus, `before=${beforeStatus} after=${after?.status}`);
    expect(after?.status).toBe(beforeStatus);
  });

  // ── Scenario 11: DSC demote with DB-fail -> 500, role stays in DB (Fix 6) ──
  it("11. DSC demote: a DB update failure 500s and leaves the durable role active", async () => {
    const target = `u_v2535_demote_${Date.now()}`;
    membershipStore.activate(target, ADMIN, "standard", { chapterId: CHAPTER });
    // Promote durably first.
    const promote = await req("POST", "/api/admin/dsc/promote", { body: { userId: target } });
    expect(promote.status).toBe(200);
    const before = rawDb().prepare("SELECT 1 FROM dsc_roles WHERE user_id = ? AND status = 'active'").get(target);
    record("durable active dsc_roles row exists before demote", !!before, JSON.stringify(before));
    expect(!!before).toBe(true);

    // Break dsc_roles so the demote UPDATE/INSERT throws.
    let res;
    const db = rawDb();
    db.prepare("ALTER TABLE dsc_roles RENAME TO dsc_roles__v2535_demote_broken").run();
    try {
      res = await req("POST", "/api/admin/dsc/demote", { body: { userId: target } });
    } finally {
      db.prepare("ALTER TABLE dsc_roles__v2535_demote_broken RENAME TO dsc_roles").run();
    }
    record("demote returns 500 on DB update failure (fail-closed)", res.status === 500, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,160)}`);
    expect(res.status).toBe(500);
    record("demote 500 body carries DSC_ROLE_PERSIST_FAILED", res.body?.error === "DSC_ROLE_PERSIST_FAILED", JSON.stringify(res.body)?.slice(0,160));
    expect(res.body?.error).toBe("DSC_ROLE_PERSIST_FAILED");

    // The durable role must STILL be active (not revoked).
    const after = rawDb().prepare("SELECT 1 FROM dsc_roles WHERE user_id = ? AND status = 'active'").get(target);
    record("durable dsc_roles row stays active after failed demote", !!after, JSON.stringify(after));
    expect(!!after).toBe(true);
    // The in-memory Set must still seat the role (cache not mutated on failure).
    record("role still seated in memory after failed demote", adminDsc.isDscMember(target) === true, `isDscMember=${adminDsc.isDscMember(target)}`);
    expect(adminDsc.isDscMember(target)).toBe(true);
  });

  it("E2E SUMMARY", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n=== v25_35_persistence_integrity_e2e: ${passed}/${results.length} assertions PASSED ===\n`);
    expect(passed).toBe(results.length);
  });
});
