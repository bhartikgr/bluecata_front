/**
 * scripts/lint/fundMetricsWinnerFence.ts
 *
 * WAVE 16 — XT-C4 (spec/ENGINE_REGISTRY.md C-4; OPEN QUESTION OPN-018).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT C-4 DECIDED AND WHAT WAS STILL MISSING
 * ─────────────────────────────────────────────────────────────────────────────
 * `spec/ENGINE_REGISTRY.md:303` declares **`packages/math-fns` CANONICAL for all
 * fund math** and `server/portfolioAnalyticsStore.ts` the DEFECTIVE RIVAL.
 * OPN-018 records the outstanding half verbatim: *"no mechanism prevents a new
 * caller using a losing implementation."*
 *
 * VERIFIED AT SOURCE BEFORE WRITING THIS FENCE (the citation was partly stale,
 * which is exactly what this project has been bitten by twelve times):
 *   • The registry says `math-fns` has **ZERO consumers**. That is NO LONGER
 *     TRUE. Wave 9 and later wired it: `server/wave9ReportingStore.ts:29`
 *     (`computeFundMetrics`), `server/lib/reportingEngineRoutes.ts:98`,
 *     `server/lib/ilpaCashflowLedger.ts:61`, `server/lib/wave15CarryAccrual.ts:41`,
 *     `server/lib/wave15FootnoteBinding.ts:50`. The winner is live.
 *   • The registry lists five fabrications in the rival. All five were DELETED
 *     at the producer in Wave 9 (RP-1…RP-5) — see that file's own header.
 * So the enforcement gap is NOT "swap the implementation". It is: **nothing
 * stops the deleted arithmetic from being written again, or a second fund-metric
 * implementation from appearing next to the canonical one.** A metric computed
 * twice in two places will disagree, and an investor will be shown the wrong one
 * with nothing failing. That is what this fence closes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE RULES
 * ─────────────────────────────────────────────────────────────────────────────
 * R1  NO-RESURRECTION. The five deleted fabrications must not reappear anywhere
 *     in `server/`, `client/src/`, `shared/` or `packages/`. Each pattern is
 *     matched with the specific defect it was, so a failure message tells the
 *     next builder WHY, not just WHERE.
 *
 * R2  NO NEW IMPORTER OF THE LOSER'S METRIC SURFACE. `server/portfolioAnalyticsStore.ts`
 *     may be reached only for its route registration and its payload TYPES. A
 *     new module importing its metric machinery is a new caller of the losing
 *     implementation — the literal wording of OPN-018.
 *
 * R3  NO SECOND IMPLEMENTATION. A fund metric whose value depends on DATED CASH
 *     FLOWS (IRR/XIRR/net- and gross-IRR, TVPI, DPI, RVPI, PIC multiple) may be
 *     **derived** only inside the canonical engine or its declared server
 *     bindings. Everywhere else those names may be read, stored, formatted and
 *     rendered — but not derived.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SCOPE DECISIONS, STATED SO THEY CAN BE ARGUED WITH
 * ─────────────────────────────────────────────────────────────────────────────
 * (a) R3 fences DERIVATION operators only — `*`, `/`, `**`, `Math.pow/exp/log`.
 *     A `+`/`-` between two figures of the same metric is a DELTA, not a rival
 *     derivation: `server/portfolioAnalyticsStore.ts:335-336` subtracts a
 *     canonical `TVPI`/`net_IRR` from the snapshot twelve months earlier, which
 *     is a real measurement of change and must not be forbidden.
 * (b) `moic` is NOT in R3's fenced set, while TVPI/DPI/RVPI/IRR are. MOIC on
 *     this platform is defined as total value over cost
 *     (`server/portfolioAnalyticsStore.ts:305` inherits it from TVPI outright):
 *     a bare quotient of two figures the producer already supplies, which cannot
 *     disagree with the engine unless its INPUTS are wrong. The way its inputs
 *     go wrong is RP-2 — value pinned to cost — and that is caught by R1's
 *     `RP-2-value-pinned-to-cost` structural rule at the producer. Fencing the
 *     quotient itself would only force display code such as
 *     `client/src/pages/investor/Dashboard.tsx:600` (which already renders
 *     "unmarked" instead of a ratio when any holding is unmarked) to launder the
 *     same division through a helper. TVPI/DPI/RVPI/IRR are different in kind:
 *     they require contribution/distribution CLASSIFICATION and, for IRR, a
 *     dated solve — that is where two implementations really do disagree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE ALLOWLISTS ARE SHAPED THIS WAY
 * ─────────────────────────────────────────────────────────────────────────────
 * `CANONICAL_COMPUTERS` is a WINNER list, not an exemption list: every entry is
 * a file that computes metrics THROUGH `@capavate/math-fns`, and the fence
 * asserts that each one really does import it. An entry that stopped importing
 * the canonical engine would be a losing implementation hiding inside the
 * winner's allowlist, so that case is reported as `canonical_not_canonical`
 * rather than trusted.
 *
 * There is NO per-violation suppression comment and no `// eslint-disable`
 * equivalent. Reversing C-4 means editing this file, visibly, with a reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ANTI-VACUITY (a check that passes may be checking nothing — six instances)
 * ─────────────────────────────────────────────────────────────────────────────
 *   • Every declared path is reported when it is ABSENT (`declared_path_missing`).
 *     A fence validating files that never existed is a fence that checks nothing.
 *   • The scan is AST-based, so COMMENTS are free — a comment explaining a
 *     deleted fabrication (the rival file is full of them, deliberately) must not
 *     trip R1, or the honest record of what was removed would have to be erased
 *     to make CI green.
 *   • `filesScanned` is returned so a caller can assert the fence actually
 *     opened a non-trivial number of files.
 *
 * Run: npm run lint:fund-metrics-fence
 * Proven at BOTH POLES by server/__tests__/wave16_fund_metrics_fence.test.ts
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** The canonical package, per ENGINE_REGISTRY C-4. */
export const CANONICAL_PACKAGE = "@capavate/math-fns";

