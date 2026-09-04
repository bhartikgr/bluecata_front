#!/usr/bin/env node
/**
 * WAVE 315 — READ-ONLY CROSS-TENANT SNAPSHOT CONTAMINATION AUDIT.
 *
 * WHAT THE OPERATOR RUNS
 * ----------------------
 *     node scripts/audit/snapshot_contamination_audit.mjs --db /path/to/app.db
 *
 * or, equivalently, `npm run audit:snapshot-contamination -- --db /path/to/app.db`.
 * Add `--json <file>` to also write a machine-readable copy. Nothing else is
 * required, and nothing needs to be stopped: the file is opened READ-ONLY.
 *
 * WHY IT EXISTS
 * -------------
 * Wave 313 proved that the closed cross-tenant analytics leak was NOT read-only.
 * `snapshotInvestor` (server/wave9ReportingStore.ts) called `buildInvestorMetrics`
 * without a tenant, so `listCashflows({ lpId })` returned that investor's cash
 * flows on EVERY tenant, and the resulting totals were WRITTEN into a
 * `portfolio_metric_snapshot` row stamped with ONE tenant id. Wave 313 stops new
 * corruption. It does not clean rows already on disk. This audit is how you find
 * out whether any exist.
 *
 * ABSOLUTE CONSTRAINTS, AND HOW THEY ARE ENFORCED RATHER THAN PROMISED
 * -------------------------------------------------------------------
 *   · The database is opened with better-sqlite3 `{ readonly: true, fileMustExist:
 *     true }`. SQLite itself then refuses any write; a mistake in this file
 *     becomes an error, not a mutation.
 *   · Every statement this file issues is routed through `q()`, which REJECTS any
 *     SQL that is not a bare SELECT/PRAGMA and rejects the words INSERT, UPDATE,
 *     DELETE, DROP, ALTER, CREATE, REPLACE, ATTACH, VACUUM, REINDEX and PRAGMA
 *     writable_schema. The refusal is proved by `--selftest`, which shows the
 *     guard actually biting on a DELETE.
 *   · No remediation is offered, suggested by flag, or performed.
 *
 * HOW IT DECIDES — AND WHERE ITS CERTAINTY STOPS
 * ---------------------------------------------
 * The audit has ONE arithmetic handle it can trust, and it is careful to claim
 * nothing beyond it.
 *
 * EVERY SUM HERE IS SINGLE-CURRENCY (R262), AND THAT IS NOT A STYLE POINT —
 * THE FIRST VERSION OF THIS FILE GOT IT WRONG AND THE FIXTURE CAUGHT IT.
 * v1 computed the all-tenant total as a bare `SUM(amount_minor)` with no currency
 * predicate. On the known-contaminated fixture that added a EUR 5,000.00 flow to
 * USD minor units, produced 1,897,654 — a figure denominated in nothing — and so
 * the stored 1,397,654 matched neither total and the row came back UNDETERMINED
 * instead of CONTAMINATED. A currency-blind sum did not merely offend a rule, it
 * MADE THE DETECTOR MISS A KNOWN POSITIVE. The miss is preserved at
 * build_log/wave315/artefacts/audit_contaminated.MISS_v1.txt. Every ledger sum in
 * this file now carries `AND UPPER(TRIM(currency)) = ?`, bound to the currency the
 * snapshot row itself is stamped with, and flows in other currencies are COUNTED
 * AND NAMED but never added in.
 *
 * `distributed_minor` on a snapshot row is, by construction, the sum of the
 * POSITIVE (distribution-type) rows of `vehicle_cashflow` for that investor —
 * positions contribute only negative, contribution-type flows
 * (server/wave9ReportingStore.ts, `flows` is built from positions as
 * `capital_call_investment` with a negated amount; distributions enter only via
 * `listCashflows`). So for a row on tenant T for investor S the audit computes
 * two independent sums out of the ledger:
 *
 *     D_own = distributions for S ON TENANT T,      in the row's currency
 *     D_all = distributions for S ON EVERY TENANT, in the row's currency
 *
 * and compares the STORED figure with both. Verdicts:
 *
 *   CONTAMINATED   stored == D_all AND D_all != D_own. The stored figure equals
 *                  the multi-tenant sum and does not equal this tenant's own
 *                  sum. That is arithmetic, not inference.
 *   CLEAN          stored == D_own. The figure reconciles to this tenant's own
 *                  ledger alone.
 *   UNDETERMINED   stored matches neither sum. The ledger has moved since
 *                  `generated_at`, or the row predates rows that were later
 *                  added or corrected. THE AUDIT DOES NOT GUESS. It says so.
 *
 * A row is additionally reported as EXPOSED when D_all != D_own, i.e. this
 * investor genuinely has cash flows on more than one tenant, because that is the
 * precondition for the defect. A CLEAN verdict on an EXPOSED subject is a
 * stronger result than a CLEAN verdict where no cross-tenant data exists at all.
 *
 * THE ABSENT-ROW SUBTLETY (from the wave 313 handoff — read this)
 * --------------------------------------------------------------
 * `snapshotInvestor` REFUSES to write when the ledger it summed spans more than
 * one currency. Before the fix that test ran on the CROSS-TENANT ledger. So an
 * investor whose OWN books are single-currency, but who has a foreign-currency
 * flow on a NEIGHBOURING tenant, would have had the write refused: the
 * contamination shows up as a snapshot row that is MISSING, not as a snapshot row
 * that is wrong. Wrong rows can be recomputed from a row; missing rows cannot be
 * found by examining rows. The audit therefore looks for the CONDITION
 * (own-currency count == 1 while cross-tenant currency count > 1) and reports
 * those subjects as ABSENT-ROW RISK, separately, and says plainly that it cannot
 * tell a refused month from a month that was simply never scheduled.
 *
 * WHAT THIS AUDIT CANNOT DO. Stated up front, not buried.
 *   1. It cannot audit `contributed_minor`, `residual_value_minor`, `dpi`,
 *      `rvpi`, `tvpi`, `pic_multiple`, `net_irr` or `gross_irr` with certainty.
 *      Those depend on marks and on position rows as they stood at
 *      `generated_at`; marks go stale and are overridable, so today's inputs are
 *      not the inputs that produced the row. Reconstructing them would be a
 *      guess dressed as a check. They are reported as NOT AUDITABLE.
 *   2. It cannot see deleted ledger rows. If the contaminating rows were removed,
 *      a contaminated snapshot now reads as UNDETERMINED, not CLEAN — the audit
 *      is built so that missing evidence degrades to "undetermined", never to
 *      "clean".
 *   3. It cannot detect contamination for a snapshot whose subject has no
 *      surviving cash flows at all: there is nothing to reconcile against. Those
 *      are counted as NOT AUDITABLE, not as clean.
 *   4. It says nothing about non-investor subjects (`spv`, `fund`, `platform`),
 *      whose figures are not built by the path wave 313 fixed. They are listed
 *      and excluded.
 *   5. R264.3, IN BOTH DIRECTIONS. `UserContext` carries no `tenantId` field, so
 *      on today's builds both tenant resolvers return the literal `"default"`.
 *      That means: the defect was REAL and was PROVED over HTTP by wave 313, and
 *      the tenant column on stored rows is real; but on a single-tenant install
 *      every row carries the same tenant id, so this audit will correctly find
 *      nothing, and finding nothing there is not evidence that the defect was
 *      imaginary. It is evidence that the install had one tenant. Neither of
 *      those sentences may be dropped.
 *
 * A "no findings" result from this tool means "no contamination was PROVED by the
 * one arithmetic test available", never "the database is clean".
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

/* --- distribution / contribution type sets, copied from packages/math-fns/src/ilpa.ts
       (ILPA_DISTRIBUTION_TYPES). Kept as data so the SQL can be parameterised. --- */
