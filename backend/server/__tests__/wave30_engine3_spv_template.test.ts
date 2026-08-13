/**
 * WAVE 30 · ENGINE 3 — falsification harness for `spv_template`.
 *
 * WHAT THIS HARNESS IS DEFENDING AGAINST
 * --------------------------------------
 * Twenty-two instances in this build of a check that passed while checking
 * nothing. Engine 2's was the sharpest: a forward-write hook that threw on
 * every call and was swallowed by a fail-soft catch, caught only because the
 * test drove a PRE-EXISTING caller rather than the new store directly.
 *
 * Engine 3's specific exposure is different and worse. Its tables are created
 * by migration 0177, which `NODE_ENV=test` NEVER RUNS — the test database is
 * built from `connection.ts`'s inline baseline, and connection.ts is SACRED so
 * the tables could not be added there. If the self-heal installer silently did
 * nothing, `spv_template` would not exist, and because the installer is
 * fail-soft-by-design every read would return empty and every list assertion of
 * the form "expected 0" would PASS. Case (0) therefore asserts the SCHEMA
 * ITSELF before anything else runs.
 *
 * Every case asserts BOTH POLES where a pole exists: not just that the wrong
 * input is refused, but that the right one is accepted — a validator that
 * rejects everything is as broken as one that rejects nothing, and only the
 * two-pole form can tell them apart.
 *
 * This file establishes its own preconditions. It seeds its own partners,
 * asserts the seed landed, and never assumes the runner supplies fixtures.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb } from "../db/connection";
import {
  listTemplatesForPartner,
  getTemplate,
  countsByCurrency,
  listApplications,
  createTemplate,
  updateTemplate,
  setArchived,
  deleteTemplate,
  applyTemplate,
  linkApplicationToSpv,
  isDuplicateNameError,
  SpvTemplateNotFoundError,
  SpvTemplateValidationError,
} from "../spvTemplateStore";
import { CARRY_FRACTION_SCALE } from "../lib/money";
import { formatMinor } from "../lib/currency";

const P_A = "w30e3_partner_a";
const P_B = "w30e3_partner_b";

function count(sql: string, ...args: unknown[]): number {
  return Number((rawDb().prepare(sql).get(...(args as any[])) as any)?.n ?? 0);
}

/** A valid baseline payload. Every negative case is this, with ONE field spoiled. */
function validInput(over: Record<string, unknown> = {}) {
  return {
    name: `W30E3 Template ${Math.random().toString(36).slice(2, 10)}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    ...over,
  } as any;
}

beforeAll(() => {
  const db: any = rawDb();
  const now = "2026-08-11T00:00:00.000Z";
  // No try/catch. A swallowed seed failure leaves an empty fixture and makes
  // every later case vacuous — the exact defect class this file exists to catch.
  const ins = db.prepare(
    `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, status, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, 'active', ?, ?)`,
  );
  ins.run(P_A, "W30E3 Partner A", now, now);
  ins.run(P_B, "W30E3 Partner B", now, now);
  expect(count(`SELECT COUNT(*) n FROM partner_organizations WHERE id IN (?, ?)`, P_A, P_B)).toBe(2);
});

describe("WAVE 30 ENGINE 3 — (0) THE SCHEMA ITSELF, before anything else", () => {
  it("(0a) the self-heal installer really created spv_template — not a vacuous pass", () => {
    // Force the memoised ensureSchema() to run via a real read.
    listTemplatesForPartner(P_A);
    // `NODE_ENV=test` builds the DB from connection.ts's inline baseline and
    // never runs migration 0177. connection.ts is SACRED, so the tables come
    // from applyWave30SpvTemplateSchema or from nowhere. If they came from
    // nowhere, the installer's fail-soft catch would have hidden it and every
    // list assertion below would trivially pass against nothing.
    for (const t of ["spv_template", "spv_template_application"]) {
      expect(
        count(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?`, t),
      ).toBe(1);
    }
  });

  it("(0b) …and the indexes came with it, including the PARTIAL unique index", () => {
    const idx = rawDb()
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='spv_template'`)
      .all() as Array<{ name: string; sql: string | null }>;
    const names = idx.map((i) => i.name);
    expect(names).toContain("ux_spv_template_partner_name");
    // Wave 28's case (15) branched on index PRESENCE rather than correctness and
    // reported a false green. Presence is not enough: this index must be PARTIAL
    // on `deleted_at IS NULL`, or a soft-deleted template would hold its name
    // hostage forever and case (14) would be asserting the wrong behaviour.
    const ux = idx.find((i) => i.name === "ux_spv_template_partner_name");
    expect(ux?.sql ?? "").toMatch(/WHERE\s+deleted_at\s+IS\s+NULL/i);
  });

  it("(0c) the CHECK constraints are on the TABLE, not merely in the store", () => {
    const sql = String(
      (rawDb()
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='spv_template'`)
        .get() as any)?.sql ?? "",
    );
    // The store validates too, but a bypassing writer must still be refused.
    expect(sql).toMatch(/carry_fraction_scaled\s*<=\s*1000000000/);
    expect(sql).toMatch(/min_check_minor\s*>=\s*0/);
  });
});

