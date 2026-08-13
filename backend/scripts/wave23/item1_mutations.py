#!/usr/bin/env python3
"""WAVE 23 · ITEM 1 mutation matrix — migrate.ts index-failure classification."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
T = "server/db/migrate.ts"

MUTATIONS = [
    Mutation(
        name="M1-restore-unique-swallow",
        target=T,
        anchor='  if (indexStatementKind(stmt) !== "plain") return false;',
        replacement='  if (indexStatementKind(stmt) === "other") return false;',
        why="the exact defect: a failing CREATE UNIQUE INDEX becomes a perf warning again",
    ),
    Mutation(
        name="M2-record-anyway",
        target=T,
        anchor="""        if (deferredReasons.length > 0) {
          // Deliberately no tracker write. See WAIVER-3 note above.
          return;
        }""",
        replacement="        // mutated: always record",
        why="silent-and-unretryable returns: the skipped migration is recorded as applied",
    ),
    Mutation(
        name="M3-report-deferred-as-applied",
        target=T,
        anchor="        applied: toApply.map((f) => f.name).filter((n) => !deferred.includes(n)),",
        replacement="        applied: toApply.map((f) => f.name),",
        why="RunResult lies about which files were actually recorded",
    ),
    Mutation(
        name="M4-unique-dupes-swallowed",
        target=T,
        anchor="            if (!uniqueIndexFatal && isIdempotentSqliteError(msg)) {",
        replacement="            if (isIdempotentSqliteError(msg)) {",
        why="duplicate rows blocking CREATE UNIQUE INDEX get swallowed as idempotent again",
    ),
    Mutation(
        name="M5-unique-kind-never-matches",
        target=T,
        anchor='  if (/^CREATE\\s+UNIQUE\\s+INDEX\\b/.test(stripped)) return "unique";',
        replacement='  if (/^CREATE\\s+UNIQUE\\s+INDEX_NEVER\\b/.test(stripped)) return "unique";',
        why="unique detection regex silently stops matching real SQL",
    ),
    Mutation(
        name="M6-generic-error-message",
        target=T,
        anchor="""              throw new Error(
                `${name}: FATAL — CREATE UNIQUE INDEX failed and a unique index is a data-integrity ` +
                  `constraint, not a performance hint. Refusing to continue or to record this migration ` +
                  `as applied. Underlying: ${msg}`,
              );""",
        replacement="              throw err;",
        why="still fatal but the operator is not told WHY — diagnosability regression",
    ),
    Mutation(
        name="M7-plain-index-now-fatal",
        target=T,
        anchor="""function isNonFatalIndexError(stmt: string, msg: string): boolean {
  // A UNIQUE index is a constraint. Never downgrade its failure.
  if (indexStatementKind(stmt) !== "plain") return false;
  return /no such table/i.test(msg) || /no such column/i.test(msg);
}""",
        replacement="""function isNonFatalIndexError(_stmt: string, _msg: string): boolean {
  return false;
}""",
        why="over-correction: a genuinely optional perf index now blocks the whole install",
    ),
    Mutation(
        name="M8-no-retry-second-run",
        target=T,
        anchor="      const toApply = files.filter((f) => !applied.has(f.name));\n      const skipped = files.filter((f) => applied.has(f.name)).map((f) => f.name);\n      const deferred: string[] = [];",
        replacement="      const toApply = files.filter((f) => !applied.has(f.name)).filter((f) => !/bad_index/.test(f.name));\n      const skipped = files.filter((f) => applied.has(f.name)).map((f) => f.name);\n      const deferred: string[] = [];",
        why="deferred files silently stop being retried on later runs",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave23/item1_migrate_index_harness.ts"],
            MUTATIONS,
            "ITEM1",
        )
    )
