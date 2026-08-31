/**
 * WAVE 184 · ITEM A · R156.1 — NO CURRENCY CONVERSION ANYWHERE (server half).
 *
 * OWNER RULING, verbatim: "I would rather stay clear of any online FX rates. If
 * an SPV or a round is in one currency, it is up to the investor to deliver
 * exactly in that currency. I fear that if we start to play with currencies,
 * then we will open up the platform to miscalculations."
 *
 * The requirement is REMOVED, not deferred. No conversion means no rate, and
 * therefore no staleness, rounding or attribution defect.
 *
 * TWO POLES, because either alone is defeatable:
 *
 *   · a GREP POLE — no non-test source file reads the `fx_rates` table. This
 *     catches a conversion added back anywhere in the tree, including in a file
 *     this wave never looked at. It runs over COMMENT-STRIPPED source, because
 *     `fx_rates` is named in several explanatory comments (including the ones
 *     this wave wrote) and a naive grep would fail on prose.
 *   · a BEHAVIOURAL POLE — the one function that used to perform the read now
 *     refuses by name, and the HTTP route that published its output states the
 *     delivery rule instead of publishing rates. A grep pole alone would pass
 *     against a build that silently returned `{}`, which is a blank, which is
 *     forbidden.
 *
 * AND A PRESERVATION POLE. The `fx_rates` TABLE and its seven seed rows must
 * still be there: they live in server/db/connection.ts, which is SACRED under
 * WAIVER-6, and R156.1 removes the READS while leaving the table alone. A wave
 * that "cleaned up" the table would have needed a tenth waiver, which R121
 * forbids outright. This pole fails if anyone drops or re-seeds it.
 *
 * Establishes its own preconditions; no process.env; static imports only.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import request from "supertest";
import {
  softCircleRates,
  registerPaymentRoutes,
  NO_CURRENCY_CONVERSION_RULE,
  E_FX_CONVERSION_REMOVED,
} from "../paymentStore";
import { rawDb } from "../db/connection";

const REPO = path.resolve(__dirname, "..", "..");

/* ---------------------------------------------------------------------------
 * A length-preserving comment stripper. Blanks `//` and block comments and the
 * insides of string/template literals are LEFT ALONE, because a SQL statement
 * lives inside a template literal and that is precisely what we are hunting.
 * Length preservation is not decoration: it keeps reported offsets honest and
 * makes the self-check below meaningful.
 * ------------------------------------------------------------------------- */
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
    // inside a string / template literal
    if (c === "\\") { i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code"; i += 1; continue;
    }
    i += 1;
  }
  return out.join("");
}

function sourceFiles(): string[] {
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
      acc.push(p);
    }
  };
  for (const r of roots) walk(path.join(REPO, r));
  return acc;
}

describe("W184 · A — the comment stripper actually strips (a self-check, so the grep pole cannot be vacuous)", () => {
  it("blanks a comment mentioning fx_rates while preserving a SQL string that mentions it", () => {
    const probe = `/* SELECT rate FROM fx_rates */\nconst q = \`SELECT rate FROM fx_rates\`;\n// FROM fx_rates\n`;
    const stripped = stripComments(probe);
    expect(stripped.length).toBe(probe.length);
    /* Exactly ONE survivor: the one inside the template literal. */
    expect(stripped.match(/fx_rates/g)?.length).toBe(1);
    expect(stripped).toContain("const q =");
  });

  it("finds a real, known-present SQL identifier in real source, so it is not silently blanking everything", () => {
    const src = stripComments(fs.readFileSync(path.join(REPO, "server/lib/partnerCommissionRateResolver.ts"), "utf8"));
    expect(src).toContain("partner_commission_rate_config");
  });
});

describe("W184 · A — GREP POLE: no source file reads the fx_rates table", () => {
  it("zero non-test files reference fx_rates in code (comments excluded)", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const stripped = stripComments(fs.readFileSync(f, "utf8"));
      if (/fx_rates/.test(stripped)) offenders.push(path.relative(REPO, f));
    }
    /* server/db/connection.ts is the SOLE permitted mention: it CREATEs and
     * SEEDs the table, is sacred under WAIVER-6, and R156.1 leaves it alone. */
    expect(offenders).toEqual(["server/db/connection.ts"]);
  });

  it("no source file performs a SELECT against fx_rates", () => {
    const offenders: string[] = [];
    for (const f of sourceFiles()) {
      const stripped = stripComments(fs.readFileSync(f, "utf8")).replace(/\s+/g, " ");
      if (/SELECT[^;]{0,200}FROM fx_rates/i.test(stripped)) offenders.push(path.relative(REPO, f));
    }
    expect(offenders).toEqual([]);
  });
});

