/**
 * v25.47 APD-025 — Email rebrand + 6 new templates.
 *
 *   1. The 6 new templates resolve via findTemplate with the right categories.
 *   2. The template catalog totals 21 entries and is Capavate-branded (no
 *      blueprintcatalyst references remain in the source).
 *   3. The .env SMTP identity is rebranded to scale@capavate.com.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { findTemplate } from "../emailStore";

const NEW_TEMPLATES: Array<{ slug: string; category: string }> = [
  { slug: "collective_member_subscribed", category: "membership" },
  { slug: "consortium_partner_subscribed", category: "membership" },
  { slug: "spv_deployed", category: "system" },
  { slug: "post_flagged", category: "system" },
  { slug: "post_hidden", category: "system" },
  { slug: "pulse_digest", category: "system" },
];

const ROOT = path.resolve(__dirname, "..", "..");

describe("APD-025 email rebrand", () => {
  it("resolves all 6 new templates with the expected category", () => {
    for (const { slug, category } of NEW_TEMPLATES) {
      const tpl = findTemplate(slug);
      expect(tpl, `template ${slug} should exist`).not.toBeNull();
      expect(tpl!.category).toBe(category);
      expect(tpl!.subject.length).toBeGreaterThan(0);
      expect(tpl!.bodyHtml.length).toBeGreaterThan(0);
    }
  });

  it("has 21 templates total and no blueprintcatalyst branding in source", () => {
    const src = readFileSync(path.join(ROOT, "server", "emailStore.ts"), "utf8");
    const count = (src.match(/\{ id: "tpl_/g) ?? []).length;
    expect(count).toBe(21);
    expect(src).not.toMatch(/blueprintcatalyst/i);
  });

  it("rebrands the .env SMTP identity to scale@capavate.com", () => {
    const env = readFileSync(path.join(ROOT, ".env"), "utf8");
    expect(env).not.toMatch(/blueprintcatalyst/i);
    expect(env).toMatch(/SMTP_USER=scale@capavate\.com/);
    expect(env).toMatch(/SMTP_FROM=Capavate <scale@capavate\.com>/);
    expect(env).toMatch(/SMTP_REPLY_TO=scale@capavate\.com/);
  });
});
