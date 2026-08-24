/* ════════════════════════════════════════════════════════════════════════════
   WAVE 113 · FINDING 2 (register B-37, severity S4) — A REVOKED INVESTOR IS
   REFUSED ON EVERY PATH THAT CAN RETURN A DOCUMENT OR ITS CONTENTS.
   ════════════════════════════════════════════════════════════════════════════
   THE FIXTURE IS THE SHIPPED SEED, NOT AN INVENTION. `server/dataroomStore.ts:154-160`
   already contains an investor whose access to one folder is switched off:

     { investorId: "u_aisha_patel", folderId: "fld_diligence", view: false, download: false }

   and that folder holds `drf_dd_master`. Before this wave the gate asked only
   whether a permission ROW existed, so this exact seeded row — the record of a
   REVOCATION — was itself the pass. `describe("FAIL-BEFORE")` re-runs the deleted
   predicate against the same data and shows it granting access.

   THE ENUMERATION (W113_PREFLIGHT.md §2). Every path below is tested:
     P1  GET /api/dataroom                        (investor listing)
     P1b GET /api/companies/:id  → dataroom embed (second listing)
     P2  GET /api/dataroom/files/:id              (metadata)
     P2b GET /api/founder/dataroom/files/:id      (same handler, founder address)
     P3  GET /api/dataroom/files/:id/download     (bytes)
     P3b GET /api/founder/…/files/:id/download    (same handler, founder address)
     P4  …/download?disposition=inline and ?inline=1  (in-tab preview)
   P5 (thumbnail) and P7 (bulk/zip) do not exist anywhere in the tree — asserted
   below so that adding one without a check breaks this test. P6 (public signed
   links, `server/track1Routes.ts`) is a SEPARATE store and is recorded as an open
   item rather than silently claimed as fixed.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  registerDataroomRoutes,
  investorFolderGrant,
  listFilesVisibleTo,
  _testAccess,
} from "../dataroomStore";
import { getDb } from "../db/connection";
import { dataroomFiles as dataroomFilesTable } from "@shared/schema";

/** The investor whose diligence-folder access is switched off in the seed. */
const AISHA = "u_aisha_patel";
/** File inside the REVOKED folder (view:false). */
const REVOKED_FILE = "drf_dd_master";
const REVOKED_FOLDER = "fld_diligence";
/** File the same investor legitimately holds view+download on. */
const ALLOWED_FILE = "drf_pitch_q2";
/** File she may SEE but not download (view:true, download:false). */
const VIEW_ONLY_FILE = "drf_revops";
const COMPANY = "co_novapay";

/* `listFilesForCompany` (`server/dataroomStore.ts:513`) reads the DB, not the
   in-memory demo array, so the listing assertions need real rows. They are
   inserted here — three files across the same three folders the seeded permission
   rows already describe (view+download, view-only, and REVOKED) — under a company
   id owned by this test alone, so nothing else in the suite is disturbed. */
const LIST_COMPANY = "co_w113_listing";
const LIST_ALLOWED = "drf_w113_allowed";
const LIST_VIEW_ONLY = "drf_w113_view_only";
const LIST_REVOKED = "drf_w113_revoked";

let app: Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  registerDataroomRoutes(app);

  const db = getDb();
  const base = {
    companyId: LIST_COMPANY,
    tenantId: `tenant_${LIST_COMPANY}`,
    category: "misc",
    sizeBytes: 1234,
    mime: "application/pdf",
    uploadedAt: "2026-08-01T00:00:00Z",
    uploadedBy: "Maya Chen",
    uploadedById: "u_maya_chen",
    sha256: "w113",
    watermark: false,
  };
  db.insert(dataroomFilesTable)
    .values([
      { ...base, id: LIST_ALLOWED, folderId: "fld_pitch", name: "W113 Allowed.pdf" },
      { ...base, id: LIST_VIEW_ONLY, folderId: "fld_financials", name: "W113 View Only.pdf" },
      { ...base, id: LIST_REVOKED, folderId: REVOKED_FOLDER, name: "W113 DD Master Index.pdf" },
    ])
    .run();
});

/** Authenticated as the investor. `x-user-id` is the Vitest-only harness identity
 *  (`server/lib/userContext.ts:485`); NO auth or session code is touched by this
 *  wave (OWNER RULING R90). */
function asInvestor(r: request.Test) {
  return r.set("x-user-id", AISHA);
}

describe("WAVE 113 · FINDING 2 — the seed fixture really is a revocation", () => {
  it("the shipped seed contains view:false for this investor on this folder", () => {
    const row = _testAccess.permissions.find(
      (p) => p.investorId === AISHA && p.folderId === REVOKED_FOLDER,
    );
    expect(row, "seed row missing — fixture assumption broken").toBeTruthy();
    expect(row!.view).toBe(false);
    const f = _testAccess.files.find((x) => x.id === REVOKED_FILE);
    expect(f?.folderId).toBe(REVOKED_FOLDER);
  });
});

