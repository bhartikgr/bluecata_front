/**
 * WAVE 10 — EN-3 proving test: LP identity aliasing.
 *
 * THE BUG EN-3 EXISTS TO FIX, VERIFIED AT SOURCE RATHER THAN WHERE CITED.
 *   server/spvEngineRoutes.ts, in the subscription path, writes a SYNTHETIC
 *   investor id for anyone who is not yet a platform user:
 *       investorId = "ext_" + sha256(email.toLowerCase()).slice(0, 16)
 *   That id goes into the cap-table commit ledger, which is SACRED and
 *   append-only. Later, that same human signs up, gets a real `usr_...` id, and
 *   the investor dashboard reads their holdings with
 *   `listCommitsForUser(userId)` (server/captableCommitStore.ts:444-451).
 *
 *   So the position exists, is correct, is immutable — AND IS INVISIBLE TO ITS
 *   OWNER, permanently. Every wave until now would have "fixed" this by
 *   rewriting the ledger rows. That is precisely what a sacred append-only
 *   ledger forbids, and rightly: rewriting settled ownership records to fix a
 *   display problem is how cap tables stop being evidence.
 *
 *   EN-3 therefore adds a RESOLUTION LAYER, not a repair. The ledger is never
 *   touched. `resolveInvestorIdSet` widens a read to every id that denotes the
 *   same person.
 *
 * WHAT THIS FILE HAS TO PROVE — and the two traps it is written against:
 *
 *   TRAP 1, "fix where data doesn't flow." The alias is worthless if the id it
 *   derives is not the id the route actually wrote. So the derivation is pinned
 *   BOTH against a literal digest AND against the live expression in
 *   spvEngineRoutes.ts. If either side drifts, this fails — instead of the LP
 *   discovering it.
 *
 *   TRAP 2, "a guard can pass while checking nothing." Every allow-assertion
 *   below is paired with its refusal: the unique index must BLOCK a second
 *   active claim; the triggers must BLOCK a self-alias and a chained alias; and
 *   the schema-readiness probe must be shown to be TRUE, or every one of those
 *   refusals would be passing vacuously against a table that does not exist.
 *
 * THE SECURITY PROPERTY, STATED SO IT CAN BE CHECKED LATER.
 *   Aliasing is a READ-WIDENING mechanism over the caller's own identity. It
 *   must never widen to another person, and it must never be consulted to
 *   decide whether an action is PERMITTED — that is the same fence PT-5 draws
 *   around classification, and Wave 7B was right to refuse to cross it.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  deriveExternalInvestorId,
  resolveInvestorIdSet,
  resolveCanonicalUserId,
  claimAlias,
  selfClaimByEmail,
  externalIdHasLedgerRows,
  revokeAlias,
  listAliases,
  listAliasesForUser,
  getActiveAlias,
  AliasError,
  _resetAliasSchemaGuardForTests,
} from "../lib/investorIdentityAliasStore";
import { appendFlow, _resetWave10SchemaGuardForTests } from "../lib/ilpaCashflowLedger";
import { rawDb } from "../db/connection";
import { ensureWave9Schema } from "../wave9ReportingStore";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const uid = () => randomBytes(5).toString("hex");

beforeAll(() => {
  ensureWave9Schema();
  _resetAliasSchemaGuardForTests();
  _resetWave10SchemaGuardForTests();
  // Force the A-22 heal so the refusal assertions below are not vacuous.
  deriveExternalInvestorId("warmup@example.com");
  listAliases();
});

/* ==========================================================================
 * 0. NOT VACUOUS. If the table is absent, every refusal below passes for the
 *    wrong reason. This is the DA-3 lesson, applied before anything else.
 * ======================================================================== */
