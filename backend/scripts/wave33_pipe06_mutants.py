#!/usr/bin/env python3
"""WAVE 33 · CP-PIPE-06 — mutation testing for the provenance rule.

Every anchor is verified unique AND outside comments before anything is
mutated, because a Wave-33 item-1 mutant reported SURVIVED while silently
mutating a doc comment — a mutation harness that mutated nothing.

Survivors must be classified: harness bug / coverage gap / equivalent mutant.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = [
    "server/__tests__/wave33_pipe06_provenance.test.ts",
    # Added after the first mutation pass: M5/M18/M20 all survived because the
    # routes were only ever asserted against their SOURCE, never run. A source
    # scan cannot distinguish a guard that is present from one that is present
    # but unreachable.
    "server/__tests__/wave33_pipe06_routes_exec.test.ts",
]

ENG = "server/lib/attributionProvenance.ts"
STORE = "server/partnerWorkspaceStore.ts"
ROUTES = "server/attributionProvenanceRoutes.ts"
ADMIN = "server/partnerRoutes.ts"
UI = "client/src/components/partner/AttributionProvenancePanel.tsx"
PAGE = "client/src/pages/partner/PartnerClients.tsx"

MUTANTS = [
    # ── omission ──────────────────────────────────────────────────────────
    ("M1", ENG,
     'if (source === undefined || source === null || (typeof source === "string" && source.trim() === "")) {\n    return verdict("REFUSE_SOURCE_OMITTED");',
     'if (false) {\n    return verdict("REFUSE_SOURCE_OMITTED");',
     "stop refusing an omitted source"),
    ("M2", ENG,
     'if (source === undefined || source === null || (typeof source === "string" && source.trim() === "")) {',
     'if (source === undefined || source === null) {',
     "let a whitespace-only source through as provenance"),
    ("M3", ENG, "  if (!isProvenanceSource(source)) {\n    return verdict(\"REFUSE_SOURCE_UNKNOWN\");\n  }",
     "  if (false) {\n    return verdict(\"REFUSE_SOURCE_UNKNOWN\");\n  }",
     "accept an unrecognised source as free text"),
    ("M4", ENG, 'if (typeof actor !== "string" || actor.trim() === "") {',
     'if (typeof actor !== "string") {',
     "accept an empty actor — provenance with no responsible person"),
    ("M5", ADMIN, "if (source === undefined || source === null || (typeof source === \"string\" && source.trim() === \"\")) {",
     "if (false) {",
     "restore the route's silent default"),

    # ── the ORDER of the two rules ────────────────────────────────────────
    ("M6", ENG, "  const own = incumbents.find((i) => i.partnerId === requestedPartnerId);",
     "  const own = incumbents.find((i) => i.partnerId !== requestedPartnerId);",
     "invert own-vs-foreign — treat a rival's claim as the partner's own"),

    # ── acquisition ───────────────────────────────────────────────────────
    ("M7", ENG, "    if (isSelfServiceSource(source)) return verdict(\"REFUSE_ACQUISITION\", oldest);",
     "    if (false) return verdict(\"REFUSE_ACQUISITION\", oldest);",
     "THE ORIGINAL DEFECT — allow a self-service claim to take a live one"),
    ("M8", ENG, "  const foreign = incumbents.filter((i) => i.partnerId !== requestedPartnerId);",
     "  const foreign: typeof incumbents = [];",
     "never see a competing claim at all"),
    ("M9", ENG, 'const ADJUDICATED_SOURCES: readonly string[] = ["admin_manual"];',
     'const ADJUDICATED_SOURCES: readonly string[] = ["admin_manual", "partner_claim"];',
     "let a partner self-adjudicate their own claim"),
    ("M10", ENG, "  return !ADJUDICATED_SOURCES.includes(source);", "  return false;",
     "classify every source as adjudicated — a deny-list with nothing in it"),
    ("M11", ENG, "      .sort((a, b) => (a.attributedAt < b.attributedAt ? -1 : a.attributedAt > b.attributedAt ? 1 : 0))[0];",
     "      .sort((a, b) => (a.attributedAt > b.attributedAt ? -1 : a.attributedAt < b.attributedAt ? 1 : 0))[0];",
     "displace the NEWEST claim instead of the originator"),

    # ── the store sink ────────────────────────────────────────────────────
    ("M12", STORE, "    if (!assessment.admit) {", "    if (false) {",
     "stop enforcing the rule at the sink entirely"),
    ("M13", STORE, "      .filter((a) => a.companyId === companyId && !a.revokedAt && a.partnerId !== partnerId)",
     "      .filter((a) => a.companyId === companyId && a.partnerId !== partnerId)",
     "count revoked claims as live — freeze a company to its first claimant"),
    ("M14", STORE, "  listActiveByCompany(companyId: string): PartnerAttribution[] {\n    if (!companyId) return [];",
     "  listActiveByCompany(companyId: string): PartnerAttribution[] {\n    if (!companyId) return attributions.slice();",
     "make an empty company id match every attribution"),
    ("M15", STORE, "    return attributions.filter((a) => a.companyId === companyId && !a.revokedAt);",
     "    return attributions.filter((a) => a.companyId === companyId);",
     "include revoked rows in the company lookup"),

    # ── ordering / fail-closed ────────────────────────────────────────────
    ("M16", STORE, "      const err = new Error(`PROVENANCE_REFUSED:${assessment.verdict}: ${assessment.copy}`);",
     "      const err = new Error(`REFUSED`);",
     "drop the verdict from the refusal, making it unclassifiable"),

    # ── routes ────────────────────────────────────────────────────────────
    ("M17", ROUTES, "          contested: incumbents.some((i) => i.partnerId !== partnerId),",
     "          contested: incumbents.some((i) => i.partnerId !== partnerId),\n          incumbentPartnerId: incumbents.find((i) => i.partnerId !== partnerId)?.partnerId ?? null,",
     "disclose which competitor holds the company"),
    ("M18", ROUTES, "          .listActiveByCompany(companyId)\n          .map((a) => ({",
     "          .listActiveByCompany(companyId)\n          .filter((a) => a.partnerId !== partnerId)\n          .map((a) => ({",
     "hide the caller's own claim from the pre-flight — tells a partner they may claim what they already hold"),
    ("M25", ROUTES, "          contested: incumbents.some((i) => i.partnerId !== partnerId),",
     "          contested: incumbents.length > 0,",
     "report a partner's OWN company as contested"),
    ("M19", ROUTES, '              ? "No live attributions are recorded for this partner, so there is no provenance to report. This is not the same as provenance being complete."',
     '              ? "No provenance problems found."',
     "report an empty list as a clean bill of health"),
    ("M20", ROUTES, "        const rows = partnerAttributionStore.listByPartner(partnerId, { includeRevoked: false });",
     "        const rows = partnerAttributionStore.listByPartner(partnerId, { includeRevoked: true });",
     "report revoked attributions as live provenance"),

    # ── existing-row integrity ────────────────────────────────────────────
    ("M21", ENG, '  if (typeof row.attributedBy !== "string" || row.attributedBy.trim() === "") issues.push("actor");',
     '  if (false) issues.push("actor");',
     "stop noticing a row with no responsible person"),
    ("M22", ENG, '  if (!isProvenanceSource(row.attributionSource)) issues.push("source");',
     '  if (false) issues.push("source");',
     "stop noticing a row with no source"),

    # ── UI ────────────────────────────────────────────────────────────────
    ("M23", UI, '{a.attributedBy || "—"}', '{a.attributedBy || "admin_manual"}',
     "render a fabricated source in place of a missing one"),
    ("M24", PAGE, "      <AttributionProvenancePanel />", "      {false && <AttributionProvenancePanel />}",
     "unmount the panel — an engine whose UI renders nowhere is not shipped"),
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
    for mid, f, find, _r, _d in MUTANTS:
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
