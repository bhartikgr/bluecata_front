#!/usr/bin/env python3
"""WAVE 33 · CP-PIPE-10 — mutation testing for LOCK 1 (mechanism + wording).

Every anchor is verified UNIQUE and OUTSIDE COMMENTS before anything is
mutated. A Wave-33 item-1 mutant reported SURVIVED while silently mutating a
doc comment — a mutation harness that mutated nothing, which is this build's
own lesson appearing inside the tooling.

Two families of mutant, matching the two halves of the item:
  · PART A  — weaken the co-write rule or its sink.
  · PART B  — make something fabricate, default to, or hide a lock wording.
    These are the dangerous ones: a surviving Part-B mutant means the product
    could show an investment bank a legal string nobody wrote.

Survivors must be classified: harness bug / coverage gap / equivalent mutant.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = [
    "server/__tests__/wave33_pipe10_lock1.test.ts",
    # Added after the FIRST mutation pass. M10 survived because nothing ever
    # read the row the sink writes — a source scan cannot see what a prepared
    # statement binds. Running the sink also revealed that the co-write could
    # never land at all: see the FK pre-flight in partnerConsortiumRoutes.
    "server/__tests__/wave33_pipe10_sink_exec.test.ts",
    # Added after the FIRST pass. M26 (always take the "supplied" branch, so a
    # NULL wording renders as a BLANK panel) survived every server-side and
    # source assertion. Only rendering the component can see which branch runs.
    "client/src/components/partner/__tests__/wave33_pipe10_lock_notice_render.test.tsx",
]

ENG = "server/lib/lock1Provenance.ts"
STORE = "server/lockTextStore.ts"
ROUTES = "server/lockTextRoutes.ts"
INSTALL = "server/lib/applyLockTextSchema.ts"
UI = "client/src/components/partner/Lock1NoticePanel.tsx"
ADMINUI = "client/src/components/admin/LockTextAdminPanel.tsx"
PAGE = "client/src/pages/partner/PartnerPipeline.tsx"
SINK = "server/partnerConsortiumRoutes.ts"

MUTANTS = [
    # ── PART A · the co-write rule ────────────────────────────────────────
    ("M1", ENG, '  if (!partnerId) return refuse("LOCK1_PARTNER_ID_MISSING");',
     '  if (false) return refuse("LOCK1_PARTNER_ID_MISSING");',
     "admit a partner-sourced row that names no partner"),
    ("M2", ENG, '  const partnerId = (input.sourcedFromPartnerId ?? "").trim();',
     '  const partnerId = String(input.sourcedFromPartnerId ?? " ");',
     "let a whitespace-only partner id count as a partner"),
    ("M3", ENG, '  if (!attr || !attr.id) return refuse("LOCK1_ATTRIBUTION_MISSING");',
     '  if (false) return refuse("LOCK1_ATTRIBUTION_MISSING");',
     "THE ORIGINAL DEFECT — write a partner id with no attribution beside it"),
    ("M4", ENG, '  if (attr.partnerId !== partnerId) return refuse("LOCK1_ATTRIBUTION_PARTNER_MISMATCH");',
     '  if (false) return refuse("LOCK1_ATTRIBUTION_PARTNER_MISMATCH");',
     "accept another partner's attribution as this partner's provenance"),
    ("M5", ENG, '  if (attr.companyId !== input.companyId) return refuse("LOCK1_ATTRIBUTION_COMPANY_MISMATCH");',
     '  if (false) return refuse("LOCK1_ATTRIBUTION_COMPANY_MISMATCH");',
     "source a deal on an unrelated company's relationship"),
    ("M6", ENG, '  if (attr.revokedAt) return refuse("LOCK1_ATTRIBUTION_REVOKED");',
     '  if (false) return refuse("LOCK1_ATTRIBUTION_REVOKED");',
     "let a revoked attribution keep sourcing new deals"),
    ("M7", ENG, '  if (input.sourceType !== "partner") {',
     '  if (input.sourceType === "partner") {',
     "invert the scope — exempt partner rows, block investor rows"),
    ("M8", ENG, "    coWrite: null,\n  });",
     "    coWrite: { sourcedFromPartnerId: String(input.sourcedFromPartnerId ?? \"\"), sourcedFromPartnerAttributionId: \"\" },\n  });",
     "hand back a HALF pair on the refusal path"),

    # ── PART A · the sink ─────────────────────────────────────────────────
    ("M9", SINK, "      if (!lock1.ok || !lock1.coWrite) {", "      if (false) {",
     "stop enforcing LOCK 1 at the only partner-sourced writer"),
    ("M10", SINK, "          lock1.coWrite.sourcedFromPartnerId,\n          lock1.coWrite.sourcedFromPartnerAttributionId,",
     "          lock1.coWrite.sourcedFromPartnerId,\n          null,",
     "write the partner id but leave the attribution column NULL"),
    ("M11", SINK, "          fromMinor(amountMinor, cur),", "          amountMinor / 100,",
     "restore the hardcoded exponent-2 division on the money column"),

    # ── PART B · the wording. A survivor here is a fabricated legal text. ──
    ("M12", ENG, '  const text = typeof row.text === "string" && row.text.trim() !== "" ? row.text : null;',
     '  const text = typeof row.text === "string" ? row.text : null;',
     "treat a blank string as a supplied wording — unsatisfied lock looks satisfied"),
    ("M13", ENG, "    copy: text !== null ? text : NOT_SUPPLIED_COPY,",
     '    copy: text !== null ? text : "LOCK 1 requires that partner provenance be recorded with the sourcing partner.",',
     "FABRICATE a plausible lock wording where the owner's text is missing"),
    ("M14", ENG, "    copy: text !== null ? text : NOT_SUPPLIED_COPY,",
     '    copy: text !== null ? `LOCK 1: ${text}` : NOT_SUPPLIED_COPY,',
     "prepend a label to the owner's verbatim text"),
    ("M15", ENG, "    supplied: text !== null,", "    supplied: true,",
     "claim every lock is supplied"),
    ("M16", STORE, '  if (typeof args.text !== "string" || args.text.trim() === "") {',
     '  if (typeof args.text !== "string") {',
     "store a blank as a lock's wording"),
    ("M17", STORE, "    ).run(key, args.text, setBy, now, now, now);",
     "    ).run(key, args.text.trim(), setBy, now, now, now);",
     "trim the owner's verbatim text — verbatim stops being verbatim"),
    ("M18", STORE, "  const setBy = (args.setBy ?? \"\").trim();\n  if (!setBy) {",
     "  const setBy = (args.setBy ?? \"unknown\").trim();\n  if (false) {",
     "record legal text with no attributable author"),
    ("M19", STORE, "      `INSERT INTO platform_lock_text_revision (id, key, text, set_by, recorded_at) VALUES (?, ?, ?, ?, ?)`,\n    ).run(revId, key, args.text, setBy, now);",
     "      `INSERT INTO platform_lock_text_revision (id, key, text, set_by, recorded_at) VALUES (?, ?, ?, ?, ?)`,\n    ).run(revId, key, null, setBy, now);",
     "keep a revision row that does not record what the lock said"),
    ("M20", STORE, "  if (!row) return { ...describeLockNotice({ key: k, text: null }), exists: false };",
     "  if (!row) return { ...describeLockNotice({ key: k, text: null }), exists: true };",
     "collapse a missing row into an unsupplied wording — a typo'd key stops being chaseable"),

    # ── PART B · the routes ───────────────────────────────────────────────
    ("M21", ROUTES, "    if (!uctx?.isAuthed) return res.status(401).json({ error: \"AUTH_REQUIRED\" });\n    if (!uctx.isAdmin) return res.status(403).json({ error: \"ADMIN_REQUIRED\" });\n\n    const key = String(req.params.key ?? \"\").trim();",
     "    if (!uctx?.isAuthed) return res.status(401).json({ error: \"AUTH_REQUIRED\" });\n\n    const key = String(req.params.key ?? \"\").trim();",
     "let any authenticated user rewrite a legal lock"),
    ("M22", ROUTES, "          text: notice.text,\n          copy: notice.copy,\n          setAt: notice.setAt,",
     "          text: notice.text ?? notice.copy,\n          copy: notice.copy,\n          setAt: notice.setAt,",
     "emit the not-supplied notice IN the text field — the client would print it as the lock"),
    ("M23", ROUTES, "          key: notice.key,\n          supplied: notice.supplied,",
     "          key: notice.key,\n          supplied: true,",
     "tell the pipeline surface the wording is supplied when it is not"),
    ("M24", ROUTES, "      const notice = setLockText({ key, text: typeof text === \"string\" ? text : \"\", setBy: actor });",
     "      const notice = setLockText({ key, text: String(text ?? \"\"), setBy: actor });",
     "coerce a non-string body value into a wording"),

    # ── the UI, which is the surface a bank actually reads ────────────────
    ("M25", UI, "          {q.data.copy}", '          {"LOCK 1 applies to this pipeline."}',
     "render a locally authored sentence instead of the server's notice"),
    ("M26", UI, "      ) : q.data.supplied ? (", "      ) : true ? (",
     "take the supplied branch always — render null where the lock text goes"),
    ("M27", PAGE, "      <Lock1NoticePanel />", "      {false && <Lock1NoticePanel />}",
     "unmount the panel — a component mounted nowhere is not shipped"),
    ("M28", ADMINUI, 'setDraft(l.text ?? "")',
     'setDraft(l.text ?? "LOCK 1 requires provenance to be co-written.")',
     "seed the admin editor with a suggested wording one Save from becoming the lock"),

    # ── schema / installer ────────────────────────────────────────────────
    ("M29", INSTALL, '    if (tableExists(db, "platform_lock_text") && tableExists(db, "platform_lock_text_revision")) {',
     '    if (tableExists(db, "platform_lock_text")) {',
     "probe only one table — leave revision history permanently missing"),
]


def run_tests() -> bool:
    r = subprocess.run(["npx", "vitest", "run", *TESTS], cwd=ROOT,
                       capture_output=True, text=True, timeout=900)
    return r.returncode == 0


def strip_comments(s: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*[\s\S]*?\*/", "", s))


def main() -> int:
    print("verifying anchors before mutating anything…")
    bad = []
    seen = set()
    for mid, f, find, _r, _d in MUTANTS:
        if mid in seen:
            bad.append(f"{mid}: duplicate mutant id")
        seen.add(mid)
        src = (ROOT / f).read_text()
        n_raw, n_code = src.count(find), strip_comments(src).count(find)
        if n_raw == 0:
            bad.append(f"{mid}: anchor ABSENT in {f}")
        elif n_code == 0:
            bad.append(f"{mid}: anchor matches ONLY A COMMENT in {f}")
        elif n_raw > 1:
            bad.append(f"{mid}: anchor matches {n_raw}x in {f} — ambiguous")
    if bad:
        print("ANCHOR CHECK FAILED — no mutants run:")
        for b in bad:
            print("  " + b)
        return 2
    print(f"  all {len(MUTANTS)} anchors unique and in code\n")

    print("baseline must PASS…")
    if not run_tests():
        print("BASELINE FAILS — results would be meaningless.")
        return 2
    print("  baseline green\n")

    killed, survived = [], []
    for mid, f, find, repl, desc in MUTANTS:
        path = ROOT / f
        original = path.read_text()
        path.write_text(original.replace(find, repl, 1))
        try:
            ok = run_tests()
        finally:
            path.write_text(original)
        (survived if ok else killed).append((mid, desc))
        print(f"  {mid} {'SURVIVED' if ok else 'killed  '} — {desc}")

    print(f"\n{len(killed)}/{len(MUTANTS)} killed")
    if survived:
        print("\nSURVIVORS (each needs a classification):")
        for mid, desc in survived:
            print(f"  {mid}: {desc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
