/**
 * Capavate — static + SPA fallback
 *
 * CRITICAL fix vs previous version: /api/* paths must NEVER be served the
 * SPA index.html. Otherwise unknown API endpoints return 200 HTML, the
 * React client tries to .map() over HTML, and the SPA crashes with
 * "Cannot read properties of undefined (reading 'tone')".
 *
 * The fix below adds an explicit 404 JSON handler for /api/* BEFORE the
 * catch-all SPA fallback.
 */
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // 1. Hard 404 for any unhandled /api/* path. Stops the SPA fallback from
  //    swallowing them and returning 200 text/html for missing endpoints.
  app.use("/api/{*path}", (req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: "API_ROUTE_NOT_FOUND",
      message: `No API handler registered for ${req.method} ${req.path}`,
      path: req.path,
    });
  });

  // 2. SPA fallback ONLY for non-/api routes.
  app.use("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
