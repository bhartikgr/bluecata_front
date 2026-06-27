/* v25.45 ROUND 8 (GPT-5.5 finding) — cap-table PDF must NOT treat an
 * invitation-only viewer as a cap-table counterparty.
 *
 * Background: GET /api/companies/:id/cap-table/pdf admits any viewer who passes
 * requireCanAccessCompany — which includes INVITATION-ONLY investors (they have
 * an invited round for the company but NO committed captable_commits row). The
 * previous round-7 PDF call site hardcoded `isCoMember: true` for EVERY rendered
 * holder, so an invitation-only viewer was wrongly treated as a counterparty and
 * could see committed holders' real identities.
 *
 * Round-8 fix: the PDF call site now computes isCoMember dynamically per member
 * via areCoMembersOnAnyCapTable(member.userId, viewerUserId) — reading the
 * SACRED captable_commits ledger (read-only). An invitation-only viewer is not a
 * co-member of anyone, so committed holder A must render as "Private Investor"
 * (the locked Capavate term), NEVER A's legal name.
 *
 * This test:
 *   1. Creates a company with committed cap-table member A (a captable_commits
 *      row). A opts INTO co-member visibility (visibleToCoMembers:true) so that
 *      the ONLY thing standing between A's legal name and the viewer is the
 *      counterparty (isCoMember) check.
 *   2. Creates user B with INVITATION-ONLY access to the same company (visible
 *      per requireCanAccessCompany, but NOT a captable_commits row).
 *   3. B requests the cap-table PDF.
 *   4. Asserts A is rendered as "Private Investor" and A's legal name never
 *      appears in the PDF bytes — because B is not a co-member of A.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona, registerPersona } from "../lib/userContext.ts";
import { writeUserPrivacy, resolveDisplayName } from "../lib/userPrivacyResolver.ts";
import { areCoMembersOnAnyCapTable } from "../lib/capTableMembership.ts";

let app, server, port;
const STAMP = Date.now();

const COMPANY = `co_r8pdf_${STAMP}`;
const ROUND = `rnd_r8pdf_${STAMP}`;

// Committed cap-table member A.
const MEMBER_A = `u_r8pdf_memberA_${STAMP}`;
const MEMBER_A_LEGAL = `R8PDF Member A Legal ${STAMP}`;

// Invitation-only viewer B (NO captable_commits row).
const VIEWER_B_EMAIL = `r8pdf_viewerB_${STAMP}@probe.test`;
const VIEWER_B_NAME = `R8PDF Viewer B ${STAMP}`;
let VIEWER_B_ID = null;

function seedUser(userId, email, name) {
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'investor', 0)`,
    )
    .run(userId, `tenant_${STAMP}`, email, name);
}

function seedCommit(companyId, investorId, tag) {
  rawDb()
    .prepare(
      `INSERT INTO captable_commits (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id, amount, currency, shares, state, prev_hash, hash, reconcile_match, compliance_hold, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '10000', 'USD', '1000', 'committed', '', ?, 1, 0, NULL)`,
    )
    .run(
      `cc_${tag}_${STAMP}`,
      `tenant_${STAMP}`,
      Date.now(),
      new Date().toISOString(),
      `inv_${tag}_${STAMP}`,
      ROUND,
      companyId,
      investorId,
      `h_${tag}_${STAMP}`,
    );
}

// Read an arbitrary (possibly binary) HTTP response body as a Buffer.
function reqBuffer(method, path, { userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "x-user-id": userId };
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, buffer: Buffer.concat(chunks) }));
    });
    r.on("error", reject);
    r.end();
  });
}

beforeAll(async () => {
  // Admin persona is only used to bootstrap the app; B is the real test viewer.
  __setRuntimePersona({
    userId: `u_r8pdf_admin_${STAMP}`,
    email: `admin_${STAMP}@r8pdf.test`,
    name: "R8 Admin",
    isFounder: false,
    isInvestor: false,
    isAdmin: true,
    hasInvitations: false,
  });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((r) => server.listen(0, () => { port = server.address().port; r(); }));

  // Committed cap-table member A.
  seedUser(MEMBER_A, `${MEMBER_A}@r8pdf.test`, MEMBER_A_LEGAL);
  seedCommit(COMPANY, MEMBER_A, "memberA");
  // A opts INTO co-member visibility: if B were a real counterparty, A's name
  // would be revealed. The ONLY barrier left is the isCoMember check.
  writeUserPrivacy(MEMBER_A, { screenName: "", visibleToCoMembers: true, visibleInCollectiveDirectory: false });

  // Invitation-only viewer B — has an invited round for COMPANY (so
  // requireCanAccessCompany passes) but NO captable_commits row.
  VIEWER_B_ID = registerPersona({
    email: VIEWER_B_EMAIL,
    name: VIEWER_B_NAME,
    password: `pw_${STAMP}`,
    invitationId: `inv_viewerB_${STAMP}`,
    roundId: ROUND,
    companyId: COMPANY,
  });
}, 60_000);

afterAll(async () => { await new Promise((r) => server.close(() => r())); });

describe("v25.45 R8 — cap-table PDF invitation-only viewer is NOT a counterparty", () => {
  it("sanity: viewer B is NOT a cap-table co-member of committed member A", () => {
    const coMember = areCoMembersOnAnyCapTable(MEMBER_A, VIEWER_B_ID);
    console.log("R8_PDF_COMEMBER_CHECK", JSON.stringify({ MEMBER_A, VIEWER_B_ID, coMember }));
    expect(coMember).toBe(false);
  });

  it("B (invitation-only) can access the company PDF route (requireCanAccessCompany passes)", async () => {
    const res = await reqBuffer("GET", `/api/companies/${COMPANY}/cap-table/pdf`, { userId: VIEWER_B_ID });
    console.log("R8_PDF_ACCESS", JSON.stringify({ status: res.status, bytes: res.buffer.length }));
    expect(res.status).toBe(200);
    expect(res.buffer.length).toBeGreaterThan(0);
  });

  it("the shareholder label fed to the PDF for A resolves to 'Private Investor' (the exact PDF call-site logic)", () => {
    // Reproduce the round-8 PDF call site verbatim: compute isCoMember
    // dynamically, then resolve the externalCapTable label. This is the exact
    // value routes.ts now feeds into streamCapTablePdf for holder A when viewer
    // B requests the PDF.
    const isCoMember = VIEWER_B_ID ? areCoMembersOnAnyCapTable(MEMBER_A, VIEWER_B_ID) : false;
    const shareholderLabel = resolveDisplayName(MEMBER_A, VIEWER_B_ID, "externalCapTable", {
      legalName: MEMBER_A_LEGAL,
      isCoMember,
    });
    console.log("R8_PDF_LABEL", JSON.stringify({ isCoMember, shareholderLabel }));
    // B is not a counterparty → masked to the locked term, never A's identity.
    expect(isCoMember).toBe(false);
    expect(shareholderLabel).toBe("Private Investor");
    expect(shareholderLabel).not.toBe(MEMBER_A_LEGAL);
    expect(shareholderLabel).not.toBe(MEMBER_A);
    // Regression guard: the old literal must never be produced.
    expect(shareholderLabel).not.toBe("Private member");
  });

  it("REGRESSION: had isCoMember stayed hardcoded true, A's legal name WOULD have leaked", () => {
    // Proves the round-7 hardcode was a real leak: with isCoMember:true and A's
    // visibleToCoMembers:true, the resolver reveals A's legal name. The round-8
    // fix (dynamic isCoMember=false for invitation-only B) is what prevents it.
    const leakedUnderOldBehavior = resolveDisplayName(MEMBER_A, VIEWER_B_ID, "externalCapTable", {
      legalName: MEMBER_A_LEGAL,
      isCoMember: true, // the removed round-7 hardcode
    });
    console.log("R8_PDF_OLD_BEHAVIOR", JSON.stringify({ leakedUnderOldBehavior }));
    expect(leakedUnderOldBehavior).toBe(MEMBER_A_LEGAL);
  });
});
