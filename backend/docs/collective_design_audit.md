# Collective Design Token Audit — Sprint 16 Port Reference
**Date:** 2026-05-27  
**Version:** 1.0  
**Sources:** `harvest_collective_bp.md` §2, `collective_communications_audit.md`, `collective_admin_audit.md`, `collective_investor_audit.md`, `collective_founder_audit.md`, `client/src/lib/design-tokens.ts`, `client/src/index.css`, `tailwind.config.ts`  
**Purpose:** Field-level design-token inventory of the live Collective platform so every token category can be ported into Capavate consistently. All Capavate-current values are annotated inline.

---

## 1. Color Palette

### 1.1 Core Brand Colors

| Token name | Hex | HSL | Role |
|---|---|---|---|
| `--navy` | `#1C2B4A` | `hsl(219, 45%, 20%)` | Primary: headers, sidebar background, primary buttons, body text on light |
| `--hydra-teal` | `#01696F` | `hsl(184, 98%, 22%)` | Accent: CTAs, links, active nav states, soft-circle submit button, focus rings |
| `--plum` | `#9D174D` | `hsl(333, 75%, 35%)` | Highlight: DSC Committee surfaces, note callouts, priority badges |
| `--reject` | `#B33A2B` | `hsl(7, 61%, 43%)` | Destructive: error alerts, decline buttons, membership suspended badge |

```css
/* Collective CSS variable names (as seen on capavate.com) */
--color-brand-primary:   hsl(219, 45%, 20%);   /* Navy */
--color-brand-accent:    hsl(184, 98%, 22%);   /* Hydra Teal */
--color-brand-highlight: hsl(333, 75%, 35%);   /* Plum */
--color-brand-reject:    hsl(7,   61%, 43%);   /* Reject */
```

// **Capavate currently has:** Identical values — Sprint 11 palette lock locked both platforms to the same four-color base.  
// See `index.css` `:root`: `--primary: 219 45% 20%`, `--accent: 184 98% 22%`, `--highlight: 333 75% 35%`, `--destructive: 7 61% 43%`.

### 1.2 Semantic / State Colors

| Token | Hex / HSL | Role |
|---|---|---|
| `--success` | `hsl(158, 64%, 30%)` | Success states, funded badge, green membership badge |
| `--warning` | `hsl(38, 92%, 45%)` | KYC pending, expiry warning, amber badges |
| `--info` | `hsl(210, 92%, 42%)` | Qualified tier badge, info toasts |
| `--muted-foreground` | `hsl(219, 15%, 42%)` | Timestamps, secondary text (`#374151` Neutral Dark) |
| `--border` | `hsl(215, 20%, 88%)` | Card dividers, input borders (`#E5E7EB` Neutral Mid) |
| `--background` | `hsl(210, 33%, 98%)` | Page background (`#F8F9FA` Neutral Light) |
| `--card` | `hsl(0, 0%, 100%)` | Card surfaces — pure white |
| `--sidebar` | `hsl(219, 45%, 20%)` | Left sidebar nav — Navy |
| `--sidebar-foreground` | `hsl(210, 40%, 96%)` | Sidebar text — near-white |
| `--sidebar-border` | `hsl(219, 40%, 28%)` | Sidebar dividers — Navy +8L |
| `--sidebar-primary` | `hsl(184, 98%, 22%)` | Sidebar active item — Hydra Teal |
| `--sidebar-accent` | `hsl(219, 40%, 27%)` | Sidebar hover — Navy +7L |

// **Capavate currently has:** These are identical. See `index.css` `:root`.

### 1.3 Neutral Scale (inferred from Collective screenshots + audit)

| Step | Hex | HSL approx | Usage |
|---|---|---|---|
| `neutral-50` | `#F9FAFB` | `hsl(210 20% 98%)` | Page background variant |
| `neutral-100` | `#F3F4F6` | `hsl(215 25% 95%)` | Muted surfaces (`--muted`) |
| `neutral-200` | `#E5E7EB` | `hsl(215 20% 88%)` | Borders (`--border`) |
| `neutral-300` | `#D1D5DB` | `hsl(215 14% 83%)` | Input borders (`--input`) |
| `neutral-400` | `#9CA3AF` | `hsl(220 9% 65%)` | Placeholder text |
| `neutral-500` | `#6B7280` | `hsl(220 9% 46%)` | Caption text |
| `neutral-600` | `#4B5563` | `hsl(215 20% 34%)` | Secondary text |
| `neutral-700` | `#374151` | `hsl(215 25% 26%)` | Body text (`--muted-foreground` heavy) |
| `neutral-800` | `#1F2937` | `hsl(219 35% 17%)` | Dark text |
| `neutral-900` | `#111827` | `hsl(221 39% 11%)` | Darkest text / headings |
| `neutral-950` | `#0D1117` | `hsl(221 43% 8%)` | Near-black (rarely used) |

