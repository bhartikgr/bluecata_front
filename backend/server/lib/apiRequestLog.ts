import type { RequestHandler } from "express";

export const API_LOG_ROUTE_FALLBACK = "[api-route]";

/**
 * Operational metadata only. Business audit records are separate and unchanged.
 * Registered route patterns are safe identifiers; request parameter values and
 * mount prefixes are deliberately never inspected for output. Router-local
 * patterns may collide across mounts; correlation metadata disambiguates traces.
 * This middleware never intercepts or retains a response payload.
 */
export function apiRequestLog(emit: (message: string) => void): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    // Preserve the entrypoint's existing scope; use the path only as a boolean.
    const isApi = req.path.startsWith("/api");
    res.once("finish", () => {
      if (!isApi) return;
      const pattern: unknown = req.route?.path;
      const route = typeof pattern === "string" && pattern.length > 0 &&
        pattern !== "/" && !/[\x00-\x1f\x7f]/.test(pattern)
        ? pattern : API_LOG_ROUTE_FALLBACK;
      emit(`${req.method} ${route} ${res.statusCode} in ${Date.now() - start}ms`);
    });
    next();
  };
}
