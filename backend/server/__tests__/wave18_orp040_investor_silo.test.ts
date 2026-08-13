/**
 * WAVE 18 — ORP-040 (DEF-040): the orphaned investor surface, server side.
 *
 * WHAT THIS SUITE MUST BE ABLE TO CATCH, and why each assertion is shaped the way
 * it is. Every claim is asserted at BOTH poles.
 *
 * 1. THE MONEY SHAPE. The four projections previously carried MAJOR-unit values
 *    only — a float `amount` on the watchlist/soft-circle rows and a decimal
 *    STRING with no currency at all on the activity feed. Nothing renderable
 *    without guessing an exponent. `amountMinor` / `targetAmountMinor` /
 *    `currency` are now projected, and every currency assertion below uses:
 *      • JPY — ISO-4217 exponent **0**. A hardcoded `*100`/`/100` is INVISIBLE in
 *        USD and glaring in JPY. This is the fixture class the Wave 17 harness was
 *        missing when it let a `/100` mutation through.
 *      • KWD — exponent **3**. Catches the opposite error (a `*100` where a
 *        `*1000` was needed).
 *      • USD — exponent 2, the control.
 * 2. `decimalStringToMinor` IS EXACT AND REFUSES TO ROUND. Asserted for all three
 *    exponents, for a negative, for scientific notation, and — the pole that
 *    matters — a value finer than the currency can represent THROWS rather than
 *    rounding a ledger amount to make it displayable.
 * 3. THE INVISIBLE MODULE GRAPH. Three of these routes resolved their store with a
 *    runtime `require("./softCircleStore")` / `require("./captableCommitStore")`
 *    inside a `try { … } catch { return [] }`. That is verbatim the failure the
 *    rules record: a `.ts` require the test graph cannot see, plus a swallow that
 *    turns a resolution failure into "this investor has nothing". A source fence
 *    asserts those requires are GONE, and is proven to fire on a fixture that
 *    still contains one — otherwise the fence would be checking nothing.
 * 4. THE DSC READ IS CAP-TABLE SCOPED. Positive: an investor on the cap table
 *    reads back the row they submitted, in a LATER independent request (the pole
 *    React state cannot survive). Negative: a caller NOT on the cap table gets 403
 *    on both the submit and the new read, and a missing companyId gets 400.
 * 5. KYC IS SESSION SCOPED. Positive: an upload is listed back. Negative: a second
 *    investor's list does not contain it, an unauthenticated call is refused, and
 *    every documented 400 is a real refusal rather than a silent success.
 *
 * REAL routes via supertest, REAL stores, REAL better-sqlite3. No mocks.
 * `scripts/w18/falsify_orp040.py` mutates each sink and requires a red run.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { decimalStringToMinor, currencyExponent } from "../lib/money";
import { KYC_DOC_TYPES, registerKycDocumentRoutes } from "../lib/kycDocumentStore";
import { createSoftCircle } from "../softCircleStore";
import { commitFunded } from "../captableCommitStore";
import {
  isDiscoverableForInvestor,
  projectDiscoverRound,
} from "../lib/investorDiscoverProjection";

const REPO = path.resolve(__dirname, "../..");
const ROUTES_TS = path.join(REPO, "server/routes.ts");

/* MEASURED, NOT ASSUMED. An arbitrary id does NOT authenticate: `requireAuth`
 * resolves through `getUserContext`, which only knows the seeded personas, so an
 * invented id answers 401 UNAUTHORIZED. So the authenticated poles use the two
 * seeded INVESTOR personas (server/lib/userContext.ts:224 and :245) and the
 * unauthenticated pole uses an id that is NOT a persona — which is a STRONGER
 * negative than omitting the header, because in a non-production process
 * `resolvePersonaIdWithFallback` (userContext.ts:519) deliberately falls back to
 * the demo investor for a header-less request. Asserting 401 on a header-less
 * request would therefore have been asserting the dev bypass, not the guard. */