// **Capavate currently has:** Tailwind's default neutral scale mapped via CSS variables; full neutral ladder not explicitly declared — uses `--foreground: 219 45% 14%` for text, `--muted: 215 25% 95%` for fills. Port full ladder explicitly to `index.css` for component parity.

### 1.4 Hover / Focus / Disabled State Shifts

| State | Method | Value |
|---|---|---|
| Hover (fill) | `::after` overlay via `.hover-elevate` | `rgba(0,0,0,0.04)` → `var(--elevate-1)` |
| Hover-2 (stronger) | `.hover-elevate-2::after` | `rgba(0,0,0,0.09)` → `var(--elevate-2)` |
| Active / press | `.active-elevate::after` | Same `var(--elevate-1)` as hover |
| Focus | `focus-visible:ring-2` Hydra Teal | `--ring: 184 98% 26%` (slightly lighter than accent) |
| Disabled | `opacity-50` + `cursor-not-allowed` | No color shift — only opacity reduction |
| Button border shift | CSS relative-color via `opaque-button-border-intensity` | `calc(l + -8)` — darkens background by 8 lightness units |

```css
/* Exact index.css tokens */
--button-outline:  rgba(0,0,0, 0.10);
--badge-outline:   rgba(0,0,0, 0.05);
--opaque-button-border-intensity: -8;
--elevate-1:       rgba(0,0,0, 0.04);
--elevate-2:       rgba(0,0,0, 0.09);
```

---

## 2. Typography

### 2.1 Font Families

| Role | Family | CSS variable |
|---|---|---|
| Display / Body | Inter (fallback: `ui-sans-serif`, `system-ui`, `-apple-system`, `BlinkMacSystemFont`) | `--font-sans` |
| Serif (rare — legal copy) | Georgia | `--font-serif` |
| Monospace (code, hash displays) | `ui-monospace`, `SF Mono`, Menlo | `--font-mono` |

```css
--font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
--font-serif: Georgia, serif;
--font-mono: ui-monospace, "SF Mono", Menlo, monospace;
```

// **Capavate currently has:** Identical — `index.css` `:root` declares these three vars. Loading of Inter via CDN link in `index.html` assumed; confirm the `<link rel="preconnect">` to Google Fonts is present.

### 2.2 Type Scale (8-step)

| Step | Role | Font-size | Line-height | Letter-spacing | Weight |
|---|---|---|---|---|---|
| `display` | Hero heading (in-app max) | `1.5rem / 24px` | `1.2` (28.8px) | `−0.01em` | 600 |
| `h1` | Page title | `1.25rem / 20px` | `1.3` (26px) | `−0.01em` | 600 |
| `h2` | Section heading | `1.125rem / 18px` | `1.4` (25.2px) | `−0.01em` | 600 |
| `h3` | Card title | `1rem / 16px` | `1.4` (22.4px) | `0` | 600 |
| `body` | Default body copy | `0.9375rem / 15px` | `1.5` (22.5px) | `0` | 400 |
| `small` | Secondary / helper text | `0.8125rem / 13px` | `1.45` (18.9px) | `0` | 400 |
| `micro` | Badge labels, timestamps | `0.6875rem / 11px` | `1.4` (15.4px) | `0` | 500 |
| `mono` | Hash values, cert numbers | `0.8125rem / 13px` | `1.45` | `0` | 400 |

Source: `client/src/lib/design-tokens.ts` `typography` export.

### 2.3 Heading Hierarchy h1–h6

| Element | Size | Weight | Letter-spacing | Usage |
|---|---|---|---|---|
| `h1` | `1.25rem` | 600 | `−0.01em` | Page title (company name on deal banner — display) |
| `h2` | `1.125rem` | 600 | `−0.01em` | Section titles (e.g., "Round Terms", "Members Interested") |
| `h3` | `1rem` | 600 | `0` | Card titles, widget headers |
| `h4` | `0.9375rem` | 600 | `0` | Sub-section labels |
| `h5` | `0.875rem` | 500 | `0` | Inline section headers |
| `h6` | `0.8125rem` | 500 | `0` | Badge-sized headings |

Collective applies `letter-spacing: -0.01em` to h1–h4 globally (confirmed in `index.css` `@layer base`).

### 2.4 Text Variants

