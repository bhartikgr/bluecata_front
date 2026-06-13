/**
 * Wave G G1 — Design token contract.
 *
 * Asserts that the extended `cap-*` token system is present in:
 *   - client/src/index.css           (CSS custom properties on :root)
 *   - tailwind.config.ts             (utility namespace under colors)
 *   - the 8 high-visibility components (data-cap-token enrollment marker)
 *
 * Source-level assertions only (no jsdom render) — same pattern as
 * brandColorVars.test.ts and authShellHeroPanel.test.ts.
 *
 * Math-sacred: this test reads only client + config files. It cannot
 * touch the engine or the captableCommitStore.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

const indexCss = fs.readFileSync(
  path.join(ROOT, "client", "src", "index.css"),
  "utf8",
);
const tailwindConfig = fs.readFileSync(
  path.join(ROOT, "tailwind.config.ts"),
  "utf8",
);

describe("Wave G G1 — extended design tokens (CSS custom properties)", () => {
  // Wave E E4 tokens — preserved (must remain identical).
  it("preserves Wave E primary + secondary tokens", () => {
    expect(indexCss).toMatch(/--cap-primary:\s*184\s+98%\s+22%/);
    expect(indexCss).toMatch(/--cap-primary-hover:\s*184\s+98%\s+18%/);
    expect(indexCss).toMatch(/--cap-secondary:\s*219\s+45%\s+20%/);
    expect(indexCss).toMatch(/--cap-secondary-hover:\s*219\s+45%\s+16%/);
  });

  // Wave G G1 new tokens.
  it("declares --cap-surface and --cap-surface-hover", () => {
    expect(indexCss).toMatch(/--cap-surface:\s*0\s+0%\s+100%/);
    expect(indexCss).toMatch(/--cap-surface-hover:\s*210\s+33%\s+96%/);
  });

  it("declares --cap-border", () => {
    expect(indexCss).toMatch(/--cap-border:\s*215\s+20%\s+88%/);
  });

  it("declares --cap-text-primary, --cap-text-secondary, --cap-text-disabled", () => {
    expect(indexCss).toMatch(/--cap-text-primary:\s*219\s+45%\s+14%/);
    expect(indexCss).toMatch(/--cap-text-secondary:\s*219\s+15%\s+42%/);
    expect(indexCss).toMatch(/--cap-text-disabled:\s*219\s+15%\s+65%/);
  });

  it("declares --cap-success, --cap-warning, --cap-error, --cap-info", () => {
    expect(indexCss).toMatch(/--cap-success:\s*158\s+64%\s+30%/);
    expect(indexCss).toMatch(/--cap-warning:\s*38\s+92%\s+45%/);
    expect(indexCss).toMatch(/--cap-error:\s*7\s+61%\s+43%/);
    expect(indexCss).toMatch(/--cap-info:\s*219\s+70%\s+55%/);
  });
});

describe("Wave G G1 — Tailwind utilities expose cap-* namespace", () => {
  it("exposes cap-surface and cap-surface-hover", () => {
    expect(tailwindConfig).toMatch(/"cap-surface":\s*\{/);
    expect(tailwindConfig).toMatch(/hsl\(var\(--cap-surface\)\s*\/\s*<alpha-value>\)/);
    expect(tailwindConfig).toMatch(/hsl\(var\(--cap-surface-hover\)\s*\/\s*<alpha-value>\)/);
  });

  it("exposes cap-border", () => {
    expect(tailwindConfig).toMatch(/"cap-border":\s*"hsl\(var\(--cap-border\)/);
  });

  it("exposes cap-text.primary / secondary / disabled", () => {
    expect(tailwindConfig).toMatch(/"cap-text":\s*\{/);
    expect(tailwindConfig).toMatch(/primary:\s*"hsl\(var\(--cap-text-primary\)/);
    expect(tailwindConfig).toMatch(/secondary:\s*"hsl\(var\(--cap-text-secondary\)/);
    expect(tailwindConfig).toMatch(/disabled:\s*"hsl\(var\(--cap-text-disabled\)/);
  });

  it("exposes cap-success, cap-warning, cap-error, cap-info", () => {
    expect(tailwindConfig).toMatch(/"cap-success":\s*"hsl\(var\(--cap-success\)/);
    expect(tailwindConfig).toMatch(/"cap-warning":\s*"hsl\(var\(--cap-warning\)/);
    expect(tailwindConfig).toMatch(/"cap-error":\s*"hsl\(var\(--cap-error\)/);
    expect(tailwindConfig).toMatch(/"cap-info":\s*"hsl\(var\(--cap-info\)/);
  });

  it("preserves cap-primary and cap-secondary (Wave E carry-over)", () => {
    expect(tailwindConfig).toMatch(/"cap-primary":\s*\{/);
    expect(tailwindConfig).toMatch(/"cap-secondary":\s*\{/);
  });
});

describe("Wave G G1 — high-visibility component enrollment", () => {
  const components: Array<{ name: string; file: string; token: string }> = [
    { name: "Card",   file: "client/src/components/ui/card.tsx",   token: "surface"   },
    { name: "Button", file: "client/src/components/ui/button.tsx", token: "button"    },
    { name: "Input",  file: "client/src/components/ui/input.tsx",  token: "input"     },
    { name: "Dialog", file: "client/src/components/ui/dialog.tsx", token: "dialog"    },
    { name: "Toast",  file: "client/src/components/ui/toast.tsx",  token: "toast"     },
    { name: "Badge",  file: "client/src/components/ui/badge.tsx",  token: "badge"     },
    { name: "Sidebar wrapper", file: "client/src/components/ui/sidebar.tsx", token: "sidebar"  },
    { name: "NavLink (SidebarMenuButton)", file: "client/src/components/ui/sidebar.tsx", token: "nav-link" },
  ];

  for (const c of components) {
    it(`${c.name} carries data-cap-token="${c.token}"`, () => {
      const src = fs.readFileSync(path.join(ROOT, c.file), "utf8");
      expect(src).toMatch(new RegExp(`data-cap-token="${c.token}"`));
    });
  }
});

describe("Wave G G1 — design-tokens.md documentation", () => {
  it("client/src/design-tokens.md exists and lists every cap-* token", () => {
    const docPath = path.join(ROOT, "client", "src", "design-tokens.md");
    expect(fs.existsSync(docPath)).toBe(true);
    const doc = fs.readFileSync(docPath, "utf8");
    // Every token name appears at least once.
    for (const tok of [
      "--cap-primary", "--cap-secondary",
      "--cap-surface", "--cap-border",
      "--cap-text-primary", "--cap-text-secondary", "--cap-text-disabled",
      "--cap-success", "--cap-warning", "--cap-error", "--cap-info",
    ]) {
      expect(doc).toContain(tok);
    }
  });
});
