/**
 * WAVE 162 · BATCH 3 · ITEM B — ENUM VALIDATION FIRST, THEN THE TRANSITION MAP.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. `spvEngineRoutes.ts` passed `req.body.to` into
 * `advanceSubscription` with NO zod schema and NO enum check, and the store
 * assigned it straight onto the row. Measured consequences, all three real:
 *
 *   1. An ARBITRARY STRING persisted as a subscription status, into a
 *      hash-chained status column. A row reading `"committedd"` is neither
 *      `committed` nor `withdrawn`, so it silently joined every all-stages
 *      basis while being invisible to every committed-only one — precisely the
 *      class of defect wave 161 spent a whole wave fencing.
 *   2. The request body was forwarded WHOLESALE as the `data` argument, so a
 *      JSON **string** reached `wiredMinor`.
 *   3. `committed → soft_circled` was LEGAL, which REMOVED confirmed capital
 *      from a vehicle with no reason, no record and no audit entry. This is the
 *      live hole and §3 is the proof it is closed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * (1) `spv_subscription` has ZERO rows on every database available to this wave.
 *     "Existing records unchanged" would therefore be a claim about nothing, so
 *     every section CONSTRUCTS its rows through the real writers, and §3 and §4
 *     snapshot the row AND the vehicle's canonical committed figure across the
 *     refusal rather than merely asserting a status code.
 * (2) §1–§5 assert REAL HTTP RESPONSES driven through supertest against
 *     `registerSpvEngineRoutes`. The defect was in what a caller is served, and
 *     a store-level assertion cannot tell a 400 from a 500.
 * (3) The forward-skip proof (§5) captures the RECORD — the logger line — rather
 *     than asserting that recording happens. A claim that something is "visible"
 *     is not evidence that it is.
 * (4) §7 is R136.4: the `waveB_stage2_canonicalization` failure, investigated
 *     rather than assumed pre-existing, with the evidence pinned as a test.
 *
 * BINDING RULINGS HONOURED. R135.2 (`soft_circled → wire_funded` is refused,
 * §4). R135.9 (`shadowCommitmentToEngine` is ALLOW-LISTED, not re-routed, §6).
 * R136.2 (forward skips are RECORDED, not refused — the policy value is NOT
 * flipped, §5). R105 (the `advanceSubscription` gates are untouched, §5 relies on
 * them still firing). R77 (§8 — no refusal reaches a person as a bare code).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { getDb, rawDb } from "../db/connection";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import {
  spvEngineStore,
  canonicalCommittedMinorForSpv,
  shadowCommitmentToEngine,
  shadowPersistPartnerSpvToEngine,
  engineAddCommitment,
  engineTransitionCommitment,
  engineRecordCapitalCall,
  engineReconcileLegacySpv,
  committedSubscriptionsForSpv,
} from "../spvEngineStore";
import { spvFundStore } from "../spvFundStore";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import {
  SPV_SUBSCRIPTION_TRANSITIONS,
  SPV_SUBSCRIPTION_LADDER,
  SPV_SUBSCRIPTION_FORWARD_SKIP_POLICY,
  SPV_SUBSCRIPTION_STATUS_WRITER_ALLOWLIST,
  spvSubscriptionTransitionLegality,
  spvSubscriptionWriterMayWriteStatus,
  isSpvSubscriptionStatus,
  isSpvMoneyMinor,
} from "@shared/spvSubscriptionTransitions";
import { SPV_SUBSCRIPTION_STATUSES, type SpvSubscriptionStatus } from "@shared/spvEngine";
import {
  SPV_SUBSCRIPTION_REFUSAL_CODES,
  SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS,
  spvSubscriptionRefusalCopy,
  spvSubscriptionRefusalHeadline,
  spvSubscriptionRefusalHeadlinesOverLimit,
} from "@shared/spvSubscriptionRefusalCopy";
/* Read through the CLIENT module too, because that is the import path the
   surfaces use. If the wave-162 re-export ever breaks, a GP stops getting words
   even though the shared module is fine. */
import {
  SPV_SUBSCRIPTION_REFUSAL_COPY as CLIENT_COPY,
  spvSubscriptionRefusalCopy as clientCopyFn,
} from "../../client/src/lib/serverRefusalMessage";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/* Non-round sentinels: no seed, migration or default in this tree carries them,
   so a figure that matches one can only have come from this fixture. */
const COMMITTED_MINOR = 4_300_019; // $43,000.19
const SOFT_CIRCLE_MINOR = 7_700_053; // $77,000.53
const SKIP_COMMIT_MINOR = 5_500_029; // $55,000.29

/** The exact string the defect used to persist. Not a real status, and one
 *  keystroke from one, which is the whole point. */
