#!/usr/bin/env node
/**
 * scripts/restyle-drop-detector/detect.mjs — WAVE 0 · THE RESTYLE DROP DETECTOR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — the shipped guard cannot catch a dropped widget in a
 * restyle, and that is measured, not asserted.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `scripts/silent-drop-guard` maintains EIGHT inventories (routes, clientRoutes,
 * nav, tabs, buttons, events, copy, panels + routeTargets) and it is much
 * stronger than its own README claims. It still has three holes that a RESTYLE
 * specifically falls through. All three were located in its source:
 *
 *   H1  A copy attribute whose value is an EXPRESSION is skipped outright.
 *       `extract-inventory.ts`:  if (v && !v.startsWith("<expr:")) out.copy.add(…)
 *       So a deleted `aria-label={t("save")}` is invisible.
 *
 *   H2  TOAST COPY IS NOT INVENTORIED AT ALL. The string "toast" does not appear
 *       anywhere in `extract-inventory.ts`. Deleting a confirmation or an error
 *       message leaves every gate green.
 *
 *   H3  JSX EXPRESSION CHILDREN ARE NOT COPY. The copy walk handles
 *       `ts.isJsxText` only, so `<p>{label}</p>` and `<td>{formatMinor(x)}</td>`
 *       are invisible — AND THAT IS WHERE EVERY RENDERED NUMBER LIVES. This is
 *       the largest of the three.
 *
 * The decisive demonstration: a restyle can EMPTY A MONEY FIGURE while leaving
 * its `data-testid` in place. A test-id count check, the silent-drop guard, the
 * reachability gate, `tsc` and the entire vitest suite all stay GREEN. Only a
 * rendered-figure inventory sees it. That mutation is re-proved on every run of
 * `prove_poles.mjs`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT ASSERTS — eleven inventories and three per-file counters
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   SET INVENTORIES — a member that disappears is a DROP.
 *     jsxTextCopy      a deleted heading or literal label
 *     exprChild        H3 — a deleted rendered figure or interpolated label
 *     toastCopy        H2 — a deleted confirmation / error message
 *     copyExprAttr     H1 — a deleted expression-valued aria-label/title/…
 *     statusPill       a pill that lost its colour meaning
 *     moneyOrPercent   A DELETED MONEY OR PERCENT FIGURE — a money defect
 *     emptyState       a deleted "you have nothing" / refusal message
 *     tableColumn      a deleted table column
 *     elementInventory per file, per tag, BUCKETED COUNT of every JSX element
 *     tabPanelReach    per file, every TabsContent value + whether a trigger reaches it
 *     interactiveSite  per file, every interactive element, keyed by identity
 *
 *   PER-FILE COUNTERS — a number that FALLS is a DROP. (A rise is reported as
 *   an addition and never fails, because Wave 0's rule is "the count may go up,
 *   never down".)
 *     elements         every JSX element in the file
 *     interactiveAll   the reachability gate's INTERACTIVE_TAGS ∪ INTERACTIVE_ROLES
 *     interactiveAncestors  the gate's FLATTENING set — the 1,303 figure
 *     tabPanels / tabTriggers
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW TO READ A FAILURE — the DROPPED/ADDED pair rule
 * ═══════════════════════════════════════════════════════════════════════════
 * `exprChild`, `copyExprAttr` and `moneyOrPercent` are CONTENT DIGESTS.
 * Legitimately editing an expression shows as one DROPPED plus one ADDED.
 *   · a DROPPED with a matching ADDED in the same file and parent tag is
 *     "CHANGED — review it";
 *   · a BARE DROPPED is "GONE — block it".
 * The report labels each drop with `pairedAddition: true|false` so this is not
 * left to judgement.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT CANNOT CATCH — stated plainly, because a gate that oversells itself
 * is worse than no gate
 * ═══════════════════════════════════════════════════════════════════════════
 *  1. SOMETHING RENDERED BUT INVISIBLE. `opacity:0`, `height:0`, behind another
 *     element, or clipped out of a scroll container passes every static check
 *     AND a DOM node count. Only human eyes on a screenshot catch it. This is
 *     the largest residual risk in a restyle, because a restyle is exactly the
 *     kind of change that produces it.
 *  2. A COLOUR THAT IS LEGAL BUT WRONG. Mapping `wired` to negative instead of
 *     positive passes everything here.
 *  3. COPY INSIDE A HELPER FUNCTION. `const label = s === "paid" ? "Paid" : "…"`
 *     is not JSX. Neither this detector nor the shipped guard inventories it.
 *  4. SERVER-RENDERED AND EMAIL COPY. Out of scope entirely.
 *  5. A DECLARATION GOING MISSING. Per-file inventories cover a nested
 *     sub-component's CONTENTS, so deleting its body is caught — but the fact
 *     that the DECLARATION vanished is not reported as such. (The reachability
 *     gate cannot see nested declarations at all: exactly 1 exists today,
 *     `MarkTooltip` in `components/investor/PortfolioCompanyOverview.tsx`.)
 *  6. A FILE THAT IS DELETED WHOLESALE is caught — every one of its inventory
 *     rows disappears — but a file that is RENAMED reads as a mass drop plus a
 *     mass addition and needs a human to confirm it is a rename.
 *  7. RUNTIME REACHABILITY, PARTIALLY. `tabPanelReach` is static pairing.
 *     WAVE 102 NARROWED THIS: a trigger whose `disabled` is a CONSTANT (bare
 *     `disabled`, or `disabled={true}`) can never be clicked, so it no longer
 *     counts as reaching its panel and the panel reads `reachable=NO`. What is
 *     still out of scope is a trigger disabled by a RUNTIME expression
 *     (`disabled={!selectedRun}` — legitimate and dynamic) or a panel inside a
 *     collapsed ancestor. Those remain the F-1 class and belong to
 *     `npm run reachability`'s R3 rule.
 *  8. WHETHER IT LOOKS GOOD. No instrument measures investor-grade.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WAVE 102 · SUPPRESSION IS A REMOVAL — the hole Reviewer C proved, and the fix
 * ═══════════════════════════════════════════════════════════════════════════
 * Reviewer C (`build_log/final_review_2026_08_21/reviewerC/`) defeated this gate
 * SEVEN times with changes that DELETE NOTHING. The decisive one was one token:
 *
 *     - <InvestorSiloPanel />                    pages/investor/Dashboard.tsx
 *     + {false && <InvestorSiloPanel />}
 *     -> 0 disappearances, 0 count decreases, exit 0, "OK — nothing was removed"
 *
 * That silently removed every money figure on the investor dashboard spine.
 * ROOT CAUSE, and it is ruling R82's blind spot: R82 enumerated "the signatures
 * of actual loss" as bare disappearances, per-file count decreases and an
 * unreachable tab panel. ALL THREE ARE SIGNATURES OF DELETION. Suppression
 * deletes nothing, so nothing disappears.
 *
 * THE FIX, and the principle behind it: rendered content that is STATICALLY
 * PROVABLY DEAD is not inventoried at all. To a user a suppressed widget and a
 * deleted widget are the same widget-shaped hole in the screen, so the detector
 * now makes them the same finding. Because the dead subtree stops being
 * inventoried, a suppression produces exactly the BARE DROPS and COUNT
 * DECREASES a deletion produces — it reuses the machinery that was already
 * proved undefeatable against deletion, rather than adding a parallel one.
 *
 * WHAT COUNTS AS PROVABLY DEAD (`foldConst` + `collectDeadRanges`):
 *   · `X && Y` where X folds to a falsy literal — `false`, `0`, `""`, `null`,
 *     `undefined`, `void 0`, `!1`, `!true`;
 *   · `X && Y` where Y folds to something that renders nothing — `""`, `null`,
 *     `undefined`, `false` (Reviewer C's B3, `{formatMinor(...) && ""}`);
 *   · `X || Y` where X folds to a truthy literal that renders nothing (`true`),
 *     which makes Y dead;
 *   · a ternary whose CONDITION folds to a constant — the untaken branch is dead,
 *     and if the taken branch renders nothing the whole expression is dead;
 *   · `return null && (…)` / `return false && (…)` on a whole component — this
 *     falls out of the `&&` rule, which is applied to EVERY BinaryExpression
 *     containing JSX, not only to JSX children.
 *
 * R82 STANDS OTHERWISE. The paired downgrade is untouched and is still
 * necessary: `exprChild` hashes source text, so a legitimate content fix trips
 * the gate by construction, and a gate re-baselined every wave is not evidence
 * of anything. A legitimate content fix never introduces a constant-false guard,
 * so the two rules do not interact.
 *
 * AND A CONTROL WHOSE HANDLER IS PROVABLY DEAD IS A REMOVAL TOO. Reviewer C's
 * B4 kept a control on screen, renamed its `onClick` to a dead `data-` prop and
 * added `disabled`: 0 disappearances of any kind. `deadControl` now reports an
 * interactive control that carries no handler, no navigation affordance, no
 * spread, and inherits none from a Trigger/`asChild`/prop-slot ancestor.
 *
 * TWO ALLOWLISTS, EACH WITH ITS AUTHORITY IN SOURCE. Both new signatures are
 * absolute — ANY unallowlisted occurrence fails — so neither needs a row in
 * `baseline.json` and NO RE-BASELINE WAS PERFORMED for Wave 102. The pristine
 * tree was measured first (`build_log/wave102/EVIDENCE/`): exactly ONE
 * suppression and NINE dead-control candidates, of which one was a false
 * positive the ancestor rule now clears. The remaining eight are enumerated
 * below with a reason each. An ALLOWLISTED suppression is deliberately NOT
 * skipped from the inventory, because `baseline.json` was cut with the previous
 * detector and does contain its subtree; skipping it would manufacture bare
 * drops against a baseline nobody changed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USAGE
 * ═══════════════════════════════════════════════════════════════════════════
 *   node scripts/restyle-drop-detector/detect.mjs --verify
 *        compare the tree against the committed baseline.json. Exit 1 on any
 *        disappearance or any per-file count DECREASE. This is what `preflight`
 *        runs.
 *   node scripts/restyle-drop-detector/detect.mjs --emit <file.json>
 *        write an inventory snapshot (used to create/refresh the baseline and to
 *        snapshot a "before" tree).
 *   node scripts/restyle-drop-detector/detect.mjs --compare <before.json>
 *        compare against an arbitrary snapshot instead of the baseline.
 *   Options: --root <dir> (default: repo root) · --scope <rel> (default:
 *   client/src, repeatable) · --json <file> (machine-readable report).
 *
 * Exit 0 = nothing disappeared. Exit 1 = a drop. Exit 2 = the detector could
 * not do its job (no files found, unreadable baseline) — a gate that finds
 * nothing to check must FAIL, never pass quietly.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const BASELINE = path.join(HERE, "baseline.json");

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const vals = (f) => {
  const out = [];
  argv.forEach((a, i) => {
    if (a === f && argv[i + 1]) out.push(argv[i + 1]);
  });
  return out;
};

const ROOT = path.resolve(val("--root", REPO_ROOT));
const SCOPES = vals("--scope").length ? vals("--scope") : ["client/src"];

/* ── the classification tables ─────────────────────────────────────────────
   INTERACTIVE_TAGS / INTERACTIVE_ROLES / FLATTENING_* are copied VERBATIM from
   scripts/reachability/reachability_gate.ts so the two instruments count the
   same population. If that gate's tables change, change these in the same
   commit — the total `interactiveAncestors` here must keep equalling the 1,303
   the gate prints. */
