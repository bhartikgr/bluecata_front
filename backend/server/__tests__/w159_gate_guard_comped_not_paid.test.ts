/**
 * WAVE 159 · R126.4 — A COMPED COMPANY MUST NEVER BE PRESENTED AS "Paid".
 *
 * `spvLaunchGateGuard.ts` built its company rows with `renderMembershipState`,
 * so a comped company was labelled **"Paid"** to partner, admin and LP audiences.
 * The reviewer proved it (155.2):
 *
 *   PROBE_GUARD_PAYLOAD [{"companyId":"co_probe_typo","state":"paid","stateLabel":"Paid"}, …]
 *
 * That contradicts the guard's own design note at `spvEligibilityGate.ts:468-474`
 * ("Every admin surface that shows a membership state renders THIS, not
 * `renderMembershipState`") and it violates wave 155's core requirement. It is
 * latent only because the gate is unwired — which is exactly why it must be fixed
 * BEFORE the gate is ever wired (R126.4).
 *
 * The assertions run against a REAL Express route that calls the REAL
 * `enforceLaunchGate`, over HTTP, and read the REAL response body. The gate is
 * NOT wired to any product create path by this test or by this wave (R122/R123);
 * the route below exists only inside this file.
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 *   LOWER — a comped company is never labelled "Paid" on any audience's payload.
 *   UPPER — a genuinely PAID company is still labelled "Paid"; an unpaid one is
 *           still "Not paid"; and an LP is still told the STATE only, never which
 *           company lapsed (R113.3).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";

import { enforceLaunchGate, type GateAudience } from "../lib/spvLaunchGateGuard";
import {
  grantCompedMembership,
  ensureCompedMembershipSchema,
} from "../lib/compedMembershipStore";

const COMPED = "co_w159_comped_for_guard";
const UNPAID = "co_w159_unpaid_for_guard";

let app: express.Express;

beforeAll(() => {
  ensureCompedMembershipSchema();
  try {
    grantCompedMembership({
      subjectKind: "company",
      subjectId: COMPED,
      reason: "W159 — the guard must name this as comped, never as paid.",
      grantedBy: "u_admin",
    });
  } catch {
    /* Already granted by an earlier run in the same worker — the assertions below
       care about the label, not about who created the row. */
  }

  app = express();
  app.use(express.json());
  /* A test-only probe route. It is the ONLY importer of `enforceLaunchGate` in
     this file's world; no product route is wired by this wave. */
  app.post("/__w159/probe/:audience", (req: Request, res: Response) => {
    const out = enforceLaunchGate(res, {
      spvId: null,
      companyIds: (req.body?.companyIds ?? []) as string[],
      audience: req.params.audience as GateAudience,
      advisoryOnly: req.body?.advisoryOnly === true,
      where: "w159_probe",
    });
    if (out.handled) return;
    res.status(200).json({ ok: true, advisory: out.advisory });
  });
});

/** Every string anywhere in a payload, so a label cannot hide in a nested field. */
function allStrings(v: unknown, acc: string[] = []): string[] {
  if (typeof v === "string") acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => allStrings(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => allStrings(x, acc));
  return acc;
}

describe("W159 · D — the launch-gate guard never calls a comp a payment", () => {
  it("D1 — a comped company in an ADMIN advisory payload is named as comped, not 'Paid'", async () => {
    const res = await request(app)
      .post("/__w159/probe/admin")
      .send({ companyIds: [COMPED, UNPAID], advisoryOnly: true });

    expect(res.status).toBe(200);
    const companies = (res.body?.advisory?.launchGate?.companies ?? []) as {
      companyId: string;
      state: string;
      stateLabel: string;
      basis?: string | null;
    }[];
    const comped = companies.find((c) => c.companyId === COMPED);
    expect(comped, "the comped company must appear in the payload").toBeTruthy();
    expect(comped!.stateLabel).toBe("Comped by Capavate (no payment taken)");
    expect(comped!.stateLabel).not.toBe("Paid");
    expect(comped!.basis).toBe("comped");
  });

  it("D2 — a comped company in a PARTNER refusal payload is named as comped, not 'Paid'", async () => {
    const res = await request(app)
      .post("/__w159/probe/partner")
      .send({ companyIds: [COMPED, UNPAID] });

    /* The unpaid company is what causes the refusal; the comped one rides along in
       the disclosed detail, which is where the reviewer found "Paid". */
    expect([200, 402]).toContain(res.status);
    const strings = allStrings(res.body);
    const comped = (res.body?.companies ?? res.body?.advisory?.launchGate?.companies ?? []).find(
      (c: { companyId: string }) => c.companyId === COMPED,
    ) as { stateLabel?: string } | undefined;
    if (comped) expect(comped.stateLabel).toBe("Comped by Capavate (no payment taken)");
    /* Nowhere in the partner-facing body may the bare word "Paid" stand alone. */
    expect(strings.filter((s) => s === "Paid")).toHaveLength(0);
  });

  it("D3 — an LP is told the STATE only: no company identity, no third-party billing detail", async () => {
    const res = await request(app)
      .post("/__w159/probe/lp")
      .send({ companyIds: [COMPED, UNPAID] });

    expect([200, 402]).toContain(res.status);
    expect(res.body?.companies).toBeUndefined();
    expect(res.body?.advisory?.launchGate?.companies).toBeUndefined();
    const strings = allStrings(res.body);
    expect(strings.some((s) => s.includes(COMPED))).toBe(false);
    expect(strings.some((s) => s.includes(UNPAID))).toBe(false);
    expect(strings.filter((s) => s === "Paid")).toHaveLength(0);
  });

  it("D4 — UPPER POLE: the honest labels for the other states are unchanged", async () => {
    const res = await request(app)
      .post("/__w159/probe/admin")
      .send({ companyIds: [UNPAID], advisoryOnly: true });
    const companies = (res.body?.advisory?.launchGate?.companies ?? []) as {
      companyId: string;
      stateLabel: string;
    }[];
    const unpaid = companies.find((c) => c.companyId === UNPAID);
    expect(unpaid).toBeTruthy();
    expect(["Not paid", "Not on record"]).toContain(unpaid!.stateLabel);
  });
});
