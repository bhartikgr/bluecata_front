/**
 * w-partner F7 — workspace displayName mirrors onto the partner contact record.
 *
 * ANTI-VACUITY. Three distinct claims, each with its own failure mode:
 *   1. The mirror actually happens — the CONTACT's displayName changes and its
 *      version bumps (a settings-only write would leave both untouched).
 *   2. legal_name is NEVER derived from the self-service display field. A
 *      mirror that overwrote it would be a silent corruption of a legal
 *      identifier, so the assertion is explicit.
 *   3. The mirror is NON-FATAL. The settings write has already committed by the
 *      time it runs, so a throwing updateContact must still return 200 with the
 *      saved settings — not turn a successful save into an error. This is
 *      proved by making updateContact throw, which is why this file mocks
 *      adminContactsStore (every other export is the real one).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
/* vi.mock below is hoisted above these imports, so partnerRoutes binds to the
   wrapped updateContact. Every other adminContactsStore export is the real one. */
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox, TEST_PARTNER_ID, TEST_PARTNER_LEGAL_NAME } from "../partnerWorkspaceStore";
import { getById } from "../adminContactsStoreShim";

/* Toggled by the non-fatal test; the mirror call is the only consumer that
   flips it, so the surrounding admin routes keep the real implementation. */
let mirrorShouldThrow = false;
let lastMirrorCall: { id: string; patch: Record<string, unknown>; action: string } | null = null;

vi.mock("../adminContactsStore", async () => {
  const actual = await vi.importActual<typeof import("../adminContactsStore")>("../adminContactsStore");
  return {
    ...actual,
    updateContact: (id: string, patch: Record<string, unknown>, actor: string, action = "contact.updated") => {
      if (action === "partner.display_name.mirrored") {
        lastMirrorCall = { id, patch, action };
        if (mirrorShouldThrow) throw new Error("SIMULATED_CONTACT_WRITE_FAILURE");
      }
      return actual.updateContact(id, patch as never, actor, action);
    },
  };
});

const MANAGING = "u_avi_managing";
const VIEWER_SEAT = "u_avi_viewer";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("F7 — displayName mirror", () => {
  it("mirrors displayName onto the contact and BUMPS its version", async () => {
    const before = getById(TEST_PARTNER_ID)!;
    const next = `Mirrored Name ${Date.now()}`;

    const r = await request(app)
      .patch("/api/partner/me/workspace-settings")
      .set("x-user-id", MANAGING)
      .send({ displayName: next });

    expect(r.status).toBe(200);
    expect(r.body.settings.displayName).toBe(next);

    const after = getById(TEST_PARTNER_ID)!;
    expect(after.displayName).toBe(next);
    // A settings-only write would leave the contact revision untouched.
    expect(after.version).toBe(before.version + 1);
    expect(lastMirrorCall).toMatchObject({
      id: TEST_PARTNER_ID,
      action: "partner.display_name.mirrored",
    });
    expect(Object.keys(lastMirrorCall!.patch)).toEqual(["displayName"]);
  });

  it("NEVER touches legalName", async () => {
    const r = await request(app)
      .patch("/api/partner/me/workspace-settings")
      .set("x-user-id", MANAGING)
      .send({ displayName: "Legal Name Probe" });
    expect(r.status).toBe(200);
    expect(getById(TEST_PARTNER_ID)!.legalName).toBe(TEST_PARTNER_LEGAL_NAME);
  });

  it("does NOT fire when the patch has no displayName key", async () => {
    lastMirrorCall = null;
    const before = getById(TEST_PARTNER_ID)!;
    const r = await request(app)
      .patch("/api/partner/me/workspace-settings")
      .set("x-user-id", MANAGING)
      .send({ regionCode: "GB" });
    expect(r.status).toBe(200);
    expect(lastMirrorCall).toBeNull();
    expect(getById(TEST_PARTNER_ID)!.version).toBe(before.version);
  });

  it("is NON-FATAL — a throwing mirror still returns 200 and the settings stay saved", async () => {
    mirrorShouldThrow = true;
    try {
      const next = `Non Fatal ${Date.now()}`;
      const r = await request(app)
        .patch("/api/partner/me/workspace-settings")
        .set("x-user-id", MANAGING)
        .send({ displayName: next });

      // The user's actual intent — the settings save — already committed.
      expect(r.status).toBe(200);
      expect(r.body.settings.displayName).toBe(next);

      const read = await request(app)
        .get("/api/partner/me/workspace-settings")
        .set("x-user-id", MANAGING);
      expect(read.status).toBe(200);
      expect(read.body.settings.displayName).toBe(next);
    } finally {
      mirrorShouldThrow = false;
    }
  });

  it("NO-DROP — the settings write gate is unchanged (a viewer is still 403)", async () => {
    const r = await request(app)
      .patch("/api/partner/me/workspace-settings")
      .set("x-user-id", VIEWER_SEAT)
      .send({ displayName: "viewer attempt" });
    expect(r.status).toBe(403);
  });
});
