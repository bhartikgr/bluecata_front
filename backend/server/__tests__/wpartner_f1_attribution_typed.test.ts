/**
 * w-partner F1 — typed partner_attributions cutover.
 *
 * ANTI-VACUITY: every assertion here fails on the pre-wave tree.
 *   - `partner_portfolio` is not in the pre-wave union, and the pre-wave
 *     `create` has no 5th `opts` parameter at all.
 *   - The pre-wave `create` is best-effort kv only: a durable-write failure
 *     leaves the RAM row in place and returns success. The strict-throw +
 *     RAM-rollback assertions below therefore fail before the wave.
 *   - `backfillPartnerAttributionsFromKv` does not exist pre-wave.
 *
 * NO MONEY: this suite touches only partner_attributions /
 * partner_attribution_revisions / kv_partnerAttributions. It never calls
 * Airwallex, funding, or soft-circle code.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";

import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  partnerAttributionStore,
  backfillPartnerAttributionsFromKv,
  hydratePartnerWorkspaceShimStore,
  ATTRIBUTION_SOURCES,
  isAttributionSource,
} from "../partnerWorkspaceStore";

const PARTNER = "ac_consortium_partner_wpartner_f1";
const ACTOR = "u_wpartner_f1_actor";

const KV_ATTR = "kv_partnerAttributions";
const KV_HIST = "kv_partnerAttributionsHistory";

function db(): any {
  return rawDb();
}

function tableExists(name: string): boolean {
  return !!db()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
    .get(name);
}

function countRows(table: string): number {
  return Number((db().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c);
}

/**
 * Run `fn` inside a transaction that is ALWAYS rolled back.
 *
 * The hydrator-fallback regressions below need a GLOBALLY empty typed table
 * (readTypedAttributions() reads the whole table, not one partner's slice), so
 * they must delete rows they do not own. Wrapping in a rolled-back transaction
 * keeps them deterministic and independent — SQLite restores every row, and the
 * kv scaffolding they create is unwound too. Only the in-memory projection
 * survives, which is why each of these tests uses a partner id that appears
 * nowhere else in the suite.
 */
function inRolledBackTx(fn: () => void): void {
  db().exec("BEGIN");
  try {
    fn();
  } finally {
    db().exec("ROLLBACK");
  }
}

function kvAttributionPayload(over: Record<string, unknown>): string {
  const now = new Date().toISOString();
  return JSON.stringify({
    attributedAt: now,
    attributedBy: ACTOR,
    attributionSource: "admin_manual",
    revokedAt: null,
    revokedBy: null,
    notes: null,
    version: 1,
    prevRevisionHash: "",
    revisionHash: "cafebabe",
    updatedAt: now,
    updatedBy: ACTOR,
    isSeed: false,
    ...over,
  });
}

beforeAll(async () => {
  await seedDemoData(getDb());
});

afterEach(() => {
  db().prepare(`DELETE FROM partner_attribution_revisions WHERE partner_id = ?`).run(PARTNER);
  db().prepare(`DELETE FROM partner_attributions WHERE partner_id = ?`).run(PARTNER);
});

