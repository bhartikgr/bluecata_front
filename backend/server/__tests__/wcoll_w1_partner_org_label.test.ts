/**
 * server/__tests__/wcoll_w1_partner_org_label.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.3 as corrected by v5 §D.
 *
 * CONTEXT. The Collective member directory renders every contact through the
 * privacy resolver in the `collectiveDirectory` context, whose default is
 * `visibleInCollectiveDirectory:false`. Correct for a natural person; wrong for a
 * `consortium_partner`, which is an ORGANISATION with no natural-person privacy
 * interest. So every partner rendered as "Private Investor".
 *
 * The rejected fixes matter as much as the accepted one:
 *   • v2/v3 proposed `getConsortiumPartnerDisplayName()`, which reads
 *     `display_name` / `legal_name` off the same **contacts** row — i.e.
 *     potentially a natural person's name. That would have re-shipped the leak
 *     W3 #9 removed.
 *   • v4 proposed a `partner_team_members` hop, which is tautological (one id is
 *     minted for both rows) and adds a false negative.
 *
 * The suite below pins the accepted DIRECT resolution and, critically, pins that
 * the module NEVER falls back to the contacts row.
 *
 * ANTI-VACUITY. On the PRISTINE tree `server/lib/partnerOrgLabel.ts` does not
 * exist and the whole file fails at collection with
 * "Failed to load url ../lib/partnerOrgLabel".
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getDb, rawDb } from "../db/connection";
import { resolvePartnerOrgLabel, partnerOrgLabel, PRIVATE_LABEL } from "../lib/partnerOrgLabel";

/** A name that must NEVER reach the directory through this module. */
const PERSON_NAME = "Amelia Thorne-Whitfield";
const ORG_NAME = "Northbridge Consortium Partners LLP";

const ID_ACTIVE = "ac_wcoll_partner_active";
const ID_INACTIVE = "ac_wcoll_partner_inactive";
const ID_BLANK = "ac_wcoll_partner_blank";
const ID_ORPHAN = "ac_wcoll_partner_orphan";

function insertOrg(id: string, name: string, status: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO partner_organizations
         (id, tenant_id, name, jurisdiction, partner_type, aum_range, status,
          onboarding_state, created_at, updated_at)
       VALUES (?, 'tenant_platform', ?, '', 'other', 'undisclosed', ?, '{}', ?, ?)`,
    )
    .run(id, name, status, now, now);
}

/**
 * A contacts row carrying a NATURAL PERSON's name under the very id the label
 * resolver is handed. If the module ever consulted this table — as v2/v3
 * proposed — these tests would surface the person's name.
 */
function insertPersonContact(id: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO contacts
         (id, kind, legal_name, display_name, email, status, verification,
          created_at, updated_at, created_by, updated_by, version,
          prev_revision_hash, revision_hash, tenant_id)
       VALUES (?, 'consortium_partner', ?, ?, ?, 'active', 'unverified',
               ?, ?, 'test', 'test', 1, '', '', 'tenant_platform')`,
    )
    .run(id, PERSON_NAME, PERSON_NAME, "amelia@example.com", now, now);
}

beforeAll(() => {
  getDb();
});

beforeEach(() => {
  for (const id of [ID_ACTIVE, ID_INACTIVE, ID_BLANK, ID_ORPHAN]) {
    rawDb().prepare("DELETE FROM partner_organizations WHERE id = ?").run(id);
    rawDb().prepare("DELETE FROM contacts WHERE id = ?").run(id);
  }
});

