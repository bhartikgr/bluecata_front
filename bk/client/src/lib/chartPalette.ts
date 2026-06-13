/**
 * Wave G Track 2 — G7: Chart palette overhaul.
 *
 * Unified, branded chart colors that tie to the Capavate design tokens.
 * Use these everywhere instead of hardcoded hex literals or default
 * Recharts colors. Each scale runs darkest → lightest so you can pick
 * the index that matches your data density.
 *
 * Convention:
 *   - 5-step monochrome scales for the four semantic intents.
 *   - `diverging` for two-direction (good/bad) comparisons.
 *   - `CAPTABLE_COLORS` is the canonical donut palette
 *     (founders / investors / option-pool).
 *   - `STATUS_COLORS` maps round-status chips to chart fills so a chip
 *     and its bar/segment are always the same hue.
 */

/** Multi-step categorical/sequential palettes. Index 0 is the brand-dark anchor. */
export const CHART_PALETTE = {
  primary:    ["#0E7C9F", "#56B4D3", "#A8DAE8", "#D6EBF3", "#EDF6F9"],
  success:    ["#10B981", "#34D399", "#6EE7B7", "#A7F3D0", "#D1FAE5"],
  warning:    ["#F59E0B", "#FBBF24", "#FCD34D", "#FDE68A", "#FEF3C7"],
  danger:     ["#EF4444", "#F87171", "#FCA5A5", "#FECACA", "#FEE2E2"],
  neutral:    ["#475569", "#64748B", "#94A3B8", "#CBD5E1", "#E2E8F0"],
  diverging:  ["#0E7C9F", "#56B4D3", "#94A3B8", "#F87171", "#EF4444"],
} as const;

/** Cap-table donut: founders → investors → option-pool. */
export const CAPTABLE_COLORS = ["#0E7C9F", "#0F766E", "#A7F3D0"] as const;

/** Round-status semantic colors — keep chip and chart aligned. */
export const STATUS_COLORS = {
  funded:    "#10B981",
  committed: "#0E7C9F",
  pending:   "#F59E0B",
  declined:  "#EF4444",
} as const;

/**
 * Gradient definitions for premium chart fills. Each gradient is a tuple
 * `[topColor, bottomColor]` suitable for SVG <linearGradient>.
 */
export const CHART_GRADIENTS = {
  primary: ["#0E7C9F", "#A8DAE8"],
  success: ["#10B981", "#A7F3D0"],
  warning: ["#F59E0B", "#FDE68A"],
  danger:  ["#EF4444", "#FCA5A5"],
} as const;

/**
 * Recharts-friendly tooltip style. Apply via `<Tooltip contentStyle={…}>`.
 */
export const TOOLTIP_STYLE = {
  background: "rgba(15, 23, 42, 0.95)", // slate-900 @ 95%
  border: "1px solid rgba(14, 124, 159, 0.4)", // cap-primary tint
  borderRadius: 8,
  boxShadow: "0 10px 25px -5px rgba(0,0,0,0.18), 0 8px 10px -6px rgba(0,0,0,0.12)",
  color: "#F8FAFC", // slate-50
  fontSize: 12,
  padding: "8px 12px",
} as const;

/** Tooltip label style (the bold header inside the tooltip). */
export const TOOLTIP_LABEL_STYLE = {
  color: "#A8DAE8", // cap-primary[2]
  fontWeight: 600,
  marginBottom: 4,
} as const;

/**
 * Default animation duration (ms) for mount-in animations. Recharts
 * accepts `isAnimationActive` + `animationDuration`. Reduced-motion users
 * are respected by the consumer (set to 0 if `prefers-reduced-motion`).
 */
export const CHART_ANIMATION_DURATION_MS = 600;

/**
 * Pick a categorical color for a series by index. Wraps around if the
 * series count exceeds the palette length.
 */
export function categoricalColor(index: number): string {
  const palette = [
    CHART_PALETTE.primary[0],
    CHART_PALETTE.success[0],
    CHART_PALETTE.warning[0],
    CHART_PALETTE.danger[0],
    CHART_PALETTE.neutral[0],
    CHART_PALETTE.primary[1],
    CHART_PALETTE.success[1],
    CHART_PALETTE.warning[1],
  ];
  return palette[index % palette.length];
}

/**
 * Status → color helper. Falls back to neutral if status not in map.
 */
export function statusColor(status: string): string {
  const key = status.toLowerCase() as keyof typeof STATUS_COLORS;
  return (STATUS_COLORS as Record<string, string>)[key] ?? CHART_PALETTE.neutral[1];
}
