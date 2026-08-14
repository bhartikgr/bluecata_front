/**
 * WAVE 48 — ITEM 1 (R14 money-column type floor) · ITEM 2 (R13 WAIVER-5
 * ratification) · ITEM 4 (R19 `delivered` → `transportAccepted`).
 *
 * EVERY assertion here is two-sided. The rule this file exists to respect is
 * that "a constraint that rejects everything passes a one-sided test and breaks
 * all writes": so for the money floor, a bogus value must be REFUSED **and** a
 * legitimate integer minor-unit value — including a JPY (exponent 0) fixture —
 * must still be ACCEPTED, and `NULL` must still be accepted where it honestly
 * means "not provided" (R6, and the honest-refusal work of Waves 42 and 46).
 *
 * The reproduction evidence (the same columns accepting `'not-a-number'` before
 * migration 0186) is in build_log/wave48/poles_before.txt and
 * full_coverage_before.txt; this file is the regression fence that keeps it
 * fixed.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

import {
  sendEmail,
  __setEmailTransportForTests,
  type InjectedEmailTransport,
  type EmailSendResult,
} from "../lib/emailSender";
import { currencyExponent } from "../lib/money";

const ROOT = path.resolve(__dirname, "..", "..");
const MIG = path.join(ROOT, "migrations", "0186_wave48_money_column_type_floor.sql");
const MIRROR = path.join(
  ROOT,
  "server",
  "db",
  "migrations",
  "0186_wave48_money_column_type_floor.sql",
);
const INVENTORY = path.join(
  ROOT,
  "..",
  "build_log",
  "wave48",
  "money_column_inventory.tsv",
);

/* ============================================================
 * ITEM 1 · A — the migration itself
 * ============================================================ */
