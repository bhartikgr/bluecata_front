/**
 * WAVE 35 · ROW 8 — EXISTING-DATA AUDIT (READ ONLY. IT WRITES NOTHING.)
 *
 * The four as-written fields (grossMarginPct, growthRatePct, netMarginPct,
 * ltvCacRatio) were written by the shipped code as `Math.round(n * 100)` and
 * are now written as-typed. Any row saved before this wave may therefore hold
 * a value in the OLD ×100 convention.
 *
 * THIS SCRIPT DELIBERATELY DOES NOT CONVERT ANYTHING.
 *
 * The two conventions are not reliably distinguishable:
 *   - 7000 is "70% under the old convention" AND "7000% under the new one".
 *     70% is overwhelmingly likelier, but a hypergrowth MoM figure of even
 *     500% is a legitimate number, and there is no stored marker to tell them
 *     apart. `profilestore_company_profile` / `company_profile_extended` store
 *     an untyped JSON blob — no column type, no CHECK, no version tag on the
 *     individual field.
 *   - 42.5 is unambiguous only because the old path always produced an
 *     integer. An old row is ALWAYS an integer; a new row is USUALLY not. That
 *     is a hint, not a discriminator: 15% typed today stores exactly 15.
 *
 * So this script classifies and REPORTS. A human decides. Guessing here would
 * silently rewrite a founder's reported financials, which is strictly worse
 * than displaying a number an operator can query.
 *
 * Run:  npx tsx scripts/w35_row8_percent_audit.ts [path/to/db.sqlite ...]
 */
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const FIELDS = [
  "grossMarginPct",
  "growthRatePct",
  "netMarginPct",
  "ltvCacRatio",
] as const;

/** Plausible upper bound for a value expressed in the NEW convention. */
const PLAUSIBLE_MAX: Record<string, number> = {
  grossMarginPct: 100, // a gross margin above 100% is not a thing
  netMarginPct: 100,
  growthRatePct: 1000, // hypergrowth is real; 1000%/mo is not
  ltvCacRatio: 100, // an LTV:CAC of 100x is not a thing
};

type Verdict = "ok_as_written" | "almost_certainly_old_x100" | "AMBIGUOUS";

function classify(field: string, v: number): Verdict {
  const max = PLAUSIBLE_MAX[field] ?? 100;
  if (Math.abs(v) <= max) {
    // In range for the new convention. Could still be an old row (e.g. 50
    // meaning 0.5%), but 0.5% margins are far rarer than 50% margins and we
    // will not rewrite on a guess.
    return "ok_as_written";
  }
  if (Number.isInteger(v) && Math.abs(v) / 100 <= max) {
    // Out of range as written, in range once divided, and an integer — the
    // exact signature the old writer produced.
    return "almost_certainly_old_x100";
  }
  return "AMBIGUOUS";
}

const TABLES = ["profilestore_company_profile", "company_profile_extended"];

function auditDb(path: string) {
  if (!existsSync(path)) {
    console.log(`\n[skip] ${path} — not present`);
    return;
  }
  const db = new Database(path, { readonly: true });
  console.log(`\n=== ${path} ===`);
  for (const table of TABLES) {
    let rows: { company_id: string; profile_json: string }[];
    try {
      rows = db
        .prepare(`SELECT company_id, profile_json FROM ${table}`)
        .all() as never;
    } catch {
      console.log(`  ${table}: table not present`);
      continue;
    }
    const tally: Record<Verdict, number> = {
      ok_as_written: 0,
      almost_certainly_old_x100: 0,
      AMBIGUOUS: 0,
    };
    let withValues = 0;
    for (const r of rows) {
      let p: Record<string, unknown>;
      try {
        p = JSON.parse(r.profile_json);
      } catch {
        console.log(`  ! ${r.company_id}: unparseable profile_json`);
        continue;
      }
      let any = false;
      for (const f of FIELDS) {
        const v = p[f];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        any = true;
        const verdict = classify(f, v);
        tally[verdict]++;
        if (verdict !== "ok_as_written") {
          console.log(
            `  ${verdict.padEnd(26)} ${r.company_id} ${f}=${v}` +
              (verdict === "almost_certainly_old_x100"
                ? `  (would read as ${v / 100} if converted — DO NOT convert automatically)`
                : ""),
          );
        }
      }
      if (any) withValues++;
    }
    console.log(
      `  ${table}: ${rows.length} rows, ${withValues} carrying at least one of the four fields`,
    );
    console.log(`    in range as written      : ${tally.ok_as_written}`);
    console.log(`    looks like old x100      : ${tally.almost_certainly_old_x100}`);
    console.log(`    ambiguous                : ${tally.AMBIGUOUS}`);
  }
  db.close();
}

const targets = process.argv.slice(2);
if (targets.length === 0) targets.push("data.db", "test.db", "dev.db", "db.sqlite");
for (const t of targets) auditDb(t);
console.log(
  "\nNOTHING WAS WRITTEN. If any row is reported above, an operator must " +
    "confirm the intended value with the company before any correction.",
);
