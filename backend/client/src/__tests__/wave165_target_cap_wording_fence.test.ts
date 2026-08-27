/**
 * WAVE 165 · R130.2 / R139.4 — THE FENCE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY A SOURCE FENCE AND NOT ONLY DOM TESTS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * R139.4's instruction is *"Sweep the sections required for wording. All of them"*,
 * and R138.5.1 records why the previous attempt only got seven: the spec's line
 * numbers were STALE, so the surfaces had to be found by CONTENT. A per-surface
 * DOM test proves the surfaces that exist TODAY are explained. It cannot stop the
 * fourteenth surface someone adds next month from shipping a bare "target" — and
 * the owner's finding is that an unexplained surface IS the original defect
 * surviving. So the fence is content-addressed, exactly as the surfaces were:
 *
 *   for every file that RENDERS a target/cap/round-size figure,
 *   the file must ALSO render at least one explanation phrase.
 *
 * A new surface in a file already on the list inherits the file's explanation.
 * A new surface in a NEW file fails this test until it explains itself, which is
 * the behaviour R139.4 asks for.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * · Comments are STRIPPED before any conclusion is drawn. Every one of these
 *   files carries long explanatory comments containing the words "goal" and "not
 *   a limit"; a naive grep would pass on the comments alone and prove nothing
 *   about what a user sees. The stripper is the same one used to build the
 *   inventory, and §0 proves the stripper actually works before anything relies
 *   on it — a fence resting on a broken stripper is worse than no fence.
 * · The RENDERED-SURFACE list is enumerated from the tree, not hard-coded, so a
 *   file that starts rendering a target is caught rather than skipped.
 * · §3 asserts the sweep is COMPLETE by count: the number of at-risk files with
 *   no explanation must be ZERO, and the failure message names every offender.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CLIENT_SRC = join(process.cwd(), "client", "src");

/** Blank out `//`, `/* *\/` and `{/* *\/}` comments, preserving line count.
 *
 *  Double-quoted and template literals are honoured, so a `//` inside a URL
 *  survives. SINGLE quotes are deliberately NOT tracked as string delimiters.
 *  The first version of this stripper did track them, and it silently failed on
 *  this very tree: an apostrophe in ordinary JSX prose ("the round's goal") put
 *  the machine into a string state it never left, so every comment after that
 *  point in the file survived stripping and the fence read comments as if they
 *  were rendered copy. That is the exact false pass this file exists to prevent,
 *  and §0.5 below pins the regression. Nothing in `client/src` uses a
 *  single-quoted string as its outer quote style (Prettier normalises to double),
 *  so the trade is free here. */
export function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  let state: null | "line" | "block" | "dq" | "tick" = null;
  while (i < n) {
    const c = src[i];
    const nxt = i + 1 < n ? src[i + 1] : "";
    if (state === null) {
      if (c === "/" && nxt === "/") {
        state = "line";
        out.push("  ");
        i += 2;
        continue;
      }
      if (c === "/" && nxt === "*") {
        state = "block";
        out.push("  ");
        i += 2;
        continue;
      }
      if (c === '"') state = "dq";
      else if (c === "`") state = "tick";
      out.push(c);
      i += 1;
      continue;
    }
    if (state === "line") {
      out.push(c === "\n" ? "\n" : " ");
      if (c === "\n") state = null;
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && nxt === "/") {
        state = null;
        out.push("  ");
        i += 2;
        continue;
      }
      out.push(c === "\n" ? "\n" : " ");
      i += 1;
      continue;
    }
    if (c === "\\") {
      out.push(c, nxt);
      i += 2;
      continue;
    }
    if ((state === "dq" && c === '"') || (state === "tick" && c === "`")) {
      state = null;
    }
    out.push(c);
    i += 1;
  }
  return out.join("");
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if ((p.endsWith(".tsx") || p.endsWith(".ts")) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx")) {
      acc.push(p);
    }
  }
  return acc;
}

/** A file RENDERS a target/cap figure if a JSX expression or a rendered label
 *  pairs the vocabulary with a value. Deliberately narrow: matching every
 *  appearance of the word "target" would flag `e.target.value` on 200 files and
 *  the fence would be ignored within a week. */