const INTERACTIVE_TAGS = new Set([
  "button", "a", "input", "select", "textarea",
  "Button", "IconButton", "LinkButton", "Link", "Input", "Textarea", "Checkbox",
  "Switch", "Slider", "RadioGroupItem", "Select", "SelectTrigger",
  "Tabs", "TabsList", "TabsTrigger", "DropdownMenuTrigger", "PopoverTrigger",
  "DialogTrigger", "AccordionTrigger", "ToggleGroupItem", "Toggle",
]);
const INTERACTIVE_ROLES = new Set([
  "button", "link", "tab", "checkbox", "radio", "switch", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "textbox", "combobox",
  "slider", "spinbutton", "searchbox", "treeitem",
]);
const FLATTENING_TAGS = new Set(["button", "a", "Button", "IconButton", "LinkButton", "Link"]);
const FLATTENING_ROLES = new Set(["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"]);

const COPY_ATTRS = new Set([
  "title", "label", "placeholder", "aria-label", "alt", "description",
  "emptyMessage", "tooltip", "heading", "subtitle", "caption", "helpText",
]);
const PALETTE =
  /\b(?:bg|text|border|ring|divide|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g;
const MONEY =
  /\b(formatMinor|formatMoney|formatCurrency|formatUsd|toLocaleString|formatPercent|formatBps|formatPct|Intl\.NumberFormat)\b/;
const EMPTY_HINT =
  /\b(no |none|empty|nothing|not available|unavailable|could not|couldn't|cannot|failed|refus|yet\b)/i;

const digest = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
const norm = (s) => s.replace(/\s+/g, " ").trim();

/* ══ WAVE 102 · SUPPRESSION DETECTION ═══════════════════════════════════════
   `foldConst` answers one question and refuses to guess: does this expression
   have a value that is KNOWN AT PARSE TIME? It folds only literals and the
   operators over literals whose result cannot depend on data. Anything else
   returns `known:false` and is left alone — the same no-guessing rule the
   internal-language fence follows for `join(String.fromCharCode(95))`.

     falsy   — the value is falsy, so `falsy && Y` never evaluates Y
     renders — the value, if rendered by React as a child, produces visible
               output. `false`, `null`, `undefined` and `""` render NOTHING;
               `0` renders the character "0", which is why `0` is falsy but
               DOES render and must not be confused with the others. */
function foldConst(n) {
  if (!n) return { known: false };
  if (ts.isParenthesizedExpression(n)) return foldConst(n.expression);
  if (ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n)) return foldConst(n.expression);
  switch (n.kind) {
    case ts.SyntaxKind.FalseKeyword: return { known: true, falsy: true, renders: false, txt: "false" };
    case ts.SyntaxKind.TrueKeyword: return { known: true, falsy: false, renders: false, txt: "true" };
    case ts.SyntaxKind.NullKeyword: return { known: true, falsy: true, renders: false, txt: "null" };
    default: break;
  }
  if (ts.isIdentifier(n) && n.text === "undefined")
    return { known: true, falsy: true, renders: false, txt: "undefined" };
  if (ts.isVoidExpression(n)) /* `void 0`, `void anything` — always undefined */
    return { known: true, falsy: true, renders: false, txt: norm(n.getText()) };
  if (ts.isNumericLiteral(n)) {
    const z = Number(n.text) === 0;
    return { known: true, falsy: z, renders: !z, txt: n.text };
  }
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
    const e = n.text === "";
    return { known: true, falsy: e, renders: !e, txt: JSON.stringify(n.text) };
  }
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    const i = foldConst(n.operand);
    if (i.known) return { known: true, falsy: !i.falsy, renders: false, txt: "!" + i.txt };
  }
  /* NESTED LOGICAL CHAINS. `{false && cond && <Money/>}` parses as
     `((false && cond) && <Money/>)`, so without this the OUTER `&&` sees a
     BinaryExpression on its left, folds nothing, and the whole chain escapes.
     That is not hypothetical: it is the shape of the one deliberate dead block
     in this tree, and it would have been a free laundering route. */
  if (ts.isBinaryExpression(n)) {
    if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const L = foldConst(n.left);
      if (L.known && L.falsy) return { known: true, falsy: true, renders: false, txt: L.txt + " && …" };
      if (L.known && !L.falsy) return foldConst(n.right);   /* `true && Y` is Y */
    }
    if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const L = foldConst(n.left);
      if (L.known && !L.falsy) return L;                     /* `true || Y` is true */
      if (L.known && L.falsy) return foldConst(n.right);     /* `false || Y` is Y */
    }
    if (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      const L = foldConst(n.left);
      /* `null ?? Y` is Y; `"" ?? Y` is "" because "" is not nullish */
      if (L.known && (L.txt === "null" || L.txt === "undefined" || ts.isVoidExpression(n.left))) {
        return foldConst(n.right);
      }
      if (L.known) return L;
    }
  }
  return { known: false };
}

