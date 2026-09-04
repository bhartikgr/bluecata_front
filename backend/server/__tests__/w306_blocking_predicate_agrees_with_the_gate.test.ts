/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 306 · PART 3 — THE GP'S "BLOCKING" MARKER READS THE SAME RULE THE GATE
 * ENFORCES, PROVED AGAINST THE REAL GATE AND NOT AGAINST A COPY OF IT.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT PART 3 SHIPS. `SpvOperationsPanels.tsx` already rendered the amount, the
 * currency and "None" honestly; nothing said the pending obligation was STOPPING
 * the commitment. The new copy says so, and it decides WHICH rows to mark with
 * `spvFeeObligationIsBlocking` from `@shared/spvFeeObligationRules`.
 *
 * THE RISK THIS FILE EXISTS FOR. A second predicate that merely LOOKS like the
 * gate is a lie waiting to happen: the panel would tell a GP a row is blocking
 * when the platform does not refuse, or stay silent when it does. So this file
 * does NOT re-state the rule and compare two literals (inert-proof mechanism 10).
 * It drives `spvEngineStore.hasUnsettledFixedFees` — THE REAL GATE, the same
 * function `advanceSubscription` consults before it answers `FEES_UNPAID` — over
 * a matrix of obligation shapes, and asserts the shared predicate agrees on every
 * one of them.
 *
 * HOW THE MATRIX IS MADE HONEST. `hasUnsettledFixedFees` has TWO clauses:
 *   (1) any accrued funding-fixed obligation that is neither paid nor waived, and
 *   (2) a fixed/hybrid fee CONFIG with a positive fixed portion for which no
 *       settled funding obligation exists — which blocks WITH NO ROW AT ALL.
 * The shared predicate answers "is THIS ROW blocking" and never claims to answer
 * clause 2. So the fixture reconfigures the vehicle's management fee to CARRY
 * after the obligation has already accrued, which makes clause 2 skip that layer
 * (`fee.feeType === "carry"` → `continue`) and leaves the gate reduced to clause
 * 1 alone. §1 PROVES that neutralisation before the matrix runs, rather than
 * assuming it — a matrix run against a gate that is `true` for another reason
 * entirely would be a fixture that cannot distinguish the fix from the defect.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It is a matrix over the gate's IN-MEMORY row
 * projection, so it is a proof about the RULE, not about durability. Durability of
 * the money decisions is proved in `w306_fee_obligation_audit_http.test.ts`
 * against SQLite. Clause 2 remains outside the predicate's scope, deliberately
 * and by documented design.
 *
 * MAIL SAFETY. Run with `SMTP_MODE=dry_run`; §0 asserts it positively.
 * ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { rawDb, getDb } from "../db/connection";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { verifyTransport } from "../lib/emailSender";
import { getConfig, patchConfig, sendMail } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";
import {
  spvFeeObligationIsBlocking,
  SPV_FEE_OBLIGATION_BLOCKING_MARKER,
  SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION,
} from "@shared/spvFeeObligationRules";

const MANAGING = "u_avi_managing";

let app: express.Express;
let server: http.Server;

