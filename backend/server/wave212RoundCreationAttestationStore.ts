/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 212 · ITEM B · R186.2 / R187.1 / R187.3 / R192.3 — WHERE THE FOUNDER'S
 * ROUND-CREATION SIGN-OFF IS KEPT SO IT IS PROVABLE YEARS LATER.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THE ROUND ROW AND NOT `legal_consents` — R171.1, "do not create a second
 * consent store", cuts BOTH ways, so this decision was made by reading the two
 * candidates rather than by preference:
 *
 *   1. `legal_consents` (`server/legalConsentStore.ts`) admits a CLOSED vocabulary
 *      of contexts — signup, new_company, onboarding, settings_update. Round
 *      creation is not one of them, and widening that vocabulary would mean editing
 *      a file wave 210 is concurrently rewriting. Colliding with a live wave is
 *      itself a documented failure class here.
 *   2. The vehicle launch sign-off (`server/spvLaunchSignoffStore.ts`) keeps the
 *      exact displayed text ON THE ROW it belongs to. Draft 02 says to model this
 *      wave on that sign-off, and the build doc's §212.3 says the same thing in
 *      schema terms: four columns on `rounds`, migration 0221, NO NEW TABLE.
 *
 * So: no new table, no second consent store, no edit to another wave's file. The
 * sign-off lives in dedicated columns on the round it signs.
 *
 * WHY DEDICATED COLUMNS AND NOT `extras_json`. The round-create route sweeps every
 * unrecognised body key into `extras`, and `roundsStore.rowToRound()` re-spreads
 * `extras_json` onto the hydrated round — so anything placed there is echoed by
 * `GET /api/rounds` to every reader of that round, including investors. The
 * founder's typed legal name, their IP address and their user agent must not travel
 * with a round's terms. These columns are deliberately absent from
 * `shared/schema.ts`, so no existing drizzle select can pick them up and no
 * existing response shape changes.
 *
 * WHY THIS FILE OWNS ITS OWN DDL. `server/db/connection.ts` builds the SQLite test
 * and bootstrap databases from DDL inlined in THAT file rather than from the
 * numbered migrations, and this wave may not edit it. Without a self-heal, every
 * in-memory test database would lack these columns and the wave's own proofs would
 * pass against nothing — the "a check that passed while checking nothing" class.
 * The DDL is therefore READ FROM migration 0221 itself, never re-typed here, so the
 * installer and the migration cannot drift. Same shape as
 * `server/lib/pricePeriodOffer.ts` and `applyWave45PricingSchema.ts`.
 *
 * FAIL CLOSED, AND SAY SO. Every function here reports an outcome. Nothing returns
 * a cheerful default. If the columns are unavailable, if the UPDATE matches no row,
 * or if the read-back does not equal what was written, the caller is told the
 * attestation was NOT recorded — and the round-create route refuses on that basis.
 * A gate that fails open is worse than no gate because it reports success.
 *
 * WRITE ONCE. The UPDATE carries `WHERE creation_attestation_version IS NULL`, so a
 * recorded sign-off can never be overwritten by a later call. Nothing here deletes
 * a row or a column value (R195.5).
 *
 * NO FABRICATED EVIDENCE (draft 02, and R187.1/R192.3). The timestamp is the
 * server's. The IP address is the server's own resolution of the peer; when that
 * resolution yields nothing usable the address column stays NULL and a companion
 * column records the field as NOT CAPTURED. A signature record containing an
 * invented value discredits every other signature the platform has produced.
 *
 * RULING: R186.2, R187.1, R187.3, R192.3, R195.5, R171.1, R176.1.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDbDriver, rawDb } from "./db/connection";
import { log } from "./lib/logger";

/** Both migration trees hold a byte-identical copy; either will do. */
const MIGRATION_BASENAME = "0221_wave212_round_creation_attestation.sql";

export const ROUNDS_TABLE = "rounds";

