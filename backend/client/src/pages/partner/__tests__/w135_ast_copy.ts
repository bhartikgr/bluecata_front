/**
 * WAVE 135 — THE COMMENT STRIPPER, REBUILT ON THE COMPILER'S OWN PARSER.
 *
 * WHY THIS EXISTS RATHER THAN REUSING `w126_live_code.ts`.
 * Wave 126's `liveCode()` is a hand-written character scanner. It enters
 * "inside a string literal" state on any `'`, including an apostrophe in
 * ordinary JSX prose — `the fund's default terms`. From that apostrophe onward
 * it believes it is inside a string, so it STOPS STRIPPING COMMENTS for the
 * remainder of the file.
 *
 * REPRODUCED, not asserted: `client/src/components/partner/SpvSideLetterPanel.tsx`
 * contains `the fund's default terms` at :120 and a `{/* … *\u002f}` comment
 * further down. `liveCode()` leaves that later comment in its output, and a
 * scan built on it duly reports comment prose as live rendered copy. That is
 * the exact comment trap this wave was told to defend against, manufactured BY
 * the instrument built to defend against it. The desync is asserted as a fact
 * in `w135_partner_copy_and_seats.test.ts` §0 so that the claim is checkable
 * and so wave 134 — which owns wave 126's tests — inherits a proof rather than
 * a rumour.
 *
 * WHAT THIS DOES INSTEAD. `ts.createSourceFile` with a TSX script kind parses
 * the file properly. Comments are trivia, not AST nodes, so:
 *   · `humanStrings()` collects only nodes a human can read — JSX text, string
 *     literals in non-machine positions, and the literal chunks of template
 *     expressions. A comment cannot be collected because it is not a node.
 *   · `liveCode135()` blanks every comment range the scanner reports, keeping
 *     byte offsets and line numbers stable, so a regex over the result is a
 *     regex over live code and line numbers still line up with the editor.
 *
 * This is a plain `.ts` module, not a `.test.ts` one, on purpose: the runner
 * collects only `*.test.ts`/`*.test.tsx` (vitest.config.ts:55-62), so importing
 * it from two test files cannot double-execute a suite. That is the same
 * mistake, and the same fix, that wave 126 documented for its own helper.
 */
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const ROOT = process.cwd();
export const PARTNER_DIRS = [
  "client/src/pages/partner",
  "client/src/components/partner",
];

/** Attributes and object keys whose value never reaches a human eye. */
const MACHINE_PROPS = new Set([
  "data-testid", "testid", "className", "class", "key", "id", "htmlFor", "href", "to",
  "type", "name", "value", "aria-controls", "aria-describedby", "aria-labelledby",
  "code", "variant", "size", "locale", "currency", "method", "path", "url", "style",
  "queryKey", "data-error-code", "data-esign-failure-reference", "autoComplete", "inputMode",
]);

export type CopyHit = {
  file: string;
  line: number;
  kind: "jsxtext" | "literal" | "template";
  text: string;
  prop?: string;
};

export function walkPartner(dir: string): string[] {
  const abs = join(ROOT, dir);
  const out: string[] = [];
  for (const e of readdirSync(abs)) {
    const p = join(abs, e);
    if (statSync(p).isDirectory()) {
      if (e === "__tests__") continue;
      out.push(...walkPartner(join(dir, e)));
    } else if (/\.(ts|tsx)$/.test(e)) out.push(join(dir, e));
  }
  return out;
}

/**
 * Every comment blanked, every other byte kept in place.
 *
 * Offsets are preserved (a comment becomes spaces, and its newlines are kept)
 * so a match position in the output is a real position in the file.
 */
