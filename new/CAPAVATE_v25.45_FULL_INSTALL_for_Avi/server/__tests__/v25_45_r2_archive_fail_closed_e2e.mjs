/* v25.45 ROUND 2 (BLOCKER 1) — archive check FAILS CLOSED on DB error.
 *
 * Round 1's middleware caught any lookup error and called next() (fail-OPEN),
 * which means a transient DB fault would silently open a write path on a
 * possibly-archived workspace. The round-2 helper must respond 503 (never 200,
 * never proceed) when the archive lookup throws.
 *
 * We exercise the real assertWorkspaceNotArchived helper with a fabricated
 * Express req/res. To force the lookup to throw, we temporarily rename the
 * `companies` table so getArchiveState()'s SELECT fails, then restore it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder } from "./v25_45_helpers.mjs";
import { rawDb } from "../db/connection.ts";
import { assertWorkspaceNotArchived } from "../middleware/archiveCheck.ts";

let h;
beforeAll(async () => { h = await setupFounder("r2failclosed"); }, 60_000);
afterAll(async () => { await h.teardown(); });

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

describe("v25.45 R2 — archive check fails CLOSED on DB error", () => {
  it("DB error during archive lookup → 503 (not 200, not proceed)", () => {
    const db = rawDb();
    // Break the companies table lookup so getArchiveState() throws.
    db.exec("ALTER TABLE companies RENAME TO companies__failclosed_tmp");
    let terminated;
    let res = fakeRes();
    try {
      const req = { method: "PATCH", params: {}, body: {}, query: {} };
      terminated = assertWorkspaceNotArchived(req, res, h.ids.COMPANY);
    } finally {
      // Always restore the table so teardown + other tests are unaffected.
      db.exec("ALTER TABLE companies__failclosed_tmp RENAME TO companies");
    }
    // FAIL CLOSED: the helper must have terminated the request (returned true)
    // with a 503, NOT allowed it to proceed (false / 200).
    expect(terminated).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(res.statusCode).not.toBe(200);
    expect(res.body?.error).toBe("ARCHIVE_CHECK_UNAVAILABLE");
  });

  it("GET is exempt even under DB error (read-only never blocked)", () => {
    const db = rawDb();
    db.exec("ALTER TABLE companies RENAME TO companies__failclosed_tmp2");
    let terminated;
    let res = fakeRes();
    try {
      const req = { method: "GET", params: {}, body: {}, query: {} };
      terminated = assertWorkspaceNotArchived(req, res, h.ids.COMPANY);
    } finally {
      db.exec("ALTER TABLE companies__failclosed_tmp2 RENAME TO companies");
    }
    // GET short-circuits before any lookup → proceeds (false), no response sent.
    expect(terminated).toBe(false);
    expect(res.statusCode).toBe(null);
  });
});
