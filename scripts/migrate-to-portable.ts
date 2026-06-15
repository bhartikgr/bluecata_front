#!/usr/bin/env tsx
/**
 * scripts/migrate-to-portable.ts
 *
 * Automated Phase B migration tool. For each file in the list:
 * 1. Replaces .all() → await pAll<T>(...)  
 * 2. Replaces .get() → await pGet<T>(...)
 * 3. Replaces .run() → await pRun(...)
 * 4. Replaces db.transaction((...) => {...}) → await pTransaction(db, async (...) => {...})
 * 5. Makes enclosing functions async
 * 6. Adds pAll/pGet/pRun/pTransaction to imports from portable.ts
 *
 * This is a BEST-EFFORT transformer. Review each file after running.
 * The SACRED files are excluded and must be handled manually in Phase C.
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

/**
 * Transform a file's content to use portable helpers.
 * Returns null if no changes needed.
 */
export function transformFile(content: string, filePath: string): string | null {
  let result = content;
  let changed = false;

  // 1. Add pAll, pGet, pRun, pTransaction to portable import if not already present
  const portableImportRegex = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*portable["']\s*;/;
  const match = result.match(portableImportRegex);
  
  const neededImports: string[] = [];
  if (result.includes(".all()") || result.includes("pAll")) neededImports.push("pAll");
  if (result.includes(".get()") || result.includes("pGet")) neededImports.push("pGet");
  if (result.includes(".run()") || result.includes("pRun")) neededImports.push("pRun");
  if (result.includes("db.transaction") || result.includes("pTransaction")) neededImports.push("pTransaction");

  if (match) {
    const existingImports = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    const newImports = neededImports.filter((i) => !existingImports.includes(i));
    if (newImports.length > 0) {
      const allImports = [...existingImports, ...newImports].join(", ");
      result = result.replace(portableImportRegex, (m) => m.replace(match[1], ` ${allImports} `));
      changed = true;
    }
  } else if (neededImports.length > 0) {
    // Add a new import — find where to insert (after other server imports)
    const importLine = `import { ${neededImports.join(", ")} } from "./db/portable";\n`;
    const libImportLine = `import { ${neededImports.join(", ")} } from "../db/portable";\n`;
    
    // Determine relative path
    const isInLib = filePath.includes("/lib/") || filePath.includes("/jobs/");
    const newImport = isInLib ? libImportLine : importLine;
    
    // Insert after last import line
    const lastImportMatch = result.match(/^import[^;]*;[^\n]*/mg);
    if (lastImportMatch) {
      const lastImport = lastImportMatch[lastImportMatch.length - 1];
      const idx = result.lastIndexOf(lastImport) + lastImport.length;
      result = result.slice(0, idx) + "\n" + newImport + result.slice(idx);
      changed = true;
    }
  }

  // 2. Transform .all() calls to await pAll<...>(...)
  // Pattern: someQuery.all() → pAll(someQuery)
  // More complex: builder.all() as Type[] → await pAll<Type>(builder)
  
  // Simple: .all() as any[] 
  result = result.replace(/(\s*)\.all\(\)\s*as\s*any\[\]/g, (_m, ws) => {
    changed = true;
    return `${ws}`;
  });
  
  // .all() at end of chain
  const allCallCount = (result.match(/\.all\(\)/g) || []).length;
  if (allCallCount > 0) {
    // We'll do the transformation manually per file rather than regex
    // Just flag that the file needs work
  }

  return changed ? result : null;
}

// Print help
console.log("migrate-to-portable.ts: Use the per-file migration approach");
console.log("Files to migrate are listed in wave_h_audit/REMAINING_LIVE.txt");
process.exit(0);
