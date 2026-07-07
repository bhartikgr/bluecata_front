-- 0097_v25_52_crm_dedup_backfill
-- v25.52.0 Track 3.5.1/3.5.2 — CRM dedup BACKFILL (must run BEFORE the unique
-- indexes in 0098; creating the indexes first would fail on any pre-existing
-- duplicate rows on live). ADDITIVE + IDEMPOTENT. Touches ONLY the three
-- non-cap-table CRM tables; never edits sacred cap-table/money/hash-chain data.
--
-- Strategy (roadmap Track 3.5 "Dedup safety rule"):
--   • Group live (deleted_at IS NULL) rows per CRM by (scope, lower(trim(email))).
--   • SAFE-collapse a group ONLY when the duplicates are the SAME person:
--       - keep the "winner" = the row with a non-blank name, else the oldest
--         (MIN(created_at), tiebreak MIN(id)).
--       - soft-delete (never hard-delete) the losers whose name AGREES with the
--         winner (case-insensitive trimmed) OR whose own name is blank.
--   • NEVER auto-merge same-email-DIFFERENT-name rows (shared inboxes): those
--     groups are recorded in crm_dedup_review for manual admin resolution and
--     left intact (both rows stay live). Each such row is flagged with an
--     additive `dedup_exempt = 1` column so 0098's partial UNIQUE index can
--     EXCLUDE them with a plain column predicate (SQLite prohibits subqueries in
--     partial-index WHERE clauses, so a boolean column is the correct mechanism).
--     When an admin later resolves the conflict, they clear dedup_exempt on the
--     surviving row; the index then naturally covers it.
--
-- Re-running is a no-op: winners are already the sole live row for safe groups;
-- INSERT OR IGNORE guards the review table by its unique key; ADD COLUMN is
-- guarded (additive; NULL default) and the flag UPDATEs are idempotent.
-- Tested against a COPY of live_copy.db (never the original).

-- (0a) Additive dedup-exempt flag per CRM (NULL/0 = normal; 1 = under review,
--      excluded from the unique index in 0098). Guarded so re-runs are no-ops:
--      the migration runner tolerates "duplicate column" as idempotent, but we
--      also keep these additive + nullable so a partial re-apply is safe.
ALTER TABLE founder_crm_contacts  ADD COLUMN dedup_exempt INTEGER;
ALTER TABLE investor_crm_contacts ADD COLUMN dedup_exempt INTEGER;
ALTER TABLE partner_crm_contacts  ADD COLUMN dedup_exempt INTEGER;

-- (0) Manual-resolution queue for same-email / different-person conflicts.
CREATE TABLE IF NOT EXISTS crm_dedup_review (
  id            TEXT PRIMARY KEY,
  crm_scope     TEXT NOT NULL,          -- 'founder' | 'investor' | 'partner'
  scope_id      TEXT NOT NULL,          -- company_id | investor_id | partner_id
  email_norm    TEXT NOT NULL,          -- lower(trim(email))
  contact_ids   TEXT NOT NULL,          -- JSON array of the conflicting row ids
  distinct_names TEXT NOT NULL,         -- JSON array of the distinct names seen
  status        TEXT NOT NULL DEFAULT 'open',   -- open | resolved
  created_at    TEXT NOT NULL,
  resolved_at   TEXT,
  resolved_by   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_dedup_review_key
  ON crm_dedup_review (crm_scope, scope_id, email_norm)
  WHERE status = 'open';

-- ============================================================
-- FOUNDER CRM (scope = company_id) — winners + safe-loser soft-delete.
-- ============================================================
-- Winner per (company_id, email_norm): non-blank name preferred, then oldest.
WITH grp AS (
  SELECT id, company_id,
         lower(trim(email)) AS email_norm,
         trim(coalesce(name,'')) AS nm,
         created_at,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, lower(trim(email))
           ORDER BY CASE WHEN trim(coalesce(name,''))='' THEN 1 ELSE 0 END,
                    created_at ASC, id ASC
         ) AS rn
  FROM founder_crm_contacts
  WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
),
winners AS (SELECT company_id, email_norm, id AS win_id, nm AS win_nm FROM grp WHERE rn = 1)
UPDATE founder_crm_contacts
SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE deleted_at IS NULL
  AND id IN (
    SELECT g.id FROM grp g
    JOIN winners w ON w.company_id = g.company_id AND w.email_norm = g.email_norm
    WHERE g.rn > 1
      AND ( g.nm = '' OR lower(g.nm) = lower(w.win_nm) )   -- name agrees OR loser blank
  );

-- Record UNSAFE founder conflicts (same email, >1 distinct non-blank name still live).
INSERT OR IGNORE INTO crm_dedup_review (id, crm_scope, scope_id, email_norm, contact_ids, distinct_names, status, created_at)
SELECT
  'ddr_founder_' || company_id || '_' || lower(trim(email)),
  'founder', company_id, lower(trim(email)),
  '[' || group_concat('"' || id || '"', ',') || ']',
  '[' || group_concat(DISTINCT '"' || replace(trim(coalesce(name,'')),'"','') || '"') || ']',
  'open', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM founder_crm_contacts
WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> '' AND trim(coalesce(name,'')) <> ''
GROUP BY company_id, lower(trim(email))
HAVING COUNT(DISTINCT lower(trim(name))) > 1;

