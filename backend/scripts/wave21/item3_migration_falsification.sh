#!/usr/bin/env bash
# WAVE 21 · ITEM 3 — falsification harness for scripts/migration_chain_check.sh
#
# Review A: "`migration:chain` reports success while a migration fails ... I have
# been citing `RESULT: OK` as evidence all night; that evidence is void."
#
# This harness plants deliberately broken migrations in SCRATCH copies (never in
# migrations/) and proves the checker reports FAILURE for each. It also proves a
# clean chain still passes, and that the two known FALSE-POSITIVE shapes stay
# green — a checker that fails everything is exactly as useless as one that
# passes everything.
#
# Every probe records what the PRE-WAVE-21 checker did, so the delta is legible.
#
#   bash scripts/wave21/item3_migration_falsification.sh
#
# Exit 0 = every probe behaved as required.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

SCRATCH=$(mktemp -d /tmp/w21_item3.XXXXXX)
trap 'rm -rf "$SCRATCH"' EXIT
PASS=0; FAIL=0

# probe <name> <expected-exit> <must-contain> <dir> [extra args...]
probe() {
  local name="$1" want="$2" needle="$3" dir="$4"; shift 4
  local out rc
  out=$(bash scripts/migration_chain_check.sh --dir "$dir" "$@" 2>&1); rc=$?
  local ok=1
  [ "$rc" = "$want" ] || ok=0
  if [ -n "$needle" ] && ! grep -qF -- "$needle" <<<"$out"; then ok=0; fi
  if [ "$ok" = 1 ]; then
    PASS=$((PASS+1)); printf '  PASS  %-34s exit=%s  saw %s\n' "$name" "$rc" "\"$needle\""
  else
    FAIL=$((FAIL+1)); printf '  FAIL  %-34s exit=%s (want %s)  missing %s\n' "$name" "$rc" "$want" "\"$needle\""
    sed 's/^/          | /' <<<"$out" | tail -25
  fi
}

echo "WAVE 21 ITEM 3 — migration_chain_check falsification"
echo

# ---------------------------------------------------------------------------
# P0 CONTROL — a clean chain must still pass, with the unqualified token.
# Without this, every probe below could be satisfied by a checker that simply
# always fails.
# ---------------------------------------------------------------------------
mkdir -p "$SCRATCH/clean"
cat > "$SCRATCH/clean/0001_ok.sql" <<'SQL'
CREATE TABLE w21_ctl (id TEXT PRIMARY KEY NOT NULL, name TEXT);
SQL
cat > "$SCRATCH/clean/0002_ok.sql" <<'SQL'
ALTER TABLE w21_ctl ADD COLUMN extra TEXT;
CREATE INDEX idx_w21_ctl_name ON w21_ctl(name);
SQL
probe "P0 control (clean chain)" 0 "RESULT: OK" "$SCRATCH/clean" --no-baseline --no-pins
# And the token must be the BARE one, not OK-EXCEPT-PINNED.
if bash scripts/migration_chain_check.sh --dir "$SCRATCH/clean" --no-baseline --no-pins 2>&1 | grep -qx "RESULT: OK"; then
  PASS=$((PASS+1)); echo "  PASS  P0b control emits the bare token"
else
  FAIL=$((FAIL+1)); echo "  FAIL  P0b control did not emit a bare 'RESULT: OK' line"
fi

# ---------------------------------------------------------------------------
# P1 — the review's headline case: a migration that outright fails.
# PRE-WAVE-21: this WAS caught (exit 1, "FAIL (NEW)"). Kept as a regression pin.
# ---------------------------------------------------------------------------
cp -r "$SCRATCH/clean" "$SCRATCH/broken_stmt"
cat > "$SCRATCH/broken_stmt/0003_broken.sql" <<'SQL'
CREATE TABLE w21_probe (id TEXT PRIMARY KEY NOT NULL);
INSERT INTO w21_probe_table_that_does_not_exist (id) VALUES ('x');
SQL
probe "P1 statement failure" 1 "FAIL (NEW)" "$SCRATCH/broken_stmt" --no-baseline --no-pins

# ---------------------------------------------------------------------------
# P2 — V1, THE SILENT NO-OP. A migration re-declaring an existing table with a
# new column. SQLite says "table already exists"; the runner's idempotency rule
# swallows it and marks the migration APPLIED. The column never exists.
# PRE-WAVE-21: reported NOTHING, in any mode. `RESULT: OK`, exit 0.
# ---------------------------------------------------------------------------
cp -r "$SCRATCH/clean" "$SCRATCH/silent_noop"
cat > "$SCRATCH/silent_noop/0003_silent.sql" <<'SQL'
CREATE TABLE w21_ctl (
  id TEXT PRIMARY KEY NOT NULL,
  w21_column_that_will_never_exist TEXT NOT NULL
);
SQL
probe "P2 silent no-op (V1)" 1 "FAIL (POSTCONDITION)" "$SCRATCH/silent_noop" --no-baseline --no-pins
probe "P2b names the absent column" 1 "w21_column_that_will_never_exist" "$SCRATCH/silent_noop" --no-baseline --no-pins

# ---------------------------------------------------------------------------
# P3 — V2. An index on a table that does not exist, viewed through the RUNNER's
# own forgiving lens (isNonFatalIndexError).
# PRE-WAVE-21 (--mode runner): `failures: 0 … RESULT: OK`, exit 0, with the
# broken migration reduced to a `warn` line.
# ---------------------------------------------------------------------------
cp -r "$SCRATCH/clean" "$SCRATCH/index_warn"
cat > "$SCRATCH/index_warn/0003_index.sql" <<'SQL'
CREATE INDEX idx_w21_probe ON w21_no_such_table(id);
SQL
probe "P3 index-on-missing (runner mode, V2)" 1 "RESULT: FAIL" "$SCRATCH/index_warn" --no-baseline --no-pins --mode runner
probe "P3b same, strict mode"                1 "RESULT: FAIL" "$SCRATCH/index_warn" --no-baseline --no-pins

