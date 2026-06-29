/**
 * v25.46 Track 6 — FilterChip: canonical pill chip (active red fill / inactive
 * light). Replaces the Collective Apply Path A/B "segmented tab" gray container
 * with the canonical CRM chip pattern. Sacred Tier 9 rule 73.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface FilterChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ className, active, type, ...props }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      data-testid="filter-chip"
      aria-pressed={active}
      className={cn("cv-filter-chip", active && "cv-filter-chip--active", className)}
      {...props}
    />
  ),
);
FilterChip.displayName = "FilterChip";

export default FilterChip;
