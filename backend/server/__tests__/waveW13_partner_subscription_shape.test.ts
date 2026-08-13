/**
 * WAVE 13 — the `partner_subscription` reshape, proved against real databases.
 *
 * WHAT IS BEING PROVED, AND WHY EACH TEST WOULD FAIL BEFORE THIS WAVE
 *
 *  1. LEGACY → CANONICAL PRESERVES EVERY ROW AND EVERY FIELD. A rebuild is the
 *     one operation in this wave that can destroy production data, so it is
 *     asserted field by field on a seeded Wave 5 table, not just by row count.
 *     Before Wave 13 there was no reshape at all and the legacy shape simply
 *     stayed, so `subject_kind` did not exist for any consumer to read.
 *  2. THE 0167 SHAPE ALSO REACHES THE SAME CANONICAL SHAPE. The same file must
 *     be safe on a fresh chain, where 0167 already created the table — that is
 *     what makes 0169 shape-agnostic rather than "works on my database".
 *  3. IDEMPOTENCE. Applying 0169 twice must not lose a row or change a value.
 *  4. THE ABSENT CASE. On a database that has no such table at all (every
 *     `:memory:` test DB), 0169 creates the canonical shape outright.
 *  5. THE A-22 HALF. Both self-heal installers must now produce the CANONICAL
 *     shape. Before this wave applyWave5MoneySchema re-created the LEGACY shape
 *     on every fresh install and every test database — where numbered migrations
 *     never run — so a migration-only fix would have regressed silently.
 *  6. partnerBillingStore round-trips through the canonical columns. It was the
 *     one consumer still writing `partner_id` / `cadence` / `period_*`.
 *  7. Mirror parity: migrations/0169 and server/db/migrations/0169 are identical
 *     bytes, since the installers may read EITHER copy.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getDb, rawDb } from "../db/connection";
import {
  applyWave13SubscriptionShape,
  partnerSubscriptionShape,
  partnerSubscriptionColumns,
  W13_CANONICAL_COLUMNS,
  W13_LEGACY_ONLY_COLUMNS,
  W13_SHAPE_MIGRATION,
} from "../lib/applyWave13SubscriptionShape";
import { ensureWave5MoneySchema, applyWave5MoneySchema } from "../lib/applyWave5MoneySchema";
import { applyWave11SubscriptionSchema } from "../lib/applyWave11SubscriptionSchema";
import {
  setTierPrice,
  quotePartnerSubscription,
  createSubscription,
  getLiveSubscription,
  listSubscriptions,
} from "../lib/partnerBillingStore";

const require_ = createRequire(__filename);
const Database = require_("better-sqlite3");
const ROOT = path.resolve(__dirname, "..", "..");

/** The exact Wave 5 declaration that 0153 used to create, verbatim from history. */
const LEGACY_DDL = `
CREATE TABLE partner_subscription (
  id                    TEXT    PRIMARY KEY NOT NULL,
  partner_id            TEXT    NOT NULL,
  tier_slug             TEXT    NOT NULL,
  cadence               TEXT    NOT NULL CHECK (cadence IN ('monthly','annual','quarterly','one_time')),
  status                TEXT    NOT NULL
                          CHECK (status IN ('pending','active','past_due','cancelled','grandfathered','superseded')),
  amount_minor          INTEGER NOT NULL CHECK (amount_minor >= 0),
  list_amount_minor     INTEGER NOT NULL CHECK (list_amount_minor >= 0),
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  discount_code         TEXT,
  currency              TEXT    NOT NULL DEFAULT 'USD',
  price_derivation      TEXT    NOT NULL DEFAULT 'tier_price_row'
                          CHECK (price_derivation IN ('tier_price_row','partner_override','legacy_x12','grandfathered_free')),
  period_start          TEXT,
  period_end            TEXT,
  payment_intent_id     TEXT,
  grandfathered_from    TEXT,
  superseded_by         TEXT,
  superseded_reason     TEXT,
  cancelled_at          TEXT,
  created_at            TEXT    NOT NULL
                          CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at            TEXT    NOT NULL
                          CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  created_by            TEXT,
  CHECK (amount_minor = list_amount_minor - discount_minor)
) STRICT;
CREATE INDEX idx_psub_partner ON partner_subscription(partner_id, status);
CREATE INDEX idx_psub_intent  ON partner_subscription(payment_intent_id);
CREATE UNIQUE INDEX uq_psub_one_live
  ON partner_subscription(partner_id)
  WHERE status IN ('pending','active','past_due','grandfathered');
`;

