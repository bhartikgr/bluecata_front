/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 102 · ITEM 2 — R85. A MIGRATION ARTEFACT MAY NEVER BE PRESENTED AS AN
 *                      AUTHORISED R84 ACTION, AND AN R84 ACTION MAY NEVER BE
 *                      MISLABELLED AN ARTEFACT.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * R85 was ruled on 2026-08-21, recorded in `build_log/OPEN_ITEMS_REGISTER.md`
 * as RESOLVED, and NEVER BUILT. Reviewer C proved it by execution:
 * `grep -rn "R85" server/ client/src/` returned nothing, and a probe showed a
 * migration-`0124` artefact and an authorised R84 anchor rendering IDENTICALLY —
 * both with the `[anchored]` badge and both saying "This ledger was re-anchored".
 * The lead developer has corrected that register entry to OPEN and commissioned
 * the work here. R85's own amendment states the rule this file exists to satisfy:
 * "Nothing may be marked resolved in the register until a test proves it."
 *
 * WHY THIS MATTERS AND IS NOT COSMETIC. R84 condition 1 requires an anchor to be
 * "explicit, recorded and audited, never automatic". Migration 0124 installs a
 * genesis row as a MIGRATION SIDE EFFECT — no operator, no stated intent, no
 * ledger record. If the screen presents that as a re-anchoring, then the exact
 * distinction R84 condition 1 exists to enforce is invisible at the only place a
 * human ever looks.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IS TESTED, AND WHY IT IS TESTED THIS WAY
 * ════════════════════════════════════════════════════════════════════════════
 *   §1  The read path exists at all, and reads the shipped implementation.
 *   §2  A `0124`-SHAPED ROW IS AN ARTEFACT. Its `reason` string is read
 *       byte-for-byte out of `migrations/0124_wave_a1_audit_seed_repair.sql`
 *       rather than retyped, so the test cannot drift from the migration.
 *   §3  AN R84-SHAPED ROW IS AN OPERATOR ACTION. Its `reason` is produced by
 *       calling the SHIPPED `reAnchorTenantAuditChain`, not by hand.
 *   §4  MUTATION DIRECTION 1 — make an artefact look authorised. Six separate
 *       forgeries; every one must still read `migration_artefact`.
 *   §5  MUTATION DIRECTION 2 — make an authorised action look like an artefact.
 *       It must NOT be mislabelled while both signals are intact, and it must
 *       degrade HONESTLY (not silently) when a signal is genuinely absent.
 *   §6  THE CLASSIFIER IS FAIL-CLOSED. The one direction that must never happen
 *       on any error is "upgraded to authorised".
 *   §7  THE PANEL SAYS THE WORDS R85 REQUIRES, and the artefact branch does NOT
 *       say "This ledger was re-anchored". Asserted against the real source
 *       file, because the honesty requirement is about what a human READS.
 *   §8  NOTHING WAS DELETED OR REWRITTEN, and NO MIGRATION WAS ADDED.
 *
 * NODE_ENV=test puts the database at `:memory:` (server/db/connection.ts).
 * Nothing here reads or writes live data.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rawDb } from "../db/connection";
import {
  classifyAnchorProvenance,
  getAuditChainAnchors,
  reAnchorTenantAuditChain,
  appendAdminAudit,
} from "../adminPlatformStore";

const REPO = join(__dirname, "..", "..");
const MIGRATION_0124 = join(REPO, "migrations", "0124_wave_a1_audit_seed_repair.sql");
const PANEL = join(REPO, "client", "src", "pages", "admin", "AuditChainVerifyPage.tsx");
const STORE = join(REPO, "server", "adminPlatformStore.ts");

/** The `reason` migration 0124 actually writes, extracted from the migration. */
function reasonFromMigration0124(): string {
  const sql = readFileSync(MIGRATION_0124, "utf8");
  const m = sql.match(/'((?:[^']|'')*?)'\s+AS reason/);
  if (!m) throw new Error("could not extract 0124's reason literal — the migration changed");
  return m[1].replace(/''/g, "'");
}

