-- migrations/0128_wave_c2_mfc_stages.sql
-- Wave C-2 v26.6.0 (RF-11) — Managed Founder CRM stage engine.
--
-- Creates two new tables that together form the platform's canonical stage
-- machine for Consortium Partner workflows:
--
--   mfc_stages           — one row per (partner, stage_machine_type, key)
--                          triple, seeding three stage families (19 stages
--                          per partner as of R1 FIX B4 -- previously 18
--                          before partner_pipeline gained 'passed'; see
--                          ROUND-1 FIX LOG below):
--                            • mfc_engagement   5 stages (partner ↔ founder engagement)
--                            • partner_pipeline 7 stages (partner's investor pipeline)
--                            • mp_soft_circle   7 stages (managed-founder soft-circle CRM)
--
--   mfc_stage_transitions — durable audit ledger of every stage move, with
--                           actor role gated by CHECK constraint.
--
-- Ozan LOCK 5 (this wave) + rule 4: DB-driven throughout. No hardcoded stages.
-- Partners can add/reorder/remove their own stage sets via the stage-admin
-- routes (§20.1/§20.2), constrained by the composite UNIQUE (partner_id,
-- stage_machine_type, key) and (partner_id, stage_machine_type, ordinal)
-- indexes below.
--
-- Additive: creates only new tables. Zero existing rows are touched.
-- Idempotent: guarded by the platform migration runner's duplicate-table
-- handling and the inline self-heal function `applyWaveC2MfcStagesSchema`
-- in server/db/connection.ts (V33-1-B1 pattern: sqlite_master-guarded,
-- tolerates duplicate-table errors, idempotent under re-run, log.warn +
-- continue on any other error — never rethrows and kills boot).
--
-- ROUND-1 FIX LOG (this file, C-2.a round 1 — Opus + GPT-5.6 + Gemini):
--   BLOCK-1 (Opus/GPT-5.6): seed composite IDs used substr(p.id,1,8). Every
--     real partner ID is generated as `ac_consortium_partner_${randomBytes(6)
--     .toString("hex")}` (server/consortiumApplyStore.ts:1001) — a CONSTANT
--     21-char literal prefix followed by 12 hex chars of actual entropy. The
--     first 8 characters of EVERY real partner ID are therefore the same
--     string, "ac_conso", so the old scheme collided across all partners and
--     `INSERT OR IGNORE` silently discarded every partner's seed rows after
--     the first. Fixed by keying off `substr(p.id, -12)` — the last 12
--     characters, which are exactly the random hex suffix and therefore the
--     only part of the ID that actually varies per partner.
--   BLOCK-2 (Opus/GPT-5.6): actor_user_id had an unspec'd REFERENCES
--     users(id), which made `actor_role='system'` rows (required by the
--     'system' member of the actor_role CHECK, by 0132's backfill-authored
--     transitions, and by any cron/SLA-driven auto-transition) unwritable
--     because no `users` row with id='system' exists anywhere in the tree.
--     Removed; actor_user_id is now application-layer-only, matching the
--     tree-wide `ctx?.userId ?? "system"` idiom (no FK, free-text).
--   MAJOR-1: mfc_engagement stages did not cover the real `LAPSED` value of
--     managedFounderStore.ts's EngagementStatus union. Added a 5th stage
--     (`lapsed`, ordinal 4, non-terminal) and shifted `terminated` to
--     ordinal 5.
--   MAJOR-4: mfc_stage_transitions.to_stage_id / from_stage_id were
--     unindexed, making the §4.2 STAGE_IN_USE transition-count check
--     (SELECT COUNT(*) ... WHERE from_stage_id = ? OR to_stage_id = ?) a
--     full table scan on an unbounded append-only ledger. Added both
--     indexes (the from_stage_id index is partial: WHERE from_stage_id IS
--     NOT NULL, since NULL means "initial assignment").
--   MINOR-2: dropped idx_mfc_stages_partner_type — it is a strict left
--     prefix of the automatic index backing UNIQUE (partner_id,
--     stage_machine_type, key), so it was pure dead weight on every write.
--
-- ROUND-1 FIX LOG (D1D2D3_R1_FIX_REPORT.md, R1 FIX B4, D3-Q2 blocker):
--   partner_pipeline was seeded with only 6 KV-vocabulary keys (invited,
--   viewed, soft_circle, signed, funded, committed) and had no 'passed' row,
--   even though partner_pipeline's V19-facing `stage` column (see D3's
--   backfill, runWaveC2PipelineKvBackfill.ts) can legitimately need one.
--   Added a 7th partner_pipeline stage, 'passed' (ordinal 6, terminal, 0%
--   probability), purely so current_stage_id has a resolvable target if a
--   'passed' V19 value is ever written by a future, non-backfill code path.
--   Seed count per partner is therefore now 19 (5 + 7 + 7), not 18 (5 + 6 + 7).
--   This is independent of the KV->V19 stage-vocabulary collapse fix (also
--   R1 FIX B4), which lives entirely in runWaveC2PipelineKvBackfill.ts's
--   KV_STAGE_TO_V19_STAGE map and touches no SQL.

