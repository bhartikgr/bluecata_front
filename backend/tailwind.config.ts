import type { Config } from "tailwindcss";

// Sprint 11 — light-only lock: dark mode is permanently disabled.
export default {
  darkMode: "class", // class still present so the `.dark` class would win if applied; runtime guard never applies it.
  // sprint11LightOnly: true

  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: ".5625rem", /* 9px */
        md: ".375rem", /* 6px */
        sm: ".1875rem", /* 3px */
      },
      colors: {
        // Flat / base colors (regular buttons)
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        highlight: {
          DEFAULT: "hsl(var(--highlight) / <alpha-value>)",
          foreground: "hsl(var(--highlight-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          foreground: "hsl(var(--success-foreground) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          foreground: "hsl(var(--warning-foreground) / <alpha-value>)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
          "6": "hsl(var(--chart-6) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)"
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
        // Wave E Fix E4 — canonical brand utilities. Use `bg-cap-primary`,
        // `text-cap-primary`, `border-cap-primary`, etc. Future PRs migrate
        // hardcoded `hsl(184_98%_22%)` literals to these. v23 supports both.
        "cap-primary": {
          DEFAULT: "hsl(var(--cap-primary) / <alpha-value>)",
          hover: "hsl(var(--cap-primary-hover) / <alpha-value>)",
        },
        "cap-secondary": {
          DEFAULT: "hsl(var(--cap-secondary) / <alpha-value>)",
          hover: "hsl(var(--cap-secondary-hover) / <alpha-value>)",
        },
        // Wave G G1 — extended token namespace (additive). These map to the
        // CSS custom properties declared in client/src/index.css. Each is a
        // thin alias over an existing semantic var, so consuming a `cap-*`
        // utility yields the same hex as the legacy literal it replaces.
        "cap-surface": {
          DEFAULT: "hsl(var(--cap-surface) / <alpha-value>)",
          hover: "hsl(var(--cap-surface-hover) / <alpha-value>)",
        },
        "cap-border": "hsl(var(--cap-border) / <alpha-value>)",
        "cap-text": {
          primary: "hsl(var(--cap-text-primary) / <alpha-value>)",
          secondary: "hsl(var(--cap-text-secondary) / <alpha-value>)",
          disabled: "hsl(var(--cap-text-disabled) / <alpha-value>)",
        },
        "cap-success": "hsl(var(--cap-success) / <alpha-value>)",
        "cap-warning": "hsl(var(--cap-warning) / <alpha-value>)",
        "cap-error": "hsl(var(--cap-error) / <alpha-value>)",
        "cap-info": "hsl(var(--cap-info) / <alpha-value>)",
        /* ══════════════════════════════════════════════════════════════════
         * WAVE 0 — THE 125 RAMP STEPS.  READ THIS BEFORE CHANGING A VALUE.
         * ══════════════════════════════════════════════════════════════════
         *
         * WHAT THIS IS.  The status colour coding on this platform is not held
         * in tokens.  It is 2,884 hand-typed Tailwind palette classes
         * (`bg-emerald-50 text-emerald-700`, `border-amber-300/60`) spread over
         * 224 files, and none of them reads a token.  Measured, three ways:
         * build_log/wave0_design/palette_scan_BEFORE.json.
         *
         * Those 2,884 classes resolve through only 125 ramp steps in 17
         * families.  Each of those 125 steps is redeclared below as
         * `rgb(var(--ramp-<family>-<step>) / <alpha-value>)`, and the values
         * live in `client/src/styles/ledger-ramps.css` — globally and once per
         * `[data-product]` area.  A wave therefore re-colours every palette
         * class in its own area by editing ONE CSS block.  ZERO component
         * edits, no className string touched, no JSX restructured, nothing
         * that can drop a widget.  Reversible by deleting one CSS file.
         *
         * WAVE 0 CHANGES NO COLOUR.  Every `--ramp-*` value in
         * ledger-ramps.css is byte-identical to the stock Tailwind value the
         * same class resolved to before this block existed.  All 125 are
         * compared before/after out of the real compiled bundle in
         * build_log/wave0_design/W0_RAMP_NOOP_PROOF.md.  The diff is zero.
         * IF YOU CHANGE A VALUE HERE OR THERE, RE-RUN THAT PROOF.
         *
         * WHY THE `rgb(var(…) / <alpha-value>)` FORM.  Not stylistic.  200+
         * call sites use an opacity modifier (`bg-amber-500/10`).  Tailwind can
         * only inject `<alpha-value>` into a colour function, so a bare
         * `var(--ramp-amber-500)` would silently drop the alpha and paint those
         * sites at full opacity.
         *
         * ONLY the 125 steps in use are declared.  Every other step of every
         * family still resolves to stock Tailwind, because `extend` merges.
         *
         * THE HONEST COST.  After a wave spends this, `bg-emerald-50` means
         * "positive tint", not "emerald 50".  A later reader will be surprised.
         * That readability debt is accepted deliberately; the alternative is
         * 2,884 JSX edits.  Recorded as migration debt, not hidden.
         */
        amber: {
          "50": "rgb(var(--ramp-amber-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-amber-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-amber-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-amber-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-amber-400) / <alpha-value>)",
          "500": "rgb(var(--ramp-amber-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-amber-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-amber-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-amber-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-amber-900) / <alpha-value>)",
          "950": "rgb(var(--ramp-amber-950) / <alpha-value>)",
        },
        blue: {
          "50": "rgb(var(--ramp-blue-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-blue-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-blue-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-blue-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-blue-400) / <alpha-value>)",
          "500": "rgb(var(--ramp-blue-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-blue-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-blue-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-blue-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-blue-900) / <alpha-value>)",
        },
        cyan: {
          "100": "rgb(var(--ramp-cyan-100) / <alpha-value>)",
          "300": "rgb(var(--ramp-cyan-300) / <alpha-value>)",
          "700": "rgb(var(--ramp-cyan-700) / <alpha-value>)",
          "900": "rgb(var(--ramp-cyan-900) / <alpha-value>)",
        },
        emerald: {
          "50": "rgb(var(--ramp-emerald-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-emerald-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-emerald-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-emerald-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-emerald-400) / <alpha-value>)",
          "500": "rgb(var(--ramp-emerald-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-emerald-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-emerald-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-emerald-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-emerald-900) / <alpha-value>)",
        },
        gray: {
          "50": "rgb(var(--ramp-gray-50) / <alpha-value>)",
          "200": "rgb(var(--ramp-gray-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-gray-300) / <alpha-value>)",
          "500": "rgb(var(--ramp-gray-500) / <alpha-value>)",
          "800": "rgb(var(--ramp-gray-800) / <alpha-value>)",
        },
        green: {
          "50": "rgb(var(--ramp-green-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-green-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-green-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-green-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-green-400) / <alpha-value>)",
          "600": "rgb(var(--ramp-green-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-green-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-green-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-green-900) / <alpha-value>)",
        },
        indigo: {
          "50": "rgb(var(--ramp-indigo-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-indigo-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-indigo-200) / <alpha-value>)",
          "700": "rgb(var(--ramp-indigo-700) / <alpha-value>)",
        },
        orange: {
          "50": "rgb(var(--ramp-orange-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-orange-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-orange-200) / <alpha-value>)",
          "600": "rgb(var(--ramp-orange-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-orange-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-orange-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-orange-900) / <alpha-value>)",
        },
        purple: {
          "50": "rgb(var(--ramp-purple-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-purple-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-purple-200) / <alpha-value>)",
          "700": "rgb(var(--ramp-purple-700) / <alpha-value>)",
          "900": "rgb(var(--ramp-purple-900) / <alpha-value>)",
        },
        red: {
          "50": "rgb(var(--ramp-red-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-red-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-red-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-red-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-red-400) / <alpha-value>)",
          "500": "rgb(var(--ramp-red-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-red-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-red-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-red-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-red-900) / <alpha-value>)",
        },
        rose: {
          "50": "rgb(var(--ramp-rose-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-rose-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-rose-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-rose-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-rose-400) / <alpha-value>)",
          "500": "rgb(var(--ramp-rose-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-rose-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-rose-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-rose-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-rose-900) / <alpha-value>)",
          "950": "rgb(var(--ramp-rose-950) / <alpha-value>)",
        },
        sky: {
          "50": "rgb(var(--ramp-sky-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-sky-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-sky-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-sky-300) / <alpha-value>)",
          "500": "rgb(var(--ramp-sky-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-sky-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-sky-700) / <alpha-value>)",
          "900": "rgb(var(--ramp-sky-900) / <alpha-value>)",
        },
        slate: {
          "50": "rgb(var(--ramp-slate-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-slate-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-slate-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-slate-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-slate-400) / <alpha-value>)",
          "500": "rgb(var(--ramp-slate-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-slate-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-slate-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-slate-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-slate-900) / <alpha-value>)",
        },
        teal: {
          "100": "rgb(var(--ramp-teal-100) / <alpha-value>)",
          "300": "rgb(var(--ramp-teal-300) / <alpha-value>)",
          "900": "rgb(var(--ramp-teal-900) / <alpha-value>)",
        },
        violet: {
          "100": "rgb(var(--ramp-violet-100) / <alpha-value>)",
          "300": "rgb(var(--ramp-violet-300) / <alpha-value>)",
          "500": "rgb(var(--ramp-violet-500) / <alpha-value>)",
          "700": "rgb(var(--ramp-violet-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-violet-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-violet-900) / <alpha-value>)",
        },
        yellow: {
          "400": "rgb(var(--ramp-yellow-400) / <alpha-value>)",
          "700": "rgb(var(--ramp-yellow-700) / <alpha-value>)",
        },
        zinc: {
          "50": "rgb(var(--ramp-zinc-50) / <alpha-value>)",
          "100": "rgb(var(--ramp-zinc-100) / <alpha-value>)",
          "200": "rgb(var(--ramp-zinc-200) / <alpha-value>)",
          "300": "rgb(var(--ramp-zinc-300) / <alpha-value>)",
          "400": "rgb(var(--ramp-zinc-400) / <alpha-value>)",
          "500": "rgb(var(--ramp-zinc-500) / <alpha-value>)",
          "600": "rgb(var(--ramp-zinc-600) / <alpha-value>)",
          "700": "rgb(var(--ramp-zinc-700) / <alpha-value>)",
          "800": "rgb(var(--ramp-zinc-800) / <alpha-value>)",
          "900": "rgb(var(--ramp-zinc-900) / <alpha-value>)",
        },
      },
      /* WAVE 0 — MEASURED SIDE EFFECT OF THE RAMP BLOCK ABOVE, PINNED BACK.
       *
       * Tailwind 3.4's own `ringColor.DEFAULT` is `theme('colors.blue.500')`,
       * and the `ringWidth` plugin turns it into the preflight default
       * `--tw-ring-color` by calling `withAlphaValue(value, 0.5, fallback)`.
       * `withAlphaValue` cannot parse a colour whose channels are a `var()`, so
       * the moment `blue.500` became `rgb(var(--ramp-blue-500) / <alpha-value>)`
       * it silently fell back to the plugin's hard-coded literal
       * `rgb(147 197 253 / 0.5)` — Tailwind's blue-300, NOT blue-500.
       *
       * Caught by the before/after bundle diff, not by reading the code: the
       * preflight block went from `--tw-ring-color: rgb(59 130 246 / 0.5)` to
       * `rgb(147 197 253 / 0.5)`. 54 sites use a bare `ring-1`/`ring-2` and would
       * have taken a paler focus ring. Wave 0 must change nothing, so the value
       * is pinned to the exact colour it resolved to before (#3b82f6 = blue-500),
       * restoring the byte-identical preflight declaration.
       *
       * Only DEFAULT is pinned. `ring-<family>-<step>` utilities still read the
       * ramps, so a later wave re-colours them with everything else.
       */
      ringColor: {
        DEFAULT: "#3b82f6",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
        
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
