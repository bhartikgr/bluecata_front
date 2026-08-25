/**
 * WAVE 126 — the partner surface is a paying client's screen.
 *
 * WHY THESE ARE SOURCE-LEVEL ASSERTIONS AND NOT RENDER TESTS.
 *
 * Every defect in this wave is a defect of WHAT IS WRITTEN IN THE FILE: a
 * sentence that describes our internal state, a label that asks for cents, a
 * bound that was never applied. A render test proves one branch of one panel
 * under one fixture; the claim being made here is about the surface as a whole,
 * across 45 files, and a render test cannot make that claim. The behavioural
 * half of the wave — that whole-unit entry produces the correct minor-unit
 * integer — is proved by unit tests over the real conversion in
 * client/src/components/partner/__tests__/w126_partner_money_input.test.ts.
 *
 * THE COMMENT TRAP. Five agents have been caught counting a grep hit in a
 * comment as a live defect, and this wave's own comments are full of the exact
 * strings being banned — they have to be, because they explain what was
 * removed. So every scan below strips comments FIRST via `liveCode()` and
 * asserts against what is left. `liveCode()` is itself tested, so a regression
 * in the stripper cannot silently make these tests vacuous.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DIRS = [
  "client/src/pages/partner",
  "client/src/components/partner",
];

import { liveCode } from "./w126_live_code";


function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  const found: string[] = [];
  for (const e of readdirSync(abs)) {
    const p = join(abs, e);
    if (statSync(p).isDirectory()) {
      if (e === "__tests__") continue;
      found.push(...walk(join(dir, e)));
    } else if (/\.(ts|tsx)$/.test(e)) {
      found.push(join(dir, e));
    }
  }
  return found;
}

const FILES = DIRS.flatMap(walk);
const LIVE = new Map<string, string>(FILES.map((f) => [f, liveCode(readFileSync(join(ROOT, f), "utf8"))]));

function hits(re: RegExp): string[] {
  const out: string[] = [];
  for (const [f, src] of LIVE) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(src)) !== null) {
      out.push(`${f}: ${m[0].slice(0, 120)}`);
    }
  }
  return out;
}

describe("WAVE 126 — the comment stripper the rest of this file depends on", () => {
  it("removes line, block and JSX comments and keeps string literals intact", () => {
    const src = [
      'const a = "keep me";',
      "// enter the amount in USD cents",
      "/* enter the amount in USD cents */",
      "{/* enter the amount in USD cents */}",
      'const b = "cents";',
    ].join("\n");
    const live = liveCode(src);
    expect(live).toContain('"keep me"');
    expect(live).toContain('"cents"');
    expect(live.match(/enter the amount in USD cents/g)).toBeNull();
  });

  it("is scanning a real, non-trivial surface", () => {
    // If a path ever moves, these tests must fail loudly rather than pass on
    // an empty file set.
    expect(FILES.length).toBeGreaterThan(40);
  });
});

