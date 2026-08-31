/**
 * WAVE 112 — ONE SPV ROUTE FAMILY, ONE COMMITTED FIGURE.
 *
 * Three findings converge on one number: "how much has this vehicle been
 * committed?" Two live route families answer it, and before this wave they
 * answered it from two independent registers.
 *
 *   ENGINE  (singular /api/partner/me/spv/...)
 *     canonical: subscriptions in the terminal `committed` state
 *     (spvEngineStore.committedRegister). This is the register that gates
 *     deployment (INSUFFICIENT_COMMITTED_CAPITAL) and allocates distributions.
 *
 *   LEGACY  (plural /api/partner/me/spvs/:id/detail)
 *     reconciliation.committedMinor, summed from the legacy `spv_commitments`
 *     table over rows whose status is `signed` or `funded`.
 *
 * The two disagree in BOTH directions, which is the correction this wave makes
 * to the audit's "the legacy one loses money" wording:
 *
 *   · lp-commit path  -> engine says the real figure, legacy says 0   (UNDER)
 *   · subscribe path  -> engine says 0, legacy says the full amount   (OVER)
 *
 * Every assertion below compares the two families AGAINST EACH OTHER, never
 * each against a literal, so the test cannot be satisfied by moving one number
 * and forgetting the other.
 *
 * PRE-WAVE FAILURES (recorded in build_log/wave112/W112_TESTS.md):
 *   1. same figure, lp-commit path      -> legacy "0"    vs engine 1000000
 *   2. same figure, subscribe path      -> legacy "500000" vs engine 0
 *   3. amended amount not double-counted (passes before AND after; it is the
 *      proof that the chosen design cannot re-introduce B-42's double-count)
 *   4. repeated submit idempotent       (ditto)
 *   5. concurrent submits               (ditto)
 *   6. a commitment cannot render without its ledger entry -> before this
 *      wave the roster showed status "committed" with no ledger line.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { recordLpCommitIdentity, listLpInvites } from "../spvLpInviteStore";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_COMMIT_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
const PARTNER_ID = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}
function get(p: string) {
  return request(app).get(p).set("x-user-id", MANAGING);
}

async function newSpv(name: string): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  return c.body.spv.id as string;
}

/** THE ENGINE FAMILY's committed figure, as the money gates compute it. */
function engineCommittedMinor(spvId: string): bigint {
  return spvEngineStore
    .committedRegister(PARTNER_ID, spvId)
    .reduce((a, r) => a + BigInt(r.commitmentMinor), BigInt(0));
}