const containsJsx = (n) => {
  let found = false;
  const w = (x) => {
    if (found) return;
    if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x) || ts.isJsxText(x)) {
      found = true;
      return;
    }
    ts.forEachChild(x, w);
  };
  w(n);
  return found;
};

/* Is this expression IN A RENDERED POSITION? `containsJsx` alone is not enough:
   `{false && formatMinor(t.minor, t.currency)}` contains no JSX node at all, yet
   it is exactly how Reviewer C emptied the investor watchlist per-currency total
   (B1) and then all five money renders in the panel (B2). What makes it a
   removal is not that it holds JSX — it is that it SITS WHERE A USER READS IT.
   Two such positions: the child of a JSX element/fragment, and the value of a
   JSX attribute (a suppressed `title`/`aria-label` is content a user or a screen
   reader loses). */
const inRenderedPosition = (n) => {
  let cur = n;
  while (cur.parent && ts.isParenthesizedExpression(cur.parent)) cur = cur.parent;
  const p = cur.parent;
  if (!p || !ts.isJsxExpression(p)) return false;
  const g = p.parent;
  if (!g) return false;
  return ts.isJsxElement(g) || ts.isJsxFragment(g) || ts.isJsxAttribute(g);
};

/* The allowlist key is deliberately CONTENT-ADDRESSED, not line-addressed: the
   file plus a digest of the first 120 normalised characters of the dead
   expression. Moving the block does not need a re-pin; EDITING THE GUARD does,
   which is exactly when a human should look at it. */
const suppressionKey = (rel, node) => `${rel}\t${digest(norm(node.getText()).slice(0, 120))}`;

/* ── ALLOWLIST 1 · deliberate, cited, statically-dead rendered content ──────
   Measured on the pristine tree before this signature was implemented:
   exactly ONE site. Its authority is written beside it in its own file, which
   is the standard the owner set for the stylesheet pins. */
const SUPPRESSION_ALLOWLIST = new Map([
  ["client/src/pages/founder/TermSheet.tsx\t1099890371ee",
   "TermSheet.tsx:973 · `false && partnersByRegion(…).length === 0 && CONSORTIUM_PARTNERS" +
   ".slice(0, 0).map(…)`. AUTHORITY IS IN THE SOURCE, in a comment immediately above the " +
   "block at :968-972: the v25.23 NC-C fix. The previously ungated fallback rendered " +
   "CONSORTIUM_PARTNERS.slice(0,6) and leaked the placeholder firm directory — firms that " +
   "have NOT confirmed Collective membership — to founders as if it were real. The empty " +
   "state directly above it at :963 is the real render. Deliberately dead: making it " +
   "render again would re-introduce a data-honesty defect. Wave 102 re-read the citation " +
   "and confirmed it is present and accurate. This is the ONLY suppression in the tree."],
]);

