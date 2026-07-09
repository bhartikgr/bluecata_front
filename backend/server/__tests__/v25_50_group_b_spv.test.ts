/**
 * v25.50 GROUP B — SPV = cap table; LP = cap-table investor (REAL Express routes).
 *
 * Contract under test:
 *   B3 — POST /api/partner/me/spv/:spvId/lp-commit seats a named LP onto the
 *        SPV's cap table by calling the SACRED commitFunded UNCHANGED with
 *        companyId=spv.id. ONE authoritative ledger line; the hash-chain still
 *        verifies; a re-commit of the same LP is idempotent (no dup line). The
 *        partner ownership gate yields 404 cross-partner BEFORE any write. Rule
 *        #13: a missing last name is refused 400 (no partial-identity commit).
 *   B4 — roster authz VERIFICATION (documentation-only; no code change):
 *        the investor-context roster fails closed for a non-member (NOT_AN_LP
 *        403); the GP roster fails closed cross-partner (404, no existence leak).
 *   2a — dependent jurisdiction→entity map: 15 top jurisdictions, each with a
 *        non-empty structure list ending in "Other (specify)".
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { getLedger, verifyChain } from "../captableCommitStore";
import { __setRuntimePersona } from "../lib/userContext";
import {
  SPV_TOP_JURISDICTION_COUNTRIES,
  SPV_JURISDICTION_ENTITY_STRUCTURES,
} from "@shared/spvEngine";

const MANAGING = "u_avi_managing";
const PARTNER_B = "ac_consortium_partner_spv_iso_b";
const NON_MEMBER = "u_lp_outsider";

let app: express.Express;

function post(p: string, user: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", user).send(body ?? {});
}
function get(p: string, user: string) {
  return request(app).get(p).set("x-user-id", user);
}

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name, jurisdiction: "delaware", carryBasis: "whole_spv", status: "open", ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/** Count the SACRED ledger lines written against this SPV's companyId. */
function ledgerLinesFor(spvId: string): number {
  return getLedger().filter((e) => e.companyId === spvId).length;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  // A non-member investor needs an authenticated identity to exercise the
  // investor-context roster fail-closed path.
  __setRuntimePersona({ userId: NON_MEMBER, email: "outsider@test.local", name: "Outsider", isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false });
});

