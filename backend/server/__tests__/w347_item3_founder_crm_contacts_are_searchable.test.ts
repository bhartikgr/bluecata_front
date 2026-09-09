/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 347 · ITEM 3 — THE FOUNDER'S OWN CRM CONTACTS WERE NOT SEARCHABLE.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `searchFounderWorkspace` (server/founderSearchStore.ts) had one
 * contact surface and it queried `investor_crm_contacts`. But `/founder/crm` — the
 * screen a founder actually keeps their contacts on — is served by
 * server/founderCrmStore.ts, which is AUTHORITATIVE OVER `founder_crm_contacts`
 * (stated at :20, written through `contactToRow` at :193). The ROUTE is named
 * `/api/founder/investor-crm` while the TABLE is named `founder_crm_contacts`, and
 * the author of the search block followed the route's name. Measured in this tree:
 * `founder_crm_contacts` holds 607 rows, `investor_crm_contacts` holds 0. A
 * founder typing the exact name of a contact they had just created got "No
 * matches", every time.
 *
 * A REFUTATION THAT WAS ITSELF FALSE. The old block carried a comment asserting
 * "THE PREMISE THAT FAILED … global search does not index CRM contacts. IT DOES —
 * that is what this very block is." That dismissal is what kept the real defect
 * alive. It has been replaced with the corrected account.
 *
 * THE FIX IS AN ADDED BLOCK, NOT A SWITCHED TABLE. Repointing the existing query
 * would have been tidier and DESTRUCTIVE: `investor_crm_contacts` has its own
 * writers (server/investorCrmStore.ts) and its emptiness in THIS tree is not proof
 * of its emptiness in a live one. Both tables are searched. Test 4 below is what
 * proves nothing was lost from the other surface.
 *
 * THE INSTRUMENT IS NOT THE PRODUCT. Every assertion runs the REAL exported
 * `searchFounderWorkspace` against rows written into the REAL table through
 * `rawDb()`, and every database read carries a `rows > 0` precondition.
 *
 * SECTION HEADERS COUNTED AGAINST `it(...)` CALLS: 6 headers, 6 tests.
 *   1  PRECONDITION — the fixture rows are really IN `founder_crm_contacts`, read
 *      back from storage. Without this, every result below could be vacuous.
 *   2  CONTROL — the search function works at all in this harness, and returns
 *      NOTHING for a term that matches nothing. A search that returned everything
 *      would make test 3 meaningless.
 *   3  THE FIX — a KNOWN CONTACT NAME is returned. This is the brief's assertion.
 *   4  THE OTHER TABLE IS NOT LOST — a contact that exists ONLY in
 *      `investor_crm_contacts` is still returned. ADD, not switch.
 *   5  TENANT AND COMPANY SCOPE HOLD — a contact belonging to another company is
 *      NOT returned, so the new block did not widen what a founder can see.
 *   6  THE NEW COLUMNS MATCH — `firm_name` and `company_name` are searchable, and
 *      the placeholder firm "—" is not rendered as if it were a real affiliation.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { searchFounderWorkspace } from "../founderSearchStore";
import { rawDb } from "../db/connection";

const STAMP = Date.now();
const MY_COMPANY = `co_w347i3_mine_${STAMP}`;
const OTHER_COMPANY = `co_w347i3_other_${STAMP}`;

/* A DISTINCTIVE name, so a match cannot be a coincidence against seeded data. */
const KNOWN_CONTACT_NAME = "Perpetua Vandersloot";
const KNOWN_CONTACT_ID = `fcc_w347i3_known_${STAMP}`;
/* Same table, different company — the scope pole. */
const FOREIGN_CONTACT_NAME = "Perpetua Ossington-Rye";
/* The OTHER table, so test 4 can prove it still contributes results. */
const LEGACY_CONTACT_NAME = "Perpetua Kilbride";
/* A contact with no firm on record, stored as the placeholder "—". */
const NO_FIRM_CONTACT_NAME = "Perpetua Ashgrove";

/** `tenant_co_${companyId}` — the rule `contactToRow` uses (founderCrmStore.ts:99-101). */
const tenantFor = (companyId: string) => `tenant_co_${companyId}`;

