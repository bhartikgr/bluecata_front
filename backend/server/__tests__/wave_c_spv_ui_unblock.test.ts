/**
 * Wave C — Unblock existing SPV UI (8 flows)
 *
 * Verifies:
 *   1. The 8 Wave C panels exist in SpvDetailTabs.tsx
 *   2. Each panel calls the correct endpoint with the correct HTTP verb
 *   3. Each panel has the required data-testids for QA
 *   4. The disabled Deploy button is unblocked (no `disabled` on spv-deploy-action)
 *   5. Backend endpoints hit by these panels all exist and are wired
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("Wave C — SPV UI unblock", () => {
  const ui = read("client/src/components/partner/SpvDetailTabs.tsx");
  const routes = read("server/spvEngineRoutes.ts");

  describe("C1 — Deploy panel", () => {
    it("DeployPanel component exists", () => {
      expect(ui).toMatch(/function DeployPanel\(/);
    });

    it("Deploy button is NO LONGER hardcoded-disabled", () => {
      // Old code:  <Button size="sm" variant="outline" disabled data-testid="spv-deploy-action" title="Deploy capital into a company">
      // New code:  <Button size="sm" variant="outline" data-testid="spv-deploy-action" onClick={() => setOpen(true)}
      const rx = /data-testid="spv-deploy-action"[^>]*?onClick=/;
      expect(ui).toMatch(rx);
      // And no lingering "disabled data-testid='spv-deploy-action'".
      expect(ui).not.toMatch(/disabled\s+data-testid="spv-deploy-action"/);
    });

    it("Deploy panel calls POST /api/partner/me/spv/:id/deployments", () => {
      expect(ui).toMatch(/apiRequest\("POST",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/deployments`/);
    });

    it("Deploy panel exposes the required testids (Wave C v2: no instrument selector — server sources it from the round)", () => {
      for (const id of [
        "spv-deploy-panel",
        "spv-deploy-company-id",
        "spv-deploy-round-id",
        "spv-deploy-amount",
        "spv-deploy-check-eligibility",
        "spv-deploy-submit",
        "spv-deploy-cancel",
        "spv-deploy-eligibility",
      ]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
      // Instrument selector removed — server sources instrument from the round.
      expect(ui).not.toContain('data-testid="spv-deploy-instrument"');
    });

    it("backend has POST /api/partner/me/spv/:spvId/deployments", () => {
      expect(routes).toMatch(/app\.post\("\/api\/partner\/me\/spv\/:spvId\/deployments"/);
    });
  });

  describe("C2 — Mandate panel", () => {
    it("MandatePanel exists", () => {
      expect(ui).toMatch(/function MandatePanel\(/);
    });

    it("calls PUT /api/partner/me/spv/:id/mandate", () => {
      expect(ui).toMatch(/apiRequest\("PUT",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/mandate`/);
    });

    it("exposes testids", () => {
      for (const id of ["spv-mandate-edit-open", "spv-mandate-mode", "spv-mandate-sector", "spv-mandate-geography", "spv-mandate-stage", "spv-mandate-submit"]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
    });

    it("backend has PUT /api/partner/me/spv/:spvId/mandate", () => {
      expect(routes).toMatch(/app\.put\("\/api\/partner\/me\/spv\/:spvId\/mandate"/);
    });

    it("exposes companyIds/checkMinMinor/checkMaxMinor (Wave C v2 — Gemini v1 fix)", () => {
      expect(ui).toContain('data-testid="spv-mandate-company-ids"');
      expect(ui).toContain('data-testid="spv-mandate-check-min"');
      expect(ui).toContain('data-testid="spv-mandate-check-max"');
    });

    it("mode values are the canonical SPV_MANDATE_MODES (Opus v1 fix)", () => {
      // Ensure UI imports the enum and does NOT hardcode the invented values.
      expect(ui).toMatch(/import[\s\S]*?SPV_MANDATE_MODES[\s\S]*?from "@shared\/spvEngine"/);
      expect(ui).not.toMatch(/value="target-single"/);
      expect(ui).not.toMatch(/value="blind-pool"/);
      expect(ui).not.toMatch(/value="fund-of-one"/);
    });

    it("ruleTree default uses key `rules` (never `clauses`)", () => {
      // MandateNode schema requires key `rules`, not `clauses`.
      const m = ui.match(/function MandatePanel[\s\S]*?^\}/m);
      expect(m).toBeTruthy();
      expect(m![0]).toMatch(/\{\s*op:\s*"and",\s*rules:\s*\[\]\s*\}/);
      expect(m![0]).not.toMatch(/\{\s*op:\s*"and",\s*clauses:/);
    });
  });

  describe("C3 — Fee panel", () => {
    it("FeePanel exists", () => {
      expect(ui).toMatch(/function FeePanel\(/);
    });

    it("calls POST /api/partner/me/spv/:id/fees", () => {
      expect(ui).toMatch(/apiRequest\("POST",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/fees`/);
    });

    it("hardcodes layer=management (never platform)", () => {
      // Platform fees are admin-only per spvEngineRoutes.ts:228.
      const m = ui.match(/function FeePanel[\s\S]*?^\}/m);
      expect(m).toBeTruthy();
      const body = m![0];
      expect(body).toMatch(/layer:\s*"management"/);
      expect(body).not.toMatch(/layer:\s*"platform"/);
    });

    it("exposes testids", () => {
      for (const id of ["spv-fee-add-open", "spv-fee-type", "spv-fee-fixed", "spv-fee-carry", "spv-fee-effective", "spv-fee-submit"]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
    });

    it("backend has POST /api/partner/me/spv/:spvId/fees with platform-admin-only guard", () => {
      expect(routes).toMatch(/app\.post\("\/api\/partner\/me\/spv\/:spvId\/fees"/);
      expect(routes).toMatch(/PLATFORM_FEE_ADMIN_ONLY/);
    });

    it("fee types come from canonical SPV_FEE_TYPES enum (Opus v1 fix)", () => {
      expect(ui).toMatch(/import[\s\S]*?SPV_FEE_TYPES[\s\S]*?from "@shared\/spvEngine"/);
      expect(ui).not.toMatch(/value="management"[\s\S]*?value="performance"[\s\S]*?value="setup"/); // old invented set gone
    });
  });

  describe("C4 — Document panel", () => {
    it("DocumentPanel exists", () => {
      expect(ui).toMatch(/function DocumentPanel\(/);
    });

    it("calls POST /api/partner/me/spv/:id/documents", () => {
      expect(ui).toMatch(/apiRequest\("POST",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/documents`/);
    });

    it("exposes testids", () => {
      for (const id of ["spv-document-add-open", "spv-document-type", "spv-document-storage-key", "spv-document-submit"]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
    });

    it("backend has POST /api/partner/me/spv/:spvId/documents", () => {
      expect(routes).toMatch(/app\.post\("\/api\/partner\/me\/spv\/:spvId\/documents"/);
    });

    it("exposes storageBackend and sizeBytes fields (Wave C v2 — Gemini v1 fix)", () => {
      expect(ui).toContain('data-testid="spv-document-storage-backend"');
      expect(ui).toContain('data-testid="spv-document-size-bytes"');
    });
  });

  describe("C5 — Transfer panel", () => {
    it("TransferPanel exists", () => {
      expect(ui).toMatch(/function TransferPanel\(/);
    });

    it("calls POST /api/partner/me/spv/:id/transfers", () => {
      expect(ui).toMatch(/apiRequest\("POST",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/transfers`/);
    });

    it("rejects same-investor transfers client-side", () => {
      expect(ui).toMatch(/From and To investors must differ/);
    });

    it("exposes testids", () => {
      for (const id of ["spv-transfer-add-open", "spv-transfer-from", "spv-transfer-to", "spv-transfer-amount", "spv-transfer-units-pct", "spv-transfer-submit"]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
    });

    it("backend has POST /api/partner/me/spv/:spvId/transfers", () => {
      expect(routes).toMatch(/app\.post\("\/api\/partner\/me\/spv\/:spvId\/transfers"/);
    });
  });

  describe("C6 — Record distribution panel", () => {
    it("RecordDistributionPanel exists", () => {
      expect(ui).toMatch(/function RecordDistributionPanel\(/);
    });

    it("calls POST /api/partner/me/spv/:id/distributions", () => {
      // NB: differentiate from POST /distributions/preview (used by DistributionPreview).
      const rx = /apiRequest\("POST",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/distributions`,/;
      expect(ui).toMatch(rx);
    });

    it("exposes testids", () => {
      // WAVE 1A / S-2 — `spv-distribution-outcome` (the "Collection outcome"
      // selector) is deliberately GONE: it let a Consortium Partner declare that
      // carry had been collected, reaching state="paid" with no gateway. It is
      // replaced in-place by an explanatory note; the settlement outcome is now
      // derived server-side only. Allow-listed in scripts/silent-drop-guard/allowlist.json.
      expect(ui).not.toContain('data-testid="spv-distribution-outcome"');
      expect(ui).toContain('data-testid="spv-distribution-settlement-note"');
      for (const id of ["spv-distribution-record-open", "spv-distribution-event", "spv-distribution-gross", "spv-distribution-cost-basis", "spv-distribution-submit"]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
    });

    it("backend has POST /api/partner/me/spv/:spvId/distributions", () => {
      expect(routes).toMatch(/app\.post\("\/api\/partner\/me\/spv\/:spvId\/distributions"/);
    });

    it("cost basis is REQUIRED, not optional (Opus v1 fix — DISTRIBUTION_BASIS_REQUIRED)", () => {
      const m = ui.match(/function RecordDistributionPanel[\s\S]*?^\}/m);
      expect(m).toBeTruthy();
      const body = m![0];
      // parseMinor(costBasis) throws if empty — no cost-basis fallback.
      expect(body).toMatch(/const cb = parseMinor\(costBasis\)/);
      // costBasisMinor must be sent in every request body.
      expect(body).toMatch(/costBasisMinor:\s*cb/);
    });
  });

  describe("C7 — Wind-down panel", () => {
    it("WindDownPanel exists", () => {
      expect(ui).toMatch(/function WindDownPanel\(/);
    });

    it("calls POST /api/partner/me/spv/:id/wind-down", () => {
      expect(ui).toMatch(/apiRequest\("POST",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/wind-down`/);
    });

    it("requires explicit confirmation phrase", () => {
      expect(ui).toMatch(/CONFIRM_PHRASE\s*=\s*"WIND DOWN"/);
    });

    it("exposes testids", () => {
      for (const id of ["spv-winddown-open", "spv-winddown-confirm", "spv-winddown-submit", "spv-winddown-cancel"]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
    });

    it("backend has POST /api/partner/me/spv/:spvId/wind-down (managing_partner only)", () => {
      expect(routes).toMatch(/app\.post\("\/api\/partner\/me\/spv\/:spvId\/wind-down"/);
      expect(routes).toMatch(/wind-down"[\s\S]*?assertSubRole\("managing_partner"\)/);
    });
  });

  describe("C8 — Subscribe panel", () => {
    it("SubscribePanel exists", () => {
      expect(ui).toMatch(/function SubscribePanel\(/);
    });

    it("calls POST /api/partner/me/spv/:id/subscriptions", () => {
      const rx = /apiRequest\("POST",\s*`\/api\/partner\/me\/spv\/\$\{spvId\}\/subscriptions`,/;
      expect(ui).toMatch(rx);
    });

    it("exposes testids", () => {
      for (const id of ["spv-subscription-add-open", "spv-subscription-investor-id", "spv-subscription-commitment", "spv-subscription-persona", "spv-subscription-submit"]) {
        expect(ui).toContain(`data-testid="${id}"`);
      }
    });

    it("backend has POST /api/partner/me/spv/:spvId/subscriptions", () => {
      expect(routes).toMatch(/app\.post\("\/api\/partner\/me\/spv\/:spvId\/subscriptions"/);
    });

    it("persona values come from canonical SPV_INVESTOR_PERSONAS enum (Opus v1 fix)", () => {
      expect(ui).toMatch(/import[\s\S]*?SPV_INVESTOR_PERSONAS[\s\S]*?from "@shared\/spvEngine"/);
      // Old invented values gone.
      expect(ui).not.toMatch(/value="individual"/);
      expect(ui).not.toMatch(/value="family_office"/);
    });

    it("IDOR guard: subscribe() rejects cross-tenant investors (GPT-5 v2 fix — source contract)", () => {
      const store = read("server/spvEngineStore.ts");
      const routes = read("server/spvEngineRoutes.ts");
      // Store's subscribe method has the tenant-isolation query.
      const m = store.match(/subscribe\(\s*[\s\S]*?\n  \}/m);
      expect(m).toBeTruthy();
      const body = m![0];
      expect(body).toMatch(/INVESTOR_NOT_IN_PARTNER_TENANT/);
      // The guard checks partner mismatch via sponsor_partner_id join.
      expect(body).toMatch(/sponsor_partner_id/);
      expect(body).toMatch(/rel\.partner_id\s*<>\s*\?/);
      // v3.1 (Opus v3 O1 fix): the DENY path must NOT be narrowed by
      // s.archived_at IS NULL in the SQL (only in comments). Extract the
      // SQL template literal and assert against that specifically.
      const sqlBlock = body.match(/`SELECT 1 FROM \([\s\S]*?LIMIT 1`/);
      expect(sqlBlock).toBeTruthy();
      expect(sqlBlock![0]).not.toMatch(/s\.archived_at IS NULL/);
      // Route maps INVESTOR_NOT_IN_PARTNER_TENANT to 403.
      expect(routes).toMatch(/INVESTOR_NOT_IN_PARTNER_TENANT:\s*403/);
    });

    it("IDOR guard: BEHAVIORAL — real DB, real subscribe() call", async () => {
      // Opus v3 O2 fix: add a behavioral IDOR probe that exercises the actual
      // guard against a real DB — the source-grep test above passes even if
      // the SQL is semantically inverted. This test catches that.
      const { spvEngineStore } = await import("../spvEngineStore");
      const { rawDb } = await import("../db/connection");

      const t = Date.now();
      const partnerA = `p_v31_a_${t}`;
      const partnerB = `p_v31_b_${t}`;
      const invBrandNew = `inv_v31_new_${t}`;
      const invBoundToB = `inv_v31_b_${t}`;
      const invBoundToBViaSourced = `inv_v31_bsrc_${t}`;

      const db = rawDb();

      // Register both partners' SPVs via the PUBLIC store API so subsequent
      // subscribe() calls can find them via getSpv().
      const mk = (name: string, partner: string) => spvEngineStore.createSpv(partner, { name, jurisdiction: "delaware", spvType: "spv", targetRaiseMinor: 10000000, currency: "USD", minCheckMinor: 100, capMinor: 10000000, carryBasis: "per_deployment" } as any, `actor_${partner}`);
      const spvARec = mk("A_v31", partnerA);
      const spvBRec = mk("B_v31", partnerB);
      const spvARec2 = mk("A2_v31", partnerA);

      // B subscribes invBoundToB via the store (persists to DB — the guard reads DB).
      spvEngineStore.subscribe(partnerB, spvBRec.id, { investorId: invBoundToB, commitmentMinor: 500000, currency: "USD", investorPersona: "collective" }, "actor_b");
      // Bind invBoundToBViaSourced to B via partner_sourced_investors.
      db.prepare(`CREATE TABLE IF NOT EXISTS partner_sourced_investors (id TEXT PRIMARY KEY, partner_id TEXT NOT NULL, investor_id TEXT NOT NULL, status TEXT DEFAULT 'active', sourced_at TEXT)`).run();
      const psiId = `psi_v31_${t}`;
      db.prepare(`INSERT INTO partner_sourced_investors (id, partner_id, investor_id, status, sourced_at) VALUES (?, ?, ?, 'active', ?)`).run(psiId, partnerB, invBoundToBViaSourced, "2026-01-01T00:00:00Z");

      try {
        // (1) brand-new investor → A subscribing → PERMITTED.
        expect(() => spvEngineStore.subscribe(partnerA, spvARec.id, { investorId: invBrandNew, commitmentMinor: 500000, currency: "USD", investorPersona: "collective" }, "actor_a")).not.toThrow();
        // (2) A subscribing invBoundToB (bound to B via sub) → REJECTED.
        expect(() => spvEngineStore.subscribe(partnerA, spvARec.id, { investorId: invBoundToB, commitmentMinor: 500000, currency: "USD", investorPersona: "collective" }, "actor_a")).toThrow(/INVESTOR_NOT_IN_PARTNER_TENANT/);
        // (3) A subscribing invBoundToBViaSourced (bound to B via sourced) → REJECTED.
        expect(() => spvEngineStore.subscribe(partnerA, spvARec.id, { investorId: invBoundToBViaSourced, commitmentMinor: 500000, currency: "USD", investorPersona: "collective" }, "actor_a")).toThrow(/INVESTOR_NOT_IN_PARTNER_TENANT/);
        // (4) A re-subscribing invBrandNew (now bound to A) to another A SPV → PERMITTED.
        expect(() => spvEngineStore.subscribe(partnerA, spvARec2.id, { investorId: invBrandNew, commitmentMinor: 500000, currency: "USD", investorPersona: "collective" }, "actor_a")).not.toThrow();
        // (5) v3.1 O1 fix: after B archives spvB, invBoundToB is STILL bound to B.
        db.prepare(`UPDATE spv SET archived_at = ? WHERE id = ?`).run("2026-06-01T00:00:00Z", spvBRec.id);
        expect(() => spvEngineStore.subscribe(partnerA, spvARec.id, { investorId: invBoundToB, commitmentMinor: 500000, currency: "USD", investorPersona: "collective" }, "actor_a")).toThrow(/INVESTOR_NOT_IN_PARTNER_TENANT/);
      } finally {
        // Cleanup.
        for (const spv of [spvARec.id, spvBRec.id, spvARec2.id]) {
          db.prepare(`DELETE FROM spv_subscription WHERE spv_id = ?`).run(spv);
          db.prepare(`DELETE FROM spv WHERE id = ?`).run(spv);
        }
        db.prepare(`DELETE FROM partner_sourced_investors WHERE partner_id = ?`).run(partnerB);
      }
    }, 15_000);

    it("UI translates INVESTOR_NOT_IN_PARTNER_TENANT to friendly copy", () => {
      expect(ui).toContain("INVESTOR_NOT_IN_PARTNER_TENANT:");
    });
  });

  describe("Cross-cutting properties", () => {
    it("every panel calls onChanged() on success", () => {
      const panels = ["DeployPanel", "MandatePanel", "FeePanel", "DocumentPanel", "TransferPanel", "RecordDistributionPanel", "WindDownPanel", "SubscribePanel"];
      for (const p of panels) {
        const m = ui.match(new RegExp(`function ${p}\\(([\\s\\S]*?)^\\}`, "m"));
        expect(m).toBeTruthy();
        // The panel receives onChanged as a prop and calls it in onSuccess.
        expect(m![0]).toMatch(/onChanged\(\)/);
      }
    });

    it("every panel routes errors through toast, never window.alert", () => {
      const panels = ["DeployPanel", "MandatePanel", "FeePanel", "DocumentPanel", "TransferPanel", "RecordDistributionPanel", "WindDownPanel", "SubscribePanel"];
      for (const p of panels) {
        const m = ui.match(new RegExp(`function ${p}\\(([\\s\\S]*?)^\\}`, "m"));
        expect(m).toBeTruthy();
        const body = m![0];
        expect(body).toMatch(/variant:\s*"destructive"/);
        expect(body).not.toMatch(/window\.alert/);
      }
    });

    it("every panel is mounted in the tabs (referenced from TabsContent branch)", () => {
      // Deploy, subscribe, and record dist. live inside <TabsContent>. Verify all 8 are mounted.
      expect(ui).toMatch(/<DeployPanel /);
      expect(ui).toMatch(/<MandatePanel /);
      expect(ui).toMatch(/<FeePanel /);
      expect(ui).toMatch(/<DocumentPanel /);
      expect(ui).toMatch(/<TransferPanel /);
      expect(ui).toMatch(/<RecordDistributionPanel /);
      expect(ui).toMatch(/<WindDownPanel /);
      expect(ui).toMatch(/<SubscribePanel /);
    });

    it("every panel is gated on canWrite (never renders for read-only viewers)", () => {
      // Each panel usage is preceded by `canWrite && ` (with optional wrapping
      // parens or additional conditions like spv.status check).
      const gated = [
        /canWrite && \(?\s*<DeployPanel /,
        /canWrite && <MandatePanel /,
        /canWrite && <FeePanel /,
        /canWrite && <DocumentPanel /,
        /canWrite && <TransferPanel /,
        /canWrite && <RecordDistributionPanel /,
        /canWrite && spv\.status !== "wound_down" && <WindDownPanel /,
        /canWrite && <SubscribePanel /,
      ];
      for (const g of gated) {
        expect(ui).toMatch(g);
      }
    });

    it("no hardcoded money constants in Wave C panels (no bare $ signs in body strings)", () => {
      // Wave C panels format money via fmt() — never bare "$100" string literals.
      const panelBlock = ui.split(/Wave C v2 — Unblock existing SPV UI/)[1] ?? "";
      expect(panelBlock).not.toMatch(/"\$\d+/);
    });

    it("strict numeric parser used everywhere (Opus v1 P0: \"1e7\" → 1 bug)", () => {
      // Every panel calls parseMinor() for money fields, never parseInt() directly.
      const panels = ["DeployPanel", "MandatePanel", "FeePanel", "DocumentPanel", "TransferPanel", "RecordDistributionPanel", "SubscribePanel", "LpRow", "DistributionPreview"];
      for (const p of panels) {
        const m = ui.match(new RegExp(`function ${p}\\(([\\s\\S]*?)^\\}`, "m"));
        if (!m) continue;
        const body = m![0];
        // If the panel handles money at all, it must use parseMinor (not parseInt).
        if (/amountMinor|commitmentMinor|grossProceedsMinor|costBasisMinor|checkMinMinor|checkMaxMinor|fixedAmountMinor|sizeBytes|receivedMinor/.test(body)) {
          expect(body).toMatch(/parseMinor\(/);
          expect(body).not.toMatch(/parseInt\(\w+\s*\|\|\s*"0"/);
        }
      }
    });

    it("error toasts use spvErrorMessage() for backend error-code translation (all 3 reviewers v1)", () => {
      const panels = ["DeployPanel", "MandatePanel", "FeePanel", "DocumentPanel", "TransferPanel", "RecordDistributionPanel", "WindDownPanel", "SubscribePanel"];
      for (const p of panels) {
        const m = ui.match(new RegExp(`function ${p}\\(([\\s\\S]*?)^\\}`, "m"));
        expect(m).toBeTruthy();
        expect(m![0]).toMatch(/description:\s*spvErrorMessage\(/);
      }
    });

    it("every Label has htmlFor, every input has matching id (Gemini v1 A11y fix)", () => {
      // In Wave C v2, every <Label> in a panel is `htmlFor={\`${id}-...\`}` and
      // every corresponding <Input>/<select> uses the same id.
      const panelBlock = ui.split(/Wave C v2 — Unblock existing SPV UI/)[1] ?? "";
      const labelHtmlForCount = (panelBlock.match(/<Label\s+htmlFor=/g) ?? []).length;
      const inputIdCount = (panelBlock.match(/<(?:Input|select)\s+id=/g) ?? []).length;
      // At least the number of labels should have matching id'd inputs.
      expect(labelHtmlForCount).toBeGreaterThanOrEqual(20);
      expect(inputIdCount).toBeGreaterThanOrEqual(labelHtmlForCount);
    });
  });
});
