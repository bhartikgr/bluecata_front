/**
 * WAVE 75 — ITEM 2 (the discarded money term) and ITEM 3 (the float residue).
 *
 * ITEM 2 · W74 finding N-2. `GET /api/founder/captable/waterfall` refuses a
 * preferred round with `liquidation_term_not_on_record` and instructs the founder,
 * by name, to *"Record the liquidation preference on the round's terms."*
 * `PATCH /api/rounds/:id/terms` then returned **200 `{"ok":true}`** and saved
 * nothing. The founder followed the instruction, was told it worked, and the
 * refusal came back unchanged — a dead promise that a refusal actively drives
 * users into. The loop is closed here END TO END: refuse → record → compute.
 *
 * ITEM 3 · W74 finding N-4. The waterfall summary narrowed the engine's EXACT
 * decimal payout strings to IEEE-754 doubles at `Number(p.total)`, producing
 * `3333333333.3333335` — a third of a cent of residue on a payout figure. The
 * exact figures are now emitted, additively, and the sums are exact.
 *
 * MUTATION TRANSCRIPTS: build_log/wave75/W75_TESTS.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createRound } from "../roundsStore";
import { roundStoredTerms } from "../lib/roundStoredTerms";

const ROOT = path.resolve(__dirname, "../..");
const ADMIN = "u_admin";
const EXIT_MINOR = "5000000000"; // $50,000,000.00 — Wave 74's fixed exit value
const STAMP = `w75t${Date.now().toString(36)}`;

let app: Express;

/** Wave 74's fixture, verbatim: founder common 8,000,000 + one preferred round. */
async function buildPreferredCompany(key: string, liquidationPreference?: string): Promise<{ companyId: string; roundId: string }> {
  const companyId = `co_${STAMP}_${key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W75 ${key}` });
  expect(co.status, `company create ${key}`).toBeLessThan(400);

  const foundationId = createRound({
    companyId, name: `${STAMP} Foundation ${key}`, type: "foundation",
    instrument: "common", pricePerShare: null, actorUserId: ADMIN,
  }).id;
  const seeded = await request(app).post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId: foundationId, shares: "8000000", amount: "8000",
      currency: "USD", holderFirstName: "Founder", holderLastName: key,
    });
  expect(seeded.status, `seed ${key}`).toBe(201);

  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId, name: `${STAMP} Under Test ${key}`, type: "seed", instrument: "preferred",
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
    ...(liquidationPreference ? { liquidationPreference } : {}),
  });
  expect(created.status, `round create ${key}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
  const roundId = String((created.body as { id: string }).id);

  const backfill = await request(app).post("/api/founder/captable/backfill-investor")
    .set("x-user-id", ADMIN)
    .send({
      companyId, roundId, shares: String(Math.floor(10_000_000 / 2.5)),
      amount: "10000000", currency: "USD",
      holderFirstName: "Invest", holderLastName: key,
      investorEmail: `${STAMP}_${key}@example.invalid`,
    });
  expect(backfill.status, `backfill ${key}`).toBe(201);
  return { companyId, roundId };
}

const patchTerms = (roundId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN).send(body);

const waterfall = (companyId: string) =>
  request(app).get("/api/founder/captable/waterfall")
    .query({ companyId, exitValuationMinor: EXIT_MINOR })
    .set("x-user-id", ADMIN);

describe("W75 · ITEM 2 — the terms endpoint no longer discards a money term", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THE WHOLE POINT — THE LOOP THE REFUSAL SENDS THE FOUNDER ROUND.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-N2-A — refuse → record through PATCH → compute. The instruction now works.", async () => {
    const { companyId, roundId } = await buildPreferredCompany("loop");

    /* STEP 1 — the refusal, and its instruction. Unchanged by this wave. */
    const refused = await waterfall(companyId);
    expect(refused.status).toBe(422);
    expect(refused.body.refusal).toBe("liquidation_term_not_on_record");
    expect(String(refused.body.message)).toContain("Record the liquidation preference on the round's terms");

    /* STEP 2 — the founder does exactly what they were told, on the only
       post-creation terms surface. This is the request that used to return 200 and
       save nothing. */
    const saved = await patchTerms(roundId, { liquidationPreference: "1x non-participating" });
    expect(saved.status).toBe(200);
    expect(saved.body.ok).toBe(true);
    /* PERSISTED — read back through the single stored-terms reader the waterfall
       itself uses, not through the response echo. A 200 is not evidence. */
    const terms = roundStoredTerms(roundId);
    expect(terms.liquidationPreferenceRaw).toBe("1x non-participating");
    expect(terms.liquidationPreferenceMultiple).toBe(1);
    expect(terms.participatingPreferred).toBe(false);
    /* And it survives a fresh GET of the round, i.e. it is on the round a founder
       reloads, not only in a store the route happened to touch. */
    const reread = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
    expect(reread.status).toBe(200);
    expect(String((reread.body as Record<string, unknown>).liquidationPreference)).toBe("1x non-participating");

    /* STEP 3 — the refusal is gone and a figure is produced. */
    const computed = await waterfall(companyId);
    expect(computed.status, JSON.stringify(computed.body).slice(0, 400)).toBe(200);
    expect(computed.body.refusal).toBeUndefined();
    /* WAVE 77 · R72 — was `Math.round(Number(...))`. The figure is now exact
       decimal text, pinned from an executed run, and no `Number(...)` is applied
       to a money string on this path any more (R72 condition 4). */
/* ── UPDATED BY WAVE 81 · ITEM 1 (D3): 40 SIGNIFICANT DIGITS -> 38 ─────────────
       THIS ASSERTION PINNED AN UNDECLARED CONFIGURATION. The engine declares
       `precision: 38, rounding: ROUND_HALF_EVEN`, but until Wave 81 it set that on
       the SHARED decimal.js constructor, and `packages/math-fns/src/index.ts` set
       the SAME constructor to `precision: 40, rounding: ROUND_HALF_UP`. Six server
       modules import `@capavate/math-fns`, so in the server process — and in this
       test — math-fns loaded LAST and the engine actually ran at 40 / HALF_UP. The
       figure below therefore had 40 significant digits because of an import order,
       not because of anything the engine promised.

       WAVE 81 gives the engine its OWN `Decimal.clone({ 38, ROUND_HALF_EVEN })`, so
       its arithmetic is the same in every process and matches what it declares. The
       string is two significant digits shorter and is otherwise the same number.
       NO MONEY MOVED at any granularity a person or a ledger can see: the change is
       in significant digits 39 and 40 of a minor-unit figure.

       PROVEN NOT TO MOVE A PUBLISHED FIGURE: all 14 engine-executing transcripts of
       the QA document already ran at 38 / HALF_EVEN (their harnesses do not load
       math-fns) and re-run BYTE-IDENTICAL after this wave —
       `build_log/wave81/W81_QA_TRANSCRIPT_DIFF.txt`. The document was right about
       the engine; production was not, and now is.
       ─────────────────────────────────────────────────────────────────────────── */
        expect(computed.body.founderProceeds).toBe("3333333333.3333333333333333333333333333");
  }, 60_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THREE STATES, matching `discount` and the option-pool block exactly.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-N2-B — ABSENT leaves it untouched; `\"\"` and `null` are EXPLICIT removals", async () => {
    const { roundId } = await buildPreferredCompany("states", "2x participating");
    expect(roundStoredTerms(roundId).liquidationPreferenceRaw).toBe("2x participating");

    /* ABSENT — a patch that does not mention the key must never reset it. That is
       the bug class Wave 58f removed from `discount` and it is not re-introduced. */
    const other = await patchTerms(roundId, { targetAmount: 11_000_000 });
    expect(other.status).toBe(200);
    expect(roundStoredTerms(roundId).liquidationPreferenceRaw).toBe("2x participating");

    /* EXPLICIT REMOVAL via empty string. */
    const cleared = await patchTerms(roundId, { liquidationPreference: "" });
    expect(cleared.status).toBe(200);
    expect(roundStoredTerms(roundId).liquidationPreferenceRaw).toBeNull();
    expect(roundStoredTerms(roundId).liquidationPreferenceMultiple).toBeNull();

    /* Re-record, then remove via explicit null. */
    expect((await patchTerms(roundId, { liquidationPreference: "1.5x participating" })).status).toBe(200);
    expect(roundStoredTerms(roundId).liquidationPreferenceMultiple).toBe(1.5);
    expect((await patchTerms(roundId, { liquidationPreference: null })).status).toBe(200);
    expect(roundStoredTerms(roundId).liquidationPreferenceRaw).toBeNull();
  }, 60_000);

  it("W75-N2-C — text the waterfall cannot use is SAVED and WARNED about, not silently accepted", async () => {
    const { companyId, roundId } = await buildPreferredCompany("warn");
    /* No multiple, no participation statement. Real founders type this. */
    const res = await patchTerms(roundId, { liquidationPreference: "standard preference" });
    expect(res.status).toBe(200);
    /* SAVED, exactly as typed — the platform does not re-word a founder's term. */
    expect(roundStoredTerms(roundId).liquidationPreferenceRaw).toBe("standard preference");
    /* AND WARNED. `termWarnings` is the channel Wave 69 wired to a second toast in
       `client/src/pages/founder/Rounds.tsx`, so this reaches a human (R58). */
    const warnings = (res.body as { termWarnings?: unknown[] }).termWarnings ?? [];
    expect(warnings.length).toBeGreaterThan(0);
    const joined = warnings.map(String).join(" ");
    expect(joined).toContain("standard preference");
    expect(joined).toContain("liquidation_term_not_on_record");
    /* And the warning is TRUE: the waterfall does still refuse. A warning that
       overstated the platform's ability would be the same dead promise again. */
    const still = await waterfall(companyId);
    expect(still.status).toBe(422);
    expect(still.body.refusal).toBe("liquidation_term_not_on_record");
  }, 60_000);

  it("W75-N2-D — a NUMBER is refused by name, never coerced into a term", async () => {
    const { roundId } = await buildPreferredCompany("coerce");
    const res = await patchTerms(roundId, { liquidationPreference: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_liquidationPreference");
    expect(res.body.field).toBe("liquidationPreference");
    expect(String(res.body.message)).toContain("non-participating");
    /* Nothing was written. A refusal that half-persists is worse than either. */
    expect(roundStoredTerms(roundId).liquidationPreferenceRaw).toBeNull();
  }, 60_000);

  /* ═══════════════════════════════════════════════════════════════════════════
     THE FIELD IS REACHABLE FROM A SCREEN (R58) — the string is rendered by a
     component, and the component sends it.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-N2-E — the Edit-terms dialog carries the control and puts it on the wire", () => {
    const dialog = fs.readFileSync(path.join(ROOT, "client/src/pages/founder/Rounds.tsx"), "utf8");
    expect(dialog).toContain('data-testid="edit-liquidation-preference"');
    expect(dialog).toContain("Liquidation preference");
    /* Three states on the wire, matching the server contract exactly. */
    expect(dialog).toContain('liquidationPreference: liqPref.trim() === "" ? null : liqPref.trim()');
    /* Seeded from the round, so opening the dialog does not blank an existing term. */
    expect(dialog).toContain("liquidationPreference == null");
    /* And the warning channel is still rendered (Wave 69 · V-2), because this
       wave's warning depends on it. */
    expect(dialog).toContain("data?.termWarnings");
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     EVERY OTHER FIELD THE ROUTE DROPS IS ENUMERATED, NOT DISCOVERED LATER.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("W75-N2-F — the set of persistable term extras the route still ignores is PINNED", () => {
    /* Read from the store's own whitelist and the route's own source, so the list
       cannot rot. `liquidationPreference` is deliberately NOT in the expected set
       any more — that is this item. Full narrative: W75_DROPPED_FIELDS.md. */
    const store = fs.readFileSync(path.join(ROOT, "server/roundsStore.ts"), "utf8");
    const routeSrc = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    const handlerStart = routeSrc.indexOf('app.patch("/api/rounds/:id/terms"');
    expect(handlerStart).toBeGreaterThan(-1);
    const handlerEnd = routeSrc.indexOf("const updResult = roundsStoreUpdate(", handlerStart);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = routeSrc.slice(handlerStart, handlerEnd);

    const extrasBlock = store.slice(
      store.indexOf("const UPDATE_EXTRAS_WHITELIST"),
      store.indexOf("export const UPDATE_ROUND_EXTRAS_KEYS"),
    );
    const extras = [...extrasBlock.matchAll(/^\s*"([A-Za-z][A-Za-z0-9_]*)",/gm)].map((m) => m[1]);
    expect(extras.length).toBeGreaterThan(15);
    const ignored = extras.filter((k) => !handler.includes(`body.${k}`) && !handler.includes(`"${k}"`)).sort();
    expect(ignored).toEqual([
      /* MEASURED, NOT ASSUMED. This list was written by hand as eight entries and
         the assertion returned nine: `antiDilutionType` is dropped too, and it is a
         money-moving term (R60 — the anti-dilution method the engine reads). See
         W75_DROPPED_FIELDS.md, where each of the nine is classified.

         ── UPDATED BY WAVE 76 ───────────────────────────────────────────
         THE PIN SHRANK, WHICH IS THE ONLY DIRECTION IT MAY EVER MOVE. Wave 76
         persists `antiDilutionType` (R60) and `safeType` (D5) on this route, with a
         closed vocabulary and a named 400, so both leave this list. SEVEN remain.
         Nothing was added to it and no field stopped being persisted; if this list
         ever GROWS, a route has started dropping a term again and that is a defect.
         Wave 76's disposition for each of the seven — persisted / deliberately not /
         needs an owner decision — is in build_log/wave76/W76_FIELD_DISPOSITION.md. */
      /* ── UPDATED BY WAVE 77 · R71 ────────────────────────────────────
         THE PIN SHRANK AGAIN, WHICH IS STILL THE ONLY DIRECTION IT MAY MOVE.
         `maturityDate` leaves this list because it is no longer IGNORED: R71 makes
         it a DERIVED field, so this route now REFUSES it by name
         (`maturity_date_not_writable`, HTTP 400) instead of returning 200 and
         discarding it. A refusal is not a drop — that distinction is the whole
         reason this pin exists. SIX remain. If this list ever GROWS, a route has
         started dropping a term again and that is a defect.
         Evidence: build_log/wave77/WAVE77_REPORT.md, W77_MATURITY_CENSUS.md. */
      /* ══ UPDATED BY WAVE 80 · ITEM 3 — THE PIN IS NOW EMPTY. DECLARED LOUDLY. ══
         THIS ASSERTION USED TO PIN A DEFECT AS CORRECT. For six waves it recorded
         six whitelisted term fields that `PATCH /api/rounds/:id/terms` accepted
         with HTTP 200 `{"ok":true}` and threw away, and a green test made that
         look intended. It was not intended; it was the defect.

         WAVE 80 EMPTIES IT, and every one of the six now has a NAMED behaviour:
           · `poolSize`, `sharesAuthorized` — PERSISTED, bounded and integral
             through the same shared helper `fdPreMoneyShares` uses;
           · `proRata`               — PERSISTED as a boolean; a non-boolean is
             refused by name rather than truthiness-cast;
           · `useOfProceeds`         — PERSISTED, in BOTH the free-text shape the
             founder wizard writes and the structured-row shape the readers were
             typed for, and BOTH now render;
           · `cap`, `expiryDate`     — REFUSED BY NAME (HTTP 400
             `cap_not_writable` / `expiry_date_not_writable`), because each is a
             SECOND SPELLING of a term this route already stores canonically
             (`valuationCap` / `expiryYears`) and two spellings of one fact can
             disagree with nothing able to say which is true. That is the Wave 77
             `maturityDate` precedent, applied for the same reason.

         A REFUSAL IS NOT A DROP. That distinction is the whole reason this pin
         exists, and it is why the list is empty rather than deleted. THE LIST MAY
         ONLY EVER SHRINK: if it GROWS, a route has started dropping a term again
         and that is a defect, not a new baseline.
         Evidence: build_log/wave80/WAVE80_REPORT.md, W80_TESTS.md. */
    ]);
    /* And the one this item fixed is definitively no longer among them. */
    expect(ignored).not.toContain("liquidationPreference");
    expect(handler).toContain("body.liquidationPreference");
    /* WAVE 76 — the same proof for the two money terms it fixed. */
    expect(ignored).not.toContain("antiDilutionType");
    expect(ignored).not.toContain("safeType");
    expect(handler).toContain("validateAntiDilutionTypeStored");
    expect(handler).toContain("validateSafeCapTypeStored");
    /* WAVE 80 · ITEM 3 — the same proof for the last six, stated per field so a
       future edit that removes one of them fails on the field's own name rather
       than on an opaque array comparison. */
    for (const k of ["poolSize", "sharesAuthorized", "proRata", "useOfProceeds"]) {
      expect(ignored, `${k} must no longer be silently ignored`).not.toContain(k);
      expect(handler, `${k} must reach the handler`).toContain(`body.${k}`);
    }
    expect(handler).toContain("validateSharesAuthorized");
    expect(handler).toContain("validatePoolSize");
    expect(handler).toContain("validateUseOfProceeds");
    /* The two REFUSALS are present as refusals, imported rather than restated so
       the rule cannot drift between this route and the founder route. */
    expect(handler).toContain("ROUND_CAP_ALIAS_NOT_WRITABLE");
    expect(handler).toContain("EXPIRY_DATE_NOT_WRITABLE");
  });
});

