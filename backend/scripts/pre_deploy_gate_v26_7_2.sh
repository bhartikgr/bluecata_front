#!/bin/bash
# =============================================================================
# CAPAVATE v26.7.2 PRE-DEPLOY GATE
# =============================================================================
#
# CRITICAL: Run this script BEFORE `npm run db:migrate` on any production
# database with existing data.
#
# The Wave C-2 hotfix v26.7.2 causes the migration runner to see the full
# 70-file corpus for the first time. Even with legacy-tracker seeding, on
# a DB whose _migrations_applied table doesn't contain numbered migration
# entries (Avi's documented actual state), the runner will REPLAY every
# pre-Wave-C2 file from 0001 forward.
#
# Most files are idempotent (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD
# COLUMN with duplicate-column swallow, etc.). A few are NOT idempotent
# and will DAMAGE live production data if replayed:
#
#   0097_v25_52_crm_dedup_backfill.sql
#     Soft-deletes duplicate CRM contacts by ROW_NUMBER rank. Replay will
#     soft-delete duplicates that operators created deliberately AFTER
#     the original 2026-05 v25.52 backfill.
#
#   0021_backfill_chapter_to_default.sql
#     Re-tags any legitimately-null chapter_id row to 'chap_keiretsu_canada'.
#     Replay may re-tag rows that were left null intentionally by newer
#     onboarding flows.
#
# This script pre-marks those in __drizzle_migrations_applied so the
# runner skips them. Runs are logged with clear provenance so an operator
# can review what was gated later.
#
# USAGE:
#   sudo bash pre_deploy_gate_v26_7_2.sh /var/www/html/backend/data.db
#
# =============================================================================

set -e

DB_PATH="${1:-/var/www/html/backend/data.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: DB not found at $DB_PATH"
  echo "Usage: $0 /path/to/data.db"
  exit 1
fi

echo "=========================================================================="
echo "CAPAVATE v26.7.2 PRE-DEPLOY GATE"
echo "=========================================================================="
echo ""
echo "Target DB: $DB_PATH"
echo "Timestamp: $(date -Iseconds)"
echo ""

# ---- Step 0: SACRED-HASH CHECK (WAVE 10 / G-3, closes DEF-079). -------------
#
# THE DEFECT THIS CLOSES. Until now this script gated the DATABASE and nothing
# else. It pre-marked non-idempotent migrations, then handed control to
# `npm run db:migrate` against WHATEVER SOURCE HAPPENED TO BE ON DISK. A tree in
# which a SACRED file had been edited — `server/captableCommitStore.ts`,
# `server/subscriptionStore.ts`, `server/paymentGatewayAdapter.ts`,
# `server/lib/migrationRunner.ts` and 36 others — passed this gate without a
# word. `scripts/sacred_check.sh` existed and was correct, but it was only wired
# into `npm run preflight` (package.json), which is a DEVELOPER command run in
# the repo. The PRODUCTION path, which is this script, never called it. That is
# DEF-079: the one gate an operator actually runs on the server was the one gate
# with no source-integrity check.
#
# WHY IT RUNS FIRST. It runs before the backup and before any write, so a tree
# with a tampered money-core file cannot even reach the point of touching the
# production DB.
#
# WHY IT IS NOT SILENTLY SKIPPED. If `sacred_check.sh` is missing, this gate
# FAILS — it does not shrug and continue. A missing verifier is indistinguishable
# from a failing one, and treating it as a pass is precisely the vacuously-green
# failure mode that WAVE 7B found in DA-3's scope fence, where
# `collectFencedPaths()` silently skipped paths that did not exist on disk and
# so reported success while checking nothing. There is exactly one escape hatch,
# it is loud, and it names itself in the output:
#
#   SACRED_GATE_OVERRIDE=1 bash scripts/pre_deploy_gate_v26_7_2.sh /path/data.db
#
# FALSIFICATION (run before shipping, recorded in build_log/WAVE10_REPORT.md):
# appending one byte to `server/captableCommitStore.ts` makes this step exit 1
# and abort the gate; reverting the byte makes it pass again. A check that has
# not been made to fail is not evidence.
GATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SACRED_CHECK="$GATE_DIR/sacred_check.sh"
echo "[0/5] Sacred-file integrity (G-3 / DEF-079)"
if [ "${SACRED_GATE_OVERRIDE:-0}" = "1" ]; then
  echo "      !!! SACRED CHECK OVERRIDDEN via SACRED_GATE_OVERRIDE=1."
  echo "      !!! This deploy is UNVERIFIED at the source level. Record who"
  echo "      !!! authorised it and why in the deploy log."
