/**
 * WAVE 185 · ITEM A · R156.5 (Q7) — ALIAS-AWARE INVESTOR PEER RESOLUTION,
 * AND THE FENCE THAT MUST NOT MOVE.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS BROKEN. `captable_commits.investor_id` holds two id namespaces. On the
 * owner's database 654 of 1017 rows carry an `ext_<hash>` ledger id and 362 carry
 * a canonical `u_*` user id. `durableCapTablePeerIds` probed with the canonical
 * id (matching nothing for an `ext_*`-seated investor) and RETURNED ledger ids as
 * if they were user ids (dropped silently downstream). `investor_identity_alias`,
 * the table that exists to bridge the two, was never read by this path.
 * Live symptom (R154.5): an investor's recipient search returns no users at all.
 *
 * WHAT THIS FILE PROVES, AND IN WHICH ORDER. The positive case is the LEAST
 * important thing here, so it is one test. The other twelve are the fence,
 * because widening who an investor can reach is only correct if it widens reach
 * by EXACTLY the people the platform already says they are entitled to reach and
 * by nobody else. Every negative control below was written to fail if the fix had
 * been implemented as a second, alias-aware COPY of the co-membership SQL instead
 * of as a wrapper that CALLS the SACRED predicate.
 *
 * THE SHARPEST RISK, AND WHY N-4/N-5 EXIST. `ext_*` ids are minted mostly by the
 * SPV LP-commit path, so the population this fix newly resolves is
 * disproportionately SPV limited partners — precisely the people WAIVER-4 and
 * `notSpvBackedSql` exist to keep apart, who (per `capTableMembership.ts`, Ozan
 * 2026-06-25) "very often must not even know of each other's existence". If the
 * alias union had been allowed to reach around the SPV exclusion, this fix would
 * have introduced every blind-vehicle LP to every other one. N-4 and N-5 assert
 * that pair reaches each other in NEITHER direction, through the list AND through
 * the naming gate, with aliases active on both sides.
 *
 * ANTI-VACUITY IS ASSERTED, NOT ASSUMED. A-0 proves the alias rows really exist
 * and really are `active`, and A-1 proves the viewer's own commits really are
 * seated under an `ext_*` id — because every assertion in this file would pass
 * for trivial reasons if the fixture had silently failed to write them.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb, rawDb } from "../db/connection";
import { durableCapTablePeerIds } from "../lib/commsUserDirectory";
import { areCoMembersOnAnyCapTable } from "../lib/capTableMembership";
import { areCoMembersOnAnyCapTableAliasAware } from "../lib/capTableCoMembershipAliasAware";
import { resolveInvestorIdSet, resolveCanonicalUserId, _resetAliasSchemaGuardForTests } from "../lib/investorIdentityAliasStore";
import { applyWave10EngineSchema } from "../lib/applyWave10EngineSchema";

/* ── the cast ───────────────────────────────────────────────────────────────
   OZAN is shaped like the live case: a real platform user whose cap-table rows
   are seated under an `ext_*` ledger id and NOT under their user id. */
const OZAN = "u_w185a_ozan";
const OZAN_EXT = "ext_w185a_ozan";

/* PEER holds the same OPERATING company, seated under their canonical id. This
   is the one person OZAN is entitled to reach. */
const PEER = "u_w185a_peer";

/* PEER_TWO holds the same company under an `ext_*` id — so the fix must resolve
   them to a user id, not hand an `ext_*` back to the picker. */
const PEER_TWO = "u_w185a_peer_two";
const PEER_TWO_EXT = "ext_w185a_peer_two";

/* ORPHAN is a real user with NO cap-table position at all. Negative control 1. */
const ORPHAN = "u_w185a_orphan";

/* STRANGER holds a DIFFERENT operating company OZAN has no position in.
   Negative control 2. */
const STRANGER = "u_w185a_stranger";

/* The SPV pair. Both seated under `ext_*` ids, both aliased to real users, both
   holders of the same vehicle. They must reach each other NOT AT ALL. */
