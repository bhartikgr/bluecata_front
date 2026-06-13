import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

import { cn } from "@/lib/utils"
import { BUTTON_PRESS } from "@/lib/microInteractions"

// Sprint 16 B1 — Collective design port: primary/secondary/destructive CTAs
// adopt pill radius (rounded-full); outline/ghost keep rounded-md.
// Wave E Fix E9 — raise disabled opacity 50→60 to lift contrast above the
// borderline 2.3:1 reading flagged in the a11y audit (WCAG 1.4.3 exempts
// disabled controls, but Capavate's brand bar is higher). Also keep
// `disabled:pointer-events-none` so disabled buttons never receive clicks.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
  " hover-elevate active-elevate-2 " + BUTTON_PRESS,
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary-border rounded-full",
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border rounded-full",
        outline:
          // Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color.
          " border [border-color:var(--button-outline)]  shadow-xs active:shadow-none rounded-md",
        secondary: "border bg-secondary text-secondary-foreground border border-secondary-border rounded-full",
        // Add a transparent border so that when someone toggles a border on later, it doesn't shift layout/size.
        ghost: "border border-transparent rounded-md",
      },
      // Heights are set as "min" heights, because sometimes Ai will place large amount of content
      // inside buttons. With a min-height they will look appropriate with small amounts of content,
      // but will expand to fit large amounts of content.
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        // Wave G G1 — token namespace marker. The semantic Tailwind classes
        // (bg-primary / bg-destructive / bg-secondary) already resolve to the
        // brand vars exposed under `--cap-*` aliases. Future PRs may swap
        // these for `bg-cap-primary` etc. without a visual diff.
        data-cap-token="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
