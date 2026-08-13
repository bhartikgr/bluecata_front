#!/usr/bin/env python3
"""
WAVE 26 — falsification harness for the S-3 second-path fix.

A test that passes proves nothing on its own; this build has FOURTEEN recorded
instances of a check that passed while checking nothing. So each mutation below
breaks the fix in a specific, plausible way and the harness asserts the test
suite goes RED. A mutation that is MISSED is reported as MISSED and is either a
harness bug or a genuine coverage gap — it is never quietly dropped.

Every mutation is applied to a COPY of the file content held in memory and the
original bytes are restored in a `finally`, so an interrupted run cannot leave
the tree mutated. The harness verifies the tree is byte-identical at exit.

Usage:  python3 scripts/w26/falsify_s3.py
"""
from __future__ import annotations
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "server" / "spvEngineStore.ts"
PANEL = ROOT / "client" / "src" / "components" / "partner" / "SpvOperationsPanels.tsx"

SERVER_TEST = "server/__tests__/wave26_s3_fee_state_second_path.test.ts"
CLIENT_TEST = "client/src/pages/partner/__tests__/wave26_s3_fee_state_render.test.tsx"


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_tests(spec: str) -> bool:
    """True when the suite is GREEN."""
    r = subprocess.run(
        ["npx", "vitest", "run", spec, "--reporter=basic"],
        cwd=ROOT, capture_output=True, text=True,
    )
    summary = [ln for ln in r.stdout.splitlines() if ln.strip().startswith("Tests ")]
    # A non-zero exit OR the word "failed" in the summary line means RED. Both
    # are checked: a mutation that makes the file fail to COMPILE exits non-zero
    # with no summary line at all, and that still counts as caught.
    if r.returncode != 0:
        return False
    if not summary:
        return False  # no tests ran — treat as red, never as a pass
    return "failed" not in summary[0]


# (name, file, find, replace, which test must go red)
MUTATIONS = [
    (
        "M1 predicate always trusts the fee view (the original Wave 5 blind spot)",
        STORE,
        "  feeViewUnreliable(spvId: string): boolean {\n    if (!feeStateUnknown()) return false;",
        "  feeViewUnreliable(spvId: string): boolean {\n    if (true) return false;\n    if (!feeStateUnknown()) return false;",
        SERVER_TEST,
    ),
    (
        "M2 predicate always distrusts (guard wedged shut = silent loss of function)",
        STORE,
        "  feeViewUnreliable(spvId: string): boolean {\n    if (!feeStateUnknown()) return false;",
        "  feeViewUnreliable(spvId: string): boolean {\n    if (true) return true;\n    if (!feeStateUnknown()) return false;",
        SERVER_TEST,
    ),
    (
        "M3 the probe half is dropped ('never_run' alone wedges the gate)",
        STORE,
        "    if (!probe.ok) return true; // fee table unreadable",
        "    if (true) return true; // fee table unreadable",
        SERVER_TEST,
    ),
    (
        "M4 feeBreakdown loses its guard (fabricated $0 fees return)",
        STORE,
        "    if (this.feeViewUnreliable(spvId)) {\n      return {\n        commitmentMinor,\n        managementFeeMinor: null,",
        "    if (false) {\n      return {\n        commitmentMinor,\n        managementFeeMinor: null,",
        SERVER_TEST,
    ),
    (
        "M5 feeBreakdown withholds with ZEROES instead of nulls",
        STORE,
        "        managementFeeMinor: null,\n        platformFeeMinor: null,\n        netDeployedMinor: null,",
        "        managementFeeMinor: 0,\n        platformFeeMinor: 0,\n        netDeployedMinor: commitmentMinor,",
        SERVER_TEST,
    ),
    (
        "M6 the PERSISTED distribution loses its guard (zero-carry money write)",
        STORE,
        '    if (this.feeViewUnreliable(spvId)) throw new Error("FEE_STATE_UNKNOWN");\n    if (!data.event)',
        '    if (!data.event)',
        SERVER_TEST,
    ),
    (
        "M7 the distribution PREVIEW loses its guard",
        STORE,
        '    if (this.feeViewUnreliable(spvId)) throw new Error("FEE_STATE_UNKNOWN");\n    const contributedMinor',
        "    const contributedMinor",
        SERVER_TEST,
    ),
    (
        "M8 fee accrual loses its guard (accrues nothing, reads as 'nothing owed')",
        STORE,
        '    if (this.feeViewUnreliable(spvId)) throw new Error("FEE_STATE_UNKNOWN");\n    const existing = feeObligationsBySpv',
        "    const existing = feeObligationsBySpv",
        SERVER_TEST,
    ),
    (
        "M9 the UI refusal banner is removed (fail-closed state not RENDERED)",
        PANEL,
        "      {bd && bd.feesUnknown === true ? (",
        "      {false ? (",
        CLIENT_TEST,
    ),
    (
        "M10 the UI banner is shown ALWAYS (noise; healthy pole must stay clean)",
        PANEL,
        "      {bd && bd.feesUnknown === true ? (",
        "      {bd ? (",
        CLIENT_TEST,
    ),
]


def main() -> int:
    originals = {p: p.read_bytes() for p in {STORE, PANEL}}
    before = {p: sha(p) for p in originals}

    print("=== WAVE 26 / S-3 falsification harness ===")
    print("baseline: both suites must be GREEN before any mutation is applied\n")
    for spec in (SERVER_TEST, CLIENT_TEST):
        ok = run_tests(spec)
        print(f"  baseline {spec}: {'GREEN' if ok else 'RED'}")
        if not ok:
            print("  ABORT — the harness cannot prove anything from a red baseline.")
            return 2
    print()

    caught, missed = [], []
    try:
        for name, path, find, repl, spec in MUTATIONS:
            src = originals[path].decode()
            if src.count(find) != 1:
                # An anchor that matches zero or many times is exactly the
                # inert-check failure mode this harness exists to prevent.
                missed.append((name, f"ANCHOR NOT UNIQUE (count={src.count(find)}) — harness bug"))
                print(f"  [ANCHOR] {name}: count={src.count(find)}")
                continue
            path.write_text(src.replace(find, repl), encoding="utf-8")
            green = run_tests(spec)
            path.write_bytes(originals[path])
            if green:
                missed.append((name, "suite stayed GREEN"))
                print(f"  [MISSED] {name}")
            else:
                caught.append(name)
                print(f"  [caught] {name}")
    finally:
        for p, b in originals.items():
            p.write_bytes(b)

    after = {p: sha(p) for p in originals}
    restored = all(before[p] == after[p] for p in originals)
    print(f"\ntree restored byte-identically: {restored}")
    print(f"caught {len(caught)}/{len(MUTATIONS)}   missed {len(missed)}")
    for n, why in missed:
        print(f"  MISSED: {n} — {why}")
    return 0 if (restored and not missed) else 1


if __name__ == "__main__":
    sys.exit(main())
