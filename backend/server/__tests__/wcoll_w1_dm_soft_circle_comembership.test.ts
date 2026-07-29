/**
 * server/__tests__/wcoll_w1_dm_soft_circle_comembership.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.2. The soft-circle DM co-membership disjunct.
 *
 * CONTEXT. A founder↔investor DM renders as "Private Investor" even when the
 * investor has already signalled into that founder's round. The masking is in
 * SACRED `userPrivacyResolver.ts:222-224`, which masks whenever
 * `opts.isCoMember !== true`; commsStore computed that flag from SACRED
 * `areCoMembersOnAnyCapTable()`, which self-joins `captable_commits` on
 * `investor_id` for BOTH sides and so can only ever be true for an
 * investor↔investor pair. W-AVI65 added founder-side disjuncts, but all of them
 * still require a `captable_commits` row in state `'committed'` — which a
 * soft-circling investor does not have until close. v4 §1.2 adds disjunct (4):
 * either side founds a company owning a round on which the other holds a LIVE
 * soft-circle row.
 *
 * ANTI-VACUITY. `server/lib/dmCoMembership.ts` EXISTS on the pristine tree
 * (W-AVI65 shipped it); only disjunct (4) is new. So this file loads on pristine
 * and the soft-circle tests fail with real `AssertionError: expected false to be
 * true`. The tests that pin the PRE-EXISTING disjuncts and the leak guarantees
 * pass on pristine and are labelled REGRESSION GUARD.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { getDb, rawDb } from "../db/connection";
import { areDmCoMembers } from "../lib/dmCoMembership";
import { resolveDisplayName } from "../lib/userPrivacyResolver";
import type { SoftCircleStatus } from "../softCircleStore";

const CO = "co_dmsc";
const RND = "rnd_dmsc";
const FOUNDER = "u_dmsc_founder";
const INVESTOR = "u_dmsc_investor";
const STRANGER = "u_dmsc_stranger";
const LEGAL_NAME = "Priya Raghunathan";

function now(): string {
  return new Date().toISOString();
}

function seedFoundedCompany(
  role = "founder",
  active = true,
  deleted = false,
  opts: { roundDeleted?: boolean } = {},
): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO company_members
         (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
       VALUES ('cm_dmsc', ?, ?, ?, 'tenant_platform', ?, ?, ?)`,
    )
    .run(CO, FOUNDER, role, active ? 1 : 0, now(), deleted ? now() : null);
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO rounds
         (id, tenant_id, company_id, name, type, state, target_amount, raised_amount,
          currency, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_platform', ?, 'Seed', 'seed', 'open', 1000000, 0, 'USD', ?, ?, ?)`,
    )
    .run(RND, CO, now(), now(), opts.roundDeleted ? now() : null);
}

function seedSoftCircle(status: SoftCircleStatus | null, opts: { deleted?: boolean } = {}): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO soft_circles
         (id, tenant_id, round_id, company_id, investor_user_id, investor_name, amount,
          amount_minor, currency, status, collective_visible, created_at, updated_at, deleted_at)
       VALUES ('sc_dmsc', 'tenant_platform', ?, ?, ?, 'Investor', 50000, 0, 'USD', ?, 1, ?, ?, ?)`,
    )
    .run(RND, CO, INVESTOR, status, now(), now(), opts.deleted ? now() : null);
}

function setPrivacy(userId: string, prefs: Record<string, unknown>): void {
  // Touch the resolver first so it self-heals the table before we write.
  resolveDisplayName(userId, userId, "message", { legalName: LEGAL_NAME });
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO profilestore_user_privacy
         (user_id, privacy_json, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL)`,
    )
    .run(userId, JSON.stringify(prefs), now());
}

function wipe(): void {
  rawDb().prepare("DELETE FROM soft_circles WHERE id = 'sc_dmsc'").run();
  rawDb().prepare("DELETE FROM company_members WHERE id = 'cm_dmsc'").run();
  rawDb().prepare("DELETE FROM rounds WHERE id = ?").run(RND);
  for (const u of [FOUNDER, INVESTOR, STRANGER]) {
    try {
      rawDb().prepare("DELETE FROM profilestore_user_privacy WHERE user_id = ?").run(u);
    } catch {
      /* table is created lazily by the resolver */
    }
  }
}

beforeAll(() => {
  getDb();
});

beforeEach(() => {
  wipe();
});

