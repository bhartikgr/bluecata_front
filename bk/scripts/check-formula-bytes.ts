#!/usr/bin/env tsx
/**
 * scripts/check-formula-bytes.ts — Phase A.2 (checker)
 *
 * Re-runs extraction against each sacred file and compares against the
 * immutable baseline in wave_h_audit/MATH_FORMULA_BASELINE.json.
 *
 * Outputs PASS/FAIL per file. Exits with code 0 if all pass, 1 if any fail.
 *
 * Usage:
 *   npx tsx scripts/check-formula-bytes.ts
 */

import * as ts from "typescript";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const BASELINE_PATH = path.resolve(process.cwd(), "wave_h_audit/MATH_FORMULA_BASELINE.json");

// ─── Replicated extractor (must match extract-formula-bytes.ts) ───────────────

function isFormulaNode(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (
      op === ts.SyntaxKind.PlusToken ||
      op === ts.SyntaxKind.MinusToken ||
      op === ts.SyntaxKind.AsteriskToken ||
      op === ts.SyntaxKind.SlashToken ||
      op === ts.SyntaxKind.PercentToken ||
      op === ts.SyntaxKind.AsteriskAsteriskToken ||
      op === ts.SyntaxKind.LessThanToken ||
      op === ts.SyntaxKind.LessThanEqualsToken ||
      op === ts.SyntaxKind.GreaterThanToken ||
      op === ts.SyntaxKind.GreaterThanEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.AmpersandToken ||
      op === ts.SyntaxKind.BarToken ||
      op === ts.SyntaxKind.CaretToken ||
      op === ts.SyntaxKind.LessThanLessThanToken ||
      op === ts.SyntaxKind.GreaterThanGreaterThanToken
    ) {
      return true;
    }
  }

  if (ts.isCallExpression(node)) {
    const expr = node.expression.getText();
    if (
      expr.startsWith("createHash") ||
      expr.startsWith("BigInt") ||
      expr.startsWith("Math.") ||
      expr === "parseInt" ||
      expr === "parseFloat" ||
      expr === "Number" ||
      expr.includes(".update") ||
      expr.includes(".digest") ||
      expr.includes(".slice") ||
      expr.includes("JSON.stringify") ||
      expr.includes("JSON.parse") ||
      expr.includes("toFixed") ||
      expr.includes("toLocaleString")
    ) {
      return true;
    }
  }

  if (ts.isConditionalExpression(node)) return true;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return true;

  return false;
}

function extractFormulaExpressions(sourceFile: ts.SourceFile): string[] {
  const expressions: string[] = [];

  function visit(node: ts.Node): void {
    if (isFormulaNode(node)) {
      const text = node.getText(sourceFile)
        .replace(/\s+/g, " ")
        .trim();
      expressions.push(text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return expressions;
}

function extractTemplateLiterals(sourceFile: ts.SourceFile): string[] {
  const templates: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.getText(sourceFile)
        .replace(/\s+/g, " ")
        .trim();
      templates.push(text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return templates;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`[check-formula-bytes] ERROR: baseline not found at ${BASELINE_PATH}`);
  console.error("[check-formula-bytes] Run scripts/extract-formula-bytes.ts first.");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8")) as {
  generated_at: string;
  files: Array<{
    file: string;
    sha256_file: string;
    formula_sha256: string;
    formula_count: number;
    template_count: number;
    formulas: string[];
    templates: string[];
  }>;
};

console.log(`[check-formula-bytes] Baseline generated at: ${baseline.generated_at}`);
console.log("[check-formula-bytes] Checking formula bytes for sacred files...\n");

const cwd = process.cwd();
let allPass = true;
const results: Array<{ file: string; status: "PASS" | "FAIL"; detail: string }> = [];

for (const baselineRecord of baseline.files) {
  const absPath = path.resolve(cwd, baselineRecord.file);

  if (!fs.existsSync(absPath)) {
    results.push({
      file: baselineRecord.file,
      status: "FAIL",
      detail: "FILE NOT FOUND",
    });
    allPass = false;
    continue;
  }

  const source = fs.readFileSync(absPath, "utf-8");
  const currentFileSha = createHash("sha256").update(source).digest("hex");

  const sourceFile = ts.createSourceFile(
    absPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const formulas = extractFormulaExpressions(sourceFile);
  const templates = extractTemplateLiterals(sourceFile);
  const canonicalStr = formulas.join("\n---\n") + "\n===TEMPLATES===\n" + templates.join("\n---\n");
  const currentFormulaSha = createHash("sha256").update(canonicalStr).digest("hex");

  if (currentFormulaSha === baselineRecord.formula_sha256) {
    results.push({
      file: baselineRecord.file,
      status: "PASS",
      detail: `formula_sha256=${currentFormulaSha.slice(0, 16)}…  file_sha_changed=${currentFileSha !== baselineRecord.sha256_file}`,
    });
  } else {
    allPass = false;

    // Find which formulas changed
    const baseSet = new Set(baselineRecord.formulas);
    const curSet = new Set(formulas);
    const added = formulas.filter((f) => !baseSet.has(f));
    const removed = baselineRecord.formulas.filter((f) => !curSet.has(f));

    results.push({
      file: baselineRecord.file,
      status: "FAIL",
      detail: [
        `formula_sha256 CHANGED: baseline=${baselineRecord.formula_sha256.slice(0, 16)}… current=${currentFormulaSha.slice(0, 16)}…`,
        added.length > 0 ? `  ADDED formulas (${added.length}):` : "",
        ...added.slice(0, 5).map((f) => `    + ${f.slice(0, 120)}`),
        removed.length > 0 ? `  REMOVED formulas (${removed.length}):` : "",
        ...removed.slice(0, 5).map((f) => `    - ${f.slice(0, 120)}`),
      ].filter(Boolean).join("\n"),
    });
  }
}

// Print results
const width = 60;
console.log("─".repeat(width));
for (const r of results) {
  const status = r.status === "PASS" ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`[${status}] ${r.file}`);
  if (r.detail) {
    for (const line of r.detail.split("\n")) {
      console.log(`       ${line}`);
    }
  }
}
console.log("─".repeat(width));

if (allPass) {
  console.log("\n\x1b[32m✓ ALL FORMULA BYTES UNCHANGED — sacred files audit PASS\x1b[0m");
  process.exit(0);
} else {
  console.error("\n\x1b[31m✗ FORMULA BYTES CHANGED — STOP: sacred math may have been modified\x1b[0m");
  process.exit(1);
}
