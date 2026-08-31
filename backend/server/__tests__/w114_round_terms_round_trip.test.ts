/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 114 — THE SERVER ROUND-TRIPS, OVER REAL HTTP.
 * ══════════════════════════════════════════════════════════════════════════════
 * Everything here goes through `registerRoutes` with supertest, because each of
 * the four findings is a claim about what SURVIVES a journey: a commitment must
 * reach the founder's headline figure, a governance term must reach the terms
 * panel, a participation cap typed in Edit terms must reach the exit
 * calculation, and the confirmation must name what the writer actually took.
 * None of that can be proven against an in-memory object.
 *
 * WHICH OF THESE FAIL ON THE OLD CODE
 * -----------------------------------
 *  · FINDING 1 — `moneyOnRecord` did not exist on either read path, and the only
 *    figure available (`raisedAmount`) is structurally 0. Every assertion in the
 *    Finding 1 block fails before: the projection is `undefined`.
 *  · FINDING 2 — `boardComposition` / `informationRights` / `dragAlong` /
 *    `rofrCoSale` had no storage at all: `PATCH …/terms` ignored them and the
 *    round came back without them, while the panel printed four literals. Both
 *    the round-trip and the refusal assertions fail before.
 *  · FINDING 3 — `capParticipation` DID round-trip before this wave (Wave 107
 *    surfaced it), so the round-trip assertion PASSES BEFORE and is kept as the
 *    regression fence Wave 107 earned. What fails before is the client control
 *    that produces the value — asserted in
 *    `client/src/pages/founder/__tests__/w114_founder_round_money_and_terms.test.tsx`.
 *  · FINDING 4 — `savedFields` / `removedFields` / `notStoredFields` did not
 *    exist in the response; the client could only describe the persisted round,
 *    so a dropped field was silently absent from the sentence. Fails before.
 *
 * NOT TOUCHED: `computeConversionProjections`, `antiDilution` (its HTTP 400 is
 * asserted here to still fire), `mfn`, authentication and session scoping (R90).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { roundStoredTerms } from "../lib/roundStoredTerms";
import { readLiquidationTerms, describeLiquidationTerms, parseCapMultiple } from "../../shared/liquidationTermsReader";
import { readGovernanceTerms, GOVERNANCE_TERM_NOT_RECORDED } from "../../shared/roundGovernanceTerms";
import { readRoundMoneyOnRecord } from "../../shared/roundMoneyOnRecordView";
import { w212Attest } from "./_w212RoundAttestation";

const ADMIN = "u_admin";
const STAMP = `w114${Date.now().toString(36)}`;
let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server as never, app as never);
}, 120000);

