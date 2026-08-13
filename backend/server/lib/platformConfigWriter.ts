// server/lib/platformConfigWriter.ts
//
// WAVE 11 — the audited writer for `platform_config`.
//
// WHY THIS EXISTS (found while wiring EN-8, and it is a real gap)
// --------------------------------------------------------------
// `platform_config` is defended by five triggers in the SACRED bootstrap
// (server/db/connection.ts:996-1077):
//   trg_pc_chain_guard        NEW.version = OLD.version + 1 AND
//                             NEW.prev_revision_hash = OLD.revision_hash
//   trg_pc_atomic_audit       a matching platform_config_history row must ALREADY
//                             exist, with the same version + both hashes + a
//                             snapshot whose $.val/$.vt/$.key/$.v agree
//   trg_pc_no_key_change      key is immutable
//   trg_pc_no_delete          no deletes
//   trg_pch_chain_integrity   history: genesis is version 1 with a 64-zero prev;
//                             any later row must chain onto version-1's hash
//
// `grep -rln platform_config_history server/ --include=*.ts` returns
// connection.ts and TESTS ONLY. So the config table was writable exactly once,
// at seed time, and NOTHING in the application could legally change a value
// afterwards: any plain UPDATE aborts with PLATFORM_CONFIG_UNAUDITED_UPDATE.
//
// That is why EN-8's grace window had never been enforced OR changed. Wiring the
// worker to read the key is half the job; without this writer the owner could
// read `grace_days_after_expiry = 0` in the console and have no way to make it 5.
//
// SNAPSHOT ENCODING — the trap in this table.
// `snapshot_json.$.val` is DOUBLY-encoded: value_json is itself JSON text, and
// the snapshot stores that TEXT as a JSON string. connection.ts:1002-1006 says
// so explicitly ("value_json='30' -> snapshot.val=\"30\""). Build the snapshot
// with `val: value_json` inside a JSON.stringify of the whole object and the
// encoding comes out right; hand-concatenate it and trg_pc_atomic_audit rejects
// the write with no explanation of why.
//
// THE HASH. `revision_hash` is not checked for any particular derivation by the
// triggers — only for linkage. It is derived here deterministically from
// (key, version, value_json, value_type, prev_revision_hash) so the chain is
// independently re-computable from the history rows alone, which is the whole
// point of keeping one.
import { createHash, randomUUID } from "node:crypto";
import { rawDb } from "../db/connection";

export const GENESIS_PREV_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

export type ConfigValueType = "string" | "number" | "boolean" | "json";

export class PlatformConfigWriteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlatformConfigWriteError";
  }
}

export function computeRevisionHash(input: {
  key: string;
  version: number;
  valueJson: string;
  valueType: ConfigValueType;
  prevRevisionHash: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.key,
        String(input.version),
        input.valueJson,
        input.valueType,
        input.prevRevisionHash,
      ].join("\u0000"),
    )
    .digest("hex");
}

export interface ConfigRow {
  key: string;
  valueJson: string;
  valueType: ConfigValueType;
  version: number;
  revisionHash: string;
  prevRevisionHash: string;
  description: string | null;
  updatedAt: string;
}

export function readConfigRow(key: string): ConfigRow | null {
  const db: any = rawDb();
  const r = db
    .prepare(
      `SELECT key, value_json, value_type, version, revision_hash,
              prev_revision_hash, description, updated_at
         FROM platform_config WHERE key = ?`,
    )
    .get(key);
  if (!r) return null;
  return {
    key: String(r.key),
    valueJson: String(r.value_json),
    valueType: r.value_type as ConfigValueType,
    version: Number(r.version),
    revisionHash: String(r.revision_hash),
    prevRevisionHash: String(r.prev_revision_hash),
    description: r.description ?? null,
    updatedAt: String(r.updated_at),
  };
}

/**
 * Update an EXISTING config key, writing the history row first so
 * trg_pc_atomic_audit is satisfied, both inside one transaction so a partial
 * write can never leave a history row without its current-state counterpart.
 *
 * `valueJson` must be JSON TEXT — `"30"` for the number thirty, `'"warn"'` for
 * the string warn. It is validated here rather than in SQL so the caller gets a
 * message instead of a CHECK-constraint abort.
 */
