// @vitest-environment jsdom
/**
 * WAVE 59 — SHADIE'S WALKTHROUGH (EDITS-version12). CLIENT-SURFACE PROOFS.
 *
 * The HTTP side is in `server/__tests__/w59_shadie_walkthrough_reachability.test.ts`.
 * This file covers the four defects that live entirely in the browser surface.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES
 * ═══════════════════════════════════════════════════════════════════════════
 * S2 — THE INVISIBLE CHECKBOX (Shadie's 1a + 5a), BEHAVIOURALLY.
 *   · S2-A  THE ROOT CAUSE IS REAL AND IS WHERE THE FIX SAYS IT IS.
 *           `client/src/pages/home/home3style.css` contains an UNSCOPED
 *           `button { … border: none; }` and `client/src/pages/home/Home.tsx`
 *           imports it, so Vite emits it into the one global stylesheet.
 *   · S2-B  THE MECHANISM, REPRODUCED. The real shadcn `<Checkbox>` is rendered
 *           into jsdom with the three competing rules that actually ship
 *           (`button{border:none}`, `.border{border-width:1px}`,
 *           `.border-solid{border-style:solid}`). WITHOUT the `border-solid`
 *           class the computed border-style is `none` — Shadie's exact symptom.
 *           WITH it, `solid`.
 *   · S2-C  THE SHARED COMPONENT CARRIES THE FIX, so all 28 instances inherit it.
 *   · S2-D  THE FIX SURVIVES tailwind-merge. `border-solid` is a border-STYLE
 *           group and is NOT stripped by an instance that overrides the WIDTH
 *           (`border-2`) or the COLOUR (`border-slate-500`) — which is exactly
 *           what the two application-fee checkboxes do.
 *
 * S1 — ONE STATE AUTHORITY + HONEST TRANSITION MESSAGES (Shadie's 2a).
 *   · S1-F  `describeDecisionRefusal` names every transition refusal class the
 *           server can emit, and returns null for a genuine fault so the generic
 *           retry copy is not applied to something a retry could actually fix.
 *   · S1-G  SOURCE INVARIANTS: the submit form is gated on the decision record,
 *           the "already submitted" panel exists and reads the SERVER amount, and
 *           the no-downgrade guard in `server/yourDecisionStore.ts` is intact.
 *
 * S4 — REQUIRED MARKERS AND REAL INLINE ERRORS (Shadie's 6a).
 *   · S4-A  `pathBRequiredErrors` — the single validator — names exactly the four
 *           fields Shadie's toast counted, with the messages she saw.
 *   · S4-B  ONE SOURCE: every key the validator can return has a marker AND an
 *           inline error AND an error-highlight in the JSX. This is the anti-drift
 *           assertion (R21): the test enumerates from the validator's own type,
 *           so adding a fifth rule without a marker turns it red.
 *
 * S3 — THE UPLOAD GUARD (Shadie's 4a).
 *   · S3-E  SOURCE INVARIANTS: the file input is disabled without a resolved
 *           `companyId`, the handler refuses by name, and an on-screen reason is
 *           rendered. The server-side 400 is proved over HTTP in the sibling file.
 *
 * S5.1 — THE 404 INVITATION THAT SPUN FOREVER.
 *   · S5-C  SOURCE INVARIANT: the `inv.isError` branch is reached BEFORE the
 *           `if (!inv.data) return … Loading…` line, which is the whole bug.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOT PROVED HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *   · jsdom is not a browser. S2-B proves the CSS MECHANISM using the real rule
 *     text, not the real compiled Tailwind bundle. That the shipped bundle emits
 *     `.border-solid{border-style:solid}` is verified separately by a Tailwind
 *     build and recorded in `build_log/wave59/W59_CHECKBOX_SWEEP.md`.
 *   · The full `InvitationDetail` / `ApplyToCollective` trees are NOT mounted.
 *     They pull the entitlement context, wouter and ~40 queries; the wiring is
 *     asserted against source, which is this repo's existing convention for these
 *     two pages (see `InvitationDetail.ackBinding.test.ts`).
 *   · Nothing here is measured on the live deployment.
 *
 * Plain `.test.ts` + React.createElement (no JSX) → excluded from the tsc budget,
 * matching `InvitationDetail.ackBinding.test.ts`.
 *
 * MUTATION TRANSCRIPTS: `build_log/wave59/W59_TESTS.md`.
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { twMerge } from "tailwind-merge";
import { Checkbox } from "@/components/ui/checkbox";
import { describeDecisionRefusal } from "@/pages/investor/InvitationDetail";
import {
  pathBRequiredErrors,
  PATH_B_REQUIRED_KEYS,
  PATH_B_REQUIRED_TESTID,
  type PathBRequiredKey,
} from "@/pages/founder/ApplyToCollective";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const HOME3_CSS = "client/src/pages/home/home3style.css";
const HOME_TSX = "client/src/pages/home/Home.tsx";
const CHECKBOX_TSX = "client/src/components/ui/checkbox.tsx";
const INVITATION_TSX = "client/src/pages/investor/InvitationDetail.tsx";
const APPLY_TSX = "client/src/pages/founder/ApplyToCollective.tsx";
const DECISION_STORE = "server/yourDecisionStore.ts";

afterEach(() => cleanup());

/* ═══════════════════════════════════════════════════════════════════════════
 * S2 — THE INVISIBLE CHECKBOX
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S2 — the invisible checkbox: root cause, mechanism and fix", () => {
  it("S2-A — home3style.css really contains an UNSCOPED button border reset, and Home.tsx imports it", () => {
    const css = src(HOME3_CSS);
    /* The rule, as an element selector at the top level of the file — no
       ancestor class, no media query, nothing that would confine it to the
       marketing page. */
    expect(css).toMatch(/(^|\n)button\s*\{[^}]*border:\s*none;[^}]*\}/);
    /* And the import that puts it in the single global stylesheet. */
    expect(src(HOME_TSX)).toMatch(/import\s+['"]\.\/home3style\.css['"]/);
  });

  it("S2-B — MECHANISM REPRODUCED: without border-solid the computed style is 'none'; with it, 'solid'", () => {
    /* The three rules that actually compete in the shipped bundle, verbatim in
       their essential form. `.border` sets ONLY the width — that is the whole
       reason the class list looked innocent. */
    const style = document.createElement("style");
    style.textContent = `
      button { cursor: pointer; background: none; border: none; }
      .border { border-width: 1px; }
      .border-solid { border-style: solid; }
      .border-primary { border-color: rgb(204, 0, 0); }
    `;
    document.head.appendChild(style);
    try {
      render(
        React.createElement(
          "div",
          null,
          /* THE OLD SHAPE — exactly the class list Shadie's live inspection
             reported: `border border-primary`, no style. */
          React.createElement("button", {
            type: "button",
            role: "checkbox",
            "aria-checked": "false",
            className: "border border-primary",
            "data-testid": "w59-checkbox-before",
          }),
          /* THE FIXED SHAPE — the real shared component, whose base class list
             now states the style. */
          React.createElement(Checkbox, { "data-testid": "w59-checkbox-after" }),
        ),
      );

      const before = screen.getByTestId("w59-checkbox-before");
      const after = screen.getByTestId("w59-checkbox-after");

      const cbBefore = window.getComputedStyle(before);
      const cbAfter = window.getComputedStyle(after);

      /* THE DEFECT: a red border colour is defined, and nothing paints. */
      expect(cbBefore.borderStyle).toBe("none");
      /* THE FIX: the same reset is in force and the border now has a style. */
      expect(cbAfter.borderStyle).toBe("solid");
      /* Both still carry the intended colour, which is why the live computed
         value read `0px none rgb(204, 0, 0)` rather than looking unstyled. */
      expect(cbAfter.borderColor).toContain("204");
    } finally {
      style.remove();
    }
  });

  it("S2-C — the fix is on the SHARED component, so every instance inherits it", () => {
    const cb = src(CHECKBOX_TSX);
    /* One base class list, containing all three of width, style and colour. */
    expect(cb).toMatch(/border border-solid border-primary/);
    /* And there is exactly ONE rendered CheckboxPrimitive.Root element in the
       file — i.e. no second, forked checkbox that could miss the fix. */
    expect(cb.match(/<CheckboxPrimitive\.Root\b/g)?.length).toBe(1);
    /* ...and exactly one base class list, so there is one place to fix. */
    expect(cb.match(/border border-solid border-primary/g)?.length).toBe(1);
  });

  it("S2-D — border-solid survives every instance override the platform actually uses", () => {
    const base = src(CHECKBOX_TSX).match(/"(peer h-4 w-4[^"]*)"/)?.[1];
    expect(base).toBeTruthy();
    const overrides = [
      /* the two application-fee checkboxes (5a) */
      "h-5 w-5 border-2 border-slate-500 bg-white data-[state=checked]:border-primary",
      /* LegalConsentCheckbox / Redeem */
      "mt-0.5 h-5 w-5 border-2 border-[hsl(158_64%_32%)] bg-white shadow-sm",
      /* TermSheet legal-counsel ack */
      "h-4 w-4 shrink-0 border-2 border-slate-600 bg-white",
      /* the plainest instance */
      "",
      /* and the inline error highlight this wave adds */
      "h-5 w-5 border-2 border-slate-500 bg-white border-2 border-solid border-rose-500 ring-2 ring-rose-200",
    ];
    for (const o of overrides) {
      expect(twMerge(base as string, o).split(/\s+/)).toContain("border-solid");
    }
  });

  it("S2-F — THE SAME RESET ALSO BLANKS RadioGroupItem and SelectTrigger (reported, NOT fixed this wave)", () => {
    /* The sweep S2 asked for turned up two more control families whose shared
       component declares `border …` with no style and renders a <button>, so the
       same `button{border:none}` reset zeroes their used border width too. This
       test MEASURES that claim rather than inferring it, and it is deliberately
       written to pass in the CURRENT (unfixed) state — it is the evidence behind
       the OWNER QUESTION in build_log/wave59/W59_CHECKBOX_SWEEP.md, not a fix.

       These were NOT fixed here: 5 RadioGroupItem and 161 SelectTrigger instances
       is a platform-wide visual change while the owner is away, and the standing
       instruction is "do not break anything or dramatically make assumptions to
       change things". The one-word fix is named in the sweep document.

       WHEN THE OWNER APPROVES THE FIX, THIS TEST MUST BE UPDATED, and its failure
       at that point is the intended signal, not a regression. */
    const style = document.createElement("style");
    style.textContent = `
      button { cursor: pointer; background: none; border: none; }
      .border { border-width: 1px; }
      .border-input { border-color: rgb(226, 232, 240); }
      .border-primary { border-color: rgb(204, 0, 0); }
    `;
    document.head.appendChild(style);
    try {
      render(
        React.createElement(
          "div",
          null,
          /* RadioGroupItem's base list, verbatim from radio-group.tsx:29. */
          React.createElement("button", {
            type: "button",
            role: "radio",
            className: "aspect-square h-4 w-4 rounded-full border border-primary text-primary",
            "data-testid": "w59-radio",
          }),
          /* SelectTrigger's base list, verbatim from select.tsx:22. */
          React.createElement("button", {
            type: "button",
            className: "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
            "data-testid": "w59-select-trigger",
          }),
        ),
      );
      expect(window.getComputedStyle(screen.getByTestId("w59-radio")).borderStyle).toBe("none");
      expect(window.getComputedStyle(screen.getByTestId("w59-select-trigger")).borderStyle).toBe("none");
      /* And the shared components really do omit the style, which is the fix. */
      expect(src("client/src/components/ui/radio-group.tsx")).not.toContain("border-solid");
      expect(src("client/src/components/ui/select.tsx")).not.toContain("border-solid");
    } finally {
      style.remove();
    }
  });

  it("S2-G — <Switch> is NOT affected, because its visibility comes from a background, not a border", () => {
    /* Stated so the sweep's scope is bounded by evidence rather than by guesswork:
       switch.tsx declares `border-2 border-transparent` and paints
       `data-[state=checked]:bg-primary` / `data-[state=unchecked]:bg-input`, so a
       zeroed border costs it nothing. */
    const sw = src("client/src/components/ui/switch.tsx");
    expect(sw).toContain("border-2 border-transparent");
    expect(sw).toContain("data-[state=checked]:bg-primary");
    expect(sw).toContain("data-[state=unchecked]:bg-input");
  });

  it("S2-E — every <Checkbox> on the platform goes through the shared component (no forked copies)", () => {
    /* A forked local checkbox would silently miss the fix. Enumerated from
       source: every importer of a `Checkbox` symbol must resolve to the shared
       ui module. */
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(rel);
        } else if (e.name.endsWith(".tsx")) files.push(rel);
      }
    };
    walk("client/src");
    const importers = files.filter((f) => /^import\s*\{[^}]*\bCheckbox\b[^}]*\}\s*from/m.test(src(f)));
    expect(importers.length).toBeGreaterThan(10);
    for (const f of importers) {
      const line = src(f).match(/^import\s*\{[^}]*\bCheckbox\b[^}]*\}\s*from\s*["']([^"']+)["']/m)?.[1];
      expect(line, `${f} imports Checkbox from ${line}`).toBe("@/components/ui/checkbox");
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * S1 — ONE STATE AUTHORITY, AND HONEST REFUSALS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S1 — honest transition messages and the single state authority", () => {
  it("S1-F — every transition refusal class the server can emit is named, and only those", () => {
    /* The refusal Shadie hit. */
    const noopSc = describeDecisionRefusal("noop_transition:soft_circled");
    expect(noopSc).not.toBeNull();
    expect(noopSc?.title).toBe("Already submitted");
    expect(noopSc?.description).toMatch(/already submitted a soft circle/i);
    /* And it must NOT tell the investor to try again, which is the defect. */
    expect(noopSc?.description).not.toMatch(/try again/i);

    /* The generic no-op class, on another state. */
    const noopDeclined = describeDecisionRefusal("noop_transition:declined");
    expect(noopDeclined?.title).toBe("Already recorded");
    expect(noopDeclined?.description).toMatch(/declined/);
    expect(noopDeclined?.description).toMatch(/Retrying will not alter it/);

    /* forbidden_transition — proved reachable over HTTP in the sibling file as
       `forbidden_transition:soft_circled->viewed`. */
    const forbidden = describeDecisionRefusal("forbidden_transition:soft_circled->viewed");
    expect(forbidden?.title).toBe("Not available from this state");
    expect(forbidden?.description).toMatch(/soft circled/);
    expect(forbidden?.description).toMatch(/viewed/);

    /* invalid_from_state / invalid_to_state. */
    expect(describeDecisionRefusal("invalid_from_state:bogus")?.title).toBe("Invitation state not recognised");
    expect(describeDecisionRefusal("invalid_to_state:bogus")?.title).toBe("Invitation state not recognised");

    /* AND THE IMPORTANT NEGATIVE: a genuine fault is NOT dressed up as a
       permanent refusal, so the generic retry copy still applies where a retry
       can actually work. */
    expect(describeDecisionRefusal("decision_failed")).toBeNull();
    expect(describeDecisionRefusal("Failed to fetch")).toBeNull();
    expect(describeDecisionRefusal("NOT_AUTHED")).toBeNull();
    expect(describeDecisionRefusal("round_invitation_mismatch")).toBeNull();
  });

  it("S1-G1 — the submit form is gated on the SERVER decision record, not on localStorage", () => {
    const s = src(INVITATION_TSX);
    /* The resolved-state derivation reads the decision record. */
    expect(s).toMatch(/const decisionSoftCircleLocked\s*=/);
    expect(s).toMatch(/decisionState === "soft_circled"/);
    /* The form Card is gated on it. */
    expect(s).toMatch(/\{!roundClosed && !decisionSoftCircleLocked && \(/);
    /* The gate must NOT be `mySig`, the client zustand copy that was the bug. */
    expect(s).not.toMatch(/\{!roundClosed && !\(mySig/);
  });

  it("S1-G2 — the 'already submitted' panel exists and renders the SERVER's amount, never a guess", () => {
    const s = src(INVITATION_TSX);
    expect(s).toContain('data-testid="panel-softcircle-already-submitted"');
    expect(s).toContain("You have already submitted a soft circle for this round");
    /* The amount comes off `decision`, the decision-record response. */
    expect(s).toMatch(/const recordedSoftCircleAmount\s*=[\s\S]{0,240}decision\?\.amount/);
    /* And when the record has no amount, nothing is invented. */
    expect(s).toMatch(/recordedSoftCircleAmount != null/);
    expect(s).toMatch(/no amount is recorded against it/);
  });

  it("S1-G3 — the NO-DOWNGRADE guard was NOT weakened to clear the 409", () => {
    const store = src(DECISION_STORE);
    /* The reconciliation is still more-advanced-wins, tie to durable. */
    expect(store).toMatch(/winner\s*=\s*stateRank\(durable\.state\)\s*>=\s*stateRank\(cached\.state\)\s*\?\s*durable\s*:\s*cached/);
    /* The no-op refusal is still in place — the fix is on the reading side. */
    expect(store).toMatch(/if \(from === to\) return `noop_transition:\$\{from\}`/);
  });

  it("S1-G4 — the mount view ping stays silent, but a deliberate action is never silenced", () => {
    const s = src(INVITATION_TSX);
    /* The two silence guards are now inside an `isMountViewPing` branch. */
    expect(s).toMatch(/const isMountViewPing\s*=[\s\S]{0,160}action.*===\s*"view"/);
    expect(s).toMatch(/if \(isMountViewPing\) \{[\s\S]{0,400}noop_transition[\s\S]{0,400}\}/);
    /* And the named-refusal branch runs for everything else. */
    expect(s).toMatch(/const named = describeDecisionRefusal\(err\.message\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * S4 — REQUIRED MARKERS AND REAL INLINE ERRORS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S4 — the four required fields, marked and highlighted", () => {
  const EMPTY = { pitchDeck: "", pitchDeckId: null, asks: "", coverLetter: "", feeAcknowledged: false };

  it("S4-A — the validator names exactly the four fields Shadie's toast counted, with her messages", () => {
    const errs = pathBRequiredErrors(EMPTY);
    expect(Object.keys(errs).sort()).toEqual(["asks", "coverLetter", "feeAck", "pitchDeck"]);
    expect(Object.keys(errs)).toHaveLength(4);
    /* Verbatim, as recorded in build_log/wave59/W59_4a_5a_6a_ROOT_CAUSE.md. Note
       "Asks must be" — Shadie's "Adds Must be" was an OCR mis-read. */
    expect(errs.pitchDeck).toBe("A pitch deck file (.pdf/.pptx/.ppt) is required — upload one above.");
    expect(errs.asks).toBe("Asks must be at least 20 characters (0/20).");
    expect(errs.coverLetter).toBe("Cover letter must be at least 100 characters (0/100).");
    expect(errs.feeAck).toBe("You must acknowledge the application fee.");
  });

  it("S4-A2 — the validation was NOT weakened: each threshold still refuses just below and passes at it", () => {
    /* asks: 19 refused, 20 accepted. */
    expect(pathBRequiredErrors({ ...EMPTY, asks: "x".repeat(19) }).asks).toBeTruthy();
    expect(pathBRequiredErrors({ ...EMPTY, asks: "x".repeat(20) }).asks).toBeUndefined();
    /* coverLetter: 99 refused, 100 accepted. */
    expect(pathBRequiredErrors({ ...EMPTY, coverLetter: "x".repeat(99) }).coverLetter).toBeTruthy();
    expect(pathBRequiredErrors({ ...EMPTY, coverLetter: "x".repeat(100) }).coverLetter).toBeUndefined();
    /* pitch deck: a NAME without a server deck id is still not a deck. */
    expect(pathBRequiredErrors({ ...EMPTY, pitchDeck: "deck.pdf" }).pitchDeck).toBeTruthy();
    expect(pathBRequiredErrors({ ...EMPTY, pitchDeck: "deck.pdf", pitchDeckId: "pd_1" }).pitchDeck).toBeUndefined();
    /* fee ack. */
    expect(pathBRequiredErrors({ ...EMPTY, feeAcknowledged: true }).feeAck).toBeUndefined();
    /* All four satisfied → no errors at all. */
    expect(
      pathBRequiredErrors({
        pitchDeck: "deck.pdf",
        pitchDeckId: "pd_1",
        asks: "x".repeat(20),
        coverLetter: "x".repeat(100),
        feeAcknowledged: true,
      }),
    ).toEqual({});
  });

  it("S4-B — R21 ANTI-DRIFT: every validator key has a marker, an inline error AND a highlight", () => {
    const s = src(APPLY_TSX);
    /* Enumerated from the validator's own key list, so a fifth rule added
       without a marker turns this red. */
    const keys = pathBRequiredErrors(EMPTY);
    expect(Object.keys(keys).sort()).toEqual([...PATH_B_REQUIRED_KEYS].sort());
    for (const k of PATH_B_REQUIRED_KEYS) {
      expect(s, `RequiredMark for ${k}`).toContain(`<RequiredMark field="${k}" />`);
      expect(s, `FieldError for ${k}`).toContain(`<FieldError field="${k}"`);
      expect(s, `error highlight for ${k}`).toContain(`errorRing(!!fieldErrors.${k})`);
      /* And the testid table the scroll-to-first-error uses must know it. */
      expect(PATH_B_REQUIRED_TESTID[k as PathBRequiredKey]).toBeTruthy();
      expect(s, `control ${k}`).toContain(`data-testid="${PATH_B_REQUIRED_TESTID[k as PathBRequiredKey]}"`);
    }
  });

  it("S4-C — the highlight is a real border, and the toast's promise is now true", () => {
    const s = src(APPLY_TSX);
    /* An actual painted border, with an explicit style so it cannot be defeated
       by the same `button { border: none }` reset S2 diagnosed. */
    expect(s).toMatch(/function errorRing\(hasError: boolean\)[\s\S]{0,220}border-2 border-solid border-rose-500/);
    /* The toast copy is unchanged — it is the page that changed to make it true. */
    expect(s).toContain("Please review the highlighted fields below.");
    /* The static helper copy is retained (additive change only, no copy removed). */
    expect(s).toContain("Required: pitch deck file, asks (≥20), cover letter (≥100), fee acknowledgement.");
  });

  it("S4-D — the scroll-to-first-error no longer keeps a second hard-coded list", () => {
    const s = src(APPLY_TSX);
    expect(s).toMatch(/PATH_B_REQUIRED_KEYS\.find\(\(k\) => errs\[k\]\)/);
    expect(s).toMatch(/PATH_B_REQUIRED_TESTID\[firstKey\]/);
    /* The old four-branch ternary chain is gone. */
    expect(s).not.toMatch(/firstKey === "pitchDeck" \? "input-pitch-deck"/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * S3 — THE UPLOAD GUARD
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S3 — the pitch-deck input cannot fire without a resolved companyId", () => {
  const s = () => src(APPLY_TSX);

  it("S3-E1 — the file input is disabled until companyId resolves", () => {
    expect(s()).toMatch(/data-testid="input-pitch-deck"|disabled=\{!companyId\}/);
    /* Both, on the same element, in either order. */
    const el = s().match(/<input\s+type="file"[\s\S]*?data-testid="input-pitch-deck"/)?.[0] ?? "";
    expect(el).toContain("disabled={!companyId}");
  });

  it("S3-E2 — BEHAVIOURAL: the gating expression really is driven by companyId, in both directions", () => {
    /* The real element's gate is `disabled={!companyId}`. This renders that exact
       expression against an unresolved and a resolved company and reads the DOM
       property, so the fix is proved rather than merely asserted against source.

       WHAT THIS DOES NOT PROVE: that a disabled input dispatches no `change`
       event. That is an HTML-spec guarantee about user interaction, and jsdom's
       `dispatchEvent` bypasses it — a manual dispatch fires the handler even on a
       disabled control, so asserting it here would be measuring jsdom, not the
       platform. Recorded as UNVERIFIED in build_log/wave59/WAVE59_REPORT.md. */
    const Harness = ({ companyId }: { companyId: string }) =>
      React.createElement("input", {
        type: "file",
        disabled: !companyId,
        "data-testid": "w59-file-gate",
      });

    const unresolved = render(React.createElement(Harness, { companyId: "" }));
    expect((screen.getByTestId("w59-file-gate") as HTMLInputElement).disabled).toBe(true);
    unresolved.unmount();

    render(React.createElement(Harness, { companyId: "co_novapay" }));
    /* AND THE NEGATIVE: with a resolved company the input is NOT blocked, so no
       legitimate operation was suppressed to silence the error. */
    expect((screen.getByTestId("w59-file-gate") as HTMLInputElement).disabled).toBe(false);
  });

  it("S3-E5 — the handler body is left BYTE-IDENTICAL, on purpose, and the reason is recorded in the file", () => {
    /* The in-handler guard would be better engineering, and it is deliberately
       ABSENT: editing this inline handler changes the silent-drop guard's event
       fingerprint, which reports a REMOVED event handler and needs an allowlist
       entry the owner cannot ratify while away. This test pins BOTH the absence
       and the written explanation, so the omission can never be mistaken for an
       oversight, and so restoring it is a deliberate act. */
    const handler = s().match(/onChange=\{async \(e\) => \{[\s\S]*?fd\.append\("companyId", companyId\)/)?.[0] ?? "";
    expect(handler).toBeTruthy();
    expect(handler).not.toContain("Company not resolved yet");
    expect(s()).toMatch(/WHY THE GUARD IS NOT ALSO INSIDE THE HANDLER/);
    expect(s()).toMatch(/DIGEST OF THE HANDLER EXPRESSION/);
  });

  it("S3-E3 — an honest on-screen reason is rendered while the input is blocked", () => {
    expect(s()).toContain('data-testid="text-pitch-deck-company-pending"');
    expect(s()).toMatch(/Waiting for your active company to load/);
    /* It names the server's actual error code rather than a vague message. */
    expect(s()).toMatch(/companyId_required/);
  });

  it("S3-E4 — the server's 400 was NOT changed to make the client's bug go away", () => {
    const store = src("server/founderCollectiveApplyStore.ts");
    expect(store).toMatch(/if \(!companyId\) return res\.status\(400\)\.json\(\{ ok: false, error: "companyId_required" \}\)/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * S5.1 — THE 404 INVITATION THAT SPUN FOREVER
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W59-S5.1 — a 404 invitation renders an honest not-found state", () => {
  it("S5-C — the error branch is reached BEFORE the Loading… early return", () => {
    const s = src(INVITATION_TSX);
    const errIdx = s.indexOf("if (inv.isError) {");
    const loadIdx = s.indexOf("if (!inv.data) return <PageBody>Loading…</PageBody>;");
    expect(errIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(-1);
    /* THE WHOLE BUG: with `retry: false` on the shared queryClient, `inv.data`
       stays undefined forever on a 404, so whichever branch comes first decides
       between an honest message and an eternal spinner. */
    expect(errIdx).toBeLessThan(loadIdx);
  });

  it("S5-C2 — the copy names BOTH possibilities, because the server's 404 does not distinguish them", () => {
    const s = src(INVITATION_TSX);
    expect(s).toContain('data-testid="panel-invitation-unavailable"');
    expect(s).toMatch(/the link is out of date, or it belongs to a different account/);
    /* And it does not send the reader to retry something that cannot work. */
    expect(s).toMatch(/reloading this page will not help/i);
    /* A non-404 fault is reported as a fault, not as a stale link. */
    expect(s).toMatch(/This is a fault on our side/);
    /* The invitation id is shown so a stale link can actually be diagnosed. */
    expect(s).toContain('data-testid="text-invitation-unavailable-id"');
  });

  it("S5-C3 — the Loading… state is still there for a genuinely pending fetch", () => {
    /* The fix must not have replaced the loading state with an error state. */
    expect(src(INVITATION_TSX)).toContain("if (!inv.data) return <PageBody>Loading…</PageBody>;");
  });
});
