# Capavate Design Tokens (Wave G G1)

This document is the canonical reference for the `cap-*` design token system.
It is the spine for migrating the remaining ~372 hardcoded brand-color
literals to a tokenized namespace **without** a single visual regression.

## Why tokens?

Hardcoded literals like `hsl(184 98% 22%)` are scattered across the codebase
(per Wave E Sub-3 audit). Each one is a future maintenance hazard:

- Brand color changes require a global find/replace
- Dark-mode work is impossible without a token layer
- Theming for white-labeled partners is impossible

The `cap-*` token system gives every component a single, semantic anchor
point. The token resolves to the brand value today, but can be swapped
centrally for theming or dark mode.

## Token table

All tokens are HSL triplets, exposed as CSS custom properties under `:root`
in `client/src/index.css` and as Tailwind utilities in `tailwind.config.ts`.

| Token | CSS var | HSL | Hex (approx) | Tailwind utility | Usage |
|---|---|---|---|---|---|
| Primary | `--cap-primary` | `184 98% 22%` | `#016F70` | `bg-cap-primary`, `text-cap-primary`, `border-cap-primary` | Brand accent (Hydra Teal). CTAs, links, focus rings. |
| Primary hover | `--cap-primary-hover` | `184 98% 18%` | `#015B5C` | `bg-cap-primary-hover` | Hover state for primary CTAs. |
| Secondary | `--cap-secondary` | `219 45% 20%` | `#1C2B4A` | `bg-cap-secondary` | Brand navy. Headers, sidebars. |
| Secondary hover | `--cap-secondary-hover` | `219 45% 16%` | `#16223B` | `bg-cap-secondary-hover` | Hover state for secondary surfaces. |
| Surface | `--cap-surface` | `0 0% 100%` | `#FFFFFF` | `bg-cap-surface` | Card / panel background. |
| Surface hover | `--cap-surface-hover` | `210 33% 96%` | `#F3F5F8` | `bg-cap-surface-hover` | Subtle hover tint over surface. |
| Border | `--cap-border` | `215 20% 88%` | `#DCE0E6` | `border-cap-border` | Default border color. |
| Text primary | `--cap-text-primary` | `219 45% 14%` | `#141F36` | `text-cap-text-primary` | Body text. |
| Text secondary | `--cap-text-secondary` | `219 15% 42%` | `#5C6377` | `text-cap-text-secondary` | Muted body text. |
| Text disabled | `--cap-text-disabled` | `219 15% 65%` | `#9098A8` | `text-cap-text-disabled` | Disabled control labels. |
| Success | `--cap-success` | `158 64% 30%` | `#1C7F58` | `bg-cap-success`, `text-cap-success` | Positive states. |
| Warning | `--cap-warning` | `38 92% 45%` | `#DC9112` | `bg-cap-warning`, `text-cap-warning` | Warning states. |
| Error | `--cap-error` | `7 61% 43%` | `#B33A2B` | `bg-cap-error`, `text-cap-error` | Destructive / error states. |
| Info | `--cap-info` | `219 70% 55%` | `#3F70CE` | `bg-cap-info`, `text-cap-info` | Informational states. |

## Usage examples

```tsx
// Card surface
<div className="bg-cap-surface border border-cap-border rounded-xl p-6">
  <h3 className="text-cap-text-primary text-lg font-semibold">Title</h3>
  <p className="text-cap-text-secondary mt-1">Description goes here.</p>
</div>

// Primary CTA
<button className="bg-cap-primary text-white hover:bg-cap-primary-hover rounded-full px-6 py-2">
  Subscribe
</button>

// Status badges
<span className="bg-cap-success/10 text-cap-success px-2 py-0.5 rounded-md">Active</span>
<span className="bg-cap-warning/10 text-cap-warning px-2 py-0.5 rounded-md">Pending</span>
<span className="bg-cap-error/10 text-cap-error px-2 py-0.5 rounded-md">Failed</span>
<span className="bg-cap-info/10 text-cap-info px-2 py-0.5 rounded-md">Note</span>
```

## Migration policy

**Wave G ships the tokens but does NOT mass-migrate the 372 literal sites.**
Mass migration is high-risk for visual regression. Instead:

1. The 8 highest-traffic components are **enrolled** in the namespace via a
   `data-cap-token="<name>"` attribute (Card, Button, Input, Dialog, Toast,
   Badge, sidebar wrapper, sidebar nav-link). The semantic classes they already
   use (`bg-primary`, `border-card-border`, `bg-background`, etc.) resolve to
   the same HSL values as the new `cap-*` tokens — so enrollment is zero-diff
   visually but signals "token-aware" to future migrators.
2. Future PRs may replace `hsl(184 98% 22%)` literals with `bg-cap-primary`
   one file at a time, with a snapshot review per PR.
3. Avi can use `grep -n "data-cap-token" client/src` to track migration coverage.

## Token enrollment status (Wave G launch)

| Component | File | Status |
|---|---|---|
| Card | `client/src/components/ui/card.tsx` | Enrolled (`data-cap-token="surface"`) |
| Button | `client/src/components/ui/button.tsx` | Enrolled (`data-cap-token="button"`) |
| Input | `client/src/components/ui/input.tsx` | Enrolled (`data-cap-token="input"`) |
| Dialog | `client/src/components/ui/dialog.tsx` | Enrolled (`data-cap-token="dialog"`) |
| Toast | `client/src/components/ui/toast.tsx` | Enrolled (`data-cap-token="toast"`) |
| Badge | `client/src/components/ui/badge.tsx` | Enrolled (`data-cap-token="badge"`) |
| Sidebar | `client/src/components/ui/sidebar.tsx` | Enrolled (`data-cap-token="sidebar"`) |
| NavLink (SidebarMenuButton) | `client/src/components/ui/sidebar.tsx` | Enrolled (`data-cap-token="nav-link"`) |

## Regression guard

The contract is frozen by `server/__tests__/designTokensExposed.test.ts`.
That test asserts:

- All CSS custom properties exist in `client/src/index.css`
- All Tailwind utilities are mapped in `tailwind.config.ts`
- All 8 enrollment components carry the `data-cap-token` attribute

If a refactor removes any token or enrollment, the test fails — preventing
silent erosion of the design system.