CREATE TABLE IF NOT EXISTS mfc_stages (
  id                       TEXT PRIMARY KEY NOT NULL,
  partner_id               TEXT NOT NULL REFERENCES partner_organizations(id),
  stage_machine_type       TEXT NOT NULL CHECK (stage_machine_type IN ('mfc_engagement','partner_pipeline','mp_soft_circle')),
  key                      TEXT NOT NULL,
  label                    TEXT NOT NULL,
  ordinal                  INTEGER NOT NULL,
  is_terminal              INTEGER NOT NULL DEFAULT 0,
  default_probability_pct  INTEGER CHECK (default_probability_pct IS NULL OR (default_probability_pct >= 0 AND default_probability_pct <= 100)),
  age_sla_hours            INTEGER CHECK (age_sla_hours IS NULL OR age_sla_hours >= 0),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (partner_id, stage_machine_type, key),
  UNIQUE (partner_id, stage_machine_type, ordinal),
  UNIQUE (id, stage_machine_type)   -- composite FK target for mfc_stage_transitions and V33-F1 triggers
);

CREATE INDEX IF NOT EXISTS idx_mfc_stages_terminal ON mfc_stages(is_terminal);
-- NOTE: idx_mfc_stages_partner_type intentionally NOT created (MINOR-2 fix,
-- round 1) — it was a strict left-prefix of the automatic index backing
-- UNIQUE (partner_id, stage_machine_type, key) and added no query value.

CREATE TABLE IF NOT EXISTS mfc_stage_transitions (
  id                       TEXT PRIMARY KEY NOT NULL,
  partner_id               TEXT NOT NULL REFERENCES partner_organizations(id),
  stage_machine_type       TEXT NOT NULL CHECK (stage_machine_type IN ('mfc_engagement','partner_pipeline','mp_soft_circle')),
  subject_id               TEXT NOT NULL,    -- mf_engagement.id / partner_deal_pipeline.id / soft_circles.id, resolved by stage_machine_type
  from_stage_id            TEXT,             -- nullable: NULL = initial stage assignment
  to_stage_id              TEXT NOT NULL,
  actor_user_id            TEXT NOT NULL,    -- application-layer only, NO REFERENCES (BLOCK-2 fix, round 1).
                                              -- Tree-wide convention: non-human actors are written as the
                                              -- literal string "system" (ctx?.userId ?? "system" idiom, e.g.
                                              -- collectiveBillingStore.ts:1641,1719, adminContactsStore.ts:1520,
                                              -- 1553,1637, captableCommitStore.ts:1360), and no `users` row with
                                              -- id='system' exists or is seeded anywhere in the tree. A hard FK
                                              -- here would make actor_role='system' rows permanently uninsertable.
                                              -- Enforcement of actor_user_id validity (when it IS a real user) is
                                              -- an application-layer concern, matching partner_attributions
                                              -- .authority_artifact_id's precedent (spec §2.2/0130).
  actor_role               TEXT NOT NULL CHECK (actor_role IN ('founder','partner','admin','system')),
  reason                   TEXT,             -- free-text partner-provided reason for the transition
  note                     TEXT,             -- free-text partner-provided note
  created_at               TEXT NOT NULL,
  -- Composite FKs to mfc_stages: (from_stage_id, stage_machine_type) and
  -- (to_stage_id, stage_machine_type) both target mfc_stages(id, stage_machine_type).
  -- Enforces stage-type consistency between the subject's machine and the stage.
  FOREIGN KEY (from_stage_id, stage_machine_type) REFERENCES mfc_stages(id, stage_machine_type),
  FOREIGN KEY (to_stage_id,   stage_machine_type) REFERENCES mfc_stages(id, stage_machine_type)
);

CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_subject_created ON mfc_stage_transitions(subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_partner_type    ON mfc_stage_transitions(partner_id, stage_machine_type);
-- MAJOR-4 fix (round 1): index both sides of the composite FK so the §4.2
-- STAGE_IN_USE transition-count check (COUNT(*) WHERE from_stage_id = ? OR
-- to_stage_id = ?) doesn't full-scan an unbounded, append-only audit ledger.
CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_to_stage   ON mfc_stage_transitions(to_stage_id);
CREATE INDEX IF NOT EXISTS idx_mfc_stage_transitions_from_stage ON mfc_stage_transitions(from_stage_id) WHERE from_stage_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- SEEDS — one stage set per (existing partner_organizations row × 3 machine types)
-- ═════════════════════════════════════════════════════════════════════════
--
-- Deterministic composite IDs: `mfcstg_${partner_suffix}_${type}_${key}` where
-- partner_suffix is the LAST 12 hex chars of the partner ID (assumption
-- D-C2a-5, corrected round 1 — see BLOCK-1 note above). This makes seeds
-- re-runnable via INSERT OR IGNORE without ID collisions.
--
-- WHY substr(id,-12) rather than substr(id,1,8): the real partner ID
-- generator is `ac_consortium_partner_${randomBytes(6).toString("hex")}`
-- (server/consortiumApplyStore.ts:1001) — a FIXED 21-character literal
-- prefix ("ac_consortium_partner_") followed by 12 hex characters of actual
-- randomness. Every real partner ID therefore shares the same first 8 (in
-- fact, same first 21) characters; only the LAST 12 characters vary. Round-1
-- review (Opus + GPT-5.6, independently) confirmed the prior substr(id,1,8)
-- scheme collapsed every partner in the tree onto the single literal prefix
-- "ac_conso", so INSERT OR IGNORE silently dropped every partner's seed rows
-- after the first. substr(id,-12) is collision-free against the real ID
-- shape as long as randomBytes(6) does not collide (2^48 keyspace) and
-- remains re-runnable/idempotent via INSERT OR IGNORE.

-- ─── mfc_engagement stages (D-C2a-1: 5-value canonical set — spec §23 gate #1
--      base 4 plus `lapsed`, added round 1 / MAJOR-1 to cover the real
--      EngagementStatus union `"ACTIVE" | "LAPSED" | "HANDED_OVER" |
--      "TERMINATED"` (server/managedFounderStore.ts:39). LAPSED is a live,
--      actively-produced-and-recovered status (managedFounderStore.ts:558
--      recovers LAPSED -> ACTIVE on trial override; :571 area produces it on
--      trial expiry), so it needs its own non-terminal stage rather than
--      being unrepresentable in the stage machine.)
INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mfc_engagement_active',
  p.id, 'mfc_engagement', 'active', 'Active', 0, 0, NULL, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mfc_engagement_on_hold',
  p.id, 'mfc_engagement', 'on_hold', 'On hold', 1, 0, NULL, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mfc_engagement_handed_over',
  p.id, 'mfc_engagement', 'handed_over', 'Handed over', 2, 1, NULL, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mfc_engagement_lapsed',
  p.id, 'mfc_engagement', 'lapsed', 'Lapsed', 3, 0, NULL, NULL,     -- v2: compact ordinal (closes Opus r2 R2-MINOR-1)
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mfc_engagement_terminated',
  p.id, 'mfc_engagement', 'terminated', 'Terminated', 4, 1, NULL, NULL,   -- v2: compact ordinal
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

-- ─── partner_pipeline stages (verbatim from shared/crmStages.ts:125-129, §4.4 probabilities)
INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_partner_pipeline_invited',
  p.id, 'partner_pipeline', 'invited', 'Invited', 0, 0, 10, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_partner_pipeline_viewed',
  p.id, 'partner_pipeline', 'viewed', 'Viewed', 1, 0, 20, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_partner_pipeline_soft_circle',
  p.id, 'partner_pipeline', 'soft_circle', 'Soft-circle', 2, 0, 40, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_partner_pipeline_signed',
  p.id, 'partner_pipeline', 'signed', 'Signed', 3, 0, 75, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_partner_pipeline_funded',
  p.id, 'partner_pipeline', 'funded', 'Funded', 4, 1, 95, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_partner_pipeline_committed',
  p.id, 'partner_pipeline', 'committed', 'Committed', 5, 1, 100, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

-- R1 FIX B4 (D3-Q2, D1D2D3_R1_FIX_REPORT.md): 'passed' was seeded for the
-- mp_soft_circle machine (below) but was MISSING from partner_pipeline,
-- even though shared/crmStages.ts's real KV vocabulary and D3's backfill both
-- treat 'passed' as a reachable partner_pipeline terminal stage. Its absence
-- here meant KV_STAGE_TO_V19_STAGE had no seeded partner_pipeline row to
-- resolve a 'passed' KV stage against, forcing D3 to fall back on the V19
-- 'closed'/'sourced' vocabulary instead of a real mfc_stages row. Added at
-- ordinal 6 (after 'committed'), terminal, 0% probability (a passed deal
-- proceeds no further).
INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_partner_pipeline_passed',
  p.id, 'partner_pipeline', 'passed', 'Passed', 6, 1, 0, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

-- ─── mp_soft_circle stages (D-C2a-3: spec §4.3 + judgment call D-C2a-3 for probabilities)
INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mp_soft_circle_warm',
  p.id, 'mp_soft_circle', 'warm', 'Warm', 0, 0, 15, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mp_soft_circle_interested',
  p.id, 'mp_soft_circle', 'interested', 'Interested', 1, 0, 30, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mp_soft_circle_indicated',
  p.id, 'mp_soft_circle', 'indicated', 'Indicated', 2, 0, 50, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mp_soft_circle_pre_committed',
  p.id, 'mp_soft_circle', 'pre_committed', 'Pre-committed', 3, 0, 75, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mp_soft_circle_partner_committed',
  p.id, 'mp_soft_circle', 'partner_committed', 'Partner-committed', 4, 0, 90, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mp_soft_circle_passed',
  p.id, 'mp_soft_circle', 'passed', 'Passed', 5, 1, 0, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;

INSERT OR IGNORE INTO mfc_stages
  (id, partner_id, stage_machine_type, key, label, ordinal, is_terminal, default_probability_pct, age_sla_hours, created_at, updated_at)
SELECT
  'mfcstg_' || substr(p.id, -12) || '_mp_soft_circle_withdrawn',
  p.id, 'mp_soft_circle', 'withdrawn', 'Withdrawn', 6, 1, 0, NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM partner_organizations p;
