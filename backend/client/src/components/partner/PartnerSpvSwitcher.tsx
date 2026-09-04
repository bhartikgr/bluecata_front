/**
 * WAVE D · ITEM 6d — THE ONE PLACE A PARTNER CHANGES WHICH VEHICLE THEY ARE LOOKING AT.
 *
 * WHY THIS EXISTS. On `/collective/partner/spv-engine` the vehicle list stays
 * fully on screen while one row's sixteen detail tabs are expanded underneath
 * it, so the "information on this page" was NOT specific to the vehicle being
 * viewed: every other vehicle's card, its target-raise figure, its publish
 * control and its two deep links were still rendered around the detail. That is
 * the owner's complaint, and it is real — verified by reading the render, not by
 * reading a prior document (`spvs.map(...)` at PartnerSpvEngine.tsx renders
 * every row unconditionally; the detail block is mounted INSIDE one of them).
 *
 * WHAT IT DOES. It is a single control, placed ABOVE the detail area, that lists
 * every vehicle the partner has. Selecting one changes which vehicle is being
 * viewed. **Nothing is taken away** (R195.5): before this component the other
 * vehicles were reachable from their own cards; after it they are reachable from
 * here. The SET of reachable vehicles is identical — that is asserted by test,
 * not asserted here in prose.
 *
 * WHY IT SHOWS A REFERENCE CODE. Read from the real `data.db`: the six vehicles
 * on this platform ALL CARRY THE SAME NAME ("Keiretsu Canada NovaPay SPV 2026")
 * and the same jurisdiction, status and currency. A dropdown of six identical
 * labels is not a switcher, it is a coin toss. So every option also carries the
 * vehicle's own reference code, and when two or more names collide the control
 * says so in words. This was only discoverable by driving real rows.
 *
 * NO MONEY IS RENDERED HERE, DELIBERATELY. A vehicle picker that showed amounts
 * would invite a reader to compare or add figures across vehicles that may be
 * denominated in different currencies. Nothing is converted here because nothing
 * monetary is shown here.
 *
 * IT OWNS NO SECOND SOURCE OF TRUTH. It reads the SAME query key the engine list
 * reads (`["/api/partner/me/spv"]`), so react-query serves both from one cache
 * entry and the two surfaces cannot disagree about which vehicles exist.
 */
import { useQuery } from "@tanstack/react-query";
import { CANONICAL_SELECT_CLASS } from "@/lib/canonicalFieldOptions";
import { apiRequest } from "@/lib/queryClient";
import { spvStatusLabel } from "@/lib/partnerDisplay";
import { spvJurisdictionDisplay, type SpvDTO } from "@shared/spvEngine";

/** The tail of an SPV id, which is what distinguishes six identically-named vehicles. */
export function spvShortRef(id: string): string {
  const raw = String(id ?? "").trim();
  if (!raw) return "no reference";
  const tail = raw.replace(/^spv_/, "");
  return tail.length <= 8 ? tail : tail.slice(-8);
}

/**
 * The text of one option. Name first because that is what a partner recognises,
 * then the two facts that separate two vehicles with the same name.
 */
export function spvSwitcherOptionLabel(s: SpvDTO): string {
  const name = String(s.name ?? "").trim() || "Unnamed vehicle";
  const juris = spvJurisdictionDisplay(s).label;
  const status = spvStatusLabel(s.status);
  return `${name} · ${juris} · ${status} · ref ${spvShortRef(s.id)}`;
}

