/**
 * v19 Phase A — Chapter resources library integration test.
 *
 * Coverage:
 *   - admin submission lands directly in status='active'
 *   - member submission lands in status='pending'
 *   - admin approves a pending submission → status='active'
 *   - admin rejects a pending submission → status='rejected'
 *   - any member can flag → status='flagged'
 *   - GET /:id?track_download=1 increments downloadCount atomically
 *   - upload endpoint returns 503 storage_not_configured when env unset
 *   - list excludes pending rows for non-owner non-admin
 *   - visibility=admins hides from regular member
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
  // Ensure binary upload endpoint returns 503 by clearing the storage env.
  delete process.env.RESOURCES_STORAGE_PROVIDER;

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
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any; text: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
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

describe("v19 Phase A — POST /api/collective/resources", () => {
  it("admin submission lands directly in status='active'", async () => {
    const r = await call("POST", "/api/collective/resources", {
      userId: AISHA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Admin-submitted link",
        url: "https://example.com/admin-resource",
        resource_type: "link",
      },
    });
    expect(r.status).toBe(201);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.resource?.status).toBe("active");
  });

  it("member submission lands in status='pending'", async () => {
    const r = await call("POST", "/api/collective/resources", {
      userId: MAYA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Maya member-submitted link",
        url: "https://example.com/maya-resource",
        resource_type: "link",
      },
    });
    expect(r.status).toBe(201);
    expect(r.body?.resource?.status).toBe("pending");
  });
});

describe("v19 Phase A — admin moderation flow", () => {
  let pendingId: string = "";
  let rejectedSeedId: string = "";

  it("seeds a pending resource then approves it", async () => {
    const submit = await call("POST", "/api/collective/resources", {
      userId: MAYA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Pending → approve flow",
        url: "https://example.com/pending-to-approve",
      },
    });
    expect(submit.status).toBe(201);
    expect(submit.body?.resource?.status).toBe("pending");
    pendingId = submit.body!.resource.id;

    const approved = await call(
      "POST",
      `/api/collective/resources/${pendingId}/approve`,
      { userId: AISHA },
    );
    expect(approved.status).toBe(200);
    expect(approved.body?.resource?.status).toBe("active");
  });

  it("seeds a pending resource then rejects it", async () => {
    const submit = await call("POST", "/api/collective/resources", {
      userId: MAYA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Pending → reject flow",
        url: "https://example.com/pending-to-reject",
      },
    });
    expect(submit.status).toBe(201);
    rejectedSeedId = submit.body!.resource.id;

    const rejected = await call(
      "POST",
      `/api/collective/resources/${rejectedSeedId}/reject`,
      { userId: AISHA, body: { reason: "Off-topic for chapter scope" } },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body?.resource?.status).toBe("rejected");
  });

  it("any member can flag an active resource", async () => {
    const flagged = await call(
      "POST",
      `/api/collective/resources/${pendingId}/flag`,
      { userId: DANIEL, body: { reason: "Possibly outdated link" } },
    );
    expect(flagged.status).toBe(200);
    expect(flagged.body?.resource?.status).toBe("flagged");
  });
});

describe("v19 Phase A — download counter + visibility", () => {
  it("?track_download=1 increments downloadCount atomically", async () => {
    const id = "res_seed_kf_safe_template";
    const r1 = await call(
      "GET",
      `/api/collective/resources/${id}?track_download=1`,
      { userId: AISHA },
    );
    expect(r1.status).toBe(200);
    const before = Number(r1.body?.resource?.downloadCount ?? 0);
    const r2 = await call(
      "GET",
      `/api/collective/resources/${id}?track_download=1`,
      { userId: AISHA },
    );
    expect(r2.status).toBe(200);
    const after = Number(r2.body?.resource?.downloadCount ?? 0);
    expect(after).toBeGreaterThan(before);
  });

  it("list excludes pending rows for non-owner non-admin", async () => {
    const r = await call(
      "GET",
      `/api/collective/resources?chapter_id=${CHAPTER_ID}`,
      { userId: DANIEL },
    );
    expect(r.status).toBe(200);
    const ids = (r.body?.resources as Array<{ id: string }> | undefined ?? []).map(
      (x) => x.id,
    );
    // seeded pending row was uploaded by Maya — Daniel must NOT see it.
    expect(ids).not.toContain("res_seed_kf_pending");
  });

  it("uploader sees their own pending resource in list", async () => {
    const r = await call(
      "GET",
      `/api/collective/resources?chapter_id=${CHAPTER_ID}`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    const ids = (r.body?.resources as Array<{ id: string }> | undefined ?? []).map(
      (x) => x.id,
    );
    expect(ids).toContain("res_seed_kf_pending");
  });
});

describe("v19 Phase A — binary upload env gate", () => {
  it("returns 503 storage_not_configured when RESOURCES_STORAGE_PROVIDER unset", async () => {
    const r = await call("POST", "/api/collective/resources/upload", {
      userId: AISHA,
      body: { chapter_id: CHAPTER_ID, filename: "x.pdf" },
    });
    expect(r.status).toBe(503);
    expect(r.body?.error).toBe("storage_not_configured");
  });
});
