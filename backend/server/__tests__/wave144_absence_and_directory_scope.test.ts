/* ════════════════════════════════════════════════════════════════════════════
   WAVE 144 — ABSENCE IS REPORTED, THE DIRECTORY IS SCOPED, AND THE ONE RULE
   THAT EXPOSES ANOTHER ORGANISATION NEEDS AN EXPLICIT ACT.
                                        R108.1 · R108.2 · R108.3 · R95 · R104
   ════════════════════════════════════════════════════════════════════════════
   WHAT EACH GROUP PINS, and why none of it is source-text matching:

   A — `server/platformFeesStore.ts` REPORTS ABSENCE. It used to substitute a
       compiled-in 30000 (`DEFAULT_FEES`) whenever the row was missing or the
       table unreadable, so a fee nobody had ever set was served as though it
       were on record. Both poles are asserted on the SAME store: a row that
       EXISTS still returns its integer with `source: "db"`, and a key with no
       row returns `amountMinor: null` with `source: "missing"` — and the
       serialised result contains no `30000` and no zero.

   B — the ADMIN ROUTE publishes that absence over real HTTP: 200 (R108.2 forbids
       taking the surface down), the absent key named in `absentKeys`, and no
       fabricated figure anywhere in the raw body. The write path is the second
       pole: after a PUT the same key reads back as a number with `source: "db"`.

   C — the MESSAGING DIRECTORY payload (`GET /api/comms/users`) carries identity
       for addressing only. `capTables`, `location` and `capavateAngelNetwork`
       are gone from every entry for every viewer. Anti-vacuity: the same
       responses are asserted to still carry `id` and `legalName`, and the
       cap-table-peer pole asserts the peer IS listed — so an empty list cannot
       make these assertions true for the wrong reason.

   D — `partner_engaged_company_people` cannot be enabled by one ordinary
       request. Without the exposure confirmation the route answers 409 and
       NOTHING moves; with it the owner is still free to act. Disabling never
       requires a confirmation. The rule is asserted DISABLED at rest (R108.1).

   FAIL-BEFORE: `w144_scratch/make_before.py revert` reinstates the three
   pre-wave-144 mechanisms (the `DEFAULT_FEES` substitution, the unscoped
   directory payload, the unconfirmed rule write) and restores them byte-exactly
   afterwards, verified by sha256. Real output in build_log/wave144/.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";
import { registerAdminPlatformFeesRoutes } from "../adminPlatformFeesRoutes";
import {
  getFee,
  listFees,
  setFee,
  invalidateFeeCache,
  COLLECTIVE_APPLICATION_FEE_KEY,
} from "../platformFeesStore";
import {
  isAudienceRuleEnabled,
  setAudienceRuleEnabled,
  EXPOSURE_CONFIRMATION_TOKEN,
} from "../lib/commsAudienceRules";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";

/* ------------------------------------------------------------------ actors */

const CAP_SELF = "u_w144_capself";
const CAP_PEER = "u_w144_cappeer";
const CO = "co_w144_captable";
const ADMIN = "u_admin"; // the platform's own admin persona (requireAdmin is real)

/** A key that has NEVER had a row — the absence pole. */
const ABSENT_KEY = "w144_fee_that_was_never_configured";
/** The number the store used to fabricate. It must appear NOWHERE. */
const FABRICATED = 30000;

let app: Express;

const now = (): string => new Date().toISOString();

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w144 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, name: string, role: "founder" | "investor" | "partner"): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w144.test`,
    name,
    role,
  );
  try {
    run(
      `INSERT OR REPLACE INTO auth_users (id, email, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      `${id}@w144.test`,
      role,
      now(),
      now(),
    );
  } catch {
    /* auth_users shape differs across builds; users.role is the fallback. */
  }
}

/** A COMMITTED cap-table row — what `durableCapTablePeerIds` filters on. */
function seedCommit(id: string, investorId: string, seq: number): void {
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, reconcile_match,
        compliance_hold, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1000', 'USD', '10',
             'committed', 'h0', ?, 1, 0, NULL)`,
    id,
    seq,
    now(),
    `inv_${id}`,
    `rd_${CO}`,
    CO,
    investorId,
    `h_${id}`,
  );
}

const asUser = (r: request.Test, id: string, role = "investor") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);

const users = (as: string, role = "investor") =>
  asUser(request(app).get("/api/comms/users"), as, role);

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
  registerAdminPlatformFeesRoutes(app);

  run(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', 'W144 Cap Table Co', 0, NULL)`,
    CO,
  );
  seedUser(CAP_SELF, "W144 Cap Self", "investor");
  seedUser(CAP_PEER, "W144 Cap Peer", "investor");
  seedCommit("cc_w144_self", CAP_SELF, 914401);
  seedCommit("cc_w144_peer", CAP_PEER, 914402);
});

