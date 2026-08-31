/**
 * WAVE 107 — SERVER-SIDE ROUND-TRIPS FOR THE FIELDS FINDING 1 AND FINDING 2 MOVE.
 *
 * Every assertion here goes over real HTTP against `registerRoutes`, because the
 * whole point of the wave is that a value typed by a founder must survive the
 * whole journey and come back. Nothing is asserted against an in-memory object.
 *
 * WHICH OF THESE FAIL ON THE OLD CODE, and why:
 *
 *   · "the round narrative survives an Edit-terms save" FAILS BEFORE. `notes` was
 *     not on `roundsStore.UPDATE_EXTRAS_WHITELIST` and was not read by
 *     `PATCH /api/rounds/:id/terms`, so an edited narrative was discarded and the
 *     round came back holding the old text.
 *   · "use of proceeds survives an Edit-terms save" FAILS BEFORE for the same
 *     reason on the route side (the key was whitelisted in the store but the
 *     terms route never put it in `updates`).
 *   · The option-pool and liquidation-preference round-trips PASS BEFORE as well.
 *     They are kept deliberately: they are the proof cited in
 *     `build_log/wave107/W107_PREFLIGHT.md` that the server and the store are NOT
 *     where those values were lost, and they are the regression fence that keeps
 *     it that way while the client-side fix lands.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { roundStoredTerms } from "../lib/roundStoredTerms";
import { w212Attest } from "./_w212RoundAttestation";

const ADMIN = "u_admin";
const STAMP = `w107${Date.now().toString(36)}`;
let app: Express;

/* The narrative the QA round actually held, plus the two things a paragraph
   field must survive and that a naive implementation quietly eats: real
   punctuation and real line breaks. */
const NARRATIVE = "50% engineering, 30% GTM, 20% ops";
const NARRATIVE_MULTILINE =
  "Use of proceeds \u2014 as agreed with the lead:\n" +
  "  \u2022 50% engineering (2 senior hires, 1 contractor);\n" +
  "  \u2022 30% go-to-market \u2014 \"paid + events\";\n" +
  "  \u2022 20% ops & runway.\n\n" +
  "Reviewed 22 Aug 2026.";