describe("WAVE 30 ENGINE 3 — create: both poles on every validator", () => {
  it("(1) POSITIVE POLE — a valid template saves and round-trips exactly", () => {
    const t = createTemplate(P_A, validInput({ name: "W30E3 Valid One" }), "u_actor");
    expect(t.id).toMatch(/^spvtpl_/);
    expect(t.partnerId).toBe(P_A);
    expect(t.jurisdiction).toBe("delaware");
    expect(t.carryBasis).toBe("whole_spv");
    expect(t.spvType).toBe("spv");
    expect(t.isArchived).toBe(false);
    expect(t.usageCount).toBe(0);
    expect(t.createdBy).toBe("u_actor");
    // And it is really in the database, not just in the returned object.
    expect(count(`SELECT COUNT(*) n FROM spv_template WHERE id = ?`, t.id)).toBe(1);
  });

  it("(2) NEGATIVE POLE — an unknown jurisdiction is refused, with the right code", () => {
    expect(() => createTemplate(P_A, validInput({ jurisdiction: "atlantis" }))).toThrow(
      SpvTemplateValidationError,
    );
    try {
      createTemplate(P_A, validInput({ jurisdiction: "atlantis" }));
      throw new Error("should not reach");
    } catch (e: any) {
      expect(e.code).toBe("INVALID_JURISDICTION");
    }
    // The point of validating here: this is the SAME predicate the SPV create
    // path uses, so a template that saves is a template that can actually be
    // launched. A saveable-but-unlaunchable template is a trap that only fires
    // when the operator is committing capital.
    expect(count(`SELECT COUNT(*) n FROM spv_template WHERE jurisdiction = 'atlantis'`)).toBe(0);
  });

  it("(3) carry basis has NO default — omitting it is refused, not guessed", () => {
    const { carryBasis, ...noBasis } = validInput();
    expect(() => createTemplate(P_A, noBasis as any)).toThrow(/Carry basis is required/i);
    // Positive pole: supplying it works. Without this half, a validator that
    // rejected every carry basis would look identical.
    expect(createTemplate(P_A, validInput({ carryBasis: "per_deployment" })).carryBasis).toBe(
      "per_deployment",
    );
  });
});

