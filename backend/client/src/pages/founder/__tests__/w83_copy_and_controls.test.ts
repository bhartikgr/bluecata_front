/**
 * WAVE 83 — source-level pins for the copy sweep and the behaviour fixes.
 *
 * These are SOURCE assertions on purpose: the strings they guard are the exact
 * strings a founder, a partner and an admin read, and the point of the wave is
 * that no internal identifier reaches any of them. A renderer test would prove
 * one path; reading the file proves the string is not in the build at all.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fenceInternals } from "../../../../../scripts/lint/internalLanguageFence";

const HERE = __dirname;
const CLIENT = join(HERE, "..", "..", "..");           // client/src
const ROOT = join(CLIENT, "..", "..");                  // repo root
const read = (p: string) => readFileSync(p, "utf8");
/** Source with COMMENTS STRIPPED — a wave note that records the old string is
 *  evidence, not copy. Only what can reach a screen is asserted on.
 *
 *  ── NARROWED UNDER R77 · 2026-08-20 ────────────────────────────────────────
 *  This helper stripped COMMENTS ONLY and then matched the WHOLE FILE. That is
 *  broader than the rule it enforces, and it created a direct contradiction
 *  with `W58CD-A1e`, which REQUIRES `price_contradicts_pool` to exist so a
 *  caller can tell WHICH rule refused a save. Under R77 an internal identifier
 *  is a defect only where A USER CAN READ IT; the same identifier is legitimate
 *  as a non-rendered machine-readable value (`error.code`, a payload field, a
 *  `switch` discriminant, a query key, `data-testid`, a docstring).
 *
 *  `renderedCopy()` therefore returns ONLY the text nodes the Wave 84 fence
 *  classifies as user-visible copy, so this pin and the fence cannot drift
 *  apart: there is one definition of "rendered", not two. `rendered()` is kept
 *  for the assertions that legitimately concern whole-file content (a removed
 *  template literal, a restored sentence).
 *  ─────────────────────────────────────────────────────────────────────────── */
const rendered = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");

/** Only what a user can READ, per R77 — delegated to the Wave 84 fence so the
 *  two share a single definition of rendered copy. */
const renderedCopy = (p: string): string => {
  const { collect, isCopy } = fenceInternals;
  return collect(p)
    .filter((n: { text: string }) => isCopy(n))
    .map((n: { text: string }) => n.text)
    .join("\n");
};

const FOUNDER_SCREENS = [
  join(HERE, "..", "RoundDetail.tsx"),
  join(HERE, "..", "RoundNew.tsx"),
  join(HERE, "..", "Rounds.tsx"),
  join(CLIENT, "components", "RoundCarryForwardPanel.tsx"),
  join(CLIENT, "components", "CloseRoundPanel.tsx"),
];

describe("WAVE 83 · ITEM 1 — the second class of internal language is off the founder screens", () => {
  const BANNED: Array<[string, string]> = [
    ["Refusal code:", "an internal refusal code, labelled as such"],
    ["closed_round_readonly", "an error constant"],
    ["round_close-tranche", "an internal event name"],
    ["captable_committed", "an internal event name"],
    ["Bridge event", "an internal event-bus name"],
    ["Audit digest:", "a raw digest, labelled as such"],
    ["SHA-256 of suggestion payload", "an internal payload description"],
    ["Pricing order in force:", "an internal pricing-order identifier"],
    ["CAPTABLE_MATH_INDUSTRY_STANDARD", "an internal spec file path"],
    ["price_contradicts_pool", "an error constant in a user-facing message"],
    ["not a stored field in this build", "an engineering caveat"],
    ["UNDETERMINED", "an internal state word"],
  ];
  for (const file of FOUNDER_SCREENS) {
    for (const [needle, why] of BANNED) {
      it(`W83-I1 — ${file.split("/").pop()} does not render ${needle} (${why})`, () => {
        /* R77: assert on RENDERED COPY, not on whole-file content. The same
           identifier may legitimately live in an `error.code`, a payload field,
           a `switch` discriminant, a query key or a `data-testid` — a caller
           must still be able to tell WHICH rule refused. */
        expect(renderedCopy(file)).not.toContain(needle);
      });
    }
  }

  it("W83-I1 — the sentences that carried the identifiers are still there (R44: remove the identifier, keep the copy)", () => {
    const rd = read(join(HERE, "..", "RoundDetail.tsx"));
    expect(rd).toContain("Capavate shows no post-close figures while this is unresolved");
    expect(rd).toContain("refuses every term edit once the round is closed or funded");
    expect(rd).toContain("solves the price per share after the option pool");
    const rn = read(join(HERE, "..", "RoundNew.tsx"));
    expect(rn).toContain("Each tranche is recorded as its own permanent closing event");
    expect(rn).toContain("any price computed alongside it is provisional");
  });

  it("W83-I1 — the maturity refusal no longer cites an owner ruling number", () => {
    const adapter = rendered(join(ROOT, "shared", "roundMathEngineAdapter.ts"));
    expect(adapter).toContain("does not rescale or clamp a value to make it fit;");
    expect(adapter).not.toContain("owner ruling R16");
    expect(adapter).not.toContain("owner ruling R60");
    expect(adapter).not.toContain("owner ruling R71");
  });
});

