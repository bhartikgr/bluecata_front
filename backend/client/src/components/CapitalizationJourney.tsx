/**
 * Sprint 4 — Capitalization Journey
 *
 * A multi-panel hero visualization on the founder dashboard:
 * 1. Round Timeline + Valuation curve (line + dots, latest is pulsing)
 * 2. Ownership Composition Over Time (stacked area)
 * 3. Round-by-Round card carousel
 * 4. KPI strip
 *
 * Pulls /api/rounds + /api/companies/:id/securities. The composition snapshot at
 * each round is derived in the frontend by simulating dilution as each round
 * lands, using the pre/post-money + share data already in the demo. The math
 * is illustrative — at production, this view would be reconstructed by
 * `@capavate/cap-table-engine` from the immutable transaction ledger.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
 ResponsiveContainer,
 ComposedChart,
 Line,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip as RcTooltip,
 Area,
 AreaChart,
 ReferenceLine,
 Legend,
 Bar,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { TrendingUp, Users, PieChart as PieIcon, Wallet, ArrowRight, Cpu, Sparkles } from "lucide-react";
import { fmtUSD, fmtPct, fmtDate, fmtNum } from "@/lib/format";
import { runEngine, type ApiSecurity } from "@/lib/engineDemo";
import type { ApiRound } from "@/lib/types";
/* WAVE 116 — the shared readers. Nothing in this file derives money or ownership
   for itself any more; see the block comments at each site. */
import {
  readCompanyMoneyOnRecord,
  chartMajorFromMinor,
  minorTextToBigInt,
  COMPANY_MONEY_SUBSCRIBED_LABEL,
} from "@/lib/money/companyMoneyOnRecord";
import { readRoundMoneyOnRecord } from "@shared/roundMoneyOnRecordView";
import {
  ownershipPercentCellText,
  sumOwnershipPercent,
  OWNERSHIP_UNDEFINED,
} from "@/lib/captable/ownershipPercent";
import { VIEW_DENOMINATOR_LABEL } from "@/lib/captable/exportProvenance";
/* WAVE 125 · FINDING 1 — an absent founder row is a refusal, not a zero. */
import { founderHoldingVerdict } from "@/lib/captable/founderHoldingOnRecord";
/* WAVE 125 · FINDING 2 — the one definition of "a cap-table holder", shared with
   the server producer that feeds the dashboard, switcher and report snapshot. */
import { countCapTableHolders } from "@/lib/captable/capTableHolderCount";

const COLORS = {
 primary: "#20808D", // teal — engine/brand
 primaryFaint: "#20808D33",
 gold: "#D4A857", // valuation deltas
 founder: "#1F3756", // navy
 pool: "#7C9EBF", // light steel
 preferred: "#20808D", // teal
 safe: "#B53D6E", // wine/rose
 note: "#E0A82E", // amber
 warrant: "#3F8C5C", // forest
 /* WAVE 128 · R94 — the NEW band. A colour of its own, taken from neither the
    founder navy nor the preferred teal, so common held by an investor cannot be
    mistaken on the chart for either of the two bands it used to be confused
    with. No existing colour is changed. */
 common: "#8A6FBF", // violet
};

/* WAVE 128 · R94 / R91 — `common` is APPENDED. Indices 0-5 and their labels are
   frozen exactly as Wave 120 shipped them; a band is added, nothing is renamed
   and nothing is reordered. `w128_journey_common_band` pins this array and the
   label map as literals so a later reorder fails the build. */
const INSTRUMENT_ORDER = ["founder", "pool", "preferred", "safe", "note", "warrant", "common"] as const;

const INSTRUMENT_LABEL: Record<string, string> = {
 founder: "Founders",
 pool: "Employee Pool (ESOP)",
 preferred: "Preferred (Investors)",
 safe: "SAFE (Investors)",
 note: "Notes (Investors)",
 warrant: "Warrants",
 /* Follows the sibling vocabulary ("Preferred (Investors)"). Holder type is
    consulted BEFORE the instrument, so a founder's common and an employee
    pool's common never reach this band — everything that does is held by a
    non-founder, non-pool party, which on this platform is an investor. */
 common: "Common (Investors)",
};

const INSTRUMENT_COLOR: Record<string, string> = {
 founder: COLORS.founder,
 pool: COLORS.pool,
 preferred: COLORS.preferred,
 safe: COLORS.safe,
 note: COLORS.note,
 warrant: COLORS.warrant,
 common: COLORS.common,
};

type Snapshot = {
 date: string;
 roundId: string;
 roundName: string;
 preMoney: number;
 postMoney: number;
 composition: Record<string, number>; // bucket -> pct of SNAPSHOT_DENOMINATOR_LABEL
 /* WAVE 128 · R94 REQUIREMENT 4 — why no founders figure may be published for
    this snapshot, or `null` when one may be. The verdict is NOT re-derived here:
    it is `founderHoldingVerdict`'s (WAVE 125), asked with the CORRECTED band as
    the discriminator, so "no founder holding on record" says the same words on
    this card as it does on the cap table and the dashboard. */
 founderStatement: string | null;
};

