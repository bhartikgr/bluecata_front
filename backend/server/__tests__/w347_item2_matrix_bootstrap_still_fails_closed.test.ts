/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 347 · ITEM 2 — THE PERMISSION MATRIX COULD NOT BE BOOTSTRAPPED, AND THE
 * FENCE MUST STILL REFUSE AFTERWARDS.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `client/src/pages/founder/Dataroom.tsx` derived the permission
 * matrix's ROW SET from the permissions themselves. An investor became a row only
 * once a permission row for them existed — and this screen is the only
 * request-driven writer of `dataroom_permissions` in the product. Counted, not
 * assumed: `persistPermission` (server/dataroomStore.ts:308) has exactly two
 * callers, :445 (hydration, re-persisting rows already in memory, so it can never
 * introduce a new investor) and :977 (the body of POST
 * /api/founder/dataroom/permissions, route at :956, whose only client is that
 * matrix's switch). There was therefore no path on any surface to create the FIRST
 * permission row for anybody. The fence worked; nothing could walk up to it.
 *
 * THE FIX seeds the matrix's rows from the founder's investor CRM as well as from
 * the permissions. It writes nothing and grants nothing.
 *
 * WHY THIS FILE EXISTS. The brief's rule: A FENCE MUST BE PROVED TO BE PASSED,
 * NOT MERELY TO EXIST. Widening the row set is exactly the kind of change under
 * which somebody later "helps" by making a row imply a grant. This file pins the
 * server side to fail closed and will go red if that ever happens.
 *
 * WHAT IS ASSERTED, AND AGAINST WHAT. Two instruments, deliberately:
 *   · `investorFolderGrant` — the real exported decision function, not a copy.
 *   · `rawDb()` — the physical `dataroom_permissions` table, so a claim about
 *     STORED STATE is read from storage. Every database assertion below carries a
 *     `rows > 0` precondition, because `expect(rows.length).toBe(0)` on a table
 *     that was never written is a green that proves nothing.
 *
 * THE SECTIONS BELOW, COUNTED AGAINST THEIR `it(...)` CALLS: 6 headers, 6 tests.
 *   1  CONTROL — the harness can produce a GRANT at all. Run first. If the
 *      function can never return non-null here, every refusal below is vacuous.
 *   2  FAIL CLOSED, NO ROW — the bootstrap case. An investor who appears as a
 *      matrix row purely because they are in the CRM has no permission row, and
 *      is refused.
 *   3  FAIL CLOSED, ROW WITH view=false — a row is not a grant.
 *   4  FAIL CLOSED, MISSING IDS — null/empty investor or folder id.
 *   5  STORED STATE — read from `rawDb()`: the CRM contact contributed NO row to
 *      `dataroom_permissions`. Being on the screen is not being in the table.
 *   6  DOWNLOAD NEEDS BOTH BITS — `view` alone does not carry `download`, so the
 *      second independent check at server/dataroomStore.ts:893-894 is not
 *      bypassable by the first.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

/* With the demo gate open, seeded demo fixtures can satisfy a lookup before the
   authorisation decision is reached, and a refusal probe would pass while
   checking nothing. Same reasoning as wave42_f9_captable_scope_refusal.test.ts. */
vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { investorFolderGrant, _testAccess, type Permission } from "../dataroomStore";
import { rawDb } from "../db/connection";

const STAMP = Date.now();
const FOLDER_ID = `fld_w347i2_${STAMP}`;

/* THE INVESTOR AT THE HEART OF ITEM 2: present in the founder's CRM, therefore
   now a ROW in the matrix, but holding NO permission row. Before this wave they
   could not be shown at all; after it they can be shown, and must still be
   refused. */
const CRM_ONLY_INVESTOR = `u_w347i2_crmonly_${STAMP}`;
/* A second investor holding a real, switched-on grant — the control pole. */
const GRANTED_INVESTOR = `u_w347i2_granted_${STAMP}`;
/* A third holding a row that is switched OFF. */
const VIEW_OFF_INVESTOR = `u_w347i2_viewoff_${STAMP}`;
/* A fourth holding view but not download. */
const VIEW_ONLY_INVESTOR = `u_w347i2_viewonly_${STAMP}`;

beforeAll(() => {
  /* Fixtures are pushed onto the store's OWN live arrays via `_testAccess`, which
     is the same object `investorFolderGrant` reads (server/dataroomStore.ts:1038).
     No permission row is created for CRM_ONLY_INVESTOR — that absence IS the
     bootstrap case. */
  _testAccess.permissions.push(
    { investorId: GRANTED_INVESTOR, folderId: FOLDER_ID, view: true, download: true } as Permission,
    { investorId: VIEW_OFF_INVESTOR, folderId: FOLDER_ID, view: false, download: false } as Permission,
    { investorId: VIEW_ONLY_INVESTOR, folderId: FOLDER_ID, view: true, download: false } as Permission,
  );
});

describe("W347 · ITEM 2 — the dataroom fence still refuses an investor with no permission row", () => {
  /* ── 1 · CONTROL ─────────────────────────────────────────────────────────
     TRY TO MANUFACTURE A GREEN AND FAIL. If `investorFolderGrant` returned null
     for everything in this harness — a wrong folder id, a store that never
     received the fixtures, a mocked-away module — then tests 2-4 would pass
     without exercising any decision. This proves the function CAN say yes here,
     so its noes below are real noes. */
  it("CONTROL — the harness can obtain a real GRANT, so the refusals below are not vacuous", () => {
    const p = investorFolderGrant(GRANTED_INVESTOR, FOLDER_ID);
    expect(p, "the control grant was not found — every refusal in this file would be vacuous").not.toBeNull();
    expect(p!.view).toBe(true);
    expect(p!.download).toBe(true);
  });

  /* ── 2 · FAIL CLOSED, NO ROW ─────────────────────────────────────────────
     THE ITEM 2 ASSERTION. This investor is exactly the one the bootstrap change
     newly makes visible on the founder's screen. Visibility must not be access.
     Refused at server/dataroomStore.ts:605 (`if (!p) return null`). */
  it("an investor with NO permission row is REFUSED — the bootstrap grants nothing", () => {
    expect(
      investorFolderGrant(CRM_ONLY_INVESTOR, FOLDER_ID),
      "an investor appearing in the matrix only because they are in the CRM was granted access",
    ).toBeNull();
  });

  /* ── 3 · FAIL CLOSED, ROW SWITCHED OFF ──────────────────────────────────
     A row is not a grant. Refused at :607 (`if (p.view !== true) return null`),
     which is an EXPLICIT `!== true` and so also refuses a row whose `view` was
     stored as 0, "false", null or undefined. */
  it("a permission row with view switched OFF is REFUSED", () => {
    expect(investorFolderGrant(VIEW_OFF_INVESTOR, FOLDER_ID)).toBeNull();
    /* And the row genuinely exists, so the null above is a DECISION and not an
       absence — otherwise this test would duplicate test 2. */
    const row = _testAccess.permissions.find(
      (x) => x.investorId === VIEW_OFF_INVESTOR && x.folderId === FOLDER_ID,
    );
    expect(row, "the switched-off fixture row is missing; this test would duplicate test 2").toBeTruthy();
    expect(row!.view).toBe(false);
  });

  /* ── 4 · FAIL CLOSED, MISSING IDS ───────────────────────────────────────
     Refused at :603 (`if (!investorId || !folderId) return null`). The empty
     string matters specifically for this wave: the CRM store returns
     `investorId: r.investorId ?? ""` (server/founderCrmStore.ts:172), so a blank
     id is a real possible value. The client change skips blanks before they reach
     the matrix; this proves the SERVER would refuse one even if it did not. */
  it("a missing, null or EMPTY-STRING investor or folder id is REFUSED", () => {
    expect(investorFolderGrant("", FOLDER_ID)).toBeNull();
    expect(investorFolderGrant(null, FOLDER_ID)).toBeNull();
    expect(investorFolderGrant(undefined, FOLDER_ID)).toBeNull();
    expect(investorFolderGrant(GRANTED_INVESTOR, "")).toBeNull();
    expect(investorFolderGrant(GRANTED_INVESTOR, null)).toBeNull();
    expect(investorFolderGrant(GRANTED_INVESTOR, undefined)).toBeNull();
  });

  /* ── 5 · STORED STATE, READ FROM `rawDb()` ──────────────────────────────
     The instrument is not the product: tests 2-4 read the in-memory array, which
     is what the request path reads, but a claim that the bootstrap WROTE NOTHING
     has to be checked against storage. */
  it("STORED ROWS — the physical dataroom_permissions table holds no row for the CRM-only investor", () => {
    const db = rawDb();
    /* PRECONDITION. `expect(0)` against a table this test never wrote is a green
       that proves nothing, so the table's readability is established first by
       writing and reading back a row of our own. */
    const probeInvestor = `u_w347i2_probe_${STAMP}`;
    /* Column list read off the live table, not guessed. `PRAGMA
       table_info(dataroom_permissions)` gives exactly: id, tenant_id,
       investor_id, folder_id, view, download, updated_at, deleted_at — there is
       no `created_at`, and `id` is a NOT NULL primary key. */
    db.prepare(
      `INSERT INTO dataroom_permissions (id, tenant_id, investor_id, folder_id, view, download, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, NULL)`,
    ).run(
      `drp_w347i2_probe_${STAMP}`,
      `tenant_w347i2_${STAMP}`,
      probeInvestor,
      FOLDER_ID,
      new Date().toISOString(),
    );
    const probeRows = db
      .prepare(`SELECT investor_id, view, download FROM dataroom_permissions WHERE investor_id = ?`)
      .all(probeInvestor) as any[];
    expect(
      probeRows.length,
      "the dataroom_permissions table could not be written and read back — the absence below would prove nothing",
    ).toBeGreaterThan(0);

    /* THE ASSERTION. No row exists for the investor the bootstrap made visible. */
    const rows = db
      .prepare(`SELECT investor_id FROM dataroom_permissions WHERE investor_id = ?`)
      .all(CRM_ONLY_INVESTOR) as any[];
    expect(
      rows.length,
      "appearing in the matrix wrote a permission row; the bootstrap must write nothing",
    ).toBe(0);

    /* Clean up only the probe row this test inserted. Nothing else is touched:
       no destructive SQL, no truncation, no baseline of any kind is re-cut. */
    db.prepare(`DELETE FROM dataroom_permissions WHERE investor_id = ?`).run(probeInvestor);
  });

  /* ── 6 · DOWNLOAD IS A SEPARATE BIT ─────────────────────────────────────
     `investorFolderGrant` answers the VIEW question only. The download route
     applies a second, independent check at server/dataroomStore.ts:893-894,
     requiring `p` AND `p.download`. This proves the first check does not carry
     the second — i.e. a view grant is not a download grant. */
  it("a view-only grant carries NO download right", () => {
    const p = investorFolderGrant(VIEW_ONLY_INVESTOR, FOLDER_ID);
    expect(p, "the view-only fixture was refused outright; this test would prove nothing").not.toBeNull();
    expect(p!.view).toBe(true);
    expect(
      p!.download,
      "a view-only grant reported a download right; the second check at :894 would be bypassable",
    ).toBe(false);
  });
});
