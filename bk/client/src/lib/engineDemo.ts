/**
 * Demo bindings — turn the existing /api securities payload into engine inputs.
 *
 * The engine is the source of truth for the cap-table page; this adapter just
 * translates the existing mock-API shape to the engine's `Holder[] + Transaction[]`
 * inputs so we can compute `result.rows` and a `result.trace`.
 */
import {
  computeCapTable,
  type Holder,
  type Transaction,
  type View,
  type Region,
  type CapTableResult,
} from "@capavate/cap-table-engine";

export type ApiSecurity = {
  id: string;
  companyId: string;
  holderName: string;
  holderType: string;
  instrument: string;
  series: string | null;
  shares: number;
  pricePerShare: number | null;
  investmentAmount: number | null;
  cap: number | null;
  discount: number | null;
  issuedAt: string | null;
  // Sprint 5 — institutional-grade enrichments
  certificateNumber?: string | null;
  shareNumberFrom?: number | null;
  shareNumberTo?: number | null;
  roundId?: string | null;
  vesting?: { months: number; cliff: number; startDate: string; percentVested: number } | null;
  drag?: boolean;
  rofr?: boolean;
  coSale?: boolean;
  proRata?: boolean;
  leadInvestorOfRound?: boolean;
  sideLetter?: string | null;
  // Defect 15 — privacy fields optionally enriched by server for co-member views.
  investorId?: string | null;
  holderVisibility?: { screenName: string; screenNameSet: boolean; visibleToCoMembers: boolean; visibleToCollectiveNetwork: boolean } | null;
  optionStatus?: { granted: number; available: number; exercised: number; cancelled: number } | null;
  interestRate?: number | null;
  maturityDate?: string | null;
  accruedInterest?: number | null;
  strike?: number | null;
  expiry?: string | null;
  fmv?: number | null;
};

export function adaptSecuritiesToEngine(secs: ApiSecurity[]): { holders: Holder[]; transactions: Transaction[] } {
  const holders: Holder[] = [];
  const seen = new Set<string>();
  for (const s of secs) {
    const id = s.holderName;
    if (seen.has(id)) continue;
    seen.add(id);
    holders.push({
      id,
      name: s.holderName,
      type: (s.holderType as Holder["type"]) ?? "other",
    });
  }

  const transactions: Transaction[] = secs.map<Transaction>((s, i) => {
    const baseId = s.id ?? `s-${i}`;
    if (s.instrument === "common" || s.instrument === "preferred") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: s.instrument,
          series: s.series ?? undefined,
          shares: BigInt(s.shares),
          pricePerShare: s.pricePerShare?.toString(),
          investmentAmount: s.investmentAmount?.toString(),
          ...(s.instrument === "preferred" ? {
            preferred: {
              liquidationPreferenceMultiple: 1,
              participating: false,
              seniority: 0,
              originalIssuePrice: s.pricePerShare?.toString() ?? "1",
            },
          } : {}),
        },
      };
    }
    if (s.instrument === "option") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "option",
          series: s.series ?? undefined,
          option: { grantedShares: BigInt(s.shares), exercisePrice: "0.01", vestingMonths: 48, cliffMonths: 12 },
        },
      };
    }
    if (s.instrument === "safe") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "safe",
          investmentAmount: s.investmentAmount?.toString(),
          safe: {
            type: "post_money_cap",
            cap: s.cap?.toString(),
            discount: s.discount != null ? (s.discount > 1 ? (s.discount / 100).toString() : s.discount.toString()) : undefined,
          },
        },
      };
    }
    if (s.instrument === "warrant") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "warrant",
          warrant: {
            underlyingShares: BigInt(s.shares),
            strikePrice: (s.pricePerShare ?? 0.01).toString(),
            expiry: "2030-12-31",
            cashless: true,
          },
        },
      };
    }
    if (s.instrument === "note") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "note",
          investmentAmount: s.investmentAmount?.toString(),
          note: {
            principal: (s.investmentAmount ?? 0).toString(),
            cap: s.cap?.toString(),
            discount: s.discount != null ? (s.discount > 1 ? (s.discount / 100).toString() : s.discount.toString()) : undefined,
            interestRate: "0.05",
            interestKind: "simple",
            issueDate: s.issuedAt ?? "2025-01-01",
            maturityDate: "2027-12-31",
          },
        },
      };
    }
    // Fallback to common
    return {
      type: "issue",
      date: s.issuedAt ?? "2025-01-01",
      security: { id: baseId, holderId: s.holderName, kind: "common", shares: BigInt(s.shares ?? 0) },
    };
  });

  return { holders, transactions };
}

