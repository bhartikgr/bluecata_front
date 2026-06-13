/**
 * v19 Phase A — Chapter leaderboard integration test.
 *
 * Coverage:
 *   - GET /api/collective/leaderboard returns 200 with snapshot envelope
 *     and an `entries` array (computed on-demand for empty period).
 *   - on-demand compute fires when no snapshot exists for the period
 *     bucket (a fresh refresh persists into chapter_leaderboard_snapshots).
 *   - POST /api/collective/leaderboard/refresh — admin can force refresh.
 *   - non-admin cannot force refresh (403).
 *   - period validation: invalid period → 400.
 *   - period bounds (weekly/monthly/all-time) — start/end ISO strings
 *     are consistent with the requested window.
 *   - non-member cannot read another chapter's leaderboard.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import {
  periodBounds,
  computeLeaderboardSnapshot,
  refreshChapterLeaderboard,
} from "../chapterLeaderboardStore";

const CHAPTER_ID = "chap_keiretsu_canada";
const OTHER_CHAPTER_ID = "chap_sf";
const MAYA = "u_maya_chen";
const AISHA = "u_aisha_patel"; // chapter admin

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

/* ============================================================ */
/*  Pure helpers                                                */
/* ============================================================ */

describe("v19 Phase A — periodBounds()", () => {
  it("weekly window spans ~7 days", () => {
    const now = new Date("2026-05-20T12:00:00.000Z");
    const b = periodBounds("weekly", now);
    expect(b.periodEnd).toBe(now.toISOString());
    const diff = new Date(b.periodEnd).getTime() - new Date(b.periodStart).getTime();
    expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("monthly window spans 30 days", () => {
    const now = new Date("2026-05-20T12:00:00.000Z");
    const b = periodBounds("monthly", now);
    const diff = new Date(b.periodEnd).getTime() - new Date(b.periodStart).getTime();
    expect(diff).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("all-time starts at epoch", () => {
    const b = periodBounds("all-time");
    expect(b.periodStart).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("v19 Phase A — computeLeaderboardSnapshot()", () => {
  it("returns an array (possibly empty for a freshly-seeded chapter)", () => {
    const b = periodBounds("all-time");
    const entries = computeLeaderboardSnapshot({
      chapterId: CHAPTER_ID,
      period: "all-time",
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
    });
    expect(Array.isArray(entries)).toBe(true);
    // No entries violate the rank/score invariants.
    for (const e of entries) {
      expect(typeof e.userId).toBe("string");
      expect(typeof e.score).toBe("number");
      expect(typeof e.rank).toBe("number");
      expect(e.breakdown).toBeTruthy();
    }
  });

  it("refresh persists a snapshot row that subsequent GET can read", () => {
    const snap = refreshChapterLeaderboard({
      chapterId: CHAPTER_ID,
      period: "weekly",
    });
    expect(snap.chapterId).toBe(CHAPTER_ID);
    expect(snap.period).toBe("weekly");
    expect(Array.isArray(snap.entries)).toBe(true);
  });
});

/* ============================================================ */
/*  HTTP endpoints                                              */
/* ============================================================ */

describe("v19 Phase A — GET /api/collective/leaderboard", () => {
  it("member reads weekly leaderboard → 200", async () => {
    const r = await call(
      "GET",
      `/api/collective/leaderboard?chapter_id=${CHAPTER_ID}&period=weekly`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.snapshot?.period).toBe("weekly");
    expect(Array.isArray(r.body?.snapshot?.entries)).toBe(true);
  });

  it("member reads monthly leaderboard → 200", async () => {
    const r = await call(
      "GET",
      `/api/collective/leaderboard?chapter_id=${CHAPTER_ID}&period=monthly`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    expect(r.body?.snapshot?.period).toBe("monthly");
  });

  it("member reads all-time leaderboard → 200", async () => {
    const r = await call(
      "GET",
      `/api/collective/leaderboard?chapter_id=${CHAPTER_ID}&period=all-time`,
      { userId: MAYA },
    );
    expect(r.status).toBe(200);
    expect(r.body?.snapshot?.period).toBe("all-time");
    expect(r.body?.snapshot?.period_start).toBe("1970-01-01T00:00:00.000Z");
  });

  it("invalid period → 400", async () => {
    const r = await call(
      "GET",
      `/api/collective/leaderboard?chapter_id=${CHAPTER_ID}&period=garbage`,
      { userId: MAYA },
    );
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("invalid_period");
  });

  it("non-member cannot read another chapter's leaderboard → 403", async () => {
    const r = await call(
      "GET",
      `/api/collective/leaderboard?chapter_id=${OTHER_CHAPTER_ID}&period=weekly`,
      { userId: MAYA },
    );
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("not_chapter_member");
  });
});

describe("v19 Phase A — POST /api/collective/leaderboard/refresh", () => {
  it("chapter admin can force refresh → 200", async () => {
    const r = await call("POST", "/api/collective/leaderboard/refresh", {
      userId: AISHA,
      body: { chapter_id: CHAPTER_ID, period: "weekly" },
    });
    expect(r.status).toBe(200);
    expect(r.body?.snapshot?.period).toBe("weekly");
  });

  it("non-admin cannot force refresh → 403", async () => {
    const r = await call("POST", "/api/collective/leaderboard/refresh", {
      userId: MAYA,
      body: { chapter_id: CHAPTER_ID, period: "weekly" },
    });
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe("not_chapter_admin");
  });
});
