/* v25.45 Bug C ROUND-2 (GPT-5.5 blocker 4) — legacy invitation issue/redeem is
 * fail-closed on durable-persist failure.
 *
 * GPT-5.5 found:
 *   - Issue pushed the token into the in-memory array and returned the RAW
 *     token even when the (best-effort) DB write failed.
 *   - Redeem mutated entry.redeemed, best-effort persisted, then created a
 *     session — so a failed redemption persist could allow token reuse after
 *     restart.
 *
 * The fix:
 *   (i)  Issue: persist STRICTLY to the DB FIRST; only push to memory + return
 *        the raw token after the write confirms. On failure → 500, no token.
 *   (ii) Redeem: mark redeemed, persist STRICTLY; on failure roll back the
 *        in-memory mutation and return 500 WITHOUT creating a session.
 *
 * Injection: we wrap the raw better-sqlite3 driver's `prepare` so any INSERT
 * into the kv_legacyInvitationStore table throws, simulating a production write
 * failure. The wrapper is removed in a finally block.
 *
 * Driven end-to-end through the real HTTP issue + redeem routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import { registerRoutes } from "../routes.ts";
import { getDb, rawDb } from "../db/connection.ts";
import { rounds as roundsTable } from "../../shared/schema.ts";
import { eq } from "drizzle-orm";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { reqFactory, recorder } from "./v25_42_helpers.mjs";
import { createRound, _testAccessRounds } from "../roundsStore.ts";

const STAMP = Date.now() + "_" + Math.floor(Math.random() * 1e6);
const ADMIN = `u_bugCr2_inv_admin_${STAMP}`;
const COMPANY_ID = `co_bugCr2_inv_${STAMP}`;
const KV_TABLE = "kv_legacyInvitationStore";

let server, port, req;
const { results, record } = recorder();
let roundId = null;
let issueFailResp = null;
let issuedToken = null;
let redeemFailResp = null;

const sha256Hex = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Wrap rawDb().prepare so INSERTs into the kv table throw. Returns a restore fn.
function injectKvInsertFailure() {
  const driver = rawDb();
  const orig = driver.prepare.bind(driver);
  driver.prepare = function patched(sql) {
    if (typeof sql === "string" && new RegExp(`INSERT\\s+INTO\\s+${KV_TABLE}`, "i").test(sql)) {
      throw new Error("injected invitation persist failure (disk I/O error)");
    }
    return orig(sql);
  };
  return () => { driver.prepare = orig; };
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2545.test`, name: "BugC R2 Inv Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  // A real DB-backed round so the issue endpoint's round lookup succeeds.
  _testAccessRounds.reset();
  const db = getDb();
  try { db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run(); } catch { /* first boot */ }
  const round = createRound({ companyId: COMPANY_ID, name: "Seed", type: "seed", state: "open", targetAmount: 500_000 });
  roundId = round.id;

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  req = reqFactory(() => port, () => ADMIN);
}, 60_000);

