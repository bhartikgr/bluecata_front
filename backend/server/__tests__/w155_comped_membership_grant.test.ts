/**
 * WAVE 155 — THE ADMIN-GRANTED (COMPED) MEMBERSHIP. R123.1, R124.4.3, R113.3, R77.
 *
 * WHAT IS BEING PINNED, and why each pin exists:
 *
 *  1. GRANTING PUTS A COMPANY IN GOOD STANDING **AS THE GATE READER SEES IT**.
 *     Asserted against `resolveCompanyMembership` / `resolvePartnerAccountMembership`
 *     from `server/lib/spvEligibilityGate.ts` — the SAME functions
 *     `evaluateLaunchGate` calls — and against `evaluateLaunchGate` itself, so a
 *     pass here cannot be a second reader agreeing with itself.
 *  2. REVOKING REMOVES STANDING BUT RETAINS THE RECORD. `revoked_at` is stamped,
 *     the row is still in the ledger, and the reason for ending it is on it.
 *  3. A COMPED MEMBERSHIP NEVER APPEARS AS PAID REVENUE. Three independent
 *     assertions: the sacred billing table gains ZERO rows; the admin API says
 *     `isRevenue: false` and never labels it "Paid"; and the ledger row has no
 *     amount or currency field at all.
 *  4. A REASON IS REQUIRED and the ACTOR IS BOUND to the session — the
 *     `intent_required` / `actor_required` pattern with no placeholder fallback.
 *
 * At least one assertion is on a REAL API RESPONSE through the real Express
 * router with the real `requireAdmin` guard, not on source text.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import { registerAdminCompedMembershipRoutes } from "../adminCompedMembershipRoutes";
import {
  grantCompedMembership,
  revokeCompedMembership,
  listAllGrants,
  getGrant,
  isGrantLive,
  isRevenue,
  ensureCompedMembershipSchema,
  CompedMembershipWriteError,
} from "../lib/compedMembershipStore";
import {
  resolveCompanyMembership,
  resolvePartnerAccountMembership,
  renderMembershipStanding,
  evaluateLaunchGate,
} from "../lib/spvEligibilityGate";
import { listForCompany } from "../subscriptionStore";
import { rawDb } from "../db/connection";

const COMPANY = "co_w155_comped_company";
const COMPANY_REVOKE = "co_w155_comped_revoked";
const PARTNER = "ac_w155_comped_partner";
const ADMIN = "u_admin";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerAdminCompedMembershipRoutes(app);
  ensureCompedMembershipSchema();
});

describe("W155-1 — the gate reader treats a comped membership as good standing", () => {
  it("1a: BEFORE any grant the company is NOT in good standing", () => {
    const before = resolveCompanyMembership(COMPANY);
    expect(before.state).not.toBe("paid");
  });

  it("1b: AFTER the grant the gate's own reader says paid, on a COMPED basis", () => {
    grantCompedMembership({
      subjectKind: "company",
      subjectId: COMPANY,
      reason: "Launch-week comp agreed with the owner while the payment path is unconfigured.",
      grantedBy: ADMIN,
    });
    const after = resolveCompanyMembership(COMPANY);
    expect(after.state).toBe("paid");
    expect(after.basis).toBe("comped");
    expect(after.compedGrantId).toBeTruthy();
    /* R77 — the provenance sentence itself says no payment was taken. */
    expect(after.reason).toMatch(/comped membership/i);
    expect(after.reason).toMatch(/no payment taken/i);
  });

  it("1c: `evaluateLaunchGate` — the decision function, not just the reader — allows it", () => {
    const decision = evaluateLaunchGate({ spvId: null, companyIds: [COMPANY] });
    expect(decision.allowed).toBe(true);
    expect(decision.blocking).toHaveLength(0);
    expect(decision.code).toBeNull();
  });

  it("1d: a PARTNER account can be comped too (R122.2 blind-pool path)", () => {
    expect(resolvePartnerAccountMembership(PARTNER).state).not.toBe("paid");
    grantCompedMembership({
      subjectKind: "partner",
      subjectId: PARTNER,
      reason: "Comped partner account for the pending install.",
      grantedBy: ADMIN,
    });
    const m = resolvePartnerAccountMembership(PARTNER);
    expect(m.state).toBe("paid");
    expect(m.basis).toBe("comped");
    /* A blind-pool create names no company, so this is the standing checked. */
    const decision = evaluateLaunchGate({ spvId: null, companyIds: [], partnerId: PARTNER });
    expect(decision.allowed).toBe(true);
  });
});