/**
 * The columns this wave adds, in migration order.
 *
 * The first four are the build doc's §212.3 list. The remaining five exist because
 * ITEM B of the wave brief requires the record to be provable later: a server-
 * observed IP with an explicit captured/not-captured marker, the user agent, the
 * signing identity, and a digest of the stored text (R187.3).
 */
export const ROUND_CREATION_ATTESTATION_COLUMNS: readonly string[] = [
  "creation_attestation_version",
  "creation_attestation_text",
  "creation_attestation_text_sha256",
  "creation_attestation_signed_name",
  "creation_attestation_signed_at",
  "creation_attestation_signed_by",
  "creation_attestation_ip",
  "creation_attestation_ip_capture",
  "creation_attestation_user_agent",
];

/** The two values `creation_attestation_ip_capture` may hold. Nothing else. */
export const IP_CAPTURED = "captured";
export const IP_NOT_CAPTURED = "not_captured";

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  SCHEMA — read from the migration, applied by inspection
 * ═══════════════════════════════════════════════════════════════════════════ */

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

/**
 * The `ALTER TABLE rounds ADD COLUMN …` statements, taken from migration 0221.
 *
 * Parsed out of the migration rather than re-typed, so the two cannot drift. Each
 * statement is applied on its own because SQLite adds one column per ALTER and
 * because a column that already exists must not abort the ones that follow.
 */
function readAlterStatements(): string[] {
  let sql: string | null = null;
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) {
        sql = fs.readFileSync(p, "utf8");
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }
  if (sql == null) return [];
  /* Comment lines are dropped before any conclusion is drawn from the text — the
     migration's header is prose and must not be executed or matched against. */
  const executable = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return executable
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^ALTER\s+TABLE/i.test(s));
}

/** Which of this wave's columns the live `rounds` table actually has. */
export function presentAttestationColumns(): string[] {
  if (getDbDriver() !== "sqlite") return [];
  const db = rawDb();
  const info = db.prepare(`PRAGMA table_info(${ROUNDS_TABLE})`).all() as { name: string }[];
  const have = new Set(info.map((c) => String(c.name)));
  return ROUND_CREATION_ATTESTATION_COLUMNS.filter((c) => have.has(c));
}

export type EnsureOutcome =
  | { ok: true; added: string[] }
  | { ok: false; reason: string };

/**
 * Make the columns exist, idempotently, by INSPECTING the table — never by a
 * module-level boolean, which would answer "already done" for a second in-memory
 * database that has none of them.
 */
export function ensureRoundCreationAttestationColumns(): EnsureOutcome {
  if (getDbDriver() !== "sqlite") {
    /* On Postgres the numbered migration is the only installer; this file does not
       attempt DDL there. The route still verifies the columns before it writes, so
       a database that has not been migrated refuses the write rather than losing
       the sign-off silently. */
    return { ok: false, reason: "NOT_SQLITE_MIGRATION_OWNS_SCHEMA" };
  }
  const statements = readAlterStatements();
  if (statements.length === 0) {
    return { ok: false, reason: `MIGRATION_SQL_NOT_FOUND:${MIGRATION_BASENAME}` };
  }
  const db = rawDb();
  const already = new Set(presentAttestationColumns());
  const added: string[] = [];
  for (const stmt of statements) {
    /* Only apply a statement whose column is genuinely missing. */
    const target = ROUND_CREATION_ATTESTATION_COLUMNS.find((c) => stmt.includes(c));
    if (target == null || already.has(target)) continue;
    try {
      db.exec(stmt);
      added.push(target);
    } catch (err) {
      /* A concurrent boot may have added it a microsecond earlier. Anything else
         is a real failure and is surfaced. */
      if (!/duplicate column name/i.test(String((err as Error)?.message ?? err))) {
        return { ok: false, reason: `ALTER_FAILED:${target}` };
      }
    }
  }
  const missing = ROUND_CREATION_ATTESTATION_COLUMNS.filter(
    (c) => !presentAttestationColumns().includes(c),
  );
  if (missing.length > 0) return { ok: false, reason: `COLUMNS_MISSING:${missing.join(",")}` };
  return { ok: true, added };
}

