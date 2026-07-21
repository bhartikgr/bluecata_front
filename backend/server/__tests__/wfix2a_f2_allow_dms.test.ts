/**
 * W-FIX2 F2 — "Allow direct messages" toggle persists + gates DM policy.
 *
 * Root cause: `allowDms` was absent from investorVisibilitySchema, so safeParse
 * stripped it on PATCH → 200 returned, field silently dropped, toggle reverted
 * on reload → founder↔investor DM permanently blocked.
 *
 * Covers: (1) schema no longer strips allowDms + defaults ON; (2) messagingPolicy
 * blocks an investor recipient who opted OUT (never silent); (3) reversible
 * backfill migration up/down.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  investorVisibilitySchema,
  investorPrivacyPatchSchema,
} from "../../client/src/lib/profile/types";
import { rawDb, getDb } from "../db/connection";
import { canDM, recipientAllowsDms } from "../messagingPolicy";
import { backfillAllowDms, revertAllowDmsBackfill } from "../lib/allowDmsBackfill";

describe("W-FIX2 F2 — schema", () => {
  it("investorVisibilitySchema keeps allowDms (was stripped) and defaults ON", () => {
    const parsed = investorVisibilitySchema.parse({
      visibleToCoMembers: false,
      visibleToCollectiveNetwork: false,
      screenNameSet: false,
    });
    // default(true) fills the absent key → no longer stripped
    expect(parsed.allowDms).toBe(true);
  });

  it("privacy PATCH schema no longer drops allowDms:false", () => {
    const parsed = investorPrivacyPatchSchema.parse({ allowDms: false });
    expect(parsed.allowDms).toBe(false);
  });

  it("privacy PATCH schema preserves allowDms:true", () => {
    const parsed = investorPrivacyPatchSchema.parse({ allowDms: true });
    expect(parsed.allowDms).toBe(true);
  });
});

describe("W-FIX2 F2 — DM policy gate + reversible migration", () => {
  beforeAll(() => { getDb(); });

  function seedProfile(investorId: string, allowDms: boolean | undefined) {
    const vis: any = {
      visibleToCoMembers: true,
      visibleToCollectiveNetwork: false,
      screenNameSet: false,
    };
    if (allowDms !== undefined) vis.allowDms = allowDms;
    const profile = { id: investorId, visibility: vis };
    rawDb()
      .prepare(
        `INSERT INTO profilestore_investor_profile (investor_id, profile_json, updated_at, deleted_at)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(investor_id) DO UPDATE SET profile_json = excluded.profile_json`,
      )
      .run(investorId, JSON.stringify(profile), new Date().toISOString());
  }

  function seedCapTableInvestor(investorId: string) {
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO captable_commits
           (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
            amount, currency, shares, state, prev_hash, hash)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `ccm_${investorId}`, "tenant_co_f2", 1, new Date().toISOString(),
        `inv_${investorId}`, "rnd_f2", "co_f2", investorId,
        "100000", "USD", "1000", "committed", "GENESIS", `hash_${investorId}`,
      );
  }

  it("recipientAllowsDms defaults ON when no profile / no field", () => {
    expect(recipientAllowsDms("u_f2_missing")).toBe(true);
    seedProfile("u_f2_nofield", undefined);
    expect(recipientAllowsDms("u_f2_nofield")).toBe(true);
  });

  it("recipientAllowsDms returns false only on explicit opt-out", () => {
    seedProfile("u_f2_off", false);
    expect(recipientAllowsDms("u_f2_off")).toBe(false);
    seedProfile("u_f2_on", true);
    expect(recipientAllowsDms("u_f2_on")).toBe(true);
  });

  it("canDM blocks with a clear reason when the investor recipient opted out", () => {
    // sender founder, recipient investor with allowDms=false
    const db: any = rawDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO auth_users (id, email, password_hash, role, created_at) VALUES (?,?,?,?,?)`).run("u_f2_founder", "f2founder@x.co", "x", "founder", now);
    db.prepare(`INSERT OR IGNORE INTO auth_users (id, email, password_hash, role, created_at) VALUES (?,?,?,?,?)`).run("u_f2_off", "f2off@x.co", "x", "investor", now);
    const res = canDM("u_f2_founder", "u_f2_off");
    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("recipient_dms_off");
  });

  it("reversible backfill sets allowDms=true on cap-table investors, down-migration removes it", () => {
    seedCapTableInvestor("u_f2_backfill");
    seedProfile("u_f2_backfill", undefined); // no allowDms key yet
    const up = backfillAllowDms();
    const entry = up.changed.find((c) => c.investorId === "u_f2_backfill");
    expect(entry).toBeTruthy();
    expect(entry!.before).toBeUndefined();
    expect(entry!.after).toBe(true);
    expect(recipientAllowsDms("u_f2_backfill")).toBe(true);

    const reverted = revertAllowDmsBackfill(up.changed);
    expect(reverted).toBeGreaterThanOrEqual(1);
    // key removed → reader default ON again, but the stored blob no longer has it
    const row = rawDb()
      .prepare(`SELECT profile_json FROM profilestore_investor_profile WHERE investor_id = ?`)
      .get("u_f2_backfill") as { profile_json: string };
    expect("allowDms" in JSON.parse(row.profile_json).visibility).toBe(false);
  });

  it("backfill respects an explicit prior choice (does not overwrite false)", () => {
    seedCapTableInvestor("u_f2_explicit");
    seedProfile("u_f2_explicit", false);
    const up = backfillAllowDms();
    expect(up.changed.find((c) => c.investorId === "u_f2_explicit")).toBeUndefined();
    expect(recipientAllowsDms("u_f2_explicit")).toBe(false);
  });
});