describe("w-partner F1 — typed attributions", () => {
  it("0114 created both tables (migration + connection.ts self-heal)", () => {
    expect(tableExists("partner_attributions")).toBe(true);
    expect(tableExists("partner_attribution_revisions")).toBe(true);
  });

  it("partner_portfolio is a first-class attribution source", () => {
    expect(ATTRIBUTION_SOURCES).toContain("partner_portfolio");
    expect(isAttributionSource("partner_portfolio")).toBe(true);
    expect(isAttributionSource("not_a_source")).toBe(false);
  });

  it("create() persists to the typed table AND its revision chain", () => {
    const companyId = "co_wpartner_f1_ok";
    const a = partnerAttributionStore.create(PARTNER, companyId, ACTOR, "partner_portfolio", null, {
      strict: true,
    });

    const row = db()
      .prepare(`SELECT * FROM partner_attributions WHERE id = ?`)
      .get(a.id) as Record<string, any>;
    expect(row).toBeTruthy();
    expect(row.partner_id).toBe(PARTNER);
    expect(row.company_id).toBe(companyId);
    expect(row.attribution_source).toBe("partner_portfolio");

    const rev = db()
      .prepare(`SELECT * FROM partner_attribution_revisions WHERE id = ?`)
      .get(`${a.id}::v1`) as Record<string, any>;
    expect(rev).toBeTruthy();
    expect(rev.attribution_id).toBe(a.id);
    expect(JSON.parse(rev.payload_json).companyId).toBe(companyId);
  });

  it("strict create() THROWS and rolls the RAM row back when the durable write fails", () => {
    const companyId = "co_wpartner_f1_strict";
    const before = partnerAttributionStore.listByPartner(PARTNER).length;
    // L5 — the brief requires the rollback to remove the pushed RAM row AND the
    // pushed history entry. `create` calls pushHistory BEFORE the typed write,
    // so a rollback that only spliced `attributions` would leave a revision for
    // an attribution that never existed. Captured before the throw.
    const historyBefore = partnerAttributionStore.historyForPartner(PARTNER).length;

    /* Force the durable write to fail without mocking the store: drop the
       typed table for the duration of the call, then restore it. A CHECK or
       constraint violation would work too, but "table missing" also proves the
       write is genuinely attempted rather than skipped. */
    db().prepare(`ALTER TABLE partner_attributions RENAME TO partner_attributions__tmp`).run();
    try {
      expect(() =>
        partnerAttributionStore.create(PARTNER, companyId, ACTOR, "partner_portfolio", null, {
          strict: true,
        }),
      ).toThrow(/ATTRIBUTION_PERSIST_FAILED/);
    } finally {
      db().prepare(`ALTER TABLE partner_attributions__tmp RENAME TO partner_attributions`).run();
    }

    // RAM projection must NOT claim an attribution the DB does not hold.
    const after = partnerAttributionStore.listByPartner(PARTNER);
    expect(after.length).toBe(before);
    expect(after.find((x) => x.companyId === companyId)).toBeUndefined();

    // L5 — and the audit chain must not record the attribution either.
    const historyAfter = partnerAttributionStore.historyForPartner(PARTNER);
    expect(historyAfter.length).toBe(historyBefore);
    expect(historyAfter.find((h) => h.companyId === companyId)).toBeUndefined();
  });

  it("non-strict create() stays best-effort (existing callers unchanged)", () => {
    const companyId = "co_wpartner_f1_lenient";
    db().prepare(`ALTER TABLE partner_attributions RENAME TO partner_attributions__tmp`).run();
    let a: { companyId: string } | null = null;
    try {
      a = partnerAttributionStore.create(PARTNER, companyId, ACTOR, "admin_manual", null);
    } finally {
      db().prepare(`ALTER TABLE partner_attributions__tmp RENAME TO partner_attributions`).run();
    }
    expect(a?.companyId).toBe(companyId);
    expect(
      partnerAttributionStore.listByPartner(PARTNER).find((x) => x.companyId === companyId),
    ).toBeTruthy();
  });

  it("strict revoke() restores the pre-mutation snapshot on durable failure", () => {
    const companyId = "co_wpartner_f1_revoke";
    partnerAttributionStore.create(PARTNER, companyId, ACTOR, "partner_portfolio", null, {
      strict: true,
    });
    const live = partnerAttributionStore.listByPartner(PARTNER).find((x) => x.companyId === companyId)!;
    const versionBefore = live.version;
    // L5 — the successful create above pushed v1. The failed revoke below pushes
    // v2 before attempting the durable write, so the rollback must DROP that
    // pushed entry; otherwise the chain records a revocation that never happened.
    const historyBefore = partnerAttributionStore.historyForPartner(PARTNER).length;

    db().prepare(`ALTER TABLE partner_attributions RENAME TO partner_attributions__tmp`).run();
    try {
      expect(() =>
        partnerAttributionStore.revoke(PARTNER, companyId, ACTOR, { strict: true }),
      ).toThrow(/ATTRIBUTION_REVOKE_PERSIST_FAILED/);
    } finally {
      db().prepare(`ALTER TABLE partner_attributions__tmp RENAME TO partner_attributions`).run();
    }

    // revoke mutates in place, so the rollback is a snapshot restore, not a pop.
    const after = partnerAttributionStore.listByPartner(PARTNER).find((x) => x.companyId === companyId)!;
    expect(after.revokedAt).toBeNull();
    expect(after.version).toBe(versionBefore);

    // L5 — the pushed v2 revision entry must be gone; only the create's v1 remains.
    const chain = partnerAttributionStore
      .historyForPartner(PARTNER)
      .filter((h) => h.companyId === companyId);
    expect(partnerAttributionStore.historyForPartner(PARTNER).length).toBe(historyBefore);
    expect(chain.find((h) => h.version === versionBefore + 1)).toBeUndefined();
    expect(chain.every((h) => h.revokedAt === null)).toBe(true);
  });
});