describe("WAVE 30 ENGINE 3 — MONEY", () => {
  it("(4) minor units round-trip as INTEGERS, and a fractional amount is REFUSED not rounded", () => {
    const t = createTemplate(P_A, validInput({ name: "W30E3 Money USD", currency: "usd", minCheckMinor: 2500000 }));
    expect(t.currency).toBe("USD"); // normalised, stored uppercase
    expect(t.minCheckMinor).toBe(2500000);
    expect(Number.isInteger(t.minCheckMinor)).toBe(true);
    // A fractional minor unit is not a rounding problem to be solved silently;
    // it is a caller error. Rounding a money amount without telling anyone is
    // the defect class the money rules exist to prevent.
    expect(() => createTemplate(P_A, validInput({ minCheckMinor: 100.5 }))).toThrow(/integer/i);
    expect(() => createTemplate(P_A, validInput({ minCheckMinor: -1 }))).toThrow(/negative/i);
  });

  it("(5) JPY FIXTURE — a zero-decimal currency is stored and RENDERED without /100", () => {
    // JPY has zero minor-unit decimals. 5000 JPY minor units is ¥5,000, not
    // ¥50.00. Any code that divides by 100 to render is wrong here by a factor
    // of one hundred, which is why rendering goes through formatMinor.
    const t = createTemplate(
      P_A,
      validInput({ name: "W30E3 Money JPY", currency: "JPY", minCheckMinor: 5000, targetRaiseMinor: 250000000 }),
    );
    expect(t.currency).toBe("JPY");
    expect(t.minCheckMinor).toBe(5000);

    const rendered = formatMinor(t.minCheckMinor!, "JPY");
    // The falsification: the naive `/100` render would produce "50".
    expect(rendered).not.toMatch(/\b50\b(?!0)/);
    expect(rendered).toContain("5,000");

    // And the same integer in USD renders as a HUNDREDTH of the JPY figure —
    // proving the currency, not the integer, decides the decimal placement.
    expect(formatMinor(5000, "USD")).toContain("50.00");
  });

  it("(6) NULL is not ZERO — an unset amount stays unset through a full round-trip", () => {
    const t = createTemplate(P_A, validInput({ name: "W30E3 No Min" }));
    expect(t.minCheckMinor).toBeNull();
    expect(t.targetRaiseMinor).toBeNull();
    expect(t.capMinor).toBeNull();
    // Not merely null in the DTO — null in the COLUMN. A 0 written here would
    // read back as "this deal has a minimum check of zero", a different and
    // false statement about the deal.
    expect(
      count(`SELECT COUNT(*) n FROM spv_template WHERE id = ? AND min_check_minor IS NULL`, t.id),
    ).toBe(1);

    // Opposite pole, and the one that catches a `?? null` written as `|| null`:
    // an explicit ZERO must survive as zero, not collapse into null.
    const z = createTemplate(P_A, validInput({ name: "W30E3 Zero Min", minCheckMinor: 0 }));
    expect(z.minCheckMinor).toBe(0);
    expect(z.minCheckMinor).not.toBeNull();
  });

  it("(7) NEVER SUM ACROSS CURRENCIES — the breakdown is per-currency and offers no total", () => {
    const rows = countsByCurrency(P_A);
    const byCcy = Object.fromEntries(rows.map((r) => [r.currency, r]));
    expect(Object.keys(byCcy).length).toBeGreaterThan(1); // USD and JPY both present
    expect(byCcy.JPY.templates).toBeGreaterThan(0);
    expect(byCcy.USD.templates).toBeGreaterThan(0);
    // There is deliberately no aggregate field. If one is ever added, this fails.
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["currency", "templates", "withMinCheck"]);
    }
  });

  it("(8) a cap below the target raise is refused — both poles", () => {
    expect(() =>
      createTemplate(P_A, validInput({ targetRaiseMinor: 1000, capMinor: 999 })),
    ).toThrow(/Cap cannot be below/i);
    const ok = createTemplate(P_A, validInput({ name: "W30E3 Cap OK", targetRaiseMinor: 1000, capMinor: 1000 }));
    expect(ok.capMinor).toBe(1000);
  });
});

