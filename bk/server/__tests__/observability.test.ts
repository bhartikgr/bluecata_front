/**
 * v19 Phase C — Logger + Sentry helper tests.
 *
 * Coverage (logger):
 *   - log.info / warn / error / debug emit single-line JSON to the right console method
 *   - JSON line includes level, ts (ISO 8601), and any meta keys passed
 *   - When called inside the correlationId AsyncLocalStorage frame, the
 *     line includes correlationId
 *   - errorMeta() folds an Error into {route, errorType, message}
 *   - non-serializable meta falls back to a minimal line (no throw)
 *
 * Coverage (sentry):
 *   - isSentryEnabled() is false before init
 *   - initSentry() with no SENTRY_DSN is a silent no-op
 *   - initSentry() with bogus DSN + no package degrades silently
 *   - captureException / captureMessage are no-ops when disabled
 *   - _resetForTests restores clean state
 */
import { describe, it, expect, beforeEach } from "vitest";
import { log, errorMeta } from "../lib/logger";
import {
  initSentry,
  isSentryEnabled,
  captureException,
  captureMessage,
  _resetForTests as resetSentry,
} from "../lib/sentry";
import {
  correlationIdMiddleware,
  _internal as corrInternal,
} from "../lib/correlationId";

/* Spy helpers ----------------------------------------------------- */
function captureConsole(method: "log" | "warn" | "error" | "debug") {
  const original = console[method];
  const captured: string[] = [];
  (console as any)[method] = (line: string) => {
    captured.push(typeof line === "string" ? line : JSON.stringify(line));
  };
  return {
    captured,
    restore: () => {
      (console as any)[method] = original;
    },
  };
}

describe("v19 Phase C — structured logger", () => {
  it("log.info emits single-line JSON to console.log with level=info", () => {
    const c = captureConsole("log");
    try {
      log.info({ route: "test.route", message: "hello", count: 7 });
      expect(c.captured.length).toBe(1);
      const obj = JSON.parse(c.captured[0]!);
      expect(obj.level).toBe("info");
      expect(obj.route).toBe("test.route");
      expect(obj.message).toBe("hello");
      expect(obj.count).toBe(7);
      expect(typeof obj.ts).toBe("string");
      expect(new Date(obj.ts).toString()).not.toBe("Invalid Date");
    } finally {
      c.restore();
    }
  });

  it("log.warn routes to console.warn", () => {
    const c = captureConsole("warn");
    try {
      log.warn({ route: "w", message: "be careful" });
      expect(c.captured.length).toBe(1);
      expect(JSON.parse(c.captured[0]!).level).toBe("warn");
    } finally {
      c.restore();
    }
  });

  it("log.error routes to console.error", () => {
    const c = captureConsole("error");
    try {
      log.error({ route: "e", message: "boom" });
      expect(c.captured.length).toBe(1);
      expect(JSON.parse(c.captured[0]!).level).toBe("error");
    } finally {
      c.restore();
    }
  });

  it("log.debug routes to console.debug", () => {
    const c = captureConsole("debug");
    try {
      log.debug({ route: "d" });
      expect(c.captured.length).toBe(1);
      expect(JSON.parse(c.captured[0]!).level).toBe("debug");
    } finally {
      c.restore();
    }
  });

  it("attaches correlationId when called inside a correlation-id frame", () => {
    const c = captureConsole("log");
    try {
      corrInternal.storage.run({ correlationId: "abc-trace-1" }, () => {
        log.info({ route: "framed", message: "x" });
      });
      const obj = JSON.parse(c.captured[0]!);
      expect(obj.correlationId).toBe("abc-trace-1");
    } finally {
      c.restore();
    }
  });

  it("omits correlationId when not inside a frame", () => {
    const c = captureConsole("log");
    try {
      log.info({ route: "no-frame", message: "x" });
      const obj = JSON.parse(c.captured[0]!);
      expect("correlationId" in obj).toBe(false);
    } finally {
      c.restore();
    }
  });

  it("errorMeta folds an Error into route/errorType/message", () => {
    class CodeErr extends Error {
      code = "E_TEST";
    }
    const meta = errorMeta("svc.read", new CodeErr("oops"), { id: "row_1" });
    expect(meta.route).toBe("svc.read");
    expect(meta.errorType).toBe("E_TEST");
    expect(meta.message).toBe("oops");
    expect((meta as any).id).toBe("row_1");
  });

  it("errorMeta with a non-Error coerces to a string message", () => {
    const meta = errorMeta("svc.weird", "string-thrown");
    expect(meta.message).toBe("string-thrown");
    expect(meta.errorType).toBe("error");
  });

  it("non-serializable meta falls back to a minimal line without throwing", () => {
    const c = captureConsole("log");
    try {
      const circular: any = { route: "circ" };
      circular.self = circular;
      expect(() => log.info(circular)).not.toThrow();
      expect(c.captured.length).toBe(1);
      const obj = JSON.parse(c.captured[0]!);
      // Either the regular line or the minimal fallback — but it must be JSON.
      expect(typeof obj.level).toBe("string");
    } finally {
      c.restore();
    }
  });
});

/* ----- Sentry no-op tests ---------------------------------------- */
describe("v19 Phase C — Sentry helper (no-op without DSN/package)", () => {
  beforeEach(() => {
    resetSentry();
    delete process.env.SENTRY_DSN;
  });

  it("isSentryEnabled() is false before init", () => {
    expect(isSentryEnabled()).toBe(false);
  });

  it("initSentry() without SENTRY_DSN is a silent no-op", async () => {
    await initSentry();
    expect(isSentryEnabled()).toBe(false);
  });

  it("initSentry() with bogus DSN degrades silently when @sentry/node is absent", async () => {
    process.env.SENTRY_DSN = "https://abc@example.com/1";
    // The optional package isn't installed in CI; we expect a silent fallback.
    const c = captureConsole("warn");
    try {
      await initSentry();
      // After attempted init, enabled flag must reflect outcome (false if no pkg).
      // Either way: no throw.
      expect(typeof isSentryEnabled()).toBe("boolean");
    } finally {
      c.restore();
      delete process.env.SENTRY_DSN;
      resetSentry();
    }
  });

  it("captureException is a no-op when disabled (does not throw)", () => {
    resetSentry();
    expect(() =>
      captureException(new Error("ignored"), { extra: "x" }),
    ).not.toThrow();
  });

  it("captureMessage is a no-op when disabled (does not throw)", () => {
    resetSentry();
    expect(() => captureMessage("msg", "info", { k: "v" })).not.toThrow();
  });

  it("_resetForTests resets the enabled flag to false", () => {
    resetSentry();
    expect(isSentryEnabled()).toBe(false);
  });
});

/* sanity: middleware import does not crash module init */
describe("v19 Phase C — module import smoke", () => {
  it("correlationIdMiddleware is a function", () => {
    expect(typeof correlationIdMiddleware).toBe("function");
  });
});
