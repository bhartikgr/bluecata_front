/**
 * drizzle.pg.config.ts — Drizzle Kit configuration for Postgres (Wave H v23.4).
 *
 * This config targets the Postgres schema mirror (shared/schema.pg.ts) and
 * writes generated SQL into ./migrations-pg/.
 *
 * IMPORTANT: This does NOT replace drizzle.config.ts (SQLite, active dialect).
 * SQLite remains the active dialect until v23.5.
 *
 * Usage:
 *   npx drizzle-kit generate --config=drizzle.pg.config.ts
 *   npx drizzle-kit migrate --config=drizzle.pg.config.ts
 *
 * Required env var for migration execution:
 *   DATABASE_URL=postgres://user:pass@host:5432/dbname
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./shared/schema.pg.ts",
  out: "./migrations-pg",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});
