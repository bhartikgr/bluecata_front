/**
 * Opus audit — cross-tenant partner visibility probe.
 * Seeds partner_organizations rows in 3 chapters, then asserts the
 * /api/collective/partners/public chapter-scoping logic (mirrored here at the
 * SQL layer the route uses) returns only the caller's chapter (+ null-chapter)
 * partners for a member, and ALL for admin.
 */
import { rawDb } from "../server/db/connection";

const db: any = rawDb();

function ins(id: string, name: string, chapterId: string | null) {
  db.prepare(
    `INSERT OR REPLACE INTO partner_organizations
      (id, tenant_id, name, jurisdiction, partner_type, aum_range, primary_chapter_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'US', 'vc', '50m-250m', ?, 'active', datetime('now'), datetime('now'))`,
  ).run(id, "tnt_x", name, chapterId);
}

ins("po_chA", "Alpha Capital (Chapter A)", "chap_A");
ins("po_chB", "Bravo Partners (Chapter B)", "chap_B");
ins("po_chC", "Charlie Ventures (Chapter C)", "chap_C");
ins("po_null", "Global Agnostic Fund (null chapter)", null);

function memberView(chapterIds: string[]) {
  const ph = chapterIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT name FROM partner_organizations
        WHERE status='active' AND (primary_chapter_id IS NULL OR primary_chapter_id IN (${ph}))
        ORDER BY name ASC`,
    )
    .all(...chapterIds)
    .map((r: any) => r.name);
}

function adminView() {
  return db
    .prepare(`SELECT name FROM partner_organizations WHERE status='active' ORDER BY name ASC`)
    .all()
    .map((r: any) => r.name);
}

const memberA = memberView(["chap_A"]);
const memberB = memberView(["chap_B"]);
const admin = adminView();

console.log("MEMBER_A_SEES:", JSON.stringify(memberA));
console.log("MEMBER_B_SEES:", JSON.stringify(memberB));
console.log("ADMIN_SEES:", JSON.stringify(admin));

const pass =
  memberA.includes("Alpha Capital (Chapter A)") &&
  memberA.includes("Global Agnostic Fund (null chapter)") &&
  !memberA.includes("Bravo Partners (Chapter B)") &&
  !memberA.includes("Charlie Ventures (Chapter C)") &&
  memberB.includes("Bravo Partners (Chapter B)") &&
  !memberB.includes("Alpha Capital (Chapter A)") &&
  admin.length === 4;

console.log(pass ? "XTENANT_PROBE: PASS" : "XTENANT_PROBE: FAIL");
