/**
 * W-FIX4 item 9-N1 — best-effort → audit emission (observability-only).
 *
 * Three previously-silent best-effort catches now emit a `log.warn` so the miss
 * is auditable, WITHOUT re-throwing or changing control flow / money outcomes:
 *   - server/captableCommitStore.ts   hydrateComplianceHolds()  (~L151)   [SACRED]
 *   - server/captableCommitStore.ts   wire-funded status advance (~L1049) [SACRED]
 *   - server/captableSnapshotsStore.ts round-name resolution     (~L192)  [not sacred]
 *
 * This test enforces the contract as a code artifact:
 *   (1) each catch now carries a log.warn emission (observability added);
 *   (2) no `throw` was introduced into those catch bodies (control flow intact);
 *   (3) the sacred re-baseline is self-consistent — the recorded SHA for
 *       captableCommitStore.ts matches the file's actual SHA, and the whole
 *       sacred manifest still verifies 40/40.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(__dirname, "..", "..");
const COMMIT_STORE = path.join(ROOT, "server", "captableCommitStore.ts");
const SNAPSHOTS_STORE = path.join(ROOT, "server", "captableSnapshotsStore.ts");
const SACRED_MANIFEST = path.join(ROOT, "sacred_baseline", "SACRED_SHA256.txt");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function sha256(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

describe("W-FIX4 item 9-N1 — best-effort catches emit audit warnings", () => {
  it("captableCommitStore hydrateComplianceHolds catch now warns (was silent)", () => {
    const src = read(COMMIT_STORE);
    expect(src).toContain("[captableCommitStore.hydrateComplianceHolds] best-effort hydrate skipped");
    // The old fully-silent form must be gone.
    expect(src).not.toContain("} catch { /* sandbox / postgres — best effort */ }");
  });

  it("captableCommitStore wire-funded status advance catch now warns (was silent)", () => {
    const src = read(COMMIT_STORE);
    expect(src).toContain('soft-circle status advance to "wired" failed');
    expect(src).not.toContain('updateSoftCircleStatus(scId, "wired"); } catch { /* best-effort */ }');
  });

  it("captableSnapshotsStore round-name resolution catch now warns (was silent)", () => {
    const src = read(SNAPSHOTS_STORE);
    expect(src).toContain("round name resolution failed for");
    expect(src).not.toContain("} catch { /* name best-effort */ }");
  });

  it("no re-throw was introduced — the emissions are observability-only", () => {
    // Each new warning line is followed by nothing that re-raises. Assert none of
    // the three audit lines sit next to a `throw`.
    for (const [file, needle] of [
      [COMMIT_STORE, "[captableCommitStore.hydrateComplianceHolds] best-effort hydrate skipped"],
      [COMMIT_STORE, 'soft-circle status advance to "wired" failed'],
      [SNAPSHOTS_STORE, "round name resolution failed for"],
    ] as const) {
      const lines = read(file).split("\n");
      const idx = lines.findIndex((l) => l.includes(needle));
      expect(idx).toBeGreaterThan(-1);
      const window = lines.slice(idx, idx + 3).join("\n");
      expect(window).not.toMatch(/\bthrow\b/);
    }
  });

  it("sacred re-baseline is self-consistent (recorded SHA == actual) and manifest is 40 entries", () => {
    const manifest = read(SACRED_MANIFEST).trim().split("\n").filter(Boolean);
    expect(manifest.length).toBe(40);

    const recorded = manifest.find((l) => l.includes("server/captableCommitStore.ts"));
    expect(recorded).toBeTruthy();
    const recordedSha = recorded!.split(/\s+/)[0];
    expect(recordedSha).toBe(sha256(COMMIT_STORE));

    // Every recorded entry must match its file on disk (40/40 OK).
    for (const line of manifest) {
      const [sha, rel] = line.split(/\s+/);
      expect(sha256(path.join(ROOT, rel))).toBe(sha);
    }
  });
});
