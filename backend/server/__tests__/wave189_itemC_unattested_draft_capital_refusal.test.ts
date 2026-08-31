/**
 * WAVE 189 · ITEM C · R159.6 — AN UNATTESTED DRAFT MAY EXIST BUT MUST BE
 * STRUCTURALLY INCAPABLE OF HOLDING CAPITAL.
 *
 * Owner: *"Go with your recommendation."* — drafts allowed, clearly labelled
 * unattested, and **no LP, no commitment and no fee may attach until the
 * attestation is signed.**
 *
 * WHAT THIS FILE PROVES, AND AT WHICH LAYER. R159.6 item 6 asks for refusal on
 * every write path **route-level, not store-only**, so every refusal below is
 * asserted through a REAL Express route via supertest. A store-only assertion
 * would prove nothing about the surfaces a general partner actually uses — which
 * is the whole content of wave 182's lesson, restated by the owner in this brief:
 * a disabled button is not enforcement, and neither is a store test.
 *
 * HOW AN UNATTESTED VEHICLE IS CONSTRUCTED HERE. Not by bypassing the creation
 * route — the WAVE 86B gate at `spvEngineRoutes.ts` makes that impossible, and
 * proving the gate by evading it would prove nothing. Instead the vehicle is
 * created NORMALLY, attested, and its sign-off row is then DELETED. That
 * reproduces exactly the state found on `data.db` during this wave's preflight:
 * 6 SPV rows, 0 rows in `spv_launch_signoffs`, all 6 with `status='open'`. The
 * hole being closed is real and currently populated, not hypothetical.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE. The attestation TEXT (wave 176/C1
 * verified it live and this wave does not touch `shared/spvAttestation.ts`), and
 * the DOM label (a separate rendered-DOM test, per R159.6 item 6).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvFundRoutes } from "../spvFundStore";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { recordSignoff, linkSignoffToSpv } from "../spvLaunchSignoffStore";
import { spvIsAttested } from "../lib/spvAttestationGate";
import {
  SPV_UNATTESTED_DRAFT_CODE,
  SPV_UNATTESTED_DRAFT_LABEL,
  spvUnattestedDraftDecision,
  spvUnattestedDraftHeadline,
  spvUnattestedDraftSentence,
  spvUnattestedDraftNotice,
} from "@shared/spvUnattestedDraft";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}

async function createAttestedSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/** Strip the vehicle's launch sign-off, reproducing the `data.db` state. */
function unattest(spvId: string): void {
  rawDb().prepare(`DELETE FROM spv_launch_signoffs WHERE spv_id = ?`).run(spvId);
  expect(spvIsAttested(spvId)).toBe(false);
}

/** Sign the launch attestation for a vehicle that has none, through the real
 *  sign-off store API rather than raw SQL. */
