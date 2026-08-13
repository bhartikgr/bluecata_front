#!/usr/bin/env python3
"""WAVE 33 · CP-SPV-53 — mutation run for the discoverability harness.

Each mutant is a defect this codebase has actually shipped, or one the brief
explicitly forbids, or the specific defect CP-SPV-53 exists to fix. A mutant
that SURVIVES is reported with which of the three it is: harness bug, coverage
gap, or equivalent mutant.

The mutants span BOTH halves of the item, because a suite that only mutated the
pure predicate would say nothing about the store and route layer where the
actual privacy boundary lives.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/user/workspace/work")
TEST = "server/__tests__/wave33_spv53_discoverability.test.ts"

ENGINE = "server/lib/spvDiscoverability.ts"
STORE = "server/spvDiscoveryStore.ts"
ROUTES = "server/spvDiscoveryRoutes.ts"

MUTANTS = [
    # ── the pure predicate ────────────────────────────────────────────────
    ("M1  invite_only becomes broadcast — the over-correction that would publish "
     "every invite-only vehicle to the whole Collective",
     ENGINE,
     # The bare line also appears in the module doc comment, which QUOTES the
     # defective spvEngineStore line by name. Anchoring on it alone mutated a
     # COMMENT and the mutant survived for the emptiest possible reason. The
     # anchor now includes the following code line so it is unique to code.
     ('  if (scope === "private" || scope === "invite_only") return false;\n'
      '  // collective_only is FIRST-CLASS'),
     ('  if (scope === "private") return false;\n'
      '  if (scope === "invite_only") return true;\n'
      '  // collective_only is FIRST-CLASS')),

    ("M2  an invitation upgrades a PRIVATE vehicle — private and invite_only "
     "collapse into one scope in the other direction",
     ENGINE,
     '    return scope === "invite_only" || scope === "collective_only" || scope === "network";',
     '    return true;'),

    ("M3  the invitation is not actually checked (the `hasInvitation` argument "
     "is accepted and ignored)",
     ENGINE,
     '    if (viewer.hasInvitation !== true) return false;',
     '    if (false) return false;'),

    ("M4  fail-OPEN on an unrecognised scope — a scope added to the enum later "
     "becomes public instead of invisible",
     ENGINE,
     '  if (!isSpvScope(scope)) return false;\n  if (!isSpvDiscoveryContext(context)) return false;\n  // `invited` is not a broadcast audience.',
     '  if (!isSpvScope(scope)) return true;\n  if (!isSpvDiscoveryContext(context)) return false;\n  // `invited` is not a broadcast audience.'),

    ("M5  collective_only leaks onto the core Capavate surfaces",
     ENGINE,
     '  if (scope === "collective_only") return context === "collective";',
     '  if (scope === "collective_only") return true;'),

    ("M6  `invited` answered as a broadcast audience — a viewer-scoped "
     "relationship mistaken for public reach",
     ENGINE,
     '  if (context === "invited") return false;\n  if (scope === "private"',
     '  if (context === "invited") return scope !== "private";\n  if (scope === "private"'),

    ("M7  unknown reach rendered as ZERO instead of a refusal (null-as-zero, "
     "forbidden)",
     ENGINE,
     '      parts.push("The number of live invitations could not be read, so its reach is unknown.");',
     '      parts.push("There are no live invitations, so nobody can currently reach this vehicle. Selecting invite-only does not by itself make it visible to anyone.");'),

    ("M8  an unrecognised scope claims reach instead of stating a refusal",
     ENGINE,
     '        "This vehicle has no recognised distribution scope recorded, so its reach cannot be stated. It is treated as unreachable until a scope is set.",',
     '        "Network. Discoverable across the Collective and on the core Capavate investor surfaces.",'),

    # ── the store: the real privacy boundary ──────────────────────────────
    ("M9  email match becomes case-SENSITIVE — a GP who typed a different case "
     "silently invites nobody",
     STORE,
     "WHERE lower(trim(email)) IN (${placeholders})",
     "WHERE email IN (${placeholders})"),

    ("M10 the invitation status allow-list becomes a negative filter — revoked "
     "invitations keep reaching",
     STORE,
     '  return rows.filter((r) => LIVE.has(String(r.status ?? "invited"))).map((r) => r.spv_id);',
     "  return rows.map((r) => r.spv_id);"),

    ("M11 soft-deleted invitations keep reaching",
     STORE,
     "          AND deleted_at IS NULL`,",
     "          AND 1 = 1`,"),

    ("M12 the invited half is dropped entirely — CP-SPV-53 regresses to the "
     "state this item was written to fix",
     STORE,
     "  const invited = new Set(invitedSpvIdsFor(userId));\n  const out: DiscoverableSpv[] = [];",
     "  const invited = new Set<string>();\n  const out: DiscoverableSpv[] = [];"),

    ("M13 draft and archived vehicles become discoverable",
     STORE,
     "        WHERE archived_at IS NULL AND status <> 'draft'",
     "        WHERE 1 = 1"),

    ("M14 the reach figure counts EVENTS instead of DISTINCT viewers — one "
     "person reloading inflates a GP-facing number",
     STORE,
     "SELECT COUNT(DISTINCT viewer_user_id) AS n FROM spv_discovery_event",
     "SELECT COUNT(viewer_user_id) AS n FROM spv_discovery_event"),

    ("M15 cross-partner reach is served instead of refused — the partner id in "
     "the WHERE clause stops narrowing",
     STORE,
     "        WHERE id = ? AND sponsor_partner_id = ? LIMIT 1`,",
     "        WHERE id = ? AND (? IS NOT NULL) LIMIT 1`,"),

    ("M16 a discovery event is written for a scope the domain does not "
     "recognise (the CHECK-constraint bypass)",
     STORE,
     "    if (!isSpvScope(r.scope)) continue;",
     "    if (false) continue;"),

    ("M17 money divided by 100 on the read path — breaks the JPY fixture "
     "(exponent 0)",
     STORE,
     ("    minCheckMinor: r.min_check_minor === null || r.min_check_minor === undefined\n"
      "      ? null\n"
      "      : Number(r.min_check_minor),"),
     ("    minCheckMinor: r.min_check_minor === null || r.min_check_minor === undefined\n"
      "      ? null\n"
      "      : Number(r.min_check_minor) / 100,")),

    # ── the routes ────────────────────────────────────────────────────────
    ("M18 cross-tenant refusal downgraded from 404 to 403 (leaks existence)",
     ROUTES,
     "      if (!found) return res.status(404).json(NOT_FOUND);",
     "      if (!found) return res.status(403).json(NOT_FOUND);"),

    ("M19 the caller supplies their own identity — the classic URL-supplied-id "
     "escalation",
     ROUTES,
     ('    const ctx = getUserContext(req);\n'
      '    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });\n'
      '    try {\n'
      '      const spvId = String(req.params.spvId);'),
     ('    const ctx = { ...getUserContext(req), userId: (req.query.userId as string) || getUserContext(req).userId };\n'
      '    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });\n'
      '    try {\n'
      '      const spvId = String(req.params.spvId);')),

    ("M20 the auth check is removed — anonymous callers read the feed",
     ROUTES,
     '    if (!ctx?.isAuthed || !ctx.userId) return res.status(401).json({ error: "AUTH_REQUIRED" });',
     "    // auth removed"),
]


def run() -> int:
    originals = {}
    for _, f, _, _ in MUTANTS:
        if f not in originals:
            originals[f] = (ROOT / f).read_text()

    results = []
    for name, f, old, new in MUTANTS:
        orig = originals[f]
        if old not in orig:
            results.append((name, "ERROR: anchor not found"))
            print(f"ERROR    {name}", flush=True)
            continue
        (ROOT / f).write_text(orig.replace(old, new, 1))
        p = subprocess.run(["npx", "vitest", "run", TEST], cwd=ROOT,
                           capture_output=True, text=True)
        (ROOT / f).write_text(orig)
        killed = p.returncode != 0
        results.append((name, "KILLED" if killed else "SURVIVED"))
        print(f"{'KILLED  ' if killed else 'SURVIVED'} {name}", flush=True)

    # restore unconditionally, even if a run above threw
    for f, src in originals.items():
        (ROOT / f).write_text(src)

    print("\n=== SUMMARY ===")
    for n, r in results:
        print(f"{r:9s} {n}")
    return 0 if all(r == "KILLED" for _, r in results) else 1


if __name__ == "__main__":
    sys.exit(run())