/* WAVE 116 · FINDING 2 — THE INVENTED DENOMINATOR, AND WHY THE PANEL NOW REFUSES.
 *
 * `buildSnapshots` used to manufacture share counts for unconverted convertibles:
 *
 *     // Assume 12M total FD shares at conversion as a rough demo basis.
 *     const capPrice = s.cap / 12_000_000;
 *     shares = Math.floor(principal / capPrice);
 *   } else if (principal) {
 *     shares = Math.floor(principal / 1.0);
 *
 * TWO inventions, not one. The `12_000_000` fully-diluted share count the brief
 * names, and `principal / 1.0` beneath it — an assumed $1.00 price per share,
 * the same defect with its constant hidden inside a division by one. Neither
 * number exists anywhere in the company's data.
 *
 * They did not stay local. The invented shares went into `buckets[bucket]` AND
 * into `totalShares`, so they sat in both the numerator and the denominator of
 * `composition[k] = (buckets[k] / totalShares) * 100` — every holder's
 * percentage on the "Ownership Composition Over Time" chart moved, not just the
 * SAFE holder's. And the panel presented the result under a badge reading
 * "Reconstructed from your transaction ledger", which made it a claim rather
 * than a sketch.
 *
 * WHY REFUSE RATHER THAN DROP THE ROW. Dropping an unconverted SAFE from the
 * chart is not neutral: Wave 113 measured a real holder of roughly 5% displayed
 * as 0% on the investor side, and a composition chart that silently omits a
 * holder repeats that defect in a different costume. So a snapshot containing a
 * convertible with no RECORDED share count is not drawn at all, and the panel
 * says which rows stopped it.
 *
 * WHY NOT ROUTE IT THROUGH THE ENGINE. As-converted needs a priced round at the
 * snapshot date, and `runEngine` (already imported by this file for the KPI
 * strip) itself refuses As-Converted when there are convertibles and no priced
 * round. Inventing an engine input to avoid inventing a denominator is the same
 * error one layer down. `computeConversionProjections` is NOT the problem here
 * and is not touched.
 *
 * WAVE 120 · FINDING 3 — WHY THAT LAST POINT NO LONGER HOLDS, AND WHAT THE BASIS
 * IS NOW. Wave 116 declined to route this panel through the engine because
 * AS-CONVERTED needs a price the platform may not hold. True — but FULLY-DILUTED
 * needs no price at all, and it is the view this very file already calls for its
 * KPI strip and the view `/founder/captable` renders. What was left behind
 * instead was
 *
 *     composition[k] = (buckets[k] / totalShares) * 100;
 *
 * a tenth private implementation of "a holder's share of the cap table", in
 * IEEE-754 floats, over a denominator this component summed for itself. It is now
 * the engine's `ownershipPercent` for the same date, read through the platform's
 * one null-aware ownership reader. The ENGINE IS NOT TOUCHED — and nor is
 * `computeConversionProjections`, which is correct.
 *
 * THE DENOMINATOR LABEL IS RESTATED, NOT REPOINTED. Wave 116 ratified a label
 * saying these percentages are of the shares RECORDED at that date and are NOT
 * fully diluted, and `server/__tests__/w116_company_money_and_denominators.test.ts`
 * (a file this wave does not own) pins both of those words. Both remain TRUE of the
 * engine's basis here, and the label now says so precisely rather than by
 * implication: the engine's Fully-Diluted view over the RECORDED securities counts
 * recorded common, preferred, option GRANTS and warrants; it does not inflate the
 * denominator with an authorised-but-ungranted pool, and it converts nothing, which
 * is why a round holding an unconverted convertible is refused outright above
 * rather than drawn. The two waves describe the same denominator — only the
 * arithmetic moved, from a private float division to the engine. */
export const SNAPSHOT_DENOMINATOR_LABEL =
  "share of the shares recorded at that date, computed by the cap-table engine from the recorded common, preferred, option grants and warrants — an authorised-but-ungranted pool is not fully diluted into it, and a round holding an unconverted convertible shows no percentages at all";

/** Why a snapshot cannot be drawn. Named, so the panel can say it in words. */
export type SnapshotRefusal = {
 roundId: string;
 roundName: string;
 /** How many live rows held a convertible with no recorded share count. */
 unconvertedRows: number;
 statement: string;
};

/** WAVE 128 · R94 REQUIREMENT 2 — the ONE place the unclassifiable-row refusal is
 *  worded, so the sentence names the row that stopped the card. Exported so a
 *  test can assert the exact statement rather than a substring of it. */
export function unclassifiedRowStatement(
 roundName: string,
 rows: ReadonlyArray<{ holderName: string; kind: string }>,
): string {
 const named = rows
 .map((r) => `${(r.holderName ?? "").trim() || "a holding with no holder name on record"} (${r.kind || "no instrument recorded"})`)
 .join("; ");
 return (
 `No composition shown at ${roundName}: ${rows.length} ${rows.length === 1 ? "holding could" : "holdings could"} not be ` +
 `classified into an ownership band — ${named}. Assigning ${rows.length === 1 ? "it" : "them"} to a band would attribute ` +
 "somebody else's equity, so no percentages are drawn for this round until the instrument and holder type are recorded."
 );
}

export type SnapshotBuild = {
 snapshots: Snapshot[];
 refusals: SnapshotRefusal[];
 denominatorLabel: string;
};

/** WAVE 120 · FINDING 3 — the engine result, named so the snapshot loop can hold
 *  it in a `let` across a `try`. `runEngine` is imported, not re-implemented. */
type CapTableRunResult = ReturnType<typeof runEngine>;

/** The composition bands, in the order the chart stacks them.
 *  WAVE 128 · R94 / R91 — `common` APPENDED at index 6; 0-5 unchanged. */
const SNAPSHOT_BUCKETS = ["founder", "pool", "preferred", "safe", "note", "warrant", "common"] as const;

/** WAVE 120 · FINDING 3 — which band an ENGINE row belongs to. The same rules the
 *  old private bucket loop applied to raw securities, now applied to the engine's
 *  rows so the bands still add up to the engine's own denominator. Holder type
 *  wins over instrument (a founder's preferred is still founder equity), which is
 *  the precedence the previous code used. */
/* ════════════════════════════════════════════════════════════════════════════
   WAVE 128 · R94 — THE FALL-THROUGH THAT GAVE AN INVESTOR'S SHARES TO FOUNDERS.
   ════════════════════════════════════════════════════════════════════════════
   WHAT THIS FUNCTION USED TO END WITH:

       return "founder";

   The engine emits `kind: "common"` for a common issuance
   (shared/roundMathEngineAdapter.ts:1936-1946 and :2117) and `holderType`
   defaults to `"other"` when the record carries none (:1930). `common` matched
   NO branch, so every share of common held by anyone who was not typed a founder
   or a pool fell through and was counted as FOUNDER EQUITY.

   THE MEASURED CONSEQUENCE. `BluePrint Catalyst Limited` — one investor holding
   all 150 common shares, no founder row at all — made the per-round card read
   `Founders 100%`. That is the same fabricated figure Wave 120 removed and
   Wave 125 fixed on the cap table and the dashboard, reintroduced here by a
   default. Three surfaces, one lie.

   WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT. The PRECEDENCE is correct and
   stays: holder type is read FIRST, so a founder's preferred — and a founder's
   common — is still founder equity. Only the DEFAULT goes. Common gets a band of
   its own (the owner's ruling of 2026-08-22: common shares are issued to all
   types of investor, and common held by an investor is INVESTOR equity), and a
   row that matches nothing at all returns `null`, which makes the caller REFUSE
   the card and name the row rather than quietly handing it to the largest and
   most consequential band.

   HOW REACHABLE IS THE `null` PATH TODAY, STATED HONESTLY. `adaptSecuritiesToEngine`
   ends with a FALLBACK of its own (shared/roundMathEngineAdapter.ts:2113-2118):
   an instrument it does not recognise is issued to the engine as `kind: "common"`.
   So every row this function can currently be handed is one of common, preferred,
   option, safe, note or warrant, and the `null` is a DEFENCE rather than a live
   path — an unrecognised instrument now lands in the COMMON band (investor
   equity) instead of in the founders'. The guard stays because the alternative is
   a default, and a default is what caused R94: the day a new `kind` reaches this
   function, the card must refuse rather than attribute somebody's equity to the
   founders. `w128_journey_common_band` pins both halves.

   Exported ONLY so a test can pin the classification directly, including the
   `null`; nothing outside this module calls it.
   ════════════════════════════════════════════════════════════════════════════ */