describe("WAVE 30 ENGINE 3 — CARRY is a scaled fraction, never a percent", () => {
  it("(9) 20% carry is 200000000, and the value survives a round-trip exactly", () => {
    const twentyPct = 0.2 * CARRY_FRACTION_SCALE;
    expect(twentyPct).toBe(200000000);
    const t = createTemplate(P_A, validInput({ name: "W30E3 Carry 20", carryFractionScaled: twentyPct }));
    expect(t.carryFractionScaled).toBe(200000000);
  });

  it("(10) the Wave 5 / P-4 defect cannot recur — 20 is NOT silently read as 20%", () => {
    // Wave 5 / P-4: the wizard posted 8 for an 8% hurdle, the store read it as a
    // fraction, Math.min(1, n) clamped it, and the SPV silently acquired a 100%
    // preferred return. The forbidden repair `n > 1 ? n / 100 : n` cannot tell a
    // 1% carry written as 1 from a 100% carry written as 1, so it is not used.
    // The integer-billionths representation makes the ambiguity impossible:
    // 20 means 20 billionths and round-trips as exactly that.
    const t = createTemplate(P_A, validInput({ name: "W30E3 Carry Literal 20", carryFractionScaled: 20 }));
    expect(t.carryFractionScaled).toBe(20);
    expect(t.carryFractionScaled).not.toBe(200000000);
  });

  it("(11) out of domain REJECTS — it does not clamp", () => {
    // Clamping is what turned an 8% hurdle into 100%. An over-range carry is a
    // caller error and is reported as one.
    expect(() =>
      createTemplate(P_A, validInput({ carryFractionScaled: CARRY_FRACTION_SCALE + 1 })),
    ).toThrow(/between 0 and/i);
    expect(() => createTemplate(P_A, validInput({ carryFractionScaled: -1 }))).toThrow(/between 0 and/i);
    // Positive pole at the exact boundary: 100% carry is unusual but legal.
    expect(
      createTemplate(P_A, validInput({ name: "W30E3 Carry Max", carryFractionScaled: CARRY_FRACTION_SCALE }))
        .carryFractionScaled,
    ).toBe(CARRY_FRACTION_SCALE);
    // And nothing out-of-range reached the table.
    expect(
      count(`SELECT COUNT(*) n FROM spv_template WHERE carry_fraction_scaled > 1000000000`),
    ).toBe(0);
  });

  it("(12) the DATABASE refuses an out-of-range carry too, not only the store", () => {
    // FIX WHERE THE DATA FLOWS, second path: the store is one writer. A direct
    // INSERT must also be refused, or the guard is only as good as the callers
    // that happen to use the store.
    expect(() =>
      rawDb()
        .prepare(
          `INSERT INTO spv_template (id, tenant_id, partner_id, name, jurisdiction, carry_basis,
             currency, carry_fraction_scaled, created_at, updated_at)
           VALUES ('w30e3_direct_bad', 'tenant_platform', ?, 'direct bad', 'delaware', 'whole_spv',
             'USD', 2000000000, '2026-01-01', '2026-01-01')`,
        )
        .run(P_A),
    ).toThrow(/CHECK constraint/i);
    expect(count(`SELECT COUNT(*) n FROM spv_template WHERE id = 'w30e3_direct_bad'`)).toBe(0);
  });
});