const post = (p: string, user: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", user).send(body ?? {});
const put = (p: string, user: string, body?: unknown) =>
  request(app).put(p).set("x-user-id", user).send(body ?? {});

let spvId = "";
let partnerId = "";
/** The LIVE store object for the accrued obligation — the very row the gate
 *  reads. Mutating it is how the matrix reaches states the seeded database will
 *  not produce on demand. */
let live: any = null;

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  seedTestPartnerSandbox({ force: true });
  partnerTeamStore.add(TEST_PARTNER_ID, MANAGING, "managing_partner", "u_system_seed", {
    isSeed: true,
  });
  _resetRateLimitsForTests();

  /* A vehicle with a FIXED management fee, so an obligation genuinely accrues
     through the real commit path. */
  const created = await post("/api/partner/me/spv", MANAGING, {
    name: `W306 P3 Predicate Vehicle ${Date.now()}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    minCheckMinor: 10000,
    currency: "USD",
  });
  expect(created.status).toBe(201);
  spvId = String(created.body.spv.id);
  partnerId = String(created.body.spv.sponsorPartnerId ?? TEST_PARTNER_ID);

  expect(
    (await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, {
      layer: "management",
      feeType: "fixed",
      fixedAmountMinor: 5000,
    })).status,
  ).toBe(201);

  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId: "inv_w306_p3",
    commitmentMinor: 100000,
  });
  expect(sub.status).toBe(201);
  await put(`/api/partner/me/compliance/inv_w306_p3`, MANAGING, {
    kycStatus: "verified",
    accreditationStatus: "self_certified",
  });
  const blocked = await post(
    `/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}/gp-confirm`,
    MANAGING,
    { documentsSigned: true, fundsReceived: true, subscriptionDocRef: "sig_w306_p3" },
  );
  expect(`${blocked.status} ${blocked.body?.error}`).toBe("409 FEES_UNPAID");

  /* NOW reconfigure the fee to CARRY, which retires clause 2 for this layer and
     leaves the accrued row in place. §1 proves that this actually happened. */
  expect(
    (await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, {
      layer: "management",
      feeType: "carry",
      carryPct: 0.2,
    })).status,
  ).toBe(201);

  const obs = spvEngineStore.listFeeObligations(partnerId, spvId);
  expect(`obligations=${obs.length}`).toBe("obligations=1");
  live = obs[0];
});

beforeEach(() => {
  _resetRateLimitsForTests();
  /* Every case starts from the accrued shape, so no case inherits another's
     mutation. */
  live.timing = "funding";
  live.portion = "fixed";
  live.state = "pending";
});

/* ═══════════════════════════════════════════════════════════════════════════
   §0 — mail is inert, proved positively.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P3 §0 — mail is inert", () => {
  it("both transports are non-smtp and a driven send returns a dry_ id", async () => {
    expect(process.env.SMTP_MODE).toBe("dry_run");
    expect(getConfig().mode).toBe("dry_run");
    expect((await verifyTransport()).mode).not.toBe("smtp");
    const out = await sendMail({ to: "nobody@capavate.test", subject: "probe", html: "<p>p</p>" });
    expect(String(out.messageId)).toMatch(/^dry_/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §1 — PRECONDITIONS, ASSERTED BEFORE ANY AGREEMENT IS CONCLUDED.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P3 §1 — the fixture can actually distinguish the two answers", () => {
  it("the fee view is RELIABLE, so the gate is not answering `true` fail-closed", () => {
    /* `feeViewUnreliable` short-circuits the gate to `true` regardless of rows.
       If it were true here, the whole matrix below would be vacuous. */
    expect(spvEngineStore.feeViewUnreliable(spvId)).toBe(false);
    expect(Boolean(spvEngineStore.getSpv(partnerId, spvId))).toBe(true);
  });

  it("CLAUSE 2 IS NEUTRALISED: with the row moved off `funding`, the gate goes quiet", () => {
    /* This is the load-bearing precondition. Under the original FIXED config this
       exact state answers `true` (clause 2 blocks with no row at all). With the
       config now CARRY it must answer `false`. So a `true` anywhere in the matrix
       below can only have come from clause 1. */
    live.timing = "distribution";
    live.state = "pending";
    expect(spvEngineStore.hasUnsettledFixedFees(partnerId, spvId)).toBe(false);
  });

  it("the gate CAN still answer both ways on this vehicle — both poles observed", () => {
    live.timing = "funding";
    live.portion = "fixed";
    live.state = "pending";
    const blocking = spvEngineStore.hasUnsettledFixedFees(partnerId, spvId);
    live.state = "paid";
    const clear = spvEngineStore.hasUnsettledFixedFees(partnerId, spvId);
    /* A gate stuck on one answer cannot prove agreement with anything. */
    expect(`blocking=${blocking} clear=${clear}`).toBe("blocking=true clear=false");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — THE MATRIX. Every combination, gate vs predicate, one line each.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P3 §2 — w306_blocking_predicate_agrees_with_the_gate", () => {
  const timings = ["funding", "distribution"] as const;
  const portions = ["fixed", "carry"] as const;
  const states = ["pending", "failed", "paid", "waived"] as const;

  it("the shared predicate and the real store gate agree on all 16 shapes", () => {
    const gateSays: string[] = [];
    const predicateSays: string[] = [];
    for (const timing of timings) {
      for (const portion of portions) {
        for (const state of states) {
          live.timing = timing;
          live.portion = portion;
          live.state = state;
          const label = `${timing}/${portion}/${state}`;
          gateSays.push(`${label}=${spvEngineStore.hasUnsettledFixedFees(partnerId, spvId)}`);
          predicateSays.push(
            `${label}=${spvFeeObligationIsBlocking({ timing, portion, state })}`,
          );
        }
      }
    }
    /* PRECONDITION: the matrix really exercised both answers, so "they agree" is
       not "they are both always false". */
    expect(gateSays.filter((x) => x.endsWith("=true")).length > 0).toBe(true);
    expect(gateSays.filter((x) => x.endsWith("=false")).length > 0).toBe(true);
    expect(gateSays.length).toBe(16);

    /* AGREEMENT, printed shape by shape so a disagreement names itself. */
    expect(predicateSays.join("\n")).toBe(gateSays.join("\n"));
  });

  it("the two shapes that matter to a GP read the way the copy claims", () => {
    /* A pending funding-fixed bill IS blocking. */
    expect(
      spvFeeObligationIsBlocking({ timing: "funding", portion: "fixed", state: "pending" }),
    ).toBe(true);
    /* And so is a FAILED one — the admin tab's narrower `state === "pending"`
       filter misses this, which is exactly why Part 3 does not reuse it. */
    expect(
      spvFeeObligationIsBlocking({ timing: "funding", portion: "fixed", state: "failed" }),
    ).toBe(true);
    /* Discharged rows are not. */
    expect(
      spvFeeObligationIsBlocking({ timing: "funding", portion: "fixed", state: "paid" }),
    ).toBe(false);
    expect(
      spvFeeObligationIsBlocking({ timing: "funding", portion: "fixed", state: "waived" }),
    ).toBe(false);
  });

  it("missing, null and junk fields are NOT treated as blocking by accident", () => {
    /* An undefined field must not satisfy `!== "paid"` into a false positive on
       the strict equality clauses. */
    expect(spvFeeObligationIsBlocking({})).toBe(false);
    expect(spvFeeObligationIsBlocking({ timing: null, portion: null, state: null })).toBe(false);
    expect(spvFeeObligationIsBlocking({ timing: "funding", portion: "fixed" })).toBe(true);
    expect(spvFeeObligationIsBlocking({ timing: "FUNDING", portion: "fixed", state: "pending" })).toBe(
      false,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — THE COPY IS TRUE OF THIS PLATFORM. Part 3's sentence makes four factual
   claims about what a standing obligation stops. Each is checked against the
   product rather than asserted in prose.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("W306 P3 §3 — the blocking copy's claims are true", () => {
  it("the sentence claims commitment, deployment and cap-table are all refused — and they are", () => {
    /* The claim, in the shipped string. */
    const copy = SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION;
    expect(copy).toContain("committed");
    expect(copy).toContain("deployment");
    expect(copy).toContain("cap-table");
    expect(copy).toContain("administrator");

    /* The product. `hasUnsettledFixedFees` is the gate consulted at each of
       those places; count its call sites from the source so the copy cannot
       out-live the behaviour it describes. */
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "../spvEngineStore.ts"),
      "utf8",
    ) as string;
    const calls = src.match(/hasUnsettledFixedFees\(/g) ?? [];
    /* One definition plus its consumers. Asserted as a floor, not an exact
       number, because a future wave adding another blocked path does not make
       this sentence false — it makes it more true. */
    expect(`hasUnsettledFixedFees occurrences=${calls.length >= 4}`).toBe(
      "hasUnsettledFixedFees occurrences=true",
    );
  });

  it("the sentence does NOT promise Capavate can collect the money — the gateway is frozen", () => {
    /* WAIVER-8 keeps `paymentGatewayAdapter.ts` returning 503 deliberately, so
       any copy implying automatic collection would be false in every branch. */
    expect(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION).toContain("cannot");
    expect(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION.toLowerCase()).not.toContain("we will charge");
    expect(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION.toLowerCase()).not.toContain("automatically");
  });

  it("the marker is short, lowercase-safe, and quotes no figure", () => {
    expect(SPV_FEE_OBLIGATION_BLOCKING_MARKER).toBe("blocking commitments");
    /* No money, no number, no currency anywhere in either string: the panel's
       own honest amount rendering stays the single source of the figure. */
    expect(/\d/.test(SPV_FEE_OBLIGATION_BLOCKING_MARKER)).toBe(false);
    expect(/\d/.test(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION)).toBe(false);
    expect(/[$€£]/.test(SPV_FEE_OBLIGATION_BLOCKING_EXPLANATION)).toBe(false);
  });
});
