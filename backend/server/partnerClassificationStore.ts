/**
 * WAVE 4B (PT-1 / PT-2) — partner classification store.
 *
 * Owns the three tables created by migration
 * 0149_wave4b_partner_classifications.sql:
 *   partner_sectors        — level 1 lookup (admin CRUD, no migration needed)
 *   partner_subsectors     — level 2 lookup (admin CRUD, no migration needed)
 *   partner_classifications— the hybrid-capable junction
 *
 * OWNER RULINGS implemented here (spec/PARTNER_TYPE_TAXONOMY.md, 2026-08-09):
 *   * Two levels, rendered `Sector // Sub-sector`.
 *   * Hybrids supported — several classifications per partner.
 *   * Primary = FIRST SELECTED, editable afterwards.
 *   * Mandatory on create/edit (see `replaceClassifications({ mandatory })`).
 *   * `other` requires non-empty free text — enforced here AND by a DB CHECK.
 *   * Existing partners are GRANDFATHERED: this module never backfills, never
 *     writes a sentinel, and never reads or writes the legacy partner-type
 *     values. Legacy readers are untouched.
 *
 * 🚧 SCOPE FENCE — REPORTING AND FILTERING ONLY. Classification must never be
 * read by an authorization, routing, gating, feature-flag, entitlement,
 * pricing or menu-visibility decision. No `if (sector === ...)` on any render
 * or permission path. Enforced mechanically by
 * `scripts/lint/partner-classification-scope-fence.mjs` (PT-5) and by the
 * identical-payload test — not by convention.
 *
 * Driver portability (00_SHARED_STANDARDS §4A / gate PG-21): every read and
 * write goes through Drizzle query builders wrapped in `pAll`/`pGet`/`pRun`
 * from server/db/portable.ts, so the module works under better-sqlite3 AND
 * postgres-js. Nothing here calls `rawDb()`, which throws under Postgres.
 *
 * Zero in-memory state: every call is DB-direct, so admin CRUD on the lookup
 * tables is visible to the very next read across processes.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, rawDb } from "./db/connection";
import { pAll, pGet, pRun, isSqlite } from "./db/portable";
import { applyWave4bPartnerClassificationSchema } from "./lib/applyWave4bPartnerClassificationSchema";
import {
  partnerSectors,
  partnerSubsectors,
  partnerClassifications,
} from "../shared/schema";
import {
  formatClassification,
  validateClassifications,
  withResolvedPrimary,
  type PartnerClassificationDto,
  type PartnerClassificationInput,
  type PartnerSectorDto,
  type PartnerSubsectorDto,
  type PartnerTaxonomyDto,
  type ClassificationValidationError,
} from "../shared/partnerClassification";

export class ClassificationValidationFailure extends Error {
  readonly errors: ClassificationValidationError[];
  constructor(errors: ClassificationValidationError[]) {
    super(errors.map((e) => e.message).join(" "));
    this.name = "ClassificationValidationFailure";
    this.errors = errors;
  }
}

export class TaxonomyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyConflictError";
  }
}

export class TaxonomyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyNotFoundError";
  }
}

const nowIso = () => new Date().toISOString();

function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

function toSectorDto(row: any): PartnerSectorDto {
  return {
    slug: String(row.slug),
    label: String(row.label),
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    active: toBool(row.active),
  };
}

function toSubsectorDto(row: any): PartnerSubsectorDto {
  return {
    slug: String(row.slug),
    sectorSlug: String(row.sectorSlug ?? row.sector_slug),
    label: String(row.label),
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    active: toBool(row.active),
    requiresOtherText: toBool(row.requiresOtherText ?? row.requires_other_text),
  };
}

/* ============================================================
 * Taxonomy reads (lookup tables)
 * ============================================================ */

/**
 * BOOTSTRAP HEAL — see server/lib/applyWave4bPartnerClassificationSchema.ts.
 *
 * The SQLite bootstrap in server/db/connection.ts (SACRED this wave) inlines
 * its own DDL rather than running the numbered migrations, so a fresh
 * `:memory:` database — every `NODE_ENV=test` run — would otherwise have no
 * classification tables. This runs the SAME migration file, once per process,
 * on SQLite only. Under Postgres it is skipped entirely: that tree is owned by
 * migrations-pg/ and `rawDb()` throws there by design.
 *
 * Idempotent, memoised, and fail-soft: a reporting-only feature must never be
 * able to prevent the server from starting.
 */
