/* ════════════════════════════════════════════════════════════════════════════
   WAVE 142 (BATCH 1 · ITEM 2, data half — scope set by R108.3)
   THE RESOLVER STOPS FABRICATING A PRICE.        R108.2 · R95 · R104
   ════════════════════════════════════════════════════════════════════════════
   THE DEFECT. `getApplicationFeeMinor()` answered a MISSING config row — and a
   THROWN read — with `DEFAULT_APPLICATION_FEE_MINOR` (30000) and
   `source: "default"`. A founder could not tell a fee that is on record from one
   that is not, and R95 requires a price that is not on record to be REFUSED AND
   SAID rather than substituted, even by its own correct number. It was harmless
   in VALUE only because 30000 happened to be right; the same code answered a
   dropped, renamed or corrupted table with the same confident figure.

   This file drives the resolver against a STUBBED database handle so all three
   states are reachable without touching a real database file: row present, row
   absent, read throws. `db/connection` is the only dependency the resolver has.

   The routes, the real SQLite rows and the founder/admin surfaces are covered in
   wave142_fee_absence_routes.test.ts (real HTTP) and the two client render files.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeEach, vi } from "vitest";

/* One mutable stub for `rawDb().prepare(sql).get()`. */
type Mode = { kind: "row"; row: unknown } | { kind: "norow" } | { kind: "throw"; err: Error };
let mode: Mode = { kind: "norow" };
const sqlSeen: string[] = [];

vi.mock("../db/connection", () => ({
  rawDb: () => ({
    prepare: (sql: string) => {
      sqlSeen.push(sql);
      return {
        get: () => {
          if (mode.kind === "throw") throw mode.err;
          if (mode.kind === "norow") return undefined;
          return mode.row;
        },
        run: () => ({ changes: 1 }),
      };
    },
  }),
  getDb: () => ({}),
}));

import {
  getApplicationFeeMinor,
  getApplicationFeeConfig,
  DEFAULT_APPLICATION_FEE_MINOR,
} from "../lib/collectiveApplicationFeeResolver";

beforeEach(() => {
  sqlSeen.length = 0;
  mode = { kind: "norow" };
});

