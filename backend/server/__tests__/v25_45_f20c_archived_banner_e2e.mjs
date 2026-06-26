/* v25.45 F20c — ArchivedWorkspaceBanner source-rendering assertions.
 *
 * The banner is a client component, so we assert against its source + the
 * AppShell wiring (the same source-assertion style used by the F1/F3/F4 client
 * suites in this wave). Confirms: F20g Option-3 copy, the Reactivate Workspace
 * button routing to /founder/subscribe?reactivate=1, brand-red styling, and a
 * DB-driven read path via /api/founder/workspace/archive-status.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../client/src");
let banner, shell;
const { results, record } = recorder();

beforeAll(() => {
  banner = readFileSync(resolve(SRC, "components/ArchivedWorkspaceBanner.tsx"), "utf8");
  shell = readFileSync(resolve(SRC, "components/AppShell.tsx"), "utf8");
});

describe("v25.45 F20c archived banner — source assertions", () => {
  it("1. uses F20g Option-3 copy (archived on … / before retention end)", () => {
    const ok = /Workspace archived on/.test(banner)
      && /Reactivate to resume\s*[\r\n]?\s*editing/.test(banner)
      && /anytime before/.test(banner);
    record("F20g option-3 copy present", ok);
    expect(ok).toBe(true);
  });

  it("2. Reactivate Workspace button routes to /founder/subscribe?reactivate=1", () => {
    const ok = /Reactivate Workspace/.test(banner)
      && /\/founder\/subscribe\?reactivate=1/.test(banner);
    record("reactivate button + route", ok);
    expect(ok).toBe(true);
  });

  it("3. brand-red banner (#cc0001)", () => {
    const ok = /#cc0001/.test(banner);
    record("brand-red styling", ok);
    expect(ok).toBe(true);
  });

  it("4. DB-driven read path via archive-status endpoint", () => {
    const ok = /\/api\/founder\/workspace\/archive-status/.test(banner)
      && /archiveStatus !== "archived"/.test(banner);
    record("DB-driven archive-status read + self-hide", ok);
    expect(ok).toBe(true);
  });

  it("5. AppShell renders the banner on founder routes", () => {
    const ok = /ArchivedWorkspaceBanner/.test(shell)
      && /location\.startsWith\("\/founder"\)/.test(shell);
    record("AppShell wires banner for /founder", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F20c banner source: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
