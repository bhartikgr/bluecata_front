/* v25.43 F8 — E2E: NV/AC/HL/QF "mystery branding" removed app-wide.
 *
 * Ozan approved the full app-wide removal of the "TRUSTED BY FOUNDERS AND
 * INVESTORS AT" monogram block (the NV / AC / HL / QF placeholder badges and
 * their Nova Ventures / Atlas Capital / Helio Labs / Quanta Founders labels)
 * with NO replacement panel.
 *
 * This test walks every .ts/.tsx file under client/src AND server/ (excluding
 * node_modules, server/public, dist, and this test file itself) and asserts
 * ZERO matches for the monogram tokens and the placeholder partner names.
 * (Comments + the stale AuthShell test were reworded so they no longer
 * contain the tokens either.)
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(__dirname, "../../client/src");
const SERVER_DIR = resolve(__dirname, "..");
const SELF = fileURLToPath(import.meta.url);

// Directories/files to skip entirely when walking server/: build outputs and
// vendored deps are not hand-authored source, and this test file itself
// legitimately contains the tokens in its regexes/docstring.
const SKIP_DIRS = new Set(["node_modules", "public", "dist"]);

function walk(dir, { skipDirs = new Set() } = {}) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (skipDirs.has(entry)) continue;
      out.push(...walk(full, { skipDirs }));
    } else if (/\.(ts|tsx)$/.test(entry) && full !== SELF) {
      out.push(full);
    }
  }
  return out;
}

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

// The trust-grid monograms appeared as quoted string literals in the badge
// array (e.g. `mono: "NV"`, `"AC"`, `"HL"`, `"QF"`). We match the quoted-token
// form so unrelated prose like "Group AC" in comments never trips the check —
// the brief's removal target is the mystery-branding badge data, not every
// two-letter token in the codebase.
const MONOGRAM = /["'](NV|AC|HL|QF)["']/;
const PARTNER_NAMES = /(Nova Ventures|Atlas Capital|Helio Labs|Quanta Founders)/;
const TRUST_GRID = /(auth-shell-trust-grid|auth-shell-trust-badge)/;

describe("v25.43 F8 — NV/AC/HL/QF mystery branding removed app-wide", () => {
  // Scan client/src (all .ts/.tsx) plus server/ (excluding node_modules,
  // server/public stale bundles, dist, and this test file itself).
  const files = [...walk(CLIENT_SRC), ...walk(SERVER_DIR, { skipDirs: SKIP_DIRS })];

  // Monogram literals + trust-grid testids are about RENDERED UI. Test files
  // (.test.ts / _e2e.mjs) legitimately reference these tokens in *negative*
  // assertions (e.g. `expect(src).not.toMatch(/auth-shell-trust-grid/)`), so
  // those checks exclude test files. The placeholder partner NAMES, however,
  // must not appear anywhere in app source OR tests — that is the core R2-3d
  // app-wide guarantee.
  const isTestFile = (f) => /\.test\.[cm]?tsx?$/.test(f) || /_e2e\.mjs$/.test(f);
  const renderFiles = files.filter((f) => !isTestFile(f));

  it("no NV/AC/HL/QF monogram badge literals in rendered app source", () => {
    const offenders = renderFiles.filter((f) => MONOGRAM.test(readFileSync(f, "utf8")));
    record("zero monogram-token matches", offenders.length === 0, offenders.join(", "));
    expect(offenders).toEqual([]);
  });

  it("no placeholder partner names anywhere in client/src or server/", () => {
    const offenders = files.filter((f) => PARTNER_NAMES.test(readFileSync(f, "utf8")));
    record("zero placeholder partner-name matches", offenders.length === 0, offenders.join(", "));
    expect(offenders).toEqual([]);
  });

  it("the trust-grid container + badge testids are gone from rendered app source", () => {
    const offenders = renderFiles.filter((f) => TRUST_GRID.test(readFileSync(f, "utf8")));
    record("zero trust-grid testids", offenders.length === 0, offenders.join(", "));
    expect(offenders).toEqual([]);
  });

  it("summary", () => {
    console.log(`\n  v25.43 F8 E2E: scanned ${files.length} files — ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});
