/**
 * WAVE 127 · FINDING 3 — ONE VEHICLE, FIVE SURFACES, ONE ANSWER.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THE LIVE SITE SHOWED FOR `Test SPV` AT ONE MOMENT.
 * ═══════════════════════════════════════════════════════════════════════════════
 *   LPs tab                  Reference MARK INVEST PARTNERS: $2,500.00 (100.0%)
 *   Fund Commitment Register the same $2,500.00 commitment, Target Size $30.00
 *   Close tab                0 committed LP(s) · $0.00 confirmed of $30.00 target
 *   K-1 tab                  No committed partners are on this vehicle's register
 *   Overview                 Raise progress $0.00 / $30.00 target · Investors: 1
 *
 * A $2,500 commitment existing on two screens and not on three.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHICH SCREENS WERE WRONG — AND THEY WERE NOT EQUALLY WRONG.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The subscription's status is `review`, which is what `spvEngineStore.subscribe`
 * lands (spvEngineStore.ts:1429), and a row under review is genuinely NOT a
 * confirmed commitment. So the Close tab, the K-1 tab and the Overview raise
 * figure were RIGHT to report nothing committed: all three read the canonical
 * predicate `committed`. The LPs tab and the Fund Commitment Register were wrong
 * — not in their arithmetic, but in their FRAMING: they render
 * `investorRegister`, an ALL-STAGES view (`status !== "withdrawn"`), and printed
 * an amount and a percentage with no stage attached, so an indication of interest
 * read as money in the vehicle.
 *
 * The repair is a LABEL, not a second filter. Removing `review` rows from the
 * all-stages register would silently drop a real record, and the committed figure
 * is already converged on `canonicalCommittedMinorForSpv` (spvEngineStore.ts:3731)
 * by waves 112/115/120. This file therefore asserts BOTH halves:
 *
 *   1. the three committed-only surfaces agree EXACTLY, in bigint, on 0;
 *   2. the all-stages register still carries the row AND now carries its status,
 *      so the two rendering surfaces can label it honestly;
 *   3. promoting the row to `committed` moves ALL FIVE together — which is the
 *      real proof of convergence, because a set of surfaces that agree only on
 *      zero has not been shown to agree at all.
 *
 * THE PERCENTAGE'S DENOMINATOR is also pinned here: `100.0%` was never a
 * percentage of the $30.00 target. It is the row's share of all non-withdrawn
 * subscriptions, so one row over one row is 1.0 regardless of the target.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore, canonicalCommittedMinorForSpv } from "../spvEngineStore";
import { summariseCommittedCapital, SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/** The live figures, to the cent. */
const TARGET_MINOR = 3_000; //   $30.00
const COMMITMENT_MINOR = 250_000; // $2,500.00

