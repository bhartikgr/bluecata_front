#!/usr/bin/env python3
"""
WAVE 19 — falsification harness for FE-18 (partner agreement signature state).

Mutation 1 and mutation 2 are the ORIGINAL defective expressions, restored
verbatim. If the suite does not go red on those two, it is not evidence about
this item at all, whatever else it asserts.

Run from the repo root:  python3 scripts/w19/falsify_fe18.py
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SUITE = "client/src/pages/partner/__tests__/wave19_fe18_partner_agreement_state.test.tsx"

PAGE = ROOT / "client/src/pages/partner/PartnerAgreementSign.tsx"
FILES = [PAGE]


def run(suite: str):
    p = subprocess.run(["npx", "vitest", "run", suite], cwd=ROOT, capture_output=True, text=True)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if m:
        return int(m.group(1) or 0), int(m.group(2))
    m = re.search(r"Tests\s+(\d+) failed\b", out)
    if m:
        return int(m.group(1)), 0
    if "No test files found" in out:
        return -1, -1
    return 999, 0


def snapshot():
    return {f: f.read_text() for f in FILES}


def restore(snap):
    for f, text in snap.items():
        f.write_text(text)


MUTATIONS = [
    (
        "DEFECT 1 RESTORED: a non-403 failure falls through to a SIGNABLE agreement",
        PAGE,
        "  const loadFailed = isError && !isForbidden;",
        "  const loadFailed = false;",
    ),
    (
        "the refusal element is removed but the gate is kept (rule 3: nothing rendered)",
        PAGE,
        'data-testid="partner-agreement-load-failed"',
        'data-testid="partner-agreement-load-failed-REMOVED"',
    ),
    (
        "the refusal renders but the sign form renders UNDER it",
        PAGE,
        "          {!isLoading && !loadFailed && (",
        "          {!isLoading && (",
    ),
    (
        "the retry no longer re-issues the request",
        PAGE,
        "onClick={() => { void refetch(); }}",
        "onClick={() => undefined}",
    ),
    # WITHDRAWN — "OVER-CORRECTION: 403 is swallowed by the new refusal".
    # Reported MISSED on the first run; investigated instead of patched around.
    # The mutation is a genuine no-op: `loadFailed` is only ever read inside the
    # `{!isForbidden && <Card>}` wrapper, so within that scope
    # `isError && !isForbidden` and `isError` are the same value. The 403 path is
    # covered by its own test (the pre-existing managing-partner copy must still
    # render, and the refusal must not), and the `!isForbidden` term is kept as
    # defence in depth against a future restructure. A mutation that cannot
    # change behaviour must not be counted as detected OR as missed.
    (
        "OVER-CORRECTION: a SUCCESSFUL load is treated as failed (nobody can ever sign)",
        PAGE,
        "  const loadFailed = isError && !isForbidden;",
        "  const loadFailed = !isForbidden;",
    ),
    (
        "DEFECT 2 RESTORED: a superseded signature is silently dropped again",
        PAGE,
        "  const hasSupersededSignature = !!data?.signed && !data?.signedCurrent;",
        "  const hasSupersededSignature = false;",
    ),
    (
        "the superseded notice fires when the CURRENT version is signed (a false alarm)",
        PAGE,
        "  const hasSupersededSignature = !!data?.signed && !data?.signedCurrent;",
        "  const hasSupersededSignature = !!data?.signed;",
    ),
    (
        "the superseded notice fires for a partner who has NEVER signed",
        PAGE,
        "  const hasSupersededSignature = !!data?.signed && !data?.signedCurrent;",
        "  const hasSupersededSignature = !data?.signedCurrent;",
    ),
    (
        "the raw versions go back through the constant-returning display helper",
        PAGE,
        '                    Signed: <span className="font-mono">{data?.signedVersion ?? "not recorded"}</span>\n'
        '                    {" · "}Current: <span className="font-mono">{version}</span>',
        '                    Signed: <span className="font-mono">{displayAgreementVersion(data?.signedVersion)}</span>\n'
        '                    {" · "}Current: <span className="font-mono">{displayAgreementVersion(version)}</span>',
    ),
    (
        "a null signedVersion renders as the literal string 'null'",
        PAGE,
        '{data?.signedVersion ?? "not recorded"}',
        "{String(data?.signedVersion)}",
    ),
    (
        "OVER-CORRECTION: the superseded notice BLOCKS signing the current version",
        PAGE,
        "              {effectiveSignedAt ? (",
        "              {effectiveSignedAt || hasSupersededSignature ? (",
    ),
    (
        "the pre-existing 403 managing-partner copy is reworded",
        PAGE,
        "The partner agreement is signed by your managing partner.",
        "You cannot sign this.",
    ),
    (
        "the pre-existing counsel footnote is reworded (a silent copy drop)",
        PAGE,
        "This document is provided for review by counsel and does not\n                constitute legal advice.",
        "For review only.",
    ),
    (
        "the pre-existing cannot-sign notice is reworded",
        PAGE,
        "Only your managing partner can sign the Consortium Partner Agreement.",
        "Not allowed.",
    ),
    (
        "the signed block stops naming when the agreement was signed",
        PAGE,
        "signed on {formatDate(effectiveSignedAt)}.",
        "signed.",
    ),
]


def main():
    snap = snapshot()
    pre = {f: hashlib.sha256(f.read_bytes()).hexdigest() for f in FILES}

    bad = []
    for label, path, old, _new in MUTATIONS:
        n = path.read_text().count(old)
        if n != 1:
            bad.append(f"  anchor for {label!r} occurs {n}x in {path.name} (must be exactly 1)")
    if bad:
        print("ANCHOR FENCE FAILED:")
        print("\n".join(bad))
        return 2

    f, p = run(SUITE)
    print(f"=== baseline: {f} failed / {p} passed")
    if f != 0 or p <= 0:
        print("BASELINE NOT GREEN — aborting.")
        restore(snap)
        return 2

    detected, missed = 0, []
    for i, (label, path, old, new) in enumerate(MUTATIONS, 1):
        path.write_text(path.read_text().replace(old, new, 1))
        f, p = run(SUITE)
        restore(snap)
        ok = f > 0
        if ok:
            detected += 1
        else:
            missed.append(label)
        print(f"[{i:2}/{len(MUTATIONS)}] {'DETECTED' if ok else 'MISSED  '}  {label}  ({f} failed / {p} passed)")

    restore(snap)
    post = {f: hashlib.sha256(f.read_bytes()).hexdigest() for f in FILES}
    clean = pre == post
    print()
    print(f"RESULT: {detected}/{len(MUTATIONS)} detected")
    print(f"tree restored byte-identically: {clean}")
    for m in missed:
        print(f"  MISSED: {m}")
    return 0 if (detected == len(MUTATIONS) and clean) else 1


if __name__ == "__main__":
    sys.exit(main())
