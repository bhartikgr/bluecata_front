/**
 * shared/companyTaxonomy.ts — slide13b WAVE D.
 *
 * Wire contract + pure helpers for the DB-backed generic taxonomy
 * (`taxonomy_terms`, migration 0236). Shared by the server store/routes and
 * the three client selectors (PartnerAddPortfolioCompany, PartnerSpvEngine,
 * ApplyToCollective) plus the /admin/company-taxonomy page.
 *
 * No DB access here. No React here. Pure data + pure functions only.
 */

/** Namespaces the store will serve. Anything else is 404 UNKNOWN_NAMESPACE. */
export const TAXONOMY_NAMESPACES = ["company_sector"] as const;
export type TaxonomyNamespace = (typeof TAXONOMY_NAMESPACES)[number];
export const COMPANY_SECTOR_NAMESPACE: TaxonomyNamespace = "company_sector";

export function isTaxonomyNamespace(v: unknown): v is TaxonomyNamespace {
  return typeof v === "string" && (TAXONOMY_NAMESPACES as readonly string[]).includes(v);
}

/** One row of `taxonomy_terms` as the API returns it. */
export interface TaxonomyTermDto {
  namespace: TaxonomyNamespace;
  /** IMMUTABLE stored identifier. This is what consumers submit. */
  value: string;
  /** EDITABLE display label. Never submitted. */
  label: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaxonomyListResponse {
  ok: true;
  namespace: TaxonomyNamespace;
  /** Alphabetical by label (case-insensitive), then label, then value. */
  terms: TaxonomyTermDto[];
  /** Whether retired rows were included (admin `?includeRetired=1`). */
  includesRetired: boolean;
  /** Reported runtime dialect — always "sqlite" in this wave. */
  dialect: "sqlite";
}

/** Limits enforced by the store AND the admin form. */
export const TAXONOMY_VALUE_MAX = 80;
export const TAXONOMY_LABEL_MAX = 80;

/* eslint-disable no-control-regex */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/* eslint-enable no-control-regex */

/** Returns a normalised string or an error code. Shared by client + server. */
export function validateTaxonomyText(
  raw: unknown,
  kind: "value" | "label",
): { ok: true; text: string } | { ok: false; code: string; message: string } {
  if (typeof raw !== "string") {
    return { ok: false, code: `${kind.toUpperCase()}_REQUIRED`, message: `${kind} is required` };
  }
  const text = raw.trim();
  if (!text) {
    return { ok: false, code: `${kind.toUpperCase()}_REQUIRED`, message: `${kind} is required` };
  }
  const max = kind === "value" ? TAXONOMY_VALUE_MAX : TAXONOMY_LABEL_MAX;
  if (text.length > max) {
    return { ok: false, code: `${kind.toUpperCase()}_TOO_LONG`, message: `${kind} must be at most ${max} characters` };
  }
  if (CONTROL_CHARS.test(text)) {
    return { ok: false, code: `${kind.toUpperCase()}_INVALID`, message: `${kind} contains control characters` };
  }
  return { ok: true, text };
}

/** The read-path ordering, expressed once so client + server agree. */
export function compareTaxonomyTerms(a: TaxonomyTermDto, b: TaxonomyTermDto): number {
  const la = a.label.toLowerCase();
  const lb = b.label.toLowerCase();
  if (la < lb) return -1;
  if (la > lb) return 1;
  if (a.label < b.label) return -1;
  if (a.label > b.label) return 1;
  if (a.value < b.value) return -1;
  if (a.value > b.value) return 1;
  return 0;
}

/** What a selector renders for one choice. */
export interface TaxonomyOption {
  value: string;
  label: string;
  /** "active" = offered now; "retired" = held by this record but no longer
   *  offered; "custom" = held by this record and never a taxonomy term. */
  kind: "active" | "retired" | "custom";
}

/**
 * Consumer contract (SOL Appendix A §consumer): the selectable set is the
 * UNION of the active terms and whatever the record currently holds, so a
 * retired or custom value already on the form stays visible, selected and
 * submittable as itself — it is never silently dropped or coerced.
 *
 * `allTerms` may include retired rows (admin list) so a retired held value can
 * be labelled "retired" rather than "custom"; when only active terms are
 * available, an unknown held value is reported as "custom".
 */
export function mergeTaxonomyOptions(
  terms: readonly TaxonomyTermDto[],
  held: readonly string[],
): TaxonomyOption[] {
  const byValue = new Map<string, TaxonomyTermDto>();
  for (const t of terms) byValue.set(t.value, t);
  const out: TaxonomyOption[] = [];
  const seen = new Set<string>();
  for (const t of [...terms].sort(compareTaxonomyTerms)) {
    if (!t.active) continue;
    out.push({ value: t.value, label: t.label, kind: "active" });
    seen.add(t.value);
  }
  const extras: TaxonomyOption[] = [];
  for (const v of held) {
    if (typeof v !== "string" || !v || seen.has(v)) continue;
    seen.add(v);
    const t = byValue.get(v);
    extras.push(
      t
        ? { value: v, label: t.label, kind: "retired" }
        : { value: v, label: v, kind: "custom" },
    );
  }
  extras.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  return out.concat(extras);
}
