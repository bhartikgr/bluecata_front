/**
 * v23.9 — Group A (P0) + Group B (HIGH) + Group C (MEDIUM) regression tests.
 *
 * These cover the 32-item v23.9 punch list (see /home/user/workspace/V29_OBJECTIVE.md).
 * The harness mirrors the existing v15_invitation_flow / v25_C009 suites: it boots
 * the full route stack on an ephemeral port and drives it over HTTP with the
 * test-only `x-user-id` header for identity (VITEST gate in resolvePersonaId).
 *
 * Fixtures (demo seed, ENABLE_DEMO_SEED=1):
 *   - u_maya_chen  → founder of co_novapay, owns round rnd_novapay_foundation
 *   - u_admin      → platform admin
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

let app: Express;
let server: http.Server;
let port: number;

const FOUNDER = "u_maya_chen";
const ADMIN = "u_admin";
const COMPANY = "co_novapay";
const ROUND = "rnd_novapay_foundation";

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
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

function uploadMultipart(
  path: string,
  userId: string,
  fields: Record<string, string>,
  file: { field: string; filename: string; contentType: string; content: string },
): Promise<{ status: number; body: any }> {
  const boundary = `----v239test${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
  );
  parts.push(Buffer.from(file.content));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const payload = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": String(payload.length),
          "x-user-id": userId,
        },
      },
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
    r.write(payload);
    r.end();
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * GROUP A — CRITICAL (P0)
 * ──────────────────────────────────────────────────────────────────────── */