| Variant | Size | Weight | Color token | Usage |
|---|---|---|---|---|
| `body` | 15px | 400 | `--foreground` | Main prose |
| `body-lead` | 15px | 500 | `--foreground` | Lead paragraph (slightly heavier) |
| `caption` | 13px | 400 | `--muted-foreground` | Helper text, timestamps, location labels |
| `label` | 13px | 500 | `--foreground` | Form labels |
| `badge` | 12px | 500 | varies | Network/role pill badges |
| `timestamp` | 12px | 400 | `#374151` (Neutral Dark) | Post timestamps ("14d ago", "Apr 19") |

---

## 3. Spacing Scale

### 3.1 Base Unit

**4px (0.25rem)** — declared as `--spacing: 0.25rem` in `index.css`.

### 3.2 Full Ladder

| Token | rem | px |
|---|---|---|
| `spacing-px` | `1px` | 1 |
| `spacing-0` | `0` | 0 |
| `spacing-1` | `0.25rem` | 4 |
| `spacing-2` | `0.5rem` | 8 |
| `spacing-3` | `0.75rem` | 12 |
| `spacing-4` | `1rem` | 16 |
| `spacing-5` | `1.25rem` | 20 |
| `spacing-6` | `1.5rem` | 24 |
| `spacing-8` | `2rem` | 32 |
| `spacing-10` | `2.5rem` | 40 |
| `spacing-12` | `3rem` | 48 |
| `spacing-16` | `4rem` | 64 |

Standard page gutter: **24px (`p-6`)** — used for all left/right page padding in Collective.

### 3.3 Responsive Breakpoints

Collective uses Tailwind default breakpoints (not customized):

| Breakpoint | Width | Tailwind prefix |
|---|---|---|
| Mobile | `< 640px` | (default) |
| `sm` | `≥ 640px` | `sm:` |
| `md` | `≥ 768px` | `md:` |
| `lg` | `≥ 1024px` | `lg:` |
| `xl` | `≥ 1280px` | `xl:` |
| `2xl` | `≥ 1536px` | `2xl:` |

// **Capavate currently has:** Same Tailwind defaults; no custom breakpoints declared in `tailwind.config.ts`.

---

## 4. Border Radius

### 4.1 Collective Radius Ladder

```css
/* Base token */
--radius: 0.5rem;   /* 8px — default card radius */
```

| Size | Token | px | Usage |
|---|---|---|---|
| `xs` | `0.25rem` | 4 | Inline badges, micro chips |
| `sm` | `0.375rem` | 6 (tailwind: `.1875rem = 3px`) | Input radius; small badges |
| `md` | `0.5rem` | 8 | Default card radius (`--radius`) |
| `lg` | `0.5625rem` | 9 | Large cards, modal panels |
| `xl` | `1rem` | 16 | Feature cards, prominent sections |
| `2xl` | `1.5rem` | 24 | Large modal overlays |
| `full / pill` | `9999px` | — | Badge pills, avatar circles, pill buttons |

Collective uses pill shape (`rounded-full`) for ALL badge chips (network badge, role badge, status badge) and for primary CTA buttons ("Submit Soft-Circle", "Join Angel Network").

```typescript
// design-tokens.ts
export const radii = {
  xs:   "0.25rem",
  sm:   "0.375rem",
  md:   "0.5rem",
  lg:   "0.75rem",   // design-tokens.ts uses 0.75rem; tailwind.config.ts override = 0.5625rem
  xl:   "1rem",
  pill: "9999px",
} as const;
```

// **Capavate currently has:** `tailwind.config.ts` overrides `lg = 0.5625rem (9px)`, `md = 0.375rem (6px)`, `sm = 0.1875rem (3px)`. The design-tokens.ts ladder uses `lg = 0.75rem (12px)` — there is a **1-step mismatch** at `lg`. Collective card corners are closer to 8–9px (closer to `tailwind.config.ts` than design-tokens.ts). Recommend aligning design-tokens.ts `lg` to `0.5625rem`.

---

## 5. Shadow Scale

```css
/* All shadows from index.css — tinted with Navy (219 45% 14%) rather than pure black */
--shadow-2xs: 0px 1px 2px 0px hsl(219 45% 14% / 0.04);
--shadow-xs:  0px 1px 2px 0px hsl(219 45% 14% / 0.05);
--shadow-sm:  0px 1px 2px 0px hsl(219 45% 14% / 0.06),
              0px 1px 2px -1px hsl(219 45% 14% / 0.04);
--shadow:     0px 2px 4px 0px hsl(219 45% 14% / 0.06),
              0px 1px 2px -1px hsl(219 45% 14% / 0.04);
--shadow-md:  0px 4px 8px -2px hsl(219 45% 14% / 0.08),
              0px 2px 4px -1px hsl(219 45% 14% / 0.05);
--shadow-lg:  0px 8px 16px -4px hsl(219 45% 14% / 0.10),
              0px 4px 6px -1px hsl(219 45% 14% / 0.05);
--shadow-xl:  0px 16px 32px -8px hsl(219 45% 14% / 0.14);
--shadow-2xl: 0px 24px 48px -12px hsl(219 45% 14% / 0.20);
```

