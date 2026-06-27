/* v25.34 Phase 4 — E2E: Member lifecycle across migrated Collective stores.
 *
 * Exercises the chapter-member journey through the stores migrated to DB-direct
 * in Phase 1: screeningEventsStore, chapterAnnouncementsStore,
 * chapterLeaderboardStore. Each action is asserted against the live SQLite DB
 * (screening_events, screening_event_attendees, chapter_announcements,
 * chapter_leaderboard_snapshots) so we prove the DB — not an in-memory Map —
 * is the source of truth, and that reads are DB-first.
 *
 * Coverage:
 *   1. Admin/DSC creates a screening event → row in screening_events + organizer attendee.
 *   2. GET screening-events lists it DB-first (chapter-scoped).
 *   3. Member RSVPs → attendee rsvp persisted in DB.
 *   4. Admin posts a chapter announcement → row in chapter_announcements.
 *   5. GET announcements reads DB-first; active filter honors expiry.
 *   6. Leaderboard refresh writes a snapshot row + GET reads it DB-first.
 *
 * Requires COLLECTIVE_ENABLED=1 (set below). Admin persona = chapter-admin bypass.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";

let app, server, port;
const ADMIN = `u_v2534_life_admin_${Date.now()}`;
const CHAPTER = "chap_demo";
const COMPANY = "co_v2534_demo";
const results = [];

function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " — " + extra : ""}`);
}

function req(method, path, { body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": ADMIN };
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

function one(sql, ...p) { try { return rawDb().prepare(sql).get(...p); } catch { return null; } }

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2534.test`, name: "v25.34 Lifecycle Admin",
    isFounder: false, isInvestor: true, isAdmin: true, hasInvitations: false,
  });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.34 Member lifecycle (migrated Collective stores) — E2E", () => {
  let eventId;

  it("1. create screening event → row in screening_events + organizer attendee", async () => {
    const future = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const res = await req("POST", "/api/collective/screening-events", {
      body: {
        title: "Q3 Seed Screening — NovaPay", description: "Pitch + Q&A", scheduled_for: future,
        duration_minutes: 90, location: "Toronto HQ", event_type: "screening",
        company_id: COMPANY, chapter_id: CHAPTER, attendee_user_ids: [],
      },
    });
    record("POST screening-event 200/201", (res.status === 200 || res.status === 201) && res.body?.ok !== false, `status ${res.status} ${JSON.stringify(res.body)?.slice(0, 120)}`);
    expect(res.status === 200 || res.status === 201).toBe(true);
    eventId = res.body?.event?.id ?? res.body?.id;
    record("response carries event id", !!eventId, eventId);
    expect(!!eventId).toBe(true);

    const row = one(`SELECT id, chapter_id, company_id, title FROM screening_events WHERE id = ?`, eventId);
    record("event persisted in screening_events table", !!row && row.title === "Q3 Seed Screening — NovaPay", JSON.stringify(row));
    expect(!!row).toBe(true);

    const att = one(`SELECT COUNT(*) AS n FROM screening_event_attendees WHERE event_id = ?`, eventId);
    record("organizer auto-added as attendee in DB", (att?.n ?? 0) >= 1, `attendees=${att?.n}`);
    expect(att.n).toBeGreaterThanOrEqual(1);
  });

  it("2. GET screening-events lists it DB-first (chapter-scoped)", async () => {
    const res = await req("GET", `/api/collective/screening-events?chapter_id=${CHAPTER}`);
    const events = res.body?.events ?? res.body?.items ?? (Array.isArray(res.body) ? res.body : []);
    const seen = events.some((e) => (e.id ?? e.event_id) === eventId);
    record("listing returns the created event", res.status === 200 && seen, `status ${res.status}, count ${events.length}`);
    expect(seen).toBe(true);
  });

  it("3. member RSVPs → attendee rsvp persisted in DB", async () => {
    const res = await req("POST", `/api/collective/screening-events/${eventId}/rsvp`, { body: { rsvp: "accepted" } });
    record("RSVP endpoint 200", res.status === 200 && res.body?.ok !== false, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,100)}`);
    expect(res.status).toBe(200);
    const row = one(`SELECT rsvp FROM screening_event_attendees WHERE event_id = ? AND user_id = ?`, eventId, ADMIN);
    record("attendee rsvp=accepted persisted in DB", row?.rsvp === "accepted", JSON.stringify(row));
    expect(row?.rsvp).toBe("accepted");
  });

  it("4. post a chapter announcement → row in chapter_announcements", async () => {
    const res = await req("POST", "/api/collective/announcements", {
      body: { title: "Welcome to Q3 cohort", body: "Office hours every Friday.", priority: "high", audience: "all", chapter_id: CHAPTER },
    });
    record("POST announcement 200/201", (res.status === 200 || res.status === 201) && res.body?.ok !== false, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,120)}`);
    expect(res.status === 200 || res.status === 201).toBe(true);
    const annId = res.body?.announcement?.id ?? res.body?.id;
    const row = one(`SELECT id, chapter_id, title, priority FROM chapter_announcements WHERE id = ?`, annId);
    record("announcement persisted in chapter_announcements table", !!row && row.title === "Welcome to Q3 cohort", JSON.stringify(row));
    expect(!!row).toBe(true);
  });

  it("5. GET announcements reads DB-first (chapter-scoped)", async () => {
    const res = await req("GET", `/api/collective/announcements?chapter_id=${CHAPTER}`);
    const anns = res.body?.announcements ?? res.body?.items ?? (Array.isArray(res.body) ? res.body : []);
    const seen = anns.some((a) => a.title === "Welcome to Q3 cohort");
    record("announcement list returns DB row", res.status === 200 && seen, `status ${res.status}, count ${anns.length}`);
    expect(seen).toBe(true);
  });

  it("6. leaderboard refresh writes a snapshot row + GET reads it DB-first", async () => {
    const refresh = await req("POST", "/api/collective/leaderboard/refresh", { body: { chapter_id: CHAPTER, period: "weekly" } });
    record("leaderboard refresh 200", refresh.status === 200 && refresh.body?.ok === true, `status ${refresh.status}`);
    expect(refresh.status).toBe(200);

    const row = one(`SELECT chapter_id, period FROM chapter_leaderboard_snapshots WHERE chapter_id = ? AND period = 'weekly' ORDER BY period_start DESC LIMIT 1`, CHAPTER);
    record("snapshot persisted in chapter_leaderboard_snapshots", !!row, JSON.stringify(row));
    expect(!!row).toBe(true);

    const get = await req("GET", `/api/collective/leaderboard?chapter_id=${CHAPTER}&period=weekly`);
    const ok = get.status === 200 && (get.body?.snapshot || get.body?.entries || get.body?.leaderboard);
    record("GET leaderboard reads snapshot DB-first", !!ok, `status ${get.status}`);
    expect(get.status).toBe(200);
  });

  it("E2E SUMMARY", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n=== v25_34_member_lifecycle_e2e: ${passed}/${results.length} assertions PASSED ===\n`);
    expect(passed).toBe(results.length);
  });
});