/** THE LEGACY FAMILY's committed figure, over the wire, as a partner sees it. */
async function legacyCommittedMinor(spvId: string): Promise<bigint> {
  const d = await get(`/api/partner/me/spvs/${spvId}/detail`);
  expect(d.status).toBe(200);
  return BigInt(String(d.body.reconciliation.committedMinor));
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvLegacyAdapterRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W112 F1/F2 — both SPV route families report ONE committed figure", () => {
  /* WAVE 226 · R195.5 + R202 — THE COMPANION INVERSION.
     Every proof in this suite reaches its convergence assertion by first driving a
     successful lp-commit. As written, that made an UNGATED commit an unstated
     precondition of the whole file. Wave 211 retired that contract, so this test is
     added FIRST to pin the new one from the other side: without the operator
     attestation the same route refuses, and BOTH families still report zero, so the
     convergence proofs below cannot be reached by an unattested write.

     R195.5: nothing was deleted to make room for this. The proofs below are re-pointed,
     not narrowed, and the gate's own HTTP proofs live in
     `server/__tests__/wave211_money_event_gate_http.test.ts`. */
  it("WAVE 226 — the SAME commit with NO attestation is refused, and neither family moves", async () => {
    const spvId = await newSpv("W226 Unattested LpCommit");
    const before = engineCommittedMinor(spvId);
    const cm = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      holderFirstName: "Dana",
      holderLastName: "Whitfield",
      investorEmail: "w226-unattested@example.com",
      amount: "10000",
      shares: "10000",
    });
    expect(cm.status).toBe(400);
    /* The SPECIFIC refusal — the attestation — not merely "some refusal". */
    expect(String(cm.body.error ?? "")).toMatch(/^WAVE211_/);
    expect(String(cm.body.message ?? "")).toContain("Nothing was recorded.");
    /* And the promise is TRUE on BOTH families, which is this file's whole subject.
       Compared as the same types the passing proofs compare, with no normalising call. */
    expect(engineCommittedMinor(spvId)).toBe(before);
    expect(await legacyCommittedMinor(spvId)).toBe(before);
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId)).toHaveLength(0);
  });

  it("agrees on the lp-commit path (pre-wave: legacy reported 0)", async () => {
    const spvId = await newSpv("W112 Converge LpCommit");
    const cm = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Dana",
      holderLastName: "Whitfield",
      investorEmail: "w112-dana@example.com",
      amount: "10000",
      shares: "10000",
    });
    expect(cm.status).toBe(201);

    const engine = engineCommittedMinor(spvId);
    const legacy = await legacyCommittedMinor(spvId);
    /* Asserted against EACH OTHER. */
    expect(legacy).toBe(engine);
    /* And it is not zero on both sides — the trivially-agreeing degenerate case
       is explicitly excluded, so this cannot be satisfied by breaking both. */
    expect(engine > BigInt(0)).toBe(true);
  });

  it("agrees on the subscribe path, where LEGACY used to report MORE than the engine", async () => {
    const spvId = await newSpv("W112 Converge Subscribe");
    /* subscribe() lands a subscription in `review`, NOT `committed`, and
       shadow-writes a legacy `spv_commitments` row with status `signed`.
       reconcileSpv counts signed -> legacy over-reported uncommitted capital as
       committed capital, which is the opposite direction to B-42. */
    spvEngineStore.subscribe(PARTNER_ID, spvId, {
      investorId: "u_investor_w112_sub",
      commitmentMinor: 500000,
    });

    const engine = engineCommittedMinor(spvId);
    const legacy = await legacyCommittedMinor(spvId);
    expect(legacy).toBe(engine);
    /* The engine's money gates do not count a review-stage subscription, so the
       agreed figure here is zero — and the legacy read must say so rather than
       advertise capital no gate would honour. */
    expect(engine).toBe(BigInt(0));
  });

  it("still agrees after the subscription is advanced all the way to committed", async () => {
    const spvId = await newSpv("W112 Converge Advance");
    const sub = spvEngineStore.subscribe(PARTNER_ID, spvId, {
      investorId: "u_investor_w112_adv",
      commitmentMinor: 700000,
    });
    /* Straight to the terminal state via the projection, which is what the
       authoritative commit path uses; advanceSubscription's KYC/accreditation/
       e-sign gates are a separate concern and are not under test here. */
    spvEngineStore.projectLpCommitted(PARTNER_ID, spvId, {
      investorId: sub.investorId,
      commitmentMinor: 700000,
    });

    const engine = engineCommittedMinor(spvId);
    const legacy = await legacyCommittedMinor(spvId);
    expect(legacy).toBe(engine);
    expect(engine).toBe(BigInt(700000));
  });
});

describe("W112 F2 — no double-count is possible, by construction", () => {
  it("an AMENDED amount replaces the figure; it never sums old + new", async () => {
    const spvId = await newSpv("W112 Amend");
    const body = {
      holderFirstName: "Ozan",
      holderLastName: "Isinak",
      investorEmail: "w112-amend@example.com",
      shares: "10000",
    };
    const first = await post(`/api/partner/me/spv/${spvId}/lp-commit`, { ...W226_LP_COMMIT_ATT, ...body, amount: "10000" });
    expect(first.status).toBe(201);
    const afterFirst = await legacyCommittedMinor(spvId);
    expect(afterFirst).toBe(engineCommittedMinor(spvId));

    /* The AMENDMENT. This is the exact case the previous agent refused to fix
       by writing into the legacy register: its idempotency key is
       (spvId, lpUserId, amountMinor), so a changed amount inserts a SECOND row
       and the rollup double-counts. This wave adds no such write, so there is
       nothing to double-count. */
    const amended = await post(`/api/partner/me/spv/${spvId}/lp-commit`, { ...W226_LP_COMMIT_ATT, ...body, amount: "25000" });
    expect(amended.status).toBe(200);
    expect(amended.body.idempotent).toBe(true);

    const engine = engineCommittedMinor(spvId);
    const legacy = await legacyCommittedMinor(spvId);
    expect(legacy).toBe(engine);
    /* 2_500_000 minor, NOT 1_000_000 + 2_500_000. */
    expect(engine).toBe(BigInt(2500000));
    expect(engine).not.toBe(BigInt(3500000));

    /* And exactly ONE roster row for this limited partner. */
    const subs = spvEngineStore.listSubscriptions(PARTNER_ID, spvId);
    expect(subs).toHaveLength(1);
  });

  it("a REPEATED identical submit is idempotent on both families", async () => {
    const spvId = await newSpv("W112 Repeat");
    const body = {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Rae",
      holderLastName: "Okonjo",
      investorEmail: "w112-repeat@example.com",
      amount: "12345.67",
      shares: "1000",
    };
    const a = await post(`/api/partner/me/spv/${spvId}/lp-commit`, body);
    expect(a.status).toBe(201);
    const afterOne = engineCommittedMinor(spvId);

    const b = await post(`/api/partner/me/spv/${spvId}/lp-commit`, body);
    expect(b.status).toBe(200);
    expect(b.body.idempotent).toBe(true);

    const engine = engineCommittedMinor(spvId);
    const legacy = await legacyCommittedMinor(spvId);
    expect(engine).toBe(afterOne);
    expect(legacy).toBe(engine);
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId)).toHaveLength(1);
  });

  it("two CONCURRENT submits cannot both insert", async () => {
    const spvId = await newSpv("W112 Concurrent");
    const body = {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Sam",
      holderLastName: "Oyelaran",
      investorEmail: "w112-concurrent@example.com",
      amount: "5000",
      shares: "500",
    };
    const [r1, r2] = await Promise.all([
      post(`/api/partner/me/spv/${spvId}/lp-commit`, body),
      post(`/api/partner/me/spv/${spvId}/lp-commit`, body),
    ]);
    expect([r1.status, r2.status].every((s) => s === 200 || s === 201)).toBe(true);

    /* ONE subscription row, ONE identity row, and the two families agree. */
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId)).toHaveLength(1);
    const identities = listLpInvites(PARTNER_ID, spvId)
      .filter((i) => i.email.toLowerCase() === "w112-concurrent@example.com");
    expect(identities).toHaveLength(1);

    const engine = engineCommittedMinor(spvId);
    const legacy = await legacyCommittedMinor(spvId);
    expect(legacy).toBe(engine);
    expect(engine).toBe(BigInt(500000));
  });
});

