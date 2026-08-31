/* ════════════════════════════════════════════════════════════════════════════
   WAVE 196 · ITEM A — THE NORMALISER, PROVED IN ISOLATION.
   ════════════════════════════════════════════════════════════════════════════
   This file proves the DECISION. The rendered-DOM file next to it
   (`client/src/components/investor/__tests__/wave196_rendered_failure_surfaces.test.tsx`)
   proves the decision reaches a screen — neither is sufficient alone, and R137
   exists because a fix once passed a layer test and never reached the LP.

   The three properties that matter, in the order they can bite:

   A. THE 240-CHARACTER GATE (R166.2). Wave 192 found a 244-character refusal
      headline that silently never rendered, because `queryClient.looksHuman`
      drops anything at or over 240. Every sentence this module can emit is
      measured against that SAME bound, and the bound itself is asserted to still
      be the one `queryClient.ts` applies — if someone widens one, this goes red.

   B. NO MACHINE VALUE ON A SCREEN. An ALL-CAPS underscore code and an empty or
      case-less string are all rejected in favour of the caller's own sentence.

   C. HONESTY ABOUT WRITES. The single most dangerous thing this wave could ship
      is a mutation failure that claims nothing was saved. A `fetch()` rejection
      cannot distinguish "never arrived" from "applied, reply lost", so the write
      sentences must NOT contain the phrase that asserts no change, and the read
      sentences must. Both directions are asserted.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import {
  describeFailure,
  classifyFailure,
  isMachineFacing,
  FAILURE_COPY,
  HUMAN_MESSAGE_MAX_LENGTH,
  /* WAVE 203 (R178.7) — the honest read wording `describeFailure` now returns. */
  W203_HONEST_READ_COPY,
} from "../failureMessage";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FALLBACK = "Could not do the thing.";
const ALL_COPY = Object.entries(FAILURE_COPY);

/* ── A · the gate ─────────────────────────────────────────────────────────── */
describe("WAVE 196 · A — every emitted sentence clears the same gate queryClient applies", () => {
  it.each(ALL_COPY)("A1 %s is under 240 characters, so it can actually render", (_k, text) => {
    expect(text.length).toBeLessThan(HUMAN_MESSAGE_MAX_LENGTH);
  });

  it.each(ALL_COPY)("A2 %s contains a lowercase letter (looksHuman requires one)", (_k, text) => {
    expect(/[a-z]/.test(text)).toBe(true);
  });

  it.each(ALL_COPY)("A3 %s carries no ALL-CAPS underscore code", (_k, text) => {
    expect(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(text)).toBe(false);
  });

  it.each(ALL_COPY)("A4 %s would itself pass the module's own human test", (_k, text) => {
    expect(isMachineFacing(text)).toBe(false);
  });

  /** The bound is duplicated in two files by necessity (`queryClient` cannot
   *  import from here without a cycle in the error path). This asserts they have
   *  not drifted, by reading the real source of the real gate. */
  it("A5 240 is still the bound queryClient.looksHuman enforces", () => {
    const src = readFileSync(resolve(__dirname, "../queryClient.ts"), "utf8");
    expect(HUMAN_MESSAGE_MAX_LENGTH).toBe(240);
    expect(src).toContain("length < 240");
  });
});

