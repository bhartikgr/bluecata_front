/* ════════════════════════════════════════════════════════════════════════════
   WAVE 153 · BATCH 2 · ITEM F — ONE APPLICATION FEE, TWO ROWS, ONE RULE.
                                   R115.2 #5 · R95 · R104 · R107.1 · R108.2 · R77
   ════════════════════════════════════════════════════════════════════════════
   THE TWO HOLES THIS FILE CLOSES, in the shipping code:

     1. `PUT /api/admin/platform-fees/:key` wrote `platform_fees` and THEN tried
        to mirror into `collective_application_fee_config` inside a `try` whose
        `catch (mirrorErr)` logged "(non-fatal)" and answered **200**. The founder
        resolver reads ONLY the config table, so a failed mirror meant the console
        showed the new price while founders were charged the old one — for as long
        as nobody read a log line. R115.2 #5.

     2. `PUT /api/admin/collective/application-fee` wrote the config table and
        NEVER touched `platform_fees`, and invalidated NO pricing cache. Same
        divergence, opposite direction.

   WHAT IS ASSERTED — behaviour over real HTTP wherever behaviour exists:

     F-T1  A mirror that cannot be written ⇒ 500 `APPLICATION_FEE_MIRROR_FAILED`
           with a plain sentence, and `platform_fees` UNCHANGED. The failure is
           induced by renaming the config table away for the duration of one
           request and renaming it back — the writer really fails, nothing is
           stubbed. Anti-vacuity: the SAME request succeeds once the table is
           back.
     F-T2  After a write through EITHER route both rows hold the SAME amount, the
           SAME currency, and record the SAME actor. Plus: migration 0201 repairs
           a seeded divergence, is a no-op when the rows agree, and does NOT
           invent a row when one side is absent.
     F-T3  The founder route (`GET /api/collective/application-fee`) and the admin
           console (`GET /api/admin/platform-fees`) report the SAME figure after
           either write path.
     F-T4  The absence contract is untouched: the founder body is FALSY (wave 145
           / R109 — the sacred `client/src/pages/founder/Billing.tsx` guards on
           object presence, so a diagnostic object must NOT be restored there),
           while the admin surface still reports `source: "missing"` so the
           operator sees the condition.
     F-T5  Both writer routes invalidate the pricing caches, and the founder
           surface reflects a change on the NEXT request.
     F-T6  The swallow is GONE from the shipping file (comments stripped before
           any grep conclusion), the wave-131 byte pin is still present, and
           `DEFAULT_APPLICATION_FEE_MINOR` is still 30000 and still not used as a
           fallback by this path.

   No `Number()`/`parseInt`/`parseFloat` is applied to money anywhere here.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerAdminPlatformFeesRoutes } from "../adminPlatformFeesRoutes";
import { registerAdminCollectiveFeeRoutes } from "../adminCollectiveFeeRoutes";
import { registerCollectiveRoutes } from "../collectiveRoutes";
import { getFee, invalidateFeeCache } from "../platformFeesStore";
import {
  getApplicationFeeMinor,
  DEFAULT_APPLICATION_FEE_MINOR,
  updateApplicationFee,
} from "../lib/collectiveApplicationFeeResolver";
import {
  writeApplicationFeeBothSources,
  readApplicationFeeSources,
  ApplicationFeeMirrorError,
  APPLICATION_FEE_PLATFORM_KEY,
  APPLICATION_FEE_MIRROR_FAILED,
  APPLICATION_FEE_MIRROR_MESSAGE,
} from "../lib/applicationFeeMirror";

const ADMIN = "u_admin";
const CONFIG_TABLE = "collective_application_fee_config";
const PARKED_TABLE = "w153_parked_application_fee_config";

let app: Express;

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w153 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

const asAdmin = (r: request.Test) =>
  r.set("x-user-id", ADMIN).set("x-actor-user-id", ADMIN).set("x-role", "admin");

const putPlatformFee = (body: Record<string, unknown>) =>
  asAdmin(
    request(app).put(`/api/admin/platform-fees/${APPLICATION_FEE_PLATFORM_KEY}`).send(body),
  );

const putCollectiveFee = (body: Record<string, unknown>) =>
  asAdmin(request(app).put("/api/admin/collective/application-fee").send(body));

/** Raw reads, straight from the two tables. No store, no cache, no resolver. */
function rawPair(): {
  feeMinor: unknown;
  feeCurrency: unknown;
  feeActor: unknown;
  configMinor: unknown;
  configCurrency: unknown;
  configActor: unknown;
} {
  const fee = rawDb()
    .prepare(
      `SELECT amount_minor, currency, updated_by_user_id FROM platform_fees WHERE key = ?`,
    )
    .get(APPLICATION_FEE_PLATFORM_KEY) as
    | { amount_minor: unknown; currency: unknown; updated_by_user_id: unknown }
    | undefined;
  const cfg = rawDb()
    .prepare(`SELECT amount_minor, currency, updated_by FROM ${CONFIG_TABLE} WHERE id = 'default'`)
    .get() as { amount_minor: unknown; currency: unknown; updated_by: unknown } | undefined;
  return {
    feeMinor: fee?.amount_minor,
    feeCurrency: fee?.currency,
    feeActor: fee?.updated_by_user_id,
    configMinor: cfg?.amount_minor,
    configCurrency: cfg?.currency,
    configActor: cfg?.updated_by,
  };
}