/** 0167's declaration, read from the migration on disk so it cannot drift. */
function readMigration(basename: string): string {
  const p = path.join(ROOT, "migrations", basename);
  return fs.readFileSync(p, "utf8");
}

const LEGACY_ROWS = [
  {
    id: "psub_legacy_live",
    partner_id: "prt_alpha",
    tier_slug: "consortium",
    cadence: "annual",
    status: "active",
    amount_minor: 900_00,
    list_amount_minor: 1000_00,
    discount_minor: 100_00,
    discount_code: "LAUNCH10",
    currency: "USD",
    price_derivation: "tier_price_row",
    period_start: "2026-01-01T00:00:00Z",
    period_end: "2027-01-01T00:00:00Z",
    payment_intent_id: "int_abc123",
    grandfathered_from: null,
    superseded_by: null,
    superseded_reason: null,
    cancelled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    created_by: "admin:owner",
  },
  {
    id: "psub_legacy_superseded",
    partner_id: "prt_beta",
    tier_slug: "founder_free",
    cadence: "monthly",
    status: "superseded",
    amount_minor: 0,
    list_amount_minor: 0,
    discount_minor: 0,
    discount_code: null,
    currency: "USD",
    price_derivation: "grandfathered_free",
    period_start: null,
    period_end: null,
    payment_intent_id: null,
    grandfathered_from: "psub_ancient",
    superseded_by: "psub_legacy_live",
    superseded_reason: "CP-PROMO-19: promotion supersedes grandfathered free tier",
    cancelled_at: null,
    created_at: "2025-06-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: "system:seed",
  },
];

function seedLegacy(db: any): void {
  db.exec(LEGACY_DDL);
  const cols = Object.keys(LEGACY_ROWS[0]);
  const stmt = db.prepare(
    `INSERT INTO partner_subscription (${cols.join(",")}) VALUES (${cols.map((c) => "@" + c).join(",")})`,
  );
  for (const r of LEGACY_ROWS) stmt.run(r as any);
}

/** Apply the migration file the way the runner does: statement by statement,
 *  swallowing only the runner's idempotent error set. */
function applyShapeMigration(db: any): void {
  const res = applyWave13SubscriptionShape(db);
  expect(res.reason, `0169 must apply cleanly: ${res.reason}`).toBe("applied");
  expect(res.applied).toBe(true);
}

