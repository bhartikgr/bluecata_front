/**
 * v23.4.8 Phase 1 — BUG 003 / 023 source-level guarantees.
 *
 * Source-grep style (vitest config in this tree globs *.test.ts only, no JSX
 * runtime) — mirrors v23.4.7 Phase 5 dashboard test pattern.
 *
 * Pins the following client behaviors:
 *   - ReportNew.tsx creates a draft and navigates to the reports list — it
 *     no longer auto-sends.
 *   - Reports.tsx exposes an Edit button on draft cards and a recipient
 *     picker before sending, with the Mail icon and explicit toast about
 *     "Report sent to N investor(s)".
 *   - Reports.tsx wires a PATCH /api/founder/reports2/:id call from the
 *     EditDraftDialog.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPORT_NEW = readFileSync(
  resolve(__dirname, "..", "ReportNew.tsx"),
  "utf8",
);
const REPORTS = readFileSync(
  resolve(__dirname, "..", "Reports.tsx"),
  "utf8",
);

describe("v23.4.8 Phase 1 — ReportNew creates draft (no auto-send)", () => {
  it("POSTs to /api/founder/reports2 and explicitly navigates to /founder/reports", () => {
    expect(REPORT_NEW).toMatch(/POST.*\/api\/founder\/reports2/);
    expect(REPORT_NEW).toMatch(/navigate\(["']\/founder\/reports["']\)/);
  });

  it("does NOT issue any send-time request from the New page", () => {
    expect(REPORT_NEW).not.toMatch(/\/reports2\/[^"' )]*\/send/);
  });

  it("toast text labels the result as a draft (not 'sent')", () => {
    expect(REPORT_NEW).toMatch(/Draft created|draft/i);
  });
});

describe("v23.4.8 Phase 1 — Reports list exposes Edit affordance + recipient picker", () => {
  it("renders an Edit button on draft cards (BUG 003 — founder must be able to edit)", () => {
    expect(REPORTS).toMatch(/data-testid=\{`button-edit-\$\{r\.id\}`\}/);
    expect(REPORTS).toMatch(/Pencil/);
  });

  it("declares the EditDraftDialog component that PATCHes /api/founder/reports2/:id", () => {
    expect(REPORTS).toMatch(/function EditDraftDialog\(/);
    expect(REPORTS).toMatch(/PATCH.*\/api\/founder\/reports2\//);
  });

  it("Send dialog includes the per-row checkbox and explicit send count (BUG 023)", () => {
    // v23.8 W-5/BUG-003 — recipients are now sourced from cap-table HOLDERS
    // (userId), not CRM rows (investorId), so the picked ids always match the
    // server's cap-table validation.
    expect(REPORTS).toMatch(/data-testid=\{`checkbox-recipient-\$\{h\.userId\}`\}/);
    expect(REPORTS).toMatch(/Send to \{selected\.size\}/);
  });

  it("Send dialog sources recipients from the cap-table holders endpoint (W-5)", () => {
    expect(REPORTS).toMatch(/\/recipients/);
    expect(REPORTS).toMatch(/CapTableHolder/);
  });

  it("send-success toast shows EXPLICIT recipient count, including failure suffix", () => {
    expect(REPORTS).toMatch(/Report sent to \$\{summary\?\.recipientCount/);
    expect(REPORTS).toMatch(/failedCount/);
  });
});