describe("WAVE 126 / FINDING 1 — no partner-facing string describes our internal state", () => {
  it("the LOCK 1 not-supplied placeholder is not rendered on the pipeline surface", () => {
    expect(hits(/has not been supplied by the owner/)).toEqual([]);
    expect(hits(/an approximate lock is not a lock/i)).toEqual([]);
    expect(hits(/will be replaced by the exact text/)).toEqual([]);
  });

  it("the client-facing lock notice is what the panel reads", () => {
    const panel = LIVE.get("client/src/components/partner/Lock1NoticePanel.tsx")!;
    expect(panel).toMatch(/q\.data\.clientCopy/);
    expect(panel).not.toMatch(/\{q\.data\.copy\}/);
  });

  it('the pipeline lock heading no longer prints our register\u2019s "LOCK 1" numbering', () => {
    expect(hits(/LOCK 1 \u2014 soft-circle provenance/)).toEqual([]);
  });

  it("R91 — the soft-circle vocabulary is NOT harmonised away while doing so", () => {
    // The heading keeps this ladder's own word. Rewriting it to "soft-circled"
    // would merge two different ladders, which R91 forbids outright.
    expect(LIVE.get("client/src/components/partner/Lock1NoticePanel.tsx")!)
      .toMatch(/Soft-circle provenance/);
  });

  it("the fund commitment register does not admit an unshipped picker", () => {
    expect(hits(/Temporarily unavailable/)).toEqual([]);
    expect(hits(/until the contact picker ships/)).toEqual([]);
    expect(hits(/the commitment endpoint requires/)).toEqual([]);
  });

  it("no partner screen announces our release schedule", () => {
    expect(hits(/Coming Soon/i)).toEqual([]);
    expect(hits(/\u{1F6A7}/u)).toEqual([]);
  });

  it("the team roster does not admit our own data cleanup", () => {
    expect(hits(/cleanup required/i)).toEqual([]);
    expect(hits(/Duplicate historical seats hidden/)).toEqual([]);
  });

  it("no partner screen explains our storage model to a client", () => {
    expect(hits(/integer billionths/)).toEqual([]);
    expect(hits(/floating-point round trip/)).toEqual([]);
    expect(hits(/200,000,000, not as 0/)).toEqual([]);
  });
});

