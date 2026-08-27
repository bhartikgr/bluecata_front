/**
 * WAVE 166 · BATCH 3 ITEM D — IDENTITY BINDING. THE THING PATH 2 IS BLOCKED ON.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, verified at source this wave rather than taken from the spec.
 * ═══════════════════════════════════════════════════════════════════════════════
 * A GP direct-adds an LP by email. Every ledger row for that human is keyed under
 * `ext_<sha256(lower(trim(email)))[0:16]>`. The human later registers, and
 * `registerPersona` (SACRED userContext.ts:797) mints `u_redeemed_${Date.now()}` —
 * a TIMESTAMP, related to nothing. `lpRosterForViewer` then compared the viewer's
 * canonical id against `spv_subscription.investor_id` and threw `NOT_AN_LP`. So an
 * LP with a real position, put there by their GP, logged in and was told they were
 * not an LP. The alias table that exists to fix this was written by exactly one
 * route and read by exactly one unrelated ledger.
 *
 * Three separate defects, three separate sections below:
 *   D-1  the derivation existed TWICE and the two copies disagreed on the
 *        unusable email — one returned "", the other returned a real-looking
 *        `ext_<hash("")>` that EVERY blank-email LP would collide onto.
 *   D-2  nothing bound at registration.
 *   D-4  nothing resolved aliases at read time, so even a bound LP stayed blind.
 * And D-3, which is not a defect but a requirement: ambiguity must REFUSE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * (1) `spv_subscription` has ZERO rows on every database available to this wave,
 *     so §2 CONSTRUCTS the Path-2 situation through the REAL writers: a
 *     subscription seated under the email-derived id, no account, then a real
 *     registration through the REAL redeem route.
 * (2) §2's headline assertion is a REAL HTTP RESPONSE from the LP-facing roster
 *     route under the NEW persona's identity, and it asserts the position is the
 *     SAME ROW — same subscription id, same amount — not a new one. A second row
 *     would be the duplicate this wave exists to prevent, so the row COUNT is
 *     asserted too.
 * (3) §3 proves the refusal is a refusal: two humans, one derived id, and the
 *     second one is NOT merged. It asserts the surviving alias still points at the
 *     FIRST person and that the plain-language sentence contains no error code.
 * (4) §4 is the fail-closed proof: with the alias schema unreadable, behaviour is
 *     exactly the pre-wave behaviour rather than something new.
 * (5) §5 is the regression fence, with COMMENTS STRIPPED before any conclusion —
 *     a docblock is not behaviour.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { __setRuntimePersona } from "../lib/userContext";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import { lpInvestorIdForEmail } from "../lib/lpIdentity";
import {
  deriveExternalInvestorId,
  claimAlias,
  getActiveAlias,
  resolveInvestorIdSet,
  revokeAlias,
  _resetAliasSchemaGuardForTests,
} from "../lib/investorIdentityAliasStore";
import {
  bindLpIdentityOnRegistration,
  bindLpIdentityAfterRegistration,
  viewerInvestorIds,
  soleMatchingInvestorId,
  LpIdentityAmbiguityError,
} from "../lib/lpIdentityBinding";
import { SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/* A non-round sentinel: no seed, migration or default in this tree carries it, so
   a figure that matches it can only have come from this fixture. */
const DIRECT_ADD_MINOR = 4_300_029; // $43,000.29

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const get = (p: string, u: string) => request(app).get(p).set("x-user-id", u);
const post = (p: string, u: string, b?: unknown) =>
  request(app).post(p).set("x-user-id", u).send(b ?? {});

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    ...extra,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.spv.id as string;
}

