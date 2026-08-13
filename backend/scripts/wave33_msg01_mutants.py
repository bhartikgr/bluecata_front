#!/usr/bin/env python3
"""WAVE 33 · CP-MSG-01 — mutation testing for partner messaging with delegated context.

Same discipline as the item-4 and item-5 runners: every anchor is verified
UNIQUE and OUTSIDE COMMENTS before anything is mutated, because a runner that
silently mutates a doc comment reports SURVIVED while having changed nothing.

The mutants attack the three things this item is:
  * the AUDIENCE being DATA — can a rule be ignored, defaulted on, or applied to
    the wrong role without a test noticing?
  * the DELEGATION PROOF — can an unprovable claim be stamped, or a lapsed
    engagement keep granting authority?
  * the REFUSAL — can an unprovable claim be silently downgraded to an ordinary
    message instead of refused?

Survivors must be classified: harness bug / coverage gap / equivalent mutant.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TESTS = [
    "server/__tests__/wave33_msg01_delegated_messaging.test.ts",
    # The unreadable-database branch of readRules(). Statically imported
    # `rawDb` can only be replaced with vi.doMock + a dynamic import, which
    # cannot share a file with the main harness's real-DB fixtures. Added
    # after the first mutation pass showed M5 surviving for want of it.
    "server/__tests__/wave33_msg01_rules_unreadable.test.ts",
    "client/src/components/comms/__tests__/wave33_msg01_audience_notice.test.tsx",
]

RULES = "server/lib/commsAudienceRules.ts"
CTX = "server/lib/partnerDelegatedContext.ts"
STORE = "server/commsStore.ts"
INST = "server/lib/applyCommsDelegatedContextSchema.ts"
UI = "client/src/components/comms/MessagingAudienceNotice.tsx"

MUTANTS = [
    # ── the audience is DATA ──────────────────────────────────────────────
    ("M1", RULES,
     "  if (!rule || !rule.enabled) return false;",
     "  if (!rule) return false;",
     "ignore `enabled` — a disabled rule still grants an audience"),
    ("M2", RULES,
     "  if (!rule || !rule.enabled) return false;",
     "  if (!rule) return true;",
     "an unknown rule key defaults ON — code invents an audience the DB never granted"),
    ("M3", RULES,
     '  if (rule.appliesToViewerRole === "any") return true;\n  return !!viewerRole && rule.appliesToViewerRole === viewerRole;',
     '  return true;',
     "role scoping dropped — a partner-scoped rule opens for investors and founders"),
    ("M4", RULES,
     "    if (!Array.isArray(rows) || rows.length === 0) return legacyFallback();",
     "    if (!Array.isArray(rows)) return legacyFallback();",
     "an EMPTY rules table silently empties every picker on the platform"),
    ("M5", RULES,
     "  } catch {\n    return legacyFallback();\n  }\n}",
     "  } catch {\n    return [];\n  }\n}",
     "an unreadable rules table drops the four pre-existing sources — a silent total drop"),
    ("M6", RULES,
     "              requires_owner_decision = 0,",
     "              requires_owner_decision = 1,",
     "an owner ruling never clears the open-question flag — the notice never goes away"),
    ("M7", RULES,
     "  return readRules().filter(\n    (r) =>\n      r.requiresOwnerDecision &&",
     "  return readRules().filter(\n    (r) =>\n      !r.requiresOwnerDecision &&",
     "pendingOwnerDecisions() reports the DECIDED rules — the open question is hidden"),

    # ── the picker sink ───────────────────────────────────────────────────
    ("M8", STORE,
     'if (isAudienceRuleEnabled("partner_engaged_company_people", viewerRole)) {',
     "if (true) {",
     "the undecided partner rule is applied anyway — the build answers a commercial question the owner has not"),
    ("M9", STORE,
     'if (isAudienceRuleEnabled("cap_table_peer", viewerRole)) {',
     "if (false) {",
     "the pre-existing cap-table source is dropped — the classic silent functionality drop"),
    ("M10", STORE,
     'if (isAudienceRuleEnabled("partner_team_peers", viewerRole)) {\n      for (const p of partnerTeamPeerIds(viewerId)) {\n        peers.add(p);\n        candidateIds.add(p);\n      }',
     'if (isAudienceRuleEnabled("partner_team_peers", viewerRole)) {\n      for (const p of partnerTeamPeerIds(viewerId)) {\n        peers.add(p);\n      }',
     "peer added but never made a CANDIDATE — enabled rule yields an empty picker anyway"),

    # ── the delegation proof ──────────────────────────────────────────────
    ("M11", CTX,
     "            AND status = 'ACTIVE'\n            AND founder_revoked_at IS NULL\n            AND archived_at IS NULL",
     "            AND status = 'ACTIVE'",
     "a founder-revoked or archived engagement still grants delegated authority"),
    ("M12", CTX,
     "          WHERE partner_id = ?\n            AND status = 'ACTIVE'",
     "          WHERE partner_id = ?",
     "a TERMINATED engagement grants authority"),
    ("M13", CTX,
     "  const engagement = engagementFor(userId, companyId);\n  if (!engagement) return null;",
     "  const engagement = engagementFor(userId, companyId);",
     "stamp without proving the engagement — an unprovable delegation is recorded as fact"),
    ("M14", CTX,
     "  const partnerId = resolvePartnerIdForUser(userId);\n  if (!partnerId) return null;\n  const engagement = engagementFor(userId, companyId);",
     "  const partnerId = resolvePartnerIdForUser(userId) ?? 'pt_unknown';\n  const engagement = engagementFor(userId, companyId);",
     "a non-partner can stamp a delegation"),
    ("M15", CTX,
     "          WHERE user_id = ? AND status = 'active' AND removed_at IS NULL",
     "          WHERE user_id = ?",
     "a REMOVED team member still resolves as an active partner principal"),
    ("M16", CTX,
     "          WHERE partner_id = ? AND status = 'active' AND removed_at IS NULL\n            AND user_id <> ?",
     "          WHERE partner_id = ?\n            AND user_id <> ?",
     "removed colleagues appear in the partner team audience"),
    ("M17", CTX,
     "`INSERT OR IGNORE INTO comms_delegated_context",
     "`INSERT OR REPLACE INTO comms_delegated_context",
     "a re-stamp REWRITES history — the authority a thread was opened under can be changed later"),
    ("M18", CTX,
     "    const name = (row?.name ?? \"\").trim();\n    return name.length > 0 ? name : null;",
     "    const name = (row?.name ?? \"\").trim();\n    return name.length > 0 ? name : \"Consortium Partner\";",
     "invent an organisation name server-side instead of returning null"),
    ("M19", CTX,
     '          WHERE company_id = ? AND is_active = 1',
     '          WHERE company_id = ?',
     "former company members are offered as a delegated audience"),

    # ── the refusal ───────────────────────────────────────────────────────
    ("M20", STORE,
     '      const proof = engagementFor(actorId, delegatedCompanyId);\n      if (!proof) {',
     '      const proof = engagementFor(actorId, delegatedCompanyId);\n      if (false) {',
     "an unprovable claim on the MESSAGE sink is silently downgraded to a personal message"),
    ("M21", STORE,
     "    if (dmDelegatedCompanyId && !engagementFor(actorId, dmDelegatedCompanyId)) {",
     "    if (false) {",
     "same, at the DM CHANNEL sink — the second path"),
    ("M22", STORE,
     '      if (delegatedCompanyId) stampDelegatedContext("message", id, actorId, delegatedCompanyId);',
     "",
     "the message sink never stamps — the whole point of the item, silently absent"),
    ("M23", STORE,
     '    if (dmDelegatedCompanyId) stampDelegatedContext("channel", id, actorId, dmDelegatedCompanyId);',
     "",
     "the channel sink never stamps"),
    ("M24", STORE,
     '    delegatedContext: readDelegatedContext("message", msg.id) ?? undefined,',
     "    delegatedContext: undefined,",
     "stamped but never PROJECTED — invisible to every reader, which is the same as absent"),

    # ── the installer ─────────────────────────────────────────────────────
    ("M25", INST,
     "    if (haveRules && haveStamp && ruleCount(db) > 0) return;",
     "    if (haveRules && haveStamp) return;",
     "a half-healed DB (table present, zero rules) is left ruleless forever"),
    ("M26", INST,
     "    if (haveRules && haveStamp && ruleCount(db) > 0) return;",
     "    if (haveRules) return;",
     "the delegated-context table is never created when only the rules table exists"),

    # ── the UI ────────────────────────────────────────────────────────────
    ("M27", UI,
     "  if (q.isError || !q.data) {",
     "  if (false) {",
     "a failed policy read renders a reassuring blank instead of a stated failure"),
    ("M28", UI,
     "  if (pendingOwnerDecision.length === 0 && !delegatedContext) return null;",
     "  return null;",
     "the notice renders nothing at all — mounted but silent"),
    ("M29", UI,
     "                {r.recommendedDefault && (\n                  <div className=\"italic opacity-80\">{r.recommendedDefault}</div>\n                )}",
     "",
     "the recommendation put to the owner is not shown"),
    ("M30", UI,
     '            {delegatedContext.partnerName ??\n              "your Consortium Partner organisation (name not on file)"}',
     "            {delegatedContext.partnerName}",
     "a missing org name renders blank instead of a stated fallback"),
]


def run_tests() -> bool:
    r = subprocess.run(["npx", "vitest", "run", *TESTS], cwd=ROOT,
                       capture_output=True, text=True, timeout=2400)
    return r.returncode == 0


def strip_comments(s: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*[\s\S]*?\*/", "", s))


def main() -> int:
    print("verifying anchors before mutating anything…")
    bad, seen = [], set()
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