| Token | Purpose in Collective |
|---|---|
| `shadow-2xs` | Subtle depth on dashboard stat rows |
| `shadow-xs` | Card base-level resting state |
| `shadow-sm` | Sidebar list item hover |
| `shadow` | Standard card (`card` resting shadow) |
| `shadow-md` | Popover, dropdown menus |
| `shadow-lg` | Messages modal, larger panels |
| `shadow-xl` | Floating CTAs, floating compose toolbar |
| `shadow-2xl` | Full-page modal overlay (Messages dialog, Dataroom modal) |

In design-tokens.ts the shadow library is abbreviated to 3 entries:
```typescript
export const shadows = {
  none:  "none",
  card:  "0 1px 2px hsl(0 0% 0% / 0.04), 0 1px 1px hsl(0 0% 0% / 0.03)",
  pop:   "0 4px 14px hsl(0 0% 0% / 0.08)",
  modal: "0 20px 40px hsl(0 0% 0% / 0.18)",
};
```

// **Capavate currently has:** The 8-step shadow ladder is declared in `index.css` `:root`; design-tokens.ts exposes only 4 aliases. The `index.css` values are Navy-tinted (correct, matches Collective feel). The design-tokens.ts `pop` uses a neutral black rather than Navy tint — **minor divergence**; recommend updating design-tokens.ts to reference the CSS var ladder.

---

## 6. Motion

### 6.1 Duration Primitives (design-tokens.ts)

```typescript
export const motion = {
  fast: 120,   // ms — hover/press feedback
  base: 200,   // ms — reveal/dismiss panels
  slow: 320,   // ms — long content transitions
  ease: {
    standard:   "cubic-bezier(0.2, 0, 0, 1)",    // Material standard
    accelerate: "cubic-bezier(0.4, 0, 1, 1)",    // Dismiss
    decelerate: "cubic-bezier(0, 0, 0.2, 1)",    // Enter
  },
} as const;
```

### 6.2 Collective Observed Values

From audit + shadcn/ui defaults used by Collective:

| Interaction | Duration | Curve |
|---|---|---|
| Button hover overlay | 120ms | linear |
| Modal open / close | 200ms | ease-out |
| Accordion expand | 200ms | ease-out (from `tailwind.config.ts` animation) |
| Toast enter | 200ms | decelerate |
| Toast exit | 150ms | accelerate |
| Dropdown menu appear | 150ms | ease-out |
| Page tab switch | 200ms | standard |
| Soft-circle state change banner | 300ms | decelerate |

```typescript
// tailwind.config.ts (Capavate, matches Collective)
animation: {
  "accordion-down": "accordion-down 0.2s ease-out",
  "accordion-up":   "accordion-up 0.2s ease-out",
}
```

// **Capavate currently has:** Motion values match Collective exactly as documented. The `tailwind-animate` plugin is installed and wired.

---

## 7. Component Styles

### 7.1 Button

**Primary** (Hydra Teal CTA — "Submit Soft-Circle", "Join Angel Network"):
```
bg:      hsl(184 98% 22%)   [--accent]
fg:      white
border:  transparent
radius:  9999px (pill)
padding: h-10 px-6 (md) / h-8 px-4 (sm) / h-12 px-8 (lg)
weight:  500
hover:   elevate-1 overlay (rgba(0,0,0,0.04))
focus:   ring-2 ring-offset-2, ring = hsl(184 98% 26%)
```

**Secondary** (Gray outline — "Follow Name", "Request More Information"):
```
bg:      white
fg:      hsl(219 45% 20%)   [--primary]
border:  hsl(215 20% 88%)   [--border]
radius:  pill or rounded-md depending on surface
hover:   secondary-border intensified via opaque-button-border-intensity
```

**Ghost** (Nav actions):
```
bg:      transparent
fg:      hsl(222 25% 14%)   [--ink / --foreground]
border:  transparent
hover:   elevate-1 overlay
```