/* ── ALLOWLIST 2 · controls that carry no handler, each with a reason ───────
   Measured on the pristine tree: 9 candidates, 1 of which (Glossary.tsx:336, a
   <button> passed as a `trigger=` PROP) is a false positive the prop-slot
   ancestor rule now clears without an entry. The other 8 are listed. TWO OF
   THEM ARE GENUINELY DEAD AND ARE REPORTED AS FINDINGS in
   build_log/wave102/W102_SUPPRESSION.md — they belong to R88's carried-forward
   dead-controls programme, not to this gate, and Wave 102 does not own those
   files. They are allowlisted so the gate measures CHANGE rather than
   re-reporting known debt, and each entry says which it is. */
const DEAD_CONTROL_ALLOWLIST = new Map([
  /* — DELIBERATE, HONEST REFUSALS. Each renders disabled ON PURPOSE and says so
       on screen or in a source comment at the site. Disabling these entries
       would train a reader to ignore this signature, which is the R84 argument. */
  ["client/src/components/CollectiveDeepLink.tsx\tButton\tdata-testid=<expr:f7dfb2f38fbf>",
   "DELIBERATE REFUSAL, :54-58. When the entity is not yet synced to Collective the " +
   "component renders a disabled Button carrying title='Not yet synced to Collective' " +
   "instead of an anchor, because anchors ignore `disabled`. The reason is written at " +
   "the site. An honest refusal, not a dead control."],
  ["client/src/pages/founder/RoundDetail.tsx\tButton\tdata-testid=button-add-uop",
   "DELIBERATE REFUSAL, :1717. `disabled aria-disabled='true'` with title='Not available " +
   "on this screen — record use of proceeds on the round wizard.' AND a sibling sentence " +
   "at :1718 (`uop-editor-unavailable`) telling the founder where to do it instead."],
  ["client/src/pages/founder/RoundDetail.tsx\tButton\tdata-testid=button-add-scenario",
   "DELIBERATE REFUSAL, :2031. Disabled with a sibling sentence at :2032 " +
   "(`text-scenario-editor-unavailable`) explaining that adding a what-if scenario is not " +
   "yet available and that the engine-computed scenarios below are real."],
  ["client/src/pages/partner/PartnerFundDetail.tsx\tButton\tdata-testid=partner-pledge-submit",
   "DELIBERATE REFUSAL, :213. The whole pledge form is disabled behind an amber on-screen " +
   "note (`partner-fund-pledge-disabled-note`, :192-196) stating the commitment endpoint " +
   "requires an existing LP contact and telling the partner to seat LPs from the SPV " +
   "Engine instead. A source comment at :182-188 records that re-enabling is a one-line " +
   "change and is logged in build_log/WAVE2_REPORT.md. The `onClick` is retained " +
   "deliberately — nothing is deleted."],

  /* — SACRED. WAIVER-1 covers the public marketing home page. READ, NEVER EDITED.
       These are static landing-page controls in a file this wave may not touch. */
  ["client/src/components/home3compo/Header3.jsx\tbutton\tord=1",
   "SACRED (WAIVER-1) · :145, the Sign In dropdown trigger. Marketing markup on the " +
   "public home page. Read, never edited."],
  ["client/src/components/home3compo/Header3.jsx\tbutton\taria-label=Open menu",
   "SACRED (WAIVER-1) · :210, the mobile menu open toggle. Read, never edited."],
  ["client/src/components/home3compo/Header3.jsx\tbutton\taria-label=Close menu",
   "SACRED (WAIVER-1) · :230, the mobile menu close toggle. Read, never edited."],

  /* — GENUINELY DEAD, REPORTED AND NOT FIXED. These are real: a user can see and
       press them and nothing happens. They are PRE-EXISTING, they belong to
       R88's carried-forward dead-controls programme, and WAVE 102 DOES NOT OWN
       EITHER FILE (`components/comms` and the founder money screens are outside
       this wave's ownership; RoundDetail.tsx is a money screen and WAVE 100 owns
       money paths). They are allowlisted so this signature measures CHANGE
       rather than re-reporting known debt on every run, and they are written up
       in build_log/wave102/W102_SUPPRESSION.md so they are not lost. */
  ["client/src/components/comms/MessagesPage.tsx\tButton\tdata-testid=button-emoji",
   "GENUINELY DEAD — REPORTED, NOT FIXED. :863, an emoji Button with no onClick, no " +
   "navigation and no trigger ancestor. Its sibling `button-attach` at :864 has a real " +
   "onClick, so this is an unfinished control rather than a decorative one. Wave 102 does " +
   "not own client/src/components/comms."],
  ["client/src/pages/founder/RoundDetail.tsx\tButton\tdata-testid=<expr:ed931a69625f>",
   "GENUINELY DEAD — REPORTED, NOT FIXED. :770, `button-view-${s.id}`, an Eye icon on " +
   "every soft-circle row with no onClick and no trigger ancestor. RoundDetail.tsx is a " +
   "money screen and WAVE 100 owns money paths."],
]);

const ON_HANDLER = /^on[A-Z]/;
/* A component whose name ends in `Trigger`, or any Radix-style overlay root, or
   an anchor/label, supplies the handler to a bare child control via `asChild`
   or a render slot. Copied as a NAME rule deliberately: the detector is
   single-file and cannot resolve the import, and over-reporting a working
   control is how a gate gets ignored. */
const HANDLER_ANCESTOR =
  /Trigger$|^Link$|^a$|^label$|^Slot$|^Tooltip|^Popover|^Dialog|^Sheet|^Dropdown|^AlertDialog|^HoverCard|^Menubar|^Collapsible|^Accordion|^Select|^Command|^Drawer|^ContextMenu/;
const DEAD_CONTROL_TAGS = /^(button|Button|IconButton|LinkButton)$/;

/* Counts are BUCKETED so that a cosmetic ±1 on a mapped list does not spam the
   report, while a real deletion still crosses a bucket boundary. Buckets are
   exact for small counts, where a single deletion matters most. */
