/* v25.45 Founder QA wave — shared E2E harness.
 *
 * Boots the real Express app (registerRoutes) on an ephemeral port and seeds a
 * FOUNDER persona who owns a freshly-created company (companies +
 * company_members rows). Exposes request helpers plus a profile-PATCH helper
 * so the F2 persistence suite (and the rest of the founder-side wave) can
 * exercise the real /api/companies/:id/profile route against the durable
 * profilestore_company_profile table.
 *
 * Reuses the low-level request factories from v25_42_helpers.mjs.
 */
import express from "express";
import http from "node:http";
import os from "node:os";
import fsRestart from "node:fs";
import pathRestart from "node:path";
import { createRequire } from "node:module";
import { registerRoutes } from "../routes.ts";
import { rawDb, closeDb, resetDbForTests } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { reqFactory, reqNoAuthFactory, recorder } from "./v25_42_helpers.mjs";
import { addCompanyForFounder } from "../multiCompanyStore.ts";

export { recorder };

/* ───────────────────────────────────────────────────────────────────────────
 * v25.45.3 — Generalizable Save → REAL Restart → Load test helper (Tier 6 #48).
 *
 * The prior Bug H "restart" was not a real restart: it reused the same live DB
 * connection and `await import("../lib/userPrivacyResolver.ts")` returned the
 * already-cached module. Per Sacred Tier 6 #48, a persistence regression test
 * MUST perform: (1) Save, (2) a fresh process load — clear module-level state,
 * re-instantiate stores, RE-OPEN the durable DB connection — (3) Load, and
 * (4) assert byte-for-byte equality with what was saved.
 *
 * Why a FILE-backed DB is required: under vitest NODE_ENV=test the default DB
 * is `:memory:`, which is wiped the instant `closeDb()` closes the handle.
 * A real restart can only be proven against a durable, on-disk SQLite file
 * that survives the close/reopen. `useFileBackedDb()` forces that, and
 * `simulateRestart()` performs the close + module-cache clear + reconnect.
 * ─────────────────────────────────────────────────────────────────────────── */

let _restartTmpDir = null;
let _restartPrevDbUrl;

/**
 * Force the process onto a fresh file-backed SQLite DB so that a close/reopen
 * cycle (a real restart) preserves rows on disk. Call BEFORE setupFounder*().
 * Returns the absolute db file path. Idempotent within a test file.
 */