describe("WAVE 30 ENGINE 3 — the partner boundary, both poles", () => {
  let aTemplateId = "";

  beforeAll(() => {
    aTemplateId = createTemplate(P_A, validInput({ name: "W30E3 Boundary Subject" })).id;
    createTemplate(P_B, validInput({ name: "W30E3 B Only" }));
  });

  it("(13) POSITIVE POLE — the owner can read it", () => {
    expect(getTemplate(P_A, aTemplateId).id).toBe(aTemplateId);
    expect(listTemplatesForPartner(P_A).some((t) => t.id === aTemplateId)).toBe(true);
  });

  it("(14) NEGATIVE POLE — another firm cannot, and the refusal is a 404-shaped NOT FOUND", () => {
    expect(() => getTemplate(P_B, aTemplateId)).toThrow(SpvTemplateNotFoundError);
    expect(listTemplatesForPartner(P_B).some((t) => t.id === aTemplateId)).toBe(false);
  });

  it("(15) the refusal carries NO information — identical for a real id and a fictional one", () => {
    // THE PROBE MUST MATCH THE CONTROL. The control is an AUTHORIZATION gate, so
    // the test uses a REAL-BUT-WRONG identity (partner B, a genuine partner)
    // rather than an anonymous caller. Anonymity would be refused by the auth
    // middleware and would prove nothing about the store's scoping.
    let realIdError = "";
    let fakeIdError = "";
    try {
      getTemplate(P_B, aTemplateId);
    } catch (e: any) {
      realIdError = `${e.name}|${e.code}|${e.message}`;
    }
    try {
      getTemplate(P_B, "spvtpl_does_not_exist_anywhere");
    } catch (e: any) {
      fakeIdError = `${e.name}|${e.code}|${e.message}`;
    }
    expect(realIdError).not.toBe("");
    // Byte-identical. A distinguishable error would confirm the id exists and
    // turn the endpoint into an enumeration oracle for other firms' inventories.
    expect(realIdError).toBe(fakeIdError);
  });

  it("(16) writes are partner-scoped too — B cannot edit, archive, delete or apply A's template", () => {
    for (const fn of [
      () => updateTemplate(P_B, aTemplateId, { name: "hijacked" }),
      () => setArchived(P_B, aTemplateId, true),
      () => deleteTemplate(P_B, aTemplateId),
      () => applyTemplate(P_B, aTemplateId),
    ]) {
      expect(fn).toThrow(SpvTemplateNotFoundError);
    }
    // And A's template is untouched by any of those attempts — a refusal that
    // still mutated would be the worst of both.
    const still = getTemplate(P_A, aTemplateId);
    expect(still.name).toBe("W30E3 Boundary Subject");
    expect(still.isArchived).toBe(false);
    expect(still.usageCount).toBe(0);
  });

  it("(17) B cannot read A's application history either", () => {
    expect(() => listApplications(P_B, aTemplateId)).toThrow(SpvTemplateNotFoundError);
  });
});

describe("WAVE 30 ENGINE 3 — apply: prefill, and the sign-off gate it must not bypass", () => {
  let tid = "";
  beforeAll(() => {
    tid = createTemplate(
      P_A,
      validInput({
        name: "W30E3 Apply Subject",
        currency: "JPY",
        minCheckMinor: 5000,
        carryFractionScaled: 200000000,
        distributionScope: null,
      }),
    ).id;
  });

  it("(18) apply returns the template's values as prefill", () => {
    const p = applyTemplate(P_A, tid, "u_actor");
    expect(p.templateId).toBe(tid);
    expect(p.jurisdiction).toBe("delaware");
    expect(p.currency).toBe("JPY");
    expect(p.minCheckMinor).toBe(5000);
    expect(p.carryFractionScaled).toBe(200000000);
  });

  it("(19) THE GATE — applying a template creates NO SPV", () => {
    // This is the security-relevant assertion of the whole engine. SPV creation
    // is gated by the Wave 1c launch sign-off, which records a durable attested
    // signature BEFORE the SPV row exists and fails closed if it cannot. An
    // "apply and launch" shortcut would route straight around that gate.
    const before = count(`SELECT COUNT(*) n FROM spvs`);
    const p = applyTemplate(P_A, tid, "u_actor");
    const after = count(`SELECT COUNT(*) n FROM spvs`);
    expect(after).toBe(before);
    expect(p.spvCreated).toBe(false);
  });

  it("(20) apply is LOGGED append-only, and the counter agrees with the log", () => {
    const fresh = createTemplate(P_A, validInput({ name: "W30E3 Counter Subject" })).id;
    expect(getTemplate(P_A, fresh).usageCount).toBe(0);
    expect(listApplications(P_A, fresh).length).toBe(0);

    applyTemplate(P_A, fresh, "u_actor");
    applyTemplate(P_A, fresh, "u_actor");

    const t = getTemplate(P_A, fresh);
    const apps = listApplications(P_A, fresh);
    expect(t.usageCount).toBe(2);
    // The denormalised counter is a convenience; the log is the record of truth.
    // They are written in one transaction, so they must agree. If they can
    // drift, the counter is a number nobody should trust.
    expect(apps.length).toBe(t.usageCount);
    expect(t.lastAppliedAt).not.toBeNull();
    // Not yet linked to an SPV — and that gap is itself information.
    expect(apps.every((a) => a.resultingSpvId === null)).toBe(true);
  });

  it("(21) an application can be linked to its SPV once, and never rewritten", () => {
    const fresh = createTemplate(P_A, validInput({ name: "W30E3 Link Subject" })).id;
    const p = applyTemplate(P_A, fresh, "u_actor");
    expect(linkApplicationToSpv(P_A, p.applicationId, "spv_real_one")).toBe(true);
    expect(listApplications(P_A, fresh)[0].resultingSpvId).toBe("spv_real_one");
    // Second link is refused — an audit trail that can be overwritten is not one.
    expect(linkApplicationToSpv(P_A, p.applicationId, "spv_someone_else")).toBe(false);
    expect(listApplications(P_A, fresh)[0].resultingSpvId).toBe("spv_real_one");
    // And another firm cannot link it at all.
    const p2 = applyTemplate(P_A, fresh, "u_actor");
    expect(linkApplicationToSpv(P_B, p2.applicationId, "spv_hijack")).toBe(false);
  });

  it("(22) an ARCHIVED template refuses to apply — the control is not decorative", () => {
    const fresh = createTemplate(P_A, validInput({ name: "W30E3 Archive Subject" })).id;
    // Positive pole first: it applies while live.
    expect(applyTemplate(P_A, fresh).spvCreated).toBe(false);
    setArchived(P_A, fresh, true);
    expect(() => applyTemplate(P_A, fresh)).toThrow(/archived/i);
    // Reversible, and it works again afterwards.
    setArchived(P_A, fresh, false);
    expect(applyTemplate(P_A, fresh).templateId).toBe(fresh);
  });
});

