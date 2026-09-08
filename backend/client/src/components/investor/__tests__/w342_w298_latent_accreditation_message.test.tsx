/**
 * WAVE 342 · ITEM 5 · W298 — THE LATENT ACCREDITATION MESSAGE. INVESTIGATION,
 * PROVED. NO PRODUCT COPY WAS CHANGED BY THIS FILE'S WAVE.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A TEST AND NOT A FIX
 * ═════════════════════════════════════════════════════════════════════════════
 * The brief for this item says: investigate first, build only if it is real, and
 * **if the fix would change what the platform CLAIMS about an investor's status,
 * STOP and report rather than write new legal-sounding copy.**
 *
 * The defect is REAL and it is LATENT: two messages in
 * `client/src/components/AccreditationForm.tsx` cannot be reached from any
 * production surface. Making either of them reachable would change what an
 * investor is told about whether a declaration was made — counsel-adjacent, so
 * it is reported and NOT built.
 *
 * This file therefore does one thing: it PINS THE LATENCY, so that
 *   (a) the finding cannot decay into a claim nobody can check, and
 *   (b) if a future wave makes either message reachable, that happens
 *       deliberately and with counsel's wording, not by accident.
 *
 * THE MEASUREMENT
 * ───────────────────────────────────────────────────────────────────────────
 * The component's ONLY production mount is `client/src/pages/investor/Profile.tsx`
 * with `mode="reference"` and NO `onSubmit`. In that configuration `submit()`
 * takes its early-return branch, so neither the validation error nor the
 * "submitted" confirmation below it can execute.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { AccreditationForm, REAL_ACCREDITATION_ROUTE } from "@/components/AccreditationForm";
import { Toaster } from "@/components/ui/toaster";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const FORM = "client/src/components/AccreditationForm.tsx";

afterEach(() => cleanup());

describe("W342 §1 — the census of production mounts, counted here", () => {
  it("the component has EXACTLY ONE production mount, and it is reference mode", () => {
    const files = [
      "client/src/pages/investor/Profile.tsx",
      "client/src/pages/investor/Accreditation.tsx",
      "client/src/pages/investor/ApplyToCollective.tsx",
      "client/src/components/investor/AccreditationDeclaration.tsx",
      "client/src/components/collective/CollectiveAccreditationBlocker.tsx",
    ];
    const mounts: string[] = [];
    for (const f of files) {
      const src = read(f);
      for (const m of src.match(/<AccreditationForm[^>]*\/?>/g) ?? []) mounts.push(`${f} :: ${m}`);
    }
    expect(mounts).toHaveLength(1);
    expect(mounts[0]).toContain("client/src/pages/investor/Profile.tsx");
    expect(mounts[0]).toContain('mode="reference"');
    // No `onSubmit` is supplied at that mount — which is what makes the two
    // messages below unreachable.
    expect(mounts[0]).not.toContain("onSubmit");
  });

  it("both latent strings exist in the source, so this is a latency claim, not a typo claim", () => {
    const src = read(FORM);
    expect(src).toContain("Please confirm both declarations before submitting.");
    expect(src).toContain("awaiting compliance review");
    // And the early return that strands them is above both.
    const early = src.indexOf('if (mode === "reference" && !onSubmit)');
    expect(early).toBeGreaterThan(0);
    /* WAVE 343 · ITEM 1-of-4 · ITEM 4 — UPDATED, WITH A STATED REASON, NOT
       DELETED. `indexOf` was correct while this string appeared exactly once,
       inside `submit()`. Wave 343 lifted it into an exported constant
       (`BOTH_DECLARATIONS_REQUIRED`) declared ABOVE the component so it could be
       DELIVERED as information in reference mode, so the FIRST occurrence is now
       that declaration and it precedes the early return. The claim this
       assertion exists to make — "the string used by the validation branch sits
       after the early return" — is unchanged and is now made with `lastIndexOf`,
       matching the sibling assertion below and for the same reason. */
    /* SECOND CORRECTION, SAME WAVE, ALSO STATED. `lastIndexOf` was still wrong:
       Wave 343 did not merely ADD a declaration above the component, it replaced
       the LITERAL inside `submit()` with a reference to the named constant. The
       literal string therefore no longer appears after the early return at all —
       so any assertion phrased about the literal's POSITION is now measuring the
       wrong thing, and the honest repair is to assert what the branch actually
       contains today: the constant's NAME. The claim is unchanged — the
       validation branch still sits after the early return and is still
       unreachable in the production configuration. */
    expect(src).toContain("export const BOTH_DECLARATIONS_REQUIRED");
    expect(src).toContain("setError(BOTH_DECLARATIONS_REQUIRED)");
    expect(
      src.indexOf("setError(BOTH_DECLARATIONS_REQUIRED)"),
      "the validation branch still sits AFTER the reference-mode early return",
    ).toBeGreaterThan(early);
    /* And the sentence itself is unchanged — nothing was reworded under cover of
       being refactored into a constant. */
    expect(src).toContain('"Please confirm both declarations before submitting."');
    /* `lastIndexOf`, deliberately: "awaiting compliance review" also appears in
       the WAVE 215 comment ABOVE the early return, which explains why the
       message was stranded. The CODE occurrence is the last one. */
    expect(src.lastIndexOf("awaiting compliance review")).toBeGreaterThan(early);
  });
});

