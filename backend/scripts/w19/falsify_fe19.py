#!/usr/bin/env python3
"""
WAVE 19 — falsification harness for FE-19 (SEAT-02 / SEAT-04).

Mutations 1 and 2 restore the ORIGINAL defective code verbatim. If the suite
stays green on those, it is not evidence about this item.

Run from the repo root:  python3 scripts/w19/falsify_fe19.py
"""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SUITE = "server/__tests__/wave19_fe19_partner_seat_integrity.test.ts"

STORE = ROOT / "server/partnerWorkspaceStore.ts"
ROUTES = ROOT / "server/partnerRoutes.ts"
AUTH = ROOT / "server/lib/requirePartnerAuth.ts"
MIG_A = ROOT / "migrations/0172_wave19_partner_invitation_seat_integrity.sql"
MIG_B = ROOT / "server/db/migrations/0172_wave19_partner_invitation_seat_integrity.sql"
FILES = [STORE, ROUTES, AUTH, MIG_A, MIG_B]


def run(suite: str):
    p = subprocess.run(["npx", "vitest", "run", suite], cwd=ROOT, capture_output=True, text=True)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if m:
        return int(m.group(1) or 0), int(m.group(2))
    m = re.search(r"Tests\s+(\d+) failed\b", out)
    if m:
        return int(m.group(1)), 0
    return 999, 0


