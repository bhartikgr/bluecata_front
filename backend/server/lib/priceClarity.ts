// server/lib/priceClarity.ts
//
// WAVE 202 · ITEM B · R178.2 — MAKE THE PRICING ADMIN READABLE.
//
// THE OWNER'S WORDS, THIRD TIME OF ASKING
//   "Once again, I think the confusion is coming from the admin area (pricing
//    section). This section may require a UI/design enhancement so that I know
//    exactly what I'm setting a price for."
//   and, of the existing screen: "I have no idea how to actually read this or what
//    the figures are."
//
// WHAT THIS FILE IS, IN ONE SENTENCE
//   For every price the platform actually holds, it answers the five questions the
//   owner has to be able to answer at a glance: what product is this, who pays it,
//   how often, is it live, and WHERE ON THE FRONTEND DOES IT APPEAR.
//
// WHY THE EXISTING SCREEN IS UNREADABLE, WHICH IS WHAT THIS FIXES
//   The Pricing Models tab reads the pricing-model store. In this tree that store
//   holds exactly ONE row — a draft carrier for migrated coupon codes — while every
//   price the platform charges lives in `platform_fees` and `partner_tier_price` on
//   DIFFERENT tabs. So the owner opens the screen he was told is the pricing screen,
//   sees one meaningless draft slug, and concludes he cannot read it. He is right.
//   Nothing anywhere on any pricing tab states a price's AUDIENCE or the SCREEN a
//   customer sees it on.
//
// WHAT IT IS NOT
//   - NOT a new authority for any amount. Every amount is read live from
//     `platformFeesStore.listFees()`, which stays the single source. This module
//     adds no amount, changes no amount, and stores nothing.
//   - NOT a hardcoded price list. The SET of prices is whatever the database yields
//     on this request. Change a fee, retire one, add one, and this follows with no
//     code change (R3, R21).
//   - NOT a holder of any price, currency or cadence literal (R156.2). The labels
//     below map an IDENTIFIER to English. There is not one amount in this file.
//   - NOT arithmetic. No `* 12`, no `/ 12`, no conversion (R156.1).
//
// ABSENCE IS STATED, NEVER FILLED IN
//   A fee with no amount on record reports `amountMinor: null` and the screen says
//   so in words. It is never rendered as 0 (R143.4) and never compared as if it were
//   a number (R176.1). A recorded period of NULL is reported as "one-off / no
//   recurring period", which is what it means — not silently relabelled "monthly",
//   which is the bug wave 199 found in `periodLabel`'s default branch.
//
// RULING: R178.2, R178.1, R156.2, R143.4, R176.1, R3, R21.

import { wave45Db } from "./applyWave45PricingSchema";
import { listFees, type PlatformFee } from "../platformFeesStore";
import {
  platformFeeScopeKey,
  resolvePricePeriodOffer,
  type PricePeriodOffer,
} from "./pricePeriodOffer";

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  PLAIN LANGUAGE
 *
 *  The owner is not an engineer. `collective.member_subscription.standard` is a
 *  database key, not a product name, and "a table of slugs, precedence integers and
 *  tier bands is not readable". These tables translate an identifier into the words
 *  he uses himself. They contain NO amounts, NO currencies and NO cadences.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Who pays this price. The four audiences the owner names. */
export type PriceAudience =
  | "Founder"
  | "Investor"
  | "Consortium Partner"
  | "Collective member"
  | "Not recorded";

export interface PriceClarityRow {
  /** The database key. Shown, but never the only thing shown. */
  scopeKey: string;
  rawKey: string;
  /** Plain-language product name. */
  product: string;
  /** One sentence saying what the payer gets. */
  whatItIs: string;
  audience: PriceAudience;
  /** `null` when no amount is on record. NEVER 0-by-default. */
  amountMinor: number | null;
  currency: string | null;
  /** True when the recorded amount is a deliberate free price, not an absence. */
  intentionalZero: boolean;
  /** The period exactly as recorded, or `null`. Never substituted. */
  recordedPeriod: string | null;
  /** Plain-language period: "every year", "every month", "one-off payment", … */
  periodPlain: string;
  /** Live / Retired, in words. Colour is never the only signal. */
  stateLabel: "Live" | "Retired";
  isLive: boolean;
  /** Why this state, in one sentence. */
  stateExplanation: string;
  /** The frontend screens a customer or partner sees this price on. */
  appearsOn: string[];
  /** The admin screen where this price is edited. */
  editedOn: string;
  /** The owner's per-price billing-period choice, resolved. */
  periodOffer: PricePeriodOffer;
  /**
   * Set when this price has a recurring period recorded but no annual figure
   * anywhere — the Collective-membership case R178.1 asks for a control for.
   * The sentence names the gap; it never invents the number.
   */
  annualGap: string | null;
}

interface PeriodRow {
  key: string;
  billing_period: string | null;
  intentional_zero: number | null;
}

/**
 * The ONLY thing read here that `listFees()` does not already expose: the recorded
 * billing period and the deliberate-free-price flag. Amounts still come from
 * `listFees()`, so this module cannot become a second authority for a figure.
 */