export function updatePlatformConfigValue(input: {
  key: string;
  valueJson: string;
  changedBy: string;
  /** Optimistic-concurrency guard: refuse if the row has moved on. */
  expectedVersion?: number;
}): ConfigRow {
  const db: any = rawDb();
  const current = readConfigRow(input.key);
  if (!current) {
    throw new PlatformConfigWriteError(
      "CONFIG_KEY_NOT_FOUND",
      `platform_config has no key '${input.key}'. New keys must be created through the seeded genesis path.`,
    );
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
    throw new PlatformConfigWriteError(
      "CONFIG_VERSION_CONFLICT",
      `Expected version ${input.expectedVersion} but the row is at ${current.version}.`,
    );
  }
  try {
    JSON.parse(input.valueJson);
  } catch {
    throw new PlatformConfigWriteError(
      "CONFIG_VALUE_NOT_JSON",
      `value must be JSON text (got ${JSON.stringify(input.valueJson).slice(0, 60)}). A number is "30"; a string is "\\"warn\\"".`,
    );
  }
  /* The value_type is NOT changeable here: a key that flips from number to
     string breaks every reader. Type changes are a migration, not a config
     write. */
  const parsed = JSON.parse(input.valueJson);
  const actualType =
    typeof parsed === "number"
      ? "number"
      : typeof parsed === "boolean"
        ? "boolean"
        : typeof parsed === "string"
          ? "string"
          : "json";
  if (actualType !== current.valueType) {
    throw new PlatformConfigWriteError(
      "CONFIG_VALUE_TYPE_MISMATCH",
      `Key '${input.key}' is declared '${current.valueType}'; the supplied value is '${actualType}'.`,
    );
  }

  const nextVersion = current.version + 1;
  const prev = current.revisionHash;
  const revisionHash = computeRevisionHash({
    key: input.key,
    version: nextVersion,
    valueJson: input.valueJson,
    valueType: current.valueType,
    prevRevisionHash: prev,
  });
  /* DOUBLY-ENCODED `val` — see the header. */
  const snapshot = JSON.stringify({
    v: nextVersion,
    key: input.key,
    vt: current.valueType,
    val: input.valueJson,
  });
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO platform_config_history
         (history_id, config_key, version, snapshot_json, prev_revision_hash,
          revision_hash, changed_at, changed_by, change_kind)
       VALUES (?,?,?,?,?,?,?,?,'update')`,
    ).run(
      `pch_${randomUUID()}`,
      input.key,
      nextVersion,
      snapshot,
      prev,
      revisionHash,
      now,
      input.changedBy,
    );
    db.prepare(
      `UPDATE platform_config
          SET value_json=?, version=?, prev_revision_hash=?, revision_hash=?, updated_at=?
        WHERE key=?`,
    ).run(input.valueJson, nextVersion, prev, revisionHash, now, input.key);
  });
  tx();

  const after = readConfigRow(input.key);
  if (!after || after.version !== nextVersion) {
    throw new PlatformConfigWriteError(
      "CONFIG_WRITE_NOT_OBSERVED",
      "The config update did not land. Refusing to report success.",
    );
  }
  return after;
}

/**
 * Create a NEW config key through the genesis path.
 *
 * WAVE 11 / EN-9 — needed because `trg_pc_no_direct_insert`
 * (connection.ts:1035) rejects any INSERT into `platform_config` that is not
 * matched, content-for-content, by a `change_kind='genesis'` history row at
 * version 1 with a 64-zero prev hash. A migration cannot compute that hash in
 * SQL, so new keys are seeded from TypeScript by the wave's self-heal installer.
 *
 * IDEMPOTENT: if the key already exists this returns the existing row untouched.
 * That matters for A-22 — the sacred bootstrap re-runs on every boot, and a
 * second genesis insert would abort on the primary key.
 */
export function ensurePlatformConfigKey(input: {
  key: string;
  valueJson: string;
  valueType: ConfigValueType;
  description: string;
  createdBy: string;
}): ConfigRow {
  const existing = readConfigRow(input.key);
  if (existing) return existing;

  try {
    JSON.parse(input.valueJson);
  } catch {
    throw new PlatformConfigWriteError(
      "CONFIG_VALUE_NOT_JSON",
      `value must be JSON text (got ${JSON.stringify(input.valueJson).slice(0, 60)}).`,
    );
  }
  const parsed = JSON.parse(input.valueJson);
  const actualType =
    typeof parsed === "number"
      ? "number"
      : typeof parsed === "boolean"
        ? "boolean"
        : typeof parsed === "string"
          ? "string"
          : "json";
  if (actualType !== input.valueType) {
    throw new PlatformConfigWriteError(
      "CONFIG_VALUE_TYPE_MISMATCH",
      `Declared '${input.valueType}' but the supplied value is '${actualType}'.`,
    );
  }

  const db: any = rawDb();
  const revisionHash = computeRevisionHash({
    key: input.key,
    version: 1,
    valueJson: input.valueJson,
    valueType: input.valueType,
    prevRevisionHash: GENESIS_PREV_HASH,
  });
  /* DOUBLY-ENCODED `val`, same convention as the update path. */
  const snapshot = JSON.stringify({
    v: 1,
    key: input.key,
    vt: input.valueType,
    val: input.valueJson,
  });
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO platform_config_history
         (history_id, config_key, version, snapshot_json, prev_revision_hash,
          revision_hash, changed_at, changed_by, change_kind)
       VALUES (?,?,1,?,?,?,?,?,'genesis')`,
    ).run(
      `pch_${randomUUID()}`,
      input.key,
      snapshot,
      GENESIS_PREV_HASH,
      revisionHash,
      now,
      input.createdBy,
    );
    db.prepare(
      `INSERT INTO platform_config
         (key, value_json, value_type, description, is_secret, version,
          prev_revision_hash, revision_hash, created_at, updated_at,
          created_by, updated_by)
       VALUES (?,?,?,?,0,1,?,?,?,?,?,?)`,
    ).run(
      input.key,
      input.valueJson,
      input.valueType,
      input.description,
      GENESIS_PREV_HASH,
      revisionHash,
      now,
      now,
      input.createdBy,
      input.createdBy,
    );
  });
  tx();

  const after = readConfigRow(input.key);
  if (!after) {
    throw new PlatformConfigWriteError(
      "CONFIG_WRITE_NOT_OBSERVED",
      `Genesis insert of '${input.key}' did not land. Refusing to report success.`,
    );
  }
  return after;
}