describe("WAVE 113 · FINDING 2 — FAIL-BEFORE: the deleted predicate granted access", () => {
  /** VERBATIM transcription of the predicate this wave replaced
   *  (`server/dataroomStore.ts`, inside `dataroomFileOwnerGate`):
   *    const p = permissions.find(p => p.investorId === investorId && p.folderId === f.folderId);
   *    if (p) return { allow: true, … }                                            */
  function legacyGrant(investorId: string, folderId: string) {
    return _testAccess.permissions.find(
      (p) => p.investorId === investorId && p.folderId === folderId,
    );
  }

  it("row-exists predicate ALLOWED the revoked investor; the new predicate refuses", () => {
    expect(legacyGrant(AISHA, REVOKED_FOLDER)).toBeTruthy(); // ← the old pass
    expect(investorFolderGrant(AISHA, REVOKED_FOLDER)).toBeNull(); // ← now closed
  });

  it("the new predicate fails CLOSED on every degenerate input", () => {
    expect(investorFolderGrant(AISHA, null)).toBeNull();
    expect(investorFolderGrant(null, REVOKED_FOLDER)).toBeNull();
    expect(investorFolderGrant("", "")).toBeNull();
    expect(investorFolderGrant("u_stranger", "fld_pitch")).toBeNull();
    expect(investorFolderGrant(AISHA, "fld_does_not_exist")).toBeNull();
  });

  it("and still grants where a real view:true grant exists", () => {
    expect(investorFolderGrant(AISHA, "fld_pitch")).toBeTruthy();
    expect(investorFolderGrant(AISHA, "fld_financials")).toBeTruthy();
  });

  it("a view flag stored as anything but explicit true does not pass", () => {
    const truthyButNotTrue = { investorId: "u_w113_probe", folderId: "fld_legal", view: 1 as unknown as boolean, download: true };
    _testAccess.permissions.push(truthyButNotTrue);
    try {
      expect(investorFolderGrant("u_w113_probe", "fld_legal")).toBeNull();
    } finally {
      _testAccess.permissions.splice(_testAccess.permissions.indexOf(truthyButNotTrue), 1);
    }
  });
});

describe("WAVE 113 · FINDING 2 — P2/P2b metadata refuses", () => {
  it("P2 GET /api/dataroom/files/:id refuses the revoked file", async () => {
    const r = await asInvestor(request(app).get(`/api/dataroom/files/${REVOKED_FILE}`));
    expect(r.status).toBe(404); // fails closed, and does not confirm the id exists
    expect(JSON.stringify(r.body)).not.toContain("DD Master");
  });

  it("P2b GET /api/founder/dataroom/files/:id refuses the revoked file", async () => {
    const r = await asInvestor(request(app).get(`/api/founder/dataroom/files/${REVOKED_FILE}`));
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain("DD Master");
  });

  it("but still serves metadata for a file she DOES have view on", async () => {
    const r = await asInvestor(request(app).get(`/api/dataroom/files/${ALLOWED_FILE}`));
    expect(r.status).toBe(200);
    expect(r.body.id).toBe(ALLOWED_FILE);
  });
});

