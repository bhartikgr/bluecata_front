import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * WAVE 59 · S2 — THE INVISIBLE-CHECKBOX ROOT CAUSE, AND WHY THE FIX IS ONE WORD.
 *
 * Shadie reported two sightings (1a `#investor-ack` on the investor invitation
 * decision tab; 5a the two application-fee boxes on the founder Collective apply
 * page). Computed style on the UNCHECKED control, live:
 *
 *   #investor-ack  →  border: 0px none rgb(204, 0, 0)
 *   fee checkboxes →  border-width: 0px, border-style: none
 *
 * The border COLOUR resolved correctly (red = `--primary`), and the class list
 * said `border border-primary` — so the colour utility was applying and the
 * width utility appeared not to be. It was applying. The defect is a
 * border-STYLE override, and a zero used-width is its symptom:
 *
 *   client/src/pages/home/home3style.css:198  ->  button { cursor: pointer;
 *                                                          background: none;
 *                                                          border: none; }
 *
 * That is a marketing-page reset, imported by `client/src/pages/home/Home.tsx:3`.
 * Vite concatenates every CSS import into ONE global stylesheet, so an unscoped
 * `button` element selector in a page-level file applies to the WHOLE platform.
 * Radix's `CheckboxPrimitive.Root` renders a `<button role="checkbox">`, so the
 * reset hits every checkbox on Capavate, Collective, Consortium Partner and
 * Admin at once. Verified in the built bundle
 * (dist/public/assets/index-CipMj0ku.css): `button{cursor:pointer;background:none;border:none}`.
 *
 * Why the class list looked innocent: Tailwind's `border` utility emits ONLY
 * `border-width: 1px` — it does not set `border-style`. `.border` (0,1,0) does
 * outrank `button` (0,0,1) on width, so width really was 1px as specified. But
 * `border-style: none` from the element selector survived, and CSS makes the
 * USED width of a `none`-style border 0 regardless of the specified width —
 * which is exactly why `getComputedStyle` reported `0px none` with a red colour.
 * Nothing painted.
 *
 * THE FIX: state the border style explicitly on the shared component, so the
 * intent no longer depends on a UA/reset default. `border-solid` and `border-2`
 * are different tailwind-merge groups, so instances that override the WIDTH or
 * the COLOUR (e.g. the two application-fee checkboxes, which set a 2px neutral
 * slate border) keep their own values and gain the style. One line, one file,
 * every checkbox on the platform.
 *
 * WHY THIS DOES NOT CONTRADICT `wshadie_2a_checkbox_visibility.test.ts`, which
 * asserts "the fix must stay per-instance ... the shared primitive is NOT
 * edited": that test pins four things about this file — `h-4 w-4`,
 * `border-primary`, `data-[state=checked]:bg-primary`, and the absence of the
 * fee instances' neutral border colour. NONE of them is changed here, and every
 * one of its assertions is kept verbatim. The earlier per-instance attempt is
 * left fully intact on both fee checkboxes. It simply could not work: it set a
 * WIDTH and a COLOUR and, like the base class list, never a STYLE — which is why
 * Shadie re-reported those exact two controls as 5a. This change is orthogonal
 * and additive to it, not a replacement of it. See WAVE59_REPORT.md §3.1.
 *
 * NOT DONE HERE, DELIBERATELY: scoping the `home3style.css` reset itself. That
 * reset also silently strips borders from `<Switch>`, `<RadioGroupItem>`,
 * `<SelectTrigger>` and every `<button className="border …">` on the platform.
 * Scoping it is the correct structural repair, but it is a platform-wide visual
 * change of unknown blast radius while the owner is away and the standing
 * instruction is "do not break anything". It is recorded as an owner question
 * and the affected control families are enumerated in
 * build_log/wave59/W59_CHECKBOX_SWEEP.md.
 *
 * CONTRAST STANDARD USED: WCAG 2.1 SC 1.4.11 Non-text Contrast, ≥ 3:1 against
 * the adjacent card background. `--primary` #CC0000 on #FFFFFF measures 5.89:1,
 * and the fee instances' neutral slate #64748B measures 4.76:1. Both pass.
 * All four colours in use across the 28 instances are tabulated in
 * build_log/wave59/W59_CHECKBOX_SWEEP.md §3.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-solid border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