describe("w-partner F1 — kv -> typed backfill", () => {
  const KV = "kv_partnerAttributions";

  afterEach(() => {
    if (tableExists(KV)) {
      db().prepare(`DELETE FROM ${KV} WHERE id LIKE 'patr_wpf1%'`).run();
    }
  });

  /* L3 — this previously read `if (tableExists(KV)) return;`, which turned the
     whole test into a green no-op whenever the kv table happened to exist (which
     it does on any run where the coercion test below has already created it), so
     the "does not lazily create the kv table" claim was almost never asserted.
     Now we FORCE the kv-absent state inside a rolled-back transaction, so the
     assertion runs deterministically on every run and in any test order.

     The claim matters: backfillPartnerAttributionsFromKv must PROBE sqlite_master
     rather than call hydrateEntries defensively, because hydrateEntries runs
     ensureTable() internally and would lazily create an empty kv table —
     permanently poisoning the kv fallback that B1 depends on. */
  it("is a no-op (and does NOT lazily create the kv table) when kv is absent", () => {
    inRolledBackTx(() => {
      db().exec(`DROP TABLE IF EXISTS ${KV}`);
      expect(tableExists(KV)).toBe(false);

      const r = backfillPartnerAttributionsFromKv();

      expect(r).toEqual({ scanned: 0, inserted: 0, coerced: 0, skipped: 0 });
      // The load-bearing half: the probe must not have materialised the table.
      expect(tableExists(KV)).toBe(false);
    });
  });

  it("COERCES an unrecognised historical attribution_source to admin_manual", () => {
    db().exec(
      `CREATE TABLE IF NOT EXISTS ${KV} (
         id TEXT PRIMARY KEY NOT NULL,
         payload_json TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         deleted_at TEXT
       );`,
    );
    const id = "patr_wpf1_junk";
    const now = new Date().toISOString();
    db()
      .prepare(`INSERT OR REPLACE INTO ${KV} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`)
      .run(
        id,
        JSON.stringify({
          id,
          partnerId: PARTNER,
          companyId: "co_wpartner_f1_backfill",
          attributedAt: now,
          attributedBy: ACTOR,
          attributionSource: "legacy_nonsense_value",
          revokedAt: null,
          revokedBy: null,
          notes: null,
          version: 1,
          prevRevisionHash: "",
          revisionHash: "deadbeef",
          updatedAt: now,
          updatedBy: ACTOR,
          isSeed: false,
        }),
        now,
      );

    const r = backfillPartnerAttributionsFromKv();
    expect(r.coerced).toBeGreaterThanOrEqual(1);

    const row = db()
      .prepare(`SELECT attribution_source FROM partner_attributions WHERE id = ?`)
      .get(id) as { attribution_source?: string } | undefined;
    // Coerced, NOT dropped — the historical (revenue-bearing) row survives, and
    // the 0114 CHECK is not violated.
    expect(row?.attribution_source).toBe("admin_manual");
  });

  /* L4 — this previously ran the backfill twice over whatever happened to be in
     kv, which after the enclosing afterEach is NOTHING: `inserted === 0` on the
     second run was satisfied by an empty scan, so a backfill that re-inserted on
     every boot would still have passed. Seed a row inside the test so idempotency
     is asserted over real data that the FIRST run actually inserts. */
  it("is idempotent — a second run inserts nothing new", () => {
    db().exec(
      `CREATE TABLE IF NOT EXISTS ${KV} (
         id TEXT PRIMARY KEY NOT NULL,
         payload_json TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         deleted_at TEXT
       );`,
    );
    const id = "patr_wpf1_idem";
    const companyId = "co_wpartner_f1_idem";
    const now = new Date().toISOString();
    db()
      .prepare(`INSERT OR REPLACE INTO ${KV} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`)
      .run(id, kvAttributionPayload({ id, partnerId: PARTNER, companyId }), now);

    const first = backfillPartnerAttributionsFromKv();
    // The first run must genuinely do the work, or the second assertion is vacuous.
    expect(first.inserted).toBeGreaterThanOrEqual(1);
    expect(
      db().prepare(`SELECT id FROM partner_attributions WHERE id = ?`).get(id),
    ).toBeTruthy();
    const rowsAfterFirst = countRows("partner_attributions");

    const second = backfillPartnerAttributionsFromKv();

    // ON CONFLICT(id) DO NOTHING — the same kv row must not be inserted twice.
    expect(second.scanned).toBeGreaterThanOrEqual(1);
    expect(second.inserted).toBe(0);
    expect(countRows("partner_attributions")).toBe(rowsAfterFirst);
  });
});