/** Put both rows into a known, agreeing state. */
function seedAgreeing(amountMinor: number, currency = "USD"): void {
  run(
    `INSERT INTO platform_fees (key, amount_minor, currency, updated_at, updated_by_user_id)
       VALUES (?, ?, ?, ?, 'w153:fixture')
     ON CONFLICT(key) DO UPDATE SET
       amount_minor = excluded.amount_minor,
       currency = excluded.currency,
       updated_at = excluded.updated_at,
       updated_by_user_id = excluded.updated_by_user_id,
       deleted_at = NULL`,
    APPLICATION_FEE_PLATFORM_KEY,
    amountMinor,
    currency,
    new Date().toISOString(),
  );
  run(
    `INSERT INTO ${CONFIG_TABLE} (id, amount_minor, currency, updated_at, updated_by)
       VALUES ('default', ?, ?, datetime('now'), 'w153:fixture')
     ON CONFLICT(id) DO UPDATE SET
       amount_minor = excluded.amount_minor,
       currency = excluded.currency,
       updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
    amountMinor,
    currency,
  );
  invalidateFeeCache();
}

/** Source text with comments stripped — required before ANY grep conclusion. */
function stripped(rel: string): string {
  const raw = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const rawSource = (rel: string): string => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerAdminPlatformFeesRoutes(app);
  registerAdminCollectiveFeeRoutes(app);
  registerCollectiveRoutes(app);
});

beforeEach(() => {
  /* Always start from a table that EXISTS — a previous failure must not leak. */
  const parked = rawDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(PARKED_TABLE);
  if (parked) {
    run(`ALTER TABLE ${PARKED_TABLE} RENAME TO ${CONFIG_TABLE}`);
  }
  seedAgreeing(30000, "USD");
});

afterAll(() => {
  seedAgreeing(30000, "USD");
});

/* ══════════════════════════════════════════════════════════════════════════
   F-T1 — A MIRROR THAT CANNOT BE WRITTEN REFUSES THE WHOLE CHANGE.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 153 · F-T1 — a failed mirror is fatal, and nothing is saved", () => {
  it("PUT /api/admin/platform-fees answers 500 with a PLAIN SENTENCE and leaves platform_fees untouched", async () => {
    const before = rawPair();
    expect(before.feeMinor).toBe(30000);

    /* Induce a REAL failure: the config table is not there to be written. */
    run(`ALTER TABLE ${CONFIG_TABLE} RENAME TO ${PARKED_TABLE}`);

    const res = await putPlatformFee({ amountMinor: 45000, currency: "USD" });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe(APPLICATION_FEE_MIRROR_FAILED);
    /* R77 — a human reads a sentence naming what happened and what to do next,
       never a bare code. */
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message).toBe(APPLICATION_FEE_MIRROR_MESSAGE);
    expect(res.body.message).toContain("was not changed");
    expect(res.body.message).toContain("Nothing was saved");
    expect(res.body.message.split(" ").length).toBeGreaterThan(12);
    expect(res.body.message).not.toMatch(/^[A-Z_]+$/);

    /* THE POINT: the register did not move, so no stale-price divergence exists. */
    const afterFee = rawDb()
      .prepare(`SELECT amount_minor, currency FROM platform_fees WHERE key = ?`)
      .get(APPLICATION_FEE_PLATFORM_KEY) as { amount_minor: unknown; currency: unknown };
    expect(afterFee.amount_minor).toBe(30000);
    expect(afterFee.amount_minor).not.toBe(45000);
    expect(afterFee.currency).toBe("USD");

    /* And the cached read agrees with the table — a rolled-back write must not
       survive in a module cache. */
    invalidateFeeCache();
    expect(getFee(APPLICATION_FEE_PLATFORM_KEY).amountMinor).toBe(30000);

    /* ANTI-VACUITY: the identical request succeeds once the mirror can be written,
       so the 500 above was caused by the mirror and not by the request shape. */
    run(`ALTER TABLE ${PARKED_TABLE} RENAME TO ${CONFIG_TABLE}`);
    const ok = await putPlatformFee({ amountMinor: 45000, currency: "USD" });
    expect(ok.status).toBe(200);
    expect(ok.body.fee.amountMinor).toBe(45000);
    expect(rawPair().configMinor).toBe(45000);
  });

  it("PUT /api/admin/collective/application-fee also refuses, and platform_fees keeps the old figure", async () => {
    run(`ALTER TABLE ${CONFIG_TABLE} RENAME TO ${PARKED_TABLE}`);
    const res = await putCollectiveFee({ amountMinor: 51000, currency: "USD" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe(APPLICATION_FEE_MIRROR_FAILED);
    expect(res.body.message).toContain("both have to move together");

    const afterFee = rawDb()
      .prepare(`SELECT amount_minor FROM platform_fees WHERE key = ?`)
      .get(APPLICATION_FEE_PLATFORM_KEY) as { amount_minor: unknown };
    expect(afterFee.amount_minor).toBe(30000);
  });

  it("the helper throws a typed error carrying the code, and rolls back", () => {
    run(`ALTER TABLE ${CONFIG_TABLE} RENAME TO ${PARKED_TABLE}`);
    let caught: unknown;
    try {
      writeApplicationFeeBothSources({
        amountMinor: 77000,
        currency: "USD",
        actor: "w153@test",
        userId: ADMIN,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApplicationFeeMirrorError);
    expect((caught as ApplicationFeeMirrorError).code).toBe(APPLICATION_FEE_MIRROR_FAILED);
    expect((caught as ApplicationFeeMirrorError).detail.length).toBeGreaterThan(0);
    const fee = rawDb()
      .prepare(`SELECT amount_minor FROM platform_fees WHERE key = ?`)
      .get(APPLICATION_FEE_PLATFORM_KEY) as { amount_minor: unknown };
    expect(fee.amount_minor).toBe(30000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F-T2 — BOTH ROWS MOVE TOGETHER, THROUGH EITHER ROUTE.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 153 · F-T2 — one edit, two rows, same amount and same actor", () => {
  it("the platform-fees route writes BOTH rows, unscaled, with one actor", async () => {
    const res = await putPlatformFee({ amountMinor: 41500, currency: "USD" });
    expect(res.status).toBe(200);
    const p = rawPair();
    expect(p.feeMinor).toBe(41500);
    expect(p.configMinor).toBe(41500);
    /* Unscaled: no /100 anywhere on this path. 415 would be the old defect. */
    expect(p.configMinor).not.toBe(415);
    expect(String(p.feeCurrency)).toBe("USD");
    expect(String(p.configCurrency)).toBe("USD");
    /* The SAME edit stamps BOTH rows with the identity of the request that made
       it. The two columns record identity in different, pre-existing forms —
       `platform_fees.updated_by_user_id` is the USER ID, and
       `collective_application_fee_config.updated_by` is the actor string
       (`actorOf` prefers the e-mail) — so equality of the STRINGS is not what is
       asserted, and claiming it would be wrong. What is asserted is that neither
       row is left carrying the FIXTURE's provenance: before this wave the config
       row (or, on the other route, the register row) kept whatever was there. */
    expect(String(p.feeActor)).toBe(ADMIN);
    expect(String(p.configActor).length).toBeGreaterThan(0);
    expect(String(p.configActor)).not.toBe("w153:fixture");
    expect(String(p.configActor)).not.toBe("null");
    expect(readApplicationFeeSources().agree).toBe(true);
  });

  it("the collective route — which used to write only ONE row — now writes both", async () => {
    const res = await putCollectiveFee({ amountMinor: 38000, currency: "USD" });
    expect(res.status).toBe(200);
    const p = rawPair();
    expect(p.configMinor).toBe(38000);
    /* This is the assertion that FAILS on the pre-wave-153 code: platform_fees
       stayed at 30000 while founders were charged 38000. */
    expect(p.feeMinor).toBe(38000);
    expect(String(p.feeActor)).toBe(ADMIN);
    expect(readApplicationFeeSources().agree).toBe(true);
  });

  it("a non-USD edit keeps ONE currency on both sides", async () => {
    const res = await putPlatformFee({ amountMinor: 250000, currency: "jpy" });
    expect(res.status).toBe(200);
    const p = rawPair();
    expect(p.feeMinor).toBe(250000);
    expect(p.configMinor).toBe(250000);
    /* The wave-34 defect: 250000 JPY mirrored as 2500. */
    expect(p.configMinor).not.toBe(2500);
    expect(String(p.feeCurrency)).toBe("JPY");
    expect(String(p.configCurrency)).toBe("JPY");
  });

  it("readApplicationFeeSources reports a DIVERGENCE rather than papering over it", () => {
    run(`UPDATE platform_fees SET amount_minor = 24000 WHERE key = ?`, APPLICATION_FEE_PLATFORM_KEY);
    invalidateFeeCache();
    const s = readApplicationFeeSources();
    expect(s.platformFeeMinor).toBe(24000);
    expect(s.configMinor).toBe(30000);
    expect(s.agree).toBe(false);
  });

  it("migration 0201 repairs a seeded divergence TOWARDS the founder-authoritative row, is a no-op when they agree, and invents nothing when one side is absent", () => {
    const sql = rawSource("migrations/0201_wave153_f_application_fee_two_sources_repair.sql");
    /* The mirror at server/db/migrations must be byte-identical (id >= 0068). */
    expect(rawSource("server/db/migrations/0201_wave153_f_application_fee_two_sources_repair.sql")).toBe(
      sql,
    );
    /* It must NOT claim a database-level guarantee it cannot provide. */
    expect(sql).toContain("SQLite CANNOT express a cross-table equality constraint");

    /* (a) DIVERGENT: platform_fees is moved to the config value — the figure
           founders were actually charged — and never the other way round. */
    seedAgreeing(30000, "USD");
    run(`UPDATE platform_fees SET amount_minor = 24000, currency = 'JPY' WHERE key = ?`, APPLICATION_FEE_PLATFORM_KEY);
    rawDb().exec(sql);
    invalidateFeeCache();
    let p = rawPair();
    expect(p.feeMinor).toBe(30000);
    expect(String(p.feeCurrency)).toBe("USD");
    expect(p.configMinor).toBe(30000);
    expect(String(p.feeActor)).toContain("migration_0201");

    /* (b) IDEMPOTENT: running it again changes nothing. */
    const beforeSecond = JSON.stringify(rawPair());
    rawDb().exec(sql);
    expect(JSON.stringify(rawPair())).toBe(beforeSecond);

    /* (c) ABSENT config row: no row is created and platform_fees is left alone —
           an absence is a state, not a disagreement (R95). */
    run(`DELETE FROM ${CONFIG_TABLE} WHERE id = 'default'`);
    run(
      `UPDATE platform_fees SET amount_minor = 30000, currency = 'USD', updated_by_user_id = 'w153:fixture' WHERE key = ?`,
      APPLICATION_FEE_PLATFORM_KEY,
    );
    rawDb().exec(sql);
    const cfgCount = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM ${CONFIG_TABLE} WHERE id = 'default'`)
      .get() as { n: number };
    expect(cfgCount.n).toBe(0);
    p = rawPair();
    expect(p.feeMinor).toBe(30000);
    expect(String(p.feeActor)).toBe("w153:fixture");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F-T3 — THE FOUNDER SURFACE AND THE ADMIN CONSOLE QUOTE THE SAME FIGURE.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 153 · F-T3 — founder route and admin console agree", () => {
  it("agree after a write through the platform-fees route", async () => {
    await putPlatformFee({ amountMinor: 33300, currency: "USD" });
    const founder = await asAdmin(request(app).get("/api/collective/application-fee"));
    const admin = await asAdmin(request(app).get("/api/admin/platform-fees"));
    expect(founder.status).toBe(200);
    expect(founder.body.amountMinor).toBe(33300);
    const row = (admin.body.fees as Array<{ key: string; amountMinor: number | null }>).find(
      (f) => f.key === APPLICATION_FEE_PLATFORM_KEY,
    );
    expect(row?.amountMinor).toBe(33300);
    expect(row?.amountMinor).toBe(founder.body.amountMinor);
  });

  it("agree after a write through the collective route (the hole that had no mirror back)", async () => {
    await putCollectiveFee({ amountMinor: 29900, currency: "USD" });
    const founder = await asAdmin(request(app).get("/api/collective/application-fee"));
    const admin = await asAdmin(request(app).get("/api/admin/platform-fees"));
    const row = (admin.body.fees as Array<{ key: string; amountMinor: number | null }>).find(
      (f) => f.key === APPLICATION_FEE_PLATFORM_KEY,
    );
    expect(founder.body.amountMinor).toBe(29900);
    expect(row?.amountMinor).toBe(29900);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F-T4 — THE ABSENCE CONTRACT IS UNCHANGED (wave 142/144/145, R108.2, R109).
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 153 · F-T4 — absence still reads as absence on both audiences", () => {
  it("the founder body is FALSY and the admin surface says `missing`", async () => {
    run(`DELETE FROM ${CONFIG_TABLE} WHERE id = 'default'`);
    run(`DELETE FROM platform_fees WHERE key = ?`, APPLICATION_FEE_PLATFORM_KEY);
    invalidateFeeCache();

    const founder = await asAdmin(request(app).get("/api/collective/application-fee"));
    expect(founder.status).toBe(200); // R108.2 — never a 503
    /* R109: the sacred founder page guards on the PRESENCE of the object, so the
       body has to be falsy. A diagnostic object here renders "$0.00 USD". */
    expect(founder.body).toBeFalsy();
    expect(JSON.stringify(founder.body ?? null)).not.toContain("30000");

    const cfg = await asAdmin(request(app).get("/api/admin/collective/application-fee"));
    expect(cfg.status).toBe(200);
    expect(cfg.body.source).toBe("missing");
    expect(cfg.body.amountMinor).toBeNull();

    const admin = await asAdmin(request(app).get("/api/admin/platform-fees"));
    const row = (admin.body.fees as Array<{ key: string; amountMinor: number | null; source: string }>).find(
      (f) => f.key === APPLICATION_FEE_PLATFORM_KEY,
    );
    /* Either the key is reported absent, or it is not listed at all — but it is
       NEVER listed carrying the reference figure. */
    if (row) {
      expect(row.amountMinor).toBeNull();
      expect(row.source).toBe("missing");
    }
    expect(getApplicationFeeMinor().amountMinor).toBeNull();
    expect(getApplicationFeeMinor().source).toBe("missing");
  });

  it("a FIRST write onto an empty pair still lands in both rows", async () => {
    run(`DELETE FROM ${CONFIG_TABLE} WHERE id = 'default'`);
    run(`DELETE FROM platform_fees WHERE key = ?`, APPLICATION_FEE_PLATFORM_KEY);
    invalidateFeeCache();
    const res = await putCollectiveFee({ amountMinor: 30500, currency: "USD" });
    expect(res.status).toBe(200);
    const p = rawPair();
    expect(p.feeMinor).toBe(30500);
    expect(p.configMinor).toBe(30500);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F-T5 — INVALIDATION, AND THE NEXT REQUEST.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 153 · F-T5 — a change is visible on the NEXT request, from both routes", () => {
  it("both writer routes call invalidateAllPricingCaches (the collective route used to call nothing)", () => {
    const collective = stripped("server/adminCollectiveFeeRoutes.ts");
    const platform = stripped("server/adminPlatformFeesRoutes.ts");
    expect(collective).toContain('invalidateAllPricingCaches("collective_application_fee.set")');
    expect(platform).toContain("invalidateAllPricingCaches(");
  });

  it("the founder surface reflects an edit made through either route immediately", async () => {
    await putPlatformFee({ amountMinor: 31000, currency: "USD" });
    let founder = await asAdmin(request(app).get("/api/collective/application-fee"));
    expect(founder.body.amountMinor).toBe(31000);
    await putCollectiveFee({ amountMinor: 32000, currency: "USD" });
    founder = await asAdmin(request(app).get("/api/collective/application-fee"));
    expect(founder.body.amountMinor).toBe(32000);
    expect(getFee(APPLICATION_FEE_PLATFORM_KEY).amountMinor).toBe(32000);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F-T6 — THE MECHANISM IS GONE FROM THE SHIPPING FILE, AND THE OLD PINS HOLD.
   ══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 153 · F-T6 — the swallow is gone; nothing else was loosened", () => {
  it("no executable code swallows the mirror failure any more", () => {
    const code = stripped("server/adminPlatformFeesRoutes.ts");
    /* The exact swallow: a catch binding named mirrorErr with a warn. Comments are
       stripped first, so the historical record kept in a comment cannot make this
       pass or fail. */
    expect(code).not.toContain("catch (mirrorErr)");
    /* The precise phrase the removed handler logged. ("non-fatal" on its own still
       appears on the AUDIT-append handler a few lines below, which is a different
       and legitimate case: the money write has already committed there, and a
       failed audit append must not un-commit it.) */
    expect(code).not.toContain("mirror-write failed (non-fatal)");
    expect(code).toContain("writeApplicationFeeBothSources(");
    expect(code).toContain("APPLICATION_FEE_MIRROR_FAILED");
  });

  it("the wave-131 byte pin on this file is still literally present", () => {
    /* server/__tests__/wave131_one_pricing_console.test.ts:461-467 asserts this
       exact text. It is why the call site stayed in the route file. */
    const raw = rawSource("server/adminPlatformFeesRoutes.ts");
    expect(raw).toContain("updateApplicationFee(\n          amountMinor,");
    expect(raw).not.toContain("fromMinor(amountMinor");
  });

  it("the reference figure is unchanged and is NOT used as a fallback by the paired writer", () => {
    /* R107.1 / R108.2 — 30000 is a documented reference, not a default. */
    expect(DEFAULT_APPLICATION_FEE_MINOR).toBe(30000);
    const mirror = stripped("server/lib/applicationFeeMirror.ts");
    expect(mirror).not.toContain("DEFAULT_APPLICATION_FEE_MINOR");
    /* No money coercion on this path. */
    expect(mirror).not.toMatch(/(Number|parseInt|parseFloat)\s*\(\s*[A-Za-z_$][\w$.]*(amountMinor|Minor)/);
  });

  it("the resolver's own writer is still the only SQL that touches the config row", () => {
    const mirror = stripped("server/lib/applicationFeeMirror.ts");
    /* The helper READS both rows to verify, and WRITES through the existing
       functions. It must not carry its own UPSERT of the config table. */
    expect(mirror).not.toMatch(/INSERT\s+INTO\s+collective_application_fee_config/i);
    expect(mirror).toContain("updateApplicationFeeConfig");
    /* And the resolver writer itself is untouched and still re-validates. */
    expect(typeof updateApplicationFee).toBe("function");
  });
});