function bucket(n) {
  if (n <= 10) return String(n);
  if (n <= 20) return "11-20";
  if (n <= 50) return "21-50";
  if (n <= 100) return "51-100";
  return "100+";
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const isTest = (rel) => rel.includes("__tests__") || /\.(test|spec)\.(tsx|jsx)$/.test(rel);

function attrLiteral(open, name, sf) {
  for (const p of open.attributes.properties) {
    if (!ts.isJsxAttribute(p) || p.name.getText(sf) !== name) continue;
    const init = p.initializer;
    if (!init) return "";
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) {
      if (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) {
        return init.expression.text;
      }
      return `<expr:${digest(norm(init.expression.getText(sf)))}>`;
    }
  }
  return undefined;
}

/* ══ WAVE 102 · collect every statically-dead JSX region in one file ══════════
   Returns the character ranges whose contents must NOT be inventoried, plus one
   finding row per region. Only regions that actually CONTAIN RENDERED CONTENT
   are reported: `{cond && ""}` on a non-JSX value is a code smell, not a
   removal, and this gate is about the screen. */
function collectDeadRanges(sf, rel) {
  const ranges = [];
  const findings = [];
  const seen = new Set();

  const mark = (node, reason) => {
    const start = node.getStart(sf);
    const end = node.getEnd();
    if (seen.has(`${start}:${end}`)) return;
    seen.add(`${start}:${end}`);
    /* a region already inside a dead region is the same removal, reported once */
    if (ranges.some((r) => start >= r.start && end <= r.end)) return;
    const key = suppressionKey(rel, node);
    const allowed = SUPPRESSION_ALLOWLIST.get(key);
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    const excerpt = norm(node.getText(sf)).slice(0, 110);
    if (allowed) {
      /* NOT skipped — see the header. baseline.json contains this subtree. */
      findings.push({ rel, line, reason, excerpt, key, allowlisted: true, why: allowed });
      return;
    }
    ranges.push({ start, end });
    findings.push({ rel, line, reason, excerpt, key, allowlisted: false });
  };

  const visit = (n) => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        const L = foldConst(n.left);
        const R = foldConst(n.right);
        if (L.known && L.falsy && (containsJsx(n.right) || inRenderedPosition(n))) {
          mark(n, `constant-false && guard (left folds to ${L.txt})`);
        } else if (R.known && !R.renders && (containsJsx(n.left) || inRenderedPosition(n))) {
          /* `{formatMinor(…) && ""}` — the call runs, the render is empty. The
             LEFT is what used to reach the screen, so the whole expression is
             the removal. */
          mark(n, `&& right operand renders nothing (${R.txt})`);
        }
      }
      if (op === ts.SyntaxKind.BarBarToken) {
        const L = foldConst(n.left);
        if (L.known && !L.falsy && (containsJsx(n.right) || inRenderedPosition(n))) {
          mark(n, `constant-truthy || short-circuit (left folds to ${L.txt}) — right is dead`);
        }
      }
    }
    if (ts.isConditionalExpression(n)) {
      const C = foldConst(n.condition);
      if (C.known) {
        const deadBranch = C.falsy ? n.whenTrue : n.whenFalse;
        const liveBranch = C.falsy ? n.whenFalse : n.whenTrue;
        const live = foldConst(liveBranch);
        if (live.known && !live.renders && (containsJsx(deadBranch) || inRenderedPosition(n))) {
          mark(n, `ternary with constant condition (${C.txt}); the live branch renders nothing`);
        } else if (containsJsx(deadBranch)) {
          mark(deadBranch, `unreachable branch of a ternary with a constant condition (${C.txt})`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return { ranges, findings };
}

/* ══ WAVE 102 · is this control's handler provably dead? ═════════════════════
   Reachable if it carries a handler / navigation / spread itself, OR inherits
   one from a Trigger, an `asChild` wrapper, an anchor, a form (implicit submit),
   or a JSX-attribute slot (`trigger={<button…>}`). Anything else is a control a
   user can see and press to no effect. */
function deadControlReason(open, sf) {
  let hasOn = false, spread = false, nav = false, asChild = false, type = null;
  let literalDisabled = false;
  for (const p of open.attributes.properties) {
    if (ts.isJsxSpreadAttribute(p)) { spread = true; continue; }
    if (!ts.isJsxAttribute(p)) continue;
    const nm = p.name.getText(sf);
    if (ON_HANDLER.test(nm)) hasOn = true;
    if (nm === "asChild") asChild = true;
    if (nm === "href" || nm === "to" || nm === "form") nav = true;
    if (nm === "type" && p.initializer && ts.isStringLiteral(p.initializer)) type = p.initializer.text;
    if (nm === "disabled") {
      if (!p.initializer) literalDisabled = true;
      else if (ts.isJsxExpression(p.initializer) && p.initializer.expression &&
               p.initializer.expression.kind === ts.SyntaxKind.TrueKeyword) literalDisabled = true;
    }
  }
  if (hasOn || spread || nav || asChild || type === "submit") {
    /* it has a handler — but a CONSTANT `disabled` means it can never fire */
    return literalDisabled ? "has a handler but `disabled` is a constant — it can never fire" : null;
  }
  let p = open.parent;
  while (p) {
    if (ts.isJsxAttribute(p)) return null;              /* passed as a prop slot */
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p)) {
      const o = ts.isJsxElement(p) ? p.openingElement : p;
      const ptag = o.tagName.getText(sf);
      if (HANDLER_ANCESTOR.test(ptag)) return null;
      for (const q of o.attributes.properties) {
        if (ts.isJsxSpreadAttribute(q)) return null;
        if (ts.isJsxAttribute(q)) {
          const nm = q.name.getText(sf);
          if (nm === "asChild" || ON_HANDLER.test(nm)) return null;
        }
      }
      if (ptag === "form" && type === null) return null; /* implicit submit */
    }
    if (ts.isSourceFile(p)) break;
    p = p.parent;
  }
  return literalDisabled
    ? "no handler, no navigation, no trigger ancestor, and `disabled` is a constant"
    : "no on* handler, no navigation affordance, no spread, no trigger ancestor";
}

function inventory() {
  const sets = {
    jsxTextCopy: new Set(), exprChild: new Set(), toastCopy: new Set(),
    copyExprAttr: new Set(), statusPill: new Set(), moneyOrPercent: new Set(),
    emptyState: new Set(), tableColumn: new Set(), elementInventory: new Set(),
    tabPanelReach: new Set(), interactiveSite: new Set(),
  };
  const perFile = {};
  const files = [];
  for (const scope of SCOPES) files.push(...walk(path.join(ROOT, scope)));
  let scanned = 0;
  const suppressions = [];        /* WAVE 102 */
  const deadControls = [];        /* WAVE 102 */

  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (isTest(rel)) continue;
    scanned++;
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    /* WAVE 102 · dead regions FIRST, so nothing inside one is ever inventoried.
       This is what makes a suppression indistinguishable from a deletion. */
    const { ranges: deadRanges, findings: deadFindings } = collectDeadRanges(sf, rel);
    for (const d of deadFindings) suppressions.push(d);
    const inDead = (n) => {
      if (!deadRanges.length) return false;
      const s = n.getStart(sf);
      return deadRanges.some((r) => s >= r.start && s < r.end);
    };

    const tagCount = new Map();
    const counters = {
      elements: 0, interactiveAll: 0, interactiveAncestors: 0,
      tabPanels: 0, tabTriggers: 0,
    };
    const panelValues = [];
    const triggerValues = [];
    let dynamicTrigger = false;
    const identityOrdinals = new Map();

    const handleOpen = (open, tag) => {
      counters.elements++;
      /* WAVE 102 · a control a user can press to no effect is a removal too. */
      if (DEAD_CONTROL_TAGS.test(tag)) {
        const why = deadControlReason(open, sf);
        if (why) {
          let cid = null;
          for (const k of ["data-testid", "id", "name", "value", "aria-label", "title", "href", "to"]) {
            const v = attrLiteral(open, k, sf);
            if (v !== undefined && v !== "") { cid = `${k}=${v}`; break; }
            if (v === "") { cid = `${k}=<expr>`; break; }
          }
          if (cid === null) {
            for (const p of open.attributes.properties) {
              if (ts.isJsxAttribute(p) && p.name.getText(sf) === "data-testid") { cid = "data-testid=<expr>"; break; }
            }
          }
          if (!cid) {
            const key = `${rel}\u0000dead\u0000${tag}`;
            const o = (identityOrdinals.get(key) ?? 0) + 1;
            identityOrdinals.set(key, o);
            cid = `ord=${o}`;
          }
          const dkey = `${rel}\t${tag}\t${cid}`;
          const allowed = DEAD_CONTROL_ALLOWLIST.get(dkey);
          deadControls.push({
            rel, tag, id: cid, key: dkey, reason: why,
            line: sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1,
            allowlisted: Boolean(allowed), why: allowed ?? undefined,
          });
        }
      }
      tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      const role = attrLiteral(open, "role", sf);
      const hasAsChild = open.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === "asChild",
      );

      const isInteractive = INTERACTIVE_TAGS.has(tag) || (role !== undefined && INTERACTIVE_ROLES.has(role));
      if (isInteractive) {
        counters.interactiveAll++;
        /* identity: the most stable discriminator available, ordinal last. */
        let id = null;
        for (const k of ["data-testid", "id", "name", "value", "aria-label", "title", "href", "to"]) {
          const v = attrLiteral(open, k, sf);
          if (v !== undefined && v !== "") { id = `${k}=${v}`; break; }
        }
        if (!id) {
          const key = `${rel}\u0000${tag}`;
          const o = (identityOrdinals.get(key) ?? 0) + 1;
          identityOrdinals.set(key, o);
          id = `ord=${o}`;
        }
        sets.interactiveSite.add(`${rel}\t${tag}\t${id}`);
      }
      if (!hasAsChild && (FLATTENING_TAGS.has(tag) || (role !== undefined && FLATTENING_ROLES.has(role)))) {
        counters.interactiveAncestors++;
      }

      if (tag === "TabsContent") {
        counters.tabPanels++;
        panelValues.push(attrLiteral(open, "value", sf) ?? "<none>");
      }
      if (tag === "TabsTrigger") {
        counters.tabTriggers++;
        /* WAVE 102 · a trigger whose `disabled` is a CONSTANT can never be
           clicked, so it does not reach its panel. A trigger disabled by a
           runtime expression (`disabled={!selectedRun}`) is legitimate and is
           still counted — the detector does not guess about data. This closes
           Reviewer C's B5 statically, without claiming runtime reachability. */
        let constDisabled = false;
        for (const p of open.attributes.properties) {
          if (!ts.isJsxAttribute(p) || p.name.getText(sf) !== "disabled") continue;
          if (!p.initializer) constDisabled = true;
          else if (ts.isJsxExpression(p.initializer) && p.initializer.expression &&
                   p.initializer.expression.kind === ts.SyntaxKind.TrueKeyword) constDisabled = true;
        }
        const v = attrLiteral(open, "value", sf);
        if (constDisabled) {
          /* contributes nothing to reachability, and cannot launder via the
             dynamicTrigger escape hatch either */
        } else if (v === undefined || String(v).startsWith("<expr:")) dynamicTrigger = true;
        else triggerValues.push(v);
      }

      for (const p of open.attributes.properties) {
        if (!ts.isJsxAttribute(p)) continue;
        const name = p.name.getText(sf);
        const init = p.initializer;
        if (COPY_ATTRS.has(name) && init && ts.isJsxExpression(init) && init.expression &&
            !ts.isStringLiteral(init.expression)) {
          sets.copyExprAttr.add(`${rel}\t${tag}\t${name}\t${digest(norm(init.expression.getText(sf)))}`);
        }
        if (name === "className" && init) {
          const hits = init.getText(sf).match(PALETTE);
          if (hits) sets.statusPill.add(`${rel}\t${tag}\t${[...new Set(hits)].sort().join(" ")}`);
        }
      }
    };

    const visit = (n) => {
      /* WAVE 102 · THE SKIP. Nothing inside a statically-dead region enters any
         inventory or any counter, so the region reads exactly as if it had been
         deleted — bare drops plus per-file count decreases. */
      if (inDead(n)) return;
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        handleOpen(n, n.tagName.getText(sf));
        const tag = n.tagName.getText(sf);
        if (tag === "TableHead" || tag === "th") {
          const parent = n.parent;
          let label = "<expr>";
          if (ts.isJsxElement(parent)) {
            const txt = parent.children.filter(ts.isJsxText).map((c) => norm(c.text)).join(" ").trim();
            if (txt) label = txt;
            else {
              const ex = parent.children.find((c) => ts.isJsxExpression(c) && c.expression);
              if (ex) label = `expr:${digest(norm(ex.expression.getText(sf)))}`;
            }
          }
          sets.tableColumn.add(`${rel}\t${tag}\t${label}`);
        }
      }
      if (ts.isJsxText(n)) {
        const t = norm(n.text);
        if (t.length >= 2 && /[A-Za-z0-9]/.test(t)) {
          sets.jsxTextCopy.add(`${rel}\ttext\t${t}`);
          if (EMPTY_HINT.test(t)) sets.emptyState.add(`${rel}\tempty\t${t}`);
        }
      }
      if (ts.isJsxExpression(n) && n.expression && n.parent &&
          (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
        const pt = ts.isJsxElement(n.parent) ? n.parent.openingElement.tagName.getText(sf) : "Fragment";
        const src = norm(n.expression.getText(sf));
        sets.exprChild.add(`${rel}\t${pt}\t${digest(src)}`);
        if (MONEY.test(src)) sets.moneyOrPercent.add(`${rel}\t${pt}\t${digest(src)}`);
      }
      if (ts.isCallExpression(n)) {
        const e = n.expression.getText(sf);
        if (/(^|\.)toast$|^toast\.\w+$/.test(e)) {
          const sv = (x) => {
            if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) {
              const t = norm(x.text);
              if (t.length >= 2) sets.toastCopy.add(`${rel}\ttoast\t${t}`);
            } else if (ts.isTemplateExpression(x)) {
              sets.toastCopy.add(`${rel}\ttoast\ttpl:${digest(norm(x.getText(sf)))}`);
            }
            ts.forEachChild(x, sv);
          };
          for (const a of n.arguments) sv(a);
        }
        if (MONEY.test(e)) sets.moneyOrPercent.add(`${rel}\tcall\t${digest(norm(n.getText(sf)))}`);
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);

    for (const [tag, n] of [...tagCount.entries()].sort()) {
      sets.elementInventory.add(`${rel}\t${tag}\t${bucket(n)}`);
    }
    for (const v of panelValues) {
      const reachable = dynamicTrigger || triggerValues.includes(v);
      sets.tabPanelReach.add(`${rel}\tpanel=${v}\treachable=${reachable ? "yes" : "NO"}`);
    }
    if (counters.elements > 0) perFile[rel] = counters;
  }

  if (scanned === 0) {
    console.error("restyle-drop-detector: FATAL — scanned 0 files. A gate that finds nothing must fail.");
    process.exit(2);
  }

  const out = {};
  for (const k of Object.keys(sets)) out[k] = [...sets[k]].sort();
  const totals = { filesScanned: scanned };
  for (const k of Object.keys(out)) totals[k] = out[k].length;
  for (const c of ["elements", "interactiveAll", "interactiveAncestors", "tabPanels", "tabTriggers"]) {
    totals[c] = Object.values(perFile).reduce((n, v) => n + v[c], 0);
  }
  totals.suppressions = suppressions.filter((s) => !s.allowlisted).length;
  totals.suppressionsAllowlisted = suppressions.filter((s) => s.allowlisted).length;
  totals.deadControls = deadControls.filter((d) => !d.allowlisted).length;
  totals.deadControlsAllowlisted = deadControls.filter((d) => d.allowlisted).length;
  return { totals, inventory: out, perFile, suppressions, deadControls };
}

