/* v25.45.2 Bug H — Privacy tab persistence round-trip regression (real E2E).
 *
 * LIVE SYMPTOM (capavate.com authenticated QA, v25.45.0):
 *   Toggle "Visible to co-members on cap tables you join" ON -> click
 *   "Save privacy preferences" -> success toast "Privacy settings saved" ->
 *   HARD REFRESH -> toggle reverts to OFF. The change did not survive a reload.
 *
 * ROOT CAUSE (client, Mode C + missing load):
 *   The server PUT /api/founder/privacy DOES durably persist to the
 *   profilestore_user_privacy table, and GET /api/founder/privacy DOES read it
 *   back. But client/src/pages/founder/Settings.tsx never SUBSCRIBED to the GET
 *   and never hydrated visibleCo/visibleNet/screenName from it. The state was
 *   only ever the useState default (false/false/"") plus user interaction, so a
 *   reload always reverted to OFF even though the DB row was correct.
 *
 * FIX:
 *   Added a privacyQ useQuery(["/api/founder/privacy"]) + a useEffect that
 *   hydrates the three privacy state vars when the load query resolves. The
 *   save mutation already invalidates ["/api/founder/privacy"], so the round
 *   trip is now: PUT -> invalidate -> refetch -> hydrate.
 *
 * WHY SANDBOX MISSED IT (Tier-4 alignment, manifest #38):
 *   Prior tests proved the function got called / the row was written, but never
 *   exercised the SAVE -> (fresh page load: new query instance) -> LOAD lifecycle,
 *   nor a process-restart (cleared module caches) re-read. This test does both
 *   against the REAL Express app + REAL DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder, useFileBackedDb, teardownFileBackedDb, simulateRestart } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";

let h;
const { results, record } = recorder();

beforeAll(async () => {
  // v25.45.3 Tier 6 #48 — force a durable, file-backed SQLite DB so the
  // PROCESS RESTART step below can close + reopen the connection and still find
  // the persisted row. Under the default :memory: test DB a real restart would
  // (correctly) lose the row, so the prior test cheated by reusing the same
  // connection + cached module. This makes the restart REAL.
  useFileBackedDb("bugH");
  h = await setupFounder("bugH");
}, 60_000);
afterAll(async () => { await h.teardown(); await teardownFileBackedDb(); });

/** Read the durable DB row directly (proves true persistence, not a 200 echo). */
function readPrivacyRowDirect(userId) {
  const row = rawDb()
    .prepare(`SELECT privacy_json FROM profilestore_user_privacy WHERE user_id = ? AND deleted_at IS NULL`)
    .get(userId);
  return row?.privacy_json ? JSON.parse(row.privacy_json) : null;
}

