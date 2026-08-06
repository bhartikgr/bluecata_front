-- migrations/0136_wave_c2_partner_company_relationship_spine.sql
-- Wave C-2.h v3.3.5 — `partner_company_relationship` spine + `pcr_surface_presence`
-- join table + backfill. Unchanged from v3.1 (§2.2/0136).
--
-- R2 FIX (Opus r1 BLOCKER 1, cross-wave root cause R1-3): this file's
-- `ALTER TABLE mf_engagement ADD COLUMN pcr_id ...` (below) hard-fails with
-- "no such table: mf_engagement" on any boot where mf_engagement does not
-- yet exist (applyMfcrmSchema() runs AFTER applyInlineMigrations in the real
-- boot chain). Per the c2_c_0130 precedent (the same root cause, first
-- documented there), the fix is a `buildProductionTableStatements`
-- basic-shape `CREATE TABLE IF NOT EXISTS mf_engagement (...)` entry, NOT a
-- rewrite of this migration file — see connection_ts_patch.md in this
-- directory, which cross-references c2_c_0130/connection_ts_patch.md §2 as
-- the canonical fix (now load-bearing for FOUR waves: c, d, f, h).
-- R2 FIX (Opus r1 BLOCKER 2): the spine-seed id template below now uses '|'
-- (pipe) instead of '_' (underscore) as the partner_id/company_id
-- separator, fixing a non-injective id collision hazard — see the BACKFILL
-- STEP 1 comment block below for the full rationale.
--
-- SPEC ANCHORS: §2 (migration 0136 row, line ~233), §2.1 (orphan pre-flight,
-- unchanged mechanism from v3.1), §3 (pcr spine — §3.2 table shape, §3.3
-- forward-write helper contract that THIS backfill must leave in a
-- consistent state for), §14 (soft_circles is a LENS over the delegated-
-- agency provenance columns, NOT a PCR surface — see the surface-naming note
-- below, which is the single most consequential judgment call in this file).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SURFACE-NAMING NOTE (read this before touching anything below):
-- The four canonical PCR surfaces are the spec's OWN `surface` CHECK values
-- (§3.2: `CHECK (surface IN ('mfc','pipeline','clients','portfolio'))`) and
-- §3.3's four named forward-write call sites, which map 1:1 to four real
-- tables that ALL carry NOT-NULL `partner_id` + `company_id` columns
-- (grep-verified, `connection.ts` / `mfcrmSchema.ts`):
--
--   surface='mfc'       -> mf_engagement          (mfcrmSchema.ts:56,  partner_id/company_id both NOT NULL)
--   surface='pipeline'  -> partner_deal_pipeline   (connection.ts:3969, partner_id/company_id both NOT NULL)
--   surface='clients'   -> partner_attributions    (connection.ts:2129, partner_id/company_id both NOT NULL)
--   surface='portfolio' -> partner_portfolio_company (connection.ts:3915, partner_id/company_id both NOT NULL)
--
-- `soft_circles` is NOT one of these four and is NOT touched by this
-- migration. Grep-verified (`connection.ts:3274-3293`): `soft_circles` has NO
-- `partner_id` column at all — only a nullable `sourced_from_partner_id`
-- (added in migration 0133, provenance-only) and a nullable `company_id`.
-- A table with no NOT-NULL `partner_id` structurally cannot be a
-- `(partner_id, company_id)`-keyed PCR surface, and §14.1 explicitly frames
-- `soft_circles` as "a lens, not a new table" — it is read via
-- `sourced_from_partner_id`/`sourced_from_partner_attribution_id` provenance
-- columns, never via `pcr_id`. Every §3.3 mandatory call site, every §18
-- decision-table row, and §2's own backfill-hash-chain-safety list name only
-- these four tables. See ASSUMPTIONS_C2H.md for the full resolution — this is
-- flagged as the wave's most consequential ambiguity between the delegating
-- task brief (which named `soft_circles` as a surface) and the LOCKED spec
-- (which never does).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Additive: creates two new tables, adds one nullable `pcr_id` column to each
-- of the four real surface tables, then backfills. Zero destructive
-- statements. Idempotent: `UNIQUE (partner_id, company_id)` on the spine +
-- `INSERT OR IGNORE` throughout + `UPDATE ... WHERE pcr_id IS NULL` throughout
-- means a second full run of this file is a no-op past the first.
--
-- Orphan pre-flight (§2.1): `foreign_keys = ON` (`connection.ts:125`) means
-- any legacy row whose `partner_id`/`company_id` does not resolve to a live
-- parent row would raise `FOREIGN KEY constraint failed` on the spine INSERT
-- and roll back the whole file. Per §2.1's skip+log policy, this file
-- pre-filters every backfill SELECT with a `LEFT JOIN ... WHERE <fk>.id IS
-- NOT NULL` guard and logs every excluded row to `c2_backfill_skip_log`
-- BEFORE attempting the spine insert, so no orphaned tuple is ever presented
-- to the FK-constrained INSERT in the first place. The 0.5% boot-fail
-- threshold (§2.1) is a TypeScript-side concern (computed and enforced by
-- the self-heal / operator runbook, since raw `.sql` files have no
-- conditional-abort primitive) — this file only performs the mechanical
-- skip+log+exclude step; ASSUMPTIONS_C2H.md documents the threshold-check
-- division of labor.