/* ── compare ──────────────────────────────────────────────────────────────── */
function compare(before, now) {
  const drops = [];
  const adds = [];
  for (const k of Object.keys(now.inventory)) {
    const b = new Set(before.inventory[k] ?? []);
    const a = new Set(now.inventory[k]);
    for (const x of b) if (!a.has(x)) drops.push({ kind: "set", class: k, row: x });
    for (const x of a) if (!b.has(x)) adds.push({ kind: "set", class: k, row: x });
  }
  /* pair rule: a DROPPED digest with an ADDED digest in the same file+parent is
     "changed", not "gone". Reported, never used to silence a drop. */
  const addKeys = new Set(adds.map((a) => `${a.class}\u0000${a.row.split("\t").slice(0, 2).join("\t")}`));
  for (const d of drops) {
    d.pairedAddition = addKeys.has(`${d.class}\u0000${d.row.split("\t").slice(0, 2).join("\t")}`);
  }

  const countDrops = [];
  for (const [file, b] of Object.entries(before.perFile ?? {})) {
    const a = now.perFile[file];
    if (!a) {
      countDrops.push({ file, counter: "*file*", before: "present", after: "MISSING" });
      continue;
    }
    for (const c of Object.keys(b)) {
      if (a[c] < b[c]) countDrops.push({ file, counter: c, before: b[c], after: a[c] });
    }
  }
  return { drops, adds, countDrops };
}