/** The rival module named by C-4. */
export const LOSING_MODULE = "server/portfolioAnalyticsStore.ts";

/**
 * The ONLY names `portfolioAnalyticsStore` may be imported for:
 *   - `registerPortfolioAnalyticsRoutes` — route mounting, not math;
 *   - `PortfolioAnalytics` / `ReportedMetric` / `PortfolioSeries` / `RealPosition`
 *     — payload SHAPES. A type carries no arithmetic, and the dashboard needs
 *     the shape of the response it renders.
 * Anything else pulls the rival's derivation logic into a new module.
 */
export const LOSER_PERMITTED_IMPORTS: readonly string[] = Object.freeze([
  "registerPortfolioAnalyticsRoutes",
  "PortfolioAnalytics",
  "PortfolioSeries",
  "ReportedMetric",
  "RealPosition",
]);

/**
 * Files that may COMPUTE fund metrics. Each must import the canonical package —
 * asserted, not assumed.
 */
export const CANONICAL_COMPUTERS: readonly string[] = Object.freeze([
  "server/wave9ReportingStore.ts",
  "server/lib/reportingEngineRoutes.ts",
  "server/lib/ilpaCashflowLedger.ts",
  "server/lib/wave15CarryAccrual.ts",
  "server/lib/wave15FootnoteBinding.ts",
]);

/** Trees scanned by R1 and R3. */
export const SCAN_ROOTS: readonly string[] = Object.freeze([
  "server",
  "client/src",
  "shared",
  "packages/math-fns/src",
]);

/** Directory names never scanned (vendored / generated / fixtures). */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".vite", "__tests__"]);

/* ── R1: the five deleted fabrications ──────────────────────────────────── */

export interface ResurrectionRule {
  id: string;
  /** Matched against CODE text only (AST nodes), never comments. */
  pattern: RegExp;
  /** What the defect actually was, so the failure explains itself. */
  why: string;
}

export const RESURRECTION_RULES: readonly ResurrectionRule[] = Object.freeze([
  {
    id: "RP-3-positionIrr",
    pattern: /^positionIrr$/,
    why: "a hold-period CAGR mislabelled IRR, with the current year hardcoded. IRR is XIRR from the canonical engine, and is SUPPRESSED with a status when there are no dated cash flows.",
  },
  {
    id: "RP-4-sparkline",
    pattern: /^spark$/,
    why: "twelve monthly points generated from a sin/cos walk and drawn as if they were history. Series come from real snapshots and render only at >= 3 points.",
  },
]);

