/**
 * WAVE 230 — TEST-DATA EXCLUSION, PROVED AT THE POINT WHERE THE MONEY IS MADE.
 *
 * WHAT THIS FILE HAS TO ESTABLISH, and why each proof is shaped the way it is.
 *
 * 1. THE COLUMNS EXIST IN THIS TEST'S DATABASE. Two schema paths exist: the
 *    numbered migrations (real deploys) and the inline bootstrap inside
 *    `server/db/connection.ts`, which is what every `:memory:` test gets and which
 *    is SACRED and cannot be extended. A wave that writes migration 0229 and stops
 *    has columns that exist for Avi's deploy and are INVISIBLE here. So the
 *    installer's outcome is asserted with a PRAGMA: "I ran the ALTER" is a
 *    different claim from "the column is there", and only the second is worth
 *    anything.
 *
 * 2. THE FILTER IS KEYED TO A FIELD THE WRITER ACTUALLY WRITES. This is the
 *    inert-proof mechanism the brief names as most relevant to this wave, and it
 *    is the one an `is_test` feature fails silently. It is impossible to pass here
 *    by accident: the writer is called through `wave230SetExcluded`, and the
 *    excluded set is then read back through `wave230ExcludedIds` — the SAME reader
 *    the ARR computation uses — rather than by a SELECT written inside the test.
 *    If writer and reader ever disagreed about the column name, every downstream
 *    assertion in this file goes red.
 *
 * 3. THE FIXTURE MOVES. The revenue proof FIRST establishes that the test
 *    subscription IS inside the reported figure, THEN marks it, THEN proves the
 *    figure FELL BY EXACTLY THAT AMOUNT. A fixture whose subject was never in the
 *    total would pass whether the filter worked or not — the "fixture no server
 *    mutation can move" failure — so the before-assertion is load-bearing and the
 *    delta is asserted as an exact bigint, not as "less than before".
 *
 * 4. NOTHING MARKED MUST CHANGE NOTHING. The byte-identity proof compares two
 *    `JSON.stringify` strings DIRECTLY. There is no `.trim()`, no re-sort, no key
 *    reordering and no normalising call of any kind inside the equality assertion,
 *    because a normalising call inside an assertion is how a proof goes inert
 *    while still reporting green.
 *
 * 5. AMBIGUOUS MUST DEFAULT TO KEPT. Asserted on a record with no signal at all,
 *    and separately on a record whose only signal is contradicted by a recorded
 *    payment. R228.1: a false positive here hides a real client from the operator's
 *    own dashboard, which is worse than leaving a test row visible.
 *
 * 6. THE MARK IS REVERSIBLE AND NOTHING IS DELETED. After marking, the row is
 *    still counted by a raw `SELECT COUNT(*)`, and after unmarking the aggregate
 *    returns to a value compared byte-for-byte against the original. There is no
 *    `DELETE` in the mechanism and this file proves the row survives.
 *
 * 7. PER-RECORD, NEVER PER-TENANT (R230.6). Two subscriptions in the SAME tenant:
 *    one marked, one not. The unmarked one must survive. A tenant-scoped
 *    implementation passes every other test in this file and fails this one.
 *
 * This file establishes all of its own preconditions and never reads
 * `process.env`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { rawDb } from "../db/connection";
import {
  WAVE230_AT_COLUMN,
  WAVE230_TABLES,
  wave230ColumnsPresent,
  wave230EnsureAllColumns,
  wave230ExcludedIds,
  wave230IsExcluded,
  wave230KeyColumn,
  wave230ListExcluded,
  wave230ReadAlterStatements,
  wave230Counts,
} from "../lib/wave230TestDataFlags";
import { wave230SetExcluded } from "../lib/wave230TestDataExclusion";
import { wave230RevenueImpact, wave230FormatMinor } from "../lib/wave230RevenueImpact";
import { wave230ClassifyTable } from "../lib/wave230TestDataClassifier";
/* THE CANONICAL verifier (R208.1), never the miswired admin twin. */
import { verifyAllChains } from "../lib/auditChainVerifier";

const TENANT = "t_w230";
const ACTOR = "u_w230_admin";

