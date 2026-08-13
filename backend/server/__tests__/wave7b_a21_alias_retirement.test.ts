/**
 * WAVE 7B — A-21. Owner ruling issued after the WAVE 7 hand-back:
 *
 *   "partner_basic and partner_pro are stale exactly like partner_enterprise.
 *    Wave 7 shipped X-C3 retiring only partner_enterprise because the item
 *    named only that one. Ruling: fix all three."
 *
 * THE SINK — and it is the same one X-C3 named, deliberately.
 * `subscriptionTierStore.listTiers("consortium.subscription.")` is the single
 * thing that decides which partner subscription tiers the admin fee editor
 * renders: AdminFeesConsolidated.tsx maps over exactly its result and gives
 * each row an editable amount field. Retiring the rows IS retiring the display;
 * there is no hardcoded tier list to also edit.
 *
 * SECOND-PATH CHECK, asserted below rather than asserted in prose: every other
 * reader of the consortium tier family (`consortiumSubscriptionResolver.ts`,
 * `adminFeeTierRoutes.ts`) reaches the rows through `listTiers`/`getTier`, both
 * of which run the heal. This suite pins that there is exactly ONE heal call
 * site in the store and that no module re-types the retirement SQL.
 *
 * A-22 (STANDING CHECKLIST) — "does the bootstrap re-create what I just
 * repaired?" YES, connection.ts:1918-1919. So the self-heal installer is tested
 * as a first-class deliverable, not the migration alone.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  ensureWave7bAliasesRetired,
  readWave7bAliasRetirementSql,
  WAVE7B_ALIAS_PAIRS,
} from "../lib/applyWave7bAliasRetirement";
import { ensureWave7AliasRetired } from "../lib/applyWave7AliasRetirement";
import { resolvePartnerTierSlug } from "../lib/partnerTiers";

const ROOT = process.cwd();
const BASENAME = "0164_wave7b_a21_retire_partner_basic_pro_aliases.sql";

const BASIC = "consortium.subscription.partner_basic";
const PRO = "consortium.subscription.partner_pro";

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
  ins.run(BASIC, 49900);
  ins.run(PRO, 99900);
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
    .map((r: any) => String(r.key).replace("consortium.subscription.", ""));
}

describe("A-21 — migration 0164 exists, is mirrored byte-identically, and takes a free number", () => {
  const a = join(ROOT, "migrations", BASENAME);
  const b = join(ROOT, "server", "db", "migrations", BASENAME);

  it("both copies exist", () => {
    expect(existsSync(a), `${a} missing`).toBe(true);
    expect(existsSync(b), `${b} missing`).toBe(true);
  });

  it("the two copies are BYTE-IDENTICAL — no drift between migration dirs", () => {
    expect(readFileSync(a)).toEqual(readFileSync(b));
  });

  it("does not reuse a BURNT migration number (0152/0154/0155/0158)", () => {
    for (const burnt of ["0152", "0154", "0155", "0158"]) {
      expect(BASENAME.startsWith(burnt)).toBe(false);
    }
  });

  it("retires exactly the two rows A-21 names, and no third", () => {
    const sql = readFileSync(a, "utf8");
    const statements = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).toContain(BASIC);
    expect(statements).toContain(PRO);
    /* partner_enterprise belongs to 0163. Touching it here would create the
       duplicate-writer shape this project keeps getting burnt by. */
    expect(statements).not.toContain("partner_enterprise");
  });

  it("the installer reads the file rather than re-typing it — no drift possible", () => {
    const src = readFileSync(join(ROOT, "server", "lib", "applyWave7bAliasRetirement.ts"), "utf8");
    expect(src).not.toMatch(/UPDATE\s+platform_fees/i);
    expect(readWave7bAliasRetirementSql()).toBe(readFileSync(a, "utf8"));
  });
});

describe("A-21 — the two stale rows are retired at the sink", () => {
  let db: any;
  beforeEach(() => {
    db = freshDb();
    seedBoot(db);
  });

  it("both rows are LIVE before the heal — this is what a fresh boot produces", () => {
    const slugs = liveTierSlugs(db);
    expect(slugs).toContain("partner_basic");
    expect(slugs).toContain("partner_pro");
  });

  it("both rows are gone from listTiers() after the heal", () => {
    const r = ensureWave7bAliasesRetired(db);
    expect(r.applied).toBe(true);
    expect(r.retired.sort()).toEqual([BASIC, PRO].sort());
    expect(r.withheld).toEqual([]);
    const slugs = liveTierSlugs(db);
    expect(slugs).not.toContain("partner_basic");
    expect(slugs).not.toContain("partner_pro");
  });

  it("SOFT delete, not delete — the historical amounts survive for audit", () => {
    ensureWave7bAliasesRetired(db);
    for (const [key, amount] of [
      [BASIC, 49900],
      [PRO, 99900],
    ] as const) {
      const row = db
        .prepare("SELECT amount_minor, deleted_at FROM platform_fees WHERE key = ?")
        .get(key);
      expect(row, `${key} was HARD deleted — audit history destroyed`).toBeTruthy();
      expect(row.amount_minor).toBe(amount);
      expect(row.deleted_at).toBeTruthy();
    }
  });

  it("NOTHING ELSE IS DROPPED — the canonical five are untouched", () => {
    ensureWave7bAliasesRetired(db);
    const slugs = liveTierSlugs(db);
    for (const s of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      expect(slugs, `canonical tier ${s} was dropped`).toContain(s);
    }
    expect(
      db.prepare("SELECT amount_minor FROM platform_fees WHERE key = ?").get(
        "consortium.subscription.catalyst",
      ).amount_minor,
    ).toBe(49900);
    expect(
      db.prepare("SELECT amount_minor FROM platform_fees WHERE key = ?").get(
        "consortium.subscription.builder",
      ).amount_minor,
    ).toBe(99900);
  });

  it("A-21 + X-C3 together leave exactly the canonical five", () => {
    ensureWave7AliasRetired(db);
    ensureWave7bAliasesRetired(db);
    expect(liveTierSlugs(db)).toEqual([
      "amplifier",
      "builder",
      "catalyst",
      "founding_member",
      "nexus",
    ]);
  });

  it("is idempotent — a second run changes nothing", () => {
    ensureWave7bAliasesRetired(db);
    const after1 = liveTierSlugs(db);
    const r2 = ensureWave7bAliasesRetired(db);
    expect(r2.applied).toBe(false);
    expect(liveTierSlugs(db)).toEqual(after1);
  });
});

