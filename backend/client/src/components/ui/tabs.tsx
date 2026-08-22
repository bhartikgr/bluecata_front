import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      /* ═══════════════════════════════════════════════════════════════════════
         WAVE 82 · ITEM 4 — WHY AN EXPLICIT DISPLAY RULE, AND NOT A TAB REWRITE.
         ═══════════════════════════════════════════════════════════════════════
         THE TAB LOGIC IS CORRECT AND IS NOT TOUCHED. The 2026-08-20 pre-flight
         drove all 16 SPV detail triggers twice — at component level and through
         the real page — and every one of them switched to its own panel. The
         failure is presentational: Radix keeps ALL panels mounted and marks the
         inactive ones with the plain HTML `hidden` attribute, so the ONLY thing
         making them invisible was the shipped rule
         `[hidden]:where(:not([hidden=until-found])){display:none}`.

         That rule's `:where()` gives it specificity (0,1,0). Any single class
         that sets `display` on a panel — a utility passed in `className`, a
         stray global, a design-system reset — therefore BEATS it, and all 16
         panels render stacked. That looks exactly like "the tab never changes",
         and it explains the reported symptom of the same explanatory paragraph
         repeating on every tab: eleven of the sixteen panels open with an
         `SPV_EDU` paragraph.

         `data-[state=inactive]:hidden` compiles to a class + attribute selector,
         specificity (0,2,0). It cannot be lost to a competing display utility,
         it is local to this primitive, and it changes no tab value, no tab order,
         no `defaultValue` and no panel content. It is additive to the `hidden`
         attribute, not a replacement for it.

         Safe across the whole app, checked rather than assumed: `forceMount`
         appears NOWHERE in client/src, so there is no panel that is deliberately
         kept visible while `data-state="inactive"`.
         ═══════════════════════════════════════════════════════════════════════ */
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=inactive]:hidden",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
