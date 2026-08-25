/**
 * WAVE 127 · FINDING 2 — THE FEE-BREAKDOWN ROUTE MUST NOT INVENT A COMMITMENT.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, AS IT STOOD ON PRODUCTION.
 * ═══════════════════════════════════════════════════════════════════════════════
 * server/spvEngineRoutes.ts read, on one line:
 *
 *     const commitmentMinor = Number(req.query.commitmentMinor ?? spv.minCheckMinor ?? 0);
 *
 * so a request with NO `commitmentMinor` was answered with a complete, internally
 * consistent fee breakdown of the vehicle's MINIMUM CHEQUE SIZE. That is what put
 * `Commitment modelled $484.47 · Management fee $33.00 · Net deployed $451.47` on
 * screen beside a verifiably empty input on `Test SPV` (min_check_minor 48447),
 * and `$100.00 / $20.00 / $80.00` on `QUantum SPV` (min_check_minor 10000). The
 * subtraction was right; the input was fabricated. A minimum cheque size is a
 * mandate TERM, not a commitment.
 *
 * WHY THE SERVER IS FIXED AND NOT ONLY THE CLIENT: a client-side guard leaves the
 * next caller free to be lied to in exactly the same way, and the client half is
 * separately proved in
 * client/src/components/partner/__tests__/w127_fee_panel_empty_input.test.tsx.
 *
 * ANTI-VACUITY. The first test does not merely assert a 400. It first proves by
 * direct SQL that this vehicle HAS a non-zero `min_check_minor`, i.e. that the old
 * substitution had something to substitute, and then asserts the response body
 * contains no figure derived from it. Without that step a 400 could pass on a
 * vehicle where the defect could never have fired.
 *
 * The arithmetic is also checked by hand in minor units, since the brief requires
 * that a REAL amount still produces a verifiable answer.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";

let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function get(path: string, user: string) {
  return request(app).get(path).set("x-user-id", user);
}

/** The live Test SPV's minimum cheque, so the fixture reproduces the exact
 *  production shape rather than an approximation of it. */
const MIN_CHECK_MINOR = 48_447;

async function makeVehicle(): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name: `W127 Fee Vehicle ${Date.now()}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    minCheckMinor: MIN_CHECK_MINOR,
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.spv.id as string;
}

function storedMinCheck(spvId: string): number | null {
  const row = rawDb().prepare(`SELECT min_check_minor AS m FROM spv WHERE id = ?`).get(spvId) as
    | { m: number | null }
    | undefined;
  return row?.m ?? null;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("W127 FINDING 2 · GET /fee-breakdown refuses to model an amount nobody supplied", () => {
  it("NO commitmentMinor ⇒ 400 and NOT a breakdown of min_check_minor (fails before this wave)", async () => {
    const spvId = await makeVehicle();

    /* ANTI-VACUITY: the old code needed a min_check_minor to substitute. Prove
       this vehicle has one, or a 400 here would prove nothing. */
    expect(
      storedMinCheck(spvId),
      "the fixture must carry a minimum cheque or it cannot reproduce the defect",
    ).toBe(MIN_CHECK_MINOR);

    const res = await get(`/api/partner/me/spv/${spvId}/fee-breakdown`, MANAGING);

    expect(res.status, `body=${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body.error).toBe("COMMITMENT_MINOR_REQUIRED");
    expect(res.body.breakdown, "an absent amount must yield no breakdown at all").toBeUndefined();
    /* The substituted figure must appear nowhere, in any field or message. */
    expect(JSON.stringify(res.body)).not.toContain(String(MIN_CHECK_MINOR));
    /* The refusal explains itself in words rather than a bare code. */
    expect(String(res.body.message ?? "")).toContain("does not");
  });

  it("an empty-string commitmentMinor is refused too — the exact shape an empty input would send", async () => {
    const spvId = await makeVehicle();
    const res = await get(`/api/partner/me/spv/${spvId}/fee-breakdown?commitmentMinor=`, MANAGING);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("COMMITMENT_MINOR_REQUIRED");
  });

  it("money is never read with Number(): exponent, decimal and junk are refused, not coerced", async () => {
    const spvId = await makeVehicle();
    /* Under `Number()` each of these was accepted:
         "1e7"   → 10,000,000 minor units, a 1000x over-read
         "100.5" → a fractional minor unit
         "abc"   → NaN, carried into arithmetic */
    for (const bad of ["1e7", "100.5", "abc", "-100", " 100"]) {
      const res = await get(
        `/api/partner/me/spv/${spvId}/fee-breakdown?commitmentMinor=${encodeURIComponent(bad)}`,
        MANAGING,
      );
      expect(res.status, `input ${JSON.stringify(bad)} must be refused, body=${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.breakdown).toBeUndefined();
    }
  });

  it("a REAL amount is modelled, and the arithmetic checks by hand in minor units", async () => {
    const spvId = await makeVehicle();
    const res = await get(`/api/partner/me/spv/${spvId}/fee-breakdown?commitmentMinor=250000`, MANAGING);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bd = res.body.breakdown as Record<string, number | null | boolean>;

    /* The amount modelled is the amount ASKED FOR, not the vehicle's minimum.
       (The field is `commitmentMinor`; the Fees tab labels it "Commitment
       modelled", which is the copy the live screenshot showed.) */
    expect(bd.commitmentMinor).toBe(250_000);
    expect(bd.commitmentMinor).not.toBe(MIN_CHECK_MINOR);

    /* Hand arithmetic, in whole minor units:
         net = commitment − management − platform
       Every term is an integer and the identity must hold exactly. */
    const mgmt = Number(bd.managementFeeMinor ?? 0);
    const plat = Number(bd.platformFeeMinor ?? 0);
    const net = Number(bd.netDeployedMinor ?? 0);
    expect(Number.isInteger(mgmt) && Number.isInteger(plat) && Number.isInteger(net)).toBe(true);
    expect(net).toBe(250_000 - mgmt - plat);
    /* Never negative: the store clamps at zero rather than deploying a debt. */
    expect(net).toBeGreaterThanOrEqual(0);
  });

  it("a zero commitment is a legitimate question and IS answered — the fix refuses ABSENCE, not zero", async () => {
    const spvId = await makeVehicle();
    const res = await get(`/api/partner/me/spv/${spvId}/fee-breakdown?commitmentMinor=0`, MANAGING);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.breakdown as Record<string, number>).commitmentMinor).toBe(0);
  });
});
