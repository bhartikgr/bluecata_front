/**
 * WAVE 230 — THE MARKER. DRY RUN BY DEFAULT.
 *
 * Runs the real classifier over the real database and reports what it WOULD mark,
 * with the evidence for every proposal and the counter-evidence for every record
 * it declined to propose. With no flags it writes NOTHING.
 *
 * It never invents a verdict of its own: every decision comes from
 * `wave230ClassifyTable`, and only records with `proposeExclude === true` are ever
 * written. AMBIGUOUS records are listed and left alone, which is the whole point.
 *
 * USAGE
 *   npx tsx scripts/wave230/w230_mark_test_data.ts                 # dry run
 *   npx tsx scripts/wave230/w230_mark_test_data.ts --json          # dry run, machine-readable
 *   npx tsx scripts/wave230/w230_mark_test_data.ts --apply --actor <id>
 *
 * `--apply` sets the exclusion flag. It is REVERSIBLE from the admin UI, and from
 * this script with `--unapply`. Nothing is ever deleted.
 */

import {
  WAVE230_TABLES,
  wave230EnsureAllColumns,
  wave230AllCounts,
} from "../../server/lib/wave230TestDataFlags";
import { wave230SetExcluded } from "../../server/lib/wave230TestDataExclusion";
import {
  wave230ClassifyTable,
  wave230SummariseVerdicts,
  type Wave230Verdict,
} from "../../server/lib/wave230TestDataClassifier";
import { wave230RevenueImpact, wave230FormatMinor } from "../../server/lib/wave230RevenueImpact";

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const APPLY = has("--apply");
const UNAPPLY = has("--unapply");
const AS_JSON = has("--json");
const actorIdx = argv.indexOf("--actor");
const ACTOR = actorIdx >= 0 ? (argv[actorIdx + 1] ?? "") : "";

if ((APPLY || UNAPPLY) && !ACTOR) {
  console.error("\n  ABORTED: --apply/--unapply requires --actor <id> so the change is attributable.\n");
  process.exit(1);
}

function main(): void {
  /* The columns must exist before anything can be read or written. This is the
     same self-heal installer the server calls, so the script cannot drift. */
  const ensured = wave230EnsureAllColumns();
  for (const t of WAVE230_TABLES) {
    if (!ensured[t]?.ok) {
      console.error(`  WARNING: could not install w230 columns on ${t}: ${JSON.stringify(ensured[t])}`);
    }
  }

  const revenueBefore = wave230RevenueImpact();
  const all: Wave230Verdict[] = [];
  for (const t of WAVE230_TABLES) all.push(...wave230ClassifyTable(t));

  const proposed = all.filter((v) => v.proposeExclude);
  const needsConfirm = all.filter((v) => v.needsOwnerConfirmation);
  const summary = wave230SummariseVerdicts(all);

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          mode: APPLY ? "APPLY" : UNAPPLY ? "UNAPPLY" : "DRY_RUN",
          summary,
          counts: wave230AllCounts(),
          revenueBefore: revenueBefore.byCurrency.map((c) => ({
            currency: c.currency,
            before: c.beforeMinor.toString(),
            after: c.afterMinor.toString(),
            excluded: c.excludedMinor.toString(),
            excludedCount: c.excludedCount,
          })),
          proposed: proposed.map((v) => ({
            table: v.table,
            id: v.id,
            label: v.label,
            confidence: v.confidence,
            evidence: v.evidence,
            counterEvidence: v.counterEvidence,
          })),
          needsOwnerConfirmation: needsConfirm.map((v) => ({
            table: v.table,
            id: v.id,
            label: v.label,
            evidence: v.evidence,
            counterEvidence: v.counterEvidence,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`\n  WAVE 230 — ${APPLY ? "APPLY" : UNAPPLY ? "UNAPPLY" : "DRY RUN (nothing written)"}\n`);
    for (const s of summary) {
      console.log(
        `  ${s.table.padEnd(26)} total ${String(s.total).padStart(5)}   ` +
          `certain ${String(s.certain).padStart(4)}   probable ${String(s.probable).padStart(4)}   ` +
          `ambiguous(KEPT) ${String(s.ambiguous).padStart(5)}`,
      );
    }
    console.log(`\n  WOULD MARK: ${proposed.length}`);
    console.log(`  OF WHICH NEEDING YOUR CONFIRMATION (PROBABLE): ${needsConfirm.length}\n`);
    for (const v of needsConfirm) {
      console.log(`  ── ${v.table}:${v.id}  "${v.label ?? ""}"`);
      for (const e of v.evidence) console.log(`       FOR:     [${e.rule}] ${e.field} = ${e.value}`);
      for (const c of v.counterEvidence) console.log(`       AGAINST: [${c.rule}] ${c.value}`);
    }
    console.log("\n  REVENUE AS REPORTED TODAY:");
    if (revenueBefore.undetermined) {
      console.log("    NOT DETERMINED — the figures could not be computed. NOT zero; unknown.");
    } else if (revenueBefore.byCurrency.length === 0) {
      /* An honest absence, never a fabricated zero (R224.1). This is a REAL and
         significant state, not an empty list to be printed as blank: it means no
         subscription is in a revenue-bearing status at all. On the dev snapshot
         all 364 subscriptions are `pending_payment`, which independently
         CORROBORATES R230.1's finding that subscriptions auto-create without
         payment. Printing nothing here would have hidden that. */
      console.log(
        "    NO SUBSCRIPTION IS IN A REVENUE-BEARING STATUS (active/trialing).\n" +
          "    Reported revenue is therefore not a small number — there is none to report.",
      );
    }
    for (const c of revenueBefore.byCurrency) {
      console.log(
        `    ${c.currency}: ${wave230FormatMinor(c.beforeMinor, c.currency)} ` +
          `(${c.excludedCount + c.keptCount} subscription(s))`,
      );
    }
    if (revenueBefore.unreadable > 0) {
      console.log(`    WARNING: ${revenueBefore.unreadable} subscription amount(s) UNREADABLE — totals incomplete.`);
    }
  }

  if (!APPLY && !UNAPPLY) {
    if (!AS_JSON) console.log("\n  DRY RUN. Nothing was written.\n");
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const v of proposed) {
    const res = wave230SetExcluded({
      table: v.table,
      id: v.id,
      excluded: APPLY,
      reason: APPLY ? `${v.confidence}: ${v.evidence.map((e) => e.rule).join(", ")}` : null,
      actorId: ACTOR,
    });
    if (res.ok) ok += 1;
    else {
      failed += 1;
      console.error(`  FAILED ${v.table}:${v.id} — ${res.reason}`);
    }
  }
  const after = wave230RevenueImpact();
  console.log(`\n  ${APPLY ? "MARKED" : "UNMARKED"} ${ok}; failed ${failed}`);
  console.log("  REVENUE BEFORE AND AFTER — REPORTED, NEVER SILENT:");
  for (const c of after.byCurrency) {
    console.log(
      `    ${c.currency}: before ${wave230FormatMinor(c.beforeMinor, c.currency)}` +
        `   after ${wave230FormatMinor(c.afterMinor, c.currency)}` +
        `   removed ${wave230FormatMinor(c.excludedMinor, c.currency)} (${c.excludedCount} sub(s))`,
    );
  }
  console.log("");
}

main();