const DISTRIBUTION_TYPES = [
  "distribution_income",
  "distribution_gain_loss",
  "distribution_return_of_capital_permanent",
  "distribution_return_of_capital_recallable",
  "distribution_return_of_mgmt_fees_permanent",
  "distribution_return_of_mgmt_fees_recallable",
  "distribution_return_of_excess_capital",
  "deemed_distribution",
  "in_specie_distribution",
];

const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex|begin|commit|savepoint|analyze)\b/i;

function assertReadOnlySql(sql) {
  const s = sql.trim();
  if (!/^(select|pragma|with)\b/i.test(s)) {
    throw new Error(`REFUSED: not a read statement: ${s.slice(0, 60)}`);
  }
  if (/pragma\s+writable_schema/i.test(s)) throw new Error("REFUSED: writable_schema");
  /* Strip string literals before the keyword scan so a literal like
     'distribution_income' cannot trip it, and a real DELETE cannot hide in one. */
  const bare = s.replace(/'[^']*'/g, "''");
  if (FORBIDDEN.test(bare)) {
    const w = bare.match(FORBIDDEN)[0];
    throw new Error(`REFUSED: destructive/mutating keyword "${w}" in: ${s.slice(0, 60)}`);
  }
  return s;
}

function makeQ(db) {
  return function q(sql, ...args) {
    return db.prepare(assertReadOnlySql(sql)).all(...args);
  };
}

