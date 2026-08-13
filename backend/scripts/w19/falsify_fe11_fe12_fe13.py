#!/usr/bin/env python3
"""
WAVE 19 — falsification harness for FE-11, FE-12 and FE-13.

Each mutation reverts one load-bearing part of one item; the suite that claims
to cover it must go RED. Mutations include the ORIGINAL defective code for each
item, so a green run means the suite would have caught the bug it was written
for — the only claim worth making.

Run from the repo root:  python3 scripts/w19/falsify_fe11_fe12_fe13.py
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SUITE = "client/src/pages/partner/__tests__/wave19_fe11_fe12_fe13_partner_surfaces.test.tsx"
W4_SUITE = "client/src/pages/partner/__tests__/wave18_w4_spv_empty_vs_failed.test.tsx"
DM_SUITE = "client/src/pages/partner/__tests__/PartnerMessages.newDm.test.tsx"

DEALROOM = ROOT / "client/src/pages/collective/CollectiveDealRoom.tsx"
POSTS = ROOT / "client/src/pages/partner/PartnerPosts.tsx"
DETAIL = ROOT / "client/src/pages/PostDetail.tsx"
MSGS = ROOT / "client/src/components/comms/MessagesPage.tsx"
PARTNERMSGS = ROOT / "client/src/pages/partner/PartnerMessages.tsx"

FILES = [DEALROOM, POSTS, DETAIL, MSGS, PARTNERMSGS]


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
    # A transform/type error that stops the file loading is still a RED suite,
    # but it is not evidence about behaviour, so it is reported distinctly.
    if "Error" in out or "error" in out:
        return 998, 0
    return 999, 0


def snapshot():
    return {f: f.read_text() for f in FILES}


def restore(snap):
    for f, text in snap.items():
        f.write_text(text)


MUTATIONS = [
    # ---------------- FE-11 ----------------
    (
        "FE-11: the `error` short-circuit is removed (a failed load gets two diagnoses)",
        SUITE,
        DEALROOM,
        "            error ? null : !isSuccess ? (",
        "            false ? null : !isSuccess ? (",
    ),
    (
        "FE-11: the empty state is not gated on `isSuccess` (paused query fabricates zero)",
        SUITE,
        DEALROOM,
        "            error ? null : !isSuccess ? (",
        "            error ? null : false ? (",
    ),
    (
        "FE-11: the added refusal element is removed (gate tightened, nothing rendered)",
        SUITE,
        DEALROOM,
        'data-testid="dealroom-load-failed"',
        'data-testid="dealroom-load-failed-REMOVED"',
    ),
    (
        "FE-11: the retry button no longer refetches",
        SUITE,
        DEALROOM,
        "onClick={() => { void refetch(); }}",
        "onClick={() => undefined}",
    ),
    (
        "FE-11: the PRE-EXISTING error copy is swallowed by the new block",
        SUITE,
        DEALROOM,
        'data-testid="error-dealroom">\n              Failed to load Deal Room data. Please refresh.',
        'data-testid="error-dealroom">\n              Something went wrong.',
    ),
    # ---------------- FE-12 ----------------
    (
        "FE-12: the ORIGINAL defect — the :id path falls through to the feed",
        SUITE,
        POSTS,
        '  if (isDetail && (detailParams?.id ?? "").length > 0) {',
        "  if (false) {",
    ),
    (
        "FE-12: the detail route pattern reverts to the role-based one that cannot match",
        SUITE,
        DETAIL,
        "useRoute<{ id: string }>(routePattern ?? `/${role}/posts/:id`)",
        "useRoute<{ id: string }>(`/${role}/posts/:id`)",
    ),
    (
        "FE-12: the partner pattern is wrong, so postId is empty and the page is blank",
        SUITE,
        POSTS,
        'export const PARTNER_POST_DETAIL_ROUTE = `${PARTNER_POSTS_BASE}/posts/:id`;',
        'export const PARTNER_POST_DETAIL_ROUTE = `${PARTNER_POSTS_BASE}/entries/:id`;',
    ),
    # WITHDRAWN — "FE-12: a trailing slash renders a blank detail page".
    # The first run reported this MISSED. Investigated rather than deleted: the
    # premise was false. wouter compiles patterns with `regexparam`, and
    # `parse("/collective/partner/posts/:id").pattern.exec(".../posts/")`
    # returns null (measured directly). `isDetail` is therefore already false
    # for a trailing slash, the `.length > 0` guard is unreachable
    # belt-and-braces, and mutating it away is a genuine no-op — not a hole in
    # the suite. The BEHAVIOUR is still covered by a positive-pole test, whose
    # comment has been corrected to say why. A mutation that cannot change
    # behaviour must not be counted as detected OR as missed; it is removed and
    # recorded here instead.
    (
        "FE-12: the shell title stops distinguishing a post from the list",
        SUITE,
        POSTS,
        '<PartnerShell title="Post"',
        '<PartnerShell title="Posts"',
    ),
    (
        "FE-12: the partner back link leaves the partner shell",
        SUITE,
        POSTS,
        "          href={PARTNER_POSTS_LIST_PATH}",
        '          href={"/investor/posts"}',
    ),
    (
        "FE-12: GUARD REGRESSION — the shared page's literal breadcrumb copy is swallowed",
        SUITE,
        DETAIL,
        '<ArrowLeft className="h-3.5 w-3.5 mr-1" /> Network Posts',
        '<ArrowLeft className="h-3.5 w-3.5 mr-1" /> {backLabel ?? "Posts"}',
    ),
    (
        "FE-12: the feed loses its partner basePath, so clicks leave the shell again",
        SUITE,
        POSTS,
        '<PostsFeed role="investor" basePath={PARTNER_POSTS_BASE} />',
        '<PostsFeed role="investor" />',
    ),
    # ---------------- FE-13 ----------------
    (
        "FE-13: the ORIGINAL defect — the channel-list empty state is gated only on !isLoading",
        SUITE,
        MSGS,
        "{!channels.isLoading && !channels.isError && channels.isSuccess && filteredList.length === 0",
        "{!channels.isLoading && filteredList.length === 0",
    ),
    (
        "FE-13: the channel-list refusal element is removed",
        SUITE,
        MSGS,
        'data-testid="channels-load-failed"',
        'data-testid="channels-load-failed-REMOVED"',
    ),
    (
        "FE-13: the channel-list retry no longer refetches",
        SUITE,
        MSGS,
        "onClick={() => { void channels.refetch(); }}",
        "onClick={() => undefined}",
    ),
    (
        "FE-13: the SECOND sink (thread body) regresses",
        SUITE,
        MSGS,
        "{!channelDetail.isLoading && !channelDetail.isError && channelDetail.isSuccess",
        "{!channelDetail.isLoading && true",
    ),
    (
        "FE-13: the THIRD sink (dataroom picker) regresses",
        SUITE,
        MSGS,
        "{!dataroomFiles.isLoading && !dataroomFiles.isError && dataroomFiles.isSuccess",
        "{!dataroomFiles.isLoading && true",
    ),
    (
        "FE-13: the pre-existing empty copy is reworded (a silent copy drop)",
        SUITE,
        MSGS,
        "No conversations yet.",
        "Nothing here.",
    ),
    (
        "FE-13: start-a-DM (already shipped) is removed while 'fixing' the empty state",
        DM_SUITE,
        PARTNERMSGS,
        'data-testid="partner-new-dm-button"',
        'data-testid="partner-new-dm-button-REMOVED"',
    ),
]


def main():
    snap = snapshot()
    pre = {f: hashlib.sha256(f.read_bytes()).hexdigest() for f in FILES}

    bad = []
    for label, _s, path, old, _new in MUTATIONS:
        n = path.read_text().count(old)
        if n != 1:
            bad.append(f"  anchor for {label!r} occurs {n}x in {path.name} (must be exactly 1)")
    if bad:
        print("ANCHOR FENCE FAILED — a mutation would hit the wrong site or no site:")
        print("\n".join(bad))
        return 2

    print("=== baseline ===")
    for s in [SUITE, W4_SUITE, DM_SUITE]:
        f, p = run(s)
        print(f"  {s}: {f} failed / {p} passed")
        if f != 0 or p <= 0:
            print("BASELINE NOT GREEN — aborting.")
            restore(snap)
            return 2

    detected, missed = 0, []
    for i, (label, suite, path, old, new) in enumerate(MUTATIONS, 1):
        path.write_text(path.read_text().replace(old, new, 1))
        f, p = run(suite)
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
    if missed:
        print("MISSED:")
        for m in missed:
            print(f"  - {m}")
    return 0 if (detected == len(MUTATIONS) and clean) else 1


if __name__ == "__main__":
    sys.exit(main())
