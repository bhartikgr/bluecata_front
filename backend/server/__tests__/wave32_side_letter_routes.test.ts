/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 4 — SIDE-LETTER ROUTE FALSIFICATION.
 *
 * Capability 2 proved the ECONOMICS. This harness proves the SURFACE: that a GP
 * can create, see and revoke a letter through the product, that the letter then
 * changes what a distribution persists, and — the part that matters most — that
 * an LP can read their own letter and nothing else.
 *
 * A side letter is the record that one partner negotiated better terms than
 * their co-investors. Wave 29 / WAIVER-4 fixed a live exposure where two
 * passive LPs in one vehicle could discover each other; this is exactly the
 * kind of route that regresses it, so every privacy claim below is asserted BY
 * EXECUTION against a REAL-BUT-WRONG identity, never against anonymity.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";

/* Three-state identity switch: undefined defers to the REAL getUserContext (so
   GP and admin fixture calls authenticate exactly as in production), a string
   is that investor's session, null is genuine anonymity for the 401 pole. */
const CURRENT: { override?: string | null } = {};
vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/userContext")>();
  return {
    ...actual,
    getUserContext: (req: any) =>
      CURRENT.override === undefined
        ? (actual as any).getUserContext(req)
        : CURRENT.override === null
          ? null
          : { isAuthed: true, userId: CURRENT.override },
  };
});

import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvSideLetterRoutes } from "../spvSideLetterRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { ensureSideLetterSchemaForTests, listSideLetters } from "../spvSideLetterStore";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";
const SCALE = 1_000_000_000;
const SETTLE = { settlementOutcome: "succeeded", settlementReason: "wave32 c4 fixture" };
let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function del(path: string, user: string) {
  return request(app).delete(path).set("x-user-id", user);
}
function put(path: string, user: string, body?: unknown) {
  return request(app).put(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user?: string) {
  const r = request(app).get(path);
  return user ? r.set("x-user-id", user) : r;
}

async function commitLp(spvId: string, investorId: string, commitmentMinor: number) {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, { investorId, commitmentMinor });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/${investorId}`, MANAGING, {
    kycStatus: "verified", accreditationStatus: "self_certified",
  });
  const adv = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`, MANAGING, {
    to: "committed", subscriptionDocRef: `sig_${investorId}`,
  });
  expect(adv.status).toBe(200);
}

async function createSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "per_deployment", status: "open",
    signoffLegalName: "Avi Managing", signoffAccepted: true,
  });
  expect(r.status).toBe(201);
  const id = r.body.spv.id as string;
  const fee = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
    layer: "management", feeType: "carry", carryPct: 0.2,
  });
  expect(fee.status).toBe(201);
  return id;
}

let spvId: string;
let otherSpvId: string;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvSideLetterRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureSideLetterSchemaForTests();

  spvId = await createSpv("W32 C4 SPV");
  await commitLp(spvId, "inv_c4_a", 1_000_000);
  await commitLp(spvId, "inv_c4_b", 1_000_000);
  otherSpvId = await createSpv("W32 C4 Other SPV");
  await commitLp(otherSpvId, "inv_c4_outsider", 1_000_000);
});

