/**
 * ErrorBoundary.tsx — React error boundary (Sprint-fix May 14 2026)
 *
 * Catches the "tone" TypeError and any other unhandled render errors.
 * Renders a friendly recovery card instead of a blank/broken page.
 *
 * USAGE — wrap the entire <Switch> in App.tsx:
 *   import { ErrorBoundary } from "@/components/ErrorBoundary";
 *   <ErrorBoundary>
 *     <Switch>...</Switch>
 *   </ErrorBoundary>
 */
import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  children: ReactNode;
  /** Optional custom fallback UI. Defaults to the built-in recovery card. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });
    // Log to console so Avi can see the stack in the browser devtools
    console.error("[ErrorBoundary] Caught unhandled render error:", error, info);
  }

  handleReload = () => {
    // Clear error state first so a re-render is attempted
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Hard reload only if re-render also fails
    setTimeout(() => {
      if (this.state.hasError) {
        window.location.reload();
      }
    }, 500);
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const message = this.state.error?.message ?? "An unexpected error occurred.";
      const isMapCrash = message.includes("map") || message.includes("undefined") || message.includes("null");

      return (
        <div
          className="min-h-screen flex items-center justify-center p-6 bg-background"
          data-testid="error-boundary-fallback"
        >
          <Card className="max-w-lg w-full shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl text-destructive" data-testid="error-boundary-title">
                Something went wrong
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground" data-testid="error-boundary-message">
                {isMapCrash
                  ? "The page tried to display data that hasn't loaded yet. This is usually a temporary issue."
                  : message}
              </p>
              <p className="text-xs text-muted-foreground font-mono bg-muted rounded p-2 break-all">
                {message}
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={this.handleReload}
                  data-testid="error-boundary-reload-btn"
                >
                  Reload page
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { window.history.back(); }}
                  data-testid="error-boundary-back-btn"
                >
                  Go back
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
