/**
 * W-AVI43 Issue 2 — founder↔investor DM resolution for UNREGISTERED investors.
 *
 * REPRO (Avi's report, confirmed live): a founder tries to DM an investor and
 * gets 403 CANNOT_DM_PARTICIPANT with reason "unresolved". The LOCKED permission
 * matrix already allows founder↔investor DMs, so the block was NOT a policy gap —
 * it was `resolveDmRole()` returning "unknown" for an investor who exists only as
 * a cap-table holder or a founder CRM contact and has NOT registered a login
 * (no auth_users row). canDM then fails closed on the unresolved role.
 *
 * FIX (server/messagingPolicy.ts, NON-sacred): after the durable auth_users /
 * users / partner-contacts lookups, resolveDmRole now also recognises:
 *   step 4 — a committed cap-table holder (READ-ONLY from captable_commits) → investor
 *   step 5 — a founder CRM investor contact (founder_crm_contacts, by id OR email) → investor
 *
 * This keeps DMs OPEN for the founder's legitimate cap-table/CRM relationships
 * (Ozan's directive) while genuine strangers/guests STILL fail closed.
 *
 * The sacred messagingStore.ts is untouched; the sacred captable_commits ledger
 * is only READ (Sacred Tier 3 #30 — never written).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { rawDb, getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { canDM, resolveDmRole } from "../messagingPolicy";

const FOUNDER = "u_maya_chen"; // seeded founder
const GUEST = "guest_unregistered_avi43"; // never seeded anywhere → must stay unknown/blocked

// Cap-table-only investor: present in captable_commits, absent from auth_users.
const CAPTABLE_INVESTOR = "u_avi43_captable_only";
// CRM-only investor: present in founder_crm_contacts, absent from auth_users.
const CRM_INVESTOR = "u_avi43_crm_only";
const CRM_INVESTOR_EMAIL = "avi43.crmonly@example.test";

beforeAll(async () => {
  await seedDemoData(getDb());
  const db: any = rawDb();

  // Seed a cap-table commit for an investor with NO auth_users row. The ledger
  // is append-only + hash-chained; for a role-resolution read we only need a row
  // whose investor_id matches. Insert defensively across the known column set.
  try {
    const cols = db.prepare(`PRAGMA table_info(captable_commits)`).all() as Array<{ name: string; notnull: number; dflt_value: unknown }>;
    const names = cols.map((c) => c.name);
    const now = new Date().toISOString();
    const val = (n: string): unknown => {
      if (n === "investor_id") return CAPTABLE_INVESTOR;
      if (n === "company_id") return "co_novapay";
      if (n === "id") return "cc_avi43_test";
      if (/at$|_ts$|date/i.test(n)) return now;
      if (/hash/i.test(n)) return "0".repeat(64);
      if (/json|payload|data|snapshot/i.test(n)) return "{}";
      if (/amount|shares|pct|price|version|seq|index|num/i.test(n)) return 0;
      return ""; // safe default for remaining TEXT columns
    };
    const insertCols = names.filter((n) => n !== "rowid");
    const placeholders = insertCols.map(() => "?").join(",");
    db.prepare(
      `INSERT OR IGNORE INTO captable_commits (${insertCols.join(",")}) VALUES (${placeholders})`,
    ).run(...insertCols.map(val));
  } catch {
    /* if the exact ledger shape rejects the insert, the cap-table assertion below
       will surface it rather than silently passing */
  }

  // Seed a CRM-only contact (DB is authoritative per founderCrmStore).
  try {
    const cols = db.prepare(`PRAGMA table_info(founder_crm_contacts)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    const now = new Date().toISOString();
    const val = (n: string): unknown => {
      if (n === "id") return "fcrm_avi43_test";
      if (n === "company_id") return "co_novapay";
      if (n === "investor_id") return CRM_INVESTOR;
      if (n === "email") return CRM_INVESTOR_EMAIL;
      if (n === "name") return "Avi43 CrmOnly";
      if (n === "tenant_id") return "tenant_unknown";
      if (/at$|date/i.test(n)) return now;
      if (/json/i.test(n)) return "{}";
      return "";
    };
    const insertCols = names;
    const placeholders = insertCols.map(() => "?").join(",");
    db.prepare(
      `INSERT OR IGNORE INTO founder_crm_contacts (${insertCols.join(",")}) VALUES (${placeholders})`,
    ).run(...insertCols.map(val));
  } catch {
    /* surfaced by the CRM assertions below */
  }
}, 60_000);

describe("W-AVI43 Issue 2 — resolveDmRole recognises unregistered cap-table/CRM investors", () => {
  it("a cap-table holder (no auth_users) resolves as investor", () => {
    expect(resolveDmRole(CAPTABLE_INVESTOR)).toBe("investor");
  });

  it("a founder CRM contact resolves as investor (by id)", () => {
    expect(resolveDmRole(CRM_INVESTOR)).toBe("investor");
  });

  it("a founder CRM contact resolves as investor (by email)", () => {
    expect(resolveDmRole(CRM_INVESTOR_EMAIL)).toBe("investor");
  });

  it("a genuine unregistered stranger STILL resolves unknown (fail-closed preserved)", () => {
    expect(resolveDmRole(GUEST)).toBe("unknown");
  });
});

describe("W-AVI43 Issue 2 — founder can now DM cap-table/CRM investors; stranger stays blocked", () => {
  it("founder → cap-table investor is ALLOWED (was 'unresolved' before the fix)", () => {
    const v = canDM(FOUNDER, CAPTABLE_INVESTOR);
    expect(v.allowed).toBe(true);
  });

  it("founder → CRM investor (by id) is ALLOWED", () => {
    const v = canDM(FOUNDER, CRM_INVESTOR);
    expect(v.allowed).toBe(true);
  });

  it("founder → genuine stranger is STILL BLOCKED with reason 'unresolved'", () => {
    const v = canDM(FOUNDER, GUEST);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("unresolved");
  });

  it("self-DM and anonymous remain blocked (no regression)", () => {
    expect(canDM(FOUNDER, FOUNDER).allowed).toBe(false);
    expect(canDM(FOUNDER, "").allowed).toBe(false);
  });
});
