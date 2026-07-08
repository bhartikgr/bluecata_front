/**
 * W3-B / W3-C behavior tests — accreditation self-declaration CAPTURE routes
 * and the C-5 individual-membership gate, exercised on the REAL Express app.
 *
 * Coverage:
 *   - POST /api/investor/compliance/accreditation-declaration → 201 + append-only
 *   - GET  same → served clause + accredited/signedCurrent status
 *   - missing signature → 400 SIGNATURE_REQUIRED
 *   - missing criteria  → 400 CRITERIA_REQUIRED
 *   - C-5 gate: active member + on cap table + (soft) → 200
 *              active member + on cap table + strict + not-accredited → 403 ACCREDITATION_NOT_DECLARED
 *              active member + on cap table + strict + accredited → 200
 *              active member + NOT on cap table → 403 not_on_cap_table
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import {
  upsertActiveMembership,
  upsertCapTablePositionForTests,
} from "../membershipStore";
import { rawDb } from "../db/connection";
import { getLatestDeclaration } from "../investorComplianceRoutes";
import { storeCredential } from "../userCredentialsStore";
import { ACCREDITATION_CLAUSE_VERSION } from "@shared/accreditationClause";

let app: Express;
let server: http.Server;
let port: number;

const CAPTURE = "/api/investor/compliance/accreditation-declaration";
const GATED = "/api/collective/companies";

// Synthetic identities used across the suite. Seeding a credential row makes
// getUserContext(x-user-id) resolve them to an authenticated (isAuthed) persona
// in the Vitest harness — otherwise unknown ids 401 at requireAuth.
const TEST_USERS = [
  "u_w3_capture_1", "u_w3_nosig", "u_w3_nocrit",
  "u_w3_nocaptable", "u_w3_soft", "u_w3_strict_deny", "u_w3_strict_allow",
];

beforeAll(async () => {
  for (const uid of TEST_USERS) {
    try {
      storeCredential({ userId: uid, email: `${uid}@example.com`, name: uid, password: "pw-test-123" });
    } catch { /* best-effort seed */ }
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

function countRows(userId: string): number {
  const row = rawDb()
    .prepare(`SELECT COUNT(*) AS n FROM investor_accreditation_declaration WHERE investor_id = ?`)
    .get(userId) as { n: number };
  return row.n;
}

describe("W3-B — accreditation capture routes", () => {
  const uid = "u_w3_capture_1";

  it("GET returns the served clause + not-yet-accredited status", async () => {
    const r = await call("GET", CAPTURE, { userId: uid });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.clause.version).toBe(ACCREDITATION_CLAUSE_VERSION);
    expect(Array.isArray(r.body.clause.criteria)).toBe(true);
    expect(r.body.accredited).toBe(false);
    expect(r.body.declaration).toBeNull();
  });

  it("POST with a signature + criterion records a declaration (201) and flips status", async () => {
    const r = await call("POST", CAPTURE, {
      userId: uid,
      body: { signatureName: "Ada Lovelace", criteria: ["us_income"], jurisdiction: "United States" },
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.declaration.signatureName).toBe("Ada Lovelace");

    const g = await call("GET", CAPTURE, { userId: uid });
    expect(g.body.accredited).toBe(true);
    expect(g.body.signedCurrent).toBe(true);
    expect(g.body.declaration.criteria).toContain("us_income");
  });

  it("is APPEND-ONLY — a re-certification adds a NEW row (latest wins)", async () => {
    const before = countRows(uid);
    const r = await call("POST", CAPTURE, {
      userId: uid,
      body: { signatureName: "Ada L. Lovelace", criteria: ["us_net_worth"] },
    });
    expect(r.status).toBe(201);
    expect(countRows(uid)).toBe(before + 1);
    const latest = getLatestDeclaration(uid);
    expect(latest?.signatureName).toBe("Ada L. Lovelace");
    expect(latest?.criteria).toContain("us_net_worth");
  });

  it("rejects a missing signature with 400 SIGNATURE_REQUIRED", async () => {
    const r = await call("POST", CAPTURE, {
      userId: "u_w3_nosig",
      body: { signatureName: "", criteria: ["us_income"] },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SIGNATURE_REQUIRED");
  });

  it("rejects empty/unknown criteria with 400 CRITERIA_REQUIRED", async () => {
    const r = await call("POST", CAPTURE, {
      userId: "u_w3_nocrit",
      body: { signatureName: "Grace Hopper", criteria: ["not_a_real_criterion"] },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("CRITERIA_REQUIRED");
  });

  it("requires authentication (401 when no identity)", async () => {
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const r = await call("GET", CAPTURE);
      expect([401, 403]).toContain(r.status);
    } finally {
      delete process.env.DISABLE_DEV_BYPASS;
    }
  });
});

describe("W3-C — C-5 gate: cap-table (hard) AND accreditation (soft-flagged)", () => {
  it("active member NOT on a cap table → 403 not_on_cap_table", async () => {
    const uid = "u_w3_nocaptable";
    collectiveMembershipStore.activate(uid, "u_admin");
    // deliberately NO cap-table position seeded
    const r = await call("GET", GATED, { userId: uid });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_on_cap_table");
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });

  it("active member + on cap table + SOFT default (unset) → 200 even without a declaration", async () => {
    const uid = "u_w3_soft";
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    delete process.env.COLLECTIVE_C5_ACCRED_ENFORCE;
    const r = await call("GET", GATED, { userId: uid });
    expect(r.status).toBe(200);
  });

  it("active member + on cap table + STRICT + not-accredited → 403 ACCREDITATION_NOT_DECLARED", async () => {
    const uid = "u_w3_strict_deny";
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    process.env.COLLECTIVE_C5_ACCRED_ENFORCE = "strict";
    try {
      const r = await call("GET", GATED, { userId: uid });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe("ACCREDITATION_NOT_DECLARED");
    } finally {
      delete process.env.COLLECTIVE_C5_ACCRED_ENFORCE;
    }
  });

  it("active member + on cap table + STRICT + accredited (declared) → 200", async () => {
    const uid = "u_w3_strict_allow";
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    // Record a declaration first (soft/default so the POST is admitted).
    const post = await call("POST", CAPTURE, {
      userId: uid,
      body: { signatureName: "Katherine Johnson", criteria: ["us_income"] },
    });
    expect(post.status).toBe(201);
    process.env.COLLECTIVE_C5_ACCRED_ENFORCE = "strict";
    try {
      const r = await call("GET", GATED, { userId: uid });
      expect(r.status).toBe(200);
    } finally {
      delete process.env.COLLECTIVE_C5_ACCRED_ENFORCE;
    }
  });
});
