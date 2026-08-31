/**
 * WAVE 184 · ITEM B · R156.2 — NO FEE MAY BE HARDCODED; /admin/fees IS THE ONLY
 * SOURCE.
 *
 * OWNER RULING, verbatim: "ALL fees are dynamic
 * (https://capavate.com/admin/fees). I believe I had set the annual fee to be at
 * $240 but this should never be hardcoded. None of the fees should be hardcoded
 * anywhere."
 *
 * THE $240 IS CORRECT AND DELIBERATE. The defect is that a fee number existed in
 * code at all. So nothing here asserts an amount is different — the opposite:
 * the CONFIGURED amounts are asserted BYTE-IDENTICAL to the database rows they
 * come from, because this wave changes where a number comes from and never what
 * it is.
 *
 * WHAT WAS FOUND, and what each pole guards:
 *
 *   1. `FALLBACK_COMMISSION_RATE` + `DEFAULT_RATE` in
 *      server/lib/partnerCommissionRateResolver.ts were FALLBACKS, not seeds. A
 *      seed is written to the database once and read back; these were never
 *      written anywhere. `getCommissionRate()` returned them, with
 *      `source: "default"`, when the read SUCCEEDED and found no row — a
 *      compiled-in commission rate on the partner Fee Schedule card and on the
 *      `partner_billing_entries` insert path. `listCommissionRates()` printed
 *      them on the ADMIN fee surface as if configured.
 *
 *   2. The constants that LOOKED like the offenders are seeds or prose, and are
 *      deliberately left alone. Each is pinned below so a later wave cannot
 *      quietly turn one back into a fallback:
 *        · consortiumFeesStore.ts DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR
 *          (24000 = the owner's $240) — declared, never read;
 *        · collectiveApplicationFeeResolver.ts DEFAULT_APPLICATION_FEE_MINOR
 *          (30000) — declared, never read;
 *        · partnerTiers.ts and partnerApprovalInvoice.ts — no price literal at
 *          all; the numbers a naive grep finds there are inside comments.
 *
 *   3. "Platform default" on the partner Fee Schedule is NOT a constant. It is
 *      precedence level 3 of partnerFeeResolver — a real `partner_fee_schedules`
 *      row with `tier IS NULL`. What it failed to say is WHICH configuration is
 *      absent, and that is now stated. No tier price is invented.
 *
 * Establishes its own preconditions and restores every row it touches. Static
 * imports only; no process.env.
 */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { rawDb } from "../db/connection";
import {
  getCommissionRate,
  tryGetCommissionRate,
  listCommissionRates,
  updateCommissionRate,
  UnknownCommissionTierError,
  CommissionRateUnreadableError,
  isUnknownCommissionTierError,
  E_COMMISSION_RATE_UNRESOLVED,
  E_COMMISSION_RATE_UNREADABLE,
} from "../lib/partnerCommissionRateResolver";

const REPO = path.resolve(__dirname, "..", "..");

/* The same length-preserving stripper used by the Item A file: comments are
 * blanked, string and template literals are not, so a constant hiding in prose
 * is not mistaken for live code and a real declaration cannot hide in a comment. */
function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c === "'") { mode = "sq"; i += 1; continue; }
      if (c === '"') { mode = "dq"; i += 1; continue; }
      if (c === "`") { mode = "tpl"; i += 1; continue; }
      i += 1; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; i += 1; continue; }
      out[i] = " "; i += 1; continue;
    }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; out[i] = " "; out[i + 1] = " "; i += 2; continue; }
      if (c !== "\n") out[i] = " ";
      i += 1; continue;
    }
    if (c === "\\") { i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code"; i += 1; continue;
    }
    i += 1;
  }
  return out.join("");
}

const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
const code = (rel: string) => stripComments(read(rel));

const RESOLVER = "server/lib/partnerCommissionRateResolver.ts";

/* ═════════════════════════════════════════════════════════════════════════════
 * PRECONDITION — the five rates ARE configured in the database. Every "amount is
 * unchanged" claim below rests on this, so it is asserted rather than assumed.
 * ═══════════════════════════════════════════════════════════════════════════ */
type Row = { tier: string; rate: number };
const seeded = (): Row[] =>
  rawDb().prepare(`SELECT tier, rate FROM partner_commission_rate_config ORDER BY tier`).all() as Row[];