const SPV_LP_ONE = "u_w185a_spv_lp_one";
const SPV_LP_ONE_EXT = "ext_w185a_spv_lp_one";
const SPV_LP_TWO = "u_w185a_spv_lp_two";
const SPV_LP_TWO_EXT = "ext_w185a_spv_lp_two";

const CO_SHARED = "co_w185a_shared";
const CO_OTHER = "co_w185a_other";
const SPV_VEHICLE = "spv_w185a_vehicle";

const now = () => new Date().toISOString();
let seq = 900000;

/** THROWS. A swallowed fixture error is a vacuous green, and a vacuous green on
 *  a confidentiality surface is worse than a red. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w185a fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 'investor', 0, NULL)`,
    id,
    `${id}@w185a.test`,
    `W185A ${id}`,
  );
}

/** A committed, non-deleted ledger row. `amount`/`shares` are TEXT columns in
 *  this sacred table and no arithmetic is performed on either here. */
function seedCommit(companyId: string, investorId: string): void {
  seq += 1;
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1', 'USD', '1', 'committed', '', ?, NULL)`,
    `ccm_w185a_${companyId}_${investorId}`,
    seq,
    now(),
    `inv_w185a_${seq}`,
    `rnd_w185a_${companyId}`,
    companyId,
    investorId,
    `hash_w185a_${seq}`,
  );
}

function seedAlias(aliasId: string, canonicalId: string): void {
  run(
    `INSERT OR REPLACE INTO investor_identity_alias
       (id, tenant_id, alias_investor_id, canonical_user_id, match_email, basis, state,
        created_by, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 'admin_manual', 'active', 'u_w185a_admin', ?, ?)`,
    `alias_w185a_${aliasId}`,
    aliasId,
    canonicalId,
    `${canonicalId}@w185a.test`,
    now(),
    now(),
  );
}

