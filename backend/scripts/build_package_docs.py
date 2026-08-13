#!/usr/bin/env python3
"""
scripts/build_package_docs.py — ITEMS DOC-1, DOC-2, DOC-3

Carries three spec artefacts into the Avi build package as files under
`work/docs/`, which `build_log/make_package.sh` picks up (docs/ is not in its
prune list, so a new docs/ file lands in the delta tree as an "A" row).

  DOC-1  the 50-row correction ledger COR-001..COR-050
         source spec/SESSION_TRACEABILITY_REGISTER.md  -> docs/CORRECTION_LEDGER.md
  DOC-2  the 12-item DO-NOT-BUILD list (11-15 engineer-weeks saved)
         source spec/PRIOR_ART_SWEEP.md                -> docs/DO_NOT_BUILD.md
  DOC-3  the reconstructed prior task history (OPN-015)
         source spec/PRIOR_TASK_HISTORY.md             -> docs/PRIOR_TASK_HISTORY.md
  DEC-1  the 11 v2 decisions owed an owner ruling (10 SHOULD-ESCALATE + D-18)
         source spec/V2_DECISION_AUDIT.md              -> docs/OWNER_DECISION_REGISTER.md

WHY GENERATED AND NOT PASTED
----------------------------
A hand-pasted copy is a second source of truth that silently drifts from the
first. Every citation in CONSORTIUM_PARTNER_BUILD_v8.md whose line number has
drifted is that failure. These files are DERIVED, and `--verify` re-derives them
and fails on any difference, so drift is a gate failure instead of a discovery.

WHY THE ROW COUNTS ARE ASSERTED
-------------------------------
This is the DA-3 shape: an extractor whose regex stops matching returns an empty
list, writes a valid-looking document with a nice header and no rows, and exits
0. Vacuously green. So the counts are contract, not commentary:

    DOC-1 must extract EXACTLY 50 rows, ids exactly COR-001..COR-050, no gaps
    DOC-2 must extract EXACTLY 12 rows, numbered 1..12
    DOC-3 must be non-empty and must not be a stub

Any shortfall is a hard failure (exit 2) that names what it expected. Falsified
both ways by scripts/__tests__/package_docs_falsify.sh.

USAGE
  python3 scripts/build_package_docs.py            write docs/
  python3 scripts/build_package_docs.py --verify   fail if on-disk != re-derived
  SPEC_ROOT=/tmp/x python3 ... --verify            for testing against a copy

EXIT 0 ok · 1 drift (--verify) · 2 source inputs invalid or extraction short
"""
from __future__ import annotations
import os
import re
import sys
import difflib
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SPEC = Path(os.environ.get("SPEC_ROOT") or (REPO.parent / "spec"))
DOCS = REPO / "docs"

REGISTER = SPEC / "SESSION_TRACEABILITY_REGISTER.md"
SWEEP = SPEC / "PRIOR_ART_SWEEP.md"
HISTORY = SPEC / "PRIOR_TASK_HISTORY.md"
AUDIT = SPEC / "V2_DECISION_AUDIT.md"

EXPECT_COR = 50
EXPECT_DNB = 12
# The audit's own executive table states these four counts. Its per-decision
# table classifies 32 rows. Both are asserted, AND cross-checked against each
# other: a stated total that no longer matches the rows it summarises is exactly
# the "number nobody re-derived" failure this wave found three times.
EXPECT_CLASSES = {
    "CORRECTLY-AUTONOMOUS": 19,
    "SHOULD-ESCALATE": 10,
    "UNDER-JUSTIFIED": 1,
    "WRONG": 2,
}
ESCALATE_IDS = ["D-01", "D-11", "D-13", "D-14", "D-17", "D-19", "D-20", "D-24", "D-30", "D-32"]

PROVENANCE = (
    "> **GENERATED FILE — do not hand-edit.**\n"
    "> Produced by `scripts/build_package_docs.py` from `{src}`.\n"
    "> `python3 scripts/build_package_docs.py --verify` fails if this file and\n"
    "> its source have drifted apart, so an edit here is a gate failure, not a\n"
    "> silent second source of truth. Change the spec, then regenerate.\n"
)


