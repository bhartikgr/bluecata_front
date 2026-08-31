-- 0213_wave178_client_scope_actor_fk.sql
-- WAVE 178 · ITEM B — remove the `users(id)` foreign key from
-- `partner_crm_contact_client_scope.scoped_by_user_id`.
--
-- THE DEFECT THIS FIXES (reproduced, not inferred)
-- ------------------------------------------------
-- On the live server, selecting a CRM contact on a managed-client page and
-- clicking "Add to client" failed 100% of the time with the generic toast
-- "Could not scope contact — Something went wrong on our side. Please try
-- again." Reads worked: the contact picker populated and the panel correctly
-- said "No CRM contacts are scoped to this client yet."
--
-- Root cause, reproduced through the real route with supertest:
--   * `PRAGMA foreign_keys = ON` is set for every connection
--     (server/db/connection.ts:160, server/db/index.ts:22).
--   * 0134 declared `scoped_by_user_id TEXT NOT NULL REFERENCES users(id)`.
--   * The acting partner's session `userId` has no row in `users`.
--   * The INSERT therefore raises `FOREIGN KEY constraint failed`, which is not
--     a `UNIQUE constraint failed`, so
--     partnerCrmContactClientScopeStore.ts:275-292 rethrows it,
--     partnerCrmContactClientScopeRoutes.ts:69-71 turns it into
--     `500 {"ok":false,"error":"INTERNAL_ERROR"}` with NO message field, and
--     client/src/lib/queryClient.ts:40 renders exactly the toast reported.
--
-- A `users` row can legitimately be absent: `resolveOrCreateConsortiumPartnerId`
-- (server/partnerRoutes.ts:122-182) inserts into `auth_users` and then `users`
-- with each insert individually wrapped in `try {} catch { /* best-effort */ }`.
-- A UNIQUE(email) collision under a different id leaves NO `users` row while the
-- session still authenticates perfectly.
--
-- WHY DROPPING THE FK IS THE RIGHT FIX AND NOT A SHORTCUT
-- ------------------------------------------------------
-- `scoped_by_user_id` is an actor / audit stamp, and this platform's convention
-- for actor stamps carries NO foreign key to `users`:
--   * 0212_wave171_partner_crm_contact_links.sql:72 — `created_by TEXT NOT NULL`,
--     no FK. That is the newest and most directly analogous table.
--   * `REFERENCES users(id)` appears in only five migrations in the entire
--     history: 0131, 0133, 0134, 0137, 0183.
--   * `partner_attributions.attributed_by` and `partner_team_members.created_by`
--     carry no `users` FK either.
-- 0134's FK is the outlier. NOT NULL is RETAINED — an actor is still mandatory,
-- so the audit stamp is not weakened, only its referential coupling to a table
-- the identity model does not guarantee is removed.
--
-- The alternative — making the `users` insert in
-- `resolveOrCreateConsortiumPartnerId` non-best-effort — would touch the
-- authentication path of every partner request and still would not repair a
-- partner whose `users` row is already missing.
--
-- WHAT IS PRESERVED, EXACTLY
-- --------------------------
-- Both remaining foreign keys (`partner_crm_contacts(id)`,
-- `partner_attributions(id)`), NOT NULL on all four id/time columns, the
-- `created_at` strftime DEFAULT added by 0134's R2 fix (M-g1 — a 5-column
-- promotion-upsert INSERT omitting created_at must not trip NOT NULL),
-- `UNIQUE (partner_crm_contact_id, partner_attribution_id)` as the race arbiter
-- the store depends on at :275-292, and `idx_pccs_attribution`.
-- `idx_pccs_contact` stays absent (0134 R2 MINOR m-g2 — redundant leftmost
-- prefix of the UNIQUE index).
--
-- MIRRORED into server/db/migrations/0213_wave178_client_scope_actor_fk.sql
-- byte-identically. Do not edit one without the other.

DROP TABLE IF EXISTS partner_crm_contact_client_scope_w178_new;

CREATE TABLE partner_crm_contact_client_scope_w178_new (
  id                       TEXT PRIMARY KEY NOT NULL,
  partner_crm_contact_id   TEXT NOT NULL REFERENCES partner_crm_contacts(id),
  partner_attribution_id   TEXT NOT NULL REFERENCES partner_attributions(id),
  -- WAVE 178 · ITEM B — actor/audit stamp. NOT NULL retained; the
  -- `REFERENCES users(id)` from 0134 is deliberately absent. See header.
  scoped_by_user_id        TEXT NOT NULL,
  scoped_at                TEXT NOT NULL,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by               TEXT,
  UNIQUE (partner_crm_contact_id, partner_attribution_id)
);

-- Every existing row is carried over. Rows can only ever have satisfied the old,
-- STRICTER constraint, so none can fail the new one.
INSERT INTO partner_crm_contact_client_scope_w178_new
  (id, partner_crm_contact_id, partner_attribution_id, scoped_by_user_id,
   scoped_at, created_at, created_by)
SELECT
   id, partner_crm_contact_id, partner_attribution_id, scoped_by_user_id,
   scoped_at, created_at, created_by
FROM partner_crm_contact_client_scope;

-- The copy above has already run inside the runner's per-file transaction: had
-- it failed, nothing below would execute and the original table would still be
-- here untouched.
DROP TABLE partner_crm_contact_client_scope;

-- `PRAGMA legacy_alter_table` — REQUIRED, for the reason 0169 records at its own
-- rebuild (0169_wave13_partner_subscription_shape_reconcile.sql:265-277): with it
-- OFF (the default) SQLite re-parses EVERY trigger and view in the schema on any
-- ALTER TABLE … RENAME and aborts the rename if ANY unrelated object fails to
-- parse, so an unrelated broken trigger elsewhere in the schema would take THIS
-- rename down. Nothing in the schema references
-- `partner_crm_contact_client_scope` — no view, no trigger, and no foreign key
-- points AT it (it is a leaf join table) — so the re-parse has nothing useful to
-- rewrite. The flag is restored immediately after.
PRAGMA legacy_alter_table = ON;
ALTER TABLE partner_crm_contact_client_scope_w178_new
  RENAME TO partner_crm_contact_client_scope;
PRAGMA legacy_alter_table = OFF;

-- Recreated after the rename: SQLite carries indexes with a renamed table, but
-- the index here belonged to the DROPPED original, not to the `_new` table.
CREATE INDEX IF NOT EXISTS idx_pccs_attribution
  ON partner_crm_contact_client_scope(partner_attribution_id);
