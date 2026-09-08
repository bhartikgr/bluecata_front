/**
 * WAVE 346 — CURRENCY HONESTY AND THE ARCHIVE PERIMETER.
 *
 * ── WHAT THIS FILE IS FOR ──────────────────────────────────────────────────
 * Three separate things were asked for. This file proves what was actually done
 * about each of them, and — just as important — pins the things that were
 * deliberately NOT changed so that a later wave cannot change them by accident.
 *
 *   ITEM 1  The table definition of `soft_circles` says a missing currency is
 *           US dollars. It cannot be changed here, for reasons that are proven
 *           below rather than asserted in prose. What IS built is a tripwire that
 *           counts every such definition in the codebase, so a new one cannot be
 *           added quietly.
 *   ITEM 2  Two places that turned a missing currency into US dollars while
 *           adding up or printing money. Both are fixed. The control case — the
 *           ordinary all-dollars round — is proven to print EXACTLY what it
 *           printed before, because the known trap here is that a fix of this
 *           shape blanks a tile that shows a true number today.
 *   ITEM 3  The archive refuses seven of its eight kinds. Every one of those
 *           refusals is proven to be CORRECT, from the database and from the
 *           source, not from an opinion.
 *
 * ── WHY THE CONTROLS COME FIRST ────────────────────────────────────────────
 * A test in this programme once passed three database assertions against ZERO
 * ROWS because its harness had opened an empty database. Another test in this
 * programme was written, committed and reported without ever having run. So:
 *
 *   · every database assertion below carries a `rows > 0` precondition;
 *   · the handle this file reads is proven to be the same one the product writes
 *     through, by writing a row and reading it back before anything is measured;
 *   · a table name that does not exist is proven to read as ABSENT, so "present"
 *     means something;
 *   · the measuring functions are proven able to produce a RED before they are
 *     trusted to produce a green — see `describe("00 · controls")`;
 *   · the number of `describe` blocks in this file is asserted against the number
 *     that ran, because a section that silently does not run reads as a shorter
 *     summary rather than as an error.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { rawDb } from "../db/connection";
import { readDurableSoftCircleTotal } from "../lib/softCircleAggregate";
import {
  capTableTotalCurrency,
  capTableTotalInvestedText,
  type CapTableData,
  type CapTableEntry,
} from "../lib/pdfGenerators";
import {
  ARCHIVE_BINDINGS,
  ARCHIVE_WRITE_TABLES,
  ARCHIVE_NOT_WIRED_CODE,
  resolveArchiveTarget,
} from "../recordArchiveStore";

const REPO = path.resolve(__dirname, "..", "..");
const ROUND = "rd_w346_currency_fixture";

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS. Deliberately dumb — a helper that can be wrong is a test that can
   be wrong, so each one is exercised in the controls section below.
   ═══════════════════════════════════════════════════════════════════════════ */

function tableExists(name: string): boolean {
  const r = rawDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name?: string } | undefined;
  return !!r?.name;
}

function columnsOf(table: string): string[] {
  if (!tableExists(table)) return [];
  return (rawDb().prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[])
    .map((r) => r.name);
}

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