**Destructive** ("Decline", "Revoke", destructive admin actions):
```
bg:      hsl(7 61% 43%)     [--destructive]
fg:      white
border:  transparent; border-color computed via opaque-button-border-intensity
hover:   elevate-1 overlay
```

**Hydra** (internal variant alias):
```
bg:      hsl(184 98% 22%)
fg:      white
border:  transparent
```

**Plum** (DSC surfaces, committee-mode):
```
bg:      hsl(333 75% 35%)
fg:      white
border:  transparent
```

**Comms action variant** ("View All Messages" button — red/coral):
The live Collective uses a red-coral (`approx #E94040`) filled pill for the "View All Messages" CTA. This is the `reject` token applied to a prominence-attention button, NOT a destructive semantic. In the rebuild: use `buttonVariants.destructive` but rename the contextual label.

**Sizes:**
| Size | Height | H-padding | Font |
|---|---|---|---|
| `sm` | `h-8 (32px)` | `px-3` | 13px |
| `md` | `h-10 (40px)` | `px-6` | 15px |
| `lg` | `h-12 (48px)` | `px-8` | 15px / 500 |

### 7.2 Card

```
bg:        hsl(0 0% 100%)     [--card]
fg:        hsl(219 45% 14%)   [--card-foreground]
border:    hsl(215 20% 90%)   [--card-border]
radius:    0.5625rem (9px)    [tailwind lg]
shadow:    var(--shadow)      [default card shadow]
padding:   p-4 to p-6 depending on density
```

Post card: avatar 48px + name bold + timestamp gray + network badge pill (gold/orange) + role badge pill (green) + location caption + body text + like/comment/share row.

### 7.3 Input

```
bg:        white (or hsl(0 0% 100%))
border:    hsl(215 20% 80%)   [--input]
radius:    0.5rem              [md]
height:    h-10 (40px)
padding:   px-3 py-2
placeholder: hsl(219 15% 42%) [--muted-foreground]
focus-ring: ring-1 ring-ring  [Hydra Teal at 26% L]
```

Error state:
```
border:    hsl(7 61% 43%)     [--destructive]
ring:      ring-1 ring-destructive
```

### 7.4 Select

Follows shadcn/ui `<Select>` — same height/padding as Input; dropdown uses popover shadow (`--shadow-md`); selected value shown in --foreground; chevron icon rotates on open (200ms).

### 7.5 Checkbox

```
size:      16×16px
border:    --border (unchecked)
bg-checked: --primary (Navy)
checkmark: white SVG
radius:    sm (3px)
focus:     ring-2 ring-offset-2 ring-ring (Hydra)
```

### 7.6 Radio

```
size:      16×16px circle
border:    --border (unchecked)
fill-checked: --primary (Navy) center dot
focus:     ring-2 ring-ring
```

Used in soft-circle type selector: "Definite commitment / Indication of interest / Conditional on due diligence" — radio group, 3 options.

### 7.7 Switch (Toggle)

```
track-off: --muted (light gray)
track-on:  --primary (Navy) or --accent (Hydra Teal) depending on surface
thumb:     white circle, shadow-xs
size:      h-5 w-9 (20×36px)
transition: 200ms standard
```

Used for: investor profile visibility toggles (3 toggles on `/investor/profile` Network Profile tab), Collective member section visibility, Cap-table co-member opt-in.

### 7.8 Badge / Pill

```
font:      12px / weight 500
radius:    9999px (full)
padding:   px-2 py-0.5
border:    rgba(0,0,0,0.05)   [--badge-outline]
```

| Variant | bg | fg |
|---|---|---|
| Network (Angel Network gold) | `hsl(38 92% 45%)` [--warning] | white |
| Role (Investor green) | `hsl(158 64% 30%)` [--success] | white |
| Status — KYC Pending | `hsl(38 92% 45%)` [--warning] | white |
| Status — Suspended | `hsl(7 61% 43%)` [--destructive] | white |
| Status — NOT on cap table | `hsl(7 61% 43%)` [--destructive] | white |
| Auto-tier Watch | `hsl(222 8% 42%)` [--inkMuted] | white |
| Auto-tier Qualified | `hsl(210 92% 42%)` [--info] | white |
| Auto-tier Featured | `hsl(184 98% 22%)` [--hydra] | white |
| Auto-tier Priority | `hsl(333 75% 35%)` [--plum] | white |

```typescript
// design-tokens.ts tierColors (verbatim)
export const tierColors = {
  watch:     `hsl(${colors.inkMuted})`,   // hsl(222 8% 42%)
  qualified: `hsl(${colors.info})`,       // hsl(210 92% 42%)
  featured:  `hsl(${colors.hydra})`,      // hsl(184 98% 22%)
  priority:  `hsl(${colors.plum})`,       // hsl(333 75% 35%)
} as const;
```

