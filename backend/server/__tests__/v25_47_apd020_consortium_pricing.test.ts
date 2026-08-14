/**
 * v25.47 APD-020 — public Consortium Partner pricing.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. GET /api/consortium/pricing (PUBLIC, no auth) returns the canonical
 *      5-tier taxonomy in order with DB-resolved amounts.
 *   2. WAVE 46 / R21 — the surface is a PROJECTION OF DB STATE (see below).
 *   3. WAVE 51 / ITEM 2 — an admin amount edit is served PER-REQUEST from the
 *      row, including by a second, independently registered app. This test was
 *      called "Save→Restart→Load" and restored a hardcoded 49900; both the false
 *      name and the literal restore are fixed. See the block above it.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ WAVE 46 — WHY TEST 2 WAS REWRITTEN, AND WHY THAT IS NOT "RE-PINNING A     ║
 * ║ NUMBER TO MAKE A TEST PASS".                                             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * WHAT TEST 2 USED TO ASSERT, verbatim:
 *
 *     it("seeds canonical amounts and flags founding_member invite-only", …)
 *       expect(byslug.catalyst.amountMinor).toBe(49900);
 *       expect(byslug.builder.amountMinor).toBe(99900);
 *       expect(byslug.amplifier.amountMinor).toBe(149900);
 *       expect(byslug.nexus.amountMinor).toBe(499900);
 *       expect(byslug.founding_member.amountMinor).toBe(0);
 *
 * THE DISTINCTION THAT AUTHORISES THIS REWRITE. Re-pinning is what you do when a
 * test fails, you cannot explain why, and you edit the EXPECTATION until it
 * matches the OUTPUT. Nothing of that kind happened here:
 *
 *   • The OWNER OVERRULED THE EXPECTATION ITSELF. Ruling R21, verbatim: "This
 *     should be 100% dynamic. Nothing static or hard coded." A test that pins
 *     five amounts as "canonical" asserts the precise antipattern the ruling
 *     forbids: it makes a compiled-in ladder the definition of correct, so the
 *     suite would go RED the moment an admin legitimately changed a price — and
 *     GREEN on a build that ignored the database and hardcoded those five
 *     numbers. It tested the wrong property, and it would have to be deleted or
 *     rewritten even if it were passing.
 *   • The FIX IS NOT IN THE EXPECTATION. It is not "the number is 24000 now".
 *     Not one amount appears below. The rewritten test asserts a RELATIONSHIP —
 *     the response equals what the database holds, whatever it holds — and it
 *     proves that by MUTATING the database and requiring the surface to move
 *     with it, in both directions.
 *   • It is STRICTLY STRONGER. The old test passed for a build with the ladder
 *     compiled in. The new one CANNOT: it changes a row and demands the surface
 *     change, unprices every row and demands an explicit refusal, and asserts
 *     the refusal body contains none of the old literals — so a compiled-in
 *     fallback of any value fails it.
 *   • SCOPE. This authorisation covers THIS test only. No other pinned test was
 *     touched on this reasoning.
 *
 * NOTE ON TEST 1: the 5-slug order assertion is DELIBERATELY LEFT ALONE. Tier
 * IDENTITY and ORDER are code (`PARTNER_TIERS`), which R3 explicitly permits —
 * identity in code, price in data. Test 1 pins no money.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  upsertTier,
  CONSORTIUM_SUBSCRIPTION_PREFIX,
} from "../subscriptionTierStore";
/* WAVE 46 / R21 — the test reads and mutates THE SAME rows the surface reads,
 * so "the surface reflects DB state" is measured, not assumed. */
import { wave45Db } from "../lib/applyWave45PricingSchema";
/* WAVE 51 · ITEM 2 — exponent registry, for the mandatory JPY money fixture. */
import { currencyExponent } from "../lib/currency";

interface PriceRowSnapshot {
  id: string;
  tier_slug: string;
  cadence: string;
  price_minor: number | null;
  currency: string;
  derivation: string;
  active: number;
}

/** Every annual price row, exactly as stored. */
function readPriceRows(): PriceRowSnapshot[] {
  return wave45Db()
    .prepare(
      `SELECT id, tier_slug, cadence, price_minor, currency, derivation, active
         FROM partner_tier_price WHERE cadence = 'annual' ORDER BY tier_slug`,
    )
    .all() as PriceRowSnapshot[];
}

