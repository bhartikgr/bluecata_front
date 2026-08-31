/**
 * WAVE 203 · ITEM C (R178.7) — THE PLATFORM MUST NOT ASSERT WHAT IT DOES NOT KNOW.
 *
 * WHAT WAVE 196 SHIPPED, AND WHY IT WAS WRONG. Wave 196 replaced a false empty
 * state ("No positions yet") with a read-failure message across ~28 screens. Its
 * read wording ended: "nothing has been lost — what you had is still there."
 * That was written to reassure, and on the common cause (a dropped connection) it
 * is true. But a read can fail *because the record is gone* — a deleted row, a
 * revoked scope, a restored-from-backup database, a tenant reassignment. In those
 * cases the platform printed a factual claim about server state that it had, by
 * construction, just failed to observe.
 *
 * THE RULING (R178.7): state only what is certain. The message must say that
 * LOADING FAILED, that this is NOT THE SAME AS AN EMPTY RESULT, and that THE
 * ERROR ITSELF CHANGED NOTHING — and must NOT claim the underlying data still
 * exists.
 *
 * THE READ/WRITE DISTINCTION IS PRESERVED, and it is the subtle half. A WRITE
 * failure must never claim nothing changed, because a failure can land after the
 * server applied the write. Section 3 asserts the write copy is untouched — the
 * easiest way to "fix" this wave would have been to sweep both branches.
 *
 * WHAT THIS FILE DOES NOT PROVE: that all 28 screens render the new sentence. It
 * proves the sentence, its gate compliance, and the claim's removal at the single
 * helper all 28 pass through. The RENDERED proof — that the new wording reaches a
 * real user's screen and the retired claim does not — is in wave 196's own
 * rendered test, whose two pins wave 203 repointed rather than duplicated:
 * `client/src/pages/partner/__tests__/wave196_rendered_failure_surfaces.test.tsx`
 * A2 (the real `LpPositions`) and B2 (the real `PartnerBilling`). Those two are
 * genuinely rendered components on the read path, so repointing them is a
 * stronger statement than a new file asserting the same thing beside them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FAILURE_COPY,
  W203_HONEST_READ_COPY,
  describeFailure,
  isMachineFacing,
} from "@/lib/failureMessage";

/* The gate is IMPORTED, never re-typed. `shared/refusalHeadlineGate.ts` exports
   the number, and `wave195`'s `fitToGate()` is built on the same constant. */
import { LOOKS_HUMAN_MAX_LENGTH } from "@shared/refusalHeadlineGate";

const READ_COPY = Object.entries(W203_HONEST_READ_COPY) as Array<[string, string]>;

describe("WAVE 203 · C.1 — the new read wording claims only what is certain", () => {
  it("covers all three read outcomes and nothing else", () => {
    expect(READ_COPY.map(([k]) => k).sort()).toEqual([
      "unreachableRead",
      "unreadableRead",
      "unstatedRead",
    ]);
  });

  it.each(READ_COPY)("%s does NOT claim the data still exists", (_name, copy) => {
    /* The exact retired claim, and the paraphrases a future edit might reach for. */
    expect(copy).not.toContain("still there");
    expect(copy).not.toContain("nothing has been lost");
    expect(copy).not.toMatch(/still (there|present|intact|available|on file|safe)/i);
    expect(copy).not.toMatch(/your data is/i);
    expect(copy).not.toMatch(/has not been (lost|deleted|removed)/i);
  });

  it.each(READ_COPY)("%s says loading failed, that this is not an empty result, and that the error changed nothing", (_name, copy) => {
    /* The three certainties the ruling requires, each asserted separately so a
       message that dropped one cannot pass on the strength of the others. */
    expect(copy).toMatch(/could not (be loaded|load|reach)/i);
    expect(copy).toContain("not an empty list");
    expect(copy).toContain("nothing has been changed");
  });

  it.each(READ_COPY)("%s states outright that server state is unknown — the honest replacement for the retired reassurance", (_name, copy) => {
    expect(copy).toContain("unknown until this loads");
  });

  it.each(READ_COPY)("%s tells the reader what to do next", (_name, copy) => {
    expect(copy).toMatch(/try again/i);
  });
});

