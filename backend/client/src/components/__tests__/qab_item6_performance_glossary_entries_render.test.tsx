/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA ITEM 6 — the glossary defined none of the ratios on the investor dashboard.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * MOIC, IRR, TVPI and DPI are all on the investor dashboard KPI strip, and PIC
 * is the denominator that TVPI's and DPI's own subtitles point at. None of the
 * five had an entry among the 57 existing terms.
 *
 * THE 57-TERM GLOSSARY IS GOOD. This change is ADDITIVE: five records, one new
 * category, one colour. Test 1 pins that nothing was removed.
 *
 * TWO TRAPS THE SPECIFICATION NAMED, AND WHY EACH HAS ITS OWN TEST:
 *
 *   · BEWARE THE SILENT EMPTY. The dialog renders
 *     `CATEGORY_ORDER.filter((c) => grouped.has(c))`, so if the category string
 *     on the five entries did not match the `CATEGORY_ORDER` string EXACTLY,
 *     the whole section would simply not render — the page would look perfectly
 *     healthy and the five new terms would be missing. Tests 3 and 4 assert the
 *     section header and all five terms are ON SCREEN, not merely in the array.
 *
 *   · THE COMPILER WILL NOT CATCH A MISSING COLOUR. `CATEGORY_COLORS` is
 *     `Record<string, string>`, not keyed on the category union, so a forgotten
 *     colour compiles silently and renders `undefined` into the badge's class
 *     list. Test 5 reads the rendered class attribute.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import {
  ENTRIES,
  CATEGORY_ORDER,
  CATEGORY_COLORS,
  GlossaryDialog,
} from "../Glossary";

const NEW_TERMS = ["MOIC", "IRR", "TVPI", "DPI", "PIC"] as const;
const NEW_CATEGORY = "Performance & Returns";

afterEach(() => cleanup());

describe("QA ITEM 6 · the five return ratios are defined", () => {
  it("1 · ADDITIVE — 57 terms became 62, and every original category survives", () => {
    /* The spec measured 57 (a `grep -c \"term:\"` of 58 includes the type
       declaration). Five entries were appended. */
    expect(ENTRIES.length).toBe(62);
    for (const c of [
      "Equity Instruments", "Round Mechanics", "Investor Rights",
      "Regulatory", "ESOP & Vesting", "Cap Table Views",
    ]) {
      expect(CATEGORY_ORDER).toContain(c);
      expect(CATEGORY_COLORS[c]).toBeTruthy();
    }
    /* The new category is LAST, so no existing section moved. */
    expect(CATEGORY_ORDER[CATEGORY_ORDER.length - 1]).toBe(NEW_CATEGORY);
  });

  it("2 · each of the five exists exactly once and says what the platform really does", () => {
    for (const term of NEW_TERMS) {
      const hits = ENTRIES.filter((e) => e.term === term);
      expect(hits.length).toBe(1);                         // no duplicate shelf
      expect(hits[0].category).toBe(NEW_CATEGORY);
      expect(hits[0].definition.length).toBeGreaterThan(60);
    }
    const by = (t: string) => ENTRIES.find((e) => e.term === t)!;
    /* IRR must state that it needs dated cash flows and is SUPPRESSED, not
       approximated — the platform's actual behaviour. */
    expect(by("IRR").technicalDefinition ?? "").toContain("dated cash flows");
    expect(by("IRR").technicalDefinition ?? "").toContain("suppressed rather than approximated");
    /* DPI must draw the undefined-vs-zero distinction (rule 11: never fabricate
       a zero, and never conceal a true one). */
    expect(by("DPI").technicalDefinition ?? "").toContain("UNDEFINED DPI, not a DPI of zero");
    /* The summing ratios must carry the currency caveat, because the platform
       refuses a cross-currency total rather than converting. */
    expect(by("MOIC").technicalDefinition ?? "").toContain("never converts between currencies");
    expect(by("TVPI").technicalDefinition ?? "").toContain("refuses a total across currencies");
    /* PIC must distinguish paid-in from committed. */
    expect(by("PIC").definition).toContain("NOT the same as your commitment");
  });

  it("3 · THE SECTION ACTUALLY RENDERS — the silent-empty trap", async () => {
    render(<GlossaryDialog trigger={<button>Open glossary</button>} />);
    fireEvent.click(screen.getByText("Open glossary"));
    /* The category name appears BOTH in the header badge strip and as a
       section heading, so the heading is selected by role — a `getByText`
       would match the badge and pass even if the section never rendered,
       which is exactly the vacuous assertion this test exists to avoid. */
    const headings = await screen.findAllByRole("heading", { level: 3 });
    const names = headings.map((h) => (h.textContent ?? "").trim());
    /* PRECONDITION — the dialog really opened and the old glossary is there. */
    expect(names).toContain("Cap Table Views");
    /* If the category strings did not match exactly, this heading would simply
       be absent and everything else on the page would look fine. */
    expect(names).toContain(NEW_CATEGORY);
  });

  it("4 · ALL FIVE TERMS ARE ON SCREEN inside that section", async () => {
    render(<GlossaryDialog trigger={<button>Open glossary</button>} />);
    fireEvent.click(screen.getByText("Open glossary"));
    const headings = await screen.findAllByRole("heading", { level: 3 });
    const heading = headings.find((h) => (h.textContent ?? "").trim() === NEW_CATEGORY);
    expect(heading).toBeTruthy();
    const section = heading!.closest("section");
    expect(section).toBeTruthy();
    for (const term of NEW_TERMS) {
      expect(within(section as HTMLElement).getByText(term)).toBeTruthy();
    }
    /* And the section's own count badge agrees with what is rendered. */
    expect(within(section as HTMLElement).getByText("5")).toBeTruthy();
  });

  it("5 · THE CATEGORY BADGE IS STYLED — the trap the compiler cannot catch", async () => {
    render(<GlossaryDialog trigger={<button>Open glossary</button>} />);
    fireEvent.click(screen.getByText("Open glossary"));
    const badges = await screen.findAllByText(NEW_CATEGORY);
    /* The header strip renders one Badge per CATEGORY_ORDER member. */
    const badge = badges.find((el) => (el.className ?? "").includes("text-[10px]"));
    expect(badge).toBeTruthy();
    const cls = badge!.className ?? "";
    /* `CATEGORY_COLORS` is `Record<string, string>`, so a missing colour would
       have produced the literal string "undefined" here and compiled cleanly. */
    expect(cls).not.toContain("undefined");
    expect(cls).toContain(CATEGORY_COLORS[NEW_CATEGORY]);
    expect(CATEGORY_COLORS[NEW_CATEGORY]).toBeTruthy();
  });

  it("6 · the term count shown to the reader matches the array", async () => {
    render(<GlossaryDialog trigger={<button>Open glossary</button>} />);
    fireEvent.click(screen.getByText("Open glossary"));
    expect(await screen.findByText(`${ENTRIES.length} terms`)).toBeTruthy();
  });
});
