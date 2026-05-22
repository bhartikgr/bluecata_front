/**
 * Capavate — static + SPA fallback
 * 
 * Fixed for production with frontend at: /var/www/html/frontend/
 */
import express from 'express';
import type { Express, Request, Response } from 'express';
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function serveStatic(app: Express) {
  // Direct path to your frontend (already built)
  const frontendPath = '/var/www/html/frontend';
  
  // Check if frontend exists
  if (!fs.existsSync(frontendPath)) {
    console.error(`❌ Frontend not found at: ${frontendPath}`);
    console.error('Please ensure frontend is at /var/www/html/frontend');
    return;
  }
  
  // Check if index.html exists
  const indexPath = path.join(frontendPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ index.html not found at: ${indexPath}`);
    return;
  }

  // Log what's being served
  console.log(`✅ Serving static files from: ${frontendPath}`);
  console.log(`📄 Found files: ${fs.readdirSync(frontendPath).filter(f => !f.startsWith('.')).join(', ')}`);
  
  // Serve static files (assets, images, etc.)
  app.use(express.static(frontendPath));

  // 1. Hard 404 for any unhandled /api/* path
  app.use("/api/*", (req: Request, res: Response) => {
    res.status(404).json({
      ok: false,
      error: "API_ROUTE_NOT_FOUND",
      message: `No API handler registered for ${req.method} ${req.path}`,
      path: req.path,
      timestamp: new Date().toISOString(),
    });
  });

  // 2. SPA fallback for all non-API routes (send index.html)
  app.use("*", (_req: Request, res: Response) => {
    res.sendFile(indexPath);
  });
}