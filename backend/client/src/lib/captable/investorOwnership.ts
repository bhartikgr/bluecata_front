/* ════════════════════════════════════════════════════════════════════════════
   WAVE 113 · FINDING 1 — ONE OWNERSHIP-PERCENTAGE IMPLEMENTATION, FOR BOTH SIDES.
   ════════════════════════════════════════════════════════════════════════════
   THE DEFECT THIS REMOVES (`CODE_AUDIT.md` H-3, register B-45). An investor's own
   ownership percentage — the single most important figure either party reads —
   was produced by a SECOND, independent implementation:

       client/src/pages/investor/InvitationDetail.tsx:583-585
         rawTotalShares = Σ x.shares            // raw /securities wire rows
         ownership      = (x.shares / totalShares) * 100   // IEEE-754 double

   while the founder's cap table reads `runEngine` — bigint share counts, exact
   decimal ratios, and a choice of three views. MEASURED, not assumed
   (`build_log/wave113/W113_PREFLIGHT.md` §1.1, harness output
   `w113_scratch/agreement_before.txt`), the two disagree:

     · option pool present, Basic view      founder 80.00%   investor 69.5652%
     · unconverted SAFE, As-Converted view  founder 76.0000% investor 80%
     · that SAFE holder's own position      founder  5.0000% investor  0
     · pool + SAFE + warrant, Basic         founder 80.00%   investor 68.0851%

   They agreed on exactly one combination — Fully-Diluted with no convertible —
   and even that was a COINCIDENCE OF DENOMINATOR rather than shared code: summing
   the raw `shares` field happens to reproduce the fully-diluted base because
   options and warrants carry a non-zero `shares` field on the wire. Two
   implementations that agree by coincidence are still two implementations.

   WHY THIS FILE EXISTS RATHER THAN A SECOND FORMULA IN THE PAGE (R21 — one rule,
   one place). `runEngine` is imported here from `@shared/roundMathEngineAdapter`,
   the SAME function `client/src/pages/founder/CapTable.tsx:22` imports. Nothing
   is re-derived: each row's `ownershipPercent` decimal STRING is passed through
   untouched, at full engine precision. There is no division in this file.

   REDACTION HAPPENS AFTER THE SHARED COMPUTATION, NEVER AS A SECOND CALCULATION.
   The engine runs on the WHOLE cap table first, so the denominator an investor's
   percentage is of is the identical denominator the founder's is of; only then are
   rows the investor may not see filtered away. Filtering first — computing a
   percentage of "the rows you are allowed to look at" — is precisely how a second
   number is born, and it is why this order is load-bearing rather than stylistic.

   A PERCENTAGE MUST NAME ITS DENOMINATOR. The three views divide by three
   different denominators, so the same holder legitimately has three different
   percentages. Wave 108 gave the founder's screen a stated denominator and Wave
   110 put it inside both exports; an investor's percentage carried none, under a
   card header that asserted "Fully-diluted view" as static prose decoupled from
   the arithmetic underneath it. Every result from this module therefore carries
   `view`, `viewLabel` and `denominatorLabel`, taken from the SAME two label maps
   the founder's screen and both exports already use (`./exportProvenance`), so the
   two sides cannot drift on wording either.

   NOTHING IS EVER FABRICATED. `runEngine` REFUSES rather than invent a price when
   As-Converted has convertibles but no priced round
   (`shared/roundMathEngineAdapter.ts:2288-2306`). That refusal is caught here and
   returned as a NAMED refusal carrying the engine's own message, exactly as the
   exit waterfall refuses rather than inventing a share count. No fallback view is
   silently substituted, no zero is written, and `null` (0 ÷ 0 — the engine's D18
   contract) stays `null` all the way to the formatter.

   NOT TOUCHED: the engine packages, `shared/roundMathEngineAdapter.ts`,
   `computeConversionProjections`, and `client/src/pages/founder/CapTable.tsx`.
   ════════════════════════════════════════════════════════════════════════════ */

import { runEngine, type ApiSecurity } from "@shared/roundMathEngineAdapter";
import type { CapTableHolderRow, Region, View } from "@capavate/cap-table-engine";
import { VIEW_DENOMINATOR_LABEL, VIEW_LABEL } from "./exportProvenance";

/** The view an investor's own position is stated on when nothing else is chosen.
 *  Fully-Diluted, because that is the basis the investor-facing card has always
 *  claimed in prose — this makes the claim true instead of decorative. */
export const INVESTOR_DEFAULT_VIEW: View = "fully_diluted";

/** One row, straight from the shared engine. `ownershipPercent` is the engine's
 *  exact decimal string, or `null` for an undefined ratio — never a number, and
 *  never re-derived here. */
export type InvestorOwnershipRow = CapTableHolderRow & {
  /** True when this row is one of the viewer's OWN holdings. Set after the
   *  computation, used for emphasis and for the redacted subset. */
  isMine: boolean;
};

