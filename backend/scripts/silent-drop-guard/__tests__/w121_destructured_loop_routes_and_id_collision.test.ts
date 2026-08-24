/**
 * scripts/silent-drop-guard/__tests__/w121_destructured_loop_routes_and_id_collision.test.ts
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 121 · FINDING 1 — A SEVENTH LOOP FORM THE DROP GATE COULD NOT SEE, AND AN
 * ID COLLISION THAT KEPT THE BLIND SPOT ALIVE.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 * WAVE 118 taught `resolveRoutePaths` six forms of loop-registered route. A
 * SEVENTH exists in application source today — an array-DESTRUCTURING loop
 * binding — and it registers three live investor endpoints:
 *
 *     for (const [path, action] of [
 *       ["/api/investor/invitations/:id/accept",      "accept"],
 *       ["/api/investor/invitations/:id/decline",     "decline"],
 *       ["/api/investor/invitations/:id/soft-circle", "soft_circle"],
 *     ] as const) { app.post(path, requireAuth, …) }
 *
 * `loopLiteralValues` required `ts.isIdentifier(d.name)`, so this fell through to
 * the opaque token `POST <expr:path>` — and a DIFFERENT, resolvable loop twenty
 * lines above binds a variable named `path` too, so that token was kept alive by
 * the other loop. Reviewer A deleted decline + soft-circle, then all three, and
 * measured `before=1185 after=1185, REMOVED [], identical true`. The endpoints an
 * investor uses to respond to a round could be deleted in silence.
 *
 * ── THE PROJECT'S HARD RULE, WHICH THIS FILE EXISTS TO SATISFY ───────────────
 * A CHANGED GATE MUST BE PROVED STILL ABLE TO CATCH A FRESH DROP. A count only
 * holds when the instrument was validated against known POSITIVES and a known
 * NEGATIVE. So below, in order:
 *   · the destructured loop's three paths are each named in the inventory
 *     (and named in the REAL tree, not only in a fixture);
 *   · KNOWN POSITIVE 1 — deleting ONE of those three investor endpoints is
 *     reported, by name;
 *   · KNOWN POSITIVE 2 — deleting a LITERAL registration is still reported;
 *   · KNOWN POSITIVE 3 — deleting a registration inside a plain `for…of` loop is
 *     still reported;
 *   · COLLISION — two UNRESOLVABLE registrations sharing a variable name now
 *     produce two DISTINCT ids, and deleting one of them is reported;
 *   · KNOWN NEGATIVE — the clean tree reports nothing removed.
 *
 * Everything runs against throwaway trees in os.tmpdir(). The production tree,
 * `baseline.json` and the G-0 snapshot are never written to.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { extractRoutes, resetSourceCache } from "../extract-inventory.ts";

const trees: string[] = [];
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function tree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "w121-routes-"));
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

/** baseline − current: exactly what the guard means by "disappeared". */
function lost(before: string[], after: string[]): string[] {
  return before.filter((id) => !after.includes(id));
}

afterEach(() => {
  while (trees.length) fs.rmSync(trees.pop() as string, { recursive: true, force: true });
  resetSourceCache();
});

const HEADER = `import type { Express } from "express";\nexport function register(app: Express) {\n`;
const FOOTER = `}\n`;
const body = (s: string) => ({ "server/w121.ts": HEADER + s + FOOTER });

/** The shape that is in `server/routes.ts` today, reproduced verbatim. */
const INVESTOR_TUPLES = (paths: Array<[string, string]>) =>
  `  for (const [path, action] of [\n` +
  paths.map(([p, a]) => `    ["${p}", "${a}"],\n`).join("") +
  `  ] as const) {\n    app.post(path, requireAuth, async (req, res) => res.json({ ok: true, action }));\n  }\n`;

const ALL_THREE: Array<[string, string]> = [
  ["/api/investor/invitations/:id/accept", "accept"],
  ["/api/investor/invitations/:id/decline", "decline"],
  ["/api/investor/invitations/:id/soft-circle", "soft_circle"],
];

/* ═══════════════════════════ THE SEVENTH FORM IS NOW RESOLVED ═════════════ */