afterAll(async () => {
  const db = getDb();
  try { db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run(); } catch { /* noop */ }
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.45 Bug C R2 — legacy invitation issue/redeem fail-closed — E2E", () => {
  // ---------- ISSUE PATH ----------
  it("1. issue with DB write forced to fail returns 500 and exposes NO token", async () => {
    const restore = injectKvInsertFailure();
    try {
      issueFailResp = await req("POST", `/api/rounds/${roundId}/invitations/issue`, {
        userId: ADMIN,
        body: { inviteeEmail: `fail_${STAMP}@v2545.test`, inviteeName: "Fail Invitee" },
      });
    } finally {
      restore();
    }
    const b = issueFailResp.body ?? {};
    const noToken = b.tokenForEmail == null && b.signupUrl == null;
    const ok = issueFailResp.status === 500 && b.error === "INVITATION_PERSIST_FAILED" && noToken;
    record("issue returns 500 with no token on persist failure", ok, `status ${issueFailResp.status} err ${b.error} token ${b.tokenForEmail}`);
    expect(ok).toBe(true);
  });

  it("2. the failed-issue error message is client-safe (no internal detail)", () => {
    const msg = String(issueFailResp?.body?.message ?? "");
    const leaks = /no such table|sqlite|disk I\/O|stack|node_modules|\.ts:|\.js:/i.test(msg);
    const ok = msg.length > 0 && !leaks;
    record("failed-issue message is safe", ok, `message="${msg}"`);
    expect(ok).toBe(true);
  });

  it("3. no durable kv row was written for the failed issue", () => {
    let row = null;
    try {
      // No way to know the inv id; assert no row references the failed email payload.
      row = rawDb().prepare(
        `SELECT id FROM ${KV_TABLE} WHERE payload_json LIKE ?`,
      ).get(`%fail_${STAMP}@v2545.test%`);
    } catch {
      row = null; // table absent ⇒ definitely nothing persisted
    }
    const ok = !row;
    record("no kv row persisted for failed issue", ok, `row ${JSON.stringify(row)}`);
    expect(ok).toBe(true);
  });

  it("4. control: a normal issue (no injection) succeeds and returns a raw token", async () => {
    const r = await req("POST", `/api/rounds/${roundId}/invitations/issue`, {
      userId: ADMIN,
      body: { inviteeEmail: `ok_${STAMP}@v2545.test`, inviteeName: "OK Invitee" },
    });
    issuedToken = r.body?.tokenForEmail;
    const ok = r.status === 200 && r.body?.ok === true && typeof issuedToken === "string" && issuedToken.length > 0;
    record("happy-path issue returns a token", ok, `status ${r.status} token? ${!!issuedToken}`);
    expect(ok).toBe(true);
  });

  it("5. the happy-path token IS durably persisted in the kv table", () => {
    const hash = sha256Hex(issuedToken);
    const row = rawDb().prepare(
      `SELECT id FROM ${KV_TABLE} WHERE payload_json LIKE ?`,
    ).get(`%${hash}%`);
    const ok = !!row;
    record("issued token persisted durably", ok, `row ${JSON.stringify(row)}`);
    expect(ok).toBe(true);
  });

  // ---------- REDEEM PATH ----------
  it("6. redeem with DB write forced to fail returns 500, sets NO session, and does NOT durably redeem", async () => {
    const restore = injectKvInsertFailure();
    try {
      redeemFailResp = await req("POST", `/api/invitations/redeem`, {
        body: { token: issuedToken, password: "supersecret123" },
      });
    } finally {
      restore();
    }
    const b = redeemFailResp.body ?? {};
    const ok = redeemFailResp.status === 500 && b.error === "INVITATION_REDEEM_PERSIST_FAILED" && b.ok !== true && b.ctx == null;
    record("redeem returns 500 with no session/context on persist failure", ok, `status ${redeemFailResp.status} err ${b.error}`);
    expect(ok).toBe(true);
  });

  it("7. the durable kv row shows the token is NOT redeemed (rolled back, no token reuse after restart)", () => {
    const hash = sha256Hex(issuedToken);
    const row = rawDb().prepare(
      `SELECT payload_json FROM ${KV_TABLE} WHERE payload_json LIKE ?`,
    ).get(`%${hash}%`);
    let redeemed = null;
    try { redeemed = JSON.parse(row.payload_json).redeemed; } catch { /* */ }
    const ok = !!row && redeemed === false;
    record("durable token state is NOT redeemed after failed redeem", ok, `redeemed ${redeemed}`);
    expect(ok).toBe(true);
  });

  it("8. control: with the failure removed, the SAME token redeems cleanly and creates a session (happy path)", async () => {
    const r = await req("POST", `/api/invitations/redeem`, {
      body: { token: issuedToken, password: "supersecret123" },
    });
    const b = r.body ?? {};
    // Confirm durable redemption persisted true now.
    const hash = sha256Hex(issuedToken);
    const row = rawDb().prepare(`SELECT payload_json FROM ${KV_TABLE} WHERE payload_json LIKE ?`).get(`%${hash}%`);
    let redeemed = null;
    try { redeemed = JSON.parse(row.payload_json).redeemed; } catch { /* */ }
    const ok = r.status === 200 && b.ok === true && redeemed === true;
    record("happy-path redeem succeeds and durably marks redeemed", ok, `status ${r.status} ok ${b.ok} redeemed ${redeemed}`);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 Bug C R2 invitation persist-failure E2E: ${passed}/${results.length} passed`);
    for (const r of results) if (!r.pass) console.log(`    FAIL: ${r.name}`);
    expect(passed).toBe(results.length);
  });
});