describe("v5 §D — labels ONLY when an active partner organization resolves", () => {
  it("an active org resolves to its trading name", () => {
    insertOrg(ID_ACTIVE, ORG_NAME, "active");
    expect(resolvePartnerOrgLabel(ID_ACTIVE, "consortium_partner")).toEqual({
      label: ORG_NAME,
      resolved: true,
    });
  });

  it("resolution is DIRECT on contact.id — no partner_team_members row needed", () => {
    // v4's hop would have produced "Private Investor" here: an organisation with
    // no team rows yet is still an organisation.
    insertOrg(ID_ACTIVE, ORG_NAME, "active");
    const teamRows = (() => {
      try {
        return rawDb()
          .prepare("SELECT COUNT(*) AS n FROM partner_team_members WHERE partner_id = ?")
          .get(ID_ACTIVE) as { n?: number } | undefined;
      } catch {
        return undefined; // runtime DDL; absence is itself the point
      }
    })();
    expect(teamRows?.n ?? 0).toBe(0);
    expect(partnerOrgLabel(ID_ACTIVE, "consortium_partner")).toBe(ORG_NAME);
  });

  it("a non-active org falls back to the directory's fail-closed label", () => {
    insertOrg(ID_INACTIVE, ORG_NAME, "suspended");
    expect(resolvePartnerOrgLabel(ID_INACTIVE, "consortium_partner")).toEqual({
      label: PRIVATE_LABEL,
      resolved: false,
      reason: "no_active_org",
    });
  });

  it("no org row at all falls back", () => {
    expect(resolvePartnerOrgLabel(ID_ORPHAN, "consortium_partner")).toEqual({
      label: PRIVATE_LABEL,
      resolved: false,
      reason: "no_active_org",
    });
  });

  it("a whitespace-only name is unresolved, never rendered blank", () => {
    insertOrg(ID_BLANK, "   ", "active");
    expect(resolvePartnerOrgLabel(ID_BLANK, "consortium_partner")).toEqual({
      label: PRIVATE_LABEL,
      resolved: false,
      reason: "no_name",
    });
  });

  it("a missing/blank id is refused without a query", () => {
    for (const id of [null, undefined, "", "   "]) {
      expect(resolvePartnerOrgLabel(id, "consortium_partner").reason).toBe("no_active_org");
    }
  });
});

describe("v5 §D — NEVER a natural person's name, and never a raw id", () => {
  it("an inactive org with a person contact under the same id yields the fail-closed label", () => {
    insertOrg(ID_INACTIVE, ORG_NAME, "suspended");
    insertPersonContact(ID_INACTIVE);
    const label = partnerOrgLabel(ID_INACTIVE, "consortium_partner");
    expect(label).toBe(PRIVATE_LABEL);
    expect(label).not.toContain("Amelia");
    expect(label).not.toContain("Thorne");
  });

  it("with NO org row but a person contact present, the person's name is not used", () => {
    insertPersonContact(ID_ORPHAN);
    expect(partnerOrgLabel(ID_ORPHAN, "consortium_partner")).toBe(PRIVATE_LABEL);
  });

  it("never returns a raw `ac_…` id", () => {
    insertPersonContact(ID_ORPHAN);
    for (const kind of ["consortium_partner", "investor", "founder", null]) {
      const label = partnerOrgLabel(ID_ORPHAN, kind);
      expect(label).not.toContain("ac_");
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("v5 §D — cannot be pointed at a non-partner row by accident", () => {
  it("a non-`consortium_partner` kind is refused OUTRIGHT even when an active org exists", () => {
    // The active org row is present, so only the kind guard can produce this.
    insertOrg(ID_ACTIVE, ORG_NAME, "active");
    for (const kind of ["investor", "founder", "advisor", "", null, undefined]) {
      expect(resolvePartnerOrgLabel(ID_ACTIVE, kind)).toEqual({
        label: PRIVATE_LABEL,
        resolved: false,
        reason: "not_a_partner_contact",
      });
    }
  });
});

describe("v5 §D — the label is always safe to render", () => {
  it("every branch returns a non-empty string, never null", () => {
    insertOrg(ID_ACTIVE, ORG_NAME, "active");
    insertOrg(ID_BLANK, "  ", "active");
    const cases: Array<[string | null, string | null]> = [
      [ID_ACTIVE, "consortium_partner"],
      [ID_BLANK, "consortium_partner"],
      [ID_ORPHAN, "consortium_partner"],
      [ID_ACTIVE, "investor"],
      [null, "consortium_partner"],
      [null, null],
    ];
    for (const [id, kind] of cases) {
      const r = resolvePartnerOrgLabel(id, kind);
      expect(typeof r.label).toBe("string");
      expect(r.label.trim().length).toBeGreaterThan(0);
    }
  });
});
