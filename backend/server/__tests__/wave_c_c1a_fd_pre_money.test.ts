/**
 * Wave C v26.5.0 — C-1a-min regression coverage
 *
 * Added in response to Opus + GPT-5.6 BLOCK reviews of the first C-1a-min
 * cut. These tests lock in the behavior the reviewers proved was broken:
 *
 *   • Foundation + common: preMoney and fdPreMoneyShares are BOTH null in
 *     the payload; the server accepts (200) without requiring them.
 *   • Foundation + preferred: same rule — the "type=foundation" gate wins
 *     over the instrument's field set. The wizard hides both inputs and
 *     the API creates the round.
 *   • Non-foundation + preferred with preMoney OMITTED → 400 validation_failed
 *     with fieldErrors.preMoney set. (This was the second blocker.)
 *   • Non-foundation + common with fdPreMoneyShares omitted → 400.
 *   • fdPreMoneyShares round-trips through hydrate (write, restart cache,
 *     read back) — locks in the KNOWN_ROUND_FIELDS fix so the extras_json
 *     shadow copy can never win over the real column.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { hydrateRoundsStore, getRoundById } from "../roundsStore";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";

let app: Express;
let server: http.Server;
let port: number;
let userId: string;
let companyId: string;

beforeAll(async () => {
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
  ({ userId } = registerFounderUser({
    email: `wavec_${Date.now()}@test.example`,
    name: "Wave C C1a Founder",
    password: "testpassword123",
  }));
  companyId = `co_wc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: "Wave C Corp",
    legalName: "Wave C Corp, Inc.",
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS",
    stage: "Pre-Seed",
    hq: "US",
  } as any);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** POST helper. */