describe("v4 §1.2 — a live soft-circle proves DM co-membership, in both directions", () => {
  const PARTICIPATING: SoftCircleStatus[] = ["intent", "confirmed", "wired", "committed"];

  for (const status of PARTICIPATING) {
    it(`status "${status}" reveals (founder → investor and investor → founder)`, () => {
      seedFoundedCompany();
      seedSoftCircle(status);
      expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(true);
      expect(areDmCoMembers(INVESTOR, FOUNDER)).toBe(true);
    });
  }

  it("`declined` NEVER reveals", () => {
    seedFoundedCompany();
    seedSoftCircle("declined");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(false);
    expect(areDmCoMembers(INVESTOR, FOUNDER)).toBe(false);
  });

  it("DOCUMENTING: `soft_circles.status` is NOT NULL, so the `IS NULL` arm is defence-in-depth", () => {
    // `foundsCompanyWhereOtherSoftCircles` also accepts `sc.status IS NULL`
    // because `softCircleStore.mapRow` defensively reads `(r.status ?? "intent")`.
    // The column is physically NOT NULL, so that arm is unreachable here — this
    // test records that the two cannot disagree rather than asserting a state
    // the schema forbids.
    seedFoundedCompany();
    expect(() => seedSoftCircle(null)).toThrow(/NOT NULL/);
  });

  it("a soft-DELETED row never reveals", () => {
    seedFoundedCompany();
    seedSoftCircle("committed", { deleted: true });
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(false);
  });

  it("no soft-circle row at all does not reveal", () => {
    seedFoundedCompany();
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(false);
  });

  it("an unrelated third party is never revealed by someone else's soft circle", () => {
    seedFoundedCompany();
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, STRANGER)).toBe(false);
    expect(areDmCoMembers(INVESTOR, STRANGER)).toBe(false);
  });
});

describe("review fix B12 — a soft-DELETED round cannot unmask a legal name", () => {
  /**
   * The predicate joins `company_members` → `rounds` → `soft_circles` and
   * checked `deleted_at IS NULL` on the first and last but NOT on `rounds`. Its
   * sibling `foundsCompanyWhereOtherHolds` checks both of ITS join tables, so
   * this was an internal inconsistency as well as the wrong direction for a
   * privacy predicate: deleting a round must never widen who can see an
   * investor's legal identity.
   *
   * ANTI-VACUITY: both tests FAIL on the pre-B12 tree — `areDmCoMembers` returns
   * `true` and the resolver returns the legal name, i.e.
   * `expected true to be false` / `expected 'Priya Raghunathan' to be 'Private
   * Investor'`. They also fail on pristine, where disjunct (4) does not exist at
   * all (there `areDmCoMembers` is false for the LIVE-round case too, which the
   * control assertion below distinguishes).
   */
  it("a soft-deleted round does NOT prove co-membership", () => {
    seedFoundedCompany("founder", true, false, { roundDeleted: true });
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(false);
    expect(areDmCoMembers(INVESTOR, FOUNDER)).toBe(false);
  });

  it("CONTROL: the identical fixture with a LIVE round does prove it", () => {
    // Proves the test above is discriminating on `rounds.deleted_at` alone and
    // not merely on a broken fixture.
    seedFoundedCompany("founder", true, false, { roundDeleted: false });
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(true);
  });

  it("and the masking holds end-to-end: the legal name is not revealed", () => {
    seedFoundedCompany("founder", true, false, { roundDeleted: true });
    seedSoftCircle("committed");
    const shown = resolveDisplayName(INVESTOR, FOUNDER, "message", {
      legalName: LEGAL_NAME,
      isCoMember: areDmCoMembers(FOUNDER, INVESTOR),
    });
    expect(shown).not.toBe(LEGAL_NAME);
  });

  it("is consistent with its sibling predicate, which already checked both joins", () => {
    // `foundsCompanyWhereOtherHolds` guards `company_members.deleted_at` AND
    // `captable_commits.deleted_at`. After B12 the soft-circle predicate guards
    // all THREE of its tables, so no soft-deleted row on any join can reveal.
    const src = readFileSync(
      new URL("../lib/dmCoMembership.ts", import.meta.url),
      "utf8",
    );
    const softCircleQuery = src.slice(
      src.indexOf("function foundsCompanyWhereOtherSoftCircles"),
      src.indexOf("function foundsCompanyWhereOtherHolds"),
    );
    expect(softCircleQuery).toMatch(/AND cm\.deleted_at IS NULL/);
    expect(softCircleQuery).toMatch(/AND r\.deleted_at IS NULL/);
    expect(softCircleQuery).toMatch(/AND sc\.deleted_at IS NULL/);
  });
});