def die(msg: str, code: int = 2) -> None:
    print(f"PACKAGE DOCS FATAL: {msg}", file=sys.stderr)
    sys.exit(code)


def read(p: Path) -> str:
    if not p.is_file():
        die(f"missing source {p}. A missing input is a FAILURE here, never a skip.")
    t = p.read_text(encoding="utf-8", errors="surrogatepass")
    if not t.strip():
        die(f"source {p} is empty")
    return t


# --------------------------------------------------------------------------
# DOC-1 — the 50-row correction ledger
# --------------------------------------------------------------------------
def extract_corrections() -> list[list[str]]:
    rows: list[list[str]] = []
    seen: set[str] = set()
    for line in read(REGISTER).splitlines():
        if not line.startswith("| COR-"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        # The ledger table has 6 columns. A turn-map table elsewhere in the same
        # file also starts rows with "| COR-0" but has 3 columns; taking it would
        # silently double-count COR-041. Shape, not position, distinguishes them.
        if len(cells) != 6 or cells[1] != "CORRECTION":
            continue
        if cells[0] in seen:
            die(f"duplicate ledger id {cells[0]} — refusing to emit an ambiguous ledger")
        seen.add(cells[0])
        rows.append(cells)

    if len(rows) != EXPECT_COR:
        die(
            f"expected exactly {EXPECT_COR} COR rows in {REGISTER.name}, extracted "
            f"{len(rows)}. Refusing to write a short ledger that would look complete."
        )
    ids = [r[0] for r in rows]
    want = [f"COR-{i:03d}" for i in range(1, EXPECT_COR + 1)]
    if ids != want:
        missing = sorted(set(want) - set(ids))
        die(f"ledger ids are not COR-001..COR-{EXPECT_COR:03d} contiguous; missing {missing}")
    return rows


def render_corrections(rows: list[list[str]]) -> str:
    ruled = sum(1 for r in rows if r[4].strip().upper() == "Y")
    out = [
        "# CORRECTION LEDGER — COR-001 … COR-050",
        "",
        "**Item DOC-1.** *Carry the 50-row correction ledger into the Avi build package",
        "so no corrected fact is re-broken.*",
        "",
        PROVENANCE.format(src="spec/SESSION_TRACEABILITY_REGISTER.md §3"),
        "## How to use this file",
        "",
        "Each row is a claim that was **believed, acted on, and then proven wrong**.",
        "The reason it travels with the code is that a corrected fact re-breaks easily:",
        "the original wrong claim is still written down in older specs, briefs and",
        "review documents, so the next reader can re-derive it in good faith.",
        "",
        "**Before you \"fix\" something in this tree, search this ledger for it.** If it",
        "appears here, the defect was already investigated and the finding reversed —",
        f"re-introducing it is a regression, not a fix. {ruled} of these {len(rows)} rows carry an",
        "explicit owner ruling and are not open to re-litigation.",
        "",
        "The canonical worked example is **COR-001**: the \"SPV tab defect\" was not real.",
        "Radix `TabsTrigger` fires on `onMouseDown`, and the audits drove it with",
        "`element.click()`, which never produces that event. The audit tooling was",
        "broken, not the tabs. Every click-dependent finding from that run was then",
        "quarantined as COR-002. A future audit that uses `.click()` on Radix tabs will",
        "manufacture the same phantom defect again.",
        "",
        f"## The ledger ({len(rows)} rows)",
        "",
        "| ID | Category | Item | Source (file:line or turn) | Owner-ruled? | Status |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        out.append("| " + " | ".join(r) + " |")
    out += [
        "",
        "---",
        "",
        "**Provenance.** Extracted from the CORRECTION section of",
        "`spec/SESSION_TRACEABILITY_REGISTER.md`, which states: *\"None of these may be",
        "re-introduced in v4.\"* Row count and id contiguity (COR-001..COR-050) are",
        "asserted by the generator; a short or gapped extraction is a hard failure",
        "rather than a shorter document.",
        "",
    ]
    return "\n".join(out)


# --------------------------------------------------------------------------
# DOC-2 — the 12-item DO-NOT-BUILD list
# --------------------------------------------------------------------------
def extract_do_not_build() -> tuple[list[list[str]], str]:
    text = read(SWEEP)
    m = re.search(
        r"^##\s*\d*\.?\s*HEADLINE:\s*\*\*DO NOT BUILD.*?$(.*?)^(?=##\s)",
        text,
        re.S | re.M,
    )
    if not m:
        die(f"could not locate the DO-NOT-BUILD section in {SWEEP.name}")
    section = m.group(1)

    rows: list[list[str]] = []
    for line in section.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if len(cells) != 4 or not re.fullmatch(r"\d+", cells[0]):
            continue  # skips the header and the |---| separator
        rows.append(cells)

    if len(rows) != EXPECT_DNB:
        die(
            f"expected exactly {EXPECT_DNB} DO-NOT-BUILD rows in {SWEEP.name}, extracted "
            f"{len(rows)}. Refusing to ship a partial do-not-build list — a capability "
            f"missing from this list is a capability someone rebuilds."
        )
    if [r[0] for r in rows] != [str(i) for i in range(1, EXPECT_DNB + 1)]:
        die(f"DO-NOT-BUILD rows are not numbered 1..{EXPECT_DNB}")

    tm = re.search(r"\*\*Total estimated effort saved:([^*]+)\*\*", section)
    if not tm:
        die("the DO-NOT-BUILD section has no 'Total estimated effort saved' line")
    return rows, tm.group(1).strip().rstrip(".")


def render_do_not_build(rows: list[list[str]], total: str) -> str:
    out = [
        "# DO NOT BUILD — capabilities that already exist in this tree",
        "",
        "**Item DOC-2.** *Carry the 12-item DO-NOT-BUILD list (11–15 engineer-weeks",
        "saved) into the package.*",
        "",
        PROVENANCE.format(src="spec/PRIOR_ART_SWEEP.md §2"),
        "## Read this before starting any feature",
        "",
        f"Each of the {len(rows)} capabilities below was **already built** in",
        "`/home/user/workspace/work` at the time of the v26.7.3 prior-art sweep, and was",
        "about to be built a second time. Every `file:line` in the table was opened and",
        f"read, not inferred. **Total estimated effort saved: {total}.**",
        "",
        "Three of the briefing's own claims were wrong in the direction that costs the",
        "most: it asserted there was *no capital-calls route* (there is one, with a client",
        "form), *no fee-configuration UI* (a 2,091-line console), and *no XIRR* (a",
        "Newton-Raphson implementation with a reference cross-check test). The",
        "expensive failure mode on this platform is not missing code, it is **code that",
        "exists, works, and has no route or no caller** — so it is invisible from the UI",
        "and reads as absent.",
        "",
        "**The correct action for anything on this list is WIRE or REUSE, never BUILD.**",
        "If you cannot reach a capability from the UI, first prove it does not exist",
        "server-side. An engine with no route is not shipped — but it is also not",
        "missing, and rebuilding it produces two divergent implementations of the same",
        "rule, which is strictly worse than one dormant implementation.",
        "",
        f"## The list ({len(rows)} items)",
        "",
        "| # | Capability | Where it already lives | Effort saved (est.) |",
        "|---|---|---|---|",
    ]
    for r in rows:
        out.append("| " + " | ".join(r) + " |")
    out += [
        "",
        f"**Total estimated effort saved: {total}.**",
        "",
        "---",
        "",
        "**Caveat, carried deliberately.** \"Already exists\" is not \"already shipped\".",
        "Several of these are BUILT + ORPHANED: the 17 Managed-Founder persona endpoints",
        "have zero client callers, the partner SSE topics have no subscriber, and the",
        "partner task store is dormant behind an unrouted page. The effort saved is real,",
        "but so is the wiring still owed. Do not read a row here as a completed feature.",
        "",
        "**Provenance.** Extracted from `spec/PRIOR_ART_SWEEP.md` §2 (\"HEADLINE: DO NOT",
        "BUILD — already exists\"). The generator asserts exactly 12 rows numbered 1..12",
        "and refuses to emit a partial list.",
        "",
    ]
    return "\n".join(out)


# --------------------------------------------------------------------------
# DOC-3 — the reconstructed prior task history
# --------------------------------------------------------------------------
def render_history() -> str:
    body = read(HISTORY)
    n = len(body.splitlines())
    if n < 40:
        die(f"{HISTORY.name} is only {n} lines — that is a stub, not the reconstruction")
    if "## 1." not in body:
        die(f"{HISTORY.name} has no numbered findings sections")
    head = [
        "# PRIOR TASK HISTORY — cross-session findings (carried into the package)",
        "",
        "**Item DOC-3 / closes OPN-015.** The register recorded this file as",
        "**absent**: *\"`PRIOR_TASK_HISTORY.md` does not exist. It is named in the",
        "`V4_BRIEF.md` MUST-READ table but is absent from `spec/`; its content survives",
        "only in `turn_0048`'s assistant message.\"* A previous run reported writing the",
        "path and did not. It has since been reconstructed from the past-context sweep",
        f"and now exists at `spec/PRIOR_TASK_HISTORY.md` ({n} lines); this copy carries it",
        "into the build package so the MUST-READ is reachable from the code tree.",
        "",
        PROVENANCE.format(src="spec/PRIOR_TASK_HISTORY.md"),
        "---",
        "",
    ]
    return "\n".join(head) + body.rstrip("\n") + "\n"


# --------------------------------------------------------------------------
# DEC-1 — the owner decision register (10 SHOULD-ESCALATE + D-18)
# --------------------------------------------------------------------------
def extract_decisions() -> tuple[list[list[str]], dict[str, int]]:
    text = read(AUDIT)

    # (a) the stated executive counts
    stated: dict[str, int] = {}
    for line in text.splitlines():
        m = re.match(r"^\|\s*(CORRECTLY-AUTONOMOUS|SHOULD-ESCALATE|UNDER-JUSTIFIED|WRONG)\s*\|\s*(\d+)\s*\|$", line.strip())
        if m:
            stated[m.group(1)] = int(m.group(2))
    if stated != EXPECT_CLASSES:
        die(f"{AUDIT.name} executive counts are {stated}, expected {EXPECT_CLASSES}")

    # (b) the per-decision rows
    rows: list[list[str]] = []
    for line in text.splitlines():
        if not re.match(r"^\|\s*\*{0,2}D-\d\d\*{0,2}\s*\|", line.strip()):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 4:
            continue
        # The class cell is bolded in the source; the id may or may not be.
        rows.append([cells[0].strip("* "), cells[1], cells[2].strip("* "), cells[3]])

    if len(rows) != 32:
        die(f"expected 32 classified decisions D-01..D-32 in {AUDIT.name}, extracted {len(rows)}")
    ids = [r[0] for r in rows]
    want = [f"D-{i:02d}" for i in range(1, 33)]
    if ids != want:
        die(f"decision ids are not D-01..D-32 contiguous; missing {sorted(set(want) - set(ids))}")

    # (c) the cross-check: do the rows actually add up to the stated table?
    counted: dict[str, int] = {}
    for r in rows:
        counted[r[2]] = counted.get(r[2], 0) + 1
    if counted != EXPECT_CLASSES:
        die(
            f"the 32 classified rows tally to {counted}, but the executive table states "
            f"{EXPECT_CLASSES}. One of the two is wrong; neither may be shipped unchecked."
        )

    esc = [r[0] for r in rows if r[2] == "SHOULD-ESCALATE"]
    if esc != ESCALATE_IDS:
        die(f"SHOULD-ESCALATE set is {esc}, but OPN-013/GATE-D10 name {ESCALATE_IDS}")
    und = [r[0] for r in rows if r[2] == "UNDER-JUSTIFIED"]
    if und != ["D-18"]:
        die(f"UNDER-JUSTIFIED set is {und}, expected exactly ['D-18'] (ITM-154)")
    return rows, counted


def render_decisions(rows: list[list[str]], counted: dict[str, int]) -> str:
    owed = [r for r in rows if r[2] in ("SHOULD-ESCALATE", "UNDER-JUSTIFIED")]
    wrong = [r for r in rows if r[2] == "WRONG"]
    out = [
        "# OWNER DECISION REGISTER — 11 v2 decisions awaiting a ruling",
        "",
        "**Item DEC-1.** *Apply the owner's rulings on the 10 SHOULD-ESCALATE v2",
        "decisions plus D-18.*",
        "",
        PROVENANCE.format(src="spec/V2_DECISION_AUDIT.md"),
        "## STATUS: THE RULINGS DO NOT EXIST YET. NOTHING HAS BEEN APPLIED.",
        "",
        "DEC-1 cannot be executed as written, and this file says so rather than",
        "reporting a partial application. The evidence, verified at source:",
        "",
        "- `CONSORTIUM_PARTNER_BUILD_v8.md:572` — `GATE-D10 blocks DEC-1`.",
        '- `CONSORTIUM_PARTNER_BUILD_v8.md:385` \u2014 `GATE-D10` = *"Owner rules the 10',
        '  SHOULD-ESCALATE v2 decisions (D-01,11,13,14,17,19,20,24,30,32)"*,',
        "  `owner_decision = Y`. It is a GATE, and it is not closed.",
        '- `CONSORTIUM_PARTNER_BUILD_v5.md:2852` \u2014 `OPN-013` is still **OPEN**: *"10',
        '  SHOULD-ESCALATE decisions have not been put to the owner."*',
        "- `CAPAVATE_MASTER_BUILD_SPEC_v3.md:124` (V3-7) records the ten as",
        '  **"returned to the owner"** \u2014 returned is not ruled.',
        "- `spec/OWNER_RULINGS_2026_08_09.md` rules **OQ-1 … OQ-12 only**. It contains no",
        "  ruling on any `D-nn`. There is no other rulings document in `spec/`.",
        "",
        "So the deliverable here is the instrument that lets the gate close: each",
        "decision with its audit rationale and an explicit, empty ruling slot. This is",
        "**not** a deferral and must not be recorded as one — the item is blocked on an",
        "input only the owner can supply, and it is accounted for individually below.",
        "",
        "**Until a ruling is recorded, engineering may build the mechanism but must not",
        "activate the policy.** That distinction is the audit's own: on D-01 it reads",
        '*"engineering can implement the schema but should not activate unapproved',
        'resolution semantics."* Every row below inherits that rule.',
        "",
        f"## The {len(owed)} decisions owed a ruling",
        "",
        "| ID | Decision | Class | Why it is the owner's call, not engineering's | RULING |",
        "|---|---|---|---|---|",
    ]
    for r in owed:
        out.append(f"| **{r[0]}** | {r[1]} | {r[2]} | {r[3]} | **UNRULED** |")
    out += [
        "",
        f"## Plus {len(wrong)} decisions the audit found technically WRONG",
        "",
        "These are not awaiting a ruling — they are awaiting a corrected design, and the",
        "audit specifies what the correction must contain. They are listed here because a",
        "reader closing GATE-D10 will otherwise assume the decision log is now clean.",
        "",
        "| ID | Decision | Why it is wrong |",
        "|---|---|---|",
    ]
    for r in wrong:
        out.append(f"| **{r[0]}** | {r[1]} | {r[3]} |")
    out += [
        "",
        "---",
        "",
        "## How to close GATE-D10",
        "",
        "1. Replace **UNRULED** with the ruling for each of the "
        f"{len(owed)} rows above, in `spec/`, not here.",
        "2. `OPN-013` moves to CLOSED with the ruling as its evidence.",
        "3. Re-run `python3 scripts/build_package_docs.py` and commit the regenerated file.",
        "4. Only then may an implementation claim to satisfy DEC-1.",
        "",
        "**Provenance.** Extracted from `spec/V2_DECISION_AUDIT.md`. The generator asserts",
        f"all 32 decisions D-01..D-32 are present and contiguous, that they tally to",
        f"{counted}, that the tally matches the audit's own executive table, that the",
        "SHOULD-ESCALATE set is exactly the ten ids named by OPN-013 and GATE-D10, and",
        "that the UNDER-JUSTIFIED set is exactly `['D-18']` per ITM-154. A disagreement",
        "between the stated counts and the rows is fatal, not a rounding note.",
        "",
    ]
    return "\n".join(out)


# --------------------------------------------------------------------------
def build() -> dict[str, str]:
    cor = extract_corrections()
    dnb, total = extract_do_not_build()
    dec, counted = extract_decisions()
    return {
        "CORRECTION_LEDGER.md": render_corrections(cor),
        "DO_NOT_BUILD.md": render_do_not_build(dnb, total),
        "PRIOR_TASK_HISTORY.md": render_history(),
        "OWNER_DECISION_REGISTER.md": render_decisions(dec, counted),
    }


def main() -> int:
    args = sys.argv[1:]
    for a in args:
        if a not in ("--verify",):
            die(f"unknown flag {a!r}. Accepted: --verify (no flags = write).")
    verify = "--verify" in args

    # A shipped release package contains work/ with NO spec/ tree beside it. That
    # is legitimate, so it is a SKIP — but a PRINTED one. The same distinction
    # Step 0b of the pre-deploy gate makes, and for the same reason: a silent skip
    # is indistinguishable from a pass. Note the narrowness: the whole spec TREE
    # being absent is a skip; the tree being present with a source file missing is
    # fatal (see read()), because that is tampering or a bad checkout.
    if not SPEC.is_dir():
        print("=" * 74)
        print("PACKAGE DOCS — SKIPPED, NOT PASSED")
        print("=" * 74)
        print(f"No spec/ tree at {SPEC}.")
        print("This is expected inside a shipped release package, which carries work/")
        print("without spec/. DOC-1/DOC-2/DOC-3/DEC-1 cannot be re-derived here.")
        print("The generated docs/ files travel in the package; their correctness was")
        print("gated where spec/ exists. Set SPEC_ROOT to verify against a spec tree.")
        return 0

    docs = build()
    if not DOCS.is_dir():
        die(f"{DOCS} does not exist — this is not a Capavate work tree")

    print("=" * 74)
    print("PACKAGE DOCS — DOC-1 / DOC-2 / DOC-3 / DEC-1" + ("   [--verify]" if verify else ""))
    print("=" * 74)
    print(f"spec root : {SPEC}")
    print(f"docs dir  : {DOCS.relative_to(REPO)}/")

    drift = []
    for name, body in docs.items():
        target = DOCS / name
        have = target.read_text(encoding="utf-8") if target.is_file() else None
        nrows = body.count("\n| ")
        if verify:
            if have is None:
                drift.append((name, "ABSENT from docs/ — never generated, or deleted"))
            elif have != body:
                d = list(
                    difflib.unified_diff(
                        have.splitlines(), body.splitlines(),
                        "docs/" + name, "re-derived from spec", lineterm="", n=1,
                    )
                )
                drift.append((name, f"{len(d)} diff lines vs the spec source"))
                for line in d[:14]:
                    print("    " + line)
            else:
                print(f"  ok    {name:<26} identical to source ({len(body.splitlines())} lines)")
        else:
            target.write_text(body, encoding="utf-8")
            verb = "unchanged" if have == body else ("written" if have is None else "updated")
            print(f"  {verb:<9} {name:<26} {len(body.splitlines())} lines, {nrows} table rows")

    print()
    if verify and drift:
        print("RESULT: FAIL — PACKAGE DOCS HAVE DRIFTED FROM spec/", file=sys.stderr)
        for name, why in drift:
            print(f"  {name}: {why}", file=sys.stderr)
        print(file=sys.stderr)
        print("  These files are DERIVED. Do not edit them; edit the spec source and", file=sys.stderr)
        print("  re-run `python3 scripts/build_package_docs.py`. A drifted copy in the", file=sys.stderr)
        print("  package is a second source of truth, which is the exact failure this", file=sys.stderr)
        print("  generator exists to prevent.", file=sys.stderr)
        return 1
    if verify:
        print("RESULT: PASS — all four package docs match their spec sources.")
    else:
        print(f"RESULT: WROTE 4 docs — {EXPECT_COR} corrections, {EXPECT_DNB} do-not-build rows,")
        print("  and the reconstructed prior task history. make_package.sh does not prune")
        print("  docs/, so these travel in the delta tree. Verify with --verify.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
