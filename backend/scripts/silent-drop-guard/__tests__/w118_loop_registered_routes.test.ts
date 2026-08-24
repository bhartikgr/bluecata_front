/**
 * scripts/silent-drop-guard/__tests__/w118_loop_registered_routes.test.ts
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 118 · FINDING 1 — THE DROP GATE COULD BE BLINDED BY A `for` LOOP.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `extractRoutesFromFile` recognised only `app.get("<string literal>", …)`.
 * Anything whose path came from a variable was canonicalised to one opaque token
 * (`GET <expr:p>`), so a whole family of registrations was invisible to the gate
 * by NAME. Wave 113 legitimately converted two literal registrations in
 * server/dataroomStore.ts into `for (const p of [...]) app.get(p, …)` loops, and
 * `npm run guard` reported:
 *
 *     REMOVED server routes (2):
 *        - GET /api/founder/dataroom/files/:id
 *        - GET /api/founder/dataroom/files/:id/download
 *
 * — two routes that were never removed. That false positive is the SMALL half.
 * The dangerous half is the inverse, and it is what this file exists to close:
 * a developer could DELETE a real route and hide the deletion from the gate by
 * wrapping the survivors in a loop, because every path in the loop collapsed to
 * the same nameless token whether there were three of them or one.
 *
 * ── THE TWO POLES EVERY TEST HERE IS BUILT ON ───────────────────────────────
 * The gate's own rule: a changed scanner must be proved able to catch a fresh
 * drop, and a count only holds when the instrument was validated against a known
 * POSITIVE and a known NEGATIVE.
 *
 *   KNOWN NEGATIVE (must be silent) — a literal registration converted to a loop
 *     over the SAME paths keeps producing the same route ids. Nothing removed,
 *     nothing reported.
 *   KNOWN POSITIVE (must be caught) — deleting one path from that loop's array,
 *     or deleting the loop entirely, makes the id disappear and the gate report
 *     it. This is the case the pre-Wave-118 scanner could not see at all, and
 *     the last test in this file proves that by re-running the same mutation
 *     through the frozen legacy extractor.
 *
 * ── WHY THE RESOLUTION IS STRICTLY ADDITIVE ─────────────────────────────────
 * `resolveRoutePaths` ADDS the concrete paths and still emits the opaque
 * `<expr:…>` token. Two reasons, both about not making the gate lie:
 *   · every id the scanner used to produce is still produced, so no baselined id
 *     can vanish because of a scanner change (a re-baseline is exactly what the
 *     gate forbids); and
 *   · deleting the entire loop still removes the opaque token, so the whole-loop
 *     deletion is caught too.
 *
 * Everything runs against throwaway trees in os.tmpdir(); the production tree,
 * baseline.json and the G-0 snapshot are never written to.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { extractRoutes, resetSourceCache } from "../extract-inventory.ts";
import { extractRoutes as legacyExtractRoutes } from "./legacy/extract-inventory.legacy.ts";

const trees: string[] = [];

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w118-routes-"));
  trees.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }
  return root;
}

function routesOf(files: Record<string, string>): string[] {
  resetSourceCache();
  const out = extractRoutes(tree(files));
  resetSourceCache();
  return out;
}

afterEach(() => {
  while (trees.length) fs.rmSync(trees.pop() as string, { recursive: true, force: true });
  resetSourceCache();
});

const HEADER = `import type { Express } from "express";\nexport function register(app: Express) {\n`;
const FOOTER = `}\n`;
const body = (s: string) => ({ "server/w118.ts": HEADER + s + FOOTER });

/* ═══════════════════════════════════════════════════════ THE SIX FORMS ════ */

