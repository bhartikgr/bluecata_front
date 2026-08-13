/**
 * WAVE 7 — guard-fingerprint stability for handlers this wave rewrote.
 *
 * WHY THIS EXISTS. The silent-drop guard fingerprints an event handler by the
 * TEXT of its expression, not by the control it is attached to. W-5 replaced
 * the bodies behind PartnerFiles' Register and View controls (metadata-only
 * POST → real multipart bytes; a never-existent `/url` endpoint → a real
 * download). Passing new arguments through those handlers changed the
 * expression text, and the guard correctly read the OLD handlers as removed:
 *
 *   REMOVED event handlers (2):
 *     client/src/pages/partner/PartnerFiles.tsx | Button | onClick | expr:6398faaffe14
 *     client/src/pages/partner/PartnerFiles.tsx | button | onClick | expr:53b20e08847d
 *
 * The fix was NOT to allow-list them. Both controls still exist and still do
 * the same job, so the honest resolution is to keep the expressions identical
 * and move the new inputs behind them (a ref for the picked File, a lookup for
 * the file name). This test pins that, comparing against the read-only G-0
 * snapshot so it cannot rot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REL = "client/src/pages/partner/PartnerFiles.tsx";
const LIVE = readFileSync(join(ROOT, REL), "utf8");
const SNAP_PATH = join(ROOT, ".g0-snapshot", REL);

/** Strip block and line comments so prose quoting a handler cannot fake a match. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every `onClick={...}` expression in a file, comments removed. */
function onClickExprs(src: string): string[] {
  return [...stripComments(src).matchAll(/onClick=\{([^\n]*)\}\s*$/gm)].map((m) => m[1].trim());
}

describe("W-5 — PartnerFiles handlers were rebuilt WITHOUT dropping their fingerprints", () => {
  it("the G-0 snapshot is present, so this test is comparing to something real", () => {
    expect(existsSync(SNAP_PATH), "no .g0-snapshot copy — cannot prove stability").toBe(true);
  });

  it("every onClick expression in the snapshot still exists in the live file", () => {
    const before = new Set(onClickExprs(readFileSync(SNAP_PATH, "utf8")));
    const after = new Set(onClickExprs(LIVE));
    const dropped = [...before].filter((e) => !after.has(e));
    expect(
      dropped,
      `these handler expressions vanished and the guard will block on them: ${JSON.stringify(dropped)}`,
    ).toEqual([]);
  });

  it("the two specific handlers the guard flagged are byte-identical", () => {
    const snap = readFileSync(SNAP_PATH, "utf8");
    for (const line of [
      "            onClick={() => upload.mutate(name)}",
      "                  onClick={() => viewFile(f.id)}",
      "            disabled={!name.trim() || upload.isPending}",
    ]) {
      expect(snap, `snapshot no longer contains: ${line.trim()}`).toContain(line);
      expect(LIVE, `live file no longer contains: ${line.trim()}`).toContain(line);
    }
  });

  it("…and they are stable WITHOUT reverting the behaviour: real bytes still go out", () => {
    const body = stripComments(LIVE);
    /* the ref, not the mutation argument, is what carries the File */
    expect(body).toContain("pickedRef.current");
    expect(body).toMatch(/new FormData\(\)/);
    expect(body).toMatch(/fd\.append\("file", file\)/);
    /* fail-closed: no File means no request at all */
    expect(body).toMatch(/if \(!file\)/);
    /* the metadata-only shape that DEF-056 named must not come back */
    expect(body).not.toContain("sizeBytes: 0");
    /* and the phantom endpoint must stay gone */
    expect(body).not.toContain("/url`");
  });

  it("no widget was removed either — every data-testid in the snapshot survives", () => {
    const ids = (src: string) =>
      new Set([...src.matchAll(/data-testid=[{"]?[`"]([^`"]+)[`"]/g)].map((m) => m[1]));
    const before = ids(readFileSync(SNAP_PATH, "utf8"));
    const after = ids(LIVE);
    const gone = [...before].filter((i) => !after.has(i));
    expect(gone, `widgets dropped from PartnerFiles: ${JSON.stringify(gone)}`).toEqual([]);
  });

  it("the display-name input is not decorative — the server honours it", () => {
    const route = readFileSync(join(ROOT, "server/partnerTasksFilesRoutes.ts"), "utf8");
    expect(stripComments(LIVE)).toContain('fd.append("fileName"');
    expect(stripComments(route)).toContain("(req.body ?? {}).fileName");
  });
});
