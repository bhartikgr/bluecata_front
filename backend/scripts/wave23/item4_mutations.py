#!/usr/bin/env python3
"""WAVE 23 · ITEM 4 mutation matrix — the corrected 0000 pin justification.

The artefact under test is a COMMENT, so the mutations attack the two things a
comment can get wrong: (a) the pin quietly disappearing, and (b) the comment
drifting back to a claim the code does not support. The harness's CLAIM 1/2
poles are additionally mutated at the migration level to prove they are not
vacuous.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
C = "scripts/migration_chain_check.mjs"
M123 = "migrations/0123_wave0_platform_config.sql"
M0 = "migrations/0000_numerous_roxanne_simpson.sql"

MUTATIONS = [
    Mutation(
        name="M1-pin-removed",
        target=C,
        anchor='const PRE_EXISTING_POSTCONDITION = new Set(["0000"]);',
        replacement="const PRE_EXISTING_POSTCONDITION = new Set([]);",
        why="the pin is dropped instead of re-justified",
    ),
    Mutation(
        name="M2-retraction-erased",
        target=C,
        anchor="// WAVE 23 · ITEM 4 — THIS JUSTIFICATION IS A CORRECTION. The pin STAYS; the",
        replacement="// The pin stays.",
        why="the correction notice is quietly removed",
    ),
    Mutation(
        name="M3-residual-risk-dropped",
        target=C,
        anchor="// RESIDUAL RISK, STATED RATHER THAN HIDDEN. Any path that runs the numbered",
        replacement="// Any path that runs the numbered",
        why="the residual no-baseline risk stops being stated",
    ),
    Mutation(
        name="M4-reason-vague-again",
        target=C,
        anchor="// is a NO-OP: `IF NOT EXISTS` cannot replace, alter, or transform an existing",
        replacement="// is skipped, which is fine, because it is superseded and cannot affect an existing",
        why="the mechanism (why 0123 cannot supersede) is replaced with hand-waving",
    ),
    Mutation(
        name="M5-claim1-would-be-false",
        target=M123,
        anchor="CREATE TABLE IF NOT EXISTS platform_config (",
        replacement="CREATE TABLE platform_config (",
        why="proves CLAIM 3 is not vacuous — it reads the real migration text",
    ),
    Mutation(
        name="M6-0000-shape-changed",
        target=M0,
        anchor="\t`prev_hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,\n\t`hash` text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`updated_by` text DEFAULT 'system' NOT NULL\n);",
        replacement="\t`prev_revision_hash` text NOT NULL,\n\t`revision_hash` text NOT NULL,\n\t`updated_at` text NOT NULL,\n\t`updated_by` text DEFAULT 'system' NOT NULL\n);",
        why="proves CLAIM 1/3 read 0000's ACTUAL columns rather than a hardcoded list",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave23/item4_platform_config_pin_harness.ts"],
            MUTATIONS,
            "ITEM4",
        )
    )