function readPeriods(): Map<string, PeriodRow> {
  const out = new Map<string, PeriodRow>();
  try {
    const rows = wave45Db()
      .prepare(
        `SELECT key, billing_period, intentional_zero
           FROM platform_fees
          WHERE (deleted_at IS NULL OR deleted_at = '')`,
      )
      .all() as PeriodRow[];
    for (const r of rows) out.set(r.key, r);
  } catch {
    /* An unreadable period column is reported as "not recorded" per row, which the
       screen states in words. It is never guessed. */
  }
  return out;
}

/** Plain English for a recorded period. Absence is named, never relabelled. */
function periodPlainLabel(recorded: string | null): string {
  if (recorded === null) return "One-off payment — no recurring period recorded";
  switch (recorded) {
    case "annual":
    case "yearly":
      return "Charged every year";
    case "monthly":
      return "Charged every month";
    case "quarterly":
      return "Charged every quarter";
    case "one_time":
      return "One-off payment";
    default:
      /* An unrecognised period is REPORTED, not translated. Wave 199 found
         `periodLabel`'s default branch inventing "month" for exactly this case. */
      return `Recorded period: ${recorded} (this platform has no plain-language name for it)`;
  }
}

interface Descriptor {
  product: string;
  whatItIs: string;
  audience: PriceAudience;
  appearsOn: string[];
  editedOn: string;
  /**
   * True when MORE THAN ONE price shares this product name — the membership family
   * and the partner-subscription family both do. Rows in such a family get their
   * tier name appended, in words, so the owner is never shown five identical
   * headings. Rows outside a family are named once and need no suffix.
   */
  sharedProductName?: boolean;
}

/**
 * Identifier → English. Matched longest-prefix-first so a specific key wins over a
 * family. Every entry's `appearsOn` was established by tracing the endpoint that
 * serves the key to the client file that renders it, not by assumption; a key with
 * no traced surface says so rather than claiming one.
 */
const DESCRIPTORS: Array<{ match: (key: string) => boolean; d: Descriptor }> = [
  {
    match: (k) => k === "collective_application_fee",
    d: {
      product: "Collective — application fee",
      whatItIs:
        "A one-off fee a founder pays when they apply to join the Collective. It is not a subscription.",
      audience: "Founder",
      appearsOn: [
        "Founder → Apply to Collective (the application screen)",
        "Founder → Billing",
      ],
      editedOn: "Admin → Fees → Application fee",
    },
  },
  {
    match: (k) => k.startsWith("collective.member_subscription."),
    d: {
      product: "Collective — membership",
      whatItIs:
        "The recurring membership fee for a Collective member. One of these tiers is the canonical one the membership screen quotes.",
      audience: "Collective member",
      appearsOn: ["Collective → Membership (the Amount field and the plan summary)"],
      editedOn: "Admin → Fees → Platform fees",
      sharedProductName: true,
    },
  },
  {
    match: (k) => k === "consortium.spv_deployment_fee",
    d: {
      product: "Consortium Partner — SPV deployment fee",
      whatItIs:
        "A one-off fee charged when an SPV is deployed. Charged per SPV, not per month.",
      audience: "Consortium Partner",
      appearsOn: [
        "Partner → SPV Engine (the deployment cost line)",
        "Partner → Billing",
      ],
      editedOn: "Admin → Fees → Platform fees",
    },
  },
  {
    match: (k) => k.startsWith("consortium.subscription."),
    d: {
      product: "Consortium Partner — subscription",
      whatItIs:
        "The recurring subscription for a Consortium Partner tier. The tier decides what the partner can do; this row is what they pay.",
      audience: "Consortium Partner",
      appearsOn: ["Consortium → Pricing (the public partner pricing page)"],
      editedOn: "Admin → Fees → Partner tiers",
      sharedProductName: true,
    },
  },
  {
    match: (k) => k === "founder.capavate_annual",
    d: {
      product: "Capavate Annual (founder plan)",
      whatItIs:
        "The founder's annual Capavate subscription. This is the figure advertised on the public homepage.",
      audience: "Founder",
      appearsOn: [
        "Public homepage — pricing section",
        "Founder → Subscribe",
        "Founder → Settings (plan amount)",
        "Founder → Billing",
      ],
      editedOn: "Admin → Fees → Platform fees",
    },
  },
  {
    match: (k) => k === "founder.academy_one_time",
    d: {
      product: "Capavate Academy",
      whatItIs: "A one-off purchase of the Academy programme. Not a subscription.",
      audience: "Founder",
      appearsOn: ["Founder → Academy"],
      editedOn: "Admin → Fees → Platform fees",
    },
  },
];

function describe(key: string): Descriptor {
  for (const entry of DESCRIPTORS) {
    if (entry.match(key)) return entry.d;
  }
  /* AN UNKNOWN KEY IS NAMED AS UNKNOWN. Guessing a product name from a slug is how
     the owner ends up reading a sentence the platform invented. */
  return {
    product: key,
    whatItIs:
      "This platform has no plain-language description on record for this price yet. It is shown so that nothing is hidden from you.",
    audience: "Not recorded",
    appearsOn: [],
    editedOn: "Admin → Fees → Platform fees",
  };
}