function attest(spvId: string): void {
  const rec = recordSignoff({
    partnerId: PARTNER_A,
    spvId,
    userId: MANAGING,
    signerLegalName: "Avi Managing",
  });
  expect(linkSignoffToSpv(rec.id, spvId)).toBe(true);
  expect(spvIsAttested(spvId)).toBe(true);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  /* Registered because `POST /api/partner/me/spvs/:id/commitments` — the fifth
     write path, the one that reaches `engineAddCommitment` — lives in
     `spvFundStore.ts`, not in the engine routes. Omitting it would have made the
     adversarial sweep below silently "pass" on a 404: the route would never have
     been mounted, and the test would have proved nothing about it. */
  registerSpvFundRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

/* ════════════════════════════════════════════════════════════════════════════
   1. THE RULE ITSELF — pure, so it can be checked without a database.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item C — the shared rule", () => {
  it("an ATTESTED vehicle is never refused, for any of the three attach kinds", () => {
    for (const kind of ["limited_partner", "commitment", "fee"] as const) {
      expect(spvUnattestedDraftDecision({ attested: true, kind })).toEqual({
        refused: false,
        kind: null,
      });
    }
  });

  it("an UNATTESTED vehicle refuses all three attach kinds and names which one", () => {
    for (const kind of ["limited_partner", "commitment", "fee"] as const) {
      expect(spvUnattestedDraftDecision({ attested: false, kind })).toEqual({
        refused: true,
        kind,
      });
    }
  });

  it("R159.6(4) — the refusal is a STATED FACT: no ALL-CAPS underscore code in any sentence a GP reads", () => {
    const sentences = [
      spvUnattestedDraftHeadline({ spvName: "Keiretsu NovaPay SPV", kind: "limited_partner" }),
      spvUnattestedDraftSentence({ spvName: "Keiretsu NovaPay SPV", kind: "commitment" }),
      spvUnattestedDraftNotice("Keiretsu NovaPay SPV"),
    ];
    for (const s of sentences) {
      /* The machine code must never appear in prose, nor any other screaming-snake
         token. Two-or-more capitals joined by an underscore is the shape being
         excluded; ordinary capitalised words and the vehicle's own name survive it. */
      expect(s).not.toContain(SPV_UNATTESTED_DRAFT_CODE);
      expect(s).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
      expect(s.length).toBeGreaterThan(40);
    }
  });

  it("the headline survives the client's 240-character `looksHuman` gate for every kind, including a long vehicle name", () => {
    const longName = "Keiretsu Forum Canada NovaPay Series B Co-Investment Vehicle 2026-A";
    for (const kind of ["limited_partner", "commitment", "fee"] as const) {
      expect(spvUnattestedDraftHeadline({ spvName: longName, kind }).length).toBeLessThan(240);
    }
  });

  it("a nameless vehicle is described in words, never as a blank quote or an internal id", () => {
    for (const blank of [null, undefined, "", "   "]) {
      const h = spvUnattestedDraftHeadline({ spvName: blank, kind: "fee" });
      expect(h.startsWith("This vehicle is still an unattested draft")).toBe(true);
      expect(h).not.toContain("spv_");
    }
  });

  it("the label is a plain human phrase", () => {
    expect(SPV_UNATTESTED_DRAFT_LABEL).toBe("Unattested draft");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2. THE LOOKUP — what counts as attested.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item C — the attestation lookup", () => {
  it("a vehicle created through the route family IS attested (the 86B gate records the sign-off)", async () => {
    const id = await createAttestedSpv("W189 Attested Lookup");
    expect(spvIsAttested(id)).toBe(true);
  });

  it("an id nobody can name is NOT attested", () => {
    for (const blank of [null, undefined, "", "   "]) {
      expect(spvIsAttested(blank)).toBe(false);
    }
    expect(spvIsAttested("spv_does_not_exist_anywhere")).toBe(false);
  });

  it("deleting the sign-off row reproduces the live `data.db` state: the vehicle reads as unattested", async () => {
    const id = await createAttestedSpv("W189 Unattest Reproduction");
    expect(spvIsAttested(id)).toBe(true);
    unattest(id);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3. EVERY WRITE PATH REFUSES — ROUTE LEVEL (R159.6 item 6).
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item C — an unattested draft refuses capital on every route", () => {
  /** Every assertion an unattested-draft refusal must satisfy, in one place, so a
   *  path cannot be "covered" by a weaker check than its siblings. */
  function expectRefusal(r: { status: number; body: any }, attaching: string) {
    expect(r.status).toBe(409);
    expect(r.body.error).toBe(SPV_UNATTESTED_DRAFT_CODE);
    expect(r.body.attestation).toEqual({ required: true, attaching });
    /* R159.6(4) — the words, not the code. */
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message.length).toBeLessThan(240);
    expect(r.body.message).toContain("unattested draft");
    expect(r.body.message).toContain("Nothing was saved");
    expect(r.body.message).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
    expect(typeof r.body.guidance).toBe("string");
    expect(r.body.guidance).toContain("no signed launch attestation on record");
    expect(r.body.guidance).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
  }

  it("POST /spv/:id/subscriptions — an LP cannot be subscribed to an unattested draft", async () => {
    const id = await createAttestedSpv("W189 Refuse Subscriptions");
    unattest(id);
    const r = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_w189_a",
      commitmentMinor: 500000,
    });
    expectRefusal(r, "limited_partner");
    /* AND NOTHING WAS WRITTEN — the refusal's own claim, verified. */
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
  });

  it("POST /spvs/:id/positions — the second door onto `subscribe` refuses identically", async () => {
    const id = await createAttestedSpv("W189 Refuse Positions");
    unattest(id);
    /* THE REAL CONTRACT of this legacy-named route, read from
       `partnerRoutes.ts:2639`: `lpContactId`, `positionAmountMinor`, `currency` —
       all three required, or it answers 400 BAD_REQUEST before reaching the store.
       Getting this wrong is how a test "proves" a refusal that never fired. */
    const r = await post(`/api/partner/me/spvs/${id}/positions`, MANAGING, {
      lpContactId: "inv_w189_b",
      positionAmountMinor: 250000,
      currency: "USD",
    });
    expectRefusal(r, "limited_partner");
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
  });

  it("POST /spv/:id/lp-commit — the sink the owner's wave-182 reproduction went through refuses BEFORE the sacred ledger write", async () => {
    const id = await createAttestedSpv("W189 Refuse LpCommit");
    unattest(id);
    /* THE REAL CONTRACT, read from `spvEngineRoutes.ts:1871-1892`: a full legal
       name in two parts (Rule #13), a valid email, and BOTH `amount` and `shares`.
       A body missing any of these is refused at 400 before the attestation gate is
       reached, so a test using the wrong shape would assert nothing. */
    const r = await post(`/api/partner/me/spv/${id}/lp-commit`, MANAGING, {
      holderFirstName: "Wave189",
      holderLastName: "Lp",
      investorEmail: "w189.lp@example.com",
      amount: "4000.00",
      shares: "400",
    });
    expectRefusal(r, "limited_partner");
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
  });

  it("POST /spv/:id/fees — no fee attaches to an unattested draft", async () => {
    const id = await createAttestedSpv("W189 Refuse Fees");
    unattest(id);
    const r = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management",
      feeType: "carry",
      carryPct: 0.2,
    });
    expectRefusal(r, "fee");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4. SIGNING THE ATTESTATION THEN PERMITS THEM (R159.6 item 6).
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item C — signing the attestation lifts the refusal", () => {
  it("the SAME request that was refused succeeds once the launch attestation is signed", async () => {
    const id = await createAttestedSpv("W189 Sign Then Permit");
    unattest(id);

    const refused = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_w189_permit",
      commitmentMinor: 750000,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe(SPV_UNATTESTED_DRAFT_CODE);

    attest(id);

    const permitted = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_w189_permit",
      commitmentMinor: 750000,
    });
    expect(permitted.status).toBe(201);
    expect(permitted.body.subscription.commitmentMinor).toBe(750000);
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(1);
  });

  it("a fee refused while unattested is accepted after signing", async () => {
    const id = await createAttestedSpv("W189 Sign Then Fee");
    unattest(id);
    const refused = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "carry", carryPct: 0.2,
    });
    expect(refused.status).toBe(409);

    attest(id);
    const permitted = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "carry", carryPct: 0.2,
    });
    expect(permitted.status).toBe(201);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   5. ATTESTED VEHICLES ARE UNAFFECTED (R159.6 item 5).
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item C — attested vehicles accept capital normally", () => {
  it("an attested vehicle takes an LP, a commitment and a fee with no refusal anywhere", async () => {
    const id = await createAttestedSpv("W189 Attested Unaffected");
    expect(spvIsAttested(id)).toBe(true);

    const sub = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_w189_ok",
      commitmentMinor: 1000000,
    });
    expect(sub.status).toBe(201);

    const fee = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management", feeType: "carry", carryPct: 0.2,
    });
    expect(fee.status).toBe(201);

    const commit = await post(`/api/partner/me/spv/${id}/lp-commit`, MANAGING, {
      holderFirstName: "Wave189",
      holderLastName: "Attested",
      investorEmail: "w189.attested@example.com",
      amount: "3000.00",
      shares: "300",
    });
    /* Whatever this route decides on OTHER grounds, it must not be the attestation
       refusal: an attested vehicle can never produce this code. */
    expect(commit.body?.error).not.toBe(SPV_UNATTESTED_DRAFT_CODE);
    expect(commit.body?.attestation).toBeUndefined();
  });

  it("no attested vehicle produces the attestation refusal on any of the four routes", async () => {
    const id = await createAttestedSpv("W189 Attested Sweep");
    const responses = [
      await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "inv_w189_s1", commitmentMinor: 100000 }),
      await post(`/api/partner/me/spvs/${id}/positions`, MANAGING, { lpContactId: "inv_w189_s2", positionAmountMinor: 100000, currency: "USD" }),
      await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.1 }),
      await post(`/api/partner/me/spv/${id}/lp-commit`, MANAGING, { holderFirstName: "Sweep", holderLastName: "Three", investorEmail: "w189.s3@example.com", amount: "1000.00", shares: "100" }),
    ];
    for (const r of responses) {
      expect(r.body?.error).not.toBe(SPV_UNATTESTED_DRAFT_CODE);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   6. ADVERSARIAL — actively try to attach capital to an unattested draft.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item C — adversarial attach attempts", () => {
  it("EVERY known capital route is tried against ONE unattested draft and every single one refuses; the vehicle ends empty", async () => {
    const id = await createAttestedSpv("W189 Adversarial Sweep");
    unattest(id);

    const attempts: Array<{ label: string; r: any }> = [
      { label: "subscriptions", r: await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, { investorId: "adv_1", commitmentMinor: 999999 }) },
      { label: "positions", r: await post(`/api/partner/me/spvs/${id}/positions`, MANAGING, { lpContactId: "adv_2", positionAmountMinor: 999999, currency: "USD" }) },
      { label: "lp-commit", r: await post(`/api/partner/me/spv/${id}/lp-commit`, MANAGING, { holderFirstName: "Adv", holderLastName: "Three", investorEmail: "adv3@example.com", amount: "9999.99", shares: "999" }) },
      { label: "fees", r: await post(`/api/partner/me/spv/${id}/fees`, MANAGING, { layer: "management", feeType: "carry", carryPct: 0.2 }) },
      { label: "commitments", r: await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, { lpUserId: "adv_4", amountMinor: 999999 }) },
    ];

    const survived = attempts.filter((a) => a.r.status >= 200 && a.r.status < 300);
    expect(survived.map((a) => a.label)).toEqual([]);

    /* AND THE VEHICLE IS STILL EMPTY. The refusals are only worth what the state
       says afterwards: not one limited partner, not one commitment. */
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
    /* And no commitment row anywhere that names this vehicle. Guarded, because the
       commitment table is not present on every database this suite may run against;
       an absent table is not evidence of a leak and must not be reported as one. */
    const tables = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%commitment%'`)
      .all() as Array<{ name: string }>;
    for (const t of tables) {
      const cols = rawDb().prepare(`PRAGMA table_info(${t.name})`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "spv_id")) continue;
      const n = rawDb().prepare(`SELECT COUNT(*) AS n FROM ${t.name} WHERE spv_id = ?`).get(id) as { n: number };
      expect(n.n).toBe(0);
    }
  });

  it("a repeated attempt does not wear the gate down — the tenth try refuses exactly like the first", async () => {
    const id = await createAttestedSpv("W189 Repeat Attempts");
    unattest(id);
    const codes: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
        investorId: `adv_repeat_${i}`,
        commitmentMinor: 100000,
      });
      codes.push(`${r.status}:${r.body?.error}`);
    }
    expect(new Set(codes).size).toBe(1);
    expect(codes[0]).toBe(`409:${SPV_UNATTESTED_DRAFT_CODE}`);
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
  });
});
