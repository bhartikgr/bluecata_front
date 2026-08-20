/**
 * WAVE 76 — THE TWO CLOSED-VOCABULARY MONEY TERMS, ACROSS ALL THREE WRITERS.
 *
 * WHAT THIS WAVE'S BRIEF SAID, AND WHAT MEASUREMENT FOUND. The brief stated that
 * `antiDilutionType` and `safeType` were money terms *"a founder cannot correct
 * after creation"*. That framing is FALSE, and this file is the executed proof:
 * `PATCH /api/founder/rounds/:id` has always persisted both keys, and
 * `POST /api/rounds` sweeps every unknown body key into `extras_json`. The real
 * defect was three writers behaving three different ways for one field —
 *
 *   PATCH /api/rounds/:id/terms   a VALID token    -> HTTP 200, silently DROPPED
 *   PATCH /api/founder/rounds/:id ANY value at all -> HTTP 200, persisted UNVALIDATED
 *   POST  /api/rounds             ANY value at all -> HTTP 200, persisted UNVALIDATED
 *
 * — so a founder could store `"FULL_RATCHET"` or `"post money"` on a 200 and the
 * cap-table path would then throw `invalid_anti_dilution_type` and stop producing a
 * share count, with no screen able to undo it. Both halves are closed here.
 *
 * FULL PROBE TRANSCRIPT: build_log/wave76/W76_PROBE_TRANSCRIPT.txt
 * MUTATION TRANSCRIPTS:  build_log/wave76/W76_TESTS.md
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { roundStoredTerms } from "../lib/roundStoredTerms";

const ROOT = path.resolve(__dirname, "../..");
const ADMIN = "u_admin";
const STAMP = `w76t${Date.now().toString(36)}`;

let app: Express;

/** A priced preferred round (anti-dilution's subject) or a SAFE, as asked. */
async function buildRound(
  key: string,
  instrument: "preferred" | "safe_post",
  extra: Record<string, unknown> = {},
): Promise<{ companyId: string; roundId: string; status: number; body: any }> {
  const companyId = `co_${STAMP}_${key}`;
  await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W76 ${key}` });
  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId, name: `${STAMP} ${key}`, type: "seed", instrument,
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    ...(instrument === "preferred"
      ? { pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000 }
      : { valuationCap: 12_000_000 }),
    ...extra,
  });
  return { companyId, roundId: String((created.body as any)?.id ?? ""), status: created.status, body: created.body };
}

const patchTerms = (roundId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN).send(body);

const patchFounder = (roundId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN).send(body);

const getRound = (roundId: string) =>
  request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);

describe("W76 · the two closed-vocabulary terms are now correctable AND validated", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THE POINT — A FOUNDER CAN NOW CORRECT THE METHOD AND READ IT BACK.
     A 200 is not evidence; the read-back is. Both the single stored-terms reader
     the cap-table path uses AND a fresh GET of the round are checked, because the
     defect Wave 75 found was a route that mutated a throwaway in-memory copy.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W76-AD-A — antiDilutionType round-trips through the edit-terms route", async () => {
    const { roundId } = await buildRound("ad_a", "preferred");
    /* Absent at birth: nothing was invented for it. */
    expect(roundStoredTerms(roundId).antiDilutionType).toBeNull();

    const saved = await patchTerms(roundId, { antiDilutionType: "full_ratchet" });
    expect(saved.status).toBe(200);
    expect(saved.body.ok).toBe(true);

    /* PERSISTED — read through the one reader the projection itself uses. */
    expect(roundStoredTerms(roundId).antiDilutionType).toBe("full_ratchet");
    /* And on the round a founder reloads. */
    const reread = await getRound(roundId);
    expect(reread.status).toBe(200);
    expect((reread.body as any).antiDilutionType).toBe("full_ratchet");

    /* CORRECTABLE AGAIN — a founder who picked the wrong method can change it. */
    const corrected = await patchTerms(roundId, { antiDilutionType: "broad_based" });
    expect(corrected.status).toBe(200);
    expect(roundStoredTerms(roundId).antiDilutionType).toBe("broad_based");
  }, 60_000);

  it("W76-ST-A — safeType round-trips through the edit-terms route", async () => {
    const { roundId } = await buildRound("st_a", "safe_post");
    expect(roundStoredTerms(roundId).safeCapType).toBeNull();

    const saved = await patchTerms(roundId, { safeType: "pre_money_cap" });
    expect(saved.status).toBe(200);
    expect(saved.body.ok).toBe(true);
    expect(roundStoredTerms(roundId).safeCapType).toBe("pre_money_cap");
    expect((await getRound(roundId)).body.safeType).toBe("pre_money_cap");

    const corrected = await patchTerms(roundId, { safeType: "post_money_cap" });
    expect(corrected.status).toBe(200);
    expect(roundStoredTerms(roundId).safeCapType).toBe("post_money_cap");
  }, 60_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THE THREE STATES, the contract Wave 75 established and this wave copies
     rather than reinventing. `"none"` is a VALUE, not a removal.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W76-3S-A — absent leaves untouched; null removes; \"none\" is a stored value", async () => {
    const { roundId } = await buildRound("3s_a", "preferred");
    await patchTerms(roundId, { antiDilutionType: "narrow_based" });
    expect(roundStoredTerms(roundId).antiDilutionType).toBe("narrow_based");

    /* ABSENT — a patch that does not carry the key must not reset it. */
    const other = await patchTerms(roundId, { termsSummary: "unrelated edit" });
    expect(other.status).toBe(200);
    expect(roundStoredTerms(roundId).antiDilutionType).toBe("narrow_based");

    /* "none" is a TERM ON RECORD — the class negotiated no protection. Stored. */
    await patchTerms(roundId, { antiDilutionType: "none" });
    expect(roundStoredTerms(roundId).antiDilutionType).toBe("none");

    /* EXPLICIT REMOVAL — back to genuinely unknown, which is a different fact. */
    const removed = await patchTerms(roundId, { antiDilutionType: null });
    expect(removed.status).toBe(200);
    expect(roundStoredTerms(roundId).antiDilutionType).toBeNull();
    /* AND IT IS STORED AS NULL, NOT AS AN EMPTY STRING. This assertion exists
       because mutation M7 (build_log/wave76/W76_TESTS.md) removed the explicit-
       removal branch entirely and every reader-level assertion above still passed:
       the fall-through wrote `""`, and `roundStoredTerms`'s `str()` maps `""` to
       null, so the defect was invisible through the reader. An empty string in a
       closed-vocabulary column is not a removal, it is a value outside the
       vocabulary — exactly what this wave refuses on the way in. */
    {
      const raw = (await getRound(roundId)).body.antiDilutionType;
      expect(raw === null || raw === undefined, `stored as ${JSON.stringify(raw)}, expected null/absent`).toBe(true);
    }

    /* "" is the same explicit removal (what a blank form control sends). */
    await patchTerms(roundId, { antiDilutionType: "broad_based" });
    expect(roundStoredTerms(roundId).antiDilutionType).toBe("broad_based");
    await patchTerms(roundId, { antiDilutionType: "" });
    expect(roundStoredTerms(roundId).antiDilutionType).toBeNull();
    {
      const raw = (await getRound(roundId)).body.antiDilutionType;
      expect(raw === null || raw === undefined, `stored as ${JSON.stringify(raw)}, expected null/absent`).toBe(true);
    }
  }, 60_000);

  it("W76-3S-B — the same three states for safeType", async () => {
    const { roundId } = await buildRound("3s_b", "safe_post");
    await patchTerms(roundId, { safeType: "pre_money_cap" });
    await patchTerms(roundId, { mfn: true });
    expect(roundStoredTerms(roundId).safeCapType).toBe("pre_money_cap"); // absent = untouched
    await patchTerms(roundId, { safeType: null });
    expect(roundStoredTerms(roundId).safeCapType).toBeNull();
  }, 60_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THE NAMED 400s. Every one of these was HTTP 200 + PERSISTED on at least one
     writer before this wave (probe transcript B and D).
     ═══════════════════════════════════════════════════════════════════════════ */
  const BAD: Array<[string, unknown, string]> = [
    ["antiDilutionType", "FULL_RATCHET", "invalid_antiDilutionType"],
    ["antiDilutionType", "ratchet-ish", "invalid_antiDilutionType"],
    ["antiDilutionType", "full ratchet", "invalid_antiDilutionType"],
    ["antiDilutionType", 7, "invalid_antiDilutionType"],
    ["safeType", "post money", "invalid_safeType"],
    ["safeType", "postMoneyCap", "invalid_safeType"],
    ["safeType", true, "invalid_safeType"],
  ];

  it("W76-400-TERMS — the edit-terms route refuses every near-miss BY NAME and stores nothing", async () => {
    for (const [field, value, code] of BAD) {
      const { roundId } = await buildRound(`b1_${String(value).replace(/\W/g, "")}_${field}`.toLowerCase().slice(0, 40),
        field === "safeType" ? "safe_post" : "preferred");
      const res = await patchTerms(roundId, { [field]: value });
      expect(res.status, `${field}=${String(value)} must be refused`).toBe(400);
      expect(res.body.error).toBe(code);
      expect(res.body.field).toBe(field);
      /* NOTHING STORED. A refusal that half-writes is worse than no refusal. */
      const stored = (await getRound(roundId)).body[field];
      expect(stored == null, `${field}=${String(value)} must not be stored`).toBe(true);
    }
  }, 180_000);

  it("W76-400-FOUNDER — the LOOSEST writer refuses them too (it used to persist all seven)", async () => {
    for (const [field, value, code] of BAD) {
      const { roundId } = await buildRound(`b2_${String(value).replace(/\W/g, "")}_${field}`.toLowerCase().slice(0, 40),
        field === "safeType" ? "safe_post" : "preferred");
      const res = await patchFounder(roundId, { [field]: value });
      expect(res.status, `founder ${field}=${String(value)} must be refused`).toBe(400);
      expect(res.body.error).toBe(code);
      const stored = (await getRound(roundId)).body[field];
      expect(stored == null, `founder ${field}=${String(value)} must not be stored`).toBe(true);
    }
  }, 180_000);

  it("W76-400-CREATE — a round can no longer be BORN with a token the engine refuses", async () => {
    for (const [field, value, code] of BAD) {
      const created = await buildRound(`b3_${String(value).replace(/\W/g, "")}_${field}`.toLowerCase().slice(0, 40),
        field === "safeType" ? "safe_post" : "preferred", { [field]: value });
      expect(created.status, `create ${field}=${String(value)} must be refused`).toBe(400);
      expect(created.body.error).toBe(code);
    }
  }, 180_000);

  it("W76-400-OK — a VALID token still creates and still patches on all three writers", async () => {
    /* The refusals must not have narrowed what legitimately worked. */
    const c = await buildRound("ok_create", "preferred", { antiDilutionType: "broad_based" });
    expect(c.status).toBe(200);
    expect(roundStoredTerms(c.roundId).antiDilutionType).toBe("broad_based");

    const f = await patchFounder(c.roundId, { antiDilutionType: "narrow_based" });
    expect(f.status).toBeLessThan(400);
    expect(roundStoredTerms(c.roundId).antiDilutionType).toBe("narrow_based");

    const t = await patchTerms(c.roundId, { antiDilutionType: "full_ratchet" });
    expect(t.status).toBe(200);
    expect(roundStoredTerms(c.roundId).antiDilutionType).toBe("full_ratchet");

    const s = await buildRound("ok_safe", "safe_post", { safeType: "pre_money_cap" });
    expect(s.status).toBe(200);
    expect(roundStoredTerms(s.roundId).safeCapType).toBe("pre_money_cap");
  }, 120_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THE WRITERS AGREE, AND THE VOCABULARY EXISTS IN ONE PLACE (R21).
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W76-R21 — all three writers call the SAME imported validators; no writer restates the list", async () => {
    const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    const carry = fs.readFileSync(path.join(ROOT, "server/roundCarryForwardRoutes.ts"), "utf8");
    const shared = fs.readFileSync(path.join(ROOT, "shared/roundMathEngineAdapter.ts"), "utf8");

    /* The tokens are enumerated ONCE, in the module that also enforces them on the
       engine path. A writer with its own copy of the list is the drift that let
       `"FULL_RATCHET"` be stored while the reader rejected it. */
    for (const src of [routes, carry]) {
      expect(src).toContain("validateAntiDilutionTypeStored");
      expect(src).toContain("validateSafeCapTypeStored");
      /* No writer spells the vocabulary out for itself. */
      expect(src).not.toContain('"narrow_based"');
    }
    expect(shared).toContain("export function validateAntiDilutionTypeStored");
    expect(shared).toContain("export function validateSafeCapTypeStored");

    /* Both keys were ALREADY on the store's extras whitelist — NO MIGRATION. */
    const store = fs.readFileSync(path.join(ROOT, "server/roundsStore.ts"), "utf8");
    const block = store.slice(store.indexOf("const UPDATE_EXTRAS_WHITELIST"));
    expect(block).toContain('"antiDilutionType"');
    expect(block).toContain('"safeType"');
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     R58 — A FIELD IS NOT CORRECTABLE UNTIL A CONTROL EXISTS.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W76-R58 — the Edit-terms dialog can actually send both, from the shared vocabulary", () => {
    const src = fs.readFileSync(path.join(ROOT, "client/src/pages/founder/Rounds.tsx"), "utf8");
    /* The controls exist and are addressable. */
    expect(src).toContain('data-testid="edit-anti-dilution-type"');
    expect(src).toContain('data-testid="edit-safe-type"');
    /* Both travel on the PATCH the dialog already sends, with the three states:
       a blank selection sends null (explicit removal), never omission. */
    expect(src).toContain('antiDilutionType: antiDilutionType === "" ? null : antiDilutionType');
    expect(src).toContain('safeType: safeType === "" ? null : safeType');
    /* The options are the SERVER's constants, not a retyped list — a control that
       could offer a token the writer refuses is the drift R21 forbids. */
    expect(src).toContain("ANTI_DILUTION_TYPES_FOR_INPUT");
    expect(src).toContain("SAFE_CAP_TYPES_FOR_INPUT");
    /* "Not recorded" and "none" are distinct options, because they are distinct
       facts: one refuses a down-round projection, the other projects fine. */
    expect(src).toContain("Not recorded");
  });
});
