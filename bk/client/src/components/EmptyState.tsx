/**
 * Sprint 14 D1 — Standardized EmptyState.
 *
 * Replace ad-hoc empty rendering in every list-bearing route. Lightweight,
 * supports an optional icon, headline, body, and primary action.
 */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  primaryAction?: { label: string; onClick: () => void; testId?: string };
  secondaryAction?: { label: string; onClick: () => void; testId?: string };
  /** Used to vary the muted-tone surface (e.g. inside a card vs page-level). */
  density?: "comfortable" | "compact";
}

export function EmptyState({ icon, title, description, primaryAction, secondaryAction, density = "comfortable" }: EmptyStateProps) {
  const py = density === "compact" ? "py-8" : "py-14";
  return (
    <div data-testid="empty-state" className={`flex flex-col items-center justify-center text-center ${py} px-6 rounded-md border border-border bg-muted/30`}>
      {icon && <div data-testid="empty-state-icon" className="text-muted-foreground mb-3">{icon}</div>}
      <h3 data-testid="empty-state-title" className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p data-testid="empty-state-description" className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex gap-2">
          {secondaryAction && (
            <Button variant="outline" size="sm" onClick={secondaryAction.onClick} data-testid={secondaryAction.testId ?? "button-empty-secondary"}>
              {secondaryAction.label}
            </Button>
          )}
          {primaryAction && (
            <Button size="sm" onClick={primaryAction.onClick} data-testid={primaryAction.testId ?? "button-empty-primary"}>
              {primaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
