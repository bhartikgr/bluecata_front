/**
 * Wave E Fix E11 — Toast `description` fields no longer leak raw err.message.
 *
 * Previously 9 sites surfaced raw exception text (often unfriendly like
 * "Network request failed (status 500)") directly to users via toast.
 * Replaced with a generic friendly message. The technical err is still
 * available to dev tools via the underlying error object.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      walk(full, out);
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("Wave E E11 — friendly toast error messages", () => {
  it("no client file uses `description: err.message` or `description: error.message`", () => {
    const files = walk(path.join(ROOT, "client", "src"));
    const offenders: string[] = [];
    const pat = /description:\s*(err|error)\.message/;
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      if (pat.test(src)) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders, `Sites still leaking raw error: ${offenders.join(", ")}`).toEqual([]);
  });
});