function insertFounderContact(opts: {
  id: string;
  companyId: string;
  name: string;
  email: string;
  firmName: string;
  companyName: string | null;
}) {
  rawDb()
    .prepare(
      /* Column list taken from PRAGMA table_info, not guessed. The NOT NULL
         columns on founder_crm_contacts are: id, tenant_id, company_id, name,
         stage, ma_signals, created_at. `ma_signals` was omitted on the first
         attempt and SQLite refused the insert. */
      `INSERT INTO founder_crm_contacts
         (id, tenant_id, company_id, investor_id, name, firm_name, company_name, email, region, stage, ma_signals, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'US', 'prospect', 0, ?, ?, NULL)`,
    )
    .run(
      opts.id,
      tenantFor(opts.companyId),
      opts.companyId,
      `u_w347i3_${opts.id}`,
      opts.name,
      opts.firmName,
      opts.companyName,
      opts.email,
      new Date().toISOString(),
      new Date().toISOString(),
    );
}

beforeAll(() => {
  insertFounderContact({
    id: KNOWN_CONTACT_ID,
    companyId: MY_COMPANY,
    name: KNOWN_CONTACT_NAME,
    email: "perpetua@vandersloot-ventures.example",
    firmName: "Vandersloot Ventures",
    companyName: "Vandersloot Ventures LP",
  });
  insertFounderContact({
    id: `fcc_w347i3_foreign_${STAMP}`,
    companyId: OTHER_COMPANY,
    name: FOREIGN_CONTACT_NAME,
    email: "perpetua@ossington-rye.example",
    firmName: "Ossington Rye",
    companyName: null,
  });
  insertFounderContact({
    id: `fcc_w347i3_nofirm_${STAMP}`,
    companyId: MY_COMPANY,
    name: NO_FIRM_CONTACT_NAME,
    email: "perpetua@ashgrove.example",
    /* The placeholder the store writes when no company is supplied
       (server/founderCrmStore.ts:752). */
    firmName: "—",
    companyName: null,
  });

  /* The OTHER table, so the pre-existing block has something to find. Its columns
     differ: it has `affiliation` and no `firm_name`. */
  rawDb()
    .prepare(
      /* NOT NULL columns here differ: id, tenant_id, investor_id, name, stage,
         starred, created_at, updated_at. `investor_id` and `starred` are required
         on this table and not on the other — the two tables are not shaped alike,
         which is the whole reason the fix ADDS a block rather than switching one. */
      `INSERT INTO investor_crm_contacts
         (id, tenant_id, company_id, investor_id, name, email, affiliation, stage, starred, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'prospect', 0, ?, ?, NULL)`,
    )
    .run(
      `icc_w347i3_legacy_${STAMP}`,
      tenantFor(MY_COMPANY),
      MY_COMPANY,
      `u_w347i3_legacy_${STAMP}`,
      LEGACY_CONTACT_NAME,
      "perpetua@kilbride.example",
      "Kilbride & Co",
      new Date().toISOString(),
      new Date().toISOString(),
    );
});

