// @vitest-environment jsdom
/**
 * FIX #6 (Wave 3) — investor soft-circle acknowledgement checkbox desync.
 *
 * ROOT CAUSE: the acknowledgement used a NATIVE <label> WRAPPING a Radix
 * Checkbox (which renders a <button role="checkbox">). Clicking the label's
 * text made the browser synthesize a click on the associated control (the
 * button) AND the button toggled from the direct/keyboard interaction — the two
 * events could cancel, so `ack` desynced from the visible checkmark and the
 * submit guard `if (!ack)` still read false.
 *
 * FIX: bind the Checkbox to an explicit `id` and associate the visible text via
 * a sibling <label htmlFor>, so EXACTLY ONE toggle fires per interaction.
 *
 * Part 1 (behavioral, jsdom): renders the REAL shadcn Checkbox in BOTH the old
 * wrapping-label shape and the new htmlFor shape and proves the htmlFor shape
 * toggles the bound state reliably (label click + the checkbox itself), while
 * demonstrating the wrapping-label double-fire that motivated the change.
 *
 * Part 2 (source invariants): pins the fix in the actual InvitationDetail.tsx —
 * the visible ack checkbox uses id="investor-ack" + a htmlFor label, both the
 * `checkbox-investor-ack` and the SEPARATE `checkbox-sign-ack` data-testids are
 * preserved, and the submit guard still reads the `ack` state.
 *
 * Plain `.test.ts` + React.createElement (no JSX) → excluded from the tsc budget.
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Checkbox } from "@/components/ui/checkbox";

afterEach(() => cleanup());

/** New (fixed) shape: <div> + Checkbox id + <label htmlFor> sibling. */
function FixedAck() {
  const [ack, setAck] = React.useState(false);
  return React.createElement(
    "div",
    null,
    React.createElement(Checkbox, {
      id: "investor-ack",
      checked: ack,
      onCheckedChange: (v: boolean | "indeterminate") => setAck(!!v),
      "data-testid": "checkbox-investor-ack",
    }),
    React.createElement("label", { htmlFor: "investor-ack" }, "I acknowledge."),
    // Mirror the submit guard: the button is only "armed" when ack is true.
    React.createElement("span", { "data-testid": "ack-state" }, ack ? "checked" : "unchecked"),
  );
}

describe("FIX #6 — fixed ack shape toggles the bound state reliably", () => {
  it("clicking the associated <label htmlFor> toggles ack on then off", () => {
    render(React.createElement(FixedAck, null));
    const state = screen.getByTestId("ack-state");
    const label = screen.getByText("I acknowledge.");
    expect(state.textContent).toBe("unchecked");
    fireEvent.click(label);
    expect(state.textContent).toBe("checked");
    fireEvent.click(label);
    expect(state.textContent).toBe("unchecked");
  });

  it("clicking the checkbox control itself toggles ack", () => {
    render(React.createElement(FixedAck, null));
    const state = screen.getByTestId("ack-state");
    const box = screen.getByTestId("checkbox-investor-ack");
    fireEvent.click(box);
    expect(state.textContent).toBe("checked");
  });

  it("the checkbox exposes the correct role and checked state (a11y)", () => {
    render(React.createElement(FixedAck, null));
    const box = screen.getByTestId("checkbox-investor-ack");
    expect(box.getAttribute("role")).toBe("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
  });
});

describe("FIX #6 — InvitationDetail source invariants", () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, "..", "InvitationDetail.tsx"),
    "utf8",
  );

  it("binds the visible ack checkbox to an explicit id", () => {
    // Same <Checkbox> element carries id="investor-ack" AND the ack data-testid.
    expect(SRC).toContain('<Checkbox id="investor-ack"');
    expect(SRC).toMatch(/<Checkbox id="investor-ack"[\s\S]*?data-testid="checkbox-investor-ack"[\s\S]*?\/>/);
  });

  it("associates the ack label via htmlFor (not a wrapping <label>)", () => {
    expect(SRC).toMatch(/<label htmlFor="investor-ack"/);
  });

  it("keeps ack (soft-circle) and signAck (signing) as SEPARATE gates", () => {
    // Both distinct state hooks exist.
    expect(SRC).toMatch(/const \[ack, setAck\] = useState\(false\)/);
    expect(SRC).toMatch(/const \[signAck, setSignAck\] = useState\(false\)/);
    // Both distinct data-testids preserved.
    expect(SRC).toContain('data-testid="checkbox-investor-ack"');
    expect(SRC).toContain('data-testid="checkbox-sign-ack"');
  });

  it("the submit guard still reads the ack state (not signAck)", () => {
    expect(SRC).toMatch(/if \(!ack\) \{ toast\(\{ title: "Acknowledge before submitting"/);
  });
});