describe("WAVE 13 — partner_subscription shape reconciliation", () => {
  it("1. reshapes the Wave 5 legacy table to canonical WITHOUT losing a row or a field", () => {
    const db = new Database(":memory:");
    seedLegacy(db);
    expect(partnerSubscriptionShape(db)).toBe("legacy");

    const before = db.prepare("SELECT COUNT(*) AS n FROM partner_subscription").get().n;
    expect(before).toBe(LEGACY_ROWS.length);

    applyShapeMigration(db);

    expect(partnerSubscriptionShape(db)).toBe("canonical");
    // Every legacy-only column is GONE — one shape, not two overlapping ones.
    const cols = partnerSubscriptionColumns(db);
    for (const legacy of W13_LEGACY_ONLY_COLUMNS) expect(cols).not.toContain(legacy);
    for (const canonical of W13_CANONICAL_COLUMNS) expect(cols).toContain(canonical);

    const rows = db.prepare("SELECT * FROM partner_subscription ORDER BY id").all();
    expect(rows.length).toBe(LEGACY_ROWS.length);

    const live = rows.find((r: any) => r.id === "psub_legacy_live")!;
    const src = LEGACY_ROWS[0];
    // Identity carried, not invented: a partner_id row WAS a partner subject.
    expect(live.subject_kind).toBe("partner");
    expect(live.subject_id).toBe(src.partner_id);
    expect(live.cycle).toBe(src.cadence);
    expect(live.current_period_start).toBe(src.period_start);
    expect(live.current_period_end).toBe(src.period_end);
    // Money, audit and supersession fields byte-for-byte.
    expect(live.amount_minor).toBe(src.amount_minor);
    expect(live.list_amount_minor).toBe(src.list_amount_minor);
    expect(live.discount_minor).toBe(src.discount_minor);
    expect(live.discount_code).toBe(src.discount_code);
    expect(live.currency).toBe(src.currency);
    expect(live.price_derivation).toBe(src.price_derivation);
    expect(live.payment_intent_id).toBe(src.payment_intent_id);
    expect(live.status).toBe(src.status);
    expect(live.created_at).toBe(src.created_at);
    // The reshape is not a business event: updated_at is NOT rewritten.
    expect(live.updated_at).toBe(src.updated_at);
    expect(live.created_by).toBe(src.created_by);
    // Nothing is back-dated into a column the legacy row never had.
    expect(live.activated_at).toBeNull();

    const sup = rows.find((r: any) => r.id === "psub_legacy_superseded")!;
    expect(sup.status).toBe("superseded"); // a Wave-5-only status must remain legal
    expect(sup.grandfathered_from).toBe("psub_ancient");
    expect(sup.superseded_by).toBe("psub_legacy_live");
    expect(sup.superseded_reason).toBe(LEGACY_ROWS[1].superseded_reason);
    expect(sup.subject_id).toBe("prt_beta");
  });

  it("2. reaches the SAME canonical shape starting from the 0167 (Wave 11) table", () => {
    const db = new Database(":memory:");
    db.exec(readMigration("0167_wave11_partner_subscription_engine.sql"));
    expect(partnerSubscriptionShape(db)).toBe("canonical");
    db.prepare(
      `INSERT INTO partner_subscription
         (id, subject_kind, subject_id, tier_slug, cycle, amount_minor, currency,
          discount_minor, status, created_at, updated_at)
       VALUES ('psub_w11','founder','fnd_1','founder_pro','monthly',4900,'USD',0,'active',
               '2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`,
    ).run();

    applyShapeMigration(db);

    expect(partnerSubscriptionShape(db)).toBe("canonical");
    const row = db.prepare("SELECT * FROM partner_subscription WHERE id='psub_w11'").get();
    // A non-partner subject survives untouched — that is the whole point of EN-8.
    expect(row.subject_kind).toBe("founder");
    expect(row.subject_id).toBe("fnd_1");
    expect(row.cycle).toBe("monthly");
    expect(row.amount_minor).toBe(4900);
    // The three Wave 5 money columns 0167 lacked are now present.
    expect(Object.keys(row)).toContain("grandfathered_from");
    expect(Object.keys(row)).toContain("superseded_by");
    expect(Object.keys(row)).toContain("superseded_reason");
  });

  it("3. is idempotent: applying it again changes no row and no column", () => {
    const db = new Database(":memory:");
    seedLegacy(db);
    applyShapeMigration(db);
    const cols1 = partnerSubscriptionColumns(db);
    const rows1 = db.prepare("SELECT * FROM partner_subscription ORDER BY id").all();

    applyShapeMigration(db);
    applyShapeMigration(db);

    expect(partnerSubscriptionColumns(db)).toEqual(cols1);
    expect(db.prepare("SELECT * FROM partner_subscription ORDER BY id").all()).toEqual(rows1);
    // The scratch table used by the rebuild never survives.
    const scratch = db
      .prepare("SELECT name FROM sqlite_master WHERE name='partner_subscription_w13_new'")
      .get();
    expect(scratch).toBeUndefined();
  });

  it("4. creates the canonical table outright when it is absent", () => {
    const db = new Database(":memory:");
    expect(partnerSubscriptionShape(db)).toBe("absent");
    applyShapeMigration(db);
    expect(partnerSubscriptionShape(db)).toBe("canonical");
    expect(partnerSubscriptionColumns(db).sort()).toEqual([...W13_CANONICAL_COLUMNS].sort());
  });

  it("5. A-22: BOTH self-heal installers leave the CANONICAL shape (not the Wave 5 one)", () => {
    // applyWave5MoneySchema used to create the legacy shape here. This is the
    // regression that a migration-only fix would not have caught.
    const db5 = new Database(":memory:");
    const res5 = applyWave5MoneySchema(db5);
    expect(res5.tablesMissing).not.toContain("partner_subscription");
    expect(partnerSubscriptionShape(db5)).toBe("canonical");
    for (const legacy of W13_LEGACY_ONLY_COLUMNS) {
      expect(partnerSubscriptionColumns(db5)).not.toContain(legacy);
    }

    const db11 = new Database(":memory:");
    applyWave11SubscriptionSchema(db11);
    expect(partnerSubscriptionShape(db11)).toBe("canonical");
    expect(partnerSubscriptionColumns(db11).sort()).toEqual([...W13_CANONICAL_COLUMNS].sort());
    // 0168 still lands too — it used to be unreachable in a strict chain apply
    // because 0167 aborted before it.
    expect(
      db11.prepare("SELECT name FROM sqlite_master WHERE name='esign_envelope'").get(),
    ).toBeTruthy();
  });

  it("6. partnerBillingStore writes and reads the canonical columns end to end", () => {
    getDb();
    const h = rawDb() as any;
    ensureWave5MoneySchema(h);
    expect(partnerSubscriptionShape(h)).toBe("canonical");

    const partnerId = `prt_w13_${Date.now()}`;
    setTierPrice("w13_tier", "annual", 120_000, "USD", "tier_price_row", "wave13 test", "test");
    const quote = quotePartnerSubscription({
      partnerId,
      tierSlug: "w13_tier",
      cycle: "annual",
      monthlyAmountMinor: 10_000,
      currency: "USD",
    });
    const created = createSubscription({
      partnerId,
      tierSlug: "w13_tier",
      cadence: "annual",
      quote,
      periodStart: "2026-03-01T00:00:00Z",
      periodEnd: "2027-03-01T00:00:00Z",
      paymentIntentId: `int_w13_${Date.now()}`,
      createdBy: "test:wave13",
    });
    expect(created.partnerId).toBe(partnerId);
    expect(created.cadence).toBe("annual");
    expect(created.periodStart).toBe("2026-03-01T00:00:00Z");

    // The row really is subject-keyed in the database, not partner_id-keyed.
    const raw = h.prepare("SELECT * FROM partner_subscription WHERE id = ?").get(created.id);
    expect(raw.subject_kind).toBe("partner");
    expect(raw.subject_id).toBe(partnerId);
    expect(raw.cycle).toBe("annual");
    expect(raw.current_period_end).toBe("2027-03-01T00:00:00Z");

    const live = getLiveSubscription(partnerId);
    expect(live?.id).toBe(created.id);
    expect(listSubscriptions(partnerId).map((s) => s.id)).toContain(created.id);
  });

  it("7. migration 0169 is byte-identical in both migration trees", () => {
    const a = fs.readFileSync(path.join(ROOT, "migrations", W13_SHAPE_MIGRATION));
    const b = fs.readFileSync(
      path.join(ROOT, "server", "db", "migrations", W13_SHAPE_MIGRATION),
    );
    expect(a.equals(b)).toBe(true);
  });
});
