/**
 * WAVE 32 · CP-SPV-34 — HONEST 503 FAILURE COPY, on the second path.
 *
 * ── WHAT WAS ALREADY DELIVERED, AND WHAT WAS NOT ────────────────────────────
 * `spec/_remaining_w31.tsv` records CP-SPV-34 as DELIVERED, citing
 * `SpvDetailTabs.tsx:1153,1319`: on the distribution PREVIEW, a 503
 * `FEE_STATE_UNKNOWN` renders as persistent state rather than a toast. That is
 * true, and it is verified below rather than taken on trust — a register entry
 * is a claim, and the standing rule is to verify, never assume.
 *
 * It is also not the whole surface. `feeViewUnreliable` guards THREE call sites
 * in `spvEngineStore.ts` (926 `accrueFundingFeeObligations`, 1797
 * `recordDistribution`, 2311 `previewDistributionSplit`), and
 * `spvEngineRoutes.ts` maps four fail-closed fee codes to 5xx. Only the preview
 * had honest copy. On the FEE LEDGER, `opsErrorMessage` had no entry for any of
 * those codes and fell through to `return msg`, which puts the raw string
 * `FEE_STATE_UNKNOWN` on a GP's screen — the exact thing
 * `00_SHARED_STANDARDS §6` forbids, and the opposite of what this item is for.
 *
 * ── HOW THIS HARNESS AVOIDS CHECKING NOTHING ────────────────────────────────
 * The list of codes is DERIVED FROM THE SERVER SOURCE at test time, not typed
 * out here. A hardcoded list is a list that goes stale silently: the next
 * fail-closed code someone adds to the `err()` map would ship with no copy and
 * this file would still be green. Deriving it means the test fails the moment
 * the two drift.
 *
 * Every copy assertion carries the OPPOSITE POLE: it is not enough that a
 * sentence exists, it must not be the raw code and must not be the contentless
 * fallback, and a genuinely unmapped code must still produce prose.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";

const ROUTES = "server/spvEngineRoutes.ts";
const STORE = "server/spvEngineStore.ts";
const PANELS = "client/src/components/partner/SpvOperationsPanels.tsx";
const TABS = "client/src/components/partner/SpvDetailTabs.tsx";

function read(f: string): string {
  return fs.readFileSync(f, "utf8");
}

/** Source with comments stripped, so prose in a doc block cannot satisfy a grep. */
function code(f: string): string {
  return read(f)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * The fail-closed FEE codes the server can actually return, read out of the
 * `err()` status map in `spvEngineRoutes.ts`. Scoped to fee/price concerns,
 * because those are the ones whose blank could be misread as a zero fee.
 */
function serverFeeFailureCodes(): string[] {
  const src = code(ROUTES);
  const map = src.slice(src.indexOf("const map"), src.indexOf("return res.status(map[msg]"));
  const codes = new Set<string>();
  for (const m of map.matchAll(/\b([A-Z][A-Z0-9_]{4,})\s*:\s*(\d{3})/g)) {
    const [, name, status] = m;
    if (!/FEE|PRICE|SCHEDULE/.test(name)) continue;
    if (Number(status) < 500) continue; // a 400 is the caller's fault, not a refusal to price
    codes.add(name);
  }
  return Array.from(codes.values()).sort();
}

/** `OPS_ERROR_COPY` as a real map, parsed from the client source. */
function opsCopyMap(): Record<string, string> {
  const src = code(PANELS);
  const body = src.slice(
    src.indexOf("const OPS_ERROR_COPY"),
    src.indexOf("export function opsErrorMessage"),
  );
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/\b([A-Z][A-Z0-9_]{4,})\s*:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

describe("W32 · CP-SPV-34 — the fail-closed fee codes reach a human as prose", () => {
  it("(1) the derivation itself is not vacuous — the server really does define 5xx fee codes", () => {
    const codes = serverFeeFailureCodes();
    // If this parser silently returned [], every assertion below would pass
    // against a client with no copy at all.
    expect(codes.length).toBeGreaterThanOrEqual(4);
    expect(codes).toContain("FEE_STATE_UNKNOWN");
    expect(codes).toContain("SPV_FEE_SCHEDULE_MISSING");
    // ...and it EXCLUDES the codes that are not about pricing, so the set is
    // scoped rather than "everything in the file".
    expect(codes).not.toContain("SUBSCRIPTION_ALREADY_EXISTS");
    expect(codes).not.toContain("SPV_NOT_FOUND");
  });

  it("(2) the copy map parser is not vacuous either", () => {
    const copy = opsCopyMap();
    expect(Object.keys(copy).length).toBeGreaterThan(10);
    expect(copy.SPV_NOT_FOUND).toContain("Refresh");
  });

  it("(3) EVERY 5xx fee code the server can return has honest partner-facing copy", () => {
    const copy = opsCopyMap();
    for (const c of serverFeeFailureCodes()) {
      const text = copy[c];
      expect(text, `${c} has no entry in OPS_ERROR_COPY — a GP would be shown the raw code`).toBeTruthy();
      // It must be a SENTENCE, not the code wearing a hat.
      expect(text).not.toBe(c);
      expect(text!.length).toBeGreaterThan(40);
      expect(text!.split(" ").length).toBeGreaterThan(8);
      expect(text, `${c} must not leak the machine code into the sentence`).not.toContain(c);
      // THE POINT OF THE ITEM: a blank fee is not a zero fee, and the copy must
      // say so. A refusal that reads like "unavailable" invites the GP to
      // assume there is nothing to pay.
      expect(
        /not (a )?(zero|fee-free)|unknown/i.test(text!),
        `${c} must state that the blank is UNKNOWN, not zero`,
      ).toBe(true);
      // And it must say what happens next, so the GP is not stuck.
      expect(
        /try again|admin|shortly|loads/i.test(text!),
        `${c} must tell the GP what to do next`,
      ).toBe(true);
    }
  });

  it("(4) THE CLASS FIX — an UNMAPPED code still reaches the partner as prose, never as a token", async () => {
    const { opsErrorMessage } = await import("../../client/src/components/partner/SpvOperationsPanels");
    // A code nobody has written copy for yet. This is the case the map can
    // never cover, and it is the one that was rendering raw.
    const out = opsErrorMessage(new Error("SOME_FUTURE_FAIL_CLOSED_CODE"));
    expect(out).not.toBe("SOME_FUTURE_FAIL_CLOSED_CODE");
    expect(out.split(" ").length).toBeGreaterThan(8);
    expect(out).toContain("Nothing was changed");
    // It still names the code for support, which is honest, but it does not
    // pretend the token is a sentence.
    expect(out).toContain("SOME_FUTURE_FAIL_CLOSED_CODE");

    // BOTH POLES. A real prose message from the server must pass through
    // untouched — the guard must not swallow messages that were already fine.
    const prose = "The wire reference you entered does not match our records.";
    expect(opsErrorMessage(new Error(prose))).toBe(prose);
    // And a mapped code still resolves to its specific copy, not the generic.
    expect(opsErrorMessage(new Error("FEE_STATE_UNKNOWN"))).toContain("fee schedule could not be read");
    expect(opsErrorMessage(new Error("FEE_STATE_UNKNOWN"))).not.toContain("Nothing was changed");
    // Empty stays on the old fallback rather than claiming a reference exists.
    expect(opsErrorMessage(new Error(""))).toBe("Something went wrong.");
  });

  it("(5) A TOAST IS NOT A RENDERED STATE — the failed charge persists next to the list", () => {
    const src = code(PANELS);
    // State, not only a toast.
    expect(src).toMatch(/setChargeFailure\(opsErrorMessage\(e\)\)/);
    expect(src).toMatch(/data-testid="spv-fee-charge-failed"/);
    // Cleared on success, or a stale refusal would sit above a charge that worked.
    expect(src).toMatch(/onSuccess:[\s\S]{0,80}setChargeFailure\(null\)/);
    // It is a SIBLING of the obligation list, not nested inside a row: the row
    // can disappear on refetch and take the refusal with it.
    const refusal = src.indexOf('data-testid="spv-fee-charge-failed"');
    const list = src.indexOf('<div data-testid="spv-fee-obligations">');
    expect(refusal).toBeGreaterThan(0);
    expect(refusal).toBeLessThan(list);
    // It states that nothing was written — the GP must not wonder whether the
    // money moved.
    expect(read(PANELS)).toContain("No fee was charged — nothing was written.");
  });

  it("(6) the ALREADY-DELIVERED preview path is verified by reading it, not by trusting the register", () => {
    const src = code(TABS);
    // Persistent state, cleared totals, and a sibling element — the three
    // properties the Wave 26 fix claimed.
    expect(src).toMatch(/setPreviewFailure\(/);
    expect(src).toMatch(/data-testid="spv-preview-failed"/);
    expect(src).toMatch(/FEE_STATE_UNKNOWN/);
    // The stale-money defect: a failed re-preview must clear the previous run.
    expect(src).toMatch(/onError:[\s\S]{0,200}setSplit\(null\)/);
    // And the copy says the blank is not a zero split.
    expect(read(TABS)).toContain("This is not a zero-carry split");
  });

  it("(7) the three fail-closed call sites still fail closed — no silent zero was introduced", () => {
    const src = code(STORE);
    const sites = Array.from(src.matchAll(/if \(this\.feeViewUnreliable\([^)]*\)\) throw new Error\("FEE_STATE_UNKNOWN"\);/g));
    expect(sites.length, "all three guards must still throw, including the money WRITE").toBe(3);
    // The pole: the guard must not have been turned into a warning that
    // continues with a zero.
    expect(src).not.toMatch(/feeViewUnreliable\([^)]*\)\)\s*\{?\s*(console|log)\./);
  });
});