describe("W184 · A — BEHAVIOURAL POLE: the former conversion site refuses, and never blanks", () => {
  it("softCircleRates() refuses by name instead of returning a rate map", () => {
    expect(() => softCircleRates()).toThrow(E_FX_CONVERSION_REMOVED);
  });

  it("the refusal is never an empty map, a zero, or a { USD: 1 } stand-in", () => {
    let caught: unknown = null;
    try { softCircleRates(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    /* It states the delivery rule in plain language, in the owner's own terms. */
    expect(msg).toContain("no exchange rate");
    expect(msg).toContain("delivered in that same currency");
    expect(msg).toContain("never added together");
  });

  it("the stated rule names no single currency — the denomination comes from the vehicle", () => {
    for (const code of ["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"]) {
      expect(NO_CURRENCY_CONVERSION_RULE).not.toContain(code);
    }
  });
});

describe("W184 · A — the rates ROUTE still exists (no silent drops) and states the rule", () => {
  const app: Express = express();
  app.use(express.json());
  registerPaymentRoutes(app);

  it("GET /api/payments/_meta/rates is still registered and answers a named refusal", async () => {
    const res = await request(app).get("/api/payments/_meta/rates");
    /* Not a 404: removing the route would be a silent drop. Not a 500: the
     * platform is not broken, it has decided not to convert. */
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(E_FX_CONVERSION_REMOVED);
    expect(res.body.conversion).toBe("not_supported");
    expect(res.body.message).toBe(NO_CURRENCY_CONVERSION_RULE);
  });

  it("it publishes no rate of any kind", async () => {
    const res = await request(app).get("/api/payments/_meta/rates");
    expect(res.body.rates).toBeUndefined();
    const flat = JSON.stringify(res.body);
    /* No numeric rate anywhere in the payload. The seeded rates were 1.35, 0.79,
     * 0.92, 7.81, 7.27 — a decimal number in this response would mean one leaked. */
    expect(/\d+\.\d+/.test(flat)).toBe(false);
  });

  it("the SUPPORTED DENOMINATIONS list survives — it is not a set of convertible pairs", async () => {
    const res = await request(app).get("/api/payments/_meta/rates");
    expect(res.body.supported).toEqual(["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"]);
  });
});

describe("W184 · A — PRESERVATION POLE: the sacred fx_rates table and seed are untouched", () => {
  it("the table still exists with all seven seeded rows", () => {
    const rows = rawDb()
      .prepare(`SELECT currency_code, rate FROM fx_rates ORDER BY currency_code`)
      .all() as Array<{ currency_code: string; rate: number }>;
    expect(rows.length).toBe(7);
    expect(rows.map((r) => r.currency_code)).toEqual(["CAD", "CNY", "EUR", "GBP", "HKD", "SGD", "USD"]);
    /* The values are asserted only as "still numeric and still there". This wave
     * neither trusts them nor changes them. */
    for (const r of rows) expect(Number.isFinite(r.rate)).toBe(true);
  });

  it("the CREATE TABLE and its seed are still present in the sacred connection file", () => {
    const src = fs.readFileSync(path.join(REPO, "server/db/connection.ts"), "utf8");
    expect(src).toContain("fx_rates");
    expect((src.match(/INSERT OR IGNORE INTO fx_rates/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("W184 · A — the SPV/fund backfill refuses a stored FX rate instead of converting it", () => {
  /* A source-level pole rather than a boot-level one. `backfillLegacyChildCommitments`
   * runs inside `hydrateSpvEngineStore` behind a `_migrations_applied` idempotency
   * gate and reads `kv_partnerSpvPositions` / `kv_partnerFundCommitments`, which
   * hold ZERO rows in this checkout — so a behavioural assertion here would need
   * to re-drive the whole hydration to observe a branch that has no input. What
   * is asserted instead is the thing that can actually regress: that the guard
   * stands BEFORE the conversion call for both loops, and that the reason is
   * named rather than the row being silently dropped or raw-summed. */
  const src = fs.readFileSync(path.join(REPO, "server/spvEngineStore.ts"), "utf8");
  const code = stripComments(src);

  it("both fx-rate fields are guarded, and the guard precedes the conversion call", () => {
    for (const field of ["fxRateToSpvBase", "fxRateToFundBase"]) {
      const guard = code.indexOf(`if (p.${field})`) >= 0
        ? code.indexOf(`if (p.${field})`)
        : code.indexOf(`if (c.${field})`);
      expect(guard, `guard for ${field}`).toBeGreaterThan(-1);
      const conversion = code.indexOf(`${field},\n          );`);
      if (conversion > -1) expect(guard).toBeLessThan(conversion);
    }
  });

  it("each guard quarantines and continues rather than converting", () => {
    /* Two new guards, each followed by quarantine + continue. */
    const guarded = code.match(/if \([pc]\.fxRateTo(Spv|Fund)Base\)\s*\{[\s\S]{0,900}?quarantined\+\+;\s*continue;/g) ?? [];
    expect(guarded.length).toBeGreaterThanOrEqual(2);
  });

  it("the refusal message states the delivery rule, so a reader is never left with a bare drop", () => {
    expect(src).toContain("R156.1 removed currency conversion, so this amount is NOT converted.");
    expect(src).toContain("funds must be delivered");
  });
});