/**
 * RP-5's fabrications were LITERALS, and a bare literal carries no meaning on
 * its own. Matching `1.42` anywhere flags an FMV per share
 * (`server/mockData.ts:268`), a price per share (`:435`), an ownership percent
 * (`:670`) and a product-market-fit score (`server/maIntelligenceStore.ts:113`)
 * — four false alarms and zero defects, which is how a lint gets switched off.
 * So a literal only trips the fence when BOTH hold:
 *   1. the IMMEDIATE assignment target is named like a benchmark / cohort figure
 *      / YoY delta / multiple — the target's own name, never the enclosing
 *      declaration's full text (testing full text flagged `Glossary.tsx:38`,
 *      `RoundNew.tsx:44` and `mockData.ts:55`, where an unrelated `1.42` merely
 *      shared a large object literal with the word "multiple"); and
 *   2. the value is a NUMERIC SHAPE — a number, a signed number, or an
 *      array/object of numbers. A benchmark read from a row is a call or a
 *      property access, never a literal, so this cannot flag real data.
 */
export const LITERAL_CONTEXT = /cohort|benchmark|yoy|year[_-]?over[_-]?year|percentile|\bp25\b|\bp50\b|\bp75\b|tvpi|moic|dpi|rvpi|\birr\b|multiple/i;

export const LITERAL_RULES: readonly ResurrectionRule[] = Object.freeze([
  {
    id: "RP-5-cohort-literal",
    pattern: /(?<![\d.])(?:1\.18|1\.42|1\.86)(?![\d.])/,
    why: "hardcoded cohort benchmark multiples (1.18 / 1.42 / 1.86). Benchmarks are computed from platform snapshots at or above the configured minimum cohort size (ruling Q10, M-4), or they are absent with a reason.",
  },
  {
    id: "RP-5-yoy-literal",
    pattern: /(?<![\d.])(?:0\.78|0\.65|0\.72)(?![\d.])/,
    why: "fabricated year-on-year multipliers (*0.78 / *0.65 / *0.72). YoY is a real 12-month snapshot delta or it is absent.",
  },
]);

/**
 * R1's two STRUCTURAL fabrications, which are relationships rather than names
 * and so are matched on the assignment expression text:
 *   - realised proceeds derived as a percentage of invested capital (RP-1);
 *   - current value pinned to cost, which forces MOIC to exactly 1.0 (RP-2).
 */
export const STRUCTURAL_RULES: readonly ResurrectionRule[] = Object.freeze([
  {
    id: "RP-1-synthetic-realisation",
    pattern: /\b(?:realis|realiz)ed?\w*\s*[:=]\s*[^;,\n]*\binvested\b[^;,\n]*[*]/i,
    why: "realised proceeds invented as a fraction of invested capital. DPI must be 0.00x when no distribution row exists — that is TRUE, a fabricated DPI is not.",
  },
  {
    id: "RP-2-value-pinned-to-cost",
    pattern: /\bcurrent(?:Value|Mark)\s*[:=]\s*(?:safe)?[Ii]nvested\b/,
    why: "every holding pinned to cost, forcing MOIC to exactly 1.0 forever and presenting an UNMARKED holding as if it had been valued.",
  },
]);

/* ── R3: metric names whose DERIVATION is fenced ─────────────────────────── */

/**
 * A metric is considered COMPUTED when one of these names is assigned the
 * result of ARITHMETIC (`*`, `/`, `-`, `+`, `**`) or of `Math.pow`. Reading,
 * copying, storing, comparing and formatting are all untouched, which is why
 * the many DB read/render sites do not trip this.
 */
export const FENCED_METRIC_NAMES: readonly string[] = Object.freeze([
  "irr",
  "xirr",
  "netIrr",
  "grossIrr",
  "net_irr",
  "gross_irr",
  "tvpi",
  "dpi",
  "rvpi",
  "picMultiple",
  "pic_multiple",
]);

export interface FenceViolation {
  rule: "R1" | "R2" | "R3" | "meta";
  id: string;
  file: string;
  line: number;
  detail: string;
}

export interface FenceResult {
  ok: boolean;
  filesScanned: number;
  violations: FenceViolation[];
}

function isSourceFile(name: string): boolean {
  return /\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\.tsx?$/.test(name);
}

function walk(absDir: string, out: string[], root: string): void {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(absDir, entry.name), out, root);
    } else if (isSourceFile(entry.name)) {
      out.push(path.relative(root, path.join(absDir, entry.name)));
    }
  }
}

export function collectScanFiles(root: string): string[] {
  const out: string[] = [];
  for (const rel of SCAN_ROOTS) walk(path.join(root, rel), out, root);
  return out.sort();
}

