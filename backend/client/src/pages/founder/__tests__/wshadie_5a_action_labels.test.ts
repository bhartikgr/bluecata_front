/**
 * W-SHADIE 5a — the three invitation action buttons render a visible text
 * label after their icon, so a founder can tell them apart without hovering.
 *
 * ANTI-VACUITY: "Resend" already appears in this file inside `resendMut` and in
 * comments, and each button now also carries an aria-label containing the same
 * word — so a file-wide (or even button-wide) `toContain("Resend")` would pass
 * against icon-only buttons. Every assertion below targets the VISIBLE TEXT
 * NODE between the icon's self-closing tag and </Button>.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../RoundDetail.tsx"), "utf8");

/** Extract the full <Button>…</Button> element carrying the given testid. */
function buttonByTestId(testIdPrefix: string): string {
  const idx = SRC.indexOf(`data-testid={\`${testIdPrefix}-\${i.id}\`}`);
  expect(idx, `${testIdPrefix} button not found`).toBeGreaterThan(-1);
  const start = SRC.lastIndexOf("<Button", idx);
  const end = SRC.indexOf("</Button>", idx);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(idx);
  return SRC.slice(start, end + "</Button>".length);
}

const CASES = [
  { testId: "button-resend", label: "Resend", icon: "Repeat" },
  { testId: "button-expiry", label: "Extend", icon: "Calendar" },
  { testId: "button-revoke", label: "Revoke", icon: "Ban" },
] as const;

describe("W-SHADIE 5a — visible action labels", () => {
  for (const { testId, label, icon } of CASES) {
    describe(`${testId} → "${label}"`, () => {
      it("renders the label as a VISIBLE TEXT NODE, not just an aria-label", () => {
        const btn = buttonByTestId(testId);
        // Icon-then-label: `<Icon … />Label</Button>`. Reverting to icon-only
        // yields `/></Button>`, which cannot match.
        expect(btn).toMatch(new RegExp(`/>\\s*${label}\\s*</Button>$`));
      });

      it("renders the icon BEFORE the label (owner decision: icon-then-label)", () => {
        const btn = buttonByTestId(testId);
        const iconIdx = btn.indexOf(`<${icon}`);
        const labelIdx = btn.lastIndexOf(label);
        expect(iconIdx, `${icon} icon missing`).toBeGreaterThan(-1);
        expect(iconIdx).toBeLessThan(labelIdx);
        expect(btn).toContain(`<${icon} className="h-3.5 w-3.5 mr-1" />`);
      });

      it("keeps its data-testid unchanged", () => {
        const btn = buttonByTestId(testId);
        expect(btn).toContain(`data-testid={\`${testId}-\${i.id}\`}`);
      });

      it("carries an aria-label as well", () => {
        expect(buttonByTestId(testId)).toContain('aria-label="');
      });

      it("still has a disabled expression (behaviour preserved)", () => {
        expect(buttonByTestId(testId)).toContain("disabled={");
      });
    });
  }

  it("preserves the exact terminal-state disabled logic", () => {
    expect(buttonByTestId("button-resend")).toContain(
      'disabled={resendMut.isPending || i.state === "accepted" || i.state === "revoked"}',
    );
    expect(buttonByTestId("button-expiry")).toContain(
      'disabled={extendExpiryMut.isPending || i.state === "revoked" || i.state === "accepted"}',
    );
    expect(buttonByTestId("button-revoke")).toContain('disabled={i.state === "revoked"}');
  });

  it("keeps the destructive styling on Revoke", () => {
    expect(buttonByTestId("button-revoke")).toContain("text-destructive");
  });
});
