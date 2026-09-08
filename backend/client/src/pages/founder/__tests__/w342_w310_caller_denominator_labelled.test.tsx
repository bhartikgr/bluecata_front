/**
 * WAVE 342 · ITEM 4 · W310 — A RATIO WHOSE DENOMINATOR CAME FROM THE CALLER IS
 * NOT THE PLATFORM'S NUMBER, AND THE SCREEN NOW SAYS SO.
 *
 * §1 THE CENSUS, COUNTED HERE AND ASSERTED, not taken from a handoff: the
 *    sanctioned instrument for "a rendered ratio with an unnamed denominator" is
 *    `lint:percent-denominator-fence`. It is run in-process and asserted to
 *    report ZERO violations and ZERO stale entries, and its debt register is
 *    asserted EMPTY — the two sites it held are the two this item fixed.
 * §2 THE TWO SCREENS, asserted as source text they now render.
 * §3 THE HONESTY CLAUSE: where the recorded percentages do not add to 100 the
 *    screen prints the TRUE SUM and says it is shown as recorded — the standard
 *    the LP export set with its "Not derivable" cell rather than a false figure.
 * §4 NOTHING WAS WIDENED: the fence's vocabulary, window and scope are the same
 *    objects they were, and a POSITIVE CONTROL proves the fence still fails an
 *    unlabelled ratio, so §1's zero is a real zero and not a disabled check.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runPercentDenominatorFence,
  BASELINE,
  DENOM_PHRASES,
  DENOM_LABELS,
} from "../../../../../scripts/lint/percentDenominatorFence";

const RD = "client/src/pages/founder/RoundDetail.tsx";
const src = () => fs.readFileSync(path.join(process.cwd(), RD), "utf8");

describe("W342 §1 — the census, measured by the sanctioned instrument", () => {
  it("the fence reports ZERO unlabelled ratios and ZERO stale entries", () => {
    const r = runPercentDenominatorFence();
    expect(r.violations).toEqual([]);
    expect(r.staleBaseline).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("the sites it considered is a real, non-zero population — not an empty scan", () => {
    const r = runPercentDenominatorFence();
    // PRECONDITION: if the scan found nothing, the zero above would be worthless.
    expect(r.filesScanned).toBeGreaterThan(4);
    expect(r.sitesConsidered).toBeGreaterThan(10);
    expect(r.compliantSites).toBe(r.sitesConsidered);
  });

  it("the debt register is EMPTY — the two sites it held are the two this item fixed", () => {
    expect(BASELINE).toHaveLength(0);
    const r = runPercentDenominatorFence();
    expect(r.baselineHits).toBe(0);
  });
});

describe("W342 §2 — the two screens name the caller-supplied denominator", () => {
  it("the use-of-proceeds total names what it is a share of, and whose figures they are", () => {
    const s = src();
    expect(s).toContain("% of the total committed capital as recorded)");
    expect(s).toContain('data-testid="uop-denominator-provenance"');
    expect(s).toContain("These percentages are the ones recorded on the round wizard");
    expect(s).toContain("Capavate does not derive them and does not rescale them.");
    // The rounding provenance W52c's objection turned on is stated, not hidden.
    expect(s).toContain("Each was recorded already rounded");
  });

  it("the closing-checklist figure names the caller's own checklist as its denominator", () => {
    const s = src();
    expect(s).toContain("% of the total {items.length} item");
    expect(s).toContain("on this round&rsquo;s recorded checklist");
    // The plain count beside it is KEPT — nothing was removed to make room.
    expect(s).toContain("{done} of {items.length} complete");
  });

  it("neither screen converts, sums across, or invents a currency", () => {
    const s = src();
    // The money figure beside the total still goes through the on-record symbol
    // reader, so no currency is assumed and none is converted.
    expect(s).toContain("moneyOnRecord(sym, total.toLocaleString())");
  });
});

describe("W342 §3 — the honesty clause", () => {
  it("a recorded set that does not add to 100 prints its TRUE sum, unadjusted", () => {
    const s = src();
    expect(s).toContain('data-testid="uop-sum-not-hundred"');
    expect(s).toContain("not 100% — shown exactly as recorded rather than adjusted to fit.");
    // It prints the real sum, not a hardcoded number.
    const clause = s.slice(s.indexOf('data-testid="uop-sum-not-hundred"'));
    expect(clause.slice(0, 400)).toContain("data.reduce((s, r) => s + r.percent, 0)");
  });

  it("nothing rescales the recorded percentages anywhere on the card", () => {
    const s = src();
    // A rescale would look like a division by the recorded sum. There is none.
    expect(s).not.toContain("/ data.reduce((s, r) => s + r.percent, 0)");
    expect(s).not.toContain("* (100 / ");
  });
});

describe("W342 §4 — the fence was not widened, and it still bites", () => {
  it("the vocabulary and labels are the same closed sets", () => {
    expect(DENOM_LABELS).toEqual([
      "OUTSTANDING",
      "FD_PRE",
      "FD_PRE_INCL_POOL",
      "FD_POST",
      "FD_POST_EX_POOL",
    ]);
    // `of the total` — the phrase both fixed screens use — was ALREADY in the
    // sanctioned vocabulary before this wave. Nothing was added for this fix.
    expect(DENOM_PHRASES).toContain("of the total");
    expect(DENOM_PHRASES.length).toBe(14);
  });

  it("POSITIVE CONTROL — the fence still fails an unlabelled ratio", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w342-fence-"));
    fs.writeFileSync(
      path.join(dir, "Bad.tsx"),
      'export const X = () => <span>{(a / b) * 100}%</span>;\n',
    );
    const r = runPercentDenominatorFence(dir);
    expect(r.ok).toBe(false);
    expect(r.violations.length).toBeGreaterThan(0);
    // And the repository's baseline is NOT inherited by a synthetic scan.
    expect(r.staleBaseline).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("POSITIVE CONTROL — the same ratio PASSES once its denominator is named", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w342-fence-ok-"));
    fs.writeFileSync(
      path.join(dir, "Good.tsx"),
      'export const X = () => <span>{(a / b) * 100}% of the total items you recorded</span>;\n',
    );
    const r = runPercentDenominatorFence(dir);
    expect(r.violations).toEqual([]);
    expect(r.ok).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5 — RENDERED TEXT. The sections above read source; this section RENDERS the
 * two panels and asserts the words a founder actually sees, because a source
 * string is the instrument and the screen is the product.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { UseOfProceeds, ClosingChecklist } from "../RoundDetail";

afterEach(() => cleanup());

const wrap = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

/** Minimal round shapes. Only the fields these two panels read are supplied. */
const roundWith = (extra: Record<string, unknown>) =>
  ({
    id: "r-1",
    name: "Series A",
    currency: "USD",
    targetAmount: 5_000_000,
    ...extra,
  }) as never;