function parse(rel: string, text: string): ts.SourceFile {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * True when `expr` DERIVES a value rather than reading one or measuring a change.
 * See scope decision (a) in the header: `+`/`-` are excluded on purpose.
 */
function isArithmetic(expr: ts.Expression): boolean {
  const ARITH = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.AsteriskAsteriskToken,
  ]);
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isBinaryExpression(n) && ARITH.has(n.operatorToken.kind)) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === "Math" &&
      /^(pow|exp|log)$/.test(n.expression.name.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(expr);
  return found;
}

/**
 * A value made only of number literals: `1.42`, `-1.42`, `[1.18, 1.42, 1.86]`,
 * `{ p25: 1.18, p50: 1.42 }`. Anything containing a call or property access is a
 * value READ from somewhere, which is the behaviour C-4 wants.
 */
function isNumericShape(expr: ts.Expression): boolean {
  if (ts.isNumericLiteral(expr)) return true;
  if (ts.isPrefixUnaryExpression(expr)) return isNumericShape(expr.operand as ts.Expression);
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.every((e) => isNumericShape(e));
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.every(
      (p) => ts.isPropertyAssignment(p) && isNumericShape(p.initializer),
    );
  }
  return false;
}

function nameOfTarget(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isStringLiteral(node)) return node.text;
  return null;
}

