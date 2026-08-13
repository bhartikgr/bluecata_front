/**
 * W-CAP (2026-07-17) — cap-table display fix.
 *
 * PART 1: GET /api/companies/:id/securities must surface a committed PRICED
 *         (equity) position projected from the immutable ledger (companion to
 *         the W-SAFE unpriced bridge). Root cause: priced committed positions
 *         were never bridged into the `securities` display model.
 * PART 2: GET /api/companies/:id/captable/interim returns three separately-typed
 *         arrays (committed / funded / soft_circle) with per-kind subtotals that
 *         are NEVER blended together, and enforces the same ownership guard.
 *
 * Both are READ-path, non-sacred, fail-open bridges (server/routes.ts). The
 * sacred money ledger (captableCommitStore) is only READ, never written.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { clearLedger, commitFunded } from "../captableCommitStore";
import { createRound } from "../roundsStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 30_000);

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => { clearLedger(); });

function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let data = ""; res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }); } catch { resolve({ status: res.statusCode ?? 0, body: data }); } });
    });
    req.on("error", reject); req.end();
  });
}

/** Commit a priced/equity position into the sacred ledger for a fresh company. */
function commitPriced(companyId: string) {
  const round = createRound({
    companyId,
    name: `Priced Seed ${Date.now()}`,
    type: "seed",
    instrument: "priced_equity",
    pricePerShare: 2.5,
    targetAmount: 1_000_000,
  });
  const invitationId = `inv_px_${Date.now()}`;
  const res = commitFunded({
    invitationId,
    roundId: round.id,
    companyId,
    investorId: "investor_px",
    amount: "50000",
    currency: "USD",
    shares: "20000",
    holderFirstName: "Grace",
    holderLastName: "Hopper",
  });
  expect(res.ok).toBe(true);
  return { round, invitationId };
}

describe("W-CAP Part 1 — priced ledger->display bridge (GET securities)", () => {
  it("surfaces a committed PRICED position as a security row", async () => {
    const companyId = `co_px_${Date.now()}`;
    const { invitationId } = commitPriced(companyId);

    const r = await get(`/api/companies/${companyId}/securities`, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const row = r.body.find((s: any) => s.id === `ccm_pxsec_${invitationId}`);
    expect(row).toBeTruthy();
    expect(row.holderType).toBe("investor");
    expect(row.instrument).toBe("preferred");
    expect(row.investmentAmount).toBe(50000);
    expect(row.shares).toBe(20000);
    expect(row.holderName).toBe("Grace Hopper");
  });
});

describe("W-CAP Part 2 — interim (pro-forma) endpoint", () => {
  it("returns three typed arrays with separate per-kind subtotals", async () => {
    const companyId = `co_int_${Date.now()}`;
    commitPriced(companyId);

    const r = await get(`/api/companies/${companyId}/captable/interim`, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    expect(r.body.companyId).toBe(companyId);
    expect(Array.isArray(r.body.committed)).toBe(true);
    expect(Array.isArray(r.body.funded)).toBe(true);
    expect(Array.isArray(r.body.soft_circle)).toBe(true);
    // The committed priced position appears in the committed array only.
    expect(r.body.committed.length).toBe(1);
    expect(r.body.committed[0].kind).toBe("committed");
    expect(r.body.committed[0].amount).toBe(50000);
    // Subtotals are present and per-kind.
    expect(r.body.subtotals.committed.count).toBe(1);
    expect(r.body.subtotals.committed.amount).toBe(50000);
    expect(r.body.subtotals.funded.count).toBe(0);
    expect(r.body.subtotals.soft_circle.count).toBe(0);
  });

  it("never blends funded/soft_circle amounts into the committed subtotal", async () => {
    const companyId = `co_blend_${Date.now()}`;
    commitPriced(companyId);

    const r = await get(`/api/companies/${companyId}/captable/interim`, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    const { committed, funded, soft_circle } = r.body.subtotals;
    // Committed total equals ONLY the committed rows — funded/soft never added in.
    expect(committed.amount).toBe(50000);
    expect(funded.amount).toBe(0);
    expect(soft_circle.amount).toBe(0);
  });

  it("rejects an unauthenticated request (ownership guard)", async () => {
    const companyId = `co_guard_${Date.now()}`;
    const r = await get(`/api/companies/${companyId}/captable/interim`);
    /* WAVE 35 · F9 — the refusal shape for a caller with NO relationship to the
       company changed from 403 to 404 on purpose. A 403 distinguishes "this id
       exists but you may not have it" from "this id does not exist", which lets
       an authenticated investor enumerate valid company ids — including SPV
       ids, which are the private vehicles. `GET /api/companies/:id` already
       stated that policy ("so we don't even leak the existence of the company
       id"); its three siblings now match. 401 remains correct for a caller with
       no identity at all. */
    expect([401, 404]).toContain(r.status);
    expect([403]).not.toContain(r.status);
  });

  it("does not leak another company's committed positions", async () => {
    const companyA = `co_a_${Date.now()}`;
    const companyB = `co_b_${Date.now()}`;
    commitPriced(companyA);

    // Admin can read either; company B has no positions of its own.
    const r = await get(`/api/companies/${companyB}/captable/interim`, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    expect(r.body.committed.length).toBe(0);
  });
});