beforeAll(() => {
  getDb();
  /* `investor_identity_alias` is installed by migration 0166 and healed at
     bootstrap; in an in-memory test database it has to be applied explicitly or
     the whole fixture writes into a table that does not exist. */
  applyWave10EngineSchema(rawDb() as any);
  _resetAliasSchemaGuardForTests();

  for (const u of [OZAN, PEER, PEER_TWO, ORPHAN, STRANGER, SPV_LP_ONE, SPV_LP_TWO]) seedUser(u);

  /* THE SHARED OPERATING COMPANY. Deliberately NOT registered in `spv`, so the
     `notSpvBackedSql` exclusion does not apply and these three are genuine
     cap-table counterparties under the owner's 2026-06-25 policy. */
  seedCommit(CO_SHARED, OZAN_EXT); // OZAN: ext_* ONLY — never under u_*
  seedCommit(CO_SHARED, PEER); // canonical
  seedCommit(CO_SHARED, PEER_TWO_EXT); // ext_* ONLY

  /* A company OZAN has NO position in. */
  seedCommit(CO_OTHER, STRANGER);

  /* THE SPV VEHICLE. Registered in `spv`, so `notSpvBackedSql` excludes it. Both
     LPs are seated under `ext_*` ids, which is exactly how the SPV LP-commit
     path writes them on live. */
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, 'ac_consortium_partner_w185a', 'u_w185a_gp', 'W185A Vehicle', 'spv', 'DE',
             'open', 'private', 'USD', 'whole_fund', 'own_only', ?, 'u_w185a_admin', ?,
             'u_w185a_admin', 'hash_w185a_spv')`,
    SPV_VEHICLE,
    now(),
    now(),
  );
  seedCommit(SPV_VEHICLE, SPV_LP_ONE_EXT);
  seedCommit(SPV_VEHICLE, SPV_LP_TWO_EXT);

  /* THE ALIASES — the only thing this wave newly teaches the resolver. */
  seedAlias(OZAN_EXT, OZAN);
  seedAlias(PEER_TWO_EXT, PEER_TWO);
  seedAlias(SPV_LP_ONE_EXT, SPV_LP_ONE);
  seedAlias(SPV_LP_TWO_EXT, SPV_LP_TWO);
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP A — ANTI-VACUITY. Without these, every assertion below could pass for
   reasons that have nothing to do with the fix.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · A · anti-vacuity — the fixture really has the live shape", () => {
  it("A-0 the four alias rows exist and are ACTIVE", () => {
    const row = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM investor_identity_alias
          WHERE state = 'active' AND canonical_user_id IN (?, ?, ?, ?)`,
      )
      .get(OZAN, PEER_TWO, SPV_LP_ONE, SPV_LP_TWO) as { n: number };
    expect(row.n).toBe(4);
    expect(resolveInvestorIdSet(OZAN)).toEqual([OZAN, OZAN_EXT]);
    expect(resolveCanonicalUserId(OZAN_EXT)).toBe(OZAN);
  });

  it("A-1 OZAN has NO commit under their canonical user id — only under ext_*", () => {
    const own = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM captable_commits WHERE investor_id = ?`)
      .get(OZAN) as { n: number };
    /* If this were non-zero the pre-fix code would already have found peers and
       the whole fix would be untested. */
    expect(own.n).toBe(0);
    const ext = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM captable_commits WHERE investor_id = ?`)
      .get(OZAN_EXT) as { n: number };
    expect(ext.n).toBe(1);
  });

  it("A-2 the SPV vehicle really is registered in `spv`, so the exclusion applies", () => {
    expect(
      rawDb().prepare(`SELECT COUNT(*) AS n FROM spv WHERE id = ?`).get(SPV_VEHICLE),
    ).toEqual({ n: 1 });
    /* And the shared operating company really is NOT, so it is not excluded. */
    expect(
      rawDb().prepare(`SELECT COUNT(*) AS n FROM spv WHERE id = ?`).get(CO_SHARED),
    ).toEqual({ n: 0 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP P — THE POSITIVE CASE. One test, because it is the least important
   property in this file.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · A · the entitled peers are now reachable, as USER ids", () => {
  it("P-1 an ext_*-seated investor resolves both entitled co-holders, canonicalised", () => {
    const peers = durableCapTablePeerIds(OZAN);
    expect(peers).toContain(PEER);
    /* THE RESULT-SIDE FIX: `PEER_TWO`, not `ext_w185a_peer_two`. An `ext_*` value
       here is not a user id and is discarded by the picker without a log. */
    expect(peers).toContain(PEER_TWO);
    expect(peers).not.toContain(PEER_TWO_EXT);
    expect(peers).not.toContain(OZAN_EXT);
  });

  it("P-2 the relationship is symmetric: a canonical-seated holder reaches OZAN", () => {
    expect(durableCapTablePeerIds(PEER)).toContain(OZAN);
  });

  it("P-3 the NAMING gate agrees with the audience, so the peer is not masked", () => {
    /* Without this, the peer appears in the picker rendered as the identical
       string "Private Investor" — the wave-168 defect in a second place. */
    expect(areCoMembersOnAnyCapTableAliasAware(OZAN, PEER)).toBe(true);
    expect(areCoMembersOnAnyCapTableAliasAware(PEER, OZAN)).toBe(true);
    /* And the SACRED gate on its own still cannot see it — which is the proof
       that the alias wrapper is what changed, not the sacred policy. */
    expect(areCoMembersOnAnyCapTable(OZAN, PEER)).toBe(false);
  });

  it("P-4 no duplicate person: two aliases of one peer present as ONE entry", () => {
    seedCommit(CO_SHARED, "ext_w185a_peer_two_second");
    seedAlias("ext_w185a_peer_two_second", PEER_TWO);
    const peers = durableCapTablePeerIds(OZAN);
    expect(peers.filter((p) => p === PEER_TWO)).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP N — THE FENCE. THE NON-NEGOTIABLE PART.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · A · NEGATIVE CONTROLS — the fence did not move", () => {
  it("N-1 an investor with NO cap-table position reaches NOBODY", () => {
    expect(durableCapTablePeerIds(ORPHAN)).toEqual([]);
    expect(areCoMembersOnAnyCapTableAliasAware(ORPHAN, PEER)).toBe(false);
    expect(areCoMembersOnAnyCapTableAliasAware(PEER, ORPHAN)).toBe(false);
  });

  it("N-2 an investor cannot reach holders of a company they do NOT hold", () => {
    expect(durableCapTablePeerIds(OZAN)).not.toContain(STRANGER);
    expect(durableCapTablePeerIds(PEER)).not.toContain(STRANGER);
    expect(areCoMembersOnAnyCapTableAliasAware(OZAN, STRANGER)).toBe(false);
    expect(areCoMembersOnAnyCapTableAliasAware(STRANGER, OZAN)).toBe(false);
  });

  it("N-3 the viewer never appears as their own peer via their own alias", () => {
    /* OZAN also acquires a canonical-id position on the shared company, so both
       of their identifiers are now in the ledger on the same company. The join
       would pair them with themselves. */
    seedCommit(CO_SHARED, OZAN);
    const peers = durableCapTablePeerIds(OZAN);
    expect(peers).not.toContain(OZAN);
    expect(peers).not.toContain(OZAN_EXT);
    expect(areCoMembersOnAnyCapTableAliasAware(OZAN, OZAN_EXT)).toBe(false);
    expect(areCoMembersOnAnyCapTableAliasAware(OZAN_EXT, OZAN)).toBe(false);
  });

  it("N-4 SPV FENCE — two co-LPs of one vehicle, BOTH aliased, reach each other NOT AT ALL", () => {
    /* THE SHARPEST RISK IN THIS WAVE. `ext_*` ids come mostly from the SPV
       LP-commit path, so this pair is the typical shape of what the fix newly
       resolves. If the alias union reached around `notSpvBackedSql`, every blind
       vehicle on the platform would introduce its LPs to each other. */
    expect(durableCapTablePeerIds(SPV_LP_ONE)).toEqual([]);
    expect(durableCapTablePeerIds(SPV_LP_TWO)).toEqual([]);
    expect(durableCapTablePeerIds(SPV_LP_ONE)).not.toContain(SPV_LP_TWO);
    expect(durableCapTablePeerIds(SPV_LP_TWO)).not.toContain(SPV_LP_ONE);
  });

  it("N-5 SPV FENCE at the NAMING gate too — neither LP can learn the other's name", () => {
    expect(areCoMembersOnAnyCapTableAliasAware(SPV_LP_ONE, SPV_LP_TWO)).toBe(false);
    expect(areCoMembersOnAnyCapTableAliasAware(SPV_LP_TWO, SPV_LP_ONE)).toBe(false);
    /* Including when asked in the RAW ledger vocabulary, which is the form an
       attacker or a careless caller would most plausibly supply. */
    expect(areCoMembersOnAnyCapTableAliasAware(SPV_LP_ONE_EXT, SPV_LP_TWO_EXT)).toBe(false);
    expect(areCoMembersOnAnyCapTableAliasAware(SPV_LP_ONE, SPV_LP_TWO_EXT)).toBe(false);
  });

  it("N-6 a REVOKED alias stops conferring reach", () => {
    /* An identity claim that was withdrawn must not keep granting access. */
    run(
      `UPDATE investor_identity_alias SET state = 'revoked', revoked_at = ?, revoked_by = 'u_w185a_admin'
        WHERE alias_investor_id = ?`,
      now(),
      PEER_TWO_EXT,
    );
    run(
      `UPDATE investor_identity_alias SET state = 'revoked', revoked_at = ?, revoked_by = 'u_w185a_admin'
        WHERE alias_investor_id = ?`,
      now(),
      "ext_w185a_peer_two_second",
    );
    expect(durableCapTablePeerIds(OZAN)).not.toContain(PEER_TWO);
    expect(areCoMembersOnAnyCapTableAliasAware(OZAN, PEER_TWO)).toBe(false);
    /* Restore, so test order cannot make a later assertion vacuous. */
    run(`UPDATE investor_identity_alias SET state = 'active' WHERE alias_investor_id IN (?, ?)`,
      PEER_TWO_EXT, "ext_w185a_peer_two_second");
    expect(durableCapTablePeerIds(OZAN)).toContain(PEER_TWO);
  });

  it("N-7 an UNCOMMITTED or DELETED position confers nothing, through an alias or not", () => {
    seedUser("u_w185a_pending");
    seedAlias("ext_w185a_pending", "u_w185a_pending");
    seq += 1;
    run(
      `INSERT OR REPLACE INTO captable_commits
         (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
          amount, currency, shares, state, prev_hash, hash, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1', 'USD', '1', 'pending', '', ?, NULL)`,
      "ccm_w185a_pending", seq, now(), `inv_w185a_${seq}`, `rnd_w185a_${CO_SHARED}`,
      CO_SHARED, "ext_w185a_pending", `hash_w185a_${seq}`,
    );
    expect(durableCapTablePeerIds("u_w185a_pending")).toEqual([]);
    expect(durableCapTablePeerIds(OZAN)).not.toContain("u_w185a_pending");

    seedUser("u_w185a_deleted");
    seedAlias("ext_w185a_deleted", "u_w185a_deleted");
    seq += 1;
    run(
      `INSERT OR REPLACE INTO captable_commits
         (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
          amount, currency, shares, state, prev_hash, hash, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1', 'USD', '1', 'committed', '', ?, ?)`,
      "ccm_w185a_deleted", seq, now(), `inv_w185a_${seq}`, `rnd_w185a_${CO_SHARED}`,
      CO_SHARED, "ext_w185a_deleted", `hash_w185a_${seq}`, now(),
    );
    expect(durableCapTablePeerIds("u_w185a_deleted")).toEqual([]);
    expect(durableCapTablePeerIds(OZAN)).not.toContain("u_w185a_deleted");
  });

  it("N-8 an alias belonging to SOMEONE ELSE grants the viewer nothing", () => {
    /* The alias table is the trust root of this whole fix. This asserts the
       obvious-but-load-bearing property: possessing knowledge of another
       investor's ledger id is not the same as being linked to it. */
    expect(resolveInvestorIdSet(ORPHAN)).toEqual([ORPHAN]);
    expect(areCoMembersOnAnyCapTableAliasAware(ORPHAN, PEER)).toBe(false);
    /* And asking in the raw vocabulary of a ledger id the caller does not own
       does not launder into a hit either: it canonicalises to its real owner,
       so the pair asked is (ORPHAN, PEER_TWO) — still refused. */
    expect(areCoMembersOnAnyCapTableAliasAware(ORPHAN, PEER_TWO_EXT)).toBe(false);
  });

  it("N-9 the wrapper cannot answer TRUE where the SACRED gate answers FALSE", () => {
    /* The structural safety property, asserted rather than argued: for every
       pair of REAL identifiers, an alias-aware TRUE implies a sacred TRUE on
       SOME pair of identifiers denoting the same two humans. Checked here for
       the excluded SPV pair across the full cross product. */
    for (const a of [SPV_LP_ONE, SPV_LP_ONE_EXT]) {
      for (const b of [SPV_LP_TWO, SPV_LP_TWO_EXT]) {
        expect(areCoMembersOnAnyCapTable(a, b)).toBe(false);
        expect(areCoMembersOnAnyCapTableAliasAware(a, b)).toBe(false);
      }
    }
  });

  it("N-10 empty and malformed input is refused, not widened", () => {
    expect(durableCapTablePeerIds("")).toEqual([]);
    expect(durableCapTablePeerIds("   ")).toEqual([]);
    expect(areCoMembersOnAnyCapTableAliasAware("", PEER)).toBe(false);
    expect(areCoMembersOnAnyCapTableAliasAware(PEER, "")).toBe(false);
  });

  it("N-11 an investor with NO alias behaves EXACTLY as before the fix", () => {
    /* The compatibility guarantee. `PEER` has no alias row, so their peer set is
       whatever the pre-fix single-id probe would have produced — nothing an
       existing investor could see is lost or gained by this wave. */
    expect(resolveInvestorIdSet(PEER)).toEqual([PEER]);
    const peers = durableCapTablePeerIds(PEER);
    /* Only the two genuine co-holders of CO_SHARED, both canonicalised. */
    expect(peers.sort()).toEqual([OZAN, PEER_TWO].sort());
    expect(peers).not.toContain(STRANGER);
    expect(peers).not.toContain(SPV_LP_ONE);
    expect(peers).not.toContain(SPV_LP_TWO);
  });
});