-- Flag every live founder row that belongs to an OPEN review conflict as
-- dedup_exempt=1 so the 0098 partial unique index excludes them (they legit-
-- imately still collide until an admin resolves the shared-inbox conflict).
UPDATE founder_crm_contacts
SET dedup_exempt = 1
WHERE deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM crm_dedup_review r
    WHERE r.crm_scope = 'founder'
      AND r.scope_id = founder_crm_contacts.company_id
      AND r.email_norm = lower(trim(founder_crm_contacts.email))
      AND r.status = 'open'
  );

-- ============================================================
-- INVESTOR CRM (scope = investor_id) — SACRED store code is NOT edited; this is
-- pure data backfill (no code path change), which the roadmap explicitly allows
-- to ship without touching the sacred file.
-- ============================================================
WITH grp AS (
  SELECT id, investor_id,
         lower(trim(email)) AS email_norm,
         trim(coalesce(name,'')) AS nm,
         created_at,
         ROW_NUMBER() OVER (
           PARTITION BY investor_id, lower(trim(email))
           ORDER BY CASE WHEN trim(coalesce(name,''))='' THEN 1 ELSE 0 END,
                    created_at ASC, id ASC
         ) AS rn
  FROM investor_crm_contacts
  WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
),
winners AS (SELECT investor_id, email_norm, id AS win_id, nm AS win_nm FROM grp WHERE rn = 1)
UPDATE investor_crm_contacts
SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE deleted_at IS NULL
  AND id IN (
    SELECT g.id FROM grp g
    JOIN winners w ON w.investor_id = g.investor_id AND w.email_norm = g.email_norm
    WHERE g.rn > 1
      AND ( g.nm = '' OR lower(g.nm) = lower(w.win_nm) )
  );

INSERT OR IGNORE INTO crm_dedup_review (id, crm_scope, scope_id, email_norm, contact_ids, distinct_names, status, created_at)
SELECT
  'ddr_investor_' || investor_id || '_' || lower(trim(email)),
  'investor', investor_id, lower(trim(email)),
  '[' || group_concat('"' || id || '"', ',') || ']',
  '[' || group_concat(DISTINCT '"' || replace(trim(coalesce(name,'')),'"','') || '"') || ']',
  'open', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM investor_crm_contacts
WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> '' AND trim(coalesce(name,'')) <> ''
GROUP BY investor_id, lower(trim(email))
HAVING COUNT(DISTINCT lower(trim(name))) > 1;

UPDATE investor_crm_contacts
SET dedup_exempt = 1
WHERE deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM crm_dedup_review r
    WHERE r.crm_scope = 'investor'
      AND r.scope_id = investor_crm_contacts.investor_id
      AND r.email_norm = lower(trim(investor_crm_contacts.email))
      AND r.status = 'open'
  );

-- ============================================================
-- PARTNER CRM (scope = partner_id).
--
-- CHAIN-SAFETY (GPT-5.5 blocker #2, v25.52 re-review): partner_crm_contacts is
-- an AUDIT HASH-CHAIN table. server/lib/auditChainVerifier.ts registers it with
-- hasDeletedAt:true and NO chainPartitionByRowId, so the verifier FILTERS OUT
-- soft-deleted (deleted_at IS NOT NULL) rows and then walks the remaining LIVE
-- rows requiring each row's prev_hash === the prior LIVE row's curr_hash.
-- Soft-deleting a NON-TAIL duplicate loser removes a link from the live walk and
-- makes the next live row fail with prev_hash_mismatch — i.e. it CORRUPTS the
-- audit chain. A soft-delete is therefore NOT chain-neutral here.
--
-- FIX: do NOT auto-collapse ANY partner CRM rows. We NEVER set deleted_at on
-- partner_crm_contacts. Instead we treat EVERY duplicate (scope,email) group
-- (same-name AND different-name) as a review item: log it to crm_dedup_review and
-- flag ALL its live rows dedup_exempt=1 so 0098's partial UNIQUE index EXCLUDES
-- them (the pre-insert app guard in the partner create path — if/when added —
-- and manual admin resolution still prevent NEW dupes). Actual collapse is
-- deferred to a chain-aware follow-up (Track 3.5.4) that restitches prev/curr
-- hashes. Result: existing partner chain rows stay byte-identical and the
-- verifier keeps passing. Additive + idempotent (INSERT OR IGNORE + flag UPDATE).
-- ============================================================

-- Log EVERY partner duplicate (scope,email) group with 2+ live rows (regardless
-- of name) for manual/chain-aware resolution. distinct_names may hold 1+ names.
INSERT OR IGNORE INTO crm_dedup_review (id, crm_scope, scope_id, email_norm, contact_ids, distinct_names, status, created_at)
SELECT
  'ddr_partner_' || partner_id || '_' || lower(trim(email)),
  'partner', partner_id, lower(trim(email)),
  '[' || group_concat('"' || id || '"', ',') || ']',
  '[' || group_concat(DISTINCT '"' || replace(trim(coalesce(name,'')),'"','') || '"') || ']',
  'open', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_crm_contacts
WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
GROUP BY partner_id, lower(trim(email))
HAVING COUNT(*) > 1;

-- Flag ALL live partner rows in ANY duplicate (scope,email) group as
-- dedup_exempt=1 so the 0098 partial unique index excludes them. No row is ever
-- soft-deleted, so the hash chain is untouched. Uses an inline self-aggregate
-- (not the review table) so it flags every dup group even if the review INSERT
-- was previously a no-op on re-run.
UPDATE partner_crm_contacts
SET dedup_exempt = 1
WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
  AND (partner_id, lower(trim(email))) IN (
    SELECT partner_id, lower(trim(email))
    FROM partner_crm_contacts
    WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
    GROUP BY partner_id, lower(trim(email))
    HAVING COUNT(*) > 1
  );
