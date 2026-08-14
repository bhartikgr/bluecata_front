#!/usr/bin/env tsx
/**
 * scripts/reachability/reachability_gate.ts — WAVE 40 REACHABILITY GATE.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every gate in this repo measures EXISTENCE. None measured REACHABILITY, and
 * that is exactly how F-1 shipped: `SpvDetailTabs` renders 16 tabs, every one
 * of them present in source, guarded by the silent-drop guard's `tabs` class —
 * while the panel they live in sat inside a `role="button"` card whose
 * `onKeyDown` intercepted Enter/Space and UNMOUNTED the panel. Existence: 16/16.
 * Reachability: 1/16 by keyboard.
 *
 * THREE RULES, ALL STATIC, ALL FALSIFIABLE
 * ----------------------------------------
 *   R1 MOUNTED       Every React component declared under client/src/pages/**
 *                    or client/src/components/** is rendered as JSX somewhere in
 *                    client/src (or referenced from a JSX attribute expression,
 *                    e.g. `component={X}`), or is allowlisted with a reason.
 *                    `void X;` — the idiom this tree uses to silence an unused
 *                    declaration — deliberately does NOT count as a mount.
 *
 *   R2 TAB PAIRING   Every `<TabsContent value="X">` has a `<TabsTrigger>` that
 *                    resolves to X IN THE SAME FILE. Dynamically-built triggers
 *                    count: `value={t.key}` inside `ARRAY.map(...)` resolves to
 *                    every `key:` string literal of that array's object
 *                    literals. A trigger whose value cannot be resolved at all
 *                    is itself reported (R2-UNRESOLVED) — an unresolvable
 *                    trigger must never be able to launder an orphan panel.
 *
 *   R3 NESTING       No element with an interactive role (`role="button"`, or a
 *                    `<button>` / `<Button>` / `<a>` / `<Link>` tag) may CONTAIN
 *                    an interactive descendant (`role="tab"`, `<button>`,
 *                    `<Button>`, `<a>`, `<Link>`, `<input>`, `<Input>`,
 *                    `<Tabs*>`, …). ARIA gives a `button` PRESENTATIONAL
 *                    CHILDREN, so its subtree is flattened for assistive tech,
 *                    and — proven in Chromium for this wave — the ancestor's
 *                    keyboard handler swallows Enter/Space before the descendant
 *                    ever sees it. Components count as interactive when their
 *                    own declaration contains an interactive element (computed
 *                    to a fixpoint), which is what makes `<Card role="button">…
 *                    <SpvDetailTabs/></Card>` visible to a static gate.
 *                    `asChild` ancestors are exempt: Radix/shadcn `asChild`
 *                    MERGES props onto the single child instead of nesting a
 *                    second interactive element.
 *
 * BOTH POLES. This gate is only worth its runtime if it can go RED. See
 * build_log/WAVE40_REPORT.md for the planted-violation runs (one per rule) that
 * prove it fails, and the clean run that proves it passes.
 *
 * Usage:
 *   tsx scripts/reachability/reachability_gate.ts            # verify the tree
 *   tsx scripts/reachability/reachability_gate.ts --json
 *   tsx scripts/reachability/reachability_gate.ts --root <dir> --allowlist <f>
 *
 * Exit 0 = every rule satisfied. Exit 1 = at least one unallowlisted violation.
 * Exit 2 = the gate could not do its job (no files found, bad allowlist) — a
 * gate that finds nothing to check must FAIL, never pass quietly.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const __filename_ = fileURLToPath(import.meta.url);
const __dirname_ = path.dirname(__filename_);
const REPO_ROOT = path.resolve(__dirname_, "..", "..");

/* ── configuration ─────────────────────────────────────────────────────── */

/** Tags that are interactive on their own. */
const INTERACTIVE_TAGS = new Set([
  "button", "a", "input", "select", "textarea",
  "Button", "IconButton", "LinkButton", "Link", "Input", "Textarea", "Checkbox",
  "Switch", "Slider", "RadioGroupItem", "Select", "SelectTrigger",
  "Tabs", "TabsList", "TabsTrigger", "DropdownMenuTrigger", "PopoverTrigger",
  "DialogTrigger", "AccordionTrigger", "ToggleGroupItem", "Toggle",
]);

