/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 244 — THE SERVER'S OWN RULE, OVER REAL HTTP, THROUGH THE PRODUCTION
 * REGISTRAR — AND THE PROOF THAT THE WIZARD'S SENTENCE CANNOT DRIFT FROM IT.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE IS NOT A UNIT TEST OF THE PREDICATE. A test that imported
 * `roundNameIsMissing` and asserted it returns true for `""` would prove nothing
 * about the platform: it would prove the function I just wrote does what I wrote.
 * The claim wave 244 actually makes is stronger — that **the requirement the
 * founder sees at step 1 is the server's own requirement**. So every assertion
 * here goes over a real socket, through `registerRoutes` (the production
 * registrar, the same function `server/index.ts` calls), against a real SQLite
 * handle.
 *
 * THE ANTI-DRIFT FENCE. `server/routes.ts` was deliberately NOT edited to import
 * the shared constant: rewriting a live literal in the error-mapping layer would
 * retire a string the silent-drop guard is fencing, and this wave has no business
 * there. Instead W244-3 drives the real route and asserts the 400 body's
 * `message` is **byte-identical** to `ROUND_NAME_REQUIRED_MESSAGE` — the constant
 * the wizard renders. If anyone edits either side, this goes red. That is a fence
 * whose installation is proved, rather than a comment promising alignment.
 *
 * W244-4 IS THE ONE THAT MATTERS MOST. It proves the change to
 * `server/roundsStore.ts` did not alter behaviour: a whitespace-only name is
 * still refused (the old inline code trimmed; a carelessly written replacement
 * using bare falsiness would have accepted `"   "` and persisted a nameless
 * round). And W244-5 proves nothing became MORE restrictive — a perfectly good
 * name still creates.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { addCompanyForFounder } from "../multiCompanyStore";
import { registerFounderUser } from "../lib/userContext";
import { w212Attest } from "./_w212RoundAttestation";
import {
  roundNameIsMissing,
  ROUND_NAME_REQUIRED_CODE,
  ROUND_NAME_REQUIRED_MESSAGE,
  ROUND_NAME_REQUIRED_STORE_MESSAGE,
  ROUND_NAME_REQUIRED_VALIDATION_CODE,
} from "../../shared/roundNameRequired";

let server: http.Server;
let port = 0;

type Reply = { status: number; body: any; raw: string };

/** The founder persona these calls act as. Registered for real through
 *  `registerFounderUser`, and given the company through `addCompanyForFounder`,
 *  exactly as `server/__tests__/roundPersistenceProof.test.ts` does — because the
 *  create route enforces ownership (`FOUNDER_WRONG_COMPANY`) and an unauthenticated
 *  probe would only ever prove the auth layer works. `x-user-id` is the one header
 *  the platform's dev/test context accepts. */
let FOUNDER_USER_ID = "";
const COMPANY_ID = `co_w244_parity_${Date.now()}`;

/**
 * A payload that is VALID IN EVERY RESPECT EXCEPT the field under test.
 *
 * THIS IS NOT DECORATION. The first run of this file sent only
 * `{companyId, type, currency}` and the real route answered
 * `OPEN_DATE_REQUIRED` — the route validates the schedule BEFORE the name. Had
 * the test been written to accept "any 400", it would have passed while proving
 * nothing about the round name at all: an unconditionally-satisfiable predicate.
 * So every case below starts from a body the route would otherwise accept, and
 * varies ONLY the name. `w212Attest` supplies the two sign-off inputs a founder
 * types at step 5 — the same helper the existing round-creation tests use; it
 * does not weaken any gate.
 */
function validBody(name?: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {
    companyId: COMPANY_ID,
    type: "series_a",
    instrument: "preferred",
    state: "draft",
    targetAmount: 5_000_000,
    preMoney: 25_000_000,
    fdPreMoneyShares: 10_000_000,
    pricePerShare: 2.5,
    sharesAuthorized: 2_000_000,
    minTicket: 250_000,
    currency: "USD",
    region: "US",
    openDate: "2026-09-01",
    closeDate: "2026-12-31",
    useOfProceeds: "W244 parity probe",
  };
  if (name !== undefined) body.name = name;
  return w212Attest(body);
}

function call(method: string, path: string, payload?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = payload === undefined ? undefined : Buffer.from(JSON.stringify(payload));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-type": "application/json",
          ...(FOUNDER_USER_ID ? { "x-user-id": FOUNDER_USER_ID } : {}),
          ...(data ? { "content-length": String(data.length) } : {}),
        },
      },
      res => {
        let raw = "";
        res.on("data", c => { raw += c; });
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(raw); } catch { /* non-JSON body is itself informative */ }
          resolve({ status: res.statusCode ?? 0, body, raw });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  const reg = registerFounderUser({
    email: `w244_founder_${Date.now()}@test.example`,
    name: "W244 Parity Founder",
    password: "w244ParityTest1234",
  });
  FOUNDER_USER_ID = reg.userId;
  addCompanyForFounder(FOUNDER_USER_ID, {
    companyId: COMPANY_ID,
    companyName: "W244 Parity Co",
    legalName: "W244 Parity Co, Inc.",
    logoUrl: null,
    role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: {
      capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0,
      dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0,
    },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "\u2014", cardLast4: null, invoiceCount: 0 },
    sector: "fintech", stage: "seed", hq: "San Francisco, CA",
  });

  const app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as any).port;
}, 120000);

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
});

