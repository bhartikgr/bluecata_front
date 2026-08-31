-- ═══════════════════════════════════════════════════════════════════════════════
-- WAVE 217 · R190.8 · Decision A9 — THE PARTNER COMPLIANCE ATTESTATION, ON THE
-- ROW IT IS MADE ON.
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THE OWNER ASKED FOR
--   A mandatory, blocking, recorded and audited attestation at Consortium Partner
--   registration that the Partner complies with all laws applicable to it and
--   holds any licence or registration its activities require; self-declaration as
--   the PRIMARY mechanism with evidence upload OPTIONAL; jurisdiction and
--   regulatory status in STRUCTURED form; and the result NEVER described as
--   "verified".
--
-- WHAT WAS TRUE BEFORE THIS MIGRATION, MEASURED — NOT ASSUMED
--   The Consortium Partner Agreement (signed, CPA-v1.0) was already displayed in
--   full at `client/src/pages/public/ConsortiumApplyPage.tsx:395-441`, with an
--   acknowledgement tick (`:430`) and a typed legal name (`:432-440`), and
--   §4 "Eligibility, Licensing & Regulatory Compliance" was already part of what
--   was ticked. `server/lib/requireSignedAgreement.ts` already blocks 96 partner
--   WRITE routes fail-closed for an unsigned partner.
--   What did NOT exist was any clause-specific, structured, separately provable
--   record: no regulatory status, no jurisdiction-linked declaration, no stored
--   declaration wording, and — the actual hole — NO SERVER ENFORCEMENT of the
--   tick or the name at all. The submit button's `disabled=` expression
--   (`ConsortiumApplyPage.tsx:484`) was the only gate. A direct
--   `POST /api/public/consortium/apply` AND a direct
--   `POST /api/consortium-applications` with NO tick and NO name each returned
--   **201 Created**, captured before any code was written and preserved at
--   build_log/wave217/W217_TESTS.md §1.
--   Full evidence, with quoted code: build_log/wave217/W217_PREFLIGHT.md.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ────────────────────────────────────────────
--   It creates NO table. It inserts NO row. It updates NO existing row. It drops
--   nothing, deletes nothing and expires nothing (R195.5 — NOTHING IS DELETED).
--   It adds NO jurisdiction column: `consortium_applications.jurisdiction`
--   ALREADY EXISTS (added by `migrations/0044_consortium_applications.sql:13`,
--   declared at `shared/schema.ts:2878`) and this wave REUSES it. Adding a second
--   jurisdiction field would be the two-versions-of-one-term defect that R187.2
--   and R187.5 name.
--   It does NOT touch `contacts.partner_agreement_signed_at`, the column
--   `requireSignedAgreement` reads. Making this attestation a precondition of
--   that gate would have 403'd every ALREADY-REGISTERED partner's writes the
--   moment it deployed — the owner said "do not break anything", and trapping a
--   partner out of their own account is far worse than a missing declaration for
--   one more day. That deliberate refusal is recorded in W217_PREFLIGHT.md
--   review pass (iii) and escalated to the owner as an unmade decision.
--
--   Every column added is NULLABLE with NO DEFAULT. Every application that
--   already exists therefore keeps exactly the values it has, and a reader can
--   still distinguish "this application predates the declaration" (NULL) from
--   "this application carries a declaration" — an absence is never converted
--   into a value (R176.1).
--
-- ── WHY THE RECORD LIVES HERE AND NOT IN `legal_consents` ──────────────────────
--   `legal_consents` (migrations/0005) is keyed on `tenant_id` and `user_id`. A
--   consortium application is made by a member of the public who has NO account
--   and NO tenant: at the moment of the declaration neither key exists. Writing
--   a NULL-keyed row into a per-tenant hash-chained ledger would corrupt the very
--   chain that makes it evidence. The declaration therefore lives on the row it
--   is made on, which already carries its own hash chain (`prev_hash`,
--   `curr_hash`) and its own server-observed `source_ip` and
--   `source_user_agent`. This is a reasoned choice, not a second consent store:
--   see W217_PREFLIGHT.md review pass (i) — R171.1.
--
-- ── THE UPSERT AUDIT (§5.10) ───────────────────────────────────────────────────
--   Every write path on `consortium_applications` was enumerated in the source
--   before this migration was written:
--     · `server/consortiumApplyStore.ts:695`  — INSERT (submitApplication)
--     · `server/consortiumApplyStore.ts:1417` — UPDATE ... WHERE id (approve)
--     · `server/consortiumApplyStore.ts:1687` — UPDATE ... WHERE id (reject)
--     · `server/consortiumApplyStore.ts:1762` — UPDATE ... WHERE id (withdraw)
--   There is NO `onConflictDoUpdate` and NO raw-SQL writer on this table, so the
--   R177.1 / R181.1 hazard — a new column present in `values()` but absent from a
--   conflict `set()`, silently dropped on the second write — IS NOT REACHABLE
--   here. Recorded because it was checked, not because it was assumed. The three
--   UPDATEs deliberately do not touch these columns: a declaration is made once,
--   at submission, and an approver must never be able to alter what an applicant
--   declared.
--
-- ── SQLITE DIALECT ─────────────────────────────────────────────────────────────
--   One `ADD COLUMN` per statement: SQLite's ALTER TABLE takes exactly one.
--   `IF NOT EXISTS` is NOT supported on ADD COLUMN in SQLite, so this file is
--   NOT re-runnable by design; `server/db/migrate.ts` records applied filenames
--   and will not re-run it.
--
-- ── ROLLBACK ───────────────────────────────────────────────────────────────────
--   SQLite cannot DROP COLUMN below 3.35. There is no down-migration and none is
--   wanted: the columns are nullable, unread by any pre-217 code path, and
--   dropping them would destroy legal declarations. To disable the feature,
--   revert the application code; leave the data.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. WHEN the declaration was made. Server clock only — never client-supplied
--    (R187.1). NULL means "no declaration on this row", which is the truth for
--    every application submitted before this wave.
ALTER TABLE consortium_applications ADD COLUMN compliance_attested_at TEXT;