elif [ ! -f "$SACRED_CHECK" ]; then
  echo "      FAIL: $SACRED_CHECK is missing." >&2
  echo "            The gate cannot verify source integrity, so it refuses to" >&2
  echo "            proceed. A verifier that is absent is not a verifier that" >&2
  echo "            passed. Restore scripts/sacred_check.sh from the release" >&2
  echo "            package, or re-run with SACRED_GATE_OVERRIDE=1 if you are" >&2
  echo "            knowingly accepting an unverified tree." >&2
  exit 1
else
  # W31-A3 — REPORT WHAT THE CHECKER SAID, DO NOT RE-STATE IT FROM MEMORY.
  # This line read "47/47 sacred files byte-identical (2 under WAIVER-1 freeze)"
  # — a hardcoded string that had drifted badly: the freeze holds FIVE files
  # under four different waivers, including WAIVER-4 over a live LP-privacy fix.
  # The operator running a deploy saw "2 under WAIVER-1" and would reasonably
  # conclude three other waived files were unwaived drift, or never learn they
  # existed. Running WITHOUT `--quiet` and echoing the checker's own summary
  # means this gate can no longer disagree with the checker: there is one string
  # and sacred_check.sh derives it from the KNOWN_DRIFT array.
  #
  # The capture is written as the `if` CONDITION, not as a bare assignment.
  # `set -e` (line 38) aborts the script on a failing simple command, so
  # `SACRED_SUMMARY=$(...)` followed by `if [ $? -eq 0 ]` would kill the gate the
  # instant sacred drift was detected — losing the entire FAIL branch below,
  # which is the branch that tells the operator what to do. Exit status inside an
  # `if` condition is exempt from `set -e`, so both poles stay reachable.
  if SACRED_SUMMARY="$(bash "$SACRED_CHECK" 2>/dev/null)"; then
    echo "      OK: ${SACRED_SUMMARY:-sacred check passed but printed nothing}"
  else
    echo "" >&2
    echo "      FAIL: sacred-file drift detected. The gate is ABORTING before" >&2
    echo "            the DB backup and before any write." >&2
    echo "            Full detail:  bash scripts/sacred_check.sh" >&2
    echo "            Manifest:     bash scripts/sacred_check.sh --list" >&2
    echo "            A drifted sacred file means the tree you are about to" >&2
    echo "            migrate is not the tree that was reviewed. Do not deploy" >&2
    echo "            it. If the drift is intentional and owner-approved it" >&2
    echo "            belongs in the KNOWN_DRIFT freeze in sacred_check.sh" >&2
    echo "            (WAIVER-1 pattern), with the old hash recorded, NOT in an" >&2
    echo "            override on the day of the deploy." >&2
    exit 1
  fi
fi
echo ""

# ---- Step 0b: COVERAGE CI GATE (WAVE 12 / C-2). -----------------------------
#
# THE DEFECT THIS CLOSES. Step 0 above verifies that sacred files have not
# DRIFTED. It cannot tell you whether the build they belong to still accounts
# for every row of the register, because nothing anywhere executed either
# coverage checker. `spec/_v8_coverage.py` appears in this repo exactly twice:
# as a SHA256 row in scripts/sacred_check.sh (which freezes its bytes) and as a
# file on disk. Its bytes were guarded; its VERDICT was never read.
#
# Worse, it has no --ci mode and never validates argv, so a CI job written as
# `python3 spec/_v8_coverage.py --ci` exits 0 while enforcing no baseline at
# all — the same vacuously-green shape as DA-3's scope fence described in
# Step 0's comment. scripts/coverage_ci_gate.sh is the real gate; see its
# header for defects D1/D2/D3 and the falsification of each.
#
# WHY IT IS HERE AND NOT ONLY IN `npm run preflight`. Step 0's comment above
# records precisely this mistake for sacred_check.sh: it existed, it was
# correct, and it was wired ONLY into a developer command, so the production
# path never called it (DEF-079). Wiring C-2 into preflight alone would repeat
# DEF-079 verbatim. It is wired into BOTH.
#
# WHY IT IS NOT SILENTLY SKIPPED. Same rule as Step 0 — a missing verifier is
# not a passing verifier. Missing script => FAIL. One loud, self-naming
# escape hatch:
#
#   COVERAGE_GATE_OVERRIDE=1 bash scripts/pre_deploy_gate_v26_7_2.sh /path/data.db
#
# It is skipped WITHOUT failure in exactly one case: the spec/ tree is not
# present beside the repo. Release packages ship the app tree without spec/,
# and this gate must remain runnable on a production server. That skip is
# printed, never silent, and it says what was not checked.
#
# FALSIFICATION (build_log/WAVE12_REPORT.md, 35/35 assertions):
# scripts/__tests__/coverage_ci_gate_falsify.sh drives this gate against
# mutated COPIES of spec/ and proves it exits 1 on a real undispositioned
# register row and on a stale baseline, and 2 on a missing/malformed baseline,
# an unknown flag, H1/H2/H4/H6 tampering and missing inputs.
COVERAGE_GATE="$GATE_DIR/coverage_ci_gate.sh"
COVERAGE_SPEC_ROOT="${SPEC_ROOT:-$(cd "$GATE_DIR/../.." 2>/dev/null && pwd)/spec}"
echo "[0b/5] Coverage non-regression (C-2)"
if [ "${COVERAGE_GATE_OVERRIDE:-0}" = "1" ]; then
  echo "      !!! COVERAGE GATE OVERRIDDEN via COVERAGE_GATE_OVERRIDE=1."
  echo "      !!! Register coverage is UNVERIFIED for this deploy. Record who"
  echo "      !!! authorised it and why in the deploy log."