function tableExists(q, name) {
  return q("SELECT name FROM sqlite_master WHERE type='table' AND name=?", name).length > 0;
}

/* ---------------------------------------------------------------- selftest --- */
function selftest() {
  const lines = [];
  let ok = true;
  const cases = [
    ["SELECT 1", true],
    ["PRAGMA table_info(x)", true],
    ["DELETE FROM portfolio_metric_snapshot", false],
    ["  delete from vehicle_cashflow where 1=1", false],
    ["SELECT * FROM t; DROP TABLE t", false],
    ["UPDATE vehicle_cashflow SET amount_minor=0", false],
    ["PRAGMA writable_schema=ON", false],
    ["SELECT 'distribution_income' AS x", true],
    ["SELECT 'x' AS a WHERE 1=1 -- delete", false],
  ];
  for (const [sql, shouldPass] of cases) {
    let passed;
    try {
      assertReadOnlySql(sql);
      passed = true;
    } catch {
      passed = false;
    }
    const good = passed === shouldPass;
    if (!good) ok = false;
    lines.push(`  ${good ? "ok  " : "FAIL"}  expected ${shouldPass ? "ACCEPT" : "REFUSE"}  ${JSON.stringify(sql)}`);
  }
  console.log("SELFTEST — the read-only guard, shown biting:");
  for (const l of lines) console.log(l);
  console.log(
    ok
      ? "\nSELFTEST OK: the guard accepts reads and refuses every mutation, including one hidden in a trailing comment."
      : "\nSELFTEST FAILED.",
  );
  return ok ? 0 : 1;
}

