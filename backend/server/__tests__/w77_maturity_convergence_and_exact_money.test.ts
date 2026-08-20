/**
 * WAVE 77 — ITEM 1 (R71 · maturity converges on ONE field) and
 *           ITEM 2 (R72 · money is carried as exact decimal text).
 *
 * ── WHAT THESE TESTS ARE FOR ─────────────────────────────────────────────────
 * R71 condition 6 asks for BOTH POLES at every writer plus a test proving the two
 * names can no longer disagree. R72 condition 4 asks for a test that FAILS if a
 * `Number(...)` narrowing comes back onto the money path. Both are here.
 *
 * Every figure asserted below was READ OFF AN EXECUTED RUN before it was pinned
 * (R62 — never state a money figure without a transcript). The transcripts are
 * `build_log/wave77/W77_TESTS.md` and `build_log/wave77/w77_targeted_run*.log`.
 *
 * MUTATION TRANSCRIPTS: build_log/wave77/W77_TESTS.md.
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
import { UPDATE_ROUND_WHITELIST_KEYS } from "../roundsStore";
import {
  resolveNoteMaturityDate,
  deriveMaturityDateFromMonths,
  censusMaturityNames,
  MATURITY_DATE_NOT_WRITABLE,
} from "@shared/roundMathEngineAdapter";

const ROOT = path.resolve(__dirname, "../..");
const ADMIN = "u_admin";
const EXIT_MINOR = "5000000000"; // $50,000,000.00 — Wave 74's fixed exit value
const STAMP = `w77t${Date.now().toString(36)}`;
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments removed, so a fence cannot be tripped (or satisfied) by
 *  prose. The two `Number(p.total)` strings left in `track1Routes.ts` are both
 *  inside comment blocks that DOCUMENT the removed defect — deleting the history
 *  to make a fence green would be the opposite of the point. */
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let app: Express;