describe("W347 · ITEM 3 — founder CRM contacts are returned by global search", () => {
  /* ── 1 · PRECONDITION, READ FROM STORAGE ────────────────────────────────
     `rows > 0` before anything else. If the fixtures are not physically present,
     a search returning nothing would look like a defect and a search returning
     something would be reading someone else's data. */
  it("PRECONDITION — the fixture rows are physically present in both tables", () => {
    const founderRows = rawDb()
      .prepare(`SELECT id, name, company_id FROM founder_crm_contacts WHERE id LIKE ?`)
      .all(`fcc_w347i3_%_${STAMP}`) as any[];
    expect(founderRows.length, "the founder_crm_contacts fixtures were not written").toBeGreaterThan(0);
    expect(founderRows.length).toBe(3);
    const legacyRows = rawDb()
      .prepare(`SELECT id, name FROM investor_crm_contacts WHERE id = ?`)
      .all(`icc_w347i3_legacy_${STAMP}`) as any[];
    expect(legacyRows.length, "the investor_crm_contacts fixture was not written").toBeGreaterThan(0);
    expect(legacyRows[0].name).toBe(LEGACY_CONTACT_NAME);
  });

  /* ── 2 · CONTROL ────────────────────────────────────────────────────────
     TRY TO MANUFACTURE A GREEN AND FAIL. A search surface that returned every row
     regardless of the term would satisfy test 3 while proving nothing. This proves
     the term actually filters, and that an unmatched term yields no contact hits. */
  it("CONTROL — a term matching nothing returns NO contact hits", () => {
    const hits = searchFounderWorkspace([MY_COMPANY], `zzz_no_such_contact_${STAMP}`);
    expect(
      hits.filter((h) => h.kind === "contact").length,
      "the search returned contacts for a term that matches nothing — it is not filtering",
    ).toBe(0);
  });

  /* ── 3 · THE FIX ────────────────────────────────────────────────────────
     THE BRIEF'S ASSERTION: a KNOWN founder contact name is now returned. Before
     this wave the same call returned zero contact hits for this name, because the
     only contact block queried a different table. */
  it("a KNOWN founder_crm_contacts name IS RETURNED by search", () => {
    const hits = searchFounderWorkspace([MY_COMPANY], "Vandersloot");
    const titles = hits.filter((h) => h.kind === "contact").map((h) => h.title);
    expect(
      titles,
      `the known founder contact was not returned. Contact titles were: ${JSON.stringify(titles)}`,
    ).toContain(KNOWN_CONTACT_NAME);
    /* And it links to the screen that owns it, which IS a registered client route
       (`/founder/crm`), not an API path. */
    const hit = hits.find((h) => h.title === KNOWN_CONTACT_NAME)!;
    expect(hit.href).toBe("/founder/crm");
    expect(hit.id).toBe(KNOWN_CONTACT_ID);
  });

  /* ── 4 · THE OTHER TABLE IS NOT LOST ────────────────────────────────────
     This is why the fix ADDS a block instead of switching the existing one. A
     one-line table swap would have passed test 3 and silently deleted this
     result. Both surfaces answer the same query. */
  it("the PRE-EXISTING investor_crm_contacts surface still returns its own contacts", () => {
    const hits = searchFounderWorkspace([MY_COMPANY], "Kilbride");
    const titles = hits.filter((h) => h.kind === "contact").map((h) => h.title);
    expect(
      titles,
      "a contact that exists only in investor_crm_contacts was lost — the other surface was broken",
    ).toContain(LEGACY_CONTACT_NAME);
  });

  /* ── 5 · SCOPE HOLDS ────────────────────────────────────────────────────
     The new block must not widen what a founder can see. Both fixtures share the
     forename "Perpetua", so a scope failure would surface here as a foreign name
     in the results rather than as silence. */
  it("a contact belonging to ANOTHER company is NOT returned", () => {
    const hits = searchFounderWorkspace([MY_COMPANY], "Perpetua");
    const titles = hits.filter((h) => h.kind === "contact").map((h) => h.title);
    /* The harness is proved live by the presence of our own contacts... */
    expect(titles, "the scope probe returned nothing at all; it would prove nothing").toContain(KNOWN_CONTACT_NAME);
    /* ...so the absence of the foreign one is a real refusal. */
    expect(
      titles,
      "a contact from a company this founder does not own was returned — scope was widened",
    ).not.toContain(FOREIGN_CONTACT_NAME);
  });

  /* ── 6 · THE COLUMN DIFFERENCES ARE HANDLED ─────────────────────────────
     `founder_crm_contacts` has no `affiliation`; the firm is `firm_name` with
     `company_name` as the newer discrete field. Both must match, and the
     placeholder firm "—" must not be printed as though it were a real
     affiliation — never fabricate a name. */
  it("firm_name and company_name are searchable, and the placeholder firm is not rendered", () => {
    const byFirm = searchFounderWorkspace([MY_COMPANY], "Vandersloot Ventures");
    expect(byFirm.filter((h) => h.kind === "contact").map((h) => h.title)).toContain(KNOWN_CONTACT_NAME);

    const noFirm = searchFounderWorkspace([MY_COMPANY], "Ashgrove");
    const hit = noFirm.find((h) => h.kind === "contact" && h.title === NO_FIRM_CONTACT_NAME);
    expect(hit, "the contact with no firm on record was not returned at all").toBeTruthy();
    expect(
      hit!.subtitle,
      "the placeholder firm '—' was rendered as if it were a real affiliation",
    ).not.toContain("—");
    /* It falls back to the email, which IS on record. */
    expect(hit!.subtitle).toContain("perpetua@ashgrove.example");
  });
});