### 7.9 Chip (tag chip)

```
font:     12px / 400
radius:   sm (6px)
padding:  px-2 py-0.5
bg:       --secondary (hsl 215 25% 94%)
fg:       --secondary-foreground (hsl 219 45% 16%)
border:   none
```

Used for: industry tags, region tags on company header, "cap-table" / "soft-circle" channel kind labels.

### 7.10 Avatar

```
shape:    circle (rounded-full)
border:   1px white or 1px --border
sizes:
  sm:  32px — message list items
  md:  40px — dashboard conversation rows, composer
  lg:  48px — post cards, thread headers
  xl:  64px — company header banner logo
fallback: initials (2-char, background = hash of name → one of 6 brand colors)
online dot: 8px circle, position bottom-right of avatar, bg = status.online (rgb 34 197 94)
```

### 7.11 Tabs

```
bar:       horizontal flex, border-bottom 1px --border
item:       px-4 py-2, font 14px 500, --muted-foreground (inactive)
item-active: font 14px 600, --foreground, border-bottom 2px --primary
indicator:  sliding 200ms ease transition (Radix Tabs)
```

### 7.12 Modal / Dialog

```
overlay:   rgba(0 0 0 / 0.5) backdrop
panel:     bg white, radius lg (9px), shadow-2xl, max-w-[90vw]
header:    px-6 pt-6, h2 title + close × button
body:      px-6 py-4
footer:    px-6 pb-6, flex justify-end gap-3
transition: 200ms decelerate (enter), 150ms accelerate (exit)
```

Messages modal specific:
- Split layout: 40% left (conversation list) + 60% right (thread)
- Max height: 80vh; left panel scrollable; right panel scrollable with sticky input
- Close ✕ top-right corner

### 7.13 Toast

```
position:  fixed bottom-right, z-50
radius:    rounded-lg (9px)
shadow:    shadow-lg
padding:   px-4 py-3
width:     min-w-[320px] max-w-[420px]
```

Variants:
| Kind | bg | fg | icon |
|---|---|---|---|
| Default | white | --foreground | — |
| Success | `hsl(158 64% 30%)` | white | ✓ |
| Error | `hsl(7 61% 43%)` | white | ✕ |
| Info | `hsl(210 92% 42%)` | white | ℹ |
| Warning | `hsl(38 92% 45%)` | white | ⚠ |

### 7.14 Tooltip

```
bg:        hsl(219 45% 14%)   [--ink / near-black Navy]
fg:        white
radius:    sm (6px)
padding:   px-3 py-1.5
font:      12px / 400
delay:     300ms show, 100ms hide
max-width: 240px
```

### 7.15 Skeleton

```
bg:        hsl(215 25% 94%)   [--secondary / --muted]
animated:  pulse, 1.5s ease-in-out infinite
radius:    matches the element being skeletonized (card → rounded-lg; text → rounded-sm)
```

### 7.16 EmptyState

```
layout:    flex col, items-center, py-16 gap-4
icon:      emoji or 48px SVG illustration
heading:   h3, 16px 600, --foreground
body:      14px 400, --muted-foreground, text-center, max-w-xs
cta:       optional button (primary variant)
```

Collective observed copy patterns:
- Messages: speech bubble emoji + "No conversations yet"
- Thread select: large speech bubble + "Select a conversation" + "Choose from your existing conversations"
- Connections: "There are no records to display" + search field

### 7.17 Pagination

```
style:     numbered pages + prev/next arrows
item-size: 32×32px min
active:    bg --primary fg white rounded-md
inactive:  ghost rounded-md
disabled:  opacity-50
ellipsis:  "…" text separator
```

Collective discover companies: "1-10 of 27, navigation arrows", 10 rows per page.

### 7.18 Menu / Dropdown

```
bg:        white
shadow:    shadow-md
radius:    md (8px)
border:    1px --border
item:      h-8 px-3, font 14px 400, --foreground
item-hover: bg --secondary
separator: 1px --border
```

---

## 8. Layout Patterns

### 8.1 Page Wrappers

- **Investor dashboard:** 3-column grid — `~23% / ~55% / ~22%`, full viewport height, no max-width constraint visible
- **Company detail:** Full-width header banner + constrained content below (`max-w-5xl` inferred)
- **Messages modal:** Centered overlay, `max-w-3xl` approx, `80vh` height
- **Admin panel:** Full-width with left nav rail (fixed, 240px) + scrollable content area

