/**
 * WAVE 110 · FINDING 6 — NO RENDERED FIGURE IN `MemberValueIntelligenceBox` MAY
 * DERIVE FROM AN ARRAY INDEX.
 *
 * The card used to compute its "experience signal" from the holder's position in
 * the array — `8 + (i % 7)` years investing, `12 + (i % 18)` rounds,
 * `1 + (i % 4)` exits — and print those numbers in bold under a subtitle that
 * claimed they came from "cross-platform signals". Words were fabricated the same
 * way: every `investor` row was tagged "Fintech · B2B SaaS".
 *
 * The decisive test is INDEX INDEPENDENCE: two holders that differ only in where
 * they sit in the array must render identical figures, and reordering the array
 * must not change what any holder's card says. Pre-fix that was false by
 * construction; a `% 7` cannot survive it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemberValueIntelligenceBox } from "../MemberValueIntelligenceBox";

afterEach(cleanup);

type Row = Parameters<typeof MemberValueIntelligenceBox>[0]["rows"][number];

const bare = (name: string, type = "investor"): Row => ({
  holderId: name.toLowerCase().replace(/\s+/g, "_"),
  holderName: name,
  holderType: type,
});

/** The text of one card, with the machine testids stripped out. */
function cardText(i: number): string {
  return (screen.getByTestId(`card-holder-${i}`).textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("W110 · Finding 6 — figures are recorded or absent, never invented", () => {
  it("INDEX INDEPENDENCE — identical holders at different positions render identical cards", () => {
    render(
      <MemberValueIntelligenceBox
        rows={[bare("Alpha One"), bare("Alpha Two"), bare("Alpha Three"), bare("Alpha Four")]}
      />,
    );
    /* Strip the only legitimately differing token: the holder's own name. */
    const texts = [0, 1, 2, 3].map((i) => cardText(i).replace(/Alpha \w+/, "NAME").replace(/^[A-Z·]{1,2}/, ""));
    expect(new Set(texts).size).toBe(1);
    /* Pre-fix each of these read "8y Investing · 12 Rounds · 1 Exits",
       "9y · 13 · 2", "10y · 14 · 3", "11y · 15 · 4". */
  });

  it("REORDERING the array changes nothing a reader sees about a holder", () => {
    const rows = [bare("Alpha One"), bare("Beta Two"), bare("Gamma Three")];
    render(<MemberValueIntelligenceBox rows={rows} />);
    const forward = [0, 1, 2].map((i) => cardText(i));
    cleanup();
    render(<MemberValueIntelligenceBox rows={[...rows].reverse()} />);
    const reversed = [0, 1, 2].map((i) => cardText(i));
    expect(new Set(forward)).toEqual(new Set(reversed));
  });

  it("a holder with NO recorded experience shows no number and says so", () => {
    render(<MemberValueIntelligenceBox rows={[bare("Alpha One"), bare("Beta Two", "founder")]} />);
    for (const i of [0, 1]) {
      expect(screen.queryByTestId(`holder-metrics-${i}`)).toBeNull();
      expect(screen.queryByTestId(`holder-metric-years-${i}`)).toBeNull();
      expect(screen.queryByTestId(`holder-metric-rounds-${i}`)).toBeNull();
      expect(screen.queryByTestId(`holder-metric-exits-${i}`)).toBeNull();
      /* No fabricated expertise tag either. */
      expect(screen.queryByTestId(`holder-expertise-${i}`)).toBeNull();
      const unavailable = screen.getByTestId(`holder-metrics-unavailable-${i}`);
      expect(unavailable.textContent ?? "").toMatch(/not available rather than estimated/i);
      /* NOT ONE DIGIT anywhere in a card with nothing recorded. */
      expect(cardText(i)).not.toMatch(/[0-9]/);
    }
    /* And the subtitle no longer claims provenance it does not have. */
    const provenance = screen.getByTestId("text-member-value-provenance").textContent ?? "";
    expect(provenance).not.toMatch(/cross-platform/i);
    expect(provenance).toMatch(/actually been\s+recorded/i);
  });

  it("a holder WITH recorded experience shows exactly those values, unaltered", () => {
    render(
      <MemberValueIntelligenceBox
        rows={[
          bare("Alpha One"),
          {
            ...bare("Beta Two"),
            expertise: ["Payments", "Marketplaces"],
            yearsInvesting: 3,
            roundsParticipated: 0,
            exitsAchieved: 0,
            region: "Ontario",
            sector: "Fintech",
          },
        ]}
      />,
    );
    expect(screen.queryByTestId("holder-metrics-0")).toBeNull();
    expect(screen.getByTestId("holder-metric-years-1").textContent).toBe("3y");
    /* A recorded ZERO is a fact and must be shown, not swallowed. */
    expect(screen.getByTestId("holder-metric-rounds-1").textContent).toBe("0");
    expect(screen.getByTestId("holder-metric-exits-1").textContent).toBe("0");
    expect(screen.getByTestId("holder-expertise-1").textContent).toContain("Payments");
    expect(cardText(1)).toContain("Ontario");
  });

  it("an unrecorded or nonsensical metric is dropped rather than printed", () => {
    render(
      <MemberValueIntelligenceBox
        rows={[
          { ...bare("Alpha One"), yearsInvesting: Number.NaN, roundsParticipated: -4, exitsAchieved: 2 },
        ]}
      />,
    );
    expect(screen.queryByTestId("holder-metric-years-0")).toBeNull();
    expect(screen.queryByTestId("holder-metric-rounds-0")).toBeNull();
    expect(screen.getByTestId("holder-metric-exits-0").textContent).toBe("2");
  });

  it("the source contains no index arithmetic and no fabricated defaults", () => {
    const src = readFileSync("client/src/components/MemberValueIntelligenceBox.tsx", "utf8");
    const body = src.slice(src.indexOf("import "));
    for (const gone of ["defaultYearsFor", "defaultRoundsFor", "defaultExitsFor", "defaultExpertiseFor"]) {
      expect(body).not.toContain(gone);
    }
    /* `i % n` — the shape of every fabricated figure in this file. */
    expect(/\bi\s*%\s*\d/.test(body)).toBe(false);
  });
});
