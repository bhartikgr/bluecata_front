/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 116 — THE BEFORE PROBE. WHAT THE OLD CODE ANSWERED, EXECUTED.
 * ══════════════════════════════════════════════════════════════════════════════
 * This tree has no VCS checkout, so "fails before / passes after" is proven the
 * way Waves 111 and 114 proved it: the OLD expressions are transcribed here
 * verbatim from the code this wave replaced, executed against the same fixtures
 * the after-tests use, and asserted to VIOLATE each acceptance criterion. Every
 * `expect` below is a statement about the product as the owner saw it.
 *
 * Provenance of each transcription:
 *  · `oldRaisedThisYear` — `client/src/pages/founder/Dashboard.tsx` (the tile in
 *    the screenshot): `company?.kpi?.raisedThisYearUsd ?? 0`, where
 *    `raisedThisYearUsd` has no writer anywhere in the tree (grep for
 *    `raisedThisYearUsd =` returns no assignment; the literal `0` is written at
 *    `server/multiCompanyStore.ts:347,908,1281`, `server/routes.ts:1203,8312`,
 *    `server/partnerPortfolioCompanyRoutes.ts:126`).
 *  · `oldCommittedSum` — `client/src/pages/founder/Welcome.tsx`:
 *    `rounds.reduce((s, r) => s + (r.raisedAmount ?? 0), 0)`, displayed via a
 *    literal `"$0"` fallback.
 *  · `oldTotalTarget` — `Dashboard.tsx`: `companyRounds.reduce((s, r) => s + r.targetAmount, 0)`
 *    over EVERY round of the company, whatever its state, archived or not, in
 *    whatever currency. This is the `$53.7M` in the screenshot.
 *  · `oldDbTotalFunded` — `server/lib/adminKpiDbReads.ts`:
 *    `listRounds().reduce((a, r) => a + (r.raisedAmount ?? 0), 0)`.
 *  · `oldCapPrice` / `oldSafeShares` — `client/src/components/CapitalizationJourney.tsx`:
 *    `const capPrice = s.cap / 12_000_000;` and `shares = Math.floor(principal / 1.0);`
 *  · `oldFounderPct` — the same file's KPI:
 *    `fd.totalShares === 0n ? 0 : Number((founderShares * 10000n) / fd.totalShares) / 100`.
 *  · `oldInterimHeader` / `oldPdfPct` — the unnamed `"Own %"` header and the
 *    inline `(v.shares / totalSharesNum) * 100` in `server/routes.ts`.
 *
 * NOTHING HERE IMPORTS WAVE 116 CODE except the shared vocabulary it asserts
 * against, so this file keeps describing the old product forever.
 */
import { describe, it, expect } from "vitest";
import {
  COMPANY_MONEY_REFUSAL_STATEMENT,
  COMPANY_TARGET_REFUSAL_STATEMENT,
} from "../../client/src/lib/money/companyMoneyOnRecord";
import { COMMITTED_LEDGER_BASIS_LABEL } from "../lib/captableDisplayResolver";

/* ── the fixtures ──────────────────────────────────────────────────────────── */

/** A company with a REAL book: $250,000 committed and $400,000 funded on record,
 *  against a $1,000,000 target. `raised_amount` is `0` on every row, because the
 *  column has no writer. */
const REAL_BOOK = { committedMinor: 25_000_000n, fundedMinor: 40_000_000n };
const RAISED_AMOUNT_COLUMN = 0;

/** The five round states (`shared/schema.ts:942-948`) plus the archived flag. */
const COMPANY_ROUNDS = [
  { id: "r1", state: "closed", targetAmount: 1_000_000, currency: "USD", archivedAt: null },
  { id: "r2", state: "draft", targetAmount: 40_000_000, currency: "USD", archivedAt: null },
  { id: "r3", state: "soft_circle_open", targetAmount: 2_700_000, currency: "USD", archivedAt: null },
  { id: "r4", state: "closed", targetAmount: 10_000_000, currency: "USD", archivedAt: "2025-01-01" },
  { id: "r5", state: "terms_set", targetAmount: 5_000_000, currency: "EUR", archivedAt: null },
];