export function snapshotBucketOf(row: { holderType: string; kind: string }): string | null {
 if (row.holderType === "founder") return "founder";
 if (row.holderType === "pool") return "pool";
 if (row.kind === "option") return "pool";
 if (row.kind === "preferred") return "preferred";
 if (row.kind === "safe") return "safe";
 if (row.kind === "note") return "note";
 if (row.kind === "warrant") return "warrant";
 if (row.kind === "common") return "common";
 return null;
}

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 120 · FINDING 3 — A PERCENTAGE THAT BELONGS TO ITS OWN ROUND, AND NO
   FABRICATED "100%".
   ════════════════════════════════════════════════════════════════════════════
   WHAT THE ROUND-BY-ROUND CARDS USED TO DO:

       const founderBefore = idx > 0 ? snapshots[idx - 1]?.composition.founder : 100;
       const founderAfter  = snapshots[idx]?.composition.founder ?? null;

   `idx` indexes `valuationSeries`, which is EVERY round of the company. `snapshots`
   is a DIFFERENT, SHORTER array: `buildSnapshots` `continue`s past any round whose
   snapshot it refuses (an unconverted convertible) or whose capitalisation is
   empty. The two arrays therefore fall out of alignment at the first skipped
   round, and every card after it displayed ANOTHER ROUND'S dilution as its own.
   A correct percentage attributed to the wrong round is still a false statement,
   and it is the more dangerous kind, because it looks right.

   AND THE `: 100`. On the first card, "founders held 100% before this round" was
   asserted with no snapshot behind it — a denominator invented out of an ordinal
   index. It is untrue of any company that issued a pool, a warrant or an advisor
   grant before its first priced round.

   WHAT REPLACES BOTH: a lookup BY `roundId`, which is already carried on every
   snapshot and every refusal, so a card can only ever read its own figures. If
   this round has no snapshot, the card shows NO percentage and says why. "Before"
   is the composition of the PREVIOUS SNAPSHOT IN THE SNAPSHOT SERIES; when there
   is none, it renders `—` (R47's undefined), never `100`.

   Exported as a pure function so the alignment can be tested without rendering
   recharts. */
export type JourneyCardOwnership = {
 /** `true` only when this round has its own snapshot. */
 shown: boolean;
 /** The round these figures were computed for — asserted in tests. */
 roundId: string;
 /** Founders' share before/after, as display text; `—` when undefined. */
 beforeText: string;
 afterText: string;
 /** `true` when the corresponding text is a real number and may carry a `%`.
  *  An em dash must NOT be rendered as `—%`, which reads like a percentage. */
 beforeIsNumber: boolean;
 afterIsNumber: boolean;
 /** Present when, and only when, `shown` is false. */
 statement: string | null;
};

export function journeyCardOwnership(build: SnapshotBuild, roundId: string): JourneyCardOwnership {
 const idx = build.snapshots.findIndex((s) => s.roundId === roundId);
 if (idx === -1) {
 const refusal = build.refusals.find((r) => r.roundId === roundId);
 return {
 shown: false,
 roundId,
 beforeText: OWNERSHIP_UNDEFINED,
 afterText: OWNERSHIP_UNDEFINED,
 beforeIsNumber: false,
 afterIsNumber: false,
 statement:
 refusal?.statement ??
 "No ownership composition was computed for this round, so no founder percentage is shown for it.",
 };
 }
 /* WAVE 128 · R94 REQUIREMENT 4 — NO FOUNDERS FIGURE AT ALL WHEN NO FOUNDER
    HOLDING IS ON RECORD. `buildSnapshots` has already asked WAVE 125's
    `founderHoldingVerdict` for this snapshot; if it refused, the card publishes
    neither a percentage nor a dash-with-a-percent-sign — it says why, in the
    refusal branch this card already had. */
 const snap = build.snapshots[idx];
 if (snap?.founderStatement) {
 return {
 shown: false,
 roundId,
 beforeText: OWNERSHIP_UNDEFINED,
 afterText: OWNERSHIP_UNDEFINED,
 beforeIsNumber: false,
 afterIsNumber: false,
 statement: snap.founderStatement,
 };
 }
 const after = snap?.composition.founder;
 /* "Before" is the PREVIOUS snapshot's founders share — and only when that
    snapshot was itself allowed to publish one. Reading a figure through a
    refusal would put back the fabrication on the neighbouring card. */
 const prev = idx > 0 ? build.snapshots[idx - 1] : undefined;
 const before = prev && !prev.founderStatement ? prev.composition.founder : null;
 const beforeText = ownershipPercentCellText(before ?? null, 0);
 const afterText = ownershipPercentCellText(after ?? null, 0);
 return {
 shown: true,
 roundId,
 beforeText,
 afterText,
 beforeIsNumber: beforeText !== OWNERSHIP_UNDEFINED,
 afterIsNumber: afterText !== OWNERSHIP_UNDEFINED,
 statement: null,
 };
}

export function buildSnapshots(rounds: ApiRound[], securities: ApiSecurity[], companyId: string): SnapshotBuild {
 // Filter to the active company's rounds only, sort by closeDate ascending.
 const ours = rounds
 .filter((r) => (r as any).companyId === companyId)
 .sort((a, b) => (a.closeDate ?? "").localeCompare(b.closeDate ?? ""));

 const snapshots: Snapshot[] = [];
 const refusals: SnapshotRefusal[] = [];

 // For each round close, compute a composition snapshot. We start at the
 // founder + pool foundation, then layer each round on top — investors who
 // appear in the securities list before/up-to that round are included.
 for (const round of ours) {
 // Determine which securities are "live" at this round's close date.
 const live = securities.filter((s) => (s.issuedAt ?? "0000") <= (round.closeDate ?? "9999"));
 /* WAVE 116 · FINDING 2 — a convertible with no RECORDED share count is not
 given one. It makes the snapshot undeterminable and the snapshot is not
 drawn: see the block comment above `SNAPSHOT_DENOMINATOR_LABEL`.
 WAVE 120 · FINDING 3 — a convertible WITH a recorded share count stops the
 snapshot too, for the mirror-image reason. The engine's fully-diluted view
 converts a SAFE or note only against a price, so without one it leaves such
 a holder out of BOTH numerator and denominator — which is the silent drop
 Wave 113 measured, where a real holder of roughly 5% was displayed as 0%,
 and it would additionally inflate every other holder's percentage. Counted
 separately so the statement can name what actually stopped it. */
 let unconvertedRows = 0;
 let unpriceableConvertibleRows = 0;
 for (const s of live) {
 if (s.instrument !== "safe" && s.instrument !== "note") continue;
 if (!s.shares || s.shares === 0) unconvertedRows += 1;
 else unpriceableConvertibleRows += 1;
 }

 if (unconvertedRows === 0 && unpriceableConvertibleRows > 0) {
 refusals.push({
 roundId: round.id,
 roundName: round.name,
 unconvertedRows: unpriceableConvertibleRows,
 statement:
 `No composition shown at ${round.name}: ${unpriceableConvertibleRows} convertible ` +
 `${unpriceableConvertibleRows === 1 ? "holding carries" : "holdings carry"} a recorded share count but had not ` +
 "converted at that date. Converting it would need a share price this platform does not hold at that date, and " +
 "leaving it out would understate that holder while overstating everyone else, so no percentages are drawn for " +
 "this round.",
 });
 continue;
 }

 if (unconvertedRows > 0) {
 refusals.push({
 roundId: round.id,
 roundName: round.name,
 unconvertedRows,
 statement:
 `No composition shown at ${round.name}: ${unconvertedRows} convertible ${unconvertedRows === 1 ? "holding" : "holdings"} ` +
 "had not converted and carry no recorded share count at that date. Converting them would require a share price this " +
 "platform does not hold, and leaving them out would understate those holders, so no percentages are drawn for this round.",
 });
 continue;
 }

 /* WAVE 120 · FINDING 3 — THE PERCENTAGES COME FROM THE ENGINE NOW.
 `asOf` is THIS round's close date, so the snapshot is computed as of the
 date it claims to describe rather than as of today. Each bucket is the sum
 of its rows' engine `ownershipPercent` through `sumOwnershipPercent`, which
 returns `null` when ANY member is undefined — and a `null` bucket makes the
 whole snapshot undrawn rather than a bucket quietly worth zero. */
 const asOf = (round.closeDate ?? "").slice(0, 10) || undefined;
 let fd: CapTableRunResult;
 try {
 fd = runEngine(live, "fully_diluted", "US", undefined, asOf);
 } catch {
 refusals.push({
 roundId: round.id,
 roundName: round.name,
 unconvertedRows: 0,
 statement:
 `No composition shown at ${round.name}: the cap-table engine could not determine the capitalisation at that ` +
 "date from the securities on record, so no percentages are drawn for this round.",
 });
 continue;
 }

 if (fd.totalShares === BigInt(0)) continue;

 /* WHY THE BAND IS READ BACK FROM THE RECORD AND NOT FROM THE ENGINE ROW.
 `adaptSecuritiesToEngine` keys holders by `holderName`
 (`shared/roundMathEngineAdapter.ts:1923-1932`), so records sharing a holder
 name — or carrying none — collapse onto ONE holder, and every row of that
 holder then reports the FIRST record's type. A pool grant recorded without a
 holder name comes back typed `founder`, which would add it to the FOUNDERS'
 band and overstate the one figure these cards exist to show. The engine's
 percentages are used untouched; only the band each row belongs to is looked up
 from the record that produced it, by holder name and instrument. */
 const recordedTypeByKey = new Map<string, string>();
 for (const s of live) {
 const key = `${s.holderName ?? ""}|${s.instrument}`;
 if (!recordedTypeByKey.has(key) && s.holderType) recordedTypeByKey.set(key, s.holderType);
 }
 const bandOf = (row: { holderType: string; kind: string; holderName: string }): string | null =>
 snapshotBucketOf({
 holderType: recordedTypeByKey.get(`${row.holderName ?? ""}|${row.kind}`) ?? row.holderType,
 kind: row.kind,
 });

 /* WAVE 128 · R94 REQUIREMENT 2 — A ROW THAT CANNOT BE BANDED STOPS THE CARD.
    `snapshotBucketOf` no longer has a default, so an unrecognised instrument
    comes back `null` instead of being added to the founders. The honest outcome
    is the one the exit waterfall and the cap table already take: draw nothing,
    and say which row stopped it. Collected BEFORE any percentage is summed, so
    no partial figure is ever computed from an incomplete classification. */
 const unclassified = fd.rows.filter((row) => bandOf(row) === null);
 if (unclassified.length > 0) {
 refusals.push({
 roundId: round.id,
 roundName: round.name,
 unconvertedRows: 0,
 statement: unclassifiedRowStatement(round.name, unclassified.map((r) => ({ holderName: r.holderName, kind: r.kind }))),
 });
 continue;
 }

 const composition: Record<string, number> = {};
 let undefinedBucket = false;
 for (const k of SNAPSHOT_BUCKETS) {
 const pct = sumOwnershipPercent(fd.rows.filter((row) => bandOf(row) === k));
 if (pct === null) { undefinedBucket = true; break; }
 composition[k] = pct;
 }
 if (undefinedBucket) {
 refusals.push({
 roundId: round.id,
 roundName: round.name,
 unconvertedRows: 0,
 statement:
 `No composition shown at ${round.name}: the cap-table engine returned no ownership percentage for at least one ` +
 "holder at that date, which makes the group shares undefined rather than zero.",
 });
 continue;
 }

 /* WAVE 128 · R94 REQUIREMENT 4 — AN ABSENT FOUNDER ROW IS NOT `Founders 0%`,
    AND IT IS CERTAINLY NOT `Founders 100%`.

    With the fall-through gone, the BluePrint shape (one investor, 150 common,
    no founder row) now bands correctly — `common` 100, `founder` 0 — and a
    naked `0` on the card would be the SECOND false statement about the same
    data, the exact one Wave 125 removed from the cap table. So the card is
    asked, per snapshot, whether a founders figure may be published at all.

    The rule is NOT restated here. `founderHoldingVerdict` (WAVE 125) is the
    platform's one place for it, and it is asked with the CORRECTED band as the
    discriminator rather than the raw `holderType`, because the band is what the
    percentages were summed by — the question and the arithmetic must agree.
    A founder row RECORDING zero still publishes `0.00%` (state B). */
 const founderVerdict = founderHoldingVerdict(
 fd.rows.map((r) => ({ holderType: bandOf(r) === "founder" ? "founder" : "other" })),
 fd.totalShares as unknown as bigint,
 );

 snapshots.push({
 date: round.closeDate ?? "",
 roundId: round.id,
 roundName: round.name,
 preMoney: round.preMoney ?? 0,
 postMoney: round.postMoney ?? 0,
 composition,
 founderStatement: founderVerdict.refuse ? founderVerdict.statement : null,
 });
 }

 return { snapshots, refusals, denominatorLabel: SNAPSHOT_DENOMINATOR_LABEL };
}

function ValuationTooltip({ active, payload }: any) {
 if (!active || !payload?.length) return null;
 const p = payload[0].payload;
 return (
 <div className="bg-popover border border-border rounded-md shadow-md p-3 text-xs space-y-1 max-w-[260px]">
 <div className="font-semibold text-sm">{p.roundName}</div>
 <div className="text-muted-foreground">{fmtDate(p.date)}</div>
 <div className="border-t border-border/60 my-1" />
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Pre-money</span><span className="font-mono font-medium">{fmtUSD(p.preMoney, { compact: true })}</span></div>
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Post-money</span><span className="font-mono font-medium">{fmtUSD(p.postMoney, { compact: true })}</span></div>
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Round size</span><span className="font-mono font-medium">{fmtUSD(p.targetAmount, { compact: true })}</span></div>
 {p.leadInvestor && (
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Lead</span><span className="font-medium">{p.leadInvestor}</span></div>
 )}
 {p.investorCount != null && (
 <div className="flex justify-between gap-4"><span className="text-muted-foreground">Investors</span><span className="font-mono">{p.investorCount}</span></div>
 )}
 <div className="flex justify-between gap-4 pt-1 border-t border-border/60"><span className="text-muted-foreground">State</span><span className="capitalize font-medium">{p.state.replace(/_/g, " ")}</span></div>
 </div>
 );
}

function CompositionTooltip({ active, payload, label }: any) {
 if (!active || !payload?.length) return null;
 return (
 <div className="bg-popover border border-border rounded-md shadow-md p-3 text-xs">
 <div className="font-semibold text-sm mb-1">{payload[0]?.payload?.roundName}</div>
 <div className="text-muted-foreground mb-2">{label}</div>
 <ul className="space-y-1">
 {INSTRUMENT_ORDER.filter((k) => (payload[0]?.payload?.[k] ?? 0) > 0.01).map((k) => (
 <li key={k} className="flex items-center justify-between gap-3">
 <span className="flex items-center gap-1.5">
 <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INSTRUMENT_COLOR[k] }} />
 {INSTRUMENT_LABEL[k]}
 </span>
 <span className="font-mono tabular-nums font-medium">{(payload[0]?.payload?.[k] ?? 0).toFixed(1)}%</span>
 </li>
 ))}
 </ul>
 </div>
 );
}