describe("W112 F3 — a commitment can never render without its ledger entry", () => {
  it("an identity row advanced to `committed` with NO ledger line is not shown as committed", async () => {
    const spvId = await newSpv("W112 HalfState");
    /* Reproduce EXACTLY the half-state Reviewer B named (B-38): the identity
       write succeeds, the ledger write does not happen. Calling the identity
       writer directly is the honest reproduction — it is the first of the two
       writes in the lp-commit route, and there is no transaction spanning it
       and the sacred ledger. */
    const identity = recordLpCommitIdentity(
      PARTNER_ID,
      spvId,
      { email: "w112-halfstate@example.com", firstName: "Half", lastName: "State" },
      MANAGING,
    );
    /* The store did what it was asked: the row IS `committed`. */
    expect(identity.invite.status).toBe("committed");

    /* No ledger entry, and therefore no roster subscription. */
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, spvId)).toHaveLength(0);

    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    expect(roster.status).toBe(200);
    const invites = roster.body.invites as Array<{
      email: string;
      status: string;
      commitmentUnconfirmed?: boolean;
    }>;
    const row = invites.find((i) => i.email === "w112-halfstate@example.com");
    expect(row).toBeDefined();
    /* THE LIE, pre-wave: this read "committed" on a roster with $0 behind it. */
    expect(row!.status).not.toBe("committed");
    expect(row!.commitmentUnconfirmed).toBe(true);

    /* And the money figure both families report is still zero, so nothing about
       this half-state can be mistaken for capital. */
    expect(await legacyCommittedMinor(spvId)).toBe(engineCommittedMinor(spvId));
    expect(engineCommittedMinor(spvId)).toBe(BigInt(0));
  });

  it("a real commit — identity AND ledger — DOES render as committed", async () => {
    const spvId = await newSpv("W112 HalfState Positive");
    const cm = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Whole",
      holderLastName: "State",
      investorEmail: "w112-wholestate@example.com",
      amount: "9000",
      shares: "900",
    });
    expect(cm.status).toBe(201);
    /* The honest reader must NOT be satisfiable by refusing everyone: a
       genuinely committed LP is seated as a subscriber, at the real figure. */
    const roster = await get(`/api/partner/me/spv/${spvId}/lp-roster`);
    const subs = roster.body.subscribers as Array<{ email: string | null; status: string; commitmentMinor: number }>;
    const seated = subs.find((s) => s.email === "w112-wholestate@example.com");
    expect(seated).toBeDefined();
    expect(seated!.status).toBe("committed");
    expect(seated!.commitmentMinor).toBe(900000);
    expect(await legacyCommittedMinor(spvId)).toBe(engineCommittedMinor(spvId));
  });
});
