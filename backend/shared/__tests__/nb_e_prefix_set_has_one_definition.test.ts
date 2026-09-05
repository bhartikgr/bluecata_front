/**
 * NUMBERS BAND · WAVE E (W328) — ONE PREFIX LIST, NOT TWO THAT DRIFT.
 * ════════════════════════════════════════════════════════════════════
 *
 * `partyReferenceLabel` (client/src/lib/partnerDisplay.ts) already enumerates the
 * nine storage-id prefixes this tree mints, in a regex. Wave E needed the same
 * knowledge on the server. There were two ways to get it and both had a cost:
 *
 *   (a) edit `partyReferenceLabel` to import the list — restructuring a working
 *       function with 15 production consumers and 32 call sites to make a
 *       different function tidier, which is precisely the trade this platform's
 *       rule 6 forbids; or
 *   (b) declare the list once in `shared/partyIdentifierShape.ts` and PIN the two
 *       to each other with a test, so a tenth prefix added to either one turns
 *       this file red instead of silently splitting the platform's idea of what
 *       an id looks like.
 *
 * (b) was chosen. THIS FILE IS THE PIN, and without it the "one definition" claim
 * in the module header would be an assertion nobody checks. It reads the client
 * file's SOURCE BYTES — not its behaviour, not a re-implementation of its regex —
 * because the thing at risk is the literal alternation a future engineer will
 * edit by hand.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PARTY_IDENTIFIER_PREFIXES,
  looksLikePartyIdentifier,
  displayNameFromNonIdentifier,
} from "../partyIdentifierShape";

const PARTNER_DISPLAY = resolve(__dirname, "../../client/src/lib/partnerDisplay.ts");

describe("NB-E — the identifier prefix set has exactly one effective definition", () => {
  it("partyReferenceLabel's own alternation is byte-identical to the shared list", () => {
    const src = readFileSync(PARTNER_DISPLAY, "utf8");
    /* PRECONDITION FIRST (rule 4): this file contains MORE THAN ONE prefix
       alternation, so a loose "first ^(...) in the file" match would silently
       measure the wrong function. The `replace(...)` form is the one inside
       `partyReferenceLabel`, and if it cannot be found this test FAILS rather
       than quietly comparing nothing. */
    const m = src.match(/\.replace\(\/\^\(([^)]+)\)\//);
    expect(m, `no partyReferenceLabel prefix alternation found in ${PARTNER_DISPLAY}`).toBeTruthy();
    const alternation = m![1].split("|");
    expect(alternation.length).toBeGreaterThan(0);
    expect(alternation).toEqual([...PARTY_IDENTIFIER_PREFIXES]);
  });

  it("RECORDS A PRE-EXISTING DIVERGENCE THIS WAVE DID NOT CAUSE AND DOES NOT FIX", () => {
    /* `actorDisplay` in the same file carries a SECOND, DIFFERENT prefix
       alternation: it lists a bare `spv` where `partyReferenceLabel` lists
       `spvlp_|spv_`, and it has no `mp_` at all. That divergence predates wave E,
       belongs to a function this wave has no business touching, and is REPORTED
       to the owner rather than silently harmonised. It is asserted here so it
       cannot be mistaken for something wave E introduced, and so that anyone who
       later reconciles the two is told this test exists. */
    const src = readFileSync(PARTNER_DISPLAY, "utf8");
    const all = [...src.matchAll(/\/\^\((u_[^)]+)\)\//g)].map((x) => x[1].split("|"));
    expect(all.length).toBe(2);
    expect(all[0]).not.toEqual(all[1]);
    expect(all[0]).toContain("spv");
    expect(all[0]).not.toContain("mp_");
    expect(all[1]).toEqual([...PARTY_IDENTIFIER_PREFIXES]);
  });

  it("recognises every one of those prefixes as an identifier", () => {
    for (const p of PARTY_IDENTIFIER_PREFIXES) {
      expect(looksLikePartyIdentifier(`${p}abc123`)).toBe(true);
      expect(displayNameFromNonIdentifier(`${p}abc123`)).toBeNull();
    }
  });
});

describe("NB-E — displayNameFromNonIdentifier refuses everything it cannot vouch for", () => {
  it("accepts a multi-word firm name, returned verbatim and trimmed", () => {
    expect(displayNameFromNonIdentifier("Mark Invest Partners")).toBe("Mark Invest Partners");
    expect(displayNameFromNonIdentifier("  Nimbus Capital Partners  ")).toBe("Nimbus Capital Partners");
  });

  it("refuses anything underscore-shaped, prefixed, blank, single-token or absurdly long", () => {
    expect(displayNameFromNonIdentifier("u_redeemed_1783181835779")).toBeNull();
    expect(displayNameFromNonIdentifier("some_internal_key with space")).toBeNull();
    expect(displayNameFromNonIdentifier("")).toBeNull();
    expect(displayNameFromNonIdentifier("   ")).toBeNull();
    expect(displayNameFromNonIdentifier(null)).toBeNull();
    expect(displayNameFromNonIdentifier(undefined)).toBeNull();
    /* THE DECLARED FALSE NEGATIVE, asserted so it is a known limit and not a
       surprise: a genuine one-word LP name is NOT promoted. */
    expect(displayNameFromNonIdentifier("Blackstone")).toBeNull();
    expect(displayNameFromNonIdentifier(`${"a b".repeat(400)}`)).toBeNull();
  });

  it("never invents, expands or re-cases any part of the stored value", () => {
    expect(displayNameFromNonIdentifier("mark invest partners")).toBe("mark invest partners");
    expect(displayNameFromNonIdentifier("MARK INVEST PARTNERS")).toBe("MARK INVEST PARTNERS");
  });
});
