/**
 * WAVE 33 · CP-PIPE-06 — the provenance routes, EXECUTED.
 *
 * WHY THIS FILE EXISTS. Mutation testing of the first provenance harness left
 * three survivors — M5, M18 and M20 — and all three had the SAME root cause:
 * the routes were asserted against their SOURCE and never actually run. A
 * source scan cannot tell the difference between a guard that is present and a
 * guard that is present but unreachable, so `if (false)` in front of a live
 * refusal, an inverted filter and a flipped `includeRevoked` all passed. That
 * is precisely this build's recurring lesson: a check that passed while
 * checking nothing.
 *
 * These handlers are therefore driven over real HTTP with supertest, against
 * the real store, asserting on real response bodies.
 *
 * ON THE AUTH STUB. `requirePartnerAuth` is replaced with a pass-through that
 * injects an EXPLICIT, TEST-OWNED partner id. This is deliberate and bounded:
 *  · the stubbed identity is a fixture created by this file, never a demo
 *    persona (an earlier lesson in this build was a probe that authenticated
 *    as a seeded demo account and therefore proved nothing about real users);
 *  · case (G) separately asserts that the SHIPPED routes are wired to the REAL
 *    middleware, so stubbing it here cannot hide an unauthenticated endpoint.
 *
 * Establishes its own preconditions. Never reads `process.env`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";

const PARTNER_ME = "p_pipe06_exec_me";
const PARTNER_RIVAL = "p_pipe06_exec_rival";

vi.mock("../lib/requirePartnerAuth", () => ({
  requirePartnerAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { partnerContext?: unknown }).partnerContext = {
      partnerId: PARTNER_ME,
      userId: "u_pipe06_exec",
    };
    next();
  },
}));

import { registerAttributionProvenanceRoutes } from "../attributionProvenanceRoutes";
import { partnerAttributionStore } from "../partnerWorkspaceStore";

let app: Express;

const CO_MINE = `co_exec_mine_${Date.now()}`;
const CO_RIVAL = `co_exec_rival_${Date.now()}`;
const CO_FREE = `co_exec_free_${Date.now()}`;
const CO_REVOKED = `co_exec_revoked_${Date.now()}`;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerAttributionProvenanceRoutes(app);

  // Preconditions established here, never assumed to exist.
  partnerAttributionStore.create(PARTNER_ME, CO_MINE, "u_pipe06_exec", "partner_claim", null);
  partnerAttributionStore.create(PARTNER_RIVAL, CO_RIVAL, "u_rival", "partner_claim", null);
  const rev = partnerAttributionStore.create(PARTNER_ME, CO_REVOKED, "u_pipe06_exec", "partner_claim", null);
  partnerAttributionStore.revoke(PARTNER_ME, rev.companyId, "u_pipe06_exec");
});

/* ── (F) THE FIXTURES ─────────────────────────────────────────────────────── */

describe("F — the fixtures this file's conclusions rest on", () => {
  it("F1 the preconditions really landed in the store", () => {
    expect(partnerAttributionStore.listActiveByCompany(CO_MINE).map((a) => a.partnerId)).toEqual([PARTNER_ME]);
    expect(partnerAttributionStore.listActiveByCompany(CO_RIVAL).map((a) => a.partnerId)).toEqual([PARTNER_RIVAL]);
    expect(partnerAttributionStore.listActiveByCompany(CO_FREE)).toEqual([]);
    expect(partnerAttributionStore.listActiveByCompany(CO_REVOKED)).toEqual([]);
  });
});

/* ── (L) THE LIST ROUTE, EXECUTED ─────────────────────────────────────────── */