const RENDERS_TARGET = [
  /targetRaiseMinor\s*[,)}]/,
  /\{\s*fmt[A-Za-z]*\([^)]*target(Raise|Amount|Size)/i,
  />\s*Target (raise|size|amount)\s*</i,
  /label="Target (raise|size|amount)"/i,
  /"Round size"/,
  /of \{[^}]*target(Raise|Amount)/i,
  /target(Raise|Amount|Size)Minor\s*\}/,
  /* `target` immediately after a closing brace, EXCEPT the `target=` attribute —
     `<a href={...} target="_blank">` is a link, not a raise. Nine files matched on
     that attribute alone on the first run of this fence; a detector that cries
     wolf on nine files is a detector nobody reads. */
  /\}\s*target(?!\s*=)/,
  /Target:\s*\{/,
  /Round target/,
];

/** Any ONE of these, present in the STRIPPED source, means the file tells a user
 *  what the number means. Kept in sync with `shared/raiseTargetWording.ts`. */
const EXPLANATION_PHRASES = [
  "not a limit",
  "fundraising goal",
  "goal being aimed for",
  "goal, not a limit",
  "no maximum",
  "may accept in total",
  "TARGET_RAISE_IS_A_GOAL",
  "ROUND_TARGET_IS_A_GOAL",
  "SPV_TARGET_RAISE_GOAL_LABEL",
  "SPV_TARGET_EXCEEDED_IS_NOT_A_REFUSAL",
];

/** Files that legitimately carry the vocabulary without RENDERING a figure to a
 *  user, each with the reason. Anything not listed here must explain itself.
 *  This list is deliberately tiny — an allow-list is how a sweep quietly stops
 *  being a sweep, and R139.4 forbids that outcome. */
const NOT_A_RENDERED_SURFACE = new Set<string>([
  // Pure type declarations and data plumbing; no JSX in the file at all.
  "lib/types.ts",
  "lib/termsheet/types.ts",
  "lib/sprint3Seed.ts",
  "lib/termsheet/templates.ts",
  // A glossary DEFINES the words rather than printing a vehicle's figure; its
  // own copy is reviewed as prose, not fenced as a figure surface.
  "components/Glossary.tsx",
]);

interface Surface {
  rel: string;
  explained: boolean;
  matched: string[];
}

function surfaces(): Surface[] {
  const found: Surface[] = [];
  for (const abs of walk(CLIENT_SRC)) {
    const rel = relative(CLIENT_SRC, abs).split("\\").join("/");
    if (NOT_A_RENDERED_SURFACE.has(rel)) continue;
    const stripped = stripComments(readFileSync(abs, "utf8"));
    const matched = RENDERS_TARGET.filter((re) => re.test(stripped)).map((re) => re.source);
    if (matched.length === 0) continue;
    const explained = EXPLANATION_PHRASES.some((p) => stripped.includes(p));
    found.push({ rel, explained, matched });
  }
  return found;
}

describe("W165 §0 — the comment stripper actually strips, before anything relies on it", () => {
  it("removes a block comment and keeps a same-line string literal", () => {
    const s = stripComments('const a = "keep-me"; /* goal, not a limit */ const b = 1;');
    expect(s).toContain("keep-me");
    expect(s).not.toContain("goal, not a limit");
  });

  it("removes a JSX comment containing the explanation phrase", () => {
    const s = stripComments("<div>{/* the target is a goal, not a limit */}</div>");
    expect(s).not.toContain("not a limit");
  });

  it("does NOT remove a rendered text node containing the phrase", () => {
    const s = stripComments("<div>fundraising goal, not a limit</div>");
    expect(s).toContain("fundraising goal, not a limit");
  });

  it("REGRESSION: an apostrophe in JSX prose does not disable later stripping", () => {
    /* The bug this pins: `state = "sq"` on the apostrophe of "round's", then
       every following comment survives and the fence passes on comment text. */
    const src = "<p>the round's goal</p>\n/* target, not a limit */\n<b>x</b>";
    const out = stripComments(src);
    expect(out).toContain("round's goal");
    expect(out, "the comment AFTER the apostrophe must still be stripped").not.toContain(
      "not a limit",
    );
  });

  it("preserves line count so coordinates stay usable", () => {
    const src = "a\n/* x\ny */\nb\n";
    expect(stripComments(src).split("\n").length).toBe(src.split("\n").length);
  });
});