describe("v4 §1.2 — only an ACTIVE founder/co_founder membership qualifies", () => {
  it("`co_founder` qualifies too", () => {
    seedFoundedCompany("co_founder");
    seedSoftCircle("intent");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(true);
  });

  it("a non-founder role does NOT qualify", () => {
    seedFoundedCompany("employee");
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(false);
  });

  it("an inactive membership does NOT qualify", () => {
    seedFoundedCompany("founder", false);
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(false);
  });

  it("a soft-deleted membership does NOT qualify", () => {
    seedFoundedCompany("founder", true, true);
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(false);
  });
});

describe("v4 §1.2 — the widening can NEVER override an explicit opt-out", () => {
  it("`visibleToCoMembers:false` still masks even with a committed soft circle", () => {
    seedFoundedCompany();
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, INVESTOR)).toBe(true);

    setPrivacy(INVESTOR, { screenName: "", visibleToCoMembers: false });

    const shown = resolveDisplayName(INVESTOR, FOUNDER, "message", {
      legalName: LEGAL_NAME,
      isCoMember: true,
    });
    expect(shown).not.toContain("Priya");
    expect(shown).toBe("Private Investor");
  });

  it("an opted-out user's chosen screen name is used, never their legal name", () => {
    seedFoundedCompany();
    seedSoftCircle("committed");
    setPrivacy(INVESTOR, { screenName: "Falcon Capital", visibleToCoMembers: false });
    const shown = resolveDisplayName(INVESTOR, FOUNDER, "message", {
      legalName: LEGAL_NAME,
      isCoMember: true,
    });
    expect(shown).toBe("Falcon Capital");
  });

  it("with the default (opt-IN) preference the widening does reveal the legal name", () => {
    seedFoundedCompany();
    seedSoftCircle("committed");
    expect(
      resolveDisplayName(INVESTOR, FOUNDER, "message", {
        legalName: LEGAL_NAME,
        isCoMember: true,
      }),
    ).toBe(LEGAL_NAME);
  });

  it("REGRESSION GUARD (passes on pristine): isCoMember:false always masks", () => {
    expect(
      resolveDisplayName(INVESTOR, FOUNDER, "message", {
        legalName: LEGAL_NAME,
        isCoMember: false,
      }),
    ).toBe("Private Investor");
  });
});

describe("v4 §1.2 — fail-closed on malformed input", () => {
  it("REGRESSION GUARD (passes on pristine): self-pairs and blank ids are false", () => {
    seedFoundedCompany();
    seedSoftCircle("committed");
    expect(areDmCoMembers(FOUNDER, FOUNDER)).toBe(false);
    expect(areDmCoMembers("", INVESTOR)).toBe(false);
    expect(areDmCoMembers(FOUNDER, "  ")).toBe(false);
    expect(areDmCoMembers(null as never, INVESTOR)).toBe(false);
  });
});

describe("v4 §1.2 — DM PERMISSION is a separate path and is not widened", () => {
  /**
   * REGRESSION GUARD (passes on pristine). `areDmCoMembers` feeds DISPLAY NAME
   * resolution only. DM permission is decided at commsStore.ts by
   * `policy.allowed || r.canSendDm || authorizedViaCrm`. A structural assertion
   * is used deliberately: the guarantee is "this predicate has exactly one
   * consumer", which is a property of the source, not of any single request.
   */
  const comms = readFileSync(new URL("../commsStore.ts", import.meta.url), "utf8");

  /** Lines that actually reference the symbol in CODE (imports/comments excluded). */
  function codeRefLines(): string[] {
    return comms.split("\n").filter((l) => {
      // An INVOCATION, so prose mentions inside block comments are excluded.
      if (!/areDmCoMembers\(/.test(l)) return false;
      return !l.trim().startsWith("import");
    });
  }

  it("`areDmCoMembers` has exactly ONE call site in commsStore", () => {
    expect(codeRefLines().length).toBe(1);
  });

  it("that call site feeds identity resolution, not the DM permission check", () => {
    const callLine = codeRefLines().join("\n");
    expect(callLine).not.toMatch(/canSendDm|allowedByPolicy/);
    // It is the ternary that computes the `isCoMember` argument for
    // `resolveIdentity` (commsStore.ts:934).
    expect(callLine).toMatch(/\?\s*areDmCoMembers/);
  });

  it("the DM permission expression does not consult co-membership at all", () => {
    const permission = comms
      .split("\n")
      .filter((l) => l.includes("allowedByPolicy"))
      .join("\n");
    expect(permission).toMatch(/canSendDm/);
    expect(permission).not.toMatch(/areDmCoMembers|areCoMembersOnAnyCapTable/);
  });
});
