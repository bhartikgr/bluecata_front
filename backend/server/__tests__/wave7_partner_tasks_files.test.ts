/**
 * WAVE 7 — W-8 (DEF-057) and W-5 (DEF-056) proving tests.
 *
 * These test the SINK, not the route shape. The failure mode this wave is
 * guarding against is "the fix was placed where data does not flow", so every
 * assertion below reads the value back out of the DURABLE table
 * (`partner_tasks` / `partner_files`) or out of the DURABLE object store, not
 * out of the response body the route just echoed.
 *
 * Sinks under test:
 *   W-8  partnerTasksStore.create/update -> persistTask() -> partner_tasks
 *   W-5  partnerFilesStore.add/remove    -> persistFile() -> partner_files
 *        plus objectStorage.putObject/getObject for the bytes.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { partnerTasksStore, partnerFilesStore } from "../partnerWorkspaceStore";
import { putObject, getObject } from "../lib/objectStorage";
import { rawDb } from "../db/connection";
import { registerPartnerTasksFilesRoutes } from "../partnerTasksFilesRoutes";
import express from "express";

/**
 * Enumerate the registered routes. Express 5 exposes the router as
 * `app.router` (Express 4's `app._router` is gone), so read both — a wrong
 * accessor here would silently return [] and turn this whole file into a
 * test that proves nothing.
 */
