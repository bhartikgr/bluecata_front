/**
 * WAVE 225 · ITEM A — THE PROOF THE ADVERSARIAL PASS FORCED ME TO WRITE.
 *
 * ── HOW THIS FILE CAME TO EXIST (recorded because it matters) ─────────────────
 * Disarm D5 of `build_log/wave225/w225_disarm.py` reverts the gate in
 * `viewComps()` by iterating the raw `PUBLIC_MARKET_COMPS` instead of the
 * provenance-filtered `emitted`. That is the single most direct way to put the
 * nine fabricated transactions back in front of an investor.
 *
 * On its first run, D5 came back **GREEN** against
 * `w225_comp_provenance_http.test.ts`. The fix was fine; MY PROOF WAS NOT.
 *
 * The reason is `viewComps()`'s SECOND filter, at
 * `server/collectiveMaIntelStore.ts:417`:
 *
 *     if (!sectorsPresent.has(comp.sector)) continue;
 *
 * `sectorsPresent` is built from the CALLER'S SCOPE — the companies with stored
 * M&A data that this investor may see. In the HTTP fixture that scope is empty,
 * so all nine rows were dropped by the SECTOR filter and never reached the
 * provenance gate at all. The HTTP test was asserting an empty array that would
 * have been empty either way: green for the wrong reason, and blind to exactly
 * the regression it was written to catch. In production, where opted-in companies
 * DO exist in fintech, biotech and the rest, D5 would have leaked all nine.
 *
 * This is the failure mode the brief warns about — a test that proves nothing is
 * worse than a test that fails — so the fix is a proof that drives the scope
 * pole where the sector filter cannot mask the answer.
 *
 * ── WHAT THIS FILE DOES ──────────────────────────────────────────────────────
 * It calls the REAL exported `viewComps()` (handbook §8 — no replica, no
 * reimplementation of the filter) with a scope that covers EVERY ONE of the nine
 * sectors those fabricated rows carry, and with `shareWithCollective: true` so
 * the attribution path is exercised too. Under this scope the sector filter
 * admits all nine, and the ONLY thing standing between them and the investor is
 * the provenance gate. Then it asserts nothing comes out.
 *
 * The HTTP test remains valuable and is not replaced: it proves the real route,
 * the real middleware, the real serialisation and byte-for-byte determinism.
 * This file proves the gate is load-bearing when the scope is not empty.
 *
 * Ruling R193.2.
 */
import { describe, it, expect } from "vitest";

import { viewComps } from "../collectiveMaIntelStore";
import { PUBLIC_MARKET_COMPS } from "../lib/maPublicComps";

/** The nine sectors, read from the data rather than retyped, so this cannot drift. */
const ALL_COMP_SECTORS = Array.from(new Set(PUBLIC_MARKET_COMPS.map((c) => c.sector)));

/**
 * A scope entry per sector. Shaped to `ScopedCompany`, which the store does not
 * export, so the cast is at the call site and nowhere else. Nothing about the
 * production filter is reimplemented here — only its INPUT is supplied.
 */
function scopeCovering(sectors: string[]) {
  return sectors.map((sector, i) => ({
    companyId: `co_w225_scope_${i}`,
    name: `W225 Scope Co ${i}`,
    sector,
    privacy: {
      shareWithCollective: true,
      shareAcquirerInterest: true,
      shareValuationRange: true,
      shareStrategicNarrative: true,
    },
    chapter: null,
    access: "FULL",
    intel: {},
  })) as unknown as Parameters<typeof viewComps>[0];
}

describe("W225 · Item A — the provenance gate holds when the SECTOR filter cannot mask it", () => {
  it("covers every sector the nine fabricated rows carry (the premise of this file)", () => {
    // If a future wave adds a sector to the library, this keeps the scope honest.
    expect(ALL_COMP_SECTORS.length).toBeGreaterThanOrEqual(6);
    for (const c of PUBLIC_MARKET_COMPS) {
      expect(ALL_COMP_SECTORS).toContain(c.sector);
    }
  });

  it("emits ZERO exits even though the sector filter admits all nine", () => {
    const res = viewComps(scopeCovering(ALL_COMP_SECTORS), {});
    expect(res.exits).toEqual([]);
    expect(res.totalRecords).toBe(0);
  });

  it("leaks none of the nine targets or acquirers", () => {
    const res = viewComps(scopeCovering(ALL_COMP_SECTORS), {});
    const body = JSON.stringify(res);
    for (const c of PUBLIC_MARKET_COMPS) {
      expect(body, `target "${c.target}" reached the caller`).not.toContain(c.target);
      expect(body, `acquirer "${c.acquirer}" reached the caller`).not.toContain(c.acquirer);
    }
  });

  it("leaks none of the nine valuations or revenue multiples", () => {
    const res = viewComps(scopeCovering(ALL_COMP_SECTORS), {});
    const exitsRegion = JSON.stringify(res.exits);
    for (const c of PUBLIC_MARKET_COMPS) {
      expect(exitsRegion).not.toContain(String(c.valuationUsd));
      if (c.revenueMultiple != null) {
        expect(exitsRegion).not.toContain(String(c.revenueMultiple));
      }
    }
  });

  it("still reports the nine as HELD-and-withheld, not as absent", () => {
    const res = viewComps(scopeCovering(ALL_COMP_SECTORS), {});
    expect(res.compsProvenance.status).toBe("no_verified_comparable_transaction_data");
    expect(res.compsProvenance.verified).toBe(0);
    expect(res.compsProvenance.heldUnsourced).toBe(9);
  });

  it("is deterministic: two calls with the same scope are byte-identical", () => {
    const a = viewComps(scopeCovering(ALL_COMP_SECTORS), {});
    const b = viewComps(scopeCovering(ALL_COMP_SECTORS), {});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a single-sector scope also emits nothing (the gate is per-row, not per-scope)", () => {
    for (const sector of ALL_COMP_SECTORS) {
      const res = viewComps(scopeCovering([sector]), {});
      expect(res.exits, `sector ${sector} leaked`).toEqual([]);
    }
  });
});
