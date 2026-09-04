/**
 * WAVE 305 — REAL TOTP, THE MIGRATION MIRROR, AND THE LOCK-OUT CHECK CONSTRAINT.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND HOW IT REFUSES TO PROVE IT
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. THE CODES ARE REAL. Every TOTP assertion below uses an RFC 6238 Appendix B
 *    published test vector — a secret and a time that were fixed by the RFC years
 *    before this tree existed. That is a FIXTURE NO IMPLEMENTATION CHANGE CAN MOVE
 *    (inert-proof mechanism 3). It is deliberately NOT "generate a code with our
 *    code and check our code accepts it", which is the classic tautology: that
 *    version passes for a broken implementation as long as it is broken
 *    consistently, and it is exactly how the retired scaffold's undecodable
 *    alphabet survived review.
 *
 * 2. THE CHECK CONSTRAINT IS PROVED BY THE DATABASE REFUSING, not by reading the
 *    SQL text. The test inserts a third mode value with `rawDb()` and asserts the
 *    insert THROWS. A test that only grepped the migration for "CHECK" would pass
 *    against a migration that was never applied.
 *
 * 3. THE THREE MIGRATION HOMES ARE COMPARED BYTE-FOR-BYTE, and then the SCHEMA
 *    THEY PRODUCE is compared by applying each to a separate fresh in-memory
 *    database and diffing `sqlite_master`. Byte-equality alone would not prove the
 *    inline path is ever executed.
 *
 * 4. PRECONDITIONS ARE ASSERTED FIRST. Every "nothing happened" assertion is
 *    preceded by an assertion that the counter it reads is non-zero in the
 *    positive case, so an absence cannot be an empty fixture.
 *
 * MAIL: this file sends none, and asserts `resolveSmtpMode()` is inert.
 * MONEY: there is none in this feature. No amount, no currency, no arithmetic.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { rawDb } from "../db/connection";
import { resolveSmtpMode } from "../lib/emailSender";
import { MFA_SCHEMA_SQL } from "../lib/mfaSchema";
import {
  RFC4648_BASE32_ALPHABET,
  TOTP_DIGITS,
  TOTP_DRIFT_STEPS,
  TOTP_STEP_SECONDS,
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCodeForStep,
  totpProvisioningUri,
  totpStepForTime,
  verifyTotp,
} from "../lib/mfaTotp";
import { MFA_POLICY_MODES, ensureMfaSchema, setPolicyMode } from "../lib/mfaStore";

const REPO = path.resolve(__dirname, "../..");
const MIGRATION_BASENAME = "0230_wave305_mfa_enrolment.sql";
const CANONICAL = path.join(REPO, "migrations", MIGRATION_BASENAME);
const MIRROR = path.join(REPO, "server", "db", "migrations", MIGRATION_BASENAME);

/* RFC 6238 Appendix B, SHA-1 rows. The shared secret is the ASCII string
 * "12345678901234567890". These eight-digit values are printed IN THE RFC; the
 * six-digit expectation is their last six digits, because truncation is
 * `value % 10^digits`. Nothing in this tree produced these numbers. */
const RFC6238_SECRET_ASCII = "12345678901234567890";
const RFC6238_VECTORS: Array<{ unixTime: number; eightDigits: string; sixDigits: string }> = [
  { unixTime: 59, eightDigits: "94287082", sixDigits: "287082" },
  { unixTime: 1111111109, eightDigits: "07081804", sixDigits: "081804" },
  { unixTime: 1111111111, eightDigits: "14050471", sixDigits: "050471" },
  { unixTime: 1234567890, eightDigits: "89005924", sixDigits: "005924" },
  { unixTime: 2000000000, eightDigits: "69279037", sixDigits: "279037" },
];

/** The RFC's secret, base32-encoded. Asserted against the RFC's own encoding. */
const RFC6238_SECRET_B32 = base32Encode(Buffer.from(RFC6238_SECRET_ASCII, "ascii"));

describe("W305 §0 — MAIL IS INERT AND NO MONEY IS INVOLVED", () => {
  it("0a SMTP_MODE resolves to a non-sending mode for the whole of this file", () => {
    const mode = resolveSmtpMode();
    expect(["dry_run", "console", "disabled"]).toContain(mode);
    expect(mode).not.toBe("smtp");
  });
});

