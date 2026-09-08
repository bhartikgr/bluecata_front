/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAVE 343 · ITEM 4 — THE ACCREDITATION MESSAGES: ONE DELIVERED, ONE REFUSED.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * The owner asked for the "global best practice investor grade fix" and added
 * "be careful as I do not want the platform to be too restrictive". The brief
 * turned that into: DELIVER the messages, DO NOT convert an informational
 * message into a GATE, do not make a new claim about whether a declaration was
 * made, reuse the ratified register, and — if the only way to deliver a message
 * is to assert something about the investor's regulatory status — STOP AND
 * REPORT.
 *
 * TWO messages were stranded behind the reference-mode early return. THIS WAVE
 * DELIVERED ONE AND REFUSED THE OTHER, and this file proves both halves,
 * because "we delivered the messages" and "we delivered the one that could be
 * delivered honestly" are different claims and only the second is true.
 *
 *   §1 RE-VERIFY THE PREMISE. The mount census, counted here, `=== 1`.
 *   §2 THE DELIVERED MESSAGE IS RENDERED — asserted as RENDERED TEXT on the
 *      real component, not as a string found in the source.
 *   §3 IT IS NOT A GATE. Nothing is disabled, nothing is required, and the
 *      panel's controls still respond with zero declarations ticked.
 *   §4 NO NEW CLAIM IS MADE. The "submitted / awaiting compliance review"
 *      wording is still absent from what the investor sees.
 *   §5 THE REGISTER IS THE RATIFIED ONE, imported not retyped.
 *   §6 THE REFUSAL IS PINNED, with its reason, so it cannot decay into an
 *      unexplained absence.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  AccreditationForm,
  BOTH_DECLARATIONS_REQUIRED,
  W343_UNDELIVERABLE_MESSAGE_REASON,
} from "@/components/AccreditationForm";
import { W211_LP_COMMIT_TICK_3 } from "@shared/wave211MoneyEventAttestation";
import { Toaster } from "@/components/ui/toaster";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
/* CODE ONLY, comments removed. Two assertions in this file failed on their
   first run because THIS WAVE'S OWN COMMENTS quote the ratified sentence and
   the refused message while explaining them — the source-text checks were
   counting the documentation as if it were product copy. Recorded here rather
   than the assertions being dropped: what they mean to check is EXECUTABLE
   code, so comments are stripped first. */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
afterEach(() => cleanup());

describe("W343 ITEM 4 §1 — the premise, RE-MEASURED this wave", () => {
  it("AccreditationForm has EXACTLY ONE production mount, and it is reference mode", () => {
    /* Counted by walking client/src, not by trusting the coordinate in the
       brief. `=== 1` is asserted, and the mode is asserted with it. */
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === "node_modules" || name === "__tests__") continue;
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx|ts)$/.test(name)) {
          const src = fs.readFileSync(p, "utf8");
          if (src.includes("<AccreditationForm")) found.push(p);
        }
      }
    };
    walk(path.join(process.cwd(), "client/src"));
    expect(found.length, "production mounts of <AccreditationForm").toBe(1);
    expect(found[0].endsWith("client/src/pages/investor/Profile.tsx")).toBe(true);
    const mount = read("client/src/pages/investor/Profile.tsx");
    expect(mount).toContain('<AccreditationForm initialJurisdiction="US" mode="reference" />');
    /* NO `onSubmit` on that mount — which is what makes the messages latent. */
    expect(mount).not.toMatch(/<AccreditationForm[^>]*onSubmit/);
  });
});

describe("W343 ITEM 4 §2 — the deliverable message IS DELIVERED, as rendered text", () => {
  it("reference mode renders the declaration requirement without any interaction", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    const notice = screen.getByTestId("accreditation-form-declaration-requirement-notice");
    /* RENDERED TEXT, not source text. The message that was unreachable since
       WAVE 215 is now on screen before the investor touches anything. */
    expect(notice.textContent ?? "").toContain(BOTH_DECLARATIONS_REQUIRED);
    expect(BOTH_DECLARATIONS_REQUIRED).toBe("Please confirm both declarations before submitting.");
  });

  it("it is delivered in reference mode ONLY — capture mode is untouched by this wave", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="capture" onSubmit={() => {}} />);
    expect(screen.queryByTestId("accreditation-form-declaration-requirement-notice")).toBeNull();
  });
});

