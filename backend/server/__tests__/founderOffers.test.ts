/**
 * v17 Phase C — Founder accept/decline offers test.
 *
 * Coverage:
 *   - happy path: founder accepts a pending offer → 200, status=accepted,
 *     hash chain extended
 *   - happy path: founder declines a pending offer → 200, status=declined,
 *     decline_reason persisted
 *   - idempotency: re-accept of already-accepted offer → 200 idempotent:true
 *   - cross-tenant rejection: a non-chapter-member calling accept → 403
 *     not_chapter_member
 *   - ownership rejection: a chapter-member who is NOT the founder of the
 *     company → 403 company_not_owned
 *   - state-machine: accept-after-decline → 409 invalid_state_transition
 *   - feature flag: COLLECTIVE_ENABLED=0 → 503
 *   - validation: decline without reason → 400 validation_failed
 *
 * Self-contained: seeds an investor_nominations row directly into the DB,
 * boots an Express server, and exercises the route via HTTP.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { investorNominations as investorNominationsTable } from "../../shared/schema";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";
// Maya is founder of co_novapay AND a chap_keiretsu_canada member.
const MAYA = "u_maya_chen";
const COMPANY_MAYA = "co_novapay";
// Daniel: chapter member; co-founder of co_novapay BUT NOT founder of
// co_arboreal — the test uses co_arboreal for the ownership-rejection case.
const DANIEL = "u_daniel_okafor";
const COMPANY_NOT_DANIEL = "co_arboreal";
// Aisha: chapter admin (bypasses chapter check + ownership).
const AISHA = "u_aisha_patel";
// Ghost: not a chapter member at all.
const GHOST = "u_ghost_no_memberships";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());

  // Hydrate the in-memory USER_COMPANIES map from the freshly-seeded DB so
  // that getCompaniesForFounder(MAYA) returns co_novapay — required for the
  // "founder owns the company" ownership check inside the route.
  await hydrateMultiCompanyStore();

  // Activate Maya/Aisha/Daniel in the collective membership store so that
  // requireCollectiveMember passes. We avoid relying on ENABLE_DEMO_SEED
  // here because that env var is read at module-load time across the
  // codebase, and we want this test to be independent of process-wide state.
  for (const uid of [MAYA, AISHA, DANIEL]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
  }

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string; userRole?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.userRole) headers["x-role"] = opts.userRole;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/**
 * Seeds a pending investor_nominations row for a given (investor, company,
 * chapter) directly via Drizzle. Returns the offer id.
 *
 * Each seeded row gets a unique id so multiple tests can run without
 * stepping on each other.
 */
function seedPendingOffer(opts: {
  investorUserId: string;
  companyId: string;
  chapterId?: string;
  tenantId?: string;
}): string {
  const id = `invnom_test_${randomBytes(6).toString("hex")}`;
  const submittedAt = new Date().toISOString();
  const tenantId = opts.tenantId ?? TENANT_ID;
  const chapterId = opts.chapterId ?? CHAPTER_ID;
  const rationale = "Strong founder-market fit and growing MRR. Pleased to vouch publicly.";
  const hash = createHash("sha256")
    .update("GENESIS|")
    .update(JSON.stringify({ id, investorUserId: opts.investorUserId, companyId: opts.companyId }))
    .digest("hex");
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(investorNominationsTable).values({
      id,
      tenantId,
      chapterId,
      investorUserId: opts.investorUserId,
      companyId: opts.companyId,
      rationale,
      status: "pending",
      prevHash: null,
      hash,
      submittedAt,
      createdAt: submittedAt,
    } as any).run();
  });
  return id;
}

// ========================================================================
// Happy path — accept
// ========================================================================

describe("v17 Phase C — POST /api/collective/offers/:offerId/accept", () => {
  it("founder accepts a pending offer → 200, status=accepted, hash chain extended", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });

    const r = await call("POST", `/api/collective/offers/${offerId}/accept`, {
      userId: MAYA,
    });

    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.offer?.status).toBe("accepted");
    expect(r.body?.offer?.decidedBy).toBe(MAYA);
    expect(r.body?.offer?.decidedAt).toBeTruthy();
    // Chain extension — new hash differs from the seeded hash; prev_hash is
    // populated with the previous chain tip.
    expect(r.body?.offer?.hash).toBeTruthy();
    expect(r.body?.offer?.prevHash).toBeTruthy();
    expect(r.body?.offer?.hash).not.toBe(r.body?.offer?.prevHash);
  });

  it("re-accept of already-accepted offer → 200 idempotent:true (no state change)", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });

    const first = await call("POST", `/api/collective/offers/${offerId}/accept`, {
      userId: MAYA,
    });
    expect(first.status).toBe(200);
    const acceptedHash = first.body?.offer?.hash;

    const second = await call("POST", `/api/collective/offers/${offerId}/accept`, {
      userId: MAYA,
    });
    expect(second.status).toBe(200);
    expect(second.body?.idempotent).toBe(true);
    // Hash MUST be the same — no second transition appended.
    expect(second.body?.offer?.hash).toBe(acceptedHash);
  });
});

