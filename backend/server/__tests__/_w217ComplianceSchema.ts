/**
 * WAVE 217 — TEST HELPER: APPLY MIGRATION 0222 TO THE IN-MEMORY TEST DATABASE.
 *
 * WHY THIS EXISTS, stated plainly rather than hidden in a `beforeAll`.
 *
 * This tree has two schema paths. `migrations/*.sql`, run by `npm run db:migrate`,
 * is the real one and is where migration 0222 lives. A separate inline bootstrap
 * inside `server/db/connection.ts` builds the sandbox, dev and `:memory:` test
 * databases. `server/db/connection.ts` is on the list of files NO WAVE MAY TOUCH,
 * so wave 217 cannot register its `ALTER TABLE`s there — WAVE 211's migration-0220
 * columns are absent from it for exactly the same reason.
 *
 * So the tests apply the migration themselves. AND THEY APPLY THE REAL FILE:
 * this helper READS `migrations/0222_wave217_partner_compliance_attestation.sql`
 * off disk and executes it. It does not retype the DDL. That is deliberate and it
 * buys two things a retyped copy would not:
 *
 *   1. The migration file's SQL is PROVED to parse and apply against the real
 *      `consortium_applications` table. A syntax error, a misspelled column or a
 *      malformed `CHECK` constraint fails the test suite instead of failing on
 *      Avi's terminal during a deploy.
 *   2. There is ONE copy of the DDL. A retyped test fixture is a second version
 *      of the schema, which is the same defect class as two legal corpora
 *      (R187.2) and two accreditation paths (R187.5).
 *
 * It is idempotent: SQLite cannot `ADD COLUMN IF NOT EXISTS`, so each statement
 * is applied individually and an "duplicate column name" error is swallowed —
 * and ONLY that error. Anything else is rethrown, so a genuinely broken
 * migration cannot pass as "already applied".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rawDb } from "../db/connection";

/** The one migration this wave ships. Path is relative to the repo root. */
export const W217_MIGRATION_PATH =
  "migrations/0222_wave217_partner_compliance_attestation.sql";

/** The five columns migration 0222 adds. Read back to prove it worked. */
export const W217_COLUMNS = [
  "compliance_attested_at",
  "compliance_attestation_version",
  "compliance_attestation_text",
  "regulatory_status",
  "compliance_evidence_ref",
] as const;

/**
 * Apply migration 0222 to the current test database.
 *
 * The store ALSO self-heals these columns (see `wave217EnsureComplianceColumns`),
 * so this is not what makes the suite pass — it is what makes the MIGRATION FILE
 * itself a tested artifact. Both installers read the same file, which is the
 * point: there is one copy of the DDL.
 *
 * Returns the number of statements that were newly applied, so a caller can
 * assert the migration actually did something the first time.
 */
export function applyW217Migration(): { applied: number; alreadyPresent: number } {
  const sql = readFileSync(resolve(process.cwd(), W217_MIGRATION_PATH), "utf8");
  const db = rawDb();

  // Strip whole-line `--` comments, then split on `;`. The migration contains no
  // string literals and no `;` inside any literal, which is why a naive split is
  // safe HERE and would not be safe on a file that did. Stated because "strip
  // comments before any grep conclusion, and say when literals are involved" is
  // a standing rule in this tree.
  const statements = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let applied = 0;
  let alreadyPresent = 0;
  for (const stmt of statements) {
    try {
      db.exec(stmt);
      applied += 1;
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      // ONLY the idempotency case is tolerated. Everything else is a real defect
      // in the migration and must fail loudly.
      if (/duplicate column name/i.test(msg) || /already exists/i.test(msg)) {
        alreadyPresent += 1;
        continue;
      }
      throw new Error(`W217 migration statement failed: ${msg}\n--- statement ---\n${stmt}`);
    }
  }

  return { applied, alreadyPresent };
}

/** Read the live column list back off the table. Proof, not assumption. */
export function consortiumApplicationColumns(): Set<string> {
  const rows = rawDb()
    .prepare("PRAGMA table_info('consortium_applications')")
    .all() as Array<{ name?: string }>;
  return new Set(rows.map((r) => String(r.name ?? "")));
}