/* -------------------------------------------------------------------- audit --- */
function audit(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const q = makeQ(db);
  const out = {
    database: path.resolve(dbPath),
    ranAt: new Date().toISOString(),
    tablesPresent: {},
    rowsExamined: 0,
    contaminated: [],
    clean: [],
    undetermined: [],
    notAuditable: [],
    nonInvestorSubjects: [],
    absentRowRisk: [],
    tenantsSeen: [],
    singleTenantInstall: null,
  };

  const havePms = tableExists(q, "portfolio_metric_snapshot");
  const haveCf = tableExists(q, "vehicle_cashflow");
  out.tablesPresent = { portfolio_metric_snapshot: havePms, vehicle_cashflow: haveCf };
  if (!havePms) return out;

  const rows = q(
    `SELECT id, tenant_id, subject_kind, subject_id, period_start, currency,
            contributed_minor, distributed_minor, residual_value_minor, generated_at
       FROM portfolio_metric_snapshot
      ORDER BY tenant_id, subject_id, period_start`,
  );
  out.rowsExamined = rows.length;
  out.tenantsSeen = [...new Set(rows.map((r) => r.tenant_id))].sort();

  if (haveCf) {
    const cfTenants = q("SELECT DISTINCT tenant_id AS t FROM vehicle_cashflow").map((r) => r.t);
    out.tenantsSeen = [...new Set([...out.tenantsSeen, ...cfTenants])].sort();
  }
  out.singleTenantInstall = out.tenantsSeen.length <= 1;

  const ph = DISTRIBUTION_TYPES.map(() => "?").join(",");

  for (const r of rows) {
    if (r.subject_kind !== "investor") {
      out.nonInvestorSubjects.push({ id: r.id, tenant: r.tenant_id, kind: r.subject_kind, subject: r.subject_id });
      continue;
    }
    if (!haveCf) {
      out.notAuditable.push({ ...pick(r), why: "no vehicle_cashflow table: nothing to reconcile against" });
      continue;
    }
    /* R262. The snapshot row carries ONE currency code. Both totals are computed
       IN THAT CODE ONLY. Flows in any other code are counted and named below but
       never added to either total: adding them would need an exchange rate, and
       there is no FX source in this repository. */
    const cur = String(r.currency ?? "").trim().toUpperCase();
    const own = q(
      `SELECT COALESCE(SUM(amount_minor),0) AS s, COUNT(*) AS n
         FROM vehicle_cashflow
        WHERE lp_id = ? AND tenant_id = ? AND UPPER(TRIM(currency)) = ?
          AND txn_type IN (${ph})`,
      r.subject_id,
      r.tenant_id,
      cur,
      ...DISTRIBUTION_TYPES,
    )[0];
    const all = q(
      `SELECT COALESCE(SUM(amount_minor),0) AS s, COUNT(*) AS n
         FROM vehicle_cashflow
        WHERE lp_id = ? AND UPPER(TRIM(currency)) = ? AND txn_type IN (${ph})`,
      r.subject_id,
      cur,
      ...DISTRIBUTION_TYPES,
    )[0];
    /* Named, never summed. */
    const otherCurrencies = q(
      `SELECT UPPER(TRIM(currency)) AS c, COUNT(*) AS n
         FROM vehicle_cashflow
        WHERE lp_id = ? AND UPPER(TRIM(currency)) <> ? AND txn_type IN (${ph})
        GROUP BY 1 ORDER BY 1`,
      r.subject_id,
      cur,
      ...DISTRIBUTION_TYPES,
    );
    const anyOwnFlows = q(
      "SELECT COUNT(*) AS n FROM vehicle_cashflow WHERE lp_id = ? AND tenant_id = ?",
      r.subject_id,
      r.tenant_id,
    )[0].n;
    const anyFlows = q("SELECT COUNT(*) AS n FROM vehicle_cashflow WHERE lp_id = ?", r.subject_id)[0].n;

    const rec = {
      ...pick(r),
      comparisonCurrency: cur,
      otherCurrencyFlows: otherCurrencies.map((o) => `${o.n} row(s) in ${o.c}, NOT summed (no FX source)`),
      distributedStored: r.distributed_minor,
      distributedOwnTenant: own.s,
      distributedAllTenants: all.s,
      ownFlowRows: own.n,
      allFlowRows: all.n,
      exposed: all.s !== own.s || all.n !== own.n,
    };

    if (anyFlows === 0) {
      out.notAuditable.push({ ...rec, why: "this investor has no surviving vehicle_cashflow rows at all, so the stored total cannot be reconciled either way" });
      continue;
    }
    if (own.n === 0 && anyOwnFlows === 0 && r.distributed_minor !== 0) {
      /* Own tenant has NO ledger for this investor, yet a non-zero distribution
         total was persisted for it. Nothing on this tenant could have produced
         that figure. */
      out.contaminated.push({
        ...rec,
        proof:
          `no vehicle_cashflow row on tenant ${r.tenant_id} names lp_id=${r.subject_id}, yet distributed_minor=${r.distributed_minor} was stored` +
          (all.s === r.distributed_minor ? `, exactly the all-tenant total (${all.s})` : ""),
      });
      continue;
    }
    if (r.distributed_minor === all.s && all.s !== own.s) {
      out.contaminated.push({
        ...rec,
        proof: `stored ${r.distributed_minor} == all-tenant ${cur} total ${all.s} != own-tenant ${cur} total ${own.s}`,
      });
      continue;
    }
    if (r.distributed_minor === own.s) {
      out.clean.push({ ...rec, proof: `stored ${r.distributed_minor} == own-tenant total ${own.s}` });
      continue;
    }
    out.undetermined.push({
      ...rec,
      why:
        `stored ${r.distributed_minor} matches neither the own-tenant ${cur} total (${own.s}) nor the all-tenant ${cur} total (${all.s}); ` +
        `the ledger has changed since ${r.generated_at}` +
        (otherCurrencies.length
          ? `. There are also ${otherCurrencies.map((o) => `${o.n} ${o.c}`).join(", ")} flow(s) for this investor, which are NOT added in: no exchange rate source exists`
          : ""),
    });
  }

  /* ---- absent-row risk. The condition, not the absence. ---- */
  if (haveCf) {
    const pairs = q(
      "SELECT DISTINCT tenant_id AS t, lp_id AS lp FROM vehicle_cashflow WHERE lp_id IS NOT NULL",
    );
    for (const p of pairs) {
      const ownCur = q(
        "SELECT DISTINCT UPPER(TRIM(currency)) AS c FROM vehicle_cashflow WHERE lp_id = ? AND tenant_id = ?",
        p.lp,
        p.t,
      ).map((x) => x.c);
      const allCur = q(
        "SELECT DISTINCT UPPER(TRIM(currency)) AS c FROM vehicle_cashflow WHERE lp_id = ?",
        p.lp,
      ).map((x) => x.c);
      if (ownCur.length === 1 && allCur.length > 1) {
        const snaps = q(
          "SELECT COUNT(*) AS n FROM portfolio_metric_snapshot WHERE tenant_id = ? AND subject_id = ? AND subject_kind = 'investor'",
          p.t,
          p.lp,
        )[0].n;
        out.absentRowRisk.push({
          tenant: p.t,
          subject: p.lp,
          ownCurrencies: ownCur,
          allTenantCurrencies: allCur.sort(),
          snapshotRowsPresent: snaps,
        });
      }
    }
  }
  db.close();
  return out;
}