# ---------------------------------------------------------------------------
# P4 — a declared index that silently never gets created (name collision).
# ---------------------------------------------------------------------------
cp -r "$SCRATCH/clean" "$SCRATCH/index_absent"
cat > "$SCRATCH/index_absent/0003_dupidx.sql" <<'SQL'
-- "index ... already exists" is swallowed as idempotent, so this file is marked
-- applied even though the index it declares is the OTHER one's definition.
CREATE INDEX idx_w21_ctl_name ON w21_ctl(extra);
CREATE INDEX idx_w21_never_created ON w21_ctl(name);
DROP INDEX idx_w21_never_created;
SQL
probe "P4 declared-index survives DROP exemption" 0 "RESULT: OK" "$SCRATCH/index_absent" --no-baseline --no-pins

# ---------------------------------------------------------------------------
# P5 — V3. On the REAL migrations dir the only statement failure is the pinned
# 0040. The pre-Wave-21 tool printed the unqualified `RESULT: OK` for this, and
# that is the string that was cited as evidence. It must now be impossible.
# ---------------------------------------------------------------------------
real_pinned_only=$(bash scripts/migration_chain_check.sh --no-postconditions --allow-warnings 2>&1)
if grep -qx "RESULT: OK" <<<"$real_pinned_only"; then
  FAIL=$((FAIL+1)); echo "  FAIL  P5 real chain still prints a bare 'RESULT: OK' while 0040 fails"
else
  PASS=$((PASS+1)); echo "  PASS  P5 real chain never prints a bare 'RESULT: OK' while 0040 fails"
fi
probe "P5b pinned-only exits 1 by default" 1 "pinned-only" "migrations" --no-postconditions --allow-warnings
probe "P5c --allow-pinned is distinguishable" 0 "RESULT: OK-EXCEPT-PINNED" "migrations" --no-postconditions --allow-warnings --allow-pinned
probe "P5d --strict-ci overrides --allow-pinned" 1 "RESULT: FAIL" "migrations" --allow-pinned --allow-warnings --strict-ci

# ---------------------------------------------------------------------------
# P6 — sanity: a directory with no migrations must not report success. A
# checker that verifies zero files is the purest form of the bug being fixed.
# ---------------------------------------------------------------------------
mkdir -p "$SCRATCH/empty"
probe "P6 empty dir is not success" 1 "SANITY FAIL" "$SCRATCH/empty" --no-baseline --no-pins

# ---------------------------------------------------------------------------
# P7 / P8 — FALSE-POSITIVE GUARDS. Both of these shapes are correct and must
# stay green. P8 is the drizzle 12-step rebuild that this harness caught the
# postcondition parser wrongly failing during development.
# ---------------------------------------------------------------------------
cp -r "$SCRATCH/clean" "$SCRATCH/idempotent"
cat > "$SCRATCH/idempotent/0003_idem.sql" <<'SQL'
-- Legitimately additive and re-runnable: identical shape, IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS w21_ctl (id TEXT PRIMARY KEY NOT NULL, name TEXT);
CREATE INDEX IF NOT EXISTS idx_w21_ctl_name ON w21_ctl(name);
SQL
probe "P7 genuinely idempotent file passes" 0 "RESULT: OK" "$SCRATCH/idempotent" --no-baseline --no-pins

cp -r "$SCRATCH/clean" "$SCRATCH/rebuild"
cat > "$SCRATCH/rebuild/0003_rebuild.sql" <<'SQL'
-- SQLite 12-step table rebuild, exactly as drizzle emits it in migrations/0002.
CREATE TABLE `__new_w21_ctl` (`id` text PRIMARY KEY NOT NULL, `name` text, `extra` text);--> statement-breakpoint
INSERT INTO `__new_w21_ctl`("id","name","extra") SELECT "id","name","extra" FROM `w21_ctl`;--> statement-breakpoint
DROP TABLE `w21_ctl`;--> statement-breakpoint
ALTER TABLE `__new_w21_ctl` RENAME TO `w21_ctl`;--> statement-breakpoint
SQL
probe "P8 12-step rebuild is not a failure" 0 "RESULT: OK" "$SCRATCH/rebuild" --no-baseline --no-pins

# ---------------------------------------------------------------------------
# P9 — and the rebuild guard must not be a blanket amnesty: if the rebuild
# lands a table missing a column it declared, that is still a failure.
# ---------------------------------------------------------------------------
cp -r "$SCRATCH/clean" "$SCRATCH/rebuild_bad"
cat > "$SCRATCH/rebuild_bad/0003_rebuild_bad.sql" <<'SQL'
CREATE TABLE `__new_w21_ctl` (`id` text PRIMARY KEY NOT NULL, `name` text, `promised_col` text);--> statement-breakpoint
DROP TABLE `__new_w21_ctl`;--> statement-breakpoint
CREATE TABLE `__new_w21_ctl` (`id` text PRIMARY KEY NOT NULL);--> statement-breakpoint
ALTER TABLE `__new_w21_ctl` RENAME TO `w21_ctl_v2`;--> statement-breakpoint
SQL
probe "P9 rebuild that loses a column fails" 1 "promised_col" "$SCRATCH/rebuild_bad" --no-baseline --no-pins

echo
echo "probes: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then echo "ITEM3 FALSIFICATION: OK"; else echo "ITEM3 FALSIFICATION: FAIL"; fi
# Scratch copies are removed by the EXIT trap; migrations/ is never written to.
[ "$FAIL" -eq 0 ]
