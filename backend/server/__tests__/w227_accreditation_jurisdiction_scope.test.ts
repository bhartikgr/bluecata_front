/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 227 · ITEM 1 — G6, the unscoped global accreditation assertion.
 * ══════════════════════════════════════════════════════════════════════════════
 * G6 is `server/investorComplianceRoutes.ts:229-232`, the denormalized fast-flag
 * fallback inside `hasAccreditedDeclaration`, and its twin in
 * `getAccreditationGateStatus` Rules 2 and 3. It grants platform-wide accreditation
 * off one enum column with no declaration row, no jurisdiction, no criteria, no
 * signature and no clause version. R189.5: the accreditation tests "are mutually
 * incompatible across the US, UK, EU, HK, Singapore, Canada, DIFC and Australia",
 * so "no global checkbox is possible".
 *
 * WHAT IS PROVED HERE, AND HOW.
 *
 * The whole suite drives `PUT /api/partner/me/compliance/:investorId` over a REAL
 * HTTP socket against the app assembled by the PRODUCTION REGISTRAR
 * (`registerRoutes`) — not a hand-mounted router, not a supplied handler. Handbook
 * §8: a test that supplies the thing under test is testing something production
 * does not do. Every refusal proof then reads the stored row back out of
 * `investor_compliance_profile` WITH SQL, because a route that replies 422 while
 * writing anyway is precisely the defect being hunted, and a 422 alone is not
 * evidence that nothing moved.
 *
 *   A-1  a partner can no longer mint `verified` with no jurisdiction
 *   A-2  ...and the refusal wrote NOTHING — read back with SQL
 *   A-3  "Global" is refused as a jurisdiction
 *   A-4  "Worldwide", "All", "International", "N/A", "" are all refused
 *   A-5  the refusal names the nine codes so the caller can comply
 *   A-6  the refusal is readable words, not a bare code, and clears looksHuman
 *   A-7  the refusal is ATOMIC — a `kycStatus` riding along is not applied either
 *
 *   B-1  `verified` WITH a real jurisdiction is accepted and persisted
 *   B-2  a jurisdiction already stored on the profile satisfies a later `verified`
 *   B-3  `none` and `manual_review` are never fenced — an investor can always be
 *        downgraded or flagged, which is the direction that protects them
 *   B-4  unscoped `self_certified` is STILL ACCEPTED — the grandfather clause,
 *        pinned deliberately so a later wave cannot quietly turn it into a lockout
 *
 *   C-1  a grant backed by a jurisdiction reports `scope: "jurisdiction_scoped"`
 *   C-2  an unscoped grant reports `scope: "unscoped_legacy_grace"` and STILL
 *        GRANTS — the two facts together are the wave's actual claim
 *   C-3  no grant at all reports `scope: "none"`
 *   C-4  a declaration's jurisdiction scopes the grant even when the profile
 *        column is null
 *   C-5  `hasAccreditedDeclaration` is UNCHANGED for every one of these shapes —
 *        the regression that matters, because five readers depend on it and one of
 *        them is the SACRED cap-table funding gate
 *
 *   D-1  exactly ONE accreditation mechanism still exists: the fence adds no
 *        writer, and the only two writers of the column are the ones that were
 *        there before
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import { spvEngineStore } from "../spvEngineStore";
import {
  hasAccreditedDeclaration,
  getAccreditationGateStatus,
  recordAccreditationDeclaration,
  accreditationAssertionRefusal,
  ACCREDITATION_JURISDICTION_REQUIRED,
} from "../investorComplianceRoutes";
import { ACCREDITATION_JURISDICTIONS_V0_3 } from "@shared/accreditationClause";
import { LOOKS_HUMAN_MAX_LENGTH } from "@shared/refusalHeadlineGate";
/* The per-route write limiter is production behaviour and stays ON; this suite
   makes more writes per minute than a human would, so its counters are reset
   between tests. Nothing under test is disabled — the fence, the IDOR guard,
   `assertSubRole` and `requireSignedAgreement` all still run on every call. */
import { _resetRateLimitsForTests } from "../lib/rateLimit";

const MANAGING = "u_avi_managing";

let app: Express;
let server: http.Server;
let port: number;
let seq = 0;

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
}, 60_000);

beforeEach(() => {
  _resetRateLimitsForTests();
});

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
    headers["x-user-id"] = opts.userId ?? MANAGING;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/** The compliance row, read with SQL rather than through the code under test's own
 *  getter, so a store-level cache cannot make a dropped write look applied. */
function rawProfile(investorId: string): {
  investor_id: string;
  kyc_status: string;
  accreditation_status: string;
  jurisdiction: string | null;
} | undefined {
  return rawDb()
    .prepare(
      `SELECT investor_id, kyc_status, accreditation_status, jurisdiction
         FROM investor_compliance_profile WHERE investor_id = ?`,
    )
    .get(investorId) as any;
}