export function liveCode135(src: string): string {
  const out = src.split("");
  const blank = (start: number, end: number) => {
    for (let i = start; i < end && i < out.length; i++) {
      if (out[i] !== "\n" && out[i] !== "\r") out[i] = " ";
    }
  };
  const sf = ts.createSourceFile("scan.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const seen = new Set<string>();
  const take = (ranges: ts.CommentRange[] | undefined) => {
    for (const r of ranges ?? []) {
      const k = `${r.pos}:${r.end}`;
      if (seen.has(k)) continue;
      seen.add(k);
      blank(r.pos, r.end);
    }
  };
  /* Trivia hangs off nodes, so every node is visited. Two cases need more than
     `forEachChild`:

       · A `{/* … *\u002f}` JSX comment parses as a JsxExpression with NO
         expression. Its comment is trivia inside that node's own span, which
         `getLeadingCommentRanges` on the node's full-start does not reach, so the
         span between its braces is blanked directly.

       · A comment that is the ONLY content of a block — `catch { /* … *\u002f }`
         — is leading trivia of the closing `}` TOKEN, and a token is not an AST
         node that `forEachChild` yields. Found on
         `client/src/pages/partner/PartnerAddPortfolioCompany.tsx:81`. So the walk
         descends through `getChildren()`, which DOES include punctuation tokens.
         Slower, and correct. */
  const visit = (node: ts.Node) => {
    take(ts.getLeadingCommentRanges(src, node.getFullStart()));
    take(ts.getTrailingCommentRanges(src, node.getEnd()));
    if (ts.isJsxExpression(node) && node.expression === undefined) {
      blank(node.getStart(sf) + 1, node.getEnd() - 1);
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  take(ts.getLeadingCommentRanges(src, 0));
  /* End-of-file trailing comments hang off the EndOfFileToken's leading trivia,
     which the walk above reaches, but a file whose last token is a comment is
     covered explicitly. */
  take(ts.getLeadingCommentRanges(src, sf.endOfFileToken.getFullStart()));
  return out.join("");
}

/** Every string a human can read, from the AST. Comments cannot appear here. */
export function humanStrings(file: string, src: string): CopyHit[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: CopyHit[] = [];
  const push = (node: ts.Node, kind: CopyHit["kind"], text: string, prop?: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t === "" || !/[A-Za-z]{2}/.test(t)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    out.push({ file, line, kind, text: t, prop });
  };

  function propNameOf(node: ts.Node): string | undefined {
    let p: ts.Node | undefined = node.parent;
    if (p && ts.isJsxExpression(p)) p = p.parent;
    if (p && ts.isJsxAttribute(p)) return p.name.getText(sf);
    if (p && ts.isPropertyAssignment(p)) return p.name.getText(sf);
    return undefined;
  }
  function isMachine(node: ts.Node, prop?: string): boolean {
    if (prop && MACHINE_PROPS.has(prop)) return true;
    const p = node.parent;
    if (p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p))) return true;
    const raw = (node as ts.StringLiteral).text ?? "";
    if (/^[@./#]/.test(raw) || /^https?:/.test(raw)) return true;
    if (/^\/api\//.test(raw)) return true;
    return false;
  }

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) push(node, "jsxtext", node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const prop = propNameOf(node);
      if (!isMachine(node, prop)) push(node, "literal", node.text, prop);
    } else if (ts.isTemplateExpression(node)) {
      const prop = propNameOf(node);
      const text = [
        node.head.text,
        ...node.templateSpans.map((s) => "\u2039value\u203a" + s.literal.text),
      ].join("");
      if (!isMachine(node, prop)) push(node, "template", text, prop);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * THE CLASSIFIER — the same rules the scratch instrument
 * (`w135_scratch/scan_partner_copy.mts`) was driven with, moved here so the
 * claim "no live partner string describes our storage model, our roadmap or our
 * internal state" is a TEST rather than a one-off script run.
 */
export const COPY_RULES: Array<[string, RegExp]> = [
  ["storage-model", /\b(minor units|smallest unit|in (USD )?cents|billionths|stored as|integer (representation|billionths|minor units)|floating[- ]point|round trip|bigint|JSON|payload|db row|database|schema|column|zod|query key|staleTime)\b/i],
  ["roadmap", /\b(coming soon|not yet available|not yet built|not implemented|temporarily unavailable|for now|in a future release|will be (added|available|enabled|implemented)|ships\b|work in progress|phase\s?\d|backlog|roadmap|no screen|existed for some time)/i],
  ["internal-state", /\b(cleanup required|needs cleanup|duplicate historical|has not been supplied|not been configured by|seeded? data|demo (data|partner)|test data|migration|backfill|not installed on this|tables are not installed|fail[- ]closed|server[- ]side|preview host|hidden in production)/i],
  ["dev-diagnostic", /\b(read successfully|stack trace|console|stub\b|mock\b|fixture|exit code|handler|serializ|so an operator can trace)/i],
  ["machine-key", /\b[A-Z][A-Z0-9]{2,}(_[A-Z0-9]+){1,}\b/],
];

export function classifyCopy(text: string): string[] {
  return COPY_RULES.filter(([, re]) => re.test(text)).map(([t]) => t);
}

/** Read + AST-strip every partner source file once, for the whole suite. */
export function loadPartnerSources(): {
  files: string[];
  live: Map<string, string>;
  raw: Map<string, string>;
} {
  const files = PARTNER_DIRS.flatMap(walkPartner);
  const raw = new Map<string, string>();
  const live = new Map<string, string>();
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8");
    raw.set(f, src);
    live.set(f, liveCode135(src));
  }
  return { files, live, raw };
}
