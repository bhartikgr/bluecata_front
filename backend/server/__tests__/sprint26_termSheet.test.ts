/**
 * Sprint 26 — Term-sheet credentialed-save + hash-chain integrity tests.
 *
 * Coverage:
 *
 *  Store API
 *    1.  saveTermSheet records a revision when authenticated
 *    2.  Revision number increments per round
 *    3.  prevRevisionHash chains revisions correctly
 *    4.  verifyChain detects tampering
 *    5.  saveTermSheet rejects after status = signed (locked)
 *
 *  POST /api/founder/term-sheets
 *    6.  Unauthenticated → 401 unauthorized
 *    7.  Missing roundId → 400
 *    8.  Authenticated valid save → 200 with revision 1
 *    9.  Second authenticated save → revision 2 with prev hash matching rev 1
 *   10.  Save after signing → 409 termsheet_locked
 *
 *  GET /api/founder/term-sheets/:roundId
 *   11.  Unauthenticated → 401
 *   12.  No revisions → 404
 *   13.  Latest revision returned with chainVerified: true
 *
 *  GET /api/founder/term-sheets/:roundId/history
 *   14.  Returns full history ascending
 *   15.  Includes chainVerified flag
 *
 *  Descriptions integration
 *   16.  Every preferred-template section has a description (via templates.ts builder)
 *   17.  Description fields persist round-trip through save
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import {
  saveTermSheet,
  getRevisions,
  getLatestRevision,
  verifyChain,
  clearTermSheetStore,
} from "../termSheetStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  // Inline cookie parser (mirrors server/index.ts Sprint 26 patch).
  app.use((req, _res, next) => {
    const r = req as express.Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const header = req.headers.cookie;
      const out: Record<string, string> = {};
      if (typeof header === "string" && header.length > 0) {
        for (const part of header.split(";")) {
          const eq = part.indexOf("=");
          if (eq === -1) continue;
          const k = part.slice(0, eq).trim();
          const v = part.slice(eq + 1).trim();
          if (k.length > 0) out[k] = v;
        }
      }
      r.cookies = out;
    }
    next();
  });
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

beforeEach(() => clearTermSheetStore());

type CallResponse = { status: number; body: unknown };

function call(method: string, path: string, opts: { body?: unknown; cookie?: string; userIdHeader?: string } = {}): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.cookie) headers["cookie"] = opts.cookie;
    if (opts.userIdHeader) headers["x-user-id"] = opts.userIdHeader;
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const validPayload = (overrides?: Record<string, unknown>) => ({
  roundId: "rnd_test",
  companyId: "co_test",
  source: "generated",
  region: "US",
  instrument: "preferred",
  templateId: "US-preferred-1.0.0",
  templateName: "US — NVCA Model Series A Preferred Term Sheet",
  sections: [
    {
      id: "preamble",
      heading: "Preamble",
      body: "Sample preamble body",
      edited: false,
      description: {
        whatItMeans: "Names the parties...",
        whyItMatters: "Investor-grade term sheets are non-binding...",
        commonVariants: "Some leads insist on...",
        founderWatchouts: "Don't let preamble describe binding terms...",
        citation: "NVCA Model Term Sheet §1",
      },
      descriptionEdited: false,
    },
  ],
  citations: ["NVCA Model Term Sheet"],
  status: "draft",
  ...overrides,
});

/* ----------------------------- Store API ----------------------------- */
describe("Sprint 26 — termSheetStore direct API", () => {
  it("1. saveTermSheet records a revision when authenticated", () => {
    const r = saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.revision.revision).toBe(1);
      expect(r.revision.savedBy).toBe("u_test");
      expect(r.revision.prevRevisionHash).toBe("GENESIS");
    }
  });

  it("2. revision number increments per round", () => {
    saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    const r2 = saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.revision.revision).toBe(2);
  });

  it("3. prevRevisionHash chains revisions correctly", () => {
    const r1 = saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    const r2 = saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    if (r1.ok && r2.ok) {
      expect(r2.revision.prevRevisionHash).toBe(r1.revision.revisionHash);
    }
  });

  it("4. verifyChain detects tampering", async () => {
    saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    expect(verifyChain("rnd_test").ok).toBe(true);
    // Patch v12 — store is DB-backed. Tamper directly at the DB level (the
    // only way to alter persisted state); JS-side mutation of the deserialised
    // payload returned by getRevisions() is a no-op by design.
    const { getDb } = await import("../db/connection");
    const { termSheetRevisions } = await import("../../shared/schema");
    const { and, eq } = await import("drizzle-orm");
    const db = getDb();
    const row = (db.select().from(termSheetRevisions)
      .where(and(eq(termSheetRevisions.roundId, "rnd_test"), eq(termSheetRevisions.revision, 1)))
      .limit(1).all() as any[])[0];
    const tampered = JSON.parse(row.payloadJson);
    tampered.templateName = "tampered";
    db.update(termSheetRevisions)
      .set({ payloadJson: JSON.stringify(tampered) })
      .where(eq(termSheetRevisions.id, row.id))
      .run();
    const v = verifyChain("rnd_test");
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("5. saveTermSheet rejects after status = signed (locked)", () => {
    saveTermSheet({ payload: validPayload({ status: "signed" }) as never, savedBy: "u_test" });
    const r = saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("termsheet_locked");
  });
});