describe("WAVE 83 · ITEM 2 — dead and misleading controls", () => {
  it("W83-I2.1 — 'Add use of proceeds' is disabled, announced as disabled, and says why", () => {
    const rd = read(join(HERE, "..", "RoundDetail.tsx"));
    expect(rd).toContain('data-testid="button-add-uop"');
    expect(rd).toMatch(/disabled aria-disabled="true" title="Not available on this screen/);
    // the honest sentence beside it is untouched
    expect(rd).toContain('data-testid="uop-editor-unavailable"');
  });

  it("W83-I2.2 — a past target close date is warned at BOTH client writers, from ONE shared rule", () => {
    const rn = read(join(HERE, "..", "RoundNew.tsx"));
    const rs = read(join(HERE, "..", "Rounds.tsx"));
    expect(rn).toContain('data-testid="close-date-past-warning"');
    expect(rs).toContain('data-testid="edit-close-date-past-warning"');
    expect(rn).toContain("@shared/roundTargetCloseRule");
    expect(rs).toContain("@shared/roundTargetCloseRule");
  });

  it("W83-I2.2 — and at BOTH server writers, on the non-blocking channel", () => {
    const routes = read(join(ROOT, "server", "routes.ts"));
    expect(routes).toContain('from "../shared/roundTargetCloseRule"');
    // create route AND terms route both push it
    expect(routes.split("pastTargetCloseNotice(").length - 1).toBeGreaterThanOrEqual(3);
  });
});

describe("WAVE 83 · ITEM 2.2 — the one-day display shift was a timezone defect, and it is fixed", () => {
  it("W83-I2.2b — a date-only value is formatted from its own parts", async () => {
    const { fmtDate } = await import("../../../lib/format");
    expect(fmtDate("2026-07-21")).toBe("Jul 21, 2026");
    expect(fmtDate("2026-01-01")).toBe("Jan 1, 2026");
    expect(fmtDate("2026-12-31")).toBe("Dec 31, 2026");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
  });
});

describe("WAVE 83 · ITEM 2.2 — the rule itself", () => {
  it("W83-I2.2c — a past date produces a notice; today and future produce none", async () => {
    const { pastTargetCloseNotice } = await import("../../../../../shared/roundTargetCloseRule");
    const today = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(pastTargetCloseNotice("2020-01-01")).toContain("is in the past");
    expect(pastTargetCloseNotice(iso(today))).toBeNull();
    const future = new Date(today.getTime() + 86400000 * 30);
    expect(pastTargetCloseNotice(iso(future))).toBeNull();
    expect(pastTargetCloseNotice(null)).toBeNull();
    expect(pastTargetCloseNotice("garbage")).toBeNull();
    // it warns, it never refuses: the sentence says the value is accepted
    expect(pastTargetCloseNotice("2020-01-01")).toContain("Capavate accepts it");
  });
});

describe("WAVE 83 · ITEM 4 — the save confirmation confirms something", () => {
  it("W83-I4 — the toast names what was stored and the cache is written from the response", () => {
    const rs = read(join(HERE, "..", "Rounds.tsx"));
    expect(rs).not.toContain("Bridge event ${data.eventType} emitted.");
    expect(rs).toContain("savedTermsSummary(data?.round)");
    expect(rs).toContain('queryClient.setQueryData<Round[] | undefined>(["/api/rounds"]');
    // and the durable read is still the authority
    expect(rs).toContain('queryClient.invalidateQueries({ queryKey: ["/api/rounds"] })');
  });
});