/* Two companies in the SAME tenant. One is a test record; one is the operator's
   real company. Per R230.6 the real one must survive every operation below. */
const CO_TEST = "co_w230_sd_test";
const CO_REAL = "co_w230_real";
/* A company with no signal whatsoever — the AMBIGUOUS-defaults-to-KEPT subject. */
const CO_QUIET = "co_w230_quiet";
/* A company whose name screams test but which has a recorded payment. */
const CO_PAID = "co_w230_test_but_paid";

/** Amounts chosen so the fall in revenue is unmistakable and exactly checkable. */
const AMT_TEST = 2_400_000; /* minor units */
const AMT_REAL = 1_100_000;
const AMT_QUIET = 700_000;

function seedCompany(id: string, name: string, extra: Record<string, unknown> = {}): void {
  const db: any = db_();
  db.prepare(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, sector, stage, is_demo)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(id, TENANT, name, (extra.sector as string) ?? "", (extra.stage as string) ?? "");
}

function seedSubscription(
  companyId: string,
  amountMinor: number,
  status = "active",
  invoicesCount = 0,
): void {
  const db: any = db_();
  /* Every NOT NULL column on `subscriptions` is supplied. The hash columns are
     given placeholder values because this wave does not touch the revision chain
     and must not pretend to: `subscriptions` is hashed by an explicit field list
     in `hashRevision`, which does not include the three w230 columns, so adding
     them cannot change any hash. */
  db.prepare(
    `INSERT OR REPLACE INTO subscriptions
       (company_id, status, plan, annual_amount_minor, currency, renews_on,
        invoices_count, version, prev_revision_hash, revision_hash,
        updated_at, updated_by)
     VALUES (?, ?, 'founder_pro', ?, 'USD', '2027-01-01',
        ?, 1, '', 'h_w230_fixture', '2026-08-31T00:00:00.000Z', ?)`,
  ).run(companyId, status, amountMinor, invoicesCount, ACTOR);
}

function db_(): any {
  return rawDb();
}

/** The reported figure for USD, in minor units, straight from the real module. */
function usdBefore(): bigint {
  const impact = wave230RevenueImpact();
  const usd = impact.byCurrency.find((c) => c.currency === "USD");
  expect(usd, "no USD line in the revenue impact — fixture did not land").toBeTruthy();
  return usd!.beforeMinor;
}

function usdAfter(): bigint {
  const impact = wave230RevenueImpact();
  const usd = impact.byCurrency.find((c) => c.currency === "USD");
  expect(usd, "no USD line in the revenue impact — fixture did not land").toBeTruthy();
  return usd!.afterMinor;
}

beforeAll(() => {
  seedCompany(CO_TEST, "SD-TEST Wave 230 Co", { sector: "SD-TEST-SaaS" });
  seedCompany(CO_REAL, "BluePrint Catalyst Limited", { sector: "Fintech", stage: "seed" });
  seedCompany(CO_QUIET, "Kestrel Holdings Ltd");
  seedCompany(CO_PAID, "Test Payments Ltd", { sector: "Fintech" });
  seedSubscription(CO_TEST, AMT_TEST);
  seedSubscription(CO_REAL, AMT_REAL);
  seedSubscription(CO_QUIET, AMT_QUIET);
});