/** Roles that make an element a control in the accessibility tree. */
const INTERACTIVE_ROLES = new Set([
  "button", "link", "tab", "checkbox", "radio", "switch", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "textbox", "combobox",
  "slider", "spinbutton", "searchbox", "treeitem",
]);

/** Ancestor roles/tags that flatten their subtree (ARIA presentational children). */
const FLATTENING_TAGS = new Set(["button", "a", "Button", "IconButton", "LinkButton", "Link"]);
const FLATTENING_ROLES = new Set(["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"]);

interface AllowEntry { rule: string; id: string; reason: string; wave?: string; }
interface Violation { rule: string; id: string; detail: string; }

/* ── tiny helpers ──────────────────────────────────────────────────────── */

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function tagName(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  return open.tagName.getText(open.getSourceFile());
}

function attrs(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  return open.attributes.properties.filter(ts.isJsxAttribute);
}

/** Literal string value of an attribute, or undefined when it is not literal. */
function attrString(
  open: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): string | undefined {
  for (const a of attrs(open)) {
    if (a.name.getText(open.getSourceFile()) !== name) continue;
    const init = a.initializer;
    if (!init) return "";
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteral(init.expression)) {
      return init.expression.text;
    }
    return undefined; /* present but not a literal */
  }
  return undefined;
}

function hasAttr(open: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): boolean {
  return attrs(open).some((a) => a.name.getText(open.getSourceFile()) === name);
}

function openOf(node: ts.Node): ts.JsxOpeningElement | ts.JsxSelfClosingElement | null {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

function containsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function rel(p: string, root: string): string {
  return path.relative(root, p).split(path.sep).join("/");
}

/* ── declarations ──────────────────────────────────────────────────────── */

interface Decl {
  name: string;
  file: string;      /* repo-relative */
  node: ts.Node;     /* the declaration node, for self-reference exclusion */
  start: number;
  end: number;
  isDefaultExport?: boolean;
}

/**
 * IMPORT RESOLUTION — why R1 cannot work by bare name.
 *
 * `client/src/pages/investor/Profile.tsx` default-exports `Profile`, and
 * App.tsx imports it as `InvestorProfile`. A name-only usage check calls that
 * page unmounted, which is a false positive of exactly the kind this repo's
 * handover warns about ("a check that passed while checking nothing" has a twin:
 * a check that fails while checking the wrong thing). So every JSX tag is
 * resolved through the importing file's own import bindings to a (file,
 * exportName) pair, and matched against the declaration site.
 */
function resolveSpecifier(fromFile: string, spec: string, root: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = path.join(root, "client", "src", spec.slice(2));
  else if (spec.startsWith("@shared/")) base = path.join(root, "shared", spec.slice("@shared/".length));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(path.join(root, fromFile)), spec);
  if (!base) return null;
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return rel(cand, root);
  }
  return null;
}

interface Binding { file: string; exportName: string; }

function collectImports(sf: ts.SourceFile, relFile: string, root: string): Map<string, Binding> {
  const out = new Map<string, Binding>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const target = resolveSpecifier(relFile, st.moduleSpecifier.text, root);
    if (!target || !st.importClause) continue;
    if (st.importClause.name) out.set(st.importClause.name.text, { file: target, exportName: "default" });
    const nb = st.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        out.set(el.name.text, { file: target, exportName: (el.propertyName ?? el.name).text });
      }
    }
  }
  return out;
}

function declKey(d: Decl): string {
  return `${d.file}\t${d.name}`;
}

