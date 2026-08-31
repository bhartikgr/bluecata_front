/**
 * WAVE 210 — WHERE THE SERVED LEGAL-CORPUS VERSION LIVES.
 *
 * ONE STRING, IN THE STORE THAT ALREADY PROVES ITS OWN HISTORY.
 *
 * The version identity is held in `platform_config` under
 * `legal.corpus.active_version`. No migration, no new table, no second store.
 * Reasons, in order:
 *
 *   1. `platform_config` is already hash-chained (`prev_revision_hash` →
 *      `revision_hash`), its history rows are undeletable by trigger, and
 *      `trg_pc_atomic_audit` makes every write atomically audited. A change to
 *      which legal text the platform serves is exactly the kind of act that
 *      needs to be provable after the fact.
 *   2. Wave 195 put the commit-currency declaration here and needed no
 *      migration. Wave 206 and the round-math disclosure store did the same.
 *      The pattern is worked, not invented here.
 *   3. A second store for one string is a second thing that can fall out of step
 *      with the consent ledger — and a served document out of step with the
 *      recorded document is the precise defect this wave exists to repair.
 *
 * Migration 0219 was reserved for this wave and is deliberately LEFT UNUSED.
 *
 * FAIL-SAFE DIRECTION. When the config row cannot be read — fresh database,
 * seeding not yet run, unexpected value — `readActiveLegalCorpusVersion()`
 * returns the ADOPTED version. That is the conservative answer, not the
 * permissive one: the adopted corpus is what the pages render by default, so the
 * fallback keeps the served text and the recorded version in agreement. Falling
 * back to a superseded version would do the opposite and would also make the
 * retired interim wording servable by a failed read, which item C forbids.
 */
import {
  ensurePlatformConfigKey,
  readConfigRow,
  updatePlatformConfigValue,
} from "./platformConfigWriter";
import {
  ADOPTED_LEGAL_CORPUS_VERSION,
  KNOWN_LEGAL_CORPUS_VERSIONS,
  LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY,
  isKnownLegalCorpusVersion,
} from "../../shared/wave210LegalCorpusVersion";

const CONFIG_DESCRIPTION =
  "Wave 210 — the legal corpus version the platform currently serves. Every consent row records the version displayed to the user. Superseded versions remain valid values for historical rows and are never removed.";

/**
 * Create the key if it does not exist. Idempotent: `ensurePlatformConfigKey`
 * returns the existing row untouched, so calling this on every boot never
 * rewrites a value an operator has deliberately set.
 */
export function ensureLegalCorpusVersionKey(createdBy = "wave210"): void {
  ensurePlatformConfigKey({
    key: LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY,
    valueJson: JSON.stringify(ADOPTED_LEGAL_CORPUS_VERSION),
    valueType: "string",
    description: CONFIG_DESCRIPTION,
    createdBy,
  });
}

/**
 * The version the platform serves right now.
 *
 * Never throws. A legal page and a consent write both call this; neither may be
 * broken by a config read, so every failure path resolves to the adopted
 * version rather than propagating.
 */
export function readActiveLegalCorpusVersion(): string {
  try {
    const row = readConfigRow(LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY);
    if (!row) return ADOPTED_LEGAL_CORPUS_VERSION;
    const parsed = JSON.parse(row.valueJson);
    if (isKnownLegalCorpusVersion(parsed)) return parsed as string;
    return ADOPTED_LEGAL_CORPUS_VERSION;
  } catch {
    return ADOPTED_LEGAL_CORPUS_VERSION;
  }
}

/** The config row itself, for surfaces that want the revision hash as evidence. */
export function readLegalCorpusVersionRow() {
  try {
    return readConfigRow(LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY);
  } catch {
    return null;
  }
}

/**
 * Move the served version. Refuses anything not in the known register, because
 * a consent row must never be able to name a version no document corresponds to.
 *
 * This exists so that retiring the interim text is REVERSIBLE BY AN AUDITED ACT
 * rather than by an edit — the superseded pages are retained in source and
 * render again if, and only if, this is called with their version. That is how
 * "retire without deleting" is implemented.
 */
export function setActiveLegalCorpusVersion(input: {
  version: string;
  changedBy: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!isKnownLegalCorpusVersion(input.version)) {
    return {
      ok: false,
      reason: `Unknown legal corpus version. Known versions are ${KNOWN_LEGAL_CORPUS_VERSIONS.join(", ")}.`,
    };
  }
  ensureLegalCorpusVersionKey(input.changedBy);
  updatePlatformConfigValue({
    key: LEGAL_CORPUS_ACTIVE_VERSION_CONFIG_KEY,
    valueJson: JSON.stringify(input.version),
    changedBy: input.changedBy,
  });
  return { ok: true };
}
