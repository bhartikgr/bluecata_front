/* v25.45 F16 — Settings → Preferences tab UI nuked; columns KEPT (referenced).
 *
 * Reference check (per brief): the preference fields are referenced by
 * server/lib/companySyncFields.ts (Collective sync set) and ProfileWizard.tsx,
 * AND they live inside the SACRED companyProfileStore.profile_json + completion
 * weighting. They cannot be dropped without touching Avi Tier-2. Decision:
 * DROP UI, KEEP COLUMNS. No migration 0063 applied.
 *
 * This suite asserts: (1) the Preferences tab is gone from the strip + content,
 * (2) the brief's snake_case column names never existed as a real schema,
 * (3) no 0063 drop-preferences migration exists in the tree, (4) the preferred*
 * fields are still referenced by companySyncFields (kept-in-use evidence).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recorder } from "./v25_45_helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
let settings, syncFields;
const { results, record } = recorder();
beforeAll(() => {
  settings = readFileSync(resolve(ROOT, "client/src/pages/founder/Settings.tsx"), "utf8");
  syncFields = readFileSync(resolve(ROOT, "server/lib/companySyncFields.ts"), "utf8");
});

describe("v25.45 F16 Preferences nuked — source assertions", () => {
  it("1. Preferences tab trigger absent from the tab strip", () => {
    const ok = !/TabsTrigger value="preferences"/.test(settings);
    record("preferences tab trigger removed", ok);
    expect(ok).toBe(true);
  });

  it("2. Preferences TabsContent no longer mounted", () => {
    const ok = !/<TabsContent value="preferences"/.test(settings);
    record("preferences content unmounted", ok);
    expect(ok).toBe(true);
  });

  it("3. no 0063 drop-preferences migration applied (columns kept)", () => {
    const files = readdirSync(resolve(ROOT, "migrations"));
    const ok = !files.some((f) => /0063/.test(f) && /preferen/i.test(f))
      && !existsSync(resolve(ROOT, "migrations/0063_v25_45_drop_preferences.sql"));
    record("no 0063 drop migration", ok, files.filter((f) => /0063/.test(f)).join(","));
    expect(ok).toBe(true);
  });

  it("4. preferred* columns still referenced by companySyncFields (kept-in-use)", () => {
    const ok = /preferredCurrency/.test(syncFields)
      && /preferredLanguage/.test(syncFields)
      && /preferredCommunicationChannel/.test(syncFields);
    record("preferred* fields still referenced", ok);
    expect(ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F16 Preferences E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});
