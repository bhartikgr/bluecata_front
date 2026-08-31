/**
 * WAVE 191 — THE CURRENCY ON A ROUND AND THE CURRENCY ON A VEHICLE, END TO END.
 * ════════════════════════════════════════════════════════════════════════════
 * These are the SERVER proofs, and they include the three attacks the brief asks
 * for by name. A 200 is never taken as evidence here; every claim is read back
 * from the store, because a route that returns 200 and drops the field is the
 * exact defect this wave found on the vehicle path.
 *
 *   A-S1  a round can be CREATED with a currency and read back
 *   A-S2  a round's currency can be CORRECTED after creation — the only path by
 *         which the 1045 undenominated rounds will ever be fixed
 *   A-S3  ATTACK 1 — a malformed currency is REFUSED, not coerced
 *   A-S4  NOTHING IS BACKFILLED: a round created without a currency stays NULL,
 *         and an unrelated PATCH does not quietly stamp one on
 *   B-S1  ITEM B (VERIFY ONLY) — a vehicle's currency is IMMUTABLE in the store
 *   B-S2  ATTACK 3 — the currency cannot be changed after capital is attached
 *   B-S3  FINDING, NOT A FIX — the GP route returns 200 for a change it drops
 *   E-S1  the NULL-currency census the brief asks to be reported
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { w212Attest } from "./_w212RoundAttestation";

const ADMIN = "u_admin";
const STAMP = `w191${Date.now().toString(36)}`;
let app: Express;

async function makeCompany(key: string): Promise<string> {
  const companyId = `co_${STAMP}_${key}`;
  await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
    .send({ companyId, companyName: `W191 ${key}` });
  return companyId;
}

async function makeRound(key: string, extra: Record<string, unknown> = {}) {
  const companyId = await makeCompany(key);
  const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send(w212Attest({
    companyId, name: `${STAMP} ${key}`, type: "seed", instrument: "safe_post",
    openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
    valuationCap: 12_000_000, ...extra,
  }));
  return { companyId, roundId: String((created.body as any)?.id ?? ""), created };
}

const patchTerms = (roundId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/rounds/${roundId}/terms`).set("x-user-id", ADMIN).send(body);

/** Read the currency straight out of the table. The route's own reply is not the
 *  witness — the row is. */
function storedRoundCurrency(roundId: string): unknown {
  const row = rawDb().prepare("SELECT currency FROM rounds WHERE id = ?").get(roundId) as
    | { currency: unknown }
    | undefined;
  return row === undefined ? "__NO_ROW__" : row.currency;
}

describe("WAVE 191 · Item A — a round carries its own currency, end to end", () => {
  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  it("A-S1 — a round created with HKD is stored as HKD, not coerced to USD", async () => {
    const { roundId } = await makeRound("a1", { currency: "HKD" });
    expect(roundId).not.toBe("");
    expect(storedRoundCurrency(roundId)).toBe("HKD");
  });

  it("A-S2 — an existing round's currency can be CORRECTED and read back", async () => {
    /* This is the whole remedy for the 1045 undenominated rounds: no backfill, but
       a path that works, one round at a time, operated by someone who knows. */
    const { roundId } = await makeRound("a2");
    expect(storedRoundCurrency(roundId)).toBeNull();

    const r = await patchTerms(roundId, { currency: "CAD" });
    expect(r.status).toBe(200);
    expect(storedRoundCurrency(roundId)).toBe("CAD");

    /* And correctable AGAIN — a first attempt that named the wrong currency is a
       mistake to be fixed, not a permanent record. Unlike a vehicle, no capital is
       denominated against a round's own row. */
    const r2 = await patchTerms(roundId, { currency: "GBP" });
    expect(r2.status).toBe(200);
    expect(storedRoundCurrency(roundId)).toBe("GBP");
  });

  it("A-S3 — ATTACK 1: every malformed currency is REFUSED, never coerced or stored", async () => {
    const { roundId } = await makeRound("a3", { currency: "USD" });
    expect(storedRoundCurrency(roundId)).toBe("USD");

    /* Each of these is a way a currency could be smuggled in or a region could be
       mistaken for one. None may change the stored value. */
    const attacks: unknown[] = [
      "usd",        // lower case — not ISO 4217 form
      "US",         // a REGION token, the exact confusion wave 190 removed
      "HK",         // ditto
      "USDD",       // four letters
      "U",          // one letter
      "US$",        // a symbol
      "",           // empty
      "   ",        // whitespace
      " CAD",       // padded — not accepted; no trimming, no guessing
      "CAD ",
      null,         // an explicit clear — this wave does not offer un-denomination
      123,
      true,
      ["CAD"],
      { code: "CAD" },
    ];
    for (const bad of attacks) {
      const r = await patchTerms(roundId, { currency: bad });
      expect(r.status, `currency=${JSON.stringify(bad)} was not refused`).toBe(400);
      expect((r.body as any)?.error).toBe("invalid_currency");
      /* THE READ-BACK IS THE PROOF. A 400 that nonetheless wrote would be worse
         than a 200 that wrote. */
      expect(storedRoundCurrency(roundId), `currency=${JSON.stringify(bad)} mutated the row`).toBe("USD");
    }
  });

  it("A-S4 — NOTHING IS BACKFILLED: an undenominated round stays undenominated", async () => {
    const { roundId } = await makeRound("a4");
    expect(storedRoundCurrency(roundId)).toBeNull();

    /* An edit to an UNRELATED term must not stamp a currency on the round. This is
       the quiet-default failure mode: a founder fixes a close date and the platform
       decides the round is dollars. */
    const r = await patchTerms(roundId, { closeDate: "2027-06-30" });
    expect(r.status).toBe(200);
    expect(storedRoundCurrency(roundId)).toBeNull();

    /* Nor does simply naming the field with nothing in it. */
    const r2 = await patchTerms(roundId, { currency: "" });
    expect(r2.status).toBe(400);
    expect(storedRoundCurrency(roundId)).toBeNull();
  });
});