/* ── the old code, transcribed ─────────────────────────────────────────────── */

const oldRaisedThisYear = (kpi: { raisedThisYearUsd?: number } | undefined) =>
  kpi?.raisedThisYearUsd ?? 0;

const oldCommittedSum = (rounds: Array<{ raisedAmount?: number }>) =>
  rounds.reduce((s, r) => s + (r.raisedAmount ?? 0), 0);

const oldTotalTarget = (rounds: Array<{ targetAmount: number }>) =>
  rounds.reduce((s, r) => s + r.targetAmount, 0);

const oldDbTotalFunded = (rounds: Array<{ raisedAmount?: number }>) =>
  rounds.reduce((a, r) => a + (r.raisedAmount ?? 0), 0);

const oldCapPrice = (cap: number) => cap / 12_000_000;
const oldSafeShares = (principal: number, cap: number | null) =>
  cap ? Math.floor(principal / oldCapPrice(cap)) : Math.floor(principal / 1.0);

const oldFounderPct = (founderShares: bigint, totalShares: bigint) =>
  totalShares === BigInt(0)
    ? 0
    : Number((founderShares * BigInt(10000)) / totalShares) / 100;

const OLD_INTERIM_OWNERSHIP_HEADER = "Own %";

const oldPdfPct = (shares: number, totalSharesNum: number) =>
  totalSharesNum > 0 ? (shares / totalSharesNum) * 100 : null;

/* ── FINDING 1 ─────────────────────────────────────────────────────────────── */

describe("W116 BEFORE · FINDING 1 — the front page printed $0 over a real book", () => {
  it("AC-1 VIOLATED: a company with $650,000 on record read exactly 0", () => {
    /* The book is real and non-empty ... */
    expect(REAL_BOOK.committedMinor + REAL_BOOK.fundedMinor).toBe(65_000_000n);
    /* ... and the tile the owner screenshotted read zero anyway, because it read
       a different field entirely: one that is never written. */
    expect(oldRaisedThisYear({})).toBe(0);
    expect(oldRaisedThisYear(undefined)).toBe(0);
    expect(oldRaisedThisYear({ raisedThisYearUsd: RAISED_AMOUNT_COLUMN })).toBe(0);
  });

  it("AC-2 VIOLATED: the same 0 was printed for 'nothing on record' and for 'unknown'", () => {
    /* Indistinguishable outputs for two completely different facts. That is the
       precise defect: a confident `$0` that means "unknown". */
    const nothingOnRecord = oldCommittedSum([]);
    const realBookUnreadable = oldCommittedSum([{ raisedAmount: 0 }, { raisedAmount: 0 }]);
    expect(nothingOnRecord).toBe(realBookUnreadable);
    expect(nothingOnRecord).toBe(0);
    /* Wave 116 prints a SENTENCE for both, and they are different sentences. */
    expect(COMPANY_MONEY_REFUSAL_STATEMENT.no_rounds_on_record)
      .not.toBe(COMPANY_MONEY_REFUSAL_STATEMENT.not_determined_on_some_rounds);
  });

  it("AC-3 VIOLATED: the old figure carried no state breakdown at all", () => {
    /* A single scalar cannot distinguish soft-circled from committed from funded;
       there is nothing in the old expression to interrogate. */
    expect(typeof oldRaisedThisYear({ raisedThisYearUsd: 5 })).toBe("number");
  });

  it("AC-4 VIOLATED: the $53.7M target summed drafts, archived rounds and mixed currencies", () => {
    const total = oldTotalTarget(COMPANY_ROUNDS);
    /* $58.7M, of which $40M is a DRAFT, $10M is an ARCHIVED round and €5M is not
       even the same unit. Only $3.7M of it is a live-or-closed USD target. */
    expect(total).toBe(58_700_000);
    const draft = COMPANY_ROUNDS.find((r) => r.state === "draft")!.targetAmount;
    const archived = COMPANY_ROUNDS.find((r) => r.archivedAt !== null)!.targetAmount;
    const foreign = COMPANY_ROUNDS.find((r) => r.currency !== "USD")!.targetAmount;
    expect(draft + archived + foreign).toBe(55_000_000);
    expect(total - draft - archived - foreign).toBe(3_700_000);
    /* And mixing currencies is refused outright now, rather than added up. */
    expect(COMPANY_TARGET_REFUSAL_STATEMENT.mixed_currency).toMatch(/currenc/i);
  });

  it("AC-5 VIOLATED: the admin KPI summed the dead column", () => {
    expect(oldDbTotalFunded([{ raisedAmount: 0 }, { raisedAmount: 0 }, {}])).toBe(0);
  });
});

