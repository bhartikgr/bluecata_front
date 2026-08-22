/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 92 — THE EXIT WATERFALL. THE SCREEN THREE WAVES OF MONEY WORK WERE WAITING FOR.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG, IN ONE PARAGRAPH.
 *
 * `GET /api/founder/captable/waterfall` is the one place in Capavate that answers
 * "on a sale at this price, what does each shareholder actually receive?" A
 * read-only audit of the LIVE site searched all four portals and found NO exit,
 * waterfall, liquidation or distributions screen anywhere; the glossary returned 0
 * results for "waterfall" and 0 for "distribution"; and the endpoint had ZERO
 * client callers, confirmed from three directions
 * (`spec/PREFLIGHT_WATERFALL_2026_08_21.md` §3.4). Four places in the founder area
 * PROMISED this output and none of them delivered it.
 *
 * Meanwhile three waves corrected the arithmetic behind it:
 *   · WAVE 88 fixed 48 wrong figures, including a $10,000,000 SAFE holder shown $0
 *     and never named, and added the third leg and the per-holder split.
 *   · WAVE 91 made equally-ranked classes compute and abate PRO RATA — $6,000,000
 *     and $3,000,000 where the platform used to pay $9,000,000 and nothing — and
 *     stopped a holder paid $0 from being ABSENT from the answer.
 *   · WAVE 94 made a recorded participation cap reach the engine (766 of 4,000
 *     fixtures published a wrong figure without it; 556 underpaid the founders;
 *     largest single error $32,129,870.13) and redistributed what a binding cap
 *     releases to everybody still entitled to share.
 *
 * NONE OF IT COULD BE SEEN OR TESTED THROUGH THE PRODUCT. This file is what makes
 * it real.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIVE RULES THIS SCREEN IS BUILT ON, AND WHY EACH ONE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. EVERY HOLDER APPEARS, INCLUDING ONE RECEIVING $0. The sacred engine's Step 2
 *    is gated on `sharesInPool > 0n && remaining.gt(0)`, so on a short exit it
 *    emits NO ROW for a common holder rather than a `$0` row. Wave 91 fixed that on
 *    the wire by driving `byCommonHolder[]` and `byShareClass[]` from the CAP TABLE
 *    instead of from the payout rows. This screen renders those lists whole, and it
 *    renders `"0"` as a FIGURE. **Being told you receive nothing is a fact. Being
 *    absent is a defect** — a reader cannot tell "nothing" from "not considered",
 *    and that is exactly the defect Wave 88 removed from the other side.
 *
 * 2. NO HARDCODED VALUE, ANYWHERE. Every figure, name, share count, multiple, cap,
 *    rank, factor and reason on this page comes from the response. The only
 *    client-side constants are COPY and the column headings. There is no money
 *    literal, no percentage literal, no class name and no sample row in this file,
 *    and `W92-S-02` polices that as source text.
 *
 * 3. NO DEAD CONTROLS. Every control does something real. There is no disabled
 *    button, no "coming soon", and no filter that filters nothing. This is the
 *    class of defect Wave 80 found four times in the wizards and Wave 94 found a
 *    fifth of by accident, and it is not being reintroduced by the screen built to
 *    expose their work. `preferredReturnPct` is deliberately NOT offered: it is an
 *    SPV-style preferred RETURN, not a liquidation multiple, and Wave 71 · D11
 *    severed that confusion once already.
 *
 * 4. A REFUSAL IS AN ANSWER WITH A TO-DO LIST, NOT AN ERROR. When the endpoint
 *    cannot publish a figure it says so and names the facts it needs. This screen
 *    renders that calmly, in the server's own plain English, with the missing facts
 *    as a checklist and a working link to the place each one is recorded — and it
 *    keeps showing everything that IS known. A refusal on one note class must not
 *    blank a page that can still tell a founder what the preferred and the common
 *    receive.
 *
 * 5. THE SCREEN NEVER RENDERS A MACHINE IDENTIFIER, AND IT NEVER SWITCHES ON ONE.
 *    R77 and `R67F-17`. See the long block above `RefusalPanel` — this is the part
 *    of the design most likely to be got wrong and it is argued rather than
 *    asserted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HAZARDS THIS FILE RESPECTS, NAMED SO A LATER READER CANNOT MISS THEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * · R69 — `computeConversionProjections` (`server/roundCarryForwardEngine.ts`) is
 *   DEAD CODE and must NEVER be edited. FOUR agents have proposed editing it and
 *   ALL FOUR WERE WRONG. This screen RENDERS EXIT CONVERSIONS, which is precisely
 *   where that trap lives. It is not imported here, not called here, and no figure
 *   on this page comes from it. Every conversion figure on this screen arrives from
 *   `byShareClass[]` / `byConvertible[]` on the response, which the route produces
 *   through the SACRED `computeWaterfall`. The projections / round-math path uses a
 *   HARDCODED seniority (`shared/roundMathEngineAdapter.ts:1962` sets `seniority: 0`
 *   on every preferred class) and does NOT compute an exit waterfall — so it is not
 *   a second source of truth for anything on this page, and nobody should later
 *   "fix" it into one (R21, and the pre-flight's §7.3 documentation obligation).
 *
 * · THE MATHS IS NOT CHANGED BY THIS FILE. It cannot be: nothing here computes
 *   money. The one arithmetic this screen performs is DISPLAY ROUNDING, in
 *   `client/src/lib/exactMoney.ts`, which states its convention and never touches a
 *   figure that goes back to the server.
 *
 * · NO `Number()` ON A MONEY STRING (R72 condition 4). Money arrives as exact
 *   decimal TEXT and is handed to `exactMoney` as text. `client/src/lib/moneyDisplay.ts`
 *   is deliberately NOT used for these figures — it takes a `number`, which is the
 *   narrowing open item J-1 was opened about.
 *
 * · `client/src/pages/founder/Billing.tsx` is NOT opened, NOT imported and NOT
 *   referenced. R80.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN — LEDGER, FROM THE START
 * ─────────────────────────────────────────────────────────────────────────────
 * The founder area was restyled to Ledger by Waves 2D+3D and 96, so this screen is
 * built IN that system rather than restyled into it later. It uses plain semantic
 * `table` / `thead th` / `h1` markup and the shared `Card` primitives, which is
 * what `client/src/styles/ledger-founder.css` already dresses: 14px base, 20px navy
 * sans page title, uppercase table headers at `min(12px, 1em)`, 6px corners with
 * the pill kept for status only, `#E5EAF0` cool hairlines, and `tabular-nums
 * lining-nums` on the whole area so a money column's decimal points stack.
 *
 * `min(12px, 1em)` IS LOAD-BEARING AND IT IS INHERITED, NOT RE-DECLARED. Wave 96
 * fixed exactly this: a hard `12px` on table headers pushed a cap table's last
 * column and three ownership subtotals OFF SCREEN, the automated instrument said
 * everything was fine, and **it was found by looking at a screenshot.** This file
 * therefore sets NO font-size on any `th` — the stylesheet's rule, which can only
 * ever make a header smaller, applies. `W92-S-05` pins that no hard header size is
 * introduced here.
 */
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { useActiveCompanyId } from "@/lib/useActiveCompany";
import { describeRawActor, looksLikeRawKey } from "@/lib/actorLabel";
import {
  EXACT_MONEY_UNAVAILABLE,
  displayIsRounded,
  displayRowsSummingTo,
  formatExactFactorAsPercent,
  formatExactMinor,
  isExactDecimalText,
  majorTextToExactMinor,
} from "@/lib/exactMoney";
/* DELIBERATELY NOT LINKED TO THE GLOSSARY. The pre-flight's read-only audit of the
   LIVE site measured the glossary returning ZERO results for "waterfall" and ZERO
   for "distribution". A glossary link on this screen would therefore be a link to
   nothing — the fifth dead promise, added by the wave built to remove four of them.
   Reported as an owner question (`OQ-W92-3`) instead: the glossary needs an entry,
   and inventing one here would put a definition of an exit waterfall in a page
   component rather than in the glossary that owns it (R21). */

/* ════════════════════════════════════════════════════════════════════════════
   THE RESPONSE, TYPED. EVERY FIELD THIS SCREEN READS AND NOTHING IT DOES NOT.
   ════════════════════════════════════════════════════════════════════════════
   Wave 88's discipline: every key below is ALWAYS PRESENT on a 200, so this screen
   never has to tell "none" apart from "an older build". Money is exact decimal
   TEXT — `string`, never `number` — which is open item J-1's resolution (R72) and
   the reason `client/src/lib/exactMoney.ts` exists. */
type PrefRow = {
  classId: string;
  className: string;
  proceeds: string;
  proceedsExact: string;
  decision: string;
  engineDecision: string | null;
  emittedByEngine: boolean;
  seniority: number | null;
  seniorityOnRecord: boolean;
  participatingOnRecord: boolean | null;
  liquidationPreferenceMultiple: number | null;
  investedMinor: string;
  claimMinor: string;
  abated: boolean;
};

type ConvertibleRow = {
  roundId: string;
  className: string;
  instrument: string | null;
  holderName: string | null;
  holderId: string | null;
  convention: string | null;
  purchaseAmountMinor: string | null;
  valuationCapMinor: string | null;
  convertedShares: string | null;
  convertedSharesUnrounded: string | null;
  cashOutFloorMinor: string | null;
  election: string | null;
  electionBasis: string | null;
  proceeds: string;
  conversionBasis: string | null;
};

type CommonRow = {
  holderId: string;
  holderName: string;
  shares: string | null;
  proceeds: string;
  decision: string;
  emittedByEngine: boolean;
  basis: string | null;
};

type ExcludedRow = {
  roundId?: string;
  className?: string;
  instrument?: string | null;
  committedAmountMinor?: string | null;
  reason?: string | null;
  missingFacts?: string[];
};

type CapClass = {
  roundId: string;
  className: string;
  onRecord: boolean;
  capMultiple: number | null;
  source: string | null;
  inert: boolean;
  capAmountMinor: string | null;
};

type Tier = {
  seniority: number;
  classes: Array<{ classId: string; className: string; claimMinor: string }>;
  tierClaimMinor: string;
  availableMinor: string;
  abated: boolean;
  abatementFactor: string | null;
};

type WaterfallOk = {
  ok: true;
  lpProceeds: string;
  founderProceeds: string;
  convertibleProceeds: string;
  commonLegProceeds: string;
  commonLegShares: string;
  remainder: string;
  byShareClass: PrefRow[];
  byConvertible: ConvertibleRow[];
  byCommonHolder: CommonRow[];
  excludedFromPayout: ExcludedRow[];
  nonPreferenceClasses: ExcludedRow[];
  convertibleCashOutBasis: string | null;
  seniority: Array<{ roundId: string; className: string; seniority: number | null; onRecord: boolean }>;
  seniorityAssumed: string | null;
  pariPassu: {
    equalRankingDetected: boolean;
    duplicateRanks: number[];
    abatementEngaged: boolean;
    availableToPreferenceStackMinor: string;
    tiers: Tier[];
    precisionCeiling: string;
    basis: string;
  };
  participationCaps: {
    anyOnRecord: boolean;
    classes: CapClass[];
    capBound: string[];
    capForcedConversion: string[];
    releasedExcessMinor: string;
    releasedExcessRedistributed: boolean;
    conservationExact: boolean;
    conservationResidualMinor: string;
    residualSharedMinor: string | null;
    residualPricePerShareMinor: string | null;
    precisionCeiling: string;
    basis: string;
  };
};

/** What the screen holds after a refusal. NOTE that the machine identifier is
    carried but NEVER rendered and NEVER compared against a literal — see the
    block above `RefusalPanel`. */
type WaterfallRefusal = {
  ok: false;
  status: number;
  /** Carried so it reaches the browser's network tab and a support conversation.
   *  R77: a machine-readable value no user reads is not a defect. */
  identifier: string | null;
  message: string | null;
  missingFacts: string[];
  classesMissingSeniority: Array<{ roundId: string; className: string }>;
  duplicateRanks: number[];
  className: string | null;
  roundId: string | null;
};

type Answer = WaterfallOk | WaterfallRefusal;

/* ════════════════════════════════════════════════════════════════════════════
   PLAIN ENGLISH FOR THE FACTS THE SERVER NAMES AS MISSING.
   ════════════════════════════════════════════════════════════════════════════
   `missingFacts[]` carries FIELD NAMES, which is right — a machine-readable list
   is what a payload should carry (R77). But a founder cannot act on
   `change_of_control_repayment_multiple`, and rendering it would breach the
   internal-language fence. So each one is translated here, once, in the words a
   founder would use, WITH the thing they would go and do about it.

   These are OBJECT KEYS, which the internal-language fence classifies as code
   rather than copy, and the fence's own documentation draws that line explicitly.
   An unrecognised fact falls back to a sentence that says a fact is missing
   WITHOUT printing its name — never to the raw token, because a token a founder
   cannot read is worse than an honest "we need one more detail from you". */
const FACT_COPY: Record<string, { what: string; how: string }> = {
  exit_date: {
    what: "The date the sale is expected to complete.",
    how: "A convertible note earns interest up to the closing date, so its payout cannot be computed without one.",
  },
  day_count_convention: {
    what: "How interest days are counted on the note — for example 30/360, or actual/365.",
    how: "It is recorded on the note's own terms, and different conventions give different interest.",
  },
  change_of_control_repayment_multiple: {
    what: "Any repayment multiple the note carries on a change of control.",
    how: "Some notes repay 1x on a sale and some repay more; without the figure the note's claim cannot be fixed.",
  },
  valuationCap: {
    what: "The valuation cap on the instrument.",
    how: "The cap is what sets the price its money converts at, so there is no share count without it.",
  },
  preMoneyCapitalisation: {
    what: "The company's capitalisation immediately before this instrument converts.",
    how: "Without it there is no price per share to convert the money at.",
  },
  purchaseAmount: {
    what: "The amount actually paid for the instrument.",
    how: "It is the numerator of the conversion, so a blank one converts to nothing.",
  },
  mfn: {
    what: "Whether this instrument carries a most-favoured-nation term.",
    how: "An MFN instrument takes the best terms granted to any later instrument, which changes what it converts at.",
  },
  convertible_cash_out_ranking: {
    what: "Which convertible is repaid first when the sale cannot repay them all.",
    how: "No ranking between convertible money-back claims is recorded anywhere on this platform yet.",
  },
  committed_share_count: {
    what: "The number of shares this commitment represents.",
    how: "The round is committed but the share count has not been recorded on the cap table.",
  },
  seniority: {
    what: "Which preference class is paid first at an exit.",
    how: "Record it on each round's terms. Classes given the same position rank equally and share a shortfall in proportion to what they are owed.",
  },
};

/* ════════════════════════════════════════════════════════════════════════════
   THE COLUMN HEADINGS AND THE COPY. THE ONLY CONSTANTS ON THIS SCREEN.
   ════════════════════════════════════════════════════════════════════════════ */
const COPY = {
  title: "Exit Waterfall",
  description:
    "Type a sale price and see, line by line and by name, what every shareholder, every preference class and every convertible receives — with the negotiated term each figure rests on printed beside it.",
  priceLabel: "Sale price",
  priceHint: "The whole-company sale price, in the cap table's currency.",
  compute: "Show the split",
  clear: "Clear",
  emptyHeading: "Enter a sale price",
  emptyBody:
    "Nothing is calculated until you enter a price. Every figure on this page is then computed from your own cap table and the terms recorded on each round — there are no sample numbers here.",
  refusalHeading: "Capavate cannot publish a figure for this sale yet",
  refusalLead:
    "This is not an error, and nothing is wrong with your cap table. One or more facts the calculation depends on are not on record, so rather than print a number we cannot stand behind, here is exactly what is needed.",
  genericRefusal:
    "The calculation could not be completed for this sale price. Nothing has been changed on your cap table.",
  sessionRefusal:
    "Your session has ended. Sign in again and the calculation will run against the same cap table.",
  ownershipRefusal:
    "This company is not on your account, so its cap table cannot be read here.",
  unavailableRefusal:
    "The calculation is temporarily unavailable. Nothing has been changed on your cap table; try again in a moment.",
  badPrice:
    "Enter the sale price as a plain amount — for example a whole number of dollars, or dollars and cents. Commas are fine.",
  excludedFallback:
    "This holding is not part of the split above. Either it carries no liquidation preference — so it is paid with the common shares rather than ahead of them — or a fact the calculation needs is not on record. Anything missing is listed beneath.",
  displayNote:
    "Figures are displayed to the nearest cent. The exact unrounded value the calculation produced is shown beside any figure that has been shortened, and where a column has to add up the cents are allocated by largest remainder so the rows always sum to the total shown.",
};

/* ════════════════════════════════════════════════════════════════════════════
   WOULD RENDERING THIS SERVER MESSAGE LEAK AN INTERNAL IDENTIFIER?
   ════════════════════════════════════════════════════════════════════════════
   The pre-flight verified something load-bearing for this screen: NO refusal
   message on `handleWaterfall` contains a machine token. Every `message:` /
   `reason:` string in `server/track1Routes.ts` was parsed for `snake_case`
   identifiers and the only three in the whole file are outside the handler
   (`spec/PREFLIGHT_WATERFALL_2026_08_21.md` §3.3). So `message` may be rendered
   VERBATIM, which is far better than paraphrasing it here — a paraphrase is a
   second source of truth that drifts (R21), and these messages are long, careful,
   founder-readable prose that Wave 88, 91 and 94 wrote deliberately.

   BUT ONE OF THEM IS NOT PROSE, AND THIS IS A FINDING WAVE 92 REPORTS.
   `WATERFALL_COMPUTE_ERROR` carries `message: (err as Error).message` — an
   EXCEPTION STRING from inside the engine, at three sites. That is not curated
   copy and it can say anything at all. The pre-flight's verification was of the
   literal message strings in the file and correctly did not cover it.

   So verbatim rendering is GATED rather than assumed. A message is rendered only
   if it looks like the prose it is supposed to be: long enough to be a sentence,
   free of any `snake_case` or SCREAMING_SNAKE token, free of a stack frame, free of
   a file path, and free of the word that starts a thrown error. Anything else falls
   back to this screen's own copy. That keeps R77 and the internal-language fence
   true even if a future refusal message regresses, which a plain "render it
   verbatim" would not. */
export function isRenderableRefusalMessage(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const m = message.trim();
  if (m.length < 40) return false;
  /* A machine token: two or more word groups joined by `_`, in either case. */
  if (/[A-Za-z0-9]+_[A-Za-z0-9]+/.test(m)) return false;
  /* ── AND A FIELD NAME, WHICH IS THE ONE THE FIRST SCREENSHOT CAUGHT. ────────
     The first build of this screen rendered `nonPreferenceClasses[].reason`
     through this gate and it PASSED, because the sentence contains no
     `snake_case`. The screenshot then showed a founder the words
     `byCommonHolder`, `commonLegProceeds` and `founderProceeds` — API field
     names — inside a panel on their exit screen.

     THE INTERNAL-LANGUAGE FENCE COULD NOT HAVE CAUGHT IT, and that is worth
     recording: the fence sees LITERALS under `client/src`, and it says so in its
     own documented "KNOWN LIMIT" — a token that arrives through an API response
     is invisible to it. This gate is the complement, on the reading side.

     So a message is also refused when it contains a BACKTICK (this project's
     server prose quotes identifiers in backticks) or a bare `camelCase`
     identifier. `1x`, `2x`, ordinary sentences and every curated refusal message
     on this route survive both tests — `W92-B-03` and `W92-R-07` prove it. */
  if (m.includes("`")) return false;
  if (/\b[a-z]+[A-Z][A-Za-z]*\b/.test(m)) return false;
  /* A stack frame, a source path, or a bare thrown-error prefix. */
  if (/\bat\s+\S+\s*\(/.test(m)) return false;
  if (/[\w-]+\.(ts|tsx|js|mjs|cjs):\d+/.test(m)) return false;
  if (/^[A-Z][A-Za-z]*Error\b/.test(m)) return false;
  return true;
}

/** A holder label a founder can read. `byCommonHolder[].holderName` is populated
 *  from the holder's own id on this response, and Wave 93 found a founder reading
 *  `u_redeemed_1782888492403` in a Holder column on the cap table. The same guard
 *  is applied here rather than a second one invented: it DESCRIBES rather than
 *  blanks, and the id remains available as a machine-readable value (R77). */
function holderLabel(name: unknown, id: unknown): string {
  const n = String(name ?? "").trim();
  if (n && !looksLikeRawKey(n)) return n;
  const raw = String(id ?? n ?? "").trim();
  return raw ? describeRawActor(raw) : COPY.emptyHeading;
}

/* ════════════════════════════════════════════════════════════════════════════
   CELL PADDING — FOUND BY LOOKING AT A SCREENSHOT, WHICH IS THE POINT.
   ════════════════════════════════════════════════════════════════════════════
   The first draft of this screen used bare `<th>` / `<td className={TD_L}>` and relied on the
   founder stylesheet for everything. Every automated check passed: `tsc` 587, no
   table overflowed, nothing was clipped, headers measured 12px uppercase, the
   rightmost cell edge was 1391px inside a 1440px viewport. Then the screenshot
   was looked at, and adjacent columns were TOUCHING — `4,000,000.00` ran straight
   into `Converted to common`, and `CLAIM` ran into `BASIS IT WAS PAID ON`. On a
   financial table that is not cosmetic: a reader cannot tell where one figure ends
   and the next begins.

   THIS IS EXACTLY WAVE 96's FINDING, ONE WAVE LATER. Wave 96's hard `12px` header
   pushed a cap table's last column and three ownership subtotals OFF SCREEN with
   every instrument green, and it was found by looking at a picture. The
   instruments here measured overflow and clipping, which is what they were built
   for, and neither of those is what was wrong.

   The values are the Ledger design system's own — `--ds-cell-padding` is
   `8px 12px` — expressed as the utilities this codebase already uses so no shared
   stylesheet is edited (`ledger-founder.css` belongs to Waves 2D+3D and 96).
   NO FONT SIZE IS SET ON A HEADER: the stylesheet's `min(12px, 1em)` rule, which
   can only ever make a header SMALLER, must keep applying. `W92-S-05` pins that. */
const TH_L = "px-3 py-2 text-left align-bottom";
const TH_R = "px-3 py-2 text-right align-bottom";
const TD_L = "px-3 py-2 align-top";
const TD_R = "px-3 py-2 align-top text-right";

/** A share count for display. Grouped in threes, from digit text — never through
 *  `Number()`, because a share count is a `BigInt` quantity everywhere else in this
 *  platform and 8,000,000 today is 8e21 on a cap table that has been through a
 *  stock split. `null` renders as unavailable, never as a zero we do not have. */
function shares(value: unknown): string {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return EXACT_MONEY_UNAVAILABLE;
  const d = value.trim();
  const out: string[] = [];
  for (let i = d.length; i > 0; i -= 3) out.unshift(d.slice(Math.max(0, i - 3), i));
  return out.join(",");
}

/** A figure cell: the rounded value, right-aligned, with the exact value beside it
 *  whenever rounding shortened it. `tabular-nums` comes from the founder
 *  stylesheet, which sets it on the whole area — it is not re-declared per cell. */
function Money({ value, display }: { value: string; display?: string }): JSX.Element {
  const shown = display ?? formatExactMinor(value);
  return (
    <span className="whitespace-nowrap">
      <span>{shown}</span>
      {displayIsRounded(value) && (
        <span
          className="ml-1 text-[color:var(--ds-text-muted)]"
          title={value}
          data-testid="text-exact-figure"
        >
          ({value})
        </span>
      )}
    </span>
  );
}

/** A section panel. Cards, hairlines and 6px corners all come from the shared
 *  `Card` primitive plus the founder stylesheet; nothing is styled ad hoc. */
function Section({
  title,
  children,
  testId,
  note,
}: {
  title: string;
  children: React.ReactNode;
  testId: string;
  note?: string;
}): JSX.Element {
  return (
    <Card className="mb-4" data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="text-[length:var(--ds-text-section)]">{title}</CardTitle>
        {note && <p className="text-[color:var(--ds-text-secondary)]">{note}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   THE REFUSAL PANEL — "AN ANSWER WITH A TO-DO LIST"
   ════════════════════════════════════════════════════════════════════════════
   IT DOES NOT SWITCH ON THE IDENTIFIER, AND THAT IS DELIBERATE.

   `R67F-17` (`server/__tests__/w88_exit_proceeds_per_instrument.test.ts:580`)
   asserts that twelve refusal identifiers, in BOTH cases, appear NOWHERE under
   `client/src` — as a raw text scan, not as a rendered-text scan. A `switch` on
   `error` would therefore put six of those twelve string literals into this file
   and turn that pin red, and the honest reading of the pin is that it is right:
   the LESS this screen knows about the server's identifiers, the fewer ways a
   token can reach an eye.

   So the panel is driven ENTIRELY by the HTTP status and by the payload's own
   shape — the fields that are present — and never by the identifier's value:

     401  → the session copy.             403  → the ownership copy.
     5xx  → the temporarily-unavailable copy.
     422  → the refusal panel: the server's own `message` when it is renderable
            (see `isRenderableRefusalMessage`), the missing facts as a checklist
            translated through `FACT_COPY`, the classes missing a payment order,
            the duplicate ranks, and a working link for each.

   EVERY ONE OF THE 23 NAMED REFUSALS THIS ROUTE CAN RETURN LANDS IN ONE OF THOSE
   FOUR BRANCHES AND RENDERS USEFULLY, because the useful content is the message
   and the named facts rather than the identifier. That is enumerated, refusal by
   refusal, in `build_log/wave92/W92_SCREEN.md`. */
function RefusalPanel({ answer, companyId }: { answer: WaterfallRefusal; companyId: string }): JSX.Element {
  const facts = answer.missingFacts.filter((f) => typeof f === "string" && f.length > 0);
  const seniorityGaps = answer.classesMissingSeniority ?? [];
  const dupes = answer.duplicateRanks ?? [];

  const statusCopy =
    answer.status === 401
      ? COPY.sessionRefusal
      : answer.status === 403
        ? COPY.ownershipRefusal
        : answer.status >= 500
          ? COPY.unavailableRefusal
          : null;

  return (
    <Card
      className="mb-4 border-[color:var(--ds-status-warning)]"
      data-testid="panel-waterfall-refusal"
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-[length:var(--ds-text-section)]">{COPY.refusalHeading}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-[color:var(--ds-text-secondary)]">{COPY.refusalLead}</p>

        {/* THE SERVER'S OWN WORDS, VERBATIM, WHEN THEY ARE PROSE. */}
        {statusCopy !== null ? (
          <p className="mb-3" data-testid="text-refusal-message">{statusCopy}</p>
        ) : isRenderableRefusalMessage(answer.message) ? (
          <p className="mb-3 whitespace-pre-line" data-testid="text-refusal-message">
            {answer.message}
          </p>
        ) : (
          <p className="mb-3" data-testid="text-refusal-message">{COPY.genericRefusal}</p>
        )}

        {answer.className && (
          <p className="mb-3 text-[color:var(--ds-text-secondary)]">
            {`This concerns ${answer.className}.`}
          </p>
        )}

        {/* THE MISSING FACTS, AS A CHECKLIST A FOUNDER CAN ACT ON. */}
        {facts.length > 0 && (
          <div className="mb-3" data-testid="list-missing-facts">
            <div className="mb-1 font-semibold">{`What Capavate needs (${facts.length}):`}</div>
            <ul className="list-disc pl-5">
              {facts.map((f) => {
                const copy = FACT_COPY[f];
                return (
                  <li key={f} className="mb-1">
                    {copy ? (
                      <>
                        <span className="font-medium">{copy.what}</span>{" "}
                        <span className="text-[color:var(--ds-text-secondary)]">{copy.how}</span>
                      </>
                    ) : (
                      <span>
                        One further detail is needed on this instrument's recorded terms before
                        its payout can be computed. Open the round to see which fields are blank.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* THE CLASSES WITH NO PAYMENT ORDER RECORDED. */}
        {seniorityGaps.length > 0 && (
          <div className="mb-3" data-testid="list-missing-seniority">
            <div className="mb-1 font-semibold">
              {`Classes with no payment order recorded (${seniorityGaps.length}):`}
            </div>
            <ul className="list-disc pl-5">
              {seniorityGaps.map((c) => (
                <li key={c.roundId} className="mb-1">
                  <Link
                    href={`/founder/rounds/${encodeURIComponent(c.roundId)}`}
                    className="underline"
                    data-testid={`link-set-payment-order-${c.roundId}`}
                  >
                    {c.className}
                  </Link>
                  {" — "}
                  <span className="text-[color:var(--ds-text-secondary)]">{FACT_COPY.seniority.how}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {dupes.length > 0 && (
          <p className="mb-3" data-testid="text-duplicate-ranks">
            {`Two or more classes share the same position in the payment order (${dupes.join(", ")}). Classes that rank equally is a legitimate and common arrangement, and Capavate computes it: when the sale price cannot cover everything they are owed, each takes a share in proportion to its own claim.`}
          </p>
        )}

        {/* A WORKING CONTROL, ALWAYS. "No dead promises."

            `Button asChild` WRAPPING the link, not a `Button` nested INSIDE a
            `Link`. The nested form puts an interactive `<button>` inside an
            interactive `<a>`, which the reachability gate and
            `lint:no-button-in-link` both refuse, and rightly: it is invalid HTML
            and a screen reader announces two controls where there is one. `asChild`
            renders the anchor ITSELF with the button's styling, so there is exactly
            one focusable element. This is the pattern `founder/Company.tsx:189` and
            `founder/Dataroom.tsx:334` already use. */}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" data-testid="button-open-rounds">
            <Link href="/founder/rounds">Open Rounds to record the missing terms</Link>
          </Button>
          <Button asChild variant="outline" data-testid="button-open-captable">
            <Link href={`/founder/captable?companyId=${encodeURIComponent(companyId)}`}>
              Open the cap table
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** A refusal body, normalised. THE IDENTIFIER IS CARRIED AND NEVER COMPARED
 *  AGAINST A LITERAL — see the block above `RefusalPanel`. Every list defaults to
 *  empty rather than undefined, so the panel never has to tell "none" apart from
 *  "an older build" (Wave 88's rule, applied on the reading side). */
function asRefusal(status: number, body: Record<string, unknown>): WaterfallRefusal {
  return {
    ok: false,
    status,
    identifier: typeof body.error === "string" ? body.error : null,
    message: typeof body.message === "string" ? body.message : null,
    missingFacts: Array.isArray(body.missingFacts) ? (body.missingFacts as string[]) : [],
    classesMissingSeniority: Array.isArray(body.classesMissingSeniority)
      ? (body.classesMissingSeniority as Array<{ roundId: string; className: string }>)
      : [],
    duplicateRanks: Array.isArray(body.duplicateRanks) ? (body.duplicateRanks as number[]) : [],
    className: typeof body.className === "string" ? body.className : null,
    roundId: typeof body.roundId === "string" ? body.roundId : null,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE SCREEN.
   ════════════════════════════════════════════════════════════════════════════ */
export default function ExitWaterfall(): JSX.Element {
  const companyId = useActiveCompanyId();

  /* The price the founder is TYPING, and the price the answer on screen was
     computed for. They are separate on purpose — see `staleGuard` below. */
  const [priceText, setPriceText] = useState<string>("");
  const [submittedMinor, setSubmittedMinor] = useState<string | null>(null);
  const [submittedPriceText, setSubmittedPriceText] = useState<string>("");
  const [priceRefusal, setPriceRefusal] = useState<string | null>(null);

  const q = useQuery<Answer>({
    queryKey: ["/api/founder/captable/waterfall", companyId, submittedMinor],
    enabled: companyId !== "" && submittedMinor !== null,
    /* A changed sale price must CLEAR the previous answer before the new one
       arrives, or a founder reads last scenario's figures under this scenario's
       heading. `placeholderData` is deliberately not used and the query key
       carries the price, so the cache cannot serve a different scenario's body. */
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const url =
        `/api/founder/captable/waterfall?companyId=${encodeURIComponent(companyId)}` +
        `&exitValuationMinor=${encodeURIComponent(String(submittedMinor))}`;
      try {
        const res = await apiRequest("GET", url);
        const body = (await res.json()) as Record<string, unknown>;
        if (body.ok === true) return body as unknown as WaterfallOk;
        /* A 200 that is not `ok` cannot happen on this route today, but a screen
           that assumed it could not would render an empty answer if it ever did. */
        return asRefusal(res.status, body);
      } catch (e) {
        /* A REFUSAL IS NOT AN EXCEPTION, AND THIS IS WHERE THAT IS DECIDED.
           `apiRequest` throws an `ApiError` on any non-2xx, which is right for a
           mutation and wrong here: on this route a 422 is the SERVER'S ANSWER, with
           the facts it needs attached, and the whole point of this screen is that a
           refusal is an answer with a to-do list rather than an error. So the
           `ApiError`'s parsed `payload` is unwrapped back into the refusal it always
           was, and the panel renders it calmly.

           `apiRequest` is used rather than a bare `fetch` deliberately: `fetch` in a
           page is forbidden (`v15_no_raw_fetch`), and `apiRequest` also carries the
           session cookie and the company-not-found recovery every other founder
           screen relies on. */
        if (e instanceof ApiError) {
          const payload =
            e.payload !== null && typeof e.payload === "object"
              ? (e.payload as Record<string, unknown>)
              : {};
          return asRefusal(e.status, payload);
        }
        throw e;
      }
    },
  });

  const submit = (): void => {
    const minor = majorTextToExactMinor(priceText);
    if (minor === null) {
      setPriceRefusal(COPY.badPrice);
      setSubmittedMinor(null);
      setSubmittedPriceText("");
      return;
    }
    setPriceRefusal(null);
    setSubmittedMinor(minor);
    setSubmittedPriceText(priceText);
  };

  const clear = (): void => {
    setPriceText("");
    setPriceRefusal(null);
    setSubmittedMinor(null);
    setSubmittedPriceText("");
  };

  /* THE STALE GUARD. While the founder is editing the box, the answer on screen
     belongs to a DIFFERENT price, so it is not shown at all. This is the empty
     state doing its job rather than a spinner over stale numbers. */
  const staleGuard = submittedMinor !== null && priceText.trim() !== submittedPriceText.trim();
  const answer: Answer | undefined = q.isFetching || staleGuard ? undefined : q.data;
  const ok = answer !== undefined && answer.ok === true ? (answer as WaterfallOk) : null;

  /* ── DISPLAY ROUNDING, ONCE, AT THE ONE PLACE IT BELONGS (R72 condition 3) ──
     The preference rows, the convertible rows and the common rows are each a
     column that must add up to its own leg total, so each is rounded by largest
     remainder against that total. Nothing here changes a figure: the exact string
     stays on screen beside anything that was shortened. */
  const prefDisplay = useMemo(
    () => displayRowsSummingTo(ok ? ok.byShareClass.map((r) => r.proceeds) : [], ok?.lpProceeds),
    [ok],
  );
  const commonDisplay = useMemo(
    () => displayRowsSummingTo(ok ? ok.byCommonHolder.map((r) => r.proceeds) : [], ok?.commonLegProceeds),
    [ok],
  );
  const convDisplay = useMemo(
    () => displayRowsSummingTo(ok ? ok.byConvertible.map((r) => r.proceeds) : [], ok?.convertibleProceeds),
    [ok],
  );

  return (
    <div data-testid="page-exit-waterfall">
      <PageHeader
        title={COPY.title}
        description={COPY.description}
        breadcrumbs={[{ href: "/founder/captable", label: "Cap Table" }, { label: COPY.title }]}
      />
      <PageBody>
        {/* ── INPUTS. ONE ROW, ALWAYS VISIBLE, NO DEAD CONTROLS. ────────────── */}
        <Card className="mb-4" data-testid="card-waterfall-inputs">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px]">
                <Label htmlFor="exit-price">{COPY.priceLabel}</Label>
                <Input
                  id="exit-price"
                  inputMode="decimal"
                  autoComplete="off"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  data-testid="input-exit-price"
                />
                <p className="mt-1 text-[color:var(--ds-text-muted)]">{COPY.priceHint}</p>
              </div>
              <Button onClick={submit} disabled={false} data-testid="button-compute-waterfall">
                {COPY.compute}
              </Button>
              {(priceText !== "" || submittedMinor !== null) && (
                <Button variant="outline" onClick={clear} data-testid="button-clear-waterfall">
                  {COPY.clear}
                </Button>
              )}
            </div>
            {priceRefusal && (
              <p className="mt-2 text-[color:var(--ds-status-negative)]" data-testid="text-price-refusal">
                {priceRefusal}
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── REAL STATES, NOT SPINNERS OVER STALE NUMBERS. ─────────────────── */}
        {submittedMinor === null && (
          <Card data-testid="panel-waterfall-empty">
            <CardContent className="pt-4">
              <div className="font-semibold">{COPY.emptyHeading}</div>
              <p className="text-[color:var(--ds-text-secondary)]">{COPY.emptyBody}</p>
            </CardContent>
          </Card>
        )}
        {submittedMinor !== null && (q.isFetching || staleGuard) && (
          <Card data-testid="panel-waterfall-loading">
            <CardContent className="pt-4">
              <p>Computing the split for this sale price…</p>
            </CardContent>
          </Card>
        )}

        {answer !== undefined && answer.ok === false && (
          <RefusalPanel answer={answer as WaterfallRefusal} companyId={companyId} />
        )}

        {ok !== null && (
          <>
            {/* ── SECTION 1 — THE ANSWER, IN ONE LINE, AND THE RECONCILIATION. ── */}
            <Section
              title="The split"
              testId="section-waterfall-totals"
              note={COPY.displayNote}
            >
              <p className="mb-3" data-testid="text-waterfall-headline">
                {`On a sale at ${formatExactMinor(submittedMinor)}, the proceeds are split as follows.`}
              </p>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH_L}>Leg</th>
                    <th className={TH_R}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr data-testid="row-leg-preferred">
                    <td className={TD_L}>Preference classes</td>
                    <td className={TD_R}><Money value={ok.lpProceeds} /></td>
                  </tr>
                  <tr data-testid="row-leg-convertible">
                    <td className={TD_L}>Convertibles</td>
                    <td className={TD_R}><Money value={ok.convertibleProceeds} /></td>
                  </tr>
                  <tr data-testid="row-leg-common">
                    <td className={TD_L}>Common shares</td>
                    <td className={TD_R}><Money value={ok.commonLegProceeds} /></td>
                  </tr>
                  <tr data-testid="row-leg-remainder">
                    <td className={TD_L}>Not allocated by the calculation</td>
                    <td className={TD_R}><Money value={ok.remainder} /></td>
                  </tr>
                </tbody>
              </table>

              {/* THE CONSERVATION LINE. PRESENTED HONESTLY, NOT HIDDEN. */}
              <div className="mt-3" data-testid="panel-conservation">
                {ok.participationCaps.conservationExact ? (
                  <p>
                    {`Every leg above, plus anything not allocated, adds to the sale price exactly.`}
                  </p>
                ) : (
                  <p data-testid="text-conservation-residual">
                    {`The legs above add to the sale price to within ${ok.participationCaps.conservationResidualMinor} of the smallest unit of currency. That is not money going missing: one of the prices in this calculation does not terminate as a decimal, and the calculation carries ${ok.participationCaps.precisionCeiling} significant digits before rounding. The residual is published here rather than hidden, and it is smaller than any amount that can be paid.`}
                  </p>
                )}
              </div>
            </Section>

            {/* ── SECTION 2 — PREFERENCE CLASSES, WITH THE BINDING BASIS. ────── */}
            <Section title="Preference classes" testId="section-waterfall-preferred">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH_L}>Class</th>
                    <th className={TH_R}>Invested</th>
                    <th className={TH_R}>Multiple</th>
                    <th className={TH_R}>Claim</th>
                    <th className={TH_L}>Basis it was paid on</th>
                    <th className={TH_L}>Payment order</th>
                    <th className={TH_R}>Receives</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.byShareClass.map((r, i) => {
                    const cap = ok.participationCaps.classes.filter((c) => c.roundId === r.classId)[0];
                    const bound = ok.participationCaps.capBound.indexOf(r.classId) >= 0;
                    const forced = ok.participationCaps.capForcedConversion.indexOf(r.classId) >= 0;
                    return (
                      <tr key={r.classId} data-testid={`row-preferred-${r.classId}`}>
                        <td className={TD_L}>{r.className}</td>
                        <td className={TD_R}><Money value={r.investedMinor} /></td>
                        <td className={TD_R}>
                          {r.liquidationPreferenceMultiple === null
                            ? EXACT_MONEY_UNAVAILABLE
                            : `${r.liquidationPreferenceMultiple}x ${r.participatingOnRecord === true ? "participating" : "non-participating"}`}
                        </td>
                        <td className={TD_R}><Money value={r.claimMinor} /></td>
                        <td className={TD_L}>
                          {/* THE BINDING BASIS, FROM THE RESPONSE, NEVER INFERRED HERE.
                              Preference, as-converted or cap — in the words a founder
                              would use, chosen from what the server published about
                              this row rather than reconstructed from the figure. */}
                          {forced
                            ? "Converted to common — worth more as shares than its capped amount, so it waived its preference"
                            : bound
                              ? "Its participation cap — the ceiling it agreed to"
                              : r.abated
                                ? "Its preference, reduced pro rata because classes ranking equally could not all be paid in full"
                                : r.emittedByEngine
                                  ? "Its recorded preference terms"
                                  : "Nothing reached this class: the claims ranking ahead of it absorbed the whole sale price"}
                          {cap && cap.onRecord && (
                            <div className="text-[color:var(--ds-text-secondary)]" data-testid={`text-cap-${r.classId}`}>
                              {`Participation cap on record: ${cap.capMultiple}x`}
                              {cap.capAmountMinor ? ` (${formatExactMinor(cap.capAmountMinor)})` : ""}
                              {cap.inert
                                ? " — recorded against a class that does not participate, so it cannot bind."
                                : bound
                                  ? " — it bound on this sale price."
                                  : forced
                                    ? " — the class did better by converting, so it converted instead."
                                    : " — it did not bind on this sale price."}
                            </div>
                          )}
                        </td>
                        <td className={TD_L}>
                          {r.seniorityOnRecord
                            ? `Position ${r.seniority}`
                            : "Not recorded"}
                        </td>
                        <td className={TD_R}>
                          <Money value={r.proceeds} display={prefDisplay.rows[i]} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {ok.byShareClass.length === 0 && (
                <p data-testid="text-no-preferred">
                  There are no preference classes on this cap table, so the whole sale price
                  after any convertible claims belongs to the common shares.
                </p>
              )}
              {ok.seniorityAssumed && (
                <p className="mt-2 text-[color:var(--ds-text-secondary)]" data-testid="text-seniority-assumed">
                  {String(ok.seniorityAssumed)}
                </p>
              )}
            </Section>

            {/* ── SECTION 3 — THE ABATEMENT, SHOWN AS AN ABATEMENT. ──────────── */}
            {ok.pariPassu.equalRankingDetected && (
              <Section
                title="Classes that rank equally"
                testId="section-waterfall-pari-passu"
                note={ok.pariPassu.basis}
              >
                <p className="mb-2" data-testid="text-available-to-stack">
                  {`Available to the preference classes on this sale: ${formatExactMinor(ok.pariPassu.availableToPreferenceStackMinor)}.`}
                </p>
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={TH_L}>Position</th>
                      <th className={TH_L}>Classes ranking together</th>
                      <th className={TH_R}>Owed in total</th>
                      <th className={TH_R}>Available to them</th>
                      <th className={TH_R}>Each receives</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ok.pariPassu.tiers.map((t) => {
                      const pct = formatExactFactorAsPercent(t.abatementFactor);
                      return (
                        <tr key={String(t.seniority)} data-testid={`row-tier-${t.seniority}`}>
                          <td className={TD_L}>{`Position ${t.seniority}`}</td>
                          <td className={TD_L}>{t.classes.map((c) => c.className).join(", ")}</td>
                          <td className={TD_R}><Money value={t.tierClaimMinor} /></td>
                          <td className={TD_R}><Money value={t.availableMinor} /></td>
                          <td className="text-right" data-testid={`text-abatement-${t.seniority}`}>
                            {t.abated
                              ? `${pct.text} of its own claim`
                              : "Its claim in full"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {ok.pariPassu.abatementEngaged && (
                  <p className="mt-2" data-testid="text-abatement-explained">
                    {`Because the sale price cannot cover everything these classes are owed, each of them takes the same proportion of its own claim. That is what ranking equally means, and it is why the class listed first takes no advantage from being listed first.`}
                  </p>
                )}
              </Section>
            )}

            {/* ── SECTION 4 — WHAT A BINDING CAP RELEASED, AND WHERE IT WENT. ── */}
            {ok.participationCaps.anyOnRecord && (
              <Section
                title="Participation caps"
                testId="section-waterfall-caps"
                note={ok.participationCaps.basis}
              >
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={TH_L}>Class</th>
                      <th className={TH_R}>Cap</th>
                      <th className={TH_R}>Ceiling</th>
                      <th className={TH_L}>What it did on this sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ok.participationCaps.classes.map((c) => (
                      <tr key={c.roundId} data-testid={`row-cap-${c.roundId}`}>
                        <td className={TD_L}>{c.className}</td>
                        <td className={TD_R}>
                          {c.onRecord && c.capMultiple !== null ? `${c.capMultiple}x` : "None recorded"}
                        </td>
                        <td className={TD_R}>
                          {c.capAmountMinor ? <Money value={c.capAmountMinor} /> : EXACT_MONEY_UNAVAILABLE}
                        </td>
                        <td className={TD_L}>
                          {!c.onRecord
                            ? "No ceiling on this class, so it shares without limit."
                            : c.inert
                              ? "Recorded against a class that does not participate, so it can never bind."
                              : ok.participationCaps.capBound.indexOf(c.roundId) >= 0
                                ? "It bound: the class stopped at its ceiling."
                                : ok.participationCaps.capForcedConversion.indexOf(c.roundId) >= 0
                                  ? "The class was worth more as common than its ceiling, so it converted and is paid as a common holder."
                                  : "It did not bind on this sale price."}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3">
                  <p data-testid="text-released-excess">
                    {`Released by a ceiling on this sale: ${formatExactMinor(ok.participationCaps.releasedExcessMinor)}.`}
                    {" "}
                    {ok.participationCaps.releasedExcessRedistributed
                      ? "It went to everybody still entitled to share — the other participating preference classes as well as the common shares — at one price per share, not to the common shares alone."
                      : "No ceiling bound on this sale price, so there is nothing to redistribute."}
                  </p>
                  {ok.participationCaps.residualPricePerShareMinor && (
                    <p data-testid="text-residual-price">
                      {`The one price per share everybody still sharing was paid at: ${formatExactMinor(ok.participationCaps.residualPricePerShareMinor)}` +
                        (displayIsRounded(ok.participationCaps.residualPricePerShareMinor)
                          ? ` (exactly ${ok.participationCaps.residualPricePerShareMinor} of the smallest unit of currency).`
                          : ".")}
                    </p>
                  )}
                </div>
              </Section>
            )}

            {/* ── SECTION 5 — CONVERTIBLES. ─────────────────────────────────── */}
            <Section title="Convertibles" testId="section-waterfall-convertibles">
              {ok.byConvertible.length === 0 ? (
                <p data-testid="text-no-convertibles">
                  There are no convertible instruments outstanding on this cap table.
                </p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={TH_L}>Holder</th>
                      <th className={TH_L}>Instrument</th>
                      <th className={TH_R}>Paid in</th>
                      <th className={TH_R}>Cap</th>
                      <th className={TH_R}>Shares on conversion</th>
                      <th className={TH_L}>What it took, and why</th>
                      <th className={TH_R}>Receives</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ok.byConvertible.map((c, i) => (
                      <tr key={c.roundId} data-testid={`row-convertible-${c.roundId}`}>
                        <td className={TD_L}>{holderLabel(c.holderName, c.holderId)}</td>
                        <td className={TD_L}>{c.className}</td>
                        <td className={TD_R}>
                          {c.purchaseAmountMinor ? <Money value={c.purchaseAmountMinor} /> : EXACT_MONEY_UNAVAILABLE}
                        </td>
                        <td className={TD_R}>
                          {c.valuationCapMinor ? <Money value={c.valuationCapMinor} /> : EXACT_MONEY_UNAVAILABLE}
                        </td>
                        <td className={TD_R}>
                          {shares(c.convertedShares)}
                          {c.convertedSharesUnrounded && c.convertedSharesUnrounded !== c.convertedShares && (
                            <span className="ml-1 text-[color:var(--ds-text-muted)]">
                              {`(${c.convertedSharesUnrounded})`}
                            </span>
                          )}
                        </td>
                        <td className={TD_L}>{c.electionBasis ?? c.conversionBasis ?? ""}</td>
                        <td className={TD_R}>
                          <Money value={c.proceeds} display={convDisplay.rows[i]} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {ok.convertibleCashOutBasis && (
                <p className="mt-2 text-[color:var(--ds-text-secondary)]" data-testid="text-cashout-basis">
                  {ok.convertibleCashOutBasis}
                </p>
              )}
            </Section>

            {/* ── SECTION 6 — COMMON HOLDERS. EVERY ONE, INCLUDING $0. ──────── */}
            <Section
              title="Common shares"
              testId="section-waterfall-common"
              note={`Total common shares on the cap table: ${shares(ok.commonLegShares)}.`}
            >
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={TH_L}>Holder</th>
                    <th className={TH_R}>Shares</th>
                    <th className={TH_L}>Basis</th>
                    <th className={TH_R}>Receives</th>
                  </tr>
                </thead>
                <tbody>
                  {ok.byCommonHolder.map((h, i) => (
                    <tr key={h.holderId} data-testid={`row-common-${h.holderId}`}>
                      <td className={TD_L}>{holderLabel(h.holderName, h.holderId)}</td>
                      <td className={TD_R}>{shares(h.shares)}</td>
                      <td className={TD_L}>
                        {/* A HOLDER PAID NOTHING IS SHOWN RECEIVING NOTHING, WITH THE
                            REASON IN THE SERVER'S OWN WORDS. BEING ABSENT IS THE DEFECT. */}
                        {h.basis ?? "Its pro-rata share of what reached the common shares."}
                      </td>
                      <td className={TD_R}>
                        <Money value={h.proceeds} display={commonDisplay.rows[i]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ok.byCommonHolder.length === 0 && (
                <p data-testid="text-no-common">
                  No common holders are recorded on this cap table.
                </p>
              )}
            </Section>

            {/* ── SECTION 7 — WHAT WAS NOT PAID, AND WHY. NEVER COLLAPSED. ──── */}
            <Section
              title="Not included in this split"
              testId="section-waterfall-excluded"
              note="A disclosed exclusion is a stated limitation. A silent zero is not, and there are none on this page."
            >
              {ok.excludedFromPayout.length === 0 && ok.nonPreferenceClasses.length === 0 ? (
                <p data-testid="text-nothing-excluded">
                  Everything on this cap table is included in the figures above.
                </p>
              ) : (
                <ul className="list-disc pl-5">
                  {[...ok.excludedFromPayout, ...ok.nonPreferenceClasses].map((x, i) => (
                    <li key={`${x.roundId ?? "x"}-${i}`} className="mb-2" data-testid={`row-excluded-${i}`}>
                      <span className="font-medium">{x.className ?? x.roundId ?? ""}</span>
                      {x.committedAmountMinor && (
                        <span>{` — committed ${formatExactMinor(x.committedAmountMinor)}`}</span>
                      )}
                      <div className="text-[color:var(--ds-text-secondary)]">
                        {isRenderableRefusalMessage(x.reason)
                          ? x.reason
                          : COPY.excludedFallback}
                      </div>
                      {Array.isArray(x.missingFacts) && x.missingFacts.length > 0 && (
                        <ul className="list-disc pl-5">
                          {x.missingFacts.map((f) => (
                            <li key={f}>
                              {FACT_COPY[f]
                                ? `${FACT_COPY[f].what} ${FACT_COPY[f].how}`
                                : "One further detail is needed on this instrument's recorded terms."}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <p className="text-[color:var(--ds-text-muted)]" data-testid="text-waterfall-footnote">
              These figures are computed from the terms recorded on your rounds and the shares on
              your cap table. They are not a valuation and they are not advice. The projections on
              a round's own page answer a different question and do not model a sale at all, so
              the two are not expected to agree.
            </p>
          </>
        )}
      </PageBody>
    </div>
  );
}