describe("B3 — LP commit writes ONE sacred ledger line + projects the roster", () => {
  it("happy path → 201, ok, ledger line present, chain verifies, roster committed", async () => {
    const spvId = await createSpv("LP Commit SPV");
    const before = ledgerLinesFor(spvId);

    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Ada", holderLastName: "Lovelace",
      investorEmail: "ada@lp.test", amount: "5000", shares: "5000",
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.idempotent).toBe(false);
    expect(r.body.ledger?.hash).toBeTruthy();
    expect(typeof r.body.ledger?.seq).toBe("number");

    // Exactly ONE new authoritative ledger line for this SPV.
    expect(ledgerLinesFor(spvId)).toBe(before + 1);
    // The hash-chain remains intact after the commit.
    expect(verifyChain().ok).toBe(true);

    // PROJECTION: the LP now shows on the GP roster as committed.
    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`, MANAGING);
    expect(roster.status).toBe(200);
    const committed = roster.body.subscribers.find((s: any) => s.status === "committed");
    expect(committed).toBeTruthy();
    expect(committed.commitmentMinor).toBe(500000); // 5000 major → 500000 minor
  });

  it("idempotent re-commit of the SAME LP → 200, no duplicate ledger line", async () => {
    const spvId = await createSpv("Idempotent SPV");
    const first = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Grace", holderLastName: "Hopper",
      investorEmail: "grace@lp.test", amount: "1000", shares: "1000",
    });
    expect(first.status).toBe(201);
    const afterFirst = ledgerLinesFor(spvId);

    const second = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Grace", holderLastName: "Hopper",
      investorEmail: "grace@lp.test", amount: "1000", shares: "1000",
    });
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    // No second ledger line for the same deterministic invitationId.
    expect(ledgerLinesFor(spvId)).toBe(afterFirst);
    expect(verifyChain().ok).toBe(true);
  });

  it("email is case-insensitive for idempotency (same LP, no dup)", async () => {
    const spvId = await createSpv("Case Insensitive SPV");
    const a = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Katherine", holderLastName: "Johnson",
      investorEmail: "Kat@LP.test", amount: "2000", shares: "2000",
    });
    expect(a.status).toBe(201);
    const after = ledgerLinesFor(spvId);
    const b = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Katherine", holderLastName: "Johnson",
      investorEmail: "kat@lp.test", amount: "2000", shares: "2000",
    });
    expect(b.status).toBe(200);
    expect(b.body.idempotent).toBe(true);
    expect(ledgerLinesFor(spvId)).toBe(after);
  });

  it("cross-partner lp-commit → 404 (no existence leak), NO ledger write", async () => {
    const bSpv = spvEngineStore.createSpv(
      PARTNER_B,
      { name: "Partner B SPV", jurisdiction: "cayman", carryBasis: "whole_spv" },
      "u_b_gp",
    );
    const before = ledgerLinesFor(bSpv.id);
    const r = await post(`/api/partner/me/spv/${bSpv.id}/lp-commit`, MANAGING, {
      holderFirstName: "Mallory", holderLastName: "Attacker",
      investorEmail: "mallory@lp.test", amount: "9999", shares: "9999",
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("SPV_NOT_FOUND");
    // Fail-closed: the 404 short-circuits BEFORE any ledger read/write.
    expect(ledgerLinesFor(bSpv.id)).toBe(before);
  });

  it("missing last name → 400 MISSING_HOLDER_NAME (rule #13), NO ledger write", async () => {
    const spvId = await createSpv("No Name SPV");
    const before = ledgerLinesFor(spvId);
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Onlyfirst", holderLastName: "  ",
      investorEmail: "noname@lp.test", amount: "100", shares: "100",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("MISSING_HOLDER_NAME");
    expect(ledgerLinesFor(spvId)).toBe(before);
  });

  it("missing amount/shares → 400 COMMIT_FIELDS_REQUIRED", async () => {
    const spvId = await createSpv("No Amount SPV");
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Bad", holderLastName: "Input", investorEmail: "bad@lp.test",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("COMMIT_FIELDS_REQUIRED");
  });

  it("invalid email → 400 INVALID_EMAIL", async () => {
    const spvId = await createSpv("Bad Email SPV");
    const r = await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Bad", holderLastName: "Email", investorEmail: "not-an-email", amount: "100", shares: "100",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_EMAIL");
  });
});

describe("B4 — roster authz is fail-closed (VERIFICATION; no code change)", () => {
  it("investor-context roster refuses a non-member → 403 NOT_AN_LP", async () => {
    const spvId = await createSpv("Roster Authz SPV");
    // A committed LP exists, but NON_MEMBER is not among them.
    await post(`/api/partner/me/spv/${spvId}/lp-commit`, MANAGING, {
      holderFirstName: "Real", holderLastName: "Lp", investorEmail: "real@lp.test", amount: "100", shares: "100",
    });
    const r = await get(`/api/spv/${spvId}/lp-roster`, NON_MEMBER);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("NOT_AN_LP");
  });

  it("GP roster refuses a cross-partner id → 404 (no existence leak)", async () => {
    const bSpv = spvEngineStore.createSpv(
      PARTNER_B,
      { name: "Partner B Roster SPV", jurisdiction: "bvi", carryBasis: "whole_spv" },
      "u_b_gp",
    );
    const r = await get(`/api/partner/me/spv/${bSpv.id}/lp-roster`, MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("SPV_NOT_FOUND");
  });
});

describe("2a — dependent jurisdiction→entity structure map", () => {
  it("exposes 15 top jurisdictions, each mapped to a non-empty list ending in 'Other (specify)'", () => {
    expect(SPV_TOP_JURISDICTION_COUNTRIES.length).toBe(15);
    for (const country of SPV_TOP_JURISDICTION_COUNTRIES) {
      const structures = SPV_JURISDICTION_ENTITY_STRUCTURES[country];
      expect(structures, `missing structures for ${country}`).toBeTruthy();
      expect(structures.length).toBeGreaterThan(0);
      expect(structures[structures.length - 1]).toBe("Other (specify)");
    }
  });

  it("every mapped country is one of the top jurisdictions (no orphan keys)", () => {
    for (const key of Object.keys(SPV_JURISDICTION_ENTITY_STRUCTURES)) {
      expect(SPV_TOP_JURISDICTION_COUNTRIES).toContain(key);
    }
  });
});