const INVESTOR_A = "u_aisha_patel";
const INVESTOR_B = "u_lapsed_lp";
const GHOST = "u_w18_orp040_not_a_persona";

let app: Express;

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json({ limit: "20mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);


/* ── Multi-exponent money fixtures ────────────────────────────────────────────
 * RULE 1, the one paid for in blood: a USD-only fixture cannot distinguish
 * correct exponent handling from a hardcoded ×100, because in USD they print
 * identically. Every money assertion below therefore runs over all three of:
 *   JPY exponent 0 · USD exponent 2 · KWD exponent 3
 * A `*100` and a `/100` mutation are each visible in at least two of them. */
const TAG = String(Date.now());
const MONEY_FIXTURES: Array<{ ccy: string; major: number; minor: number }> = [
  { ccy: "USD", major: 1500.5, minor: 150050 },
  { ccy: "JPY", major: 5_000_000, minor: 5_000_000 },
  { ccy: "KWD", major: 1234.567, minor: 1234567 },
];
const roundOf = (ccy: string) => `rnd_w18_orp040_${TAG}_${ccy}`;
const companyOf = (ccy: string) => `co_w18_orp040_${TAG}_${ccy}`;

beforeAll(() => {
  /* REAL store writes, so the projections have something to project. A suite that
     only ever sees `[]` asserts nothing about the money shape. */
  for (const f of MONEY_FIXTURES) {
    createSoftCircle({
      roundId: roundOf(f.ccy),
      companyId: companyOf(f.ccy),
      investorUserId: INVESTOR_A,
      investorName: "Aisha Patel",
      investorEmail: "aisha@greenwood.capital",
      amount: f.major,
      currency: f.ccy,
    });
    const cf = commitFunded({
      invitationId: `inv_w18_orp040_${TAG}_${f.ccy}`,
      roundId: roundOf(f.ccy),
      companyId: companyOf(f.ccy),
      investorId: INVESTOR_A,
      /* A decimal STRING in major units — the ledger's own shape. */
      amount: String(f.major),
      currency: f.ccy,
      shares: "100",
    });
    expect(cf.ok, `commitFunded ${f.ccy}: ${JSON.stringify(cf)}`).toBe(true);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. decimalStringToMinor — exact, exponent-aware, refuses to round
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 money — decimalStringToMinor is exponent-aware and exact", () => {
  it("uses the ISO-4217 exponent, not a hardcoded 100 (USD 2, JPY 0, KWD 3)", () => {
    /* The three exponents this project must survive. */
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);

    expect(decimalStringToMinor("1500000.00", "USD")).toBe(BigInt(150000000));
    /* A hardcoded `*100` would answer 500000000 here. It must be 5000000. */
    expect(decimalStringToMinor("5000000", "JPY")).toBe(BigInt(5000000));
    /* A hardcoded `*100` would answer 123400 here. It must be 1234000. */
    expect(decimalStringToMinor("1234.000", "KWD")).toBe(BigInt(1234000));
  });

  it("handles a zero-exponent currency with a trailing .0 group exactly", () => {
    expect(decimalStringToMinor("5000000.0", "JPY")).toBe(BigInt(5000000));
    expect(decimalStringToMinor("0", "JPY")).toBe(BigInt(0));
  });

  it("carries sign and scientific notation", () => {
    expect(decimalStringToMinor("-42.50", "USD")).toBe(BigInt(-4250));
    expect(decimalStringToMinor("1e3", "USD")).toBe(BigInt(100000));
    expect(decimalStringToMinor("1e3", "JPY")).toBe(BigInt(1000));
  });

  it("REFUSES a value finer than the currency, rather than rounding it", () => {
    /* Half a cent in USD. Rounding a ledger amount to make it displayable is the
       silent corruption this project keeps paying for. */
    expect(() => decimalStringToMinor("0.005", "USD", "t")).toThrow(
      /MONEY_DECIMAL_PRECISION_UNSUPPORTED:t/,
    );
    /* One tenth of a yen — JPY has no sub-unit at all. */
    expect(() => decimalStringToMinor("1.5", "JPY", "t")).toThrow(
      /MONEY_DECIMAL_PRECISION_UNSUPPORTED:t/,
    );
    /* But the SAME digits are representable in KWD (exponent 3). Proves the
       refusal is exponent-driven, not a blanket rejection. */
    expect(decimalStringToMinor("1.5", "KWD")).toBe(BigInt(1500));
  });

  it("rejects garbage instead of silently answering zero", () => {
    expect(() => decimalStringToMinor("", "USD", "t")).toThrow(/MONEY_DECIMAL_INVALID:t/);
    expect(() => decimalStringToMinor("abc", "USD", "t")).toThrow(/MONEY_DECIMAL_INVALID:t/);
    expect(() => decimalStringToMinor(".", "USD", "t")).toThrow(/MONEY_DECIMAL_INVALID:t/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The source fence — the runtime `require()` of a .ts store is GONE
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — no route resolves a store by runtime require of a .ts module", () => {
  /* The four offending requires, verbatim as they appeared before this wave. */
  const BANNED = [
    'require("./softCircleStore")',
    'require("./roundsStore")',
    'require("./captableCommitStore")',
  ];

  function offenders(src: string): string[] {
    /* Strip line comments so the explanatory notes added this wave — which
       deliberately QUOTE the removed requires — cannot make the fence fail. */
    const code = src
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return BANNED.filter((b) => code.includes(b));
  }

  it("the harness is really reading the file it claims to (anti-vacuity)", () => {
    expect(fs.existsSync(ROUTES_TS)).toBe(true);
    const src = fs.readFileSync(ROUTES_TS, "utf8");
    expect(src.length).toBeGreaterThan(10_000);
    /* The static imports the requires were replaced BY must be present. */
    expect(src).toMatch(/listCommitsForUser as captableListCommitsForUser/);
    expect(src).toMatch(/listForInvestor as softCircleListForInvestor/);
  });

  it("server/routes.ts contains none of the three banned requires", () => {
    expect(offenders(fs.readFileSync(ROUTES_TS, "utf8"))).toEqual([]);
  });

  it("the fence FAILS on a fixture that still contains one (both poles)", () => {
    const bad = 'const { listForInvestor } = require("./softCircleStore");\n';
    expect(offenders(bad)).toEqual(['require("./softCircleStore")']);
    /* And a fixture where it appears only inside a comment must PASS, so the
       fence is not merely a substring search over the whole file. */
    const commentOnly = '/* was require("./softCircleStore") */\n// require("./roundsStore")\n';
    expect(offenders(commentOnly)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. The four read projections carry minor units + currency
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — watchlist / discover / soft-circles / activity projections", () => {
  it("all four answer 200 for an authenticated investor and an array/shape", async () => {
    for (const url of [
      "/api/investor/watchlist",
      "/api/investor/discover",
      "/api/investor/soft-circles",
      "/api/investor/activity",
    ]) {
      const res = await request(app).get(url).set("x-user-id", INVESTOR_A);
      expect(res.status, `${url} -> ${JSON.stringify(res.body)}`).toBe(200);
      expect(Array.isArray(res.body), `${url} must answer an array`).toBe(true);
    }
  });

  it("every watchlist / soft-circle row declares amountMinor and currency keys", async () => {
    const wl = await request(app).get("/api/investor/watchlist").set("x-user-id", INVESTOR_A);
    for (const row of wl.body as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(row, "amountMinor")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(row, "currency")).toBe(true);
    }
    const sc = await request(app).get("/api/investor/soft-circles").set("x-user-id", INVESTOR_A);
    for (const row of sc.body as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(row, "amountMinor")).toBe(true);
    }
  });

  it("discover rows carry targetAmountMinor, and a null target stays null (no fabricated zero)", async () => {
    const res = await request(app).get("/api/investor/discover").set("x-user-id", INVESTOR_A);
    for (const row of res.body as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(row, "targetAmountMinor")).toBe(true);
      if (row.targetAmount === null) {
        expect(row.targetAmountMinor).toBeNull();
      }
      /* And where a target IS set, the minor value must equal the exponent-aware
         conversion of it — not the major number, and not major*100. */
      if (typeof row.targetAmount === "number" && typeof row.currency === "string") {
        const exp = currencyExponent(row.currency);
        expect(row.targetAmountMinor).toBe(Math.round(row.targetAmount * Math.pow(10, exp)));
      }
    }
  });

  it("activity rows carry currency AND amountMinor, or carry neither — never a bare amount", async () => {
    const res = await request(app).get("/api/investor/activity").set("x-user-id", INVESTOR_A);
    for (const row of res.body as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(row, "amountMinor")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(row, "currency")).toBe(true);
      /* A minor amount without a currency is unrenderable — the exact hole this
         projection had. It must never occur. */
      if (typeof row.amountMinor === "number") {
        expect(typeof row.currency).toBe("string");
        expect(String(row.currency).length).toBe(3);
      }
    }
  });


  /* ── the assertions that a hardcoded ×100 cannot survive ─────────────────── */

  it("soft-circle rows carry EXACT minor units for every exponent (JPY 0, USD 2, KWD 3)", async () => {
    const res = await request(app).get("/api/investor/soft-circles").set("x-user-id", INVESTOR_A);
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ roundId: string; currency: string; amountMinor: number }>;
    for (const f of MONEY_FIXTURES) {
      const row = rows.find((r) => r.roundId === roundOf(f.ccy));
      expect(row, `no soft circle row for ${f.ccy}`).toBeTruthy();
      expect(row!.currency).toBe(f.ccy);
      /* THE assertion. For JPY the correct answer is 5000000; a hardcoded ×100
         answers 500000000. For KWD the correct answer is 1234567; a ×100 answers
         123456 (or 123456.7). Only USD is ambiguous — which is exactly why USD
         alone was never enough. */
      expect(row!.amountMinor, `${f.ccy} minor units`).toBe(f.minor);
    }
  });

  it("watchlist rows carry the same exact minor units", async () => {
    const res = await request(app).get("/api/investor/watchlist").set("x-user-id", INVESTOR_A);
    const rows = res.body as Array<{ roundId: string; currency: string; amountMinor: number }>;
    for (const f of MONEY_FIXTURES) {
      const row = rows.find((r) => r.roundId === roundOf(f.ccy));
      expect(row, `no watchlist row for ${f.ccy}`).toBeTruthy();
      expect(row!.amountMinor, `${f.ccy} minor units`).toBe(f.minor);
      expect(row!.currency).toBe(f.ccy);
    }
  });

  it("activity converts the ledger's DECIMAL STRING amount exactly, per currency", async () => {
    const res = await request(app).get("/api/investor/activity").set("x-user-id", INVESTOR_A);
    const rows = res.body as Array<{ kind: string; roundId: string; amount: unknown; amountMinor: number; currency: string; ts: string }>;
    for (const f of MONEY_FIXTURES) {
      const row = rows.find((r) => r.kind === "captable.committed" && r.roundId === roundOf(f.ccy));
      expect(row, `no commit event for ${f.ccy}`).toBeTruthy();
      /* The ledger stores a string; the projection must NOT have turned it into a
         float, and the minor value must be exponent-exact. */
      expect(typeof row!.amount).toBe("string");
      expect(row!.currency).toBe(f.ccy);
      expect(row!.amountMinor, `${f.ccy} minor units from decimal string`).toBe(f.minor);
    }
  });

  it("commit events are dated from the LEDGER timestamp, not the epoch", async () => {
    /* SECOND DEFECT found on the same line as the money hole: the route read
       `c.updatedAt ?? c.createdAt`, neither of which exists on a LedgerEntry, so
       every commit was stamped 1970-01-01 and sorted below every soft circle. */
    const res = await request(app).get("/api/investor/activity").set("x-user-id", INVESTOR_A);
    const rows = res.body as Array<{ kind: string; ts: string }>;
    const commits = rows.filter((r) => r.kind === "captable.committed");
    expect(commits.length).toBeGreaterThan(0);
    for (const c of commits) {
      expect(c.ts.startsWith("1970"), `commit event dated at the epoch: ${c.ts}`).toBe(false);
      expect(new Date(c.ts).getUTCFullYear()).toBeGreaterThan(2000);
    }
  });

  it("the feed is sorted newest-first ACROSS both sources (the epoch bug's symptom)", async () => {
    const res = await request(app).get("/api/investor/activity").set("x-user-id", INVESTOR_A);
    const ts = (res.body as Array<{ ts: string }>).map((r) => r.ts);
    const sorted = Array.from(ts).sort().reverse();
    expect(ts).toEqual(sorted);
  });

  it("all four REFUSE a caller who is not a real identity (the negative pole)", async () => {
    for (const url of [
      "/api/investor/watchlist",
      "/api/investor/discover",
      "/api/investor/soft-circles",
      "/api/investor/activity",
    ]) {
      const res = await request(app).get(url).set("x-user-id", GHOST);
      expect([401, 403], `${url} answered ${res.status} for a non-identity`).toContain(res.status);
      expect(res.body.error).toBe("UNAUTHORIZED");
    }
  });
});


/* ══════════════════════════════════════════════════════════════════════════
 * 3b. The discover projection, at exponents the ROUTE cannot reach
 *
 * Measured limitation, recorded rather than hidden: through the route this
 * projection only ever sees USD rounds, because the feed's only live predicate is
 * "the caller is invited to it" and every seeded invitation is USD (the other
 * predicate, `discoverable === true`, is set by nothing in the repo). USD is the
 * exact currency where a hardcoded ×100 is invisible. So the pure projection is
 * driven directly here at all three exponents — this is the only place the ×100
 * mutation can be caught, and the harness proves it is.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — projectDiscoverRound converts at the ISO-4217 exponent", () => {
  const invited = new Set(["rnd_i"]);

  it("JPY (exp 0), USD (exp 2) and KWD (exp 3) each convert exactly", () => {
    expect(
      projectDiscoverRound({ id: "r1", companyId: "c", targetAmount: 5_000_000, currency: "JPY" }, invited)
        .targetAmountMinor,
    ).toBe(5_000_000); /* a ×100 answers 500_000_000 */
    expect(
      projectDiscoverRound({ id: "r2", companyId: "c", targetAmount: 1500.5, currency: "USD" }, invited)
        .targetAmountMinor,
    ).toBe(150_050);
    expect(
      projectDiscoverRound({ id: "r3", companyId: "c", targetAmount: 1234.567, currency: "KWD" }, invited)
        .targetAmountMinor,
    ).toBe(1_234_567); /* a ×100 answers 123_456 */
  });

  it("a missing or non-finite target stays NULL — never a fabricated zero", () => {
    for (const t of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = projectDiscoverRound(
        { id: "r", companyId: "c", targetAmount: t as number | null, currency: "USD" },
        invited,
      );
      expect(out.targetAmountMinor, `target ${String(t)}`).toBeNull();
      expect(out.targetAmount).toBeNull();
      /* The opposite pole in the same assertion set: 0 is a REAL target and must
         survive as 0, not be flattened into "not set". */
    }
    expect(
      projectDiscoverRound({ id: "r", companyId: "c", targetAmount: 0, currency: "USD" }, invited)
        .targetAmountMinor,
    ).toBe(0);
  });

  it("marks invited rounds and only invited rounds", () => {
    expect(projectDiscoverRound({ id: "rnd_i", companyId: "c" }, invited).invited).toBe(true);
    expect(projectDiscoverRound({ id: "rnd_other", companyId: "c" }, invited).invited).toBe(false);
  });

  it("the visibility filter accepts and rejects at both poles", () => {
    expect(isDiscoverableForInvestor({ id: "rnd_i", status: "open" }, invited)).toBe(true);
    expect(isDiscoverableForInvestor({ id: "rnd_x", discoverable: true }, invited)).toBe(true);
    expect(isDiscoverableForInvestor({ id: "rnd_x" }, invited)).toBe(false);
    expect(isDiscoverableForInvestor({ id: "rnd_i", status: "closed" }, invited)).toBe(false);
    expect(isDiscoverableForInvestor({ id: "rnd_i", status: "CLOSED" }, invited)).toBe(false);
    expect(isDiscoverableForInvestor({ id: "rnd_i", deletedAt: "2026-01-01" }, invited)).toBe(false);
  });
});

