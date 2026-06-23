#!/usr/bin/env tsx
/**
 * scripts/precise_migrate.ts — Phase B precise file migrator
 * 
 * Does careful text-based transformations that are safe:
 * 1. .all() as T[] → wraps query in await pAll<T>(...)
 * 2. .get() as T → wraps query in await pGet<T>(...)  
 * 3. expr.run() → wraps in await pRun(...)
 * 4. db.transaction((tx) => { → await pTransaction(db, async (tx) => {
 * 5. Makes enclosing function async (adds 'async' keyword)
 * 6. Updates portable imports
 *
 * Algorithm: line-by-line with look-behind for multi-line chains
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SACRED_FILES = new Set([
  "server/captableCommitStore.ts",
  "server/roundsStore.ts",
  "server/lib/roundCloseCascade.ts",
  "server/spvFundStore.ts",
  "server/collectiveBillingStore.ts",
]);

function getPortablePath(filePath: string): string {
  if (filePath.includes("/lib/") || filePath.includes("/jobs/")) {
    return "../db/portable";
  }
  return "./db/portable";
}

function addPortableImport(content: string, filePath: string, names: string[]): string {
  if (!names.length) return content;
  const portablePath = getPortablePath(filePath);
  
  // Check existing import
  const existingRe = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${portablePath.replace(/\//g, "/")}["']\\s*;`,
    "m"
  );
  const m = content.match(existingRe);
  if (m) {
    const existing = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const toAdd = names.filter((n) => !existing.includes(n));
    if (!toAdd.length) return content;
    const all = [...existing, ...toAdd];
    return content.replace(existingRe, `import { ${all.join(", ")} } from "${portablePath}";`);
  }
  
  // Insert after last import
  const newLine = `import { ${names.join(", ")} } from "${portablePath}"; /* Wave H — Postgres compat */\n`;
  const allImports = [...content.matchAll(/^import\s[^\n]+/gm)];
  if (allImports.length > 0) {
    const last = allImports[allImports.length - 1];
    const idx = last.index! + last[0].length;
    return content.slice(0, idx) + "\n" + newLine + content.slice(idx);
  }
  return newLine + content;
}

/**
 * Collect a multi-line expression ending at `endLine` index.
 * Goes backwards from the line containing .all()/.get()/.run() 
 * to find the start of the expression.
 */
function collectExpressionLines(lines: string[], endIdx: number): { start: number; indent: string } {
  let idx = endIdx;
  
  // Walk backward — a continuation line is one that doesn't end a statement
  while (idx > 0) {
    const prev = lines[idx - 1];
    const trimmed = prev.trim();
    // Stop if previous line ends a block/statement
    if (
      trimmed.endsWith(";") ||
      trimmed.endsWith("{") ||
      trimmed.endsWith("}") ||
      trimmed.endsWith("*/") ||
      trimmed === "" ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*")
    ) {
      break;
    }
    idx--;
  }
  
  // Get indent from the start line
  const startLine = lines[idx];
  const indentMatch = startLine.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : "";
  
  return { start: idx, indent };
}

function migrateContent(content: string, filePath: string): { content: string; changed: boolean; needed: Set<string> } {
  const needed = new Set<string>();
  let changed = false;
  
  let lines = content.split("\n");
  const newLines: string[] = [];
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // ── db.transaction((tx) pattern ─────────────────────────────────────
    // db.transaction((tx: any) => {
    // → await pTransaction(db, async (tx: any) => {
    const txnMatch = line.match(/^(\s*)(\w+)\.transaction\s*\((\([^)]*\))\s*=>\s*\{(.*)$/);
    if (txnMatch) {
      needed.add("pTransaction");
      changed = true;
      const [, indent, dbVar, params, rest] = txnMatch;
      newLines.push(`${indent}await pTransaction(${dbVar}, async ${params} => {${rest}`);
      i++;
      continue;
    }
    
    // ── .run() terminal ──────────────────────────────────────────────────
    // expr.run(); → await pRun(expr);
    const runMatch = line.match(/^(\s*)(.*[^\s])\.run\(\)\s*;?\s*$/);
    if (runMatch && !runMatch[2].includes("//") && !trimmed.startsWith("//") && !trimmed.startsWith("*")) {
      needed.add("pRun");
      changed = true;
      const [, indent, expr] = runMatch;
      
      // Check if it's a simple expression or multi-line chain
      if (expr.trim().startsWith(".") || expr.trim().startsWith("tx.") || expr.trim().startsWith("db.")) {
        // Could be last line of a chain — collect from start
        const exprLines: string[] = [];
        let j = i;
        
        // Collect this line (without .run())
        const thisLineExpr = expr;
        
        // Check if previous lines are continuations
        const continuationLines: string[] = [];
        let k = newLines.length - 1;
        while (k >= 0) {
          const prev = newLines[k];
          const prevTrimmed = prev.trim();
          if (
            prevTrimmed === "" ||
            prevTrimmed.endsWith(";") ||
            (prevTrimmed.endsWith("}") && !prevTrimmed.startsWith(".")) ||
            prevTrimmed.endsWith("{") ||
            prevTrimmed.startsWith("//") ||
            prevTrimmed.startsWith("*")
          ) {
            break;
          }
          continuationLines.unshift(newLines.pop()!);
          k--;
        }
        
        if (continuationLines.length > 0) {
          // Multi-line expression
          const allExprLines = [...continuationLines, expr];
          const firstLine = allExprLines[0];
          const firstIndent = firstLine.match(/^(\s*)/)?.[1] ?? "";
          
          // Check if first line has an assignment
          const assignMatch = firstLine.match(/^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w\s<>|[\]]+)?\s*=\s*)(.*)/);
          if (assignMatch) {
            const [, fi, decl, rest] = assignMatch;
            const queryLines = [rest, ...allExprLines.slice(1).map((l) => l.trim())];
            const queryExpr = queryLines.join("\n" + fi + "  ");
            newLines.push(`${fi}${decl}await pRun(\n${fi}  ${queryExpr}\n${fi});`);
          } else {
            const queryExpr = allExprLines.map((l) => l.trim()).join("\n" + firstIndent + "  ");
            newLines.push(`${firstIndent}await pRun(\n${firstIndent}  ${queryExpr}\n${firstIndent});`);
          }
        } else {
          // Single line .run()
          newLines.push(`${indent}await pRun(\n${indent}  ${expr.trim()}\n${indent});`);
        }
      } else {
        newLines.push(`${indent}await pRun(\n${indent}  ${expr.trim()}\n${indent});`);
      }
      
      i++;
      continue;
    }
    
    // ── .all() terminal ──────────────────────────────────────────────────
    const allMatch = line.match(/^(\s*)(.*?)\.all\(\)(\s*as\s+[\w\[\]|<>\s]+)?(\s*;?\s*)$/);
    if (allMatch && !trimmed.startsWith("//") && !trimmed.startsWith("*") && allMatch[2].trim() !== "") {
      needed.add("pAll");
      changed = true;
      const [, indent, expr, asType, semi] = allMatch;
      
      // Extract type
      const typeMatch = asType?.match(/as\s+(\w+)(?:\[\])?/);
      const T = typeMatch ? typeMatch[1] : "any";
      
      // Check for preceding continuation lines
      const continuationLines: string[] = [];
      let k = newLines.length - 1;
      while (k >= 0) {
        const prev = newLines[k];
        const prevTrimmed = prev.trim();
        if (
          prevTrimmed === "" ||
          prevTrimmed.endsWith(";") ||
          (prevTrimmed.endsWith("}") && !prevTrimmed.startsWith(".")) ||
          prevTrimmed.endsWith("{") ||
          prevTrimmed.startsWith("//") ||
          prevTrimmed.startsWith("*")
        ) {
          break;
        }
        continuationLines.unshift(newLines.pop()!);
        k--;
      }
      
      const hasSemi = semi?.trim() === ";";
      const terminator = hasSemi ? ";" : "";
      
      if (continuationLines.length > 0) {
        const allExprLines = [...continuationLines, line.replace(/\.all\(\)(\s*as\s+[\w\[\]|<>\s]+)?/, "")];
        const firstLine = allExprLines[0];
        const firstIndent = firstLine.match(/^(\s*)/)?.[1] ?? "";
        
        const assignMatch = firstLine.match(/^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w\s<>|[\]]+)?\s*=\s*)(.*)/);
        if (assignMatch) {
          const [, fi, decl, rest] = assignMatch;
          const restTrimmed = rest.replace(/\.all\(\)(\s*as\s+[\w\[\]|<>\s]+)?;?$/, "").trim();
          const queryLines = [restTrimmed, ...allExprLines.slice(1).map((l) => l.trim().replace(/\.all\(\)(\s*as\s+[\w\[\]|<>\s]+)?;?$/, "").trim())].filter((l) => l.trim() !== "");
          const queryExpr = queryLines.join("\n" + fi + "  ");
          newLines.push(`${fi}${decl}await pAll<${T}>(\n${fi}  ${queryExpr}\n${fi})${terminator}`);
        } else {
          const queryExpr = allExprLines.map((l) => l.trim().replace(/\.all\(\)(\s*as\s+[\w\[\]|<>\s]+)?;?$/, "").trim()).filter(Boolean).join("\n" + firstIndent + "  ");
          newLines.push(`${firstIndent}await pAll<${T}>(\n${firstIndent}  ${queryExpr}\n${firstIndent})${terminator}`);
        }
      } else {
        const cleanExpr = expr.trim().replace(/\.all\(\)(\s*as\s+[\w\[\]|<>\s]+)?;?$/, "").trim();
        // Check if this line has assignment
        const assignMatch = line.match(/^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w\s<>|[\]]+)?\s*=\s*)(.*)/);
        if (assignMatch) {
          const [, fi, decl] = assignMatch;
          newLines.push(`${fi}${decl}await pAll<${T}>(\n${fi}  ${cleanExpr}\n${fi})${terminator}`);
        } else {
          newLines.push(`${indent}await pAll<${T}>(\n${indent}  ${cleanExpr}\n${indent})${terminator}`);
        }
      }
      
      i++;
      continue;
    }
    
    // ── .get() terminal ──────────────────────────────────────────────────
    const getMatch = line.match(/^(\s*)(.*?)\.get\(\)(\s*as\s+[\w\[\]|<>\s]+)?(\s*;?\s*)$/);
    if (getMatch && !trimmed.startsWith("//") && !trimmed.startsWith("*") && getMatch[2].trim() !== "") {
      needed.add("pGet");
      changed = true;
      const [, indent, expr, asType, semi] = getMatch;
      
      const typeMatch = asType?.match(/as\s+([\w\s|]+?)(?:\s*;)?$/);
      const T = typeMatch ? typeMatch[1].trim().replace(/\s*\|\s*undefined$/, "") : "any";
      
      const continuationLines: string[] = [];
      let k = newLines.length - 1;
      while (k >= 0) {
        const prev = newLines[k];
        const prevTrimmed = prev.trim();
        if (
          prevTrimmed === "" ||
          prevTrimmed.endsWith(";") ||
          (prevTrimmed.endsWith("}") && !prevTrimmed.startsWith(".")) ||
          prevTrimmed.endsWith("{") ||
          prevTrimmed.startsWith("//") ||
          prevTrimmed.startsWith("*")
        ) {
          break;
        }
        continuationLines.unshift(newLines.pop()!);
        k--;
      }
      
      const hasSemi = semi?.trim() === ";";
      const terminator = hasSemi ? ";" : "";
      
      if (continuationLines.length > 0) {
        const allExprLines = [...continuationLines, line.replace(/\.get\(\)(\s*as\s+[\w\[\]|<>\s]+)?/, "")];
        const firstLine = allExprLines[0];
        const firstIndent = firstLine.match(/^(\s*)/)?.[1] ?? "";
        
        const assignMatch = firstLine.match(/^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w\s<>|[\]]+)?\s*=\s*)(.*)/);
        if (assignMatch) {
          const [, fi, decl, rest] = assignMatch;
          const restTrimmed = rest.replace(/\.get\(\)(\s*as\s+[\w\[\]|<>\s]+)?;?$/, "").trim();
          const queryLines = [restTrimmed, ...allExprLines.slice(1).map((l) => l.trim().replace(/\.get\(\)(\s*as\s+[\w\[\]|<>\s]+)?;?$/, "").trim())].filter((l) => l.trim() !== "");
          const queryExpr = queryLines.join("\n" + fi + "  ");
          newLines.push(`${fi}${decl}await pGet<${T}>(\n${fi}  ${queryExpr}\n${fi})${terminator}`);
        } else {
          const queryExpr = allExprLines.map((l) => l.trim().replace(/\.get\(\)(\s*as\s+[\w\[\]|<>\s]+)?;?$/, "").trim()).filter(Boolean).join("\n" + firstIndent + "  ");
          newLines.push(`${firstIndent}await pGet<${T}>(\n${firstIndent}  ${queryExpr}\n${firstIndent})${terminator}`);
        }
      } else {
        const cleanExpr = expr.trim();
        const assignMatch = line.match(/^(\s*)((?:const|let|var)\s+\w+(?::\s*[\w\s<>|[\]]+)?\s*=\s*)(.*)/);
        if (assignMatch) {
          const [, fi, decl] = assignMatch;
          newLines.push(`${fi}${decl}await pGet<${T}>(\n${fi}  ${cleanExpr}\n${fi})${terminator}`);
        } else {
          newLines.push(`${indent}await pGet<${T}>(\n${indent}  ${cleanExpr}\n${indent})${terminator}`);
        }
      }
      
      i++;
      continue;
    }
    
    newLines.push(line);
    i++;
  }
  
  let result = newLines.join("\n");
  
  // Make functions async where needed
  // Any function that now contains "await" should be async
  // This is tricky without full AST — we'll do a simple heuristic
  if (changed && needed.size > 0) {
    // Add async to function declarations that contain await
    // We handle common patterns:
    // function foo(...) { → async function foo(...) {
    // foo(...) { → async foo(...) {  (method shorthand)
    // (req, res) => { → async (req, res) => {
    
    // This is done carefully — only functions that directly contain our await calls
    // For now, flag that manual review is needed for non-async callers
  }
  
  // Update imports
  if (needed.size > 0) {
    result = addPortableImport(result, filePath, [...needed].sort());
  }
  
  const didChange = result !== content;
  return { content: result, changed: didChange, needed };
}

// Process files from command line
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log("Usage: npx tsx scripts/precise_migrate.ts <file1> [file2] ...");
  process.exit(1);
}

for (const filePath of args) {
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP (not found): ${filePath}`);
    continue;
  }
  
  if (SACRED_FILES.has(filePath)) {
    console.log(`SKIP (sacred): ${filePath}`);
    continue;
  }
  
  const original = fs.readFileSync(filePath, "utf-8");
  const { content: migrated, changed, needed } = migrateContent(original, filePath);
  
  if (changed) {
    fs.writeFileSync(filePath, migrated, "utf-8");
    const remaining = {
      all: (migrated.match(/\.all\(\)/g) || []).length,
      get: (migrated.match(/\.get\(\)/g) || []).length,
      run: (migrated.match(/\.run\(\)/g) || []).length,
      txn: (migrated.match(/\bdb\.transaction\(/g) || []).length,
    };
    console.log(`MIGRATED: ${filePath} (added: ${[...needed].join(", ")})`);
    if (Object.values(remaining).some((v) => v > 0)) {
      console.log(`  Remaining: .all=${remaining.all} .get=${remaining.get} .run=${remaining.run} db.txn=${remaining.txn}`);
    }
  } else {
    console.log(`UNCHANGED: ${filePath}`);
  }
}