/**
 * Are the columns usable right now? Ensures first, then re-inspects. This is the
 * pre-flight the route runs BEFORE it creates anything, so a database that cannot
 * hold the sign-off refuses the round instead of creating an unattested one.
 */
export function attestationStorageAvailable(): { ok: true } | { ok: false; reason: string } {
  const ensured = ensureRoundCreationAttestationColumns();
  const present = presentAttestationColumns();
  const missing = ROUND_CREATION_ATTESTATION_COLUMNS.filter((c) => !present.includes(c));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    reason: ensured.ok ? `COLUMNS_MISSING:${missing.join(",")}` : ensured.reason,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WRITE
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface RoundCreationAttestationInput {
  roundId: string;
  /** The signature, already validated and folded by the shared module. */
  signedName: string;
  /** The frozen version identifier of the text that was shown. */
  version: string;
  /** The exact text that was shown, verbatim. */
  attestationText: string;
  /** The acting user's id, as the server resolved it. */
  signedBy: string;
  /**
   * The server's own resolution of the peer address, or `null`. A `null` here is
   * recorded as NOT CAPTURED; it is never replaced by a placeholder.
   */
  observedIp: string | null;
  /** The request's user agent, or `null` when the request carried none. */
  userAgent: string | null;
}

export interface RoundCreationAttestationRecord {
  roundId: string;
  version: string;
  attestationText: string;
  attestationTextSha256: string;
  signedName: string;
  signedAt: string;
  signedBy: string;
  ip: string | null;
  ipCapture: string;
  userAgent: string | null;
}

export type RecordOutcome =
  | { ok: true; record: RoundCreationAttestationRecord }
  | { ok: false; code: string; detail: string };

/** SHA-256 of the stored text, hex. R187.3 — the text AND a digest of it. */
export function attestationTextSha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * An address is only recorded when the server actually observed one. The rate-limit
 * resolver returns the literal string `unknown` when it has nothing, and `unknown`
 * is not an address — storing it would put a word where evidence belongs.
 */
export function usableObservedIp(raw: string | null | undefined): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.length === 0) return null;
  if (s.toLowerCase() === "unknown") return null;
  return s;
}

/**
 * Record the sign-off, then READ IT BACK and compare. A write that reports success
 * while serving the old value is the §5.10 failure class; the read-back is how this
 * wave refuses to take the driver's word for it.
 */
