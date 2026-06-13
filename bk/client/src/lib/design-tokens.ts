/**
 * Sprint 14 D1 — Single source of design tokens.
 *
 * Per harvest_collective_bp §2: typography, spacing, brand colors, button
 * variants, motion timings — one canonical export consumed by all 42 routes.
 *
 * Light-mode locked. The Capavate palette below MUST match index.css :root.
 */

/* -- Typography scale -------------------------------------------------- */
export const typography = {
  display: { fontSize: "1.5rem", lineHeight: "1.2", fontWeight: 600 },   // hero (in-app max)
  h1:      { fontSize: "1.25rem", lineHeight: "1.3", fontWeight: 600 },
  h2:      { fontSize: "1.125rem", lineHeight: "1.4", fontWeight: 600 },
  body:    { fontSize: "0.9375rem", lineHeight: "1.5", fontWeight: 400 },
  small:   { fontSize: "0.8125rem", lineHeight: "1.45", fontWeight: 400 },
  micro:   { fontSize: "0.6875rem", lineHeight: "1.4", fontWeight: 500 },
} as const;

/* -- Spacing scale (4px base) ----------------------------------------- */
export const spacing = {
  px: "1px",
  0: "0",
  1: "0.25rem",  // 4
  2: "0.5rem",   // 8
  3: "0.75rem",  // 12
  4: "1rem",     // 16
  5: "1.25rem",  // 20
  6: "1.5rem",   // 24
  8: "2rem",     // 32
  10: "2.5rem",  // 40
  12: "3rem",    // 48
  16: "4rem",    // 64
} as const;

/* -- Brand colors (HSL strings; mirror index.css) --------------------- */
export const colors = {
  navy:   "219 45% 20%",
  hydra:  "184 98% 22%",
  plum:   "333 75% 35%",
  reject: "7 61% 43%",
  /** Neutral fills used by EmptyState / Skeleton / InlineError / Toast. */
  ink:        "222 25% 14%",
  inkMuted:   "222 8% 42%",
  surface:    "0 0% 100%",
  surfaceAlt: "210 16% 97%",
  border:     "214 12% 88%",
  borderStrong: "214 14% 80%",
  success:    "152 60% 33%",
  warning:    "32 100% 42%",
  info:       "210 92% 42%",
} as const;

/* -- Button variants (semantic) --------------------------------------- */
export const buttonVariants = {
  primary:   { bg: `hsl(${colors.navy})`, fg: "white",          border: "transparent" },
  secondary: { bg: "white",               fg: `hsl(${colors.navy})`, border: `hsl(${colors.border})` },
  hydra:     { bg: `hsl(${colors.hydra})`, fg: "white",        border: "transparent" },
  plum:      { bg: `hsl(${colors.plum})`, fg: "white",         border: "transparent" },
  destructive:{bg: `hsl(${colors.reject})`,fg: "white",        border: "transparent" },
  ghost:     { bg: "transparent",         fg: `hsl(${colors.ink})`, border: "transparent" },
} as const;

/* -- Motion timings ---------------------------------------------------- */
export const motion = {
  /** Hover/press feedback. */
  fast: 120,
  /** Reveal/dismiss panels. */
  base: 200,
  /** Long content transitions. */
  slow: 320,
  ease: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    accelerate: "cubic-bezier(0.4, 0, 1, 1)",
    decelerate: "cubic-bezier(0, 0, 0.2, 1)",
  },
} as const;

/* -- Radii ------------------------------------------------------------- */
export const radii = {
  xs: "0.25rem",
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  pill: "9999px",
} as const;

/* -- Shadows (light-mode only)
 *   Sprint 16 B1 — Collective design port: shadow tint = Navy 219 45% 14%,
 *   not pure black, per audit "shadow tint with Navy".
 * --------------------------------------------------------------------- */
export const shadows = {
  none: "none",
  card:  "0 1px 2px hsl(219 45% 14% / 0.06), 0 1px 1px hsl(219 45% 14% / 0.04)",
  pop:   "0 4px 14px hsl(219 45% 14% / 0.10)",
  modal: "0 20px 40px hsl(219 45% 14% / 0.22)",
} as const;

/* -- Layout grids (Sprint 16 B3) -------------------------------------- */
/** Investor dashboard 3-column grid: 23% / 55% / 22% per audit. */
export const dashboardGrid = {
  template: "23% 55% 22%",
  gap: "1.5rem",
} as const;

/* -- Auto-tier badge palette (Sprint 14 D3 Pattern 11) ----------------- */
export const tierColors = {
  watch:     `hsl(${colors.inkMuted})`,
  qualified: `hsl(${colors.info})`,
  featured:  `hsl(${colors.hydra})`,
  priority:  `hsl(${colors.plum})`,
} as const;

export type Tier = keyof typeof tierColors;

export const tokens = {
  typography, spacing, colors, buttonVariants, motion, radii, shadows, tierColors, dashboardGrid,
} as const;