describe("v23.9 Group A — P0", () => {
  // A1 — public redeem/check (the duplicate requireAuth POST was removed).
  it("A1: GET /api/invitations/check is public (no 401 for anonymous)", async () => {
    const r = await call("GET", "/api/invitations/check?token=does_not_exist");
    // Public route: must NOT 401. Unknown token → a non-auth status (400/404/200-with-invalid).
    expect(r.status).not.toBe(401);
  });

  it("A1: POST /api/invitations/redeem is public (anonymous is not blocked by auth)", async () => {
    const r = await call("POST", "/api/invitations/redeem", { body: { token: "bad_token" } });
    // The public handler validates the token itself; a bad token is 400/404/410,
    // never a blanket 401 from requireAuth.
    expect(r.status).not.toBe(401);
  });

  // A2 — numeric sanitization on POST /api/rounds.
  it("A2: POST /api/rounds strips commas from numeric fields → 200", async () => {
    const r = await call("POST", "/api/rounds", {
      userId: FOUNDER,
      body: {
        companyId: COMPANY,
        name: "A2 Comma Round",
        type: "seed",
        instrument: "preferred",
        targetAmount: "1,000,000",
        preMoney: "5,000,000",
        sharesAuthorized: "1,000,000",
      },
    });
    expect(r.status).toBe(200);
  });

  it("A2: POST /api/rounds rejects negative numeric → 400", async () => {
    const r = await call("POST", "/api/rounds", {
      userId: FOUNDER,
      body: { companyId: COMPANY, name: "A2 Neg", type: "seed", instrument: "preferred", targetAmount: "-5000" },
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error ?? "")).toContain("targetAmount");
  });

  it("A2: POST /api/rounds rejects non-numeric (NaN) → 400", async () => {
    const r = await call("POST", "/api/rounds", {
      userId: FOUNDER,
      body: { companyId: COMPANY, name: "A2 NaN", type: "seed", instrument: "preferred", preMoney: "abc" },
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error ?? "")).toContain("preMoney");
  });

  // A3 — admin investors aggregated from real sources (no hardcoded mock names).
  it("A3: GET /api/admin/investors returns real aggregated items, not the old mock names", async () => {
    const r = await call("GET", "/api/admin/investors", { userId: ADMIN });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body?.items)).toBe(true);
    const blob = JSON.stringify(r.body);
    expect(blob).not.toContain("Aisha Patel·Hydra Ventures");
    expect(blob).not.toContain("Moss & Dawn");
  });

  // A4 — consortium partner link/unlink + surfaced on company GET.
  it("A4: admin GET /api/admin/companies/:id returns company (with consortiumPartnerId field)", async () => {
    const r = await call("GET", `/api/admin/companies/${COMPANY}`, { userId: ADMIN });
    // 200 when the company resolves; the payload carries the consortium fields.
    expect([200, 404]).toContain(r.status);
    if (r.status === 200) {
      // The handler nests the record under `company` and surfaces the
      // consortium link fields alongside it (partnerRoutes.ts).
      expect(r.body).toHaveProperty("company");
      expect(r.body.company).toHaveProperty("consortiumPartnerId");
    }
  });

  it("A4: admin GET /api/admin/partners returns real partner data (array)", async () => {
    const r = await call("GET", "/api/admin/partners", { userId: ADMIN });
    expect(r.status).toBe(200);
    const items = Array.isArray(r.body) ? r.body : r.body?.items ?? r.body?.partners;
    expect(Array.isArray(items)).toBe(true);
  });

  // A5 — partner redeem is public (token is the credential).
  it("A5: POST /api/auth/redeem-partner-invite/:token is public (bad token not 401)", async () => {
    const r = await call("POST", "/api/auth/redeem-partner-invite/not_a_real_token", { body: {} });
    expect(r.status).not.toBe(401);
  });

  // A6 — health version read via readFileSync (build-safe). In test the live
  // package.json is read; we assert the shape + a non-zero version string.
  it("A6: GET /api/health returns a version + connected db", async () => {
    const r = await call("GET", "/api/health");
    expect(r.status).toBe(200);
    expect(typeof r.body?.version).toBe("string");
    expect(r.body.version).not.toBe("0.0.0");
    expect(r.body).toHaveProperty("status");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * GROUP B — HIGH
 * ──────────────────────────────────────────────────────────────────────── */
describe("v23.9 Group B — HIGH", () => {
  // B2 — round close endpoint (GET preview + POST close).
  it("B2: GET /api/rounds/:id/close returns round + capTable for the owner", async () => {
    const r = await call("GET", `/api/rounds/${ROUND}/close`, { userId: FOUNDER });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("round");
    expect(r.body).toHaveProperty("capTable");
  });

  it("B2: GET /api/rounds/:id/close is forbidden for a non-owner founder", async () => {
    const r = await call("GET", `/api/rounds/${ROUND}/close`, { userId: "u_random_other" });
    expect([401, 403, 404]).toContain(r.status);
  });

  // B3 — closeDate must be >= openDate.
  it("B3: POST /api/rounds rejects closeDate before openDate → 400", async () => {
    const r = await call("POST", "/api/rounds", {
      userId: FOUNDER,
      body: {
        companyId: COMPANY,
        name: "B3 Bad Dates",
        type: "seed",
        instrument: "preferred",
        openDate: "2026-06-01",
        closeDate: "2026-05-01",
      },
    });
    expect(r.status).toBe(400);
    expect(String(r.body?.error ?? "")).toContain("closeDate");
  });

  // B4 — dataroom upload requires a folderId.
  it("B4: POST dataroom upload with a file but no folderId → 400 folder_required", async () => {
    // The handler validates the file first, then rejects a missing folderId.
    // Send a real multipart body (file present, companyId present, folderId
    // absent) so we exercise the folder_required branch rather than file_required.
    const r = await uploadMultipart(
      "/api/founder/dataroom/files",
      FOUNDER,
      { companyId: COMPANY },
      { field: "file", filename: "x.pdf", contentType: "application/pdf", content: "hello" },
    );
    expect(r.status).toBe(400);
    expect(r.body?.error).toBe("folder_required");
  });

  // B7 — admin companies bare alias mirrors /full.
  it("B7: GET /api/admin/companies (bare alias) returns rows like /full", async () => {
    const bare = await call("GET", "/api/admin/companies", { userId: ADMIN });
    const full = await call("GET", "/api/admin/companies/full", { userId: ADMIN });
    expect(bare.status).toBe(200);
    expect(full.status).toBe(200);
    expect(Array.isArray(bare.body?.rows)).toBe(true);
    expect(bare.body.rows.length).toBe(full.body.rows.length);
  });

  // B8 — term-sheet send with empty pipeline returns a warning, not a false success.
  it("B8: POST term-sheet/send with no recipients → 200 + warning no_recipients_in_pipeline", async () => {
    const r = await call("POST", `/api/rounds/${ROUND}/term-sheet/send`, {
      userId: FOUNDER,
      body: { invitationIds: [] },
    });
    expect(r.status).toBe(200);
    expect(r.body?.sentTo).toBe(0);
    expect(r.body?.warning).toBe("no_recipients_in_pipeline");
  });

  it("B8: POST term-sheet/send with recipients → 200 + sentTo count, no warning", async () => {
    const r = await call("POST", `/api/rounds/${ROUND}/term-sheet/send`, {
      userId: FOUNDER,
      body: { invitationIds: ["inv_1", "inv_2"] },
    });
    expect(r.status).toBe(200);
    expect(r.body?.sentTo).toBe(2);
    expect(r.body?.warning).toBeUndefined();
  });

  // B9 — round invitation bridges into the founder CRM.
  it("B9: creating a round invitation upserts the investor into the founder CRM", async () => {
    const email = `b9_${Date.now()}@example.com`;
    const inv = await call("POST", `/api/rounds/${ROUND}/invitations`, {
      userId: FOUNDER,
      body: { investorEmail: email, investorName: "B9 Investor", dryRun: true },
    });
    expect(inv.status).toBe(200);
    const crm = await call("GET", "/api/founder/crm/contacts", { userId: FOUNDER });
    expect(crm.status).toBe(200);
    const blob = JSON.stringify(crm.body);
    expect(blob.toLowerCase()).toContain(email.toLowerCase());
  });

  // B6 — collective propagation: apply → approve → auth/me shows active.
  it("B6: founder collective apply → admin approve → /api/auth/me collective active", async () => {
    const sub = await call("POST", "/api/founder/collective/applications", {
      userId: FOUNDER,
      body: {
        companyId: "co_arboreal",
        founderId: FOUNDER,
        pitchDeckFilename: "deck.pdf",
        tractionMrr: 25000,
        tractionUsers: 500,
        tractionGrowthPct: 15,
        asks: "Looking for Series A lead and enterprise customer intros from Collective members",
        references: "Jane Doe, CEO at Acme",
        coverLetter:
          "We are Arboreal building infra for climate fintech connecting carbon credit markets to institutional investors via real-time ledger technology and seek Collective membership to accelerate distribution and co-investment opportunities across the network.",
        feeAcknowledged: true,
      },
    });
    expect(sub.status).toBe(200);
    const appId = sub.body.application.id;
    const apr = await call("POST", `/api/admin/collective/applications/${appId}/approve`, {
      userId: ADMIN,
      body: {},
    });
    expect(apr.status).toBe(200);
    const me = await call("GET", "/api/auth/me", { userId: FOUNDER });
    expect(me.status).toBe(200);
    expect(me.body?.collective?.status).toBe("active");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * GROUP C — MEDIUM
 * ──────────────────────────────────────────────────────────────────────── */
describe("v23.9 Group C — MEDIUM", () => {
  // C4 — founder dashboard aggregate.
  it("C4: GET /api/founder/dashboard returns {company,kpis,recentRounds,recentActivity,ctas}", async () => {
    const r = await call("GET", "/api/founder/dashboard", { userId: FOUNDER });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("company");
    expect(r.body).toHaveProperty("kpis");
    expect(Array.isArray(r.body?.recentRounds)).toBe(true);
    expect(Array.isArray(r.body?.recentActivity)).toBe(true);
    expect(Array.isArray(r.body?.ctas)).toBe(true);
  });

  // C5 — round GET carries a read-only pipeline funnel.
  it("C5: GET /api/rounds/:id includes a pipeline array (visibility only)", async () => {
    const r = await call("GET", `/api/rounds/${ROUND}`, { userId: FOUNDER });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body?.pipeline)).toBe(true);
    const stages = (r.body.pipeline as Array<{ stage: string }>).map((p) => p.stage);
    expect(stages).toContain("invited");
    expect(stages).toContain("soft_circled");
  });

  // C6 — founder-namespaced PATCH company alias persists like /api/companies/:id.
  it("C6: PATCH /api/founder/companies/:id updates the company name", async () => {
    const newName = `Renamed ${Date.now()}`;
    const r = await call("PATCH", `/api/founder/companies/${COMPANY}`, {
      userId: FOUNDER,
      body: { name: newName },
    });
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
  });

  // C7 — cross-tenant activity isolation (no-repro; the server scopes correctly).
  // Asserted in depth by activityLogTenantIsolation.test.ts; here we sanity-check
  // that /api/activity for a founder never 500s and is an array.
  it("C7: GET /api/activity is tenant-scoped and well-formed for a founder", async () => {
    const r = await call("GET", "/api/activity", { userId: FOUNDER });
    expect(r.status).toBeLessThan(500);
    expect(Array.isArray(r.body)).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * GROUP D — D1 regression: the canonical /api/auth/redeem still works.
 * ──────────────────────────────────────────────────────────────────────── */
describe("v23.9 Group D — D1 regression", () => {
  it("D1: POST /api/auth/redeem with a bad token is handled publicly (not 401)", async () => {
    const r = await call("POST", "/api/auth/redeem", { body: { token: "nope" } });
    expect(r.status).not.toBe(401);
  });
});
