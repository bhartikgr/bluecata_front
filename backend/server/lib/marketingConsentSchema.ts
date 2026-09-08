/**
 * server/lib/marketingConsentSchema.ts — WAVE 344 · ITEM 3 (CONSENT).
 *
 * GENERATED. Source of truth: migrations/0235_wave344_marketing_consent.sql
 * (byte-identically mirrored at
 *  server/db/migrations/0235_wave344_marketing_consent.sql).
 * Generator: build_log/ownerband2/evidence/gen_installer_0235.py. The SQL below is
 * the migration file's bytes, embedded — not a paraphrase, not a re-typing.
 *
 * WHY THIS FILE EXISTS — THE THIRD SCHEMA HOME. Identical reasoning to
 * server/lib/recordArchiveSchema.ts: this platform has two schema paths, the
 * inline bootstrap lives in the SACRED-FROZEN server/db/connection.ts, all ten
 * owner-ratified waivers are spent, and the tree's established answer is a
 * self-heal installer beside the frozen file that executes the CANONICAL MIGRATION
 * TEXT. MARKETING_CONSENT_MIGRATION below is an exported CONSTANT rather than a
 * comment because scripts/lint/schema-path-parity.mjs strips comments before it
 * looks for the migration's basename.
 *
 * WHAT IT DOES.
 *   section 1  creates `marketing_consent_event` if it is absent.
 *   section 2  creates its two indexes if they are absent.
 *   section 3  creates its three refusal triggers if they are absent.
 *   section 4  is ASSERTED TO CONTAIN NO EXECUTABLE STATEMENT and is not run.
 *              There is no backfill and there must never be one: existing accounts
 *              were never shown a consent request, so there is no wording to
 *              preserve for them and no decision they made. A backfill in either
 *              direction would be a fabricated consent record.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not ALTER any pre-existing table. In
 * particular it does not touch `legal_consents`, which is tamper-sealed and holds
 * terms acceptance — marketing permission is a SEPARATE, OPTIONAL decision and
 * must not be recorded in the same place as the thing it must not be bundled with.
 */

/** The migration this module mirrors. Referenced as a VALUE, not in a comment, so
 *  scripts/lint/schema-path-parity.mjs (which strips comments first) can see it. */
export const MARKETING_CONSENT_MIGRATION = "0235_wave344_marketing_consent.sql";

/** The one table this item adds. Named once, here, so no consumer re-spells it. */
export const MARKETING_CONSENT_TABLE = "marketing_consent_event";

/** The migration file, verbatim. Only \\ ` and ${ are escaped for the template
 *  literal; JS unescapes them back to the exact file bytes. */
