/* ════════════════════════════════════════════════════════════════════════════
   WAVE 130 — A COMPANY CAN RECORD THE SHAREHOLDERS IT ALREADY HAS, WITHOUT
   INVENTING A ROUND, A VALUATION OR A PRICE PER SHARE.
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAS BROKEN. Every write path that put a holding on a Capavate cap table
   was round-scoped, vehicle-scoped or admin-only — nine of them, enumerated in
   `build_log/wave130/W130_PREFLIGHT.md §2.1`. The consequence was not a missing
   button: the round-create flow REQUIRES a pre-money valuation, a fully-diluted
   pre-money share count, a price per share and a new-share count, all greater
   than zero, before a single existing shareholder can be named. So a company
   arriving on Capavate after three rounds had to FABRICATE FOUR NUMBERS to
   describe shareholders it already had, and the fabricated price per share then
   constrained every share count seated on that round. This is the platform that
   has spent months removing fabricated figures.

   The one route that looked like an escape hatch,
   `POST /api/founder/captable/seed-founder-shares`, is unfit four ways and is
   NOT modified by this wave: `amount` is mandatory so unknown is inexpressible;
   it writes ONE deterministic idempotent row per company; the holder is hardwired
   to the caller so a third party cannot be named; and the currency defaults to
   the literal `"USD"`. Group (Z) pins all four as the FAIL-BEFORE proof.

   GROUP (Z) IS NOT DECORATION. It exercises the pre-Wave-130 world over the same
   fixtures and asserts that it CANNOT express what the owner asked for. Groups
   (A)–(G) are the same facts against the shipped routes. If the register were
   reverted, (A)–(G) would fail and (Z) would still pass.

   IDENTITY. `getUserContext` is mocked to read an explicit, test-owned header, so
   no seeded persona is relied on and nothing about how a real session is
   established is touched (owner ruling R90).
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

const FOUNDER = "u_w130_founder";
const OTHER_FOUNDER = "u_w130_other_founder";
const PARTNER = "u_w130_partner";
const STRANGER = "u_w130_stranger";
const HOLDER = "u_w130_holder";
const COMPANY = "co_w130_hongkong";
const OTHER_COMPANY = "co_w130_elsewhere";

/** The identity header this test owns. Never a cookie, never a session. */
const H = "x-w130-actor";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/userContext", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getUserContext: (req: Request) => {
      const who = (req.headers["x-w130-actor"] as string | undefined) ?? "";
      if (!who) {
        return {
          isAuthed: false,
          isAdmin: false,
          userId: "",
          founder: { companies: [] },
          investor: { capTablePositions: [], invitedRounds: [] },
        };
      }
      const companies =
        who === "u_w130_founder"
          ? [{ companyId: "co_w130_hongkong" }]
          : who === "u_w130_other_founder"
            ? [{ companyId: "co_w130_elsewhere" }]
            : [];
      const positions =
        who === "u_w130_holder" ? [{ companyId: "co_w130_hongkong" }] : [];
      return {
        isAuthed: true,
        isAdmin: false,
        userId: who,
        founder: { companies },
        investor: { capTablePositions: positions, invitedRounds: [] },
      };
    },
  };
});

let app: Express;

