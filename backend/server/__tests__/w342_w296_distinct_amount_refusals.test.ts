/**
 * WAVE 342 · ITEM 2 · W296 — TWELVE AMOUNT REFUSALS THAT ALL SAID THE SAME THING.
 *
 * THE DEFECT, as measured (not as reported): the brief said nine failures share
 * one error message. I counted the producers myself, mechanically, from the three
 * server files that raise the code — the census is §0 below and the answer is
 * TWELVE, not nine. The stale "nine" is recorded in
 * `server/__tests__/w237_create_spv_money_validation.test.ts`'s own comment
 * ("it has nine throwers across the server"), written before two route sites and
 * one store site were added.
 *
 * Of the twelve, SIX had no sentence at all: they threw the bare string
 * `INVALID_AMOUNT`, which the route mapper's copy lookup could not match, so the
 * refusal fell to the generic tail and reached the general partner as an incident
 * reference with no words. The remaining six DID have their own sentences, and
 * the SPV screen threw them away: `spvErrorMessage()` preferred its own local
 * translation of the code — "Amount must be greater than zero." — for all of
 * them.
 *
 * WHAT THIS SUITE PROVES, and in what medium:
 *   §0  THE CENSUS, counted from source: 12 producer sites, 0 bare throws left.
 *   §1  The copy: one entry per reason, all distinct, short enough for the
 *       client's 240-character gate, and NOTHING INTERNAL in any of them.
 *   §2  RENDERED OVER REAL HTTP, production registrars: twelve field/reason
 *       combinations return TWELVE DISTINCT SENTENCES, each naming its own field,
 *       with the code `INVALID_AMOUNT` and status 400 unchanged.
 *   §3  A NEGATIVE CONTROL that must fail if the mechanism is inert: a code with
 *       no amount copy is untouched, and an unknown reason invents nothing.
 *   §4  STORED ROWS: a refused create writes NO vehicle row (with a `rows > 0`
 *       precondition on the table itself, so an empty database cannot pass this).
 *
 * REAL ROUTES. `registerSpvEngineRoutes` is the function `server/index.ts` calls.
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
  SPV_AMOUNT_REFUSAL_REASONS,
  SPV_AMOUNT_FIELD_LABEL,
  SPV_AMOUNT_REFUSAL_HEADLINE_MAX_CHARS,
  spvAmountRefusalHeadline,
  spvAmountRefusalGuidance,
  spvAmountRefusalHeadlinesAreShortEnough,
  parseSpvAmountRefusalMessage,
} from "@shared/spvAmountRefusalCopy";

const MANAGING = "u_avi_managing";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}

/** A create payload that is valid apart from whatever the caller breaks. */
function createBody(extra: Record<string, unknown> = {}) {
  return {
    name: "W342 Vehicle",
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    currency: "USD",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    ...extra,
  };
}