export default function CapitalizationJourney({ companyId }: { companyId?: string } = {}) {
 const activeCompanyId = companyId ?? "";
 const rounds = useQuery<ApiRound[]>({ queryKey: ["/api/rounds"], enabled: Boolean(activeCompanyId) });
 const securities = useQuery<ApiSecurity[]>({
  queryKey: ["/api/companies", activeCompanyId, "securities"],
  queryFn: async () => {
   const r = await fetch(`/api/companies/${encodeURIComponent(activeCompanyId)}/securities`);
   if (!r.ok) return [] as ApiSecurity[];
   return r.json();
  },
  enabled: Boolean(activeCompanyId),
 });

 const novapayRounds = useMemo(() => {
 if (!rounds.data || !activeCompanyId) return [];
 return rounds.data
 .filter((r) => (r as any).companyId === activeCompanyId)
 .sort((a, b) => (a.closeDate ?? "").localeCompare(b.closeDate ?? ""));
 }, [rounds.data, activeCompanyId]);

 /* WAVE 116 · FINDING 1 (closes Wave 114's OQ-W114-2) — `cumulative` used to be
    `cumulative += r.raisedAmount ?? 0`, i.e. a running total of
    `rounds.raised_amount`, a `NOT NULL DEFAULT 0` column with no writer anywhere
    in the tree. The "Cumulative raised" bar on the valuation chart was therefore
    a flat zero on every real company. It now accumulates the DERIVED subscribed
    (committed + funded) figure from Wave 114's projection, in exact `bigint`
    minor units, and a round whose projection refuses contributes NO BAR rather
    than a zero-height one — `cumulativeRaised: null` is what recharts skips. */
 const valuationSeries = useMemo(() => {
 let cumulativeMinor = BigInt(0);
 let broken = false;
 return novapayRounds.map((r, idx) => {
 const view = readRoundMoneyOnRecord((r as unknown as Record<string, unknown>).moneyOnRecord);
 const subscribed = view.canPrintFigures && view.money ? minorTextToBigInt(view.money.subscribedMinor) : null;
 if (subscribed === null) broken = true;
 else cumulativeMinor += subscribed;
 const currency = (view.money?.currency ?? "USD") || "USD";
 const prev = idx > 0 ? novapayRounds[idx - 1] : null;
 const stepUp = prev && prev.postMoney && r.preMoney ? (r.preMoney / prev.postMoney) - 1 : null;
 return {
 ...r,
 /* Once any round in the series is undetermined, every later cumulative
    point would be understated, so the whole remaining series refuses. */
 cumulativeRaised: broken ? null : chartMajorFromMinor(cumulativeMinor, currency),
 subscribedDisplay: view.canPrintFigures && view.money ? view.money.subscribedDisplay : null,
 moneyStatement: view.canPrintFigures ? null : view.statement,
 moneyBuckets: view.buckets,
 stepUp, // (this round's pre-money / last round's post-money) − 1
 };
 });
 }, [novapayRounds]);

 const snapshotBuild = useMemo(() => {
 if (!securities.data) return { snapshots: [], refusals: [], denominatorLabel: SNAPSHOT_DENOMINATOR_LABEL };
 return buildSnapshots(novapayRounds, securities.data, activeCompanyId);
 }, [novapayRounds, securities.data, activeCompanyId]);
 const snapshots = snapshotBuild.snapshots;

 // Stacked-area dataset
 const compositionData = useMemo(() =>
 snapshots.map((s) => ({
 date: s.date,
 roundName: s.roundName,
 ...s.composition,
 })), [snapshots]);

 /* WAVE 116 · FINDING 1 — the company-level money figure, from the one reader. */
 const companyMoney = useMemo(() => readCompanyMoneyOnRecord(novapayRounds), [novapayRounds]);

 // KPIs
 const kpis = useMemo(() => {
 if (!rounds.data || !securities.data) return null;
 const sortedRounds = [...novapayRounds].sort((a, b) => (b.closeDate ?? "").localeCompare(a.closeDate ?? ""));
 const latestRoundWithVal = sortedRounds.find((r) => r.postMoney);
 const latestValuation = latestRoundWithVal?.postMoney ?? 0;
 // Founder ownership from FD view of current cap table
 const fd = runEngine(securities.data, "fully_diluted", "US");
 /* WAVE 116 · FINDING 3 (Wave 113 ownership site #7) — this used to be

      const founderPct = fd.totalShares === 0n ? 0 : Number((founderShares * 10000n) / fd.totalShares) / 100;

    which is a NINTH implementation of "a holder's share of the cap table": it
    called the reference engine, threw the engine's own answer away, and
    re-divided share totals itself at 2-decimal integer truncation. It also
    fabricated `0` for `0 ÷ 0` — an undefined ratio, which owner ruling D18 made
    the engine return as `null` and R47 renders as an em dash.

    It now READS the engine's `ownershipPercent` for the founder rows through
    `client/src/lib/captable/ownershipPercent.ts`, the platform's one null-aware
    ownership renderer, and refuses when the engine has no answer. The engine
    itself is not touched.

    WAVE 125 · FINDING 1 — AND IT STILL SUMMED AN EMPTY SET TO ZERO.
    `sumOwnershipPercent([])` returns `0`, not `null`: for a cap table with rows
    but NO founder row (`BluePrint Catalyst Limited` — 150 shares, one investor
    holding all of them) this printed a confident `0.00%` for founder ownership,
    the same fabrication the cap-table page made. The engine already names this
    case — `server/lib/founderOwnershipEngine.ts:158-171`,
    `no_founder_holding_on_record` — and `@/lib/captable/founderHoldingOnRecord`
    restates that one rule for renderers. A founder row RECORDING zero is
    untouched and still reads `0.00%`; only an ABSENT row refuses. */
 const founderHolding = founderHoldingVerdict(fd.rows, fd.totalShares as unknown as bigint);
 const founderPctText = founderHolding.refuse
   ? OWNERSHIP_UNDEFINED
   : ownershipPercentCellText(
       sumOwnershipPercent(fd.rows.filter((r) => r.holderType === "founder")),
     );
 /* WAVE 125 · FINDING 2 — the distinct-holder definition moved, unchanged, into
    `@/lib/captable/capTableHolderCount` so that the server producer feeding the
    dashboard, the company switcher and the report snapshot counts holders the
    SAME way this KPI does. This page used to contradict itself: this figure said
    `1` while the tile above it said `0 holders` (R46). */
 const investorCount = countCapTableHolders(fd.rows);
 return { latestValuation, founderPctText, founderHoldingStatement: founderHolding.statement, investorCount };
 }, [novapayRounds, rounds.data, securities.data]);

 const isLoading = rounds.isLoading || securities.isLoading;

 if (isLoading) {
 return (
 <Card className="mb-6">
 <CardContent className="p-8 text-center text-sm text-muted-foreground">Loading capitalization journey…</CardContent>
 </Card>
 );
 }

 if (!activeCompanyId || novapayRounds.length === 0) {
 return null;
 }

 return (
 <Card className="mb-6 overflow-hidden">
 <CardHeader className="pb-3 border-b border-border bg-secondary/30">
 <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
 <div>
 <CardTitle className="text-base flex items-center gap-2">
 <Sparkles className="h-4 w-4 text-[hsl(0_100%_40%)]" />
 Capitalization Journey
 </CardTitle>
 <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
 The historical view of your company's capitalization — every round, every valuation step-up, every dilution event, plotted from foundation to today.
 </p>
 </div>
 <Tooltip>
 <TooltipTrigger asChild>
 <Badge variant="outline" className="text-[10px] gap-1.5 cursor-help bg-[hsl(0_100%_40%)]/10 border-[hsl(0_100%_40%)]/40 text-[hsl(0_100%_40%)] self-start md:self-end">
 {/* WAVE 108 · FINDING 2 — was the internal package name. The fact kept is
     that these figures are reconstructed from the ledger rather than typed in. */}
 {/* WAVE 116 · FINDING 2 — the badge claimed more than the panel delivers.
     Composition is reconstructed from RECORDED share counts only; anything
     needing a conversion price is declined rather than modelled. */}
 <Cpu className="h-3 w-3" /> Reconstructed from recorded holdings
 </Badge>
 </TooltipTrigger>
 <TooltipContent className="max-w-xs text-xs">
 Composition snapshots and KPIs are reconstructed from the share counts and amounts recorded against this company, using the same calculations the cap table uses, under United States cap-table conventions. A snapshot that would need a conversion price this platform does not hold is not drawn at all, and says so.
 </TooltipContent>
 </Tooltip>
 </div>
 </CardHeader>

 <CardContent className="space-y-8 p-5">
 {/* Panel 4 — KPI strip (placed top so it's the first thing the eye lands on) */}
 {kpis && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
 {/* WAVE 116 · FINDING 1 — was `fmtUSD(kpis.totalRaised)` over the
     writer-less `raisedAmount` column, so it read `$0` for every real
     company. Now the derived subscribed figure, or a sentence. */}
 {companyMoney.determined ? (
 <Kpi icon={Wallet} label={COMPANY_MONEY_SUBSCRIBED_LABEL} value={companyMoney.subscribedDisplay} hint={`across ${companyMoney.roundsCounted} counted round${companyMoney.roundsCounted === 1 ? "" : "s"}`} />
 ) : (
 <div className="rounded-lg border border-border bg-card p-3" data-testid="journey-money-unavailable">
 <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{COMPANY_MONEY_SUBSCRIBED_LABEL}</div>
 <div className="text-xs text-muted-foreground mt-1">{companyMoney.statement}</div>
 </div>
 )}
 <Kpi icon={TrendingUp} label="Latest valuation" value={fmtUSD(kpis.latestValuation, { compact: true })} hint="post-money" />
 {/* WAVE 61a · R47 (closes L-5) — 2 dp. This component is mounted on
     /founder/dashboard immediately above the "Founder ownership" Stat, so the
     same quantity was printed twice on one screen; both are now 2 dp. Display
     precision only: `kpis.founderPct` and its units are untouched (R16). */}
 {/* WAVE 116 · FINDING 3 — the engine's own answer, and the denominator named
     from the one shared label map rather than the loose words "fully diluted". */}
 {/* WAVE 125 · FINDING 1 — when the founder holding is not on record the value is
     the em dash and the hint carries the REASON instead of the denominator. The
     `<Kpi>` sibling shape is unchanged (no element added, none removed), so the
     drop gate still sees the same positional children. */}
 <Kpi icon={PieIcon} label="Founder ownership" value={`${kpis.founderPctText}${kpis.founderPctText === OWNERSHIP_UNDEFINED ? "" : "%"}`} hint={kpis.founderHoldingStatement ?? `of ${VIEW_DENOMINATOR_LABEL.fully_diluted}`} />
 <Kpi icon={Users} label="Cap-table holders" value={kpis.investorCount} hint="founders + investors + pool" />
 </div>
 )}

 {/* Panel 1 — Round Timeline + Valuation curve */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold">Round timeline · Pre-money valuation</h3>
 <span className="text-[11px] text-muted-foreground">hover any point</span>
 </div>
 <div className="h-72 -ml-3">
 <ResponsiveContainer width="100%" height="100%">
 <ComposedChart data={valuationSeries} margin={{ top: 10, right: 24, bottom: 4, left: 12 }}>
 <defs>
 <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
 <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.35} />
 <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
 <XAxis dataKey="closeDate" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
 <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUSD(v, { compact: true })} />
 <RcTooltip content={<ValuationTooltip />} />
 <Area type="monotone" dataKey="preMoney" stroke="none" fill="url(#valGrad)" />
 <Line
 type="monotone"
 dataKey="preMoney"
 stroke={COLORS.primary}
 strokeWidth={2.5}
 dot={(props: any) => {
 const { cx, cy, payload, index } = props;
 const isLatest = index === valuationSeries.length - 1;
 const isClosed = payload.state === "closed";
 return (
 <g key={`dot-${index}`}>
 {isLatest && !isClosed && (
 <circle cx={cx} cy={cy} r={10} fill={COLORS.gold} opacity={0.25}>
 <animate attributeName="r" values="8;14;8" dur="1.8s" repeatCount="indefinite" />
 <animate attributeName="opacity" values="0.35;0.1;0.35" dur="1.8s" repeatCount="indefinite" />
 </circle>
 )}
 <circle cx={cx} cy={cy} r={5} fill={isClosed ? COLORS.primary : COLORS.gold} stroke="white" strokeWidth={2} />
 </g>
 );
 }}
 activeDot={{ r: 7, fill: COLORS.gold, stroke: "white", strokeWidth: 2 }}
 />
 </ComposedChart>
 </ResponsiveContainer>
 </div>
 <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground mt-2 pl-2">
 <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.primary }} /> Closed rounds</span>
 <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS.gold }} /> Active / planned</span>
 <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3 rounded-full" style={{ backgroundColor: COLORS.primary }} /> Pre-money curve</span>
 </div>
 </section>

 {/* Sprint 5 — Cumulative raise + valuation step-up */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold flex items-center gap-2">Cumulative capital raised + valuation step-up
 <Badge variant="outline" className="text-[10px]">M&amp;A signal</Badge>
 </h3>
 <span className="text-[11px] text-muted-foreground">step-up % vs prior round’s post-money</span>
 </div>
 <div className="h-64 -ml-3">
 <ResponsiveContainer width="100%" height="100%">
 <ComposedChart data={valuationSeries} margin={{ top: 10, right: 24, bottom: 4, left: 12 }}>
 <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
 <XAxis dataKey="closeDate" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
 <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUSD(v, { compact: true })} />
 <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUSD(v, { compact: true })} />
 <RcTooltip formatter={(v: any, name: any) => [typeof v === "number" ? fmtUSD(v, { compact: true }) : v, name]} />
 <Bar yAxisId="left" dataKey="cumulativeRaised" fill={COLORS.gold} fillOpacity={0.45} name="Cumulative raised" radius={[4, 4, 0, 0]} />
 <Line yAxisId="right" type="monotone" dataKey="postMoney" stroke={COLORS.primary} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.primary, stroke: "white", strokeWidth: 2 }} name="Post-money valuation" />
 <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
 </ComposedChart>
 </ResponsiveContainer>
 </div>
 <div className="flex flex-wrap gap-2 mt-2">
 {valuationSeries.map((v) => v.stepUp != null && (
 <Badge key={v.id} variant="outline" className={`text-[10px] ${v.stepUp >= 0.5 ? "border-emerald-300/60 text-emerald-700 " : v.stepUp >= 0 ? "border-amber-300/60 text-amber-700 " : "border-rose-300/60 text-rose-700 "}`} data-testid={`stepup-${v.id}`}>
 {v.name}: {(v.stepUp * 100).toFixed(0)}% step-up
 </Badge>
 ))}
 </div>
 <p className="text-[11px] text-muted-foreground mt-1 pl-2">
 Step-up = (this round’s pre-money) / (prior round’s post-money) − 1. Bessemer-style markups: ≥ 50% is healthy; 0–50% is flat; negative is a down-round and triggers anti-dilution clauses.
 </p>
 </section>

 {/* Panel 2 — Ownership Composition Over Time */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold">Ownership composition over time</h3>
 <span className="text-[11px] text-muted-foreground">{compositionData.length} snapshot{compositionData.length === 1 ? "" : "s"}</span>
 </div>
 {/* WAVE 116 · FINDINGS 2 AND 3 — the chart names its denominator, and every
     snapshot it declined to draw says so in a sentence instead of vanishing. */}
 <p className="text-[11px] text-muted-foreground mb-2" data-testid="journey-composition-denominator">
 Each band is a {snapshotBuild.denominatorLabel}.
 </p>
 {snapshotBuild.refusals.length > 0 && (
 <div className="mb-2 space-y-1 rounded-md border border-border bg-muted/30 p-2" data-testid="journey-composition-refusals">
 {snapshotBuild.refusals.map((ref) => (
 <p key={ref.roundId} className="text-[11px] text-muted-foreground" data-testid={`journey-composition-refusal-${ref.roundId}`}>
 {ref.statement}
 </p>
 ))}
 </div>
 )}
 <div className="h-72 -ml-3">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={compositionData} margin={{ top: 10, right: 24, bottom: 4, left: 12 }} stackOffset="expand">
 <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
 <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
 <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
 <RcTooltip content={<CompositionTooltip />} />
 {INSTRUMENT_ORDER.map((k) => (
 <Area
 key={k}
 type="monotone"
 dataKey={k}
 stackId="1"
 stroke={INSTRUMENT_COLOR[k]}
 fill={INSTRUMENT_COLOR[k]}
 fillOpacity={0.85}
 name={INSTRUMENT_LABEL[k]}
 />
 ))}
 {compositionData.map((d, i) => (
 <ReferenceLine key={`rl-${i}`} x={d.date} stroke="hsl(var(--border))" strokeDasharray="2 2" />
 ))}
 <Legend wrapperStyle={{ fontSize: 11 }} iconSize={10} />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 <p className="text-[11px] text-muted-foreground mt-1 pl-2">
 Founders' band shrinks at each round close — the visualization of dilution as you trade equity for capital.
 </p>
 </section>

 {/* Panel 3 — Round-by-round card carousel */}
 <section>
 <div className="flex items-baseline justify-between mb-2">
 <h3 className="text-sm font-semibold">Round-by-round</h3>
 <span className="text-[11px] text-muted-foreground">scroll horizontally · click for detail</span>
 </div>
 <ScrollArea className="w-full whitespace-nowrap rounded-md">
 <div className="flex gap-4 pb-4 pt-1 px-1 relative">
 {/* connecting line */}
 <div className="absolute top-12 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" aria-hidden />
 {valuationSeries.map((r, idx) => {
 const isClosed = r.state === "closed";
 /* WAVE 120 · FINDING 3 — was `snapshots[idx - 1]` / `snapshots[idx]` with a
    literal `100` for the first card, where `idx` indexed a DIFFERENT and longer
    array than `snapshots`. Now looked up by THIS round's id; see the block
    comment above `journeyCardOwnership`. */
 const founderOwnership = journeyCardOwnership(snapshotBuild, r.id);
 const days = r.openDate && r.closeDate
 ? Math.max(0, Math.round((new Date(r.closeDate).getTime() - new Date(r.openDate).getTime()) / 86400000))
 : null;
 return (
 <Link key={r.id} href={`/founder/rounds/${r.id}`}>
 <div className="w-[280px] shrink-0 cursor-pointer relative" data-testid={`journey-card-${r.id}`}>
 {/* timeline dot */}
 <div className="flex justify-center mb-2 relative z-10">
 <div className={`h-4 w-4 rounded-full border-4 border-background ${isClosed ? "bg-[hsl(0_100%_40%)]" : "bg-[#D4A857]"}`} />
 </div>
 <div className="bg-card border border-border rounded-lg p-4 hover-elevate space-y-2.5">
 <div className="flex items-center justify-between gap-2">
 <span className="font-semibold text-sm truncate">{r.name}</span>
 <Badge variant="outline" className="text-[10px] capitalize shrink-0">{r.type.replace(/_/g, " ")}</Badge>
 </div>
 <div className="text-[11px] text-muted-foreground">{r.closeDate ? fmtDate(r.closeDate) : "—"}</div>
 <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-border/60">
 <div>
 <div className="text-muted-foreground">Pre-money</div>
 <div className="font-mono tabular-nums font-medium">{r.preMoney ? fmtUSD(r.preMoney, { compact: true }) : "—"}</div>
 </div>
 <div>
 <div className="text-muted-foreground">Post-money</div>
 <div className="font-mono tabular-nums font-medium">{r.postMoney ? fmtUSD(r.postMoney, { compact: true }) : "—"}</div>
 </div>
 <div>
 {/* WAVE 116 · FINDING 1 — was `fmtUSD(r.raisedAmount)`. */}
 <div className="text-muted-foreground">Subscribed</div>
 <div className="font-mono tabular-nums font-medium" data-testid={`journey-card-money-${r.id}`}>{r.subscribedDisplay ?? "—"}</div>
 </div>
 <div>
 <div className="text-muted-foreground">Days open</div>
 <div className="font-mono tabular-nums font-medium">{days != null ? `${days}d` : "—"}</div>
 </div>
 </div>
 {(r as any).leadInvestor && (
 <div className="text-[11px] pt-2 border-t border-border/60">
 <div className="text-muted-foreground">Lead</div>
 <div className="font-medium truncate">{(r as any).leadInvestor}</div>
 {(r as any).investorCount != null && (
 <div className="text-[10px] text-muted-foreground">{(r as any).investorCount} investor{(r as any).investorCount === 1 ? "" : "s"}</div>
 )}
 </div>
 )}
 {/* Sprint 5 — time-to-close + step-up callouts (Carta convention) */}
 {days != null && r.state === "closed" && (
 <div className="text-[10px] pt-1.5 border-t border-border/60 flex items-center justify-between">
 <span className="text-muted-foreground">Time-to-close</span>
 <Badge variant="outline" className="text-[10px]">{days}d</Badge>
 </div>
 )}
 {(r as any).stepUp != null && (
 <div className="text-[10px] pt-1 flex items-center justify-between">
 <span className="text-muted-foreground">Step-up vs prior</span>
 <Badge variant="outline" className={`text-[10px] ${(r as any).stepUp >= 0.5 ? "border-emerald-300/60 text-emerald-700 " : (r as any).stepUp >= 0 ? "border-amber-300/60 text-amber-700 " : "border-rose-300/60 text-rose-700 "}`}>
 {((r as any).stepUp * 100).toFixed(0)}%
 </Badge>
 </div>
 )}
 {founderOwnership.shown ? (
 <div className="text-[11px] pt-2 border-t border-border/60 flex items-center gap-2" data-testid={`journey-card-founders-${r.id}`}>
 <span className="text-muted-foreground">Founders</span>
 <span className="font-mono tabular-nums">{founderOwnership.beforeText}{founderOwnership.beforeIsNumber ? "%" : ""}</span>
 <ArrowRight className="h-3 w-3 text-muted-foreground" />
 <span className="font-mono tabular-nums font-semibold text-[hsl(0_100%_40%)] ">{founderOwnership.afterText}{founderOwnership.afterIsNumber ? "%" : ""}</span>
 </div>
 ) : (
 <div className="text-[10px] pt-2 border-t border-border/60 text-muted-foreground whitespace-normal" data-testid={`journey-card-founders-refused-${r.id}`}>
 {founderOwnership.statement}
 </div>
 )}
 <div className="flex items-center gap-1.5 text-[10px] pt-1">
 <Badge variant="outline" className={`text-[10px] capitalize ${isClosed ? "bg-emerald-100 text-emerald-900 border-emerald-300/50" : "bg-cyan-100 text-cyan-900 border-cyan-300/50"}`}>
 {r.state.replace(/_/g, " ")}
 </Badge>
 </div>
 </div>
 </div>
 </Link>
 );
 })}
 </div>
 <ScrollBar orientation="horizontal" />
 </ScrollArea>
 </section>
 </CardContent>
 </Card>
 );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: React.ComponentType<any>; label: string; value: string | number; hint?: string }) {
 return (
 <div className="rounded-md border border-border bg-card p-3">
 <div className="flex items-center justify-between">
 <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{label}</span>
 <Icon className="h-3.5 w-3.5 text-muted-foreground" />
 </div>
 <div className="text-xl font-semibold mt-1 font-mono tabular-nums">{value}</div>
 {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
 </div>
 );
}
