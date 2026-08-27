/**
 * WAVE 170 · BATCH 4 ITEM B · R77 / R111 Q13 — THE SERVER HALF.
 * ═══════════════════════════════════════════════════════════════════════════════
 * A refusal with no plain-language copy used to leave `err()`
 * (`server/spvEngineRoutes.ts`) as `{ error: "<CODE>" }` with NO `message`. The
 * boundary (`client/src/lib/queryClient.ts:60-65`) then substitutes a GENERIC
 * sentence for `ApiError.message`, and the five `onError` handlers on
 * `PartnerSpvDetail.tsx` render that — so the GP read an apology that named no
 * next step, while the code that would have let support FIND the failure was
 * discarded at the boundary and logged nowhere.
 *
 * WHAT THIS FILE PROVES, executed over the real route table:
 *   1. The percent-domain refusal — reachable with one HTTP call, `hurdleRatePct
 *      500`, the exact case wave 82 documented — now carries an opaque
 *      `incidentCode`, and `error`/`fieldError`/status are UNCHANGED (R44: add,
 *      never substitute; R98: no assertion lowered — `w82_spv_launch_atomicity`
 *      still passes untouched).
 *   2. The reference is PER OCCURRENCE: two identical refusals get two different
 *      references, or a support ticket cannot identify one throw.
 *   3. The reference is OPAQUE (R77): it matches `SPV-[0-9A-F]{8}` and contains
 *      no internal identifier, table, column or code.
 *   4. The INTERNAL code is written to the LOG beside the reference — R77 permits
 *      the identifier there, and without that line the reference leads nowhere.
 *   5. Wave 148's `ESG-XXXXXXXX` minter now DELEGATES to the shared one rather
 *      than holding a second copy of the format (source pin), and still produces
 *      the same shape.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { join } from "path";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import {
  mintRefusalIncidentCode,
  REFUSAL_INCIDENT_CODE_PATTERN,
} from "../lib/refusalIncidentCode";

const MANAGING = "u_avi_managing";

let app: express.Express;

const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});

let seq = 0;
function launchBody(extraTerms: Record<string, unknown> = {}) {
  return {
    name: `W170 refusal reference ${Date.now()}_${seq++}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    spvType: "spv",
    distributionScope: "private",
    lpVisibility: "own_only",
    targetRaiseMinor: 50_000_000,
    minCheckMinor: 2_500_000,
    capMinor: 250_000_000,
    currency: "USD",
    status: "open",
    terms: { mandateDescription: "W170 reference probe mandate", ...extraTerms },
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  };
}

/** R77 — no ALL_CAPS_UNDERSCORE identifier may appear in a rendered reference. */
const INTERNAL_CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W170 · A — a refusal with no words carries a traceable reference", () => {
  it("A1 — hurdleRatePct 500: status, `error` and `fieldError` unchanged, `incidentCode` added", async () => {
    const res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 500 }));
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("PERCENT_FIELD_OUT_OF_DOMAIN");
    expect(res.body.fieldError).toBe("spv.hurdleRatePct");
    expect(typeof res.body.incidentCode).toBe("string");
    expect(res.body.incidentCode).toMatch(REFUSAL_INCIDENT_CODE_PATTERN);
    expect(res.body.incidentCode.startsWith("SPV-")).toBe(true);
  });

  it("A2 — the reference is OPAQUE: it names nothing internal (R77)", async () => {
    const res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 500 }));
    const ref = String(res.body.incidentCode);
    expect(INTERNAL_CODE_TOKEN.test(ref.slice(4))).toBe(false);
    expect(ref).not.toContain("PERCENT");
    expect(ref).not.toContain("hurdle");
    expect(ref).not.toContain("spv_");
  });

  it("A3 — PER OCCURRENCE: two identical refusals produce two different references", async () => {
    const a = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 500 }));
    const b = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 500 }));
    expect(a.body.incidentCode).not.toBe(b.body.incidentCode);
  });

  it("A4 — the INTERNAL code is logged beside the reference, so the ticket resolves", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let res;
    try {
      res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 500 }));
    } finally {
      const lines = spy.mock.calls.map((c) => String(c[0])).join("\n");
      spy.mockRestore();
      const ref = String(res?.body?.incidentCode ?? "");
      expect(ref).toMatch(REFUSAL_INCIDENT_CODE_PATTERN);
      const joined = lines;
      expect(joined).toContain(ref);
      expect(joined).toContain("PERCENT_FIELD_OUT_OF_DOMAIN");
      expect(joined).toContain("spv.refusal.unexplained");
    }
  });

  it("A5 — a LEGITIMATE launch is untouched: no reference on a 201", async () => {
    const created = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8 }));
    expect(created.status).toBe(201);
    expect(created.body.incidentCode).toBeUndefined();
  });
});

describe("W170 · B — the minter itself", () => {
  it("B1 — both prefixes match the pinned shape", () => {
    expect(mintRefusalIncidentCode("SPV")).toMatch(/^SPV-[0-9A-F]{8}$/);
    expect(mintRefusalIncidentCode("ESG")).toMatch(/^ESG-[0-9A-F]{8}$/);
  });

  it("B2 — 500 mints are 500 distinct references", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(mintRefusalIncidentCode("SPV"));
    expect(seen.size).toBe(500);
  });
});

describe("W170 · C — one authority for the format (source pins, content-verified)", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("C1 — wave 148's ESG minter DELEGATES; it holds no second copy of the format", () => {
    const src = read("server/lib/esignatureRoutes.ts");
    const fn = src.slice(src.indexOf("function mintEsignIncidentCode"));
    const body = fn.slice(0, fn.indexOf("}") + 1);
    expect(body).toContain('mintRefusalIncidentCode("ESG")');
    // The old inline expression must be gone from the FUNCTION BODY (the comment
    // above it quotes the expression on purpose, as the record of what moved).
    expect(body).not.toContain("randomBytes(4)");
  });

  it("C2 — err()'s unmapped tail still returns `error: msg` and now adds the reference", () => {
    const src = read("server/spvEngineRoutes.ts");
    expect(src).toContain(
      "return res.status(map[msg] ?? 500).json({ error: msg, incidentCode: mintUnexplainedRefusalReference(msg) });",
    );
    // No bare tail may survive anywhere in the file.
    expect(src).not.toContain("return res.status(map[msg] ?? 500).json({ error: msg });");
  });

  it("C3 — the reference and its log line are minted by ONE function, so they cannot drift", () => {
    const src = read("server/spvEngineRoutes.ts");
    const fn = src.slice(src.indexOf("function mintUnexplainedRefusalReference"));
    const body = fn.slice(0, fn.indexOf("\n}") + 2);
    expect(body).toContain('mintRefusalIncidentCode("SPV")');
    expect(body).toContain("log.error");
    expect(body).toContain("incident ${incidentCode}");
  });

  it("C4 — no second copy of the incident-code format exists in server/", () => {
    for (const rel of ["server/spvEngineRoutes.ts", "server/spvLegacyAdapters.ts"]) {
      expect(read(rel)).not.toContain('`SPV-${');
    }
  });
});