describe("W305 §1 — THE SCAFFOLD'S ALPHABET WAS NOT BASE32, AND OURS IS", () => {
  it("1a the alphabet is RFC 4648 §6 verbatim: A–Z then 2–7, exactly 32 symbols", () => {
    expect(RFC4648_BASE32_ALPHABET).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567");
    expect(RFC4648_BASE32_ALPHABET.length).toBe(32);
    expect(new Set(RFC4648_BASE32_ALPHABET).size).toBe(32);
  });

  it("1b base32 excludes 0, 1, 8 and 9 — the scaffold's alphabet contained 8 and 9", () => {
    for (const forbidden of ["0", "1", "8", "9"]) {
      expect(RFC4648_BASE32_ALPHABET.includes(forbidden)).toBe(false);
    }
    /* The scaffold's string, quoted here so the defect is recorded in a test and
     * not only in a comment. It is 31 characters, not 32 — it could not have been
     * base32 even if its symbols had been right. */
    const SCAFFOLD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    expect(SCAFFOLD_ALPHABET.length).toBe(31);
    expect(SCAFFOLD_ALPHABET.includes("8")).toBe(true);
    expect(SCAFFOLD_ALPHABET.includes("9")).toBe(true);
    expect(SCAFFOLD_ALPHABET).not.toBe(RFC4648_BASE32_ALPHABET);
  });

  it("1c our base32 encoder reproduces the RFC 6238 secret's published encoding", () => {
    /* PRECONDITION FIRST: the input really is the RFC's twenty-byte secret. */
    expect(Buffer.from(RFC6238_SECRET_ASCII, "ascii").length).toBe(20);
    expect(RFC6238_SECRET_B32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    /* Round trip, and the round trip is compared to the ORIGINAL BYTES, not to
     * another call of our own encoder. */
    expect(base32Decode(RFC6238_SECRET_B32)?.toString("ascii")).toBe(RFC6238_SECRET_ASCII);
  });

  it("1d a generated secret is 160 bits, unpadded, and decodes to twenty bytes", () => {
    const s = generateTotpSecret();
    expect(s.length).toBe(32);
    expect(s.includes("=")).toBe(false);
    expect(base32Decode(s)?.length).toBe(20);
    for (const ch of s) expect(RFC4648_BASE32_ALPHABET.includes(ch)).toBe(true);
  });

  it("1e a character outside the alphabet decodes to null, never to a partial buffer", () => {
    expect(base32Decode("ABCD8EFG")).toBeNull();
    expect(base32Decode("ABCD9EFG")).toBeNull();
    expect(base32Decode("")).toBeNull();
    expect(base32Decode("!!!!")).toBeNull();
  });
});

describe("W305 §2 — RFC 6238 CODES, AT FIXED TIMES FROM THE RFC ITSELF", () => {
  it("2a all five RFC 6238 Appendix B SHA-1 vectors produce the published code", () => {
    /* PRECONDITION: there really are five vectors and the constants match the RFC's
     * defaults. A loop over an empty list would pass silently. */
    expect(RFC6238_VECTORS.length).toBe(5);
    expect(TOTP_STEP_SECONDS).toBe(30);
    expect(TOTP_DIGITS).toBe(6);
    for (const v of RFC6238_VECTORS) {
      const step = totpStepForTime(v.unixTime * 1000);
      expect(step).toBe(Math.floor(v.unixTime / 30));
      const code = totpCodeForStep(RFC6238_SECRET_B32, step);
      expect(code).toBe(v.sixDigits);
      expect(v.eightDigits.endsWith(v.sixDigits)).toBe(true);
    }
  });

  it("2b a code is accepted at its own step", () => {
    for (const v of RFC6238_VECTORS) {
      expect(verifyTotp(RFC6238_SECRET_B32, v.sixDigits, v.unixTime * 1000)).toEqual({
        ok: true,
        step: Math.floor(v.unixTime / 30),
      });
    }
  });

  it("2c drift is exactly ±1 step: -1 and +1 accepted, -2 and +2 REFUSED", () => {
    expect(TOTP_DRIFT_STEPS).toBe(1);
    const now = 1111111109 * 1000;
    const centre = totpStepForTime(now);
    for (const d of [-1, 0, 1]) {
      const code = totpCodeForStep(RFC6238_SECRET_B32, centre + d)!;
      const r = verifyTotp(RFC6238_SECRET_B32, code, now);
      expect(r.ok, `step offset ${d} should be accepted`).toBe(true);
    }
    for (const d of [-2, 2, -5, 5]) {
      const code = totpCodeForStep(RFC6238_SECRET_B32, centre + d)!;
      /* PRECONDITION: this really is a DIFFERENT code from the accepted one,
         otherwise the refusal would be about nothing. */
      expect(code).not.toBe(totpCodeForStep(RFC6238_SECRET_B32, centre));
      expect(verifyTotp(RFC6238_SECRET_B32, code, now)).toEqual({ ok: false, reason: "no_match" });
    }
  });

  it("2d a malformed code is refused as malformed, and a corrupt secret as a bad secret", () => {
    const now = 59_000;
    expect(verifyTotp(RFC6238_SECRET_B32, "12345", now).ok).toBe(false);
    expect(verifyTotp(RFC6238_SECRET_B32, "abcdef", now)).toEqual({ ok: false, reason: "malformed_code" });
    expect(verifyTotp(RFC6238_SECRET_B32, "1234567", now)).toEqual({ ok: false, reason: "malformed_code" });
    /* "SCAFFOLD8" is exactly the shape of a secret the retired route used to write. */
    expect(verifyTotp("SCAFFOLD89", "287082", now)).toEqual({ ok: false, reason: "bad_secret" });
  });

  it("2e THE SCAFFOLD'S OWN BEHAVIOUR IS NOW REFUSED: an arbitrary six digits fails", () => {
    /* The retired verify route accepted ANY six digits. Here every six-digit string
       that is not the RFC's code is refused at the RFC's own time. */
    const now = 59_000;
    let refused = 0;
    const candidates = ["000000", "111111", "123456", "999999", "287083", "187082"];
    for (const c of candidates) {
      expect(c).not.toBe("287082");
      expect(verifyTotp(RFC6238_SECRET_B32, c, now).ok).toBe(false);
      refused++;
    }
    /* PRECONDITION ON THE ABSENCE: the loop actually ran. */
    expect(refused).toBe(candidates.length);
    expect(refused).toBeGreaterThan(0);
    /* And the one true code still passes, so the refusal is discriminating rather
       than a blanket "no". A test that only proved refusal could be satisfied by a
       function that refuses everything. */
    expect(verifyTotp(RFC6238_SECRET_B32, "287082", now).ok).toBe(true);
  });

  it("2f the provisioning URI states algorithm, digits and period explicitly", () => {
    const uri = totpProvisioningUri({ secret: RFC6238_SECRET_B32, accountLabel: "a@b.test", issuer: "Capavate" });
    expect(uri.startsWith("otpauth://totp/Capavate:a%40b.test?")).toBe(true);
    expect(uri).toContain(`secret=${RFC6238_SECRET_B32}`);
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("W305 §3 — MIGRATION 0230 EXISTS IN THREE HOMES THAT CANNOT DRIFT", () => {
  it("3a the two .sql copies are byte-identical", () => {
    const a = fs.readFileSync(CANONICAL);
    const b = fs.readFileSync(MIRROR);
    /* PRECONDITION: neither file is empty. Two empty files are byte-identical. */
    expect(a.length).toBeGreaterThan(1000);
    expect(b.length).toBeGreaterThan(1000);
    expect(a.equals(b)).toBe(true);
  });

  it("3b the inline bootstrap constant unescapes to exactly the canonical file bytes", () => {
    const file = fs.readFileSync(CANONICAL, "utf8");
    expect(file.length).toBeGreaterThan(1000);
    expect(MFA_SCHEMA_SQL).toBe(file);
  });

  it("3c 0230 is the highest migration id in BOTH directories, and 0229 precedes it", () => {
    const ids = (dir: string) =>
      fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .map((f) => f.slice(0, 4))
        .sort();
    const a = ids(path.join(REPO, "migrations"));
        const b = ids(path.join(REPO, "server", "db", "migrations"));
    expect(a.length).toBeGreaterThan(100);
    expect(b.length).toBeGreaterThan(100);
    expect(a[a.length - 1]).toBe("0230");
    expect(b[b.length - 1]).toBe("0230");
    expect(a[a.length - 2]).toBe("0229");
    expect(b[b.length - 2]).toBe("0229");
  });

  it("3d BOTH PATHS PRODUCE THE SAME SCHEMA — applied to two fresh databases and diffed", () => {
    /* This is the assertion that byte-equality cannot make on its own: that the
     * text is actually EXECUTABLE and that executing it via each route lands the
     * same objects. Two separate `:memory:` handles, one fed from the file on disk
     * and one from the exported constant. */
    const fromFile = new Database(":memory:");
    const fromInline = new Database(":memory:");
    try {
      fromFile.exec(fs.readFileSync(CANONICAL, "utf8"));
      fromInline.exec(MFA_SCHEMA_SQL);
      const shape = (db: any) =>
        db
          .prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
          .all();
      const a = shape(fromFile);
      const b = shape(fromInline);
      /* PRECONDITION: the schema is not empty. Two empty schemas are equal. */
      expect(a.length).toBeGreaterThanOrEqual(5);
      expect(a.map((r: any) => r.name)).toContain("mfa_enrolment");
      expect(a.map((r: any) => r.name)).toContain("mfa_recovery_code");
      expect(a.map((r: any) => r.name)).toContain("mfa_policy");
      expect(b).toEqual(a);
      /* And the seeded policy row landed on both. */
      const seeded = (db: any) => db.prepare(`SELECT id, mode FROM mfa_policy`).all();
      expect(seeded(fromFile)).toEqual([{ id: 1, mode: "enrolled_only" }]);
      expect(seeded(fromInline)).toEqual(seeded(fromFile));
    } finally {
      fromFile.close();
      fromInline.close();
    }
  });
});

describe("W305 §4 — LOCK-OUT IS UNREPRESENTABLE: THE DATABASE REFUSES A THIRD MODE", () => {
  it("4a the domain is exactly {off, enrolled_only} — there is no 'required'", () => {
    expect([...MFA_POLICY_MODES]).toEqual(["off", "enrolled_only"]);
    expect(MFA_POLICY_MODES).not.toContain("required");
    expect(MFA_POLICY_MODES).not.toContain("all");
  });

  it("4b THE DATABASE REFUSES a third value — proved by attempting the insert", () => {
    expect(ensureMfaSchema()).toBe(true);
    const db = rawDb();
    /* PRECONDITION: a PERMITTED value really does write, so the refusal below is
     * about the value and not about a broken statement, a missing table, or a
     * read-only handle. Without this the next assertion proves nothing
     * (inert-proof mechanism 9: a RED that proves nothing). */
    expect(() =>
      db.prepare(`UPDATE mfa_policy SET mode = 'off' WHERE id = 1`).run(),
    ).not.toThrow();
    expect(db.prepare(`SELECT mode FROM mfa_policy WHERE id = 1`).get()).toEqual({ mode: "off" });
    expect(() =>
      db.prepare(`UPDATE mfa_policy SET mode = 'enrolled_only' WHERE id = 1`).run(),
    ).not.toThrow();

    /* NOW the refusal. Each of these is a value somebody might reasonably try in
     * order to make MFA mandatory. Every one is refused BY SQLITE. */
    for (const forbidden of ["required", "all", "admins", "ON", "enrolled", ""]) {
      expect(
        () => db.prepare(`UPDATE mfa_policy SET mode = ? WHERE id = 1`).run(forbidden),
        `mode '${forbidden}' must be refused by the CHECK constraint`,
      ).toThrow(/CHECK constraint failed/i);
    }
    /* A fresh INSERT of a third value is refused too, not only an UPDATE. */
    expect(() =>
      db.prepare(`INSERT INTO mfa_policy (id, mode, updated_at) VALUES (2, 'required', 0)`).run(),
    ).toThrow();
    /* And the surviving row is still one of the two legal values. */
    const after = db.prepare(`SELECT mode FROM mfa_policy WHERE id = 1`).get() as { mode: string };
    expect(["off", "enrolled_only"]).toContain(after.mode);
  });

  it("4c the application layer reports the database's refusal rather than hiding it", () => {
    expect(ensureMfaSchema()).toBe(true);
    /* PRECONDITION: a legal value succeeds through the same function. */
    expect(setPolicyMode("enrolled_only", "u_test", Date.now()).ok).toBe(true);
    const bad = setPolicyMode("required", "u_test", Date.now());
    expect(bad.ok).toBe(false);
    expect(String(bad.reason)).toMatch(/CHECK constraint failed/i);
    /* The refusal did not leave a half-written row. */
    const row = rawDb().prepare(`SELECT mode FROM mfa_policy WHERE id = 1`).get() as { mode: string };
    expect(row.mode).toBe("enrolled_only");
  });

  it("4d the enrolment state domain is also closed — no fourth state is storable", () => {
    expect(ensureMfaSchema()).toBe(true);
    const db = rawDb();
    const uid = `u_w305_state_${Date.now()}`;
    /* PRECONDITION: a legal state writes. */
    expect(() =>
      db
        .prepare(
          `INSERT INTO mfa_enrolment (user_id, method, state, created_at, updated_at) VALUES (?, 'totp', 'pending', 0, 0)`,
        )
        .run(uid),
    ).not.toThrow();
    for (const forbidden of ["enabled", "required", "on", ""]) {
      expect(() =>
        db.prepare(`UPDATE mfa_enrolment SET state = ? WHERE user_id = ?`).run(forbidden, uid),
      ).toThrow(/CHECK constraint failed/i);
    }
    /* And no method other than totp — so a future channel cannot be smuggled in
     * without a migration and a review. */
    expect(() => db.prepare(`UPDATE mfa_enrolment SET method = 'sms' WHERE user_id = ?`).run(uid)).toThrow(
      /CHECK constraint failed/i,
    );
  });
});
