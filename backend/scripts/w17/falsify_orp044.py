#!/usr/bin/env python3
"""
WAVE 17 — falsification harness for ORP-044 (the three milestone auto-triggers).

A green suite proves nothing unless it goes red when the code is wrong. Each
mutation below removes or corrupts exactly one thing the suite claims to prove;
the harness asserts the suite FAILS for each, then restores the tree byte-for-byte
and re-asserts the clean pass.

Run from the repo root:  python3 scripts/w17/falsify_orp044.py
"""
import subprocess
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = "server/__tests__/wave17_milestone_auto_triggers.test.ts"

TRIG = ROOT / "server/lib/wave17MilestoneAutoTriggers.ts"
ROUTE = ROOT / "server/roundCarryForwardRoutes.ts"
CASCADE = ROOT / "server/lib/roundCloseCascade.ts"
MA = ROOT / "server/maIntelligenceStore.ts"
BRIDGE = ROOT / "server/bridgeStore.ts"
STORE = ROOT / "server/milestoneBroadcastStore.ts"

FILES = [TRIG, ROUTE, CASCADE, MA, BRIDGE, STORE]


def run_suite():
    p = subprocess.run(
        ["npx", "vitest", "run", SUITE],
        cwd=ROOT, capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if m:
        return int(m.group(1) or 0), int(m.group(2))
    # A collection/type error is also a failure signal.
    return -1, -1


def snapshot():
    return {f: f.read_text() for f in FILES}


def restore(snap):
    for f, text in snap.items():
        f.write_text(text)


MUTATIONS = [
    # (label, file, old, new)
    (
        "route close path: delete the round_closed trigger call",
        ROUTE,
        "      if (!result.alreadyClosed) {\n        fireAutoBroadcast({",
        "      if (false && !result.alreadyClosed) {\n        fireAutoBroadcast({",
    ),
    (
        "cascade/sweeper path: delete the SECOND round_closed trigger call",
        CASCADE,
        "  try {\n    fireAutoBroadcast({\n      companyId: result.companyId,",
        "  try {\n    if (false) fireAutoBroadcast({\n      companyId: result.companyId,",
    ),
    (
        "M&A: fire for discussion-only initiatives too",
        MA,
        'if (eventType === "ma_initiative_started") {',
        "if (true) {",
    ),
    (
        "governance: unhook the observer from the bridge emit",
        BRIDGE,
        "  try {\n    maybeBroadcastGovernanceMetric({",
        "  try {\n    if (false) maybeBroadcastGovernanceMetric({",
    ),
    (
        "registry: never arm the dispatcher from route registration",
        STORE,
        "  registerMilestoneAutoDispatcher(dispatchAutoBroadcast);",
        "  void registerMilestoneAutoDispatcher; void dispatchAutoBroadcast;",
    ),
    (
        "idempotency: make the dedupe lookup always miss",
        STORE,
        "export function findByAutoTriggerKey(key: string): MilestoneBroadcast | undefined {\n  if (!key) return undefined;",
        "export function findByAutoTriggerKey(key: string): MilestoneBroadcast | undefined {\n  if (key) return undefined;",
    ),
    (
        "money: default a missing final amount to zero",
        TRIG,
        "      ? formatMinor(input.finalAmountMinor, String(input.currency ?? \"USD\").toUpperCase())\n      : null;",
        "      ? formatMinor(input.finalAmountMinor, String(input.currency ?? \"USD\").toUpperCase())\n      : formatMinor(0, String(input.currency ?? \"USD\").toUpperCase());",
    ),
    (
        "money: replace the ISO-exponent formatter with a hardcoded /100",
        TRIG,
        "      ? formatMinor(input.finalAmountMinor, String(input.currency ?? \"USD\").toUpperCase())",
        "      ? `$${(input.finalAmountMinor / 100).toLocaleString()}`",
    ),
    (
        "privacy: leak the M&A topic into the company-wide body",
        TRIG,
        '    "A lead M&A initiative has been opened for this company. Detail is available only to holders " +',
        '    "A lead M&A initiative has been opened for this company: Acquisition by Northwind. Detail is available only to holders " +',
    ),
    (
        "unregistered pole: report success when nothing is registered",
        TRIG,
        '    return { ok: false, reason: "dispatcher_unregistered" };',
        '    return { ok: true, reason: "dispatcher_unregistered" };',
    ),
]


def main():
    snap = snapshot()
    print("baseline …", flush=True)
    failed, passed = run_suite()
    print(f"  baseline: {failed} failed / {passed} passed")
    if failed != 0 or passed <= 0:
        print("ABORT — the suite is not green before mutation.")
        return 1

    results = []
    for label, path, old, new in MUTATIONS:
        text = path.read_text()
        if old not in text:
            restore(snap)
            print(f"  !! anchor not found for: {label}")
            results.append((label, None))
            continue
        path.write_text(text.replace(old, new, 1))
        f, p = run_suite()
        restore(snap)
        detected = f != 0
        print(f"  {'DETECTED' if detected else 'MISSED  '}  {f} failed / {p} passed  ·  {label}")
        results.append((label, f))

    print("\nrestoring and re-running clean …", flush=True)
    restore(snap)
    f, p = run_suite()
    print(f"  after restore: {f} failed / {p} passed")

    missed = [l for l, f in results if f is None or f == 0]
    if missed:
        print("\nMUTATIONS NOT DETECTED (the suite is not proving these):")
        for l in missed:
            print("  -", l)
        return 2
    if f != 0:
        print("\nTREE NOT RESTORED CLEANLY")
        return 3
    print("\nALL MUTATIONS DETECTED · tree restored · suite green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
