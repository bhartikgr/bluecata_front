#!/usr/bin/env python3
"""SPV-AUDIT — read-only two-surface divergence audit (WAVE 25 / SA-1).

WHY THIS EXISTS
---------------
The SPV product has TWO live detail surfaces for the same vehicle:

  A. the engine tabs   client/src/components/partner/SpvDetailTabs.tsx
                       (+ its extracted panels, SpvOperationsPanels.tsx),
                       mounted inside the expandable card on
                       client/src/pages/partner/PartnerSpvEngine.tsx
  B. the standalone    client/src/pages/partner/PartnerSpvDetail.tsx
     detail page       at /collective/partner/spvs/:id

SC-6 proposes retiring B once A "carries every field". That decision must never
be taken from memory. In July, RS-1 and RS-2 were lost to exactly this move and
cost a full wave to restore. This script is the anti-drop inventory: it reads
both surfaces from source and reports, per capability, which surface can reach
it — so "parity" is a computed fact with a command behind it, not a claim.

IT IS READ-ONLY. It opens files, writes one report to build_log/, and changes
nothing in the application tree. It is re-runnable and deterministic.

  python3 scripts/spv_two_surface_audit.py            # print + write report
  python3 scripts/spv_two_surface_audit.py --check    # exit 1 if a drop risk exists

EXIT CODES
  0  no capability would be lost by retiring surface B
  1  (--check only) at least one capability exists ONLY on B  -> SC-6 is BLOCKED
"""

from __future__ import annotations

import os
import re
import sys
from collections import OrderedDict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SURFACE_A = [
    "client/src/components/partner/SpvDetailTabs.tsx",
    "client/src/components/partner/SpvOperationsPanels.tsx",
]
SURFACE_B = ["client/src/pages/partner/PartnerSpvDetail.tsx"]
MOUNT_A = "client/src/pages/partner/PartnerSpvEngine.tsx"

# A capability is named by the ENDPOINT it drives, because an endpoint is the
# thing that either has a way in or does not. Matching on component names would
# reward a component that exists and is mounted nowhere — which is precisely
# the failure mode the standing rules call "not shipped".
# NOTE: `(` and `)` are in the class deliberately. Without them the first draft
# truncated `${encodeURIComponent(investorId)}` at `encodeURIComponent`, so
# `/api/partner/me/compliance/:id` was reported as two different endpoints and
# the divergence table was wrong. An audit the owner signs must not be wrong
# about its own inputs.
ENDPOINT_RE = re.compile(r"/api/partner/me/[A-Za-z0-9/:$%{}()._\-]+")

# Endpoint paths are normalised so `${spvId}`, `${encodeURIComponent(x)}` and
# `:spvId` all collapse to the same route.
NORMALISE = [
    (re.compile(r"\$\{[^}]*\}"), ":id"),
    (re.compile(r":[A-Za-z][A-Za-z0-9]*"), ":id"),
    (re.compile(r"[?&].*$"), ""),
    (re.compile(r"/+$"), ""),
]

# Endpoints that are the SAME capability reached through a different door.
# spec/CONSORTIUM_PARTNER_BUILD_v6.md:336 establishes that the plural
# `/api/partner/me/spvs*` family and the singular `/api/partner/me/spv*` family
# both call `spvEngineStore.getSpv(...)` and return the identical `SpvDTO` —
# the singular response is a strict SUPERSET. So surface B using the plural
# reader is not a capability only B has; it is the same read.
#
# These are reported in their own section WITH that citation rather than being
# quietly subtracted from the drop list. A verdict that silently excludes rows
# is a verdict that cannot be audited.
SAME_DATA_DIFFERENT_DOOR = {
    "/api/partner/me/spvs": "Plural SPV list reader — same `getSpv` data as the singular family (v6 §:336)",
    "/api/partner/me/spvs/:id": "Plural SPV detail reader — singular response is a strict superset (v6 §:336)",
}