describe("L — GET /api/partner/me/attributions/provenance", () => {
  it("L1 returns this partner's live attributions", async () => {
    const r = await request(app).get("/api/partner/me/attributions/provenance");
    expect(r.status).toBe(200);
    const ids = r.body.attributions.map((a: { companyId: string }) => a.companyId);
    expect(ids).toContain(CO_MINE);
  });

  it("L2 a REVOKED attribution is not reported as live provenance (kills M20)", async () => {
    /* Found by mutation: flipping `includeRevoked` to true survived every
       source assertion. A revoked claim reported as live would tell a partner
       they hold a company they released. */
    const r = await request(app).get("/api/partner/me/attributions/provenance");
    const ids = r.body.attributions.map((a: { companyId: string }) => a.companyId);
    expect(ids).not.toContain(CO_REVOKED);
  });

  it("L3 another partner's attribution never appears in my list", async () => {
    const r = await request(app).get("/api/partner/me/attributions/provenance");
    const ids = r.body.attributions.map((a: { companyId: string }) => a.companyId);
    expect(ids).not.toContain(CO_RIVAL);
  });

  it("L4 each row carries its provenance integrity verdict and copy", async () => {
    const r = await request(app).get("/api/partner/me/attributions/provenance");
    const row = r.body.attributions.find((a: { companyId: string }) => a.companyId === CO_MINE);
    expect(row).toBeTruthy();
    expect(row.intact).toBe(true);
    expect(typeof row.copy).toBe("string");
    expect(row.copy.length).toBeGreaterThan(40);
    expect(row.selfService).toBe(true); // partner_claim is self-asserted
  });

  it("L5 the summary counts match the rows actually returned", async () => {
    const r = await request(app).get("/api/partner/me/attributions/provenance");
    expect(r.body.total).toBe(r.body.attributions.length);
    expect(r.body.incomplete).toBe(
      r.body.attributions.filter((a: { intact: boolean }) => !a.intact).length,
    );
  });
});

/* ── (P) THE PRE-FLIGHT ROUTE, EXECUTED ───────────────────────────────────── */

describe("P — GET /api/partner/me/attributions/provenance/:companyId", () => {
  it("P1 an unclaimed company is admitted", async () => {
    const r = await request(app).get(`/api/partner/me/attributions/provenance/${CO_FREE}`);
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBe("ADMIT");
    expect(r.body.admit).toBe(true);
    expect(r.body.contested).toBe(false);
  });

  it("P2 a rival's company is REFUSED for a self-service claim", async () => {
    const r = await request(app).get(`/api/partner/me/attributions/provenance/${CO_RIVAL}`);
    expect(r.body.verdict).toBe("REFUSE_ACQUISITION");
    expect(r.body.admit).toBe(false);
    expect(r.body.contested).toBe(true);
  });

  it("P3 MY OWN company is 'already held', NOT a competing claim (kills M18)", async () => {
    /* Found by mutation: widening the pre-flight filter to include the
       partner's own rows survived every source assertion, and would have told
       a partner that their own company was contested by someone else. */
    const r = await request(app).get(`/api/partner/me/attributions/provenance/${CO_MINE}`);
    expect(r.body.verdict).toBe("ADMIT_ALREADY_HELD");
    expect(r.body.contested).toBe(false);
  });

  it("P4 an admin source is admitted against a rival — displacement is adjudicated", async () => {
    const r = await request(app).get(
      `/api/partner/me/attributions/provenance/${CO_RIVAL}?source=admin_manual`,
    );
    expect(r.body.verdict).toBe("ADMIT_ADJUDICATED_DISPLACEMENT");
    expect(r.body.admit).toBe(true);
  });

  it("P5 the response NEVER names the incumbent partner", async () => {
    /* A provenance check must not become a way to enumerate which competitor
       holds which company. */
    const r = await request(app).get(`/api/partner/me/attributions/provenance/${CO_RIVAL}`);
    expect(JSON.stringify(r.body)).not.toContain(PARTNER_RIVAL);
    expect(r.body.incumbentPartnerId).toBeUndefined();
  });

  it("P6 a released (revoked) company is claimable again", async () => {
    const r = await request(app).get(`/api/partner/me/attributions/provenance/${CO_REVOKED}`);
    // The partner's own revoked row is not an incumbent, so this is a fresh claim.
    expect(r.body.admit).toBe(true);
    expect(r.body.contested).toBe(false);
  });

  it("P7 an unrecognised source is refused, not silently defaulted", async () => {
    const r = await request(app).get(
      `/api/partner/me/attributions/provenance/${CO_FREE}?source=whatever`,
    );
    expect(r.body.verdict).toBe("REFUSE_SOURCE_UNKNOWN");
    expect(r.body.admit).toBe(false);
  });

  it("P8 an explicitly EMPTY source is refused as omitted", async () => {
    const r = await request(app).get(
      `/api/partner/me/attributions/provenance/${CO_FREE}?source=`,
    );
    expect(r.body.verdict).toBe("REFUSE_SOURCE_OMITTED");
  });

  it("P9 the pre-flight agrees with what the store will actually do", async () => {
    /* The whole value of a pre-flight is that it cannot promise something the
       write refuses. Both poles are checked against real execution. */
    const rivalPre = await request(app).get(`/api/partner/me/attributions/provenance/${CO_RIVAL}`);
    expect(rivalPre.body.admit).toBe(false);
    expect(() =>
      partnerAttributionStore.create(PARTNER_ME, CO_RIVAL, "u_pipe06_exec", "partner_claim", null),
    ).toThrow(/REFUSE_ACQUISITION/);

    const freePre = await request(app).get(`/api/partner/me/attributions/provenance/${CO_FREE}`);
    expect(freePre.body.admit).toBe(true);
    expect(() =>
      partnerAttributionStore.create(PARTNER_ME, CO_FREE, "u_pipe06_exec", "partner_claim", null),
    ).not.toThrow();
  });
});

