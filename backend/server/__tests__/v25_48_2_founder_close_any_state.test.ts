/**
 * v25.48.2 Q13 (Ozan) — founder can INITIATE a round close from ANY
 * non-terminal state, and un-confirmed (open soft-circle) commitments are
 * lapsed on finalize while confirmed ones are preserved.
 *
 * Drives the REAL routes via supertest:
 *   - POST /api/founder/rounds/:id/close   (close from draft / soft_circle_open)
 *   - GET  /api/founder/rounds/:id/pending-commitments  (warning preview)
 *
 * Sacred cap-table/ledger math is untouched — the lapse is a PARALLEL module
 * (server/lib/roundClosePendingLapse.ts) writing only the soft_circles.status.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { createSoftCircle, getSoftCircle } from "../softCircleStore";
import { getRoundById } from "../roundsStore";

let app: Express;
const CO = `co_q13_${Date.now()}`;
const ADMIN = "u_admin";

async function createDraftRound(name: string, extra: Record<string, unknown> = {}, companyId: string = CO): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send({ companyId, name, type: "seed", state: "draft", targetAmount: 1_000_000, ...extra });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  return res.body.id as string;
}

// v25.48.2 MF5/MF6 — failure-injection tests deliberately leave a round open
// (the rolled-back close). Give each its OWN company so the one-open-round guard
// (now enforced on soft_circle_open) can't bleed across tests.
const uniqueCo = (tag: string) => `co_q13_${tag}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

describe("v25.48.2 Q13 — founder close from any state + pending-commitment lapse", () => {
  it("closes a round straight from draft (any non-terminal state), and is idempotent", async () => {
    const roundId = await createDraftRound("Q13 draft close");

    const close = await request(app)
      .post(`/api/founder/rounds/${roundId}/close`)
      .set("x-user-id", ADMIN)
      .send({ reason: "founder_initiated" });
    expect(close.status).toBe(200);
    expect(close.body.ok).toBe(true);
    expect(close.body.alreadyClosed).toBe(false);
    expect(close.body.round.state).toBe("closed");

    // Idempotent: closing again is a no-op that reports alreadyClosed.
    const again = await request(app)
      .post(`/api/founder/rounds/${roundId}/close`)
      .set("x-user-id", ADMIN)
      .send({ reason: "founder_initiated" });
    expect(again.status).toBe(200);
    expect(again.body.ok).toBe(true);
    expect(again.body.alreadyClosed).toBe(true);
  });

  it("lapses un-confirmed soft-circles on close while preserving confirmed ones", async () => {
    const roundId = await createDraftRound("Q13 soft-circle close");

    // Move into soft_circle_open (still non-terminal).
    const open = await request(app)
      .patch(`/api/founder/rounds/${roundId}`)
      .set("x-user-id", ADMIN)
      .send({ state: "soft_circle_open" });
    expect(open.status).toBe(200);

    // Two un-confirmed (intent) and one confirmed commitment.
    const intentA = createSoftCircle({ roundId, companyId: CO, investorName: "Pending A", amount: 50_000, status: "intent" });
    const intentB = createSoftCircle({ roundId, companyId: CO, investorName: "Pending B", amount: 25_000, status: "intent" });
    const confirmed = createSoftCircle({ roundId, companyId: CO, investorName: "Signed C", amount: 100_000, status: "confirmed" });

    // Warning preview reports exactly the two un-confirmed commitments.
    const preview = await request(app)
      .get(`/api/founder/rounds/${roundId}/pending-commitments`)
      .set("x-user-id", ADMIN);
    expect(preview.status).toBe(200);
    expect(preview.body.count).toBe(2);

    // Finalize with lapsePending — the two intent rows lapse, confirmed is kept.
    const close = await request(app)
      .post(`/api/founder/rounds/${roundId}/close`)
      .set("x-user-id", ADMIN)
      .send({ reason: "founder_initiated", lapsePending: true });
    expect(close.status).toBe(200);
    expect(close.body.ok).toBe(true);
    expect(close.body.lapsedCommitments).toBe(2);

    expect(getSoftCircle(intentA.id)?.status).toBe("lapsed");
    expect(getSoftCircle(intentB.id)?.status).toBe("lapsed");
    expect(getSoftCircle(confirmed.id)?.status).toBe("confirmed");

    // Preview after close is empty (idempotent — nothing left to lapse).
    const previewAfter = await request(app)
      .get(`/api/founder/rounds/${roundId}/pending-commitments`)
      .set("x-user-id", ADMIN);
    expect(previewAfter.status).toBe(200);
    expect(previewAfter.body.count).toBe(0);
  });

  // v25.48.2 MF5 — close + pending-lapse are ONE atomic transaction. If the
  // lapse write fails, the round MUST remain NON-terminal (not closed) and the
  // response is 500. Injection: temporarily remove soft_circles so the lapse
  // read/write throws inside the close transaction.
  it("lapse failure rolls back the whole close (round stays non-terminal, 500)", async () => {
    const co = uniqueCo("mf5");
    const roundId = await createDraftRound("Q13 MF5 atomic", {}, co);
    await request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN).send({ state: "soft_circle_open" });
    const intent = createSoftCircle({ roundId, companyId: co, investorName: "MF5 pending", amount: 40_000, status: "intent" });

    const db = rawDb();
    db.prepare(`ALTER TABLE soft_circles RENAME TO soft_circles_mf5_bak`).run();
    try {
      const close = await request(app)
        .post(`/api/founder/rounds/${roundId}/close`)
        .set("x-user-id", ADMIN)
        .send({ reason: "founder_initiated", lapsePending: true });
      expect(close.status).toBe(500);
      expect(close.body.ok).toBeFalsy();
    } finally {
      db.prepare(`ALTER TABLE soft_circles_mf5_bak RENAME TO soft_circles`).run();
    }

    // Round is still NON-terminal (the close rolled back).
    const round = getRoundById(roundId);
    expect(round?.state).toBe("soft_circle_open");
    // The intent commitment is untouched (not lapsed).
    expect(getSoftCircle(intent.id)?.status).toBe("intent");
  });

  // v25.48.2 MF6 — the per-row audit append is part of the transaction's success
  // criteria. If the audit fails, the whole lapse + close rolls back. Injection:
  // remove audit_log so appendAdminAudit returns its empty-hash sentinel, which
  // the lapse treats as a hard failure and throws.
  it("audit-append failure rolls back the whole close (round non-terminal, commitments unchanged, 500)", async () => {
    const co = uniqueCo("mf6");
    const roundId = await createDraftRound("Q13 MF6 audit atomic", {}, co);
    await request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN).send({ state: "soft_circle_open" });
    const intent = createSoftCircle({ roundId, companyId: co, investorName: "MF6 pending", amount: 60_000, status: "intent" });

    const db = rawDb();
    db.prepare(`ALTER TABLE audit_log RENAME TO audit_log_mf6_bak`).run();
    try {
      const close = await request(app)
        .post(`/api/founder/rounds/${roundId}/close`)
        .set("x-user-id", ADMIN)
        .send({ reason: "founder_initiated", lapsePending: true });
      expect(close.status).toBe(500);
      expect(close.body.ok).toBeFalsy();
    } finally {
      db.prepare(`ALTER TABLE audit_log_mf6_bak RENAME TO audit_log`).run();
    }

    // Round non-terminal; the intent row was NOT lapsed (rolled back with the close).
    const round = getRoundById(roundId);
    expect(round?.state).toBe("soft_circle_open");
    expect(getSoftCircle(intent.id)?.status).toBe("intent");
  });

  // v25.48.2 MF-B — the `round.closed` audit append is part of the close
  // transaction's SUCCESS CRITERIA for the NO-PENDING-ROWS path too (where the
  // per-row lapse hook appends nothing, so round.closed was previously the only
  // audit and ran post-tx in fail-open mode). SUCCESS: a plain close (no pending
  // commitments) closes the round AND leaves a durable round.closed audit row.
  it("MF-B: no-pending close writes a durable round.closed audit row", async () => {
    const co = uniqueCo("mfb_ok");
    const roundId = await createDraftRound("MFB no-pending success", {}, co);

    const close = await request(app)
      .post(`/api/founder/rounds/${roundId}/close`)
      .set("x-user-id", ADMIN)
      .send({ reason: "founder_initiated" });
    expect(close.status).toBe(200);
    expect(close.body.ok).toBe(true);
    expect(close.body.round.state).toBe("closed");

    // A round.closed audit row for THIS round must exist (written inside the tx).
    const rows = rawDb()
      .prepare(`SELECT id, payload_json FROM audit_log WHERE action = 'round.closed' AND payload_json LIKE ?`)
      .all(`%${roundId}%`) as Array<{ id: string; payload_json: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.payload_json.includes(roundId))).toBe(true);
  });

  // v25.48.2 MF-B — FAILURE INJECTION on the NO-PENDING path: with no pending
  // commitments, remove audit_log so the round.closed append returns its
  // empty-hash sentinel → treated as a hard failure that rolls back the whole
  // close. The round MUST remain NON-terminal and the response is 500. This is
  // the exact fail-open gap MF-B closes (previously the append was post-tx).
  it("MF-B: no-pending close rolls back when the round.closed audit fails (round non-terminal, 500)", async () => {
    const co = uniqueCo("mfb_fail");
    const roundId = await createDraftRound("MFB no-pending audit atomic", {}, co);

    const db = rawDb();
    db.prepare(`ALTER TABLE audit_log RENAME TO audit_log_mfb_bak`).run();
    try {
      const close = await request(app)
        .post(`/api/founder/rounds/${roundId}/close`)
        .set("x-user-id", ADMIN)
        .send({ reason: "founder_initiated" });
      expect(close.status).toBe(500);
      expect(close.body.ok).toBeFalsy();
    } finally {
      db.prepare(`ALTER TABLE audit_log_mfb_bak RENAME TO audit_log`).run();
    }

    // Round is still NON-terminal (the close rolled back with the failed audit).
    const round = getRoundById(roundId);
    expect(round?.state).toBe("draft");
  });

  // v25.48.2 MF6 — the preview must FAIL CLOSED on a read error (not report a
  // false zero that would suppress the founder warning). Injection: remove
  // soft_circles so the pending lookup throws → 503 degraded, blocking close.
  it("pending-commitments preview fails closed (503) on a read error", async () => {
    const roundId = await createDraftRound("Q13 MF6 preview fail-closed", {}, uniqueCo("mf6p"));
    const db = rawDb();
    db.prepare(`ALTER TABLE soft_circles RENAME TO soft_circles_mf6p_bak`).run();
    try {
      const preview = await request(app)
        .get(`/api/founder/rounds/${roundId}/pending-commitments`)
        .set("x-user-id", ADMIN);
      expect(preview.status).toBe(503);
      expect(preview.body.error).toBe("PENDING_LOOKUP_FAILED");
      expect(preview.body.degraded).toBe(true);
    } finally {
      db.prepare(`ALTER TABLE soft_circles_mf6p_bak RENAME TO soft_circles`).run();
    }
  });
});