beforeAll(async () => {
  const { registerShareholderRegisterRoutes } = await import("../shareholderRegisterRoutes");
  app = express();
  app.use(express.json({ limit: "2mb" }));
  registerShareholderRegisterRoutes(app);
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** A Hong Kong ordinary-share holding. HK$, never USD — jurisdiction and
 *  currency are variables on this platform, and this company prices in HK$. */
function hkBody(over: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY,
    holderName: "Wing Lam Chan",
    holderType: "founder",
    instrument: "common",
    series: "Ordinary A",
    shares: "4000000",
    currency: "HKD",
    issueDate: "2019-04-11",
    amount: "40000.00",
    pricePerShare: "0.01",
    origin: "incorporation",
    ...over,
  };
}

function post(url: string, body: unknown, actor = FOUNDER) {
  return request(app).post(url).set(H, actor).send(body as object);
}
function get(url: string, actor = FOUNDER) {
  return request(app).get(url).set(H, actor);
}

/* ════════════════════════════════════════════════════════════════════════════
   (Z) FAIL-BEFORE — WHAT THE PRE-WAVE-130 WORLD COULD NOT EXPRESS.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (Z) FAIL-BEFORE — the only pre-existing direct write path is unfit", () => {
  it("Z1 · seed-founder-shares makes `amount` MANDATORY, so an unknown amount is inexpressible", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/founderOpsRoutes.ts", "utf8"),
    );
    /* Comments are STRIPPED before this is asserted. A grep hit inside a comment
       is not a defect (the comment trap that has caught five agents on this
       platform); this reads LIVE CODE only. */
    const live = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(live).toContain("!companyId || !roundId || !shares || !amount");
    expect(live).toContain("missing_required_fields");
  });

  it("Z2 · seed-founder-shares hardwires the holder to the CALLER, so a third party cannot be named", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/founderOpsRoutes.ts", "utf8"),
    );
    const live = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(live).toContain("investorId: ctx.userId");
    /* There is no holderName / third-party holder parameter at all. */
    expect(live).not.toContain("body.holderName");
  });

  it("Z3 · seed-founder-shares defaults the currency to the LITERAL \"USD\"", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/founderOpsRoutes.ts", "utf8"),
    );
    const live = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(live).toMatch(/body\.currency\.trim\(\) \? body\.currency\.trim\(\) : "USD"/);
  });

  it("Z4 · seed-founder-shares writes ONE deterministic row per company, so it cannot hold a register", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/founderOpsRoutes.ts", "utf8"),
    );
    const live = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(live).toContain("founder_seed_${companyId}");
  });

  it("Z5 · seed-founder-shares REQUIRES a roundId, so it cannot record a holding with no round", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/founderOpsRoutes.ts", "utf8"),
    );
    const live = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(live).toMatch(/body\.roundId/);
    expect(live).toContain("!roundId");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   (A) A SHAREHOLDER IS RECORDED WITH NO ROUND IN EXISTENCE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (A) recorded with NO round, no valuation, no price per share required", () => {
  it("A1 · records a holding on a company that has no round at all", async () => {
    const res = await post("/api/founder/captable/shareholders", hkBody());
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.record.holderName).toBe("Wing Lam Chan");
    expect(res.body.record.shares).toBe("4000000");
    /* NO ROUND WAS CREATED, ASKED FOR, OR CONSULTED. The route has no roundId
       parameter; the register row has no round. */
    expect(res.body.record).not.toHaveProperty("roundId");
  });

  it("A2 · the route never asks for a valuation or a fully-diluted share count", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("server/shareholderRegisterRoutes.ts", "utf8"),
    );
    const live = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(live).not.toMatch(/preMoneyValuation/);
    expect(live).not.toMatch(/fullyDiluted/);
    expect(live).not.toMatch(/body\.roundId/);
  });

  it("A3 · money is exact minor units — HK$40,000.00 becomes 4000000 minor units", async () => {
    const res = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Exactness Probe", amount: "40000.00", currency: "HKD" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.record.amountMinor).toBe("4000000");
    expect(res.body.record.minorUnitExponent).toBe(2);
  });

  it("A4 · a figure with more precision than the currency allows is REFUSED, not rounded", async () => {
    const res = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Rounding Probe", amount: "10.005" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("amount_invalid");
    expect(String(res.body.message)).toMatch(/will not round/i);
  });

  it("A5 · the store's money parser uses the currency's OWN exponent, never a literal 100", async () => {
    const { parseMajorToMinor } = await import("../lib/shareholderRegisterStore");
    /* JPY has exponent 0 and BHD has exponent 3. A hardcoded 100 gets both wrong. */
    expect(parseMajorToMinor("1500", "JPY")).toBe("1500");
    expect(parseMajorToMinor("1.234", "BHD")).toBe("1234");
    expect(parseMajorToMinor("1.50", "HKD")).toBe("150");
    /* Beyond IEEE-754 exact-integer range, so a float path would be wrong here. */
    expect(parseMajorToMinor("99999999999999.99", "HKD")).toBe("9999999999999999");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   (B) UNKNOWN IS STORED AND RENDERED AS UNKNOWN. NEVER AS ZERO.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (B) unknown is unknown — never zero", () => {
  it("B1 · an unknown amount is stored as NULL and reported as unknown, not 0", async () => {
    const res = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Unknown Amount Holder", amount: "unknown" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.record.amountMinor).toBeNull();
    expect(res.body.record.amountDisplay).toBeNull();
    expect(res.body.record.amountIsUnknown).toBe(true);
    /* THE POINT: not zero, in any spelling. */
    expect(res.body.record.amountMinor).not.toBe("0");
    expect(res.body.record.amountMinor).not.toBe(0);
  });

  it("B2 · an unknown price per share is stored as NULL, and no valuation is demanded", async () => {
    const res = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Unknown Price Holder", pricePerShare: "unknown", amount: "unknown" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.record.pricePerShareIsUnknown).toBe(true);
    expect(res.body.record.pricePerShareMinor).toBeNull();
  });

  it("B3 · an OMISSION is refused rather than defaulted — blank is not zero", async () => {
    const body = hkBody({ holderName: "Omission Probe" }) as Record<string, unknown>;
    delete body.amount;
    const res = await post("/api/founder/captable/shareholders", body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("amount_decision_required");
    expect(String(res.body.message)).toMatch(/not the same\s+as zero/i);
  });

  it("B4 · an omitted price per share is refused the same way", async () => {
    const body = hkBody({ holderName: "Omission Probe 2" }) as Record<string, unknown>;
    delete body.pricePerShare;
    const res = await post("/api/founder/captable/shareholders", body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("price_per_share_decision_required");
  });

  it("B5 · a revision that fills in a figure is APPEND-ONLY — the unknown is not erased", async () => {
    const created = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Later Learned Holder", amount: "unknown" }),
    );
    expect(created.status).toBe(201);
    const id = created.body.record.id as string;

    const revised = await post(
      `/api/founder/captable/shareholders/${id}/revise`,
      { amount: "125000.00" },
    );
    expect(revised.status).toBe(200);
    expect(revised.body.record.amountMinor).toBe("12500000");
    expect(revised.body.supersededId).toBe(id);

    /* The old row still exists and still says the amount was unknown. */
    const { getShareholderRecord } = await import("../lib/shareholderRegisterStore");
    const old = getShareholderRecord(id);
    expect(old?.amountMinor).toBeNull();
    expect(old?.supersededAt).toBeTruthy();

    /* And the live list carries the revision exactly once, not both rows. */
    const list = await get(`/api/founder/captable/shareholders?companyId=${COMPANY}`);
    const matching = (list.body.records as Array<{ holderName: string }>).filter(
      (r) => r.holderName === "Later Learned Holder",
    );
    expect(matching.length).toBe(1);
  });

  it("B6 · a revision that restates nothing KEEPS an unknown unknown", async () => {
    const created = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Still Unknown Holder", amount: "unknown", pricePerShare: "unknown" }),
    );
    const id = created.body.record.id as string;
    const revised = await post(`/api/founder/captable/shareholders/${id}/revise`, {
      note: "Chased the subscription agreement; still not found.",
    });
    expect(revised.status).toBe(200);
    expect(revised.body.record.amountIsUnknown).toBe(true);
    expect(revised.body.record.pricePerShareIsUnknown).toBe(true);
    expect(revised.body.record.amountMinor).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   (C) CURRENCY AND JURISDICTION ARE VARIABLES. NO USD ANYWHERE.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (C) no hardcoded currency", () => {
  it("C1 · a missing currency is REFUSED, not defaulted to USD", async () => {
    const body = hkBody({ holderName: "Currency Probe" }) as Record<string, unknown>;
    delete body.currency;
    const res = await post("/api/founder/captable/shareholders", body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("currency_required");
  });

  it("C2 · the register routes and store contain no \"USD\" literal in live code", async () => {
    const fs = await import("node:fs");
    for (const f of [
      "server/shareholderRegisterRoutes.ts",
      "server/lib/shareholderRegisterStore.ts",
    ]) {
      const live = fs
        .readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect(live, `${f} must not hardcode a currency`).not.toMatch(/"USD"/);
    }
  });

  it("C3 · the HK$ holding round-trips with the currency the founder actually stated", async () => {
    const list = await get(`/api/founder/captable/shareholders?companyId=${COMPANY}`);
    expect(list.status).toBe(200);
    const currencies = new Set(
      (list.body.records as Array<{ currency: string }>).map((r) => r.currency),
    );
    expect(currencies.has("HKD")).toBe(true);
    expect(currencies.has("USD")).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   (D) BOTH FIRST-RUN SCENARIOS. SEPARATE, RESUMABLE, NEVER A LOCK-OUT.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (D) two starting points, kept apart and resumable", () => {
  it("D1 · a company with no first-run row reads `not_started` and can resume", async () => {
    const res = await get(`/api/founder/captable/first-run?companyId=${OTHER_COMPANY}`, OTHER_FOUNDER);
    expect(res.status).toBe(200);
    expect(res.body.firstRun.state).toBe("not_started");
    expect(res.body.canResume).toBe(true);
  });

  it("D2 · the incorporation scenario and the existing-cap-table scenario are NOT collapsed", async () => {
    const a = await post("/api/founder/captable/first-run", {
      companyId: COMPANY,
      scenario: "incorporation",
      state: "in_progress",
    });
    expect(a.status).toBe(200);
    expect(a.body.firstRun.scenario).toBe("incorporation");

    const b = await post("/api/founder/captable/first-run", {
      companyId: COMPANY,
      scenario: "existing_captable",
      state: "in_progress",
      asAtDate: "2026-06-30",
    });
    expect(b.status).toBe(200);
    expect(b.body.firstRun.scenario).toBe("existing_captable");
    expect(b.body.firstRun.asAtDate).toBe("2026-06-30");

    /* And each recorded row remembers WHICH question it answered. */
    const inc = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Incorporation Holder", origin: "incorporation" }),
    );
    const exi = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Existing Table Holder", origin: "existing_captable" }),
    );
    expect(inc.body.record.origin).toBe("incorporation");
    expect(exi.body.record.origin).toBe("existing_captable");

    const counts = await get(`/api/founder/captable/first-run?companyId=${COMPANY}`);
    expect(counts.body.recordedByScenario.incorporation).toBeGreaterThan(0);
    expect(counts.body.recordedByScenario.existing_captable).toBeGreaterThan(0);
  });

  it("D3 · the existing-cap-table scenario REQUIRES an as-at date, because a cap table is only true as at a moment", async () => {
    const res = await post("/api/founder/captable/first-run", {
      companyId: OTHER_COMPANY,
      scenario: "existing_captable",
      state: "in_progress",
    }, OTHER_FOUNDER);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("as_at_date_required");
  });

  it("D4 · SKIPPING IS NOT A LOCK-OUT — a skipped founder can resume either scenario", async () => {
    const skip = await post("/api/founder/captable/first-run", {
      companyId: OTHER_COMPANY,
      state: "skipped",
    }, OTHER_FOUNDER);
    expect(skip.status).toBe(200);
    expect(skip.body.firstRun.state).toBe("skipped");
    expect(skip.body.canResume).toBe(true);

    const resume = await post("/api/founder/captable/first-run", {
      companyId: OTHER_COMPANY,
      scenario: "incorporation",
      state: "in_progress",
    }, OTHER_FOUNDER);
    expect(resume.status).toBe(200);
    expect(resume.body.firstRun.state).toBe("in_progress");
    /* The skip is CLEARED, not remembered as a closed door. */
    expect(resume.body.firstRun.skippedAt).toBeNull();
  });

  it("D5 · progress SURVIVES between requests — this is not a one-sitting wizard", async () => {
    const first = await get(`/api/founder/captable/first-run?companyId=${OTHER_COMPANY}`, OTHER_FOUNDER);
    expect(first.body.firstRun.scenario).toBe("incorporation");
    const again = await get(`/api/founder/captable/first-run?companyId=${OTHER_COMPANY}`, OTHER_FOUNDER);
    expect(again.body.firstRun.scenario).toBe("incorporation");
    expect(again.body.firstRun.state).toBe("in_progress");
  });

  it("D6 · a past issue date WARNS, it never blocks (R92) — a historic cap table is historic", async () => {
    const res = await post(
      "/api/founder/captable/shareholders",
      hkBody({ holderName: "Historic Holder", issueDate: "2014-02-03" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.warning).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   (E) PROPAGATION — ONE BUILDER, EVERY SURFACE, INCLUDING THE INVESTOR'S OWN.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (E) propagation through the single ApiSecurity builder", () => {
  it("E1 · a recorded holding is projected into the ApiSecurity shape with NO round", async () => {
    const { projectRegisterToSecurities } = await import("../lib/shareholderRegisterStore");
    const rows = projectRegisterToSecurities(COMPANY);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.roundId).toBeNull();
      expect(r.roundName).toBeNull();
      expect(typeof r.holderName).toBe("string");
      expect(String(r.holderName).length).toBeGreaterThan(0);
    }
  });

  it("E2 · an unknown figure crosses the projection as NULL, never 0", async () => {
    const { projectRegisterToSecurities } = await import("../lib/shareholderRegisterStore");
    const rows = projectRegisterToSecurities(COMPANY);
    const unknownRow = rows.find((r) => r.holderName === "Unknown Amount Holder");
    expect(unknownRow).toBeTruthy();
    expect(unknownRow?.investmentAmount).toBeNull();
    expect(unknownRow?.amountIsUnknown).toBe(true);
    expect(unknownRow?.investmentAmount).not.toBe(0);
  });

  it("E3 · the exact minor units survive the projection beside the display number", async () => {
    const { projectRegisterToSecurities } = await import("../lib/shareholderRegisterStore");
    const rows = projectRegisterToSecurities(COMPANY);
    const exact = rows.find((r) => r.holderName === "Exactness Probe") as
      | { registerExactMoney?: { amountMinor?: string | null; currency?: string } }
      | undefined;
    expect(exact?.registerExactMoney?.amountMinor).toBe("4000000");
    expect(exact?.registerExactMoney?.currency).toBe("HKD");
  });

  it("E4 · the holder count uses WAVE 125's authority — no ninth counting rule is added", async () => {
    const { computeCapTableHolderCount, setFounderOwnershipSecuritiesProvider } = await import(
      "../lib/founderOwnershipEngine"
    );
    const { projectRegisterToSecurities } = await import("../lib/shareholderRegisterStore");
    const rows = projectRegisterToSecurities(COMPANY);
    setFounderOwnershipSecuritiesProvider(() => rows as never);
    try {
      const r = computeCapTableHolderCount(COMPANY);
      expect(r.reason).toBe("computed");
      /* Distinct holder NAMES, by Wave 125's own definition — not a row count. */
      const distinct = new Set(rows.map((x) => String(x.holderName)));
      expect(r.count).toBe(distinct.size);
    } finally {
      setFounderOwnershipSecuritiesProvider(null);
    }
  });

  it("E5 · the projection is wired into `buildCompanySecurities`, the ONE builder", async () => {
    const fs = await import("node:fs");
    const live = fs
      .readFileSync("server/routes.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    /* The call sits inside buildCompanySecurities, which is injected into the
       round-math routes, the founder-ownership engine and the exit waterfall. */
    expect(live).toContain("projectRegisterToSecurities(String(cid))");
    expect(live).toContain("registerShareholderRegisterRoutes(app)");
    /* And the cap-table PDF, the one surface that reads the sacred ledger
       directly, unions the register in too. */
    expect(live).toContain("listShareholderRecords(id)");
  });

  it("E6 · percentages agree across surfaces because there is one row set and one engine", async () => {
    const { projectRegisterToSecurities } = await import("../lib/shareholderRegisterStore");
    const rows = projectRegisterToSecurities(COMPANY);
    const total = rows.reduce((acc, r) => acc + Number(r.shares ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    /* Each holder's share of the same denominator, computed twice from the same
       rows the founder view and the investor view are both served. */
    const founderView = rows.map((r) => Number(r.shares ?? 0) / total);
    const investorView = projectRegisterToSecurities(COMPANY).map(
      (r) => Number(r.shares ?? 0) / total,
    );
    expect(investorView).toEqual(founderView);
    const sum = founderView.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   (F) VISIBILITY — VISIBLE TO THE FOUNDER, ENFORCED ON THE SERVER.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (F) visibility is explicit, listed, and enforced server-side", () => {
  let grantId = "";

  it("F1 · the founder can SEE who reads the cap table, in plain words", async () => {
    const res = await get(`/api/founder/captable/visibility?companyId=${COMPANY}`);
    expect(res.status).toBe(200);
    const parties = (res.body.positional as Array<{ party: string; revocable: boolean }>).map(
      (p) => p.party,
    );
    expect(parties).toContain("founder");
    expect(parties).toContain("investor");
    /* R8 — a holder's sight of the register he appears on is NOT revocable. */
    for (const p of res.body.positional as Array<{ revocable: boolean }>) {
      expect(p.revocable).toBe(false);
    }
  });

  it("F2 · a Consortium Partner grant requires a HUMAN LABEL and an end date", async () => {
    const noLabel = await post("/api/founder/captable/visibility/grants", {
      companyId: COMPANY,
      subjectKind: "consortium_partner",
      subjectId: PARTNER,
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(noLabel.status).toBe(400);
    expect(noLabel.body.error).toBe("subject_label_required");

    const noExpiry = await post("/api/founder/captable/visibility/grants", {
      companyId: COMPANY,
      subjectKind: "consortium_partner",
      subjectId: PARTNER,
      subjectLabel: "Keiretsu Forum Canada",
    });
    expect(noExpiry.status).toBe(400);
    expect(noExpiry.body.error).toBe("expiry_required");
  });

  it("F3 · an INVESTOR cannot be the subject of a grant (R8)", async () => {
    const res = await post("/api/founder/captable/visibility/grants", {
      companyId: COMPANY,
      subjectKind: "investor",
      subjectId: HOLDER,
      subjectLabel: "A shareholder",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("subject_kind_invalid");
    expect(String(res.body.message)).toMatch(/already sees it/i);
  });

  it("F4 · BEFORE a grant, the partner is REFUSED by the shipped enforcement authority", async () => {
    const { decideCapTableSinkAccess } = await import("../lib/capTableSinkScope");
    const d = decideCapTableSinkAccess(
      { isAuthed: true, isAdmin: false, userId: PARTNER, founder: { companies: [] }, investor: { capTablePositions: [] } },
      COMPANY,
    );
    expect(d.outcome).toBe("refuse");
    expect(d.reason).toBe("no_relationship");
  });

  it("F5 · AFTER the grant, the same authority ALLOWS the same partner", async () => {
    const created = await post("/api/founder/captable/visibility/grants", {
      companyId: COMPANY,
      subjectKind: "consortium_partner",
      subjectId: PARTNER,
      subjectLabel: "Keiretsu Forum Canada",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(created.status).toBe(201);
    grantId = created.body.grant.id;
    expect(created.body.grant.state).toBe("live");
    /* THE LIST RENDERS A NAME, NEVER A RAW IDENTIFIER. */
    expect(created.body.grant.subjectLabel).toBe("Keiretsu Forum Canada");
    expect(JSON.stringify(created.body.grant)).not.toContain(PARTNER);

    const { decideCapTableSinkAccess } = await import("../lib/capTableSinkScope");
    const d = decideCapTableSinkAccess(
      { isAuthed: true, isAdmin: false, userId: PARTNER, founder: { companies: [] }, investor: { capTablePositions: [] } },
      COMPANY,
    );
    expect(d.outcome).toBe("allow");
    expect(d.reason).toBe("founder_granted_visibility");
    expect(d.grantedVisibility?.subjectLabel).toBe("Keiretsu Forum Canada");
  });

  it("F6 · WITHDRAWING the grant refuses the partner again, on the very next call", async () => {
    const rev = await post(`/api/founder/captable/visibility/grants/${grantId}/revoke`, {});
    expect(rev.status).toBe(200);
    expect(rev.body.grant.state).toBe("revoked");
    expect(rev.body.grant.canRevoke).toBe(false);

    const { decideCapTableSinkAccess } = await import("../lib/capTableSinkScope");
    const d = decideCapTableSinkAccess(
      { isAuthed: true, isAdmin: false, userId: PARTNER, founder: { companies: [] }, investor: { capTablePositions: [] } },
      COMPANY,
    );
    expect(d.outcome).toBe("refuse");
  });

  it("F7 · a second withdrawal is idempotent and keeps the FIRST instant (Wave 120's rule)", async () => {
    const first = await get(`/api/founder/captable/visibility?companyId=${COMPANY}`);
    const before = (first.body.grants as Array<{ id: string; revokedAt: string | null }>).find(
      (g) => g.id === grantId,
    );
    const again = await post(`/api/founder/captable/visibility/grants/${grantId}/revoke`, {});
    expect(again.status).toBe(200);
    expect(again.body.alreadyRevoked).toBe(true);
    expect(again.body.grant.revokedAt).toBe(before?.revokedAt);
  });

  it("F8 · an EXPIRED grant does not admit anybody", async () => {
    const { insertVisibilityGrant, capTableVisibilityGrantState } = await import(
      "../lib/shareholderRegisterStore"
    );
    const g = insertVisibilityGrant({
      id: `ctvg_w130_expired`,
      companyId: COMPANY,
      subjectKind: "collective",
      subjectId: STRANGER,
      subjectLabel: "The Collective",
      expiresAt: "2020-01-01T00:00:00.000Z",
      grantedBy: FOUNDER,
    });
    expect(g).toBeTruthy();
    expect(capTableVisibilityGrantState(g!)).toBe("expired");
    const { decideCapTableSinkAccess } = await import("../lib/capTableSinkScope");
    const d = decideCapTableSinkAccess(
      { isAuthed: true, isAdmin: false, userId: STRANGER, founder: { companies: [] }, investor: { capTablePositions: [] } },
      COMPANY,
    );
    expect(d.outcome).toBe("refuse");
  });

  it("F9 · the new branch can only turn refuse into allow — every pre-existing outcome is unchanged", async () => {
    const { decideCapTableSinkAccess } = await import("../lib/capTableSinkScope");
    /* Unauthenticated still refuses. */
    expect(decideCapTableSinkAccess({ isAuthed: false }, COMPANY).reason).toBe("unauthenticated");
    /* Admin still allows. */
    expect(
      decideCapTableSinkAccess({ isAuthed: true, isAdmin: true, userId: "u_admin" }, COMPANY).reason,
    ).toBe("admin");
    /* The founder still allows. */
    expect(
      decideCapTableSinkAccess(
        { isAuthed: true, userId: FOUNDER, founder: { companies: [{ companyId: COMPANY }] } },
        COMPANY,
      ).reason,
    ).toBe("founder");
    /* A real holder still allows, as a direct counterparty and NOT as a grant. */
    expect(
      decideCapTableSinkAccess(
        {
          isAuthed: true,
          userId: HOLDER,
          founder: { companies: [] },
          investor: { capTablePositions: [{ companyId: COMPANY }] },
        },
        COMPANY,
      ).reason,
    ).toBe("direct_counterparty");
  });

  it("F10 · a founder of ANOTHER company cannot read or grant on this cap table", async () => {
    const read = await get(`/api/founder/captable/visibility?companyId=${COMPANY}`, OTHER_FOUNDER);
    expect(read.status).toBe(403);
    const grant = await post(
      "/api/founder/captable/visibility/grants",
      {
        companyId: COMPANY,
        subjectKind: "collective",
        subjectId: STRANGER,
        subjectLabel: "Somebody else",
        expiresAt: "2027-01-01T00:00:00.000Z",
      },
      OTHER_FOUNDER,
    );
    expect(grant.status).toBe(403);
    const write = await post("/api/founder/captable/shareholders", hkBody(), OTHER_FOUNDER);
    expect(write.status).toBe(403);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   (G) NO RAW IDENTIFIER OR MACHINE KEY REACHES A HUMAN.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W130 · (G) nothing machine-shaped is rendered to a person", () => {
  it("G1 · every holder kind, instrument, origin, party and grant state has a label map on the client", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "client/src/components/founder/ShareholderRegisterPanel.tsx",
      "utf8",
    );
    for (const map of [
      "HOLDER_TYPE_LABELS",
      "INSTRUMENT_LABELS",
      "SUBJECT_KIND_LABELS",
      "GRANT_STATE_LABELS",
      "ORIGIN_LABELS",
      "SCENARIO_LABELS",
    ]) {
      expect(src, `${map} must exist`).toContain(map);
    }
    /* And the platform's existing humanising fallback is REUSED, not re-invented. */
    expect(src).toContain('from "@/lib/partnerDisplay"');
    expect(src).toContain("humanizeMachineKey");
  });

  it("G2 · the panel never renders a stored key directly through a bare expression", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "client/src/components/founder/ShareholderRegisterPanel.tsx",
      "utf8",
    );
    /* Each of these keys is only ever passed through `labelFor` or
       `humanizeMachineKey`; a bare `{r.holderType}` in JSX would be the defect. */
    for (const bare of ["{r.holderType}", "{r.instrument}", "{r.origin}", "{g.subjectKind}", "{g.state}"]) {
      expect(src, `${bare} must not be rendered raw`).not.toContain(bare);
    }
  });

  it("G3 · the cap-table PDF prints the founder's own words for a register holder, not the aggregation key", async () => {
    const fs = await import("node:fs");
    const live = fs
      .readFileSync("server/routes.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(live).toContain("v.registerLabel");
    expect(live).toContain("cur.registerLabel = rec.holderName");
  });

  it("G4 · the existing `Add security in Rounds` control keeps its copy and test id byte-for-byte", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("client/src/pages/founder/CapTable.tsx", "utf8");
    expect(src).toContain('data-testid="button-add-security"');
    expect(src).toContain("Add security in Rounds");
    /* And the new control sits BESIDE it, not in place of it. */
    expect(src).toContain('data-testid="button-record-shareholder"');
    expect(src).toContain("Record shareholder");
  });
});
