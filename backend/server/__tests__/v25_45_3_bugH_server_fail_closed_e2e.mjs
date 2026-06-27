/* v25.45.3 Bug H — server fail-closed contract for PUT /api/founder/privacy (E2E).
 *
 * GPT-5.5 v25.45.2 DO-NOT-SHIP residual findings:
 *   1. FALSE SUCCESS: the PUT handler wrapped f13WriteUserPrivacy in try/catch,
 *      logged the error on failure, but STILL returned { ok:true } (HTTP 200).
 *      The client trusted the 200 and showed "Privacy settings saved" even when
 *      the DB write failed — a Sacred Tier 2 #27 violation ("Zero in-memory,
 *      DB-driven"; persistence failure must be visible to the caller).
 *   2. COERCION BYPASS: the defensive boolean coercion ran BEFORE the `...body`
 *      spread, so a malformed non-boolean visibleToCoMembers /
 *      visibleToCollectiveNetwork could override the coerced default and write
 *      malformed data that the GET hydration silently ignores.
 *
 * FIX (v25.45.3, server/routes.ts PUT /api/founder/privacy):
 *   1. The catch now returns HTTP 500 { ok:false, error:"PRIVACY_PERSIST_FAILED" }.
 *   2. The defensive coercion now runs AFTER the `...body` spread, so malformed
 *      inputs can never bypass the boolean coercion (unknown keys still preserved).
 *
 * TIER 6 #46: boots the REAL Express app via registerRoutes and hits the REAL
 * PUT/GET /api/founder/privacy routes. No React Query mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";

let h;
const { results, record } = recorder();

beforeAll(async () => { h = await setupFounder("bugHfc"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45.3 Bug H — server fail-closed (E2E)", () => {
  it("HAPPY PATH: a well-formed PUT persists and returns { ok:true }", async () => {
    const r = await h.req("PUT", "/api/founder/privacy", {
      userId: h.ids.FOUNDER,
      body: { screenName: "fc_user", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
    });
    const ok = r.status === 200 && r.body?.ok === true;
    record("well-formed PUT returns 200 ok:true", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("COERCION-AFTER-SPREAD: malformed non-boolean toggles are coerced, NOT written verbatim", async () => {
    // Pre-fix, `...body` overrode the coerced defaults, so these string/number
    // values could be written and then silently ignored by the GET hydration.
    // Post-fix the coercion runs LAST: visibleToCoMembers defaults true (not
    // boolean → default), visibleToCollectiveNetwork defaults false.
    const r = await h.req("PUT", "/api/founder/privacy", {
      userId: h.ids.FOUNDER,
      body: { screenName: "coerce_user", visibleToCoMembers: "yes", visibleToCollectiveNetwork: 1 },
    });
    const put200 = r.status === 200 && r.body?.ok === true;

    // The persisted row must hold real booleans, never the raw "yes" / 1.
    const row = rawDb()
      .prepare(`SELECT privacy_json FROM profilestore_user_privacy WHERE user_id = ? AND deleted_at IS NULL`)
      .get(h.ids.FOUNDER);
    const p = row?.privacy_json ? JSON.parse(row.privacy_json) : null;
    const coercedToBooleans =
      p !== null &&
      typeof p.visibleToCoMembers === "boolean" &&
      typeof p.visibleInCollectiveDirectory === "boolean" &&
      p.visibleToCoMembers === true &&            // non-boolean "yes" -> default true
      p.visibleInCollectiveDirectory === false;   // non-boolean 1 -> default false

    const ok = put200 && coercedToBooleans;
    record("malformed toggles coerced to booleans (no verbatim bypass)", ok, JSON.stringify(p));
    expect(ok).toBe(true);
  });

  it("GET reflects coerced booleans (no malformed data leaks through hydration)", async () => {
    const r = await h.req("GET", "/api/founder/privacy", { userId: h.ids.FOUNDER });
    const p = r.body?.privacy ?? {};
    const ok =
      typeof p.visibleToCoMembers === "boolean" &&
      typeof p.visibleToCollectiveNetwork === "boolean" &&
      p.visibleToCoMembers === true &&
      p.visibleToCollectiveNetwork === false;
    record("GET returns coerced booleans", ok, JSON.stringify(p));
    expect(ok).toBe(true);
  });

  it("FAIL CLOSED: when the DB write fails, the PUT returns HTTP 500 { ok:false }, NOT a false 200", async () => {
    // Force a deterministic DB write failure: replace the privacy table with a
    // schema that the INSERT cannot satisfy (an extra NOT NULL column with no
    // default). writeUserPrivacy's CREATE TABLE IF NOT EXISTS will NOT recreate
    // the existing table, so its INSERT (4 columns) violates the NOT NULL and
    // throws — exercising the catch path.
    const db = rawDb();
    db.exec(`DROP TABLE IF EXISTS profilestore_user_privacy;`);
    db.exec(`CREATE TABLE profilestore_user_privacy (
      user_id TEXT PRIMARY KEY NOT NULL,
      privacy_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      mandatory_extra_col TEXT NOT NULL
    );`);

    const r = await h.req("PUT", "/api/founder/privacy", {
      userId: h.ids.FOUNDER,
      body: { screenName: "should_not_persist", visibleToCoMembers: true, visibleToCollectiveNetwork: true },
    });

    const failedClosed = r.status === 500 && r.body?.ok === false && r.body?.error === "PRIVACY_PERSIST_FAILED";
    record("DB write failure -> HTTP 500 { ok:false, error:PRIVACY_PERSIST_FAILED }", failedClosed, `status ${r.status} body ${JSON.stringify(r.body)}`);
    expect(failedClosed).toBe(true);
  });

  it("FAIL CLOSED is real: the failed write did NOT persist a row (no silent partial write)", () => {
    const db = rawDb();
    const row = db
      .prepare(`SELECT user_id FROM profilestore_user_privacy WHERE user_id = ?`)
      .get(h.ids.FOUNDER);
    const ok = row === undefined; // nothing was written
    record("no row persisted after failed write", ok, JSON.stringify(row ?? null));
    expect(ok).toBe(true);

    // Restore the canonical table so we don't poison sibling tests in the fork.
    db.exec(`DROP TABLE IF EXISTS profilestore_user_privacy;`);
    db.exec(`CREATE TABLE IF NOT EXISTS profilestore_user_privacy (
      user_id TEXT PRIMARY KEY NOT NULL,
      privacy_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );`);
  });

  it("RECOVERS: after the table is restored, a normal PUT persists again (ok:true)", async () => {
    const r = await h.req("PUT", "/api/founder/privacy", {
      userId: h.ids.FOUNDER,
      body: { screenName: "recovered_user", visibleToCoMembers: false, visibleToCollectiveNetwork: true },
    });
    const row = rawDb()
      .prepare(`SELECT privacy_json FROM profilestore_user_privacy WHERE user_id = ? AND deleted_at IS NULL`)
      .get(h.ids.FOUNDER);
    const p = row?.privacy_json ? JSON.parse(row.privacy_json) : null;
    const ok = r.status === 200 && r.body?.ok === true && p?.screenName === "recovered_user" && p?.visibleToCoMembers === false;
    record("post-recovery PUT persists again", ok, JSON.stringify(p));
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45.3 Bug H server fail-closed E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