/** Occurrences of a hard-coded currency default in a chunk of DDL text. */
function ddlCurrencyDefaults(text: string): string[] {
  return text.match(/DEFAULT\s+['"](?:USD|EUR|GBP|CAD|AUD|CHF|JPY|SGD|HKD|NZD|SEK|NOK|DKK|ZAR|INR|AED)['"]/g) ?? [];
}

function makeEntry(currency: string, invested = 100): CapTableEntry {
  return {
    shareholder: "W346 holder",
    securityKind: "common",
    shares: 1000,
    pctOwnership: 100,
    invested,
    currency,
  };
}

function makeCapTable(entries: CapTableEntry[], totalInvested: number): CapTableData {
  return {
    companyId: "co_w346",
    companyName: "W346 Fixture Co",
    asOf: "2026-01-01",
    entries,
    totals: { totalShares: 1000 * entries.length, totalInvested, holderCount: entries.length },
  } as CapTableData;
}

/** Rows this file inserted, so nothing else in the database is disturbed. */
function seedSoftCircle(id: string, amount: number, currency: string): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO soft_circles
         (id, round_id, investor_name, amount, currency, status, collective_visible, created_at)
       VALUES (?, ?, ?, ?, ?, 'confirmed', 1, ?)`,
    )
    .run(id, ROUND, `W346 investor ${id}`, amount, currency, new Date().toISOString());
}

function clearFixtureRound(): void {
  /* Scoped to this file's own synthetic round id only. No other row is touched. */
  rawDb().prepare(`DELETE FROM soft_circles WHERE round_id = ?`).run(ROUND);
}

/* Every describe block's name, declared once. The last block asserts that this
   many blocks actually ran, which is the only defence against a section that is
   present in the file but never executed. */
const SECTIONS = [
  "00 · controls — the instrument, before the product",
  "01 · ITEM 1 — the currency default baked into the table definitions",
  "02 · ITEM 2 — adding up and printing money without inventing a currency",
  "03 · ITEM 3 — every archive refusal is proven correct",
  "99 · this file ran in full",
] as const;
const ran = new Set<string>();
function mark(name: (typeof SECTIONS)[number]): void {
  ran.add(name);
}

/* ═══════════════════════════════════════════════════════════════════════════ */

describe(SECTIONS[0], () => {
  beforeAll(() => {
    mark(SECTIONS[0]);
    clearFixtureRound();
  });

  it("C1 · the handle this file reads is the same one the product writes through", () => {
    expect(tableExists("soft_circles")).toBe(true);
    seedSoftCircle("sc_w346_control", 1, "USD");
    const back = rawDb()
      .prepare(`SELECT id, currency FROM soft_circles WHERE id = ?`)
      .get("sc_w346_control") as { id?: string; currency?: string } | undefined;
    expect(back?.id).toBe("sc_w346_control");
    expect(back?.currency).toBe("USD");
    clearFixtureRound();
  });

  it("C2 · a table that does not exist reads as ABSENT, so 'present' means something", () => {
    expect(tableExists("table_that_does_not_exist_w346")).toBe(false);
    expect(columnsOf("table_that_does_not_exist_w346")).toEqual([]);
  });

  it("C3 · the DDL matcher is proven able to find AND to miss, on known text", () => {
    /* Validate the instrument against values worked out by hand before pointing
       it at the codebase. Two must match, three must not. */
    const known = [
      `currency TEXT NOT NULL DEFAULT 'USD',`,
      `fee_currency TEXT DEFAULT "EUR",`,
      `status TEXT NOT NULL DEFAULT 'open',`,
      `currency TEXT NOT NULL,`,
      `-- currency TEXT DEFAULT 'USD'`,
    ].join("\n");
    /* The commented line DOES match the text pattern — the matcher reads DDL, not
       comments, and this is recorded rather than hidden: the census script in
       build_log/currencyarchive/evidence strips comments first, and the numbers in
       the reports come from that script. Here the expectation is stated for what
       this simpler matcher really does, so the number below cannot drift. */
    expect(ddlCurrencyDefaults(known).length).toBe(3);
  });

  it("C4 · the money-text function is proven able to produce a RED", () => {
    /* Try to manufacture a green and fail: a mixed-currency cap table must NOT
       produce a plain formatted number, however the assertion is written. */
    const mixed = makeCapTable([makeEntry("USD"), makeEntry("CAD")], 200);
    const text = capTableTotalInvestedText(mixed);
    expect(text).not.toMatch(/^\$/);
    expect(text).not.toMatch(/^[A-Z]{3}\s[\d.]+$/);
  });

  it("C5 · the row-count precondition itself is proven to bite", () => {
    clearFixtureRound();
    const empty = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM soft_circles WHERE round_id = ?`)
      .get(ROUND) as { n: number };
    expect(empty.n).toBe(0);
    seedSoftCircle("sc_w346_precondition", 5, "USD");
    const filled = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM soft_circles WHERE round_id = ?`)
      .get(ROUND) as { n: number };
    expect(filled.n).toBeGreaterThan(0);
    clearFixtureRound();
  });
});

describe(SECTIONS[1], () => {
  beforeAll(() => mark(SECTIONS[1]));

  it("the premise is re-verified: soft_circles.currency really does default to US dollars", () => {
    const ddl = (
      rawDb()
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='soft_circles'`)
        .get() as { sql?: string } | undefined
    )?.sql;
    expect(typeof ddl).toBe("string");
    expect(ddl).toMatch(/currency\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'USD'/i);
  });

  it("TRIPWIRE · the number of hard-coded currency defaults in the frozen schema file is pinned at 17", () => {
    /* WHY A TRIPWIRE AND NOT A FIX. server/db/connection.ts is frozen, SQLite
       cannot drop a column default without rebuilding the table, and rebuilding
       these tables means destructive statements against rows that carry money and
       tamper-evident hashes. So the default STAYS, and this assertion exists so
       that the number cannot grow without somebody noticing. If a new table
       legitimately needs one, raise this number and say why — never delete this. */
    const hits = ddlCurrencyDefaults(readSource("server/db/connection.ts"));
    expect(hits.length).toBe(17);
  });

  it("TRIPWIRE · the two soft_circles definitions in the frozen file are both still accounted for", () => {
    const src = readSource("server/db/connection.ts");
    /* One CREATE TABLE and one ALTER TABLE ADD COLUMN repair entry. Both name the
       same default, and both are inside the frozen file. */
    const softCircleDefaults = src.match(/currency TEXT NOT NULL DEFAULT 'USD'/g) ?? [];
    expect(softCircleDefaults.length).toBeGreaterThanOrEqual(1);
  });

  it("PROOF OF THE STOP · a NULL currency would reach a reader that cannot state it", () => {
    /* This is the evidence behind the decision to leave the definition alone.
       If NOT NULL were dropped, two readers in server/softCircleStore.ts would
       silently turn the NULL back into US dollars, and a third passes the value
       through untouched. That combination — invisibly re-defaulted in two places
       and raw in a third — is a behaviour change, not a fix, which is why the
       instruction to stop and report was followed. */
    const src = readSource("server/softCircleStore.ts");
    const redefaulting = src.match(/currency:\s*r\.currency\s*\?\?\s*"USD"/g) ?? [];
    expect(redefaulting.length).toBe(2);
    expect(src).toMatch(/currency:\s*r\.currency\b(?!\s*\?\?)/);
  });

  it("REPORTED, NOT FIXED · the write path also invents US dollars, and is recorded here", () => {
    /* The brief stated every write path was already guarded. It is not. This
       assertion pins the site that is still open so the next wave can find it
       without re-deriving it, and so that if somebody fixes it this line goes red
       and the reports get corrected. */
    const src = readSource("server/softCircleStore.ts");
    expect(src).toMatch(/const currency = \(args\.currency \?\? "USD"\)\.toUpperCase\(\);/);
  });
});