let app: express.Express;
let spvId = "";
let investorId = "";

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });

  const created = await post("/api/partner/me/spv", MANAGING, {
    name: `W127 Five Surfaces ${Date.now()}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    targetRaiseMinor: TARGET_MINOR,
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  spvId = created.body.spv.id as string;

  investorId = `u_w127_lp_${Date.now()}`;
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId,
    commitmentMinor: COMMITMENT_MINOR,
    currency: "USD",
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  /* ANTI-VACUITY: the fixture must land in `review`, or it does not reproduce the
     live shape and every assertion below would be about a different situation. */
  expect(sub.body.subscription.status).toBe("review");
});

function detail() {
  return get(`/api/partner/me/spv/${spvId}`, MANAGING);
}

describe("W127 FINDING 3 · the live shape — one row under review", () => {
  it("the all-stages register still carries the row, and NOW carries its status (fails before this wave)", async () => {
    const res = await detail();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const register = res.body.register as Array<Record<string, unknown>>;
    expect(register.length, "the row must not be dropped — it is a real record").toBe(1);
    expect(register[0].commitmentMinor).toBe(COMMITMENT_MINOR);
    /* THE FIX. Before this wave `status` was absent, so both rendering surfaces
       had nothing to label the row with and printed a bare amount. */
    expect(register[0].status, "the register must state each row's stage").toBe("review");
  });

  it("the percentage's denominator is all non-withdrawn subscriptions — NOT the target", async () => {
    const res = await detail();
    const register = res.body.register as Array<{ ownershipPct: number }>;
    /* One row over one row. This is why `$2,500.00 (100.0%)` sat beside a $30.00
       target: 2500/30 would be 8333%, so the figure was plainly never that. */
    expect(register[0].ownershipPct).toBe(1);
    expect(res.body.spv.targetRaiseMinor).toBe(TARGET_MINOR);
    expect(COMMITMENT_MINOR / TARGET_MINOR).not.toBe(register[0].ownershipPct);
  });

  it("the three committed-only surfaces agree EXACTLY on zero — they were RIGHT", async () => {
    const res = await detail();

    /* Surface 3 — Close tab (closeSummary → computeCloseSummary, `committed`). */
    const close = res.body.closeSummary as { confirmedCount: number; confirmedMinor: number } | undefined;
    expect(close, "the close summary must be present").toBeTruthy();
    expect(close!.confirmedCount).toBe(0);
    expect(close!.confirmedMinor).toBe(0);

    /* Surface 4 — K-1 tab reads the COMMITTED register. */
    expect(spvEngineStore.committedRegister(PARTNER, spvId).length).toBe(0);

    /* Surface 5 — Overview raise figure, via the SHARED client-side predicate,
       applied to the very payload the client receives. */
    const summary = summariseCommittedCapital(res.body.subscriptions ?? []);
    expect(summary.committedMinor).toBe(0n);

    /* And the one canonical predicate all three converge on, in bigint. */
    expect(canonicalCommittedMinorForSpv(spvId)).toBe(0n);
  });

  it("the Investors COUNT is non-zero at the same moment, and that is not a contradiction", async () => {
    const res = await detail();
    const subs = (res.body.subscriptions ?? []) as Array<{ status: string }>;
    /* `Raise progress $0.00` beside `Investors: 1` was two different questions,
       both answered correctly, neither labelled. The count is all non-withdrawn. */
    expect(subs.filter((s) => s.status !== "withdrawn").length).toBe(1);
    expect(canonicalCommittedMinorForSpv(spvId)).toBe(0n);
  });
});

describe("W127 FINDING 3 · convergence proved by MOVING the row, not only at zero", () => {
  it("promoting the subscription to `committed` moves all five surfaces together", async () => {
    /* Promoted through `projectLpCommitted`, the store's own documented
       projection of an already-recorded ledger commit, so this test is about READ
       convergence and not about the subscribe-flow gates (KYC / accreditation /
       e-sign), which have their own tests. Idempotent by contract: it refreshes
       the existing non-withdrawn row rather than adding a second one, which is
       also asserted below via the register's length. */
    const projected = spvEngineStore.projectLpCommitted(PARTNER, spvId, {
      investorId,
      commitmentMinor: COMMITMENT_MINOR,
      currency: "USD",
    });
    expect(projected.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);

    const res = await detail();
    expect(res.status).toBe(200);

    const register = res.body.register as Array<{ commitmentMinor: number; status: string }>;
    expect(register.length, "the projection must refresh the row, not duplicate it").toBe(1);
    expect(register[0].status).toBe("committed");
    expect(register[0].commitmentMinor).toBe(COMMITMENT_MINOR);

    const close = res.body.closeSummary as { confirmedCount: number; confirmedMinor: number };
    expect(close.confirmedCount).toBe(1);
    expect(close.confirmedMinor).toBe(COMMITMENT_MINOR);

    expect(spvEngineStore.committedRegister(PARTNER, spvId).length).toBe(1);
    expect(summariseCommittedCapital(res.body.subscriptions ?? []).committedMinor).toBe(BigInt(COMMITMENT_MINOR));
    expect(canonicalCommittedMinorForSpv(spvId)).toBe(BigInt(COMMITMENT_MINOR));

    /* The single most important assertion in this file: the same number, on every
       surface, at the same moment. */
    const everySurface = [
      BigInt(register[0].commitmentMinor),
      BigInt(close.confirmedMinor),
      BigInt(spvEngineStore.committedRegister(PARTNER, spvId)[0].commitmentMinor),
      summariseCommittedCapital(res.body.subscriptions ?? []).committedMinor,
      canonicalCommittedMinorForSpv(spvId),
    ];
    expect(new Set(everySurface.map(String)).size, `surfaces disagreed: ${everySurface.join(" / ")}`).toBe(1);
  });
});
