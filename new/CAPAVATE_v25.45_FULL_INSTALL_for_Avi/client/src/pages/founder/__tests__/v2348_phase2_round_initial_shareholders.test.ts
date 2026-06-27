/**
 * v23.4.8 Phase 2 — BUG 012 source-grep guard.
 *
 * Pins the round wizard's new "Investors" step (between Schedule and Review)
 * and its PATCH wiring to /api/founder/rounds/:id/initial-shareholders.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "..", "RoundNew.tsx"),
  "utf8",
);

describe("v23.4.8 Phase 2 — BUG 012 — Investors wizard step", () => {
  it("declares an Investors step in the STEPS array (BUG 012)", () => {
    expect(SRC).toMatch(/title:\s*"Investors"/);
    expect(SRC).toMatch(/Pick from CRM or add manually/);
  });

  it("renders the step-investors UI block with a CRM column and a Selected column", () => {
    expect(SRC).toMatch(/data-testid="step-investors"/);
    expect(SRC).toMatch(/data-testid="crm-available-column"/);
    expect(SRC).toMatch(/data-testid="selected-column"/);
  });

  it("offers a Skip button and a Manual-add dialog (non-Capavate investors)", () => {
    expect(SRC).toMatch(/data-testid="button-skip-shareholders"/);
    expect(SRC).toMatch(/data-testid="button-add-manual-shareholder"/);
    expect(SRC).toMatch(/data-testid="button-confirm-manual-shareholder"/);
  });

  it("PATCHes /api/founder/rounds/:id/initial-shareholders on round-create success", () => {
    expect(SRC).toMatch(/PATCH.*\/api\/founder\/rounds\/\$\{data\.id\}\/initial-shareholders/);
    expect(SRC).toMatch(/selectedShareholders/);
  });

  it("Review is now step 5 (Investors slots in at step 4)", () => {
    expect(SRC).toMatch(/\{step === 5 && \(/);
    expect(SRC).toMatch(/step < 5 \?/);
  });

  it("does NOT mutate any sacred file path (server roundsStore is untouched)", () => {
    // Source-grep can't enforce server purity, but we verify the wizard wires
    // initial-shareholders to a separate endpoint and never to /api/rounds.
    const sendBlock = SRC.split("onSuccess: async (data: { id: string })")[1] ?? "";
    expect(sendBlock).toMatch(/initial-shareholders/);
    // The round-create endpoint must still be /api/rounds (untouched).
    expect(SRC).toMatch(/"\/api\/rounds"/);
  });
});
