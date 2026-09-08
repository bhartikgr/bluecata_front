/**
 * WAVE 344 · ITEM 2 — THE REVERSIBLE ARCHIVE.
 *
 * ── WHAT THE OWNER ASKED FOR ───────────────────────────────────────────────
 * "I do need your guidance on how I can 'archive' or remove them." He accepted
 * the recommendation NOT to delete. So this file exists to prove four things
 * about the thing that was built instead:
 *
 *   1. It PRESERVES. The row, its history and its hash anchors survive.
 *   2. It REVERSES, from the interface. An archive you cannot undo is a delete
 *      with better manners.
 *   3. It REFUSES rather than pretending. Where archiving cannot be done safely
 *      the interface says so and hides nothing.
 *   4. It NEVER TOUCHES a money row, a hash-anchored row, or an audit row.
 *
 * ── WHY THE CONTROLS COME FIRST, AND WHAT THEY ARE FOR ─────────────────────
 * A test in this programme once passed three database assertions against ZERO
 * ROWS, because its harness had opened SQLite at `:memory:` instead of `data.db`.
 *
 * READ THIS BEFORE READING THE CONTROLS, BECAUSE IT IS EASY TO MISREAD.
 * This suite ALSO runs against `:memory:`, and that is CORRECT and DELIBERATE:
 * `vitest.config.ts` pins `NODE_ENV=test` and `ENABLE_DEMO_SEED=1` precisely so
 * that every vitest worker gets a fresh isolated database instead of the shared
 * `./data.db` (the v25.20 Lane 3 test-infra isolation fix — the comment is in that
 * file). So the defect being guarded against is NOT the file name. It is
 * ASSERTING AGAINST AN EMPTY DATABASE, and it is guarded against directly:
 *
 *   · EVERY database assertion below has a `rows > 0` precondition;
 *   · the product and this test are proven to be holding the SAME database, by
 *     writing a row through a SHIPPED HTTP ROUTE and reading it back through
 *     `rawDb()` before anything else is measured — which is the property the file
 *     name was only ever a proxy for;
 *   · `founder_crm_contacts`, the table this feature acts on, is proven populated
 *     through that same handle;
 *   · the archive registry table is proven present through it;
 *   · a table name that does not exist reads as ABSENT, so "present" means
 *     something;
 *   · the table fingerprint used by the no-change assertions is proven capable of
 *     CHANGING, so "unchanged" means something too.
 *
 * WHAT THIS MEANS FOR THE 607 ROWS, STATED PLAINLY: the 607 live contacts in
 * `data.db` are NOT what these assertions read. They read seeded and
 * test-created rows in an isolated database, which is how every other suite in
 * this codebase works. The archive behaviour is what is proven here; the row
 * count of the live file is not.
 *
 * ── WHY IT DOES NOT REIMPLEMENT ANYTHING ───────────────────────────────────
 * The router is the one `registerRoutes` builds, the same call `server/index.ts`
 * makes. The fixture is created through the SHIPPED signup, company-create and
 * CRM-create routes. Archiving and restoring happen over HTTP, through the same
 * endpoints the screen calls. Nothing is stubbed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { patchConfig, getConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";

import {
  RECORD_ARCHIVE_SQL,
  RECORD_ARCHIVE_MIGRATION,
  RECORD_ARCHIVE_TABLE,
  ARCHIVABLE_ENTITY_TYPES,
} from "../lib/recordArchiveSchema";
import {
  ARCHIVE_WRITE_TABLES,
  ARCHIVE_BINDINGS,
} from "../recordArchiveStore";

const REPO = path.resolve(__dirname, "..", "..");
const CO = "co_w344_archive";
const CONTACT_NAME = "W344 archive fixture contact";

/**
 * THE TABLES THIS FEATURE IS FORBIDDEN TO TOUCH.
 *
 * Two groups, both named explicitly rather than inferred, so that if somebody
 * later widens the archive to a hash-anchored table this file goes red:
 *
 *  · HASH-ANCHORED — rewriting a row in one of these breaks a chain that the
 *    platform's own verifier walks. Three of the eight archivable KINDS point at
 *    tables in this list, which is exactly why the archive is a SEPARATE REGISTRY
 *    table and not an `ALTER TABLE ... ADD COLUMN archived_at` on each one.
 *  · MONEY — commitments, subscriptions, fees, distributions, the cap table. The
 *    brief puts these out of scope for archiving altogether.
 */
