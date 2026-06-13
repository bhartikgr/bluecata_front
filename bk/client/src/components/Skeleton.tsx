/**
 * Sprint 14 D1 — Standardized Skeleton wrapper.
 *
 * Wraps shadcn's ui/skeleton with sensible Capavate-brand defaults so usage
 * across all 42 routes stays consistent.
 */
import { Skeleton as BaseSkeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface SkeletonProps {
  className?: string;
  /** Convenience: render N rows of stacked skeletons. */
  rows?: number;
  /** Variant adjusts default sizing. */
  variant?: "line" | "title" | "card" | "circle" | "row";
  testId?: string;
}

export function Skeleton({ className, rows, variant = "line", testId = "skeleton" }: SkeletonProps) {
  const sizing: Record<NonNullable<SkeletonProps["variant"]>, string> = {
    line:  "h-3 w-full",
    title: "h-5 w-3/5",
    card:  "h-32 w-full rounded-md",
    circle:"h-9 w-9 rounded-full",
    row:   "h-4 w-full",
  };
  if (rows && rows > 1) {
    return (
      <div data-testid={`${testId}-stack`} className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <BaseSkeleton key={i} data-testid={`${testId}-${i}`} className={cn(sizing[variant], className)} />
        ))}
      </div>
    );
  }
  return <BaseSkeleton data-testid={testId} className={cn(sizing[variant], className)} />;
}