describe("W118 · FINDING 1 — route paths that come from an array of string literals", () => {
  it("W118-F1-01 · `for (const p of [\"/a\", \"/b\"])` resolves to BOTH concrete paths", () => {
    const r = routesOf(
      body(`  for (const p of ["/api/founder/dataroom/files/:id", "/api/dataroom/files/:id"]) {\n    app.get(p, (req, res) => res.json({ ok: true }));\n  }\n`),
    );
    expect(r).toContain("GET /api/founder/dataroom/files/:id");
    expect(r).toContain("GET /api/dataroom/files/:id");
  });

  it("W118-F1-02 · the opaque `<expr:…>` token is STILL emitted — the resolution is additive", () => {
    const r = routesOf(body(`  for (const p of ["/api/x", "/api/y"]) {\n    app.post(p, (req, res) => res.json({}));\n  }\n`));
    expect(r).toContain("POST /api/x");
    expect(r).toContain("POST /api/y");
    /* If this ever stops being true, a scanner change alone can make a baselined
       id disappear and manufacture a false removal. That is the mistake this
       wave nearly made. */
    expect(r).toContain("POST <expr:p>");
  });

  it("W118-F1-03 · `as const`, a NAMED const array and `.forEach` all resolve too", () => {
    const asConst = routesOf(body(`  for (const p of ["/api/ac1", "/api/ac2"] as const) {\n    app.put(p, (req, res) => res.json({}));\n  }\n`));
    expect(asConst).toContain("PUT /api/ac1");
    expect(asConst).toContain("PUT /api/ac2");

    const named = routesOf({
      "server/w118.ts": `import type { Express } from "express";\nconst PATHS = ["/api/n1", "/api/n2"];\nexport function register(app: Express) {\n  for (const p of PATHS) {\n    app.delete(p, (req, res) => res.json({}));\n  }\n}\n`,
    });
    expect(named).toContain("DELETE /api/n1");
    expect(named).toContain("DELETE /api/n2");

    const forEach = routesOf(body(`  ["/api/fe1", "/api/fe2"].forEach((p) => {\n    app.get(p, (req, res) => res.json({}));\n  });\n`));
    expect(forEach).toContain("GET /api/fe1");
    expect(forEach).toContain("GET /api/fe2");
  });

  it("W118-F1-04 · an array passed DIRECTLY to app.get, and a template literal over a loop variable", () => {
    const arrayArg = routesOf(body(`  app.get(["/api/aa1", "/api/aa2"], (req, res) => res.json({}));\n`));
    expect(arrayArg).toContain("GET /api/aa1");
    expect(arrayArg).toContain("GET /api/aa2");

    const tpl = routesOf(body(`  for (const op of ["pin", "unpin"]) {\n    app.post(\`/api/collective/announcements/:id/\${op}\`, (req, res) => res.json({}));\n  }\n`));
    expect(tpl).toContain("POST /api/collective/announcements/:id/pin");
    expect(tpl).toContain("POST /api/collective/announcements/:id/unpin");
  });
});

/* ══════════════════════════════════════════ NEGATIVE CONTROL (SILENCE) ════ */

describe("W118 · FINDING 1 — KNOWN NEGATIVE: converting literals to a loop changes NOTHING", () => {
  it("W118-F1-05 · the loop form produces every id the literal form produced", () => {
    const literal = routesOf(
      body(`  app.get("/api/founder/dataroom/files/:id", (req, res) => res.json({}));\n  app.get("/api/founder/dataroom/files/:id/download", (req, res) => res.json({}));\n`),
    );
    const looped = routesOf(
      body(`  for (const p of ["/api/founder/dataroom/files/:id", "/api/dataroom/files/:id"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n  for (const p of ["/api/founder/dataroom/files/:id/download", "/api/dataroom/files/:id/download"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n`),
    );
    /* Nothing the literal form declared is missing from the loop form: that is
       precisely the false positive `npm run guard` was reporting. */
    const missing = literal.filter((id) => !looped.includes(id));
    expect(missing).toEqual([]);
  });
});

/* ═════════════════════════════════════════ KNOWN POSITIVE (MUST CATCH) ════ */

