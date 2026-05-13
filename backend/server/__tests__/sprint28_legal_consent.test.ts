/**
 * Sprint 28 Legal — Consent ledger tests.
 *
 * Test areas:
 *   1. POST without auth → 401
 *   2. POST with auth → records consent for each docId; returns recorded array
 *   3. POST idempotent — same (userId, docId, version) twice → existing record, chain unchanged
 *   4. POST different doc by same user → chain extends
 *   5. GET /mine returns only calling user's records
 *   6. GET /admin/legal/consents → admin only; non-admin → 403
 *   7. Bridge event legal_consent.recorded fires on new record (not on idempotent re-record)
 *   8. verifyChain across whole store
 *   9. ALL_OUTBOUND_EVENT_TYPES.length === 40
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import http from "node:http";

import {
  registerLegalConsentRoutes,
  recordConsent,
  getConsentsForUser,
  getAllConsents,
  verifyChain,
  _testLegalConsent,
} from "../legalConsentStore";

import { ALL_OUTBOUND_EVENT_TYPES, getOutbox, _testBridge } from "../bridgeStore";

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function req(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const reqHeaders: Record<string, any> = {
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
        ...(headers ?? {}),
      };
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers: reqHeaders },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on("end", () => {
            server.close();
            const buf = Buffer.concat(chunks).toString("utf8");
            try {
              resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: buf });
            }
          });
        },
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

// ─── App factory ─────────────────────────────────────────────────────────────

function makeApp() {
  const app = express();
  app.use(express.json());
  registerLegalConsentRoutes(app);
  return app;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("Sprint 28 Legal / legalConsentStore", () => {
  beforeEach(() => {
    _testLegalConsent.reset();
    _testBridge.resetChain();
  });

  // ── 1. POST without auth → 401 ─────────────────────────────────────────────
  it("POST /api/legal/consent without auth → 401", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/legal/consent", {
      documentIds: ["privacy"],
      context: "signup",
    });
    expect(r.status).toBe(401);
    expect(r.body.ok).toBe(false);
  });

  // ── 2. POST with auth → records all docIds ─────────────────────────────────
  it("POST /api/legal/consent records all documentIds", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["privacy", "terms", "acceptable-use"], context: "signup" },
      { "x-user-id": "u_maya_chen" },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.recorded)).toBe(true);
    expect(r.body.recorded.length).toBe(3);
    // Each returned id starts with "lc_"
    for (const id of r.body.recorded) {
      expect(id).toMatch(/^lc_/);
    }
    // User now has 3 consents
    const consents = getConsentsForUser("u_maya_chen");
    expect(consents.length).toBe(3);
    expect(consents.map((c) => c.documentId).sort()).toEqual(["acceptable-use", "privacy", "terms"]);
  });

  // ── 3. POST idempotent ─────────────────────────────────────────────────────
  it("POST idempotent — same (userId, docId, version) twice does not extend chain", async () => {
    const app = makeApp();
    // First record
    const r1 = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["privacy"], context: "signup" },
      { "x-user-id": "u_maya_chen" },
    );
    expect(r1.status).toBe(200);
    const id1 = r1.body.recorded[0];

    const chainLengthAfterFirst = getAllConsents().length;

    // Second record (idempotent)
    const r2 = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["privacy"], context: "signup" },
      { "x-user-id": "u_maya_chen" },
    );
    expect(r2.status).toBe(200);
    const id2 = r2.body.recorded[0];

    // Same id returned
    expect(id2).toBe(id1);
    // Chain did not grow
    expect(getAllConsents().length).toBe(chainLengthAfterFirst);
  });

  // ── 4. POST different doc extends chain ────────────────────────────────────
  it("POST different doc by same user extends the hash chain", async () => {
    const app = makeApp();
    await req(app, "POST", "/api/legal/consent", { documentIds: ["privacy"], context: "signup" }, { "x-user-id": "u_maya_chen" });
    const before = getAllConsents().length;

    await req(app, "POST", "/api/legal/consent", { documentIds: ["terms"], context: "signup" }, { "x-user-id": "u_maya_chen" });
    const after = getAllConsents().length;

    expect(after).toBe(before + 1);
  });

  // ── 5. GET /mine returns only calling user's records ───────────────────────
  it("GET /api/legal/consent/mine returns only the calling user's records", async () => {
    const app = makeApp();
    // User A records consent
    await req(app, "POST", "/api/legal/consent", { documentIds: ["privacy", "terms"], context: "signup" }, { "x-user-id": "u_maya_chen" });
    // User B records consent
    await req(app, "POST", "/api/legal/consent", { documentIds: ["disclaimer"], context: "settings_update" }, { "x-user-id": "u_aisha_patel" });

    // User A mine
    const rA = await req(app, "GET", "/api/legal/consent/mine", undefined, { "x-user-id": "u_maya_chen" });
    expect(rA.status).toBe(200);
    expect(rA.body.consents.length).toBe(2);
    expect(rA.body.consents.every((c: any) => c.userId === "u_maya_chen")).toBe(true);

    // User B mine
    const rB = await req(app, "GET", "/api/legal/consent/mine", undefined, { "x-user-id": "u_aisha_patel" });
    expect(rB.status).toBe(200);
    expect(rB.body.consents.length).toBe(1);
    expect(rB.body.consents[0].documentId).toBe("disclaimer");
  });

  it("GET /api/legal/consent/mine without auth → 401", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/legal/consent/mine");
    expect(r.status).toBe(401);
  });

  // ── 6. Admin endpoint ──────────────────────────────────────────────────────
  it("GET /api/admin/legal/consents requires admin", async () => {
    const app = makeApp();
    // Non-admin user
    const r = await req(app, "GET", "/api/admin/legal/consents", undefined, { "x-user-id": "u_maya_chen" });
    expect(r.status).toBe(403);
  });

  it("GET /api/admin/legal/consents returns all records for admin", async () => {
    const app = makeApp();
    // Seed some records
    await req(app, "POST", "/api/legal/consent", { documentIds: ["privacy", "terms"], context: "signup" }, { "x-user-id": "u_maya_chen" });
    await req(app, "POST", "/api/legal/consent", { documentIds: ["cookies"], context: "settings_update" }, { "x-user-id": "u_aisha_patel" });

    const r = await req(app, "GET", "/api/admin/legal/consents", undefined, { "x-user-id": "u_admin" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.total).toBe(3);
    expect(Array.isArray(r.body.rows)).toBe(true);
    expect(r.body.rows.length).toBe(3);
  });

  it("GET /api/admin/legal/consents without auth → 401", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/legal/consents");
    expect(r.status).toBe(401);
  });

  // ── 7. Bridge event ────────────────────────────────────────────────────────
  it("bridge event legal_consent.recorded fires on new record, not on idempotent re-record", async () => {
    const app = makeApp();
    const outboxBefore = getOutbox().length;

    // First record — should fire bridge event
    await req(app, "POST", "/api/legal/consent", { documentIds: ["privacy"], context: "signup" }, { "x-user-id": "u_maya_chen" });
    const outboxAfterFirst = getOutbox().length;
    expect(outboxAfterFirst).toBe(outboxBefore + 1);
    expect(getOutbox()[outboxAfterFirst - 1].envelope.eventType).toBe("legal_consent.recorded");

    // Idempotent re-record — should NOT fire another bridge event
    await req(app, "POST", "/api/legal/consent", { documentIds: ["privacy"], context: "signup" }, { "x-user-id": "u_maya_chen" });
    expect(getOutbox().length).toBe(outboxAfterFirst);
  });

  // ── 8. Hash chain integrity ────────────────────────────────────────────────
  it("verifyChain passes after multiple records", async () => {
    const app = makeApp();
    await req(app, "POST", "/api/legal/consent", { documentIds: ["privacy", "terms", "cookies"], context: "signup" }, { "x-user-id": "u_maya_chen" });
    await req(app, "POST", "/api/legal/consent", { documentIds: ["acceptable-use"], context: "new_company" }, { "x-user-id": "u_aisha_patel" });
    await req(app, "POST", "/api/legal/consent", { documentIds: ["disclaimer"], context: "settings_update" }, { "x-user-id": "u_admin" });

    const result = verifyChain();
    expect(result.ok).toBe(true);
    expect(result.brokenAt).toBe(-1);
  });

  it("verifyChain passes on empty ledger", () => {
    const result = verifyChain();
    expect(result.ok).toBe(true);
  });

  // ── 9. ALL_OUTBOUND_EVENT_TYPES.length === 40 ──────────────────────────────
  it("ALL_OUTBOUND_EVENT_TYPES.length === 41", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES.length).toBe(48);
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("legal_consent.recorded");
    // Deduplication check
    expect(new Set(ALL_OUTBOUND_EVENT_TYPES).size).toBe(ALL_OUTBOUND_EVENT_TYPES.length);
  });

  // ── Store-level unit tests ─────────────────────────────────────────────────
  it("recordConsent returns isNew=true on first call, isNew=false on idempotent repeat", () => {
    const r1 = recordConsent({ userId: "u_test", documentId: "privacy", context: "signup", ipAddress: null, userAgent: null });
    expect(r1.isNew).toBe(true);
    expect(r1.consent.id).toMatch(/^lc_/);

    const r2 = recordConsent({ userId: "u_test", documentId: "privacy", context: "signup", ipAddress: null, userAgent: null });
    expect(r2.isNew).toBe(false);
    expect(r2.consent.id).toBe(r1.consent.id);
  });

  it("consent record has all required fields", () => {
    const { consent } = recordConsent({ userId: "u_test", documentId: "terms", context: "onboarding", ipAddress: "127.0.0.1", userAgent: "TestAgent/1.0" });
    expect(consent.id).toMatch(/^lc_/);
    expect(consent.userId).toBe("u_test");
    expect(consent.documentId).toBe("terms");
    expect(consent.context).toBe("onboarding");
    expect(consent.acceptedAt).toBeTruthy();
    expect(consent.ipAddress).toBe("127.0.0.1");
    expect(consent.userAgent).toBe("TestAgent/1.0");
    expect(consent.prevHash).toBeTruthy();
    expect(consent.hash).toBeTruthy();
    expect(consent.hash).not.toBe(consent.prevHash);
    expect(consent.documentVersion).toBeTruthy();
  });

  it("POST with invalid documentId → 400", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["not-a-real-doc"], context: "signup" },
      { "x-user-id": "u_maya_chen" },
    );
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  });

  it("POST with invalid context → 400", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: ["privacy"], context: "invalid_context" },
      { "x-user-id": "u_maya_chen" },
    );
    expect(r.status).toBe(400);
  });

  it("POST with empty documentIds → 400", async () => {
    const app = makeApp();
    const r = await req(
      app,
      "POST",
      "/api/legal/consent",
      { documentIds: [], context: "signup" },
      { "x-user-id": "u_maya_chen" },
    );
    expect(r.status).toBe(400);
  });
});
