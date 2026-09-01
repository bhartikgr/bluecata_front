/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 240 — THE FABRICATING ROUTE NO LONGER MANUFACTURES DURABLE EVIDENCE,
 * AND THE SERVICE-LEVEL TILE IT FED NO LONGER MOVES WHEN IT IS CALLED.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `POST /api/admin/reconciliation/run`
 * (`server/adminPlatformStore.ts:3503`) invokes NEITHER cap-table engine. It
 * builds a literal:
 *
 *     engineMain: { totalShares: "12500000", ownership: 1.0 },
 *     engineRef:  { totalShares: "12500000", ownership: 1.0 },
 *     diff: { sharesDelta: "0", ownershipDelta: 0, ok: true },
 *
 * and, before this wave, INSERTED it into the durable `recon_runs` table. That
 * matters because `computeReconHealth()` (`server/adminPlatformStore.ts:1862`)
 * counts exactly those rows —
 * `SELECT COUNT(*) … WHERE INSTR(diff_json, '"ok":true') > 0` over the same
 * table — to produce `health.capTableReconcile.successRatePct`, which the admin
 * dashboard renders as "Reconcile success" beneath a hardcoded green shield.
 * So one call to a route that compares nothing turned the platform's
 * cap-table-integrity SLO green. That is R220.4's standing finding
 * ("the reconciliation route fabricates its result and feeds the service-level
 * tile") as a closed code path.
 *
 * WHAT THIS WAVE DID, AND DID NOT DO. It removed the INSERT and nothing else.
 * R220.4 forbids WIRING this route to anything until it is fixed; no engine,
 * scheduler or loader is connected here. The route keeps its path, method, 400
 * and 401 branches, response body and 200 status — §3 proves that, because a
 * fix that quietly broke an admin endpoint would be its own defect. Nothing in
 * `recon_runs` is deleted: this wave contains no DELETE, no UPDATE and no
 * migration.
 *
 * WHY §4 EXISTS — THE ANTI-INERT CLAUSE. §2 asserts a row count that does NOT
 * rise. An assertion that a number stays the same is satisfied by a fixture no
 * server mutation could ever move (inert-proof mechanism 3), so it proves
 * nothing on its own. §4 therefore inserts a row into `recon_runs` DIRECTLY and
 * proves the reader still sees it and still turns the tile's figure into 100 —
 * i.e. the table is live, the query works, and the ONLY reason §2's count and
 * §3's percentage do not move is that the route stopped writing.
 *
 * Driven over real HTTP against the production registrar (`registerRoutes`),
 * never a hand-built router: §8 of ENGINEERING_NOTES, "never prove a replica".
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

const ADMIN = { "x-user-id": "u_admin" };

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      {
        host: "127.0.0.1", port, path, method,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
          ...(headers ?? {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function reconRowCount(): number {
  const row = rawDb().prepare(`SELECT COUNT(*) AS n FROM recon_runs WHERE deleted_at IS NULL`).get() as { n: number };
  return Number(row?.n ?? 0);
}

function reconRowIds(): string[] {
  return (rawDb().prepare(`SELECT id FROM recon_runs`).all() as { id: string }[]).map((r) => r.id);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 120_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("W240 §1 — the route still answers exactly as it did", () => {
  it("400s without companyId/roundId", async () => {
    const res = await req("POST", "/api/admin/reconciliation/run", {}, ADMIN);
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("companyId_and_roundId_required");
  });

  it("refuses an unidentified caller — and it is the ROUTE GUARD that refuses, with 403, not the handler's own 401", async () => {
    /* FOUND BY RUNNING THIS, NOT BY READING IT. I first asserted 401 with
       `error: "missing_identity"`, because that is the branch written into the
       handler at server/adminPlatformStore.ts:3507. Over the production
       registrar the real answer is **403**: the route guard rejects first, so
       the handler's own 401 branch is UNREACHABLE in production. Recorded rather
       than smoothed over — it is a small instance of the platform's most
       repeated failure (proving a replica: a hand-mounted router would have
       returned 401 and I would have believed my own reading of the file). This
       wave does not change either branch. */
    const res = await req("POST", "/api/admin/reconciliation/run", { companyId: "co_w240", roundId: "rnd_w240" });
    expect(res.status).toBe(403);
  });

  it("200s for an admin and STILL returns the fabricated body — this wave did not pretend to fix the fabrication", async () => {
    const res = await req("POST", "/api/admin/reconciliation/run", { companyId: "co_w240", roundId: "rnd_w240" }, ADMIN);
    expect(res.status).toBe(200);
    /* Recorded deliberately. The response is still manufactured; only the
       DURABLE write is stopped. Asserting otherwise would claim a fix this
       wave did not make. */
    expect(res.body?.diff?.ok).toBe(true);
    expect(res.body?.engineMain?.totalShares).toBe("12500000");
    expect(String(res.body?.id ?? "")).toMatch(/^rec_/);
  });
});

describe("W240 §2 — no fabricated row reaches the durable table", () => {
  it("a POST does not add a recon_runs row, and its id is nowhere in the table", async () => {
    const before = reconRowCount();
    const res = await req("POST", "/api/admin/reconciliation/run", { companyId: "co_w240_b", roundId: "rnd_w240_b" }, ADMIN);
    expect(res.status).toBe(200);
    const id = String(res.body.id);
    expect(reconRowCount()).toBe(before);
    expect(reconRowIds()).not.toContain(id);
  });

  it("ten POSTs still add nothing — the write is stopped, not merely deduplicated", async () => {
    const before = reconRowCount();
    for (let i = 0; i < 10; i++) {
      const res = await req("POST", "/api/admin/reconciliation/run", { companyId: `co_w240_${i}`, roundId: `rnd_w240_${i}` }, ADMIN);
      expect(res.status).toBe(200);
    }
    expect(reconRowCount()).toBe(before);
  });
});

describe("W240 §3 — the service-level tile's figure no longer moves when the route is called", () => {
  it("successRatePct stays null across a POST, so the dashboard keeps saying 'not reported'", async () => {
    /* Pre-wave, this POST inserted one `"ok":true` row, so runs=1, success=1,
       successRatePct=100 — and the tile rendered 100.00% under a green shield.
       The table starts empty in this tree (measured: 0 rows). */
    const kpiBefore = await req("GET", "/api/admin/dashboard/kpis", undefined, ADMIN);
    expect(kpiBefore.status).toBe(200);
    expect(kpiBefore.body?.health?.capTableReconcile?.successRatePct).toBeNull();

    const res = await req("POST", "/api/admin/reconciliation/run", { companyId: "co_w240_tile", roundId: "rnd_w240_tile" }, ADMIN);
    expect(res.status).toBe(200);

    const kpiAfter = await req("GET", "/api/admin/dashboard/kpis", undefined, ADMIN);
    expect(kpiAfter.status).toBe(200);
    expect(kpiAfter.body?.health?.capTableReconcile?.successRatePct).toBeNull();
    expect(kpiAfter.body?.health?.capTableReconcile?.runs).toBe(0);
  });

  it("the in-memory mirror is untouched — GET /runs still serves the run, so nothing was restricted", async () => {
    const res = await req("POST", "/api/admin/reconciliation/run", { companyId: "co_w240_mirror", roundId: "rnd_w240_mirror" }, ADMIN);
    expect(res.status).toBe(200);
    const listed = await req("GET", "/api/admin/reconciliation/runs", undefined, ADMIN);
    expect(listed.status).toBe(200);
    expect((listed.body?.items ?? []).map((r: any) => r.id)).toContain(String(res.body.id));
  });
});

describe("W240 §4 — ANTI-INERT: the fixture the assertions above rely on IS movable", () => {
  it("a row inserted directly into recon_runs DOES move runs and successRatePct to 100", async () => {
    /* Without this test, §2 and §3 would be satisfied by a table nothing can
       write and a query that never returns anything — inert-proof mechanism 3.
       This proves the reader is live and the ONLY reason §2/§3 hold is that the
       route no longer writes. It also demonstrates the residual hazard the
       dashboard's appended provenance note exists for: rows written before this
       wave still read as a 100% success rate, which is why that note is
       unconditional and is worded about the SOURCE rather than the value. */
    rawDb().prepare(
      `INSERT INTO recon_runs (id, tenant_id, company_id, round_id, ts, engine_main_json, engine_ref_json, diff_json, actor, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      "rec_w240_probe", "tenant_co_w240", "co_w240", "rnd_w240",
      new Date().toISOString(),
      JSON.stringify({ totalShares: "1", ownership: 1 }),
      JSON.stringify({ totalShares: "1", ownership: 1 }),
      JSON.stringify({ sharesDelta: "0", ownershipDelta: 0, ok: true }),
      "u_w240_probe",
    );
    try {
      const kpi = await req("GET", "/api/admin/dashboard/kpis", undefined, ADMIN);
      expect(kpi.status).toBe(200);
      expect(kpi.body?.health?.capTableReconcile?.runs).toBe(1);
      expect(kpi.body?.health?.capTableReconcile?.successRatePct).toBe(100);
    } finally {
      /* Test fixture cleanup in an ephemeral test database. This is NOT the
         "do not delete the fabricated durable row" instruction's subject: that
         concerns rows the platform itself wrote, and this row was inserted by
         this test three lines above. */
      rawDb().prepare(`DELETE FROM recon_runs WHERE id = ?`).run("rec_w240_probe");
    }
    const kpiAfter = await req("GET", "/api/admin/dashboard/kpis", undefined, ADMIN);
    expect(kpiAfter.body?.health?.capTableReconcile?.successRatePct).toBeNull();
  });
});

describe("W240 §5 — the prohibition holds: nothing new is wired", () => {
  it("the quarterly audit-chain job still has zero callers outside its own module and its tests", async () => {
    /* R220.4's second standing prohibition. Restated here so a future wave that
       wires it has to delete an assertion rather than merely forget a ruling. */
    /* COMMENTS ARE STRIPPED FIRST, AND THE STRIPPER IS VERIFIED. My first
       version of this assertion grepped raw source and failed on
       `server/lib/logger.ts:21` (a doc comment giving "jobs.auditChainQuarterly"
       as an EXAMPLE tag) and `shared/auditChainHistory.ts:25` (prose describing
       the job). Neither is a caller. That is the standing grep hazard on this
       codebase — the documentation of a rule matches a search for violations of
       it — so the conclusion is now drawn from stripped source. */
    const { readFileSync } = await import("node:fs");
    const { execSync } = await import("node:child_process");
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    /* The stripper is verified against a fixture holding the exact shapes it
       must remove, so a stripper that silently did nothing cannot pass this. */
    const probe = "keep1\n/* drop-block auditChainQuarterly */\n// drop-line auditChainQuarterly\nkeep2";
    expect(strip(probe)).toContain("keep1");
    expect(strip(probe)).toContain("keep2");
    expect(strip(probe)).not.toContain("drop-block");
    expect(strip(probe)).not.toContain("drop-line");

    const files = execSync(
      `grep -rl "auditChainQuarterly" --include=*.ts --include=*.tsx server client shared || true`,
      { cwd: process.cwd() },
    ).toString().trim().split("\n").filter(Boolean);
    const callers = files.filter((f) => {
      if (f.includes("__tests__") || f === "server/jobs/auditChainQuarterly.ts") return false;
      return strip(readFileSync(f, "utf8")).includes("auditChainQuarterly");
    });
    expect(callers).toEqual([]);
  });
});
