/* v25.34 Phase 4 — E2E: NEW Collective Payment Model (end-to-end).
 *
 * Drives the real Express app (registerRoutes) over a real HTTP socket against
 * the live-server SQLite path (`:memory:` under NODE_ENV=test, but the SAME
 * connection.ts / applyV2534CollectiveSchema() code path the prod VPS runs).
 * Every assertion prints PASS/FAIL and is also enforced by vitest expect() so
 * `npx vitest run server/__tests__/v25_34_collective_payment_e2e.mjs` is green.
 *
 * Coverage (admin CRUD + member self-service + DB ledger state):
 *   1. Seeded $0 platform defaults exist for all 5 fee kinds.
 *   2. Admin creates a tier-default + member-override schedule → 3-level precedence.
 *   3. Member quote endpoint resolves via the correct precedence level.
 *   4. Admin creates a ledger entry (pending) → member sees it on their ledger.
 *   5. Admin marks the entry paid → status transition persisted in DB.
 *   6. Multi-currency P&L aggregation groups by currency (no cross-currency sum).
 *   7. Quote-only invariant: no collective_payment row is ever charged by quote.
 *
 * NOTHING touches Avi's payment write paths or collectiveBillingStore.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
// v25.35 fix-2 (Concern 2) — used to seed a chapter-scoped membership so the
// now chapter-aware member-tier lookup resolves the seeded billing row.
import * as membershipStore from "../collectiveMembershipStore.ts";

let app, server, port;
const ADMIN = `u_v2534_pay_admin_${Date.now()}`;
const MEMBER = `u_v2534_member_${Date.now()}`;
const results = [];

function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`);
}

function req(method, path, { userId, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (userId) headers["x-user-id"] = userId;
    const payload = body ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* leave raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

beforeAll(async () => {
  // Admin persona — admin bypass lets us hit BOTH /api/admin/* and the
  // requireCollectiveMember-gated /api/collective/me/* endpoints.
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2534.test`, name: "v25.34 Pay Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  __setRuntimePersona({
    userId: MEMBER, email: `${MEMBER}@v2534.test`, name: "v25.34 Collective Member",
    isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false,
  });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  // Seed a tier so the member self-service quote walks the tier path.
  // v25.35 fix-2 (Concern 2) — memberTierOf is now chapter-scoped and
  // fail-closes when no (user_id, chapter_id) billing row exists. Seed the
  // billing row WITH the member's chapter (matching the membership row below)
  // so the quote resolver finds the standard tier instead of 409ing.
  const PAY_CHAPTER = "chap_demo";
  try {
    rawDb().exec(`CREATE TABLE IF NOT EXISTS collective_memberships_billing (
      user_id TEXT, tier TEXT, status TEXT, created_at TEXT
    );`);
    const now = new Date().toISOString();
    // Prod-shaped insert (chapter_id-aware). Falls back to the legacy shape if
    // the table predates the chapter_id column.
    try {
      rawDb().prepare(
        `INSERT INTO collective_memberships_billing
           (id, tenant_id, chapter_id, user_id, tier, status, cancel_at_period_end, curr_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'standard', 'active', 0, ?, ?, ?)`
      ).run(`billing_${MEMBER}`, `tenant_chap_${PAY_CHAPTER}`, PAY_CHAPTER, MEMBER, `hash_${MEMBER}`, now, now);
    } catch {
      rawDb().prepare(
        `INSERT INTO collective_memberships_billing (user_id, tier, status, created_at) VALUES (?, 'standard', 'active', ?)`
      ).run(MEMBER, now);
    }
  } catch { /* table may already exist with prod shape — non-fatal */ }
  // v25.35 fix-2 (Concern 2) — seed an active membership in the SAME chapter so
  // memberChapterOf(MEMBER) resolves PAY_CHAPTER and the chapter-scoped tier
  // lookup matches the seeded billing row.
  try {
    membershipStore.activate(MEMBER, ADMIN, "standard", { chapterId: PAY_CHAPTER });
  } catch { /* non-fatal */ }

  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.34 Collective Payment Model — E2E", () => {
  it("1. seeded $0 platform defaults exist for all 5 fee kinds", () => {
    const rows = rawDb()
      .prepare(`SELECT fee_kind, amount_minor FROM collective_payment_schedules WHERE scope_kind='platform'`)
      .all();
    const kinds = new Set(rows.map((r) => r.fee_kind));
    const expected = ["membership_dues", "event_fee", "sponsorship_fee", "chapter_dues", "late_fee"];
    const allPresent = expected.every((k) => kinds.has(k));
    const allZero = rows.every((r) => r.amount_minor === 0);
    record("seeded platform defaults present (5 kinds, all $0)", allPresent && allZero, `found ${rows.length} rows`);
    expect(allPresent).toBe(true);
    expect(allZero).toBe(true);
  });

  it("2. admin creates tier-default + member-override schedules (3-level precedence)", async () => {
    // Tier default for 'standard' membership_dues = 25000 minor (CAD).
    const tierRes = await req("POST", "/api/admin/collective-payments/schedules", {
      userId: ADMIN,
      body: { scopeKind: "tier", tier: "standard", feeKind: "membership_dues", amountMinor: 25000, currency: "CAD", cadence: "annual" },
    });
    record("create tier-default schedule (standard/membership_dues=25000 CAD)", tierRes.status === 200 && tierRes.body.ok === true, `status ${tierRes.status}`);
    expect(tierRes.body.ok).toBe(true);

    // Member override for THIS member membership_dues = 10000 minor (USD) — should win.
    const memRes = await req("POST", "/api/admin/collective-payments/schedules", {
      userId: ADMIN,
      body: { scopeKind: "member", memberId: MEMBER, feeKind: "membership_dues", amountMinor: 10000, currency: "USD", cadence: "annual" },
    });
    record("create member-override schedule (member/membership_dues=10000 USD)", memRes.status === 200 && memRes.body.ok === true, `status ${memRes.status}`);
    expect(memRes.body.ok).toBe(true);

    // DB confirms both rows landed.
    const cnt = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM collective_payment_schedules WHERE fee_kind='membership_dues' AND scope_kind IN ('tier','member')`)
      .get().n;
    record("both new schedule rows persisted in DB", cnt === 2, `count=${cnt}`);
    expect(cnt).toBe(2);
  });

  it("3. member quote resolves membership_dues via member_override, event_fee via platform_default", async () => {
    const res = await req("GET", "/api/collective/me/payment-quote", { userId: MEMBER });
    record("quote endpoint 200 + quoteOnly:true", res.status === 200 && res.body.quoteOnly === true, `status ${res.status}`);
    expect(res.status).toBe(200);
    expect(res.body.quoteOnly).toBe(true);

    const lines = res.body.lines || [];
    const dues = lines.find((l) => l.feeKind === "membership_dues");
    const event = lines.find((l) => l.feeKind === "event_fee");
    const duesViaOverride = dues?.resolved?.computedVia === "member_override" && dues?.resolved?.amountMinor === 10000 && dues?.resolved?.currency === "USD";
    record("membership_dues resolves via member_override = 10000 USD", duesViaOverride, JSON.stringify(dues?.resolved));
    expect(duesViaOverride).toBe(true);

    const eventViaPlatform = event?.resolved?.computedVia === "platform_default" && event?.resolved?.amountMinor === 0;
    record("event_fee resolves via platform_default = 0", eventViaPlatform, JSON.stringify(event?.resolved));
    expect(eventViaPlatform).toBe(true);
  });

  it("4. admin creates a pending ledger entry → member sees it", async () => {
    const create = await req("POST", "/api/admin/collective-payments/entries", {
      userId: ADMIN,
      body: { memberId: MEMBER, entryKind: "membership_dues", amountMinor: 10000, currency: "USD", description: "2026 annual dues", period: "2026", computedVia: "member_override" },
    });
    record("admin creates ledger entry (pending)", create.status === 200 && !!create.body.id, `id ${create.body.id}`);
    expect(create.body.ok).toBe(true);
    const entryId = create.body.id;

    // DB row created with status='pending', amount integer minor units.
    const row = rawDb().prepare(`SELECT member_id, entry_kind, amount_minor, currency, status FROM collective_payment_entries WHERE id=?`).get(entryId);
    const rowOk = row && row.member_id === MEMBER && row.amount_minor === 10000 && row.status === "pending" && Number.isInteger(row.amount_minor);
    record("entry persisted pending, amount=10000 integer minor", !!rowOk, JSON.stringify(row));
    expect(rowOk).toBe(true);

    // Member self-service ledger reflects it.
    const mine = await req("GET", "/api/collective/me/payment-entries", { userId: MEMBER });
    const seen = (mine.body.entries || []).some((e) => e.id === entryId && e.amountMinor === 10000);
    record("member ledger shows the new entry", seen, `entries=${(mine.body.entries || []).length}`);
    expect(seen).toBe(true);

    // stash for next test
    globalThis.__v2534_entryId = entryId;
  });

  it("5. admin marks the entry paid → DB status transitions to paid + paid_at set", async () => {
    const entryId = globalThis.__v2534_entryId;
    const res = await req("POST", `/api/admin/collective-payments/pl/${entryId}/mark-paid`, { userId: ADMIN });
    record("mark-paid endpoint 200", res.status === 200 && res.body.ok === true, `status ${res.status}`);
    expect(res.body.ok).toBe(true);

    const row = rawDb().prepare(`SELECT status, paid_at FROM collective_payment_entries WHERE id=?`).get(entryId);
    const paidOk = row && row.status === "paid" && !!row.paid_at;
    record("entry status=paid and paid_at set in DB", !!paidOk, JSON.stringify(row));
    expect(paidOk).toBe(true);
  });

  it("6. multi-currency P&L groups by currency without cross-currency summing", async () => {
    // Add a CAD pending entry so two currencies coexist.
    await req("POST", "/api/admin/collective-payments/entries", {
      userId: ADMIN,
      body: { memberId: MEMBER, entryKind: "chapter_dues", amountMinor: 5000, currency: "CAD", description: "CAD chapter dues" },
    });
    const pl = await req("GET", `/api/admin/collective-payments/pl?memberId=${MEMBER}`, { userId: ADMIN });
    const bc = pl.body.byCurrency || {};
    const hasUsd = !!bc.USD && bc.USD.paid === 10000;
    const hasCad = !!bc.CAD && bc.CAD.pending === 5000;
    record("byCurrency has USD.paid=10000 and CAD.pending=5000 (no merge)", hasUsd && hasCad, JSON.stringify(bc));
    expect(hasUsd).toBe(true);
    expect(hasCad).toBe(true);
  });

  it("7. quote-only invariant — calling quote does NOT create any ledger/charge rows", async () => {
    const before = rawDb().prepare(`SELECT COUNT(*) AS n FROM collective_payment_entries`).get().n;
    await req("GET", "/api/collective/me/payment-quote", { userId: MEMBER });
    await req("GET", "/api/collective/me/payment-quote", { userId: MEMBER });
    const after = rawDb().prepare(`SELECT COUNT(*) AS n FROM collective_payment_entries`).get().n;
    record("quote endpoint created 0 ledger rows", before === after, `before=${before} after=${after}`);
    expect(after).toBe(before);
  });

  it("E2E SUMMARY", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n=== v25_34_collective_payment_e2e: ${passed}/${results.length} assertions PASSED ===\n`);
    expect(passed).toBe(results.length);
  });
});