### 8.2 Max-Widths

| Surface | Max-width |
|---|---|
| Prose / form content | `max-w-2xl` (~672px) |
| Dashboard content col | `max-w-3xl` (~768px) |
| Full-width data table | unconstrained |
| Registration wizard | `max-w-lg` (~512px) |

### 8.3 Container Padding

- Page: `px-6 py-6` (24px all sides) on ≥md; `px-4` on mobile
- Card: `p-4` (16px) compact; `p-6` (24px) generous

### 8.4 Sidebar Nav

```
width:     240px (fixed left)
bg:        --sidebar (Navy hsl 219 45% 20%)
fg:        --sidebar-foreground (near-white)
item-h:    h-10 (40px)
item-pad:  px-4
item-radius: sm (3px)
item-active: bg --sidebar-accent, fg --sidebar-primary (Hydra)
item-hover:  bg --sidebar-accent (Navy+7L)
border-right: 1px --sidebar-border
```

Nav items on Collective investor sidebar (observed):
1. Edit Profile
2. My Portfolio & Watchlist
3. Incoming Invitations
4. Archived Page
5. My Contacts & Connections
6. Discover Companies
7. Knowledge Hub
8. Angel Profile (+ 👁 eye icon for visibility toggle)
9. Dashboard HOME (top bar)
10. Your Role/Permissions (top bar, company side only)

### 8.5 Header

```
height:    h-14 (56px)
bg:        white or --background
border-b:  1px --border
content:   left logo + right avatar/name + notification bell + settings
shadow:    none (border-b only)
```

---

## 9. Form Patterns

### 9.1 Label Position

Top-aligned labels (above input), all caps for section labels in multi-step wizard, sentence-case for inline form labels.

Example from soft-circle form:
```
INVESTMENT AMOUNT    ← uppercase section label
[input field]

SOFT-CIRCLE TYPE    ← uppercase section label
○ Definite commitment
○ Indication of interest
○ Conditional on due diligence

PERSONAL NOTE TO FOUNDER
[textarea — max 500 chars]
```

### 9.2 Error States

```
border:    1px hsl(7 61% 43%) [--destructive]
ring:      ring-1 ring-destructive/30
message:   12px --destructive, below input, flex gap-1 (⚠ icon + text)
```

### 9.3 Helper Text

```
font:    12px / 400
color:   --muted-foreground
margin:  mt-1 below input
```

### 9.4 Required Markers

```
symbol:  * (asterisk) in --destructive color
position: after label text (inline)
```

### 9.5 Autocomplete Behaviors

Registration wizard: jurisdiction select uses searchable combobox (`<Command>` from shadcn/ui); currency select uses filtered dropdown for soft-circle amount (7 currencies: USD/CAD/GBP/EUR/SGD/HKD/AUD).

---

## 10. Empty / Error / Loading States

### 10.1 Empty States

| Surface | Icon | Heading | Body | CTA |
|---|---|---|---|---|
| No conversations | 💬 (large) | "No conversations yet" | — | — |
| Thread: no selection | 💬 (XL) | "Select a conversation" | "Choose from your existing conversations" | — |
| Connections (all tabs) | — | "There are no records to display" | — | Search field |
| Portfolio (empty) | — | "My Ownership Distribution" (empty chart) | — | — |
| Post feed (empty) | — | — | no posts shown | Post composer |

Collective pattern: **emoji or SVG illustration + heading + optional sub-copy**. Never just text alone.

### 10.2 Error States

Inline form errors: `⚠` icon + message in `--destructive` color, below field.  
Toast errors: destructive variant toast (red bg, white text, ✕ icon).  
Page-level error: no observed 404/500 page in audit; inferred to use a card-based error with "Try again" CTA.

### 10.3 Loading States

Skeleton blocks matching card dimensions, `--muted` bg with pulse animation. Collective uses inferred shadcn/ui patterns — no custom illustrated loading states observed.

---

## 11. Micro-interactions

### 11.1 Hover Lift (Cards / Buttons)

`.hover-elevate` class applies pseudo-element overlay:
```css
.hover-elevate:hover::after { background-color: var(--elevate-1); /* rgba(0,0,0,0.04) */ }
.hover-elevate-2:hover::after { background-color: var(--elevate-2); /* rgba(0,0,0,0.09) */ }
```

No box-shadow change on hover — the lift is a translucent overlay, not a shadow shift.

### 11.2 Click / Active Feedback

`.active-elevate:active::after` → same `--elevate-1` overlay as hover (no deeper press state).

### 11.3 Focus Rings

