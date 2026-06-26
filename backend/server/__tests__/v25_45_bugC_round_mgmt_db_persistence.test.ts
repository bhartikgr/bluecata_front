/**
 * v25.45 Bug C — Round Management DB-persistence regression suite.
 *
 * Ozan (founder QA wave) flagged: "some variables are NOT being stored in db,
 * which will have a very negative impact on the cap table. ... make certain that
 * everything is being stored in the db. No in-memory."
 *
 * The audit found THREE in-memory-only write paths in the Round Management
 * surface. Each test below writes through the production code path, simulates a
 * server restart by clearing the in-memory cache/Map, rehydrates from the DB,
 * and asserts the data survived. Before the fix every assertion below failed
 * (the data lived only in RAM and vanished on restart).
 *
 *   Fix 1 — PATCH /api/rounds/:id/terms term extras (valuationCap, discount,
 *           mfn, ...) round-trip through roundsStore.updateRound -> extras_json.
 *           These feed the cap table.
 *   Fix 2 — round-close frozen carry-forward chain-head snapshot
 *           (freezeRoundChainHead -> round_chain_head_freezes table).
 *   Fix 3 — legacy invitationStore tokens + redemption state
 *           (persistLegacyInvitation -> kv_legacyInvitationStore).
 *
 * NONE of these touch cap-table math or the captable_commits ledger — they fix
 * the round WRITE side only.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb } from "../db/connection";
import { rounds as roundsTable } from "../../shared/schema";
import { eq } from "drizzle-orm";
import {
  createRound,
  updateRound,
  getRoundById,
  hydrateRoundsStore,
  _testAccessRounds,
} from "../roundsStore";
import {
  freezeRoundChainHead,
  getFrozenRoundChainHead,
  hydrateRoundChainHeadFreezes,
  clearCarryForwardAuditLog,
} from "../roundCarryForwardRoutes";
import {
  persistLegacyInvitation,
  hydrateLegacyInvitations,
  type LegacyInvitationLike,
} from "../legacyInvitationStore";

describe("v25.45 Bug C — Round Management DB persistence", () => {
  const COMPANY_ID = "co_v2545_bugC_test";

  beforeAll(() => {
    const db = getDb();
    try {
      db.delete(roundsTable).where(eq(roundsTable.companyId, COMPANY_ID)).run();
    } catch {
      /* tolerated on first boot */
    }
    _testAccessRounds.reset();
  });

  /* ------------------------------------------------------------------ *
   * Fix 1 — round TERM extras must persist into extras_json (cap-table  *
   * feeding fields). Previously the terms PATCH did Object.assign on a  *
   * throwaway in-memory copy with no DB write.                          *
   * ------------------------------------------------------------------ */
  describe("Fix 1 — round term extras persist via updateRound -> extras_json", () => {
    it("updateRound writes whitelisted term extras to the DB and survives restart", async () => {
      const r = createRound({
        companyId: COMPANY_ID,
        name: "Bug C SAFE round",
        type: "safe",
        targetAmount: 2_000_000,
        actorUserId: "u_test_ozan",
      });

      // Patch a mix of core columns + long-tail TERM extras (the exact fields
      // the Edit-Terms dialog sends for a SAFE / convertible note).
      const res = updateRound(
        r.id,
        {
          targetAmount: 2_500_000, // core column
          valuationCap: 12_000_000, // extra -> extras_json
          discount: 20, // extra -> extras_json
          mfn: true, // boolean extra -> extras_json
          interestRate: 5, // extra -> extras_json
          maturityMonths: 24, // extra -> extras_json
        },
        { actor: "u_test_ozan" },
      );
      expect(res.ok).toBe(true);

      // Assert the raw DB row carries the extras in extras_json (not just RAM).
      const db = getDb();
      const row: any = db
        .select()
        .from(roundsTable)
        .where(eq(roundsTable.id, r.id))
        .get();
      expect(row).toBeTruthy();
      expect(Number(row.targetAmount ?? row.target_amount)).toBe(2_500_000);
      const extras = JSON.parse(row.extrasJson ?? row.extras_json ?? "{}");
      expect(extras.valuationCap).toBe(12_000_000);
      expect(extras.discount).toBe(20);
      expect(extras.mfn).toBe(true);
      expect(extras.interestRate).toBe(5);
      expect(extras.maturityMonths).toBe(24);

      // Simulate a server restart: wipe the cache and rehydrate from the DB.
      _testAccessRounds.reset();
      expect(getRoundById(r.id)).toBeFalsy();
      await hydrateRoundsStore();

      const rehydrated: any = getRoundById(r.id);
      expect(rehydrated).toBeTruthy();
      expect(rehydrated.targetAmount).toBe(2_500_000);
      // Extras are spread back onto the Round on read (rowToRound).
      expect(rehydrated.valuationCap).toBe(12_000_000);
      expect(rehydrated.discount).toBe(20);
      expect(rehydrated.mfn).toBe(true);
      expect(rehydrated.interestRate).toBe(5);
      expect(rehydrated.maturityMonths).toBe(24);
    });

    it("a later term edit merges (does not clobber) prior persisted extras", async () => {
      const r = createRound({
        companyId: COMPANY_ID,
        name: "Bug C merge round",
        type: "safe",
        targetAmount: 1_000_000,
        actorUserId: "u_test_ozan",
      });
      updateRound(r.id, { valuationCap: 8_000_000 }, { actor: "u_test_ozan" });
      // Second edit touches a DIFFERENT extra; the first must survive.
      updateRound(r.id, { discount: 15 }, { actor: "u_test_ozan" });

      _testAccessRounds.reset();
      await hydrateRoundsStore();
      const rehydrated: any = getRoundById(r.id);
      expect(rehydrated.valuationCap).toBe(8_000_000);
      expect(rehydrated.discount).toBe(15);
    });

    it("preserves the mass-assignment guard (unknown fields still rejected)", () => {
      const r = createRound({
        companyId: COMPANY_ID,
        name: "Bug C guard round",
        type: "seed",
        targetAmount: 500_000,
        actorUserId: "u_test_ozan",
      });
      const res = updateRound(
        r.id,
        { __proto__polluted: 1, sharesOutstanding: 999 } as Record<string, unknown>,
        { actor: "u_test_ozan" },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBe("UNKNOWN_FIELD");
    });
  });

  /* ------------------------------------------------------------------ *
   * Fix 2 — round-close frozen chain-head snapshot must persist.        *
   * Previously frozenRoundChainHead lived ONLY in a Map; a restart lost *
   * every closed round's audit baseline and a re-freeze could re-snap   *
   * against a different chain head.                                     *
   * ------------------------------------------------------------------ */
  describe("Fix 2 — frozen chain-head snapshot persists to round_chain_head_freezes", () => {
    const ROUND_ID = "rnd_bugC_freeze_test";
    const FREEZE_CO = "co_bugC_freeze";

    it("freezeRoundChainHead persists and survives a restart", () => {
      const head = freezeRoundChainHead(ROUND_ID, FREEZE_CO);
      expect(typeof head).toBe("string");
      // Wipe the in-memory Map (restart simulation) WITHOUT clearing the DB.
      clearCarryForwardAuditLog();
      // Cache miss must now read through to the DB.
      const afterRestart = getFrozenRoundChainHead(ROUND_ID);
      expect(afterRestart).toBe(head);
    });

    it("hydrateRoundChainHeadFreezes reloads snapshots from the DB", () => {
      clearCarryForwardAuditLog();
      const n = hydrateRoundChainHeadFreezes();
      expect(n).toBeGreaterThanOrEqual(1);
      expect(getFrozenRoundChainHead(ROUND_ID)).toBeTruthy();
    });

    it("re-freeze after restart is idempotent (never re-snapshots a different head)", () => {
      const original = getFrozenRoundChainHead(ROUND_ID);
      // Clear the Map so the guard can ONLY come from the durable DB row.
      clearCarryForwardAuditLog();
      // A second freeze must return the SAME head even though the in-memory
      // company chain head may now read as GENESIS (Map cleared).
      const second = freezeRoundChainHead(ROUND_ID, FREEZE_CO);
      expect(second).toBe(original);
    });
  });

  /* ------------------------------------------------------------------ *
   * Fix 3 — legacy invitationStore tokens + redemption state persist.   *
   * Previously invitationStore.push() and entry.redeemed mutations were *
   * in-memory only.                                                     *
   * ------------------------------------------------------------------ */
  describe("Fix 3 — legacy invitation tokens persist to kv_legacyInvitationStore", () => {
    function makeEntry(id: string, overrides: Partial<LegacyInvitationLike> = {}): LegacyInvitationLike {
      return {
        id,
        tokenHash: `hash_${id}`,
        roundId: "rnd_bugC_inv",
        companyId: COMPANY_ID,
        companyName: "Bug C Co",
        inviteeEmail: `${id}@example.com`,
        inviteeName: id,
        prefilledScreenName: null,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        redeemed: false,
        redeemedAt: null,
        revoked: false,
        ...overrides,
      };
    }

    it("a freshly-issued token persists and rehydrates into a fresh array", () => {
      const entry = makeEntry("inv_bugC_1");
      expect(persistLegacyInvitation(entry)).toBe(true);

      // Fresh array = a post-restart in-memory store with only seeds (none here).
      const fresh: LegacyInvitationLike[] = [];
      const n = hydrateLegacyInvitations(fresh);
      expect(n).toBeGreaterThanOrEqual(1);
      const found = fresh.find((e) => e.id === "inv_bugC_1");
      expect(found).toBeTruthy();
      expect(found?.tokenHash).toBe("hash_inv_bugC_1");
      expect(found?.redeemed).toBe(false);
    });

    it("a redemption-state mutation persists and survives a restart", () => {
      const entry = makeEntry("inv_bugC_2");
      persistLegacyInvitation(entry);
      // Redeem it (mirrors routes.ts entry.redeemed = true; persistLegacyInvitation).
      entry.redeemed = true;
      entry.redeemedAt = new Date().toISOString();
      expect(persistLegacyInvitation(entry)).toBe(true);

      const fresh: LegacyInvitationLike[] = [];
      hydrateLegacyInvitations(fresh);
      const found = fresh.find((e) => e.id === "inv_bugC_2");
      expect(found?.redeemed).toBe(true);
      expect(found?.redeemedAt).toBeTruthy();
    });

    it("hydrate re-applies persisted state onto an existing (seed) entry", () => {
      // Persist a redeemed copy of an id...
      const persisted = makeEntry("inv_bugC_seed", { redeemed: true, redeemedAt: new Date().toISOString() });
      persistLegacyInvitation(persisted);
      // ...and start with an UN-redeemed seed of the same id in the array.
      const seedArray: LegacyInvitationLike[] = [makeEntry("inv_bugC_seed", { redeemed: false })];
      hydrateLegacyInvitations(seedArray);
      const merged = seedArray.find((e) => e.id === "inv_bugC_seed");
      // Durable redeemed=true must win (no duplicate row appended either).
      expect(merged?.redeemed).toBe(true);
      expect(seedArray.filter((e) => e.id === "inv_bugC_seed").length).toBe(1);
    });
  });
});
