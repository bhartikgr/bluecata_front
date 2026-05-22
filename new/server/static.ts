/**
 * Capavate — static + SPA fallback
 * 
 * Fully compatible with Express 5
 * Frontend path: /var/www/html/frontend
 */
import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  // Direct path to your frontend (already built)
  const frontendPath = '/var/www/html/frontend';
  const indexPath = path.join(frontendPath, 'index.html');
  
  // Check if frontend exists
  if (!fs.existsSync(frontendPath)) {
    console.error(`❌ Frontend not found at: ${frontendPath}`);
    console.error('Please ensure frontend is at /var/www/html/frontend');
    return;
  }
  
  // Check if index.html exists
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ index.html not found at: ${indexPath}`);
    return;
  }

  // Log what's being served
  console.log(`✅ Serving static files from: ${frontendPath}`);
  console.log(`📄 Found: index.html, assets/`);
  
  // Serve static files (assets, images, etc.)
  app.use(express.static(frontendPath));

  // 1. Handle unmatched API routes (Express 5 compatible)
  app.use("/api", (req: Request, res: Response, next: any) => {
    // If it's exactly /api or /api/, let it pass (maybe a route exists)
    if (req.path === '/' || req.path === '') {
      return next();
    }
    // Otherwise, this is an unmatched API route → 404
    res.status(404).json({
      ok: false,
      error: "API_ROUTE_NOT_FOUND",
      message: `No API handler registered for ${req.method} ${req.path}`,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. SPA fallback for all non-API routes (Express 5 compatible)
  // Using "/*" instead of "*" to avoid Express 5 wildcard error
  app.use("/*", (_req: Request, res: Response) => {
    res.sendFile(indexPath);
  });
}