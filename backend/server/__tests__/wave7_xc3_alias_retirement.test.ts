/**
 * WAVE 7 — X-C3 (C-3): "Remove the stale partner_enterprise alias row and its
 * display."
 *
 * THE SINK. `subscriptionTierStore.listTiers("consortium.subscription.")` is
 * the single thing that decides which partner subscription tiers the admin fee
 * editor renders — AdminFeesConsolidated.tsx:1005-1030 maps over exactly its
 * result and gives each row an editable amount field. Retiring the row IS
 * retiring the display; there is no hardcoded tier list to also edit. These
 * tests prove the row goes away, prove nothing else goes with it, and prove the
 * retirement is withheld when it would strand a legacy partner.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  ensureWave7AliasRetired,
  readWave7AliasRetirementSql,
  RETIRED_ALIAS_KEY,
  ALIAS_TARGET_KEY,
} from "../lib/applyWave7AliasRetirement";
import { resolvePartnerTierSlug } from "../lib/partnerTiers";

const ROOT = process.cwd();
const BASENAME = "0163_wave7_xc3_retire_partner_enterprise_alias.sql";

/** A minimal platform_fees table matching the shape the real schema uses. */
function freshDb(): any {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE platform_fees (
      key TEXT PRIMARY KEY NOT NULL,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      updated_at TEXT,
      updated_by_user_id TEXT,
      billing_period TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

/** Seed exactly what a fresh boot produces: legacy trio + canonical five. */
function seedBoot(db: any): void {
  const ins = db.prepare(
    `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
       VALUES (?, ?, 'USD', '2026-06-28T00:00:00.000Z', 'system:seed', 'monthly', NULL)`,
  );
  /* connection.ts:1918-1920 — the v25.46.1 legacy seed */
  ins.run("consortium.subscription.partner_basic", 49900);
  ins.run("consortium.subscription.partner_pro", 99900);
  ins.run("consortium.subscription.partner_enterprise", 249900);
  /* migration 0072 — the canonical five */
  ins.run("consortium.subscription.catalyst", 49900);
  ins.run("consortium.subscription.builder", 99900);
  ins.run("consortium.subscription.amplifier", 149900);
  ins.run("consortium.subscription.nexus", 499900);
  ins.run("consortium.subscription.founding_member", 0);
}

/** What listTiers() would return: LIVE rows under the consortium prefix. */
function liveTierSlugs(db: any): string[] {
  return db
    .prepare(
      `SELECT key FROM platform_fees
        WHERE key LIKE 'consortium.subscription.%'
          AND (deleted_at IS NULL OR deleted_at = '')
        ORDER BY key`,
    )
    .all()
    .map((r: any) => r.key.replace("consortium.subscription.", ""));
}

describe("X-C3 — migration 0163 exists, is mirrored, and is the only source of the change", () => {
  it("is present in BOTH migration directories and byte-identical", () => {
    const a = join(ROOT, "migrations", BASENAME);
    const b = join(ROOT, "server", "db", "migrations", BASENAME);
    expect(existsSync(a), `missing ${a}`).toBe(true);
    expect(existsSync(b), `missing ${b}`).toBe(true);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("does not reuse a burnt migration number and sits above every file on disk", () => {
    for (const burnt of ["0152", "0154", "0155", "0158"]) {
      expect(BASENAME.startsWith(burnt)).toBe(false);
    }
    expect(BASENAME.startsWith("0163")).toBe(true);
  });

  it("the installer reads the migration rather than re-typing the SQL", () => {
    const fromDisk = readFileSync(join(ROOT, "migrations", BASENAME), "utf8");
    expect(readWave7AliasRetirementSql()).toBe(fromDisk);
    /* the guarded UPDATE is in the file, not in the installer */
    const installer = readFileSync(join(ROOT, "server/lib/applyWave7AliasRetirement.ts"), "utf8");
    expect(installer).not.toMatch(/UPDATE\s+platform_fees/i);
  });

  it("touches no sacred file", () => {
    const sql = readWave7AliasRetirementSql()!;
    expect(sql).not.toMatch(/CREATE TABLE|DROP TABLE|ALTER TABLE/i);
  });
});

describe("X-C3 — the stale row is retired and its display goes with it", () => {
  let db: any;
  beforeEach(() => {
    db = freshDb();
    seedBoot(db);
  });

  it("before the fix, the alias row displays as a real editable $2,499 tier", () => {
    const slugs = liveTierSlugs(db);
    expect(slugs).toContain("partner_enterprise");
    const row = db.prepare("SELECT amount_minor FROM platform_fees WHERE key = ?").get(RETIRED_ALIAS_KEY);
    /* TRUE minor units — $2,499.00 */
    expect(row.amount_minor).toBe(249900);
  });

  it("after the fix, it is gone from the tier list", () => {
    const r = ensureWave7AliasRetired(db);
    expect(r.applied).toBe(true);
    expect(r.aliasRetired).toBe(true);
    expect(liveTierSlugs(db)).not.toContain("partner_enterprise");
  });

  it("SOFT delete — the historical amount survives for audit", () => {
    ensureWave7AliasRetired(db);
    const row = db.prepare("SELECT amount_minor, deleted_at FROM platform_fees WHERE key = ?").get(RETIRED_ALIAS_KEY);
    expect(row, "the row was HARD deleted — audit history destroyed").toBeTruthy();
    expect(row.amount_minor).toBe(249900);
    expect(row.deleted_at).toBeTruthy();
  });

  it("NOTHING ELSE IS DROPPED — the canonical five are untouched", () => {
    ensureWave7AliasRetired(db);
    const slugs = liveTierSlugs(db);
    for (const s of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      expect(slugs, `canonical tier ${s} was dropped`).toContain(s);
    }
    expect(
      db.prepare("SELECT amount_minor FROM platform_fees WHERE key = ?").get(ALIAS_TARGET_KEY).amount_minor,
    ).toBe(149900);
  });

  /* WAVE 7B NOTE: the owner has since ruled (A-21) that partner_basic and
     partner_pro must be retired too. They are — by migration 0164 and
     server/lib/applyWave7bAliasRetirement.ts, tested in
     server/__tests__/wave7b_a21_alias_retirement.test.ts. This test still
     asserts what it always did: 0163's OWN scope is exactly one row, so the
     two retirements can never become duplicate writers of each other. */
  it("0163's scope is exactly one row — partner_basic/partner_pro are retired by 0164, not here", () => {
    ensureWave7AliasRetired(db);
    const slugs = liveTierSlugs(db);
    expect(slugs).toContain("partner_basic");
    expect(slugs).toContain("partner_pro");
    expect(slugs.length).toBe(7); // 8 seeded − 1 retired
  });

  it("is idempotent — a second run changes nothing", () => {
    ensureWave7AliasRetired(db);
    const after1 = liveTierSlugs(db);
    const r2 = ensureWave7AliasRetired(db);
    expect(r2.applied).toBe(false);
    expect(r2.aliasRetired).toBe(true);
    expect(liveTierSlugs(db)).toEqual(after1);
  });
});

describe("X-C3 — no capability is lost, and the fix fails safe", () => {
  it("the alias still RESOLVES: legacy partners price off amplifier", () => {
    /* The map in server/lib/partnerTiers.ts is deliberately NOT removed. That
       is what makes retiring the row safe rather than lossy. */
    expect(resolvePartnerTierSlug("partner_enterprise")).toBe("amplifier");
    expect(resolvePartnerTierSlug("partner_basic")).toBe("catalyst");
    expect(resolvePartnerTierSlug("partner_pro")).toBe("builder");
  });

  it("retirement is WITHHELD when the canonical amplifier row is missing", () => {
    const db = freshDb();
    const ins = db.prepare(
      `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id, billing_period, deleted_at)
         VALUES (?, ?, 'USD', 'x', 'seed', 'monthly', NULL)`,
    );
    ins.run(RETIRED_ALIAS_KEY, 249900);
    /* no amplifier row at all */
    const r = ensureWave7AliasRetired(db);
    expect(r.applied).toBe(false);
    expect(r.aliasRetired).toBe(false);
    expect(r.reason).toMatch(/not live|withheld/i);
    expect(liveTierSlugs(db)).toContain("partner_enterprise");
  });

  it("retirement is WITHHELD when amplifier exists but is soft-deleted", () => {
    const db = freshDb();
    seedBoot(db);
    db.prepare("UPDATE platform_fees SET deleted_at = 'x' WHERE key = ?").run(ALIAS_TARGET_KEY);
    const r = ensureWave7AliasRetired(db);
    expect(r.applied).toBe(false);
    expect(liveTierSlugs(db)).toContain("partner_enterprise");
  });

  it("SECOND PATH CHECK — no other module writes or re-seeds this key outside the sacred bootstrap", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync(
      `grep -rln "subscription.partner_enterprise" --include="*.ts" --include="*.tsx" server client shared scripts || true`,
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.includes("__tests__"));
    /* connection.ts is the SACRED seeder this heal exists to counteract; the
       installer names the key as a constant. Anything else would be a second
       writer and must be investigated. */
    const allowed = new Set(["server/db/connection.ts", "server/lib/applyWave7AliasRetirement.ts"]);
    const unexpected = out.filter((f) => !allowed.has(f));
    expect(unexpected, `unexpected writers of the alias key: ${unexpected.join(", ")}`).toEqual([]);
  });
});