const HASH_ANCHORED_TABLES = [
  "partner_deal_pipeline",
  "partner_portfolio_companies",
  "contacts",
  "partner_crm_contacts",
  "legal_consents",
] as const;

const MONEY_AND_AUDIT_TABLES = [
  "audit_log",
  "spv_commitments",
  "spv_subscription",
  "captable_commits",
] as const;

/** The hash-chained ledger's real table name in this codebase. */
const AUDIT_TABLE = "audit_log";

let app: Express;
let server: http.Server;
let founder = "";
let contactId = "";

function tableExists(name: string): boolean {
  const r = rawDb()
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
    .get(name) as { name?: string } | undefined;
  return !!r?.name;
}

function countOf(table: string): number {
  if (!tableExists(table)) return -1;
  const r = rawDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(r.n);
}

/**
 * A content fingerprint of a whole table, ordered stably.
 *
 * A row COUNT alone would not notice a row being rewritten in place, which is the
 * failure mode that matters for a hash-anchored table: the chain breaks without
 * the count changing. This hashes every column of every row, so an in-place edit
 * is caught too.
 */
function fingerprint(table: string): string {
  if (!tableExists(table)) return "ABSENT";
  const rows = rawDb().prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
  const lines = rows
    .map((r) =>
      Object.keys(r)
        .sort()
        .map((k) => `${k}=${String(r[k])}`)
        .join("\u001f"),
    )
    .sort();
  return `${rows.length}:${crypto.createHash("sha256").update(lines.join("\u001e")).digest("hex")}`;
}

function fingerprintAll(tables: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tables) out[t] = fingerprint(t);
  return out;
}

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });

  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  _resetRateLimitsForTests();
  const su = await request(app)
    .post("/api/auth/signup")
    .send({
      email: "w344.archive@example.test",
      name: "W344 Archive Founder",
      password: "w344-archive-pw",
    });
  expect(su.status).toBe(200);
  founder = String(su.body?.ctx?.userId ?? "");
  expect(founder).not.toBe("");

  _resetRateLimitsForTests();
  const co = await request(app)
    .post("/api/founder/companies")
    .set("x-user-id", founder)
    .send({ companyId: CO, companyName: "W344 Archive Co" });
  expect(co.status).toBe(201);
  await hydrateMultiCompanyStore();

  _resetRateLimitsForTests();
  const ct = await request(app).post("/api/founder/investor-crm").set("x-user-id", founder).send({
    companyId: CO,
    name: CONTACT_NAME,
    email: "w344.archive.contact@example.test",
    stage: "prospect",
    region: "US",
  });
  expect(ct.status).toBe(200);

  /* The registry table is installed LAZILY by the shipped code path, exactly as it
     is in production (server/db/connection.ts is frozen and cannot apply a new
     migration). Reading the working list once through the SHIPPED route is what
     installs it — the test does not install its own schema, because a test that
     builds its own tables is measuring itself. */
  const warm = await request(app)
    .get(`/api/founder/investor-crm?companyId=${CO}`)
    .set("x-user-id", founder);
  expect(warm.status).toBe(200);

  const row = rawDb()
    .prepare(`SELECT id FROM founder_crm_contacts WHERE company_id = ? AND name = ?`)
    .get(CO, CONTACT_NAME) as { id?: string } | undefined;
  contactId = String(row?.id ?? "");
  expect(contactId).not.toBe("");
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

