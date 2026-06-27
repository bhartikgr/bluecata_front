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
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { reqFactory, reqNoAuthFactory, recorder } from "./v25_42_helpers.mjs";
import { addCompanyForFounder } from "../multiCompanyStore.ts";

export { recorder };

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