```
focus-visible:ring-2 focus-visible:ring-offset-2 ring = hsl(184 98% 26%) [--ring, Hydra Teal light]
```

Applied to all interactive elements via shadcn/ui components + Tailwind base.

### 11.4 Toggle Elevated (Switch/Toggle state)

`.toggle-elevate.toggle-elevated::before { background-color: var(--elevate-2) }` — used for active/selected state of toggle items.

### 11.5 Drag Affordances

Not observed on the Collective investor-facing surfaces. Drag may be present in admin cap-table reorder or DSC review queue (not audited in detail).

### 11.6 Message Bubble

Sender bubbles: right-aligned, red/coral fill (`approx #E94040` — Reject token applied to message sender). Recipient bubbles: left-aligned, white with `--border` outline. All bubbles: `rounded-lg` (9px), subtle shadow-xs, read receipt ✓✓ below sender bubble (gray = delivered, dark = read).

---

## 12. Accessibility Tokens

### 12.1 Focus-Visible Ring

```
ring-color:  hsl(184 98% 26%)   [--ring — Hydra Teal, slightly lighter than accent for contrast]
ring-width:  2px
ring-offset: 2px (white gap between element border and ring)
```

### 12.2 Contrast Targets

| Element | Foreground | Background | Ratio target |
|---|---|---|---|
| Body text | `hsl(219 45% 14%)` | `hsl(210 33% 98%)` | ≥ 7:1 (WCAG AA large + AAA small) |
| Caption text | `hsl(219 15% 42%)` | white | ≥ 4.5:1 (AA) |
| Primary button label | white | `hsl(219 45% 20%)` Navy | ≥ 7:1 |
| Accent button label | white | `hsl(184 98% 22%)` Hydra | ~4.5:1 (AA — tight; verify at implementation) |
| Destructive button label | white | `hsl(7 61% 43%)` Reject | ~4.5:1 (AA) |
| Badge text | white | `hsl(158 64% 30%)` success | ≥ 4.5:1 |
| Nav item (active) | `hsl(184 98% 22%)` | `hsl(219 40% 27%)` | ≥ 4.5:1 |

### 12.3 ARIA Patterns

- Role badges: `aria-label="Member type: Accredited Investor"` pattern
- Modal dialogs: `role="dialog"` + `aria-labelledby` via shadcn/ui Dialog
- Notification bell: `aria-label="Notifications, N unread"` with dynamic count
- Screen name privacy note (verbatim — must appear on Network Profile tab):
  > "NOTE: Your screen name will be visible to all shareholders on the same cap table and across all social media sections of Capavate.com. Your portfolio companies, where you are a shareholder, will have access to your real name."

### 12.4 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Enter` | Send message (message composer) |
| `Escape` | Close modal / dialog (shadcn/ui default) |
| `Tab` | Focus traversal through all interactive elements |
| `Space / Enter` | Activate focused button or checkbox |

---

## Appendix A: Collective-to-Capavate Token Divergence Summary

The following 6 divergences have the highest visual impact for a restyle:

1. **Button shape** — Collective uses `pill` (9999px) for all primary + secondary CTAs. Capavate currently uses `rounded-md` (6–9px) in most places. Port: set primary/secondary/ghost buttons to `rounded-full`.
2. **Message bubble color** — Collective uses red/coral (`~#E94040`, Reject token) for sender bubbles, which creates a distinctive high-contrast messaging UX. Capavate default shadcn bubbles are primary/blue. Port: apply `--destructive` background to sender chat bubbles.
3. **Sidebar active item** — Collective `--sidebar-primary` is Hydra Teal (not white). The active nav item glows teal against the Navy sidebar. Capavate: confirm `--sidebar-primary` is wired correctly and not defaulting to white.
4. **Badge gold for Angel Network** — The "🏅 Capavate Angel Network" badge uses `--warning` (amber/gold, `hsl 38 92% 45%`) not the brand Navy or Hydra. Capavate badge variants don't include a gold/warning filled pill for membership badges.
5. **Three-column layout** — Collective investor dashboard is exactly `23% / 55% / 22%` three-column. Capavate rebuilds use a two-column or full-width layout in most pages. Port: implement the three-column grid specifically for the Collective investor dashboard view.
6. **Shadow tint** — All Collective shadows are tinted with `hsl(219 45% 14%)` (dark Navy) rather than pure black. This gives cards a warm-but-cool depth consistent with the Navy brand. Capavate `design-tokens.ts` `pop`/`modal` shadows use pure black (`hsl(0 0% 0%)`). Port: update design-tokens.ts to reference the CSS var shadow ladder which is already Navy-tinted.
