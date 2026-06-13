/**
 * v19 Phase C — Sentry-style error monitoring helper.
 *
 * Env-gated:
 *   - SENTRY_DSN set → lazy-import @sentry/node, init once, forward
 *     `captureException` and `captureMessage` to it.
 *   - SENTRY_DSN unset → all calls are no-ops, never throw.
 *
 * We do NOT call into Sentry from this module's top level; init is
 * deferred until `initSentry()` is called by `server/index.ts`.
 *
 * NOTE: `@sentry/node` is listed as an optional dependency in
 * `package.json`. If it's not installed, all helpers degrade to no-op
 * (the import is wrapped in try/catch).
 */
import { getCorrelationId } from "./correlationId";

let sentryClient: any = null;
let initialized = false;

export function isSentryEnabled(): boolean {
  return !!process.env.SENTRY_DSN && initialized;
}

/**
 * Initialize Sentry if SENTRY_DSN is set. Idempotent. Never throws —
 * a missing `@sentry/node` package or a bad DSN downgrades silently.
 */
export async function initSentry(): Promise<void> {
  if (initialized) return;
  if (!process.env.SENTRY_DSN) return;
  try {
    // Dynamic import so the package is optional.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    // Use string-built specifier so TS doesn't statically resolve the
    // optional module (which may not be installed).
    const sentrySpec = ["@sentry", "node"].join("/");
    const mod: any = await import(/* @vite-ignore */ sentrySpec).catch(
      () => null,
    );
    if (!mod || typeof mod.init !== "function") {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          level: "warn",
          route: "sentry.init",
          message: "sentry_module_unavailable",
        }),
      );
      return;
    }
    mod.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.GIT_SHA ?? undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.0"),
    });
    sentryClient = mod;
    initialized = true;
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "info",
        route: "sentry.init",
        message: "sentry_initialized",
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: "warn",
        route: "sentry.init",
        message: "sentry_init_failed",
        errorType: "init_threw",
        detail: (err as Error).message,
      }),
    );
  }
}

/**
 * Forward an exception to Sentry. Adds correlationId tag automatically.
 * No-op if Sentry isn't initialized.
 */
export function captureException(
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!isSentryEnabled() || !sentryClient) return;
  try {
    const correlationId = getCorrelationId();
    sentryClient.withScope?.((scope: any) => {
      if (correlationId) scope.setTag("correlationId", correlationId);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          scope.setExtra(k, v);
        }
      }
      sentryClient.captureException(err);
    });
  } catch {
    // Silent — observability must never crash the caller.
  }
}

/** Forward a message. No-op if Sentry isn't initialized. */
export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
  extra?: Record<string, unknown>,
): void {
  if (!isSentryEnabled() || !sentryClient) return;
  try {
    const correlationId = getCorrelationId();
    sentryClient.withScope?.((scope: any) => {
      if (correlationId) scope.setTag("correlationId", correlationId);
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          scope.setExtra(k, v);
        }
      }
      sentryClient.captureMessage(message, level);
    });
  } catch {
    // Silent.
  }
}

/** Test-only reset (clear initialization state). */
export function _resetForTests(): void {
  sentryClient = null;
  initialized = false;
}
