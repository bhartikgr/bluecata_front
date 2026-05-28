/**
 * v18 Phase A — ICS smoke test (lives in __tests__ alongside the suites).
 *
 * Required by the build brief: a GET /:id/ics response must
 *   - start with "BEGIN:VCALENDAR\r\n"
 *   - end with "END:VCALENDAR\r\n"
 *   - contain exactly one VEVENT block
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
const AISHA = "u_aisha_patel";
const MAYA = "u_maya_chen";
const COMPANY_MAYA = "co_novapay";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  for (const uid of [MAYA, AISHA]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
  }
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }),
  );
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function req(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; text: string; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body, text: buf, headers: res.headers });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("v18 Phase A — ICS smoke", () => {
  it("ICS response shape matches the brief", async () => {
    const seed = await req("POST", "/api/collective/screening-events", {
      userId: AISHA,
      body: {
        title: "Smoke test event",
        scheduled_for: Math.floor(Date.now() / 1000) + 7200,
        company_id: COMPANY_MAYA,
        chapter_id: CHAPTER_ID,
        attendee_user_ids: [MAYA],
      },
    });
    expect(seed.status).toBe(201);
    const id = seed.body.event.id;

    const r = await req("GET", `/api/collective/screening-events/${id}/ics`, {
      userId: MAYA,
    });
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/^text\/calendar;\s*charset=utf-8/);
    expect(r.text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(r.text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect((r.text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect((r.text.match(/END:VEVENT/g) ?? []).length).toBe(1);
  });
});