/* ── FINDING 2 ─────────────────────────────────────────────────────────────── */

describe("W116 BEFORE · FINDING 2 — the invented denominators", () => {
  it("AC-6 VIOLATED: a hardcoded 12,000,000 FD share count set the conversion price", () => {
    /* $8,000,000 cap ÷ an invented 12,000,000 shares = $0.666… per share, a
       number with no basis in the company's data. */
    expect(oldCapPrice(8_000_000)).toBeCloseTo(0.6666666, 6);
    /* $100,000 of SAFE principal therefore "became" 150,000 shares. */
    expect(oldSafeShares(100_000, 8_000_000)).toBe(150_000);
  });

  it("AC-6 VIOLATED: with no cap it assumed a $1.00 share price", () => {
    /* `principal / 1.0` is the same invention with its constant hidden inside a
       division by one: $100,000 of principal "became" 100,000 shares. */
    expect(oldSafeShares(100_000, null)).toBe(100_000);
  });

  it("AC-7 VIOLATED: the invented shares landed in the DENOMINATOR too, moving every holder", () => {
    /* A founder holding 1,000,000 real shares beside one $100,000 uncapped SAFE. */
    const founder = 1_000_000;
    const inventedSafe = oldSafeShares(100_000, null);
    const honestPct = (founder / founder) * 100;
    const inventedPct = (founder / (founder + inventedSafe)) * 100;
    expect(honestPct).toBe(100);
    expect(inventedPct).toBeCloseTo(90.909, 3);
    /* 9.09 percentage points of the founder's stated ownership came from a
       constant, not from data. */
    expect(honestPct - inventedPct).toBeGreaterThan(9);
  });
});

/* ── FINDING 3 ─────────────────────────────────────────────────────────────── */

describe("W116 BEFORE · FINDING 3 — percentages that named no denominator", () => {
  it("AC-8 VIOLATED: the interim cap-table column header named no basis", () => {
    expect(OLD_INTERIM_OWNERSHIP_HEADER).toBe("Own %");
    expect(OLD_INTERIM_OWNERSHIP_HEADER).not.toMatch(/committed|issued|diluted|converted/i);
    /* Wave 116's label does name it. */
    expect(COMMITTED_LEDGER_BASIS_LABEL).toMatch(/committed shares/i);
  });

  it("AC-9 VIOLATED: the journey KPI printed 0.00% for an UNDEFINED ratio", () => {
    /* 0 ÷ 0 is undefined, and ruling D18 makes the engine answer `null` for it.
       The old expression answered a confident zero. */
    expect(oldFounderPct(BigInt(0), BigInt(0))).toBe(0);
  });

  it("AC-9 VIOLATED: it also truncated the engine's own answer to 2dp by integer division", () => {
    /* 1/3 of the cap table: the engine's string is 33.333…, this printed 33.33
       having thrown the engine's answer away and re-divided share counts. */
    expect(oldFounderPct(BigInt(1), BigInt(3))).toBe(33.33);
  });

  it("AC-10 VIOLATED: the PDF percentage was a ninth inline division", () => {
    /* The arithmetic was right; it was simply not the shared one, so the two
       surfaces could drift. Same inputs, same answer — the point is provenance. */
    expect(oldPdfPct(250, 1000)).toBe(25);
    expect(oldPdfPct(250, 0)).toBeNull();
  });
});
