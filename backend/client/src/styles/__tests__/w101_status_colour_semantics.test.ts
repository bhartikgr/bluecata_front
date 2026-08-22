/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WAVE 101 — A POSITIVE STATE MUST NEVER BE PAINTED THE NEGATIVE COLOUR.
 *            Platform-wide, all five areas, enforced structurally.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS FILE EXISTS AND WHY IT IS THE REAL DELIVERABLE OF THE WAVE.
 *
 * The owner approved the colour-coded status treatment — "I like the color
 * coding applications."  A colour system in which red means "bad" on one screen
 * and "good" on another teaches an operator nothing, and it is WORSE than no
 * colour coding at all: an admin who sees red for a healthy state learns to
 * ignore red, and the next real failure is ignored too.
 *
 * This defect kept coming back.  Wave 99 fixed nine inversions in the admin
 * area and escalated two.  Final Reviewer B, a different model family, then
 * INDEPENDENTLY reported the same class of defect on four more surfaces.  Two
 * independent reviewers finding the same thing separately is the definition of
 * real.  Wave 101 swept all five areas and found TWENTY-TWO — because the
 * detector Wave 99 wrote could not see the most common shape of the bug:
 *
 *     variant={row.state === "active" ? "default" : "outline"}
 *              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ the state literal is not
 *                                                adjacent to `variant=`
 *
 * So the fix on its own is not enough.  A regression FENCE is needed, and it
 * must be able to see every binding shape, not just the tidy ones:
 *
 *   §1  ternary            `x === "active" ? "default" : …`
 *   §2  helper return      `if (s === "paid") return "default";`
 *   §3  switch case        `case "active": return "default";`
 *   §4  object map         `accepted: "…text-[hsl(0_100%_40%)]…"`
 *   §5  Tailwind class     `status === "verified" ? "text-red-600" : …`
 *   §6  the anchors themselves — positive and negative must stay distinct, and
 *       the positive chip must stay ABOVE the 4.5:1 legal minimum.
 *
 * SCOPE.  All of `client/src`, every area — founder, Collective, partner, admin
 * and investor — plus shared components.  Not admin alone: three of the
 * twenty-two were in founder, five in collective, five in investor.
 *
 * TWO FILES ARE EXCLUDED, BOTH ON THE RECORD:
 *   · `pages/founder/Billing.tsx` — R80, "Founder Billing Page: OK. Keep it
 *     different."  Wave 101 never edited it and this fence never reads it.
 *   · `components/marketing/**` — SACRED.  Out of bounds for edits, therefore
 *     out of bounds for a fence that would demand edits.
 *
 * WAIVERS.  Every remaining allowance is listed in `WAIVED` below with the
 * reason it is not an inversion.  A waiver is a decision on the record, not a
 * silence: adding one requires writing down why, which is the whole point.
 *
 * THE POSITIVE COLOUR IS #2C7346, NOT #379056.  #379056 is the positive FAMILY
 * and is fine for FILLS; MEASURED, white on it is 3.97:1, under the 4.5:1
 * minimum, so it must never carry text.  The ratified ANCHOR is step 700 =
 * #2C7346 (white on it: 5.76:1), which `bg-emerald-700` / `text-emerald-700`
 * resolve to in all five areas via the Wave 1D ramp mechanism.  R89.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const CLIENT = path.resolve(__dirname, "../..");
const STYLES = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(p, "utf8");
/** strip comments so a rule can never be "satisfied" by prose about it */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── the excluded surfaces ────────────────────────────────────────────────── */
const EXCLUDED = [
  "pages/founder/Billing.tsx", // R80 — never opened, never fenced
  "components/marketing/", // SACRED
  "__tests__/",
  ".test.ts",
];

/* ── the state vocabulary, POSITIVE role ──────────────────────────────────────
 * Taken from the ratified vocabulary and cross-checked against the `as const`
 * tuples in `shared/*.ts` — from the CODE, never from a document.  The design
 * pre-flight's copy of SPV_DEPLOYMENT_STATUSES was missing `founder_confirmed`;
 * the tuple has it, so it is here.                                            */
const POSITIVE_STATES = [
  "active", "paid", "succeeded", "completed", "complete", "delivered", "resolved",
  "approved", "accepted", "verified", "healthy", "funded", "settled", "deployed",
  "signed", "vested", "passed", "enabled", "published", "granted", "promoted",
  "founder_confirmed", "gp_approved", "confirmed", "matched", "invested",
];