describe("W121 · FINDING 1 — the destructuring loop binding (the SEVENTH form)", () => {
  it("W121-F1-01 · each path of `for (const [path, action] of [[…],[…]] as const)` gets its own concrete id", () => {
    const r = routesOf(body(INVESTOR_TUPLES(ALL_THREE)));
    expect(r).toContain("POST /api/investor/invitations/:id/accept");
    expect(r).toContain("POST /api/investor/invitations/:id/decline");
    expect(r).toContain("POST /api/investor/invitations/:id/soft-circle");
    /* Still additive: the bare opaque token WAVE 118 promised never to remove is
       unchanged, so no baselined id can vanish because of a scanner change. */
    expect(r).toContain("POST <expr:path>");
  });

  it("W121-F1-02 · the object-destructuring and `.forEach` destructuring variants resolve too", () => {
    const obj = routesOf(
      body(
        `  for (const { path, action } of [{ path: "/api/o1", action: "a" }, { path: "/api/o2", action: "b" }]) {\n    app.put(path, (req, res) => res.json({ action }));\n  }\n`,
      ),
    );
    expect(obj).toContain("PUT /api/o1");
    expect(obj).toContain("PUT /api/o2");

    const fe = routesOf(
      body(
        `  [["/api/f1", "a"], ["/api/f2", "b"]].forEach(([p, act]) => {\n    app.delete(p, (req, res) => res.json({ act }));\n  });\n`,
      ),
    );
    expect(fe).toContain("DELETE /api/f1");
    expect(fe).toContain("DELETE /api/f2");
  });

  it("W121-F1-03 · the resolver still refuses to guess: a non-literal cell resolves to NOTHING concrete", () => {
    const r = routesOf(
      body(
        `  const BASE = process.env.BASE ?? "/api";\n  for (const [p, act] of [[BASE + "/x", "a"], ["/api/y", "b"]] as const) {\n    app.get(p, (req, res) => res.json({ act }));\n  }\n`,
      ),
    );
    expect(r).toContain("GET <expr:p>");
    /* Half-resolution would be worse than none: a wrong id becomes a permanent
       false removal the first time anyone touches the file. */
    expect(r.some((id) => id === "GET /api/y" || id === "GET /api/x")).toBe(false);
    expect(r.filter((id) => id.includes("undefined") || id.includes("${"))).toEqual([]);
  });

  it("W121-F1-04 · the REAL tree names all three investor endpoints individually", () => {
    resetSourceCache();
    const r = extractRoutes(REPO_ROOT);
    resetSourceCache();
    for (const [p] of ALL_THREE) expect(r).toContain(`POST ${p}`);
  });
});

/* ══════════════════════════════ KNOWN POSITIVES (MUST CATCH) ══════════════ */

