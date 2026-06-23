/**
 * Wave E Fix E16 — Reusable error state with retry action.
 *
 * Used by pages whose initial query failed. Renders a friendly message,
 * optional technical detail (dev-only), and a Retry button.
 *
 * Usage:
 *   if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
 *
 * The friendly title/description default to generic copy; callers can override.
 */
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ErrorStateProps = {
  /** Optional callback invoked when user clicks Retry. */
  onRetry?: () => void;
  /** Friendly title shown to the user. */
  title?: string;
  /** Friendly description shown under the title. */
  description?: string;
  /** Optional Error or message captured for debugging. Dev-only. */
  error?: Error | string | null;
  /** data-testid override. Default "error-state". */
  "data-testid"?: string;
};

export function ErrorState({
  onRetry,
  title = "Something went wrong",
  description = "We couldn't load this page. Please try again.",
  error,
  "data-testid": testId = "error-state",
}: ErrorStateProps) {
  const isDev =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV;
  const detail =
    error instanceof Error ? error.message : typeof error === "string" ? error : null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-3 p-10 text-center"
    >
      <AlertTriangle className="h-8 w-8 text-amber-600" aria-hidden="true" />
      <h2 className="text-lg font-semibold tracking-tight" data-testid="error-state-title">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground max-w-md" data-testid="error-state-description">
        {description}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-2"
          data-testid="button-error-retry"
        >
          <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden="true" />
          Retry
        </Button>
      )}
      {isDev && detail && (
        <pre
          className="mt-4 text-[10px] text-muted-foreground/70 max-w-md whitespace-pre-wrap"
          data-testid="error-state-dev-detail"
        >
          {detail}
        </pre>
      )}
    </div>
  );
}

export default ErrorState;