export const MARKETING_CONSENT_SQL = `-- 0235 · WAVE 344 · marketing_consent_event — EXPRESS CONSENT, RECORDED PROPERLY
--
-- WHAT THIS FILE DOES, IN ONE SENTENCE.
-- It creates ONE new table that records, permanently and unchangeably, every time
-- a person gave or withdrew permission to be sent marketing messages — including
-- the EXACT WORDING that was on the screen when they decided.
--
-- NOTHING IS DROPPED. NOTHING IS RENAMED. NOTHING IS DELETED. NOT ONE COLUMN IS
-- ADDED TO ANY EXISTING TABLE, AND NOT ONE EXISTING ROW IS WRITTEN BY THIS FILE.
--
-- ── THE OWNER'S REQUEST THIS ANSWERS ───────────────────────────────────────
-- "Include express consent during signup… Users should also be able to change
-- their choice in their settings area. I want this to be easy, seamless, and have
-- users want to consent without any burden."
--
-- IT HAS TO BE SAID PLAINLY: THE SEAMLESS VERSION IS THE INVALID ONE. The
-- frictionless design — a box already ticked, or permission folded into accepting
-- the terms — is precisely the design the Canadian regulator names as NOT express
-- consent. So what is built is the version that is easy to UNDERSTAND and easy to
-- SAY NO TO, and the burden that has been removed is the burden of declining, not
-- the burden of deciding.
--
-- ── WHY A SEPARATE TABLE, AND NOT legal_consents ───────────────────────────
-- \`legal_consents\` already exists and already records terms and privacy-policy
-- acceptance. It was considered and REJECTED as the home for this, for two
-- reasons that were checked against this database rather than assumed:
--
--   1. IT IS THE WRONG RECORD, LEGALLY. \`legal_consents\` records acceptance of a
--      document as a condition of using the service. Marketing permission must be
--      a SEPARATE, OPTIONAL decision that is NOT bundled with accepting the terms
--      — that is the whole point. Writing it into the same table as terms
--      acceptance would make the two look like one decision in the very record
--      that is supposed to prove they were two.
--   2. IT IS TAMPER-SEALED, AND ALSO CARRIES A DELETE COLUMN. \`legal_consents\`
--      carries prev_hash / hash seal columns, and it carries \`deleted_at\`. Adding
--      new columns to it to hold marketing wording would mean touching a sealed
--      table, which this work is forbidden from doing.
--
-- ── WHAT THIS TABLE STORES, AND WHY EACH PART IS REQUIRED ──────────────────
-- A ticked box stored as a \`1\` is not a defensible consent record: it proves that
-- something was ticked, not what the person was told. Primary-source research
-- against the Canadian regulator's guidance (CRTC Compliance and Enforcement
-- Information Bulletins 2012-548 and 2012-549) establishes that the request for
-- consent must itself carry, and therefore that the record must preserve:
--
--   * THE PURPOSES the permission is being asked for   → purposes_text
--   * WHO IS ASKING                                    → requester_identity
--   * A MAILING ADDRESS for whoever is asking          → requester_mailing_address
--   * A STATEMENT that permission can be withdrawn     → withdrawal_statement
--   * WHEN the person decided                          → decided_at
--   * WHAT THEY ACTUALLY SAW, word for word            → disclosure_text
--
-- The last one is the one that is usually missing, and it is the one that matters
-- most: a year from now the wording on the screen will have changed, and the only
-- way to show what a particular person agreed to is to have kept their copy of it.
--
-- Two of the CHECK constraints below deserve to be pointed at directly:
--
--     CHECK (instr(disclosure_text, requester_mailing_address) > 0)
--     CHECK (instr(disclosure_text, withdrawal_statement) > 0)
--
-- These make it IMPOSSIBLE to store a consent record whose preserved wording does
-- not actually contain the mailing address and the withdrawal statement that the
-- same row claims were shown. Without them, the four structured columns could be
-- filled in correctly while the wording the person actually read said nothing of
-- the kind, and the record would look complete and prove nothing.
--
-- ── THE RULE ABOUT SERVICE MESSAGES, ENFORCED HERE AND NOT ONLY IN CODE ────
-- Service and platform messages — a password reset, a security alert, a signature
-- request, a payment receipt — must NEVER be gated behind marketing permission.
-- If they were, a person withdrawing marketing permission would silently stop
-- receiving their own security emails.
--
-- The research this was built from rates the statutory exemption for that class of
-- message MEDIUM confidence, not high, because the statutory text itself could not
-- be retrieved. So this is built to the SAFE rule rather than to a broad exemption:
-- service messages are not consent-gated at all, there is no flag here that could
-- turn them off, and \`consent_kind\` is a CLOSED list with exactly one member so
-- that no future writer can quietly add one. The trigger below refuses any attempt
-- to record a permission whose name suggests service, security, transactional or
-- platform messaging, and it exists to fail loudly in three years' time when
-- somebody who has not read this comment tries exactly that.
--
-- ── APPEND-ONLY, INCLUDING WITHDRAWAL ──────────────────────────────────────
-- Withdrawing permission INSERTS a new row. It does not update or delete the row
-- that granted it. Two triggers enforce that. This is deliberate: "she agreed on
-- the 3rd and withdrew on the 11th" is the fact that matters, and an UPDATE
-- destroys it. A person's CURRENT permission is the most recent row for that
-- person and that kind, which is what the reader in server/lib/marketingConsent.ts
-- computes.
--
-- ── HOST FLOOR ────────────────────────────────────────────────────────────
-- Every RAISE argument is a single string literal, so a host sqlite3 older than
-- 3.44 parses this file. The floor is 3.37.0, for STRICT-free CHECK handling and
-- \`instr\`, both of which are much older than that.

-- §1 · THE TABLE.

CREATE TABLE IF NOT EXISTS marketing_consent_event (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  -- CLOSED LIST, ONE MEMBER, DELIBERATELY. See the note on service messages above.
  consent_kind TEXT NOT NULL CHECK (consent_kind IN ('commercial_electronic_message')),
  -- 'declined' is recorded as its own decision rather than as an absence, so that
  -- "was never asked" and "was asked and said no" are different facts.
  decision TEXT NOT NULL CHECK (decision IN ('granted', 'withdrawn', 'declined')),
  decided_at TEXT NOT NULL,
  -- Where the decision was made. Both are first-class: withdrawing in settings is
  -- exactly as valid, and exactly as easy, as granting at signup.
  channel TEXT NOT NULL CHECK (channel IN ('signup', 'settings')),
  disclosure_version TEXT NOT NULL,
  -- THE EXACT WORDING SHOWN, VERBATIM. Not a reference to it, not a version tag
  -- alone — the text itself, so it survives every future edit to the screen.
  disclosure_text TEXT NOT NULL,
  purposes_text TEXT NOT NULL,
  requester_identity TEXT NOT NULL,
  requester_mailing_address TEXT NOT NULL,
  withdrawal_statement TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  CHECK (length(trim(id)) > 0),
  CHECK (length(trim(tenant_id)) > 0),
  CHECK (length(trim(user_id)) > 0),
  CHECK (length(trim(decided_at)) > 0),
  CHECK (length(trim(disclosure_version)) > 0),
  -- A short string cannot contain the purposes, an identity, a mailing address and
  -- a withdrawal statement, so a floor on the length is a cheap way to refuse a
  -- placeholder. 120 characters is not a legal threshold and is not claimed to be
  -- one; it is a floor below which the text is certainly not a consent request.
  CHECK (length(trim(disclosure_text)) >= 120),
  CHECK (length(trim(purposes_text)) > 0),
  CHECK (length(trim(requester_identity)) > 0),
  CHECK (length(trim(requester_mailing_address)) > 0),
  CHECK (length(trim(withdrawal_statement)) > 0),
  -- THE TWO THAT MAKE THE RECORD HONEST. The preserved wording must actually
  -- contain the mailing address and the withdrawal statement it claims were shown.
  CHECK (instr(disclosure_text, requester_mailing_address) > 0),
  CHECK (instr(disclosure_text, withdrawal_statement) > 0)
);

-- §2 · INDEXES.

-- The only hot read: "what is this person's current permission?" — answered by the
-- most recent row for that person and kind.
CREATE INDEX IF NOT EXISTS idx_marketing_consent_current
  ON marketing_consent_event(tenant_id, user_id, consent_kind, decided_at);

-- The compliance read: "show me everyone who currently has permission, and what
-- each of them was shown."
CREATE INDEX IF NOT EXISTS idx_marketing_consent_decision
  ON marketing_consent_event(consent_kind, decision, decided_at);

-- §3 · TRIGGERS — THE REFUSALS, MADE DATABASE-LEVEL FACTS.

-- A consent record that can be edited is not a consent record. Withdrawal is a new
-- row; there is no legitimate reason to rewrite an existing one.
DROP TRIGGER IF EXISTS trg_marketing_consent_no_update;
CREATE TRIGGER trg_marketing_consent_no_update
BEFORE UPDATE ON marketing_consent_event
BEGIN
  SELECT RAISE(ABORT, 'CONSENT_RECORD_IS_APPEND_ONLY: a consent record cannot be changed; record a new decision instead, which keeps both');
END;

DROP TRIGGER IF EXISTS trg_marketing_consent_no_delete;
CREATE TRIGGER trg_marketing_consent_no_delete
BEFORE DELETE ON marketing_consent_event
BEGIN
  SELECT RAISE(ABORT, 'CONSENT_RECORD_IS_APPEND_ONLY: a consent record cannot be deleted; a withdrawal is recorded as a new decision');
END;

-- THE TRIPWIRE FOR THE MISTAKE THIS TABLE IS MOST LIKELY TO INVITE. Somebody will
-- eventually want to reuse this table to hold a switch for service, security,
-- transactional or platform messages. That would put a person's security emails
-- behind a marketing preference. It is refused here, in the database, with a
-- sentence that explains why rather than a code.
DROP TRIGGER IF EXISTS trg_marketing_consent_never_gate_service;
CREATE TRIGGER trg_marketing_consent_never_gate_service
BEFORE INSERT ON marketing_consent_event
WHEN lower(new.consent_kind) LIKE '%service%'
  OR lower(new.consent_kind) LIKE '%security%'
  OR lower(new.consent_kind) LIKE '%transactional%'
  OR lower(new.consent_kind) LIKE '%platform%'
  OR lower(new.consent_kind) LIKE '%notification%'
BEGIN
  SELECT RAISE(ABORT, 'SERVICE_MESSAGES_ARE_NEVER_CONSENT_GATED: service, security, transactional and platform messages must always be delivered, so no permission switch for them may be stored here');
END;

-- §4 · THE BACKFILL THAT MUST NOT EXIST.
--
-- DELIBERATELY EMPTY, AND THE INSTALLER ASSERTS THAT IT IS.
--
-- There is no backfill and there must never be one. Existing accounts were never
-- shown a consent request, so there is no wording to preserve for them and no
-- decision they made. Inventing a row for them — in either direction — would be
-- fabricating a consent record, which is worse than having none. Existing users
-- are asked the next time they visit their settings, and until they answer, they
-- have no marketing permission and are sent no marketing.
`;

