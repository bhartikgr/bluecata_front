/**
 * WAVE 68 — MIGRATION 0192: THE DATABASE-LEVEL TERM FENCE, PROVED BY EXECUTION.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES
 * ═══════════════════════════════════════════════════════════════════════════
 *   · The composed NUMERIC-TEXT test from WAVE68_MIGRATION_0192_SPEC §3 gives
 *     the spec's expected verdict on all 23 of the spec's inputs, ON THIS
 *     SQLITE, and refuses twelve further inputs the spec's own nine clauses
 *     accept as numbers.
 *   · `captable_commits.discount_pct` now REFUSES `'abc'` and `'20abc'` — the
 *     C-3 defect, which 0190 ACCEPTED because `CAST('abc' AS REAL)` is `0.0`.
 *   · `rounds.extras_json` has a fence AT ALL (C-2): six numeric terms, both
 *     poles each, plus `'abc'`, `'2026-07-07'` and the live `20260707`.
 *   · THE R41 REGRESSION: a row carrying a PRE-EXISTING invalid term stays
 *     writable, so it stays repairable. This is the assertion that decides
 *     whether 0192 may ship; if it fails, the migration has recreated the 0153
 *     trap in which live already holds a row its own trigger would refuse.
 *   · The migration leaves NO diagnostic table behind and is idempotent.
 *
 * NOT PROVED HERE
 *   · Nothing is proved against the LIVE database. The 112 rounds and the
 *     committed row `ccm_47f69199e7396a97` are cited from R39/R41, not queried.
 *   · No browser is opened.
 *
 * The full mutation transcript, including the 23-case numeric table, is in
 * `build_log/wave68/W68_TESTS.md`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { rawDb, getDb } from "../db/connection";
import {
  applyWave68TermFences,
  WAVE68_TRIGGERS,
  hasNumericTextTest,
  readWave68TermFenceDdl,
  __resetWave68FenceMemoForTests,
} from "../lib/applyWave68TermFences";
/* WAVE 68b · the application validators, imported so the DB fence and the
   application fence are compared BY EXECUTION rather than by reading two
   tables of numbers. */
import {
  validateDiscountPercentAsWritten,
  validateInterestRatePercentAsWritten,
  validateValuationCap,
} from "../../shared/roundMathEngineAdapter";

/* Source reads are anchored to THIS FILE, never to `process.cwd()` — Wave 58b's
   review recorded ten checks failing in a rerun purely because they resolved
   sources from the launch directory. */
const ROOT = path.resolve(__dirname, "..", "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const MIG = "migrations/0192_wave68_term_domain_fences.sql";
let db: any;

/* ── WAVE 78 · RAISE-ARGUMENT EXTRACTION ───────────────────────────────────
   Pull the SECOND argument out of every `RAISE( ... )`, string-literal aware and
   paren-balanced, so "is it a single string literal?" can be asked structurally
   instead of by grepping for `||`. A `RAISE(` that occurs INSIDE a quoted string
   (0192's own postconditions contain one, in a LIKE pattern) is skipped. */
export function extractRaiseArgs(sql: string): string[] {
  const mask = (() => {
    const out = sql.split("");
    let i = 0;
    const n = sql.length;
    while (i < n) {
      if (sql[i] === "'") {
        let j = i + 1;
        while (j < n) {
          if (sql[j] === "'") {
            if (sql[j + 1] === "'") { out[j] = "x"; out[j + 1] = "x"; j += 2; continue; }
            break;
          }
          if (out[j] !== "\n") out[j] = "x";
          j++;
        }
        i = j + 1; continue;
      }
      i++;
    }
    return out.join("");
  })();
  const args: string[] = [];
  const re = /\bRAISE\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mask)) !== null) {
    let depth = 0, i = m.index + m[0].length - 1, close = -1;
    while (i < sql.length) {
      const c = sql[i];
      if (c === "'") {
        i++;
        while (i < sql.length) {
          if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } break; }
          i++;
        }
      } else if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) { close = i; break; } }
      i++;
    }
    if (close < 0) continue;
    const inner = sql.slice(m.index + m[0].length, close);
    /* split on the FIRST top-level comma */
    let d = 0, k = -1;
    for (let p = 0; p < inner.length; p++) {
      const c = inner[p];
      if (c === "'") {
        p++;
        while (p < inner.length) {
          if (inner[p] === "'") { if (inner[p + 1] === "'") { p += 2; continue; } break; }
          p++;
        }
      } else if (c === "(") d++;
      else if (c === ")") d--;
      else if (c === "," && d === 0) { k = p; break; }
    }
    if (k < 0) continue; // RAISE(IGNORE)
    args.push(inner.slice(k + 1));
  }
  return args;
}