/* ── main ─────────────────────────────────────────────────────────────────── */
const now = inventory();

if (flag("--emit")) {
  const dest = val("--emit");
  fs.writeFileSync(dest, JSON.stringify(
    { generatedAt: new Date().toISOString(), root: ROOT, scopes: SCOPES, ...now }, null, 1) + "\n");
  console.log(`restyle-drop-detector: wrote ${dest}`);
  console.log(JSON.stringify(now.totals));
  process.exit(0);
}

const comparePath = flag("--compare") ? val("--compare") : (flag("--verify") ? BASELINE : null);
if (!comparePath) {
  console.log("restyle-drop-detector totals: " + JSON.stringify(now.totals));
  console.log("no --verify / --compare / --emit given; nothing asserted.");
  process.exit(0);
}
if (!fs.existsSync(comparePath)) {
  console.error(`restyle-drop-detector: FATAL — baseline not found: ${comparePath}`);
  console.error("  create it with:  node scripts/restyle-drop-detector/detect.mjs --emit scripts/restyle-drop-detector/baseline.json");
  process.exit(2);
}
let before;
try {
  before = JSON.parse(fs.readFileSync(comparePath, "utf8"));
} catch (e) {
  console.error(`restyle-drop-detector: FATAL — unreadable baseline ${comparePath}: ${e.message}`);
  process.exit(2);
}

const { drops, adds, countDrops } = compare(before, now);

