/**
 * Wave C-1 — Financial field copy for all 15 financial fields.
 * Each entry contains a plain-English description and worked example.
 * Both founders and accountants read this copy.
 */

export interface FinancialFieldCopy {
  key: string;
  label: string;
  description: string;
  example: string;
  unit: "usd_minor" | "count" | "pct" | "months";
  minorUnits?: boolean; // true → stored as integer cents/minor units
}

/**
 * All 15 financial fields with copy.
 * Stage gating:
 *   base (5):       always shown
 *   seed_plus (5):  seed / series_a and above
 *   series_a (5):   series_a / series_b and above
 */
export const FINANCIAL_FIELD_COPY: FinancialFieldCopy[] = [
  // ── BASE (always shown) ─────────────────────────────────────────────
  {
    key: "cashOnHandUsd",
    label: "Cash on Hand",
    description:
      "Total cash and cash equivalents currently held in your company's bank accounts. " +
      "This is your most liquid asset — money you can spend immediately without selling anything.",
    example:
      "If your main operating account has $400,000 and your savings account has $200,000, " +
      "your cash on hand is $600,000.",
    unit: "usd_minor",
    minorUnits: true,
  },
  {
    key: "monthlyBurnUsd",
    label: "Monthly Burn Rate",
    description:
      "Net cash spent per month. Calculate as: cash paid out this month minus cash collected this month. " +
      "A positive burn means you're spending more than you earn — normal for early-stage startups.",
    example:
      "$80,000 spent on payroll, rent, and software; $20,000 collected from customers → $60,000 monthly burn.",
    unit: "usd_minor",
    minorUnits: true,
  },
  {
    key: "runwayMonths",
    label: "Runway (Months)",
    description:
      "How many months until your cash runs out at your current burn rate. " +
      "Formula: cash on hand ÷ monthly burn. Investors watch this closely — 12+ months is healthy, " +
      "under 6 months triggers urgency.",
    example:
      "$600,000 cash on hand ÷ $60,000 monthly burn = 10 months of runway.",
    unit: "months",
  },
  {
    key: "lastRaiseSizeUsd",
    label: "Last Raise Size",
    description:
      "Total amount raised in your most recent funding round, including all closings. " +
      "Report in USD. If raised in another currency, convert at the exchange rate on close date.",
    example:
      "You closed a $2,000,000 seed round with three investors — your last raise size is $2,000,000.",
    unit: "usd_minor",
    minorUnits: true,
  },
  {
    key: "lastRaiseAt",
    label: "Last Raise Date",
    description:
      "The date your most recent funding round officially closed — when the money was wired " +
      "and legal docs were countersigned.",
    example:
      "Your seed round closed on 15 March 2024 → enter 2024-03-15.",
    unit: "count",
  },

  // ── SEED+ (Seed / Series A and above) ──────────────────────────────
  {
    key: "arrUsd",
    label: "Annual Recurring Revenue (ARR)",
    description:
      "Total predictable, recurring subscription revenue on an annualised basis. " +
      "Excludes one-time setup fees, professional services, and non-recurring revenue. " +
      "Formula: monthly recurring revenue × 12.",
    example:
      "$4,000 per month in subscription fees × 12 = $48,000 ARR. " +
      "A one-off $5,000 implementation fee is excluded.",
    unit: "usd_minor",
    minorUnits: true,
  },
  {
    key: "mrrUsd",
    label: "Monthly Recurring Revenue (MRR)",
    description:
      "Total predictable, recurring revenue you collect each month from active subscriptions. " +
      "Does not include trials, discounts not yet billed, or one-off fees.",
    example:
      "50 customers each paying $80/month = $4,000 MRR.",
    unit: "usd_minor",
    minorUnits: true,
  },
  {
    key: "grossMarginPct",
    label: "Gross Margin (%)",
    description:
      "Percentage of revenue left after paying direct costs (COGS — Cost of Goods Sold). " +
      "Formula: (Revenue − COGS) ÷ Revenue × 100. " +
      "Software businesses typically run 60–80% gross margins; hardware is lower.",
    example:
      "$100,000 revenue − $30,000 COGS = $70,000 gross profit → 70% gross margin.",
    unit: "pct",
  },
  {
    key: "customerCount",
    label: "Active Customer Count",
    description:
      "Number of paying customers or accounts with at least one active subscription or paid contract. " +
      "Count unique billing accounts, not individual users within an account.",
    example:
      "You have 3 enterprise accounts and 47 self-serve subscribers → 50 customers.",
    unit: "count",
  },
  {
    key: "growthRatePct",
    label: "Month-over-Month Growth Rate (%)",
    description:
      "How much your MRR grew from last month to this month, expressed as a percentage. " +
      "Formula: (this month MRR − last month MRR) ÷ last month MRR × 100. " +
      "A 10–15% MoM growth is strong for an early-stage SaaS.",
    example:
      "MRR grew from $4,000 to $4,600 → ($600 ÷ $4,000) × 100 = 15% MoM growth.",
    unit: "pct",
  },

  // ── SERIES A+ ───────────────────────────────────────────────────────
  {
    key: "netMarginPct",
    label: "Net Profit Margin (%)",
    description:
      "Percentage of revenue remaining after ALL expenses (operating costs, taxes, interest, D&A). " +
      "Formula: Net income ÷ Revenue × 100. Negative is normal at early stages — " +
      "Collective uses this to gauge path to profitability.",
    example:
      "$1,000,000 revenue − $1,100,000 total costs = −$100,000 net income → −10% net margin.",
    unit: "pct",
  },
  {
    key: "ebitdaUsd",
    label: "EBITDA",
    description:
      "Earnings Before Interest, Taxes, Depreciation, and Amortisation. A proxy for operating cash " +
      "profitability that strips out financing decisions and accounting choices. " +
      "Commonly used in M&A and Series B+ valuations.",
    example:
      "Operating profit = $200,000 + Depreciation $50,000 + Amortisation $30,000 = $280,000 EBITDA.",
    unit: "usd_minor",
    minorUnits: true,
  },
  {
    key: "freeCashFlowUsd",
    label: "Free Cash Flow",
    description:
      "Cash generated from operations minus capital expenditures (CapEx). " +
      "Represents cash your business actually produces that can be reinvested or distributed. " +
      "Formula: Operating cash flow − CapEx.",
    example:
      "Operating cash flow $500,000 − CapEx $80,000 = $420,000 free cash flow.",
    unit: "usd_minor",
    minorUnits: true,
  },
  {
    key: "ltvCacRatio",
    label: "LTV : CAC Ratio",
    description:
      "Lifetime Value of a customer divided by Cost to Acquire that customer. " +
      "Measures how efficiently you turn sales & marketing spend into lasting revenue. " +
      "Healthy SaaS benchmark: 3.0 or above. Below 1.0 means you lose money on every customer.",
    example:
      "Average customer pays $750/month for 12 months = $9,000 LTV. " +
      "Average cost to acquire = $3,000 CAC. → LTV:CAC = 3.0.",
    unit: "pct", // stored as 2-decimal float × 100 (e.g. 3.0 → 300)
  },
  {
    key: "paybackPeriodMonths",
    label: "CAC Payback Period (Months)",
    description:
      "How many months of gross margin it takes to recover the cost to acquire a customer. " +
      "Formula: CAC ÷ (MRR per customer × Gross Margin %). " +
      "Investors want to see under 12 months for SaaS.",
    example:
      "$3,000 CAC ÷ ($750/month × 70% gross margin) = $3,000 ÷ $525 ≈ 5.7 months payback.",
    unit: "months",
  },
];