/** every colour token that IS the ratified negative anchor */
const NEGATIVE_COLOUR = [
  '"default"', // Badge/Button `default` = bg-primary = #CC0001 in admin+investor
  '"destructive"',
  "hsl(0 100% 40%)", "hsl(0_100%_40%)", "hsl(0 100% 32%)", "hsl(0_100%_32%)",
  "#cc0001", "#CC0001", "#cc0000", "#CC0000",
  "red-500", "red-600", "red-700", "rose-500", "rose-600", "rose-700",
];

/* ── waivers, each with its reason on the record ──────────────────────────── */
const WAIVED: Array<{ file: string; state: string; why: string }> = [
  /* EMPTY, AND THAT IS THE RESULT — NOT AN OVERSIGHT.
   *
   * A draft of this fence shipped six waivers.  Then the meta-test below
   * ("every waiver carries a written reason") went RED on two of them, because
   * their reasons were three words long.  Writing the real reason out is what
   * exposed the truth: FOUR of the six sites DID NOT EXIST — they were carried
   * over from the census's per-branch pass, whose line numbers refer to
   * comment-stripped text, and one of them (`AdminFeesConsolidated.tsx:893`,
   * `m.status === "live"`) was ALREADY painted `"positive"` by an earlier wave.
   * A waiver for a site that does not exist is a lie that makes the fence look
   * more permissive than it is, so all four were deleted.
   *
   * The two survivors turned out not to need a waiver either, because the fence
   * never flagged them: neither `live` nor `longterm` is in POSITIVE_STATES.
   * They are DELIBERATE OMISSIONS FROM THE VOCABULARY, recorded here so the
   * next reader does not mistake them for misses:
   *
   *   · `live` — `pages/admin/PricingModelDetail.tsx:266`,
   *     `variant={t === "live" ? "default" : "outline"}`.  This is a BUTTON, the
   *     primary "Promote to live" action.  `default` on a Button is the brand
   *     CTA fill, which this programme ratified as brand chrome, not a status
   *     colour.  Also a payment-gateway MODE elsewhere in admin, where
   *     red-as-caution around real money is defensible.  Not a health state.
   *
   *   · `longterm` — `pages/founder/CRM.tsx:62`,
   *     `tone: "bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)]"`.  Wave 2D+3D
   *     recorded this CRM stage chip as "(brand red, LOCKED)".  It is a
   *     relationship CATEGORY on a categorical scale, not good-or-bad, and it is
   *     locked by an earlier ruling.  Raised as an owner question instead of
   *     changed unilaterally.
   *
   * So the honest count is: ZERO waivers.  The fence is fully closed.  Adding an
   * entry here requires a reason of real length, and the meta-test enforces it. */
];

const isWaived = (rel: string, state: string) =>
  WAIVED.some((w) => rel.endsWith(w.file) && w.state === state);

/* ── file collection ─────────────────────────────────────────────────────── */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(p, out);
    } else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(CLIENT)
  .map((p) => ({ abs: p, rel: path.relative(CLIENT, p).split(path.sep).join("/") }))
  .filter((f) => !EXCLUDED.some((x) => f.rel.includes(x)));

/** a colour expression counts as negative if it names the negative anchor and
 *  does NOT also name the positive one (a paired expression is not inverted) */
const isNegative = (expr: string) => {
  const neg = NEGATIVE_COLOUR.some((c) => expr.includes(c));
  const pos = /"positive"|emerald|#2C7346|#2c7346|--ds-status-positive|green-[5-9]00|teal-[5-9]00/.test(expr);
  return neg && !pos;
};

