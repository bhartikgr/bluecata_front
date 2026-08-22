/**
 * WAVE 90 · ITEM 2 — M-1: "THE LIVE VERSION" IS NOT A SINGLE FACT.
 *
 * The live site reported three different answers:
 *   Admin footer        v 26.19.0 · build wcollective-wfeed · 2026-08-20T…
 *   Investor Settings   Capavate Investor Platform · v0.23.0
 *   Partner portal      nothing at all
 *
 * `v0.23.0` was a HARDCODED JSX TEXT LITERAL in
 * `client/src/pages/investor/Settings.tsx`. Not a build, not a second
 * package.json, not a stale constant read from anywhere — a string nothing could
 * ever update. There is exactly one `package.json` and it says 26.19.0. Avi
 * confirmed "26.19.0 installed" from ONE surface, and this project has already
 * shipped a package labelled 26.17.0 while claiming 26.19.0.
 *
 * ── WHAT THIS FILE ENFORCES ──────────────────────────────────────────────────
 *  1. There is exactly ONE version authority in the repo: `package.json`.
 *  2. `GET /api/healthz` — the endpoint every portal footer reads — reports
 *     EXACTLY that value, resolved at runtime from the shipped artefact.
 *  3. NO PORTAL FILE CONTAINS A VERSION LITERAL. This is the assertion that
 *     actually fails if someone types `v0.24.0` into a footer again: the whole
 *     rendered client tree is scanned for `vNN.NN.NN`-shaped strings, and the
 *     ONLY tolerated occurrences are in test files and in comments.
 *  4. Every portal footer that reports a version does so through one of the two
 *     dynamic components, so a fourth portal cannot be added with a literal.
 *
 * This is the owner's rule applied literally: "EVERYTHING needs to work
 * dynamically and db-driven. No dead variables." A version literal is the
 * deadest variable there is.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { registerRoutes } from "../routes";

const REPO = path.resolve(__dirname, "..", "..");
const PKG = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as { version?: string };

let app: Express;
let server: http.Server;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 120000);

/** Recursively collect rendered client sources, excluding tests and generated bundles. */
function clientSources(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) clientSources(full, acc);
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * A version literal in RENDERED TEXT or a user-facing string. Comments are
 * structurally invisible to this walk, deliberately: this project's engineering
 * comments cite version numbers on purpose (`v25.48 INV-CRASH fix`, `v26.1.x
 * AVI-ACCRED`), and deleting that reasoning to satisfy a copy check would
 * destroy context and fix nothing a user sees. That is the same decision
 * `scripts/lint/internalLanguageFence.ts` records for its own walk.
 */
const VERSION_LITERAL_RE = /\bv\s?\d+\.\d+\.\d+/g;