describe("W343 ITEM 4 §3 — IT IS INFORMATION, NOT A GATE", () => {
  it("with ZERO declarations ticked, nothing on the panel is disabled", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    /* THE EXTRACTOR ASSERTS ITS OWN YIELD: if the panel rendered no controls at
       all, "nothing is disabled" would be vacuously true. */
    const controls = document.querySelectorAll("button, input, select, textarea");
    expect(controls.length, "interactive controls found on the panel").toBeGreaterThan(3);
    const disabled = Array.from(controls).filter((c) => (c as HTMLButtonElement).disabled);
    expect(
      disabled.map((d) => (d as HTMLElement).getAttribute("data-testid") ?? d.nodeName),
      "controls disabled while no declaration is ticked",
    ).toEqual([]);
  });

  it("the jurisdiction and pathway controls still respond with nothing confirmed", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    const pathways = screen.getByTestId("list-pathways");
    const radios = pathways.querySelectorAll('input[type="radio"]');
    expect(radios.length, "pathway radios rendered").toBeGreaterThan(1);
    fireEvent.click(radios[1]);
    expect((radios[1] as HTMLInputElement).checked, "a pathway can be selected with nothing ticked").toBe(
      true,
    );
  });

  it("the new notice adds no required attribute and no aria-disabled anywhere", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    expect(document.querySelectorAll("[required]").length).toBe(0);
    expect(document.querySelectorAll('[aria-disabled="true"]').length).toBe(0);
  });
});

describe("W343 ITEM 4 §4 — NO NEW CLAIM about whether a declaration was made", () => {
  it("the investor is never told a submission is 'awaiting compliance review'", () => {
    render(
      <>
        <AccreditationForm initialJurisdiction="US" mode="reference" />
        <Toaster />
      </>,
    );
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("awaiting compliance review");
    expect(body).not.toContain("Accreditation submitted");
    /* And the panel still says plainly that it records nothing. */
    expect(body).toContain("nothing on this panel is recorded");
  });

  it("no word this platform has withdrawn is reintroduced by the new copy", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    const notice =
      screen.getByTestId("accreditation-form-declaration-requirement-notice").textContent ?? "";
    expect(notice.length, "the notice rendered non-empty text").toBeGreaterThan(60);
    for (const banned of ["verified", "screened", "approved", "qualified investor", "we confirm"]) {
      expect(notice.toLowerCase(), `withdrawn claim word "${banned}" must not appear`).not.toContain(
        banned.toLowerCase(),
      );
    }
  });
});

describe("W343 ITEM 4 §5 — the RATIFIED register, imported and not retyped", () => {
  it("the rendered notice carries the ratified no-verification sentence verbatim", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    const notice =
      screen.getByTestId("accreditation-form-declaration-requirement-notice").textContent ?? "";
    expect(notice).toContain(W211_LP_COMMIT_TICK_3);
    /* And the ratified constant really is the sentence the brief cites. */
    expect(W211_LP_COMMIT_TICK_3).toContain(
      "does not verify this investor's identity, wealth, status, eligibility or source of funds",
    );
  });

  it("the component IMPORTS it rather than holding its own copy of the wording", () => {
    const src = read("client/src/components/AccreditationForm.tsx");
    expect(src).toContain('import { W211_LP_COMMIT_TICK_3 } from "@shared/wave211MoneyEventAttestation"');
    /* If a future edit retypes the sentence into CODE instead, this reddens.
       Comments are excluded — see `readCode` above. */
    expect(readCode("client/src/components/AccreditationForm.tsx")).not.toContain(
      "does not verify this investor's identity, wealth",
    );
  });
});

describe("W343 ITEM 4 §6 — the REFUSED message is pinned, with its reason", () => {
  it("the second message is still confined to the capture branch and is NOT reachable", () => {
    const src = readCode("client/src/components/AccreditationForm.tsx");
    /* TWO occurrences in code, and both are accounted for — a bare `=== 1`
       failed here on the second run because this wave's own REFUSAL RECORD
       (`W343_UNDELIVERABLE_MESSAGE_REASON`) quotes the phrase in order to
       explain why the message is not delivered. Counting is not enough, so each
       occurrence is identified:
         1. the toast inside `submit()`, after the reference early return — the
            message itself, left exactly where it was;
         2. the exported reason constant — a record ABOUT the message, not a
            thing any investor can be shown. */
    expect((src.match(/awaiting compliance review/g) ?? []).length).toBe(2);
    expect(src).toContain("export const W343_UNDELIVERABLE_MESSAGE_REASON");
    /* The only occurrence that can reach a user is the toast, and it is inside
       `submit()` past the early return. Proved by position, below. */
    expect((src.match(/title: "Accreditation submitted"/g) ?? []).length).toBe(1);
    const early = src.indexOf('if (mode === "reference" && !onSubmit)');
    /* Positioned on the TOAST, not on the phrase: the phrase's first occurrence
       is now the refusal record, which is declared ABOVE the component. Getting
       this wrong made the assertion red on the third run — recorded rather than
       relaxed. */
    const msg = src.indexOf('title: "Accreditation submitted"');
    expect(early, "the early return exists").toBeGreaterThan(0);
    expect(msg, "the message sits AFTER the early return").toBeGreaterThan(early);
  });

  it("the reason for refusing it is recorded in the source, not only in a report", () => {
    expect(W343_UNDELIVERABLE_MESSAGE_REASON).toContain("regulatory status");
    expect(W343_UNDELIVERABLE_MESSAGE_REASON).toContain("submission was recorded");
    /* This one DOES read the comments: the point is that the decision is
       written down in the file a future engineer will open. */
    expect(read("client/src/components/AccreditationForm.tsx")).toContain("STOP AND REPORT");
  });
});