export function recordRoundCreationAttestation(
  input: RoundCreationAttestationInput,
): RecordOutcome {
  const available = attestationStorageAvailable();
  if (!available.ok) return { ok: false, code: "ATTESTATION_STORAGE_UNAVAILABLE", detail: available.reason };

  const text = input.attestationText;
  if (typeof text !== "string" || text.trim().length === 0) {
    /* ITEM B — a sign-off with no stored text is not a sign-off. Refused here as
       well as at the route, because this function is the last line before the disk. */
    return { ok: false, code: "ATTESTATION_TEXT_MISSING", detail: "no text supplied" };
  }
  const signedName = input.signedName;
  if (typeof signedName !== "string" || signedName.trim().length === 0) {
    return { ok: false, code: "ATTESTATION_SIGNED_NAME_MISSING", detail: "no signature supplied" };
  }

  const signedAt = new Date().toISOString(); /* server clock, never the client's */
  const ip = usableObservedIp(input.observedIp);
  const ipCapture = ip == null ? IP_NOT_CAPTURED : IP_CAPTURED;
  const sha = attestationTextSha256(text);

  const db = rawDb();
  try {
    const res = db
      .prepare(
        `UPDATE ${ROUNDS_TABLE}
            SET creation_attestation_version = ?,
                creation_attestation_text = ?,
                creation_attestation_text_sha256 = ?,
                creation_attestation_signed_name = ?,
                creation_attestation_signed_at = ?,
                creation_attestation_signed_by = ?,
                creation_attestation_ip = ?,
                creation_attestation_ip_capture = ?,
                creation_attestation_user_agent = ?
          WHERE id = ?
            AND creation_attestation_version IS NULL`,
      )
      .run(
        input.version,
        text,
        sha,
        signedName,
        signedAt,
        input.signedBy,
        ip,
        ipCapture,
        input.userAgent,
        input.roundId,
      );
    if (Number(res?.changes ?? 0) !== 1) {
      return {
        ok: false,
        code: "ATTESTATION_WRITE_MATCHED_NO_ROW",
        detail: `changes=${String(res?.changes)}`,
      };
    }
  } catch (err) {
    return { ok: false, code: "ATTESTATION_WRITE_FAILED", detail: String((err as Error)?.message ?? err) };
  }

  const readBack = readRoundCreationAttestation(input.roundId);
  if (readBack == null) {
    return { ok: false, code: "ATTESTATION_READBACK_EMPTY", detail: "row read back without a sign-off" };
  }
  const mismatched: string[] = [];
  if (readBack.version !== input.version) mismatched.push("version");
  if (readBack.attestationText !== text) mismatched.push("text");
  if (readBack.attestationTextSha256 !== sha) mismatched.push("sha256");
  if (readBack.signedName !== signedName) mismatched.push("signed_name");
  if (readBack.signedAt !== signedAt) mismatched.push("signed_at");
  if (readBack.signedBy !== input.signedBy) mismatched.push("signed_by");
  if (readBack.ip !== ip) mismatched.push("ip");
  if (readBack.ipCapture !== ipCapture) mismatched.push("ip_capture");
  if (readBack.userAgent !== input.userAgent) mismatched.push("user_agent");
  if (mismatched.length > 0) {
    return {
      ok: false,
      code: "ATTESTATION_READBACK_MISMATCH",
      detail: mismatched.join(","),
    };
  }
  if (attestationTextSha256(readBack.attestationText) !== readBack.attestationTextSha256) {
    return { ok: false, code: "ATTESTATION_DIGEST_MISMATCH", detail: "stored digest does not describe stored text" };
  }
  return { ok: true, record: readBack };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The sign-off on a round, or `null` when the round carries none. `null` means
 * NOT RECORDED and is never turned into an empty-string record: a reader must be
 * able to tell "no sign-off" from "a sign-off with blank fields" (R176.1).
 */
export function readRoundCreationAttestation(roundId: string): RoundCreationAttestationRecord | null {
  if (getDbDriver() !== "sqlite") return null;
  const present = presentAttestationColumns();
  if (present.length !== ROUND_CREATION_ATTESTATION_COLUMNS.length) return null;
  try {
    const row = rawDb()
      .prepare(
        `SELECT id,
                creation_attestation_version      AS version,
                creation_attestation_text         AS text,
                creation_attestation_text_sha256  AS sha,
                creation_attestation_signed_name  AS signedName,
                creation_attestation_signed_at    AS signedAt,
                creation_attestation_signed_by    AS signedBy,
                creation_attestation_ip           AS ip,
                creation_attestation_ip_capture   AS ipCapture,
                creation_attestation_user_agent   AS userAgent
           FROM ${ROUNDS_TABLE}
          WHERE id = ?`,
      )
      .get(roundId) as Record<string, unknown> | undefined;
    if (row == null) return null;
    if (row.version == null) return null;
    return {
      roundId,
      version: String(row.version),
      attestationText: String(row.text ?? ""),
      attestationTextSha256: String(row.sha ?? ""),
      signedName: String(row.signedName ?? ""),
      signedAt: String(row.signedAt ?? ""),
      signedBy: String(row.signedBy ?? ""),
      ip: row.ip == null ? null : String(row.ip),
      ipCapture: String(row.ipCapture ?? IP_NOT_CAPTURED),
      userAgent: row.userAgent == null ? null : String(row.userAgent),
    };
  } catch (err) {
    log.warn({ route: "wave212.readRoundCreationAttestation", message: String((err as Error)?.message ?? err) });
    return null;
  }
}