describe("WAVE 48 · ITEM 1 — migration 0186 is well-formed and mirrored", () => {
  it("the mirror in server/db/migrations is BYTE-IDENTICAL to migrations/", () => {
    const a = fs.readFileSync(MIG);
    const b = fs.readFileSync(MIRROR);
    /* Compared as BYTES, not as parsed SQL: w9_migration_mirror_drift requires
       byte identity for every id >= 0068, and a "semantically equal" mirror is
       exactly the drift that check exists to catch. */
    expect(crypto.createHash("sha256").update(b).digest("hex")).toBe(
      crypto.createHash("sha256").update(a).digest("hex"),
    );
  });

  it("installs a BEFORE INSERT and a BEFORE UPDATE trigger for every inventoried column", () => {
    const sql = fs.readFileSync(MIG, "utf8");
    /* WAVE 49 · A-6B: 0186 no longer uses `CREATE TRIGGER IF NOT EXISTS` — a
       pre-existing trigger of the same NAME but a DIFFERENT BODY silently
       survived it, so the file now DROPs each trigger by exact name and
       recreates it, inside the single per-file transaction `migrate.ts`
       already wraps every migration in. These matchers are therefore parsers
       adapted to the shipped file, not relaxed assertions: `IF NOT EXISTS` is
       accepted only optionally, and the counts below are still derived from the
       inventory and still asserted in BOTH directions. */
    const ins = [...sql.matchAll(/CREATE TRIGGER (?:IF NOT EXISTS )?w48_money_typefloor_ins_/g)].length;
    const upd = [...sql.matchAll(/CREATE TRIGGER (?:IF NOT EXISTS )?w48_money_typefloor_upd_/g)].length;
    /* WAVE 49 · A-6B, STRENGTHENED: every CREATE is preceded by a DROP of the
       same name, so replaying 0186 repairs a tampered body instead of leaving
       it in place. Counted per direction so a missing DROP cannot hide behind a
       surplus one on the other side. */
    const dropIns = [...sql.matchAll(/DROP TRIGGER IF EXISTS w48_money_typefloor_ins_/g)].length;
    const dropUpd = [...sql.matchAll(/DROP TRIGGER IF EXISTS w48_money_typefloor_upd_/g)].length;
    expect(sql, "A-6B: no CREATE TRIGGER IF NOT EXISTS survives in 0186").not.toMatch(
      /CREATE TRIGGER IF NOT EXISTS w48_money_typefloor_/,
    );
    expect(dropIns, "one DROP per BEFORE INSERT floor").toBe(ins);
    expect(dropUpd, "one DROP per BEFORE UPDATE floor").toBe(upd);
    /* The column list is GENERATED from money_column_inventory.tsv (see
       build_log/wave48/gen_0186.py), so the count is derived from the measured
       inventory rather than pinned by hand here: re-pinning a number to make
       this pass would require lying in the inventory too. */
    /* The inventory covers ALL money-shaped columns, STRICT tables included.
       0186 only needs to floor the NON-STRICT ones — a STRICT table already
       refuses text at the engine level — so the expected count is derived by
       filtering on the inventory's own `strict` column rather than by a
       hand-written number. */
    const rows = fs
      .readFileSync(INVENTORY, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("table\t"))
      .map((l) => l.split("\t"));
    const inventoryCols = rows.filter((r) => r[3] === "non-STRICT").length;
    const strictCols = rows.filter((r) => r[3] === "STRICT").length;
    expect(strictCols, "STRICT columns exist and are deliberately NOT triggered").toBeGreaterThan(0);
    expect(inventoryCols + strictCols).toBe(rows.length);
    expect(inventoryCols).toBeGreaterThan(0);
    expect(ins, "one BEFORE INSERT trigger per inventoried money column").toBe(inventoryCols);
    expect(upd, "one BEFORE UPDATE trigger per inventoried money column").toBe(inventoryCols);
    expect(ins + upd).toBe(inventoryCols * 2);
  });

  it("EVERY floor is NULL-PRESERVING — no trigger fires on a NULL (R6)", () => {
    const sql = fs.readFileSync(MIG, "utf8");
    /* Comments are stripped first: the file's own header explains the guard in
       prose ("guarded by `WHEN NEW.<col> IS NOT NULL`"), and counting that
       sentence as an unguarded clause would make this fence fail on its own
       documentation. */
    const code = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    const whens = [...code.matchAll(/WHEN\s+NEW\."[^"]+"\s+IS NOT NULL\s+AND/g)].length;
    const allWhens = [...code.matchAll(/\bWHEN\s+NEW\./g)].length;
    expect(whens).toBeGreaterThan(0);
    /* BOTH DIRECTIONS: every WHEN clause is guarded by IS NOT NULL, and there
       is no unguarded WHEN clause anywhere in the file. A floor that rejected
       NULL would break the honest "not provided" refusals of Waves 42 and 46. */
    expect(whens).toBe(allWhens);
    expect(code).not.toMatch(/WHEN\s+NEW\."[^"]+"\s+IS NULL/);
  });
});

/* ============================================================
 * ITEM 1 · B — BOTH POLES, executed against real generated SQL
 * ============================================================ */
describe("WAVE 48 · ITEM 1 — the money type floor refuses text and still accepts money", () => {
  /** Extract the statements 0186 generates for one table, so the SQL under test
   *  is the SHIPPED SQL rather than a paraphrase of it. */
  function triggersFor(table: string, col: string): string[] {
    const sql = fs.readFileSync(MIG, "utf8");
    const out: string[] = [];
    /* Keyed on table AND column: `rounds` carries TWO money columns, and a
       table-only match pulled in triggers referencing a column this harness had
       not created (`no such column: NEW.target_amount`). Caught by running it. */
    /* WAVE 49 · A-6B: each floor now ships as a DROP/CREATE PAIR, and the pair
       is what this harness must execute — running the CREATE alone would test
       SQL the migration does not actually apply. The direction is captured and
       back-referenced so a DROP can never be paired with the CREATE of the
       other direction, and the DROP's trailing `;` pins the full column name
       exactly. */
    const re = new RegExp(
      `DROP TRIGGER IF EXISTS w48_money_typefloor_(ins|upd)_${table}_${col};\\s*` +
        `CREATE TRIGGER (?:IF NOT EXISTS )?w48_money_typefloor_\\1_${table}_${col}\\b[\\s\\S]*?END;`,
      "g",
    );
    for (const m of sql.matchAll(re)) out.push(m[0]);
    return out;
  }

  function harness(table: string, col: string, declared: string) {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, "${col}" ${declared});`);
    const trigs = triggersFor(table, col);
    expect(trigs.length, `0186 must carry triggers for ${table}.${col}`).toBe(2);
    for (const t of trigs) db.exec(t);
    return db;
  }

  function attempt(db: Database.Database, table: string, col: string, id: string, value: unknown) {
    try {
      db.prepare(`INSERT INTO ${table} (id, "${col}") VALUES (?, ?)`).run(id, value as never);
      const got = db.prepare(`SELECT typeof("${col}") AS t, "${col}" AS v FROM ${table} WHERE id = ?`).get(id) as {
        t: string;
        v: unknown;
      };
      return { ok: true as const, storedType: got.t, value: got.v };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }

  it("INTEGER minor-unit column: refuses text, accepts USD and JPY integers, accepts NULL", () => {
    const db = harness("spv_commitments", "amount_minor", "INTEGER");

    /* POLE 1 — the defect. This is the exact value that was ACCEPTED before
       0186 (build_log/wave48/poles_before.txt). */
    const bogus = attempt(db, "spv_commitments", "amount_minor", "w48_bogus", "not-a-number");
    expect(bogus.ok).toBe(false);
    expect(bogus.ok === false && bogus.error).toMatch(/WAVE48\/0186 money type floor/);

    /* POLE 2 — legitimate money still writes. USD, exponent 2: $12.50. */
    const usdExp = currencyExponent("USD");
    expect(usdExp).toBe(2);
    const usd = attempt(db, "spv_commitments", "amount_minor", "w48_usd", 1250);
    expect(usd.ok).toBe(true);
    expect(usd.ok && usd.storedType).toBe("integer");
    expect(usd.ok && usd.value).toBe(1250);

    /* POLE 2b — THE JPY FIXTURE. Exponent 0, so ¥1,234 IS 1234 minor units and
       there is no /100 anywhere: a floor that assumed two decimal places would
       be a money bug wearing a validation costume. */
    const jpyExp = currencyExponent("JPY");
    expect(jpyExp).toBe(0);
    const jpy = attempt(db, "spv_commitments", "amount_minor", "w48_jpy", 1234);
    expect(jpy.ok).toBe(true);
    expect(jpy.ok && jpy.storedType).toBe("integer");
    expect(jpy.ok && jpy.value).toBe(1234);

    /* POLE 3 — NULL means "not provided" and is still permitted (R6). */
    const nul = attempt(db, "spv_commitments", "amount_minor", "w48_null", null);
    expect(nul.ok).toBe(true);
    expect(nul.ok && nul.storedType).toBe("null");

    /* POLE 4 — a float is not an integer minor unit, so it is refused too. */
    const flt = attempt(db, "spv_commitments", "amount_minor", "w48_float", 12.5);
    expect(flt.ok).toBe(false);

    /* POLE 5 — UPDATE is fenced as well as INSERT (the BEFORE UPDATE trigger). */
    expect(() =>
      db.prepare(`UPDATE spv_commitments SET amount_minor = ? WHERE id = ?`).run("not-a-number" as never, "w48_usd"),
    ).toThrow(/WAVE48\/0186 money type floor/);
    db.prepare(`UPDATE spv_commitments SET amount_minor = ? WHERE id = ?`).run(1234, "w48_usd");
    expect(
      (db.prepare(`SELECT amount_minor AS v FROM spv_commitments WHERE id = 'w48_usd'`).get() as { v: number }).v,
    ).toBe(1234);
    db.close();
  });

  it("legacy REAL column: refuses non-numeric text, still accepts its REAL major units and NULL", () => {
    /* `rounds.raised_amount` is one of the SIX legacy REAL columns. Its floor
       deliberately admits `real` as well as `integer`: those columns hold major
       units today, and a floor that redefined their UNIT would be a silent
       money change dressed up as a type fix. Disclosed, not smoothed over. */
    const db = harness("rounds", "raised_amount", "REAL");
    const bogus = attempt(db, "rounds", "raised_amount", "w48_r_bogus", "not-a-number");
    expect(bogus.ok).toBe(false);
    expect(bogus.ok === false && bogus.error).toMatch(/WAVE48\/0186 money type floor/);

    const real = attempt(db, "rounds", "raised_amount", "w48_r_real", 1500000.5);
    expect(real.ok).toBe(true);
    const int = attempt(db, "rounds", "raised_amount", "w48_r_int", 1234);
    expect(int.ok).toBe(true);
    const nul = attempt(db, "rounds", "raised_amount", "w48_r_null", null);
    expect(nul.ok).toBe(true);
    db.close();
  });

  it("the floor is IDEMPOTENT — applying 0186's triggers twice is a no-op, not an error", () => {
    const db = harness("spv_commitments", "amount_minor", "INTEGER");
    const sql = fs.readFileSync(MIG, "utf8");
    /* WAVE 49 · A-6B: idempotency is now supplied by the DROP rather than by
       `IF NOT EXISTS`, which is strictly stronger — replaying 0186 restores the
       SHIPPED body even over a trigger of the same name that had been altered,
       where `IF NOT EXISTS` would have left the altered one in place. Replaying
       the pair must still be a no-op for behaviour, which is what this asserts. */
    const pair =
      /DROP TRIGGER IF EXISTS w48_money_typefloor_(ins|upd)_spv_commitments_amount_minor;\s*CREATE TRIGGER (?:IF NOT EXISTS )?w48_money_typefloor_\1_spv_commitments_amount_minor\b[\s\S]*?END;/g;
    let replayed = 0;
    for (const m of sql.matchAll(pair)) {
      db.exec(m[0]);
      replayed++;
    }
    expect(replayed, "both floors were re-applied, so this really is a replay").toBe(2);
    const bogus = attempt(db, "spv_commitments", "amount_minor", "w48_again", "not-a-number");
    expect(bogus.ok).toBe(false);
    expect(attempt(db, "spv_commitments", "amount_minor", "w48_again_ok", 1234).ok).toBe(true);
    db.close();
  });
});

/* ============================================================
 * ITEM 2 — WAIVER-5 is owner-ratified, at all THREE enforcement points
 * ============================================================ */
describe("WAVE 48 · ITEM 2 — WAIVER-5 ratification is recorded everywhere it is read", () => {
  const SH = path.join(ROOT, "scripts", "sacred_check.sh");
  const GUARD_TEST = path.join(ROOT, "server", "__tests__", "waveB_retirement_guard.test.ts");
  const RL_TEST = path.join(
    ROOT,
    "server",
    "__tests__",
    "wave18_cpmsg05_rate_limit_identity.test.ts",
  );
  const BILLING = "client/src/pages/founder/Billing.tsx";
  const FROZEN_SHA = "ddbc591cc49b8b95ac9bfea90062486bc13e2eed134687235506e5e06d57ce5f";

  it("point 1 — scripts/sacred_check.sh marks the row RATIFIED without touching the hash", () => {
    const sh = fs.readFileSync(SH, "utf8");
    const row = sh.match(/"client\/src\/pages\/founder\/Billing\.tsx\|([^"]*)"/);
    expect(row).toBeTruthy();
    const f = (row as RegExpMatchArray)[1].split("|");
    expect(f.length + 1).toBe(5);
    expect(f[2]).toBe("WAIVER-5");
    expect(f[3]).toBe("RATIFIED");
    /* THE HASH MUST NOT MOVE. Ratifying a waiver records a decision; it does
       not re-open the sacred file. */
    expect(f[1]).toBe(FROZEN_SHA);
    const live = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(ROOT, BILLING)))
      .digest("hex");
    expect(live, "the waived sacred file's bytes are unchanged by ratification").toBe(FROZEN_SHA);
  });

  it("points 2 and 3 — both test enforcement points record the ratification too", () => {
    const guard = fs.readFileSync(GUARD_TEST, "utf8");
    expect(guard).toContain("RATIFIED_HERE");
    expect(guard).toMatch(/"client\/src\/pages\/founder\/Billing\.tsx":\s*"WAIVER-5"/);
    expect(guard).toContain(FROZEN_SHA);
    const rl = fs.readFileSync(RL_TEST, "utf8");
    expect(rl).toContain("WAIVER-5 was OWNER-RATIFIED 2026-08-13");
  });

  it("the operator-facing gate output is 48/48, still lists the waiver, and claims nothing pending", () => {
    const out = execFileSync("bash", [SH], { encoding: "utf8", cwd: ROOT });
    expect(out).toContain("SACRED OK: 48/48");
    /* STILL WAIVED — ratification must not make a waiver vanish. */
    expect(out).toContain("WAIVER-5 x1");
    expect(out).toContain("6 under KNOWN_DRIFT freeze");
    /* NOW RATIFIED — and the old pending language is gone. */
    expect(out).toContain("all 6 waivers OWNER-RATIFIED");
    expect(out).not.toContain("PENDING OWNER RATIFICATION");
    const json = JSON.parse(
      execFileSync("bash", [SH, "--json"], { encoding: "utf8", cwd: ROOT }).trim(),
    ) as { ok: number; entries: number; unratified_waivers: number; unratified: string; exit: number };
    expect(json.entries).toBe(48);
    expect(json.ok).toBe(48);
    expect(json.unratified_waivers).toBe(0);
    expect(json.unratified).toBe("");
    expect(json.exit).toBe(0);
  });

  it("NEGATIVE POLE — the closed vocabulary still refuses an unrecognised state", () => {
    /* Proof that this is a ratification, not a hole: sacred_check.sh's own
       validator is exercised on a MUTANT copy of the waiver table (the real
       script is untouched). An unreadable provenance must abort, never be read
       as approval. */
    const sh = fs.readFileSync(SH, "utf8");
    const mutant = sh.replace("|WAIVER-5|RATIFIED\"", "|WAIVER-5|SELF-APPROVED\"");
    expect(mutant).not.toBe(sh);
    const tmp = path.join(ROOT, "scripts", ".w48_sacred_mutant_check.sh");
    try {
      fs.writeFileSync(tmp, mutant);
      let failed = false;
      let combined = "";
      try {
        combined = execFileSync("bash", [tmp], { encoding: "utf8", cwd: ROOT, stdio: "pipe" });
      } catch (e) {
        failed = true;
        const err = e as { status?: number; stdout?: string; stderr?: string };
        combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
        expect(err.status, "a malformed waiver table must abort, not exit 0").not.toBe(0);
      }
      expect(failed, "an unrecognised ratification state must fail the gate").toBe(true);
      expect(combined).toMatch(/no recognised ratification state/i);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });
});

/* ============================================================
 * ITEM 4 — the rename is BEHAVIOUR-IDENTICAL
 * ============================================================ */
describe("WAVE 48 · ITEM 4 — `delivered` → `transportAccepted` changes the NAME only", () => {
  afterEach(() => {
    __setEmailTransportForTests(null);
    delete process.env.SMTP_MODE;
    delete process.env.SMTP_HOST;
  });

  /** The values `delivered` returned on every path BEFORE the rename, recorded
   *  from the pre-rename source and from the two pre-existing tests that pinned
   *  it (`emailSender.test.ts`, `wave47_…observability.test.ts`). The rename is
   *  proven by REPRODUCING these, not by re-pinning them. */
  const LEGACY: Array<{ mode: string; env: Record<string, string | undefined>; expected: boolean }> = [
    { mode: "disabled", env: { SMTP_MODE: "disabled" }, expected: false },
    { mode: "dry_run", env: { SMTP_MODE: "dry_run" }, expected: true },
    { mode: "console", env: { SMTP_MODE: "console" }, expected: true },
    { mode: "smtp (no SMTP_HOST)", env: { SMTP_MODE: "smtp", SMTP_HOST: undefined }, expected: false },
  ];

  for (const c of LEGACY) {
    it(`${c.mode}: transportAccepted === the legacy delivered value (${c.expected})`, async () => {
      for (const [k, v] of Object.entries(c.env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      const r = await sendEmail({ to: "w48@rename.test", subject: "w48", text: "b" });
      expect(r.transportAccepted).toBe(c.expected);
      /* The OLD NAME IS GONE — a lingering `delivered` key would mean two
         fields claiming to be the same thing, which is worse than the trap the
         rename removes. */
      expect(Object.keys(r)).not.toContain("delivered");
      expect(Object.keys(r)).toContain("transportAccepted");
      /* `status` is untouched and is still the honest outcome. */
      if (c.mode !== "disabled") expect(r.status).toBeTruthy();
    });
  }

  it("smtp accepted vs refused: the boolean AND the honest status both behave as before", async () => {
    process.env.SMTP_MODE = "smtp";
    process.env.SMTP_HOST = "smtp.w48.test";

    const accepting: InjectedEmailTransport = { async send() { return { accepted: true }; } };
    __setEmailTransportForTests(accepting);
    const ok: EmailSendResult = await sendEmail({ to: "a@w48.test", subject: "s", text: "t" });
    expect(ok.transportAccepted).toBe(true);
    expect(ok.status).toBe("sent");
    expect(Object.keys(ok)).not.toContain("delivered");

    const refusing: InjectedEmailTransport = {
      async send() {
        return { accepted: false, error: "550 mailbox unavailable", permanent: true };
      },
    };
    __setEmailTransportForTests(refusing);
    const bad: EmailSendResult = await sendEmail({ to: "b@w48.test", subject: "s", text: "t" });
    /* BOTH POLES on the same field: a refusal is still `false`, and the honest
       status still distinguishes a permanent rejection from a retryable one. */
    expect(bad.transportAccepted).toBe(false);
    expect(bad.status).toBe("bounced");
    expect(Object.keys(bad)).not.toContain("delivered");
  });

  it("no source file still reads the renamed field under its old name", () => {
    /* The rename is only true if it is complete. This walks the call sites the
       field actually has (the bridge/SSE `delivered` COUNTERS are a different
       field and are deliberately out of scope). */
    const files = [
      "server/lib/emailSender.ts",
      "server/lib/adminEmailRoutes.ts",
      "server/consortiumApplyStore.ts",
      "client/src/pages/admin/Email.tsx",
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} still reads result.delivered`).not.toMatch(/\b(result|r|d)\.delivered\b/);
    }
    /* The `delivered:` KEY check is server-side only, and deliberately so:
       client/src/pages/admin/Email.tsx also carries the OUTBOX DELIVERY-STATUS
       vocabulary (`delivered` as one of queued|sent|delivered|opened|…), which
       is a real provider-reported status and must keep its name. Renaming that
       would be the opposite of this item — it would make an honest field vague. */
    for (const rel of files.filter((f) => f.startsWith("server/"))) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} still writes a delivered: key into an email result`).not.toMatch(
        /^\s*delivered:\s/m,
      );
    }
    /* And the send-test handler in the admin page now reads the new name. */
    const emailPage = fs.readFileSync(path.join(ROOT, "client/src/pages/admin/Email.tsx"), "utf8");
    expect(emailPage).toContain('d?.status ?? (d?.transportAccepted ? "sent" : "failed")');
  });
});