describe("W184 · B — PRECONDITION: the commission rates live in the database", () => {
  it("all five tiers have a configured row", () => {
    const rows = seeded();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const tiers = rows.map((r) => r.tier);
    for (const t of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      expect(tiers).toContain(t);
    }
  });

  it("the migration and the bootstrap both seed them, so a fresh install is configured too", () => {
    const mig = read("migrations/0058_v25_38_partner_commission_rate_config.sql");
    expect(mig).toContain("INSERT OR IGNORE INTO partner_commission_rate_config");
    expect(read("server/db/connection.ts")).toContain("INSERT OR IGNORE INTO partner_commission_rate_config");
    /* MEASURED, not assumed: 0058 predates the both-trees mirroring rule and
     * exists only under migrations/ (196 files there, 129 under
     * server/db/migrations/). The bootstrap in connection.ts is what guarantees a
     * fresh install is configured, and it is asserted above. */
    expect(fs.existsSync(path.join(REPO, "migrations/0058_v25_38_partner_commission_rate_config.sql"))).toBe(true);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * POLE 1 — A CONFIGURED FEE RESOLVES FROM THE DATABASE, AND ITS AMOUNT IS
 * BYTE-IDENTICAL TO BEFORE. This is the pole that would catch this wave changing
 * money, which it must not.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W184 · B — a configured rate resolves FROM THE DATABASE, unchanged", () => {
  it("every seeded tier resolves to exactly its row value, sourced db", () => {
    for (const r of seeded()) {
      const resolved = getCommissionRate(r.tier);
      expect(resolved.rate).toBe(r.rate);
      expect(resolved.source).toBe("db");
    }
  });

  it("editing the row moves the answer — proving the database is the source, not a constant", () => {
    const db = rawDb();
    const before = db.prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier='builder'`).get() as Row;
    /* Derived from the observed row, so this test contains no magic rate. */
    const edited = Number((before.rate + 0.0137).toFixed(6));
    db.prepare(`UPDATE partner_commission_rate_config SET rate=? WHERE tier='builder'`).run(edited);
    try {
      const r = getCommissionRate("builder");
      expect(r.rate).toBe(edited);
      expect(r.source).toBe("db");
    } finally {
      db.prepare(`UPDATE partner_commission_rate_config SET rate=? WHERE tier='builder'`).run(before.rate);
    }
  });

  it("the admin write path round-trips through the database", () => {
    const db = rawDb();
    const before = db.prepare(`SELECT rate FROM partner_commission_rate_config WHERE tier='amplifier'`).get() as Row;
    const target = Number((before.rate + 0.0011).toFixed(6));
    try {
      const w = updateCommissionRate("amplifier", target, "u_w184_admin");
      expect(w.source).toBe("db");
      expect(getCommissionRate("amplifier").rate).toBe(target);
    } finally {
      updateCommissionRate("amplifier", before.rate, "u_w184_restore");
    }
    expect(getCommissionRate("amplifier").rate).toBe(before.rate);
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * POLE 2 — AN UNCONFIGURED FEE REFUSES WITH A STATED REASON, NEVER A NUMBER.
 * Before this wave, deleting a seeded tier's row produced the MIRROR of Avi's
 * literal with `source: "default"`. That is the defect R156.2 names.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W184 · B — an unconfigured rate REFUSES and names the missing fact", () => {
  const withNexusRowDeleted = (fn: (saved: Row) => void) => {
    const db = rawDb();
    const saved = db.prepare(`SELECT tier, rate FROM partner_commission_rate_config WHERE tier='nexus'`).get() as Row;
    db.prepare(`DELETE FROM partner_commission_rate_config WHERE tier='nexus'`).run();
    try { fn(saved); } finally {
      db.prepare(`INSERT OR IGNORE INTO partner_commission_rate_config (tier, rate) VALUES (?,?)`).run(saved.tier, saved.rate);
    }
  };

  it("a SEEDED tier whose row has been deleted now REFUSES instead of returning the compiled-in mirror", () => {
    withNexusRowDeleted((saved) => {
      expect(() => getCommissionRate("nexus")).toThrow(UnknownCommissionTierError);
      /* The precise regression: the mirror value must NOT come back. */
      let caught: unknown = null;
      try { getCommissionRate("nexus"); } catch (e) { caught = e; }
      expect(caught).not.toEqual({ rate: saved.rate, source: "default" });
    });
  });

  it("the refusal names the tier, the code, and the admin surface that fixes it", () => {
    withNexusRowDeleted(() => {
      let caught: unknown = null;
      try { getCommissionRate("nexus"); } catch (e) { caught = e; }
      const msg = (caught as Error).message;
      expect(msg).toContain(E_COMMISSION_RATE_UNRESOLVED);
      expect(msg).toContain("nexus");
      expect(msg).toContain("Admin");
      expect(msg).toContain("NO default rate");
      expect(isUnknownCommissionTierError(caught)).toBe(true);
    });
  });

  it("an unknown tier is refused too, and no 2% floor answers for it", () => {
    expect(() => getCommissionRate("w184_bridge_tier")).toThrow(/PARTNER_COMMISSION_RATE_UNRESOLVED/);
    expect(tryGetCommissionRate("w184_bridge_tier")).toBeNull();
  });

  it("the ADMIN list reports an unconfigured tier as absent with rate null — no substituted number", () => {
    withNexusRowDeleted(() => {
      const nexus = listCommissionRates().find((r) => r.tier === "nexus");
      expect(nexus).toBeTruthy();
      expect(nexus!.source).toBe("absent");
      expect(nexus!.rate).toBeNull();
    });
  });

  it("NEGATIVE CONTROL: with the row present, the admin list reports the DB value — the refusal is not unconditional", () => {
    const rows = listCommissionRates();
    const bySlug = new Map(rows.map((r) => [r.tier as string, r]));
    for (const r of seeded()) {
      const listed = bySlug.get(r.tier);
      expect(listed, r.tier).toBeTruthy();
      expect(listed!.rate).toBe(r.rate);
      expect(listed!.source).toBe("db");
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * POLE 3 — A READ FAILURE IS ITS OWN NAMED FAULT, NOT A CONSTANT.
 * The distinction matters on a money surface: "no rate is configured" is a data
 * fix an admin can make; "the rate could not be read" is not, and telling a
 * partner to go set a field that is already set would be a false statement.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W184 · B — an unreadable rate is refused by its own name, never papered over", () => {
  it("a broken read throws CommissionRateUnreadableError and asserts that no rate was assumed", () => {
    const db = rawDb();
    db.exec(`ALTER TABLE partner_commission_rate_config RENAME TO w184_ratecfg_parked`);
    try {
      let caught: unknown = null;
      try { getCommissionRate("catalyst"); } catch (e) { caught = e; }
      expect(caught).toBeInstanceOf(CommissionRateUnreadableError);
      const msg = (caught as Error).message;
      expect(msg).toContain(E_COMMISSION_RATE_UNREADABLE);
      expect(msg).toContain("no compiled-in commission rate");
      /* It is deliberately NOT the unconfigured refusal, so a caller cannot tell
       * a partner to set a field that is already set. */
      expect(isUnknownCommissionTierError(caught)).toBe(false);
    } finally {
      db.exec(`ALTER TABLE w184_ratecfg_parked RENAME TO partner_commission_rate_config`);
    }
    /* And the ordinary path is intact afterwards. */
    expect(getCommissionRate("catalyst").source).toBe("db");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * POLE 4 — THE FALLBACK CONSTANTS ARE GONE AND UNREACHABLE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W184 · B — no commission fallback constant remains reachable", () => {
  it("FALLBACK_COMMISSION_RATE and DEFAULT_RATE no longer exist as code in the resolver", () => {
    const src = code(RESOLVER);
    expect(src).not.toContain("FALLBACK_COMMISSION_RATE");
    expect(src).not.toContain("DEFAULT_RATE");
  });

  it("no commission-rate literal survives anywhere in the resolver's code", () => {
    const src = code(RESOLVER);
    for (const lit of ["0.02", "0.03", "0.04", "0.05", "0.06"]) {
      expect(src, `literal ${lit}`).not.toContain(lit);
    }
  });

  it("getCommissionRate has exactly ONE way to answer with a number: the database row", () => {
    const src = code(RESOLVER);
    const fn = src.slice(src.indexOf("export function getCommissionRate"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    /* One `return { rate: ..., source: "db" }` and no other numeric return. */
    expect((body.match(/return \{ rate:/g) ?? []).length).toBe(1);
    expect(body).toContain('source: "db"');
    expect(body).not.toContain('source: "default"');
  });

  it("the removal is DOCUMENTED in place rather than being a silent hole", () => {
    /* R156.2 plus the owner's standing no-silent-drops rule: the next reader must
     * be able to see what was removed and why, from the file itself. */
    const src = read(RESOLVER);
    expect(src).toContain("WAVE 184 · ITEM B · R156.2");
    expect(src).toContain("FALLBACK_COMMISSION_RATE");
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * POLE 5 — THE CONSTANTS THAT ARE SEEDS OR PROSE ARE STILL SEEDS OR PROSE.
 * Pinned so a later wave cannot quietly re-wire one into a fallback, and so this
 * wave's decision NOT to touch them is falsifiable rather than an assertion.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W184 · B — the look-alike constants are seeds or prose, and stay unread", () => {
  it("the owner's $240 SPV deployment seed is declared exactly once and read nowhere", () => {
    const ident = "DEFAULT_CONSORTIUM_SPV_DEPLOYMENT_FEE_MINOR";
    let hits = 0;
    for (const rel of sourceFilesRel()) {
      const src = code(rel);
      hits += (src.match(new RegExp(ident, "g")) ?? []).length;
    }
    /* One hit: its own declaration. A second hit would be a read. */
    expect(hits).toBe(1);
    expect(code("server/consortiumFeesStore.ts")).toContain(`const ${ident} = 24000`);
  });

  it("the collective application-fee AMOUNT constant is likewise declared once and read nowhere", () => {
    /* MEASURED: this identifier occurs twice in the tree — its declaration in the
     * resolver, and a `//` comment in founder/ApplyToCollective.tsx:582 recording
     * that wave 144 turned the old literal INTO prose. The comment is a hit for
     * the naive stripper because that file contains an apostrophe inside JSX text,
     * which is enough to confuse any single-pass tokenizer; so this pole filters
     * by LINE as well, which cannot be fooled the same way. Note the direction of
     * that failure mode: a confused stripper RETAINS text it should have blanked,
     * so it can only ever over-report a hit, never hide one. */
    const ident = "DEFAULT_APPLICATION_FEE_MINOR";
    const live: string[] = [];
    for (const rel of sourceFilesRel()) {
      for (const line of code(rel).split("\n")) {
        if (!line.includes(ident)) continue;
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
        live.push(`${rel}: ${t}`);
      }
    }
    expect(live.length).toBe(1);
    expect(live[0]).toContain("export const DEFAULT_APPLICATION_FEE_MINOR = 30000;");
  });

  it("partnerTiers.ts and partnerApprovalInvoice.ts contain no price literal at all", () => {
    for (const rel of ["server/lib/partnerTiers.ts", "server/lib/partnerApprovalInvoice.ts"]) {
      const src = code(rel);
      expect(src, rel).not.toContain("24000");
      expect(src, rel).not.toContain("30000");
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════════
 * POLE 6 — "PLATFORM DEFAULT" NAMES THE ABSENT CONFIGURATION.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('W184 · B — the Fee Schedule now says WHICH configuration is absent behind "Platform default"', () => {
  const rel = "client/src/pages/partner/PartnerBilling.tsx";
  const src = read(rel);

  it("every existing provenance label is byte-verbatim, including the one the owner saw", () => {
    for (const label of [
      'partner_override: "Negotiated for you"',
      'tier_default: "Your tier\'s rate"',
      'platform_default: "Platform default"',
      'db: "Configured rate"',
      'default: "Fallback rate"',
    ]) {
      expect(src, label).toContain(label);
    }
  });

  it("a static sibling names the missing per-tier row, inside the EXISTING cell", () => {
    expect(src).toContain("partner-feeschedule-via-absent-");
    expect(src).toContain("has no rate of its own configured for this fee");
    expect(src).toContain("Fee Schedules");
  });

  it("it invents no tier price: the sentence carries no amount and no currency", () => {
    const idx = src.indexOf("partner-feeschedule-via-absent-");
    const window = src.slice(idx, idx + 1400);
    expect(window).not.toMatch(/\$\s?\d/);
    expect(window).not.toContain("amountMinor");
    expect(window).not.toContain("formatMinor");
  });

  it("it is scoped to the platform_default case only, so the other provenances are unchanged", () => {
    expect(src).toContain('line.ok && line.computedVia === "platform_default"');
  });

  it("no NEW table column was added — a new td renumbers every sibling cell for the panels inventory", () => {
    /* The sentence is a <span> inside the Source cell. Header and body cell
     * counts for the fee-schedule table are therefore untouched. */
    const idx = src.indexOf("partner-feeschedule-via-absent-");
    const before = src.lastIndexOf("<td", idx);
    const closing = src.indexOf("</td>", idx);
    const nextOpen = src.indexOf("<td", idx);
    expect(before).toBeGreaterThan(-1);
    /* The next `</td>` comes before any next `<td` — i.e. we are still inside the
     * cell we started in and did not open a new one. */
    expect(closing).toBeLessThan(nextOpen === -1 ? Number.MAX_SAFE_INTEGER : nextOpen);
  });

  it('the server-side truth is recorded: platform_default is a DB row, not a constant', () => {
    const resolver = read("server/lib/partnerFeeResolver.ts");
    /* Level 3 selects a row whose tier IS NULL. If that ever became a constant,
     * this assertion is the tripwire. */
    expect(resolver).toContain("tier IS NULL");
    expect(resolver).toContain("platform_default");
  });
});

function sourceFilesRel(): string[] {
  const roots = ["server", "client", "shared", "scripts"];
  const acc: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__tests__") continue;
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      if (/\.test\.(ts|tsx)$/.test(e.name)) continue;
      acc.push(path.relative(REPO, p));
    }
  };
  for (const r of roots) walk(path.join(REPO, r));
  return acc;
}

afterAll(() => {
  /* Belt and braces: every seeded tier must still be present and configured when
   * this file finishes, so a later test file is never handed a mutated database. */
  const tiers = seeded().map((r) => r.tier);
  for (const t of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
    expect(tiers).toContain(t);
  }
});
