/**
 * WAVE 4B — PT-5: the SCOPE FENCE.
 *
 * OWNER RULING: partner classification is "REPORTING AND FILTERING ONLY. All
 * partners see identical surfaces."
 *
 * That ruling is a sentence in a spec, and sentences in specs decay. The
 * predictable decay path is not a big decision — it is one innocent-looking
 * line, six months from now, in an auth guard:
 *
 *     if (partner.sectorSlug === "government_and_public_sector") { ... }
 *
 * At that moment "reporting only" has quietly become a permissions model, the
 * taxonomy becomes load-bearing for access, and retiring a sub-sector (which
 * an admin can now do from a web page, with no migration and no review) can
 * revoke someone's access. This lint makes that line fail CI instead.
 *
 * WHAT IT DOES
 *   Parses each FENCED file with the TypeScript compiler and reports any
 *   occurrence of a fenced name. AST-based, not regex: identifiers, property
 *   accesses, string literals, template chunks and JSX text are all checked,
 *   while COMMENTS ARE IGNORED — a comment explaining the fence (like the ones
 *   in this wave's guard-adjacent files) must not trip it.
 *
 * WHAT IS FENCED
 *   Names: sector_slug / sectorSlug, subsector_slug / subsectorSlug,
 *          partner_classifications / partnerClassifications,
 *          partner_sectors, partner_subsectors,
 *          and the classification store/route modules by import path.
 *   Files: auth guards, route guards, permission/authorization modules, and
 *          the client-side role/route-guard components.
 *
 * ESCAPE HATCH
 *   None by design. If a future wave genuinely needs classification inside a
 *   guard, that is a reversal of an owner ruling and belongs in a spec change
 *   that edits FENCED_GLOBS here — visibly, in a diff, with a reason.
 *
 * Run: npm run lint:classification-scope-fence
 * Also asserted by server/__tests__/wave4b_classification_scope_fence.test.ts
 */
import fs from "fs";
import path from "path";
import ts from "typescript";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * Files that decide WHO CAN REACH WHAT. Classification must not appear in any
 * of them. Listed explicitly rather than by glob so that adding a new guard
 * module is a deliberate act that also adds it to this fence.
 */
export const FENCED_FILES: string[] = [
  // ── server: authentication / authorization ──
  "server/lib/authMiddleware.ts",
  "server/lib/auth.ts",
  "server/lib/authRoutes.ts",
  "server/lib/secureAuthRoutes.ts",
  "server/lib/applyRouteGuards.ts",
  "server/lib/requirePartnerAuth.ts",
  "server/lib/tenantAuth.ts",
  "server/lib/maAuthzGate.ts",
  "server/lib/feeSettlementAuthority.ts",
  "server/lib/bridgeOutboundGuard.ts",
  // ── client: role + route guards and the nav that follows from them ──
  "client/src/components/RequireAuth.tsx",
  /* WAVE 7B DA-3 — PATH CORRECTION. These two entries used to read
     "client/src/components/role.tsx" and
     "client/src/components/useRequirePartnerRole.ts". Neither file has ever
     existed at those paths: the role provider is client/src/lib/role.tsx and
     the partner role hook is client/src/lib/partner/useRequirePartnerRole.ts.
     collectFencedPaths() skips any entry that does not exist on disk, so both
     lines were silently checking NOTHING while the lint reported success —
     the fence appeared to cover the client role layer and did not. */
  "client/src/lib/role.tsx",
  "client/src/lib/partner/useRequirePartnerRole.ts",
  /* Sibling of the hook above, still present in the tree and equally a
     partner-role gate. */
  "client/src/lib/useRequirePartnerRole.ts",
  /* WAVE 7B DA-3 — NAV. The owner ruling is that classification is
     "REPORTING AND FILTERING ONLY" and must never touch permissions, NAV or
     access. Permissions and access were fenced; nav was not. CollectiveShell
     is the sole producer of the partner and collective sidebars
     (PARTNER_WORKSPACE_GROUPS), so it is the exact file where a
     classification-conditional nav item would be written. */
  "client/src/components/CollectiveShell.tsx",
];

