/**
 * Capavate — static + SPA fallback
 *
 * Fixed for Node ESM: __dirname replaced with import.meta.url
 */
import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function serveStatic(app: Express) {
  // ESM-compatible __dirname
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // 1. Hard 404 for any unhandled /api/* path
  app.use("/api/*", (req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: "API_ROUTE_NOT_FOUND",
      message: `No API handler registered for ${req.method} ${req.path}`,
      path: req.path,
    });
  });

  // 2. SPA fallback ONLY for non-/api routes.
  app.use("*", (_req: Request, res: Response) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}