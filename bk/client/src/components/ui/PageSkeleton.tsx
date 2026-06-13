/**
 * Wave E Fix E16 — Reusable page-level loading skeleton.
 * Wave G G4 — upgraded with shimmer animation + contextual variants.
 *
 * Used by pages whose initial query is loading. Renders a header strip
 * plus a vertical stack of shimmering rows so the page never flashes empty.
 *
 * Variants:
 *   - <PageSkeleton />      generic page (header + rows)
 *   - <TableSkeleton />     row × col grid (cap table, rounds list, investors)
 *   - <CardSkeleton />      header + body (dashboard widgets)
 *   - <ChartSkeleton />     axis + bars (analytics)
 *
 * The shimmer uses the `.animate-shimmer` class defined in index.css.
 * That class moves a gradient via background-position (GPU-accelerated)
 * and switches to a flat gray block under prefers-reduced-motion: reduce.
 *
 * No external dependencies beyond React.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Primitive: a single shimmer block. Replaces the bg-muted animate-pulse
// pattern from the old <Skeleton>. The class swap happens at the source —
// nothing else in the app needs to know.
// ---------------------------------------------------------------------------
export type ShimmerBlockProps = React.HTMLAttributes<HTMLDivElement>;

export function ShimmerBlock({ className, ...props }: ShimmerBlockProps) {
  return (
    <div
      data-testid="shimmer-block"
      data-cap-token="shimmer"
      className={cn("animate-shimmer rounded-md", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// PageSkeleton (Wave E E16 contract preserved — same props, same default
// data-testid). Internally it now uses ShimmerBlock instead of <Skeleton>.
// ---------------------------------------------------------------------------
export type PageSkeletonProps = {
  /** Number of skeleton rows under the header. Default 6. */
  rows?: number;
  /** Optional ARIA label for screen readers. */
  label?: string;
  /** data-testid override. Default "page-skeleton". */
  "data-testid"?: string;
};

export function PageSkeleton({
  rows = 6,
  label = "Loading page content",
  "data-testid": testId = "page-skeleton",
}: PageSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid={testId}
      className="space-y-4 p-6"
    >
      <ShimmerBlock className="h-8 w-1/3" />
      <ShimmerBlock className="h-4 w-1/2" />
      <div className="space-y-3 mt-6">
        {Array.from({ length: rows }).map((_, i) => (
          <ShimmerBlock key={i} className="h-12 w-full" />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TableSkeleton — for cap table, rounds list, investor list.
// ---------------------------------------------------------------------------
export type TableSkeletonProps = {
  rows?: number;
  cols?: number;
  label?: string;
  "data-testid"?: string;
};

export function TableSkeleton({
  rows = 8,
  cols = 5,
  label = "Loading table",
  "data-testid": testId = "table-skeleton",
}: TableSkeletonProps) {
  // Construct a grid template that distributes evenly. The first column is a
  // bit wider (name / label column) to mirror real table layouts.
  const gridCols = `1.4fr ${Array.from({ length: cols - 1 })
    .fill("1fr")
    .join(" ")}`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid={testId}
      className="space-y-3 p-4"
    >
      {/* Header row */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: gridCols }}
        data-testid="table-skeleton-header"
      >
        {Array.from({ length: cols }).map((_, i) => (
          <ShimmerBlock key={`h-${i}`} className="h-5" />
        ))}
      </div>
      {/* Body rows */}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-3"
            style={{ gridTemplateColumns: gridCols }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <ShimmerBlock key={`${r}-${c}`} className="h-9" />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardSkeleton — for dashboard widgets and metric tiles.
// ---------------------------------------------------------------------------
export type CardSkeletonProps = {
  label?: string;
  "data-testid"?: string;
  /** Optional className for the outer wrapper. */
  className?: string;
};

export function CardSkeleton({
  label = "Loading card",
  "data-testid": testId = "card-skeleton",
  className,
}: CardSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "rounded-xl border border-card-border bg-card p-5 space-y-4",
        className,
      )}
    >
      {/* Header line + sublabel */}
      <div className="space-y-2">
        <ShimmerBlock className="h-5 w-1/3" />
        <ShimmerBlock className="h-3 w-1/2" />
      </div>
      {/* Big metric */}
      <ShimmerBlock className="h-10 w-2/3" />
      {/* Footer line */}
      <div className="flex items-center gap-2 pt-1">
        <ShimmerBlock className="h-3 w-16" />
        <ShimmerBlock className="h-3 w-10" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChartSkeleton — vertical bar chart silhouette + axis.
// ---------------------------------------------------------------------------
export type ChartSkeletonProps = {
  bars?: number;
  label?: string;
  "data-testid"?: string;
  className?: string;
};

export function ChartSkeleton({
  bars = 8,
  label = "Loading chart",
  "data-testid": testId = "chart-skeleton",
  className,
}: ChartSkeletonProps) {
  // Pre-computed bar heights so SSR + CSR match. Pseudo-random but
  // deterministic from index — keeps the silhouette pleasant without RNG.
  const heightFor = (i: number) => {
    const pool = [42, 78, 60, 92, 50, 70, 84, 58, 66, 88, 46, 74];
    return pool[i % pool.length];
  };

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      data-testid={testId}
      className={cn("p-4 space-y-3", className)}
    >
      {/* Title strip */}
      <ShimmerBlock className="h-4 w-1/3" />
      {/* Chart area */}
      <div
        className="flex items-end gap-2 h-40"
        data-testid="chart-skeleton-bars"
      >
        {Array.from({ length: bars }).map((_, i) => (
          <ShimmerBlock
            key={i}
            className="flex-1 rounded-t-md"
            style={{ height: `${heightFor(i)}%` }}
          />
        ))}
      </div>
      {/* X-axis line */}
      <ShimmerBlock className="h-1 w-full" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default PageSkeleton;