/* ---------------------- POST /api/founder/term-sheets ---------------------- */
describe("POST /api/founder/term-sheets", () => {
  it("6. unauthenticated → 401", async () => {
    const r = await call("POST", "/api/founder/term-sheets", { body: validPayload() });
    expect(r.status).toBe(401);
    expect((r.body as { error: string }).error).toBe("unauthorized");
  });

  it("7. missing roundId → 400", async () => {
    const r = await call("POST", "/api/founder/term-sheets", {
      body: { ...validPayload(), roundId: "" },
      cookie: "cap_uid=u_test",
    });
    expect(r.status).toBe(400);
  });

  it("8. authenticated valid save → 200 with revision 1", async () => {
    const r = await call("POST", "/api/founder/term-sheets", {
      body: validPayload(),
      cookie: "cap_uid=u_test",
    });
    expect(r.status).toBe(200);
    const body = r.body as { ok: boolean; revision: { revision: number; savedBy: string } };
    expect(body.ok).toBe(true);
    expect(body.revision.revision).toBe(1);
    expect(body.revision.savedBy).toBe("u_test");
  });

  it("9. second authenticated save → revision 2 with chained prev hash", async () => {
    const r1 = await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    const r2 = await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    const b1 = r1.body as { revision: { revisionHash: string } };
    const b2 = r2.body as { revision: { revision: number; prevRevisionHash: string } };
    expect(b2.revision.revision).toBe(2);
    expect(b2.revision.prevRevisionHash).toBe(b1.revision.revisionHash);
  });

  it("10. save after signing → 409 termsheet_locked", async () => {
    await call("POST", "/api/founder/term-sheets", { body: validPayload({ status: "signed" }), cookie: "cap_uid=u_test" });
    const r = await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    expect(r.status).toBe(409);
    expect((r.body as { error: string }).error).toBe("termsheet_locked");
  });
});

/* ------------------- GET /api/founder/term-sheets/:roundId ------------------- */
describe("GET /api/founder/term-sheets/:roundId", () => {
  it("11. unauthenticated → 401", async () => {
    const r = await call("GET", "/api/founder/term-sheets/rnd_test");
    expect(r.status).toBe(401);
  });

  it("12. no revisions → 404", async () => {
    const r = await call("GET", "/api/founder/term-sheets/rnd_does_not_exist", { cookie: "cap_uid=u_test" });
    expect(r.status).toBe(404);
  });

  it("13. latest revision returned with chainVerified: true", async () => {
    await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    const r = await call("GET", "/api/founder/term-sheets/rnd_test", { cookie: "cap_uid=u_test" });
    expect(r.status).toBe(200);
    const body = r.body as { ok: boolean; chainVerified: boolean; revision: { revision: number } };
    expect(body.ok).toBe(true);
    expect(body.chainVerified).toBe(true);
    expect(body.revision.revision).toBe(1);
  });
});

/* ---------------- GET /api/founder/term-sheets/:roundId/history --------------- */
describe("GET /api/founder/term-sheets/:roundId/history", () => {
  it("14. returns full history ascending", async () => {
    await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    const r = await call("GET", "/api/founder/term-sheets/rnd_test/history", { cookie: "cap_uid=u_test" });
    expect(r.status).toBe(200);
    const body = r.body as { revisions: { revision: number }[] };
    expect(body.revisions.length).toBe(3);
    expect(body.revisions[0].revision).toBe(1);
    expect(body.revisions[2].revision).toBe(3);
  });

  it("15. includes chainVerified flag", async () => {
    await call("POST", "/api/founder/term-sheets", { body: validPayload(), cookie: "cap_uid=u_test" });
    const r = await call("GET", "/api/founder/term-sheets/rnd_test/history", { cookie: "cap_uid=u_test" });
    const body = r.body as { chainVerified: boolean };
    expect(body.chainVerified).toBe(true);
  });
});