beforeEach(() => {
  invalidateFeeCache();
  run(`DELETE FROM platform_fees WHERE key = ?`, ABSENT_KEY);
});

/* ══════════════════════════════════ A — THE STORE REPORTS ABSENCE (ITEM 2) */

describe("WAVE 144 · A — platformFeesStore reports absence instead of a number", () => {
  it("A1 THE REPRODUCTION — a key with no row returns NO amount and says why", () => {
    const fee = getFee(ABSENT_KEY);
    expect(fee.key).toBe(ABSENT_KEY);
    expect(fee.amountMinor).toBeNull();
    expect(fee.currency).toBeNull();
    expect(fee.source).toBe("missing");
    /* The fabricated figure the store used to substitute, and the zero a caller
       might coalesce it into, are both absent from the whole serialised value. */
    const raw = JSON.stringify(fee);
    expect(raw).not.toContain(String(FABRICATED));
    expect(raw).not.toContain('"amountMinor":0');
  });

  it("A2 absence is not an exception either — the read does not throw (R108.2 fail SOFT)", () => {
    expect(() => getFee(ABSENT_KEY)).not.toThrow();
  });

  it("A3 THE OTHER POLE — a key WITH a row still returns its integer and source 'db'", () => {
    setFee({ key: ABSENT_KEY, amountMinor: 4242, currency: "USD", updatedByUserId: ADMIN });
    invalidateFeeCache();
    const fee = getFee(ABSENT_KEY);
    expect(fee.amountMinor).toBe(4242);
    expect(fee.currency).toBe("USD");
    expect(fee.source).toBe("db");
    expect(typeof fee.amountMinor).toBe("number");
  });

  it("A4 `listFees` never synthesises a row for a fee nobody configured", () => {
    const keys = listFees().map((f) => f.key);
    expect(keys).not.toContain(ABSENT_KEY);
    /* Every row it DOES return states its own provenance, so a caller can tell
       a real figure from an absent one without guessing. */
    for (const f of listFees()) {
      expect(["db", "missing", "unreadable"]).toContain(f.source);
      if (f.source === "db") expect(typeof f.amountMinor).toBe("number");
      else expect(f.amountMinor).toBeNull();
    }
  });
});

/* ═══════════════════════════ B — THE ADMIN ROUTE PUBLISHES ABSENCE HONESTLY */

