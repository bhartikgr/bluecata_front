/* v25.45 ROUND 2 (BLOCKER 3) — GET /api/founder/reports2/:id/recipients routes
 * co-member names through the privacy resolver (externalCapTable context).
 *
 * A cap-table co-member who opted out of co-member visibility
 * (visibleToCoMembers:false) must render as "Private Investor" in the report
 * recipient picker, not their raw legal name. The email is still returned (it's
 * required for delivery routing). A member with NO privacy row keeps their name.
 *
 * We seed a cap-table position for two investors by writing membership rows into
 * the durable kv_membershipStore table and hydrating, then create a report for
 * the founder's company and read the recipients.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";
import { hydrateMembershipStore } from "../membershipStore.ts";
import { writeUserPrivacy } from "../lib/userPrivacyResolver.ts";

let h;
const STAMP = Date.now();
const INV_ANON = `u_r2rep_anon_${STAMP}`;
const INV_NAMED = `u_r2rep_named_${STAMP}`;
const NAME_ANON = `Anon Holder ${STAMP}`;
const NAME_NAMED = `Named Holder ${STAMP}`;

function seedUser(userId, name) {
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
  ).run(userId, "tenant_r2rep", `${userId}@r2rep.test`, name);
}

function seedCapTablePosition(userId, companyId, name) {
  // Write a membership row with a cap-table position into the durable kv store
  // that hydrateMembershipStore() reads, then rehydrate the in-memory index.
  const payload = {
    userId,
    isCollectiveMember: true,
    memberSince: new Date().toISOString(),
    expiresAt: null,
    lapsed: false,
    reason: "test seed",
    capTablePositions: [{ companyId, companyName: "QA Co", ownershipPct: 12.5 }],
    canApplyToCollective: true,
  };
  // Ensure the kv store table exists with the full schema (some boot paths
  // create it lazily). Add deleted_at defensively if an older-shaped table
  // exists, then insert with deleted_at NULL so the row hydrates back.
  const db = rawDb();
  db.exec(`CREATE TABLE IF NOT EXISTS kv_membershipStore (id TEXT PRIMARY KEY, payload_json TEXT, updated_at TEXT, deleted_at TEXT)`);
  const cols = db.prepare(`PRAGMA table_info(kv_membershipStore)`).all().map((c) => c.name);
  if (!cols.includes("deleted_at")) db.exec(`ALTER TABLE kv_membershipStore ADD COLUMN deleted_at TEXT`);
  db.prepare(
    `INSERT INTO kv_membershipStore (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at, deleted_at = NULL`,
  ).run(userId, JSON.stringify(payload), new Date().toISOString());
}

beforeAll(async () => {
  h = await setupFounder("r2rep");
  seedUser(INV_ANON, NAME_ANON);
  seedUser(INV_NAMED, NAME_NAMED);
  seedCapTablePosition(INV_ANON, h.ids.COMPANY, NAME_ANON);
  seedCapTablePosition(INV_NAMED, h.ids.COMPANY, NAME_NAMED);
  await hydrateMembershipStore();
  // INV_ANON opts OUT of co-member visibility; INV_NAMED has no privacy row.
  writeUserPrivacy(INV_ANON, { screenName: "", visibleToCoMembers: false, visibleInCollectiveDirectory: false });
}, 60_000);

afterAll(async () => { await h.teardown(); });

describe("v25.45 R2 — report recipients privacy resolver", () => {
  it("opted-out co-member renders as 'Private Investor' (email preserved)", async () => {
    const created = await h.req("POST", "/api/founder/reports2", {
      userId: h.ids.FOUNDER,
      body: { companyId: h.ids.COMPANY, template: "investor_update", title: "Q1 Update" },
    });
    expect(created.status).toBe(200);
    const reportId = created.body?.id;
    expect(reportId).toBeTruthy();

    const rec = await h.req("GET", `/api/founder/reports2/${reportId}/recipients`, { userId: h.ids.FOUNDER });
    expect(rec.status).toBe(200);
    const list = Array.isArray(rec.body) ? rec.body : [];
    const anon = list.find((m) => m.userId === INV_ANON);
    const named = list.find((m) => m.userId === INV_NAMED);

    expect(anon).toBeTruthy();
    expect(anon.name).toBe("Private Investor");
    expect(anon.name).not.toBe(NAME_ANON);
    // email is still present for delivery routing
    expect(typeof anon.email).toBe("string");

    // The member with no privacy row keeps a non-anonymous name.
    if (named) expect(named.name).not.toBe("Private Investor");
  });
});