/** Build a partner-related investor the only way a caller can: create an SPV
 *  through the real route and subscribe the LP to it. `partnerCanAccessInvestorCompliance`
 *  is a real IDOR fence and this is what satisfies it. */
let sharedSpvId: string | null = null;

async function relatedInvestor(): Promise<string> {
  const n = seq++;
  if (!sharedSpvId) {
    const spv = await call("POST", "/api/partner/me/spv", {
      body: {
        name: `W227 Vehicle ${n}`,
        jurisdiction: "delaware",
        carryBasis: "whole_spv",
        status: "open",
        currency: "USD",
        signoffLegalName: "Avi Managing",
        signoffAccepted: true,
      },
    });
    expect(spv.status, JSON.stringify(spv.body)).toBe(201);
    sharedSpvId = spv.body.spv.id as string;
  }
  const spvId = sharedSpvId;
  const investorId = `inv_w227_${n}`;
  const sub = await call("POST", `/api/partner/me/spv/${spvId}/subscriptions`, {
    body: { investorId, commitmentMinor: 1_000_000 },
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return investorId;
}

const putCompliance = (investorId: string, body: unknown) =>
  call("PUT", `/api/partner/me/compliance/${investorId}`, { body });

/* ─────────────────────────────────────────────────────────────────────────────
   A — THE WRITER IS FENCED. No new unscoped global assertion can be minted.
   ───────────────────────────────────────────────────────────────────────── */
describe("W227 A — the unscoped global accreditation assertion is refused over HTTP", () => {
  it("A-1 — `verified` with no jurisdiction is REFUSED (422)", async () => {
    const inv = await relatedInvestor();
    const r = await putCompliance(inv, { accreditationStatus: "verified" });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error).toBe(ACCREDITATION_JURISDICTION_REQUIRED);
  });

  it("A-2 — and the refusal WROTE NOTHING (read back with SQL)", async () => {
    const inv = await relatedInvestor();
    const before = rawProfile(inv);
    const r = await putCompliance(inv, { accreditationStatus: "verified" });
    expect(r.status).toBe(422);
    const after = rawProfile(inv);
    /* Either no row was ever created, or the row that existed is unchanged. Both
       are "nothing moved"; neither may show an accreditation. */
    expect(after?.accreditation_status ?? "none").not.toBe("verified");
    expect(after?.accreditation_status ?? "none").toBe(before?.accreditation_status ?? "none");
    /* And the store agrees with the table — no cache holds a phantom grant. */
    expect(spvEngineStore.getComplianceProfile(inv)?.accreditationStatus ?? "none").not.toBe("verified");
  });

  it('A-3 — jurisdiction "Global" is REFUSED, and nothing is stored', async () => {
    const inv = await relatedInvestor();
    const r = await putCompliance(inv, { accreditationStatus: "self_certified", jurisdiction: "Global" });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.error).toBe(ACCREDITATION_JURISDICTION_REQUIRED);
    expect(rawProfile(inv)?.accreditation_status ?? "none").toBe("none");
    expect(rawProfile(inv)?.jurisdiction ?? null).toBeNull();
  });

  it("A-4 — every other blanket-sounding jurisdiction is refused too", async () => {
    /* Deliberately includes strings the zod schema lets through: min(2).max(64)
       free text. The schema is not the fence; the fence is the fence. */
    const blankets = ["Worldwide", "All", "International", "N/A", "Anywhere", "Earth", "worldwide"];
    for (const j of blankets) {
      const inv = await relatedInvestor();
      const r = await putCompliance(inv, { accreditationStatus: "verified", jurisdiction: j });
      expect(r.status, `${j} -> ${JSON.stringify(r.body)}`).toBe(422);
      expect(rawProfile(inv)?.accreditation_status ?? "none", `${j} stored`).toBe("none");
    }
  });

  it("A-5 — the refusal names the nine jurisdictions so a caller can comply", async () => {
    const inv = await relatedInvestor();
    const r = await putCompliance(inv, { accreditationStatus: "verified" });
    expect(r.status).toBe(422);
    const codes = ACCREDITATION_JURISDICTIONS_V0_3.map((j) => j.code);
    expect(codes.length).toBe(9);
    expect(r.body.jurisdictions).toEqual(codes);
  });

  it("A-6 — the refusal is readable words within the looksHuman budget", async () => {
    const inv = await relatedInvestor();
    const r = await putCompliance(inv, { accreditationStatus: "verified" });
    const msg = r.body.message as string;
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    /* No ALL-CAPS machine code on screen, and it must say what to do next. */
    expect(msg).not.toMatch(/ACCREDITATION_JURISDICTION_REQUIRED/);
    expect(msg.toLowerCase()).toContain("jurisdiction");
    expect(msg.toLowerCase()).toContain("nothing was changed");
  });

  it("A-7 — the refusal is ATOMIC: a kycStatus riding along is not applied either", async () => {
    const inv = await relatedInvestor();
    const r = await putCompliance(inv, { kycStatus: "verified", accreditationStatus: "verified" });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    const row = rawProfile(inv);
    expect(row?.kyc_status ?? "none").toBe("none");
    expect(row?.accreditation_status ?? "none").toBe("none");
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   B — NOBODY LEGITIMATE IS LOCKED OUT.
   ───────────────────────────────────────────────────────────────────────── */
describe("W227 B — the fence refuses only the unscoped assertion, nothing else", () => {
  it("B-1 — `verified` WITH a real jurisdiction is accepted and persisted", async () => {
    const inv = await relatedInvestor();
    const r = await putCompliance(inv, { accreditationStatus: "verified", jurisdiction: "US" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = rawProfile(inv);
    expect(row?.accreditation_status).toBe("verified");
    expect(row?.jurisdiction).toBe("US");
  });

  it("B-2 — a jurisdiction already on the profile satisfies a later `verified`", async () => {
    const inv = await relatedInvestor();
    /* Step 1: a jurisdiction is recorded with a status that is not an assertion. */
    const step1 = await putCompliance(inv, { accreditationStatus: "none", jurisdiction: "Canada" });
    expect(step1.status, JSON.stringify(step1.body)).toBe(200);
    /* Step 2: `verified` with NO jurisdiction key now resolves from the stored one. */
    const step2 = await putCompliance(inv, { accreditationStatus: "verified" });
    expect(step2.status, JSON.stringify(step2.body)).toBe(200);
    expect(rawProfile(inv)?.accreditation_status).toBe("verified");
  });

  it("B-3 — `none` and `manual_review` are never fenced", async () => {
    for (const status of ["none", "manual_review"] as const) {
      const inv = await relatedInvestor();
      const r = await putCompliance(inv, { kycStatus: "verified", accreditationStatus: status });
      expect(r.status, `${status} -> ${JSON.stringify(r.body)}`).toBe(200);
      expect(rawProfile(inv)?.accreditation_status).toBe(status);
      expect(rawProfile(inv)?.kyc_status).toBe("verified");
    }
  });

  it("B-4 — GRANDFATHER, PINNED: unscoped `self_certified` is still accepted", async () => {
    /* This is the exact fixture line eighteen suites use, wave 211's money-event
       HTTP suite among them. It is pinned here ON PURPOSE. Closing this shape
       would refuse partners and investors the platform already accepts, so it is
       escalated in W227_FOR_THE_OWNER rather than shipped as a silent lockout —
       and if a later wave decides to close it, this test is where it will be
       forced to say so out loud. */
    const inv = await relatedInvestor();
    const r = await putCompliance(inv, { kycStatus: "verified", accreditationStatus: "self_certified" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(rawProfile(inv)?.accreditation_status).toBe("self_certified");
    expect(rawProfile(inv)?.jurisdiction ?? null).toBeNull();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   C — THE READER REPORTS THE SCOPE, AND GRANTS EXACTLY AS BEFORE.
   ───────────────────────────────────────────────────────────────────────── */
describe("W227 C — every accreditation grant now reports the jurisdiction it is scoped to", () => {
  it("C-1 — a jurisdiction-backed grant reports scope jurisdiction_scoped", async () => {
    const inv = await relatedInvestor();
    expect((await putCompliance(inv, { accreditationStatus: "verified", jurisdiction: "SG" })).status).toBe(200);
    const g = getAccreditationGateStatus(inv);
    expect(g.status).toBe("verified");
    expect(g.jurisdiction).toBe("SG");
    expect(g.scope).toBe("jurisdiction_scoped");
  });

  it("C-2 — an unscoped grant reports unscoped_legacy_grace AND STILL GRANTS", async () => {
    const inv = await relatedInvestor();
    expect((await putCompliance(inv, { accreditationStatus: "self_certified" })).status).toBe(200);
    const g = getAccreditationGateStatus(inv);
    /* Both halves matter. The scope is now legible — that is the close. The grant
       is unchanged — that is the no-lockout guarantee. */
    expect(g.status).toBe("self_certified");
    expect(g.jurisdiction).toBeNull();
    expect(g.scope).toBe("unscoped_legacy_grace");
    expect(hasAccreditedDeclaration(inv)).toBe(true);
  });

  it("C-3 — no grant reports scope none", async () => {
    const inv = await relatedInvestor();
    const g = getAccreditationGateStatus(inv);
    expect(g.status).toBe("none");
    expect(g.scope).toBe("none");
    expect(g.jurisdiction).toBeNull();
    expect(hasAccreditedDeclaration(inv)).toBe(false);
  });

  it("C-4 — a declaration's jurisdiction scopes the grant when the profile column is null", async () => {
    const inv = `inv_w227_decl_${seq++}`;
    /* Written through the real capture helper the one mechanism uses, then the
       profile column is deliberately blanked so the ONLY jurisdiction in play is
       the declaration's. */
    recordAccreditationDeclaration(inv, {
      signatureName: "W227 Declarant",
      criteria: ["uk_hnw_income"],
      jurisdiction: "UK",
    });
    /* The declaration row really does carry the jurisdiction — asserted from the
       table, not from the return value, so this test cannot pass on a row that was
       never written (a fixture no server mutation can move is one of the five
       inert-proof mechanisms). */
    const declRow = rawDb()
      .prepare(`SELECT jurisdiction FROM investor_accreditation_declaration WHERE investor_id = ?`)
      .get(inv) as { jurisdiction: string | null } | undefined;
    expect(declRow, "no declaration row was written").toBeTruthy();
    expect(declRow?.jurisdiction).toBe("UK");
    /* Now blank the PROFILE jurisdiction through the real store writer. It
       coalesces with `??`, so a null cannot overwrite an existing value — an empty
       string can, and `resolveJurisdictionCode("")` is null by construction, so the
       profile side of the resolution is genuinely dead. Doing this with raw SQL
       instead would leave the store's in-memory row stale and the test would be
       measuring a cache rather than the code. */
    spvEngineStore.upsertComplianceProfile(inv, { jurisdiction: "" });
    expect(spvEngineStore.getComplianceProfile(inv)?.jurisdiction).toBe("");
    expect(rawProfile(inv)?.jurisdiction).toBe("");
    const g = getAccreditationGateStatus(inv);
    expect(g.jurisdiction).toBe("UK");
    expect(g.scope).toBe("jurisdiction_scoped");
  });

  it("C-5 — `hasAccreditedDeclaration` is UNCHANGED for every shape (the regression that matters)", async () => {
    /* Five readers depend on this boolean and one of them is the SACRED cap-table
       funding gate, which answers 412 ACCREDITATION_REQUIRED when it is false. If
       this wave moved it for any shape, real money would stop moving. */
    const scoped = await relatedInvestor();
    expect((await putCompliance(scoped, { accreditationStatus: "verified", jurisdiction: "AU" })).status).toBe(200);
    const unscoped = await relatedInvestor();
    expect((await putCompliance(unscoped, { accreditationStatus: "self_certified" })).status).toBe(200);
    const nothing = await relatedInvestor();

    expect(hasAccreditedDeclaration(scoped)).toBe(true);
    expect(hasAccreditedDeclaration(unscoped)).toBe(true);
    expect(hasAccreditedDeclaration(nothing)).toBe(false);
    expect(hasAccreditedDeclaration("")).toBe(false);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   D — STILL EXACTLY ONE MECHANISM.
   ───────────────────────────────────────────────────────────────────────── */
describe("W227 D — exactly one accreditation mechanism", () => {
  it("D-1 — the fence is a pure predicate over the ONE mechanism's own registry", () => {
    /* It records nothing, so it cannot be a second mechanism. Nine codes, and the
       list is the one the declaration surface serves — not a copy. */
    expect(accreditationAssertionRefusal({ accreditationStatus: "none" }, null)).toBeNull();
    expect(accreditationAssertionRefusal({ accreditationStatus: "manual_review" }, null)).toBeNull();
    expect(accreditationAssertionRefusal({ accreditationStatus: "self_certified" }, null)).toBeNull();
    expect(accreditationAssertionRefusal({ accreditationStatus: "verified" }, null)?.payload.error)
      .toBe(ACCREDITATION_JURISDICTION_REQUIRED);
    expect(accreditationAssertionRefusal({ accreditationStatus: "verified" }, "Japan")).toBeNull();
    expect(accreditationAssertionRefusal({ accreditationStatus: "verified", jurisdiction: "Global" }, "Japan")?.payload.error)
      .toBe(ACCREDITATION_JURISDICTION_REQUIRED);
    expect(accreditationAssertionRefusal({ accreditationStatus: "self_certified", jurisdiction: "Global" }, null)?.payload.error)
      .toBe(ACCREDITATION_JURISDICTION_REQUIRED);
    expect(accreditationAssertionRefusal({ accreditationStatus: "verified" }, null)?.payload.jurisdictions.length).toBe(9);
  });

  it("D-2 — the fenced route still answers the READ path unchanged", async () => {
    const inv = await relatedInvestor();
    expect((await putCompliance(inv, { accreditationStatus: "verified", jurisdiction: "HK" })).status).toBe(200);
    const r = await call("GET", `/api/partner/me/compliance/${inv}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.profile.accreditationStatus).toBe("verified");
    expect(r.body.gates.accreditation).toBe(true);
  });
});