let _schemaEnsured = false;
function ensureSchema(): void {
  if (_schemaEnsured) return;
  _schemaEnsured = true;
  try {
    if (!isSqlite()) return;
    applyWave4bPartnerClassificationSchema(rawDb());
  } catch {
    /* fail-soft: the migration runner is the primary path */
  }
}

/**
 * The whole taxonomy in one shot. `includeInactive` is for admin surfaces and
 * for resolving labels on HISTORICAL rows whose type has since been retired —
 * a retired type must still render, it just stops being selectable.
 */
export async function getTaxonomy(
  opts: { includeInactive?: boolean } = {},
): Promise<PartnerTaxonomyDto> {
  ensureSchema();
  const db = getDb();
  const sectorRows = await pAll<any>(db.select().from(partnerSectors));
  const subRows = await pAll<any>(db.select().from(partnerSubsectors));
  const includeInactive = opts.includeInactive === true;
  const sectors = sectorRows.map(toSectorDto).filter((s) => includeInactive || s.active);
  const subsectors = subRows
    .map(toSubsectorDto)
    .filter((s) => includeInactive || s.active);
  const byOrder = <T extends { sortOrder: number; label: string }>(a: T, b: T) =>
    a.sortOrder - b.sortOrder || a.label.localeCompare(b.label);
  sectors.sort(byOrder);
  subsectors.sort(byOrder);
  return { sectors, subsectors };
}

/** Full taxonomy INCLUDING retired entries — used to resolve labels. */
async function getResolutionMaps(): Promise<{
  sectors: Map<string, PartnerSectorDto>;
  subsectors: Map<string, PartnerSubsectorDto>;
  full: PartnerTaxonomyDto;
}> {
  const full = await getTaxonomy({ includeInactive: true });
  return {
    sectors: new Map(full.sectors.map((s) => [s.slug, s])),
    subsectors: new Map(full.subsectors.map((s) => [s.slug, s])),
    full,
  };
}

/* ============================================================
 * Classification reads
 * ============================================================ */

function toClassificationDto(
  row: any,
  sectors: Map<string, PartnerSectorDto>,
  subsectors: Map<string, PartnerSubsectorDto>,
): PartnerClassificationDto {
  const sectorSlug = String(row.sectorSlug ?? row.sector_slug);
  const subsectorSlug = String(row.subsectorSlug ?? row.subsector_slug);
  // A slug with no lookup row can only happen if an admin HARD-deleted a type
  // (the CRUD below refuses to). Render the slug rather than crashing.
  const sectorLabel = sectors.get(sectorSlug)?.label ?? sectorSlug;
  const subsectorLabel = subsectors.get(subsectorSlug)?.label ?? subsectorSlug;
  const otherText = (row.otherText ?? row.other_text ?? null) as string | null;
  return {
    id: String(row.id),
    partnerId: String(row.partnerId ?? row.partner_id),
    sectorSlug,
    subsectorSlug,
    isPrimary: toBool(row.isPrimary ?? row.is_primary),
    otherText,
    createdAt: String(row.createdAt ?? row.created_at),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at),
    sectorLabel,
    subsectorLabel,
    display: formatClassification(sectorLabel, subsectorLabel, otherText),
  };
}

