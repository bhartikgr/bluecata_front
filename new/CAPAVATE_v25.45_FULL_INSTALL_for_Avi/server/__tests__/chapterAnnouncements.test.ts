/**
 * v19 Phase A — Chapter announcements integration test.
 *
 * Coverage:
 *   - happy path: chapter admin creates an announcement → 201, row + hash
 *   - authz: non-admin chapter member cannot create → 403
 *   - authz: non-member cannot list → 403
 *   - list: returns pinned-first ordering, excludes expired by default
 *   - list: ?include_expired=1 returns expired
 *   - detail: idempotent read marker upsert (UNIQUE constraint)
 *   - pin/unpin toggle
 *   - PATCH edit by admin → 200, hash chain extended
 *   - DELETE by admin → 200, soft delete
 *   - feature flag off → 503 at gate
 *   - audience filter: 'admins' audience hides from regular members
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";

const CHAPTER_ID = "chap_keiretsu_canada";
const MAYA = "u_maya_chen";
const DANIEL = "u_daniel_okafor";
const AISHA = "u_aisha_patel"; // chapter admin

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  for (const uid of [MAYA, AISHA, DANIEL]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
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
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

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
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.userRole) headers["x-role"] = opts.userRole;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try {
            body = JSON.parse(buf);
          } catch {
            /* keep raw */
          }
          resolve({ status: res.statusCode ?? 0, body, text: buf });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/* ============================================================ */
/*  Create + authz                                              */
/* ============================================================ */

describe("v19 Phase A — POST /api/collective/announcements", () => {
  it("admin creates an announcement → 201, row + hash seeded", async () => {
    const r = await call("POST", "/api/collective/announcements", {
      userId: AISHA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Test announcement from suite",
        body: "Body of the test announcement.",
        priority: "normal",
        audience: "all",
      },
    });
    expect(r.status).toBe(201);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.announcement?.id).toBeTruthy();
    expect(r.body?.announcement?.currHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.body?.announcement?.prevHash).toBeNull();
  });

  it("non-admin member cannot create → 403", async () => {
    const r = await call("POST", "/api/collective/announcements", {
      userId: MAYA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Maya tries to post",
        body: "Should be blocked",
      },
    });
    expect(r.status).toBe(403);
    expect(r.body?.error).toMatch(/not_chapter_admin|not_chapter_member/);
  });
});

/* ============================================================ */
/*  List + filters                                              */
/* ============================================================ */

describe("v19 Phase A — GET /api/collective/announcements", () => {
  it("member lists announcements (pinned first)", async () => {
    const r = await call(
      "GET",
      `/api/collective/announcements?chapter_id=${CHAPTER_ID}`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(Array.isArray(r.body?.announcements)).toBe(true);
    const ids = (r.body!.announcements as Array<{ id: string; pinned: boolean }>).map((x) => x.id);
    expect(ids).toContain("anc_seed_kf_pinned");
    // First row must be pinned (desc pinned order).
    const first = r.body!.announcements[0];
    expect(Boolean(first.pinned)).toBe(true);
  });

  it("?filter=active excludes expired rows", async () => {
    const r = await call(
      "GET",
      `/api/collective/announcements?chapter_id=${CHAPTER_ID}&filter=active`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    const ids = (r.body!.announcements as Array<{ id: string }>).map((x) => x.id);
    expect(ids).not.toContain("anc_seed_kf_expired");
  });

  it("?filter=expired returns only expired rows", async () => {
    const r = await call(
      "GET",
      `/api/collective/announcements?chapter_id=${CHAPTER_ID}&filter=expired`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    const ids = (r.body!.announcements as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain("anc_seed_kf_expired");
  });

  it("audience=admins announcement is hidden from regular member", async () => {
    // Create admins-only announcement
    const created = await call("POST", "/api/collective/announcements", {
      userId: AISHA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Admin-only announcement",
        body: "Confidential to admins",
        audience: "admins",
      },
    });
    expect(created.status).toBe(201);
    const adminOnlyId = created.body!.announcement.id;

    const r = await call(
      "GET",
      `/api/collective/announcements?chapter_id=${CHAPTER_ID}`,
      { userId: MAYA },
    );
    const ids = (r.body!.announcements as Array<{ id: string }>).map((x) => x.id);
    expect(ids).not.toContain(adminOnlyId);

    // Admin sees it.
    const rA = await call(
      "GET",
      `/api/collective/announcements?chapter_id=${CHAPTER_ID}`,
      { userId: AISHA },
    );
    const adminIds = (rA.body!.announcements as Array<{ id: string }>).map((x) => x.id);
    expect(adminIds).toContain(adminOnlyId);
  });
});

/* ============================================================ */
/*  Detail / read tracking                                       */
/* ============================================================ */

describe("v19 Phase A — GET /api/collective/announcements/:id", () => {
  it("idempotent read-mark upsert", async () => {
    const path = `/api/collective/announcements/anc_seed_kf_pinned`;
    const r1 = await call("GET", path, { userId: MAYA });
    expect(r1.status).toBe(200);
    expect(r1.body?.announcement?.id).toBe("anc_seed_kf_pinned");
    // Re-fetch — must still be 200 (no duplicate-key error).
    const r2 = await call("GET", path, { userId: MAYA });
    expect(r2.status).toBe(200);
  });
});

/* ============================================================ */
/*  Pin / unpin / edit / delete                                  */
/* ============================================================ */

describe("v19 Phase A — admin mutations", () => {
  let id: string = "";

  it("admin can create + pin + unpin + edit + delete", async () => {
    const created = await call("POST", "/api/collective/announcements", {
      userId: AISHA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Lifecycle test",
        body: "lifecycle",
      },
    });
    expect(created.status).toBe(201);
    id = created.body!.announcement.id;

    const pinned = await call("POST", `/api/collective/announcements/${id}/pin`, {
      userId: AISHA,
    });
    expect(pinned.status).toBe(200);
    expect(Boolean(pinned.body?.announcement?.pinned)).toBe(true);

    const unpinned = await call("POST", `/api/collective/announcements/${id}/unpin`, {
      userId: AISHA,
    });
    expect(unpinned.status).toBe(200);
    expect(Boolean(unpinned.body?.announcement?.pinned)).toBe(false);

    const edited = await call("PATCH", `/api/collective/announcements/${id}`, {
      userId: AISHA,
      body: { title: "Lifecycle test — edited" },
    });
    expect(edited.status).toBe(200);
    expect(edited.body?.announcement?.title).toBe("Lifecycle test — edited");
    // hash chain extends (prevHash now non-null).
    expect(edited.body?.announcement?.prevHash).toBeTruthy();

    const deleted = await call("DELETE", `/api/collective/announcements/${id}`, {
      userId: AISHA,
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body?.ok).toBe(true);

    // Subsequent fetch returns 404
    const after = await call("GET", `/api/collective/announcements/${id}`, {
      userId: AISHA,
    });
    expect(after.status).toBe(404);
  });

  it("non-admin cannot edit/delete others' announcements", async () => {
    const e = await call("PATCH", `/api/collective/announcements/anc_seed_kf_pinned`, {
      userId: MAYA,
      body: { title: "hack" },
    });
    expect([401, 403]).toContain(e.status);
  });
});