describe("WAVE 142 · A — getApplicationFeeMinor: the three honest states", () => {
  it("A1 POLE — a PRESENT row is still returned unchanged, with source 'db'", () => {
    /* Anti-over-correction: a published fee must keep working, in the stored
       integer, in true minor units, with no scaling. */
    mode = { kind: "row", row: { amount_minor: 30000, currency: "USD" } };
    const r = getApplicationFeeMinor("USD");
    expect(r.amountMinor).toBe(30000);
    expect(r.currency).toBe("USD");
    expect(r.source).toBe("db");
    /* The row's own currency wins over the requested one (existing contract). */
    mode = { kind: "row", row: { amount_minor: 250000, currency: "JPY" } };
    expect(getApplicationFeeMinor("USD")).toEqual({
      amountMinor: 250000,
      currency: "JPY",
      source: "db",
    });
  });

  it("A2 THE REPRODUCTION — an ABSENT row reports absence and NEVER 30000", () => {
    mode = { kind: "norow" };
    const r = getApplicationFeeMinor("USD");
    expect(r.source).toBe("missing");
    expect(r.amountMinor).toBeNull();
    expect(r.currency).toBeNull();
    /* The fabricated figure, named explicitly so this cannot pass by accident. */
    expect(r.amountMinor).not.toBe(DEFAULT_APPLICATION_FEE_MINOR);
    expect(r.amountMinor).not.toBe(30000);
    /* And the retired status string is gone from the contract. */
    expect(r.source).not.toBe("default");
  });

  it("A3 a THROWN read is reported as 'unreadable' — a distinct state, still amount-free", () => {
    /* The old bare `catch {}` could not tell a transient lock from a dropped
       table, and answered both with a price. These need different operator
       responses: publish a fee vs repair a database. */
    mode = { kind: "throw", err: new Error("no such table: collective_application_fee_config") };
    const r = getApplicationFeeMinor("USD");
    expect(r.source).toBe("unreadable");
    expect(r.amountMinor).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.amountMinor).not.toBe(30000);
  });

  it("A4 a row with a NON-NUMERIC amount is absence, not a coerced number", () => {
    /* SQLite typing is dynamic. A corrupted row must not become a fee, and it
       must not be parsed: no Number(), no parseInt, no parseFloat on money. */
    mode = { kind: "row", row: { amount_minor: "30000", currency: "USD" } };
    const r = getApplicationFeeMinor("USD");
    expect(r.source).toBe("missing");
    expect(r.amountMinor).toBeNull();
  });

  it("A5 R104 CROSS-PRODUCT POLE — no read state ever yields 24000", () => {
    /* 24000 is the CONSORTIUM PARTNER ANNUAL fee (migration 0185,
       partner_tier_prices). It leaked onto this Collective surface once. No
       absence, failure or empty state here may reintroduce it, and there is no
       shared row, key or fallback that could. */
    for (const m of [
      { kind: "norow" } as Mode,
      { kind: "throw", err: new Error("locked") } as Mode,
      { kind: "row", row: { amount_minor: null, currency: null } } as Mode,
    ]) {
      mode = m;
      const r = getApplicationFeeMinor("USD");
      expect(r.amountMinor).not.toBe(24000);
      expect(r.amountMinor).toBeNull();
    }
  });

  it("A6 the config table is still the source read — the two fee tables are NOT consolidated here", () => {
    /* R108.3 DEFERRED retiring either table to batch 2, and
       wave131_one_pricing_console.test.ts byte-pins the mirror call. This wave
       must not quietly repoint the read to platform_fees. */
    mode = { kind: "row", row: { amount_minor: 30000, currency: "USD" } };
    getApplicationFeeMinor("USD");
    expect(sqlSeen.join(" ")).toContain("collective_application_fee_config");
    expect(sqlSeen.join(" ")).not.toContain("platform_fees");
  });
});

describe("WAVE 142 · B — getApplicationFeeConfig: the admin sees the same truth", () => {
  it("B1 a present row keeps its provenance and source 'db'", () => {
    mode = {
      kind: "row",
      row: { amount_minor: 30000, currency: "USD", updated_at: "2026-08-15 19:25:39", updated_by: null },
    };
    const c = getApplicationFeeConfig();
    expect(c).toEqual({
      amountMinor: 30000,
      currency: "USD",
      updatedAt: "2026-08-15 19:25:39",
      updatedBy: null,
      source: "db",
    });
  });

  it("B2 an absent row is reported to the ADMIN as absent, not echoed back as configured", () => {
    /* This was the sneakier half: the admin editor asked for the config row and
       was handed the canonical 30000 with source 'default', so a console that
       looked correctly configured was reading a table with nothing in it. */
    mode = { kind: "norow" };
    const c = getApplicationFeeConfig();
    expect(c.source).toBe("missing");
    expect(c.amountMinor).toBeNull();
    expect(c.currency).toBeNull();
    expect(c.updatedBy).toBeNull();
    expect(c.amountMinor).not.toBe(DEFAULT_APPLICATION_FEE_MINOR);
  });

  it("B3 a thrown read is 'unreadable' for the admin too", () => {
    mode = { kind: "throw", err: new Error("disk I/O error") };
    const c = getApplicationFeeConfig();
    expect(c.source).toBe("unreadable");
    expect(c.amountMinor).toBeNull();
  });

  it("B4 the reference constant still exists and is still 30000 — it is just never returned", () => {
    /* R101 pins $300.00 = 30000. The constant stays as the ONE named reference
       for migrations, tests and the admin's "expected" display; what changed is
       that no read path hands it back as a resolved price. */
    expect(DEFAULT_APPLICATION_FEE_MINOR).toBe(30000);
  });
});