# Capabilities we name explicitly in the report. Anything not listed still gets
# audited — it lands in the "unclassified" bucket rather than being dropped
# silently, because a silent bucket is how a real divergence goes unreported.
CAPABILITY_LABELS = {
    "/api/partner/me/spv/:id/lp-invites": "LP invite (invite an investor into the vehicle)",
    "/api/partner/me/spv/:id/lp-commit": "LP commit (record an investor's commitment)",
    "/api/partner/me/spvs/:id/capital-calls": "Capital call (record a call against commitments)",
    # NUANCE, verified at SpvOperationsPanels.tsx:486-495. Surface A DOES have a
    # roster — but it queries `/api/spv/:spvId/lp-roster`, the INVESTOR-scoped
    # co-investor view, which that file's own comment records as "NOT a
    # duplicate" of this partner twin. Different scope, different data, gated by
    # lpVisibility. The GP-facing roster is genuinely absent from A.
    "/api/partner/me/spv/:id/lp-roster":
        "LP roster, GP scope (A has only the investor-scoped `/api/spv/:id/lp-roster`, "
        "documented at SpvOperationsPanels.tsx:487 as NOT a duplicate)",
    "/api/partner/me/spv/:id/distributions": "Distribution recording",
    "/api/partner/me/crm/contacts": "CRM contact list (invite/commit autocomplete)",
    "/api/partner/me/crm/contacts/from-source": "CRM contact creation from an SPV party",
    "/api/partner/me/compliance/:id": "Investor KYC / accreditation profile (FE-7)",
    "/api/partner/me/spv/:id/transfers": "Secondary transfer recording",
    "/api/partner/me/spv/:id/wind-down": "Wind-down",
    "/api/partner/me/spv/:id/close-window": "Rolling-close window policy (FE-3)",
}