/**
 * CODE-REVIEW B1 / B3 — the hydrator's kv fallback must survive an EMPTY (but
 * PRESENT) typed table.
 *
 * Both readTypedAttributions() and readTypedAttributionRevisions() return null
 * ONLY when their table is absent; a present-but-empty table yields `[]`. Since
 * `[]` is truthy, the pre-fix guards `if (typed)` / `if (!revRows)` adopted the
 * empty typed path and skipped kv entirely. The tables are ALWAYS present —
 * buildProductionTableStatements() runs on every boot — so "present but empty"
 * is the real half-migrated state (a failed or partial backfill for B1; the
 * ordinary first boot after 0114 for B3, since the backfill writes no revision
 * rows at all).
 *
 * ANTI-VACUITY: each test asserts data arrives via kv while the typed table is
 * verifiably empty. Against `if (typed)` / `if (!revRows)` the projection stays
 * empty and both fail. Neither can pass by accident: the partner ids are unique
 * to this block, and each test asserts the projection is EMPTY before hydrating,
 * so a row left behind by another test cannot satisfy it.
 */
describe("w-partner F1 — hydrator kv fallback (CODE-REVIEW B1/B3)", () => {
  const B1_PARTNER = "ac_consortium_partner_wpartner_b1_kvonly";
  const B3_PARTNER = "ac_consortium_partner_wpartner_b3_kvonly";

  it("B1: an EMPTY typed table does NOT shadow a populated kv table", () => {
    const id = "patr_wpf1_b1_kvonly";
    const companyId = "co_wpartner_b1_kvonly";

    inRolledBackTx(() => {
      db().exec(
        `CREATE TABLE IF NOT EXISTS ${KV_ATTR} (
           id TEXT PRIMARY KEY NOT NULL,
           payload_json TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           deleted_at TEXT
         );`,
      );
      db()
        .prepare(`INSERT OR REPLACE INTO ${KV_ATTR} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`)
        .run(id, kvAttributionPayload({ id, partnerId: B1_PARTNER, companyId }), new Date().toISOString());

      // The typed table must be PRESENT and EMPTY — that is the whole scenario.
      db().prepare(`DELETE FROM partner_attributions`).run();
      expect(tableExists("partner_attributions")).toBe(true);
      expect(countRows("partner_attributions")).toBe(0);

      // Guard against a vacuous pass: nothing for this partner in RAM yet.
      expect(partnerAttributionStore.listByPartner(B1_PARTNER)).toHaveLength(0);

      hydratePartnerWorkspaceShimStore();

      // Pre-fix (`if (typed)`) this is still [] — the empty typed read won and
      // the kv rows were discarded, silently zeroing the projection that three
      // authorization gates read.
      const got = partnerAttributionStore.listByPartner(B1_PARTNER);
      expect(got.map((a) => a.companyId)).toContain(companyId);
      expect(got.find((a) => a.id === id)).toBeTruthy();
    });
  });

  it("B3: an EMPTY typed revision table does NOT shadow the kv history (R-c)", () => {
    const id = "patr_wpf1_b3_kvonly";
    const companyId = "co_wpartner_b3_kvonly";

    inRolledBackTx(() => {
      db().exec(
        `CREATE TABLE IF NOT EXISTS ${KV_HIST} (
           id TEXT PRIMARY KEY NOT NULL,
           payload_json TEXT NOT NULL,
           updated_at TEXT NOT NULL,
           deleted_at TEXT
         );`,
      );
      const now = new Date().toISOString();
      db()
        .prepare(`INSERT OR REPLACE INTO ${KV_HIST} (id, payload_json, updated_at, deleted_at) VALUES (?, ?, ?, NULL)`)
        .run(
          `${id}::v1`,
          kvAttributionPayload({ id, partnerId: B3_PARTNER, companyId, version: 1 }),
          now,
        );

      // Present + empty: exactly what 0114 leaves behind on first boot, because
      // backfillPartnerAttributionsFromKv writes attributions but no revisions.
      db().prepare(`DELETE FROM partner_attribution_revisions`).run();
      expect(tableExists("partner_attribution_revisions")).toBe(true);
      expect(countRows("partner_attribution_revisions")).toBe(0);

      expect(partnerAttributionStore.historyForPartner(B3_PARTNER)).toHaveLength(0);
      // Vacuously green before the fix — the whole point of R-c.
      expect(partnerAttributionStore.verifyChain(B3_PARTNER, companyId).length).toBe(0);

      hydratePartnerWorkspaceShimStore();

      // Pre-fix (`if (!revRows)`) the kv history was never consulted and both of
      // these stayed at 0, leaving verifyChain vacuously {ok:true,length:0} for
      // every pre-existing attribution.
      expect(partnerAttributionStore.historyForPartner(B3_PARTNER).length).toBeGreaterThan(0);
      expect(partnerAttributionStore.verifyChain(B3_PARTNER, companyId).length).toBeGreaterThan(0);
    });
  });
});