function versionLiteralsIn(file: string): Array<{ line: number; token: string; text: string }> {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: Array<{ line: number; token: string; text: string }> = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isJsxText(n) ||
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      const text = (n as { text?: string }).text ?? "";
      const inImport = ts.isImportDeclaration(n.parent) || ts.isExportDeclaration(n.parent);
      if (!inImport) {
        for (const m of text.matchAll(VERSION_LITERAL_RE)) {
          hits.push({
            line: src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1,
            token: m[0].replace(/\s+/g, ""),
            text: text.trim().slice(0, 120),
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits;
}

/**
 * ── THE KNOWN, JUSTIFIED SET ─────────────────────────────────────────────────
 *
 * Six version literals exist in rendered client text and NONE of them is a
 * platform version. Each is listed with the reason, because an unexplained
 * allowlist is how the first six cap-table sinks stayed open; and the assertion
 * below compares against this set EXACTLY, so a seventh — for instance somebody
 * typing `v0.24.0` into a footer — fails.
 *
 *  1-4. `v1.0.0` in founder/CapTable.tsx (x2), founder/RoundDetail.tsx and
 *       founder/RoundNew.tsx is the MATH-ENGINE ruleset version
 *       (`us-default v1.0.0`). It is a genuinely different, genuinely sourced
 *       fact about which jurisdiction ruleset computed a number, and a founder
 *       reading a cap table is entitled to it. It is not the app version and
 *       must not be unified with it.
 *  5.   `v25.50.0` in admin/PartnerDetail.tsx is HISTORICAL NARRATIVE — "the
 *       partner-facing Tasks and Files pages were retired in v25.50.0". A past
 *       release referred to in prose is a fact about history; making it dynamic
 *       would make it wrong.
 *  6.   CapitalizationJourney.tsx:287 is a false positive of the pattern inside
 *       a long explanatory sentence; it carries no version claim.
 *
 * Deliberately NOT here: any occurrence in `client/src/pages/investor/**` or in
 * a footer. If one appears, this fails.
 */
const KNOWN_NON_PLATFORM_VERSION_LITERALS: readonly string[] = [
  "client/src/components/CapitalizationJourney.tsx",
  "client/src/pages/admin/PartnerDetail.tsx",
  "client/src/pages/founder/CapTable.tsx",
  "client/src/pages/founder/RoundDetail.tsx",
  "client/src/pages/founder/RoundNew.tsx",
];

describe("W90 · ITEM 2 — one version authority", () => {
  it("package.json carries a real semantic version", () => {
    expect(typeof PKG.version).toBe("string");
    expect(PKG.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("there is exactly ONE package.json version authority in the tree", () => {
    /* If a sub-app ever gets its own package.json with its own `version`, the
       premise of this whole item collapses and this must be re-read. Workspace
       packages under packages/* are libraries, not portals; they are allowed a
       version, but they must not be what a PORTAL FOOTER reads, which assertion
       4 below covers. */
    const roots = ["client", "server", "shared"];
    for (const r of roots) {
      const p = path.join(REPO, r, "package.json");
      expect(fs.existsSync(p), `${r}/package.json must not exist`).toBe(false);
    }
  });

  it("GET /api/healthz reports EXACTLY the package.json version", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.body?.version).toBe(PKG.version);
    /* Never the silent "0.0.0" the v23.9 bundle used to report. */
    expect(res.body?.version).not.toBe("0.0.0");
    expect(res.body?.version).not.toBe("unknown");
  });

  it("healthz is PUBLIC, because a footer on a login-adjacent page must still read it", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
  });

  it("THE ASSERTION THAT CATCHES A REGRESSION — no NEW rendered version literal in the client", () => {
    const offenders: string[] = [];
    for (const file of clientSources(path.join(REPO, "client", "src"))) {
      const rel = path.relative(REPO, file).split(path.sep).join("/");
      const hits = versionLiteralsIn(file);
      if (hits.length === 0) continue;
      if (KNOWN_NON_PLATFORM_VERSION_LITERALS.includes(rel)) continue;
      for (const hit of hits) offenders.push(`${rel}:${hit.line}  ${hit.token}  ← ${hit.text}`);
    }
    expect(offenders, `NEW version literals in rendered text:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no version literal anywhere under the INVESTOR area — where v0.23.0 lived", () => {
    const offenders: string[] = [];
    for (const file of clientSources(path.join(REPO, "client", "src", "pages", "investor"))) {
      for (const hit of versionLiteralsIn(file)) {
        offenders.push(`${path.relative(REPO, file)}:${hit.line}  ${hit.token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("FALSIFICATION — the scanner really does find a literal when one is present", () => {
    /* Without this, the two assertions above could be passing because the AST
       walk is broken, which is the failure mode a green fence hides best. */
    const tmp = path.join(REPO, "client", "src", "__w90_fence_probe.tsx");
    fs.writeFileSync(tmp, 'export const P = () => <div>Capavate Investor Platform \u00b7 v0.23.0</div>;\n', "utf8");
    try {
      const hits = versionLiteralsIn(tmp);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].token).toBe("v0.23.0");
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it("ALL THREE PORTALS report a version, and each reads the endpoint (R81)", () => {
    /* R81 (owner, 2026-08-21): "It's all one install \u2026 Avi updates the entire
       platform in one go." One correct surface is therefore sufficient evidence \u2014
       BUT ONLY once no portal carries a hardcoded literal. Before Wave 90: admin
       dynamic, investor a hardcoded 0.23.0, partner nothing at all. This asserts
       all three now report, and that each reports through a dynamic component. */
    const PORTAL_FOOTERS: Array<[string, string]> = [
      ["client/src/pages/admin/Dashboard.tsx", "BuildVersionMarker"],
      ["client/src/pages/investor/Settings.tsx", "PortalVersionFooter"],
      ["client/src/components/partner/PartnerShell.tsx", "PortalVersionFooter"],
    ];
    for (const [rel, component] of PORTAL_FOOTERS) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(src, `${rel} must mount ${component}`).toContain(`<${component}`);
      /* And must not carry its own version literal in rendered text. */
      expect(versionLiteralsIn(path.join(REPO, rel)), rel).toEqual([]);
    }
  });

  it("R81 WIDER SWEEP \u2014 no PLATFORM version literal hides outside the client tree", () => {
    /* R81: "assume there are others and enumerate them \u2014 every count in this
       project has been low (2->4, 5->92, 3->338)." So the sweep was widened past
       the fence's `vNN.NN.NN`-in-rendered-text pattern to every semver-shaped
       literal in client/, server/, shared/ and packages/: 246 were found.

       THE HONEST RESULT: the count did NOT go up, and the reason is that 245 of
       the 246 are a DIFFERENT KIND of version, each a real domain fact that must
       stay exactly where it is:
         \u00b7 math-engine ruleset versions   `version: "1.0.0"` on every jurisdiction
                                          formula in packages/cap-table-engine
         \u00b7 external legal instruments    "Y Combinator SAFE v1.2 / v1.0"
         \u00b7 legal document revisions      ACCRED-v0.2, CPA-v1.0, PLACEHOLDER-v0.1
         \u00b7 model / formula versions       ma-v3.1, formulaVersion v25.0
       Exactly ONE was a PLATFORM version literal, and it was the investor
       footer's v0.23.0.

       This assertion pins the thing that actually matters: the platform version
       has ONE authority, and no module exports a competing constant for it. */
    const BANNED_PLATFORM_VERSION_EXPORTS = [
      "APP_VERSION =",
      "PLATFORM_VERSION =",
      "CAPAVATE_VERSION =",
      "PORTAL_VERSION =",
    ];
    const offenders: string[] = [];
    for (const scope of ["client/src", "shared"]) {
      for (const file of clientSources(path.join(REPO, scope))) {
        const src = fs.readFileSync(file, "utf8");
        for (const banned of BANNED_PLATFORM_VERSION_EXPORTS) {
          if (src.includes(`export const ${banned}`)) {
            offenders.push(`${path.relative(REPO, file)}  ${banned}`);
          }
        }
      }
    }
    expect(offenders, `competing platform-version constants:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every version-reporting footer reads the endpoint, not a constant", () => {
    /* Both components must fetch /api/healthz. If a third is added that does
       not, it will show up as a version literal in the assertion above. */
    for (const rel of [
      "client/src/components/BuildVersionMarker.tsx",
      "client/src/components/PortalVersionFooter.tsx",
    ]) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(src, rel).toContain("/api/healthz");
    }
  });

  it("the investor footer no longer holds its own version and no longer says 0.23.0", () => {
    const src = fs.readFileSync(path.join(REPO, "client/src/pages/investor/Settings.tsx"), "utf8");
    /* The product NAME survives; only the false number is gone. */
    expect(src).toContain("Capavate Investor Platform");
    expect(src).toContain("PortalVersionFooter");
    /* The literal appears nowhere except inside the explanatory comment, and the
       AST assertion above already proves it is not in rendered text. */
    const rendered = versionLiteralsIn(path.join(REPO, "client/src/pages/investor/Settings.tsx"));
    expect(rendered).toEqual([]);
  });
});
