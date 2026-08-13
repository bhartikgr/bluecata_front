#!/usr/bin/env python3
"""WAVE 21 · ITEM 5 mutation matrix.

Every mutation reintroduces a hardcoded /100 (or an equivalent
exponent-blindness) at a surface Review A named. A mutation that only a JPY or
KWD fixture can catch is the whole point of the item.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CUR = "client/src/lib/currency.ts"
MD = "client/src/lib/moneyDisplay.ts"
P = "client/src/pages/"

MUTATIONS = [
    # ---- the library that everything now depends on
    Mutation(
        "M1-exponent-table-flattened", CUR,
        "  return e === undefined ? 2 : e;",
        "  return 2;",
        "every currency treated as exponent 2 — the original bug, centralised",
    ),
    Mutation(
        "M2-jpy-entry-removed", CUR,
        "ISK: 0, JPY: 0, KMF: 0",
        "ISK: 0, JPZ: 0, KMF: 0",
        "JPY silently falls back to exponent 2",
    ),
    Mutation(
        "M3-formatMinor-hardcodes-100", CUR,
        "  const major = (Number(minor) || 0) / Math.pow(10, exp);",
        "  const major = (Number(minor) || 0) / 100;",
        "formatMinor itself regresses to /100",
    ),
    Mutation(
        "M4-fraction-digits-hardcoded", CUR,
        "      minimumFractionDigits: exp,\n      maximumFractionDigits: exp,",
        "      minimumFractionDigits: 2,\n      maximumFractionDigits: 2,",
        "¥12,345 renders as ¥12,345.00 — right magnitude, wrong currency convention",
    ),
    Mutation(
        "M5-toMinor-hardcodes-100", CUR,
        "export function toMinor(amount: number, currency: string): number {",
        "export function toMinor(amount: number, currency: string): number {\n  if (Number.isFinite(amount)) return Math.round(amount * 100);",
        "the parse side regresses, so display/parse disagree and edits rescale",
    ),
    Mutation(
        "M6-minorToMajorString-hardcodes-100", MD,
        "  const exp = currencyExponent(currency ?? \"USD\");\n  return (Number(minor) / Math.pow(10, exp)).toFixed(exp);",
        "  return (Number(minor) / 100).toFixed(2);",
        "the /100 replacement itself becomes a /100",
    ),
    Mutation(
        "M7-unavailable-becomes-zero", MD,
        "  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return placeholder;",
        "  if (minor === null || minor === undefined || !Number.isFinite(Number(minor))) return formatMinor(0, String(currency ?? \"USD\"));",
        "an unavailable amount renders as a confident $0.00",
    ),
    # ---- per-surface regressions
    Mutation(
        "M8-investor-detail-regresses", P + "admin/InvestorDetail.tsx",
        "  return minorToMajorString(minor, currency);",
        "  return String(minor / 100);",
        "InvestorDetail goes back to discarding its currency argument",
    ),
    Mutation(
        "M9-investors-list-regresses", P + "admin/Investors.tsx",
        "  const major = Number(minorToMajorString(minor, currency));",
        "  const major = minor / 100;",
        "the investor list regresses",
    ),
    Mutation(
        "M10-companies-regresses", P + "admin/Companies.tsx",
        "  const amount = Number(minorToMajorString(minor, currency));",
        "  const amount = minor / 100;",
        "the admin company list regresses",
    ),
    Mutation(
        "M11-membership-regresses", P + "collective/MembershipPage.tsx",
        "  const dollars = Number(minorToMajorString(amountMinor, currency));",
        "  const dollars = amountMinor / 100;",
        "collective membership pricing regresses",
    ),
    Mutation(
        "M12-consortium-pricing-regresses", P + "consortium/ConsortiumPricing.tsx",
        "  const dollars = Number(minorToMajorString(amountMinor, currency));",
        "  const dollars = amountMinor / 100;",
        "consortium pricing regresses",
    ),
    # M13 removed: founder/Billing.tsx is SACRED. The fix was reverted to the
    # byte-identical original, so there is nothing there to mutate. The harness
    # asserts the defect is STILL PRESENT and untouched instead, and the patch
    # is reported for an owner waiver.
    Mutation(
        "M14-subscribe-regresses", P + "founder/Subscribe.tsx",
        "  return formatMinor(minor, currency, { locale: \"en-US\" });",
        "  return new Intl.NumberFormat(\"en-US\", { style: \"currency\", currency, maximumFractionDigits: 0 }).format(minor / 100);",
        "the subscribe/checkout price regresses — the one a customer pays from",
    ),
    Mutation(
        "M15-partner-contacts-hardcodes-usd", P + "partner/PartnerContacts.tsx",
        "function money(minor: number, currency = \"USD\"): string {\n  return formatMinor(minor, currency);",
        "function money(minor: number, currency = \"USD\"): string {\n  return new Intl.NumberFormat(undefined, { style: \"currency\", currency: \"USD\" }).format(minor / 100);",
        "a non-USD amount is relabelled USD and rescaled",
    ),
    Mutation(
        "M16-fees-consolidated-input-regresses", P + "admin/AdminFeesConsolidated.tsx",
        "  return minorToMajorString(minor, currency);",
        "  return (minor / 100).toFixed(2);",
        "the fee editor input regresses",
    ),
    Mutation(
        "M17-fees-parse-regresses", P + "admin/AdminFeesConsolidated.tsx",
        "  const cents = toMinor(Number(raw), currency);",
        "  const cents = Math.round(Number(raw) * 100);",
        "the parse partner regresses, so saving a JPY fee multiplies it by 100",
    ),
    Mutation(
        "M18-platform-fees-parse-regresses", P + "admin/AdminPlatformFees.tsx",
        "  const cents = toMinor(Number(raw), currency);",
        "  const cents = Math.round(Number(raw) * 100);",
        "the platform-fee parse partner regresses",
    ),
    Mutation(
        "M19-billing-ops-input-regresses", P + "admin/AdminPartnerBillingOps.tsx",
        "  return minor === null ? \"\" : minorToMajorString(minor, currency);",
        "  return minor === null ? \"\" : (minor / 100).toFixed(2);",
        "the billing-ops price editor regresses",
    ),
    Mutation(
        "M20-settings-invoice-regresses", P + "founder/Settings.tsx",
        "{formatMinor(inv.totalMinor ?? inv.amountMinor ?? 0, inv.currency || \"USD\")}",
        "{fmtUSD((inv.totalMinor ?? inv.amountMinor ?? 0) / 100, { currency: inv.currency || \"USD\" })}",
        "the founder invoice line regresses",
    ),
    Mutation(
        "M21-refund-confirm-regresses", P + "admin/AdminFeesConsolidated.tsx",
        "const amt = formatMinor(inv.amountMinor ?? 0, inv.currency ?? \"USD\");",
        "const amt = fmtUSD((inv.amountMinor ?? 0) / 100, { currency: inv.currency ?? \"USD\" });",
        "the REFUND confirmation dialog understates a JPY refund 100x before real money moves",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave21/item5_money_render_harness.ts"],
            MUTATIONS,
            "ITEM5",
        )
    )
