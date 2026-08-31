/* ════════════════════════════════════════════════════════════════════════════
   WAVE 204 — R178.8 · CONTACT TYPE CORRECTION — OPERATOR CLI
   ════════════════════════════════════════════════════════════════════════════
   Plain-language instructions: build_log/wave204/OWNER_CONTACT_CORRECTION.md

   USAGE
     npx tsx scripts/wave204_contact_kind_correction.mts                 (DRY RUN)
     npx tsx scripts/wave204_contact_kind_correction.mts --apply         (WRITES)

     --actor=<id>       who to record in the audit log (default: the OS user)
     --backup-dir=<dir> where to put the backup (default: beside the database)
     --json             also print the machine-readable report

   THE DEFAULT IS A DRY RUN. Writing requires --apply and nothing else grants it.

   This file is deliberately thin: every decision, every refusal and every write
   lives in `server/lib/wave204ContactKindCorrection.ts`, which the test suite
   calls directly. A CLI that re-implemented any of that would be a second
   implementation, and the tested one would not be the one the operator runs.
   ════════════════════════════════════════════════════════════════════════════ */

import os from "node:os";
import {
  runContactKindCorrection,
  formatReportForOwner,
} from "../server/lib/wave204ContactKindCorrection.js";

function argValue(flag: string): string | undefined {
  const prefix = `--${flag}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return undefined;
}
function hasFlag(flag: string): boolean {
  return process.argv.indexOf(`--${flag}`) !== -1;
}

const apply = hasFlag("apply");

if (!process.env.DATABASE_URL && !process.env.SQLITE_PATH) {
  console.log(
    "NOTE: neither DATABASE_URL nor SQLITE_PATH is set, so this will open the\n" +
      "      default ./data.db relative to the current directory. If that is not\n" +
      "      the database you mean, stop now and set DATABASE_URL=file:<path>.\n",
  );
}

const report = runContactKindCorrection({
  apply,
  actor: argValue("actor") ?? `cli:${os.userInfo().username}`,
  backupDir: argValue("backup-dir"),
});

console.log(formatReportForOwner(report));

if (hasFlag("json")) {
  console.log("\n--- machine-readable report ---");
  console.log(JSON.stringify(report, null, 2));
}

/* Exit codes, so this can be run from a runbook without reading the prose:
     0  nothing needed correcting, or the correction applied cleanly
     2  the script REFUSED (hard stop, backup failure, unsupported driver, or an
        aborted transaction). Nothing was written.
     3  applied, but at least one row could not be corrected and was left alone,
        or an audit row did not land. Read the report.                        */
if (report.refusals.length > 0) process.exit(2);
if (report.counts.unrecoverable > 0 || report.auditWriteFailed) process.exit(3);
process.exit(0);
