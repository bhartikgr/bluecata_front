/**
 * v19 Phase C — Structured JSON logger.
 *
 * Wraps `console.*` to emit single-line JSON. Includes the active
 * correlation ID (from correlationId.ts AsyncLocalStorage) on every
 * line, so log aggregators can join lines belonging to one request.
 *
 * No new dependency. No runtime coupling to express. Safe to call
 * from any code path.
 *
 * Usage:
 *   import { log } from "./lib/logger";
 *   log.info({ route: "expert.list", chapterId, count });
 *   log.error({ route: "expert.list", errorType: "db_read", message: e.message });
 */
import { getCorrelationId } from "./correlationId";

type Level = "info" | "warn" | "error" | "debug";

interface BaseMeta extends Record<string, unknown> {
  /** Route or scope tag, e.g. "expertQA.list" or "jobs.auditChainQuarterly". */
  route?: string;
  /** Short error category tag, e.g. "db_read_failed". */
  errorType?: string;
  /** Free-text message. */
  message?: string;
}

function emit(level: Level, meta: BaseMeta): void {
  const correlationId = getCorrelationId();
  const line = {
    level,
    ts: new Date().toISOString(),
    ...(correlationId ? { correlationId } : {}),
    ...meta,
  };
  let str: string;
  try {
    str = JSON.stringify(line);
  } catch {
    // Defensive: if a value isn't serializable, fall back to a minimal line.
    str = JSON.stringify({
      level,
      ts: line.ts,
      correlationId,
      message: "log_serialize_failed",
    });
  }
  switch (level) {
    case "error":
      // eslint-disable-next-line no-console
      console.error(str);
      break;
    case "warn":
      // eslint-disable-next-line no-console
      console.warn(str);
      break;
    case "debug":
      // eslint-disable-next-line no-console
      console.debug(str);
      break;
    default:
      // eslint-disable-next-line no-console
      console.log(str);
  }
}

/**
 * Polymorphic dispatch — callers may pass either:
 *   - a structured meta object: `log.info({ route: "x", count: 5 })`
 *   - console-style varargs:     `log.info("[foo] bar", err.message)`
 *
 * The varargs form is provided for the CP Phase C console.* migration so
 * the mechanical replacement of `console.log(...args)` → `log.info(...args)`
 * preserves the original log surface without manual restructuring of every
 * call site. New code SHOULD prefer the meta-object form.
 */
function normalizeArgs(args: unknown[]): BaseMeta {
  if (args.length === 0) return { message: "" };
  // Single object that looks like a meta record → use as-is.
  if (
    args.length === 1 &&
    typeof args[0] === "object" &&
    args[0] !== null &&
    !(args[0] instanceof Error) &&
    !Array.isArray(args[0])
  ) {
    return args[0] as BaseMeta;
  }
  // Otherwise stringify each arg and join. Errors become message+stack.
  const parts: string[] = [];
  const detail: Record<string, unknown> = {};
  let errIdx = 0;
  for (const a of args) {
    if (a instanceof Error) {
      const key = errIdx === 0 ? "error" : `error${errIdx}`;
      detail[key] = a.message;
      detail[`${key}Stack`] = a.stack ?? null;
      parts.push(a.message);
      errIdx++;
    } else if (typeof a === "string") {
      parts.push(a);
    } else {
      try {
        parts.push(JSON.stringify(a));
      } catch {
        parts.push(String(a));
      }
    }
  }
  return { message: parts.join(" "), ...detail };
}

function dispatch(level: Level, args: unknown[]): void {
  emit(level, normalizeArgs(args));
}

export const log = Object.freeze({
  info: (...args: unknown[]): void => dispatch("info", args),
  warn: (...args: unknown[]): void => dispatch("warn", args),
  error: (...args: unknown[]): void => dispatch("error", args),
  debug: (...args: unknown[]): void => dispatch("debug", args),
});

/** Helper: format an error in a structured way for `log.error`. */
export function errorMeta(
  route: string,
  err: unknown,
  extra?: Record<string, unknown>,
): BaseMeta {
  const e = err as Error | undefined;
  return {
    route,
    errorType: (e && (e as Error & { code?: string }).code) || "error",
    message: e?.message ?? String(err),
    ...(extra ?? {}),
  };
}