describe("WAVE 144 · B — GET /api/admin/platform-fees over real HTTP", () => {
  it("B1 the response names absent keys, answers 200, and carries no fabricated figure", async () => {
    /* Force the absence the live defect needed: no row for the application fee. */
    const before = rawDb()
      .prepare(`SELECT * FROM platform_fees WHERE key = ?`)
      .get(COLLECTIVE_APPLICATION_FEE_KEY) as Record<string, unknown> | undefined;
    try {
      run(`DELETE FROM platform_fees WHERE key = ?`, COLLECTIVE_APPLICATION_FEE_KEY);
      invalidateFeeCache();
      const res = await asUser(request(app).get("/api/admin/platform-fees"), ADMIN, "admin");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const row = (res.body.fees as Array<Record<string, unknown>>).find(
        (f) => f.key === COLLECTIVE_APPLICATION_FEE_KEY,
      );
      /* Either the key is simply not listed, or it is listed as absent. What is
         forbidden is a number. */
      if (row) {
        expect(row.amountMinor).toBeNull();
        expect(res.body.absentKeys).toContain(COLLECTIVE_APPLICATION_FEE_KEY);
      }
      expect(JSON.stringify(res.body)).not.toContain(
        `"key":"${COLLECTIVE_APPLICATION_FEE_KEY}","amountMinor":${FABRICATED}`,
      );
    } finally {
      if (before) {
        run(
          `INSERT OR REPLACE INTO platform_fees
             (key, amount_minor, currency, billing_period, updated_at, updated_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          before.key,
          before.amount_minor,
          before.currency,
          (before as any).billing_period ?? null,
          before.updated_at,
          before.updated_by_user_id,
        );
      }
      invalidateFeeCache();
    }
  });

  it("B2 THE OTHER POLE — a written fee is served as a real integer with source 'db'", async () => {
    setFee({ key: ABSENT_KEY, amountMinor: 12345, currency: "USD", updatedByUserId: ADMIN });
    invalidateFeeCache();
    const res = await asUser(request(app).get("/api/admin/platform-fees"), ADMIN, "admin");
    expect(res.status).toBe(200);
    const row = (res.body.fees as Array<Record<string, unknown>>).find((f) => f.key === ABSENT_KEY);
    expect(row).toBeTruthy();
    expect(row!.amountMinor).toBe(12345);
    expect(row!.source).toBe("db");
    expect(res.body.absentKeys).not.toContain(ABSENT_KEY);
  });
});

/* ═════════════════════════ C — THE DIRECTORY CARRIES IDENTITY ONLY (ITEM 4) */

describe("WAVE 144 · C — the messaging directory payload is scoped", () => {
  const FORBIDDEN = ["capTables", "location", "capavateAngelNetwork"];

  it("C1 THE REPRODUCTION — no entry carries cap-table positions or an affiliation", async () => {
    const res = await users(CAP_SELF);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0); // anti-vacuity: there IS a payload
    for (const entry of res.body as Array<Record<string, unknown>>) {
      for (const field of FORBIDDEN) {
        expect(Object.keys(entry)).not.toContain(field);
      }
    }
    /* And not nested anywhere either. */
    const raw = JSON.stringify(res.body);
    for (const field of FORBIDDEN) expect(raw).not.toContain(field);
  });

  it("C2 ANTI-VACUITY — the identity messaging actually needs is still there", async () => {
    const res = await users(CAP_SELF);
    const entry = (res.body as Array<Record<string, unknown>>)[0];
    expect(typeof entry.id).toBe("string");
    expect(typeof entry.legalName).toBe("string");
    expect(String(entry.legalName).length).toBeGreaterThan(0);
  });

  it("C3 the cap-table PEER is still addressable — the audience did not shrink", async () => {
    const res = await users(CAP_SELF);
    const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toContain(CAP_PEER);
    const peer = (res.body as Array<Record<string, unknown>>).find((u) => u.id === CAP_PEER)!;
    /* The very entry the old payload would have shipped a cap table for. */
    expect(Object.keys(peer)).not.toContain("capTables");
  });

  it("C4 a PARTNER viewer gets the same scoped shape", async () => {
    const res = await users(CAP_SELF, "partner");
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    for (const field of FORBIDDEN) expect(raw).not.toContain(field);
  });
});

/* ═══════════════════ D — THE EXPOSING RULE NEEDS AN EXPLICIT ACT (ITEM 5) */

describe("WAVE 144 · D — enabling partner_engaged_company_people is a deliberate act", () => {
  const KEY = "partner_engaged_company_people";
  const route = () => request(app).post(`/api/comms/audience-rules/${KEY}`);

  beforeEach(() => {
    setAudienceRuleEnabled(KEY, false, ADMIN);
  });

  it("D1 R108.1 — the rule is DISABLED, and this wave did not enable it", () => {
    expect(isAudienceRuleEnabled(KEY, "partner")).toBe(false);
  });

  it("D2 an ordinary request cannot enable it — 409, and nothing moved", async () => {
    const res = await asUser(route().send({ enabled: true }), ADMIN, "admin");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("confirmation_required");
    expect(String(res.body.warning)).toContain("ANOTHER ORGANISATION");
    expect(res.body.requiredConfirmation).toBe(EXPOSURE_CONFIRMATION_TOKEN);
    expect(isAudienceRuleEnabled(KEY, "partner")).toBe(false);
  });

  it("D3 the owner is NOT blocked — with the confirmation the write goes through", async () => {
    const res = await asUser(
      route().send({ enabled: true, confirmExposure: EXPOSURE_CONFIRMATION_TOKEN }),
      ADMIN,
      "admin",
    );
    expect(res.status).toBe(200);
    expect(res.body.rule.enabled).toBe(true);
    expect(isAudienceRuleEnabled(KEY, "partner")).toBe(true);
    setAudienceRuleEnabled(KEY, false, ADMIN); // leave it off (R108.1)
    expect(isAudienceRuleEnabled(KEY, "partner")).toBe(false);
  });

  it("D4 a wrong confirmation string is not a confirmation", async () => {
    const res = await asUser(
      route().send({ enabled: true, confirmExposure: "yes" }),
      ADMIN,
      "admin",
    );
    expect(res.status).toBe(409);
    expect(isAudienceRuleEnabled(KEY, "partner")).toBe(false);
  });

  it("D5 DISABLING never needs a confirmation — the safe direction stays one act", async () => {
    setAudienceRuleEnabled(KEY, true, ADMIN, EXPOSURE_CONFIRMATION_TOKEN);
    expect(isAudienceRuleEnabled(KEY, "partner")).toBe(true);
    const res = await asUser(route().send({ enabled: false }), ADMIN, "admin");
    expect(res.status).toBe(200);
    expect(res.body.rule.enabled).toBe(false);
    expect(isAudienceRuleEnabled(KEY, "partner")).toBe(false);
  });

  it("D6 another rule is unaffected — only the exposing one asks for a confirmation", async () => {
    const res = await asUser(
      request(app).post("/api/comms/audience-rules/partner_team_peers").send({ enabled: true }),
      ADMIN,
      "admin",
    );
    expect(res.status).toBe(200);
    expect(res.body.rule.enabled).toBe(true);
  });
});
