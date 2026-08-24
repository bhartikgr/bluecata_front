/**
 * WAVE 110 · FINDING 5 — `describeActivityAction` RETURNED NON-STRINGS FOR THE
 * `Object.prototype` KEY NAMES, AND `__proto__` CRASHED REACT.
 *
 * The phrase map was a plain object literal read with `PHRASES[code]`, so the
 * lookup inherited every key on `Object.prototype`. Its own docblock claimed the
 * mapping was TOTAL — "for any string at all it returns English" — which was
 * false for these eight inputs:
 *
 *   __proto__            → the prototype OBJECT   → React: "Objects are not valid
 *                                                    as a React child" (throws)
 *   constructor          → function Object()      → React renders nothing
 *   toString             → function toString()    → React renders nothing
 *   valueOf              → function valueOf()
 *   hasOwnProperty       → function hasOwnProperty()
 *   isPrototypeOf        → function isPrototypeOf()
 *   propertyIsEnumerable → function propertyIsEnumerable()
 *   toLocaleString       → function toLocaleString()
 *
 * These are reachable: 37 `appendAudit` call sites build the event type from a
 * template or a variable (`user.${action}`, `e.action`, `evt.kind`), so a stored
 * or supplied `__proto__` reaches this function without anyone writing it as a
 * literal.
 *
 * Each case below is asserted BOTH as a value (a non-empty string) and as a
 * RENDER (the way the activity feed actually uses it), because the value check
 * alone would pass for a function while React still rendered nothing.
 */
import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  describeActivityAction,
  looksLikeMachineEventCode,
} from "../activityActionDescription";

/** Every own-property name of `Object.prototype` that a bracket read would hit. */
const PROTOTYPE_KEYS = [
  "__proto__",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
] as const;

/** Codes nobody anticipated — the case the map cannot cover by construction. */
const UNKNOWN_CODES = [
  "wobble.frobnicated",
  "quux_bazzed_thing",
  "ZZ__weird__CODE",
  "a",
  "user.4f2a9c.action",
  "\u00fcber.gr\u00fc\u00dft",
  "12345",
];

function Feed({ code }: { code: unknown }) {
  return <span data-testid="line">{describeActivityAction(code)}</span>;
}

describe("W110 · Finding 5 — the mapping is prototype-safe and always returns a string", () => {
  it.each(PROTOTYPE_KEYS)("%s returns a non-empty STRING", (key) => {
    const out = describeActivityAction(key);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    /* Pre-fix: `typeof out` was "object" for __proto__ and "function" for the
       other seven, so this line failed eight times. */
    expect(looksLikeMachineEventCode(out)).toBe(false);
  });

  it.each(PROTOTYPE_KEYS)("%s RENDERS as text and does not throw", (key) => {
    /* Pre-fix, `__proto__` threw "Objects are not valid as a React child" here and
       the other seven rendered an EMPTY node. */
    expect(() => render(<Feed code={key} />)).not.toThrow();
    const line = document.querySelector('[data-testid="line"]');
    expect(line).toBeTruthy();
    expect((line?.textContent ?? "").trim().length).toBeGreaterThan(0);
    cleanup();
  });

  it.each(UNKNOWN_CODES)("an unanticipated code (%s) still reads as English", (code) => {
    const out = describeActivityAction(code);
    expect(typeof out).toBe("string");
    expect(out.trim().length).toBeGreaterThan(0);
    expect(looksLikeMachineEventCode(out)).toBe(false);
  });

  it("the docblock's TOTAL claim holds for non-string inputs too", () => {
    const weird: unknown[] = [
      undefined,
      null,
      0,
      1,
      NaN,
      true,
      false,
      {},
      [],
      () => "x",
      Object.create(null),
      Symbol("s"),
      /* `BigInt(123)`, not a `123n` literal — the project targets below ES2020 and a
         BigInt literal is a type error (TS2737). The VALUE is what matters here. */
      BigInt(123),
      new Date(0),
    ];
    for (const w of weird) {
      const out = describeActivityAction(w);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      expect(looksLikeMachineEventCode(out)).toBe(false);
    }
  });

  it("a real code still gets its real phrase — the fix did not flatten the vocabulary", () => {
    expect(describeActivityAction("founder_global_search")).toBe("ran a search across their company");
    expect(describeActivityAction("round.initial_shareholders.set")).toBe(
      "recorded the opening shareholders on a round",
    );
    expect(describeActivityAction("")).toBe("recorded an activity");
  });
});
