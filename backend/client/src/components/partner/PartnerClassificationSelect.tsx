/**
 * WAVE 4B (PT-3) — grouped, searchable two-level partner-classification
 * selector, plus the chip renderer used by every display surface (PT-4).
 *
 * Owner rulings implemented here (spec/PARTNER_TYPE_TAXONOMY.md, 2026-08-09):
 *   * Sector chosen FIRST; the sub-sector list is filtered to that sector.
 *     A flat 87-item dropdown is unusable — this is grouped and searchable.
 *   * MANDATORY on create/edit. `<ClassificationEditor mandatory>` reports an
 *     error and blocks save when the set is empty. This replaces the silent
 *     `.notNull().default("other")` that meant nobody ever chose.
 *   * HYBRIDS: several classifications per partner, rendered as chips.
 *   * PRIMARY = first selected, editable afterwards (click a chip's star).
 *   * `other` (any sub-sector carrying `requiresOtherText`) requires non-empty
 *     free text before it can be added.
 *   * Rendered everywhere as `Sector // Sub-sector`.
 *
 * DB-DRIVEN: the taxonomy comes from GET /api/partner-taxonomy. There is no
 * hardcoded client array anywhere in this file — that is the standing rule,
 * and it is what lets an admin add or retire a type without a migration.
 *
 * 🚧 SCOPE FENCE: this component is presentation only. It never gates a route,
 * a menu item, a feature or a price on the selected value. PT-5's lint rule
 * keeps `sector_slug` / `subsector_slug` / `partner_classifications` out of
 * client/src/components/auth/, route guards and server permission modules.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Star, X, Plus, Search } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  formatClassification,
  groupTaxonomy,
  matchesSearch,
  validateClassifications,
  withResolvedPrimary,
  type PartnerClassificationDto,
  type PartnerClassificationInput,
  type PartnerSubsectorDto,
  type PartnerTaxonomyDto,
} from "@shared/partnerClassification";

/* ── Taxonomy hook ────────────────────────────────────────────────────────── */

export function usePartnerTaxonomy() {
  return useQuery<PartnerTaxonomyDto>({
    queryKey: ["/api/partner-taxonomy"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/partner-taxonomy");
      const body = await res.json();
      return { sectors: body.sectors ?? [], subsectors: body.subsectors ?? [] };
    },
    // The taxonomy changes only when an admin edits it; a short cache keeps
    // the selector snappy without going stale for a whole session.
    staleTime: 60_000,
    retry: false,
  });
}

/* ── Display: chips (PT-4) ────────────────────────────────────────────────── */

/**
 * Hybrids render as separate chips. The primary carries a filled star so a
 * single-value column elsewhere (list, export) is visibly the same value.
 */
export function ClassificationChips({
  classifications,
  emptyLabel = "Unclassified",
  className = "",
}: {
  classifications: readonly PartnerClassificationDto[];
  emptyLabel?: string;
  className?: string;
}) {
  if (!classifications || classifications.length === 0) {
    return (
      <span
        className={`text-xs text-muted-foreground ${className}`}
        data-testid="classification-empty"
      >
        {emptyLabel}
      </span>
    );
  }
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} data-testid="classification-chips">
      {classifications.map((c) => (
        <Badge
          key={c.id}
          variant={c.isPrimary ? "default" : "outline"}
          className="text-xs font-normal"
          title={c.isPrimary ? `${c.display} (primary)` : c.display}
          data-testid={`classification-chip-${c.subsectorSlug}`}
        >
          {c.isPrimary && <Star className="h-3 w-3 mr-1 fill-current" aria-label="Primary" />}
          {c.display}
        </Badge>
      ))}
    </div>
  );
}

/* ── Editor ───────────────────────────────────────────────────────────────── */

export interface ClassificationEditorProps {
  /** Current selection. Controlled — the parent owns the array. */
  value: PartnerClassificationInput[];
  onChange: (next: PartnerClassificationInput[]) => void;
  /** Mandatory on create/edit (owner ruling). Default true. */
  mandatory?: boolean;
  disabled?: boolean;
  /** Show validation messages even before the user touches anything. */
  showErrors?: boolean;
}

/**
 * Two-step picker: pick the sector, then pick from the sub-sectors that
 * belong to it. The search box spans both levels, so typing "search fund"
 * surfaces `Investment Capital // Search Fund` without knowing the sector.
 */