/** Restore a snapshot byte-for-byte, so no later test inherits our mutations. */
function restorePriceRows(rows: PriceRowSnapshot[]): void {
  const db = wave45Db();
  for (const r of rows) {
    db.prepare(
      `UPDATE partner_tier_price
          SET price_minor = ?, currency = ?, derivation = ?, active = ?,
              updated_at = ?, updated_by = ?
        WHERE id = ?`,
    ).run(r.price_minor, r.currency, r.derivation, r.active, new Date().toISOString(), "wave46:test-restore", r.id);
  }
}

function lifecycleState(slug: string): string {
  const row = wave45Db()
    .prepare(`SELECT state FROM partner_tier_lifecycle WHERE tier_slug = ?`)
    .get(slug) as { state?: string } | undefined;
  return row?.state ?? "";
}

function setLifecycleState(slug: string, state: string, reason: string | null): void {
  const now = new Date().toISOString();
  wave45Db()
    .prepare(
      `UPDATE partner_tier_lifecycle
          SET state = ?, state_reason = ?, state_changed_at = ?, state_changed_by = ?, updated_at = ?
        WHERE tier_slug = ?`,
    )
    .run(state, reason, now, "wave46:test", now, slug);
}

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(method: string, apiPath: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers: {} },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

describe("APD-020 public consortium pricing", () => {
  it("returns the canonical 5-tier taxonomy in order", async () => {
    const res = await call("GET", "/api/consortium/pricing");
    expect(res.status).toBe(200);
    const slugs = res.body.tiers.map((t: any) => t.slug);
    expect(slugs).toEqual([
      "catalyst",
      "builder",
      "amplifier",
      "nexus",
      "founding_member",
    ]);
  });

  /* ─────────────────────────────────────────────────────────────────────────
   * WAVE 46 / R21 — THE SURFACE IS A PROJECTION OF DB STATE.
   * Not one amount is written into this test. See the file header for why the
   * previous literal-pinning version was overruled rather than "fixed".
   * ───────────────────────────────────────────────────────────────────────── */
  it("advertises exactly what the database holds — every amount, currency and period comes from a row", async () => {
    const rows = readPriceRows().filter((r) => r.price_minor !== null && r.active === 1);
    /* ADVERTISABLE, per the resolver's stated contract: priced AND active AND
     * carrying a KNOWN, non-archived lifecycle row. The lifecycle requirement is
     * not decoration — `resolveConsortiumPricing` fails closed on an unknown
     * lifecycle, and this suite proved why that matters: `partner_tier_price`
     * currently holds a priced annual row for the orphan slug `founder_free`,
     * which has NO `partner_tier_lifecycle` row (the lifecycle table's CHECK
     * admits only the five authoritative slugs) and is therefore CORRECTLY not
     * advertised. That orphan is Wave 45's open question OQ-W45-1, reproduced
     * here as data rather than asserted away. */
    const advertisable = rows.filter((r) => {
      const state = lifecycleState(r.tier_slug);
      return state === "active" || state === "frozen";
    });
    // Positive pole: something IS advertised. A pricing surface that refuses
    // everything would pass a one-sided "no hardcoding" test while stopping all
    // revenue, so the happy path is asserted first and explicitly.
    expect(advertisable.length).toBeGreaterThan(0);

    const res = await call("GET", "/api/consortium/pricing");
    expect(res.status).toBe(200);
    const byslug = Object.fromEntries(res.body.tiers.map((t: any) => [t.slug, t]));

    // Set equality both ways: nothing invented, nothing dropped.
    expect(Object.keys(byslug).sort()).toEqual(advertisable.map((r) => r.tier_slug).sort());

    for (const r of advertisable) {
      const t = byslug[r.tier_slug];
      expect(t, `tier ${r.tier_slug} missing from the surface`).toBeTruthy();
      // The amount is the ROW's amount — compared against the DB, never a literal.
      expect(t.amountMinor).toBe(r.price_minor);
      expect(t.currency).toBe(r.currency);
      expect(t.billingPeriod).toBe(r.cadence);
      expect(t.fromDb).toBe(true);
      expect(t.lifecycleState).toBe(lifecycleState(r.tier_slug));
      // Integer minor units end to end — no float, no /100 anywhere in between.
      expect(Number.isInteger(t.amountMinor)).toBe(true);
    }

    // IDENTITY (permitted in code by R3) is still asserted: invite-only is a
    // property of the tier, not a price, and must not be inferred from an amount.
    expect(byslug.founding_member.inviteOnly).toBe(true);
    expect(byslug.catalyst.inviteOnly).toBe(false);
  });

  it("change a row → the surface changes; change it back → the surface changes back", async () => {
    const before = readPriceRows();
    const target = before.find((r) => r.tier_slug === "catalyst" && r.price_minor !== null);
    expect(target, "catalyst must have an annual price row to mutate").toBeTruthy();
    const original = target!.price_minor as number;
    /* The probe amount is DERIVED from the stored value, so this test contains
     * no price of its own and cannot be satisfied by any compiled-in number. */
    const probe = original + 3_701;
    try {
      wave45Db()
        .prepare(
          `UPDATE partner_tier_price SET price_minor = ?, derivation = 'admin_set', updated_at = ?, updated_by = ?
            WHERE id = ?`,
        )
        .run(probe, new Date().toISOString(), "wave46:test", target!.id);

      const res = await call("GET", "/api/consortium/pricing");
      const catalyst = res.body.tiers.find((t: any) => t.slug === "catalyst");
      expect(catalyst.amountMinor).toBe(probe);
      expect(catalyst.amountMinor).not.toBe(original);

      // Nothing else moved: a price edit is not a global rewrite.
      for (const r of before) {
        if (r.id === target!.id || r.price_minor === null) continue;
        const t = res.body.tiers.find((x: any) => x.slug === r.tier_slug);
        if (t) expect(t.amountMinor).toBe(r.price_minor);
      }
    } finally {
      restorePriceRows(before);
    }
    const after = await call("GET", "/api/consortium/pricing");
    const restored = after.body.tiers.find((t: any) => t.slug === "catalyst");
    expect(restored.amountMinor).toBe(original);
  });

  it("freeze a tier → still advertised but marked; archive it → removed; both with no code change", async () => {
    const originalState = lifecycleState("builder");
    try {
      setLifecycleState("builder", "frozen", "wave46 R21 proof — frozen tier stays visible, not purchasable");
      let res = await call("GET", "/api/consortium/pricing");
      let builder = res.body.tiers.find((t: any) => t.slug === "builder");
      expect(builder, "a FROZEN tier must remain visible").toBeTruthy();
      expect(builder.lifecycleState).toBe("frozen");

      setLifecycleState("builder", "archived", "wave46 R21 proof — archived tier leaves the advertised surface");
      res = await call("GET", "/api/consortium/pricing");
      builder = res.body.tiers.find((t: any) => t.slug === "builder");
      expect(builder, "an ARCHIVED tier must not be advertised").toBeUndefined();
      // …and the rest of the ladder is untouched: archiving one tier is not an outage.
      expect(res.body.tiers.length).toBeGreaterThan(0);
      expect(res.body.unpriced).toBeUndefined();
    } finally {
      setLifecycleState("builder", originalState, originalState === "active" ? null : "wave46 restore");
    }
    const res = await call("GET", "/api/consortium/pricing");
    expect(res.body.tiers.find((t: any) => t.slug === "builder")).toBeTruthy();
  });

  it("unprice every row → an EXPLICIT REFUSAL, never $0 and never a compiled-in ladder (R6/R21)", async () => {
    const before = readPriceRows();
    let body: any;
    try {
      wave45Db()
        .prepare(
          `UPDATE partner_tier_price SET price_minor = NULL, derivation = 'unpriced', updated_at = ?, updated_by = ?
            WHERE cadence = 'annual'`,
        )
        .run(new Date().toISOString(), "wave46:test");
      const res = await call("GET", "/api/consortium/pricing");
      body = res.body;
      expect(res.status).toBe(200);
      expect(body.tiers).toEqual([]);
      // R6 — the absence is STATED, not implied by an empty array.
      expect(body.unpriced).toBe(true);
      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);
    } finally {
      restorePriceRows(before);
    }

    /* THE ANTI-FALLBACK ASSERTION. With every row unpriced, the response must
     * not contain ANY amount — so no compiled-in ladder, no $0 tier, and no
     * "safe default" of any value can satisfy this. The five literals the
     * overruled version of this test pinned are named here ONLY as forbidden
     * outputs, which is the exact inverse of pinning them as expected ones. */
    const serialized = JSON.stringify(body);
    for (const forbidden of ["49900", "99900", "149900", "499900", "24000"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(body.tiers).toHaveLength(0);

    // Restored: the positive pole again, so this test cannot leave the surface dark.
    const res = await call("GET", "/api/consortium/pricing");
    expect(res.body.tiers.length).toBeGreaterThan(0);
    expect(res.body.unpriced).toBeUndefined();
  });

  /* ═══════════════════════════════════════════════════════════════════════════
   * WAVE 51 · ITEM 2 — THIS TEST WAS RENAMED, BECAUSE ITS NAME WAS FALSE.
   *
   * IT USED TO BE CALLED, verbatim:
   *     it("Save→Restart→Load: admin amount edit persists to the route", …)
   * and its body was:
   *     upsertTier({ …, amountMinor: 54900, … });
   *     expect(catalyst.amountMinor).toBe(54900);
   *     upsertTier({ …, amountMinor: 49900, … });   // "Restore canonical seed."
   *
   * TWO INDEPENDENT DEFECTS:
   *   (a) NOTHING RESTARTED. There is no process restart, no reconnect, no new
   *       database handle — one `upsertTier` and one GET against the SAME live
   *       app. "Save→Restart→Load" claimed durability across a restart and
   *       measured a write followed by a read. A regression that lost every
   *       value on restart would have passed it.
   *   (b) THE CLEANUP RESTORED A LITERAL, not the observed value. `49900` was
   *       hardcoded as "the canonical seed", so if the seed ever changed — as it
   *       did, to the flat annual row — this test would silently REWRITE the
   *       database to a stale price and hand the corruption to whichever test
   *       file ran next.
   *
   * OPTION CHOSEN: **RENAME to what it actually proves, and strengthen it.**
   * WHY NOT "make it genuinely restart": a real process restart CANNOT be
   * exercised here and would be a second lie. Under `NODE_ENV=test` the database
   * is `:memory:` (server/db/connection.ts — `path = ":memory:"` when
   * NODE_ENV === "test"), and `getDb()` memoises the handle. A "restart" would
   * either return the same memoised handle (proving nothing) or open a fresh
   * `:memory:` database that is EMPTY — so the pricing row would be absent and
   * the test would assert durability against a database that never held the
   * value. Cross-process durability belongs to a file-backed integration test,
   * not here, and pretending otherwise is exactly the defect being fixed.
   *
   * WHAT IT NOW PROVES INSTEAD — a real, smaller, honestly-named boundary: the
   * amount is not captured at route-registration time. A SECOND, independently
   * constructed Express app with its own `registerRoutes()` call serves the new
   * value too, so the price is read per-request from the row rather than closed
   * over when routes were mounted. That is the strongest durability boundary
   * this harness can actually cross, and the name says exactly that.
   *
   * AND: the original value is CAPTURED AND RESTORED AS OBSERVED. Not one
   * amount literal appears below; the probe is derived from the stored value.
   * ═══════════════════════════════════════════════════════════════════════════ */
  it("an admin amount edit is served per-request from the row, including by a freshly-registered second app (not captured at route-registration time)", async () => {
    /* OBSERVED ORIGINAL — the whole annual snapshot, so the restore is exact. */
    const before = readPriceRows();
    const target = before.find((r) => r.tier_slug === "catalyst" && r.price_minor !== null);
    expect(target, "catalyst must have an annual price row for this test to mean anything").toBeTruthy();
    const observedOriginal = target!.price_minor as number;

    /* Second app, built BEFORE the edit, so it cannot be accused of having been
     * constructed to see the new value. Its routes are registered while the row
     * still holds the ORIGINAL amount. */
    const app2 = express();
    app2.use(express.json());
    const server2 = http.createServer(app2);
    await registerRoutes(server2, app2);
    const port2 = await new Promise<number>((resolve) => {
      server2.listen(0, () => resolve((server2.address() as { port: number }).port));
    });
    const call2 = (apiPath: string): Promise<any> =>
      new Promise((resolve, reject) => {
        const r = http.request({ hostname: "127.0.0.1", port: port2, path: apiPath, method: "GET" }, (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            try { resolve(JSON.parse(buf)); } catch { resolve(null); }
          });
        });
        r.on("error", reject);
        r.end();
      });

    // Premise: both apps agree on the ORIGINAL value first. If they did not, the
    // post-edit agreement below would prove nothing.
    const pre1 = await call("GET", "/api/consortium/pricing");
    const pre2 = await call2("/api/consortium/pricing");
    expect(pre1.body.tiers.find((t: any) => t.slug === "catalyst").amountMinor).toBe(observedOriginal);
    expect(pre2.tiers.find((t: any) => t.slug === "catalyst").amountMinor).toBe(observedOriginal);

    /* The probe is DERIVED from the observed value — this test carries no price. */
    const probe = observedOriginal + 6_101;
    expect(probe).not.toBe(observedOriginal);

    try {
      // SAVE — through the real admin write path.
      upsertTier({
        prefix: CONSORTIUM_SUBSCRIPTION_PREFIX,
        slug: "catalyst",
        amountMinor: probe,
        updatedByUserId: "u_admin",
      });

      // The AUTHORITATIVE ROW moved. Asserted before any HTTP read, so a route
      // that merely echoed our input could not satisfy this.
      const rowAfter = readPriceRows().find((r) => r.id === target!.id)!;
      expect(rowAfter.price_minor).toBe(probe);

      // LOAD — the original app serves the row's value.
      const res1 = await call("GET", "/api/consortium/pricing");
      expect(res1.body.tiers.find((t: any) => t.slug === "catalyst").amountMinor).toBe(probe);

      // LOAD ACROSS THE BOUNDARY — the independently-registered app does too.
      const res2 = await call2("/api/consortium/pricing");
      const c2 = res2.tiers.find((t: any) => t.slug === "catalyst");
      expect(c2.amountMinor, "a second app registered BEFORE the edit must still serve the new row value").toBe(probe);
      expect(c2.amountMinor).not.toBe(observedOriginal);
      expect(c2.amountMinor).toBe(rowAfter.price_minor);

      /* MONEY — JPY fixture (exponent 0). Re-denominate the same row and require
       * the integer minor amount through BOTH apps unchanged: any /100 or *100
       * on the read path moves this number. */
      expect(currencyExponent("JPY")).toBe(0);
      const jpyMinor = probe + 3; // derived; ¥ has no sub-unit, minor === major
      wave45Db()
        .prepare(`UPDATE partner_tier_price SET price_minor = ?, currency = 'JPY', updated_at = ? WHERE id = ?`)
        .run(jpyMinor, new Date().toISOString(), target!.id);
      const jpy1 = (await call("GET", "/api/consortium/pricing")).body.tiers.find((t: any) => t.slug === "catalyst");
      const jpy2 = (await call2("/api/consortium/pricing")).tiers.find((t: any) => t.slug === "catalyst");
      for (const t of [jpy1, jpy2]) {
        expect(t.currency).toBe("JPY");
        expect(t.amountMinor).toBe(jpyMinor);
        expect(Number.isInteger(t.amountMinor)).toBe(true);
      }
    } finally {
      /* RESTORE THE OBSERVED VALUE — never a literal. */
      restorePriceRows(before);
      await new Promise<void>((resolve) => server2.close(() => resolve()));
    }

    const restoredRow = readPriceRows().find((r) => r.id === target!.id)!;
    expect(restoredRow.price_minor).toBe(observedOriginal);
    expect(restoredRow.currency).toBe(target!.currency);
    const restored = await call("GET", "/api/consortium/pricing");
    expect(restored.body.tiers.find((t: any) => t.slug === "catalyst").amountMinor).toBe(observedOriginal);
  }, 30_000);
});