-- ═════════════════════════════════════════════════════════════════════════
-- c2_backfill_skip_log — shared skip/log table (§2.1). May already exist
-- from migration 0132's Pipeline KV backfill; IF NOT EXISTS makes this file
-- safe regardless of migration order/re-run.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS c2_backfill_skip_log (
  id            TEXT PRIMARY KEY NOT NULL,
  source_table  TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  missing_fk    TEXT NOT NULL CHECK (missing_fk IN ('company_id','partner_id','legacy_id','duplicate_grain','none')),
  reason        TEXT NOT NULL,
  skipped_at    TEXT NOT NULL
);

-- ═════════════════════════════════════════════════════════════════════════
-- partner_company_relationship — the spine (§3.2, verbatim)
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS partner_company_relationship (
  id          TEXT PRIMARY KEY NOT NULL,
  partner_id  TEXT NOT NULL REFERENCES partner_organizations(id),
  company_id  TEXT NOT NULL REFERENCES companies(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (partner_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_pcr_partner  ON partner_company_relationship(partner_id);
CREATE INDEX IF NOT EXISTS idx_pcr_company  ON partner_company_relationship(company_id);

-- ═════════════════════════════════════════════════════════════════════════
-- pcr_surface_presence — join table (§3.2, verbatim). Append-only per
-- (pcr_id, surface, row_id); removal sets removed_at, never deletes.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pcr_surface_presence (
  id          TEXT PRIMARY KEY NOT NULL,
  pcr_id      TEXT NOT NULL REFERENCES partner_company_relationship(id),
  surface     TEXT NOT NULL CHECK (surface IN ('mfc','pipeline','clients','portfolio')),
  row_id      TEXT NOT NULL,
  added_at    TEXT NOT NULL,
  removed_at  TEXT,
  UNIQUE (pcr_id, surface, row_id)
);

CREATE INDEX IF NOT EXISTS idx_pcr_surface_presence_pcr     ON pcr_surface_presence(pcr_id);
CREATE INDEX IF NOT EXISTS idx_pcr_surface_presence_row     ON pcr_surface_presence(surface, row_id);

-- ═════════════════════════════════════════════════════════════════════════
-- Additive pcr_id columns on all four real surface tables (nullable,
-- additive, per §2's convention — bare ALTER, self-heal covers ADD COLUMN
-- IF NOT EXISTS since SQLite has none).
-- ═════════════════════════════════════════════════════════════════════════
-- R2 FIX (Opus r1 BLOCKER 1): this ALTER is only safe once mf_engagement is
-- guaranteed to exist before applyInlineMigrations runs -- see the header
-- R2 FIX note above and connection_ts_patch.md (this directory) for the
-- buildProductionTableStatements basic-shape fix that makes it so.
ALTER TABLE mf_engagement
  ADD COLUMN pcr_id TEXT REFERENCES partner_company_relationship(id);

ALTER TABLE partner_deal_pipeline
  ADD COLUMN pcr_id TEXT REFERENCES partner_company_relationship(id);

-- §2's backfill-hash-chain-safety note: pcr_id lands OUTSIDE
-- revision_hash/prev_revision_hash — plain ALTER/UPDATE, never touching the
-- hash-chain write function.
ALTER TABLE partner_attributions
  ADD COLUMN pcr_id TEXT REFERENCES partner_company_relationship(id);

-- §2's backfill-hash-chain-safety note: pcr_id lands OUTSIDE
-- prev_hash/curr_hash (partnerPortfolioStore.ts:144).
ALTER TABLE partner_portfolio_company
  ADD COLUMN pcr_id TEXT REFERENCES partner_company_relationship(id);

CREATE INDEX IF NOT EXISTS idx_mf_engagement_pcr           ON mf_engagement(pcr_id);
CREATE INDEX IF NOT EXISTS idx_partner_deal_pipeline_pcr   ON partner_deal_pipeline(pcr_id);
CREATE INDEX IF NOT EXISTS idx_partner_attributions_pcr    ON partner_attributions(pcr_id);
CREATE INDEX IF NOT EXISTS idx_partner_portfolio_company_pcr ON partner_portfolio_company(pcr_id);

-- ═════════════════════════════════════════════════════════════════════════
-- ORPHAN PRE-FLIGHT (§2.1) — log every legacy row on each of the four
-- surfaces whose partner_id or company_id does not resolve to a live parent
-- row, BEFORE the backfill SELECTs below run. `INSERT OR IGNORE` keyed on a
-- deterministic id makes this block idempotent on re-run.
-- Only rows the surface's own live-row convention still considers "live" are
-- checked: partner_attributions filters revoked_at IS NULL (V32-M2 grain);
-- partner_deal_pipeline / partner_portfolio_company filter deleted_at IS
-- NULL (both carry a soft-delete column); mf_engagement has no soft-delete
-- column in its base DDL (migration 0131 later adds archived_at, out of
-- scope for the orphan predicate here — an archived row's FK validity is
-- unaffected by archival) so no status filter is applied to it.
-- ═════════════════════════════════════════════════════════════════════════

-- mf_engagement orphans: missing partner
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_mf_engagement_partner_' || e.id, 'mf_engagement', e.id, 'partner_id',
       'orphan_preflight_0136_no_matching_partner_organizations_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM mf_engagement e
LEFT JOIN partner_organizations p ON p.id = e.partner_id
WHERE p.id IS NULL;

-- mf_engagement orphans: missing company
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_mf_engagement_company_' || e.id, 'mf_engagement', e.id, 'company_id',
       'orphan_preflight_0136_no_matching_companies_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM mf_engagement e
LEFT JOIN companies c ON c.id = e.company_id
WHERE c.id IS NULL;

-- partner_deal_pipeline orphans: missing partner (live rows only)
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_partner_deal_pipeline_partner_' || d.id, 'partner_deal_pipeline', d.id, 'partner_id',
       'orphan_preflight_0136_no_matching_partner_organizations_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_deal_pipeline d
LEFT JOIN partner_organizations p ON p.id = d.partner_id
WHERE p.id IS NULL AND d.deleted_at IS NULL;

-- partner_deal_pipeline orphans: missing company (live rows only)
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_partner_deal_pipeline_company_' || d.id, 'partner_deal_pipeline', d.id, 'company_id',
       'orphan_preflight_0136_no_matching_companies_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_deal_pipeline d
LEFT JOIN companies c ON c.id = d.company_id
WHERE c.id IS NULL AND d.deleted_at IS NULL;

-- partner_attributions orphans: missing partner (live rows only, revoked_at IS NULL per V32-M2 grain)
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_partner_attributions_partner_' || a.id, 'partner_attributions', a.id, 'partner_id',
       'orphan_preflight_0136_no_matching_partner_organizations_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_attributions a
LEFT JOIN partner_organizations p ON p.id = a.partner_id
WHERE p.id IS NULL AND a.revoked_at IS NULL;

-- partner_attributions orphans: missing company (live rows only)
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_partner_attributions_company_' || a.id, 'partner_attributions', a.id, 'company_id',
       'orphan_preflight_0136_no_matching_companies_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_attributions a
LEFT JOIN companies c ON c.id = a.company_id
WHERE c.id IS NULL AND a.revoked_at IS NULL;

-- partner_portfolio_company orphans: missing partner (live rows only)
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_partner_portfolio_company_partner_' || pc.id, 'partner_portfolio_company', pc.id, 'partner_id',
       'orphan_preflight_0136_no_matching_partner_organizations_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_portfolio_company pc
LEFT JOIN partner_organizations p ON p.id = pc.partner_id
WHERE p.id IS NULL AND pc.deleted_at IS NULL;

-- partner_portfolio_company orphans: missing company (live rows only)
INSERT OR IGNORE INTO c2_backfill_skip_log (id, source_table, source_id, missing_fk, reason, skipped_at)
SELECT 'c2skip_0136_partner_portfolio_company_company_' || pc.id, 'partner_portfolio_company', pc.id, 'company_id',
       'orphan_preflight_0136_no_matching_companies_row',
       strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_portfolio_company pc
LEFT JOIN companies c ON c.id = pc.company_id
WHERE c.id IS NULL AND pc.deleted_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- BACKFILL STEP 1 — seed the spine: one row per distinct (partner_id,
-- company_id) tuple across all four surfaces, EXCLUDING any tuple flagged
-- as orphaned above (LEFT JOIN ... WHERE <fk>.id IS NOT NULL guards on both
-- sides, mirroring the pre-flight predicates exactly so an orphaned tuple is
-- never presented to this FK-constrained INSERT). Deterministic id derived
-- from the tuple itself (not a random UUID) so this block is trivially
-- idempotent under INSERT OR IGNORE + UNIQUE(partner_id, company_id) on
-- re-run, and so a second migration run against the same DB produces
-- byte-identical spine ids.
--
-- R2 FIX (Opus r1 BLOCKER 2): the id template uses '|' (pipe), NOT '_'
-- (underscore), as the separator between partner_id and company_id:
-- 'pcr_' || partner_id || '|' || company_id. The original '_' separator
-- was non-injective -- since partner_id/company_id values may themselves
-- contain underscores (e.g. partner_id='ac_consortium_partner_a1' and
-- company_id='b2', vs. partner_id='ac_consortium_partner_a1_b2' and
-- company_id='' scenarios, or more realistically two distinct
-- (partner_id, company_id) pairs whose underscore-joined concatenation
-- collides, e.g. ('p_1', '2') and ('p', '1_2') both producing 'pcr_p_1_2'),
-- a second INSERT OR IGNORE would then silently drop the colliding tuple
-- as a false duplicate. '|' is not a legal character in any partner_id or
-- company_id value produced by this platform's id generators (which emit
-- only [a-z0-9_] per the ac_/co_ prefix convention), so 'pcr_' || partner_id
-- || '|' || company_id is injective over the actual domain of ids this
-- platform generates. This was Opus's own stated preferred minimal fix
-- (opus_c2ghij_r1.md, BLOCKER 2) over the alternatives (hash-based id, full
-- random UUID + separate UNIQUE(partner_id, company_id), or full-id
-- concatenation without a separator).
-- ═════════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO partner_company_relationship (id, partner_id, company_id, created_at, updated_at)
SELECT 'pcr_' || e.partner_id || '|' || e.company_id, e.partner_id, e.company_id,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM mf_engagement e
JOIN partner_organizations p ON p.id = e.partner_id
JOIN companies c ON c.id = e.company_id;

INSERT OR IGNORE INTO partner_company_relationship (id, partner_id, company_id, created_at, updated_at)
SELECT 'pcr_' || d.partner_id || '|' || d.company_id, d.partner_id, d.company_id,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_deal_pipeline d
JOIN partner_organizations p ON p.id = d.partner_id
JOIN companies c ON c.id = d.company_id
WHERE d.deleted_at IS NULL;

INSERT OR IGNORE INTO partner_company_relationship (id, partner_id, company_id, created_at, updated_at)
SELECT 'pcr_' || a.partner_id || '|' || a.company_id, a.partner_id, a.company_id,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_attributions a
JOIN partner_organizations p ON p.id = a.partner_id
JOIN companies c ON c.id = a.company_id
WHERE a.revoked_at IS NULL;

INSERT OR IGNORE INTO partner_company_relationship (id, partner_id, company_id, created_at, updated_at)
SELECT 'pcr_' || pc.partner_id || '|' || pc.company_id, pc.partner_id, pc.company_id,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_portfolio_company pc
JOIN partner_organizations p ON p.id = pc.partner_id
JOIN companies c ON c.id = pc.company_id
WHERE pc.deleted_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- BACKFILL STEP 2 — set pcr_id on every live, resolvable row of all four
-- surfaces. UPDATE ... WHERE pcr_id IS NULL makes this idempotent (a
-- re-run only ever targets rows the first run missed, e.g. new legacy rows
-- inserted between runs by a process that predates the forward-write helper
-- landing everywhere).
-- ═════════════════════════════════════════════════════════════════════════

UPDATE mf_engagement
SET pcr_id = (
  SELECT r.id FROM partner_company_relationship r
  WHERE r.partner_id = mf_engagement.partner_id AND r.company_id = mf_engagement.company_id
)
WHERE pcr_id IS NULL
  AND EXISTS (
    SELECT 1 FROM partner_company_relationship r
    WHERE r.partner_id = mf_engagement.partner_id AND r.company_id = mf_engagement.company_id
  );

UPDATE partner_deal_pipeline
SET pcr_id = (
  SELECT r.id FROM partner_company_relationship r
  WHERE r.partner_id = partner_deal_pipeline.partner_id AND r.company_id = partner_deal_pipeline.company_id
)
WHERE pcr_id IS NULL
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM partner_company_relationship r
    WHERE r.partner_id = partner_deal_pipeline.partner_id AND r.company_id = partner_deal_pipeline.company_id
  );

UPDATE partner_attributions
SET pcr_id = (
  SELECT r.id FROM partner_company_relationship r
  WHERE r.partner_id = partner_attributions.partner_id AND r.company_id = partner_attributions.company_id
)
WHERE pcr_id IS NULL
  AND revoked_at IS NULL
  AND EXISTS (
    SELECT 1 FROM partner_company_relationship r
    WHERE r.partner_id = partner_attributions.partner_id AND r.company_id = partner_attributions.company_id
  );

UPDATE partner_portfolio_company
SET pcr_id = (
  SELECT r.id FROM partner_company_relationship r
  WHERE r.partner_id = partner_portfolio_company.partner_id AND r.company_id = partner_portfolio_company.company_id
)
WHERE pcr_id IS NULL
  AND deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM partner_company_relationship r
    WHERE r.partner_id = partner_portfolio_company.partner_id AND r.company_id = partner_portfolio_company.company_id
  );

