#!/usr/bin/env python3
"""
WAVE 17 — falsification harness for ORP-039 (collective member billing surface).

Each mutation breaks exactly one claim; the suite must go RED for every one.
The money mutations matter most: a hardcoded /100 must be caught by the JPY
assertions, and dropping the per-currency grouping must be caught by the totals.

Run from the repo root:  python3 scripts/w17/falsify_orp039.py
"""
import subprocess
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = "client/src/components/collective/__tests__/MemberBillingPanel.test.tsx"
PANEL = ROOT / "client/src/components/collective/MemberBillingPanel.tsx"
FILES = [PANEL]


def run_suite():
    p = subprocess.run(["npx", "vitest", "run", SUITE], cwd=ROOT, capture_output=True, text=True)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if m:
        return int(m.group(1) or 0), int(m.group(2))
    return -1, -1


def snapshot():
    return {f: f.read_text() for f in FILES}


def restore(snap):
    for f, text in snap.items():
        f.write_text(text)


MUTATIONS = [
    (
        "quote line: divide minor units by a hardcoded 100 instead of formatMinor",
        PANEL,
        "{formatMinor(l.resolved.amountMinor, l.resolved.currency)}",
        "{`${l.resolved.currency} ${(l.resolved.amountMinor / 100).toFixed(2)}`}",
    ),
    (
        "entry row: hardcoded /100 on the ledger amount",
        PANEL,
        "<span className=\"font-medium\">{formatMinor(e.amountMinor, e.currency)}</span>",
        "<span className=\"font-medium\">{`${e.currency} ${(e.amountMinor / 100).toFixed(2)}`}</span>",
    ),
    (
        "invoice row: hardcoded /100 on the invoice total",
        PANEL,
        "<span className=\"font-medium\">{formatMinor(inv.totalMinor, inv.currency)}</span>",
        "<span className=\"font-medium\">{`${inv.currency} ${(inv.totalMinor / 100).toFixed(2)}`}</span>",
    ),
    (
        "quote totals: sum ACROSS currencies into one number",
        PANEL,
        "{Object.entries(quote.byCurrency ?? {}).map(([cur, minor]) => (",
        "{Object.entries({ ALL: Object.values(quote.byCurrency ?? {}).reduce((a, b) => a + b, 0) }).map(([cur, minor]) => (",
    ),
    (
        "unpriced line: fabricate a zero instead of saying it is not priced",
        PANEL,
        '{QUOTE_ERROR_COPY[String(l.error)] ?? "Not priced."}',
        '{"$0.00"}',
    ),
    (
        "quote refusal: swallow the error and render nothing",
        PANEL,
        "{quoteQ.isError && (",
        "{false && (",
    ),
    (
        "entries: drop the explicit empty state",
        PANEL,
        "{!entriesQ.isLoading && entries.length === 0 && (",
        "{false && (",
    ),
    (
        "invoices: drop the explicit empty state",
        PANEL,
        "{!invoicesQ.isLoading && invoices.length === 0 && (",
        "{false && (",
    ),
    (
        "entries: never call the endpoint (the uncalled-route regression)",
        PANEL,
        'queryFn: async () => (await apiRequest("GET", "/api/collective/me/payment-entries")).json(),',
        "queryFn: async () => ({ ok: true, entries: [], byCurrency: {}, total: 0 }),",
    ),
    (
        "invoices: never call the endpoint",
        PANEL,
        'queryFn: async () => (await apiRequest("GET", "/api/collective/me/invoices")).json(),',
        "queryFn: async () => ({ ok: true, invoices: [], total: 0 }),",
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
        print(f"  {'DETECTED' if f != 0 else 'MISSED  '}  {f} failed / {p} passed  ·  {label}")
        results.append((label, f))

    print("\nrestoring and re-running clean …", flush=True)
    restore(snap)
    f, p = run_suite()
    print(f"  after restore: {f} failed / {p} passed")

    missed = [l for l, ff in results if ff is None or ff == 0]
    if missed:
        print("\nMUTATIONS NOT DETECTED:")
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
