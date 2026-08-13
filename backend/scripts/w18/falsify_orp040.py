#!/usr/bin/env python3
"""
WAVE 18 — falsification harness for ORP-040 (the orphaned investor surface).

RULE 1, paid for in blood: a check that passes may be checking nothing, and the
newest instance of that happened INSIDE a falsification harness — Wave 17's
harness missed a `/100` mutation because its only invoice fixture was USD, where
correct and broken code print identically. Every money mutation below is therefore
required to be caught by fixtures that include JPY (ISO-4217 exponent 0) and KWD
(exponent 3), on BOTH the server and the client suite.

Each mutation breaks exactly ONE claim; the corresponding suite must go RED. A
MISSED mutation means the suite is decorative and the harness exits non-zero.

Run from the repo root:  python3 scripts/w18/falsify_orp040.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

SERVER_SUITE = "server/__tests__/wave18_orp040_investor_silo.test.ts"
CLIENT_SUITE = "client/src/components/investor/__tests__/wave18_orp040_investor_panels.test.tsx"

ROUTES = ROOT / "server/routes.ts"
MONEY = ROOT / "server/lib/money.ts"
DSC = ROOT / "server/adminDscRoutes.ts"
DISCOVER = ROOT / "server/lib/investorDiscoverProjection.ts"
SILO = ROOT / "client/src/components/investor/InvestorSiloPanel.tsx"
KYC = ROOT / "client/src/components/investor/InvestorKycDocumentsPanel.tsx"
DSCPANEL = ROOT / "client/src/components/investor/InvestorDscSubmitPanel.tsx"
DASH = ROOT / "client/src/pages/investor/Dashboard.tsx"
ACCRED = ROOT / "client/src/pages/investor/Accreditation.tsx"
CODETAIL = ROOT / "client/src/pages/investor/CompanyDetail.tsx"

FILES = [ROUTES, MONEY, DSC, DISCOVER, SILO, KYC, DSCPANEL, DASH, ACCRED, CODETAIL]


def run(suite: str):
    p = subprocess.run(["npx", "vitest", "run", suite], cwd=ROOT, capture_output=True, text=True)
    out = p.stdout + p.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    if m:
        return int(m.group(1) or 0), int(m.group(2))
    # A suite that cannot even collect (e.g. a type-level break) counts as RED,
    # but we distinguish it so a "detection" is never just a broken harness.
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
    # ── server: money ───────────────────────────────────────────────────────
    (
        "money: decimalStringToMinor uses a hardcoded 100 instead of the ISO-4217 exponent",
        SERVER_SUITE,
        MONEY,
        "  const shift = exp - fracPart.length + currencyExponent(currency);",
        "  const shift = exp - fracPart.length + 2;",
    ),
    (
        "money: decimalStringToMinor ROUNDS a too-precise value instead of refusing",
        SERVER_SUITE,
        MONEY,
        'throw new Error(`MONEY_DECIMAL_PRECISION_UNSUPPORTED:${label}`);',
        "frac = frac.slice(0, exp);",
    ),
    (
        "activity: hardcoded x100 on the ledger's decimal-string amount",
        SERVER_SUITE,
        ROUTES,
        'minor = Number(decimalStringToMinor(c.amount, ccy, "investor_activity_commit"));',
        "minor = Math.round(Number(c.amount) * 100);",
    ),
    (
        "activity: drop the currency, leaving an unrenderable bare amount",
        SERVER_SUITE,
        ROUTES,
        "          amountMinor: minor,\n          currency: ccy,",
        "          amountMinor: minor,\n          currency: null,",
    ),
    (
        "activity: revert to the epoch timestamp bug (commits sort to the bottom)",
        SERVER_SUITE,
        ROUTES,
        "ts: c.ts ?? c.updatedAt ?? c.createdAt ?? new Date(0).toISOString(),",
        "ts: c.updatedAt ?? c.createdAt ?? new Date(0).toISOString(),",
    ),
    (
        "soft-circles: stop projecting the exact amount_minor column",
        SERVER_SUITE,
        ROUTES,
        "        amountMinor: r.amountMinor ?? null,\n        state: r.state ?? r.status,",
        "        state: r.state ?? r.status,",
    ),
    (
        "watchlist: hardcoded x100 instead of the row's exact minor column",
        SERVER_SUITE,
        ROUTES,
        "        /* Exact integer minor units from the `amount_minor` column. */\n        amountMinor: r.amountMinor ?? null,",
        "        amountMinor: typeof r.amount === \"number\" ? Math.round(r.amount * 100) : null,",
    ),
    (
        "discover: hardcoded x100 instead of the exponent-aware toMinor",
        SERVER_SUITE,
        DISCOVER,
        "    targetAmountMinor: target === null ? null : toMinor(target, currency ?? \"USD\"),",
        "    targetAmountMinor: target === null ? null : Math.round(target * 100),",
    ),
    (
        "discover: fabricate a zero target where there is none",
        SERVER_SUITE,
        DISCOVER,
        "    targetAmountMinor: target === null ? null : toMinor(target, currency ?? \"USD\"),",
        "    targetAmountMinor: toMinor(target ?? 0, currency ?? \"USD\"),",
    ),
    (
        "discover: read roundsStore alone again (the feed goes permanently empty)",
        SERVER_SUITE,
        ROUTES,
        "      const all = (mergeLegacyAndDbRounds() as Array<any>) ?? [];",
        "      const all = (roundsStoreList() as Array<any>) ?? [];",
    ),
    (
        "discover: let closed rounds into the feed",
        SERVER_SUITE,
        DISCOVER,
        '  if (round?.status && String(round.status).toLowerCase() === "closed") return false;',
        "  /* closed filter removed */",
    ),
    # ── server: the invisible module graph ──────────────────────────────────
    (
        "watchlist: reinstate the runtime require() + silent-empty catch",
        SERVER_SUITE,
        ROUTES,
        "      const rows = softCircleListForInvestor(ctx.userId) ?? [];",
        '      const rows = (require("./softCircleStore") as any).listForInvestor(ctx.userId) ?? [];',
    ),
    (
        "activity: reinstate the runtime require() of the sacred ledger store",
        SERVER_SUITE,
        ROUTES,
        "      const commits = (captableListCommitsForUser(ctx.userId) ?? []) as Array<any>;",
        '      const commits = ((require("./captableCommitStore") as any).listCommitsForUser(ctx.userId) ?? []) as Array<any>;',
    ),
    # ── server: the new DSC read ────────────────────────────────────────────
    (
        "DSC read: drop the cap-table guard (any authed user reads any company)",
        SERVER_SUITE,
        DSC,
        "    if (!ctx.isAdmin && !isOnCapTable(ctx.userId, companyId)) {\n      return res.status(403).json({\n        ok: false,\n        error: \"NOT_ON_CAP_TABLE\",\n        message: \"You must be an investor on this company's cap table to see its DSC submissions.\",\n      });\n    }",
        "    /* cap-table guard removed */",
    ),
    (
        "DSC read: drop the companyId filter (platform-wide leak)",
        SERVER_SUITE,
        DSC,
        "WHERE company_id = ?",
        "WHERE company_id IS NOT NULL OR ? IS NOT NULL",
    ),
    (
        "DSC read: answer [] on a read error instead of failing closed with 503",
        SERVER_SUITE,
        DSC,
        "      return res.status(503).json({\n        ok: false,\n        error: \"DSC_PIPELINE_READ_FAILED\",",
        "      return res.status(200).json({\n        ok: true,\n        items: [],\n        count: 0,\n        _unused: \"DSC_PIPELINE_READ_FAILED\",",
    ),
    (
        "DSC read: accept a missing companyId instead of 400",
        SERVER_SUITE,
        DSC,
        'return res.status(400).json({ ok: false, error: "companyId required" });',
        "/* validation removed */",
    ),
    # ── client: money rendering ─────────────────────────────────────────────
    (
        "silo: hardcoded /100 instead of formatMinor (only JPY/KWD can catch this)",
        CLIENT_SUITE,
        SILO,
        "  return formatMinor(minor, currency);",
        "  return `${currency} ${(minor / 100).toFixed(2)}`;",
    ),
    (
        "silo: fabricate a zero instead of the not-set copy",
        CLIENT_SUITE,
        SILO,
        '  if (typeof minor !== "number" || !Number.isFinite(minor)) return AMOUNT_NOT_SET_COPY;',
        '  if (typeof minor !== "number" || !Number.isFinite(minor)) return formatMinor(0, currency ?? "USD");',
    ),
    (
        "silo: sum totals ACROSS currencies into one number",
        CLIENT_SUITE,
        SILO,
        '    acc.set(r.currency, (acc.get(r.currency) ?? 0) + r.amountMinor);',
        '    acc.set("ALL", (acc.get("ALL") ?? 0) + r.amountMinor);',
    ),
    (
        "silo: fold amountless rows into totals as zero",
        CLIENT_SUITE,
        SILO,
        '    if (typeof r.amountMinor !== "number" || !Number.isFinite(r.amountMinor)) continue;',
        "    const _keep = r;",
    ),
    (
        "silo: never call the watchlist endpoint (the uncalled-route regression)",
        CLIENT_SUITE,
        SILO,
        'queryFn: async () => (await apiRequest("GET", "/api/investor/watchlist")).json(),',
        "queryFn: async () => [],",
    ),
    (
        "silo: never call the activity endpoint",
        CLIENT_SUITE,
        SILO,
        'queryFn: async () => (await apiRequest("GET", "/api/investor/activity")).json(),',
        "queryFn: async () => [],",
    ),
    (
        "silo: drop the watchlist empty state (a silent blank card)",
        CLIENT_SUITE,
        SILO,
        "{!watchlistQ.isLoading && watchlist.length === 0 && (",
        "{false && (",
    ),
    # ── client: KYC ─────────────────────────────────────────────────────────
    (
        "kyc: offer a doc type the server's validator rejects",
        CLIENT_SUITE,
        KYC,
        '{ value: "source_of_funds"',
        '{ value: "bank_statement"',
    ),
    (
        "kyc: render a refusal as blank instead of copy",
        CLIENT_SUITE,
        KYC,
        "  return KYC_ERROR_COPY[error] ??",
        "  return \"\" ?? KYC_ERROR_COPY[error] ??",
    ),
    (
        "kyc: stop stripping the data-url prefix (the server would reject the blob)",
        CLIENT_SUITE,
        KYC,
        '  return comma >= 0 && dataUrl.slice(0, comma).includes("base64") ? dataUrl.slice(comma + 1) : dataUrl;',
        "  return dataUrl;",
    ),
    # ── client: DSC ─────────────────────────────────────────────────────────
    (
        "dsc: show a submit control to a viewer who is not on the cap table",
        CLIENT_SUITE,
        DSCPANEL,
        "{!notOnCapTable && (",
        "{true && (",
    ),
    (
        "dsc: swallow the read refusal (503 reads as 'you never submitted')",
        CLIENT_SUITE,
        DSCPANEL,
        "        {readRefusal && (",
        "        {false && (",
    ),
    (
        "dsc: treat a 500 persist failure as a success",
        CLIENT_SUITE,
        DSCPANEL,
        "      if (!res.ok || body?.ok === false) {",
        "      if (false) {",
    ),
    (
        "dsc: do not re-read after submitting (id lives only in React state)",
        CLIENT_SUITE,
        DSCPANEL,
        'qc.invalidateQueries({ queryKey: ["/api/investor/dsc/submissions", companyId] });',
        "/* no re-read */",
    ),
    # ── the mount fence: an unmounted component is NOT shipped ──────────────
    (
        "mount: unmount InvestorSiloPanel from the investor Dashboard",
        CLIENT_SUITE,
        DASH,
        "        <InvestorSiloPanel />",
        "        {/* <InvestorSiloPanel /> */}",
    ),
    (
        "mount: unmount InvestorKycDocumentsPanel from Accreditation",
        CLIENT_SUITE,
        ACCRED,
        "          <InvestorKycDocumentsPanel />",
        "          {/* <InvestorKycDocumentsPanel /> */}",
    ),
    (
        "mount: unmount InvestorDscSubmitPanel from CompanyDetail",
        CLIENT_SUITE,
        CODETAIL,
        "<InvestorDscSubmitPanel companyId={id} />",
        "{/* <InvestorDscSubmitPanel companyId={id} /> */}",
    ),
]


def main() -> int:
    snap = snapshot()
    print("baseline …", flush=True)
    base = {}
    for suite in (SERVER_SUITE, CLIENT_SUITE):
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
    for suite in (SERVER_SUITE, CLIENT_SUITE):
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