describe("W75 · ITEM 3 — the waterfall summary no longer degrades an exact decimal", () => {
  it("W75-N4-A — exact decimal figures are emitted and they reconcile to the exit", async () => {
    const { companyId } = await buildPreferredCompany("exact", "1x non-participating");
    const res = await waterfall(companyId);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);

    /* THE EXACT FIELDS EXIST AND ARE STRINGS, not floats. A consumer can now
       inherit the engine's precision instead of a double. */
    const fEx = (res.body as { founderProceedsExact?: unknown }).founderProceedsExact;
    const lEx = (res.body as { lpProceedsExact?: unknown }).lpProceedsExact;
    expect(typeof fEx).toBe("string");
    expect(typeof lEx).toBe("string");

    /* THE RESIDUE WAS NAMED, AND WAVE 77 REMOVED ITS CAUSE. `3333333333.3333335`
       was what the numeric field carried, because one third of $100,000,000 is not
       representable as an IEEE-754 double at all. Under R72 no field on this
       response carries that double any more — see the block below. */
    expect(String(fEx)).toMatch(/^3333333333\.3333333333/);
    expect(String(fEx)).not.toBe("3333333333.3333335");

    /* AND THE ARITHMETIC RECONCILES EXACTLY — the two legs sum to the exit, to the
       last digit, which the float sums could not guarantee. */
    const sumExact = (a: string, b: string): string => {
      const dp = 30;
      const scale = (x: string): bigint => {
        const [i, f = ""] = x.split(".");
        return BigInt(i + (f + "0".repeat(dp)).slice(0, dp));
      };
      const total = scale(a) + scale(b);
      const s = total.toString().padStart(dp + 1, "0");
      return `${s.slice(0, -dp)}.${s.slice(-dp)}`.replace(/\.?0+$/, "");
    };
    expect(sumExact(String(fEx), String(lEx))).toBe("5000000000");

    /* The legacy numeric fields keep their names, their order and their meaning —
       removing or renaming either would be a silent drop. */
    expect(res.body).toHaveProperty("founderProceeds");
    expect(res.body).toHaveProperty("lpProceeds");
    /* ── WAVE 77 · R72 — THE "LEGACY NUMERIC FIELDS" ARE NO LONGER NUMERIC ─────
       Wave 75 emitted the exact strings ALONGSIDE the doubles and recorded the
       remaining defect as open item J-1. The owner answered with R72: carry the
       money as exact decimal text. So these two fields now carry the SAME value as
       their `*Exact` siblings, byte for byte, and `Math.round(Number(...))` — the
       narrowing R72 condition 4 forbids — is gone from this assertion. */
    expect(res.body.founderProceeds).toBe(fEx);
    expect(res.body.lpProceeds).toBe(lEx);
    expect(res.body.founderProceeds).toBe("3333333333.3333333333333333333333333333");
    expect(res.body.lpProceeds).toBe("1666666666.6666666666666666666666666667");

    /* Per-class exactness too, on the same response. */
    const byClass = (res.body as { byShareClass: Array<{ proceeds: unknown; proceedsExact?: unknown }> }).byShareClass;
    expect(byClass.length).toBeGreaterThan(0);
    for (const c of byClass) {
      expect(typeof c.proceedsExact).toBe("string");
      /* WAVE 77 · R72 — and the primary field is the same exact text, not a double. */
      expect(c.proceeds).toBe(c.proceedsExact);
    }

    /* The breakpoint is now the SAME value as `lpProceeds`, not a second float sum
       of the same rows. */
    /* WAVE 77 · R72 — `exitMinor` is exact decimal text now, like every other money
       value on this response; the equality below therefore still holds and still
       proves the breakpoint is the SAME quantity, not a second sum of it. */
    const bp = (res.body as { breakpoints: Array<{ exitMinor: string; description: string }> }).breakpoints;
    expect(bp[0].description).toBe("liquidation_preference_covered");
    expect(bp[0].exitMinor).toBe(res.body.lpProceeds);
  }, 60_000);

  it("W75-N4-B — the boundary is fixed at the source, not at a display layer", () => {
    const s = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8");
    /* The three `reduce((s, p) => s + Number(p.total), 0)` float accumulations are
       gone from the waterfall summary and replaced by one exact summer. */
    expect(s).toContain("const exactSum = (rows: Array<{ total: string }>): Decimal =>");
    expect(s).not.toContain("reduce((s, p) => s + Number(p.total), 0)");
    /* And no `toFixed(2)` display round was introduced to paper over it. */
    expect(s).not.toContain("founderProceeds.toFixed(2)");
  });
});