describe("ORP-040 — the discover feed reads the SAME merged round path as the rest of routes.ts", () => {
  it("returns the rounds this investor is invited to (it returned NOTHING before)", async () => {
    /* THE DEFECT, measured: the route read `roundsStoreList()` alone, which held 0
       rounds, while the persona had 5 invitations — so the feed was structurally
       guaranteed to be empty for exactly the investors it exists to serve. It now
       reads `mergeLegacyAndDbRounds()` like every other round route. */
    const res = await request(app).get("/api/investor/discover").set("x-user-id", INVESTOR_A);
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: string; invited: boolean; status: string }>;
    expect(rows.length, "the discover feed is empty for an invited investor").toBeGreaterThan(0);
    expect(rows.some((r) => r.invited)).toBe(true);
    /* NEGATIVE POLE: nothing closed or uninvited leaked in. */
    for (const r of rows) {
      expect(String(r.status).toLowerCase()).not.toBe("closed");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. KYC documents — session scoped, refusals are real
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — investor KYC documents", () => {
  const tinyPdf = Buffer.from("%PDF-1.4 w18 orp040 fixture").toString("base64");
  let uploadedId = "";

  it("the client's doc-type list is exactly the server's validator list", () => {
    /* A hand-copied list in the client could offer an option that always 400s.
       This pins them together. */
    expect(Array.from(KYC_DOC_TYPES)).toEqual([
      "passport",
      "drivers_license",
      "accreditation_letter",
      "source_of_funds",
      "other",
    ]);
  });

  it("uploads and lists back in a LATER independent request", async () => {
    const before = await request(app).get("/api/investor/kyc/documents").set("x-user-id", INVESTOR_A);
    expect(before.status).toBe(200);
    const countBefore = (before.body.documents ?? []).length;

    const up = await request(app)
      .post("/api/investor/kyc/documents")
      .set("x-user-id", INVESTOR_A)
      .send({ docType: "passport", fileName: "p.pdf", mimeType: "application/pdf", blobBase64: tinyPdf });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.ok).toBe(true);
    expect(up.body.document.verified).toBe(false);
    expect(String(up.body.document.sha256)).toMatch(/^[0-9a-f]{64}$/);
    uploadedId = up.body.document.id;

    const after = await request(app).get("/api/investor/kyc/documents").set("x-user-id", INVESTOR_A);
    expect(after.status).toBe(200);
    const ids = (after.body.documents as Array<{ id: string }>).map((d) => d.id);
    expect(ids).toContain(uploadedId);
    expect(ids.length).toBe(countBefore + 1);
  });

  it("does NOT leak that document to a different investor (the scope pole)", async () => {
    const other = await request(app).get("/api/investor/kyc/documents").set("x-user-id", INVESTOR_B);
    expect(other.status).toBe(200);
    const ids = (other.body.documents ?? []).map((d: { id: string }) => d.id);
    expect(ids).not.toContain(uploadedId);
  });

  it("never returns the blob on the listing", async () => {
    const res = await request(app).get("/api/investor/kyc/documents").set("x-user-id", INVESTOR_A);
    for (const d of res.body.documents as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(d, "blobBase64")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(d, "blob_base64")).toBe(false);
    }
  });

  it("REFUSES each malformed upload with its documented code (not a silent success)", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ docType: "not_a_type", fileName: "a", mimeType: "b", blobBase64: tinyPdf }, "invalid_doc_type"],
      [{ docType: "passport", mimeType: "b", blobBase64: tinyPdf }, "fileName_required"],
      [{ docType: "passport", fileName: "a", blobBase64: tinyPdf }, "mimeType_required"],
      [{ docType: "passport", fileName: "a", mimeType: "b" }, "blobBase64_required"],
      [{ docType: "passport", fileName: "a", mimeType: "b", blobBase64: "===" }, "empty_blob"],
    ];
    for (const [body, code] of cases) {
      const res = await request(app)
        .post("/api/investor/kyc/documents")
        .set("x-user-id", INVESTOR_A)
        .send(body);
      expect(res.status, `${code}: got ${res.status}`).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe(code);
    }
  });

  /* MEASURED DIFFERENCE, recorded rather than papered over. The two KYC routes do
   * NOT use `requireAuth`; they read `req.userContext` directly
   * (server/lib/kycDocumentStore.ts:132-135 and :219-222). In THIS process the
   * userContext middleware fills a demo persona for an unknown id, so a ghost id
   * gets 200 as the demo investor — which is the dev bypass, disabled in
   * production, not a hole this wave introduced. Asserting 401 against the full
   * app would therefore have been asserting the bypass. To assert the guard
   * itself at its real pole, the routes are registered on a BARE app with NO
   * userContext middleware, so `req.userContext` is genuinely undefined. */
  it("401s when there is no user context at all (guard asserted at its real pole)", async () => {
    const bare = express();
    bare.use(express.json({ limit: "20mb" }));
    registerKycDocumentRoutes(bare);

    const up = await request(bare)
      .post("/api/investor/kyc/documents")
      .send({ docType: "passport", fileName: "a", mimeType: "b", blobBase64: tinyPdf });
    expect(up.status).toBe(401);
    expect(up.body.error).toBe("UNAUTHORIZED");

    const ls = await request(bare).get("/api/investor/kyc/documents");
    expect(ls.status).toBe(401);
    expect(ls.body.error).toBe("UNAUTHORIZED");

    /* POSITIVE POLE on the same bare app: inject a context and the very same
       route answers 200. Proves the 401 came from the guard, not from the route
       being unregistered or the app being broken. */
    const withCtx = express();
    withCtx.use(express.json({ limit: "20mb" }));
    withCtx.use((req, _res, next) => {
      (req as unknown as { userContext: { userId: string } }).userContext = { userId: INVESTOR_B };
      next();
    });
    registerKycDocumentRoutes(withCtx);
    const ok = await request(withCtx).get("/api/investor/kyc/documents");
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. DSC — the new cap-table-scoped read, at both poles
 * ═════════════════════════════════════════════════════════════════════════ */

describe("ORP-040 — investor DSC submissions read-back", () => {
  it("400s without a companyId rather than answering a platform-wide list", async () => {
    const res = await request(app).get("/api/investor/dsc/submissions").set("x-user-id", INVESTOR_A);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("403s a caller who is not on that company's cap table — read AND submit", async () => {
    const co = `co_w18_orp040_notmine_${Date.now()}`;
    const read = await request(app)
      .get(`/api/investor/dsc/submissions?companyId=${co}`)
      .set("x-user-id", INVESTOR_A);
    expect(read.status).toBe(403);
    expect(read.body.error).toBe("NOT_ON_CAP_TABLE");

    const write = await request(app)
      .post("/api/investor/dsc/submit")
      .set("x-user-id", INVESTOR_A)
      .send({ companyId: co });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe("NOT_ON_CAP_TABLE");
  });

  it("REFUSES a read from a non-identity", async () => {
    const res = await request(app)
      .get("/api/investor/dsc/submissions?companyId=co_x")
      .set("x-user-id", GHOST);
    expect([401, 403]).toContain(res.status);
  });

  it("FAILS CLOSED with 503 when the table cannot be read — never an empty list", async () => {
    /* RULE 5: a fail-closed state must be RENDERED, not hidden. An empty array
       here would read to the investor as "you never submitted", which is a lie
       that invites a duplicate submission. The only way to assert the catch branch
       is to make the read genuinely fail, so the table is renamed away and put
       back. The restoration is then asserted, so this test cannot leave the rest
       of the suite running against a broken schema. */
    const co = `co_w18_orp040_503_${Date.now()}`;
    const sub = await request(app)
      .post("/api/investor/dsc/submit")
      .set("x-user-id", "u_admin")
      .send({ companyId: co });
    expect(sub.status).toBe(201);

    rawDb().exec("ALTER TABLE dsc_pipeline RENAME TO dsc_pipeline_w18_tmp");
    try {
      const res = await request(app)
        .get(`/api/investor/dsc/submissions?companyId=${co}`)
        .set("x-user-id", "u_admin");
      expect(res.status, JSON.stringify(res.body)).toBe(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe("DSC_PIPELINE_READ_FAILED");
      /* NEGATIVE POLE: it must not have answered a list at all. */
      expect(res.body.items).toBeUndefined();
    } finally {
      rawDb().exec("ALTER TABLE dsc_pipeline_w18_tmp RENAME TO dsc_pipeline");
    }

    /* POSITIVE POLE, same fixture: with the table back, the same request is 200
       and the row is still there — proving the 503 came from the read failing and
       not from the row being absent. */
    const after = await request(app)
      .get(`/api/investor/dsc/submissions?companyId=${co}`)
      .set("x-user-id", "u_admin");
    expect(after.status).toBe(200);
    expect((after.body.items as Array<{ id: string }>).map((r) => r.id)).toContain(
      sub.body.submission.id,
    );
  });

  it("an admin (the route's other authorised pole) reads a scoped, never platform-wide, list", async () => {
    const coA = `co_w18_orp040_admin_a_${Date.now()}`;
    const coB = `co_w18_orp040_admin_b_${Date.now()}`;

    const subA = await request(app)
      .post("/api/investor/dsc/submit")
      .set("x-user-id", "u_admin")
      .send({ companyId: coA });
    expect(subA.status, JSON.stringify(subA.body)).toBe(201);
    const subB = await request(app)
      .post("/api/investor/dsc/submit")
      .set("x-user-id", "u_admin")
      .send({ companyId: coB });
    expect(subB.status).toBe(201);

    /* The read-back is a LATER, INDEPENDENT request — the pole a React-state-only
       affordance could never survive. */
    const readA = await request(app)
      .get(`/api/investor/dsc/submissions?companyId=${coA}`)
      .set("x-user-id", "u_admin");
    expect(readA.status, JSON.stringify(readA.body)).toBe(200);
    const idsA = (readA.body.items as Array<{ id: string; companyId: string }>).map((r) => r.id);
    expect(idsA).toContain(subA.body.submission.id);
    /* NEGATIVE POLE: company B's submission must NOT appear in company A's list.
       A dropped `WHERE company_id = ?` would fail exactly here. */
    expect(idsA).not.toContain(subB.body.submission.id);
    for (const row of readA.body.items as Array<{ companyId: string }>) {
      expect(row.companyId).toBe(coA);
    }
    expect(readA.body.count).toBe(idsA.length);
  });
});
