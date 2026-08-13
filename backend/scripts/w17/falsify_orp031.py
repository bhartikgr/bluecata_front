#!/usr/bin/env python3
"""
WAVE 17 — falsification harness for ORP-031 (hand-over listing + admin capability).

Same contract as falsify_orp042/044: each mutation breaks exactly one thing the
suite claims to prove, the harness requires the suite to go RED for every one,
then restores the tree byte-for-byte and re-asserts the clean pass.

Run from the repo root:  python3 scripts/w17/falsify_orp031.py
"""
import subprocess
import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = "server/__tests__/wave17_orp031_handover_listing_and_admin_capability.test.ts"

STORE = ROOT / "server/managedFounderStore.ts"
ROUTES = ROOT / "server/managedFounderRoutes.ts"
FILES = [STORE, ROUTES]


def run_suite():
    p = subprocess.run(
        ["npx", "vitest", "run", SUITE],
        cwd=ROOT, capture_output=True, text=True,
    )
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
        "listHandovers: drop the partner_id predicate (cross-partner leak)",
        STORE,
        'const where: string[] = ["partner_id = ?"];\n    const args: unknown[] = [partnerId];',
        'const where: string[] = ["1 = 1"];\n    const args: unknown[] = [];',
    ),
    (
        "listHandovers: ignore the engagementId filter",
        STORE,
        'if (filter.engagementId) { where.push("engagement_id = ?"); args.push(filter.engagementId); }',
        'if (false && filter.engagementId) { where.push("engagement_id = ?"); args.push(filter.engagementId); }',
    ),
    (
        "listHandovers: ignore the status filter",
        STORE,
        'if (filter.status) { where.push("status = ?"); args.push(filter.status); }',
        'if (false && filter.status) { where.push("status = ?"); args.push(filter.status); }',
    ),
    (
        "listHandovers: return RAW snake_case rows instead of the mapped shape",
        STORE,
        "return rows.map(rowToHandover);",
        "return rows as any;",
    ),
    (
        "rowToHandover: lose confirmedAt (the confirmed-state read-back)",
        STORE,
        "confirmedAt: r.confirmed_at ?? null,",
        "confirmedAt: null,",
    ),
    (
        "capability GET: stop returning seedableTypes (admin dropdown goes empty)",
        ROUTES,
        "      seedableTypes: SEEDABLE_PARTNER_TYPES,\n",
        "",
    ),
    (
        "partner hand-over listing: remove the route entirely",
        ROUTES,
        'app.get("/api/partner/me/mfcrm/handovers", requirePartnerAuth,',
        'app.get("/api/partner/me/mfcrm/handovers__removed", requirePartnerAuth,',
    ),
    (
        "admin hand-over listing: remove the route entirely",
        ROUTES,
        'app.get("/api/admin/mfcrm/handovers/:partnerId",',
        'app.get("/api/admin/mfcrm/handovers__removed/:partnerId",',
    ),
    (
        "admin engagement listing: remove the route entirely",
        ROUTES,
        'app.get("/api/admin/mfcrm/engagements/:partnerId", (req: Request, res: Response) => {\n    if (!requireAdminCtx(req, res)) return;',
        'app.get("/api/admin/mfcrm/engagements__removed/:partnerId", (req: Request, res: Response) => {\n    if (!requireAdminCtx(req, res)) return;',
    ),
    (
        "admin engagement listing: drop partner scope (returns another firm's rows)",
        ROUTES,
        "res.json({ engagements: managedFounderStore.listEngagements(String(req.params.partnerId)) });",
        'res.json({ engagements: managedFounderStore.listEngagements("ac_consortium_partner_test_partner_inc") });',
    ),
    (
        "requireAdminCtx: accept any caller (the 403 pole)",
        ROUTES,
        "if (!ctx?.isAuthed || !ctx.isAdmin) {",
        "if (false) {",
    ),
    (
        "partner hand-over listing: authenticate nobody (the 401/403 pole)",
        ROUTES,
        'app.get("/api/partner/me/mfcrm/handovers", requirePartnerAuth, (req: Request, res: Response) => {\n    const pid = req.partnerContext!.partnerId;',
        'app.get("/api/partner/me/mfcrm/handovers", (req: Request, res: Response) => {\n    const pid = "ac_consortium_partner_test_partner_inc";',
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