/** Insert a probe round, then remove it. Returns the abort message or null. */
function probeRoundInsert(extrasJson: string | null): string | null {
  const id = `rnd_w68t_${Math.random().toString(36).slice(2, 10)}`;
  const info = db.prepare("PRAGMA table_info(rounds)").all() as Array<{
    name: string; type: string; notnull: number; dflt_value: unknown;
  }>;
  const required = info.filter((c) => c.notnull && c.dflt_value === null && c.name !== "id");
  const cols = ["id", "extras_json"];
  const vals: unknown[] = [id, extrasJson];
  for (const c of required) {
    if (cols.includes(c.name)) continue;
    cols.push(c.name);
    vals.push(/INT|REAL|NUM/i.test(c.type) ? 0 : "w68");
  }
  try {
    db.prepare(
      `INSERT INTO rounds (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    ).run(...vals);
    db.prepare("DELETE FROM rounds WHERE id=?").run(id);
    return null;
  } catch (e) {
    return String((e as Error).message);
  }
}

/** Seed a round whose extras are written with the INSERT fence detached —
 *  exactly how 0153's rows came to predate 0153's triggers. Used by the WAVE 68b
 *  R41 regression block, which must be able to seed a MALFORMED blob that the
 *  fence now refuses on a new write. */
function seedRound(id: string, extras: string | null): void {
  const insSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE name='trg_rounds_extras_terms_ins'",
  ).get().sql as string;
  db.exec("DROP TRIGGER trg_rounds_extras_terms_ins");
  try {
    const info = db.prepare("PRAGMA table_info(rounds)").all() as Array<any>;
    const required = info.filter(
      (c) => c.notnull && c.dflt_value === null && c.name !== "id" && c.name !== "extras_json",
    );
    const cols = ["id", "extras_json", ...required.map((c) => c.name)];
    const vals: unknown[] = [id, extras, ...required.map((c) => (/INT|REAL|NUM/i.test(c.type) ? 0 : "w68"))];
    db.prepare(
      `INSERT INTO rounds (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    ).run(...vals);
  } finally {
    db.exec(insSql); // the fence is ALWAYS put back, even if the seed threw
  }
}

/** Insert a probe commit with the given `discount_pct`, then remove it. */
function probeCommitInsert(discountPct: string | null): string | null {
  const id = `ccm_w68t_${Math.random().toString(36).slice(2, 10)}`;
  try {
    db.prepare(
      `INSERT INTO captable_commits
        (id,tenant_id,seq,ts,invitation_id,round_id,company_id,investor_id,amount,currency,shares,state,prev_hash,hash,discount_pct)
        VALUES (?,'t_w68t',9901,'2026-08-18T00:00:00Z','inv_w68t','rnd_w68t','co_w68t','ivr_w68t','1000','USD','10','committed','p','h',?)`,
    ).run(id, discountPct);
    db.prepare("DELETE FROM captable_commits WHERE id=?").run(id);
    return null;
  } catch (e) {
    return String((e as Error).message);
  }
}

beforeAll(() => {
  getDb();
  db = rawDb();
  __resetWave68FenceMemoForTests(db);
  const r = applyWave68TermFences(db);
  /* Fail LOUD rather than vacuously: a suite that silently ran without the
     fences installed would report every refusal test as a pass-by-absence. */
  expect(r.triggersUnfixed, `installer reported: ${JSON.stringify(r)}`).toEqual([]);
}, 60_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-A — THE FILE ITSELF
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-A — migration 0192 exists, is mirrored, and touches no row", () => {
  it("W68-A1 — 0192 exists and is byte-identical to its server/db/migrations mirror", () => {
    const canon = src(MIG);
    const mirror = src(`server/db/migrations/${path.basename(MIG)}`);
    expect(canon).toBe(mirror);
  });

  it("W68-A2 — 0192 contains NO row-mutating statement (R17: no UPDATE, DELETE or backfill)", () => {
    /* Comments are stripped first so the header's PROSE about not rewriting rows
       cannot be mistaken for a statement — reading the code, not the comment. */
    const bare = src(MIG).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
    expect(bare).not.toMatch(/\bUPDATE\s+rounds\b/i);
    expect(bare).not.toMatch(/\bUPDATE\s+captable_commits\b/i);
    expect(bare).not.toMatch(/\bDELETE\s+FROM\s+rounds\b/i);
    expect(bare).not.toMatch(/\bDELETE\s+FROM\s+captable_commits\b/i);
    expect(bare).not.toMatch(/\bINSERT\s+INTO\s+rounds\b/i);
    expect(bare).not.toMatch(/\bINSERT\s+INTO\s+captable_commits\b/i);
  });

  it("W68-A3 — 0192 self-verifies with the 0191 CHECK (ok = 1) pattern and leaves no table behind", () => {
    const sql = src(MIG);
    expect(sql).toContain("ok INTEGER NOT NULL CHECK (ok = 1)");
    expect(sql).toContain("DROP TABLE w68_postcondition;");
    expect(sql).toContain("DROP TABLE w68_before;");
    /* And the scratch tables really are gone from the live test database. */
    for (const t of ["w68_postcondition", "w68_before"]) {
      expect(
        db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(t).c,
      ).toBe(0);
    }
  });

  it("W68-A4 — R56's date-shaped WARNING is NOT in the migration (a trigger cannot warn)", () => {
    const sql = src(MIG);
    expect(sql).not.toContain("looks like a date");
    expect(sql).not.toContain("dateShapedValueWarning");
  });

  it("W68-A5 — 0192 does NOT fence optionPoolPostPercent (R27/R16: percent-as-written)", () => {
    /* The name appears in 0192 exactly ONCE outside comments, inside the
       postcondition that asserts NO trigger fences it. So the assertion is made
       against the DATABASE, and against the trigger bodies, not against a grep
       of the file. */
    for (const t of WAVE68_TRIGGERS) {
      const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t).sql);
      expect(sql).not.toContain("optionPoolPostPercent");
      expect(sql).not.toContain("optionPoolMode");
      expect(sql).not.toContain("maturityDate");
      expect(sql).not.toContain("expiryDate");
    }
    expect(
      db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND sql LIKE '%optionPoolPostPercent%'").get().c,
    ).toBe(0);
  });

  it("W68-A6 — the header never writes the two words the Wave 0 lint pre-transform eats", () => {
    /* server/__tests__/_wave0_ast_lint.ts:248 rewrites that phrase to "SELECT 1"
       up to the next semicolon and is COMMENT-BLIND. Wave 58f lost two suites to
       it. The only occurrences in 0192 must be REAL statements at column 0. */
    const sql = src(MIG);
    const lines = sql.split("\n");
    const offenders = lines.filter(
      (l) => /DROP\s+TRIGGER/i.test(l) && !/^DROP TRIGGER IF EXISTS \w+;$/.test(l.trim()),
    );
    expect(offenders).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-B — EXACTLY FOUR TRIGGERS, TWO PAIRS, NO THIRD PAIR
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-B — the installed shape", () => {
  it("W68-B1 — all four triggers are installed and all four carry the numeric-text test", () => {
    for (const t of WAVE68_TRIGGERS) {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(t);
      expect(row, `${t} is absent`).toBeTruthy();
      /* Asserted against the STORED SQL directly, NOT via the helper — a helper
         that always returned true would otherwise vouch for itself. `stray` is
         the derived column holding the value with every character a number may
         contain removed; it is the clause that closes C-3. */
      expect(String(row.sql), `${t} has no numeric-text test`).toContain("AS stray");
      expect(String(row.sql), `${t} does not strip digits`).toContain("replace(replace(");
      expect(hasNumericTextTest(row.sql), `${t} has no numeric-text test`).toBe(true);
    }
    /* And the helper itself really discriminates, so W68-H1's reliance on it is
       not vacuous either. */
    expect(hasNumericTextTest(null)).toBe(false);
    expect(hasNumericTextTest("CREATE TRIGGER t BEGIN SELECT 1; END")).toBe(false);
  });

  it("W68-B2 — EXACTLY TWO triggers name extras_json (not a third pair) and exactly two guard discount_pct", () => {
    expect(
      db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND sql LIKE '%extras_json%'").get().c,
    ).toBe(2);
    expect(
      db
        .prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_captable_commits_discount_pct%'")
        .get().c,
    ).toBe(2);
  });

  it("W68-B3 — the 58f installer's isCorrectedDomain() string test still recognises the replaced pair", () => {
    /* A HIDDEN COUPLING, and the first draft of 0192 broke it.
       `server/lib/applyWave58fDiscountDomain.ts` decides whether the installed
       fence is the corrected one by looking for the LITERAL `AS REAL) >= 100`.
       Aliasing the cast made that text vanish and the STRONGER fence would have
       been reported as "old_fraction_domain_still_present" for ever. */
    for (const t of ["trg_captable_commits_discount_pct_ins", "trg_captable_commits_discount_pct_upd"]) {
      const flat = String(
        db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t).sql,
      ).replace(/\s+/g, " ");
      expect(flat).toContain("AS REAL) >= 100");
      expect(flat).not.toContain("AS REAL) > 1");
    }
  });

  it("W68-B4 — the UPDATE trigger validates CHANGES, not STATE (R41), with IS NOT and not <>", () => {
    const sql = String(
      db.prepare("SELECT sql FROM sqlite_master WHERE name='trg_rounds_extras_terms_upd'").get().sql,
    );
    expect(sql).toContain("IS NOT ov");
    /* Six fields, six change guards. A future editor who deletes one loses the
       R41 protection for exactly that field and nothing else would notice. */
    expect(sql.match(/IS NOT ov/g)?.length).toBe(6);
    expect(sql).not.toMatch(/nv\s*<>\s*ov/);
  });

  it("W68-B5 — the installer reads the DDL from the migration file, so the two cannot drift", () => {
    expect(readWave68TermFenceDdl()).toBe(src(MIG));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-C — THE NUMERIC-TEXT TEST, EXECUTED ON THIS SQLITE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-C — the composed numeric-text test, executed (spec §3)", () => {
  /* The spec's own expression, quoted, so this test measures SQLITE and not the
     migration's copy of it. */
  const SPEC = `
    CASE
      WHEN x = ''                                            THEN 1
      WHEN x GLOB '*[^0-9.eE+-]*'                            THEN 1
      WHEN length(x) - length(replace(x,'.',''))     > 1     THEN 1
      WHEN length(x) - length(replace(x,'-',''))     > 1     THEN 1
      WHEN length(x) - length(replace(x,'+',''))     > 1     THEN 1
      WHEN instr(x,'-') > 1
       AND upper(substr(x, instr(x,'-')-1, 1)) <> 'E'        THEN 1
      WHEN length(x) - length(replace(upper(x),'E','')) > 1  THEN 1
      WHEN upper(x) GLOB '*E'                                THEN 1
      ELSE 0
    END`;

  /** The 23 spec cases: 21 named verbatim in the spec, plus '' and '20260707'. */
  const CASES: Array<[string, 0 | 1]> = [
    ["abc", 1], ["20abc", 1], ["2026-07-07", 1], ["1.2.3", 1], ["--5", 1],
    ["1e", 1], ["20%", 1], ["20 dollars", 1], ["NaN", 1], ["", 1],
    ["0", 0], ["0.0", 0], [".0", 0], ["0.", 0], ["12.", 0],
    ["20", 0], ["-5", 0], ["+5", 0], ["1e3", 0], ["1e-3", 0],
    ["-1.5", 0], ["  20  ", 0], ["20260707", 0],
  ];

  const evalSpec = (v: string): number =>
    db.prepare(`SELECT (${SPEC.replace(/\bx\b/g, "TRIM(@v)")}) AS bad`).get({ v }).bad;

  it("W68-C1 — the spec's expression gives the spec's verdict on all 23 inputs, on THIS sqlite", () => {
    const mismatches = CASES.filter(([v, exp]) => evalSpec(v) !== exp).map(([v]) => v);
    expect(mismatches).toEqual([]);
  });

  it("W68-C2 — SQLite really does CAST non-numbers to numbers (the C-3 root cause)", () => {
    const cast = (v: string) => db.prepare("SELECT CAST(? AS REAL) r").get(v).r;
    expect(cast("abc")).toBe(0);          // neither < 0 nor >= 100 → 0190 PASSED it
    expect(cast("20abc")).toBe(20);       // the leading numeric prefix
    expect(cast("2026-07-07")).toBe(2026); // a date becoming a valuation
  });

  it("W68-C3 — the migration's HARDENED test refuses twelve inputs the spec's nine clauses accept", () => {
    /* Named individually so a future reader can see exactly what the four added
       clauses buy. Every one of these CASTs to a number in SQLite. */
    const ADVERSARIAL = ["1+2", "E5", ".", "+", "-", ".e3", "1e-", "1e+", "5-", "5+", "1e1.5", "+."];
    /* ELEVEN of the twelve are ACCEPTED as numbers by the spec's nine clauses.
       The twelfth, '5-', the spec already catches (its trailing '-' is not
       preceded by an 'E'). Measured, and split by name rather than asserted in
       aggregate, because "11 of 12" is the kind of number that drifts. */
    const SPEC_ACCEPTS = ["1+2", "E5", ".", "+", "-", ".e3", "1e-", "1e+", "5+", "1e1.5", "+."];
    const SPEC_REFUSES = ["5-"];
    expect([...SPEC_ACCEPTS, ...SPEC_REFUSES].sort()).toEqual([...ADVERSARIAL].sort());
    for (const v of SPEC_ACCEPTS) expect(evalSpec(v), `spec now refuses ${v}`).toBe(0);
    for (const v of SPEC_REFUSES) expect(evalSpec(v), `spec now accepts ${v}`).toBe(1);
    /* And the INSTALLED fence refuses all twelve, through the real trigger. */
    for (const v of ADVERSARIAL) {
      const err = probeRoundInsert(JSON.stringify({ discount: v }));
      expect(err, `discount=${JSON.stringify(v)} was ACCEPTED`).toContain("ROUND_TERM_DISCOUNT_REFUSED");
    }
  });

  it("W68-C4 — and it still accepts every legitimate number form", () => {
    /* Probed through `valuationCap`, whose domain (0, 1e12] admits every one of
       these magnitudes, so a refusal here can only be the TEXT test and never
       the range. Exponent, sign and leading-dot forms all round-trip. */
    for (const v of ["1E3", "1E+3", "+1.5e-9", "0.0000001", "99.999", ".5", "1e3"]) {
      const err = probeRoundInsert(`{"valuationCap":"${v}"}`);
      expect(err, `valuationCap="${v}" was refused: ${err}`).toBeNull();
    }
    /* A negative is refused by the RANGE, not by the text test — named so the
       two reasons are never confused. */
    expect(probeRoundInsert('{"valuationCap":"-0.001"}')).toContain("ROUND_TERM_VALUATION_CAP_REFUSED");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-D — C-3: `captable_commits.discount_pct`
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-D — the discount_pct fence, both poles and the text hole", () => {
  const ACCEPT = ["20", "0", "99.999"];
  const REFUSE = ["100", "-0.1", "", "abc", "20abc", "2026-07-07", "20260707"];

  it.each(ACCEPT)("W68-D1 — discount_pct %s is ACCEPTED (percent-as-written, R30)", (v) => {
    expect(probeCommitInsert(v)).toBeNull();
  });

  it.each(REFUSE)("W68-D2 — discount_pct %s is REFUSED BY NAME", (v) => {
    const err = probeCommitInsert(v);
    expect(err, `${JSON.stringify(v)} was accepted`).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
  });

  it("W68-D4 — the twelve adversarial inputs are refused on discount_pct too", () => {
    /* The SAME rule is generated into all four triggers, but "the same rule" is
       a claim about a generator. This exercises it on the OTHER column, so a
       clause dropped from one copy cannot hide behind the other. */
    for (const v of ["1+2", "E5", ".", "+", "-", ".e3", "1e-", "1e+", "5-", "5+", "1e1.5", "+."]) {
      expect(probeCommitInsert(v), `discount_pct=${JSON.stringify(v)} was accepted`)
        .toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    }
    /* and the legitimate exponent forms are still accepted on that column */
    for (const v of ["1e1", "1E1", "0.5", "+5", "-0"]) {
      expect(probeCommitInsert(v), `discount_pct=${JSON.stringify(v)} was refused`).toBeNull();
    }
  });

  it("W68-D3 — 'abc' and '20abc' are the C-3 hole, and 0190's range test alone cannot close them", () => {
    /* The point of the wave in one assertion: 0190's exact predicate, evaluated
       here, is FALSE for both — i.e. it would have let both through. */
    for (const v of ["abc", "20abc"]) {
      const old = db
        .prepare("SELECT (CAST(? AS REAL) < 0 OR CAST(? AS REAL) >= 100) AS blocked")
        .get(v, v).blocked;
      expect(old, `0190 would have blocked ${v}`).toBe(0);
      expect(probeCommitInsert(v)).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-E — C-2: `rounds.extras_json`, every domain, both poles
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-E — the extras_json fence: every fenced field, both poles", () => {
  const CODE: Record<string, string> = {
    discount: "ROUND_TERM_DISCOUNT_REFUSED",
    interestRate: "ROUND_TERM_INTEREST_RATE_REFUSED",
    valuationCap: "ROUND_TERM_VALUATION_CAP_REFUSED",
    strikePrice: "ROUND_TERM_STRIKE_PRICE_REFUSED",
    maturityMonths: "ROUND_TERM_MATURITY_MONTHS_REFUSED",
    expiryYears: "ROUND_TERM_EXPIRY_YEARS_REFUSED",
  };
  /* Domains are the SAME as Wave 61b's application layer so the two cannot
     disagree. `interestRate` is [0, 100] INCLUSIVE, matching
     INTEREST_RATE_PERCENT_MAX and its `d.gt(max)` test — the spec's table says
     `[0, 100)`, and the application layer is the authority here. */
  const POLES: Record<string, { in: string[]; out: string[] }> = {
    discount: { in: ["0", "99.999"], out: ["100", "-0.1"] },
    interestRate: { in: ["0", "100"], out: ["100.1", "-1"] },
    valuationCap: { in: ["1", "1000000000000"], out: ["1000000000001", "0"] },
    strikePrice: { in: ["0.001", "1000000000"], out: ["1000000001", "0"] },
    maturityMonths: { in: ["0", "600"], out: ["601", "-1"] },
    expiryYears: { in: ["0", "50"], out: ["51", "-1"] },
  };

  for (const key of Object.keys(POLES)) {
    it(`W68-E1.${key} — valid values ACCEPTED at both ends of the domain`, () => {
      for (const v of POLES[key].in) {
        expect(probeRoundInsert(`{"${key}":${v}}`), `${key}=${v} refused`).toBeNull();
      }
    });
    it(`W68-E2.${key} — out-of-range values REFUSED BY NAME at both ends`, () => {
      for (const v of POLES[key].out) {
        expect(probeRoundInsert(`{"${key}":${v}}`), `${key}=${v} accepted`).toContain(CODE[key]);
      }
    });
    it(`W68-E3.${key} — 'abc' and '2026-07-07' REFUSED BY NAME`, () => {
      for (const v of ["abc", "2026-07-07"]) {
        expect(probeRoundInsert(`{"${key}":"${v}"}`), `${key}="${v}" accepted`).toContain(CODE[key]);
      }
    });
    it(`W68-E4.${key} — ABSENT stays absent: null and "" are never refused and never coerced`, () => {
      expect(probeRoundInsert(`{"${key}":null}`)).toBeNull();
      expect(probeRoundInsert(`{"${key}":""}`)).toBeNull();
      expect(probeRoundInsert("{}")).toBeNull();
    });
  }

  it("W68-E5 — WAVE 68b: a NEW malformed extras_json blob is REFUSED BY NAME (B2)", () => {
    /* THIS ASSERTION USED TO SAY THE OPPOSITE. Wave 68 recorded "a malformed
       blob is not validated" as a stated limit; all three reviews called it a
       defect and the adjudication made it a shipping blocker. Both triggers
       began `WHEN ... json_valid(NEW.extras_json)`, so every malformed blob was
       silently accepted on INSERT and a row could be changed from one malformed
       blob to another.
       `json_extract` really does RAISE on malformed JSON — that part was true —
       so every read in 0192 now goes through
       `iif(json_valid(...), ..., '{}')` and the refusal is OURS, by name,
       instead of a raw parser error. R41 grandfathering is asserted in W68-G6. */
    for (const blob of ["not json at all", '{"discount":', "[unterminated", "{,}"]) {
      const err = probeRoundInsert(blob);
      expect(err, `malformed blob ${JSON.stringify(blob)} was ACCEPTED`).toContain(
        "ROUND_EXTRAS_JSON_INVALID",
      );
      /* WAVE 78: the refusal no longer quotes the blob it received. It CANNOT —
         see W78-A. The static half still names the column, the rule and why a
         malformed blob can only come from a raw SQL write. */
      expect(err).toContain("rounds.extras_json must be valid JSON");
      expect(err).not.toContain("Capavate received");
    }
    /* NULL and the empty string keep the established ABSENT convention. */
    expect(probeRoundInsert(null)).toBeNull();
    expect(probeRoundInsert("")).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-F — THE LIVE DEFECT VALUE, AND WHAT A MAGNITUDE FENCE CANNOT DO
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-F — 20260707, the value that corrupted rnd_64e9d6ad728a", () => {
  it("W68-F1 — discount: 20260707 is REFUSED BY NAME on INSERT and on UPDATE", () => {
    expect(probeRoundInsert('{"discount":20260707}')).toContain("ROUND_TERM_DISCOUNT_REFUSED");
    const id = `rnd_w68f_${Math.random().toString(36).slice(2, 8)}`;
    const info = db.prepare("PRAGMA table_info(rounds)").all() as Array<any>;
    const required = info.filter((c) => c.notnull && c.dflt_value === null && c.name !== "id");
    const cols = ["id", "extras_json", ...required.filter((c) => c.name !== "extras_json").map((c) => c.name)];
    const vals: unknown[] = [id, '{"discount":20}', ...required.filter((c) => c.name !== "extras_json").map((c) => (/INT|REAL|NUM/i.test(c.type) ? 0 : "w68"))];
    db.prepare(`INSERT INTO rounds (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
    let err: string | null = null;
    try {
      db.prepare("UPDATE rounds SET extras_json=? WHERE id=?").run('{"discount":20260707}', id);
    } catch (e) { err = String((e as Error).message); }
    db.prepare("DELETE FROM rounds WHERE id=?").run(id);
    expect(err).toContain("ROUND_TERM_DISCOUNT_REFUSED");
  });

  it("W68-F2 — maturityMonths and expiryYears STILL refuse it by range (R56: do not soften a working fence)", () => {
    expect(probeRoundInsert('{"maturityMonths":20260707}')).toContain("ROUND_TERM_MATURITY_MONTHS_REFUSED");
    expect(probeRoundInsert('{"expiryYears":20260707}')).toContain("ROUND_TERM_EXPIRY_YEARS_REFUSED");
  });

  it("W68-F3 — valuationCap and strikePrice ACCEPT it, and that is R55 stated rather than papered over", () => {
    /* 20260707 is a legitimate 20,260,707 cap. No magnitude ceiling can tell it
       from a date, so the DATABASE accepts it and the APPLICATION warns (R56).
       If this assertion ever flips to a refusal, R56 has been contradicted. */
    expect(probeRoundInsert('{"valuationCap":20260707}')).toBeNull();
    expect(probeRoundInsert('{"strikePrice":20260707}')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-G — THE R41 REGRESSION TEST. THE ONE THAT DECIDES WHETHER THIS SHIPS.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-G — R41: pre-existing bad data must never block an unrelated write", () => {
  /** Seed a row whose extras ALREADY hold invalid terms, with the INSERT fence
   *  detached — exactly how 0153's rows came to predate 0153's triggers. */
  function seedPreExistingBadRow(id: string, extras: string): void {
    const insSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='trg_rounds_extras_terms_ins'").get().sql;
    db.exec("DROP TRIGGER trg_rounds_extras_terms_ins");
    try {
      const info = db.prepare("PRAGMA table_info(rounds)").all() as Array<any>;
      const required = info.filter((c) => c.notnull && c.dflt_value === null && c.name !== "id" && c.name !== "extras_json");
      const cols = ["id", "extras_json", ...required.map((c) => c.name)];
      const vals: unknown[] = [id, extras, ...required.map((c) => (/INT|REAL|NUM/i.test(c.type) ? 0 : "w68"))];
      db.prepare(`INSERT INTO rounds (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...vals);
    } finally {
      db.exec(insSql); // the fence is ALWAYS put back, even if the seed threw
    }
  }

  const BAD = '{"discount":20260707,"valuationCap":-5,"maturityMonths":99999,"name":"pre-existing bad row"}';

  it("W68-G1 — updating an UNRELATED COLUMN on a row with pre-existing bad terms SUCCEEDS", () => {
    const id = `rnd_w68g1_${Math.random().toString(36).slice(2, 8)}`;
    seedPreExistingBadRow(id, BAD);
    try {
      expect(() => db.prepare("UPDATE rounds SET name='renamed' WHERE id=?").run(id)).not.toThrow();
    } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
  });

  it("W68-G2 — rewriting extras_json WITHOUT changing a fenced field SUCCEEDS", () => {
    const id = `rnd_w68g2_${Math.random().toString(36).slice(2, 8)}`;
    seedPreExistingBadRow(id, BAD);
    try {
      const next = '{"discount":20260707,"valuationCap":-5,"maturityMonths":99999,"name":"pre-existing bad row","mfn":true}';
      expect(() => db.prepare("UPDATE rounds SET extras_json=? WHERE id=?").run(next, id)).not.toThrow();
    } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
  });

  it("W68-G3 — the bad row is REPAIRABLE: 20260707 -> 20 SUCCEEDS", () => {
    const id = `rnd_w68g3_${Math.random().toString(36).slice(2, 8)}`;
    seedPreExistingBadRow(id, BAD);
    try {
      const fixed = '{"discount":20,"valuationCap":-5,"maturityMonths":99999,"name":"pre-existing bad row"}';
      expect(() => db.prepare("UPDATE rounds SET extras_json=? WHERE id=?").run(fixed, id)).not.toThrow();
      expect(JSON.parse(db.prepare("SELECT extras_json e FROM rounds WHERE id=?").get(id).e).discount).toBe(20);
    } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
  });

  it("W68-G4 — but a NEW invalid write on that SAME row is STILL refused (the fence is not disabled)", () => {
    const id = `rnd_w68g4_${Math.random().toString(36).slice(2, 8)}`;
    seedPreExistingBadRow(id, BAD);
    try {
      const worse = '{"discount":20260707,"valuationCap":-5,"maturityMonths":99999,"expiryYears":20260707}';
      let err: string | null = null;
      try { db.prepare("UPDATE rounds SET extras_json=? WHERE id=?").run(worse, id); }
      catch (e) { err = String((e as Error).message); }
      expect(err).toContain("ROUND_TERM_EXPIRY_YEARS_REFUSED");
    } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
  });

  it("W68-G5 — the discount_pct twin: an unrelated UPDATE and a no-change write both SUCCEED", () => {
    /* R41's live subject is `ccm_47f69199e7396a97`. This is its shape: a
       committed row whose `discount_pct` 0190 accepted and 0192 would not. */
    const id = `ccm_w68g5_${Math.random().toString(36).slice(2, 8)}`;
    const insSql = db.prepare("SELECT sql FROM sqlite_master WHERE name='trg_captable_commits_discount_pct_ins'").get().sql;
    db.exec("DROP TRIGGER trg_captable_commits_discount_pct_ins");
    try {
      db.prepare(
        `INSERT INTO captable_commits
          (id,tenant_id,seq,ts,invitation_id,round_id,company_id,investor_id,amount,currency,shares,state,prev_hash,hash,discount_pct)
          VALUES (?,'t_w68g5',9902,'2026-08-18T00:00:00Z','inv','rnd','co','ivr','1000','USD','10','committed','p','h','abc')`,
      ).run(id);
    } finally { db.exec(insSql); }
    try {
      expect(() => db.prepare("UPDATE captable_commits SET reconcile_ref='x' WHERE id=?").run(id)).not.toThrow();
      expect(() => db.prepare("UPDATE captable_commits SET discount_pct=discount_pct WHERE id=?").run(id)).not.toThrow();
      expect(() => db.prepare("UPDATE captable_commits SET discount_pct='20' WHERE id=?").run(id)).not.toThrow();
      let err: string | null = null;
      try { db.prepare("UPDATE captable_commits SET discount_pct='xyz' WHERE id=?").run(id); }
      catch (e) { err = String((e as Error).message); }
      expect(err).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    } finally { db.prepare("DELETE FROM captable_commits WHERE id=?").run(id); }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68-H — IDEMPOTENCE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68-H — 0192 re-applies cleanly", () => {
  it("W68-H1 — running the installer twice is a no-op in effect and leaves the four fences in place", () => {
    __resetWave68FenceMemoForTests(db);
    const r = applyWave68TermFences(db);
    expect(r.triggersUnfixed).toEqual([]);
    expect(r.triggersFenced.length).toBe(4);
    expect(probeCommitInsert("abc")).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * W68B — THE FOUR BLOCKERS THE TRIPLE REVIEW FOUND IN THE FIRST DRAFT OF 0192.
 *
 * 0192 had NOT shipped; it existed only in the tree. Each of these tests fails
 * against the pre-68b file — the executed before/after matrix is in
 * build_log/wave68b/W68B_ADVERSARIAL_TRANSCRIPT.md (250 checks, 33 failing
 * before, 0 after).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W68B-B1 — a JSON boolean is not a number", () => {
  const CODE: Record<string, string> = {
    discount: "ROUND_TERM_DISCOUNT_REFUSED",
    interestRate: "ROUND_TERM_INTEREST_RATE_REFUSED",
    valuationCap: "ROUND_TERM_VALUATION_CAP_REFUSED",
    strikePrice: "ROUND_TERM_STRIKE_PRICE_REFUSED",
    maturityMonths: "ROUND_TERM_MATURITY_MONTHS_REFUSED",
    expiryYears: "ROUND_TERM_EXPIRY_YEARS_REFUSED",
  };

  it("W68B-B1a — SQLite really does coerce a JSON boolean to an integer (the root cause)", () => {
    /* This is why no character-grammar test could ever have caught it: the
       coercion happens BEFORE any character is examined. */
    expect(db.prepare(`SELECT json_extract('{"d":true}','$.d') v`).get().v).toBe(1);
    expect(db.prepare(`SELECT typeof(json_extract('{"d":true}','$.d')) t`).get().t).toBe("integer");
    expect(db.prepare(`SELECT json_type('{"d":true}','$.d') t`).get().t).toBe("true");
  });

  for (const key of Object.keys(CODE)) {
    it(`W68B-B1b.${key} — true, false, an object and an array are all REFUSED BY NAME`, () => {
      for (const lit of ["true", "false", '{"a":1}', "[1,2]"]) {
        const err = probeRoundInsert(`{"${key}":${lit}}`);
        expect(err, `${key}=${lit} was ACCEPTED`).toContain(CODE[key]);
      }
    });
    it(`W68B-B1c.${key} — ABSENT is still absent: null, "" and a missing key are never refused`, () => {
      expect(probeRoundInsert(`{"${key}":null}`)).toBeNull();
      expect(probeRoundInsert(`{"${key}":""}`)).toBeNull();
      expect(probeRoundInsert("{}")).toBeNull();
    });
  }

  it("W68B-B1d — on UPDATE, true -> 1 is seen as a CHANGE (json_extract makes both integer 1)", () => {
    /* Review 1 §1.3: a value-only comparison cannot see this edit, because
       json_extract maps `true` to the integer 1. The change guard compares the
       json TYPE as well. */
    expect(
      db.prepare(`SELECT (json_extract('{"d":true}','$.d') IS json_extract('{"d":1}','$.d')) same`).get().same,
    ).toBe(1);
    const id = `rnd_w68b1d_${Math.random().toString(36).slice(2, 8)}`;
    seedRound(id, '{"discount":20}');
    try {
      let err: string | null = null;
      try { db.prepare("UPDATE rounds SET extras_json=? WHERE id=?").run('{"discount":true}', id); }
      catch (e) { err = String((e as Error).message); }
      expect(err, "discount 20 -> true was ACCEPTED").toContain("ROUND_TERM_DISCOUNT_REFUSED");
    } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
  });

  it("W68B-B1e — the discount_pct column refuses a BLOB storage class", () => {
    const id = `ccm_w68b1e_${Math.random().toString(36).slice(2, 8)}`;
    let err: string | null = null;
    try {
      db.prepare(
        `INSERT INTO captable_commits
          (id,tenant_id,seq,ts,invitation_id,round_id,company_id,investor_id,amount,currency,shares,state,prev_hash,hash,discount_pct)
          VALUES (?,'t_w68b',9911,'2026-08-18T00:00:00Z','inv','rnd','co','ivr','1000','USD','10','committed','p','h',x'3230')`,
      ).run(id);
    } catch (e) { err = String((e as Error).message); }
    db.prepare("DELETE FROM captable_commits WHERE id=?").run(id);
    expect(err, "a BLOB discount_pct was accepted").toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
  });
});

describe("W68B-B2 — the fence is not evadable, and R41 still holds", () => {
  it("W68B-B2a — the INSERT trigger is no longer gated on json_valid", () => {
    const sql = String(
      db.prepare("SELECT sql FROM sqlite_master WHERE name='trg_rounds_extras_terms_ins'").get().sql,
    );
    expect(sql).toContain("ROUND_EXTRAS_JSON_INVALID");
    expect(sql.replace(/\s+/g, " ")).not.toContain(
      "WHEN NEW.extras_json IS NOT NULL AND json_valid(NEW.extras_json)",
    );
  });

  it("W68B-B2b — valid -> malformed and malformed -> other-malformed are both REFUSED", () => {
    for (const [start, next] of [
      ['{"discount":20}', "not json"],
      ['{"discount":', "{oops"],
    ]) {
      const id = `rnd_w68b2b_${Math.random().toString(36).slice(2, 8)}`;
      seedRound(id, start);
      try {
        let err: string | null = null;
        try { db.prepare("UPDATE rounds SET extras_json=? WHERE id=?").run(next, id); }
        catch (e) { err = String((e as Error).message); }
        expect(err, `${start} -> ${next} was ACCEPTED`).toContain("ROUND_EXTRAS_JSON_INVALID");
      } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
    }
  });

  it("W68B-B2c — a malformed blob may still be REPAIRED to valid JSON", () => {
    const id = `rnd_w68b2c_${Math.random().toString(36).slice(2, 8)}`;
    seedRound(id, '{"discount":');
    try {
      expect(() =>
        db.prepare("UPDATE rounds SET extras_json=? WHERE id=?").run('{"discount":20}', id),
      ).not.toThrow();
    } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
  });
});

describe("W68B-B3 — every refusal names the value it received", () => {
  it("W68B-B3a — the bundled engine ACCEPTS a dynamic RAISE, and that is exactly the trap", () => {
    /* HISTORY, KEPT BECAUSE IT IS THE WHOLE LESSON.
       Wave 68 recorded "RAISE(ABORT, ...) takes a string literal" as a SPEC
       IMPOSSIBILITY. Wave 68b called that reason FALSE, because THIS probe
       passes: better-sqlite3 bundles SQLite 3.49.2 and a built-up argument
       compiles. Wave 78 found what the probe could not see — the DEPLOY HOST's
       `sqlite3(1)` is 3.46.1, and SQLite has accepted an expression as the RAISE
       error-message only since 3.47.0 (sqlite.org/lang_createtrigger.html). So
       the app wrote triggers the host CLI could not parse, and every host
       `sqlite3 data.db ...` answered `malformed database schema`.
       THE PROBE STILL PASSES. It is retained, with this comment, so nobody
       re-runs it, sees green, and concludes the construct is safe. "The engine
       in front of me accepts it" is not the same claim as "every engine that
       will read this database accepts it". */
    db.exec("DROP TABLE IF EXISTS w68b_raise_probe");
    db.exec("CREATE TABLE w68b_raise_probe(x TEXT)");
    db.exec(
      "CREATE TRIGGER trg_w68b_raise_probe BEFORE INSERT ON w68b_raise_probe " +
        "BEGIN SELECT RAISE(ABORT, 'received=' || NEW.x); END",
    );
    let err: string | null = null;
    try { db.prepare("INSERT INTO w68b_raise_probe VALUES (?)").run("ACTUAL-VALUE"); }
    catch (e) { err = String((e as Error).message); }
    db.exec("DROP TRIGGER trg_w68b_raise_probe");
    db.exec("DROP TABLE w68b_raise_probe");
    expect(err).toContain("received=ACTUAL-VALUE");
    /* The bundled engine is NEWER than 3.47.0 — which is why the probe is green
       and why it is not evidence about the host. */
    const v = String(db.prepare("SELECT sqlite_version() v").get().v);
    const ge = (a: string, b: string) => {
      const A = a.split(".").map(Number), B = b.split(".").map(Number);
      for (let i = 0; i < 3; i++) if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0);
      return true;
    };
    expect(ge(v, "3.47.0"), `bundled SQLite is ${v}; this probe only passes at >= 3.47.0`).toBe(true);
  });

  it("W68B-B3b — WAVE 78: every RAISE argument is a SINGLE STRING LITERAL, in the file and in the DB", () => {
    /* THIS ASSERTION IS THE REVERSE OF WHAT IT SAID IN WAVE 68b. The dynamic
       tail is gone from all four triggers because the host CLI (3.46.1) cannot
       parse it and reports the whole database malformed. Proved in
       build_log/wave78/W78_HOST_CLI_PROOF.txt. */
    for (const t of WAVE68_TRIGGERS) {
      const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t).sql);
      expect(sql, `${t} still carries the dynamic tail`).not.toContain("Capavate received");
      /* Structural, not textual: pull out each RAISE( ... ) argument and require
         it to be one quoted string. */
      const args = extractRaiseArgs(sql);
      expect(args.length, `${t} has no RAISE`).toBeGreaterThan(0);
      for (const a of args) {
        expect(/^\s*'(?:[^']|'')*'\s*$/s.test(a), `${t}: non-literal RAISE argument: ${a.slice(0, 120)}`)
          .toBe(true);
      }
    }
    /* And in the migration FILE, so a future edit is caught before it is applied. */
    for (const a of extractRaiseArgs(src(MIG))) {
      expect(/^\s*'(?:[^']|'')*'\s*$/s.test(a), `0192 file: non-literal RAISE argument: ${a.slice(0, 120)}`)
        .toBe(true);
    }
  });

  it("W68B-B3b2 — WAVE 78: the STATIC half is unshortened, and the RULE is stated without its identifier", () => {
    const commitIns = String(
      db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get("trg_captable_commits_discount_pct_ins").sql,
    );
    /* Q25 — state the RULE, never its internal identifier. */
    for (const t of WAVE68_TRIGGERS) {
      const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t).sql);
      expect(sql, `${t} exposes an internal ruling identifier`).not.toMatch(/owner ruling/i);
      expect(sql, `${t} exposes a ruling id like R30/R16/R41`).not.toMatch(/\bR(?:16|30|41)\b/);
    }
    /* …and the MEANING survives verbatim. */
    expect(commitIns).toContain("PERCENT-AS-WRITTEN (percentages are stored as written, so 20 means 20%)");
    expect(commitIns).toContain("at least 0 and less than 100");
    expect(commitIns).toContain("Founder -> Rounds -> the round -> Edit terms -> Discount");
    const roundIns = String(
      db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get("trg_rounds_extras_terms_ins").sql,
    );
    expect(roundIns).toContain("PERCENT-AS-WRITTEN (percentages are stored as written, so 6 means 6% a year)");
    expect(roundIns).toContain("stays editable — only a NEW invalid blob is refused.");
  });

  it("W68B-B3b3 — WAVE 78: the received value is still reported, BY THE APPLICATION", () => {
    /* The dynamic tail is genuinely lost from the trigger. It is NOT lost from
       the layer a human sees: the HTTP 400 body quotes the value. Asserted by
       execution against the shared validators the three write routes call, so
       the report's honesty claim cannot rot. */
    const d = validateDiscountPercentAsWritten("20260707");
    expect(d.ok).toBe(false);
    expect(String(d.message)).toContain("20260707");
    const i = validateInterestRatePercentAsWritten("abc");
    expect(i.ok).toBe(false);
    expect(String(i.message)).toContain("abc");
    const v = validateValuationCap("20260707000000");
    expect(v.ok).toBe(false);
    expect(String(v.message)).toContain("Capavate received");
    expect(String(v.message)).toContain("20260707000000");
  });

  it("W68B-B3c — the message is TRUNCATED, so a 5,000-digit input cannot produce a 5,000-char abort", () => {
    const err = probeRoundInsert(JSON.stringify({ discount: "9".repeat(5000) }));
    expect(err).toContain("ROUND_TERM_DISCOUNT_REFUSED");
    expect(err!.length).toBeLessThan(1200);
  });

  it("W68B-B3d — NOT VISIBLE TO A HUMAN. Nothing in client/ renders these strings (R58)", () => {
    /* R58: a fix at the API is not a fix on the screen, and this fence is a
       layer below the API. Asserted rather than assumed, so no later report can
       describe a founder reading any of it. */
    const codes = ["ROUND_TERM_DISCOUNT_REFUSED", "DISCOUNT_PCT_OUT_OF_DOMAIN", "ROUND_EXTRAS_JSON_INVALID"];
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
      );
    const client = walk(path.join(ROOT, "client", "src")).filter((f) => /\.(ts|tsx)$/.test(f));
    for (const code of codes) {
      const hits = client.filter((f) => fs.readFileSync(f, "utf8").includes(code));
      expect(hits, `${code} is now rendered somewhere — update the report's honesty claim`).toEqual([]);
    }
  });
});

describe("W68B-B4 — the percent bounds are exact decimal, and still agree with Wave 61b", () => {
  it("W68B-B4a — 99.999999999999999 casts to EXACTLY 100.0 (the divergence, measured)", () => {
    expect(db.prepare("SELECT CAST('99.999999999999999' AS REAL) r").get().r).toBe(100);
  });

  it("W68B-B4b — Decimal.js accepts it, and so does the fence now (they agree)", () => {
    const v = validateDiscountPercentAsWritten("99.999999999999999");
    expect(v.ok, "the application validator refused it").toBe(true);
    expect(probeRoundInsert('{"discount":"99.999999999999999"}')).toBeNull();
    expect(probeCommitInsert("99.999999999999999")).toBeNull();
  });

  it("W68B-B4c — and 100, 100.000...001 and a deep-underflow negative are still REFUSED", () => {
    expect(probeRoundInsert('{"discount":"100"}')).toContain("ROUND_TERM_DISCOUNT_REFUSED");
    expect(probeRoundInsert('{"discount":"100.000000000000000001"}')).toContain("ROUND_TERM_DISCOUNT_REFUSED");
    /* 400 zeroes: CAST AS REAL is EXACTLY -0.0, so `v < 0` was FALSE and the
       first draft ACCEPTED a negative discount. Review 1's H3. */
    const deepNeg = "-0." + "0".repeat(400) + "1";
    expect(db.prepare("SELECT (CAST(? AS REAL) < 0) neg").get(deepNeg).neg).toBe(0);
    expect(probeRoundInsert(JSON.stringify({ discount: deepNeg }))).toContain("ROUND_TERM_DISCOUNT_REFUSED");
    expect(probeCommitInsert(deepNeg)).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
  });

  it("W68B-B4d — interestRate is INCLUSIVE of 100 and exact just above it", () => {
    expect(validateInterestRatePercentAsWritten("100").ok).toBe(true);
    expect(probeRoundInsert('{"interestRate":"100"}')).toBeNull();
    expect(probeRoundInsert('{"interestRate":"100.0"}')).toBeNull();
    expect(validateInterestRatePercentAsWritten("100.000000000000000001").ok).toBe(false);
    expect(probeRoundInsert('{"interestRate":"100.000000000000000001"}')).toContain(
      "ROUND_TERM_INTEREST_RATE_REFUSED",
    );
  });

  it("W68B-B4e — the four NON-percent fields keep binary REAL, because Number() is what the app uses", () => {
    /* Their validators call `Number(raw)`, i.e. the same binary double. An
       exact-decimal fence HERE would BREAK the field-by-field agreement Review 3
       verified. Asserted so nobody 'improves' it later. */
    const deepPos = "0." + "0".repeat(400) + "1";
    expect(Number(deepPos)).toBe(0);
    expect(validateValuationCap(deepPos).ok, "Number() underflows, so the app refuses it too").toBe(false);
    expect(probeRoundInsert(JSON.stringify({ valuationCap: deepPos }))).toContain(
      "ROUND_TERM_VALUATION_CAP_REFUSED",
    );
  });

  it("W68B-B4f — the RESIDUAL is stated: a TEXT value in EXPONENT notation still uses REAL", () => {
    /* Not hidden, and not claimed fixed. Neither round writer can produce this
       — both pass every fenced field through Number() before persisting. */
    expect(probeRoundInsert('{"discount":"9.9999999999999999e1"}')).toContain("ROUND_TERM_DISCOUNT_REFUSED");
    expect(validateDiscountPercentAsWritten("9.9999999999999999e1").ok).toBe(true);
  });
});

describe("W68B-G6 — R41 GRANDFATHERING SURVIVES B2. The test that decides shipping.", () => {
  /* Four rows carrying pre-existing invalid terms — MALFORMED JSON, NULL, the
     EMPTY STRING, and valid JSON with a bad term — each accept an update to an
     UNRELATED column, and each accept `SET extras_json = extras_json`. Migration
     0153 froze a live row this way and the platform cannot repair data it can no
     longer touch. 112 rounds are live. */
  const PRE: Array<[string, string | null]> = [
    ["malformed JSON", '{"discount":'],
    ["NULL extras_json", null],
    ["empty string", ""],
    ["valid JSON with a bad term", '{"discount":20260707,"valuationCap":-1}'],
    ["valid JSON with a good term", '{"discount":20}'],
  ];

  for (const [label, pre] of PRE) {
    it(`W68B-G6a · ${label} — an UNRELATED column update SUCCEEDS`, () => {
      const id = `rnd_w68bg6_${Math.random().toString(36).slice(2, 8)}`;
      seedRound(id, pre);
      try {
        expect(() => db.prepare("UPDATE rounds SET name='renamed' WHERE id=?").run(id)).not.toThrow();
      } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
    });
    it(`W68B-G6b · ${label} — SET extras_json = extras_json SUCCEEDS`, () => {
      const id = `rnd_w68bg6b_${Math.random().toString(36).slice(2, 8)}`;
      seedRound(id, pre);
      try {
        expect(() =>
          db.prepare("UPDATE rounds SET extras_json=extras_json WHERE id=?").run(id),
        ).not.toThrow();
      } finally { db.prepare("DELETE FROM rounds WHERE id=?").run(id); }
    });
  }
});

describe("W68B-N — the hole this wave nearly added, kept closed", () => {
  it("W68B-N1 — an embedded NUL cannot make a value look ABSENT", () => {
    /* Written down because it was REAL. The absence guard was first drafted as
       `length(x) = 0`, and SQLite's length() on TEXT counts characters up to the
       FIRST NUL — so NUL followed by '5' had length 0 and was skipped as absent.
       A brand-new false acceptance, in the fix for the previous three. */
    expect(db.prepare("SELECT length(?) n").get("\u00005").n).toBe(0);
    for (const v of ["\u00005", "\u0000", "5\u00006", "5\u0000junk"]) {
      expect(probeRoundInsert(JSON.stringify({ discount: v })), `discount=${JSON.stringify(v)} accepted`)
        .toContain("ROUND_TERM_DISCOUNT_REFUSED");
      expect(probeCommitInsert(v), `discount_pct=${JSON.stringify(v)} accepted`)
        .toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    }
  });

  it("W68B-N2 — unicode digits, hex, separators and infinities are all still refused", () => {
    for (const v of ["\u0661\u0662", "\uff11\uff12", "0x10", "1_000", "1,000", "inf", "infinity", "NaN", "1e9999"]) {
      expect(probeCommitInsert(v), `discount_pct=${JSON.stringify(v)} accepted`)
        .toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    }
    /* and a 400-digit run of nines is a range refusal, not a crash */
    expect(probeCommitInsert("9".repeat(400))).toContain("DISCOUNT_PCT_OUT_OF_DOMAIN");
    /* while 400 leading zeroes followed by 1 is the number 1 and is ACCEPTED */
    expect(probeCommitInsert("0".repeat(400) + "1")).toBeNull();
  });

  it("W68B-N3 — the migration's own behavioural probe is present and is not a marker check", () => {
    /* Review 1's L1: "the self-verification checks markers, not behaviour —
       those checks all pass despite H1-H4." The migration now EXECUTES the
       installed predicate over a table of adversarial inputs with expected
       verdicts, and one mismatch aborts the whole file. */
    const sql = src(MIG);
    expect(sql).toContain("behavioural_probe_no_mismatch");
    expect(sql).toContain("CREATE TEMP TABLE w68_probe");
    expect(sql).toContain("DROP TABLE w68_probe;");
    /* and it really did leave nothing behind */
    for (const t of ["w68_probe", "w68_probe_result", "w68_before", "w68_postcondition"]) {
      expect(
        db.prepare("SELECT COUNT(*) c FROM sqlite_temp_master WHERE name=?").get(t).c,
        `${t} was left behind in the temp schema`,
      ).toBe(0);
    }
  });
});