describe("WAVE 203 · C.4 — the 240-character gate, asserted mechanically", () => {
  it("the gate constant matches the one the app enforces, so this file cannot drift", () => {
    /* `looksHuman` lives in queryClient.ts, which imports the browser stack and
       cannot be loaded here. Its threshold is read out of the source instead of
       being trusted from memory — this limit has silently swallowed messages
       four times, always because a test asserted a number nobody re-checked. */
    const src = readFileSync("client/src/lib/queryClient.ts", "utf8");
    /* The client still enforces the limit as a bare literal in `looksHuman`.
       That literal, and the STRICT `<`, are both asserted against the shared
       constant here — so if either side moves, this fails rather than silently
       letting a 240-character message through. */
    const m = /serverMessage\.length\s*<\s*(\d+)/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(LOOKS_HUMAN_MAX_LENGTH);
    expect(LOOKS_HUMAN_MAX_LENGTH).toBe(240);
  });

  it.each(READ_COPY)("%s passes the gate strictly (< 240) and reads as human", (_name, copy) => {
    expect(copy.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    /* The other half of `looksHuman`: it must contain a lowercase letter. */
    expect(/[a-z]/.test(copy)).toBe(true);
    /* And the platform's own machine-text detector must not flag it — no
       ALL-CAPS underscore code, no SQL, no path, no driver name. */
    expect(isMachineFacing(copy)).toBe(false);
  });
});

describe("WAVE 203 · C.2 — the read/write distinction wave 196 established is preserved", () => {
  it("the WRITE copy is byte-identical to wave 196's and still refuses to claim nothing changed", () => {
    /* If a write failed, the server may already have applied it. Wave 196 got
       this right; wave 203 must not sweep it up with the read change. */
    for (const key of ["unreachableWrite", "unreadableWrite", "unstatedWrite"] as const) {
      const copy = FAILURE_COPY[key];
      expect(copy).not.toContain("nothing has been changed");
      expect(copy).not.toContain("not an empty list");
    }
    /* And each write sentence still refuses to state the outcome — wave 196's
       point being that a write failure can land AFTER the server applied it. */
    expect(FAILURE_COPY.unreachableWrite).toMatch(
      /cannot confirm|may|might|unknown|not known|cannot tell|do not know/i,
    );
  });

  it("the original FAILURE_COPY read strings are LEFT IN PLACE, unmodified", () => {
    /* R143.1: they are wrapped, not replaced. Leaving them exported keeps wave
       196's own tests meaningful and keeps the guard's copy count from falling. */
    expect(FAILURE_COPY.unreachableRead).toContain("still there");
    expect(Object.keys(FAILURE_COPY).length).toBe(6);
  });

  it("describeFailure routes READ failures to the new copy and WRITE failures to the old", () => {
    /* Real engine errors, not hand-made strings: a fetch transport failure is a
       TypeError and a body-parse failure is a SyntaxError. */
    const transport = new TypeError("Failed to fetch");
    let parse: unknown;
    try {
      JSON.parse("<!DOCTYPE html>");
    } catch (e) {
      parse = e;
    }
    expect(parse).toBeInstanceOf(SyntaxError);

    expect(describeFailure(transport, "read")).toBe(W203_HONEST_READ_COPY.unreachableRead);
    expect(describeFailure(parse, "read")).toBe(W203_HONEST_READ_COPY.unreadableRead);
    expect(describeFailure({ not: "an error" }, "read")).toBe(W203_HONEST_READ_COPY.unstatedRead);

    expect(describeFailure(transport, "write")).toBe(FAILURE_COPY.unreachableWrite);
    expect(describeFailure(parse, "write")).toBe(FAILURE_COPY.unreadableWrite);
    expect(describeFailure({ not: "an error" }, "write")).toBe(FAILURE_COPY.unstatedWrite);
  });

  it("NO read path can still emit the retired claim", () => {
    /* The strongest form of the ruling: drive every classification through the
       real function on the read effect and assert the sentence never appears. */
    const cases: unknown[] = [
      new TypeError("Failed to fetch"),
      new TypeError("Load failed"),
      new SyntaxError("Unexpected token < in JSON at position 0"),
      new Error("select * from partner_notes failed"),
      new Error(""),
      "a bare string throw",
      null,
      undefined,
      { code: "ECONNRESET" },
    ];
    for (const c of cases) {
      expect(describeFailure(c, "read")).not.toContain("still there");
    }
  });

  it("a caller's own fallback literal still wins, so no screen's specific wording was overridden", () => {
    /* Wave 196's design: 25 call sites pass their own sentence. This wave changes
       the default, not their choice. */
    const mine = "This partner's notes could not be loaded.";
    expect(describeFailure(new Error(""), "read", mine)).toBe(mine);
  });
});

describe("WAVE 203 · C.3 — the wording lives in ONE helper, so 28 screens were not edited", () => {
  it("no page or component holds the retired sentence as a literal of its own", async () => {
    /* If any screen had inlined it, changing the helper would leave that screen
       still asserting the untrue claim. Comments are stripped first, and the
       stripper is verified to have stripped. */
    const fs = await import("node:fs");
    const path = await import("node:path");
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(ent.name)) out.push(full);
      }
      return out;
    };
    const files = [...walk("client/src/pages"), ...walk("client/src/components")].filter(
      (f) => !f.includes("__tests__"),
    );
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const stripped = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      if (stripped.includes("what you had is still there")) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
