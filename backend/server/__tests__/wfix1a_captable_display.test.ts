/**
 * W-FIX1a (2026-07-19) — cap-table + activity DISPLAY resolution (A1 + A2).
 *
 * A1: /securities and /captable/interim must resolve a friendly investor name,
 *     email, a human round NAME, and committed ownership %, and must NEVER leak a
 *     raw `u_…` / `rnd_…` id (redeemed/synthetic holders with no stored name).
 * A2: the central activity/entity label resolver never emits a raw
 *     `u_…` / `company:co_…` / `rnd_…` id.
 *
 * Read-path only; the sacred money ledger is READ, never written.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { clearLedger, commitFunded } from "../captableCommitStore";
import { createRound } from "../roundsStore";
import { resolveHolderDisplay, resolveRoundName, computeOwnershipPct } from "../lib/captableDisplayResolver";
import { resolveActorLabel, resolveEntityLabel } from "../lib/activityLabelResolver";

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

/** Commit a priced position with NO stored holder name (redeemed/synthetic). */
function commitPricedNoName(companyId: string) {
  const round = createRound({
    companyId, name: `Series A ${Date.now()}`, type: "seed",
    instrument: "priced_equity", pricePerShare: 2.5, targetAmount: 1_000_000,
  });
  const invitationId = `inv_nn_${Date.now()}`;
  const res = commitFunded({
    invitationId, roundId: round.id, companyId,
    investorId: `u_redeemed_${Date.now()}`, amount: "50000", currency: "USD", shares: "20000",
    // NOTE: no holderFirstName / holderLastName — this is the A1 leak path.
  });
  expect(res.ok).toBe(true);
  return { round, invitationId };
}

describe("A1 — captableDisplayResolver (pure)", () => {
  it("prefers ledger name split when present", () => {
    expect(resolveHolderDisplay("u_x", "Grace", "Hopper").name).toBe("Grace Hopper");
  });
  it("never returns a raw u_ id as a name", () => {
    const d = resolveHolderDisplay("u_redeemed_123", null, null);
    expect(d.name).not.toMatch(/^u_/);
    expect(d.name).toBe("Investor (pending profile)");
  });
  it("resolveRoundName falls back to a short label, never a bare rnd_ id", () => {
    const nm = resolveRoundName("rnd_deadbeef00");
    expect(nm).not.toBe("rnd_deadbeef00");
    expect(nm.startsWith("Round ")).toBe(true);
  });
  it("computeOwnershipPct returns null on a zero basis, else a percentage", () => {
    expect(computeOwnershipPct(10, 0)).toBeNull();
    expect(computeOwnershipPct(25, 100)).toBe(25);
  });
});

describe("A2 — activityLabelResolver (pure)", () => {
  it("resolveEntityLabel never leaks a company:co_ id", () => {
    const label = resolveEntityLabel("company:co_a2e5ca95c358");
    expect(label).not.toMatch(/co_/);
    expect(label.length).toBeGreaterThan(0);
  });
  it("resolveEntityLabel never leaks a raw rnd_ id", () => {
    expect(resolveEntityLabel("rnd_11b11cd4ce0d")).not.toMatch(/^rnd_/);
  });
  it("resolveActorLabel never leaks a raw u_ id", () => {
    expect(resolveActorLabel("u_founder_1782301936139_9tqnpg")).not.toMatch(/^u_/);
  });
  it("passes through an already-friendly label", () => {
    expect(resolveEntityLabel("Series A")).toBe("Series A");
  });
});

describe("A1 — /securities + /interim resolution (integration)", () => {
  it("securities row shows a friendly name + round name, never a raw id", async () => {
    const companyId = `co_nn_${Date.now()}`;
    const { invitationId } = commitPricedNoName(companyId);
    const r = await get(`/api/companies/${companyId}/securities`, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    const row = r.body.find((s: any) => s.id === `ccm_pxsec_${invitationId}`);
    expect(row).toBeTruthy();
    expect(row.holderName).not.toMatch(/^u_/);
    expect(row.holderName).toBe("Investor (pending profile)");
    expect(typeof row.roundName).toBe("string");
    expect(row.roundName).not.toMatch(/^rnd_/);
    expect("holderEmail" in row).toBe(true);
  });

  it("interim committed row carries roundName + ownershipPct + holderEmail; no raw id", async () => {
    const companyId = `co_int_nn_${Date.now()}`;
    commitPricedNoName(companyId);
    const r = await get(`/api/companies/${companyId}/captable/interim`, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    expect(r.body.committed.length).toBe(1);
    const row = r.body.committed[0];
    expect(row.holderName).not.toMatch(/^u_/);
    expect(row.roundName).not.toMatch(/^rnd_/);
    expect("holderEmail" in row).toBe(true);
    // Single holder => 100% of committed basis.
    expect(row.ownershipPct).toBe(100);
  });
});