type Hit = { rel: string; line: number; state: string; expr: string; shape: string };

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const { abs, rel } of FILES) {
    const lines = code(read(abs)).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const state of POSITIVE_STATES) {
        if (!line.includes(`"${state}"`) && !line.includes(`${state}:`)) continue;
        if (isWaived(rel, state)) continue;

        // §1/§5 — ternary: `=== "state" [|| …] ? <consequent> :`
        const tern = new RegExp(
          `===\\s*"${state}"(?:\\s*\\|\\|[^?]{0,80}?)?\\s*\\?\\s*([^:]{1,180}?)\\s*:`
        ).exec(line);
        if (tern && isNegative(tern[1])) {
          hits.push({ rel, line: i + 1, state, expr: tern[1].trim(), shape: "ternary" });
        }

        // §2 — helper return: `if (… "state" …) return <colour>;`
        const ret = new RegExp(
          `"${state}"[^\\n]{0,80}?\\)\\s*return\\s+([^;]{1,80});`
        ).exec(line);
        if (ret && isNegative(ret[1])) {
          hits.push({ rel, line: i + 1, state, expr: ret[1].trim(), shape: "helper return" });
        }

        // §3 — switch case: `case "state":` with the return on a following line
        if (new RegExp(`case\\s+"${state}"\\s*:`).test(line)) {
          const tail = lines.slice(i + 1, i + 5).join(" ");
          const cret = /return\s+([^;]{1,80});/.exec(tail);
          if (cret && isNegative(cret[1])) {
            hits.push({ rel, line: i + 1, state, expr: cret[1].trim(), shape: "switch case" });
          }
        }

        // §4 — object map entry: `state: "<colour classes>",`
        const map = new RegExp(`(?:^|[{,\\s])${state}\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`).exec(line);
        if (map && isNegative(map[1])) {
          hits.push({ rel, line: i + 1, state, expr: map[1].trim(), shape: "object map" });
        }
      }
    }
  }
  return hits;
}

const HITS = scan();