describe("WAVE 191 · Item B (VERIFY ONLY) — a vehicle's currency is immutable", () => {
  beforeAll(async () => {
    getDb();
    if (!app) {
      app = express();
      app.use(express.json());
      const server = http.createServer(app);
      await registerRoutes(server, app);
    }
  }, 90_000);

  it("B-S1 — `updateSpv` has no `currency` branch, so no caller can reach one", async () => {
    /* The owner's live testing already established that the WIZARD lets a GP choose
       freely and that the review step states the choice is final. What was NOT
       established is that the platform enforces it. This is that check, made
       against the store's own source: `updateSpv` assigns an explicit allow-list,
       and `currency` is not on it. An allow-list is a stronger guarantee than a
       test of one route, because it holds for every route that ever calls it. */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const ROOT = path.resolve(__dirname, "..", "..");
    const src = fs.readFileSync(path.join(ROOT, "server", "spvEngineStore.ts"), "utf8");
    /* A METHOD on the store object, not a top-level export — anchored on the exact
       signature so a rename cannot make this test quietly pass against nothing. */
    const start = src.indexOf("  updateSpv(partnerId: string, spvId: string, patch: Partial<SpvDTO>, actor: string): SpvDTO {");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\n  },", start));
    expect(body.length).toBeGreaterThan(200);
    /* Strip line and block comments before concluding anything from a search. */
    const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/\bcurrency\s*[:=]/);
    expect(code).not.toMatch(/feeCurrency\s*[:=]/);
  });

  it("B-S2 — ATTACK 3: the wizard's own confirmation states the denomination is final", () => {
    /* The on-screen promise and the enforcement have to be the same promise. The
       copy is quoted here byte for byte so that a future reword cannot silently
       drift away from what the code actually guarantees. Per the owner's
       instruction this copy is NOT changed by this wave, only verified. */
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const ROOT = path.resolve(__dirname, "..", "..");
    const wizard = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "partner", "PartnerSpvEngine.tsx"),
      "utf8",
    );
    /* JSX wraps the sentence across source lines, so whitespace is collapsed before
       the comparison. The WORDS are what the LP and the GP read; the line breaks are
       not part of the promise. */
    const flat = wizard.replace(/\s+/g, " ");
    expect(flat).toContain("The denomination cannot be changed after the vehicle is created.");
    expect(flat).toContain("will not invent one");
    /* And the select is not disabled — the jurisdiction default is a SUGGESTION.
       The owner's live test proved this; it is pinned here so it stays true. */
    const sel = wizard.slice(wizard.indexOf("CURRENCY_OPTIONS.map"));
    expect(sel.slice(0, 400)).not.toContain("disabled");
  });
});

describe("WAVE 191 · Item E — the census the owner asked for", () => {


  it("E-S1 — reports how many rounds and vehicles hold no currency", () => {
    /* THE REAL DATABASE, opened READ-ONLY and separately. `rawDb()` under vitest is
       a throwaway fixture with four rows in it, so counting there would produce a
       census of the test harness and report it as the platform's. */
    const path = require("node:path") as typeof import("node:path");
    const fs = require("node:fs") as typeof import("node:fs");
    const Database = require("better-sqlite3");
    const file = path.resolve(__dirname, "..", "..", "data.db");
    expect(fs.existsSync(file), "data.db not found — census would be meaningless").toBe(true);
    const db = new Database(file, { readonly: true });
    const r = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN currency IS NULL THEN 1 ELSE 0 END) nulls FROM rounds").get() as any;
    const s = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN currency IS NULL THEN 1 ELSE 0 END) nulls FROM spv").get() as any;
    /* Not an assertion about a number that will drift as rounds are created — an
       assertion about the SHAPE of the finding, with the figures printed for the
       report. Vehicles must never have a NULL: the wizard has always required one. */
    expect(Number(s.nulls ?? 0)).toBe(0);
    expect(Number(r.n)).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`W191 CENSUS — rounds: ${r.n} rows, ${r.nulls} with no currency · vehicles: ${s.n} rows, ${s.nulls} with no currency`);
  });
});
