/**
 * WAVE 80 · ITEM 1 — A WHOLE-TREE FENCE FOR INTERNAL-PROCESS COPY.
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AS A FENCE AND NOT A ONE-OFF SWEEP. The owner's ruling (Q25)
 * is *"I don't want any exposure of our internal process. This needs to be
 * investor grade and professional."* He was told there were TWO leaks. An
 * independent audit proved at least 24 — that count was wrong by an order of
 * magnitude because the earlier sweep looked at server refusal strings and
 * generalised. A one-off cleanup would be wrong again the moment the next wave
 * writes `Sprint 33` into a hint, so the rule is enforced continuously here.
 *
 * WHAT IT MEASURES. Every StringLiteral, template-literal chunk and JsxText node
 * in every non-test file under `client/src`, taken from the TypeScript AST so
 * COMMENTS ARE EXCLUDED EXACTLY. Comments are not rendered, and this project's
 * comments deliberately record what was removed; a `grep` fence would fail on its
 * own evidence.
 *
 * WHAT IS DELIBERATELY EXEMPT, with the reason stated per entry rather than as a
 * blanket. The brief names three exemptions — `data-testid` attributes, API route
 * strings and the admin **Migration** tool, which is a real feature name — and
 * Wave 80 adds two measured ones below. Each exemption is narrow and each is
 * justified; a new exemption is a decision someone has to write down here.
 *
 * IF THIS FENCE GOES RED, a rendered surface has started naming this project's
 * own delivery process, source files, migrations or owner rulings to a customer.
 * The fix is to state the RULE or the BEHAVIOUR instead (R44), not to widen the
 * exemption list.
 *
 * MUTATION TRANSCRIPT: build_log/wave80/W80_TESTS.md.
 * ENUMERATION:         build_log/wave80/W80_COPY_ENUMERATION.md.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

const ROOT = path.resolve(__dirname, "../../../..");
const CLIENT_SRC = path.join(ROOT, "client", "src");

type Hit = { file: string; line: number; pattern: string; match: string; text: string };

/** The patterns that name internal process rather than product behaviour. */
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["owner-ruling-id", /R\d{2,3}\s*§\s*\d+/],
  ["owner-ruling-ref", /per R\d{2,3}\b|under R\d{2,3}\b/],
  ["owner-ruling-word", /owner ruling|owner-ruling/i],
  ["sprint", /\bSprint\s*\d+/],
  ["wave", /\bWAVE\s*\d+|\bWave\s*\d+/],
  ["slice", /\bSlice\s*\d+/],
  ["sacred", /SACRED/],
  ["source-file", /(?:server|client|shared|scripts|migrations)\/[A-Za-z0-9_./-]*\.(?:ts|tsx|mjs|js|sql)/],
  ["migration-number", /\bmigrations?\s*0\d{3}\b|\b0[01]\d{2}_[a-z0-9_]+/],
  ["adapter-internals", /in-process adapter state/],
  ["deploy-gated", /deploy-gated/],
  ["decision-code", /\bD\d(?:\.\d)*\s*R\d\b/],
  ["ticket-code", /\bFE-\d+\b|\bEN-\d+\b|\bDEF-\d+\b/],
  ["coming-with", /Coming with\b/],
  ["stub-admission", /\bstubbed\b/],
  ["read-only-mirror", /READ-ONLY mirror/],
];

/**
 * EXEMPTIONS. Narrow, measured, and each one justified on its own line. This list
 * is the decision record; growing it is a decision, not a convenience.
 */
const EXEMPT: ReadonlyArray<{ file: string; why: string }> = [
  {
    /* MEASURED: `MfcrmGate.source` is a code-documentation field. `gateRefusalText`
       — the ONE function that turns a gate into user-visible copy — builds its
       sentence from `capabilityLabel(gate.key)` and never reads `.source`, and no
       `.tsx` under `client/src` reads it either. Nothing a partner sees contains it.
       Left in place rather than deleted: it is the only record of where each gate is
       enforced, and the owner's rule is "I'd rather add than delete". */
    file: "client/src/lib/partner/mfcrmPersona.ts",
    why: "MfcrmGate.source is never rendered — gateRefusalText builds copy from the capability label only",
  },
  {
    /* MEASURED: `SPRINT_BANNER` is an exported constant with ZERO consumers anywhere
       in `client/src` or `server/`. It renders on no screen. Left rather than deleted
       for the same reason; if it is ever imported, this fence must be revisited. */
    file: "client/src/lib/sprint-banner.ts",
    why: "SPRINT_BANNER is an unused export with no consumer — it renders nowhere",
  },
];

