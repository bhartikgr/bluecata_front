/**
 * WAVE 81 — ROUNDING AUTHORITY, THE FULL-RATCHET SHARE, AND THE SENIORITY WRITE.
 * ════════════════════════════════════════════════════════════════════════════
 * D3 — two modules mutated the ONE shared decimal.js constructor, so the
 *      cap-table engine's precision and rounding were a function of import
 *      order and the same fixture returned 8,888,887 or 8,888,888 depending on
 *      what else the process had loaded.
 * D5 — `applyFullRatchet` divided then multiplied, losing one share on
 *      exact-integer entitlements.
 * D4 — `PATCH /api/rounds/:id/terms` answered HTTP 200 `{"ok":true}` to
 *      `{"seniority": …}` and stored nothing, while a live refusal instructs a
 *      founder by name to record exactly that field.
 * D6 — `Number(exitValuationMinor)` narrows above 2^53 minor units. DOCUMENTED,
 *      not fixed; the assertion below pins the boundary so it cannot drift
 *      silently and cannot be re-discovered as new.
 *
 * EVERY ASSERTION READS BEHAVIOUR BACK. The configuration tests read
 * `.precision` / `.rounding` off the live constructors rather than grepping the
 * source; the seniority tests read the value OUT OF THE STORE, never off the
 * mutation's own echo, because a 200 is not evidence.
 *
 * MUTATION TRANSCRIPTS: build_log/wave81/W81_TESTS.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import BaseDecimal from "decimal.js";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { getRoundById } from "../roundsStore";
import { SENIORITY_RANK_MAX, validateSeniorityRankStored } from "../lib/roundStoredTerms";

const ROOT = path.resolve(__dirname, "../..");
const ADMIN = "u_admin";
const STAMP = `w81${Date.now().toString(36)}`;
let app: Express;

/* ════════════════════════════════════════════════════════════════════════════
   ITEM 1 · D3 — THE ENGINE'S ROUNDING IS ITS OWN, AND NOBODY MUTATES THE GLOBAL
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 81 · ITEM 1 (D3) — rounding authority", () => {
  it("W81-D3-A — the engine's OBSERVED precision and rounding are 38 / ROUND_HALF_EVEN, read back off the live constructor", async () => {
    const engine = await import("@capavate/cap-table-engine");
    const EngDec = engine.Decimal as unknown as typeof BaseDecimal;
    /* READ BACK, not grepped. The old defect was that the source said 38 and the
       process ran at 40, so an assertion on the source text would have passed
       throughout the defect's entire life. */
    expect(EngDec.precision).toBe(38);
    expect(EngDec.rounding).toBe(BaseDecimal.ROUND_HALF_EVEN);
    expect(BaseDecimal.ROUND_HALF_EVEN).toBe(6);
    /* And it is actually USED: 38 significant digits, not 20 and not 40. */
    expect(new EngDec(1).div(3).toString()).toBe("0.33333333333333333333333333333333333333");
    expect(engine.D("1").div(3).toFixed()).toBe("0.33333333333333333333333333333333333333");
  });

  it("W81-D3-B — importing the cap-table engine does NOT mutate the shared decimal.js constructor", async () => {
    const before = { precision: BaseDecimal.precision, rounding: BaseDecimal.rounding };
    await import("@capavate/cap-table-engine");
    await import("@capavate/cap-table-engine/dist/index.js").catch(() => undefined);
    expect({ precision: BaseDecimal.precision, rounding: BaseDecimal.rounding }).toEqual(before);
  });

  it("W81-D3-C — the engine is IMMUNE to a hostile global re-configuration (the defect, reproduced and defeated)", async () => {
    const engine = await import("@capavate/cap-table-engine");
    const EngDec = engine.Decimal as unknown as typeof BaseDecimal;
    const saved = { precision: BaseDecimal.precision, rounding: BaseDecimal.rounding };
    try {
      /* This is exactly what `packages/math-fns/src/index.ts:17` does to the
         shared constructor, and what used to decide the engine's arithmetic. */
      BaseDecimal.set({ precision: 40, rounding: BaseDecimal.ROUND_HALF_UP });
      expect(EngDec.precision).toBe(38);
      expect(EngDec.rounding).toBe(BaseDecimal.ROUND_HALF_EVEN);
      expect(engine.D("1").div(3).toFixed()).toBe("0.33333333333333333333333333333333333333");
      /* THE MEASURED CONSEQUENCE, now stable. Under the defect this fixture
         returned 8,888,887 at 38/HALF_EVEN and 8,888,888 at 40/HALF_UP. */
      const fr = engine.applyFullRatchet({
        originalIssuePrice: "1", newIssuePrice: "0.875", protectedShares: 7_777_777n,
        formulaId: "w81", formulaVersion: "1", region: "US", formulaDef: {},
      });
      expect(fr.newShares.toString()).toBe("8888888");
      /* And at an absurd global setting too — the point is INDEPENDENCE, not 40. */
      BaseDecimal.set({ precision: 5, rounding: BaseDecimal.ROUND_DOWN });
      expect(EngDec.precision).toBe(38);
      expect(engine.D("1").div(3).toFixed()).toBe("0.33333333333333333333333333333333333333");
    } finally {
      BaseDecimal.set(saved);
    }
  });

  it("W81-D3-D — EXACTLY ONE module in the tree mutates the global decimal.js config, and it is named", () => {
    /* A SECOND global writer anywhere re-opens D3, so the set of writers is
       pinned rather than the absence of writers assumed. Scanned over real
       source only: no node_modules, no `.g0-snapshot` frozen copy, no tests. */
    const roots = ["server", "client/src", "shared", "packages", "scripts", "script"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "dist" || e.name === "__tests__" || e.name === "test") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|mts|mjs|js|jsx)$/.test(e.name)) continue;
        if (/\.test\.|\.spec\./.test(e.name)) continue;
        /* COMMENTS ARE STRIPPED FIRST. `bigDecimal.ts` now QUOTES the call it
           used to make, inside its own explanatory block, and a scanner that
           counted that would report the defect as still present. Found by this
           very assertion on its first run, which is the point of it. */
        const src = fs.readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
        /* `Decimal.clone({…})` is the CORRECT mechanism and is deliberately not
           matched — only a mutation of a shared constructor is. */
        for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.(set|config)\s*\(/g)) {
          if (!/decimal/i.test(m[1])) continue;
          hits.push(`${path.relative(ROOT, full)}: ${m[1]}.${m[2]}(`);
        }
      }
    };
    for (const r of roots) walk(path.join(ROOT, r));
    expect(hits.sort()).toEqual([
      /* THE ONE PERMITTED WRITER, and the reason it is permitted is written out
         in that file: eight modules read the BARE global constructor and one of
         them (`server/captableCommitStore.ts`) is SACRED, so removing this pin
         would drop them to decimal.js's default precision 20 and break the
         waterfall reconciliation the QA document publishes. Measured in
         build_log/wave81/W81_ROUNDING_AUTHORITY.md. If this list GROWS, the
         import-order defect is back. */
      "packages/math-fns/src/index.ts: Decimal.set(",
    ]);
  });

  it("W81-D3-E — the global pin is DETERMINISTIC: 40 / ROUND_HALF_UP wherever math-fns is loaded", async () => {
    await import("@capavate/math-fns");
    expect(BaseDecimal.precision).toBe(40);
    expect(BaseDecimal.rounding).toBe(BaseDecimal.ROUND_HALF_UP);
    /* And it does not reach into the engine. */
    const engine = await import("@capavate/cap-table-engine");
    expect((engine.Decimal as unknown as typeof BaseDecimal).precision).toBe(38);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   ITEM 3 · D5 — THE FULL-RATCHET SHARE, AND THE RATIFIED FIGURES
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 81 · ITEM 3 (D5) — one fused division", () => {
  it("W81-D5-A — exact-integer entitlements are exact: 960 fixtures, zero lost shares", async () => {
    const engine = await import("@capavate/cap-table-engine");
    const FD = { formulaId: "w81", formulaVersion: "1", region: "US" as const, formulaDef: {} };
    let checked = 0;
    const lost: string[] = [];
    for (let den = 2; den <= 16; den++) {
      for (let num = den + 1; num <= den + 16; num++) {
        for (const base of [1_000_000n, 7_777_777n, 3n, 999_983n]) {
          const protectedShares = base * BigInt(den);
          const expected = (protectedShares * BigInt(num)) / BigInt(den);
          const r = engine.applyFullRatchet({
            originalIssuePrice: String(num), newIssuePrice: String(den), protectedShares, ...FD,
          });
          checked++;
          if (r.newShares !== expected) lost.push(`OIP=${num} NIP=${den} n=${protectedShares}: ${r.newShares} != ${expected}`);
        }
      }
    }
    expect(checked).toBe(960);
    /* BEFORE this wave: 77 of these lost exactly one share at the engine's
       declared 38 / ROUND_HALF_EVEN, and 70 lost one at the 40 / ROUND_HALF_UP
       production was accidentally running at. */
    expect(lost).toEqual([]);
  });

  it("W81-D5-B — the conversion price is still NIP, and an up round still changes nothing", async () => {
    const engine = await import("@capavate/cap-table-engine");
    const FD = { formulaId: "w81", formulaVersion: "1", region: "US" as const, formulaDef: {} };
    const down = engine.applyFullRatchet({
      originalIssuePrice: "1.30", newIssuePrice: "0.80", protectedShares: 10_000_000n, ...FD,
    });
    expect(down.newConversionPrice).toBe("0.8");
    /* THE RATIFIED FULL-RATCHET FIGURE, unchanged by both of this wave's engine
       edits. Published in the QA document; if it moves, that document is wrong. */
    expect(down.newShares.toString()).toBe("16250000");
    const up = engine.applyFullRatchet({
      originalIssuePrice: "1.00", newIssuePrice: "2.00", protectedShares: 10_000_000n, ...FD,
    });
    expect(up.newShares.toString()).toBe("10000000");
    expect(up.delta.toString()).toBe("0");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   ITEM 2 · D4 — SENIORITY IS PERSISTED, WITH VALIDATION, AT BOTH WRITERS
   ════════════════════════════════════════════════════════════════════════════ */
async function makeRound(key: string): Promise<{ companyId: string; roundId: string }> {
  const companyId = `co_${STAMP}_${key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W81 ${key}` });
  expect(co.status, `company create ${key}`).toBeLessThan(400);
  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
    companyId, name: `${STAMP} Round ${key}`, type: "seed", instrument: "preferred",
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    pricePerShare: 2.5, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
  });
  expect(created.status, `round create ${key}: ${JSON.stringify(created.body).slice(0, 300)}`).toBe(200);
  return { companyId, roundId: String((created.body as { id: string }).id) };
}
const patchTerms = (roundId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN).send(body);
const stored = (roundId: string): Record<string, unknown> =>
  (getRoundById(roundId) ?? {}) as unknown as Record<string, unknown>;

