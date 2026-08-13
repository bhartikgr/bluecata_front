#!/usr/bin/env python3
"""WAVE 21 — shared mutation-matrix runner.

Why this exists: the first ITEM 1 attempt used `perl -0pi -e`, and shell/perl
interpolation silently corrupted one mutation into a *syntax error*. The
harness then "caught" it for the wrong reason. That is exactly the class of
vacuous check this wave is closing, so mutations are applied here as EXACT
string replacements with three hard preconditions:

  1. the anchor must occur EXACTLY ONCE in the target (else: ANCHOR-ERROR);
  2. the replacement must actually change the file (else: NOT-APPLIED);
  3. the mutated tree must still COMPILE / the harness must fail on an
     ASSERTION, not on a crash — enforced by `assert_mode`.

Usage: import and call `run_matrix(...)`.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Mutation:
    name: str
    target: str          # path relative to repo root
    anchor: str          # exact substring, must appear exactly once
    replacement: str
    why: str


def _run(cmd: list[str], cwd: Path) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def run_matrix(
    root: Path,
    harness_cmd: list[str],
    mutations: list[Mutation],
    label: str,
    crash_markers: tuple[str, ...] = (
        "Transform failed",
        "SyntaxError",
        "Unterminated",
        "ReferenceError",
        "Cannot find module",
        "TSError",
    ),
) -> int:
    problems = 0
    backups: dict[str, str] = {}
    targets = {m.target for m in mutations}
    for t in targets:
        fd = tempfile.NamedTemporaryFile(delete=False, suffix=".bak")
        fd.close()
        shutil.copy(root / t, fd.name)
        backups[t] = fd.name

    def restore_all() -> None:
        for t, b in backups.items():
            shutil.copy(b, root / t)

    try:
        rc, out = _run(harness_cmd, root)
        if rc == 0:
            print(f"{'CONTROL':<28} expect=PASS   got=PASS   OK")
        else:
            print(f"{'CONTROL':<28} expect=PASS   got=FAIL   HARNESS-BUG")
            print(out[-2000:])
            problems += 1

        for m in mutations:
            path = root / m.target
            original = Path(backups[m.target]).read_text()
            n = original.count(m.anchor)
            if n != 1:
                print(f"{m.name:<28} ANCHOR-ERROR occurrences={n} (must be exactly 1)")
                problems += 1
                continue
            mutated = original.replace(m.anchor, m.replacement)
            if mutated == original:
                print(f"{m.name:<28} NOT-APPLIED (replacement identical to anchor)")
                problems += 1
                continue
            path.write_text(mutated)
            try:
                rc, out = _run(harness_cmd, root)
            finally:
                restore_all()

            crashed = next((c for c in crash_markers if c in out), None)
            # RUNNER BUG found during ITEM 4 (2026-08-11): this counted only
            # `FAIL` at column 0. The ITEM 4 harness indents its assertion
            # lines, so 13 genuinely-caught mutations were reported as
            # NONZERO-NO-ASSERTION. Left as a comment because a mutation runner
            # that miscounts is the same failure class it exists to detect.
            # `FAIL ` with the trailing space excludes summary lines like
            # "ITEM4 HARNESS: FAIL".
            fail_lines = sum(1 for l in out.splitlines() if l.lstrip().startswith("FAIL "))
            if crashed:
                print(
                    f"{m.name:<28} expect=CAUGHT got=CRASH  **INVALID MUTATION** "
                    f"({crashed}) — mutation must be syntactically valid"
                )
                problems += 1
            elif rc != 0 and fail_lines > 0:
                print(
                    f"{m.name:<28} expect=CAUGHT got=CAUGHT OK   "
                    f"({fail_lines} failing assertion(s))  [{m.why}]"
                )
            elif rc != 0:
                print(
                    f"{m.name:<28} expect=CAUGHT got=NONZERO-NO-ASSERTION "
                    f"**SUSPECT** — harness exited {rc} without a FAIL line"
                )
                problems += 1
            else:
                print(f"{m.name:<28} expect=CAUGHT got=MISSED **COVERAGE GAP**  [{m.why}]")
                problems += 1
    finally:
        restore_all()
        for b in backups.values():
            Path(b).unlink(missing_ok=True)

    print()
    if problems == 0:
        print(f"{label} MUTATION MATRIX: OK ({len(mutations)}/{len(mutations)} caught, control passes)")
    else:
        print(f"{label} MUTATION MATRIX: {problems} PROBLEM(S)")
    return problems


if __name__ == "__main__":
    sys.exit("import this module; do not run directly")