const EXEMPT_FILES = new Set(EXEMPT.map((e) => e.file));

/** Contexts that are never rendered copy, plus the brief's own three exemptions. */
const EXEMPT_ATTRS = new Set([
  "data-testid", "className", "key", "id", "value", "name", "type",
  "htmlFor", "href", "to", "src", "path", "variant", "size", "role", "placeholder-route",
]);
/** A text node that is ONLY a route path is an API route string, not copy. */
const ROUTE_ONLY = /^\/(?:api|admin|founder|investor|partner|collective)[A-Za-z0-9_/:.\-${}[\]]*$/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules") walk(p, acc);
      continue;
    }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/\.(test|spec)\./.test(e.name)) continue;
    acc.push(p);
  }
  return acc;
}

function sweep(): Hit[] {
  const hits: Hit[] = [];
  for (const abs of walk(CLIENT_SRC)) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (EXEMPT_FILES.has(rel)) continue;
    const code = fs.readFileSync(abs, "utf8");
    const sf = ts.createSourceFile(
      abs, code, ts.ScriptTarget.Latest, true,
      abs.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (n: ts.Node): void => {
      let text: string | null = null;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = (n as ts.TemplateHead).text;
      else if (ts.isJsxText(n)) text = n.text;
      if (text !== null && text.trim().length > 0) {
        const flat = text.replace(/\s+/g, " ").trim();
        const par = n.parent as ts.Node | undefined;
        const attrName =
          par && ts.isJsxAttribute(par) ? par.name.getText(sf)
          : par && par.parent && ts.isJsxAttribute(par.parent) ? par.parent.name.getText(sf)
          : null;
        const isImport = par !== undefined && (ts.isImportDeclaration(par) || ts.isExportDeclaration(par));
        if (!isImport && !(attrName && EXEMPT_ATTRS.has(attrName)) && !ROUTE_ONLY.test(flat)) {
          for (const [name, rx] of PATTERNS) {
            const m = rx.exec(flat);
            if (m) {
              /* THE ADMIN MIGRATION TOOL IS A REAL FEATURE NAME, exempted by the
                 brief. Only the bare feature word is exempt: an actual migration
                 NUMBER on any screen is still a hit. */
              if (/^migration/i.test(m[0]) && !/\d/.test(m[0])) continue;
              const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
              hits.push({ file: rel, line: line + 1, pattern: name, match: m[0], text: flat.slice(0, 200) });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(sf, visit);
  }
  return hits;
}

describe("WAVE 80 · ITEM 1 — no internal process in rendered client copy", () => {
  it("the sweep actually looks at the tree it claims to (not a vacuous pass)", () => {
    const files = walk(CLIENT_SRC);
    /* If this number collapses, the fence has stopped measuring and its green is
       meaningless. The audit's own scope was 427 TSX files; this walk includes
       `.ts` as well, so it must be at least that. */
    expect(files.length).toBeGreaterThan(400);
  });

  it("every exemption still refers to a file that exists, so the list cannot rot", () => {
    for (const e of EXEMPT) {
      expect(fs.existsSync(path.join(ROOT, e.file)), `${e.file} (${e.why})`).toBe(true);
    }
  });

  it("ZERO internal-process strings render anywhere in client/src", () => {
    const hits = sweep();
    const report = hits
      .map((h) => `  ${h.file}:${h.line} [${h.pattern}] «${h.match}» in: ${h.text}`)
      .join("\n");
    expect(hits.length, `internal-process copy found:\n${report}`).toBe(0);
  });
});