-- ═════════════════════════════════════════════════════════════════════════
-- BACKFILL STEP 3 — write pcr_surface_presence rows for every surface row
-- that now carries a non-null pcr_id. Deterministic id derived from
-- (surface, row_id) so re-runs are naturally idempotent even before the
-- UNIQUE(pcr_id, surface, row_id) constraint is consulted. added_at backfills
-- to the surface row's own created_at when present, else the migration run
-- time (mf_engagement/partner_deal_pipeline/partner_attributions/
-- partner_portfolio_company all carry a created_at column — grep-verified).
-- ═════════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO pcr_surface_presence (id, pcr_id, surface, row_id, added_at, removed_at)
SELECT 'pcrsp_mfc_' || e.id, e.pcr_id, 'mfc', e.id, e.created_at, NULL
FROM mf_engagement e
WHERE e.pcr_id IS NOT NULL;

INSERT OR IGNORE INTO pcr_surface_presence (id, pcr_id, surface, row_id, added_at, removed_at)
SELECT 'pcrsp_pipeline_' || d.id, d.pcr_id, 'pipeline', d.id, d.created_at,
       CASE WHEN d.deleted_at IS NOT NULL THEN d.deleted_at ELSE NULL END
FROM partner_deal_pipeline d
WHERE d.pcr_id IS NOT NULL;

INSERT OR IGNORE INTO pcr_surface_presence (id, pcr_id, surface, row_id, added_at, removed_at)
SELECT 'pcrsp_clients_' || a.id, a.pcr_id, 'clients', a.id, a.attributed_at,
       CASE WHEN a.revoked_at IS NOT NULL THEN a.revoked_at ELSE NULL END
FROM partner_attributions a
WHERE a.pcr_id IS NOT NULL;

INSERT OR IGNORE INTO pcr_surface_presence (id, pcr_id, surface, row_id, added_at, removed_at)
SELECT 'pcrsp_portfolio_' || pc.id, pc.pcr_id, 'portfolio', pc.id, pc.created_at,
       CASE WHEN pc.deleted_at IS NOT NULL THEN pc.deleted_at ELSE NULL END
FROM partner_portfolio_company pc
WHERE pc.pcr_id IS NOT NULL;