/* ══════════════════════════════════════════════════════════════════════════
   0 — THE INSTRUMENT. Validated BEFORE the product is measured.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · CONTROLS — the instrument is real before anything is measured", () => {
  it("CONTROL: the PRODUCT and this TEST hold the SAME database — written over HTTP, read back through rawDb()", () => {
    /* THE CONTROL THAT ACTUALLY MATTERS.

       A test can be pointed at a perfectly real database file and still measure
       nothing, if the running app is writing somewhere else. So rather than check
       a file name, this checks the only thing the file name was ever a proxy for:
       the contact created in `beforeAll` through the SHIPPED
       POST /api/founder/investor-crm route is READABLE HERE through `rawDb()`.

       If the app and this file were on different databases, `contactId` would be
       empty and this fails — which is the failure the zero-rows incident should
       have produced and did not. */
    expect(contactId).not.toBe("");
    const readBack = rawDb()
      .prepare(`SELECT id, name FROM founder_crm_contacts WHERE id = ?`)
      .get(contactId) as { id?: string; name?: string } | undefined;
    expect(readBack?.name).toBe(CONTACT_NAME);
  });

  it("CONTROL: the database this suite measures is REPORTED, not assumed", () => {
    /* Named out loud so nobody reading a green run infers something untrue. Both
       shapes are acceptable and which one appears is decided by the project's own
       vitest configuration, not by this file. What is NOT acceptable is an empty
       database, and that is what the rows > 0 preconditions foreclose. */
    const name = String((rawDb() as { name?: string }).name ?? "");
    expect(name).not.toBe("");
    const isIsolatedTestDb = name === ":memory:";
    const isRealFile = name.endsWith(".db") && fs.existsSync(name);
    expect(isIsolatedTestDb || isRealFile).toBe(true);
  });

  it("CONTROL: founder_crm_contacts is POPULATED through that handle — rows > 0", () => {
    // This is the precondition every assertion in section 3 depends on. The
    // handoff records 607 rows here; the assertion is > 0 rather than == 607 so
    // that this file's own fixture rows do not make it brittle, but a `:memory:`
    // handle reads 0 and fails here instead of silently passing later.
    expect(countOf("founder_crm_contacts")).toBeGreaterThan(0);
  });

  it("CONTROL: the archive registry table exists through that same handle", () => {
    expect(tableExists(RECORD_ARCHIVE_TABLE)).toBe(true);
  });

  it("CONTROL: a table that does not exist reads as ABSENT — so 'present' means something", () => {
    expect(tableExists("record_archive_that_does_not_exist")).toBe(false);
    expect(fingerprint("record_archive_that_does_not_exist")).toBe("ABSENT");
  });

  it("CONTROL: the fingerprint DISCRIMINATES — it changes when a table changes", () => {
    // Proves the no-change assertions in section 4 are capable of failing. The
    // change is made to the archive's OWN registry table, by the shipped code
    // path, and it is a change this feature is allowed to make.
    const before = fingerprint(RECORD_ARCHIVE_TABLE);
    rawDb()
      .prepare(
        `INSERT INTO ${RECORD_ARCHIVE_TABLE}
           (id, tenant_id, entity_type, record_id, state, archived_at,
            archived_by_user_id, archive_reason)
         VALUES (?, ?, 'contact', ?, 'archived', ?, 'u_w344_control',
                 'fingerprint discrimination control')`,
      )
      .run(
        "ra_w344_control",
        "tenant_co_w344_control",
        "rec_w344_control",
        new Date().toISOString(),
      );
    const after = fingerprint(RECORD_ARCHIVE_TABLE);
    expect(after).not.toBe(before);
  });

  it("CONTROL: the mail transport is inert, so this file cannot send real mail", () => {
    expect(getConfig().mode).toBe("dry_run");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1 — THE MIGRATION LIVES IN THREE PLACES AND THEY ARE BYTE-IDENTICAL.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · the migration has three homes and they agree byte for byte", () => {
  it("migrations/ and server/db/migrations/ and the embedded installer are the SAME BYTES", () => {
    const a = fs.readFileSync(path.join(REPO, "migrations", RECORD_ARCHIVE_MIGRATION), "utf8");
    const b = fs.readFileSync(
      path.join(REPO, "server", "db", "migrations", RECORD_ARCHIVE_MIGRATION),
      "utf8",
    );
    expect(a.length).toBeGreaterThan(1000);
    expect(b).toBe(a);
    // The installer exists because server/db/connection.ts is FROZEN and cannot
    // be edited to apply a new migration. If the installer drifts from the .sql
    // a fresh install and a migrated install end up with different schemas.
    expect(RECORD_ARCHIVE_SQL).toBe(a);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 — THE CLOSED SETS. Counted here, not assumed.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · the closed sets are the size they are supposed to be", () => {
  it("the archive writes to EXACTLY ONE table === 1", () => {
    // The whole safety argument rests on this. One table, owned by this feature,
    // which no chain verifier walks and no money row lives in.
    expect(ARCHIVE_WRITE_TABLES.length).toBe(1);
    expect(ARCHIVE_WRITE_TABLES[0]).toBe(RECORD_ARCHIVE_TABLE);
  });

  it("there are EXACTLY EIGHT archivable kinds === 8, matching the brief", () => {
    // contacts, pipeline cards, notes, tasks, posts, files, clients, portfolio
    // companies. Not SPVs, commitments, subscriptions, fees, distributions or
    // audit rows.
    expect(ARCHIVABLE_ENTITY_TYPES.length).toBe(8);
    expect([...ARCHIVABLE_ENTITY_TYPES].sort()).toEqual(
      ["client", "contact", "file", "note", "pipeline_card", "portfolio_company", "post", "task"].sort(),
    );
  });

  it("EXACTLY ONE kind is actually wired to a filtered working view === 1", () => {
    // Reported honestly rather than papered over: the registry accepts eight
    // kinds, and only `contact` has a working view that really filters. The other
    // seven REFUSE (section 5) instead of accepting and hiding nothing.
    const wired = Object.entries(ARCHIVE_BINDINGS).filter(
      ([, b]) => (b as { workingViewFiltered?: boolean }).workingViewFiltered === true,
    );
    expect(wired.length).toBe(1);
    expect(wired[0][0]).toBe("contact");
    expect((wired[0][1] as { table: string }).table).toBe("founder_crm_contacts");
  });

  it("NO archivable kind is bound to a hash-anchored or money table it would WRITE to", () => {
    // The bindings NAME hash-anchored tables (pipeline_card, portfolio_company),
    // which is deliberate and is why they refuse. What must never be true is that
    // the archive's WRITE set touches one.
    for (const t of ARCHIVE_WRITE_TABLES) {
      expect(HASH_ANCHORED_TABLES as readonly string[]).not.toContain(t);
      expect(MONEY_AND_AUDIT_TABLES as readonly string[]).not.toContain(t);
    }
  });

  it("EXACTLY TWO founder-CRM list handlers consume the archive filter === 2", () => {
    // Counted here rather than trusted. `applyArchiveFilter` is the only thing
    // that removes an archived contact from a list; if a THIRD list handler
    // appears without it, that list silently shows archived contacts, and if one
    // of the two loses it the same happens there.
    const src = fs.readFileSync(path.join(REPO, "server", "founderCrmStore.ts"), "utf8");
    // CALL sites only. `function applyArchiveFilter(` is the DECLARATION and is
    // subtracted explicitly — counting it would report 3 and make this a number
    // nobody could reason about.
    const all = src.split("applyArchiveFilter(").length - 1;
    const declarations = src.split("function applyArchiveFilter(").length - 1;
    expect(declarations).toBe(1);
    expect(all - declarations).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 — IT HIDES, IT PRESERVES, AND IT REVERSES — OVER HTTP.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · archive hides from the working list, preserves the row, and reverses", () => {
  it("the contact is VISIBLE in the working list before anything is archived", async () => {
    const r = await request(app)
      .get(`/api/founder/investor-crm?companyId=${CO}`)
      .set("x-user-id", founder);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toContain(CONTACT_NAME);
  }, 60_000);

  it("ARCHIVE: the contact leaves the working list — and the ROW IS STILL THERE", async () => {
    const before = countOf("founder_crm_contacts");
    expect(before).toBeGreaterThan(0); // rows > 0 precondition

    const a = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/archive`)
      .set("x-user-id", founder)
      .send({ reason: "test data from setting the platform up" });
    expect(a.status).toBe(200);
    expect(a.body?.archived).toBe(true);
    // The interface promises it can be undone. Section 3's restore proves it.
    expect(a.body?.restorable).toBe(true);

    const list = await request(app)
      .get(`/api/founder/investor-crm?companyId=${CO}`)
      .set("x-user-id", founder);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(CONTACT_NAME);

    // PRESERVED: same number of contact rows as before, and the row still reads.
    expect(countOf("founder_crm_contacts")).toBe(before);
    const still = rawDb()
      .prepare(`SELECT id, name, deleted_at FROM founder_crm_contacts WHERE id = ?`)
      .get(contactId) as { id?: string; name?: string; deleted_at?: string | null } | undefined;
    expect(still?.id).toBe(contactId);
    expect(still?.name).toBe(CONTACT_NAME);
    // THE EXISTING IRREVERSIBLE MECHANISM WAS NOT USED. `deleted_at` on this
    // table is an irreversible delete that also hides rows from audit. Archiving
    // must not have written it.
    expect(still?.deleted_at ?? null).toBeNull();
  }, 60_000);

  it("ARCHIVED BUT VISIBLE ON REQUEST: ?includeArchived=1 shows it, flagged", async () => {
    const r = await request(app)
      .get(`/api/founder/investor-crm?companyId=${CO}&includeArchived=1`)
      .set("x-user-id", founder);
    expect(r.status).toBe(200);
    const rows = (r.body?.contacts ?? r.body?.rows ?? r.body) as Array<Record<string, unknown>>;
    const found = (Array.isArray(rows) ? rows : []).find((c) => c.id === contactId);
    expect(found).toBeTruthy();
    expect(found?.archived).toBe(true);
  }, 60_000);

  it("ADMIN AND AUDIT STILL SEE IT: the archive decision is on the admin surface", async () => {
    const r = await request(app)
      .get("/api/admin/archive?entityType=contact")
      .set("x-test-user-id", "u_admin")
      .query({ as: "admin" });
    expect(r.status).toBe(200);
    const rows = (r.body?.rows ?? []) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    expect(rows.some((x) => x.record_id === contactId || x.recordId === contactId)).toBe(true);
  }, 60_000);

  it("REVERSIBLE FROM THE INTERFACE: unarchive brings it back into the working list", async () => {
    const u = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/unarchive`)
      .set("x-user-id", founder)
      .send({});
    expect(u.status).toBe(200);
    expect(u.body?.archived).toBe(false);

    const list = await request(app)
      .get(`/api/founder/investor-crm?companyId=${CO}`)
      .set("x-user-id", founder);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(CONTACT_NAME);
  }, 60_000);

  it("THE HISTORY SURVIVES THE REVERSAL: the registry still records that it was archived", () => {
    const rows = rawDb()
      .prepare(
        `SELECT state, archived_by_user_id AS archived_by, archived_at, unarchived_at
           FROM ${RECORD_ARCHIVE_TABLE} WHERE record_id = ?`,
      )
      .all(contactId) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0); // rows > 0 precondition
    const r = rows[0];
    expect(r.state).toBe("active");
    // Who archived it and when are NOT erased by restoring it. An archive that
    // forgets it happened is not a record.
    expect(String(r.archived_by ?? "")).not.toBe("");
    expect(String(r.archived_at ?? "")).not.toBe("");
    expect(String(r.unarchived_at ?? "")).not.toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 — NOTHING WITH MONEY OR A HASH IN IT MOVED.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · a full archive-and-restore cycle changes NO money or hash-anchored row", () => {
  it("every hash-anchored and money table has an IDENTICAL fingerprint across archive + restore", async () => {
    const watched = [...HASH_ANCHORED_TABLES, ...MONEY_AND_AUDIT_TABLES].filter(
      (t) => t !== AUDIT_TABLE,
    );

    // PRECONDITION: at least one watched table must actually be PRESENT, or this
    // assertion would be comparing "ABSENT" to "ABSENT" for everything and would
    // pass with no product behind it.
    const present = watched.filter((t) => tableExists(t));
    expect(present.length).toBeGreaterThan(0);

    const before = fingerprintAll(watched);

    _resetRateLimitsForTests();
    const a = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/archive`)
      .set("x-user-id", founder)
      .send({ reason: "money and hash immutability check" });
    expect(a.status).toBe(200);
    const u = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/unarchive`)
      .set("x-user-id", founder)
      .send({});
    expect(u.status).toBe(200);

    const after = fingerprintAll(watched);
    // Whole-content fingerprints, not counts: an in-place rewrite of a
    // hash-anchored row would break a chain without changing any count.
    expect(after).toEqual(before);
  }, 120_000);

  it("the audit log GREW — archiving is recorded, not silent", () => {
    // The one watched table deliberately excluded from the no-change assertion
    // above, because the archive is REQUIRED to write to it. Asserted in the
    // opposite direction so "no change anywhere" cannot be achieved by writing
    // nothing at all.
    const n = countOf(AUDIT_TABLE);
    expect(n).toBeGreaterThan(0); // rows > 0 precondition
    const mine = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM ${AUDIT_TABLE}
          WHERE action IN ('record.archive.requested','record.archived',
                           'record.unarchive.requested','record.unarchived')`,
      )
      .get() as { n: number };
    expect(Number(mine.n)).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 — WHEN IT CANNOT BE DONE SAFELY IT SAYS SO AND HIDES NOTHING.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W344 ITEM 2 · refusals — it never hides a record it cannot archive safely", () => {
  it("the DATABASE ITSELF refuses a kind the brief puts out of scope", () => {
    // Not a check in application code that a future caller could bypass: the
    // migration itself refuses it at the storage layer, so no future route,
    // script or console session can put an SPV in here either.
    const attempt = () =>
      rawDb()
        .prepare(
          `INSERT INTO ${RECORD_ARCHIVE_TABLE}
             (id, tenant_id, entity_type, record_id, state, archived_at, archived_by_user_id)
           VALUES (?, 'tenant_co_w344_refuse', 'spv', 'spv_1', 'archived', ?, 'u_w344')`,
        )
        .run("ra_w344_refuse_spv", new Date().toISOString());
    expect(attempt).toThrow();
  });

  it("an unknown kind is refused by the storage CHECK, so the allowlist is closed", () => {
    const attempt = () =>
      rawDb()
        .prepare(
          `INSERT INTO ${RECORD_ARCHIVE_TABLE}
             (id, tenant_id, entity_type, record_id, state, archived_at, archived_by_user_id)
           VALUES (?, 'tenant_co_w344_refuse', 'invented_kind', 'x1', 'archived', ?, 'u_w344')`,
        )
        .run("ra_w344_refuse_unknown", new Date().toISOString());
    expect(attempt).toThrow();
  });

  it("a registry row can NEVER be deleted — the archive cannot be used to erase its own trace", () => {
    const n = countOf(RECORD_ARCHIVE_TABLE);
    expect(n).toBeGreaterThan(0); // rows > 0 precondition
    const attempt = () =>
      rawDb().prepare(`DELETE FROM ${RECORD_ARCHIVE_TABLE} WHERE record_id = ?`).run(contactId);
    expect(attempt).toThrow();
    expect(countOf(RECORD_ARCHIVE_TABLE)).toBe(n);
  });

  it("archiving a contact that is not the caller's is refused, and the contact stays visible", async () => {
    _resetRateLimitsForTests();
    const r = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/archive`)
      .set("x-user-id", "u_aisha_patel")
      .send({ reason: "should not be allowed" });
    expect([400, 403, 404]).toContain(r.status);

    const list = await request(app)
      .get(`/api/founder/investor-crm?companyId=${CO}`)
      .set("x-user-id", founder);
    // NOT HIDDEN ANYWAY. A refusal that still hides the record is the worst
    // possible outcome, so the refusal is paired with the record still being
    // there.
    expect(JSON.stringify(list.body)).toContain(CONTACT_NAME);
  }, 60_000);

  it("restoring something that was never archived says so instead of inventing a result", async () => {
    _resetRateLimitsForTests();
    const r = await request(app)
      .post(`/api/founder/investor-crm/never_archived_w344/unarchive`)
      .set("x-user-id", founder)
      .send({});
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(String(r.body?.message ?? r.body?.error ?? "")).not.toBe("");
  }, 60_000);
});

/**
 * SECTION 6 — ADDED AFTER THE FENCE FIX, AND THIS IS WHY.
 *
 * `readRow()` was changed so that `WHERE tenant_id = ?` lives INSIDE the shared
 * SELECT constant instead of being appended at each `prepare()`. Every statement
 * built from that constant now carries the predicate — which is the point — but
 * it creates two failure modes that a lint fence CANNOT see:
 *
 *   (a) a caller that was already appending its own `WHERE tenant_id = ?` would
 *       now have it twice, producing invalid SQL;
 *   (b) a caller appending a different `WHERE` would produce invalid SQL.
 *
 * `readRow` catches its own exceptions and returns `undefined`, and both routes
 * then send `entry: out.row ?? null`. So a broken statement does NOT surface as
 * an error: it surfaces as a silently EMPTY result. That would pass every gate
 * and fail a user.
 *
 * Therefore these assert the read RETURNS A ROW, with the values it is supposed
 * to carry — never merely that nothing threw. All three call paths through
 * `readRow` are exercised:
 *   · the `by` path      (first archive of a record)      store line ~492
 *   · the by-id path     (archiving an already-archived)  store line ~442
 *   · the by-id path     (unarchive)                      store line ~615
 */
describe("W344 ITEM 2 · the tenant-scoped read RETURNS ROWS after the fence fix", () => {
  it("CONTROL: the fixture this section reads is really in the registry — rows > 0", () => {
    const n = (
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM record_archive WHERE record_id = ?`)
        .get(contactId) as { n: number }
    ).n;
    // Without this the three assertions below could all pass against nothing,
    // which is the exact defect this programme guards against.
    expect(n).toBeGreaterThan(0);
  }, 60_000);

  it("ARCHIVE returns a POPULATED row, not null — the `by` read path", async () => {
    _resetRateLimitsForTests();
    // Restore first so this exercises a fresh archive rather than the idempotent
    // branch, then archive.
    await request(app)
      .post(`/api/founder/investor-crm/${contactId}/unarchive`)
      .set("x-user-id", founder)
      .send({});
    _resetRateLimitsForTests();
    const a = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/archive`)
      .set("x-user-id", founder)
      .send({ reason: "fence-fix read path" });
    expect(a.status).toBe(200);

    const entry = a.body?.entry;
    expect(entry).not.toBeNull();          // `?? null` would mask a silent empty
    expect(entry).toBeTruthy();
    expect(entry?.recordId).toBe(contactId);
    expect(entry?.entityType).toBe("contact");
    expect(entry?.state).toBe("archived");
    expect(String(entry?.tenantId ?? "")).toBe(`tenant_co_${CO}`);
    expect(String(entry?.archivedAt ?? "")).not.toBe("");
    expect(String(entry?.id ?? "")).not.toBe("");
  }, 60_000);

  it("ARCHIVING AN ALREADY-ARCHIVED record returns a POPULATED row — the by-id read path", async () => {
    _resetRateLimitsForTests();
    const again = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/archive`)
      .set("x-user-id", founder)
      .send({ reason: "second time" });
    expect(again.status).toBe(200);
    const entry = again.body?.entry;
    expect(entry).not.toBeNull();
    expect(entry?.recordId).toBe(contactId);
    expect(entry?.state).toBe("archived");
    expect(String(entry?.tenantId ?? "")).toBe(`tenant_co_${CO}`);
  }, 60_000);

  it("UNARCHIVE returns a POPULATED row showing the reversal — the by-id read path", async () => {
    _resetRateLimitsForTests();
    const u = await request(app)
      .post(`/api/founder/investor-crm/${contactId}/unarchive`)
      .set("x-user-id", founder)
      .send({});
    expect(u.status).toBe(200);
    const entry = u.body?.entry;
    expect(entry).not.toBeNull();
    expect(entry?.recordId).toBe(contactId);
    expect(entry?.state).toBe("active");
    expect(String(entry?.tenantId ?? "")).toBe(`tenant_co_${CO}`);
    expect(String(entry?.unarchivedAt ?? "")).not.toBe("");
    // The original archive stamp is FROZEN and survives the reversal.
    expect(String(entry?.archivedAt ?? "")).not.toBe("");
  }, 60_000);

  it("THE READ IS TENANT-SCOPED: the same registry row is INVISIBLE from another tenant", () => {
    const mine = rawDb()
      .prepare(`SELECT id FROM record_archive WHERE tenant_id = ? AND record_id = ?`)
      .get(`tenant_co_${CO}`, contactId) as { id?: string } | undefined;
    expect(mine?.id).toBeTruthy();          // rows > 0 for the tenant that owns it
    const other = rawDb()
      .prepare(`SELECT id FROM record_archive WHERE tenant_id = ? AND record_id = ?`)
      .get(`tenant_co_not_this_company_w344`, contactId) as { id?: string } | undefined;
    expect(other).toBeUndefined();          // and nothing for one that does not
  }, 60_000);
});
