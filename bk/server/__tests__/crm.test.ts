/**
 * Sprint 10 — Investor Personal CRM store tests.
 *
 *   • addContact persists with generated id
 *   • movePipeline updates stage and emits a known transition
 *   • Seed always populates initial contacts
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addContact, movePipeline, clearCrm, getAllContacts,
} from "../crmStore";
import type { PcrmContact } from "../../shared/schema";

beforeEach(() => clearCrm());

describe("crmStore", () => {
  it("seeds an initial rolodex on first read", () => {
    const list = getAllContacts();
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.some((c) => c.name === "Maya Chen")).toBe(true);
  });

  it("addContact assigns id and createdAt", () => {
    getAllContacts(); // trigger seed
    const input: PcrmContact = {
      name: "Test Founder",
      kind: "founder",
      pipelineStage: "lead",
      tags: ["fintech"],
      lanes: ["cap_table"],
    };
    const c = addContact(input);
    expect(c.id).toMatch(/^ct_/);
    expect(c.createdAt).toBeTruthy();
    expect(c.name).toBe("Test Founder");
  });

  it("movePipeline transitions a contact and reports from/to", () => {
    getAllContacts();
    const c = addContact({ name: "Move Me", kind: "co_investor", pipelineStage: "met" });
    const r = movePipeline(c.id, "diligence");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe("met");
      expect(r.to).toBe("diligence");
      expect(r.contact.pipelineStage).toBe("diligence");
    }
  });

  it("movePipeline returns error for unknown id", () => {
    getAllContacts();
    const r = movePipeline("ct_does_not_exist", "invested");
    expect(r.ok).toBe(false);
  });
});