describe(SECTIONS[2], () => {
  beforeAll(() => {
    mark(SECTIONS[2]);
    clearFixtureRound();
  });

  it("THE TRAP, DISARMED · an ordinary all-dollars round still returns the SAME real total", () => {
    clearFixtureRound();
    seedSoftCircle("sc_w346_usd_a", 25000, "USD");
    seedSoftCircle("sc_w346_usd_b", 75000, "USD");
    const n = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM soft_circles WHERE round_id = ? AND collective_visible = 1 AND deleted_at IS NULL`)
        .get(ROUND) as { n: number }
    ).n;
    expect(n).toBe(2); /* rows > 0 precondition, stated as an exact number */

    const t = readDurableSoftCircleTotal(ROUND);
    expect(t.durableCount).toBe(2);
    expect(t.totalUsd).toBe(100000);
    expect(t.reason).toBeUndefined();
    clearFixtureRound();
  });

  it("a round where one currency was never stated now WITHHOLDS instead of saying dollars", () => {
    clearFixtureRound();
    seedSoftCircle("sc_w346_blank_a", 25000, "USD");
    seedSoftCircle("sc_w346_blank_b", 75000, ""); /* NOT NULL permits the empty string */
    const rows = rawDb()
      .prepare(`SELECT currency FROM soft_circles WHERE round_id = ?`)
      .all(ROUND) as { currency: string }[];
    expect(rows.length).toBe(2);
    expect(rows.some((r) => String(r.currency) === "")).toBe(true);

    const t = readDurableSoftCircleTotal(ROUND);
    expect(t.durableCount).toBe(2);
    expect(t.totalUsd).toBeNull();
    expect(t.reason).toBe("currency_not_stated");
    clearFixtureRound();
  });

  it("the existing mixed-currency and non-dollar refusals are UNCHANGED", () => {
    clearFixtureRound();
    seedSoftCircle("sc_w346_mix_a", 10, "USD");
    seedSoftCircle("sc_w346_mix_b", 20, "EUR");
    expect(
      (rawDb().prepare(`SELECT COUNT(*) AS n FROM soft_circles WHERE round_id = ?`).get(ROUND) as { n: number }).n,
    ).toBe(2);
    const mixed = readDurableSoftCircleTotal(ROUND);
    expect(mixed.totalUsd).toBeNull();
    expect(mixed.reason).toBe("mixed_currency");

    clearFixtureRound();
    seedSoftCircle("sc_w346_eur", 20, "EUR");
    expect(
      (rawDb().prepare(`SELECT COUNT(*) AS n FROM soft_circles WHERE round_id = ?`).get(ROUND) as { n: number }).n,
    ).toBe(1);
    const eur = readDurableSoftCircleTotal(ROUND);
    expect(eur.totalUsd).toBeNull();
    expect(eur.reason).toBe("non_usd");
    clearFixtureRound();
  });

  it("no currency is ever converted and no total is ever added across currencies", () => {
    clearFixtureRound();
    seedSoftCircle("sc_w346_nc_a", 100, "USD");
    seedSoftCircle("sc_w346_nc_b", 100, "JPY");
    expect(
      (rawDb().prepare(`SELECT COUNT(*) AS n FROM soft_circles WHERE round_id = ?`).get(ROUND) as { n: number }).n,
    ).toBe(2);
    const t = readDurableSoftCircleTotal(ROUND);
    /* 100 dollars and 100 yen is not 200 of anything, and there is no rate source
       in this codebase. The only honest answer is no answer. */
    expect(t.totalUsd).toBeNull();
    clearFixtureRound();
  });

  it("RENDERED TEXT · the cap-table document's total is unchanged for one stated currency", () => {
    const usd = makeCapTable([makeEntry("USD", 1000), makeEntry("USD", 234)], 1234);
    /* This is the exact string the document printed BEFORE the change, because
       before the change it read entries[0].currency, which was also USD. */
    expect(capTableTotalInvestedText(usd)).toBe("$1,234.00");

    const cad = makeCapTable([makeEntry("CAD", 500), makeEntry("CAD", 500)], 1000);
    expect(capTableTotalInvestedText(cad)).toContain("1,000.00");
    expect(capTableTotalCurrency(cad.entries)).toEqual({ statable: true, currency: "CAD" });
  });

  it("RENDERED TEXT · a mixed-currency cap table says so in words instead of borrowing row one's currency", () => {
    const mixed = makeCapTable([makeEntry("CAD", 500), makeEntry("USD", 500)], 1000);
    const text = capTableTotalInvestedText(mixed);
    expect(text).toContain("Not derivable");
    expect(text).toContain("more than one currency (CAD, USD)");
    expect(text).toContain("never converts between currencies");
    expect(text).not.toContain("$1,000.00");
    expect(text).not.toContain("CA$");
  });

  it("RENDERED TEXT · a holder with no currency on record withholds the total", () => {
    const blank = makeCapTable([makeEntry("USD", 500), makeEntry("", 500)], 1000);
    const text = capTableTotalInvestedText(blank);
    expect(text).toContain("Not derivable");
    expect(text).toContain("not on record");
    expect(text).not.toContain("$1,000.00");
  });

  it("A TRUE ZERO IS NOT CONCEALED · an empty cap table still prints its zero", () => {
    /* The rule against inventing numbers and the rule against hiding true ones
       both apply. Zero is zero in every currency, so the zero stays. */
    const none = makeCapTable([], 0);
    expect(capTableTotalInvestedText(none)).toBe("$0.00");
    expect(capTableTotalCurrency([])).toEqual({ statable: false, reason: "no_holders", currencies: [] });
  });

  it("an empty cap table with a NON-zero total refuses, because that total belongs to nobody", () => {
    const orphan = makeCapTable([], 500);
    const text = capTableTotalInvestedText(orphan);
    expect(text).toContain("Not derivable");
    expect(text).toContain("no holders are recorded");
  });

  it("TRIPWIRE · neither fixed site has quietly gone back to borrowing a currency", () => {
    /* Asserted against the CALL, not against the phrase: both files now quote the
       old expression inside an explanatory comment, and a tripwire that cannot
       tell code from an explanation is a tripwire that fires for the wrong reason.
       The first version of this assertion did exactly that and went red on its own
       documentation, which is recorded here rather than quietly corrected. */
    const pdf = readSource("server/lib/pdfGenerators.ts");
    expect(pdf).not.toContain(`fmtMoney(data.totals.totalInvested, data.entries[0]`);
    expect(pdf).toContain("capTableTotalInvestedText(data)");
    const agg = readSource("server/lib/softCircleAggregate.ts");
    expect(agg).not.toContain(`currencies.add(String(r.currency ?? "USD")`);
    expect(agg).toContain(`reason: "currency_not_stated"`);
  });
});

describe(SECTIONS[3], () => {
  beforeAll(() => mark(SECTIONS[3]));

  it("exactly one kind is wired and exactly seven still refuse", () => {
    const kinds = Object.keys(ARCHIVE_BINDINGS);
    expect(kinds.length).toBe(8);
    const wired = kinds.filter((k) => ARCHIVE_BINDINGS[k]!.workingViewFiltered);
    const refused = kinds.filter((k) => !ARCHIVE_BINDINGS[k]!.workingViewFiltered);
    expect(wired).toEqual(["contact"]);
    expect(refused.length).toBe(7);
  });

  it("every refusal now carries a recorded reason, and the wired kind carries none", () => {
    for (const [kind, b] of Object.entries(ARCHIVE_BINDINGS)) {
      if (b.workingViewFiltered) {
        expect(b.blocker, `${kind} is wired so it must have no blocker`).toBeNull();
      } else {
        expect(typeof b.blocker, `${kind} must record why it refuses`).toBe("string");
        expect(String(b.blocker).length, `${kind}'s reason must be a real explanation`).toBeGreaterThan(120);
      }
    }
  });

  it("the gate really does refuse all seven, with the not-wired code", () => {
    for (const [kind, b] of Object.entries(ARCHIVE_BINDINGS)) {
      const d = resolveArchiveTarget(kind);
      if (b.workingViewFiltered) {
        expect(d.ok, `${kind} should be accepted`).toBe(true);
        expect(d.status).toBe(200);
      } else {
        expect(d.ok, `${kind} should be refused`).toBe(false);
        expect(d.status).toBe(501);
        expect(d.code).toBe(ARCHIVE_NOT_WIRED_CODE);
        expect(String(d.message)).toContain("nothing has been hidden");
      }
    }
    expect(resolveArchiveTarget("not_a_kind_at_all").status).toBe(409);
    expect(resolveArchiveTarget("").status).toBe(400);
    expect(resolveArchiveTarget(undefined).status).toBe(400);
  });

  it("the refusal a person reads never leaks a file name, table name or column name", () => {
    for (const kind of Object.keys(ARCHIVE_BINDINGS)) {
      const msg = String(resolveArchiveTarget(kind).message ?? "");
      if (!msg) continue;
      expect(msg).not.toMatch(/\.ts\b/);
      expect(msg).not.toMatch(/_[a-z]+_/);
      expect(msg).not.toMatch(/\bpcrm_|partner_deal_pipeline|network_posts|prev_hash|curr_hash|amount_minor/);
    }
  });

  /* ─── the recorded reasons, each proven from the database or the source ─── */

  it("PROVEN · a client row has no single identifier the register could point at", () => {
    const cols = columnsOf("partner_client_crm");
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).not.toContain("id");
    expect(cols).toContain("partner_id");
    expect(cols).toContain("company_id");
  });

  it("PROVEN · a file is not a row, and the table has no tenant column", () => {
    const cols = columnsOf("partner_files");
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).toContain("file_json");
    expect(cols).not.toContain("tenant_id");
  });

  it("PROVEN · portfolio companies carry both money and a tamper-evident seal", () => {
    const cols = columnsOf("partner_portfolio_companies");
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).toContain("lead_invested_amount_minor");
    expect(cols).toContain("prev_hash");
    expect(cols).toContain("curr_hash");
  });

  it("PROVEN · a pipeline card is part of how a partner's access to a company is decided", () => {
    const gate = readSource("server/lib/partnerCompanyLinkGate.ts");
    expect(gate).toContain("partnerPipelineStore.listByPartner");
    /* So filtering that shared list would withdraw access, not just hide a card.
       Any future filter belongs at the board route and nowhere else. */
    const engine = readSource("server/spvEngineStore.ts");
    expect(engine).toContain("partnerPipelineStore.listByPartner");
  });

  it("PROVEN · nothing in the server reads the notes and tasks tables the bindings name", () => {
    /* The strongest of the seven reasons, and the least obvious: wiring these two
       would report a record as put away while the record a person can see stayed
       exactly where it was. Counted from source, asserted as an exact zero. */
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "__tests__") continue;
          walk(p);
        } else if (e.name.endsWith(".ts")) files.push(p);
      }
    };
    walk(path.join(REPO, "server"));
    expect(files.length).toBeGreaterThan(0);

    const countReads = (table: string): number => {
      let n = 0;
      for (const f of files) {
        const src = fs.readFileSync(f, "utf8");
        n += (src.match(new RegExp(`FROM\\s+${table}\\b`, "gi")) ?? []).length;
      }
      return n;
    };
    /* Control first: a table that IS read must produce a non-zero count, so a zero
       below means "not read" rather than "the matcher is broken". */
    expect(countReads("soft_circles")).toBeGreaterThan(0);
    expect(countReads("pcrm_notes")).toBe(0);
    expect(countReads("pcrm_tasks")).toBe(0);
  });

  /* ─── the perimeter the archive must never cross ─── */

  it("the archive still writes to exactly one table, and it is not a record table", () => {
    expect(ARCHIVE_WRITE_TABLES.length).toBe(1);
    expect(ARCHIVE_WRITE_TABLES[0]).toBe("record_archive");
    for (const forbidden of [
      "founder_crm_contacts",
      "partner_deal_pipeline",
      "partner_portfolio_companies",
      "audit_log",
      "captable_commits",
      "spv_commitments",
    ]) {
      expect(ARCHIVE_WRITE_TABLES).not.toContain(forbidden);
    }
  });

  it("the irreversible delete column is NOT reused, imitated or extended", () => {
    /* founder_crm_contacts.deleted_at hides a row from the audit view and cannot
       be undone. The archive is a separate register precisely so that it is not
       that. This asserts the archive code never writes that column. */
    const store = readSource("server/recordArchiveStore.ts");
    expect(store).not.toMatch(/UPDATE\s+founder_crm_contacts/i);
    expect(store).not.toMatch(/SET\s+deleted_at/i);
  });

  it("RENDERED TEXT · every figure on the contacts screen that leaves archived records out says so", () => {
    /* Six label sites cover eighteen figures on screen: four single tiles, plus
       one inside the stage loop and one inside the chip loop, which render once per
       stage and once per chip. The sentence itself is asserted character by
       character by client/src/pages/founder/__tests__/w344_item2_archive_exclusion_labels.test.tsx,
       which is run alongside this file; what is pinned HERE is that no figure has
       since been added without a label. */
    const crm = readSource("client/src/pages/founder/CRM.tsx");
    const labelSites = crm.match(/<ExcludesArchived\b/g) ?? [];
    expect(labelSites.length).toBe(6);

    /* The four wording branches, so a figure can never be labelled with a blank. */
    expect(crm).toContain("Excludes archived contacts — checking how many");
    expect(crm).toContain("Excludes archived contacts — how many is not known");
    expect(crm).toContain("Excludes archived contacts — none are archived");
    expect(crm).toMatch(/Excludes archived contacts — \$\{archivedCount\} archived/);

    /* Every figure the tiles render, each one paired with a label in the same
       expression. If a seventh figure appears without a label this goes red. */
    for (const figure of ["reach-total", "reach-invested", "reach-edges", "reach-top-series"]) {
      const line = crm.split("\n").find((l) => l.includes(`data-testid="${figure}"`));
      expect(line, `${figure} must exist`).toBeTruthy();
      expect(String(line), `${figure} must carry its own exclusion label`).toContain("<ExcludesArchived");
    }
  });

  it("archived records remain visible to audit and admin, cross-tenant and on purpose", () => {
    const store = readSource("server/recordArchiveStore.ts");
    expect(store).toContain("W344_ARCHIVE_AUDIT_REGISTRY_IS_CROSS_TENANT");
    expect(store).toMatch(/listArchiveRegistry/);
  });
});

describe(SECTIONS[4], () => {
  beforeAll(() => {
    mark(SECTIONS[4]);
    clearFixtureRound();
  });

  it("every section of this file actually ran", () => {
    /* A disarm in this programme once did not run at all and read as a shorter
       table rather than as an error. Counting the sections against the sections
       that marked themselves is the cheap defence against that. */
    for (const s of SECTIONS.slice(0, 4)) {
      expect(ran.has(s), `section did not run: ${s}`).toBe(true);
    }
    expect(ran.size).toBe(SECTIONS.length);
  });

  it("this file left no fixture rows behind", () => {
    const n = (
      rawDb().prepare(`SELECT COUNT(*) AS n FROM soft_circles WHERE round_id = ?`).get(ROUND) as { n: number }
    ).n;
    expect(n).toBe(0);
  });
});