export function useFileBackedDb(tag = "restart") {
  if (_restartTmpDir) return pathRestart.join(_restartTmpDir, "data.db");
  _restartTmpDir = fsRestart.mkdtempSync(pathRestart.join(os.tmpdir(), `cap_${tag}_`));
  const dbFile = pathRestart.join(_restartTmpDir, "data.db");
  _restartPrevDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${dbFile}`;
  // Drop any connection opened under the previous URL so the next getDb()/
  // rawDb() opens the file-backed handle.
  resetDbForTests();
  return dbFile;
}

/**
 * Tear down the file-backed DB env override (call in afterAll).
 */
export async function teardownFileBackedDb() {
  try { await closeDb(); } catch { /* noop */ }
  if (_restartPrevDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = _restartPrevDbUrl;
  if (_restartTmpDir) {
    try { fsRestart.rmSync(_restartTmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
  _restartTmpDir = null;
  _restartPrevDbUrl = undefined;
  resetDbForTests();
}

/**
 * Perform a REAL Save→Restart→Load "restart" step:
 *   1. Close the live durable DB connection (`closeDb()` ends the SQLite handle
 *      and nulls all module-level connection state).
 *   2. Best-effort clear the CJS require.cache entries for the persistence
 *      modules so a subsequent dynamic import re-evaluates the module rather
 *      than returning the cached instance. (Under vitest's ESM transform the
 *      native require.cache may not hold these; the cache-busting query string
 *      on the dynamic import below is the authoritative fresh-load mechanism.)
 *   3. Re-open the DB by re-importing the connection module fresh and calling
 *      rawDb(), which lazily re-opens the on-disk file.
 *   4. Re-import the resolver fresh (cache-busted) and return its functions so
 *      callers prove the Load path against a cold module + cold connection.
 *
 * @returns {Promise<{ rawDb: Function, readUserPrivacy: Function,
 *                     readUserPrivacyRaw: Function }>}
 */
export async function simulateRestart() {
  // (1) Close the durable connection — this is the "process exit" half.
  await closeDb();

  // (2) Best-effort native require.cache clear for the persistence modules.
  try {
    const r = createRequire(import.meta.url);
    for (const mod of ["../lib/userPrivacyResolver.ts", "../db/connection.ts"]) {
      try { delete r.cache[r.resolve(mod)]; } catch { /* not in native cache under vitest */ }
    }
  } catch { /* createRequire unavailable — fall through to query-string busting */ }

  // (3) Re-open the DB fresh (cold connection re-reads the on-disk file).
  const freshConn = await import("../db/connection.ts?restart=" + Date.now());
  // Touch rawDb to force the lazy re-open before the Load read.
  freshConn.rawDb();

  // (4) Re-import the resolver fresh (cold module) and hand back its Load fns.
  const freshResolver = await import("../lib/userPrivacyResolver.ts?restart=" + Date.now());
  return {
    rawDb: freshConn.rawDb,
    readUserPrivacy: freshResolver.readUserPrivacy,
    readUserPrivacyRaw: freshResolver.readUserPrivacyRaw,
  };
}

export function makeFounderIds(tag) {
  const STAMP = Date.now() + "_" + Math.floor(Math.random() * 1e6);
  return {
    STAMP,
    FOUNDER: `u_v2545_${tag}_founder_${STAMP}`,
    EMAIL: `${tag}_founder_${STAMP}@v2545.test`,
    COMPANY: `co_v2545_${tag}_${STAMP}`,
    get TENANT() { return `tenant_co_${this.COMPANY}`; },
  };
}

function seedFounderCompany(ids, companyName = "Acme QA Co") {
  const now = new Date().toISOString();
  // Seed the user row first (companies/company_members are written by
  // addCompanyForFounder through the real store API so the in-memory
  // USER_COMPANIES registry the PATCH ownership check reads is populated too).
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'founder', 0)`,
  ).run(ids.FOUNDER, ids.TENANT, ids.EMAIL, ids.FOUNDER);
  addCompanyForFounder(ids.FOUNDER, {
    companyId: ids.COMPANY,
    companyName,
    legalName: `${companyName}, Inc.`,
    logoUrl: null,
    role: "founder",
    lastActiveAt: now,
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: now, cardLast4: null, invoiceCount: 0 },
    sector: "",
    stage: "",
    hq: "",
  });
}

/**
 * Boot the app + seed a founder who owns one fresh company.
 * Returns { server, getPort, req, reqNoAuth, ids, teardown, patchProfile,
 *           getProfile, readDurable }.
 */
export async function setupFounder(tag, { companyName = "Acme QA Co" } = {}) {
  const ids = makeFounderIds(tag);
  __setRuntimePersona({
    userId: ids.FOUNDER, email: ids.EMAIL, name: "v25.45 Founder",
    isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false,
    founder: { companies: [{ companyId: ids.COMPANY, companyName }], activeCompanyId: ids.COMPANY },
  });

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  let port;
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  const getPort = () => port;

  seedFounderCompany(ids, companyName);

  const req = reqFactory(getPort, () => ids.FOUNDER);
  const reqNoAuth = reqNoAuthFactory(getPort);
  const teardown = () => new Promise((resolve) => server.close(() => resolve()));

  const getProfile = (as) =>
    req("GET", `/api/companies/${ids.COMPANY}/profile${as ? `?as=${as}` : ""}`, { userId: ids.FOUNDER });
  const patchProfile = (patch) =>
    req("PATCH", `/api/companies/${ids.COMPANY}/profile`, { userId: ids.FOUNDER, body: patch });
  const readDurable = () => {
    const row = rawDb().prepare(
      `SELECT profile_json FROM profilestore_company_profile WHERE company_id = ? AND deleted_at IS NULL`,
    ).get(ids.COMPANY);
    return row?.profile_json ? JSON.parse(row.profile_json) : null;
  };

  return { server, getPort, req, reqNoAuth, ids, teardown, getProfile, patchProfile, readDurable };
}
