/**
 * v25.46 Track 6 — AppCard: the canonical Capavate surface primitive.
 *
 * White (or warm) surface, #ddd9d3 border, 12px radius, soft shadow, 24px
 * padding — consumed by the Collective + Consortium refactor so those modules
 * stop using ad-hoc card styling. Backed by the additive `--cv-*` token layer
 * (see client/src/styles/capavate-tokens.css). Sacred Tier 9 rule 73.
 *
 * Wrapper pattern: AppCard composes existing chrome; it does not replace the
 * shadcn `Card` primitive (kept intact for surfaces already using it).
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface AppCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Use the warm pink surface variant (founder-workspace hero card language). */
  warm?: boolean;
}

export const AppCard = React.forwardRef<HTMLDivElement, AppCardProps>(
  ({ className, warm, ...props }, ref) => (
    <div
      ref={ref}
      data-testid="app-card"
      className={cn("cv-app-card", warm && "cv-app-card--warm", className)}
      {...props}
    />
  ),
);
AppCard.displayName = "AppCard";

export default AppCard;