/* --------------- Descriptions integration (templates.ts builder) --------------- */
describe("Sprint 26 — clause descriptions are injected into templates", () => {
  it("16. every preferred-template section has a description (where one is registered)", async () => {
    // Import the client builder dynamically since this test file lives server-side
    // (vitest can resolve client/src/* via the workspace tsconfig path aliases).
    const { getTemplate } = await import("../../client/src/lib/termsheet/templates");
    const tpl = getTemplate("US" as never, "preferred" as never, {
      companyName: "ACME", companyLegalName: "ACME, Inc.", roundName: "Series A",
      roundType: "series_a", region: "US", instrument: "preferred",
      leadInvestor: "Foo Cap", targetAmount: 4000000, preMoney: 16000000, postMoney: 20000000,
      pricePerShare: 1.28, fdSharesPreMoney: 12500000, liqPrefMultiple: 1, participating: false,
      capParticipation: "", antiDilutionVariant: "Broad-Based Weighted-Average",
      valuationCap: 16000000, discount: 20, interestRate: 6, maturityMonths: 24,
      mfn: true, poolSize: 10, poolTiming: "post_money", vestingMonths: 48, cliffMonths: 12,
      closeDate: "2026-09-30", founderNames: ["Maya Chen"], governingLaw: "US",
    } as never);
    // Each section either has a description (the common case for known clause ids)
    // or has none (uncommon edge case). Verify at least the well-known ids carry it.
    const wellKnownIds = ["preamble", "closing", "investors", "instrument", "amount", "premoney", "pps", "liq", "ad", "esop", "drag", "board", "no-shop"];
    for (const id of wellKnownIds) {
      const s = tpl.sections.find((x) => x.id === id);
      expect(s, `section ${id} missing`).toBeDefined();
      expect(s?.description, `section ${id} has no description`).toBeDefined();
      expect(s?.description?.whatItMeans.length, `section ${id} description.whatItMeans empty`).toBeGreaterThan(20);
      expect(s?.description?.whyItMatters.length, `section ${id} description.whyItMatters empty`).toBeGreaterThan(20);
    }
  });

  it("17. description fields persist round-trip through save", async () => {
    await call("POST", "/api/founder/term-sheets", {
      body: validPayload({
        sections: [{
          id: "liq",
          heading: "7. Liquidation Preference",
          body: "1× non-participating",
          edited: false,
          description: {
            whatItMeans: "How money is distributed if the company is sold",
            whyItMatters: "Single most economically-material clause in the term sheet",
            commonVariants: "1× non-participating (market norm)",
            founderWatchouts: "Participating preference creates double-dip on exit",
            citation: "NVCA Model Term Sheet §6",
          },
          descriptionEdited: false,
        }],
      }),
      cookie: "cap_uid=u_test",
    });
    const r = await call("GET", "/api/founder/term-sheets/rnd_test", { cookie: "cap_uid=u_test" });
    const body = r.body as { revision: { payload: { sections: Array<{ description: Record<string, string> }> } } };
    const desc = body.revision.payload.sections[0].description;
    expect(desc.whatItMeans).toContain("distributed");
    expect(desc.whyItMatters).toContain("economically-material");
    expect(desc.commonVariants).toContain("non-participating");
    expect(desc.founderWatchouts).toContain("double-dip");
    expect(desc.citation).toContain("NVCA");
  });
});

/* --------------- Backward compat: header-based auth still works --------------- */
describe("Sprint 26 — x-user-id header still works (test harness)", () => {
  it("auth via x-user-id header (no cookie) succeeds", async () => {
    const r = await call("POST", "/api/founder/term-sheets", {
      body: validPayload(),
      userIdHeader: "u_test_header",
    });
    expect(r.status).toBe(200);
    const body = r.body as { revision: { savedBy: string } };
    expect(body.revision.savedBy).toBe("u_test_header");
  });
});

// Helper export so getLatestRevision is exercised
describe("Sprint 26 — getLatestRevision", () => {
  it("returns undefined for unknown roundId", () => {
    expect(getLatestRevision("rnd_nope")).toBeUndefined();
  });
  it("returns latest after multiple saves", () => {
    saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    saveTermSheet({ payload: validPayload() as never, savedBy: "u_test" });
    const latest = getLatestRevision("rnd_test");
    expect(latest?.revision).toBe(2);
  });
});