/**
 * Directories whose every .ts/.tsx file is fenced. Catches guard modules added
 * after this wave without anyone remembering to update FENCED_FILES.
 */
export const FENCED_DIRS: string[] = [
  "server/middleware",
  "server/permissions",
  "client/src/components/auth",
];

/** Case-insensitive substrings that must not appear in fenced code. */
export const FENCED_NAMES: string[] = [
  "sector_slug",
  "sectorslug",
  "subsector_slug",
  "subsectorslug",
  "partner_classifications",
  "partnerclassifications",
  "partner_sectors",
  "partnersectors",
  "partner_subsectors",
  "partnersubsectors",
  "partnerclassificationstore",
  "partnerclassificationroutes",
  "shared/partnerclassification",
];

export interface ScopeFenceViolation {
  file: string;
  line: number;
  column: number;
  name: string;
  text: string;
}

/**
 * WAVE 7B DA-3 — entries in FENCED_FILES that are not on disk.
 *
 * collectFencedPaths() skips missing files, which is the right runtime
 * behaviour (a file legitimately deleted must not break the lint) but a
 * dangerous silence: a typo'd or stale path checks nothing forever while the
 * lint keeps reporting success. Two of the three client entries were in
 * exactly that state until this wave. Exported so the proving test can assert
 * the list is empty, turning a silent hole into a loud failure.
 */
export function missingFencedFiles(): string[] {
  return FENCED_FILES.filter((rel) => !fs.existsSync(path.join(REPO_ROOT, rel)));
}

function collectFencedPaths(): string[] {
  const out: string[] = [];
  for (const rel of FENCED_FILES) {
    if (fs.existsSync(path.join(REPO_ROOT, rel))) out.push(rel);
  }
  for (const dir of FENCED_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path.relative(REPO_ROOT, p));
      }
    };
    walk(abs);
  }
  return Array.from(new Set(out)).sort();
}

function fencedNameIn(text: string): string | null {
  const hay = text.toLowerCase();
  for (const name of FENCED_NAMES) {
    if (hay.includes(name)) return name;
  }
  return null;
}

/**
 * Walks the AST and checks only nodes that carry CODE meaning. Comments are
 * never visited by `forEachChild`, so an explanatory comment is free.
 */
export function scanSource(relPath: string, source: string): ScopeFenceViolation[] {
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: ScopeFenceViolation[] = [];

  const report = (node: ts.Node, text: string) => {
    const name = fencedNameIn(text);
    if (!name) return;
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push({
      file: relPath,
      line: line + 1,
      column: character + 1,
      name,
      text: text.slice(0, 120),
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      report(node, node.text);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      report(node, node.text);
    } else if (ts.isJsxText(node)) {
      report(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return violations;
}

function scanFile(relPath: string): ScopeFenceViolation[] {
  return scanSource(relPath, fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8"));
}

export function runScopeFence(): { checked: string[]; violations: ScopeFenceViolation[] } {
  const checked = collectFencedPaths();
  const violations: ScopeFenceViolation[] = [];
  for (const rel of checked) violations.push(...scanFile(rel));
  return { checked, violations };
}

export function formatViolations(violations: ScopeFenceViolation[]): string {
  return violations
    .map(
      (v) =>
        `  ${v.file}:${v.line}:${v.column} — “${v.name}” in guard/permission code: ${v.text}`,
    )
    .join("\n");
}

/* ── CLI ────────────────────────────────────────────────────────────────── */
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).includes("partnerClassificationScopeFence");

if (invokedDirectly) {
  const { checked, violations } = runScopeFence();
  if (violations.length === 0) {
    console.log(
      `[scope-fence] OK — partner classification absent from ${checked.length} guard/permission file(s).`,
    );
    process.exit(0);
  }
  console.error(
    `[scope-fence] FAIL — partner classification leaked into guard/permission code.\n` +
      `Classification is REPORTING AND FILTERING ONLY (owner ruling). It must never gate access.\n` +
      formatViolations(violations),
  );
  process.exit(1);
}
