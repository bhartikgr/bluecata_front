/* v25.41 Phase 4 — E2E: founder application stamped with real chapter (Q7, Avi=A).
 *
 * Q7 (Avi answer = A): founderCollectiveApplyStore now resolves the founder's
 * REAL chapter from their active chapter membership at write time
 * (resolveFounderChapter), instead of ALWAYS stamping the platform DEFAULT
 * chapter. Per Avi's unifying directive, the chapter a record belongs to is
 * resolved dynamically from the membership record table.
 *
 * Contract pinned here:
 *   - A founder who belongs to chapter_x, submitting a company application,
 *     produces a founder_collective_applications row stamped chapterId=chapter_x
 *     (NOT the platform DEFAULT chapter)
 *   - The tenantId is the chapter's tenant, carried from the membership
 *   - A founder with NO chapter membership falls back to the DEFAULT chapter
 *     (preserves the single-chapter LIVE behavior)
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { addCompanyForFounder } from "../multiCompanyStore.ts";
import { DEFAULT_CHAPTER_ID } from "../lib/chapterDefaults.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2541_apply_admin_${STAMP}`;

// Founder bound to a real (non-default) chapter.
const CHAPTER_X = `chap_v2541_apply_x_${STAMP}`;
const FOUNDER = `u_v2541_apply_founder_${STAMP}`;
const COMPANY = `co_v2541_apply_${STAMP}`;
const EMAIL = `apply_founder_${STAMP}@v2541.test`;

// Founder with NO chapter membership (default-fallback case).
const FOUNDER_NO_CH = `u_v2541_apply_founder_noch_${STAMP}`;
const COMPANY_NO_CH = `co_v2541_apply_noch_${STAMP}`;
const EMAIL_NO_CH = `apply_founder_noch_${STAMP}@v2541.test`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

function req(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? ADMIN };
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
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

function seedUser(userId, email, chapterId) {
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, ?, ?, ?, 'founder', 0)`,
  ).run(userId, `tenant_chap_${chapterId}`, email, userId);
}
function seedChapter(chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapters
       (id, tenant_id, name, region, city, status, dsc_quorum_pct, created_at)
     VALUES (?, ?, ?, 'NA', 'Toronto', 'active', 50, ?)`,
  ).run(chapterId, `tenant_chap_${chapterId}`, `Chapter ${chapterId}`, now);
}
function seedChapterMembership(userId, chapterId) {
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at)
     VALUES (?, ?, ?, ?, 'member', 'active', ?, ?)`,
  ).run(`cm_${userId}_${chapterId}`, `tenant_chap_${chapterId}`, chapterId, userId, now, now);
}
function mkMembership(companyId, name) {
  return {
    companyId, companyName: name, legalName: `${name}, Inc.`, logoUrl: null,
    role: "founder", lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "-", cardLast4: null, invoiceCount: 0 },
    sector: "Fintech", stage: "Seed", hq: "Toronto, ON",
  };
}
function validApplication(founderId, companyId) {
  return {
    companyId, founderId,
    pitchDeckFilename: `deck_${STAMP}.pdf`,
    tractionMrr: 1000, tractionUsers: 50, tractionGrowthPct: 12,
    asks: "We are seeking introductions to seed-stage SaaS investors.",
    references: "",
    coverLetter: "x".repeat(150),
    feeAcknowledged: true,
  };
}
function dbAppChapter(founderId, companyId) {
  const row = rawDb()
    .prepare(`SELECT chapter_id, tenant_id FROM founder_collective_applications WHERE founder_id = ? AND company_id = ? LIMIT 1`)
    .get(founderId, companyId);
  return row;
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2541.test`, name: "v25.41 Apply Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });
  __setRuntimePersona({ userId: FOUNDER, email: EMAIL, name: FOUNDER, isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });
  __setRuntimePersona({ userId: FOUNDER_NO_CH, email: EMAIL_NO_CH, name: FOUNDER_NO_CH, isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  // Founder in chapter_x, owning COMPANY.
  seedChapter(CHAPTER_X);
  seedUser(FOUNDER, EMAIL, CHAPTER_X);
  seedChapterMembership(FOUNDER, CHAPTER_X);
  addCompanyForFounder(FOUNDER, mkMembership(COMPANY, `Apply Co ${STAMP}`));

  // Founder with NO chapter membership, owning COMPANY_NO_CH.
  seedUser(FOUNDER_NO_CH, EMAIL_NO_CH, DEFAULT_CHAPTER_ID);
  addCompanyForFounder(FOUNDER_NO_CH, mkMembership(COMPANY_NO_CH, `Apply NoCh Co ${STAMP}`));

  // v25.45.4 L-3 (Ozan decision b) — Collective apply now requires the
  // company to have an active or live funding round. Seed one per company so
  // this v25.41 chapter-resolution contract test exercises the post-gate
  // success path (NOT the gate itself, which is covered by v25_45_4_regression).
  for (const cid of [COMPANY, COMPANY_NO_CH]) {
    rawDb()
      .prepare(
        `INSERT INTO rounds (id, company_id, name, type, state, target_amount, raised_amount, created_at, updated_at)
         VALUES (?, ?, ?, 'priced', 'active', 1000000, 0, datetime('now'), datetime('now'))`
      )
      .run(`rnd_v2541_${cid}_${STAMP}`, cid, `Seed Round ${cid}`);
  }
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.41 founder apply chapter resolution (Q7) — E2E", () => {
  it("1. a founder in chapter_x → application row stamped chapterId=chapter_x", async () => {
    const res = await req("POST", "/api/founder/collective/applications", { body: validApplication(FOUNDER, COMPANY), userId: FOUNDER });
    record("apply submit 200/ok", res.status === 200 && res.body?.ok === true, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,140)}`);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const row = dbAppChapter(FOUNDER, COMPANY);
    record("DB application row exists", !!row, JSON.stringify(row));
    expect(row).toBeTruthy();
    record("application chapter_id === chapter_x (real chapter, NOT default)", row?.chapter_id === CHAPTER_X, `chapter_id ${row?.chapter_id}`);
    expect(row?.chapter_id).toBe(CHAPTER_X);
    record("application chapter_id is NOT the platform DEFAULT", row?.chapter_id !== DEFAULT_CHAPTER_ID, `default ${DEFAULT_CHAPTER_ID}`);
    expect(row?.chapter_id).not.toBe(DEFAULT_CHAPTER_ID);
    record("application tenant_id === chapter_x tenant", row?.tenant_id === `tenant_chap_${CHAPTER_X}`, `tenant_id ${row?.tenant_id}`);
    expect(row?.tenant_id).toBe(`tenant_chap_${CHAPTER_X}`);
  });

  it("2. a founder with NO chapter membership → falls back to DEFAULT chapter", async () => {
    const res = await req("POST", "/api/founder/collective/applications", { body: validApplication(FOUNDER_NO_CH, COMPANY_NO_CH), userId: FOUNDER_NO_CH });
    record("no-chapter apply submit 200/ok", res.status === 200 && res.body?.ok === true, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,140)}`);
    expect(res.status).toBe(200);

    const row = dbAppChapter(FOUNDER_NO_CH, COMPANY_NO_CH);
    record("no-chapter application row exists", !!row, JSON.stringify(row));
    expect(row).toBeTruthy();
    record("no-chapter application stamped DEFAULT chapter (fallback)", row?.chapter_id === DEFAULT_CHAPTER_ID, `chapter_id ${row?.chapter_id}`);
    expect(row?.chapter_id).toBe(DEFAULT_CHAPTER_ID);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.41 founder apply chapter resolution E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