/** Wave 74/75's fixture, verbatim, so the money figures are comparable. */
async function buildPreferredCompany(
  key: string,
  liquidationPreference?: string,
): Promise<{ companyId: string; roundId: string }> {
  const companyId = `co_${STAMP}_${key}`;
  const co = await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W77 ${key}` });
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

const waterfall = (companyId: string) =>
  request(app).get("/api/founder/captable/waterfall")
    .query({ companyId, exitValuationMinor: EXIT_MINOR })
    .set("x-user-id", ADMIN);

/** Exact decimal-string addition, so the reconciliation never touches a float. */
function sumExact(a: string, b: string): string {
  const dp = 40;
  const scale = (x: string): bigint => {
    const [i, f = ""] = x.split(".");
    return BigInt(i + (f + "0".repeat(dp)).slice(0, dp));
  };
  const total = scale(a) + scale(b);
  const s = total.toString().padStart(dp + 1, "0");
  return `${s.slice(0, -dp)}.${s.slice(-dp)}`.replace(/\.?0+$/, "");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 1 · R71 — ONE CANONICAL MATURITY FIELD. THE TWO NAMES CANNOT DISAGREE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W77 · R71 — maturity converges on `maturityMonths`", () => {
  const NOTE = (o: Record<string, unknown>) =>
    ({ id: "nt", instrument: "note", issuedAt: "2025-06-01", ...o }) as never;

  it("W77-R71-A — the CANONICAL field wins, so the two names can no longer disagree", () => {
    /* THE WHOLE OF R71 CONDITION 1, AND THE FALSIFIER FOR IT. Before this wave the
       stored absolute date won, so this call returned "2099-01-01" and a round could
       carry two contradictory maturities at once. `maturityMonths` is canonical, so
       the answer is the DERIVED date and the contradiction is unreachable. */
    expect(resolveNoteMaturityDate(NOTE({ maturityMonths: 24, maturityDate: "2099-01-01" })))
      .toEqual({ maturityDate: "2027-06-01" });
    /* And the census reports the disagreement rather than resolving it silently
       (R71 condition 3 — which spelling wins on a live row is the OWNER's call). */
    const c = censusMaturityNames(NOTE({ maturityMonths: 24, maturityDate: "2099-01-01" }));
    expect(c.agrees).toBe(false);
    expect(c.derived).toBe("2027-06-01");
    expect(c.stored).toBe("2099-01-01");
  });

  it("W77-R71-B — a LEGACY stored date is still READ, never orphaned", () => {
    /* R71 condition 3. A row with no canonical months keeps the date it has, and
       every screen that showed it still shows it. This is the assertion that stops
       convergence from becoming a silent drop. */
    expect(resolveNoteMaturityDate(NOTE({ maturityDate: "2026-11-01" })))
      .toEqual({ maturityDate: "2026-11-01" });
    /* Nothing stored at all still returns NOTHING — no fabricated date (R6/R48). */
    expect(resolveNoteMaturityDate(NOTE({}))).toEqual({});
    /* And the census calls that agreement, because there is nothing to disagree with. */
    expect(censusMaturityNames(NOTE({ maturityDate: "2026-11-01" })).agrees).toBe(true);
  });

  it("W77-R71-C — the derivation is CALENDAR arithmetic inside R50's domain, or nothing", () => {
    expect(deriveMaturityDateFromMonths(24, "2025-06-01")).toBe("2027-06-01");
    expect(deriveMaturityDateFromMonths(18, "2025-06-01")).toBe("2026-12-01");
    expect(deriveMaturityDateFromMonths(0, "2025-06-01")).toBe("2025-06-01");
    /* ── WAVE 79 · ITEM 4 — THIS ASSERTION WAS PINNING THE DEFECT ─────────────
       WAS: `expect(deriveMaturityDateFromMonths(1, "2025-01-31")).toBe("2025-03-03")`.
       INVERTING AN ASSERTION IS A RED FLAG, so here is the whole reason.

       The comment on the line — "1 month from 31 January is not 2 March" — was
       arguing AGAINST rollover while the assertion pinned it, and the value pinned
       was not even the value the comment named (`2025-03-03`, not `2025-03-02`).
       `setUTCMonth` keeps the day-of-month and spills into the following month when
       the target month is shorter, so twelve months from 2024-02-29 derived
       2025-03-01 — a twelve-month note maturing in the THIRTEENTH month (Review A
       §D-A4). Financial convention clamps to the last day of the target month (ISDA
       2006 Definitions §4.16 "End of Month"; ICMA month-end roll practice).

       WHAT THE OLD ASSERTION WAS ACTUALLY FOR is preserved and strengthened: it
       existed to prove the derivation is CALENDAR arithmetic and never "months ×
       30". `2025-03-03` and `2025-02-28` are both incompatible with months × 30
       (which gives 2025-03-02 from a 30-day month), and the months × 30 pole is now
       asserted explicitly below. The clamp can only move a date EARLIER inside the
       target month, never into a different month.

       Both poles and the leap-year cases live in `W79-D1`; this line keeps the
       original case so a revert fails HERE too. */
    expect(deriveMaturityDateFromMonths(1, "2025-01-31")).toBe("2025-02-28");
    expect(deriveMaturityDateFromMonths(1, "2025-01-31")).not.toBe("2025-03-03");
    /* Never "months × 30": a 30-day step from 31 January would land on 2 March. */
    expect(deriveMaturityDateFromMonths(1, "2025-01-31")).not.toBe("2025-03-02");
    /* And the leap-year headline, so the two files cannot disagree about it. */
    expect(deriveMaturityDateFromMonths(12, "2024-02-29")).toBe("2025-02-28");
    /* R50's domain restated at the read boundary: a date typed into a months field
       is IGNORED, so it can never become a 1.7-million-year maturity. */
    expect(deriveMaturityDateFromMonths(20261231, "2025-06-01")).toBeNull();
    expect(deriveMaturityDateFromMonths(601, "2025-06-01")).toBeNull();
    /* No issue date -> no derivation, and the stored date is then used instead. */
    expect(deriveMaturityDateFromMonths(24, null)).toBeNull();
    expect(resolveNoteMaturityDate({ id: "x", maturityMonths: 601, maturityDate: "2026-11-01" } as never))
      .toEqual({ maturityDate: "2026-11-01" });
  });

  it("W77-R71-D — ONE definition of the rule, imported by all three writers", () => {
    /* R71 condition 4: one rule at every writer. The only structural guarantee is
       that the writers IMPORT it. Four waves have paid for a rule that lived in
       three places (58e, 58f, 61b, 76). */
    const adapter = src("shared/roundMathEngineAdapter.ts");
    expect(adapter.match(/export const MATURITY_DATE_NOT_WRITABLE/g)?.length).toBe(1);
    expect(adapter).toContain('error: "maturity_date_not_writable"');
    for (const f of ["server/routes.ts", "server/roundCarryForwardRoutes.ts"]) {
      expect(src(f), `${f} does not import the rule`).toContain("MATURITY_DATE_NOT_WRITABLE");
      /* and does not restate the sentence */
      expect(src(f)).not.toContain("Capavate records a round's maturity as Maturity (months)");
    }
    /* WRITER 4 (carry-forward accept) provably cannot persist it: the key is not a
       round column and is not on that route's whitelist. Verified, not assumed. */
    expect([...UPDATE_ROUND_WHITELIST_KEYS]).not.toContain("maturityDate");
  });

  it("W77-R71-E — NO SILENT DROP: the field still reaches the screen, derived", () => {
    /* R71 condition 2, "we cannot disable vehicles". The cap-table screen renders a
       maturity for every outstanding SAFE and note; the key is still emitted by the
       one securities builder, and its value now comes from the one derivation. */
    expect(src("client/src/pages/founder/CapTable.tsx")).toContain("{s.maturityDate && (");
    const routes = src("server/routes.ts");
    expect(routes).toContain("maturityDate:\n          resolveNoteMaturityDate({");
    expect(routes).toContain("resolveNoteMaturityDate");
    /* The reader that feeds it still exposes the key too. */
    expect(src("server/lib/roundStoredTerms.ts")).toContain('maturityDate: str("maturityDate")');
  });

  it("W77-R71-F — NO NEW MIGRATION: a derived field needs no column", () => {
    const files = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBe(173);
    expect(files.sort().at(-1)).toBe("0192_wave68_term_domain_fences.sql");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 1 · R71 — BOTH POLES, THROUGH THE LIVE HTTP WRITERS.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W77 · R71 — both poles at every writer", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  it("W77-R71-W1 — WRITER 1 (PATCH /api/rounds/:id/terms): refused BY NAME, not dropped", async () => {
    const { roundId } = await buildPreferredCompany("w1");
    /* POLE 1 — the absolute date is REFUSED. Before this wave this request returned
       200 `{"ok":true}` and silently discarded the key. */
    const refused = await request(app).patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", ADMIN).send({ maturityDate: "2030-01-01" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("maturity_date_not_writable");
    expect(refused.body.field).toBe("maturityDate");
    expect(String(refused.body.message).length).toBeGreaterThan(200);
    expect(String(refused.body.message)).toContain("Maturity (months)");
    /* POLE 2 — the CANONICAL field is still accepted and still bounded (R50). */
    const ok = await request(app).patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", ADMIN).send({ maturityMonths: 24 });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBe(200);
    const tooBig = await request(app).patch(`/api/rounds/${roundId}/terms`)
      .set("x-user-id", ADMIN).send({ maturityMonths: 601 });
    expect(tooBig.status).toBe(400);
  }, 60_000);

  it("W77-R71-W2 — WRITER 2 (POST /api/rounds): the past-date refusal SURVIVES, and the new one is added", async () => {
    const companyId = `co_${STAMP}_w2`;
    await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
      .send({ companyId, companyName: "W77 w2" });
    const body = (maturity: Record<string, unknown>) => ({
      companyId, name: `${STAMP} note`, type: "seed", instrument: "convertible_note",
      openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 1_000_000,
      valuationCap: 10_000_000, ...maturity,
    });
    /* POLE 1a — the PAST-date refusal creation already made is UNTOUCHED. Its own
       sentence still comes back: no working refusal was removed or softened. */
    const past = await request(app).post("/api/rounds").set("x-user-id", ADMIN)
      .send(body({ maturityDate: "1999-01-01" }));
    expect(past.status).toBe(400);
    expect(past.body.error).toBe("validation_failed");
    expect(String(past.body.fieldErrors.maturityDate)).toBe("Maturity date must be in the future.");
    /* POLE 1b — a FUTURE date is now refused too, because the field is derived. */
    const future = await request(app).post("/api/rounds").set("x-user-id", ADMIN)
      .send(body({ maturityDate: "2030-01-01" }));
    expect(future.status).toBe(400);
    expect(future.body.error).toBe("validation_failed");
    expect(String(future.body.fieldErrors.maturityDate)).toContain("Maturity (months)");
    /* POLE 2 — the canonical field creates a round exactly as before. */
    const good = await request(app).post("/api/rounds").set("x-user-id", ADMIN)
      .send(body({ maturityMonths: 24 }));
    expect(good.status, JSON.stringify(good.body).slice(0, 300)).toBe(200);
  }, 60_000);

  it("W77-R71-W3 — WRITER 3 (PATCH /api/founder/rounds/:id): the measured BYPASS is closed", async () => {
    const { roundId } = await buildPreferredCompany("w3");
    /* THE BYPASS WAVE 76 MEASURED: this handler accepted `1999-01-01` on a 200,
       after creation had refused that exact value. Both of Wave 76's transcript
       values are asserted, so the bypass cannot reopen quietly. */
    for (const v of ["1999-01-01", "not-a-date", "2030-01-01"]) {
      const res = await request(app).patch(`/api/founder/rounds/${roundId}`)
        .set("x-user-id", ADMIN).send({ maturityDate: v });
      expect(res.status, `maturityDate=${v}`).toBe(400);
      expect(res.body.error).toBe("maturity_date_not_writable");
    }
    /* POLE 2 — an unrelated patch is untouched (ABSENT IS UNTOUCHED). */
    const ok = await request(app).patch(`/api/founder/rounds/${roundId}`)
      .set("x-user-id", ADMIN).send({ maturityMonths: 18 });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 300)).toBeLessThan(400);
  }, 60_000);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 2 · R72 — MONEY AS EXACT DECIMAL TEXT.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W77 · R72 — the waterfall carries money as exact decimal text", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  it("W77-M1 — every money field is an exact decimal STRING, and the residue is gone", async () => {
    const { companyId } = await buildPreferredCompany("money", "1x non-participating");
    const res = await waterfall(companyId);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const b = res.body as Record<string, unknown>;

    for (const k of ["lpProceeds", "founderProceeds", "lpProceedsExact", "founderProceedsExact"]) {
      expect(typeof b[k], `${k} is not a string`).toBe("string");
    }
    /* THE FIGURE R72 WAS ISSUED ABOUT. The double could only ever be
       `3333333333.3333335`; the exact decimal is the repeating expansion. */
    expect(b.founderProceeds).not.toBe("3333333333.3333335");
    expect(String(b.founderProceeds)).toMatch(/^3333333333\.3333333333/);
    expect(String(b.lpProceeds)).toMatch(/^1666666666\.6666666666/);
    /* PINNED FROM AN EXECUTED RUN, not from arithmetic done in my head (R62). The
       transcript is `build_log/wave77/W77_MONEY_TRANSCRIPT_RAW.txt`. These are the
       cap-table engine's OWN decimal strings, carried across the API boundary
       unchanged. THE HONEST LIMIT, stated rather than implied: one third of
       $100,000,000 is non-terminating in decimal too, so no finite string is
       literally exact — what changed is that the figure now carries the ENGINE's
       representation (40 decimal places, its declared precision) instead of a
       double's ~16 significant digits, and the two legs still reconcile to the exit
       value EXACTLY, which the doubles could not. */
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
        expect(b.founderProceeds).toBe("3333333333.3333333333333333333333333333");
    expect(b.lpProceeds).toBe("1666666666.6666666666666666666666666667");
    /* ONE FORMAT, NOT TWO: the legacy name and the `*Exact` alias are identical. */
    expect(b.founderProceeds).toBe(b.founderProceedsExact);
    expect(b.lpProceeds).toBe(b.lpProceedsExact);
    /* NOTHING WAS ROUNDED to make this pass (R72 condition 3): the two legs
       reconcile to the exit value EXACTLY, in decimal arithmetic. */
    expect(sumExact(String(b.founderProceeds), String(b.lpProceeds))).toBe("5000000000");
    /* Per class, and on the breakpoint, the same one format. */
    const byClass = b.byShareClass as Array<{ proceeds: unknown; proceedsExact: unknown }>;
    expect(byClass.length).toBeGreaterThan(0);
    for (const c of byClass) {
      expect(typeof c.proceeds).toBe("string");
      expect(c.proceeds).toBe(c.proceedsExact);
    }
    const bp = b.breakpoints as Array<{ exitMinor: unknown; description: string }>;
    expect(typeof bp[0].exitMinor).toBe("string");
    expect(bp[0].exitMinor).toBe(b.lpProceeds);
  }, 60_000);

  it("W77-M2 — the zero-ledger branch emits the SAME four fields in the SAME format", async () => {
    /* This branch was a MISSED CONSUMER of Wave 75's change: it emitted the two
       money fields and neither `*Exact` sibling, so a consumer reading the
       authoritative field got `undefined` here — and `undefined` in arithmetic is
       `NaN`, which R72 condition 1 names as worse than the residue. */
    const s = src("server/track1Routes.ts");
    const branch = s.slice(
      s.indexOf("// No ledger data — return zero proceeds with empty breakdown"),
      s.indexOf("const commonRows = readCompanyCommonRows(companyId);"),
    );
    expect(branch).toContain('lpProceeds: "0"');
    expect(branch).toContain("founderProceeds: String(exitMinor)");
    expect(branch).toContain('lpProceedsExact: "0"');
    expect(branch).toContain("founderProceedsExact: String(exitMinor)");
  });

  it("W77-M3 — NO `Number(...)` ON A MONEY STRING may come back (R72 condition 4)", () => {
    /* A SOURCE-TEXT fence on purpose. A value assertion can be satisfied by a
       fixture whose figure happens to be representable as a double — and this
       defect only shows up on figures that are not. */
    const s = code("server/track1Routes.ts");
    for (const forbidden of [
      "Number(p.total)",
      "founderProceedsExactDec.toNumber()",
      "lpProceedsExactDec.toNumber()",
      "Number(res.body.founderProceeds)",
      "founderProceeds.toFixed(2)",
      "Number(founderProceeds)",
      "Number(lpProceeds)",
    ]) {
      expect(s, `${forbidden} is back on the money path`).not.toContain(forbidden);
    }
    /* And the exact summer is still the ONE place the legs are added. */
    expect(s).toContain("const exactSum = (rows: Array<{ total: string }>): Decimal =>");
    expect(s.match(/\.toFixed\(\)/g)?.length).toBe(4);
  });

  it("W77-M4 — NO consumer of these fields is user-visible (R72 condition 5)", () => {
    /* Stated in the report and asserted here, because \"no screen renders it\" is the
       reason the owner authorised an interface change now. If a screen starts
       reading one of these fields, this fails and the display-rounding convention
       has to be decided before it ships. */
    const clientDir = path.join(ROOT, "client/src");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        const t = fs.readFileSync(p, "utf8");
        if (t.includes("founderProceeds") || t.includes("lpProceeds")) hits.push(p);
      }
    };
    walk(clientDir);
    expect(hits).toEqual([]);
  });
});
