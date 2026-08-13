#!/usr/bin/env python3
"""Regenerate server/lib/rateLimitStoreSchema.ts from the canonical migration.

WAVE 21 ITEM 4. The exported constant must be a BYTE-FOR-BYTE copy of
migrations/0173_wave21_durable_rate_limit.sql once JS has unescaped the
template literal, so the inline bootstrap can never drift from the migration.
scripts/wave21/item4_durable_ratelimit_harness.ts asserts that equality against
the file on disk.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "migrations/0173_wave21_durable_rate_limit.sql"
OUT = ROOT / "server/lib/rateLimitStoreSchema.ts"

HEADER = '''/**
 * server/lib/rateLimitStoreSchema.ts — WAVE 21 · ITEM 4.
 *
 * GENERATED FILE. DO NOT HAND-EDIT — run scripts/wave21/gen_ratelimit_schema.py.
 * Source: migrations/0173_wave21_durable_rate_limit.sql
 *
 * WHY THIS EXISTS
 * ---------------
 * The durable rate-limit tables must exist on the `:memory:` test path and on
 * any database that has not yet run the migration runner. The project's normal
 * third home for that bootstrap is `applyInlineMigrations()` in
 * `server/db/connection.ts`, which is SACRED and must not be edited by this
 * wave. The bootstrap therefore lives with the module that owns the tables
 * (server/lib/rateLimitStore.ts) and executes the CANONICAL MIGRATION TEXT
 * VERBATIM rather than a hand-copied paraphrase that could drift. This is the
 * same arrangement WAVE 3E used for feeSettlementAuthoritySchema.ts.
 *
 * The text below is the migration with ONLY backtick / ${ sequences escaped for
 * the template literal; JS unescapes them back to the exact file bytes.
 * scripts/wave21/item4_durable_ratelimit_harness.ts asserts that equality, so
 * drift fails loudly.
 */

export const RATE_LIMIT_STORE_SQL = `'''

sql = SRC.read_text()
esc = sql.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
OUT.write_text(HEADER + esc + "`;\n")
print(f"regenerated {OUT} ({len(sql)} source bytes)")