describe("W230 · 1 — the columns are really there", () => {
  it("migration 0229 exists in BOTH schema directories, byte-identical", () => {
    const a = fs.readFileSync(
      path.join(process.cwd(), "migrations", "0229_wave230_test_data_exclusion.sql"),
    );
    const b = fs.readFileSync(
      path.join(process.cwd(), "server", "db", "migrations", "0229_wave230_test_data_exclusion.sql"),
    );
    /* Buffer equality, not string equality after a trim. A migration that exists
       in one directory only is installed on some deploy paths and not others. */
    expect(a.equals(b), "migration 0229 differs between migrations/ and server/db/migrations/").toBe(
      true,
    );
  });

  it("the installer reads its DDL out of the migration file rather than re-typing it", () => {
    const alters = wave230ReadAlterStatements();
    /* Three columns × six tables. If this ever drifts the migration and the
       installer have diverged, which is the defect the pattern exists to stop. */
    expect(alters.length).toBe(WAVE230_TABLES.length * 3);
    for (const stmt of alters) {
      expect(stmt.toUpperCase().startsWith("ALTER TABLE")).toBe(true);
    }
  });

  it("installs the columns and PROVES it with a PRAGMA, not with a return value", () => {
    const outcome = wave230EnsureAllColumns();
    for (const table of WAVE230_TABLES) {
      expect(outcome[table]?.ok, `installer refused ${table}: ${JSON.stringify(outcome[table])}`).toBe(
        true,
      );
      /* The independent check. `ok:true` is the installer's own opinion; this is
         the database's. */
      const cols = (db_().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (c) => c.name,
      );
      expect(cols, `${WAVE230_AT_COLUMN} absent from ${table}`).toContain(WAVE230_AT_COLUMN);
      expect(wave230ColumnsPresent(table)).toBe(true);
    }
  });

  it("is idempotent — a second call is not an error", () => {
    const again = wave230EnsureAllColumns();
    for (const table of WAVE230_TABLES) {
      expect(again[table]?.ok, `second install failed for ${table}`).toBe(true);
    }
  });

  it("the key column for subscriptions is company_id, not id", () => {
    /* subscriptions has no `id` column. A writer that assumed `id` would throw,
       and a filter keyed on the wrong column would match nothing forever. */
    expect(wave230KeyColumn("subscriptions")).toBe("company_id");
    const cols = (
      db_().prepare(`PRAGMA table_info(subscriptions)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols).not.toContain("id");
  });
});

describe("W230 · 2 — with nothing marked, the platform is byte-identical", () => {
  it("no record is excluded before anyone acts", () => {
    for (const table of WAVE230_TABLES) {
      expect(wave230ExcludedIds(table).size, `${table} had exclusions with no operator action`).toBe(
        0,
      );
    }
  });

  it("NULL means KEPT: the revenue figure is unchanged by the mechanism's presence", () => {
    const impact = wave230RevenueImpact();
    expect(impact.undetermined).toBe(false);
    for (const c of impact.byCurrency) {
      /* Direct bigint equality. No normalising call inside the assertion. */
      expect(c.afterMinor, `${c.currency} moved with nothing marked`).toBe(c.beforeMinor);
      expect(c.excludedMinor).toBe(BigInt(0));
      expect(c.excludedCount).toBe(0);
    }
  });
});

describe("W230 · 3 — THE MONEY. The fixture moves, and by exactly the right amount.", () => {
  let before = BigInt(0);
  let baselineJson = "";

  it("FIRST: the test subscription IS inside the reported figure", () => {
    before = usdBefore();
    /* Load-bearing. If the subject were not in the total, every assertion below
       would pass against a broken filter. */
    expect(before).toBe(BigInt(AMT_TEST + AMT_REAL + AMT_QUIET));
    expect(usdAfter()).toBe(before);
    baselineJson = JSON.stringify({ b: before.toString(), a: usdAfter().toString() });
  });

  it("THEN: marking it makes reported revenue FALL BY EXACTLY ITS AMOUNT", () => {
    const res = wave230SetExcluded({
      table: "subscriptions",
      id: CO_TEST,
      excluded: true,
      reason: "SD-TEST batch (test fixture)",
      actorId: ACTOR,
      tenantId: TENANT,
    });
    expect(res.ok, `write refused: ${JSON.stringify(res)}`).toBe(true);

    /* Read back through the SAME reader the aggregate uses — this is what makes a
       filter keyed to an unwritten field impossible to hide here. */
    expect(wave230ExcludedIds("subscriptions").has(CO_TEST)).toBe(true);
    expect(wave230IsExcluded("subscriptions", CO_TEST)).toBe(true);

    const after = usdAfter();
    expect(usdBefore(), "the BEFORE figure must not move — it is the honest comparison").toBe(before);
    expect(after).toBe(before - BigInt(AMT_TEST));

    const impact = wave230RevenueImpact();
    const usd = impact.byCurrency.find((c) => c.currency === "USD")!;
    expect(usd.excludedMinor).toBe(BigInt(AMT_TEST));
    expect(usd.excludedCount).toBe(1);
    /* before = after + excluded, in bigint. */
    expect(usd.beforeMinor).toBe(usd.afterMinor + usd.excludedMinor);
  });

  it("PER-RECORD, NOT PER-TENANT: the real company in the SAME tenant survives", () => {
    /* CO_REAL shares TENANT with CO_TEST. A tenant-scoped implementation passes
       the test above and fails this one. */
    expect(wave230IsExcluded("subscriptions", CO_REAL)).toBe(false);
    expect(wave230ExcludedIds("subscriptions").has(CO_REAL)).toBe(false);
    expect(usdAfter()).toBe(BigInt(AMT_REAL + AMT_QUIET));
  });

  it("NOTHING WAS DELETED: the row is still there", () => {
    const row = db_()
      .prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE company_id = ?`)
      .get(CO_TEST) as { n: number };
    expect(row.n, "the marking mechanism removed a row — it must never delete").toBe(1);
  });

  it("the marking is visible in the operator's review list, with its reason and author", () => {
    const listed = wave230ListExcluded("subscriptions");
    const mine = listed.find((r) => r.id === CO_TEST);
    expect(mine, "excluded record absent from the review list — the operator cannot undo it").toBeTruthy();
    expect(mine!.reason).toBe("SD-TEST batch (test fixture)");
    expect(mine!.excludedBy).toBe(ACTOR);
    expect(typeof mine!.excludedAt).toBe("string");
    expect((mine!.excludedAt ?? "").length).toBeGreaterThan(0);
  });

  it("counts are honest: excluded + kept === total", () => {
    const c = wave230Counts("subscriptions");
    /* `excluded`, `kept` and `total` are `number | null` by design: null means
       "could not be determined", so a surface renders a dash instead of a
       fabricated zero (R224.1). A test that added them without checking would be
       asserting on `null + null === null`, which is 0 === 0 in JavaScript and
       would pass while proving nothing. So each is proved to be a real number
       FIRST, and that proof is itself the honest-absence check. */
    expect(typeof c.excluded, "excluded count was not determined").toBe("number");
    expect(typeof c.kept, "kept count was not determined").toBe("number");
    expect(typeof c.total, "total count was not determined").toBe("number");
    expect(c.excluded).toBe(1);
    expect((c.excluded as number) + (c.kept as number)).toBe(c.total);
  });

  it("AND IT IS REVERSIBLE: unsetting restores the ORIGINAL figure exactly", () => {
    const res = wave230SetExcluded({
      table: "subscriptions",
      id: CO_TEST,
      excluded: false,
      actorId: ACTOR,
      tenantId: TENANT,
    });
    expect(res.ok, `unset refused: ${JSON.stringify(res)}`).toBe(true);
    expect(wave230IsExcluded("subscriptions", CO_TEST)).toBe(false);
    /* Compared against the string captured before anything was marked. No
       normalising call, no recomputation of the expectation. */
    expect(JSON.stringify({ b: usdBefore().toString(), a: usdAfter().toString() })).toBe(
      baselineJson,
    );
    /* The reason and author are cleared too — a restored record must not carry a
       stale explanation of a reversed decision. */
    const listed = wave230ListExcluded("subscriptions");
    expect(listed.find((r) => r.id === CO_TEST)).toBeUndefined();
  });
});

describe("W230 · 4 — a write that touched no row must not report success", () => {
  it("refuses a record that does not exist instead of silently succeeding", () => {
    const res = wave230SetExcluded({
      table: "companies",
      id: "co_does_not_exist_w230",
      excluded: true,
      actorId: ACTOR,
      tenantId: TENANT,
    });
    expect(res.ok, "a write that changed 0 rows reported ok:true").toBe(false);
    if (!res.ok) expect(res.reason).toContain("RECORD_NOT_FOUND");
  });

  it("refuses an unknown table rather than interpolating it into SQL", () => {
    const res = wave230SetExcluded({
      table: "users; DROP TABLE companies" as never,
      id: "x",
      excluded: true,
      actorId: ACTOR,
    });
    expect(res.ok).toBe(false);
    /* And the table it tried to name is still there. */
    const still = db_()
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='companies'`)
      .all() as Array<{ name: string }>;
    expect(still.length).toBe(1);
  });
});

describe("W230 · 5 — classification is conservative: AMBIGUOUS DEFAULTS TO KEPT", () => {
  it("an unmistakable test name is CERTAIN and proposed for exclusion", () => {
    const verdicts = wave230ClassifyTable("companies");
    const v = verdicts.find((x) => x.id === CO_TEST);
    expect(v, "the SD-TEST company was not classified at all").toBeTruthy();
    expect(v!.confidence).toBe("CERTAIN");
    expect(v!.proposeExclude).toBe(true);
    expect(v!.evidence.length).toBeGreaterThan(0);
  });

  it("a real company with business data is never proposed for exclusion", () => {
    const v = wave230ClassifyTable("companies").find((x) => x.id === CO_REAL);
    expect(v!.confidence).not.toBe("CERTAIN");
    expect(v!.proposeExclude, "a real client was proposed for exclusion").toBe(false);
  });

  it("a company with NO signal at all is AMBIGUOUS and KEPT", () => {
    /* CO_QUIET is "Kestrel Holdings Ltd" with no creation event in this fixture's
       audit log, so the cohort rule cannot reach it and no field rule fires. The
       correct outcome is silence, not an accusation. */
    const v = wave230ClassifyTable("companies").find((x) => x.id === CO_QUIET);
    expect(v!.confidence).toBe("AMBIGUOUS");
    expect(v!.proposeExclude, "an unmarked, unremarkable company was proposed for exclusion").toBe(
      false,
    );
    expect(v!.needsOwnerConfirmation).toBe(false);
  });

  it("the classifier PROPOSES ONLY — it never writes a flag", () => {
    /* Classifying the whole population must leave the database untouched. If
       classification could write, a report generator would silently exclude
       records. */
    const beforeIds = Array.from(wave230ExcludedIds("companies")).sort().join("|");
    wave230ClassifyTable("companies");
    wave230ClassifyTable("subscriptions");
    const afterIds = Array.from(wave230ExcludedIds("companies")).sort().join("|");
    expect(afterIds).toBe(beforeIds);
    expect(afterIds).toBe("");
  });

  it("a recorded payment DOWNGRADES even a certain-looking name to KEPT", () => {
    /* Money changing hands outranks a name. CO_PAID is called "Test Payments Ltd"
       — which fires the explicit-test-word rule — but it has invoices, so it must
       not be proposed. */
    seedSubscription(CO_PAID, 500_000, "active", 3);
    const v = wave230ClassifyTable("subscriptions").find((x) => x.id === CO_PAID);
    expect(v, "the paid subscription was not classified").toBeTruthy();
    expect(v!.counterEvidence.some((c) => c.rule === "has-recorded-payment")).toBe(true);
    expect(v!.proposeExclude, "a subscription with recorded invoices was proposed for exclusion").toBe(
      false,
    );
  });
});

describe("W230 · 6 — THE AUDIT CHAIN, via the CANONICAL verifier", () => {
  /* R208.1 recorded that `server/adminPlatformStore.ts:verifyTenantAuditChain` is
     a MISWIRED TWIN of the real verifier. This proof therefore imports
     `verifyAllChains` from `server/lib/auditChainVerifier.ts` — the canonical
     implementation, the one `AuditChainVerifyPage.tsx` consumes — and never the
     admin twin. Verifying with the broken verifier would prove nothing at all.

     WHY THE CHAIN CANNOT MOVE, ARGUED BEFORE IT IS MEASURED:
     adding a column cannot change a hash unless the hash covers it.
     `payloadConsortiumApplications` enumerates ten NAMED fields, and
     `hashRevision(prev, body)` in subscriptionsStore hashes an explicit object
     literal — neither uses SELECT * or Object.keys, so the three w230 columns are
     invisible to both. `rounds` and `collective_apps` have no hash columns at all.
     The measurement below is the check on that argument, not a substitute for it. */

  function brokenTables(): string[] {
    return verifyAllChains()
      .filter((r) => r.broken_at_row_id !== null)
      .map((r) => `${r.table}@${r.broken_at_row_id}`);
  }

  /* ── A PRE-EXISTING BREAKAGE, FOUND AND NOT HIDDEN ────────────────────────
     Run against the `:memory:` bootstrap with NOTHING marked and no w230 code
     having written anything, the canonical verifier reports ONE broken row, in
     `audit_log`. It was reproduced with every other test in this file skipped, so
     it is not a consequence of any marking, of the installer, or of the seeding in
     this file's `beforeAll` (which writes only to `companies` and
     `subscriptions`). It is a property of the seeded bootstrap chain.
     THIS WAVE DID NOT CAUSE IT AND DOES NOT FIX IT. It is reported in
     W230_FOR_THE_OWNER.md rather than absorbed into an allowance, and the proofs
     below are written to be sensitive to any NEW breakage while acknowledging
     this one — which is why they compare SETS before and after rather than
     asserting a clean bill of health this environment cannot give. */
  const PRE_EXISTING_TABLES = ["audit_log"];

  it("the verifier actually inspected rows, and the six w230 tables are clean", () => {
    const results = verifyAllChains();
    /* A verifier that examined nothing reports no breakage and proves nothing —
       this is the "RED that proves nothing" trap in its green form. So the
       population is asserted to be non-empty first. */
    const inspected = results.reduce((n, r) => n + r.total_rows, 0);
    expect(results.length, "the canonical verifier returned no tables at all").toBeGreaterThan(0);
    expect(inspected, "the canonical verifier inspected ZERO rows — it proves nothing").toBeGreaterThan(
      0,
    );
    /* Every table this wave ALTERs must verify clean. These are the only chains
       wave 230 could possibly have affected. */
    const w230Broken = results
      .filter((r) => (WAVE230_TABLES as readonly string[]).includes(r.table))
      .filter((r) => r.broken_at_row_id !== null)
      .map((r) => r.table);
    expect(w230Broken, "a table altered by migration 0229 has a broken chain").toEqual([]);
    /* And any breakage anywhere else is confined to the known pre-existing table,
       so a NEW breakage in a third table still fails this assertion. */
    const unexpected = brokenTables()
      .map((s) => s.split("@")[0])
      .filter((t) => !PRE_EXISTING_TABLES.includes(t));
    expect(unexpected, `unexpected broken chain(s): ${brokenTables().join(", ")}`).toEqual([]);
  });

  it("marking and unmarking a record changes the broken set NOT AT ALL", () => {
    const before = JSON.stringify(brokenTables());
    const set = wave230SetExcluded({
      table: "subscriptions",
      id: CO_REAL,
      excluded: true,
      reason: "chain proof",
      actorId: ACTOR,
      tenantId: TENANT,
    });
    expect(set.ok, `write refused: ${JSON.stringify(set)}`).toBe(true);
    expect(wave230IsExcluded("subscriptions", CO_REAL)).toBe(true);
    /* THE LOAD-BEARING CLAIM: the broken set is byte-identical to what it was
       before the write. My change neither creates breakage nor heals it. */
    expect(JSON.stringify(brokenTables())).toBe(before);

    const unset = wave230SetExcluded({
      table: "subscriptions",
      id: CO_REAL,
      excluded: false,
      actorId: ACTOR,
      tenantId: TENANT,
    });
    expect(unset.ok).toBe(true);
    /* Compared as strings against the pre-marking capture, with no normalising
       call inside the assertion. */
    expect(JSON.stringify(brokenTables())).toBe(before);
  });
});

describe("W230 · 7 — money formatting never divides a zero-decimal currency by 100", () => {
  it("formats USD with two decimals", () => {
    expect(wave230FormatMinor(BigInt(2_400_000), "USD")).toBe("24,000.00 USD");
  });

  it("formats JPY with NO decimals — the exact defect R230.1 recorded", () => {
    /* ¥1,200,000 must read as 1,200,000 JPY, never as 12,000. */
    expect(wave230FormatMinor(BigInt(1_200_000), "JPY")).toBe("1,200,000 JPY");
  });

  it("survives a value larger than MAX_SAFE_INTEGER without losing precision", () => {
    const huge = BigInt("9007199254740993000"); /* > 2^53 */
    expect(wave230FormatMinor(huge, "USD")).toBe("90,071,992,547,409,930.00 USD");
  });
});