function collectDeclarations(sf: ts.SourceFile, relFile: string): Decl[] {
  const out: Decl[] = [];
  const push = (name: string, node: ts.Node, isDefault: boolean) => {
    if (!/^[A-Z]/.test(name)) return;
    if (!containsJsx(node)) return;
    out.push({ name, file: relFile, node, start: node.getStart(sf), end: node.getEnd(), isDefaultExport: isDefault });
  };
  const isDefaultExported = (st: ts.Node): boolean =>
    ts.canHaveModifiers(st) &&
    (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  const defaultNames = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isExportAssignment(st) && !st.isExportEquals && ts.isIdentifier(st.expression)) {
      defaultNames.add(st.expression.text);
    }
  }
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) {
      push(st.name.text, st, isDefaultExported(st) || defaultNames.has(st.name.text));
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        /* Only FUNCTION-shaped initialisers are components. `const
           HOLDINGS_HEADERS = [<th/>, …]` is a JSX-carrying data table, not a
           component, and reporting it would be a false positive. */
        const init = d.initializer;
        const fnShaped =
          !!init &&
          (ts.isArrowFunction(init) ||
            ts.isFunctionExpression(init) ||
            (ts.isCallExpression(init) &&
              /^(React\.)?(forwardRef|memo)$/.test(init.expression.getText(sf))));
        if (ts.isIdentifier(d.name) && fnShaped) {
          push(d.name.text, st, isDefaultExported(st) || defaultNames.has(d.name.text));
        }
      }
    }
  }
  return out;
}

/* ── main analysis ─────────────────────────────────────────────────────── */

export interface GateResult {
  ok: boolean;
  counts: {
    files: number;
    declarations: number;
    tabPanels: number;
    tabTriggers: number;
    interactiveAncestors: number;
  };
  violations: Violation[];
  allowlistedHits: string[];
  staleAllowlist: string[];
}

