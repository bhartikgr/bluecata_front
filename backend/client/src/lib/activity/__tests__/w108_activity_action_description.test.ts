/**
 * WAVE 108 · FINDING 2 — THE ACTIVITY FEED PRINTED MACHINE EVENT CODES.
 *
 * The founder Dashboard's "Recent activity" and the founder Activity page both
 * rendered `{a.action}` straight from the wire, so the customer read
 * `founder_global_search` and `round.initial_shareholders.set`.
 *
 * The finding named two codes and warned that the real count is always higher.
 * It is: an AST sweep of every `logActivity`/`recordEvent`-shaped call site in the
 * tree (`build_log/wave108/w108_enumerate_event_codes.ts`) found
 * **167 distinct literal codes** plus **37 call sites whose code is a template or
 * a variable**, i.e. codes that may exist only at runtime. Fixing two strings
 * would have left 165 of them on the screen.
 *
 * So `describeActivityAction` is TOTAL, not a lookup table with a fallback that
 * prints the input: every one of the 167 is asserted below, and so are
 * runtime-shaped codes that appear nowhere in the source, because the 37 dynamic
 * call sites can emit them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describeActivityAction, looksLikeMachineEventCode } from "../activityActionDescription";

const INVENTORY = JSON.parse(
  readFileSync(resolve(__dirname, "..", "..", "..", "..", "..", "build_log", "wave108", "w108_event_codes.json"), "utf8"),
) as { codes: string[]; dynamic: string[] };

describe("W108 · describeActivityAction — no machine event code survives to the screen", () => {
  it("the inventory really is the whole tree, not a sample", () => {
    expect(INVENTORY.codes.length).toBeGreaterThanOrEqual(167);
    expect(INVENTORY.codes).toContain("founder_global_search");
    expect(INVENTORY.codes).toContain("round.initial_shareholders.set");
  });

  it("EVERY ONE of the codes in the tree renders as human copy", () => {
    const leaked: Array<[string, string]> = [];
    for (const code of INVENTORY.codes) {
      const out = describeActivityAction(code);
      /* Non-empty, and not the raw input passed through. */
      if (!out.trim() || out === code || looksLikeMachineEventCode(out)) leaked.push([code, out]);
      /* No snake_case, no dotted segments, no kebab identifiers. */
      if (/[a-z0-9]_[a-z0-9]/i.test(out)) leaked.push([code, out]);
      if (/[a-z0-9]\.[a-z0-9]/i.test(out)) leaked.push([code, out]);
    }
    expect(leaked).toEqual([]);
  });

  it("the two codes the finding OBSERVED read as plain English", () => {
    /* Lower-case on purpose: the feed reads "**Ada Lovelace** ran a search across
       their company **Acme**", so the description is the verb phrase in the
       middle of a sentence, not a sentence of its own. */
    expect(describeActivityAction("founder_global_search")).toBe("ran a search across their company");
    expect(describeActivityAction("round.initial_shareholders.set")).toBe("recorded the opening shareholders on a round");
  });

  it("codes that exist ONLY at runtime — the 37 dynamic call sites — are still humanised", () => {
    /* None of these strings appear in the tree; the humaniser has no entry for
       them and must still not print a machine code. This is the assertion that
       makes the function total rather than a dictionary. */
    const invented = [
      "collective.billing.invoice.paid",
      "dataroom.file_downloaded",
      "partner_connect.approved",
      "gdpr.erasure.billing_followup",
      "spv.subscription.counter_signed",
      "some_completely_unknown_event",
      "a.b.c.d.e",
      "UPPER_SNAKE_EVENT",
      "kebab-cased-event",
    ];
    for (const code of invented) {
      const out = describeActivityAction(code);
      expect(out.trim()).not.toBe("");
      expect(out).not.toBe(code);
      expect(looksLikeMachineEventCode(out)).toBe(false);
      expect(out).not.toMatch(/[a-z0-9]_[a-z0-9]/i);
      expect(out).not.toMatch(/[a-z0-9]\.[a-z0-9]/i);
    }
  });

  it("degenerate input never produces a blank line or a machine string", () => {
    for (const bad of ["", "   ", "_", ".", "__", "..", "_x_", "9", "99.99"]) {
      const out = describeActivityAction(bad);
      expect(out.trim()).not.toBe("");
      expect(looksLikeMachineEventCode(out)).toBe(false);
    }
  });

  it("looksLikeMachineEventCode identifies codes without flagging ordinary prose", () => {
    expect(looksLikeMachineEventCode("round.initial_shareholders.set")).toBe(true);
    expect(looksLikeMachineEventCode("founder_global_search")).toBe(true);
    expect(looksLikeMachineEventCode("Set the round's opening shareholders")).toBe(false);
    expect(looksLikeMachineEventCode("Ran a search across their company")).toBe(false);
  });
});

describe("W108 · Finding 2 — neither feed renders the raw wire value any more", () => {
  const files = [
    "client/src/pages/founder/Dashboard.tsx",
    "client/src/pages/founder/Activity.tsx",
  ];

  it("no rendered `{a.action}` / `{x.action}` expression remains in either feed", () => {
    /* Asserted on the SOURCE because both feeds take an untyped `any[]` from the
       wire and a render test can only ever cover the codes the fixture carries.
       This assertion covers all of them, including codes that do not exist yet. */
    for (const rel of files) {
      const src = readFileSync(resolve(__dirname, "..", "..", "..", "..", "..", rel), "utf8");
      expect(src).not.toMatch(/>\{\s*[ax]\.action\s*\}</);
      expect(src).toContain("describeActivityAction(");
      /* The raw code is still available to machines, which is allowed. */
      expect(src).toMatch(/data-action=\{\s*[ax]\.action\s*\}/);
    }
  });
});