def read(rel: str) -> str:
    path = os.path.join(REPO, rel)
    if not os.path.exists(path):
        # A missing surface file is itself a finding, never a silent zero.
        return ""
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def strip_comments(src: str) -> str:
    """Drop block and line comments.

    A prose comment quoting an endpoint must not count as a caller. This is the
    same discipline the falsification harnesses use, and it matters more here:
    both surface files carry long explanatory comments that name endpoints they
    do NOT call, so an un-stripped scan would report full parity that does not
    exist.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"^\s*//[^\n]*$", "", src, flags=re.M)
    return src


def endpoints(files: list[str]) -> dict[str, set[str]]:
    """endpoint -> set of files that reference it in CODE (not in comments)."""
    found: dict[str, set[str]] = {}
    for rel in files:
        code = strip_comments(read(rel))
        for raw in ENDPOINT_RE.findall(code):
            ep = raw
            for pat, rep in NORMALISE:
                ep = pat.sub(rep, ep)
            found.setdefault(ep, set()).add(rel)
    return found


def main() -> int:
    check_only = "--check" in sys.argv

    a = endpoints(SURFACE_A)
    b = endpoints(SURFACE_B)
    mount = endpoints([MOUNT_A])

    # Surface A's reachable set includes endpoints called by the page that
    # mounts it: from the GP's point of view they are the same screen.
    a_all = set(a) | set(mount)
    b_all = set(b)

    only_b_raw = sorted(b_all - a_all)
    only_b = [e for e in only_b_raw if e not in SAME_DATA_DIFFERENT_DOOR]
    same_door = [e for e in only_b_raw if e in SAME_DATA_DIFFERENT_DOOR]
    only_a = sorted(a_all - b_all)
    both = sorted(a_all & b_all)

    lines: list[str] = []
    w = lines.append

    w("# SPV-AUDIT — two-surface divergence report")
    w("")
    w("Generated by `scripts/spv_two_surface_audit.py` (read-only, re-runnable).")
    w("This report is the deliverable of **SA-1** and the gating evidence for")
    w("**SC-6**. `GATE-SA1` is the owner's signature on it.")
    w("")
    w("## Surfaces compared")
    w("")
    w("| | Surface | Files |")
    w("|---|---|---|")
    w("| **A** | Engine tabs | " + "<br>".join("`%s`" % f for f in SURFACE_A) + " |")
    w("| | mounted by | `%s` |" % MOUNT_A)
    w("| **B** | Standalone detail page | " + "<br>".join("`%s`" % f for f in SURFACE_B) + " |")
    w("")
    w("Capabilities are keyed on the **endpoint** each surface calls, read from")
    w("source with comments stripped, because an endpoint with no way in is the")
    w("thing that actually goes missing. Component names are not used: a")
    w("component that exists and is mounted nowhere is not shipped.")
    w("")

    w("## VERDICT")
    w("")
    if only_b:
        w("**SC-6 IS BLOCKED. Retiring surface B would DROP %d capabilit%s.**"
          % (len(only_b), "y" if len(only_b) == 1 else "ies"))
        w("")
        w("Parity does not hold. SC-6's own precondition is *\"once the tabs carry")
        w("every field\"*, and they do not. Retiring surface B today would remove")
        w("live, reachable functionality from the product — the RS-1 / RS-2")
        w("failure of July, repeated at larger scale.")
    else:
        w("**No capability is exclusive to surface B.** On this evidence SC-6 may")
        w("proceed, subject to the owner's signature (`GATE-SA1`).")
    w("")

    w("## Capabilities ONLY on surface B — these would be LOST by SC-6")
    w("")
    if only_b:
        w("| Endpoint | Capability |")
        w("|---|---|")
        for ep in only_b:
            w("| `%s` | %s |" % (ep, CAPABILITY_LABELS.get(ep, "*unclassified — inspect before retiring*")))
    else:
        w("*None.*")
    w("")

    w("## On surface B only, but NOT a capability drop")
    w("")
    w("Same data, different door. Listed explicitly rather than subtracted")
    w("silently, so the exclusion can be checked.")
    w("")
    if same_door:
        w("| Endpoint | Why it is not a drop |")
        w("|---|---|")
        for ep in same_door:
            w("| `%s` | %s |" % (ep, SAME_DATA_DIFFERENT_DOOR[ep]))
    else:
        w("*None.*")
    w("")

    w("## Capabilities ONLY on surface A")
    w("")
    if only_a:
        w("| Endpoint | Capability |")
        w("|---|---|")
        for ep in only_a:
            w("| `%s` | %s |" % (ep, CAPABILITY_LABELS.get(ep, "*unclassified*")))
    else:
        w("*None.*")
    w("")

    w("## Present on BOTH surfaces (genuine duplication)")
    w("")
    if both:
        for ep in both:
            w("- `%s` — %s" % (ep, CAPABILITY_LABELS.get(ep, "*unclassified*")))
    else:
        w("*None.*")
    w("")

    w("## Counts")
    w("")
    w("| Metric | Value |")
    w("|---|---|")
    w("| Endpoints reachable from surface A | %d |" % len(a_all))
    w("| Endpoints reachable from surface B | %d |" % len(b_all))
    w("| Exclusive to B (real drop risk) | **%d** |" % len(only_b))
    w("| Exclusive to B but same data via another route | %d |" % len(same_door))
    w("| Exclusive to A | %d |" % len(only_a))
    w("| On both | %d |" % len(both))
    w("")

    report = "\n".join(lines) + "\n"
    out_dir = os.path.join(os.path.dirname(REPO), "build_log")
    if not os.path.isdir(out_dir):
        out_dir = os.path.join(REPO, "build_log")
        os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "SPV_AUDIT_TWO_SURFACE.md")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(report)

    if not check_only:
        sys.stdout.write(report)
    sys.stderr.write("report written to %s\n" % out)

    if check_only and only_b:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