/**
 * Sprint 4 — As-Converted SAFE roll-up.
 *
 * The primary engine's "as_converted" view requires `estimatedPps` to render
 * SAFE/Note holders, but the demo `computeCapTable` call leaves it undefined.
 * Rather than mutate the engine API (and break the 69 tests pinned to it), we
 * pre-convert SAFEs into synthetic Common issuances in this adapter when the
 * caller asks for as_converted. The conversion price is the lower of the SAFE
 * post-money cap-implied price and the (PPS × (1−discount)) price, mirroring
 * the engine's `estimateConvertibleShares` logic.
 */
function safeConvertedShares(
  s: ApiSecurity,
  estimatedPps: number,
  estimatedFdShares: number,
): number {
  const purchase = s.investmentAmount ?? 0;
  if (!purchase) return 0;
  const discountFrac = s.discount != null ? (s.discount > 1 ? s.discount / 100 : s.discount) : 0;
  const candidates: number[] = [estimatedPps];
  if (s.cap && estimatedFdShares > 0) candidates.push(s.cap / estimatedFdShares);
  if (discountFrac > 0) candidates.push(estimatedPps * (1 - discountFrac));
  const conversionPrice = Math.min(...candidates.filter((c) => c > 0));
  if (!conversionPrice || !isFinite(conversionPrice)) return 0;
  return Math.floor(purchase / conversionPrice);
}

export function runEngine(secs: ApiSecurity[], view: View, region: Region = "US"): CapTableResult {
  let working = secs;
  if (view === "as_converted") {
    // Estimate latest priced PPS from the most recent preferred issuance.
    const preferred = secs
      .filter((x) => x.instrument === "preferred" && x.pricePerShare)
      .sort((a, b) => (a.issuedAt ?? "").localeCompare(b.issuedAt ?? ""));
    const estPps = preferred.length
      ? preferred[preferred.length - 1].pricePerShare ?? 1
      : 1;
    const estFdShares = secs.reduce((sum, x) => {
      if (x.instrument === "common" || x.instrument === "preferred" || x.instrument === "option" || x.instrument === "warrant") {
        return sum + (x.shares ?? 0);
      }
      return sum;
    }, 0);
    working = secs.map((s) => {
      if (s.instrument !== "safe" && s.instrument !== "note") return s;
      const converted = safeConvertedShares(s, estPps, estFdShares);
      if (!converted) return s;
      return {
        ...s,
        instrument: "common",
        shares: converted,
        series: s.series ?? "SAFE → Common (as-converted)",
        pricePerShare: s.pricePerShare ?? estPps,
      };
    });
  }
  const { holders, transactions } = adaptSecuritiesToEngine(working);
  return computeCapTable({
    companyId: "co-active",
    asOf: new Date().toISOString().slice(0, 10),
    view,
    formulaRegion: region,
    holders,
    transactions,
  });
}

/** Project a post-close cap table by appending a synthetic priced round. */
export function projectPostClose(
  secs: ApiSecurity[],
  round: { preMoneyValuation: number; investmentAmount: number; series: string },
  region: Region = "US",
): CapTableResult {
  const { holders, transactions } = adaptSecuritiesToEngine(secs);
  if (!holders.find((h) => h.id === `investors-${round.series}`)) {
    holders.push({ id: `investors-${round.series}`, name: `${round.series} investors`, type: "investor" });
  }
  transactions.push({
    type: "issue_preferred_round",
    date: new Date().toISOString().slice(0, 10),
    round: {
      id: round.series,
      series: round.series,
      preMoneyValuation: round.preMoneyValuation.toString(),
      investmentAmount: round.investmentAmount.toString(),
      liquidationPreferenceMultiple: 1,
      participating: false,
      antiDilution: "broad_based",
    },
  });
  return computeCapTable({
    companyId: "co-active",
    asOf: new Date().toISOString().slice(0, 10),
    view: "fully_diluted",
    formulaRegion: region,
    holders,
    transactions,
  });
}
