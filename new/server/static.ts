/**
 * Capavate — static + SPA fallback
 * 
 * Fixed for Express 5 (no /api/* wildcard)
 */
import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const frontendPath = '/var/www/html/frontend';
  const indexPath = path.join(frontendPath, 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ Frontend not found at: ${frontendPath}`);
    return;
  }

  console.log(`✅ Serving static files from: ${frontendPath}`);
  app.use(express.static(frontendPath));

  // FIX: Use middleware to catch unmatched API routes (no /* wildcard)
  app.use("/api", (req: Request, res: Response, next) => {
    // If it's exactly /api, let it pass (maybe a route exists)
    if (req.path === '/' || req.path === '') {
      return next();
    }
    // Otherwise, this is an unmatched API route → 404
    res.status(404).json({
      ok: false,
      error: "API_ROUTE_NOT_FOUND",
      message: `No API handler registered for ${req.method} ${req.path}`,
      path: req.path,
    });
  });

  // SPA fallback for all non-API routes
  app.use("*", (_req: Request, res: Response) => {
    res.sendFile(indexPath);
  });
}