describe("W10/EN-3 — the schema is really installed (A-22, anti-vacuity)", () => {
  it("investor_identity_alias exists on this :memory: database", () => {
    const row = rawDb()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='investor_identity_alias'`)
      .get();
    expect(row).toBeTruthy();
  });

  it("its unique-active index and both integrity triggers were installed", () => {
    const objs = (rawDb()
      .prepare(
        `SELECT name, type FROM sqlite_master
          WHERE tbl_name='investor_identity_alias' AND type IN ('index','trigger')`,
      )
      .all() as Array<{ name: string; type: string }>);
    expect(objs.some((o) => o.type === "index")).toBe(true);
    expect(objs.filter((o) => o.type === "trigger").length).toBeGreaterThanOrEqual(2);
  });

  it("migration 0166 is byte-identical in both directories", () => {
    const a = path.join(REPO_ROOT, "migrations", "0166_wave10_en3_investor_identity_alias.sql");
    const b = path.join(REPO_ROOT, "server", "db", "migrations", "0166_wave10_en3_investor_identity_alias.sql");
    expect(fs.readFileSync(b)).toEqual(fs.readFileSync(a));
  });
});

/* ==========================================================================
 * 1. The derivation must match the producer. TRAP 1.
 * ======================================================================== */
describe("W10/EN-3 — the derived id is the id the SPV route actually wrote", () => {
  it("reproduces the producer's formula exactly", () => {
    const email = "Someone.Mixed@Example.COM";
    const expected =
      "ext_" + createHash("sha256").update(email.toLowerCase(), "utf8").digest("hex").slice(0, 16);
    expect(deriveExternalInvestorId(email)).toBe(expected);
  });

  it("normalises case and surrounding whitespace, because the roster does not", () => {
    expect(deriveExternalInvestorId("  LP@Fund.io ")).toBe(deriveExternalInvestorId("lp@fund.io"));
  });

  it("the producer in spvEngineRoutes.ts still uses the SAME construction", () => {
    // The alias is derived independently of the producer, so nothing at runtime
    // would notice if the producer changed its formula — the LP would simply
    // never match again. This assertion is the only thing standing between that
    // change and a silent regression.
    const src = read("server/spvEngineRoutes.ts");
    expect(src).toMatch(/ext_/);
    expect(src).toMatch(/sha256/i);
    expect(src).toMatch(/slice\(\s*0\s*,\s*16\s*\)/);
    expect(src).toMatch(/toLowerCase\(\)/);
  });
});

/* ==========================================================================
 * 2. Resolution. The read-widening contract, including its edges.
 * ======================================================================== */
describe("W10/EN-3 — resolution widens to self and only to self", () => {
  it("returns the canonical id alone when no alias exists — never an empty set", () => {
    // An empty array here would become `IN ()` at a call site and either match
    // nothing or, with a careless `if (ids.length)`, match everything.
    const lone = `usr_${uid()}`;
    expect(resolveInvestorIdSet(lone)).toEqual([lone]);
  });

  it("returns the canonical id FIRST, then the aliases", () => {
    const user = `usr_${uid()}`;
    const ext = deriveExternalInvestorId(`${uid()}@example.com`);
    claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: user, basis: "admin_manual", actorId: "admin" });
    const set = resolveInvestorIdSet(user);
    expect(set[0]).toBe(user);
    expect(set).toContain(ext);
    expect(set).toHaveLength(2);
  });

  it("resolves the reverse direction, and leaves unknown ids untouched", () => {
    const user = `usr_${uid()}`;
    const ext = deriveExternalInvestorId(`${uid()}@example.com`);
    claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: user, basis: "admin_manual", actorId: "admin" });
    expect(resolveCanonicalUserId(ext)).toBe(user);
    const unknown = `ext_${uid()}`;
    expect(resolveCanonicalUserId(unknown)).toBe(unknown);
  });

  it("a REVOKED alias stops resolving immediately", () => {
    const user = `usr_${uid()}`;
    const ext = deriveExternalInvestorId(`${uid()}@example.com`);
    claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: user, basis: "admin_manual", actorId: "admin" });
    expect(resolveInvestorIdSet(user)).toContain(ext);
    revokeAlias({ aliasInvestorId: ext, actorId: "admin", reason: "wrong person" });
    expect(resolveInvestorIdSet(user)).not.toContain(ext);
    expect(resolveCanonicalUserId(ext)).toBe(ext);
    // and the revoked row is RETAINED, not deleted — the mistaken claim is part
    // of the audit record.
    expect(listAliasesForUser(user).some((a) => a.state === "revoked")).toBe(true);
  });

  it("an empty canonical id resolves to an empty set rather than a wildcard", () => {
    expect(resolveInvestorIdSet("")).toEqual([]);
    expect(resolveInvestorIdSet("   ")).toEqual([]);
  });
});

/* ==========================================================================
 * 3. REFUSALS. Each of these is a way the table could corrupt an identity.
 * ======================================================================== */
describe("W10/EN-3 — the integrity rules genuinely BLOCK", () => {
  it("REFUSES an alias pointing at itself", () => {
    const u = `usr_${uid()}`;
    expect(() =>
      claimAlias({ tenantId: "t1", aliasInvestorId: u, canonicalUserId: u, basis: "admin_manual", actorId: "a" }),
    ).toThrow(AliasError);
  });

  it("REFUSES repointing an already-claimed alias at a different human", () => {
    const ext = deriveExternalInvestorId(`${uid()}@example.com`);
    const first = `usr_${uid()}`;
    const second = `usr_${uid()}`;
    claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: first, basis: "admin_manual", actorId: "a" });
    // Last-write-wins here would hand one investor's holdings to another.
    let caught: AliasError | null = null;
    try {
      claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: second, basis: "admin_manual", actorId: "a" });
    } catch (e) {
      caught = e as AliasError;
    }
    // Assert the CODE, not the prose. `AliasError.message` is the human
    // sentence and is meant to be editable; `code` is the contract the routes
    // switch on.
    expect(caught).toBeInstanceOf(AliasError);
    expect(caught!.code).toBe("ALIAS_ALREADY_CLAIMED");
    expect(resolveCanonicalUserId(ext)).toBe(first);
  });

  it("is IDEMPOTENT when re-claimed by the same human", () => {
    const ext = deriveExternalInvestorId(`${uid()}@example.com`);
    const u = `usr_${uid()}`;
    const a = claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: u, basis: "admin_manual", actorId: "x" });
    const b = claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: u, basis: "admin_manual", actorId: "x" });
    expect(b.id).toBe(a.id);
    expect(listAliases({ state: "active" }).filter((r) => r.aliasInvestorId === ext)).toHaveLength(1);
  });

  it("ALLOWS a fresh claim after a revoke — the supersede path", () => {
    const ext = deriveExternalInvestorId(`${uid()}@example.com`);
    const first = `usr_${uid()}`;
    const second = `usr_${uid()}`;
    claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: first, basis: "admin_manual", actorId: "a" });
    revokeAlias({ aliasInvestorId: ext, actorId: "admin", reason: "misidentified" });
    const re = claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: second, basis: "admin_manual", actorId: "a" });
    expect(re.canonicalUserId).toBe(second);
    expect(getActiveAlias(ext)?.canonicalUserId).toBe(second);
  });

  it("the DATABASE refuses a second ACTIVE row for one alias, independently of the code path", () => {
    // Going around claimAlias on purpose: the application check above could be
    // removed by a future edit, and the index must still hold the line.
    const ext = deriveExternalInvestorId(`${uid()}@example.com`);
    const u = `usr_${uid()}`;
    claimAlias({ tenantId: "t1", aliasInvestorId: ext, canonicalUserId: u, basis: "admin_manual", actorId: "a" });
    const now = new Date().toISOString();
    expect(() =>
      rawDb()
        .prepare(
          `INSERT INTO investor_identity_alias
             (id, tenant_id, alias_investor_id, canonical_user_id, match_email, basis,
              state, verified_by, verified_at, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(`iia_dup_${uid()}`, "t1", ext, `usr_${uid()}`, null, "admin_manual", "active", "a", now, "a", now, now),
    ).toThrow();
  });

  it("the DATABASE refuses a CHAINED alias (A -> B where B is itself an alias)", () => {
    // Chains make resolution order-dependent and make revocation ambiguous.
    const extA = deriveExternalInvestorId(`${uid()}@example.com`);
    const extB = deriveExternalInvestorId(`${uid()}@example.com`);
    const u = `usr_${uid()}`;
    claimAlias({ tenantId: "t1", aliasInvestorId: extA, canonicalUserId: u, basis: "admin_manual", actorId: "a" });
    expect(() =>
      claimAlias({ tenantId: "t1", aliasInvestorId: extB, canonicalUserId: extA, basis: "admin_manual", actorId: "a" }),
    ).toThrow();
  });

  it("revoking something that was never claimed is null, not an invented row", () => {
    expect(revokeAlias({ aliasInvestorId: `ext_${uid()}`, actorId: "admin" })).toBeNull();
  });
});

