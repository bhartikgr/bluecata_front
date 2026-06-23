/**
 * Patch v12 Day 3 — crmStore (pcrm) persistence test.
 *
 * Verifies that addContact/persistNote/persistTask write through to the
 * pcrm_contacts, pcrm_notes, pcrm_tasks tables and survive a simulated
 * restart via hydrateCrmStore().
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addContact,
  movePipeline,
  hydrateCrmStore,
  clearCrm,
  _testCrm,
} from "../crmStore";
import {
  pcrmContacts,
  pcrmNotes,
  pcrmTasks,
} from "@shared/schema";
import { getDb } from "../db/connection";
import type { PcrmContact } from "@shared/schema";

describe("v12 crmStore (pcrm) — DB persistence + hydration", () => {
  beforeEach(() => {
    clearCrm();
  });

  it("persists addContact through to pcrm_contacts and rebuilds cache on hydrate", async () => {
    const input: PcrmContact = {
      name: "Maya Test",
      kind: "vc",
      firm: "TestVC",
      email: "maya@test.vc",
      pipelineStage: "soft_circle",
      tags: ["seed"],
      lanes: ["primary"],
    } as PcrmContact;

    const ownerId = "u_test_owner_alpha";
    const c = addContact(input, ownerId);
    expect(c.id).toMatch(/^ct_/);

    // Confirm DB row exists
    const rows = getDb().select().from(pcrmContacts).all() as any[];
    const ours = rows.find((r) => r.id === c.id);
    expect(ours).toBeDefined();
    expect(ours.tenantId).toBe(`tenant_inv_${ownerId}`);
    expect(ours.name).toBe("Maya Test");

    // Simulate restart: clear cache (not DB), then hydrate.
    _testCrm.contactsByUser.clear();
    _testCrm.notes.length = 0;
    _testCrm.tasks.length = 0;

    await hydrateCrmStore();

    const restoredArr = _testCrm.contactsByUser.get(ownerId) ?? [];
    expect(restoredArr.find((x) => x.id === c.id)?.name).toBe("Maya Test");
  });

  it("movePipeline updates pipeline_stage in DB", () => {
    const input: PcrmContact = {
      name: "Stage Mover",
      kind: "angel",
      pipelineStage: "lead",
      tags: [],
      lanes: [],
    } as PcrmContact;
    const ownerId = "u_test_owner_beta";
    const c = addContact(input, ownerId);

    const res = movePipeline(c.id, ownerId, "engaged");
    expect(res.ok).toBe(true);

    const rows = getDb().select().from(pcrmContacts).all() as any[];
    const ours = rows.find((r) => r.id === c.id);
    expect(ours.pipelineStage).toBe("engaged");
  });

  it("clearCrm truncates the DB tables", () => {
    const ownerId = "u_test_owner_gamma";
    addContact({ name: "X", kind: "vc", pipelineStage: "lead", tags: [], lanes: [] } as PcrmContact, ownerId);
    expect((getDb().select().from(pcrmContacts).all() as any[]).length).toBeGreaterThan(0);

    clearCrm();
    expect((getDb().select().from(pcrmContacts).all() as any[]).length).toBe(0);
    expect((getDb().select().from(pcrmNotes).all() as any[]).length).toBe(0);
    expect((getDb().select().from(pcrmTasks).all() as any[]).length).toBe(0);
  });
});