async function makeCompany(companyId: string): Promise<void> {
  await request(app)
    .post("/api/founder/companies")
    .set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W114 ${companyId}` });
}

async function makeRound(companyId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send(w212Attest({
      companyId,
      name: `${companyId} W114 Round`,
      type: "seed",
      instrument: "preferred",
      pricePerShare: "0.25",
      openDate: "2026-08-01",
      closeDate: "2026-12-31",
      targetAmount: "600000",
      preMoney: "2000000",
      fdPreMoneyShares: "8000000",
      sharesAuthorized: "2000000",
      region: "HK",
      liquidationPreference: "1x participating",
      ...extra,
    }));
  expect(created.status).toBe(200);
  return String((created.body as { id?: string }).id ?? "");
}

async function readRound(roundId: string): Promise<Record<string, unknown>> {
  const detail = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
  expect(detail.status).toBe(200);
  const body = detail.body as Record<string, unknown>;
  return (body.round as Record<string, unknown>) ?? body;
}

async function readFromList(companyId: string, roundId: string): Promise<Record<string, unknown>> {
  const list = await request(app).get(`/api/rounds?companyId=${companyId}`).set("x-user-id", ADMIN);
  expect(list.status).toBe(200);
  const found = ((list.body as Record<string, unknown>[]) ?? []).find((r) => r.id === roundId);
  expect(found).toBeTruthy();
  return found as Record<string, unknown>;
}

/** Record money on the round the way an investor does. */
async function commit(roundId: string, amount: number, status: string, who: string): Promise<string> {
  const r = await request(app)
    .post(`/api/rounds/${roundId}/soft-circle`)
    .set("x-user-id", ADMIN)
    .send({ amount, currency: "USD", status, investorUserId: who, investorName: who });
  expect(r.status).toBe(200);
  return String(((r.body as { softCircle?: { id?: string } }).softCircle ?? {}).id ?? "");
}

/* ════════════════════════════════════════════════════════════ FINDING 1 ════ */

describe("W114 · FINDING 1 — a recorded commitment moves the round's displayed total off zero", () => {
  it("W114-HTTP-1 — the projection arrives on BOTH founder read paths and both agree", async () => {
    const companyId = `co_${STAMP}_money`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);

    /* BEFORE ANY MONEY: the round refuses to state a total rather than printing
       $0, and the stored column is still the permanent zero it always was. */
    const empty = await readRound(roundId);
    expect(Number(empty.raisedAmount ?? -1)).toBe(0); // the old headline figure
    const emptyView = readRoundMoneyOnRecord(empty.moneyOnRecord);
    expect(emptyView.canPrintFigures).toBe(false);
    expect(emptyView.statement.toLowerCase()).toContain("not recorded");

    /* Three investors, in three different states. */
    await commit(roundId, 50_000, "intent", "u_w114_a");
    await commit(roundId, 150_000, "confirmed", "u_w114_b");
    await commit(roundId, 300_000, "wired", "u_w114_c");

    const detail = await readRound(roundId);
    const list = await readFromList(companyId, roundId);
    const dView = readRoundMoneyOnRecord(detail.moneyOnRecord);
    const lView = readRoundMoneyOnRecord(list.moneyOnRecord);

    expect(dView.canPrintFigures).toBe(true);
    /* OFF ZERO — the whole point of the finding. */
    expect(dView.money?.subscribedMinor).toBe("45000000");   // $450,000 committed + funded
    expect(dView.money?.onBookMinor).toBe("50000000");       // $500,000 on the book
    /* THE STORED COLUMN IS STILL ZERO, and is no longer what the screen reads —
       the derivation is the answer, so the two cannot drift apart. */
    expect(Number(detail.raisedAmount ?? -1)).toBe(0);

    /* THE TWO SURFACES AGREE, figure for figure and word for word. */
    expect(lView.money?.subscribedMinor).toBe(dView.money?.subscribedMinor);
    expect(lView.money?.subscribedDisplay).toBe(dView.money?.subscribedDisplay);
    expect(lView.buckets.map((b) => `${b.label}=${b.display}`)).toEqual(
      dView.buckets.map((b) => `${b.label}=${b.display}`),
    );
  }, 60000);

  it("W114-HTTP-2 — the three states are counted separately and each is named on the wire", async () => {
    const companyId = `co_${STAMP}_states`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    await commit(roundId, 50_000, "intent", "u_w114_d");
    await commit(roundId, 150_000, "confirmed", "u_w114_e");
    await commit(roundId, 300_000, "wired", "u_w114_f");

    const view = readRoundMoneyOnRecord((await readRound(roundId)).moneyOnRecord);
    const byKey = Object.fromEntries(view.buckets.map((b) => [b.key, b]));
    expect(byKey.softCircled.minor).toBe("5000000");
    expect(byKey.committed.minor).toBe("15000000");
    expect(byKey.funded.minor).toBe("30000000");
    /* Named, not just counted — a soft circle is never presented as raised cash. */
    expect(byKey.softCircled.label.toLowerCase()).toContain("non-binding");
    expect(byKey.funded.label.toLowerCase()).toContain("cash recorded");
    /* And the progress ratio the screen draws is derived from the SUBSCRIBED
       total against the $600,000 target: 75.00%, in basis points. */
    expect(view.money?.progressBp?.subscribed).toBe(7500);
    expect(view.money?.progressBp?.funded).toBe(5000);
  }, 60000);

  it("W114-HTTP-3 — a DECLINED commitment is excluded from every total", async () => {
    const companyId = `co_${STAMP}_declined`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    await commit(roundId, 150_000, "confirmed", "u_w114_g");
    await commit(roundId, 999_000, "declined", "u_w114_h");
    const view = readRoundMoneyOnRecord((await readRound(roundId)).moneyOnRecord);
    expect(view.money?.onBookMinor).toBe("15000000");
    expect(view.money?.declinedRows).toBe(1);
  }, 60000);
});

/* ════════════════════════════════════════════════════════════ FINDING 2 ════ */

describe("W114 · FINDING 2 — an unstored governance term is never printed as negotiated", () => {
  it("W114-HTTP-4 — with nothing stored, all four read NOT RECORDED (they used to be four literals)", async () => {
    const companyId = `co_${STAMP}_gov0`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    const round = await readRound(roundId);
    const readings = readGovernanceTerms(round);
    expect(readings.map((r) => r.key)).toEqual([
      "boardComposition",
      "informationRights",
      "dragAlong",
      "rofrCoSale",
    ]);
    for (const r of readings) {
      expect(r.recorded).toBe(false);
      expect(r.statement).toBe(GOVERNANCE_TERM_NOT_RECORDED);
    }
    /* The four sentences the panel used to assert about every round on the
       platform are not in the data and cannot be re-derived from it. */
    const asText = JSON.stringify(round);
    expect(asText).not.toContain("1 founder, 1 investor, 1 mutual");
    expect(asText).not.toContain("Quarterly financials + KPI dashboard");
    expect(asText).not.toContain("standard NVCA form");
  }, 60000);

  it("W114-HTTP-5 — a term typed once round-trips verbatim on both read paths", async () => {
    const companyId = `co_${STAMP}_gov1`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    const patch = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", ADMIN)
      .send({
        boardComposition: "2 founder, 1 investor, 2 independent (chair rotates)",
        informationRights: "Monthly management accounts; quarterly board pack",
        dragAlong: "Yes \u2014 majority of preferred and majority of common",
        rofrCoSale: false,
      });
    expect(patch.status).toBe(200);

    for (const round of [await readRound(roundId), await readFromList(companyId, roundId)]) {
      const byKey = Object.fromEntries(readGovernanceTerms(round).map((r) => [r.key, r]));
      expect(byKey.boardComposition.text).toBe("2 founder, 1 investor, 2 independent (chair rotates)");
      expect(byKey.informationRights.text).toBe("Monthly management accounts; quarterly board pack");
      expect(byKey.dragAlong.text).toBe("Yes \u2014 majority of preferred and majority of common");
      /* A recorded NO is a recorded term, not an absence. */
      expect(byKey.rofrCoSale.recorded).toBe(true);
      expect(byKey.rofrCoSale.text).toBe("No");
    }
  }, 60000);

  it("W114-HTTP-6 — clearing a term returns it to NOT RECORDED rather than to a default", async () => {
    const companyId = `co_${STAMP}_gov2`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ boardComposition: "3 founder seats" });
    expect((readGovernanceTerms(await readRound(roundId))[0]).text).toBe("3 founder seats");

    const cleared = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ boardComposition: "" });
    expect(cleared.status).toBe(200);
    const after = readGovernanceTerms(await readRound(roundId))[0];
    expect(after.recorded).toBe(false);
    expect(after.statement).toBe(GOVERNANCE_TERM_NOT_RECORDED);
    /* And the removal is NAMED in the confirmation, not silent (Finding 4). */
    expect((cleared.body as { removedFields?: string[] }).removedFields).toContain("boardComposition");
  }, 60000);

  it("W114-HTTP-7 — a nonsense governance value is REFUSED and says why, instead of storing junk", async () => {
    const companyId = `co_${STAMP}_gov3`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    const bad = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ boardComposition: { seats: 3 } });
    expect(bad.status).toBe(400);
    expect((bad.body as { error?: string }).error).toBe("invalid_boardComposition");
    expect(String((bad.body as { message?: string }).message)).toContain("Board composition");
    /* A boolean is meaningful on a yes/no term and meaningless on a composition. */
    const badBool = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ boardComposition: true });
    expect(badBool.status).toBe(400);
    /* Nothing was stored by either refusal. */
    expect(readGovernanceTerms(await readRound(roundId))[0].recorded).toBe(false);
  }, 60000);
});

/* ════════════════════════════════════════════════════════════ FINDING 3 ════ */

describe("W114 · FINDING 3 — a participation cap entered in Edit terms reaches the exit calculation", () => {
  it("W114-HTTP-8 — the typed cap is validated, stored, and read by the SHARED reader the waterfall uses", async () => {
    const companyId = `co_${STAMP}_cap`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);

    /* The value as the founder types it into the new control, validated by the
       SAME shared function the control calls before enabling Save. */
    const typed = "2.5";
    const parsed = parseCapMultiple(typed);
    expect(parsed).toBe(2.5);

    const patch = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ liquidationPreference: "1x participating", capParticipation: typed });
    expect(patch.status).toBe(200);
    expect((patch.body as { savedFields?: string[] }).savedFields).toContain("capParticipation");

    /* THE EXIT CALCULATION'S OWN READ PATH: `roundStoredTerms` is what
       `server/track1Routes.ts` and the waterfall adapter consult. Not re-read
       from the round object by this test — read the way the engine reads it. */
    const stored = roundStoredTerms(roundId);
    /* THE FIGURE THE WATERFALL USES. `participationCapMultiple` is what
       `server/track1Routes.ts` and `shared/roundMathEngineAdapter.ts` consult when
       they cap a participating class's take at an exit, and
       `participationCapSource` records WHERE it was read from — here, the numeric
       key the new Edit-terms control writes. */
    expect(stored.participationCapMultiple).toBe(2.5);
    expect(stored.participationCapRaw).toBe("2.5");
    expect(stored.participationCapSource).toBe("capParticipation");
    expect(stored.participationCapUnreadable).toBe(false);
    expect(stored.participationCapConflict).toBe(false);

    /* AND BOTH DISPLAY SURFACES: each derives its sentence from the SAME shared
       reader over the same two stored fields, so no screen can disagree with the
       figure the exit calculation just used. */
    const terms = readLiquidationTerms({
      liquidationPreference: stored.liquidationPreferenceRaw,
      capParticipation: stored.participationCapRaw,
    });
    expect(terms.participating).toBe(true);
    expect(terms.capMultiple).toBe(2.5);
    expect(terms.capMultiple).toBe(stored.participationCapMultiple);
    const sentence = describeLiquidationTerms(terms);
    expect(sentence).toContain("2.5");
    const detail = await readRound(roundId);
    const list = await readFromList(companyId, roundId);
    expect(String(detail.capParticipation)).toBe("2.5");
    expect(String(list.capParticipation)).toBe("2.5");
  }, 60000);

  it("W114-HTTP-9 — a cap outside the shared bound is REFUSED, and the round keeps the old value", async () => {
    const companyId = `co_${STAMP}_cap2`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId, { capParticipation: "3" });
    /* `parseCapMultiple` is what the control validates with; both it and the
        server refuse the same values, which is why the control can be trusted. */
    expect(parseCapMultiple("99")).toBeNull();
    expect(parseCapMultiple("2x")).toBe(2); // a founder may type the multiple with its unit
    const bad = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ capParticipation: "99" });
    expect(bad.status).toBe(400);
    expect(String((bad.body as { field?: string }).field ?? (bad.body as { error?: string }).error)).toContain("cap");
    expect(String((await readRound(roundId)).capParticipation)).toBe("3");
  }, 60000);

  it("W114-HTTP-10 — the FROZEN anti-dilution fields are untouched: junk still refuses, and the unwired key is named NOT STORED", async () => {
    /* STANDING RULING: `antiDilution` and `mfn` are NOT wired by this wave. Both
       halves are asserted so the wave cannot be read as having quietly enabled
       either — and the second half is also Finding 4 doing its job. */
    const companyId = `co_${STAMP}_ad`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    const junk = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ antiDilutionType: "nonsense-method" });
    expect(junk.status).toBe(400);
    expect((junk.body as { error?: string }).error).toBe("invalid_antiDilutionType");
    const unwired = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ antiDilution: "broad-based weighted average" });
    expect(unwired.status).toBe(200);
    expect((unwired.body as { notStoredFields?: string[] }).notStoredFields).toContain("antiDilution");
  }, 60000);
});

/* ════════════════════════════════════════════════════════════ FINDING 4 ════ */

describe("W114 · FINDING 4 — the confirmation names what was stored, and what was not", () => {
  it("W114-HTTP-11 — every accepted field is named in `savedFields`", async () => {
    const companyId = `co_${STAMP}_conf1`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    const r = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({
        liquidationPreference: "2x participating",
        capParticipation: "3",
        boardComposition: "2 founder, 1 investor",
      });
    expect(r.status).toBe(200);
    const body = r.body as { savedFields?: string[]; removedFields?: string[]; notStoredFields?: string[] };
    expect(body.savedFields).toBeTruthy();
    for (const k of ["liquidationPreference", "capParticipation", "boardComposition"]) {
      expect(body.savedFields).toContain(k);
    }
    expect(body.notStoredFields).toEqual([]);
  }, 60000);

  it("W114-HTTP-12 — a field the writer did NOT take is named as not stored, at that moment", async () => {
    const companyId = `co_${STAMP}_conf2`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId);
    /* `notAThing` is not on any whitelist, so nothing stores it. Before this
       wave the response said "ok" and named nothing, and the operator had no way
       to learn the value had gone nowhere. */
    const r = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ liquidationPreference: "1x participating", notAThing: "typed and lost" });
    expect(r.status).toBe(200);
    const body = r.body as { savedFields?: string[]; notStoredFields?: string[] };
    expect(body.savedFields).toContain("liquidationPreference");
    expect(body.notStoredFields).toContain("notAThing");
  }, 60000);

  it("W114-HTTP-13 — a REMOVAL is named as a removal and never counted as a save", async () => {
    const companyId = `co_${STAMP}_conf3`;
    await makeCompany(companyId);
    const roundId = await makeRound(companyId, { capParticipation: "3" });
    const r = await request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN)
      .send({ capParticipation: null });
    expect(r.status).toBe(200);
    const body = r.body as { savedFields?: string[]; removedFields?: string[] };
    expect(body.removedFields).toContain("capParticipation");
    expect(body.savedFields ?? []).not.toContain("capParticipation");
  }, 60000);
});
