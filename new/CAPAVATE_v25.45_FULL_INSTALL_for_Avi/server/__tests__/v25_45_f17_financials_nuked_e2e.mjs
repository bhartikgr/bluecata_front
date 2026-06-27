/* v25.45 F17 — Settings → Financials tab UI nuked; columns KEPT (referenced).
 *
 * Reference check (per brief): the financial fields (runwayMonths,
 * lastRaiseSizeUsd, lastRaiseDate, cashOnHandUsd, monthlyBurnUsd) are referenced
 * by investor/Collective surfaces — server/collectiveRoutes.ts,
 * server/partnerRoutes.ts, server/dscScoringEngine.ts,
 * server/lib/companySyncFields.ts, admin CompanyDetail, Collective Deal Room.
 * Per the brief: "If referenced by investor reports OR /ma-intel: keep columns,
 * drop UI only." Decision: DROP UI, KEEP COLUMNS. No migration 0064 applied.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
let settings, collectiveRoutes, dsc;
const { results, record } = recorder();
beforeAll(() => {
  settings = readFileSync(resolve(ROOT, "client/src/pages/founder/Settings.tsx"), "utf8");
  collectiveRoutes = readFileSync(resolve(ROOT, "server/collectiveRoutes.ts"), "utf8");
  dsc = readFileSync(resolve(ROOT, "server/dscScoringEngine.ts"), "utf8");
});

describe("v25.45 F17 Financials nuked — source assertions", () => {
  it("1. Financials tab trigger absent from the tab strip", () => {
    const ok = !/TabsTrigger value="financials"/.test(settings);
    record("financials tab trigger removed", ok);
    expect(ok).toBe(true);
  });

  it("2. Financials TabsContent no longer mounted", () => {
    const ok = !/<TabsContent value="financials"/.test(settings);
    record("financials content unmounted", ok);
    expect(ok).toBe(true);
  });

  it("3. no 0064 drop-financials migration applied (columns kept)", () => {
    const files = readdirSync(resolve(ROOT, "migrations"));
    const ok = !files.some((f) => /0064/.test(f) && /financ/i.test(f))
      && !existsSync(resolve(ROOT, "migrations/0064_v25_45_drop_financials.sql"));
    record("no 0064 drop migration", ok, files.filter((f) => /0064/.test(f)).join(","));
    expect(ok).toBe(true);
  });

  it("4. financial columns still referenced by Collective + DSC scoring (kept-in-use)", () => {
    const ok = /runwayMonths/.test(collectiveRoutes)
      && /lastRaiseSizeUsd/.test(collectiveRoutes)
      && /runwayMonths/.test(dsc);
    record("financial fields still referenced by investor/MA surfaces", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F17 Financials E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