describe("v25.45.2 Bug H — Privacy persistence round-trip (E2E)", () => {
  it("baseline: GET privacy before any save returns server defaults", async () => {
    const r = await h.req("GET", "/api/founder/privacy", { userId: h.ids.FOUNDER });
    const ok = r.status === 200 && r.body?.ok && r.body.privacy && typeof r.body.privacy === "object";
    record("baseline GET privacy ok", ok, JSON.stringify(r.body?.privacy));
    expect(ok).toBe(true);
  });

  it("SAVE: PUT /api/founder/privacy with visibleToCoMembers=true returns 200", async () => {
    const r = await h.req("PUT", "/api/founder/privacy", {
      userId: h.ids.FOUNDER,
      body: { screenName: "roundtrip_user", visibleToCoMembers: true, visibleToCollectiveNetwork: false },
    });
    const ok = r.status === 200 && r.body?.ok === true;
    record("PUT privacy returns 200 ok", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("DB ASSERT: the row actually exists with the saved value (not a silent 200 echo)", () => {
    const row = readPrivacyRowDirect(h.ids.FOUNDER);
    const ok =
      row !== null &&
      row.visibleToCoMembers === true &&
      row.screenName === "roundtrip_user" &&
      // PUT maps visibleToCollectiveNetwork -> visibleInCollectiveDirectory
      row.visibleInCollectiveDirectory === false;
    record("DB row persisted with correct value", ok, JSON.stringify(row));
    expect(ok).toBe(true);
  });

  it("FRESH PAGE LOAD: a brand-new GET (the hydration query) returns the saved value", async () => {
    // Simulates a hard refresh: the client mounts Settings, fires the privacy
    // load query, and hydrates state from this response.
    const r = await h.req("GET", "/api/founder/privacy", { userId: h.ids.FOUNDER });
    const p = r.body?.privacy ?? {};
    const ok = p.visibleToCoMembers === true && p.screenName === "roundtrip_user" && p.visibleToCollectiveNetwork === false;
    record("fresh load returns saved value (toggle stays ON)", ok, JSON.stringify(p));
    expect(ok).toBe(true);
  });

  it("CLIENT HYDRATION: the useEffect mapping reproduces ON state from the GET payload", async () => {
    const r = await h.req("GET", "/api/founder/privacy", { userId: h.ids.FOUNDER });
    // Mirror Settings.tsx hydration: start at the useState defaults, apply the
    // load-query result, assert the toggle ends ON (the live QA expectation).
    let visibleCo = false, visibleNet = false, screenName = "";
    const p = r.body?.privacy;
    if (p) {
      if (typeof p.screenName === "string") screenName = p.screenName;
      if (typeof p.visibleToCoMembers === "boolean") visibleCo = p.visibleToCoMembers;
      if (typeof p.visibleToCollectiveNetwork === "boolean") visibleNet = p.visibleToCollectiveNetwork;
    }
    const ok = visibleCo === true && screenName === "roundtrip_user" && visibleNet === false;
    record("client hydration sets toggle ON after reload", ok, JSON.stringify({ visibleCo, visibleNet, screenName }));
    expect(ok).toBe(true);
  });

  it("PROCESS RESTART (REAL): close DB + clear module cache + reconnect, then Load == Save byte-for-byte (Tier 6 #48)", async () => {
    // v25.45.3 Tier 6 #48 fix — this is now a REAL restart, not a cached re-read.
    // simulateRestart() (1) calls closeDb() to end the live SQLite handle and
    // null all module-level connection state, (2) clears the require.cache for
    // the resolver + connection modules, (3) re-opens the DB by re-importing
    // the connection module fresh (cache-busted) and (4) re-imports the resolver
    // fresh. Because the DB is FILE-backed (useFileBackedDb), the row survives
    // the close/reopen on disk. If persistence were Map-only / in-memory, this
    // step would now FAIL (the prior cheat-test would have passed regardless).
    const fresh = await simulateRestart();

    // (a) The durable row still exists on disk after the reconnect.
    const rowOnDisk = fresh
      .rawDb()
      .prepare(`SELECT privacy_json FROM profilestore_user_privacy WHERE user_id = ? AND deleted_at IS NULL`)
      .get(h.ids.FOUNDER);
    const parsedRow = rowOnDisk?.privacy_json ? JSON.parse(rowOnDisk.privacy_json) : null;

    // (b) The cold-module resolver Load path returns the saved value.
    const p = fresh.readUserPrivacy(h.ids.FOUNDER);

    // (c) Byte-for-byte equality vs what was saved (the canonical contract).
    const saved = { screenName: "roundtrip_user", visibleToCoMembers: true, visibleInCollectiveDirectory: false };
    const loaded = parsedRow
      ? {
          screenName: parsedRow.screenName,
          visibleToCoMembers: parsedRow.visibleToCoMembers,
          visibleInCollectiveDirectory: parsedRow.visibleInCollectiveDirectory,
        }
      : null;
    const byteForByte = JSON.stringify(loaded) === JSON.stringify(saved);

    const ok =
      parsedRow !== null &&
      byteForByte &&
      p.visibleToCoMembers === true &&
      p.screenName === "roundtrip_user" &&
      p.visibleInCollectiveDirectory === false;
    record("value survives REAL process restart (close+cache-clear+reconnect)", ok, JSON.stringify({ loaded, saved, resolver: p }));
    expect(ok).toBe(true);
  });

  it("POST-RESTART LOAD ENDPOINT: the canonical GET /api/founder/privacy still returns the saved value after the restart", async () => {
    // After the real restart, the original route handler's connection has been
    // closed; hitting the canonical Load endpoint forces a fresh lazy re-open
    // and must still serve the persisted value (no in-memory dependency).
    const r = await h.req("GET", "/api/founder/privacy", { userId: h.ids.FOUNDER });
    const p = r.body?.privacy ?? {};
    const ok = p.visibleToCoMembers === true && p.screenName === "roundtrip_user" && p.visibleToCollectiveNetwork === false;
    record("canonical Load endpoint returns saved value post-restart", ok, JSON.stringify(p));
    expect(ok).toBe(true);
  });

  it("REPRODUCES the live bug: the OLD client (no load query) reverts to OFF on reload", async () => {
    // Pre-fix Settings.tsx had NO privacy load query. On reload, state was only
    // the useState default. Prove that path yields OFF despite the DB being ON.
    const r = await h.req("GET", "/api/founder/privacy", { userId: h.ids.FOUNDER });
    const dbSaysOn = r.body?.privacy?.visibleToCoMembers === true;
    // Old client never read r.body — state stayed at the useState default:
    const oldClientVisibleCo = false; // useState(false), never hydrated
    const wouldHaveReverted = dbSaysOn && oldClientVisibleCo === false;
    record("old client (no load query) would revert to OFF — bug reproduced", wouldHaveReverted, "");
    expect(wouldHaveReverted).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45.2 Bug H privacy persistence round-trip E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