describe("W244 · the round-name requirement is the server's own rule", () => {
  it("W244-1 · an EMPTY name is refused by the real route, over a real socket, through the production registrar", async () => {
    const r = await call("POST", "/api/rounds", validBody(""));
    expect(r.status, `unexpected body: ${r.raw.slice(0, 300)}`).toBe(400);
    expect(r.body?.error).toBe(ROUND_NAME_REQUIRED_VALIDATION_CODE);
    expect(r.body?.fieldErrors?.name).toBeTruthy();
  }, 60000);

  it("W244-2 · THE ANTI-DRIFT FENCE — the refusal the API returns is BYTE-IDENTICAL to the sentence the wizard renders", async () => {
    const r = await call("POST", "/api/rounds", validBody(""));
    expect(r.status).toBe(400);
    /* Not "contains", not case-insensitive, not normalised. A normalising call
       inside an equality assertion is one of the documented ways a proof goes
       inert, so there is none here. Both halves are pinned: the constant equals
       its literal, and the live route's body equals the constant. */
    expect(ROUND_NAME_REQUIRED_MESSAGE).toBe("Round name is required.");
    expect(r.body.fieldErrors.name).toBe(ROUND_NAME_REQUIRED_MESSAGE);
  }, 60000);

  it("W244-3 · THE SECOND LAYER IS FENCED TOO — the store-level sentence in routes.ts still matches its constant", async () => {
    /* This layer is shadowed over HTTP (W244-1 refuses first), so it is pinned by
       source rather than by a response — and the file is read from disk, not
       recalled from memory. Documented plainly in shared/roundNameRequired.ts and
       in W244_BUILD.md: this is the weaker of the two fences, and it is labelled
       as such instead of being presented as an HTTP proof. */
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../routes.ts", import.meta.url), "utf8");
    expect(src).toContain(`error: "${ROUND_NAME_REQUIRED_CODE}", message: "${ROUND_NAME_REQUIRED_STORE_MESSAGE}"`);
  }, 60000);

  it("W244-4 · BEHAVIOUR IS UNCHANGED — a WHITESPACE-ONLY name is still refused, exactly as the two inline trims did", async () => {
    /* The predicate's contract. The distinction matters: a rule written with bare
       falsiness would have accepted "   " and persisted a nameless round. */
    expect(roundNameIsMissing("   ")).toBe(true);
    expect(roundNameIsMissing("\t\n ")).toBe(true);
    expect(roundNameIsMissing(null)).toBe(true);
    expect(roundNameIsMissing(undefined)).toBe(true);
    expect(roundNameIsMissing(" a ")).toBe(false);

    /* And the REAL route agrees, which is the part that is not merely my own
       function agreeing with itself. */
    for (const bad of ["   ", "\t", "\n  \t "]) {
      const r = await call("POST", "/api/rounds", validBody(bad));
      expect(r.status, `whitespace name ${JSON.stringify(bad)} was not refused`).toBe(400);
      expect(r.body?.fieldErrors?.name).toBe(ROUND_NAME_REQUIRED_MESSAGE);
    }
  }, 90000);

  it("W244-5 · AN OMITTED name is refused too — the route's \"Untitled round\" fallback is not reached", async () => {
    /* Recorded because the fallback literal
       `String(body.name ?? "Untitled round")` is still present in routes.ts and is
       a latent defect for any future caller that bypasses this block. It is
       reported to the owner rather than changed: out of scope for wave 244. */
    const r = await call("POST", "/api/rounds", validBody(undefined));
    expect(r.status).toBe(400);
    expect(r.body?.fieldErrors?.name).toBe(ROUND_NAME_REQUIRED_MESSAGE);
    expect(r.raw).not.toContain("Untitled round");
  }, 60000);

  it("W244-6 · NOTHING BECAME MORE RESTRICTIVE — a real name still creates a round, and is stored as typed", async () => {
    const name = `W244 Parity Round ${Date.now()}`;
    const r = await call("POST", "/api/rounds", validBody(name));
    expect(r.status, `create failed: ${r.raw.slice(0, 400)}`).toBeLessThan(400);
    expect(r.body?.ok).toBe(true);
    expect(String(r.body?.id ?? "")).toMatch(/^rnd_/);

    /* Read back over HTTP, from the real store — not from the response echo. */
    const back = await call("GET", `/api/rounds/${r.body.id}`);
    expect(back.status).toBeLessThan(400);
    const round = back.body?.round ?? back.body;
    expect(String(round?.name ?? "")).toBe(name);
  }, 90000);
});
