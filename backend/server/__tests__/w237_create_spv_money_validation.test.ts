/**
 * WAVE 237 — MONEY VALIDATION AT `createSpv`.
 *
 * `spvEngineStore.createSpv` validated the name, jurisdiction, carry basis, SPV
 * type, distribution scope, status, LP visibility and mandate description — then
 * assigned `targetRaiseMinor`, `minCheckMinor` and `capMinor` with NO check. The
 * `cap >= target` rule existed ONLY in `spvTemplateStore`.
 *
 * WHAT THIS SUITE PROVES, and the order matters:
 *
 *  §1  The rule is MIRRORED, not invented — asserted against spvTemplateStore's
 *      own source text, so a divergence is a test failure.
 *  §2  Each clause of the rule refuses, over the REAL route, with the right code.
 *  §3  THE ANTI-LOCKOUT PROOF. New writes only. An existing incoherent vehicle can
 *      still be read AND updated. This is the most important section in the file:
 *      the brief's hard constraint is that locking a partner out of a live vehicle
 *      is far worse than an incoherent row.
 *  §4  THE PRE-FLIGHT PROOF. A money refusal leaves NO sign-off row and NO vehicle.
 *  §5  Non-restriction: everything that was creatable before is still creatable.
 *  §6  No `Number()` / `parseInt` / `parseFloat` in the money path.
 *  §7  A read-only report of existing rows that would fail the new rule.
 *
 * REAL ROUTES, PRODUCTION REGISTRARS. `registerSpvEngineRoutes` is the same
 * function `server/index.ts` calls. No replica of the route, the store or the rule.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import * as fs from "node:fs";
import * as path from "node:path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import {
  SPV_SUBSCRIPTION_REFUSAL_HEADLINE,
  SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS,
  spvSubscriptionRefusalHeadlinesOverLimit,
} from "@shared/spvSubscriptionRefusalCopy";

const MANAGING = "u_avi_managing";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}
function get(p: string) {
  return request(app).get(p).set("x-user-id", MANAGING);
}

/** The minimum valid create payload, including the mandatory ESIGN/UETA sign-off. */
function createBody(extra: Record<string, unknown> = {}) {
  return {
    name: "W237 Vehicle",
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    ...extra,
  };
}

const STORE_SRC = fs.readFileSync(path.join(process.cwd(), "server/spvEngineStore.ts"), "utf8");
const TEMPLATE_SRC = fs.readFileSync(path.join(process.cwd(), "server/spvTemplateStore.ts"), "utf8");
const ROUTES_SRC = fs.readFileSync(path.join(process.cwd(), "server/spvEngineRoutes.ts"), "utf8");

/**
 * Comments stripped, STRING LITERALS PRESERVED.
 *
 * Literals are kept deliberately: the error codes this wave must emit
 * (`INVALID_AMOUNT`, `CAP_BELOW_TARGET`) ARE string literals and are part of what
 * is under test. Only comments are removed — because the money-path comments
 * mention `Number()` and `parseFloat` by name in order to say they are not used,
 * and a naive grep would match the prose instead of the code.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const STORE_CODE = stripComments(STORE_SRC);

/**
 * Body text of a named top-level `function`, by brace balance.
 *
 * MY FIRST VERSION OF THIS WAS WRONG AND IT MATTERED. It took `indexOf("{", at)`
 * as the start of the body. `assertValidSpvMoney(data: { … })` has an inline
 * object type in its PARAMETER LIST, so that brace opened the parameter type and
 * the balance closed at `}): void {` — yielding a 100-character "body" that was
 * really the parameter type. Four assertions then "passed or failed" against text
 * that was not the function. The `body.length > 200` floor is what exposed it,
 * which is why every use of this helper keeps one.
 *
 * The body starts at the brace that follows the signature terminator.
 */
function functionBody(src: string, name: string, terminator = "): void {"): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return "";
  const sig = src.indexOf(terminator, at);
  if (sig < 0) return "";
  const open = sig + terminator.length - 1; // the body's own `{`
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