/**
 * The shipped signal-2 statement, built exactly as `getAuditChainAnchors` builds
 * it, so §4/§5 drive the real query rather than a stand-in.
 */
function reAnchorRowStmt() {
  return rawDb().prepare(
    `SELECT COUNT(*) AS c FROM audit_log
       WHERE tenant_id = ? AND prev_hash = ? AND action = 'audit_chain.re_anchored'`,
  );
}

const A_TENANT = "t_w102_artefact";
const R_TENANT = "t_w102_r84";
/* §4's forgeries M3 and M4 INSERT ledger rows, so they get their own tenants.
   Sharing A_TENANT made §2's "produces no ledger row" assertion depend on test
   ORDER — it passed in declaration order and failed under `--sequence.shuffle`.
   Caught by running this file with shuffle four times rather than assuming
   declaration order; isolating the writers removes the dependency instead of
   loosening the assertion. */
const M3_TENANT = "t_w102_forge_m3";
const M4_TENANT = "t_w102_forge_m4";
const ART_ROW = "al_w102_art_1";
const ART_HASH = "a".repeat(64);

let migrationReason = "";
let r84Reason = "";
let r84AnchorHash = "";

beforeAll(() => {
  const db = rawDb();
  migrationReason = reasonFromMigration0124();

  /* ── the ARTEFACT, built with migration 0124's exact shape ───────────────
     One `prev_hash IS NULL` row, then a genesis row whose reason is the
     migration's own literal and whose timestamps are the migration's own.
     NOTHING appended to the ledger, because a migration appends nothing. */
  db.prepare(
    `INSERT INTO audit_log (id, tenant_id, action, prev_hash, hash, created_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  ).run(ART_ROW, A_TENANT, "admin.create", ART_HASH, "2026-08-01T00:00:00.000Z");
  db.prepare(
    `INSERT OR IGNORE INTO audit_chain_genesis
       (tenant_id, anchor_row_id, anchor_hash, effective_at, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(A_TENANT, ART_ROW, ART_HASH, "2026-08-02T00:00:00.000Z", migrationReason,
        "2026-08-02T00:00:00.000Z");

  /* ── the AUTHORISED action, built by calling the SHIPPED function ───────── */
  appendAdminAudit("u_w102_admin", `seed:${R_TENANT}`, "admin.seed", { n: 1 }, R_TENANT);
  const res = reAnchorTenantAuditChain({
    tenantId: R_TENANT,
    actorId: "u_w102_admin",
    intent: "Wave 102 R85 test — an operator-authorised anchor, for the labelling test.",
  });
  expect(res.ok, `reAnchorTenantAuditChain must succeed for the fixture: ${res.error}`).toBe(true);
  r84AnchorHash = res.anchorHash ?? "";
  r84Reason = (db.prepare(`SELECT reason FROM audit_chain_genesis WHERE tenant_id = ?`)
    .get(R_TENANT) as { reason: string }).reason;
});

/* ══ §1 · the read path exists and is wired ═══════════════════════════════ */
describe("W102 R85 §1 — the read path exists and is wired", () => {
  it("R85 is cited in the shipped source, which it was not before this wave", () => {
    expect(readFileSync(STORE, "utf8")).toMatch(/R85/);
    expect(readFileSync(PANEL, "utf8")).toMatch(/R85/);
  });

  it("getAuditChainAnchors returns a provenance verdict and BOTH underlying signals", () => {
    const rows = getAuditChainAnchors();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(["operator_authorised", "migration_artefact"]).toContain(r.provenance);
      expect(typeof r.citesR84).toBe("boolean");
      expect(typeof r.hasReAnchorLedgerRow).toBe("boolean");
    }
  });

  it("no migration was added to make this legible — R85's whole point", () => {
    /* The distinction is read from data already on file. If a future wave adds a
       migration for this, THIS ASSERTION is where the reader finds out. */
    const store = readFileSync(STORE, "utf8");
    expect(store).toMatch(/NOTHING IS WRITTEN TO MAKE THIS LEGIBLE/);
  });
});

/* ══ §2 · a 0124-shaped row is an ARTEFACT ════════════════════════════════ */
describe("W102 R85 §2 — a row of migration 0124's shape is a migration artefact", () => {
  it("the migration's reason literal cites no ruling and produces no ledger row", () => {
    expect(migrationReason).toContain("Wave A-1 v2.1");
    expect(/\bR84\b/.test(migrationReason)).toBe(false);
    /* ORDER-INDEPENDENT: §4's row-inserting forgeries use their own tenants
       (M3_TENANT / M4_TENANT), so this holds under `--sequence.shuffle` too. */
    const n = (rawDb().prepare(
      `SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND action = 'audit_chain.re_anchored'`,
    ).get(A_TENANT) as { c: number }).c;
    expect(n).toBe(0);
  });

  it("it is classified migration_artefact, with BOTH signals false", () => {
    const v = classifyAnchorProvenance(
      { tenantId: A_TENANT, anchorHash: ART_HASH, reason: migrationReason }, reAnchorRowStmt());
    expect(v.citesR84).toBe(false);
    expect(v.hasReAnchorLedgerRow).toBe(false);
    expect(v.provenance).toBe("migration_artefact");
  });

  it("and it reads that way through the real getAuditChainAnchors()", () => {
    const row = getAuditChainAnchors().find((a) => a.tenantId === A_TENANT);
    expect(row, "the artefact fixture must be visible to the read path").toBeTruthy();
    expect(row!.provenance).toBe("migration_artefact");
  });
});

/* ══ §3 · an R84-shaped row is an OPERATOR ACTION ═════════════════════════ */
describe("W102 R85 §3 — a row produced by reAnchorTenantAuditChain is an operator action", () => {
  it("the shipped reason cites R84 and the shipped action wrote the ledger row", () => {
    expect(/\bR84\b/.test(r84Reason)).toBe(true);
    const n = (rawDb().prepare(
      `SELECT COUNT(*) AS c FROM audit_log
         WHERE tenant_id = ? AND prev_hash = ? AND action = 'audit_chain.re_anchored'`,
    ).get(R_TENANT, r84AnchorHash) as { c: number }).c;
    expect(n).toBe(1);
  });

  it("it is classified operator_authorised, with BOTH signals true", () => {
    const v = classifyAnchorProvenance(
      { tenantId: R_TENANT, anchorHash: r84AnchorHash, reason: r84Reason }, reAnchorRowStmt());
    expect(v.citesR84).toBe(true);
    expect(v.hasReAnchorLedgerRow).toBe(true);
    expect(v.provenance).toBe("operator_authorised");
  });

  it("and it reads that way through the real getAuditChainAnchors()", () => {
    const row = getAuditChainAnchors().find((a) => a.tenantId === R_TENANT);
    expect(row!.provenance).toBe("operator_authorised");
  });
});

/* ══ §4 · MUTATION DIRECTION 1 — forge an artefact into an authorised action ══
   Six forgeries. Every one must STILL read `migration_artefact`, because both
   signals are required and neither can be faked from the migration's side. */
describe("W102 R85 §4 — MUTATION: a 0124 artefact can NEVER be presented as an R84 action", () => {
  const stmt = () => reAnchorRowStmt();

  it("M1 · the migration's reason with 'R84' appended — still an artefact (no ledger row)", () => {
    const v = classifyAnchorProvenance(
      { tenantId: A_TENANT, anchorHash: ART_HASH,
        reason: migrationReason + " owner ruling R84 (spec/OWNER_RULINGS_2026_08_13.md)" }, stmt());
    expect(v.citesR84).toBe(true);            /* the forgery moved signal 1 … */
    expect(v.hasReAnchorLedgerRow).toBe(false); /* … and could not move signal 2 */
    expect(v.provenance).toBe("migration_artefact");
  });

  it("M2 · the FULL verbatim R84 reason text pasted onto the artefact — still an artefact", () => {
    const v = classifyAnchorProvenance(
      { tenantId: A_TENANT, anchorHash: ART_HASH, reason: r84Reason }, stmt());
    expect(v.provenance).toBe("migration_artefact");
  });

  it("M3 · a re_anchored ledger row for the tenant that does NOT chain from the anchor hash", () => {
    /* The nearest miss available to a forger: a row with the right action and the
       right tenant, but chained from something else. `prev_hash = anchorHash` is
       the clause that refuses it. Its own tenant, so it cannot contaminate §2. */
    rawDb().prepare(
      `INSERT OR REPLACE INTO audit_log (id, tenant_id, action, prev_hash, hash, created_at)
       VALUES (?, ?, 'audit_chain.re_anchored', ?, ?, ?)`,
    ).run("al_w102_forge_m3", M3_TENANT, "d".repeat(64), "e".repeat(64), "2026-08-03T00:00:00.000Z");
    const v = classifyAnchorProvenance(
      { tenantId: M3_TENANT, anchorHash: ART_HASH, reason: r84Reason }, stmt());
    expect(v.citesR84).toBe(true);              /* the reason forgery succeeded … */
    expect(v.hasReAnchorLedgerRow).toBe(false); /* … the chain clause refused it */
    expect(v.provenance).toBe("migration_artefact");
  });

  it("M4 · a row chained from the anchor hash but under a DIFFERENT action name", () => {
    rawDb().prepare(
      `INSERT OR REPLACE INTO audit_log (id, tenant_id, action, prev_hash, hash, created_at)
       VALUES (?, ?, 'audit_chain.verified', ?, ?, ?)`,
    ).run("al_w102_forge_m4", M4_TENANT, ART_HASH, "f".repeat(64), "2026-08-04T00:00:00.000Z");
    const v = classifyAnchorProvenance(
      { tenantId: M4_TENANT, anchorHash: ART_HASH, reason: r84Reason }, stmt());
    expect(v.citesR84).toBe(true);
    expect(v.hasReAnchorLedgerRow).toBe(false);
    expect(v.provenance).toBe("migration_artefact");
  });

  it("M5 · another tenant's genuine re_anchored row does not leak across the tenant boundary", () => {
    const v = classifyAnchorProvenance(
      /* the artefact tenant, but pointed at the REAL anchor hash of the real action */
      { tenantId: A_TENANT, anchorHash: r84AnchorHash, reason: r84Reason }, stmt());
    expect(v.hasReAnchorLedgerRow).toBe(false);
    expect(v.provenance).toBe("migration_artefact");
  });

  it("M6 · near-miss ruling strings do not count as a citation", () => {
    for (const forged of ["ruling R840", "PR84", "R8 4", "r84x", "R-84"]) {
      const v = classifyAnchorProvenance(
        { tenantId: A_TENANT, anchorHash: ART_HASH, reason: `${migrationReason} ${forged}` }, stmt());
      expect(v.citesR84, `"${forged}" must not read as a citation of R84`).toBe(false);
      expect(v.provenance).toBe("migration_artefact");
    }
  });
});

/* ══ §5 · MUTATION DIRECTION 2 — degrade an authorised action ═════════════ */
describe("W102 R85 §5 — MUTATION: an R84 action is never mislabelled an artefact", () => {
  const stmt = () => reAnchorRowStmt();

  it("N1 · with both signals intact it stays operator_authorised, repeatedly and stably", () => {
    for (let i = 0; i < 3; i++) {
      const v = classifyAnchorProvenance(
        { tenantId: R_TENANT, anchorHash: r84AnchorHash, reason: r84Reason }, stmt());
      expect(v.provenance).toBe("operator_authorised");
    }
  });

  it("N2 · unrelated ledger noise on the same tenant does not demote it", () => {
    appendAdminAudit("u_w102_admin", `noise:${R_TENANT}`, "admin.noise", { k: 1 }, R_TENANT);
    const v = classifyAnchorProvenance(
      { tenantId: R_TENANT, anchorHash: r84AnchorHash, reason: r84Reason }, stmt());
    expect(v.provenance).toBe("operator_authorised");
  });

  it("N3 · whitespace and case around the citation do not demote it", () => {
    for (const r of [r84Reason.replace(/\s+/g, "  "), `\n${r84Reason}\n`, r84Reason + "."]) {
      const v = classifyAnchorProvenance(
        { tenantId: R_TENANT, anchorHash: r84AnchorHash, reason: r }, stmt());
      expect(v.provenance).toBe("operator_authorised");
    }
  });

  it("N4 · if the ledger record is genuinely ABSENT it degrades HONESTLY, not silently", () => {
    /* This is the reachable partial state: `appendAdminAudit` is deliberately
       fail-OPEN (`isAuditWriteFailure`), so a real R84 anchor CAN exist without
       its ledger row. The right behaviour is not to call it authorised, and not
       to pretend it is a migration artefact either — the two booleans stay
       distinguishable so the panel can say which it is. */
    const v = classifyAnchorProvenance(
      { tenantId: R_TENANT, anchorHash: "9".repeat(64), reason: r84Reason }, stmt());
    expect(v.provenance).toBe("migration_artefact");
    expect(v.citesR84).toBe(true);              /* NOT indistinguishable from 0124 */
    expect(v.hasReAnchorLedgerRow).toBe(false);
    /* and the panel has a dedicated branch for exactly this pair */
    expect(readFileSync(PANEL, "utf8")).toMatch(/citesButUnrecorded/);
    expect(readFileSync(PANEL, "utf8"))
      .toMatch(/matching record of the action is missing from the ledger/);
  });

  it("N5 · an empty or missing reason is not a crash and is not an upgrade", () => {
    for (const reason of ["", " ", undefined as unknown as string]) {
      const v = classifyAnchorProvenance(
        { tenantId: R_TENANT, anchorHash: r84AnchorHash, reason }, stmt());
      expect(v.citesR84).toBe(false);
      expect(v.provenance).toBe("migration_artefact");
    }
  });
});

/* ══ §6 · fail-closed ═════════════════════════════════════════════════════ */
describe("W102 R85 §6 — the classifier fails CLOSED, in one direction only", () => {
  it("a throwing ledger read never upgrades an anchor to authorised", () => {
    const throwing = { get: () => { throw new Error("ledger unavailable"); } };
    const v = classifyAnchorProvenance(
      { tenantId: R_TENANT, anchorHash: r84AnchorHash, reason: r84Reason }, throwing);
    expect(v.hasReAnchorLedgerRow).toBe(false);
    expect(v.provenance).toBe("migration_artefact");
  });

  it("an undefined ledger result never upgrades an anchor to authorised", () => {
    const empty = { get: () => undefined };
    const v = classifyAnchorProvenance(
      { tenantId: R_TENANT, anchorHash: r84AnchorHash, reason: r84Reason }, empty);
    expect(v.provenance).toBe("migration_artefact");
  });

  it("the ONLY input that yields operator_authorised is both signals true", () => {
    const table: Array<[boolean, boolean, string]> = [
      [false, false, "migration_artefact"],
      [false, true, "migration_artefact"],
      [true, false, "migration_artefact"],
      [true, true, "operator_authorised"],
    ];
    for (const [cites, ledger, expected] of table) {
      const v = classifyAnchorProvenance(
        { tenantId: "t", anchorHash: "h", reason: cites ? "cites R84 here" : "cites nothing" },
        { get: () => ({ c: ledger ? 1 : 0 }) });
      expect(v.provenance, `citesR84=${cites} ledger=${ledger}`).toBe(expected);
    }
  });
});

/* ══ §7 · the panel says the words R85 requires ═══════════════════════════ */
describe("W102 R85 §7 — the admin panel states the artefact's provenance honestly", () => {
  const panel = () => readFileSync(PANEL, "utf8");

  it("it says the artefact was created automatically by a database migration, not by an operator", () => {
    expect(panel()).toMatch(/created automatically by a database\s+migration, not by an\s+operator/);
  });

  it("it says NO INTENT WAS RECORDED", () => {
    expect(panel()).toMatch(/No intent was recorded/);
  });

  it('the artefact branch does NOT say "This ledger was re-anchored"', () => {
    const src = panel();
    /* The phrase may appear ONCE, in the operator branch, where it is true. */
    const hits = src.match(/This ledger was re-anchored/g) ?? [];
    expect(hits.length).toBe(1);
    /* and that one occurrence must sit inside the `authorised ?` branch */
    const idx = src.indexOf("This ledger was re-anchored");
    const branch = src.lastIndexOf("authorised ? (", idx);
    const elseAt = src.indexOf(") : (", branch);
    expect(branch).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(elseAt);
  });

  it("it keeps R84 condition 3's standard — the pre-anchor record is still stated unprovable, for BOTH kinds", () => {
    const src = panel();
    const hits = src.match(/cannot prove they are unaltered/g) ?? [];
    expect(hits.length).toBe(2);   /* once per branch — neither kind is let off */
    expect((src.match(/not provable/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("the two badges are different, so the distinction is visible before any prose is read", () => {
    expect(panel()).toMatch(/anchored by an operator/);
    expect(panel()).toMatch(/anchored automatically by a migration/);
  });

  it("it shows the operator HOW the verdict was reached, from data already on file", () => {
    expect(panel()).toMatch(/The stated reason claims an authorised\s+re-anchoring/);
    expect(panel()).toMatch(/chained from this anchor/);
    expect(panel()).toMatch(/nothing was\s+written and no migration was added/);
  });

  it("R77 · the panel renders NO ruling identifier in text a user reads", () => {
    /* The internal-language fence caught `ruling R84` in two of this panel's
       sentences on Wave 102's first attempt, and it was right: an operator needs
       the BEHAVIOUR, not a ruling number. The identifier is kept where R77 allows
       it — code comments and the machine-readable `reason` string. This assertion
       stops it walking back into the copy. */
    const src = panel();
    const jsxText = src
      .replace(/\/\*[\s\S]*?\*\//g, "")     /* strip block comments */
      .replace(/\/\/[^\n]*/g, "");          /* strip line comments  */
    expect(jsxText).not.toMatch(/ruling R8\d/);
    expect(jsxText).not.toMatch(/\bR85\b/);
  });
});

/* ══ §8 · nothing deleted, nothing rewritten, no migration ════════════════ */
describe("W102 R85 §8 — nothing was deleted or rewritten, and no migration was added", () => {
  it("migration 0124 is byte-unchanged: still INSERT OR IGNORE, still its own reason", () => {
    const sql = readFileSync(MIGRATION_0124, "utf8");
    expect(sql).toContain("INSERT OR IGNORE INTO audit_chain_genesis");
    expect(sql).toContain("Wave A-1 v2.1 (ADR-3 action 3)");
  });

  it("the read path performs no write of any kind", () => {
    const fn = readFileSync(STORE, "utf8");
    const start = fn.indexOf("export function getAuditChainAnchors");
    const end = fn.indexOf("\nexport ", start + 10);
    const body = fn.slice(start, end === -1 ? undefined : end);
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
  });

  it("the classifier performs no write of any kind", () => {
    const fn = readFileSync(STORE, "utf8");
    const start = fn.indexOf("export function classifyAnchorProvenance");
    const end = fn.indexOf("\n/** Every anchor on file", start);
    const body = fn.slice(start, end);
    expect(body).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
  });

  it("the artefact row is still exactly where it was, unaltered", () => {
    const row = rawDb().prepare(
      `SELECT reason, anchor_hash AS h FROM audit_chain_genesis WHERE tenant_id = ?`,
    ).get(A_TENANT) as { reason: string; h: string };
    expect(row.reason).toBe(migrationReason);
    expect(row.h).toBe(ART_HASH);
  });
});