async function makeCompany(companyId: string): Promise<void> {
  await request(app)
    .post("/api/founder/companies")
    .set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W107 ${companyId}` });
}

/** The QA round from the Wave 107 brief, created over HTTP. Returns its id. */
async function makeQaRound(companyId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send(w212Attest({
      companyId,
      name: `${companyId} QA Verify Round`,
      type: "seed",
      instrument: "preferred",
      /* Priced rounds require a price; supplied so the create is not refused for
         an unrelated reason. Money is exact decimal TEXT, never a float. */
      pricePerShare: "0.25",
      openDate: "2026-08-01",
      closeDate: "2026-12-31",
      targetAmount: "500000",
      preMoney: "2000000",
      fdPreMoneyShares: "8000000",
      sharesAuthorized: "2000000",
      region: "HK",
      optionPoolPostPercent: "10",
      optionPoolMode: "pre_money",
      notes: NARRATIVE,
      useOfProceeds: NARRATIVE,
      liquidationPreference: "1x participating",
      capParticipation: "3",
      ...extra,
    }));
  expect(created.status).toBe(200);
  return String((created.body as { id?: string }).id ?? "");
}

/** The round as the founder's own screens read it: the detail endpoint. */
async function readRound(roundId: string): Promise<Record<string, unknown>> {
  const detail = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
  expect(detail.status).toBe(200);
  const body = detail.body as Record<string, unknown>;
  return (body.round as Record<string, unknown>) ?? body;
}

/** The round as the ROUNDS LIST reads it — the source the Edit-terms dialog seeds from. */
async function readFromList(companyId: string, roundId: string): Promise<Record<string, unknown>> {
  const list = await request(app).get(`/api/rounds?companyId=${companyId}`).set("x-user-id", ADMIN);
  expect(list.status).toBe(200);
  const found = ((list.body as Record<string, unknown>[]) ?? []).find((r) => r.id === roundId);
  expect(found).toBeTruthy();
  return found as Record<string, unknown>;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server as never, app as never);
}, 120000);

describe("W107 · FINDING 1 — the option pool round-trips, percentage AND placement", () => {
  it("carries the checkbox, the percentage and the pre-money placement back on both read paths", async () => {
    const companyId = `co_${STAMP}_pool`;
    await makeCompany(companyId);
    const roundId = await makeQaRound(companyId);

    const detail = await readRound(roundId);
    const list = await readFromList(companyId, roundId);

    /* THE CHECKBOX. `Rounds.tsx` derives the ticked state from the presence of a
       percentage, so a present, non-empty percentage IS the checkbox. */
    expect(String(detail.optionPoolPostPercent ?? "")).not.toBe("");
    expect(String(list.optionPoolPostPercent ?? "")).not.toBe("");

    /* THE PERCENTAGE, percent-as-written: "10" means 10%. No rescaling anywhere. */
    expect(String(detail.optionPoolPostPercent)).toBe("10");
    expect(String(list.optionPoolPostPercent)).toBe("10");

    /* THE PLACEMENT — which is the money question: a pre-money pool is paid for
       by the existing holders, a post-money pool by everyone. */
    expect(String(detail.optionPoolMode)).toBe("pre_money");
    expect(String(list.optionPoolMode)).toBe("pre_money");
  }, 60000);

  it("keeps a post-money placement post-money — the two choices are not interchangeable", async () => {
    const companyId = `co_${STAMP}_poolpost`;
    await makeCompany(companyId);
    const roundId = await makeQaRound(companyId, { optionPoolMode: "post_money" });
    const detail = await readRound(roundId);
    expect(String(detail.optionPoolMode)).toBe("post_money");
    expect(String(detail.optionPoolPostPercent)).toBe("10");
  }, 60000);
});

describe("W107 · FINDING 1-B — the narrative round-trips through an Edit-terms save", () => {
  it("returns the wizard's narrative unchanged on create", async () => {
    const companyId = `co_${STAMP}_narr`;
    await makeCompany(companyId);
    const roundId = await makeQaRound(companyId);
    const detail = await readRound(roundId);
    expect(detail.notes).toBe(NARRATIVE);
    expect(detail.useOfProceeds).toBe(NARRATIVE);
  }, 60000);

  it("persists an edited narrative — punctuation, bullets, em dashes, quotes and line breaks byte-for-byte", async () => {
    const companyId = `co_${STAMP}_narredit`;
    await makeCompany(companyId);
    const roundId = await makeQaRound(companyId);

    const patch = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", ADMIN)
      .send({ notes: NARRATIVE_MULTILINE, useOfProceeds: NARRATIVE_MULTILINE });
    expect(patch.status).toBe(200);

    /* THE ASSERTION THAT FAILS ON THE OLD CODE: before this wave `notes` was
       rejected as an unknown field and the round came back holding the ORIGINAL
       text, so this equality was false. */
    const detail = await readRound(roundId);
    expect(detail.notes).toBe(NARRATIVE_MULTILINE);
    expect(detail.useOfProceeds).toBe(NARRATIVE_MULTILINE);

    /* Not merely "contains": every newline and every character survives. */
    expect(String(detail.notes).split("\n").length).toBe(NARRATIVE_MULTILINE.split("\n").length);
    expect(String(detail.notes)).toContain("\u2022 30% go-to-market \u2014 \"paid + events\";");

    /* And it survives a re-read from the LIST too, which is where the Edit dialog
       re-seeds itself from when the founder opens it a second time. */
    const list = await readFromList(companyId, roundId);
    expect(list.notes).toBe(NARRATIVE_MULTILINE);
  }, 60000);

  it("lets the founder CLEAR the narrative — an empty string is an edit, not an absence", async () => {
    const companyId = `co_${STAMP}_narrclear`;
    await makeCompany(companyId);
    const roundId = await makeQaRound(companyId);
    const patch = await request(app)
      .patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", ADMIN)
      .send({ notes: "" });
    expect(patch.status).toBe(200);
    const detail = await readRound(roundId);
    expect(detail.notes).toBe("");
  }, 60000);
});

describe("W107 · FINDING 2 — the participation terms the two screens must agree on", () => {
  it("stores the preference the founder chose, and the participation cap beside it", async () => {
    const companyId = `co_${STAMP}_liq`;
    await makeCompany(companyId);
    const roundId = await makeQaRound(companyId);

    const detail = await readRound(roundId);
    const list = await readFromList(companyId, roundId);

    /* The stored text is what the founder chose. Round Detail and Edit terms now
       both render THIS string, so their agreement is structural. */
    expect(String(detail.liquidationPreference)).toBe("1x participating");
    expect(String(list.liquidationPreference)).toBe("1x participating");
    expect(String(detail.capParticipation)).toBe("3");
    expect(String(list.capParticipation)).toBe("3");

    /* And the single reader of negotiated terms agrees with both. */
    const stored = roundStoredTerms(roundId) as unknown as Record<string, unknown>;
    expect(stored.participatingPreferred).toBe(true);
    expect(Number(stored.liquidationPreferenceMultiple)).toBe(1);
    expect(Number(stored.participationCapMultiple)).toBe(3);
  }, 60000);

  it("stores NON-participating as non-participating — the hardcoded string was not merely a wrong default", async () => {
    const companyId = `co_${STAMP}_liqnon`;
    await makeCompany(companyId);
    const roundId = await makeQaRound(companyId, {
      liquidationPreference: "1x non-participating",
      capParticipation: null,
    });
    const detail = await readRound(roundId);
    expect(String(detail.liquidationPreference)).toBe("1x non-participating");
    const stored = roundStoredTerms(roundId) as unknown as Record<string, unknown>;
    expect(stored.participatingPreferred).toBe(false);
  }, 60000);
});

describe("W107 · FINDING 1-D — the anti-dilution vocabulary mismatch, recorded as a test", () => {
  it("still refuses the wizard's token, because converging the vocabulary is NOT done in this wave", async () => {
    const companyId = `co_${STAMP}_ad`;
    await makeCompany(companyId);
    /* This is a DELIBERATE, DOCUMENTED refusal, not a defect this wave fixed. The
       wizard's `ANTI_DILUTION_VARIANTS` offers `broad_based_wa`; the validator and
       the engine accept `broad_based`. Converging them needs the term-sheet
       reconciliation files, which are outside this wave's area — see
       `build_log/wave107/W107_PREFLIGHT.md` F1-D for the full plan.

       The test exists so that whoever converges the vocabulary is told by a
       FAILING TEST that they have finished, rather than having to rediscover the
       mismatch from a 400 in a browser. When it starts failing, the convergence
       has landed and this expectation should be inverted. */
    const created = await request(app)
      .post("/api/rounds")
      .set("x-user-id", ADMIN)
      .send(w212Attest({
        companyId,
        name: `${companyId} vocabulary probe`,
        type: "seed",
        instrument: "preferred",
        pricePerShare: "0.25",
        openDate: "2026-08-01",
        closeDate: "2026-12-31",
        targetAmount: "500000",
        preMoney: "2000000",
        fdPreMoneyShares: "8000000",
        sharesAuthorized: "2000000",
        antiDilutionType: "broad_based_wa",
      }));
    expect(created.status).toBe(400);
    expect(String((created.body as { error?: string }).error)).toBe("invalid_antiDilutionType");
    /* The refusal names the accepted vocabulary and what it received, so the
       message itself is the convergence spec. */
    expect(String((created.body as { message?: string }).message)).toContain("broad_based");
    expect(String((created.body as { message?: string }).message)).toContain("broad_based_wa");
  }, 60000);
});