describe("W342 §2 — the latency, proved against the RENDERED screen", () => {
  it("in the production configuration the validation error never appears", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    // Submit with NEITHER declaration ticked: the pre-wave code path would have
    // printed "Please confirm both declarations before submitting."
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });
    fireEvent.click(screen.getByTestId("button-submit-accreditation"));
    /* WAVE 343 · ITEM 4 — UPDATED, WITH A STATED REASON, NOT DELETED.
       ═══════════════════════════════════════════════════════════════════════
       THIS ASSERTION WENT RED, AND IT WAS RIGHT TO. Wave 342 pinned the message
       as LATENT and said so: "if a future wave makes either message reachable,
       that happens deliberately and with counsel's wording, not by accident."
       Wave 343 is that wave. The owner asked for the "global best practice
       investor grade fix" and the brief instructed: DELIVER the messages, do not
       convert an informational message into a GATE.

       WHAT CHANGED, PRECISELY. The message is no longer produced by the
       VALIDATION BRANCH — that branch is still unreachable in this
       configuration, and the assertion below still proves the early return
       fires. It is now rendered UNCONDITIONALLY, as information, in the
       reference-mode notice, before any interaction. So the original claim
       ("clicking submit in production does not produce a validation error") is
       still true and still asserted — but it must now be asserted about the
       ERROR REGION rather than about the whole screen, because the same words
       legitimately appear as static guidance elsewhere on the panel.

       The `error` state is rendered in its own node; if the validation branch
       ever fires here, `setError` populates it and this reddens again.
       Wave 343's own proof that the delivery is NOT a gate lives in
       client/src/components/investor/__tests__/w343_item4_accreditation_message_delivery.test.tsx §3.
       ═══════════════════════════════════════════════════════════════════════ */
    /* SECOND CORRECTION, STATED. Filtering by "not inside the static notice"
       still matched three nodes — the notice's ANCESTORS, which contain its text
       by definition. So the assertion is made against the thing that actually
       distinguishes an error from guidance: the validation error renders through
       `InlineError`, which emits `role="alert"`. Guidance does not. */
    const staticNotice = screen.getByTestId("accreditation-form-declaration-requirement-notice");
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'));
    expect(
      alerts.map((n) => n.textContent ?? ""),
      "the VALIDATION ERROR must still not render in the production configuration",
    ).toEqual([]);
    /* ANTI-VACUITY, TWICE OVER: the words really are on the screen (so the
       filter above is not matching nothing because the panel is blank), and the
       click really did reach the handler (so the absence is about the branch,
       not about a dead button). */
    expect(staticNotice.textContent ?? "").toMatch(
      /Please confirm both declarations before submitting\./,
    );
    expect(assign).toHaveBeenCalledWith(REAL_ACCREDITATION_ROUTE);
  });

  it("in the production configuration the investor is never told a declaration was submitted", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });
    render(
      <>
        <AccreditationForm initialJurisdiction="US" mode="reference" />
        <Toaster />
      </>,
    );
    fireEvent.click(screen.getByTestId("checkbox-truthful"));
    fireEvent.click(screen.getByTestId("checkbox-risk"));
    fireEvent.click(screen.getByTestId("button-submit-accreditation"));

    // ANTI-VACUITY: a toast really did appear, so the absence below is real.
    const shown = await vi.waitFor(() => {
      const t = document.body.textContent ?? "";
      expect(t).toMatch(/Nothing was submitted from this panel/i);
      return t;
    });
    expect(shown).not.toMatch(/Accreditation submitted/i);
    expect(shown).not.toMatch(/awaiting compliance review/i);
  });

  it("the validation error IS still live for a capture-mode caller — nothing was removed", () => {
    const onSubmit = vi.fn();
    render(<AccreditationForm initialJurisdiction="US" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId("button-submit-accreditation"));
    // With an `onSubmit` present the early return does not fire, so the message
    // that is latent in production renders here. It is stranded, not dead code,
    // and deleting it would remove a real guard from a real caller shape.
    expect(screen.getByText(/Please confirm both declarations before submitting\./)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("W342 §3 — NOTHING COUNSEL-ADJACENT WAS TOUCHED BY THIS ITEM", () => {
  it("no wave-342 edit exists in the accreditation form", () => {
    const src = read(FORM);
    expect(src).not.toContain("WAVE 342");
    expect(src).not.toContain("W298");
  });

  it("the shared accreditation clause is untouched by this wave", () => {
    const src = read("shared/accreditationClause.ts");
    expect(src).not.toContain("WAVE 342");
    expect(src).not.toContain("W298");
  });

  it("the platform's claim about status is unchanged: the reference notice still says nothing is recorded", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    const notice = screen.getByTestId("accreditation-form-reference-notice");
    expect(notice.textContent ?? "").toMatch(/nothing on this panel is recorded/i);
  });
});
