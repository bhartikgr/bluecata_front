# ROLLBACK — v25.45 (Founder QA wave, F1–F20)

All v25.45 schema changes are additive and reversible. JSON sub-fields require
no migration. The two conditional DROP-COLUMN migrations (0063 preferences,
0064 financials) were **NOT applied** — the columns are still referenced, so the
F16/F17 work dropped the UI only. There is therefore nothing to roll back for
those two.

## 0062 — workspace archive columns (APPLIED, additive)

`migrations/0062_v25_45_workspace_archive.sql` adds four NULLABLE columns to
`companies`:

```sql
-- forward (already applied; idempotent — "duplicate column" is treated as skip)
ALTER TABLE companies ADD COLUMN archived_at TEXT;
ALTER TABLE companies ADD COLUMN archive_retention_until TEXT;
ALTER TABLE companies ADD COLUMN archive_status TEXT DEFAULT 'active';
ALTER TABLE companies ADD COLUMN last_active_plan TEXT;
```

Rollback:

```sql
ALTER TABLE companies DROP COLUMN archived_at;
ALTER TABLE companies DROP COLUMN archive_retention_until;
ALTER TABLE companies DROP COLUMN archive_status;
ALTER TABLE companies DROP COLUMN last_active_plan;
```

Note: SQLite supports `DROP COLUMN` (>= 3.35). The inline DDL in
`server/db/connection.ts` also adds these columns idempotently; after a rollback
they would be re-added on next boot, so a true rollback also reverts that inline
DDL block.

## 0063 — drop preferences columns (NOT APPLIED)

The Preferences UI (F16) was dropped, but the columns are still referenced by
`server/lib/companySyncFields.ts` (Collective sync set) and
`client/src/pages/founder/ProfileWizard.tsx`, and they live inside the SACRED
`companyProfileStore.profile_json` + the profile-completion weighting. Dropping
them would require touching Avi Tier-2. Decision: **keep columns, drop UI only.**
No migration file was created. Nothing to roll back.

## 0064 — drop financials columns (NOT APPLIED)

The Financials UI (F17) was dropped, but `runwayMonths`, `lastRaiseSizeUsd`,
`lastRaiseDate`, `cashOnHandUsd`, `monthlyBurnUsd` are referenced by
`server/collectiveRoutes.ts`, `server/partnerRoutes.ts`,
`server/dscScoringEngine.ts`, `server/lib/companySyncFields.ts`, the admin
CompanyDetail page, and the Collective Deal Room. Per the brief
("referenced by investor reports OR /ma-intel → keep columns, drop UI only").
Decision: **keep columns, drop UI only.** No migration file was created.

## JSON sub-fields (no migration)

- `profilestore_company_profile.profile_json.legalEntity.boardComposition`
  (F18c) — additive JSON sub-object `{ directorsCount, directorsSnapshot[] }`.
  To roll back, omit the key on write; existing rows parse unchanged.
- `profilestore_company_profile.profile_json.ma.readiness` (F19d) — additive
  JSON sub-object `{ ipDueDiligence, customerContracts, financialAudit,
  dataRoomOrganization, regulatoryFilings, esgDisclosure, transactionStatus }`.
  `computeMaReadinessScore` treats a missing `readiness` block as the original
  pre-v25.45 100%-existing-score behaviour, so historical maScores are
  unchanged when the key is absent.

## Code-only changes (revert by reverting the files)

- `server/middleware/archiveCheck.ts` (new) + its mount in `server/routes.ts`.
- `client/src/components/ArchivedWorkspaceBanner.tsx` (new) + its render in
  `client/src/components/AppShell.tsx`.
- `client/src/pages/CompanyDetails.tsx` F18d scorecard derivation.
- `client/src/pages/founder/Company.tsx` Step 3 Board Composition + Step 4
  Section 5 readiness.
- `client/src/lib/profile/types.ts` `computeMaReadinessScore` 50/50 blend.
- `client/src/pages/founder/Settings.tsx` F10d billing, F15 region read-only,
  F16/F17 tab-content removal.
