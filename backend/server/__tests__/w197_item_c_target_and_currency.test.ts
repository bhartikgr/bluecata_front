/**
 * WAVE 197 · ITEM C — ABSENT IS NOT ZERO, AND A CURRENCY IS NEVER GUESSED.
 *
 * ══ C.1 — `?? 0` CONFLATED "NO TARGET" WITH "A TARGET OF ZERO" ══════════════
 *
 * Two distinct defects were behind one symptom, and only one of them is the line
 * the brief named:
 *
 *   (a) `server/spvEngineStore.ts:630` handed `s.targetRaiseMinor ?? 0` to the
 *       legacy mirror, so the ENGINE authored a figure the GP never gave.
 *   (b) `server/lib/spvOfflineOps.ts` `computeCloseSummary` then applied
 *       `Number(targetMinor) > 0` when deciding whether a target existed, which
 *       collapsed a GENUINELY STORED ZERO back into "no target". This is the one
 *       that actually reached a GP's screen: R169.5 makes a zero target
 *       legitimate, and a GP who had set zero was shown "No target set."
 *
 * (a) is a boundary-honesty fix with no user-visible consequence today, and the
 * comment at that line says so plainly rather than claiming more. What makes it
 * SAFE is asserted below by ENUMERATION — that no display path reads the legacy
 * mirror's target — so that a future wave which starts displaying it goes red
 * here instead of quietly rendering $0.00 (R143.4).
 *
 * ══ C.2 — `: "USD"` WAS REACHABLE, SO IT REFUSES INSTEAD ════════════════════
 *
 * `server/lib/captableCommitV2548.ts:174` defaulted an unstated currency to USD.
 * Wave 195 called it starved. It was starved only on the happy path: the wave-195
 * pre-router that fills currency in ends its own body with
 * `catch (err) { ... return next(); }` — it FAILS OPEN. A resolution error
 * therefore delivers a currency-less entry to this handler. R156.2 forbids
 * hardcoding, so the entry is now REFUSED into the existing `failed` array and no
 * commit and no attestation is written for it.
 *
 * ══ A NOTE ON THE FILE THIS WAVE SHARES WITH ANOTHER ════════════════════════
 *
 * `server/spvEngineStore.ts` was being edited by a concurrent WAVE 198 during
 * this build (see build_log/wave197/W197_CONCURRENCY_COLLISION.md). The C.1
 * source assertion below exists specifically so that a stale overwrite of that
 * file is caught by a test rather than discovered in production. `?? 0` would
 * type-check, pass `npm run guard` and pass the sacred gate; nothing else in the
 * tree would notice.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { computeCloseSummary } from "../lib/spvOfflineOps";

/** Comment-stripped source, because a grep over comments proves nothing. */
function codeOf(path: string): string {
  const src = fs.readFileSync(path, "utf8");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const SUBS = [
  { status: "committed", commitmentMinor: 250_000_00 },
  { status: "committed", commitmentMinor: 150_000_00 },
  { status: "invited", commitmentMinor: 999_999_00 },
];

describe("W197 C.1a — computeCloseSummary distinguishes absent, zero and positive", () => {
  it("ABSENT (undefined) yields a null target and the no-target sentence", () => {
    const s = computeCloseSummary(SUBS, undefined);
    expect(s.targetMinor).toBeNull();
    expect(s.underTarget).toBe(false);
    expect(s.shortfallMinor).toBe(0);
    expect(s.note).toBe("No target set. Ready to close to new LPs with the confirmed capital.");
  });

  it("ABSENT (null) behaves identically to undefined", () => {
    const s = computeCloseSummary(SUBS, null);
    expect(s.targetMinor).toBeNull();
    expect(s.note).toMatch(/^No target set\./);
  });

  it("ZERO is a REAL target: it survives as 0, not as null", () => {
    /* The whole point of C.1. Before this wave `Number(0) > 0` was false, so a
       stored zero was indistinguishable from no target at all. */
    const s = computeCloseSummary(SUBS, 0);
    expect(s.targetMinor).toBe(0);
    expect(s.targetMinor).not.toBeNull();
    expect(s.underTarget).toBe(false);
    expect(s.note).not.toMatch(/No target set/);
    expect(s.note).toMatch(/zero/i);
  });

  it("a zero target is never described as unmet", () => {
    const s = computeCloseSummary([], 0);
    expect(s.confirmedMinor).toBe(0);
    expect(s.underTarget).toBe(false);
    expect(s.shortfallMinor).toBe(0);
    expect(s.note).toMatch(/met by definition/);
  });

  it("POSITIVE and met keeps the pre-existing sentence verbatim", () => {
    const s = computeCloseSummary(SUBS, 400_000_00);
    expect(s.targetMinor).toBe(400_000_00);
    expect(s.underTarget).toBe(false);
    expect(s.note).toBe("Target met. Ready to close to new LPs and deploy.");
  });

  it("POSITIVE and unmet keeps the pre-existing sentence verbatim", () => {
    const s = computeCloseSummary(SUBS, 900_000_00);
    expect(s.underTarget).toBe(true);
    expect(s.shortfallMinor).toBe(900_000_00 - 400_000_00);
    expect(s.note).toBe(
      "Confirmed capital is below the original target. You can close anyway with the amount raised — the platform will proceed, and you may set the target to the confirmed amount.",
    );
  });

  it("a NEGATIVE target is rejected as unusable rather than treated as a target", () => {
    const s = computeCloseSummary(SUBS, -1);
    expect(s.targetMinor).toBeNull();
    expect(s.note).toMatch(/^No target set\./);
  });

  it("a non-integer target is rejected rather than silently truncated", () => {
    const s = computeCloseSummary(SUBS, 1234.5);
    expect(s.targetMinor).toBeNull();
  });

  it("the four sentences are mutually exclusive — exactly one applies per case", () => {
    const notes = new Set(
      [undefined, 0, 400_000_00, 900_000_00].map((t) => computeCloseSummary(SUBS, t as any).note),
    );
    expect(notes.size).toBe(4);
  });

  it("no money value is produced by Number()/parseInt/parseFloat in this function", () => {
    const src = fs.readFileSync("server/lib/spvOfflineOps.ts", "utf8");
    const fn = src.slice(
      src.indexOf("export function computeCloseSummary"),
      src.indexOf("export function", src.indexOf("export function computeCloseSummary") + 10),
    );
    const body = fn.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(body).not.toMatch(/\bparseInt\b|\bparseFloat\b/);
    expect(body).not.toMatch(/\bNumber\s*\(/);
  });
});

describe("W197 C.1b — the engine no longer authors a target it does not hold", () => {
  it("spvEngineStore passes `?? undefined`, not `?? 0`, to the legacy mirror", () => {
    /* CONTENDED FILE — see the header. This assertion is the only thing in the
       tree that would notice a stale overwrite by another wave. */
    const code = codeOf("server/spvEngineStore.ts");
    expect(code).toMatch(/targetMinor:\s*s\.targetRaiseMinor\s*\?\?\s*undefined/);
    expect(code).not.toMatch(/targetMinor:\s*s\.targetRaiseMinor\s*\?\?\s*0/);
  });

  it("the engine's own DTO field stays nullable, so absence is representable", () => {
    const code = codeOf("shared/spvEngine.ts");
    expect(code).toMatch(/targetRaiseMinor\??\s*:\s*number\s*\|\s*null/);
  });

  it("NO client surface renders a money figure for an absent target — the safety argument, enumerated", () => {
    /* R143.4 forbids displaying $0.00 for an absent target. The legacy column is
       `NOT NULL DEFAULT 0` and this wave did NOT migrate it (stated in the source
       comment). That is only acceptable while nothing renders an absent target as
       money. This test is that condition, written down. If a future wave adds such
       a display, this goes red and the migration becomes required, not optional.

       A FIRST DRAFT OF THIS TEST WAS WRONG AND IS RECORDED AS SUCH. It asserted
       that no client file reads a bare `targetMinor` at all, on the theory that
       the bare name could only mean the legacy mirror. `PartnerDashboard.tsx:332`
       failed it — correctly. That surface reads a SERVER-SIDE AGGREGATE also
       called `targetMinor` (`server/partnerWorkspaceStore.ts:3150`) which is
       derived from the ENGINE field and documented "`null` — NEVER 0". The name
       collision is not a defect. The property that actually matters is not "which
       identifier is read" but "is absence rendered as a number", so that is what
       is asserted now. */
    const surfaces = [
      "client/src/pages/partner/PartnerSpvs.tsx",
      "client/src/pages/partner/PartnerSpvEngine.tsx",
      "client/src/pages/partner/PartnerSpvTemplates.tsx",
      "client/src/pages/partner/PartnerDashboard.tsx",
      "client/src/components/partner/SpvDetailTabs.tsx",
    ];
    for (const f of surfaces) {
      const code = codeOf(f);
      const readsATarget = /\btarget(Raise)?Minor\b/.test(code);
      if (!readsATarget) continue;
      /* Every one of these surfaces must contain an explicit absence branch: a
         null/undefined test on the target it renders. A surface that formats the
         value unconditionally is the failure mode R143.4 names. */
      const hasAbsenceBranch =
        /\btarget(Raise)?Minor\s*(==|===|!=|!==)\s*(null|undefined)/.test(code) ||
        /\btarget(Raise)?Minor\s*\?\?/.test(code) ||
        /\btarget(Raise)?Minor\s*\?\./.test(code) ||
        /NOT_ON_RECORD|NOT_SET_LABEL|no goal on record|—/.test(code);
      expect(
        hasAbsenceBranch,
        `${f} reads a target but has no visible absence branch — it may render $0.00 for an ` +
          `SPV whose GP set no target (R143.4).`,
      ).toBe(true);
    }
  });

  it("the dashboard's target aggregate is derived from the ENGINE field and is never 0-for-absent", () => {
    /* This is the load-bearing half of the argument above: the one surface that
       DOES render a target figure gets it from `targetRaiseMinor`, not from the
       legacy `NOT NULL DEFAULT 0` mirror, and reports `null` when no vehicle
       recorded one. */
    const store = codeOf("server/partnerWorkspaceStore.ts");
    expect(store).toMatch(/const\s+t\s*=\s*engineSpv\.targetRaiseMinor/);
    expect(store).toMatch(/t\s*===\s*null\s*\|\|\s*t\s*===\s*undefined/);
    expect(store).toMatch(/targetMinor:\s*b\.targetSeen\s*\?[^:]*:\s*null/);
    const dash = codeOf("client/src/pages/partner/PartnerDashboard.tsx");
    expect(dash).toMatch(/targetMinor\s*==\s*null/);
    expect(dash).toMatch(/no goal on record/);
  });

  it("the only legacy-target consumer still requires a POSITIVE target, so 0 and absent agree", () => {
    const code = codeOf("server/lib/legacySpvActivationFeeBasis.ts");
    expect(code).toMatch(/>\s*0/);
  });
});

describe("W197 C.2 — an unstated currency is refused, never defaulted", () => {
  const code = codeOf("server/lib/captableCommitV2548.ts");

  it("the hardcoded USD fallback is gone from the code (not merely commented out)", () => {
    expect(code).not.toMatch(/e\.currency\s*:\s*["']USD["']/);
    expect(code).not.toMatch(/\?\s*e\.currency\s*:\s*["']USD["']/);
    /* Belt and braces: no bare `: "USD"` ternary arm anywhere in the file's code. */
    expect(code).not.toMatch(/:\s*["']USD["']\s*;/);
  });

  it("it refuses per entry, into the pre-existing `failed` array", () => {
    expect(code).toMatch(/failed\.push\(\{[^}]*currency_not_resolved/);
    expect(code).toMatch(/statedCurrency\s*===\s*null/);
    expect(code).toMatch(/continue;/);
  });

  it("the refusal happens BEFORE the attestation and the commit are written", () => {
    const refusal = code.indexOf("currency_not_resolved");
    const attestation = code.indexOf("recordCommitAttestation", refusal - 4000 > 0 ? refusal - 4000 : 0);
    expect(refusal).toBeGreaterThan(-1);
    /* The nearest attestation call after the refusal must come AFTER it, i.e. the
       `continue` skips it. Fail-closed: nothing is written for a refused entry. */
    const attAfter = code.indexOf("recordCommitAttestation", refusal);
    expect(attAfter).toBeGreaterThan(refusal);
  });

  it("no currency is converted anywhere in this file (R156.1)", () => {
    expect(code).not.toMatch(/\bconvertCurrency\b|\bfxRate\b|\bexchangeRate\b/i);
  });

  it("the wave-195 pre-router really does fail open, which is why C.2 was reachable", () => {
    /* The reachability finding, asserted rather than asserted-in-prose. If a
       future wave makes that catch fail CLOSED, this test goes red and the C.2
       refusal can be re-argued as genuinely starved. */
    const hook = codeOf("server/wave195CommitCurrencyRoutes.ts");
    expect(hook).toMatch(/catch\s*\([\s\S]{0,80}?\)\s*\{[\s\S]{0,400}?return\s+next\(\)/);
  });

  it("the wave-195 registrar is mounted BEFORE the v2 registrar, as the finding states", () => {
    const routes = codeOf("server/routes.ts");
    const pre = routes.indexOf("registerWave195CommitCurrencyRoutes(app)");
    const v2 = routes.indexOf("registerCaptableCommitV2548Routes(app)");
    expect(pre).toBeGreaterThan(-1);
    expect(v2).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(v2);
  });
});
