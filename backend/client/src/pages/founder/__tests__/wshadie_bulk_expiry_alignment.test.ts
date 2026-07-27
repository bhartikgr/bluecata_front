/**
 * W-SHADIE 3a (bulk CSV) — the bulk-import path is aligned to the same 7-day
 * default as the two dialogs.
 *
 * This route does NOT call createInvitation; it computes its own expiry and
 * inserts directly, so the `?? 14` reasoning that covers the other paths does
 * not apply here. It was a genuine third behaviour: server-set 14 days while
 * the dialog copy promised 30.
 *
 * GUARDRAIL: the server's `?? 14` OMISSION fallbacks in roundInvitationsStore
 * are deliberately NOT changed — waveC3_invite_preview_and_round_name.test.ts
 * depends on the 14-day render when expiryDays is omitted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const BULK_SRC = readFileSync(
  resolve(__dirname, "../../../../../server/lib/bulkInvitationsRoutes.ts"),
  "utf8",
);

const STORE_SRC = readFileSync(
  resolve(__dirname, "../../../../../server/roundInvitationsStore.ts"),
  "utf8",
);

describe("W-SHADIE 3a — bulk CSV expiry alignment", () => {
  it("computes a 7-day expiry", () => {
    expect(BULK_SRC).toContain("const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();");
  });

  it("email copy (html + text) promises 7 days", () => {
    expect(BULK_SRC).toContain("This invitation expires in 7 days.</p>");
    expect(BULK_SRC).toContain("`This invitation expires in 7 days.`");
  });

  it("NO residual 14 anywhere in the bulk route", () => {
    expect(BULK_SRC).not.toMatch(/\b14\b/);
  });
});

describe("W-SHADIE 3a — server omission fallbacks deliberately unchanged", () => {
  it("createInvitation still applies ?? 14 when expiryDays is omitted", () => {
    // Changing this would break waveC3_invite_preview_and_round_name.test.ts:45
    // and would alter behaviour for callers that omit the field entirely.
    expect(STORE_SRC).toContain("plusDaysIso(args.expiryDays ?? 14)");
  });
});