describe("W155-2 — a comped membership is NEVER paid revenue", () => {
  it("2a: the sacred `capavate_subscriptions` table gains NO row from a grant", () => {
    /* The grant in 1b already happened. The sacred store is CALL-ONLY and was
       never asked to write, so its own reader must still see nothing. */
    expect(listForCompany(COMPANY)).toHaveLength(0);
  });

  it("2b: the ledger row carries no amount and no currency to sum", () => {
    const g = listAllGrants().find((x) => x.subjectId === COMPANY)!;
    expect(g).toBeTruthy();
    expect(Object.keys(g)).not.toContain("amountMinor");
    expect(Object.keys(g)).not.toContain("currency");
    expect(isRevenue(g)).toBe(false);
  });

  it("2c: the standing label says COMPED, never the same word as a paid member", () => {
    const comped = renderMembershipStanding({ state: "paid", basis: "comped" });
    expect(comped).toBe("Comped by Capavate (no payment taken)");
    expect(comped).not.toBe("Paid");
    expect(renderMembershipStanding({ state: "paid", basis: "paid" })).toBe("Paid");
    /* R111 Q13 — unreadable state is "Not on record", never "unpaid". */
    expect(renderMembershipStanding({ state: "unknown", basis: null })).toBe("Not on record");
  });

  it("2d: the grant table itself has no money column (schema-level, not naming)", () => {
    const cols = (
      rawDb().prepare(`PRAGMA table_info(comped_membership_grant)`).all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols.length).toBeGreaterThan(0);
    for (const forbidden of ["amount", "amount_minor", "currency", "price", "invoice_id"]) {
      expect(cols).not.toContain(forbidden);
    }
  });
});

describe("W155-3 — REVOKE, never delete", () => {
  it("3a: revoking removes standing but keeps the record and the reason", () => {
    const granted = grantCompedMembership({
      subjectKind: "company",
      subjectId: COMPANY_REVOKE,
      reason: "Temporary comp for evaluation.",
      grantedBy: ADMIN,
    });
    expect(resolveCompanyMembership(COMPANY_REVOKE).state).toBe("paid");

    const revoked = revokeCompedMembership({
      id: granted.id,
      revokedBy: ADMIN,
      reason: "Evaluation finished; the company is on a paid plan from today.",
    });
    expect(revoked.revokedAt).toBeTruthy();
    expect(revoked.revokedBy).toBe(ADMIN);
    expect(revoked.revokeReason).toMatch(/Evaluation finished/);

    /* Standing gone … */
    expect(resolveCompanyMembership(COMPANY_REVOKE).state).not.toBe("paid");
    expect(isGrantLive(revoked)).toBe(false);
    /* … record retained. */
    const still = getGrant(granted.id);
    expect(still).not.toBeNull();
    expect(still!.reason).toMatch(/Temporary comp/);
    expect(listAllGrants().some((g) => g.id === granted.id)).toBe(true);
  });

  it("3b: there is no DELETE statement anywhere in the store", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/lib/compedMembershipStore.ts", "utf8"),
    );
    expect(/DELETE\s+FROM\s+comped_membership_grant/i.test(src)).toBe(false);
  });
});

