/**
 * v25.48 B1 — bi-directional CRM auto-seed (investor side). The parallel module
 * seedInvestorCrmFromInvitation writes an investor_crm_contacts row tagged
 * "invitation-sourced" (Sacred investorCrmStore never edited). Idempotent: a
 * pre-existing row for the same (investor, company) is not clobbered.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { getDb, rawDb } from "../db/connection.ts";
import { seedInvestorCrmFromInvitation } from "../lib/investorCrmInvitationSeed.ts";

beforeAll(() => { getDb(); });

describe("v25.48 B1 investor CRM invitation auto-seed", () => {
  it("seeds an investor_crm_contacts row tagged invitation-sourced", () => {
    const investorId = `u_b1_${Date.now()}`;
    const id = seedInvestorCrmFromInvitation({
      investorId,
      companyId: "co_novapay",
      companyName: "NovaPay AI",
      founderName: "Maya Chen",
      founderEmail: "maya@novapay.ai",
      roundId: "rnd_x",
    });
    expect(id).toBeTruthy();
    const row = rawDb().prepare("SELECT * FROM investor_crm_contacts WHERE investor_id=? AND company_id=?").get(investorId, "co_novapay");
    expect(row).toBeTruthy();
    expect(row.company_id).toBe("co_novapay");
    expect(String(row.tags)).toContain("invitation-sourced");
  });

  it("is idempotent — a second seed for the same (investor, company) does not create a duplicate", () => {
    const investorId = `u_b1_idem_${Date.now()}`;
    const first = seedInvestorCrmFromInvitation({ investorId, companyId: "co_acme", companyName: "Acme" });
    expect(first).toBeTruthy();
    const second = seedInvestorCrmFromInvitation({ investorId, companyId: "co_acme", companyName: "Acme" });
    expect(second).toBeNull(); // skipped — existing row preserved
    const cnt = rawDb().prepare("SELECT COUNT(*) c FROM investor_crm_contacts WHERE investor_id=? AND company_id=?").get(investorId, "co_acme");
    expect(cnt.c).toBe(1);
  });
});
