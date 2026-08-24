/**
 * WAVE 116 — ONE COMMENT STRIPPER FOR EVERY SOURCE LOCK IN THIS WAVE.
 * ═══════════════════════════════════════════════════════════════════════════
 * The wave's source locks assert that a dead field or an invented constant is
 * absent from the EXECUTABLE lines of a file. The obvious implementations do not
 * work on this tree:
 *
 *  · dropping lines that START with `*`, `//` or `/*` leaves the interior lines
 *    of an indented block comment behind, and this wave's block comments quote
 *    the very expressions the locks forbid;
 *  · a single `/\*[\s\S]*?\*\//g` regex can pair a `/*` with a `*​/` that lives
 *    inside a string literal or a regex, which silently shifts the alignment of
 *    every later comment in the file and makes the lock assert about the wrong
 *    text.
 *
 * So this is a small state machine that knows about single quotes, double quotes,
 * template literals and both comment forms. It is deliberately in ONE file
 * imported by every W116 test, because two source-lock strippers that disagree is
 * exactly the class of defect this wave exists to remove.
 *
 * It is NOT a parser and does not need to be: regex literals are not tracked, so
 * a `/*` inside a regex would still confuse it. No file this wave locks contains
 * one, and the locks are asserted against known-good and known-bad inputs in
 * `w116_company_money_and_denominators.test.ts`.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "single"; out += c; i += 1; continue; }
      if (c === '"') { mode = "double"; out += c; i += 1; continue; }
      if (c === "`") { mode = "template"; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i += 1; continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
      /* Keep newlines so line numbers in a failure message still mean something. */
      if (c === "\n") out += c;
      i += 1; continue;
    }
    /* Inside a string: copy through, honouring backslash escapes. */
    out += c;
    if (c === "\\") { out += source[i + 1] ?? ""; i += 2; continue; }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`")
    ) {
      /* The opening quote was already copied in `code` mode, so a closing quote
         here ends the string only when it is not the opener itself. */
      if (out.length > 1) mode = "code";
    }
    i += 1;
  }
  return out;
}