const SRC = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
/** Comments removed, string literals kept — the codes ARE literals. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

/* ════════════════════════════════════════════════════════════════════════════
   §0 — THE CENSUS. COUNTED HERE, ASSERTED `=== n`. The brief's number was 9.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W342 §0 — the census of amount-refusal producers", () => {
  const FILES = [
    "server/spvTemplateStore.ts",
    "server/spvEngineStore.ts",
    "server/spvEngineRoutes.ts",
  ];

  it("the stripper works — comments out, literals in (negative control included)", () => {
    const code = stripComments(SRC("server/spvEngineStore.ts"));
    expect(code.includes("assertValidSpvMoney")).toBe(true);
    expect(code.includes("thisIdentifierDoesNotExistAnywhere")).toBe(false);
    expect(code.includes('"not_a_number"')).toBe(true);
  });

  it("TWELVE sites produce the amount refusal — not nine (=== 12)", () => {
    /* A producer site RAISES the refusal: a `throw` carrying the code literal or
       the shared builder, or a route body literal setting `error:
       "INVALID_AMOUNT"`. Matched over the WHOLE stripped source, not line by
       line, because `spvTemplateStore.ts`'s fractional refusal spans two lines —
       a line-based count reported ELEVEN and that undercount is exactly the kind
       of stale census this item exists to correct. The route mapper's `map`
       entry and this wave's single re-emit branch are excluded: the re-emit uses
       the constant `SPV_AMOUNT_REFUSAL_CODE`, never the literal. */
    const perFile: Record<string, number> = {};
    for (const f of FILES) {
      const code = stripComments(SRC(f));
      const thrown = code.match(/throw new [A-Za-z]+\(\s*"INVALID_AMOUNT"/g) ?? [];
      const built = code.match(/throw new Error\(spvAmountRefusalThrowMessage\(/g) ?? [];
      const bodies = code.match(/error: "INVALID_AMOUNT"/g) ?? [];
      perFile[f] = thrown.length + built.length + bodies.length;
    }
    const total = Object.values(perFile).reduce((a, b) => a + b, 0);
    expect(perFile, JSON.stringify(perFile)).toEqual({
      "server/spvTemplateStore.ts": 4,
      "server/spvEngineStore.ts": 6,
      "server/spvEngineRoutes.ts": 2,
    });
    expect(total).toBe(12);
    // The technique must be able to miss: a code that is nowhere counts zero.
    const control = (stripComments(SRC("server/spvEngineStore.ts")).match(/"NO_SUCH_CODE_ANYWHERE"/g) ?? []).length;
    expect(control).toBe(0);
  });

  it("ZERO bare throws remain in the engine store (=== 0)", () => {
    const code = stripComments(SRC("server/spvEngineStore.ts"));
    const bare = code.split("\n").filter((l) => l.includes('throw new Error("INVALID_AMOUNT")'));
    expect(bare.length).toBe(0);
  });

  it("the four template sites already carried their own sentence — unchanged", () => {
    const code = stripComments(SRC("server/spvTemplateStore.ts"));
    // Each throw pairs the code with a distinct message argument.
    for (const frag of ["must be a number.", "cannot be negative.", "is out of range."]) {
      expect(code.includes(frag)).toBe(true);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §1 — THE WORDS. Distinct, actionable, short enough, nothing internal.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W342 §1 — the copy", () => {
  it("six reasons, and every reason has both a headline and guidance", () => {
    expect(SPV_AMOUNT_REFUSAL_REASONS.length).toBe(6);
    for (const r of SPV_AMOUNT_REFUSAL_REASONS) {
      expect(typeof spvAmountRefusalHeadline(r, "target_raise")).toBe("string");
      expect(typeof spvAmountRefusalGuidance(r, "target_raise")).toBe("string");
    }
  });

  it("every reason/field pair is a DISTINCT sentence (30 pairs, 30 sentences)", () => {
    const fields = Object.keys(SPV_AMOUNT_FIELD_LABEL);
    const seen = new Set<string>();
    let pairs = 0;
    for (const r of SPV_AMOUNT_REFUSAL_REASONS) {
      for (const f of fields) {
        pairs += 1;
        seen.add(String(spvAmountRefusalHeadline(r, f)));
      }
    }
    expect(pairs).toBe(30);
    expect(seen.size).toBe(30);
  });

  it("every headline fits under the client's 240-character gate", () => {
    expect(spvAmountRefusalHeadlinesAreShortEnough()).toBe(true);
    expect(SPV_AMOUNT_REFUSAL_HEADLINE_MAX_CHARS).toBeLessThan(240);
  });

  it("NOTHING INTERNAL — no code, table, column, id, path or currency name", () => {
    const fields = Object.keys(SPV_AMOUNT_FIELD_LABEL);
    for (const r of SPV_AMOUNT_REFUSAL_REASONS) {
      for (const f of fields) {
        const text = `${spvAmountRefusalHeadline(r, f)} ${spvAmountRefusalGuidance(r, f)}`;
        expect(text).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/); // ALL_CAPS_UNDERSCORE code
        expect(text).not.toMatch(/spv_|audit_log|target_id|minor_units/);
        expect(text).not.toMatch(/\.ts|\.tsx|SELECT |sqlite/i);
        expect(text).not.toMatch(/\b(USD|EUR|GBP|CAD|JPY)\b/); // never names a currency
        expect(text).not.toMatch(/\bcents?\b/i); // nor a 2-decimal assumption
        expect(text.length).toBeGreaterThan(30); // it says something
      }
    }
  });

  it("EVERY sentence tells the person what to do", () => {
    for (const r of SPV_AMOUNT_REFUSAL_REASONS) {
      const h = String(spvAmountRefusalHeadline(r, "target_raise"));
      expect(h).toMatch(/try again|Enter |Retype|Round it|leave it blank|greater than zero/i);
    }
  });

  it("an unknown reason gets NO invented sentence", () => {
    expect(spvAmountRefusalHeadline("no_such_reason", "cap")).toBeNull();
    expect(spvAmountRefusalGuidance(undefined, "cap")).toBeNull();
    expect(parseSpvAmountRefusalMessage("INVALID_AMOUNT")).toBeNull();
    expect(parseSpvAmountRefusalMessage("SPV_NOT_FOUND")).toBeNull();
    expect(parseSpvAmountRefusalMessage("INVALID_AMOUNT:no_such_reason:cap")).toBeNull();
  });

  it("an unknown FIELD falls back to a neutral label, never to the machine key", () => {
    const h = String(spvAmountRefusalHeadline("negative", "some_new_field"));
    expect(h).toContain("That amount");
    expect(h).not.toContain("some_new_field");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §2 — RENDERED OVER REAL HTTP. Twelve combinations, twelve sentences.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W342 §2 — what the general partner actually receives", () => {
  const CASES: Array<{ field: string; key: string; value: unknown; reason: string; says: string }> = [
    { field: "targetRaiseMinor", key: "target_raise", value: -1, reason: "negative", says: "cannot be negative" },
    { field: "targetRaiseMinor", key: "target_raise", value: 1.5, reason: "fractional", says: "whole amount" },
    { field: "targetRaiseMinor", key: "target_raise", value: "100", reason: "not_a_number", says: "not a number" },
    { field: "targetRaiseMinor", key: "target_raise", value: 2 ** 53, reason: "too_large", says: "too large" },
    { field: "minCheckMinor", key: "minimum_check", value: -1, reason: "negative", says: "cannot be negative" },
    { field: "minCheckMinor", key: "minimum_check", value: 1.5, reason: "fractional", says: "whole amount" },
    { field: "minCheckMinor", key: "minimum_check", value: "100", reason: "not_a_number", says: "not a number" },
    { field: "minCheckMinor", key: "minimum_check", value: 2 ** 53, reason: "too_large", says: "too large" },
    { field: "capMinor", key: "cap", value: -1, reason: "negative", says: "cannot be negative" },
    { field: "capMinor", key: "cap", value: 1.5, reason: "fractional", says: "whole amount" },
    { field: "capMinor", key: "cap", value: "100", reason: "not_a_number", says: "not a number" },
    { field: "capMinor", key: "cap", value: 2 ** 53, reason: "too_large", says: "too large" },
  ];

  it("all twelve refuse with 400 and the UNCHANGED code, and say twelve different things", async () => {
    const sentences = new Set<string>();
    for (const c of CASES) {
      const r = await post(
        "/api/partner/me/spv",
        createBody({ name: `W342 ${c.key} ${c.reason}`, [c.field]: c.value }),
      );
      const where = `${c.field}=${String(c.value)}`;
      expect(r.status, where).toBe(400);
      expect(r.body.error, where).toBe("INVALID_AMOUNT"); // NOTHING keying on the code changes
      expect(r.body.amountError, where).toEqual({ reason: c.reason, field: c.key });
      expect(r.body.fieldError, where).toBe(c.key);
      expect(typeof r.body.message, where).toBe("string");
      expect(r.body.message, where).toContain(c.says);
      // It names ITS OWN field, in words a person reads.
      const label = SPV_AMOUNT_FIELD_LABEL[c.key as keyof typeof SPV_AMOUNT_FIELD_LABEL];
      expect(r.body.message, where).toContain(label.replace(/^The /, "").toLowerCase());
      expect(typeof r.body.guidance, where).toBe("string");
      // NOTHING INTERNAL crosses the wire in what a person reads.
      const read = `${r.body.message} ${r.body.guidance}`;
      expect(read, where).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/);
      expect(read, where).not.toMatch(/\.ts|spv_|Error:|at .*:\d+/);
      // No incident reference: it no longer falls through the generic tail.
      expect(r.body.incidentCode, where).toBeUndefined();
      sentences.add(String(r.body.message));
    }
    expect(sentences.size).toBe(12);
    // And NOT ONE of them is the old single sentence.
    for (const s of sentences) expect(s).not.toBe("Amount must be greater than zero.");
  });

  it("the OLD single sentence is no longer what any of these refusals says", async () => {
    const r = await post("/api/partner/me/spv", createBody({ name: "W342 Old Sentence", capMinor: 1.5 }));
    expect(r.body.message).not.toBe("Amount must be greater than zero.");
    expect(r.body.message).toContain("cap");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §2b — THE OTHER TWO STORE SITES, over the same real routes.
   The deployment and transfer refusals are not reachable through the create
   payload, so they are exercised where they live. Both used to arrive with NO
   WORDS AT ALL (bare `throw new Error("INVALID_AMOUNT")`).
   ════════════════════════════════════════════════════════════════════════════ */
describe("W342 §2b — the deployment and transfer amount refusals", () => {
  let spvId = "";

  it("a vehicle exists to refuse against (positive control)", async () => {
    const r = await post("/api/partner/me/spv", createBody({ name: "W342 Sink Vehicle" }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    spvId = String(r.body.spv.id);
    expect(spvId.length).toBeGreaterThan(0);
  });

  it("a zero deployment says so, names the deployment amount, and says nothing was recorded", async () => {
    const r = await post(`/api/partner/me/spv/${spvId}/deployments`, {
      companyId: "c1",
      companyRoundId: "r1",
      amountMinor: 0,
      currency: "USD",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_AMOUNT");
    expect(r.body.amountError).toEqual({ reason: "not_positive", field: "deployment_amount" });
    expect(r.body.message).toBe(
      "The deployment amount must be greater than zero. Nothing has been recorded.",
    );
    expect(r.body.message).not.toBe("Amount must be greater than zero.");
    expect(`${r.body.message} ${r.body.guidance}`).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/);
  });

  it("a fractional transfer says NOTHING HAS BEEN TRANSFERRED — the fact a GP most needs", async () => {
    const r = await post(`/api/partner/me/spv/${spvId}/transfers`, {
      fromInvestorId: "i1",
      toInvestorId: "i2",
      amountMinor: 1.5,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("INVALID_AMOUNT");
    expect(r.body.amountError).toEqual({
      reason: "transfer_not_whole_or_negative",
      field: "transfer_amount",
    });
    expect(r.body.message).toContain("nothing has been transferred");
    expect(r.body.message).not.toBe("Amount must be greater than zero.");
    expect(`${r.body.message} ${r.body.guidance}`).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §3 — NEGATIVE CONTROLS. The mechanism must be capable of NOT firing.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W342 §3 — controls", () => {
  it("a DIFFERENT refusal is untouched — no amountError, no amount sentence", async () => {
    const r = await post("/api/partner/me/spv", createBody({ name: "", jurisdiction: "delaware" }));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.amountError).toBeUndefined();
    expect(String(r.body.message ?? "")).not.toContain("whole amount");
  });

  it("a VALID create still succeeds — nothing coherent became uncreatable", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W342 Valid Vehicle", targetRaiseMinor: 500000, minCheckMinor: 1000, capMinor: 500000 }),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.spv.targetRaiseMinor).toBe(500000);
    expect(r.body.amountError).toBeUndefined();
  });

  it("zero is still a valid amount, and a blank field is still blank", async () => {
    const r = await post(
      "/api/partner/me/spv",
      createBody({ name: "W342 Zero Vehicle", targetRaiseMinor: 0, minCheckMinor: null }),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.spv.targetRaiseMinor).toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   §4 — STORED ROWS. A refusal writes nothing. `rows > 0` precondition first.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W342 §4 — the database, not the response", () => {
  it("the refused vehicle name exists on NO row — proved against a NON-EMPTY table", async () => {
    const db = rawDb();
    const name = `W342 Not Written ${Date.now()}`;
    const r = await post("/api/partner/me/spv", createBody({ name, capMinor: -5 }));
    expect(r.status).toBe(400);
    expect(r.body.amountError).toEqual({ reason: "negative", field: "cap" });

    /* PRECONDITION — an empty table would let the assertion below pass for the
       wrong reason. The suite has created vehicles above, so this must be > 0. */
    const total = db.prepare("SELECT COUNT(*) AS n FROM spvs").get() as { n: number };
    expect(total.n).toBeGreaterThan(0);

    const hit = db.prepare("SELECT COUNT(*) AS n FROM spvs WHERE name = ?").get(name) as { n: number };
    expect(hit.n).toBe(0);

    // And the positive control: a vehicle this suite DID create is on a row.
    const ok = db
      .prepare("SELECT COUNT(*) AS n FROM spvs WHERE name = ?")
      .get("W342 Valid Vehicle") as { n: number };
    expect(ok.n).toBeGreaterThan(0);
  });
});