function sortClassifications(rows: PartnerClassificationDto[]): PartnerClassificationDto[] {
  return rows.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

/** One partner's classifications, primary first. Empty array = grandfathered. */
export async function listForPartner(partnerId: string): Promise<PartnerClassificationDto[]> {
  ensureSchema();
  const db = getDb();
  const rows = await pAll<any>(
    db.select().from(partnerClassifications).where(eq(partnerClassifications.partnerId, partnerId)),
  );
  const { sectors, subsectors } = await getResolutionMaps();
  return sortClassifications(rows.map((r) => toClassificationDto(r, sectors, subsectors)));
}

/**
 * Bulk read for LIST surfaces — one query for N partners, so the partner list
 * does not fire a query per row.
 */
export async function listForPartners(
  partnerIds: readonly string[],
): Promise<Map<string, PartnerClassificationDto[]>> {
  const out = new Map<string, PartnerClassificationDto[]>();
  const ids = Array.from(new Set(partnerIds.filter(Boolean)));
  if (ids.length === 0) return out;
  ensureSchema();
  const db = getDb();
  const rows = await pAll<any>(
    db.select().from(partnerClassifications).where(inArray(partnerClassifications.partnerId, ids)),
  );
  const { sectors, subsectors } = await getResolutionMaps();
  for (const row of rows) {
    const dto = toClassificationDto(row, sectors, subsectors);
    const bucket = out.get(dto.partnerId) ?? [];
    bucket.push(dto);
    out.set(dto.partnerId, bucket);
  }
  for (const k of Array.from(out.keys())) out.set(k, sortClassifications(out.get(k)!));
  return out;
}

/**
 * PT-4 filtering: partner ids holding ANY of the given sector/sub-sector
 * slugs. "Filters match ANY classification, so a hybrid is found under every
 * sector it holds" — owner ruling. This deliberately does NOT restrict to the
 * primary.
 *
 * REPORTING/FILTERING ONLY — the returned ids feed a list query, never an
 * access decision.
 */
export async function partnerIdsMatching(filter: {
  sectorSlugs?: readonly string[];
  subsectorSlugs?: readonly string[];
}): Promise<string[]> {
  const sectorSlugs = Array.from(new Set((filter.sectorSlugs ?? []).filter(Boolean)));
  const subsectorSlugs = Array.from(new Set((filter.subsectorSlugs ?? []).filter(Boolean)));
  if (sectorSlugs.length === 0 && subsectorSlugs.length === 0) return [];
  ensureSchema();
  const db = getDb();
  const ids = new Set<string>();
  if (sectorSlugs.length > 0) {
    const rows = await pAll<any>(
      db
        .select({ partnerId: partnerClassifications.partnerId })
        .from(partnerClassifications)
        .where(inArray(partnerClassifications.sectorSlug, sectorSlugs)),
    );
    for (const r of rows) ids.add(String(r.partnerId ?? r.partner_id));
  }
  if (subsectorSlugs.length > 0) {
    const rows = await pAll<any>(
      db
        .select({ partnerId: partnerClassifications.partnerId })
        .from(partnerClassifications)
        .where(inArray(partnerClassifications.subsectorSlug, subsectorSlugs)),
    );
    for (const r of rows) ids.add(String(r.partnerId ?? r.partner_id));
  }
  return Array.from(ids).sort();
}

/* ============================================================
 * Classification writes
 * ============================================================ */

/**
 * Replace a partner's full classification set (the create/edit save path).
 *
 * `mandatory` defaults to TRUE — the owner's mandatory-selection ruling. An
 * empty set is rejected with CLASSIFICATION_REQUIRED. Grandfathered partners
 * are simply never passed through this function until they are edited.
 *
 * Primary resolution: `withResolvedPrimary` marks the FIRST entry primary
 * unless one entry explicitly carries `isPrimary`, which is what makes the
 * primary editable after the fact.
 *
 * Delete-then-insert inside one transaction-equivalent sequence: the unique
 * partial index `uq_partner_classifications_primary` makes a stale primary
 * impossible to leave behind.
 */
export async function replaceClassifications(
  partnerId: string,
  inputs: readonly PartnerClassificationInput[],
  opts: { mandatory?: boolean } = {},
): Promise<PartnerClassificationDto[]> {
  if (!partnerId) throw new TaxonomyNotFoundError("partnerId is required.");

  const { full } = await getResolutionMaps();
  // Validate against the ACTIVE taxonomy — a retired type cannot be newly
  // selected — while labels resolve against the full one.
  const active = await getTaxonomy();
  const errors = validateClassifications(inputs, active, {
    mandatory: opts.mandatory !== false,
  });
  if (errors.length > 0) throw new ClassificationValidationFailure(errors);

  const resolved = withResolvedPrimary(inputs);
  ensureSchema();
  const db = getDb();
  const ts = nowIso();

  await pRun(
    db.delete(partnerClassifications).where(eq(partnerClassifications.partnerId, partnerId)),
  );
  for (const input of resolved) {
    const subsector = full.subsectors.find((s) => s.slug === input.subsectorSlug);
    const otherText = subsector?.requiresOtherText
      ? String(input.otherText ?? "").trim()
      : ((input.otherText ?? null) && String(input.otherText).trim()) || null;
    await pRun(
      db.insert(partnerClassifications).values({
        id: `pcl_${randomUUID()}`,
        partnerId,
        sectorSlug: input.sectorSlug,
        subsectorSlug: input.subsectorSlug,
        isPrimary: input.isPrimary ? 1 : 0,
        otherText,
        createdAt: ts,
        updatedAt: ts,
      }),
    );
  }
  return listForPartner(partnerId);
}

/**
 * Move the primary flag to an existing classification. "Primary = first
 * selected. Remains editable afterwards."
 */
export async function setPrimary(
  partnerId: string,
  classificationId: string,
): Promise<PartnerClassificationDto[]> {
  ensureSchema();
  const db = getDb();
  const target = await pGet<any>(
    db
      .select()
      .from(partnerClassifications)
      .where(
        and(
          eq(partnerClassifications.id, classificationId),
          eq(partnerClassifications.partnerId, partnerId),
        ),
      ),
  );
  if (!target) throw new TaxonomyNotFoundError("Classification not found for this partner.");
  const ts = nowIso();
  // Clear first: the partial unique index forbids two primaries at any moment.
  await pRun(
    db
      .update(partnerClassifications)
      .set({ isPrimary: 0, updatedAt: ts })
      .where(eq(partnerClassifications.partnerId, partnerId)),
  );
  await pRun(
    db
      .update(partnerClassifications)
      .set({ isPrimary: 1, updatedAt: ts })
      .where(eq(partnerClassifications.id, classificationId)),
  );
  return listForPartner(partnerId);
}

/* ============================================================
 * Admin CRUD over the lookup tables (PT-2)
 * "Admin must be able to add or retire a type WITHOUT a migration."
 * ============================================================ */

const SLUG_RE = /^[a-z][a-z0-9_]{1,62}$/;

function assertSlug(slug: string, what: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new TaxonomyConflictError(
      `Invalid ${what} slug "${slug}" — lowercase letters, digits and underscores only.`,
    );
  }
}

