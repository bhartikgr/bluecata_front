/**
 * v25.48.2 Q4c (Ozan) — ONE-OPEN-ROUND hard block.
 *
 * A company may have only ONE open (active/live) PRICED/primary round at a
 * time. Activating a second priced round while one is already open MUST be
 * refused with 409. Warrant + ESOP/option-pool rounds are EXEMPT: they may
 * coexist with an open priced round (and with each other).
 *
 * The guard is a PARALLEL route-layer check on the REAL PATCH
 * /api/founder/rounds/:id route (the sacred cap-table/ledger math is
 * untouched). This drives that real route via supertest:
 *
 *   - open round A (priced)                       → 200
 *   - open round B (priced) while A is open        → 409 ANOTHER_ROUND_ALREADY_OPEN
 *   - open a warrant round while A is open          → 200 (exempt)
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";

let app: Express;
const CO = `co_q4c_${Date.now()}`;
const ADMIN = "u_admin";

async function createDraftRound(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send({ companyId: CO, name, type: "seed", state: "draft", targetAmount: 1_000_000, ...extra });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  return res.body.id as string;
}

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

describe("v25.48.2 Q4c — one-open-round hard block", () => {
  it("opens round A (priced) → 200; opens round B (priced) while A open → 409; opens a warrant → 200", async () => {
    const roundA = await createDraftRound("Round A priced");
    const roundB = await createDraftRound("Round B priced");
    const roundC = await createDraftRound("Round C warrant");

    // A: first priced round activates cleanly.
    const openA = await request(app)
      .patch(`/api/founder/rounds/${roundA}`)
      .set("x-user-id", ADMIN)
      .send({ state: "active" });
    expect(openA.status).toBe(200);
    expect(openA.body.ok).toBe(true);
    expect(openA.body.round.state).toBe("active");

    // B: a second priced round while A is open is refused.
    const openB = await request(app)
      .patch(`/api/founder/rounds/${roundB}`)
      .set("x-user-id", ADMIN)
      .send({ state: "active" });
    expect(openB.status).toBe(409);
    expect(openB.body.error).toBe("ANOTHER_ROUND_ALREADY_OPEN");
    expect(openB.body.openRoundId).toBe(roundA);

    // C: a warrant round is EXEMPT and may open alongside A.
    const openC = await request(app)
      .patch(`/api/founder/rounds/${roundC}`)
      .set("x-user-id", ADMIN)
      .send({ state: "active", instrument: "warrant" });
    expect(openC.status).toBe(200);
    expect(openC.body.ok).toBe(true);
    expect(openC.body.round.state).toBe("active");
  });

  it("an ESOP/option-pool round is also exempt (opens alongside an open priced round)", async () => {
    const esop = await createDraftRound("ESOP pool", { type: "option_pool" });
    const res = await request(app)
      .patch(`/api/founder/rounds/${esop}`)
      .set("x-user-id", ADMIN)
      .send({ state: "active" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // v25.48.2 MF4 — the check-and-activate is now ATOMIC (one DB transaction).
  // Two activations for a company that starts with NO open priced round: the
  // FIRST wins (200), the SECOND is refused (409). No in-memory fallback: the
  // conflict re-check runs against committed DB state inside the update tx.
  it("two activations for the same fresh company: first 200, second 409 (atomic)", async () => {
    const company = `co_mf4_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    async function draft(name: string): Promise<string> {
      const r = await request(app)
        .post("/api/rounds")
        .set("x-user-id", ADMIN)
        .send({ companyId: company, name, type: "seed", state: "draft", targetAmount: 500_000 });
      expect(r.status).toBe(200);
      return r.body.id as string;
    }
    const r1 = await draft("MF4 first");
    const r2 = await draft("MF4 second");

    const a1 = await request(app).patch(`/api/founder/rounds/${r1}`).set("x-user-id", ADMIN).send({ state: "active" });
    const a2 = await request(app).patch(`/api/founder/rounds/${r2}`).set("x-user-id", ADMIN).send({ state: "active" });

    const statuses = [a1.status, a2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refused = a1.status === 409 ? a1 : a2;
    expect(refused.body.error).toBe("ANOTHER_ROUND_ALREADY_OPEN");
  });

  // v25.48.2 MF4 — closing the open priced round frees the slot so ANOTHER
  // priced round may then open (close→reopen works; activating the first is
  // never a 409 against itself).
  it("close-then-open-another: after closing the open round a new priced round opens (200)", async () => {
    const company = `co_mf4reopen_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    async function draft(name: string): Promise<string> {
      const r = await request(app)
        .post("/api/rounds")
        .set("x-user-id", ADMIN)
        .send({ companyId: company, name, type: "seed", state: "draft", targetAmount: 500_000 });
      expect(r.status).toBe(200);
      return r.body.id as string;
    }
    const first = await draft("reopen first");
    const second = await draft("reopen second");

    const openFirst = await request(app).patch(`/api/founder/rounds/${first}`).set("x-user-id", ADMIN).send({ state: "active" });
    expect(openFirst.status).toBe(200);

    // Second is blocked while first is open.
    const blocked = await request(app).patch(`/api/founder/rounds/${second}`).set("x-user-id", ADMIN).send({ state: "active" });
    expect(blocked.status).toBe(409);

    // Close the first, then the second may open.
    const close = await request(app).post(`/api/founder/rounds/${first}/close`).set("x-user-id", ADMIN).send({ reason: "done" });
    expect(close.status).toBe(200);

    const openSecond = await request(app).patch(`/api/founder/rounds/${second}`).set("x-user-id", ADMIN).send({ state: "active" });
    expect(openSecond.status).toBe(200);
    expect(openSecond.body.round.state).toBe("active");
  });
});
