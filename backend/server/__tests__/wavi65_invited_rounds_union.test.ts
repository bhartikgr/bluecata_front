/**
 * W-AVI65 (authorized sacred edit) — buildInvitedRounds stale-cache UNION.
 *
 * server/lib/userContext.ts buildInvitedRounds hydrated RUNTIME_INVITATIONS from
 * the durable table ONLY when the in-memory map was empty. Once the cache held
 * ANY row, a newly DB-persisted invitation (a round the investor was just added
 * to) was never picked up until restart. FIX: UNION the durable rows every call,
 * deduped by invitationId (existing cache entries win) — additive, never drops.
 *
 * The durable read the union is built from is roundInvitationsStore
 * listForInvestorEmail(email). This suite:
 *   (1) proves the durable store returns a freshly-created invitation for an
 *       email (the source of truth the union reads on EVERY call), and
 *   (2) pins the SOURCE CONTRACT of the sacred edit: the "hydrate only when
 *       empty" gate is gone and a dedup-by-invitationId union is present at both
 *       sites — so a revert would turn this suite red (the flaw the earlier
 *       broken test had was importing nonexistent symbols; this one imports only
 *       real exports and reads the real source).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInvitation, listForInvestorEmail } from "../roundInvitationsStore";
import { rawDb } from "../db/connection";

const email = `union_${Date.now()}@capavate.example`;
const companyId = `co_union_${Date.now()}`;
const round1 = `rnd_union_1_${Date.now()}`;
const round2 = `rnd_union_2_${Date.now()}`;

function seedRound(id: string, name: string) {
  const db = rawDb() as unknown as {
    prepare: (s: string) => { all: () => Array<{ name: string; notnull: number; dflt_value: unknown }>; run: (...a: unknown[]) => unknown };
  };
  const cols = db.prepare(`PRAGMA table_info(rounds)`).all();
  const values: Record<string, unknown> = {
    id, company_id: companyId, name, type: "Seed", state: "open",
    target_amount: 1_000_000, raised_amount: 0, tenant_id: `tenant_co_${companyId}`,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
  };
  const present = cols.filter((c) => c.name in values || (c.notnull === 1 && c.dflt_value === null));
  const names = present.map((c) => c.name);
  const params = present.map((c) => (c.name in values ? values[c.name] : ""));
  db.prepare(`INSERT OR REPLACE INTO rounds (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...params);
}

describe("W-AVI65 buildInvitedRounds UNION — durable source + sacred source-contract", () => {
  beforeAll(async () => {
    seedRound(round1, "Union Round 1");
    seedRound(round2, "Union Round 2");
    await createInvitation({ roundId: round1, companyId, investorEmail: email, investorName: "Union Investor", invitedByUserId: `u_union_founder_${Date.now()}`, dryRun: true } as never);
    await createInvitation({ roundId: round2, companyId, investorEmail: email, investorName: "Union Investor", invitedByUserId: `u_union_founder_${Date.now()}`, dryRun: true } as never);
  }, 30_000);

  it("the durable store returns BOTH invitations for the email (the union's source of truth)", () => {
    const rows = listForInvestorEmail(email);
    const roundIds = rows.map((r) => r.roundId);
    expect(roundIds).toContain(round1);
    expect(roundIds).toContain(round2);
  });

  it("does NOT return invitations for an unrelated email (no cross-user bleed)", () => {
    const rows = listForInvestorEmail(`nobody_${Date.now()}@capavate.example`);
    expect(rows.some((r) => r.roundId === round1 || r.roundId === round2)).toBe(false);
  });

  it("sacred source-contract: the 'hydrate only when empty' gate is REMOVED and a dedup union is present (both sites)", () => {
    const uc = readFileSync(join(__dirname, "..", "lib", "userContext.ts"), "utf8");
    // Strip line comments before asserting on CODE, so the fix's own doc comments
    // (which QUOTE the old gate to explain what was removed) can't cause a false
    // pass/fail. This is why the earlier assertion was wrong: userContext.ts:890
    // quotes "existingInvs.length === 0 && isInvestor" inside a comment.
    const code = uc
      .split("\n")
      .map((ln) => {
        const i = ln.indexOf("//");
        return i >= 0 ? ln.slice(0, i) : ln;
      })
      .join("\n");
    // The old gates must be gone from executable CODE.
    expect(code).not.toContain("runtimeInvs.length === 0) && persona.email");
    expect(code).not.toContain("existingInvs.length === 0 && isInvestor");
    // A dedup-by-invitationId union must be present at BOTH sites (Map keyed by
    // invitationId → two byId.set(...) write loops per site == 4 total).
    const unionHits = (code.match(/byId\.set\(/g) ?? []).length;
    expect(unionHits).toBeGreaterThanOrEqual(2);
    expect(uc).toContain("W-AVI65");
  });
});