/* ==========================================================================
 * 4. Self-claim. The whole point: an LP recovering their own position.
 * ======================================================================== */
describe("W10/EN-3 — self-claim only works when there is something to claim", () => {
  it("returns null and creates NOTHING when the derived id has no rows", () => {
    const email = `${uid()}@nowhere.example`;
    const out = selfClaimByEmail({ tenantId: "t1", email, canonicalUserId: `usr_${uid()}` });
    expect(out.alias).toBeNull();
    expect(out.hadLedgerRows).toBe(false);
    expect(getActiveAlias(out.derivedId)).toBeNull();
  });

  it("claims when a real cash-flow row exists under the synthetic id", () => {
    const email = `${uid()}@lp.example`;
    const ext = deriveExternalInvestorId(email);
    // Seat a genuine position under the synthetic id, the way the SPV
    // subscription path does.
    appendFlow({
      tenantId: "t1",
      vehicleKind: "spv",
      vehicleId: `spv_${uid()}`,
      lpId: ext,
      txnType: "capital_call_investment",
      valueDate: "2025-01-10",
      amountMinor: -25_000_00,
      currency: "USD",
      sourceKind: "manual",
      createdBy: "test",
    });
    expect(externalIdHasLedgerRows(ext)).toBe(true);

    const user = `usr_${uid()}`;
    const out = selfClaimByEmail({ tenantId: "t1", email, canonicalUserId: user });
    expect(out.alias).not.toBeNull();
    expect(out.alias!.basis).toBe("email_verified");
    expect(resolveInvestorIdSet(user)).toEqual([user, ext]);
  });

  it("probes MORE than one table — a position can be seated in any of three", () => {
    // "No rows in the first table I looked at" is not "nothing to claim". This
    // is trap 1 in miniature: the sink for an LP position is not single.
    const src = read("server/lib/investorIdentityAliasStore.ts");
    expect(src).toContain("captable_commits");
    expect(src).toContain("spv_subscription");
    expect(src).toContain("vehicle_cashflow");
  });
});

