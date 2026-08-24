/**
 * WAVE 104 · A WHOLE-TREE FENCE FOR CONDITIONAL HOOKS.
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS. On 2026-08-22, hours after v26.20.0 reached production, the
 * Consortium Partner SPV engine — `/collective/partner/spv-engine`, the screen a
 * general partner uses to launch a vehicle — showed a crash screen carrying a
 * raw React invariant to the customer:
 *
 *     "Something went wrong / Minified React error #310"
 *
 * React error #310 is "Rendered more hooks than during the previous render".
 * `PartnerSpvEngine` guards on `if (!role.ready || !role.identity) return null`
 * while the partner role resolves. WAVE 83 of this same programme added three
 * hooks BELOW that guard — a `useState` and a `useRef`/`useEffect` pair. First
 * render: guard fires, React records the short hook list. Next render: role has
 * resolved, three more hooks appear, React throws, and the entire page dies.
 *
 * WHY NO EXISTING GATE CAUGHT IT — this is the important part.
 *   · `tsc` type-checks fine. Hook ORDER is not a type.
 *   · The unit suite passed. A test that renders the component once, already
 *     authorised, never takes the early return and never sees the short list.
 *     Only a render that takes the guard FIRST and then re-renders can expose it.
 *   · The sacred hash gate is about file integrity, not hook order.
 *   · The reachability gate proves a screen HAS a caller, not that it renders.
 *   · Three independent model reviews and a live read-only portal audit all
 *     missed it, because nobody opened this particular page while signed in as a
 *     partner whose role had not yet resolved.
 * A defect that every instrument we own is blind to must become an instrument.
 *
 * WHAT THIS MEASURES, from the real TypeScript AST rather than by grep:
 *
 *   CLASS A — a `return` at a component's own top statement level, followed
 *             later at that same level by a hook call. This is the shape that
 *             crashed production. It is a hard failure.
 *
 *   CLASS B — a hook called inside an `if`, a loop, a ternary, the right-hand
 *             side of `&&`/`||`, or a `try`. Such a hook does not run on every
 *             render, which is the same defect reached by a different route.
 *
 * INSTRUMENT VALIDATION. This analyser was validated before it was trusted,
 * against four planted positives (early-return-then-hook, hook in `if`, hook in
 * a ternary, hook in a loop) and one planted negative (an early return with no
 * hooks after it). It flagged all four positives and did not flag the negative.
 * The fixtures were created OUTSIDE the source tree and deleted — this project
 * has previously left a fence-defeating fixture inside the shippable tree.
 *
 * A `return` that is a component's LAST top-level statement is not an early
 * return, so the ordinary `return (<JSX/>)` at the end of every component is
 * correctly ignored.
 *
 * WHAT THIS INSTRUMENT DOES NOT COVER — stated so nobody mistakes a green run
 * for a proof of absence:
 *
 *   · A CONCISE-BODY arrow, `memo(() => cond ? useA() : useB())`, is not
 *     analysed. It has no statement list, so it cannot hold an early return and
 *     cannot exhibit CLASS A; a hook inside a conditional EXPRESSION there would
 *     be missed. Measured today: 144 wrapped component declarations exist across
 *     44 files, of which the ones with statement bodies are analysed — the
 *     component count rose from 792 to 818 when wrapper unwrapping was added.
 *   · A hook reached through a CUSTOM HOOK that itself returns early is counted
 *     in the custom hook, not in its callers.
 *   · An early `throw` before hooks is not reported. It does not produce a
 *     differing hook COUNT; it produces an error boundary.
 *
 * THE HISTORY OF THIS FILE IS THE REASON FOR THAT PARAGRAPH. The first version
 * analysed only bare arrow and function initialisers, so
 * `const Thing = React.memo(() => { … })` was skipped ENTIRELY. An independent
 * reviewer proved it by wrapping the exact production crash in `React.memo` and
 * watching the fence walk past it, and separately measured 144 wrapped
 * components while the lead's own single-line grep reported zero. The reviewer
 * was right and the lead was wrong. Wrappers are now unwrapped generically — any
 * call expression, not a list of known names — and returns are found inside
 * loops, `switch` and `try` as well as `if`.
 *
 * IF THIS FENCE GOES RED, a screen will crash for some users and not others,
 * depending only on how quickly an authorisation query resolves. Fix it by
 * moving the hook ABOVE the guard — never by deleting the guard.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "../../../..");
const CLIENT_SRC = path.join(ROOT, "client", "src");

const HOOK_NAME = /^use[A-Z]/;
const SKIP_DIRS = new Set(["node_modules", "__tests__", "__mocks__", ".git", "dist", "build"]);

type ClassA = {
  file: string;
  component: string;
  earlyReturnLine: number;
  hooksAfter: Array<{ name: string; line: number }>;
};
type ClassB = {
  file: string;
  component: string;
  hook: string;
  line: number;
  guard: string;
};

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      sourceFiles(p, acc);
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** The hook name if this node is a hook CALL (`useX(...)` or `React.useX(...)`). */
function hookCallName(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const ex = node.expression;
  if (ts.isIdentifier(ex) && HOOK_NAME.test(ex.text)) return ex.text;
  if (ts.isPropertyAccessExpression(ex) && ts.isIdentifier(ex.name) && HOOK_NAME.test(ex.name.text)) {
    return ex.name.text;
  }
  return null;
}

