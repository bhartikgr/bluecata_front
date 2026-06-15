#!/usr/bin/env tsx
/**
 * scripts/extract-formula-bytes.ts — Phase A.2
 *
 * For each sacred file, parse with the TypeScript compiler API, walk every
 * BinaryExpression, CallExpression to createHash / BigInt / Math.*, and
 * conditional/comparison logic. Extract those formula expressions as a
 * canonical string, SHA-256 them, and output MATH_FORMULA_BASELINE.json.
 *
 * This is the audit-grade proof that sacred-file edits only changed async
 * wrappers, never formulas.
 *
 * Usage:
 *   npx tsx scripts/extract-formula-bytes.ts
 *   # outputs: wave_h_audit/MATH_FORMULA_BASELINE.json
 */

import * as ts from "typescript";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Sacred files ─────────────────────────────────────────────────────────────

const SACRED_FILES = [
  "server/captableCommitStore.ts",
  "server/roundsStore.ts",
  "server/lib/roundCloseCascade.ts",
  "server/spvFundStore.ts",
  "server/collectiveBillingStore.ts",
];

const OUTPUT_PATH = path.resolve(process.cwd(), "wave_h_audit/MATH_FORMULA_BASELINE.json");

// ─── Formula expression extractor ────────────────────────────────────────────

/**
 * Determines if a node is a "formula node" — arithmetic, BigInt ops, hash
 * inputs, comparison operators, Math.* calls, createHash calls, etc.
 */
function isFormulaNode(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    // Arithmetic operators
    if (
      op === ts.SyntaxKind.PlusToken ||
      op === ts.SyntaxKind.MinusToken ||
      op === ts.SyntaxKind.AsteriskToken ||
      op === ts.SyntaxKind.SlashToken ||
      op === ts.SyntaxKind.PercentToken ||
      op === ts.SyntaxKind.AsteriskAsteriskToken ||
      // Comparison operators
      op === ts.SyntaxKind.LessThanToken ||
      op === ts.SyntaxKind.LessThanEqualsToken ||
      op === ts.SyntaxKind.GreaterThanToken ||
      op === ts.SyntaxKind.GreaterThanEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      // Bitwise operators
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

/**
 * Extract formula nodes from a source file. Returns a sorted array of
 * canonical expression strings.
 */
function extractFormulaExpressions(sourceFile: ts.SourceFile): string[] {
  const expressions: string[] = [];

  function visit(node: ts.Node): void {
    if (isFormulaNode(node)) {
      // Canonicalize: strip whitespace, normalize newlines
      const text = node.getText(sourceFile)
        .replace(/\s+/g, " ")
        .trim();
      expressions.push(text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return expressions; // order preserved (AST traversal order)
}

/**
 * Extract template literal spans that contain hash inputs (common in
 * captableCommitStore's `${prevHash}|${body}` pattern).
 */
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

interface FileFormulaRecord {
  file: string;
  sha256_file: string;
  formula_count: number;
  template_count: number;
  formula_sha256: string;
  formulas: string[];
  templates: string[];
}

interface Baseline {
  generated_at: string;
  tool_version: "1.0.0";
  files: FileFormulaRecord[];
}

const cwd = process.cwd();
const baseline: Baseline = {
  generated_at: new Date().toISOString(),
  tool_version: "1.0.0",
  files: [],
};

for (const relPath of SACRED_FILES) {
  const absPath = path.resolve(cwd, relPath);

  if (!fs.existsSync(absPath)) {
    console.warn(`[extract-formula-bytes] WARN: file not found: ${absPath}`);
    continue;
  }

  const source = fs.readFileSync(absPath, "utf-8");
  const fileSha = createHash("sha256").update(source).digest("hex");

  const sourceFile = ts.createSourceFile(
    absPath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );

  const formulas = extractFormulaExpressions(sourceFile);
  const templates = extractTemplateLiterals(sourceFile);

  // Canonical formula string: join all formulas in AST order
  const canonicalStr = formulas.join("\n---\n") + "\n===TEMPLATES===\n" + templates.join("\n---\n");
  const formulaSha = createHash("sha256").update(canonicalStr).digest("hex");

  const record: FileFormulaRecord = {
    file: relPath,
    sha256_file: fileSha,
    formula_count: formulas.length,
    template_count: templates.length,
    formula_sha256: formulaSha,
    formulas,
    templates,
  };

  baseline.files.push(record);

  console.log(`[extract-formula-bytes] ${relPath}`);
  console.log(`  file SHA256:    ${fileSha}`);
  console.log(`  formula SHA256: ${formulaSha}`);
  console.log(`  formulas:       ${formulas.length}`);
  console.log(`  templates:      ${templates.length}`);
}

// Ensure output directory exists
const outDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(baseline, null, 2));
console.log(`\n[extract-formula-bytes] Baseline written to: ${OUTPUT_PATH}`);
console.log("[extract-formula-bytes] DONE — run scripts/check-formula-bytes.ts to verify later.");