function pick(r) {
  return {
    snapshotId: r.id,
    tenant: r.tenant_id,
    subject: r.subject_id,
    periodStart: r.period_start,
    currency: r.currency,
    generatedAt: r.generated_at,
  };
}

function money(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : String(n);
}

function report(res) {
  const L = [];
  const p = (s = "") => L.push(s);
  p("==========================================================================");
  p(" CROSS-TENANT SNAPSHOT CONTAMINATION AUDIT — READ-ONLY");
  p("==========================================================================");
  p(`Database : ${res.database}`);
  p(`Run at   : ${res.ranAt}`);
  p(`Nothing was written. The file was opened read-only.`);
  p();
  if (!res.tablesPresent.portfolio_metric_snapshot) {
    p("This database has no `portfolio_metric_snapshot` table, so there are no");
    p("stored snapshot figures to audit. That is a complete answer, not a failure.");
    return { text: L.join("\n"), code: 0 };
  }
  p(`Snapshot rows examined            : ${res.rowsExamined}`);
  p(`Tenants seen in the data          : ${res.tenantsSeen.length}` + (res.tenantsSeen.length ? ` (${res.tenantsSeen.join(", ")})` : ""));
  p(`Investor rows PROVED CONTAMINATED : ${res.contaminated.length}`);
  p(`Investor rows that RECONCILE      : ${res.clean.length}`);
  p(`Investor rows UNDETERMINED        : ${res.undetermined.length}`);
  p(`Investor rows NOT AUDITABLE       : ${res.notAuditable.length}`);
  p(`Other subject kinds, not in scope : ${res.nonInvestorSubjects.length}`);
  p(`Subjects at ABSENT-ROW risk       : ${res.absentRowRisk.length}`);
  p();

  if (res.contaminated.length) {
    p("--------------------------------------------------------------------------");
    p(" FINDINGS — STORED FIGURES BUILT FROM MORE THAN ONE TENANT'S DATA");
    p("--------------------------------------------------------------------------");
    p("Each of these is arithmetic: the number saved on the row equals the total");
    p("across several tenants and does not equal this tenant's own total.");
    p();
    for (const c of res.contaminated) {
      p(`  Snapshot ${c.snapshotId}`);
      p(`    tenant ${c.tenant} · investor ${c.subject} · month ${c.periodStart} · ${c.currency}`);
      p(`    saved distributions            : ${money(c.distributedStored)} (minor units of ${c.comparisonCurrency})`);
      p(`    this tenant's own ${c.comparisonCurrency} total     : ${money(c.distributedOwnTenant)}`);
      p(`    all tenants' ${c.comparisonCurrency} total, combined: ${money(c.distributedAllTenants)}`);
      for (const o of c.otherCurrencyFlows ?? []) p(`    also present, not added in     : ${o}`);
      p(`    why this is a finding    : ${c.proof}`);
      p(`    written at               : ${c.generatedAt}`);
      p();
    }
  } else {
    p("No snapshot row was PROVED to have been built from more than one tenant's");
    p("data by the one arithmetic test this audit can trust.");
    p();
  }

  if (res.undetermined.length) {
    p("--------------------------------------------------------------------------");
    p(" UNDETERMINED — THESE ARE NOT A CLEAN BILL OF HEALTH");
    p("--------------------------------------------------------------------------");
    p("The saved total matches neither this tenant's own ledger nor the combined");
    p("ledger. Usually that means cash flows were added or corrected after the");
    p("snapshot was written. This audit will not guess which.");
    p();
    for (const u of res.undetermined) {
      p(`  Snapshot ${u.snapshotId} · tenant ${u.tenant} · investor ${u.subject} · month ${u.periodStart}`);
      p(`    ${u.why}`);
    }
    p();
  }

  if (res.notAuditable.length) {
    p("--------------------------------------------------------------------------");
    p(" NOT AUDITABLE — counted as unknown, deliberately NOT counted as clean");
    p("--------------------------------------------------------------------------");
    for (const n of res.notAuditable) {
      p(`  Snapshot ${n.snapshotId} · tenant ${n.tenant} · investor ${n.subject} · month ${n.periodStart}`);
      p(`    ${n.why}`);
    }
    p();
  }

  if (res.absentRowRisk.length) {
    p("--------------------------------------------------------------------------");
    p(" ABSENT-ROW RISK — contamination that hides as a MISSING row");
    p("--------------------------------------------------------------------------");
    p("Before the fix, the snapshot writer refused to save when the figures it had");
    p("just added up spanned more than one currency — and it was adding up other");
    p("tenants' cash flows too. So for these investors the damage may be a snapshot");
    p("that was never saved, rather than one that was saved wrongly. A missing row");
    p("cannot be found by inspecting rows, so this lists the CONDITION instead.");
    p("This audit cannot tell a refused month from a month nobody ever ran.");
    p();
    for (const a of res.absentRowRisk) {
      p(`  tenant ${a.tenant} · investor ${a.subject}`);
      p(`    own books are in        : ${a.ownCurrencies.join(", ")}`);
      p(`    across all tenants      : ${a.allTenantCurrencies.join(", ")}`);
      p(`    snapshot rows now present for this investor on this tenant: ${a.snapshotRowsPresent}`);
    }
    p();
  }

  if (res.nonInvestorSubjects.length) {
    p("--------------------------------------------------------------------------");
    p(" OUT OF SCOPE — other subject kinds");
    p("--------------------------------------------------------------------------");
    const byKind = {};
    for (const n of res.nonInvestorSubjects) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
    for (const [k, n] of Object.entries(byKind)) p(`  ${k}: ${n} row(s) — not produced by the path wave 313 fixed, so not judged here.`);
    p();
  }

  p("--------------------------------------------------------------------------");
  p(" WHAT THIS AUDIT CAN AND CANNOT TELL YOU");
  p("--------------------------------------------------------------------------");
  p(" CAN, with certainty:");
  p("   · whether a snapshot's saved DISTRIBUTIONS total equals the combined");
  p("     multi-tenant total instead of that tenant's own total.");
  p("   · whether a snapshot was saved for a tenant that has no ledger for that");
  p("     investor at all.");
  p("   · which investors are exposed to the defect because they genuinely appear");
  p("     on more than one tenant.");
  p(" CANNOT:");
  p("   · check contributed capital, current value, DPI, RVPI, TVPI, PIC or IRR.");
  p("     Those depend on valuation marks as they stood when the row was written;");
  p("     marks go stale and can be overridden, so today's inputs are not the");
  p("     inputs that produced the row. Re-deriving them would be a guess.");
  p("   · see cash-flow rows that were deleted. If the contaminating rows are");
  p("     gone, the affected snapshot appears above as UNDETERMINED. By design");
  p("     missing evidence degrades to 'undetermined', never to 'clean'.");
  p("   · find a snapshot that was never written. See ABSENT-ROW RISK above.");
  p();
  p(" ABOUT TENANTS ON THIS BUILD, stated both ways:");
  p("   The user context object carries no tenant field today, so both tenant");
  p("   resolvers currently return the single value \"default\". The defect wave 313");
  p("   fixed was real and was demonstrated over live HTTP with a two-tenant");
  p("   fixture; the tenant column on these rows is real. But on an install that");
  p("   only ever had one tenant, this audit will correctly report nothing, and");
  p("   that result means 'this install had one tenant', NOT 'the defect was");
  p("   imaginary'. Both halves of that sentence are true.");
  if (res.singleTenantInstall) {
    p();
    p(`   THIS DATABASE looks single-tenant (${res.tenantsSeen.length} tenant id seen). Read the`);
    p("   paragraph above before drawing a conclusion from a clean result.");
  }
  p();
  p("--------------------------------------------------------------------------");
  const code = res.contaminated.length > 0 ? 2 : 0;
  if (code === 2) {
    p(` RESULT: ${res.contaminated.length} contaminated snapshot row(s) found. Exit code 2.`);
    p(" This tool does not repair anything, on purpose. Send this output to the");
    p(" engineer who owns the reporting store and decide on a correction together.");
  } else {
    p(" RESULT: no contamination proved. Exit code 0.");
    p(" That is not the same sentence as 'the database is clean'. Read the two");
    p(" sections above on what this audit cannot see.");
  }
  p("--------------------------------------------------------------------------");
  return { text: L.join("\n"), code };
}

/* ---------------------------------------------------------------------- cli --- */
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--selftest")) process.exit(selftest());
  const di = argv.indexOf("--db");
  const dbPath = di >= 0 ? argv[di + 1] : process.env.DATABASE_PATH ?? process.env.SQLITE_PATH;
  if (!dbPath) {
    console.error(
      "Tell me which database to read:\n" +
        "  node scripts/audit/snapshot_contamination_audit.mjs --db /path/to/app.db\n" +
        "Optional: --json out.json  ·  --selftest (prove the read-only guard bites)",
    );
    process.exit(64);
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`No such database file: ${dbPath}\nNothing was read and nothing was written.`);
    process.exit(66);
  }
  const res = audit(dbPath);
  const r = report(res);
  console.log(r.text);
  const ji = argv.indexOf("--json");
  if (ji >= 0 && argv[ji + 1]) {
    fs.writeFileSync(argv[ji + 1], JSON.stringify(res, null, 2));
    console.log(`\n(machine-readable copy written to ${argv[ji + 1]})`);
  }
  process.exit(r.code);
}

main();