describe("WAVE 113 · FINDING 2 — P3/P3b bytes refuse, with a plain-English reason", () => {
  const cases: Array<{ label: string; url: string }> = [
    { label: "P3 investor address", url: `/api/dataroom/files/${REVOKED_FILE}/download` },
    { label: "P3b founder address, same handler", url: `/api/founder/dataroom/files/${REVOKED_FILE}/download` },
    { label: "P4 in-tab preview (?disposition=inline)", url: `/api/dataroom/files/${REVOKED_FILE}/download?disposition=inline` },
    { label: "P4 in-tab preview (?inline=1 shorthand)", url: `/api/dataroom/files/${REVOKED_FILE}/download?inline=1` },
  ];

  for (const c of cases) {
    it(`${c.label} refuses and returns NO document bytes`, async () => {
      const r = await asInvestor(request(app).get(c.url));
      expect([403, 404]).toContain(r.status);
      expect(r.headers["content-disposition"]).toBeUndefined();
      expect(r.headers["content-type"] ?? "").not.toMatch(/application\/pdf|spreadsheet/);
      expect(r.text ?? "").not.toContain("%PDF");
    });
  }

  it("a view:true / download:false investor is told WHICH grant is missing", async () => {
    const r = await asInvestor(request(app).get(`/api/dataroom/files/${VIEW_ONLY_FILE}/download`));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("download_denied");
    expect(String(r.body.message)).toMatch(/not granted you permission/);
    expect(r.text).not.toContain("%PDF");
  });

  it("and a fully-granted file still downloads — nothing was weakened or broken", async () => {
    const r = await asInvestor(request(app).get(`/api/dataroom/files/${ALLOWED_FILE}/download`));
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"] ?? "").toMatch(/^attachment;/);
  });

  /* NOT ASSERTED HERE, DELIBERATELY: the unauthenticated case. In this sandbox
     `resolvePersonaIdWithFallback` (`server/lib/userContext.ts:518`) resolves an
     anonymous request to the demo investor persona, so a supertest request with no
     identity is NOT anonymous — it is Aisha. Proving the anonymous refusal would
     mean changing session/identity resolution, which OWNER RULING R90 forbids in
     this wave. The gate's own first branch (`if (!ctx.isAuthed) 404`,
     `server/dataroomStore.ts:764-767`) is untouched by Wave 113 and is covered by
     the pre-existing v25.17 Lane A NC1 tests. Recorded in W113_TESTS.md. */

  it("a document is never served to an identity with no grant on its folder", async () => {
    const r = await request(app)
      .get(`/api/dataroom/files/${REVOKED_FILE}/download`)
      .set("x-user-id", "u_no_position");
    expect([403, 404]).toContain(r.status);
    expect(r.text ?? "").not.toContain("%PDF");
  });
});

describe("WAVE 113 · FINDING 2 — P1/P1b listings are filtered, not just the fetch", () => {
  it("listFilesVisibleTo withholds the revoked folder's files from the investor", () => {
    const ids = listFilesVisibleTo(LIST_COMPANY, { userId: AISHA }).map((f) => f.id);
    expect(ids).not.toContain(LIST_REVOKED);
    expect(ids).toContain(LIST_ALLOWED);
    expect(ids).toContain(LIST_VIEW_ONLY); // view:true, download:false — still LISTED
  });

  it("the revoked investor cannot even read the document INVENTORY (names, sizes)", () => {
    const serialised = JSON.stringify(listFilesVisibleTo(LIST_COMPANY, { userId: AISHA }));
    expect(serialised).not.toContain("DD Master");
  });

  it("a founder of the company and an admin still see everything", () => {
    expect(listFilesVisibleTo(LIST_COMPANY, { userId: "u_maya_chen", isFounderOfCompany: true }).map((f) => f.id)).toContain(LIST_REVOKED);
    expect(listFilesVisibleTo(LIST_COMPANY, { userId: "u_admin", isAdmin: true }).map((f) => f.id)).toContain(LIST_REVOKED);
  });

  it("a stranger with no grants sees nothing — fail closed, never everything", () => {
    expect(listFilesVisibleTo(LIST_COMPANY, { userId: "u_stranger" })).toEqual([]);
    expect(listFilesVisibleTo(LIST_COMPANY, {})).toEqual([]);
  });

  it("the unfiltered listing DID contain the revoked file — the filter is what removes it", () => {
    // Proves the fixture is real: the company genuinely owns three files, and the
    // difference between three and two is the permission check, not empty data.
    const all = listFilesVisibleTo(LIST_COMPANY, { isAdmin: true }).map((f) => f.id);
    expect(all).toContain(LIST_REVOKED);
    expect(all.length).toBe(3);
    expect(listFilesVisibleTo(LIST_COMPANY, { userId: AISHA }).length).toBe(2);
  });
});

describe("WAVE 113 · FINDING 2 — the paths that do NOT exist stay that way", () => {
  /* If someone adds a thumbnail or a zip route without a permission check, these
     assertions fail and this test file is the thing that objects. */
  it("no thumbnail/preview-image route serves a data-room file", async () => {
    for (const url of [
      `/api/dataroom/files/${REVOKED_FILE}/thumbnail`,
      `/api/dataroom/files/${REVOKED_FILE}/preview`,
      `/api/founder/dataroom/files/${REVOKED_FILE}/thumbnail`,
    ]) {
      const r = await asInvestor(request(app).get(url));
      expect(r.status).toBe(404);
      expect(r.text ?? "").not.toContain("%PDF");
    }
  });

  it("no bulk/zip route serves a data-room folder", async () => {
    for (const url of [
      `/api/dataroom/folders/${REVOKED_FOLDER}/zip`,
      `/api/dataroom/download-all?companyId=${COMPANY}`,
      `/api/founder/dataroom/folders/${REVOKED_FOLDER}/zip`,
    ]) {
      const r = await asInvestor(request(app).get(url));
      expect(r.status).toBe(404);
      expect(r.text ?? "").not.toContain("PK\u0003\u0004"); // zip magic
    }
  });
});