describe("W155-4 — a reason is required and the actor is bound", () => {
  it("4a: the store refuses a grant with no reason", () => {
    expect(() =>
      grantCompedMembership({
        subjectKind: "company",
        subjectId: "co_w155_no_reason",
        reason: "   ",
        grantedBy: ADMIN,
      }),
    ).toThrow(CompedMembershipWriteError);
  });

  it("4b: the store refuses a grant with no identifiable actor (no placeholder)", () => {
    try {
      grantCompedMembership({
        subjectKind: "company",
        subjectId: "co_w155_no_actor",
        reason: "Should never be written.",
        grantedBy: "",
      });
      throw new Error("expected a refusal");
    } catch (err) {
      expect((err as CompedMembershipWriteError).code).toBe("COMPED_ACTOR_REQUIRED");
    }
    expect(listAllGrants().some((g) => g.subjectId === "co_w155_no_actor")).toBe(false);
  });
});

describe("W155-5 — REAL API responses through the real router", () => {
  it("5a: POST with no reason is refused 400 `intent_required` in plain language", async () => {
    const res = await request(app)
      .post("/api/admin/comped-memberships")
      .set("x-user-id", ADMIN)
      .send({ subjectKind: "company", subjectId: "co_w155_api_norrs" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("intent_required");
    expect(res.body.message).toMatch(/recorded permanently/i);
  });

  it("5b: POST grants, and the response never presents it as money", async () => {
    const res = await request(app)
      .post("/api/admin/comped-memberships")
      .set("x-user-id", ADMIN)
      .send({
        subjectKind: "company",
        subjectId: "co_w155_api_company",
        reason: "Comped through the admin API for the pending install.",
      });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.grant.isRevenue).toBe(false);
    expect(res.body.grant.standingLabel).toBe("Comped by Capavate (no payment taken)");
    expect(res.body.grant.grantedBy).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/amountMinor|"currency"/);
  });

  it("5c: GET standing reports good standing on a comped basis", async () => {
    const res = await request(app)
      .get("/api/admin/comped-memberships/standing")
      .query({ subjectKind: "company", subjectId: "co_w155_api_company" })
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.inGoodStanding).toBe(true);
    expect(res.body.basis).toBe("comped");
    expect(res.body.standingLabel).toBe("Comped by Capavate (no payment taken)");
    expect(res.body.isRevenue).toBe(false);
  });

  it("5d: POST revoke ends it, says the record is kept, and standing drops", async () => {
    const list = await request(app)
      .get("/api/admin/comped-memberships")
      .set("x-user-id", ADMIN);
    expect(list.status).toBe(200);
    const target = list.body.grants.find(
      (g: { subjectId: string; live: boolean }) =>
        g.subjectId === "co_w155_api_company" && g.live,
    );
    expect(target).toBeTruthy();

    const noReason = await request(app)
      .post(`/api/admin/comped-memberships/${target.id}/revoke`)
      .set("x-user-id", ADMIN)
      .send({});
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("intent_required");

    const res = await request(app)
      .post(`/api/admin/comped-memberships/${target.id}/revoke`)
      .set("x-user-id", ADMIN)
      .send({ reason: "The company has started paying." });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/kept for history/i);
    /* The word "deleted" appears ONLY in the negative ("it is not deleted"). */
    expect(res.body.message).toMatch(/not deleted/i);
    expect(res.body.message).not.toMatch(/has been deleted|was deleted/i);
    expect(res.body.grant.live).toBe(false);

    const after = await request(app)
      .get("/api/admin/comped-memberships/standing")
      .query({ subjectKind: "company", subjectId: "co_w155_api_company" })
      .set("x-user-id", ADMIN);
    expect(after.body.inGoodStanding).toBe(false);

    /* The row is STILL in the ledger after the revoke. */
    const relist = await request(app)
      .get("/api/admin/comped-memberships")
      .set("x-user-id", ADMIN);
    expect(relist.body.grants.some((g: { id: string }) => g.id === target.id)).toBe(true);
  });

  it("5e: a non-admin caller gets nothing (real requireAdmin guard)", async () => {
    /* No identity header. `getUserContext` falls back to a non-admin demo
       persona, so the guard refuses with ADMIN_REQUIRED rather than
       UNAUTHORIZED. Either way NO ledger data leaves the server — that is what
       is being pinned, and the exact status is recorded rather than assumed. */
    const res = await request(app).get("/api/admin/comped-memberships");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ADMIN_REQUIRED");
    expect(res.body.grants).toBeUndefined();
  });
});