/* ════════════════════════════════════════════════════════════════════════════
   §0 — THE STRIPPER STRIPPED, AND KEPT THE LITERALS
   Every grep conclusion below depends on this. Proved, not assumed.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §0 — comment stripping is real", () => {
  it("removes comments but preserves string literals", () => {
    // A phrase that exists ONLY in a Wave 237 comment.
    expect(STORE_SRC.includes("NO `Number(v)` STRING COERCION")).toBe(true);
    expect(STORE_CODE.includes("NO `Number(v)` STRING COERCION")).toBe(false);
    // The comment names parseFloat in order to disclaim it; the code must not.
    expect(STORE_SRC.includes("parseFloat")).toBe(true);
    expect(STORE_CODE.includes("parseFloat")).toBe(false);
    // A literal under test SURVIVES.
    expect(STORE_CODE.includes('"CAP_BELOW_TARGET"')).toBe(true);
    expect(STORE_CODE.includes('"INVALID_AMOUNT"')).toBe(true);
  });

  it("negative control — the technique can fail", () => {
    expect(STORE_CODE.includes("assertValidSpvMoney")).toBe(true);
    expect(STORE_CODE.includes("thisIdentifierDoesNotExistAnywhere")).toBe(false);
  });

  it("functionBody returns the BODY, not the parameter type — the bug that fooled me once", () => {
    const body = functionBody(STORE_CODE, "assertValidSpvMoney");
    // The body contains statements...
    expect(body).toContain("throw new Error");
    expect(body).toContain("const targetRaiseMinor");
    // ...and the parameter type's own text does NOT constitute the whole of it.
    expect(body.length).toBeGreaterThan(600);
    // Negative control: asking for a terminator that does not exist yields "".
    expect(functionBody(STORE_CODE, "assertValidSpvMoney", "): never {")).toBe("");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §1 — THE RULE IS MIRRORED FROM spvTemplateStore, NOT INVENTED
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §1 — mirrors the existing rule", () => {
  it("spvTemplateStore still owns the upstream rule this mirrors", () => {
    // If the upstream rule is renamed or deleted, this wave's claim to be a
    // mirror stops being true, and this fails.
    expect(TEMPLATE_SRC).toContain("function normaliseMinor(");
    expect(TEMPLATE_SRC).toContain(
      "capMinor !== null && targetRaiseMinor !== null && capMinor < targetRaiseMinor",
    );
    expect(TEMPLATE_SRC).toContain('"CAP_BELOW_TARGET"');
    expect(TEMPLATE_SRC).toContain('"INVALID_AMOUNT"');
  });

  it("every clause of normaliseMinor has a counterpart in the new checker", () => {
    const body = functionBody(STORE_CODE, "assertValidSpvMoney");
    expect(body.length).toBeGreaterThan(200);
    // finite / number
    expect(body).toContain("Number.isFinite");
    // integer
    expect(body).toContain("Number.isInteger");
    // non-negative
    expect(body).toContain("< 0");
    // MAX_SAFE_INTEGER gate
    expect(body).toContain("Number.isSafeInteger");
    // the coherence rule, byte-identical in its predicate to the upstream one
    expect(body).toContain(
      "capMinor !== null && targetRaiseMinor !== null && capMinor < targetRaiseMinor",
    );
  });

  it("all three amount fields are checked, not just the two in the coherence rule", () => {
    const body = functionBody(STORE_CODE, "assertValidSpvMoney");
    expect(body.length).toBeGreaterThan(600);
    expect(body).toContain("data.targetRaiseMinor");
    expect(body).toContain("data.minCheckMinor");
    expect(body).toContain("data.capMinor");
  });

  it("minCheckMinor is checked BY BEHAVIOUR, not only by grep", () => {
    // The grep above could pass on a line that reads the field and throws it
    // away. This cannot.
    expect(() => spvEngineStore.validateCreateMoney({ minCheckMinor: 1.5 })).toThrow("INVALID_AMOUNT");
    expect(() => spvEngineStore.validateCreateMoney({ minCheckMinor: -1 })).toThrow("INVALID_AMOUNT");
    expect(() => spvEngineStore.validateCreateMoney({ minCheckMinor: 1 })).not.toThrow();
  });

  it("ONE implementation — the store method and the route both delegate to it", () => {
    // Not two copies of the rule. `validateCreateMoney` is a delegation only.
    const method = STORE_CODE.slice(
      STORE_CODE.indexOf("validateCreateMoney(data: {"),
      STORE_CODE.indexOf("createSpv("),
    );
    expect(method).toContain("assertValidSpvMoney(data)");
    // and it contains no rule of its own
    expect(method).not.toContain("Number.isInteger");
    expect(method).not.toContain("CAP_BELOW_TARGET");
    // exactly one place throws each code in the store
    const codeOnly = STORE_CODE;
    expect(codeOnly.split('throw new Error("CAP_BELOW_TARGET")').length - 1).toBe(1);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §2 — EACH CLAUSE REFUSES, OVER THE REAL ROUTE
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §2 — refusals over POST /api/partner/me/spv", () => {
  it("cap below target → 400 CAP_BELOW_TARGET", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Cap Below", targetRaiseMinor: 9480000000, capMinor: 3000 }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("CAP_BELOW_TARGET");
  });

  /**
   * THE PLATFORM TOLD ME THIS WAS MISSING AND I ALMOST SHIPPED IT.
   *
   * With only the status mapping in place, the first run of the test above printed
   * to stderr:
   *
   *   [spv.refusal.unexplained] CAP_BELOW_TARGET (incident SPV-B2F4CED6) — no
   *   plain-language copy exists for this code; the client was shown the generic
   *   refusal sentence and this reference.
   *
   * So the partner would have got "Something went wrong on our side" plus an
   * opaque reference to quote to support — for a refusal that is theirs to fix by
   * changing one number, and that is not a server failure at all. A wave that adds
   * a refusal owns its wording.
   */
  it("the refusal is EXPLAINED — a real sentence, no incident reference, no generic fallback", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Explained", targetRaiseMinor: 9480000000, capMinor: 3000 }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("CAP_BELOW_TARGET");

    // 1. A human sentence reached the client.
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message).toContain("cap cannot be below the target raise");
    expect(r.body.guidance).toContain("Nothing has been saved");

    // 2. It did NOT fall through to the unexplained tail. That branch is the only
    //    thing that mints an incidentCode, so its absence is the proof.
    expect(r.body.incidentCode).toBeUndefined();

    // 3. The headline survives queryClient's 240-char `looksHuman` gate — over it,
    //    the client substitutes the generic sentence and the wording is lost.
    expect(r.body.message.length).toBeLessThan(SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS);
    // and no OTHER headline in the registry was pushed over the gate either
    expect(spvSubscriptionRefusalHeadlinesOverLimit()).toEqual([]);

    // 4. It says what happened to the request, not only what was wrong — this is
    //    the same claim §4 proves against the database.
    expect(r.body.guidance).toContain("no sign-off has been recorded");

    // 5. It names no internal identifier (R77).
    for (const t of ["capMinor", "targetRaiseMinor", "spv_launch_signoffs", "createSpv", "minor units"]) {
      expect(r.body.message.includes(t), t).toBe(false);
    }

    // 6. THE SENTENCE IS THE REGISTRY'S, byte for byte. Without this the test
    //    could pass on a sentence produced anywhere — which is how the dead route
    //    branch stayed invisible through a disarm.
    expect(r.body.message).toBe(SPV_SUBSCRIPTION_REFUSAL_HEADLINE.CAP_BELOW_TARGET);
  });

  /**
   * THE GREEN DISARM, AND THE MECHANISM IT EXPOSED.
   *
   * My first fix also added a dedicated `if (msg === "CAP_BELOW_TARGET")` branch to
   * `err()` to attach the sentence. Disarming that branch left ALL 36 TESTS GREEN.
   * It was DEAD CODE: the generic block in `err()` ("Every OTHER code this module
   * can raise that HAS plain-language copy") already attaches `message` and
   * `guidance` to any code that has BOTH a registry entry AND a status mapping, and
   * it returns first.
   *
   * So the whole route-side change is one line in the status map. The branch was
   * removed, and these tests pin the ACTUAL mechanism so the same redundancy cannot
   * be re-added, and so a change to either half of the mechanism fails loudly.
   */
  it("the copy is registered, not inlined at the route — one source of wording", () => {
    expect(SPV_SUBSCRIPTION_REFUSAL_HEADLINE.CAP_BELOW_TARGET).toBeTruthy();
    /* STRIPPED, NOT RAW — and I got this wrong once, in the very test that exists
       to enforce the rule. Asserted against `ROUTES_SRC` this failed, because the
       comment I wrote in the status map QUOTES the dead branch
       (`if (msg === "CAP_BELOW_TARGET")`) in order to record that it was removed.
       The grep was right; the input was wrong. Same trap as W231's `Number(`. */
    const routeCode = stripComments(ROUTES_SRC);
    // The route must not carry its own copy of the sentence...
    expect(routeCode).not.toContain("cap cannot be below the target raise");
    // ...nor a dedicated branch for this code. That branch was dead code.
    expect(routeCode).not.toContain('if (msg === "CAP_BELOW_TARGET")');
    // Positive control: the stripper did not simply eat the whole file.
    expect(routeCode).toContain("CAP_BELOW_TARGET: 400,");
    // And the raw source DOES still contain the quoted branch, in the comment —
    // proving the two inputs genuinely differ and this is not a no-op assertion.
    expect(ROUTES_SRC).toContain('if (msg === "CAP_BELOW_TARGET")');
  });

  it("the sentence arrives via the GENERIC copy block, which needs BOTH halves", () => {
    const code = stripComments(ROUTES_SRC);
    // Half one: the generic block exists and is keyed on the registry lookup plus
    // the status map. This is the mechanism, and it is not this wave's code.
    expect(code).toContain("const headline = spvSubscriptionRefusalHeadline(msg);");
    expect(code).toContain("if (headline && map[msg] !== undefined)");
    // Half two: this wave supplied the registry entry AND the map entry, which is
    // the entire reason the generic block fires for this code.
    expect(SPV_SUBSCRIPTION_REFUSAL_HEADLINE.CAP_BELOW_TARGET).toBeTruthy();
    expect(code).toContain("CAP_BELOW_TARGET: 400,");
    // And the generic block sits ABOVE the unexplained tail, or it would never win.
    expect(code.indexOf("if (headline && map[msg] !== undefined)")).toBeLessThan(
      code.indexOf("mintUnexplainedRefusalReference(msg) })"),
    );
  });

  it("the registry entry is LOAD-BEARING — the wording is not coming from anywhere else", () => {
    // Guards against the wording being satisfied by some other code path. The
    // sentence the route returns must be the registry's own string, character for
    // character — so deleting the registry entry cannot leave the test green.
    const headline = SPV_SUBSCRIPTION_REFUSAL_HEADLINE.CAP_BELOW_TARGET;
    expect(headline).toContain("cap cannot be below the target raise");
    expect(headline.length).toBeLessThan(SPV_SUBSCRIPTION_REFUSAL_HEADLINE_MAX_CHARS);
  });

  it("INVALID_AMOUNT is STILL unexplained — pinned as a known gap, not claimed as fixed", async () => {
    // Honesty fence. This wave did NOT write copy for INVALID_AMOUNT: it has nine
    // throwers across the server and doing so would change the response on eight
    // paths this wave has no business touching. Pinned so the report cannot drift
    // from the behaviour, and so a later wave that DOES fix it is told to update
    // this expectation deliberately.
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Unexplained Gap", targetRaiseMinor: -1 }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_AMOUNT");
    expect(typeof r.body.incidentCode).toBe("string"); // fell through to the tail
    expect(r.body.message).toBeUndefined();
    expect(SPV_SUBSCRIPTION_REFUSAL_HEADLINE.INVALID_AMOUNT).toBeUndefined();
  });

  it("cap EQUAL to target is allowed — a ceiling may sit exactly at the target", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Cap Equal", targetRaiseMinor: 500000, capMinor: 500000 }),
    );
    expect(r.status).toBe(201);
  });

  it("fractional minor unit → 400 INVALID_AMOUNT", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Fractional", targetRaiseMinor: 3000.5 }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_AMOUNT");
  });

  it("negative amount → 400 INVALID_AMOUNT, on each of the three fields", async () => {
    for (const field of ["targetRaiseMinor", "minCheckMinor", "capMinor"]) {
      const r = await post("/api/partner/me/spv", createBody({ name: `W237 Neg ${field}`, [field]: -1 }));
      expect(r.status, field).toBe(400);
      expect(r.body.error, field).toBe("INVALID_AMOUNT");
    }
  });

  it("past MAX_SAFE_INTEGER → 400 INVALID_AMOUNT", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Unsafe", targetRaiseMinor: Number.MAX_SAFE_INTEGER + 2 }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_AMOUNT");
  });

  it("a STRING amount is REJECTED, never coerced — money is not produced by Number()", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 String Amount", targetRaiseMinor: "3000" }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_AMOUNT");
    // And nothing was created from the coerced value.
    const named = rawDb()
      .prepare("SELECT COUNT(*) c FROM spv WHERE name = ?")
      .get("W237 String Amount") as { c: number };
    expect(named.c).toBe(0);
  });

  it("NaN and Infinity → 400 INVALID_AMOUNT (they arrive as null/strings over JSON, so drive the store directly too)", async () => {
    expect(() => spvEngineStore.validateCreateMoney({ targetRaiseMinor: NaN })).toThrow("INVALID_AMOUNT");
    expect(() => spvEngineStore.validateCreateMoney({ targetRaiseMinor: Infinity })).toThrow("INVALID_AMOUNT");
    expect(() => spvEngineStore.validateCreateMoney({ capMinor: -Infinity })).toThrow("INVALID_AMOUNT");
  });

  it("omitted and explicit-null amounts are ALLOWED — prefer a constraint to a prohibition", async () => {
    const a = await post("/api/partner/me/spv", createBody({ name: "W237 No Amounts" }));
    expect(a.status).toBe(201);
    const b = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Null Amounts", targetRaiseMinor: null, minCheckMinor: null, capMinor: null }),
    );
    expect(b.status).toBe(201);
    // A cap with no target, and a target with no cap, are both coherent.
    const c = await post("/api/partner/me/spv", createBody({ name: "W237 Cap Only", capMinor: 10 }));
    expect(c.status).toBe(201);
    const d = await post("/api/partner/me/spv", createBody({ name: "W237 Target Only", targetRaiseMinor: 9480000000 }));
    expect(d.status).toBe(201);
  });

  it("zero is a valid amount — it is not a missing amount", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Zero", targetRaiseMinor: 0, minCheckMinor: 0, capMinor: 0 }),
    );
    expect(r.status).toBe(201);
  });

  it("the store refuses even when called directly, bypassing the route", () => {
    // The rule's home is the store, so a caller that skips the route cannot skip
    // the rule. This is why the check lives in BOTH places.
    expect(() =>
      spvEngineStore.createSpv(
        "ac_consortium_partner_test_partner_inc",
        { name: "W237 Direct", jurisdiction: "delaware", carryBasis: "whole_spv", targetRaiseMinor: 100, capMinor: 1 },
        MANAGING,
      ),
    ).toThrow("CAP_BELOW_TARGET");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §3 — THE ANTI-LOCKOUT PROOF: NEW WRITES ONLY
   The single hardest constraint in the brief. An existing vehicle holding an
   incoherent amount pair must remain fully readable AND fully editable.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §3 — existing vehicles are never rejected or altered", () => {
  it("an incoherent EXISTING row can still be read and UPDATED (no lockout)", async () => {
    // Create a coherent vehicle through the real route...
    const created = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Legacy Vehicle", targetRaiseMinor: 1000, capMinor: 5000 }),
    );
    expect(created.status).toBe(201);
    const id = created.body.spv.id as string;

    /* ...then make it incoherent THROUGH THE REAL, UNVALIDATED UPDATE ROUTE.

       MY FIRST ATTEMPT AT THIS WAS INERT and is worth recording. I mutated the
       `spv` table with raw SQL and then asserted the read. The read returned the
       ORIGINAL figures, because `spvEngineStore` serves reads from an in-memory
       `spvById` map and only WRITES through to SQLite. So the fixture could not
       be moved by the mutation I made — the "fixture no server mutation can move"
       mechanism, in reverse. Using the real PATCH route is both correct and a
       better simulation: it is exactly how a live vehicle came to hold an
       incoherent pair before this rule existed. */
    const skew = await request(app)
      .patch(`/api/partner/me/spv/${id}`)
      .set("x-user-id", MANAGING)
      .send({ capMinor: 1, targetRaiseMinor: 999999 });
    expect(skew.status).toBe(200);

    // 1. IT IS STILL READABLE. Nothing 500s, nothing 400s, nothing is hidden.
    const read = await get(`/api/partner/me/spv/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.spv.capMinor).toBe(1);
    expect(read.body.spv.targetRaiseMinor).toBe(999999);
    // The vehicle is genuinely incoherent by the new rule — so the assertions
    // below are not passing on a coherent row.
    expect(() =>
      spvEngineStore.validateCreateMoney({ capMinor: 1, targetRaiseMinor: 999999 }),
    ).toThrow("CAP_BELOW_TARGET");

    // 2. IT IS STILL EDITABLE on an unrelated field. This is the lockout test.
    //    If validation had been added to updateSpv, this would be 400 and the
    //    partner would have no way to fix the row, because the fix is an update.
    const renamed = await request(app)
      .patch(`/api/partner/me/spv/${id}`)
      .set("x-user-id", MANAGING)
      .send({ name: "W237 Legacy Vehicle Renamed" });
    expect(renamed.status).toBe(200);

    // 3. AND THE INCOHERENT FIGURES WERE NOT ALTERED by the update.
    const after = await get(`/api/partner/me/spv/${id}`);
    expect(after.body.spv.name).toBe("W237 Legacy Vehicle Renamed");
    expect(after.body.spv.capMinor).toBe(1);
    expect(after.body.spv.targetRaiseMinor).toBe(999999);

    // 4. And the partner can still FIX it — the repair path is open.
    const fixed = await request(app)
      .patch(`/api/partner/me/spv/${id}`)
      .set("x-user-id", MANAGING)
      .send({ capMinor: 999999 });
    expect(fixed.status).toBe(200);
  });

  it("updateSpv is deliberately NOT wired to the money rule — pinned so it cannot be added silently", () => {
    // This asserts an intentional ABSENCE. If a later wave adds the check to
    // updateSpv, this fails and forces the lockout analysis to be redone rather
    // than the constraint being quietly extended to existing rows.
    const upd = STORE_CODE.slice(STORE_CODE.indexOf("updateSpv("));
    const firstBrace = upd.indexOf("{");
    let depth = 0;
    let end = upd.length;
    for (let i = firstBrace; i < upd.length; i++) {
      if (upd[i] === "{") depth++;
      else if (upd[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const updBody = upd.slice(firstBrace, end);
    expect(updBody).toContain("assertValidMandateDescription"); // the precedent IS there
    expect(updBody).not.toContain("assertValidSpvMoney"); // the money rule is NOT
    expect(updBody).not.toContain("validateCreateMoney");
  });

  it("the checker is called from exactly two places, both on the create path", () => {
    const storeCalls = STORE_CODE.split("assertValidSpvMoney(").length - 1;
    // one definition + one call in createSpv + one call in validateCreateMoney
    expect(storeCalls).toBe(3);
    const routeCalls = stripComments(ROUTES_SRC).split("validateCreateMoney(").length - 1;
    expect(routeCalls).toBeGreaterThanOrEqual(1);
    // and nowhere near a delete/archive path
    expect(STORE_CODE).not.toContain("archiveSpv(data)");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §4 — THE PRE-FLIGHT PROOF: A REFUSAL WRITES NOTHING
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §4 — a money refusal leaves no sign-off and no vehicle", () => {
  it("no spv_launch_signoffs row and no spv row survive a CAP_BELOW_TARGET refusal", async () => {
    const before = {
      signoffs: rawDb().prepare("SELECT COUNT(*) c FROM spv_launch_signoffs").get() as { c: number },
      spvs: rawDb().prepare("SELECT COUNT(*) c FROM spv").get() as { c: number },
    };

    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Orphan Probe", targetRaiseMinor: 50000, capMinor: 1 }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("CAP_BELOW_TARGET");

    const after = {
      signoffs: rawDb().prepare("SELECT COUNT(*) c FROM spv_launch_signoffs").get() as { c: number },
      spvs: rawDb().prepare("SELECT COUNT(*) c FROM spv").get() as { c: number },
    };
    // THE POINT: `recordSignoff` is the first write on this route and it runs
    // BEFORE createSpv. Validating only in the store would have left an orphaned
    // authorization record for a vehicle that never existed.
    expect(after.signoffs.c).toBe(before.signoffs.c);
    expect(after.spvs.c).toBe(before.spvs.c);

    const named = rawDb()
      .prepare("SELECT COUNT(*) c FROM spv WHERE name = ?")
      .get("W237 Orphan Probe") as { c: number };
    expect(named.c).toBe(0);
  });

  it("positive control — a VALID create does write both rows", async () => {
    const before = rawDb().prepare("SELECT COUNT(*) c FROM spv_launch_signoffs").get() as { c: number };
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Preflight Control", targetRaiseMinor: 1000, capMinor: 2000 }),
    );
    expect(r.status).toBe(201);
    const after = rawDb().prepare("SELECT COUNT(*) c FROM spv_launch_signoffs").get() as { c: number };
    // Without this, the assertion above could pass because the route never
    // writes a sign-off at all.
    expect(after.c).toBe(before.c + 1);
  });

  it("the money check sits ABOVE the first write in the route source", () => {
    const code = stripComments(ROUTES_SRC);
    const check = code.indexOf("validateCreateMoney(");
    const firstWrite = code.indexOf("recordSignoff(", check - 20000 > 0 ? check - 20000 : 0);
    expect(check).toBeGreaterThan(0);
    expect(firstWrite).toBeGreaterThan(check);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §5 — NON-RESTRICTION (R190.10)
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §5 — nothing coherent became uncreatable", () => {
  it("the payload shape every other SPV suite in the tree uses still returns 201", async () => {
    // Mirrors spvLpVisibility.test.ts's helper exactly.
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Canonical Shape", status: "open", minCheckMinor: 1000 }),
    );
    expect(r.status).toBe(201);
    expect(r.body.spv.minCheckMinor).toBe(1000);
  });

  it("a large but safe raise is accepted — the gate is MAX_SAFE_INTEGER, not a business ceiling", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Large Raise", targetRaiseMinor: Number.MAX_SAFE_INTEGER - 1, capMinor: Number.MAX_SAFE_INTEGER }),
    );
    expect(r.status).toBe(201);
  });

  it("the figures that reach the row are the figures that were sent — nothing is normalised", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 No Normalisation", targetRaiseMinor: 9480000000, minCheckMinor: 3000, capMinor: 9480000001 }),
    );
    expect(r.status).toBe(201);
    expect(r.body.spv.targetRaiseMinor).toBe(9480000000);
    expect(r.body.spv.minCheckMinor).toBe(3000);
    expect(r.body.spv.capMinor).toBe(9480000001);
  });

  /**
   * MY ASSUMPTION HERE WAS WRONG AND THE CODE IS RIGHT. I first asserted that a
   * payload with BOTH a bad jurisdiction and bad money would still answer
   * INVALID_JURISDICTION. It answers CAP_BELOW_TARGET.
   *
   * That is correct and not a regression. The money check lives in the route's
   * PRE-FLIGHT, above `recordSignoff` (§4), because it must; the jurisdiction check
   * lives inside `createSpv`, BELOW the first write. So any pre-flight refusal
   * necessarily precedes it — exactly as the pre-existing fee-draft and
   * mandate-draft pre-flight validations already do. The alternative would be to
   * move the money check below the first write and orphan a sign-off record on
   * every money refusal, which is strictly worse.
   *
   * Both answers are 400 on the same request, so nothing is newly restricted. I
   * pin the ACTUAL order rather than the order I assumed, and I pin that each
   * error is still reachable on its own.
   */
  it("a doubly-invalid payload answers the PRE-FLIGHT error — pinned as observed, not as assumed", async () => {
    const both = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Order", jurisdiction: "atlantis", targetRaiseMinor: 100, capMinor: 1 }),
    );
    expect(both.status).toBe(400);
    expect(both.body.error).toBe("CAP_BELOW_TARGET");

    // Each refusal is still reachable on its own — the money check did not mask
    // the jurisdiction check for payloads whose money is fine.
    const jur = await post(
      "/api/partner/me/spv",
      createBody({ name: "W237 Order Jur", jurisdiction: "atlantis", targetRaiseMinor: 100, capMinor: 500 }),
    );
    expect(jur.status).toBe(400);
    expect(jur.body.error).toBe("INVALID_JURISDICTION");

    // And a missing name, validated in the same place as the jurisdiction, is
    // likewise still reachable.
    const nameless = await post("/api/partner/me/spv", createBody({ name: "  ", capMinor: 500 }));
    expect(nameless.status).toBe(400);
    expect(nameless.body.error).toBe("SPV_NAME_REQUIRED");
  });

  it("the pre-flight ordering matches the pre-existing pre-flight checks, not a new pattern", () => {
    const code = stripComments(ROUTES_SRC);
    const feeCheck = code.indexOf("validateLaunchFeeDrafts(");
    const mandateCheck = code.indexOf("validateMandateDraft(");
    const moneyCheck = code.indexOf("validateCreateMoney(");
    const firstWrite = code.indexOf("recordSignoff(", feeCheck);
    // All three sit above the first write, in that order.
    expect(feeCheck).toBeGreaterThan(0);
    expect(mandateCheck).toBeGreaterThan(feeCheck);
    expect(moneyCheck).toBeGreaterThan(mandateCheck);
    expect(firstWrite).toBeGreaterThan(moneyCheck);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §6 — NO COERCION IN THE MONEY PATH
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §6 — the money path never coerces", () => {
  it("no Number( / parseInt / parseFloat inside the checker", () => {
    const body = functionBody(STORE_CODE, "assertValidSpvMoney");
    expect(body.length).toBeGreaterThan(200);
    expect(body.includes("parseInt")).toBe(false);
    expect(body.includes("parseFloat")).toBe(false);
    // `Number.isInteger` etc. are namespace reads, not conversions. The
    // conversion call is `Number(` — a bare open-paren after `Number`.
    expect(/\bNumber\s*\(/.test(body)).toBe(false);
    // positive control: the namespace predicates ARE there
    expect(body).toContain("Number.isSafeInteger");
  });

  it("no currency symbol, ISO code or magnitude literal in the checker", () => {
    const body = functionBody(STORE_CODE, "assertValidSpvMoney");
    for (const t of ["$", "€", "£", "¥", "USD", "EUR", "GBP", "toFixed", "* 100", "/ 100"]) {
      expect(body.includes(t), t).toBe(false);
    }
  });

  it("the only numeric literals in the checker are 0 — no threshold is hardcoded", () => {
    const body = functionBody(STORE_CODE, "assertValidSpvMoney");
    const lits = new Set((body.match(/(?<![\w."'])\d+(?:\.\d+)?/g) ?? []));
    // `< 0` only. MAX_SAFE_INTEGER is read from Number, never written out.
    expect([...lits].sort()).toEqual(["0"]);
    expect(body).not.toContain("9007199254740991");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §7 — READ-ONLY REPORT ON EXISTING ROWS
   The brief: "If an existing row fails, report it; never reject or alter it."
   ════════════════════════════════════════════════════════════════════════════ */
describe("W237 §7 — report, never reject", () => {
  it("reports every existing spv row that would fail the new rule, and alters none", () => {
    const rows = rawDb()
      .prepare("SELECT id, name, target_raise_minor t, min_check_minor m, cap_minor c FROM spv")
      .all() as { id: string; name: string; t: number | null; m: number | null; c: number | null }[];

    const failures: { id: string; name: string; reasons: string[] }[] = [];
    for (const r of rows) {
      const reasons: string[] = [];
      for (const [label, v] of [["targetRaiseMinor", r.t], ["minCheckMinor", r.m], ["capMinor", r.c]] as const) {
        if (v === null || v === undefined) continue;
        if (typeof v !== "number" || !Number.isFinite(v)) reasons.push(`${label} is not a finite number`);
        else if (!Number.isInteger(v)) reasons.push(`${label} is fractional (${v})`);
        else if (v < 0) reasons.push(`${label} is negative (${v})`);
        else if (!Number.isSafeInteger(v)) reasons.push(`${label} exceeds MAX_SAFE_INTEGER (${v})`);
      }
      if (typeof r.c === "number" && typeof r.t === "number" && r.c < r.t) {
        reasons.push(`capMinor ${r.c} is below targetRaiseMinor ${r.t}`);
      }
      if (reasons.length) failures.push({ id: r.id, name: r.name, reasons });
    }

    // Printed so the report reaches the build log rather than only an assertion.
    // eslint-disable-next-line no-console
    console.log(`[W237 EXISTING-ROW REPORT] ${rows.length} vehicle(s) examined; ${failures.length} would fail the new rule:\n${JSON.stringify(failures, null, 2)}`);

    // NO ASSERTION THAT `failures` IS EMPTY. A failing existing row is a
    // reporting outcome, not a test failure — asserting emptiness here would
    // turn a legacy row into a broken build and create pressure to "fix" data.
    expect(Array.isArray(failures)).toBe(true);

    // What IS asserted: the report READ ONLY. Row count and every figure are
    // unchanged after the scan.
    const again = rawDb()
      .prepare("SELECT id, target_raise_minor t, min_check_minor m, cap_minor c FROM spv")
      .all() as { id: string; t: number | null; m: number | null; c: number | null }[];
    expect(again.length).toBe(rows.length);
    expect(JSON.stringify(again)).toBe(
      JSON.stringify(rows.map((r) => ({ id: r.id, t: r.t, m: r.m, c: r.c }))),
    );
  });
});
