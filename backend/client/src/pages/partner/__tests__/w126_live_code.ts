/**
 * WAVE 126 — the comment stripper, shared by this wave's source-level tests.
 *
 * THE COMMENT TRAP. Strings describing an already-fixed defect survive in
 * comments, so a grep hit is not a defect until it is proved to be in LIVE
 * CODE. Every source-level assertion in this wave runs against the output of
 * `liveCode` rather than the raw file.
 *
 * This lives in a plain `.ts` module, NOT a `.test.ts` one, on purpose: vitest
 * collects only `*.test.ts`/`*.test.tsx` (vitest.config.ts:53-62), so importing
 * the stripper from a second test file cannot re-execute a suite. It previously
 * lived in the surface test and importing it there ran those 24 tests twice,
 * which inflated this wave's reported test count.
 */
/** Strip line comments, block comments and JSX `{/* … *\u002f}` comments. */
export function liveCode(src: string): string {
  let out = "";
  let i = 0;
  let inS: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inS) {
      if (c === "\\") { out += "  "; i += 2; continue; }
      if (c === inS) inS = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === "`") { inS = c; out += c; i++; continue; }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2; out += "  ";
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      i += 2; out += "  ";
      continue;
    }
    out += c; i++;
  }
  return out;
}