describe("W32-C4 — the side-letter GP surface", () => {
  it("C4-1 the route CREATES a real row — the sink is the table, proven by reading SQLite back", async () => {
    const r = await post(`/api/partner/me/spv/${spvId}/side-letters`, MANAGING, {
      investorId: "inv_c4_a", carryFractionScaled: SCALE / 10, effectiveDate: "2026-01-01",
    });
    expect(r.status).toBe(201);
    const raw = rawDb()
      .prepare(`SELECT investor_id, carry_fraction_scaled, status FROM spv_side_letter WHERE id = ?`)
      .get(r.body.sideLetter.id) as any;
    expect(raw.investor_id).toBe("inv_c4_a");
    expect(raw.carry_fraction_scaled).toBe(SCALE / 10);   // exact integer billionths
    expect(raw.status).toBe("active");
  });

  it("C4-2 a blank rate is stored as NULL (inherit), NOT as 0 (pays no carry)", async () => {
    const r = await post(`/api/partner/me/spv/${spvId}/side-letters`, MANAGING, {
      investorId: "inv_c4_b", effectiveDate: "2026-01-01", notes: "visibility only",
    });
    expect(r.status).toBe(201);
    expect(r.body.sideLetter.carryFractionScaled).toBeNull();
    const raw = rawDb().prepare(`SELECT carry_fraction_scaled FROM spv_side_letter WHERE id = ?`)
      .get(r.body.sideLetter.id) as any;
    expect(raw.carry_fraction_scaled).toBeNull();
    // THE OTHER POLE: an explicit 0 is stored as 0 and is a different fact.
    const zero = await post(`/api/partner/me/spv/${spvId}/side-letters`, MANAGING, {
      investorId: "inv_c4_b", carryFractionScaled: 0, effectiveDate: "2026-02-01",
    });
    expect(zero.status).toBe(201);
    expect(zero.body.sideLetter.carryFractionScaled).toBe(0);
  });

  it("C4-3 an out-of-domain rate is REFUSED, never clamped or 'repaired'", async () => {
    const tooBig = await post(`/api/partner/me/spv/${spvId}/side-letters`, MANAGING, {
      investorId: "inv_c4_a", carryFractionScaled: SCALE * 2, effectiveDate: "2026-01-01",
    });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toBe("SIDE_LETTER_RATE_OUT_OF_DOMAIN");
    const fractional = await post(`/api/partner/me/spv/${spvId}/side-letters`, MANAGING, {
      investorId: "inv_c4_a", carryFractionScaled: 0.2, effectiveDate: "2026-01-01",
    });
    expect(fractional.status).toBe(400);
    expect(fractional.body.error).toBe("SIDE_LETTER_RATE_NOT_INTEGER_SCALED");
    // Nothing was written by either refusal.
    expect(listSideLetters(spvId).filter((l) => l.carryFractionScaled === SCALE * 2).length).toBe(0);
  });

  it("C4-4 a letter for someone NOT on the committed register is refused, not stored inert", async () => {
    const r = await post(`/api/partner/me/spv/${spvId}/side-letters`, MANAGING, {
      investorId: "inv_not_on_register", carryFractionScaled: SCALE / 10, effectiveDate: "2026-01-01",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SIDE_LETTER_INVESTOR_NOT_ON_REGISTER");
  });

  it("C4-5 creating supersedes the prior active letter — never two live letters for one LP", async () => {
    const spv = await createSpv("W32 C4 Supersede SPV");
    await commitLp(spv, "inv_c4_s", 1_000_000);
    const first = await post(`/api/partner/me/spv/${spv}/side-letters`, MANAGING, {
      investorId: "inv_c4_s", carryFractionScaled: SCALE / 10, effectiveDate: "2026-01-01",
    });
    const second = await post(`/api/partner/me/spv/${spv}/side-letters`, MANAGING, {
      investorId: "inv_c4_s", carryFractionScaled: SCALE / 20, effectiveDate: "2026-06-01",
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const rows = listSideLetters(spv).filter((l) => l.investorId === "inv_c4_s");
    expect(rows.length).toBe(2);                                     // history kept
    expect(rows.filter((l) => l.status === "active").length).toBe(1);
    expect(rows.find((l) => l.status === "active")!.id).toBe(second.body.sideLetter.id);
  });

  it("C4-6 revoking through the route returns the LP to fund defaults — proven at the WATERFALL sink", async () => {
    const spv = await createSpv("W32 C4 Revoke SPV");
    await commitLp(spv, "inv_c4_r1", 1_000_000);
    await commitLp(spv, "inv_c4_r2", 1_000_000);
    const made = await post(`/api/partner/me/spv/${spv}/side-letters`, MANAGING, {
      investorId: "inv_c4_r1", carryFractionScaled: SCALE / 10, effectiveDate: "2026-01-01",
    });
    expect(made.status).toBe(201);

    // POLE 1 — with the letter in force the two LPs bear DIFFERENT carry.
    const withLetter = await post(`/api/admin/consortium-spv/${spv}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(withLetter.status).toBe(201);
    const a1 = withLetter.body.distribution.allocations.find((a: any) => a.investorId === "inv_c4_r1");
    const b1 = withLetter.body.distribution.allocations.find((a: any) => a.investorId === "inv_c4_r2");
    expect(a1.carryMinor).toBe(50_000);      // 10% of a 500,000 half-share of the base
    expect(b1.carryMinor).toBe(100_000);     // 20% fund default
    expect(a1.carryMinor).not.toBe(b1.carryMinor);

    // POLE 2 — revoke through the ROUTE and the next distribution treats them alike.
    const rev = await del(`/api/partner/me/spv/${spv}/side-letters/${made.body.sideLetter.id}`, MANAGING);
    expect(rev.status).toBe(200);
    expect(rev.body.sideLetter.status).toBe("revoked");
    const after = await post(`/api/admin/consortium-spv/${spv}/distributions`, ADMIN, {
      event: "exit", grossProceedsMinor: 5_000_000, costBasisMinor: 4_000_000, ...SETTLE,
    });
    expect(after.status).toBe(201);
    const a2 = after.body.distribution.allocations.find((a: any) => a.investorId === "inv_c4_r1");
    const b2 = after.body.distribution.allocations.find((a: any) => a.investorId === "inv_c4_r2");
    expect(a2.carryMinor).toBe(b2.carryMinor);
    expect(after.body.distribution.waterfall.map((t: any) => t.tier)).not.toContain("side_letter_adjustment");
  });

  it("C4-7 cross-partner access to the GP surface is 404, not 403", async () => {
    const r = await get(`/api/partner/me/spv/spv_not_this_partner_zzz/side-letters`, MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("SPV_NOT_FOUND");
    const w = await post(`/api/partner/me/spv/spv_not_this_partner_zzz/side-letters`, MANAGING, {
      investorId: "inv_c4_a", effectiveDate: "2026-01-01",
    });
    expect(w.status).toBe(404);
  });

  it("C4-15 the letter's currency is the VEHICLE's, never one the caller supplies", async () => {
    /* A side letter denominated in a currency other than the vehicle's would put
       two currencies inside one waterfall, which is the failure this codebase
       refuses everywhere else. Proven at the sink: what the caller sent is not
       what was stored. */
    const spv = await createSpv("W32 C4 Currency SPV");
    await commitLp(spv, "inv_c4_cur", 1_000_000);
    const vehicleCurrency = (rawDb().prepare(`SELECT currency FROM spv WHERE id = ?`).get(spv) as any).currency;
    expect(vehicleCurrency).toBe("USD");
    const r = await post(`/api/partner/me/spv/${spv}/side-letters`, MANAGING, {
      investorId: "inv_c4_cur", carryFractionScaled: SCALE / 10, effectiveDate: "2026-01-01",
      currency: "JPY",
    });
    expect(r.status).toBe(201);
    const raw = rawDb().prepare(`SELECT currency FROM spv_side_letter WHERE id = ?`).get(r.body.sideLetter.id) as any;
    expect(raw.currency).toBe("USD");
    expect(raw.currency).not.toBe("JPY");
  });

  it("C4-16 a REAL vehicle belonging to ANOTHER partner is 404 on read AND on write", async () => {
    /* THE PROBE MUST MATCH THE CONTROL. `spv_not_this_partner_zzz` does not
       exist at all, so it proves nothing about partner scoping — a route with no
       scope check refuses it too. This inserts a vehicle that genuinely EXISTS
       and genuinely belongs to someone else. */
    const now = new Date().toISOString();
    rawDb()
      .prepare(`INSERT INTO spv (id, sponsor_partner_id, name, spv_type, jurisdiction, status,
                  distribution_scope, currency, carry_basis, lp_visibility, created_at, created_by,
                  updated_at, updated_by, curr_hash)
                VALUES (?,?,?,'spv',?,'open','private','USD','per_deployment','own_only',?,?,?,?,?)`)
      .run("spv_w32_other_partner", "partner_someone_else", "Another Firm's Vehicle", "delaware",
           now, "u_other", now, "u_other", "3".repeat(64));
    const read = await get(`/api/partner/me/spv/spv_w32_other_partner/side-letters`, MANAGING);
    expect(read.status).toBe(404);
    const write = await post(`/api/partner/me/spv/spv_w32_other_partner/side-letters`, MANAGING, {
      investorId: "inv_c4_a", carryFractionScaled: SCALE / 10, effectiveDate: "2026-01-01",
    });
    expect(write.status).toBe(404);
    expect(write.body.error).toBe("SPV_NOT_FOUND");
    // Nothing was written into the other firm's vehicle.
    expect(
      (rawDb().prepare(`SELECT COUNT(*) AS n FROM spv_side_letter WHERE spv_id = ?`)
        .get("spv_w32_other_partner") as any).n,
    ).toBe(0);
    // CONTROL: the same actor CAN write to their OWN vehicle, so the 404 is a
    // scoping decision and not a broken route.
    const ok = await post(`/api/partner/me/spv/${spvId}/side-letters`, MANAGING, {
      investorId: "inv_c4_a", carryFractionScaled: SCALE / 10, effectiveDate: "2026-03-01",
    });
    expect(ok.status).toBe(201);
  });

  it("C4-17 revoking a letter that does not exist is a 404, not a cheerful success", async () => {
    const r = await del(`/api/partner/me/spv/${spvId}/side-letters/sl_does_not_exist`, MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("SIDE_LETTER_NOT_FOUND");
  });
});


describe("W32-C4 — LP privacy on the side-letter surface", () => {
  it("C4-8 the fixture distinguishes identities — the same URL answers two LPs differently", async () => {
    CURRENT.override = "inv_c4_a";
    const a = await get(`/api/investor/me/spv/${spvId}/side-letter`);
    CURRENT.override = "inv_c4_b";
    const b = await get(`/api/investor/me/spv/${spvId}/side-letter`);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.sideLetter.investorId).toBe("inv_c4_a");
    expect(b.body.sideLetter.investorId).toBe("inv_c4_b");
    expect(JSON.stringify(a.body)).not.toBe(JSON.stringify(b.body));
  });

  it("C4-9 an LP's response carries NO trace of any other LP's terms", async () => {
    CURRENT.override = "inv_c4_a";
    const r = await get(`/api/investor/me/spv/${spvId}/side-letter`);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain("inv_c4_b");
    expect(body).toContain("inv_c4_a");       // the pole: their own letter IS returned
  });

  it("C4-10 PROBE — a real, committed LP of ANOTHER vehicle gets 404, identical to a vehicle that does not exist", async () => {
    CURRENT.override = "inv_c4_outsider";
    const probe = await get(`/api/investor/me/spv/${spvId}/side-letter`);
    const ghost = await get(`/api/investor/me/spv/spv_nonexistent_zzz/side-letter`);
    expect(probe.status).toBe(404);
    expect(ghost.status).toBe(404);
    expect(JSON.stringify(probe.body)).toBe(JSON.stringify(ghost.body));
    // And the CONTROL: that same identity CAN read their own vehicle, so the
    // 404 is a scoping decision and not a broken route.
    const own = await get(`/api/investor/me/spv/${otherSpvId}/side-letter`);
    expect(own.status).toBe(200);
  });

  it("C4-11 there is no tamperable investor parameter on the LP route", async () => {
    CURRENT.override = "inv_c4_a";
    const tampered = await get(`/api/investor/me/spv/${spvId}/side-letter?investorId=inv_c4_b`);
    expect(tampered.status).toBe(200);
    expect(JSON.stringify(tampered.body)).not.toContain("inv_c4_b");
  });

  it("C4-12 an LP on fund defaults gets an explicit null, which says nothing about anyone else", async () => {
    const spv = await createSpv("W32 C4 Default Terms SPV");
    await commitLp(spv, "inv_c4_plain", 1_000_000);
    await commitLp(spv, "inv_c4_privileged", 1_000_000);
    await post(`/api/partner/me/spv/${spv}/side-letters`, MANAGING, {
      investorId: "inv_c4_privileged", carryFractionScaled: SCALE / 20, effectiveDate: "2026-01-01",
    });
    CURRENT.override = "inv_c4_plain";
    const r = await get(`/api/investor/me/spv/${spv}/side-letter`);
    expect(r.status).toBe(200);
    expect(r.body.sideLetter).toBeNull();
    // The existence of a BETTER-TERMS letter for their co-investor must not be
    // inferable from this response in any way.
    expect(JSON.stringify(r.body)).not.toContain("inv_c4_privileged");
    expect(JSON.stringify(r.body)).not.toContain(String(SCALE / 20));
  });

  it("C4-13 anonymous is 401, distinct from the non-member 404 — authentication is really mounted", async () => {
    CURRENT.override = null;
    const anon = await get(`/api/investor/me/spv/${spvId}/side-letter`);
    expect(anon.status).toBe(401);
  });

  it("C4-14 the LP route is READ ONLY — an LP cannot write themselves better terms", async () => {
    CURRENT.override = "inv_c4_a";
    const attempt = await request(app)
      .post(`/api/investor/me/spv/${spvId}/side-letter`)
      .send({ carryFractionScaled: 0 });
    expect(attempt.status).toBeGreaterThanOrEqual(400);
    // And nothing changed at the sink.
    const still = listSideLetters(spvId).find((l) => l.investorId === "inv_c4_a" && l.status === "active");
    expect(still?.carryFractionScaled).toBe(SCALE / 10);
  });
});