describe("W118 · FINDING 1 — KNOWN POSITIVE: a real removal inside a loop is still visible", () => {
  const LOOP_OF_THREE = `  for (const p of ["/api/keep/one", "/api/keep/two", "/api/drop/me"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n`;

  it("W118-F1-06 · dropping ONE path from the array removes exactly that id", () => {
    const before = routesOf(body(LOOP_OF_THREE));
    const after = routesOf(body(`  for (const p of ["/api/keep/one", "/api/keep/two"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n`));
    expect(before).toContain("GET /api/drop/me");
    expect(after).not.toContain("GET /api/drop/me");
    /* And the survivors are untouched, so the gate reports the loss and nothing
       else — a report full of noise is a report nobody reads. */
    expect(before.filter((id) => !after.includes(id))).toEqual(["GET /api/drop/me"]);
  });

  it("W118-F1-07 · deleting a LITERAL registration is still caught (the gate's original power is intact)", () => {
    const before = routesOf(body(`  app.get("/api/literal/kept", (req, res) => res.json({}));\n  app.get("/api/literal/dropped", (req, res) => res.json({}));\n`));
    const after = routesOf(body(`  app.get("/api/literal/kept", (req, res) => res.json({}));\n`));
    expect(before.filter((id) => !after.includes(id))).toEqual(["GET /api/literal/dropped"]);
  });

  it("W118-F1-08 · deleting the WHOLE loop removes the concrete ids AND the opaque token", () => {
    const before = routesOf(body(LOOP_OF_THREE));
    const after = routesOf(body(`  app.get("/api/unrelated", (req, res) => res.json({}));\n`));
    const lost = before.filter((id) => !after.includes(id));
    expect(lost).toContain("GET /api/keep/one");
    expect(lost).toContain("GET /api/keep/two");
    expect(lost).toContain("GET /api/drop/me");
    expect(lost).toContain("GET <expr:p>");
  });
});

/* ══════════════════════════════════ THE BLINDNESS, REPRODUCED AND FIXED ════ */

describe("W118 · FINDING 1 — the pre-Wave-118 scanner could not see any of it", () => {
  it("W118-F1-09 · UNFIXED vs FIXED on the SAME mutation: the legacy extractor reports no loss, the current one does", () => {
    const withDrop = { "server/w118.ts": HEADER + `  for (const p of ["/api/keep/one", "/api/keep/two"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n` + FOOTER };
    const withoutDrop = { "server/w118.ts": HEADER + `  for (const p of ["/api/keep/one", "/api/keep/two", "/api/drop/me"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n` + FOOTER };

    const rootA = tree(withoutDrop);
    const rootB = tree(withDrop);

    /* UNFIXED — the frozen pre-G-1 extractor, which shares the literal-only
       route scanner this wave replaced. Both trees produce the SAME set, so a
       real route deletion is INDISTINGUISHABLE from no change. */
    const legacyBefore = legacyExtractRoutes(rootA);
    const legacyAfter = legacyExtractRoutes(rootB);
    expect(legacyBefore).toEqual(legacyAfter);
    expect(legacyBefore).not.toContain("GET /api/drop/me");

    /* FIXED — the current extractor names the dropped route. */
    resetSourceCache();
    const before = extractRoutes(rootA);
    resetSourceCache();
    const after = extractRoutes(rootB);
    resetSourceCache();
    expect(before).toContain("GET /api/drop/me");
    expect(before.filter((id) => !after.includes(id))).toEqual(["GET /api/drop/me"]);
  });
});

/* ═══════════════════════════════════════ CONSERVATISM (NO GUESSING) ═══════ */

describe("W118 · FINDING 1 — the resolver refuses to guess", () => {
  it("W118-F1-10 · a computed / non-literal path is still only the opaque token, never an invented id", () => {
    const r = routesOf({
      "server/w118.ts": `import type { Express } from "express";\nconst BASE = process.env.BASE ?? "/api";\nexport function register(app: Express) {\n  for (const p of [BASE + "/a", \`\${BASE}/b\`]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n}\n`,
    });
    expect(r).toContain("GET <expr:p>");
    /* No half-resolved rubbish: an id the scanner cannot prove is not emitted,
       because a wrong id in the inventory becomes a permanent false removal the
       first time someone touches the file. */
    expect(r.filter((id) => id.includes("undefined") || id.includes("${"))).toEqual([]);
    expect(r.some((id) => id === "GET /api/a" || id === "GET /api/b")).toBe(false);
  });
});
