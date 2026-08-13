/**
 * WAVE 33 · CP-PIPE-06 — PROVENANCE CANNOT BE OMITTED OR ACQUIRED.
 *
 * Two rules, and this file is organised around the fact that BOTH were open in
 * ways that no existing test could have detected:
 *
 * OMITTED — `POST /api/admin/partners/:id/attributions` passed
 *   `source ?? "admin_manual"`. Sending no source produced a row permanently
 *   asserting an administrative decision. The sharp detail: the validator
 *   directly above it ALREADY rejected an *unknown* source with a 400, so the
 *   code looked validated. Omission was the single case that received a
 *   fabrication instead of an error, and it was the easy case to send.
 *
 * ACQUIRED — uniqueness is per `(partner_id, company_id)`, in the RAM check and
 *   in the DB index alike. Nothing had ever asked "who else holds this
 *   company?" — the lookup did not exist in the codebase. Partner B could claim
 *   partner A's company through a self-service source and both rows stood.
 *
 * Group (X) is the one that would have caught the real thing: it drives the
 * store's create() with two partners and the SAME company id, which no test in
 * the repository did.
 *
 * Establishes its own preconditions. Never reads `process.env`. No skips.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";

import {
  assessAdmission,
  assessExistingRow,
  isProvenanceSource,
  isSelfServiceSource,
  PROVENANCE_SOURCES,
  type ProvenanceIncumbent,
} from "../lib/attributionProvenance";
import { partnerAttributionStore } from "../partnerWorkspaceStore";

function readCode(f: string): string {
  return fs
    .readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const INC = (partnerId: string, attributedAt = "2024-01-01T00:00:00.000Z"): ProvenanceIncumbent => ({
  partnerId,
  attributionSource: "partner_claim",
  attributedAt,
});

/* ── (P) THE STRIPPER, PINNED FIRST ───────────────────────────────────────── */

describe("P — preconditions this file's conclusions rest on", () => {
  it("P0 readCode removes comments but keeps code", () => {
    // Without this every `not.toContain` below could pass against "".
    const src = readCode("server/lib/attributionProvenance.ts");
    expect(src).toContain("export function assessAdmission");
    expect(src).not.toContain("CANNOT BE OMITTED OR ACQUIRED");
    expect(src.length).toBeGreaterThan(1500);
  });

  it("P1 the source union is the four the DB CHECK allows", () => {
    expect(Array.from(PROVENANCE_SOURCES)).toEqual([
      "admin_manual",
      "referral_code",
      "partner_claim",
      "partner_portfolio",
    ]);
    // The DB CHECK is the real constraint; if these drift the engine would
    // admit something the database rejects with an opaque 500.
    const conn = fs.readFileSync("server/db/connection.ts", "utf8");
    for (const s of PROVENANCE_SOURCES) expect(conn).toContain(`'${s}'`);
  });
});

/* ── (O) OMISSION ─────────────────────────────────────────────────────────── */

