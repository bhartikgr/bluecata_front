#!/usr/bin/env python3
"""
WAVE 18 — falsification harness for ORP-043 (the Tier 1/2/3 comms surface).

Each mutation reverts exactly one thing this item fixed — the identity source, a
scope filter, a membership guard, a rendered refusal, a caller — and the suite
that claims to cover it must go RED. A MISSED mutation means that claim was
decorative and the harness exits non-zero.

Note on the identity mutations: reverting to `fromUserId` (etc.) from the body is
not a synthetic break; it is the code as it stood before this item, so every
"DETECTED" line below is a statement that the suite would have caught the real
defect.

Run from the repo root:  python3 scripts/w18/falsify_orp043.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_SUITE = "server/__tests__/wave18_orp043_comms_tiers.test.ts"
CLIENT_SUITE = "client/src/components/comms/__tests__/wave18_orp043_comms_tier_actions.test.tsx"
LEGACY_SUITE = "server/__tests__/sprint16/commsTiersRoutes.test.ts"

TIERS = ROOT / "server/commsTiersStore.ts"
PANEL = ROOT / "client/src/components/comms/CommsTierActionsPanel.tsx"
INVMSG = ROOT / "client/src/pages/investor/Messages.tsx"
FNDMSG = ROOT / "client/src/pages/founder/Messages.tsx"

FILES = [TIERS, PANEL, INVMSG, FNDMSG]


def run(suite: str):
    p = subprocess.run(["npx", "vitest", "run", suite], cwd=ROOT, capture_output=True, text=True)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if m:
        return int(m.group(1) or 0), int(m.group(2))
    # A run in which EVERY test failed prints no "passed" clause at all. That is
    # a real red run, not a broken harness, so it must not be reported as 999.
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
    # ── D1: actor identity ──────────────────────────────────────────────────
    (
        "identity: cross-cohort DM sender comes from the body again (mute bypass)",
        SERVER_SUITE,
        TIERS,
        '    const who = resolveTierActor(req, fromUserId, "fromUserId");\n'
        '    if (!who.ok) return res.status(who.status).json({ error: who.error });\n'
        '    const r = startCrossCohortDm({ roundId, fromUserId: who.actorId, toUserId, body });',
        "    const r = startCrossCohortDm({ roundId, fromUserId, toUserId, body });",
    ),
    (
        "identity: group message author comes from the body again",
        SERVER_SUITE,
        TIERS,
        '    const who = resolveTierActor(req, authorUserId, "authorUserId");\n'
        '    if (!who.ok) return res.status(who.status).json({ error: who.error });\n',
        "",
    ),
    (
        "identity: mute is placed on a body-named user's behalf again",
        SERVER_SUITE,
        TIERS,
        '    const who = resolveTierActor(req, muterId, "muterId");\n'
        '    if (!who.ok) return res.status(who.status).json({ error: who.error });\n'
        '    if (!roundId || !mutedId) return res.status(400).json({ error: "missing_fields" });\n'
        "    muteCrossCohort({ roundId, muterId: who.actorId, mutedId });",
        '    if (!roundId || !muterId || !mutedId) return res.status(400).json({ error: "missing_fields" });\n'
        "    muteCrossCohort({ roundId, muterId, mutedId });",
    ),
    (
        "identity: a privacy opt-in can be written for another investor again",
        SERVER_SUITE,
        TIERS,
        '    const who = resolveTierActor(req, userId, "userId");\n'
        '    if (!who.ok) return res.status(who.status).json({ error: who.error });\n'
        '    if (typeof optedIn !== "boolean") return res.status(400).json({ error: "missing_fields" });\n'
        "    const r = setSoftCirclePeerOptIn({ roundId: req.params.roundId, userId: who.actorId, optedIn, crossCohortDmOptedIn });",
        '    if (!userId || typeof optedIn !== "boolean") return res.status(400).json({ error: "missing_fields" });\n'
        "    const r = setSoftCirclePeerOptIn({ roundId: req.params.roundId, userId, optedIn, crossCohortDmOptedIn });",
    ),
    (
        "identity: endorsement is attributed to a body-named endorser again",
        SERVER_SUITE,
        TIERS,
        '    const who = resolveTierActor(req, endorserUserId, "endorserUserId");\n'
        '    if (!who.ok) return res.status(who.status).json({ error: who.error });\n'
        "    const r = createEndorsement({ roundId: req.params.roundId, companyId, endorserUserId: who.actorId, chip, text, disclaimerAck });",
        "    const r = createEndorsement({ roundId: req.params.roundId, companyId, endorserUserId, chip, text, disclaimerAck });",
    ),
    (
        "identity: the mismatch is silently overridden instead of refused (400 -> quiet correction)",
        SERVER_SUITE,
        TIERS,
        '      return { ok: false, status: 400, error: `${field}_must_match_session` };',
        "      return { ok: true, actorId: sessionId, source: \"session\" };",
    ),
    (
        "identity: no identity at all is accepted (the 401 pole disappears)",
        SERVER_SUITE,
        TIERS,
        '  return { ok: false, status: 401, error: "missing_identity" };',
        '  return { ok: true, actorId: "u_unknown", source: "body" };',
    ),
    (
        "identity: a blank body actor is treated as a real user id",
        SERVER_SUITE,
        TIERS,
        'const bodyId = typeof bodyValue === "string" && bodyValue.trim() ? bodyValue.trim() : null;',
        'const bodyId = typeof bodyValue === "string" ? bodyValue : null;',
    ),
    (
        "identity: Q&A answer author comes from the body again (second path)",
        SERVER_SUITE,
        TIERS,
        '    const whoA = resolveTierActor(req, authorUserId, "authorUserId");\n'
        '    if (!whoA.ok) return res.status(whoA.status).json({ error: whoA.error });\n'
        "    const r = postQaAnswer({ questionId: req.params.qid, authorUserId: whoA.actorId, body });",
        "    const r = postQaAnswer({ questionId: req.params.qid, authorUserId, body });",
    ),
    (
        "identity: diligence volunteer is signed up in someone else's name again (second path)",
        SERVER_SUITE,
        TIERS,
        '    const whoV = resolveTierActor(req, volunteerUserId, "volunteerUserId");\n'
        '    if (!whoV.ok) return res.status(whoV.status).json({ error: whoV.error });\n'
        '    if (!softCirclerUserId) return res.status(400).json({ error: "missing_fields" });\n'
        "    const v = createDiligenceVolunteer({ roundId: req.params.roundId, volunteerUserId: whoV.actorId, softCirclerUserId });",
        '    if (!volunteerUserId || !softCirclerUserId) return res.status(400).json({ error: "missing_fields" });\n'
        "    const v = createDiligenceVolunteer({ roundId: req.params.roundId, volunteerUserId, softCirclerUserId });",
    ),
    (
        "identity: Q&A archive founder comes from the body again (second path)",
        SERVER_SUITE,
        TIERS,
        '    const whoF = resolveTierActor(req, founderUserId, "founderUserId");\n'
        '    if (!whoF.ok) return res.status(whoF.status).json({ error: whoF.error });\n'
        "    const r = archiveQaThread({ questionId: req.params.qid, founderUserId: whoF.actorId });",
        "    const r = archiveQaThread({ questionId: req.params.qid, founderUserId });",
    ),
    # ── D2: group listing scope ─────────────────────────────────────────────
    (
        "scope: group listing returns every room for the company again (participant-list leak)",
        SERVER_SUITE,
        TIERS,
        "g => g.companyId === req.params.companyId && !g.archivedAt && g.participants.includes(who.actorId),",
        "g => g.companyId === req.params.companyId && !g.archivedAt,",
    ),
    (
        "scope: the creator is no longer added to their own room (their own room vanishes from the list)",
        SERVER_SUITE,
        TIERS,
        "participants: [...participants, who.actorId], actorId: who.actorId });",
        "participants, actorId: who.actorId });",
    ),
    # ── D3: membership guard ────────────────────────────────────────────────
    (
        "guard: any authenticated user can post into any room again",
        SERVER_SUITE,
        TIERS,
        'if (!grp.participants.includes(who.actorId)) return res.status(403).json({ error: "not_a_participant" });\n    const m = postCoInvestorGroupMessage(',
        'const m = postCoInvestorGroupMessage(',
    ),
    (
        "guard: an unknown group 500s from the store throw instead of 404",
        SERVER_SUITE,
        TIERS,
        'if (!grp) return res.status(404).json({ error: "group_not_found" });\n    if (!grp.participants.includes(who.actorId)) return res.status(403).json({ error: "not_a_participant" });',
        'if (!grp) { /* fall through to the store throw */ }\n    if (grp && !grp.participants.includes(who.actorId)) return res.status(403).json({ error: "not_a_participant" });',
    ),
    (
        "guard: intro requests are no longer membership-gated",
        SERVER_SUITE,
        TIERS,
        'if (!grp.participants.includes(who.actorId)) return res.status(403).json({ error: "not_a_participant" });\n    const r = requestCoInvestorIntro(',
        'const r = requestCoInvestorIntro(',
    ),
    # ── D4: advocates scope ─────────────────────────────────────────────────
    (
        "advocates: answer the platform-wide set again",
        SERVER_SUITE,
        TIERS,
        "      advocates: scoped,",
        "      advocates: Array.from(highValueAdvocates),",
    ),
    (
        "advocates: accept a missing companyId instead of 400",
        SERVER_SUITE,
        TIERS,
        'if (!companyId) return res.status(400).json({ error: "companyId required" });',
        'if (!companyId) { /* accept */ }',
    ),
    (
        "advocates: drop the cap-table guard (any authed caller reads any company)",
        SERVER_SUITE,
        TIERS,
        'return res.status(403).json({ error: "NOT_ON_CAP_TABLE", companyId });',
        "/* guard removed */;",
    ),
    (
        "advocates: a removed endorsement still counts as an advocacy",
        SERVER_SUITE,
        TIERS,
        "      if (e.removedAt) continue;",
        "      /* removedAt ignored */;",
    ),
    (
        "advocates: drop the advisory label (a compliance string)",
        SERVER_SUITE,
        TIERS,
        '      label: "For informational purposes only",\n      companyId,',
        '      label: "Advocates",\n      companyId,',
    ),
    # ── client: the wiring itself ───────────────────────────────────────────
    (
        "client: never call the group listing endpoint (back to an orphan)",
        CLIENT_SUITE,
        PANEL,
        '      `/api/comms/co-investor-groups/${encodeURIComponent(companyId)}`,\n    ).catch(() => null);',
        '      `/api/comms/co-investor-groups-DISABLED/${encodeURIComponent(companyId)}`,\n    ).catch(() => null);',
    ),
    (
        "client: send the actor in the message body again (the server would now 400 it)",
        CLIENT_SUITE,
        PANEL,
        '        { body: messageBody.trim() },',
        '        { body: messageBody.trim(), authorUserId: "u_me" },',
    ),
    (
        "client: send the sender in the DM body again",
        CLIENT_SUITE,
        PANEL,
        '      toUserId: dmTo.trim(),\n      body: dmBody.trim(),',
        '      toUserId: dmTo.trim(),\n      body: dmBody.trim(),\n      fromUserId: "u_me",',
    ),
    (
        "client: send the muter in the mute body again",
        CLIENT_SUITE,
        PANEL,
        '      mutedId: muteTarget.trim(),',
        '      mutedId: muteTarget.trim(),\n      muterId: "u_me",',
    ),
    (
        "client: a listing refusal renders as the empty state (an outage reads as 'no groups')",
        CLIENT_SUITE,
        PANEL,
        "      setGroups(null);\n      setGroupsRefusal(res ? await readError(res) : \"network\");\n      return;",
        "      setGroups([]);\n      return;",
    ),
    (
        "client: swallow the 429 privacy refusal and claim success",
        CLIENT_SUITE,
        PANEL,
        '      setDmRefusal(res ? await readError(res) : "network");\n      return;',
        '      setDmOk("open");\n      return;',
    ),
    (
        "client: do not re-read the listing after creating a group (id lives only in state)",
        CLIENT_SUITE,
        PANEL,
        "      setParticipantsRaw(\"\");\n      /* Re-READ from the server",
        "      setParticipantsRaw(\"\");\n      if (false) /* Re-READ from the server",
    ),
    (
        "client: request the advocate list unscoped (the platform-wide leak, from the caller side)",
        CLIENT_SUITE,
        PANEL,
        '        `/api/founder/crm/high-value-advocates?companyId=${encodeURIComponent(companyId)}`,',
        '        "/api/founder/crm/high-value-advocates",',
    ),
    (
        "client: an advocates 403 renders as an empty list",
        CLIENT_SUITE,
        PANEL,
        "        setAdvocates(null);\n        setAdvocatesRefusal(res ? await readError(res) : \"network\");\n        return;",
        "        setAdvocates([]);\n        return;",
    ),
    (
        "client: a search outage renders as 'no messages match'",
        CLIENT_SUITE,
        PANEL,
        '      setResults(null);\n      setSearchRefusal(res ? await readError(res) : "network");\n      return;',
        "      setResults([]);\n      return;",
    ),
    (
        "client: show the advocates card to every role, not just the founder mount",
        CLIENT_SUITE,
        PANEL,
        "  showAdvocates = false,",
        "  showAdvocates = true,",
    ),
    (
        "client: offer cross-cohort controls with no round in scope (a control that can only 400)",
        CLIENT_SUITE,
        PANEL,
        "          {!roundId ? (",
        "          {false ? (",
    ),
    (
        "client: unknown error codes render as blank instead of copy",
        CLIENT_SUITE,
        PANEL,
        '  return TIER_ERROR_COPY[code] ?? `That request could not be completed (${code}). Nothing was changed.`;',
        '  return TIER_ERROR_COPY[code] ?? "";',
    ),
    # ── mounts ──────────────────────────────────────────────────────────────
    (
        "mount: unmount the panel from investor Messages",
        CLIENT_SUITE,
        INVMSG,
        "<CommsTierActionsPanel companyId={commsActionsCompanyId} roundId={commsActionsRoundId} />",
        "{/* <CommsTierActionsPanel companyId={commsActionsCompanyId} roundId={commsActionsRoundId} /> */}",
    ),
    (
        "mount: unmount the panel from founder Messages",
        CLIENT_SUITE,
        FNDMSG,
        "<CommsTierActionsPanel companyId={companyId ?? undefined} showAdvocates />",
        "{/* <CommsTierActionsPanel companyId={companyId ?? undefined} showAdvocates /> */}",
    ),
    # ── the legacy suite must still be a live fence ─────────────────────────
    (
        "legacy: the Sprint 16 suite still fails if the tier routes stop registering",
        LEGACY_SUITE,
        TIERS,
        "export function registerCommsTiersRoutes(app: Express): void {",
        "export function registerCommsTiersRoutes(app: Express): void {\n  if (process.env.VITEST) return;",
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
    print(f"\nALL {len(results)} MUTATIONS DETECTED · tree restored · both suites green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