/** R3 over one parsed file. */
function scanSecondImplementation(rel: string, sf: ts.SourceFile): FenceViolation[] {
  const fenced = new Set(FENCED_METRIC_NAMES.map((n) => n.toLowerCase()));
  const out: FenceViolation[] = [];
  const check = (targetNode: ts.Node, value: ts.Expression | undefined): void => {
    if (!value) return;
    const name = nameOfTarget(targetNode);
    if (!name || !fenced.has(name.toLowerCase())) return;
    if (!isArithmetic(value)) return;
    out.push({
      rule: "R3",
      id: `second-implementation:${name}`,
      file: rel,
      line: lineOf(sf, targetNode),
      detail:
        `\`${name}\` is DERIVED here by arithmetic. Fund metrics may only be computed by ` +
        `${CANONICAL_PACKAGE} (ENGINE_REGISTRY C-4). Two implementations of one metric will ` +
        `disagree and an investor will be shown whichever one the surface happened to call.`,
    });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.name) check(n.name, n.initializer);
    else if (ts.isPropertyAssignment(n)) check(n.name, n.initializer);
    else if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      check(n.left, n.right);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/** R1 over one parsed file — AST nodes only, so comments are free. */
function scanResurrection(rel: string, sf: ts.SourceFile): FenceViolation[] {
  const out: FenceViolation[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) || ts.isNumericLiteral(n)) {
      const text = ts.isIdentifier(n) ? n.text : n.text;
      for (const rule of RESURRECTION_RULES) {
        if (rule.pattern.test(text)) {
          out.push({
            rule: "R1",
            id: rule.id,
            file: rel,
            line: lineOf(sf, n),
            detail: `deleted fabrication reappeared (\`${text}\`): ${rule.why}`,
          });
        }
      }
    }
    // Structural and literal rules read the assignment's own source text (code,
    // not comments — `getText` on an AST node excludes leading trivia only when
    // the node starts after it, which is why `getStart(sf)` is used everywhere).
    if (
      ts.isPropertyAssignment(n) ||
      ts.isVariableDeclaration(n) ||
      (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken)
    ) {
      const text = n.getText(sf);
      for (const rule of STRUCTURAL_RULES) {
        if (rule.pattern.test(text)) {
          out.push({
            rule: "R1",
            id: rule.id,
            file: rel,
            line: lineOf(sf, n),
            detail: `deleted fabrication reappeared: ${rule.why}`,
          });
        }
      }
      const target = ts.isPropertyAssignment(n)
        ? nameOfTarget(n.name)
        : ts.isVariableDeclaration(n)
          ? nameOfTarget(n.name)
          : nameOfTarget((n as ts.BinaryExpression).left);
      const value = ts.isPropertyAssignment(n)
        ? n.initializer
        : ts.isVariableDeclaration(n)
          ? n.initializer
          : (n as ts.BinaryExpression).right;
      if (target && value && LITERAL_CONTEXT.test(target) && isNumericShape(value)) {
        const valueText = value.getText(sf);
        for (const rule of LITERAL_RULES) {
          if (rule.pattern.test(valueText)) {
            out.push({
              rule: "R1",
              id: rule.id,
              file: rel,
              line: lineOf(sf, n),
              detail: `deleted fabrication reappeared: ${rule.why}`,
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/** R2 — who imports the loser, and for what. */
function scanLoserImports(rel: string, sf: ts.SourceFile): FenceViolation[] {
  const out: FenceViolation[] = [];
  const loserBase = path.basename(LOSING_MODULE).replace(/\.ts$/, "");
  const permitted = new Set(LOSER_PERMITTED_IMPORTS);
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      if (spec.includes(loserBase)) {
        const clause = n.importClause;
        // A default or namespace import gives access to EVERYTHING, including
        // the derivation helpers. That is a new caller of the losing module.
        if (clause?.name || (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))) {
          out.push({
            rule: "R2",
            id: "loser-wildcard-import",
            file: rel,
            line: lineOf(sf, n),
            detail: `default/namespace import of ${LOSING_MODULE} exposes the rival's derivation logic. Import only: ${LOSER_PERMITTED_IMPORTS.join(", ")}.`,
          });
        }
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (!permitted.has(imported)) {
              out.push({
                rule: "R2",
                id: `loser-import:${imported}`,
                file: rel,
                line: lineOf(sf, el),
                detail: `\`${imported}\` imported from the LOSING fund-metrics implementation (${LOSING_MODULE}). ENGINE_REGISTRY C-4 makes ${CANONICAL_PACKAGE} canonical; permitted imports are ${LOSER_PERMITTED_IMPORTS.join(", ")}.`,
              });
            }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/**
 * Run the whole fence against `root`.
 *
 * `root` is a parameter, not a constant, so the negative pole can be proven by
 * pointing this exact function at a fixture tree. A fence that can only be run
 * against the real repo cannot be shown to fail.
 */
export function runFundMetricsFence(root: string = REPO_ROOT): FenceResult {
  const violations: FenceViolation[] = [];

  /* meta-1: a declared canonical computer that does not exist, or that no longer
   * imports the canonical package. Either way the allowlist is lying. */
  for (const rel of CANONICAL_COMPUTERS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      violations.push({
        rule: "meta",
        id: "declared_path_missing",
        file: rel,
        line: 0,
        detail: `declared CANONICAL_COMPUTER does not exist — this entry has been checking nothing.`,
      });
      continue;
    }
    if (!fs.readFileSync(abs, "utf8").includes(CANONICAL_PACKAGE)) {
      violations.push({
        rule: "meta",
        id: "canonical_not_canonical",
        file: rel,
        line: 0,
        detail: `allowed to compute fund metrics but does NOT import ${CANONICAL_PACKAGE} — a losing implementation hiding inside the winner's allowlist.`,
      });
    }
  }
  const loserAbs = path.join(root, LOSING_MODULE);
  if (!fs.existsSync(loserAbs)) {
    violations.push({
      rule: "meta",
      id: "declared_path_missing",
      file: LOSING_MODULE,
      line: 0,
      detail: `the module C-4 names as the losing implementation is absent; R2 has been checking nothing.`,
    });
  }

  const canonical = new Set(CANONICAL_COMPUTERS);
  const files = collectScanFiles(root);
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    const sf = parse(rel, text);
    violations.push(...scanResurrection(rel, sf));
    violations.push(...scanLoserImports(rel, sf));
    /* R3 exempts the canonical engine itself and its declared bindings — they
     * ARE the implementation. Every other file is fenced. */
    const insideCanonicalPackage = rel.startsWith("packages/math-fns/");
    if (!canonical.has(rel) && !insideCanonicalPackage) {
      violations.push(...scanSecondImplementation(rel, sf));
    }
  }

  return { ok: violations.length === 0, filesScanned: files.length, violations };
}

export function formatFence(result: FenceResult): string {
  return result.violations
    .map((v) => `  [${v.rule}/${v.id}] ${v.file}:${v.line} — ${v.detail}`)
    .join("\n");
}

/* ── CLI ────────────────────────────────────────────────────────────────── */
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).includes("fundMetricsWinnerFence");

if (invokedDirectly) {
  const result = runFundMetricsFence();
  if (result.ok) {
    console.log(
      `[fund-metrics-fence] OK — ${CANONICAL_PACKAGE} is the only fund-metrics implementation ` +
        `across ${result.filesScanned} source file(s). (ENGINE_REGISTRY C-4 / OPN-018)`,
    );
    process.exit(0);
  }
  console.error(
    `[fund-metrics-fence] FAIL — the C-4 fund-metrics winner is not being enforced.\n` +
      formatFence(result),
  );
  process.exit(1);
}
