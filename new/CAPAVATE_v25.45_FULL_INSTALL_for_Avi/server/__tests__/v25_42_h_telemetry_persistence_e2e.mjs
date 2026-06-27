/* v25.42h Housekeeping — E2E: sprint10Telemetry is DB-backed and survives a
 * connection restart.
 *
 * BEFORE: server/sprint10Telemetry.ts buffered envelopes in a module-level
 * `const events: SyncEnvelope<unknown>[] = []` (preview-only; lost on restart;
 * the header described production as "replaced by the outbox table -> webhook
 * relay").
 *
 * AFTER (v25.42h): emitSync() INSERTs into the durable `telemetry_events`
 * table (created idempotently by applyV2542HTelemetryEventsSchema in
 * server/db/connection.ts). getRecentEvents() / findEventsByType() read it via
 * `SELECT ... ORDER BY occurred_at DESC LIMIT ?`.
 *
 * This test boots against a FILE-backed SQLite DB (so a connection close/reopen
 * is a genuine "restart"), emits an event, then closes and re-opens the DB
 * connection mid-test and asserts the SELECT still returns the prior INSERT.
 * It also asserts emitSync writes a parallel forensic row to audit_log.
 *
 * Contract pinned here:
 *   - emitSync() persists a row to telemetry_events
 *   - getRecentEvents() returns it
 *   - after closeDb() + getDb() (simulated restart) the row STILL returns
 *   - findEventsByType() filters by event_type
 *   - emitSync ALSO writes a matching audit_log row (brief req #4)
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Snapshot the env we are about to mutate so afterAll can restore it. The e2e
// vitest config runs all .mjs files in a SINGLE fork, so leaking NODE_ENV /
// DATABASE_URL / a stray open connection would poison sibling suites.
const _PRIOR_NODE_ENV = process.env.NODE_ENV;
const _PRIOR_DATABASE_URL = process.env.DATABASE_URL;

// We use a FILE-backed SQLite DB so a connection close/reopen is a genuine
// "restart" (a :memory: DB cannot survive that). DATABASE_URL=file:<path> takes
// precedence over the NODE_ENV=test :memory: branch in connection.ts getDb().
// IMPORTANT: we do NOT mutate process.env at module top-level (that would run
// at collection time and poison sibling .mjs suites in the shared fork). All
// env mutation + connection setup happens inside beforeAll, and is fully
// reverted in afterAll.
const TMP_DIR = mkdtempSync(join(tmpdir(), "v2542h_telemetry_"));
const DB_FILE = join(TMP_DIR, "telemetry_persist.db");

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { emitSync, getRecentEvents, findEventsByType, clearEvents } from "../sprint10Telemetry.ts";
import { getDb, rawDb, closeDb, resetDbForTests, getDbDriver } from "../db/connection.ts";

const STAMP = Date.now();
const EVENT_TYPE = `v2542h.telemetry.persist_${STAMP}`;
const AGG_ID = `co_v2542h_${STAMP}`;
const TENANT = `tnt_v2542h_${STAMP}`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

let emittedEventId;

beforeAll(() => {
  // Discard any connection a prior import / setup file may have opened as
  // :memory: (vitest pins NODE_ENV=test) so our file-backed DATABASE_URL wins.
  resetDbForTests();
  process.env.NODE_ENV = "";
  process.env.DATABASE_URL = `file:${DB_FILE}`;
  // Establish the connection + run inline migrations (creates telemetry_events).
  getDb();
  // eslint-disable-next-line no-console
  console.log(`  [info] db driver=${getDbDriver()} file=${DB_FILE}`);
  clearEvents();
});

afterAll(async () => {
  // Restore the env + DB connection so sibling .mjs suites (same fork) get the
  // standard NODE_ENV=test :memory: behavior back.
  await closeDb();
  resetDbForTests();
  if (_PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = _PRIOR_NODE_ENV;
  if (_PRIOR_DATABASE_URL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = _PRIOR_DATABASE_URL;
});

describe("v25.42h telemetry_events DB persistence — E2E", () => {
  it("0. the telemetry_events table exists with the documented columns", () => {
    const cols = rawDb().prepare(`PRAGMA table_info(telemetry_events)`).all().map((r) => r.name);
    const required = ["id", "tenant_id", "event_type", "aggregate_id", "aggregate_kind", "occurred_at", "actor_user_id", "actor_ip", "payload_json", "schema_version", "created_at"];
    const allPresent = required.every((c) => cols.includes(c));
    record("telemetry_events schema present", allPresent, cols.join(","));
    expect(allPresent).toBe(true);
  });

  it("1. emitSync() persists a row to telemetry_events", () => {
    const env = emitSync({
      eventType: EVENT_TYPE,
      aggregateId: AGG_ID,
      aggregateKind: "company",
      payload: { probe: STAMP, n: 7 },
      tenantId: TENANT,
      actorUserId: "u_v2542h_probe",
    });
    emittedEventId = env.eventId;
    const row = rawDb().prepare(`SELECT * FROM telemetry_events WHERE id = ?`).get(env.eventId);
    record("INSERT landed in telemetry_events", !!row, `id ${env.eventId}`);
    expect(!!row).toBe(true);
    record("persisted event_type matches", row?.event_type === EVENT_TYPE, row?.event_type);
    expect(row?.event_type).toBe(EVENT_TYPE);
    record("persisted tenant_id matches", row?.tenant_id === TENANT, row?.tenant_id);
    expect(row?.tenant_id).toBe(TENANT);
  });

  it("2. getRecentEvents() returns the freshly-emitted event", () => {
    const recent = getRecentEvents(50);
    const found = recent.find((e) => e.eventId === emittedEventId);
    record("getRecentEvents returns the probe", !!found, `count ${recent.length}`);
    expect(!!found).toBe(true);
    record("payload round-trips", found?.payload?.n === 7, JSON.stringify(found?.payload));
    expect(found?.payload?.n).toBe(7);
  });

  it("3. the event SURVIVES a connection restart (closeDb + getDb)", async () => {
    // Simulate a server restart: tear the connection down completely, then
    // re-open it. With a file-backed DB the prior INSERT must still be there.
    await closeDb();
    process.env.NODE_ENV = "";
    process.env.DATABASE_URL = `file:${DB_FILE}`;
    getDb(); // re-opens the SAME file, re-runs idempotent migrations
    const row = rawDb().prepare(`SELECT id, event_type FROM telemetry_events WHERE id = ?`).get(emittedEventId);
    record("row present after restart", !!row, `id ${emittedEventId}`);
    expect(!!row).toBe(true);
    const recent = getRecentEvents(50);
    const found = recent.find((e) => e.eventId === emittedEventId);
    record("getRecentEvents returns it post-restart", !!found, `count ${recent.length}`);
    expect(!!found).toBe(true);
  });

  it("4. findEventsByType() filters by event_type", () => {
    const evts = findEventsByType(EVENT_TYPE);
    record("findEventsByType returns >=1", evts.length >= 1, `len ${evts.length}`);
    expect(evts.length).toBeGreaterThanOrEqual(1);
    const allMatch = evts.every((e) => e.eventType === EVENT_TYPE);
    record("all returned rows match the type", allMatch, `len ${evts.length}`);
    expect(allMatch).toBe(true);
  });

  it("5. emitSync ALSO wrote a parallel audit_log row (brief req #4)", () => {
    // The write-through uses action `telemetry.<eventType>` and target
    // `<aggregateKind>:<aggregateId>`.
    const row = rawDb()
      .prepare(`SELECT id, action, target FROM audit_log WHERE action = ? AND target = ? LIMIT 1`)
      .get(`telemetry.${EVENT_TYPE}`, `company:${AGG_ID}`);
    record("audit_log write-through present", !!row, row ? `action ${row.action}` : "missing");
    expect(!!row).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42h telemetry persistence E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
