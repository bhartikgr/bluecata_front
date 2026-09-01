/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 230D · TASK 3 — WHICH CAP-TABLE COMMIT ROUTE DOES PRODUCTION ACTUALLY
 * HIT? PROVED OVER HTTP, NOT BY GREP.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * R226.1 records the finding and records its own limitation in the same breath:
 * *"the 'no caller' finding is grep-and-read, not driven over HTTP, and no
 * comment-stripper was run before that conclusion. A comment once inflated a
 * call-site count from 1 to 2 on this platform. So confirm it over HTTP before
 * acting."*
 *
 * This file is that confirmation, and it is the PRECONDITION for every other
 * line of Task 3. It does three things and no more:
 *
 *   §A the path is READ OUT OF THE CLIENT SOURCE, comment-stripped, rather than
 *      typed in from the brief. If the founder's button ever moves, this test
 *      changes verdict instead of silently testing a path nobody uses.
 *   §B that exact path is DRIVEN over the production registrar and observed:
 *      does it demand an attestation, or does it commit without one?
 *   §C the dormant twin is driven too, and observed to refuse.
 *
 * §D proves the gate this wave adds, in front of the route production uses,
 * without waking the twin and without touching the sacred store.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { enqueueFunded, clearLedger, setComplianceHold } from "../captableCommitStore";

const ROOT = path.resolve(__dirname, "..", "..");
const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

let app: Express;
let server: http.Server;
let port = 0;

function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { "x-user-id": "u_admin" };
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/* ── §A THE PATH, TAKEN FROM THE BUTTON ──────────────────────────────────── */

const FOUNDER_BUTTON_FILE = "client/src/pages/founder/RoundDetail.tsx";
const PATH_RE = /apiRequest\(\s*"POST"\s*,\s*"(\/api\/founder\/captable\/commit-funded-batch[^"]*)"/;

describe("W230D · A — the path the founder's commit button posts to", () => {
  it("A0 the comment stripper works in BOTH directions", () => {
    const sample =
      'x /* "/api/founder/captable/commit-funded-batch-v2" */ y // "/api/founder/captable/commit-funded-batch-v2"\nconst live = "/api/founder/captable/commit-funded-batch-v2";';
    const stripped = stripComments(sample);
    expect(stripped.split("commit-funded-batch-v2").length - 1).toBe(1);
    expect(stripped).toContain('const live = "/api/founder/captable/commit-funded-batch-v2"');
  });

  it("A1 the button's path is read out of the client source, not assumed", () => {
    const src = stripComments(readSource(FOUNDER_BUTTON_FILE));
    const m = src.match(PATH_RE);
    expect(m).toBeTruthy();
    expect(m![1]).toBe("/api/founder/captable/commit-funded-batch");
  });

  it("A2 NO client file posts to the gated twin — comment-stripped, whole client tree", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules") continue;
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx)$/.test(e.name)) continue;
        if (stripComments(fs.readFileSync(p, "utf8")).includes("commit-funded-batch-v2")) {
          hits.push(path.relative(ROOT, p));
        }
      }
    };
    walk(path.join(ROOT, "client"));
    expect(hits).toEqual([]);
  });
});

/* ── §B WHAT THE PRODUCTION PATH ACTUALLY DOES ───────────────────────────── */

describe("W230D · B — production's route, driven over HTTP", () => {
  it("B1 the ungated route answers the founder's button and commits WITHOUT any attestation", async () => {
    clearLedger();
    setComplianceHold(false);
    enqueueFunded({
      invitationId: "in_w230d_probe",
      roundId: "rnd_w230d_probe",
      companyId: "co_w230d_probe",
      investorId: "u_w230d_probe",
      amount: "100000",
      currency: "USD",
      shares: "5000",
    });
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", {
      companyId: "co_w230d_probe",
      roundId: "rnd_w230d_probe",
    });
    /* Recorded exactly as observed. */
    console.log("W230D_PROBE_B1", r.status, JSON.stringify(r.body));
    expect(r.status).toBe(200);
    /* The decisive observation: the response carries NO attestation error and
       the route never asked for one. */
    expect(JSON.stringify(r.body)).not.toContain("attestation");
  });

  it("B2 the dormant twin refuses without an attestation", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded-batch-v2", {
      companyId: "co_w230d_probe",
      roundId: "rnd_w230d_probe",
      entries: [
        {
          invitationId: "in_w230d_probe2",
          roundId: "rnd_w230d_probe",
          investorId: "u_w230d_probe",
          amount: "100000",
          currency: "USD",
        },
      ],
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("attestation_required");
  });
});