describe("W165 §1 — the sweep found real surfaces", () => {
  it("identifies target/cap surfaces across MORE THAN ONE silo", () => {
    const all = surfaces();
    expect(all.length, "the detector must find surfaces at all").toBeGreaterThan(8);
    const silos = new Set(
      all.map((s) => {
        const m = /^(pages|components)\/([a-z]+)\//.exec(s.rel);
        return m ? m[2] : "shared";
      }),
    );
    expect(
      silos.size,
      `R130.2 is cross-silo; found only ${[...silos].join(", ")}`,
    ).toBeGreaterThanOrEqual(4);
  });
});

describe("W165 §2 — THE FENCE: every rendered target/cap surface explains itself", () => {
  it("has ZERO unexplained surfaces", () => {
    const unexplained = surfaces().filter((s) => !s.explained);
    expect(
      unexplained.map((s) => `${s.rel}  [matched: ${s.matched.join(" | ")}]`),
      "R139.4: an unexplained target/cap surface IS the original $10,000,000 defect " +
        "surviving. Add the wording from shared/raiseTargetWording.ts as a SIBLING " +
        "text node — never by replacing an existing literal, which the guard scores " +
        "as a removed copy string.",
    ).toEqual([]);
  });
});

describe("W165 §3 — the named silos are each covered", () => {
  const REQUIRED = [
    "pages/partner/PartnerSpvEngine.tsx", // SPV wizard
    "pages/partner/PartnerSpvDetail.tsx", // SPV detail target tile
    "pages/partner/PartnerSpvs.tsx", // SPVs list
    "components/partner/SpvDetailTabs.tsx", // both SPV Detail Tabs
    "pages/partner/PartnerFundDetail.tsx", // Fund detail
    "pages/partner/PartnerFunds.tsx", // Funds list
    "pages/founder/RoundNew.tsx", // Round New
    "pages/founder/Rounds.tsx", // Rounds cards + edit
    "pages/founder/RoundDetail.tsx", // Round Detail
    "pages/founder/Dashboard.tsx", // founder Dashboard
    "pages/CompanyDetails.tsx", // shared Company Details
    "components/CapitalizationJourney.tsx", // Capitalization Journey
    "pages/investor/InvitationDetail.tsx", // Invitation Detail overview + terms
    "pages/investor/Invitations.tsx", // Invitations list
    "components/investor/InvestorSiloPanel.tsx", // Investor Silo Panel
    "pages/investor/CompanyDetail.tsx", // investor company detail
    "pages/collective/CollectiveSoftCircles.tsx", // Collective
  ];

  for (const rel of REQUIRED) {
    it(`${rel} carries a user-visible explanation`, () => {
      const stripped = stripComments(readFileSync(join(CLIENT_SRC, rel), "utf8"));
      const hit = EXPLANATION_PHRASES.find((p) => stripped.includes(p));
      expect(hit, `${rel} renders a target or a cap with no explanation beside it`).toBeTruthy();
    });
  }
});

describe("W165 §4 — the canonical absence string, and no false zeros", () => {
  it("no swept surface invents its own spelling of absence", () => {
    /* R111 Q13 fixes ONE spelling. "No target set", "Not reported", "not
       recorded" and a bare em dash all told a reader something different about
       the same fact, and one of them (the dash) is indistinguishable from a
       loading state. */
    const BANNED = ['"No target set"', '"Not reported"', '"not recorded"', '"No target recorded"'];
    const offenders: string[] = [];
    for (const rel of [
      "pages/partner/PartnerSpvs.tsx",
      "pages/partner/PartnerFunds.tsx",
      "components/partner/SpvDetailTabs.tsx",
      "pages/founder/Rounds.tsx",
      "pages/founder/RoundDetail.tsx",
    ]) {
      const stripped = stripComments(readFileSync(join(CLIENT_SRC, rel), "utf8"));
      for (const b of BANNED) if (stripped.includes(b)) offenders.push(`${rel}: ${b}`);
    }
    expect(offenders, "use NOT_ON_RECORD from shared/raiseTargetWording.ts").toEqual([]);
  });
});
