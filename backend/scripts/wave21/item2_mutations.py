#!/usr/bin/env python3
"""WAVE 21 · ITEM 2 mutation matrix — cross-currency summation must stay dead."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SC = "server/lib/currencyScalar.ts"
CONSORT = "server/partnerConsortiumRoutes.ts"
STORE = "server/lib/partnerBillingStore.ts"
REPORT = "server/lib/reportingEngineRoutes.ts"
UI = "client/src/pages/partner/PartnerBilling.tsx"
W14 = "server/lib/wave14MoneyRoutes.ts"

MUTATIONS = [
    # ---- the shared contract itself
    Mutation(
        "M1-collapse-mixed-to-sum", SC,
        """  return {
    available: false,
    currency: null,
    minor: null,
    reason: "needs_fx_conversion",
    currencies,
  };""",
        """  return {
    available: true,
    currency: "USD",
    minor: Object.values(buckets).reduce((a, b) => a + b, 0),
  };""",
        "the original defect: sum everything, call it USD",
    ),
    Mutation(
        "M2-addToBucket-merges", SC,
        '  const cur = normalizeCurrency(currency) || "USD";\n  buckets[cur] = (buckets[cur] ?? 0) + (Number(minor) || 0);',
        '  buckets["USD"] = (buckets["USD"] ?? 0) + (Number(minor) || 0);',
        "bucket key ignores the currency, so everything merges into USD",
    ),
    Mutation(
        "M3-scaleScalar-fabricates", SC,
        "  if (!s.available) return s;\n  return { available: true, currency: s.currency, minor: Math.floor(s.minor * factor) };",
        '  if (!s.available) return { available: true, currency: "USD", minor: 0 };\n  return { available: true, currency: s.currency, minor: Math.floor(s.minor * factor) };',
        "derived commission invents a USD zero instead of staying unavailable",
    ),
    Mutation(
        "M4-persist-guard-noop", SC,
        "  if (!s.available) {\n    throw new Error(",
        "  if (false) {\n    throw new Error(",
        "durable-write guard stops blocking mixed snapshots",
    ),
    # ---- sink 1
    Mutation(
        "M5-consortium-resums", CONSORT,
        "        const totalCommittedMinor = totalCommitted.available ? totalCommitted.minor : null;",
        "        const totalCommittedMinor = Object.values(committedBuckets).reduce((a, b) => a + b, 0);\n        totalCommittedMinor += r.amount_minor;",
        "consortium reinstates the mixed headline total",
    ),
    Mutation(
        "M6-consortium-drops-reason", CONSORT,
        "          totalsUnavailableReason: totalCommitted.available ? null : totalCommitted.reason,",
        "",
        "payload no longer tells the client the total is unavailable",
    ),
    # ---- sink 2
    Mutation(
        "M7-store-restores-usd-default", STORE,
        "    currency: oneCurrency ? soleCurrency : null,",
        '    currency: soleCurrency,',
        'store stamps "USD" on a mixed position again',
    ),
    Mutation(
        "M8-store-resums", STORE,
        "      addToBucket(bucket.paid, cur, amt);\n      addToBucket(paidBuckets, cur, amt);",
        "      addToBucket(bucket.paid, cur, amt);\n      paidMinor += amt;",
        "store reinstates the flat cross-currency paid total",
    ),
    # ---- sink 3
    Mutation(
        "M9-report-persists-first-row", REPORT,
        "        currency: snapshotCurrency,",
        '        currency: rows[0]?.currency ?? "USD",',
        "snapshot persists the first row's currency over a mixed total",
    ),
    Mutation(
        "M10-report-drops-409", REPORT,
        '          error: "CROSS_CURRENCY_SNAPSHOT_BLOCKED",',
        '          error: "OTHER",',
        "the durable-write refusal disappears",
    ),
    Mutation(
        "M11-report-metrics-over-mixed", REPORT,
        "            reason: \"needs_fx_conversion\",\n            currencies: metricCurrencies,",
        "            reason: \"none\" as never,\n            currencies: metricCurrencies,",
        "metrics unavailability loses its machine-readable reason",
    ),
    # ---- sink 4 (UI)
    Mutation(
        "M12-ui-warns-then-renders", UI,
        "            {summary.data.mixed ? (",
        "            {summary.data.mixed && (",
        "UI goes back to warning and rendering the invalid cards anyway",
    ),
    Mutation(
        "M13-ui-csv-div-100", UI,
        "      minorToMajorString(l.amountMinor, l.currency), l.currency, l.status,",
        "      (l.amountMinor / 100).toFixed(2), l.currency, l.status,",
        "CSV export re-hardcodes /100 and misstates JPY 100x",
    ),
    # ---- derived total
    Mutation(
        "M14-w14-resums-total", W14,
        "        totalMinor: total.available ? total.minor : null,",
        "        totalMinor: position.pendingMinor + position.paidMinor,",
        "commission-summary total re-derives from mixed operands",
    ),
    # ---- exponent regressions (JPY / 3-exponent coverage)
    # M15 (original attempt) added an UNUSED key `JPY2: 0` to the exponent
    # table. It was MISSED, and correctly so: it changes no behaviour, so it is
    # not a defect. That was a bad mutation, not a coverage gap. Replaced below
    # by two mutations that really do misstate money.
    Mutation(
        "M15-jpy-exponent-wrong", "server/lib/currency.ts",
        "PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0,\n  XPF: 0,",
        "PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0,\n  XPF: 0, JPY: 2,",
        "JPY re-declared as a 2-exponent currency: 12345 renders as 123.45",
    ),
    Mutation(
        "M16-kwd-exponent-wrong", "server/lib/currency.ts",
        "  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,",
        "  BHD: 3, IQD: 3, JOD: 3, KWD: 2, LYD: 3, OMR: 3, TND: 3,",
        "three-exponent currency flattened to 2: 12345 KWD renders as 123.45",
    ),
    Mutation(
        "M17-formatMinor-hardcodes-100", "server/lib/currency.ts",
        "  const exp = currencyExponent(currency);\n  const major = (Number(minor) || 0) / Math.pow(10, exp);",
        "  const exp = currencyExponent(currency);\n  const major = (Number(minor) || 0) / 100;",
        "the shared formatter itself reverts to a hardcoded /100",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave21/item2_currency_harness.ts"],
            MUTATIONS,
            "ITEM2",
        )
    )
