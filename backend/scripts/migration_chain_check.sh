#!/usr/bin/env bash
# scripts/migration_chain_check.sh — WAVE 13.
#
# Applies every migrations/*.sql in sorted order into one empty SQLite database
# and reports every file that fails. Thin wrapper: all logic lives in
# scripts/migration_chain_check.mjs (which must reuse the real runner's
# statement splitter and inline baseline — see the header there for why).
#
#   bash scripts/migration_chain_check.sh                  # migrations/, strict
#   bash scripts/migration_chain_check.sh --mode runner     # runner's own view
#   bash scripts/migration_chain_check.sh --dir server/db/migrations
#   bash scripts/migration_chain_check.sh --json
#   bash scripts/migration_chain_check.sh --strict-ci       # no exemptions at all
#
# WAVE 21: this tool used to print `RESULT: OK` while migration 0040 was
# failing, and that string was cited as evidence. Three vacuity classes were
# reproduced and closed — silent no-op migrations (now caught by POSTCONDITION
# verification), `--mode runner` passing an index-on-missing-table migration,
# and the pinned set buying the unqualified `RESULT: OK` token. The full
# write-up is in the .mjs header; the falsification harness that proves each one
# is scripts/wave21/item3_migration_falsification.sh (16 probes, incl. controls
# and false-positive guards). server/db/migrate.ts was NOT modified (SACRED).
#
# Exit 0 ONLY when there is nothing to report. A pinned pre-existing failure now
# exits 1 and prints `RESULT: FAIL (pinned-only: ...)`; pass --allow-pinned to
# get exit 0, which prints the distinct token `RESULT: OK-EXCEPT-PINNED`.
# Flags: --allow-pinned --allow-warnings --no-postconditions --no-pins
#        --strict-ci (refuses --allow-pinned and --allow-warnings).
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
exec npx tsx scripts/migration_chain_check.mjs "$@"