/** A component or a custom hook: `PascalCase` or `useSomething`. */
const isComponentLike = (name: string) => /^[A-Z]/.test(name) || HOOK_NAME.test(name);

/**
 * The first `return` reachable inside a statement WITHOUT entering a nested
 * function. Catches `return`, `if (c) return`, and — which the first version of
 * this analyser missed — a return inside a `for`, `while`, `switch`, `try` or a
 * bare block. A callback's own `return` is not the component returning, so
 * nested function bodies are deliberately not entered.
 */
function firstReturnOutsideNestedFunction(stmt: ts.Node): ts.ReturnStatement | null {
  let found: ts.ReturnStatement | null = null;
  const walk = (n: ts.Node) => {
    if (found) return;
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isClassDeclaration(n) ||
      ts.isClassExpression(n)
    ) {
      return; // a different scope's return
    }
    if (ts.isReturnStatement(n)) {
      found = n;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(stmt);
  return found;
}

/**
 * Function bodies that a declaration actually defines as a component, unwrapping
 * higher-order wrappers.
 *
 * WHY THIS EXISTS. The first version of this analyser only looked at a bare
 * arrow or function initialiser, so `const Thing = React.memo(() => { … })` was
 * skipped ENTIRELY — hooks and all. An independent reviewer proved the point by
 * wrapping the exact production crash in `React.memo`; the analyser walked past
 * it. There are 100+ such components in this tree, so the fence had a hole in
 * precisely the shape it was written to catch.
 *
 * Any call expression is unwrapped, not a fixed list of names: `memo`,
 * `forwardRef`, `observer`, `withRouter`, and any future wrapper all behave the
 * same way, and an allow-list would rot.
 */
function unwrapFunctionBodies(node: ts.Expression, depth = 0): ts.Block[] {
  if (depth > 6) return [];
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isBlock(node.body)) {
    return [node.body];
  }
  if (ts.isCallExpression(node)) {
    const out: ts.Block[] = [];
    for (const arg of node.arguments) out.push(...unwrapFunctionBodies(arg, depth + 1));
    return out;
  }
  if (ts.isParenthesizedExpression(node)) return unwrapFunctionBodies(node.expression, depth + 1);
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return unwrapFunctionBodies(node.expression, depth + 1);
  }
  return [];
}