-- 2. WHICH WORDING was assented to. Currently "W217-COMPLIANCE-v1/CPA-v1.0" —
--    the attestation version and the signed-agreement version it quotes, joined,
--    because a declaration against CPA-v1.0's §4 is not a declaration against a
--    future CPA-v2.0's §4. Bumped, never mutated in place.
ALTER TABLE consortium_applications ADD COLUMN compliance_attestation_version TEXT;

-- 3. THE EXACT TEXT the applicant was shown and assented to, stored verbatim.
--    Not a hash and not a reference: in a dispute the question is what the words
--    said, and a hash cannot answer it. The server rebuilds this sentence from
--    the shared constant and refuses the submission unless the received bytes
--    match byte-for-byte, so this column cannot hold a paraphrase.
ALTER TABLE consortium_applications ADD COLUMN compliance_attestation_text TEXT;

-- 4. THE STRUCTURED REGULATORY POSITION. The CHECK is the point: handbook §11 —
--    PREFER A CONSTRAINT TO A PROHIBITION. A sixth value cannot be introduced by
--    a future wave, a careless brief or a forged HTTP body, because the database
--    refuses it. NULL is permitted for the pre-217 rows only; the HTTP boundary
--    requires one of the five on every new submission.
--    "exempt", "not_required" and "unsure" are ACCEPTED answers and block
--    nothing. Whether to refuse an unlicensed partner is a commercial decision
--    the owner has not made, and this schema does not pre-empt it.
ALTER TABLE consortium_applications ADD COLUMN regulatory_status TEXT
  CHECK (regulatory_status IS NULL OR regulatory_status IN
    ('licensed', 'registered', 'exempt', 'not_required', 'unsure'));

-- 5. OPTIONAL licence or registration reference. NULL is a NORMAL, EXPECTED and
--    UNPENALISED value: many jurisdictions issue no such document, and an exempt
--    or unregulated Partner has nothing to give. The server NEVER checks this
--    column's presence, and a test drives a successful registration with it
--    empty and status 'exempt'.
ALTER TABLE consortium_applications ADD COLUMN compliance_evidence_ref TEXT;

-- 6. Find the declared-but-unreviewed applications, and answer "which partners
--    said they were unsure?" without a table scan. Partial-safe: SQLite indexes
--    NULLs, and the queries that matter filter on a non-NULL status.
CREATE INDEX IF NOT EXISTS idx_consortium_apps_regulatory_status
  ON consortium_applications (regulatory_status, status);