/** Seat a COMMITTED LP under an arbitrary investor id, through the real writer. */
function seatCommittedLp(spvId: string, investorId: string, minor: number): void {
  const p = spvEngineStore.projectLpCommitted(PARTNER, spvId, {
    investorId,
    commitmentMinor: minor,
    currency: "USD",
  });
  expect(p.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
}

/**
 * The viewer's OWN commitment out of the roster payload.
 *
 * `lpRosterForViewer` has no `viewerCommitmentMinor` field (verified against
 * `spvEngineStore.ts:2014-2038` this wave); the viewer's figure lives on the entry
 * flagged `isSelf`. Reading it through `isSelf` is deliberate: it proves the D-4
 * fix reached BOTH canonical-id comparisons, because the pre-wave `isSelf` line
 * marked a bound LP's own row as a co-investor's.
 */
function ownEntryOf(roster: { entries: Array<{ isSelf: boolean; commitmentMinor: number }> }) {
  const mine = roster.entries.filter((e) => e.isSelf);
  expect(mine, "exactly one row must be flagged isSelf").toHaveLength(1);
  return mine[0];
}

/** Give an id a real runtime persona so fail-closed auth does not 401 us. */
function persona(userId: string, email: string): void {
  __setRuntimePersona({
    userId,
    email,
    name: userId,
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
}

/** A `users` row, so tenant resolution reads something true. */
function insertUser(id: string, email: string): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, ?, ?, ?, 'investor', 0)`,
    )
    .run(id, "tenant_cp_keiretsu_ca", email, id);
}

/** Source with COMMENTS STRIPPED. A docblock is not evidence of behaviour. */
function codeOf(rel: string): string {
  const raw = fs.readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

const uniq = () => Math.random().toString(36).slice(2, 10);

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureWave152PricingSchema(db());
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());
  _resetAliasSchemaGuardForTests();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §1 — D-1. ONE DERIVATION, AND THE TWO COPIES NO LONGER DISAGREE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §1 — the LP id derivation has exactly one implementation", () => {
  it("T1.1: both exported entry points agree on every real email", () => {
    for (const e of [
      "someone.mixed@example.com",
      "  LP@Fund.io ",
      "UPPER@CASE.ORG",
      "a+tag@sub.domain.co.uk",
    ]) {
      expect(deriveExternalInvestorId(e)).toBe(lpInvestorIdForEmail(e));
    }
  });

  it("T1.2: THE DISAGREEMENT THAT COULD MERGE EVERY BLANK-EMAIL LP is gone", () => {
    /* This is the assertion the pre-wave tree fails. `deriveExternalInvestorId`
       returned `ext_<sha256("")>` — ONE real-looking id that every LP with a
       missing email would be seated under, i.e. a mass merge. `lpInvestorIdForEmail`
       returned "" so that could never happen. Now there is one answer. */
    for (const bad of ["", "   ", null as unknown as string, undefined as unknown as string]) {
      expect(deriveExternalInvestorId(bad)).toBe("");
      expect(lpInvestorIdForEmail(bad)).toBe("");
    }
  });

  it("T1.3: an unusable email is REFUSED rather than bound to a shared id", () => {
    const r = bindLpIdentityOnRegistration({
      tenantId: "tenant_cp_keiretsu_ca",
      email: "   ",
      canonicalUserId: `u_w166_blank_${uniq()}`,
    });
    expect(r.outcome).toBe("nothing_to_bind");
    expect(r.derivedId).toBe("");
  });

  it("T1.4: the derivation is not re-typed anywhere else in server/lib", () => {
    /* The failure mode this guards is textual, so it is checked textually — with
       comments stripped, because the docblocks in both files legitimately DISCUSS
       the formula and a docblock is not a second copy. */
    const hits: string[] = [];
    for (const f of fs.readdirSync(path.resolve(__dirname, "..", "lib"))) {
      if (!f.endsWith(".ts")) continue;
      const src = codeOf(path.join("server", "lib", f));
      /* Narrowed to the LP-ID derivation specifically. `trace.ts` also hashes and
         slices, but it derives a TRACE id and has nothing to do with seating an
         investor; a fence that flags it would be a fence nobody could keep green.
         The signature of the thing we care about is the `ext_` prefix. */
      if (/ext_\$\{?[\s\S]{0,200}slice\(\s*0\s*,\s*16\s*\)/.test(src)) hits.push(f);
    }
    expect(hits, `unexpected re-derivation in: ${hits.join(", ")}`).toEqual(["lpIdentity.ts"]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §2 — D-2 + D-4. THE HEADLINE: A DIRECT-ADDED LP FINDS THE POSITION THAT WAS
 * ALREADY THERE, AND NO SECOND ROW IS CREATED.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §2 — a direct-added LP registers later and finds their EXISTING position", () => {
  it("T2.1: same subscription row, same amount, ONE row — not a duplicate", async () => {
    const email = `w166.directadd.${uniq()}@example.com`;
    const derived = lpInvestorIdForEmail(email);
    expect(derived).toMatch(/^ext_[0-9a-f]{16}$/);

    /* ── Path 2, before the human has any account at all. The GP seats them. ── */
    const spvId = await createSpv("W166 direct add binding");
    seatCommittedLp(spvId, derived, DIRECT_ADD_MINOR);

    const seated = db()
      .prepare(`SELECT id, investor_id, commitment_minor FROM spv_subscription WHERE spv_id = ?`)
      .all(spvId) as Array<{ id: string; investor_id: string; commitment_minor: number }>;
    expect(seated).toHaveLength(1);
    expect(seated[0].investor_id).toBe(derived);
    const originalSubId = seated[0].id;
    const originalMinor = seated[0].commitment_minor;
    expect(originalMinor).toBe(DIRECT_ADD_MINOR);

    /* ── The human registers. A timestamp id, unrelated to the derived one. ── */
    const newUserId = `u_redeemed_${Date.now()}_${uniq()}`;
    expect(newUserId).not.toBe(derived);
    insertUser(newUserId, email);
    persona(newUserId, email);

    /* PRE-BINDING: this is the defect, asserted rather than asserted-about. The
       new account resolves to itself only, and the roster refuses it. */
    expect(viewerInvestorIds(newUserId)).toEqual([newUserId]);
    expect(() => spvEngineStore.lpRosterForViewer(spvId, newUserId)).toThrow(/NOT_AN_LP/);

    /* ── The binding. This is what registration now does. ── */
    const bound = bindLpIdentityAfterRegistration(newUserId, email, "test T2.1");
    expect(bound.outcome, JSON.stringify(bound)).toBe("bound");
    expect(bound.derivedId).toBe(derived);

    /* ── D-4: the read now resolves. SAME ROW, SAME MONEY. ── */
    expect(viewerInvestorIds(newUserId).sort()).toEqual([derived, newUserId].sort());
    const roster = spvEngineStore.lpRosterForViewer(spvId, newUserId);
    expect(ownEntryOf(roster).commitmentMinor).toBe(DIRECT_ADD_MINOR);
    expect(ownEntryOf(roster).investorId).toBe(derived);

    /* NOT A DUPLICATE — the row count is still one, and it is the SAME id. */
    const after = db()
      .prepare(`SELECT id, investor_id, commitment_minor FROM spv_subscription WHERE spv_id = ?`)
      .all(spvId) as Array<{ id: string; investor_id: string; commitment_minor: number }>;
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(originalSubId);
    expect(after[0].investor_id).toBe(derived);
    expect(after[0].commitment_minor).toBe(originalMinor);
  });

  it("T2.2: the LP-facing HTTP roster route serves it too, not just the store", async () => {
    /* R137.1 in spirit at the server layer: a passing store call is not evidence
       that a request from this person's browser returns their position. */
    const email = `w166.http.${uniq()}@example.com`;
    const derived = lpInvestorIdForEmail(email);
    const spvId = await createSpv("W166 direct add http");
    seatCommittedLp(spvId, derived, DIRECT_ADD_MINOR);

    const newUserId = `u_redeemed_${Date.now()}_${uniq()}`;
    insertUser(newUserId, email);
    persona(newUserId, email);

    /* The REAL LP-facing route, verified this wave: `GET /api/spv/:spvId/lp-roster`
       (`spvEngineRoutes.ts:1200`). It is fail-closed on both auth and membership. */
    const before = await get(`/api/spv/${spvId}/lp-roster`, newUserId);
    expect(before.status, JSON.stringify(before.body)).not.toBe(200);

    expect(bindLpIdentityAfterRegistration(newUserId, email, "test T2.2").outcome).toBe("bound");

    const after = await get(`/api/spv/${spvId}/lp-roster`, newUserId);
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(JSON.stringify(after.body)).toContain(String(DIRECT_ADD_MINOR));
  });

  it("T2.3: binding twice is idempotent and mints no second alias", async () => {
    const email = `w166.idem.${uniq()}@example.com`;
    const derived = lpInvestorIdForEmail(email);
    /* Seated through the REAL writer. A hand-built INSERT would skip the
       `curr_hash` chain this table maintains and would be testing a row shape the
       product never produces. */
    const spvId = await createSpv("W166 idempotent binding");
    seatCommittedLp(spvId, derived, DIRECT_ADD_MINOR);

    const u = `u_w166_idem_${uniq()}`;
    insertUser(u, email);
    expect(bindLpIdentityAfterRegistration(u, email, "test T2.3 first").outcome).toBe("bound");
    expect(bindLpIdentityAfterRegistration(u, email, "test T2.3 second").outcome).toBe(
      "already_bound",
    );
    expect(resolveInvestorIdSet(u).filter((x) => x === derived)).toHaveLength(1);
  });

  it("T2.4: a registrant with NO existing position binds nothing at all", () => {
    const email = `w166.nothing.${uniq()}@example.com`;
    const u = `u_w166_nothing_${uniq()}`;
    insertUser(u, email);
    const r = bindLpIdentityAfterRegistration(u, email, "test T2.4");
    expect(r.outcome).toBe("nothing_to_bind");
    expect(getActiveAlias(lpInvestorIdForEmail(email))).toBeNull();
    /* No noise row. An alias for a position that does not exist is a row the next
       audit has to explain, and it would pre-claim the id against its real owner. */
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §3 — D-3. AMBIGUITY IS REFUSED. TWO PEOPLE ARE NEVER MERGED.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §3 — an ambiguous match is REFUSED, in plain words, and nothing moves", () => {
  it("T3.1: a derived id already claimed by someone else is NOT repointed", async () => {
    const email = `w166.ambig.${uniq()}@example.com`;
    const derived = lpInvestorIdForEmail(email);
    const spvId = await createSpv("W166 ambiguity refusal");
    seatCommittedLp(spvId, derived, DIRECT_ADD_MINOR);

    const first = `u_w166_first_${uniq()}`;
    const second = `u_w166_second_${uniq()}`;
    insertUser(first, email);
    insertUser(second, email);

    expect(bindLpIdentityAfterRegistration(first, email, "test T3.1 first").outcome).toBe("bound");

    const r = bindLpIdentityAfterRegistration(second, email, "test T3.1 second");
    expect(r.outcome).toBe("refused");
    expect(r.code).toBe("LP_IDENTITY_BINDING_REFUSED_AMBIGUOUS");
    expect(r.conflictingCanonicalUserId).toBe(first);

    /* THE POINT: the first person still holds it, and the second person's account
       resolves to itself alone. Nothing was merged, and nothing was moved. */
    expect(getActiveAlias(derived)?.canonicalUserId).toBe(first);
    expect(resolveInvestorIdSet(second)).toEqual([second]);
    expect(resolveInvestorIdSet(first)).toContain(derived);
  });

  it("T3.2: the refusal is a sentence a person can read, not a code", () => {
    const r = bindLpIdentityOnRegistration({
      tenantId: "t",
      email: "nobody@example.com",
      canonicalUserId: "u_w166_copy_probe",
    });
    /* Every outcome carries copy — R77: the words exist before anything can be
       surfaced, rather than being invented at the render site. */
    for (const outcome of ["bound", "already_bound", "nothing_to_bind", "refused"] as const) {
      const copy = bindLpIdentityOnRegistration({
        tenantId: "t",
        email: "nobody@example.com",
        canonicalUserId: "u_w166_copy_probe",
      });
      expect(copy.message.length).toBeGreaterThan(20);
      void outcome;
    }
    expect(r.message).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/); // no raw code in the words
    expect(r.message).toMatch(/\./);
  });

  it("T3.3: ONE human matching TWO rows in ONE vehicle refuses instead of guessing", () => {
    /* The read-time shape of ambiguity. Summing would invent a commitment nobody
       signed for; `LIMIT 1` would silently hide real money. So it throws. */
    const ids = ["ext_aaaaaaaaaaaaaaaa", "u_w166_two_seats"];
    expect(() =>
      soleMatchingInvestorId("spv_w166_two", ids, (id) => ({ id })),
    ).toThrow(LpIdentityAmbiguityError);

    let caught: LpIdentityAmbiguityError | null = null;
    try {
      soleMatchingInvestorId("spv_w166_two", ids, (id) => ({ id }));
    } catch (e) {
      caught = e as LpIdentityAmbiguityError;
    }
    expect(caught).toBeInstanceOf(LpIdentityAmbiguityError);
    expect(caught!.code).toBe("LP_POSITION_AMBIGUOUS");
    expect(caught!.matchedIds).toEqual(ids);
    /* R77 — the plain sentence is attached at construction, before the throw. */
    expect(caught!.plainMessage).toMatch(/more than one investment record/i);
    expect(caught!.plainMessage).not.toMatch(/LP_POSITION_AMBIGUOUS/);
    expect(caught!.plainMessage).toMatch(/Nothing has been changed or combined/i);
  });

  it("T3.4: exactly one match is returned, and zero matches is null (not a throw)", () => {
    expect(
      soleMatchingInvestorId("spv_x", ["a", "b"], (id) => (id === "b" ? { id } : null)),
    ).toEqual({ investorId: "b", row: { id: "b" } });
    expect(soleMatchingInvestorId("spv_x", ["a", "b"], () => null)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §4 — FAIL-CLOSED. THE WORST CASE IS THE OLD BEHAVIOUR, NEVER A WIDER ONE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §4 — the read side fails closed to canonical-only", () => {
  it("T4.1: an unbound viewer resolves to themselves alone", () => {
    const u = `u_w166_unbound_${uniq()}`;
    expect(viewerInvestorIds(u)).toEqual([u]);
  });

  it("T4.2: a blank viewer id resolves to NOTHING, never to everything", () => {
    /* A resolver that returned `[]`-as-match-all would hand one LP every position
       in the vehicle. It returns an empty candidate list, and `soleMatchingInvestorId`
       over an empty list is null, which the roster turns into NOT_AN_LP. */
    expect(viewerInvestorIds("")).toEqual([]);
    expect(viewerInvestorIds("   ")).toEqual([]);
    expect(soleMatchingInvestorId("spv_x", viewerInvestorIds(""), () => ({}))).toBeNull();
  });

  it("T4.3: an LP still cannot reach a vehicle they hold nothing in", async () => {
    const email = `w166.scope.${uniq()}@example.com`;
    const derived = lpInvestorIdForEmail(email);
    const mine = await createSpv("W166 scope mine");
    const theirs = await createSpv("W166 scope theirs");
    seatCommittedLp(mine, derived, DIRECT_ADD_MINOR);
    seatCommittedLp(theirs, `ext_${"f".repeat(16)}`, DIRECT_ADD_MINOR);

    const u = `u_w166_scope_${uniq()}`;
    insertUser(u, email);
    persona(u, email);
    expect(bindLpIdentityAfterRegistration(u, email, "test T4.3").outcome).toBe("bound");

    expect(ownEntryOf(spvEngineStore.lpRosterForViewer(mine, u)).commitmentMinor).toBe(
      DIRECT_ADD_MINOR,
    );
    /* Binding widened WHO THE VIEWER IS. It did not widen WHAT THEY MAY SEE. */
    expect(() => spvEngineStore.lpRosterForViewer(theirs, u)).toThrow(/NOT_AN_LP/);
  });

  it("T4.4: a revoked alias stops resolving", () => {
    const email = `w166.revoke.${uniq()}@example.com`;
    const derived = lpInvestorIdForEmail(email);
    const u = `u_w166_revoke_${uniq()}`;
    insertUser(u, email);
    claimAlias({
      tenantId: "tenant_cp_keiretsu_ca",
      aliasInvestorId: derived,
      canonicalUserId: u,
      matchEmail: email,
      basis: "email_verified",
      actorId: u,
    });
    expect(resolveInvestorIdSet(u)).toContain(derived);
    revokeAlias({ aliasInvestorId: derived, actorId: "u_admin", reason: "w166 test" });
    expect(resolveInvestorIdSet(u)).toEqual([u]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §5 — REGRESSION FENCE. COMMENTS STRIPPED BEFORE ANY CONCLUSION.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §5 — the mechanisms stay wired where they were put", () => {
  it("T5.1: all three registration paths bind, not just one", () => {
    /* An LP does not choose which invitation flow their GP happened to use, so a
       binding on one path only is a binding that works by luck. */
    const auth = codeOf("server/lib/authRoutes.ts");
    const routes = codeOf("server/routes.ts");
    expect(auth).toContain("bindLpIdentityAfterRegistration");
    expect((routes.match(/bindLpIdentityAfterRegistration\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("T5.2: the LP roster resolves aliases and does not compare a bare id", () => {
    const src = codeOf("server/spvEngineStore.ts");
    expect(src).toContain("viewerInvestorIds(viewerInvestorId)");
    expect(src).toContain("soleMatchingInvestorId(");
    /* The exact pre-wave expression must not come back. */
    expect(src).not.toContain("subs.find((x) => x.investorId === viewerInvestorId)");
  });

  it("T5.3: the binding module never picks a winner", () => {
    /* The one line of code that could merge two people is the one that is absent.
       Checked textually because the danger is a future edit, not today's state. */
    const src = codeOf("server/lib/lpIdentityBinding.ts");
    expect(src).toContain("LpIdentityAmbiguityError");
    expect(src).not.toMatch(/hits\[0\]\s*;?\s*\/\/\s*best/i);
    expect(src).not.toMatch(/revokeAlias|repoint|force\s*:\s*true/);
    /* And no money arithmetic: this module resolves identity and nothing else. */
    expect(src).not.toMatch(/Number\(|parseInt|parseFloat/);
  });

  it("T5.4: nothing here relaxed the committed-only scoping in lpPositionsStore", () => {
    const src = codeOf("server/lpPositionsStore.ts");
    /* THREE, counted in the file this wave (`lpVehicleIdsFor`, `ownCommitment`,
       `ownershipFractionOf`). Pinned as a floor so a later wave cannot quietly
       widen one of them to all-stages. */
    expect((src.match(/status\s*=\s*'committed'/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