export type InvestorOwnershipResult =
  | {
      ok: true;
      view: View;
      viewLabel: string;
      denominatorLabel: string;
      /** Rows the viewer may see. Redacted AFTER the shared computation. */
      rows: InvestorOwnershipRow[];
      /** True when rows were withheld, so the caller can say so out loud. */
      redacted: boolean;
      /** The engine's denominator for this view, in shares. Exact, `bigint`. */
      totalShares: bigint;
      /** The date the engine was evaluated at (never a hidden `new Date()`). */
      asOf: string;
    }
  | {
      ok: false;
      view: View;
      viewLabel: string;
      denominatorLabel: string;
      reason: "no_securities" | "engine_refused";
      /** Plain English, safe to render. Carries the engine's own words verbatim
       *  when the engine is the one refusing. */
      message: string;
    };

/** The sentence that states what a percentage on this screen is a percentage OF.
 *  Same wording as the founder's screen and both spreadsheet exports. */
export function ownershipDenominatorSentence(view: View): string {
  return `Percentages on this ${VIEW_LABEL[view]} view are of ${VIEW_DENOMINATOR_LABEL[view]}. The other two views divide by a different denominator, so figures from different views are not comparable.`;
}

/** The short form for a column header or a screen-reader suffix. */
export function investorOwnershipColumnHeader(view: View): string {
  return `Ownership % of ${VIEW_DENOMINATOR_LABEL[view]}`;
}

/**
 * THE ONE INVESTOR-SIDE OWNERSHIP COMPUTATION. Delegates to the founder cap
 * table's engine and then redacts; it performs no arithmetic of its own.
 *
 * @param securities   the company's `/api/companies/:id/securities` rows, WHOLE —
 *                     the shared computation must see the full cap table or the
 *                     denominator is wrong.
 * @param view         which of the three views, and therefore which denominator.
 * @param mine         predicate identifying the viewer's own rows. When `redact`
 *                     is true, only these survive.
 * @param redact       true when the viewer is not on this company's cap table and
 *                     may see only their own position.
 */
export function computeInvestorOwnership(args: {
  securities: ApiSecurity[] | null | undefined;
  view?: View;
  region?: Region;
  /** ISO calendar date (`YYYY-MM-DD`). Passed to the engine so the result is not
   *  a function of the wall clock. */
  asOf?: string;
  mine?: (row: CapTableHolderRow) => boolean;
  redact?: boolean;
}): InvestorOwnershipResult {
  const view = args.view ?? INVESTOR_DEFAULT_VIEW;
  const viewLabel = VIEW_LABEL[view];
  const denominatorLabel = VIEW_DENOMINATOR_LABEL[view];
  const securities = Array.isArray(args.securities) ? args.securities : [];

  if (securities.length === 0) {
    return {
      ok: false,
      view,
      viewLabel,
      denominatorLabel,
      reason: "no_securities",
      message:
        "No securities are recorded for this company yet, so an ownership percentage cannot be stated. This is not zero — it is unknown, and it will appear here once the founder records the cap table.",
    };
  }

  let result: ReturnType<typeof runEngine>;
  try {
    result = runEngine(securities, view, args.region ?? "US", undefined, args.asOf);
  } catch (err) {
    /* The engine refuses rather than invent a conversion price. Its words are
       carried verbatim: a refusal the reader can act on beats a number nobody
       can trust. NOTHING is substituted — not a different view, not a zero. */
    return {
      ok: false,
      view,
      viewLabel,
      denominatorLabel,
      reason: "engine_refused",
      message: `An ownership percentage on the ${viewLabel} view cannot be stated for this cap table: ${
        (err as Error)?.message ?? "the calculation engine refused"
      }`,
    };
  }

  const isMine = args.mine ?? (() => false);
  const all: InvestorOwnershipRow[] = result.rows.map((r) => ({ ...r, isMine: isMine(r) }));
  const rows = args.redact ? all.filter((r) => r.isMine) : all;

  return {
    ok: true,
    view,
    viewLabel,
    denominatorLabel,
    rows,
    redacted: !!args.redact && rows.length !== all.length,
    totalShares: result.totalShares,
    asOf: result.asOf,
  };
}

/**
 * Case-insensitive, whitespace-tolerant holder matcher for `mine`. Holder rows
 * are keyed by NAME through `adaptSecuritiesToEngine`
 * (`shared/roundMathEngineAdapter.ts:1924`), so name is the only join available
 * on the client. An empty candidate set matches nothing — fail closed, so a
 * redacted view withholds everything rather than revealing everything.
 */
export function makeHolderMatcher(
  ownNames: ReadonlyArray<string | null | undefined>,
): (row: CapTableHolderRow) => boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const set = new Set(
    ownNames.filter((n): n is string => typeof n === "string" && n.trim() !== "").map(norm),
  );
  if (set.size === 0) return () => false;
  return (row) => set.has(norm(row.holderName ?? ""));
}