describe("O — provenance cannot be OMITTED", () => {
  const base = { requestedPartnerId: "p_a", actor: "u_1", incumbents: [] as ProvenanceIncumbent[] };

  it("O1 undefined source is refused — NOT defaulted to admin_manual", () => {
    const r = assessAdmission({ ...base, source: undefined });
    expect(r.verdict).toBe("REFUSE_SOURCE_OMITTED");
    expect(r.admit).toBe(false);
  });

  it("O2 null and empty-string sources are refused too", () => {
    expect(assessAdmission({ ...base, source: null }).verdict).toBe("REFUSE_SOURCE_OMITTED");
    expect(assessAdmission({ ...base, source: "" }).verdict).toBe("REFUSE_SOURCE_OMITTED");
    expect(assessAdmission({ ...base, source: "   " }).verdict).toBe("REFUSE_SOURCE_OMITTED");
  });

  it("O3 an unknown source is refused and is DISTINGUISHED from an omitted one", () => {
    /* Two different failures deserve two different answers: "you said nothing"
       and "you said something we do not recognise" call for different fixes. */
    const r = assessAdmission({ ...base, source: "acquired_somehow" });
    expect(r.verdict).toBe("REFUSE_SOURCE_UNKNOWN");
    expect(r.copy).not.toBe(assessAdmission({ ...base, source: undefined }).copy);
  });

  it("O4 a missing actor is refused — provenance is source AND person", () => {
    for (const actor of [undefined, null, "", "  ", 42]) {
      expect(assessAdmission({ ...base, actor, source: "admin_manual" }).verdict).toBe(
        "REFUSE_ACTOR_OMITTED",
      );
    }
  });

  it("O5 THE POLE — a complete claim on an unclaimed company is ADMITTED", () => {
    // Without this the whole group would pass against an engine that refuses
    // everything, which is a check that passes while checking nothing.
    const r = assessAdmission({ ...base, source: "admin_manual" });
    expect(r.verdict).toBe("ADMIT");
    expect(r.admit).toBe(true);
  });

  it("O6 all four recognised sources are admitted on an unclaimed company", () => {
    for (const s of PROVENANCE_SOURCES) {
      expect(assessAdmission({ ...base, source: s }).admit).toBe(true);
    }
  });

  it("O7 omission is checked BEFORE acquisition", () => {
    /* A claim that is both provenance-less AND an acquisition should report the
       more fundamental fault, not whichever check happens to run first. */
    const r = assessAdmission({ ...base, source: undefined, incumbents: [INC("p_b")] });
    expect(r.verdict).toBe("REFUSE_SOURCE_OMITTED");
  });

  it("O8 the admin route no longer fabricates a default — asserted on SOURCE", () => {
    const src = readCode("server/partnerRoutes.ts");
    expect(src).not.toContain('source ?? "admin_manual"');
    expect(src).toContain("source is required and is not assumed");
  });

  it("O9 the route refuses omission with a 400 before calling create()", () => {
    const src = readCode("server/partnerRoutes.ts");
    const h = src.slice(src.indexOf('app.post("/api/admin/partners/:id/attributions"'));
    const window = h.slice(0, 2600);
    const refuseIdx = window.indexOf("source is required and is not assumed");
    const createIdx = window.indexOf("partnerAttributionStore.create(");
    expect(refuseIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(refuseIdx); // refusal comes first
  });

  it("O10 a refused acquisition surfaces as 409, not 500", () => {
    const src = readCode("server/partnerRoutes.ts");
    expect(src).toContain('res.status(409).json({');
    expect(src).toContain('error: "PROVENANCE_REFUSED"');
  });
});

/* ── (A) ACQUISITION ──────────────────────────────────────────────────────── */

describe("A — provenance cannot be ACQUIRED", () => {
  const base = { requestedPartnerId: "p_a", actor: "u_1" };

  it("A1 a self-service claim against another partner's live claim is REFUSED", () => {
    for (const s of ["partner_claim", "referral_code", "partner_portfolio"]) {
      const r = assessAdmission({ ...base, source: s, incumbents: [INC("p_b")] });
      expect(r.verdict).toBe("REFUSE_ACQUISITION");
      expect(r.admit).toBe(false);
    }
  });

  it("A2 an ADMIN claim against another partner's live claim is admitted AND FLAGGED", () => {
    /* Displacement is not forbidden — an incumbent claim can be wrong, and a
       platform that can never correct one is worse than one that can. It must
       be adjudicated rather than self-asserted. */
    const r = assessAdmission({ ...base, source: "admin_manual", incumbents: [INC("p_b")] });
    expect(r.verdict).toBe("ADMIT_ADJUDICATED_DISPLACEMENT");
    expect(r.admit).toBe(true);
    expect(r.displaces?.partnerId).toBe("p_b");
  });

  it("A3 the displaced incumbent is the OLDEST live claim, not the newest", () => {
    const r = assessAdmission({
      ...base,
      source: "admin_manual",
      incumbents: [INC("p_new", "2025-06-01T00:00:00.000Z"), INC("p_old", "2020-01-01T00:00:00.000Z")],
    });
    // The originator is displaced, not whoever most recently asserted.
    expect(r.displaces?.partnerId).toBe("p_old");
  });

  it("A4 the partner's OWN live claim is idempotent, never a displacement", () => {
    const r = assessAdmission({ ...base, source: "partner_claim", incumbents: [INC("p_a")] });
    expect(r.verdict).toBe("ADMIT_ALREADY_HELD");
    expect(r.displaces).toBeNull();
  });

  it("A5 THE POLE — with no incumbent, a self-service claim is admitted", () => {
    // Otherwise group A would pass against an engine that blocks all
    // self-service attribution outright, which is a different product.
    const r = assessAdmission({ ...base, source: "partner_claim", incumbents: [] });
    expect(r.verdict).toBe("ADMIT");
  });

  it("A6 the adjudicated set is an ALLOW-LIST, so a new source is self-service by default", () => {
    /* A deny-list would silently admit any source added to the union later.
       The restrictive answer must be the automatic one. */
    expect(isSelfServiceSource("admin_manual")).toBe(false);
    expect(isSelfServiceSource("partner_claim")).toBe(true);
    expect(isSelfServiceSource("some_future_source_nobody_classified")).toBe(true);
    const src = readCode("server/lib/attributionProvenance.ts");
    expect(src).toContain('ADJUDICATED_SOURCES: readonly string[] = ["admin_manual"]');
  });

  it("A7 an incumbent list containing only the requester is not 'foreign'", () => {
    const r = assessAdmission({ ...base, source: "partner_claim", incumbents: [INC("p_a"), INC("p_a")] });
    expect(r.verdict).toBe("ADMIT_ALREADY_HELD");
  });

  it("A8 own-claim wins over a foreign one — no refusal when the partner already holds it", () => {
    const r = assessAdmission({
      ...base,
      source: "partner_claim",
      incumbents: [INC("p_b"), INC("p_a")],
    });
    expect(r.verdict).toBe("ADMIT_ALREADY_HELD");
  });
});

/* ── (X) THE STORE SINK — DRIVEN BY EXECUTION ─────────────────────────────── */

describe("X — the rule is enforced at the sink, proven by execution", () => {
  const CO = `co_pipe06_${Date.now()}`;
  const CO2 = `co_pipe06b_${Date.now()}`;
  const P_A = "p_pipe06_a";
  const P_B = "p_pipe06_b";

  beforeAll(() => {
    // This test establishes its own precondition rather than assuming one.
    partnerAttributionStore.create(P_A, CO, "u_owner", "partner_claim", null);
  });

  it("X1 the precondition really landed", () => {
    const live = partnerAttributionStore.listActiveByCompany(CO);
    expect(live.length).toBe(1);
    expect(live[0].partnerId).toBe(P_A);
  });

  it("X2 A SECOND PARTNER CANNOT SELF-CLAIM THE SAME COMPANY (the real defect)", () => {
    /* THIS is the case no test in the repository performed: two partners, the
       SAME company id. Both the RAM uniqueness check and the DB index are keyed
       on (partner, company), so before this item the call below SUCCEEDED and
       produced two competing live claims. */
    expect(() => partnerAttributionStore.create(P_B, CO, "u_b", "partner_claim", null)).toThrow(
      /PROVENANCE_REFUSED:REFUSE_ACQUISITION/,
    );
  });

  it("X3 the refusal left NO trace — nothing partially written", () => {
    /* Fail-closed BEFORE the row exists. A refusal that left a projection entry
       behind would be worse than admitting the claim, because the relationship
       would exist without a durable record granting it. */
    const live = partnerAttributionStore.listActiveByCompany(CO);
    expect(live.length).toBe(1);
    expect(live.map((a) => a.partnerId)).toEqual([P_A]);
    expect(partnerAttributionStore.listByPartner(P_B).some((a) => a.companyId === CO)).toBe(false);
  });

  it("X4 an ADMIN displacement of the same company IS allowed", () => {
    // The pole for X2: the rule blocks self-assertion, not correction.
    expect(() =>
      partnerAttributionStore.create(P_B, CO, "u_admin", "admin_manual", "adjudicated"),
    ).not.toThrow();
    expect(partnerAttributionStore.listActiveByCompany(CO).length).toBe(2);
  });

  it("X5 the same partner re-creating is idempotent, not a second row", () => {
    const first = partnerAttributionStore.create(P_A, CO2, "u_owner", "partner_claim", null);
    const again = partnerAttributionStore.create(P_A, CO2, "u_other", "admin_manual", "different");
    expect(again.id).toBe(first.id);
    // Provenance is NOT overwritten — re-recording would rewrite who
    // originated the relationship and when.
    expect(again.attributionSource).toBe("partner_claim");
    expect(again.attributedBy).toBe("u_owner");
    expect(partnerAttributionStore.listActiveByCompany(CO2).length).toBe(1);
  });

  it("X6 an omitted actor is refused at the sink too, not only at the route", () => {
    expect(() =>
      partnerAttributionStore.create(P_A, `co_x6_${Date.now()}`, "", "partner_claim", null),
    ).toThrow(/REFUSE_ACTOR_OMITTED/);
  });

  it("X7 an unknown source is refused at the sink", () => {
    expect(() =>
      partnerAttributionStore.create(
        P_A,
        `co_x7_${Date.now()}`,
        "u_owner",
        "made_up_source" as never,
        null,
      ),
    ).toThrow(/REFUSE_SOURCE_UNKNOWN/);
  });

  it("X8 listActiveByCompany EXCLUDES revoked rows", () => {
    /* A revoked claim is released. Counting it would freeze a company to
       whoever attributed it first, permanently — which would be a worse bug
       than the one this item fixes. */
    const co = `co_x8_${Date.now()}`;
    const a = partnerAttributionStore.create(P_A, co, "u_owner", "partner_claim", null);
    expect(partnerAttributionStore.listActiveByCompany(co).length).toBe(1);
    partnerAttributionStore.revoke(P_A, a.companyId, "u_owner");
    expect(partnerAttributionStore.listActiveByCompany(co).length).toBe(0);
    // …and the company can then be claimed by someone else.
    expect(() => partnerAttributionStore.create(P_B, co, "u_b", "partner_claim", null)).not.toThrow();
  });

  it("X9 listActiveByCompany refuses an empty id rather than matching everything", () => {
    expect(partnerAttributionStore.listActiveByCompany("")).toEqual([]);
  });
});

/* ── (E) EXISTING-ROW INTEGRITY ───────────────────────────────────────────── */

describe("E — integrity of rows already on file", () => {
  it("E1 a complete row is intact", () => {
    const r = assessExistingRow({
      attributionSource: "admin_manual",
      attributedBy: "u_1",
      attributedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(r.intact).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("E2 each missing field is named individually", () => {
    expect(assessExistingRow({ attributionSource: null, attributedBy: "u", attributedAt: "t" }).issues).toEqual(["source"]);
    expect(assessExistingRow({ attributionSource: "admin_manual", attributedBy: "", attributedAt: "t" }).issues).toEqual(["actor"]);
    expect(assessExistingRow({ attributionSource: "admin_manual", attributedBy: "u", attributedAt: null }).issues).toEqual(["date"]);
  });

  it("E3 several missing fields are all reported, not just the first", () => {
    const r = assessExistingRow({ attributionSource: null, attributedBy: null, attributedAt: null });
    expect(r.issues).toEqual(["source", "actor", "date"]);
    expect(r.intact).toBe(false);
  });

  it("E4 an incomplete historical row is REPORTED, never rewritten", () => {
    /* Back-filling a plausible source onto a historical row would manufacture
       exactly the fiction this item exists to prevent. */
    const r = assessExistingRow({ attributionSource: null, attributedBy: "u", attributedAt: "t" });
    expect(r.copy).toContain("shown as it stands");
    const src = readCode("server/lib/attributionProvenance.ts");
    const fn = src.slice(src.indexOf("export function assessExistingRow"));
    expect(fn).not.toContain("admin_manual"); // no default is supplied anywhere in it
  });

  it("E5 the copy names the missing things in plain words, not field names", () => {
    const r = assessExistingRow({ attributionSource: null, attributedBy: null, attributedAt: "t" });
    expect(r.copy).toContain("how this attribution arose");
    expect(r.copy).toContain("who made it");
    expect(r.copy).not.toContain("attributionSource");
  });
});

/* ── (R) ROUTES ───────────────────────────────────────────────────────────── */

describe("R — the rule is visible in the product", () => {
  const src = readCode("server/attributionProvenanceRoutes.ts");

  it("R1 both routes are read-only", () => {
    expect(src).not.toMatch(/app\.(post|patch|put|delete)\(/);
    expect(src).not.toContain(".create(");
  });

  it("R2 partner scope comes from the SESSION, never the URL or query", () => {
    expect(src).toContain("req.partnerContext?.partnerId");
    expect(src).not.toMatch(/req\.(query|body|params)\.partnerId/);
  });

  it("R3 the pre-flight does NOT disclose the incumbent partner's identity", () => {
    /* A provenance check must not become a way to enumerate which competitor
       holds which company. "Contested" is what the asking partner needs. */
    const handler = src.slice(src.indexOf('"/api/partner/me/attributions/provenance/:companyId"'));
    const body = handler.slice(0, handler.indexOf("app.") > 0 ? handler.indexOf("app.") : handler.length);
    expect(body).toContain("contested:");

    /* HARNESS HISTORY, kept because it is the point of the case. Revision 1
       asserted the response block did not contain the string "incumbents" —
       which failed on `incumbents.length`, a line that discloses nothing.
       Revision 2 asserted it did not match /partnerId/ — which failed once the
       route legitimately began comparing `i.partnerId !== partnerId` to decide
       whether a company is contested. Both measured the wrong thing: what
       matters is what is EMITTED, not what is consulted.

       So this now checks emitted KEYS only, and the substantive guarantee is
       proved BY EXECUTION in `wave33_pipe06_routes_exec.test.ts` case P5,
       which asserts the rival partner's id appears nowhere in a real response
       body. A source scan should not be the last line of defence for a
       disclosure rule. */
    const resIdx = body.indexOf("res.json({");
    const payload = body.slice(resIdx, body.indexOf("});", resIdx));
    const emittedKeys = Array.from(payload.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)).map((m) => m[1]);
    expect(emittedKeys.length).toBeGreaterThan(3);
    for (const k of emittedKeys) {
      expect(k.toLowerCase()).not.toContain("partner");
      expect(k.toLowerCase()).not.toContain("incumbent");
      expect(k.toLowerCase()).not.toContain("holder");
    }
    // POLE: the key scan can actually fail.
    const doctored = payload.replace("contested:", "incumbentPartnerId: null,\n          contested:");
    const doctoredKeys = Array.from(doctored.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)).map((m) => m[1]);
    expect(doctoredKeys).toContain("incumbentPartnerId");
  });

  it("R4 the pre-flight uses the SAME engine the store enforces with", () => {
    // Otherwise it could tell a partner they may claim something the write refuses.
    expect(src).toContain("assessAdmission({");
    expect(src).not.toContain("REFUSE_ACQUISITION"); // no re-implemented verdicts
  });

  it("R5 an empty attribution list is NOT reported as a clean bill of health", () => {
    /* "0 problems found" over 0 rows is the archetype of a check that passed
       while checking nothing, rendered as reassurance. */
    expect(src).toContain("This is not the same as provenance being complete");
  });

  it("R6 failures refuse with 503 and say nothing changed — they do not return an empty list", () => {
    expect(src).toContain('error: "PROVENANCE_UNAVAILABLE"');
    expect(src).not.toMatch(/catch\s*\{\s*res\.json\(\{\s*attributions:\s*\[\]/);
  });
});

/* ── (U) UI ───────────────────────────────────────────────────────────────── */

describe("U — the panel is mounted and prints the server's words", () => {
  const ui = readCode("client/src/components/partner/AttributionProvenancePanel.tsx");
  const page = readCode("client/src/pages/partner/PartnerClients.tsx");

  it("U1 the panel is actually mounted — a component mounted nowhere is not shipped", () => {
    expect(page).toContain("<AttributionProvenancePanel />");
    expect(page).toContain('from "@/components/partner/AttributionProvenancePanel"');
  });

  it("U2 it renders the server's summary and refusal copy verbatim", () => {
    expect(ui).toContain("{q.data.summary}");
    expect(ui).toContain("{pre.data.copy}");
    expect(ui).toContain("{a.copy}");
  });

  it("U3 no verdict wording is assembled client-side", () => {
    for (const v of ["REFUSE_ACQUISITION", "REFUSE_SOURCE_OMITTED", "ADMIT_ADJUDICATED_DISPLACEMENT"]) {
      expect(ui).not.toContain(v);
    }
  });

  it("U4 nulls render as an em dash, never as a fabricated value", () => {
    expect(ui).toContain('{a.attributedBy || "—"}');
    expect(ui).toContain('{a.attributedAt || "—"}');
    expect(ui).not.toMatch(/attributedBy\s*\|\|\s*"admin_manual"/);
  });

  it("U5 a failed read says so — it does not render as 'no attributions'", () => {
    expect(ui).toContain("could not be read");
    expect(ui).toContain("nothing has been changed");
  });

  it("U6 the panel is appended as the LAST sibling of the page", () => {
    // Inserting mid-list renumbers a sibling's positional path and the guard
    // reads that as a drop.
    const i = page.indexOf("<AttributionProvenancePanel />");
    const j = page.indexOf("</PartnerShell>");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(page.slice(i + 30, j).trim()).toBe("");
  });
});

/* ── (S) STRUCTURAL ───────────────────────────────────────────────────────── */

describe("S — structural defences", () => {
  const files = [
    "server/lib/attributionProvenance.ts",
    "server/attributionProvenanceRoutes.ts",
    "client/src/components/partner/AttributionProvenancePanel.tsx",
  ];

  it("S1 no lazy require() in anything this item added", () => {
    for (const f of files) expect(readCode(f)).not.toMatch(/\brequire\s*\(/);
    expect('const x = require("y");').toMatch(/\brequire\s*\(/); // sanity pole
  });

  it("S2 the store imports the engine STATICALLY", () => {
    const src = readCode("server/partnerWorkspaceStore.ts");
    expect(src).toContain('import { assessAdmission, type ProvenanceIncumbent } from "./lib/attributionProvenance"');
  });

  it("S3 the engine is pure — no DB, no request, no clock", () => {
    const src = readCode("server/lib/attributionProvenance.ts");
    for (const bad of ["rawDb", "getDb", "Date.now", "new Date", "req."]) {
      expect(src).not.toContain(bad);
    }
  });

  it("S4 no iterator spread", () => {
    for (const f of files) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/\[\.\.\.[A-Za-z_$][\w$]*\.(values|keys|entries)\(\)\]/);
    }
  });

  it("S5 the type guard rejects non-strings rather than throwing", () => {
    for (const v of [undefined, null, 5, {}, []]) expect(isProvenanceSource(v)).toBe(false);
    expect(isProvenanceSource("admin_manual")).toBe(true);
  });

  it("S6 every verdict has distinct, substantial copy", () => {
    const seen = new Set<string>();
    const cases = [
      assessAdmission({ requestedPartnerId: "a", source: undefined, actor: "u", incumbents: [] }),
      assessAdmission({ requestedPartnerId: "a", source: "nope", actor: "u", incumbents: [] }),
      assessAdmission({ requestedPartnerId: "a", source: "admin_manual", actor: "", incumbents: [] }),
      assessAdmission({ requestedPartnerId: "a", source: "partner_claim", actor: "u", incumbents: [INC("b")] }),
      assessAdmission({ requestedPartnerId: "a", source: "admin_manual", actor: "u", incumbents: [INC("b")] }),
      assessAdmission({ requestedPartnerId: "a", source: "partner_claim", actor: "u", incumbents: [INC("a")] }),
      assessAdmission({ requestedPartnerId: "a", source: "partner_claim", actor: "u", incumbents: [] }),
    ];
    for (const c of cases) {
      expect(c.copy.length).toBeGreaterThan(80);
      expect(c.copy).not.toContain("_"); // no enum token leaking into prose
      seen.add(c.copy);
    }
    expect(seen.size).toBe(7);
  });
});