/* ── (G) THE STUB CANNOT HIDE AN UNGUARDED ROUTE ──────────────────────────── */

describe("G — the shipped routes use the REAL auth middleware", () => {
  it("G1 both handlers are registered behind requirePartnerAuth", () => {
    /* This file stubs the middleware. Without this case, that stub could hide
       an endpoint that ships with no authentication at all. */
    const src = fs
      .readFileSync("server/attributionProvenanceRoutes.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const gets = src.match(/app\.get\(/g) ?? [];
    const guards = src.match(/requirePartnerAuth,/g) ?? [];
    expect(gets.length).toBe(2);
    expect(guards.length).toBe(2);
    expect(src).toContain('import { requirePartnerAuth } from "./lib/requirePartnerAuth"');
  });

  it("G2 each handler still refuses when no partner context is present", () => {
    // The 401 is inside the handler, not only in the middleware, so a
    // misconfigured mount cannot yield an unscoped read.
    const src = fs.readFileSync("server/attributionProvenanceRoutes.ts", "utf8");
    const hits = src.match(/if \(!partnerId\) return res\.status\(401\)/g) ?? [];
    expect(hits.length).toBe(2);
  });
});

/* ── (A) THE ADMIN ADMISSION ROUTE'S OMISSION GUARD (M5) ──────────────────── */

describe("A — the admin route's omission guard is LIVE, not merely present", () => {
  const src = fs
    .readFileSync("server/partnerRoutes.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("A1 the guard's predicate is the real one, not a disabled branch (kills M5)", () => {
    /* Found by mutation. The earlier assertions checked that the refusal COPY
       existed in the file, which `if (false) { ...copy... }` satisfies
       perfectly — present but unreachable. The predicate itself is now pinned.

       This is a source-level pin rather than an executed one: this handler is
       `requireAdmin`-guarded and reachable only through the full application
       bootstrap, which this file deliberately does not stand up. The
       corresponding STORE-level refusals ARE executed, in
       `wave33_pipe06_provenance.test.ts` group (X). */
    expect(src).toContain(
      'if (source === undefined || source === null || (typeof source === "string" && source.trim() === "")) {',
    );
    expect(src).not.toMatch(/if \(false\) \{\s*return badRequest\(/);
  });

  it("A2 the fabricated default is gone from the whole file", () => {
    expect(src).not.toContain('source ?? "admin_manual"');
  });

  it("A3 sanity pole — this scan can detect a predicate that is genuinely absent", () => {
    expect(src).not.toContain('if (source === "definitely_not_a_real_predicate")');
  });
});
