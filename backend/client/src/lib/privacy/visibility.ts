/**
 * Sprint 7 — Privacy & visibility model (R200.gating §6).
 *
 * Three independent toggles per user:
 *   - screen_name_set            (boolean — has the user chosen one?)
 *   - visible_to_co_members      (boolean — direct cap-table co-members)
 *   - visible_to_collective_network (boolean — broader Collective network)
 *
 * Defaults are ALL FALSE (privacy-by-default).
 *
 * Screen name validation: 3–30 chars, alphanumeric + underscore + dash,
 * uniqueness enforced at the platform level (not in this module).
 */

export interface VisibilitySettings {
  /** Public display name. Empty string if not set. */
  screenName: string;
  /** Has the user chosen a screen name? Derived but persisted to make the model explicit. */
  screenNameSet: boolean;
  /** Are they discoverable to direct cap-table co-members? */
  visibleToCoMembers: boolean;
  /** Are they discoverable to the broader Capavate Collective network? */
  visibleToCollectiveNetwork: boolean;
}

/** Privacy-by-default — all three toggles off. */
export const DEFAULT_VISIBILITY: VisibilitySettings = Object.freeze({
  screenName: "",
  screenNameSet: false,
  visibleToCoMembers: false,
  visibleToCollectiveNetwork: false,
});

export type ScreenNameValidation =
  | { ok: true }
  | { ok: false; reason: "too_short" | "too_long" | "invalid_chars" | "taken" };

const SCREEN_NAME_RE = /^[A-Za-z0-9_-]+$/;
export const SCREEN_NAME_MIN = 3;
export const SCREEN_NAME_MAX = 30;

/**
 * Validate a candidate screen name.
 *
 * Pass an `existing` set of names already taken (case-insensitive) to
 * surface the `"taken"` reason. The check is intentionally local — the
 * server is the source of truth for platform-wide uniqueness.
 */
export function validateScreenName(
  candidate: string,
  existing: Iterable<string> = [],
): ScreenNameValidation {
  if (candidate.length < SCREEN_NAME_MIN) return { ok: false, reason: "too_short" };
  if (candidate.length > SCREEN_NAME_MAX) return { ok: false, reason: "too_long" };
  if (!SCREEN_NAME_RE.test(candidate)) return { ok: false, reason: "invalid_chars" };
  const lc = candidate.toLowerCase();
  for (const e of existing) if (e.toLowerCase() === lc) return { ok: false, reason: "taken" };
  return { ok: true };
}

/**
 * Resolve how a co-member should appear to a viewer per R200.gating §6.
 *
 * If the holder has NOT opted into co-member visibility, their identity is
 * replaced with "[Anonymous Holder]". If they have opted in AND set a
 * screen name, that screen name is used. Otherwise the legal name is shown
 * but only when the holder explicitly is the viewer themselves (self-view).
 *
 * Returns the label that should appear to the `viewer` user looking at the
 * `holder` user's row in a shared cap table.
 */
export function resolveCoMemberLabel(
  holder: { id: string; legalName: string; visibility: VisibilitySettings },
  viewer: { id: string },
): string {
  // Always show your own legal name to yourself.
  if (holder.id === viewer.id) return holder.legalName;

  // Privacy-by-default: hidden unless explicitly opted in.
  if (!holder.visibility.visibleToCoMembers) return "[Anonymous Holder]";

  // Opted in but no screen name — fall back to anonymous so legal identity
  // is never leaked without an explicit screen-name choice.
  if (!holder.visibility.screenNameSet || !holder.visibility.screenName.trim())
    return "[Anonymous Holder]";

  return holder.visibility.screenName;
}

/**
 * Communication eligibility per R200.gating §6.
 *
 * A message thread between A and B is allowed only if BOTH have
 * `visibleToCoMembers=true` (or both `visibleToCollectiveNetwork=true`)
 * AND they share at least one cap-table or Collective surface.
 */
export function canMessage(
  a: VisibilitySettings,
  b: VisibilitySettings,
  shared: { capTable: boolean; collectiveSurface: boolean },
): boolean {
  const capPath =
    shared.capTable && a.visibleToCoMembers && b.visibleToCoMembers;
  const collectivePath =
    shared.collectiveSurface && a.visibleToCollectiveNetwork && b.visibleToCollectiveNetwork;
  return capPath || collectivePath;
}

/**
 * Apply a partial update to a visibility object, deriving `screenNameSet`
 * automatically from a non-empty `screenName`.
 */
export function applyVisibilityUpdate(
  current: VisibilitySettings,
  patch: Partial<VisibilitySettings>,
): VisibilitySettings {
  const next = { ...current, ...patch };
  if (typeof patch.screenName === "string") {
    next.screenNameSet = patch.screenName.trim().length > 0;
  }
  return next;
}