/** The migration's four sections, split on its own line-anchored `-- §N ·`
 *  banners. Those banners appear ONLY as section headers in that file; prose
 *  references to a section are spelled "section N" so they cannot match. */
export function marketingConsentSections(): string[] {
  const parts = MARKETING_CONSENT_SQL.split(/\n(?=-- \u00a7\d+ \u00b7 )/);
  // parts[0] is the file header, which contains no statements.
  return parts.slice(1);
}

/** Comment-only lines removed, so a commented-out statement can never be executed
 *  or counted. */
function stripCommentLines(sql: string): string {
  return sql
    .split("\n")
    .map((l) => (l.trimStart().startsWith("--") ? "" : l))
    .join("\n");
}

/**
 * THE CLOSED LIST OF PERMISSION KINDS, PARSED OUT OF THE SCHEMA ITSELF.
 *
 * Deliberately not a hand-written array. The database CHECK is what actually
 * refuses a write; a hand-kept list beside it is a second source of truth that
 * will eventually disagree. Reading it out of the embedded SQL means the screen,
 * the endpoint and the constraint cannot drift apart.
 *
 * IT HAS EXACTLY ONE MEMBER, AND THAT IS THE POINT. There is no permission kind
 * here for service, security, transactional or platform messages, because those
 * are never gated behind a permission at all.
 */