const GARBAGE_STATUS = "committedd";

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const post = (p: string, u: string, b?: unknown) => request(app).post(p).set("x-user-id", u).send(b ?? {});
const put = (p: string, u: string, b?: unknown) => request(app).put(p).set("x-user-id", u).send(b ?? {});
const patch = (p: string, u: string, b?: unknown) => request(app).patch(p).set("x-user-id", u).send(b ?? {});

async function createSpv(name: string): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.spv.id as string;
}

/** A `review` subscription, created through the real writer. */
async function subscribe(spvId: string, investorId: string, minor: number): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId,
    commitmentMinor: minor,
    currency: "USD",
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  expect(sub.body.subscription.status).toBe("review");
  return sub.body.subscription.id as string;
}

/** The row as the DATABASE holds it — not the RAM cache — so a "nothing was
 *  written" claim is made against the persisted truth. */
function rowFromDb(subId: string): { status: string; wired_minor: unknown; commitment_minor: unknown } | undefined {
  return db()
    .prepare("SELECT status, wired_minor, commitment_minor FROM spv_subscription WHERE id = ?")
    .get(subId);
}

/** Every refusal a person can be served must be words. Applied to EVERY refusal
 *  this file provokes, so no assertion here can pass on a bare enum. */
function expectPlainSentence(body: any, forbiddenCode: string): void {
  const msg = body?.message;
  expect(typeof msg, JSON.stringify(body)).toBe("string");
  expect(String(msg).length).toBeGreaterThan(40);
  /* Not the code, and not merely "not equal to" it — the code must not appear
     ANYWHERE in the sentence, because `ILLEGAL_SUBSCRIPTION_TRANSITION` embedded
     mid-paragraph is still an enum on a GP's screen. */
  expect(String(msg)).not.toContain(forbiddenCode);
  expect(String(msg)).not.toMatch(/[A-Z]{4,}_[A-Z_]{4,}/);
  /* It reads like a sentence: lower-case letters and terminal punctuation. */
  expect(String(msg)).toMatch(/[a-z]/);
  expect(String(msg).trim().endsWith(".")).toBe(true);
  /* And it survives `queryClient.ts:60-65`'s 240-char `looksHuman` gate, so it
     reaches `e.message` intact instead of being swapped for a generic line. */
  expect(String(msg).length).toBeLessThan(SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS);
  /* The unabridged sentence travels beside it for payload-reading surfaces. */
  expect(typeof body?.guidance).toBe("string");
  expect(String(body.guidance).length).toBeGreaterThan(120);
  /* The code is still ON the response — added beside the words, not substituted
     for them, so an operator quoting it in a ticket can still find it (R44). */
  expect(typeof body?.error).toBe("string");
  expect(String(body.error)).toContain(forbiddenCode);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  /* Inherited vacuity trap (wave 160/161): without all three schemas, charges
     fail with `CHARGE_FAILED — no such column` and the gate assertions in §5
     would be measuring a schema error rather than a gate. */
  ensureWave152PricingSchema(db());
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §1 — AN ARBITRARY STATUS STRING IS REFUSED WITH A 400 AND A PLAIN SENTENCE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §1 — the enum check at the route boundary (T-B.1)", () => {
  it("T1.1: an arbitrary status string is refused with 400 and words, and NOTHING is persisted", async () => {
    const spvId = await createSpv("W162 garbage status");
    const subId = await subscribe(spvId, "u_w162_garbage_lp", COMMITTED_MINOR);
    const before = rowFromDb(subId);
    expect(before?.status).toBe("review");

    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: GARBAGE_STATUS,
    });

    /* THE STATUS CODE. Before this wave the string was accepted (200) and
       persisted; a naive fix would have made it a 500. It is a 400. */
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expectPlainSentence(res.body, "INVALID_SUBSCRIPTION_STATUS");
    /* The refusal names the offending FIELD so a control can point at it. */
    expect(res.body.fieldError).toBe("to");

    /* THE PERSISTED ROW IS UNTOUCHED — asserted against the DB, not the cache. */
    const after = rowFromDb(subId);
    expect(after?.status).toBe("review");
    expect(after).toEqual(before);
    /* And the garbage exists nowhere in the table at all. */
    const anyGarbage = db()
      .prepare("SELECT COUNT(*) c FROM spv_subscription WHERE status = ?")
      .get(GARBAGE_STATUS) as { c: number };
    expect(anyGarbage.c).toBe(0);
  });

  it("T1.2: a non-string `to` is refused, not coerced (an object would have become \"[object Object]\")", async () => {
    const spvId = await createSpv("W162 nonstring status");
    const subId = await subscribe(spvId, "u_w162_nonstring_lp", COMMITTED_MINOR);

    for (const bad of [{ committed: true }, 7, ["committed"], true]) {
      const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: bad });
      expect(res.status, `to=${JSON.stringify(bad)}: ${JSON.stringify(res.body)}`).toBe(400);
      expectPlainSentence(res.body, "INVALID_SUBSCRIPTION_STATUS");
    }
    expect(rowFromDb(subId)?.status).toBe("review");
  });

  it("T1.3: a MISSING `to` is its own refusal with its own sentence, not a crash", async () => {
    const spvId = await createSpv("W162 missing status");
    const subId = await subscribe(spvId, "u_w162_missing_lp", COMMITTED_MINOR);

    for (const body of [{}, { to: "" }, { to: null }]) {
      const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, body);
      expect(res.status, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(400);
      expectPlainSentence(res.body, "SUBSCRIPTION_STATUS_REQUIRED");
    }
    expect(rowFromDb(subId)?.status).toBe("review");
  });

  it("T1.4: every REAL status is accepted BY THE ENUM CHECK — the guard refuses garbage, not the vocabulary", () => {
    for (const s of SPV_SUBSCRIPTION_STATUSES) expect(isSpvSubscriptionStatus(s)).toBe(true);
    for (const s of [GARBAGE_STATUS, "Committed", " committed", "", null, undefined, 1, {}]) {
      expect(isSpvSubscriptionStatus(s as unknown)).toBe(false);
    }
    /* No trimming and no case-folding: an unrecognised value is a refusal, never
       a repair. `" committed"` really must be refused. */
    expect(isSpvSubscriptionStatus(" committed")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §2 — A JSON STRING CANNOT REACH `wiredMinor`.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §2 — money typing at the boundary (T-B.3)", () => {
  it("T2.1: `{ to: \"wire_funded\", wiredMinor: \"1000\" }` is refused with 400 and words; nothing persisted", async () => {
    const spvId = await createSpv("W162 wired string");
    const subId = await subscribe(spvId, "u_w162_wired_lp", COMMITTED_MINOR);
    /* Reach `founder_confirmed` legally first, so the ONLY thing left that can
       refuse this PATCH is the money type. Without this the test could pass on
       R135.2's transition refusal and prove nothing about `wiredMinor`. */
    for (const to of ["soft_circled", "founder_confirmed"]) {
      const step = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to });
      expect(step.status, `${to}: ${JSON.stringify(step.body)}`).toBe(200);
    }
    const before = rowFromDb(subId);
    expect(before?.status).toBe("founder_confirmed");

    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "wire_funded",
      wiredMinor: "1000",
    });

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expectPlainSentence(res.body, "INVALID_WIRED_MINOR");
    expect(res.body.fieldError).toBe("wiredMinor");

    /* THE ROW DID NOT MOVE AND NO AMOUNT LANDED. The status check and the money
       check both run BEFORE any field assignment, so a refused PATCH cannot have
       half-succeeded. */
    const after = rowFromDb(subId);
    expect(after?.status).toBe("founder_confirmed");
    expect(after).toEqual(before);
    expect(Number(after?.wired_minor ?? 0)).toBe(0);
    /* And no row in the table holds a text amount. */
    const textAmounts = db()
      .prepare("SELECT COUNT(*) c FROM spv_subscription WHERE typeof(wired_minor) = 'text'")
      .get() as { c: number };
    expect(textAmounts.c).toBe(0);
  });

  it("T2.2: a float, a negative and a huge value are refused too; a whole integer is accepted", async () => {
    const spvId = await createSpv("W162 wired shapes");
    const subId = await subscribe(spvId, "u_w162_wired2_lp", COMMITTED_MINOR);
    for (const to of ["soft_circled", "founder_confirmed"]) {
      expect((await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to })).status).toBe(200);
    }
    for (const bad of [10.5, -1, Number.MAX_SAFE_INTEGER + 2, "1e3", null]) {
      const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
        to: "wire_funded",
        wiredMinor: bad,
      });
      expect(res.status, `wiredMinor=${String(bad)}: ${JSON.stringify(res.body)}`).toBe(400);
      expectPlainSentence(res.body, "INVALID_WIRED_MINOR");
      expect(rowFromDb(subId)?.status).toBe("founder_confirmed");
    }
    const ok = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "wire_funded",
      wiredMinor: 3_300_017,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(Number(rowFromDb(subId)?.wired_minor)).toBe(3_300_017);
  });

  it("T2.3: the money guard does no coercion — it is a predicate, not a parser", () => {
    for (const good of [0, 1, 100, Number.MAX_SAFE_INTEGER]) expect(isSpvMoneyMinor(good)).toBe(true);
    for (const bad of ["0", "1000", 1.5, -1, NaN, Infinity, null, undefined, {}, []]) {
      expect(isSpvMoneyMinor(bad as unknown)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §3 — THE LIVE HOLE: `committed → soft_circled` SILENTLY REMOVED CAPITAL.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §3 — a committed subscription cannot be stepped backwards (T-B.2)", () => {
  it("T3.1: `committed → soft_circled` is REFUSED, the row stays committed, and the vehicle's capital is unchanged", async () => {
    const spvId = await createSpv("W162 committed reversal");
    const lp = "u_w162_reversal_lp";
    await subscribe(spvId, lp, COMMITTED_MINOR);
    /* Reach `committed` through the authoritative projection writer, exactly as
       the cap-table commit path does. */
    const projected = spvEngineStore.projectLpCommitted(PARTNER, spvId, {
      investorId: lp,
      commitmentMinor: COMMITTED_MINOR,
      currency: "USD",
    });
    expect(projected.status).toBe("committed");
    const subId = projected.id;

    /* THE MONEY, BEFORE. This is what the defect used to remove. */
    const capitalBefore = canonicalCommittedMinorForSpv(spvId);
    expect(capitalBefore.toString()).toBe(String(COMMITTED_MINOR));
    const rowBefore = rowFromDb(subId);
    expect(rowBefore?.status).toBe("committed");

    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "soft_circled",
    });

    /* 409, not 400: `soft_circled` IS a real stage and the body is well-formed —
       it is the subscription's CURRENT STATE that forbids the move. */
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expectPlainSentence(res.body, "ILLEGAL_SUBSCRIPTION_TRANSITION");

    /* THE ROW IS STILL COMMITTED, byte-for-byte. */
    expect(rowFromDb(subId)).toEqual(rowBefore);
    /* AND THE CAPITAL IS STILL THERE. This is the assertion that matters: the
       defect was not a wrong status, it was capital leaving a vehicle silently. */
    expect(canonicalCommittedMinorForSpv(spvId).toString()).toBe(capitalBefore.toString());
    expect(committedSubscriptionsForSpv(spvId).length).toBe(1);
  });

  it("T3.2: EVERY backwards move out of `committed` is refused, and `withdrawn` is the one exit", async () => {
    const spvId = await createSpv("W162 committed all reversals");
    const lp = "u_w162_reversal2_lp";
    await subscribe(spvId, lp, COMMITTED_MINOR);
    const subId = spvEngineStore.projectLpCommitted(PARTNER, spvId, {
      investorId: lp,
      commitmentMinor: COMMITTED_MINOR,
      currency: "USD",
    }).id;

    for (const to of ["review", "soft_circled", "founder_confirmed", "wire_funded"]) {
      const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to });
      expect(res.status, `committed → ${to}: ${JSON.stringify(res.body)}`).toBe(409);
      expectPlainSentence(res.body, "ILLEGAL_SUBSCRIPTION_TRANSITION");
      expect(rowFromDb(subId)?.status).toBe("committed");
      expect(canonicalCommittedMinorForSpv(spvId).toString()).toBe(String(COMMITTED_MINOR));
    }

    /* The ONE legal exit, and it is a recorded event rather than a downgrade. */
    const wd = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "withdrawn" });
    expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    expect(rowFromDb(subId)?.status).toBe("withdrawn");
    /* The amount is still on the row — a withdrawal records, it does not erase. */
    expect(Number(rowFromDb(subId)?.commitment_minor)).toBe(COMMITTED_MINOR);
  });

  it("T3.3: `withdrawn` is terminal — nothing comes back out of it", async () => {
    const spvId = await createSpv("W162 withdrawn terminal");
    const subId = await subscribe(spvId, "u_w162_terminal_lp", COMMITTED_MINOR);
    expect((await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "withdrawn" })).status).toBe(200);

    for (const to of SPV_SUBSCRIPTION_LADDER) {
      const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to });
      expect(res.status, `withdrawn → ${to}: ${JSON.stringify(res.body)}`).toBe(409);
      expectPlainSentence(res.body, "ILLEGAL_SUBSCRIPTION_TRANSITION");
    }
    expect(rowFromDb(subId)?.status).toBe("withdrawn");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §4 — R135.2: WIRING BEFORE THE GP CONFIRMS DOES NOT CONFIRM ANYTHING.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §4 — `soft_circled → wire_funded` is refused (R135.2)", () => {
  it("T4.1: the direct move is REFUSED over HTTP, and the row stays a soft-circle", async () => {
    const spvId = await createSpv("W162 R135.2");
    const subId = await subscribe(spvId, "u_w162_r1352_lp", SOFT_CIRCLE_MINOR);
    expect((await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to: "soft_circled" })).status).toBe(200);
    const before = rowFromDb(subId);
    expect(before?.status).toBe("soft_circled");

    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "wire_funded",
      wiredMinor: SOFT_CIRCLE_MINOR,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expectPlainSentence(res.body, "ILLEGAL_SUBSCRIPTION_TRANSITION");
    /* Nothing moved, and no amount was recorded as received either. */
    expect(rowFromDb(subId)).toEqual(before);
    expect(Number(rowFromDb(subId)?.wired_minor ?? 0)).toBe(0);
    /* And it is NOT committed capital — cash arrival did not manufacture a
       commitment, which is the whole of R135.2. */
    expect(canonicalCommittedMinorForSpv(spvId).toString()).toBe("0");
  });

  it("T4.2: the COMPLIANT route still works — the GP's confirmation is a step, not a wall", async () => {
    const spvId = await createSpv("W162 R135.2 compliant");
    const subId = await subscribe(spvId, "u_w162_r1352b_lp", SOFT_CIRCLE_MINOR);
    for (const to of ["soft_circled", "founder_confirmed", "wire_funded"]) {
      const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to });
      expect(res.status, `${to}: ${JSON.stringify(res.body)}`).toBe(200);
    }
    expect(rowFromDb(subId)?.status).toBe("wire_funded");
    /* R135.1 — money in the bank is still NOT confirmed capital. */
    expect(canonicalCommittedMinorForSpv(spvId).toString()).toBe("0");
  });

  it("T4.3: the omission is in the MAP, not only in a branch — `soft_circled` does not list `wire_funded`", () => {
    expect(SPV_SUBSCRIPTION_TRANSITIONS.soft_circled).not.toContain("wire_funded");
    expect(SPV_SUBSCRIPTION_TRANSITIONS.soft_circled).toContain("founder_confirmed");
    /* R135.2 is refused REGARDLESS of the forward-skip policy: the verdict is a
       refusal even though the move is forward. A future flip of the policy value
       must not be able to smuggle this edge back in. */
    const verdict = spvSubscriptionTransitionLegality("soft_circled", "wire_funded");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.detail).toContain("R135_2");
    /* `committed` may ONLY be withdrawn. */
    expect(SPV_SUBSCRIPTION_TRANSITIONS.committed).toEqual(["withdrawn"]);
    expect(SPV_SUBSCRIPTION_TRANSITIONS.withdrawn).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §5 — R136.2: A FORWARD SKIP IS RECORDED AND VISIBLE, NOT REFUSED.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §5 — forward skips are recorded, not refused (R136.2)", () => {
  it("T5.1: `review → committed` in ONE PATCH SUCCEEDS, and the skip is RECORDED where it can be read", async () => {
    const spvId = await createSpv("W162 forward skip");
    const lp = "u_w162_skip_lp";
    const subId = await subscribe(spvId, lp, SKIP_COMMIT_MINOR);
    /* The R105 gates are untouched by this wave and must still be satisfied — so
       this test also proves the skip is permitted WITHOUT relaxing them. */
    expect((await put(`/api/partner/me/compliance/${lp}`, MANAGING, {
      kycStatus: "verified",
      accreditationStatus: "self_certified",
    })).status).toBe(200);

    /* CAPTURE THE RECORD. `log.warn` writes through `console.warn`; spying on it
       is how "recorded and visible" becomes evidence instead of a claim. */
    const seen: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      seen.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
    let res: any;
    try {
      res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
        to: "committed",
        subscriptionDocRef: `sig_${lp}`,
      });
    } finally {
      spy.mockRestore();
    }

    /* NOT REFUSED. This is the assertion R136.2 protects: nine money and
       atomicity suites perform exactly this move. */
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.subscription.status).toBe("committed");
    expect(rowFromDb(subId)?.status).toBe("committed");
    expect(canonicalCommittedMinorForSpv(spvId).toString()).toBe(String(SKIP_COMMIT_MINOR));

    /* RECORDED. The line names the subscription, both stages and the stages
       skipped — enough for an operator to reconstruct what happened. */
    const line = seen.find((l) => l.includes("SUBSCRIPTION_TRANSITION_FORWARD_SKIP"));
    expect(line, `logger lines seen:\n${seen.join("\n")}`).toBeTruthy();
    expect(String(line)).toContain(subId);
    expect(String(line)).toContain("review");
    expect(String(line)).toContain("committed");
    expect(String(line)).toContain("soft_circled");
    expect(String(line)).toContain("record");
  });

  it("T5.2: the POLICY VALUE is `record`, and the legality verdict names the stages skipped", () => {
    /* Pinned deliberately. R136.2 is the binding ruling; flipping this value
       would change WHEN funding fee obligations accrue, and nine suites fail.
       If a later wave flips it, this test is the tripwire. */
    expect(SPV_SUBSCRIPTION_FORWARD_SKIP_POLICY).toBe("record");

    const v = spvSubscriptionTransitionLegality("review", "committed");
    expect(v.ok).toBe(true);
    expect(v.ok === true && v.kind).toBe("forward_skip");
    expect(v.ok === true && v.kind === "forward_skip" && v.skipped).toEqual([
      "soft_circled",
      "founder_confirmed",
      "wire_funded",
    ]);
  });

  it("T5.3: R105 — the gates are NOT relaxed by permitting the skip", async () => {
    const spvId = await createSpv("W162 skip still gated");
    const lp = "u_w162_skip_gated_lp";
    const subId = await subscribe(spvId, lp, SKIP_COMMIT_MINOR);
    /* No compliance profile → the KYC gate must still refuse the very same
       one-step commit that T5.1 performed. A "permitted" skip that also skipped
       the gates would be a far worse defect than the one being fixed. */
    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, {
      to: "committed",
      subscriptionDocRef: `sig_${lp}`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toBe("GATE_KYC_REQUIRED");
    expect(rowFromDb(subId)?.status).toBe("review");
    expect(canonicalCommittedMinorForSpv(spvId).toString()).toBe("0");
  });

  it("T5.4: every legal edge in the map is accepted by the legality function; every reversal is refused (T-B.4)", () => {
    const all = SPV_SUBSCRIPTION_STATUSES as readonly SpvSubscriptionStatus[];
    for (const from of all) {
      for (const to of SPV_SUBSCRIPTION_TRANSITIONS[from]) {
        expect(spvSubscriptionTransitionLegality(from, to).ok, `${from} → ${to}`).toBe(true);
      }
    }
    /* Every strictly-backwards edge is refused, enumerated from the ladder rather
       than hand-listed so a new stage cannot be added without being covered. */
    for (let i = 0; i < SPV_SUBSCRIPTION_LADDER.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const from = SPV_SUBSCRIPTION_LADDER[i];
        const to = SPV_SUBSCRIPTION_LADDER[j];
        const v = spvSubscriptionTransitionLegality(from, to);
        expect(v.ok, `${from} → ${to} must be refused`).toBe(false);
        expect(v.ok === false && v.code).toBe("ILLEGAL_SUBSCRIPTION_TRANSITION");
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §6 — R135.9: `shadowCommitmentToEngine` IS ALLOW-LISTED, NOT RE-ROUTED.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §6 — the legacy drain path still works (R135.9)", () => {
  it("T6.1: a first shadow-persist still writes a `review` subscription — the map did not fail it closed", () => {
    const legacyId = `pspv_w162_shadow_${Date.now()}`;
    shadowPersistPartnerSpvToEngine({
      legacyId,
      partnerId: PARTNER,
      name: "W162 Shadow Parent",
      currency: "USD",
      totalCommittedMinor: 500_000_00,
      jurisdiction: "delaware",
      recordedBy: "u_test_actor",
      status: "open",
    });
    const out = shadowCommitmentToEngine({
      legacyPositionId: `pspvpos_w162_${Date.now()}`,
      legacySpvId: legacyId,
      partnerId: PARTNER,
      lpUserId: "u_w162_shadow_lp",
      amountMinor: 6_600_041,
    });
    expect(out.ok, JSON.stringify(out)).toBe(true);

    const engineSpv = spvEngineStore.listByPartner(PARTNER).find((s) => s.migratedFrom === legacyId);
    expect(engineSpv).toBeDefined();
    const sub = spvEngineStore
      .listSubscriptions(PARTNER, engineSpv!.id)
      .find((s) => s.investorId === "u_w162_shadow_lp");
    expect(sub).toBeDefined();
    expect(sub!.status).toBe("review");
    expect(sub!.commitmentMinor).toBe(6_600_041);
  });

  it("T6.2: a re-run PRESERVES a later status instead of resetting it to `review`", async () => {
    const legacyId = `pspv_w162_shadow_rerun_${Date.now()}`;
    const legacyPosId = `pspvpos_w162_rerun_${Date.now()}`;
    shadowPersistPartnerSpvToEngine({
      legacyId,
      partnerId: PARTNER,
      name: "W162 Shadow Rerun Parent",
      currency: "USD",
      totalCommittedMinor: 500_000_00,
      jurisdiction: "delaware",
      recordedBy: "u_test_actor",
      status: "open",
    });
    const lp = "u_w162_shadow_rerun_lp";
    expect(shadowCommitmentToEngine({
      legacyPositionId: legacyPosId, legacySpvId: legacyId, partnerId: PARTNER, lpUserId: lp, amountMinor: 8_800_023,
    }).ok).toBe(true);

    const engineSpv = spvEngineStore.listByPartner(PARTNER).find((s) => s.migratedFrom === legacyId)!;
    const subId = spvEngineStore.listSubscriptions(PARTNER, engineSpv.id).find((s) => s.investorId === lp)!.id;
    /* Advance it legally, then replay the drain. */
    expect((await patch(`/api/partner/me/spv/${engineSpv.id}/subscriptions/${subId}`, MANAGING, { to: "soft_circled" })).status).toBe(200);
    expect(rowFromDb(subId)?.status).toBe("soft_circled");

    /* THE REPLAY. This is the case that would break if the drain had been
       re-routed through `subscribe()` or made to consult the transition map:
       `review` is not a legal target from `soft_circled`, so a re-routed drain
       would refuse a historical row, and a naive one would step it BACKWARDS. */
    expect(shadowCommitmentToEngine({
      legacyPositionId: legacyPosId, legacySpvId: legacyId, partnerId: PARTNER, lpUserId: lp, amountMinor: 8_800_023,
    }).ok).toBe(true);
    expect(rowFromDb(subId)?.status).toBe("soft_circled");
    /* And no duplicate row was minted. */
    const count = db()
      .prepare("SELECT COUNT(*) c FROM spv_subscription WHERE spv_id = ? AND investor_id = ?")
      .get(engineSpv.id, lp) as { c: number };
    expect(count.c).toBe(1);
  });

  it("T6.3: the exemption is an explicit ALLOW-LIST ENTRY, with a stated reason, not a silent hole", () => {
    expect(spvSubscriptionWriterMayWriteStatus("shadowCommitmentToEngine", "review")).toBe(true);
    /* It may write the entry stage and nothing else. */
    expect(spvSubscriptionWriterMayWriteStatus("shadowCommitmentToEngine", "committed")).toBe(false);
    /* An UNKNOWN writer is not exempt. The allow-list is a list, not a default. */
    expect(spvSubscriptionWriterMayWriteStatus("someFutureWriter", "committed")).toBe(false);
    /* Every entry states WHY, because an exemption without a reason is the thing
       the next reader deletes or widens. */
    for (const [writer, entry] of Object.entries(SPV_SUBSCRIPTION_STATUS_WRITER_ALLOWLIST)) {
      expect(entry.mayWrite.length, writer).toBeGreaterThan(0);
      expect(entry.why.length, writer).toBeGreaterThan(40);
    }
    expect(Object.keys(SPV_SUBSCRIPTION_STATUS_WRITER_ALLOWLIST)).toContain("shadowCommitmentToEngine");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §7 — R136.4: THE `waveB_stage2_canonicalization` FAILURE, INVESTIGATED.
 * ══════════════════════════════════════════════════════════════════════════════
 * VERDICT: PRE-EXISTING, from WAVE 112, and it CANNOT have been introduced by
 * waves 160-162. The proof below is deliberately VERSION-INDEPENDENT rather than
 * a code-provenance argument: the legacy-only commitment path creates NO
 * `spv_subscription` ROW AT ALL, so `canonicalCommittedMinorForSpv` sums an EMPTY
 * collection. No change to a status predicate, an aggregation basis or a fee
 * basis can alter a sum over zero rows. Waves 160/161/162 changed exactly those
 * things and nothing else in this path.
 *
 * The behaviour is also DOCUMENTED as intentional by wave 112 itself: the
 * docblock on `legacyRegisterCommittedMinorForSpv` states that a commitment made
 * through the legacy-only routes "create[s] no engine subscription" and is
 * therefore "VISIBLY absent from the canonical figure". The failing assertion
 * demands the two figures be identical, which contradicts that design. The test
 * was never updated when `engineReconcileLegacySpv` was repointed.
 *
 * NOT FIXED HERE, and deliberately: fixing it means either changing
 * `spvFundStore.reconcile` (forbidden) or changing the assertion (R98). It is the
 * same defect family as W160-F1 (R136.3) and needs the same owner ruling.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §7 — R136.4 evidence", () => {
  it("T7.1: the legacy-only commitment path creates ZERO engine subscriptions — that is the whole cause", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER,
      name: "W162 R136.4 evidence SPV",
      targetMinor: 10_000_000_00,
    });
    const rowsBefore = (db().prepare("SELECT COUNT(*) c FROM spv_subscription WHERE spv_id = ?").get(spv.id) as { c: number }).c;
    const c = engineAddCommitment({
      partnerId: PARTNER, spvId: spv.id, lpUserId: "u_w162_r1364_lp", amountMinor: 500_000_00,
    });
    engineTransitionCommitment({ partnerId: PARTNER, spvId: spv.id, commitmentId: c.id, status: "signed" });
    engineRecordCapitalCall({ partnerId: PARTNER, spvId: spv.id, amountMinor: 100_000_00 });

    const rowsAfter = (db().prepare("SELECT COUNT(*) c FROM spv_subscription WHERE spv_id = ?").get(spv.id) as { c: number }).c;
    /* NO SUBSCRIPTION EXISTS. Therefore the canonical figure is a sum over an
       empty set, for ANY committed predicate, in ANY version of this code. */
    expect(rowsBefore).toBe(0);
    expect(rowsAfter).toBe(0);
    expect(committedSubscriptionsForSpv(spv.id).length).toBe(0);
    expect(canonicalCommittedMinorForSpv(spv.id).toString()).toBe("0");

    /* The legacy table DOES hold the commitment, which is why the two figures
       differ — a divergence by design, not by regression. */
    const legacy = db().prepare("SELECT status, amount_minor FROM spv_commitments WHERE spv_id = ?").all(spv.id) as any[];
    expect(legacy.length).toBe(1);
    expect(legacy[0].status).toBe("signed");
    expect(Number(legacy[0].amount_minor)).toBe(500_000_00);

    /* And this is the exact shape of the failing assertion, pinned so the cause
       is recorded rather than re-diagnosed by the next reader. */
    expect(engineReconcileLegacySpv(spv.id).committedMinor.toString()).toBe("0");
    expect(spvFundStore.reconcile(spv.id).committedMinor.toString()).toBe("50000000");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §8 — R77: COPY EXISTS, IS REACHABLE, AND CANNOT SILENTLY STOP BEING EITHER.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W162 §8 — no refusal reaches a person as a bare code (T-B.5)", () => {
  it("T8.1: every Item-A/B refusal code has BOTH a headline and an unabridged sentence", () => {
    for (const code of SPV_SUBSCRIPTION_REFUSAL_CODES) {
      const headline = spvSubscriptionRefusalHeadline(code);
      const full = spvSubscriptionRefusalCopy(code);
      expect(headline, code).toBeTruthy();
      expect(full, code).toBeTruthy();
      expect(String(headline).length).toBeGreaterThan(40);
      expect(String(full).length).toBeGreaterThan(120);
      /* Neither form may contain the code, or any SHOUTING_ENUM at all. */
      expect(String(headline)).not.toMatch(/[A-Z]{4,}_[A-Z_]{4,}/);
      expect(String(full)).not.toMatch(/[A-Z]{4,}_[A-Z_]{4,}/);
      /* The `CODE:detail:detail` form the server actually throws resolves too —
         if it did not, every prefixed refusal would render as a code. */
      expect(spvSubscriptionRefusalHeadline(`${code}:field:string:oops`)).toBe(headline);
      expect(spvSubscriptionRefusalCopy(`${code}:field:string:oops`)).toBe(full);
    }
    /* An unmapped code reports ABSENCE rather than inventing an apology. */
    expect(spvSubscriptionRefusalHeadline("SOME_NEW_UNMAPPED_CODE")).toBeNull();
    expect(spvSubscriptionRefusalCopy("SOME_NEW_UNMAPPED_CODE")).toBeNull();
  });

  it("T8.2: every headline survives `queryClient.ts`'s 240-char gate — otherwise the reason is discarded", () => {
    /* This is not a style rule. `client/src/lib/queryClient.ts:60-65` replaces
       any server `message` of 240 characters or more with a generic sentence, and
       `PartnerSpvDetail.tsx:267/:314` render `e.message` raw. A headline that
       grows past the limit silently stops reaching the screen. */
    expect(spvSubscriptionRefusalHeadlinesOverLimit()).toEqual([]);
  });

  it("T8.3: the CLIENT import path still serves the same sentences after the move to `shared/`", () => {
    /* Wave 162 MOVED the copy into `shared/` so the server could reach it and
       re-exported it from the client module. If that re-export breaks, the server
       keeps answering with words while every client surface stops resolving
       them — a half-fix that would look green. */
    for (const code of SPV_SUBSCRIPTION_REFUSAL_CODES) {
      expect(CLIENT_COPY[code], code).toBe(spvSubscriptionRefusalCopy(code));
      expect(clientCopyFn(code), code).toBe(spvSubscriptionRefusalCopy(code));
    }
    expect(CLIENT_COPY.FUNDS_CONFIRMATION_REQUIRES_COMMITMENT.length).toBeGreaterThan(80);
  });
});