async function postRound(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        method: "POST",
        hostname: "127.0.0.1",
        port,
        path: "/api/rounds",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-user-id": userId,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed: any = null;
          try { parsed = JSON.parse(raw); } catch { /* leave null */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("Wave C v26.5.0 (Shadie Finding 1a) — Foundation preserved", () => {
  it("foundation + common creates (200) when preMoney and fdPreMoneyShares are omitted", async () => {
    const res = await postRound({
      companyId,
      name: `WaveC Foundation Common ${Date.now()}`,
      type: "foundation",
      instrument: "common",
      // No preMoney, no fdPreMoneyShares — matches the wizard payload for
      // a Foundation round.
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it("foundation + common creates (200) when preMoney and fdPreMoneyShares are EXPLICITLY null", async () => {
    const res = await postRound({
      companyId,
      name: `WaveC Foundation Common Null ${Date.now()}`,
      type: "foundation",
      instrument: "common",
      preMoney: null,
      fdPreMoneyShares: null,
      pricePerShare: "1.50",
      sharesAuthorized: "500000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });

  it("foundation + preferred creates (200) without preMoney/fdPreMoneyShares", async () => {
    const res = await postRound({
      companyId,
      name: `WaveC Foundation Preferred ${Date.now()}`,
      type: "foundation",
      instrument: "preferred",
      targetAmount: "1000000",
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});

describe("Wave C v26.5.0 (Shadie Finding 1a) — Non-foundation priced backstop", () => {
  it("non-foundation preferred without preMoney → 400 validation_failed", async () => {
    const res = await postRound({
      companyId,
      name: `WaveC NoPre Preferred ${Date.now()}`,
      type: "series_a",
      instrument: "preferred",
      targetAmount: "1000000",
      // preMoney intentionally omitted
      fdPreMoneyShares: "5000000",
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.preMoney).toBeTruthy();
  });

  it("non-foundation common without fdPreMoneyShares → 400 validation_failed", async () => {
    const res = await postRound({
      companyId,
      name: `WaveC NoFD Common ${Date.now()}`,
      type: "series_a",
      instrument: "common",
      preMoney: "5000000",
      // fdPreMoneyShares intentionally omitted
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.fdPreMoneyShares).toBeTruthy();
  });

  it("non-foundation preferred with preMoney: '0' → 400 (0 explicitly rejected)", async () => {
    const res = await postRound({
      companyId,
      name: `WaveC ZeroPre Preferred ${Date.now()}`,
      type: "series_a",
      instrument: "preferred",
      targetAmount: "1000000",
      preMoney: "0",
      fdPreMoneyShares: "5000000",
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.preMoney).toBeTruthy();
  });

  it("non-foundation preferred with fractional fdPreMoneyShares → 400 (INTEGER column, no fraction poisoning)", async () => {
    // Opus round-2 MAJ-A: coerceNumeric accepted "1234.567" and stored it verbatim
    // in the INTEGER column. Now we require Number.isInteger.
    const res = await postRound({
      companyId,
      name: `WaveC FracFD ${Date.now()}`,
      type: "series_a",
      instrument: "preferred",
      targetAmount: "1000000",
      preMoney: "5000000",
      fdPreMoneyShares: "1234.567",
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.fdPreMoneyShares).toBeTruthy();
    expect(res.body?.fieldErrors?.fdPreMoneyShares).toMatch(/whole number/i);
  });

  it("priced POST without a type field defaults to seed and rejects missing preMoney (MAJ-B contract‑pin)", async () => {
    // Opus round-2 MAJ-B: a type-less priced POST used to be 200 (roundsStoreCreate
    // defaults to "seed"). Now the backstop also normalises to "seed" so the
    // classification agrees at both call sites. Pin this behavior: the payload
    // below has no type, so the backstop classifies it as non-foundation and
    // rejects for missing preMoney/fdPreMoneyShares.
    const res = await postRound({
      companyId,
      name: `WaveC TypelessPreferred ${Date.now()}`,
      // type intentionally omitted
      instrument: "preferred",
      targetAmount: "1000000",
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.preMoney).toBeTruthy();
    expect(res.body?.fieldErrors?.fdPreMoneyShares).toBeTruthy();
  });

  it("non-foundation preferred WITH preMoney AND fdPreMoneyShares → 200", async () => {
    const res = await postRound({
      companyId,
      name: `WaveC Full Preferred ${Date.now()}`,
      type: "series_a",
      instrument: "preferred",
      targetAmount: "1000000",
      preMoney: "5000000",
      fdPreMoneyShares: "5000000",
      pricePerShare: "1.00",
      sharesAuthorized: "1000000",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});

describe("Wave C v26.5.0 (Shadie Finding 1a) — fdPreMoneyShares round-trips through hydrate", () => {
  it("write, re-hydrate, read back preserves the FD column (KNOWN_ROUND_FIELDS proof)", async () => {
    const roundName = `WaveC Hydrate ${Date.now()}`;
    const created = await postRound({
      companyId,
      name: roundName,
      type: "series_a",
      instrument: "preferred",
      targetAmount: "2000000",
      preMoney: "10000000",
      fdPreMoneyShares: "7777777",
      pricePerShare: "1.28",
      sharesAuthorized: "1562500",
      openDate: "2027-01-01",
      closeDate: "2027-06-01",
    });
    expect(created.status).toBe(200);
    const roundId = created.body?.id as string;
    expect(roundId).toMatch(/^rnd_/);

    // Read the DB row directly (bypasses cache) to confirm the value is on the
    // real column and NOT shadow-copied into extras_json.
    const db = rawDb();
    const row = db
      .prepare(`SELECT fd_pre_money_shares, extras_json FROM rounds WHERE id = ?`)
      .get(roundId) as { fd_pre_money_shares: number | null; extras_json: string | null };
    expect(Number(row.fd_pre_money_shares)).toBe(7777777);
    const extras = row.extras_json ? JSON.parse(row.extras_json) : {};
    expect(extras.fdPreMoneyShares).toBeUndefined();

    // Force a hydrate and confirm the cached Round carries the authoritative value.
    await hydrateRoundsStore();
    const round = getRoundById(roundId);
    expect(round).toBeTruthy();
    expect((round as any).fdPreMoneyShares).toBe(7777777);
  });
});
