#!/usr/bin/env python3
"""WAVE 21 · ITEM 5 — route every client money rendering through the
ISO-4217-exponent-aware helpers instead of a hardcoded /100.

EVERY file touched here is OUTSIDE the Wave 21 owned set and is FLAGGED in
WAVE21_REPORT.md. Edits are confined to money formatting.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
C = ROOT / "client/src"

# (relative path, [(anchor, replacement), ...], import line to ensure)
EDITS: list[tuple[str, list[tuple[str, str]], str | None]] = [
    # ---- display helpers that ignored their own `currency` parameter --------
    ("pages/admin/InvestorDetail.tsx", [(
        'function formatMinorUsd(minor: number | null, currency = "USD"): string {\n'
        '  if (minor == null) return "";\n'
        '  return String(minor / 100);\n}',
        '/* WAVE 21 ITEM 5: took a `currency` argument and then ignored it, dividing\n'
        '   by a hardcoded 100. JPY (exponent 0) read 100x low. */\n'
        'function formatMinorUsd(minor: number | null, currency = "USD"): string {\n'
        '  if (minor == null) return "";\n'
        '  return minorToMajorString(minor, currency);\n}',
    )], 'import { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/admin/Investors.tsx", [(
        '  const major = minor / 100;',
        '  /* WAVE 21 ITEM 5: hardcoded /100 ignored the `currency` argument. */\n'
        '  const major = Number(minorToMajorString(minor, currency));',
    )], 'import { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/admin/Companies.tsx", [(
        '  const amount = minor / 100;',
        '  /* WAVE 21 ITEM 5: hardcoded /100 ignored the `currency` argument. */\n'
        '  const amount = Number(minorToMajorString(minor, currency));',
    )], 'import { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/collective/MembershipPage.tsx", [(
        '  const dollars = amountMinor / 100;',
        '  /* WAVE 21 ITEM 5: hardcoded /100; the currency was already in scope. */\n'
        '  const dollars = Number(minorToMajorString(amountMinor, currency));',
    )], 'import { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/consortium/ConsortiumPricing.tsx", [(
        '  const dollars = amountMinor / 100;',
        '  /* WAVE 21 ITEM 5: hardcoded /100; the currency was already in scope. */\n'
        '  const dollars = Number(minorToMajorString(amountMinor, currency));',
    )], 'import { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/collective/CollectiveMembership.tsx", [(
        '{subscription.currency} {(subscription.annualAmountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}',
        '{/* WAVE 21 ITEM 5: was `/ 100` with a forced 2 fraction digits. */}\n'
        '                  {formatMinor(subscription.annualAmountMinor, subscription.currency || "USD")}',
    )], 'import { formatMinor } from "@/lib/currency";'),

    ("pages/founder/Billing.tsx", [(
        'function fmtMoney(minor: number, currency = "USD"): string {\n'
        '  try {\n'
        '    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);\n'
        '  } catch {\n'
        '    return `${currency} ${(minor / 100).toFixed(2)}`;\n'
        '  }\n}',
        '/* WAVE 21 ITEM 5: /100 plus a hardcoded 2 fraction digits — wrong twice\n'
        '   over for JPY. formatMinor derives both from the ISO 4217 exponent and\n'
        '   keeps the same Intl fallback. */\n'
        'function fmtMoney(minor: number, currency = "USD"): string {\n'
        '  return formatMinor(minor, currency, { locale: "en-US" });\n}',
    )], 'import { formatMinor } from "@/lib/currency";'),

    ("pages/founder/Subscribe.tsx", [(
        'function fmtMoney(minor: number, currency = "USD"): string {\n'
        '  try {\n'
        '    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);\n'
        '  } catch {\n'
        '    return `${currency} ${(minor / 100).toFixed(0)}`;\n'
        '  }\n}',
        '/* WAVE 21 ITEM 5: /100 with 0 fraction digits. The 0 was a deliberate\n'
        '   "whole prices only" choice for USD plan tiers, but combined with /100\n'
        '   it rendered JPY 100x low AND truncated. formatMinor uses the currency\n'
        '   exponent, so USD tiers keep their cents and JPY shows whole yen. */\n'
        'function fmtMoney(minor: number, currency = "USD"): string {\n'
        '  return formatMinor(minor, currency, { locale: "en-US" });\n}',
    )], 'import { formatMinor } from "@/lib/currency";'),

    ("pages/partner/PartnerContacts.tsx", [(
        'function money(minor: number): string {\n'
        '  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(minor / 100);\n}',
        '/* WAVE 21 ITEM 5: hardcoded /100 AND a hardcoded USD label. The currency\n'
        '   is now a parameter so a non-USD caller cannot be silently mislabelled. */\n'
        'function money(minor: number, currency = "USD"): string {\n'
        '  return formatMinor(minor, currency);\n}',
    )], 'import { formatMinor } from "@/lib/currency";'),

    # ---- fmtUSD(x / 100, { currency }) display call sites -------------------
    ("pages/admin/AdminFeesConsolidated.tsx", [
        ('{fmtUSD(m.basePriceMinor / 100, { currency: m.currency })}',
         '{formatMinor(m.basePriceMinor, m.currency || "USD")}'),
        ('{fmtUSD(t.amountMinor / 100, { currency: t.currency })}{" "}',
         '{formatMinor(t.amountMinor, t.currency || "USD")}{" "}'),
        ('{fmtUSD(f.amountMinor / 100, { currency: f.currency })}',
         '{formatMinor(f.amountMinor, f.currency || "USD")}'),
        ('{fmtUSD((p.amountCents ?? 0) / 100)}',
         '{formatMinor(p.amountCents ?? 0, "USD")}'),
        ('? fmtUSD(c.amount / 100, { currency: m.currency })',
         '? formatMinor(c.amount, m.currency || "USD")'),
        ('/** minor units (cents) → major-unit string for an <Input value>. */\n'
         'export function minorToMajor(minor: number | null | undefined): string {\n'
         '  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";\n'
         '  return (minor / 100).toFixed(2);\n}',
         '/** minor units → major-unit string for an <Input value>.\n'
         ' *  WAVE 21 ITEM 5: `currency` is now a parameter and the exponent comes\n'
         ' *  from ISO 4217. Defaulting to USD preserves every existing call site\n'
         ' *  byte-for-byte while making a JPY form correct once the currency is\n'
         ' *  threaded through (see the report for the call sites still to thread). */\n'
         'export function minorToMajor(minor: number | null | undefined, currency = "USD"): string {\n'
         '  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";\n'
         '  return minorToMajorString(minor, currency);\n}'),
        ('  const cents = Math.round(Number(raw) * 100);',
         '  /* WAVE 21 ITEM 5: parse partner must scale by the SAME exponent the\n'
         '     display side used, or an edit round-trip silently rescales. */\n'
         '  const cents = toMinor(Number(raw), currency);'),
    ], 'import { formatMinor, toMinor } from "@/lib/currency";\nimport { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/admin/AdminPlatformFees.tsx", [
        ('function minorToMajor(minor: number): string {\n  return (minor / 100).toFixed(2);\n}',
         '/* WAVE 21 ITEM 5: exponent-aware; USD default preserves existing callers. */\n'
         'function minorToMajor(minor: number, currency = "USD"): string {\n'
         '  return minorToMajorString(minor, currency);\n}'),
        ('  const cents = Math.round(Number(raw) * 100);',
         '  /* WAVE 21 ITEM 5: parse partner scales by the same exponent. */\n'
         '  const cents = toMinor(Number(raw), currency);'),
        ('    return c === null ? "—" : fmtUSD(c / 100, { fractionDigits: 2 });',
         '    return c === null ? "—" : formatMinor(c, "USD");'),
        ('{props.fee ? fmtUSD(props.fee.amountMinor / 100, { fractionDigits: 2 }) : "—"}',
         '{props.fee ? formatMinor(props.fee.amountMinor, (props.fee as { currency?: string }).currency || "USD") : "—"}'),
    ], 'import { formatMinor, toMinor } from "@/lib/currency";\nimport { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/admin/AdminPartnerBillingOps.tsx", [
        ('function minorToMajorInput(minor: number | null): string {\n'
         '  return minor === null ? "" : (minor / 100).toFixed(2);\n}',
         '/* WAVE 21 ITEM 5: exponent-aware; USD default preserves existing callers. */\n'
         'function minorToMajorInput(minor: number | null, currency = "USD"): string {\n'
         '  return minor === null ? "" : minorToMajorString(minor, currency);\n}'),
        ('  const cents = Math.round(Number(raw) * 100);',
         '  /* WAVE 21 ITEM 5: parse partner scales by the same exponent. */\n'
         '  const cents = toMinor(Number(raw), currency);'),
    ], 'import { toMinor } from "@/lib/currency";\nimport { minorToMajorString } from "@/lib/moneyDisplay";'),

    ("pages/founder/Settings.tsx", [
        ('{fmtUSD(subscription.amountMinor / 100, { currency: subscription.currency || "USD" })}/mo',
         '{formatMinor(subscription.amountMinor, subscription.currency || "USD")}/mo'),
        ('{fmtUSD((inv.totalMinor ?? inv.amountMinor ?? 0) / 100, { currency: inv.currency || "USD" })}',
         '{formatMinor(inv.totalMinor ?? inv.amountMinor ?? 0, inv.currency || "USD")}'),
    ], 'import { formatMinor } from "@/lib/currency";'),
]

# The three input helpers gained a `currency` parameter; their parse partners
# need the same, so widen those signatures too.
# The `^\d+(\.\d{1,2})?$` input guards hardcode two decimals as well: they
# accept "100.50" for JPY (which has none) and reject a legitimate 3-decimal
# KWD amount. Widened to the currency's own exponent.
REGEXES = [
    ("pages/admin/AdminFeesConsolidated.tsx", 'if (!/^\\d+(\\.\\d{1,2})?$/.test(raw)) return null;'),
    ("pages/admin/AdminPlatformFees.tsx", 'if (!/^\\d+(\\.\\d{1,2})?$/.test(raw)) return null;'),
]
REGEX_REPL = (
    '/* WAVE 21 ITEM 5: was a hardcoded 2-decimal guard. */\n'
    '  const _exp = currencyExponent(currency);\n'
    '  if (!new RegExp(_exp > 0 ? `^\\\\d+(\\\\.\\\\d{1,${_exp}})?$` : "^\\\\d+$").test(raw)) return null;'
)

SIGS = [
    ("pages/admin/AdminFeesConsolidated.tsx",
     "export function majorToMinor(s: string): number | null {",
     'export function majorToMinor(s: string, currency = "USD"): number | null {'),
    ("pages/admin/AdminPlatformFees.tsx",
     "function majorToMinor(s: string): number | null {",
     'function majorToMinor(s: string, currency = "USD"): number | null {'),
    ("pages/admin/AdminPartnerBillingOps.tsx",
     "function majorToMinorStrict(s: string): number | null | undefined {",
     'function majorToMinorStrict(s: string, currency = "USD"): number | null | undefined {'),
]


def ensure_import(text: str, imp: str) -> str:
    for line in imp.split("\n"):
        if line in text:
            continue
        # insert after the final top-of-file import
        idx = 0
        for i, l in enumerate(text.split("\n")[:80]):
            if l.startswith("import "):
                idx = i
        parts = text.split("\n")
        parts.insert(idx + 1, line)
        text = "\n".join(parts)
    return text


def main() -> int:
    problems = 0
    for rel, edits, imp in EDITS:
        p = C / rel
        s = p.read_text()
        for anchor, repl in edits:
            n = s.count(anchor)
            if n != 1:
                print(f"ANCHOR-ERROR {rel}: occurrences={n} for {anchor[:60]!r}")
                problems += 1
                continue
            s = s.replace(anchor, repl)
        if imp:
            s = ensure_import(s, imp)
        p.write_text(s)
        print(f"patched {rel}")
    for rel, anchor in REGEXES:
        p = C / rel
        s2 = p.read_text()
        if s2.count(anchor) != 1:
            print(f"ANCHOR-ERROR(regex) {rel}: {s2.count(anchor)}")
            problems += 1
            continue
        s2 = s2.replace(anchor, REGEX_REPL)
        s2 = ensure_import(s2, 'import { currencyExponent } from "@/lib/currency";')
        p.write_text(s2)
        print(f"regex   {rel}")
    for rel, old, new in SIGS:
        if new is None:
            continue
        p = C / rel
        s = p.read_text()
        if s.count(old) != 1:
            print(f"ANCHOR-ERROR(sig) {rel}: {s.count(old)}")
            problems += 1
            continue
        p.write_text(s.replace(old, new))
        print(f"sig     {rel}")
    return problems


if __name__ == "__main__":
    sys.exit(main())
