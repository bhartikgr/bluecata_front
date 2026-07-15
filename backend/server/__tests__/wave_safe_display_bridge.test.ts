/**
 * W-SAFE display bridge — GET /api/companies/:id/securities must surface a
 * committed UNPRICED (SAFE) position (mapped from the immutable ledger) so the
 * cap-table "SAFEs + Notes outstanding" card renders it. Priced positions are
 * unaffected (they flow through the existing securities path).
 *
 * This is a READ-path, non-sacred bridge (server/routes.ts). It de-dupes and
 * fails open, so a bridge issue can never break the base securities read.
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

describe("W-SAFE display bridge (GET securities surfaces committed SAFE)", () => {
  it("returns a committed SAFE as an unpriced security row (admin view)", async () => {
    const companyId = `co_bridge_${Date.now()}`;
    const safe = createRound({ companyId, name: `Bridge SAFE ${Date.now()}`, type: "seed", instrument: "safe_post", pricePerShare: null, targetAmount: 500000, extras: { valuationCap: "8000000", discount: "20" } });
    const invitationId = `inv_bridge_${Date.now()}`;
    const res = commitFunded({ invitationId, roundId: safe.id, companyId, investorId: "investor_bridge", amount: "50000", currency: "USD", shares: "0", holderFirstName: "Ada", holderLastName: "Lovelace" });
    expect(res.ok).toBe(true);

    // Admin identity (u_admin) bypasses the founder/investor ownership gate
    // (same persona the sprint25 batch suite uses).
    const r = await get(`/api/companies/${companyId}/securities`, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    const safeRow = r.body.find((s: any) => s.id === `ccm_sec_${invitationId}`);
    expect(safeRow).toBeTruthy();
    expect(safeRow.instrument).toBe("safe");
    expect(safeRow.investmentAmount).toBe(50000);
    expect(safeRow.cap).toBe(8000000);
    expect(safeRow.discount).toBe(20);
    expect(safeRow.shares).toBe(0);
    expect(safeRow.holderName).toBe("Ada Lovelace");
  });
});