/** True when at least two vehicles in the list carry the same trimmed name. */
export function spvNamesCollide(list: readonly SpvDTO[]): boolean {
  const seen = new Set<string>();
  for (const s of list) {
    const key = String(s.name ?? "").trim().toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function PartnerSpvSwitcher({
  currentSpvId,
  onSelect,
  allOptionLabel,
  testidPrefix = "spv-switcher",
}: {
  /** The vehicle currently being viewed, or null when no single vehicle is in view. */
  currentSpvId: string | null;
  /**
   * Called with the chosen vehicle id, or `null` when the reader picks the
   * "all vehicles" option. The caller decides whether that means "expand in
   * place" or "navigate" — this control does not assume a route.
   */
  onSelect: (spvId: string | null) => void;
  /**
   * When supplied, an option that clears the single-vehicle view is offered and
   * carries this label. Omit it on a surface where "all vehicles" is not a state
   * the page can be in.
   */
  allOptionLabel?: string;
  testidPrefix?: string;
}) {
  const list = useQuery<{ spvs: SpvDTO[] }>({
    queryKey: ["/api/partner/me/spv"],
    queryFn: async () => (await apiRequest("GET", "/api/partner/me/spv")).json(),
  });

  const spvs = list.data?.spvs ?? [];
  const known = spvs.some((s) => s.id === currentSpvId);
  const selectId = `${testidPrefix}-select`;

  return (
    <div
      className="mb-4 rounded-md border border-[color:var(--cv-color-border)] bg-[color:var(--cv-color-surface-2)] p-3"
      data-testid={testidPrefix}
    >
      <label
        htmlFor={selectId}
        className="block text-xs font-semibold text-[color:var(--cv-color-text)]"
        data-testid={`${testidPrefix}-label`}
      >
        Vehicle you are viewing
      </label>
      <select
        id={selectId}
        /* WAVE D · ITEM 6d — CANONICAL_SELECT_CLASS is the exported constant every
           other <select> in the partner product uses. Reusing it, rather than
           re-typing its classes, is why this control looks and behaves like the
           rest of the product instead of like a one-off. */
        className={`mt-1 max-w-xl ${CANONICAL_SELECT_CLASS}`}
        data-testid={`${testidPrefix}-select`}
        value={known ? String(currentSpvId) : ""}
        disabled={list.isLoading || list.isError || spvs.length === 0}
        onChange={(e) => onSelect(e.target.value === "" ? null : e.target.value)}
      >
        {allOptionLabel !== undefined && (
          <option value="" data-testid={`${testidPrefix}-option-all`}>
            {allOptionLabel}
          </option>
        )}
        {allOptionLabel === undefined && !known && (
          <option value="" data-testid={`${testidPrefix}-option-placeholder`}>
            Choose a vehicle
          </option>
        )}
        {spvs.map((s) => (
          <option key={s.id} value={s.id} data-testid={`${testidPrefix}-option-${s.id}`}>
            {spvSwitcherOptionLabel(s)}
          </option>
        ))}
      </select>

      {/* Every branch says something true. A count is not stated while the list
          is loading or has failed, because in those branches this component does
          not know the count. */}
      {list.isLoading && (
        <div className="mt-1 text-xs text-[color:var(--cv-color-text-muted)]" data-testid={`${testidPrefix}-loading`}>
          Loading your vehicles…
        </div>
      )}
      {list.isError && (
        <div className="mt-1 text-xs text-[color:var(--cv-color-text-muted)]" data-testid={`${testidPrefix}-error`}>
          Your vehicle list could not be loaded, so this control cannot offer the others. Nothing has
          changed and the vehicle shown below is unaffected.
        </div>
      )}
      {!list.isLoading && !list.isError && spvs.length === 0 && (
        <div className="mt-1 text-xs text-[color:var(--cv-color-text-muted)]" data-testid={`${testidPrefix}-empty`}>
          You have no vehicles yet, so there is nothing to switch between.
        </div>
      )}
      {!list.isLoading && !list.isError && spvs.length > 0 && (
        <div className="mt-1 text-xs text-[color:var(--cv-color-text-muted)]" data-testid={`${testidPrefix}-count`}>
          {spvs.length === 1
            ? "This is your only vehicle."
            : `Every one of your vehicles is listed here. Only the vehicle chosen above is shown below.`}
        </div>
      )}
      {!list.isLoading && !list.isError && spvNamesCollide(spvs) && (
        <div className="mt-1 text-xs text-[color:var(--cv-color-text-muted)]" data-testid={`${testidPrefix}-duplicate-names`}>
          Two or more of your vehicles share the same name, so each option also shows that vehicle's
          own reference code. Rename a vehicle from its own page if you would rather tell them apart
          by name.
        </div>
      )}
    </div>
  );
}

export default PartnerSpvSwitcher;
