/* v25.45 F19b/c — Step-4 Section-5 "M&A Readiness (qualitative)" UI persists.
 *
 * Backend: the six readiness sliders + Transaction Status persist to
 * profile.ma.readiness through the real /api/companies/:id/profile PATCH and
 * round-trip to the durable profilestore_company_profile row.
 *
 * Frontend: source-assert Step-4 has the new Section 5 (6 sliders +
 * Transaction Status) and the existing narrative is renumbered to Section 6.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f19b"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F19b Step-4 readiness section — E2E", () => {
  it("1. PATCH ma.readiness (6 sliders + tx status) → 200", async () => {
    const r = await h.patchProfile({ ma: { readiness: {
      ipDueDiligence: 80, customerContracts: 65, financialAudit: 95,
      dataRoomOrganization: 70, regulatoryFilings: 55, esgDisclosure: 40,
      transactionStatus: "active_negotiation",
    }}});
    const ok = r.status === 200;
    record("readiness patch → 200", ok, `status ${r.status}`);
    expect(ok).toBe(true);
  });

  it("2. all six sliders + tx status round-trip durably", () => {
    const d = h.readDurable();
    const rd = d?.ma?.readiness;
    const ok = rd?.ipDueDiligence === 80 && rd?.customerContracts === 65
      && rd?.financialAudit === 95 && rd?.dataRoomOrganization === 70
      && rd?.regulatoryFilings === 55 && rd?.esgDisclosure === 40
      && rd?.transactionStatus === "active_negotiation";
    record("durable readiness round-trips all fields", ok, JSON.stringify(rd));
    expect(ok).toBe(true);
  });

  it("3. existing ma.intelligence fields untouched (additive)", async () => {
    await h.patchProfile({ ma: { uniqueValueProposition: "Coexists with readiness." } });
    const d = h.readDurable();
    const ok = d?.ma?.uniqueValueProposition === "Coexists with readiness."
      && d?.ma?.readiness?.financialAudit === 95;
    record("readiness additive to ma block", ok, `uvp ${d?.ma?.uniqueValueProposition} fa ${d?.ma?.readiness?.financialAudit}`);
    expect(ok).toBe(true);
  });

  it("4. Step-4 source has Section 5 readiness (6 sliders + tx status)", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Company.tsx"), "utf8");
    const ok = /Section 5 — M&A Readiness \(qualitative\)/.test(src)
      && /slider-ma-readiness-\$\{s\.key\}/.test(src)
      && /ipDueDiligence/.test(src)
      && /customerContracts/.test(src)
      && /financialAudit/.test(src)
      && /dataRoomOrganization/.test(src)
      && /regulatoryFilings/.test(src)
      && /esgDisclosure/.test(src)
      && /select-ma-transaction-status/.test(src);
    record("Step-4 Section 5 present with all controls", ok);
    expect(ok).toBe(true);
  });

  it("5. narrative renumbered to Section 6", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/founder/Company.tsx"), "utf8");
    const ok = /Section 6 — Readiness Narrative/.test(src);
    record("narrative renumbered to Section 6", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F19b E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