elif [ ! -d "$COVERAGE_SPEC_ROOT" ]; then
  echo "      SKIPPED: no spec/ tree at $COVERAGE_SPEC_ROOT"
  echo "               This is a release-package tree, which ships without"
  echo "               spec/. NOT CHECKED: register coverage non-regression."
  echo "               Source integrity (Step 0) still applies and passed."
elif [ ! -f "$COVERAGE_GATE" ]; then
  echo "      FAIL: $COVERAGE_GATE is missing." >&2
  echo "            spec/ is present, so this tree is expected to be gated on" >&2
  echo "            coverage, but the gate itself is absent. A verifier that is" >&2
  echo "            absent is not a verifier that passed. Restore it, or re-run" >&2
  echo "            with COVERAGE_GATE_OVERRIDE=1 to knowingly accept a tree" >&2
  echo "            whose register coverage nobody checked." >&2
  exit 1
else
  # `set -e` is in force (line 38). A bare `X="$(failing_cmd)"` assignment under
  # `set -e` terminates the shell AT THE ASSIGNMENT, so COV_RC is never assigned
  # and none of the diagnostics below ever print: the operator sees the gate stop
  # after the "[0b/5]" line with exit 1 and no reason at all. That is exactly the
  # silent failure this gate exists to prevent, and the first draft of this step
  # had it (falsified: 0 bytes on stderr, exit 1). The `|| COV_RC=$?` suffix puts
  # the command in a list, which suppresses `set -e` for it. Step 0 above dodges
  # the same trap by using `if bash ...; then`.
  COV_RC=0
  COV_LOG="$(SPEC_ROOT="$COVERAGE_SPEC_ROOT" bash "$COVERAGE_GATE" 2>&1)" || COV_RC=$?
  if [ "$COV_RC" = "0" ]; then
    echo "      OK: $(sed -n 's/^gap (2 ways) *: *\([0-9]*\).*/gap \1/p' <<<"$COV_LOG" | head -1) == baseline, semantic gates H1..H6 clean"
  else
    echo "" >&2
    echo "      FAIL (exit $COV_RC): coverage gate refused this tree. ABORTING" >&2
    echo "            before the DB backup and before any write." >&2
    echo "$COV_LOG" | sed 's/^/            /' >&2
    echo "            exit 1 = the gap moved: either a register row lost its" >&2
    echo "                     disposition (regression) or the baseline is stale." >&2
    echo "            exit 2 = the inputs are invalid. That is a tampering" >&2
    echo "                     signal, not a coverage number. Do not deploy and" >&2
    echo "                     do not 'fix' it by editing the baseline." >&2
    echo "            Detail:  bash scripts/coverage_ci_gate.sh --print" >&2
    exit 1
  fi
fi
echo ""

# ---- Step 1: Back up the DB. Non-negotiable. --------------------------------
BACKUP="${DB_PATH}.pre-v26.7.2.$(date +%Y%m%d_%H%M%S)"
echo "[1/5] Backing up DB to $BACKUP"
cp "$DB_PATH" "$BACKUP"
# Verify the copy opens
if ! sqlite3 "$BACKUP" "SELECT 1;" > /dev/null 2>&1; then
  echo "ERROR: backup at $BACKUP is not a valid SQLite database"
  exit 1
fi
echo "      Backup verified. If anything goes wrong, restore with:"
echo "        cp $BACKUP $DB_PATH"
echo ""

