import * as React from "react"
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Whitespace-nowrap: Badges should never wrap.
  "whitespace-nowrap inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" +
  " hover-elevate " ,
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-xs",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow-xs",

        /* WAVE 99 · ITEM 2 — the RATIFIED POSITIVE chip, added because there
         * was no way to say "this state is healthy" without inventing a class
         * at each call site.  ADDITIVE ONLY: no existing variant is touched,
         * so no badge anywhere in the product moves unless a call site asks
         * for `variant="positive"`.
         *
         * `bg-emerald-700` is not "emerald" here.  Wave 1D's ramp mechanism
         * re-points Tailwind's `emerald-*` scale onto the ratified POSITIVE
         * role in all five product areas (`ledger-ramps.css`, consumed by
         * `tailwind.config.ts`), so this resolves to `--ramp-emerald-700` =
         * `44 115 70` = **#2C7346**, the positive anchor pinned at step 700 in
         * Wave 2D+3D `STATUS_COLOURS.md` §4.  White on it is **5.76:1**.
         *
         * NOT #379056, the positive FAMILY value: MEASURED, white on #379056
         * is **3.97:1**, below the 4.5:1 minimum this programme enforces, so a
         * filled chip in it would fix a semantic defect by shipping an
         * accessibility one.  The family's ratified ANCHOR STEP is used. */
        positive:
          "border-transparent bg-emerald-700 text-white shadow-xs",

        outline: " border [border-color:var(--badge-outline)] shadow-xs",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

// Sprint 11: forwardRef so Badge can be used inside Radix Slot/Tooltip triggers.
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <div
        ref={ref}
        // Wave G G1 — design token namespace marker.
        data-cap-token="badge"
        className={cn(badgeVariants({ variant }), className)}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants }
