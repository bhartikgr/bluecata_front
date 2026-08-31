/* ════════════════════════════════════════════════════════════════════════════
   WAVE 200 — R173.8 (contact type persists and propagates) and R173.9 (notes
   append, keep history, and are deleted only with an audit row).
   ════════════════════════════════════════════════════════════════════════════
   Every test here drives the REAL HTTP routes. Nothing calls a store function
   directly, because the defect this wave fixes was invisible at the store's
   return value: `persistContact` returned the new kind while the row kept the
   old one, so only a later READ over the route could see it.

   THE TWO DEFECTS, AS VERIFIED BEFORE THE FIX (W200_PREFLIGHT.md §3):
     A  PATCH /api/admin/contacts/:id  →  200, contact.kind = "founder"
        GET   /api/admin/contacts/:id  →  contact.kind = "investor"   ← lost
        `type` persisted correctly, so this was `kind` alone.
     B  PATCH /api/partner/me/notes/:id with a body overwrote the note text and
        would accept a new authorUserId and createdAt, erasing who wrote it and
        when. DELETE stamped "[DELETED]" over the title and body and logged
        itself as `partner.note.updated`, so an erasure was indistinguishable
        from an edit in the audit log.

   Sections 5 and 6 are the data-loss guards: they count notes and compare every
   original field before and after, because "never lose existing data" is the
   part of this wave that could do real harm.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { registerAdminContactsRoutes } from "../adminContactsStore";
import { registerAdminPlatformRoutes, getAuditLog } from "../adminPlatformStore";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";

/* ── Admin harness (the identity shim needs a real listening socket) ───────── */
function makeAdminApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerAdminPlatformRoutes(app);
  registerAdminContactsRoutes(app);
  return app;
}

function adminReq(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const h: Record<string, string> = data
        ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)), ...headers }
        : { ...headers };
      const r = http.request({ port, path, method, headers: h }, (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          server.close();
          let parsed: any = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      });
      r.on("error", (e) => {
        server.close();
        reject(e);
      });
      if (data) r.write(data);
      r.end();
    });
  });
}

/* ── Partner harness ──────────────────────────────────────────────────────── */
let partnerApp: express.Express;
const PARTNER_USER = "u_avi_managing";

beforeAll(() => {
  partnerApp = express();
  partnerApp.use(express.json());
  registerPartnerRoutes(partnerApp);
  seedTestPartnerSandbox({ force: true });
});

function createNote(payload: Record<string, unknown>) {
  return request(partnerApp).post("/api/partner/me/notes").set("x-user-id", PARTNER_USER).send(payload);
}
function listNotes() {
  return request(partnerApp).get("/api/partner/me/notes").set("x-user-id", PARTNER_USER);
}
function patchNote(id: string, payload: Record<string, unknown>) {
  return request(partnerApp).patch(`/api/partner/me/notes/${id}`).set("x-user-id", PARTNER_USER).send(payload);
}
function deleteNote(id: string) {
  return request(partnerApp).delete(`/api/partner/me/notes/${id}`).set("x-user-id", PARTNER_USER);
}

/* ════════════════════════════════════════════════════════════════════════════
   1 — ITEM A: the change survives the write and every read that follows.
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 200 §1 · R173.8 — a contact kind change persists", () => {
  it("is still the new kind on the next GET, not just in the PATCH response", async () => {
    const app = makeAdminApp();
    const created = await adminReq(
      app,
      "POST",
      "/api/admin/contacts",
      { legalName: "W200 Persist Co", email: "w200-persist@example.com", kind: "investor", type: "institutional" },
      { "x-confirm": "true" },
    );
    const id = created.body?.contact?.id as string;
    expect(id).toBeTruthy();
    expect(created.body.contact.kind).toBe("investor");

    const patched = await adminReq(app, "PATCH", `/api/admin/contacts/${id}`, { kind: "founder" }, { "x-confirm": "true" });
    expect(patched.status).toBe(200);
    expect(patched.body.contact.kind).toBe("founder");

    /* THE DEFECT: before this wave the line below read "investor". */
    const got = await adminReq(app, "GET", `/api/admin/contacts/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.contact.kind).toBe("founder");
  });

  it("propagates to the kind-filtered list and to the kind counters", async () => {
    const app = makeAdminApp();
    const created = await adminReq(
      app,
      "POST",
      "/api/admin/contacts",
      { legalName: "W200 Propagate Co", email: "w200-propagate@example.com", kind: "investor", type: "institutional" },
      { "x-confirm": "true" },
    );
    const id = created.body.contact.id as string;

    const before = await adminReq(app, "GET", "/api/admin/contacts/stats");
    const beforeFounders = before.body.byKind.founder as number;
    const beforeInvestors = before.body.byKind.investor as number;
    const beforeTotal = before.body.total as number;

    const investorsBefore = await adminReq(app, "GET", "/api/admin/contacts?kind=investor");
    expect((investorsBefore.body.contacts ?? []).some((c: any) => c.id === id)).toBe(true);

    await adminReq(app, "PATCH", `/api/admin/contacts/${id}`, { kind: "founder" }, { "x-confirm": "true" });

    const founders = await adminReq(app, "GET", "/api/admin/contacts?kind=founder");
    expect((founders.body.contacts ?? []).some((c: any) => c.id === id)).toBe(true);
    /* Paired negative: it LEFT the list it used to be in. */
    const investorsAfter = await adminReq(app, "GET", "/api/admin/contacts?kind=investor");
    expect((investorsAfter.body.contacts ?? []).some((c: any) => c.id === id)).toBe(false);

    const after = await adminReq(app, "GET", "/api/admin/contacts/stats");
    expect(after.body.byKind.founder).toBe(beforeFounders + 1);
    expect(after.body.byKind.investor).toBe(beforeInvestors - 1);
    /* Nothing was created or lost — one contact moved. */
    expect(after.body.total).toBe(beforeTotal);
  });

  it("leaves every other field of the contact exactly as it was", async () => {
    const app = makeAdminApp();
    const created = await adminReq(
      app,
      "POST",
      "/api/admin/contacts",
      {
        legalName: "W200 Untouched Co",
        email: "w200-untouched@example.com",
        kind: "investor",
        type: "institutional",
        hqCity: "New York",
        region: "US",
      },
      { "x-confirm": "true" },
    );
    const id = created.body.contact.id as string;
    const beforeRow = (await adminReq(app, "GET", `/api/admin/contacts/${id}`)).body.contact;

    await adminReq(app, "PATCH", `/api/admin/contacts/${id}`, { kind: "consortium_partner" }, { "x-confirm": "true" });
    const afterRow = (await adminReq(app, "GET", `/api/admin/contacts/${id}`)).body.contact;

    expect(afterRow.kind).toBe("consortium_partner");
    /* `type` was already persisting correctly before this wave; this asserts the
       fix did not disturb it, since both fields go through the same upsert. */
    expect(afterRow.type).toBe(beforeRow.type);
    expect(afterRow.legalName).toBe(beforeRow.legalName);
    expect(afterRow.email).toBe(beforeRow.email);
    expect(afterRow.hqCity).toBe(beforeRow.hqCity);
    expect(afterRow.status).toBe(beforeRow.status);
    expect(afterRow.verification).toBe(beforeRow.verification);
    expect(afterRow.createdAt).toBe(beforeRow.createdAt);
  });

  it("keeps the revision chain verifying after the kind change", async () => {
    const app = makeAdminApp();
    const created = await adminReq(
      app,
      "POST",
      "/api/admin/contacts",
      { legalName: "W200 Chain Co", email: "w200-chain@example.com", kind: "investor", type: "institutional" },
      { "x-confirm": "true" },
    );
    const id = created.body.contact.id as string;
    await adminReq(app, "PATCH", `/api/admin/contacts/${id}`, { kind: "founder" }, { "x-confirm": "true" });
    const hist = await adminReq(app, "GET", `/api/admin/contacts/${id}/history`);
    expect(hist.status).toBe(200);
    expect(hist.body.chain.ok).toBe(true);
    /* The snapshot the chain attests and the row a reader gets now agree — before
       this wave the snapshot said "founder" and the row said "investor", and the
       verifier could not see it because it re-derives from the snapshots. */
    const latest = (hist.body.history ?? []).slice(-1)[0];
    expect(latest.snapshot.kind).toBe("founder");
    expect((await adminReq(app, "GET", `/api/admin/contacts/${id}`)).body.contact.kind).toBe(latest.snapshot.kind);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   2 — ITEM B: editing a note ADDS to it; the original survives.
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 200 §2 · R173.9 — a note edit appends", () => {
  it("keeps the original text, author and date, and records each addition as its own entry", async () => {
    const created = await createNote({ title: "Append T1", body: "FIRST", scope: "general" });
    const id = created.body.note.id as string;
    const originalAuthor = created.body.note.authorUserId as string;
    const originalCreatedAt = created.body.note.createdAt as string;

    const p1 = await patchNote(id, { body: "SECOND" });
    expect(p1.status).toBe(200);
    const p2 = await patchNote(id, { body: "THIRD", title: "Append T2" });
    expect(p2.status).toBe(200);

    const row = (await listNotes()).body.notes.find((n: any) => n.id === id);
    expect(row).toBeTruthy();
    /* THE RULING: original text is not overwritten. */
    expect(row.body).toBe("FIRST");
    expect(row.authorUserId).toBe(originalAuthor);
    expect(row.createdAt).toBe(originalCreatedAt);
    /* A series of entries, not one blended string. */
    expect(row.entries.map((e: any) => e.body)).toEqual(["FIRST", "SECOND", "THIRD"]);
    expect(row.entries.map((e: any) => e.seq)).toEqual([1, 2, 3]);
    /* Fields that are genuinely metadata still edit normally. */
    expect(row.title).toBe("Append T2");
  });

  it("does not append a duplicate entry when the submitted text is unchanged", async () => {
    const created = await createNote({ title: "Idempotent", body: "SAME", scope: "general" });
    const id = created.body.note.id as string;
    await patchNote(id, { body: "SAME" });
    await patchNote(id, { body: "SAME" });
    const row = (await listNotes()).body.notes.find((n: any) => n.id === id);
    expect(row.entries).toHaveLength(1);
  });

  it("refuses an attempt to rewrite the author or the creation date, and saves nothing", async () => {
    const created = await createNote({ title: "Immutable", body: "ORIGINAL", scope: "general" });
    const id = created.body.note.id as string;
    const before = (await listNotes()).body.notes.find((n: any) => n.id === id);

    const res = await patchNote(id, {
      body: "ATTEMPTED REWRITE",
      authorUserId: "u_impostor",
      createdAt: "1999-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("PARTNER_PATCH_FIELD_NOT_APPLIED");
    /* The refusal names the fields in words the owner can read, and says nothing
       was saved — the house rule is refuse-whole, never half-apply. */
    expect(res.body.refusalHeadline).toContain("author");
    expect(res.body.refusalHeadline).toContain("created date");

    const after = (await listNotes()).body.notes.find((n: any) => n.id === id);
    expect(after.authorUserId).toBe(before.authorUserId);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.body).toBe("ORIGINAL");
    expect(after.version).toBe(before.version);
    expect(after.entries).toHaveLength(1);
  });

  it("gives a note written before this wave a derived original entry rather than an empty history", async () => {
    /* The sandbox seed writes notes through the pre-wave-200 shape (no `entries`
       key on the stored JSON), so any seeded note exercises the legacy path. */
    const rows = (await listNotes()).body.notes as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const n of rows) {
      expect(Array.isArray(n.entries)).toBe(true);
      expect(n.entries.length).toBeGreaterThanOrEqual(1);
      expect(n.entries[0].seq).toBe(1);
      /* The derived entry carries the note's own original text and author — it is
         not a placeholder. */
      expect(n.entries[0].body).toBe(n.body);
      expect(n.entries[0].authorUserId).toBe(n.authorUserId);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   3 — ITEM B: deletion is permitted, audited, and actually stops showing.
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 200 §3 · R173.9 — deletion is audited", () => {
  it("writes a partner.note.deleted audit row through the wave-186 writer", async () => {
    const created = await createNote({ title: "To delete", body: "DELETE ME", scope: "general" });
    const id = created.body.note.id as string;

    const before = getAuditLog().filter((r: any) => r.eventType === "partner.note.deleted").length;
    const del = await deleteNote(id);
    expect(del.status).toBe(200);

    const rows = getAuditLog().filter((r: any) => r.eventType === "partner.note.deleted");
    expect(rows.length).toBe(before + 1);
    const row: any = rows[rows.length - 1];
    /* The row identifies WHICH note and WHO erased it — an audit row that cannot
       answer those two questions is not an audit row. */
    expect(JSON.stringify(row)).toContain(id);
    expect(row.actor).toBeTruthy();
    expect(row.payload.noteId).toBe(id);
    /* The erased note's own author and creation date are preserved in the audit
       payload, so an erasure can still be attributed after the fact. */
    expect(row.payload.noteAuthorUserId).toBeTruthy();
    expect(row.payload.noteCreatedAt).toBeTruthy();
    /* No second audit path was created: the erasure is no longer logged as an
       ordinary update, which is how it read before this wave. */
    const updatesMentioning = getAuditLog().filter(
      (r: any) => r.eventType === "partner.note.updated" && JSON.stringify(r).includes(id),
    );
    expect(updatesMentioning).toHaveLength(0);
  });

  it("stops showing the deleted note while leaving every other note visible", async () => {
    const keep = await createNote({ title: "Keeper", body: "KEEP ME", scope: "general" });
    const drop = await createNote({ title: "Dropper", body: "DROP ME", scope: "general" });
    const keepId = keep.body.note.id as string;
    const dropId = drop.body.note.id as string;

    expect(await deleteNote(dropId).then((r) => r.status)).toBe(200);

    const rows = (await listNotes()).body.notes as any[];
    expect(rows.some((n) => n.id === dropId)).toBe(false);
    expect(rows.some((n) => n.id === keepId)).toBe(true);
    /* And no ghost text leaks through the list payload. */
    expect(JSON.stringify(rows)).not.toContain("DROP ME");
  });

  it("refuses a later edit of a deleted note instead of silently resurrecting it", async () => {
    const created = await createNote({ title: "Tombstoned", body: "GONE", scope: "general" });
    const id = created.body.note.id as string;
    expect(await deleteNote(id).then((r) => r.status)).toBe(200);

    const res = await patchNote(id, { body: "BACK FROM THE DEAD" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const rows = (await listNotes()).body.notes as any[];
    expect(rows.some((n) => n.id === id)).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("BACK FROM THE DEAD");
  });

  it("deletes softly — a second delete of the same note does not create a second erasure event", async () => {
    const created = await createNote({ title: "Once", body: "ONCE", scope: "general" });
    const id = created.body.note.id as string;
    await deleteNote(id);
    const afterFirst = getAuditLog().filter(
      (r: any) => r.eventType === "partner.note.deleted" && JSON.stringify(r).includes(id),
    ).length;
    expect(afterFirst).toBe(1);
    await deleteNote(id);
    const afterSecond = getAuditLog().filter(
      (r: any) => r.eventType === "partner.note.deleted" && JSON.stringify(r).includes(id),
    ).length;
    expect(afterSecond).toBe(1);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   4 — DATA-LOSS GUARD. The note model changed, so this wave's real risk is
   losing note text that already existed. These two tests are the counted proof.
   ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 200 §4 — no existing note data is lost", () => {
  it("counts the same notes before and after an append, minus only what was deliberately deleted", async () => {
    const before = (await listNotes()).body.notes as any[];
    const beforeCount = before.length;
    const beforeById = new Map(before.map((n) => [n.id, n]));

    const created = await createNote({ title: "Counted", body: "COUNTED ORIGINAL", scope: "general" });
    const newId = created.body.note.id as string;
    await patchNote(newId, { body: "COUNTED ADDITION" });

    const after = (await listNotes()).body.notes as any[];
    expect(after.length).toBe(beforeCount + 1);

    /* Every note that existed before is still there, with its original text,
       author and creation date byte-identical. */
    for (const [id, prev] of beforeById) {
      const now = after.find((n) => n.id === id);
      expect(now, `note ${id} disappeared`).toBeTruthy();
      expect(now.body).toBe(prev.body);
      expect(now.title).toBe(prev.title);
      expect(now.authorUserId).toBe(prev.authorUserId);
      expect(now.createdAt).toBe(prev.createdAt);
    }
  });

  it("keeps the appended text retrievable after the note is read back fresh", async () => {
    const created = await createNote({ title: "Durable", body: "DURABLE FIRST", scope: "general" });
    const id = created.body.note.id as string;
    await patchNote(id, { body: "DURABLE SECOND" });
    /* Read through a second, independent list call: the entries live in the same
       stored JSON blob the note itself lives in, so if they were dropped on
       rehydration this is where it would show. */
    const rows = (await listNotes()).body.notes as any[];
    const row = rows.find((n) => n.id === id);
    expect(row.entries.map((e: any) => e.body)).toEqual(["DURABLE FIRST", "DURABLE SECOND"]);
  });
});