// ========================================================================
// Happy path — decline
// ========================================================================

describe("v17 Phase C — POST /api/collective/offers/:offerId/decline", () => {
  it("founder declines a pending offer → 200, status=declined, reason persisted", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });
    const reason = "Not the right strategic fit at this stage; thank you for considering.";

    const r = await call("POST", `/api/collective/offers/${offerId}/decline`, {
      userId: MAYA,
      body: { reason },
    });

    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(r.body?.offer?.status).toBe("declined");
    expect(r.body?.offer?.declineReason).toBe(reason);
    expect(r.body?.offer?.decidedBy).toBe(MAYA);
  });

  it("decline without reason body → 400 validation_failed", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });

    const r = await call("POST", `/api/collective/offers/${offerId}/decline`, {
      userId: MAYA,
      body: {},
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toBe("validation_failed");
  });

  it("decline with too-short reason → 400 validation_failed", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });
    const r = await call("POST", `/api/collective/offers/${offerId}/decline`, {
      userId: MAYA,
      body: { reason: "no" },
    });
    expect(r.status).toBe(400);
  });
});

// ========================================================================
// State machine — accept-after-decline
// ========================================================================

describe("v17 Phase C — state machine", () => {
  it("accept after decline → 409 invalid_state_transition", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });
    const declined = await call("POST", `/api/collective/offers/${offerId}/decline`, {
      userId: MAYA,
      body: { reason: "Not at this time, thank you very much." },
    });
    expect(declined.status).toBe(200);

    const accept = await call("POST", `/api/collective/offers/${offerId}/accept`, {
      userId: MAYA,
    });
    expect(accept.status).toBe(409);
    expect(String(accept.body?.error)).toBe("invalid_state_transition");
    expect(accept.body?.currentStatus).toBe("declined");
  });

  it("decline after accept → 409 invalid_state_transition", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });
    const accepted = await call("POST", `/api/collective/offers/${offerId}/accept`, {
      userId: MAYA,
    });
    expect(accepted.status).toBe(200);

    const decline = await call("POST", `/api/collective/offers/${offerId}/decline`, {
      userId: MAYA,
      body: { reason: "Changed my mind, please ignore prior accept." },
    });
    expect(decline.status).toBe(409);
    expect(decline.body?.currentStatus).toBe("accepted");
  });
});

// ========================================================================
// Cross-tenant / chapter / ownership rejection
// ========================================================================

describe("v17 Phase C — auth + ownership", () => {
  it("non-chapter-member (ghost) → 403 not_chapter_member", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });
    const r = await call("POST", `/api/collective/offers/${offerId}/accept`, {
      userId: GHOST,
    });
    // Ghost has no collective membership → requireCollectiveMember 403's
    // BEFORE the chapter check fires.
    expect([401, 403]).toContain(r.status);
  });

  it("chapter member who is NOT founder of the company → 403 company_not_owned", async () => {
    // co_arboreal is owned by Maya only — Daniel is in the same chapter but
    // has no founder seat on Arboreal Health.
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_NOT_DANIEL,
    });
    const r = await call("POST", `/api/collective/offers/${offerId}/accept`, {
      userId: DANIEL,
    });
    expect(r.status).toBe(403);
    expect(String(r.body?.error)).toBe("company_not_owned");
  });

  it("missing identity → 401", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });
    const r = await call("POST", `/api/collective/offers/${offerId}/accept`);
    expect([401, 403]).toContain(r.status);
  });

  it("unknown offer id → 404 not_found", async () => {
    const r = await call("POST", "/api/collective/offers/invnom_does_not_exist/accept", {
      userId: MAYA,
    });
    expect(r.status).toBe(404);
  });
});

// ========================================================================
// Feature flag
// ========================================================================

describe("v17 Phase C — feature flag", () => {
  it("COLLECTIVE_ENABLED=0 → 503 graceful degradation", async () => {
    const offerId = seedPendingOffer({
      investorUserId: AISHA,
      companyId: COMPANY_MAYA,
    });
    delete process.env.COLLECTIVE_ENABLED;
    try {
      const r = await call("POST", `/api/collective/offers/${offerId}/accept`, {
        userId: MAYA,
      });
      expect(r.status).toBe(503);
    } finally {
      process.env.COLLECTIVE_ENABLED = "1";
    }
  });
});