# ---- Step 2: Report current DB state. ---------------------------------------
echo "[2/5] Current DB state"
echo ""
echo "  _migrations_applied schema:"
sqlite3 "$DB_PATH" ".schema _migrations_applied" 2>&1 | sed 's/^/    /'
echo ""
echo "  _migrations_applied row count: $(sqlite3 "$DB_PATH" "SELECT count(*) FROM _migrations_applied;" 2>&1)"
echo ""
echo "  __drizzle_migrations_applied exists: $(sqlite3 "$DB_PATH" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations_applied';" 2>&1)"
echo ""
echo "  Migration files on disk: $(ls /var/www/html/backend/server/db/migrations/*.sql 2>/dev/null | wc -l)"
echo ""

# ---- Step 3: Ensure __drizzle_migrations_applied exists. --------------------
echo "[3/5] Ensuring __drizzle_migrations_applied exists"
sqlite3 "$DB_PATH" <<SQL
CREATE TABLE IF NOT EXISTS __drizzle_migrations_applied (
  name TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
);
SQL
echo "      OK"
echo ""

# ---- Step 4: Gate the destructive/non-idempotent migrations. ----------------
echo "[4/5] Gating destructive replays"
NOW="$(date -Iseconds)"

# Read the list of migration files on disk
FILES=$(ls /var/www/html/backend/server/db/migrations/*.sql 2>/dev/null | xargs -I {} basename {})

# ---- 4a. Always-gate: known destructive DML.
GATED_ALWAYS=$(cat <<'EOF'
0097_v25_52_crm_dedup_backfill.sql
0021_backfill_chapter_to_default.sql
EOF
)

# ---- 4b. Also gate everything the DB shows as already-applied via the
#         modern (key, applied_at) tracker if it contains numbered entries.
#         This is the safe path even if we're wrong about which files are
#         idempotent: if it was applied before, don't replay.

for f in $GATED_ALWAYS; do
  if echo "$FILES" | grep -qx "$f"; then
    result=$(sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO __drizzle_migrations_applied (name, applied_at) VALUES ('$f', '$NOW');" 2>&1)
    marked=$(sqlite3 "$DB_PATH" "SELECT changes();")
    if [ "$marked" = "1" ]; then
      echo "      GATED: $f (pre-marked as applied to prevent destructive replay)"
    else
      echo "      already gated: $f"
    fi
  fi
done
echo ""

# ---- Step 5: Idempotent-mark all pre-Wave-C2 files (0001-0127).
#      These are safe to skip because either:
#      (a) they use CREATE TABLE IF NOT EXISTS + guarded ALTERs (schema-only)
#      (b) they were already applied via the connection.ts self-heal path
#      (c) their data operations use INSERT OR IGNORE + WHERE guards
echo "[5/5] Marking all pre-Wave-C2 migrations (0001-0127) as applied"
echo "      RATIONALE: the connection.ts inline-DDL baseline has been applying"
echo "      these schemas on every boot since v12. Re-running them via the"
echo "      numbered runner is redundant work and increases surface for the"
echo "      few migrations that lack idempotency guards. Wave C-2 (0128+) will"
echo "      still apply."
echo ""

PRE_C2_MARKED=0
for f in $FILES; do
  # Extract the leading number
  num=$(echo "$f" | grep -oE '^[0-9]+' | head -1)
  if [ -z "$num" ]; then continue; fi
  # Compare as integer: mark if <= 127 (last pre-Wave-C2 migration is 0127)
  if [ "$num" -le "127" ]; then
    sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO __drizzle_migrations_applied (name, applied_at) VALUES ('$f', '$NOW');" 2>&1 > /dev/null
    if [ "$(sqlite3 "$DB_PATH" 'SELECT changes();')" = "1" ]; then
      PRE_C2_MARKED=$((PRE_C2_MARKED + 1))
    fi
  fi
done
echo "      Marked $PRE_C2_MARKED pre-Wave-C2 migrations as applied"
echo ""

# ---- Summary. ---------------------------------------------------------------
FINAL_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM __drizzle_migrations_applied;")
echo "=========================================================================="
echo "PRE-DEPLOY GATE COMPLETE"
echo "=========================================================================="
echo ""
echo "  __drizzle_migrations_applied total entries: $FINAL_COUNT"
echo ""
echo "  Now run: npm run db:migrate"
echo ""
echo "  Expected: 9 applied, ~60 skipped, exit 0"
echo "  Applied files: 0128-0134, 0136, 0137 (the Wave C-2 files)"
echo ""
echo "  If anything goes wrong, restore with:"
echo "    cp $BACKUP $DB_PATH"
echo "    pm2 restart all"
echo ""