export async function createSector(input: {
  slug: string;
  label: string;
  sortOrder?: number;
  active?: boolean;
}): Promise<PartnerSectorDto> {
  assertSlug(input.slug, "sector");
  if (!input.label?.trim()) throw new TaxonomyConflictError("Sector label is required.");
  ensureSchema();
  const db = getDb();
  const existing = await pGet<any>(
    db.select().from(partnerSectors).where(eq(partnerSectors.slug, input.slug)),
  );
  if (existing) throw new TaxonomyConflictError(`Sector "${input.slug}" already exists.`);
  const ts = nowIso();
  await pRun(
    db.insert(partnerSectors).values({
      slug: input.slug,
      label: input.label.trim(),
      sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 999,
      active: input.active === false ? 0 : 1,
      createdAt: ts,
      updatedAt: ts,
    }),
  );
  return {
    slug: input.slug,
    label: input.label.trim(),
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 999,
    active: input.active !== false,
  };
}

export async function updateSector(
  slug: string,
  patch: { label?: string; sortOrder?: number; active?: boolean },
): Promise<PartnerSectorDto> {
  ensureSchema();
  const db = getDb();
  const row = await pGet<any>(
    db.select().from(partnerSectors).where(eq(partnerSectors.slug, slug)),
  );
  if (!row) throw new TaxonomyNotFoundError(`Sector "${slug}" not found.`);
  const next: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.label !== undefined) {
    if (!patch.label.trim()) throw new TaxonomyConflictError("Sector label cannot be empty.");
    next.label = patch.label.trim();
  }
  if (patch.sortOrder !== undefined) next.sortOrder = Number(patch.sortOrder);
  if (patch.active !== undefined) next.active = patch.active ? 1 : 0;
  await pRun(db.update(partnerSectors).set(next).where(eq(partnerSectors.slug, slug)));
  const updated = await pGet<any>(
    db.select().from(partnerSectors).where(eq(partnerSectors.slug, slug)),
  );
  return toSectorDto(updated);
}

/**
 * RETIRE, never delete. A hard delete would orphan the historical rows that
 * reference the slug (and the FK would refuse anyway). `active = 0` stops the
 * type appearing in the selector while every existing chip keeps rendering —
 * exactly what the taxonomy doc asks for.
 */