describe("WAVE 81 · ITEM 2 (D4) — the seniority write", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  it("W81-D4-A — PERSIST POLE: the rank the refusal instructs is stored and reads back", async () => {
    const { roundId } = await makeRound("persist");
    /* PRE-STATE, so the pass cannot be vacuous. */
    expect(stored(roundId).seniority ?? null).toBeNull();

    const res = await patchTerms(roundId, { seniority: 0 });
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.ok).toBe(true);

    /* OUT OF THE STORE, not off the echo — a 200 is what the defect returned. */
    expect(Number(stored(roundId).seniority)).toBe(0);
    const reread = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
    expect(reread.status).toBe(200);
    expect(Number((reread.body as Record<string, unknown>).seniority)).toBe(0);

    /* And the top of the domain. */
    expect((await patchTerms(roundId, { seniority: SENIORITY_RANK_MAX })).status).toBe(200);
    expect(Number(stored(roundId).seniority)).toBe(SENIORITY_RANK_MAX);
  });

  it("W81-D4-B — REFUSE POLE: out-of-domain and non-integral ranks are refused BY NAME and write nothing", async () => {
    const { roundId } = await makeRound("refuse");
    expect((await patchTerms(roundId, { seniority: 2 })).status).toBe(200);
    expect(Number(stored(roundId).seniority)).toBe(2);

    /* `[]` and `[5]` are in this list deliberately. Every other field on this
       route tests for removal with `String(x).trim() === ""`, under which `[]`
       stringifies to `""` and would be read as "delete the ranking" and `[5]`
       would be read as the rank 5. For a term that decides the ORDER in which
       classes are paid at an exit, a container is a client bug, not a value, so
       `seniority` refuses non-primitive shapes BY NAME and tests removal on the
       LITERAL `null` / `""`. Found by this assertion on its first run. */
    /* `NaN` is deliberately NOT in this list: `JSON.stringify(NaN)` is `null`, so
       it arrives as an EXPLICIT REMOVAL and correctly returns 200 — it is not
       reachable as a bad value over HTTP at all. It is covered at the unit level
       in `W81-D4-G` instead. Found by this assertion on its second run. */
    for (const bad of [3.5, -1, 100, 1e9, "senior", true, {}, [], [5]]) {
      const res = await patchTerms(roundId, { seniority: bad as never });
      expect(res.status, `seniority=${JSON.stringify(bad)}`).toBe(400);
      expect(res.body.error).toBe("invalid_seniority");
      expect(res.body.field).toBe("seniority");
      expect(String(res.body.message)).toContain("0 is the most senior");
      /* NOTHING WAS WRITTEN — the previously accepted rank is untouched. */
      expect(Number(stored(roundId).seniority)).toBe(2);
    }
  });

  it("W81-D4-C — REMOVAL POLE: `null` clears the rank rather than being ignored", async () => {
    const { roundId } = await makeRound("remove");
    expect((await patchTerms(roundId, { seniority: 4 })).status).toBe(200);
    expect(Number(stored(roundId).seniority)).toBe(4);
    expect((await patchTerms(roundId, { seniority: null })).status).toBe(200);
    expect(stored(roundId).seniority ?? null).toBeNull();
  });

  it("W81-D4-D — ABSENT POLE: a patch that does not mention seniority leaves it alone", async () => {
    const { roundId } = await makeRound("absent");
    expect((await patchTerms(roundId, { seniority: 7 })).status).toBe(200);
    expect((await patchTerms(roundId, { termsSummary: "unrelated edit" })).status).toBe(200);
    expect(Number(stored(roundId).seniority)).toBe(7);
  });

  it("W81-D4-E — WRITER 2: `PATCH /api/founder/rounds/:id` refuses the same values by name", async () => {
    const { roundId } = await makeRound("writer2");
    const patch = (body: Record<string, unknown>) =>
      request(app).patch(`/api/founder/rounds/${roundId}`).set("x-user-id", ADMIN).send(body);
    /* The whitelist entry that lets writer 1 persist also makes THIS route able
       to persist, so it must refuse the same domain or it becomes the unvalidated
       writer Wave 76 measured on this very handler. */
    const bad = await patch({ seniority: 3.5 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_seniority");
    const ok = await patch({ seniority: 1 });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBeLessThan(400);
    expect(Number(stored(roundId).seniority)).toBe(1);
  });

  it("W81-D4-F — the refusal that INSTRUCTS the write, and the write, now agree", () => {
    /* The point of the item: the sentence a founder is shown names a field the
       platform can actually store. Read from the two files, not restated. */
    const route = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8");
    expect(route).toContain("SENIORITY_NOT_ON_RECORD");
    expect(route).toContain("Record each ");
    const terms = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
    const h = terms.indexOf('app.patch("/api/rounds/:id/terms"');
    const end = terms.indexOf("const updResult = roundsStoreUpdate(", h);
    expect(terms.slice(h, end)).toContain("validateSeniorityRankStored");
    /* AND IT REMAINS API-ONLY. No seniority control exists in the client; this
       assertion is what makes that claim falsifiable rather than a sentence in a
       report. If a UI is built, this test must be updated deliberately. */
    const clientHits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.(tsx|jsx)$/.test(e.name)) continue;
        if (/seniority/i.test(fs.readFileSync(full, "utf8"))) clientHits.push(path.relative(ROOT, full));
      }
    };
    walk(path.join(ROOT, "client/src"));
    expect(clientHits).toEqual([]);
  });

  it("W81-D4-G — the validator's domain IS the reader's domain, in one place", () => {
    expect(SENIORITY_RANK_MAX).toBe(99);
    expect(validateSeniorityRankStored(undefined)).toEqual({ ok: true, value: "" });
    expect(validateSeniorityRankStored(null)).toEqual({ ok: true, value: "" });
    expect(validateSeniorityRankStored("")).toEqual({ ok: true, value: "" });
    expect(validateSeniorityRankStored(0)).toEqual({ ok: true, value: "0" });
    expect(validateSeniorityRankStored("12")).toEqual({ ok: true, value: "12" });
    expect(validateSeniorityRankStored(99)).toEqual({ ok: true, value: "99" });
    for (const bad of [100, -1, 0.5, "x", true, false, Infinity]) {
      expect(validateSeniorityRankStored(bad).ok, `${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   ITEM 4 · D6 — THE INPUT NARROWING, DOCUMENTED AND PINNED (NOT FIXED)
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 81 · ITEM 4 (D6) — the 2^53 input boundary", () => {
  it("W81-D6-A — `Number()` on the exit valuation narrows above 2^53, and the boundary is where it is claimed to be", () => {
    /* NOT FIXED. `server/track1Routes.ts` parses `exitValuationMinor` with
       `Number()`, so a value above Number.MAX_SAFE_INTEGER is silently rounded to
       the nearest representable double before any Decimal ever sees it. This
       assertion documents the arithmetic fact and the exact threshold so the
       boundary cannot drift, and so a later wave that restructures the input path
       has a pinned statement of what it must beat. Restructuring an input path is
       deliberately out of scope this close to a freeze.

       9,007,199,254,740,993 minor units is ~$90,071,992,547,409.93 — about
       $90 trillion, above global GDP, so nothing reachable is affected. */
    expect(Number.MAX_SAFE_INTEGER).toBe(9007199254740991);
    expect(Number("9007199254740993")).toBe(9007199254740992);
    expect(String(Number("9007199254740993"))).not.toBe("9007199254740993");
    /* One minor unit below the boundary is still exact, which is why nothing
       realistic is affected. */
    expect(String(Number("9007199254740991"))).toBe("9007199254740991");
    const src = fs.readFileSync(path.join(ROOT, "server/track1Routes.ts"), "utf8");
    expect(src).toContain("const exitMinor = Number(exitValuationMinor);");
  });
});