export function runGate(root: string, allowlist: AllowEntry[]): GateResult {
  const clientSrc = path.join(root, "client", "src");
  const files = walkFiles(clientSrc);
  const violations: Violation[] = [];

  /* ---------- pass 1: parse everything once ----------

     WAVE 41 — TEST FILES ARE EXCLUDED HERE, AND THIS IS A BUG FIX, NOT TIDYING.

     Before this change, only the R1 DECLARATION pass skipped `/__tests__/`; the
     JSX USAGE pass below walked every parsed file, tests included. Follow what
     that did to a render inside a test: `enclosing(pos)` looks for a declaration
     from THIS file that spans the position, but the test file contributed no
     declarations (it was skipped above), so it returned `null` — and `addEdge`
     treats a `null` parent as A ROOT MOUNT. So any component rendered anywhere in
     any test was marked root-mounted and could never be reported by R1.

     THE PROOF THAT THIS WAS ACTIVELY HIDING A REAL DEFECT, not a theoretical
     hole. Wave 41 was sent to mount four orphaned founder components. Three of
     them — SettingsPreferencesTab, SettingsGovernanceTab, SettingsMnaPrepTab —
     were duly reported by R1. The fourth, SettingsFinancialsTab, was NOT, despite
     being equally unmounted, because
     client/src/pages/founder/__tests__/wave35_percent_round_trip.test.tsx:118
     renders it in JSX. The gate was reporting 3 of 4 identical defects and
     calling the tree consistent. A gate whose result depends on whether someone
     happened to write a unit test for the orphan is not measuring reachability.

     It is also the exact failure mode this build has already paid for repeatedly:
     a check that passes while checking nothing. Worse than a false negative, it
     rewards the pattern — write a test that renders the dead component and the
     gate goes quiet, while the browser still cannot reach it.

     Excluded consistently for ALL rules rather than only R1, because the same
     reasoning holds for R2 and R3: a <TabsContent> or a nested <Button> that
     exists only in a test fixture is not a surface a user can reach or mis-click,
     and reporting it would push maintainers toward allowlisting noise — which
     dilutes the allowlist into the graveyard it must not become. */
  const isTestFile = (relFile: string) =>
    relFile.includes("/__tests__/") ||
    /\.(test|spec)\.tsx$/.test(relFile) ||
    relFile.includes("/test-utils/");
  const parsed = files
    .map((f) => ({ file: f, relFile: rel(f, root), sf: parse(f) }))
    .filter((p) => !isTestFile(p.relFile));

  /* ---------- R1: declarations and JSX usage ---------- */
  const decls: Decl[] = [];
  for (const p of parsed) {
    const r = p.relFile;
    if (!r.startsWith("client/src/pages/") && !r.startsWith("client/src/components/")) continue;
    /* `isTestFile` already removed these from `parsed` above; the check is kept
       so this pass stays correct if it is ever fed an unfiltered list again. */
    if (isTestFile(r)) continue;
    /* R1 SCOPE — `client/src/components/ui/**` is the vendored shadcn/Radix
       primitive library. Its exports exist to be IMPORTED by product code; an
       unused primitive (`CarouselNext`, `BreadcrumbEllipsis`, …) is dead vendor
       code, not an unreachable product surface, and listing 150+ of them would
       bury the six real findings this rule exists to surface. They remain in
       scope for R2 and R3, which is where a primitive can actually strand a
       product surface. */
    if (r.startsWith("client/src/components/ui/")) continue;
    decls.push(...collectDeclarations(p.sf, r));
  }
  const declsByFile = new Map<string, Decl[]>();
  for (const d of decls) {
    const arr = declsByFile.get(d.file) ?? [];
    arr.push(d);
    declsByFile.set(d.file, arr);
  }

  /**
   * R1 IS A REACHABILITY RULE, NOT A "IS IT REFERENCED" RULE.
   *
   * "Used somewhere" is not enough: `PrivacyControls` in founder/Settings.tsx is
   * rendered — by `SettingsPreferencesTab`, which is itself rendered nowhere. A
   * reference-counting rule calls both mounted; the surface is still dead in the
   * browser. So mounts are propagated transitively from ROOTS: a use site that
   * is not inside any component declaration in scope (i.e. App.tsx's route
   * elements, main.tsx, provider wiring in lib/) is a root mount, and
   * reachability is the closure of decl → decl render edges from there.
   */
  /** declKey -> root-mounted? */
  const rootMounted = new Set<string>();
  /** declKey -> declKeys it renders. */
  const edges = new Map<string, Set<string>>();
  /** All resolved use keys, for diagnostics. */
  const addEdge = (from: string | null, toKeys: string[]) => {
    for (const to of toKeys) {
      if (from === null) rootMounted.add(to);
      else {
        if (from === to) continue; /* self-recursion is not a mount */
        const s = edges.get(from) ?? new Set<string>();
        s.add(to);
        edges.set(from, s);
      }
    }
  };

  /** Component -> does its own body contain an interactive element (direct)? */
  const declInteractiveDirect = new Map<string, boolean>();
  /** Component -> component tags it renders (for the fixpoint). */
  const declRenders = new Map<string, Set<string>>();

  let tabPanels = 0;
  let tabTriggers = 0;
  let interactiveAncestors = 0;

  for (const p of parsed) {
    const sf = p.sf;
    const relFile = p.relFile;

    /* JSX usage collection (R1) — resolved through this file's imports. */
    const imports = collectImports(sf, relFile, root);
    const declsHere = declsByFile.get(relFile) ?? [];
    const enclosing = (pos: number): string | null => {
      for (const d of declsHere) if (pos >= d.start && pos < d.end) return declKey(d);
      return null;
    };
    const useName = (name: string, pos: number) => {
      const targets: string[] = [];
      const b = imports.get(name);
      if (b) {
        /* `default` is resolved to the declaring file's default-exported decl. */
        if (b.exportName === "default") {
          const d = (declsByFile.get(b.file) ?? []).find((x) => x.isDefaultExport);
          if (d) targets.push(declKey(d));
        } else {
          const d = (declsByFile.get(b.file) ?? []).find((x) => x.name === b.exportName);
          if (d) targets.push(declKey(d));
        }
      } else {
        const d = declsHere.find((x) => x.name === name);
        if (d) targets.push(declKey(d));
      }
      if (targets.length) addEdge(enclosing(pos), targets);
    };
    const visitUse = (n: ts.Node) => {
      const open = openOf(n);
      if (open) {
        const tag = tagName(open);
        const base = tag.split(".")[0];
        if (/^[A-Z]/.test(base)) useName(base, open.getStart(sf));
        /* identifiers inside attribute expressions: component={X}, render={X} */
        for (const a of attrs(open)) {
          const init = a.initializer;
          if (init && ts.isJsxExpression(init) && init.expression) {
            const visitId = (m: ts.Node) => {
              if (ts.isIdentifier(m) && /^[A-Z]/.test(m.text)) useName(m.text, m.getStart(sf));
              ts.forEachChild(m, visitId);
            };
            visitId(init.expression);
          }
        }
      }
      ts.forEachChild(n, visitUse);
    };
    visitUse(sf);

    /* ---------- R2: tab pairing, per file ---------- */
    const panelValues: Array<{ value: string; pos: number }> = [];
    const triggerLiterals = new Set<string>();
    const dynamicTriggerProps: string[] = [];
    let unresolvedTriggers = 0;

    const visitTabs = (n: ts.Node) => {
      const open = openOf(n);
      if (open) {
        const tag = tagName(open);
        if (tag === "TabsContent" || tag === "TabPanel") {
          const v = attrString(open, "value");
          tabPanels++;
          if (v === undefined) {
            /* dynamic panel — pairing is unverifiable; report it. */
            violations.push({
              rule: "R2-DYNAMIC-PANEL",
              id: `${relFile}\tTabsContent\tline=${sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1}`,
              detail: "TabsContent value is not a string literal, so its trigger cannot be verified",
            });
          } else {
            panelValues.push({ value: v, pos: open.getStart(sf) });
          }
        } else if (tag === "TabsTrigger") {
          tabTriggers++;
          const v = attrString(open, "value");
          if (v !== undefined) triggerLiterals.add(v);
          else {
            /* `value={t.key}` — remember the property name for array resolution. */
            const attr = attrs(open).find((a) => a.name.getText(sf) === "value");
            const init = attr?.initializer;
            let prop: string | null = null;
            if (init && ts.isJsxExpression(init) && init.expression && ts.isPropertyAccessExpression(init.expression)) {
              prop = init.expression.name.text;
            }
            if (prop) dynamicTriggerProps.push(prop);
            else unresolvedTriggers++;
          }
        }
      }
      ts.forEachChild(n, visitTabs);
    };
    visitTabs(sf);

    /* Resolve dynamic triggers: every string literal assigned to that property
       in any object literal in the file. Deliberately generous on the TRIGGER
       side and strict on the PANEL side — the failure mode we are gating is an
       orphan panel, and over-collecting trigger keys can only hide a violation
       we would otherwise report, never invent one. Unresolvable triggers are
       reported separately so the generosity is always visible. */
    if (dynamicTriggerProps.length) {
      const props = new Set(dynamicTriggerProps);
      const visitObj = (n: ts.Node) => {
        if (ts.isPropertyAssignment(n) && n.name) {
          const nm = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : null;
          if (nm && props.has(nm) && ts.isStringLiteral(n.initializer)) triggerLiterals.add(n.initializer.text);
        }
        ts.forEachChild(n, visitObj);
      };
      visitObj(sf);
    }
    if (unresolvedTriggers > 0) {
      violations.push({
        rule: "R2-UNRESOLVED",
        id: `${relFile}\tTabsTrigger\tunresolved=${unresolvedTriggers}`,
        detail: "TabsTrigger value is neither a literal nor a resolvable property access",
      });
    }
    for (const p2 of panelValues) {
      if (!triggerLiterals.has(p2.value)) {
        violations.push({
          rule: "R2",
          id: `${relFile}\tTabsContent\tvalue=${p2.value}`,
          detail: `no TabsTrigger in the same file resolves to "${p2.value}" — the panel is unreachable`,
        });
      }
    }

    /* ---------- R3: interactive nesting, per file ---------- */
    /* Also, while here, record per-declaration interactivity for the fixpoint. */
    const fileDecls = decls.filter((d) => d.file === relFile);
    const declFor = (pos: number): string | null => {
      for (const d of fileDecls) {
        if (pos >= d.start && pos < d.end) return `${d.file}\t${d.name}`;
      }
      return null;
    };

    const visitNest = (n: ts.Node, ancestors: Array<{ tag: string; role: string | undefined; pos: number }>) => {
      const open = openOf(n);
      let nextAncestors = ancestors;
      if (open) {
        const tag = tagName(open);
        const role = attrString(open, "role");
        const dk = declFor(open.getStart(sf));
        if (dk) {
          if (INTERACTIVE_TAGS.has(tag) || (role !== undefined && INTERACTIVE_ROLES.has(role))) {
            declInteractiveDirect.set(dk, true);
          }
          if (/^[A-Z]/.test(tag.split(".")[0])) {
            const s = declRenders.get(dk) ?? new Set<string>();
            s.add(tag.split(".")[0]);
            declRenders.set(dk, s);
          }
        }

        const flattening =
          !hasAttr(open, "asChild") &&
          (FLATTENING_TAGS.has(tag) || (role !== undefined && FLATTENING_ROLES.has(role)));

        /* is this element interactive *as a descendant*? */
        const isInteractive =
          INTERACTIVE_TAGS.has(tag) || (role !== undefined && INTERACTIVE_ROLES.has(role));
        const componentTag = /^[A-Z]/.test(tag) && !INTERACTIVE_TAGS.has(tag) ? tag : null;

        if (ancestors.length > 0 && (isInteractive || componentTag)) {
          const a = ancestors[ancestors.length - 1];
          if (isInteractive) {
            violations.push({
              rule: "R3",
              id: `${relFile}\t${a.tag}${a.role ? `[role=${a.role}]` : ""}\t>\t${tag}`,
              detail:
                `line ${sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1}: an interactive ` +
                `<${tag}> is nested inside <${a.tag}${a.role ? ` role="${a.role}"` : ""}> ` +
                `(line ${sf.getLineAndCharacterOfPosition(a.pos).line + 1})`,
            });
          } else if (componentTag) {
            /* deferred: resolved after the fixpoint, recorded as a candidate */
            candidates.push({
              relFile,
              ancestorTag: a.tag,
              ancestorRole: a.role,
              ancestorLine: sf.getLineAndCharacterOfPosition(a.pos).line + 1,
              childTag: componentTag,
              childLine: sf.getLineAndCharacterOfPosition(open.getStart(sf)).line + 1,
            });
          }
        }

        if (flattening) {
          interactiveAncestors++;
          nextAncestors = [...ancestors, { tag, role, pos: open.getStart(sf) }];
        }
      }
      ts.forEachChild(n, (c) => visitNest(c, nextAncestors));
    };

    visitNest(sf, []);
  }

  /* ---------- R1 evaluation: transitive closure from root mounts ---------- */
  const reachable = new Set<string>(rootMounted);
  const queue = Array.from(rootMounted);
  while (queue.length) {
    const k = queue.shift()!;
    for (const nxt of edges.get(k) ?? []) {
      if (!reachable.has(nxt)) {
        reachable.add(nxt);
        queue.push(nxt);
      }
    }
  }
  for (const d of decls) {
    if (!reachable.has(declKey(d))) {
      violations.push({
        rule: "R1",
        id: `${d.file}\t${d.name}`,
        detail:
          "declared React component is not reachable from any root mount " +
          "(never rendered, or rendered only by another unreachable component)",
      });
    }
  }

  /* ---------- R3 fixpoint: which components contain an interactive element ---------- */
  const interactive = new Map<string, boolean>();
  for (const [k, v] of declInteractiveDirect) interactive.set(k, v);
  const byName = new Map<string, string[]>();
  for (const d of decls) {
    const k = `${d.file}\t${d.name}`;
    const arr = byName.get(d.name) ?? [];
    arr.push(k);
    byName.set(d.name, arr);
  }
  let changed = true;
  let rounds = 0;
  while (changed && rounds < 20) {
    changed = false;
    rounds++;
    for (const [k, kids] of declRenders) {
      if (interactive.get(k)) continue;
      for (const kid of kids) {
        const targets = byName.get(kid) ?? [];
        if (INTERACTIVE_TAGS.has(kid) || targets.some((t) => interactive.get(t))) {
          interactive.set(k, true);
          changed = true;
          break;
        }
      }
    }
  }

  for (const c of candidates) {
    const targets = byName.get(c.childTag) ?? [];
    const isInt = INTERACTIVE_TAGS.has(c.childTag) || targets.some((t) => interactive.get(t));
    if (!isInt) continue;
    violations.push({
      rule: "R3",
      id: `${c.relFile}\t${c.ancestorTag}${c.ancestorRole ? `[role=${c.ancestorRole}]` : ""}\t>\t${c.childTag}`,
      detail:
        `line ${c.childLine}: <${c.childTag}> renders interactive controls and is nested inside ` +
        `<${c.ancestorTag}${c.ancestorRole ? ` role="${c.ancestorRole}"` : ""}> (line ${c.ancestorLine})`,
    });
  }

  /* ---------- allowlist ---------- */
  const allowKeys = new Set(allowlist.map((a) => `${a.rule}\u0000${a.id}`));
  const hits: string[] = [];
  const remaining: Violation[] = [];
  const seen = new Set<string>();
  for (const v of violations) {
    if (!v.rule) continue;
    const k = `${v.rule}\u0000${v.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (allowKeys.has(k)) hits.push(k);
    else remaining.push(v);
  }
  const stale = Array.from(allowKeys).filter((k) => !seen.has(k));

  return {
    ok: remaining.length === 0 && stale.length === 0 && files.length > 0,
    counts: {
      files: files.length,
      declarations: decls.length,
      tabPanels,
      tabTriggers,
      interactiveAncestors,
    },
    violations: remaining,
    allowlistedHits: hits,
    staleAllowlist: stale,
  };
}

/* R3 candidates are collected across files, so the array lives at module scope
   for the single run. `runGate` resets it. */
interface Candidate {
  relFile: string;
  ancestorTag: string;
  ancestorRole: string | undefined;
  ancestorLine: number;
  childTag: string;
  childLine: number;
}
let candidates: Candidate[] = [];

/* ── CLI ───────────────────────────────────────────────────────────────── */

function loadAllowlist(file: string): AllowEntry[] {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { entries?: AllowEntry[] };
  const entries = raw.entries ?? [];
  for (const e of entries) {
    if (!e.rule || !e.id || !e.reason || !e.reason.trim()) {
      throw new Error(`allowlist entry missing rule/id/reason: ${JSON.stringify(e)}`);
    }
  }
  return entries;
}

function main(argv: string[]): number {
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1]) : REPO_ROOT;
  const alIdx = argv.indexOf("--allowlist");
  const alPath = alIdx >= 0 ? path.resolve(argv[alIdx + 1]) : path.join(__dirname_, "allowlist.json");
  const json = argv.includes("--json");

  candidates = [];
  let res: GateResult;
  try {
    res = runGate(root, loadAllowlist(alPath));
  } catch (e) {
    console.error(`REACHABILITY GATE — could not run: ${(e as Error).message}`);
    return 2;
  }

  if (json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    const c = res.counts;
    console.log(
      `reachability: ${c.files} client .tsx files · ${c.declarations} component declarations · ` +
        `${c.tabPanels} tab panels · ${c.tabTriggers} tab triggers · ${c.interactiveAncestors} interactive-role ancestors`,
    );
    console.log(`allowlist: ${res.allowlistedHits.length} entr(y/ies) matched`);
    if (res.staleAllowlist.length) {
      console.log("");
      console.log(`STALE ALLOWLIST — ${res.staleAllowlist.length} entr(y/ies) no longer correspond to a violation:`);
      for (const s of res.staleAllowlist) console.log(`   - ${s.replace("\u0000", " :: ").replace(/\t/g, " | ")}`);
    }
    if (res.violations.length) {
      console.log("");
      console.log(`REACHABILITY VIOLATIONS — ${res.violations.length}`);
      const byRule = new Map<string, Violation[]>();
      for (const v of res.violations) {
        const arr = byRule.get(v.rule) ?? [];
        arr.push(v);
        byRule.set(v.rule, arr);
      }
      for (const [ruleName, vs] of Array.from(byRule.entries()).sort()) {
        console.log("");
        console.log(`[${ruleName}] ${vs.length}`);
        for (const v of vs) console.log(`   - ${v.id.replace(/\t/g, " | ")}\n     ${v.detail}`);
      }
      console.log("");
      console.log("Resolve by MAKING THE SURFACE REACHABLE (preferred), or by adding an entry to");
      console.log(`${path.relative(root, alPath)} with a written reason. An entry without a reason is rejected.`);
    }
  }
  if (res.counts.files === 0) {
    console.error("REACHABILITY GATE — no client/src/**/*.tsx files found; refusing to report success.");
    return 2;
  }
  return res.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename_)) {
  process.exit(main(process.argv.slice(2)));
}
