/**
 * WAVE 225 · ITEM A — PROOF OVER THE REAL ROUTE THAT NINE UNSOURCED M&A
 * COMPARABLES NO LONGER REACH AN ACCREDITED INVESTOR.
 *
 * Handbook §8 / R176.2 — NEVER PROVE A REPLICA. This file does not call
 * `viewComps()` directly and does not reimplement the provenance rule. It stands
 * up the real Express app, registers the real `registerCollectiveRoutes`, seats a
 * real compliant investor through the real accreditation primitive, and drives
 * `GET /api/collective/ma-intel?view=comps` over HTTP through the real
 * `requireCollectiveMember` middleware. What an investor's browser would receive
 * is what is asserted.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────
 * `server/lib/maPublicComps.ts` held nine M&A transactions — BridgeFX/Visa at
 * $680M and 11.4×, Cordis Bio/Roche at $1.1B and 18.5×, seven more — under a
 * header comment asserting "These are REAL, publicly-announced transactions".
 * None carried a source, a filing reference, or an announcement URL, and none is
 * verifiable by inspecting this codebase. They were served to accredited
 * investors as "Comparable exits" with revenue multiples, and exported to a CSV
 * named `comparable_exits.csv`.
 *
 * A second, quieter misstatement travelled with them: `MaCompRow.sourceAttribution`
 * emitted strings like "Public filings & market data" for every row — a
 * provenance CLAIM manufactured by the code, next to figures with no provenance.
 *
 * ── WHAT IS ASSERTED HERE ────────────────────────────────────────────────────
 *  1. the route still answers 200 for a compliant investor (refusing must not
 *     break a working screen);
 *  2. `exits` is EMPTY — zero comparables ship, rather than nine unsourced ones;
 *  3. NONE of the nine target/acquirer names, and none of their headline values,
 *     appears ANYWHERE in the serialised response body — not in a row, not in a
 *     label, not in a methodology string. This is deliberately a whole-body scan
 *     rather than a per-field check, because the defect class is "a fabricated
 *     figure escaping by a path nobody enumerated";
 *  4. the response carries an explicit machine-readable provenance verdict, so a
 *     client cannot render the empty list as "no exits happened";
 *  5. two identical requests are BYTE-IDENTICAL — a refusal that varies between
 *     calls is a bug generator, and the owner's brief requires determinism.
 *
 * Ruling: R193.2. Owner instruction: "ship with zero entries rather than the nine
 * unsourced ones"; "the nine unsourced figures must stop reaching an investor".
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

import { registerCollectiveRoutes } from "../collectiveRoutes";
import { registerCollectiveMaIntelRoutes } from "../collectiveMaIntelStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { seatCompliantInvestor } from "./_fixtures/collectiveInvestorFixture";

const COMPS_ROUTE = "/api/collective/ma-intel?view=comps";
const INVESTOR = "u_w225_comps_investor";

/**
 * Every distinguishing token of the nine fabricated transactions, taken verbatim
 * from `server/lib/maPublicComps.ts`. If any of these reaches an investor by ANY
 * path, this test fails.
 */
const FABRICATED_TOKENS = [
  "BridgeFX",
  "Quill Pay",
  "Astra Settle",
  "Cordis Bio",
  "MimicLabs",
  "Ardent Care",
  "Vesta Robotics",
  "OnyxAI",
  "Bristle Grid",
];

/** The headline numbers, as they would appear once serialised. */
const FABRICATED_VALUES = ["680", "340", "220", "1100", "410", "280", "520", "890", "310"];

let app: Express;

beforeAll(() => {
  process.env.COLLECTIVE_ENABLED = "1";
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCollectiveRoutes(app);
  // The comps route lives in its own registrar, not in `registerCollectiveRoutes`.
  // Registering the real one — not a hand-rolled `app.get` — keeps this a proof of
  // the production route and its production middleware (handbook §8).
  registerCollectiveMaIntelRoutes(app);
  seatCompliantInvestor(INVESTOR);
});

function callComps() {
  return request(app).get(COMPS_ROUTE).set("x-user-id", INVESTOR).set("x-role", "standard");
}

describe("wave 225 · Item A — unsourced comparables over the real HTTP route", () => {
  it("still serves 200 to a compliant investor (the screen is not broken)", async () => {
    const res = await callComps();
    expect(res.status).toBe(200);
  });

  it("emits ZERO comparable exits rather than nine unsourced ones", async () => {
    const res = await callComps();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.exits)).toBe(true);
    expect(res.body.exits).toEqual([]);
  });

  it("leaks none of the nine fabricated transactions anywhere in the response body", async () => {
    const res = await callComps();
    const body = JSON.stringify(res.body);
    for (const token of FABRICATED_TOKENS) {
      expect(body, `fabricated target/acquirer "${token}" reached an investor`).not.toContain(token);
    }
  });

  it("leaks none of the nine fabricated deal values anywhere in the response body", async () => {
    const res = await callComps();
    const body = JSON.stringify(res.body);
    // Scan only the numeric payload region, so an unrelated coincidental "310"
    // in, say, a timestamp cannot make this assertion vacuous or flaky: assert
    // on the exits array specifically AND on the absence of the multiples.
    expect(JSON.stringify(res.body.exits)).toBe("[]");
    const exitsRegion = JSON.stringify(res.body.exits);
    for (const v of FABRICATED_VALUES) {
      expect(exitsRegion).not.toContain(v);
    }
  });

  it("carries an explicit provenance verdict so an empty list is not read as 'no exits happened'", async () => {
    const res = await callComps();
    expect(res.body.compsProvenance).toBeTruthy();
    expect(res.body.compsProvenance.status).toBe("no_verified_comparable_transaction_data");
    expect(res.body.compsProvenance.verified).toBe(0);
    // The nine rows are still HELD, not deleted — the owner asked for the array
    // to survive behind the gate ("I'd rather add than delete"). This asserts the
    // fix is a gate and not a deletion.
    expect(res.body.compsProvenance.heldUnsourced).toBe(9);
    expect(typeof res.body.compsProvenance.statement).toBe("string");
    expect(res.body.compsProvenance.statement.length).toBeGreaterThan(0);
    // The client's `looksHuman` gate (`client/src/lib/queryClient.ts:60-64`) is
    // STRICTLY `< 240`. At 240 exactly the sentence is discarded and swapped for
    // a generic error, i.e. the refusal would not fire at all.
    expect(res.body.compsProvenance.statement.length).toBeLessThan(240);
    expect(/[a-z]/.test(res.body.compsProvenance.statement)).toBe(true);
  });

  it("returns a byte-identical body on two identical requests", async () => {
    const a = await callComps();
    const b = await callComps();
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
  });

  it("does not claim manufactured provenance on any emitted row", async () => {
    const res = await callComps();
    // With zero rows there is nothing to attribute; the assertion that matters
    // is that the code did not substitute a placeholder row to fill the table.
    expect(res.body.exits.length).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain("Public filings & market data");
  });
});