// ─────────────────────────────────────────────────────────────────────────────
describe("W101 · THE FENCE — no positive state is painted the negative colour", () => {
  it("the sweep actually reads the tree (guards against a silently empty fence)", () => {
    // If a refactor moves client/src, or the walk breaks, this fence would pass
    // vacuously and the defect would come back unnoticed. Pin the floor.
    expect(FILES.length).toBeGreaterThan(300);
    expect(FILES.some((f) => f.rel.startsWith("pages/founder/"))).toBe(true);
    expect(FILES.some((f) => f.rel.startsWith("pages/collective/"))).toBe(true);
    expect(FILES.some((f) => f.rel.startsWith("pages/partner/"))).toBe(true);
    expect(FILES.some((f) => f.rel.startsWith("pages/admin/"))).toBe(true);
    expect(FILES.some((f) => f.rel.startsWith("pages/investor/"))).toBe(true);
  });

  it("R80 — the founder Billing page is NOT in the swept set", () => {
    expect(FILES.some((f) => f.rel === "pages/founder/Billing.tsx")).toBe(false);
  });

  it("ZERO positive states are painted the negative anchor, anywhere in client/src", () => {
    const report = HITS.map(
      (h) => `  ${h.rel}:${h.line}  [${h.shape}]  \`${h.state}\` -> ${h.expr}`
    ).join("\n");
    expect(
      HITS,
      `A POSITIVE state is painted the NEGATIVE colour. Red must mean one thing.\n` +
        `Repaint it to the positive anchor #2C7346 (bg-/text-emerald-700, or the\n` +
        `Badge \`positive\` variant), or add a WAIVER in this file stating why the\n` +
        `state is not really positive:\n${report}`
    ).toEqual([]);
  });

  /* Per-shape assertions, so a failure names the shape that regressed. */
  for (const shape of ["ternary", "helper return", "switch case", "object map"]) {
    it(`no \`${shape}\` binding paints a positive state red`, () => {
      expect(HITS.filter((h) => h.shape === shape)).toEqual([]);
    });
  }

  it("every waiver carries a written reason (a waiver is a decision, not a silence)", () => {
    for (const w of WAIVED) {
      expect(w.why.length, `waiver for ${w.file}/${w.state} has no reason`).toBeGreaterThan(40);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W101 · the twenty-two fixes are pinned, so they cannot silently revert", () => {
  const has = (rel: string, needle: string) =>
    expect(code(read(path.join(CLIENT, rel)))).toContain(needle);

  it("F01 collective member billing — `paid` is positive, not brand red", () => {
    has("components/collective/MemberBillingPanel.tsx", 'if (status === "paid") return "positive";');
    // and red keeps its meaning: the failure branch is UNCHANGED
    has(
      "components/collective/MemberBillingPanel.tsx",
      'if (status === "overdue" || status === "void") return "destructive";'
    );
  });

  it("F02 my screenings — a LIVE screening is in flight, not failed", () => {
    const c = code(read(path.join(CLIENT, "components/collective/widgets/MyScreenings.tsx")));
    expect(c).toContain('key: "live"');
    expect(c).not.toMatch(/key:\s*"live"[^\n]*text-red-600/);
  });

  it("F03 vetting donut — `active` is off the negative anchor, `closed` untouched", () => {
    const c = code(read(path.join(CLIENT, "components/collective/widgets/VettingPipelineDonut.tsx")));
    expect(c).not.toMatch(/active:\s*"#cc0001"/i);
    expect(c).toContain('closed: "#10B981"');
  });

  it("F04 investor decision ladder — `accepted` is positive, `funded` still emerald", () => {
    const c = code(read(path.join(CLIENT, "components/investor/DashboardSpinePanels.tsx")));
    expect(c).not.toMatch(/accepted:\s*"bg-\[hsl\(0_100%_40%\)\]/);
    expect(c).toContain("funded:");
  });

  it("F05 investor DSC — promoted/accepted positive, declined/rejected still destructive", () => {
    const c = code(read(path.join(CLIENT, "components/investor/InvestorDscSubmitPanel.tsx")));
    expect(c).toContain('if (status === "promoted" || status === "accepted") return "positive";');
    expect(c).toContain('if (status === "declined" || status === "rejected") return "destructive";');
  });

  it("F06 founder reconciliation — `verified` and `drift` are no longer both red", () => {
    const c = code(read(path.join(CLIENT, "pages/founder/RoundDetail.tsx")));
    expect(c).toContain('ledger.data?.verified?.ok ? "text-emerald-700"');
    expect(c).toContain('"text-[hsl(7_61%_43%)]"'); // drift keeps the negative brick
  });

  it("F07 founder cap table — 100% VESTED is not painted red", () => {
    const c = code(read(path.join(CLIENT, "pages/founder/CapTable.tsx")));
    expect(c).toContain("bg-emerald-700 block");
    expect(c).not.toMatch(/bg-\[hsl\(0_100%_40%\)\] block/);
  });

  it("F08–F11 every progress-to-target bar is off the negative anchor", () => {
    for (const rel of [
      "pages/founder/Rounds.tsx",
      "pages/founder/RoundDetail.tsx",
      "pages/investor/Invitations.tsx",
      "pages/investor/InvitationDetail.tsx",
    ]) {
      const c = code(read(path.join(CLIENT, rel)));
      expect(
        c,
        `${rel}: a Math.min(100, pct) progress bar is still filled with the negative anchor`
      ).not.toMatch(/bg-(?:gradient-to-r from-)?\[hsl\(0_100%_40%\)\][^\n]{0,80}Math\.min\(100, pct\)/);
    }
  });

  it("F12 investor decision banner — the shield follows the banner tone", () => {
    const c = code(read(path.join(CLIENT, "pages/investor/CompanyDetail.tsx")));
    expect(c).toMatch(/ShieldCheck[\s\S]{0,220}banner\.tone === "positive" \? "text-emerald-700"/);
  });

  it("F13 close-round — the 'all sign-offs captured' check is positive", () => {
    has("components/CloseRoundPanel.tsx", '<CheckCircle2 className="h-5 w-5 text-emerald-700" />');
  });

  it("F14 collective membership — `active` positive, `past_due` still destructive", () => {
    const c = code(read(path.join(CLIENT, "pages/collective/MembershipPage.tsx")));
    expect(c).toMatch(/case "active":\s*return "positive";/);
    expect(c).toMatch(/case "past_due":\s*return "destructive";/);
  });

  it("F15–F19 the five admin chips are positive", () => {
    has("components/admin/CompanyMarkPanel.tsx", '=== "required" ? "positive" : "destructive"');
    has("components/admin/PartnerTierLifecycleAdmin.tsx", 't.state === "active" ? "positive"');
    has("components/admin/MarkOverrideReviewPanel.tsx", '=== "approved" ? "positive"');
    has("components/admin/InvestorAliasAdminPanel.tsx", 'a.state === "active" ? "positive"');
    has("pages/admin/AdminFeesConsolidated.tsx", 'c.active ? "positive" : "secondary"');
  });

  it("F20–F22 the three founder Settings sites are positive", () => {
    const c = code(read(path.join(CLIENT, "pages/founder/Settings.tsx")));
    expect(c).toContain('subscription.status === "active" ? "positive"');
    expect(c).toContain('inv.status === "paid" ? "positive"');
    expect(c).toContain('<Check className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5" />');
    // red keeps its meaning on the invoice chip
    expect(c).toContain('inv.status === "void" || inv.status === "refunded" ? "destructive"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("W101 · the anchors stay distinct, and legible", () => {
  const tokens = code(read(path.join(STYLES, "ledger-tokens.css")));

  it("the positive and negative anchors are DIFFERENT colours", () => {
    const pos = /--ds-status-positive:\s*([^;]+);/.exec(tokens)?.[1].trim();
    const neg = /--ds-status-negative:\s*([^;]+);/.exec(tokens)?.[1].trim();
    expect(pos).toBeTruthy();
    expect(neg).toBeTruthy();
    expect(pos!.toLowerCase()).not.toBe(neg!.toLowerCase());
  });

  it("the positive anchor is #2C7346 — 5.76:1 with white, ABOVE the 4.5:1 minimum", () => {
    expect(/--ds-status-positive:\s*#2C7346/i.test(tokens)).toBe(true);
  });

  it("#379056 stays a GRAPHIC colour and never becomes the text anchor (R89)", () => {
    // MEASURED: white on #379056 is 3.97:1 — it fails as a filled text chip.
    expect(/--ds-status-positive:\s*#379056/i.test(tokens)).toBe(false);
    expect(/--ds-graphic-green:\s*#379056/i.test(tokens)).toBe(true);
  });

  it("`emerald-700` resolves to the positive anchor in ALL FIVE areas", () => {
    const ramps = read(path.join(STYLES, "ledger-ramps.css"));
    const founder = read(path.join(STYLES, "ledger-founder.css"));
    const anchor = /--ramp-emerald-700:\s*44 115 70/g;
    // four areas in ledger-ramps.css, founder in ledger-founder.css under the
    // R80 Billing guard
    expect((ramps.match(anchor) || []).length).toBeGreaterThanOrEqual(4);
    expect(anchor.test(founder)).toBe(true);
  });

  it("the R80 founder Billing guard is preserved EXACTLY", () => {
    const founder = read(path.join(STYLES, "ledger-founder.css"));
    expect(founder).toContain(
      '[data-product="founder"]:not(:has([data-testid="card-collective-application-fee"]))'
    );
  });

  it("the Badge `positive` variant is white on the positive ramp, not on #379056", () => {
    const badge = code(read(path.join(CLIENT, "components/ui/badge.tsx")));
    expect(badge).toContain("bg-emerald-700 text-white");
    expect(badge).not.toContain("#379056");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 103 — THE SHAPE WAVE 101 COULD NOT SEE: AN UNCONDITIONAL COLOUR.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything above walks CONDITIONAL bindings: a colour chosen by a state
 * literal, a ternary, a switch, a map key.  That enumeration is complete for
 * what it covers and it found twenty-two inversions.  It is also, by
 * construction, BLIND to a colour that is always the same.
 *
 * Wave 101B found two more by LOOKING AT SCREENSHOTS:
 *
 *   1. a $640K UNREALISED GAIN painted the brand red, because the tile took an
 *      `accent` prop that was passed with no value at all —
 *          <KvCard label="Current mark" … accent />
 *      There is no state literal on that line, no ternary, nothing for §1–§5 to
 *      match.  The colour was simply hard-wired to the failure colour.
 *   2. a red `✓` used as a bullet, ten times.  A tick is a POSITIVE MARK BY
 *      DEFINITION; no input can make it mean failure.
 *
 * THE LESSON, stated once so it is not lost: AN ENUMERATION OF CONDITIONAL
 * COLOUR BINDINGS CANNOT SEE A COLOUR THAT IS NEVER CONDITIONAL.  The shapes
 * below therefore key off SEMANTICS THAT ARE FIXED IN THE MARKUP ITSELF —
 * an affirmative glyph, a short affirmative chip label, a completion bar, an
 * emphasis prop with only a failure branch — rather than off a state value.
 *
 *   §7   affirmative GLYPH (✓ family) coloured the negative anchor
 *   §8   the shared completion bar
 *   §9   short affirmative CHIP LABEL ("ok", "Active", "Verified") in the
 *        failure colour — the semantics come from the VISIBLE TEXT, not from
 *        any state name, which is exactly why §1–§5 missed `<Badge
 *        variant="default">ok</Badge>` sitting next to `destructive` "broken"
 *   §10  an emphasis PROP that has only a failure-coloured branch
 *   §11  the six Wave 103 fixes, pinned
 *
 * A NEGATIVE NUMBER LEGITIMATELY SHOWN IN RED IS CORRECT AND IS NOT FENCED.
 * Nothing below looks at numbers or at signs.  It looks only at markup whose
 * meaning cannot be anything but positive.  A real loss is red because a sign
 * test chose the colour — that is a CONDITIONAL binding and it is out of scope
 * here by construction.
 */

/** ✓-family glyphs.  Each is an affirmative mark in every icon set that ships
 *  it; none has a failure reading.  `ShieldCheck` is DELIBERATELY ABSENT — this
 *  programme ruled it a topic/section glyph and, on the accreditation blocker,
 *  correctly red for "action required" (Wave 101).  `Activity`, `TrendingUp`
 *  and `Trophy` are absent for the same reason: they are subject glyphs. */
const AFFIRMATIVE_GLYPHS = [
  "Check",
  "CheckCheck",
  "CheckCircle",
  "CheckCircle2",
  "CircleCheck",
  "CircleCheckBig",
  "CheckSquare",
  "SquareCheck",
  "SquareCheckBig",
  "BadgeCheck",
  "ClipboardCheck",
];

/** Words that are unambiguous ONLY as a short visible chip label.  In prose
 *  `ok` matches "book" and "token"; as the entire contents of a Badge it can
 *  mean nothing else.  Applied only to labels of 25 characters or fewer. */
const AFFIRMATIVE_LABELS = [
  "ok", "okay", "done", "yes", "pass", "passed", "passing", "clean", "valid",
  "live", "verified", "active", "complete", "completed", "paid", "approved",
  "settled", "healthy", "matched", "vested", "synced", "enabled", "granted",
  "eligible",
];

/** Emphasis props: a prop that exists to make a tile stand out.  If the only
 *  colour it can produce is the failure colour, then every emphasised tile is
 *  a failure — which is how a $640K gain came to be painted brand red. */
const EMPHASIS_PROPS = ["accent", "emphasis", "highlight", "featured", "prominent"];

/** the negative anchor, INCLUDING `variant="default"` on a chip.  Badge
 *  `default` is `bg-primary`, i.e. #CC0001.  Scoped to Badge deliberately:
 *  on a Button the same token is the ratified brand CTA fill, not a status. */
const NEG_IN_ATTRS = (attrs: string) =>
  isNegative(attrs) || /variant\s*=\s*"default"/.test(attrs);

/** WAVE 103 WAIVERS.  Each is a semantic decision on the record, not a
 *  silence.  The meta-test below refuses a waiver without a reason. */
const W103_WAIVED: Array<{ file: string; needle: string; why: string }> = [
  {
    file: "pages/CompanyDetails.tsx",
    needle: ">Yes<",
    why:
      "CONCENTRATION-RISK row.  The label reads `Yes` but the QUESTION is a " +
      "risk question (`ConcentrationRow`), so `Yes` means a risk flag is " +
      "PRESENT.  Rose is correct here and repainting it green would invert a " +
      "real warning.  This is the exact case the wave was told not to break: " +
      "a genuine negative must stay red even when its label sounds positive.",
  },
];

/** an alpha-suffixed BACKGROUND or BORDER (`bg-[…]/5`, `border-[…]/40`) is the
 *  documented brand PANEL TINT, not a status colour.  Status colours in this
 *  codebase are always full-opacity; the tint class was left alone platform-wide
 *  by Wave 101 §B.  Foreground/text colours are NOT exempted. */
const isTintOnly = (expr: string) => {
  const stripped = expr.replace(/\b(?:bg|border|from|to|via|ring)-\[[^\]]*\]\/\d+/g, "");
  return isNegative(expr) && !isNegative(stripped);
};

type UHit = { rel: string; line: number; shape: string; detail: string };
const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;

/** newline-PRESERVING comment blanking.  Wave 101 shipped four phantom waivers
 *  because a comment-stripping pass shifted every line number after it. */
const blank = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^([ \t]*)\/\/.*$/gm, (_m, p1) => p1);

function scanUnconditional(): UHit[] {
  const hits: UHit[] = [];
  const glyphRe = new RegExp(
    `<(${AFFIRMATIVE_GLYPHS.join("|")})\\b([^<>]{0,400}?)/?>`,
    "g"
  );
  const labelRe = new RegExp(
    `<(Badge|Chip|Pill|span|div|strong|b)\\b([^<>]{0,400}?)>\\s*` +
      `(${AFFIRMATIVE_LABELS.join("|")})\\s*<`,
    "gi"
  );

  for (const { abs, rel } of FILES) {
    if (!rel.endsWith(".tsx")) continue;
    const src = blank(read(abs));

    // §7 — affirmative glyph whose OWN attributes hard-wire the failure colour
    for (const m of src.matchAll(glyphRe)) {
      const attrs = m[2];
      if (attrs.includes("</")) continue; // runaway match guard
      if (!isNegative(attrs)) continue;
      hits.push({
        rel,
        line: lineOf(src, m.index!),
        shape: "affirmative glyph",
        detail: `<${m[1]} ${attrs.trim().slice(0, 90)}>`,
      });
    }

    // §9 — short affirmative label inside a failure-coloured chip
    for (const m of src.matchAll(labelRe)) {
      const attrs = m[2];
      if (attrs.includes("</") || attrs.length > 300) continue;
      if (!NEG_IN_ATTRS(attrs)) continue;
      // `variant="default"` is only the negative anchor on a chip
      if (!isNegative(attrs) && !/^Badge$/i.test(m[1])) continue;
      hits.push({
        rel,
        line: lineOf(src, m.index!),
        shape: "affirmative chip label",
        detail: `<${m[1]} …>${m[3]}<`,
      });
    }

    // §10 — an emphasis prop with a failure branch and NO positive branch
    for (const prop of EMPHASIS_PROPS) {
      const declared = new RegExp(`\\b${prop}\\?\\s*:`).test(src);
      if (!declared) continue;
      const negBranch = new RegExp(
        `\\b${prop}\\b[^\\n?]{0,40}\\?\\s*"([^"]{0,120})"`,
        "g"
      );
      let sawNegOnly = false;
      let where = 0;
      for (const m of src.matchAll(negBranch)) {
        if (!isNegative(m[1])) continue;
        if (isTintOnly(m[1])) continue; // brand panel tint, not a status
        // is there a positive branch for the same prop anywhere in the file?
        const hasPos = new RegExp(
          `\\b${prop}\\b\\s*===\\s*"positive"|\\b${prop}\\b[^\\n]{0,60}emerald`
        ).test(src);
        if (!hasPos) {
          sawNegOnly = true;
          where = m.index!;
        }
      }
      if (sawNegOnly) {
        hits.push({
          rel,
          line: lineOf(src, where),
          shape: "emphasis prop, failure-only",
          detail: `\`${prop}\` can only ever render the failure colour`,
        });
      }
    }
  }
  return hits.filter(
    (h) =>
      !W103_WAIVED.some((w) => w.file === h.rel && h.detail.includes(w.needle))
  );
}

const UHITS = scanUnconditional();

describe("W103 · THE FENCE — an UNCONDITIONAL colour cannot carry the wrong meaning", () => {
  it("the unconditional sweep actually reads the tree", () => {
    // Same floor as §A: an empty scan would make every check below vacuous.
    expect(FILES.filter((f) => f.rel.endsWith(".tsx")).length).toBeGreaterThan(300);
    // and it must be able to SEE colour: the tree contains affirmative glyphs
    const anyGlyph = FILES.filter((f) => f.rel.endsWith(".tsx")).some((f) =>
      new RegExp(`<(${AFFIRMATIVE_GLYPHS.join("|")})\\b`).test(read(f.abs))
    );
    expect(anyGlyph).toBe(true);
  });

  it("R80 — the founder Billing page is NOT in the unconditional swept set", () => {
    expect(FILES.some((f) => f.rel === "pages/founder/Billing.tsx")).toBe(false);
  });

  it("every W103 waiver carries a written reason (a waiver is a decision, not a silence)", () => {
    for (const w of W103_WAIVED) {
      expect(w.why.trim().length, `waiver ${w.file}/${w.needle} has no reason`)
        .toBeGreaterThan(40);
    }
  });

  it("ZERO affirmative glyphs, chips or emphasis props are hard-wired to the failure colour", () => {
    const report = UHITS.map(
      (h) => `  ${h.rel}:${h.line}  [${h.shape}]  ${h.detail}`
    ).join("\n");
    expect(
      UHITS.length,
      `\nUNCONDITIONAL SEMANTIC COLOUR INVERSION(S) — a mark whose meaning is\n` +
        `positive is painted the failure colour.  This is not a state-machine\n` +
        `problem; the colour is fixed in the markup, so no input can make it\n` +
        `right.  Use the positive anchor (#2C7346, via emerald-700 / Badge\n` +
        `variant="positive"), or make the colour follow the already-computed\n` +
        `sign if the value can legitimately be negative.\n\n${report}\n`
    ).toBe(0);
  });
});

describe("W103 · the six unconditional fixes are pinned", () => {
  const f = (rel: string) => code(read(path.join(CLIENT, rel)));

  it("U1 the $640K unrealised gain follows its SIGN — a real loss stays red", () => {
    const src = f("components/investor/PortfolioCompanyOverview.tsx");
    // the prop can express a direction at all …
    expect(src).toContain('accent?: boolean | "positive" | "negative"');
    // … it maps positive to the anchor …
    expect(src).toContain("border-emerald-700");
    expect(src).toContain("text-emerald-700");
    // … and the Current mark tile is SIGN-AWARE, not simply repainted green.
    // `m` is moic(); m >= 1 means the mark is at or above cost.
    expect(src).toMatch(/accent=\{m >= 1 \? "positive" : "negative"\}/);
    // the two NEUTRAL emphasis tiles keep the brand accent, unchanged
    expect(src).toContain("border-primary");
  });

  it("U2 the invitation tick bullet is a positive mark, not a failure", () => {
    const src = f("pages/investor/Invitations.tsx");
    expect(src).toMatch(/<Check className="h-3\.5 w-3\.5 text-emerald-700/);
    expect(src).not.toMatch(/<Check className="[^"]*hsl\(0 100%/);
  });

  it("U3 the company-switcher tick marks the ACTIVE company", () => {
    const src = f("components/CompanySwitcher.tsx");
    expect(src).toMatch(/<Check className="h-4 w-4 text-emerald-700"/);
    expect(src).not.toMatch(/<Check className="[^"]*hsl\(0 100%/);
  });

  it("U4 the shared completion bar fills with the positive anchor", () => {
    // Twelve call sites, every one of them progress-to-completion:
    // profile completeness, import progress, round progress, onboarding,
    // soft-circle coverage, deal-room readiness, transaction prep.
    const src = f("components/ui/progress.tsx");
    expect(src).toContain("bg-emerald-700");
    expect(src).not.toContain("bg-primary");
  });

  it("U5 chain-integrity `ok` is no longer the same colour as `broken`", () => {
    const src = f("pages/admin/AuditChainVerifyPage.tsx");
    expect(src).toContain('<Badge variant="positive">ok</Badge>');
    // and the genuine failure stays destructive — the pair must stay DISTINCT
    expect(src).toContain('<Badge variant="destructive">broken</Badge>');
    expect(src).not.toContain('<Badge variant="default">ok</Badge>');
  });

  it("U6 the ACTIVE plan tier on founder Settings is positive, not a failure", () => {
    const src = f("pages/founder/Settings.tsx");
    expect(src).toContain('<Badge className="bg-emerald-700 text-white">Active</Badge>');
    expect(src).toContain('isActive ? "border-emerald-700 border-2" : ""');
  });

  it("R80 — founder Billing is NOT the file that was changed", () => {
    // Settings.tsx and Billing.tsx are different founder billing surfaces and
    // the ruling covers only Billing.tsx.  Mechanically: Billing.tsx contains
    // no Progress bar, no KvCard/accent and no Check glyph, so none of U1–U6
    // can reach it even indirectly.
    const billing = read(path.join(CLIENT, "pages/founder/Billing.tsx"));
    expect(/<Progress\b/.test(billing)).toBe(false);
    expect(/\baccent\b/.test(billing)).toBe(false);
    expect(/<Check\b/.test(billing)).toBe(false);
  });
});
