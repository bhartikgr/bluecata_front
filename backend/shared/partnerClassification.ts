/**
 * WAVE 4B (PT-3 / PT-4) — shared partner-classification types + rendering.
 *
 * The ONLY place the `Sector // Sub-sector` string is composed. Imported by
 * the server (exports, list payloads) and the client (chips, list column,
 * detail header, admin) so the four surfaces cannot drift apart.
 *
 * There is deliberately NO taxonomy array in this file. The taxonomy is
 * DB-driven (partner_sectors / partner_subsectors, seeded by migration 0149)
 * and reaches the client over `GET /api/partner-taxonomy`. Standing rule:
 * no hardcoding, all dynamic. Adding a hardcoded list here would silently
 * re-break the "admin can add a type without a migration" ruling.
 *
 * SCOPE FENCE (owner ruling 2026-08-09): classification is REPORTING AND
 * FILTERING ONLY. Nothing in this module may be imported by an auth guard,
 * route guard or permission module — the PT-5 lint rule enforces that.
 */

/** The literal separator in `Sector // Sub-sector`. */
export const CLASSIFICATION_SEPARATOR = " // ";

export interface PartnerSectorDto {
  slug: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface PartnerSubsectorDto {
  slug: string;
  sectorSlug: string;
  label: string;
  sortOrder: number;
  active: boolean;
  /** When true the classification requires non-empty `otherText`. */
  requiresOtherText: boolean;
}

export interface PartnerTaxonomyDto {
  sectors: PartnerSectorDto[];
  subsectors: PartnerSubsectorDto[];
}

export interface PartnerClassificationDto {
  id: string;
  partnerId: string;
  sectorSlug: string;
  subsectorSlug: string;
  isPrimary: boolean;
  otherText: string | null;
  createdAt: string;
  updatedAt: string;
  /** Resolved labels, joined server-side so every surface renders the same. */
  sectorLabel: string;
  subsectorLabel: string;
  /** `Sector // Sub-sector`, precomposed. */
  display: string;
}

/** A classification as submitted by a create/edit form. */
export interface PartnerClassificationInput {
  sectorSlug: string;
  subsectorSlug: string;
  otherText?: string | null;
  /** Optional; when omitted the FIRST entry becomes primary (owner ruling). */
  isPrimary?: boolean;
}

/**
 * Compose the canonical display string. `otherText` is appended in
 * parentheses when present so `Individual & Fallback // Other` is never
 * shown without the free text the owner ruling requires.
 */
export function formatClassification(
  sectorLabel: string,
  subsectorLabel: string,
  otherText?: string | null,
): string {
  const base = `${sectorLabel}${CLASSIFICATION_SEPARATOR}${subsectorLabel}`;
  const extra = (otherText ?? "").trim();
  return extra ? `${base} (${extra})` : base;
}

/**
 * Single-value contexts (list column, export cell, single-value report) read
 * the PRIMARY classification. Falls back to the first row when — for a
 * grandfathered or partially-written record — no row is flagged primary.
 * Returns null when the partner has no classification at all; callers render
 * an em-dash, never a silent default.
 */
export function primaryClassification<T extends { isPrimary: boolean }>(
  rows: readonly T[],
): T | null {
  if (!rows || rows.length === 0) return null;
  return rows.find((r) => r.isPrimary) ?? rows[0];
}

/** `Sector // Sub-sector` for the primary, or `fallback` when unclassified. */
export function formatPrimary(
  rows: readonly PartnerClassificationDto[],
  fallback = "—",
): string {
  const p = primaryClassification(rows);
  return p ? p.display : fallback;
}

/** Every classification, joined — used by export cells that want the hybrid. */
export function formatAll(
  rows: readonly PartnerClassificationDto[],
  separator = "; ",
  fallback = "",
): string {
  if (!rows || rows.length === 0) return fallback;
  const p = primaryClassification(rows);
  const ordered = p ? [p, ...rows.filter((r) => r !== p)] : [...rows];
  return ordered.map((r) => r.display).join(separator);
}

export type ClassificationValidationError =
  | { code: "CLASSIFICATION_REQUIRED"; message: string }
  | { code: "UNKNOWN_SECTOR"; message: string; sectorSlug: string }
  | { code: "UNKNOWN_SUBSECTOR"; message: string; subsectorSlug: string }
  | { code: "SUBSECTOR_SECTOR_MISMATCH"; message: string; subsectorSlug: string }
  | { code: "INACTIVE_TYPE"; message: string; slug: string }
  | { code: "OTHER_TEXT_REQUIRED"; message: string; subsectorSlug: string }
  | { code: "DUPLICATE_CLASSIFICATION"; message: string; subsectorSlug: string }
  | { code: "MULTIPLE_PRIMARY"; message: string };

/**
 * Pure validation of a classification set against a taxonomy snapshot.
 * Shared so the client can pre-validate with EXACTLY the server's rules
 * (the server still re-validates — the client is never authoritative).
 *
 * `mandatory` implements the owner ruling: classification is a mandatory
 * selection on create/edit. Existing partners are grandfathered, so callers
 * pass `mandatory: false` only for a read/no-op path.
 */
export function validateClassifications(
  inputs: readonly PartnerClassificationInput[],
  taxonomy: PartnerTaxonomyDto,
  opts: { mandatory?: boolean } = {},
): ClassificationValidationError[] {
  const errors: ClassificationValidationError[] = [];
  const mandatory = opts.mandatory !== false;

  if (!inputs || inputs.length === 0) {
    if (mandatory) {
      errors.push({
        code: "CLASSIFICATION_REQUIRED",
        message: "At least one classification is required.",
      });
    }
    return errors;
  }

  const sectors = new Map(taxonomy.sectors.map((s) => [s.slug, s]));
  const subsectors = new Map(taxonomy.subsectors.map((s) => [s.slug, s]));
  const seen = new Set<string>();
  let primaryCount = 0;

  for (const input of inputs) {
    const sector = sectors.get(input.sectorSlug);
    const subsector = subsectors.get(input.subsectorSlug);

    if (!sector) {
      errors.push({
        code: "UNKNOWN_SECTOR",
        message: `Unknown sector "${input.sectorSlug}".`,
        sectorSlug: input.sectorSlug,
      });
    }
    if (!subsector) {
      errors.push({
        code: "UNKNOWN_SUBSECTOR",
        message: `Unknown sub-sector "${input.subsectorSlug}".`,
        subsectorSlug: input.subsectorSlug,
      });
    }
    if (sector && subsector && subsector.sectorSlug !== sector.slug) {
      errors.push({
        code: "SUBSECTOR_SECTOR_MISMATCH",
        message: `Sub-sector "${subsector.label}" does not belong to sector "${sector.label}".`,
        subsectorSlug: input.subsectorSlug,
      });
    }
    // A retired type stays resolvable for historical rows but cannot be
    // NEWLY selected. That is the whole point of `active`.
    if (sector && !sector.active) {
      errors.push({
        code: "INACTIVE_TYPE",
        message: `Sector "${sector.label}" has been retired and cannot be selected.`,
        slug: sector.slug,
      });
    }
    if (subsector && !subsector.active) {
      errors.push({
        code: "INACTIVE_TYPE",
        message: `Sub-sector "${subsector.label}" has been retired and cannot be selected.`,
        slug: subsector.slug,
      });
    }
    if (subsector?.requiresOtherText && !(input.otherText ?? "").trim()) {
      errors.push({
        code: "OTHER_TEXT_REQUIRED",
        message: `"${subsector.label}" requires a description.`,
        subsectorSlug: input.subsectorSlug,
      });
    }

    const key = `${input.sectorSlug}::${input.subsectorSlug}`;
    if (seen.has(key)) {
      errors.push({
        code: "DUPLICATE_CLASSIFICATION",
        message: "The same classification was selected twice.",
        subsectorSlug: input.subsectorSlug,
      });
    }
    seen.add(key);

    if (input.isPrimary) primaryCount += 1;
  }

  if (primaryCount > 1) {
    errors.push({
      code: "MULTIPLE_PRIMARY",
      message: "Only one classification can be the primary.",
    });
  }

  return errors;
}

/**
 * Apply the "primary = first selected" ruling. Called before persisting so
 * exactly one row carries isPrimary, deterministically.
 */
export function withResolvedPrimary(
  inputs: readonly PartnerClassificationInput[],
): PartnerClassificationInput[] {
  const explicit = inputs.findIndex((i) => i.isPrimary === true);
  const primaryIndex = explicit >= 0 ? explicit : 0;
  return inputs.map((input, index) => ({
    ...input,
    isPrimary: index === primaryIndex,
  }));
}

/** Group sub-sectors under their sector, for the grouped selector (PT-3). */
export function groupTaxonomy(
  taxonomy: PartnerTaxonomyDto,
  opts: { includeInactive?: boolean } = {},
): Array<{ sector: PartnerSectorDto; subsectors: PartnerSubsectorDto[] }> {
  const includeInactive = opts.includeInactive === true;
  const sectors = [...taxonomy.sectors]
    .filter((s) => includeInactive || s.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return sectors.map((sector) => ({
    sector,
    subsectors: taxonomy.subsectors
      .filter((ss) => ss.sectorSlug === sector.slug && (includeInactive || ss.active))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
  }));
}

/** Case-insensitive substring match over sector + sub-sector labels/slugs. */
export function matchesSearch(
  sectorLabel: string,
  subsectorLabel: string,
  subsectorSlug: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    sectorLabel.toLowerCase().includes(q) ||
    subsectorLabel.toLowerCase().includes(q) ||
    subsectorSlug.toLowerCase().includes(q) ||
    formatClassification(sectorLabel, subsectorLabel).toLowerCase().includes(q)
  );
}