describe("A-21 — no capability is lost, and the fix fails safe per pair", () => {
  it("both aliases still RESOLVE: legacy partners price off their canonical tier", () => {
    /* The map in server/lib/partnerTiers.ts is deliberately NOT removed. That
       is what makes retiring the rows safe rather than lossy. */
    expect(resolvePartnerTierSlug("partner_basic")).toBe("catalyst");
    expect(resolvePartnerTierSlug("partner_pro")).toBe("builder");
    expect(resolvePartnerTierSlug("partner_enterprise")).toBe("amplifier");
  });

  it("the retired amounts EQUAL their canonical amounts — no partner's price changes", () => {
    const db = freshDb();
    seedBoot(db);
    const amt = (k: string) =>
      db.prepare("SELECT amount_minor FROM platform_fees WHERE key = ?").get(k).amount_minor;
    for (const p of WAVE7B_ALIAS_PAIRS) {
      expect(amt(p.aliasKey), `${p.aliasKey} vs ${p.canonicalKey}`).toBe(amt(p.canonicalKey));
    }
  });

  it("retirement is WITHHELD for a pair whose canonical target is missing", () => {
    const db = freshDb();
    seedBoot(db);
    db.prepare("DELETE FROM platform_fees WHERE key = ?").run("consortium.subscription.builder");
    const r = ensureWave7bAliasesRetired(db);
    /* partner_basic still retires; partner_pro is held back independently. */
    expect(r.retired).toContain(BASIC);
    expect(r.withheld).toEqual([PRO]);
    expect(liveTierSlugs(db)).toContain("partner_pro");
  });

  it("retirement is WITHHELD for a pair whose canonical target is soft-deleted", () => {
    const db = freshDb();
    seedBoot(db);
    db.prepare("UPDATE platform_fees SET deleted_at = 'x' WHERE key = ?").run(
      "consortium.subscription.catalyst",
    );
    const r = ensureWave7bAliasesRetired(db);
    expect(r.withheld).toEqual([BASIC]);
    expect(liveTierSlugs(db)).toContain("partner_basic");
    expect(liveTierSlugs(db)).not.toContain("partner_pro");
  });

  it("nothing throws when platform_fees does not exist yet (very early bootstrap)", () => {
    const db = new Database(":memory:");
    expect(() => ensureWave7bAliasesRetired(db as any)).not.toThrow();
  });
});

describe("A-21 — SECOND-PATH CHECK: exactly one heal site, no re-typed SQL", () => {
  it("subscriptionTierStore calls the installer exactly once", () => {
    const src = readFileSync(join(ROOT, "server", "subscriptionTierStore.ts"), "utf8");
    const calls = src.match(/ensureWave7bAliasesRetired\(/g) ?? [];
    expect(calls.length, "a second heal call site is a duplicate writer").toBe(1);
  });

  it("both listTiers and getTier run the heal — no reader bypasses it", () => {
    const src = readFileSync(join(ROOT, "server", "subscriptionTierStore.ts"), "utf8");
    for (const fn of ["export function listTiers", "export function getTier"]) {
      const at = src.indexOf(fn);
      expect(at, `${fn} not found`).toBeGreaterThan(-1);
      expect(src.slice(at, at + 400)).toContain("ensureAliasRetirement()");
    }
  });

  it("no module outside the installer re-types the A-21 retirement UPDATE", () => {
    for (const f of [
      "server/lib/consortiumSubscriptionResolver.ts",
      "server/adminFeeTierRoutes.ts",
      "server/consortiumFeesStore.ts",
    ]) {
      /* Strip comments first: consortiumSubscriptionResolver.ts mentions
         `partner_pro` in a doc example, which is prose, not a write. */
      const src = readFileSync(join(ROOT, f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, `${f} references a retired legacy tier key in live code`).not.toMatch(
        /partner_basic|partner_pro/,
      );
      expect(src, `${f} soft-deletes a platform_fees row — second writer`).not.toMatch(
        /UPDATE\s+platform_fees[\s\S]{0,200}deleted_at\s*=/i,
      );
    }
  });
});