/**
 * The last segment of the database key, turned into words.
 *
 * WHY. Several prices in this platform share one product name — there are five
 * Consortium Partner subscription rows and four Collective membership rows — and a
 * screen that printed the same product name five times would be exactly the screen
 * the owner says he cannot read. The tier name is the only thing that distinguishes
 * them, so it is spelled out in words: `founding_member` becomes "founding member",
 * not a slug. No key is shown here as a key; the raw key is shown once, separately
 * and labelled as the database name.
 */
function suffixOf(key: string): string {
  const idx = key.lastIndexOf(".");
  const tail = idx < 0 ? key : key.slice(idx + 1);
  return tail.split("_").join(" ");
}

function toRow(fee: PlatformFee, periods: Map<string, PeriodRow>): PriceClarityRow {
  const d = describe(fee.key);
  const p = periods.get(fee.key);
  const recordedPeriod = p ? (p.billing_period ?? null) : null;
  const intentionalZero = p ? p.intentional_zero === 1 : false;

  /* EXPLICIT ABSENCE TEST (R176.1). `amountMinor === null` is the only question
     asked; the value is never compared with 0 to decide whether it exists. */
  const amountOnRecord = fee.amountMinor !== null;

  const isLive = fee.source === "db" && amountOnRecord;
  const stateExplanation = !amountOnRecord
    ? "No amount is on record for this price, so nothing is being charged and no screen can show a figure for it. Set an amount to make it live."
    : intentionalZero
      ? "Live, and deliberately free: an administrator recorded this price as zero on purpose."
      : "Live: this amount is on record and the screens listed below will show it.";

  /* THE ANNUAL GAP (R178.1). A price recorded as monthly, with no annual figure
     anywhere in any store, is exactly the Collective-membership case. We state the
     gap and offer the control. We do NOT multiply the monthly figure by twelve —
     forbid_x12_derivation = 1 — and we do NOT show zero (R143.4). */
  const offer = resolvePricePeriodOffer(platformFeeScopeKey(fee.key));
  const annualGap =
    recordedPeriod === "monthly" && offer.annualAmountMinor === null
      ? "This price is on record as a monthly amount only. No annual price exists for it anywhere. You can set one below. Until you do, Capavate will show no annual figure for it, and will never work one out from the monthly amount."
      : null;

  /* TIER DISAMBIGUATION. Applied to EVERY family whose product name is shared by
     more than one price, not only the Collective membership: five partner
     subscription rows all describe "Consortium Partner — subscription", and five
     identical headings is unreadable. `sharedProductName` is true when the key has a
     tier segment under a family prefix. */
  const product = d.sharedProductName === true
    ? `${d.product} — ${suffixOf(fee.key)} tier`
    : d.product;

  return {
    scopeKey: platformFeeScopeKey(fee.key),
    rawKey: fee.key,
    product,
    whatItIs: d.whatItIs,
    audience: d.audience,
    amountMinor: fee.amountMinor,
    currency: fee.currency,
    intentionalZero,
    recordedPeriod,
    periodPlain: periodPlainLabel(recordedPeriod),
    stateLabel: isLive ? "Live" : "Retired",
    isLive,
    stateExplanation,
    appearsOn: d.appearsOn,
    editedOn: d.editedOn,
    periodOffer: offer,
    annualGap,
  };
}

export interface PriceClarityReport {
  rows: PriceClarityRow[];
  /** Counts, so the screen can lead with "you have N live prices". */
  liveCount: number;
  retiredCount: number;
  /**
   * Stated when the report is empty or could not be built, so an empty list is
   * never mistaken for "this platform has no prices" (R6).
   */
  refusal: string | null;
}

/**
 * THE REPORT. Built from the database on every call — there is no cache and no
 * compiled-in list, so it cannot go stale relative to the prices it describes.
 */
export function buildPriceClarityReport(): PriceClarityReport {
  let fees: PlatformFee[] = [];
  try {
    fees = listFees();
  } catch {
    return {
      rows: [],
      liveCount: 0,
      retiredCount: 0,
      refusal:
        "The platform could not read its price list on this request, so nothing is shown here. This is a read problem, not a sign that prices are missing. No price has been changed.",
    };
  }

  const periods = readPeriods();
  const rows = fees.map((f) => toRow(f, periods));
  rows.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
    if (a.audience !== b.audience) return a.audience < b.audience ? -1 : 1;
    return a.product < b.product ? -1 : a.product > b.product ? 1 : 0;
  });

  return {
    rows,
    liveCount: rows.filter((r) => r.isLive).length,
    retiredCount: rows.filter((r) => !r.isLive).length,
    refusal:
      rows.length === 0
        ? "No prices are on record in this platform yet. That is a real state, not a display fault: nothing has been priced. Add a price in Admin → Fees."
        : null,
  };
}