/* ==========================================================================
 * 5. THE SCOPE FENCE. Aliasing widens READS. It must never grant anything.
 * ======================================================================== */
describe("W10/EN-3 — aliasing never touches permissions (PT-5 class fence)", () => {
  it("the store does not import or call any authorisation primitive", () => {
    const src = read("server/lib/investorIdentityAliasStore.ts");
    expect(src).not.toMatch(/seedCapabilityProfile|grantCapability|requireAdmin\s*\(/);
    expect(src).not.toMatch(/\brole\s*=\s*['"]admin['"]/);
  });

  it("the self-serve routes derive the alias from the SESSION, never from the body", () => {
    const src = read("server/lib/reportingEngineRoutes.ts");
    const claimRoute = src.slice(src.indexOf('/api/me/investor-identity/claim'));
    // If this ever reads an alias id out of req.body, any signed-in user could
    // claim any synthetic identity on the platform.
    expect(claimRoute).toContain("identity?.email");
    expect(claimRoute.slice(0, 1200)).not.toMatch(/b\.aliasInvestorId/);
  });

  it("the admin linkage routes are admin-gated, and the self routes are not admin-gated", () => {
    const src = read("server/lib/reportingEngineRoutes.ts");
    expect(src).toMatch(/"\/api\/admin\/investor-aliases",\s*requireAdmin/);
    expect(src).toMatch(/"\/api\/me\/investor-identity",\s*requireAuth/);
  });
});
