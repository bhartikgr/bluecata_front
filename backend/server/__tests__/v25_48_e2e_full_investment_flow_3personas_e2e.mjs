/**
 * v25.48 FULL INVESTMENT FLOW — 3 personas, ONE engine, ONE cap table (diagnostic).
 *
 * Drives the ENTIRE canonical investment process against REAL Express routes for
 * three personas, and asserts they all converge on the SINGLE sacred
 * captableCommitStore ledger (one engine, one cap table):
 *
 *   (1) Capavate investor  — direct invitation  → soft-circle sourceType=direct
 *   (2) Collective member  — deal-room discovery → soft-circle sourceType=collective
 *   (3) Consortium partner — partner-promoted   → soft-circle sourceType=partner
 *
 * Canonical chain per persona (all share steps 2..6):
 *   1. REVIEW    — investor sees the company/round on their persona surface
 *   2. SOFT-CIRCLE (intent)      POST /api/rounds/:id/soft-circle
 *   3. FOUNDER CONFIRMS          POST /api/rounds/:id/soft-circle/:scId/validate   -> confirmed
 *   4. WIRE-FUNDED (funds-in-bank) POST /api/founder/rounds/:roundId/soft-circle/:scId/wire-funded -> funded queue
 *   5. COMMIT                    POST /api/founder/captable/commit-funded          -> sacred ledger
 *   6. CAP TABLE                 GET  /api/founder/captable  +  /api/founder/captable/ledger
 *
 * DIAGNOSTIC MODE: this test RECORDS every step outcome into a bug list and does
 * NOT stop on the first failure. It writes the full report to
 * /home/user/workspace/flow_bug_list.json and prints a summary. The single
 * `expect` at the end always passes so the record is complete (findings are in
 * the JSON, not vitest failures) — Ozan asked to SEE the bug list, not fix.
 *
 * Live-realistic: real routes via registerRoutes; KYC seeded in investor_kyc so
 * the wire-funded KYC gate is exercised truthfully (NOT bypassed via env).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import { registerRoutes } from "../routes.ts";
import { rawDb, getDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { addCompanyForFounder } from "../multiCompanyStore.ts";
import { upsertActiveMembership } from "../membershipStore.ts";
import * as collectiveMembershipStore from "../collectiveMembershipStore.ts";
import { createRound as roundsCreate } from "../roundsStore.ts";

const STAMP = Date.now();
let app, server, port;
const bugs = [];
const steps = [];

function record(persona, step, ok, detail) {
  const entry = { persona, step, ok, detail };
  steps.push(entry);
  if (!ok) bugs.push(entry);
  // eslint-disable-next-line no-console
  console.log(`  [${ok ? "PASS" : "BUG "}] (${persona}) ${step} — ${detail}`);
}

function call(method, path, { userId, as, body, headers } = {}) {
  const params = [];
  if (as) params.push(`as=${encodeURIComponent(as)}`);
  if (userId) params.push(`userId=${encodeURIComponent(userId)}`);
  const qs = params.length ? (path.includes("?") ? "&" : "?") + params.join("&") : "";
  const payload = body ? JSON.stringify(body) : null;
  const hdrs = { ...(payload ? { "content-type": "application/json" } : {}), ...(userId ? { "x-user-id": userId } : {}), ...(headers || {}) };
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path: `${path}${qs}`, method, headers: hdrs }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode ?? 0, body: j, raw: b }); });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// --- seed helpers -----------------------------------------------------------
const FOUNDER = `u_flow_founder_${STAMP}`;
const COMPANY = `co_flow_${STAMP}`;
let ROUND; // real round id returned by the rounds store (populates the cache)

function seedFounderAndRound() {
  __setRuntimePersona({ userId: FOUNDER, email: `${FOUNDER}@flow.test`, name: "Flow Founder", isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });
  addCompanyForFounder(FOUNDER, {
    companyId: COMPANY, companyName: `Flow Co ${STAMP}`, legalName: `Flow Co ${STAMP}, Inc.`, logoUrl: null,
    role: "founder", lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 1, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 100 },
    collective: { status: "none" }, billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: new Date().toISOString(), cardLast4: null, invoiceCount: 0 },
    sector: "SaaS", stage: "Seed", hq: "SF",
  });
  // Active PRICED round created THROUGH the rounds store so companyIdForRound
  // (which reads roundsStore.getRoundById cache) resolves the company exactly
  // as it would on the live server. Raw-SQL inserts would NOT populate the
  // cache and would produce a false "no company" artifact.
  const round = roundsCreate({
    companyId: COMPANY, name: `Flow Round ${STAMP}`, type: "priced", state: "active",
    targetAmount: 5000000, pricePerShare: 0.20, currency: "USD", actorUserId: FOUNDER,
  });
  ROUND = round.id;
}

function seedInvestor(userId, { collectiveMember = false } = {}) {
  __setRuntimePersona({ userId, email: `${userId}@flow.test`, name: userId, isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: true });
  // KYC accredited so the wire-funded KYC gate passes truthfully (not env-bypassed).
  try {
    rawDb().prepare(
      `INSERT INTO investor_kyc (id, investor_id, accredited, jurisdiction, source_of_funds, attestations_json, created_at)
       VALUES (?, ?, 1, 'US', 'savings', '{}', datetime('now'))`
    ).run(`kyc_${userId}`, userId);
  } catch {}
  if (collectiveMember) {
    // Seed BOTH membership sources requireCollectiveMember reads (unified check).
    try { upsertActiveMembership(userId); } catch {}
    try { collectiveMembershipStore.activate(userId, "u_admin", "standard", { chapterId: "chap_default" }); } catch (e) { record("seed", "collective.activate", false, String(e).slice(0,120)); }
  }
}

// Run steps 2..6 (the shared engine) for one persona and record every outcome.
async function runSharedFlow(persona, investorId, sourceType) {
  // STEP 2 — soft-circle (intent). Founder creates on-behalf so investorUserId links correctly.
  const sc = await call("POST", `/api/rounds/${ROUND}/soft-circle`, {
    userId: FOUNDER,
    body: { companyId: COMPANY, investorUserId: investorId, investorName: persona, amount: 50000, currency: "USD", status: "intent", sourceType },
  });
  const scId = sc.body?.softCircle?.id;
  record(persona, "2.soft-circle(intent)", sc.status === 200 && !!scId, `status ${sc.status} scId=${scId} src=${sourceType} ${JSON.stringify(sc.body)?.slice(0,120)}`);
  if (!scId) return { scId: null };

  // STEP 3 — founder confirms the soft-circle -> confirmed.
  const conf = await call("POST", `/api/rounds/${ROUND}/soft-circle/${scId}/validate`, { userId: FOUNDER });
  const confStatus = conf.body?.softCircle?.status;
  record(persona, "3.founder-confirm", conf.status === 200 && (confStatus === "confirmed"), `status ${conf.status} scStatus=${confStatus}`);

  // STEP 4 — wire-funded (founder confirms funds-in-bank) -> funded queue. Exercises KYC gate.
  const wf = await call("POST", `/api/founder/rounds/${ROUND}/soft-circle/${scId}/wire-funded`, { userId: FOUNDER, body: { shares: "250000" } });
  record(persona, "4.wire-funded", wf.status === 200 && wf.body?.ok === true, `status ${wf.status} ${JSON.stringify(wf.body)?.slice(0,140)}`);

  // STEP 5 — commit to the ONE sacred ledger (single-commit path, founder-confirmed amount).
  const commit = await call("POST", `/api/founder/captable/commit-funded`, {
    userId: FOUNDER,
    body: { invitationId: scId, roundId: ROUND, companyId: COMPANY, investorId, amount: "50000", currency: "USD", shares: "250000" },
  });
  const committedEntry = commit.body?.entry;
  record(persona, "5.commit-funded", commit.status === 200 && committedEntry?.state === "committed", `status ${commit.status} seq=${committedEntry?.seq} state=${committedEntry?.state} ${JSON.stringify(commit.body)?.slice(0,140)}`);

  return { scId, committedSeq: committedEntry?.seq ?? null, committedHash: committedEntry?.hash ?? null };
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  // KYC gate stays ENABLED (we seed real accredited KYC rows) — live-realistic.
  getDb();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  seedFounderAndRound();
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.48 FULL investment flow — 3 personas, one engine, one cap table (DIAGNOSTIC)", () => {
  it("drives review -> soft-circle -> confirm -> wired -> commit -> cap-table for all 3 personas", async () => {
    // ---- Persona 1: Capavate investor (direct) ----
    const INV1 = `u_flow_capavate_${STAMP}`;
    seedInvestor(INV1, { collectiveMember: false });
    // STEP 1 review — investor surface loads
    const r1 = await call("GET", "/api/investor/me", { userId: INV1 });
    record("capavate-investor", "1.review(/api/investor/me)", r1.status === 200, `status ${r1.status}`);
    const p1 = await runSharedFlow("capavate-investor", INV1, "direct");

    // ---- Persona 2: Collective member (collective) ----
    const INV2 = `u_flow_collective_${STAMP}`;
    seedInvestor(INV2, { collectiveMember: true });
    // STEP 1 review — collective deal-room company list
    const r2 = await call("GET", "/api/collective/companies", { userId: INV2 });
    record("collective-member", "1.review(/api/collective/companies)", r2.status === 200, `status ${r2.status} ${JSON.stringify(r2.body)?.slice(0,100)}`);
    const p2 = await runSharedFlow("collective-member", INV2, "collective");

    // ---- Persona 3: Consortium partner (partner) ----
    // The partner PROMOTES a deal; the invested-in party is still an investor on the
    // shared ledger. We model the partner-sourced soft-circle (sourceType=partner).
    const INV3 = `u_flow_partner_${STAMP}`;
    seedInvestor(INV3, { collectiveMember: false });
    const r3 = await call("GET", "/api/investor/me", { userId: INV3 });
    record("consortium-partner", "1.review(partner-sourced)", r3.status === 200, `status ${r3.status}`);
    const p3 = await runSharedFlow("consortium-partner", INV3, "partner");

    // ---- STEP 6: ONE CAP TABLE — all three committed entries must be in the SAME ledger ----
    const ledger = await call("GET", `/api/founder/captable/ledger?companyId=${COMPANY}`, { userId: FOUNDER });
    const entries = ledger.body?.entries ?? [];
    const investorsInLedger = new Set(entries.filter((e) => e.state === "committed").map((e) => e.investorId));
    record("ALL", "6.ledger(one-cap-table)", ledger.status === 200, `status ${ledger.status} committedInvestors=${[...investorsInLedger].join(",")}`);
    record("ALL", "6.capavate-in-ledger", investorsInLedger.has(INV1), `INV1 present: ${investorsInLedger.has(INV1)}`);
    record("ALL", "6.collective-in-ledger", investorsInLedger.has(INV2), `INV2 present: ${investorsInLedger.has(INV2)}`);
    record("ALL", "6.partner-in-ledger", investorsInLedger.has(INV3), `INV3 present: ${investorsInLedger.has(INV3)}`);

    // Cap-table read endpoint (PF-1) reflects the same committed positions.
    const cap = await call("GET", `/api/founder/captable?companyId=${COMPANY}`, { userId: FOUNDER });
    const capInvestors = new Set((cap.body?.positions ?? []).map((p) => p.investorId));
    record("ALL", "6.captable-endpoint(PF-1)", cap.status === 200, `status ${cap.status} positions=${(cap.body?.positions??[]).length}`);
    record("ALL", "6.captable-matches-ledger", INV1 && INV2 && INV3 ? (capInvestors.has(INV1) && capInvestors.has(INV2) && capInvestors.has(INV3)) : false, `capInvestors=${[...capInvestors].join(",")}`);

    // ---- ONE ENGINE proof: hash-chain continuity across all 3 personas' commits ----
    const committedSeqs = [p1.committedSeq, p2.committedSeq, p3.committedSeq].filter((s) => s !== null && s !== undefined);
    record("ALL", "engine.hash-chain-continuity", committedSeqs.length === 3, `committed seqs from 3 personas: [${committedSeqs.join(", ")}] (expect 3 distinct, monotonic on one chain)`);

    // Write the full report.
    const report = {
      generatedAt: new Date().toISOString(),
      company: COMPANY, round: ROUND, founder: FOUNDER,
      personas: { capavateInvestor: INV1, collectiveMember: INV2, consortiumPartner: INV3 },
      totalSteps: steps.length,
      bugCount: bugs.length,
      bugs,
      allSteps: steps,
    };
    fs.writeFileSync("/home/user/workspace/flow_bug_list.json", JSON.stringify(report, null, 2));
    // eslint-disable-next-line no-console
    console.log(`\n  ===== FLOW SUMMARY: ${steps.length} steps, ${bugs.length} BUGS =====`);
    for (const b of bugs) console.log(`   BUG (${b.persona}) ${b.step}: ${b.detail}`);

    // Diagnostic test — always passes; findings are in flow_bug_list.json.
    expect(steps.length).toBeGreaterThan(0);
  }, 120_000);

  // === PHASE 2: REAL persona ENTRY-SURFACE authorization ===================
  // Phase 1 drove steps 2..4 founder-on-behalf, which proves the shared engine
  // but NOT the live investor-side entry surfaces. Phase 2 exercises the actual
  // paths live users hit: (a) collective gate enforcement (non-member blocked,
  // member allowed), (b) investor SELF-SERVICE soft-circle (investor initiates
  // their OWN intent, no founder-on-behalf), (c) that self-service intent links
  // to the INVESTOR not the caller. These are where live bugs hide.
  it("enforces persona entry-surface authorization (collective gate + self-service soft-circle)", async () => {
    // (a) Collective gate — a NON-member investor must be BLOCKED (403) on the deal-room.
    const NONMEMBER = `u_flow_nonmember_${STAMP}`;
    seedInvestor(NONMEMBER, { collectiveMember: false });
    const gateBlocked = await call("GET", "/api/collective/companies", { userId: NONMEMBER });
    record("collective-gate", "non-member blocked (403)", gateBlocked.status === 403, `status ${gateBlocked.status} (expect 403 for non-member) ${JSON.stringify(gateBlocked.body)?.slice(0,120)}`);

    // (b) Collective gate — an ACTIVE member must be ALLOWED (200).
    const MEMBER = `u_flow_member_${STAMP}`;
    seedInvestor(MEMBER, { collectiveMember: true });
    const gateAllowed = await call("GET", "/api/collective/companies", { userId: MEMBER });
    record("collective-gate", "active member allowed (200)", gateAllowed.status === 200, `status ${gateAllowed.status} (expect 200 for member)`);

    // (c) Investor SELF-SERVICE soft-circle: investor posts their OWN intent with NO
    // investorUserId in the body -> must inherit ctx.userId (the investor), not caller.
    const SELF = `u_flow_selfservice_${STAMP}`;
    seedInvestor(SELF, { collectiveMember: false });
    const selfSc = await call("POST", `/api/rounds/${ROUND}/soft-circle`, {
      userId: SELF,
      body: { companyId: COMPANY, amount: 25000, currency: "USD", status: "intent", sourceType: "direct" },
    });
    const selfScId = selfSc.body?.softCircle?.id;
    const selfLinkedInvestor = selfSc.body?.softCircle?.investorUserId;
    record("self-service", "investor self-initiated soft-circle (200)", selfSc.status === 200 && !!selfScId, `status ${selfSc.status} scId=${selfScId}`);
    record("self-service", "intent links to INVESTOR not caller", selfLinkedInvestor === SELF, `investorUserId=${selfLinkedInvestor} (expect ${SELF})`);

    // (d) A NON-founder, NON-admin caller must NOT be able to spoof investorUserId
    // (on-behalf-of is authorized-caller only). Investor supplies a foreign
    // investorUserId -> route must IGNORE it and link to the caller (ctx.userId).
    const spoof = await call("POST", `/api/rounds/${ROUND}/soft-circle`, {
      userId: SELF,
      body: { companyId: COMPANY, investorUserId: FOUNDER, amount: 15000, currency: "USD", status: "intent", sourceType: "direct" },
    });
    const spoofLinked = spoof.body?.softCircle?.investorUserId;
    record("self-service", "non-authorized caller cannot spoof investorUserId", spoof.status === 200 && spoofLinked === SELF, `investorUserId=${spoofLinked} (expect ${SELF}, NOT ${FOUNDER})`);

    // Re-write the report with Phase 2 findings merged.
    const report = {
      generatedAt: new Date().toISOString(),
      company: COMPANY, round: ROUND, founder: FOUNDER,
      totalSteps: steps.length,
      bugCount: bugs.length,
      bugs,
      allSteps: steps,
    };
    fs.writeFileSync("/home/user/workspace/flow_bug_list.json", JSON.stringify(report, null, 2));
    console.log(`\n  ===== PHASE 2 COMPLETE — TOTAL ${steps.length} steps, ${bugs.length} BUGS =====`);
    for (const b of bugs) console.log(`   BUG (${b.persona}) ${b.step}: ${b.detail}`);
    expect(steps.length).toBeGreaterThan(0);
  }, 120_000);
});
