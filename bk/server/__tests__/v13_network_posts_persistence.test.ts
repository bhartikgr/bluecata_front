/**
 * v13 — Avi's Issue 5: Network posts persistence.
 *
 * Avi reported: "On the Network module, when I created a new post, it
 * appears for that session, but the server is not saving the records on
 * its table."
 *
 * This test exercises networkPostsStore.persistNetworkPost and
 * hydrateNetworkPostsStore against the `network_posts` SQL table. Also
 * verifies the source-file markers for the v13 fix.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/connection";
import { networkPosts as networkPostsTable, auditLog as auditLogTable } from "../../shared/schema";
import { eq, and } from "drizzle-orm";
import {
  persistNetworkPost,
  hydrateNetworkPostsStore,
  _testAccessNetworkPosts,
} from "../networkPostsStore";

describe("v13 B-V13-5 — network posts DB persistence", () => {
  const COMPANY_ID = "co_v13posts_test";
  const TENANT_ID = `tenant_co_${COMPANY_ID}`;
  const AUTHOR_ID = "u_v13posts_author";

  beforeAll(() => {
    const db = getDb();
    try {
      db.delete(networkPostsTable).where(eq(networkPostsTable.tenantId, TENANT_ID)).run();
    } catch { /* tolerated */ }
    _testAccessNetworkPosts.reset();
  });

  it("source file carries the v13 Issue 5 markers", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "networkPostsStore.ts"),
      "utf8",
    );
    expect(src).toMatch(/Avi's Issue 5/);
    expect(src).toMatch(/persistNetworkPost/);
    expect(src).toMatch(/export async function hydrateNetworkPostsStore/);
    expect(src).toMatch(/getDb\(\)\.transaction/);

    // commsStore.ts must invoke persistNetworkPost on post create.
    const commsSrc = fs.readFileSync(
      path.join(__dirname, "..", "commsStore.ts"),
      "utf8",
    );
    expect(commsSrc).toMatch(/persistNetworkPost\(/);
    expect(commsSrc).toMatch(/restorePostFromDb/);
  });

  it("persistNetworkPost writes through to the DB and emits audit", () => {
    const id1 = "post_v13_test_1";
    const id2 = "post_v13_test_2";
    const now = new Date().toISOString();

    persistNetworkPost(
      { id: id1, authorUserId: AUTHOR_ID, body: "Hello network!", createdAt: now, visibility: "public", companyId: COMPANY_ID, mediaUrls: [], topics: ["test"] },
      AUTHOR_ID,
    );
    persistNetworkPost(
      { id: id2, authorUserId: AUTHOR_ID, body: "Round closed!", createdAt: now, visibility: "cap_table", companyId: COMPANY_ID },
      AUTHOR_ID,
    );

    const db = getDb();
    const rows = db
      .select()
      .from(networkPostsTable)
      .where(eq(networkPostsTable.tenantId, TENANT_ID))
      .all() as any[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.has(id1)).toBe(true);
    expect(ids.has(id2)).toBe(true);

    // Audit: at least two `network.post.created` entries.
    const audit = db
      .select()
      .from(auditLogTable)
      .where(and(eq(auditLogTable.tenantId, TENANT_ID), eq(auditLogTable.action, "network.post.created")))
      .all();
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("hydrateNetworkPostsStore rebuilds the cache after a simulated restart", async () => {
    _testAccessNetworkPosts.reset();
    expect(_testAccessNetworkPosts.hydratedPosts.length).toBe(0);
    await hydrateNetworkPostsStore();
    const ours = _testAccessNetworkPosts.hydratedPosts.filter(
      (p) => p.authorUserId === AUTHOR_ID,
    );
    expect(ours.length).toBeGreaterThanOrEqual(2);
  });
});