describe("W121 · FINDING 1 — KNOWN POSITIVE: a fresh drop is still caught, and named", () => {
  it("W121-F1-05 · deleting ONE of the three investor endpoints is reported by name", () => {
    const before = routesOf(body(INVESTOR_TUPLES(ALL_THREE)));
    const after = routesOf(
      body(INVESTOR_TUPLES(ALL_THREE.filter(([p]) => !p.endsWith("/decline")))),
    );
    expect(lost(before, after)).toEqual(["POST /api/investor/invitations/:id/decline"]);
  });

  it("W121-F1-06 · deleting ALL THREE is reported as three named losses (Reviewer A's mutation 2)", () => {
    const before = routesOf(body(INVESTOR_TUPLES(ALL_THREE)));
    const after = routesOf(body(`  app.post("/api/unrelated", (req, res) => res.json({}));\n`));
    const gone = lost(before, after);
    for (const [p] of ALL_THREE) expect(gone).toContain(`POST ${p}`);
    /* The whole-loop deletion also removes the opaque token and its
       collision-proof companion, so the loop's disappearance is itself named. */
    expect(gone).toContain("POST <expr:path>");
    expect(gone.some((id) => /^POST <expr:path @server\/w121\.ts#[0-9a-f]{12}>$/.test(id))).toBe(true);
  });

  it("W121-F1-07 · deleting a LITERAL registration is still caught (the gate's original power)", () => {
    const before = routesOf(
      body(
        `  app.get("/api/literal/kept", (req, res) => res.json({}));\n  app.get("/api/literal/dropped", (req, res) => res.json({}));\n`,
      ),
    );
    const after = routesOf(body(`  app.get("/api/literal/kept", (req, res) => res.json({}));\n`));
    expect(lost(before, after)).toEqual(["GET /api/literal/dropped"]);
  });

  it("W121-F1-08 · deleting a registration inside a plain `for…of` loop is still caught (WAVE 118's forms hold)", () => {
    const before = routesOf(
      body(
        `  for (const p of ["/api/keep/one", "/api/keep/two", "/api/drop/me"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n`,
      ),
    );
    const after = routesOf(
      body(`  for (const p of ["/api/keep/one", "/api/keep/two"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n`),
    );
    /* Exactly one loss, and no churn: the collision-proof id of a RESOLVABLE
       registration deliberately does not depend on the array's contents, because
       the concrete paths already carry that signal. A report full of noise is a
       report nobody reads. */
    expect(lost(before, after)).toEqual(["GET /api/drop/me"]);
  });
});

/* ═════════════════════════════════ THE COLLISION IS GONE ══════════════════ */

describe("W121 · FINDING 1 — two unresolvable registrations can no longer share an id", () => {
  const TWO_UNRESOLVABLE =
    `  const A = process.env.A ?? "/api/a";\n` +
    `  const B = process.env.B ?? "/api/b";\n` +
    `  for (const path of computeA(A)) {\n    app.post(path, (req, res) => res.json({ n: 1 }));\n  }\n` +
    `  for (const path of computeB(B)) {\n    app.post(path, (req, res) => res.json({ n: 2 }));\n  }\n`;

  it("W121-F1-09 · same variable name, same method, one file → TWO distinct ids", () => {
    const r = routesOf(body(TWO_UNRESOLVABLE));
    /* Before this wave both registrations produced only `POST <expr:path>` — one
       id for two routes, so one route's presence masked the other's absence. */
    const bare = r.filter((id) => id === "POST <expr:path>");
    expect(bare.length).toBe(1);
    const unique = r.filter((id) => /^POST <expr:path @server\/w121\.ts#[0-9a-f]{12}>$/.test(id));
    expect(unique.length).toBe(2);
    expect(new Set(unique).size).toBe(2);
  });

  it("W121-F1-10 · deleting ONE of the two colliding registrations is now reported", () => {
    const before = routesOf(body(TWO_UNRESOLVABLE));
    const after = routesOf(
      body(
        `  const A = process.env.A ?? "/api/a";\n  const B = process.env.B ?? "/api/b";\n` +
          `  for (const path of computeA(A)) {\n    app.post(path, (req, res) => res.json({ n: 1 }));\n  }\n`,
      ),
    );
    const gone = lost(before, after);
    /* The bare token survives (the first loop still emits it) — that is exactly
       the masking Reviewer A exploited. The collision-proof id does not. */
    expect(after).toContain("POST <expr:path>");
    expect(gone.length).toBe(1);
    expect(gone[0]).toMatch(/^POST <expr:path @server\/w121\.ts#[0-9a-f]{12}>$/);
  });

  it("W121-F1-11 · every unreadable registration in the REAL tree has a one-to-one id", () => {
    resetSourceCache();
    const r = extractRoutes(REPO_ROOT);
    resetSourceCache();
    const unique = r.filter((id) => / @[^#]+#[0-9a-f]{12}>$/.test(id));
    expect(unique.length).toBeGreaterThan(0);
    expect(new Set(unique).size).toBe(unique.length);
    /* And the two `POST <expr:path>` registrations in server/routes.ts — the
       collision Reviewer A measured — are two ids now. */
    const paths = unique.filter((id) => id.startsWith("POST <expr:path @server/routes.ts#"));
    expect(paths.length).toBe(2);
  });
});

/* ══════════════════════════════ KNOWN NEGATIVE (SILENCE) ══════════════════ */

describe("W121 · FINDING 1 — KNOWN NEGATIVE: an unchanged tree loses nothing", () => {
  it("W121-F1-12 · the same tree scanned twice reports no loss, and the scan is deterministic", () => {
    const files = body(INVESTOR_TUPLES(ALL_THREE) + TWO_LOOPS);
    const a = routesOf(files);
    const b = routesOf(files);
    expect(lost(a, b)).toEqual([]);
    expect(a).toEqual(b);
  });

  it("W121-F1-13 · rewriting a handler body — not a registration — loses nothing", () => {
    const before = routesOf(body(INVESTOR_TUPLES(ALL_THREE)));
    const after = routesOf({
      "server/w121.ts":
        HEADER +
        `  for (const [path, action] of [\n` +
        ALL_THREE.map(([p, a]) => `    ["${p}", "${a}"],\n`).join("") +
        `  ] as const) {\n    app.post(path, requireAuth, async (req, res) => {\n      const extra = await somethingElse(action);\n      return res.json({ ok: true, action, extra });\n    });\n  }\n` +
        FOOTER,
    });
    expect(lost(before, after)).toEqual([]);
  });
});

const TWO_LOOPS =
  `  for (const p of ["/api/keep/one", "/api/keep/two"]) {\n    app.get(p, (req, res) => res.json({}));\n  }\n`;