export async function retireSector(slug: string): Promise<PartnerSectorDto> {
  return updateSector(slug, { active: false });
}

export async function createSubsector(input: {
  slug: string;
  sectorSlug: string;
  label: string;
  sortOrder?: number;
  active?: boolean;
  requiresOtherText?: boolean;
}): Promise<PartnerSubsectorDto> {
  assertSlug(input.slug, "sub-sector");
  if (!input.label?.trim()) throw new TaxonomyConflictError("Sub-sector label is required.");
  ensureSchema();
  const db = getDb();
  const sector = await pGet<any>(
    db.select().from(partnerSectors).where(eq(partnerSectors.slug, input.sectorSlug)),
  );
  if (!sector) throw new TaxonomyNotFoundError(`Sector "${input.sectorSlug}" not found.`);
  const existing = await pGet<any>(
    db.select().from(partnerSubsectors).where(eq(partnerSubsectors.slug, input.slug)),
  );
  if (existing) {
    // Slugs are globally unique so `subsector_slug` stays a one-column FK.
    throw new TaxonomyConflictError(
      `Sub-sector "${input.slug}" already exists (sub-sector slugs are unique across all sectors).`,
    );
  }
  const ts = nowIso();
  const dto: PartnerSubsectorDto = {
    slug: input.slug,
    sectorSlug: input.sectorSlug,
    label: input.label.trim(),
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 999,
    active: input.active !== false,
    requiresOtherText: input.requiresOtherText === true,
  };
  await pRun(
    db.insert(partnerSubsectors).values({
      slug: dto.slug,
      sectorSlug: dto.sectorSlug,
      label: dto.label,
      sortOrder: dto.sortOrder,
      active: dto.active ? 1 : 0,
      requiresOtherText: dto.requiresOtherText ? 1 : 0,
      createdAt: ts,
      updatedAt: ts,
    }),
  );
  return dto;
}

export async function updateSubsector(
  slug: string,
  patch: {
    label?: string;
    sectorSlug?: string;
    sortOrder?: number;
    active?: boolean;
    requiresOtherText?: boolean;
  },
): Promise<PartnerSubsectorDto> {
  ensureSchema();
  const db = getDb();
  const row = await pGet<any>(
    db.select().from(partnerSubsectors).where(eq(partnerSubsectors.slug, slug)),
  );
  if (!row) throw new TaxonomyNotFoundError(`Sub-sector "${slug}" not found.`);
  const next: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.label !== undefined) {
    if (!patch.label.trim()) throw new TaxonomyConflictError("Sub-sector label cannot be empty.");
    next.label = patch.label.trim();
  }
  if (patch.sectorSlug !== undefined) {
    const sector = await pGet<any>(
      db.select().from(partnerSectors).where(eq(partnerSectors.slug, patch.sectorSlug)),
    );
    if (!sector) throw new TaxonomyNotFoundError(`Sector "${patch.sectorSlug}" not found.`);
    next.sectorSlug = patch.sectorSlug;
  }
  if (patch.sortOrder !== undefined) next.sortOrder = Number(patch.sortOrder);
  if (patch.active !== undefined) next.active = patch.active ? 1 : 0;
  if (patch.requiresOtherText !== undefined) {
    next.requiresOtherText = patch.requiresOtherText ? 1 : 0;
  }
  await pRun(db.update(partnerSubsectors).set(next).where(eq(partnerSubsectors.slug, slug)));
  const updated = await pGet<any>(
    db.select().from(partnerSubsectors).where(eq(partnerSubsectors.slug, slug)),
  );
  return toSubsectorDto(updated);
}

export async function retireSubsector(slug: string): Promise<PartnerSubsectorDto> {
  return updateSubsector(slug, { active: false });
}

/** Usage count — the admin UI shows it before a retire so nobody guesses. */
export async function countUsage(
  kind: "sector" | "subsector",
  slug: string,
): Promise<number> {
  ensureSchema();
  const db = getDb();
  const rows = await pAll<any>(
    db
      .select({ id: partnerClassifications.id })
      .from(partnerClassifications)
      .where(
        kind === "sector"
          ? eq(partnerClassifications.sectorSlug, slug)
          : eq(partnerClassifications.subsectorSlug, slug),
      ),
  );
  return rows.length;
}
