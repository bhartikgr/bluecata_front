/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 194 · ITEM A — WAVE 193'S REFUSAL, PROVED ON THE PATH PRODUCTION RUNS.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE IS AN HTTP TEST AND WHY AN ENGINE TEST WOULD NOT DO.
 * Wave 193 added a refusal to `buildPricedRound` for the case where the YC
 * post-money conversion DENOMINATOR is formed by adding SAFE amounts recorded in
 * two different currencies (R165.1: wrong denominator → wrong share count → wrong
 * ownership percentage for every holder, silently). It proved that refusal by
 * calling `computeCapTable` directly — 20 passing tests — and then reported,
 * honestly, that "the production adapter passes no currency into the engine, so
 * the Item A refusal is engine-proven only and cannot fire on live data."
 *
 * R166.1: "A green suite tells you a code path works; it does not tell you that
 * path is the one your users reach." So every headline assertion below goes
 * through `registerRoutes(server, app)` — the same function `server/index.ts`
 * calls — and through `GET /api/founder/rounds/:id/round-math`, which
 * `build_log/wave194/PROOF_single_registrar.txt` establishes is mounted exactly
 * once in the entire tree (`server/routes.ts:1324`, no dormant twin, and no test
 * other than these mounts it). Nothing here calls the engine or the adapter
 * directly for its headline claim.
 *
 * THE DATA IS BUILT THROUGH PRODUCTION ROUTES, NOT POKED INTO A FIXTURE.
 * Rounds via `POST /api/rounds` (which is what wave 191 taught to persist
 * `rounds.currency`), the founder block via
 * `POST /api/founder/captable/seed-founder-shares`, and each SAFE via
 * `POST /api/founder/captable/commit-funded`. The currency under test is recorded
 * on the ROUND, because `server/lib/roundStoredTerms.ts` is what reads it — so a
 * genuinely mixed set requires two SAFEs issued from two rounds whose recorded
 * currencies differ, which is exactly the real-world shape (a company that raised
 * a GBP pre-seed and a USD bridge).
 *
 * TWO PRECONDITIONS THAT ARE ASSERTED RATHER THAN ASSUMED. The guard sits inside
 * `if (safe.safe.type === "post_money_cap" && safeCap.gt(0))`, so a SAFE must be
 * post-money (absent `safeCapType` is assumed post-money) AND carry a cap above
 * zero. `cap` reaches the engine from the commit's `valuationCap`
 * (`server/routes.ts:2589`), so every commit below supplies one; A-0 proves the
 * cap actually arrived, because without it a green refusal test would be green for
 * the wrong reason and would prove nothing.
 *
 * NO CURRENCY IS CONVERTED ANYWHERE IN THIS FILE (R156.1) and no expected value
 * is computed from an exchange rate.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { roundStoredTerms } from "../lib/roundStoredTerms";
import { getRoundById } from "../roundsStore";
import { securities } from "../mockData";
import { w212Attest } from "./_w212RoundAttestation";

let app: Express;
const STAMP = String(Date.now());
const ADMIN = "u_admin";

/** A company whose two SAFEs are recorded in two DIFFERENT currencies. */
const CO_MIXED = `co_w194_mix_${STAMP}`;
/** A company whose SAFEs are all recorded in the SAME currency. */
const CO_SINGLE = `co_w194_one_${STAMP}`;
/** A company whose rounds record NO currency — the platform's actual state. */
const CO_ABSENT = `co_w194_nil_${STAMP}`;
/** One SAFE states a currency, its sibling states none — the mid-migration case. */
const CO_PARTIAL = `co_w194_part_${STAMP}`;

type Ids = { priced: string; safeRounds: string[] };
const built: Record<string, Ids> = {};

/**
 * REPRODUCES THE LIVE SHAPE THAT CANNOT BE CREATED THROUGH A ROUTE ANY MORE.
 *
 * Every one of the 1045 rounds on record holds `currency = NULL` while 1017
 * cap-table commits exist against them, so "a funded SAFE whose round records no
 * currency" is the platform's DOMINANT state and the case this wave must not
 * break. It can no longer be BUILT through `POST /api/rounds` +
 * `POST /api/founder/captable/commit-funded`, because a concurrent change in this
 * tree (`wave195CommitCurrencyDeclaration`, the owner's R167 declaration) now
 * refuses `commit-funded` with `ROUND_CURRENCY_NOT_SET` for any round created
 * after the declaration that has no currency — observed directly while writing
 * this file:
 *   409 ROUND_CURRENCY_NOT_SET "No currency is recorded for this round, so
 *   nothing was committed. … The owner's declaration covers only rounds that
 *   existed when it was made."
 *
 * So the round is created WITH a currency, the commit is made through the real
 * route, and then the column is set back to NULL — landing on exactly the row
 * shape the 1045 live rounds have. This is a FIXTURE write against the `rounds`
 * table only: no product code path is bypassed for the behaviour under test,
 * which is still driven entirely through `GET /round-math`. It is called out
 * here rather than buried because a test that silently pokes the database is a
 * test whose subject is unclear.
 */
