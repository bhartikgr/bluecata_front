/**
 * server/db/__tests__/pglite-harness.ts — Wave H in-memory Postgres harness.
 *
 * Provides an in-process PGlite (Postgres in Wasm) instance pre-loaded with
 * the Postgres schema from migrations-pg/*.sql.  Returns a Drizzle ORM handle
 * typed against shared/schema.pg.ts so tests can use normal Drizzle queries.
 *
 * DESIGN PRINCIPLES
 * -----------------
 * - Each call to createPgliteHarness() returns a FRESH in-memory database
 *   (dataDir: "memory://").  Tests are fully isolated — no shared state.
 * - Migrations are applied in filename order (numeric prefix sort).
 * - The returned handle exposes:
 *     db      — drizzle(pglite) typed against pg schema
 *     pg      — raw PGlite instance (for raw SQL if needed)
 *     close() — tears down the PGlite instance
 *
 * USAGE IN TESTS
 * --------------
 *   import { createPgliteHarness } from "./pglite-harness";
 *
 *   let harness: Awaited<ReturnType<typeof createPgliteHarness>>;
 *   beforeAll(async () => { harness = await createPgliteHarness(); });
 *   afterAll(async ()  => { await harness.close(); });
 *
 *   it("inserts a tenant", async () => {
 *     await harness.db.insert(tenants).values({ id: "t1", ... });
 *   });
 *
 * NOT PART OF npm test
 * --------------------
 * This file is intentionally excluded from the default vitest run via the
 * `test:pglite` script (see package.json). It runs separately:
 *   npm run test:pglite
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as schema from "../../../shared/schema.pg";

// ── Path to the migrations-pg directory ──────────────────────────────────────

/**
 * Resolve migrations-pg relative to the workspace root.
 * Works whether this file is run via tsx (ESM) or compiled CJS.
 */
function getMigrationDir(): string {
  // Prefer import.meta.url when available (tsx / ESM).
  try {
    const metaUrl = (import.meta as { url?: string }).url;
    if (metaUrl) {
      const here = path.dirname(new URL(metaUrl).pathname);
      // __tests__/ → server/db/ → server/ → project root → migrations-pg/
      return path.resolve(here, "../../..", "migrations-pg");
    }
  } catch { /* fall through */ }
  // Fallback: anchor from cwd (works in ts-node / vitest with root cwd).
  return path.resolve(process.cwd(), "migrations-pg");
}

// ── Migration SQL loader ──────────────────────────────────────────────────────

/**
 * Load all *.sql files from migrations-pg/ sorted by filename (numeric
 * prefix order guarantees correct application sequence).
 */
function loadMigrationSql(migDir: string): string[] {
  if (!fs.existsSync(migDir)) {
    throw new Error(
      `migrations-pg/ not found at ${migDir}. ` +
      "Run `npx drizzle-kit generate --config=drizzle.pg.config.ts` first."
    );
  }
  return fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("."))
    .sort()
    .map((f) => fs.readFileSync(path.join(migDir, f), "utf-8"));
}

// ── Harness public interface ──────────────────────────────────────────────────

export interface PgliteHarness {
  /** Drizzle ORM handle typed against shared/schema.pg.ts. */
  db: ReturnType<typeof drizzle<typeof schema>>;
  /** Raw PGlite instance — for raw SQL queries in edge-case tests. */
  pg: PGlite;
  /** Tear down the PGlite instance. Call in afterAll(). */
  close(): Promise<void>;
}

/**
 * Create a fresh in-memory PGlite instance, apply all migrations from
 * migrations-pg/*.sql, and return a Drizzle handle + raw pg handle.
 *
 * Each call creates a NEW isolated database.
 */
export async function createPgliteHarness(): Promise<PgliteHarness> {
  const pg = new PGlite("memory://");

  // Apply migrations in order. PGlite supports multi-statement SQL but
  // drizzle-kit emits `-->statement-breakpoint` comments as delimiters.
  // We split on those to ensure each statement executes cleanly.
  const migDir = getMigrationDir();
  const sqlFiles = loadMigrationSql(migDir);

  for (const sql of sqlFiles) {
    // Split on the drizzle-kit statement-breakpoint sentinel.
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await pg.exec(stmt);
    }
  }

  const db = drizzle(pg, { schema });

  return {
    db,
    pg,
    async close() {
      await pg.close();
    },
  };
}

/**
 * Convenience helper: detect driver from a drizzle-pglite handle.
 * Returns "postgres" because PGlite IS a Postgres wire-compatible engine.
 */
export function getPgliteDriver(_db: PgliteHarness["db"]): "postgres" {
  return "postgres";
}