export function ClassificationEditor({
  value,
  onChange,
  mandatory = true,
  disabled = false,
  showErrors = false,
}: ClassificationEditorProps) {
  const taxonomyQ = usePartnerTaxonomy();
  const taxonomy = taxonomyQ.data ?? { sectors: [], subsectors: [] };

  const [search, setSearch] = useState("");
  const [sectorSlug, setSectorSlug] = useState<string>("");
  const [subsectorSlug, setSubsectorSlug] = useState<string>("");
  const [otherText, setOtherText] = useState("");

  const grouped = useMemo(() => groupTaxonomy(taxonomy), [taxonomy]);
  const sectorBySlug = useMemo(
    () => new Map(taxonomy.sectors.map((s) => [s.slug, s])),
    [taxonomy.sectors],
  );
  const subsectorBySlug = useMemo(
    () => new Map(taxonomy.subsectors.map((s) => [s.slug, s])),
    [taxonomy.subsectors],
  );

  /** Sectors that still contain a search hit, so the group list narrows too. */
  const visibleGroups = useMemo(() => {
    if (!search.trim()) return grouped;
    return grouped
      .map((g) => ({
        sector: g.sector,
        subsectors: g.subsectors.filter((ss) =>
          matchesSearch(g.sector.label, ss.label, ss.slug, search),
        ),
      }))
      .filter((g) => g.subsectors.length > 0);
  }, [grouped, search]);

  const activeSector = sectorSlug ? sectorBySlug.get(sectorSlug) : undefined;
  /** Sub-sectors filtered to the chosen sector — never the flat 87-item list. */
  const subsectorChoices: PartnerSubsectorDto[] = useMemo(() => {
    const group = visibleGroups.find((g) => g.sector.slug === sectorSlug);
    return group?.subsectors ?? [];
  }, [visibleGroups, sectorSlug]);

  const pendingSubsector = subsectorSlug ? subsectorBySlug.get(subsectorSlug) : undefined;
  const needsOtherText = pendingSubsector?.requiresOtherText === true;
  const otherTextMissing = needsOtherText && !otherText.trim();

  const alreadySelected =
    !!sectorSlug &&
    !!subsectorSlug &&
    value.some((v) => v.sectorSlug === sectorSlug && v.subsectorSlug === subsectorSlug);

  const canAdd =
    !disabled && !!sectorSlug && !!subsectorSlug && !otherTextMissing && !alreadySelected;

  const errors = useMemo(
    () => validateClassifications(value, taxonomy, { mandatory }),
    [value, taxonomy, mandatory],
  );

  function addSelection() {
    if (!canAdd) return;
    // "Primary = first selected." The very first entry becomes primary; every
    // later one is added as a secondary and can be promoted from its chip.
    const next = withResolvedPrimary([
      ...value,
      {
        sectorSlug,
        subsectorSlug,
        otherText: needsOtherText ? otherText.trim() : null,
        isPrimary: value.length === 0,
      },
    ]);
    onChange(next);
    setSubsectorSlug("");
    setOtherText("");
  }

  function removeAt(index: number) {
    if (disabled) return;
    const remaining = value.filter((_, i) => i !== index);
    const removedPrimary = value[index]?.isPrimary === true;
    // Removing the primary promotes the next entry, so a partner is never
    // left with classifications but no primary.
    onChange(
      remaining.length === 0
        ? []
        : removedPrimary
          ? withResolvedPrimary(remaining.map((r) => ({ ...r, isPrimary: false })))
          : remaining,
    );
  }

  function makePrimary(index: number) {
    if (disabled) return;
    onChange(value.map((v, i) => ({ ...v, isPrimary: i === index })));
  }

  function labelFor(input: PartnerClassificationInput): string {
    const s = sectorBySlug.get(input.sectorSlug);
    const ss = subsectorBySlug.get(input.subsectorSlug);
    return formatClassification(
      s?.label ?? input.sectorSlug,
      ss?.label ?? input.subsectorSlug,
      input.otherText,
    );
  }

  return (
    <div className="space-y-3" data-testid="classification-editor">
      <div className="flex items-baseline gap-2">
        <Label className="text-sm font-medium">
          Classification{mandatory && <span className="text-rose-600" aria-hidden> *</span>}
        </Label>
        <span className="text-xs text-muted-foreground">
          Sector // Sub-sector. Add more than one for a hybrid partner.
        </span>
      </div>

      {/* Selected chips (hybrids) */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="classification-selected">
          {value.map((v, i) => (
            <span
              key={`${v.sectorSlug}:${v.subsectorSlug}`}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              data-testid={`classification-selected-${v.subsectorSlug}`}
            >
              <button
                type="button"
                onClick={() => makePrimary(i)}
                title={v.isPrimary ? "Primary classification" : "Make primary"}
                aria-label={v.isPrimary ? "Primary classification" : "Make primary"}
                className="text-muted-foreground hover:text-amber-500"
                disabled={disabled}
                data-testid={`classification-primary-${v.subsectorSlug}`}
              >
                <Star className={`h-3 w-3 ${v.isPrimary ? "fill-amber-400 text-amber-500" : ""}`} />
              </button>
              {labelFor(v)}
              <button
                type="button"
                onClick={() => removeAt(i)}
                title="Remove"
                aria-label={`Remove ${labelFor(v)}`}
                className="text-muted-foreground hover:text-rose-600"
                disabled={disabled}
                data-testid={`classification-remove-${v.subsectorSlug}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search across both levels */}
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sectors and sub-sectors…"
          className="pl-7 h-9 text-sm"
          disabled={disabled}
          data-testid="classification-search"
        />
      </div>

      {taxonomyQ.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading classification list…</p>
      ) : taxonomyQ.isError ? (
        <p className="text-xs text-rose-600" data-testid="classification-taxonomy-error">
          Could not load the classification list. Please retry.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {/* Level 1 — sector */}
          <div className="rounded-md border">
            <div className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
              1. Sector
            </div>
            <div className="max-h-56 overflow-y-auto p-1" data-testid="classification-sector-list">
              {visibleGroups.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No match.</p>
              ) : (
                visibleGroups.map((g) => (
                  <button
                    key={g.sector.slug}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setSectorSlug(g.sector.slug);
                      setSubsectorSlug("");
                      setOtherText("");
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted ${
                      sectorSlug === g.sector.slug ? "bg-muted font-medium" : ""
                    }`}
                    data-testid={`classification-sector-${g.sector.slug}`}
                  >
                    <span>{g.sector.label}</span>
                    <span className="text-[10px] text-muted-foreground">{g.subsectors.length}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Level 2 — sub-sectors, FILTERED to the chosen sector */}
          <div className="rounded-md border">
            <div className="border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
              2. Sub-sector{activeSector ? ` — ${activeSector.label}` : ""}
            </div>
            <div className="max-h-56 overflow-y-auto p-1" data-testid="classification-subsector-list">
              {!sectorSlug ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">Choose a sector first.</p>
              ) : subsectorChoices.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">No match in this sector.</p>
              ) : (
                subsectorChoices.map((ss) => {
                  const taken = value.some(
                    (v) => v.sectorSlug === sectorSlug && v.subsectorSlug === ss.slug,
                  );
                  return (
                    <button
                      key={ss.slug}
                      type="button"
                      disabled={disabled || taken}
                      onClick={() => {
                        setSubsectorSlug(ss.slug);
                        if (!ss.requiresOtherText) setOtherText("");
                      }}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-40 ${
                        subsectorSlug === ss.slug ? "bg-muted font-medium" : ""
                      }`}
                      data-testid={`classification-subsector-${ss.slug}`}
                    >
                      <span>{ss.label}</span>
                      {taken && <span className="text-[10px] text-muted-foreground">added</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Free text — required when the chosen sub-sector says so ("Other"). */}
      {needsOtherText && (
        <div className="space-y-1">
          <Label className="text-xs">
            Describe this partner<span className="text-rose-600" aria-hidden> *</span>
          </Label>
          <Input
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Required for “Other” — what kind of organisation is this?"
            className="h-9 text-sm"
            disabled={disabled}
            data-testid="classification-other-text"
          />
          {otherTextMissing && (
            <p className="text-xs text-rose-600" data-testid="classification-other-required">
              “{pendingSubsector?.label}” requires a description.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addSelection}
          disabled={!canAdd}
          data-testid="classification-add"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add classification
        </Button>
        {sectorSlug && subsectorSlug && (
          <span className="text-xs text-muted-foreground">
            {formatClassification(
              activeSector?.label ?? sectorSlug,
              pendingSubsector?.label ?? subsectorSlug,
              needsOtherText ? otherText : null,
            )}
          </span>
        )}
        {alreadySelected && (
          <span className="text-xs text-muted-foreground">Already added.</span>
        )}
      </div>

      {(showErrors || value.length > 0) && errors.length > 0 && (
        <ul className="space-y-0.5" data-testid="classification-errors">
          {errors.map((e, i) => (
            <li key={`${e.code}-${i}`} className="text-xs text-rose-600">
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Convenience: is this selection savable? Callers gate their save button. */
export function classificationSelectionIsValid(
  value: readonly PartnerClassificationInput[],
  taxonomy: PartnerTaxonomyDto,
  mandatory = true,
): boolean {
  return validateClassifications(value, taxonomy, { mandatory }).length === 0;
}
