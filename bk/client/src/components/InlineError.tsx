/**
 * Sprint 14 D1 — Standardized InlineError.
 *
 * Used for in-form / in-card error messages that don't deserve a Toast.
 */
import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

export interface InlineErrorProps {
  title?: string;
  message: ReactNode;
  /** Optional retry handler for transient failures. */
  onRetry?: () => void;
  testId?: string;
}

export function InlineError({ title = "Something went wrong", message, onRetry, testId = "inline-error" }: InlineErrorProps) {
  return (
    <div role="alert" data-testid={testId} className="flex gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive-foreground">
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden />
      <div className="flex-1 min-w-0">
        <div data-testid={`${testId}-title`} className="font-medium text-destructive">{title}</div>
        <div data-testid={`${testId}-message`} className="mt-0.5 text-foreground/80">{message}</div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid={`${testId}-retry`}
            className="mt-2 inline-flex items-center text-xs font-medium underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
