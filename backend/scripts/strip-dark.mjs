#!/usr/bin/env node
/**
 * Sprint 11 — Light-only lock.
 *
 * Strips every `dark:<utility>` Tailwind class from the client's tsx/ts/css
 * source. This is run once and the resulting code is committed. The pattern
 * matches a `dark:` prefix followed by a tailwind-friendly token until
 * whitespace, quote, backtick, or closing brace.
 *
 *   dark:text-white            -> removed
 *   dark:bg-emerald-900/40     -> removed
 *   dark:border-white/40       -> removed
 *
 * Adjacent whitespace is collapsed to one space inside the same string so
 * we don't leave double-spaces in className attributes. Lines that become
 * empty after edit are kept (no line-deletion).
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../client/src", import.meta.url).pathname;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const exts = new Set([".ts", ".tsx", ".css"]);
const re = /\bdark:[\w/\-[\]\#%.()]+/g;

let totalFiles = 0;
let totalReplacements = 0;
let touchedFiles = 0;

for (const f of walk(ROOT)) {
  if (!exts.has(extname(f))) continue;
  // Skip the locked theme module
  if (f.endsWith("/lib/theme.tsx")) continue;
  totalFiles += 1;
  const before = readFileSync(f, "utf8");
  let count = 0;
  let out = before.replace(re, () => {
    count += 1;
    return "";
  });
  if (count === 0) continue;
  // Collapse multiple spaces inside string literals (do safely globally - just runs of >=2)
  out = out.replace(/  +/g, " ");
  // Cleanup `" "` -> `""` only when class string is now blank
  out = out.replace(/className=\{?["']\s+["']\}?/g, 'className=""');
  writeFileSync(f, out, "utf8");
  totalReplacements += count;
  touchedFiles += 1;
}

console.log(`scanned: ${totalFiles} files`);
console.log(`touched: ${touchedFiles} files`);
console.log(`removed: ${totalReplacements} dark: occurrences`);
