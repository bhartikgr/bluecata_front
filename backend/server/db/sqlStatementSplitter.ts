// v26.57.1: pure runtime copy of the protected migration runner's SQL splitter.
// Do not import the CLI runner into the application bundle. Exact function-text and
// all-migration parity are enforced by install_splitter_isolation.test.ts.
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  // v26.7.2 hotfix (post-review hardened): track BEGIN...END nesting for
  // CREATE TRIGGER bodies. Semicolons inside a trigger body must NOT
  // terminate the outer CREATE TRIGGER statement.
  //
  // We must distinguish:
  //   • trigger-body BEGIN (opens depth)
  //   • transaction BEGIN / BEGIN TRANSACTION / BEGIN DEFERRED / IMMEDIATE
  //     / EXCLUSIVE (does NOT open depth; the runner already wraps every
  //     migration in a transaction, so any inner BEGIN is invalid anyway)
  //   • CASE...END expressions (open a separate depth so their END does
  //     not close a surrounding trigger body prematurely)
  //   • identifiers named `begin`/`end` (SQLite accepts these unquoted;
  //     we require whitespace/paren/semicolon before the keyword AND we
  //     reject the transaction-control forms explicitly)
  let beginDepth = 0;
  let caseDepth = 0;

  while (i < n) {
    const c = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      buf += c;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        buf += "*/";
        i += 2;
        inBlockComment = false;
        continue;
      }
      buf += c;
      i++;
      continue;
    }
    if (inSingle) {
      buf += c;
      if (c === "'" && sql[i - 1] !== "\\") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      buf += c;
      if (c === '"' && sql[i - 1] !== "\\") inDouble = false;
      i++;
      continue;
    }
    if (inBacktick) {
      buf += c;
      if (c === "`") inBacktick = false;
      i++;
      continue;
    }

    if (c === "-" && next === "-") {
      inLineComment = true;
      buf += "--";
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      buf += "/*";
      i += 2;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      buf += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      buf += c;
      i++;
      continue;
    }
    if (c === "`") {
      inBacktick = true;
      buf += c;
      i++;
      continue;
    }
    // v26.7.2 hotfix (post-review): match SQL keywords case-insensitively
    // at word boundaries. Only apply when outside strings/comments (already
    // guarded above by continue statements).

    // BEGIN — open a trigger-body depth, unless this is a transaction-
    // control BEGIN (`BEGIN;`, `BEGIN TRANSACTION`, `BEGIN DEFERRED/
    // IMMEDIATE/EXCLUSIVE`). Transaction BEGINs are not paired with END
    // and would otherwise swallow the rest of the file into one chunk.
    if (
      (c === "B" || c === "b") &&
      /^begin\b/i.test(sql.slice(i, i + 6))
    ) {
      const prev = i > 0 ? sql[i - 1] : " ";
      const isWordBoundary = i === 0 || /[\s(;]/.test(prev);
      // What follows BEGIN? Check the next ~30 chars past the keyword.
      const after = sql.slice(i + 5, i + 35);
      const isTxnControl =
        /^\s*(;|$)/.test(after) ||
        /^\s+(transaction|deferred|immediate|exclusive)\b/i.test(after);
      if (isWordBoundary && !isTxnControl) {
        beginDepth++;
        buf += sql.slice(i, i + 5);
        i += 5;
        continue;
      }
    }
    // CASE — track a separate depth so CASE...END inside a trigger body
    // does not decrement beginDepth. Only when we're inside a trigger.
    if (
      (c === "C" || c === "c") &&
      /^case\b/i.test(sql.slice(i, i + 5)) &&
      beginDepth > 0
    ) {
      const prev = i > 0 ? sql[i - 1] : " ";
      if (i === 0 || /[\s(,;]/.test(prev)) {
        caseDepth++;
        buf += sql.slice(i, i + 4);
        i += 4;
        continue;
      }
    }
    // END — closes the innermost open construct. CASE first (if any),
    // otherwise the trigger body. `RAISE(ABORT,'x')END` is legal SQL, so
    // ')' is a valid preceding character.
    if (
      (c === "E" || c === "e") &&
      /^end\b/i.test(sql.slice(i, i + 4)) &&
      (beginDepth > 0 || caseDepth > 0)
    ) {
      const prev = i > 0 ? sql[i - 1] : " ";
      if (/[\s;)]/.test(prev)) {
        if (caseDepth > 0) {
          caseDepth--;
        } else {
          beginDepth--;
        }
        buf += sql.slice(i, i + 3);
        i += 3;
        continue;
      }
    }

    if (c === ";") {
      // Semicolons inside BEGIN...END blocks terminate INNER statements only,
      // not the outer CREATE TRIGGER. Keep them in the buffer.
      if (beginDepth > 0) {
        buf += c;
        i++;
        continue;
      }
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}
