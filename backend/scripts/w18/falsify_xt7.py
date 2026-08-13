#!/usr/bin/env python3
"""
WAVE 18 — falsification harness for XT-7 (partner surface on the SSE topics).

Every mutation reverts one thing the item relies on: the scope-conditional bail,
the omitted chapter_id, the per-topic authorization, the partner-scoped
subscription, and each page's subscription and its reaction to a frame. The
suite that claims to cover it must go RED.

Run from the repo root:  python3 scripts/w18/falsify_xt7.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_SUITE = "server/__tests__/wave18_xt7_partner_stream.test.ts"
CLIENT_SUITE = "client/src/lib/__tests__/wave18_xt7_partner_stream_scope.test.tsx"
LEGACY_SUITE = "server/__tests__/ssePartnerAuth.test.ts"

SSECLIENT = ROOT / "client/src/lib/sseClient.ts"
SSEROUTES = ROOT / "server/collectiveSseRoutes.ts"
SPVPAGE = ROOT / "client/src/pages/partner/PartnerSpvEngine.tsx"
CRMPAGE = ROOT / "client/src/pages/partner/PartnerContacts.tsx"

FILES = [SSECLIENT, SSEROUTES, SPVPAGE, CRMPAGE]


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


# (label, suite, file, old, new)
MUTATIONS = [
    (
        "hook: bail on an empty chapterId regardless of scope (the original blocker)",
        CLIENT_SUITE,
        SSECLIENT,
        'if (scope === "chapter" && !chapterId) return;',
        "if (!chapterId) return;",
    ),
    (
        "hook: send chapter_id even in partner scope (server enters chapter scope)",
        CLIENT_SUITE,
        SSECLIENT,
        '            `${path}?topics=${encodeURIComponent(topicsParam)}`',
        '            `${path}?chapter_id=${encodeURIComponent(chapterId)}&topics=${encodeURIComponent(topicsParam)}`',
    ),
    (
        "hook: partner scope silently falls back to the Collective endpoint",
        CLIENT_SUITE,
        SSECLIENT,
        'const path = args.path ?? "/api/collective/stream";',
        'const path = "/api/collective/stream";',
    ),
    (
        "hook: stop registering the named `spv` listener (frames arrive, nothing hears them)",
        CLIENT_SUITE,
        SSECLIENT,
        '        "spv",\n        "crm",',
        '        "crm",',
    ),
    (
        "hook: leak the socket on unmount",
        CLIENT_SUITE,
        SSECLIENT,
        "      if (es) {\n        try { es.close(); } catch { /* noop */ }\n        es = null;\n      }\n    };\n    // We intentionally re-open",
        "      /* leaked */\n    };\n    // We intentionally re-open",
    ),
    (
        "server: drop `spv` from PARTNER_TOPICS (partner loses its own topic)",
        SERVER_SUITE,
        SSEROUTES,
        '  "crm",\n  "spv",\n]);',
        '  "crm",\n]);',
    ),
    (
        # First draft of this mutation only ADDED "spv" to ANY_OF_TOPICS while
        # leaving it in PARTNER_TOPICS. That was an unreachable no-op — the
        # authorization loop checks PARTNER_TOPICS first and `continue`s — so it
        # was reported MISSED when nothing was actually broken. It now MOVES the
        # topic, which is the real widening.
        "server: MOVE `spv` from PARTNER_TOPICS to ANY_OF_TOPICS (a Collective member reads partner vehicles)",
        SERVER_SUITE,
        SSEROUTES,
        '  "crm",\n  "spv",\n]);\n\nconst ANY_OF_TOPICS: ReadonlySet<SseTopic> = new Set<SseTopic>([\n  "collective-portfolio",',
        '  "crm",\n]);\n\nconst ANY_OF_TOPICS: ReadonlySet<SseTopic> = new Set<SseTopic>([\n  "spv",\n  "collective-portfolio",',
    ),
    (
        "server: subscribe partner topics on the CHAPTER id instead of the partner id",
        SERVER_SUITE,
        SSEROUTES,
        "        subscribe({ userId, chapterId: partnerScope, topics: partnerOnlyTopics }),",
        "        subscribe({ userId, chapterId, topics: partnerOnlyTopics }),",
    ),
    (
        "server: let a borrowed partner_id through (cross-tenant subscription)",
        SERVER_SUITE,
        SSEROUTES,
        '    res.status(403).json({ ok: false, error: "partner_id_mismatch" });\n    return;',
        "    /* mismatch accepted */;",
    ),
    (
        "server: answer 200 with an empty stream when no topic is authorized",
        SERVER_SUITE,
        SSEROUTES,
        '    res.status(403).json({ ok: false, error: "no_authorized_topics" });\n    return;',
        '    res.status(200).json({ ok: true, topics: [] });\n    return;',
    ),
    (
        "spv page: unmount the subscription",
        CLIENT_SUITE,
        SPVPAGE,
        "  useCollectiveStream({\n    chapterId: \"\",\n    scope: \"partner\",",
        "  /* useCollectiveStream({\n    chapterId: \"\",\n    scope: \"partner\",",
    ),
    (
        "spv page: receive frames but never invalidate (stale-but-confident)",
        CLIENT_SUITE,
        SPVPAGE,
        '      qc.invalidateQueries({ queryKey: ["/api/partner/me/spv"] });\n      if (spvId) qc.invalidateQueries({ queryKey: ["/api/partner/me/spv", spvId] });',
        "      /* no refetch */;",
    ),
    (
        "crm page: unmount the subscription",
        CLIENT_SUITE,
        CRMPAGE,
        "  useCollectiveStream({\n    chapterId: \"\",\n    scope: \"partner\",",
        "  /* useCollectiveStream({\n    chapterId: \"\",\n    scope: \"partner\",",
    ),
    (
        "crm page: receive frames but never invalidate",
        CLIENT_SUITE,
        CRMPAGE,
        '      qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts"] });\n      if (contactId) qc.invalidateQueries({ queryKey: ["/api/partner/me/crm/contacts", contactId] });',
        "      /* no refetch */;",
    ),
    (
        "legacy: the CP-034 suite is still a live fence on the topic matrix",
        LEGACY_SUITE,
        SSEROUTES,
        'const PARTNER_TOPICS: ReadonlySet<SseTopic> = new Set<SseTopic>([\n  "partner-workspace",',
        "const PARTNER_TOPICS: ReadonlySet<SseTopic> = new Set<SseTopic>([\n",
    ),
]


def main() -> int:
    snap = snapshot()
    suites = (SERVER_SUITE, CLIENT_SUITE, LEGACY_SUITE)
    print("baseline …", flush=True)
    base = {}
    for suite in suites:
        f, p = run(suite)
        base[suite] = (f, p)
        print(f"  {suite}: {f} failed / {p} passed")
        if f != 0 or p <= 0:
            print("ABORT — a suite is not green before mutation.")
            return 1

    results = []
    for label, suite, path, old, new in MUTATIONS:
        text = path.read_text()
        if old not in text:
            restore(snap)
            print(f"  !! ANCHOR NOT FOUND  ·  {label}")
            results.append((label, None))
            continue
        path.write_text(text.replace(old, new, 1))
        f, p = run(suite)
        restore(snap)
        verdict = "DETECTED" if f not in (0, -1) else "MISSED  "
        print(f"  {verdict}  {f} failed / {p} passed  ·  {label}", flush=True)
        results.append((label, f))

    print("\nrestoring and re-running clean …", flush=True)
    restore(snap)
    ok = True
    for suite in suites:
        f, p = run(suite)
        print(f"  after restore {suite}: {f} failed / {p} passed")
        if f != 0 or p != base[suite][1]:
            ok = False

    missed = [l for l, ff in results if ff is None or ff in (0, -1)]
    if missed:
        print("\nMUTATIONS NOT DETECTED:")
        for l in missed:
            print("  -", l)
        return 2
    if not ok:
        print("\nTREE NOT RESTORED CLEANLY")
        return 3
    print(f"\nALL {len(results)} MUTATIONS DETECTED · tree restored · suites green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