/* ── B · classification ───────────────────────────────────────────────────── */
describe("WAVE 196 · B — the two un-sanitised classes are recognised", () => {
  it("B1 a real fetch TypeError is unreachable, by name and not by wording", () => {
    const e = new TypeError("something a future browser says");
    expect(classifyFailure(e)).toBe("unreachable");
  });

  it.each([
    ["Chrome/Edge", "Failed to fetch"],
    ["Safari", "Load failed"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["React Native", "Network request failed"],
  ])("B2 %s wording is recognised even off a plain Error", (_engine, text) => {
    expect(classifyFailure(new Error(text))).toBe("unreachable");
  });

  it.each([
    ["V8 html page", `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`],
    ["V8 truncated", "Unexpected end of JSON input"],
    ["Firefox", "JSON.parse: unexpected character at line 1 column 1 of the JSON data"],
    ["Safari", "Expected property name or '}' in JSON at position 1"],
  ])("B3 %s body-parse wording is recognised", (_engine, text) => {
    expect(classifyFailure(new SyntaxError(text))).toBe("unreadable");
  });

  it("B4 a curated server sentence is passed through untouched", () => {
    const e = new Error("This SPV is closed, so no further commitments can be recorded.");
    expect(classifyFailure(e)).toBe("reported");
    expect(describeFailure(e, "write", FALLBACK)).toBe(
      "This SPV is closed, so no further commitments can be recorded.",
    );
  });

  it("B5 a machine code falls back to the caller's own sentence", () => {
    expect(describeFailure(new Error("SPV_NOT_FOUND"), "write", FALLBACK)).toBe(FALLBACK);
    expect(describeFailure(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed"), "read", FALLBACK)).toBe(FALLBACK);
  });

  it("B6 an empty, blank or case-less message falls back", () => {
    expect(describeFailure(new Error(""), "read", FALLBACK)).toBe(FALLBACK);
    expect(describeFailure(new Error("   "), "read", FALLBACK)).toBe(FALLBACK);
    expect(describeFailure(new Error("500"), "read", FALLBACK)).toBe(FALLBACK);
  });

  it("B7 an over-long server sentence falls back rather than rendering nothing", () => {
    /* The R166.2 failure mode: 244 characters passed no gate and vanished. */
    expect(describeFailure(new Error("a".repeat(244)), "read", FALLBACK)).toBe(FALLBACK);
  });

  it("B8 a non-Error throw falls back", () => {
    expect(describeFailure("just a string", "write", FALLBACK)).toBe(FALLBACK);
    expect(describeFailure(undefined, "write", FALLBACK)).toBe(FALLBACK);
    expect(describeFailure({ message: "an object pretending" }, "write", FALLBACK)).toBe(FALLBACK);
  });
});

/* ── C · honesty about writes ─────────────────────────────────────────────── */
describe("WAVE 196 · C — a write failure never claims the write did not happen", () => {
  const NOTHING_CHANGED = "what you had is still there";

  /* ── WAVE 203 · PIN FLIPPED, NOT DELETED (R98). ─────────────────────────────
     REASON: owner ruling R178.7 reversed the premise of this assertion. Wave 196
     wrote this pin to lock in that a READ failure was ALLOWED to reassure the
     user their data survived. R178.7 finds that claim unknowable at the moment it
     is printed: a read can fail precisely BECAUSE the record is gone, so the
     platform was asserting a fact about server state it had just failed to
     observe. The permission this pin protected is now a prohibition.

     The test is INVERTED rather than removed, so the ledger of intent stays
     readable and so a future wave that reinstates the reassurance fails here with
     the reason attached. `FAILURE_COPY.unstatedRead` itself is untouched and C5
     below still pins its original wording (R143.1: wrapped, never replaced) —
     what changed is what `describeFailure` chooses to RETURN for a read. */
  it("C1 a read failure MUST NOT say what you had is still there (was: MAY — flipped by R178.7)", () => {
    expect(describeFailure(new TypeError("Failed to fetch"), "read", FALLBACK)).not.toContain(
      NOTHING_CHANGED,
    );
    expect(describeFailure(new SyntaxError("Unexpected end of JSON input"), "read", FALLBACK)).not.toContain(
      NOTHING_CHANGED,
    );
    /* Anti-vacuity: the two calls above return the caller's FALLBACK literal only
       if the fallback wins, which would make the negative assertion meaningless.
       They do not — a TypeError/SyntaxError is classified before the fallback is
       consulted — so assert the honest sentences are what actually came back. */
    expect(describeFailure(new TypeError("Failed to fetch"), "read", FALLBACK)).toBe(
      W203_HONEST_READ_COPY.unreachableRead,
    );
    expect(describeFailure(new SyntaxError("Unexpected end of JSON input"), "read", FALLBACK)).toBe(
      W203_HONEST_READ_COPY.unreadableRead,
    );
  });

  it("C2 a write failure MUST NOT say it, and must say the outcome is unconfirmed", () => {
    for (const e of [new TypeError("Failed to fetch"), new SyntaxError("Unexpected end of JSON input")]) {
      const msg = describeFailure(e, "write", FALLBACK);
      expect(msg).not.toContain(NOTHING_CHANGED);
      expect(msg).not.toMatch(/nothing has been (saved|changed)\b/i);
      expect(msg).toContain("cannot confirm whether this was saved");
      expect(msg).toContain("Reload");
    }
  });

  it("C3 no sentence invents a cause", () => {
    /* The code cannot tell offline from captive portal from a cold server, so no
       message may name one. */
    for (const [, text] of ALL_COPY) {
      expect(text).not.toMatch(/offline|firewall|proxy|vpn|maintenance|our servers are down/i);
    }
  });

  it("C4 every sentence is distinct, so a reader can tell the cases apart", () => {
    /* Six now: the four transport sentences plus the read/write pair used when a
       failure is reported in text that cannot be shown. */
    expect(ALL_COPY.length).toBe(6);
    expect(new Set(ALL_COPY.map(([, t]) => t)).size).toBe(6);
  });

  it("C5 the no-explanation pair keeps the same read/write honesty split", () => {
    expect(FAILURE_COPY.unstatedRead).toContain("what you had is still there");
    expect(FAILURE_COPY.unstatedWrite).not.toContain("what you had is still there");
    expect(FAILURE_COPY.unstatedWrite).toContain("Reload");
    /* And neither claims to know why. */
    expect(FAILURE_COPY.unstatedRead).toContain("did not receive an explanation");
    expect(FAILURE_COPY.unstatedWrite).toContain("did not receive an explanation");
  });

  it("C6 omitting the fallback yields the stated sentence, never a machine value", () => {
    expect(describeFailure(new Error("SPV_NOT_FOUND"), "write")).toBe(FAILURE_COPY.unstatedWrite);
    /* WAVE 203 · PIN FLIPPED (R98): repointed from `FAILURE_COPY.unstatedRead` to
       the honest constant. Same assertion, same intent — "omitting the fallback
       yields the STATED sentence, never a machine value" — only the stated
       sentence changed, by R178.7. The old constant still exists and is still
       pinned by C5. */
    expect(describeFailure(new Error("no such table: spv"), "read")).toBe(
      W203_HONEST_READ_COPY.unstatedRead,
    );
    expect(describeFailure(undefined, "write")).toBe(FAILURE_COPY.unstatedWrite);
  });
});

/* ── D · the guard on the guard ───────────────────────────────────────────── */
describe("WAVE 196 · D — isMachineFacing", () => {
  it.each([
    ["empty", ""],
    ["blank", "  "],
    ["non-string", 42],
    ["undefined", undefined],
    ["no lowercase", "ERROR 500"],
    ["machine token", "Failed: PARTNER_COMMISSION_RATE_UNRESOLVED"],
    ["over-long", "a".repeat(240)],
  ])("D1 %s is machine-facing", (_label, v) => {
    expect(isMachineFacing(v)).toBe(true);
  });

  it("D2 a plain human sentence is not machine-facing", () => {
    expect(isMachineFacing("This vehicle is closed.")).toBe(false);
  });

  it("D3 239 characters is allowed and 240 is not — the boundary is exact", () => {
    expect(isMachineFacing("a".repeat(239))).toBe(false);
    expect(isMachineFacing("a".repeat(240))).toBe(true);
  });
});

/* ── E · the internal-detail backstop ─────────────────────────────────────── */
describe("WAVE 196 · E — no stack trace, file path or SQL fragment can reach a screen", () => {
  /* Every string below is the kind of text a server handler that answers
     `message: (err as Error).message` on a 500 actually sends. `looksHuman` in
     queryClient passes all of them, so `ApiError.message` carries them; this is
     the layer that stops them. */
  it.each([
    ["SQLite missing table", "SQLITE_ERROR: no such table: spv_subscription"],
    ["SQLite constraint", "UNIQUE constraint failed: spv.id"],
    ["SQLite missing column", "no such column: target_raise_minor"],
    ["SQL statement", "near SELECT id FROM spv where broken"],
    ["insert statement", "failed on INSERT INTO partner_invoice_line values"],
    ["stack frame", "boom at file.ts:12:3"],
    ["absolute posix path", "cannot open /var/data/data.db"],
    ["windows path", "cannot open C:\\data\\db"],
    ["source file and line", "crashed in spvEngineStore.ts:630"],
    ["error prefix", "Error: something internal"],
    ["typeerror prefix", "TypeError: x is not a function"],
  ])("E1 %s is machine-facing and is replaced by the caller's sentence", (_label, text) => {
    expect(isMachineFacing(text)).toBe(true);
    expect(describeFailure(new Error(text), "read", FALLBACK)).toBe(FALLBACK);
  });

  it("E2 a legitimate server refusal that merely MENTIONS a vehicle still passes", () => {
    const real = "This SPV is closed to new commitments, so nothing was recorded.";
    expect(isMachineFacing(real)).toBe(false);
    expect(describeFailure(new Error(real), "write", FALLBACK)).toBe(real);
  });

  it("E3 HONEST LIMIT: a short exception message with no internal artefact still passes through", () => {
    /* Stated as a test so it cannot be mistaken for a solved problem. The server
       handlers that emit raw exception text are listed in W196_BUILD.md and were
       NOT fixed by this wave. */
    expect(describeFailure(new Error("boom"), "read", FALLBACK)).toBe("boom");
  });
});