for (const d of drops) {
  console.log(`DROPPED  ${d.class}  ${d.row}${d.pairedAddition ? "   [paired ADDED in same file+tag — CHANGED, review]" : ""}`);
}
for (const c of countDrops) {
  console.log(`COUNT-FELL  ${c.file}  ${c.counter}: ${c.before} -> ${c.after}`);
}
if (flag("--show-additions")) for (const a of adds) console.log(`ADDED    ${a.class}  ${a.row}`);

const bare = drops.filter((d) => !d.pairedAddition).length;
console.log("");
console.log(`restyle-drop-detector: ${drops.length} disappearance(s) (${bare} bare, ${drops.length - bare} paired), ` +
            `${countDrops.length} per-file count decrease(s), ${adds.length} addition(s), ` +
            `${now.totals.suppressions} suppression(s), ${now.totals.deadControls} dead control(s).`);
console.log(`  allowlisted with authority in source: ${now.totals.suppressionsAllowlisted} suppression(s), ` +
            `${now.totals.deadControlsAllowlisted} dead control(s)`);
console.log(`  baseline: ${path.relative(ROOT, comparePath)}  ·  files scanned: ${now.totals.filesScanned}` +
            `  ·  totals: elements=${now.totals.elements} interactiveAll=${now.totals.interactiveAll} ` +
            `interactiveAncestors=${now.totals.interactiveAncestors} tabPanels=${now.totals.tabPanels} tabTriggers=${now.totals.tabTriggers}`);

const unreachable = now.inventory.tabPanelReach.filter((r) => r.endsWith("reachable=NO"));
const unreachableBefore = (before.inventory?.tabPanelReach ?? []).filter((r) => r.endsWith("reachable=NO"));
if (unreachable.length > unreachableBefore.length) {
  console.log(`TAB-PANEL UNREACHABLE: ${unreachableBefore.length} -> ${unreachable.length}`);
}

/* ══ WAVE 102 · the fourth and fifth failure signatures ══════════════════════ */
const newSuppressions = now.suppressions.filter((s) => !s.allowlisted);
const newDeadControls = now.deadControls.filter((d) => !d.allowlisted);
for (const s of newSuppressions) {
  console.log(`SUPPRESSED  ${s.rel}:${s.line}  ${s.reason}`);
  console.log(`            ${s.excerpt}`);
  console.log(`            treated as a REMOVAL — to a user it is one. allowlist key: ${s.key.replace(/\t/g, " | ")}`);
}
for (const d of newDeadControls) {
  console.log(`DEAD-CONTROL  ${d.rel}:${d.line}  <${d.tag}> ${d.id}  — ${d.reason}`);
}

if (flag("--json")) {
  fs.writeFileSync(val("--json"), JSON.stringify(
    { drops, countDrops, additions: adds, totals: now.totals,
      unreachableBefore: unreachableBefore.length, unreachableNow: unreachable.length,
      suppressions: now.suppressions, deadControls: now.deadControls }, null, 1) + "\n");
}

/* ── FAILURE POLICY · REVISED 2026-08-21 by the lead developer (ruling R82) ────
   PREVIOUSLY: `drops.length > 0` failed the gate, so ANY disappearance failed —
   including a PAIRED one, where the same file and the same tag still hold an
   element and only the expression's source-text digest changed.

   That is too strict to survive, and being too strict is how a gate dies.
   `exprChild` hashes SOURCE TEXT, so a legitimate content fix trips it BY
   CONSTRUCTION: replacing `{r.instrument}` with `{instrumentLabel(r.instrument)}`
   — which is the fix for a raw enum leaking to an investor — reads as a
   disappearance plus an addition. Under the old policy EVERY content or copy fix
   in the client ended in a re-baseline, and a gate that is re-baselined every
   wave stops being evidence of anything.

   WHAT STILL FAILS — the signatures of an actual loss:
     · BARE disappearances    — content gone with nothing put back in its place.
     · per-file COUNT DECREASES — this is the one that catches the case this
       detector was BUILT for: a money figure deleted while its `data-testid`
       stays, which the older guard, the reachability check and the copy fence
       all pass.
     · a tab panel becoming UNREACHABLE.
   WHAT NOW REPORTS WITHOUT FAILING:
     · PAIRED disappearances — printed, counted, and still reviewable in the
       `--json` report. Not silent; just not a build stop.

   Both poles were re-proved after this change (`npm run drop:restyle:poles`).

   ══ AMENDED 2026-08-21 BY WAVE 102, closing Reviewer C's C-1 ════════════════
   The three signatures above are ALL SIGNATURES OF DELETION. A change that keeps
   every node and stops it rendering produced none of them, and Reviewer C used
   that seven times — once removing every money figure on the investor dashboard
   with a single added token and exit 0. TWO MORE SIGNATURES NOW FAIL:

     · A SUPPRESSION — rendered content that is statically provably dead. It is
       reported as `SUPPRESSED`, and separately its subtree is not inventoried,
       so it ALSO shows up as the bare drops and count decreases a deletion
       shows up as. Both are deliberate: the report names the cause, and the
       drops prove the consequence.
     · A DEAD CONTROL — an interactive control with no reachable handler.

   Neither may be silenced by the paired-addition rule, because neither is a
   drop-with-a-pair: a suppression removes rows and adds none, and a dead control
   is reported from the current tree rather than by comparison. R82's paired
   downgrade is UNCHANGED and still applies only to content-digest drops.

   THE POLE PROOF WAS ALSO WIDENED. Its five planted mutations were all
   deletions, which is precisely why it certified a gate with this hole in it —
   "the harness asserted the axis the policy narrowed, not the axis where the
   hole was." It now plants suppression mutations too.
   ──────────────────────────────────────────────────────────────────────────── */
const bareDrops = drops.filter((d) => !d.pairedAddition);
const failed = bareDrops.length > 0 || countDrops.length > 0 ||
               unreachable.length > unreachableBefore.length ||
               newSuppressions.length > 0 || newDeadControls.length > 0;
if (!failed && drops.length > 0) {
  console.log(`NOTE — ${drops.length} paired change(s) reported above: same file and tag, expression text changed. ` +
              `Not a removal; not a build stop. Review the list if a copy or content fix was not intended.`);
}
console.log(failed
  ? "FAIL — a restyle removed, suppressed or deadened rendered content, a control, or a whole file."
  : "OK — nothing was removed and nothing was suppressed.");
process.exit(failed ? 1 : 0);