function analyse(): { a: ClassA[]; b: ClassB[]; filesScanned: number; components: number; hooks: number } {
  const a: ClassA[] = [];
  const b: ClassB[] = [];
  let filesScanned = 0;
  let components = 0;
  let hooks = 0;

  for (const file of sourceFiles(CLIENT_SRC)) {
    filesScanned++;
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const rel = path.relative(ROOT, file);
    const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

    const analyseBody = (name: string, body: ts.Block) => {
      components++;

      /* ---- CLASS A: early top-level return, then a top-level hook ---- */
      let earlyReturn: ts.ReturnStatement | null = null;
      const after: Array<{ name: string; line: number }> = [];
      const last = body.statements[body.statements.length - 1];

      for (const stmt of body.statements) {
        const here: Array<{ name: string; line: number }> = [];
        const collect = (n: ts.Node) => {
          const h = hookCallName(n);
          if (h) {
            here.push({ name: h, line: lineOf(n) });
            hooks++;
          }
          ts.forEachChild(n, collect);
        };
        collect(stmt);

        if (earlyReturn && here.length) after.push(...here);

        if (!earlyReturn && stmt !== last) {
          const r = firstReturnOutsideNestedFunction(stmt);
          if (r) earlyReturn = r;
        }
      }

      if (earlyReturn && after.length) {
        a.push({ file: rel, component: name, earlyReturnLine: lineOf(earlyReturn), hooksAfter: after });
      }

      /* ---- CLASS B: a hook that does not run on every render ---- */
      const walk = (n: ts.Node, guard: string | null) => {
        const h = hookCallName(n);
        if (h && guard) b.push({ file: rel, component: name, hook: h, line: lineOf(n), guard });
        ts.forEachChild(n, (child) => {
          let g = guard;
          if (ts.isIfStatement(n) && (child === n.thenStatement || child === n.elseStatement)) g = "if";
          else if (
            ts.isForStatement(n) ||
            ts.isForOfStatement(n) ||
            ts.isForInStatement(n) ||
            ts.isWhileStatement(n) ||
            ts.isDoStatement(n)
          ) g = "loop";
          else if (ts.isConditionalExpression(n) && (child === n.whenTrue || child === n.whenFalse)) g = "ternary";
          else if (
            ts.isBinaryExpression(n) &&
            (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
              n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
              n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
            child === n.right
          ) g = "logical";
          else if (ts.isTryStatement(n)) g = "try";
          else if (ts.isSwitchStatement(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)) g = "switch";
          walk(child, g);
        });
      };
      walk(body, null);
    };

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.body && isComponentLike(node.name.text)) {
        analyseBody(node.name.text, node.body);
      } else if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue;
          if (!isComponentLike(d.name.text)) continue;
          for (const b of unwrapFunctionBodies(d.initializer)) analyseBody(d.name.text, b);
        }
      } else if (ts.isExportAssignment(node) && node.expression) {
        /* `export default memo(function Foo() { … })` and friends. */
        for (const b of unwrapFunctionBodies(node.expression)) {
          analyseBody("default export", b);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  /* The class-B walker can reach the same call site twice; report each once. */
  const seen = new Set<string>();
  const bUnique = b.filter((f) => {
    const k = `${f.file}|${f.component}|${f.line}|${f.hook}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { a, b: bUnique, filesScanned, components, hooks };
}

const RESULT = analyse();

describe("W104 — React hooks run unconditionally on every render", () => {
  it("the analyser actually looked at the client tree (guards against a silent no-op fence)", () => {
    /* A fence that scans nothing passes for ever. These floors are far below the
       measured 458 files / 792 components / 3,010 hook calls, so ordinary
       refactoring will not trip them, but deleting the tree or breaking the
       walker will. */
    expect(RESULT.filesScanned).toBeGreaterThan(300);
    expect(RESULT.components).toBeGreaterThan(500);
    expect(RESULT.hooks).toBeGreaterThan(2000);
  });

  it("CLASS A — no component returns early and then calls a hook (React #310)", () => {
    const detail = RESULT.a
      .map(
        (f) =>
          `${f.file} :: ${f.component} — early return at line ${f.earlyReturnLine}, then ` +
          `${f.hooksAfter.length} hook(s): ` +
          f.hooksAfter.map((h) => `${h.name}@${h.line}`).join(", "),
      )
      .join("\n");
    expect(
      RESULT.a,
      RESULT.a.length
        ? `A hook is declared AFTER an early return. That page will crash with React error #310 ` +
            `for any user whose authorisation resolves after the first render. Move the hook(s) ABOVE ` +
            `the guard — do not remove the guard.\n${detail}`
        : "",
    ).toEqual([]);
  });

  it("CLASS B — no hook is called inside a condition, loop, ternary or try", () => {
    const detail = RESULT.b
      .map((f) => `${f.file} :: ${f.component} — ${f.hook} at line ${f.line} inside a ${f.guard}`)
      .join("\n");
    expect(
      RESULT.b,
      RESULT.b.length
        ? `A hook does not run on every render. Hoist it to the component's top level.\n${detail}`
        : "",
    ).toEqual([]);
  });

  it("the SPV engine specifically keeps every hook above its role guard (the regression)", () => {
    const f = path.join(CLIENT_SRC, "pages", "partner", "PartnerSpvEngine.tsx");
    const src = fs.readFileSync(f, "utf8");
    const lines = src.split("\n");
    const guard = lines.findIndex((l) => /if \(!role\.ready \|\| !role\.identity\) return null;/.test(l));
    expect(guard, "the role guard should still exist in PartnerSpvEngine").toBeGreaterThan(-1);

    /* Every hook call in the file must appear at or before the guard line.
       Comments are excluded by taking the AST, not the text. */
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const belowGuard: string[] = [];
    const visit = (n: ts.Node) => {
      const h = hookCallName(n);
      if (h) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line; // 0-based
        if (line > guard) belowGuard.push(`${h} at line ${line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);

    expect(
      belowGuard,
      belowGuard.length
        ? `These hooks sit BELOW the role guard at line ${guard + 1} and will crash the SPV engine ` +
            `again: ${belowGuard.join(", ")}`
        : "",
    ).toEqual([]);
  });
});
