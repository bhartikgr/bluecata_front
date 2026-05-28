#!/usr/bin/env node
/**
 * Patch v12 Day 1 — End-to-end persistence smoke test.
 *
 * Scenario:
 *   1. Delete data.db.
 *   2. Boot with ENABLE_DEMO_SEED=1: hydrate + demo seed run.
 *   3. Sign up founder v12day1@local.dev (stores user_credentials + users row).
 *   4. Create company "D1 Inc" → companies + company_members + tenants + user_prefs + subscription row.
 *   5. sqlite3-style verify the four rows exist.
 *   6. Clear the in-memory Maps (simulate restart).
 *   7. Call hydrateAllStores() — caches rebuilt from DB.
 *   8. Verify login (lookupByEmail returns the credential).
 *   9. Verify GET /api/founder/companies (via getCompaniesForFounder) shows D1 Inc.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.join(repoRoot, "data.db");

// Force file-backed SQLite (not in-memory).
process.env.NODE_ENV = "development";
process.env.ENABLE_DEMO_SEED = "1";
delete process.env.DATABASE_URL;
process.chdir(repoRoot);

console.log("[smoke] working directory:", process.cwd());
console.log("[smoke] db path:", dbPath);

// Pre-step: wipe data.db if it exists.
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log("[smoke] wiped existing data.db");
}

// Import stores. Drizzle connection lazy-opens to ./data.db.
const { getDb } = await import("../server/db/connection.ts");
const {
  storeCredential,
  lookupByEmail,
  hydrateUserCredentialsStore,
  _testCredStore,
} = await import("../server/userCredentialsStore.ts");
const {
  addCompanyForFounder,
  getCompaniesForFounder,
  getActiveCompanyId,
  hydrateMultiCompanyStore,
  _testAccess,
} = await import("../server/multiCompanyStore.ts");
const {
  createSubscriptionForNewCompany,
  getSubscription,
  hydrateSubscriptionsStore,
  _testSubscriptions,
} = await import("../server/subscriptionsStore.ts");
const { hydrateAllStores } = await import("../server/lib/hydrateStores.ts");
const { registerFounderUser } = await import("../server/lib/userContext.ts");
const { seedDemoData } = await import("../server/lib/seedDemoData.ts");

// Force DB to be open + tables to exist (connection.ts does applyInlineMigrations on first getDb()).
const db = getDb();
console.log("[smoke] DB opened, tables migrated");

// Run demo seed once.
const seedSummary = await seedDemoData(db);
console.log("[smoke] demo seed summary:", seedSummary);

// ----- Step 3: signup -----
const email = "v12day1@local.dev";
const password = "D1!Pass#smoke";
const newUser = registerFounderUser({ email, password, name: "V12 Day1" });
console.log("[smoke] registered user:", { userId: newUser.userId, email: newUser.email });

// Verify cred persisted.
const credCheck = lookupByEmail(email);
if (!credCheck) throw new Error("[smoke FAIL] cred not stored");
if (!credCheck.verifyPassword(password)) throw new Error("[smoke FAIL] password verify failed");
console.log("[smoke] cred OK");

// ----- Step 4: create company D1 Inc -----
const companyId = `co_smoke_${Date.now()}`;
addCompanyForFounder(newUser.userId, {
  companyId,
  companyName: "D1 Inc",
  legalName: "D1 Inc.",
  logoUrl: null,
  role: "founder",
  lastActiveAt: new Date().toISOString(),
  kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
  collective: { status: "none" },
  billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
  sector: "SaaS",
  stage: "Seed",
  hq: "Toronto, ON",
});
createSubscriptionForNewCompany(companyId, { plan: "founder_free", actor: `founder:${newUser.userId}` });
console.log("[smoke] created company:", companyId);

// ----- Step 5: verify DB rows -----
const { sql } = await import("drizzle-orm");
const rowCount = (table, where) => {
  const res = db.all(sql.raw(`SELECT count(*) as c FROM ${table} ${where ? "WHERE " + where : ""}`));
  return res[0]?.c ?? 0;
};
const credRows  = rowCount("user_credentials", `email = '${email.toLowerCase()}'`);
const userRows  = rowCount("users", `email = '${email.toLowerCase()}'`);
const tenantRows = rowCount("tenants", `id = 'tenant_co_${companyId}'`);
const compRows   = rowCount("companies", `id = '${companyId}'`);
const memRows    = rowCount("company_members", `company_id = '${companyId}'`);
const prefRows   = rowCount("user_prefs", `user_id = '${newUser.userId}'`);
const subRows    = rowCount("subscriptions", `company_id = '${companyId}'`);
console.log("[smoke] DB row counts:", {
  user_credentials: credRows,
  users: userRows,
  tenants: tenantRows,
  companies: compRows,
  company_members: memRows,
  user_prefs: prefRows,
  subscriptions: subRows,
});

for (const [k, v] of Object.entries({ credRows, userRows, tenantRows, compRows, memRows, prefRows, subRows })) {
  if (v < 1) throw new Error(`[smoke FAIL] expected ≥1 ${k}, got ${v}`);
}
console.log("[smoke] all DB rows present");

// ----- Step 6: simulate restart by clearing all Maps -----
_testCredStore._memStore.clear();
_testCredStore._userIdIndex.clear();
_testAccess.USER_COMPANIES.clear();
_testAccess.USER_ACTIVE_COMPANY.clear();
_testSubscriptions.store.clear();
_testSubscriptions.history.clear();
console.log("[smoke] cleared in-memory Maps");

// ----- Step 7: re-hydrate from DB -----
await hydrateAllStores();
console.log("[smoke] re-hydrated from DB");

// ----- Step 8: verify login still works -----
const credAfter = lookupByEmail(email);
if (!credAfter) throw new Error("[smoke FAIL] cred missing after rehydrate");
if (credAfter.userId !== newUser.userId) throw new Error("[smoke FAIL] userId mismatch after rehydrate");
if (!credAfter.verifyPassword(password)) throw new Error("[smoke FAIL] password verify failed after rehydrate");
console.log("[smoke] login OK after restart");

// ----- Step 9: verify GET /api/founder/companies (logically) -----
const restoredCompanies = getCompaniesForFounder(newUser.userId);
const found = restoredCompanies.find((c) => c.companyId === companyId);
if (!found) {
  console.error("[smoke FAIL] companies after restart:", restoredCompanies);
  throw new Error("[smoke FAIL] D1 Inc not found after rehydrate");
}
if (found.companyName !== "D1 Inc") {
  throw new Error(`[smoke FAIL] companyName drift: ${found.companyName}`);
}
const restoredActive = getActiveCompanyId(newUser.userId);
if (restoredActive !== companyId) {
  throw new Error(`[smoke FAIL] active company drift: got ${restoredActive}, expected ${companyId}`);
}
const restoredSub = getSubscription(companyId);
if (!restoredSub) throw new Error("[smoke FAIL] subscription missing after rehydrate");
console.log("[smoke] companies & active company & subscription OK after restart");

console.log("");
console.log("===========================================================");
console.log("[smoke PASS] v12 Day 1 end-to-end persistence smoke complete");
console.log("===========================================================");

// Clean up
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log("[smoke] cleaned up data.db");
}
