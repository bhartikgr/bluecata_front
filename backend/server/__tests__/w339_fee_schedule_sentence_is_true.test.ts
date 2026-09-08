/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 339 — THE FEE SCHEDULE SENTENCE NAMED ONE TRIGGER. THE CODE HAS TWO.
 * ══════════════════════════════════════════════════════════════════════════════
 * This suite does not ask whether a sentence "looks right". It COUNTS the
 * occasions on which the product charges a vehicle fee, asserts the count with
 * `=== n`, and then requires the sentence to name each partner-facing one.
 *
 * WHY A SOURCE COUNT IS THE RIGHT INSTRUMENT HERE. The defect is a mismatch
 * between what the product DOES and what it SAYS. Rendering the sentence proves
 * only the second half. The rendered half is already pinned, on the real screen,
 * by `client/src/pages/partner/__tests__/wave207_fee_basis_copy_dom.test.tsx`,
 * which asserts the Fee Schedule's trigger cell equals this exact constant
 * (`:163`) and the admin screen likewise (`:265`). Those tests compare rendered
 * text to the constant, so correcting the constant corrects both screens; this
 * file supplies the half they cannot: that the constant is TRUE.
 * ══════════════════════════════════════════════════════════════════════════════ */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { W207_VEHICLE_FEE_WHEN } from "@shared/wave207FeeBasisDimension";
import { NON_LIVE_SPV_STATUSES } from "../lib/spvDeploymentFeeSource";
import { LOOKS_HUMAN_MAX_LENGTH } from "@shared/refusalHeadlineGate";

const ROOT = path.join(__dirname, "..", "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Every line that INVOKES the charge, excluding imports, comments and tests. */
function chargeCallSites(): string[] {
  const files = ["server/spvEngineStore.ts", "server/lib/spvEngineDeploymentFeeHook.ts"];
  const out: string[] = [];
  for (const f of files) {
    read(f)
      .split("\n")
      .forEach((line, i) => {
        if (!/chargeEngineSpvDeploymentFee\s*\(/.test(line)) return;
        const t = line.trim();
        if (t.startsWith("*") || t.startsWith("//") || t.startsWith("import")) return;
        if (/^export function chargeEngineSpvDeploymentFee/.test(t)) return;
        out.push(`${f}:${i + 1}`);
      });
  }
  return out;
}

describe("W339 §1 — the number of occasions is COUNTED, not assumed", () => {
  it("`chargeEngineSpvDeploymentFee` is invoked from EXACTLY 3 places in shipped source", () => {
    const sites = chargeCallSites();
    /* Both sides of the name set, both asserted non-empty. */
    expect(sites.length).toBeGreaterThan(0);
    expect(`count=${sites.length}`).toBe("count=3");
    expect(sites).toEqual([
      "server/spvEngineStore.ts:1036",
      "server/spvEngineStore.ts:3232",
      "server/lib/spvEngineDeploymentFeeHook.ts:340",
    ]);
  });

  it("two of them are PARTNER-FACING occasions; the third is an admin retry of the first", () => {
    const store = read("server/spvEngineStore.ts").split("\n");
    /* :1036 — publication out of draft. */
    expect(store[1035]).toContain("chargeEngineSpvDeploymentFee");
    expect(store[1034]).toContain("isPushToLiveTransition");
    /* :3232 — the deploy transition. */
    expect(store[3231]).toContain("chargeEngineSpvDeploymentFee");
    /* The hook's third site is inside `retryEngineSpvDeploymentFee`, which is a
       RETRY of a charge already attempted — not a new occasion to bill. */
    const hook = read("server/lib/spvEngineDeploymentFeeHook.ts");
    const at = hook.indexOf("export function retryEngineSpvDeploymentFee");
    expect(at).toBeGreaterThan(0);
    expect(hook.slice(at, at + 800)).toContain("chargeEngineSpvDeploymentFee");
  });

  it("`isPushToLiveTransition` really does fire OUTSIDE deployment", () => {
    /* The whole defect in one assertion: the second trigger fires on statuses
       that are not `deployed`, so a sentence naming only deployment is false. */
    expect([...NON_LIVE_SPV_STATUSES]).toEqual(["draft", "wound_down"]);
    /* Therefore draft → open (a publication, not a deployment) charges. */
    expect((NON_LIVE_SPV_STATUSES as readonly string[]).includes("open")).toBe(false);
    expect((NON_LIVE_SPV_STATUSES as readonly string[]).includes("draft")).toBe(true);
  });
});

describe("W339 §2 — the sentence now names BOTH partner-facing occasions", () => {
  it("it names leaving draft AND being marked Deployed, and says it is charged once", () => {
    expect(W207_VEHICLE_FEE_WHEN).toContain("leaves draft");
    expect(W207_VEHICLE_FEE_WHEN).toContain("marked Deployed");
    expect(W207_VEHICLE_FEE_WHEN).toContain("Never charged twice");
  });

  it("it no longer claims deployment is the ONLY occasion", () => {
    expect(W207_VEHICLE_FEE_WHEN).not.toContain("when this vehicle is marked Deployed");
  });

  it("the false sentence is gone from shipped source entirely", () => {
    const FALSE_SENTENCE = "Charged once per vehicle, when this vehicle is marked Deployed";
    for (const f of [
      "shared/wave207FeeBasisDimension.ts",
      "client/src/pages/partner/PartnerBilling.tsx",
      "client/src/pages/admin/AdminFeesConsolidated.tsx",
    ]) {
      const src = read(f);
      /* Non-empty on both sides: an unreadable file would otherwise "pass". */
      expect(src.length).toBeGreaterThan(1000);
      expect(src).not.toContain(FALSE_SENTENCE);
    }
  });

  it("the basis half of the sentence is unchanged in meaning — R133.2 is not touched", () => {
    expect(W207_VEHICLE_FEE_WHEN).toContain("does not vary with the capital confirmed");
    expect(W207_VEHICLE_FEE_WHEN).toContain("with the amount raised");
  });

  it("it still fits the 240-character ceiling the platform holds human copy to", () => {
    expect(LOOKS_HUMAN_MAX_LENGTH).toBe(240);
    expect(W207_VEHICLE_FEE_WHEN.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
  });
});