function routePaths(app: express.Express): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyApp = app as any;
  const stack = anyApp.router?.stack ?? anyApp._router?.stack ?? [];
  if (stack.length === 0) throw new Error("could not read the Express route stack");
  return stack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.route)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .flatMap((l: any) =>
      Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`),
    );
}

const PID = "ac_wave7_tasks_files_partner";
const ACTOR = "u_wave7_actor";

/** Read the row straight out of the table — never the store's RAM projection. */
function taskRowFromDb(id: string): Record<string, unknown> | null {
  try {
    const r = rawDb()
      .prepare(`SELECT id, partner_id, task_json FROM partner_tasks WHERE id = ?`)
      .get(id) as { id: string; partner_id: string; task_json: string } | undefined;
    return r ? { ...r, parsed: JSON.parse(r.task_json) } : null;
  } catch {
    return null;
  }
}

function fileRowFromDb(id: string): Record<string, unknown> | null {
  try {
    const r = rawDb()
      .prepare(`SELECT id, partner_id, file_json FROM partner_files WHERE id = ?`)
      .get(id) as { id: string; partner_id: string; file_json: string } | undefined;
    return r ? { ...r, parsed: JSON.parse(r.file_json) } : null;
  } catch {
    return null;
  }
}

let dbAvailable = false;

beforeAll(() => {
  try {
    rawDb().prepare(`SELECT 1 FROM partner_tasks LIMIT 1`).all();
    rawDb().prepare(`SELECT 1 FROM partner_files LIMIT 1`).all();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

describe("W-8 — partner tasks reach partner_tasks", () => {
  it("registers the tasks routes without throwing (an engine with no route is not shipped)", () => {
    const app = express();
    app.use(express.json());
    expect(() => registerPartnerTasksFilesRoutes(app)).not.toThrow();
    /* Assert the four task paths are actually on the router stack. This is the
       "engine with no route" check: the store existed for months and this is
       exactly what was missing. */
    const paths = routePaths(app);
    expect(paths).toContain("GET /api/partner/me/tasks");
    expect(paths).toContain("POST /api/partner/me/tasks");
    expect(paths).toContain("PATCH /api/partner/me/tasks/:taskId");
    expect(paths).toContain("DELETE /api/partner/me/tasks/:taskId");
  });

  it("create() writes a row to partner_tasks, not just to RAM", () => {
    if (!dbAvailable) return;
    const t = partnerTasksStore.create(PID, { title: "W-8 sink probe" }, ACTOR);
    const row = taskRowFromDb(t.id);
    expect(row, "no partner_tasks row — the write did not reach the sink").not.toBeNull();
    expect((row!.parsed as { title: string }).title).toBe("W-8 sink probe");
    expect(row!.partner_id).toBe(PID);
  });

  it("update() is persisted to the same row (the second write path, not a new one)", () => {
    if (!dbAvailable) return;
    const t = partnerTasksStore.create(PID, { title: "W-8 update probe" }, ACTOR);
    partnerTasksStore.update(PID, t.id, { status: "done" }, ACTOR);
    const row = taskRowFromDb(t.id);
    const parsed = row!.parsed as { status: string; completedAt: string | null };
    expect(parsed.status).toBe("done");
    /* The store stamps completedAt on the done transition; if the DELETE route
       had invented its own writer this would be null. */
    expect(parsed.completedAt).toBeTruthy();
  });

  it("cancel (the DELETE route's semantics) hides the task from the list but keeps the row", () => {
    if (!dbAvailable) return;
    const t = partnerTasksStore.create(PID, { title: "W-8 cancel probe" }, ACTOR);
    partnerTasksStore.update(PID, t.id, { status: "cancelled" }, ACTOR);
    const listed = partnerTasksStore.listByPartner(PID).map((x) => x.id);
    expect(listed).not.toContain(t.id);
    /* Nothing dropped: the row survives for the admin audit read at
       partnerRoutes.ts:546. */
    expect(taskRowFromDb(t.id)).not.toBeNull();
  });
});

describe("W-5 — partner files reach partner_files WITH real bytes", () => {
  it("registers the file routes including the byte read-back", () => {
    const app = express();
    app.use(express.json());
    registerPartnerTasksFilesRoutes(app);
    const paths = routePaths(app);
    expect(paths).toContain("GET /api/partner/me/files");
    expect(paths).toContain("POST /api/partner/me/files");
    expect(paths).toContain("DELETE /api/partner/me/files/:fileId");
    /* The read-back is the whole point of W-5 — a list of names is what the
       defect already was. */
    expect(paths).toContain("GET /api/partner/me/files/:fileId/download");
  });

  it("round-trips real bytes through the SAME objectStorage seam the dataroom uses", async () => {
    const payload = Buffer.from("W-5 real bytes, not a placeholder\n", "utf8");
    const stored = await putObject({
      prefix: "partner-files",
      buffer: payload,
      mimeType: "text/plain",
      originalName: "w5-probe.txt",
    });
    expect(stored.storageKey).toBeTruthy();
    const back = await getObject(stored.storageKey);
    expect(back, "getObject returned nothing — the bytes did not land").not.toBeNull();
    /* Byte-for-byte, so a truncating or re-encoding seam fails here. */
    expect(Buffer.compare(back!, payload)).toBe(0);
  });

  it("add() persists the storage pointer inside file_json (no migration needed)", () => {
    if (!dbAvailable) return;
    const f = partnerFilesStore.add(
      PID,
      {
        dataroomFileId: null,
        fileName: "w5-pointer.txt",
        mimeType: "text/plain",
        sizeBytes: 34,
        scope: "private",
        scopeId: null,
        uploadedBy: ACTOR,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ storageKey: "partner-files/deadbeef.txt", storageBackend: "local", sha256: "abc" } as any),
      } as Parameters<typeof partnerFilesStore.add>[1],
      ACTOR,
    );
    const row = fileRowFromDb(f.id);
    expect(row, "no partner_files row — the write did not reach the sink").not.toBeNull();
    const parsed = row!.parsed as { storageKey?: string; fileName: string };
    /* This is the assertion that proves W-5 needs no migration: the pointer
       survives the JSON round-trip through the existing column. */
    expect(parsed.storageKey).toBe("partner-files/deadbeef.txt");
    expect(parsed.fileName).toBe("w5-pointer.txt");
  });

  it("soft delete tombstones the row rather than removing it", () => {
    if (!dbAvailable) return;
    const f = partnerFilesStore.add(
      PID,
      {
        dataroomFileId: null,
        fileName: "w5-tombstone.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        scope: "private",
        scopeId: null,
        uploadedBy: ACTOR,
      } as Parameters<typeof partnerFilesStore.add>[1],
      ACTOR,
    );
    partnerFilesStore.remove(PID, f.id, ACTOR);
    expect(partnerFilesStore.listByPartner(PID).map((x) => x.id)).not.toContain(f.id);
    expect(partnerFilesStore.getById(PID, f.id)).toBeNull();
    /* Row still there — nothing dropped. */
    expect(fileRowFromDb(f.id)).not.toBeNull();
  });
});

describe("W-5 / W-8 — second-path check", () => {
  it("partnerTasksStore and partnerFilesStore are the only writers to their tables", async () => {
    /* Mechanised so it fails if a future wave adds a second writer behind our
       backs. Reads the server source tree, not a snapshot of it. */
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        if (e === "node_modules" || e === "__tests__" || e === "db") continue;
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) {
          /* Strip comments first: this very wave documents the two sinks in
             prose, and matching a comment would be a false positive. */
          const src = readFileSync(p, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^[ \t]*\/\/.*$/gm, "");
          for (const m of src.matchAll(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(partner_tasks|partner_files)\b/gi)) {
            hits.push(`${p}: ${m[0]}`);
          }
        }
      }
    };
    walk(join(process.cwd(), "server"));
    /* Exactly the two write-through helpers in partnerWorkspaceStore.ts. */
    const files = new Set(hits.map((h) => h.split(":")[0]));
    expect(
      [...files].map((f) => f.replace(process.cwd(), "")),
      `unexpected second writer to partner_tasks/partner_files: ${hits.join(" | ")}`,
    ).toEqual(["/server/partnerWorkspaceStore.ts"]);
  });
});