describe("WAVE 126 / FINDING 2 — no money form asks a client for cents", () => {
  /**
   * THE EXCLUSION THAT USED TO LIVE HERE IS GONE, BECAUSE THE FIELD IS FIXED.
   *
   * As written, this block excluded `SpvOperationsPanels.tsx` — the fee-ledger
   * commitment box — because wave 127 was editing that file concurrently, and it
   * carried a test that GUARDED the exclusion: `remaining.length` had to be
   * exactly 1, so the suite went red if the field was ever fixed. That is the
   * right way to hold a deferral, and Wave 128 · Finding 2 has now discharged it:
   * the field takes whole currency units through
   * `client/src/components/partner/partnerMoneyInput.ts`, and the guard below
   * asserts the FIX instead of the exclusion — zero fields remaining, on every
   * partner file including that one.
   */
  it("no partner-facing label or placeholder asks for an amount in cents", () => {
    expect(hits(/in USD cents/i)).toEqual([]);
    expect(hits(/for five million cents/i)).toEqual([]);
    /* "not whole USD" survives ONLY inside the two wave-106 label helpers
       (`minorUnitsLabel`, `minorUnitsLabelNoCurrency`), which Wave 128 left in
       place because client/src/lib/__tests__/w106_partner_facing_copy.test.ts
       imports them, and which no longer have a single call site anywhere in the
       client — asserted by w128_partner_cents_fields. Nothing rendered says it. */
    expect(hits(/not whole USD/i)).toEqual([]);
  });

  it("WAVE 128 · FINDING 2 — the deferred field is fixed: ZERO remain, including the excluded file", () => {
    const remaining = hits(/for five million cents|in USD cents|cents, not whole \$\{/i);
    expect(remaining).toEqual([]);
    /* And the previously-excluded file now asks for the client's own unit. */
    const ops = LIVE.get("client/src/components/partner/SpvOperationsPanels.tsx")!;
    expect(ops).toContain('wholeUnitsLabel("Model a commitment", currency)');
    expect(ops).toContain("<PartnerMoneyEntryNotice");
  });

  it("the converted panels ask for whole currency units", () => {
    const tabs = LIVE.get("client/src/components/partner/SpvDetailTabs.tsx")!;
    for (const label of [
      'wholeUnitsLabel("Commitment"',
      'wholeUnitsLabel("Amount received"',
      'wholeUnitsLabel("Gross proceeds"',
      'wholeUnitsLabel("Cost basis"',
      'wholeUnitsLabel("Minimum check"',
      'wholeUnitsLabel("Maximum check"',
    ]) {
      expect(tabs).toContain(label);
    }
  });

  it("the conversion never widens typed money through a float path", () => {
    const mod = LIVE.get("client/src/components/partner/partnerMoneyInput.ts")!;
    expect(mod).not.toMatch(/parseFloat\(/);
    expect(mod).not.toMatch(/parseInt\(/);
    // The only `Number` use permitted is on an ALREADY-integer payload value on
    // the way to the screen, never on what the client typed.
    expect(mod).not.toMatch(/Number\((?!\s*\))/);
  });

  it("every converted money field renders a formatted confirmation before submit", () => {
    const tabs = LIVE.get("client/src/components/partner/SpvDetailTabs.tsx")!;
    const notices = tabs.match(/<MoneyEntryNotice/g) ?? [];
    expect(notices.length).toBeGreaterThanOrEqual(5);
    expect(tabs).toMatch(/This will be recorded as/);
  });
});

describe("WAVE 126 / FINDING 3 — an impossible value is refused with a sentence", () => {
  const tabs = () => LIVE.get("client/src/components/partner/SpvDetailTabs.tsx")!;

  it("a hurdle above 100% is refused, and the refusal is a sentence", () => {
    const src = tabs();
    expect(src).toMatch(/function hurdleRefusal/);
    expect(src).toMatch(/it cannot exceed 100%/);
    // A rendered refusal, not a submit-time toast.
    expect(src).toMatch(/data-testid="spv-preview-hurdle-refusal"/);
    // And the control is actually gated on it.
    expect(src).toMatch(/hurdleProblem !== null/);
  });

  it("a negative amount is refused with a sentence, not a silent clamp", () => {
    const mod = LIVE.get("client/src/components/partner/partnerMoneyInput.ts")!;
    expect(mod).toMatch(/cannot be negative/i);
  });

  it("an implausibly large amount asks for confirmation rather than accepting silently", () => {
    expect(tabs()).toMatch(/isImplausiblyLarge/);
  });

  it("an already-passed credential expiry is refused with an explanation", () => {
    const tax = LIVE.get("client/src/pages/partner/PartnerTaxForm.tsx")!;
    expect(tax).toMatch(/expiry date has already passed/);
    expect(tax).toMatch(/data-testid="taxform-expires-error"/);
    expect(tax).toMatch(/expiryProblem !== null/);
  });

  it('the tax form does not name a standard ("ISO date") at a client', () => {
    expect(hits(/optional, ISO date/)).toEqual([]);
  });
});

describe("WAVE 126 / FINDING 5 — the smaller, visible ones", () => {
  it("the seat count is derived from the rows that are actually rendered", () => {
    const team = LIVE.get("client/src/pages/partner/PartnerTeam.tsx")!;
    expect(team).toMatch(/const renderedMembers = q\.data\?\.members \?\? \[\]/);
    expect(team).toMatch(/renderedMembers\.filter\(\(m\) => m\.status === "active"\)\.length/);
    // The old server-count-vs-roster disagreement is gone.
    expect(team).not.toMatch(/q\.data\?\.activeSeats \?\?/);
  });

  it('an active member is never labelled "Pending member"', () => {
    const team = LIVE.get("client/src/pages/partner/PartnerTeam.tsx")!;
    expect(team).not.toMatch(/safePersonDisplayName\(m\.name, "Pending member"\)/);
    expect(team).toMatch(/m\.status === "active" \? "Name not on file" : "Invitation pending"/);
  });

  it("the add-company form does not refuse a field nobody has touched", () => {
    const apc = LIVE.get("client/src/pages/partner/PartnerAddPortfolioCompany.tsx")!;
    expect(apc).toMatch(/touchedCompanyName && !companyName\.trim\(\)/);
    expect(apc).not.toMatch(/\{!companyName\.trim\(\) && \(/);
  });

  it("an empty ledger is not reported as a passed verification", () => {
    const perf = LIVE.get("client/src/pages/partner/SpvPerformance.tsx")!;
    expect(perf).toMatch(/there is nothing to verify/);
    expect(perf).toMatch(/verification\.checked === 0/);
    // And it is not dressed in the pass colour.
    expect(perf).toMatch(/checked === 0\s*\n?\s*\?\s*"border border-\[var\(--cv-color-border\)\]/);
  });
});