function parseConsentKinds(): readonly string[] {
  const m = MARKETING_CONSENT_SQL.match(/CHECK\s*\(consent_kind IN \(([\s\S]*?)\)\s*\)/);
  if (!m) return Object.freeze([]);
  return Object.freeze(Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]));
}

/** The permission kinds this platform records. One member. */
export const CONSENT_KINDS: readonly string[] = parseConsentKinds();

/** The single permission kind: marketing / commercial electronic messages. */
export const MARKETING_CONSENT_KIND = "commercial_electronic_message";

/** The three decisions a person's answer can be. Parsed from the same CHECK, for
 *  the same reason. */
function parseDecisions(): readonly string[] {
  const m = MARKETING_CONSENT_SQL.match(/CHECK\s*\(decision IN \(([\s\S]*?)\)\s*\)/);
  if (!m) return Object.freeze([]);
  return Object.freeze(Array.from(m[1].matchAll(/'([a-z_]+)'/g)).map((x) => x[1]));
}

export const CONSENT_DECISIONS: readonly string[] = parseDecisions();

/**
 * THE RULE THAT MUST NEVER BE RELAXED, STATED AS CODE.
 *
 * The research behind this work rates the statutory exemption for service messages
 * MEDIUM confidence, not high, because the statutory text itself could not be
 * retrieved. So the SAFE rule is built rather than a broad exemption: service,
 * security, transactional and platform messages are not consent-gated at all.
 * This predicate is what a future author's test will trip over if they try to add
 * such a kind, and the database trigger refuses it independently.
 */