describe("W342 §5 — the rendered words on the two screens", () => {
  it("the use-of-proceeds total RENDERS the caller-supplied denominator label", () => {
    wrap(
      <UseOfProceeds
        round={roundWith({
          useOfProceeds: [
            { category: "Engineering", amount: 3_000_000, percent: 60 },
            { category: "Sales", amount: 2_000_000, percent: 40 },
          ],
        })}
      />,
    );
    const total = screen.getByTestId("uop-total-committed");
    expect(total.textContent).toContain("100% of the total committed capital as recorded");

    const prov = screen.getByTestId("uop-denominator-provenance");
    expect(prov.textContent).toContain("recorded on the round wizard");
    expect(prov.textContent).toContain("does not derive them and does not rescale them");
    expect(prov.textContent).toContain("Each was recorded already rounded");
    // These add to 100, so the not-100 clause must NOT be on screen.
    expect(screen.queryByTestId("uop-sum-not-hundred")).toBeNull();
  });

  it("recorded percentages that do NOT add to 100 render the TRUE sum, unadjusted", () => {
    wrap(
      <UseOfProceeds
        round={roundWith({
          useOfProceeds: [
            { category: "Engineering", amount: 3_000_000, percent: 59 },
            { category: "Sales", amount: 2_000_000, percent: 38 },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("uop-total-committed").textContent).toContain(
      "97% of the total committed capital as recorded",
    );
    const clause = screen.getByTestId("uop-sum-not-hundred");
    expect(clause.textContent).toContain("add up to 97%, not 100%");
    expect(clause.textContent).toContain("shown exactly as recorded rather than adjusted to fit");
    // NOT rescaled: the platform did not turn 59 into 60.8.
    expect(screen.getByTestId("uop-total-committed").textContent).not.toContain("100%");
  });

  it("the closing-checklist percentage RENDERS the caller's own checklist as its denominator", () => {
    wrap(
      <ClosingChecklist
        round={roundWith({
          closingChecklist: [
            { item: "Board consent", done: true },
            { item: "Stock purchase agreement", done: true },
            { item: "Counsel sign-off", done: false },
          ],
        })}
      />,
    );
    const pct = screen.getByTestId("checklist-pct");
    expect(pct.textContent).toContain("67%");
    expect(pct.textContent).toContain("of the total 3 items on this round’s recorded checklist");
    // The plain count is still there beside it.
    expect(screen.getByText("2 of 3 complete")).toBeTruthy();
  });

  it("a one-item checklist says 'item', not 'items' — the label reads as English", () => {
    wrap(
      <ClosingChecklist round={roundWith({ closingChecklist: [{ item: "Board consent", done: false }] })} />,
    );
    const pct = screen.getByTestId("checklist-pct");
    expect(pct.textContent).toContain("of the total 1 item on this round’s recorded checklist");
    expect(pct.textContent).not.toContain("1 items");
  });
});