describe("WAVE 30 ENGINE 3 — archive, delete, and the partial unique index", () => {
  it("(23) archived templates leave the default list but stay reachable and countable", () => {
    const fresh = createTemplate(P_A, validInput({ name: "W30E3 Hidden When Archived" })).id;
    expect(listTemplatesForPartner(P_A).some((t) => t.id === fresh)).toBe(true);
    setArchived(P_A, fresh, true);
    expect(listTemplatesForPartner(P_A).some((t) => t.id === fresh)).toBe(false);
    // Both poles of the opt-in, and the row is NOT gone.
    expect(listTemplatesForPartner(P_A, { includeArchived: true }).some((t) => t.id === fresh)).toBe(true);
    expect(getTemplate(P_A, fresh).isArchived).toBe(true);
  });

  it("(24) a duplicate live name is refused with DUPLICATE_NAME, and a NOT NULL error cannot pose as one", () => {
    createTemplate(P_A, validInput({ name: "W30E3 Unique Name" }));
    try {
      createTemplate(P_A, validInput({ name: "W30E3 Unique Name" }));
      throw new Error("should not reach");
    } catch (e: any) {
      // Wave 28's case (15) asserted `/UNIQUE|constraint/i`, which happily
      // matched a NOT NULL error thrown on every run — the check passed while
      // checking nothing. Asserting the CODE the store maps, not the raw SQLite
      // text, makes the branch unambiguous.
      expect(e).toBeInstanceOf(SpvTemplateValidationError);
      expect(e.code).toBe("DUPLICATE_NAME");
    }

    /* And the falsification of the mapper itself. A DIFFERENT constraint
     * violation on the same table must NOT be relabelled "DUPLICATE_NAME" —
     * that mislabelling is precisely what Wave 28's loose regex did. A NOT NULL
     * violation carries SQLITE_CONSTRAINT_NOTNULL and must surface raw. */
    let raw: any;
    try {
      rawDb()
        .prepare(
          `INSERT INTO spv_template (id, tenant_id, partner_id, name, jurisdiction, carry_basis,
             currency, created_at, updated_at)
           VALUES ('w30e3_notnull_probe', 'tenant_platform', ?, NULL, 'delaware', 'whole_spv',
             'USD', '2026-01-01', '2026-01-01')`,
        )
        .run(P_A);
    } catch (e: any) {
      raw = e;
    }
    expect(raw).toBeDefined();
    expect(String(raw.code)).toBe("SQLITE_CONSTRAINT_NOTNULL");

    /* THE ASSERTION THAT ACTUALLY BINDS THE MAPPER.
     *
     * Mutation testing found this gap rather than reasoning finding it. Mutant
     * M14 replaced the mapper with Wave 28's loose `/UNIQUE|constraint/i` and
     * SURVIVED the entire harness — because no input to `createTemplate` can
     * produce a NON-unique database error (the store pre-validates every other
     * column), so the wrong branch was unreachable from outside and the earlier
     * form of this case could not see it.
     *
     * `isDuplicateNameError` was lifted out of the catch block precisely so this
     * negative pole could be asserted. Handing it the real NOT NULL error above
     * must return false: the loose pattern returns TRUE for it, which is exactly
     * the mislabelling that made Wave 28's check pass while checking nothing. */
    expect(isDuplicateNameError(raw)).toBe(false);
    // Positive pole on the same predicate, so a mapper that returned false for
    // everything would not pass either.
    let dup: any;
    try {
      createTemplate(P_A, validInput({ name: "W30E3 Unique Name" }));
    } catch {
      /* the store already mapped it; capture the RAW driver error instead */
    }
    try {
      rawDb()
        .prepare(
          `INSERT INTO spv_template (id, tenant_id, partner_id, name, jurisdiction, carry_basis,
             currency, created_at, updated_at)
           VALUES ('w30e3_dup_probe', 'tenant_platform', ?, 'W30E3 Unique Name', 'delaware',
             'whole_spv', 'USD', '2026-01-01', '2026-01-01')`,
        )
        .run(P_A);
    } catch (e: any) {
      dup = e;
    }
    expect(dup).toBeDefined();
    expect(isDuplicateNameError(dup)).toBe(true);
    // …and the SAME name is fine for a DIFFERENT partner. Without this pole a
    // globally-unique index would look identical to a per-partner one.
    expect(createTemplate(P_B, validInput({ name: "W30E3 Unique Name" })).name).toBe(
      "W30E3 Unique Name",
    );
  });

  it("(25) soft delete hides the row AND releases the name — the index is partial", () => {
    const fresh = createTemplate(P_A, validInput({ name: "W30E3 Recyclable Name" })).id;
    expect(deleteTemplate(P_A, fresh)).toBe(true);
    expect(() => getTemplate(P_A, fresh)).toThrow(SpvTemplateNotFoundError);
    expect(listTemplatesForPartner(P_A, { includeArchived: true }).some((t) => t.id === fresh)).toBe(false);
    // The row still physically exists — soft delete, not a silent drop.
    expect(count(`SELECT COUNT(*) n FROM spv_template WHERE id = ?`, fresh)).toBe(1);
    // And the name is reusable, which only holds because the unique index is
    // partial on `deleted_at IS NULL` (asserted structurally in case 0b).
    expect(createTemplate(P_A, validInput({ name: "W30E3 Recyclable Name" })).name).toBe(
      "W30E3 Recyclable Name",
    );
  });

  it("(26) update refuses an invalid field and leaves the row UNCHANGED", () => {
    const fresh = createTemplate(P_A, validInput({ name: "W30E3 Update Subject", minCheckMinor: 100 })).id;
    expect(() => updateTemplate(P_A, fresh, { jurisdiction: "atlantis" })).toThrow(
      /Unknown jurisdiction/i,
    );
    // A validator that rejected AFTER writing would be worse than none.
    const after = getTemplate(P_A, fresh);
    expect(after.jurisdiction).toBe("delaware");
    expect(after.minCheckMinor).toBe(100);
    // Positive pole: a valid partial update applies and touches nothing else.
    const upd = updateTemplate(P_A, fresh, { name: "W30E3 Update Subject v2" });
    expect(upd.name).toBe("W30E3 Update Subject v2");
    expect(upd.minCheckMinor).toBe(100);
    expect(upd.jurisdiction).toBe("delaware");
  });
});