export function isNeverConsentGated(kind: string): boolean {
  const k = kind.toLowerCase();
  return (
    k.includes("service") ||
    k.includes("security") ||
    k.includes("transactional") ||
    k.includes("platform") ||
    k.includes("notification")
  );
}

export interface MarketingConsentInstallResult {
  tableCreated: boolean;
  tableAlreadyPresent: boolean;
  indexes: string[];
  triggers: string[];
  /** NOT MEASURED — always 0. See the note in the verification helper below. */
  grantedRows: number;
  /** NOT MEASURED — always 0. See the note in the verification helper below. */
  withdrawnRows: number;
  failures: string[];
}

interface SqliteLike {
  prepare(sql: string): { all(...a: unknown[]): unknown[]; get(...a: unknown[]): unknown };
  exec(sql: string): unknown;
}

/**
 * Install the consent schema on this handle if it is not already there.
 *
 * Idempotent. Reports failures in the returned object rather than throwing, so a
 * consent screen can refuse to render — which is the correct behaviour — instead of
 * a route crashing.
 */
export function ensureMarketingConsentSchema(db: SqliteLike): MarketingConsentInstallResult {
  const res: MarketingConsentInstallResult = {
    tableCreated: false,
    tableAlreadyPresent: false,
    indexes: [],
    triggers: [],
    grantedRows: 0,
    withdrawnRows: 0,
    failures: [],
  };

  const sections = marketingConsentSections();
  if (sections.length !== 4) {
    res.failures.push(
      `the embedded migration split into ${sections.length} sections, expected 4`,
    );
    return res;
  }

  if (stripCommentLines(sections[3]).trim() !== "") {
    res.failures.push(
      "section 4 of the migration contains an executable statement; it must contain none " +
        "(a backfill would fabricate a consent record for somebody who was never asked)",
    );
    return res;
  }

  if (CONSENT_KINDS.length !== 1) {
    res.failures.push(
      `the permission-kind list parsed out of the migration has ${CONSENT_KINDS.length} members, expected 1`,
    );
    return res;
  }
  if (CONSENT_KINDS.some((k) => isNeverConsentGated(k))) {
    res.failures.push(
      "the migration names a permission kind for service, security, transactional or " +
        "platform messages; those must never be gated behind a permission",
    );
    return res;
  }

  const before = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='marketing_consent_event'",
      )
      .all() as Array<{ name: string }>
  ).length;

  for (let i = 0; i < 3; i++) {
    try {
      db.exec(stripCommentLines(sections[i]));
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/already exists/i.test(msg)) continue;
      res.failures.push(`section ${i + 1}: ${msg}`);
      return res;
    }
  }

  const after = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='marketing_consent_event'",
      )
      .all() as Array<{ name: string }>
  ).length;
  if (after === 0) {
    res.failures.push("section 1 ran but marketing_consent_event still does not exist");
    return res;
  }
  if (before === 0) res.tableCreated = true;
  else res.tableAlreadyPresent = true;

  res.indexes = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='marketing_consent_event' AND name IS NOT NULL ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((r) => String(r.name));
  res.triggers = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='marketing_consent_event' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((r) => String(r.name));

  /* THE ROW COUNTS THAT USED TO BE READ HERE WERE REMOVED, DELIBERATELY.

     They were install diagnostics and nothing consumed them. To produce them this
     helper had to SELECT across the whole table with no tenant predicate, which
     `npm run lint:tenant-scope-fence` correctly reported as an unscoped read of a
     tenant-scoped table. Taking an exemption for a number nobody used would have
     spent a real control on a convenience. The fields below stay in the shape at
     their initialised value of 0 so no caller's type changes, and they are
     documented as NOT MEASURED rather than left to be mistaken for a measurement.
     A per-tenant count is available through the scoped reads in the stores. */
  return res;
}