MUTATIONS = [
    (
        "SEAT-02 DEFECT RESTORED: the pending count goes back to a pure RAM array filter",
        STORE,
        """    try {
      return Math.max(this.countPendingDurable(partnerId, nowIso), ramCount);
    } catch (err) {""",
        """    try {
      return ramCount;
    } catch (err) {""",
    ),
    (
        "the durable count REPLACES the RAM count instead of raising it (a sibling row can lower it)",
        STORE,
        "return Math.max(this.countPendingDurable(partnerId, nowIso), ramCount);",
        "return this.countPendingDurable(partnerId, nowIso);",
    ),
    (
        "a durable read failure collapses the limit to zero (an outage mints free seats)",
        STORE,
        """        (err as Error).message,
      );
      return ramCount;""",
        """        (err as Error).message,
      );
      return 0;""",
    ),
    (
        "the durable query stops filtering redeemed invitations",
        STORE,
        "            AND json_extract(invitation_json, '$.redeemedAt') IS NULL\n",
        "",
    ),
    (
        "the durable query stops filtering EXPIRED invitations",
        STORE,
        "            AND json_extract(invitation_json, '$.expiresAt') > ?",
        "            AND json_extract(invitation_json, '$.expiresAt') > ''",
    ),
    (
        "the durable query leaks other partners' invitations into the count",
        STORE,
        "          WHERE partner_id = ?\n",
        "          WHERE (partner_id = ? OR 1=1)\n",
    ),
    (
        "SEAT-04 DEFECT RESTORED: the guard is evaluated BEFORE the transaction (stale counts)",
        STORE,
        """      const activeSeats = partnerTeamStore.countActiveSeats(partnerId);
      const pending = partnerInvitationStore.countPendingDurable(partnerId, nowIso);
      guard({ activeSeats, pending });""",
        """      guard({ activeSeats: PRE_TX_ACTIVE, pending: PRE_TX_PENDING });""",
    ),
    (
        "the guard is never called at all — the limit is not enforced",
        STORE,
        "      guard({ activeSeats, pending });",
        "      void guard;",
    ),
    (
        "the INSERT happens BEFORE the guard, so a rejected invite still exists",
        STORE,
        """      guard({ activeSeats, pending });
      db.prepare(""",
        """      db.prepare(""",
    ),
    (
        "the transaction is dropped — check and insert are unprotected again",
        STORE,
        "    if (run.immediate) run.immediate(); else run();",
        "    run();",
    ),
    (
        "the RAM cache is populated even when the guard rejects",
        STORE,
        """    if (run.immediate) run.immediate(); else run();

    teamInvitations.push(inv);""",
        """    teamInvitations.push(inv);
    if (run.immediate) run.immediate(); else run();""",
    ),
    (
        "the invited email stops being normalised to lower case (duplicate seats by casing)",
        STORE,
        """      invitedEmail: invitedEmail.toLowerCase(),
      subRole,
      title: opts.title ?? null,
      tokenHash,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
      redeemedAt: null,
      redeemedUserId: null,
      createdAt: nowIso,""",
        """      invitedEmail,
      subRole,
      title: opts.title ?? null,
      tokenHash,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
      redeemedAt: null,
      redeemedUserId: null,
      createdAt: nowIso,""",
    ),
    (
        "the RAW token is stored alongside its hash",
        STORE,
        """      ).run(inv.id, inv.partnerId, JSON.stringify(inv), nowIso);
    });""",
        """      ).run(inv.id, inv.partnerId, JSON.stringify({ ...inv, plainToken }), nowIso);
    });""",
    ),
    (
        "POLICY: pending invitations stop counting against the seat limit",
        AUTH,
        "  if (counts.activeSeats + counts.pending >= seatLimit) {",
        "  if (counts.activeSeats >= seatLimit) {",
    ),
    (
        "POLICY: an unknown partner is defaulted to a tier instead of rejected",
        AUTH,
        '  if (!partner) throw new Error("PARTNER_NOT_FOUND");',
        "  if (!partner) return;",
    ),
    (
        "POLICY: the boundary is off by one (the limit-th seat is handed out)",
        AUTH,
        "  if (counts.activeSeats + counts.pending >= seatLimit) {",
        "  if (counts.activeSeats + counts.pending > seatLimit) {",
    ),
    (
        "assertTierSeats is hollowed out — the read-only callers stop enforcing",
        AUTH,
        """  assertSeatCapacity(partnerId, {
    activeSeats: partnerTeamStore.countActiveSeats(partnerId),
    pending: partnerInvitationStore.countPendingByPartner(partnerId),
  });""",
        "  return;",
    ),
    (
        "WIRING: the route reverts to the unprotected create()",
        ROUTES,
        "partnerInvitationStore.createWithSeatGuard(",
        "partnerInvitationStore.createUNWIRED(",
    ),
    (
        "the route launders a storage failure into a 403 'buy more seats'",
        ROUTES,
        # ANCHOR FENCE FIX (parent, 2026-08-11): `        throw e;\n      }` occurs 4x in
        # partnerRoutes.ts, so the fence correctly refused to run. Extended with the
        # preceding seat-specific lines, which appear exactly once.
        """        throw e;
      }
      // Plain token is returned ONCE to the inviter""",
        """        return res.status(403).json({ error: "PARTNER_TIER_SEAT_LIMIT_REACHED" });
      }
      // Plain token is returned ONCE to the inviter""",
    ),
    (
        "the 403 error string drifts, silently blanking the client's banner copy",
        ROUTES,
        'error: msg.includes("PARTNER_NOT_FOUND") ? "PARTNER_NOT_FOUND" : "PARTNER_TIER_SEAT_LIMIT_REACHED",',
        'error: "seat limit",',
    ),
    (
        "MIGRATION: the two mirrors drift apart",
        MIG_B,
        "idx_pti_partner_pending",
        "idx_pti_partner_pending_DRIFTED",
    ),
]


def main():
    snap = {f: f.read_text() for f in FILES}
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
        return 2

    detected, missed = 0, []
    for i, (label, path, old, new) in enumerate(MUTATIONS, 1):
        path.write_text(path.read_text().replace(old, new, 1))
        f, p = run(SUITE)
        for g, text in snap.items():
            g.write_text(text)
        ok = f > 0
        if ok:
            detected += 1
        else:
            missed.append(label)
        print(f"[{i:2}/{len(MUTATIONS)}] {'DETECTED' if ok else 'MISSED  '}  {label}  ({f} failed / {p} passed)")

    for g, text in snap.items():
        g.write_text(text)
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