/** Look up copy for a specific field key. */
export function getFieldCopy(key: string): FinancialFieldCopy | undefined {
  return FINANCIAL_FIELD_COPY.find((f) => f.key === key);
}

/** Return only fields appropriate for a given stage. */
export function getFieldsForStage(
  stage: string | undefined | null,
): FinancialFieldCopy[] {
  const s = (stage ?? "").toLowerCase().replace(/[\s-]/g, "_");
  // Series B+ → all 15
  if (
    s.includes("series_b") ||
    s.includes("series_c") ||
    s.includes("series_d") ||
    s.includes("growth") ||
    s.includes("late")
  ) {
    return FINANCIAL_FIELD_COPY;
  }
  // Series A → 10
  if (s.includes("series_a")) {
    return FINANCIAL_FIELD_COPY.slice(0, 10);
  }
  // Seed (but NOT pre-seed) → 10
  if (s.includes("seed") && !s.includes("pre_seed") && !s.startsWith("pre")) {
    return FINANCIAL_FIELD_COPY.slice(0, 10);
  }
  // Pre-seed / unknown → base 5
  return FINANCIAL_FIELD_COPY.slice(0, 5);
}

export const FINANCIAL_FIELD_KEYS = FINANCIAL_FIELD_COPY.map((f) => f.key);
