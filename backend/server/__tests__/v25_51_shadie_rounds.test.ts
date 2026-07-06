/**
 * v25.51 Shadie Rounds fix wave — server-side regression tests.
 *
 * Item 8a (CRITICAL): a COMMON priced round collects only PPS + sharesAuthorized
 * (shared/schema.ts common.fields). Before this wave the client coerced the
 * unused preMoney/targetAmount to "0" and the server hard-required
 * targetAmount>0, so a common round could never be created and the error keys
 * pointed at fields with no on-screen input.
 *
 * Fix (Option B, math-safe): the client omits unused fields (null), and the
 * server DERIVES targetAmount = pricePerShare × sharesAuthorized for common as
 * round metadata. The cap-table engine still commits PPS + sharesAuthorized
 * directly — this test locks that those two values are echoed back BYTE-FOR-BYTE
 * unchanged (the MATH RE-CHECK the build brief requires).
 *
 * Item 3a: server rejects a close-before-open date (existing invalid_closeDate
 * contract) — asserted here so the client-side inline guard has a server backstop.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
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
    email: `sr_${Date.now()}@test.example`,
    name: "Shadie Rounds Founder",
    password: "testpassword123",
  }));
  companyId = `co_sr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  addCompanyForFounder(userId, {
    companyId,
    companyName: "SR Corp",
    legalName: "SR Corp, Inc.",
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
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
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

describe("v25.51 8a — common priced round creation + math safety", () => {
  it("common round with only PPS + shares → 200, targetAmount derived = PPS × shares", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Foundation (Common)",
        type: "foundation",
        instrument: "common",
        pricePerShare: 10,
        sharesAuthorized: 1_000_000,
        // NOTE: the fixed client now omits preMoney/targetAmount for common
        // (sends null). Mirror that here — the phantom "0" is gone.
        preMoney: null,
        targetAmount: null,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(res.body?.id).toBeTruthy();
    // targetAmount is DERIVED from PPS × shares as round metadata.
    expect(Number(res.body?.targetAmount)).toBe(10_000_000);
  });

  it("MATH RE-CHECK — cap-table inputs (PPS + shares) are echoed byte-for-byte unchanged; preMoney absent", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Common Math Guard",
        type: "foundation",
        instrument: "common",
        pricePerShare: 12.5,
        sharesAuthorized: 800_000,
        preMoney: null,
        targetAmount: null,
      },
    });
    expect(res.status).toBe(200);
    // The cap-table engine commits PPS + shares directly. This wave adds ONLY
    // derived targetAmount metadata — it must not perturb these two inputs.
    expect(Number(res.body?.pricePerShare)).toBe(12.5);
    expect(Number(res.body?.sharesAuthorized)).toBe(800_000);
    // Derived target uses exact decimal math: 12.5 × 800,000 = 10,000,000 (no float drift).
    expect(Number(res.body?.targetAmount)).toBe(10_000_000);
    // preMoney stays absent for a manual-PPS common issuance (not a preferred concept).
    expect(res.body?.preMoney == null).toBe(true);
  });

  it("common round still fails closed when PPS is missing (fail-closed on cap-table input)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Bad Common",
        type: "foundation",
        instrument: "common",
        sharesAuthorized: 1_000_000,
        preMoney: null,
        targetAmount: null,
      },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.pricePerShare).toBeTruthy();
  });

  it("preferred round validation UNCHANGED — still requires a user-entered target", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Series A",
        type: "series_a",
        instrument: "preferred",
        preMoney: 4_000_000,
        pricePerShare: 1.25,
        sharesAuthorized: 3_200_000,
        // targetAmount omitted → preferred must still reject (unchanged contract).
        targetAmount: null,
      },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("validation_failed");
    expect(res.body?.fieldErrors?.targetAmount).toBeTruthy();
  });

  it("3a — server rejects close-before-open (backstop for the client inline guard)", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Backwards Dates Common",
        type: "foundation",
        instrument: "common",
        pricePerShare: 5,
        sharesAuthorized: 100_000,
        openDate: "2027-06-01",
        closeDate: "2027-05-01",
        preMoney: null,
        targetAmount: null,
      },
    });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_closeDate");
  });
});

describe("v25.51 6a — founder CRM discrete first/last/company", () => {
  it("POST persists firstName/lastName/companyName and composes name = 'First Last'", async () => {
    const res = await call("POST", "/api/founder/investor-crm", {
      userId,
      body: {
        companyId,
        firstName: "Dana",
        lastName: "Okoro",
        companyName: "Meridian Capital",
        email: "dana@meridian.vc",
        stage: "prospect",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body?.firstName).toBe("Dana");
    expect(res.body?.lastName).toBe("Okoro");
    expect(res.body?.companyName).toBe("Meridian Capital");
    // legacy readers/exports still get a usable name + firmName.
    expect(res.body?.name).toBe("Dana Okoro");
    expect(res.body?.firmName).toBe("Meridian Capital");
  });

  it("GET returns the discrete fields (round-trips through the store)", async () => {
    await call("POST", "/api/founder/investor-crm", {
      userId,
      body: { companyId, firstName: "Wei", lastName: "Chen", email: "wei@fund.io", stage: "prospect" },
    });
    const res = await call("GET", "/api/founder/investor-crm", { userId });
    expect(res.status).toBe(200);
    const found = (res.body as any[]).find((c) => c.email === "wei@fund.io");
    expect(found).toBeTruthy();
    expect(found.firstName).toBe("Wei");
    expect(found.lastName).toBe("Chen");
    // company optional — omitted here, so companyName is null and firmName falls back.
    expect(found.companyName == null).toBe(true);
    expect(found.name).toBe("Wei Chen");
  });
});

describe("v25.51 5a — round initial shareholders discrete first/last/company", () => {
  let roundId: string;

  it("creates a round to attach shareholders to", async () => {
    const res = await call("POST", "/api/rounds", {
      userId,
      body: {
        companyId,
        name: "Initial Shareholders Round",
        type: "foundation",
        instrument: "common",
        pricePerShare: 1,
        sharesAuthorized: 500_000,
        preMoney: null,
        targetAmount: null,
      },
    });
    expect(res.status).toBe(200);
    roundId = res.body?.id;
    expect(roundId).toBeTruthy();
  });

  // NOTE: the initial-shareholders ownership gate resolves the round's company
  // via require("../roundsStore"), which cannot load a .ts module under vitest;
  // it throws and denies. Admin bypasses that gate, so we exercise the
  // persistence path (the subject of 5a) as u_admin. The ownership gate itself
  // is covered by the store's own v25.11 tests.
  it("PATCH persists manual investor first/last/company/email; GET round-trips them", async () => {
    const patch = await call("PATCH", `/api/founder/rounds/${roundId}/initial-shareholders`, {
      userId: "u_admin",
      body: {
        companyId,
        shareholders: [
          {
            name: "Priya Nair",
            firstName: "Priya",
            lastName: "Nair",
            company: "Nair Family Office",
            email: "priya@nairfo.com",
            checkSize: "250000",
            source: "manual",
          },
        ],
      },
    });
    expect(patch.status).toBe(200);
    expect(patch.body?.ok).toBe(true);
    expect(patch.body?.count).toBe(1);

    const get = await call("GET", `/api/founder/rounds/${roundId}/initial-shareholders`, { userId: "u_admin" });
    expect(get.status).toBe(200);
    const sh = (get.body?.shareholders ?? [])[0];
    expect(sh?.firstName).toBe("Priya");
    expect(sh?.lastName).toBe("Nair");
    expect(sh?.company).toBe("Nair Family Office");
    expect(sh?.email).toBe("priya@nairfo.com");
    expect(sh?.source).toBe("manual");
  });
});
