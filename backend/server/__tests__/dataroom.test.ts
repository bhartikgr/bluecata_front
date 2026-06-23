/**
 * Sprint 11 — Dataroom rebuild tests.
 *
 * Verifies the seeded folders/files/permissions/events shape.
 * The Sprint 10 audit found dataroom was BROKEN; this test guards the
 * rebuild's data integrity.
 */
import { describe, it, expect } from "vitest";
import { _testAccess } from "../dataroomStore";

describe("dataroomStore", () => {
  it("seeds the canonical folder structure (Pitch, Financials, Legal, Diligence)", () => {
    const { folders } = _testAccess;
    expect(folders.length).toBeGreaterThanOrEqual(4);
    const names = folders.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(["Pitch", "Financials", "Legal", "Diligence"]),
    );
    // every folder belongs to a company
    for (const f of folders) {
      expect(f.companyId).toBeTruthy();
      expect(f.id).toBeTruthy();
    }
  });

  it("seeds at least 5 files attached to existing folders", () => {
    const { files, folders } = _testAccess;
    expect(files.length).toBeGreaterThanOrEqual(5);
    const folderIds = new Set(folders.map((f) => f.id));
    for (const file of files) {
      expect(folderIds.has(file.folderId)).toBe(true);
    }
  });

  it("permission rows reference valid folders and at least 5 are seeded", () => {
    const { permissions, folders } = _testAccess;
    expect(permissions.length).toBeGreaterThanOrEqual(5);
    const folderIds = new Set(folders.map((f) => f.id));
    for (const p of permissions) {
      expect(folderIds.has(p.folderId)).toBe(true);
      expect(typeof p.view).toBe("boolean");
      expect(typeof p.download).toBe("boolean");
    }
  });

  it("events log contains at least one view and one download record", () => {
    const { events } = _testAccess;
    expect(events.length).toBeGreaterThanOrEqual(4);
    const actions = new Set(events.map((e) => e.action));
    expect(actions.has("view")).toBe(true);
    expect(actions.has("download")).toBe(true);
  });

  it("every file declares a watermark setting (boolean) and a mime type", () => {
    for (const file of _testAccess.files) {
      expect(typeof file.watermark).toBe("boolean");
      expect(file.mime).toBeTruthy();
      expect(typeof file.sizeBytes).toBe("number");
    }
  });
});
