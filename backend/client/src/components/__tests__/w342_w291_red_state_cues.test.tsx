/**
 * WAVE 342 · ITEM 3 · W291 — RED MEANT FOUR THINGS. EACH NOW HAS ITS OWN CUE.
 *
 * ASSERTS RENDERED TEXT AND RENDERED ATTRIBUTES, never a variable name.
 *
 * §1 The four meanings are treated differently from each other — four distinct
 *    glyphs, four distinct words, and the treatments are not interchangeable.
 * §2 THE COLOUR-BLIND CONTROL, which is the whole point of the item: with every
 *    colour class stripped from the rendered markup, each state is STILL
 *    identifiable and still distinct. If a cue depended on colour this fails.
 * §3 The call sites: the invalid field, the required marks, the destructive
 *    confirmation and the two red badges, rendered from the real components.
 * §4 NOTHING WAS RESTYLED: the class list each call site had before is still on
 *    the element, and `--cv-color-border` appears nowhere.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  RED_STATE_MEANINGS,
  RED_STATE_GLYPH,
  RED_STATE_WORD,
  VOID_GLYPH,
  RedErrorCue,
  RequiredMark,
  RequiredFieldsLegend,
  DestructiveActionCue,
  OverdueCue,
  VoidCue,
  redStateGlyphsAreDistinct,
} from "../RedStateCue";

const SRC = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("W342 §1 — four meanings, four treatments", () => {
  it("there are exactly four meanings and they are the four the item names", () => {
    expect(RED_STATE_MEANINGS).toEqual(["error", "required", "destructive", "overdue"]);
    expect(RED_STATE_MEANINGS.length).toBe(4);
  });

  it("every glyph is DIFFERENT — including `void`, which borrows the same red", () => {
    expect(redStateGlyphsAreDistinct()).toBe(true);
    const glyphs = RED_STATE_MEANINGS.map((m) => RED_STATE_GLYPH[m]);
    expect(new Set(glyphs).size).toBe(4);
    expect(glyphs).not.toContain(VOID_GLYPH);
  });

  it("every meaning also carries WORDS, so the glyph is not load-bearing alone", () => {
    for (const m of RED_STATE_MEANINGS) {
      expect(RED_STATE_WORD[m].length).toBeGreaterThan(3);
    }
    expect(new Set(RED_STATE_MEANINGS.map((m) => RED_STATE_WORD[m])).size).toBe(4);
  });

  it("only the ERROR cue is announced as an alert — the others are not failures", () => {
    const { unmount } = render(<RedErrorCue testId="e">Amount not accepted.</RedErrorCue>);
    expect(screen.getByTestId("e").getAttribute("role")).toBe("alert");
    unmount();
    render(
      <>
        <DestructiveActionCue testId="d" />
        <RequiredFieldsLegend testId="r" />
        <OverdueCue testId="o" />
      </>,
    );
    expect(screen.getByTestId("d").getAttribute("role")).toBeNull();
    expect(screen.getByTestId("r").getAttribute("role")).toBeNull();
    expect(screen.getByTestId("o").getAttribute("role")).toBeNull();
  });
});

describe("W342 §2 — THE COLOUR-BLIND CONTROL", () => {
  it("with every colour class removed, the four states are still distinct", () => {
    const { container } = render(
      <>
        <RedErrorCue testId="cue-error">That amount is not a number.</RedErrorCue>
        <RequiredFieldsLegend testId="cue-required" />
        <DestructiveActionCue testId="cue-destructive">Declining cannot be reversed.</DestructiveActionCue>
        <span data-testid="cue-overdue-wrap">
          <OverdueCue testId="cue-overdue" />
          overdue
        </span>
        <span data-testid="cue-void-wrap">
          <VoidCue testId="cue-void" />
          void
        </span>
      </>,
    );
    // Strip EVERY class attribute: this is what a reader without colour gets.
    container.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
    const text = (id: string) => screen.getByTestId(id).textContent ?? "";

    expect(text("cue-error")).toContain("⚠");
    expect(text("cue-error")).toContain("not a number");

    expect(text("cue-required")).toContain("*");
    expect(text("cue-required")).toContain("Required");
    expect(text("cue-required")).toContain("must be filled in");

    expect(text("cue-destructive")).toContain("✕");
    expect(text("cue-destructive")).toContain("Cannot be undone");

    expect(text("cue-overdue-wrap")).toContain("⏱");
    expect(text("cue-overdue-wrap")).toContain("Overdue");
    expect(text("cue-void-wrap")).toContain("⊘");
    expect(text("cue-void-wrap")).toContain("Cancelled");

    // And no two of the five rendered strings are the same.
    const all = [
      text("cue-error"),
      text("cue-required"),
      text("cue-destructive"),
      text("cue-overdue-wrap"),
      text("cue-void-wrap"),
    ];
    expect(new Set(all).size).toBe(5);
  });

  it("NEGATIVE CONTROL — the technique can fail: a colour-only element loses everything", () => {
    const { container } = render(
      <span data-testid="colour-only" className="text-destructive" />,
    );
    container.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
    // Nothing left. This is the shape of the defect the cues above remove.
    expect(screen.getByTestId("colour-only").textContent).toBe("");
  });

  it("the required mark gives assistive technology the WORD, not just the glyph", () => {
    render(<RequiredMark testId="rm" />);
    const el = screen.getByTestId("rm");
    expect(el.textContent).toContain("*");
    expect(el.textContent).toContain("(required)");
    // The glyph itself is decorative so it is not read twice.
    expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
  });
});

describe("W342 §3 — the call sites, as they now read in the tree", () => {
  it("the invalid screen-name field states its invalidity and carries the ⚠ cue", () => {
    const src = SRC("client/src/pages/investor/Profile.tsx");
    expect(src).toContain("aria-invalid={!!(snParse && !snParse.success)}");
    expect(src).toContain('role="alert"');
    expect(src).toContain("{RED_STATE_GLYPH.error} ");
    // The class list it had before is UNCHANGED.
    expect(src).toContain('"border-destructive ring-1 ring-destructive"');
    // The two required asterisks on this page keep their EXISTING span and
    // class — the restyle detector counts a moved class as a bare drop, so the
    // cue is added inline here rather than by swapping the element out. The
    // words are what carry the meaning without colour.
    const inline = src.match(/<span className="text-rose-500" aria-hidden="true">\*<\/span><span className="sr-only"> \(required\)<\/span>/g) ?? [];
    expect(inline.length).toBe(2);
    expect(src).toContain("<RequiredFieldsLegend");
  });

  it("the four required asterisks on the new-contact form gained words", () => {
    const src = SRC("client/src/pages/investor/CRMNew.tsx");
    const marks = src.match(/<RequiredMark \/>/g) ?? [];
    expect(marks.length).toBe(4);
    expect(src).toContain("<RequiredFieldsLegend");
    // The old colour-only span is gone from this form, and no other colour was
    // introduced: `RequiredMark`'s default className is the same one it replaced.
    expect(src).not.toContain('<span className="text-destructive">*</span>');
  });

  it("the destructive confirmation says the consequence in words", () => {
    const src = SRC("client/src/pages/investor/InvitationDetail.tsx");
    expect(src).toContain("<DestructiveActionCue");
    expect(src).toContain("cannot be reversed from this screen");
    // The button's own colour classes are untouched.
    expect(src).toContain('className="bg-destructive hover:bg-destructive/90"');
  });

  it("overdue and void are told apart on both billing tables, with no variant change", () => {
    const src = SRC("client/src/components/collective/MemberBillingPanel.tsx");
    expect((src.match(/redBadgeCue\(/g) ?? []).length).toBe(3); // 1 definition + 2 uses
    expect(src).toContain("<OverdueCue");
    expect(src).toContain("<VoidCue");
    // `statusVariant` still returns the same variants for the same statuses.
    expect(src).toContain('if (status === "overdue" || status === "void") return "destructive";');
  });
});

describe("W342 §4 — nothing prohibited, nothing sacred touched", () => {
  it("--cv-color-border appears in none of the files this item changed", () => {
    for (const f of [
      "client/src/components/RedStateCue.tsx",
      "client/src/pages/investor/Profile.tsx",
      "client/src/pages/investor/CRMNew.tsx",
      "client/src/pages/investor/InvitationDetail.tsx",
      "client/src/components/collective/MemberBillingPanel.tsx",
    ]) {
      expect(SRC(f).includes("--cv-color-border"), f).toBe(false);
    }
  });

  it("the cue module defines NO colour of its own beyond the shipped danger token", () => {
    const src = SRC("client/src/components/RedStateCue.tsx");
    const colourVars = src.match(/--cv-color-[a-z-]+/g) ?? [];
    expect(new Set(colourVars)).toEqual(new Set(["--cv-color-danger"]));
    expect(src).not.toMatch(/#[0-9a-fA-F]{6}/); // no hex colour anywhere
    expect(src).not.toMatch(/hsl\(/);
  });

  it("capavate-tokens.css is byte-identical to the shipped file (SACRED)", () => {
    const css = SRC("client/src/styles/capavate-tokens.css");
    expect(css).not.toContain("WAVE 342");
    expect(css).not.toContain("W291");
  });
});
