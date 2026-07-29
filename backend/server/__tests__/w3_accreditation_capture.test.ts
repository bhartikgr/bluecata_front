/**
 * W3-B / W3-C behavior tests — accreditation self-declaration CAPTURE routes
 * and the C-5 individual-membership gate, exercised on the REAL Express app.
 *
 * Coverage:
 *   - POST /api/investor/compliance/accreditation-declaration → 201 + append-only
 *   - GET  same → served clause + accredited/signedCurrent status
 *   - missing signature → 400 SIGNATURE_REQUIRED
 *   - missing criteria  → 400 CRITERIA_REQUIRED
 *   - C-5 gate: active member + on cap table + profile-grace → 200 (no declaration row)
 *              active member + on cap table + nothing on file → 403 ACCREDITATION_DECLARATION_REQUIRED
 *              active member + on cap table + declared → 200
 *              active member + NOT on cap table → 403 not_on_cap_table
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRIAGE (a) STALE TEST — the two C-5 accreditation cases encoded a retired
 * contract, in the same two ways as the sibling `w3_c5_gate_unit.test.ts`:
 *
 * 1. RETIRED FEATURE FLAG. They drove a SOFT/STRICT dual mode via
 *    `COLLECTIVE_C5_ACCRED_ENFORCE`. That env var no longer exists anywhere in
 *    product code — `requireCollectiveMember.ts` step 4 reads it zero times and
 *    has no branch on it. The accreditation sub-check is now UNCONDITIONAL
 *    first-sign-on capture, so setting/unsetting the var changed nothing and the
 *    "SOFT default ⇒ admitted without a declaration" premise was false.
 *
 * 2. RETIRED ERROR CODE. `ACCREDITATION_NOT_DECLARED` exists nowhere in product
 *    code. It was deliberately split so the client can distinguish a transient
 *    read failure from a genuine missing declaration:
 *      • ACCREDITATION_STATUS_UNAVAILABLE   (read failed — retryable)
 *      • ACCREDITATION_DECLARATION_REQUIRED (none on file — go declare)
 *
 * WHY THE PRODUCT IS RIGHT (so this is (a), not (b)): the deny is not a dead
 * end. It carries `requiresAccreditationDeclaration: true` + `declarationEndpoint`,
 * and `CollectiveMemberGate.tsx:250` branches on that flag to render
 * `collective/CollectiveAccreditationBlocker.tsx`, which posts the declaration
 * and re-enters. A designed capture handshake, not a lost flag.
 *
 * NO CASE WAS DROPPED (4 → 4, both assertions preserved in kind):
 *   • The old "SOFT ⇒ 200 without a declaration" case KEEPS its 200 assertion
 *     AND its "without a declaration" character — it now earns admission through
 *     the product's real no-declaration admit path: the profile grace route
 *     (`getAccreditationGateStatus` Rule 2, `source: "profile"`), which exists
 *     precisely for investors accredited before the capture path shipped. The
 *     test asserts the declaration table is still EMPTY for that user, so the
 *     original "even without a declaration" guarantee is tested, not weakened.
 *   • The old "STRICT + not-accredited ⇒ 403" case KEEPS its 403 deny assertion,
 *     re-pointed at the live code, and additionally pins the actionable payload.
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
import { spvEngineStore } from "../spvEngineStore";
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

describe("W3-C — C-5 gate: cap-table (hard) AND accreditation (unconditional capture)", () => {
  it("active member NOT on a cap table → 403 not_on_cap_table", async () => {
    const uid = "u_w3_nocaptable";
    collectiveMembershipStore.activate(uid, "u_admin");
    // deliberately NO cap-table position seeded
    const r = await call("GET", GATED, { userId: uid });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("not_on_cap_table");
    collectiveMembershipStore.deactivate(uid, "u_admin");
  });

  it("active member + on cap table + profile grace → 200 even without a declaration", async () => {
    const uid = "u_w3_soft";
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    // The product's real "admitted without a declaration" path: an investor whose
    // compliance profile already reads verified is never asked to re-declare
    // (getAccreditationGateStatus Rule 2 → source "profile"). This is what the
    // retired SOFT default used to stand in for.
    spvEngineStore.upsertComplianceProfile(uid, { accreditationStatus: "verified" });

    const r = await call("GET", GATED, { userId: uid });
    expect(r.status).toBe(200);
    // The original guarantee — admitted with NO declaration row — still holds.
    expect(getLatestDeclaration(uid)).toBeNull();
    expect(countRows(uid)).toBe(0);
  });

  it("active member + on cap table + nothing on file → 403 ACCREDITATION_DECLARATION_REQUIRED", async () => {
    const uid = "u_w3_strict_deny";
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);

    const r = await call("GET", GATED, { userId: uid });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("ACCREDITATION_DECLARATION_REQUIRED");
    // The deny must be resolvable by the user — that is what makes unconditional
    // enforcement a capture handshake rather than a lockout.
    expect(r.body.requiresAccreditationDeclaration).toBe(true);
    expect(r.body.declarationEndpoint).toBe(CAPTURE);
  });

  it("active member + on cap table + accredited (declared) → 200", async () => {
    const uid = "u_w3_strict_allow";
    upsertActiveMembership(uid);
    upsertCapTablePositionForTests(uid);
    // The capture route is not itself gated on accreditation, so the declaration
    // can always be recorded from a blocked state.
    const post = await call("POST", CAPTURE, {
      userId: uid,
      body: { signatureName: "Katherine Johnson", criteria: ["us_income"] },
    });
    expect(post.status).toBe(201);

    const r = await call("GET", GATED, { userId: uid });
    expect(r.status).toBe(200);
  });
});
