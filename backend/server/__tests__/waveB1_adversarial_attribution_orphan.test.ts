/**
 * Wave B1 (3a) adversarial — REQUIRED-step failure must NOT leave an orphan.
 *
 * Forces the attribution durable write to fail (by making consortium_links
 * un-writable) and asserts the route returns 500 AND rolls the company back:
 * the companies row is soft-deleted (deleted_at set) and the membership is
 * inactive/soft-deleted, so the member-keyed hydrate excludes it. No orphan,
 * no false success.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";

describe("Wave B1 (3a) adversarial — attribution failure rolls back the company", () => {
  let app: express.Express;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerPartnerRoutes(app);
    registerPartnerPortfolioCompanyRoutes(app);
    seedTestPartnerSandbox({ force: true });
  });

  afterAll(() => {
    // Remove the failure trigger so other suites are unaffected.
    const db: any = rawDb();
    try { db.exec("DROP TRIGGER IF EXISTS b1_block_consortium_links_insert"); } catch { /* noop */ }
  });

  it("returns 500 and leaves NO active/undeleted orphan company", async () => {
    const db: any = rawDb();
    // Ensure the table exists (linkConsortiumPartner would recreate it), then
    // install a trigger that hard-fails every insert — a durable-write failure
    // linkConsortiumPartner cannot swallow.
    db.exec(`CREATE TABLE IF NOT EXISTS consortium_links (
      company_id TEXT PRIMARY KEY NOT NULL, partner_id TEXT NOT NULL,
      linked_at TEXT NOT NULL, unlinked_at TEXT
    );`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS b1_block_consortium_links_insert
      BEFORE INSERT ON consortium_links
      BEGIN SELECT RAISE(ABORT, 'b1-forced-attribution-failure'); END;`);

    const companyName = `Orphan Probe ${Date.now()}`;
    const res = await request(app)
      .post("/api/partner/me/portfolio-companies")
      .set("x-user-id", MANAGING)
      .send({ companyName, founderEmail: `probe_${Date.now()}@example.com` });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("ATTRIBUTION_LINK_FAILED");

    // The company must not survive as an active/undeleted row.
    const co = db
      .prepare("SELECT id, deleted_at FROM companies WHERE name = ?")
      .get(companyName) as { id: string; deleted_at: string | null } | undefined;
    if (co) {
      expect(co.deleted_at).not.toBeNull(); // soft-deleted by rollback
      const activeMember = db
        .prepare(
          "SELECT user_id FROM company_members WHERE company_id = ? AND deleted_at IS NULL AND is_active = 1",
        )
        .get(co.id) as { user_id: string } | undefined;
      expect(activeMember).toBeUndefined(); // no live membership => not hydrated
    }
  });
});