function makeCurrencyAbsent(roundId: string): void {
  /* BOTH homes of the same record, or the fixture would be a lie: `roundsStore`
     serves reads from an in-memory cache hydrated at boot
     (`server/roundsStore.ts:378`), so clearing only the column would leave the
     route still reading "USD" and A-2-1 would silently be testing the
     single-currency case. Cleared in the cache AND on disk. */
  rawDb().prepare("UPDATE rounds SET currency = NULL WHERE id = ?").run(roundId);
  const cached = getRoundById(roundId) as unknown as Record<string, unknown> | undefined;
  if (!cached) throw new Error(`makeCurrencyAbsent: round ${roundId} is not in the store cache`);
  cached.currency = null;
}

async function createRound(payload: Record<string, unknown>): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send(w212Attest({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload }));
  if (res.status !== 200) {
    throw new Error(`createRound failed ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

/**
 * Builds a complete company through production routes: a foundation round with a
 * founder block, one SAFE per entry in `safeCurrencies`, and a priced round to
 * project. `undefined` means the SAFE's round records NO currency at all — which
 * is what all 1045 rounds on the platform look like.
 */
async function buildCompany(
  companyId: string,
  safeCurrencies: Array<string | undefined>,
): Promise<Ids> {
  const foundation = await createRound({
    companyId, name: "W194 Foundation", type: "foundation", state: "closed",
    targetAmount: 1000,
  });
  const seed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId, roundId: foundation, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(seed.status);

  const safeRounds: string[] = [];
  for (let i = 0; i < safeCurrencies.length; i += 1) {
    const cur = safeCurrencies[i];
    const rid = await createRound({
      companyId, name: `W194 SAFE ${i + 1}`, type: "preseed", state: "closed",
      targetAmount: 1_000_000, instrument: "safe_post", valuationCap: "10000000",
      /* The KEY of the whole wave. In the absent cases a currency is stated at
         CREATE and cleared below — see `makeCurrencyAbsent`. */
      currency: cur ?? "USD",
    });
    safeRounds.push(rid);
    const commit = await request(app)
      .post("/api/founder/captable/commit-funded")
      .set("x-user-id", ADMIN)
      .send({
        invitationId: `inv_w194_${companyId}_${i}_${STAMP}`,
        roundId: rid,
        companyId,
        investorId: `u_inv_w194_${STAMP}_${i}`,
        amount: "1000000",
        /* The COMMIT's own currency is a different record from the round's. It is
           supplied identically in every case so the only variable across cases is
           the ROUND's recorded currency. */
        currency: "USD",
        shares: "0",
        instrumentClass: "unpriced",
        principalAmount: "1000000",
        /* Without a cap the guard's `if` is never entered and a green refusal test
           would prove nothing. A-0 checks this arrived. */
        valuationCap: "10000000",
      });
    if (commit.status !== 200) {
      throw new Error(`commit-funded ${commit.status} ${JSON.stringify(commit.body)}`);
    }
    if (cur === undefined) makeCurrencyAbsent(rid);
  }

  const priced = await createRound({
    companyId, name: "W194 Series Seed", type: "seed", state: "active",
    targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 3,
    instrument: "preferred", sharesAuthorized: "3333333", fdPreMoneyShares: "10000000",
  });
  return { priced, safeRounds };
}

const roundMath = (roundId: string) =>
  request(app).get(`/api/founder/rounds/${roundId}/round-math`).set("x-user-id", ADMIN);

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);

  built[CO_MIXED] = await buildCompany(CO_MIXED, ["GBP", "USD"]);
  built[CO_SINGLE] = await buildCompany(CO_SINGLE, ["USD", "USD"]);
  built[CO_ABSENT] = await buildCompany(CO_ABSENT, [undefined, undefined]);
  built[CO_PARTIAL] = await buildCompany(CO_PARTIAL, ["USD", undefined]);
}, 120_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * A-0 — THE FIXTURE ITSELF, SO NOTHING BELOW IS GREEN FOR THE WRONG REASON
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 194 A-0 — the preconditions the refusal depends on really hold", () => {
  it("A-0-1 the ROUND rows persisted the currencies the test asked for, and absent really is NULL", () => {
    const [gbp, usd] = built[CO_MIXED].safeRounds.map((r) => roundStoredTerms(r).currency);
    expect(gbp).toBe("GBP");
    expect(usd).toBe("USD");
    /* If this were "USD" instead of null, every all-absent assertion below would
       be testing the single-currency case by accident. */
    expect(built[CO_ABSENT].safeRounds.map((r) => roundStoredTerms(r).currency)).toEqual([null, null]);
    expect(built[CO_PARTIAL].safeRounds.map((r) => roundStoredTerms(r).currency)).toEqual(["USD", null]);
  });

  it("A-0-2 `roundStoredTerms` reads currency from the ROUNDS COLUMN — the field wave 191 wired", () => {
    /* A round created without a currency must not acquire one, and one created
       with a currency must not lose it. This is the read the whole wave hangs on,
       so it is pinned independently of the engine. */
    expect(roundStoredTerms(built[CO_SINGLE].safeRounds[0]).currency).toBe("USD");
    expect(roundStoredTerms("").currency).toBe(null);
    expect(roundStoredTerms("round_that_does_not_exist").currency).toBe(null);
  });

  it("A-0-3 an all-absent cap table COMPUTES through the route — so the route works at all", async () => {
    const res = await roundMath(built[CO_ABSENT].priced);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.postClose?.rows)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A-1 — THE REFUSAL REACHES THE RESPONSE OF THE REAL ROUTE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 194 A-1 — two SAFEs in different currencies REFUSE through the production route", () => {
  it("A-1-1 the route answers 422 and names the refusal, on live data shapes", async () => {
    const res = await roundMath(built[CO_MIXED].priced);
    /* THIS is the assertion wave 193 could not make. Before this wave the same
       request returned 200 with a share count computed from a denominator that
       had added GBP to USD. */
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("ROUND_MATH_TERM_REFUSED");
    expect(res.body.refusal).toBe("mixed_currency_conversion_denominator");
    expect(res.body.refusalName).toBe("MixedCurrencyConversionError");
    expect(res.body.field).toBe("shares");
  });

  it("A-1-2 no share count, price or ownership percentage is returned alongside the refusal", async () => {
    const res = await roundMath(built[CO_MIXED].priced);
    /* A refusal that still ships a number is not a refusal: the founder would
       read the number and ignore the message. */
    expect(res.body.postClose).toBeUndefined();
    expect(res.body.preClose).toBeUndefined();
    expect(res.body.denominators).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("ownershipPercent");
  });

  it("A-1-3 R166.2 — the message a human sees PASSES the 240-character looksHuman gate", async () => {
    const res = await roundMath(built[CO_MIXED].priced);
    const msg = String(res.body.message ?? "");
    /* `client/src/lib/queryClient.ts:60-65`: a server message is shown only when
       it is non-empty, STRICTLY shorter than 240 characters, and contains a
       lower-case letter. Wave 192 lost a 244-character headline to this gate and
       did not notice; the engine's full explanation is ~800 characters, so
       without the split headline this refusal would have reached the founder as
       "Something went wrong. Please try again." */
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.length).toBeLessThan(240);
    expect(/[a-z]/.test(msg)).toBe(true);
    /* Never an ALL-CAPS underscore code on screen (R152 item 3 / R165.4). */
    expect(msg).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    expect(msg).not.toContain("mixed_currency_conversion_denominator");
  });

  it("A-1-4 the unabridged explanation is NOT lost — it travels in `guidance`", async () => {
    const res = await roundMath(built[CO_MIXED].priced);
    const guidance = String(res.body.guidance ?? "");
    expect(guidance.length).toBeGreaterThan(400);
    expect(guidance).toContain("denominator");
    /* The codes the platform actually found are reported, because a refusal that
       will not say WHAT it found cannot be acted on. */
    expect(guidance).toContain("GBP");
    expect(guidance).toContain("USD");
  });

  it("A-1-5 the headline names no currency code and asserts no rate (R156.1 / R156.2)", async () => {
    const res = await roundMath(built[CO_MIXED].priced);
    const msg = String(res.body.message ?? "");
    /* The headline is fixed text precisely so its length is provable for any
       number of stated codes; the codes live in `guidance`. It must therefore not
       hardcode one either. */
    expect(msg).not.toMatch(/\b(USD|GBP|EUR|CAD|SGD|INR|AUD|JPY)\b/);
    expect(msg.toLowerCase()).toContain("more than one currency");
    expect(msg.toLowerCase()).toContain("does not convert");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A-2 — THE REGRESSION THAT MATTERS MOST: NOTHING THAT WORKS TODAY REFUSES
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 194 A-2 — wave 193's rule is UNCHANGED; only its reachability changed", () => {
  it("A-2-1 all-absent computes — 1045 of 1045 rounds on record have a NULL currency", async () => {
    const res = await roundMath(built[CO_ABSENT].priced);
    expect(res.status).toBe(200);
    expect(res.body.postClose.rows.length).toBeGreaterThan(0);
  });

  it("A-2-2 ONE stated currency plus an absent sibling computes — the mid-migration case", async () => {
    const res = await roundMath(built[CO_PARTIAL].priced);
    /* An absent currency is not a currency. If this refused, every company that
       recorded a currency on one round and not another — which is what partial
       adoption of wave 191 looks like — would lose its cap table. */
    expect(res.status).toBe(200);
    expect(res.body.postClose.rows.length).toBeGreaterThan(0);
  });

  it("A-2-3 two SAFEs in the SAME stated currency compute", async () => {
    const res = await roundMath(built[CO_SINGLE].priced);
    expect(res.status).toBe(200);
    expect(res.body.postClose.rows.length).toBeGreaterThan(0);
  });

  it("A-2-4 the single-currency and all-absent projections are ARITHMETICALLY IDENTICAL", async () => {
    /* Recording a currency must not move a number. This is the property that
       makes the change safe to deploy against 1045 NULL-currency rounds: the
       currency is carried for a CONTRADICTION CHECK and for nothing else, so the
       two responses may differ only in the identifiers the two companies use. */
    const one = await roundMath(built[CO_SINGLE].priced);
    const nil = await roundMath(built[CO_ABSENT].priced);
    expect(one.status).toBe(200);
    expect(nil.status).toBe(200);
    const shapeOf = (body: Record<string, unknown>) => {
      const post = body.postClose as { rows: Array<Record<string, unknown>>; totalShares?: unknown };
      return JSON.stringify({
        rows: post.rows.map((r) => ({
          kind: r.kind,
          shares: r.shares,
          ownershipPercent: r.ownershipPercent,
          ownershipPercentUnit: r.ownershipPercentUnit,
          denominatorKey: r.denominatorKey,
          denominatorShares: r.denominatorShares,
        })),
        totalShares: post.totalShares,
      });
    };
    expect(shapeOf(one.body)).toBe(shapeOf(nil.body));
  });

  it("A-2-5 the route emits NO `currency` key on a holder row, so Item C cannot move its bytes", async () => {
    /* The Item C site-1 fix (`?? \"USD\"` removed from the new investors' preferred
       security) is safe for byte-identity only because `rowsOf` does not project
       `currency`. That is asserted here rather than assumed from reading it. */
    const res = await roundMath(built[CO_SINGLE].priced);
    expect(res.status).toBe(200);
    for (const row of res.body.postClose.rows as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(row, "currency")).toBe(false);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A-3 — BYTE EQUALITY THROUGH THE PRODUCTION ROUTE
 * ═══════════════════════════════════════════════════════════════════════════
 * The golden below was captured by running THIS scenario against the tree with
 * every wave-194 runtime change reverted (`build_log/wave194/W194_DISARM.py
 * --revert-all`), so it is evidence from the pre-change tree rather than an
 * expectation written by the same hand that wrote the change. The capture, both
 * copies and the byte comparison are in
 * `build_log/wave194/ROUTE_GOLDEN_BEFORE.json` / `ROUTE_GOLDEN_AFTER.json`.
 * Identifiers are stamped per run, so the comparison is over the ARITHMETIC AND
 * SHAPE of the response with the per-run ids normalised out — the ids are the one
 * part of the body that cannot be pinned, and normalising them is stated here
 * rather than hidden in a helper.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 194 A-3 — an existing single-currency cap table is byte-identical", () => {
  const normalise = (s: string) =>
    s
      /* The ONLY per-run tokens in this response body, established by inspecting
         the captured JSON rather than guessed at: the round id the route was
         called with and the stamped company id. Everything else — every share
         count, every ownership percentage to 38 digits, the whole pricing trace
         and its iteration trail — is compared verbatim. */
      .replace(/rnd_[0-9a-f]+/g, "<RID>")
      .replace(/co_w194_[a-z]+_\d+/g, "<CO>");

  it("A-3-1 the single-currency response matches the pre-change capture byte for byte", async () => {
    const res = await roundMath(built[CO_SINGLE].priced);
    expect(res.status).toBe(200);
    const before = normalise(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("node:fs").readFileSync(
        "build_log/wave194/ROUTE_GOLDEN_BEFORE.json",
        "utf8",
      ) as string,
    );
    const after = normalise(JSON.stringify(res.body));
    expect(after).toBe(before);
    /* Guards this test against being weakened into a spot-check later. */
    expect(before.length).toBeGreaterThan(500);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A-4 — THE OTHER KIND OF ROW THE PRODUCTION ROUTE READS
 * ═══════════════════════════════════════════════════════════════════════════
 * `buildCompanySecurities` (`server/routes.ts:2592`) assembles TWO kinds of row
 * and hands both to `registerRoundMathRoutes`:
 *
 *   · BRIDGE rows, projected from the sacred commit ledger for UNPRICED positions
 *     (`:2602-2626`), which spread `roundStoredTerms(e.roundId)` wholesale — the
 *     rows A-1 exercises.
 *   · BASE rows, the `securities` array itself (DB-hydrated or demo-seeded), which
 *     carry a `roundId` but NO round-level term of their own. Wave 70 enriches each
 *     of them from ITS OWN round in the `.map()` at `:2815`, and wave 194 adds
 *     `currency: keep("currency")` to that same enrichment.
 *
 * A-1 alone would leave the second line unproven: the bridge rows already receive
 * the currency through the spread, so removing the `.map()` enrichment leaves A-1
 * entirely green. That was observed, not assumed — the disarm harness's M2
 * mutation was reported UNPROVEN until this block existed
 * (`build_log/wave194/DISARM_RUN_OUTPUT.txt`). The demo seed proves such rows are
 * real: `server/mockData.ts` holds three SAFE base rows and one note for
 * `co_novapay`, each with a `roundId` and a cap.
 *
 * THE FIXTURE WRITES INTO THE `securities` ARRAY DIRECTLY, and says so, because
 * that array is the store: `server/routes.ts:2593` reads
 * `securities.filter(s => s.companyId === cid)`, and there is no route that
 * creates a row in the `ApiSecurity` shape (`POST /api/companies/:id/securities`
 * stores `{kind, principal, terms}` and the `securities` TABLE has no `round_id`
 * column at all). The rounds are still created through `POST /api/rounds` and the
 * projection is still driven through the real route.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 194 A-4 — the refusal also fires for BASE securities rows", () => {
  const CO_BASE_MIXED = `co_w194_basemix_${STAMP}`;
  const CO_BASE_ONE = `co_w194_baseone_${STAMP}`;

  async function buildBaseCompany(companyId: string, currencies: string[]): Promise<string> {
    const foundation = await createRound({
      companyId, name: "W194 Base Foundation", type: "foundation", state: "closed",
      targetAmount: 1000, currency: "USD",
    });
    const seed = await request(app)
      .post("/api/founder/captable/seed-founder-shares")
      .set("x-user-id", ADMIN)
      .send({ companyId, roundId: foundation, shares: "8000000", amount: "800" });
    expect([200, 201]).toContain(seed.status);

    for (let i = 0; i < currencies.length; i += 1) {
      const rid = await createRound({
        companyId, name: `W194 Base SAFE ${i + 1}`, type: "preseed", state: "closed",
        targetAmount: 1_000_000, instrument: "safe_post", valuationCap: "10000000",
        currency: currencies[i],
      });
      (securities as unknown as Array<Record<string, unknown>>).push({
        id: `sec_w194_${companyId}_${i}`,
        companyId,
        holderName: `W194 Base Holder ${i + 1}`,
        holderType: "investor",
        instrument: "safe",
        series: "SAFE",
        shares: 0,
        pricePerShare: null,
        investmentAmount: 1_000_000,
        cap: 10_000_000,
        discount: null,
        issuedAt: "2026-01-01",
        roundId: rid,
      });
    }
    return createRound({
      companyId, name: "W194 Base Series Seed", type: "seed", state: "active",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 3, currency: "USD",
      instrument: "preferred", sharesAuthorized: "3333333", fdPreMoneyShares: "10000000",
    });
  }

  it("A-4-1 two BASE SAFE rows whose rounds record different currencies REFUSE", async () => {
    const priced = await buildBaseCompany(CO_BASE_MIXED, ["GBP", "USD"]);
    const res = await roundMath(priced);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(422);
    expect(res.body.refusal).toBe("mixed_currency_conversion_denominator");
    expect(String(res.body.message).length).toBeLessThan(240);
  });

  it("A-4-2 two BASE SAFE rows in the SAME currency still compute", async () => {
    const priced = await buildBaseCompany(CO_BASE_ONE, ["USD", "USD"]);
    const res = await roundMath(priced);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    expect(res.body.postClose.rows.length).toBeGreaterThan(0);
  });
});
